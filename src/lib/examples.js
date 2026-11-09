// Modelos de ejemplo (onboarding): proyectos listos para analizar cuyos resultados se
// comparan con una referencia publicada.
//
// Cada ejemplo es una fixture versionada en src/data/examples/<id>.json con:
//  - `project`: los mismos campos de metadatos que crea el asistente (plantilla,
//    formulación, parámetros), para que el visor lo abra como cualquier proyecto;
//  - `catalog`: el material y las secciones que necesita. Las barras referencian el
//    catálogo del USUARIO (ids distintos por cuenta), así que en la fixture van por
//    `frameSectionKey` y se resuelven al crear el proyecto;
//  - `model`: el cuerpo de PUT /model, salvo esa clave;
//  - `reference`: entradas, fórmulas, fuente y valores esperados. Son DATOS: el test
//    examples.test.js los recalcula desde las entradas y desde el catálogo AISC.
//
// Una fixture no se edita en sitio: si cambia, sube `version`. Los proyectos ya creados
// guardan la versión con la que nacieron y no se comparan contra otra.

const EXAMPLES = {
  tm01: require("../data/examples/tm01.json"),
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
 * Cuerpo de PUT /model para el ejemplo, con cada `frameSectionKey` cambiado por el id
 * de la sección del catálogo del usuario. Lanza si una clave no está resuelta: un
 * ejemplo con barras sin sección no se puede analizar y no debe crearse.
 */
function buildExampleModel(example, sectionIdByKey) {
  const { model } = example;
  const elements = model.elements.map(({ frameSectionKey, ...element }) => {
    const id = sectionIdByKey[frameSectionKey];
    if (!id) throw new Error(`Sección sin resolver en el ejemplo ${example.id}: ${frameSectionKey}`);
    return { ...element, frameSectionId: id };
  });
  return { ...model, elements };
}

/** Metadatos de ejemplo guardados en Project.params.example, o null. */
function exampleMeta(project) {
  const meta = project && project.params && project.params.example;
  return meta && typeof meta.id === "string" ? meta : null;
}

module.exports = { listExamples, getExample, buildExampleModel, exampleMeta };
