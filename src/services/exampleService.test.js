const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const path = require("node:path");
const { Prisma } = require("@prisma/client");

// Runner integrado de Node:  node --test src/services/exampleService.test.js
//
// Crear un proyecto de ejemplo recorre tres piezas reales: el reconcile del modelo
// (modelService.writeModel), las props de la sección (catalogFrameSectionService) y el
// armado del payload del análisis (analysisService.assembleModel/currentModelHash).
// Aquí corren las tres contra una base de datos EN MEMORIA que imita a Prisma en lo que
// usan (filtros por igualdad e `in`, orden por seq, defaults de columna de
// prisma/schema.prisma). Así se comprueba, sin Postgres, que el ejemplo que se crea es
// exactamente el modelo que el calc-service resuelve en su test de validación.

// --- Base de datos en memoria --------------------------------------------------------
// Defaults de las columnas que el payload lee (prisma/schema.prisma). Los demás campos
// sin valor salen como null, igual que en Postgres.
const DEFAULTS = {
  modelNode: { z: 0 },
  modelElement: { roll: 0 },
  modelSupport: { dx: false, dy: false, dz: false, rx: false, ry: false, rz: false },
  modelFrameLoad: { kind: "distributed", dir: "gravity", value: 0, distAbsolute: false },
  catalogFrameSection: { modifiers: {} },
  modelConfiguration: { loadPatterns: [], loadCombinations: [], modalCases: [], diaphragms: [], lateralSystems: [], spectrumFunctions: [], responseSpectrumCases: [] },
};
const CHILD = new Set(["modelNode", "modelElement", "modelSupport", "modelLoad", "modelArea", "modelFrameLoad", "modelAreaLoad", "modelAreaSpring"]);
const COLUMNS = {
  modelNode: ["id", "x", "y", "z"],
  modelElement: ["id", "nodeA", "nodeB", "frameSectionId", "roll", "releases", "lateralSystem"],
  modelSupport: ["nodeId", "dx", "dy", "dz", "rx", "ry", "rz"],
  modelFrameLoad: ["elementId", "loadPattern", "kind", "dir", "value", "value2", "dist", "dist2", "distAbsolute"],
};

function fakePrisma() {
  const tables = {};
  let seq = 0;
  const rows = (name) => (tables[name] ||= []);
  const matches = (row, where = {}) =>
    Object.entries(where).every(([k, v]) =>
      v && typeof v === "object" && Array.isArray(v.in) ? v.in.includes(row[k]) : row[k] === v
    );
  const pick = (row, select) =>
    select ? Object.fromEntries(Object.keys(select).filter((k) => select[k]).map((k) => [k, row[k]])) : { ...row };
  const sortBy = (list, orderBy) => {
    if (!orderBy) return list;
    const [[key, dir]] = Object.entries(orderBy);
    return [...list].sort((a, b) => (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0) * (dir === "desc" ? -1 : 1));
  };
  const insert = (name, data) => {
    const now = new Date();
    const base = { ...(DEFAULTS[name] || {}) };
    for (const col of COLUMNS[name] || []) if (!(col in base)) base[col] = null;
    const row = { ...base, ...data, createdAt: now, updatedAt: now };
    // jsonNulls escribe Prisma.DbNull para un NULL en columnas Json: se lee como null.
    for (const [k, v] of Object.entries(row)) if (v === Prisma.DbNull) row[k] = null;
    if (CHILD.has(name)) Object.assign(row, { pk: crypto.randomUUID(), seq: BigInt(++seq) });
    else if (name !== "modelConfiguration") row.id ||= crypto.randomUUID();
    rows(name).push(row);
    return row;
  };
  const delegate = (name) => ({
    findMany: async ({ where, orderBy, select } = {}) => sortBy(rows(name).filter((r) => matches(r, where)), orderBy).map((r) => pick(r, select)),
    findFirst: async ({ where, orderBy, select } = {}) => {
      const r = sortBy(rows(name).filter((x) => matches(x, where)), orderBy)[0];
      return r ? pick(r, select) : null;
    },
    findUnique: async ({ where, select }) => {
      const r = rows(name).find((x) => matches(x, where));
      return r ? pick(r, select) : null;
    },
    create: async ({ data }) => ({ ...insert(name, data) }),
    createMany: async ({ data }) => ({ count: data.map((d) => insert(name, d)).length }),
    deleteMany: async ({ where }) => {
      const before = rows(name).length;
      tables[name] = rows(name).filter((r) => !matches(r, where));
      return { count: before - tables[name].length };
    },
    update: async ({ where, data }) => {
      const r = rows(name).find((x) => matches(x, where));
      Object.assign(r, data, { updatedAt: new Date() });
      return { ...r };
    },
    upsert: async ({ where, create, update }) => {
      const r = rows(name).find((x) => matches(x, where));
      if (r) return Object.assign(r, update);
      return insert(name, create);
    },
  });
  const prisma = new Proxy(
    { $transaction: async (fn) => fn(prisma), _tables: tables },
    { get: (target, key) => (key in target ? target[key] : (target[key] = delegate(key))) }
  );
  return prisma;
}

// --- Módulos reales sobre la base en memoria ------------------------------------------
const db = fakePrisma();
require.cache[path.join(__dirname, "../config/db.js")] = {
  id: "fake-db",
  filename: path.join(__dirname, "../config/db.js"),
  loaded: true,
  exports: { prisma: db, connectDb: async () => {}, disconnectDb: async () => {} },
};
const { makeExampleService } = require("./exampleService");
const { writeModel } = require("./modelService");
const { resolveProps } = require("./catalogFrameSectionService");
const analysisService = require("./analysisService");
const calcFixture = require("../lib/fixtures/example_tm01.calc.json");

const service = makeExampleService({
  prisma: db,
  writeModel,
  resolveProps,
  currentModelHash: analysisService.currentModelHash,
});
const OWNER = "user_test";

// El payload real con los ids del catálogo del usuario cambiados por las claves de la
// fixture compartida con el calc-service.
async function payloadFor(projectId, activeDofs) {
  const { analysisOptions, massSource, modalCases, responseSpectrum } =
    await analysisService.resolveOptions(projectId, { activeDofs });
  const model = await analysisService.assembleModel(projectId);
  const json = JSON.stringify({ analysisOptions, model, massSource, modalCases, responseSpectrum });
  const [mat] = await db.catalogMaterial.findMany({ where: { ownerId: OWNER } });
  const [sec] = await db.catalogFrameSection.findMany({ where: { ownerId: OWNER } });
  return JSON.parse(json.split(mat.id).join("MAT-A992").split(sec.id).join("SEC-W12X26"));
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
