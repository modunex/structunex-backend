// Correos transaccionales de la app con Resend: bienvenida y plan activado.
//
// Los correos de pago (recibos, facturas, pago fallido, renovación, cancelación) NO salen
// de aquí: con Managed Payments los envía Stripe (Link), que es el vendedor registrado.
//
// Reglas:
//  - Cada correo tiene una clave única (email_deliveries.key): sale una sola vez aunque el
//    webhook que lo dispara llegue repetido.
//  - Un fallo al enviar nunca rompe el webhook que lo pidió: se registra y se sigue.
//  - Sin RESEND_API_KEY o EMAIL_FROM no se envía nada (queda como "skipped").
const { Resend } = require("resend");
const { prisma } = require("../config/db");
const { env } = require("../config/env");
const templates = require("../emails/templates");

let client = null;
const resend = () => (client ??= new Resend(env.resendApiKey));
const configured = () => Boolean(env.resendApiKey && env.emailFrom);

/**
 * Envía un correo una sola vez por `key`. Devuelve el estado final:
 * sent | failed | skipped | duplicate.
 */
async function sendOnce({ user, key, kind, build }) {
  if (!user?.email) return "skipped";
  const existing = await prisma.emailDelivery.findUnique({ where: { key } });
  // Uno ya enviado (o en curso) no se repite; uno fallido u omitido se reintenta.
  if (existing && existing.status === "sent") return "duplicate";

  if (!configured()) {
    await record({ user, key, kind, status: "skipped", error: "RESEND_API_KEY / EMAIL_FROM sin configurar" });
    return "skipped";
  }

  const { subject, html, text } = build();
  try {
    const { data, error } = await resend().emails.send(
      {
        from: env.emailFrom,
        to: [user.email],
        replyTo: env.emailReplyTo || undefined,
        subject,
        html,
        text,
        tags: [{ name: "kind", value: kind }],
      },
      // Resend descarta un segundo envío con la misma clave (24 h): cubre la carrera entre
      // dos webhooks simultáneos que aún no ven el registro del otro.
      { idempotencyKey: key }
    );
    if (error) throw new Error(error.message || String(error));
    await record({ user, key, kind, status: "sent", providerId: data?.id || null });
    return "sent";
  } catch (err) {
    console.error(`[email] ${kind} to user ${user.id} failed:`, err.message);
    await record({ user, key, kind, status: "failed", error: String(err.message).slice(0, 500) });
    return "failed";
  }
}

function record({ user, key, kind, status, providerId = null, error = null }) {
  return prisma.emailDelivery
    .upsert({
      where: { key },
      create: { userId: user.id, key, kind, status, providerId, error },
      update: { status, providerId, error },
    })
    .catch((err) => console.error("[email] could not record delivery", err.message));
}

/** Bienvenida, al crearse la cuenta (webhook de Clerk user.created). */
function sendWelcome(user) {
  return sendOnce({
    user,
    key: `welcome:${user.id}`,
    kind: "welcome",
    build: () =>
      templates.welcomeEmail({
        firstName: user.firstName,
        lang: user.language,
        appUrl: env.appUrl,
        siteUrl: env.publicSiteUrl,
        logoUrl: env.emailLogoUrl,
      }),
  });
}

/**
 * Plan de pago activado (alta o mejora). Una vez por suscripción y plan: pasar de Student
 * a Principal manda otro; una renovación no manda nada.
 */
function sendPlanActivated(user, { plan, subscriptionId }) {
  if (plan !== "student" && plan !== "principal") return Promise.resolve("skipped");
  return sendOnce({
    user,
    key: `plan:${subscriptionId}:${plan}`,
    kind: "plan_activated",
    build: () =>
      templates.planActivatedEmail({
        firstName: user.firstName,
        lang: user.language,
        plan,
        appUrl: env.appUrl,
        logoUrl: env.emailLogoUrl,
      }),
  });
}

/** Para los webhooks: nunca lanza. */
const safe = (fn) => (...args) =>
  fn(...args).catch((err) => {
    console.error("[email] unexpected error", err);
    return "failed";
  });

module.exports = {
  sendWelcome: safe(sendWelcome),
  sendPlanActivated: safe(sendPlanActivated),
};
