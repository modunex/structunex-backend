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
    { id: "tm02", version: 1, code: "TM-02", templateId: "frame3d", analysisType: "space_frame" },
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

// --- TM-02: pórtico 3D de 2 niveles con losas -----------------------------------------
// Sin solución cerrada: se verifica por equilibrio, simetría y linealidad. Estos tests
// recalculan las cargas totales desde la geometría, el catálogo AISC y los materiales
// (cálculo independiente del script que generó la fixture) y comprueban que el modelo
// es de verdad simétrico bajo la carga en que se compara la simetría.

const tm02 = getExample("tm02");
const ref2 = tm02.reference;
const check2 = (key) => ref2.checks.find((c) => c.key === key);
const close2 = (a, b) => assert.ok(Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b)), `${a} != ${b}`);

function tm02Totals() {
  const { nodes, elements, areas, areaLoads, loads } = tm02.model;
  const pos = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const mats = Object.fromEntries(tm02.catalog.materials.map((m) => [m.key, m]));
  const frameDefs = Object.fromEntries(tm02.catalog.frameSections.map((s) => [s.key, s]));
  const areaDefs = Object.fromEntries(tm02.catalog.areaSections.map((s) => [s.key, s]));
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  // Área de un polígono plano horizontal (fórmula del lazo).
  const polygonArea = (ids) => {
    const p = ids.map((id) => pos[id]);
    let s = 0;
    for (let i = 0; i < p.length; i++) {
      const q = p[(i + 1) % p.length];
      s += p[i].x * q.y - q.x * p[i].y;
    }
    return Math.abs(s) / 2;
  };
  let frames = 0;
  for (const e of elements) {
    const def = frameDefs[e.frameSectionKey];
    frames += getShape(def.catalogLabel).A * mats[def.materialKey].density * dist(pos[e.nodeA], pos[e.nodeB]);
  }
  let slabs = 0;
  const areaOf = {};
  for (const a of areas) {
    areaOf[a.id] = polygonArea(a.nodeIds);
    const def = areaDefs[a.areaSectionKey];
    slabs += mats[def.materialKey].density * def.thicknessMembrane * areaOf[a.id];
  }
  const surface = (pattern) =>
    areaLoads.filter((l) => l.loadPattern === pattern).reduce((s, l) => s + l.value * areaOf[l.areaId], 0);
  const lateral = loads.filter((l) => l.loadPattern === "WIND").reduce((s, l) => s + (l.fx || 0), 0);
  return { W_D: frames + slabs + surface("DEAD"), W_L: surface("LIVE"), F_x: lateral };
}

test("TM-02: el modelo resuelto pasa el schema de PUT /model (strict)", () => {
  const ids = { W10X49: UUID, W16X26: UUID, LOSA15: UUID };
  const model = buildExampleModel(tm02, ids);
  const parsed = modelSchema.safeParse(model);
  assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues));
  assert.ok(model.areas.every((a) => a.areaSectionId === UUID && !("areaSectionKey" in a)));
  assert.throws(() => buildExampleModel(tm02, { W10X49: UUID, W16X26: UUID }), /LOSA15/);
});

test("TM-02: los perfiles existen en el catálogo AISC", () => {
  for (const def of tm02.catalog.frameSections) assert.ok(getShape(def.catalogLabel), def.catalogLabel);
});

test("TM-02: las cargas totales esperadas salen de la geometría y los materiales", () => {
  const { W_D, W_L, F_x } = tm02Totals();
  close2(check2("deadVertical").expected, W_D);
  close2(check2("liveVertical").expected, W_L);
  close2(check2("windHorizontal").expected, -F_x);
  close2(check2("comboGravity").expected, 1.2 * W_D + 1.6 * W_L);
  close2(check2("comboWindVertical").expected, 1.2 * W_D + 1.0 * W_L);
  close2(check2("comboWindHorizontal").expected, -1.0 * F_x);
  // Solo el patrón DEAD lleva peso propio: si otro lo llevara, sus totales no serían estos.
  const swm = Object.fromEntries(tm02.model.configuration.loadPatterns.map((p) => [p.name, p.selfWeightMultiplier]));
  assert.deepEqual(swm, { DEAD: 1, LIVE: 0, WIND: 0 });
});

test("TM-02: las combinaciones de la referencia son las del modelo", () => {
  const model = Object.fromEntries(tm02.model.configuration.loadCombinations.map((c) => [c.name, c.factors]));
  for (const [name, factors] of Object.entries(ref2.combinations)) assert.deepEqual(model[name], factors, name);
  for (const c of ref2.checks) {
    assert.ok(!!c.pattern !== !!c.combination, `${c.key}: un patrón o una combinación`);
    if (c.combination) assert.ok(ref2.combinations[c.combination], c.key);
  }
});

test("TM-02: el modelo es simétrico respecto de x = 6 y de y = 3 bajo DEAD", () => {
  const { nodes, elements, areas, supports, areaLoads, loads } = tm02.model;
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const key = (n) => `${n.x},${n.y},${n.z}`;
  const at = Object.fromEntries(nodes.map((n) => [key(n), n.id]));
  for (const mirror of [(n) => ({ ...n, x: 12 - n.x }), (n) => ({ ...n, y: 6 - n.y })]) {
    const m = (id) => at[key(mirror(byId[id]))];
    // Nudos, barras (con su sección), losas y apoyos tienen su imagen especular.
    for (const n of nodes) assert.ok(m(n.id), n.id);
    const bars = new Set(elements.map((e) => [e.nodeA, e.nodeB].sort().join("-") + e.frameSectionKey));
    for (const e of elements) assert.ok(bars.has([m(e.nodeA), m(e.nodeB)].sort().join("-") + e.frameSectionKey), e.id);
    const slabs = new Set(areas.map((a) => [...a.nodeIds].sort().join("-")));
    for (const a of areas) assert.ok(slabs.has(a.nodeIds.map(m).sort().join("-")), a.id);
    const supported = new Set(supports.map((s) => s.nodeId));
    for (const s of supports) assert.ok(supported.has(m(s.nodeId)), s.nodeId);
  }
  // DEAD es uniforme en todas las losas y no tiene cargas nodales.
  const dead = areaLoads.filter((l) => l.loadPattern === "DEAD");
  assert.equal(dead.length, areas.length);
  assert.ok(dead.every((l) => l.value === dead[0].value && l.dir === "gravity"));
  assert.ok(!loads.some((l) => l.loadPattern === "DEAD"));
  // Y los pares que compara la referencia son imágenes especulares en la base.
  for (const c of ref2.checks.filter((c) => c.extract.kind === "reactionEqual")) {
    const a = byId[c.extract.nodeId];
    const b = byId[c.extract.otherNodeId];
    assert.equal(a.z, 0);
    assert.ok(
      (a.x === 12 - b.x && a.y === b.y) || (a.y === 6 - b.y && a.x === b.x),
      `${c.key}: ${a.id} y ${b.id} no son simétricos`
    );
    assert.equal(c.expected, null);
  }
});
