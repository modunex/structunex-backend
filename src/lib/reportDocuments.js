// Reporting R4: documentos de Report Studio. Piezas PURAS.
//
// Un documento lo escribe el usuario en el navegador, así que sus bloques técnicos
// llegan con una instantánea que el servidor NO puede creer sin más. Antes de exportar,
// cada bloque técnico se reconstruye en el servidor desde su vínculo y se compara la
// huella: si coincide, el PDF lleva la instantánea del servidor; si no, la exportación
// se rechaza y se dice qué bloques hay que actualizar. Así un PDF nunca lleva números de
// ingeniería que no salieron del motor, aunque el documento sea editable.
const { sha256, snapshotFingerprint } = require("./reporting");

const TECHNICAL = new Set(["connectionCheck", "memberCheck", "analysisSummary", "spectrumSheet", "modelTable"]);
const UNIT_SYSTEMS = new Set([
  "lb-in", "lb-ft", "kip-in", "kip-ft", "kn-mm", "kn-m", "kgf-mm", "kgf-m",
  "n-mm", "n-m", "tonf-mm", "tonf-m", "kn-cm", "kgf-cm", "n-cm", "tonf-cm",
]);
const MAX_OPTION_ITEMS = 200;
const isShortList = (value) =>
  Array.isArray(value) && value.length <= MAX_OPTION_ITEMS
  && value.every((item) => typeof item === "string" && item.length <= 200);

const TABLE_STEPS = [0.02, 0.04, 0.1, 0.2, 0.5];
const TABLE_MAXIMA = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4];

/** Opciones de presentación de un bloque técnico. No forman parte de su huella. */
function optionsError(options) {
  if (options === undefined || options === null) return null;
  if (typeof options !== "object" || Array.isArray(options)) return "invalid options";
  const known = new Set(["title", "sections", "cases", "hiddenColumns", "unitSystem", "significantDigits", "tableStep", "tableMax", "rows"]);
  if (Object.keys(options).some((key) => !known.has(key))) return "unknown option";
  if (options.title !== undefined && (typeof options.title !== "string" || options.title.length > 200)) return "invalid title";
  for (const key of ["sections", "cases", "hiddenColumns", "rows"]) {
    if (options[key] !== undefined && !isShortList(options[key])) return `invalid ${key}`;
  }
  if (options.unitSystem !== undefined && !UNIT_SYSTEMS.has(options.unitSystem)) return "invalid unitSystem";
  if (options.significantDigits !== undefined && ![3, 4, 5].includes(options.significantDigits)) return "invalid significantDigits";
  // Tabla de un espectro: recortan lo que se imprime de una hoja de 0 a 4 s cada 0,02 s.
  if (options.tableStep !== undefined && !TABLE_STEPS.includes(options.tableStep)) return "invalid tableStep";
  if (options.tableMax !== undefined && !TABLE_MAXIMA.includes(options.tableMax)) return "invalid tableMax";
  return null;
}

const PAGE_KEYS = new Set(["size", "orientation", "margins", "cover", "toc", "runningHeaders", "chapterBreaks"]);
const MARGIN_SIDES = ["top", "right", "bottom", "left"];
const isMargin = (value) => typeof value === "number" && value >= 10 && value <= 50;

/** Configuración de impresión del documento. No cambia ningún dato ni ninguna huella. */
function pageError(page) {
  if (page === undefined || page === null) return null;
  if (typeof page !== "object" || Array.isArray(page)) return "invalid page";
  if (Object.keys(page).some((key) => !PAGE_KEYS.has(key))) return "unknown page setting";
  if (page.size !== undefined && !["letter", "a4", "legal"].includes(page.size)) return "invalid page size";
  if (page.orientation !== undefined && !["portrait", "landscape"].includes(page.orientation)) return "invalid page orientation";
  for (const key of ["cover", "toc", "runningHeaders", "chapterBreaks"]) {
    if (page[key] !== undefined && typeof page[key] !== "boolean") return `invalid page ${key}`;
  }
  const { margins } = page;
  if (margins !== undefined) {
    if (!margins || typeof margins !== "object" || Array.isArray(margins)) return "invalid page margins";
    if (Object.keys(margins).some((key) => !MARGIN_SIDES.includes(key))) return "invalid page margins";
    if (!MARGIN_SIDES.every((side) => isMargin(margins[side]))) return "invalid page margins";
  }
  return null;
}

const SIMPLE = new Set(["heading", "paragraph", "bulletList", "numberedList", "callout", "divider", "pageBreak", "equation", "table", "toc"]);
const MAX_BLOCKS = 5000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Una figura solo cita una versión de la biblioteca. La imagen la pone el servidor. */
function figureError(b) {
  if (!UUID.test(b.imageId ?? "") || !UUID.test(b.imageVersionId ?? "")) return "invalid image";
  if (b.src !== undefined || b.origin !== undefined) return "reserved field";
  if (b.width !== "full" && b.width !== "half") return "invalid width";
  if (typeof b.alt !== "string" || b.alt.length > 500) return "invalid alt";
  if (!Array.isArray(b.caption) || JSON.stringify(b.caption).length > 4000) return "invalid caption";
  return null;
}

/** Validación estructural mínima del formato v1 (el detalle lo cuida el editor). */
function validateDocument(doc) {
  if (!doc || typeof doc !== "object" || doc.version !== 1 || !Array.isArray(doc.blocks)) {
    return "document must be a Report Studio document, version 1";
  }
  if (doc.blocks.length > MAX_BLOCKS) return `at most ${MAX_BLOCKS} blocks`;
  const invalidPage = pageError(doc.page);
  if (invalidPage) return invalidPage;
  const ids = new Set();
  for (const b of doc.blocks) {
    if (!b || typeof b.id !== "string" || !b.id) return "every block needs an id";
    if (b.id.startsWith("__")) return `block ${b.id}: ids starting with __ are reserved`;
    if (ids.has(b.id)) return `duplicate block id ${b.id}`;
    ids.add(b.id);
    if (!SIMPLE.has(b.type) && !TECHNICAL.has(b.type) && b.type !== "figure") return `unknown block type ${b.type}`;
    if (b.type === "toc") {
      if (b.title !== undefined && (typeof b.title !== "string" || b.title.length > 200)) return `block ${b.id}: invalid title`;
      if (b.depth !== undefined && ![1, 2, 3].includes(b.depth)) return `block ${b.id}: invalid depth`;
    }
    if (b.type === "figure") {
      const invalid = figureError(b);
      if (invalid) return `block ${b.id}: ${invalid}`;
    }
    if (TECHNICAL.has(b.type)) {
      const k = bindingKey(b);
      if (!k) return `block ${b.id}: invalid binding`;
      if (typeof b.snapshotHash !== "string") return `block ${b.id}: snapshotHash required`;
      const invalid = optionsError(b.options);
      if (invalid) return `block ${b.id}: ${invalid}`;
    }
  }
  return null;
}

/** Clave estable del dato al que apunta un bloque técnico (null si el vínculo no vale). */
function bindingKey(b) {
  const x = b.binding || {};
  if (b.type === "connectionCheck" && x.source === "connectionRun" && x.runId) return `c:${x.runId}`;
  if (b.type === "memberCheck" && x.source === "designRun" && x.designRunId && x.elementId) return `m:${x.designRunId}:${x.elementId}`;
  if (b.type === "analysisSummary" && x.source === "analysisRun" && x.analysisRunId) return `a:${x.analysisRunId}`;
  if (b.type === "modelTable" && x.source === "projectModel" && ["materials", "sections"].includes(x.table)) return `t:${x.table}`;
  if (b.type === "spectrumSheet" && x.source === "spectrumFunction" && typeof x.functionName === "string" && x.functionName) {
    return `s:${x.functionName}`;
  }
  return null;
}

const technicalBlocks = (doc) => doc.blocks.filter((b) => TECHNICAL.has(b.type));

/**
 * Sustituye las instantáneas por las del servidor y recoge los problemas.
 * `server`: Map<bindingKey, { snapshot, state, staleReasons } | { error: "missing" | "stale" }>.
 *   state "current" | "stale" | "superseded": para avisar en el PDF de lo no vigente.
 * Devuelve { document, problems: [{ blockId, type, reason }] } con reason
 *   "changed"  la instantánea del documento no es la del servidor (hay que actualizar),
 *   "missing"  el dato ya no existe (comprobación borrada o podada),
 *   "stale"    (análisis) ya no es del modelo actual.
 */
function verifyDocument(doc, server, { warningText }) {
  const problems = [];
  const blocks = [];
  for (const b of doc.blocks) {
    if (!TECHNICAL.has(b.type)) {
      blocks.push(b);
      continue;
    }
    const got = server.get(bindingKey(b));
    if (!got || got.error) {
      problems.push({ blockId: b.id, type: b.type, reason: got?.error || "missing" });
      continue;
    }
    const hash = snapshotFingerprint(got.snapshot);
    if (hash !== b.snapshotHash) {
      problems.push({ blockId: b.id, type: b.type, reason: "changed" });
      continue;
    }
    if (got.state && got.state !== "current") {
      blocks.push({
        id: `__warn-${b.id}`, // reservado: no choca con ids del autor
        type: "callout",
        tone: "warning",
        content: [{ text: warningText(got.state, got.staleReasons || []) }],
      });
    }
    blocks.push({ ...b, snapshot: got.snapshot, snapshotHash: hash });
  }
  return { document: { version: 1, blocks, ...(doc.page ? { page: doc.page } : {}) }, problems };
}

/** Documento en blanco con su título. */
function blankDocument(title) {
  return {
    version: 1,
    blocks: [
      { id: "h-title", type: "heading", level: 1, content: [{ text: title }] },
      { id: "p-1", type: "paragraph", content: [] },
    ],
  };
}

const REASONS = {
  es: {
    "connection.orphaned": "la conexión ya no coincide con el modelo",
    "connection.edited": "la conexión se modificó después de comprobarla",
    "analysis.outdated": "se hizo con un análisis anterior al vigente",
    "analysis.missing": "el proyecto no tiene un análisis vigente",
    "model.changed": "el modelo cambió después del análisis",
    "loads.changed": "las combinaciones de carga cambiaron",
    "inputs.changed": "las combinaciones o las preferencias de diseño cambiaron",
    "state.unknown": "no se pudo determinar su vigencia",
  },
  en: {
    "connection.orphaned": "the connection no longer matches the model",
    "connection.edited": "the connection was edited after it was checked",
    "analysis.outdated": "it used an analysis older than the current one",
    "analysis.missing": "the project has no current analysis",
    "model.changed": "the model changed after the analysis",
    "loads.changed": "the load combinations changed",
    "inputs.changed": "the load combinations or design preferences changed",
    "state.unknown": "its currency could not be determined",
  },
};
const WARN = {
  es: (state, reasons) =>
    `Bloque no vigente (${state === "superseded" ? "hay una comprobación posterior" : reasons.map((r) => REASONS.es[r] || r).join("; ") || "desactualizado"}): sus valores son los de la comprobación indicada en su pie, no los del estado actual del proyecto.`,
  en: (state, reasons) =>
    `Non-current block (${state === "superseded" ? "there is a later check" : reasons.map((r) => REASONS.en[r] || r).join("; ") || "out of date"}): its values are those of the check named in its footer, not the current state of the project.`,
};

/**
 * La plantilla "memoria" guarda en el documento SOLO lo que se puede volver a verificar:
 * títulos y bloques técnicos. Las tablas resumen, los recuentos y los avisos de vigencia
 * que arma el servidor para la exportación directa son texto que el editor no vuelve a
 * comprobar, así que no se guardan (los avisos se añaden de nuevo al exportar).
 */
function templateBlocks(blocks) {
  return blocks
    .filter((b) => b.type === "heading" || TECHNICAL.has(b.type))
    .flatMap((b) => (b.type === "analysisSummary" ? analysisSectionBlocks(b) : [b]));
}

/**
 * El análisis entra como un bloque por sección, cada uno con sus propiedades. Comparten
 * instantánea: se guarda en el primero y el editor la repone por su huella.
 */
function analysisSectionBlocks(block) {
  const s = block.snapshot;
  const sections = [
    ["model", true],
    ["loads", true],
    ["results", true],
    ["reactionSums", s.cases.some((c) => c.reactions?.sum)],
    ["modal", s.modes.length > 0],
    ["seismicWeight", s.stories.some((row) => row.weight !== null)],
    ["rigidity", s.stories.some((row) => row.crX !== null || row.kx !== null)],
    ["storyForces", s.storyForces.length > 0],
    ["drift", s.driftIndicative.length > 0],
    ["reactions", s.cases.some((c) => c.reactions?.rows?.length)],
  ].filter(([, hasData]) => hasData);
  return sections.map(([id], index) => ({
    ...block,
    id: `${block.id}-${id}`,
    display: "full",
    snapshot: index === 0 ? s : null,
    options: { ...block.options, sections: [id] },
  }));
}

// Plantilla "Informe sismorresistente": la estructura de una memoria de edificación de
// acero con análisis modal espectral (COVENIN 1756 / AISC 360 / AISC 358). Solo títulos
// y una línea guía por capítulo: el contenido técnico lo inserta el usuario desde el
// archivo (bloques vinculados), nunca la plantilla.
const SEISMIC_REPORT = {
  es: [
    ["Acciones verticales", "Cargas permanentes y variables consideradas (kgf/m²) y su origen normativo."],
    ["Espectros de respuesta", "Espectros elástico e inelástico de cada sismo, de desplazamientos y de la componente vertical."],
    ["Derivas de entrepiso", "Relación de deriva lateral total por nivel para cada sismo y su comparación con los límites."],
    ["Deriva global", "Deriva lateral global de la edificación para cada sismo."],
    ["Desempeño esperado", "Comparación de la deriva global con los umbrales de desempeño de referencia."],
    ["Diseño de miembros", "Diseño de vigas y columnas según AISC 360. Inserta aquí la tabla o las hojas de las barras."],
    ["Comprobación manual", "Verificación manual de los valores del reporte de diseño de las barras seleccionadas."],
    ["Diseño de la conexión", "Conexión precalificada según AISC 358. Inserta aquí la hoja de la conexión."],
    ["Conclusiones y recomendaciones", ""],
  ],
  en: [
    ["Gravity loads", "Dead and live loads considered (kgf/m²) and their code source."],
    ["Response spectra", "Elastic and inelastic spectra of each earthquake, displacement spectrum and vertical component."],
    ["Story drifts", "Total lateral drift ratio per story for each earthquake and comparison with the limits."],
    ["Global drift", "Global lateral drift of the building for each earthquake."],
    ["Expected performance", "Comparison of the global drift with the reference performance thresholds."],
    ["Member design", "Beam and column design per AISC 360. Insert the member table or sheets here."],
    ["Hand check", "Hand verification of the design report values of the selected members."],
    ["Connection design", "Prequalified connection per AISC 358. Insert the connection sheet here."],
    ["Conclusions and recommendations", ""],
  ],
};

function seismicReportDocument(title, lang = "es") {
  const chapters = SEISMIC_REPORT[lang] || SEISMIC_REPORT.es;
  const blocks = [{ id: "t-title", type: "heading", level: 1, content: [{ text: title }] }];
  chapters.forEach(([heading, guide], i) => {
    blocks.push({ id: `t-h${i + 1}`, type: "heading", level: 1, content: [{ text: `${i + 1}. ${heading}` }] });
    blocks.push({ id: `t-p${i + 1}`, type: "paragraph", content: guide ? [{ text: guide }] : [] });
  });
  return { version: 1, blocks };
}

module.exports = {
  seismicReportDocument,
  TECHNICAL,
  validateDocument,
  bindingKey,
  technicalBlocks,
  verifyDocument,
  blankDocument,
  templateBlocks,
  warningText: (lang) => WARN[lang] || WARN.es,
};
