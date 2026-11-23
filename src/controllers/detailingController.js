const { asyncHandler } = require("../middleware/errorHandler");
const detailingService = require("../services/detailingService");

// req.project lo pone loadProject (heredado de projectRoutes).

// Rebar Studio D2: GET /projects/:id/detailing/line?elementId=… → la línea de viga.
const line = asyncHandler(async (req, res) => {
  res.json(await detailingService.line(req.project, req.query.elementId));
});

// D3: vigas detalladas.
const listMembers = asyncHandler(async (req, res) => {
  res.json(await detailingService.listMembers(req.projectId));
});
const createMember = asyncHandler(async (req, res) => {
  res.status(201).json(await detailingService.createMember(req.project, req.body));
});
const getMember = asyncHandler(async (req, res) => {
  res.json(await detailingService.getMember(req.project, req.params.memberId));
});
const updateMember = asyncHandler(async (req, res) => {
  res.json(await detailingService.updateMember(req.project, req.params.memberId, req.body));
});
const deleteMember = asyncHandler(async (req, res) => {
  res.json(await detailingService.deleteMember(req.projectId, req.params.memberId));
});

module.exports = { line, listMembers, createMember, getMember, updateMember, deleteMember };
