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

test("modelo plano: rechaza nudos nuevos fuera de Y = 0", () => {
  const b = builder({ dim: "2D", analysisType: "plane_frame", activeDofs: ["UX", "UZ", "RY"] });
  const bad = b.apply({ summary: "x", operations: [{ type: "add_frames", frames: [{ i: "N1", j: [0, 4, 3] }] }] });
  assert.equal(bad.ok, false);
  assert.match(bad.errors[0], /Y ≠ 0/);
  const ok = b.apply({ summary: "x", operations: [{ type: "add_frames", frames: [{ i: "N1", j: [0, 0, 3] }] }] });
  assert.equal(ok.ok, true);
});

test("cargas de nudo sobre GDL inactivos se rechazan", () => {
  const b = builder({ analysisType: "plane_truss", activeDofs: ["UX", "UZ"] });
  const r = b.apply({
    summary: "x",
    operations: [{ type: "add_nodal_loads", loads: [{ node: "N1", loadPattern: "Dead", fz: -10, my: 5 }] }],
  });
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /my/);
});

test("set_grid convierte a base y valida ejes", () => {
  const b = builder({}, "kn-mm");
  const r = b.apply({
    summary: "rejilla",
    operations: [{ type: "set_grid", x: [{ id: "B", at: 6000 }, { id: "A", at: 0 }], z: [{ id: "PB", at: 0 }] }],
  });
  assert.equal(r.ok, true);
  const op = b.finish().ops.find((o) => o.op === "setGrid");
  assert.deepEqual(op.grid.x, [{ id: "A", ordinate: 0 }, { id: "B", ordinate: 6 }]);
  assert.equal(op.grid.y, undefined);

  const dup = b.apply({ summary: "x", operations: [{ type: "set_grid", x: [{ id: "A", at: 0 }, { id: "A", at: 3 }] }] });
  assert.equal(dup.ok, false);
  const plane = builder({ dim: "2D" }).apply({ summary: "x", operations: [{ type: "set_grid", y: [{ id: "1", at: 5 }] }] });
  assert.equal(plane.ok, false);
});

test("set_active_dofs se limita a la formulación y afecta a las cargas siguientes", () => {
  const b = builder({ analysisType: "plane_frame", activeDofs: ["UX", "UZ", "RY"] });
  const bad = b.apply({ summary: "x", operations: [{ type: "set_active_dofs", dofs: ["UX", "UY"] }] });
  assert.equal(bad.ok, false);
  const r = b.apply({
    summary: "x",
    operations: [
      { type: "set_active_dofs", dofs: ["UX", "UZ"] },
      { type: "add_nodal_loads", loads: [{ node: "N1", loadPattern: "Dead", my: 5 }] },
    ],
  });
  assert.equal(r.ok, false);
  const ok = b.apply({ summary: "x", operations: [{ type: "set_active_dofs", dofs: null }] });
  assert.equal(ok.ok, true);
  assert.deepEqual(b.finish().ops, [{ op: "setActiveDofs", dofs: null }]);
});

test("add_frame_loads: trapezoidal local con distancias absolutas se convierte a base", () => {
  const b = builder({
    nodes: [{ id: "N1", x: 0, y: 0, z: 0 }, { id: "N2", x: 6, y: 0, z: 0 }],
    elements: [{ id: "E1", nodeA: "N1", nodeB: "N2" }],
  }, "kn-mm");
  const r = b.apply({
    summary: "trapecio",
    operations: [{
      type: "add_frame_loads", elements: ["E1"], loadPattern: "Dead", kind: "distributed",
      dir: "local2", value: -5, value2: -10, dist: 1000, dist2: 4000, distAbsolute: true,
    }],
  });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  const { frameLoad } = b.finish().ops.find((o) => o.op === "addFrameLoad");
  assert.equal(frameLoad.dir, "local2");
  assert.equal(frameLoad.dist, 1);
  assert.equal(frameLoad.dist2, 4);
  assert.equal(frameLoad.distAbsolute, true);
  // kN/mm -> kN/m
  assert.equal(frameLoad.value, -5000);
  assert.equal(frameLoad.value2, -10000);
});

test("add_frame_loads: rechaza relativas > 1 y absolutas fuera de la barra", () => {
  const snap = {
    nodes: [{ id: "N1", x: 0, y: 0, z: 0 }, { id: "N2", x: 6, y: 0, z: 0 }],
    elements: [{ id: "E1", nodeA: "N1", nodeB: "N2" }],
  };
  const op = (extra) => ({
    summary: "x",
    operations: [{ type: "add_frame_loads", elements: ["E1"], loadPattern: "Dead", kind: "point",
      dir: "gravity", value: 10, ...extra }],
  });
  assert.equal(builder(snap).apply(op({ dist: 2.5 })).ok, false);
  assert.equal(builder(snap).apply(op({ dist: 7, distAbsolute: true })).ok, false);
  assert.equal(builder(snap).apply(op({ dist: 2.5, distAbsolute: true })).ok, true);
});
