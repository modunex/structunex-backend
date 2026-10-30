const test = require("node:test");
const assert = require("node:assert/strict");
const { prisma } = require("../config/db");
const svc = require("./catalogAreaSectionService");

// Sin base de datos: se sustituyen las tres llamadas que usa el servicio.
const CONCRETE = "0190a000-0000-7000-8000-000000000001";
const STEEL = "0190a000-0000-7000-8000-000000000002";
const SECTION = "0190a000-0000-7000-8000-000000000003";
const mats = {
  [CONCRETE]: { id: CONCRETE, density: 24 },
  [STEEL]: { id: STEEL, density: 77 },
};
let rows = {};
prisma.catalogMaterial.findFirst = async ({ where }) => mats[where.id] || null;
prisma.catalogAreaSection.create = async ({ data }) => (rows[SECTION] = { id: SECTION, ...data });
prisma.catalogAreaSection.findFirst = async ({ where }) => rows[where.id] || null;
prisma.catalogAreaSection.findUnique = async ({ where }) => rows[where.id] || null;
prisma.catalogAreaSection.updateMany = async ({ where, data }) => {
  if (!rows[where.id]) return { count: 0 };
  rows[where.id] = { ...rows[where.id], ...data };
  return { count: 1 };
};

const DECK = { tc: 0.075, hr: 0.05, wrTop: 0.16, wrBot: 0.12, sr: 0.305, t: 0.00091, ribAngle: 0, deckMaterialId: STEEL };

test("a deck is stored as the shell it is analysed with", async () => {
  rows = {};
  const s = await svc.create("u1", { name: "DECK", kind: "deck", materialId: CONCRETE, materialAngle: 0, deck: DECK, modifiers: {} });
  assert.equal(s.shellType, "shell-thin");
  assert.equal(s.thicknessMembrane, 0.075);
  assert.equal(s.thicknessBending, 0.075);
  assert.ok(Math.abs(s.modifiers.weight - 2.436445 / 1.8) < 1e-5);
  assert.equal(s.modifiers.mass, s.modifiers.weight);
  assert.equal(s.modifiers.f11, 1);
  assert.ok(Math.abs(s.deck.props.totalWeight - 2.436445) < 1e-5);
});

test("editing the topping recomputes; turning it into a shell drops the deck", async () => {
  await svc.update("u1", SECTION, { deck: { ...DECK, tc: 0.1 } });
  assert.equal(rows[SECTION].thicknessMembrane, 0.1);
  await svc.update("u1", SECTION, { kind: "shell", shellType: "shell-thin", thicknessMembrane: 0.2, thicknessBending: 0.2, modifiers: { weight: 1, mass: 1 } });
  assert.equal(rows[SECTION].kind, "shell");
  assert.equal(rows[SECTION].thicknessMembrane, 0.2);
  assert.notEqual(rows[SECTION].deck, undefined); // DbNull sentinel, not left as the old deck
  assert.equal(rows[SECTION].deck.tc, undefined);
});

test("a deck without densities is rejected with the reason", async () => {
  mats[STEEL].density = null;
  await assert.rejects(
    svc.create("u1", { name: "X", kind: "deck", materialId: CONCRETE, deck: DECK, modifiers: {} }),
    /acero/
  );
  mats[STEEL].density = 77;
});
