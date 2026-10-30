const { test } = require("node:test");
const assert = require("node:assert/strict");
const { freshness, STALE_MESSAGES } = require("./analysisFreshness");

// node --test src/lib/analysisFreshness.test.js

test("un run con huella vale solo si coincide con el modelo actual", () => {
  assert.deepEqual(freshness({ runHash: "a", currentHash: "a" }), {
    fresh: true,
    basis: "modelHash",
  });
  assert.deepEqual(freshness({ runHash: "a", currentHash: "b" }), {
    fresh: false,
    reason: "analysis.stale",
  });
  // El modelo actual no se puede armar (p. ej. sin secciones): no coincide con nada.
  assert.equal(freshness({ runHash: "a", currentHash: null }).fresh, false);
});

test("un run sin huella es de la convención de ejes anterior y nunca vale", () => {
  assert.deepEqual(freshness({ runHash: null, currentHash: "x" }), {
    fresh: false,
    reason: "analysis.legacy",
  });
});

test("cada motivo tiene su mensaje", () => {
  for (const reason of ["analysis.legacy", "analysis.stale"]) {
    assert.ok(STALE_MESSAGES[reason]);
  }
});
