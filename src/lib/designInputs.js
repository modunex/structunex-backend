// Huella de las entradas de comprobación que NO están en la huella del modelo: las
// combinaciones de carga y las preferencias de diseño. Una comprobación (de barras o de
// conexión) hecha con otras combinaciones ya no es vigente aunque el análisis lo sea.
const crypto = require("node:crypto");
const { stableStringify } = require("./modelHash");
const { canonicalPreferences } = require("./designPreferences");

/** Las combinaciones tal como las recibe el motor (nombre + términos). */
const normalizeCombinations = (combinations) =>
  (combinations || []).map((c) => ({
    name: c.name,
    factors: (c.factors || []).map((f) => ({ factor: f.factor, pattern: f.pattern ?? null, seismic: !!f.seismic })),
  }));

const hash = (value) => crypto.createHash("sha256").update(stableStringify(value)).digest("hex");

/**
 * Comprobación de barras: combinaciones + preferencias resueltas + sistema resistente
 * de cada barra (no está en la huella del modelo y activa AISC 341). Sin sistemas
 * asignados la huella es la de siempre, así que las comprobaciones anteriores no caducan.
 */
const designInputsHash = (combinations, preferences, memberSystems) => {
  const value = { combinations: normalizeCombinations(combinations), preferences: canonicalPreferences(preferences) };
  const lateral = (memberSystems || []).map((m) => `${m.elementId}:${m.type}`).sort();
  if (lateral.length) value.lateral = lateral;
  return hash(value);
};

/** Comprobación de conexión: combinaciones + las elegidas (comboNames). */
const connectionLoadsHash = (combinations, comboNames) =>
  hash({ combinations: normalizeCombinations(combinations), comboNames: comboNames || [] });

module.exports = { normalizeCombinations, designInputsHash, connectionLoadsHash };
