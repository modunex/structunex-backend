// Pruebas de la Comunidad contra un Postgres real. Se saltan si no hay base de pruebas:
//   COMMUNITY_TEST_DATABASE_URL=postgresql://... npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

const url = process.env.COMMUNITY_TEST_DATABASE_URL;
const options = { skip: url ? false : "COMMUNITY_TEST_DATABASE_URL no definida", concurrency: false };

if (url) {
  process.env.DATABASE_URL = url;
  process.env.COMMUNITY_EMAIL_FROM = "community@example.com";
  process.env.COMMUNITY_EMAIL_SECRET = "test-secret";
  process.env.AWS_S3_BUCKET = "test-bucket";
}

test("Comunidad", options, async (t) => {
  const express = require("express");
  const { prisma } = require("../config/db");
  const { errorHandler } = require("../middleware/errorHandler");
  const { createCommunityRouter } = require("../routes/communityRoutes");
  const community = require("./communityService");
  const attachments = require("./communityAttachmentService");
  const emails = require("./communityEmailService");

  const app = express();
  app.use(express.json());
  const auth = (req, _res, next) => {
    if (!req.headers["x-test-user"]) return next(Object.assign(new Error(), { status: 401 }));
    req.userId = req.headers["x-test-user"];
    next();
  };
  app.use("/c", createCommunityRouter({ auth, rateLimits: false }));
  app.use((err, req, res, next) => (err.status === 401 ? res.status(401).end() : errorHandler(err, req, res, next)));
  const server = http.createServer(app).listen(0);
  const base = `http://127.0.0.1:${server.address().port}/c`;

  const call = async (method, path, { user, body } = {}) => {
    const res = await fetch(base + path, {
      method,
      redirect: "manual",
      headers: { "content-type": "application/json", ...(user ? { "x-test-user": user } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {}
    return { status: res.status, json, text, headers: res.headers };
  };

  const clean = async () => {
    await prisma.forumEmailOutbox.deleteMany();
    await prisma.forumModerationLog.deleteMany();
    await prisma.forumReport.deleteMany();
    await prisma.forumAttachment.deleteMany();
    await prisma.forumThread.deleteMany();
    await prisma.forumProfile.deleteMany();
    await prisma.forumTag.deleteMany();
    await prisma.forumTopic.deleteMany();
    await prisma.user.deleteMany({ where: { clerkId: { startsWith: "t_" } } });
  };

  let seq = 0;
  const person = async (fields = {}) => {
    seq += 1;
    const clerkId = `t_${seq}`;
    const user = await prisma.user.create({
      data: {
        clerkId,
        email: `secret${seq}@example.com`,
        firstName: "Nombre",
        lastName: "Real",
        imageUrl: "https://img.clerk.com/foto.png",
      },
    });
    const profile = await prisma.forumProfile.create({
      data: {
        userId: user.id,
        handle: `user_${seq}`,
        displayName: `User ${seq}`,
        guidelinesAcceptedAt: new Date(),
        emailVerifiedAt: new Date(),
        createdAt: new Date(Date.now() - 3 * 86400000),
        ...fields,
      },
    });
    return { clerkId, profile };
  };

  const doc = (text = "Contenido de prueba") => ({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  });
  const thread = (overrides = {}) => ({
    topic: "structural-engineering",
    locale: "es",
    title: "Una pregunta técnica de prueba",
    tags: ["steel"],
    body: doc(),
    codeEdition: "AISC 360-22",
    assumptions: "Viga simplemente apoyada",
    units: "kN, mm",
    ...overrides,
  });
  const newThread = async (user, overrides) => {
    const res = await call("POST", "/threads", { user, body: thread(overrides) });
    assert.equal(res.status, 201, res.text);
    return res.json.number;
  };

  await clean();
  await community.ensureCatalog();
  t.after(async () => {
    await clean();
    server.close();
    await prisma.$disconnect();
  });

  await t.test("el catálogo no sobrescribe cambios de moderación", async () => {
    await prisma.forumTag.update({ where: { slug: "steel" }, data: { nameEs: "acero estructural" } });
    await community.ensureCatalog();
    const tag = await prisma.forumTag.findUnique({ where: { slug: "steel" } });
    assert.equal(tag.nameEs, "acero estructural");
    assert.equal((await call("GET", "/topics")).json.length, 7);
  });

  await t.test("escribir exige sesión, perfil y normas aceptadas", async () => {
    assert.equal((await call("POST", "/threads", { body: thread() })).status, 401);
    assert.equal((await call("POST", "/threads", { user: "t_nadie", body: thread() })).status, 403);
    const a = await person({ guidelinesAcceptedAt: null });
    assert.equal((await call("POST", "/threads", { user: a.clerkId, body: thread() })).json.error, "GuidelinesRequired");
    const b = await person({ emailVerifiedAt: null });
    assert.equal((await call("POST", "/threads", { user: b.clerkId, body: thread() })).json.error, "EmailNotVerified");
    const c = await person({ suspendedUntil: new Date(Date.now() + 86400000) });
    assert.equal((await call("POST", "/threads", { user: c.clerkId, body: thread() })).json.error, "Suspended");
  });

  await t.test("las respuestas públicas nunca exponen correo ni nombre real", async () => {
    const a = await person();
    const number = await newThread(a.clerkId);
    for (const path of ["/feed", `/threads/${number}`, `/users/${a.profile.handle}`]) {
      const { text } = await call("GET", path);
      assert.doesNotMatch(text, /secret\d+@example\.com/);
      assert.doesNotMatch(text, /Nombre|Real|clerkId|userId|t_\d/);
    }
    const view = (await call("GET", `/threads/${number}`)).json;
    assert.equal(view.author.imageUrl, "https://img.clerk.com/foto.png");
    assert.equal(view.posts[0].author.imageUrl, "https://img.clerk.com/foto.png");
    assert.equal((await call("GET", `/users/${a.profile.handle}`)).json.imageUrl, "https://img.clerk.com/foto.png");
  });

  await t.test("el perfil toma el nombre de Clerk y nunca el correo", async () => {
    const user = (clerkId) => prisma.user.create({ data: { clerkId, email: `${clerkId}@example.com` } });
    const first = await user("t_clerk1");
    const resolve = (u, displayName) => async () => ({ user: u, emailVerified: true, displayName });
    const made = await community.upsertProfile("t_clerk1", { acceptGuidelines: true }, resolve(first, "María Rojas Núñez"));
    assert.equal(made.profile.displayName, "María Rojas Núñez");
    assert.equal(made.profile.handle, "maria_rojas_nunez");

    const twin = await user("t_clerk2");
    const second = await community.upsertProfile("t_clerk2", {}, resolve(twin, "María Rojas Núñez"));
    assert.match(second.profile.handle, /^maria_rojas_nunez_\d+$/);

    const noName = await user("t_clerk3");
    const third = await community.upsertProfile("t_clerk3", {}, resolve(noName, ""));
    assert.match(third.profile.handle, /^user_\d+$/);
    assert.doesNotMatch(third.profile.displayName, /@/);

    assert.equal((await call("PUT", "/me", { user: "t_clerk1", body: { handle: "otro", displayName: "Otro" } })).status, 200);
    const same = await community.getMe("t_clerk1");
    assert.equal(same.profile.handle, "maria_rojas_nunez");
    assert.equal(same.profile.displayName, "María Rojas Núñez");

    const users = require("./userService");
    await users.upsertFromClerk({ clerkId: "t_clerk1", email: "x@example.com", firstName: "Ana", lastName: "Paz" });
    assert.equal((await community.getMe("t_clerk1")).profile.displayName, "Ana Paz");
  });

  await t.test("valida contexto técnico, tags y temas del equipo", async () => {
    const a = await person();
    const post = (overrides) => call("POST", "/threads", { user: a.clerkId, body: thread(overrides) });
    assert.equal((await post({ codeEdition: undefined })).status, 400);
    assert.equal((await post({ topic: "software", codeEdition: undefined, assumptions: undefined, units: undefined })).status, 201);
    assert.equal((await post({ tags: ["no-existe"] })).status, 400);
    assert.equal((await post({ tags: ["steel", "concrete", "seismic", "reports"] })).status, 400);
    assert.equal((await post({ topic: "faq" })).status, 403);
    assert.equal((await post({ title: "corto" })).status, 400);
    const mod = await person({ role: "moderator" });
    assert.equal((await call("POST", "/threads", { user: mod.clerkId, body: thread({ topic: "faq" }) })).status, 201);
  });

  await t.test("rechaza documentos manipulados", async () => {
    const a = await person();
    const bad = [
      { type: "doc", content: [{ type: "script", content: [] }] },
      { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "x", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] }] }] },
      { type: "doc", content: [] },
      "<script>alert(1)</script>",
    ];
    for (const body of bad) {
      assert.equal((await call("POST", "/threads", { user: a.clerkId, body: thread({ body }) })).status, 400);
    }
  });

  await t.test("el feed filtra por tema, tag, idioma y sin respuesta", async () => {
    await prisma.forumThread.deleteMany();
    const a = await person();
    const b = await person();
    const es = await newThread(a.clerkId, { title: "Pregunta en español uno", tags: ["steel"] });
    await newThread(a.clerkId, { title: "Question in english one", locale: "en", tags: ["concrete"] });
    await newThread(a.clerkId, { topic: "software", title: "Pregunta de software uno", tags: [] });
    assert.equal((await call("POST", `/threads/${es}/posts`, { user: b.clerkId, body: { body: doc() } })).status, 201);

    const feed = async (query) => (await call("GET", `/feed?${query}`)).json;
    assert.equal((await feed("")).total, 3);
    assert.equal((await feed("locale=en")).total, 1);
    assert.equal((await feed("topic=software")).total, 1);
    assert.equal((await feed("tag=steel")).total, 1);
    assert.equal((await feed("tag=steel&locale=en")).total, 0);
    assert.equal((await feed("sort=unanswered")).total, 2);
    assert.equal((await feed("locale=xx&page=0")).threads, undefined);
    const top = (await feed("")).threads[0];
    assert.equal(top.number, es);
    assert.equal(top.replyCount, 1);
  });

  await t.test("el autor edita dentro de la ventana y nadie más", async () => {
    const a = await person();
    const b = await person();
    const number = await newThread(a.clerkId);
    const postId = (await call("GET", `/threads/${number}`)).json.posts[0].id;
    const edit = (user) => call("PATCH", `/posts/${postId}`, { user, body: { body: doc("Editado") } });
    assert.equal((await edit(b.clerkId)).status, 403);
    assert.equal((await edit(a.clerkId)).status, 200);
    assert.ok((await call("GET", `/threads/${number}`)).json.posts[0].editedAt);
    await prisma.forumPost.update({ where: { id: postId }, data: { createdAt: new Date(Date.now() - 2 * 86400000) } });
    assert.equal((await edit(a.clerkId)).json.error, "EditWindowClosed");
  });

  await t.test("un hilo bloqueado no admite respuestas de miembros", async () => {
    const a = await person();
    const mod = await person({ role: "moderator" });
    const number = await newThread(a.clerkId);
    const lock = await call("POST", `/moderation/threads/${number}/lock`, { user: mod.clerkId, body: { value: true } });
    assert.equal(lock.status, 200);
    assert.equal((await call("POST", `/threads/${number}/posts`, { user: a.clerkId, body: { body: doc() } })).json.error, "Locked");
    assert.equal((await call("GET", `/threads/${number}`)).json.locked, true);
  });

  await t.test("una cuenta nueva tiene menos cupo diario", async () => {
    const a = await person({ createdAt: new Date() });
    for (let i = 0; i < 3; i += 1) await newThread(a.clerkId, { title: `Pregunta número ${i} de prueba` });
    assert.equal((await call("POST", "/threads", { user: a.clerkId, body: thread() })).status, 429);
  });

  await t.test("reportes y moderación con auditoría", async () => {
    const a = await person();
    const b = await person();
    const mod = await person({ role: "moderator" });
    const number = await newThread(a.clerkId);
    await call("POST", `/threads/${number}/posts`, { user: b.clerkId, body: { body: doc("Respuesta dudosa") } });
    const posts = (await call("GET", `/threads/${number}`)).json.posts;
    const reply = posts[1].id;

    assert.equal((await call("POST", `/posts/${reply}/report`, { user: a.clerkId, body: { reason: "unsafe" } })).status, 201);
    assert.equal((await call("POST", `/posts/${reply}/report`, { user: a.clerkId, body: { reason: "unsafe" } })).status, 201);
    assert.equal((await prisma.forumReport.count({ where: { postId: reply } })), 1);

    assert.equal((await call("GET", "/moderation/reports", { user: a.clerkId })).status, 403);
    assert.equal((await call("POST", `/moderation/posts/${reply}/hide`, { user: a.clerkId, body: {} })).status, 403);
    const reports = (await call("GET", "/moderation/reports", { user: mod.clerkId })).json;
    assert.equal(reports.length, 1);

    assert.equal((await call("POST", `/moderation/posts/${reply}/hide`, { user: mod.clerkId, body: { reason: "Incorrecto" } })).status, 200);
    let view = (await call("GET", `/threads/${number}`)).json;
    assert.equal(view.posts.length, 1);
    assert.equal(view.replyCount, 0);
    assert.equal((await prisma.forumPost.count({ where: { id: reply } })), 1);

    await call("POST", `/moderation/posts/${reply}/restore`, { user: mod.clerkId, body: {} });
    view = (await call("GET", `/threads/${number}`)).json;
    assert.equal(view.replyCount, 1);

    await call("POST", `/moderation/reports/${reports[0].id}`, { user: mod.clerkId, body: { status: "resolved" } });
    assert.equal((await call("GET", "/moderation/reports", { user: mod.clerkId })).json.length, 0);

    await call("POST", `/moderation/posts/${posts[0].id}/hide`, { user: mod.clerkId, body: {} });
    assert.equal((await call("GET", `/threads/${number}`)).status, 404);
    assert.ok((await prisma.forumModerationLog.count({ where: { actorId: mod.profile.id } })) >= 4);
  });

  await t.test("suspender bloquea la escritura y un moderador no suspende a un admin", async () => {
    const a = await person();
    const admin = await person({ role: "admin" });
    const mod = await person({ role: "moderator" });
    const until = new Date(Date.now() + 86400000).toISOString();
    assert.equal((await call("POST", `/moderation/users/${a.profile.handle}/suspend`, { user: mod.clerkId, body: { until } })).status, 200);
    assert.equal((await call("POST", "/threads", { user: a.clerkId, body: thread() })).json.error, "Suspended");
    assert.equal((await call("POST", `/moderation/users/${admin.profile.handle}/suspend`, { user: mod.clerkId, body: { until } })).status, 403);

    const other = await person({ role: "moderator" });
    assert.equal((await call("POST", `/moderation/users/${other.profile.handle}/suspend`, { user: mod.clerkId, body: { until } })).status, 403);
    const suspended = await person({ role: "moderator", suspendedUntil: new Date(Date.now() + 86400000) });
    assert.equal((await call("POST", `/moderation/users/${suspended.profile.handle}/suspend`, { user: suspended.clerkId, body: { until: null } })).json.error, "Suspended");
    assert.equal((await call("GET", "/moderation/reports", { user: suspended.clerkId })).status, 403);
    const renamed = await community.upsertProfile(a.clerkId, { displayName: "Otro nombre" }).catch((err) => err);
    assert.equal(renamed.message, "Suspended");
  });

  await t.test("solo el sitemap incluye hilos con respuestas y visibles", async () => {
    await prisma.forumThread.deleteMany();
    const a = await person();
    const b = await person();
    const answered = await newThread(a.clerkId, { title: "Pregunta con una respuesta" });
    await newThread(a.clerkId, { title: "Pregunta sin ninguna respuesta" });
    await call("POST", `/threads/${answered}/posts`, { user: b.clerkId, body: { body: doc() } });
    const map = (await call("GET", "/sitemap")).json;
    assert.deepEqual(map.threads.map((row) => row.number), [answered]);
    assert.ok(map.topics.some((row) => row.slug === "structural-engineering" && row.count === 2));
    assert.ok(map.tags.some((row) => row.slug === "steel" && row.count === 2));
  });

  await t.test("avisos: solo a suscriptores, sin duplicar, con baja firmada", async () => {
    await prisma.forumEmailOutbox.deleteMany();
    const a = await person();
    const b = await person();
    const quiet = await person({ notifyReplies: false });
    const number = await newThread(a.clerkId);
    const threadRow = await prisma.forumThread.findUnique({ where: { number } });
    await prisma.forumSubscription.create({ data: { threadId: threadRow.id, profileId: quiet.profile.id } });

    await call("POST", `/threads/${number}/posts`, { user: b.clerkId, body: { body: doc("Una respuesta") } });
    const rows = await prisma.forumEmailOutbox.findMany();
    assert.deepEqual(rows.map((row) => row.profileId), [a.profile.id]);

    const sent = [];
    assert.equal(await emails.processOutbox(async (row) => (sent.push(row.profile.user.email), "sent")), 1);
    assert.equal(await emails.processOutbox(async () => assert.fail("no debe reenviar")), 0);
    assert.equal(sent.length, 1);

    await prisma.forumEmailOutbox.create({ data: { postId: rows[0].postId, profileId: b.profile.id } });
    await emails.processOutbox(async () => {
      throw new Error("SES caído");
    });
    const retried = await prisma.forumEmailOutbox.findFirst({ where: { profileId: b.profile.id } });
    assert.equal(retried.status, "pending");
    assert.equal(retried.attempts, 1);
    await prisma.forumEmailOutbox.deleteMany();

    assert.equal(emails.verifyUnsubscribe(`${a.profile.id}.falsa`), null);
    assert.equal((await call("POST", "/unsubscribe?token=falso")).status, 400);
    const token = encodeURIComponent(emails.unsubscribeToken(a.profile.id));
    assert.equal((await call("GET", `/unsubscribe?token=${token}`)).status, 200);
    assert.equal((await prisma.forumProfile.findUnique({ where: { id: a.profile.id } })).notifyReplies, true);
    assert.equal((await call("POST", `/unsubscribe?token=${token}`)).status, 200);
    assert.equal((await prisma.forumProfile.findUnique({ where: { id: a.profile.id } })).notifyReplies, false);
  });

  const PDF = Buffer.from("%PDF-1.7\n");
  const fakeStorage = (over = {}) => {
    const calls = { deleted: [], signed: [] };
    return {
      calls,
      signPut: async (key) => `https://s3.test/${key}?put`,
      signGet: async (key, opts) => (calls.signed.push({ key, ...opts }), `https://s3.test/${key}?get`),
      objectSize: async () => PDF.length,
      copyObject: async (from, to) => (calls.copied = { from, to }),
      getObjectHead: async () => PDF,
      getObjectBuffer: async () => PDF,
      getObjectTags: async () => ({}),
      putObject: async () => {},
      deleteObject: async (key) => calls.deleted.push(key),
      ...over,
    };
  };

  await t.test("adjuntos: rechaza tipos, tamaños y contenido falso", async () => {
    const a = await person();
    const storage = fakeStorage();
    await assert.rejects(attachments.presign(a.profile, { name: "virus.exe", size: 10 }, storage), /permitido/);
    await assert.rejects(attachments.presign(a.profile, { name: "pagina.html", size: 10 }, storage), /permitido/);
    await assert.rejects(attachments.presign(a.profile, { name: "a.pdf", size: 30 * 1024 * 1024 }, storage), /20 MB/);

    const up = await attachments.presign(a.profile, { name: "a.pdf", size: 10 }, storage);
    assert.equal(up.contentType, "application/pdf");
    const liar = fakeStorage({ getObjectHead: async () => Buffer.from("MZ\x90") });
    await assert.rejects(attachments.complete(a.profile, up.id, liar), /no corresponde/);
    assert.equal(await prisma.forumAttachment.count({ where: { id: up.id } }), 0);
    assert.equal(liar.calls.deleted.length, 2); // la subida y su copia

    const big = await attachments.presign(a.profile, { name: "b.pdf", size: 10 }, storage);
    const grown = fakeStorage({ objectSize: async () => 30 * 1024 * 1024 });
    await assert.rejects(attachments.complete(a.profile, big.id, grown), /20 MB/);
  });

  await t.test("adjuntos: lo validado no se puede sustituir con la URL de subida", async () => {
    const a = await person();
    const storage = fakeStorage();
    const up = await attachments.presign(a.profile, { name: "a.pdf", size: 10 }, storage);
    assert.match(up.url, /\/uploads\//);
    await attachments.complete(a.profile, up.id, storage);
    const row = await prisma.forumAttachment.findUnique({ where: { id: up.id } });
    assert.match(row.s3Key, /\/files\//);
    assert.equal(storage.calls.copied.to, row.s3Key);
    assert.match(storage.calls.copied.from, /\/uploads\//);
    assert.deepEqual(storage.calls.deleted, [storage.calls.copied.from]);
    assert.equal(up.url.includes(row.s3Key), false);
  });

  await t.test("adjuntos: solo se sirve lo escaneado y limpio de una publicación visible", async () => {
    const a = await person();
    const b = await person();
    const mod = await person({ role: "moderator" });
    const storage = fakeStorage();
    const up = await attachments.presign(a.profile, { name: "plano.pdf", size: 10 }, storage);
    await attachments.complete(a.profile, up.id, storage);

    await assert.rejects(attachments.publicUrl(up.id, storage), /NotFound/); // sin publicar
    await assert.rejects(attachments.previewUrl(b.profile, up.id, storage), /NotFound/); // ajeno
    const other = await call("POST", "/threads", { user: b.clerkId, body: thread({ attachmentIds: [up.id] }) });
    assert.equal(other.status, 400); // un adjunto ajeno no se puede publicar

    const number = await newThread(a.clerkId, { attachmentIds: [up.id] });
    assert.equal((await call("GET", `/threads/${number}`)).json.posts[0].attachments[0].available, false);
    const signedIn = { signedIn: true };
    await assert.rejects(attachments.publicUrl(up.id, storage, signedIn), /NotAvailable/); // escaneo pendiente

    const clean = fakeStorage({ getObjectTags: async () => ({ [attachments.SCAN_TAG]: "NO_THREATS_FOUND" }) });
    await assert.rejects(attachments.publicUrl(up.id, clean), /SignInRequired/); // sin sesión
    assert.equal((await call("GET", `/attachments/${up.id}`)).status, 401);
    assert.equal((await call("GET", `/attachments/${up.id}/download`)).status, 401);
    assert.match(await attachments.publicUrl(up.id, clean, signedIn), /s3\.test/);
    assert.equal(clean.calls.signed[0].inline, true);
    assert.equal(clean.calls.signed[0].contentType, "application/pdf");

    await call("POST", `/moderation/attachments/${up.id}/hide`, { user: mod.clerkId, body: {} });
    await assert.rejects(attachments.publicUrl(up.id, clean, signedIn), /NotFound/);
  });

  await t.test("adjuntos: las imágenes publicadas se ven sin sesión", async () => {
    const a = await person();
    const clean = fakeStorage({
      getObjectHead: async () => Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      getObjectTags: async () => ({ [attachments.SCAN_TAG]: "NO_THREATS_FOUND" }),
    });
    const normalize = async () => ({ data: Buffer.from("x"), width: 8, height: 6, size: 1 });
    const up = await attachments.presign(a.profile, { name: "x.png", size: 10 }, clean);
    await attachments.complete(a.profile, up.id, clean, normalize);
    await newThread(a.clerkId, { attachmentIds: [up.id] });
    assert.match(await attachments.publicUrl(up.id, clean), /s3\.test/);
  });

  await t.test("un autor no puede borrar un archivo ocultado por moderación", async () => {
    const a = await person();
    const mod = await person({ role: "moderator" });
    const storage = fakeStorage();
    const up = await attachments.presign(a.profile, { name: "x.pdf", size: 10 }, storage);
    await attachments.complete(a.profile, up.id, storage);
    const number = await newThread(a.clerkId, { attachmentIds: [up.id] });
    const postId = (await call("GET", `/threads/${number}`)).json.posts[0].id;
    await call("POST", `/moderation/attachments/${up.id}/hide`, { user: mod.clerkId, body: {} });
    assert.equal((await call("PATCH", `/posts/${postId}`, { user: a.clerkId, body: { body: doc("Sin adjunto") } })).status, 200);
    assert.equal((await prisma.forumAttachment.findUnique({ where: { id: up.id } })).postId, postId);
  });

  await t.test("título en una línea y números de hilo fuera de rango", async () => {
    const a = await person();
    const res = await call("POST", "/threads", { user: a.clerkId, body: thread({ title: "Título con\r\nBcc: x@y.com malicioso" }) });
    assert.equal(res.status, 400);
    assert.equal((await call("GET", "/threads/99999999999")).status, 404);
  });

  await t.test("adjuntos: una amenaza o un resultado dudoso queda bloqueado", async () => {
    assert.equal(attachments.scanResult("NO_THREATS_FOUND"), "clean");
    assert.equal(attachments.scanResult(undefined), "pending");
    for (const tag of ["THREATS_FOUND", "UNSUPPORTED", "ACCESS_DENIED", "FAILED"]) {
      assert.equal(attachments.scanResult(tag), "blocked");
    }
    const a = await person();
    const storage = fakeStorage();
    const up = await attachments.presign(a.profile, { name: "x.pdf", size: 10 }, storage);
    await attachments.complete(a.profile, up.id, storage);
    const number = await newThread(a.clerkId, { attachmentIds: [up.id] });
    const infected = fakeStorage({ getObjectTags: async () => ({ [attachments.SCAN_TAG]: "THREATS_FOUND" }) });
    await assert.rejects(attachments.publicUrl(up.id, infected, { signedIn: true }), /NotAvailable/);
    assert.equal((await call("GET", `/threads/${number}`)).json.posts[0].attachments.length, 0);
  });

  await t.test("adjuntos: imágenes del documento y subidas huérfanas", async () => {
    const a = await person();
    const storage = fakeStorage({ getObjectHead: async () => Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) });
    const normalize = async () => ({ data: Buffer.from("x"), width: 800, height: 600, size: 1 });
    const pdf = await attachments.presign(a.profile, { name: "x.pdf", size: 10 }, fakeStorage());
    await attachments.complete(a.profile, pdf.id, fakeStorage());
    const image = await attachments.presign(a.profile, { name: "x.png", size: 10 }, storage);
    const done = await attachments.complete(a.profile, image.id, storage, normalize);
    assert.equal(done.width, 800);

    const withImage = (attachmentId) => ({
      type: "doc",
      content: [{ type: "image", attrs: { attachmentId } }],
    });
    const asImage = await call("POST", "/threads", { user: a.clerkId, body: thread({ body: withImage(pdf.id) }) });
    assert.equal(asImage.status, 400); // un PDF no puede ir como imagen
    assert.equal((await call("POST", "/threads", { user: a.clerkId, body: thread({ body: withImage(image.id) }) })).status, 201);
    assert.equal((await prisma.forumAttachment.findUnique({ where: { id: image.id } })).postId !== null, true);

    await prisma.forumAttachment.update({ where: { id: pdf.id }, data: { createdAt: new Date(Date.now() - 2 * 86400000) } });
    const cleaner = fakeStorage();
    assert.equal(await attachments.cleanupOrphans(cleaner), 1);
    assert.equal(await prisma.forumAttachment.count({ where: { id: pdf.id } }), 0);
    assert.equal(await prisma.forumAttachment.count({ where: { id: image.id } }), 1);
  });

  await t.test("normalizeImage elimina metadatos y limita el tamaño", async () => {
    const sharp = require("sharp");
    const input = await sharp({ create: { width: 3000, height: 1000, channels: 3, background: "#ffffff" } })
      .withExif({ IFD0: { Copyright: "Cliente privado" } })
      .jpeg()
      .toBuffer();
    assert.ok((await sharp(input).metadata()).exif);
    const out = await attachments.normalizeImage(input);
    const meta = await sharp(out.data).metadata();
    assert.equal(meta.exif, undefined);
    assert.equal(meta.width, 2000);
  });
});
