// Reporting del proyecto (R1): archivo de hojas de cálculo y exportación a PDF.
//
// El archivo se llena solo: cada comprobación de conexión guardada (ConnectionRun) es
// una hoja. Aquí no se guarda nada aparte para el archivo; se lee de las ejecuciones,
// así no puede haber una hoja que no corresponda a un cálculo real.
//
// Exportar: el documento se arma AQUÍ desde las ejecuciones guardadas, el servicio
// report-renderer lo pagina y el PDF va a S3 con su huella. ReportExport guarda el
// documento exacto, las ejecuciones de origen y la versión del renderizador.
const axios = require("axios");
const crypto = require("node:crypto");
const { prisma } = require("../config/db");
const { env } = require("../config/env");
const { AppError } = require("../middleware/errorHandler");
const { isUuid, toApi } = require("../lib/ids");
const { orphanReasons } = require("../lib/connections");
const {
  archiveConnections,
  buildConnectionsDocument,
  connectionSnapshot,
  reportMeta,
  sha256,
} = require("../lib/reporting");
const s3Service = require("./s3Service");
const { fromCalcError } = require("./calcService");
const { runStaleReason } = require("./analysisService");
const {
  analysisSnapshot,
  analysisTitle,
  buildAnalysisDocument,
  buildMemoriaDocument,
  memoriaTitle,
  modelSummary,
} = require("../lib/reportingAnalysis");
const {
  archiveDesignRuns,
  buildMembersDocument,
  hasSheet,
  memberListRow,
  memberSnapshot,
  membersTitle,
} = require("../lib/reportingMembers");

const LOGO_TYPES = { "image/png": "png", "image/jpeg": "jpg" };
const MAX_SHEETS = 200;

// ─── Lecturas comunes ─────────────────────────────────────────────────────────────

async function latestSolvedRunId(projectId) {
  const run = await prisma.analysisRun.findFirst({
    where: { projectId, status: "solved" },
    orderBy: { startedAt: "desc" },
    select: { id: true },
  });
  return run?.id ?? null;
}

async function modelIndex(projectId) {
  const [nodes, elements] = await Promise.all([
    prisma.modelNode.findMany({ where: { projectId }, select: { id: true } }),
    prisma.modelElement.findMany({ where: { projectId }, select: { id: true, nodeA: true, nodeB: true } }),
  ]);
  return {
    nodeIds: new Set(nodes.map((n) => n.id)),
    elementsById: new Map(elements.map((e) => [e.id, e])),
  };
}

/** Conexiones del proyecto con sus motivos de orfandad. */
async function projectConnections(projectId) {
  const [rows, model] = await Promise.all([
    prisma.connection.findMany({
      where: { projectId },
      orderBy: { createdAt: "asc" },
      include: { members: { select: { elementId: true, end: true, role: true } } },
    }),
    modelIndex(projectId),
  ]);
  return rows.map((c) => ({ ...c, orphanReasons: orphanReasons(c, model) }));
}

/** Ejecuciones terminadas, SIN las entradas ni los resultados completos (solo lo que
 *  el archivo necesita): un proyecto con cientos de comprobaciones no debe arrastrar
 *  megabytes de JSON para pintar una lista. */
async function doneRunSummaries(connectionIds) {
  if (connectionIds.length === 0) return [];
  const rows = await prisma.$queryRaw`
    SELECT "id", "connectionId", "createdAt", "engineVersion", "analysisRunId",
           "inputsHash", "code", "method",
           "results"->>'status' AS "result", "results"->'governing' AS "governing"
      FROM "connection_runs"
     WHERE "connectionId" = ANY(${connectionIds}::uuid[]) AND "status" = 'done'
     ORDER BY "createdAt" DESC`;
  return rows;
}

const exportToApi = (row) => {
  // Ni el documento (pesado; está en la fila para trazabilidad) ni la clave S3 interna.
  const { document, s3Key, ...rest } = row;
  return toApi(rest, "reportExport");
};

// ─── Archivo ──────────────────────────────────────────────────────────────────────

async function archive(project) {
  const connections = await projectConnections(project.id);
  const [runs, solvedId, exports] = await Promise.all([
    doneRunSummaries(connections.map((c) => c.id)),
    latestSolvedRunId(project.id),
    prisma.reportExport.findMany({
      where: { projectId: project.id },
      orderBy: { createdAt: "desc" },
      take: 50,
      omit: { document: true },
    }),
  ]);
  const archived = archiveConnections(connections, runs, { latestSolvedRunId: solvedId });
  const latest = archived.map((c) => c.latest).filter(Boolean);
  return {
    analysis: await analysisArchive(project.id),
    designRuns: await designRunArchive(project.id, solvedId),
    connections: archived,
    counts: {
      connections: archived.length,
      checked: latest.length,
      current: latest.filter((e) => e.state === "current").length,
      stale: latest.filter((e) => e.state === "stale").length,
    },
    exports: exports.map(exportToApi),
    logo: !!project.logoKey,
  };
}

/** Una hoja del archivo: la instantánea de una comprobación, para verla en la app. */
async function connectionSheet(project, runId) {
  if (!isUuid(runId)) throw new AppError(404, "Comprobación no encontrada.");
  const run = await prisma.connectionRun.findFirst({
    where: { id: runId, status: "done", connection: { projectId: project.id } },
    include: { connection: true },
  });
  if (!run) throw new AppError(404, "Comprobación no encontrada.");
  const snapshot = connectionSnapshot(run.connection, run);
  return { snapshot, snapshotHash: sha256(snapshot) };
}

// ─── Exportar ─────────────────────────────────────────────────────────────────────

/**
 * Qué hojas entran en el PDF.
 *   currentConnections: la última comprobación VIGENTE de cada conexión (las
 *     desactualizadas no entran: hay que volver a comprobarlas).
 *   runs: las comprobaciones pedidas, en ese orden; una que ya no es vigente sale con
 *     un aviso delante.
 */
async function selectSheets(project, { scope, runIds }) {
  const connections = await projectConnections(project.id);
  const [runs, solvedId] = await Promise.all([
    doneRunSummaries(connections.map((c) => c.id)),
    latestSolvedRunId(project.id),
  ]);
  const archived = archiveConnections(connections, runs, { latestSolvedRunId: solvedId });
  const entries = new Map();
  for (const c of archived) for (const e of [c.latest, ...c.history].filter(Boolean)) entries.set(e.runId, e);

  let chosen;
  if (scope === "currentConnections") {
    chosen = archived.map((c) => c.latest).filter((e) => e && e.state === "current");
    if (chosen.length === 0) {
      throw new AppError(409, "No hay comprobaciones de conexiones vigentes para exportar.");
    }
  } else {
    const unknown = runIds.filter((id) => !entries.has(id));
    if (unknown.length) throw new AppError(404, "Alguna comprobación no existe en este proyecto.", { runIds: unknown });
    chosen = [...new Set(runIds)].map((id) => entries.get(id));
  }
  if (chosen.length > MAX_SHEETS) throw new AppError(413, `Como máximo ${MAX_SHEETS} hojas por documento.`);

  const full = await prisma.connectionRun.findMany({
    where: { id: { in: chosen.map((e) => e.runId) } },
    include: { connection: true },
  });
  const byId = new Map(full.map((r) => [r.id, r]));
  return chosen.map((e) => {
    const run = byId.get(e.runId);
    return {
      snapshot: connectionSnapshot(run.connection, run),
      staleReasons: e.state === "current" ? [] : e.state === "stale" ? e.staleReasons : ["run.superseded"],
    };
  });
}

async function logoDataUri(project) {
  if (!project.logoKey) return null;
  try {
    const buf = await s3Service.getObjectBuffer(project.logoKey);
    const type = project.logoKey.endsWith(".png") ? "image/png" : "image/jpeg";
    return `data:${type};base64,${buf.toString("base64")}`;
  } catch {
    return null; // sin logo antes que sin PDF
  }
}

async function render(document, meta, { lang, unitSystemId }) {
  if (!env.rendererToken) throw new AppError(503, "El generador de PDF no está configurado (falta RENDERER_TOKEN).");
  try {
    const res = await axios.post(
      `${env.rendererUrl}/render`,
      { document, meta, lang, unitSystemId },
      {
        headers: { Authorization: `Bearer ${env.rendererToken}` },
        responseType: "arraybuffer",
        timeout: 180000,
        maxBodyLength: 30 * 1024 * 1024,
      }
    );
    return {
      pdf: Buffer.from(res.data),
      pages: Number(res.headers["x-pages"]) || null,
      rendererVersion: res.headers["x-renderer-version"] || null,
    };
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (!err.response) throw new AppError(502, `No se pudo contactar el generador de PDF (${err.code || err.message}).`);
    let message = `El generador de PDF respondió ${err.response.status}.`;
    try {
      message = JSON.parse(Buffer.from(err.response.data).toString("utf8")).message || message;
    } catch {}
    throw new AppError(502, message);
  }
}

async function exportPdf(project, body) {
  if (body.scope === "currentMembers" || body.scope === "designRun") return exportMembers(project, body);
  if (body.scope === "analysis") return exportAnalysis(project, body);
  if (body.scope === "memoria") return exportMemoria(project, body);
  const { scope, runIds = [], lang = "es", title, unitSystemId } = body;
  const sheets = await selectSheets(project, { scope, runIds });
  const document = buildConnectionsDocument(sheets, lang);
  return renderAndStore(project, {
    kind: "connections",
    title,
    lang,
    unitSystemId,
    runIds: sheets.map((s) => s.snapshot.run.id),
    document,
  });
}

/** Pagina el documento, guarda el PDF en S3 y registra la exportación (también la
 *  fallida, con su error). */
async function renderAndStore(project, { kind, title, lang, unitSystemId, runIds, document, reportId = null }) {
  const units = unitSystemId ?? project.units ?? null;
  const meta = reportMeta(project, { title, lang, logoDataUri: await logoDataUri(project) });
  const base = {
    projectId: project.id,
    kind,
    title: meta.title,
    lang,
    unitSystemId: units,
    runIds,
    document,
    documentHash: sha256(document),
    ...(reportId ? { reportId } : {}),
  };

  let rendered;
  try {
    rendered = await render(document, meta, { lang, unitSystemId: units });
  } catch (err) {
    await prisma.reportExport.create({ data: { ...base, status: "error", error: err.message } });
    throw err;
  }

  const id = crypto.randomUUID();
  const key = `${s3Service.reportsPrefix(project.id)}/exports/${id}.pdf`;
  await s3Service.putObject(key, rendered.pdf, "application/pdf");
  const row = await prisma.reportExport.create({
    data: {
      ...base,
      id,
      s3Key: key,
      sha256: sha256(rendered.pdf),
      bytes: rendered.pdf.length,
      pages: rendered.pages,
      rendererVersion: rendered.rendererVersion,
    },
    omit: { document: true },
  });
  return exportToApi(row);
}

// ─── Miembros (R2) ────────────────────────────────────────────────────────────────

const DESIGN_RUN_SELECT = {
  id: true, startedAt: true, finishedAt: true, analysisRunId: true, code: true,
  steelCode: true, counts: true, summary: true, schemaVersion: true,
};

async function designRunArchive(projectId, solvedId) {
  const runs = await prisma.designRun.findMany({
    where: { projectId, status: "done" },
    orderBy: { startedAt: "desc" },
    select: DESIGN_RUN_SELECT,
  });
  if (runs.length === 0) return [];
  // ¿La última sigue siendo del modelo? Solo si se hizo con el análisis vigente y ese
  // análisis es del modelo actual (un cambio de sección o de geometría lo invalida).
  const latestStaleReason =
    solvedId && runs[0].analysisRunId === solvedId ? await runStaleReason(projectId, solvedId) : null;
  return archiveDesignRuns(runs, { latestSolvedRunId: solvedId, latestStaleReason });
}

async function findDesignRun(project, designRunId) {
  if (!isUuid(designRunId)) throw new AppError(404, "Comprobación de diseño no encontrada.");
  const run = await prisma.designRun.findFirst({
    where: { id: designRunId, projectId: project.id, status: "done" },
    select: DESIGN_RUN_SELECT,
  });
  if (!run) throw new AppError(404, "Comprobación de diseño no encontrada.");
  if ((run.schemaVersion ?? 0) < 2) {
    throw new AppError(409, "Esta comprobación es anterior a las hojas de cálculo. Vuelve a comprobar el diseño.");
  }
  return run;
}

/** Lo que el motor guardó de una ejecución de diseño (solo lectura). */
async function designSheets(project, designRunId, { elementIds = null, summaryOnly = false } = {}) {
  try {
    const { data } = await axios.post(
      `${env.calcServiceUrl}/design/sheets`,
      {
        storage: { projectId: String(project.id), runId: String(designRunId), bucket: env.s3Bucket, prefix: env.s3Prefix },
        elementIds,
        summaryOnly,
      },
      { timeout: 60000 }
    );
    return data;
  } catch (err) {
    if (err.response?.status === 404) throw new AppError(404, "No se encontraron los resultados de esta comprobación de diseño.");
    throw fromCalcError(err);
  }
}

async function designRunMembers(project, designRunId) {
  await findDesignRun(project, designRunId);
  const sheets = await designSheets(project, designRunId, { summaryOnly: true });
  return { members: (sheets.members || []).map((m) => ({ ...memberListRow(m), hasSheet: hasSheet(m) })) };
}

async function memberSheet(project, designRunId, elementId) {
  const run = await findDesignRun(project, designRunId);
  const sheets = await designSheets(project, designRunId, { elementIds: [elementId] });
  const snapshot = memberSnapshot(sheets, elementId, run);
  if (!snapshot) throw new AppError(404, "Esta barra no tiene hoja de cálculo en esta comprobación.");
  return { snapshot, snapshotHash: sha256(snapshot) };
}

async function exportMembers(project, { scope, designRunId, elementIds, lang = "es", title, unitSystemId }) {
  const archive = await designRunArchive(project.id, await latestSolvedRunId(project.id));
  let entry;
  if (scope === "currentMembers") {
    entry = archive[0];
    if (!entry || entry.state !== "current") {
      throw new AppError(409, "No hay una comprobación de diseño vigente para exportar.");
    }
  } else {
    entry = archive.find((e) => e.designRunId === designRunId);
    if (!entry) throw new AppError(404, "Comprobación de diseño no encontrada.");
  }
  const run = await findDesignRun(project, entry.designRunId);
  const sheets = await designSheets(project, run.id, { elementIds: elementIds?.length ? elementIds : null });
  const ids = elementIds?.length ? elementIds : (sheets.members || []).filter(hasSheet).map((m) => m.elementId);
  const snapshots = ids.map((id) => memberSnapshot(sheets, id, run)).filter(Boolean);
  if (snapshots.length === 0) throw new AppError(409, "Ninguna de las barras pedidas tiene hoja de cálculo.");
  if (snapshots.length > MAX_SHEETS) {
    throw new AppError(413, `La comprobación tiene ${snapshots.length} barras: elige como máximo ${MAX_SHEETS} para un documento.`);
  }
  const staleReasons = entry.state === "current" ? [] : entry.state === "stale" ? entry.staleReasons : ["run.superseded"];
  const document = buildMembersDocument(snapshots, { lang, staleReasons });
  return renderAndStore(project, {
    kind: "members",
    title: title || membersTitle(lang),
    lang,
    unitSystemId,
    runIds: [run.id],
    document,
  });
}

// ─── Análisis y memoria (R3) ──────────────────────────────────────────────────────

const ANALYSIS_RUN_SELECT = {
  id: true, solvedAt: true, startedAt: true, schemaVersion: true, activeDofs: true, notes: true,
  cases: true, counts: true, modes: true, summary: true, stories: true, modelHash: true,
};

/** El último análisis resuelto y si es del modelo actual. */
async function currentAnalysis(projectId) {
  const run = await prisma.analysisRun.findFirst({
    where: { projectId, status: "solved" },
    orderBy: { startedAt: "desc" },
    select: ANALYSIS_RUN_SELECT,
  });
  if (!run) return { run: null, staleReason: "analysis.missing" };
  return { run, staleReason: await runStaleReason(projectId, run.id) };
}

async function analysisArchive(projectId) {
  const { run, staleReason } = await currentAnalysis(projectId);
  if (!run) return null;
  return {
    kind: "analysisRun",
    analysisRunId: run.id,
    solvedAt: (run.solvedAt || run.startedAt).toISOString(),
    state: staleReason ? "stale" : "current",
    staleReasons: staleReason ? ["model.changed"] : [],
    counts: run.counts || {},
    cases: (run.cases || []).map((c) => ({ name: c.name, kind: c.kind || "pattern" })),
    modes: (run.modes || []).length,
  };
}

/** Datos del modelo ACTUAL (solo se usan si el análisis es de este modelo). */
async function currentModelSummary(projectId) {
  const [nodes, supports, areas, elements, configuration] = await Promise.all([
    prisma.modelNode.count({ where: { projectId } }),
    prisma.modelSupport.count({ where: { projectId } }),
    prisma.modelArea.count({ where: { projectId } }),
    prisma.modelElement.findMany({ where: { projectId }, select: { frameSectionId: true } }),
    prisma.modelConfiguration.findUnique({
      where: { projectId },
      select: { loadPatterns: true, loadCombinations: true },
    }),
  ]);
  const sectionIds = [...new Set(elements.map((e) => e.frameSectionId).filter(isUuid))];
  const sections = sectionIds.length
    ? await prisma.catalogFrameSection.findMany({
        where: { id: { in: sectionIds } },
        select: { id: true, name: true, materialId: true, source: true, reinforcement: true },
      })
    : [];
  const materialIds = new Set();
  for (const sct of sections) {
    if (isUuid(sct.materialId)) materialIds.add(sct.materialId);
    if (isUuid(sct.reinforcement?.rebarMaterialId)) materialIds.add(sct.reinforcement.rebarMaterialId);
  }
  const materials = materialIds.size
    ? await prisma.catalogMaterial.findMany({
        where: { id: { in: [...materialIds] } },
        select: { id: true, name: true, type: true, E: true, Fy: true, Fu: true, fc: true },
      })
    : [];
  return modelSummary({ nodes, elements, supports, areas, sections, materials, configuration });
}

async function analysisSheets(projectId, runId) {
  try {
    const { data } = await axios.post(
      `${env.calcServiceUrl}/analysis/sheets`,
      { storage: { projectId: String(projectId), runId: String(runId), bucket: env.s3Bucket, prefix: env.s3Prefix }, maxRows: 500 },
      { timeout: 60000 }
    );
    return data;
  } catch (err) {
    if (err.response?.status === 404) throw new AppError(404, "No se encontraron los resultados de este análisis.");
    throw fromCalcError(err);
  }
}

/** Instantánea del análisis vigente. 409 si no lo hay o no es del modelo actual. */
async function currentAnalysisSnapshot(project) {
  const { run, staleReason } = await currentAnalysis(project.id);
  if (!run) throw new AppError(409, "No hay un análisis resuelto. Lanza primero el análisis.");
  if (staleReason) {
    throw new AppError(409, "El análisis no corresponde al modelo actual: vuelve a analizar para documentarlo.");
  }
  const [sheets, model] = await Promise.all([analysisSheets(project.id, run.id), currentModelSummary(project.id)]);
  return analysisSnapshot({ run, sheets, model });
}

async function analysisSheet(project) {
  const snapshot = await currentAnalysisSnapshot(project);
  return { snapshot, snapshotHash: sha256(snapshot) };
}

async function exportAnalysis(project, { lang = "es", title, unitSystemId }) {
  const snapshot = await currentAnalysisSnapshot(project);
  return renderAndStore(project, {
    kind: "analysis",
    title: title || analysisTitle(lang),
    lang,
    unitSystemId,
    runIds: [snapshot.run.id],
    document: buildAnalysisDocument(snapshot, lang),
  });
}

/**
 * Memoria del proyecto con todo lo VIGENTE: análisis, miembros (todas las hojas si
 * caben; si no, el resumen completo y las hojas de las que no cumplen o están
 * incompletas) y conexiones. Lo que no está vigente no entra: su capítulo lo avisa.
 */
async function exportMemoria(project, { lang = "es", title, unitSystemId }) {
  const { document, runIds, empty } = await buildMemoria(project, lang);
  if (empty) {
    throw new AppError(409, "No hay nada vigente que documentar: analiza y comprueba el proyecto primero.");
  }
  return renderAndStore(project, {
    kind: "memoria",
    title: title || memoriaTitle(lang),
    lang,
    unitSystemId,
    runIds,
    document,
  });
}

/** La memoria con todo lo vigente (también sirve de plantilla de un documento). */
async function buildMemoria(project, lang = "es") {
  const runIds = [];
  let analysis = null;
  try {
    analysis = await currentAnalysisSnapshot(project);
    runIds.push(analysis.run.id);
  } catch (err) {
    if (!(err instanceof AppError) || err.status !== 409) throw err;
  }

  let members = null;
  const solvedId = await latestSolvedRunId(project.id);
  const designArchive = await designRunArchive(project.id, solvedId);
  const latestDesign = designArchive[0];
  if (latestDesign && latestDesign.state === "current" && latestDesign.sheetsAvailable) {
    const run = await findDesignRun(project, latestDesign.designRunId);
    const summary = await designSheets(project, run.id, { summaryOnly: true });
    const rows = (summary.members || []).map((m) => ({ ...memberListRow(m), hasSheet: hasSheet(m) }));
    let ids = rows.filter((m) => m.hasSheet).map((m) => m.elementId);
    const tooMany = ids.length > MAX_SHEETS;
    if (tooMany) {
      ids = rows
        .filter((m) => m.hasSheet && (m.status === "overstressed" || m.verification === "incomplete"))
        .map((m) => m.elementId)
        .slice(0, MAX_SHEETS);
    }
    const sheets = ids.length ? await designSheets(project, run.id, { elementIds: ids }) : { members: [] };
    const snapshots = ids.map((id) => memberSnapshot(sheets, id, run)).filter(Boolean);
    members = {
      document: buildMembersDocument(snapshots, { lang, summaryRows: rows }),
      count: snapshots.length,
      all: !tooMany,
      tooMany,
    };
    runIds.push(run.id);
  }

  let connections = null;
  try {
    const sheets = await selectSheets(project, { scope: "currentConnections" });
    connections = { document: buildConnectionsDocument(sheets, lang), count: sheets.length };
    runIds.push(...sheets.map((x) => x.snapshot.run.id));
  } catch (err) {
    if (!(err instanceof AppError) || err.status !== 409) throw err;
  }

  return {
    document: buildMemoriaDocument({ analysis, members, connections, lang }),
    runIds,
    empty: !analysis && !members && !connections,
  };
}

/** Estado de vigencia de cada comprobación (para avisar en los documentos). */
async function archiveStates(project) {
  const connections = await projectConnections(project.id);
  const [runs, solvedId] = await Promise.all([
    doneRunSummaries(connections.map((c) => c.id)),
    latestSolvedRunId(project.id),
  ]);
  const states = new Map();
  for (const c of archiveConnections(connections, runs, { latestSolvedRunId: solvedId })) {
    for (const e of [c.latest, ...c.history].filter(Boolean)) states.set(`c:${e.runId}`, { state: e.state, staleReasons: e.staleReasons });
  }
  for (const r of await designRunArchive(project.id, solvedId)) {
    states.set(`d:${r.designRunId}`, { state: r.state, staleReasons: r.staleReasons });
  }
  return states;
}

const safeName = (s) => s.normalize("NFKD").replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "report";

async function exportDownload(project, exportId) {
  if (!isUuid(exportId)) throw new AppError(404, "Exportación no encontrada.");
  const row = await prisma.reportExport.findFirst({
    where: { id: exportId, projectId: project.id, status: "done" },
    omit: { document: true },
  });
  if (!row?.s3Key) throw new AppError(404, "Exportación no encontrada.");
  const date = row.createdAt.toISOString().slice(0, 10);
  return { url: await s3Service.signGet(row.s3Key, { filename: `${safeName(project.name)}_${safeName(row.title)}_${date}.pdf` }) };
}

// ─── Logo del proyecto ────────────────────────────────────────────────────────────

/** URL para que el navegador suba el logo directo a S3 (como los adjuntos del chat). */
async function logoUploadUrl(project, { contentType, bytes }) {
  const ext = LOGO_TYPES[contentType];
  if (!ext) throw new AppError(400, "El logo debe ser PNG o JPEG.");
  if (!(bytes > 0 && bytes <= env.logoMaxBytes)) {
    throw new AppError(413, `El logo no puede pasar de ${Math.round(env.logoMaxBytes / 1024)} KB.`);
  }
  const key = `${s3Service.reportsPrefix(project.id)}/logo/${crypto.randomUUID()}.${ext}`;
  return { key, url: await s3Service.signPut(key, contentType) };
}

// PNG: 89 50 4E 47; JPEG: FF D8 FF.
const looksLike = (buf, ext) =>
  ext === "png"
    ? buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47
    : buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;

/** Confirma el logo subido: debe estar bajo el prefijo del proyecto y ser la imagen que dice. */
async function setLogo(project, { key }) {
  const prefix = `${s3Service.reportsPrefix(project.id)}/logo/`;
  const ext = key.split(".").pop();
  if (!key.startsWith(prefix) || !["png", "jpg"].includes(ext) || key.includes("..")) {
    throw new AppError(400, "Clave de logo no válida.");
  }
  let buf;
  try {
    buf = await s3Service.getObjectBuffer(key);
  } catch {
    throw new AppError(404, "No se encontró el logo subido.");
  }
  if (buf.length > env.logoMaxBytes || !looksLike(buf, ext)) {
    await deleteKey(key);
    throw new AppError(400, "El archivo no es una imagen PNG/JPEG válida o es demasiado grande.");
  }
  const old = project.logoKey;
  await prisma.project.update({ where: { id: project.id }, data: { logoKey: key } });
  if (old && old !== key) await deleteKey(old);
  return { logo: true, url: await s3Service.signGet(key) };
}

async function deleteKey(key) {
  // Best-effort: si falla, el objeto queda huérfano bajo reports/{proyecto}/ y se va al
  // borrar el proyecto.
  await s3Service.deleteObject(key).catch(() => {});
}

async function getLogo(project) {
  if (!project.logoKey) return { logo: false, url: null };
  return { logo: true, url: await s3Service.signGet(project.logoKey) };
}

async function removeLogo(project) {
  if (project.logoKey) {
    await prisma.project.update({ where: { id: project.id }, data: { logoKey: null } });
    await deleteKey(project.logoKey);
  }
  return { logo: false, url: null };
}

module.exports = {
  // Para los documentos de Report Studio (reportDocumentService).
  internals: {
    connectionSheet: (project, runId) => connectionSheet(project, runId),
    memberSheet: (project, designRunId, elementId) => memberSheet(project, designRunId, elementId),
    currentAnalysisSnapshot: (project) => currentAnalysisSnapshot(project),
    archiveStates: (project) => archiveStates(project),
    buildMemoria: (project, lang) => buildMemoria(project, lang),
    renderAndStore: (project, opts) => renderAndStore(project, opts),
  },
  archive,
  analysisSheet,
  connectionSheet,
  designRunMembers,
  memberSheet,
  exportPdf,
  exportDownload,
  logoUploadUrl,
  setLogo,
  getLogo,
  removeLogo,
};
