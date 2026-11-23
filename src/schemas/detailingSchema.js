const { z } = require("zod");

// Rebar Studio D3: elecciones del ingeniero para la propuesta de armado de una viga.
// Mismos nombres y límites que calc-service `app/detailing/propose.py::Params`.
const barId = z.string().min(1).max(40).nullish();

const detailingParams = z
  .object({
    topBarId: barId,
    bottomBarId: barId,
    stirrupBarId: barId,
    stirrupLegs: z.number().int().min(2).max(6).optional(),
    minTop: z.number().int().min(2).max(8).optional(),
    minBottom: z.number().int().min(2).max(8).optional(),
    // Longitud comercial de barra (m): 6 a 18 m cubre los mercados habituales.
    stockLength: z.number().min(6).max(18).optional(),
    // Redondeo de la separación de estribos (m).
    spacingStep: z.union([z.literal(0.01), z.literal(0.025), z.literal(0.05)]).optional(),
    // Tamaño máximo del agregado (m), para la separación libre de 25.2.1.
    aggregate: z.number().min(0.009).max(0.04).optional(),
  })
  .strict();

// Cuerpos de POST /detailing/members y PUT /detailing/members/:id.
const createMemberBody = z.object({ elementId: z.string().min(1), params: detailingParams.optional() }).strict();
const updateMemberBody = z.object({ params: detailingParams }).strict();

module.exports = { detailingParams, createMemberBody, updateMemberBody };
