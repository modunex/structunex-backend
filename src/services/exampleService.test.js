const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

// Runner integrado de Node:  node --test src/services/exampleService.test.js
//
// Crear un proyecto de ejemplo recorre tres piezas reales: el reconcile del modelo
// (modelService.writeModel), las props de la sección (catalogFrameSectionService) y el
// armado del payload del análisis (analysisService.assembleModel/currentModelHash).
// Aquí corren las tres contra una base de datos EN MEMORIA que imita a Prisma en lo que
// usan (filtros por igualdad e `in`, orden por seq, defaults de columna de
// prisma/schema.prisma). Así se comprueba, sin Postgres, que el ejemplo que se crea es
// exactamente el modelo que el calc-service resuelve en su test de validación.

// --- Base de datos en memoria (src/testing/fakePrisma) ----------------------------
const { installFakeDb } = require("../testing/fakePrisma");

// --- Módulos reales sobre la base en memoria ------------------------------------------
const db = installFakeDb();
const { makeExampleService } = require("./exampleService");
const { writeModel } = require("./modelService");
const { resolveProps } = require("./catalogFrameSectionService");
const analysisService = require("./analysisService");
const fs = require("node:fs");
const { getExample } = require("../lib/examples");
const calcFixture = require("../lib/fixtures/example_tm01.calc.json");

const service = makeExampleService({
  prisma: db,
  writeModel,
  resolveProps,
  currentModelHash: analysisService.currentModelHash,
});
const OWNER = "user_test";

// El payload real con los ids del catálogo del usuario cambiados por las claves de la
// fixture compartida con el calc-service: MAT-<clave>, SEC-<perfil>, ASEC-<clave>.
async function payloadFor(projectId, activeDofs, ownerId = OWNER) {
  const { analysisOptions, massSource, modalCases, responseSpectrum } =
    await analysisService.resolveOptions(projectId, { activeDofs });
  const model = await analysisService.assembleModel(projectId);
  let json = JSON.stringify({ analysisOptions, model, massSource, modalCases, responseSpectrum });
  const defs = ["tm01", "tm02"].flatMap((id) => {
    const c = getExample(id).catalog;
    return [
      ...c.materials.map((m) => ["catalogMaterial", { name: m.name }, `MAT-${m.key}`]),
      ...c.frameSections.map((s) => ["catalogFrameSection", { catalogLabel: s.catalogLabel }, `SEC-${s.key}`]),
      ...(c.areaSections || []).map((s) => ["catalogAreaSection", { name: s.name }, `ASEC-${s.key}`]),
    ];
  });
  for (const [table, where, label] of defs) {
    for (const row of await db[table].findMany({ where: { ownerId, ...where } })) {
      json = json.split(row.id).join(label);
    }
  }
  return JSON.parse(json);
}

test("crear TM-01 escribe proyecto, catálogo y modelo, y guarda su huella", async () => {
  const project = await service.createFromExample(OWNER, "tm01", { name: "  " });
  assert.equal(project.name, "TM-01 · Viga simplemente apoyada");
  assert.equal(project.code, "TM-01");
  assert.equal(project.templateId, "beam");
  assert.equal(project.analysisType, "beam");
  assert.equal(project.dofPerNode, 2);
  assert.equal(project.params.length, 6);
  assert.equal(project.params.example.id, "tm01");
  assert.equal(project.params.example.version, 1);
  assert.match(project.params.example.modelHash, /^[0-9a-f]{64}$/);
  assert.equal(project.params.example.modelHash, await analysisService.currentModelHash(project._id));

  const [section] = await db.catalogFrameSection.findMany({ where: { ownerId: OWNER } });
  assert.deepEqual(section.props, { A: 0.00493547, I33: 0.0000849112, I22: 0.0000072008, J: 1.24869e-7 });
  const elements = await db.modelElement.findMany({ where: { projectId: project._id } });
  assert.deepEqual(elements.map((e) => e.frameSectionId), [section.id, section.id]);
});

test("el payload del ejemplo es exactamente el que resuelve el calc-service", async () => {
  const [project] = await db.project.findMany({ where: { ownerId: OWNER } });
  // GDL de la formulación "beam" (frontend utils/dofs.ts), los que manda el visor.
  const payload = await payloadFor(project.id, ["UZ", "RY"]);
  assert.deepEqual(payload, calcFixture.request);
  // Y la referencia que se sirve es la misma que compara el calc-service.
  const status = await service.getProjectExample({ ...project });
  assert.deepEqual(status.reference, calcFixture.reference);
});

test("abrir el ejemplo otra vez reutiliza el material y la sección del catálogo", async () => {
  await service.createFromExample(OWNER, "tm01", { name: "Mi copia" });
  assert.equal((await db.catalogMaterial.findMany({ where: { ownerId: OWNER } })).length, 1);
  assert.equal((await db.catalogFrameSection.findMany({ where: { ownerId: OWNER } })).length, 1);
  const names = (await db.project.findMany({ where: { ownerId: OWNER } })).map((p) => p.name);
  assert.ok(names.includes("Mi copia"));
});

test("estado del ejemplo: intacto, modificado y análisis que corresponden o no", async () => {
  const project = await service.createFromExample(OWNER, "tm01");
  const row = await db.project.findUnique({ where: { id: project._id } });
  const pristine = row.params.example.modelHash;

  let status = await service.getProjectExample(row);
  assert.equal(status.modelUnchanged, true);
  assert.equal(status.latestRun, null);

  await db.analysisRun.create({ data: { projectId: row.id, status: "solved", startedAt: new Date(1), modelHash: pristine } });
  status = await service.getProjectExample(row);
  assert.equal(status.latestRun.matchesExample, true);

  // El usuario mueve un nudo: el modelo ya no es el ejemplo y un análisis nuevo tampoco.
  const [n2] = await db.modelNode.findMany({ where: { projectId: row.id, id: "N2" } });
  await db.modelNode.update({ where: { pk: n2.pk }, data: { z: 0.5 } });
  const current = await analysisService.currentModelHash(row.id);
  assert.notEqual(current, pristine);
  await db.analysisRun.create({ data: { projectId: row.id, status: "solved", startedAt: new Date(2), modelHash: current } });
  status = await service.getProjectExample(row);
  assert.equal(status.modelUnchanged, false);
  assert.equal(status.latestRun.matchesExample, false);
});

test("una versión distinta de la fixture no sirve de referencia", async () => {
  const project = await service.createFromExample(OWNER, "tm01");
  const row = await db.project.findUnique({ where: { id: project._id } });
  const status = await service.getProjectExample({ ...row, params: { ...row.params, example: { ...row.params.example, version: 99 } } });
  assert.equal(status.reference, null);
});

test("errores: ejemplo inexistente y proyecto que no es ejemplo", async () => {
  await assert.rejects(service.createFromExample(OWNER, "nope"), (err) => err.status === 404);
  await assert.rejects(service.getProjectExample({ id: "x", params: { length: 6 } }), (err) => err.status === 404);
});

// --- TM-02: pórtico 3D con losas ------------------------------------------------------
// Para regenerar la fixture compartida tras cambiar tm02.json:
//   WRITE_EXAMPLE_FIXTURES=1 node --test src/services/exampleService.test.js
// y copiar src/lib/fixtures/example_tm02.calc.json a calc-service/tests/fixtures/.
const OWNER2 = "user_tm02";
const TM02_FIXTURE = path.join(__dirname, "../lib/fixtures/example_tm02.calc.json");

test("TM-02: crea catálogo (acero, concreto, 2 perfiles, losa) y modelo con losas", async () => {
  const project = await service.createFromExample(OWNER2, "tm02");
  assert.equal(project.analysisType, "space_frame");
  assert.equal(project.dofPerNode, 6);
  assert.equal((await db.catalogMaterial.findMany({ where: { ownerId: OWNER2 } })).length, 2);
  assert.equal((await db.catalogFrameSection.findMany({ where: { ownerId: OWNER2 } })).length, 2);
  const [slab] = await db.catalogAreaSection.findMany({ where: { ownerId: OWNER2 } });
  assert.equal(slab.thicknessMembrane, 0.15);
  const areas = await db.modelArea.findMany({ where: { projectId: project._id } });
  assert.equal(areas.length, 4);
  assert.ok(areas.every((a) => a.areaSectionId === slab.id));
  // Reabrirlo no duplica nada del catálogo.
  await service.createFromExample(OWNER2, "tm02");
  assert.equal((await db.catalogMaterial.findMany({ where: { ownerId: OWNER2 } })).length, 2);
  assert.equal((await db.catalogAreaSection.findMany({ where: { ownerId: OWNER2 } })).length, 1);
});

test("TM-02: el payload es exactamente el que resuelve el calc-service", async () => {
  const [project] = await db.project.findMany({ where: { ownerId: OWNER2 } });
  // GDL de "space_frame" (frontend utils/dofs.ts): los seis.
  const request = await payloadFor(project.id, ["UX", "UY", "UZ", "RX", "RY", "RZ"], OWNER2);
  const reference = getExample("tm02").reference;
  if (process.env.WRITE_EXAMPLE_FIXTURES) {
    const out = {
      _comment: calcFixture._comment.replace(/TM-01/g, "TM-02").replace(/tm01/g, "tm02"),
      exampleId: "tm02",
      exampleVersion: getExample("tm02").version,
      request,
      reference,
    };
    fs.writeFileSync(TM02_FIXTURE, JSON.stringify(out, null, 2) + "\n");
  }
  const shared = JSON.parse(fs.readFileSync(TM02_FIXTURE, "utf8"));
  assert.deepEqual(request, shared.request);
  assert.deepEqual(reference, shared.reference);
});
