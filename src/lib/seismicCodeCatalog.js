const covenin1756 = require("../data/seismic/norma.json");
const covenin1756v2019 = require("../data/seismic/covenin1756-2019.json");
const nch433 = require("../data/seismic/nch433_ds61_sismico.json");
const asce7 = require("../data/seismic/asce7-22_seismic.json");

// Normas sísmicas del sistema (read-only, en memoria). La clave es la que viaja
// en la URL: /seismic-codes/covenin-1756. Añadir ASCE 7 o NSR-10 es una línea
// más aquí, sin tocar ruta ni controlador.
const CODES = {
  "covenin-1756": covenin1756,
  "covenin-1756-2019": covenin1756v2019,
  nch433,
  "asce7-22": asce7,
};

module.exports = {
  getCode: (id) => CODES[id] || null,
  listCodes: () => Object.keys(CODES),
};
