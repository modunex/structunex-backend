const test = require("node:test");
const assert = require("node:assert/strict");
const { deckProperties } = require("./deckSection");

// Caso resuelto a mano: tc 75 mm, nervio 50 mm, 160/120 mm, paso 305 mm, lámina 0,91 mm
// (20 ga), concreto 24 kN/m³, acero 77 kN/m³.
//   fracción de nervio = (0,16+0,12)/(2·0,305) = 0,459016
//   V concreto = 0,075 + 0,05·0,459016 = 0,097951 m³/m²  → 2,35082 kN/m²
//   alma = √(0,05² + 0,02²) = 0,053852 ; desarrollo = 0,305−0,16+0,12+2·0,053852 = 0,372703
//   acero = 0,00091·0,372703/0,305 = 0,00111201 m³/m² → 0,085625 kN/m²
const DECK = { tc: 0.075, hr: 0.05, wrTop: 0.16, wrBot: 0.12, sr: 0.305, t: 0.00091 };
const near = (a, b, tol = 1e-5) => Math.abs(a - b) < tol;

test("deck: weights and volumes, hand-solved", () => {
  const p = deckProperties(DECK, 24, 77);
  assert.ok(near(p.concreteVolume, 0.097951));
  assert.ok(near(p.concreteWeight, 2.350820));
  assert.ok(near(p.developedLength, 0.372703));
  assert.ok(near(p.deckWeight, 0.085625));
  assert.ok(near(p.totalWeight, 2.436445));
  assert.equal(p.analysisThickness, 0.075);
  assert.ok(near(p.weightFactor, 2.436445 / (24 * 0.075)), "peso total / (γc·tc)");
  assert.ok(near(p.totalDepth, 0.125));
});

test("deck: rejects geometry that is not a deck", () => {
  assert.throws(() => deckProperties({ ...DECK, wrBot: 0.2 }, 24, 77), /fondo/);
  assert.throws(() => deckProperties({ ...DECK, wrTop: 0.31 }, 24, 77), /separación/);
  assert.throws(() => deckProperties({ ...DECK, tc: 0 }, 24, 77), /tc/);
  assert.throws(() => deckProperties(DECK, 0, 77), /concreto/);
  assert.throws(() => deckProperties(DECK, 24, null), /acero/);
});

test("flexión ortótropa: la inercia a lo largo de los nervios supera con creces a la transversal", () => {
  // Losa del usuario: tc 7,5 cm, hr 5 cm, sr 30,5 cm, nervio 16/12 cm, lámina 0,91 mm.
  const deck = { tc: 0.075, hr: 0.05, wrTop: 0.16, wrBot: 0.12, sr: 0.305, t: 0.00091, ribAngle: 30 };
  const p = deckProperties(deck, 24, 77, 200000 / 21538);
  const plate = 0.075 ** 3 / 12;
  assert.ok(Math.abs(p.bendingAcross - plate) < 1e-12);
  // A mano: losa (tc·sr) + nervio trapezoidal + lámina transformada, por paso y entre sr.
  // Sale del orden de 3 veces tc³/12 para esta geometría (losa gruesa, nervio bajo).
  assert.ok(p.bendingRatio > 2.5 && p.bendingRatio < 4, `ratio ${p.bendingRatio}`);
  assert.equal(p.orthotropic.e2Factor, 1);
  assert.ok(Math.abs(p.orthotropic.e1Factor - p.bendingRatio) < 1e-12);
  assert.ok(Math.abs(p.orthotropic.g12Factor - Math.sqrt(p.bendingRatio)) < 1e-12);
  assert.equal(p.orthotropic.angle, 30);
});

test("un nervio alto hace la losa claramente unidireccional", () => {
  const deck = { tc: 0.05, hr: 0.076, wrTop: 0.14, wrBot: 0.1, sr: 0.305, t: 0.00091 };
  const p = deckProperties(deck, 24, 77, 9);
  assert.ok(p.bendingRatio > 8, `ratio ${p.bendingRatio}`);
  assert.equal(p.orthotropic.angle, 0);
});
