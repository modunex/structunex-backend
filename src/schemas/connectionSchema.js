const { z } = require("zod");

// Id de dominio del nudo o la barra ("N1", "B7"), el mismo que usa el resto del modelo.
const domainId = z.string().trim().min(1).max(64);

const inspectConnectionSchema = z.object({
  nodeId: domainId,
});

// Tipologías que el motor sabe evaluar (ver calc-service app/connections/typologies.py).
const TYPOLOGIES = ["shear_tab", "double_angle", "extended_end_plate"];

// AISC 358-22 Cap. 6: placa extendida de 4 pernos sin y con rigidizador, y de 8 pernos.
const END_PLATE_CONFIGURATIONS = ["4E", "4ES", "8ES"];

// Ediciones de AISC 360 que el motor sabe aplicar (calc-service
// app/connections/aisc/editions.py). Las conexiones nuevas usan la vigente; las guardadas
// antes de existir este campo siguen en 360-16 (default de la columna).
const CODES = ["AISC360-16", "AISC360-22"];
const DEFAULT_CODE = "AISC360-22";

const createConnectionSchema = z
  .object({
    nodeId: domainId,
    elementId: domainId, // la barra apoyada
    typology: z.enum(TYPOLOGIES),
    name: z.string().trim().min(1).max(80).optional(),
    code: z.enum(CODES).optional(),
    // Solo la placa extendida: la configuración que se crea (el motor dice cuáles aplican).
    configuration: z.enum(END_PLATE_CONFIGURATIONS).optional(),
  })
  .strict()
  .refine((b) => (b.typology === "extended_end_plate") === (b.configuration !== undefined), {
    message: "La placa extendida necesita su configuración (4E, 4ES u 8ES), y solo ella.",
    path: ["configuration"],
  });

// Longitud en unidades base (m): positiva y finita; null = sin definir.
const length = z.number().positive().finite().nullable();

// ─── Parámetros de la placa extendida (AISC 358-22), versión 1 ───
// Unidades base (m). Todo opcional y anulable: lo que falte lo trata el motor como NO
// VERIFICABLE, nunca con un valor por defecto. Aquí solo la FORMA; los límites (Tabla 6.1,
// §6.6) los comprueba el motor con su referencia. `.strict()`: lo desconocido se rechaza.
const yesNo = z.boolean().nullable();
const endPlateParamsV1 = z
  .object({
    configuration: z.enum(END_PLATE_CONFIGURATIONS).nullable(),
    plate: z
      .object({ thickness: length, width: length, materialId: z.string().uuid().nullable() })
      .partial()
      .strict(),
    bolts: z
      .object({
        diameter: length,
        grade: z.enum(["A325", "A490"]).nullable(),
        threads: z.enum(["N", "X"]).nullable(),
      })
      .partial()
      .strict(),
    geometry: z
      .object({ gage: length, pfi: length, pfo: length, pb: length, de: length })
      .partial()
      .strict(),
    stiffener: z.object({ thickness: length, length: length }).partial().strict(),
    welds: z.object({ reinforcingFillet: length, webFillet: length }).partial().strict(),
    column: z.object({ continuityPlates: yesNo }).partial().strict(),
    // Placas de continuidad (AISC 341-22 E3.6f.2), si están.
    continuityPlate: z
      .object({
        thickness: length,
        width: length, // por lado: del alma al borde
        clip: length,
        flangeWeld: z.enum(["CJP", "fillet"]).nullable(),
        flangeFillet: length,
        webFillet: length,
      })
      .partial()
      .strict(),
    // Refuerzo de la zona de panel (AISC 341-22 E3.6e.3): ninguna, en contacto con el alma
    // o separadas (en pares simétricos). Medidas en m. Lo que falte: NO VERIFICABLE.
    doublerPlate: z
      .object({
        arrangement: z.enum(["none", "contact", "spaced"]).nullable(),
        count: z.union([z.literal(1), z.literal(2)]).nullable(),
        thickness: length,
        materialId: z.string().uuid().nullable(), // null = el acero de la placa extrema
        height: length, // null = la que exige la disposición (el motor lo declara)
        width: length, // null = wz = dc − 2tcf
        offset: length, // separadas: distancia libre del alma a la placa
        extent: z.enum(["extended", "between"]).nullable(), // respecto a las placas de continuidad
        flangeWeld: z.enum(["CJP", "PJP", "fillet"]).nullable(),
        flangeWeldSize: length, // garganta PJP / lado del filete
        edgeWeld: length, // filete en los bordes superior e inferior
      })
      .partial()
      .strict(),
    demand: z
      .object({
        Ry: z.number().min(1).max(2).nullable(),
        RyColumn: z.number().min(1).max(2).nullable(),
        gravityCombination: z.string().trim().min(1).max(120).nullable(),
        // Factor de la carga viva en la combinación automática de Vgravity (AISC 358
        // §2.4.3): 0,5; 1,0 en garajes y uso público con L > 100 psf. null = 0,5.
        f1: z.number().gt(0).max(1).nullable(),
        hingeDistance: length,
        // Axial de compresión de la columna según AISC 341-22 D1.4a (incluye la carga
        // sísmica con sobrerresistencia), en kN. 0 = sin compresión.
        columnPr: z.number().min(0).finite().nullable(),
        // ¿El análisis de estabilidad considera la deformación inelástica de la zona de
        // panel? (AISC 360-22 J10.6(b)). null/false = J10.6(a).
        panelZoneInStability: yesNo,
        // Cortante de columna en la demanda de la zona de panel (AISC 341-22 E3.6e.1 y su
        // comentario): neglect = despreciado (conservador); midHeight = descontado con
        // puntos de inflexión a media altura de los entrepisos del modelo.
        panelZoneColumnShear: z.enum(["neglect", "midHeight"]).nullable(),
      })
      .partial()
      .strict(),
    declarations: z
      .object({
        flangeWeldCJP: yesNo,
        noWeldAccessHoles: yesNo,
        boltsPretensioned: yesNo,
        lateralBracing: yesNo,
        protectedZone: yesNo,
        slab: yesNo,
        materials: yesNo,
      })
      .partial()
      .strict(),
  })
  .partial()
  .strict();

// ─── Parámetros del shear tab, versión 1 ───
//
// Unidades base del proyecto: longitudes en m. Todo es opcional y anulable: lo que no
// esté definido lo trata la comprobación (F3) como NO VERIFICABLE, nunca con un valor
// por defecto. Aquí solo se valida la FORMA (positivos, enteros, enumerados); los límites
// del procedimiento (nº de pernos, distancias mínimas…) los comprueba el motor con su
// referencia normativa.
//
// `.strict()` en todos los niveles: un campo que no se conoce se RECHAZA en vez de
// descartarse en silencio. Perder un dato de entrada sin avisar es peor que un 400.

const shearTabParamsV1 = z
  .object({
    plate: z
      .object({
        thickness: length,
        // Ancho horizontal de la placa (de la soldadura al borde libre).
        width: length,
        // Lado del alma de la viga en el que va la placa, en el marco de la conexión
        // (n = z × u). null = +n, y el layout lo declara. No cambia la comprobación.
        side: z.enum(["+n", "-n"]).nullable(),
        // Material del catálogo del usuario (aporta Fy y Fu).
        materialId: z.string().uuid().nullable(),
      })
      .partial()
      .strict(),
    bolts: z
      .object({
        diameter: length,
        grade: z.enum(["A325", "A490"]).nullable(), // ASTM F3125
        threads: z.enum(["N", "X"]).nullable(), // roscas incluidas / excluidas del plano de corte
        hole: z.enum(["STD", "SSLT"]).nullable(), // estándar / ranurado corto horizontal
        rows: z.number().int().min(1).max(20).nullable(), // una sola columna de pernos
        pitch: length, // separación vertical entre pernos
        edgeVertical: length, // distancia al borde vertical (placa y alma)
        edgeHorizontalPlate: length, // perno → borde libre de la placa
        edgeHorizontalBeam: length, // perno → extremo del alma de la viga
        // ¿La deformación del agujero en servicio es un criterio de diseño? (J3.10)
        // considered → Ec. J3-6a/c; notConsidered → J3-6b/d. null = considered (lo más
        // conservador), y el resultado lo declara como hipótesis.
        bearingDeformation: z.enum(["considered", "notConsidered"]).nullable(),
        // Del borde superior de la viga al primer perno (opcional). Sin ella solo se
        // comprueba que la placa cabe por longitud, y el resultado lo declara.
        topDistance: length,
      })
      .partial()
      .strict(),
    weld: z
      .object({
        size: length, // garganta nominal del filete (pierna)
        electrode: z.enum(["E70"]).nullable(),
      })
      .partial()
      .strict(),
    // Distancia de la línea de soldadura (cara del apoyo) a la línea de pernos: la `a`
    // del procedimiento.
    boltLineDistance: length,
    // Holgura entre la cara del apoyo y el extremo de la viga.
    setback: z.number().min(0).finite().nullable(),
  })
  .partial()
  .strict();

// ─── Parámetros del doble ángulo atornillado, versión 1 ───
// (calc-service app/connections/aisc/double_angle.py; Manual Parte 10, II.A-1A). Mismas
// reglas que el shear tab: todo opcional y anulable, lo que falta es NO VERIFICABLE.
const doubleAngleParamsV1 = z
  .object({
    angles: z
      .object({
        legBeam: length, // ala contra el alma de la viga
        legSupport: length, // ala contra el apoyo
        thickness: length,
        materialId: z.string().uuid().nullable(),
      })
      .partial()
      .strict(),
    bolts: z
      .object({
        diameter: length,
        grade: z.enum(["A325", "A490"]).nullable(),
        threads: z.enum(["N", "X"]).nullable(),
        hole: z.enum(["STD"]).nullable(),
        rows: z.number().int().min(1).max(20).nullable(),
        pitch: length,
        edgeVertical: length,
        bearingDeformation: z.enum(["considered", "notConsidered"]).nullable(),
        topDistance: length,
      })
      .partial()
      .strict(),
    // Del talón (cara del apoyo) a la línea de pernos de la viga.
    beamGage: length,
    // Entre las dos líneas de pernos del apoyo (a través del alma).
    supportGage: length,
    setback: z.number().min(0).finite().nullable(),
  })
  .partial()
  .strict();

const PARAMS_SCHEMAS = {
  shear_tab: { 1: shearTabParamsV1 },
  double_angle: { 1: doubleAngleParamsV1 },
  extended_end_plate: { 1: endPlateParamsV1 },
};

// ─── Operaciones (modelado por operaciones) ───
// La FORMA completa la valida el calc-service (app/connections/operations/schema.py),
// que es quien las ejecuta: aquí solo lo que no depende del motor (tipo e id de cada
// operación, tamaño de la lista). Antes de guardar, el servicio las ejecuta y rechaza
// una lista que el motor no acepta (422 con el motivo).
const OPERATION_KINDS = ["cut", "plate", "angle", "boltGrid", "weld"];
const operationSchema = z
  .object({
    op: z.enum(OPERATION_KINDS),
    id: z.string().trim().min(1).max(40).regex(/^[A-Za-z0-9_-]+$/),
  })
  .passthrough();
// null = volver a la plantilla de la tipología.
const operationsSchema = z.array(operationSchema).max(200).nullable();

const updateConnectionSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    // Cambiar la edición invalida la última comprobación, igual que cambiar parámetros.
    code: z.enum(CODES).optional(),
    // Se valida contra la tipología de la conexión en el servicio (depende de ella).
    params: z.record(z.any()).optional(),
    // Lista = conexión personalizada; null = la plantilla. Invalida la última comprobación.
    operations: operationsSchema.optional(),
  })
  .strict();

// Vista previa de la geometría: lo que se quiere ver sin guardar. Sin campos = lo guardado.
const layoutPreviewSchema = z
  .object({
    params: z.record(z.any()).optional(),
    operations: operationsSchema.optional(),
  })
  .strict();

// Fase 3 (CBFEM): tipo de análisis. No lineal por defecto (plasticidad, NLGEOM, pernos
// y contacto); el lineal es una vista rápida sin contacto.
const femStartSchema = z
  .object({
    analysis: z.enum(["linear", "nonlinear"]).default("nonlinear"),
    // Dónde actúan las fuerzas del análisis global: en el nudo o en el grupo de pernos.
    forcesAt: z.enum(["node", "bolts"]).default("node"),
    // Fase 5: curva M–φ y clasificación de rigidez (un análisis no lineal más por viga).
    stiffness: z.boolean().default(false),
    // Fase 5: diseño por capacidad (AISC 358-22 §2.4). Presente = se analiza (requiere
    // no lineal). En la plantilla end plate manda su procedimiento; en una conexión
    // personalizada Ry y Sh son obligatorios (el motor no supone ninguno).
    capacity: z
      .object({
        Ry: z.number().min(1).max(2).nullable().optional(),
        Sh: z.number().positive().max(5).nullable().optional(),
        Lh: z.number().positive().max(100).nullable().optional(),
        gravityCombination: z.string().min(1).max(120).nullable().optional(),
      })
      .strict()
      .nullable()
      .optional(),
    // Rendimiento: solo las combinaciones gobernantes (por defecto) o todas.
    combinationsMode: z.enum(["governing", "all"]).default("governing"),
    // No linealidad geométrica (grandes desplazamientos). Por defecto sí.
    geometricNonlinear: z.boolean().default(true),
  })
  .strict();

const listConnectionsQuery = z.object({ nodeId: domainId.optional() });

module.exports = {
  femStartSchema,
  inspectConnectionSchema,
  layoutPreviewSchema,
  operationsSchema,
  OPERATION_KINDS,
  createConnectionSchema,
  updateConnectionSchema,
  listConnectionsQuery,
  shearTabParamsV1,
  PARAMS_SCHEMAS,
  TYPOLOGIES,
  END_PLATE_CONFIGURATIONS,
  endPlateParamsV1,
  CODES,
  DEFAULT_CODE,
};
