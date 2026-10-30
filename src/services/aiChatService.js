// Conversaciones del asistente IA (por proyecto y usuario) y sus adjuntos.

const crypto = require("crypto");
const { Prisma } = require("@prisma/client");
const { prisma } = require("../config/db");
const { env } = require("../config/env");
const { AppError } = require("../middleware/errorHandler");
const { isUuid } = require("../lib/ids");
const { signPut, signGet, deletePrefix } = require("./s3Service");
const { ALLOWED_MIMES } = require("./ai/attachments");

const notFound = () => new AppError(404, "Conversation not found");

async function getConversation(projectId, ownerId, conversationId) {
  if (!isUuid(conversationId)) throw notFound();
  const conv = await prisma.aiConversation.findFirst({
    where: { id: conversationId, projectId, ownerId },
  });
  if (!conv) throw notFound();
  return conv;
}

/**
 * Mensajes en forma "de pantalla": con el resumen del razonamiento (si lo hay), con los adjuntos resueltos a
 * {id, name, mime} y sin los mensajes que solo llevan resultados de herramientas.
 */
function toDisplay(rows, attById) {
  const out = [];
  for (const row of rows) {
    const blocks = Array.isArray(row.content) ? row.content : [];
    if (row.role === "user" && blocks.every((b) => b.type === "tool_result")) continue;
    const parts = [];
    for (const b of blocks) {
      if (b.type === "text" && b.text && !b.text.startsWith("[Nota del sistema")) {
        parts.push({ type: "text", text: b.text });
      } else if (b.type === "attachment") {
        const a = attById.get(b.attachmentId);
        parts.push({
          type: "attachment",
          id: b.attachmentId,
          name: a ? a.name : "(eliminado)",
          mime: a ? a.mime : "",
        });
      } else if (b.type === "tool_use") {
        parts.push({ type: "tool", name: b.name });
      } else if (b.type === "thinking" && b.thinking) {
        parts.push({ type: "thinking", text: b.thinking });
      }
    }
    out.push({
      id: row.id,
      role: row.role,
      parts,
      changeset: row.changeset || null,
      changesetStatus: row.changesetStatus || null,
      createdAt: row.createdAt,
    });
  }
  return out;
}

module.exports = {
  getConversation,

  list: (projectId, ownerId) =>
    prisma.aiConversation.findMany({
      where: { projectId, ownerId },
      orderBy: { updatedAt: "desc" },
      select: { id: true, title: true, createdAt: true, updatedAt: true },
    }),

  create: (projectId, ownerId, title) =>
    prisma.aiConversation.create({
      data: { projectId, ownerId, title: (title || "").slice(0, 80) },
      select: { id: true, title: true, createdAt: true, updatedAt: true },
    }),

  getWithMessages: async (projectId, ownerId, conversationId) => {
    const conv = await getConversation(projectId, ownerId, conversationId);
    const [rows, atts] = await Promise.all([
      prisma.aiMessage.findMany({ where: { conversationId: conv.id }, orderBy: { seq: "asc" } }),
      prisma.aiAttachment.findMany({ where: { conversationId: conv.id } }),
    ]);
    return {
      id: conv.id,
      title: conv.title,
      messages: toDisplay(rows, new Map(atts.map((a) => [a.id, a]))),
    };
  },

  remove: async (projectId, ownerId, conversationId) => {
    const conv = await getConversation(projectId, ownerId, conversationId);
    await prisma.aiConversation.delete({ where: { id: conv.id } });
    // Fuera de la transacción: S3 no participa (best-effort, igual que los runs).
    deletePrefix(`${env.aiS3Prefix}/${projectId}/${conv.id}`).catch((err) =>
      console.warn("[ai] no se pudieron borrar los adjuntos", err.message)
    );
  },

  /** Registra un adjunto y devuelve la URL prefirmada para subirlo a S3. */
  presignAttachment: async (projectId, ownerId, conversationId, { name, mime, size }) => {
    const conv = await getConversation(projectId, ownerId, conversationId);
    if (!ALLOWED_MIMES.includes(mime)) {
      throw new AppError(
        400,
        "Tipo de archivo no soportado. Usa PDF, Word (.docx) o imágenes (PNG, JPG, WebP)."
      );
    }
    if (size > env.aiMaxUploadMb * 1024 * 1024) {
      throw new AppError(400, `El archivo supera el máximo de ${env.aiMaxUploadMb} MB.`);
    }
    const safeName = String(name || "archivo").replace(/[^\w.\-]+/g, "_").slice(0, 120);
    const key = `${env.aiS3Prefix}/${projectId}/${conv.id}/${crypto.randomUUID()}-${safeName}`;
    const att = await prisma.aiAttachment.create({
      data: { conversationId: conv.id, s3Key: key, mime, name: String(name).slice(0, 200), size },
    });
    return { attachmentId: att.id, uploadUrl: await signPut(key, mime) };
  },

  /** URL temporal para ver un adjunto: imágenes y PDF se abren en el navegador. */
  attachmentUrl: async (projectId, ownerId, conversationId, attachmentId) => {
    const conv = await getConversation(projectId, ownerId, conversationId);
    if (!isUuid(attachmentId)) throw new AppError(404, "Adjunto no encontrado");
    const att = await prisma.aiAttachment.findFirst({ where: { id: attachmentId, conversationId: conv.id } });
    if (!att) throw new AppError(404, "Adjunto no encontrado");
    const viewable = att.mime === "application/pdf" || att.mime.startsWith("image/");
    return {
      url: await signGet(att.s3Key, { filename: att.name, inline: viewable, contentType: att.mime }),
      mime: att.mime,
      name: att.name,
    };
  },

  /** Adjuntos de un mensaje: deben ser de esta conversación. */
  resolveAttachments: async (conversationId, ids) => {
    if (!ids.length) return [];
    const rows = await prisma.aiAttachment.findMany({
      where: { id: { in: ids.filter(isUuid) }, conversationId },
    });
    if (rows.length !== ids.length) throw new AppError(400, "Adjunto no válido");
    return rows;
  },

  setChangesetStatus: async (projectId, ownerId, conversationId, messageId, status) => {
    const conv = await getConversation(projectId, ownerId, conversationId);
    if (!isUuid(messageId)) throw new AppError(404, "Message not found");
    const { count } = await prisma.aiMessage.updateMany({
      where: { id: messageId, conversationId: conv.id, changeset: { not: Prisma.DbNull } },
      data: { changesetStatus: status },
    });
    if (!count) throw new AppError(404, "Message not found");
  },
};
