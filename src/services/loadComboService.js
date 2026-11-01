const { getCatalog } = require("../lib/loadCombinationsCatalog");
const { buildCoveninCombos } = require("../lib/coveninCombos");

// Conjunto de combinaciones sísmicas de COVENIN 1756-1:2019 (8.3.2.1). Solo aporta las
// combinaciones CON sismo; las gravitatorias las da otro conjunto marcado a la vez.
const COVENIN_SET = "COVENIN1756";

// Generación de los "Default Design Combos" (estilo SAP/ETABS), del lado del servidor.
//
// Por qué aquí y no en el front: el término sísmico no debe guardar el NOMBRE del caso
// Response Spectrum (renombrar el caso rompería el combo). Se emite como un MARCADOR
// `{ seismic:true }` que el front resuelve a los casos responseSpectrum del proyecto por
// tipo (cualquier nombre). Esta es la lógica propia, autoritativa, que dueña el backend.

// Letra de diseño por tipo de load pattern (espejo de LETTER_BY_TYPE del front).
const LETTER_BY_TYPE = {
  dead: "D",
  superDead: "D",
  live: "L",
  roofLive: "Lr",
  snow: "S",
  rain: "R",
  wind: "W",
  quake: "E",
  other: null,
};

const SEISMIC_LETTER = "E";

// Sets del catálogo que el usuario puede pedir.
function pickCatalogCombos(catalog, sets) {
  const out = [];
  for (const set of sets) {
    if (set === "LRFD") out.push(...((catalog.acero_AISC && catalog.acero_AISC.LRFD) || []));
    else if (set === "ASD") out.push(...((catalog.acero_AISC && catalog.acero_AISC.ASD) || []));
    else if (set === "ACI")
      out.push(...((catalog.concreto_ACI318 && catalog.concreto_ACI318.combinaciones) || []));
  }
  return out;
}

/**
 * Genera los combos por defecto para un proyecto.
 *
 * - Términos NO sísmicos: se expanden a los `loadPatterns` del proyecto con ese `type`.
 * - Término sísmico "E": se emite como marcador `{ seismic:true, factor:±f }`. Cada combo
 *   de catálogo con "E" produce DOS combos (+E y −E), y solo si el proyecto tiene casos
 *   Response Spectrum (si no, el combo sísmico se omite).
 *
 * Devuelve `{ combos, skipped }`. Nombres únicos frente a `reservedNames`.
 */
function generateDefaultCombos({
  loadPatterns = [],
  responseSpectrumCases = [],
  spectrumFunctions = [],
  sets = [],
  covenin = null,
  reservedNames = [],
} = {}) {
  const catalog = getCatalog();
  const catalogCombos = pickCatalogCombos(catalog, sets);
  // Con COVENIN 1756 marcado, el sismo lo pone la 1756: las combinaciones sísmicas del
  // catálogo ASCE 7 no se generan (serían una segunda norma sísmica sobre el mismo caso).
  const withCovenin = sets.includes(COVENIN_SET);
  let skippedSeismicCatalog = 0;

  const patternsByLetter = new Map();
  for (const p of loadPatterns) {
    const letter = LETTER_BY_TYPE[p.type];
    // El sísmico NO se toma de patrones: va por marcador.
    if (!letter || letter === SEISMIC_LETTER) continue;
    if (!patternsByLetter.has(letter)) patternsByLetter.set(letter, []);
    patternsByLetter.get(letter).push(p.name);
  }
  const hasSeismic = (responseSpectrumCases || []).length > 0;

  const reserved = new Set(reservedNames);
  const uniqueName = (base) => {
    let name = base;
    for (let n = 2; reserved.has(name); n++) name = `${base} (${n})`;
    reserved.add(name);
    return name;
  };

  const combos = [];
  let skipped = 0;
  for (const c of catalogCombos) {
    const staticFactors = [];
    let seismicFactor = null;
    for (const [letter, factor] of Object.entries(c.factores || {})) {
      if (letter === SEISMIC_LETTER) {
        seismicFactor = factor;
        continue;
      }
      for (const pattern of patternsByLetter.get(letter) || []) {
        staticFactors.push({ pattern, factor });
      }
    }

    if (seismicFactor != null && withCovenin) {
      skippedSeismicCatalog++;
      continue;
    }
    if (seismicFactor != null) {
      // Un combo sísmico sin casos RS no tiene sentido: se omite.
      if (!hasSeismic) {
        skipped++;
        continue;
      }
      // Envolvente ±E: dos combos, el término sísmico como marcador name-free.
      for (const sign of [1, -1]) {
        const factors = [
          ...staticFactors,
          { seismic: true, factor: sign * seismicFactor },
        ];
        const suffix = sign > 0 ? " (+E)" : " (-E)";
        combos.push({ name: uniqueName(c.nombre + suffix), factors });
      }
      continue;
    }

    if (staticFactors.length === 0) {
      skipped++;
      continue;
    }
    combos.push({ name: uniqueName(c.nombre), factors: staticFactors });
  }

  let coveninMeta = null;
  if (withCovenin) {
    const out = buildCoveninCombos({
      loadPatterns,
      responseSpectrumCases,
      spectrumFunctions,
      options: covenin || {},
      uniqueName,
    });
    combos.push(...out.combos);
    coveninMeta = out.meta;
  }

  return { combos, skipped, skippedSeismicCatalog, covenin: coveninMeta };
}

module.exports = { generateDefaultCombos, LETTER_BY_TYPE, SEISMIC_LETTER, COVENIN_SET };
