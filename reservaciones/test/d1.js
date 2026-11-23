// D1 stand-ins for tests: Node's SQLite behind the calls the app makes. "growth" gets every migration of the real
// growth database (so a change to its schema that breaks this app's queries fails here), "propia" this app's own.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';

function abrir(dir) {
  const db = new DatabaseSync(':memory:');
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(f, dir), 'utf8'));
  const stmt = (sql, binds = []) => ({
    bind: (...b) => stmt(sql, b),
    all: async () => ({ results: db.prepare(sql).all(...binds) }),
    first: async () => db.prepare(sql).get(...binds) ?? null,
    run: async () => { const r = db.prepare(sql).run(...binds); return { meta: { changes: Number(r.changes) } }; },
  });
  return { db, d1: { prepare: (sql) => stmt(sql), batch: async (list) => { const out = []; for (const s of list) out.push(await s.run()); return out; } } };
}
export const growth = () => abrir(new URL('../../growth/migrations/', import.meta.url));
export const propia = () => abrir(new URL('../migrations/', import.meta.url));

/** Local time in San Miguel (UTC-6) to epoch ms. */
export const ms = (fecha, hora = '12:00') => Date.parse(`${fecha}T${hora}:00-06:00`);

let n = 0;
export function reserva(db, o) {
  const r = { id: String(++n + 1000), fecha: '2026-11-21', hora: '13:00', personas: 2, origen: 'web', estado: 'completed', mesa: 'M1', creada: null, ...o };
  const at = ms(r.fecha, r.hora);
  db.prepare(`INSERT INTO ot_reservations (confirmation_id, created_at, created_date, scheduled_at, service_date, party_size, origin, status, status_rank, status_at, table_name, arrived_at, seated_at, done_at, pos_total_minor, currency, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, '', ?)`).run(r.id, r.creada ?? at - 86_400_000, r.fecha, at, r.fecha, r.personas, r.origen, r.estado, 3, at, r.mesa, r.llego ?? null, r.sentado ?? null, r.salio ?? null, at);
  return r.id;
}
export function cargo(db, o) {
  const c = { id: `ch_${++n}`, fecha: '2026-11-21', hora: '13:00', monto: 140000, reembolso: 0, experiencia: '796500', ...o };
  db.prepare(`INSERT INTO stripe_payments (id, created_at, local_date, currency, amount_minor, refunded_minor, status, source, kind, experience_id, platform, service_date, service_time, fetched_at)
    VALUES (?, ?, ?, 'MXN', ?, ?, 'succeeded', 'opentable', 'experiences', ?, 'Diner Web', ?, ?, 0)`).run(c.id, ms(c.fecha) - 5 * 86_400_000, c.fecha, c.monto, c.reembolso, c.experiencia, c.fecha, c.hora);
  return c.id;
}
export function cuenta(db, o) {
  const c = { id: `o_${++n}`, fecha: '2026-11-21', hora: '14:10', tipo: 'DINE_IN', comensales: 2, total: 116000, iva: 16000, descuento: 0, estado: 'FINISHED', items: [], pagos: null, ...o };
  db.prepare(`INSERT INTO pos_orders (uuid, store_uuid, created_at, local_date, status, order_type, order_type_name, table_name, customers, total_minor, taxes_minor, discounts_minor, reference, fetched_at)
    VALUES (?, 's', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?)`).run(c.id, ms(c.fecha, c.hora), c.fecha, c.estado, c.tipo, c.tipo === 'DINE_IN' ? 'Comer aquí' : 'Para llevar', c.tipo === 'DINE_IN' ? 'M1' : '', c.comensales, c.total, c.iva, c.descuento, ms(c.fecha, c.hora));
  for (const it of c.items) db.prepare(`INSERT INTO pos_items (uuid, order_uuid, local_date, item_name, category, product_type, quantity, total_minor, subtotal_minor, status, fetched_at) VALUES (?, ?, ?, ?, ?, '', ?, ?, ?, ?, 0)`)
    .run(`i_${++n}`, c.id, c.fecha, it.nombre, it.categoria, it.cantidad ?? 1, it.total, Math.round(it.total / 1.16), it.estado ?? 'ACTIVE');
  for (const p of c.pagos ?? [{ tipo: 'Pay TDC', monto: c.total, propina: 0 }]) db.prepare(`INSERT INTO pos_payments (uuid, order_uuid, local_date, status, payment_type, amount_minor, tip_minor, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0)`)
    .run(`p_${++n}`, c.id, c.fecha, p.estado ?? 'CHARGED', p.tipo, p.monto, p.propina ?? 0);
  return c.id;
}
export function historia(db, fecha, neto, comensales = 10, cuentas = 5) {
  db.prepare(`INSERT INTO pos_daily_history (local_date, source, orders, guests, net_minor, total_minor, dine_in_net_minor, tips_minor, discounts_minor, loaded_at) VALUES (?, 'wansoft', ?, ?, ?, ?, ?, 0, 0, 0)`)
    .run(fecha, cuentas, comensales, neto, Math.round(neto * 1.16), Math.round(neto * 0.6));
}
export function huesped(db, id, o = {}) {
  const g = { nombre: 'Persona', apellido: 'Inventada', correo: 'persona@example.com', telefono: '+52 415 555 0100', fecha: '2026-11-21', ...o };
  db.prepare('INSERT INTO guests (confirmation_id, first_name, last_name, email, phone, service_date, event_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, 1)').run(id, g.nombre, g.apellido, g.correo, g.telefono, g.fecha);
}
