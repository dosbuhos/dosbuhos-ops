// The rules that decide when preventive work comes up and who a phone number belongs to. Run: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { addDaysYmd, addMonthsYmd, parseMonths, monthsOnOrAfter, advancePlan, everyText, perYear, phoneKey, mergePhone } from '../src/plan.js';

test('days and months roll over year ends and short months', () => {
  assert.equal(addDaysYmd('2026-12-31', 1), '2027-01-01');
  assert.equal(addDaysYmd('2026-03-01', -1), '2026-02-28');
  assert.equal(addMonthsYmd('2026-01-31', 1), '2026-02-28');   // day clamped to the month's last
  assert.equal(addMonthsYmd('2026-11-30', 3), '2027-02-28');
  assert.equal(addMonthsYmd('2028-01-31', 1), '2028-02-29');   // leap year
});

test('months list: sorted, unique, only 1 to 12', () => {
  assert.deepEqual(parseMonths('9,3,3,13,0,x'), [3, 9]);
  assert.deepEqual(parseMonths(''), []);
  assert.deepEqual(parseMonths(null), []);
});

test('"twice a year, March and September": next date on or after a day', () => {
  assert.equal(monthsOnOrAfter([3, 9], 1, '2026-11-22'), '2027-03-01');
  assert.equal(monthsOnOrAfter([3, 9], 1, '2026-03-01'), '2026-03-01');   // the day itself counts
  assert.equal(monthsOnOrAfter([3, 9], 1, '2026-03-02'), '2026-09-01');
  assert.equal(monthsOnOrAfter([2], 31, '2026-01-01'), '2026-02-28');     // day 31 in February
  assert.equal(monthsOnOrAfter([], 1, '2026-01-01'), null);
});

test('a plan moves to its next date', () => {
  const twice = { unit: 'months', months: '3,9', day: 1 };
  assert.equal(advancePlan(twice, '2027-03-01'), '2027-09-01');
  assert.equal(advancePlan(twice, '2027-09-01'), '2028-03-01');
  const monthly = { unit: 'months', months: '1,2,3,4,5,6,7,8,9,10,11,12', day: 31 };
  assert.equal(advancePlan(monthly, '2027-01-31'), '2027-02-28');
  assert.equal(advancePlan(monthly, '2027-02-28'), '2027-03-31');
  assert.equal(advancePlan({ unit: 'month', every_n: 3 }, '2026-10-30'), '2027-01-30');   // the plan already in production
  assert.equal(advancePlan({ unit: 'week', every_n: 2 }, '2026-11-22'), '2026-12-06');
  assert.equal(advancePlan({ unit: 'day', every_n: 10 }, '2026-12-25'), '2027-01-04');
  assert.equal(advancePlan({ unit: 'once' }, '2026-12-25'), null);                        // one-time plans end
});

test('a plan always moves forward', () => {
  for (const s of [{ unit: 'months', months: '2,6,10', day: 15 }, { unit: 'month', every_n: 1 }, { unit: 'week', every_n: 1 }, { unit: 'day', every_n: 1 }]) {
    let d = '2026-01-31';
    for (let i = 0; i < 40; i++) { const n = advancePlan(s, d); assert.ok(n > d, `${JSON.stringify(s)} ${d} → ${n}`); d = n; }
  }
});

test('how often, in words and in times a year', () => {
  assert.equal(everyText({ unit: 'months', months: '3,9' }), '2 veces al año (mar, sep)');
  assert.equal(everyText({ unit: 'months', months: '1' }), '1 vez al año (ene)');
  assert.equal(everyText({ unit: 'months', months: '1,2,3,4,5,6,7,8,9,10,11,12' }), 'cada mes');
  assert.equal(everyText({ unit: 'month', every_n: 3 }), 'cada 3 meses');
  assert.equal(everyText({ unit: 'week', every_n: 1 }), 'cada semana');
  assert.equal(everyText({ unit: 'once' }), 'una sola vez');
  assert.equal(perYear({ unit: 'months', months: '3,9' }), 2);
  assert.equal(perYear({ unit: 'month', every_n: 3 }), 4);
  assert.equal(perYear({ unit: 'week', every_n: 1 }), 52);
  assert.equal(perYear({ unit: 'once' }), 1);
});

test('a phone is the same person however it is typed', () => {
  assert.equal(phoneKey('415 123 4567'), '4151234567');
  assert.equal(phoneKey('+52 415 123 4567'), '4151234567');
  assert.equal(phoneKey('5214151234567'), '4151234567');      // old Mexican mobile prefix
  assert.equal(phoneKey('(512) 555-0100'), phoneKey('+1 512 555 0100'));
  assert.equal(phoneKey('12345'), null);                       // too short to be a number
  assert.equal(phoneKey(''), null);
});

test('retyping a number without its country code does not lose the code', () => {
  assert.equal(mergePhone('+1 512 555 0100', '512 555 0100'), '+1 512 555 0100');
  assert.equal(mergePhone('+1 512 555 0100', '(512) 555-0100'), '+1 512 555 0100');
  assert.equal(mergePhone('+1 512 555 0100', '415 555 0142'), '415 555 0142');           // a different number
  assert.equal(mergePhone('415 555 0142', '+52 415 555 0142'), '+52 415 555 0142');      // adding the code is fine
  assert.equal(mergePhone(null, '415 555 0142'), '415 555 0142');
});
