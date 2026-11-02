// Tipos de archivo admitidos en la Comunidad. Es una lista permitida, no una de bloqueo:
// los adjuntos son descargas públicas. El tipo que ve el navegador lo fija siempre este
// servidor por la extensión validada, nunca el que declare el cliente.

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_FILES_PER_POST = 5;
/** Bytes del inicio del archivo que se leen para comprobar su contenido. */
const SNIFF_BYTES = 4096;

const OOXML_DOC = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const OOXML_XLS = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const TYPES = {
  png: { mime: "image/png", kind: "image" },
  jpg: { mime: "image/jpeg", kind: "image" },
  jpeg: { mime: "image/jpeg", kind: "image" },
  webp: { mime: "image/webp", kind: "image" },
  pdf: { mime: "application/pdf", kind: "file" },
  docx: { mime: OOXML_DOC, kind: "file" },
  xlsx: { mime: OOXML_XLS, kind: "file" },
  csv: { mime: "text/csv", kind: "file" },
  txt: { mime: "text/plain", kind: "file" },
  dwg: { mime: "application/acad", kind: "file" },
  dxf: { mime: "application/dxf", kind: "file" },
};

function extensionOf(name) {
  const match = /\.([a-z0-9]{1,8})$/i.exec(String(name).trim());
  return match ? match[1].toLowerCase() : "";
}

/** Tipo admitido para un nombre de archivo, o null. */
function resolveType(name) {
  const extension = extensionOf(name);
  const type = TYPES[extension];
  return type ? { extension, ...type } : null;
}

/** Nombre visible: sin rutas, caracteres de control ni separadores. */
function cleanFileName(name) {
  const base = String(name).split(/[\\/]/).pop() ?? "";
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return cleaned.slice(-160);
}

const startsWith = (buffer, bytes, offset = 0) =>
  buffer.length >= offset + bytes.length && bytes.every((b, i) => buffer[offset + i] === b);

const ascii = (buffer, start, end) => buffer.subarray(start, end).toString("latin1");

/** ¿Parece texto? Sin bytes nulos ni marcado que un navegador pudiera interpretar. */
function isPlainText(buffer) {
  if (buffer.includes(0)) return false;
  const head = buffer.subarray(0, 512).toString("utf8").trimStart().toLowerCase();
  return !/^(<!doctype|<html|<script|<svg|<\?xml|<\?php|#!)/.test(head);
}

/** Comprueba que el contenido real corresponde a la extensión declarada. */
function contentMatches(extension, buffer) {
  switch (extension) {
    case "png":
      return startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "jpg":
    case "jpeg":
      return startsWith(buffer, [0xff, 0xd8, 0xff]);
    case "webp":
      return ascii(buffer, 0, 4) === "RIFF" && ascii(buffer, 8, 12) === "WEBP";
    case "pdf":
      return ascii(buffer, 0, 5) === "%PDF-";
    case "docx":
    case "xlsx":
      // Un OOXML es un ZIP. La extensión evita abrir macros: Office rechaza un .docx/.xlsx
      // que contenga VBA, y .docm/.xlsm no están admitidos.
      return startsWith(buffer, [0x50, 0x4b, 0x03, 0x04]);
    case "dwg":
      return /^AC10\d\d/.test(ascii(buffer, 0, 6));
    case "dxf":
    case "csv":
    case "txt":
      return isPlainText(buffer);
    default:
      return false;
  }
}

module.exports = {
  TYPES,
  MAX_FILE_BYTES,
  MAX_FILES_PER_POST,
  SNIFF_BYTES,
  extensionOf,
  resolveType,
  cleanFileName,
  contentMatches,
};
