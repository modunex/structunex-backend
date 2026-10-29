const { Router } = require("express");
const c = require("../controllers/reportDocumentController");
const { validate } = require("../middleware/validate");
const {
  createReportSchema,
  updateReportSchema,
  createRevisionSchema,
  exportReportDocumentSchema,
} = require("../schemas/reportingSchema");

const router = Router({ mergeParams: true });

// requireAuth + loadProject vienen heredados de projectRoutes.
router.get("/", c.list);
router.post("/", validate(createReportSchema), c.create);
router.get("/:reportId", c.getOne);
router.patch("/:reportId", validate(updateReportSchema), c.update);
router.delete("/:reportId", c.remove);
router.get("/:reportId/revisions", c.listRevisions);
router.post("/:reportId/revisions", validate(createRevisionSchema), c.createRevision);
router.get("/:reportId/revisions/:revisionId", c.getRevision);
router.get("/:reportId/verify", c.verify);
router.post("/:reportId/export", validate(exportReportDocumentSchema), c.exportDocument);

module.exports = router;
