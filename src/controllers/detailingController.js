const { asyncHandler } = require("../middleware/errorHandler");
const detailingService = require("../services/detailingService");

// req.project lo pone loadProject (heredado de projectRoutes).

// Rebar Studio D2: GET /projects/:id/detailing/line?elementId=… → la línea de viga.
const line = asyncHandler(async (req, res) => {
  res.json(await detailingService.line(req.project, req.query.elementId));
});

module.exports = { line };
