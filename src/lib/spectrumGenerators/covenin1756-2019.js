// Generador de espectros de COVENIN 1756-1:2019 (Venezuela, 2da. revisión).
//
// A diferencia de la edición 2001 (zonas + formas S1–S4), la 2019 parte de tres
// parámetros de amenaza leídos de los mapas (A0, A1, TL, para PMR = 475 años en sitio BC)
// y de un factor de importancia que depende del sismo (diseño α, extremo αE, frecuente αF).
// Los factores de sitio salen de la clase de sitio (A…E), la profundidad del basamento H y
// la topografía (tablas 8–12, interpolando en αA0, αA1 y H).
//
//   AA = FA·α·A0     AV = FV·α·A1     β* = máx(β, AV/AA)
//   TC = AV/(2,4·AA)  TB = 0,25·TC  TA = 0,20·TB ∈ [0,02; 0,05]  TD = TL·FD/FV
//
//   Elástico (7.1–7.5)                     Inelástico (7.18–7.22), × ρ·FI
//   T ≤ TA        A = AA                    Ad = AA/1,5
//   TA ≤ T ≤ TB   A = AA[1+(T−TA)/(TB−TA)(β*−1)]   (TA..T⁺) Ad = AA[1/1,5+(β*/R−1/1,5)(T−TA)/(T⁺−TA)]
//   TB ≤ T ≤ TC   A = β*AA                  (T⁺..TC) Ad = β*AA/R
//   TC ≤ T ≤ TD   A = β*AA·TC/T             Ad = β*AA/R·TC/T
//   TD ≤ T        A = β*AA·(TC/TD)(TD/T)^q  Ad = β*AA/R·(TC/TD)(TD/T)^q
//
//   D(T) = A(T)·g·(T/2π)²    DT(T) = Cd·Ad(T)·g·(T/2π)²    Av(Tv) = A(Tv)·γ(Tv)·η(Tv)
//
// Lo que entra al análisis (sample) es el INELÁSTICO Ad(T), como en la edición 2001.
// `table()` devuelve todas las curvas juntas, que es lo que se reporta.
const { sampleGrid } = require("./grid");

const G_CM = 981; // cm/s², el g que fija la norma en 7.4

// Interpolación lineal por tramos. Fuera del rango tabulado la norma no da valores: se
// toma el extremo y se avisa (p. ej. el Sismo Extremo en Caracas lleva αA0 por encima
// de 0,5, la última fila de la tabla 8).
function interp(xs, ys, x, label, notes) {
  if (x <= xs[0]) {
    if (x < xs[0] && notes) notes.push(`${label}: ${round(x)} < ${xs[0]}, se usa la primera fila`);
    return ys[0];
  }
  const last = xs.length - 1;
  if (x >= xs[last]) {
    if (x > xs[last] && notes) notes.push(`${label}: ${round(x)} > ${xs[last]}, se usa la última fila (sin extrapolar)`);
    return ys[last];
  }
  for (let i = 0; i < last; i++) {
    if (x <= xs[i + 1]) {
      const t = (x - xs[i]) / (xs[i + 1] - xs[i]);
      return ys[i] + t * (ys[i + 1] - ys[i]);
    }
  }
  return ys[last];
}

const round = (v) => Math.round(v * 1e4) / 1e4;

function positive(name, v) {
  if (!(Number.isFinite(v) && v > 0)) throw new Error(`${name} debe ser un número mayor que cero`);
  return v;
}

// R y Cd: o bien un sistema de la tabla 15 + nivel de diseño, o bien valores explícitos.
function resolveSystem(code, params) {
  if (params.R != null || params.Cd != null) {
    return { R: positive("R", params.R), Cd: positive("Cd", params.Cd), omega0: params.omega0 ?? null, sistema: null };
  }
  const fila = code.sistemas.filas.find((f) => f.id === params.sistemaId);
  if (!fila) throw new Error(`Sistema estructural desconocido: ${params.sistemaId}`);
  const nd = params.nivelDiseno;
  const R = fila.R[nd];
  const Cd = fila.Cd[nd];
  if (R == null || Cd == null) {
    throw new Error(`La norma no define R/Cd para ${fila.subtipo} ${fila.material} en ${nd}`);
  }
  return { R, Cd, omega0: fila.omega0, sistema: fila.id };
}

function resolve(code, params) {
  const notes = [];
  const A0 = positive("A0", params.A0);
  const A1 = positive("A1", params.A1);
  const TLmapa = positive("TL", params.TL);

  const sismoId = params.sismo || "diseno";
  const sismo = code.sismos[sismoId];
  if (!sismo) throw new Error(`Tipo de sismo desconocido: ${sismoId}`);
  const grupo = sismo.grupos[params.grupo];
  if (!grupo) throw new Error(`La norma no define el ${sismo.titulo} para el grupo ${params.grupo}`);
  const alpha = params.alpha != null ? positive("alpha", params.alpha) : grupo.alpha;
  const TL = TLmapa * (sismo.TLfactor || 1);

  const clase = params.claseSitio;
  if (!code.clasesSitio.includes(clase)) {
    throw new Error(`Clase de sitio no tabulada: ${clase} (la clase F exige estudio de sitio)`);
  }
  const topo = code.topografia[params.topografia || "leve"];
  if (!topo) throw new Error(`Condición topográfica desconocida: ${params.topografia}`);
  const H = params.H != null ? params.H : 30;
  if (!(Number.isFinite(H) && H >= 0)) throw new Error("H debe ser un número ≥ 0");

  const aA0 = alpha * A0;
  const aA1 = alpha * A1;
  const FAC = interp(code.FAC.x, code.FAC.valores[clase], aA0, "Tabla 8 (αA0)", notes);
  const FVC = interp(code.FVC.x, code.FVC.valores[clase], aA1, "Tabla 9 (αA1)", notes);
  const FDC = code.FDC.valores[clase];
  const b = code.basamento;
  const FAH = interp(b.H, b.FAH, H, "Tabla 12 (H)", notes);
  const FVH = interp(b.H, b.FVH, H, "Tabla 12 (H)", null);
  const FDH = interp(b.H, b.FDH, H, "Tabla 12 (H)", null);

  const FA = FAC * FAH * topo.FAT;
  const FV = FVC * FVH * topo.FVT;
  const FD = FDC * FDH * topo.FDT;

  const AA = FA * aA0;
  const AV = FV * aA1;
  const beta = code.beta;
  if (params.damping != null && Math.abs(params.damping - 0.05) > 1e-9) {
    throw new Error("Solo está implementado el amortiguamiento de 5% (β = 2,4); 7.6 no está programado");
  }
  const betaStar = Math.max(beta, AV / AA);
  const TC = AV / (code.TC_divisor * AA);
  const TB = code.TB_factor * TC;
  const TA = Math.min(code.TA.max, Math.max(code.TA.min, code.TA.factor * TB));
  const TD = (TL * FD) / FV;
  const q = code.q.valores[clase];

  const { R, Cd, omega0, sistema } = resolveSystem(code, params);
  const tp = code.Tplus;
  const TplusRaw = R < tp.Rlimite ? tp.factor * (R - 1) : tp.constante;
  const Tplus = Math.min(tp.maxTC * TC, Math.max(tp.minTC * TC, TplusRaw));
  if (Tplus !== TplusRaw) notes.push(`T⁺ = ${round(TplusRaw)} acotado a ${round(Tplus)} (7.23)`);

  const rho = params.rho != null ? positive("ρ", params.rho) : 1;
  const FI = params.FI != null ? positive("FI", params.FI) : 1;
  if (FI > code.irregularidad.maximo + 1e-9) {
    throw new Error(`FI no puede superar ${code.irregularidad.maximo} (6.4.b)`);
  }

  const vg = code.vertical.grupos.find((g) => g.clases.includes(clase));
  const vertical = vg && {
    gamma0: vg.gamma0, gammaMax: vg.gammaMax, gammaMin: vg.gammaMin, TCV: vg.TCV,
    eta0: vg.eta0[0] + vg.eta0[1] * aA0,
    etaC: vg.etaC[0] + vg.etaC[1] * aA0,
    TvMax: code.vertical.TvMax,
  };

  return {
    sismo: sismoId, PMR: grupo.PMR, excedencia: grupo.excedencia,
    A0, A1, TL, H, claseSitio: clase, alpha, aA0, aA1,
    FAC, FVC, FDC, FAH, FVH, FDH, FAT: topo.FAT, FVT: topo.FVT, FDT: topo.FDT,
    FA, FV, FD, AA, AV, beta, betaStar, TA, TB, TC, TD, q,
    sistema, R, Cd, omega0, rho, FI, Tplus,
    vertical, notes,
  };
}

// Elástico horizontal A(T), fracción de g (7.1–7.5).
function elastic(r, T) {
  if (T <= r.TA) return r.AA;
  // Con TA acotado a 0,02 s puede quedar TA ≥ TB: entonces no hay rampa.
  if (T <= r.TB && r.TB > r.TA) return r.AA * (1 + ((T - r.TA) / (r.TB - r.TA)) * (r.betaStar - 1));
  if (T <= r.TC) return r.betaStar * r.AA;
  if (T <= r.TD) return r.betaStar * r.AA * (r.TC / T);
  return r.betaStar * r.AA * (r.TC / r.TD) * Math.pow(r.TD / T, r.q);
}

// Inelástico horizontal Ad(T), fracción de g (7.18–7.22).
function inelastic(r, T) {
  const k = r.rho * r.FI;
  if (T <= r.TA) return (k * r.AA) / 1.5;
  if (T <= r.Tplus && r.Tplus > r.TA) {
    return k * r.AA * (1 / 1.5 + (r.betaStar / r.R - 1 / 1.5) * ((T - r.TA) / (r.Tplus - r.TA)));
  }
  const plateau = (k * r.betaStar * r.AA) / r.R;
  if (T <= r.TC) return plateau;
  if (T <= r.TD) return plateau * (r.TC / T);
  return plateau * (r.TC / r.TD) * Math.pow(r.TD / T, r.q);
}

const spectralDisp = (accel, T) => accel * G_CM * Math.pow(T / (2 * Math.PI), 2);

// Desplazamiento elástico D(T) (7.24) y total DT(T) (7.25), en cm.
const displacement = (r, T) => spectralDisp(elastic(r, T), T);
const totalDisplacement = (r, T) => r.Cd * spectralDisp(inelastic(r, T), T);

// Vertical Av(Tv) (7.26–7.33), fracción de g. null para Tv > 2 s (exige estudio especial).
function verticalOrdinate(r, Tv) {
  const v = r.vertical;
  if (!v || Tv > v.TvMax + 1e-9) return null;
  let gamma;
  if (Tv <= 0.02) gamma = v.gamma0;
  else if (Tv < 0.05) gamma = v.gamma0 + (v.gammaMax - v.gamma0) * Math.pow((Tv - 0.02) / 0.03, 0.75);
  else if (Tv <= 0.1) gamma = v.gammaMax;
  else if (Tv < v.TCV) gamma = v.gammaMax + (v.gammaMin - v.gammaMax) * Math.pow((Tv - 0.1) / (v.TCV - 0.1), 0.75);
  else gamma = v.gammaMin;
  const eta = Tv < v.TCV ? v.eta0 + (v.etaC - v.eta0) * Math.pow(Tv / v.TCV, 4) : v.etaC;
  return elastic(r, Tv) * gamma * eta;
}

// Tabla completa (lo que se reporta): rejilla regular sin quiebres insertados, para que
// cada fila caiga en múltiplos exactos del paso.
function table(code, params, { tMax = 4, step = 0.02 } = {}) {
  const r = resolve(code, params);
  const rows = [];
  const n = Math.round(tMax / step);
  for (let i = 0; i <= n; i++) {
    const T = Math.round(i * step * 1e6) / 1e6;
    rows.push({
      T,
      A: elastic(r, T),
      Ad: inelastic(r, T),
      D_cm: displacement(r, T),
      DT_cm: totalDisplacement(r, T),
      Av: verticalOrdinate(r, T),
    });
  }
  return { params: r, rows };
}

// Curva que entra al análisis modal espectral: el inelástico Ad(T).
function sample(code, params, options) {
  const r = resolve(code, params);
  const tMax = Math.max(10, r.TD * 1.25);
  const opts = { tMax, ...(options || {}) };
  return sampleGrid((T) => inelastic(r, T), [r.TA, r.Tplus, r.TB, r.TC, r.TD], opts);
}

module.exports = {
  sample, resolve, table,
  elastic, inelastic, displacement, totalDisplacement, verticalOrdinate,
};
