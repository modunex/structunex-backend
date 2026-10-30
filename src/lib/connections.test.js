const { test } = require("node:test");
const assert = require("node:assert/strict");
const { buildInspectRequest } = require("./connections");

// node --test src/lib/connections.test.js

const SECTION_ID = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";

test("la petición lleva todas las barras, solo casos con esfuerzos y combos normalizados", () => {
  const req = buildInspectRequest({
    nodeId: "N2",
    run: {
      id: "run-1",
      projectId: "proj-1",
      activeDofs: ["UX", "UZ", "RY"],
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
  assert.deepEqual(req.activeDofs, ["UX", "UZ", "RY"]);
  assert.equal(req.frameLoads, undefined);
});

test("la petición lleva el sistema resistente de las barras del nudo que tienen uno definido", () => {
  const req = buildInspectRequest({
    nodeId: "N2",
    run: { id: "r", projectId: "p", cases: [] },
    design: { nodes: [], sections: [], materials: [] },
    elements: [
      { id: "B1", nodeA: "N2", nodeB: "N3", lateralSystem: "Pórtico B" },
      { id: "B2", nodeA: "N1", nodeB: "N2", lateralSystem: null },
      { id: "B3", nodeA: "N2", nodeB: "N4", lateralSystem: "Borrado" },
    ],
    supports: [],
    areas: [],
    loads: [],
    combinations: [],
    lateralSystems: [{ name: "Pórtico B", type: "SMF", code: "AISC341-22" }],
  });
  assert.deepEqual(req.lateralSystems, [{ elementId: "B1", name: "Pórtico B", type: "SMF" }]);
  // El sistema no viaja dentro de la barra: no es geometría.
  assert.equal(req.elements[0].lateralSystem, undefined);
});
