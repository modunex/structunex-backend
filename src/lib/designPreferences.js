// Design ▸ Preferences: valores por defecto, validación y forma canónica.
//
// La validación vive aquí y no solo en el calc-service para que un valor fuera de rango
// sea un 400 al GUARDAR (la ventana de preferencias) y no un fallo del job minutos
// después. Los límites son los mismos que `app/schemas.py::DesignPreferences`.
const { AppError } = require("../middleware/errorHandler");
const { checkCodes } = require("./designCodes");

const DEFAULT_STEEL = Object.freeze({
  torsion: "check",
  kMajor: null,
  kMinor: null,
  kTorsion: null,
  cb: null,
  lbRatio: null,
});

const DEFAULT_SEISMIC = Object.freeze({ ry: null, omega0: 3 });

const DEFAULT_PREFERENCES = Object.freeze({
  code: "ACI318-19",
  steelCode: "AISC360-16",
  method: "LRFD",
  ratioLimit: 1,
  steel: DEFAULT_STEEL,
  seismic: DEFAULT_SEISMIC,
  comboNames: [],
  overrides: [],
});

// Rango de cada valor global de acero: (min exclusivo, max inclusivo).
const STEEL_RANGES = {
  kMajor: [0, 10],
  kMinor: [0, 10],
  kTorsion: [0, 10],
  cb: [0, 3],
  lbRatio: [0, 1],
};

const bad = (message, field) => new AppError(400, message, { error: "design.preferenceInvalid", field });
const isNum = (v) => typeof v === "number" && Number.isFinite(v);

/** Cortes de la leyenda: tres, crecientes, por debajo del límite D/C. Solo visual. */
function checkDisplay(display, ratioLimit) {
  if (display === undefined) return;
  const bands = display?.bands;
  const limit = isNum(ratioLimit) ? ratioLimit : 1;
  const ok =
    display && typeof display === "object" && Array.isArray(bands) && bands.length === 3 &&
    bands.every(isNum) && bands[0] > 0 && bands[0] < bands[1] && bands[1] < bands[2] && bands[2] < limit;
  if (!ok) throw bad("Bandas de color inválidas.", "display.bands");
}

/** Sísmico (AISC 341): Ry de la Tabla A3.2 (1–2) y Ωo de la norma sísmica (1–5]. */
function checkSeismic(seismic) {
  if (seismic === undefined) return;
  if (seismic === null || typeof seismic !== "object" || Array.isArray(seismic)) {
    throw bad("Preferencias sísmicas inválidas.", "seismic");
  }
  const { ry, omega0 } = seismic;
  if (ry !== undefined && ry !== null && (!isNum(ry) || ry < 1 || ry > 2)) {
    throw bad("Ry debe estar entre 1 y 2 (AISC 341 Tabla A3.2).", "seismic.ry");
  }
  if (omega0 !== undefined && (!isNum(omega0) || omega0 <= 1 || omega0 > 5)) {
    throw bad("Ωo debe ser mayor que 1 y no mayor que 5.", "seismic.omega0");
  }
}

/** Lanza 400 si algo de lo pedido está fuera de lo que el motor acepta. */
function checkPreferences(requested) {
  if (!requested) return;
  checkCodes(requested);
  if (requested.method !== undefined && requested.method !== "LRFD") {
    throw bad("Solo el método LRFD está implementado.", "method");
  }
  if (requested.ratioLimit !== undefined) {
    const r = requested.ratioLimit;
    if (!isNum(r) || r <= 0 || r > 1) {
      throw bad("El límite D/C debe estar entre 0 y 1.", "ratioLimit");
    }
  }
  checkDisplay(requested.display, requested.ratioLimit);
  checkSeismic(requested.seismic);
  const steel = requested.steel;
  if (steel === undefined) return;
  if (steel === null || typeof steel !== "object" || Array.isArray(steel)) {
    throw bad("Preferencias de acero inválidas.", "steel");
  }
  if (steel.torsion !== undefined && !["check", "ignore"].includes(steel.torsion)) {
    throw bad("Torsión: 'check' o 'ignore'.", "steel.torsion");
  }
  for (const [key, [lo, hi]] of Object.entries(STEEL_RANGES)) {
    const v = steel[key];
    if (v === undefined || v === null) continue;
    if (!isNum(v) || v <= lo || v > hi) {
      throw bad(`${key} fuera de rango (${lo}, ${hi}].`, `steel.${key}`);
    }
  }
}

/** Defaults + guardadas + pedidas; `steel` se mezcla campo a campo. */
function mergePreferences(stored, requested) {
  const s = stored || {};
  const r = requested || {};
  const steel = {};
  for (const key of Object.keys(DEFAULT_STEEL)) {
    const pick = [r.steel?.[key], s.steel?.[key]].find((v) => v !== undefined);
    steel[key] = pick === undefined ? DEFAULT_STEEL[key] : pick;
  }
  const seismic = {};
  for (const key of Object.keys(DEFAULT_SEISMIC)) {
    const pick = [r.seismic?.[key], s.seismic?.[key]].find((v) => v !== undefined);
    seismic[key] = pick === undefined ? DEFAULT_SEISMIC[key] : pick;
  }
  return { ...DEFAULT_PREFERENCES, ...s, ...r, steel, seismic };
}

/**
 * La forma que entra en la huella de entradas: sin los campos que siguen en su valor
 * por defecto. Así las comprobaciones hechas antes de que existieran estas opciones
 * conservan su huella (no se marcan "inputs.changed" por una opción que nadie tocó).
 */
function canonicalPreferences(preferences) {
  const p = { ...(preferences || {}) };
  // Solo visual (colores de la leyenda): no cambia ningún resultado.
  delete p.display;
  if (p.method === DEFAULT_PREFERENCES.method) delete p.method;
  if (p.ratioLimit === DEFAULT_PREFERENCES.ratioLimit) delete p.ratioLimit;
  if (p.steel && typeof p.steel === "object") {
    const steel = Object.fromEntries(
      Object.entries(p.steel).filter(([k, v]) => v !== undefined && v !== DEFAULT_STEEL[k])
    );
    if (Object.keys(steel).length === 0) delete p.steel;
    else p.steel = steel;
  }
  if (p.seismic && typeof p.seismic === "object") {
    const seismic = Object.fromEntries(
      Object.entries(p.seismic).filter(([k, v]) => v !== undefined && v !== DEFAULT_SEISMIC[k])
    );
    if (Object.keys(seismic).length === 0) delete p.seismic;
    else p.seismic = seismic;
  }
  return p;
}

module.exports = {
  DEFAULT_PREFERENCES,
  DEFAULT_STEEL,
  DEFAULT_SEISMIC,
  checkPreferences,
  mergePreferences,
  canonicalPreferences,
};
