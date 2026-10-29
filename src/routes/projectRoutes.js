const { Router } = require("express");
const pc = require("../controllers/projectController");
const { validate } = require("../middleware/validate");
const { requireAuth } = require("../middleware/auth");
const { loadProject } = require("../middleware/loadProject");
const {
  createProjectSchema,
  updateProjectMetaSchema,
} = require("../schemas/projectSchema");

const nodeRoutes = require("./nodeRoutes");
const elementRoutes = require("./elementRoutes");
const supportRoutes = require("./supportRoutes");
const loadRoutes = require("./loadRoutes");
const areaRoutes = require("./areaRoutes");
const modelRoutes = require("./modelRoutes");
const analysisRoutes = require("./analysisRoutes");
const designRoutes = require("./designRoutes");
const connectionRoutes = require("./connectionRoutes");
const projectLoadCombinationRoutes = require("./projectLoadCombinationRoutes");
const aiRoutes = require("./aiRoutes");

const router = Router();

// Every project route requires a valid Clerk session.
router.use(requireAuth);

// Collection-level (no specific project yet).
router.get("/", pc.list);
router.post("/", validate(createProjectSchema), pc.create);

// Anything under a specific project first loads + authorizes it. loadProject
// attaches req.project / req.projectId for all handlers and sub-routers below.
router.use("/:projectId", loadProject);

router.get("/:projectId", pc.getOne);
router.patch("/:projectId", validate(updateProjectMetaSchema), pc.update);
router.delete("/:projectId", pc.remove);

// Sub-resources — each its own router (CRUD), model built incrementally.
router.use("/:projectId/nodes", nodeRoutes);
router.use("/:projectId/elements", elementRoutes);
router.use("/:projectId/supports", supportRoutes);
router.use("/:projectId/loads", loadRoutes);
router.use("/:projectId/areas", areaRoutes);
router.use("/:projectId/model", modelRoutes);
router.use("/:projectId/analysis", analysisRoutes);
router.use("/:projectId/design", designRoutes);
router.use("/:projectId/connections", connectionRoutes);
router.use("/:projectId/load-combinations", projectLoadCombinationRoutes);
router.use("/:projectId/ai", aiRoutes);

module.exports = router;
