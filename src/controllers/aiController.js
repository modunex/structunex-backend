const { z } = require("zod");
const { prisma } = require("../config/db");
const { asyncHandler, AppError } = require("../middleware/errorHandler");
const svc = require("../services/aiChatService");
const { runTurn, describeError } = require("../services/ai/agent");
const { UNIT_SYSTEM_IDS } = require("../services/ai/units");
const aiModels = require("../services/ai/models");

// Un turno a la vez por usuario: evita dobles envíos y pone un techo al gasto.
const activeTurns = new Set();

const snapshotSchema = z.object({
  nodes: z.array(z.any()).default([]),
  elements: z.array(z.any()).default([]),
  supports: z.array(z.any()).default([]),
  loads: z.array(z.any()).default([]),
  frameLoads: z.array(z.any()).default([]),
  areas: z.array(z.any()).default([]),
  configuration: z.record(z.any()).default({}),
  dim: z.enum(["2D", "3D"]).optional(),
  analysisType: z.string().nullable().optional(),
  activeDofs: z.array(z.string()).optional(),
});

const messageSchema = z.object({
  text: z.string().max(20000).default(""),
  attachmentIds: z.array(z.string()).max(10).default([]),
  snapshot: snapshotSchema,
  checkReport: z.any().optional(),
  unitSystemId: z.enum(UNIT_SYSTEM_IDS).default("kn-m"),
  language: z.enum(["es", "en"]).default("es"),
  // Elegidos por el usuario; el modelo tiene que estar en la allowlist del servidor.
  model: z
    .string()
    .max(200)
    .refine((m) => aiModels.isAllowedModel(m), { message: "Modelo no permitido" })
    .optional(),
  effort: z.enum(aiModels.EFFORTS).optional(),
});

/** parse() que responde 400 en vez de dejar escapar un ZodError (sería un 500). */
function parseBody(schema, body) {
  const r = schema.safeParse(body);
  if (!r.success) throw new AppError(400, r.error.issues.map((i) => i.message).join("; "));
  return r.data;
}

const STATUS_NOTE = {
  applied: "el usuario APLICÓ la propuesta anterior; ya forma parte del modelo",
  discarded: "el usuario DESCARTÓ la propuesta anterior; no está en el modelo",
  pending: "el usuario aún no ha aplicado ni descartado la propuesta anterior; no está en el modelo",
};

/**
 * Nota para el modelo sobre la última propuesta, si el usuario no ha escrito desde
 * entonces. Va dentro del mensaje del usuario (no se edita el historial).
 */
async function previousProposalNote(conversationId) {
  const last = await prisma.aiMessage.findFirst({
    where: { conversationId, changesetStatus: { not: null } },
    orderBy: { seq: "desc" },
  });
  return last ? `[Nota del sistema: ${STATUS_NOTE[last.changesetStatus] || STATUS_NOTE.pending}.]` : null;
}

module.exports = {
  /** Modelos y esfuerzos que se pueden elegir en el chat. */
  options: asyncHandler(async (_req, res) => {
    res.json(aiModels.options());
  }),

  list: asyncHandler(async (req, res) => {
    res.json(await svc.list(req.projectId, req.userId));
  }),

  create: asyncHandler(async (req, res) => {
    res.status(201).json(await svc.create(req.projectId, req.userId, req.body?.title));
  }),

  getOne: asyncHandler(async (req, res) => {
    res.json(await svc.getWithMessages(req.projectId, req.userId, req.params.conversationId));
  }),

  remove: asyncHandler(async (req, res) => {
    await svc.remove(req.projectId, req.userId, req.params.conversationId);
    res.status(204).end();
  }),

  presign: asyncHandler(async (req, res) => {
    const body = parseBody(
      z.object({ name: z.string().min(1), mime: z.string().min(1), size: z.number().int().positive() }),
      req.body
    );
    res.json(await svc.presignAttachment(req.projectId, req.userId, req.params.conversationId, body));
  }),

  attachmentUrl: asyncHandler(async (req, res) => {
    res.json(
      await svc.attachmentUrl(req.projectId, req.userId, req.params.conversationId, req.params.attachmentId)
    );
  }),

  setChangesetStatus: asyncHandler(async (req, res) => {
    const { status } = parseBody(z.object({ status: z.enum(["applied", "discarded"]) }), req.body);
    await svc.setChangesetStatus(
      req.projectId,
      req.userId,
      req.params.conversationId,
      req.params.messageId,
      status
    );
    res.status(204).end();
  }),

  /** POST …/messages → respuesta en streaming (Server-Sent Events). */
  sendMessage: asyncHandler(async (req, res) => {
    const parsed = messageSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "ValidationError", details: parsed.error.flatten() });
    }
    const body = parsed.data;
    if (!body.text.trim() && body.attachmentIds.length === 0) {
      throw new AppError(400, "El mensaje está vacío");
    }
    const conversation = await svc.getConversation(
      req.projectId,
      req.userId,
      req.params.conversationId
    );
    const atts = await svc.resolveAttachments(conversation.id, body.attachmentIds);

    if (activeTurns.has(req.userId)) {
      throw new AppError(409, "Ya hay una respuesta del asistente en curso.");
    }
    activeTurns.add(req.userId);

    // Contenido tal como se guarda: los adjuntos como referencia, no en base64.
    const note = await previousProposalNote(conversation.id);
    const userContent = [
      ...atts.map((a) => ({ type: "attachment", attachmentId: a.id })),
      ...(note ? [{ type: "text", text: note }] : []),
      ...(body.text.trim() ? [{ type: "text", text: body.text.trim() }] : []),
    ];
    if (!conversation.title && body.text.trim()) {
      await prisma.aiConversation.update({
        where: { id: conversation.id },
        data: { title: body.text.trim().slice(0, 80) },
      });
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();
    const send = (event, data) => {
      if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    // Latido: algunos proxies cortan conexiones mudas mientras el modelo piensa.
    const heartbeat = setInterval(() => res.write(": ping\n\n"), 15000);

    const controller = new AbortController();
    res.on("close", () => controller.abort());
    const run = aiModels.resolve(body.model, body.effort);
    send("meta", { model: run.model, label: run.label, effort: run.effort });

    try {
      await runTurn({
        conversation,
        project: req.project,
        ownerId: req.userId,
        userContent,
        snapshot: body.snapshot,
        checkReport: body.checkReport,
        unitSystemId: body.unitSystemId,
        language: body.language,
        run,
        send,
        signal: controller.signal,
      });
    } catch (err) {
      if (!controller.signal.aborted) {
        console.error("[ai] turn failed", err);
        send("error", { message: describeError(err, run.model) });
      }
    } finally {
      clearInterval(heartbeat);
      activeTurns.delete(req.userId);
      res.end();
    }
  }),
};
