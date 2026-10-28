const { z } = require("zod");

// Zod validates the request body BEFORE it touches the database. These per-entity
// schemas back the sub-resource routes: the full object for POST, and
// `.partial()` for PATCH. They carry NO `.default()` — Postgres fills defaults
// on insert, so `.partial()` never injects a default that would overwrite an
// unspecified field on update.

const node = z.object({
  id: z.string().min(1),
  x: z.number(),
  y: z.number(),
  z: z.number().optional(), // column default 0
});

// Barra: referencia una frame section del catálogo (CatalogFrameSection, que
// lleva su material). frameSectionId es opcional (se puede dibujar sin asignar).
// Componentes liberadas en UN extremo, en ejes locales (nombres SAP2000):
// P axial, V2/V3 cortantes, T torsión, M2/M3 flexión.
const endReleases = z
  .object({
    p: z.boolean().optional(),
    v2: z.boolean().optional(),
    v3: z.boolean().optional(),
    t: z.boolean().optional(),
    m2: z.boolean().optional(),
    m3: z.boolean().optional(),
  })
  .optional();

const element = z.object({
  id: z.string().min(1),
  nodeA: z.string().min(1),
  nodeB: z.string().min(1),
  frameSectionId: z.string().optional(),
  // Section orientation about the member axis, in degrees (SAP2000 "angle").
  // Optional: the column defaults to 0.
  roll: z.number().optional(),
  // Liberaciones de extremo (SAP2000 "Frame Releases"): i = extremo inicial (nodeA),
  // j = extremo final (nodeB). Ausente = ambos extremos empotrados.
  releases: z
    .object({ i: endReleases, j: endReleases })
    .nullable()
    .optional(),
});

// Booleans/numbers below are optional (no Zod default) — the columns default them
// to false / 0 on insert.
const support = z.object({
  nodeId: z.string().min(1),
  dx: z.boolean().optional(),
  dy: z.boolean().optional(),
  dz: z.boolean().optional(),
  rx: z.boolean().optional(),
  ry: z.boolean().optional(),
  rz: z.boolean().optional(),
});

const load = z.object({
  nodeId: z.string().min(1),
  // Required: the calc-service attributes every nodal load to a Load Pattern
  // (NodalLoadV2.loadPattern is mandatory), same as frame/area loads.
  loadPattern: z.string().min(1),
  fx: z.number().optional(),
  fy: z.number().optional(),
  fz: z.number().optional(),
  mx: z.number().optional(),
  my: z.number().optional(),
  mz: z.number().optional(),
});

const loadDir = z.enum(["gx", "gy", "gz", "gravity"]);

// Carga sobre una barra: distribuida uniforme (fuerza/longitud) o puntual
// (fuerza en la posición relativa `dist` 0..1).
const frameLoad = z.object({
  elementId: z.string().min(1),
  loadPattern: z.string().min(1),
  kind: z.enum(["distributed", "point"]).optional(),
  dir: loadDir.optional(),
  value: z.number().optional(),
  dist: z.number().min(0).max(1).optional(),
});

// Carga uniforme de superficie sobre un área (fuerza/área).
const areaLoad = z.object({
  areaId: z.string().min(1),
  loadPattern: z.string().min(1),
  dir: loadDir.optional(),
  value: z.number().optional(),
});

// Resorte de superficie sobre un área (SAP2000 "Assign ▸ Area ▸ Springs"): el
// módulo de balasto del terreno bajo una losa de cimentación, en kN/m³. Sin
// loadPattern: la rigidez es del modelo, no de un caso de carga.
const areaSpring = z.object({
  areaId: z.string().min(1),
  stiffness: z.number().nonnegative(),
  resists: z.enum(["compressionOnly", "tensionOnly", "both"]).optional(),
  face: z.enum(["bottom", "top"]).optional(),
  outward: z.boolean().optional(),
});

// Elemento de área (muro/losa/shell), definido por sus nodos de contorno.
// sectionId (Area Section del catálogo) es opcional: un área puede dibujarse y
// persistirse antes de asignarle sección.
const area = z.object({
  id: z.string().min(1),
  nodeIds: z.array(z.string().min(1)).min(3),
  areaSectionId: z.string().optional(),
  // Per-area auto-mesh divisions (SAP-style N x M); null/absent => automatic default.
  mesh: z
    .object({
      along12: z.number().int().min(1).max(100),
      along13: z.number().int().min(1).max(100),
    })
    .nullable()
    .optional(),
  // Orientación de los ejes locales alrededor de la normal (eje local 3), en grados
  // (ángulo "local axis" estilo SAP2000). Por defecto 0.
  localAxisAngle: z.number().optional(),
  // Diafragma rígido al que pertenece el área: referencia por nombre a
  // configuration.diaphragms[].name. null = sin diafragma.
  diaphragm: z.string().min(1).nullish(),
});

// Project holds metadata only; the structural model is built incrementally via
// the sub-resource routes. ownerId is NOT accepted from the client — the server
// derives it from the authenticated Clerk user (req.userId).
// Ojo: Zod descarta las claves que no estén declaradas aquí, así que un
// parámetro nuevo en el asistente del frontend (data/templates.ts) se perdería
// en silencio al guardar y el visor regeneraría la geometría con el valor por
// defecto. Toda clave de ModelParams debe tener su entrada en este schema.
const modelParamsSchema = z
  .object({
    length: z.number().optional(),
    beamSupports: z.string().optional(),
    span: z.number().optional(),
    height: z.number().optional(),
    panels: z.number().int().optional(),
    supports: z.string().optional(),
    width: z.number().optional(),
    depth: z.number().optional(),
    // Rejilla del pórtico 3D: vanos por dirección y número de plantas.
    baysX: z.number().int().optional(),
    baysY: z.number().int().optional(),
    stories: z.number().int().optional(),
  })
  .partial();

const createProjectSchema = z.object({
  name: z.string().min(1),
  code: z.string().min(1).optional(),
  templateId: z.string().optional(),
  params: modelParamsSchema.optional(),
  analysisType: z.string().optional(),
  dofPerNode: z.number().optional(),
  units: z.string().optional(),
  client: z.string().optional(),
  company: z.string().optional(),
  engineer: z.string().optional(),
  description: z.string().optional(),
  // Bloqueo del modelo. Se auto-activa al correr análisis; el desbloqueo manual
  // llega por PATCH con { isLocked: false }.
  isLocked: z.boolean().optional(),
});

const updateProjectMetaSchema = createProjectSchema.partial();

module.exports = {
  // Per-entity schemas — used by the sub-resource routes (full for POST,
  // .partial() for PATCH).
  node,
  element,
  support,
  load,
  area,
  frameLoad,
  areaLoad,
  areaSpring,
  createProjectSchema,
  updateProjectMetaSchema,
};
