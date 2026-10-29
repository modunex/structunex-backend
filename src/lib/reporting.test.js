// Reporting R1: piezas puras (instantánea, archivo, documento).
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  connectionSnapshot,
  archiveConnections,
  buildConnectionsDocument,
  reportMeta,
  sha256,
} = require("./reporting");

const connection = {
  id: "c1",
  name: "ST-N3-B2",
  nodeId: "N3",
  supportedElementId: "B2",
  typology: "shear_tab",
  status: "checked",
  params: { plate: { thickness: 0.02 } }, // editada DESPUÉS de la ejecución
};

const run = {
  id: "r1",
  createdAt: new Date("2026-10-29T12:00:00Z"),
  engineVersion: "connections-0.6.0",
  inputsHash: "h1",
  analysisRunId: "a1",
  code: "AISC360-16",
  method: "LRFD",
  inputs: {
    connection: { typology: "shear_tab", params: { plate: { thickness: 0.0127 } } },
    plateMaterial: { name: "A572 Gr.50", Fy: 344737.86, Fu: 448159.22 },
  },
  results: {
    status: "pass",
    procedure: "AISC 360-16 + Manual Part 10",
    governing: { id: "bolts.shear", ratio: 0.165, combination: "1.4D" },
    members: {
      supported: { elementId: "B2", section: "W18X50" },
      supporting: { elementId: "C1", section: "W14X90", face: "flange", kind: "column" },
    },
    context: { beam: { Fy: 344737.86, Fu: 448159.22 }, support: { Fy: 344737.86, Fu: NaN } },
    demands: [{ label: "1.4D", V: 84, N: 0, V3: 0 }],
    limitStates: [
      {
        id: "bolts.shear", group: "bolts", ref: "J3.6", status: "pass", ratio: 0.165,
        capacity: 508.2, demand: 84, unit: "kN", combination: "1.4D", details: { n: 5 },
        equation: "\\phi R_n = C\\,\\phi r_n", vars: [{ symbol: "C", value: 4.691, unit: "-" }],
      },
      { id: "plate.compression", group: "plate", ref: "J4.4", status: "notVerifiable", ratio: null,
        capacity: null, demand: null, unit: "kN", combination: null, reason: "check.missingK" },
      { id: "conventional.rows", group: "scope", ref: "Table 10-9", status: "pass", ratio: null,
        capacity: null, demand: null, unit: "-", combination: null, pendingSourceReview: true },
    ],
    assumptions: ["beam.uncoped"],
    messages: [{ severity: "warning", key: "check.pendingSourceReview" }],
  },
};

test("la instantánea sale de la ejecución, no de la conexión editada después", () => {
  const s = connectionSnapshot(connection, run);
  assert.equal(s.kind, "connectionCheck");
  assert.equal(s.version, 1);
  assert.deepEqual(s.params, { plate: { thickness: 0.0127 } });
  assert.equal(s.connection.name, "ST-N3-B2");
  assert.equal(s.run.createdAt, "2026-10-29T12:00:00.000Z");
  assert.deepEqual(s.run, {
    id: "r1", createdAt: "2026-10-29T12:00:00.000Z", engineVersion: "connections-0.6.0",
    inputsHash: "h1", analysisRunId: "a1",
  });
  assert.deepEqual(s.materials.plate, { name: "A572 Gr.50", Fy: 344737.86, Fu: 448159.22 });
  assert.equal(s.materials.support.Fu, null, "NaN nunca llega a la hoja como número");
  assert.deepEqual(s.demands, [{ label: "1.4D", V: 84, N: 0 }]);
  assert.deepEqual(s.members.supporting, { elementId: "C1", section: "W14X90", face: "flange", kind: "column" });
});

test("la traza solo existe donde la produjo el motor", () => {
  const [bolts, comp, rows] = connectionSnapshot(connection, run).limitStates;
  assert.equal(bolts.equation, "\\phi R_n = C\\,\\phi r_n");
  assert.deepEqual(bolts.vars, [{ symbol: "C", value: 4.691, unit: "-" }]);
  assert.equal("details" in bolts, false);
  assert.equal(comp.equation, undefined);
  assert.equal(comp.reason, "check.missingK");
  assert.equal(rows.pendingSourceReview, true);
});

test("un resultado sin estado no se presenta como cumple", () => {
  const s = connectionSnapshot(connection, { ...run, results: {} });
  assert.equal(s.status, "notVerifiable");
  assert.deepEqual(s.limitStates, []);
});

const summary = (id, createdAt, analysisRunId = "a2") => ({
  id, connectionId: "c1", createdAt, engineVersion: "e", analysisRunId, inputsHash: "h",
  code: "AISC360-16", method: "LRFD", result: "pass", governing: null,
});

test("archivo: la última es vigente y las anteriores reemplazadas", () => {
  const [c] = archiveConnections(
    [{ ...connection, orphanReasons: [] }],
    [summary("old", "2026-10-01T00:00:00Z", "a1"), summary("new", "2026-10-02T00:00:00Z")],
    { latestSolvedRunId: "a2" }
  );
  assert.equal(c.latest.runId, "new");
  assert.equal(c.latest.state, "current");
  assert.deepEqual(c.history.map((e) => [e.runId, e.state]), [["old", "superseded"]]);
});

test("archivo: motivos de desactualización", () => {
  const runs = [summary("r", "2026-10-02T00:00:00Z", "a1")];
  const [c] = archiveConnections(
    [{ ...connection, status: "draft", orphanReasons: ["connection.nodeMissing"] }],
    runs,
    { latestSolvedRunId: "a2" }
  );
  assert.equal(c.latest.state, "stale");
  assert.deepEqual(c.latest.staleReasons, ["connection.orphaned", "connection.edited", "analysis.outdated"]);
  assert.equal(c.orphaned, true);

  const [d] = archiveConnections([{ ...connection, orphanReasons: [] }], runs, { latestSolvedRunId: null });
  assert.deepEqual(d.latest.staleReasons, ["analysis.missing"]);
});

test("archivo: una conexión sin comprobar aparece sin hojas", () => {
  const [c] = archiveConnections([{ ...connection, orphanReasons: [] }], [], { latestSolvedRunId: "a2" });
  assert.equal(c.latest, null);
  assert.deepEqual(c.history, []);
});

test("documento: una hoja completa por comprobación; aviso delante de la no vigente", () => {
  const a = connectionSnapshot(connection, run);
  const b = connectionSnapshot(connection, { ...run, id: "r0" });
  const doc = buildConnectionsDocument([{ snapshot: a }, { snapshot: b, staleReasons: ["analysis.outdated"] }], "es");
  assert.equal(doc.version, 1);
  assert.deepEqual(doc.blocks.map((x) => x.type), [
    "heading", "connectionCheck", "pageBreak", "heading", "callout", "connectionCheck",
  ]);
  const [, k1, , , warn, k2] = doc.blocks;
  assert.equal(k1.display, "full");
  assert.deepEqual(k1.binding, { source: "connectionRun", connectionId: "c1", runId: "r1" });
  assert.equal(k1.snapshotHash, sha256(a));
  assert.equal(k2.binding.runId, "r0");
  assert.equal(warn.tone, "warning");
  assert.match(warn.content.map((c) => c.text).join(""), /análisis anterior/);
  const en = buildConnectionsDocument([{ snapshot: b, staleReasons: ["run.superseded"] }], "en");
  assert.match(en.blocks[1].content.map((c) => c.text).join(""), /later check/);
});

test("la huella no depende del orden de las claves", () => {
  assert.equal(sha256({ a: 1, b: [1, 2] }), sha256({ b: [1, 2], a: 1 }));
});

test("metadatos de portada desde el proyecto", () => {
  const m = reportMeta(
    { name: "Torre A", client: "ACME", company: null, engineer: "FM" },
    { lang: "en", date: new Date("2026-10-29T23:00:00Z") }
  );
  assert.deepEqual(m, {
    title: "Connection design report", project: "Torre A", client: "ACME", company: null,
    engineer: "FM", revision: "0", date: "2026-10-29", logoUrl: null,
  });
});
