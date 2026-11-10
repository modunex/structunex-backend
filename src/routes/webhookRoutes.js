const express = require("express");
const { handleClerkWebhook } = require("../controllers/webhookController");
const billingController = require("../controllers/billingController");

const router = express.Router();

// Raw body is required for Svix signature verification, so parse it here per-route
// instead of relying on the global express.json() (which is mounted after this).
router.post(
  "/clerk",
  express.raw({ type: "application/json" }),
  handleClerkWebhook
);

// Stripe firma el cuerpo crudo igual que Svix: mismo tratamiento.
router.post(
  "/stripe",
  express.raw({ type: "application/json" }),
  billingController.webhook
);

module.exports = router;
