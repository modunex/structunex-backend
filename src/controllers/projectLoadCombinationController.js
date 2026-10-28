const { asyncHandler } = require("../middleware/errorHandler");
const { prisma } = require("../config/db");
const { generateDefaultCombos } = require("../services/loadComboService");

// Combos por defecto de UN proyecto. Lee los load patterns y los casos Response
// Spectrum del proyecto (fuente autoritativa) y genera las combinaciones con el
// término sísmico como marcador name-free. `req.projectId` lo pone loadProject.
module.exports = {
  defaults: asyncHandler(async (req, res) => {
    const projectId = req.projectId;
    const sets = Array.isArray(req.body && req.body.sets) ? req.body.sets : [];

    const config = await prisma.modelConfiguration.findUnique({
      where: { projectId },
      select: { loadPatterns: true, responseSpectrumCases: true, loadCombinations: true },
    });

    const result = generateDefaultCombos({
      loadPatterns: (config && config.loadPatterns) || [],
      responseSpectrumCases: (config && config.responseSpectrumCases) || [],
      sets,
      // No colisionar con los combos que el proyecto ya tiene.
      reservedNames: ((config && config.loadCombinations) || []).map((c) => c.name),
    });

    res.json(result);
  }),
};
