const { asyncHandler } = require("../middleware/errorHandler");
const connectionService = require("../services/connectionService");

// req.project / req.projectId los pone loadProject (propiedad ya comprobada).
//
// Inspección de un nudo (F1): síncrona, porque lee las fuerzas de extremo de un solo
// nudo. 409 si no hay análisis o si los resultados no son del modelo actual.
const inspect = asyncHandler(async (req, res) => {
  res.json(await connectionService.inspect(req.project, req.body.nodeId));
});

module.exports = { inspect };
