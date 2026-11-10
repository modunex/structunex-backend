const { asyncHandler } = require("../middleware/errorHandler");
const projectService = require("../services/projectService");
const exampleService = require("../services/exampleService");
const { listExamples } = require("../lib/examples");
const { toApi } = require("../lib/ids");
const billing = require("../services/billingService");

// req.userId is set by requireAuth; req.project by loadProject.

const create = asyncHandler(async (req, res) => {
  await billing.assertCanCreateProject(req.userId);
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

// Modelos de ejemplo (onboarding).
const examples = asyncHandler(async (_req, res) => {
  res.json(listExamples());
});

const createFromExample = asyncHandler(async (req, res) => {
  await billing.assertCanCreateProject(req.userId);
  const project = await exampleService.createFromExample(req.userId, req.params.exampleId, {
    name: typeof req.body?.name === "string" ? req.body.name : undefined,
  });
  res.status(201).json(project);
});

const getExample = asyncHandler(async (req, res) => {
  res.json(await exampleService.getProjectExample(req.project));
});

module.exports = { create, list, getOne, update, remove, examples, createFromExample, getExample };
