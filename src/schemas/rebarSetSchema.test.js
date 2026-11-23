const test = require("node:test");
const assert = require("node:assert/strict");

const { rebarSet } = require("./rebarSetSchema");
const { createProjectSchema, updateProjectMetaSchema } = require("./projectSchema");
const { modelSchema } = require("./modelSchema");

// #4 y #5 de ASTM A615 Tabla 1, en unidades base (m, m², kg/m).
const bar = (id, label, inches, in2, lbft) => ({
  id, label, db: inches * 0.0254, area: in2 * 0.0254 ** 2, mass: lbft * 1.48816394,
});
const SET = { preset: "astm-a615", bars: [bar("4", "#4", 0.5, 0.2, 0.668), bar("5", "#5", 0.625, 0.31, 1.043)] };

test("acepta un juego coherente", () => {
  assert.equal(rebarSet.safeParse(SET).success, true);
});

test("rechaza juegos que darían armados falsos", () => {
  const cases = [
    { ...SET, bars: [] },
    { ...SET, preset: "otro" },
    { ...SET, bars: [SET.bars[0], { ...SET.bars[1], id: "4" }] },          // id repetido
    { ...SET, bars: [SET.bars[0], { ...SET.bars[1], label: " #4 " }] },     // designación repetida
    { ...SET, bars: [SET.bars[0], { ...SET.bars[1], db: SET.bars[0].db }] }, // mismo diámetro
    { ...SET, bars: [{ ...SET.bars[0], db: 12.7 }] },                        // mm en vez de m
    { ...SET, bars: [{ ...SET.bars[0], area: SET.bars[0].area * 100 }] },    // cm² en vez de m²
    { ...SET, bars: [{ ...SET.bars[0], extra: 1 }] },
  ];
  for (const c of cases) assert.equal(rebarSet.safeParse(c).success, false, JSON.stringify(c));
});

test("llega por la creación y por la configuración, no por el PATCH de metadatos", () => {
  assert.equal(createProjectSchema.parse({ name: "P", rebarSet: SET }).rebarSet.preset, "astm-a615");
  assert.equal("rebarSet" in updateProjectMetaSchema.parse({ name: "P", rebarSet: SET }), false);
  assert.equal(modelSchema.safeParse({ configuration: { rebarSet: SET } }).success, true);
  assert.equal(modelSchema.safeParse({ configuration: { rebarSet: null } }).success, true);
});
