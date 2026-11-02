const { rateLimit, ipKeyGenerator } = require("express-rate-limit");
const { env } = require("../config/env");

const clientIp = (req) => req.headers["cf-connecting-ip"] || req.ip;

const isHomeServer = (req) =>
  Boolean(env.communitySsrKey) && req.headers["x-community-ssr-key"] === env.communitySsrKey;

/** Límite por IP real (Cloudflare la manda en cf-connecting-ip). */
function byIp({ windowMs, limit }) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    skip: isHomeServer,
    keyGenerator: (req) => ipKeyGenerator(clientIp(req)),
    message: { error: "TooManyRequests" },
  });
}

/** Límite por usuario autenticado. Va después de requireAuth. */
function byUser({ windowMs, limit }) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    keyGenerator: (req) => req.userId,
    message: { error: "TooManyRequests" },
  });
}

module.exports = { byIp, byUser };
