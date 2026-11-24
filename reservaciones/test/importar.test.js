// The Guest Center importer: matching against stored rows, stable ids, the sync's upsert, cleanup of gc- copies.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leerCsv, aMs, deExport, comparar, leerFilas, sentencias, huespedesSql } from '../scripts/importar-guestcenter.mjs';
import { growth } from './d1.js';

const CAB = 'Fecha de visita,Hora de visita,Fecha de creación,Hora de creación,Fecha de cancelación,Fecha de inasistencia,Fecha de asistencia,Fecha de término,Última actualización,Nombre del comensal,Número de teléfono,Tamaño,Estado,Mesa,Fuente';
const fila = (o) => [o.fecha, o.hora, o.creada ?? '2026-11-20', o.creadaHora ?? '10:00', o.cancelada ?? '', '', o.sentada ?? '', o.termino ?? '', o.cambio ?? '2026-11-22 16:49:28.181', `"${o.nombre ?? 'Ana, Prueba'}"`, o.tel ?? '+52 415 555 0100', o.p ?? 2, o.estado ?? 'Listo', `"${o.mesa ?? 'M1'}"`, o.fuente ?? 'Por teléfono/En el restaurante'].join(',');
const csv = (...f) => leerCsv(`﻿${CAB}\n${f.map(fila).join('\n')}\n`);

test('times are San Miguel local (UTC-6); quoted fields keep their commas', () => {
  assert.equal(aMs('2026-11-22', '16:00'), Date.UTC(2026, 10, 22, 22, 0));
  assert.equal(aMs('2026-11-22 15:23:06.181'), Date.UTC(2026, 10, 22, 21, 23, 6, 181));
  assert.equal(aMs('2026-11-22', '4:30 pm'), Date.UTC(2026, 10, 22, 22, 30));
  assert.equal(aMs(''), null);
  const [x] = csv({ fecha: '2026-11-22', hora: '16:00', mesa: 'M6,M7' });
  assert.equal(x['Nombre del comensal'], 'Ana, Prueba');
  const r = deExport(x);
  assert.deepEqual({ status: r.status, origin: r.origin, tableName: r.tableName, partySize: r.partySize, statusAt: r.statusAt }, { status: 'completed', origin: 'phone', tableName: 'M6+M7', partySize: 2, statusAt: Date.UTC(2026, 10, 22, 22, 49, 28, 181) });
  assert.equal(deExport({ ...x, Fuente: 'Sin reservación' }).origin, 'walk-in');
  assert.match(deExport({ ...x, Estado: '???' }).error, /estado desconocido/);
});

test('a row the feed already has is left alone; matching is by creation minute first, then time, size and table', () => {
  const ya = leerFilas('740|2026-11-22|2026-11-22 13:00|16:00|2|M1|completed;460|2026-11-06|2026-10-30 12:21|12:00|2|PIR2|completed');
  const export_ = csv({ fecha: '2026-11-22', hora: '16:00', creada: '2026-11-22', creadaHora: '13:00' },
    { fecha: '2026-11-06', hora: '12:00', creada: '2026-11-06', creadaHora: '09:00', estado: 'Cancelado', mesa: 'PIR5' },     // same slot, another table: new
    { fecha: '2026-11-06', hora: '12:00', creada: '2026-10-30', creadaHora: '12:21', estado: 'Asumida como terminada', mesa: 'PIR2' });
  const r = comparar(export_, ya);
  assert.equal(r.yaEstan, 2); assert.equal(r.nuevas.length, 1); assert.equal(r.nuevas[0].status, 'cancelled'); assert.match(r.nuevas[0].id, /^gc-[0-9a-f]{12}$/);
});

test('the same export twice changes nothing; a gc- row that later arrives under its real number is deleted', async () => {
  const export_ = csv({ fecha: '2026-12-04', hora: '13:00', creada: '2026-11-10', creadaHora: '11:15', estado: 'Sin confirmar', p: 40 });
  const primera = comparar(export_, []);
  const id = primera.nuevas[0].id;
  const G = growth();
  for (const s of sentencias(primera, 1000)) G.db.prepare(s).run();
  const filas = () => G.db.prepare("SELECT confirmation_id, service_date, strftime('%Y-%m-%d %H:%M', created_at/1000 - 21600, 'unixepoch') AS c, strftime('%H:%M', scheduled_at/1000 - 21600, 'unixepoch') AS h, party_size, table_name, status FROM ot_reservations").all();
  const comoTexto = () => filas().map((f) => [f.confirmation_id, f.service_date, f.c, f.h, f.party_size, f.table_name, f.status].join('|')).join(';');
  assert.deepEqual(filas().map((f) => [f.confirmation_id, f.status, f.party_size, f.h]), [[id, 'created', 40, '13:00']]);
  const segunda = comparar(export_, leerFilas(comoTexto()));
  assert.equal(segunda.nuevas.length, 0); assert.equal(segunda.actualizar.length, 0); assert.equal(segunda.yaEstan, 1);
  // Confirmed later in OpenTable: the import updates the same row.
  const confirmada = csv({ fecha: '2026-12-04', hora: '13:00', creada: '2026-11-10', creadaHora: '11:15', estado: 'Confirmado', p: 40, cambio: '2026-12-01 09:00:00.000' });
  for (const s of sentencias(comparar(confirmada, leerFilas(comoTexto())), 2000)) G.db.prepare(s).run();
  assert.deepEqual(filas().map((f) => [f.confirmation_id, f.status]), [[id, 'confirmed']]);
  // The feed brings it under number 812 (same visit date, same creation minute): the gc- copy goes.
  G.db.prepare("INSERT INTO ot_reservations (confirmation_id, created_at, created_date, scheduled_at, service_date, party_size, origin, status, status_rank, status_at, table_name, currency, updated_at) VALUES ('812', ?, '2026-11-10', ?, '2026-12-04', 40, 'phone', 'confirmed', 2, ?, '', '', 3000)")
    .run(aMs('2026-11-10', '11:15') + 37_000, aMs('2026-12-04', '13:00'), aMs('2026-12-01', '09:00'));
  const tercera = comparar(confirmada, leerFilas(comoTexto()));
  assert.deepEqual(tercera.borrar, [id]); assert.equal(tercera.nuevas.length, 0);
  for (const s of sentencias(tercera, 4000)) G.db.prepare(s).run();
  assert.deepEqual(filas().map((f) => f.confirmation_id), ['812']);
});

test('two bookings identical in every field the id uses still get two ids', () => {
  const r = comparar(csv({ fecha: '2026-11-05', hora: '15:15', estado: 'Cancelado', mesa: 'M7' }, { fecha: '2026-11-05', hora: '15:15', estado: 'Cancelado', mesa: '' }), []);
  assert.equal(r.nuevas.length, 2); assert.equal(r.nuevas[1].id, `${r.nuevas[0].id}-2`);
});

test('bookings entered in the same minute keep their own rows; only an unaccounted exact twin is deleted', () => {
  // Two identical bookings in OpenTable, entered seconds apart: one came through the feed (481), one was imported.
  const guardadas = leerFilas('481|2026-11-15|2026-10-30 12:28|11:00|2|PIR2|completed;gc-38944546f15b|2026-11-15|2026-10-30 12:28|11:00|2|PIR2|completed;gc-0000000000aa|2026-11-15|2026-10-30 12:28|15:30|6|PIR1|completed');
  const dos = { fecha: '2026-11-15', hora: '11:00', creada: '2026-10-30', creadaHora: '12:28', p: 2, mesa: 'PIR2' };
  const r = comparar(csv(dos, { ...dos, nombre: 'Otro Huésped' }, { fecha: '2026-11-15', hora: '15:30', creada: '2026-10-30', creadaHora: '12:28', p: 6, mesa: 'PIR1' }), guardadas);
  assert.deepEqual(r.borrar, []); assert.equal(r.nuevas.length, 0);
  // If OpenTable only has one of them, the gc- twin is the leftover.
  const una = comparar(csv(dos, { fecha: '2026-11-15', hora: '15:30', creada: '2026-10-30', creadaHora: '12:28', p: 6, mesa: 'PIR1' }), guardadas);
  assert.deepEqual(una.borrar, ['gc-38944546f15b']);
});

test('guests of gc- reservations: name, phone and notes, never for walk-ins, an empty field never erases', () => {
  const r = { id: 'gc-abc', origin: 'web', nombre: "Ana O'Hara", tel: '+52 415 555 0101', notas: 'Aniversario', servicio: '2026-12-01', statusAt: 1, createdAt: 1 };
  const w = { ...r, id: 'gc-w', origin: 'walk-in' };
  const [sql, ...resto] = huespedesSql({ nuevas: [r, w], copias: [] }, 5);
  assert.equal(resto.length, 0);
  assert.match(sql, /'gc-abc','Ana O''Hara','','','\+52 415 555 0101','2026-12-01',1,5,'Aniversario'/);
  assert.doesNotMatch(sql, /gc-w/);
  assert.match(sql, /first_name = CASE WHEN excluded.first_name <> '' THEN excluded.first_name ELSE guests.first_name END/);
});
