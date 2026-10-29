const crypto = require("node:crypto");

// Huella del modelo que se analizó.
//
// PARA QUÉ. Desbloquear el modelo (estilo SAP2000) NO borra los resultados: quedan como
// historial. Así que "hay un análisis resuelto" no significa "hay resultados de ESTE
// modelo". Todo lo que consume esfuerzos para dimensionar algo —las conexiones, por
// ahora— tiene que poder comprobar que el modelo no ha cambiado desde que se resolvió.
// Para eso se guarda en `analysis_runs.modelHash` la huella de lo que se mandó al solver
// y se compara con la del modelo actual.
//
// QUÉ ENTRA. Exactamente lo que determina los esfuerzos: el modelo que arma
// `assembleModel` (geometría, secciones con modificadores, materiales, releases, apoyos y
// cargas) y las condiciones de carga (patrones con su peso propio, fuente de masa, casos
// modales y de espectro). `activeDofs` se queda fuera a propósito: se guarda aparte en el
// run y el cliente lo decide en el momento de lanzar.
//
// ESTABLE. Las claves se ordenan antes de serializar, así que el orden en que Prisma o
// JSON devuelvan los campos no cambia la huella. El orden de las LISTAS sí cuenta, y es
// estable porque `assembleModel` lee cada tabla por `seq`.

function stableStringify(value) {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") {
    if (typeof value === "bigint") return JSON.stringify(value.toString());
    if (typeof value === "number" && !Number.isFinite(value)) return "null";
    return JSON.stringify(value);
  }
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value)
    .filter((k) => value[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
}

/**
 * Huella sha256 de lo que se resuelve.
 * @param {{model: object, loadPatterns?: object[], massSource?: object|null,
 *          modalCases?: object[], responseSpectrum?: object|null}} input
 */
function modelHash({ model, loadPatterns, massSource, modalCases, responseSpectrum }) {
  const canonical = stableStringify({
    v: 1, // sube si cambia lo que entra en la huella
    model,
    loadPatterns: loadPatterns || [],
    massSource: massSource || null,
    modalCases: modalCases || [],
    responseSpectrum: responseSpectrum || null,
  });
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

module.exports = { modelHash, stableStringify };
