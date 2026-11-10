// Modelos de ejemplo (onboarding): proyectos listos para analizar cuyos resultados se
// comparan con una referencia publicada.
//
// Cada ejemplo es una fixture versionada en src/data/examples/<id>.json con:
//  - `project`: los mismos campos de metadatos que crea el asistente (plantilla,
//    formulación, parámetros), para que el visor lo abra como cualquier proyecto;
//  - `catalog`: los materiales y las secciones (de barra y de área) que necesita. El
//    modelo referencia el catálogo del USUARIO (ids distintos por cuenta), así que en
//    la fixture va por `frameSectionKey` / `areaSectionKey` y se resuelve al crear;
//  - `model`: el cuerpo de PUT /model, salvo esa clave;
//  - `reference`: entradas, fórmulas, fuente y valores esperados. Son DATOS: el test
//    examples.test.js los recalcula desde las entradas y desde el catálogo AISC.
//
// Una fixture no se edita en sitio: si cambia, sube `version`. Los proyectos ya creados
// guardan la versión con la que nacieron y no se comparan contra otra.

const EXAMPLES = {
  tm01: require("../data/examples/tm01.json"),
  tm02: require("../data/examples/tm02.json"),
};

/** Lista pública de ejemplos (sin modelo ni referencia). */
function listExamples() {
  return Object.values(EXAMPLES).map((ex) => ({
    id: ex.id,
    version: ex.version,
    code: ex.code,
    templateId: ex.project.templateId,
    analysisType: ex.project.analysisType,
  }));
}

/** La fixture de un ejemplo, o null si no existe. */
function getExample(id) {
  return Object.prototype.hasOwnProperty.call(EXAMPLES, id) ? EXAMPLES[id] : null;
}

/**
 * Cuerpo de PUT /model para el ejemplo, con cada `frameSectionKey` / `areaSectionKey`
 * cambiado por el id de la sección del catálogo del usuario. Lanza si una clave no está
 * resuelta: un ejemplo con barras o losas sin sección no se puede analizar y no debe
 * crearse.
 */
function buildExampleModel(example, sectionIdByKey) {
  const resolve = (key) => {
    const id = sectionIdByKey[key];
    if (!id) throw new Error(`Sección sin resolver en el ejemplo ${example.id}: ${key}`);
    return id;
  };
  const { model } = example;
  const elements = model.elements.map(({ frameSectionKey, ...element }) => ({
    ...element,
    frameSectionId: resolve(frameSectionKey),
  }));
  const out = { ...model, elements };
  if (Array.isArray(model.areas)) {
    out.areas = model.areas.map(({ areaSectionKey, ...area }) => ({
      ...area,
      areaSectionId: resolve(areaSectionKey),
    }));
  }
  return out;
}

/** Metadatos de ejemplo guardados en Project.params.example, o null. */
function exampleMeta(project) {
  const meta = project && project.params && project.params.example;
  return meta && typeof meta.id === "string" ? meta : null;
}

module.exports = { listExamples, getExample, buildExampleModel, exampleMeta };
