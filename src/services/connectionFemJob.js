// Job CBFEM de una conexión (Fase 3), en segundo plano.
//
// Espejo de `designJob`: el trabajo pesado (mallar y resolver con CalculiX) lo hace el
// calc-service; aquí solo se mantiene abierto su stream NDJSON, se guarda el avance en
// la ejecución (`connection_runs.progress`, como mucho una vez por segundo) y, al final,
// el manifiesto. La malla y los campos por combinación los escribe el calc-service en
// S3 bajo el prefijo de esta ejecución.
//
// Una conexión no bloquea nada: el modelo sigue editable mientras se analiza. Si la
// conexión cambia durante el análisis, la ejecución sale desactualizada (`stale`).
//
// Limitación aceptada (la misma que el análisis y el diseño): un reinicio del servidor a
// mitad de un análisis lo deja huérfano. `get` lo detecta por el latido del avance.

const { prisma } = require("../config/db");
const { connectionCbfemStream } = require("./calcService");
const { progressThrottle } = require("../lib/progressThrottle");
const s3Service = require("./s3Service");
const { env } = require("../config/env");
const { AppError } = require("../middleware/errorHandler");

// connectionId -> AbortController del análisis en vuelo.
const running = new Map();

// Ejecuciones CBFEM que se conservan por conexión (con sus campos en S3).
const MAX_RUNS_PER_CONNECTION = 3;

// Sin noticias del calc-service en este tiempo, una ejecución "running" está huérfana.
const ORPHAN_AFTER_MS = 5 * 60 * 1000;

const FINAL = new Set(["done", "incomplete", "notAnalysed", "error", "cancelled"]);

function isRunning(connectionId) {
  return running.has(String(connectionId));
}

function progressRow(e) {
  return {
    step: e.step ?? null,
    current: e.current ?? null,
    total: e.total ?? null,
    caseName: e.caseName ?? null,
    updatedAt: new Date().toISOString(),
  };
}

async function pruneRuns(projectId, connectionId) {
  const stale = await prisma.connectionRun.findMany({
    where: { connectionId, engine: "cbfem" },
    orderBy: { createdAt: "desc" },
    skip: MAX_RUNS_PER_CONNECTION,
    select: { id: true },
  });
  if (stale.length === 0) return;
  await Promise.all(stale.map((r) => s3Service.deleteRun(projectId, r.id).catch(() => {})));
  await prisma.connectionRun.deleteMany({ where: { id: { in: stale.map((r) => r.id) } } });
}

/**
 * Lanza el análisis y vuelve enseguida con la ejecución creada (status "running").
 * `request` es la petición de /connections/cbfem/stream SIN destino: el destino lleva
 * el id de la ejecución, que se crea aquí.
 */
async function start({ projectId, connectionId, analysisRunId, analysis, request, inputs, inputsHash, code, method }) {
  const key = String(connectionId);
  if (running.has(key)) {
    throw new AppError(409, "Ya hay un análisis por elementos finitos en curso para esta conexión", {
      error: "connection.femRunning",
    });
  }
  const controller = new AbortController();
  running.set(key, controller);

  let run;
  try {
    run = await prisma.connectionRun.create({
      data: {
        connectionId,
        analysisRunId,
        engine: "cbfem",
        analysisType: analysis,
        status: "running",
        engineVersion: "pending",
        code,
        method,
        inputsHash,
        inputs,
        startedAt: new Date(),
        progress: progressRow({ step: "queued" }),
      },
    });
  } catch (err) {
    running.delete(key);
    throw err;
  }

  // A propósito sin await: la respuesta HTTP sale ya.
  (async () => {
    const setProgress = (e) =>
      prisma.connectionRun.update({ where: { id: run.id }, data: { progress: progressRow(e) } });
    try {
      const shouldWrite = progressThrottle();
      const { manifest, data } = await connectionCbfemStream(
        {
          ...request,
          storage: {
            projectId: String(projectId),
            runId: String(run.id),
            bucket: env.s3Bucket,
            prefix: env.s3Prefix,
          },
        },
        {
          signal: controller.signal,
          onProgress: (e) => {
            if (shouldWrite(e)) setProgress(e).catch(() => {});
          },
        }
      );
      const result = manifest || data;
      if (!result) throw new AppError(502, "El calc-service no devolvió el resultado del análisis.");
      const status = FINAL.has(result.status) ? result.status : "error";
      await prisma.connectionRun.update({
        where: { id: run.id },
        data: {
          status,
          engineVersion: result.cbfemVersion || result.engineVersion || "unknown",
          results: result,
          files: result.files ?? {},
          s3Prefix: manifest ? s3Service.runPrefix(projectId, run.id) : null,
          progress: null,
          finishedAt: new Date(),
          error: status === "error" ? (result.messages?.[0]?.key ?? "cbfem.error") : null,
        },
      });
      await pruneRuns(projectId, connectionId).catch(() => {});
    } catch (err) {
      const cancelled =
        controller.signal.aborted || err.name === "CanceledError" || err.code === "ERR_CANCELED";
      const message = cancelled
        ? "Análisis cancelado"
        : err instanceof AppError
          ? err.message
          : "El calc-service no pudo analizar la conexión";
      await prisma.connectionRun
        .update({
          where: { id: run.id },
          data: { status: cancelled ? "cancelled" : "error", error: message, progress: null, finishedAt: new Date() },
        })
        .catch(() => {});
      await s3Service.deleteRun(projectId, run.id).catch(() => {});
    } finally {
      running.delete(key);
    }
  })();

  return run;
}

function cancel(connectionId) {
  const controller = running.get(String(connectionId));
  if (!controller) return false;
  controller.abort();
  return true;
}

/** Una ejecución "running" sin avance reciente y sin job vivo: se cierra como error. */
async function settleIfOrphaned(run) {
  if (!run || run.status !== "running" || isRunning(run.connectionId)) return run;
  const last = new Date(run.progress?.updatedAt || run.startedAt || run.createdAt).getTime();
  if (Date.now() - last < ORPHAN_AFTER_MS) return run;
  return prisma.connectionRun.update({
    where: { id: run.id },
    data: { status: "error", error: "El análisis se interrumpió (reinicio del servidor). Vuelve a lanzarlo.", progress: null, finishedAt: new Date() },
  });
}

module.exports = { start, cancel, isRunning, settleIfOrphaned, MAX_RUNS_PER_CONNECTION, ORPHAN_AFTER_MS };
