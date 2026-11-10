const { test } = require("node:test");
const assert = require("node:assert/strict");
const p = require("./billingPlans");

// node --test src/lib/billingPlans.test.js

test("cada feature de un plan está declarada, y Student ⊂ Principal", () => {
  for (const plan of Object.values(p.PLANS)) {
    for (const f of plan.features) assert.ok(p.FEATURE_KEYS.includes(f), `${plan.id}: ${f}`);
  }
  for (const f of p.PLANS.student.features) assert.ok(p.PLANS.principal.features.includes(f));
  assert.deepEqual(p.PLANS.free.features, []);
  assert.equal(new Set(p.FEATURE_KEYS).size, p.FEATURE_KEYS.length, "lookup keys únicos");
});

test("los lookup keys coinciden con el catálogo creado en Stripe", () => {
  assert.deepEqual(Object.keys(p.SUBSCRIPTION_PRICES).sort(), [
    "principal_annual",
    "principal_founding_annual",
    "principal_monthly",
    "student_annual",
    "student_monthly",
  ]);
  assert.deepEqual(p.CREDIT_PACK_PRICES, ["ai_credits_1000", "ai_credits_5000", "ai_credits_15000"]);
});

test("límites de la tabla de precios", () => {
  assert.equal(p.PLANS.free.maxElements, 500);
  assert.equal(p.PLANS.free.maxProjects, 3);
  assert.equal(p.PLANS.student.maxElements, 5000);
  assert.equal(p.PLANS.principal.maxElements, Infinity);
  assert.deepEqual(
    [p.PLANS.free, p.PLANS.student, p.PLANS.principal].map((x) => x.aiCreditsMonthly),
    [50, 300, 1500]
  );
});

const sub = (status, lookup_key) => ({ status, items: { data: [{ price: { lookup_key } }] } });

test("plan de una suscripción: activo, gracia y fin", () => {
  assert.deepEqual(p.planFromSubscription(sub("active", "principal_annual")), {
    plan: "principal",
    priceKey: "principal_annual",
  });
  assert.equal(p.planFromSubscription(sub("trialing", "student_monthly")).plan, "student");
  // past_due: Stripe aún reintenta el cobro → se mantiene el plan.
  assert.equal(p.planFromSubscription(sub("past_due", "student_monthly")).plan, "student");
  for (const s of ["canceled", "unpaid", "incomplete", "incomplete_expired", "paused"]) {
    assert.equal(p.planFromSubscription(sub(s, "principal_monthly")).plan, "free", s);
  }
  assert.equal(p.planFromSubscription(sub("active", "ai_credits_1000")).plan, "free");
  assert.equal(p.planFromSubscription(null).plan, "free");
});

test("features efectivas: el plan es el mínimo y Stripe solo suma", () => {
  assert.deepEqual(p.effectiveFeatures({ plan: "free" }), []);
  assert.deepEqual(
    new Set(p.effectiveFeatures({ plan: "student", featuresSyncedAt: new Date(), features: [] })),
    new Set(p.PLANS.student.features)
  );
  const promo = p.effectiveFeatures({ plan: "free", featuresSyncedAt: new Date(), features: ["reports_clean"] });
  assert.deepEqual(promo, ["reports_clean"]);
  // Sin sincronizar, lo guardado en `features` no cuenta.
  assert.deepEqual(p.effectiveFeatures({ plan: "free", features: ["reports_clean"] }), []);
});

test("familia de modelo y features del asistente", () => {
  assert.equal(p.modelFamily("anthropic.claude-opus-5-5"), "opus");
  assert.equal(p.modelFamily("global.anthropic.claude-haiku-5-5"), "haiku");
  assert.equal(p.modelFamily("otro"), null);
  assert.equal(p.AI_MODEL_FEATURE.haiku, null);
});

test("tarifas de IA: sin valores por defecto y validadas", () => {
  assert.deepEqual(p.parseAiPrices(""), {});
  assert.throws(() => p.parseAiPrices("{"), /JSON/);
  assert.throws(() => p.parseAiPrices('{"opus":{"input":1}}'), /output/);
  assert.throws(() => p.parseAiPrices('{"opus":{"input":-1,"output":1,"cacheRead":1,"cacheWrite":1}}'));
});

test("créditos de un turno: costo × margen en centavos, redondeado hacia arriba", () => {
  // Tarifas ficticias, solo para comprobar la aritmética (no son precios de Bedrock).
  const prices = p.parseAiPrices(
    JSON.stringify({ sonnet: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 } })
  );
  const usage = {
    input_tokens: 20000,
    output_tokens: 1500,
    cache_read_input_tokens: 100000,
    cache_creation_input_tokens: 4000,
  };
  // USD = (20000·2 + 1500·10 + 100000·0.2 + 4000·2.5) / 1e6 = 0.085 → ×4 = 0.34 → 34 créditos
  assert.equal(p.creditsForUsage(usage, "sonnet", prices, 4), 34);
  assert.equal(p.creditsForUsage({ input_tokens: 1 }, "sonnet", prices, 4), 1, "nunca gratis si hubo uso");
  assert.equal(p.creditsForUsage({}, "sonnet", prices, 4), 0);
  assert.equal(p.creditsForUsage(usage, "opus", prices, 4), null, "sin tarifa no se inventa");
});

test("tamaño del modelo = barras + áreas", () => {
  assert.equal(p.modelSize({ elements: [1, 2, 3], areas: [1], nodes: [1, 2, 3, 4] }), 4);
  assert.equal(p.modelSize({}), 0);
});
