const { Webhook } = require("svix");
const { env } = require("../config/env");
const { asyncHandler } = require("../middleware/errorHandler");
const userService = require("../services/userService");
const mailchimpService = require("../services/mailchimpService");
const emailService = require("../services/emailService");

// Pull the fields we care about out of a Clerk user.* event payload.
function parseClerkUser(data) {
  const emails = data.email_addresses || [];
  const primary =
    emails.find((e) => e.id === data.primary_email_address_id) || emails[0];
  return {
    clerkId: data.id,
    email: primary ? primary.email_address : undefined,
    firstName: data.first_name || undefined,
    lastName: data.last_name || undefined,
    imageUrl: data.image_url || undefined,
    // Idioma elegido en la app (Cuenta → Idioma): el de los correos.
    language: ["es", "en"].includes(data.unsafe_metadata?.language) ? data.unsafe_metadata.language : undefined,
  };
}

// POST /api/webhooks/clerk — mounted with express.raw() before the global JSON
// parser (Svix signature verification needs the raw body) and outside requireAuth
// (authenticated by signature, not a Clerk session).
const handleClerkWebhook = asyncHandler(async (req, res) => {
  // 1. Verify the Svix signature against the raw body.
  let evt;
  try {
    const wh = new Webhook(env.clerkWebhookSigningSecret);
    evt = wh.verify(req.body.toString("utf8"), {
      "svix-id": req.headers["svix-id"],
      "svix-timestamp": req.headers["svix-timestamp"],
      "svix-signature": req.headers["svix-signature"],
    });
  } catch (err) {
    return res.status(400).json({ error: "InvalidSignature" });
  }

  // 2. Act on the event. Unknown types are acknowledged and ignored.
  const { type, data } = evt;

  if (type === "user.created" || type === "user.updated") {
    const user = parseClerkUser(data);
    const saved = await userService.upsertFromClerk(user);
    if (type === "user.created") await emailService.sendWelcome(saved);
    if (user.email) {
      const result = await mailchimpService.addOrUpdateMember(user);
      if (result && result.ok) {
        await userService.markMailchimpSynced(user.clerkId);
      }
    }
  } else if (type === "user.deleted" && data && data.id) {
    await userService.deleteByClerkId(data.id);
  }

  return res.status(200).json({ received: true });
});

module.exports = { handleClerkWebhook };
