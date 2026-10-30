const test = require("node:test");
const assert = require("node:assert/strict");
const { designInputsHash, connectionLoadsHash } = require("./designInputs");

test("la huella cambia con las combinaciones y las preferencias, no con campos ajenos", () => {
  const combos = [{ name: "1.2D+1.6L", factors: [{ factor: 1.2, pattern: "D" }, { factor: 1.6, pattern: "L" }], extra: 1 }];
  const same = [{ name: "1.2D+1.6L", factors: [{ factor: 1.2, pattern: "D", seismic: false }, { factor: 1.6, pattern: "L" }] }];
  assert.equal(designInputsHash(combos, { code: "ACI" }), designInputsHash(same, { code: "ACI" }));
  const edited = [{ name: "1.2D+1.6L", factors: [{ factor: 1.2, pattern: "D" }, { factor: 1.0, pattern: "L" }] }];
  assert.notEqual(designInputsHash(combos, {}), designInputsHash(edited, {}));
  assert.notEqual(designInputsHash(combos, { code: "ACI" }), designInputsHash(combos, { code: "EC2" }));
  assert.notEqual(connectionLoadsHash(combos, []), connectionLoadsHash(combos, ["1.2D+1.6L"]));
});
