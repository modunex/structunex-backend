const { z } = require("zod");
const { asyncHandler, AppError } = require("../middleware/errorHandler");
const billing = require("../services/billingService");

const checkoutSchema = z.object({ lookupKey: z.string().min(1).max(100) });

module.exports = {
  /** GET /api/billing/me — plan, features, límites, uso y créditos del usuario. */
  me: asyncHandler(async (req, res) => {
    res.json(await billing.summary(req.userId));
  }),

  /** POST /api/billing/checkout { lookupKey } → { url } de Stripe Checkout. */
  checkout: asyncHandler(async (req, res) => {
    const parsed = checkoutSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, "lookupKey requerido");
    res.json(await billing.createCheckout(req.userId, parsed.data.lookupKey));
  }),

  /** POST /api/billing/portal → { url } del portal de cliente de Stripe. */
  portal: asyncHandler(async (req, res) => {
    res.json(await billing.createPortal(req.userId));
  }),

  /**
   * POST /api/webhooks/stripe — montado con express.raw() antes del parser JSON (la firma se
   * verifica sobre el cuerpo crudo) y fuera de requireAuth (lo autentica la firma).
   */
  webhook: asyncHandler(async (req, res) => {
    const event = billing.verifyEvent(req.body, req.headers["stripe-signature"]);
    await billing.handleEvent(event);
    res.json({ received: true });
  }),
};
