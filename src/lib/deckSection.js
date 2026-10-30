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
// Cómo entra al análisis (fase 1, documentado y visible en la interfaz):
//   - Shell de espesor tc (solo el concreto sobre la cresta), con el material del
//     concreto, para membrana y flexión. Los nervios no aportan rigidez: del lado seguro
//     para la rigidez de la losa, sin acción compuesta con las vigas.
//   - Peso y masa: el total real (concreto de la losa + concreto de los nervios + lámina)
//     mediante los modificadores de peso y masa respecto a γc·tc.
//   - No modela el reparto en una dirección ni la ortotropía: la losa reparte en dos
//     direcciones como una placa de espesor tc.

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
 * Propiedades por m² de losa. `gammaConcrete` y `gammaSteel` en kN/m³.
 * Devuelve pesos en kN/m², volúmenes en m³/m², longitudes en m.
 */
function deckProperties(deck, gammaConcrete, gammaSteel) {
  validateDeck(deck);
  if (!(gammaConcrete > 0)) throw new Error("El concreto necesita peso específico (densidad) para calcular el peso propio");
  if (!(gammaSteel > 0)) throw new Error("El acero de la lámina necesita peso específico (densidad)");
  const { tc, hr, wrTop, wrBot, sr, t } = deck;

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
  };
}

module.exports = { deckProperties, validateDeck, DECK_FIELDS: FIELDS };
