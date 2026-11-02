// Saneador de los documentos de TipTap de la Comunidad.
//
// El navegador manda JSON, y el JSON es entrada no confiable: aquí se reconstruye el
// documento nodo a nodo con una lista cerrada de tipos, marcas y atributos. Lo que no esté
// en la lista se rechaza (no se ignora: un nodo desconocido indica un cliente manipulado o
// desactualizado). Solo se guarda lo que devuelve esta función; nunca HTML.

const MAX_DEPTH = 12;
const MAX_NODES = 5000;
const MAX_TEXT = 40000;
const MAX_LATEX = 2000;
const MAX_URL = 2048;

const BLOCKS = new Set([
  "paragraph",
  "heading",
  "bulletList",
  "orderedList",
  "listItem",
  "blockquote",
  "codeBlock",
  "horizontalRule",
  "image",
  "blockMath",
]);
const INLINE = new Set(["text", "hardBreak", "inlineMath"]);
const LEAVES = new Set(["text", "hardBreak", "horizontalRule", "image", "inlineMath", "blockMath"]);
const MARKS = new Set(["bold", "italic", "strike", "underline", "code", "link"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class DocumentError extends Error {}

function fail(message) {
  throw new DocumentError(message);
}

/** Solo http(s) absoluto: bloquea javascript:, data:, vbscript: y rutas relativas. */
function safeHref(value) {
  if (typeof value !== "string" || value.length > MAX_URL) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\s]/.test(value)) return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  return url.toString();
}

function cleanMarks(marks) {
  if (marks === undefined) return undefined;
  if (!Array.isArray(marks)) fail("Marcas inválidas");
  const out = [];
  for (const mark of marks) {
    if (!mark || !MARKS.has(mark.type)) fail("Formato no permitido");
    if (mark.type === "link") {
      const href = safeHref(mark.attrs?.href);
      if (!href) fail("Enlace no permitido");
      out.push({ type: "link", attrs: { href } });
    } else {
      out.push({ type: mark.type });
    }
  }
  return out.length > 0 ? out : undefined;
}

function cleanLatex(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_LATEX) {
    fail("Fórmula inválida");
  }
  return value;
}

function cleanNode(node, depth, state) {
  if (!node || typeof node !== "object" || Array.isArray(node)) fail("Nodo inválido");
  if (depth > MAX_DEPTH) fail("El documento está demasiado anidado");
  state.nodes += 1;
  if (state.nodes > MAX_NODES) fail("El documento es demasiado grande");

  const { type } = node;
  if (!BLOCKS.has(type) && !INLINE.has(type)) fail("Contenido no permitido");

  if (type === "text") {
    if (typeof node.text !== "string" || node.text.length === 0) fail("Texto inválido");
    state.text += node.text.length;
    if (state.text > MAX_TEXT) fail("El texto es demasiado largo");
    const marks = cleanMarks(node.marks);
    return marks ? { type, text: node.text, marks } : { type, text: node.text };
  }

  const out = { type };

  if (type === "heading") {
    const level = node.attrs?.level;
    if (level !== 2 && level !== 3) fail("Nivel de título no permitido");
    out.attrs = { level };
  } else if (type === "orderedList") {
    const start = node.attrs?.start ?? 1;
    if (!Number.isInteger(start) || start < 1 || start > 10000) fail("Lista inválida");
    if (start !== 1) out.attrs = { start };
  } else if (type === "image") {
    const attachmentId = node.attrs?.attachmentId;
    if (typeof attachmentId !== "string" || !UUID.test(attachmentId)) fail("Imagen inválida");
    const alt = typeof node.attrs?.alt === "string" ? node.attrs.alt.slice(0, 300) : "";
    out.attrs = { attachmentId, alt };
    state.images.add(attachmentId);
  } else if (type === "inlineMath" || type === "blockMath") {
    const latex = cleanLatex(node.attrs?.latex);
    state.text += latex.length;
    if (state.text > MAX_TEXT) fail("El texto es demasiado largo");
    out.attrs = { latex };
  }

  if (LEAVES.has(type)) {
    if (node.content !== undefined && node.content.length > 0) fail("Nodo inválido");
    return out;
  }

  if (node.content !== undefined) {
    if (!Array.isArray(node.content)) fail("Nodo inválido");
    const content = node.content.map((child) => cleanNode(child, depth + 1, state));
    if (content.length > 0) out.content = content;
  }
  return out;
}

function collectText(node, parts) {
  if (node.type === "text") parts.push(node.text);
  else if (node.type === "hardBreak") parts.push(" ");
  else if (node.type === "inlineMath" || node.type === "blockMath") parts.push(node.attrs.latex);
  for (const child of node.content ?? []) collectText(child, parts);
  if (BLOCKS.has(node.type)) parts.push(" ");
}

/**
 * Devuelve `{ doc, text, imageIds }` con el documento reconstruido, su texto plano (para
 * extractos y correo) y los adjuntos que referencia. Lanza DocumentError si no es válido.
 */
function sanitizeDocument(input) {
  if (!input || typeof input !== "object" || input.type !== "doc" || !Array.isArray(input.content)) {
    fail("Documento inválido");
  }
  const state = { nodes: 0, text: 0, images: new Set() };
  const content = input.content.map((node) => {
    if (!BLOCKS.has(node?.type) || node.type === "listItem") fail("Contenido no permitido");
    return cleanNode(node, 1, state);
  });
  const doc = { type: "doc", content };
  const parts = [];
  collectText(doc, parts);
  const text = parts.join("").replace(/\s+/g, " ").trim();
  return { doc, text, imageIds: [...state.images] };
}

module.exports = { sanitizeDocument, safeHref, DocumentError, MAX_TEXT };
