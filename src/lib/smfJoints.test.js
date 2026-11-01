const test = require("node:test");
const assert = require("node:assert/strict");
const { smfJoints, axisOf } = require("./smfJoints");

// Pórtico de un vano y dos niveles: columnas C1 (N1-N2), C2 (N2-N3), viga B1 (N2-N4).
const nodes = [
  { id: "N1", x: 0, y: 0, z: 0 },
  { id: "N2", x: 0, y: 0, z: 3 },
  { id: "N3", x: 0, y: 0, z: 6 },
  { id: "N4", x: 6, y: 0, z: 3 },
];
const elements = [
  { id: "C1", nodeA: "N1", nodeB: "N2" },
  { id: "C2", nodeA: "N2", nodeB: "N3" },
  { id: "B1", nodeA: "N2", nodeB: "N4" },
];
const run = (systemChecks, current = true) => ({ status: "done", current, result: "pass", systemChecks });

test("eje por inclinación, con la misma regla que el motor (30°)", () => {
  assert.equal(axisOf({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 3 }), "column");
  assert.equal(axisOf({ x: 0, y: 0, z: 0 }, { x: 6, y: 0, z: 0 }), "beam");
  assert.equal(axisOf({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 3 }), "column"); // 18°
});

test("solo son nudos SMF los de una viga SMF que llega a una columna", () => {
  assert.deepEqual(smfJoints({ nodes, elements, memberSystems: [{ elementId: "B1", type: "IMF" }], connections: [] }), []);
  const rows = smfJoints({ nodes, elements, memberSystems: [{ elementId: "B1", type: "SMF" }], connections: [] });
  // N4 es el extremo libre de la viga: sin columna, no es nudo.
  assert.deepEqual(rows.map((r) => r.nodeId), ["N2"]);
  assert.deepEqual(rows[0].columns.sort(), ["C1", "C2"]);
  assert.equal(rows[0].state, "pending");
  assert.equal(rows[0].scwb, null);
});

test("con conexión comprobada se toma su E3.4a y su zona de panel", () => {
  const conn = {
    id: "k1", name: "EP-1", typology: "extended_end_plate", nodeId: "N2",
    lastRun: run([
      { id: "preq.columnBeamMomentRatio", status: "pass", ratio: 0.8, ref: "E3.4a" },
      { id: "preq.panelZone", status: "fail", ratio: 1.2, ref: "E3.6e" },
      { id: "preq.panelZoneThickness", status: "pass", ratio: 0.5, ref: "E3-6" },
    ]),
  };
  const [row] = smfJoints({ nodes, elements, memberSystems: [{ elementId: "B1", type: "SMF" }], connections: [conn] });
  assert.deepEqual(row.scwb, { status: "pass", ratio: 0.8, ref: "E3.4a" });
  assert.equal(row.panelZone.status, "fail");
  assert.equal(row.panelZone.ratio, 1.2);
  assert.equal(row.state, "fail");
});

test("una comprobación no vigente no se da por buena", () => {
  const conn = {
    id: "k1", name: "EP-1", typology: "extended_end_plate", nodeId: "N2",
    lastRun: run([{ id: "preq.columnBeamMomentRatio", status: "pass", ratio: 0.8 },
                  { id: "preq.panelZone", status: "pass", ratio: 0.6 }], false),
  };
  const [row] = smfJoints({ nodes, elements, memberSystems: [{ elementId: "B1", type: "SMF" }], connections: [conn] });
  assert.equal(row.state, "stale");
});

test("una conexión sin requisitos de sistema (p. ej. shear tab) deja el nudo pendiente", () => {
  const conn = { id: "k2", name: "ST-1", typology: "shear_tab", nodeId: "N2", lastRun: run([]) };
  const [row] = smfJoints({ nodes, elements, memberSystems: [{ elementId: "B1", type: "SMF" }], connections: [conn] });
  assert.equal(row.state, "pending");
  assert.equal(row.connections.length, 1);
});
