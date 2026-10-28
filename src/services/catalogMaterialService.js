const { prisma } = require("../config/db");
const { AppError } = require("../middleware/errorHandler");
const { isUuid, toApi } = require("../lib/ids");

// CRUD for the user-owned material catalog. Every row is addressed by its id and
// always constrained to its owner, so another user's material is never reachable.
const db = prisma.catalogMaterial;
const notFound = () => new AppError(404, "CatalogMaterial not found");

const CONCRETE = ["fc", "fcExpected", "lightweight", "lambda"];
const STEEL = ["Fy", "Fu", "Fye", "Fue"];

// Campos de diseño del tipo anterior que hay que limpiar al cambiar de tipo.
function fieldsToDrop(type) {
  if (type === "concrete") return STEEL;
  if (type === "steel" || type === "rebar") return CONCRETE;
  return [...CONCRETE, ...STEEL];
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

  create: async (ownerId, data) => toApi(await db.create({ data: { ...data, ownerId } })),

  update: async (ownerId, id, data) => {
    if (!isUuid(id)) throw notFound();
    const patch = { ...data };
    if (data.type) {
      for (const field of fieldsToDrop(data.type)) {
        // `lightweight` es NOT NULL con default false: se resetea en vez de anularse.
        patch[field] = field === "lightweight" ? false : null;
      }
    }
    const { count } = await db.updateMany({ where: { id, ownerId }, data: patch });
    if (!count) throw notFound();
    return toApi(await db.findUnique({ where: { id } }));
  },

  remove: async (ownerId, id) => {
    if (!isUuid(id)) throw notFound();
    let count;
    try {
      ({ count } = await db.deleteMany({ where: { id, ownerId } }));
    } catch (err) {
      if (err.code === "P2003") {
        throw new AppError(
          409,
          "El material está en uso por una o más secciones. Cambia o borra esas secciones primero."
        );
      }
      throw err;
    }
    if (!count) throw notFound();
    return { deleted: true };
  },
};
