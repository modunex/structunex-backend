const { prisma } = require("../config/db");
const { AppError } = require("../middleware/errorHandler");
const { isUuid, childToApi, jsonNulls } = require("../lib/ids");
const { sanitizeSectionRefs } = require("./sectionRefs");

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

    create: async (project, data) => {
      const row = await db.create({
        data: { ...(await prepare(project, data)), projectId: project.id },
      });
      return childToApi(row, name);
    },

    update: async (project, id, data) => {
      if (!isUuid(id)) throw notFound();
      const { count } = await db.updateMany({
        where: { pk: id, projectId: project.id },
        data: await prepare(project, data),
      });
      if (!count) throw notFound();
      return childToApi(await db.findUnique({ where: { pk: id } }), name);
    },

    remove: async (project, id) => {
      if (!isUuid(id)) throw notFound();
      const { count } = await db.deleteMany({ where: { pk: id, projectId: project.id } });
      if (!count) throw notFound();
      return { deleted: true };
    },
  };
}

module.exports = { makeChildService };
