const { prisma } = require("../config/db");

// El esquema vive en prisma/schema.prisma. Este archivo solo conserva la tabla que
// recorre el modelo estructural: cada clave del payload anidado `model` y el delegate
// de Prisma de su tabla. El servicio la itera para repartir al escribir, montar al leer
// y limpiar al borrar, así que añadir un tipo de entidad es añadir una línea aquí.
//
// `name` se usa como prisma[name] fuera de una transacción y como tx[name] dentro.
// Materiales y secciones NO son tablas del modelo: barras y áreas referencian los
// catálogos del usuario (catalog_frame_sections / catalog_area_sections).
const CHILD_MODELS = [
  { key: "nodes", name: "modelNode" },
  { key: "elements", name: "modelElement" },
  { key: "supports", name: "modelSupport" },
  { key: "loads", name: "modelLoad" },
  { key: "areas", name: "modelArea" },
  { key: "frameLoads", name: "modelFrameLoad" },
  { key: "areaLoads", name: "modelAreaLoad" },
  { key: "areaSprings", name: "modelAreaSpring" },
];

module.exports = { prisma, CHILD_MODELS };
