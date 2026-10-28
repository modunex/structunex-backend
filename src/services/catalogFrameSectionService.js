const { prisma } = require("../config/db");
const { AppError } = require("../middleware/errorHandler");
const { isUuid, toApi, jsonNulls } = require("../lib/ids");
const { getShape } = require("../lib/aiscShapes");
const { computeSectionProps } = require("../lib/sectionGeometry");

// CRUD for the user-owned section catalog. Every row is addressed by its id and
// always constrained to its owner. The solver-facing props
// (A/I33/I22/J) are computed here from the shape definition, never trusted from
// the body.
const db = prisma.catalogFrameSection;
const notFound = () => new AppError(404, "CatalogFrameSection not found");

// Campos de definición usados por cada forma paramétrica (además de `shape`).
const SHAPE_DIMS = {
  rectangular: ["b", "h"],
  circular: ["d"],
  pipe: ["d", "t"],
  box: ["b", "h", "t"],
  ishape: ["d", "bfTop", "tfTop", "tw", "bfBot", "tfBot"],
  channel: ["d", "bf", "tf", "tw"],
  tee: ["d", "bf", "tf", "tw"],
  angle: ["d", "b", "t"],
};
// Todos los campos de definición posibles (para limpiar los no usados).
const ALL_DEF_FIELDS = [
  "catalogLabel",
  "shape",
  "A",
  "I33",
  "I22",
  "J",
  ...new Set(Object.values(SHAPE_DIMS).flat()),
];

// Campos de definición que conserva una sección según su source/shape.
function keepFields(def) {
  if (def.source === "catalog") return ["catalogLabel"];
  if (def.source === "general") return ["A", "I33", "I22", "J"];
  // parametric
  return ["shape", ...(SHAPE_DIMS[def.shape] || [])];
}

// Materiales admitidos por tipo de propiedad de la sección. `other` acepta
// cualquiera. Debe casar con las reglas del frontend/Zod.
const COMPATIBLE_MATERIAL = {
  concrete: ["concrete"],
  steel: ["steel"],
  other: null, // sin restricción
};

// Confirma que el material referenciado existe, pertenece al usuario y es
// coherente con el `propertyType` de la sección.
async function assertMaterial(ownerId, materialId, propertyType) {
  if (!isUuid(materialId)) throw new AppError(400, "Material no válido");
  const mat = await prisma.catalogMaterial.findFirst({
    where: { id: materialId, ownerId },
    select: { type: true },
  });
  if (!mat) throw new AppError(400, "Material no encontrado");
  const allowed = COMPATIBLE_MATERIAL[propertyType];
  if (allowed && !allowed.includes(mat.type)) {
    throw new AppError(
      400,
      `El material (${mat.type}) no es coherente con una sección de tipo ${propertyType}`
    );
  }
  return mat;
}

// El material de armadura debe existir, pertenecer al usuario y ser armadura/acero.
async function assertRebarMaterial(ownerId, materialId) {
  if (!isUuid(materialId)) throw new AppError(400, "Material de armadura no válido");
  const mat = await prisma.catalogMaterial.findFirst({
    where: { id: materialId, ownerId },
    select: { type: true },
  });
  if (!mat) throw new AppError(400, "Material de armadura no encontrado");
  if (!["rebar", "steel"].includes(mat.type))
    throw new AppError(400, "El material de armadura debe ser de tipo armadura o acero");
}

// Resuelve el perfil AISC (solo source catalog) y computa las props.
function resolveProps(def) {
  let shape;
  if (def.source === "catalog") {
    shape = getShape(def.catalogLabel);
    if (!shape) throw new AppError(400, "Perfil no encontrado");
  }
  return computeSectionProps(def, shape);
}

module.exports = {
  list: async (ownerId) =>
    (await db.findMany({ where: { ownerId }, orderBy: { createdAt: "desc" } })).map(
      (row) => toApi(row)
    ),

  getOne: async (ownerId, id) => {
    if (!isUuid(id)) throw notFound();
    const row = await db.findFirst({ where: { id, ownerId } });
    if (!row) throw notFound();
    return toApi(row);
  },

  create: async (ownerId, data) => {
    await assertMaterial(ownerId, data.materialId, data.propertyType);
    if (data.reinforcement && data.reinforcement.rebarMaterialId) {
      await assertRebarMaterial(ownerId, data.reinforcement.rebarMaterialId);
    }
    const props = resolveProps(data);
    const row = { ...data, ownerId, props };
    // El armado sólo tiene sentido en hormigón.
    if (row.propertyType !== "concrete") delete row.reinforcement;
    return toApi(await db.create({ data: row }));
  },

  update: async (ownerId, id, data) => {
    if (!isUuid(id)) throw notFound();
    const existing = await db.findFirst({ where: { id, ownerId } });
    if (!existing) throw notFound();

    // Definición efectiva = existente + parche (el discriminante `source`
    // siempre viene en el PATCH). Sirve para recomputar props de forma robusta
    // aunque el parche sea parcial. toApi quita los null de las columnas vacías,
    // para que la definición se vea igual que el documento de Mongo de antes.
    const def = { ...toApi(existing), ...data };
    await assertMaterial(ownerId, def.materialId, def.propertyType);
    if (def.reinforcement && def.reinforcement.rebarMaterialId) {
      await assertRebarMaterial(ownerId, def.reinforcement.rebarMaterialId);
    }
    const props = resolveProps(def);

    const set = { ...data, props };
    // Al cambiar de source/shape, limpiar los campos de definición no usados.
    const keep = keepFields(def);
    for (const field of ALL_DEF_FIELDS) {
      if (!keep.includes(field) && !(field in data)) set[field] = null;
    }
    // El armado sólo vive en hormigón: al dejar de serlo, se elimina.
    if (def.propertyType !== "concrete") set.reinforcement = null;

    await db.update({ where: { id }, data: jsonNulls(set, "catalogFrameSection") });
    return toApi(await db.findUnique({ where: { id } }));
  },

  // Las barras que la usaban quedan sin sección (FK con ON DELETE SET NULL).
  remove: async (ownerId, id) => {
    if (!isUuid(id)) throw notFound();
    const { count } = await db.deleteMany({ where: { id, ownerId } });
    if (!count) throw notFound();
    return { deleted: true };
  },
};
