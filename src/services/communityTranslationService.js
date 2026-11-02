const crypto = require("crypto");
const { prisma } = require("../config/db");
const { env } = require("../config/env");
const { AppError } = require("../middleware/errorHandler");
const { sanitizeDocument } = require("../lib/communityDoc");
const {
  GLOSSARY_VERSION,
  extractSegments,
  rebuildDocument,
  validateTranslation,
  systemPrompt,
  parseModelOutput,
} = require("../lib/communityTranslation");
const { bedrock, bedrockRuntime } = require("./bedrockService");

const MAX_POSTS_PER_REQUEST = 8;
const MAX_ATTEMPTS = 3;
const CLAIM_MS = 2 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_TOKENS = 8000;

/** Pide la traducción a Claude. Los perfiles de inferencia van por bedrock-runtime. */
async function callModel(from, to, strings) {
  const model = env.communityTranslationModel;
  const client = /^[a-z]+\.anthropic\./.test(model) ? bedrockRuntime() : bedrock();
  const response = await client.messages.create({
    model,
    max_tokens: MAX_TOKENS,
    system: systemPrompt(from, to),
    messages: [{ role: "user", content: JSON.stringify(strings) }],
  });
  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");
  return {
    translated: parseModelOutput(text),
    inputTokens: response.usage?.input_tokens ?? 0,
    outputTokens: response.usage?.output_tokens ?? 0,
  };
}

function sourceHash(thread, post, locale) {
  const source = {
    body: post.bodyDoc,
    title: post.isFirst ? thread.title : null,
    assumptions: post.isFirst ? thread.assumptions : null,
    glossary: GLOSSARY_VERSION,
    locale,
  };
  return crypto.createHash("sha256").update(JSON.stringify(source)).digest("hex");
}

/** Reclama el trabajo: dos clics simultáneos no pagan dos veces. */
async function claim(post, locale, hash, row) {
  const base = { sourceHash: hash, status: "pending", model: env.communityTranslationModel, glossaryVersion: GLOSSARY_VERSION };
  if (!row) {
    try {
      return await prisma.forumTranslation.create({ data: { postId: post.id, locale, attempts: 1, ...base } });
    } catch (err) {
      if (err.code === "P2002") return null;
      throw err;
    }
  }
  const attempts = row.sourceHash === hash ? row.attempts + 1 : 1;
  const claimed = await prisma.forumTranslation.updateMany({
    where: { id: row.id, updatedAt: row.updatedAt },
    data: { ...base, attempts },
  });
  return claimed.count === 1 ? { ...row, ...base, attempts } : null;
}

async function translatePost(thread, post, locale, row, translate) {
  const from = locale === "es" ? "en" : "es";
  const { segments, blocks } = extractSegments(post.bodyDoc);
  const head = post.isFirst ? [thread.title, thread.assumptions].filter((value) => value) : [];
  const sources = [...head, ...segments];
  // Una publicación con solo imágenes o fórmulas no tiene texto que pagar.
  const { translated, inputTokens, outputTokens } = sources.length
    ? await translate(from, locale, sources)
    : { translated: [], inputTokens: 0, outputTokens: 0 };
  validateTranslation(sources, translated);

  const body = translated.slice(head.length);
  const { doc } = sanitizeDocument(rebuildDocument(post.bodyDoc, blocks, body));
  await prisma.forumTranslation.update({
    where: { id: row.id },
    data: {
      status: "ready",
      bodyDoc: doc,
      title: post.isFirst ? translated[0] : null,
      assumptions: post.isFirst && thread.assumptions ? translated[1] : null,
      inputTokens,
      outputTokens,
    },
  });
}

const publicTranslation = (row, post) => ({ postId: post.id, body: row.bodyDoc, title: row.title, assumptions: row.assumptions });

/**
 * Traducción de una publicación al idioma del lector, bajo demanda. Reutiliza lo guardado y
 * traduce lo que falte, hasta un máximo por petición: el cliente repite mientras `done` sea
 * false. Lo que falla o supera el límite diario se queda en el original.
 */
async function translateThread(number, locale, translate = callModel) {
  const thread = await prisma.forumThread.findFirst({
    where: { number, hiddenAt: null },
    include: { posts: { where: { hiddenAt: null }, orderBy: { createdAt: "asc" } } },
  });
  if (!thread) throw new AppError(404, "NotFound");
  if (thread.locale === locale) return { translations: [], pending: 0, failed: 0, limited: false, done: true };

  const rows = await prisma.forumTranslation.findMany({
    where: { locale, postId: { in: thread.posts.map((post) => post.id) } },
  });
  const byPost = new Map(rows.map((row) => [row.postId, row]));
  const used = await prisma.forumTranslation.count({
    where: { updatedAt: { gte: new Date(Date.now() - DAY_MS) }, status: { in: ["ready", "pending", "failed"] } },
  });
  let budget = Math.min(MAX_POSTS_PER_REQUEST, Math.max(0, env.communityTranslationDailyLimit - used));
  const dayExhausted = used >= env.communityTranslationDailyLimit;

  const translations = [];
  let pending = 0;
  let failed = 0;
  let limited = false;

  for (const post of thread.posts) {
    const hash = sourceHash(thread, post, locale);
    const row = byPost.get(post.id);
    const current = row?.sourceHash === hash;

    if (current && row.status === "ready") {
      translations.push(publicTranslation(row, post));
      continue;
    }
    if (current && row.status === "retired") continue;
    if (current && row.status === "failed" && row.attempts >= MAX_ATTEMPTS) {
      failed += 1;
      continue;
    }
    if (current && row.status === "pending" && Date.now() - row.updatedAt.getTime() < CLAIM_MS) {
      pending += 1;
      continue;
    }
    if (budget === 0) {
      if (dayExhausted) limited = true;
      else pending += 1;
      continue;
    }
    budget -= 1;

    const claimed = await claim(post, locale, hash, row);
    if (!claimed) {
      pending += 1;
      continue;
    }
    try {
      await translatePost(thread, post, locale, claimed, translate);
      const saved = await prisma.forumTranslation.findUnique({ where: { id: claimed.id } });
      translations.push(publicTranslation(saved, post));
    } catch (err) {
      console.error("[community] traducción rechazada:", err.message);
      await prisma.forumTranslation.update({ where: { id: claimed.id }, data: { status: "failed" } });
      failed += 1;
    }
  }
  return { translations, pending, failed, limited, done: pending === 0 };
}

module.exports = { translateThread };
