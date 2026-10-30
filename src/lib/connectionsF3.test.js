// F3: piezas puras de la comprobación de conexiones (sin base de datos).
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildCheckRequest,
  checkInputsHash,
  runInputs,
  runSummary,
} = require("./connections");
const { shearTabParamsV1 } = require("../schemas/connectionSchema");

const inspectRequest = {
  source: { projectId: "p", runId: "r", cases: [{ name: "D", key: "d", kind: "pattern" }] },
  nodeId: "N1",
  nodes: [],
  elements: [],
  sections: [],
  materials: [],
  combinations: [{ name: "1.4D", factors: [{ factor: 1.4, pattern: "D", seismic: false }] }],
};
const connection = {
  id: "c1",
  typology: "shear_tab",
  code: "AISC360-22",
  paramsVersion: 1,
  params: { plate: { thickness: 0.0127 } },
  supportedElementId: "B1",
  name: "ST",
  status: "draft",
};

test("la petición de comprobación lleva la conexión, el material y las combinaciones", () => {
  const req = buildCheckRequest({
    inspectRequest,
    connection,
    plateMaterial: { id: "m", name: "A36", Fy: 248000, Fu: 400000, E: 2e8, extra: 1 },
    comboNames: ["1.4D"],
  });
  assert.equal(req.nodeId, "N1");
  assert.deepEqual(req.connection, {
    id: "c1",
    typology: "shear_tab",
    code: "AISC360-22",
    paramsVersion: 1,
    params: { plate: { thickness: 0.0127 } },
    supportedElementId: "B1",
  });
  assert.deepEqual(req.plateMaterial, { id: "m", name: "A36", Fy: 248000, Fu: 400000, E: 2e8 });
  assert.deepEqual(req.comboNames, ["1.4D"]);

  // Sin material elegido, viaja null (el motor dirá qué falta); no se inventa.
  const bare = buildCheckRequest({ inspectRequest, connection, plateMaterial: null });
  assert.equal(bare.plateMaterial, null);
  assert.deepEqual(bare.comboNames, []);
});

test("la huella cambia con cualquier entrada y no con el orden de las claves", () => {
  const a = buildCheckRequest({ inspectRequest, connection, plateMaterial: null });
  const b = JSON.parse(JSON.stringify(a));
  assert.equal(checkInputsHash(a), checkInputsHash(b));
  const reordered = { connection: a.connection, ...a };
  assert.equal(checkInputsHash(a), checkInputsHash(reordered));
  const changed = buildCheckRequest({
    inspectRequest,
    connection: { ...connection, params: { plate: { thickness: 0.0095 } } },
    plateMaterial: null,
  });
  assert.notEqual(checkInputsHash(a), checkInputsHash(changed));
});

test("las entradas guardadas identifican el cálculo sin copiar el modelo", () => {
  const req = buildCheckRequest({ inspectRequest, connection, plateMaterial: null });
  const inputs = runInputs(req, { demands: [{ label: "1.4D", V: 84 }], context: { beam: {} } });
  assert.deepEqual(Object.keys(inputs).sort(), [
    "combinations", "comboNames", "connection", "context", "demands", "members", "nodeId",
    "plateMaterial", "source",
  ]);
  assert.equal(inputs.demands[0].V, 84);
  assert.equal(inputs.nodes, undefined);
});

test("resumen: vigente solo si se hizo con el análisis actual y la conexión no cambió", () => {
  const run = {
    id: "r1", createdAt: "x", status: "done", engineVersion: "connections-0.3.0",
    analysisRunId: "A1", results: { status: "pass", governing: { id: "bolts.shear", ratio: 0.8 } },
  };
  const s = runSummary(run, { latestSolvedRunId: "A1", connectionStatus: "checked" });
  assert.equal(s.result, "pass");
  assert.equal(s.current, true);
  assert.equal(s.governing.id, "bolts.shear");
  assert.equal(runSummary(run, { latestSolvedRunId: "A2", connectionStatus: "checked" }).current, false);
  assert.equal(runSummary(run, { latestSolvedRunId: "A1", connectionStatus: "draft" }).current, false);
  const failed = runSummary({ ...run, status: "error", error: "boom" }, {
    latestSolvedRunId: "A1", connectionStatus: "checked",
  });
  assert.equal(failed.result, null);
  assert.equal(failed.current, false);
  assert.equal(runSummary(null), null);
});

test("parámetros v1: bearingDeformation admite las dos opciones y null", () => {
  assert.ok(shearTabParamsV1.safeParse({ bolts: { bearingDeformation: "notConsidered" } }).success);
  assert.ok(shearTabParamsV1.safeParse({ bolts: { bearingDeformation: null } }).success);
  assert.ok(!shearTabParamsV1.safeParse({ bolts: { bearingDeformation: "maybe" } }).success);
});

test("parámetros v1: topDistance opcional, positiva", () => {
  assert.ok(shearTabParamsV1.safeParse({ bolts: { topDistance: 0.076 } }).success);
  assert.ok(shearTabParamsV1.safeParse({ bolts: { topDistance: null } }).success);
  assert.ok(!shearTabParamsV1.safeParse({ bolts: { topDistance: -0.01 } }).success);
});
