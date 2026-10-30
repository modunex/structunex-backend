const express = require("express");
const cors = require("cors");
const { clerkMiddleware } = require("@clerk/express");
const { env } = require("./config/env");
const routes = require("./routes");
const webhookRoutes = require("./routes/webhookRoutes");
const { errorHandler } = require("./middleware/errorHandler");

const app = express();

// CORS: permite el origen configurado y, en desarrollo, cualquier puerto de
// localhost (Vite suele cambiar de puerto). Peticiones sin origin (curl, health)
// también se permiten.
const localhostOrigin = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || env.clientOrigins.includes(origin) || localhostOrigin.test(origin)) {
        return callback(null, true);
      }
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);

// Webhooks must see the RAW body (Svix signature verification), so they are
// mounted BEFORE the global JSON parser and are not behind requireAuth.
app.use("/api/webhooks", webhookRoutes);

// Los mensajes al asistente IA llevan el modelo entero (snapshot) en el cuerpo: es la
// única ruta con un límite mayor. El resto sigue en 2 MB.
const AI_MESSAGE_PATH = /^\/api\/projects\/[^/]+\/ai\/conversations\/[^/]+\/messages$/;
// Los documentos de Report Studio llevan las instantáneas de sus bloques técnicos.
const REPORT_DOCUMENT_PATH = /^\/api\/projects\/[^/]+\/reports\/[^/]+$/;
const jsonDefault = express.json({ limit: "2mb" });
const jsonAiMessage = express.json({ limit: "15mb" });
app.use((req, res, next) =>
  (AI_MESSAGE_PATH.test(req.path) || REPORT_DOCUMENT_PATH.test(req.path) ? jsonAiMessage : jsonDefault)(req, res, next)
);

// Attaches Clerk session state to every request (does not block on its own).
app.use(clerkMiddleware());

app.use("/api", routes);

// 404 for unmatched routes
app.use((_req, res) => res.status(404).json({ error: "NotFound" }));

// Central error handler (must be last)
app.use(errorHandler);

module.exports = { app };
