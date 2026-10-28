const { prisma } = require("../config/db");
const { AppError } = require("../middleware/errorHandler");
const { isUuid, toApi } = require("../lib/ids");

// CRUD for the user-owned area-section catalog. Every row is addressed by its id and
// always constrained to its owner (req.userId). Mirror of catalogFrameSectionService,
// but area sections carry no computed solver props — thickness + material define the
// shell directly.
const db = prisma.catalogAreaSection;
const notFound = () => new AppError(404, "CatalogAreaSection not found");

// Confirms the referenced material exists and belongs to the user.
async function assertMaterial(ownerId, materialId) {
  if (!isUuid(materialId)) throw new AppError(400, "Material no válido");
  const mat = await prisma.catalogMaterial.findFirst({
    where: { id: materialId, ownerId },
    select: { id: true },
  });
  if (!mat) throw new AppError(400, "Material no encontrado");
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
    await assertMaterial(ownerId, data.materialId);
    return toApi(await db.create({ data: { ...data, ownerId } }));
  },

  update: async (ownerId, id, data) => {
    if (!isUuid(id)) throw notFound();
    if (data.materialId) await assertMaterial(ownerId, data.materialId);
    const { count } = await db.updateMany({ where: { id, ownerId }, data });
    if (!count) throw notFound();
    return toApi(await db.findUnique({ where: { id } }));
  },

  // Las áreas que la usaban quedan sin sección (FK con ON DELETE SET NULL).
  remove: async (ownerId, id) => {
    if (!isUuid(id)) throw notFound();
    const { count } = await db.deleteMany({ where: { id, ownerId } });
    if (!count) throw notFound();
    return { deleted: true };
  },
};
