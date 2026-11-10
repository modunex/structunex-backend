const { prisma } = require("../config/db");
const { AppError } = require("../middleware/errorHandler");
const { isUuid } = require("../lib/ids");

// Bloqueo del modelo, del lado del servidor.
//
// Al analizar, el proyecto queda bloqueado (Project.isLocked) para que los resultados
// correspondan al modelo. Hasta ahora solo lo respetaba la interfaz. Aquí se hace cumplir
// con el MISMO criterio que decide si un análisis sigue vigente: la huella del modelo
// (analysisService.currentModelHash, lib/modelHash). Con el proyecto bloqueado se acepta
// cualquier escritura que no cambie esa huella (combinaciones, sistema resistente,
// autoguardados sin cambios, catálogo que el modelo no usa) y se rechaza con 409 la que
// sí la cambia. No hay una lista de campos aparte que se pueda desincronizar.

const LOCKED_CODE = "MODEL_LOCKED";

function lockedError(detail) {
  return new AppError(
    409,
    "El modelo está bloqueado por el análisis: este cambio alteraría sus resultados. Desbloquéalo para editarlo.",
    { code: LOCKED_CODE, ...(detail || {}) }
  );
}

/**
 * Ejecuta `fn(tx)` en una transacción. Si el proyecto está bloqueado, compara la huella
 * del modelo antes y después dentro de la misma transacción y, si cambió, la deshace con
 * un 409.
 */
async function guardedModelTransaction(projectId, fn, txOptions) {
  // Perezoso: analysisService arrastra a modelService, que usa este módulo.
  const { currentModelHash } = require("./analysisService");
  return prisma.$transaction(async (tx) => {
    const project = await tx.project.findUnique({
      where: { id: projectId },
      select: { isLocked: true },
    });
    if (!project?.isLocked) return fn(tx);
    const before = await currentModelHash(projectId, tx);
    const result = await fn(tx);
    const after = await currentModelHash(projectId, tx);
    if (before !== after) throw lockedError();
    return result;
  }, txOptions);
}

/**
 * Ids del catálogo que entran en el análisis de un proyecto: las secciones asignadas a
 * barras y áreas, sus materiales y el material de la lámina de las losas colaborantes.
 * Es la misma selección que hace analysisService.assembleModel (un test lo comprueba).
 */
async function catalogRefs(projectId, db = prisma) {
  const [elements, areas] = await Promise.all([
    db.modelElement.findMany({ where: { projectId }, select: { frameSectionId: true } }),
    db.modelArea.findMany({ where: { projectId }, select: { areaSectionId: true } }),
  ]);
  const frameSections = new Set(elements.map((e) => e.frameSectionId).filter(isUuid).map(String));
  const areaSections = new Set(areas.map((a) => a.areaSectionId).filter(isUuid).map(String));
  const [secs, areaSecs] = await Promise.all([
    frameSections.size
      ? db.catalogFrameSection.findMany({ where: { id: { in: [...frameSections] } } })
      : [],
    areaSections.size
      ? db.catalogAreaSection.findMany({ where: { id: { in: [...areaSections] } } })
      : [],
  ]);
  const materials = new Set();
  for (const s of [...secs, ...areaSecs]) if (isUuid(s.materialId)) materials.add(s.materialId);
  for (const s of areaSecs) {
    if (s.kind === "deck" && s.deck && isUuid(s.deck.deckMaterialId)) materials.add(s.deck.deckMaterialId);
  }
  return { frameSections, areaSections, materials };
}

/**
 * El catálogo es del usuario y lo comparten sus proyectos: un elemento que usa algún
 * proyecto bloqueado no se edita ni se borra (cambiaría sus resultados). Lo que no usa
 * ninguno se toca libremente.
 *
 * @param {"frameSections"|"areaSections"|"materials"} kind
 */
async function assertCatalogItemFree(ownerId, kind, id, db = prisma) {
  const locked = await db.project.findMany({
    where: { ownerId, isLocked: true },
    select: { id: true, name: true },
  });
  for (const project of locked) {
    const refs = await catalogRefs(project.id, db);
    if (refs[kind].has(String(id))) {
      throw lockedError({ projectId: project.id, projectName: project.name });
    }
  }
}

module.exports = {
  LOCKED_CODE,
  lockedError,
  guardedModelTransaction,
  catalogRefs,
  assertCatalogItemFree,
};
