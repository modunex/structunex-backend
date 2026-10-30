// Campos de la barra que NO son dato del análisis: los usa el diseño (hoy, el sistema
// resistente para las conexiones). Quitarlos antes del análisis hace que asignarlos no
// cambie la huella del modelo (no deja el análisis desactualizado) ni el payload del
// calc-service.
const DESIGN_ONLY_ELEMENT_FIELDS = ["lateralSystem"];

function withoutDesignFields(element) {
  const out = { ...element };
  for (const key of DESIGN_ONLY_ELEMENT_FIELDS) delete out[key];
  return out;
}

module.exports = { withoutDesignFields, DESIGN_ONLY_ELEMENT_FIELDS };
