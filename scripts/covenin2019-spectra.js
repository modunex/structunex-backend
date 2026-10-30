// Tablas de espectros COVENIN 1756-1:2019 para un sitio, en JSON por stdout.
//
//   node scripts/covenin2019-spectra.js '{"A0":0.3,"A1":0.24,"TL":3.6,"grupo":"B2",
//     "claseSitio":"CD","H":60,"sistemaId":"Ia-acero","nivelDiseno":"ND3"}'
//
// Saca el Sismo de Diseño y el Sismo Extremo (si el grupo lo tiene) con todas las curvas
// (A, Ad, D, DT, Av) de 0 a 4 s cada 0,02 s, que es lo que se reporta.
const { getCode } = require("../src/lib/seismicCodeCatalog");
const { table } = require("../src/lib/spectrumGenerators/covenin1756-2019");

const params = JSON.parse(process.argv[2] || "{}");
const code = getCode("covenin-1756-2019");
const out = {};
for (const sismo of ["diseno", "extremo"]) {
  if (!code.sismos[sismo].grupos[params.grupo]) continue;
  out[sismo] = table(code, { ...params, sismo }, { tMax: 4, step: 0.02 });
}
process.stdout.write(JSON.stringify(out, null, 2));
