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

// Questioned orders: out of sales until someone says they are a sale; Contabilidad's verdict overrides the team's note.
test('a questioned order counts only once it is called a sale', async () => {
  const { enDuda, estadoRev } = await import('../src/calc.js');
  const o = { estado: 'confirmed', total: 5000, fecha: '2026-10-14', cliente: 'Publico en general Mercado Libre', facturacion: 'invoiced' };
  assert.ok(enDuda(o, '2026-11-23'), 'no client on it');
  assert.equal(enDuda({ ...o, cliente: 'Restaurante X' }, '2026-11-23'), '', 'an invoiced order to a named client is fine');
  assert.ok(enDuda({ ...o, cliente: 'Restaurante X', facturacion: 'not_invoiced' }, '2026-11-23'), 'no invoice after two weeks');
  assert.equal(enDuda({ ...o, cliente: 'Restaurante X', facturacion: 'not_invoiced', fecha: '2026-11-15' }, '2026-11-23'), '', 'a recent order may still be invoiced');
  assert.equal(enDuda({ ...o, total: 0.5 }, '2026-11-23'), '', 'sample orders at cents never counted and are not listed');
  assert.equal(enDuda({ ...o, fecha: '2026-03-01' }, '2026-11-23'), '', 'before the review period');
  assert.deepEqual(estadoRev(null), { estado: 'pendiente', tipo: '', cuenta: false, cobrar: true });
  assert.equal(estadoRev({ tipo: 'venta', verificado: '' }).cuenta, true);
  assert.equal(estadoRev({ tipo: 'venta', verificado: '2026-11-24', veredicto: 'traspaso' }).cuenta, false);
  assert.equal(estadoRev({ tipo: 'muestra', verificado: '' }).cobrar, false);
});
test('only an admin verifies a questioned order, and only the owner reopens it', () => {
  const src = readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');
  const i = src.indexOf("p === '/api/admin/revision'"), blk = src.slice(i, i + 1200);
  assert.ok(i > src.indexOf("if (!yo.admin) return json({ error: 'Solo administradores' }, 403);"));
  assert.match(blk, /b\.reabrir\) \{ if \(!yo\.dueno\)/);
});

test('soloSuyo: a rep keeps only their own rows', async () => {
  const { soloSuyo } = await import('../src/calc.js');
  const m = soloSuyo({ contactos: [{ persona: 'Carlos' }, { persona: 'Daniel' }], ordenes: [{ vendedor: 'Daniel' }, { vendedor: 'José Luis' }],
    directorio: [{ clave: 'a', vendedor: 'Daniel' }, { clave: 'b', vendedor: 'Carlos' }, { clave: 'c', vendedor: '', prospecto: true }], cuentas: [{ clave: 'a' }, { clave: 'b' }],
    cobranza: { facturas: [{ vendedor: 'Daniel', cliente: 'A' }, { vendedor: 'Carlos', cliente: 'B' }], gestiones: [{ cliente: 'A' }, { cliente: 'B' }] },
    presupuesto: { anio: 2026, meses: { Carlos: [1], Daniel: [2] } }, eric: [{}], lunes: {}, estrategia: [{}], promociones: [{ avance: [{ vendedor: 'Daniel' }, { vendedor: 'Carlos' }] }] }, 'Daniel');
  assert.equal(m.contactos.length, 1); assert.equal(m.ordenes.length, 1); assert.deepEqual(m.directorio.map((d) => d.clave), ['a', 'c']);
  assert.deepEqual(m.cuentas.map((c) => c.clave), ['a']); assert.equal(m.cobranza.facturas.length, 1); assert.equal(m.cobranza.gestiones.length, 1);
  assert.deepEqual(Object.keys(m.presupuesto.meses), ['Daniel']); assert.equal(m.eric.length, 0); assert.equal(m.lunes, undefined); assert.equal(m.estrategia.length, 0);
  assert.equal(m.promociones[0].avance.length, 1);
});
