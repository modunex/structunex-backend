// Reporting R4: verificación de los bloques técnicos de un documento antes de exportar.
const test = require("node:test");
const assert = require("node:assert/strict");

const { validateDocument, bindingKey, verifyDocument, blankDocument, warningText } = require("./reportDocuments");
const { sha256 } = require("./reporting");

const snapC = { kind: "connectionCheck", status: "pass", governing: { ratio: 0.5 } };
const snapM = { kind: "memberCheck", status: "ok" };
const doc = {
  version: 1,
  blocks: [
    { id: "h", type: "heading", level: 1, content: [{ text: "Memoria" }] },
    { id: "c", type: "connectionCheck", binding: { source: "connectionRun", connectionId: "c1", runId: "r1" }, snapshot: snapC, snapshotHash: sha256(snapC) },
    { id: "m", type: "memberCheck", binding: { source: "designRun", designRunId: "d1", elementId: "B1" }, snapshot: snapM, snapshotHash: sha256(snapM) },
  ],
};

test("validación del formato", () => {
  assert.equal(validateDocument(doc), null);
  assert.match(validateDocument({ version: 2, blocks: [] }), /version 1/);
  assert.match(validateDocument({ version: 1, blocks: [{ id: "x", type: "script" }] }), /unknown block type/);
  assert.match(validateDocument({ version: 1, blocks: [{ id: "x", type: "divider" }, { id: "x", type: "divider" }] }), /duplicate/);
  assert.match(validateDocument({ version: 1, blocks: [{ id: "x", type: "memberCheck", binding: { source: "designRun" }, snapshotHash: "" }] }), /invalid binding/);
});

test("claves de vínculo", () => {
  assert.equal(bindingKey(doc.blocks[1]), "c:r1");
  assert.equal(bindingKey(doc.blocks[2]), "m:d1:B1");
  assert.equal(bindingKey({ type: "analysisSummary", binding: { source: "analysisRun", analysisRunId: "a1" } }), "a:a1");
});

test("si las huellas coinciden, el PDF lleva la instantánea del SERVIDOR", () => {
  const server = new Map([
    ["c:r1", { snapshot: snapC, state: "current" }],
    ["m:d1:B1", { snapshot: snapM, state: "current" }],
  ]);
  const tampered = { ...doc, blocks: doc.blocks.map((b) => (b.id === "c" ? { ...b, snapshot: { ...snapC, governing: { ratio: 0.1 } } } : b)) };
  const { document, problems } = verifyDocument(tampered, server, { warningText: warningText("es") });
  assert.deepEqual(problems, []);
  // El cliente cambió el número de la instantánea sin cambiar la huella: sale el del servidor.
  assert.equal(document.blocks[1].snapshot.governing.ratio, 0.5);
});

test("una instantánea distinta, un dato borrado o un análisis caducado bloquean la exportación", () => {
  const otherC = { ...snapC, governing: { ratio: 0.9 } };
  const server = new Map([
    ["c:r1", { snapshot: otherC, state: "current" }],
    ["m:d1:B1", { error: "missing" }],
  ]);
  const { problems } = verifyDocument(doc, server, { warningText: warningText("es") });
  assert.deepEqual(problems, [
    { blockId: "c", type: "connectionCheck", reason: "changed" },
    { blockId: "m", type: "memberCheck", reason: "missing" },
  ]);
});

test("un bloque no vigente sale con un aviso delante", () => {
  const server = new Map([
    ["c:r1", { snapshot: snapC, state: "superseded" }],
    ["m:d1:B1", { snapshot: snapM, state: "stale", staleReasons: ["analysis.outdated"] }],
  ]);
  const { document, problems } = verifyDocument(doc, server, { warningText: warningText("es") });
  assert.deepEqual(problems, []);
  assert.deepEqual(document.blocks.map((b) => b.type), ["heading", "callout", "connectionCheck", "callout", "memberCheck"]);
  assert.match(document.blocks[1].content[0].text, /comprobación posterior/);
});

test("documento en blanco", () => {
  assert.equal(validateDocument(blankDocument("Memoria")), null);
});

test("la plantilla solo guarda títulos y bloques técnicos (lo verificable)", () => {
  const { templateBlocks } = require("./reportDocuments");
  const kept = templateBlocks([
    { id: "h", type: "heading" }, { id: "t", type: "table" }, { id: "p", type: "paragraph" },
    { id: "w", type: "callout" }, { id: "m", type: "memberCheck" },
  ]);
  assert.deepEqual(kept.map((b) => b.id), ["h", "m"]);
});

test("los ids reservados del servidor no se aceptan en un documento", () => {
  assert.match(validateDocument({ version: 1, blocks: [{ id: "__warn-x", type: "divider" }] }), /reserved/);
});

test("el aviso de un bloque no vigente explica el motivo en texto, no con claves", () => {
  assert.match(warningText("es")("stale", ["loads.changed"]), /combinaciones de carga cambiaron/);
});

test("plantilla informe sismorresistente: 9 capítulos, solo títulos y guías, documento válido", () => {
  const { seismicReportDocument } = require("./reportDocuments");
  for (const lang of ["es", "en"]) {
    const doc = seismicReportDocument("Informe", lang);
    assert.equal(validateDocument(doc), null);
    const chapters = doc.blocks.filter((b) => b.type === "heading" && b.id.startsWith("t-h"));
    assert.equal(chapters.length, 9);
    assert.match(chapters[0].content[0].text, /^1\. /);
    // La plantilla nunca trae datos técnicos: los inserta el usuario desde el archivo.
    assert.ok(doc.blocks.every((b) => ["heading", "paragraph"].includes(b.type)));
  }
});
