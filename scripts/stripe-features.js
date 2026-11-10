#!/usr/bin/env node
// Crea en Stripe las features de src/lib/billingPlans.js y las asocia a los productos de
// cada plan (los productos se reconocen por metadata.plan = "student" | "principal").
//
//   STRIPE_SECRET_KEY=sk_test_… node scripts/stripe-features.js            # muestra los cambios
//   STRIPE_SECRET_KEY=sk_test_… node scripts/stripe-features.js --apply    # los aplica
//
// Idempotente: lo que ya existe se deja como está, así que se puede correr en prueba y
// después en producción. No quita features de un producto (eso se hace a mano, a
// propósito: quitarla corta el acceso de clientes que ya pagan).
require("dotenv").config({ path: ".env.local" });
require("dotenv").config();
const Stripe = require("stripe");
const { FEATURES, PLANS } = require("../src/lib/billingPlans");

async function main() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("Falta STRIPE_SECRET_KEY");
  const apply = process.argv.includes("--apply");
  const stripe = new Stripe(key);
  console.log(`Cuenta en modo ${key.startsWith("sk_live") ? "EN VIVO" : "de prueba"}${apply ? "" : " (simulación)"}`);

  // 1. Features.
  const existing = new Map();
  for await (const f of stripe.entitlements.features.list({ limit: 100 })) existing.set(f.lookup_key, f);
  for (const f of FEATURES) {
    if (existing.has(f.key)) continue;
    console.log(`+ feature ${f.key} — ${f.name}`);
    if (apply) {
      existing.set(
        f.key,
        await stripe.entitlements.features.create({
          lookup_key: f.key,
          name: f.name,
          metadata: { category: f.category },
        })
      );
    }
  }

  // 2. Asociación a los productos de cada plan.
  for await (const product of stripe.products.list({ active: true, limit: 100 })) {
    const plan = PLANS[product.metadata?.plan];
    if (!plan || plan.id === "free") continue;
    const attached = new Set();
    for await (const pf of stripe.products.listFeatures(product.id, { limit: 100 })) {
      attached.add(pf.entitlement_feature.lookup_key);
    }
    for (const fk of plan.features) {
      if (attached.has(fk)) continue;
      console.log(`+ ${product.name} ← ${fk}`);
      if (apply) {
        const feature = existing.get(fk);
        if (!feature) throw new Error(`La feature ${fk} no existe (¿faltó --apply en el paso 1?)`);
        await stripe.products.createFeature(product.id, { entitlement_feature: feature.id });
      }
    }
    const extra = [...attached].filter((k) => !plan.features.includes(k));
    if (extra.length) console.log(`! ${product.name} tiene features que el plan no declara: ${extra.join(", ")}`);
  }
  console.log(apply ? "Listo." : "Nada aplicado. Repite con --apply.");
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
