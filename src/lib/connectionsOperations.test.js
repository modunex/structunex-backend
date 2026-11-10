// Modelado por operaciones: piezas puras del backend (sin base de datos).
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildCheckRequest,
  buildLayoutRequest,
  checkInputsHash,
  connectionMaterialIds,
  runInputs,
} = require("./connections");
const {
  layoutPreviewSchema,
  shearTabParamsV1,
  updateConnectionSchema,
} = require("../schemas/connectionSchema");

const inspectRequest = {
  source: { projectId: "p", runId: "r", cases: [] },
  nodeId: "N1",
  nodes: [{ id: "N1", x: 0, y: 0, z: 3 }],
  elements: [{ id: "B1", nodeA: "N1", nodeB: "N2" }],
  sections: [{ id: "S" }],
  materials: [{ id: "M" }],
  supports: [],
  areas: [],
  combinations: [{ name: "1.4D", factors: [] }],
  loads: [{ nodeId: "N1" }],
};
const connection = {
  id: "c1",
  typology: "shear_tab",
  code: "AISC360-22",
  paramsVersion: 1,
  params: { plate: { thickness: 0.0127 } },
  supportedElementId: "B1",
  operations: null,
};
const ops = [
  { op: "cut", id: "cut", distance: { ref: "supportFace", offset: 0.012 } },
  { op: "plate", id: "P1", plane: "uz", origin: [0, 0, 0], rect: { x: [0, 0.1], y: [-0.2, 0] }, thickness: 0.01, materialId: "mat-1" },
];

test("la petición de layout lleva solo la geometría del modelo, sin resultados", () => {
  const req = buildLayoutRequest({ inspectRequest, connection });
  assert.equal(req.source, undefined);
  assert.equal(req.combinations, undefined);
  assert.equal(req.loads, undefined);
  assert.deepEqual(req.nodes, inspectRequest.nodes);
  assert.equal(req.connection.operations, null);
  assert.deepEqual(req.connection.params, connection.params);
});

test("la vista previa usa lo que se edita sin guardar", () => {
  const params = { plate: { thickness: 0.0095 } };
  const req = buildLayoutRequest({ inspectRequest, connection, params, operations: ops });
  assert.deepEqual(req.connection.params, params);
  assert.deepEqual(req.connection.operations, ops);
  // null explícito = volver a la plantilla, aunque lo guardado sea una lista.
  const back = buildLayoutRequest({ inspectRequest, connection: { ...connection, operations: ops }, operations: null });
  assert.equal(back.connection.operations, null);
  // sin campo = lo guardado
  const saved = buildLayoutRequest({ inspectRequest, connection: { ...connection, operations: ops } });
  assert.deepEqual(saved.connection.operations, ops);
});

test("las operaciones viajan a la comprobación y cambian su huella", () => {
  const a = buildCheckRequest({ inspectRequest, connection, plateMaterial: null });
  const b = buildCheckRequest({ inspectRequest, connection: { ...connection, operations: ops }, plateMaterial: null });
  assert.equal(a.connection.operations, null);
  assert.deepEqual(b.connection.operations, ops);
  assert.notEqual(checkInputsHash(a), checkInputsHash(b));
});

test("la ejecución guarda la huella de la geometría comprobada", () => {
  const req = buildCheckRequest({ inspectRequest, connection, plateMaterial: null });
  assert.equal(runInputs(req, { layout: { hash: "abc" } }).layoutHash, "abc");
  assert.equal(runInputs(req, {}).layoutHash, null);
});

test("los materiales citados: placa, refuerzos y placas de las operaciones, sin repetir", () => {
  const ids = connectionMaterialIds(
    { plate: { materialId: "a" }, doublerPlate: { materialId: "b" } },
    [{ op: "plate", materialId: "a" }, { op: "plate", materialId: "c" }, { op: "weld" }]
  );
  assert.deepEqual(ids.sort(), ["a", "b", "c"]);
  assert.deepEqual(connectionMaterialIds(null, null), []);
});

test("el PATCH acepta operaciones de los tipos que el motor ejecuta, o null", () => {
  assert.equal(updateConnectionSchema.safeParse({ operations: ops }).success, true);
  assert.equal(updateConnectionSchema.safeParse({ operations: null }).success, true);
  // Un tipo que el motor aún no tiene se rechaza aquí, no se guarda.
  assert.equal(updateConnectionSchema.safeParse({ operations: [{ op: "cope", id: "A1" }] }).success, false);
  assert.equal(updateConnectionSchema.safeParse({ operations: [{ op: "angle", id: "L1" }] }).success, true);
  assert.equal(updateConnectionSchema.safeParse({ operations: [{ op: "plate", id: "a b" }] }).success, false);
  assert.equal(updateConnectionSchema.safeParse({ operations: new Array(201).fill(ops[0]) }).success, false);
});

test("la vista previa es estricta: un campo desconocido se rechaza", () => {
  assert.equal(layoutPreviewSchema.safeParse({}).success, true);
  assert.equal(layoutPreviewSchema.safeParse({ params: {}, operations: null }).success, true);
  assert.equal(layoutPreviewSchema.safeParse({ geometry: {} }).success, false);
});

test("el shear tab admite el lado de la placa, y solo +n o -n", () => {
  assert.equal(shearTabParamsV1.safeParse({ plate: { side: "-n" } }).success, true);
  assert.equal(shearTabParamsV1.safeParse({ plate: { side: null } }).success, true);
  assert.equal(shearTabParamsV1.safeParse({ plate: { side: "left" } }).success, false);
});
