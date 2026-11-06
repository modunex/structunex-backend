// Tablas de materiales y perfiles para Report Studio. Pieza PURA.
//
// Solo entra lo que usa el modelo: el catálogo es del usuario, y una entrada ajena a este
// proyecto no debe dejar desactualizado su reporte. Valores en unidades base (kPa, kN, m).
const MODEL_TABLE_SNAPSHOT_VERSION = 1;

const num = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);

// Orden determinista: la huella se recalcula al exportar y tiene que coincidir.
const byName = (a, b) => String(a.name).localeCompare(String(b.name));

function materialsTable(materials) {
  return materials
    .map((m) => ({
      name: m.name,
      type: m.type,
      E: num(m.E),
      nu: num(m.nu),
      G: num(m.E) !== null && num(m.nu) !== null ? m.E / (2 * (1 + m.nu)) : null,
      density: num(m.density),
      alpha: num(m.alpha),
      fc: num(m.fc),
      Fy: num(m.Fy),
      Fu: num(m.Fu),
      Fye: num(m.Fye),
      Fue: num(m.Fue),
    }))
    .sort(byName);
}

function sectionsTable(sections, materialNames, memberCounts) {
  return sections
    .map((s) => {
      const props = s.props || {};
      return {
        name: s.name,
        type: s.propertyType,
        source: s.source,
        shape: s.catalogLabel || s.shape || null,
        material: materialNames.get(s.materialId) ?? null,
        members: memberCounts.get(s.id) ?? 0,
        A: num(props.A) ?? num(s.A),
        I33: num(props.I33) ?? num(s.I33),
        I22: num(props.I22) ?? num(s.I22),
        J: num(props.J) ?? num(s.J),
        d: num(s.d) ?? num(s.h),
        bf: num(s.bf) ?? num(s.b),
        tf: num(s.tf),
        tw: num(s.tw),
      };
    })
    .sort(byName);
}

function modelTableSnapshot(table, { materials, sections, memberCounts }) {
  const rows = table === "materials"
    ? materialsTable(materials)
    : sectionsTable(sections, new Map(materials.map((m) => [m.id, m.name])), memberCounts);
  return { version: MODEL_TABLE_SNAPSHOT_VERSION, kind: "modelTable", table, rows };
}

module.exports = { MODEL_TABLE_SNAPSHOT_VERSION, modelTableSnapshot };
