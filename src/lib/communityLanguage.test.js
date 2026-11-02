const test = require("node:test");
const assert = require("node:assert/strict");
const { detectLocale } = require("./communityLanguage");

test("detecta el idioma aunque la página esté en otro", () => {
  assert.equal(detectLocale("How should I check the bolts of a shear tab with AISC 360-22?", "es"), "en");
  assert.equal(detectLocale("¿Cómo reviso los pernos de una conexión con la norma AISC 360-22?", "en"), "es");
  assert.equal(detectLocale("Busco el valor de la carga en una viga de acero", "en"), "es");
});

test("sin señales claras usa el idioma de la página", () => {
  assert.equal(detectLocale("AISC 360-22 LRFD W14x90", "es"), "es");
  assert.equal(detectLocale("AISC 360-22 LRFD W14x90", "en"), "en");
  assert.equal(detectLocale("", "en"), "en");
});
