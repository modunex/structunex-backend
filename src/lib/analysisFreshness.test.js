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

const { withFreshness } = require("./analysisFreshness");

test("withFreshness: cada ejecución del historial dice si es del modelo actual", () => {
  const runs = [
    { _id: "r3", status: "solved", modelHash: "h2" },
    { _id: "r2", status: "solved", modelHash: "h1" },
    { _id: "r1", status: "solved" }, // anterior a la huella: legado
  ];
  const out = withFreshness(runs, "h2");
  assert.deepEqual(
    out.map((r) => [r._id, r.fresh, r.staleReason]),
    [
      ["r3", true, null],
      ["r2", false, "analysis.stale"],
      ["r1", false, "analysis.legacy"],
    ]
  );
  // La huella no sale en la respuesta: es un detalle interno.
  assert.ok(out.every((r) => !("modelHash" in r)));
});

test("withFreshness: si el modelo actual no se puede armar, ninguna es fresca", () => {
  const out = withFreshness([{ _id: "r1", modelHash: "h1" }], null);
  assert.equal(out[0].fresh, false);
  assert.equal(out[0].staleReason, "analysis.stale");
});
