// Parrot's sales by period: totals, what they are compared with, and the parts only Parrot has.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { ventas, periodoDe, lineaDe, olvidar, COMENSALES_DESDE } from '../src/ventas.js';
import { growth, ms, cuenta, historia, reserva } from './d1.js';

const HOY = '2026-11-22', AHORA = ms(HOY, '20:00');
beforeEach(() => olvidar());

test('a day and a week look back one week, a month four; steps move by whole periods', () => {
  assert.deepEqual(periodoDe('dia', '2026-11-21'), { desde: '2026-11-21', hasta: '2026-11-21', atras: 7, anterior: '2026-11-20', siguiente: '2026-11-22' });
  assert.deepEqual(periodoDe('semana', '2026-11-19'), { desde: '2026-11-16', hasta: '2026-11-22', atras: 7, anterior: '2026-11-09', siguiente: '2026-11-23' });
  assert.deepEqual(periodoDe('mes', '2026-11-19'), { desde: '2026-11-01', hasta: '2026-11-30', atras: 28, anterior: '2026-10-01', siguiente: '2026-12-01' });
});

test('every Parrot category lands in a line of business, and what is new is the restaurant', () => {
  assert.deepEqual(['Eventos', 'Enoturismo', 'Degustaciones', 'Picnics', 'Vino Para Llevar', 'Tienda Alimentos', 'Cava  Wine Library', 'Platos Fuertes', 'Vinos por Copa', 'Sopas del día', ''].map(lineaDe),
    ['eventos', 'experiencias', 'experiencias', 'experiencias', 'tienda', 'tienda', 'tienda', 'restaurante', 'restaurante', 'restaurante', 'restaurante']);
});

function semanaDePrueba() {
  const G = growth();
  // The old point of sale, a year back, and up to two days before Parrot starts.
  historia(G.db, '2025-10-01', 1); historia(G.db, '2026-08-09', 1);
  historia(G.db, '2025-11-22', 400000, 30, 12);                                   // 52 weeks before Saturday 21 Nov 2026
  // Parrot from 11 Aug 2026.
  cuenta(G.db, { fecha: '2026-08-11', total: 116, iva: 16 });
  // The week before: one check on the Saturday.
  cuenta(G.db, { fecha: '2026-11-14', comensales: 2, total: 232000, iva: 32000 });
  // This week, Saturday 21: a table, the shop, an event, a voided check and a house check at zero.
  cuenta(G.db, { fecha: '2026-11-21', hora: '13:10', comensales: 4, total: 464000, iva: 64000, descuento: 20000,
    items: [{ nombre: 'Tacos de Pato', categoria: 'Platos Fuertes', cantidad: 2, total: 232000 }, { nombre: 'Copa Mosaico', categoria: 'Vinos por Copa', cantidad: 4, total: 232000 }, { nombre: 'Pizza', categoria: 'Pizzas', total: 99999, estado: 'VOIDED' }],
    pagos: [{ tipo: 'Pay TDC', monto: 400000, propina: 46400 }, { tipo: 'Cash', monto: 64000 }, { tipo: 'Cash', monto: 5000, estado: 'VOIDED' }] });
  cuenta(G.db, { fecha: '2026-11-21', hora: '16:40', tipo: 'TAKE_OUT', comensales: 1, total: 116000, iva: 16000, items: [{ nombre: 'Tienda Tempranillo', categoria: 'Vino Para Llevar', cantidad: 2, total: 116000 }], pagos: [{ tipo: 'Pay TDD', monto: 116000 }] });
  cuenta(G.db, { fecha: '2026-11-21', hora: '17:05', tipo: 'TAKE_OUT', comensales: 1, total: 580000, iva: 80000, items: [{ nombre: 'Evento privado', categoria: 'Eventos', total: 580000 }], pagos: [{ tipo: 'Transferencia', monto: 580000 }] });
  cuenta(G.db, { fecha: '2026-11-21', hora: '15:00', estado: 'VOIDED', total: 0, iva: 0, comensales: 9 });
  cuenta(G.db, { fecha: '2026-11-21', hora: '15:30', comensales: 2, total: 0, iva: 0, descuento: 90000, pagos: [] });
  reserva(G.db, { fecha: '2026-11-21', personas: 4 }); reserva(G.db, { fecha: '2026-11-21', personas: 2, estado: 'no_show' });
  return G;
}

test('the week so far: net of IVA, guests from dine-in checks only, tickets, and the money that is not sales', async () => {
  const v = await ventas({ GROWTH: semanaDePrueba().d1 }, 'semana', '2026-11-19', HOY, AHORA);
  assert.deepEqual({ desde: v.desde, hasta: v.hasta, corte: v.corte, enCurso: v.enCurso, anterior: v.anterior, siguiente: v.siguiente }, { desde: '2026-11-16', hasta: '2026-11-22', corte: '2026-11-22', enCurso: false, anterior: '2026-11-09', siguiente: '2026-11-23' });
  assert.deepEqual(v.total, { neto: 1000000, conIva: 1160000, cuentas: 4, comensales: 6, sinConteo: 0, ticketComensal: 66667, ticketCuenta: 250000, descuentos: 110000, sinCobro: 1, propinas: 46400, eventos: 500000 });
  assert.equal(v.serie.length, 7);
  assert.deepEqual(v.serie[5], { fecha: '2026-11-21', futuro: false, neto: 1000000, cuentas: 4, comensales: 6, anterior: 200000, anio: 400000 });
  assert.deepEqual({ neto: v.serie[0].neto, anio: v.serie[0].anio }, { neto: 0, anio: 0 });                 // Monday: recorded and closed, a zero and not a gap
});

test('compared with the week before and, without private events, with the same weekdays a year earlier', async () => {
  const v = await ventas({ GROWTH: semanaDePrueba().d1 }, 'semana', '2026-11-19', HOY, AHORA);
  assert.deepEqual(v.vs.anterior, { antes: 200000, pct: 400 });
  assert.deepEqual(v.vs.anio, { antes: 400000, pct: 25 });                                                   // (1,000,000 − 500,000 of events) against 400,000
  assert.deepEqual(v.vs.comensales, { antes: 2, pct: 200 });
  const t = v.tendencia; assert.equal(t.length, 12); assert.equal(t[11].semana, '2026-11-16'); assert.equal(t[11].neto, 1000000); assert.equal(t[11].anio, 400000); assert.equal(t[10].neto, 200000); assert.equal(t[11].parcial, false);
});

test('hours, lines, products and payments come from finished checks; voided items and payments are left out', async () => {
  const v = await ventas({ GROWTH: semanaDePrueba().d1 }, 'dia', '2026-11-21', HOY, AHORA);
  assert.deepEqual(v.horas, [{ fecha: '2026-11-21', hora: 13, cuentas: 1, neto: 400000 }, { fecha: '2026-11-21', hora: 15, cuentas: 1, neto: 0 }, { fecha: '2026-11-21', hora: 16, cuentas: 1, neto: 100000 }, { fecha: '2026-11-21', hora: 17, cuentas: 1, neto: 500000 }]);
  assert.deepEqual(v.lineas.map((l) => [l.id, l.neto, l.categorias.map((c) => c.nombre)]), [['restaurante', 400000, ['Platos Fuertes', 'Vinos por Copa']], ['experiencias', 0, []], ['tienda', 100000, ['Vino Para Llevar']], ['eventos', 500000, ['Eventos']]]);
  assert.deepEqual(v.productos.map((p) => [p.nombre, p.linea, p.cantidad, p.neto]), [['Evento privado', 'eventos', 1, 500000], ['Copa Mosaico', 'restaurante', 4, 200000], ['Tacos de Pato', 'restaurante', 2, 200000], ['Tienda Tempranillo', 'tienda', 2, 100000]]);
  assert.deepEqual(v.pagos, [{ tipo: 'Transferencia', pagos: 1, monto: 580000, propina: 0 }, { tipo: 'Pay TDC', pagos: 1, monto: 400000, propina: 46400 }, { tipo: 'Pay TDD', pagos: 1, monto: 116000, propina: 0 }, { tipo: 'Cash', pagos: 1, monto: 64000, propina: 0 }]);
  assert.deepEqual(v.reservas, [{ estado: 'completed', reservas: 1, personas: 4 }, { estado: 'no_show', reservas: 1, personas: 2 }]);
  assert.deepEqual(v.vs.anterior, { antes: 200000, pct: 400 });                                              // the same weekday a week before
});

test('missing is missing: guests before the trusted date, days nobody recorded, and a period still to come', async () => {
  const G = semanaDePrueba();
  cuenta(G.db, { fecha: '2026-10-31', comensales: 7, total: 116000, iva: 16000 });
  const oct = await ventas({ GROWTH: G.d1 }, 'dia', '2026-10-31', HOY, AHORA);
  assert.equal(oct.total.comensales, null); assert.equal(oct.total.ticketComensal, null); assert.equal(oct.total.sinConteo, 1); assert.equal(oct.comensalesDesde, COMENSALES_DESDE);
  assert.equal(oct.vs.comensales, null);
  const viejo = await ventas({ GROWTH: G.d1 }, 'semana', '2025-09-10', HOY, AHORA);                           // only the old point of sale: daily totals, nothing else
  assert.equal(viejo.conParrot, false); assert.deepEqual(viejo.horas, []); assert.equal(viejo.total.propinas, null); assert.equal(viejo.vs.anio, null);
  const antes = await ventas({ GROWTH: G.d1 }, 'semana', '2025-09-24', HOY, AHORA);                           // before any record at all
  assert.equal(antes.serie.every((d) => d.neto === null), true); assert.equal(antes.vs.anterior, null);
  const futuro = await ventas({ GROWTH: G.d1 }, 'semana', '2026-12-10', HOY, AHORA);
  assert.equal(futuro.corte, null); assert.equal(futuro.total.neto, null); assert.equal(futuro.serie.every((d) => d.futuro && d.neto === null), true);
  const mes = await ventas({ GROWTH: G.d1 }, 'mes', '2026-11-10', HOY, AHORA);
  assert.equal(mes.enCurso, true); assert.equal(mes.corte, HOY); assert.equal(mes.serie.length, 30); assert.equal(mes.total.neto, 1200000); assert.equal(mes.atras, 28);
});
