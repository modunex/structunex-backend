// Registro de generadores de curva de espectro, por `SpectrumFunction.source`.
//
// Espejo de src/components/viewer3d/spectrumSources.ts del frontend: tres normas que
// CALCULAN la curva desde `params` + el JSON de norma, y una fuente de usuario que hace
// passthrough de `params.points`. El calc-service nunca ve una norma: recibe siempre la
// tabla `{T, accel}` (fracción de g) que produce `sample()`.
//
// Añadir una norma es una entrada aquí + su módulo, igual que en el front.
const { getCode } = require("../seismicCodeCatalog");
const covenin1756 = require("./covenin1756");
const covenin1756v2019 = require("./covenin1756-2019");
const nch433 = require("./nch433");
const asce7 = require("./asce7-22");
const userTable = require("./userTable");

// `codeId` es el slug del catálogo sísmico (getCode); null para las fuentes que no leen
// norma (la tabla de usuario). `generate` recibe (code, params) para las normativas y
// (params) para la de usuario.
const GENERATORS = {
  covenin1756: { codeId: "covenin-1756", generate: covenin1756.sample },
  "covenin1756-2019": { codeId: "covenin-1756-2019", generate: covenin1756v2019.sample },
  nch433: { codeId: "nch433", generate: nch433.sample },
  "asce7-22": { codeId: "asce7-22", generate: asce7.sample },
  userTable: { codeId: null, generate: userTable.sample },
};

// Muestrea una SpectrumFunction persistida a `[{T, accel}]`. Lanza si la fuente no existe,
// el catálogo no está, o los params no forman una curva válida (p. ej. una terna de R que
// COVENIN no define). Quien llama decide si eso salta la función o aborta el run.
function sample(fn) {
  const gen = GENERATORS[fn.source];
  if (!gen) throw new Error(`Fuente de espectro desconocida: ${fn.source}`);
  const params = fn.params || {};
  if (gen.codeId == null) return gen.generate(params);
  const code = getCode(gen.codeId);
  if (!code) throw new Error(`Norma sísmica no encontrada: ${gen.codeId}`);
  return gen.generate(code, params);
}

module.exports = { sample, GENERATORS };
