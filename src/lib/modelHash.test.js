const { test } = require("node:test");
const assert = require("node:assert/strict");
const { modelHash, stableStringify } = require("./modelHash");

// node --test src/lib/modelHash.test.js

const MODEL = {
  nodes: [{ id: "N1", x: 0, y: 0, z: 0 }, { id: "N2", x: 6, y: 0, z: 0 }],
  elements: [{ id: "E1", nodeA: "N1", nodeB: "N2", sectionId: "s", roll: 0 }],
  loads: [{ nodeId: "N2", loadPattern: "D", fz: -10 }],
};
const PATTERNS = [{ name: "D", type: "dead", selfWeightMultiplier: 1 }];

test("la huella no depende del orden de las claves", () => {
  const a = modelHash({ model: MODEL, loadPatterns: PATTERNS });
  const reordered = {
    loads: MODEL.loads.map((l) => ({ fz: l.fz, loadPattern: l.loadPattern, nodeId: l.nodeId })),
    elements: MODEL.elements,
    nodes: MODEL.nodes.map((n) => ({ z: n.z, y: n.y, x: n.x, id: n.id })),
  };
  assert.equal(modelHash({ model: reordered, loadPatterns: PATTERNS }), a);
});

test("cambia con la geometría, las cargas, los releases y el peso propio", () => {
  const base = modelHash({ model: MODEL, loadPatterns: PATTERNS });
  const moved = { ...MODEL, nodes: [MODEL.nodes[0], { ...MODEL.nodes[1], x: 6.001 }] };
  const loaded = { ...MODEL, loads: [{ ...MODEL.loads[0], fz: -11 }] };
  const released = {
    ...MODEL,
    elements: [{ ...MODEL.elements[0], releases: { j: { m3: true } } }],
  };
  const heavier = [{ ...PATTERNS[0], selfWeightMultiplier: 1.1 }];
  const hashes = [
    modelHash({ model: moved, loadPatterns: PATTERNS }),
    modelHash({ model: loaded, loadPatterns: PATTERNS }),
    modelHash({ model: released, loadPatterns: PATTERNS }),
    modelHash({ model: MODEL, loadPatterns: heavier }),
  ];
  for (const h of hashes) assert.notEqual(h, base);
  assert.equal(new Set(hashes).size, hashes.length);
});

test("ausente y vacío son la misma condición", () => {
  assert.equal(
    modelHash({ model: MODEL }),
    modelHash({ model: MODEL, loadPatterns: [], massSource: null, modalCases: [] })
  );
});

test("stableStringify trata undefined, BigInt y fechas sin romper", () => {
  assert.equal(stableStringify({ b: 1, a: undefined }), '{"b":1}');
  assert.equal(stableStringify(10n), '"10"');
  assert.equal(stableStringify(new Date(0)), '"1970-01-01T00:00:00.000Z"');
});
