const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createChangesetBuilder } = require("./changeset");
const { toBase, toDisplay, unitSystemById, unitLabel } = require("./units");

// Runner integrado de Node:  node --test src/services/ai/changeset.test.js

const MAT_ID = "0192f0a0-0000-7000-8000-000000000001";
const SEC_ID = "0192f0a0-0000-7000-8000-000000000002";

function builder(snapshot = {}, unitSystemId = "kn-m") {
  return createChangesetBuilder({
    snapshot: {
      nodes: [{ id: "N1", x: 0, y: 0, z: 0 }],
      elements: [],
      supports: [],
      configuration: { loadPatterns: [{ name: "Dead", type: "dead" }] },
      ...snapshot,
    },
    catalog: {
      materials: [{ id: MAT_ID, name: "H25", type: "concrete" }],
      sections: [{ id: SEC_ID, name: "V30x50", propertyType: "concrete" }],
    },
    unitSystemId,
  });
}

test("units: mismas conversiones que el frontend", () => {
  const knmm = unitSystemById("kn-mm");
  assert.equal(toDisplay(6, knmm, "length"), 6000);
  assert.equal(unitLabel(knmm, "modulus"), "kN/mm²");
  // 28 N/mm² = 28 000 kPa
  assert.ok(Math.abs(toBase(28, unitSystemById("n-mm"), "modulus") - 28000) < 1e-6);
  assert.equal(unitSystemById("no-existe").id, "kn-m");
});

test("add_frames crea nudos por coordenadas y reutiliza los existentes", () => {
  const b = builder();
  const r = b.apply({
    summary: "viga",
    operations: [{ type: "add_frames", frames: [{ i: [0, 0, 0], j: [6, 0, 0], section: "V30x50" }] }],
  });
  assert.equal(r.ok, true);
  const cs = b.finish();
  assert.deepEqual(
    cs.ops.map((o) => o.op),
    ["addNode", "addElement"]
  );
  assert.deepEqual(cs.ops[1].element, { id: "E1", nodeA: "N1", nodeB: "N2", frameSectionId: SEC_ID });
});

test("convierte desde las unidades del usuario a base kN·m", () => {
  const b = builder({}, "kn-mm");
  b.apply({
    summary: "nudo",
    operations: [{ type: "add_nodes", nodes: [[6000, 0, 3000]] }],
  });
  assert.deepEqual(b.finish().ops[0].node, { id: "N2", x: 6, y: 0, z: 3 });
});

test("inputUnits manda sobre el sistema del usuario", () => {
  const b = builder({}, "kn-m");
  b.apply({
    summary: "carga",
    inputUnits: "tonf-m",
    operations: [{ type: "add_nodal_loads", loads: [{ node: "N1", loadPattern: "Dead", fz: -2 }] }],
  });
  const load = b.finish().ops[0].load;
  assert.ok(Math.abs(load.fz - -19.6133) < 1e-6);
});

test("material y sección temporales se referencian entre sí", () => {
  const b = builder();
  const r = b.apply({
    summary: "hormigón",
    inputUnits: "n-mm",
    operations: [
      { type: "create_material", tempId: "h28", name: "H28", materialType: "concrete", fc: 28 },
      { type: "create_section", tempId: "c40", name: "C40x40", material: "h28", shape: "rectangular", b: 400, h: 400, designRole: "column" },
      { type: "add_frames", frames: [{ i: "N1", j: [0, 0, 3000], section: "c40" }] },
    ],
  });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  const ops = b.finish().ops;
  const mat = ops.find((o) => o.op === "createMaterial");
  assert.equal(mat.data.fc, 28000);
  assert.ok(Math.abs(mat.data.E - 4700 * Math.sqrt(28) * 1000) < 1);
  const sec = ops.find((o) => o.op === "createSection");
  assert.equal(sec.data.materialId, "tmp:h28");
  assert.equal(sec.data.b, 0.4);
  assert.equal(sec.data.reinforcement.designRole, "column");
  assert.equal(ops.find((o) => o.op === "addElement").element.frameSectionId, "tmp:c40");
});

test("una operación inválida rechaza la llamada entera", () => {
  const b = builder();
  const r = b.apply({
    summary: "mal",
    operations: [
      { type: "add_nodes", nodes: [[1, 1, 1]] },
      { type: "add_frame_loads", elements: ["E99"], loadPattern: "Dead", kind: "distributed", dir: "gravity", value: 10 },
    ],
  });
  assert.equal(r.ok, false);
  assert.match(r.errors.join(" "), /E99/);
  assert.equal(b.finish(), null);
});

test("hormigón con forma no permitida falla con el esquema del catálogo", () => {
  const b = builder();
  const r = b.apply({
    summary: "mal",
    operations: [{ type: "create_section", tempId: "x", name: "I", material: "H25", shape: "ishape", d: 0.5, bfTop: 0.2, tfTop: 0.02, tw: 0.01, bfBot: 0.2, tfBot: 0.02 }],
  });
  assert.equal(r.ok, false);
});

test("carga sobre un patrón inexistente pide crearlo", () => {
  const b = builder({ elements: [{ id: "E1", nodeA: "N1", nodeB: "N1" }] });
  const r = b.apply({
    summary: "carga",
    operations: [{ type: "add_frame_loads", elements: ["E1"], loadPattern: "Live", kind: "distributed", dir: "gravity", value: 5 }],
  });
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /add_load_patterns/);
});
