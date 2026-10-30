const { prisma } = require("../config/db");
const { toApi, jsonNulls } = require("../lib/ids");
const s3Service = require("./s3Service");

// Project metadata only. The structural model lives in its own tables and is managed
// through the per-entity sub-resource routes and /model. Ownership is enforced
// upstream by loadProject, so operations that already received a loaded project
// (update/remove) don't re-check it here.

const CREATE_FIELDS = [
  "name",
  "code",
  "templateId",
  "params",
  "analysisType",
  "dofPerNode",
  "units",
  "client",
  "company",
  "engineer",
  "description",
];

async function createProject({ ownerId, ...input }) {
  const data = { ownerId };
  for (const field of CREATE_FIELDS) {
    if (input[field] !== undefined) data[field] = input[field];
  }
  return toApi(await prisma.project.create({ data: jsonNulls(data, "project") }), "project");
}

// Metadata only — never loads the model. That's the point of normalizing.
async function listProjects(ownerId) {
  const rows = await prisma.project.findMany({
    where: { ownerId },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((row) => toApi(row, "project"));
}

const UPDATE_FIELDS = [
  "name",
  "code",
  "templateId",
  "units",
  "client",
  "company",
  "engineer",
  "description",
  // Desbloqueo manual del modelo (el auto-bloqueo lo hace analysisJob.start).
  "isLocked",
];

// project was loaded + authorized by loadProject; apply metadata changes.
async function updateProject(project, patch) {
  const data = {};
  for (const field of UPDATE_FIELDS) {
    if (patch[field] !== undefined) data[field] = patch[field];
  }
  const row = await prisma.project.update({ where: { id: project.id }, data });
  return toApi(row, "project");
}

// Deletes the project. ON DELETE CASCADE removes the whole model, its configuration
// and every analysis and design run in the same statement, so nothing is orphaned.
//
// The Parquet results in S3 cannot join that, so they go afterwards and best-effort:
// if that delete fails the rows are already gone and the bucket's lifecycle rule is
// what eventually reclaims the objects. Doing it before would be worse — a failed
// delete would have destroyed live results.
async function deleteProject(projectId) {
  await prisma.project.delete({ where: { id: projectId } });
  await s3Service.deleteProjectResults(projectId).catch(() => {});
  await s3Service.deletePrefix(s3Service.reportsPrefix(projectId)).catch(() => {});
  return { deleted: true };
}

module.exports = {
  createProject,
  listProjects,
  updateProject,
  deleteProject,
};
