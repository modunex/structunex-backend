const { env } = require("../../config/env");

// Modelos y niveles de esfuerzo que el usuario puede elegir en el chat. La lista es
// una allowlist del servidor: el cliente solo elige de aquí (nunca manda un id libre).
//
// AI_MODELS="id|Etiqueta,id|Etiqueta" la reemplaza. Sin ella: Opus (BEDROCK_MODEL_ID),
// Sonnet y Haiku 5.5. Los ids de Sonnet/Haiku siguen el patrón del de Opus; si en la
// región tienen otro id, hay que declararlos en AI_MODELS.

const EFFORTS = ["low", "medium", "high", "xhigh", "max"];

// Esfuerzo por defecto de cada familia (el que usa la API si no se indica).
const FAMILY_DEFAULT_EFFORT = { opus: "medium", sonnet: "high", haiku: "medium" };

function family(id) {
  const m = /(opus|sonnet|haiku)/i.exec(id);
  return m ? m[1].toLowerCase() : null;
}

function parseModels(raw) {
  return String(raw)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const [id, label] = entry.split("|").map((s) => s.trim());
      return { id, label: label || id };
    })
    .filter((m) => m.id);
}

function defaultModels() {
  const opus = env.bedrockModelId;
  const list = [{ id: opus, label: "Opus 5.5" }];
  if (family(opus) === "opus") {
    list.push({ id: opus.replace(/opus/i, "sonnet"), label: "Sonnet 5.5" });
    list.push({ id: opus.replace(/opus/i, "haiku"), label: "Haiku 5.5" });
  }
  return list;
}

function listModels() {
  const fromEnv = process.env.AI_MODELS ? parseModels(process.env.AI_MODELS) : [];
  const models = fromEnv.length ? fromEnv : defaultModels();
  return models.map((m) => ({ ...m, family: family(m.id), defaultEffort: defaultEffort(m.id) }));
}

/** El esfuerzo por defecto: AI_EFFORT para el modelo principal; el de su familia para el resto. */
function defaultEffort(modelId) {
  if (modelId === env.bedrockModelId && process.env.AI_EFFORT && EFFORTS.includes(process.env.AI_EFFORT)) {
    return process.env.AI_EFFORT;
  }
  return FAMILY_DEFAULT_EFFORT[family(modelId)] || "medium";
}

function options() {
  const models = listModels();
  const def = models.find((m) => m.id === env.bedrockModelId) || models[0];
  return { models, efforts: EFFORTS, defaultModel: def.id };
}

/**
 * Lo que se usará en el turno. Un modelo fuera de la allowlist o un esfuerzo
 * desconocido no se aceptan (el controlador ya respondió 400 en ese caso).
 */
function resolve(model, effort) {
  const { models, defaultModel } = options();
  const chosen = models.find((m) => m.id === model) || models.find((m) => m.id === defaultModel);
  return {
    model: chosen.id,
    label: chosen.label,
    effort: EFFORTS.includes(effort) ? effort : chosen.defaultEffort,
  };
}

function isAllowedModel(id) {
  return listModels().some((m) => m.id === id);
}

module.exports = { EFFORTS, options, resolve, isAllowedModel, parseModels, defaultEffort };
