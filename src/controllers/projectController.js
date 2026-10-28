const { asyncHandler } = require("../middleware/errorHandler");
const projectService = require("../services/projectService");
const { toApi } = require("../lib/ids");

// req.userId is set by requireAuth; req.project by loadProject.

const create = asyncHandler(async (req, res) => {
  const project = await projectService.createProject({
    ...req.body,
    ownerId: req.userId,
  });
  res.status(201).json(project);
});

const list = asyncHandler(async (req, res) => {
  res.json(await projectService.listProjects(req.userId));
});

const getOne = asyncHandler(async (req, res) => {
  res.json(toApi(req.project, "project")); // already loaded + authorized by loadProject
});

const update = asyncHandler(async (req, res) => {
  res.json(await projectService.updateProject(req.project, req.body));
});

const remove = asyncHandler(async (req, res) => {
  res.json(await projectService.deleteProject(req.projectId));
});

module.exports = { create, list, getOne, update, remove };
