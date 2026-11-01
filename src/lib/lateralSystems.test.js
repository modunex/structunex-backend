const test = require("node:test");
const assert = require("node:assert/strict");
const { memberLateralSystems } = require("./lateralSystems");

test("solo cuentan las barras con un sistema que existe en la configuración", () => {
  const out = memberLateralSystems(
    [
      { id: "E1", lateralSystem: "Pórtico X" },
      { id: "E2", lateralSystem: "Borrado" },
      { id: "E3", lateralSystem: null },
    ],
    [{ name: "Pórtico X", type: "SMF" }]
  );
  assert.deepEqual(out, [{ elementId: "E1", name: "Pórtico X", type: "SMF" }]);
});
