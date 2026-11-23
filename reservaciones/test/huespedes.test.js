// Guests read from Klaviyo through the growth Worker: what is stored, how the read resumes, and what is deleted.
// Every person here is made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sincronizar, estadoSync, METRICAS, RETENCION_DIAS } from '../src/huespedes.js';
import { propia, ms } from './d1.js';

const AHORA = ms('2026-11-23', '14:00');
const g = (id, at, o = {}) => ({ confirmationId: String(id), eventAt: Date.parse(at), scheduledAt: ms('2026-11-28', '13:00'), firstName: 'Ana', lastName: 'Prueba', email: 'ana@example.com', phone: '+52 415 555 0101', ...o });

/** A stand-in for the KlaviyoGuests entrypoint: per metric, guests sorted by event time, in pages of `size`. */
function growth(porMetrica, size = 2) {
  const llamadas = [];
  return {
    llamadas,
    async page({ metric, since, cursor }) {
      llamadas.push({ metric, since, cursor });
      if (!(metric in porMetrica)) return { ready: false, guests: [], events: 0, newest: null, cursor: null };
      const todos = porMetrica[metric].filter((x) => !since || x.eventAt >= Date.parse(since)).sort((a, b) => a.eventAt - b.eventAt);
      const desde = Number(cursor || 0), pagina = todos.slice(desde, desde + size);
      return { ready: true, guests: pagina, events: pagina.length, newest: pagina.length ? new Date(pagina[pagina.length - 1].eventAt).toISOString() : null, cursor: desde + size < todos.length ? String(desde + size) : null };
    },
  };
}

test('reads every metric to the end, keeps the newest details per reservation, and remembers where it stopped', async () => {
  const { db, d1 } = propia();
  const G = growth({
    'Created Reservation': [g(1, '2026-11-20T15:00:00Z'), g(2, '2026-11-21T15:00:00Z', { firstName: 'Luis', lastName: '', email: '', phone: '+52 55 5555 0102' }), g(3, '2026-11-22T15:00:00Z', { firstName: 'Eva' })],
    'Completed Reservation': [g(1, '2026-11-22T21:00:00Z', { phone: '', email: 'ana.nueva@example.com', scheduledAt: ms('2026-11-22', '13:00') })],
  });
  const r = await sincronizar({ DB: d1, GUESTS: G }, AHORA);
  assert.deepEqual(r, { ok: true, error: '', eventos: 4, guardados: 4, borrados: 0 });
  assert.deepEqual(db.prepare('SELECT confirmation_id AS id, first_name, last_name, email, phone, service_date FROM guests ORDER BY confirmation_id').all().map((x) => ({ ...x })), [
    { id: '1', first_name: 'Ana', last_name: 'Prueba', email: 'ana.nueva@example.com', phone: '+52 415 555 0101', service_date: '2026-11-22' },   // newer email and day; the phone it did not carry is kept
    { id: '2', first_name: 'Luis', last_name: '', email: '', phone: '+52 55 5555 0102', service_date: '2026-11-28' },
    { id: '3', first_name: 'Eva', last_name: 'Prueba', email: 'ana@example.com', phone: '+52 415 555 0101', service_date: '2026-11-28' },
  ]);
  assert.deepEqual({ ...db.prepare("SELECT cursor, done FROM guest_sync WHERE metric = 'Created Reservation'").get() }, { cursor: '2026-11-22T15:00:00.000Z', done: 1 });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM guest_sync').get().n, 2);            // the metrics Klaviyo does not have yet leave no mark
  assert.deepEqual(G.llamadas.map((c) => c.metric).filter((m, i, a) => a.indexOf(m) === i), METRICAS);
  const s = await estadoSync(d1); assert.equal(s.bien, AHORA); assert.equal(s.error, '');
});

test('resumes a long history where it stopped, then re-reads the last two days each run', async () => {
  const { db, d1 } = propia();
  const muchos = Array.from({ length: 7 }, (_, i) => g(100 + i, `2026-11-${String(10 + i).padStart(2, '0')}T15:00:00Z`));
  const G = growth({ 'Created Reservation': muchos });
  await sincronizar({ DB: d1, GUESTS: G }, AHORA, { maxPaginas: 2 });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM guests').get().n, 4);
  assert.deepEqual({ ...db.prepare("SELECT cursor, done FROM guest_sync WHERE metric = 'Created Reservation'").get() }, { cursor: '2026-11-13T15:00:00.000Z', done: 0 });
  await sincronizar({ DB: d1, GUESTS: G }, AHORA + 60_000, { maxPaginas: 8 });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM guests').get().n, 7);
  assert.equal(db.prepare("SELECT done FROM guest_sync WHERE metric = 'Created Reservation'").get().done, 1);
  G.llamadas.length = 0;
  await sincronizar({ DB: d1, GUESTS: G }, AHORA + 120_000);
  assert.equal(G.llamadas[0].since, '2026-11-14T15:00:00.000Z');                           // the cursor (16 Nov) minus two days
});

test(`never stores a visit older than ${RETENCION_DIAS} days and deletes the ones that age out`, async () => {
  const { db, d1 } = propia();
  db.prepare("INSERT INTO guests (confirmation_id, first_name, service_date, event_at, updated_at) VALUES ('viejo', 'Persona', '2026-08-01', 1, 1), ('reciente', 'Persona', '2026-09-01', 1, 1)").run();
  const G = growth({ 'Completed Reservation': [g(5, '2026-08-10T21:00:00Z', { scheduledAt: ms('2026-08-10', '13:00') }), g(6, '2026-11-21T21:00:00Z', { scheduledAt: null })] });
  const r = await sincronizar({ DB: d1, GUESTS: G }, AHORA);
  assert.equal(r.guardados, 1); assert.equal(r.borrados, 1);
  assert.deepEqual(db.prepare('SELECT confirmation_id AS id, service_date FROM guests ORDER BY id').all().map((x) => ({ ...x })), [{ id: '6', service_date: '2026-11-21' }, { id: 'reciente', service_date: '2026-09-01' }]);
});

test('drops what is not a guest, and a failure is recorded in plain words without stopping the clean-up', async () => {
  const { db, d1 } = propia();
  const raros = { ready: true, events: 4, newest: '2026-11-22T15:00:00.000Z', cursor: null, guests: [{ confirmationId: 'no es un id!', eventAt: 1 }, { confirmationId: '9', eventAt: 'x' }, { confirmationId: '10', eventAt: Date.parse('2026-11-22T15:00:00Z'), firstName: '', lastName: '', email: '', phone: '' }, null] };
  assert.equal((await sincronizar({ DB: d1, GUESTS: { page: async () => raros } }, AHORA)).guardados, 0);
  const falla = await sincronizar({ DB: d1, GUESTS: { page: async () => { throw new Error('Klaviyo 403: You do not have permission to read profiles.'); } } }, AHORA + 1000);
  assert.equal(falla.ok, false); assert.match(falla.error, /Klaviyo 403/);
  const s = await estadoSync(d1); assert.equal(s.bien, AHORA); assert.equal(s.corrio, AHORA + 1000); assert.match(s.error, /403/);
  assert.match((await sincronizar({ DB: d1 }, AHORA + 2000)).error, /GUESTS/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM guests').get().n, 0);
});
