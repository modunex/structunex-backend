const { Router } = require("express");
const c = require("../controllers/projectImageController");
const { validate } = require("../middleware/validate");
const {
  createImageSchema,
  imageUploadSchema,
  imageVersionSchema,
  renameImageSchema,
} = require("../schemas/projectImageSchema");

const router = Router({ mergeParams: true });

// requireAuth + loadProject vienen heredados de projectRoutes.
router.get("/", c.list);
router.post("/", validate(createImageSchema), c.create);
router.post("/upload-url", validate(imageUploadSchema), c.uploadUrl);
router.get("/versions/:versionId/url", c.versionUrl);
router.post("/:imageId/versions", validate(imageVersionSchema), c.addVersion);
router.patch("/:imageId", validate(renameImageSchema), c.rename);
router.get("/:imageId/usage", c.usage);
router.delete("/:imageId", c.remove);

module.exports = router;
