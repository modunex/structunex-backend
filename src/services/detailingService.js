const axios = require("axios");

const { prisma } = require("../config/db");
const { env } = require("../config/env");
const { AppError } = require("../middleware/errorHandler");
const { isUuid, toApi, jsonNulls } = require("../lib/ids");
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
    materials: model.materials,
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

// ─── D3: vigas detalladas (propuesta de armado persistida) ──────────────────────────

// D6: una columna se detalla con su propio endpoint (línea vertical); el resto es igual.
const PROPOSE_PATH = { beam: "/detailing/propose", column: "/detailing/column/propose" };

async function calcPropose(project, elementId, params, kind = "beam") {
  const { run, request } = await lineRequest(project, elementId);
  const configuration = await prisma.modelConfiguration.findUnique({
    where: { projectId: project.id },
    select: { rebarSet: true },
  });
  if (!configuration?.rebarSet) {
    throw new AppError(409, "Define el juego de barras del proyecto (Define ▸ Barras de refuerzo).", {
      error: "detailing.noRebarSet",
    });
  }
  let data;
  try {
    ({ data } = await axios.post(
      `${env.calcServiceUrl}${PROPOSE_PATH[kind] || PROPOSE_PATH.beam}`,
      { ...request, rebarSet: configuration.rebarSet, params: params || {} },
      { timeout: 60000 }
    ));
  } catch (err) {
    const key = err.response?.status === 422 && err.response.data?.detail?.error;
    if (key) throw new AppError(422, key, { error: key });
    throw fromCalcError(err);
  }
  return { run, data };
}

const memberToApi = (row) => toApi(row, "concreteMember");

// Columnas de la comprobación D4 vacías: un armado nuevo aún no está comprobado.
const NO_CHECK = { checkResult: null, checkStatus: null, checkHash: null, checkedAt: null };

function rowFrom(data, run, params) {
  const p = data.proposal;
  return {
    ...NO_CHECK,
    params: params || {},
    layout: p.layout ?? null,
    issues: p.issues || [],
    status: p.status,
    inputsHash: p.inputsHash,
    engineVersion: p.engineVersion,
    designRunId: String(run._id),
  };
}

/** Crea (o recupera) la viga detallada que contiene `elementId` y le pone su propuesta. */
async function createMember(project, body) {
  // El cuerpo ya lo validó `validate(createMemberBody)` en la ruta.
  const params = body?.params || {};
  const kind = body?.kind === "column" ? "column" : "beam";
  const { run, data } = await calcPropose(project, body?.elementId, params, kind);
  const ids = data.line.elementIds;
  const lineKey = ids.join("|");
  const row = rowFrom(data, run, params);
  const saved = await prisma.concreteMember.upsert({
    where: { projectId_lineKey: { projectId: project.id, lineKey } },
    create: jsonNulls({ projectId: project.id, kind, name: ids.length > 1 ? `${ids[0]}–${ids[ids.length - 1]}` : ids[0], lineKey, elementIds: ids, ...row }, "concreteMember"),
    update: jsonNulls(row, "concreteMember"),
  });
  return { member: memberToApi(saved), ...data };
}

async function findMember(projectId, memberId) {
  if (!isUuid(memberId)) throw new AppError(404, "Viga no encontrada");
  const row = await prisma.concreteMember.findFirst({ where: { id: memberId, projectId } });
  if (!row) throw new AppError(404, "Viga no encontrada");
  return row;
}

async function listMembers(projectId) {
  const rows = await prisma.concreteMember.findMany({
    where: { projectId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true, name: true, kind: true, elementIds: true, status: true, updatedAt: true, inputsHash: true,
      checkStatus: true, checkedAt: true,
    },
  });
  return rows.map(memberToApi);
}

/**
 * La viga guardada con su línea recalculada. Si la propuesta guardada ya no corresponde a
 * las entradas actuales (otro diseño, otro juego de barras, otro modelo), `stale` lo dice:
 * se enseña lo guardado, pero hay que volver a proponer.
 */
async function getMember(project, memberId) {
  const row = await findMember(project.id, memberId);
  const ids = row.elementIds || [];
  let current = null;
  let currentError = null;
  try {
    current = (await calcPropose(project, ids[0], row.params, row.kind)).data;
  } catch (err) {
    currentError = err.details?.error || err.message;
  }
  const stale = !current || current.proposal.inputsHash !== row.inputsHash
    || (current.line.elementIds || []).join("|") !== row.lineKey;
  return { member: memberToApi(row), ...(current || {}), stale, currentError };
}

/** Nuevos `params` → nueva propuesta, guardada. */
async function updateMember(project, memberId, body) {
  const row = await findMember(project.id, memberId);
  const params = body?.params ?? row.params ?? {};
  const { run, data } = await calcPropose(project, (row.elementIds || [])[0], params, row.kind);
  if (data.line.elementIds.join("|") !== row.lineKey) {
    // La línea cambió en el modelo (se añadió o quitó una barra): es otra viga.
    throw new AppError(409, "La viga cambió en el modelo: vuelve a crearla desde Armado.", {
      error: "detailing.lineChanged",
    });
  }
  const saved = await prisma.concreteMember.update({
    where: { id: row.id },
    data: jsonNulls(rowFrom(data, run, params), "concreteMember"),
  });
  return { member: memberToApi(saved), ...data, stale: false };
}

// ─── D4: comprobación del armado guardado ──────────────────────────────────────────

/**
 * Comprueba el armado GUARDADO de la viga con las fuerzas del análisis del que salió el
 * diseño, combinadas con las combinaciones y preferencias vigentes (las mismas que
 * usaría una nueva comprobación de Design). Guarda el resultado con su huella.
 */
async function checkMember(project, memberId) {
  const row = await findMember(project.id, memberId);
  if (!row.layout) {
    throw new AppError(409, "La viga no tiene armado que comprobar.", { error: "detailing.noLayout" });
  }
  if (row.kind === "column") {
    // D6: la resistencia de una columna es la de Design (las barras son las de la sección).
    throw new AppError(409, "La resistencia de la columna es la de Design.", { error: "detailing.columnCheckIsDesign" });
  }
  const { run, request } = await lineRequest(project, (row.elementIds || [])[0]);
  const [analysisRun, configuration, resolved] = await Promise.all([
    prisma.analysisRun.findUnique({ where: { id: run.analysisRunId }, select: { id: true, cases: true } }),
    prisma.modelConfiguration.findUnique({ where: { projectId: project.id }, select: { rebarSet: true } }),
    designService.resolvePreferences(project.id, null),
  ]);
  if (!analysisRun) {
    throw new AppError(409, "El análisis del diseño ya no existe: vuelve a correr el diseño.", {
      error: "detailing.noAnalysisRun",
    });
  }
  if (resolved.combinations.length === 0) {
    throw new AppError(409, "El proyecto no tiene combinaciones de carga.", { error: "detailing.noCombinations" });
  }
  const body = {
    ...request,
    rebarSet: configuration?.rebarSet || {},
    layout: row.layout,
    analysis: {
      projectId: String(project.id),
      runId: String(analysisRun.id),
      bucket: env.s3Bucket,
      prefix: env.s3Prefix,
      cases: (analysisRun.cases || []).map((c) => ({ name: c.name, key: c.key, kind: c.kind })),
    },
    combinations: resolved.combinations.map((c) => ({
      name: c.name,
      factors: (c.factors || []).map((f) => ({ factor: f.factor, pattern: f.pattern ?? null, seismic: !!f.seismic })),
    })),
    preferences: resolved.preferences,
  };
  let data;
  try {
    ({ data } = await axios.post(`${env.calcServiceUrl}/detailing/check`, body, { timeout: 120000 }));
  } catch (err) {
    const key = err.response?.status === 422 && err.response.data?.detail?.error;
    if (key) throw new AppError(422, key, { error: key });
    throw fromCalcError(err);
  }
  if (data.line && (data.line.elementIds || []).join("|") !== row.lineKey) {
    throw new AppError(409, "La viga cambió en el modelo: vuelve a crearla desde Armado.", {
      error: "detailing.lineChanged",
    });
  }
  const check = data.check;
  const saved = await prisma.concreteMember.update({
    where: { id: row.id },
    data: jsonNulls(
      { checkResult: check, checkStatus: check.status, checkHash: check.inputsHash ?? null, checkedAt: new Date() },
      "concreteMember"
    ),
  });
  return { member: memberToApi(saved), check };
}

async function deleteMember(projectId, memberId) {
  const row = await findMember(projectId, memberId);
  await prisma.concreteMember.delete({ where: { id: row.id } });
  return { deleted: true };
}

module.exports = {
  line, lineRequest, createMember, listMembers, getMember, updateMember, checkMember, deleteMember,
};
