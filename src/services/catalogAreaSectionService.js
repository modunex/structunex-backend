const { Prisma } = require("@prisma/client");
const { prisma } = require("../config/db");
const { AppError } = require("../middleware/errorHandler");
const { isUuid, toApi } = require("../lib/ids");
const { deckProperties } = require("../lib/deckSection");

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

const DEFAULT_MODIFIERS = {
  f11: 1, f22: 1, f12: 1, m11: 1, m22: 1, m12: 1, v13: 1, v23: 1, mass: 1, weight: 1,
};

/**
 * Una losa colaborante se guarda como el shell con el que se analiza (ver lib/deckSection):
 * espesor tc, material del concreto y peso/masa llevados al total. El análisis vuelve a
 * calcular esto con las densidades vigentes; lo guardado sirve para mostrarlo.
 */
async function withDeckDerived(ownerId, data) {
  if (data.kind !== "deck") {
    // Un Json? se vacía con DbNull, no con null. En el alta basta con no mandarlo.
    const { deck: _drop, ...rest } = data;
    return rest;
  }
  if (!data.deck) throw new AppError(400, "Falta la geometría de la losa colaborante");
  await assertMaterial(ownerId, data.deck.deckMaterialId);
  const [concrete, steel] = await Promise.all([
    prisma.catalogMaterial.findFirst({ where: { id: data.materialId, ownerId } }),
    prisma.catalogMaterial.findFirst({ where: { id: data.deck.deckMaterialId, ownerId } }),
  ]);
  let props;
  try {
    props = deckProperties(data.deck, concrete && concrete.density, steel && steel.density);
  } catch (err) {
    throw new AppError(400, err.message);
  }
  return {
    ...data,
    shellType: "shell-thin",
    thicknessMembrane: props.analysisThickness,
    thicknessBending: props.analysisThickness,
    modifiers: {
      ...DEFAULT_MODIFIERS,
      ...(data.modifiers || {}),
      weight: props.weightFactor,
      mass: props.weightFactor,
    },
    deck: { ...data.deck, props },
  };
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
    const row = await withDeckDerived(ownerId, data);
    return toApi(await db.create({ data: { ...row, ownerId } }));
  },

  update: async (ownerId, id, data) => {
    if (!isUuid(id)) throw notFound();
    if (data.materialId) await assertMaterial(ownerId, data.materialId);
    const current = await db.findFirst({ where: { id, ownerId } });
    if (!current) throw notFound();
    // Un deck se recalcula entero con lo que quede tras el cambio.
    const kind = data.kind || current.kind;
    if (kind === "deck" || current.kind === "deck") {
      const merged = {
        kind,
        materialId: data.materialId || current.materialId,
        modifiers: data.modifiers || current.modifiers,
        deck: data.deck || current.deck,
      };
      const derived = await withDeckDerived(ownerId, merged);
      data = { ...data, ...derived };
      if (kind !== "deck") data.deck = Prisma.DbNull;
      if (kind !== "deck" && data.shellType == null) data.shellType = current.shellType;
    }
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
