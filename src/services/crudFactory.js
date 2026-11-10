const { prisma } = require("../config/db");
const { AppError } = require("../middleware/errorHandler");
const { isUuid, childToApi, jsonNulls } = require("../lib/ids");
const { sanitizeSectionRefs } = require("./sectionRefs");
const { guardedModelTransaction } = require("./modelLock");

// Builds the standard project-scoped CRUD for a table of the structural model. Every
// row is addressed by its `pk` (exposed as `_id`) and always constrained to its
// project, so a child of another project is never reachable. Ownership was already
// checked upstream by loadProject, which hands us the project row.
//
// `name` is the Prisma delegate ("modelNode", "modelElement", ...).
function makeChildService(name) {
  const db = prisma[name];
  const notFound = () => new AppError(404, `${name} not found`);
  const prepare = async (project, data) => {
    const [row] = await sanitizeSectionRefs(prisma, project.ownerId, name, [data]);
    return jsonNulls(row, name);
  };

  return {
    list: async (project) =>
      (
        await db.findMany({ where: { projectId: project.id }, orderBy: { seq: "asc" } })
      ).map((row) => childToApi(row, name)),

    getOne: async (project, id) => {
      if (!isUuid(id)) throw notFound();
      const row = await db.findFirst({ where: { pk: id, projectId: project.id } });
      if (!row) throw notFound();
      return childToApi(row, name);
    },

    // Escrituras: con el proyecto bloqueado, se rechazan (409) si cambian la huella del
    // modelo (modelLock).
    create: async (project, data) => {
      const fields = await prepare(project, data);
      const row = await guardedModelTransaction(project.id, (tx) =>
        tx[name].create({ data: { ...fields, projectId: project.id } })
      );
      return childToApi(row, name);
    },

    update: async (project, id, data) => {
      if (!isUuid(id)) throw notFound();
      const fields = await prepare(project, data);
      const row = await guardedModelTransaction(project.id, async (tx) => {
        const { count } = await tx[name].updateMany({
          where: { pk: id, projectId: project.id },
          data: fields,
        });
        if (!count) throw notFound();
        return tx[name].findUnique({ where: { pk: id } });
      });
      return childToApi(row, name);
    },

    remove: async (project, id) => {
      if (!isUuid(id)) throw notFound();
      await guardedModelTransaction(project.id, async (tx) => {
        const { count } = await tx[name].deleteMany({ where: { pk: id, projectId: project.id } });
        if (!count) throw notFound();
      });
      return { deleted: true };
    },
  };
}

module.exports = { makeChildService };
