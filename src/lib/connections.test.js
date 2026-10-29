const { test } = require("node:test");
const assert = require("node:assert/strict");
const { buildInspectRequest, freshness } = require("./connections");

// node --test src/lib/connections.test.js

test("un run con huella vale solo si coincide con el modelo actual", () => {
  assert.deepEqual(freshness({ runHash: "a", currentHash: "a", isLocked: false }), {
    fresh: true,
    basis: "modelHash",
  });
  // Bloqueado no basta si la huella dice otra cosa.
  assert.equal(freshness({ runHash: "a", currentHash: "b", isLocked: true }).fresh, false);
  assert.equal(freshness({ runHash: "a", currentHash: null, isLocked: true }).fresh, false);
});

test("un run antiguo sin huella solo vale con el modelo bloqueado", () => {
  assert.deepEqual(freshness({ runHash: null, currentHash: "x", isLocked: true }), {
    fresh: true,
    basis: "locked",
  });
  assert.deepEqual(freshness({ runHash: null, currentHash: "x", isLocked: false }), {
    fresh: false,
    reason: "analysis.staleUnverifiable",
  });
});

const SECTION_ID = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";

test("la petición lleva todas las barras, solo casos con esfuerzos y combos normalizados", () => {
  const req = buildInspectRequest({
    nodeId: "N2",
    run: {
      id: "run-1",
      projectId: "proj-1",
      cases: [
        { name: "D", key: "d", kind: "pattern" },
        { name: "Modal", key: "modal", kind: "modal" },
        { name: "EX", key: "ex", kind: "responseSpectrum" },
        { name: "Old", key: "old" },
      ],
    },
    design: { nodes: [{ id: "N2", x: 0, y: 0, z: 3 }], sections: [], materials: [] },
    elements: [
      { id: "B1", nodeA: "N2", nodeB: "N3", frameSectionId: SECTION_ID, roll: 90,
        releases: { i: { m2: true, m3: true } } },
      { id: "B2", nodeA: "N1", nodeB: "N2", frameSectionId: null, roll: null },
    ],
    supports: [],
    areas: [],
    loads: [],
    combinations: [
      { name: "1.2D+E", factors: [{ factor: 1.2, pattern: "D" }, { factor: 1, seismic: true }] },
    ],
    bucket: "b",
    prefix: "p",
  });

  assert.deepEqual(req.source.cases.map((c) => c.name), ["D", "EX", "Old"]);
  assert.equal(req.source.cases[2].kind, "pattern");
  assert.deepEqual(req.elements, [
    { id: "B1", nodeA: "N2", nodeB: "N3", sectionId: SECTION_ID, roll: 90,
      releases: { i: { m2: true, m3: true } } },
    { id: "B2", nodeA: "N1", nodeB: "N2", sectionId: null, roll: 0 },
  ]);
  assert.deepEqual(req.combinations[0].factors, [
    { factor: 1.2, pattern: "D", seismic: false },
    { factor: 1, pattern: null, seismic: true },
  ]);
  assert.equal(req.source.bucket, "b");
});
