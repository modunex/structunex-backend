// Base de datos EN MEMORIA que imita a Prisma en lo que usan los servicios del modelo
// (filtros por igualdad e `in`, orden por seq, defaults de columna de
// prisma/schema.prisma). Para tests: `installFakeDb()` la registra como config/db antes
// de requerir los servicios reales. `$transaction` no deshace nada: basta para comprobar
// qué se lanza, no la atomicidad.
const crypto = require("node:crypto");
const path = require("node:path");
const { Prisma } = require("@prisma/client");

// Defaults de las columnas que el payload lee (prisma/schema.prisma). Los demás campos
// sin valor salen como null, igual que en Postgres.
const DEFAULTS = {
  modelNode: { z: 0 },
  modelElement: { roll: 0 },
  modelSupport: { dx: false, dy: false, dz: false, rx: false, ry: false, rz: false },
  modelFrameLoad: { kind: "distributed", dir: "gravity", value: 0, distAbsolute: false },
  catalogFrameSection: { modifiers: {} },
  catalogAreaSection: { kind: "shell", materialAngle: 0, modifiers: {} },
  modelLoad: { fx: 0, fy: 0, fz: 0, mx: 0, my: 0, mz: 0 },
  modelArea: { localAxisAngle: 0 },
  modelAreaLoad: { dir: "gravity", value: 0 },
  modelConfiguration: { loadPatterns: [], loadCombinations: [], modalCases: [], diaphragms: [], lateralSystems: [], spectrumFunctions: [], responseSpectrumCases: [] },
};
const CHILD = new Set(["modelNode", "modelElement", "modelSupport", "modelLoad", "modelArea", "modelFrameLoad", "modelAreaLoad", "modelAreaSpring"]);
const COLUMNS = {
  modelNode: ["id", "x", "y", "z"],
  modelElement: ["id", "nodeA", "nodeB", "frameSectionId", "roll", "releases", "lateralSystem"],
  modelSupport: ["nodeId", "dx", "dy", "dz", "rx", "ry", "rz"],
  modelFrameLoad: ["elementId", "loadPattern", "kind", "dir", "value", "value2", "dist", "dist2", "distAbsolute"],
  modelLoad: ["nodeId", "loadPattern", "fx", "fy", "fz", "mx", "my", "mz"],
  modelArea: ["id", "nodeIds", "areaSectionId", "mesh", "localAxisAngle", "diaphragm"],
  modelAreaLoad: ["areaId", "loadPattern", "dir", "value"],
  catalogAreaSection: ["deck", "color"],
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
    updateMany: async ({ where, data }) => {
      const list = rows(name).filter((x) => matches(x, where));
      for (const r of list) Object.assign(r, data, { updatedAt: new Date() });
      return { count: list.length };
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


/** Registra una base en memoria como `config/db` y la devuelve. */
function installFakeDb() {
  const db = fakePrisma();
  const file = path.join(__dirname, "../config/db.js");
  require.cache[file] = {
    id: "fake-db",
    filename: file,
    loaded: true,
    exports: { prisma: db, connectDb: async () => {}, disconnectDb: async () => {} },
  };
  return db;
}

module.exports = { fakePrisma, installFakeDb };
