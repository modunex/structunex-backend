const { clerkClient } = require("@clerk/express");
const { prisma } = require("../config/db");
const { AppError } = require("../middleware/errorHandler");
const { sanitizeDocument, DocumentError } = require("../lib/communityDoc");
const { slugify } = require("../lib/communitySlug");
const { MAX_FILES_PER_POST } = require("../lib/communityFiles");
const { TOPICS, TAGS } = require("../lib/communityCatalog");
const emails = require("./communityEmailService");

const PAGE_SIZE = 20;
const EDIT_WINDOW_MS = 24 * 60 * 60 * 1000;
const NEW_ACCOUNT_MS = 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Publicaciones por 24 h: las cuentas recién creadas tienen menos margen. */
const QUOTA = {
  new: { threads: 3, posts: 10 },
  established: { threads: 20, posts: 100 },
};

const isModerator = (profile) => profile?.role === "moderator" || profile?.role === "admin";
const publicAuthor = (author) =>
  author ? { handle: author.handle, displayName: author.displayName, role: author.role } : null;

async function ensureCatalog() {
  await prisma.forumTopic.createMany({ data: TOPICS, skipDuplicates: true });
  await prisma.forumTag.createMany({ data: TAGS, skipDuplicates: true });
}

// ─── Serialización pública ───

function publicAttachment(att) {
  return {
    id: att.id,
    name: att.name,
    size: att.size,
    kind: att.kind,
    extension: att.extension,
    width: att.width,
    height: att.height,
    available: att.scanStatus === "clean",
  };
}

const THREAD_LIST_SELECT = {
  id: true,
  number: true,
  title: true,
  slug: true,
  locale: true,
  pinned: true,
  lockedAt: true,
  replyCount: true,
  lastPostAt: true,
  createdAt: true,
  topic: true,
  author: true,
  tags: { select: { tag: true } },
  posts: { where: { isFirst: true }, select: { bodyText: true } },
};

function publicTag(tag) {
  return { slug: tag.slug, nameEn: tag.nameEn, nameEs: tag.nameEs };
}

function publicTopic(topic) {
  return {
    slug: topic.slug,
    nameEn: topic.nameEn,
    nameEs: topic.nameEs,
    descriptionEn: topic.descriptionEn,
    descriptionEs: topic.descriptionEs,
    postingRole: topic.postingRole,
    requiresTechnicalContext: topic.requiresTechnicalContext,
  };
}

function publicThreadRow(thread) {
  return {
    number: thread.number,
    title: thread.title,
    slug: thread.slug,
    locale: thread.locale,
    pinned: thread.pinned,
    locked: Boolean(thread.lockedAt),
    replyCount: thread.replyCount,
    lastPostAt: thread.lastPostAt,
    createdAt: thread.createdAt,
    excerpt: (thread.posts?.[0]?.bodyText ?? "").slice(0, 220),
    topic: publicTopic(thread.topic),
    author: publicAuthor(thread.author),
    tags: thread.tags.map((t) => publicTag(t.tag)),
  };
}

function publicPost(post) {
  return {
    id: post.id,
    isFirst: post.isFirst,
    body: post.bodyDoc,
    editedAt: post.editedAt,
    createdAt: post.createdAt,
    author: publicAuthor(post.author),
    attachments: post.attachments
      .filter((att) => !att.hiddenAt && att.uploaded && att.scanStatus !== "blocked")
      .map(publicAttachment),
  };
}

// ─── Lectura pública ───

async function listTopics() {
  const topics = await prisma.forumTopic.findMany({ orderBy: { position: "asc" } });
  return topics.map(publicTopic);
}

async function listTags() {
  const tags = await prisma.forumTag.findMany({
    where: { isActive: true },
    orderBy: [{ group: "asc" }, { slug: "asc" }],
  });
  return tags.map((tag) => ({ ...publicTag(tag), group: tag.group }));
}

async function listFeed({ topic, tag, locale, sort, page }) {
  const where = { hiddenAt: null };
  if (locale) where.locale = locale;
  if (topic) where.topic = { slug: topic };
  else where.pinned = false; // lo fijado va en su propio bloque de la portada
  if (tag) where.tags = { some: { tag: { slug: tag } } };
  if (sort === "unanswered") {
    where.replyCount = 0;
    where.topic = { ...where.topic, postingRole: "member" };
  }
  const [total, threads] = await Promise.all([
    prisma.forumThread.count({ where }),
    prisma.forumThread.findMany({
      where,
      select: THREAD_LIST_SELECT,
      orderBy: [{ lastPostAt: "desc" }, { number: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
  ]);
  return { total, page, pageSize: PAGE_SIZE, threads: threads.map(publicThreadRow) };
}

/** Publicaciones fijadas por el equipo (bloque de Preguntas frecuentes). */
async function listPinned(locale) {
  const threads = await prisma.forumThread.findMany({
    where: { hiddenAt: null, pinned: true, ...(locale ? { locale } : {}) },
    select: THREAD_LIST_SELECT,
    orderBy: { createdAt: "desc" },
    take: 5,
  });
  return threads.map(publicThreadRow);
}

async function getThread(number) {
  const thread = await prisma.forumThread.findFirst({
    where: { number, hiddenAt: null },
    include: {
      topic: true,
      author: true,
      tags: { select: { tag: true } },
      posts: {
        where: { hiddenAt: null },
        orderBy: { createdAt: "asc" },
        include: { author: true, attachments: { orderBy: { createdAt: "asc" } } },
      },
    },
  });
  if (!thread) throw new AppError(404, "NotFound");
  return {
    ...publicThreadRow({ ...thread, posts: thread.posts.filter((p) => p.isFirst) }),
    context: {
      codeEdition: thread.codeEdition,
      designMethod: thread.designMethod,
      assumptions: thread.assumptions,
      units: thread.units,
    },
    posts: thread.posts.map(publicPost),
  };
}

async function getPublicProfile(handle) {
  const profile = await prisma.forumProfile.findUnique({
    where: { handle },
    select: {
      id: true, handle: true, displayName: true, bio: true, role: true, createdAt: true,
    },
  });
  if (!profile) throw new AppError(404, "NotFound");
  const threads = await prisma.forumThread.findMany({
    where: { authorId: profile.id, hiddenAt: null },
    select: THREAD_LIST_SELECT,
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  const { id: _id, ...rest } = profile;
  return { ...rest, threads: threads.map(publicThreadRow) };
}

async function sitemap() {
  const [threads, topics, tags] = await Promise.all([
    prisma.forumThread.findMany({
      where: { hiddenAt: null, replyCount: { gte: 1 } },
      select: { number: true, slug: true, lastPostAt: true },
      orderBy: { number: "desc" },
      take: 5000,
    }),
    prisma.$queryRaw`
      SELECT t."slug", th."locale", COUNT(*)::int AS "count"
      FROM "forum_threads" th JOIN "forum_topics" t ON t."id" = th."topicId"
      WHERE th."hiddenAt" IS NULL GROUP BY t."slug", th."locale"`,
    prisma.$queryRaw`
      SELECT tg."slug", th."locale", COUNT(*)::int AS "count"
      FROM "forum_thread_tags" tt
      JOIN "forum_threads" th ON th."id" = tt."threadId"
      JOIN "forum_tags" tg ON tg."id" = tt."tagId"
      WHERE th."hiddenAt" IS NULL GROUP BY tg."slug", th."locale"`,
  ]);
  return { threads, topics, tags };
}

// ─── Perfil ───

/** Copia local del usuario de Clerk. El webhook puede no haber llegado todavía. */
async function resolveUser(clerkId) {
  const clerkUser = await clerkClient.users.getUser(clerkId);
  const primary = clerkUser.emailAddresses.find((e) => e.id === clerkUser.primaryEmailAddressId);
  const data = {
    email: primary?.emailAddress,
    firstName: clerkUser.firstName ?? undefined,
    lastName: clerkUser.lastName ?? undefined,
    imageUrl: clerkUser.imageUrl ?? undefined,
  };
  const user = await prisma.user.upsert({
    where: { clerkId },
    create: { clerkId, ...data },
    update: data,
  });
  return { user, emailVerified: primary?.verification?.status === "verified" };
}

async function findProfile(clerkId) {
  return prisma.forumProfile.findFirst({ where: { user: { clerkId } } });
}

function ownProfile(profile) {
  if (!profile) return { profile: null };
  return {
    profile: {
      handle: profile.handle,
      displayName: profile.displayName,
      bio: profile.bio,
      role: profile.role,
      notifyReplies: profile.notifyReplies,
      guidelinesAccepted: Boolean(profile.guidelinesAcceptedAt),
      emailVerified: Boolean(profile.emailVerifiedAt),
      suspendedUntil: profile.suspendedUntil,
    },
  };
}

async function getMe(clerkId) {
  return ownProfile(await findProfile(clerkId));
}

async function upsertProfile(clerkId, body, resolve = resolveUser) {
  const existing = await findProfile(clerkId);
  const guidelines = body.acceptGuidelines ? { guidelinesAcceptedAt: new Date() } : {};
  if (existing) {
    if (existing.suspendedUntil && existing.suspendedUntil > new Date()) {
      throw new AppError(403, "Suspended");
    }
    const { acceptGuidelines: _accept, ...fields } = body;
    // El correo pudo verificarse después de crear el perfil.
    const verified =
      !existing.emailVerifiedAt && (await resolve(clerkId)).emailVerified
        ? { emailVerifiedAt: new Date() }
        : {};
    const updated = await prisma.forumProfile.update({
      where: { id: existing.id },
      data: { ...fields, ...guidelines, ...verified },
    });
    return ownProfile(updated);
  }
  if (!body.handle || !body.displayName) {
    throw new AppError(400, "Elige un nombre público");
  }
  const { user, emailVerified } = await resolve(clerkId);
  const created = await prisma.forumProfile.create({
    data: {
      userId: user.id,
      handle: body.handle,
      displayName: body.displayName,
      bio: body.bio ?? "",
      notifyReplies: body.notifyReplies ?? true,
      emailVerifiedAt: emailVerified ? new Date() : null,
      ...guidelines,
    },
  });
  return ownProfile(created);
}

/** Lanza si el perfil no puede publicar ahora mismo. */
function assertCanWrite(profile) {
  if (!profile) throw new AppError(403, "ProfileRequired");
  if (!profile.guidelinesAcceptedAt) throw new AppError(403, "GuidelinesRequired");
  if (!profile.emailVerifiedAt) throw new AppError(403, "EmailNotVerified");
  if (profile.suspendedUntil && profile.suspendedUntil > new Date()) {
    throw new AppError(403, "Suspended");
  }
}

async function assertQuota(profile, kind) {
  if (isModerator(profile)) return;
  const tier = Date.now() - profile.createdAt.getTime() < NEW_ACCOUNT_MS ? "new" : "established";
  const since = new Date(Date.now() - DAY_MS);
  const used =
    kind === "threads"
      ? await prisma.forumThread.count({ where: { authorId: profile.id, createdAt: { gte: since } } })
      : await prisma.forumPost.count({ where: { authorId: profile.id, createdAt: { gte: since } } });
  if (used >= QUOTA[tier][kind]) throw new AppError(429, "QuotaExceeded");
}

// ─── Escritura ───

function parseBody(input) {
  try {
    const result = sanitizeDocument(input);
    if (!result.text && result.imageIds.length === 0) throw new AppError(400, "El contenido está vacío");
    return result;
  } catch (err) {
    if (err instanceof DocumentError) throw new AppError(400, err.message);
    throw err;
  }
}

/**
 * Adjuntos que acompañan a una publicación: propios, subidos, sin bloquear y libres (o ya
 * de esta misma publicación). Las imágenes del documento cuentan aunque no vengan en la
 * lista, y deben ser imágenes.
 */
async function resolveAttachments(tx, profile, requested, imageIds, postId = null) {
  const ids = [...new Set([...requested, ...imageIds])];
  if (ids.length > MAX_FILES_PER_POST) throw new AppError(400, "Máximo 5 adjuntos");
  if (ids.length === 0) return [];
  const found = await tx.forumAttachment.findMany({
    where: {
      id: { in: ids },
      uploaderId: profile.id,
      uploaded: true,
      hiddenAt: null,
      scanStatus: { not: "blocked" },
      OR: [{ postId: null }, ...(postId ? [{ postId }] : [])],
    },
  });
  if (found.length !== ids.length) throw new AppError(400, "Hay adjuntos no válidos");
  const kinds = new Map(found.map((att) => [att.id, att.kind]));
  if (imageIds.some((id) => kinds.get(id) !== "image")) {
    throw new AppError(400, "Hay adjuntos no válidos");
  }
  return ids;
}

function technicalContext(topic, body) {
  if (!topic.requiresTechnicalContext) return {};
  if (!body.codeEdition || !body.assumptions || !body.units) {
    throw new AppError(400, "Indica norma y edición, hipótesis y unidades");
  }
  return {
    codeEdition: body.codeEdition,
    designMethod: body.designMethod || null,
    assumptions: body.assumptions,
    units: body.units,
  };
}

async function createThread(profile, body) {
  assertCanWrite(profile);
  await assertQuota(profile, "threads");
  const topic = await prisma.forumTopic.findUnique({ where: { slug: body.topic } });
  if (!topic) throw new AppError(400, "El tema no existe");
  if (topic.postingRole === "moderator" && !isModerator(profile)) {
    throw new AppError(403, "Forbidden");
  }
  const tags = await prisma.forumTag.findMany({
    where: { slug: { in: body.tags }, isActive: true },
  });
  if (tags.length !== new Set(body.tags).size) throw new AppError(400, "Hay tags no válidos");
  const context = technicalContext(topic, body);
  const { doc, text, imageIds } = parseBody(body.body);

  const thread = await prisma.$transaction(async (tx) => {
    const attachmentIds = await resolveAttachments(tx, profile, body.attachmentIds, imageIds);
    const created = await tx.forumThread.create({
      data: {
        topicId: topic.id,
        authorId: profile.id,
        locale: body.locale,
        title: body.title,
        slug: slugify(body.title),
        ...context,
        tags: { create: tags.map((tag) => ({ tagId: tag.id })) },
        posts: {
          create: { authorId: profile.id, isFirst: true, bodyDoc: doc, bodyText: text },
        },
        subscriptions: { create: { profileId: profile.id } },
      },
      include: { posts: { select: { id: true } } },
    });
    if (attachmentIds.length > 0) {
      await tx.forumAttachment.updateMany({
        where: { id: { in: attachmentIds } },
        data: { postId: created.posts[0].id },
      });
    }
    return created;
  });
  return { number: thread.number, slug: thread.slug };
}

async function createPost(profile, number, body) {
  assertCanWrite(profile);
  await assertQuota(profile, "posts");
  const thread = await prisma.forumThread.findFirst({ where: { number, hiddenAt: null } });
  if (!thread) throw new AppError(404, "NotFound");
  if (thread.lockedAt && !isModerator(profile)) throw new AppError(403, "Locked");
  const { doc, text, imageIds } = parseBody(body.body);

  const post = await prisma.$transaction(async (tx) => {
    const attachmentIds = await resolveAttachments(tx, profile, body.attachmentIds, imageIds);
    const created = await tx.forumPost.create({
      data: { threadId: thread.id, authorId: profile.id, bodyDoc: doc, bodyText: text },
    });
    if (attachmentIds.length > 0) {
      await tx.forumAttachment.updateMany({
        where: { id: { in: attachmentIds } },
        data: { postId: created.id },
      });
    }
    await tx.forumThread.update({
      where: { id: thread.id },
      data: { replyCount: { increment: 1 }, lastPostAt: created.createdAt },
    });
    await tx.forumSubscription.upsert({
      where: { threadId_profileId: { threadId: thread.id, profileId: profile.id } },
      create: { threadId: thread.id, profileId: profile.id },
      update: {},
    });
    await emails.enqueueReply(tx, thread.id, created.id, profile.id);
    return created;
  });
  return { id: post.id };
}

async function editPost(profile, postId, body) {
  assertCanWrite(profile);
  const post = await prisma.forumPost.findUnique({
    where: { id: postId },
    include: { thread: true },
  });
  if (!post || post.hiddenAt || post.thread.hiddenAt) throw new AppError(404, "NotFound");
  if (post.authorId !== profile.id) throw new AppError(403, "Forbidden");
  if (post.thread.lockedAt) throw new AppError(403, "Locked");
  if (Date.now() - post.createdAt.getTime() > EDIT_WINDOW_MS) {
    throw new AppError(403, "EditWindowClosed");
  }
  const { doc, text, imageIds } = parseBody(body.body);
  await prisma.$transaction(async (tx) => {
    const attachmentIds = await resolveAttachments(tx, profile, body.attachmentIds, imageIds, post.id);
    await tx.forumAttachment.updateMany({
      where: { postId: post.id, id: { notIn: attachmentIds }, hiddenAt: null },
      data: { postId: null },
    });
    if (attachmentIds.length > 0) {
      await tx.forumAttachment.updateMany({
        where: { id: { in: attachmentIds } },
        data: { postId: post.id },
      });
    }
    await tx.forumPost.update({
      where: { id: post.id },
      data: { bodyDoc: doc, bodyText: text, editedAt: new Date() },
    });
  });
  return { id: post.id };
}

async function report(profile, postId, body) {
  if (!profile) throw new AppError(403, "ProfileRequired");
  const post = await prisma.forumPost.findFirst({
    where: { id: postId, hiddenAt: null, thread: { hiddenAt: null } },
  });
  if (!post) throw new AppError(404, "NotFound");
  await prisma.forumReport.upsert({
    where: { postId_reporterId: { postId, reporterId: profile.id } },
    create: { postId, reporterId: profile.id, reason: body.reason, note: body.note },
    update: {},
  });
  return { ok: true };
}

async function getSubscription(profile, number) {
  if (!profile) return { subscribed: false };
  const row = await prisma.forumSubscription.findFirst({
    where: { profileId: profile.id, thread: { number } },
  });
  return { subscribed: Boolean(row) };
}

async function setSubscription(profile, number, subscribed) {
  if (!profile) throw new AppError(403, "ProfileRequired");
  const thread = await prisma.forumThread.findFirst({ where: { number, hiddenAt: null } });
  if (!thread) throw new AppError(404, "NotFound");
  const key = { threadId: thread.id, profileId: profile.id };
  if (subscribed) {
    await prisma.forumSubscription.upsert({
      where: { threadId_profileId: key },
      create: key,
      update: {},
    });
  } else {
    await prisma.forumSubscription.deleteMany({ where: key });
  }
  return { subscribed };
}

// ─── Moderación ───

const log = (tx, actor, action, targetType, targetId, reason = "") =>
  tx.forumModerationLog.create({
    data: { actorId: actor.id, action, targetType, targetId: String(targetId), reason },
  });

function assertModerator(profile) {
  if (!isModerator(profile)) throw new AppError(403, "Forbidden");
  if (profile.suspendedUntil && profile.suspendedUntil > new Date()) {
    throw new AppError(403, "Suspended");
  }
}

async function listReports(profile, status = "open") {
  assertModerator(profile);
  const reports = await prisma.forumReport.findMany({
    where: { status },
    orderBy: { createdAt: "asc" },
    take: 100,
    include: {
      reporter: true,
      post: {
        include: {
          author: true,
          thread: { select: { number: true, slug: true, title: true } },
          attachments: { orderBy: { createdAt: "asc" } },
        },
      },
    },
  });
  return reports.map((r) => ({
    id: r.id,
    reason: r.reason,
    note: r.note,
    status: r.status,
    createdAt: r.createdAt,
    reporter: publicAuthor(r.reporter),
    post: {
      id: r.post.id,
      text: r.post.bodyText.slice(0, 500),
      hidden: Boolean(r.post.hiddenAt),
      author: publicAuthor(r.post.author),
      thread: r.post.thread,
      attachments: r.post.attachments.map((att) => ({
        ...publicAttachment(att),
        hidden: Boolean(att.hiddenAt),
      })),
    },
  }));
}

async function recount(tx, threadId) {
  const replyCount = await tx.forumPost.count({
    where: { threadId, isFirst: false, hiddenAt: null },
  });
  await tx.forumThread.update({ where: { id: threadId }, data: { replyCount } });
}

/** Ocultar la primera publicación oculta el hilo entero: sin ella no se entiende. */
async function setPostHidden(profile, postId, hidden, reason) {
  assertModerator(profile);
  await prisma.$transaction(async (tx) => {
    const post = await tx.forumPost.findUnique({ where: { id: postId } });
    if (!post) throw new AppError(404, "NotFound");
    await tx.forumPost.update({
      where: { id: postId },
      data: hidden
        ? { hiddenAt: new Date(), hiddenById: profile.id, hiddenReason: reason }
        : { hiddenAt: null, hiddenById: null, hiddenReason: null },
    });
    if (post.isFirst) {
      await tx.forumThread.update({
        where: { id: post.threadId },
        data: { hiddenAt: hidden ? new Date() : null },
      });
    }
    await recount(tx, post.threadId);
    await log(tx, profile, hidden ? "post.hide" : "post.restore", "post", postId, reason);
  });
  return { ok: true };
}

async function setAttachmentHidden(profile, attachmentId, hidden, reason) {
  assertModerator(profile);
  await prisma.$transaction(async (tx) => {
    await tx.forumAttachment.update({
      where: { id: attachmentId },
      data: { hiddenAt: hidden ? new Date() : null },
    });
    await log(tx, profile, hidden ? "attachment.hide" : "attachment.restore", "attachment", attachmentId, reason);
  });
  return { ok: true };
}

async function setThreadFlag(profile, number, flag, value, reason) {
  assertModerator(profile);
  const thread = await prisma.forumThread.findUnique({ where: { number } });
  if (!thread) throw new AppError(404, "NotFound");
  const data = flag === "lock" ? { lockedAt: value ? new Date() : null } : { pinned: value };
  await prisma.$transaction(async (tx) => {
    await tx.forumThread.update({ where: { id: thread.id }, data });
    await log(tx, profile, `thread.${flag}.${value ? "on" : "off"}`, "thread", number, reason);
  });
  return { ok: true };
}

async function suspendProfile(profile, handle, until, reason) {
  assertModerator(profile);
  const target = await prisma.forumProfile.findUnique({ where: { handle } });
  if (!target) throw new AppError(404, "NotFound");
  // Entre moderadores solo decide un administrador.
  if (target.role === "admin" || (target.role === "moderator" && profile.role !== "admin")) {
    throw new AppError(403, "Forbidden");
  }
  await prisma.$transaction(async (tx) => {
    await tx.forumProfile.update({ where: { id: target.id }, data: { suspendedUntil: until } });
    await log(tx, profile, until ? "profile.suspend" : "profile.restore", "profile", handle, reason);
  });
  return { ok: true };
}

async function resolveReport(profile, reportId, status) {
  assertModerator(profile);
  await prisma.$transaction(async (tx) => {
    await tx.forumReport.update({
      where: { id: reportId },
      data: { status, resolvedById: profile.id, resolvedAt: new Date() },
    });
    await log(tx, profile, `report.${status}`, "report", reportId);
  });
  return { ok: true };
}

async function createTag(profile, data) {
  assertModerator(profile);
  return prisma.$transaction(async (tx) => {
    const tag = await tx.forumTag.create({ data });
    await log(tx, profile, "tag.create", "tag", tag.slug);
    return publicTag(tag);
  });
}

async function updateTag(profile, slug, data) {
  assertModerator(profile);
  return prisma.$transaction(async (tx) => {
    const tag = await tx.forumTag.update({ where: { slug }, data });
    await log(tx, profile, "tag.update", "tag", slug);
    return publicTag(tag);
  });
}

module.exports = {
  PAGE_SIZE,
  ensureCatalog,
  listTopics,
  listTags,
  listFeed,
  listPinned,
  getThread,
  getPublicProfile,
  sitemap,
  findProfile,
  getMe,
  upsertProfile,
  assertCanWrite,
  createThread,
  createPost,
  editPost,
  report,
  getSubscription,
  setSubscription,
  listReports,
  setPostHidden,
  setAttachmentHidden,
  setThreadFlag,
  suspendProfile,
  resolveReport,
  createTag,
  updateTag,
};
