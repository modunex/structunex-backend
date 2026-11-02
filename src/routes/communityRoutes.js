const { Router } = require("express");
const { requireAuth } = require("../middleware/auth");
const { validate } = require("../middleware/validate");
const { byIp, byUser } = require("../middleware/rateLimit");
const c = require("../controllers/communityController");
const s = require("../schemas/communitySchema");

const MINUTE = 60 * 1000;

/**
 * API de la Comunidad. Lectura pública; escritura con sesión de Clerk. `auth` se inyecta
 * para poder probar las rutas sin Clerk.
 */
function createCommunityRouter({ auth = requireAuth, rateLimits = true } = {}) {
  const router = Router();
  const pass = (_req, _res, next) => next();
  const read = rateLimits ? byIp({ windowMs: MINUTE, limit: 300 }) : pass;
  const write = rateLimits ? byUser({ windowMs: MINUTE, limit: 20 }) : pass;
  const moderate = rateLimits ? byUser({ windowMs: MINUTE, limit: 120 }) : pass;
  const download = rateLimits ? byUser({ windowMs: MINUTE, limit: 60 }) : pass;
  const signed = [auth, c.loadProfile];
  const writer = [...signed, write, c.requireWriter];
  const member = [...signed, write, c.requireProfile];
  const mod = [...signed, moderate, c.requireProfile];

  router.get("/topics", read, c.topics);
  router.get("/tags", read, c.tags);
  router.get("/feed", read, c.feed);
  router.get("/pinned", read, c.pinned);
  router.get("/threads/:number", read, c.thread);
  router.get("/users/:handle", read, c.user);
  router.get("/sitemap", read, c.sitemap);
  router.get("/attachments/:id", read, c.attachment);
  router.get("/unsubscribe", read, c.unsubscribePage);
  router.post("/unsubscribe", read, c.unsubscribe);

  router.get("/me", auth, c.me);
  router.put("/me", auth, write, validate(s.profileUpsert), c.updateMe);

  router.post("/threads", ...writer, validate(s.threadCreate), c.createThread);
  router.post("/threads/:number/posts", ...writer, validate(s.postCreate), c.createPost);
  router.patch("/posts/:id", ...writer, validate(s.postCreate), c.editPost);
  router.post("/posts/:id/report", ...member, validate(s.reportCreate), c.report);
  router.get("/threads/:number/subscription", ...signed, c.subscription);
  router.put("/threads/:number/subscription", ...member, c.subscribe);
  router.delete("/threads/:number/subscription", ...member, c.unsubscribeThread);

  router.post("/attachments", ...writer, validate(s.attachmentCreate), c.presign);
  router.post("/attachments/:id/complete", ...writer, c.complete);
  router.get("/attachments/:id/download", auth, download, c.download);
  router.get("/attachments/:id/status", ...signed, c.requireProfile, c.attachmentStatus);
  router.get("/attachments/:id/preview", ...signed, c.requireProfile, c.preview);

  router.get("/moderation/reports", ...mod, c.reports);
  router.post("/moderation/reports/:id", ...mod, validate(s.reportResolve), c.resolveReport);
  router.post("/moderation/posts/:id/hide", ...mod, validate(s.moderationReason), c.hidePost);
  router.post("/moderation/posts/:id/restore", ...mod, validate(s.moderationReason), c.restorePost);
  router.post("/moderation/attachments/:id/hide", ...mod, validate(s.moderationReason), c.hideAttachment);
  router.post("/moderation/attachments/:id/restore", ...mod, validate(s.moderationReason), c.restoreAttachment);
  router.post("/moderation/threads/:number/lock", ...mod, validate(s.flagUpdate), c.lockThread);
  router.post("/moderation/threads/:number/pin", ...mod, validate(s.flagUpdate), c.pinThread);
  router.post("/moderation/users/:handle/suspend", ...mod, validate(s.suspension), c.suspend);
  router.post("/moderation/tags", ...mod, validate(s.tagCreate), c.createTag);
  router.patch("/moderation/tags/:slug", ...mod, validate(s.tagUpdate), c.updateTag);

  return router;
}

module.exports = { createCommunityRouter };
