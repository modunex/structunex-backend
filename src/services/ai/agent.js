// Bucle del asistente IA: un turno de conversación = una o varias llamadas a Claude
// (Bedrock) con herramientas, hasta que el modelo termina. El texto se reenvía al
// navegador por SSE a medida que llega; las propuestas de cambio se acumulan en un
// changeset que se emite al final del turno.
//
// El historial es append-only: cada mensaje de la API se guarda tal cual (incluidos
// los bloques de thinking) y se reenvía sin tocar en los turnos siguientes.

const { prisma } = require("../../config/db");
const { env } = require("../../config/env");
const { bedrock } = require("../bedrockService");
const { buildSystem } = require("./systemPrompt");
const { TOOLS, runTool } = require("./tools");
const { createChangesetBuilder } = require("./changeset");
const { hydrateContent } = require("./attachments");
const { unitSystemById } = require("./units");

const MAX_ITERATIONS = 16;
const MAX_TOKENS = 32000;

const TOOL_LABELS = {
  get_model_summary: "Leyendo el modelo",
  query_model: "Consultando nudos y barras",
  list_materials: "Revisando materiales",
  list_sections: "Revisando secciones",
  search_aisc_shapes: "Buscando perfiles AISC",
  check_model: "Validando el modelo",
  propose_changes: "Preparando la propuesta",
};

/** Mensaje de error legible a partir de un error del SDK. */
function describeError(err) {
  const status = err && err.status;
  if (status === 401 || status === 403) {
    return "Bedrock rechazó las credenciales: revisa que el usuario de IAM tenga permiso para invocar el modelo y que el acceso al modelo esté habilitado en la región.";
  }
  if (status === 404) {
    return `El modelo "${env.bedrockModelId}" no está disponible en Bedrock (${env.bedrockRegion}). Revisa BEDROCK_MODEL_ID y BEDROCK_REGION.`;
  }
  if (status === 429) return "Se alcanzó el límite de uso de Bedrock. Inténtalo de nuevo en unos segundos.";
  if (status === 413) return "Los adjuntos son demasiado grandes para una sola petición.";
  if (status >= 500) return "Bedrock no está respondiendo ahora mismo. Inténtalo de nuevo.";
  if (status === 400) return `Petición rechazada por Bedrock: ${err.message}`;
  return "Error inesperado del asistente.";
}

function addUsage(total, usage) {
  if (!usage) return total;
  for (const k of [
    "input_tokens",
    "output_tokens",
    "cache_read_input_tokens",
    "cache_creation_input_tokens",
  ]) {
    total[k] = (total[k] || 0) + (usage[k] || 0);
  }
  return total;
}

/**
 * Ejecuta un turno completo.
 *
 * @param p.conversation  fila AiConversation
 * @param p.project       fila Project
 * @param p.ownerId       Clerk user id
 * @param p.userContent   contenido del mensaje del usuario en formato guardado
 * @param p.snapshot      modelo actual del cliente (base kN·m) + configuración
 * @param p.checkReport   informe de checkModel calculado en el cliente
 * @param p.unitSystemId  sistema de unidades activo del usuario
 * @param p.language      idioma de la interfaz
 * @param p.send(event, data)  emite un evento SSE
 * @param p.signal        AbortSignal (cliente desconectado)
 */
async function runTurn(p) {
  const { conversation, project, ownerId, send, signal } = p;
  const sys = unitSystemById(p.unitSystemId);

  const [history, attachments, materials, sections] = await Promise.all([
    prisma.aiMessage.findMany({
      where: { conversationId: conversation.id },
      orderBy: { seq: "asc" },
    }),
    prisma.aiAttachment.findMany({ where: { conversationId: conversation.id } }),
    prisma.catalogMaterial.findMany({ where: { ownerId }, orderBy: { createdAt: "asc" } }),
    prisma.catalogFrameSection.findMany({ where: { ownerId }, orderBy: { createdAt: "asc" } }),
  ]);
  const attById = new Map(attachments.map((a) => [a.id, a]));
  const catalog = { materials, sections };

  await prisma.aiMessage.create({
    data: { conversationId: conversation.id, role: "user", content: p.userContent },
  });

  const messages = [];
  for (const row of history) {
    messages.push({ role: row.role, content: await hydrateContent(row.content, attById) });
  }
  messages.push({ role: "user", content: await hydrateContent(p.userContent, attById) });

  const system = buildSystem({
    sys,
    language: p.language,
    project: { name: project.name, dim: p.snapshot.dim, analysisType: p.snapshot.analysisType },
  });
  const changeset = createChangesetBuilder({
    snapshot: p.snapshot,
    catalog,
    unitSystemId: sys.id,
  });
  const toolCtx = { snapshot: p.snapshot, catalog, sys, checkReport: p.checkReport, changeset };

  const usage = {};
  let lastAssistantId = null;

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    if (signal.aborted) return;

    const stream = bedrock().messages.stream(
      {
        model: env.bedrockModelId,
        max_tokens: MAX_TOKENS,
        system,
        tools: TOOLS,
        messages,
        thinking: { type: "adaptive" },
        output_config: { effort: env.aiEffort },
        // Caché automática del prefijo (tools → system → historial).
        cache_control: { type: "ephemeral" },
      },
      { signal }
    );

    for await (const event of stream) {
      if (event.type === "content_block_start") {
        const block = event.content_block;
        if (block.type === "thinking") send("status", { state: "thinking" });
        if (block.type === "tool_use") {
          send("tool", { name: block.name, label: TOOL_LABELS[block.name] || block.name });
        }
        if (block.type === "text") send("status", { state: "writing" });
      } else if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        send("text", { delta: event.delta.text });
      }
    }
    const final = await stream.finalMessage();
    addUsage(usage, final.usage);
    messages.push({ role: "assistant", content: final.content });

    if (final.stop_reason === "tool_use") {
      const results = final.content
        .filter((b) => b.type === "tool_use")
        .map((b) => {
          const { content, isError } = runTool(b.name, b.input, toolCtx);
          return {
            type: "tool_result",
            tool_use_id: b.id,
            content: JSON.stringify(content),
            ...(isError ? { is_error: true } : {}),
          };
        });
      messages.push({ role: "user", content: results });
      // El mensaje del asistente y sus resultados se guardan juntos: un historial con
      // un tool_use sin su tool_result rompería la conversación para siempre.
      const [assistantRow] = await prisma.$transaction([
        prisma.aiMessage.create({
          data: {
            conversationId: conversation.id,
            role: "assistant",
            content: final.content,
            usage: final.usage,
          },
        }),
        prisma.aiMessage.create({
          data: { conversationId: conversation.id, role: "user", content: results },
        }),
      ]);
      lastAssistantId = assistantRow.id;
      continue;
    }

    const row = await prisma.aiMessage.create({
      data: {
        conversationId: conversation.id,
        role: "assistant",
        content: final.content,
        usage: final.usage,
      },
    });
    lastAssistantId = row.id;

    if (final.stop_reason === "refusal") {
      send("notice", { message: "El asistente no pudo responder a esta petición. Prueba a reformularla." });
    } else if (final.stop_reason === "max_tokens") {
      send("notice", { message: "La respuesta se cortó por longitud. Pide que continúe o divide la tarea." });
    } else if (final.stop_reason === "pause_turn") {
      continue;
    }
    break;
  }

  const cs = changeset.finish();
  if (cs && lastAssistantId) {
    await prisma.aiMessage.update({
      where: { id: lastAssistantId },
      data: { changeset: cs, changesetStatus: "pending" },
    });
    send("changeset", { messageId: lastAssistantId, ...cs });
  }

  await prisma.aiConversation.update({
    where: { id: conversation.id },
    data: { updatedAt: new Date() },
  });
  send("done", { messageId: lastAssistantId, usage });
}

module.exports = { runTurn, describeError };
