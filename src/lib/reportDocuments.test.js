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

test("opciones de presentación de los bloques técnicos", () => {
  const withOptions = (options) => ({
    version: 1,
    blocks: [{ id: "a", type: "memberCheck", binding: doc.blocks[2].binding, snapshot: snapM, snapshotHash: sha256(snapM), options }],
  });
  assert.equal(validateDocument(withOptions({ unitSystem: "kip-ft", significantDigits: 3, sections: ["summary"], title: "Viga" })), null);
  assert.equal(validateDocument(withOptions(null)), null);
  assert.match(validateDocument(withOptions({ unitSystem: "parsecs" })), /invalid unitSystem/);
  assert.match(validateDocument(withOptions({ significantDigits: 9 })), /invalid significantDigits/);
  assert.match(validateDocument(withOptions({ sections: "modal" })), /invalid sections/);
  assert.match(validateDocument(withOptions({ formula: "x" })), /unknown option/);
});

test("las opciones no cambian la verificación y llegan al documento final", () => {
  const options = { unitSystem: "kip-ft", sections: ["summary"] };
  const blocks = doc.blocks.map((b) => (b.type === "memberCheck" ? { ...b, options } : b));
  const server = new Map([
    [bindingKey(doc.blocks[1]), { snapshot: snapC, state: "current" }],
    [bindingKey(doc.blocks[2]), { snapshot: snapM, state: "current" }],
  ]);
  const out = verifyDocument({ version: 1, blocks }, server, { warningText: () => "" });
  assert.deepEqual(out.problems, []);
  assert.deepEqual(out.document.blocks.find((b) => b.type === "memberCheck").options, options);
});

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

test("configuración de página del documento", () => {
  const page = {
    size: "a4",
    orientation: "landscape",
    margins: { top: 24, right: 20, bottom: 22.5, left: 20 },
    cover: false,
    toc: true,
    runningHeaders: true,
    chapterBreaks: false,
  };
  const withPage = (value) => ({ ...doc, page: value });
  assert.equal(validateDocument(doc), null);
  assert.equal(validateDocument(withPage(page)), null);
  assert.match(validateDocument(withPage({ ...page, size: "x; } body { display: none" })), /invalid page size/);
  assert.match(validateDocument(withPage({ ...page, margins: { ...page.margins, top: 2 } })), /invalid page margins/);
  assert.match(validateDocument(withPage({ ...page, margins: { top: 20 } })), /invalid page margins/);
  assert.match(validateDocument(withPage({ ...page, cover: "no" })), /invalid page cover/);
  assert.match(validateDocument(withPage({ ...page, css: "x" })), /unknown page setting/);
  assert.match(validateDocument(withPage("a4")), /invalid page/);
});

test("verificar conserva la página y no cambia las huellas", () => {
  const page = { size: "a4", cover: false };
  const server = new Map([
    ["c:r1", { snapshot: snapC, state: "current" }],
    ["m:d1:B1", { snapshot: snapM, state: "current" }],
  ]);
  const without = verifyDocument(doc, server, { warningText: warningText("es") });
  const withSetup = verifyDocument({ ...doc, page }, server, { warningText: warningText("es") });
  assert.deepEqual(withSetup.problems, []);
  assert.deepEqual(withSetup.document.page, page);
  assert.equal("page" in without.document, false);
  assert.deepEqual(withSetup.document.blocks, without.document.blocks);
});

test("un bloque de espectro se verifica contra la función de Define", () => {
  const snap = { kind: "spectrumSheet", rows: [[0, 0.3, 0.2, 0, 0, 0.1]] };
  const block = { id: "s", type: "spectrumSheet", binding: { source: "spectrumFunction", functionName: "Sismo 1" }, snapshot: snap, snapshotHash: sha256(snap) };
  const one = { version: 1, blocks: [block] };
  assert.equal(validateDocument(one), null);
  assert.equal(bindingKey(block), "s:Sismo 1");
  assert.equal(bindingKey({ ...block, binding: { source: "spectrumFunction" } }), null);
  const server = (snapshot) => new Map([["s:Sismo 1", { snapshot, state: "current" }]]);
  const opts = { warningText: warningText("es") };
  assert.deepEqual(verifyDocument(one, server(snap), opts).problems, []);
  assert.equal(verifyDocument(one, server({ ...snap, rows: [] }), opts).problems[0].reason, "changed");
  assert.equal(verifyDocument(one, new Map(), opts).problems[0].reason, "missing");
});

test("opciones de la tabla de un espectro", () => {
  const snap = { kind: "spectrumSheet" };
  const withOptions = (options) => ({
    version: 1,
    blocks: [{ id: "s", type: "spectrumSheet", binding: { source: "spectrumFunction", functionName: "RS-1" }, snapshot: snap, snapshotHash: sha256(snap), options }],
  });
  assert.equal(validateDocument(withOptions({ tableStep: 0.1, tableMax: 2, hiddenColumns: ["table.Av"] })), null);
  assert.match(validateDocument(withOptions({ tableStep: 0.05 })), /invalid tableStep/);
  assert.match(validateDocument(withOptions({ tableMax: 5 })), /invalid tableMax/);
});
