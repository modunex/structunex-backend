const test = require("node:test");
const assert = require("node:assert/strict");

const { modelTableSnapshot } = require("./reportingCatalog");

const materials = [
  { id: "b", name: "A992", type: "steel", E: 2e8, nu: 0.3, density: 76.98, Fy: 345000, Fu: 450000 },
  { id: "a", name: "A36", type: "steel", E: 2e8, nu: 0.3, Fy: 250000 },
];
const sections = [
  { id: "s2", name: "W14X99", propertyType: "steel", source: "catalog", catalogLabel: "W14X99", materialId: "b", props: { A: 0.0188, I33: 0.000465, I22: 0.000166, J: 3.1e-6 }, d: 0.36, bf: 0.37, tf: 0.0198, tw: 0.0123 },
  { id: "s1", name: "IPE360", propertyType: "steel", source: "catalog", catalogLabel: "IPE360", materialId: "a", props: { A: 0.00727 } },
];
const data = { materials, sections, memberCounts: new Map([["s2", 3]]) };

test("materiales: propiedades y G derivado de E y ν", () => {
  const { rows, kind, table } = modelTableSnapshot("materials", data);
  assert.equal(kind, "modelTable");
  assert.equal(table, "materials");
  assert.deepEqual(rows.map((r) => r.name), ["A36", "A992"]);
  assert.ok(Math.abs(rows[1].G - 2e8 / 2.6) < 1e-6);
  assert.equal(rows[0].density, null);
});

test("perfiles: material, barras y propiedades resueltas por el servidor", () => {
  const { rows } = modelTableSnapshot("sections", data);
  assert.deepEqual(rows.map((r) => r.name), ["IPE360", "W14X99"]);
  assert.equal(rows[1].material, "A992");
  assert.equal(rows[1].members, 3);
  assert.equal(rows[1].A, 0.0188);
  assert.equal(rows[0].members, 0);
  assert.equal(rows[0].I33, null);
});

test("el orden de la base no cambia la tabla", () => {
  const swapped = { ...data, materials: [...materials].reverse(), sections: [...sections].reverse() };
  assert.deepEqual(modelTableSnapshot("sections", swapped), modelTableSnapshot("sections", data));
  assert.deepEqual(modelTableSnapshot("materials", swapped), modelTableSnapshot("materials", data));
});
