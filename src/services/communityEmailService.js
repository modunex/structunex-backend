const crypto = require("crypto");
const { SESv2Client, SendEmailCommand } = require("@aws-sdk/client-sesv2");
const { prisma } = require("../config/db");
const { env } = require("../config/env");

const BATCH = 20;
const MAX_ATTEMPTS = 5;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

let client = null;
function ses() {
  if (!client) {
    client = new SESv2Client({
      region: env.awsRegion,
      ...(env.awsAccessKeyId && env.awsSecretAccessKey
        ? { credentials: { accessKeyId: env.awsAccessKeyId, secretAccessKey: env.awsSecretAccessKey } }
        : {}),
    });
  }
  return client;
}

const isConfigured = () => Boolean(env.communityEmailFrom && env.communityEmailSecret);

function sign(profileId) {
  return crypto.createHmac("sha256", env.communityEmailSecret).update(profileId).digest("base64url");
}

const unsubscribeToken = (profileId) => `${profileId}.${sign(profileId)}`;

/** Perfil de un enlace de baja, o null si la firma no coincide. */
function verifyUnsubscribe(token) {
  if (!env.communityEmailSecret || typeof token !== "string") return null;
  const [profileId, signature] = token.split(".");
  if (!profileId || !signature) return null;
  const expected = Buffer.from(sign(profileId));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) return null;
  return profileId;
}

/** Encola un aviso por suscriptor, salvo para quien acaba de responder. Va en la transacción. */
async function enqueueReply(tx, threadId, postId, authorId) {
  if (!isConfigured()) return;
  const subscribers = await tx.forumSubscription.findMany({
    where: { threadId, profileId: { not: authorId }, profile: { notifyReplies: true } },
    select: { profileId: true },
  });
  if (subscribers.length === 0) return;
  await tx.forumEmailOutbox.createMany({
    data: subscribers.map(({ profileId }) => ({ postId, profileId })),
    skipDuplicates: true,
  });
}

function compose({ locale, title, author, excerpt, url, unsubscribeUrl }) {
  if (locale === "es") {
    return {
      subject: `Nueva respuesta: ${title}`,
      text: `${author} respondió en «${title}».\n\n${excerpt}\n\nVer la publicación: ${url}\n\nDejar de recibir estos avisos: ${unsubscribeUrl}\n`,
    };
  }
  return {
    subject: `New reply: ${title}`,
    text: `${author} replied to "${title}".\n\n${excerpt}\n\nView the post: ${url}\n\nStop receiving these notices: ${unsubscribeUrl}\n`,
  };
}

async function deliver(row) {
  const { post, profile } = row;
  const { thread } = post;
  const email = profile.user.email;
  if (!email || !profile.notifyReplies || post.hiddenAt || thread.hiddenAt) return "skipped";
  const unsubscribeUrl = `${env.apiPublicUrl}/api/community/unsubscribe?token=${encodeURIComponent(unsubscribeToken(profile.id))}`;
  const { subject, text } = compose({
    locale: thread.locale,
    title: thread.title,
    author: post.author?.displayName ?? (thread.locale === "es" ? "Alguien" : "Someone"),
    excerpt: post.bodyText.slice(0, 280),
    url: `${env.publicSiteUrl}/community/t/${thread.number}/${thread.slug}`,
    unsubscribeUrl,
  });
  await ses().send(
    new SendEmailCommand({
      FromEmailAddress: env.communityEmailFrom,
      Destination: { ToAddresses: [email] },
      Content: {
        Simple: {
          Subject: { Data: subject, Charset: "UTF-8" },
          Body: { Text: { Data: text, Charset: "UTF-8" } },
          Headers: [
            { Name: "List-Unsubscribe", Value: `<${unsubscribeUrl}>` },
            { Name: "List-Unsubscribe-Post", Value: "List-Unsubscribe=One-Click" },
          ],
        },
      },
    })
  );
  return "sent";
}

/** Envía un lote. Cada fila se reclama antes de enviar para no duplicar avisos. */
async function processOutbox(send = deliver) {
  if (!isConfigured()) return 0;
  await prisma.forumEmailOutbox.updateMany({
    where: { status: "pending", createdAt: { lt: new Date(Date.now() - MAX_AGE_MS) } },
    data: { status: "skipped" },
  });
  const rows = await prisma.forumEmailOutbox.findMany({
    where: { status: "pending" },
    orderBy: { createdAt: "asc" },
    take: BATCH,
    include: {
      profile: { include: { user: { select: { email: true } } } },
      post: { include: { thread: true, author: true } },
    },
  });
  let sent = 0;
  for (const row of rows) {
    const claimed = await prisma.forumEmailOutbox.updateMany({
      where: { id: row.id, status: "pending" },
      data: { status: "sending", attempts: { increment: 1 } },
    });
    if (claimed.count === 0) continue;
    try {
      const status = await send(row);
      await prisma.forumEmailOutbox.update({
        where: { id: row.id },
        data: { status, sentAt: status === "sent" ? new Date() : null },
      });
      if (status === "sent") sent += 1;
    } catch (err) {
      console.error("[community] aviso no enviado:", err.message);
      await prisma.forumEmailOutbox.update({
        where: { id: row.id },
        data: { status: row.attempts + 1 >= MAX_ATTEMPTS ? "failed" : "pending" },
      });
    }
  }
  return sent;
}

async function unsubscribe(token) {
  const profileId = verifyUnsubscribe(token);
  if (!profileId) return false;
  const result = await prisma.forumProfile.updateMany({
    where: { id: profileId },
    data: { notifyReplies: false },
  });
  return result.count > 0;
}

module.exports = {
  isConfigured,
  enqueueReply,
  processOutbox,
  unsubscribe,
  unsubscribeToken,
  verifyUnsubscribe,
  compose,
};
