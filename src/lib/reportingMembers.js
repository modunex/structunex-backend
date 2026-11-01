// Reporting R2: hojas de diseño de miembros. Piezas PURAS (sin base de datos).
//
// Una ejecución de diseño comprueba todas las barras a la vez, así que la unidad del
// archivo es la ejecución: la última vigente, las desactualizadas y las reemplazadas.
// Cada barra de una ejecución es una hoja, y su instantánea sale SOLO de lo que el
// motor guardó (`/design/sheets`): fila de la barra, entradas, criterios con traza y
// mensajes. Aquí no se calcula nada de ingeniería.
const { sha256, snapshotFingerprint } = require("./reporting");

const MEMBER_SNAPSHOT_VERSION = 1;

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
// notConsidered: el ingeniero eligió no evaluarlo (Design ▸ Preferences, p. ej. torsión).
const CRITERION_STATUS = new Set(["ok", "fail", "notVerified", "notConsidered"]);

/** Estado de las ejecuciones de diseño (más reciente primero en el resultado).
 *  `latestStaleReason`: por qué la última ya no es del modelo (null = lo es). */
function archiveDesignRuns(runs, { latestSolvedRunId, latestStaleReason, currentInputsHash = null }) {
  const sorted = runs.slice().sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
  return sorted.map((r, i) => {
    let state = "superseded";
    const staleReasons = [];
    if (i === 0) {
      if (!latestSolvedRunId) staleReasons.push("analysis.missing");
      else if (r.analysisRunId !== latestSolvedRunId) staleReasons.push("analysis.outdated");
      else if (latestStaleReason) staleReasons.push("model.changed");
      // Combinaciones o preferencias de diseño (K, Lb, Cb, normas…) distintas de las de la
      // ejecución; sin huella guardada no se puede afirmar que coincidan.
      if (currentInputsHash && r.inputsHash !== currentInputsHash) staleReasons.push("inputs.changed");
      state = staleReasons.length ? "stale" : "current";
    }
    return {
      kind: "designRun",
      designRunId: r.id,
      createdAt: new Date(r.finishedAt || r.startedAt).toISOString(),
      analysisRunId: r.analysisRunId ?? null,
      code: r.code ?? null,
      steelCode: r.steelCode ?? null,
      counts: r.counts || {},
      summary: r.summary || {},
      // Las ejecuciones anteriores a las hojas (esquema 1) no guardan traza ni entradas.
      sheetsAvailable: (r.schemaVersion ?? 0) >= 2,
      state,
      staleReasons,
    };
  });
}

/** Fila de lista de una barra (de `summaryOnly`). */
function memberListRow(m) {
  return {
    elementId: m.elementId,
    sectionName: m.inputs?.sectionName || null,
    role: m.role,
    code: m.code || null,
    status: m.status,
    verification: m.verification || "",
    ratio: num(m.ratio),
    governing: m.governing || null,
    combo: m.combo || null,
  };
}

const nonEmpty = (o) => (o && typeof o === "object" && Object.keys(o).length > 0 ? o : null);
const runSettings = (run, designRun) => nonEmpty(run.settings) || nonEmpty(designRun.settings);

/** Una barra se puede documentar si el motor llegó a comprobar algo en ella. */
const hasSheet = (m) => m && m.role !== "unchecked" && !!m.inputs;

/**
 * La instantánea de la hoja de una barra.
 * `sheets` es la respuesta de `/design/sheets`; `designRun` la fila de DesignRun.
 */
function memberSnapshot(sheets, elementId, designRun) {
  const m = (sheets.members || []).find((x) => x.elementId === elementId);
  if (!hasSheet(m)) return null;
  const run = sheets.run || {};
  const criteria = (sheets.criteria?.[elementId] || []).map((c) => {
    const ratio = num(c.ratio);
    const out = {
      name: c.name,
      // Sin estado conocido nunca se deduce "cumple": solo un ratio finito > 1 es fallo.
      status: CRITERION_STATUS.has(c.status) ? c.status : ratio != null && ratio > 1 ? "fail" : "notVerified",
      demand: num(c.demand),
      capacity: num(c.capacity),
      ratio,
      unit: c.unit || "",
      ref: c.ref || "",
      combination: c.combo || null,
      station: num(c.station),
    };
    if (c.reason) out.reason = c.reason;
    if (c.equation && out.status !== "notVerified") {
      out.equation = c.equation;
      out.vars = (c.vars || []).map((v) => ({ symbol: v.symbol, value: num(v.value), unit: v.unit || "-" }));
    }
    if (c.assumptions?.length) out.assumptions = c.assumptions;
    return out;
  });
  return {
    kind: "memberCheck",
    version: MEMBER_SNAPSHOT_VERSION,
    member: { elementId, role: m.role, sectionId: m.sectionId, code: m.code },
    run: {
      id: designRun.id,
      createdAt: run.designedAt || new Date(designRun.finishedAt || designRun.startedAt).toISOString(),
      engineVersion: run.engineVersion || null,
      schemaVersion: run.schemaVersion ?? null,
      analysisRunId: designRun.analysisRunId ?? null,
      // Design ▸ Preferences de la comprobación (la memoria las declara). Solo si se
      // guardaron: una comprobación anterior conserva su instantánea (y su huella).
      ...(runSettings(run, designRun) ? { settings: runSettings(run, designRun) } : {}),
    },
    status: m.status,
    verification: m.verification || "",
    governing: { name: m.governing || null, ratio: num(m.ratio), combination: m.combo || null, station: num(m.station) },
    inputs: m.inputs,
    demands: {
      N: num(m.axial), V2: num(m.shearY), V3: num(m.shearZ), T: num(m.torsion),
      M2: num(m.momentY), M3: num(m.momentZ),
    },
    capacities: m.role === "steel"
      ? { phiPn: num(m.phiPn), phiMnx: num(m.phiMnx), phiMny: num(m.phiMny), phiVn: num(m.phiVn) }
      : null,
    criteria,
    messages: (sheets.messages?.[elementId] || []).map((x) => ({ severity: x.severity, key: x.key })),
  };
}

const TEXT = {
  es: {
    title: "Memoria de cálculo de miembros",
    summary: "Resumen de barras",
    cols: ["Barra", "Sección", "Ratio", "Gobierna", "Combinación", "Resultado"],
    status: { ok: "Cumple", overstressed: "No cumple", incomplete: "Incompleta", unchecked: "Sin comprobar" },
    stale: "Esta comprobación no corresponde al estado actual del proyecto",
    reasons: {
      "analysis.outdated": "se hizo con un análisis anterior al vigente",
      "analysis.missing": "el proyecto no tiene un análisis vigente",
      "model.changed": "el modelo cambió después del análisis",
      "inputs.changed": "las combinaciones o las preferencias de diseño cambiaron después de comprobar",
      "run.superseded": "hay una comprobación de diseño posterior",
    },
    incomplete: "Verificación incompleta: hay estados límite con demanda que el motor no pudo evaluar. Esta barra no puede darse por buena.",
  },
  en: {
    title: "Member design report",
    summary: "Member summary",
    cols: ["Member", "Section", "Ratio", "Governs", "Combination", "Result"],
    status: { ok: "Pass", overstressed: "Fail", incomplete: "Incomplete", unchecked: "Not checked" },
    stale: "This check does not match the current state of the project",
    reasons: {
      "analysis.outdated": "it used an analysis older than the current one",
      "analysis.missing": "the project has no current analysis",
      "model.changed": "the model changed after the analysis",
      "inputs.changed": "the load combinations or design preferences changed after the check",
      "run.superseded": "there is a later design check",
    },
    incomplete: "Incomplete verification: some limit states with demand could not be evaluated by the engine. This member cannot be taken as adequate.",
  },
};
const text = (lang) => TEXT[lang] || TEXT.es;

const t = (s) => [{ text: String(s ?? "—") }];

/** Resultado de una barra para el resumen: una incompleta no "cumple". */
const resultKey = (status, verification) =>
  status === "overstressed" ? "overstressed" : verification === "incomplete" ? "incomplete" : status;

/**
 * Documento de miembros: aviso si la ejecución no es vigente, tabla resumen de las barras
 * incluidas y una hoja completa por barra. `snapshots` en el orden dado.
 */
function buildMembersDocument(snapshots, { lang = "es", staleReasons = [], summaryRows = null } = {}) {
  const tx = text(lang);
  const blocks = [];
  if (staleReasons.length) {
    blocks.push({
      id: "stale",
      type: "callout",
      tone: "warning",
      content: [
        { text: `${tx.stale}: `, marks: ["bold"] },
        { text: `${staleReasons.map((r) => tx.reasons[r] || r).join("; ")}.` },
      ],
    });
  }
  blocks.push({ id: "h-summary", type: "heading", level: 1, content: [{ text: tx.summary }] });
  blocks.push({
    id: "t-summary",
    type: "table",
    header: true,
    // `summaryRows` (filas de lista de TODAS las barras) cuando el documento solo lleva
    // las hojas de algunas: el resumen sigue cubriendo la comprobación entera.
    rows: [
      tx.cols.map((c) => t(c)),
      ...(summaryRows
        ? summaryRows.map((m) => [
            t(m.elementId),
            t(m.sectionName),
            t(m.ratio == null || !m.hasSheet ? "—" : m.ratio.toFixed(3)),
            t(m.hasSheet ? m.governing : "—"),
            t(m.combo || "—"),
            t(tx.status[resultKey(m.status, m.verification)] || m.status),
          ])
        : snapshots.map((s) => [
            t(s.member.elementId),
            t(s.inputs?.sectionName || s.member.sectionId),
            t(s.governing.ratio == null ? "—" : s.governing.ratio.toFixed(3)),
            t(s.governing.name),
            t(s.governing.combination),
            t(tx.status[resultKey(s.status, s.verification)] || s.status),
          ])),
    ],
  });
  for (const s of snapshots) {
    const id = `${s.run.id}-${s.member.elementId}`;
    // Título de nivel 1: empieza página y da nombre al pie (capítulo) de la hoja.
    blocks.push({ id: `h-${id}`, type: "heading", level: 1, content: [{ text: `${s.member.elementId} · ${s.inputs?.sectionName || ""}`.trim() }] });
    if (s.verification === "incomplete") {
      blocks.push({ id: `w-${id}`, type: "callout", tone: "warning", content: [{ text: tx.incomplete }] });
    }
    blocks.push({
      id: `k-${id}`,
      type: "memberCheck",
      binding: { source: "designRun", designRunId: s.run.id, elementId: s.member.elementId },
      snapshot: s,
      snapshotHash: snapshotFingerprint(s),
      display: "full",
    });
  }
  return { version: 1, blocks };
}

module.exports = {
  MEMBER_SNAPSHOT_VERSION,
  archiveDesignRuns,
  memberListRow,
  memberSnapshot,
  hasSheet,
  buildMembersDocument,
  membersTitle: (lang) => text(lang).title,
};
