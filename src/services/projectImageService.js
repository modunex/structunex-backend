// Biblioteca de imágenes del proyecto. El navegador sube directo a S3; el servidor valida
// por contenido, normaliza y guarda cada versión bajo reports/{proyecto}/images/.
const crypto = require("node:crypto");
const { prisma } = require("../config/db");
const { env } = require("../config/env");
const { AppError } = require("../middleware/errorHandler");
const { isUuid, toApi } = require("../lib/ids");
const {
  ACCEPTED_TYPES,
  InvalidImageError,
  extensionOf,
  figureBlocks,
  normalizeImage,
} = require("../lib/projectImages");
const s3 = require("./s3Service");
const { currentModelHash } = require("./analysisService");

const MAX_VIEW_BYTES = 8 * 1024;
// El renderizador acepta 25 MB por petición y el base64 pesa un tercio más.
const MAX_RENDER_IMAGES_BYTES = 18 * 1024 * 1024;

const imagesPrefix = (projectId) => `${s3.reportsPrefix(projectId)}/images`;
const incomingPrefix = (projectId) => `${imagesPrefix(projectId)}/incoming/`;

const storedBytes = (sum) => (sum.bytes ?? 0) + (sum.printBytes ?? 0) + (sum.thumbBytes ?? 0);

async function usedBytes(projectId) {
  const { _sum } = await prisma.projectImageVersion.aggregate({
    where: { image: { projectId } },
    _sum: { bytes: true, printBytes: true, thumbBytes: true },
  });
  return storedBytes(_sum);
}

async function assertRoom(projectId, bytes) {
  if (bytes > env.imageMaxBytes) {
    throw new AppError(413, `La imagen no puede pasar de ${Math.round(env.imageMaxBytes / (1024 * 1024))} MB.`, { error: "image.tooLarge" });
  }
  if ((await usedBytes(projectId)) + bytes > env.imageProjectMaxBytes) {
    throw new AppError(413, "La biblioteca del proyecto está llena.", { error: "image.quotaExceeded" });
  }
}

async function findImage(project, imageId) {
  if (!isUuid(imageId)) throw new AppError(404, "Imagen no encontrada.");
  const row = await prisma.projectImage.findFirst({ where: { id: imageId, projectId: project.id, deletedAt: null } });
  if (!row) throw new AppError(404, "Imagen no encontrada.");
  return row;
}

async function versionToApi(version, storage) {
  const { s3Key, printKey, thumbKey, printType, printBytes, thumbBytes, ...rest } = version;
  return { ...toApi(rest, "projectImageVersion"), thumbnailUrl: await storage.signGet(thumbKey) };
}

async function list(project, storage = s3) {
  const rows = await prisma.projectImage.findMany({
    where: { projectId: project.id, deletedAt: null },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { versions: true } } },
  });
  const ids = rows.map((row) => row.currentVersionId).filter(Boolean);
  const versions = await prisma.projectImageVersion.findMany({ where: { id: { in: ids } } });
  const byId = new Map(versions.map((version) => [version.id, version]));
  const images = await Promise.all(
    rows.map(async ({ _count, deletedAt, ...row }) => ({
      ...toApi(row, "projectImage"),
      versionCount: _count.versions,
      current: byId.has(row.currentVersionId) ? await versionToApi(byId.get(row.currentVersionId), storage) : null,
    }))
  );
  return {
    images,
    storage: { usedBytes: await usedBytes(project.id), limitBytes: env.imageProjectMaxBytes, maxImageBytes: env.imageMaxBytes },
  };
}

async function uploadUrl(project, { contentType, bytes }, storage = s3) {
  const extension = ACCEPTED_TYPES[contentType];
  await assertRoom(project.id, bytes);
  const key = `${incomingPrefix(project.id)}${crypto.randomUUID()}.${extension}`;
  return { key, url: await storage.signPut(key, contentType) };
}

/** Las ejecuciones citadas deben ser del proyecto: esto queda como trazabilidad. */
async function assertRuns(project, { analysisRunId, designRunId, connectionRunId }) {
  const checks = [
    analysisRunId && prisma.analysisRun.count({ where: { id: analysisRunId, projectId: project.id } }),
    designRunId && prisma.designRun.count({ where: { id: designRunId, projectId: project.id } }),
    connectionRunId && prisma.connectionRun.count({ where: { id: connectionRunId, connection: { projectId: project.id } } }),
  ].filter(Boolean);
  const counts = await Promise.all(checks);
  if (counts.some((count) => count === 0)) throw new AppError(400, "La ejecución indicada no es de este proyecto.");
}

function assertView(view) {
  if (view !== undefined && Buffer.byteLength(JSON.stringify(view)) > MAX_VIEW_BYTES) {
    throw new AppError(400, "La descripción de la vista es demasiado grande.");
  }
}

/** Lee lo subido y lo valida. El objeto de entrada se borra siempre: ya no hace falta. */
async function takeUpload(project, key, storage) {
  const valid = key.startsWith(incomingPrefix(project.id)) && /^[0-9a-f-]{36}\.(png|jpg|webp)$/.test(key.slice(incomingPrefix(project.id).length));
  if (!valid) throw new AppError(400, "Clave de imagen no válida.");
  try {
    let size;
    try {
      size = await storage.objectSize(key);
    } catch {
      throw new AppError(404, "No se encontró la imagen subida.");
    }
    // La URL firmada no limita lo que se sube: se mira antes de descargar.
    if (!(size > 0)) throw new AppError(400, "La imagen está vacía.");
    await assertRoom(project.id, size);
    return await normalizeImage(await storage.getObjectBuffer(key));
  } catch (err) {
    if (err instanceof InvalidImageError) throw new AppError(400, "El archivo no es una imagen PNG, JPEG o WebP válida.", { error: "image.invalid" });
    throw err;
  } finally {
    await storage.deleteObject(key).catch(() => {});
  }
}

async function storeVersion(project, imageId, versionId, image, storage) {
  const base = `${imagesPrefix(project.id)}/${imageId}/${versionId}`;
  const keys = {
    s3Key: `${base}/original.${extensionOf(image.contentType)}`,
    printKey: `${base}/print.${extensionOf(image.printType)}`,
    thumbKey: `${base}/thumb.jpg`,
  };
  await Promise.all([
    storage.putObject(keys.s3Key, image.data, image.contentType),
    storage.putObject(keys.printKey, image.print, image.printType),
    storage.putObject(keys.thumbKey, image.thumb, "image/jpeg"),
  ]);
  return {
    ...keys,
    sha256: crypto.createHash("sha256").update(image.data).digest("hex"),
    contentType: image.contentType,
    bytes: image.data.length,
    width: image.width,
    height: image.height,
    printType: image.printType,
    printBytes: image.print.length,
    thumbBytes: image.thumb.length,
  };
}

function originFields(body, modelHash) {
  return {
    ...(body.view !== undefined ? { view: body.view } : {}),
    ...(modelHash ? { modelHash } : {}),
    ...(body.analysisRunId ? { analysisRunId: body.analysisRunId } : {}),
    ...(body.designRunId ? { designRunId: body.designRunId } : {}),
    ...(body.connectionRunId ? { connectionRunId: body.connectionRunId } : {}),
  };
}

// La huella la pone el servidor: el navegador no decide de qué modelo sale una captura.
const modelHashOf = (project, source) => (source === "viewer" ? currentModelHash(project.id).catch(() => null) : null);

async function writeVersion(project, imageId, body, storage, write) {
  const stored = await takeUpload(project, body.key, storage);
  const versionId = crypto.randomUUID();
  const fields = await storeVersion(project, imageId, versionId, stored, storage);
  try {
    return await write({ id: versionId, ...fields });
  } catch (err) {
    await storage.deletePrefix(`${imagesPrefix(project.id)}/${imageId}/${versionId}`).catch(() => {});
    throw err;
  }
}

async function create(project, userId, body, storage = s3) {
  assertView(body.view);
  await assertRuns(project, body);
  const imageId = crypto.randomUUID();
  const modelHash = await modelHashOf(project, body.source);
  return writeVersion(project, imageId, body, storage, async (version) => {
    await prisma.projectImage.create({
      data: {
        id: imageId,
        projectId: project.id,
        name: body.name,
        source: body.source,
        kind: body.source === "upload" ? "file" : body.kind,
        currentVersionId: version.id,
        createdById: userId ?? null,
        versions: { create: { ...version, number: 1, ...originFields(body, modelHash) } },
      },
    });
    return getOne(project, imageId, storage);
  });
}

async function addVersion(project, imageId, body, storage = s3) {
  const image = await findImage(project, imageId);
  assertView(body.view);
  await assertRuns(project, body);
  const modelHash = await modelHashOf(project, image.source);
  return writeVersion(project, imageId, body, storage, async (version) => {
    const last = await prisma.projectImageVersion.aggregate({ where: { imageId }, _max: { number: true } });
    try {
      await prisma.$transaction([
        prisma.projectImageVersion.create({
          data: { ...version, imageId, number: (last._max.number ?? 0) + 1, ...originFields(body, modelHash) },
        }),
        prisma.projectImage.update({ where: { id: imageId }, data: { currentVersionId: version.id } }),
      ]);
    } catch (err) {
      if (err.code === "P2002") throw new AppError(409, "Otra versión se guardó a la vez. Inténtalo de nuevo.");
      throw err;
    }
    return getOne(project, imageId, storage);
  });
}

async function getOne(project, imageId, storage = s3) {
  const { deletedAt, ...image } = await findImage(project, imageId);
  const versions = await prisma.projectImageVersion.count({ where: { imageId } });
  const current = await prisma.projectImageVersion.findUnique({ where: { id: image.currentVersionId } });
  return { ...toApi(image, "projectImage"), versionCount: versions, current: await versionToApi(current, storage) };
}

async function rename(project, imageId, { name }, storage = s3) {
  await findImage(project, imageId);
  await prisma.projectImage.update({ where: { id: imageId }, data: { name } });
  return getOne(project, imageId, storage);
}

/** Documentos y revisiones del proyecto que usan la imagen. */
async function usage(project, imageId, { includeDeleted = false } = {}) {
  if (!includeDeleted) await findImage(project, imageId);
  const uses = (document) => figureBlocks(document).some((block) => block.imageId === imageId);
  const reports = await prisma.report.findMany({
    where: { projectId: project.id },
    select: { id: true, title: true, document: true, revisions: { select: { id: true, number: true, name: true, document: true } } },
  });
  return {
    reports: reports.flatMap((report) => {
      const revisions = report.revisions.filter((revision) => uses(revision.document));
      const draft = uses(report.document);
      if (!draft && revisions.length === 0) return [];
      return [{ _id: report.id, title: report.title, draft, revisions: revisions.map(({ id, number, name }) => ({ _id: id, number, name })) }];
    }),
  };
}

/** Si un reporte la usa, solo sale de la biblioteca: sus versiones siguen disponibles. */
async function remove(project, imageId, storage = s3) {
  await findImage(project, imageId);
  const { reports } = await usage(project, imageId);
  if (reports.length > 0) {
    await prisma.projectImage.update({ where: { id: imageId }, data: { deletedAt: new Date() } });
    return { deleted: true, purged: false, reports: reports.length };
  }
  await prisma.projectImage.delete({ where: { id: imageId } });
  await storage.deletePrefix(`${imagesPrefix(project.id)}/${imageId}`).catch(() => {});
  return { deleted: true, purged: true, reports: 0 };
}

/** URL de una versión concreta. También sirve para imágenes ya retiradas de la biblioteca. */
async function versionUrl(project, versionId, storage = s3) {
  if (!isUuid(versionId)) throw new AppError(404, "Versión no encontrada.");
  const version = await prisma.projectImageVersion.findFirst({
    where: { id: versionId, image: { projectId: project.id } },
    include: { image: { select: { name: true, deletedAt: true } } },
  });
  if (!version) throw new AppError(404, "Versión no encontrada.");
  return {
    _id: version.id,
    imageId: version.imageId,
    name: version.image.name,
    number: version.number,
    width: version.width,
    height: version.height,
    retired: Boolean(version.image.deletedAt),
    url: await storage.signGet(version.printKey),
  };
}

/** Las versiones que cita un documento, solo las de este proyecto. */
async function documentVersions(project, document) {
  const ids = [...new Set(figureBlocks(document).map((block) => block.imageVersionId))].filter(isUuid);
  const rows = await prisma.projectImageVersion.findMany({
    where: { id: { in: ids }, image: { projectId: project.id } },
    include: { image: { select: { name: true } } },
  });
  return new Map(rows.map((row) => [row.id, row]));
}

/**
 * Documento para el renderizador, que trabaja sin red: cada figura lleva su imagen como
 * `data:`. No se guarda: el registro de la exportación solo cita las versiones. Sin
 * imagen no hay PDF: una figura que falta en silencio sería peor que un error.
 */
async function withFigureData(document, versions, storage = s3) {
  const used = [...new Set(figureBlocks(document).map((block) => block.imageVersionId))];
  const total = used.reduce((sum, id) => sum + Math.ceil((versions.get(id).printBytes * 4) / 3), 0);
  if (total > MAX_RENDER_IMAGES_BYTES) {
    throw new AppError(413, "El reporte lleva demasiadas imágenes para un solo PDF.", { error: "report.imagesTooLarge" });
  }
  const sources = new Map();
  for (const id of used) {
    const version = versions.get(id);
    const buffer = await storage.getObjectBuffer(version.printKey).catch(() => {
      throw new AppError(502, `No se pudo leer la imagen «${version.image.name}».`);
    });
    sources.set(id, `data:${version.printType};base64,${buffer.toString("base64")}`);
  }
  return {
    ...document,
    blocks: document.blocks.map((block) => (block.type === "figure" ? { ...block, src: sources.get(block.imageVersionId) } : block)),
  };
}

module.exports = {
  addVersion,
  create,
  documentVersions,
  getOne,
  list,
  remove,
  rename,
  uploadUrl,
  usage,
  versionUrl,
  withFigureData,
};
