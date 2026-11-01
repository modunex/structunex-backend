// Nudos de pórticos especiales (SMF): columna fuerte / viga débil (AISC 341-22 E3.4a) y
// zona de panel (E3.6e) por nudo.
//
// Ambas dependen de la conexión: ΣM*be = Σ(Mpr + Mv) usa el Mpr y la posición de la
// rótula que fija la conexión precalificada (AISC 358), y la zona de panel, las fuerzas
// de sus alas. El motor de conexiones ya las calcula (End Plate: preq.columnBeamMomentRatio
// y preq.panelZone); aquí NO se recalculan: se reúne, nudo por nudo, lo que dice la
// última comprobación vigente de cada conexión. Un nudo SMF sin conexión comprobada queda
// "pendiente" — nunca se supone dónde está la rótula.

// Misma regla que el motor (calc-service design/members.py: COLUMN_MAX_TILT_DEG).
const COLUMN_MAX_TILT_DEG = 30;

const SCWB_ID = "preq.columnBeamMomentRatio";
const PANEL_IDS = ["preq.panelZone", "preq.panelZoneThickness"];

function axisOf(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  const horizontal = Math.hypot(dx, dy);
  if (horizontal === 0 && dz === 0) return "beam";
  const tilt = (Math.atan2(horizontal, Math.abs(dz)) * 180) / Math.PI;
  return tilt <= COLUMN_MAX_TILT_DEG ? "column" : "beam";
}

/** El peor de varios estados límite (fail > notVerifiable > pass) con su ratio. */
function worst(limitStates) {
  if (!limitStates.length) return null;
  const rank = { fail: 3, notVerifiable: 2, pass: 1 };
  return limitStates.reduce((acc, ls) => {
    const r = rank[ls.status] ?? 2;
    const ra = rank[acc.status] ?? 2;
    if (r > ra) return ls;
    if (r === ra && (ls.ratio ?? -1) > (acc.ratio ?? -1)) return ls;
    return acc;
  });
}

const pick = (ls) => (ls ? { status: ls.status, ratio: ls.ratio ?? null, ref: ls.ref ?? "" } : null);

/**
 * @param nodes        [{ id, x, y, z }]
 * @param elements     [{ id, nodeA, nodeB }]
 * @param memberSystems [{ elementId, type }] (lib/lateralSystems)
 * @param connections  [{ id, name, typology, nodeId, lastRun: { status, current, result, systemChecks } }]
 * @returns filas por nudo SMF: { nodeId, beams, columns, connections, scwb, panelZone, state }
 *   state: "ok" | "fail" | "notVerifiable" | "pending" (sin conexión comprobada) | "stale"
 */
function smfJoints({ nodes, elements, memberSystems, connections }) {
  const nodeById = new Map(nodes.map((n) => [String(n.id), n]));
  const systemOf = new Map(memberSystems.map((m) => [String(m.elementId), m.type]));
  const byNode = new Map();
  const touch = (nodeId) => {
    if (!byNode.has(nodeId)) byNode.set(nodeId, { beams: [], columns: [] });
    return byNode.get(nodeId);
  };
  for (const e of elements) {
    const a = nodeById.get(String(e.nodeA));
    const b = nodeById.get(String(e.nodeB));
    if (!a || !b) continue;
    const axis = axisOf(a, b);
    for (const nodeId of [String(e.nodeA), String(e.nodeB)]) {
      const j = touch(nodeId);
      if (axis === "column") j.columns.push(String(e.id));
      else if (systemOf.get(String(e.id)) === "SMF") j.beams.push(String(e.id));
    }
  }

  const connectionsAt = new Map();
  for (const c of connections || []) {
    const key = String(c.nodeId);
    if (!connectionsAt.has(key)) connectionsAt.set(key, []);
    connectionsAt.get(key).push(c);
  }

  const rows = [];
  for (const [nodeId, j] of byNode) {
    // Un nudo de pórtico especial: al menos una viga SMF que llega a una columna.
    if (!j.beams.length || !j.columns.length) continue;
    const here = connectionsAt.get(nodeId) || [];
    const checked = here.filter((c) => c.lastRun && c.lastRun.status === "done");
    const all = checked.flatMap((c) => c.lastRun.systemChecks || []);
    const scwb = pick(worst(all.filter((ls) => ls.id === SCWB_ID)));
    const panelZone = pick(worst(all.filter((ls) => PANEL_IDS.includes(ls.id))));

    let state;
    if (!checked.length || (!scwb && !panelZone)) state = "pending";
    else if (checked.some((c) => !c.lastRun.current)) state = "stale";
    else {
      const statuses = [scwb, panelZone].map((x) => x?.status ?? "notVerifiable");
      state = statuses.includes("fail") ? "fail" : statuses.includes("notVerifiable") ? "notVerifiable" : "ok";
    }
    rows.push({
      nodeId,
      beams: j.beams,
      columns: j.columns,
      connections: here.map((c) => ({
        id: c.id,
        name: c.name,
        typology: c.typology,
        result: c.lastRun?.result ?? null,
        current: !!c.lastRun?.current,
      })),
      scwb,
      panelZone,
      state,
    });
  }
  return rows.sort((a, b) => a.nodeId.localeCompare(b.nodeId, undefined, { numeric: true }));
}

module.exports = { smfJoints, axisOf, SCWB_ID, PANEL_IDS };
