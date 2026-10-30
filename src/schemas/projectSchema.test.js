const { test } = require("node:test");
const assert = require("node:assert/strict");
const { frameLoad, areaLoad } = require("./projectSchema");
const { modelSchema } = require("./modelSchema");

// Runner integrado de Node:  node --test src/schemas/projectSchema.test.js

const base = { elementId: "E1", loadPattern: "Dead" };

test("frameLoad: trapezoidal parcial se conserva entera", () => {
  const load = { ...base, kind: "distributed", dir: "gravity", value: 5, value2: 10, dist: 0.2, dist2: 0.8 };
  assert.deepEqual(frameLoad.parse(load), load);
});

test("frameLoad: direcciones locales y distancias absolutas mayores que 1", () => {
  const point = { ...base, kind: "point", dir: "local2", value: 10, dist: 2.5, distAbsolute: true };
  assert.deepEqual(frameLoad.parse(point), point);
  const trap = { ...base, kind: "distributed", dir: "local3", value: 1, value2: 2, dist: 1, dist2: 4, distAbsolute: true };
  assert.deepEqual(frameLoad.parse(trap), trap);
});

test("frameLoad: una absoluta pequeña no pierde distAbsolute", () => {
  const load = { ...base, kind: "point", value: 10, dist: 0.5, distAbsolute: true };
  assert.equal(frameLoad.parse(load).distAbsolute, true);
});

test("frameLoad: rechaza relativas fuera de 0..1, dist2 < dist y campos desconocidos", () => {
  assert.equal(frameLoad.safeParse({ ...base, kind: "point", value: 1, dist: 2.5 }).success, false);
  assert.equal(frameLoad.safeParse({ ...base, value: 1, dist: 0.8, dist2: 0.2 }).success, false);
  assert.equal(
    frameLoad.safeParse({ ...base, value: 1, dist: 3, dist2: 1, distAbsolute: true }).success,
    false
  );
  assert.equal(frameLoad.safeParse({ ...base, value: 1, valueEnd: 2 }).success, false);
  assert.equal(frameLoad.safeParse({ ...base, kind: "point", value: 1, value2: 2 }).success, false);
});

test("areaLoad sigue sin admitir direcciones locales", () => {
  assert.equal(areaLoad.safeParse({ areaId: "A1", loadPattern: "Dead", dir: "local1" }).success, false);
});

test("modelSchema acepta la carga tal como la guarda el frontend", () => {
  const frameLoads = [
    { ...base, kind: "distributed", dir: "gravity", value: 5, value2: 10, dist: 1, dist2: 4, distAbsolute: true },
    { ...base, kind: "point", dir: "local1", value: 3, dist: 0.25 },
  ];
  assert.deepEqual(modelSchema.parse({ frameLoads }).frameLoads, frameLoads);
});
