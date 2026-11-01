const { asyncHandler, AppError } = require("../middleware/errorHandler");
const { CoveninComboError } = require("../lib/coveninCombos");
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
      select: {
        loadPatterns: true,
        responseSpectrumCases: true,
        spectrumFunctions: true,
        loadCombinations: true,
      },
    });

    let result;
    try {
      result = generateDefaultCombos({
      loadPatterns: (config && config.loadPatterns) || [],
      responseSpectrumCases: (config && config.responseSpectrumCases) || [],
      spectrumFunctions: (config && config.spectrumFunctions) || [],
      sets,
      covenin: (req.body && req.body.covenin) || null,
      // No colisionar con los combos que el proyecto ya tiene.
      reservedNames: ((config && config.loadCombinations) || []).map((c) => c.name),
      });
    } catch (err) {
      // Datos que faltan o no encajan con la 1756 (casos, función, γ): error del usuario,
      // con la clave que el front traduce. Nada se genera a medias.
      if (err instanceof CoveninComboError) {
        throw new AppError(400, err.code, { detail: err.message });
      }
      throw err;
    }

    res.json(result);
  }),
};
