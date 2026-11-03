const { z } = require("zod");

const name = z.string().trim().min(1).max(160);
const origin = {
  key: z.string().min(1).max(512),
  view: z.record(z.unknown()).optional(),
  analysisRunId: z.string().uuid().optional(),
  designRunId: z.string().uuid().optional(),
  connectionRunId: z.string().uuid().optional(),
};

const imageUploadSchema = z.object({
  contentType: z.enum(["image/png", "image/jpeg", "image/webp"]),
  bytes: z.number().int().positive(),
});

const createImageSchema = z.discriminatedUnion("source", [
  z.object({ source: z.literal("upload"), name, ...origin }),
  z.object({ source: z.literal("viewer"), name, kind: z.enum(["model", "analysis", "design", "connection"]), ...origin }),
]);

const imageVersionSchema = z.object(origin);
const renameImageSchema = z.object({ name });

module.exports = { createImageSchema, imageUploadSchema, imageVersionSchema, renameImageSchema };
