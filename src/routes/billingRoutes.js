const { Router } = require("express");
const c = require("../controllers/billingController");
const { requireAuth } = require("../middleware/auth");
const { byUser } = require("../middleware/rateLimit");

const router = Router();

router.use(requireAuth);
router.get("/me", c.me);
// Cada llamada crea una sesión en Stripe: con un límite basta para cortar el abuso.
const sessions = byUser({ windowMs: 60 * 1000, limit: 10 });
router.post("/checkout", sessions, c.checkout);
router.post("/portal", sessions, c.portal);

module.exports = router;
