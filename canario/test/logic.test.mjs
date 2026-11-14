import test from 'node:test'; import assert from 'node:assert/strict';
import { nextOpenDays, judge } from '../src/logic.js';
test('next open days skip Mon/Tue and skipped dates', () => {
  assert.deepEqual(nextOpenDays('2026-11-14', 5), ['2026-11-15', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21']);
  assert.deepEqual(nextOpenDays('2026-11-14', 2, ['2026-11-15']), ['2026-11-18', '2026-11-19']);
});
test('judge', () => {
  const ok = { tables: [{ date: 'd', party: 2, slots: 20 }], experiences: [{ name: 'x', days: { d: 3 } }], site: [{ url: 'u', ok: true }] };
  assert.equal(judge(ok).status, 'OK');
  assert.equal(judge({ ...ok, tables: [{ date: 'd', party: 2, slots: 0 }] }).status, 'FAIL');
  assert.equal(judge({ ...ok, tables: [{ date: 'd', party: 2, slots: 3 }] }).status, 'WARN');
  assert.equal(judge({ ...ok, tables: [{ date: 'd', party: 2, slots: null, error: 'e' }] }).status, 'BLIND');
  assert.equal(judge({ ...ok, experiences: [{ name: 'x', days: { a: 0, b: 0 } }] }).status, 'FAIL');
});
