const { prisma } = require("../config/db");

// Persists app users mirrored from Clerk webhook events. Keyed by `clerkId`
// (same value as `ownerId` on projects/catalogs), so writes are idempotent on
// webhook re-delivery.

function upsertFromClerk({ clerkId, email, firstName, lastName, imageUrl }) {
  const data = { email, firstName, lastName, imageUrl };
  return prisma.user.upsert({
    where: { clerkId },
    create: { clerkId, ...data },
    update: data,
  });
}

function markMailchimpSynced(clerkId) {
  // updateMany: no falla si el usuario se borró entre medias.
  return prisma.user.updateMany({
    where: { clerkId },
    data: { mailchimpSyncedAt: new Date() },
  });
}

function deleteByClerkId(clerkId) {
  // deleteMany: no falla si el webhook llega dos veces.
  return prisma.user.deleteMany({ where: { clerkId } });
}

module.exports = { upsertFromClerk, markMailchimpSynced, deleteByClerkId };
