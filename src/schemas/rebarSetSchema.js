const { z } = require("zod");

// Juego de barras de refuerzo del proyecto (Rebar Studio D1). Unidades base del servicio:
// diámetro en m, área en m², masa en kg/m. Los presets (ASTM A615, A615M, EN 10080) los
// arma el frontend desde las tablas de la norma (lib/rebarCatalog.ts); aquí solo se
// comprueba que el juego sea coherente, porque de él saldrán armados y despieces.

const PRESETS = ["astm-a615", "astm-a615m", "en10080", "custom"];

const rebarBar = z
  .object({
    id: z.string().min(1).max(40),
    label: z.string().trim().min(1).max(20),
    // Entre 3 mm y 100 mm: cubre de alambres a #18 con margen; fuera es un error de unidades.
    db: z.number().min(0.003).max(0.1),
    area: z.number().positive(),
    mass: z.number().positive(),
  })
  .strict();

const unique = (list, key) => new Set(list.map(key)).size === list.length;

const rebarSet = z
  .object({
    preset: z.enum(PRESETS),
    bars: z.array(rebarBar).min(1).max(40),
  })
  .strict()
  .refine((s) => unique(s.bars, (b) => b.id), { message: "Ids de barra repetidos", path: ["bars"] })
  .refine((s) => unique(s.bars, (b) => b.label.trim().toLowerCase()), {
    message: "Designaciones de barra repetidas",
    path: ["bars"],
  })
  .refine((s) => unique(s.bars, (b) => Math.round(b.db * 1e5)), {
    message: "Dos barras con el mismo diámetro",
    path: ["bars"],
  })
  // El área tiene que corresponder al diámetro (±2 %): las tablas de la norma redondean
  // a la unidad (#3 = 71 mm² frente a π·9.525²/4 = 71.3), un error de unidades no.
  .refine(
    (s) => s.bars.every((b) => Math.abs(b.area / ((Math.PI * b.db ** 2) / 4) - 1) <= 0.02),
    { message: "El área de una barra no corresponde a su diámetro", path: ["bars"] }
  );

module.exports = { rebarSet, rebarBar, REBAR_PRESETS: PRESETS };
