const { test } = require("node:test");
const assert = require("node:assert/strict");
const { progressThrottle } = require("./progressThrottle");

// node --test src/lib/progressThrottle.test.js

test("escribe el primero de cada fase, el último, y como mucho uno por segundo", () => {
  let t = 0;
  const should = progressThrottle(1000, () => t);
  const ev = (step, current, total) => ({ step, current, total });

  assert.equal(should(ev("loading", 1, 4)), true, "primer evento");
  t = 200;
  assert.equal(should(ev("loading", 2, 4)), false, "misma fase, antes de 1 s");
  t = 300;
  assert.equal(should(ev("checking", 1, 260)), true, "cambio de fase");
  t = 900;
  assert.equal(should(ev("checking", 40, 260)), false);
  t = 1300;
  assert.equal(should(ev("checking", 90, 260)), true, "pasó 1 s");
  t = 1400;
  assert.equal(should(ev("checking", 260, 260)), true, "el último siempre");
  t = 1450;
  assert.equal(should(ev("saving")), true, "nueva fase");
});
