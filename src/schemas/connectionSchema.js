const { z } = require("zod");

// Id de dominio del nudo o la barra ("N1", "B7"), el mismo que usa el resto del modelo.
const domainId = z.string().trim().min(1).max(64);

const inspectConnectionSchema = z.object({
  nodeId: domainId,
});

// Tipologías que el motor sabe evaluar (ver calc-service app/connections/typologies.py).
const TYPOLOGIES = ["shear_tab"];

const createConnectionSchema = z
  .object({
    nodeId: domainId,
    elementId: domainId, // la barra apoyada
    typology: z.enum(TYPOLOGIES),
    name: z.string().trim().min(1).max(80).optional(),
  })
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
const length = z.number().positive().finite().nullable();

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

const PARAMS_SCHEMAS = { shear_tab: { 1: shearTabParamsV1 } };

const updateConnectionSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
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
};
