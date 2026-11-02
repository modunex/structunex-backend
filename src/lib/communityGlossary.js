// Glosario de traducción. BORRADOR: debe aprobarlo el ingeniero responsable. Al cambiar un
// término hay que subir GLOSSARY_VERSION: invalida las traducciones hechas con el anterior.

const GLOSSARY_VERSION = 1;

/** Términos que se dejan en inglés en ambos idiomas. */
const KEEP = ["shear tab"];

const TERMS = [
  ["bearing", "aplastamiento"],
  ["tearout", "desgarro"],
  ["block shear", "bloque de cortante"],
  ["slip-critical", "de deslizamiento crítico"],
  ["bolt", "perno"],
  ["weld", "soldadura"],
  ["plate", "placa"],
  ["web", "alma"],
  ["flange", "ala"],
  ["beam", "viga"],
  ["column", "columna"],
  ["eccentricity", "excentricidad"],
  ["buckling", "pandeo"],
  ["yield strength", "esfuerzo de fluencia"],
  ["tensile strength", "resistencia a la tracción"],
  ["story drift", "deriva de entrepiso"],
  ["response spectrum", "espectro de respuesta"],
  ["load combination", "combinación de carga"],
  ["diaphragm", "diafragma"],
  ["shear wall", "muro de corte"],
  ["footing", "zapata"],
  ["mat foundation", "losa de cimentación"],
  ["modulus of subgrade reaction", "módulo de reacción del suelo"],
];

module.exports = { GLOSSARY_VERSION, KEEP, TERMS };
