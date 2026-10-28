// Sistemas de unidades del asistente IA. Espejo de los del frontend
// (structunex-frontend/src/data/units.ts y src/lib/units.ts): el modelo se guarda
// SIEMPRE en base kN·m y el asistente lee y escribe en las unidades de display del
// usuario. Toda conversión pasa por aquí; el LLM nunca convierte "de cabeza".
//
// Si se añade un sistema o una magnitud en el frontend, hay que replicarlo aquí
// (units.test.js comprueba los mismos casos que src/lib/units.test.ts).

const LB = 0.00444822162; // libra-fuerza (kN)
const KIP = 4.4482216; // 1000 lb
const KGF = 0.00980665; // kilogramo-fuerza
const N = 0.001;
const TONF = 9.80665; // tonelada-fuerza métrica
const IN = 0.0254;
const FT = 0.3048;
const MM = 0.001;
const CM = 0.01;

// F = kN por unidad de fuerza · L = m por unidad de longitud.
const unitSystems = [
  { id: "lb-in", label: "lb, in", fSym: "lb", lSym: "in", F: LB, L: IN },
  { id: "lb-ft", label: "lb, ft", fSym: "lb", lSym: "ft", F: LB, L: FT },
  { id: "kip-in", label: "Kip, in", fSym: "Kip", lSym: "in", F: KIP, L: IN },
  { id: "kip-ft", label: "Kip, ft", fSym: "Kip", lSym: "ft", F: KIP, L: FT },
  { id: "kn-mm", label: "kN, mm", fSym: "kN", lSym: "mm", F: 1, L: MM },
  { id: "kn-m", label: "kN, m", fSym: "kN", lSym: "m", F: 1, L: 1 },
  { id: "kgf-mm", label: "Kgf, mm", fSym: "Kgf", lSym: "mm", F: KGF, L: MM },
  { id: "kgf-m", label: "Kgf, m", fSym: "Kgf", lSym: "m", F: KGF, L: 1 },
  { id: "n-mm", label: "N, mm", fSym: "N", lSym: "mm", F: N, L: MM },
  { id: "n-m", label: "N, m", fSym: "N", lSym: "m", F: N, L: 1 },
  { id: "tonf-mm", label: "Tonf, mm", fSym: "Tonf", lSym: "mm", F: TONF, L: MM },
  { id: "tonf-m", label: "Tonf, m", fSym: "Tonf", lSym: "m", F: TONF, L: 1 },
  { id: "kn-cm", label: "kN, cm", fSym: "kN", lSym: "cm", F: 1, L: CM },
  { id: "kgf-cm", label: "Kgf, cm", fSym: "Kgf", lSym: "cm", F: KGF, L: CM },
  { id: "n-cm", label: "N, cm", fSym: "N", lSym: "cm", F: N, L: CM },
  { id: "tonf-cm", label: "Tonf, cm", fSym: "Tonf", lSym: "cm", F: TONF, L: CM },
];

const UNIT_SYSTEM_IDS = unitSystems.map((s) => s.id);
const defaultUnitSystem = unitSystems.find((s) => s.id === "kn-m");

function unitSystemById(id) {
  return unitSystems.find((s) => s.id === id) || defaultUnitSystem;
}

// Exponentes de fuerza (a) y longitud (b) por magnitud: unidad = F^a · L^b.
const EXP = {
  length: { a: 0, b: 1 },
  force: { a: 1, b: 0 },
  moment: { a: 1, b: 1 },
  modulus: { a: 1, b: -2 },
  area: { a: 0, b: 2 },
  inertia: { a: 0, b: 4 },
  density: { a: 1, b: -3 },
  lineweight: { a: 1, b: -1 },
  subgrade: { a: 1, b: -3 },
};

function factor(sys, q) {
  const { a, b } = EXP[q];
  return sys.F ** a * sys.L ** b;
}

const toDisplay = (base, sys, q) => base / factor(sys, q);
const toBase = (disp, sys, q) => disp * factor(sys, q);

const SUP = { 2: "²", 3: "³", 4: "⁴" };

function unitLabel(sys, q) {
  const { a, b } = EXP[q];
  const f = sys.fSym;
  const l = sys.lSym;
  if (q === "length") return l;
  if (q === "force") return f;
  if (q === "moment") return `${f}·${l}`;
  if (q === "area") return `${l}²`;
  if (q === "inertia") return `${l}⁴`;
  const num = a === 1 ? f : "";
  const den = `${l}${SUP[Math.abs(b)] || ""}`;
  return `${num}/${den}`;
}

/** Redondea a cifras significativas para no mandarle ruido de coma flotante al LLM. */
function round(v, sig = 6) {
  if (v == null || !isFinite(v)) return v;
  return Number(Number(v).toPrecision(sig));
}

/** Valor base → display, redondeado. */
const disp = (base, sys, q) => (base == null ? base : round(toDisplay(base, sys, q)));

/** Tabla de etiquetas del sistema, para el system prompt y las herramientas. */
function unitLabels(sys) {
  return Object.fromEntries(Object.keys(EXP).map((q) => [q, unitLabel(sys, q)]));
}

module.exports = {
  unitSystems,
  UNIT_SYSTEM_IDS,
  defaultUnitSystem,
  unitSystemById,
  toDisplay,
  toBase,
  unitLabel,
  unitLabels,
  disp,
  round,
};
