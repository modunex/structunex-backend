const { z } = require("zod");

// Catálogo de secciones de área por usuario (réplica del "Shell Section Data"
// de SAP2000). v1: solo kind "shell". ownerId se toma del token de Clerk, nunca
// del body. materialId se valida (pertenencia) en el servicio.

const SHELL_TYPES = [
  "shell-thin",
  "shell-thick",
  "plate-thin",
  "plate-thick",
  "membrane",
];

// Modificadores de rigidez: membrana (f11/f22/f12), flexión (m11/m22/m12),
// cortante transversal (v13/v23), masa y peso. Default 1 (sin modificar).
const modifier = z.number().nonnegative().default(1);
const modifiers = z
  .object({
    f11: modifier,
    f22: modifier,
    f12: modifier,
    m11: modifier,
    m22: modifier,
    m12: modifier,
    v13: modifier,
    v23: modifier,
    mass: modifier,
    weight: modifier,
  })
  .default({});

// Losa colaborante (kind "deck"): geometría en m y dirección de los nervios en grados.
// El servicio deriva de aquí el espesor del shell y los modificadores de peso y masa
// (ver lib/deckSection), así que esos campos no se aceptan a mano para un deck.
const deck = z.object({
  tc: z.number().positive(),
  hr: z.number().positive(),
  wrTop: z.number().positive(),
  wrBot: z.number().positive(),
  sr: z.number().positive(),
  t: z.number().positive(),
  ribAngle: z.number().default(0),
  deckMaterialId: z.string().min(1),
});

const createCatalogAreaSection = z.object({
  name: z.string().min(1),
  kind: z.enum(["shell", "deck"]).default("shell"),
  deck: deck.optional(),
  shellType: z.enum(SHELL_TYPES),
  materialId: z.string().min(1), // ObjectId validado en el servicio
  materialAngle: z.number().default(0),
  thicknessMembrane: z.number().positive(),
  thicknessBending: z.number().positive(),
  modifiers,
  color: z.string().optional(),
});

const updateCatalogAreaSection = createCatalogAreaSection.partial();

// Para un deck el servicio calcula espesores y modificadores: no hace falta mandarlos.
const createDeckAreaSection = createCatalogAreaSection.extend({
  kind: z.literal("deck"),
  deck,
  shellType: z.enum(SHELL_TYPES).optional(),
  thicknessMembrane: z.number().positive().optional(),
  thicknessBending: z.number().positive().optional(),
});

module.exports = { createCatalogAreaSection, createDeckAreaSection, updateCatalogAreaSection };
