const { Router } = require("express");
const c = require("../controllers/connectionController");
const { validate } = require("../middleware/validate");
const {
  inspectConnectionSchema,
  createConnectionSchema,
  updateConnectionSchema,
  layoutPreviewSchema,
  femStartSchema,
} = require("../schemas/connectionSchema");

const router = Router({ mergeParams: true });

// requireAuth + loadProject vienen heredados de projectRoutes.
router.post("/inspect", validate(inspectConnectionSchema), c.inspect);

router.get("/", c.list); // ?nodeId=N12 para las de un nudo
router.post("/", validate(createConnectionSchema), c.create);
router.get("/:connectionId", c.getOne);
router.patch("/:connectionId", validate(updateConnectionSchema), c.update);
router.delete("/:connectionId", c.remove);
router.post("/:connectionId/check", c.check);
router.get("/:connectionId/runs/latest", c.latestRun);
router.post("/:connectionId/layout", validate(layoutPreviewSchema), c.layout);
// Fase 3 (CBFEM)
router.post("/:connectionId/mesh", validate(layoutPreviewSchema), c.mesh);
router.post("/:connectionId/fem", validate(femStartSchema), c.femStart);
router.get("/:connectionId/fem/latest", c.femLatest);
router.post("/:connectionId/fem/cancel", c.femCancel);
router.get("/:connectionId/fem/:runId/files", c.femFiles);

module.exports = router;
