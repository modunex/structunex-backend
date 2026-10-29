const { test } = require("node:test");
const assert = require("node:assert/strict");
const { membersFromInspection, orphanReasons } = require("./connections");
const { shearTabParamsV1, createConnectionSchema } = require("../schemas/connectionSchema");

// node --test src/lib/connectionsF2.test.js

const INSPECTION = {
  joint: {
    nodeId: "J",
    members: [
      { elementId: "C1", end: "B", role: "supporting", typologies: [] },
      { elementId: "C2", end: "A", role: "supporting", typologies: [] },
      {
        elementId: "G1", end: "A", role: "supported",
        typologies: [{ typology: "shear_tab", applicable: true, reasons: [], supporting: ["C1", "C2"] }],
      },
      {
        elementId: "G2", end: "B", role: "supported",
        typologies: [{ typology: "shear_tab", applicable: false, reasons: ["typology.endNotPinned"], supporting: ["C1"] }],
      },
    ],
  },
};

test("una conexión nueva lleva la barra apoyada y sus apoyos, con su extremo", () => {
  assert.deepEqual(membersFromInspection(INSPECTION, "G1", "shear_tab"), {
    ok: true,
    members: [
      { elementId: "G1", end: "A", role: "supported" },
      { elementId: "C1", end: "B", role: "supporting" },
      { elementId: "C2", end: "A", role: "supporting" },
    ],
  });
});

test("si el motor dice que no aplica, no se crea y se devuelven sus motivos", () => {
  assert.deepEqual(membersFromInspection(INSPECTION, "G2", "shear_tab"), {
    ok: false,
    reasons: ["typology.endNotPinned"],
  });
  assert.equal(membersFromInspection(INSPECTION, "C1", "shear_tab").ok, false);
  assert.deepEqual(membersFromInspection(INSPECTION, "X9", "shear_tab").reasons, [
    "typology.memberNotAtJoint",
  ]);
});

test("una conexión queda huérfana si su nudo o sus barras cambian", () => {
  const conn = {
    nodeId: "J",
    members: [
      { elementId: "G1", end: "A", role: "supported" },
      { elementId: "C1", end: "B", role: "supporting" },
    ],
  };
  const model = (nodes, els) => ({
    nodeIds: new Set(nodes),
    elementsById: new Map(Object.entries(els)),
  });
  const ok = model(["J"], { G1: { nodeA: "J", nodeB: "K" }, C1: { nodeA: "B", nodeB: "J" } });
  assert.deepEqual(orphanReasons(conn, ok), []);
  const moved = model(["J"], { G1: { nodeA: "K", nodeB: "J" }, C1: { nodeA: "B", nodeB: "J" } });
  assert.deepEqual(orphanReasons(conn, moved), ["connection.memberMoved:G1"]);
  const gone = model([], { C1: { nodeA: "B", nodeB: "J" } });
  assert.deepEqual(orphanReasons(conn, gone), [
    "connection.nodeMissing",
    "connection.memberMissing:G1",
  ]);
});

test("parámetros v1: vacíos y nulos valen; lo desconocido se rechaza, no se descarta", () => {
  assert.equal(shearTabParamsV1.safeParse({}).success, true);
  assert.equal(
    shearTabParamsV1.safeParse({
      plate: { thickness: 0.0095, width: null },
      bolts: { diameter: 0.019, grade: "A325", threads: "N", rows: 3, pitch: 0.076 },
      weld: { size: 0.006, electrode: "E70" },
      boltLineDistance: 0.076,
      setback: 0.0127,
    }).success,
    true
  );
  // Un campo inventado o mal escrito: 400, no pérdida silenciosa.
  assert.equal(shearTabParamsV1.safeParse({ plate: { thicknes: 0.01 } }).success, false);
  assert.equal(shearTabParamsV1.safeParse({ extra: 1 }).success, false);
  // Formas imposibles.
  assert.equal(shearTabParamsV1.safeParse({ plate: { thickness: -0.01 } }).success, false);
  assert.equal(shearTabParamsV1.safeParse({ bolts: { rows: 2.5 } }).success, false);
  assert.equal(shearTabParamsV1.safeParse({ bolts: { grade: "A307" } }).success, false);
});

test("crear exige nudo, barra y una tipología conocida", () => {
  assert.equal(
    createConnectionSchema.safeParse({ nodeId: "J", elementId: "G1", typology: "shear_tab" }).success,
    true
  );
  assert.equal(
    createConnectionSchema.safeParse({ nodeId: "J", elementId: "G1", typology: "end_plate" }).success,
    false
  );
});
