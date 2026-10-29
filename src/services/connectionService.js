const axios = require("axios");
const { prisma } = require("../config/db");
const { env } = require("../config/env");
const {
  buildInspectRequest,
  membersFromInspection,
  orphanReasons,
} = require("../lib/connections");
const { isUuid, toApi } = require("../lib/ids");
const { PARAMS_SCHEMAS } = require("../schemas/connectionSchema");
const { freshness, STALE_MESSAGES } = require("../lib/analysisFreshness");
const { AppError } = require("../middleware/errorHandler");
const { fromCalcError } = require("./calcService");
const { assembleDesignModel } = require("./designService");
const { currentModelHash } = require("./analysisService");

// Conexiones de acero — F1: inspeccionar un nudo.
//
// El calc-service hace el trabajo (`POST /connections/inspect`): describe el nudo y lee
// de la ejecución de análisis las fuerzas de extremo de cada barra. Este módulo solo
// decide QUÉ ejecución vale y arma la petición.
//
// QUÉ EJECUCIÓN VALE. La más reciente resuelta, y solo si sus resultados son de ESTE
// modelo: desbloquear no borra resultados, así que un run "solved" puede ser de un
// modelo que ya no existe. Unas fuerzas de otro modelo, presentadas como las de una
// conexión, son el error que este módulo existe para impedir; por eso un run caducado
// es un 409 y no un aviso.

async function inspect(project, nodeId) {
  const projectId = project.id;

  const node = await prisma.modelNode.findUnique({
    where: { projectId_id: { projectId, id: nodeId } },
    select: { id: true },
  });
  if (!node) throw new AppError(404, `El nudo ${nodeId} no existe en el modelo.`);

  const run = await prisma.analysisRun.findFirst({
    where: { projectId, status: "solved" },
    orderBy: { startedAt: "desc" },
    select: {
      id: true, projectId: true, cases: true, modelHash: true, solvedAt: true, activeDofs: true,
    },
  });
  if (!run) {
    throw new AppError(409, "No hay resultados de análisis. Analiza el modelo primero.", {
      error: "analysis.none",
    });
  }

  const state = freshness({
    runHash: run.modelHash,
    currentHash: run.modelHash ? await currentModelHash(projectId) : null,
  });
  if (!state.fresh) {
    throw new AppError(409, STALE_MESSAGES[state.reason], { error: state.reason });
  }

  // Solo lo del nudo y sus vecinos inmediatos viaja: el calc-service no necesita el
  // edificio entero para describir un nudo.
  const elements = await prisma.modelElement.findMany({
    where: { projectId, OR: [{ nodeA: nodeId }, { nodeB: nodeId }] },
    orderBy: { seq: "asc" },
    select: { id: true, nodeA: true, nodeB: true, frameSectionId: true, roll: true, releases: true },
  });
  const neighbourIds = new Set([nodeId]);
  for (const e of elements) {
    neighbourIds.add(e.nodeA);
    neighbourIds.add(e.nodeB);
  }

  const [design, supports, areas, loads, configuration] = await Promise.all([
    assembleDesignModel(projectId),
    prisma.modelSupport.findMany({
      where: { projectId, nodeId },
      select: { nodeId: true, dx: true, dy: true, dz: true, rx: true, ry: true, rz: true },
    }),
    prisma.modelArea.findMany({ where: { projectId }, select: { id: true, nodeIds: true } }),
    prisma.modelLoad.findMany({
      where: { projectId, nodeId },
      select: {
        nodeId: true, loadPattern: true, fx: true, fy: true, fz: true, mx: true, my: true, mz: true,
      },
    }),
    prisma.modelConfiguration.findUnique({
      where: { projectId },
      select: { loadCombinations: true },
    }),
  ]);

  // Las áreas necesitan las coordenadas de sus esquinas (¿el nudo cae en una losa?).
  const areaNodeIds = new Set(areas.flatMap((a) => a.nodeIds || []));
  const usedNodeIds = new Set([...neighbourIds, ...areaNodeIds]);
  const nodes = design.nodes.filter((n) => usedNodeIds.has(n.id));

  const request = buildInspectRequest({
    nodeId,
    run,
    design: { ...design, nodes },
    elements,
    supports,
    areas,
    loads,
    combinations: configuration?.loadCombinations || [],
    bucket: env.s3Bucket,
    prefix: env.s3Prefix,
  });

  let data;
  try {
    ({ data } = await axios.post(`${env.calcServiceUrl}/connections/inspect`, request, {
      timeout: 60000,
    }));
  } catch (err) {
    throw fromCalcError(err);
  }

  return {
    ...data,
    analysis: { runId: run.id, solvedAt: run.solvedAt, freshness: state.basis },
  };
}

// ─── F2: conexiones guardadas ─────────────────────────────────────────────────────

const WITH_MEMBERS = {
  members: { select: { elementId: true, end: true, role: true }, orderBy: { role: "asc" } }, // supported antes que supporting
};

const connectionToApi = (row, orphan = []) => ({
  ...toApi(row, "connection"),
  members: row.members || [],
  orphaned: orphan.length > 0,
  orphanReasons: orphan,
});

/** Nudos y barras del modelo ACTUAL, para saber qué conexiones quedaron huérfanas. */
async function modelIndex(projectId) {
  const [nodes, elements] = await Promise.all([
    prisma.modelNode.findMany({ where: { projectId }, select: { id: true } }),
    prisma.modelElement.findMany({
      where: { projectId },
      select: { id: true, nodeA: true, nodeB: true },
    }),
  ]);
  return {
    nodeIds: new Set(nodes.map((n) => n.id)),
    elementsById: new Map(elements.map((e) => [e.id, e])),
  };
}

async function list(project, { nodeId } = {}) {
  const rows = await prisma.connection.findMany({
    where: { projectId: project.id, ...(nodeId ? { nodeId } : {}) },
    orderBy: { createdAt: "asc" },
    include: WITH_MEMBERS,
  });
  if (rows.length === 0) return [];
  const model = await modelIndex(project.id);
  return rows.map((row) => connectionToApi(row, orphanReasons(row, model)));
}

async function findOwned(project, connectionId) {
  if (!isUuid(connectionId)) throw new AppError(404, "Conexión no encontrada");
  const row = await prisma.connection.findFirst({
    where: { id: connectionId, projectId: project.id },
    include: WITH_MEMBERS,
  });
  if (!row) throw new AppError(404, "Conexión no encontrada");
  return row;
}

async function getOne(project, connectionId) {
  const row = await findOwned(project, connectionId);
  return connectionToApi(row, orphanReasons(row, await modelIndex(project.id)));
}

/**
 * Crea la conexión de UN extremo de barra. Exige un análisis vigente (la inspección lo
 * comprueba) y que el MOTOR diga que la tipología aplica: el servidor no se fía de que
 * el cliente solo ofrezca el botón cuando toca.
 */
async function create(project, { nodeId, elementId, typology, name }) {
  const inspection = await inspect(project, nodeId);
  const picked = membersFromInspection(inspection, elementId, typology);
  if (!picked.ok) {
    throw new AppError(422, "Esta tipología no aplica a esa barra en ese nudo.", {
      error: "typology.notApplicable",
      reasons: picked.reasons,
    });
  }
  const row = await prisma.connection.create({
    data: {
      projectId: project.id,
      nodeId,
      supportedElementId: elementId,
      name: name || `ST-${nodeId}-${elementId}`,
      typology,
      paramsVersion: 1,
      params: {},
      members: { create: picked.members },
    },
    include: WITH_MEMBERS,
  });
  return connectionToApi(row);
}

/** Valida los parámetros contra la tipología y su versión; el material, contra el
 *  catálogo del dueño del proyecto. */
async function validateParams(project, connection, params) {
  const schema = PARAMS_SCHEMAS[connection.typology]?.[connection.paramsVersion];
  if (!schema) {
    throw new AppError(422, "Tipología o versión de parámetros desconocida.");
  }
  const parsed = schema.safeParse(params);
  if (!parsed.success) {
    throw new AppError(400, "Parámetros no válidos.", {
      error: "ValidationError",
      details: parsed.error.flatten(),
    });
  }
  const materialId = parsed.data.plate?.materialId;
  if (materialId) {
    const material = await prisma.catalogMaterial.findFirst({
      where: { id: materialId, ownerId: project.ownerId },
      select: { id: true },
    });
    if (!material) throw new AppError(422, "El material de la placa no existe en tu catálogo.");
  }
  return parsed.data;
}

async function update(project, connectionId, { name, params }) {
  const row = await findOwned(project, connectionId);
  const data = {};
  if (name !== undefined) data.name = name;
  if (params !== undefined) {
    data.params = await validateParams(project, row, params);
    // Cambiar la conexión invalida su última comprobación.
    data.status = "draft";
  }
  const updated = await prisma.connection.update({
    where: { id: row.id },
    data,
    include: WITH_MEMBERS,
  });
  return connectionToApi(updated, orphanReasons(updated, await modelIndex(project.id)));
}

async function remove(project, connectionId) {
  const row = await findOwned(project, connectionId);
  await prisma.connection.delete({ where: { id: row.id } });
  return { deleted: true };
}

module.exports = { inspect, list, getOne, create, update, remove };
