const { asyncHandler } = require("../middleware/errorHandler");
const svc = require("../services/reportDocumentService");

// req.project lo pone loadProject (propiedad ya comprobada).
const list = asyncHandler(async (req, res) => res.json(await svc.list(req.project)));
const create = asyncHandler(async (req, res) => res.status(201).json(await svc.create(req.project, req.body)));
const getOne = asyncHandler(async (req, res) => res.json(await svc.getOne(req.project, req.params.reportId)));
// 409 { details.error: "report.versionConflict" } si otra ventana guardó antes.
const update = asyncHandler(async (req, res) => res.json(await svc.update(req.project, req.params.reportId, req.body)));
const remove = asyncHandler(async (req, res) => res.json(await svc.remove(req.project, req.params.reportId)));
const listRevisions = asyncHandler(async (req, res) => res.json(await svc.listRevisions(req.project, req.params.reportId)));
const createRevision = asyncHandler(async (req, res) =>
  res.status(201).json(await svc.createRevision(req.project, req.params.reportId, req.body))
);
const getRevision = asyncHandler(async (req, res) =>
  res.json(await svc.getRevision(req.project, req.params.reportId, req.params.revisionId))
);
const verify = asyncHandler(async (req, res) => res.json(await svc.verify(req.project, req.params.reportId)));
// 201 con la exportación; 409 { details.problems } si algún bloque técnico no coincide.
const exportDocument = asyncHandler(async (req, res) =>
  res.status(201).json(await svc.exportDocument(req.project, req.params.reportId, req.body))
);

module.exports = { list, create, getOne, update, remove, listRevisions, createRevision, getRevision, verify, exportDocument };
