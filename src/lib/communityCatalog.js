// Temas y tags iniciales. Se crean una sola vez: después son datos de moderación, y volver
// a arrancar el servidor nunca los sobrescribe.

const TOPICS = [
  ["structural-engineering", "Structural Engineering", "Ingeniería estructural", "Analysis, design and engineering judgment.", "Análisis, diseño y criterio técnico.", "member", true],
  ["soil-mechanics", "Soil Mechanics", "Mecánica de suelos", "Soils, foundations and soil-structure interaction.", "Suelos, cimentaciones e interacción suelo-estructura.", "member", true],
  ["structural-dynamics", "Structural Dynamics", "Dinámica de estructuras", "Modal, seismic and dynamic behavior.", "Comportamiento modal, sísmico y dinámico.", "member", true],
  ["codes-standards", "Codes & Standards", "Normas", "Interpreting and applying design codes.", "Interpretación y aplicación de normas.", "member", true],
  ["software", "Software", "Software", "Structunex and other engineering tools.", "Structunex y otras herramientas de ingeniería.", "member", false],
  ["faq", "FAQ", "Preguntas frecuentes", "Common questions, answered by the team.", "Dudas comunes respondidas por el equipo.", "moderator", false],
  ["announcements", "Announcements", "Anuncios", "News from the Structunex team.", "Novedades del equipo de Structunex.", "moderator", false],
].map(([slug, nameEn, nameEs, descriptionEn, descriptionEs, postingRole, requiresTechnicalContext], position) => ({
  slug, nameEn, nameEs, descriptionEn, descriptionEs, postingRole, requiresTechnicalContext, position,
}));

const TAGS = [
  ["aisc-360", "aisc-360", "aisc-360", "code"],
  ["aisc-341", "aisc-341", "aisc-341", "code"],
  ["aisc-358", "aisc-358", "aisc-358", "code"],
  ["aci-318", "aci-318", "aci-318", "code"],
  ["asce-7", "asce-7", "asce-7", "code"],
  ["covenin-1756", "covenin-1756", "covenin-1756", "code"],
  ["steel", "steel", "acero", "subject"],
  ["concrete", "concrete", "concreto", "subject"],
  ["connections", "connections", "conexiones", "subject"],
  ["foundations", "foundations", "cimentaciones", "subject"],
  ["seismic", "seismic", "sismo", "subject"],
  ["modal-analysis", "modal-analysis", "análisis-modal", "subject"],
  ["modeling", "modeling", "modelado", "product"],
  ["analysis-results", "analysis-results", "resultados", "product"],
  ["reports", "reports", "reportes", "product"],
  ["load-combinations", "load-combinations", "combinaciones", "product"],
].map(([slug, nameEn, nameEs, group]) => ({ slug, nameEn, nameEs, group }));

module.exports = { TOPICS, TAGS };
