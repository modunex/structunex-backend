const { test } = require("node:test");
const assert = require("node:assert/strict");
const { checkCodes, STEEL_CODES } = require("./designCodes");

// node --test src/services/designCodes.test.js

test("las normas de acero son las que el motor conoce, 360-22 incluida", () => {
  assert.deepEqual(STEEL_CODES, ["AISC360-16", "AISC360-22"]);
  assert.doesNotThrow(() => checkCodes({ steelCode: "AISC360-22", code: "ACI318-19" }));
  assert.doesNotThrow(() => checkCodes(undefined));
  assert.throws(() => checkCodes({ steelCode: "AISC360-10" }), /acero desconocida/);
  assert.throws(() => checkCodes({ code: "NSR-10" }), /hormigón desconocida/);
});
