const { prisma, CHILD_MODELS } = require("../models");
const { isUuid, stripChild, toApi } = require("../lib/ids");
const { AppError } = require("../middleware/errorHandler");
const analysisJob = require("./analysisJob");
const s3Service = require("./s3Service");
const spectrumGenerators = require("../lib/spectrumGenerators");

// Lo que se devuelve de una ejecución: metadatos y resumen, nunca el payload. Los
// resultados pesados están en S3 en Parquet y los baja el navegador con una URL
// prefirmada (ver signCase más abajo).
const RUN_SELECT = Object.fromEntries(
  [
    "id", "status", "startedAt", "solvedAt", "durationMs", "error", "activeDofs",
    "notes", "cases", "counts", "modes", "mesh", "modeShapes", "springs", "bytes",
    "summary", "schemaVersion", "stories",
  ].map((field) => [field, true])
);
const runToApi = (row) => (row ? toApi(row, "analysisRun") : row);

const ALL_DOFS = ["UX", "UY", "UZ", "RX", "RY", "RZ"];

// Builds the v2 payload the condition-based engine (POST /analyze) expects. The
// model geometry is read from the project's tables (autosaved by the
// frontend); the *conditions* (activeDofs + load patterns) come from the request.
//
// Materials and sections are not stored per-project: bars reference a
// CatalogFrameSection (which carries its material), so we expand those catalog
// rows into the flat { materials, sections } the engine consumes. Convention
// (SAP): I33 = strong axis -> Iy, I22 = weak -> Iz. Stiffness modifiers applied.
// Bars without an assigned section can't be solved and are omitted. Areas carry
// no stiffness (v1): they pass through only to lump their surface loads to the
// boundary nodes.
async function assembleModel(projectId) {
  // Same order as CHILD_MODELS; each table read in insertion order (`seq`).
  const [
    nodes,
    elements,
    supports,
    loads,
    areas,
    frameLoads,
    areaLoads,
    areaSprings,
  ] = await Promise.all(
    CHILD_MODELS.map(({ name }) =>
      prisma[name]
        .findMany({ where: { projectId }, orderBy: { seq: "asc" } })
        .then((rows) => rows.map((row) => stripChild(row, name)))
    )
  );

  const assigned = elements.filter((e) => isUuid(e.frameSectionId));
  const sectionIds = [...new Set(assigned.map((e) => String(e.frameSectionId)))];

  const catSections = sectionIds.length
    ? await prisma.catalogFrameSection.findMany({ where: { id: { in: sectionIds } } })
    : [];
  const sectionById = new Map(catSections.map((s) => [s.id, s]));

  // Areas reference a CatalogAreaSection (shell: thickness + material). Expand it the
  // same way as frame sections so meshed shells get their stiffness. Areas without a
  // valid section pass through unmeshed (the calc-service lumps their load to corners).
  const areaSectionIds = [
    ...new Set(
      areas
        .map((a) => a.areaSectionId)
        .filter(isUuid)
    ),
  ];
  const catAreaSections = areaSectionIds.length
    ? await prisma.catalogAreaSection.findMany({ where: { id: { in: areaSectionIds } } })
    : [];

  // Materials come from BOTH frame and area sections (union), so shell materials land
  // in the same flat list the engine consumes.
  const materialIds = [
    ...new Set(
      [...catSections, ...catAreaSections]
        .map((s) => s.materialId)
        .filter(isUuid)
    ),
  ];
  const catMaterials = materialIds.length
    ? await prisma.catalogMaterial.findMany({ where: { id: { in: materialIds } } })
    : [];

  // Engine materials: { id, E, G, density }. G derived from E and nu if absent;
  // density (kN/m^3) drives self weight.
  const materials = catMaterials.map((m) => ({
    id: m.id,
    E: m.E,
    G: m.G != null ? m.G : m.E / (2 * (1 + (m.nu != null ? m.nu : 0.3))),
    density: m.density != null ? m.density : 0,
  }));

  // Engine sections: { id, materialId, A, Iy, Iz, J } with modifiers applied.
  const sections = catSections.map((s) => {
    const p = s.props || {};
    const mod = s.modifiers || {};
    return {
      id: s.id,
      materialId: s.materialId,
      A: (p.A || 0) * (mod.area != null ? mod.area : 1),
      Iy: (p.I33 || 0) * (mod.i33 != null ? mod.i33 : 1),
      Iz: (p.I22 || 0) * (mod.i22 != null ? mod.i22 : 1),
      J: (p.J || 0) * (mod.j != null ? mod.j : 1),
    };
  });

  // Engine area sections: { id, materialId, shellType, thicknessMembrane,
  // thicknessBending, modifiers }. Thicknesses are already stored in metres; the
  // calc-service meshes each area into CQUAD4 shells against this section.
  const areaSections = catAreaSections.map((s) => ({
    id: s.id,
    materialId: s.materialId,
    shellType: s.shellType,
    thicknessMembrane: s.thicknessMembrane,
    thicknessBending: s.thicknessBending,
    modifiers: s.modifiers || {},
  }));

  // Bars reference their section by the catalog id (the section carries material).
  const solverElements = assigned
    .filter((e) => sectionById.has(String(e.frameSectionId)))
    .map((e) => ({
      id: e.id,
      nodeA: e.nodeA,
      nodeB: e.nodeB,
      sectionId: String(e.frameSectionId),
      roll: e.roll != null ? e.roll : 0, // section orientation angle (degrees)
      // End releases (SAP2000 "Frame Releases"); omitted => fixed ends.
      ...(e.releases ? { releases: e.releases } : {}),
    }));

  const assignedIds = new Set(solverElements.map((e) => e.id));
  const areaIds = new Set(areas.map((a) => a.id));

  // Guard: hay barras dibujadas pero ninguna llega al solver porque su sección
  // no está asignada o ya no existe en el catálogo (p. ej. tras renombrar/borrar
  // secciones). Sin barras el modelo es un mecanismo → error confuso. Avisamos
  // con un mensaje accionable en vez de dejar que reviente como "inestable".
  if (elements.length > 0 && solverElements.length === 0) {
    throw new AppError(
      422,
      `Ninguna de las ${elements.length} barra(s) tiene una sección válida ` +
        `asignada (o su sección ya no existe en el catálogo). Selecciona las ` +
        `barras y asígnales una sección antes de analizar.`
    );
  }

  return {
    nodes,
    materials,
    sections,
    elements: solverElements,
    supports,
    // Defensa por datos antiguos: el calc-service exige loadPattern en cada carga
    // nodal (y una carga sin patrón no se aplicaría a ningún caso). Descartamos las
    // que no lo tengan para no provocar un 422.
    loads: loads.filter((l) => l.loadPattern),
    // Only loads on bars that made it into the model (have a section).
    frameLoads: frameLoads.filter((fl) => assignedIds.has(fl.elementId)),
    areas,
    areaLoads,
    // Resortes de superficie (balasto). El motor exige stiffness > 0 y un área
    // existente; un resorte huérfano (su área se borró) o con rigidez cero no
    // aporta nada y provocaría un 422, así que se filtra aquí.
    areaSprings: areaSprings.filter(
      (s) => s.stiffness > 0 && areaIds.has(s.areaId)
    ),
    areaSections,
  };
}

// Normalizes the analysisOptions from the request body against the project's
// stored configuration. activeDofs defaults to a full space frame; load patterns
// fall back to the project's Define -> Load Patterns.
async function resolveOptions(projectId, options) {
  const opts = options || {};
  let activeDofs = Array.isArray(opts.activeDofs)
    ? opts.activeDofs.filter((d) => ALL_DOFS.includes(d))
    : [];
  if (activeDofs.length === 0) activeDofs = [...ALL_DOFS];

  // One config read for load patterns + the modal inputs (Mass Source, Modal cases) +
  // the response-spectrum condition. SAP-style single Run: the calc-service also solves
  // modes when modalCases is present, and combines them for each responseSpectrumCase.
  const config = await prisma.modelConfiguration.findUnique({
    where: { projectId },
    select: {
      loadPatterns: true,
      massSource: true,
      modalCases: true,
      spectrumFunctions: true,
      responseSpectrumCases: true,
    },
  });

  let loadPatterns = Array.isArray(opts.loadPatterns) ? opts.loadPatterns : null;
  if (!loadPatterns) loadPatterns = (config && config.loadPatterns) || [];
  loadPatterns = loadPatterns.map((p) => ({
    name: p.name,
    type: p.type || "dead",
    selfWeightMultiplier: p.selfWeightMultiplier != null ? p.selfWeightMultiplier : 0,
  }));

  const massSource = (config && config.massSource) || null;
  const modalCases = (config && config.modalCases) || [];
  const responseSpectrum = buildResponseSpectrum(config);

  return {
    analysisOptions: { activeDofs, loadPatterns },
    massSource,
    modalCases,
    responseSpectrum,
  };
}

// Builds the response-spectrum condition the calc-service consumes: the spectrum
// functions referenced by the cases, SAMPLED here into `{T, accel}` tables (fraction of
// g), plus the cases themselves (pass-through of the stored fields). The frontend never
// generates the curve for the solve — that is this function's job, so the analysis does
// not depend on the client. Returns null when the project defines no RS cases.
//
// A function that fails to sample (bad params, or an R combination COVENIN does not
// define) is dropped, not fatal: the calc-service then notes the case that referenced a
// missing function. A whole run must never fall over one bad spectrum.
function buildResponseSpectrum(config) {
  const cases = (config && config.responseSpectrumCases) || [];
  if (cases.length === 0) return null;

  const byName = new Map();
  for (const fn of (config && config.spectrumFunctions) || []) byName.set(fn.name, fn);

  // Only sample the functions the cases actually reference (dedup by name).
  const referenced = new Set();
  for (const c of cases) {
    for (const load of c.loads || []) if (load.function) referenced.add(load.function);
  }

  const functions = [];
  for (const name of referenced) {
    const fn = byName.get(name);
    if (!fn) continue; // the calc-service notes the missing reference
    try {
      const points = spectrumGenerators.sample(fn);
      if (Array.isArray(points) && points.length >= 2) {
        functions.push({ name: fn.name, damping: fn.damping != null ? fn.damping : 0.05, points });
      }
    } catch (err) {
      console.warn(
        `[analysis] spectrum function '${name}' (${fn.source}) could not be sampled: ${err.message}`
      );
    }
  }

  const outCases = cases.map((c) => ({
    name: c.name,
    modalCase: c.modalCase,
    loads: (c.loads || []).map((l) => ({
      direction: l.direction,
      function: l.function,
      scaleFactor: l.scaleFactor != null ? l.scaleFactor : 1,
    })),
    modalCombination: c.modalCombination || "CQC",
    directionalCombination: c.directionalCombination || "SRSS",
    modalDamping: c.modalDamping != null ? c.modalDamping : 0.05,
    diaphragmEccentricity: c.diaphragmEccentricity != null ? c.diaphragmEccentricity : 0,
  }));

  return { functions, cases: outCases };
}

// Runs the calculation for an already-authorized project (loaded by
// loadProject). `options` is the request body's analysisOptions (the condition).
// The HTTP call to the solver stays outside any transaction.
// Starts the analysis and returns as soon as the job is queued - the solve itself runs
// in the background (analysisJob) and reports progress through the project document.
// Blocking here would be worse than slow: a long solve held open on one HTTP request
// dies with the first proxy timeout or client disconnect along the way.
async function run(project, options) {
  const projectId = project.id;

  // Assemble everything the solver needs BEFORE going async, so a bad model still fails
  // as a normal 4xx on this request instead of surfacing later as a job error.
  const { analysisOptions, massSource, modalCases, responseSpectrum } =
    await resolveOptions(projectId, options);
  const model = await assembleModel(projectId);

  await analysisJob.start(projectId, {
    analysisOptions,
    model,
    massSource,
    modalCases,
    responseSpectrum,
  });

  return {
    status: "solving",
    // The UI localizes its own title from `step`; `message` is only a legacy fallback.
    progress: {
      step: "preparing",
      message: "Preparing model",
    },
  };
}

// A run whose progress stopped moving this long ago is orphaned: the web service was
// restarted (deploy, crash) while the job was in flight.
const STALE_MS = 5 * 60 * 1000;

const latestSolvedRun = (projectId) =>
  prisma.analysisRun
    .findFirst({
      where: { projectId, status: "solved" },
      orderBy: { startedAt: "desc" },
      select: RUN_SELECT,
    })
    .then(runToApi);

// Current analysis state + live progress + metadata of the last solved run.
//
// This used to inline the entire result document, which the frontend polls once a
// second while solving — so every tick re-read and re-serialised megabytes it only
// used on the final tick. Now the response is under a kilobyte and the payload is
// fetched once, straight from S3.
async function get(projectId) {
  const [project, run] = await Promise.all([
    prisma.project.findUnique({
      where: { id: projectId },
      select: { status: true, analysisProgress: true, analysisError: true },
    }),
    latestSolvedRun(projectId),
  ]);
  if (!project) return { status: null, progress: null, error: null, run: null };

  const progress = project.analysisProgress || null;

  // Orphaned run: nothing in this process is driving it any more, so stop reporting
  // "solving" forever and let the user relaunch.
  const stale =
    project.status === "solving" &&
    !analysisJob.isRunning(projectId) &&
    (!progress ||
      !progress.updatedAt ||
      Date.now() - new Date(progress.updatedAt).getTime() > STALE_MS);
  if (stale) {
    const message = "El análisis se interrumpió (el servidor se reinició). Vuelve a lanzarlo.";
    await analysisJob.settleFailure(projectId, message).catch(() => {});
    return {
      status: run ? "solved" : "draft",
      progress: null,
      error: message,
      run: run || null,
    };
  }

  return {
    status: project.status,
    progress,
    error: project.analysisError || null,
    run: run || null,
  };
}

/** Historial de ejecuciones del proyecto, de la más reciente a la más antigua. */
async function listRuns(projectId) {
  const rows = await prisma.analysisRun.findMany({
    where: { projectId },
    orderBy: { startedAt: "desc" },
    select: RUN_SELECT,
  });
  return rows.map(runToApi);
}

/**
 * URL prefirmadas de un caso de carga: sus particiones más la malla, firmadas de una
 * tacada porque el visor las necesita todas juntas para pintar.
 *
 * `caseKey` es la clave que guardó el manifiesto, NO el nombre del patrón: el slug
 * resuelve colisiones con un ordinal, así que el nombre no permite reconstruirla.
 */
async function signCase(projectId, runId, caseKey) {
  if (!isUuid(runId)) {
    throw new AppError(404, "Ejecución no encontrada");
  }
  const run = await prisma.analysisRun.findFirst({
    where: { id: runId, projectId },
    select: { status: true, cases: true, mesh: true, modeShapes: true, springs: true },
  });
  if (!run || run.status !== "solved") {
    throw new AppError(404, "Ejecución no encontrada");
  }

  const entry = run.cases.find((c) => c.key === caseKey);
  if (!entry) {
    throw new AppError(404, `El caso '${caseKey}' no existe en esta ejecución`);
  }

  const paths = { ...entry.files };
  for (const [name, relative] of Object.entries(run.mesh || {})) {
    paths[`mesh_${name}`] = relative;
  }
  if (run.modeShapes) paths.mode_shapes = run.modeShapes;
  if (run.springs) paths.springs = run.springs;

  return {
    case: { name: entry.name, key: entry.key },
    expiresIn: require("../config/env").env.s3UrlTtlS,
    urls: await s3Service.signRunPaths(projectId, runId, paths),
  };
}

// Hangs up on the calc-service; it notices the disconnect and kills MYSTRAN. Previous
// results are left untouched (see analysisJob.settleFailure).
function cancel(projectId) {
  return analysisJob.cancel(projectId);
}

module.exports = { run, get, cancel, listRuns, signCase, assembleModel };
