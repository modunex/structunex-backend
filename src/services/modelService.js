const { prisma, CHILD_MODELS } = require("../models");
const { stripChild, jsonNulls } = require("../lib/ids");
const { sanitizeSectionRefs } = require("./sectionRefs");

// Reads/writes the whole structural model (nodes, elements, supports, loads, areas,
// frame/area loads, area springs + configuration) as one nested object, so the
// frontend can hydrate and autosave in a single round-trip instead of one call per
// entity.

// La configuración sale sin la clave del proyecto ni las fechas. Sus null se conservan:
// en Mongo esos campos tenían `default: null` y el frontend ya los veía así.
function stripConfig(config) {
  const { projectId, createdAt, updatedAt, ...rest } = config;
  return rest;
}

// Assembles the nested model from the project's tables, in insertion order (`seq`),
// with the same shape as the frontend StructuralModel. `db` is prisma or a transaction.
async function getModel(projectId, db = prisma) {
  const [entries, config] = await Promise.all([
    Promise.all(
      CHILD_MODELS.map(({ key, name }) =>
        db[name]
          .findMany({ where: { projectId }, orderBy: { seq: "asc" } })
          .then((rows) => [key, rows.map((row) => stripChild(row, name))])
      )
    ),
    db.modelConfiguration.findUnique({ where: { projectId } }),
  ]);
  return { ...Object.fromEntries(entries), configuration: config ? stripConfig(config) : null };
}

// Reconcile by table: for every entity key present in `model`, swap the whole table
// for the incoming array. Absent keys are left untouched (so an autosave can send only
// the collections that changed). Domain-id uniqueness is enforced by each table's
// unique index (a duplicate comes back as 409).
//
// Todo va en una transacción: o se aplica el guardado entero o nada. Las filas se
// insertan en el orden del array, que es el que devuelve `seq` al leer.
//
// Receives the project row (loadProject) because section references are checked
// against the owner's catalog.
async function saveModel(project, model) {
  const projectId = project.id;
  const present = CHILD_MODELS.filter(({ key }) => Array.isArray(model[key]));
  const config = model.configuration; // objeto único (grid + defaults), o ausente

  await prisma.$transaction(
    async (tx) => {
      for (const { key, name } of present) {
        const rows = await sanitizeSectionRefs(tx, project.ownerId, name, model[key]);
        await tx[name].deleteMany({ where: { projectId } });
        if (rows.length) {
          await tx[name].createMany({
            data: rows.map((row) => jsonNulls({ ...row, projectId }, name)),
          });
        }
      }
      if (config != null) {
        const data = jsonNulls(stripConfig(config), "modelConfiguration");
        await tx.modelConfiguration.upsert({
          where: { projectId },
          create: { ...data, projectId },
          update: data,
        });
      }
    },
    // El timeout por defecto (5 s) se queda corto al reescribir modelos grandes.
    { maxWait: 10_000, timeout: 30_000 }
  );

  return getModel(projectId);
}

module.exports = { getModel, saveModel };
