// Palabras comunes que casi no se comparten entre español e inglés.
const WORDS = {
  es: new Set("el la los las un una unos unas de del y o que en con para por como pero más es son está están hay se su sus lo al este esta estos estas cómo qué cuál cuando donde sobre tengo tiene puede debe mi muy también si sin entre según".split(" ")),
  en: new Set("the a an of and or that in on with for by as but more is are was were there it its this these those how what which when where about have has can should must my very also if without between from to be do does not".split(" ")),
};

const MIN_WORDS = 2;

/**
 * Idioma de un texto. Si las señales no son claras, se queda con `fallback`, que es
 * el idioma de la página desde la que se escribió.
 */
function detectLocale(text, fallback) {
  const score = { es: (text.match(/[áéíóúñ¿¡]/gi) ?? []).length, en: 0 };
  for (const word of text.toLowerCase().match(/\p{L}+/gu) ?? []) {
    if (WORDS.es.has(word)) score.es += 1;
    if (WORDS.en.has(word)) score.en += 1;
  }
  if (Math.abs(score.es - score.en) < MIN_WORDS) return fallback;
  return score.es > score.en ? "es" : "en";
}

module.exports = { detectLocale };
