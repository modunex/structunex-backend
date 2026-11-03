// Biblioteca de imágenes del proyecto: piezas que no tocan la base ni S3.
const sharp = require("sharp");

const ACCEPTED_TYPES = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
const ACCEPTED_FORMATS = new Set(["png", "jpeg", "webp"]);
const MAX_INPUT_PIXELS = 100_000_000;
const MAX_SIDE = 6000;
const PRINT_SIDE = 2200;
const THUMB_SIDE = 480;
// Por encima de esto la imagen es una foto o un degradado: JPEG pesa mucho menos.
const PRINT_PNG_MAX_BYTES = 2.5 * 1024 * 1024;

class InvalidImageError extends Error {}

const open = (buffer) => sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error" });

/**
 * Valida una imagen por su contenido y genera lo que se guarda. El archivo original no se
 * conserva: al recodificarlo se quitan EXIF y GPS, y se aplica su orientación.
 */
async function normalizeImage(buffer) {
  let metadata;
  try {
    metadata = await open(buffer).metadata();
  } catch {
    throw new InvalidImageError("not an image");
  }
  if (!ACCEPTED_FORMATS.has(metadata.format)) throw new InvalidImageError("unsupported format");
  try {
    const lossless = metadata.format !== "jpeg" || metadata.hasAlpha;
    const resized = open(buffer).rotate().resize({ width: MAX_SIDE, height: MAX_SIDE, fit: "inside", withoutEnlargement: true });
    const main = await (lossless ? resized.png({ compressionLevel: 9 }) : resized.jpeg({ quality: 92 })).toBuffer({ resolveWithObject: true });
    const flat = (side) =>
      sharp(main.data).flatten({ background: "#ffffff" }).resize({ width: side, height: side, fit: "inside", withoutEnlargement: true });
    let print = await flat(PRINT_SIDE).png({ compressionLevel: 9 }).toBuffer();
    let printType = "image/png";
    if (print.length > PRINT_PNG_MAX_BYTES) {
      print = await flat(PRINT_SIDE).jpeg({ quality: 85 }).toBuffer();
      printType = "image/jpeg";
    }
    return {
      data: main.data,
      contentType: lossless ? "image/png" : "image/jpeg",
      width: main.info.width,
      height: main.info.height,
      print,
      printType,
      thumb: await flat(THUMB_SIDE).jpeg({ quality: 80 }).toBuffer(),
    };
  } catch {
    throw new InvalidImageError("corrupt image");
  }
}

const extensionOf = (contentType) => (contentType === "image/png" ? "png" : "jpg");

/** Figuras de un documento: `[{ imageId, imageVersionId }]`. */
const figureBlocks = (document) => (document?.blocks ?? []).filter((block) => block.type === "figure");

/** Figuras cuya versión no existe en el proyecto. */
function figureProblems(document, versions) {
  return figureBlocks(document)
    .filter((block) => versions.get(block.imageVersionId)?.imageId !== block.imageId)
    .map((block) => ({ blockId: block.id, type: "figure", reason: "missing" }));
}

/** Añade a cada figura de dónde salió, para el registro y el anexo del PDF. */
function withFigureOrigin(document, versions) {
  return {
    ...document,
    blocks: document.blocks.map((block) => {
      if (block.type !== "figure") return block;
      const version = versions.get(block.imageVersionId);
      return {
        ...block,
        origin: {
          name: version.image.name,
          number: version.number,
          sha256: version.sha256,
          createdAt: version.createdAt,
          analysisRunId: version.analysisRunId ?? null,
          designRunId: version.designRunId ?? null,
          connectionRunId: version.connectionRunId ?? null,
        },
      };
    }),
  };
}

module.exports = {
  ACCEPTED_TYPES,
  InvalidImageError,
  extensionOf,
  figureBlocks,
  figureProblems,
  normalizeImage,
  withFigureOrigin,
};
