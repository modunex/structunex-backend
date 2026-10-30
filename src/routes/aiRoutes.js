const { Router } = require("express");
const c = require("../controllers/aiController");

// Asistente IA de un proyecto. Montado bajo /projects/:projectId/ai, así que hereda
// requireAuth y loadProject (req.project / req.projectId).
const router = Router({ mergeParams: true });

router.get("/options", c.options);
router.get("/conversations", c.list);
router.post("/conversations", c.create);
router.get("/conversations/:conversationId", c.getOne);
router.delete("/conversations/:conversationId", c.remove);
router.post("/conversations/:conversationId/attachments", c.presign);
router.get("/conversations/:conversationId/attachments/:attachmentId/url", c.attachmentUrl);
router.post("/conversations/:conversationId/messages", c.sendMessage);
router.patch(
  "/conversations/:conversationId/messages/:messageId/changeset",
  c.setChangesetStatus
);

module.exports = router;
