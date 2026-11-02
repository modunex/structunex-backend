const { z } = require("zod");
const { AppError, asyncHandler } = require("../middleware/errorHandler");
const { isUuid } = require("../lib/ids");
const svc = require("../services/communityService");
const attachments = require("../services/communityAttachmentService");
const emails = require("../services/communityEmailService");
const schemas = require("../schemas/communitySchema");

const MAX_THREAD_NUMBER = 2147483647; // columna INTEGER

function threadNumber(req) {
  const number = Number(req.params.number);
  if (!Number.isInteger(number) || number < 1 || number > MAX_THREAD_NUMBER) {
    throw new AppError(404, "NotFound");
  }
  return number;
}

function uuidParam(value) {
  if (!isUuid(value)) throw new AppError(404, "NotFound");
  return value;
}

function parseQuery(schema, query) {
  const parsed = schema.safeParse(query);
  if (!parsed.success) throw new AppError(400, "ValidationError", parsed.error.flatten());
  return parsed.data;
}

/** Carga el perfil del usuario autenticado en req.profile (puede ser null). */
const loadProfile = asyncHandler(async (req, _res, next) => {
  req.profile = await svc.findProfile(req.userId);
  next();
});

const requireProfile = (req, _res, next) => {
  if (!req.profile) return next(new AppError(403, "ProfileRequired"));
  next();
};

/** Bloquea ya en la ruta a un usuario que no puede publicar (antes de firmar subidas). */
const requireWriter = (req, _res, next) => {
  try {
    svc.assertCanWrite(req.profile);
    next();
  } catch (err) {
    next(err);
  }
};

const redirectTo = (res, url) => {
  res.set("Cache-Control", "no-store");
  res.redirect(302, url);
};

const c = {
  topics: asyncHandler(async (_req, res) => res.json(await svc.listTopics())),
  tags: asyncHandler(async (_req, res) => res.json(await svc.listTags())),
  feed: asyncHandler(async (req, res) => {
    res.json(await svc.listFeed(parseQuery(schemas.feedQuery, req.query)));
  }),
  pinned: asyncHandler(async (req, res) => {
    const { locale } = parseQuery(z.object({ locale: z.enum(["en", "es"]).optional() }), req.query);
    res.json(await svc.listPinned(locale));
  }),
  thread: asyncHandler(async (req, res) => res.json(await svc.getThread(threadNumber(req)))),
  user: asyncHandler(async (req, res) => res.json(await svc.getPublicProfile(req.params.handle))),
  sitemap: asyncHandler(async (_req, res) => res.json(await svc.sitemap())),
  attachment: asyncHandler(async (req, res) => {
    redirectTo(res, await attachments.publicUrl(uuidParam(req.params.id)));
  }),
  // El GET no da de baja: algunos filtros de correo abren los enlaces por su cuenta.
  unsubscribePage: (req, res) => {
    const token = String(req.query.token ?? "").replace(/[^A-Za-z0-9._-]/g, "");
    res.type("html").send(
      `<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex"><title>Structunex</title>` +
        `<form method="post" action="?token=${token}"><p>Stop reply notices? / ¿Dejar de recibir avisos de respuestas?</p>` +
        `<button type="submit">Confirm / Confirmar</button></form>`
    );
  },
  unsubscribe: asyncHandler(async (req, res) => {
    const ok = await emails.unsubscribe(req.query.token);
    if (!ok) throw new AppError(400, "InvalidToken");
    res.type("text/plain").send("Unsubscribed. Baja confirmada.");
  }),

  me: asyncHandler(async (req, res) => res.json(await svc.getMe(req.userId))),
  updateMe: asyncHandler(async (req, res) => res.json(await svc.upsertProfile(req.userId, req.body))),
  createThread: asyncHandler(async (req, res) => {
    res.status(201).json(await svc.createThread(req.profile, req.body));
  }),
  createPost: asyncHandler(async (req, res) => {
    res.status(201).json(await svc.createPost(req.profile, threadNumber(req), req.body));
  }),
  editPost: asyncHandler(async (req, res) => {
    res.json(await svc.editPost(req.profile, uuidParam(req.params.id), req.body));
  }),
  report: asyncHandler(async (req, res) => {
    res.status(201).json(await svc.report(req.profile, uuidParam(req.params.id), req.body));
  }),
  subscription: asyncHandler(async (req, res) => {
    res.json(await svc.getSubscription(req.profile, threadNumber(req)));
  }),
  subscribe: asyncHandler(async (req, res) => {
    res.json(await svc.setSubscription(req.profile, threadNumber(req), true));
  }),
  unsubscribeThread: asyncHandler(async (req, res) => {
    res.json(await svc.setSubscription(req.profile, threadNumber(req), false));
  }),
  presign: asyncHandler(async (req, res) => {
    res.status(201).json(await attachments.presign(req.profile, req.body));
  }),
  complete: asyncHandler(async (req, res) => {
    res.json(await attachments.complete(req.profile, uuidParam(req.params.id)));
  }),
  attachmentStatus: asyncHandler(async (req, res) => {
    res.json(await attachments.attachmentStatus(req.profile, uuidParam(req.params.id)));
  }),
  preview: asyncHandler(async (req, res) => {
    res.json({ url: await attachments.previewUrl(req.profile, uuidParam(req.params.id)) });
  }),

  reports: asyncHandler(async (req, res) => {
    const { status } = parseQuery(
      z.object({ status: z.enum(["open", "resolved", "dismissed"]).default("open") }),
      req.query
    );
    res.json(await svc.listReports(req.profile, status));
  }),
  hidePost: asyncHandler(async (req, res) => {
    res.json(await svc.setPostHidden(req.profile, uuidParam(req.params.id), true, req.body.reason));
  }),
  restorePost: asyncHandler(async (req, res) => {
    res.json(await svc.setPostHidden(req.profile, uuidParam(req.params.id), false, req.body.reason));
  }),
  hideAttachment: asyncHandler(async (req, res) => {
    res.json(await svc.setAttachmentHidden(req.profile, uuidParam(req.params.id), true, req.body.reason));
  }),
  restoreAttachment: asyncHandler(async (req, res) => {
    res.json(await svc.setAttachmentHidden(req.profile, uuidParam(req.params.id), false, req.body.reason));
  }),
  lockThread: asyncHandler(async (req, res) => {
    res.json(await svc.setThreadFlag(req.profile, threadNumber(req), "lock", req.body.value, req.body.reason));
  }),
  pinThread: asyncHandler(async (req, res) => {
    res.json(await svc.setThreadFlag(req.profile, threadNumber(req), "pin", req.body.value, req.body.reason));
  }),
  suspend: asyncHandler(async (req, res) => {
    res.json(await svc.suspendProfile(req.profile, req.params.handle, req.body.until, req.body.reason));
  }),
  resolveReport: asyncHandler(async (req, res) => {
    res.json(await svc.resolveReport(req.profile, uuidParam(req.params.id), req.body.status));
  }),
  createTag: asyncHandler(async (req, res) => {
    res.status(201).json(await svc.createTag(req.profile, req.body));
  }),
  updateTag: asyncHandler(async (req, res) => {
    res.json(await svc.updateTag(req.profile, req.params.slug, req.body));
  }),
};

module.exports = { ...c, loadProfile, requireProfile, requireWriter };
