const { prisma } = require("../config/db");
const { isUuid, toApi } = require("../lib/ids");
const { AppError } = require("../middleware/errorHandler");
const designJob = require("./designJob");
const s3Service = require("./s3Service");
const { getShape } = require("../lib/aiscShapes");
const { freshness, STALE_MESSAGES } = require("../lib/analysisFreshness");
const { currentModelHash, runStaleReason } = require("./analysisService");
const { designInputsHash } = require("../lib/designInputs");

// La comprobación por normativa (sección Design).
//
// EL HUECO QUE CIERRA ESTE MÓDULO. `analysisService.assembleModel` manda al solver los
// materiales como { id, E, G, density } y las secciones como { id, materialId, A, Iy,
// Iz, J }: exactamente lo que MYSTRAN necesita y nada más. Todo lo que hace falta para
// COMPROBAR —f'c, Fy, el armado, las cotas de la sección— se queda en la base. Aquí se
// arma un payload distinto que sí lo lleva.
//
// Se hace en una función aparte en vez de ampliar `assembleModel` a propósito: el
// payload del solver está probado y en producción, y engordarlo con datos que el
// solver ignora solo añade formas de romperlo.

const RUN_SELECT = Object.fromEntries(
  [
    "id", "status", "startedAt", "finishedAt", "durationMs", "error", "code",
    "steelCode", "combos", "files", "counts", "notes", "bytes", "summary",
    "schemaVersion", "analysisRunId",
  ].map((field) => [field, true])
);
const runToApi = (row) => (row ? toApi(row, "designRun") : row);

// Cotas paramétricas que el motor necesita para reconstruir la sección. Es el mismo
// superconjunto que `SectionDims` en el frontend; cada forma usa las suyas.
const DIM_FIELDS = [
  "b", "h", "d", "t", "tw", "tf", "bf", "bfTop", "tfTop", "bfBot", "tfBot",
];

// Propiedades del perfil AISC que pide el capítulo de acero y que `props` no guarda:
// `props` solo lleva A/I33/I22/J, que es lo que consume el análisis.
const AISC_FIELDS = [
  "type", "A", "d", "bf", "tw", "tf", "OD", "ID", "tdes",
  "I33", "I22", "J", "Cw", "rx", "ry", "Sx", "Sy", "Zx", "Zy",
  // Radio de acuerdo (perfiles EN): kc = tf + r en las conexiones a momento (AISC 358).
  "r",
];

function pick(source, fields) {
  const out = {};
  for (const field of fields) {
    const value = source?.[field];
    if (value !== undefined && value !== null) out[field] = value;
  }
  return out;
}

/**
 * El modelo con lo que el diseño necesita y el análisis no manda.
 *
 * Solo viajan las barras con sección asignada: una barra sin sección no se analizó, así
 * que tampoco tiene esfuerzos que comprobar.
 */
async function assembleDesignModel(projectId) {
  const [nodes, elements] = await Promise.all([
    prisma.modelNode.findMany({
      where: { projectId },
      orderBy: { seq: "asc" },
      select: { id: true, x: true, y: true, z: true },
    }),
    prisma.modelElement.findMany({
      where: { projectId },
      orderBy: { seq: "asc" },
      select: { id: true, nodeA: true, nodeB: true, frameSectionId: true },
    }),
  ]);

  const assigned = elements.filter((e) => isUuid(e.frameSectionId));
  const sectionIds = [...new Set(assigned.map((e) => e.frameSectionId))];
  const catSections = sectionIds.length
    ? await prisma.catalogFrameSection.findMany({ where: { id: { in: sectionIds } } })
    : [];

  // Materiales: el de la sección MÁS el del armado, que cuelga del `reinforcement` y
  // que el análisis nunca mira porque no aporta rigidez.
  const materialIds = new Set();
  for (const section of catSections) {
    if (isUuid(section.materialId)) materialIds.add(section.materialId);
    const rebarId = section.reinforcement?.rebarMaterialId;
    if (isUuid(rebarId)) materialIds.add(rebarId);
  }
  const catMaterials = materialIds.size
    ? await prisma.catalogMaterial.findMany({ where: { id: { in: [...materialIds] } } })
    : [];

  const materials = catMaterials.map((m) => ({
    id: m.id,
    name: m.name,
    type: m.type,
    E: m.E,
    nu: m.nu,
    density: m.density ?? 0,
    // Diseño — hormigón
    fc: m.fc ?? null,
    fcExpected: m.fcExpected ?? null,
    lightweight: m.lightweight ?? false,
    lambda: m.lambda ?? null,
    // Diseño — acero y armadura
    Fy: m.Fy ?? null,
    Fu: m.Fu ?? null,
    Fye: m.Fye ?? null,
    Fue: m.Fue ?? null,
  }));

  const sections = catSections.map((s) => {
    const out = {
      id: s.id,
      name: s.name,
      materialId: s.materialId,
      propertyType: s.propertyType,
      source: s.source,
      shape: s.shape ?? null,
      catalogLabel: s.catalogLabel ?? null,
      props: s.props ?? {},
      modifiers: s.modifiers ?? {},
      reinforcement: s.reinforcement ?? null,
      ...pick(s, DIM_FIELDS),
    };
    if (s.source === "catalog" && s.catalogLabel) {
      // Los catálogos (AISC y EN) ya están en SI (m, m², m⁴): se adjunta tal cual, sin convertir.
      const shape = getShape(s.catalogLabel);
      if (shape) {
        out.aisc = pick(shape, AISC_FIELDS);
        // Perfiles de otros catálogos (IPE/HEA/HEB/HEM) viajan con su familia AISC
        // equivalente: el motor de diseño elige las comprobaciones por `type`.
        if (shape.aiscType) {
          out.aisc.type = shape.aiscType;
          out.aisc.family = shape.type;
        }
      }
    }
    return out;
  });

  return {
    nodes: nodes.map((n) => ({ id: n.id, x: n.x, y: n.y, z: n.z ?? 0 })),
    elements: assigned.map((e) => ({
      id: e.id,
      nodeA: e.nodeA,
      nodeB: e.nodeB,
      sectionId: String(e.frameSectionId),
    })),
    sections,
    materials,
  };
}

const DEFAULT_PREFERENCES = {
  code: "ACI318-19",
  steelCode: "AISC360-16",
  comboNames: [],
  overrides: [],
};

/**
 * Preferencias efectivas: las que manda la petición, si no las guardadas, si no las por
 * defecto. Las de la petición se persisten, para que volver a la sección Design
 * encuentre la última elección del usuario.
 */
async function resolvePreferences(projectId, requested) {
  const configuration = await prisma.modelConfiguration.findUnique({
    where: { projectId },
    select: { designPreferences: true, loadCombinations: true },
  });
  const stored = configuration?.designPreferences || {};
  const preferences = {
    ...DEFAULT_PREFERENCES,
    ...stored,
    ...(requested || {}),
  };
  if (requested) {
    await prisma.modelConfiguration.upsert({
      where: { projectId },
      create: { projectId, designPreferences: preferences },
      update: { designPreferences: preferences },
    });
  }
  return {
    preferences,
    combinations: configuration?.loadCombinations || [],
  };
}

/** Lanza la comprobación y responde 202; el progreso se consulta con GET. */
async function run(project, options) {
  const projectId = project.id;

  // El análisis que aporta los esfuerzos: siempre el más reciente que resolvió. Si no
  // hay ninguno no hay nada que comprobar, y decirlo aquí es mejor que dejar que el
  // job falle a los dos segundos.
  const analysisRun = await prisma.analysisRun.findFirst({
    where: { projectId, status: "solved" },
    orderBy: { startedAt: "desc" },
    select: { id: true, cases: true, modelHash: true },
  });
  if (!analysisRun) {
    throw new AppError(
      409,
      "No hay resultados de análisis que comprobar. Lanza primero el análisis."
    );
  }

  // Los esfuerzos tienen que ser de ESTE modelo: comprobar barras con los de un modelo
  // que ya cambió daría ratios de otra estructura.
  const state = freshness({
    runHash: analysisRun.modelHash,
    currentHash: analysisRun.modelHash ? await currentModelHash(projectId) : null,
  });
  if (!state.fresh) {
    throw new AppError(409, STALE_MESSAGES[state.reason], { error: state.reason });
  }

  const { preferences, combinations } = await resolvePreferences(
    projectId,
    options
  );
  if (combinations.length === 0) {
    throw new AppError(
      409,
      "El proyecto no tiene combinaciones de carga. Defínelas antes de comprobar."
    );
  }

  const model = await assembleDesignModel(projectId);
  if (model.elements.length === 0) {
    throw new AppError(
      409,
      "Ninguna barra tiene sección asignada: no hay nada que comprobar."
    );
  }

  await designJob.start(projectId, {
    analysisRunId: analysisRun.id,
    inputsHash: designInputsHash(combinations, preferences),
    cases: analysisRun.cases.map((c) => ({ name: c.name, key: c.key, kind: c.kind })),
    model,
    combinations: combinations.map((c) => ({
      name: c.name,
      factors: (c.factors || []).map((f) => ({
        factor: f.factor,
        pattern: f.pattern ?? null,
        seismic: !!f.seismic,
      })),
    })),
    preferences,
  });

  return { status: "designing", progress: { step: "preparing" } };
}

// Una ejecución cuyo progreso lleva parado este tiempo está huérfana: el servidor se
// reinició con el job en vuelo. Igual que en análisis, pero más corto: comprobar no
// tarda minutos.
const STALE_MS = 2 * 60 * 1000;

const latestRun = (projectId) =>
  prisma.designRun
    .findFirst({
      where: { projectId, status: "done" },
      orderBy: { startedAt: "desc" },
      select: RUN_SELECT,
    })
    .then(runToApi);

/** Estado actual + progreso + metadatos de la última comprobación terminada. */
async function get(projectId) {
  const [project, run, inFlight] = await Promise.all([
    prisma.project.findUnique({
      where: { id: projectId },
      select: { designProgress: true, designError: true },
    }),
    latestRun(projectId),
    prisma.designRun.findFirst({
      where: { projectId, status: "designing" },
      orderBy: { startedAt: "desc" },
      select: { id: true, startedAt: true },
    }),
  ]);
  if (!project) return { status: null, progress: null, error: null, run: null };

  const progress = project.designProgress || null;
  const running = designJob.isRunning(projectId);

  if (inFlight && !running) {
    const stale =
      !progress ||
      !progress.updatedAt ||
      Date.now() - new Date(progress.updatedAt).getTime() > STALE_MS;
    if (stale) {
      const message =
        "La comprobación se interrumpió (el servidor se reinició). Vuelve a lanzarla.";
      await designJob.settleFailure(projectId, inFlight.id, message).catch(() => {});
      return { status: run ? "done" : "idle", progress: null, error: message, run: run || null };
    }
  }

  // Una comprobación hecha sobre un análisis que ya no es del modelo actual (o de la
  // convención de ejes anterior) no se enseña como vigente: sus ratios son de otra
  // estructura. La interfaz la marca y pide volver a analizar.
  if (run && !(running || inFlight)) {
    run.staleReason = await runStaleReason(projectId, run.analysisRunId);
  }

  return {
    status: running || inFlight ? "designing" : run ? "done" : "idle",
    progress: running ? progress : null,
    error: project.designError || null,
    run: run || null,
  };
}

/** Historial de comprobaciones, de la más reciente a la más antigua. */
async function listRuns(projectId) {
  const rows = await prisma.designRun.findMany({
    where: { projectId },
    orderBy: { startedAt: "desc" },
    select: RUN_SELECT,
  });
  return rows.map(runToApi);
}

/**
 * URL prefirmadas de las tablas de una comprobación.
 *
 * Se firman TODAS de una vez, al revés que en análisis (que firma por caso de carga):
 * aquí son cinco archivos pequeños y la sección Design los necesita juntos para pintar
 * la primera pantalla — el color del 3D sale de `members` y el panel del elemento, de
 * `criteria` y `interaction`.
 */
async function signRun(projectId, runId) {
  if (!isUuid(runId)) {
    throw new AppError(404, "Comprobación no encontrada");
  }
  const run = await prisma.designRun.findFirst({
    where: { id: runId, projectId },
    select: { status: true, files: true },
  });
  if (!run || run.status !== "done") {
    throw new AppError(404, "Comprobación no encontrada");
  }
  return {
    expiresIn: require("../config/env").env.s3UrlTtlS,
    urls: await s3Service.signRunPaths(projectId, runId, run.files || {}),
  };
}

function cancel(projectId) {
  return designJob.cancel(projectId);
}

module.exports = {
  run,
  get,
  cancel,
  listRuns,
  signRun,
  assembleDesignModel,
  resolvePreferences,
  DEFAULT_PREFERENCES,
};
