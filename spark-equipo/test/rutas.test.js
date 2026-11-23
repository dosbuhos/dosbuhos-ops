import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The worker answers 404 to anything outside /api/admin/ at one point of its fetch handler. Every route for the team has to be
// handled before that line: once, two of them (marking a commitment done and asking for an event) sat after it and never ran.
test('team routes are handled before the admin-only guard', () => {
  const src = readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');
  const guard = src.indexOf("if (!p.startsWith('/api/admin/')) return json({ error: 'No existe' }, 404);");
  assert.ok(guard > 0, 'the guard is still in the worker');
  const rutas = [...src.matchAll(/p === '(\/api\/[a-z/]+)'|p\.startsWith\('(\/api\/[a-z/]+)'\) &&/g)].map((m) => ({ ruta: m[1] || m[2], en: m.index }));
  assert.ok(rutas.length > 15, 'routes found');
  for (const r of rutas) {
    if (r.ruta.startsWith('/api/admin/')) assert.ok(r.en > guard, `${r.ruta} is an admin route and must come after the guard`);
    else assert.ok(r.en < guard, `${r.ruta} is a team route and must come before the guard`);
  }
});

// The plan is shown to the team one commitment at a time. A switch for the whole plan (or for one person's part) existed once
// and was removed on purpose: nothing in the worker may flip `visible` on more than one commitment.
test('no route shows several plan commitments to the team at once', () => {
  const src = readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');
  const cambios = [...src.matchAll(/UPDATE compromisos SET visible = \?([^']*)'/g)].map((m) => m[1].trim());
  assert.ok(cambios.length >= 1, 'the one-at-a-time update is still there');
  for (const c of cambios) assert.equal(c, 'WHERE id = ?', 'visible is only ever set by id');
  const pantalla = readFileSync(new URL('../public/plan.js', import.meta.url), 'utf8');
  assert.ok(!/publicar: '(todos)'|publicar: g\b/.test(pantalla), 'the screen has no bulk control');
});

// Only Carlos (or the owner) applies the month's adjustment, only for a month that is over, and a real close is not redone.
test('the month-end close is guarded: who, which month, and never twice', () => {
  const src = readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');
  const i = src.indexOf("if (p === '/api/cierre'"), ruta = src.slice(i, src.indexOf('return json({ ok: true, ensayo', i));
  assert.match(ruta, /!yo\.dueno && yo\.persona !== APLICA_AJUSTE/);
  assert.match(ruta, /mes >= HOY\.slice\(0, 7\)/);
  assert.match(ruta, /ya && !ya\.ensayo/);
});
