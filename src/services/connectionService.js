const axios = require("axios");
const { prisma } = require("../config/db");
const { env } = require("../config/env");
const { buildInspectRequest, freshness } = require("../lib/connections");
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
    isLocked: !!project.isLocked,
  });
  if (!state.fresh) {
    throw new AppError(
      409,
      "El modelo cambió después del último análisis. Vuelve a analizar para inspeccionar conexiones.",
      { error: state.reason }
    );
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

  const elementIds = elements.map((e) => e.id);
  const [design, supports, areas, loads, frameLoads, configuration] = await Promise.all([
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
    prisma.modelFrameLoad.findMany({
      where: { projectId, elementId: { in: elementIds } },
      select: { elementId: true, loadPattern: true, kind: true, dir: true, value: true, dist: true },
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
    frameLoads,
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

module.exports = { inspect };
