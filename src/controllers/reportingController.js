const { asyncHandler } = require("../middleware/errorHandler");
const reportingService = require("../services/reportingService");

// req.project lo pone loadProject (propiedad ya comprobada).

const archive = asyncHandler(async (req, res) => {
  res.json(await reportingService.archive(req.project));
});

const connectionSheet = asyncHandler(async (req, res) => {
  res.json(await reportingService.connectionSheet(req.project, req.params.runId));
});

const analysisSheet = asyncHandler(async (req, res) => {
  res.json(await reportingService.analysisSheet(req.project));
});

const designRunMembers = asyncHandler(async (req, res) => {
  res.json(await reportingService.designRunMembers(req.project, req.params.designRunId));
});

const memberSheet = asyncHandler(async (req, res) => {
  res.json(await reportingService.memberSheet(req.project, req.params.designRunId, req.params.elementId));
});

// 201 con la exportación; 409 si no hay nada vigente que exportar; 502/503 si el
// generador de PDF no responde (la exportación fallida queda registrada).
const exportPdf = asyncHandler(async (req, res) => {
  res.status(201).json(await reportingService.exportPdf(req.project, req.body));
});

const exportDownload = asyncHandler(async (req, res) => {
  res.json(await reportingService.exportDownload(req.project, req.params.exportId));
});

const logoUploadUrl = asyncHandler(async (req, res) => {
  res.json(await reportingService.logoUploadUrl(req.project, req.body));
});

const setLogo = asyncHandler(async (req, res) => {
  res.json(await reportingService.setLogo(req.project, req.body));
});

const getLogo = asyncHandler(async (req, res) => {
  res.json(await reportingService.getLogo(req.project));
});

const removeLogo = asyncHandler(async (req, res) => {
  res.json(await reportingService.removeLogo(req.project));
});

module.exports = { archive, analysisSheet, connectionSheet, designRunMembers, memberSheet, exportPdf, exportDownload, logoUploadUrl, setLogo, getLogo, removeLogo };
