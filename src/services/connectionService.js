const axios = require("axios");
const { Prisma } = require("@prisma/client");
const { prisma } = require("../config/db");
const { env } = require("../config/env");
const {
  buildInspectRequest,
  membersFromInspection,
  plateMaterialId,
  orphanReasons,
  buildCheckRequest,
  buildLayoutRequest,
  connectionMaterialIds,
  checkInputsHash,
  runInputs,
  runSummary,
  buildCbfemRequest,
  cbfemRunInputs,
  cbfemInputsHash,
  femRunSummary,
} = require("../lib/connections");
const { isUuid, toApi } = require("../lib/ids");
const { PARAMS_SCHEMAS, DEFAULT_CODE } = require("../schemas/connectionSchema");
const { freshness, STALE_MESSAGES } = require("../lib/analysisFreshness");
const { AppError } = require("../middleware/errorHandler");
const { fromCalcError, connectionMesh } = require("./calcService");
const femJob = require("./connectionFemJob");
const { mergePreferences } = require("../lib/designPreferences");
const s3Service = require("./s3Service");
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
// `f1` es el factor de la carga viva en la combinación automática de Vgravity (AISC 358
// §2.4.3): lo lleva la conexión en demand.f1; por defecto 0,5.
async function jointRequest(project, nodeId, { f1 } = {}) {
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

  // Viajan TODAS las barras (ids, nudos, sección): el motor describe el nudo con las que
  // llegan a él, pero para la luz física de una viga partida en tramos (apoyos de
  // correas) tiene que seguir la cadena colineal hasta la columna siguiente, que no es
  // vecina del nudo. Las fuerzas solo se leen para las barras del nudo.
  const elements = await prisma.modelElement.findMany({
    where: { projectId },
    orderBy: { seq: "asc" },
    select: {
      id: true, nodeA: true, nodeB: true, frameSectionId: true, roll: true, releases: true,
      lateralSystem: true,
    },
  });

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
      select: { loadCombinations: true, designPreferences: true, lateralSystems: true, loadPatterns: true },
    }),
  ]);

  // Con todas las barras van todos los nudos (la cadena de la luz y las esquinas de las
  // losas los necesitan).
  const nodes = design.nodes;

  const request = buildInspectRequest({
    nodeId,
    run,
    design: { ...design, nodes },
    elements,
    supports,
    areas,
    loads,
    combinations: configuration?.loadCombinations || [],
    lateralSystems: configuration?.lateralSystems || [],
    bucket: env.s3Bucket,
    prefix: env.s3Prefix,
    loadPatterns: configuration?.loadPatterns || [],
    f1,
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
  // La última comprobación AISC: es la que da el estado de la conexión. Las ejecuciones
  // CBFEM (Fase 3) no comprueban nada y van por su lado (`fem*`).
  runs: {
    where: { engine: "aisc" },
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
const NAME_PREFIX = { shear_tab: "ST", double_angle: "DA", extended_end_plate: "EP" };

async function create(project, { nodeId, elementId, typology, name, code, configuration }) {
  const inspection = await inspect(project, nodeId);
  const picked = membersFromInspection(inspection, elementId, typology, configuration);
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
      name: name || `${NAME_PREFIX[typology] || "C"}-${nodeId}-${elementId}`,
      typology,
      code: code || DEFAULT_CODE,
      paramsVersion: 1,
      params: configuration ? { configuration } : {},
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
  await assertMaterials(project, connectionMaterialIds(parsed.data, null));
  return parsed.data;
}

/** Cada material citado (placa, refuerzos, placas de las operaciones) existe en el
 *  catálogo del dueño del proyecto. */
async function assertMaterials(project, ids) {
  if (!ids.length) return;
  const found = await prisma.catalogMaterial.findMany({
    where: { id: { in: ids }, ownerId: project.ownerId },
    select: { id: true },
  });
  if (found.length !== ids.length) {
    throw new AppError(422, "Un material de la conexión no existe en tu catálogo.", {
      error: "connection.materialNotFound",
      missing: ids.filter((id) => !found.some((m) => m.id === id)),
    });
  }
}

/**
 * Operaciones → layout en el calc-service. Para la vista previa y para validar unas
 * operaciones antes de guardarlas: el motor es quien las ejecuta, así que es quien dice
 * si valen. Necesita el modelo del nudo, que se arma igual que para la inspección.
 */
async function computeLayout(project, row, { params, operations } = {}) {
  const { request: inspectRequest } = await jointRequest(project, row.nodeId);
  const request = buildLayoutRequest({ inspectRequest, connection: row, params, operations });
  try {
    const { data } = await axios.post(`${env.calcServiceUrl}/connections/layout`, request, {
      timeout: 60000,
    });
    return data;
  } catch (err) {
    throw fromCalcError(err);
  }
}

/** Vista previa de la geometría con parámetros u operaciones sin guardar (o lo guardado). */
async function layout(project, connectionId, { params, operations } = {}) {
  const row = await findOwned(project, connectionId);
  let checkedParams;
  if (params !== undefined) {
    const schema = PARAMS_SCHEMAS[row.typology]?.[row.paramsVersion];
    const parsed = schema ? schema.safeParse(params) : { success: false };
    if (!parsed.success) {
      throw new AppError(400, "Parámetros no válidos.", {
        error: "ValidationError",
        details: parsed.error?.flatten?.(),
      });
    }
    checkedParams = parsed.data;
  }
  return computeLayout(project, row, { params: checkedParams, operations });
}

async function update(project, connectionId, { name, params, code, operations }) {
  const row = await findOwned(project, connectionId);
  const data = {};
  if (operations !== undefined) {
    if (operations === null) {
      // Volver a la plantilla: las operaciones las escribe otra vez la tipología.
      data.operations = Prisma.DbNull;
    } else {
      await assertMaterials(project, connectionMaterialIds(null, operations));
      // Solo se guarda lo que el motor sabe ejecutar: una lista que rechaza es un 422
      // con su motivo, nunca una conexión guardada que luego no se puede dibujar.
      const result = await computeLayout(project, row, { operations });
      if (result.status === "invalid") {
        throw new AppError(422, "Las operaciones no son válidas.", {
          error: "operations.invalid",
          errors: result.errors || [],
        });
      }
      data.operations = operations;
    }
    data.status = "draft";
  }
  if (name !== undefined) data.name = name;
  if (code !== undefined && code !== row.code) {
    data.code = code;
    // Otra edición es otra comprobación: la última deja de valer.
    data.status = "draft";
  }
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

  const f1 = Number(row.params?.demand?.f1);
  const { run, request: inspectRequest, designPreferences } = await jointRequest(
    project,
    row.nodeId,
    { f1: Number.isFinite(f1) && f1 > 0 ? f1 : undefined }
  );

  const materialId = plateMaterialId(row.params);
  const plateMaterial = materialId
    ? await prisma.catalogMaterial.findFirst({
        where: { id: materialId, ownerId: project.ownerId },
        select: { id: true, name: true, Fy: true, Fu: true, E: true },
      })
    : null;

  const doublerMaterialId = row.params?.doublerPlate?.materialId;
  const doublerMaterial = doublerMaterialId
    ? await prisma.catalogMaterial.findFirst({
        where: { id: doublerMaterialId, ownerId: project.ownerId },
        select: { id: true, name: true, Fy: true, Fu: true, E: true },
      })
    : null;

  const request = buildCheckRequest({
    inspectRequest,
    connection: row,
    plateMaterial,
    doublerMaterial,
    comboNames: designPreferences.comboNames || [],
    omega0: designPreferences.seismic?.omega0,
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
    where: { connectionId: row.id, engine: "aisc" },
    orderBy: { createdAt: "desc" },
  });
  if (!runRow) throw new AppError(404, "Esta conexión todavía no se ha comprobado.");
  const [solvedId, loadsHash] = await Promise.all([latestSolvedRunId(project.id), currentLoadsHash(project.id)]);
  return {
    ...runToApi(runRow),
    summary: runSummary(runRow, { latestSolvedRunId: solvedId, connectionStatus: row.status, currentLoadsHash: loadsHash }),
  };
}

// ─── Fase 3: elementos finitos (CBFEM) ────────────────────────────────────────────

/** Materiales del catálogo que cita la conexión (placa, refuerzos, placas de operaciones). */
async function catalogMaterialsOf(project, row) {
  const ids = connectionMaterialIds(row.params, row.operations);
  if (!ids.length) return [];
  return prisma.catalogMaterial.findMany({
    where: { id: { in: ids }, ownerId: project.ownerId },
    select: { id: true, name: true, Fy: true, Fu: true, E: true },
  });
}

/** Vista previa de la malla CBFEM con lo guardado o con lo que se está editando. */
async function mesh(project, connectionId, { params, operations } = {}) {
  const row = await findOwned(project, connectionId);
  const { request: inspectRequest } = await jointRequest(project, row.nodeId);
  const request = buildLayoutRequest({ inspectRequest, connection: row, params, operations });
  return connectionMesh(request);
}

/**
 * Lanza el análisis CBFEM de la conexión guardada con el análisis vigente (las mismas
 * fuerzas por combinación que el check). 409 si la conexión quedó huérfana, si el
 * análisis no es del modelo actual o si ya hay uno en curso.
 */
async function femStart(
  project,
  connectionId,
  {
    analysis = "nonlinear",
    forcesAt = "node",
    stiffness = false,
    capacity = null,
    combinationsMode = "governing",
    geometricNonlinear = true,
  } = {}
) {
  const row = await findOwned(project, connectionId);
  const orphan = orphanReasons(row, await modelIndex(project.id));
  if (orphan.length) {
    throw new AppError(409, "La conexión ya no corresponde al modelo (nudo o barra cambiados).", {
      error: "connection.orphaned",
      reasons: orphan,
    });
  }
  const { run, request: inspectRequest, designPreferences } = await jointRequest(project, row.nodeId);
  const [plateMaterial, doublerMaterial] = await Promise.all(
    [plateMaterialId(row.params), row.params?.doublerPlate?.materialId].map((id) =>
      id
        ? prisma.catalogMaterial.findFirst({
            where: { id, ownerId: project.ownerId },
            select: { id: true, name: true, Fy: true, Fu: true, E: true },
          })
        : null
    )
  );
  const checkRequest = buildCheckRequest({
    inspectRequest,
    connection: row,
    plateMaterial,
    doublerMaterial,
    comboNames: designPreferences.comboNames || [],
    omega0: designPreferences.seismic?.omega0,
  });
  const prefs = mergePreferences(designPreferences, null);
  const request = buildCbfemRequest({
    checkRequest,
    catalogMaterials: await catalogMaterialsOf(project, row),
    analysis,
    forcesAt,
    stiffness,
    capacity,
    combinationsMode,
    geometricNonlinear,
    criteria: {
      plasticStrainLimit: prefs.cbfem.plasticStrainLimit,
      bucklingFactorLimit: prefs.cbfem.bucklingFactorLimit,
    },
  });
  const created = await femJob.start({
    projectId: project.id,
    connectionId: row.id,
    analysisRunId: run.id,
    analysis,
    request,
    inputs: cbfemRunInputs(request),
    inputsHash: cbfemInputsHash(request),
    code: row.code,
    method: row.method,
  });
  return femRunSummary(created, { latestSolvedRunId: run.id, connectionUpdatedAt: row.updatedAt });
}

/** La última ejecución CBFEM (en curso o terminada), o null. */
async function femLatest(project, connectionId) {
  const row = await findOwned(project, connectionId);
  let runRow = await prisma.connectionRun.findFirst({
    where: { connectionId: row.id, engine: "cbfem" },
    orderBy: { createdAt: "desc" },
  });
  runRow = await femJob.settleIfOrphaned(runRow);
  const solvedId = await latestSolvedRunId(project.id);
  return femRunSummary(runRow, { latestSolvedRunId: solvedId, connectionUpdatedAt: row.updatedAt });
}

/** El criterio CBFEM vigente del proyecto (el que usará el próximo análisis). */
async function femCriteria(project) {
  const configuration = await prisma.modelConfiguration.findUnique({
    where: { projectId: project.id },
    select: { designPreferences: true },
  });
  return mergePreferences(configuration?.designPreferences || {}, null).cbfem;
}

function femCancel(project, connectionId) {
  return { cancelled: femJob.cancel(connectionId) };
}

/**
 * URLs firmadas de la malla y de los campos de las combinaciones pedidas de una
 * ejecución CBFEM. `combinations` vacío = la que gobierna.
 */
async function femFiles(project, connectionId, runId, { combinations = [] } = {}) {
  const row = await findOwned(project, connectionId);
  const runRow = await prisma.connectionRun.findFirst({
    where: { id: runId, connectionId: row.id, engine: "cbfem" },
  });
  if (!runRow) throw new AppError(404, "Esa ejecución no existe.");
  const files = runRow.files || {};
  if (!runRow.s3Prefix || !files.mesh) {
    throw new AppError(409, "Esa ejecución no tiene resultados guardados.", { error: "connection.femNoFiles" });
  }
  const wanted = combinations.length ? combinations : [runRow.results?.governing].filter(Boolean);
  const paths = { mesh: files.mesh };
  for (const name of wanted) {
    const path = files.fields?.[name];
    if (path) paths[`fields:${name}`] = path;
  }
  return s3Service.signRunPaths(project.id, runRow.id, paths);
}

module.exports = {
  inspect, list, getOne, create, update, remove, check, latestRun, layout,
  mesh, femStart, femLatest, femCancel, femFiles, femCriteria,
};
