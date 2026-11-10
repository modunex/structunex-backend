const { AppError } = require("../middleware/errorHandler");
const { toApi, jsonNulls } = require("../lib/ids");
const { getExample, buildExampleModel, exampleMeta } = require("../lib/examples");

// Proyectos de ejemplo (onboarding). Ver lib/examples.js para el formato de la fixture.
//
// Crear un ejemplo = un proyecto normal + su modelo + el material y las secciones que
// necesita en el catálogo del usuario, todo en UNA transacción. Después se guarda la
// huella del modelo recién creado (`params.example.modelHash`): es la que dice si el
// usuario lo ha modificado y si un análisis corresponde al ejemplo intacto, que es la
// única situación en la que tiene sentido compararlo con la referencia.
//
// Las dependencias se inyectan (makeExampleService) para poder probar el servicio con
// una base de datos en memoria; la instancia por defecto se arma al primer uso.

const TX_OPTIONS = { maxWait: 10_000, timeout: 30_000 };

function makeExampleService({ prisma, writeModel, resolveProps, currentModelHash }) {
  // Reutiliza un material idéntico del catálogo del usuario (abrir el ejemplo dos
  // veces no debe duplicarlo); si no hay, lo crea.
  async function ensureMaterial(tx, ownerId, def) {
    const { key, ...fields } = def;
    const existing = await tx.catalogMaterial.findFirst({
      where: { ownerId, ...fields },
      select: { id: true },
    });
    if (existing) return existing.id;
    const row = await tx.catalogMaterial.create({ data: { ...fields, ownerId } });
    return row.id;
  }

  // Igual con la sección: mismo perfil de catálogo sobre el mismo material.
  async function ensureFrameSection(tx, ownerId, def, materialId) {
    const { key, materialKey, ...fields } = def;
    const existing = await tx.catalogFrameSection.findFirst({
      where: {
        ownerId,
        materialId,
        source: fields.source,
        catalogLabel: fields.catalogLabel,
        propertyType: fields.propertyType,
      },
      select: { id: true },
    });
    if (existing) return existing.id;
    const props = resolveProps(fields);
    const row = await tx.catalogFrameSection.create({
      data: { ...fields, materialId, ownerId, props },
    });
    return row.id;
  }

  // Y la sección de área (losa): mismo material, tipo y espesores.
  async function ensureAreaSection(tx, ownerId, def, materialId) {
    const { key, materialKey, ...fields } = def;
    const existing = await tx.catalogAreaSection.findFirst({
      where: {
        ownerId,
        materialId,
        kind: fields.kind,
        shellType: fields.shellType,
        thicknessMembrane: fields.thicknessMembrane,
        thicknessBending: fields.thicknessBending,
      },
      select: { id: true },
    });
    if (existing) return existing.id;
    const row = await tx.catalogAreaSection.create({ data: { ...fields, materialId, ownerId } });
    return row.id;
  }

  async function createFromExample(ownerId, exampleId, { name } = {}) {
    const example = getExample(exampleId);
    if (!example) throw new AppError(404, "Ejemplo no encontrado");

    const project = await prisma.$transaction(async (tx) => {
      const materialIds = {};
      for (const def of example.catalog.materials) {
        materialIds[def.key] = await ensureMaterial(tx, ownerId, def);
      }
      const sectionIds = {};
      for (const def of example.catalog.frameSections) {
        const materialId = materialIds[def.materialKey];
        if (!materialId) throw new Error(`Material sin resolver en ${example.id}: ${def.materialKey}`);
        sectionIds[def.key] = await ensureFrameSection(tx, ownerId, def, materialId);
      }
      for (const def of example.catalog.areaSections || []) {
        const materialId = materialIds[def.materialKey];
        if (!materialId) throw new Error(`Material sin resolver en ${example.id}: ${def.materialKey}`);
        sectionIds[def.key] = await ensureAreaSection(tx, ownerId, def, materialId);
      }

      const created = await tx.project.create({
        data: jsonNulls(
          {
            ownerId,
            name: (name && name.trim()) || example.defaultName,
            code: example.code,
            templateId: example.project.templateId,
            analysisType: example.project.analysisType,
            dofPerNode: example.project.dofPerNode,
            params: {
              ...example.project.params,
              example: { id: example.id, version: example.version },
            },
          },
          "project"
        ),
      });
      await writeModel(tx, created, buildExampleModel(example, sectionIds));
      return created;
    }, TX_OPTIONS);

    // La huella se calcula con el mismo armado que usa el análisis, ya con el modelo
    // escrito. Si no se pudiera calcular quedaría null y la validación diría "no aplica".
    const modelHash = await currentModelHash(project.id);
    const updated = await prisma.project.update({
      where: { id: project.id },
      data: { params: { ...project.params, example: { ...project.params.example, modelHash } } },
    });
    return toApi(updated, "project");
  }

  // Estado del ejemplo de un proyecto: la referencia y si el modelo y el último análisis
  // siguen siendo los del ejemplo intacto.
  async function getProjectExample(project) {
    const meta = exampleMeta(project);
    if (!meta) throw new AppError(404, "Este proyecto no es un modelo de ejemplo");
    const example = getExample(meta.id);
    const sameVersion = !!example && example.version === meta.version;
    const pristine = meta.modelHash || null;

    const [current, run] = await Promise.all([
      currentModelHash(project.id),
      prisma.analysisRun.findFirst({
        where: { projectId: project.id, status: "solved" },
        orderBy: { startedAt: "desc" },
        select: { id: true, modelHash: true },
      }),
    ]);

    return {
      id: meta.id,
      version: meta.version,
      code: example ? example.code : null,
      // Una fixture de otra versión no es la referencia de ESTE modelo.
      reference: sameVersion ? example.reference : null,
      modelUnchanged: !!pristine && current === pristine,
      latestRun: run
        ? { id: run.id, matchesExample: !!pristine && run.modelHash === pristine }
        : null,
    };
  }

  return { createFromExample, getProjectExample };
}

let defaultService = null;
function service() {
  if (!defaultService) {
    const { prisma } = require("../models");
    defaultService = makeExampleService({
      prisma,
      writeModel: require("./modelService").writeModel,
      resolveProps: require("./catalogFrameSectionService").resolveProps,
      currentModelHash: require("./analysisService").currentModelHash,
    });
  }
  return defaultService;
}

module.exports = {
  makeExampleService,
  createFromExample: (...args) => service().createFromExample(...args),
  getProjectExample: (...args) => service().getProjectExample(...args),
};
