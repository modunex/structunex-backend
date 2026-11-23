const test = require("node:test");
const assert = require("node:assert/strict");

const { detailingParams } = require("./detailingSchema");

test("acepta lo que el motor entiende y rechaza lo demás", () => {
  assert.deepEqual(detailingParams.parse({}), {});
  assert.equal(detailingParams.parse({ topBarId: "n6", stockLength: 12, spacingStep: 0.025 }).topBarId, "n6");
  assert.equal(detailingParams.parse({ topBarId: null }).topBarId, null);
  for (const bad of [
    { stirrupLegs: 1 }, { stockLength: 30 }, { spacingStep: 0.03 }, { aggregate: 19 }, { otra: 1 },
  ]) {
    assert.equal(detailingParams.safeParse(bad).success, false, JSON.stringify(bad));
  }
});
