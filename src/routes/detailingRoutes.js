const { Router } = require("express");
const c = require("../controllers/detailingController");

const router = Router({ mergeParams: true });

// requireAuth + loadProject vienen heredados de projectRoutes.
router.get("/line", c.line); // Rebar Studio D2: línea de viga y envolventes del diseño

module.exports = router;
