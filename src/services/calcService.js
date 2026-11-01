const axios = require("axios");
const { env } = require("../config/env");
const { AppError } = require("../middleware/errorHandler");

// Talks to the Python calc-service. Node NEVER solves - it delegates.
// For the MVP these are direct HTTP calls; later they can be pushed onto a
// BullMQ queue and a worker calls this instead.

// Translates an axios failure from the calc-service into an AppError that keeps
// the real reason. The service returns 422 with { detail: {error, message,
// nodeIds?, dofs?} } for caller model errors, 500 for a solver bug. A missing
// response means the service is down / timed out.
function fromCalcError(err) {
  if (!err.response) {
    return new AppError(
      502,
      `No se pudo contactar el calc-service (${err.code || err.message}). ` +
        `¿Está levantado en ${env.calcServiceUrl}?`
    );
  }
  const { status, data } = err.response;
  const detail = data && data.detail;
  // 404 aquí no es un modelo inválido: significa que la ruta no existe en el
  // calc-service que responde (típicamente un proceso viejo sin /analyze).
  if (status === 404) {
    return new AppError(
      502,
      `El calc-service en ${env.calcServiceUrl} no expone la ruta pedida (404). ` +
        `Probablemente corre una versión antigua: reinícialo con el código actual.`
    );
  }
  let message;
  if (detail && typeof detail === "object" && detail.message) {
    message = detail.message;
  } else if (typeof detail === "string") {
    message = detail;
  } else {
    message = `Calc service error (${status})`;
  }
  // 422 = the caller's model is at fault (surface it as-is); anything else is a
  // solver/infra problem → 502 upstream.
  const code = status === 422 ? 422 : 502;
  return new AppError(
    code,
    message,
    detail && typeof detail === "object" ? detail : undefined
  );
}

// Condition-based, multi-pattern engine. `request` is { analysisOptions, model }.
// Returns { patterns, activeDofs, solvedAt, notes }.
async function analyzeModel(request) {
  try {
    const { data } = await axios.post(`${env.calcServiceUrl}/analyze`, request, {
      timeout: 60000,
    });
    return data;
  } catch (err) {
    throw fromCalcError(err);
  }
}

// Streaming variant: the calc-service emits NDJSON progress lines and finishes with the
// result. Two reasons to prefer it over analyzeModel():
//   1. Progress - `onProgress({step, message, current, total})` fires as it goes.
//   2. Bytes start flowing immediately, so the request survives a proxy that aborts
//      anything without a response for a while (load balancers commonly cut at 30-60 s).
// `signal` is an AbortSignal: aborting it drops the connection, and the calc-service
// notices the disconnect and kills MYSTRAN.
async function analyzeModelStream(request, options = {}) {
  return postStream("/analyze/stream", request, options);
}

// Comprobación por normativa con avance (NDJSON, mismo protocolo que el análisis). Sin
// stream, un edificio grande dejaba al usuario minutos con "comprobando" y rozaba el
// timeout de la llamada simple.
async function designModelStream(request, options = {}) {
  return postStream("/design/stream", request, options);
}

async function postStream(path, request, { onProgress, signal } = {}) {
  let response;
  try {
    response = await axios.post(`${env.calcServiceUrl}${path}`, request, {
      responseType: "stream",
      signal,
      // No overall timeout: the stream can legitimately run for minutes. Liveness is
      // covered by the service's heartbeat lines plus the caller's own abort.
      timeout: 0,
    });
  } catch (err) {
    throw fromCalcError(err);
  }

  return new Promise((resolve, reject) => {
    let buffer = "";
    let settled = false;

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      fn(value);
    };

    const handleLine = (line) => {
      const text = line.trim();
      if (!text) return;
      let event;
      try {
        event = JSON.parse(text);
      } catch {
        return; // a partial/garbled line is not worth killing the run over
      }
      if (event.type === "progress" && onProgress) onProgress(event);
      // El evento "result" viene en dos sabores: con `manifest` cuando el
      // calc-service ha escrito el Parquet en S3 (~1 KB), o con `data` (el resultado
      // entero) cuando la petición no llevaba destino de almacenamiento.
      else if (event.type === "result") {
        finish(resolve, { manifest: event.manifest ?? null, data: event.data ?? null });
      }
      else if (event.type === "error") {
        const detail = event.detail;
        const message =
          (detail && detail.message) || `Calc service error (${event.status})`;
        finish(
          reject,
          new AppError(event.status === 422 ? 422 : 502, message, detail)
        );
      }
      // "heartbeat" needs no handling: receiving it is the point.
    };

    response.data.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? ""; // keep the trailing partial line
      lines.forEach(handleLine);
    });
    response.data.on("end", () => {
      handleLine(buffer);
      finish(
        reject,
        new AppError(502, "El calc-service cerró el stream sin devolver resultado")
      );
    });
    response.data.on("error", (err) => finish(reject, fromCalcError(err)));
  });
}

// Comprobación por normativa. El calc-service no resuelve nada aquí: lee los esfuerzos
// que el análisis dejó en S3, superpone las combinaciones y comprueba, así que la
// llamada es corta y no necesita stream ni latidos.
//
// El timeout es holgado porque el coste crece con (barras × combinaciones) y un edificio
// con muchas combinaciones puede tardar; sigue siendo un orden de magnitud menos que un
// MYSTRAN, que es la razón de que el diseño se pueda relanzar solo.
async function designModel(request, { signal } = {}) {
  try {
    const { data } = await axios.post(`${env.calcServiceUrl}/design`, request, {
      timeout: 300000,
      signal,
    });
    return { manifest: data?.manifest ?? null, data: data?.manifest ? null : data };
  } catch (err) {
    throw fromCalcError(err);
  }
}

module.exports = {
  analyzeModel,
  analyzeModelStream,
  designModel,
  designModelStream,
  fromCalcError,
};
