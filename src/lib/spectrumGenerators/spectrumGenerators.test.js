// Paridad de los generadores de curva con las ecuaciones de norma (y, por tanto, con los
// módulos TS del front que resuelven las mismas). Se ancla a valores CERRADOS que ambas
// implementaciones deben clavar — no a números copiados de la otra — así el test cae si
// el port se desvía de la norma, no solo si difiere del front.
//
// Runner integrado de Node 22 (sin dependencias):  node --test src/lib/spectrumGenerators
const test = require("node:test");
const assert = require("node:assert/strict");

const generators = require("./index");
const { getCode } = require("../seismicCodeCatalog");

// Ordenada muestreada más cercana a un periodo (las curvas insertan sus quiebres, así que
// el punto exacto suele estar).
function at(points, T) {
  return points.reduce((best, p) =>
    Math.abs(p.T - T) < Math.abs(best.T - T) ? p : best
  ).accel;
}

test("ASCE 7-22: reduced ordinate is Sa/(R/Ie), closed form", () => {
  // SDS=1, SD1=0.6 (Ts=0.6, T0=0.12), R=8, Ie=1 (Cat II) => R/Ie = 8.
  const pts = generators.sample({
    source: "asce7-22",
    damping: 0.05,
    params: {
      SDS: 1.0, SD1: 0.6, TL: 8,
      siteClass: "CD", riskCategory: "II",
      systemId: "mf-steel-special-moment-frames-smf",
    },
  });
  assert.ok(pts.length >= 2);
  assert.ok(Math.abs(at(pts, 0) - 0.4 / 8) < 1e-9, "T=0: 0.4·SDS / (R/Ie)");
  assert.ok(Math.abs(at(pts, 0.3) - 1.0 / 8) < 1e-9, "plateau SDS / (R/Ie)");
  assert.ok(Math.abs(at(pts, 2.0) - (0.6 / 2.0) / 8) < 1e-9, "descending SD1/T / (R/Ie)");
  assert.ok(pts[pts.length - 1].T >= 10, "range covers long periods");
});

test("COVENIN 1756: ground accel at T=0 and reduced plateau", () => {
  const code = getCode("covenin-1756");
  const params = {
    zona: 5, soilId: "duros-2", grupo: "B2",
    material: "concreto", nivelDiseno: "ND3", tipoEstructural: "I",
  };
  const r = require("./covenin1756").resolve(code, params);
  const pts = generators.sample({ source: "covenin1756", params });

  const ground = r.alpha * r.phi * r.Ao; // T=0: la curva arranca en la aceleración del suelo
  assert.ok(Math.abs(at(pts, 0) - ground) < 1e-6, "T=0 == alpha·phi·Ao");
  // En la meseta [T⁺, T*] la ordenada es alpha·phi·Ao·beta/R.
  const midPlateau = (r.Tplus + r.Tstar) / 2;
  assert.ok(Math.abs(at(pts, midPlateau) - r.plateau) < 1e-6, "meseta == alpha·phi·Ao·beta/R");
  // Pasado T* decae como (T*/T)^p.
  const Tfar = Math.min(9.9, r.Tstar * 3);
  assert.ok(
    Math.abs(at(pts, Tfar) - r.plateau * Math.pow(r.Tstar / Tfar, r.p)) < 1e-6,
    "rama descendente (T*/T)^p"
  );
});

test("NCh433: alpha(T0)=2.75 gives design = S·A0·I·2.75 / R*", () => {
  const code = getCode("nch433");
  const params = { zona: 2, soilType: "C", categoria: "II", systemId: "ha-muros", Tstar: 0.85 };
  const r = require("./nch433").resolve(code, params);
  const pts = generators.sample({ source: "nch433", params });

  const designAtT0 = (r.S * r.A0 * r.I * 2.75) / r.Rstar;
  assert.ok(Math.abs(at(pts, r.T0) - designAtT0) < 1e-6, "alpha(T0)=2.75");
});

test("userTable: passthrough, sorted, deduped, clamped shape", () => {
  const pts = generators.sample({
    source: "userTable",
    params: {
      points: [
        { T: 0.6, value: 1.0 },
        { T: 0.0, value: 0.4 }, // fuera de orden
        { T: 0.6, value: 9.9 }, // periodo repetido -> se ignora
        { T: 2.0, value: 0.3 },
      ],
    },
  });
  assert.deepEqual(pts, [
    { T: 0.0, accel: 0.4 },
    { T: 0.6, accel: 1.0 },
    { T: 2.0, accel: 0.3 },
  ]);
});

test("userTable: fewer than two valid points is an error", () => {
  assert.throws(() =>
    generators.sample({ source: "userTable", params: { points: [{ T: 0, value: 1 }] } })
  );
});

test("unknown source throws", () => {
  assert.throws(() => generators.sample({ source: "nope", params: {} }));
});

test("every source yields a fraction-of-g curve with >= 2 points", () => {
  const cases = [
    { source: "covenin1756", params: { zona: 5, soilId: "duros-2", grupo: "B2", material: "concreto", nivelDiseno: "ND3", tipoEstructural: "I" } },
    { source: "nch433", params: { zona: 2, soilType: "C", categoria: "II", systemId: "ha-muros", Tstar: 0.85 } },
    { source: "asce7-22", params: { SDS: 1.0, SD1: 0.6, TL: 8, riskCategory: "II", systemId: "mf-steel-special-moment-frames-smf" } },
  ];
  for (const c of cases) {
    const pts = generators.sample({ ...c, damping: 0.05 });
    assert.ok(pts.length >= 2, `${c.source} has >= 2 points`);
    for (const p of pts) {
      assert.ok(Number.isFinite(p.T) && p.T >= 0, `${c.source} finite T`);
      assert.ok(Number.isFinite(p.accel) && p.accel >= 0 && p.accel < 5, `${c.source} sane accel`);
    }
  }
});

// ── COVENIN 1756-1:2019 ───────────────────────────────────────────────────────────
// Caso resuelto a mano: Caracas (A0=0,30; A1=0,24; TL=3,6), grupo B2, clase CD, H=60 m,
// topografía leve, pórtico de acero I-a ND3 (R=6, Cd=4,25), ρ=FI=1.
//   αA0=0,30 → FAC=1,25 ; αA1=0,24 → FVC=1,70 ; FDC=1,40 ; FAH=1,00 FVH=1,02 FDH=1,05
//   FA=1,25  FV=1,734  FD=1,47  AA=0,375  AV=0,41616  β*=2,4
//   TC=AV/(2,4·AA)=0,4624  TB=0,1156  TA=0,02312  TD=3,6·1,47/1,734=3,05190  q=1,9  T⁺=0,4
const cov2019 = require("./covenin1756-2019");
const CARACAS = {
  A0: 0.3, A1: 0.24, TL: 3.6, grupo: "B2", claseSitio: "CD", H: 60, topografia: "leve",
  sistemaId: "Ia-acero", nivelDiseno: "ND3",
};
const near = (a, b, tol = 1e-6) => Math.abs(a - b) < tol;

test("COVENIN 2019: site factors and corner periods, hand-solved Caracas case", () => {
  const r = cov2019.resolve(getCode("covenin-1756-2019"), CARACAS);
  assert.ok(near(r.FA, 1.25) && near(r.FV, 1.734) && near(r.FD, 1.47), "F_A, F_V, F_D");
  assert.ok(near(r.AA, 0.375) && near(r.AV, 0.41616), "AA, AV");
  assert.equal(r.betaStar, 2.4);
  assert.ok(near(r.TC, 0.4624) && near(r.TB, 0.1156) && near(r.TA, 0.02312), "TA, TB, TC");
  assert.ok(near(r.TD, (3.6 * 1.47) / 1.734), "TD = TL·FD/FV");
  assert.equal(r.R, 6);
  assert.equal(r.Cd, 4.25);
  assert.equal(r.Tplus, 0.4);
});

test("COVENIN 2019: elastic and inelastic branches", () => {
  const r = cov2019.resolve(getCode("covenin-1756-2019"), CARACAS);
  assert.ok(near(cov2019.elastic(r, 0), 0.375), "A(0) = AA");
  assert.ok(near(cov2019.elastic(r, 0.3), 0.9), "meseta β*·AA");
  assert.ok(near(cov2019.elastic(r, 1.0), 0.9 * 0.4624), "β*AA·TC/T");
  const T = 3.5;
  assert.ok(near(cov2019.elastic(r, T), 0.9 * (0.4624 / r.TD) * Math.pow(r.TD / T, 1.9)), "rama larga");
  assert.ok(near(cov2019.inelastic(r, 0), 0.25), "Ad(0) = AA/1,5");
  assert.ok(near(cov2019.inelastic(r, 0.42), 0.15), "meseta β*AA/R");
  assert.ok(near(cov2019.inelastic(r, 0.4), 0.15), "continuidad en T⁺");
  assert.ok(near(cov2019.inelastic(r, 2.0), 0.15 * 0.4624 / 2), "Ad·TC/T");
});

test("COVENIN 2019: displacement spectra in cm (7.24, 7.25)", () => {
  const r = cov2019.resolve(getCode("covenin-1756-2019"), CARACAS);
  const w = (T) => 981 * Math.pow(T / (2 * Math.PI), 2);
  assert.ok(near(cov2019.displacement(r, 1.0), 0.9 * 0.4624 * w(1)), "D = A·g·(T/2π)²");
  assert.ok(near(cov2019.totalDisplacement(r, 1.0), 4.25 * 0.15 * 0.4624 * w(1)), "DT = Cd·Ad·g·(T/2π)²");
});

test("COVENIN 2019: vertical component for class CD", () => {
  const r = cov2019.resolve(getCode("covenin-1756-2019"), CARACAS);
  // CD: γ0=0,8 γmax=1,3 γmin=0,36 TCV=0,3 ; η0=0,7+αA0=1,0 ; ηc=1,36−1,2αA0=1,0
  assert.ok(near(cov2019.verticalOrdinate(r, 0), 0.375 * 0.8 * 1.0), "Tv=0");
  // Tv=0,08 cae en la rampa del horizontal (TB=0,1156) y en la meseta γmax del vertical.
  const A008 = 0.375 * (1 + ((0.08 - 0.02312) / (0.1156 - 0.02312)) * 1.4);
  assert.ok(near(cov2019.verticalOrdinate(r, 0.08), A008 * 1.3 * 1.0), "γmax sobre la rampa");
  assert.ok(near(cov2019.verticalOrdinate(r, 1.0), 0.9 * 0.4624 * 0.36 * 1.0), "Tv ≥ TCV: γmin·ηc");
  assert.equal(cov2019.verticalOrdinate(r, 2.5), null, "Tv > 2 s exige estudio especial");
});

test("COVENIN 2019: extreme earthquake uses αE and clamps αA0 past table 8", () => {
  const r = cov2019.resolve(getCode("covenin-1756-2019"), { ...CARACAS, sismo: "extremo" });
  assert.equal(r.alpha, 2.2);
  assert.equal(r.PMR, 2475);
  assert.ok(near(r.aA0, 0.66), "αE·A0");
  assert.equal(r.FAC, 1.15, "αA0 > 0,5: última fila de la tabla 8");
  assert.ok(r.notes.some((n) => n.includes("Tabla 8")), "deja aviso del recorte");
});

test("COVENIN 2019: sample() feeds the analysis with the inelastic curve", () => {
  const pts = generators.sample({ source: "covenin1756-2019", params: CARACAS });
  assert.ok(near(at(pts, 0), 0.25));
  assert.ok(near(at(pts, 0.42), 0.15));
  assert.ok(pts[pts.length - 1].T >= 10);
});

test("COVENIN 2019: table() has every 0,02 s row up to 4 s", () => {
  const { rows } = cov2019.table(getCode("covenin-1756-2019"), CARACAS);
  assert.equal(rows.length, 201);
  assert.equal(rows[1].T, 0.02);
  assert.equal(rows[200].T, 4);
  assert.equal(rows[200].Av, null);
});

test("COVENIN 2019: β for other damping ratios (7.34)", () => {
  const code = getCode("covenin-1756-2019");
  assert.equal(cov2019.betaForDamping(code, 0.05), 2.4);
  assert.ok(near(cov2019.betaForDamping(code, 0.02), 2.4 * (1.4024 - 0.25 * Math.log(2))), "ξ = 2 %");
  // ξ = 5 % por la fórmula también da 2,4 (con el redondeo de la norma).
  assert.ok(near(2.4 * (1.4024 - 0.25 * Math.log(5)), 2.4, 1e-3));
});

test("COVENIN 2019: frequent earthquake is elastic, with ξ = 0,2/√hn (8.7.2)", () => {
  const code = getCode("covenin-1756-2019");
  const p = { ...CARACAS, grupo: "A2", sismo: "frecuente", hn: 36 }; // ξ = 0,2/6 = 3,33 %
  const r = cov2019.resolve(code, p);
  assert.equal(r.curva, "elastico");
  assert.ok(near(r.damping, 0.2 / 6));
  assert.ok(near(r.beta, 2.4 * (1.4024 - 0.25 * Math.log(20 / 6))));
  assert.ok(near(r.TL, 3.6 * 0.85), "TL × 0,85 (4.5.b)");
  const pts = generators.sample({ source: "covenin1756-2019", params: p });
  assert.ok(near(at(pts, 0.3), cov2019.elastic(r, 0.3)), "entra el elástico, no el inelástico");
  // Un edificio bajo no sube del 5 %.
  assert.equal(cov2019.resolve(code, { ...p, hn: 9 }).damping, 0.05);
});

test("COVENIN 2019: design earthquake for group A1 and the extreme one carry the code's warnings", () => {
  const code = getCode("covenin-1756-2019");
  assert.ok(cov2019.resolve(code, { ...CARACAS, grupo: "A1" }).notes.some((n) => n.includes("4.3.c")));
  const ext = cov2019.resolve(code, { ...CARACAS, sismo: "extremo" });
  assert.equal(ext.curva, "elastico");
  assert.ok(ext.notes.some((n) => n.includes("4.4.b")));
});

test("COVENIN 2019: table 15 is complete and consistent", () => {
  const filas = getCode("covenin-1756-2019").sistemas.filas;
  assert.equal(filas.length, 44);
  assert.equal(new Set(filas.map((f) => f.id)).size, filas.length, "ids únicos");
  for (const f of filas) {
    for (const nd of ["ND3", "ND2", "ND1"]) {
      assert.equal(f.R[nd] == null, f.Cd[nd] == null, `${f.id} ${nd}: R y Cd definidos juntos`);
    }
    assert.ok(f.omega0 >= 1.5 && f.omega0 <= 3, `${f.id} Ωo`);
  }
  // Spot checks against the printed table (pp. 69-70).
  const by = Object.fromEntries(filas.map((f) => [f.id, f]));
  assert.deepEqual(by["IIb-concreto"].R, { ND3: 5, ND2: 4.25, ND1: 2.75 });
  assert.deepEqual(by["IIIb-muros"].Cd, { ND3: 3.75, ND2: null, ND1: 3.25 });
  assert.equal(by["IIIc-mampTotal"].omega0, 2);
  assert.deepEqual(by["IV-acero"].R, { ND3: 2, ND2: null, ND1: 1.5 });
});
