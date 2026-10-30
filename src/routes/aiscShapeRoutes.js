const { Router } = require("express");
const c = require("../controllers/aiscShapeController");
const { requireAuth } = require("../middleware/auth");

const router = Router();

// System catalog: any authenticated user can read. Served from memory.
router.use(requireAuth);

router.get("/", c.search);
router.get("/families", c.families); // before "/:label" so it isn't parsed as a label
router.get("/catalogs", c.catalogs); // AISC, EN…
router.get("/:label", c.getOne);

module.exports = router;
