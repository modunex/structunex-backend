const axios = require("axios");
const { prisma } = require("../config/db");
const { env } = require("../config/env");
const {
  buildInspectRequest,
  membersFromInspection,
  orphanReasons,
  buildCheckRequest,
  checkInputsHash,
  runInputs,
  runSummary,
} = require("../lib/connections");
const { isUuid, toApi } = require("../lib/ids");
const { PARAMS_SCHEMAS } = require("../schemas/connectionSchema");
const { freshness, STALE_MESSAGES } = require("../lib/analysisFreshness");
const { AppError } = require("../middleware/errorHandler");
const { fromCalcError } = require("./calcService");
const { assembleDesignModel } = require("./designService");
const { currentModelHash, runStaleReason } = require("./analysisService");
const { connectionLoadsHash } = require("../lib/designInputs");

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

/**
 * La ejecución vigente y la petición del nudo para el calc-service. La comparten la
 * inspección (F1) y la comprobación (F3): una conexión se comprueba exactamente con las
 * fuerzas que el panel le enseña al usuario.
 */
async function jointRequest(project, nodeId) {
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
      select: { loadCombinations: true, designPreferences: true },
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
  return { run, state, request, designPreferences: configuration?.designPreferences || {} };
}

async function inspect(project, nodeId) {
  const { run, state, request } = await jointRequest(project, nodeId);

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
  runs: {
    orderBy: { createdAt: "desc" },
    take: 1,
    select: {
      id: true, createdAt: true, status: true, results: true, engineVersion: true,
      analysisRunId: true, error: true, inputs: true,
    },
  },
};

const connectionToApi = (row, orphan = [], latestSolvedRunId = null, currentLoadsHash = null) => {
  const { runs, ...rest } = row;
  return {
    ...toApi(rest, "connection"),
    members: row.members || [],
    orphaned: orphan.length > 0,
    orphanReasons: orphan,
    lastRun: runSummary(runs?.[0], { latestSolvedRunId, connectionStatus: row.status, currentLoadsHash }),
  };
};

/**
 * El análisis contra el que una comprobación es vigente: el último resuelto, y solo si es
 * del modelo actual (un cambio de sección o de carga sin reanalizar deja todas las
 * comprobaciones desactualizadas). Con las combinaciones vigentes, para comparar.
 */
async function latestSolvedRunId(projectId) {
  const run = await prisma.analysisRun.findFirst({
    where: { projectId, status: "solved" },
    orderBy: { startedAt: "desc" },
    select: { id: true },
  });
  if (!run || (await runStaleReason(projectId, run.id))) return null;
  return run.id;
}

async function currentLoadsHash(projectId) {
  const configuration = await prisma.modelConfiguration.findUnique({
    where: { projectId },
    select: { loadCombinations: true, designPreferences: true },
  });
  return connectionLoadsHash(configuration?.loadCombinations || [], configuration?.designPreferences?.comboNames || []);
}

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
  const [model, solvedId, loadsHash] = await Promise.all([
    modelIndex(project.id),
    latestSolvedRunId(project.id),
    currentLoadsHash(project.id),
  ]);
  return rows.map((row) => connectionToApi(row, orphanReasons(row, model), solvedId, loadsHash));
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
  const [model, solvedId, loadsHash] = await Promise.all([
    modelIndex(project.id),
    latestSolvedRunId(project.id),
    currentLoadsHash(project.id),
  ]);
  return connectionToApi(row, orphanReasons(row, model), solvedId, loadsHash);
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
  const [model, solvedId, loadsHash] = await Promise.all([
    modelIndex(project.id),
    latestSolvedRunId(project.id),
    currentLoadsHash(project.id),
  ]);
  return connectionToApi(updated, orphanReasons(updated, model), solvedId, loadsHash);
}

async function remove(project, connectionId) {
  const row = await findOwned(project, connectionId);
  await prisma.connection.delete({ where: { id: row.id } });
  return { deleted: true };
}

// ─── F3: comprobación ─────────────────────────────────────────────────────────────

const runToApi = (run) => ({ ...toApi(run, "connectionRun") });

/**
 * Comprueba una conexión con el análisis vigente y guarda la ejecución: entradas, su
 * huella, versión del motor, norma y resultado. Síncrona: es un nudo.
 *
 * 409 si la conexión quedó huérfana o si el análisis no es del modelo actual (las mismas
 * reglas que la inspección). Un dato que falta NO es un error HTTP: el motor responde
 * NO VERIFICABLE con el motivo, y eso también se guarda.
 */
async function check(project, connectionId) {
  const row = await findOwned(project, connectionId);
  const orphan = orphanReasons(row, await modelIndex(project.id));
  if (orphan.length) {
    throw new AppError(409, "La conexión ya no corresponde al modelo (nudo o barra cambiados).", {
      error: "connection.orphaned",
      reasons: orphan,
    });
  }

  const { run, request: inspectRequest, designPreferences } = await jointRequest(
    project,
    row.nodeId
  );

  const materialId = row.params?.plate?.materialId;
  const plateMaterial = materialId
    ? await prisma.catalogMaterial.findFirst({
        where: { id: materialId, ownerId: project.ownerId },
        select: { id: true, name: true, Fy: true, Fu: true, E: true },
      })
    : null;

  const request = buildCheckRequest({
    inspectRequest,
    connection: row,
    plateMaterial,
    comboNames: designPreferences.comboNames || [],
  });
  const inputsHash = checkInputsHash(request);

  let data;
  try {
    ({ data } = await axios.post(`${env.calcServiceUrl}/connections/check`, request, {
      timeout: 60000,
    }));
  } catch (err) {
    const appErr = fromCalcError(err);
    await prisma.connectionRun.create({
      data: {
        connectionId: row.id,
        analysisRunId: run.id,
        status: "error",
        engineVersion: "unknown",
        code: row.code,
        method: row.method,
        inputsHash,
        inputs: runInputs(request, null),
        error: appErr.message,
      },
    });
    throw appErr;
  }

  const saved = await prisma.connectionRun.create({
    data: {
      connectionId: row.id,
      analysisRunId: run.id,
      status: "done",
      engineVersion: data.engineVersion,
      code: data.code,
      method: data.method,
      inputsHash,
      inputs: runInputs(request, data),
      results: data,
    },
  });

  // "checked" solo si nadie cambió la conexión mientras se comprobaba: si cambió, la
  // ejecución es de los parámetros anteriores y la conexión sigue en borrador.
  await prisma.connection.updateMany({
    where: { id: row.id, updatedAt: row.updatedAt },
    data: { status: "checked" },
  });

  return { connection: await getOne(project, row.id), run: runToApi(saved) };
}

/** La última comprobación completa (con todos los estados límite), o 404. */
async function latestRun(project, connectionId) {
  const row = await findOwned(project, connectionId);
  const runRow = await prisma.connectionRun.findFirst({
    where: { connectionId: row.id },
    orderBy: { createdAt: "desc" },
  });
  if (!runRow) throw new AppError(404, "Esta conexión todavía no se ha comprobado.");
  const [solvedId, loadsHash] = await Promise.all([latestSolvedRunId(project.id), currentLoadsHash(project.id)]);
  return {
    ...runToApi(runRow),
    summary: runSummary(runRow, { latestSolvedRunId: solvedId, connectionStatus: row.status, currentLoadsHash: loadsHash }),
  };
}

module.exports = { inspect, list, getOne, create, update, remove, check, latestRun };
