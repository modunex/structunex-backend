// Piezas puras de services/connectionService.js, aparte para poder probarlas sin base
// de datos (node --test src/lib/connections.test.js). Por eso no importa lib/ids.js,
// que arrastra @prisma/client: la comprobación de UUID es la misma, en una línea.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v) => typeof v === "string" && UUID_RE.test(v);

// Casos que tienen esfuerzos de barra. Un caso modal no los tiene.
const FORCE_CASE_KINDS = new Set(["pattern", "responseSpectrum"]);

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
  bucket,
  prefix,
}) {
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
    combinations: (combinations || []).map((c) => ({
      name: c.name,
      factors: (c.factors || []).map((f) => ({
        factor: f.factor,
        pattern: f.pattern ?? null,
        seismic: !!f.seismic,
      })),
    })),
  };
}

/**
 * Las barras de una conexión nueva, a partir de la inspección del nudo que devolvió el
 * calc-service. Se decide con la aplicabilidad que calculó el MOTOR (no aquí): si la
 * tipología no aplica, se devuelven sus motivos y no se crea nada.
 *
 * @returns {{ ok: true, members: {elementId, end, role}[] } | { ok: false, reasons: string[] }}
 */
function membersFromInspection(inspection, elementId, typology) {
  const rows = inspection?.joint?.members || [];
  const supported = rows.find((m) => m.elementId === elementId);
  if (!supported) return { ok: false, reasons: ["typology.memberNotAtJoint"] };
  const entry = (supported.typologies || []).find((t) => t.typology === typology);
  if (!entry) return { ok: false, reasons: ["typology.notOffered"] };
  if (!entry.applicable) return { ok: false, reasons: entry.reasons || [] };
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

module.exports = {
  buildInspectRequest,
  membersFromInspection,
  orphanReasons,
  FORCE_CASE_KINDS,
};
