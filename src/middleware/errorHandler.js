const { Prisma } = require("@prisma/client");

class AppError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    // Optional structured payload (e.g. the calc-service culprit nodes/DOFs).
    if (details !== undefined) this.details = details;
  }
}

// Central error handler. Must be registered LAST in app.js.
function errorHandler(err, _req, res, _next) {
  if (err instanceof AppError) {
    const body = { error: err.message };
    if (err.details !== undefined) body.details = err.details;
    return res.status(err.status).json(body);
  }
  // Restricciones que ahora hace cumplir Postgres.
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      // Único violado: p. ej. dos nodos con el mismo id de dominio en un proyecto.
      return res.status(409).json({ error: "Duplicate", details: err.meta?.target });
    }
    if (err.code === "P2003") {
      // Clave foránea: material en uso por una sección, o referencia inexistente.
      return res.status(409).json({ error: "ReferenceConflict" });
    }
    if (err.code === "P2025") {
      return res.status(404).json({ error: "NotFound" });
    }
  }
  console.error("[error]", err);
  return res.status(500).json({ error: "InternalServerError" });
}

// Wraps async controllers so thrown errors reach errorHandler.
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = { AppError, errorHandler, asyncHandler };
