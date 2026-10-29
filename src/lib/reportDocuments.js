// Reporting R4: documentos de Report Studio. Piezas PURAS.
//
// Un documento lo escribe el usuario en el navegador, así que sus bloques técnicos
// llegan con una instantánea que el servidor NO puede creer sin más. Antes de exportar,
// cada bloque técnico se reconstruye en el servidor desde su vínculo y se compara la
// huella: si coincide, el PDF lleva la instantánea del servidor; si no, la exportación
// se rechaza y se dice qué bloques hay que actualizar. Así un PDF nunca lleva números de
// ingeniería que no salieron del motor, aunque el documento sea editable.
const { sha256 } = require("./reporting");

const TECHNICAL = new Set(["connectionCheck", "memberCheck", "analysisSummary"]);
const SIMPLE = new Set(["heading", "paragraph", "bulletList", "numberedList", "callout", "divider", "pageBreak", "equation", "table"]);
const MAX_BLOCKS = 5000;

/** Validación estructural mínima del formato v1 (el detalle lo cuida el editor). */
function validateDocument(doc) {
  if (!doc || typeof doc !== "object" || doc.version !== 1 || !Array.isArray(doc.blocks)) {
    return "document must be a Report Studio document, version 1";
  }
  if (doc.blocks.length > MAX_BLOCKS) return `at most ${MAX_BLOCKS} blocks`;
  const ids = new Set();
  for (const b of doc.blocks) {
    if (!b || typeof b.id !== "string" || !b.id) return "every block needs an id";
    if (ids.has(b.id)) return `duplicate block id ${b.id}`;
    ids.add(b.id);
    if (!SIMPLE.has(b.type) && !TECHNICAL.has(b.type)) return `unknown block type ${b.type}`;
    if (TECHNICAL.has(b.type)) {
      const k = bindingKey(b);
      if (!k) return `block ${b.id}: invalid binding`;
      if (typeof b.snapshotHash !== "string") return `block ${b.id}: snapshotHash required`;
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
    const hash = sha256(got.snapshot);
    if (hash !== b.snapshotHash) {
      problems.push({ blockId: b.id, type: b.type, reason: "changed" });
      continue;
    }
    if (got.state && got.state !== "current") {
      blocks.push({
        id: `w-${b.id}`,
        type: "callout",
        tone: "warning",
        content: [{ text: warningText(got.state, got.staleReasons || []) }],
      });
    }
    blocks.push({ ...b, snapshot: got.snapshot, snapshotHash: hash });
  }
  return { document: { version: 1, blocks }, problems };
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

const WARN = {
  es: (state, reasons) =>
    `Bloque no vigente (${state === "superseded" ? "hay una comprobación posterior" : reasons.join(", ") || "desactualizado"}): sus valores son los de la comprobación indicada en su pie, no los del estado actual del proyecto.`,
  en: (state, reasons) =>
    `Non-current block (${state === "superseded" ? "there is a later check" : reasons.join(", ") || "out of date"}): its values are those of the check named in its footer, not the current state of the project.`,
};

module.exports = {
  TECHNICAL,
  validateDocument,
  bindingKey,
  technicalBlocks,
  verifyDocument,
  blankDocument,
  warningText: (lang) => WARN[lang] || WARN.es,
};
