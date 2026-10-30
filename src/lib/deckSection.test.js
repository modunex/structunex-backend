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
