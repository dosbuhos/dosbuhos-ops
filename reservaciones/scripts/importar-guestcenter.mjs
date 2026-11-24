// Guest Center → ot_reservations. OpenTable's reservations export (Reporting → Reservations → Export, all statuses,
// with the Created / Canceled / No-show / Seated / Finished / Last Updated columns) has what the Klaviyo feed misses:
// bookings OpenTable never passed to Klaviyo (mostly phone and in-house), future bookings made before the feed
// started, and walk-ins. This turns the export into SQL that stores those rows the way the sync does.
//
// The export carries no confirmation number, so a row is matched to what is already stored by the moment it was
// created (to the minute, the same in both sources) and its visit date; failing that, by visit date, time, party
// size and table. Rows already stored are left to the sync. Missing ones get a stable id, "gc-" plus a hash of the
// visit date, creation minute, size and guest, so importing the same export twice changes nothing. When the feed later
// brings the same reservation under its real number, the sync deletes the gc- copy (same visit date and creation
// time), and this script deletes any it finds too.
//
// Usage: node scripts/importar-guestcenter.mjs <export.csv> <rows.txt> [out-dir]
//   rows.txt: the output of FILAS_SQL below (one line: id|service_date|created minute|time|size|table|status;…).
// Writes out-dir/import-NN.sql (up to 4 statements each, about 100 rows) and prints a summary as JSON.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

/** San Miguel de Allende is UTC-6 all year; the export's times are local. */
export const OFFSET_MS = 6 * 3_600_000;
export const FILAS_SQL = `SELECT group_concat(confirmation_id||'|'||IFNULL(service_date,'')||'|'||IFNULL(strftime('%Y-%m-%d %H:%M', created_at/1000 - 21600, 'unixepoch'),'')||'|'||IFNULL(strftime('%H:%M', scheduled_at/1000 - 21600, 'unixepoch'),'')||'|'||IFNULL(party_size,'')||'|'||table_name||'|'||status, ';') AS t FROM ot_reservations`;

// Spanish and English headers (the export follows the account's language).
const COL = {
  fecha: ['Fecha de visita', 'Visit Date'], hora: ['Hora de visita', 'Visit Time'],
  creada: ['Fecha de creación', 'Created Date'], creadaHora: ['Hora de creación', 'Created Time'],
  cancelada: ['Fecha de cancelación', 'Canceled Date'], noLlego: ['Fecha de inasistencia', 'No-show Date'],
  sentada: ['Fecha de asistencia', 'Seated Date'], termino: ['Fecha de término', 'Finished Date'], cambio: ['Última actualización', 'Last Updated'],
  nombre: ['Nombre del comensal', 'Guest Name'], tel: ['Número de teléfono', 'Phone Number'], personas: ['Tamaño', 'Size'],
  estado: ['Estado', 'Status'], mesa: ['Mesa', 'Table'], fuente: ['Fuente', 'Source'],
};
const ESTADO = {
  'listo': 'completed', 'done': 'completed', 'finished': 'completed', 'asumida como terminada': 'completed', 'assumed finished': 'completed',
  'cancelado': 'cancelled', 'canceled': 'cancelled', 'cancelled': 'cancelled',
  'ausente': 'no_show', 'no show': 'no_show', 'reclamo por reserva no honrada': 'no_show', 'disputed no show': 'no_show',
  'sin confirmar': 'created', 'booked': 'created', 'not confirmed': 'created', 'confirmado': 'confirmed', 'confirmed': 'confirmed',
  'con asiento': 'confirmed', 'seated': 'confirmed', 'llegó': 'confirmed', 'arrived': 'confirmed',
};
const RANK = { created: 1, confirmed: 2, completed: 3, cancelled: 3, no_show: 3 };
const ORIGEN = (f) => (/sin reservaci|walk/i.test(f) ? 'walk-in' : /tel[eé]fono|phone|restaurante|in-house/i.test(f) ? 'phone' : 'web');

/** RFC 4180 CSV (quoted fields, doubled quotes, newlines inside quotes). */
export function leerCsv(texto) {
  const filas = []; let fila = [], campo = '', q = false;
  const t = texto.replace(/^﻿/, '');
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { campo += '"'; i++; } else q = false; } else campo += c; }
    else if (c === '"') q = true;
    else if (c === ',') { fila.push(campo); campo = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; fila.push(campo); filas.push(fila); fila = []; campo = ''; }
    else campo += c;
  }
  if (campo !== '' || fila.length) { fila.push(campo); filas.push(fila); }
  const cab = filas.shift() || [];
  return filas.filter((f) => f.some((x) => x.trim())).map((f) => Object.fromEntries(cab.map((h, i) => [h.trim(), f[i] ?? ''])));
}

/** "2026-11-22" + "16:00" (or "4:00 pm", or "2026-11-22 15:23:06.181") → UTC ms; null when empty or unreadable. */
export function aMs(fecha, hora = '') {
  const s = `${fecha} ${hora}`.trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?\s*([ap]\.?\s?m\.?)?)?$/i);
  if (!m) return null;
  let h = Number(m[4] || 0);
  const ap = m[8]?.toLowerCase().replace(/[.\s]/g, '');
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], h, Number(m[5] || 0), Number(m[6] || 0), Number((m[7] || '0').padEnd(3, '0').slice(0, 3))) + OFFSET_MS;
}
const minuto = (ms) => (ms === null ? '' : new Date(ms - OFFSET_MS).toISOString().slice(0, 16).replace('T', ' '));
const hhmm = (ms) => new Date(ms - OFFSET_MS).toISOString().slice(11, 16);

/** One export row → the row the sync would store, or { error }. */
export function deExport(x) {
  const v = (k) => { for (const n of COL[k]) if (n in x) return String(x[n] ?? '').trim(); return ''; };
  const estado = ESTADO[v('estado').toLowerCase()];
  if (!estado) return { error: `estado desconocido “${v('estado')}”` };
  const visita = aMs(v('fecha'), v('hora')), creada = aMs(v('creada'), v('creadaHora'));
  if (visita === null) return { error: `fecha de visita ilegible “${v('fecha')} ${v('hora')}”` };
  const personas = Math.round(Number(v('personas')));
  const fin = estado === 'cancelled' ? aMs(v('cancelada')) : estado === 'no_show' ? aMs(v('noLlego')) : estado === 'completed' ? aMs(v('termino')) : null;
  const statusAt = aMs(v('cambio')) ?? fin ?? creada ?? visita;
  const origen = ORIGEN(v('fuente'));
  const mesa = v('mesa').split(/\s*[,+]\s*/).filter((t) => /^[\p{L}\p{N} ._-]{1,12}$/u.test(t)).slice(0, 4).join('+');
  const llave = [v('fecha'), minuto(creada), personas, v('nombre').toLowerCase(), v('tel').replace(/\D/g, '').slice(-10), origen === 'walk-in' ? `${v('hora')}|${mesa}` : ''].join('|');
  return {
    id: `gc-${createHash('sha256').update(llave).digest('hex').slice(0, 12)}`,
    servicio: v('fecha'), hora: hhmm(visita), creadaMin: minuto(creada),
    createdAt: creada, scheduledAt: visita, partySize: personas >= 1 && personas <= 500 ? personas : null,
    origin: origen, status: estado, statusAt, tableName: mesa,
    seatedAt: aMs(v('sentada')), doneAt: estado === 'completed' ? aMs(v('termino')) : null,
  };
}

/** rows.txt → stored rows. */
export function leerFilas(texto) {
  return texto.trim() ? texto.trim().split(';').map((s) => { const [id, servicio, creadaMin, hora, p, mesa, status] = s.split('|');
    return { id, servicio, creadaMin, hora, partySize: p ? Number(p) : null, tableName: (mesa || '').toUpperCase(), status }; }) : [];
}

const mins = (h) => { const [a, b] = String(h || '0:0').split(':').map(Number); return a * 60 + b; };

/**
 * Match the export against what is stored. Returns { nuevas, actualizar, yaEstan, borrar, errores }:
 * nuevas → rows to insert (gc- id); actualizar → gc- rows already stored whose export row changed (upsert by their id);
 * yaEstan → count of rows the feed already has; borrar → gc- ids that duplicate a real reservation.
 */
export function comparar(exportRows, guardadas) {
  const errores = [], libres = new Map(guardadas.map((g) => [g.id, g])), pareja = new Map();
  const filas = [];
  // Two bookings can share every field of the id (same guest, same minute, same size): the second gets -2, and so on.
  const vistos = new Map();
  exportRows.forEach((x, i) => { const r = deExport(x); if (r.error) { errores.push({ fila: i + 2, error: r.error }); return; }
    const k = (vistos.get(r.id) || 0) + 1; vistos.set(r.id, k); if (k > 1) r.id = `${r.id}-${k}`; filas.push(r); });
  const intentos = [
    (r, g) => g.servicio === r.servicio && r.creadaMin && g.creadaMin === r.creadaMin && g.partySize === r.partySize,
    (r, g) => g.servicio === r.servicio && r.creadaMin && g.creadaMin === r.creadaMin,
    (r, g) => g.servicio === r.servicio && g.hora === r.hora && g.partySize === r.partySize && g.tableName === r.tableName.toUpperCase(),
    (r, g) => g.servicio === r.servicio && g.partySize === r.partySize && Math.abs(mins(g.hora) - mins(r.hora)) <= 15 && (!g.creadaMin || !r.creadaMin),
  ];
  for (const prueba of intentos) {
    for (const r of filas) {
      if (pareja.has(r)) continue;
      // A real reservation number wins over a gc- copy of the same booking.
      const cand = [...libres.values()].filter((g) => prueba(r, g)).sort((a, b) => Number(a.id.startsWith('gc-')) - Number(b.id.startsWith('gc-')));
      if (cand[0]) { pareja.set(r, cand[0]); libres.delete(cand[0].id); }
    }
  }
  // gc- rows that duplicate a real one (same visit date and creation minute) go.
  const reales = guardadas.filter((g) => !g.id.startsWith('gc-'));
  const borrar = guardadas.filter((g) => g.id.startsWith('gc-') && reales.some((x) => x.servicio === g.servicio && g.creadaMin && x.creadaMin === g.creadaMin)).map((g) => g.id);
  const nuevas = [], actualizar = []; let yaEstan = 0;
  for (const r of filas) {
    const g = pareja.get(r);
    if (!g) nuevas.push(r);
    else if (g.id.startsWith('gc-') && !borrar.includes(g.id)) actualizar.push({ ...r, id: g.id });
    else yaEstan++;
  }
  return { nuevas, actualizar, yaEstan, borrar, errores };
}

const lit = (v) => (v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(Math.round(v)) : `'${String(v).replace(/'/g, "''")}'`);
/** The sync's own upsert (growth/src/connectors/klaviyo-reservations.ts): the newest event decides. */
export function upsertSql(r, ahora) {
  const newer = '(excluded.status_at > ot_reservations.status_at OR (excluded.status_at = ot_reservations.status_at AND excluded.status_rank >= ot_reservations.status_rank))';
  const latest = (c) => `${c} = CASE WHEN ${newer} THEN COALESCE(excluded.${c}, ot_reservations.${c}) ELSE COALESCE(ot_reservations.${c}, excluded.${c}) END`;
  const latestText = (c) => `${c} = CASE WHEN ${newer} AND excluded.${c} <> '' THEN excluded.${c} WHEN ot_reservations.${c} <> '' THEN ot_reservations.${c} ELSE excluded.${c} END`;
  const keep = (c) => `${c} = COALESCE(excluded.${c}, ot_reservations.${c})`;
  const creadaDia = r.createdAt === null ? null : new Date(r.createdAt - OFFSET_MS).toISOString().slice(0, 10);
  return `INSERT INTO ot_reservations (confirmation_id, created_at, created_date, scheduled_at, service_date, party_size, origin, status, status_rank, status_at, table_name, arrived_at, seated_at, done_at, pos_total_minor, currency, updated_at) VALUES (${[r.id, r.createdAt, creadaDia, r.scheduledAt, r.servicio, r.partySize, r.origin, r.status, RANK[r.status], r.statusAt, r.tableName, null, r.seatedAt, r.doneAt, null, '', ahora].map(lit).join(', ')}) ON CONFLICT(confirmation_id) DO UPDATE SET ${keep('created_at')}, ${keep('created_date')}, ${latest('scheduled_at')}, ${latest('service_date')}, ${latest('party_size')}, ${latestText('origin')}, ${latestText('table_name')}, ${keep('arrived_at')}, ${keep('seated_at')}, ${keep('done_at')}, ${keep('pos_total_minor')}, ${latestText('currency')}, status = CASE WHEN ${newer} THEN excluded.status ELSE ot_reservations.status END, status_rank = CASE WHEN ${newer} THEN excluded.status_rank ELSE ot_reservations.status_rank END, status_at = MAX(excluded.status_at, ot_reservations.status_at), updated_at = excluded.updated_at`;
}

/** New rows have no stored twin (that is what makes them new): a compact multi-row insert, 25 rows a statement, that
 *  never overwrites. Rows already stored as gc- go through the sync's upsert, so the newest event still decides. */
export function sentencias(res, ahora) {
  const fila = (r) => `(${[r.id, r.createdAt, r.createdAt === null ? null : new Date(r.createdAt - OFFSET_MS).toISOString().slice(0, 10), r.scheduledAt, r.servicio, r.partySize, r.origin, r.status, RANK[r.status], r.statusAt, r.tableName, r.seatedAt, r.doneAt, ahora].map(lit).join(',')})`;
  const altas = [];
  for (let i = 0; i < res.nuevas.length; i += 25) altas.push(`INSERT INTO ot_reservations (confirmation_id, created_at, created_date, scheduled_at, service_date, party_size, origin, status, status_rank, status_at, table_name, seated_at, done_at, updated_at) VALUES ${res.nuevas.slice(i, i + 25).map(fila).join(',')} ON CONFLICT(confirmation_id) DO NOTHING`);
  return [...res.borrar.map((id) => `DELETE FROM ot_reservations WHERE confirmation_id = ${lit(id)} AND confirmation_id LIKE 'gc-%'`), ...altas, ...res.actualizar.map((r) => upsertSql(r, ahora))];
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const [csvPath, filasPath, out = './import-sql'] = process.argv.slice(2);
  if (!csvPath || !filasPath) { console.error('Uso: node scripts/importar-guestcenter.mjs <export.csv> <rows.txt> [out-dir]'); process.exit(2); }
  const res = comparar(leerCsv(readFileSync(csvPath, 'utf8')), leerFilas(readFileSync(filasPath, 'utf8')));
  const sql = sentencias(res, Date.now());
  mkdirSync(out, { recursive: true });
  for (let i = 0; i < sql.length; i += 4) writeFileSync(`${out}/import-${String(i / 4 + 1).padStart(2, '0')}.sql`, `${sql.slice(i, i + 4).join(';\n')};\n`);
  const por = (L, k) => L.reduce((m, r) => ((m[r[k]] = (m[r[k]] || 0) + 1), m), {});
  console.log(JSON.stringify({ yaEstan: res.yaEstan, nuevas: res.nuevas.length, nuevasPorOrigen: por(res.nuevas, 'origin'), actualizar: res.actualizar.length, borrar: res.borrar.length, errores: res.errores, archivos: Math.ceil(sql.length / 4) }, null, 1));
}
