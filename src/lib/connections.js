const { memberLateralSystems } = require("./lateralSystems");
// Piezas puras de services/connectionService.js, aparte para poder probarlas sin base
// de datos (node --test src/lib/connections.test.js). Por eso no importa lib/ids.js,
// que arrastra @prisma/client: la comprobación de UUID es la misma, en una línea.
const crypto = require("node:crypto");
const { stableStringify } = require("./modelHash");
const { connectionLoadsHash } = require("./designInputs");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v) => typeof v === "string" && UUID_RE.test(v);

// Casos que tienen esfuerzos de barra. Un caso modal no los tiene.
const FORCE_CASE_KINDS = new Set(["pattern", "responseSpectrum"]);

// Combinación de gravedad para Vgravity de las conexiones por capacidad (AISC 358
// §2.4.3 / ASCE 7 §2.3.6): 1.2D + f1·L + 0.2S, armada a partir de los patrones del
// modelo por su TIPO. D = dead + superDead; L = live (f1 = 0,5 salvo garajes y uso
// público con L > 100 psf, f1 = 1,0); S = snow. Roof live no entra. Sin patrón de carga
// muerta no se arma (null): el motor lo dice y no inventa nada.
const VGRAVITY_COMBINATION = "__vgravity__";

function vgravityCombination(loadPatterns, f1 = 0.5) {
  const factorByType = { dead: 1.2, superDead: 1.2, live: f1, snow: 0.2 };
  const factors = (loadPatterns || [])
    .filter((p) => p.type in factorByType)
    .map((p) => ({ factor: factorByType[p.type], pattern: p.name, seismic: false }));
  if (!factors.some((f) => f.factor === 1.2)) return null;
  return { name: VGRAVITY_COMBINATION, factors, f1 };
}

/** La petición para el calc-service. Pura: se prueba sin base de datos. */
function buildInspectRequest({
  nodeId,
  run,
  design,
  elements,
  supports,
  areas,
  loads,
  combinations,
  lateralSystems,
  bucket,
  prefix,
  loadPatterns,
  f1,
}) {
  const auto = vgravityCombination(loadPatterns, f1);
  // Sistema resistente de cada barra del nudo que tiene uno DEFINIDO (un nombre que ya no
  // existe en la configuración no cuenta).
  const memberSystems = memberLateralSystems(elements, lateralSystems);
  return {
    source: {
      projectId: String(run.projectId),
      runId: String(run.id),
      bucket: bucket ?? null,
      prefix: prefix ?? null,
      cases: (run.cases || [])
        .filter((c) => FORCE_CASE_KINDS.has(c.kind || "pattern"))
        .map((c) => ({ name: c.name, key: c.key, kind: c.kind || "pattern" })),
    },
    nodeId,
    nodes: design.nodes,
    // TODAS las barras, también las que no tienen sección: el nudo debe decir que una
    // barra llega sin perfil, no omitirla.
    elements: elements.map((e) => ({
      id: e.id,
      nodeA: e.nodeA,
      nodeB: e.nodeB,
      sectionId: isUuid(e.frameSectionId) ? String(e.frameSectionId) : null,
      roll: e.roll ?? 0,
      ...(e.releases ? { releases: e.releases } : {}),
    })),
    sections: design.sections,
    materials: design.materials,
    supports,
    areas,
    loads,
    // GDL con los que se resolvió el run: el equilibrio del nudo solo se mira en ellos.
    activeDofs: run.activeDofs || [],
    combinations: [...(combinations || []), ...(auto ? [auto] : [])].map((c) => ({
      name: c.name,
      factors: (c.factors || []).map((f) => ({
        factor: f.factor,
        pattern: f.pattern ?? null,
        seismic: !!f.seismic,
      })),
    })),
    ...(auto ? { vgravity: { combination: VGRAVITY_COMBINATION, f1: auto.f1 } } : {}),
    lateralSystems: memberSystems,
  };
}

/**
 * Las barras de una conexión nueva, a partir de la inspección del nudo que devolvió el
 * calc-service. Se decide con la aplicabilidad que calculó el MOTOR (no aquí): si la
 * tipología no aplica, se devuelven sus motivos y no se crea nada.
 *
 * @returns {{ ok: true, members: {elementId, end, role}[] } | { ok: false, reasons: string[] }}
 */
function membersFromInspection(inspection, elementId, typology, configuration) {
  const rows = inspection?.joint?.members || [];
  const supported = rows.find((m) => m.elementId === elementId);
  if (!supported) return { ok: false, reasons: ["typology.memberNotAtJoint"] };
  const entry = (supported.typologies || []).find((t) => t.typology === typology);
  if (!entry) return { ok: false, reasons: ["typology.notOffered"] };
  if (!entry.applicable) return { ok: false, reasons: entry.reasons || [] };
  if (configuration !== undefined) {
    const conf = (entry.configurations || []).find((c) => c.id === configuration);
    if (!conf) return { ok: false, reasons: ["typology.configurationUnknown"] };
    if (!conf.applicable) return { ok: false, reasons: conf.reasons || [] };
  }
  const members = [{ elementId, end: supported.end, role: "supported" }];
  for (const id of entry.supporting || []) {
    const row = rows.find((m) => m.elementId === id);
    if (row) members.push({ elementId: id, end: row.end, role: "supporting" });
  }
  return { ok: true, members };
}

/**
 * Por qué una conexión guardada ya no corresponde al modelo: su nudo o alguna de sus
 * barras desaparecieron, o una barra ya no toca el nudo. Lista vacía = vigente.
 * `model` = { nodeIds: Set, elementsById: Map<id, {nodeA, nodeB}> }.
 */
function orphanReasons(connection, model) {
  const reasons = [];
  if (!model.nodeIds.has(connection.nodeId)) reasons.push("connection.nodeMissing");
  for (const m of connection.members || []) {
    const el = model.elementsById.get(m.elementId);
    if (!el) {
      reasons.push(`connection.memberMissing:${m.elementId}`);
      continue;
    }
    const atJoint = m.end === "A" ? el.nodeA : el.nodeB;
    if (atJoint !== connection.nodeId) reasons.push(`connection.memberMoved:${m.elementId}`);
  }
  return reasons;
}

// ─── F3: comprobación ─────────────────────────────────────────────────────────────

/**
 * La petición de /connections/check: la misma del nudo que la inspección (mismas
 * fuerzas que ve el usuario en el panel), más la conexión guardada, el material de la
 * placa y las combinaciones elegidas en Diseño (vacío = todas, como el diseño).
 */
function materialPayload(m) {
  return m ? { id: m.id, name: m.name, Fy: m.Fy ?? null, Fu: m.Fu ?? null, E: m.E ?? null } : null;
}

function buildCheckRequest({ inspectRequest, connection, plateMaterial, doublerMaterial, comboNames, omega0 }) {
  return {
    ...inspectRequest,
    // Ωo para el Pr automático de la columna (AISC 341 D1.4a). 3 si no está en Preferencias.
    omega0: Number.isFinite(Number(omega0)) && Number(omega0) > 1 ? Number(omega0) : 3,
    connection: {
      id: connection.id,
      typology: connection.typology,
      code: connection.code,
      paramsVersion: connection.paramsVersion,
      params: connection.params || {},
      supportedElementId: connection.supportedElementId,
      // null = la plantilla de la tipología; una lista = conexión personalizada.
      operations: connection.operations ?? null,
    },
    plateMaterial: materialPayload(plateMaterial),
    // Acero de las placas de refuerzo de la zona de panel; null = el de la placa extrema.
    doublerMaterial: materialPayload(doublerMaterial),
    comboNames: comboNames || [],
  };
}

/**
 * La petición de /connections/layout: solo la geometría del modelo (sin resultados) y la
 * conexión, con los parámetros u operaciones que se quieren ver (guardados o no).
 */
function buildLayoutRequest({ inspectRequest, connection, params, operations }) {
  const { nodeId, nodes, elements, sections, materials, supports, areas } = inspectRequest;
  return {
    nodeId,
    nodes,
    elements,
    sections,
    materials,
    supports,
    areas,
    connection: {
      id: connection.id,
      typology: connection.typology,
      code: connection.code,
      paramsVersion: connection.paramsVersion,
      params: params ?? connection.params ?? {},
      supportedElementId: connection.supportedElementId,
      operations: operations === undefined ? connection.operations ?? null : operations,
    },
  };
}

// ─── Fase 3: CBFEM ────────────────────────────────────────────────────────────────

const CBFEM_ANALYSES = new Set(["linear", "nonlinear"]);

/**
 * La petición de /connections/cbfem/stream: la misma del check (nudo, fuerzas,
 * conexión, materiales), con los materiales de catálogo que citan las placas añadidos a
 * `materials` (el modelo local los necesita por placa, no solo el de la placa extrema),
 * el tipo de análisis y el destino de los campos.
 */
const CBFEM_FORCES_AT = new Set(["node", "bolts"]);

function buildCbfemRequest({
  checkRequest,
  catalogMaterials = [],
  analysis = "nonlinear",
  forcesAt = "node",
  stiffness = false,
  criteria = null,
  storage = null,
}) {
  if (!CBFEM_ANALYSES.has(analysis)) throw new Error(`análisis CBFEM desconocido: ${analysis}`);
  if (!CBFEM_FORCES_AT.has(forcesAt)) throw new Error(`posición de fuerzas desconocida: ${forcesAt}`);
  const have = new Set((checkRequest.materials || []).map((m) => String(m.id)));
  const extra = catalogMaterials
    .filter((m) => m && !have.has(String(m.id)))
    .map((m) => materialPayload(m));
  return {
    ...checkRequest,
    materials: [...(checkRequest.materials || []), ...extra],
    analysis,
    forcesAt,
    stiffness: Boolean(stiffness),
    ...(criteria ? { criteria } : {}),
    ...(storage ? { storage } : {}),
  };
}

/** Lo que se guarda como entradas de una ejecución CBFEM (sin el destino, que no
 *  cambia el resultado). */
function cbfemRunInputs(request) {
  const { storage, ...rest } = request; // eslint-disable-line no-unused-vars
  return {
    source: rest.source,
    nodeId: rest.nodeId,
    connection: rest.connection,
    analysis: rest.analysis,
    forcesAt: rest.forcesAt,
    stiffness: Boolean(rest.stiffness),
    criteria: rest.criteria ?? null,
    plateMaterial: rest.plateMaterial,
    doublerMaterial: rest.doublerMaterial ?? null,
    comboNames: rest.comboNames,
    combinations: rest.combinations,
  };
}

/** Huella de una ejecución CBFEM: como la del check, sin el destino de los campos. */
function cbfemInputsHash(request) {
  const { storage, ...rest } = request; // eslint-disable-line no-unused-vars
  return checkInputsHash(rest);
}

/** Resumen de una ejecución CBFEM para el panel: estado, avance y, al terminar, lo que
 *  devolvió el motor sin los campos (que van en S3). Nunca un PASS: la Fase 3 no comprueba. */
function femRunSummary(run, { latestSolvedRunId = null, connectionUpdatedAt = null } = {}) {
  if (!run) return null;
  const results = run.results || {};
  const stale =
    (latestSolvedRunId && run.analysisRunId && run.analysisRunId !== latestSolvedRunId) ||
    (connectionUpdatedAt && run.createdAt && new Date(connectionUpdatedAt) > new Date(run.createdAt));
  return {
    id: run.id,
    status: run.status,
    analysis: run.analysisType ?? null,
    progress: run.progress ?? null,
    startedAt: run.startedAt ?? run.createdAt ?? null,
    finishedAt: run.finishedAt ?? null,
    error: run.error ?? null,
    stale: Boolean(stale),
    governing: results.governing ?? null,
    cases: results.cases ?? [],
    messages: results.messages ?? [],
    assumptions: results.assumptions ?? [],
    checks: results.checks ?? null,
    stiffness: results.stiffness ?? [],
    meshStats: results.meshStats ?? null,
    meshRules: results.meshRules ?? null,
    solver: results.solver ?? null,
    inputs: results.inputs ?? null,
    engineVersion: run.engineVersion,
    files: run.files ?? {},
  };
}

/** Los materiales del catálogo que una conexión cita: placa, refuerzos y las placas de
 *  sus operaciones (sin repetir). */
function connectionMaterialIds(params, operations) {
  const ids = new Set();
  if (params?.plate?.materialId) ids.add(params.plate.materialId);
  if (params?.doublerPlate?.materialId) ids.add(params.doublerPlate.materialId);
  for (const op of operations || []) if (op?.materialId) ids.add(op.materialId);
  return [...ids];
}

/** Huella de TODO lo que entra al motor: dos comprobaciones con la misma huella tienen
 *  que dar el mismo resultado con la misma versión del motor. */
function checkInputsHash(request) {
  return crypto.createHash("sha256").update(stableStringify(request)).digest("hex");
}

/**
 * Lo que se guarda como entradas de una ejecución: lo que identifica el cálculo y lo que
 * lo reproduce (fuerzas por combinación, propiedades de barras y materiales tal como las
 * usó el motor), sin copiar el modelo entero en cada fila.
 */
function runInputs(request, result) {
  return {
    source: request.source,
    nodeId: request.nodeId,
    connection: request.connection,
    // La geometría que se comprobó (operaciones → layout, calc-service): su huella basta
    // para identificarla; el layout completo va en los resultados.
    layoutHash: result?.layout?.hash ?? null,
    plateMaterial: request.plateMaterial,
    doublerMaterial: request.doublerMaterial ?? null,
    comboNames: request.comboNames,
    combinations: request.combinations,
    members: result?.members ?? null,
    context: result?.context ?? null,
    demands: result?.demands ?? null,
  };
}

/** Resumen de la última comprobación para listas y badges. `latestSolvedRunId` dice si
 *  se hizo con el análisis vigente; una conexión editada después vuelve a "draft". */
const SYSTEM_CHECK_IDS = ["preq.columnBeamMomentRatio", "preq.panelZone", "preq.panelZoneThickness"];

function runSummary(run, { latestSolvedRunId, connectionStatus, currentLoadsHash = null } = {}) {
  if (!run) return null;
  const results = run.results || {};
  return {
    id: run.id,
    createdAt: run.createdAt,
    status: run.status,
    result: run.status === "done" ? results.status ?? null : null,
    governing: results.governing ?? null,
    engineVersion: run.engineVersion,
    analysisRunId: run.analysisRunId,
    // Vigente: hecha con el análisis vigente (que el llamante solo pasa si es del modelo
    // actual), sin cambios en la conexión y con las mismas combinaciones.
    current:
      run.status === "done" &&
      connectionStatus === "checked" &&
      !!latestSolvedRunId &&
      run.analysisRunId === latestSolvedRunId &&
      (!currentLoadsHash ||
        // La combinación automática de Vgravity la arma el backend en cada petición: no
        // es del proyecto y no cuenta para decidir si las combinaciones cambiaron.
        connectionLoadsHash(
          (run.inputs?.combinations || []).filter((c) => c.name !== VGRAVITY_COMBINATION),
          run.inputs?.comboNames
        ) === currentLoadsHash),
    error: run.error ?? null,
    // Los requisitos del SISTEMA que la conexión verifica en su nudo (AISC 341 E3.4a,
    // E3.6e): los reúne la tabla de nudos SMF de Design sin bajar el resultado entero.
    systemChecks: (results.limitStates || [])
      .filter((ls) => SYSTEM_CHECK_IDS.includes(ls.id))
      .map((ls) => ({ id: ls.id, status: ls.status, ratio: ls.ratio ?? null, ref: ls.ref ?? "" })),
  };
}

module.exports = {
  buildCbfemRequest,
  cbfemRunInputs,
  cbfemInputsHash,
  femRunSummary,
  CBFEM_ANALYSES,
  buildLayoutRequest,
  connectionMaterialIds,
  VGRAVITY_COMBINATION,
  buildInspectRequest,
  membersFromInspection,
  orphanReasons,
  buildCheckRequest,
  checkInputsHash,
  runInputs,
  runSummary,
  FORCE_CASE_KINDS,
};
