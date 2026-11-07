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
    },
    plateMaterial: materialPayload(plateMaterial),
    // Acero de las placas de refuerzo de la zona de panel; null = el de la placa extrema.
    doublerMaterial: materialPayload(doublerMaterial),
    comboNames: comboNames || [],
  };
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
