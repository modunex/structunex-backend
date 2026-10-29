const { Router } = require("express");
const c = require("../controllers/connectionController");
const { validate } = require("../middleware/validate");
const { inspectConnectionSchema } = require("../schemas/connectionSchema");

const router = Router({ mergeParams: true });

// requireAuth + loadProject vienen heredados de projectRoutes.
router.post("/inspect", validate(inspectConnectionSchema), c.inspect);

module.exports = router;
