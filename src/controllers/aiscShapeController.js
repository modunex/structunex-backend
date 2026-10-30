const { asyncHandler, AppError } = require("../middleware/errorHandler");
const { searchShapes, getShape, families, catalogs } = require("../lib/aiscShapes");

// Steel shapes system catalog: AISC + EN 10365 (read-only, in memory). validate.js only checks body, so
// query params are read directly here.
module.exports = {
  search: asyncHandler(async (req, res) => {
    const { q, type, catalog, page, limit } = req.query;
    res.json(searchShapes({ q, type, catalog, page, limit }));
  }),

  families: asyncHandler(async (_req, res) => {
    res.json(families());
  }),

  catalogs: asyncHandler(async (_req, res) => {
    res.json(catalogs());
  }),

  getOne: asyncHandler(async (req, res) => {
    const shape = getShape(req.params.label);
    if (!shape) throw new AppError(404, "Shape not found");
    res.json(shape);
  }),
};
