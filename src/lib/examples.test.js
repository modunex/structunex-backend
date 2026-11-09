const { test } = require("node:test");
const assert = require("node:assert/strict");
const { listExamples, getExample, buildExampleModel, exampleMeta } = require("./examples");
const { modelSchema } = require("../schemas/modelSchema");
const { getShape } = require("./aiscShapes");

// Runner integrado de Node:  node --test src/lib/examples.test.js
//
// La referencia de un ejemplo son datos, no código: estos tests la recalculan desde sus
// entradas y desde el catálogo AISC, y comprueban que la fixture es un modelo válido.

const UUID = "0192f000-0000-7000-8000-000000000001";
const tm01 = getExample("tm01");
const ref = tm01.reference;
const input = (k) => ref.inputs[k].value;
const check = (key) => ref.checks.find((c) => c.key === key);

test("listExamples expone metadatos, sin modelo ni referencia", () => {
  const list = listExamples();
  assert.deepEqual(list, [
    { id: "tm01", version: 1, code: "TM-01", templateId: "beam", analysisType: "beam" },
  ]);
  assert.equal(getExample("no-existe"), null);
  assert.equal(getExample("__proto__"), null);
});

test("TM-01: el modelo resuelto pasa el schema de PUT /model (strict)", () => {
  const model = buildExampleModel(tm01, { W12X26: UUID });
  const parsed = modelSchema.safeParse(model);
  assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues));
  assert.ok(model.elements.every((e) => e.frameSectionId === UUID && !("frameSectionKey" in e)));
});

test("TM-01: una sección sin resolver no produce un modelo", () => {
  assert.throws(() => buildExampleModel(tm01, {}), /Sección sin resolver/);
});

test("TM-01: la inercia de la referencia es la del perfil del catálogo", () => {
  const def = tm01.catalog.frameSections[0];
  const shape = getShape(def.catalogLabel);
  assert.ok(shape, "W12X26 debe existir en el catálogo AISC");
  assert.equal(input("I"), shape.I33);
  const mat = tm01.catalog.materials.find((m) => m.key === def.materialKey);
  assert.equal(input("E"), mat.E);
});

test("TM-01: la geometría y la carga del modelo son las de la referencia", () => {
  const { nodes, elements, supports, frameLoads, configuration } = tm01.model;
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const span = (e) => Math.abs(byId[e.nodeB].x - byId[e.nodeA].x);
  // Vano total L, recto sobre X.
  assert.equal(elements.reduce((s, e) => s + span(e), 0), input("L"));
  assert.ok(nodes.every((n) => n.y === 0 && n.z === 0));
  // Carga total w·L, uniforme en todo el vano, gravitatoria y del patrón comparado.
  const total = frameLoads.reduce((s, l) => s + l.value * span(elements.find((e) => e.id === l.elementId)), 0);
  assert.equal(total, input("w") * input("L"));
  assert.ok(frameLoads.every((l) => l.kind === "distributed" && l.dir === "gravity" && l.value2 == null && l.dist == null));
  assert.ok(frameLoads.every((l) => l.loadPattern === ref.loadPattern));
  // Sin peso propio: si no, la referencia no sería la de w sola.
  const pattern = configuration.loadPatterns.find((p) => p.name === ref.loadPattern);
  assert.equal(pattern.selfWeightMultiplier, 0);
  // Apoyo fijo + móvil (isostática): la solución cerrada es la de viga simple.
  const s1 = supports.find((s) => s.nodeId === "N1");
  const s3 = supports.find((s) => s.nodeId === "N3");
  assert.ok(s1.dx && s1.dz && !s1.ry);
  assert.ok(!s3.dx && s3.dz && !s3.ry);
  // La flecha se lee en un NUDO a L/2 (exacta en Euler–Bernoulli), no interpolada.
  assert.equal(byId[check("midspanDeflection").extract.nodeId].x, input("L") / 2);
});

test("TM-01: los valores esperados salen de sus fórmulas", () => {
  const L = input("L"), w = input("w"), E = input("E"), I = input("I");
  const close = (a, b) => assert.ok(Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(b)), `${a} != ${b}`);
  close(check("maxMoment").expected, (w * L * L) / 8);
  close(check("maxShear").expected, (w * L) / 2);
  close(check("reactionLeft").expected, (w * L) / 2);
  close(check("reactionRight").expected, (w * L) / 2);
  // Hacia abajo: dz negativo en la convención Z-arriba.
  close(check("midspanDeflection").expected, -(5 * w * L ** 4) / (384 * E * I));
});

test("TM-01: cada comprobación apunta a nudos y barras que existen", () => {
  const nodeIds = new Set(tm01.model.nodes.map((n) => n.id));
  const elementIds = new Set(tm01.model.elements.map((e) => e.id));
  for (const c of ref.checks) {
    if (c.extract.nodeId) assert.ok(nodeIds.has(c.extract.nodeId), c.key);
    for (const id of c.extract.elementIds || []) assert.ok(elementIds.has(id), c.key);
  }
  assert.ok(ref.tolerance.rel > 0 && ref.tolerance.rel < 0.01);
});

test("exampleMeta lee params.example y nada más", () => {
  assert.equal(exampleMeta(null), null);
  assert.equal(exampleMeta({ params: { length: 6 } }), null);
  assert.deepEqual(exampleMeta({ params: { example: { id: "tm01", version: 1 } } }), { id: "tm01", version: 1 });
});
