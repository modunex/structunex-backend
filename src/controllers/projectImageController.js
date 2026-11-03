const { asyncHandler } = require("../middleware/errorHandler");
const svc = require("../services/projectImageService");

// req.project lo pone loadProject (propiedad ya comprobada).
const list = asyncHandler(async (req, res) => res.json(await svc.list(req.project)));
const uploadUrl = asyncHandler(async (req, res) => res.json(await svc.uploadUrl(req.project, req.body)));
const create = asyncHandler(async (req, res) => res.status(201).json(await svc.create(req.project, req.userId, req.body)));
const addVersion = asyncHandler(async (req, res) =>
  res.status(201).json(await svc.addVersion(req.project, req.params.imageId, req.body))
);
const rename = asyncHandler(async (req, res) => res.json(await svc.rename(req.project, req.params.imageId, req.body)));
const usage = asyncHandler(async (req, res) => res.json(await svc.usage(req.project, req.params.imageId)));
const remove = asyncHandler(async (req, res) => res.json(await svc.remove(req.project, req.params.imageId)));
const versionUrl = asyncHandler(async (req, res) => res.json(await svc.versionUrl(req.project, req.params.versionId)));

module.exports = { list, uploadUrl, create, addVersion, rename, usage, remove, versionUrl };
