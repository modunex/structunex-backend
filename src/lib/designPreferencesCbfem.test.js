// Fase 4 (CBFEM): el límite de deformación plástica de las placas es un ajuste del proyecto.
const test = require("node:test");
const assert = require("node:assert/strict");

const { checkPreferences, mergePreferences, canonicalPreferences } = require("./designPreferences");

test("5 % por defecto; lo guardado y lo pedido mandan, campo a campo", () => {
  assert.equal(mergePreferences({}, null).cbfem.plasticStrainLimit, 0.05);
  assert.equal(mergePreferences({ cbfem: { plasticStrainLimit: 0.03 } }, null).cbfem.plasticStrainLimit, 0.03);
  assert.equal(mergePreferences({ cbfem: { plasticStrainLimit: 0.03 } }, { cbfem: { plasticStrainLimit: 0.04 } })
    .cbfem.plasticStrainLimit, 0.04);
});

test("fuera de (0, 20 %]: 400 al guardar", () => {
  for (const v of [0, -0.01, 0.25, "5"]) {
    assert.throws(() => checkPreferences({ cbfem: { plasticStrainLimit: v } }), /deformación plástica/);
  }
  assert.doesNotThrow(() => checkPreferences({ cbfem: { plasticStrainLimit: 0.2 } }));
});

test("no entra en la huella del diseño de miembros", () => {
  const p = mergePreferences({ cbfem: { plasticStrainLimit: 0.02 } }, null);
  assert.equal(canonicalPreferences(p).cbfem, undefined);
});

test("pandeo: αcr ≥ 15 por defecto, entre 1 y 100", () => {
  assert.equal(mergePreferences({}, null).cbfem.bucklingFactorLimit, 15);
  assert.equal(mergePreferences({ cbfem: { plasticStrainLimit: 0.03 } }, null).cbfem.bucklingFactorLimit, 15);
  for (const v of [0.5, 101, "15"]) {
    assert.throws(() => checkPreferences({ cbfem: { bucklingFactorLimit: v } }), /pandeo/);
  }
});
