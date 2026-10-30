const test = require("node:test");
const assert = require("node:assert/strict");

function fresh(envVars) {
  const saved = {};
  for (const [k, v] of Object.entries(envVars)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  for (const k of Object.keys(require.cache)) if (/config[\\/]env|ai[\\/]models/.test(k)) delete require.cache[k];
  const m = require("./models");
  return { m, restore: () => Object.entries(saved).forEach(([k, v]) => (v === undefined ? delete process.env[k] : (process.env[k] = v))) };
}

test("lista por defecto: Opus, Sonnet y Haiku con su esfuerzo por defecto", () => {
  const { m, restore } = fresh({ AI_MODELS: undefined, AI_EFFORT: undefined, BEDROCK_MODEL_ID: "anthropic.claude-opus-5-5" });
  const o = m.options();
  assert.deepEqual(o.models.map((x) => x.id), ["anthropic.claude-opus-5-5", "anthropic.claude-sonnet-5-5", "anthropic.claude-haiku-5-5"]);
  assert.deepEqual(o.models.map((x) => x.defaultEffort), ["medium", "high", "medium"]);
  assert.equal(o.defaultModel, "anthropic.claude-opus-5-5");
  assert.deepEqual(o.efforts, ["low", "medium", "high", "xhigh", "max"]);
  restore();
});

test("AI_MODELS reemplaza la lista y solo se aceptan sus ids", () => {
  const { m, restore } = fresh({ AI_MODELS: "eu.x-opus|Opus, eu.x-sonnet|Sonnet", BEDROCK_MODEL_ID: "eu.x-opus", AI_EFFORT: "high" });
  assert.equal(m.isAllowedModel("eu.x-sonnet"), true);
  assert.equal(m.isAllowedModel("anthropic.claude-sonnet-5-5"), false);
  assert.equal(m.resolve(undefined, undefined).effort, "high"); // AI_EFFORT, modelo principal
  assert.deepEqual(m.resolve("eu.x-sonnet", undefined), { model: "eu.x-sonnet", label: "Sonnet", effort: "high" });
  assert.equal(m.resolve("eu.x-sonnet", "low").effort, "low");
  assert.equal(m.resolve("otro", "nope").model, "eu.x-opus");
  restore();
});
