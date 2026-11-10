const { AppError, asyncHandler } = require("../middleware/errorHandler");
const { listConnectionsQuery } = require("../schemas/connectionSchema");
const connectionService = require("../services/connectionService");
const billing = require("../services/billingService");
const { CONNECTION_FEATURE } = require("../lib/billingPlans");
const { prisma } = require("../config/db");
const { isUuid } = require("../lib/ids");

// Cada tipología es una feature del plan (lib/billingPlans). Una tipología sin feature
// declarada no se cobra.
const assertTypology = (userId, typology) => billing.assertFeature(userId, CONNECTION_FEATURE[typology]);

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
  await assertTypology(req.userId, req.body.typology);
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
  if (isUuid(req.params.connectionId)) {
    const c = await prisma.connection.findFirst({
      where: { id: req.params.connectionId, projectId: req.projectId },
      select: { typology: true },
    });
    if (c) await assertTypology(req.userId, c.typology);
  }
  res.json(await connectionService.check(req.project, req.params.connectionId));
});

const latestRun = asyncHandler(async (req, res) => {
  res.json(await connectionService.latestRun(req.project, req.params.connectionId));
});

// Geometría de la conexión (operaciones → layout) con lo guardado o con lo que se está
// editando sin guardar. 409 si el análisis no es del modelo actual (como la inspección).
const layout = asyncHandler(async (req, res) => {
  res.json(await connectionService.layout(req.project, req.params.connectionId, req.body || {}));
});

// Fase 3 (CBFEM): malla de la conexión y análisis por elementos finitos en segundo plano.
const mesh = asyncHandler(async (req, res) => {
  res.json(await connectionService.mesh(req.project, req.params.connectionId, req.body || {}));
});

const femStart = asyncHandler(async (req, res) => {
  res.status(202).json(await connectionService.femStart(req.project, req.params.connectionId, req.body || {}));
});

const femLatest = asyncHandler(async (req, res) => {
  const [run, criteria] = await Promise.all([
    connectionService.femLatest(req.project, req.params.connectionId),
    connectionService.femCriteria(req.project),
  ]);
  res.json({ run, criteria });
});

const femCancel = asyncHandler(async (req, res) => {
  res.json(await connectionService.femCancel(req.project, req.params.connectionId));
});

const femFiles = asyncHandler(async (req, res) => {
  const raw = req.query.combinations;
  const combinations = Array.isArray(raw) ? raw : raw ? [raw] : [];
  res.json(await connectionService.femFiles(req.project, req.params.connectionId, req.params.runId, { combinations }));
});

module.exports = {
  inspect, list, getOne, create, update, remove, check, latestRun, layout,
  mesh, femStart, femLatest, femCancel, femFiles,
};
