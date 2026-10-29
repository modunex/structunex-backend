// Reporting del proyecto (R1): el archivo de hojas de cálculo que se va llenando solo
// con cada comprobación guardada, y los documentos que se exportan a PDF.
//
// Piezas PURAS (sin base de datos), para probarlas con node --test:
//   - connectionSnapshot: la instantánea de una ConnectionRun que dibuja la hoja.
//   - archiveConnections: estado de cada ejecución (vigente / desactualizada / reemplazada).
//   - buildConnectionsDocument: el documento de Report Studio (formato v1) que pagina
//     el renderizador.
//
// Todo número de una hoja sale de `run.results` (lo que calculó el motor) y de
// `run.inputs` (lo que entró al motor). Aquí no se calcula nada de ingeniería.
const crypto = require("node:crypto");
const { stableStringify } = require("./modelHash");

const CONNECTION_SNAPSHOT_VERSION = 1;

// ─── Instantánea ──────────────────────────────────────────────────────────────────

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

function limitState(ls) {
  const out = {
    id: ls.id,
    group: ls.group,
    ref: ls.ref,
    status: ls.status,
    ratio: num(ls.ratio),
    capacity: num(ls.capacity),
    demand: num(ls.demand),
    unit: ls.unit ?? "-",
    combination: ls.combination ?? null,
  };
  if (ls.reason) out.reason = ls.reason;
  if (ls.pendingSourceReview) out.pendingSourceReview = true;
  // La traza solo existe donde el motor la produjo (nunca en un no verificable).
  if (typeof ls.equation === "string" && Array.isArray(ls.vars)) {
    out.equation = ls.equation;
    out.vars = ls.vars.map((v) => ({ symbol: v.symbol, value: num(v.value), unit: v.unit ?? "-" }));
  }
  return out;
}

/**
 * La instantánea de una comprobación guardada. `connection` es la fila actual (nombre,
 * nudo…); los datos de cálculo salen SOLO de la ejecución, para que una hoja vieja diga
 * lo que se calculó entonces aunque la conexión se haya editado después.
 */
function connectionSnapshot(connection, run) {
  const results = run.results || {};
  const inputs = run.inputs || {};
  const members = results.members || {};
  const context = results.context || {};
  const plate = inputs.plateMaterial || null;
  const supported = members.supported || {};
  const supporting = members.supporting || {};
  return {
    kind: "connectionCheck",
    version: CONNECTION_SNAPSHOT_VERSION,
    connection: {
      id: connection.id,
      name: connection.name,
      nodeId: connection.nodeId,
      typology: inputs.connection?.typology ?? connection.typology,
      code: run.code,
      method: run.method,
    },
    run: {
      id: run.id,
      createdAt: new Date(run.createdAt).toISOString(),
      engineVersion: run.engineVersion,
      inputsHash: run.inputsHash,
      analysisRunId: run.analysisRunId ?? null,
    },
    status: results.status ?? "notVerifiable",
    governing: results.governing
      ? {
          id: results.governing.id,
          ratio: num(results.governing.ratio),
          combination: results.governing.combination ?? null,
        }
      : null,
    procedure: results.procedure ?? null,
    members: {
      supported: { elementId: supported.elementId ?? connection.supportedElementId, section: supported.section ?? null },
      supporting: {
        elementId: supporting.elementId ?? null,
        section: supporting.section ?? null,
        face: supporting.face ?? null,
        kind: supporting.kind ?? null,
      },
    },
    params: inputs.connection?.params ?? {},
    materials: {
      plate: plate ? { name: plate.name ?? null, Fy: num(plate.Fy), Fu: num(plate.Fu) } : null,
      beam: { Fy: num(context.beam?.Fy), Fu: num(context.beam?.Fu) },
      support: { Fy: num(context.support?.Fy), Fu: num(context.support?.Fu) },
    },
    demands: (results.demands || []).map((d) => ({ label: d.label, V: num(d.V), N: num(d.N) })),
    limitStates: (results.limitStates || []).map(limitState),
    assumptions: results.assumptions || [],
    messages: (results.messages || []).map((m) => ({
      severity: m.severity,
      key: m.key,
      ...(m.params ? { params: m.params } : {}),
    })),
    missingParams: results.missingParams || [],
    missingData: results.missingData || [],
  };
}

const sha256 = (value) =>
  crypto.createHash("sha256").update(typeof value === "string" ? value : stableStringify(value)).digest("hex");

// ─── Archivo ──────────────────────────────────────────────────────────────────────

/**
 * Estado de las comprobaciones guardadas de cada conexión.
 *
 *   current     la última comprobación, hecha con el análisis vigente y sin cambios
 *               en la conexión desde entonces.
 *   stale       la última comprobación, pero ya no corresponde al proyecto (motivos en
 *               `staleReasons`): hay que volver a comprobar.
 *   superseded  una comprobación anterior a la última.
 *
 * `connections`: [{ id, name, nodeId, supportedElementId, typology, status, orphanReasons }]
 * `runs`: ejecuciones TERMINADAS (status done) con { id, connectionId, createdAt,
 *          engineVersion, analysisRunId, inputsHash, code, method, result, governing }.
 */
function archiveConnections(connections, runs, { latestSolvedRunId }) {
  const byConnection = new Map(connections.map((c) => [c.id, []]));
  for (const r of runs) byConnection.get(r.connectionId)?.push(r);

  return connections.map((c) => {
    const list = byConnection
      .get(c.id)
      .slice()
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const entries = list.map((r, i) => {
      let state = "superseded";
      const staleReasons = [];
      if (i === 0) {
        if ((c.orphanReasons || []).length) staleReasons.push("connection.orphaned");
        if (c.status !== "checked") staleReasons.push("connection.edited");
        if (!latestSolvedRunId) staleReasons.push("analysis.missing");
        else if (r.analysisRunId !== latestSolvedRunId) staleReasons.push("analysis.outdated");
        state = staleReasons.length ? "stale" : "current";
      }
      return {
        kind: "connectionCheck",
        runId: r.id,
        connectionId: c.id,
        createdAt: new Date(r.createdAt).toISOString(),
        engineVersion: r.engineVersion,
        analysisRunId: r.analysisRunId ?? null,
        inputsHash: r.inputsHash,
        code: r.code,
        method: r.method,
        result: r.result ?? null,
        governing: r.governing ?? null,
        state,
        staleReasons,
      };
    });
    return {
      connectionId: c.id,
      name: c.name,
      nodeId: c.nodeId,
      supportedElementId: c.supportedElementId,
      typology: c.typology,
      orphaned: (c.orphanReasons || []).length > 0,
      latest: entries[0] ?? null,
      history: entries.slice(1),
    };
  });
}

// ─── Documento ────────────────────────────────────────────────────────────────────

const TEXT = {
  es: {
    title: "Memoria de cálculo de conexiones",
    stale: "Esta comprobación no corresponde al estado actual del proyecto",
    reasons: {
      "connection.orphaned": "la conexión ya no coincide con el modelo",
      "connection.edited": "la conexión se modificó después de comprobarla",
      "analysis.outdated": "se hizo con un análisis anterior al vigente",
      "analysis.missing": "el proyecto no tiene un análisis vigente",
      "run.superseded": "hay una comprobación posterior de esta conexión",
    },
  },
  en: {
    title: "Connection design report",
    stale: "This check does not match the current state of the project",
    reasons: {
      "connection.orphaned": "the connection no longer matches the model",
      "connection.edited": "the connection was edited after it was checked",
      "analysis.outdated": "it used an analysis older than the current one",
      "analysis.missing": "the project has no current analysis",
      "run.superseded": "there is a later check of this connection",
    },
  },
};

const text = (lang) => TEXT[lang] || TEXT.es;

/**
 * Documento de Report Studio con una hoja completa por comprobación, en el orden dado.
 * `sheets`: [{ snapshot, staleReasons }]. Una hoja que ya no es vigente lleva delante un
 * aviso con los motivos: un PDF nunca debe hacer pasar por actual algo que no lo es.
 */
function buildConnectionsDocument(sheets, lang = "es") {
  const t = text(lang);
  const blocks = [];
  sheets.forEach(({ snapshot, staleReasons = [] }, i) => {
    const id = snapshot.run.id;
    if (i > 0) blocks.push({ id: `pb-${id}`, type: "pageBreak" });
    blocks.push({ id: `h-${id}`, type: "heading", level: 1, content: [{ text: snapshot.connection.name }] });
    if (staleReasons.length) {
      const why = staleReasons.map((r) => t.reasons[r] || r).join("; ");
      blocks.push({
        id: `w-${id}`,
        type: "callout",
        tone: "warning",
        content: [{ text: `${t.stale}: `, marks: ["bold"] }, { text: `${why}.` }],
      });
    }
    blocks.push({
      id: `k-${id}`,
      type: "connectionCheck",
      binding: { source: "connectionRun", connectionId: snapshot.connection.id, runId: id },
      snapshot,
      snapshotHash: sha256(snapshot),
      display: "full",
    });
  });
  return { version: 1, blocks };
}

/** Datos de portada y encabezados, desde el proyecto. */
function reportMeta(project, { title, lang = "es", revision = "0", date = new Date(), logoDataUri = null } = {}) {
  return {
    title: title || text(lang).title,
    project: project.name,
    client: project.client ?? null,
    company: project.company ?? null,
    engineer: project.engineer ?? null,
    revision,
    date: date.toISOString().slice(0, 10),
    logoUrl: logoDataUri,
  };
}

module.exports = {
  CONNECTION_SNAPSHOT_VERSION,
  connectionSnapshot,
  archiveConnections,
  buildConnectionsDocument,
  reportMeta,
  sha256,
};
