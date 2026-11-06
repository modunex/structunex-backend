const test = require("node:test");
const assert = require("node:assert/strict");

const { canReport, spectrumSnapshot } = require("./reportingSpectrum");

const fn = {
  name: "Sismo 1",
  source: "covenin1756-2019",
  damping: 0.05,
  params: { sismo: "diseno", grupo: "B2", A0: 0.3, A1: 0.24, TL: 8, claseSitio: "C", H: 30, R: 6, Cd: 5 },
};
const near = (a, b, tol = 2e-6) => Math.abs(a - b) <= tol;

test("la hoja cubre de 0 a 4 s cada 0,02 s", () => {
  const { rows, columns } = spectrumSnapshot(fn);
  assert.deepEqual(columns, ["T", "A", "Ad", "D_cm", "DT_cm", "Av"]);
  assert.equal(rows.length, 201);
  assert.equal(rows[0][0], 0);
  assert.equal(rows[1][0], 0.02);
  assert.equal(rows[200][0], 4);
});

test("los desplazamientos salen de 7.24 y 7.25 con g = 981 cm/s²", () => {
  const { rows, params } = spectrumSnapshot(fn);
  const row = rows[100]; // T = 2 s
  const w = 981 * (2 / (2 * Math.PI)) ** 2;
  assert.ok(near(row[3], row[1] * w, 1e-3), "D = A·g·(T/2π)²");
  assert.ok(near(row[4], params.Cd * row[2] * w, 1e-3), "DT = Cd·Ad·g·(T/2π)²");
});

test("la componente vertical se detiene en Tv = 2 s", () => {
  const { rows, params } = spectrumSnapshot(fn);
  assert.equal(params.TvMax, 2);
  assert.ok(rows[100][5] > 0);
  assert.equal(rows[101][5], null);
  assert.equal(rows[200][5], null);
});

test("indica qué curva entra al análisis según el sismo", () => {
  assert.equal(spectrumSnapshot(fn).params.curva, "inelastico");
  const extremo = { ...fn, params: { ...fn.params, sismo: "extremo" } };
  assert.equal(spectrumSnapshot(extremo).params.curva, "elastico");
});

test("la misma función da exactamente la misma hoja", () => {
  assert.deepEqual(spectrumSnapshot(fn), spectrumSnapshot(structuredClone(fn)));
});

test("solo COVENIN 2019 tiene la tabla completa", () => {
  assert.equal(canReport(fn), true);
  assert.equal(canReport({ source: "asce7-22" }), false);
  assert.throws(() => spectrumSnapshot({ ...fn, source: "asce7-22" }), /no tiene tabla/);
});
