/**
 * Decide qué eventos de avance se escriben en la base de datos: siempre el primero de
 * cada fase y el último de la comprobación, y entre medias uno por `everyMs` como mucho.
 * El calc-service manda uno cada 0,5 s; escribirlos todos sería ruido para la BD.
 */
function progressThrottle(everyMs = 1000, now = () => Date.now()) {
  let lastStep = null;
  let lastAt = -Infinity;
  return (event) => {
    const t = now();
    const finished = event.current != null && event.current === event.total;
    if (event.step !== lastStep || finished || t - lastAt >= everyMs) {
      lastStep = event.step;
      lastAt = t;
      return true;
    }
    return false;
  };
}

module.exports = { progressThrottle };
