const { AppError, asyncHandler } = require("../middleware/errorHandler");
const { listConnectionsQuery } = require("../schemas/connectionSchema");
const connectionService = require("../services/connectionService");

// req.project / req.projectId los pone loadProject (propiedad ya comprobada).
//
// Inspección de un nudo (F1): síncrona, porque lee las fuerzas de extremo de un solo
// nudo. 409 si no hay análisis o si los resultados no son del modelo actual.
const inspect = asyncHandler(async (req, res) => {
  res.json(await connectionService.inspect(req.project, req.body.nodeId));
});

const list = asyncHandler(async (req, res) => {
  const query = listConnectionsQuery.safeParse(req.query);
  if (!query.success) throw new AppError(400, "Parámetros de consulta no válidos.");
  res.json(await connectionService.list(req.project, query.data));
});

const getOne = asyncHandler(async (req, res) => {
  res.json(await connectionService.getOne(req.project, req.params.connectionId));
});

// 201 con la conexión creada; 422 con los motivos si la tipología no aplica; 409 si ya
// hay una conexión en ese extremo de barra, o si el análisis no es del modelo actual.
const create = asyncHandler(async (req, res) => {
  res.status(201).json(await connectionService.create(req.project, req.body));
});

const update = asyncHandler(async (req, res) => {
  res.json(await connectionService.update(req.project, req.params.connectionId, req.body));
});

const remove = asyncHandler(async (req, res) => {
  res.json(await connectionService.remove(req.project, req.params.connectionId));
});

// F3: comprueba con el análisis vigente y guarda la ejecución. 409 si la conexión está
// huérfana o el análisis caducó; un dato que falta sale como NO VERIFICABLE (200).
const check = asyncHandler(async (req, res) => {
  res.json(await connectionService.check(req.project, req.params.connectionId));
});

const latestRun = asyncHandler(async (req, res) => {
  res.json(await connectionService.latestRun(req.project, req.params.connectionId));
});

module.exports = { inspect, list, getOne, create, update, remove, check, latestRun };
