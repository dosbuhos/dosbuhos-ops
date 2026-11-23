// Who gets what: nothing without the Hub, the manifest for everyone the Hub lets in, sales for editors and admins.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { olvidar } from '../src/manifiesto.js';
import { olvidar as olvidarVentas } from '../src/ventas.js';
import { growth, propia, reserva, huesped } from './d1.js';

beforeEach(() => { olvidar(); olvidarVentas(); });
const ctx = () => { const p = []; return { p, waitUntil: (x) => p.push(x) }; };
function entorno(extra = {}) {
  const G = growth(), P = propia();
  return { G, P, env: { GROWTH: G.d1, DB: P.d1, ASSETS: { fetch: async () => new Response('página') }, ENVIRONMENT: 'dev', DEV_USER: 'Persona@Example.com', DEV_ROLE: 'viewer', ...extra } };
}
const pedir = (env, ruta, init, c = ctx()) => worker.fetch(new Request(`https://reservaciones.example${ruta}`, init), env, c);

test('without the Hub signature the API answers nothing, and the page itself carries no data', async () => {
  const { env } = entorno({ ENVIRONMENT: 'production', DEV_USER: 'x@example.com' });           // dev settings are ignored outside dev
  const r = await pedir(env, '/api/semana');
  assert.equal(r.status, 401); assert.match((await r.json()).error, /Hub/);
  assert.equal(await (await pedir(env, '/')).text(), 'página');
  const firmado = await pedir({ ...env, HUB_SECRET: 'secreto' }, '/api/semana', { headers: { 'X-DB-User': btoa(JSON.stringify({ email: 'a@example.com', role: 'admin' })) } });
  assert.equal(firmado.status, 401);                                                           // a header without the Hub's signature is not an identity
});

test('a host sees the manifest with guests and no sales; an editor sees sales; only admins start a read', async () => {
  const { G, P, env } = entorno();
  const id = reserva(G.db, { fecha: '2026-11-21' }); huesped(P.db, id);
  const r = await pedir(env, '/api/semana?d=2026-11-19');
  assert.equal(r.status, 200); assert.equal(r.headers.get('cache-control'), 'no-store');
  const s = await r.json();
  assert.equal(s.desde, '2026-11-16'); assert.equal(s.yo.ventas, false); assert.equal(s.dias[5].reservas[0].huesped.nombre, 'Persona Inventada'); assert.equal('ventas' in s.dias[5], false); assert.equal('syncCorrio' in s, false);
  assert.equal((await pedir(env, '/api/ventas')).status, 403);
  assert.equal((await pedir(env, '/api/sincronizar', { method: 'POST' })).status, 403);
  const editor = { ...env, DEV_ROLE: 'editor' };
  const v = await pedir(editor, '/api/ventas?p=mes&d=2026-11-10');
  assert.equal(v.status, 200); assert.equal((await v.json()).desde, '2026-11-01');
  assert.equal((await (await pedir(editor, '/api/semana')).json()).yo.ventas, true);
  assert.equal((await pedir(editor, '/api/sincronizar', { method: 'POST' })).status, 403);
  const admin = await pedir({ ...env, DEV_ROLE: 'admin' }, '/api/sincronizar', { method: 'POST' });
  assert.equal(admin.status, 200); assert.match((await admin.json()).error, /GUESTS/);          // no binding in this test: said in plain words
  assert.equal((await (await pedir({ ...env, ADMIN_EMAILS: 'otra@example.com, persona@example.com' }, '/api/semana')).json()).yo.admin, true);
});

test('bad input is refused, and a reservation without its guest asks for a fresh read at most every few minutes', async () => {
  const { G, P, env } = entorno();
  for (const ruta of ['/api/semana?d=2026-02-30', '/api/ventas?d=ayer', '/api/semana?d=']) assert.equal((await pedir({ ...env, DEV_ROLE: 'admin' }, ruta)).status, 400);
  assert.equal((await pedir({ ...env, DEV_ROLE: 'admin' }, '/api/ventas?p=anio')).status, 400);
  assert.equal((await pedir(env, '/api/otra')).status, 404);
  const hoy = new Date(Date.now() - 6 * 3_600_000).toISOString().slice(0, 10);
  reserva(G.db, { fecha: hoy, estado: 'created' });
  const c1 = ctx(); await pedir(env, '/api/semana', undefined, c1); await Promise.all(c1.p);
  assert.equal(c1.p.length, 1);
  assert.notEqual(P.db.prepare('SELECT last_run_at FROM sync_status').get().last_run_at, null);
  const c2 = ctx(); await pedir(env, '/api/semana', undefined, c2);
  assert.equal(c2.p.length, 0);                                                                 // it just ran: wait
});
