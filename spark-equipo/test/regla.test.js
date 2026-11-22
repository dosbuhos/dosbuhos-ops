import test from 'node:test';
import assert from 'node:assert/strict';
import { dHab, regla48de } from '../public/regla.js';
import { syncSheet } from '../src/sheets.js';

const DESDE = '2026-11-21';
const c = (persona, fecha, registrado = '') => ({ persona, fecha, registrado });

test('working days skip Saturdays and Sundays', () => {
  assert.equal(dHab('2026-11-20', '2026-11-20'), 0);
  assert.equal(dHab('2026-11-20', '2026-11-23'), 1);   // Friday to Monday
  assert.equal(dHab('2026-11-19', '2026-11-23'), 2);   // Thursday to Monday
  assert.equal(dHab('2026-11-21', '2026-11-23'), 1);   // Saturday to Monday
  assert.equal(dHab('2026-10-28', '2026-11-22'), 17);
});

// What happened on 22 November 2026: the sync dated every old sheet row as seen that morning, and the screen read
// "last log: today, up to date" for three people whose last contact was weeks old.
test('old contacts dated today by the sync do not make the log current', () => {
  const L = [c('José Luis', '2026-10-28', '2026-11-22'), c('José Luis', '2026-10-27', '2026-11-22'), c('Daniel', '2026-11-06', '2026-11-22')];
  const jl = regla48de(L, 'José Luis', '2026-11-22', DESDE), d = regla48de(L, 'Daniel', '2026-11-22', DESDE);
  assert.equal(jl.sin, 17); assert.equal(jl.cumple, false); assert.equal(jl.n, 0);
  assert.equal(d.sin, 10); assert.equal(d.cumple, false);
});

test('the log is current when the last contact is at most two working days old and nothing was logged late', () => {
  const hoy = '2026-11-24';   // a Tuesday
  assert.deepEqual(regla48de([c('Carlos', '2026-11-23', '2026-11-24')], 'Carlos', hoy, DESDE), { n: 1, tarde: 0, sin: 1, cumple: true });
  // logged four working days after it happened: late, even though the log looks recent
  assert.deepEqual(regla48de([c('Carlos', '2026-11-23', '2026-11-27')], 'Carlos', '2026-11-27', DESDE), { n: 1, tarde: 1, sin: 4, cumple: false });
  // a contact with no logged-on date counts neither as on time nor as late
  assert.equal(regla48de([c('Carlos', '2026-11-23', '')], 'Carlos', hoy, DESDE).n, 0);
  // contacts from before the rule started are not judged for lateness
  assert.equal(regla48de([c('Carlos', '2026-11-20', '2026-11-27')], 'Carlos', '2026-11-27', DESDE).tarde, 0);
  // a row dated in the future is ignored when looking for the last contact
  assert.equal(regla48de([c('Carlos', '2026-12-05'), c('Carlos', '2026-11-18')], 'Carlos', hoy, DESDE).sin, 4);
  assert.equal(regla48de([], 'Carlos', hoy, DESDE).sin, null);
});

// A stand-in for D1 that understands the statements the sheet sync runs.
function fakeDB() {
  const vistos = new Map(); let activity = [];
  const run = (s) => {
    if (s.sql.startsWith('INSERT OR IGNORE INTO vistos')) { if (!vistos.has(s.args[0])) vistos.set(s.args[0], s.args[1]); }
    else if (s.sql.startsWith('DELETE FROM activity')) activity = [];
    else if (s.sql.startsWith('INSERT INTO activity')) activity.push({ persona: s.args[0], fecha: s.args[1], cuenta: s.args[3], registrado: vistos.get(s.args.at(-1)) ?? '' });
  };
  return { vistos, get activity() { return activity; },
    prepare: (sql) => ({ sql, args: [], bind(...args) { return { sql, args }; }, first: async () => (sql.includes('FROM vistos') && vistos.size ? { x: 1 } : null) }),
    batch: async (L) => { L.forEach(run); } };
}
const hoja = (...filas) => [['Fecha', 'Zona', 'Cuenta'], ...filas];

test('the first sync leaves the rows already in the sheet without a logged-on date; later syncs date only what is new', async () => {
  const DB = fakeDB(); let jl = hoja(['2026-10-27', 'SMA', 'Florios'], ['2026-10-28', 'SMA', 'Malanquín']);
  const env = { DB, TZ: 'America/Mexico_City', CRM_SHEET_ID: 'x', SHEETS: { values: async (_id, ranges) => (ranges.length === 3 ? [jl, hoja(), hoja()] : [[]]) } };
  assert.equal((await syncSheet(env)).rows, 2);
  assert.deepEqual(DB.activity.map((r) => r.registrado), ['', ''], 'the backlog carries no date');
  jl = hoja(['2026-10-27', 'SMA', 'Florios'], ['2026-10-28', 'SMA', 'Malanquín'], ['2026-11-23', 'SMA', 'Numu']);
  assert.equal((await syncSheet(env)).rows, 3);
  const r = Object.fromEntries(DB.activity.map((x) => [x.cuenta, x.registrado]));
  assert.equal(r.Florios, ''); assert.equal(r['Malanquín'], '');
  assert.match(r.Numu, /^\d{4}-\d{2}-\d{2}$/, 'the new row is dated the day the sync first saw it');
});
