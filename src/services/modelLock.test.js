const { test } = require("node:test");
const assert = require("node:assert/strict");

// Runner integrado de Node:  node --test src/services/modelLock.test.js
//
// El bloqueo del modelo en el servidor (modelLock) contra los servicios reales sobre la
// base en memoria: con el proyecto bloqueado se acepta lo que no cambia la huella del
// análisis y se rechaza con 409 lo que sí.

const { installFakeDb } = require("../testing/fakePrisma");

const db = installFakeDb();
const { makeExampleService } = require("./exampleService");
const modelService = require("./modelService");
const { resolveProps } = require("./catalogFrameSectionService");
const analysisService = require("./analysisService");
const { makeChildService } = require("./crudFactory");
const materials = require("./catalogMaterialService");
const frameSections = require("./catalogFrameSectionService");
const { catalogRefs, LOCKED_CODE } = require("./modelLock");

const examples = makeExampleService({
  prisma: db,
  writeModel: modelService.writeModel,
  resolveProps,
  currentModelHash: analysisService.currentModelHash,
});
const OWNER = "user_lock";

async function setup(exampleId = "tm02") {
  const created = await examples.createFromExample(OWNER, exampleId);
  const project = await db.project.findUnique({ where: { id: created._id ?? created.id } });
  return project;
}
const lock = (project, isLocked = true) =>
  db.project.update({ where: { id: project.id }, data: { isLocked } });
const rejectsLocked = (promise) =>
  assert.rejects(promise, (err) => err.status === 409 && err.details?.code === LOCKED_CODE);

test("catalogRefs selecciona lo mismo que entra en el análisis", async () => {
  const project = await setup("tm02");
  const refs = await catalogRefs(project.id);
  const model = await analysisService.assembleModel(project.id);
  assert.deepEqual([...refs.frameSections].sort(), model.sections.map((s) => s.id).sort());
  assert.deepEqual([...refs.areaSections].sort(), model.areaSections.map((s) => s.id).sort());
  assert.deepEqual([...refs.materials].sort(), model.materials.map((m) => m.id).sort());
});

test("bloqueado: guardar sin cambios y cambiar combinaciones se acepta", async () => {
  const project = await setup("tm02");
  await lock(project);
  const model = await modelService.getModel(project.id);
  await modelService.saveModel(project, model);
  const combos = [...(model.configuration.loadCombinations || []), { name: "SERV", factors: [] }];
  await modelService.saveModel(project, {
    ...model,
    configuration: { ...model.configuration, loadCombinations: combos },
  });
  const saved = await modelService.getModel(project.id);
  assert.equal(saved.configuration.loadCombinations.at(-1).name, "SERV");
});

test("bloqueado: mover un nudo o cambiar un patrón de carga se rechaza con 409", async () => {
  const project = await setup("tm02");
  await lock(project);
  const model = await modelService.getModel(project.id);
  const nodes = model.nodes.map((n, i) => (i === 0 ? { ...n, x: n.x + 1 } : n));
  await rejectsLocked(modelService.saveModel(project, { ...model, nodes }));
  const loadPatterns = model.configuration.loadPatterns.map((p, i) =>
    i === 0 ? { ...p, selfWeightMultiplier: 2 } : p
  );
  await rejectsLocked(
    modelService.saveModel(project, {
      ...model,
      configuration: { ...model.configuration, loadPatterns },
    })
  );
});

test("desbloqueado: el mismo cambio se acepta", async () => {
  const project = await setup("tm02");
  const model = await modelService.getModel(project.id);
  const nodes = model.nodes.map((n, i) => (i === 0 ? { ...n, x: n.x + 1 } : n));
  await modelService.saveModel(project, { ...model, nodes });
});

test("bloqueado: el CRUD por elemento también respeta la huella", async () => {
  const project = await setup("tm02");
  await lock(project);
  const nodes = makeChildService("modelNode");
  await rejectsLocked(nodes.create(project, { id: "N-NUEVO", x: 9, y: 9, z: 9 }));
});

test("catálogo: lo que usa un proyecto bloqueado no se edita ni se borra; lo demás sí", async () => {
  const project = await setup("tm02");
  const refs = await catalogRefs(project.id);
  const usedMaterial = [...refs.materials][0];
  const usedSection = [...refs.frameSections][0];
  const free = await materials.create(OWNER, { name: "Libre", type: "steel", E: 2e8 });

  await lock(project);
  await rejectsLocked(materials.update(OWNER, usedMaterial, { name: "Otro" }));
  await rejectsLocked(frameSections.remove(OWNER, usedSection));
  await materials.update(OWNER, free._id ?? free.id, { name: "Libre 2" });

  await lock(project, false);
  // Sin proyectos bloqueados que lo usen (los de los tests anteriores siguen bloqueados,
  // así que se desbloquean todos los del usuario).
  for (const p of await db.project.findMany({ where: { ownerId: OWNER } })) await lock(p, false);
  await materials.update(OWNER, usedMaterial, { name: "Otro" });
});
