// Lista de compras (insumos que hacen falta) y banco de semillas (qué hay y cuánto queda). Los mantiene Adrián desde
// la app; Eric, Melanie y Claude los ven y editan por el conector.
import { CROPS, STOCK } from './plan.js';
import { livePlan } from './planstore.js';

const NIVELES = ['mucho', 'medio', 'poco', 'agotado'];
let ready = false;
async function ensure(env) {
  if (ready) return;
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS lista (id INTEGER PRIMARY KEY AUTOINCREMENT, item TEXT NOT NULL, cantidad TEXT, nota TEXT, estado TEXT NOT NULL DEFAULT 'pendiente', quien TEXT, at TEXT NOT NULL DEFAULT (datetime('now')), hecho_at TEXT)").run();
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS banco (id INTEGER PRIMARY KEY AUTOINCREMENT, cultivo TEXT, nombre TEXT NOT NULL, cantidad TEXT, nivel TEXT NOT NULL DEFAULT 'medio', nota TEXT, at TEXT NOT NULL DEFAULT (datetime('now')))").run();
  ready = true;
}

export function cropKeyOf(name, extra) {
  const low = String(name || '').trim().toLowerCase(); if (!low) return null;
  const all = Object.assign({}, CROPS, extra || {});
  for (const [k, c] of Object.entries(all)) if (k === low || (c.n || '').toLowerCase() === low) return k;
  for (const [k, c] of Object.entries(all)) if ((c.n || '').toLowerCase().split(/[ (]/)[0] === low.split(/[ (]/)[0]) return k;
  return null;
}

// ---------- lista de compras ----------
export async function listShopping(env, all) {
  await ensure(env);
  const { results } = await env.DB.prepare(all ? "SELECT * FROM lista ORDER BY estado = 'comprado', id DESC LIMIT 200" : "SELECT * FROM lista WHERE estado = 'pendiente' OR hecho_at > datetime('now','-14 days') ORDER BY estado = 'comprado', id DESC").all();
  return results.map(r => Object.assign(r, { id: String(r.id) }));
}
export async function editShopping(env, b, quien) {
  await ensure(env);
  const id = Number(b.id);
  if (b.accion === 'agregar') {
    const item = String(b.item || '').trim().slice(0, 80); if (!item) return { error: 'Falta qué comprar' };
    const r = await env.DB.prepare('INSERT INTO lista (item, cantidad, nota, quien) VALUES (?,?,?,?)').bind(item, String(b.cantidad || '').slice(0, 40), String(b.nota || '').slice(0, 120), String(quien || '').slice(0, 40)).run();
    return { ok: true, id: String(r.meta.last_row_id), item };
  }
  if (!id) return { error: 'Falta id' };
  if (b.accion === 'comprado') { await env.DB.prepare("UPDATE lista SET estado='comprado', hecho_at=datetime('now') WHERE id=?").bind(id).run(); return { ok: true }; }
  if (b.accion === 'pendiente') { await env.DB.prepare("UPDATE lista SET estado='pendiente', hecho_at=NULL WHERE id=?").bind(id).run(); return { ok: true }; }
  if (b.accion === 'quitar') { await env.DB.prepare('DELETE FROM lista WHERE id=?').bind(id).run(); return { ok: true }; }
  return { error: 'accion: agregar, comprado, pendiente o quitar' };
}

// ---------- banco de semillas ----------
export async function listBank(env) {
  await ensure(env);
  let { results } = await env.DB.prepare('SELECT * FROM banco ORDER BY nombre').all();
  if (!results.length) { // primera vez: arranca con lo que dice el plan
    const live = await livePlan(env);
    const sem = (live && live.data && live.data.semillas) || STOCK;
    for (const [k, txt] of Object.entries(sem)) {
      const c = CROPS[k] || (live && live.data.cultivos || {})[k];
      const t = String(txt).trim(), cant = c && t.toLowerCase() === c.n.toLowerCase() ? '' : t;
      await env.DB.prepare('INSERT INTO banco (cultivo, nombre, cantidad, nivel, nota) VALUES (?,?,?,?,?)').bind(k, c ? c.n : k, cant.slice(0, 80), 'medio', 'Por confirmar').run();
    }
    ({ results } = await env.DB.prepare('SELECT * FROM banco ORDER BY nombre').all());
  }
  return results.map(r => Object.assign(r, { id: String(r.id) }));
}
export async function editBank(env, b) {
  await ensure(env);
  const id = Number(b.id);
  if (b.accion === 'quitar') { if (!id) return { error: 'Falta id' }; await env.DB.prepare('DELETE FROM banco WHERE id=?').bind(id).run(); return { ok: true }; }
  if (b.nivel !== undefined && !NIVELES.includes(b.nivel)) return { error: 'nivel: mucho, medio, poco o agotado' };
  if (b.accion === 'agregar') {
    const nombre = String(b.nombre || '').trim().slice(0, 60); if (!nombre) return { error: 'Falta la semilla' };
    const live = await livePlan(env);
    const k = cropKeyOf(nombre, live && live.data.cultivos);
    const r = await env.DB.prepare('INSERT INTO banco (cultivo, nombre, cantidad, nivel, nota) VALUES (?,?,?,?,?)').bind(k, k && CROPS[k] ? CROPS[k].n : nombre, String(b.cantidad || '').slice(0, 80), b.nivel || 'medio', String(b.nota || '').slice(0, 120)).run();
    return { ok: true, id: String(r.meta.last_row_id) };
  }
  if (b.accion === 'actualizar') {
    if (!id) return { error: 'Falta id' };
    const cur = await env.DB.prepare('SELECT * FROM banco WHERE id=?').bind(id).first(); if (!cur) return { error: 'No existe' };
    await env.DB.prepare("UPDATE banco SET cantidad=?, nivel=?, nota=?, at=datetime('now') WHERE id=?").bind(b.cantidad !== undefined ? String(b.cantidad).slice(0, 80) : cur.cantidad, b.nivel || cur.nivel, b.nota !== undefined ? String(b.nota).slice(0, 120) : cur.nota, id).run();
    return { ok: true };
  }
  return { error: 'accion: agregar, actualizar o quitar' };
}
// Semilla disponible por cultivo (lo que no está agotado), para la lista de semilla del plan.
export function bankToStock(rows) {
  const out = {};
  for (const r of rows) if (r.cultivo && r.nivel !== 'agotado') out[r.cultivo] = r.nombre + (r.cantidad ? ' · ' + r.cantidad : '') + (r.nivel === 'poco' ? ' (queda poco)' : '');
  return out;
}
