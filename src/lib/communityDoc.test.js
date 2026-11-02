const test = require("node:test");
const assert = require("node:assert/strict");
const { sanitizeDocument, safeHref, DocumentError } = require("./communityDoc");

const para = (...content) => ({ type: "paragraph", content });
const text = (value, marks) => ({ type: "text", text: value, ...(marks ? { marks } : {}) });
const doc = (...content) => ({ type: "doc", content });
const ID = "019a0000-0000-7000-8000-000000000001";

test("conserva el contenido permitido y extrae el texto", () => {
  const out = sanitizeDocument(
    doc(
      { type: "heading", attrs: { level: 2 }, content: [text("Título")] },
      para(text("Hola "), text("mundo", [{ type: "bold" }])),
      { type: "bulletList", content: [{ type: "listItem", content: [para(text("uno"))] }] },
      { type: "blockMath", attrs: { latex: "\\phi R_n" } }
    )
  );
  assert.equal(out.doc.content.length, 4);
  assert.equal(out.text, "Título Hola mundo uno \\phi R_n");
});

test("elimina atributos que no están en la lista", () => {
  const out = sanitizeDocument(
    doc({ type: "paragraph", attrs: { onclick: "alert(1)", style: "x" }, content: [text("a")] })
  );
  assert.deepEqual(out.doc.content[0], { type: "paragraph", content: [{ type: "text", text: "a" }] });
});

for (const type of ["script", "iframe", "htmlBlock", "video", "embed", "table", "doc"]) {
  test(`rechaza el nodo ${type}`, () => {
    assert.throws(() => sanitizeDocument(doc({ type, content: [] })), DocumentError);
  });
}

test("rechaza un nodo no permitido anidado", () => {
  assert.throws(
    () => sanitizeDocument(doc({ type: "blockquote", content: [{ type: "script" }] })),
    DocumentError
  );
});

for (const href of [
  "javascript:alert(1)",
  "JaVaScRiPt:alert(1)",
  " javascript:alert(1)",
  "java\tscript:alert(1)",
  "data:text/html,<script>alert(1)</script>",
  "vbscript:msgbox(1)",
  "/relativa",
  "//evil.com",
  "https://user:pass@evil.com",
]) {
  test(`rechaza el enlace ${JSON.stringify(href)}`, () => {
    assert.throws(
      () => sanitizeDocument(doc(para(text("x", [{ type: "link", attrs: { href } }])))),
      DocumentError
    );
  });
}

test("conserva enlaces http(s) y descarta sus demás atributos", () => {
  const out = sanitizeDocument(
    doc(para(text("x", [{ type: "link", attrs: { href: "https://a.com/b", target: "_top", onmouseover: "x" } }])))
  );
  assert.deepEqual(out.doc.content[0].content[0].marks, [
    { type: "link", attrs: { href: "https://a.com/b" } },
  ]);
});

test("rechaza marcas desconocidas", () => {
  assert.throws(
    () => sanitizeDocument(doc(para(text("x", [{ type: "textStyle", attrs: { color: "red" } }])))),
    DocumentError
  );
});

test("una imagen solo admite un adjunto, nunca una URL", () => {
  assert.throws(
    () => sanitizeDocument(doc({ type: "image", attrs: { src: "https://evil.com/a.png" } })),
    DocumentError
  );
  const out = sanitizeDocument(
    doc({ type: "image", attrs: { attachmentId: ID, alt: "Detalle", src: "https://evil.com/a.png" } })
  );
  assert.deepEqual(out.doc.content[0].attrs, { attachmentId: ID, alt: "Detalle" });
  assert.deepEqual(out.imageIds, [ID]);
});

test("limita niveles de título, profundidad y longitud", () => {
  assert.throws(
    () => sanitizeDocument(doc({ type: "heading", attrs: { level: 1 }, content: [text("x")] })),
    DocumentError
  );
  let deep = para(text("x"));
  for (let i = 0; i < 20; i += 1) deep = { type: "blockquote", content: [deep] };
  assert.throws(() => sanitizeDocument(doc(deep)), DocumentError);
  assert.throws(() => sanitizeDocument(doc(para(text("x".repeat(40001))))), DocumentError);
});

test("rechaza entradas que no son un documento", () => {
  for (const value of [null, "x", [], {}, { type: "doc" }, { type: "paragraph", content: [] }]) {
    assert.throws(() => sanitizeDocument(value), DocumentError);
  }
});

test("safeHref normaliza http(s)", () => {
  assert.equal(safeHref("https://structunex.com"), "https://structunex.com/");
  assert.equal(safeHref("ftp://a.com"), null);
});
