// Catálogo de perfiles: AISC + EN 10365 en la misma API.
// Valores EN anclados a cálculo cerrado desde las dimensiones nominales (no copiados
// de tablas comerciales): HEB300 h=300 b=300 tw=11 tf=19 r=27 mm.
const test = require("node:test");
const assert = require("node:assert/strict");
const { searchShapes, getShape, families, catalogs } = require("./aiscShapes");

test("both catalogs are loaded with unique labels", () => {
  const cats = catalogs();
  assert.deepEqual(cats.map((c) => c.id), ["AISC", "EN"]);
  assert.equal(cats.find((c) => c.id === "EN").count, 90);
  assert.ok(getShape("W14X90"), "AISC sigue igual");
  assert.equal(getShape("W14X90").catalog, "AISC");
});

test("HEB300 matches closed-form properties", () => {
  const s = getShape("HEB300");
  assert.equal(s.catalog, "EN");
  assert.equal(s.type, "HEB");
  assert.equal(s.aiscType, "W");
  const mm2 = 1e-6, mm4 = 1e-12;
  // A = 2·b·tf + (h−2tf)·tw + (4−π)·r²
  const A = 2 * 300 * 19 + (300 - 38) * 11 + (4 - Math.PI) * 27 * 27;
  assert.ok(Math.abs(s.A - A * mm2) < 1e-12);
  // Publicado (EN 10365 / catálogos): A ≈ 149,1 cm², Iy ≈ 25 170 cm⁴, Wpl,y ≈ 1 869 cm³
  assert.ok(Math.abs(s.A * 1e4 - 149.1) < 0.1);
  assert.ok(Math.abs(s.I33 / mm4 / 1e4 - 25170) / 25170 < 0.001);
  assert.ok(Math.abs(s.Zx * 1e6 - 1869) / 1869 < 0.001);
  assert.ok(s.I33 > s.I22 && s.Zx > s.Sx, "orden de ejes y factor de forma");
});

test("search filters by catalog and family, numeric sort", () => {
  const ipe = searchShapes({ type: "IPE", limit: 100 });
  assert.equal(ipe.total, 18);
  assert.equal(ipe.items[0].label, "IPE80");
  assert.equal(ipe.items[17].label, "IPE600");
  const en = searchShapes({ catalog: "en", limit: 1 });
  assert.equal(en.total, 90);
  const heb = searchShapes({ q: "heb3", limit: 100 });
  assert.deepEqual(heb.items.map((s) => s.label), ["HEB300", "HEB320", "HEB340", "HEB360"]);
  assert.ok(families().some((f) => f.type === "HEM" && f.catalog === "EN" && f.count === 24));
});
