// Reporting R4: documentos de Report Studio (los que compone el usuario).
//
// El documento se guarda tal cual lo produce el editor (formato v1). Sus bloques
// técnicos no se creen hasta exportar: `exportDocument` reconstruye cada uno en el
// servidor desde su vínculo y solo pagina si las huellas coinciden (lib/reportDocuments).
const { prisma } = require("../config/db");
const { AppError } = require("../middleware/errorHandler");
const { isUuid, toApi } = require("../lib/ids");
const { sha256 } = require("../lib/reporting");
const {
  blankDocument,
  bindingKey,
  templateBlocks,
  technicalBlocks,
  validateDocument,
  verifyDocument,
  warningText,
} = require("../lib/reportDocuments");
const reporting = require("./reportingService");

const { internals } = reporting;

const LIST_SELECT = { id: true, title: true, lang: true, version: true, createdAt: true, updatedAt: true };

const reportToApi = (row) => toApi(row, "report");

async function findReport(project, reportId, select) {
  if (!isUuid(reportId)) throw new AppError(404, "Documento no encontrado.");
  const row = await prisma.report.findFirst({ where: { id: reportId, projectId: project.id }, ...(select ? { select } : {}) });
  if (!row) throw new AppError(404, "Documento no encontrado.");
  return row;
}

function checkDocument(document) {
  const error = validateDocument(document);
  if (error) throw new AppError(400, `Documento no válido: ${error}`);
}

async function list(project) {
  const rows = await prisma.report.findMany({
    where: { projectId: project.id },
    orderBy: { updatedAt: "desc" },
    select: { ...LIST_SELECT, _count: { select: { revisions: true } } },
  });
  return rows.map(({ _count, ...r }) => ({ ...reportToApi(r), revisions: _count.revisions }));
}

/** Nuevo documento: en blanco o desde la plantilla "memoria" (todo lo vigente). */
async function create(project, { title, lang = "es", template = "blank" }) {
  let document = blankDocument(title);
  if (template === "memoria") {
    const memo = await internals.buildMemoria(project, lang);
    if (memo.empty) {
      throw new AppError(409, "No hay nada vigente para la plantilla de memoria: analiza y comprueba el proyecto primero.");
    }
    document = {
      version: 1,
      blocks: [{ id: "h-title", type: "heading", level: 1, content: [{ text: title }] }, ...templateBlocks(memo.document.blocks)],
    };
  }
  checkDocument(document);
  const row = await prisma.report.create({ data: { projectId: project.id, title, lang, document } });
  return reportToApi(row);
}

async function getOne(project, reportId) {
  return reportToApi(await findReport(project, reportId));
}

/**
 * Autoguardado con control de concurrencia: `version` es la que el cliente tenía. Si otra
 * pestaña guardó entretanto, 409 (el cliente recarga en vez de pisar el trabajo ajeno).
 */
async function update(project, reportId, { title, lang, document, version }) {
  await findReport(project, reportId, { id: true });
  if (document !== undefined) checkDocument(document);
  const { count } = await prisma.report.updateMany({
    where: { id: reportId, projectId: project.id, version },
    data: {
      ...(title !== undefined ? { title } : {}),
      ...(lang !== undefined ? { lang } : {}),
      ...(document !== undefined ? { document } : {}),
      version: { increment: 1 },
    },
  });
  if (count === 0) {
    throw new AppError(409, "El documento cambió en otra ventana. Recarga para seguir.", { error: "report.versionConflict" });
  }
  const row = await findReport(project, reportId, LIST_SELECT);
  return reportToApi(row);
}

async function remove(project, reportId) {
  await findReport(project, reportId, { id: true });
  await prisma.report.delete({ where: { id: reportId } });
  return { deleted: true };
}

// ─── Revisiones ───────────────────────────────────────────────────────────────────

async function listRevisions(project, reportId) {
  await findReport(project, reportId, { id: true });
  const rows = await prisma.reportRevision.findMany({
    where: { reportId },
    orderBy: { number: "desc" },
    select: { id: true, number: true, name: true, documentHash: true, createdAt: true },
  });
  return rows.map((r) => toApi(r, "reportRevision"));
}

async function createRevision(project, reportId, { name }) {
  const report = await findReport(project, reportId);
  const last = await prisma.reportRevision.findFirst({ where: { reportId }, orderBy: { number: "desc" }, select: { number: true } });
  const row = await prisma.reportRevision.create({
    data: {
      reportId,
      number: (last?.number ?? 0) + 1,
      name,
      document: report.document,
      documentHash: sha256(report.document),
    },
    select: { id: true, number: true, name: true, documentHash: true, createdAt: true },
  });
  return toApi(row, "reportRevision");
}

async function getRevision(project, reportId, revisionId) {
  await findReport(project, reportId, { id: true });
  if (!isUuid(revisionId)) throw new AppError(404, "Revisión no encontrada.");
  const row = await prisma.reportRevision.findFirst({ where: { id: revisionId, reportId } });
  if (!row) throw new AppError(404, "Revisión no encontrada.");
  return toApi(row, "reportRevision");
}

// ─── Bloques técnicos: instantánea del servidor ───────────────────────────────────

/** Reconstruye en el servidor la instantánea de cada bloque técnico (una vez por dato). */
async function serverSnapshots(project, document) {
  const states = await internals.archiveStates(project);
  const out = new Map();
  let analysis; // se calcula como mucho una vez
  for (const b of technicalBlocks(document)) {
    const key = bindingKey(b);
    if (!key || out.has(key)) continue;
    try {
      if (b.type === "connectionCheck") {
        const { snapshot } = await internals.connectionSheet(project, b.binding.runId);
        // Sin estado conocido no se supone vigente.
        out.set(key, { snapshot, ...(states.get(`c:${b.binding.runId}`) || { state: "stale", staleReasons: ["state.unknown"] }) });
      } else if (b.type === "memberCheck") {
        const { snapshot } = await internals.memberSheet(project, b.binding.designRunId, b.binding.elementId);
        out.set(key, { snapshot, ...(states.get(`d:${b.binding.designRunId}`) || { state: "stale", staleReasons: ["state.unknown"] }) });
      } else if (b.type === "analysisSummary") {
        if (analysis === undefined) {
          analysis = await internals.currentAnalysisSnapshot(project).catch((err) => {
            if (err instanceof AppError && err.status === 409) return null;
            throw err;
          });
        }
        // Solo se documenta el análisis vigente del modelo actual.
        if (!analysis || analysis.run.id !== b.binding.analysisRunId) out.set(key, { error: "stale" });
        else out.set(key, { snapshot: analysis, state: "current" });
      }
    } catch (err) {
      if (err instanceof AppError && (err.status === 404 || err.status === 409)) out.set(key, { error: "missing" });
      else throw err;
    }
  }
  return out;
}

/** Comprueba los bloques del documento guardado sin exportar (para avisar en el editor). */
async function verify(project, reportId) {
  const report = await findReport(project, reportId);
  const server = await serverSnapshots(project, report.document);
  const { problems } = verifyDocument(report.document, server, { warningText: warningText(report.lang) });
  const states = technicalBlocks(report.document).map((b) => {
    const got = server.get(bindingKey(b));
    return { blockId: b.id, state: got?.error ? got.error : got?.state ?? "missing", staleReasons: got?.staleReasons || [] };
  });
  return { problems, blocks: states };
}

async function exportDocument(project, reportId, { unitSystemId, revisionId } = {}) {
  const report = await findReport(project, reportId);
  let source = report.document;
  let title = report.title;
  if (revisionId) {
    const rev = await getRevision(project, reportId, revisionId);
    source = rev.document;
    title = `${report.title} — ${rev.name}`;
  }
  const server = await serverSnapshots(project, source);
  const { document, problems } = verifyDocument(source, server, { warningText: warningText(report.lang) });
  if (problems.length) {
    throw new AppError(409, "Hay bloques técnicos que no coinciden con los datos guardados: actualízalos antes de exportar.", {
      error: "report.blocksOutOfDate",
      problems,
    });
  }
  return internals.renderAndStore(project, {
    kind: "document",
    title,
    lang: report.lang,
    unitSystemId,
    // Mismo criterio que el resto de exportaciones: ids de ejecución sin prefijo.
    runIds: [...new Set(technicalBlocks(document).map((b) => b.binding.runId || b.binding.designRunId || b.binding.analysisRunId))],
    document,
    reportId,
  });
}

module.exports = {
  list,
  create,
  getOne,
  update,
  remove,
  listRevisions,
  createRevision,
  getRevision,
  verify,
  exportDocument,
};
