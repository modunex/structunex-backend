const { Router } = require("express");
const c = require("../controllers/connectionController");
const { validate } = require("../middleware/validate");
const {
  inspectConnectionSchema,
  createConnectionSchema,
  updateConnectionSchema,
} = require("../schemas/connectionSchema");

const router = Router({ mergeParams: true });

// requireAuth + loadProject vienen heredados de projectRoutes.
router.post("/inspect", validate(inspectConnectionSchema), c.inspect);

router.get("/", c.list); // ?nodeId=N12 para las de un nudo
router.post("/", validate(createConnectionSchema), c.create);
router.get("/:connectionId", c.getOne);
router.patch("/:connectionId", validate(updateConnectionSchema), c.update);
router.delete("/:connectionId", c.remove);

module.exports = router;
