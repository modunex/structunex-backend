const crypto = require("crypto");
const sharp = require("sharp");
const { prisma } = require("../config/db");
const { env } = require("../config/env");
const { AppError } = require("../middleware/errorHandler");
const s3 = require("./s3Service");
const {
  MAX_FILE_BYTES,
  SNIFF_BYTES,
  resolveType,
  cleanFileName,
  contentMatches,
} = require("../lib/communityFiles");

const DAILY_UPLOADS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const ORPHAN_AGE_MS = DAY_MS;
const MAX_IMAGE_SIDE = 2000;
const MAX_IMAGE_PIXELS = 50_000_000;
const SCAN_TAG = "GuardDutyMalwareScanStatus";

const isModerator = (profile) => profile.role === "moderator" || profile.role === "admin";

// Dos prefijos a propósito. La URL prefirmada solo alcanza `uploads/` y sigue valiendo un
// rato tras subir; lo que se comprueba, se escanea y se sirve vive en `files/`, donde solo
// escribe este servidor. Así nadie puede cambiar un archivo después de validarlo.
const uploadKey = (extension) => `${env.communityS3Prefix}/uploads/${crypto.randomUUID()}.${extension}`;
const finalKey = (extension) => `${env.communityS3Prefix}/files/${crypto.randomUUID()}.${extension}`;

/** Registra la subida y devuelve una URL prefirmada para hacer PUT directo a S3. */
async function presign(profile, { name, size }, storage = s3) {
  const type = resolveType(name);
  if (!type) throw new AppError(400, "Este tipo de archivo no está permitido");
  if (size > MAX_FILE_BYTES) throw new AppError(400, "El archivo supera el límite de 20 MB");
  if (!isModerator(profile)) {
    const used = await prisma.forumAttachment.count({
      where: { uploaderId: profile.id, createdAt: { gte: new Date(Date.now() - DAY_MS) } },
    });
    if (used >= DAILY_UPLOADS) throw new AppError(429, "QuotaExceeded");
  }
  const attachment = await prisma.forumAttachment.create({
    data: {
      uploaderId: profile.id,
      s3Key: uploadKey(type.extension),
      name: cleanFileName(name) || `file.${type.extension}`,
      mime: type.mime,
      extension: type.extension,
      size,
      kind: type.kind,
    },
  });
  const url = await storage.signPut(attachment.s3Key, type.mime);
  return { id: attachment.id, url, contentType: type.mime };
}

/** Reescribe la imagen: elimina EXIF y ubicación, y limita su tamaño. */
async function normalizeImage(buffer) {
  const pipeline = sharp(buffer, { limitInputPixels: MAX_IMAGE_PIXELS, failOn: "error" })
    .rotate()
    .resize({ width: MAX_IMAGE_SIDE, height: MAX_IMAGE_SIDE, fit: "inside", withoutEnlargement: true });
  const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, size: info.size };
}

async function reject(attachment, storage, message) {
  await prisma.forumAttachment.delete({ where: { id: attachment.id } });
  await storage.deleteObject(attachment.s3Key).catch(() => {});
  throw new AppError(400, message);
}

/** Tras el PUT: comprueba tamaño y contenido reales antes de aceptar el archivo. */
async function complete(profile, id, storage = s3, normalize = normalizeImage) {
  const attachment = await prisma.forumAttachment.findFirst({
    where: { id, uploaderId: profile.id, uploaded: false },
  });
  if (!attachment) throw new AppError(404, "NotFound");

  // Todas las comprobaciones van sobre la copia final, que el cliente ya no puede tocar.
  const key = finalKey(attachment.extension);
  try {
    await storage.copyObject(attachment.s3Key, key, attachment.mime);
  } catch {
    throw new AppError(400, "El archivo no se subió");
  }
  await prisma.forumAttachment.update({ where: { id: attachment.id }, data: { s3Key: key } });
  await storage.deleteObject(attachment.s3Key).catch(() => {});
  attachment.s3Key = key;

  const size = await storage.objectSize(key).catch(() => 0);
  if (size === 0) return reject(attachment, storage, "El archivo no se subió");
  if (size > MAX_FILE_BYTES) return reject(attachment, storage, "El archivo supera el límite de 20 MB");

  const head = await storage.getObjectHead(key, SNIFF_BYTES);
  if (!contentMatches(attachment.extension, head)) {
    return reject(attachment, storage, "El contenido no corresponde al tipo de archivo");
  }

  const data = { uploaded: true, size };
  if (env.communityScanMode === "off") data.scanStatus = "clean";
  if (attachment.kind === "image") {
    let image;
    try {
      image = await normalize(await storage.getObjectBuffer(attachment.s3Key));
    } catch {
      return reject(attachment, storage, "La imagen no es válida");
    }
    await storage.putObject(attachment.s3Key, image.data, attachment.mime);
    Object.assign(data, { size: image.size, width: image.width, height: image.height });
  }
  const updated = await prisma.forumAttachment.update({ where: { id: attachment.id }, data });
  return {
    id: updated.id,
    name: updated.name,
    size: updated.size,
    kind: updated.kind,
    extension: updated.extension,
    width: updated.width,
    height: updated.height,
    available: updated.scanStatus === "clean",
  };
}

/** Estado del escaneo. Sin etiqueta sigue pendiente, y todo lo demás queda bloqueado. */
function scanResult(tag) {
  if (tag === undefined) return "pending";
  return tag === "NO_THREATS_FOUND" ? "clean" : "blocked";
}

async function refreshScan(attachment, storage = s3) {
  if (attachment.scanStatus !== "pending" || !attachment.uploaded) return attachment.scanStatus;
  if (env.communityScanMode === "off") return "clean";
  const tags = await storage.getObjectTags(attachment.s3Key);
  const status = scanResult(tags[SCAN_TAG]);
  if (status !== "pending") {
    await prisma.forumAttachment.update({ where: { id: attachment.id }, data: { scanStatus: status } });
  }
  return status;
}

async function signDownload(attachment, storage) {
  return storage.signGet(attachment.s3Key, {
    filename: attachment.name,
    inline: attachment.kind === "image" || attachment.extension === "pdf",
    contentType: attachment.mime,
  });
}

/**
 * URL de descarga: solo un adjunto limpio de una publicación visible. Las imágenes son
 * públicas porque forman parte de la lectura; el resto de archivos exige una sesión.
 */
async function publicUrl(id, storage = s3, { signedIn = false } = {}) {
  const attachment = await prisma.forumAttachment.findFirst({
    where: {
      id,
      uploaded: true,
      hiddenAt: null,
      post: { hiddenAt: null, thread: { hiddenAt: null } },
    },
  });
  if (!attachment) throw new AppError(404, "NotFound");
  if (attachment.kind !== "image" && !signedIn) throw new AppError(401, "SignInRequired");
  const status = await refreshScan(attachment, storage);
  if (status !== "clean") throw new AppError(409, "NotAvailable");
  return signDownload(attachment, storage);
}

/** Vista previa para quien lo subió mientras escribe. Tampoco sirve archivos sin escanear. */
async function previewUrl(profile, id, storage = s3) {
  const attachment = await prisma.forumAttachment.findFirst({
    where: { id, uploaderId: profile.id, uploaded: true, hiddenAt: null },
  });
  if (!attachment) throw new AppError(404, "NotFound");
  const status = await refreshScan(attachment, storage);
  if (status !== "clean") throw new AppError(409, "NotAvailable");
  return signDownload(attachment, storage);
}

async function attachmentStatus(profile, id, storage = s3) {
  const attachment = await prisma.forumAttachment.findFirst({
    where: { id, uploaderId: profile.id },
  });
  if (!attachment) throw new AppError(404, "NotFound");
  return { status: await refreshScan(attachment, storage) };
}

/** Actualiza adjuntos pendientes de escaneo. */
async function refreshPending(storage = s3, limit = 50) {
  if (env.communityScanMode === "off" || !env.s3Bucket) return;
  const pending = await prisma.forumAttachment.findMany({
    where: { scanStatus: "pending", uploaded: true },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
  for (const attachment of pending) {
    await refreshScan(attachment, storage).catch((err) => {
      console.error("[community] escaneo no consultado:", err.message);
    });
  }
}

/** Borra subidas que nunca llegaron a una publicación. */
async function cleanupOrphans(storage = s3) {
  const orphans = await prisma.forumAttachment.findMany({
    where: { postId: null, hiddenAt: null, createdAt: { lt: new Date(Date.now() - ORPHAN_AGE_MS) } },
    take: 100,
  });
  for (const attachment of orphans) {
    await storage.deleteObject(attachment.s3Key).catch(() => {});
    await prisma.forumAttachment.delete({ where: { id: attachment.id } });
  }
  return orphans.length;
}

module.exports = {
  DAILY_UPLOADS,
  SCAN_TAG,
  presign,
  complete,
  scanResult,
  refreshScan,
  publicUrl,
  previewUrl,
  attachmentStatus,
  refreshPending,
  cleanupOrphans,
  normalizeImage,
};
