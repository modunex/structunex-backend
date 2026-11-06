// Hoja de espectro de respuesta para Report Studio. Pieza PURA.
//
// Un análisis no guarda las curvas de la norma: guarda la huella de la que usó. La hoja
// sale de la función de Define (parámetros + norma), siempre por el mismo generador que
// alimenta el análisis, así que el frontend no calcula ningún valor.
const spectrumGenerators = require("./spectrumGenerators");

const SPECTRUM_SNAPSHOT_VERSION = 1;
const ROW_DECIMALS = 6;

const CODE_LABEL = { "covenin1756-2019": "COVENIN 1756-1:2019" };

const round = (value) => (value == null ? null : Number(value.toFixed(ROW_DECIMALS)));

const canReport = (fn) => spectrumGenerators.hasTable(fn.source);

/** Filas [T, A, Ad, D, DT, Av]. Una tabla ordenada ocupa mucho menos que objetos. */
function spectrumSnapshot(fn) {
  const { params: r, rows } = spectrumGenerators.table(fn);
  return {
    version: SPECTRUM_SNAPSHOT_VERSION,
    kind: "spectrumSheet",
    function: { name: fn.name, source: fn.source, code: CODE_LABEL[fn.source] ?? fn.source },
    params: {
      sismo: r.sismo, PMR: r.PMR, excedencia: r.excedencia, curva: r.curva,
      A0: r.A0, A1: r.A1, TL: r.TL, H: r.H, claseSitio: r.claseSitio, alpha: r.alpha,
      FA: r.FA, FV: r.FV, FD: r.FD, AA: r.AA, AV: r.AV, beta: r.beta, betaStar: r.betaStar,
      TA: r.TA, TB: r.TB, TC: r.TC, TD: r.TD, Tplus: r.Tplus, q: r.q,
      R: r.R, Cd: r.Cd, rho: r.rho, FI: r.FI, damping: r.damping,
      TvMax: r.vertical?.TvMax ?? null,
    },
    notes: r.notes,
    columns: ["T", "A", "Ad", "D_cm", "DT_cm", "Av"],
    rows: rows.map((row) => [row.T, round(row.A), round(row.Ad), round(row.D_cm), round(row.DT_cm), round(row.Av)]),
  };
}

module.exports = { SPECTRUM_SNAPSHOT_VERSION, canReport, spectrumSnapshot };
