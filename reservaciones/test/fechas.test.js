import { test } from 'node:test';
import assert from 'node:assert/strict';
import { esFecha, fechaLocal, horaLocal, lunesDe, finDeMes, primeroDelMes, rango, sumarDias, diaSemana, diasEntre } from '../src/fechas.js';

test('local day and hour are San Miguel time (UTC-6 all year)', () => {
  assert.equal(fechaLocal(Date.parse('2026-11-23T05:59:00Z')), '2026-11-22');   // 23:59 the night before
  assert.equal(fechaLocal(Date.parse('2026-11-23T06:00:00Z')), '2026-11-23');
  assert.equal(horaLocal(Date.parse('2026-11-22T19:30:00Z')), '13:30');
  assert.equal(horaLocal(Date.parse('2026-07-04T19:30:00Z')), '13:30');         // no summer time
});

test('weeks run Monday to Sunday', () => {
  assert.equal(lunesDe('2026-11-23'), '2026-11-23');   // a Monday
  assert.equal(lunesDe('2026-11-29'), '2026-11-23');   // the Sunday of that week
  assert.equal(lunesDe('2026-11-22'), '2026-11-16');
  assert.equal(diaSemana('2026-11-22'), 0);
  assert.deepEqual(rango('2026-11-28', '2026-12-01'), ['2026-11-28', '2026-11-29', '2026-11-30', '2026-12-01']);
});

test('months, steps and what is not a date', () => {
  assert.equal(primeroDelMes('2026-11-23'), '2026-11-01');
  assert.equal(finDeMes('2026-11-23'), '2026-11-30');
  assert.equal(finDeMes('2028-02-10'), '2028-02-29');
  assert.equal(sumarDias('2026-12-31', 1), '2027-01-01');
  assert.equal(diasEntre('2026-11-01', '2026-11-23'), 22);
  for (const s of ['2026-13-01', '2026-02-30', '23/11/2026', '', null, '2026-11-23T00:00']) assert.equal(esFecha(s), false);
  assert.equal(esFecha('2026-11-23'), true);
});
