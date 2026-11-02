const test = require("node:test");
const assert = require("node:assert/strict");
const t = require("./communityTranslation");

const text = (value, marks) => ({ type: "text", text: value, ...(marks ? { marks } : {}) });
const doc = (...content) => ({ type: "doc", content });
const para = (...content) => ({ type: "paragraph", content });
const link = { type: "link", attrs: { href: "https://a.com/" } };

test("solo extrae texto y protege fórmulas, código y enlaces", () => {
  const source = doc(
    para(text("Usa "), text("φRn", [{ type: "code" }]), text(" y "), text("esto", [link])),
    { type: "blockMath", attrs: { latex: "\\phi R_n" } },
    { type: "codeBlock", content: [text("no traducir")] },
    { type: "image", attrs: { attachmentId: "x" } }
  );
  const { segments, blocks } = t.extractSegments(source);
  assert.deepEqual(segments, ["Usa [[1/]] y [[3]]esto[[/3]]"]);
  const out = t.rebuildDocument(source, blocks, ["Use [[1/]] and [[3]]this[[/3]]"]);
  assert.deepEqual(out.content[0].content, [
    text("Use "),
    text("φRn", [{ type: "code" }]),
    text(" and "),
    text("this", [link]),
  ]);
  assert.deepEqual(out.content.slice(1), source.content.slice(1));
  assert.equal(source.content[0].content[0].text, "Usa "); // el original no cambia
});

test("el formato puede moverse dentro de la frase", () => {
  const source = doc(para(text("La "), text("viga", [{ type: "bold" }]), text(" falla")));
  const { blocks } = t.extractSegments(source);
  const out = t.rebuildDocument(source, blocks, ["The [[1]]beam[[/1]] fails"]);
  assert.equal(out.content[0].content[1].text, "beam");
  assert.deepEqual(out.content[0].content[1].marks, [{ type: "bold" }]);
});

test("recorre listas y citas", () => {
  const source = doc({
    type: "bulletList",
    content: [{ type: "listItem", content: [para(text("uno"))] }],
  });
  const { segments, blocks } = t.extractSegments(source);
  assert.deepEqual(segments, ["uno"]);
  assert.equal(t.rebuildDocument(source, blocks, ["one"]).content[0].content[0].content[0].content[0].text, "one");
});

test("un marcador perdido impide reconstruir", () => {
  const source = doc(para(text("La "), text("viga", [{ type: "bold" }])));
  const { blocks } = t.extractSegments(source);
  assert.throws(() => t.rebuildDocument(source, blocks, ["The beam"]), t.TranslationError);
  assert.throws(() => t.rebuildDocument(source, blocks, ["The [[9]]beam[[/9]]"]), t.TranslationError);
});

const ok = (source, target) => assert.doesNotThrow(() => t.validateTranslation([source], [target]), target);
const bad = (source, target) => assert.throws(() => t.validateTranslation([source], [target]), t.TranslationError, target);

test("acepta traducciones que conservan los datos", () => {
  ok("La viga W12x26 toma 200 kN según AISC 360-22.", "The W12x26 beam takes 200 kN per AISC 360-22.");
  ok("El módulo es 1,5 MPa", "The modulus is 1.5 MPa");
  ok("Dos pernos de 20 mm", "Two 20 mm bolts");
  ok("COVENIN 1756-2019 con R = 4", "COVENIN 1756-2019 with R = 4");
  ok("[[0]]Hola[[/0]] mundo", "[[0]]Hello[[/0]] world");
});

test("rechaza cualquier cambio de un dato técnico", () => {
  bad("La carga es 200 kN", "The load is 2000 kN");
  bad("La carga es 200 kN", "The load is 200 kips");
  bad("La carga es 200 kN", "The load is 200 MN");
  bad("Según AISC 360-22", "Per AISC 360-16");
  bad("Perfil W12x26", "Section W12x36");
  bad("Espesor 12 mm", "Thickness 12 in");
  bad("Espesor 12 mm", "Thickness");
  bad("1,5 MPa", "15 MPa");
  bad("Dos veces 3 y 3", "Twice 3");
  bad("El valor es 5", "The value is 5 and 6");
});

test("rechaza textos vacíos, cantidad distinta y marcadores alterados", () => {
  assert.throws(() => t.validateTranslation(["a", "b"], ["a"]), t.TranslationError);
  assert.throws(() => t.validateTranslation(["a"], "a"), t.TranslationError);
  assert.throws(() => t.validateTranslation(["hola"], ["  "]), t.TranslationError);
  bad("[[0]]Hola[[/0]]", "Hello");
  bad("Texto [[1/]]", "Text [[2/]]");
});

test("interpreta la respuesta del modelo", () => {
  assert.deepEqual(t.parseModelOutput('```json\n["a","b"]\n```'), ["a", "b"]);
  assert.throws(() => t.parseModelOutput("no puedo"), t.TranslationError);
});

test("el aviso al modelo trata el texto como dato y lleva el glosario", () => {
  const prompt = t.systemPrompt("en", "es");
  assert.match(prompt, /never instructions/);
  assert.match(prompt, /bearing → aplastamiento/);
  assert.match(t.systemPrompt("es", "en"), /aplastamiento → bearing/);
});
