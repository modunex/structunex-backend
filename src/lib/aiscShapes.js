// AISC shapes catalog served entirely from the bundled JSON (no database). The
// file (~600 KB, 2299 shapes, already in SI units: m, m², m⁴, kN/m) is loaded
// once at require time; searches and lookups run in memory. Updating the
// catalog = replacing the JSON file. No DB, no seed.
const db = require("../data/aisc_shapes_v16_si.json");

const SHAPES = Array.isArray(db.sections) ? db.sections : [];
const BY_LABEL = new Map(SHAPES.map((s) => [s.label, s]));

// Familias con conteo (para el filtro del combobox). Desde meta.types si está,
// si no se derivan del propio array.
function families() {
  const counts =
    db.meta && db.meta.types
      ? { ...db.meta.types }
      : SHAPES.reduce((acc, s) => {
          acc[s.type] = (acc[s.type] || 0) + 1;
          return acc;
        }, {});
  return Object.entries(counts)
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count);
}

function getShape(label) {
  if (!label) return null;
  return BY_LABEL.get(label) || null;
}

// Búsqueda por subcadena en `label` (case-insensitive) + filtro por familia,
// ordenado por label y paginado. Nunca devuelve los 2299 de golpe.
function searchShapes({ q, type, page, limit } = {}) {
  const needle = (q || "").trim().toUpperCase();
  const fam = (type || "").trim();

  let items = SHAPES;
  if (fam) items = items.filter((s) => s.type === fam);
  if (needle) items = items.filter((s) => s.label.toUpperCase().includes(needle));

  const total = items.length;
  const p = Math.max(1, Number(page) || 1);
  const lim = Math.min(100, Math.max(1, Number(limit) || 25));
  const start = (p - 1) * lim;
  const paged = [...items]
    .sort((a, b) => a.label.localeCompare(b.label))
    .slice(start, start + lim);

  return { items: paged, total, page: p, limit: lim };
}

module.exports = { searchShapes, getShape, families };
