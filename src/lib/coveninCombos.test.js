const { test } = require("node:test");
const assert = require("node:assert/strict");
const { buildCoveninCombos } = require("./coveninCombos");
const { generateDefaultCombos } = require("../services/loadComboService");

// node --test src/lib/coveninCombos.test.js
//
// Caso de la tarea UCAB (Caracas, grupo B2, suelo CD, H = 60 m, A0 = 0,30 g), resuelto a
// mano en spectrumGenerators.test.js: AA = 0,375, β = 2,4 (ξ = 5 %).
// Tabla 19, clase CD: γmáx = 1,3 ; η0 = 0,7 + αA0 = 0,7 + 1,0·0,30 = 1,0.
// 8.5: CSV = β·AA·γmáx·η0 = 2,4 · 0,375 · 1,3 · 1,0 = 1,17.
// 8.6: CP · (1,2 + 0,3·1,17) = 1,551 ; 8.7: CP · (0,9 − 0,3·1,17) = 0,549.

const CARACAS = {
  A0: 0.3, A1: 0.24, TL: 3.6, grupo: "B2", claseSitio: "CD", H: 60, topografia: "leve",
  sistemaId: "Ia-acero", nivelDiseno: "ND3",
};
const fn = (name, sismo = "diseno") => ({
  name, source: "covenin1756-2019", damping: 0.05, params: { ...CARACAS, sismo },
});
const rs = (name, rows, directionalCombination = "SRSS") => ({
  name, modalCase: "MODAL", modalCombination: "CQC", directionalCombination,
  modalDamping: 0.05, diaphragmEccentricity: 0.05,
  loads: rows.map(([direction, f]) => ({ direction, function: f, scaleFactor: 9.81 })),
});

const loadPatterns = [
  { name: "CP", type: "dead" },
  { name: "SCP", type: "superDead" },
  { name: "CV", type: "live" },
  { name: "CVt", type: "roofLive" },
  { name: "VIENTO", type: "wind" },
];
const spectrumFunctions = [fn("S1")];
const responseSpectrumCases = [
  rs("SX", [["UX", "S1"]]),
  rs("SY", [["UY", "S1"]]),
  rs("SXY", [["UX", "S1"], ["UY", "S1"]]),
];
const near = (a, b, tol = 1e-9) => Math.abs(a - b) < tol;
const factor = (combo, pattern) => combo.factors.find((f) => f.pattern === pattern)?.factor;

test("CSV del caso Caracas (8.5) y factores de CP en 8.6 y 8.7", () => {
  const { meta } = buildCoveninCombos({
    loadPatterns, responseSpectrumCases, spectrumFunctions,
    options: { method: "30", sx: "SX", sy: "SY", gamma: 0.5 },
  });
  assert.ok(near(meta.CSV, 1.17), `CSV = ${meta.CSV}`);
  assert.ok(near(meta.cpFactor86, 1.551));
  assert.ok(near(meta.cpFactor87, 0.549));
  assert.equal(meta.csv[0].gammaMax, 1.3);
  assert.ok(near(meta.csv[0].eta0, 1.0));
  assert.ok(near(meta.csv[0].AA, 0.375));
  assert.equal(meta.csv[0].beta, 2.4);
  assert.deepEqual(meta.cp, ["CP", "SCP"]);
  assert.deepEqual(meta.cv, ["CV", "CVt"]);
});

test("método del 30 %: 8.1 y 8.2, cada una en 8.6 y 8.7, con ambos signos", () => {
  const { combos } = buildCoveninCombos({
    loadPatterns, responseSpectrumCases, spectrumFunctions,
    options: { method: "30", sx: "SX", sy: "SY", gamma: 0.5 },
  });
  assert.equal(combos.length, 8);
  const c = combos.find((x) => x.name === "COV 8.6 +(SX+0.3SY)");
  assert.ok(near(factor(c, "CP"), 1.551) && near(factor(c, "SCP"), 1.551), "CP y SCP");
  assert.equal(factor(c, "CV"), 0.5, "γ·CV");
  assert.equal(factor(c, "CVt"), 0.5, "la variable de techo también es CV");
  assert.equal(factor(c, "SX"), 1);
  assert.equal(factor(c, "SY"), 0.3);
  assert.equal(factor(c, "VIENTO"), undefined, "el viento no entra en 8.6");

  const d = combos.find((x) => x.name === "COV 8.7 -(0.3SX+SY)");
  assert.ok(near(factor(d, "CP"), 0.549));
  assert.equal(factor(d, "CV"), undefined, "8.7 no lleva CV");
  assert.equal(factor(d, "SX"), -0.3);
  assert.equal(factor(d, "SY"), -1);
});

test("γ = 1 (8.3.2.1.b) y RCSC con un caso UX+UY por SRSS", () => {
  const { combos, meta } = buildCoveninCombos({
    loadPatterns, responseSpectrumCases, spectrumFunctions,
    options: { method: "RCSC", sh: "SXY", gamma: 1 },
  });
  assert.equal(meta.method, "RCSC");
  assert.equal(combos.length, 4);
  const c = combos.find((x) => x.name === "COV 8.6 +(SH)");
  assert.equal(factor(c, "CV"), 1);
  assert.equal(factor(c, "SXY"), 1);
});

test("rechaza datos que no encajan con la norma (no genera a medias)", () => {
  const base = { loadPatterns, responseSpectrumCases, spectrumFunctions };
  const run = (options, extra = {}) => () => buildCoveninCombos({ ...base, ...extra, options });
  assert.throws(run({ method: "30", sx: "SX", sy: "SY", gamma: 0.7 }), /covenin.gamma/);
  assert.throws(run({ method: "30", sx: "SY", sy: "SX", gamma: 0.5 }), /covenin.sxNotX/);
  assert.throws(run({ method: "30", sx: "SX", sy: "SX", gamma: 0.5 }), /covenin.sameCase/);
  assert.throws(run({ method: "RCSC", sh: "SX", gamma: 0.5 }), /covenin.shNotXY/);
  assert.throws(
    run({ method: "RCSC", sh: "ABS", gamma: 0.5 }, {
      responseSpectrumCases: [rs("ABS", [["UX", "S1"], ["UY", "S1"]], "ABS")],
    }),
    /covenin.shNotSRSS/
  );
  assert.throws(
    run({ method: "30", sx: "SX", sy: "SY", gamma: 0.5 }, {
      spectrumFunctions: [{ name: "S1", source: "asce7-22", damping: 0.05, params: {} }],
    }),
    /covenin.notCovenin2019/
  );
  assert.throws(
    run({ method: "30", sx: "SX", sy: "SY", gamma: 0.5 }, {
      loadPatterns: [{ name: "CV", type: "live" }],
    }),
    /covenin.noDead/
  );
});

test("con COVENIN marcado, el catálogo ASCE 7 solo aporta las gravitatorias", () => {
  const out = generateDefaultCombos({
    loadPatterns, responseSpectrumCases, spectrumFunctions,
    sets: ["LRFD", "COVENIN1756"],
    covenin: { method: "30", sx: "SX", sy: "SY", gamma: 0.5 },
  });
  assert.ok(out.skippedSeismicCatalog > 0, "las sísmicas de ASCE 7 no se generan");
  assert.ok(!out.combos.some((c) => c.factors.some((f) => f.seismic)), "ningún marcador E");
  assert.ok(out.combos.some((c) => c.name === "1.4D"), "1,4D del catálogo");
  assert.equal(out.combos.filter((c) => c.name.startsWith("COV ")).length, 8);
  assert.ok(near(out.covenin.CSV, 1.17));

  // Sin COVENIN, el catálogo genera sus sísmicas como siempre.
  const plain = generateDefaultCombos({ loadPatterns, responseSpectrumCases, sets: ["LRFD"] });
  assert.ok(plain.combos.some((c) => c.factors.some((f) => f.seismic)));
  assert.equal(plain.covenin, null);
});

test("Sismo 1 y Sismo 2 con sitios distintos: se toma la CSV mayor", () => {
  const funcs = [fn("S1"), fn("S2", "extremo")];
  const cases = [rs("SX", [["UX", "S1"]]), rs("SY", [["UY", "S2"]])];
  const { meta } = buildCoveninCombos({
    loadPatterns, responseSpectrumCases: cases, spectrumFunctions: funcs,
    options: { method: "30", sx: "SX", sy: "SY", gamma: 0.5 },
  });
  assert.equal(meta.csv.length, 2);
  assert.equal(meta.CSV, Math.max(...meta.csv.map((r) => r.CSV)));
});
