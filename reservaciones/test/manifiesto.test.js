// The week's manifest: reservations with their guests, prepaid experiences as an estimate, the day's sales beside them.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { semana, olvidar, FEED_DESDE } from '../src/manifiesto.js';
import { olvidar as olvidarVentas } from '../src/ventas.js';
import { growth, propia, ms, reserva, cargo, cuenta, huesped } from './d1.js';

const HOY = '2026-11-26', AHORA = ms(HOY, '10:00'), LUNES = '2026-11-23';
beforeEach(() => { olvidar(); olvidarVentas(); });

function datos() {
  const G = growth(), P = propia();
  // Saturdays and Sundays have had sales for weeks: those weekdays count as open.
  for (const f of ['2026-10-31', '2026-11-07', '2026-11-14', '2026-11-21', '2026-11-01', '2026-11-08', '2026-11-15', '2026-11-22']) cuenta(G.db, { fecha: f });
  // Past hours where one reservation met one prepayment: the usual price of the guided visit is 700 a person.
  for (const [f, p] of [['2026-11-14', 2], ['2026-11-15', 4]]) { reserva(G.db, { fecha: f, hora: '11:00', personas: p }); cargo(G.db, { fecha: f, hora: '11:00', monto: p * 70000 }); }
  return { G, P, env: { GROWTH: G.d1, DB: P.d1 } };
}

test('a week is seven days with each reservation, its guest and its totals; cancelled ones do not count as covers', async () => {
  const { G, P, env } = datos();
  const a = reserva(G.db, { fecha: '2026-11-28', hora: '13:00', personas: 4, estado: 'created', mesa: 'ARC2', origen: 'phone' });
  const b = reserva(G.db, { fecha: '2026-11-28', hora: '13:30', personas: 2, estado: 'cancelled' });
  const c = reserva(G.db, { fecha: '2026-11-25', hora: '14:00', personas: 3, estado: 'no_show', mesa: '' });
  huesped(P.db, a, { nombre: 'Ana', apellido: 'Prueba', fecha: '2026-11-28' });
  const s = await semana(env, { nombre: 'Anfitrión', ventas: false, admin: false }, LUNES, HOY, AHORA);
  assert.equal(s.desde, LUNES); assert.equal(s.hasta, '2026-11-29'); assert.equal(s.anterior, '2026-11-16'); assert.equal(s.siguiente, '2026-11-30');
  assert.equal(s.dias.length, 7);
  const sab = s.dias.find((d) => d.fecha === '2026-11-28');
  assert.deepEqual(sab.totales, { reservas: 1, personas: 4, canceladas: 1, noLlegaron: 0, porLlegar: 1 });
  assert.deepEqual(sab.franjas, [{ media: 26, personas: 4 }]);
  const ra = sab.reservas.find((r) => r.id === a);
  assert.deepEqual({ hora: ra.hora, personas: ra.personas, mesa: ra.mesa, origen: ra.origen, estado: ra.estado, cuenta: ra.cuenta }, { hora: '13:00', personas: 4, mesa: 'ARC2', origen: 'phone', estado: 'created', cuenta: null });
  assert.deepEqual(ra.huesped, { nombre: 'Ana Prueba', telefono: '+52 415 555 0100', correo: 'persona@example.com' });
  assert.equal(sab.reservas.find((r) => r.id === b).huesped, null);
  const mie = s.dias.find((d) => d.fecha === '2026-11-25');
  assert.equal(mie.reservas[0].mesa, null); assert.deepEqual(mie.totales, { reservas: 0, personas: 0, canceladas: 0, noLlegaron: 1, porLlegar: 0 });
  assert.deepEqual(s.totales, { reservas: 1, personas: 4, canceladas: 1, noLlegaron: 1, prepagos: 0 });
  assert.equal(s.sinHuesped, 1);                                // the no-show has no guest yet; the cancelled one is not chased
  assert.equal(c.length > 0, true);
});

test('open days, today, and the days ahead that may be short while the feed is young', async () => {
  const { env } = datos();
  const s = await semana(env, { ventas: false }, LUNES, HOY, AHORA);
  assert.deepEqual(s.dias.map((d) => [d.fecha.slice(8), d.abierto, d.hoy, d.pasado, d.incompleto]), [
    ['23', false, false, true, false], ['24', false, false, true, false], ['25', false, false, true, false], ['26', false, true, false, true],
    ['27', false, false, false, true], ['28', true, false, false, true], ['29', true, false, false, true],
  ]);
  assert.equal(s.feedDesde, FEED_DESDE);
  const lejos = await semana(env, { ventas: false }, '2027-03-01', HOY, AHORA);
  assert.equal(lejos.dias.some((d) => d.incompleto), false);   // far enough ahead, every booking was made after the feed started
});

test('prepaid experiences are an estimate: on the reservation when it fits, on its own when it does not', async () => {
  const { G, env } = datos();
  const solo = reserva(G.db, { fecha: '2026-11-27', hora: '11:00', personas: 3, estado: 'created' });
  cargo(G.db, { fecha: '2026-11-27', hora: '11:00', monto: 234000, experiencia: '793495' });                      // one reservation at that hour: its own
  const dos = reserva(G.db, { fecha: '2026-11-28', hora: '13:00', personas: 2, estado: 'created' });
  const cuatro = reserva(G.db, { fecha: '2026-11-28', hora: '13:00', personas: 4, estado: 'created' });
  cargo(G.db, { fecha: '2026-11-28', hora: '13:00', monto: 280000 });                                             // four people at 700
  cargo(G.db, { fecha: '2026-11-28', hora: '13:00', monto: 99000 });                                              // fits nobody
  cargo(G.db, { fecha: '2026-11-29', hora: '12:00', monto: 140000 });                                             // no reservation in the feed
  cargo(G.db, { fecha: '2026-11-29', hora: '12:00', monto: 90000, reembolso: 90000 });                            // refunded in full: gone
  const s = await semana(env, { ventas: false }, LUNES, HOY, AHORA);
  const dia = (f) => s.dias.find((d) => d.fecha === f), res = (f, id) => dia(f).reservas.find((r) => r.id === id);
  assert.deepEqual(res('2026-11-27', solo).experiencia, { nombre: 'Menú degustación 5 tiempos', monto: 234000, seguridad: 'unica' });
  assert.deepEqual(res('2026-11-28', cuatro).experiencia, { nombre: 'Visita guiada + degustación', monto: 280000, seguridad: 'personas' });
  assert.equal(res('2026-11-28', dos).experiencia, null);
  assert.deepEqual(dia('2026-11-28').prepagos, [{ hora: '13:00', experiencia: 'Visita guiada + degustación', monto: 99000, personas: null, motivo: 'varias' }]);
  assert.deepEqual(dia('2026-11-29').prepagos, [{ hora: '12:00', experiencia: 'Visita guiada + degustación', monto: 140000, personas: 2, motivo: 'sin_reserva' }]);
  assert.equal(s.totales.prepagos, 2);
});

test('sales sit beside each day only for those who may see them, and guests older than the retention are said to be deleted', async () => {
  const { G, env } = datos();
  cuenta(G.db, { fecha: '2026-11-25', comensales: 3, total: 232000, iva: 32000 });
  cuenta(G.db, { fecha: '2026-11-25', tipo: 'TAKE_OUT', comensales: 1, total: 58000, iva: 8000 });
  cuenta(G.db, { fecha: '2026-11-25', estado: 'VOIDED', total: 0, iva: 0 });
  const host = await semana(env, { ventas: false }, LUNES, HOY, AHORA);
  assert.equal('ventas' in host.dias[2], false); assert.equal(host.fresco.ventas, undefined); assert.equal(host.yo.ventas, false);
  const jefe = await semana(env, { ventas: true, admin: true, nombre: 'Jefa' }, LUNES, HOY, AHORA);
  assert.deepEqual(jefe.dias[2].ventas, { neto: 250000, conIva: 290000, cuentas: 2, comensales: 3, ticket: 66667 });
  assert.deepEqual(jefe.dias[0].ventas, { neto: 0, conIva: 0, cuentas: 0, comensales: 0, ticket: null });   // a recorded day with no checks: closed, not unknown
  assert.equal(jefe.dias[5].ventas, null);                                                                    // Saturday has not happened: no number, not a zero
  assert.equal(jefe.dias[2].abierto, true);                                                                   // it sold, so it shows
  const viejo = reserva(G.db, { fecha: '2026-08-12', hora: '13:00' });
  const ago = await semana(env, { ventas: false }, '2026-08-10', HOY, AHORA);
  const r = ago.dias[2].reservas.find((x) => x.id === viejo);
  assert.equal(r.huesped, null); assert.equal(r.huespedBorrado, true); assert.equal(ago.sinHuesped, 0);
});

test('a returning guest is recognised by email or phone: earlier visits and no-shows, never later ones', async () => {
  const { G, P, env } = datos();
  const hoyR = reserva(G.db, { fecha: '2026-11-28', hora: '13:00', personas: 2, estado: 'confirmed' });
  const antes1 = reserva(G.db, { fecha: '2026-11-14', hora: '13:00', personas: 2, estado: 'completed' });
  const antes2 = reserva(G.db, { fecha: '2026-11-07', hora: '14:00', personas: 4, estado: 'no_show' });
  const despues = reserva(G.db, { fecha: '2026-12-05', hora: '14:00', personas: 4, estado: 'completed' });
  const otro = reserva(G.db, { fecha: '2026-11-15', hora: '14:00', personas: 4, estado: 'completed' });
  huesped(P.db, hoyR, { correo: 'Ana@Example.com', telefono: '+52 415 555 0199', fecha: '2026-11-28' });
  huesped(P.db, antes1, { correo: 'ana@example.com', telefono: '', fecha: '2026-11-14' });
  huesped(P.db, antes2, { correo: 'otra@example.com', telefono: '415 555 0199', fecha: '2026-11-07' });
  huesped(P.db, despues, { correo: 'ana@example.com', fecha: '2026-12-05' });
  huesped(P.db, otro, { correo: 'nadie@example.com', telefono: '+52 415 555 0000', fecha: '2026-11-15' });
  const s = await semana(env, { nombre: 'A', ventas: false }, LUNES, HOY, AHORA);
  const r = s.dias.find((d) => d.fecha === '2026-11-28').reservas.find((x) => x.id === hoyR);
  assert.deepEqual(r.historial, { visitas: 1, faltas: 1, ultima: '2026-11-14' });
});

test('walk-ins imported from Guest Center are counted per day, never listed as reservations', async () => {
  const { G, env } = datos();
  reserva(G.db, { fecha: '2026-11-28', hora: '13:00', personas: 4, estado: 'confirmed' });
  reserva(G.db, { fecha: '2026-11-28', hora: '13:10', personas: 3, estado: 'completed', origen: 'walk-in', mesa: 'M2' });
  reserva(G.db, { fecha: '2026-11-28', hora: '14:00', personas: 2, estado: 'completed', origen: 'walk-in' });
  const s = await semana(env, { nombre: 'A', ventas: false }, LUNES, HOY, AHORA);
  const sab = s.dias.find((d) => d.fecha === '2026-11-28');
  assert.equal(sab.reservas.length, 1); assert.equal(sab.totales.personas, 4);
  assert.deepEqual(sab.sinReservar, { visitas: 2, personas: 5 });
  assert.equal(s.dias.find((d) => d.fecha === '2026-11-27').sinReservar, null);
});
