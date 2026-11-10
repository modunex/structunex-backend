// Aritmética de los créditos de IA, sin base de datos (la usa billingService).

const FREE_PERIOD_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * ¿Toca reponer los créditos mensuales? Solo para cuentas sin suscripción: en un plan de
 * pago los repone el webhook al cobrarse cada factura (invoice.paid).
 */
function needsFreeReset(account, now = new Date()) {
  if (account.stripeSubscriptionId && account.plan !== "free") return false;
  if (!account.aiCreditsResetAt) return true;
  return now.getTime() - new Date(account.aiCreditsResetAt).getTime() >= FREE_PERIOD_DAYS * DAY_MS;
}

/** Lotes comprados que aún sirven: con saldo y sin vencer, del que vence antes al último. */
function usableGrants(grants, now = new Date()) {
  return grants
    .filter((g) => g.remaining > 0 && new Date(g.expiresAt) > now)
    .sort((a, b) => new Date(a.expiresAt) - new Date(b.expiresAt));
}

function balance(account, grants, now = new Date()) {
  const purchased = usableGrants(grants, now).reduce((s, g) => s + g.remaining, 0);
  const monthly = Math.max(0, account.aiCreditsMonthly || 0);
  return { monthly, purchased, total: monthly + purchased };
}

/**
 * Reparte un consumo: primero los créditos del plan, luego los lotes por vencimiento.
 * Lo que no alcance queda en `shortfall`: el turno ya se hizo (se cobra al terminar), así
 * que el saldo se agota pero nunca baja de cero. El siguiente turno ya no se permite.
 */
function allocate(account, grants, amount, now = new Date()) {
  let left = Math.max(0, Math.ceil(amount || 0));
  const monthlyUsed = Math.min(left, Math.max(0, account.aiCreditsMonthly || 0));
  left -= monthlyUsed;
  const grantUse = [];
  for (const g of usableGrants(grants, now)) {
    if (left === 0) break;
    const used = Math.min(left, g.remaining);
    grantUse.push({ id: g.id, used });
    left -= used;
  }
  return { monthlyUsed, grantUse, shortfall: left };
}

module.exports = { FREE_PERIOD_DAYS, needsFreeReset, usableGrants, balance, allocate };
