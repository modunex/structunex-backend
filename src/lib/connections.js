// Piezas puras de services/connectionService.js, aparte para poder probarlas sin base
// de datos (node --test src/lib/connections.test.js). Por eso no importa lib/ids.js,
// que arrastra @prisma/client: la comprobación de UUID es la misma, en una línea.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v) => typeof v === "string" && UUID_RE.test(v);

// Casos que tienen esfuerzos de barra. Un caso modal no los tiene.
const FORCE_CASE_KINDS = new Set(["pattern", "responseSpectrum"]);

/**
 * ¿Siguen siendo válidos los resultados de `run` para el modelo actual?
 * Con huella, se decide por la huella. Un run antiguo, sin huella, solo vale si el
 * proyecto sigue bloqueado desde aquel análisis (el bloqueo impide editar).
 */
function freshness({ runHash, currentHash, isLocked }) {
  if (runHash) {
    return runHash === currentHash
      ? { fresh: true, basis: "modelHash" }
      : { fresh: false, reason: "analysis.stale" };
  }
  return isLocked
    ? { fresh: true, basis: "locked" }
    : { fresh: false, reason: "analysis.staleUnverifiable" };
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

module.exports = { buildInspectRequest, freshness, FORCE_CASE_KINDS };
