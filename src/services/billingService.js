// Facturación: la cuenta de cada usuario (plan, features, créditos de IA), el cobro con
// Stripe (Checkout, portal de cliente) y lo que llega por su webhook.
//
// Reglas de diseño:
//  - El webhook es la única fuente del plan. La app nunca lo deduce de una redirección.
//  - Los límites se aplican en el backend (assert*); el frontend solo los muestra.
//  - Con BILLING_ENFORCE apagado se registra todo (plan, consumo) pero nadie se bloquea.
const Stripe = require("stripe");
const { Prisma } = require("@prisma/client");
const { prisma } = require("../config/db");
const { env } = require("../config/env");
const { AppError } = require("../middleware/errorHandler");
const plans = require("../lib/billingPlans");
const credits = require("../lib/billingCredits");

let stripeClient = null;
function stripe() {
  if (!env.stripeSecretKey) {
    throw new AppError(503, "La facturación no está configurada (falta STRIPE_SECRET_KEY).");
  }
  if (!stripeClient) stripeClient = new Stripe(env.stripeSecretKey);
  return stripeClient;
}

let aiPrices = null;
function prices() {
  if (aiPrices === null) aiPrices = plans.parseAiPrices(env.aiPricesUsdPerMtok);
  return aiPrices;
}

/** 402: lo que pide el usuario no entra en su plan. `code` lo traduce el frontend. */
function planError(code, details = {}) {
  return new AppError(402, "Tu plan no incluye esta acción.", { error: code, ...details });
}

// ─── Cuenta ───

/** El usuario de la app (espejo de Clerk). Si el webhook de Clerk aún no lo creó, se crea. */
async function getAccount(clerkId) {
  const user = await prisma.user.findUnique({ where: { clerkId } });
  const account = user || (await prisma.user.upsert({ where: { clerkId }, create: { clerkId }, update: {} }));
  return refreshFreeCredits(account);
}

/** Cuentas sin suscripción: reponen sus créditos cada 30 días, al primer uso. */
async function refreshFreeCredits(account, now = new Date()) {
  if (!credits.needsFreeReset(account, now)) return account;
  const amount = plans.PLANS.free.aiCreditsMonthly;
  // Condición sobre el valor leído: dos peticiones a la vez reponen una sola vez.
  const { count } = await prisma.user.updateMany({
    where: { id: account.id, aiCreditsResetAt: account.aiCreditsResetAt },
    data: { aiCreditsMonthly: amount, aiCreditsResetAt: now },
  });
  if (count === 1) {
    await prisma.aiCreditEntry.create({
      data: { userId: account.id, delta: amount, kind: "monthly_grant" },
    });
  }
  return prisma.user.findUnique({ where: { id: account.id } });
}

function liveGrants(userId, now = new Date()) {
  return prisma.aiCreditGrant.findMany({
    where: { userId, remaining: { gt: 0 }, expiresAt: { gt: now } },
    orderBy: { expiresAt: "asc" },
  });
}

const finite = (n) => (Number.isFinite(n) ? n : null); // Infinity → null en JSON

/** GET /billing/me: todo lo que la app necesita para pintar Plan y Uso. */
async function summary(clerkId) {
  const account = await getAccount(clerkId);
  const plan = plans.planFor(account.plan);
  const features = plans.effectiveFeatures(account);
  const [grants, projects, foundingTaken, recent] = await Promise.all([
    liveGrants(account.id),
    prisma.project.count({ where: { ownerId: clerkId } }),
    foundingMembersTaken(),
    prisma.aiCreditEntry.findMany({
      where: { userId: account.id },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { delta: true, kind: true, model: true, projectId: true, createdAt: true },
    }),
  ]);
  return {
    enforced: env.billingEnforce,
    plan: account.plan,
    status: account.planStatus,
    priceKey: account.planPriceKey,
    periodEnd: account.planPeriodEnd,
    hasCustomer: Boolean(account.stripeCustomerId),
    features,
    limits: {
      maxElements: finite(plan.maxElements),
      maxProjects: finite(plan.maxProjects),
      aiCreditsMonthly: plan.aiCreditsMonthly,
    },
    usage: { projects },
    credits: {
      ...credits.balance(account, grants),
      monthlyResetAt: account.aiCreditsResetAt,
      grants: grants.map((g) => ({ remaining: g.remaining, expiresAt: g.expiresAt })),
      recent,
    },
    aiModels: Object.entries(plans.AI_MODEL_FEATURE)
      .filter(([, f]) => !f || features.includes(f))
      .map(([family]) => family),
    foundingMember: {
      limit: env.foundingMemberLimit,
      taken: foundingTaken,
      available: foundingTaken < env.foundingMemberLimit,
    },
  };
}

// ─── Límites (los llaman los controladores antes de hacer el trabajo) ───

async function assertFeature(clerkId, feature) {
  if (!env.billingEnforce || !feature) return;
  const account = await getAccount(clerkId);
  if (!plans.effectiveFeatures(account).includes(feature)) {
    throw planError("plan.featureRequired", { feature, plan: account.plan });
  }
}

async function assertModelSize(clerkId, size) {
  if (!env.billingEnforce) return;
  const account = await getAccount(clerkId);
  const max = plans.planFor(account.plan).maxElements;
  if (size > max) throw planError("plan.modelTooLarge", { size, max, plan: account.plan });
}

async function assertCanCreateProject(clerkId) {
  if (!env.billingEnforce) return;
  const account = await getAccount(clerkId);
  const max = plans.planFor(account.plan).maxProjects;
  if (!Number.isFinite(max)) return;
  const count = await prisma.project.count({ where: { ownerId: clerkId } });
  if (count >= max) throw planError("plan.projectLimit", { count, max, plan: account.plan });
}

/** Antes de un turno del asistente: modelo permitido, tarifa conocida y saldo. */
async function assertAiTurn(clerkId, modelId) {
  if (!env.billingEnforce) return;
  const account = await getAccount(clerkId);
  const family = plans.modelFamily(modelId);
  const feature = plans.AI_MODEL_FEATURE[family];
  if (family && feature && !plans.effectiveFeatures(account).includes(feature)) {
    throw planError("plan.aiModelNotIncluded", { model: family, plan: account.plan });
  }
  let known = false;
  try {
    known = Boolean(prices()[family]);
  } catch (err) {
    console.error("[billing] AI prices", err.message);
  }
  if (!known) {
    throw new AppError(503, "El costo de este modelo no está configurado (AI_PRICES_USD_PER_MTOK).");
  }
  const { total } = credits.balance(account, await liveGrants(account.id));
  if (total <= 0) throw planError("plan.noAiCredits", { plan: account.plan });
}

/**
 * Cobra un turno ya hecho. Se registra siempre (también con BILLING_ENFORCE apagado),
 * para medir el consumo real antes de activar los límites.
 */
async function chargeAiTurn({ clerkId, usage, modelId, messageId, projectId }) {
  const family = plans.modelFamily(modelId);
  let amount;
  try {
    amount = plans.creditsForUsage(usage, family, prices(), env.aiCreditMarkup);
  } catch (err) {
    console.error("[billing] AI prices", err.message);
    amount = null;
  }
  const account = await getAccount(clerkId);
  const entry = {
    userId: account.id,
    kind: "consumption",
    messageId: messageId || null,
    projectId: projectId || null,
    model: modelId || null,
    usage: usage || Prisma.JsonNull,
  };
  if (amount === null) {
    // Sin tarifa no se inventa un costo: queda el uso en tokens y un aviso en el log.
    console.warn(`[billing] no AI price for "${family}"; turn recorded without charge`);
    await prisma.aiCreditEntry.create({ data: { ...entry, delta: 0 } });
    return { charged: 0 };
  }

  return prisma.$transaction(async (tx) => {
    // Bloquea la fila del usuario: dos cobros a la vez no gastan el mismo saldo.
    await tx.$queryRaw`SELECT id FROM "users" WHERE id = ${account.id}::uuid FOR UPDATE`;
    const fresh = await tx.user.findUnique({ where: { id: account.id } });
    const grants = await tx.aiCreditGrant.findMany({
      where: { userId: account.id, remaining: { gt: 0 }, expiresAt: { gt: new Date() } },
    });
    const { monthlyUsed, grantUse, shortfall } = credits.allocate(fresh, grants, amount);
    if (monthlyUsed > 0) {
      await tx.user.update({
        where: { id: account.id },
        data: { aiCreditsMonthly: { decrement: monthlyUsed } },
      });
    }
    for (const g of grantUse) {
      await tx.aiCreditGrant.update({ where: { id: g.id }, data: { remaining: { decrement: g.used } } });
    }
    // El libro guarda lo que costó el turno; `shortfall` es la parte que el saldo no cubrió.
    await tx.aiCreditEntry.create({ data: { ...entry, delta: -amount } });
    if (shortfall > 0) console.warn(`[billing] user ${account.id} overdrew ${shortfall} credits`);
    return { charged: amount, shortfall };
  });
}

// ─── Stripe: Checkout y portal ───

async function priceByLookupKey(lookupKey) {
  const { data } = await stripe().prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 });
  if (!data.length) throw new AppError(500, `Precio de Stripe no encontrado: ${lookupKey}`);
  return data[0];
}

function foundingMembersTaken() {
  return prisma.user.count({
    where: { planPriceKey: plans.FOUNDING_PRICE_KEY, plan: { not: "free" } },
  });
}

async function ensureCustomer(account) {
  if (account.stripeCustomerId) return account.stripeCustomerId;
  const customer = await stripe().customers.create(
    {
      email: account.email || undefined,
      name: [account.firstName, account.lastName].filter(Boolean).join(" ") || undefined,
      metadata: { clerkId: account.clerkId },
    },
    { idempotencyKey: `customer-${account.clerkId}` }
  );
  await prisma.user.update({ where: { id: account.id }, data: { stripeCustomerId: customer.id } });
  return customer.id;
}

/** POST /billing/checkout { lookupKey } → URL de Stripe Checkout. */
async function createCheckout(clerkId, lookupKey) {
  const isPlan = Boolean(plans.planForPriceKey(lookupKey));
  const isCredits = plans.CREDIT_PACK_PRICES.includes(lookupKey);
  if (!isPlan && !isCredits) throw new AppError(400, "Precio no disponible");

  const account = await getAccount(clerkId);
  if (isPlan && account.stripeSubscriptionId && account.plan !== "free") {
    // Cambiar de plan con una suscripción viva se hace en el portal (prorratea).
    throw new AppError(409, "Ya tienes una suscripción activa.", { error: "billing.useCustomerPortal" });
  }
  if (lookupKey === plans.FOUNDING_PRICE_KEY && (await foundingMembersTaken()) >= env.foundingMemberLimit) {
    throw new AppError(409, "La oferta Founding Member está agotada.", { error: "billing.foundingSoldOut" });
  }
  if (isCredits) await assertFeature(clerkId, "ai_credit_purchase");

  const price = await priceByLookupKey(lookupKey);
  const customer = await ensureCustomer(account);
  const session = await stripe().checkout.sessions.create({
    mode: isPlan ? "subscription" : "payment",
    customer,
    client_reference_id: clerkId,
    line_items: [{ price: price.id, quantity: 1 }],
    metadata: { clerkId, lookupKey },
    ...(isPlan ? { subscription_data: { metadata: { clerkId } } } : {}),
    ...(env.stripeManagedPayments ? { managed_payments: { enabled: true } } : {}),
    success_url: `${env.appUrl}/projects?checkout=success`,
    cancel_url: `${env.appUrl}/projects?checkout=cancel`,
  });
  return { url: session.url };
}

/** POST /billing/portal → URL del portal de cliente de Stripe. */
async function createPortal(clerkId) {
  const account = await getAccount(clerkId);
  if (!account.stripeCustomerId) throw new AppError(409, "Aún no tienes una suscripción.");
  const session = await stripe().billingPortal.sessions.create({
    customer: account.stripeCustomerId,
    return_url: `${env.appUrl}/projects`,
  });
  return { url: session.url };
}

// ─── Webhook de Stripe ───

function verifyEvent(rawBody, signature) {
  if (!env.stripeWebhookSecret) throw new AppError(503, "Webhook de Stripe no configurado");
  try {
    return stripe().webhooks.constructEvent(rawBody, signature, env.stripeWebhookSecret);
  } catch {
    throw new AppError(400, "InvalidSignature");
  }
}

const idOf = (v) => (typeof v === "string" ? v : v?.id) || null;

async function userForCustomer(customerId, clerkIdHint) {
  if (customerId) {
    const byCustomer = await prisma.user.findUnique({ where: { stripeCustomerId: customerId } });
    if (byCustomer) return byCustomer;
  }
  if (clerkIdHint) {
    const account = await getAccount(clerkIdHint);
    if (customerId && !account.stripeCustomerId) {
      return prisma.user.update({ where: { id: account.id }, data: { stripeCustomerId: customerId } });
    }
    return account;
  }
  return null;
}

/** Aplica el estado de una suscripción al usuario. Se relee de Stripe: los eventos pueden llegar desordenados. */
async function syncSubscription(subscriptionId, { deleted = false, clerkIdHint } = {}) {
  const sub = await stripe().subscriptions.retrieve(subscriptionId);
  const user = await userForCustomer(idOf(sub.customer), clerkIdHint || sub.metadata?.clerkId);
  if (!user) {
    console.warn(`[billing] subscription ${subscriptionId} without a matching user`);
    return;
  }
  const { plan, priceKey } = deleted ? { plan: "free", priceKey: null } : plans.planFromSubscription(sub);
  const ended = plan === "free";
  const periodEnd = sub.items?.data?.[0]?.current_period_end || sub.current_period_end || null;
  // Otra suscripción más nueva ya manda: no la pisa una vieja que se cancela.
  if (ended && user.stripeSubscriptionId && user.stripeSubscriptionId !== sub.id) return;

  const data = {
    plan,
    planStatus: sub.status,
    planPriceKey: priceKey,
    planPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
    stripeSubscriptionId: ended ? null : sub.id,
  };
  if (ended && user.plan !== "free") {
    // Vuelve a Free: sus créditos pasan a los del plan gratuito desde hoy.
    Object.assign(data, { aiCreditsMonthly: plans.PLANS.free.aiCreditsMonthly, aiCreditsResetAt: new Date() });
  }
  await prisma.user.update({ where: { id: user.id }, data });
}

/** Factura cobrada de una suscripción: repone los créditos del plan (no se acumulan). */
async function onInvoicePaid(invoice) {
  const subscriptionId =
    idOf(invoice.subscription) || idOf(invoice.parent?.subscription_details?.subscription);
  if (!subscriptionId) return;
  await syncSubscription(subscriptionId);
  const user = await userForCustomer(idOf(invoice.customer));
  if (!user || user.plan === "free") return;
  const amount = plans.planFor(user.plan).aiCreditsMonthly;
  try {
    await prisma.$transaction([
      prisma.aiCreditEntry.create({
        data: { userId: user.id, delta: amount, kind: "monthly_grant", stripeRef: invoice.id },
      }),
      prisma.user.update({
        where: { id: user.id },
        data: { aiCreditsMonthly: amount, aiCreditsResetAt: new Date() },
      }),
    ]);
  } catch (err) {
    if (err?.code === "P2002") return; // factura ya aplicada (webhook repetido)
    throw err;
  }
}

/** Paquete de créditos pagado: un lote con vencimiento a 12 meses. */
async function grantPurchasedCredits(session) {
  if (session.mode !== "payment" || session.payment_status !== "paid") return;
  const user = await userForCustomer(idOf(session.customer), session.client_reference_id);
  if (!user) return;
  const items = await stripe().checkout.sessions.listLineItems(session.id, {
    expand: ["data.price.product"],
  });
  let total = 0;
  for (const item of items.data) {
    const perPack = Number(item.price?.product?.metadata?.credits || 0);
    if (Number.isInteger(perPack) && perPack > 0) total += perPack * (item.quantity || 1);
  }
  if (total <= 0) return;
  const expiresAt = new Date(Date.now() + plans.PURCHASED_CREDITS_TTL_DAYS * 24 * 3600 * 1000);
  try {
    await prisma.$transaction([
      prisma.aiCreditGrant.create({
        data: { userId: user.id, credits: total, remaining: total, expiresAt, stripeRef: session.id },
      }),
      prisma.aiCreditEntry.create({
        data: { userId: user.id, delta: total, kind: "purchase", stripeRef: session.id },
      }),
    ]);
  } catch (err) {
    if (err?.code === "P2002") return; // ya acreditado
    throw err;
  }
}

/** Features activas según Stripe Entitlements. */
async function syncEntitlements(customerId) {
  const user = await userForCustomer(customerId);
  if (!user) return;
  const keys = [];
  for await (const ent of stripe().entitlements.activeEntitlements.list({ customer: customerId, limit: 100 })) {
    if (ent.lookup_key) keys.push(ent.lookup_key);
  }
  await prisma.user.update({
    where: { id: user.id },
    data: { features: keys, featuresSyncedAt: new Date() },
  });
}

async function handleEvent(event) {
  const done = await prisma.stripeEvent.findUnique({ where: { id: event.id } });
  if (done) return;
  const obj = event.data.object;

  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
      await userForCustomer(idOf(obj.customer), obj.client_reference_id);
      if (obj.mode === "subscription" && obj.subscription) {
        await syncSubscription(idOf(obj.subscription), { clerkIdHint: obj.client_reference_id });
      } else {
        await grantPurchasedCredits(obj);
      }
      break;
    case "customer.subscription.created":
    case "customer.subscription.updated":
      await syncSubscription(obj.id);
      break;
    case "customer.subscription.deleted":
      await syncSubscription(obj.id, { deleted: true });
      break;
    case "invoice.paid":
      await onInvoicePaid(obj);
      break;
    case "entitlements.active_entitlement_summary.updated":
      await syncEntitlements(idOf(obj.customer));
      break;
    default:
      return; // no se registra: un tipo que no se maneja no ocupa la tabla
  }
  await prisma.stripeEvent
    .create({ data: { id: event.id, type: event.type } })
    .catch((err) => {
      if (err?.code !== "P2002") throw err;
    });
}

module.exports = {
  getAccount,
  summary,
  assertFeature,
  assertModelSize,
  assertCanCreateProject,
  assertAiTurn,
  chargeAiTurn,
  createCheckout,
  createPortal,
  verifyEvent,
  handleEvent,
};
