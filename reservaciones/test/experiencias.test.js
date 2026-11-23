import { test } from 'node:test';
import assert from 'node:assert/strict';
import { casar, preciosPorPersona, personasEstimadas, nombreExperiencia } from '../src/experiencias.js';

const PRECIOS = new Map([['796500', 70000], ['842882', 45000]]);
const r = (id, hora, personas, estado = 'completed') => ({ id, hora, personas, estado });
const c = (id, hora, monto, experiencia = '796500') => ({ id, hora, monto, experiencia });

test('the usual price per person is the median of past one-to-one hours, and needs two sightings', () => {
  const p = preciosPorPersona([
    { experiencia: '796500', monto: 140000, personas: 2 }, { experiencia: '796500', monto: 280000, personas: 4 }, { experiencia: '796500', monto: 100000, personas: 2 },
    { experiencia: '793495', monto: 390000, personas: 2 },                      // seen once: not a price yet
    { experiencia: '842882', monto: 90000, personas: 2 }, { experiencia: '842882', monto: 135000, personas: 3 }, { experiencia: '', monto: 5, personas: 1 }, { experiencia: '842882', monto: 0, personas: 0 },
  ]);
  assert.deepEqual([...p], [['796500', 70000], ['842882', 45000]]);
});

test('a prepayment covers a whole number of people at the usual price, give or take a service charge', () => {
  assert.equal(personasEstimadas(c('a', '13:00', 140000), PRECIOS), 2);
  assert.equal(personasEstimadas(c('a', '13:00', 237400, '842882'), PRECIOS), 5);    // 5 × 450 plus a little
  assert.equal(personasEstimadas(c('a', '13:00', 120000), PRECIOS), null);           // neither one nor two people
  assert.equal(personasEstimadas(c('a', '13:00', 390000, '793495'), PRECIOS), null); // no known price
});

test('one reservation at the hour takes its prepayments; a cancelled one does not count', () => {
  const { porReserva, sueltos } = casar([r('1', '13:00', 2), r('2', '13:00', 4, 'cancelled'), r('3', '14:00', 2)], [c('a', '13:00', 99999), c('b', '13:00', 5000)], PRECIOS);
  assert.deepEqual([...porReserva], [['1', { cargos: 2, monto: 104999, experiencia: '796500', seguridad: 'unica' }]]);
  assert.deepEqual(sueltos, []);
});

test('with several reservations at the hour, party size decides; what fits nobody stays on the hour', () => {
  const reservas = [r('1', '13:00', 2), r('2', '13:00', 4), r('3', '13:00', 2), r('4', '13:00', 3)];
  const { porReserva, sueltos } = casar(reservas, [c('a', '13:00', 140000), c('b', '13:00', 280000), c('c', '13:00', 120000), c('d', '13:00', 135000, '842882')], PRECIOS);
  assert.equal(porReserva.get('2').seguridad, 'personas'); assert.equal(porReserva.get('2').monto, 280000);
  assert.equal(porReserva.get('1').monto, 140000);                                    // the first party of two
  assert.equal(porReserva.get('4').experiencia, '842882');                            // three people at 450
  assert.equal(porReserva.has('3'), false);
  assert.deepEqual(sueltos, [{ id: 'c', hora: '13:00', monto: 120000, experiencia: '796500', personas: null, motivo: 'varias' }]);
});

test('a prepayment with no reservation in the feed is listed on its own, with the people it seems to cover', () => {
  const { porReserva, sueltos } = casar([r('1', '13:00', 2)], [c('a', '12:00', 140000), c('b', '11:00', 390000, '793495'), c('z', '11:00', 0)], PRECIOS);
  assert.equal(porReserva.size, 0);
  assert.deepEqual(sueltos.map((s) => [s.hora, s.personas, s.motivo]), [['11:00', null, 'sin_reserva'], ['12:00', 2, 'sin_reserva']]);
  assert.equal(nombreExperiencia('796500'), 'Visita guiada + degustación'); assert.equal(nombreExperiencia('1'), 'Experiencia');
});
