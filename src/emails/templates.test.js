const { test } = require("node:test");
const assert = require("node:assert/strict");
const t = require("./templates");

// node --test src/emails/templates.test.js

const APP = "https://app.structunex.com";

test("bienvenida en español e inglés, con los límites del plan Free", () => {
  const es = t.welcomeEmail({ firstName: "Ana", lang: "es", appUrl: APP });
  assert.equal(es.subject, "Bienvenido a Structunex");
  assert.match(es.html, /<html lang="es">/);
  assert.match(es.text, /Hola, Ana:/);
  assert.match(es.text, /500 barras y áreas, 3 proyectos y 50 créditos/);
  assert.match(es.text, /https:\/\/app\.structunex\.com\/projects/);

  const en = t.welcomeEmail({ firstName: "Ana", lang: "en", appUrl: APP });
  assert.equal(en.subject, "Welcome to Structunex");
  assert.match(en.text, /Hi Ana,/);
});

test("idioma desconocido o ausente: español", () => {
  assert.equal(t.welcomeEmail({ lang: "fr", appUrl: APP }).subject, "Bienvenido a Structunex");
  assert.match(t.welcomeEmail({ appUrl: APP }).text, /^Te damos la bienvenida/);
  assert.match(t.welcomeEmail({ appUrl: APP }).text, /Hola:/);
});

test("el nombre del usuario se escapa en el HTML", () => {
  const e = t.welcomeEmail({ firstName: '<img src=x onerror="a">', lang: "es", appUrl: APP });
  assert.doesNotMatch(e.html, /<img src=x/);
  assert.match(e.html, /&lt;img src=x onerror=&quot;a&quot;&gt;/);
});

test("plan activado: Student y Principal, con el recibo aparte de Stripe", () => {
  const s = t.planActivatedEmail({ firstName: "Luis", lang: "es", plan: "student", appUrl: APP });
  assert.equal(s.subject, "Tu plan Student está activo");
  assert.match(s.text, /5000 barras y áreas|5\.000 barras y áreas/);
  assert.match(s.text, /300 créditos de IA/);
  assert.match(s.text, /Stripe \(Link\)/);

  const p = t.planActivatedEmail({ firstName: "Luis", lang: "en", plan: "principal", appUrl: APP });
  assert.equal(p.subject, "Your Principal plan is active");
  assert.match(p.text, /no practical limit/);
  assert.match(p.text, /1,500 AI credits/);
});

test("no hay correo de plan activado para Free", () => {
  assert.throws(() => t.planActivatedEmail({ lang: "es", plan: "free", appUrl: APP }), /free/);
});

test("escapeHtml", () => {
  assert.equal(t.escapeHtml(`a&b<c>"d"'e'`), "a&amp;b&lt;c&gt;&quot;d&quot;&#39;e&#39;");
  assert.equal(t.escapeHtml(null), "");
});

test("bienvenida: enlaces a docs, guías, aprender, comunidad y YouTube en el idioma del usuario", () => {
  const es = t.welcomeEmail({ lang: "es", appUrl: APP, siteUrl: "https://structunex.com" }).text;
  for (const url of [
    "https://structunex.com/es/docs",
    "https://structunex.com/es/guides",
    "https://structunex.com/es/learn",
    "https://structunex.com/community/es",
    "https://www.youtube.com/@Structunex",
  ]) {
    assert.ok(es.includes(url), url);
  }
  const en = t.welcomeEmail({ lang: "en", appUrl: APP, siteUrl: "https://structunex.com" }).text;
  for (const url of ["https://structunex.com/docs", "https://structunex.com/guides", "https://structunex.com/community"]) {
    assert.ok(en.includes(url), url);
  }
  assert.ok(!en.includes("/es/"));
});
