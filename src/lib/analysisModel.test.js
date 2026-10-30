const { test } = require("node:test");
const assert = require("node:assert/strict");
const { withoutDesignFields } = require("./analysisModel");
const { modelHash } = require("./modelHash");
const { modelSchema } = require("../schemas/modelSchema");

// node --test src/lib/analysisModel.test.js

const element = { id: "B1", nodeA: "N1", nodeB: "N2", roll: 0 };

test("el sistema resistente no entra al análisis ni cambia la huella del modelo", () => {
  const assigned = { ...element, lateralSystem: "Pórtico B" };
  assert.deepEqual(withoutDesignFields(assigned), element);
  // No muta la fila original.
  assert.equal(assigned.lateralSystem, "Pórtico B");
  const hash = (elements) => modelHash({ model: { nodes: [], elements } });
  assert.equal(hash([withoutDesignFields(assigned)]), hash([element]));
});

test("la configuración acepta sistemas SMF, IMF y OMF con AISC 341-22", () => {
  const ok = modelSchema.safeParse({
    configuration: {
      lateralSystems: [
        { name: "Pórtico B", type: "SMF", code: "AISC341-22" },
        { name: "Pórtico 1", type: "IMF", code: "AISC341-22" },
        { name: "Pórtico 2", type: "OMF", code: "AISC341-22" },
      ],
    },
  });
  assert.equal(ok.success, true, JSON.stringify(ok.error?.issues));
});

test("la configuración rechaza tipos, normas y nombres repetidos que no conoce", () => {
  const parse = (lateralSystems) => modelSchema.safeParse({ configuration: { lateralSystems } }).success;
  assert.equal(parse([{ name: "A", type: "SCBF", code: "AISC341-22" }]), false);
  assert.equal(parse([{ name: "A", type: "SMF", code: "AISC341-16" }]), false);
  assert.equal(parse([{ name: "A", type: "SMF" }]), false);
  assert.equal(
    parse([
      { name: "A", type: "SMF", code: "AISC341-22" },
      { name: "A", type: "IMF", code: "AISC341-22" },
    ]),
    false
  );
});
