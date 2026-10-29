const { z } = require("zod");

// Id de dominio del nudo ("N1"), el mismo que usa el resto del modelo.
const inspectConnectionSchema = z.object({
  nodeId: z.string().trim().min(1).max(64),
});

module.exports = { inspectConnectionSchema };
