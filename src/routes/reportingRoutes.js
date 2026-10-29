const { Router } = require("express");
const c = require("../controllers/reportingController");
const { validate } = require("../middleware/validate");
const { exportReportSchema, logoUploadSchema, setLogoSchema } = require("../schemas/reportingSchema");

const router = Router({ mergeParams: true });

// requireAuth + loadProject vienen heredados de projectRoutes.
router.get("/", c.archive);
router.get("/connection-runs/:runId", c.connectionSheet);
router.get("/design-runs/:designRunId/members", c.designRunMembers);
router.get("/design-runs/:designRunId/members/:elementId", c.memberSheet);
router.post("/exports", validate(exportReportSchema), c.exportPdf);
router.get("/exports/:exportId/download", c.exportDownload);

// Logo del proyecto para portadas (subida directa a S3 y confirmación).
router.get("/logo", c.getLogo);
router.post("/logo/upload-url", validate(logoUploadSchema), c.logoUploadUrl);
router.put("/logo", validate(setLogoSchema), c.setLogo);
router.delete("/logo", c.removeLogo);

module.exports = router;
