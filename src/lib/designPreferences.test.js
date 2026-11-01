const test = require("node:test");
const assert = require("node:assert/strict");

const {
  DEFAULT_PREFERENCES,
  checkPreferences,
  mergePreferences,
  canonicalPreferences,
} = require("./designPreferences");
const { designInputsHash } = require("./designInputs");

test("acepta lo que el motor acepta", () => {
  assert.doesNotThrow(() => checkPreferences(undefined));
  assert.doesNotThrow(() =>
    checkPreferences({
      steelCode: "AISC360-22",
      method: "LRFD",
      ratioLimit: 0.95,
      steel: { torsion: "ignore", kMajor: 0.8, kMinor: null, cb: 1.14, lbRatio: 0.5 },
      display: { bands: [0.4, 0.6, 0.8] },
    })
  );
});

test("rechaza con 400 lo que el motor no acepta", () => {
  for (const bad of [
    { method: "ASD" },
    { ratioLimit: 1.05 },
    { ratioLimit: 0 },
    { ratioLimit: "1" },
    { steel: null },
    { steel: { torsion: "maybe" } },
    { steel: { cb: 3.5 } },
    { steel: { lbRatio: 0 } },
    { steel: { kMajor: Number.NaN } },
    { steelCode: "AISC360-10" },
    { display: { bands: [0.5, 0.4, 0.9] } },
    { display: { bands: [0.5, 0.7] } },
    { ratioLimit: 0.85, display: { bands: [0.5, 0.7, 0.9] } },
  ]) {
    assert.throws(() => checkPreferences(bad), (e) => e.statusCode === 400 || e.status === 400, JSON.stringify(bad));
  }
});

test("mezcla acero campo a campo: pedido > guardado > defecto", () => {
  const out = mergePreferences(
    { steelCode: "AISC360-22", steel: { torsion: "ignore", cb: 1.2 } },
    { steel: { cb: 1.14 } }
  );
  assert.equal(out.steelCode, "AISC360-22");
  assert.equal(out.method, "LRFD");
  assert.equal(out.ratioLimit, 1);
  assert.deepEqual(out.steel, { torsion: "ignore", kMajor: null, kMinor: null, kTorsion: null, cb: 1.14, lbRatio: null });
});

test("la huella de una comprobación anterior no cambia por opciones sin tocar", () => {
  const combos = [{ name: "1.4D", factors: [{ factor: 1.4, pattern: "D" }] }];
  // Lo que se guardaba antes de existir estas opciones.
  const before = { code: "ACI318-19", steelCode: "AISC360-16", comboNames: [], overrides: [] };
  const crypto = require("node:crypto");
  const { stableStringify } = require("./modelHash");
  const { normalizeCombinations } = require("./designInputs");
  const legacy = crypto
    .createHash("sha256")
    .update(stableStringify({ combinations: normalizeCombinations(combos), preferences: before }))
    .digest("hex");
  assert.equal(designInputsHash(combos, mergePreferences(before, null)), legacy);
  // Cambiar una opción sí cambia la huella.
  assert.notEqual(designInputsHash(combos, mergePreferences(before, { steel: { torsion: "ignore" } })), legacy);
  assert.notEqual(designInputsHash(combos, mergePreferences(before, { ratioLimit: 0.9 })), legacy);
  // Los colores de la leyenda no son una entrada de la comprobación.
  assert.equal(designInputsHash(combos, mergePreferences(before, { display: { bands: [0.4, 0.6, 0.8] } })), legacy);
});

test("canonical quita solo lo que está en su valor por defecto", () => {
  assert.deepEqual(canonicalPreferences({ ...DEFAULT_PREFERENCES, steel: { ...DEFAULT_PREFERENCES.steel, cb: 1.1 } }), {
    code: "ACI318-19",
    steelCode: "AISC360-16",
    comboNames: [],
    overrides: [],
    steel: { cb: 1.1 },
  });
});
