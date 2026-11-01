const { Router } = require("express");
const c = require("../controllers/designController");

const router = Router({ mergeParams: true });

// requireAuth + loadProject vienen heredados de projectRoutes, así que la propiedad del
// proyecto ya está comprobada antes de llegar aquí — incluido antes de firmar una URL.
router.get("/", c.get); // estado + progreso + metadatos de la última comprobación
router.post("/", c.run); // lanza la comprobación (202)
router.delete("/", c.cancel); // cuelga una comprobación en curso
router.put("/preferences", c.savePreferences); // Design ▸ Preferences (sin correr)

router.get("/runs", c.listRuns); // historial de comprobaciones
router.get("/runs/:runId/urls", c.runUrls); // URL prefirmadas de sus tablas

module.exports = router;
