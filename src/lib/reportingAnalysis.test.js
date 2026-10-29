// Reporting R3: hoja de análisis y memoria (piezas puras). El manifiesto y las
// reacciones de prueba son la salida real del calc-service (write_result +
// /analysis/sheets) para un modelo de prueba con dos patrones y tres modos.
const test = require("node:test");
const assert = require("node:assert/strict");

const fx = require("./fixtures/analysis-run.json");
const { analysisSnapshot, modelSummary, buildAnalysisDocument, buildMemoriaDocument } = require("./reportingAnalysis");
const { sha256 } = require("./reporting");

const run = {
  id: "a1", solvedAt: new Date("2026-10-29T12:00:00Z"), schemaVersion: fx.manifest.schemaVersion,
  activeDofs: [], notes: [], cases: fx.manifest.cases.map((c) => ({ name: c.name, key: c.key, kind: c.kind })),
  counts: fx.manifest.counts, modes: fx.manifest.modes, summary: fx.manifest.summary, stories: fx.manifest.stories,
  modelHash: "h",
};
const model = modelSummary({
  nodes: 3, supports: 1, areas: 0,
  elements: [{ frameSectionId: "s1" }, { frameSectionId: "s1" }, { frameSectionId: null }],
  sections: [{ id: "s1", name: "W14X99", materialId: "m1", source: "catalog" }],
  materials: [{ id: "m1", name: "A992", type: "steel", E: 2e8, Fy: 345000, Fu: 450000, fc: null }],
  configuration: {
    loadPatterns: [{ name: "DEAD", type: "dead", selfWeightMultiplier: 1 }],
    loadCombinations: [{ name: "1.4D", factors: [{ factor: 1.4, pattern: "DEAD" }] }],
  },
});

test("resumen del modelo: secciones con su número de barras y su material", () => {
  assert.deepEqual(model.counts, { nodes: 3, elements: 3, supports: 1, areas: 0 });
  assert.deepEqual(model.sections, [{ name: "W14X99", material: "A992", source: "catalog", members: 2 }]);
  assert.deepEqual(model.combinations[0].terms, [{ factor: 1.4, pattern: "DEAD", seismic: false }]);
});

test("la hoja de análisis sale de la ejecución guardada y de sus reacciones", () => {
  const s = analysisSnapshot({ run, sheets: fx.sheets, model });
  assert.equal(s.kind, "analysisSummary");
  assert.equal(s.run.id, "a1");
  assert.deepEqual(s.cases.map((c) => c.name), ["DEAD", "LIVE"]);
  const dead = s.cases[0];
  assert.deepEqual(dead.reactions.sum, { fx: 0, fy: 0, fz: 12.5 });
  assert.equal(dead.maxDisp.value, 0.03);
  assert.equal(s.modes.length, 3);
  assert.ok(s.modes[2].cumUx >= s.modes[0].ux);
  assert.ok(s.driftIndicative.length > 0);
});

test("un caso sin reacciones leídas no inventa una suma", () => {
  const s = analysisSnapshot({ run, sheets: { cases: [] }, model });
  assert.equal(s.cases[0].reactions, null);
});

test("documento de análisis y memoria con capítulos; lo no vigente se avisa", () => {
  const snap = analysisSnapshot({ run, sheets: fx.sheets, model });
  const doc = buildAnalysisDocument(snap, "es");
  assert.deepEqual(doc.blocks.map((b) => b.type), ["heading", "analysisSummary"]);
  assert.equal(doc.blocks[1].snapshotHash, sha256(snap));

  const memo = buildMemoriaDocument({ analysis: snap, members: null, connections: null, lang: "es" });
  assert.deepEqual(memo.blocks.map((b) => b.type), ["heading", "analysisSummary", "heading", "callout", "heading", "callout"]);
  assert.equal(memo.blocks[0].content[0].text, "1. Análisis estructural");
  assert.match(memo.blocks[3].content[0].text, /No hay una comprobación de diseño vigente/);

  const withMembers = buildMemoriaDocument({
    analysis: null,
    members: { document: { blocks: [{ id: "x", type: "heading", level: 1, content: [{ text: "Resumen" }] }] }, count: 1, all: false, tooMany: true },
    connections: { document: { blocks: [{ id: "pb", type: "pageBreak" }, { id: "y", type: "heading", level: 1, content: [{ text: "ST" }] }] }, count: 1 },
    lang: "en",
  });
  const types = withMembers.blocks.map((b) => b.type);
  assert.deepEqual(types, ["heading", "callout", "heading", "callout", "paragraph", "heading", "heading", "paragraph", "heading"]);
  assert.match(withMembers.blocks[4].content[0].text, /failing or incomplete/);
});
