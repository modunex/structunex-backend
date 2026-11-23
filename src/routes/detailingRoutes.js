const { Router } = require("express");
const c = require("../controllers/detailingController");
const { validate } = require("../middleware/validate");
const { createMemberBody, updateMemberBody } = require("../schemas/detailingSchema");

const router = Router({ mergeParams: true });

// requireAuth + loadProject vienen heredados de projectRoutes.
router.get("/line", c.line); // Rebar Studio D2: línea de viga y envolventes del diseño

// D3: vigas detalladas (propuesta de armado guardada con su huella).
router.get("/members", c.listMembers);
router.post("/members", validate(createMemberBody), c.createMember); // { elementId, params? }
router.get("/members/:memberId", c.getMember); // + propuesta actual y `stale`
router.put("/members/:memberId", validate(updateMemberBody), c.updateMember); // { params } → nueva propuesta
router.delete("/members/:memberId", c.deleteMember);

module.exports = router;
