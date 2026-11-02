const community = require("./communityService");
const attachments = require("./communityAttachmentService");
const emails = require("./communityEmailService");

const MINUTE = 60 * 1000;

function guarded(name, job) {
  return () => job().catch((err) => console.error(`[community] ${name}:`, err.message));
}

/** Crea el catálogo inicial y arranca las tareas periódicas de la Comunidad. */
async function startCommunity() {
  await community.ensureCatalog();
  setInterval(guarded("avisos", () => emails.processOutbox()), MINUTE).unref();
  setInterval(guarded("escaneo", () => attachments.refreshPending()), MINUTE).unref();
  setInterval(guarded("limpieza", () => attachments.cleanupOrphans()), 60 * MINUTE).unref();
}

module.exports = { startCommunity };
