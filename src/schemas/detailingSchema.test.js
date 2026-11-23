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

test("D4: edición por grupo", () => {
  const ok = detailingParams.parse({ groupOverrides: { S1: { count: 3 }, B0: { barId: "n5", count: 2 } } });
  assert.equal(ok.groupOverrides.S1.count, 3);
  for (const bad of [
    { groupOverrides: { S1: { count: 0 } } },
    { groupOverrides: { S1: { count: 2.5 } } },
    { groupOverrides: { S1: { layer: 2 } } },
    { groupOverrides: Object.fromEntries(Array.from({ length: 61 }, (_, i) => [`G${i}`, { count: 2 }])) },
  ]) {
    assert.equal(detailingParams.safeParse(bad).success, false, JSON.stringify(bad).slice(0, 60));
  }
});
