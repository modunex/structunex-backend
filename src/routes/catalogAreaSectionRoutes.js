const { Router } = require("express");
const c = require("../controllers/catalogAreaSectionController");
const { requireAuth } = require("../middleware/auth");
const { validate } = require("../middleware/validate");
const {
  createCatalogAreaSection,
  createDeckAreaSection,
  updateCatalogAreaSection,
} = require("../schemas/catalogAreaSectionSchema");

// Un deck trae su geometría y el servicio deriva el shell; el resto, como siempre.
const validateCreate = (req, res, next) =>
  validate(req.body && req.body.kind === "deck" ? createDeckAreaSection : createCatalogAreaSection)(req, res, next);

const router = Router();

// User-owned catalog: auth required, but NOT project-scoped (no loadProject).
router.use(requireAuth);

router.get("/", c.list);
router.post("/", validateCreate, c.create);
router.get("/:id", c.getOne);
router.patch("/:id", validate(updateCatalogAreaSection), c.update);
router.delete("/:id", c.remove);

module.exports = router;
