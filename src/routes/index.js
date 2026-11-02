const { Router } = require("express");
const projectRoutes = require("./projectRoutes");
const catalogMaterialRoutes = require("./catalogMaterialRoutes");
const catalogFrameSectionRoutes = require("./catalogFrameSectionRoutes");
const catalogAreaSectionRoutes = require("./catalogAreaSectionRoutes");
const aiscShapeRoutes = require("./aiscShapeRoutes");
const loadCombinationRoutes = require("./loadCombinationRoutes");
const seismicCodeRoutes = require("./seismicCodeRoutes");
const { env } = require("../config/env");
const { createCommunityRouter } = require("./communityRoutes");

const router = Router();

router.get("/health", (_req, res) => res.json({ status: "ok" }));
router.use("/projects", projectRoutes);
router.use("/materials", catalogMaterialRoutes);
router.use("/sections", catalogFrameSectionRoutes);
router.use("/area-sections", catalogAreaSectionRoutes);
router.use("/shapes", aiscShapeRoutes);
router.use("/load-combinations", loadCombinationRoutes);
router.use("/seismic-codes", seismicCodeRoutes);
if (env.communityEnabled) router.use("/community", createCommunityRouter());

module.exports = router;
