// Sistema resistente de cada barra (Design ▸ Lateral system): la barra guarda el NOMBRE
// del sistema y la configuración su tipo (SMF/IMF/OMF). Un nombre que ya no existe en la
// configuración no cuenta: la barra queda como solo gravedad.

/** [{ elementId, name, type }] de las barras con un sistema definido. */
function memberLateralSystems(elements, lateralSystems) {
  const byName = new Map((lateralSystems || []).map((s) => [s.name, s]));
  return (elements || [])
    .filter((e) => e.lateralSystem && byName.has(e.lateralSystem))
    .map((e) => ({ elementId: String(e.id), name: e.lateralSystem, type: byName.get(e.lateralSystem).type }));
}

module.exports = { memberLateralSystems };
