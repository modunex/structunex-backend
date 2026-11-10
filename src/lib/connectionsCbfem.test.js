// Fase 3 (CBFEM): la petición al calc-service, la huella de las entradas y el resumen
// de una ejecución.
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildCbfemRequest,
  cbfemInputsHash,
  cbfemRunInputs,
  femRunSummary,
} = require("./connections");

const checkRequest = {
  source: { projectId: "p", runId: "r", cases: [] },
  nodeId: "J",
  materials: [{ id: "M1", name: "A992", E: 2e8, Fy: 345000, Fu: 450000 }],
  connection: { id: "c1", typology: "shear_tab", params: {}, operations: null, supportedElementId: "G" },
  plateMaterial: { id: "A36", name: "A36", Fy: 248000, Fu: 400000, E: 2e8 },
  doublerMaterial: null,
  comboNames: [],
  combinations: [{ name: "D", factors: [] }],
};

test("la petición CBFEM añade los materiales de catálogo de las placas, sin repetir", () => {
  const req = buildCbfemRequest({
    checkRequest,
    catalogMaterials: [
      { id: "M1", name: "dup", E: 1, Fy: 1, Fu: 1 },
      { id: "A572", name: "A572 Gr 50", E: 2e8, Fy: 345000, Fu: 450000, ownerId: "x" },
    ],
    analysis: "linear",
  });
  assert.deepEqual(req.materials.map((m) => m.id), ["M1", "A572"]);
  assert.equal(req.materials[0].name, "A992"); // el del modelo manda
  assert.deepEqual(Object.keys(req.materials[1]).sort(), ["E", "Fu", "Fy", "id", "name"]);
  assert.equal(req.analysis, "linear");
  assert.equal(req.forcesAt, "node");
  assert.equal(req.storage, undefined);
});

test("posición de las fuerzas y criterio del proyecto viajan en la petición y en la huella", () => {
  const a = buildCbfemRequest({ checkRequest, forcesAt: "bolts", criteria: { plasticStrainLimit: 0.05 } });
  assert.equal(a.forcesAt, "bolts");
  assert.deepEqual(a.criteria, { plasticStrainLimit: 0.05 });
  const b = buildCbfemRequest({ checkRequest, forcesAt: "bolts", criteria: { plasticStrainLimit: 0.03 } });
  assert.notEqual(cbfemInputsHash(a), cbfemInputsHash(b));
  assert.deepEqual(cbfemRunInputs(b).criteria, { plasticStrainLimit: 0.03 });
  assert.throws(() => buildCbfemRequest({ checkRequest, forcesAt: "weld" }));
  const c = buildCbfemRequest({ checkRequest, forcesAt: "bolts", stiffness: true, criteria: { plasticStrainLimit: 0.05 } });
  assert.equal(c.stiffness, true);
  assert.notEqual(cbfemInputsHash(a), cbfemInputsHash(c));
});

test("diseño por capacidad: viaja sin vacíos, entra en la huella y en el resumen", () => {
  const a = buildCbfemRequest({ checkRequest, analysis: "nonlinear" });
  assert.equal(a.capacity, undefined);
  const b = buildCbfemRequest({ checkRequest, capacity: { Ry: 1.1, Sh: 0.15, Lh: null, gravityCombination: "" } });
  assert.deepEqual(b.capacity, { Ry: 1.1, Sh: 0.15 });
  assert.notEqual(cbfemInputsHash(a), cbfemInputsHash(b));
  assert.deepEqual(cbfemRunInputs(b).capacity, { Ry: 1.1, Sh: 0.15 });
  assert.equal(cbfemRunInputs(a).capacity, null);
  // plantilla end plate: el objeto vacío pide MC con los datos de su procedimiento
  assert.deepEqual(buildCbfemRequest({ checkRequest, capacity: {} }).capacity, {});
  const s = femRunSummary({ id: "r", status: "done", createdAt: new Date(), results: { capacity: { Mpr: 700 } } });
  assert.deepEqual(s.capacity, { Mpr: 700 });
});

test("rendimiento: gobernantes y sin NLGEOM por defecto; ambas entran en la huella", () => {
  const a = buildCbfemRequest({ checkRequest });
  assert.equal(a.combinationsMode, "governing");
  assert.equal(a.geometricNonlinear, false);
  const b = buildCbfemRequest({ checkRequest, combinationsMode: "all", geometricNonlinear: true });
  assert.equal(b.combinationsMode, "all");
  assert.equal(b.geometricNonlinear, true);
  assert.notEqual(cbfemInputsHash(a), cbfemInputsHash(b));
  assert.equal(cbfemRunInputs(b).geometricNonlinear, true);
});

test("análisis desconocido: error", () => {
  assert.throws(() => buildCbfemRequest({ checkRequest, analysis: "dynamic" }));
});

test("la huella no depende del destino de los campos, sí del tipo de análisis", () => {
  const a = buildCbfemRequest({ checkRequest, analysis: "nonlinear" });
  const b = { ...a, storage: { projectId: "p", runId: "x", bucket: "b" } };
  assert.equal(cbfemInputsHash(a), cbfemInputsHash(b));
  const c = buildCbfemRequest({ checkRequest, analysis: "linear" });
  assert.notEqual(cbfemInputsHash(a), cbfemInputsHash(c));
  assert.equal(cbfemRunInputs(b).storage, undefined);
  assert.equal(cbfemRunInputs(b).analysis, "nonlinear");
});

test("resumen: avance mientras corre, casos y supuestos al terminar, desactualizado si cambió algo", () => {
  const running = femRunSummary({
    id: "r1", status: "running", analysisType: "nonlinear", progress: { step: "solving", current: 1, total: 3 },
    createdAt: new Date("2026-11-09T10:00:00Z"), engineVersion: "pending", results: {},
  });
  assert.equal(running.status, "running");
  assert.equal(running.progress.current, 1);
  assert.deepEqual(running.cases, []);

  const done = femRunSummary(
    {
      id: "r2", status: "done", analysisType: "linear", analysisRunId: "A1",
      createdAt: new Date("2026-11-09T10:00:00Z"), engineVersion: "cbfem-0.1.0",
      results: { governing: "D", cases: [{ name: "D", status: "ok" }], assumptions: ["cbfem.criteriaPending"] },
      files: { mesh: "cbfem/mesh.json" },
    },
    { latestSolvedRunId: "A1", connectionUpdatedAt: new Date("2026-11-09T09:00:00Z") }
  );
  assert.equal(done.governing, "D");
  assert.equal(done.stale, false);
  assert.ok(done.assumptions.includes("cbfem.criteriaPending"));
  // otro análisis vigente, o la conexión editada después: desactualizado
  assert.equal(femRunSummary({ ...done, analysisRunId: "A1", createdAt: new Date("2026-11-09T10:00:00Z") },
    { latestSolvedRunId: "A2" }).stale, true);
  assert.equal(femRunSummary({ id: "r", status: "done", createdAt: new Date("2026-11-09T10:00:00Z") },
    { connectionUpdatedAt: new Date("2026-11-09T11:00:00Z") }).stale, true);
  assert.equal(femRunSummary(null), null);
});
