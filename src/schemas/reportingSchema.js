const { z } = require("zod");

const uuid = z.string().uuid();

// Exportar a PDF: o la última comprobación vigente de cada conexión, o una lista de
// comprobaciones concretas (en el orden en que deben salir).
const exportReportSchema = z.discriminatedUnion("scope", [
  z.object({
    scope: z.literal("currentConnections"),
    lang: z.enum(["es", "en"]).default("es"),
    title: z.string().trim().min(1).max(160).optional(),
    unitSystemId: z.string().trim().min(1).max(32).optional(),
  }),
  z.object({
    scope: z.literal("analysis"),
    lang: z.enum(["es", "en"]).default("es"),
    title: z.string().trim().min(1).max(160).optional(),
    unitSystemId: z.string().trim().min(1).max(32).optional(),
  }),
  z.object({
    scope: z.literal("memoria"),
    lang: z.enum(["es", "en"]).default("es"),
    title: z.string().trim().min(1).max(160).optional(),
    unitSystemId: z.string().trim().min(1).max(32).optional(),
  }),
  z.object({
    scope: z.literal("currentMembers"),
    elementIds: z.array(z.string().trim().min(1).max(64)).max(200).optional(),
    lang: z.enum(["es", "en"]).default("es"),
    title: z.string().trim().min(1).max(160).optional(),
    unitSystemId: z.string().trim().min(1).max(32).optional(),
  }),
  z.object({
    scope: z.literal("designRun"),
    designRunId: uuid,
    elementIds: z.array(z.string().trim().min(1).max(64)).max(200).optional(),
    lang: z.enum(["es", "en"]).default("es"),
    title: z.string().trim().min(1).max(160).optional(),
    unitSystemId: z.string().trim().min(1).max(32).optional(),
  }),
  z.object({
    scope: z.literal("runs"),
    runIds: z.array(uuid).min(1).max(200),
    lang: z.enum(["es", "en"]).default("es"),
    title: z.string().trim().min(1).max(160).optional(),
    unitSystemId: z.string().trim().min(1).max(32).optional(),
  }),
]);

const logoUploadSchema = z.object({
  contentType: z.enum(["image/png", "image/jpeg"]),
  bytes: z.number().int().positive(),
});

const setLogoSchema = z.object({ key: z.string().min(1).max(512) });

module.exports = { exportReportSchema, logoUploadSchema, setLogoSchema };

// ─── R4: documentos de Report Studio ───
// El documento en sí se valida en lib/reportDocuments.js (estructura del formato v1).
const reportDocument = z.object({ version: z.literal(1), blocks: z.array(z.any()).max(5000) }).passthrough();

const createReportSchema = z.object({
  title: z.string().trim().min(1).max(160),
  lang: z.enum(["es", "en"]).default("es"),
  template: z.enum(["blank", "memoria"]).default("blank"),
});

const updateReportSchema = z.object({
  version: z.number().int().positive(),
  title: z.string().trim().min(1).max(160).optional(),
  lang: z.enum(["es", "en"]).optional(),
  document: reportDocument.optional(),
});

const createRevisionSchema = z.object({ name: z.string().trim().min(1).max(120) });

const exportReportDocumentSchema = z.object({
  unitSystemId: z.string().trim().min(1).max(32).optional(),
  revisionId: z.string().uuid().optional(),
});

module.exports.createReportSchema = createReportSchema;
module.exports.updateReportSchema = updateReportSchema;
module.exports.createRevisionSchema = createRevisionSchema;
module.exports.exportReportDocumentSchema = exportReportDocumentSchema;
