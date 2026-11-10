// ¿Siguen valiendo los resultados de un análisis para el modelo ACTUAL?
//
// Desbloquear el modelo no borra resultados (quedan como historial), así que "hay un run
// resuelto" no significa "hay resultados de este modelo". Todo lo que dimensiona a
// partir de esfuerzos —diseño de barras, conexiones— lo pregunta aquí antes de leerlos.
//
// - Run con huella (analysis_runs.modelHash, ver lib/modelHash.js): vale si coincide con
//   la huella del modelo actual.
// - Run sin huella: es anterior a 2026-10, cuando además las inercias iban cruzadas
//   (I33 → Iy; ver assembleModel). Sus esfuerzos son de otro modelo estructural y no
//   valen nunca: hay que volver a analizar.
// Pura, sin base de datos: se prueba en analysisFreshness.test.js.

function freshness({ runHash, currentHash }) {
  if (!runHash) return { fresh: false, reason: "analysis.legacy" };
  return runHash === currentHash
    ? { fresh: true, basis: "modelHash" }
    : { fresh: false, reason: "analysis.stale" };
}

const STALE_MESSAGES = {
  "analysis.legacy":
    "El último análisis es anterior al cambio de convención de ejes (SAP2000). " +
    "Vuelve a analizar el modelo.",
  "analysis.stale":
    "El modelo cambió después del último análisis. Vuelve a analizar el modelo.",
};

/**
 * Marca cada ejecución del historial con si corresponde al modelo actual. Solo las
 * frescas pueden mostrar sus resultados sobre la geometría de hoy: las de otra versión
 * del modelo podrían referirse a nudos y barras que ya no existen o se movieron.
 * `currentHash` null (el modelo no se puede armar ahora) deja todas como no frescas.
 */
function withFreshness(runs, currentHash) {
  return runs.map(({ modelHash, ...run }) => {
    const state = freshness({ runHash: modelHash ?? null, currentHash });
    return { ...run, fresh: state.fresh, staleReason: state.fresh ? null : state.reason };
  });
}

module.exports = { freshness, withFreshness, STALE_MESSAGES };
