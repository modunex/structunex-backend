const { z } = require("zod");
const {
  node,
  element,
  support,
  load,
  area,
  frameLoad,
  areaLoad,
  areaSpring,
} = require("./projectSchema");

// Configuración no-geométrica del modelo (grid + defaults). Un único doc por
// proyecto; se envía como objeto (no array) y el backend hace upsert.
const gridLine = z.object({ id: z.string().min(1), ordinate: z.number() });
const gridSystem = z.object({
  x: z.array(gridLine),
  y: z.array(gridLine),
  z: z.array(gridLine),
});
const loadPattern = z.object({
  name: z.string().min(1),
  type: z
    .enum([
      "dead",
      "superDead",
      "live",
      "roofLive",
      "wind",
      "snow",
      "rain",
      "quake",
      "other",
    ])
    .optional(),
  selfWeightMultiplier: z.number().optional(),
});

// Combinación de carga: suma lineal de términos. Cada término es exactamente uno de:
//  - { pattern, factor }      término estático (pattern = loadPatterns[].name)
//  - { seismic:true, factor } término sísmico (se resuelve a los casos Response Spectrum
//                             por tipo; name-free, robusto a renombrar el caso RS).
const comboFactor = z.union([
  z.object({ pattern: z.string().min(1), factor: z.number() }).strict(),
  z.object({ seismic: z.literal(true), factor: z.number() }).strict(),
]);
const loadCombination = z.object({
  name: z.string().min(1),
  factors: z.array(comboFactor),
});

// Mass Source (Define → Mass Source): masa para el análisis modal futuro.
const massMultiplier = z.object({
  pattern: z.string().min(1),
  multiplier: z.number(),
});
const massSource = z.object({
  name: z.string().min(1),
  elementSelfMass: z.boolean(),
  specifiedLoadPatterns: z.boolean(),
  multipliers: z.array(massMultiplier),
});

// Load Case tipo Modal (Define → Load Cases): parámetros del análisis modal.
const modalCase = z.object({
  name: z.string().min(1),
  typeOfModes: z.enum(["eigen", "ritz"]),
  maxModes: z.number().int().positive(),
  minModes: z.number().int().positive(),
});

// Diafragma rígido con nombre (Assign ▸ Área ▸ Diafragma). Solo la definición: las
// áreas se enganchan por `area.diaphragm === name`.
const diaphragm = z.object({ name: z.string().min(1) });

// Sistema resistente a cargas laterales (Analysis ▸ Assign ▸ Sistema resistente). Las
// barras se enganchan por `element.lateralSystem === name`. El tipo decide qué
// conexiones precalificadas (AISC 358) se pueden ofrecer: OMF no tiene ninguna.
const LATERAL_SYSTEM_TYPES = ["SMF", "IMF", "OMF"];
const SEISMIC_CODES = ["AISC341-22"];
const lateralSystem = z
  .object({
    name: z.string().trim().min(1).max(80),
    type: z.enum(LATERAL_SYSTEM_TYPES),
    code: z.enum(SEISMIC_CODES),
  })
  .strict();

// Función de espectro de respuesta (Define ▸ Funciones). Se guardan los
// PARÁMETROS de la norma, no la curva: la curva se regenera en el cliente desde
// el catálogo (GET /seismic-codes), así que almacenarla solo la dejaría
// desincronizada.
//
// `source` y `params` son OPACOS a propósito. El backend nunca usa esos
// parámetros —los guarda y los devuelve—, y quien de verdad valida es el
// generador de cada norma en el cliente, que revienta con lo que no resuelve.
// Gracias a eso, añadir una norma no toca este archivo.
const spectrumFunction = z.object({
  name: z.string().min(1),
  source: z.string().min(1),
  damping: z.number().positive(),
  params: z.record(z.unknown()).default({}),
});

// Caso de carga tipo Response Spectrum (Define → Casos de carga). Referencia por
// nombre la función de espectro y el caso modal del que toma los modos, igual
// que las cargas referencian loadPatterns[].name. La coherencia de esas
// referencias la valida el cliente: aquí solo se comprueba la forma.
const spectrumLoadRow = z.object({
  direction: z.enum(["UX", "UY", "UZ"]),
  function: z.string().min(1),
  scaleFactor: z.number(),
});

const responseSpectrumCase = z.object({
  name: z.string().min(1),
  modalCase: z.string().min(1),
  loads: z.array(spectrumLoadRow),
  modalCombination: z.enum(["CQC", "SRSS"]),
  directionalCombination: z.enum(["SRSS", "ABS"]),
  modalDamping: z.number().positive().lt(1),
  diaphragmEccentricity: z.number().min(0).lt(1),
});

// GDL disponibles elegidos por el usuario (Analizar → Opciones de análisis,
// estilo SAP2000 "Available DOFs"). null/ausente = automático (se deducen de la
// formulación del proyecto o de la geometría).
const dofKey = z.enum(["UX", "UY", "UZ", "RX", "RY", "RZ"]);

const configuration = z
  .object({
    gridSystem: gridSystem.nullable().optional(),
    activeDofs: z.array(dofKey).nullable().optional(),
    defaultFrameSectionId: z.string().nullable().optional(),
    defaultAreaSectionId: z.string().nullable().optional(),
    loadPatterns: z.array(loadPattern).optional(),
    loadCombinations: z.array(loadCombination).optional(),
    massSource: massSource.nullable().optional(),
    modalCases: z.array(modalCase).optional(),
    diaphragms: z.array(diaphragm).optional(),
    lateralSystems: z
      .array(lateralSystem)
      .refine((list) => new Set(list.map((x) => x.name)).size === list.length, {
        message: "Nombres de sistema resistente repetidos",
      })
      .optional(),
    spectrumFunctions: z.array(spectrumFunction).optional(),
    responseSpectrumCases: z.array(responseSpectrumCase).optional(),
  })
  .strict();

// Body del reconcile PUT /projects/:id/model. Cada clave es opcional: solo se
// reemplazan las colecciones presentes (delta por colección). Reutiliza los
// mismos schemas por entidad que las rutas de sub-recurso.
const modelSchema = z
  .object({
    nodes: z.array(node).optional(),
    elements: z.array(element).optional(),
    supports: z.array(support).optional(),
    loads: z.array(load).optional(),
    areas: z.array(area).optional(),
    frameLoads: z.array(frameLoad).optional(),
    areaLoads: z.array(areaLoad).optional(),
    areaSprings: z.array(areaSpring).optional(),
    configuration: configuration.optional(),
  })
  .strict();

module.exports = { modelSchema };
