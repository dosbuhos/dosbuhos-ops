import test from 'node:test';
import assert from 'node:assert/strict';
import { addMonths, occurrences, nearestK, slotFor, parseBottles, membershipYear, localDate, weekdayMon0 } from '../src/schedule.js';

const quarterly = { bottles: 6, cadence_months: 3, allocation_mode: 'sequence' };
const monthly = { bottles: 12, cadence_months: 1, allocation_mode: 'sequence' };
const sub = (o = {}) => ({ id: 1, start_date: '2026-01-15', anchor_override: null, seq_offset: 0, ended_on: null, cancel_at: null, status: 'active', ...o });

test('calendar-month arithmetic clamps to month end without drifting', () => {
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonths('2026-01-31', 2), '2026-03-31');
  assert.equal(addMonths('2028-01-31', 1), '2028-02-29');
  assert.equal(addMonths('2026-11-30', 3), '2027-02-28');
  assert.equal(addMonths('2026-12-15', 1), '2027-01-15');
});

test('quarterly schedule from Jan 15', () => {
  const occ = occurrences(sub(), quarterly, { to: '2027-04-30', today: '2026-10-14' });
  assert.deepEqual(occ.map(o => o.due), ['2026-01-15', '2026-04-15', '2026-07-15', '2026-10-15', '2027-01-15', '2027-04-15']);
  assert.deepEqual(occ.map(o => o.n), [1, 2, 3, 4, 5, 6]);
});

test('missing fulfillment = overdue; due today = today; future = upcoming', () => {
  const f = new Map([[1, { status: 'handed' }], [2, { status: 'shipped' }]]);
  const occ = occurrences(sub(), quarterly, { to: '2026-12-31', today: '2026-10-15', fulfillments: f });
  assert.deepEqual(occ.map(o => o.state), ['done', 'done', 'overdue', 'today']);
});

test('the Vanessa case: monthly Diamante, September never fulfilled stays overdue', () => {
  const f = new Map([[1, { status: 'handed' }], [2, { status: 'shipped' }], [3, { status: 'shipped' }]]);
  const occ = occurrences(sub({ start_date: '2026-06-15' }), monthly, { to: '2026-11-30', today: '2026-10-14', fulfillments: f });
  const sep = occ.find(o => o.due === '2026-09-15');
  assert.equal(sep.n, 4);
  assert.equal(sep.state, 'overdue');
  assert.equal(occ.find(o => o.due === '2026-10-15').state, 'upcoming');
});

test('delay is an override: not overdue until the new date passes', () => {
  const f = new Map([[4, { status: null, delayed_until: '2026-11-20' }]]);
  const opts = { to: '2026-12-31', fulfillments: f, trackingStart: '2026-10-01' };
  let o = occurrences(sub(), quarterly, { ...opts, today: '2026-10-20' }).find(x => x.k === 4);
  assert.equal(o.state, 'upcoming'); assert.equal(o.delayed, true); assert.equal(o.due, '2026-10-15'); assert.equal(o.eff, '2026-11-20');
  o = occurrences(sub(), quarterly, { ...opts, today: '2026-11-21' }).find(x => x.k === 4);
  assert.equal(o.state, 'overdue');
});

test('cancelled subscription: nothing owed after it ended, earlier misses still overdue', () => {
  const occ = occurrences(sub({ status: 'canceled', ended_on: '2026-08-01' }), quarterly, { to: '2027-12-31', today: '2026-10-14' });
  assert.deepEqual(occ.map(o => o.due), ['2026-01-15', '2026-04-15', '2026-07-15']);
  assert.ok(occ.every(o => o.state === 'overdue'));
});

test('incomplete first payment owes nothing', () => {
  assert.equal(occurrences(sub({ status: 'incomplete_expired' }), quarterly, { to: '2027-12-31', today: '2026-10-14' }).length, 0);
});

test('pause window and tracking start', () => {
  const occ = occurrences(sub(), quarterly, { to: '2026-12-31', today: '2026-10-14', trackingStart: '2026-03-01', pauses: [{ from_date: '2026-07-01', until_date: '2026-10-01' }] });
  assert.deepEqual(occ.map(o => o.state), ['pretracking', 'overdue', 'paused', 'upcoming']);
});

test('sequence offset renumbers shipments and moves the case slot', () => {
  const occ = occurrences(sub({ seq_offset: 2 }), quarterly, { to: '2026-04-30', today: '2026-10-14' });
  assert.deepEqual(occ.map(o => [o.n, o.slot]), [[3, 3], [4, 4]]);
  assert.equal(slotFor(quarterly, 5, '2027-01-15'), 1);
  assert.equal(slotFor({ ...monthly, allocation_mode: 'month' }, 1, '2026-09-15'), 9);
});

test('allocation: snapshot beats case; missing case is flagged only while open', () => {
  const cases = { 1: [{ wine: 'Pet Nat', qty: 6 }] };
  const f = new Map([[2, { status: 'shipped', bottles_json: JSON.stringify([{ wine: 'Roble', qty: 6 }]) }]]);
  const occ = occurrences(sub(), quarterly, { to: '2026-07-31', today: '2026-10-14', fulfillments: f, caseFor: (c, s) => cases[s] || null });
  assert.equal(occ[0].bottlesSource, 'case'); assert.equal(occ[0].bottlesTotal, 6);
  assert.equal(occ[1].bottlesSource, 'snapshot'); assert.equal(occ[1].bottles[0].wine, 'Roble');
  assert.equal(occ[2].missingAllocation, true);
});

test('invoice dates map to the nearest shipment', () => {
  assert.equal(nearestK('2026-01-15', 3, '2026-04-15'), 2);
  assert.equal(nearestK('2026-01-15', 3, '2026-04-27'), 2);
  assert.equal(nearestK('2026-06-15', 1, '2026-09-14'), 4);
  assert.equal(nearestK('2026-06-15', 1, '2026-06-15'), 1);
});

test('bottle text parsing', () => {
  assert.deepEqual(parseBottles('2 Tempranillo GR\n1 x Pet Nat\nRoble\n\n1 pet nat'), [
    { wine: 'Tempranillo GR', qty: 2 }, { wine: 'Pet Nat', qty: 2 }, { wine: 'Roble', qty: 1 }]);
  assert.deepEqual(parseBottles('1524 Mosaico Tinto'), [{ wine: '1524 Mosaico Tinto', qty: 1 }]);
  assert.deepEqual(parseBottles('2 1524 Mosaico Tinto'), [{ wine: '1524 Mosaico Tinto', qty: 2 }]);
});

test('membership year and local dates', () => {
  assert.deepEqual(membershipYear('2026-02-12', '2026-10-14'), { start: '2026-02-12', end: '2027-02-11' });
  assert.deepEqual(membershipYear('2025-02-12', '2026-10-14'), { start: '2026-02-12', end: '2027-02-11' });
  // 2026-10-15 03:00 UTC is still Oct 14 in Mexico City
  assert.equal(localDate(Date.UTC(2026, 9, 15, 3) / 1000, 'America/Mexico_City'), '2026-10-14');
  assert.equal(weekdayMon0('2026-10-14'), 2);
});
