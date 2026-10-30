const { z } = require("zod");

// Id de dominio del nudo o la barra ("N1", "B7"), el mismo que usa el resto del modelo.
const domainId = z.string().trim().min(1).max(64);

const inspectConnectionSchema = z.object({
  nodeId: domainId,
});

// Tipologías que el motor sabe evaluar (ver calc-service app/connections/typologies.py).
const TYPOLOGIES = ["shear_tab", "extended_end_plate"];

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
    demand: z
      .object({
        Ry: z.number().min(1).max(2).nullable(),
        RyColumn: z.number().min(1).max(2).nullable(),
        gravityCombination: z.string().trim().min(1).max(120).nullable(),
        hingeDistance: length,
        // Axial de compresión de la columna según AISC 341-22 D1.4a (incluye la carga
        // sísmica con sobrerresistencia), en kN. 0 = sin compresión.
        columnPr: z.number().min(0).finite().nullable(),
        // ¿El análisis de estabilidad considera la deformación inelástica de la zona de
        // panel? (AISC 360-22 J10.6(b)). null/false = J10.6(a).
        panelZoneInStability: yesNo,
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

const PARAMS_SCHEMAS = {
  shear_tab: { 1: shearTabParamsV1 },
  extended_end_plate: { 1: endPlateParamsV1 },
};

const updateConnectionSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    // Cambiar la edición invalida la última comprobación, igual que cambiar parámetros.
    code: z.enum(CODES).optional(),
    // Se valida contra la tipología de la conexión en el servicio (depende de ella).
    params: z.record(z.any()).optional(),
  })
  .strict();

const listConnectionsQuery = z.object({ nodeId: domainId.optional() });

module.exports = {
  inspectConnectionSchema,
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
