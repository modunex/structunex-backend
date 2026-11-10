// Planes de Structunex: límites, features y precios de Stripe.
//
// Fuente de verdad del backend. Lo que es un número (tamaño del modelo, proyectos,
// créditos al mes) vive aquí; lo que es "sí o no" son features con el mismo lookup key
// que en Stripe Entitlements (scripts/stripe-features.js las crea y las asocia a los
// productos). Cambiar un límite = cambiar este archivo, no el código que lo aplica.

const PLAN_IDS = ["free", "student", "principal"];

// Features por categoría, igual que la tabla de precios. Lo que está en todos los
// planes (análisis, AISC 360, ACI 318…) no es feature: no hay nada que bloquear.
const FEATURES = [
  { key: "analysis_export_csv", category: "analysis", name: "Exportación de resultados a CSV" },
  { key: "design_seismic_aisc341", category: "design", name: "Verificaciones sísmicas AISC 341" },
  { key: "connections_shear_tab", category: "connections", name: "Shear Tab (AISC 360-22)" },
  {
    key: "connections_end_plate_extended",
    category: "connections",
    name: "End Plate extendida precalificada (AISC 358-22)",
  },
  { key: "reports_clean", category: "reports", name: "Reportes sin marca de agua" },
  { key: "reports_custom_logo", category: "reports", name: "Logo propio en reportes" },
  { key: "ai_credit_purchase", category: "ai", name: "Compra de créditos adicionales" },
  { key: "ai_model_sonnet", category: "ai", name: "Modelo Sonnet" },
  { key: "ai_model_opus", category: "ai", name: "Modelo Opus" },
];
const FEATURE_KEYS = FEATURES.map((f) => f.key);

const STUDENT_FEATURES = [
  "analysis_export_csv",
  "design_seismic_aisc341",
  "connections_shear_tab",
  "connections_end_plate_extended",
  "ai_credit_purchase",
  "ai_model_sonnet",
];

const PLANS = {
  free: {
    id: "free",
    maxElements: 500, // barras + áreas, antes del mallado
    maxProjects: 3,
    aiCreditsMonthly: 50,
    features: [],
    watermark: "standard",
  },
  student: {
    id: "student",
    maxElements: 5000,
    maxProjects: Infinity,
    aiCreditsMonthly: 300,
    features: STUDENT_FEATURES,
    watermark: "academic",
  },
  principal: {
    id: "principal",
    maxElements: Infinity,
    maxProjects: Infinity,
    aiCreditsMonthly: 1500,
    features: FEATURE_KEYS,
    watermark: null,
  },
};

// Precios de Stripe por lookup key (creados en el catálogo; el backend nunca usa price_…).
const SUBSCRIPTION_PRICES = {
  student_monthly: "student",
  student_annual: "student",
  principal_monthly: "principal",
  principal_annual: "principal",
  principal_founding_annual: "principal",
};
const FOUNDING_PRICE_KEY = "principal_founding_annual";
const CREDIT_PACK_PRICES = ["ai_credits_1000", "ai_credits_5000", "ai_credits_15000"];

// Feature que pide cada tipología de conexión.
const CONNECTION_FEATURE = {
  shear_tab: "connections_shear_tab",
  extended_end_plate: "connections_end_plate_extended",
};

// Feature que pide cada familia de modelos del asistente. Haiku: todos los planes.
const AI_MODEL_FEATURE = { haiku: null, sonnet: "ai_model_sonnet", opus: "ai_model_opus" };

const CREDIT_VALUE_USD = 0.01; // 1 crédito = un centavo de valor para el usuario
const PURCHASED_CREDITS_TTL_DAYS = 365;

function planFor(id) {
  return PLANS[id] || PLANS.free;
}

/** El plan de un precio suscrito, o null si el lookup key no es un plan. */
function planForPriceKey(lookupKey) {
  return SUBSCRIPTION_PRICES[lookupKey] || null;
}

// Estados de suscripción que mantienen el plan. past_due es el periodo de gracia mientras
// Stripe reintenta el cobro; al agotar los reintentos la suscripción pasa a canceled/unpaid.
const ACTIVE_STATUSES = new Set(["active", "trialing", "past_due"]);

/**
 * Plan efectivo de una suscripción de Stripe (o de su ausencia).
 * @param {{status?: string, items?: {data?: {price?: {lookup_key?: string}}[]}}|null} sub
 */
function planFromSubscription(sub) {
  if (!sub || !ACTIVE_STATUSES.has(sub.status)) return { plan: "free", priceKey: null };
  for (const item of sub.items?.data || []) {
    const key = item.price?.lookup_key;
    const plan = planForPriceKey(key);
    if (plan) return { plan, priceKey: key };
  }
  return { plan: "free", priceKey: null };
}

/**
 * Features activas de una cuenta: las de su plan, más las que Stripe Entitlements le dé
 * por encima (una promoción, una prueba de una función). Stripe puede sumar pero no
 * quitar lo que el plan promete: un producto mal configurado en Stripe no deja sin acceso
 * a quien paga. Al cancelar, el plan pasa a "free" y sus entitlements se vacían.
 */
function effectiveFeatures(account) {
  const fromPlan = planFor(account?.plan).features;
  const fromStripe = account?.featuresSyncedAt ? account.features || [] : [];
  return [...new Set([...fromPlan, ...fromStripe])];
}

/** Familia (opus | sonnet | haiku) de un id de modelo, o null. */
function modelFamily(modelId) {
  const m = /(opus|sonnet|haiku)/i.exec(String(modelId || ""));
  return m ? m[1].toLowerCase() : null;
}

/**
 * Tarifas de Bedrock por familia, en USD por millón de tokens, desde AI_PRICES_USD_PER_MTOK:
 * {"opus":{"input":…,"output":…,"cacheRead":…,"cacheWrite":…},"sonnet":{…},"haiku":{…}}.
 * No hay valores por defecto a propósito: un precio inventado cobraría mal.
 */
function parseAiPrices(raw) {
  if (!raw) return {};
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("AI_PRICES_USD_PER_MTOK no es JSON válido");
  }
  const out = {};
  for (const [family, p] of Object.entries(parsed || {})) {
    const fields = ["input", "output", "cacheRead", "cacheWrite"];
    for (const f of fields) {
      if (typeof p?.[f] !== "number" || !(p[f] >= 0)) {
        throw new Error(`AI_PRICES_USD_PER_MTOK.${family}.${f} debe ser un número ≥ 0`);
      }
    }
    out[family.toLowerCase()] = p;
  }
  return out;
}

/**
 * Créditos que cuesta un turno: costo real en Bedrock × margen, en créditos de un centavo,
 * redondeado hacia arriba. null si la familia no tiene tarifa configurada.
 */
function creditsForUsage(usage, family, prices, markup) {
  const p = prices[family];
  if (!p) return null;
  const u = usage || {};
  const usd =
    ((u.input_tokens || 0) * p.input +
      (u.output_tokens || 0) * p.output +
      (u.cache_read_input_tokens || 0) * p.cacheRead +
      (u.cache_creation_input_tokens || 0) * p.cacheWrite) /
    1e6;
  if (usd <= 0) return 0;
  return Math.ceil((usd * markup) / CREDIT_VALUE_USD);
}

/** Barras + áreas de un modelo ensamblado (lo que limita el plan). */
function modelSize(model) {
  return (model?.elements?.length || 0) + (model?.areas?.length || 0);
}

module.exports = {
  PLAN_IDS,
  PLANS,
  FEATURES,
  FEATURE_KEYS,
  SUBSCRIPTION_PRICES,
  FOUNDING_PRICE_KEY,
  CREDIT_PACK_PRICES,
  CONNECTION_FEATURE,
  AI_MODEL_FEATURE,
  CREDIT_VALUE_USD,
  PURCHASED_CREDITS_TTL_DAYS,
  planFor,
  planForPriceKey,
  planFromSubscription,
  effectiveFeatures,
  modelFamily,
  parseAiPrices,
  creditsForUsage,
  modelSize,
};
