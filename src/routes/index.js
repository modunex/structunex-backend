const { Router } = require("express");
const projectRoutes = require("./projectRoutes");
const catalogMaterialRoutes = require("./catalogMaterialRoutes");
const catalogFrameSectionRoutes = require("./catalogFrameSectionRoutes");
const catalogAreaSectionRoutes = require("./catalogAreaSectionRoutes");
const aiscShapeRoutes = require("./aiscShapeRoutes");
const loadCombinationRoutes = require("./loadCombinationRoutes");
const seismicCodeRoutes = require("./seismicCodeRoutes");
const { createCommunityRouter } = require("./communityRoutes");
const billingRoutes = require("./billingRoutes");

const router = Router();

router.get("/health", (_req, res) => res.json({ status: "ok" }));
router.use("/projects", projectRoutes);
router.use("/materials", catalogMaterialRoutes);
router.use("/sections", catalogFrameSectionRoutes);
router.use("/area-sections", catalogAreaSectionRoutes);
router.use("/shapes", aiscShapeRoutes);
router.use("/load-combinations", loadCombinationRoutes);
router.use("/seismic-codes", seismicCodeRoutes);
router.use("/community", createCommunityRouter());
router.use("/billing", billingRoutes);

module.exports = router;
