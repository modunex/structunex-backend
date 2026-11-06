// Orientación de losas para el asistente IA. Misma convención que el frontend
// (utils/draw.ts → areaLocalAxes) y que el motor (lib/deckSection.js):
// - e3 = normal por (P1−P0)×(P2−P0) con el orden de los nudos;
// - en un área horizontal el eje local 1 es +X, sea cual sea el orden de los nudos;
// - el área gira e1 alrededor de e3 su `localAxisAngle`, y los nervios de un deck van
//   girados `deck.ribAngle` respecto a ese e1.
// En planta la dirección de los nervios queda a ±(localAxisAngle + ribAngle) de X
// (el signo lo da hacia dónde mira e3); como dirección (sin sentido) se da en [0, 180).

const HORIZ_TOL = 1e-4;

function points(area, nodeById) {
  const pts = (area.nodeIds || []).map((id) => nodeById.get(id));
  if (pts.length < 3 || pts.some((p) => !p)) return null;
  return pts.map((n) => [n.x, n.y, n.z ?? 0]);
}

/** Signo de la normal local 3 en Z (+1 hacia arriba, −1 hacia abajo), o null si no es horizontal. */
function horizontalNormalSign(area, nodeById) {
  const p = points(area, nodeById);
  if (!p) return null;
  const zs = p.map((q) => q[2]);
  if (Math.max(...zs) - Math.min(...zs) > HORIZ_TOL) return null;
  const u = [p[1][0] - p[0][0], p[1][1] - p[0][1]];
  const v = [p[2][0] - p[0][0], p[2][1] - p[0][1]];
  const cz = u[0] * v[1] - u[1] * v[0];
  if (Math.abs(cz) < 1e-12) return null;
  return cz > 0 ? 1 : -1;
}

const mod180 = (d) => ((d % 180) + 180) % 180;
const near = (a, b) => Math.min(Math.abs(a - b), 180 - Math.abs(a - b)) < 0.5;

/** Ángulo de nervios del deck de una sección (null si no es deck). */
function ribAngleOf(section) {
  if (!section || section.kind !== "deck") return null;
  const r = section.deck?.ribAngle;
  return Number.isFinite(r) ? r : 0;
}

/** Dirección de los nervios en planta: "X", "Y" o "N° desde X"; null si no aplica. */
function ribDirection(area, nodeById, section) {
  const rib = ribAngleOf(section);
  const s = horizontalNormalSign(area, nodeById);
  if (rib == null || s == null) return null;
  const d = mod180(s * ((area.localAxisAngle ?? 0) + rib));
  if (near(d, 0)) return "X";
  if (near(d, 90)) return "Y";
  return `${Math.round(d * 10) / 10}° desde X`;
}

/** localAxisAngle que deja los nervios en la dirección pedida ("x" | "y"). */
function angleForRibs(target, section) {
  const rib = ribAngleOf(section);
  if (rib == null) return null;
  // Como dirección da igual el signo de e3: 0° o 90° coinciden con su opuesto.
  let a = (target === "y" ? 90 : 0) - rib;
  a = ((a % 360) + 360) % 360;
  if (a > 180) a -= 360;
  return Math.round(a * 1e6) / 1e6;
}

module.exports = { horizontalNormalSign, ribDirection, angleForRibs, ribAngleOf };
