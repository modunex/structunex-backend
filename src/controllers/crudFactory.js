const { asyncHandler } = require("../middleware/errorHandler");

// Wraps a child service (from services/crudFactory) into Express handlers.
// req.project is set by loadProject; req.params.id is the child's `_id` (its pk).
function makeChildController(service) {
  return {
    list: asyncHandler(async (req, res) => {
      res.json(await service.list(req.project));
    }),

    create: asyncHandler(async (req, res) => {
      res.status(201).json(await service.create(req.project, req.body));
    }),

    getOne: asyncHandler(async (req, res) => {
      res.json(await service.getOne(req.project, req.params.id));
    }),

    update: asyncHandler(async (req, res) => {
      res.json(await service.update(req.project, req.params.id, req.body));
    }),

    remove: asyncHandler(async (req, res) => {
      res.json(await service.remove(req.project, req.params.id));
    }),
  };
}

module.exports = { makeChildController };
