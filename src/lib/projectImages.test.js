const test = require("node:test");
const assert = require("node:assert/strict");
const sharp = require("sharp");
const { InvalidImageError, figureProblems, normalizeImage, withFigureOrigin } = require("./projectImages");
const { validateDocument } = require("./reportDocuments");

const raster = (width, height, channels = 3) =>
  sharp({ create: { width, height, channels, background: channels === 4 ? { r: 0, g: 0, b: 0, alpha: 0 } : "#123456" } });

const A = "01890000-0000-7000-8000-000000000001";
const B = "01890000-0000-7000-8000-000000000002";
const figure = (extra = {}) => ({ id: "f1", type: "figure", imageId: A, imageVersionId: B, caption: [{ text: "Planta" }], alt: "", width: "full", ...extra });
const doc = (block) => ({ version: 1, blocks: [block] });

test("normaliza un PNG y genera variantes", async () => {
  const image = await normalizeImage(await raster(3000, 1500).png().toBuffer());
  assert.equal(image.contentType, "image/png");
  assert.deepEqual([image.width, image.height], [3000, 1500]);
  const print = await sharp(image.print).metadata();
  const thumb = await sharp(image.thumb).metadata();
  assert.deepEqual([print.width, print.height], [2200, 1100]);
  assert.deepEqual([thumb.width, thumb.format], [480, "jpeg"]);
});

test("un JPEG sigue siendo JPEG y pierde EXIF", async () => {
  const input = await raster(400, 300).withExif({ IFD0: { Copyright: "secreto" } }).jpeg().toBuffer();
  assert.ok((await sharp(input).metadata()).exif);
  const image = await normalizeImage(input);
  assert.equal(image.contentType, "image/jpeg");
  assert.equal((await sharp(image.data).metadata()).exif, undefined);
});

test("aplica la orientación EXIF", async () => {
  const input = await raster(400, 200).withMetadata({ orientation: 6 }).jpeg().toBuffer();
  const image = await normalizeImage(input);
  assert.deepEqual([image.width, image.height], [200, 400]);
});

test("WebP se guarda como PNG y la transparencia se aplana en el PDF", async () => {
  const image = await normalizeImage(await raster(100, 100, 4).webp({ lossless: true }).toBuffer());
  assert.equal(image.contentType, "image/png");
  const pixel = await sharp(image.print).raw().toBuffer();
  assert.deepEqual([...pixel.subarray(0, 3)], [255, 255, 255]);
});

test("limita el lado mayor", async () => {
  const image = await normalizeImage(await raster(7000, 100).png().toBuffer());
  assert.equal(image.width, 6000);
});

test("rechaza lo que no es una imagen admitida", async () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>');
  await assert.rejects(normalizeImage(svg), InvalidImageError);
  await assert.rejects(normalizeImage(Buffer.from("%PDF-1.7 no soy imagen")), InvalidImageError);
  await assert.rejects(normalizeImage(await raster(10, 10).gif().toBuffer()), InvalidImageError);
  await assert.rejects(normalizeImage(await raster(10, 10).tiff().toBuffer()), InvalidImageError);
  const png = await raster(500, 500).png().toBuffer();
  await assert.rejects(normalizeImage(png.subarray(0, 60)), InvalidImageError);
});

test("valida el bloque de figura", () => {
  assert.equal(validateDocument(doc(figure())), null);
  assert.match(validateDocument(doc(figure({ imageVersionId: "x" }))), /invalid image/);
  assert.match(validateDocument(doc(figure({ width: "wide" }))), /invalid width/);
  assert.match(validateDocument(doc(figure({ alt: "a".repeat(501) }))), /invalid alt/);
  assert.match(validateDocument(doc(figure({ caption: "texto" }))), /invalid caption/);
  assert.match(validateDocument(doc(figure({ src: "http://evil.test/x.png" }))), /reserved field/);
  assert.match(validateDocument(doc(figure({ origin: {} }))), /reserved field/);
});

test("una figura de otra imagen o proyecto cuenta como problema", () => {
  const known = new Map([[B, { imageId: A }]]);
  assert.deepEqual(figureProblems(doc(figure()), known), []);
  assert.deepEqual(figureProblems(doc(figure({ imageId: B })), known), [{ blockId: "f1", type: "figure", reason: "missing" }]);
  assert.deepEqual(figureProblems(doc(figure()), new Map()), [{ blockId: "f1", type: "figure", reason: "missing" }]);
});

test("el registro guarda el origen de cada figura", () => {
  const known = new Map([[B, { imageId: A, number: 2, sha256: "abc", createdAt: "2026-11-03", analysisRunId: A, image: { name: "Deformada" } }]]);
  const [block] = withFigureOrigin(doc(figure()), known).blocks;
  assert.equal(block.origin.name, "Deformada");
  assert.equal(block.origin.number, 2);
  assert.equal(block.origin.analysisRunId, A);
  assert.equal(block.src, undefined);
});
