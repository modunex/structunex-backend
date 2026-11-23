const axios = require("axios");

const { prisma } = require("../config/db");
const { env } = require("../config/env");
const { AppError } = require("../middleware/errorHandler");
const { fromCalcError } = require("./calcService");
const { runStaleReason } = require("./analysisService");
const designService = require("./designService");

// Rebar Studio (calc-service app/detailing). D2: la línea de viga que contiene una barra
// y las envolventes de armado de la ÚLTIMA comprobación de diseño terminada. No
// recalcula: si el diseño no está, o ya no es del modelo actual, lo dice.

const SUPPORT_DOFS = ["dx", "dy", "dz", "rx", "ry", "rz"];

async function lineRequest(project, elementId) {
  const projectId = project.id;
  const run = await designService.latestRun(projectId);
  if (!run) {
    throw new AppError(409, "Primero hay que correr el diseño (Design).", { error: "detailing.noDesignRun" });
  }
  const [model, rolls, supports, configuration] = await Promise.all([
    designService.assembleDesignModel(projectId),
    prisma.modelElement.findMany({ where: { projectId }, select: { id: true, roll: true } }),
    prisma.modelSupport.findMany({ where: { projectId } }),
    prisma.modelConfiguration.findUnique({ where: { projectId }, select: { designPreferences: true } }),
  ]);
  const rollOf = new Map(rolls.map((e) => [e.id, e.roll ?? 0]));
  const overrides = (configuration?.designPreferences?.overrides || [])
    .filter((o) => o && o.elementId && (o.role === "beam" || o.role === "column"))
    .map((o) => ({ elementId: o.elementId, role: o.role }));

  const request = {
    storage: { projectId: String(projectId), runId: String(run._id), bucket: env.s3Bucket, prefix: env.s3Prefix },
    elementId: String(elementId),
    nodes: model.nodes,
    elements: model.elements.map((e) => ({ ...e, roll: rollOf.get(e.id) ?? 0 })),
    sections: model.sections,
    // Un apoyo del modelo es un nudo con algún grado de libertad restringido.
    supports: supports.filter((s) => SUPPORT_DOFS.some((k) => s[k])).map((s) => ({ nodeId: s.nodeId })),
    overrides,
  };
  return { run, request };
}

async function line(project, elementId) {
  if (!elementId) throw new AppError(400, "Falta la barra.", { error: "detailing.elementMissing" });
  const { run, request } = await lineRequest(project, elementId);
  let data;
  try {
    ({ data } = await axios.post(`${env.calcServiceUrl}/detailing/line`, request, { timeout: 60000 }));
  } catch (err) {
    // Una barra que no encabeza una línea (no es viga, no es horizontal…) es un 422 con
    // su clave i18n: se devuelve tal cual para que la interfaz lo explique.
    const key = err.response?.status === 422 && err.response.data?.detail?.error;
    if (key) throw new AppError(422, key, { error: key });
    throw fromCalcError(err);
  }
  const [staleReason, current] = await Promise.all([
    runStaleReason(project.id, run.analysisRunId),
    designService.currentInputsHash(project.id),
  ]);
  return {
    ...data,
    designRun: {
      id: run._id,
      finishedAt: run.finishedAt,
      code: run.code,
      staleReason: staleReason || null,
      inputsChanged: !!run.inputsHash && run.inputsHash !== current,
    },
  };
}

module.exports = { line, lineRequest };
