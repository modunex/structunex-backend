// Catálogo de perfiles de acero del sistema, servido entero desde JSON empaquetado
// (sin base de datos). Hoy lo forman dos ficheros con el MISMO esquema y unidades SI
// (m, m², m⁴, m⁶, kN/m):
//
//   aisc_shapes_v16_si.json   AISC Shapes Database v16 (W, HSS, PIPE, C, L, WT, 2L…)
//   en10365_shapes_si.json    EN 10365:2017 (IPE, HEA, HEB, HEM), generado por
//                             scripts/build-en10365-shapes.py
//
// Se cargan una vez al requerir el módulo; búsquedas y consultas van en memoria.
// Añadir un catálogo = un JSON más en CATALOGS, con etiquetas que no choquen.
// Actualizar uno = reemplazar su JSON. Sin DB, sin seed.
//
// El nombre del módulo se mantiene (aiscShapes) porque lo importan análisis, diseño
// y el asistente de IA; para ellos un HEB300 es un perfil de catálogo más.
const CATALOGS = [
  { id: "AISC", standard: "AISC Shapes Database v16.0", db: require("../data/aisc_shapes_v16_si.json") },
  { id: "EN", standard: "EN 10365:2017", db: require("../data/en10365_shapes_si.json") },
];

const SHAPES = [];
const BY_LABEL = new Map();
for (const { id, standard, db } of CATALOGS) {
  for (const s of Array.isArray(db.sections) ? db.sections : []) {
    if (BY_LABEL.has(s.label)) {
      throw new Error(`Perfil duplicado entre catálogos: ${s.label}`);
    }
    const shape = { catalog: id, standard: s.standard || standard, ...s };
    SHAPES.push(shape);
    BY_LABEL.set(s.label, shape);
  }
}

// Familias con conteo (para el filtro del combobox), con el catálogo de origen.
function families() {
  const counts = new Map();
  for (const s of SHAPES) {
    const prev = counts.get(s.type);
    counts.set(s.type, { type: s.type, catalog: s.catalog, count: (prev ? prev.count : 0) + 1 });
  }
  return [...counts.values()].sort((a, b) => b.count - a.count);
}

function getShape(label) {
  if (!label) return null;
  return BY_LABEL.get(label) || null;
}

// Búsqueda por subcadena en `label` (case-insensitive) + filtro por familia y por
// catálogo ("AISC" | "EN"), ordenado por label y paginado. Nunca devuelve todo de golpe.
function searchShapes({ q, type, catalog, page, limit } = {}) {
  const needle = (q || "").trim().toUpperCase();
  const fam = (type || "").trim();
  const cat = (catalog || "").trim().toUpperCase();

  let items = SHAPES;
  if (cat) items = items.filter((s) => s.catalog === cat);
  if (fam) items = items.filter((s) => s.type === fam);
  if (needle) items = items.filter((s) => s.label.toUpperCase().includes(needle));

  const total = items.length;
  const p = Math.max(1, Number(page) || 1);
  const lim = Math.min(100, Math.max(1, Number(limit) || 25));
  const start = (p - 1) * lim;
  const paged = [...items]
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }))
    .slice(start, start + lim);

  return { items: paged, total, page: p, limit: lim };
}

function catalogs() {
  return CATALOGS.map(({ id, standard, db }) => ({
    id,
    standard,
    count: Array.isArray(db.sections) ? db.sections.length : 0,
  }));
}

module.exports = { searchShapes, getShape, families, catalogs };
