const { getCode } = require("./seismicCodeCatalog");
const cov2019 = require("./spectrumGenerators/covenin1756-2019");

// Combinaciones sísmicas de COVENIN 1756-1:2019, 8.3.2.1 (sin sobrerresistencia):
//
//   U = 1,2 CP + γ·CV ± SH + 0,3 SV        (8.6)
//   U = 0,9 CP ± SH − 0,3 SV               (8.7)
//
//   SV = CSV·CP                            (8.4)
//   CSV = β·AA·γmáx·η0                     (8.5; β de 7.2, AA fórmula 7.6, γmáx y η0 tabla 19)
//
// Como SV es una fracción de la carga permanente, ±0,3 SV entra como un factor adicional
// sobre los patrones de CP: (1,2 + 0,3·CSV) CP en 8.6 y (0,9 − 0,3·CSV) CP en 8.7.
//
// SH (8.3.1.1), elegible:
//   - Método del 30 %: SH = SX ± 0,3 SY (8.1) y SH = ±0,3 SX + SY (8.2).
//   - Método RCSC: SH = √(SX² + SY²) (8.3). Se toma de UN caso de espectro con las dos
//     direcciones horizontales combinadas por SRSS (es lo que el análisis ya calcula).
//
// Los casos de espectro se citan POR NOMBRE: el diseño y las conexiones (calc-service)
// reconocen un caso espectral por su tipo y lo tratan como ± (|factor|·|valor|), así que
// SX + 0,3 SY es la envolvente de SX ± 0,3 SY. Se emiten las variantes (+) y (−) como en
// el resto de combos por defecto, para que la sección Analysis muestre ambos signos.
//
// Las combinaciones SOLO gravitatorias no están en la 1756 (remite a la norma del
// material): las aporta otro conjunto (p. ej. AISC/ASCE 7) que el usuario marque junto.
//
// Fuera de alcance (no se generan): 8.3.2.2 con sobrerresistencia Ωo·ρ (elementos que lo
// requieran según 6.3), 8.3.2.1.c (voladizos: 0,3 SV neta hacia arriba) y 8.3.2.1.d
// (análisis con componente vertical dinámica, 8.8–8.10).

const CP_TYPES = new Set(["dead", "superDead"]);
// CV: cargas variables (COVENIN 2002-88), incluida la variable de techo.
const CV_TYPES = new Set(["live", "roofLive"]);

const SOURCE_2019 = "covenin1756-2019";

class CoveninComboError extends Error {
  constructor(code, detail) {
    super(detail ? `${code}: ${detail}` : code);
    this.code = code;
    this.status = 400;
  }
}

const directions = (rsCase) => new Set((rsCase.loads || []).map((l) => l.direction));

/** Parámetros de 8.5 desde la función COVENIN 2019 que usa el caso. */
function verticalCoefficient(rsCase, spectrumFunctions) {
  const fnNames = [...new Set((rsCase.loads || []).map((l) => l.function))];
  const results = [];
  for (const name of fnNames) {
    const fn = (spectrumFunctions || []).find((f) => f.name === name);
    if (!fn) throw new CoveninComboError("covenin.functionMissing", name);
    if (fn.source !== SOURCE_2019) throw new CoveninComboError("covenin.notCovenin2019", name);
    const r = cov2019.resolve(getCode("covenin-1756-2019"), { ...fn.params, damping: fn.damping });
    if (!r.vertical) throw new CoveninComboError("covenin.noVerticalParams", r.claseSitio);
    const CSV = r.beta * r.AA * r.vertical.gammaMax * r.vertical.eta0;
    results.push({
      function: name,
      CSV,
      beta: r.beta,
      AA: r.AA,
      gammaMax: r.vertical.gammaMax,
      eta0: r.vertical.eta0,
      claseSitio: r.claseSitio,
      sismo: r.sismo,
    });
  }
  return results;
}

/**
 * Combos de la 1756 para un proyecto.
 *
 * @param options.method  "30" | "RCSC"
 * @param options.sx, options.sy  casos RS (método 30 %): solo UX y solo UY.
 * @param options.sh      caso RS (método RCSC): UX y UY con combinación direccional SRSS.
 * @param options.gamma   0,5 | 1 (8.3.2.1.b)
 * @returns {{ combos, meta }}
 */
function buildCoveninCombos({
  loadPatterns = [],
  responseSpectrumCases = [],
  spectrumFunctions = [],
  options = {},
  uniqueName = (n) => n,
}) {
  const { method, gamma } = options;
  if (gamma !== 0.5 && gamma !== 1) throw new CoveninComboError("covenin.gamma");

  const byName = new Map(responseSpectrumCases.map((c) => [c.name, c]));
  let seismicTerms; // [{ pattern, factor }] con factor > 0
  let casesForCsv;
  let label;
  if (method === "30") {
    const sx = byName.get(options.sx);
    const sy = byName.get(options.sy);
    if (!sx || !sy) throw new CoveninComboError("covenin.caseMissing");
    if (sx === sy) throw new CoveninComboError("covenin.sameCase");
    const dx = directions(sx);
    const dy = directions(sy);
    if (!(dx.size === 1 && dx.has("UX"))) throw new CoveninComboError("covenin.sxNotX", sx.name);
    if (!(dy.size === 1 && dy.has("UY"))) throw new CoveninComboError("covenin.syNotY", sy.name);
    seismicTerms = [
      { tag: "SX+0.3SY", terms: [{ pattern: sx.name, factor: 1 }, { pattern: sy.name, factor: 0.3 }], eq: "8.1" },
      { tag: "0.3SX+SY", terms: [{ pattern: sx.name, factor: 0.3 }, { pattern: sy.name, factor: 1 }], eq: "8.2" },
    ];
    casesForCsv = [sx, sy];
    label = "30%";
  } else if (method === "RCSC") {
    const sh = byName.get(options.sh);
    if (!sh) throw new CoveninComboError("covenin.caseMissing");
    const d = directions(sh);
    if (!(d.has("UX") && d.has("UY") && !d.has("UZ"))) {
      throw new CoveninComboError("covenin.shNotXY", sh.name);
    }
    if (sh.directionalCombination !== "SRSS") {
      throw new CoveninComboError("covenin.shNotSRSS", sh.name);
    }
    seismicTerms = [{ tag: "SH", terms: [{ pattern: sh.name, factor: 1 }], eq: "8.3" }];
    casesForCsv = [sh];
    label = "RCSC";
  } else {
    throw new CoveninComboError("covenin.method");
  }

  // CSV: una por función citada. Si difieren (sitios distintos), se toma la mayor:
  // es la que más aumenta la carga en 8.6 y más la reduce en 8.7 (lo desfavorable).
  const csvRows = casesForCsv.flatMap((c) => verticalCoefficient(c, spectrumFunctions));
  const CSV = Math.max(...csvRows.map((r) => r.CSV));

  const cp = loadPatterns.filter((p) => CP_TYPES.has(p.type)).map((p) => p.name);
  const cv = loadPatterns.filter((p) => CV_TYPES.has(p.type)).map((p) => p.name);
  if (cp.length === 0) throw new CoveninComboError("covenin.noDead");

  const round = (v) => Math.round(v * 1e6) / 1e6;
  const f86 = round(1.2 + 0.3 * CSV);
  const f87 = round(0.9 - 0.3 * CSV);

  const combos = [];
  for (const sh of seismicTerms) {
    for (const sign of [1, -1]) {
      const s = sign > 0 ? "+" : "-";
      const seismic = sh.terms.map((t) => ({ pattern: t.pattern, factor: sign * t.factor }));
      combos.push({
        name: uniqueName(`COV 8.6 ${s}(${sh.tag})`),
        factors: [
          ...cp.map((pattern) => ({ pattern, factor: f86 })),
          ...cv.map((pattern) => ({ pattern, factor: gamma })),
          ...seismic,
        ],
      });
      combos.push({
        name: uniqueName(`COV 8.7 ${s}(${sh.tag})`),
        factors: [...cp.map((pattern) => ({ pattern, factor: f87 })), ...seismic],
      });
    }
  }

  return {
    combos,
    meta: {
      code: "COVENIN 1756-1:2019",
      clause: "8.3.2.1",
      method: label,
      gamma,
      CSV: round(CSV),
      cpFactor86: f86,
      cpFactor87: f87,
      csv: csvRows.map((r) => ({ ...r, CSV: round(r.CSV), eta0: round(r.eta0), AA: round(r.AA) })),
      cp,
      cv,
    },
  };
}

module.exports = { buildCoveninCombos, CoveninComboError, CP_TYPES, CV_TYPES };
