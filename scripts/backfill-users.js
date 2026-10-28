// Copia a la tabla `users` los usuarios que ya existían en Clerk antes del webhook
// (el webhook solo ve los user.created/updated posteriores). Idempotente: upsert por
// clerkId, así que se puede repetir sin duplicar.
//
//   node scripts/backfill-users.js
//
// Usa CLERK_SECRET_KEY y DATABASE_URL del entorno (.env.local / .env). No toca
// Mailchimp.
const { createClerkClient } = require("@clerk/express");
const { env } = require("../src/config/env");
const { prisma } = require("../src/config/db");
const userService = require("../src/services/userService");

const PAGE = 100;

// Mismo mapeo que parseClerkUser del webhook, pero el SDK devuelve camelCase.
function fromSdkUser(u) {
  const emails = u.emailAddresses || [];
  const primary = emails.find((e) => e.id === u.primaryEmailAddressId) || emails[0];
  return {
    clerkId: u.id,
    email: primary ? primary.emailAddress : undefined,
    firstName: u.firstName || undefined,
    lastName: u.lastName || undefined,
    imageUrl: u.imageUrl || undefined,
  };
}

async function main() {
  const clerk = createClerkClient({ secretKey: env.clerkSecretKey });
  let offset = 0;
  let total = 0;
  for (;;) {
    const { data } = await clerk.users.getUserList({ limit: PAGE, offset });
    for (const u of data) {
      await userService.upsertFromClerk(fromSdkUser(u));
      total += 1;
    }
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  console.log(`[backfill] ${total} usuarios sincronizados`);
}

main()
  .catch((err) => {
    console.error("[backfill] Error:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
