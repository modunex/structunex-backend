const { prisma } = require("../config/db");
const { isUuid } = require("../lib/ids");
const { AppError, asyncHandler } = require("./errorHandler");

// Loads the project named in the route and verifies it belongs to the
// authenticated Clerk user (req.userId, set by requireAuth). Attaches it so
// downstream handlers/services never re-check ownership. A missing match — or a
// malformed id — is a 404 (not 403) so we never reveal that a project exists.
//
// req.project is the Prisma row (use project.id, not project._id); responses go
// through toApi() so the client still sees `_id`.
const loadProject = asyncHandler(async (req, _res, next) => {
  const { projectId } = req.params;
  if (!isUuid(projectId)) {
    return next(new AppError(404, "Project not found"));
  }
  const project = await prisma.project.findFirst({
    where: { id: projectId, ownerId: req.userId },
  });
  if (!project) return next(new AppError(404, "Project not found"));
  req.project = project;
  req.projectId = project.id;
  next();
});

module.exports = { loadProject };
