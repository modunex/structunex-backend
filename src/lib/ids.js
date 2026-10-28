const { Prisma } = require("@prisma/client");

// Ids y forma de las filas que salen hacia la API.
//
// La API sigue exponiendo `_id`, igual que con Mongo, para que el frontend no cambie:
//  - tablas con PK `id` (proyectos, catálogos, runs, users): id  -> _id
//  - tablas del modelo (PK `pk`, `id` = id de dominio "N1"):   pk  -> _id
//
// Postgres devuelve null donde Mongo simplemente no tenía el campo. Si esos null
// llegaran al frontend, este los reenviaría en el siguiente guardado y los esquemas
// Zod `.optional()` (que no aceptan null) responderían 400. Por eso se quitan todos los
// null, salvo los de los campos que en Mongo tenían `default: null` y por tanto el
// frontend ya veía como null (KEEP_NULL).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Sustituye a mongoose.isValidObjectId: un id mal formado se trata como 404. */
const isUuid = (v) => typeof v === "string" && UUID_RE.test(v);

const KEEP_NULL = {
  project: ["analysisError", "designError"],
  analysisRun: [
    "solvedAt",
    "durationMs",
    "error",
    "s3Prefix",
    "schemaVersion",
    "modeShapes",
    "springs",
    "modelHash",
  ],
  designRun: [
    "finishedAt",
    "durationMs",
    "error",
    "code",
    "steelCode",
    "s3Prefix",
    "schemaVersion",
  ],
  modelArea: ["diaphragm"],
};

function clean(row, kind) {
  const keep = KEEP_NULL[kind] || [];
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    if (value === null && !keep.includes(key)) continue;
    // BigInt (bytes, seq) no se puede serializar a JSON.
    out[key] = typeof value === "bigint" ? Number(value) : value;
  }
  return out;
}

/** Fila de una tabla con PK `id` -> objeto de API con `_id`. */
function toApi(row, kind) {
  if (!row) return row;
  const { id, ...rest } = row;
  return id === undefined ? clean(rest, kind) : { _id: id, ...clean(rest, kind) };
}

/** Fila de una tabla del modelo -> objeto de API con `_id` (sin `seq`). */
function childToApi(row, kind) {
  if (!row) return row;
  const { pk, seq, ...rest } = row;
  return { _id: pk, ...clean(rest, kind) };
}

/**
 * Fila de una tabla del modelo -> la forma de GET /model y del payload del
 * calc-service: sin pk, seq, projectId ni fechas (lo que antes era
 * `.select("-_id -projectId -__v -createdAt -updatedAt")`).
 */
function stripChild(row, kind) {
  const { pk, seq, projectId, createdAt, updatedAt, ...rest } = row;
  return clean(rest, kind);
}

// Columnas Json que admiten null. Prisma no acepta `null` a secas en una columna Json:
// hay que pasar Prisma.DbNull para guardar un NULL de SQL.
const NULLABLE_JSON = {
  project: ["analysisProgress", "designProgress", "params"],
  modelConfiguration: ["gridSystem", "massSource", "activeDofs", "designPreferences"],
  modelElement: ["releases"],
  modelArea: ["mesh"],
  catalogFrameSection: ["reinforcement"],
};

/** Copia `data` cambiando null por Prisma.DbNull en las columnas Json de `kind`. */
function jsonNulls(data, kind) {
  const fields = NULLABLE_JSON[kind];
  if (!fields || !data) return data;
  const out = { ...data };
  for (const field of fields) {
    if (out[field] === null) out[field] = Prisma.DbNull;
  }
  return out;
}

module.exports = { isUuid, toApi, childToApi, stripChild, jsonNulls };
