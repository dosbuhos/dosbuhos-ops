// Configuración: perfil de la empresa, usuarios, ubicaciones (edificio › sala › fila › estante), acciones en lote sobre barricas, notas.
import { fail, json, num, int, str, bool, mxToday, all, one, run } from './lib.js';

export async function route({ m, p, env, body, q }) {
  let r;
  if (m === 'GET' && p === '/company') return json({ company: await company(env) });
  if (m === 'PUT' && p === '/company') return json(await saveCompany(env, await body()));
  if (m === 'GET' && p === '/users') return json({ users: await all(env, 'SELECT * FROM users ORDER BY active DESC, role, name') });
  if (m === 'POST' && p === '/users') return json(await saveUser(env, null, await body()));
  if ((r = p.match(/^\/users\/(\d+)$/)) && m === 'PUT') return json(await saveUser(env, +r[1], await body()));
  if ((r = p.match(/^\/users\/(\d+)\/seen$/)) && m === 'POST') { await run(env, 'UPDATE users SET last_seen = ? WHERE id = ?', mxToday(), +r[1]); return json({ ok: true }); }
  if (m === 'GET' && p === '/locations') return json({ locations: await locations(env) });
  if (m === 'POST' && p === '/locations') return json(await saveLocation(env, null, await body()));
  if ((r = p.match(/^\/locations\/(\d+)$/)) && m === 'PUT') return json(await saveLocation(env, +r[1], await body()));
  if ((r = p.match(/^\/locations\/(\d+)$/)) && m === 'DELETE') return json(await deleteLocation(env, +r[1]));
  if (m === 'POST' && p === '/vessels/bulk') return json(await bulk(env, await body()));
  if (m === 'GET' && p === '/vessels/notes') return json({ notes: await all(env, 'SELECT * FROM vessel_notes WHERE vessel_id = ? ORDER BY noted_at DESC, id DESC', int(q('vessel'))) });
  return null;
}

export async function company(env) {
  return (await one(env, 'SELECT * FROM company WHERE id = 1')) || { id: 1, name: 'Dos Búhos' };
}
async function saveCompany(env, b) {
  const cur = await company(env);
  const f = { ...cur, ...Object.fromEntries(Object.entries(b).filter(([k]) => k in cur || ['name', 'appearance', 'profile', 'sugar_unit', 'production_mode', 'address', 'city', 'region', 'postal_code', 'tax_id', 'phone', 'email', 'vineyard_ha', 'lot_numbering', 'lot_pattern', 'advanced_modules', 'country', 'cleaning_four_eyes'].includes(k))) };
  await run(env, 'INSERT INTO company (id, name, appearance, profile, sugar_unit, production_mode, address, city, region, postal_code, tax_id, phone, email, vineyard_ha, lot_numbering, lot_pattern, advanced_modules, country, cleaning_four_eyes) VALUES (1,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, appearance = excluded.appearance, profile = excluded.profile, sugar_unit = excluded.sugar_unit, production_mode = excluded.production_mode, address = excluded.address, city = excluded.city, region = excluded.region, postal_code = excluded.postal_code, tax_id = excluded.tax_id, phone = excluded.phone, email = excluded.email, vineyard_ha = excluded.vineyard_ha, lot_numbering = excluded.lot_numbering, lot_pattern = excluded.lot_pattern, advanced_modules = excluded.advanced_modules, country = excluded.country, cleaning_four_eyes = excluded.cleaning_four_eyes',
    str(f.name) || 'Dos Búhos', ['light', 'dark', 'system'].includes(f.appearance) ? f.appearance : 'system', ['full', 'vineyard', 'winery'].includes(f.profile) ? f.profile : 'full', ['baume', 'brix', 'density'].includes(f.sugar_unit) ? f.sugar_unit : 'brix', str(f.production_mode), str(f.address), str(f.city), str(f.region), str(f.postal_code), str(f.tax_id), str(f.phone), str(f.email), num(f.vineyard_ha), f.lot_numbering === 'custom' ? 'custom' : 'standard', str(f.lot_pattern), bool(f.advanced_modules, 0), str(f.country) || 'MX', bool(f.cleaning_four_eyes, 0));
  return { ok: true };
}
async function saveUser(env, id, b) {
  const name = str(b.name) || str(b.email); if (!name) fail(400, 'Falta el nombre o el correo');
  const role = ['admin', 'technician', 'operator'].includes(b.role) ? b.role : 'operator';
  const area = ['company', 'vineyard', 'winery', 'both'].includes(b.area) ? b.area : 'company';
  const args = [name, str(b.initials) || name.split(/\s+/).map((w) => w[0]).join('').toUpperCase().slice(0, 3), role, bool(b.active, 1), str(b.email), area, str(b.applicator_cert), str(b.cert_expires), bool(b.login, 1)];
  if (id) { await run(env, 'UPDATE users SET name = ?, initials = ?, role = ?, active = ?, email = ?, area = ?, applicator_cert = ?, cert_expires = ?, login = ? WHERE id = ?', ...args, id); return { ok: true, id }; }
  const r = await run(env, 'INSERT INTO users (name, initials, role, active, email, area, applicator_cert, cert_expires, login) VALUES (?,?,?,?,?,?,?,?,?)', ...args);
  return { ok: true, id: r.meta.last_row_id };
}
export async function locations(env) {
  const rows = await all(env, 'SELECT l.*, (SELECT COUNT(*) FROM vessels v WHERE v.location_id = l.id) AS vessels FROM locations l ORDER BY l.sort, l.name');
  const byId = Object.fromEntries(rows.map((l) => [l.id, l]));
  const path = (l) => { const parts = []; let cur = l; let guard = 0; while (cur && guard++ < 10) { parts.unshift(cur.name); cur = cur.parent_id ? byId[cur.parent_id] : null; } return parts.join(' › '); };
  return rows.map((l) => ({ ...l, path: path(l), depth: path(l).split(' › ').length - 1 }));
}
async function saveLocation(env, id, b) {
  const name = str(b.name); if (!name) fail(400, 'Falta el nombre');
  const kind = ['building', 'room', 'row', 'shelf'].includes(b.kind) ? b.kind : 'room';
  const parent_id = int(b.parent_id);
  if (parent_id && parent_id === id) fail(400, 'Una ubicación no puede estar dentro de sí misma');
  if (id) { await run(env, 'UPDATE locations SET name = ?, kind = ?, parent_id = ?, room = ?, sort = COALESCE(?, sort) WHERE id = ?', name, kind, parent_id, str(b.room), int(b.sort), id); return { ok: true, id }; }
  const r = await run(env, 'INSERT INTO locations (name, kind, parent_id, room, sort) VALUES (?,?,?,?,?)', name, kind, parent_id, str(b.room), int(b.sort) || 0);
  return { ok: true, id: r.meta.last_row_id };
}
async function deleteLocation(env, id) {
  const kids = await one(env, 'SELECT COUNT(*) AS n FROM locations WHERE parent_id = ?', id);
  if (kids.n) fail(409, 'Primero mueve o elimina las ubicaciones que contiene');
  await env.DB.batch([env.DB.prepare('UPDATE vessels SET location_id = NULL WHERE location_id = ?').bind(id), env.DB.prepare('DELETE FROM locations WHERE id = ?').bind(id)]);
  return { ok: true };
}
// Acciones en lote sobre recipientes seleccionados: ubicación, estado de barrica, limpieza, OT de mantenimiento, llenado manual, nota
async function bulk(env, b) {
  const ids = (Array.isArray(b.ids) ? b.ids : []).map(Number).filter(Boolean); if (!ids.length) fail(400, 'Selecciona recipientes');
  const action = str(b.action); const today = mxToday(); const stmts = [];
  switch (action) {
    case 'location': { const loc = int(b.location_id); stmts.push(...ids.map((id) => env.DB.prepare("UPDATE vessels SET location_id = ?, updated_at = datetime('now') WHERE id = ?").bind(loc, id))); break; }
    case 'status': { const st = ['available', 'full', 'empty', 'cleaning', 'maintenance', 'inactive'].includes(b.status) ? b.status : fail(400, 'Estado inválido'); stmts.push(...ids.map((id) => env.DB.prepare("UPDATE vessels SET barrel_status = ?, is_active = CASE WHEN ? = 'inactive' THEN 0 ELSE is_active END, updated_at = datetime('now') WHERE id = ?").bind(st, st, id))); break; }
    case 'cleaning': stmts.push(...ids.map((id) => env.DB.prepare('INSERT INTO cleaning_records (vessel_id, cleaned_at, by_name, method, notes) VALUES (?,?,?,?,?)').bind(id, str(b.date) || today, str(b.by_name), str(b.method), str(b.notes)))); break;
    case 'maintenance': stmts.push(...ids.map((id) => env.DB.prepare("INSERT INTO vessel_notes (vessel_id, noted_at, kind, text, by_name) VALUES (?, ?, 'maintenance', ?, ?)").bind(id, today, str(b.text) || 'OT de mantenimiento', str(b.by_name)))); stmts.push(...ids.map((id) => env.DB.prepare("UPDATE vessels SET barrel_status = 'maintenance' WHERE id = ? AND kind IN ('barrel','foudre')").bind(id))); break;
    case 'fill': stmts.push(...ids.map((id) => env.DB.prepare('UPDATE vessels SET fill_count = fill_count + 1 WHERE id = ?').bind(id))); stmts.push(...ids.map((id) => env.DB.prepare("INSERT INTO vessel_notes (vessel_id, noted_at, kind, text, by_name) VALUES (?, ?, 'fill', ?, ?)").bind(id, str(b.date) || today, str(b.text) || 'Llenado registrado a mano', str(b.by_name)))); break;
    case 'note': { const text = str(b.text); if (!text) fail(400, 'Escribe la nota'); stmts.push(...ids.map((id) => env.DB.prepare("INSERT INTO vessel_notes (vessel_id, noted_at, kind, text, by_name) VALUES (?, ?, 'note', ?, ?)").bind(id, today, text, str(b.by_name)))); break; }
    default: fail(400, 'Acción desconocida');
  }
  await env.DB.batch(stmts);
  return { ok: true, count: ids.length };
}
