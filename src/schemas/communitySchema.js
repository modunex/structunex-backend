const { z } = require("zod");

const RESERVED_HANDLES = new Set([
  "admin", "administrator", "moderator", "mod", "root", "staff", "support", "help",
  "structunex", "modunex", "official", "system", "community", "team", "anonymous",
]);

// El nombre público sale de Clerk: la API no acepta nombre ni usuario.
const profileUpsert = z.object({
  bio: z.string().trim().max(300).optional(),
  notifyReplies: z.boolean().optional(),
  acceptGuidelines: z.literal(true).optional(),
});

const uuid = z.string().uuid();
const attachmentIds = z.array(uuid).max(5).default([]);

const threadCreate = z.object({
  topic: z.string().min(1).max(64),
  locale: z.enum(["en", "es"]),
  title: z
    .string()
    .trim()
    .min(10)
    .max(160)
    .refine((value) => !/[\r\n]/.test(value), "El título debe ir en una sola línea"),
  tags: z.array(z.string().min(1).max(64)).max(3).default([]),
  body: z.unknown(),
  attachmentIds,
});

const postCreate = z.object({ body: z.unknown(), attachmentIds });

const attachmentCreate = z.object({
  name: z.string().min(1).max(255),
  size: z.number().int().positive(),
});

const reportCreate = z.object({
  reason: z.enum(["spam", "abuse", "unsafe", "confidential", "translation", "other"]),
  note: z.string().trim().max(500).default(""),
});

const moderationReason = z.object({ reason: z.string().trim().max(300).default("") });

const translationRequest = z.object({ locale: z.enum(["en", "es"]) });

const reportResolve = z.object({ status: z.enum(["resolved", "dismissed"]) });

const flagUpdate = z.object({ value: z.boolean(), reason: z.string().trim().max(300).default("") });

const suspension = z.object({
  until: z.coerce.date().nullable(),
  reason: z.string().trim().max(300).default(""),
});

const tagSlug = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(40);

const tagCreate = z.object({
  slug: tagSlug,
  nameEn: z.string().trim().min(2).max(40),
  nameEs: z.string().trim().min(2).max(40),
  group: z.enum(["code", "subject", "product"]),
});

const tagUpdate = z.object({
  nameEn: z.string().trim().min(2).max(40).optional(),
  nameEs: z.string().trim().min(2).max(40).optional(),
  isActive: z.boolean().optional(),
});

const feedQuery = z.object({
  topic: z.string().max(64).optional(),
  tag: z.string().max(64).optional(),
  locale: z.enum(["en", "es"]).optional(),
  sort: z.enum(["recent", "unanswered"]).default("recent"),
  page: z.coerce.number().int().min(1).max(1000).default(1),
});

module.exports = {
  RESERVED_HANDLES,
  profileUpsert,
  threadCreate,
  postCreate,
  attachmentCreate,
  reportCreate,
  moderationReason,
  reportResolve,
  translationRequest,
  flagUpdate,
  suspension,
  tagCreate,
  tagUpdate,
  feedQuery,
};
