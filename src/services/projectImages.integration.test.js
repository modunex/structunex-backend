// Biblioteca de imágenes contra un Postgres real, con S3 simulado:
//   COMMUNITY_TEST_DATABASE_URL=postgresql://... npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const sharp = require("sharp");

const url = process.env.COMMUNITY_TEST_DATABASE_URL;
const options = { skip: url ? false : "COMMUNITY_TEST_DATABASE_URL no definida", concurrency: false };
if (url) {
  process.env.DATABASE_URL = url;
  process.env.AWS_S3_BUCKET = "test-bucket";
}

function fakeStorage() {
  const objects = new Map();
  return {
    objects,
    signGet: async (key) => `https://s3.test/${key}`,
    signPut: async (key) => `https://s3.test/${key}?put`,
    putObject: async (key, body) => void objects.set(key, Buffer.from(body)),
    getObjectBuffer: async (key) => {
      if (!objects.has(key)) throw new Error("NoSuchKey");
      return objects.get(key);
    },
    objectSize: async (key) => {
      if (!objects.has(key)) throw new Error("NotFound");
      return objects.get(key).length;
    },
    deleteObject: async (key) => void objects.delete(key),
    deletePrefix: async (prefix) => {
      for (const key of objects.keys()) if (key.startsWith(`${prefix}/`)) objects.delete(key);
    },
  };
}

test("Biblioteca de imágenes", options, async (t) => {
  const { prisma } = require("../config/db");
  const { env } = require("../config/env");
  const images = require("./projectImageService");

  const storage = fakeStorage();
  const project = await prisma.project.create({ data: { ownerId: `images-${crypto.randomUUID()}`, name: "Biblioteca" } });
  const other = await prisma.project.create({ data: { ownerId: `images-${crypto.randomUUID()}`, name: "Otro" } });
  t.after(async () => {
    await prisma.project.deleteMany({ where: { id: { in: [project.id, other.id] } } });
    await prisma.$disconnect();
  });

  const png = (color = "#336699") => sharp({ create: { width: 800, height: 600, channels: 3, background: color } }).png().toBuffer();
  const upload = async (target, body) => {
    const { key } = await images.uploadUrl(target, { contentType: "image/png", bytes: body.length }, storage);
    storage.objects.set(key, body);
    return key;
  };
  const add = async (name = "Planta") => images.create(project, "user", { source: "upload", name, key: await upload(project, await png()) }, storage);
  const reportWith = (image, versionId) =>
    prisma.report.create({
      data: {
        projectId: project.id,
        title: "Memoria",
        document: { version: 1, blocks: [{ id: "f1", type: "figure", imageId: image._id, imageVersionId: versionId, caption: [], alt: "", width: "full" }] },
      },
    });

  await t.test("sube, normaliza y limpia la entrada", async () => {
    const image = await add();
    assert.equal(image.kind, "file");
    assert.equal(image.versionCount, 1);
    assert.equal(image.current.number, 1);
    assert.equal(image.current.width, 800);
    assert.equal(image.current.s3Key, undefined);
    assert.ok(image.current.thumbnailUrl);
    assert.equal([...storage.objects.keys()].some((key) => key.includes("/incoming/")), false);
    assert.equal(storage.objects.size, 3);
  });

  await t.test("una subida no puede forzar el tipo aunque diga venir del visor con clave ajena", async () => {
    const key = await upload(other, await png());
    await assert.rejects(images.create(project, "user", { source: "upload", name: "x", key }, storage), { status: 400 });
    await assert.rejects(images.create(project, "user", { source: "upload", name: "x", key: `${key}/../../x` }, storage), { status: 400 });
  });

  await t.test("rechaza un archivo que no es imagen y lo borra", async () => {
    const key = await upload(project, Buffer.from("<svg onload='alert(1)'></svg>"));
    await assert.rejects(images.create(project, "user", { source: "upload", name: "x", key }, storage), { status: 400 });
    assert.equal(storage.objects.has(key), false);
  });

  await t.test("rechaza lo que supera el tope aunque la URL firmada lo dejara subir", async () => {
    await assert.rejects(images.uploadUrl(project, { contentType: "image/png", bytes: env.imageMaxBytes + 1 }, storage), { status: 413 });
    const key = await upload(project, await png());
    storage.objects.set(key, Buffer.alloc(env.imageMaxBytes + 1));
    await assert.rejects(images.create(project, "user", { source: "upload", name: "x", key }, storage), { status: 413 });
    assert.equal(storage.objects.has(key), false);
  });

  await t.test("respeta el tope del proyecto", async () => {
    const limit = env.imageProjectMaxBytes;
    env.imageProjectMaxBytes = 10;
    await assert.rejects(images.uploadUrl(project, { contentType: "image/png", bytes: 100 }, storage), { status: 413 });
    env.imageProjectMaxBytes = limit;
  });

  await t.test("una versión nueva no cambia la anterior", async () => {
    const image = await add("Deformada");
    const first = image.current._id;
    const second = await images.addVersion(project, image._id, { key: await upload(project, await png("#aa0000")) }, storage);
    assert.equal(second.current.number, 2);
    assert.equal(second.versionCount, 2);
    assert.notEqual(second.current._id, first);
    const old = await images.versionUrl(project, first, storage);
    assert.equal(old.number, 1);
    assert.equal(old.retired, false);
  });

  await t.test("no acepta ejecuciones de otro proyecto", async () => {
    const run = await prisma.analysisRun.create({ data: { projectId: other.id } });
    const key = await upload(project, await png());
    await assert.rejects(
      images.create(project, "user", { source: "viewer", kind: "analysis", name: "x", key, analysisRunId: run.id }, storage),
      { status: 400 }
    );
  });

  await t.test("otro proyecto no alcanza las imágenes", async () => {
    const image = await add();
    await assert.rejects(images.versionUrl(other, image.current._id, storage), { status: 404 });
    await assert.rejects(images.getOne(other, image._id, storage), { status: 404 });
    await assert.rejects(images.remove(other, image._id, storage), { status: 404 });
    const { images: rows } = await images.list(other, storage);
    assert.equal(rows.length, 0);
  });

  await t.test("borrar una imagen sin usar la elimina de verdad", async () => {
    const image = await add();
    const before = storage.objects.size;
    const result = await images.remove(project, image._id, storage);
    assert.equal(result.purged, true);
    assert.equal(storage.objects.size, before - 3);
  });

  await t.test("borrar una imagen usada conserva lo que el reporte necesita", async () => {
    const image = await add("Usada");
    const report = await reportWith(image, image.current._id);
    await prisma.reportRevision.create({ data: { reportId: report.id, number: 1, name: "Rev. A", document: report.document, documentHash: "h" } });
    const { reports } = await images.usage(project, image._id);
    assert.equal(reports[0].draft, true);
    assert.equal(reports[0].revisions[0].name, "Rev. A");
    const result = await images.remove(project, image._id, storage);
    assert.deepEqual([result.purged, result.reports], [false, 1]);
    const { images: rows } = await images.list(project, storage);
    assert.equal(rows.some((row) => row._id === image._id), false);
    assert.equal((await images.versionUrl(project, image.current._id, storage)).retired, true);
  });

  await t.test("incrusta las figuras solo para el renderizador", async () => {
    const image = await add("Para PDF");
    const report = await reportWith(image, image.current._id);
    const versions = await images.documentVersions(project, report.document);
    const rendered = await images.withFigureData(report.document, versions, storage);
    assert.match(rendered.blocks[0].src, /^data:image\/png;base64,/);
    assert.equal(report.document.blocks[0].src, undefined);
    assert.equal((await images.documentVersions(other, report.document)).size, 0);
  });

  await t.test("no genera un PDF al que le falte una imagen o que supere el límite", async () => {
    const image = await add("Perdida");
    const report = await reportWith(image, image.current._id);
    const versions = await images.documentVersions(project, report.document);
    await assert.rejects(images.withFigureData(report.document, versions, fakeStorage()), { status: 502 });
    const huge = new Map([...versions].map(([id, version]) => [id, { ...version, printBytes: 30 * 1024 * 1024 }]));
    await assert.rejects(images.withFigureData(report.document, huge, storage), { status: 413 });
  });
});
