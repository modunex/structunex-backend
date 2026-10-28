// Adjuntos del asistente IA: PDF, Word (.docx) e imágenes (incluidos los croquis
// dibujados en el chat, que llegan como PNG). Viven en S3; en la base solo se
// guarda la referencia. Los mensajes guardan bloques {type:"attachment"} y aquí se
// rehidratan al formato de la API de Claude en cada petición.

const mammoth = require("mammoth");
const { getObjectBuffer } = require("../s3Service");

const PDF = "application/pdf";
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const IMAGES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const ALLOWED_MIMES = [PDF, DOCX, ...IMAGES];

// Texto extraído de los .docx: un Word no cambia una vez subido, así que se cachea
// en memoria para no reconvertirlo en cada turno de la conversación.
const docxTextCache = new Map();
const DOCX_CACHE_MAX = 200;

async function docxText(att) {
  if (docxTextCache.has(att.id)) return docxTextCache.get(att.id);
  const buffer = await getObjectBuffer(att.s3Key);
  const { value } = await mammoth.extractRawText({ buffer });
  if (docxTextCache.size >= DOCX_CACHE_MAX) {
    docxTextCache.delete(docxTextCache.keys().next().value);
  }
  docxTextCache.set(att.id, value);
  return value;
}

/** Un adjunto → bloques de contenido de la API de Claude. */
async function attachmentToBlocks(att) {
  if (att.mime === PDF) {
    const data = (await getObjectBuffer(att.s3Key)).toString("base64");
    return [
      {
        type: "document",
        source: { type: "base64", media_type: PDF, data },
        title: att.name,
      },
    ];
  }
  if (att.mime === DOCX) {
    const text = await docxText(att);
    return [
      {
        type: "text",
        text: `<documento_word nombre="${att.name}">\n${text}\n</documento_word>`,
      },
    ];
  }
  if (IMAGES.includes(att.mime)) {
    const data = (await getObjectBuffer(att.s3Key)).toString("base64");
    return [
      { type: "text", text: `Imagen adjunta: ${att.name}` },
      { type: "image", source: { type: "base64", media_type: att.mime, data } },
    ];
  }
  return [{ type: "text", text: `[Adjunto no soportado: ${att.name}]` }];
}

/**
 * Sustituye los bloques {type:"attachment", attachmentId} de un mensaje guardado por
 * su contenido real. `byId` = Map(id → fila AiAttachment).
 */
async function hydrateContent(content, byId) {
  if (!Array.isArray(content)) return content;
  const out = [];
  for (const block of content) {
    if (block.type !== "attachment") {
      out.push(block);
      continue;
    }
    const att = byId.get(block.attachmentId);
    if (!att) {
      out.push({ type: "text", text: "[Adjunto eliminado]" });
      continue;
    }
    out.push(...(await attachmentToBlocks(att)));
  }
  return out;
}

module.exports = { ALLOWED_MIMES, hydrateContent };
