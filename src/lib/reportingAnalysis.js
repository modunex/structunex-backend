// Reporting R3: hoja de análisis y memoria automática del proyecto. Piezas PURAS.
//
// La hoja de análisis sale de la ejecución de análisis guardada (fila AnalysisRun: casos,
// modos, resumen por caso, plantas, cortantes de planta del espectro) y de las
// reacciones que lee el calc-service (`/analysis/sheets`). Los datos del modelo
// (materiales, secciones, patrones, combinaciones) se leen de la base SOLO cuando el
// análisis es del modelo actual (misma huella): entonces describen exactamente lo
// analizado. Si no lo es, no hay hoja: el servicio responde que hay que reanalizar.
const { sha256, snapshotFingerprint } = require("./reporting");

const ANALYSIS_SNAPSHOT_VERSION = 1;
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * `run`: fila AnalysisRun. `sheets`: respuesta de /analysis/sheets.
 * `model`: { counts, materials, sections, loadPatterns, combinations } del modelo actual.
 */
function analysisSnapshot({ run, sheets, model }) {
  const reactionsByCase = new Map((sheets?.cases || []).map((c) => [c.name, c]));
  const perCase = new Map(((run.summary || {}).perCase || []).map((c) => [c.case, c]));
  const cases = (run.cases || []).map((c) => {
    const s = perCase.get(c.name) || {};
    const r = reactionsByCase.get(c.name);
    return {
      name: c.name,
      kind: c.kind || "pattern",
      maxDisp: s.maxDisp ? { nodeId: s.maxDisp.nodeId ?? null, value: num(s.maxDisp.value) } : null,
      maxReaction: num(s.maxReaction),
      maxAxial: num(s.maxAxial),
      maxShear: num(s.maxShear),
      maxMoment: num(s.maxMoment),
      reactions: r
        ? {
            supports: r.supports,
            truncated: !!r.truncated,
            rows: r.reactions || [],
            sum: r.sum ? { fx: num(r.sum.fx), fy: num(r.sum.fy), fz: num(r.sum.fz) } : null,
          }
        : null,
    };
  });
  let cum = { ux: 0, uy: 0, rz: 0 };
  const modes = (run.modes || []).map((m) => {
    cum = { ux: cum.ux + (m.ux || 0), uy: cum.uy + (m.uy || 0), rz: cum.rz + (m.rz || 0) };
    return {
      mode: m.mode,
      period: num(m.period),
      frequencyHz: num(m.frequencyHz),
      ux: num(m.ux), uy: num(m.uy), uz: num(m.uz), rz: num(m.rz),
      cumUx: num(cum.ux), cumUy: num(cum.uy), cumRz: num(cum.rz),
    };
  });
  const summary = run.summary || {};
  return {
    kind: "analysisSummary",
    version: ANALYSIS_SNAPSHOT_VERSION,
    run: {
      id: run.id,
      solvedAt: run.solvedAt ? new Date(run.solvedAt).toISOString() : null,
      schemaVersion: run.schemaVersion ?? null,
      modelHash: run.modelHash ?? null,
      activeDofs: run.activeDofs || [],
      notes: run.notes || [],
    },
    model,
    counts: run.counts || {},
    cases,
    modes,
    stories: (run.stories || []).map((s) => ({
      z: num(s.z), mass: num(s.mass), cmX: num(s.cmX), cmY: num(s.cmY),
      crX: num(s.crX), crY: num(s.crY), eX: num(s.eX), eY: num(s.eY),
    })),
    storyForces: (summary.storyForces || []).map((f) => ({
      case: f.case, z: num(f.z), vx: num(f.vx), vy: num(f.vy), mx: num(f.mx), my: num(f.my),
    })),
    // Deriva INDICATIVA (máximos de nivel, no en el mismo nudo): no es una comprobación.
    driftIndicative: (summary.drift || []).map((d) => ({
      case: d.case, level: d.level, z: num(d.z), height: num(d.height), driftX: num(d.driftX), driftY: num(d.driftY),
    })),
  };
}

/** Resumen del modelo a partir de las filas de la base (puro: el servicio las lee). */
function modelSummary({ nodes, elements, supports, areas, sections, materials, configuration }) {
  const useCount = new Map();
  for (const e of elements) if (e.frameSectionId) useCount.set(String(e.frameSectionId), (useCount.get(String(e.frameSectionId)) || 0) + 1);
  const matName = new Map(materials.map((m) => [m.id, m.name]));
  return {
    counts: { nodes, elements: elements.length, supports, areas },
    // Orden determinista: la huella de la instantánea no puede depender del orden en que
    // la base devuelva las filas (se recalcula al exportar y tiene que coincidir).
    materials: materials
      .map((m) => ({ name: m.name, type: m.type, E: num(m.E), Fy: num(m.Fy), Fu: num(m.Fu), fc: num(m.fc) }))
      .sort((a, b) => String(a.name).localeCompare(String(b.name)) || JSON.stringify(a).localeCompare(JSON.stringify(b))),
    sections: sections
      .map((s) => ({ name: s.name, material: matName.get(s.materialId) || null, source: s.source, members: useCount.get(String(s.id)) || 0 }))
      .sort((a, b) => b.members - a.members || String(a.name).localeCompare(String(b.name)) || JSON.stringify(a).localeCompare(JSON.stringify(b))),
    loadPatterns: (configuration?.loadPatterns || []).map((p) => ({
      name: p.name, type: p.type || null, selfWeight: num(p.selfWeightMultiplier) ?? 0,
    })),
    combinations: (configuration?.loadCombinations || []).map((c) => ({
      name: c.name,
      terms: (c.factors || []).map((f) => ({ factor: num(f.factor), pattern: f.pattern ?? null, seismic: !!f.seismic })),
    })),
  };
}

const TEXT = {
  es: {
    title: "Memoria de cálculo estructural",
    analysisTitle: "Memoria de análisis estructural",
    ch: { analysis: "Análisis estructural", members: "Diseño de miembros", connections: "Conexiones" },
    missing: {
      analysis: "No hay un análisis vigente del modelo actual: este capítulo no se incluye. Vuelve a analizar.",
      members: "No hay una comprobación de diseño vigente: este capítulo no se incluye.",
      connections: "No hay comprobaciones de conexiones vigentes: este capítulo no se incluye.",
      membersTooMany: "La comprobación tiene más barras que el máximo de hojas por documento: se incluye el resumen y las hojas de las barras que no cumplen o están incompletas.",
      connectionsTooMany: "Hay más conexiones vigentes que el máximo de hojas por documento: solo se incluyen las primeras. Exporta el resto desde Informes ▸ Conexiones.",
    },
    intro: {
      members: (n, all) => `${n} hojas de cálculo de barras${all ? "" : " (solo las que no cumplen o están incompletas)"}.`,
      connections: (n) => `${n} hojas de cálculo de conexiones vigentes.`,
    },
  },
  en: {
    title: "Structural calculation report",
    analysisTitle: "Structural analysis report",
    ch: { analysis: "Structural analysis", members: "Member design", connections: "Connections" },
    missing: {
      analysis: "There is no current analysis of the current model: this chapter is not included. Run the analysis again.",
      members: "There is no current design check: this chapter is not included.",
      connections: "There are no current connection checks: this chapter is not included.",
      membersTooMany: "The check has more members than the maximum number of sheets per document: the summary is included, with sheets only for failing or incomplete members.",
      connectionsTooMany: "There are more current connections than the maximum number of sheets per document: only the first ones are included. Export the rest from Reports ▸ Connections.",
    },
    intro: {
      members: (n, all) => `${n} member calculation sheets${all ? "" : " (failing or incomplete members only)"}.`,
      connections: (n) => `${n} current connection calculation sheets.`,
    },
  },
};
const text = (lang) => TEXT[lang] || TEXT.es;

function analysisBlock(snapshot) {
  return {
    id: `a-${snapshot.run.id}`,
    type: "analysisSummary",
    binding: { source: "analysisRun", analysisRunId: snapshot.run.id },
    snapshot,
    snapshotHash: snapshotFingerprint(snapshot),
    display: "full",
  };
}

/** Documento solo de análisis. */
function buildAnalysisDocument(snapshot, lang = "es") {
  const tx = text(lang);
  return {
    version: 1,
    blocks: [
      { id: "h-analysis", type: "heading", level: 1, content: [{ text: tx.ch.analysis }] },
      analysisBlock(snapshot),
    ],
  };
}

/**
 * Memoria del proyecto: capítulos de análisis, miembros y conexiones con lo VIGENTE.
 * Un capítulo sin datos vigentes no se rellena con datos viejos: lleva un aviso.
 * `members`: { document (de buildMembersDocument), count, all, tooMany } | null.
 * `connections`: { document (de buildConnectionsDocument), count } | null.
 */
function buildMemoriaDocument({ analysis, members, connections, lang = "es" }) {
  const tx = text(lang);
  const blocks = [];
  const chapter = (key, n) => blocks.push({ id: `ch-${key}`, type: "heading", level: 1, content: [{ text: `${n}. ${tx.ch[key]}` }] });
  const warn = (key, msg) => blocks.push({ id: `w-${key}`, type: "callout", tone: "warning", content: [{ text: msg }] });

  chapter("analysis", 1);
  if (analysis) blocks.push(analysisBlock(analysis));
  else warn("analysis", tx.missing.analysis);

  chapter("members", 2);
  if (members) {
    if (members.tooMany) warn("members-many", tx.missing.membersTooMany);
    blocks.push({ id: "p-members", type: "paragraph", content: [{ text: tx.intro.members(members.count, members.all) }] });
    blocks.push(...members.document.blocks);
  } else warn("members", tx.missing.members);

  chapter("connections", 3);
  if (connections) {
    if (connections.truncated) warn("connections-many", tx.missing.connectionsTooMany);
    blocks.push({ id: "p-connections", type: "paragraph", content: [{ text: tx.intro.connections(connections.count) }] });
    blocks.push(...connections.document.blocks.filter((b) => b.type !== "pageBreak"));
  } else warn("connections", tx.missing.connections);

  return { version: 1, blocks };
}

module.exports = {
  ANALYSIS_SNAPSHOT_VERSION,
  analysisSnapshot,
  modelSummary,
  buildAnalysisDocument,
  buildMemoriaDocument,
  memoriaTitle: (lang) => text(lang).title,
  analysisTitle: (lang) => text(lang).analysisTitle,
};
