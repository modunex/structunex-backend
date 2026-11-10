const { test } = require("node:test");
const assert = require("node:assert/strict");
const c = require("./billingCredits");

// node --test src/lib/billingCredits.test.js

const NOW = new Date("2026-11-10T12:00:00Z");
const days = (n) => new Date(NOW.getTime() + n * 24 * 3600 * 1000);

test("Free repone cada 30 días; un plan de pago lo repone la factura", () => {
  assert.equal(c.needsFreeReset({ plan: "free", aiCreditsResetAt: null }, NOW), true);
  assert.equal(c.needsFreeReset({ plan: "free", aiCreditsResetAt: days(-29) }, NOW), false);
  assert.equal(c.needsFreeReset({ plan: "free", aiCreditsResetAt: days(-30) }, NOW), true);
  assert.equal(
    c.needsFreeReset({ plan: "principal", stripeSubscriptionId: "sub_1", aiCreditsResetAt: null }, NOW),
    false
  );
});

const grants = [
  { id: "late", remaining: 500, expiresAt: days(200) },
  { id: "soon", remaining: 100, expiresAt: days(10) },
  { id: "expired", remaining: 900, expiresAt: days(-1) },
  { id: "empty", remaining: 0, expiresAt: days(50) },
];

test("saldo: mensual + lotes vigentes con saldo", () => {
  assert.deepEqual(c.balance({ aiCreditsMonthly: 40 }, grants, NOW), { monthly: 40, purchased: 600, total: 640 });
});

test("consumo: primero el mensual, luego el lote que vence antes", () => {
  const r = c.allocate({ aiCreditsMonthly: 40 }, grants, 180, NOW);
  assert.equal(r.monthlyUsed, 40);
  assert.deepEqual(r.grantUse, [
    { id: "soon", used: 100 },
    { id: "late", used: 40 },
  ]);
  assert.equal(r.shortfall, 0);
});

test("consumo mayor que el saldo: se agota y lo que falta queda en shortfall", () => {
  const r = c.allocate({ aiCreditsMonthly: 10 }, [{ id: "g", remaining: 5, expiresAt: days(1) }], 30, NOW);
  assert.equal(r.monthlyUsed, 10);
  assert.deepEqual(r.grantUse, [{ id: "g", used: 5 }]);
  assert.equal(r.shortfall, 15);
});

test("un consumo fraccionario se redondea hacia arriba; cero no toca nada", () => {
  assert.equal(c.allocate({ aiCreditsMonthly: 10 }, [], 2.1, NOW).monthlyUsed, 3);
  assert.deepEqual(c.allocate({ aiCreditsMonthly: 10 }, grants, 0, NOW), { monthlyUsed: 0, grantUse: [], shortfall: 0 });
});
