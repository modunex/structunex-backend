// Reporting R2: hojas de miembros (piezas puras). Las hojas de prueba son la salida
// real de /design/sheets del calc-service para un W14X99 y un C15X33.9 comprimido
// (este último con una comprobación obligatoria que el motor no hace: E4).
const test = require("node:test");
const assert = require("node:assert/strict");

const fixtures = require("./fixtures/design-sheets.json");
const {
  archiveDesignRuns,
  buildMembersDocument,
  hasSheet,
  memberListRow,
  memberSnapshot,
} = require("./reportingMembers");
const { sha256 } = require("./reporting");

const designRun = { id: "d1", startedAt: "2026-10-29T12:00:00Z", finishedAt: "2026-10-29T12:00:05Z", analysisRunId: "a1", schemaVersion: 2 };

test("la instantánea de la hoja sale de lo que guardó el motor", () => {
  const s = memberSnapshot(fixtures.w, "c1", designRun);
  assert.equal(s.kind, "memberCheck");
  assert.equal(s.member.role, "steel");
  assert.equal(s.inputs.sectionName, "W14X99");
  assert.equal(s.status, "ok");
  assert.equal(s.verification, "complete");
  assert.equal(s.governing.name, "H1-1");
  assert.equal(s.run.engineVersion, "design-1.0.0");
  assert.equal(s.run.analysisRunId, "a1");
  const pc = s.criteria.find((c) => c.name === "Pc");
  assert.equal(pc.unit, "kN");
  assert.match(pc.equation, /^\\phi_c P_n/);
  assert.ok(pc.vars.length > 0);
  assert.equal(s.demands.N, fixtures.w.members.find((m) => m.elementId === "c1").axial);
  assert.ok(s.messages.some((m) => m.key === "steel.defaultK"));
});

test("un criterio no verificado no lleva traza ni pasa por cumple", () => {
  const s = memberSnapshot(fixtures.c, "c1", designRun);
  assert.equal(s.verification, "incomplete");
  const nv = s.criteria.filter((c) => c.status === "notVerified");
  assert.ok(nv.length > 0);
  for (const c of nv) {
    assert.equal(c.equation, undefined);
    assert.ok(c.reason);
  }
});

test("una barra sin comprobar no tiene hoja", () => {
  const sheets = { run: {}, members: [{ elementId: "x", role: "unchecked", status: "unchecked", inputs: null }] };
  assert.equal(memberSnapshot(sheets, "x", designRun), null);
  assert.equal(memberSnapshot(sheets, "nope", designRun), null);
  assert.equal(hasSheet(sheets.members[0]), false);
});

test("fila de lista", () => {
  const row = memberListRow(fixtures.w.members.find((m) => m.elementId === "c1"));
  assert.equal(row.sectionName, "W14X99");
  assert.equal(row.governing, "H1-1");
});

test("archivo de ejecuciones de diseño: vigente, desactualizada, reemplazada", () => {
  const runs = [
    { id: "old", startedAt: "2026-10-01T00:00:00Z", analysisRunId: "a0", schemaVersion: 1 },
    { id: "new", startedAt: "2026-10-02T00:00:00Z", analysisRunId: "a1", schemaVersion: 2 },
  ];
  const [a, b] = archiveDesignRuns(runs, { latestSolvedRunId: "a1", latestStaleReason: null });
  assert.deepEqual([a.designRunId, a.state, a.sheetsAvailable], ["new", "current", true]);
  assert.deepEqual([b.designRunId, b.state, b.sheetsAvailable], ["old", "superseded", false]);

  assert.deepEqual(archiveDesignRuns(runs, { latestSolvedRunId: "a2" })[0].staleReasons, ["analysis.outdated"]);
  assert.deepEqual(
    archiveDesignRuns(runs, { latestSolvedRunId: "a1", latestStaleReason: "analysis.stale" })[0].staleReasons,
    ["model.changed"]
  );
  assert.deepEqual(archiveDesignRuns(runs, { latestSolvedRunId: null })[0].staleReasons, ["analysis.missing"]);
});

test("documento de miembros: resumen, aviso de vigencia y una hoja por barra", () => {
  const a = memberSnapshot(fixtures.w, "c1", designRun);
  const b = memberSnapshot(fixtures.c, "c1", { ...designRun, id: "d2" });
  const doc = buildMembersDocument([a, b], { lang: "es", staleReasons: ["analysis.outdated"] });
  assert.deepEqual(doc.blocks.map((x) => x.type), [
    "callout", "heading", "table", "heading", "memberCheck", "heading", "callout", "memberCheck",
  ]);
  const table = doc.blocks[2];
  assert.equal(table.rows.length, 3);
  assert.equal(table.rows[2][5][0].text, "Incompleta");
  const k = doc.blocks[4];
  assert.equal(k.display, "full");
  assert.deepEqual(k.binding, { source: "designRun", designRunId: "d1", elementId: "c1" });
  assert.equal(k.snapshotHash, sha256(a));
  assert.match(doc.blocks[6].content[0].text, /no puede darse por buena/);
});
