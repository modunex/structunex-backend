// Losa colaborante (Composite Steel Deck, "losacero"): concreto vaciado sobre una lámina
// de acero trapezoidal. Aquí solo hay geometría y pesos; ninguna verificación de diseño.
//
// Geometría por nervio (todo en m), como la "Filled Deck" de ETABS:
//
//        |<-------------- sr --------------->|
//   ─────────────────────────────────────────────────   ┬
//                 concreto (tc)                         │ tc
//   ──────┐            ┌──────────┐            ┌─────   ┴  ← cresta de la lámina
//          \          /            \          /         ┬
//           \________/              \________/          │ hr
//           |<-wrBot->|                                 ┴
//        |<--- wrTop --->|  (ancho del nervio de concreto arriba)
//
//   tc     espesor de concreto sobre la cresta
//   hr     altura del nervio (de la lámina)
//   wrTop  ancho del nervio de concreto en la cresta
//   wrBot  ancho del nervio de concreto en el fondo
//   sr     separación entre nervios (paso)
//   t      espesor de la lámina
//   ribAngle  dirección de los nervios respecto al eje local 1 del área (grados)
//
// Cómo entra al análisis (fase 2):
//   - Membrana: shell de espesor tc (el concreto sobre la cresta) con el material del
//     concreto. Es lo que trabaja como diafragma.
//   - Flexión ORTÓTROPA: a lo largo de los nervios, la inercia bruta no fisurada de la
//     sección compuesta por paso (losa + nervio trapezoidal de concreto + lámina
//     transformada por n = Es/Ec); transversal a los nervios, solo el concreto sobre la
//     cresta (tc³/12). La torsión con la media geométrica de ambas (Huber). Así la losa
//     descarga en las vigas perpendiculares a los nervios, como una losa unidireccional,
//     sin reglas tributarias: lo decide la rigidez.
//   - Peso y masa: el total real (concreto de la losa + concreto de los nervios + lámina)
//     mediante los modificadores de peso y masa respecto a γc·tc.
//   - Sin acción compuesta con las vigas.

const FIELDS = ["tc", "hr", "wrTop", "wrBot", "sr", "t"];

function validateDeck(deck) {
  for (const k of FIELDS) {
    const v = deck[k];
    if (!(Number.isFinite(v) && v > 0)) throw new Error(`${k} debe ser un número mayor que cero`);
  }
  const { hr, wrTop, wrBot, sr, t } = deck;
  if (wrBot > wrTop) throw new Error("El ancho del nervio en el fondo no puede superar al de la cresta");
  if (wrTop >= sr) throw new Error("El ancho del nervio en la cresta debe ser menor que la separación entre nervios");
  if (t >= hr / 4) throw new Error("El espesor de la lámina no es coherente con la altura del nervio");
}

/**
 * Inercias de flexión por unidad de ancho (m⁴/m), sección bruta no fisurada.
 * `n` = Es/Ec transforma la lámina a concreto. Alturas medidas desde el fondo del nervio.
 *   - `along`: losa + nervio trapezoidal + lámina (fondo, dos almas inclinadas y cresta).
 *   - `across`: solo el concreto sobre la cresta, tc³/12.
 */
function deckBendingInertias(deck, n) {
  const { tc, hr, wrTop, wrBot, sr, t } = deck;
  const web = Math.hypot(hr, (wrTop - wrBot) / 2);
  // Partes por paso sr: [área, altura del centroide, inercia propia]
  const parts = [
    [tc * sr, hr + tc / 2, (sr * tc ** 3) / 12],
    [
      (hr * (wrTop + wrBot)) / 2,
      (hr * (wrBot + 2 * wrTop)) / (3 * (wrBot + wrTop)),
      (hr ** 3 * (wrBot ** 2 + 4 * wrBot * wrTop + wrTop ** 2)) / (36 * (wrBot + wrTop)),
    ],
    [n * t * wrBot, 0, 0],
    [n * t * 2 * web, hr / 2, (n * t * 2 * web * hr ** 2) / 12],
    [n * t * (sr - wrTop), hr, 0],
  ];
  const area = parts.reduce((s, [a]) => s + a, 0);
  const centroid = parts.reduce((s, [a, y]) => s + a * y, 0) / area;
  const inertia = parts.reduce((s, [a, y, i]) => s + i + a * (y - centroid) ** 2, 0);
  return { along: inertia / sr, across: tc ** 3 / 12, centroid };
}

/**
 * Propiedades por m² de losa. `gammaConcrete` y `gammaSteel` en kN/m³; `modulusRatio`
 * = Es/Ec (sin valor, 8). Devuelve pesos en kN/m², volúmenes en m³/m², longitudes en m.
 */
function deckProperties(deck, gammaConcrete, gammaSteel, modulusRatio = 8) {
  validateDeck(deck);
  if (!(gammaConcrete > 0)) throw new Error("El concreto necesita peso específico (densidad) para calcular el peso propio");
  if (!(gammaSteel > 0)) throw new Error("El acero de la lámina necesita peso específico (densidad)");
  const { tc, hr, wrTop, wrBot, sr, t } = deck;
  const bending = deckBendingInertias(deck, modulusRatio > 0 ? modulusRatio : 8);

  const ribFraction = (wrTop + wrBot) / (2 * sr); // fracción del paso que ocupa el nervio (promedio)
  const concreteVolume = tc + hr * ribFraction; // m³ por m² de losa
  const web = Math.hypot(hr, (wrTop - wrBot) / 2);
  const developedLength = sr - wrTop + wrBot + 2 * web; // lámina por paso
  const steelPerArea = (t * developedLength) / sr; // m³/m²

  const concreteWeight = gammaConcrete * concreteVolume;
  const deckWeight = gammaSteel * steelPerArea;
  const totalWeight = concreteWeight + deckWeight;

  return {
    totalDepth: tc + hr,
    concreteVolume,
    equivalentThickness: concreteVolume, // espesor de concreto macizo con el mismo volumen
    developedLength,
    concreteWeight,
    deckWeight,
    totalWeight,
    // Lo que entra al shell: espesor tc y el factor que lleva su peso al total.
    analysisThickness: tc,
    weightFactor: totalWeight / (gammaConcrete * tc),
    // Flexión ortótropa respecto a la placa isótropa de espesor tc (m⁴/m y factores).
    bendingAlong: bending.along,
    bendingAcross: bending.across,
    bendingRatio: bending.along / bending.across,
    orthotropic: {
      e1Factor: bending.along / bending.across,
      e2Factor: 1,
      g12Factor: Math.sqrt(bending.along / bending.across),
      angle: Number.isFinite(deck.ribAngle) ? deck.ribAngle : 0,
    },
  };
}

module.exports = { deckProperties, deckBendingInertias, validateDeck, DECK_FIELDS: FIELDS };
