// Embotellado: productos terminados y sesiones de embotellado (llenado → etiquetado → embalaje).
import { fail, json, num, int, str, bool, dateOk, mxToday, all, one, run } from './lib.js';
import { vesselsWithStays } from './core.js';

export async function route({ m, p, env, body, q }) {
  let r;
  if (m === 'GET' && p === '/finished-products') return json({ products: await finishedProducts(env) });
  if (m === 'POST' && p === '/finished-products') return json(await saveProduct(env, null, await body()));
  if (m === 'POST' && p === '/finished-products/import') return json(await importProducts(env, await body()));
  if ((r = p.match(/^\/finished-products\/(\d+)$/)) && m === 'PUT') return json(await saveProduct(env, +r[1], await body()));
  if (m === 'GET' && p === '/bottling') return json({ sessions: await sessions(env, { product: int(q('product')), year: int(q('year')), stage: str(q('stage')) }) });
  if (m === 'POST' && p === '/bottling') return json(await createSession(env, await body()));
  if ((r = p.match(/^\/bottling\/(\d+)\/stage$/)) && m === 'POST') return json(await setStage(env, +r[1], await body()));
  if ((r = p.match(/^\/bottling\/(\d+)$/)) && m === 'DELETE') return json(await revertSession(env, +r[1]));
  return null;
}

async function finishedProducts(env) {
  return all(env, `SELECT fp.*, COALESCE(SUM(bs.bottles_available), 0) AS bottles, COUNT(bs.id) AS sessions FROM finished_products fp LEFT JOIN bottling_sessions bs ON bs.product_id = fp.id GROUP BY fp.id ORDER BY fp.is_active DESC, fp.name`);
}
function productFields(b) {
  const code = str(b.code); if (!code) fail(400, 'Falta el código');
  const name = str(b.name); if (!name) fail(400, 'Falta el nombre');
  return { code, name, category: str(b.category), vintage: int(b.vintage), variety: str(b.variety), bottle_ml: int(b.bottle_ml), notes: str(b.notes), is_active: bool(b.is_active, 1) };
}
async function saveProduct(env, id, b) {
  const f = productFields(id ? { ...(await one(env, 'SELECT * FROM finished_products WHERE id = ?', id)), ...b } : b);
  if (await one(env, 'SELECT id FROM finished_products WHERE code = ? AND id <> ?', f.code, id || 0)) fail(409, `Ya existe el producto ${f.code}`);
  if (id) { await run(env, 'UPDATE finished_products SET code = ?, name = ?, category = ?, vintage = ?, variety = ?, bottle_ml = ?, notes = ?, is_active = ? WHERE id = ?', f.code, f.name, f.category, f.vintage, f.variety, f.bottle_ml, f.notes, f.is_active, id); return { ok: true, id }; }
  const r = await run(env, 'INSERT INTO finished_products (code, name, category, vintage, variety, bottle_ml, notes, is_active) VALUES (?,?,?,?,?,?,?,?)', f.code, f.name, f.category, f.vintage, f.variety, f.bottle_ml, f.notes, f.is_active);
  return { ok: true, id: r.meta.last_row_id };
}
async function importProducts(env, b) {
  const rows = Array.isArray(b.rows) ? b.rows : fail(400, 'Faltan filas');
  const fields = rows.map((r) => productFields({ code: r.code || r.codigo, name: r.name || r.nombre, category: r.category || r.categoria, vintage: r.vintage || r.anada || r.añada, variety: r.variety || r.variedad, bottle_ml: r.bottle_ml || r.formato, notes: r.notes || r.notas }));
  const codes = fields.map((f) => f.code);
  const existing = (await all(env, `SELECT code FROM finished_products WHERE code IN (${codes.map(() => '?').join(',')})`, ...codes)).map((r) => r.code);
  const ins = fields.filter((f) => !existing.includes(f.code));
  if (ins.length) await env.DB.batch(ins.map((f) => env.DB.prepare('INSERT INTO finished_products (code, name, category, vintage, variety, bottle_ml, notes, is_active) VALUES (?,?,?,?,?,?,?,?)').bind(f.code, f.name, f.category, f.vintage, f.variety, f.bottle_ml, f.notes, f.is_active)));
  return { ok: true, created: ins.length, skipped: existing };
}

async function sessions(env, f) {
  const where = [], args = [];
  if (f.product) { where.push('bs.product_id = ?'); args.push(f.product); }
  if (f.year) { where.push('substr(bs.bottled_at, 1, 4) = ?'); args.push(String(f.year)); }
  if (f.stage) { where.push('bs.stage = ?'); args.push(f.stage); }
  return all(env, `SELECT bs.*, fp.code AS product_code, fp.name AS product_name, v.code AS vessel_code FROM bottling_sessions bs JOIN finished_products fp ON fp.id = bs.product_id LEFT JOIN vessels v ON v.id = bs.vessel_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY bs.bottled_at DESC, bs.id DESC`, ...args);
}
// Una sesión saca litros del depósito (cierra o reduce la estancia) y crea existencias de producto terminado.
async function createSession(env, b) {
  const product_id = int(b.product_id); if (!product_id) fail(400, 'Indica el producto terminado');
  const d = str(b.bottled_at) || mxToday(); if (!dateOk(d)) fail(400, 'Fecha inválida');
  const bottles = int(b.bottles); if (!bottles || bottles <= 0) fail(400, 'Indica las botellas llenadas');
  const bottle_ml = int(b.bottle_ml) || 750;
  // Saldo de apertura de botellas: sin depósito ni operación, solo existencias (etapa embalaje).
  if (bool(b.opening, 0)) {
    const prod = await one(env, 'SELECT * FROM finished_products WHERE id = ?', product_id); if (!prod) fail(404, 'Producto no encontrado');
    const r = await run(env, "INSERT INTO bottling_sessions (product_id, lot_code, source_lot_id, vessel_id, bottled_at, volume_l, bottle_ml, bottles, cases, bottles_per_case, operator_name, stage, labelled_at, packed_at, bottles_available, operation_id, notes) VALUES (?,?,NULL,NULL,?,?,?,?,?,?,?,'packed',?,?,?,NULL,?)",
      product_id, str(b.lot_code) || `${prod.code}-SA`, d, Math.round(bottles * bottle_ml) / 1000, bottle_ml, bottles, int(b.cases), int(b.bottles_per_case), str(b.operator_name), d, d, bottles, str(b.notes) || 'Saldo de apertura');
    return { ok: true, id: r.meta.last_row_id, opening: true };
  }
  const vessel_id = int(b.vessel_id); if (!vessel_id) fail(400, 'Indica el depósito de vino');
  const volume = num(b.volume_l); if (!volume || volume <= 0) fail(400, 'Volumen inválido');
  const v = (await vesselsWithStays(env)).find((x) => x.id === vessel_id);
  if (!v || !v.stay_id) fail(400, 'Ese depósito no tiene vino');
  if (v.stay_unit !== 'L') fail(400, 'Ese depósito está en maceración (kg)');
  if (volume > v.stay_volume + 0.5) fail(400, `${v.code} solo tiene ${v.stay_volume} L`);
  const lot_code = str(b.lot_code) || v.lot_code;
  const left = Math.round((v.stay_volume - volume) * 10) / 10;
  const stmts = [];
  const op = await run(env, "INSERT INTO operations (type, op_date, operator_name, status, volume_l, notes, confirmed_at) VALUES ('bottling', ?, ?, 'confirmed', ?, ?, datetime('now'))", d, str(b.operator_name), volume, str(b.notes));
  const opId = op.meta.last_row_id;
  stmts.push(env.DB.prepare("INSERT INTO operation_lines (operation_id, side, vessel_id, lot_id, volume, sort) VALUES (?, 'origin', ?, ?, ?, 0)").bind(opId, vessel_id, v.lot_id, volume));
  if (left < 0.5) stmts.push(env.DB.prepare('UPDATE stays SET volume = 0, left_at = ?, volume_out = ?, closed_by_op = ? WHERE id = ?').bind(d, v.stay_volume, opId, v.stay_id));
  else stmts.push(env.DB.prepare('UPDATE stays SET volume = ? WHERE id = ?').bind(left, v.stay_id));
  stmts.push(env.DB.prepare("UPDATE operations SET undo = ? WHERE id = ?").bind(JSON.stringify({ stays: [{ id: v.stay_id, volume: v.stay_volume, left_at: null, volume_out: null, closed_by_op: null }], fills: [], lots: [] }), opId));
  stmts.push(env.DB.prepare('INSERT INTO bottling_sessions (product_id, lot_code, source_lot_id, vessel_id, bottled_at, volume_l, bottle_ml, bottles, cases, bottles_per_case, operator_name, stage, bottles_available, operation_id, notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .bind(product_id, lot_code, v.lot_id, vessel_id, d, volume, bottle_ml, bottles, int(b.cases), int(b.bottles_per_case), str(b.operator_name), 'filled', bottles, opId, str(b.notes)));
  await env.DB.batch(stmts);
  return { ok: true, operation_id: opId };
}
async function setStage(env, id, b) {
  const stage = ['filled', 'labelled', 'packed'].includes(b.stage) ? b.stage : fail(400, 'Etapa inválida');
  const col = stage === 'labelled' ? 'labelled_at' : stage === 'packed' ? 'packed_at' : null;
  await run(env, `UPDATE bottling_sessions SET stage = ?${col ? `, ${col} = ?` : ''} WHERE id = ?`, stage, ...(col ? [mxToday()] : []), id);
  return { ok: true };
}
async function revertSession(env, id) {
  const s = await one(env, 'SELECT * FROM bottling_sessions WHERE id = ?', id); if (!s) fail(404, 'Sesión no encontrada');
  const op = s.operation_id ? await one(env, 'SELECT * FROM operations WHERE id = ?', s.operation_id) : null;
  const stmts = [env.DB.prepare('DELETE FROM bottling_sessions WHERE id = ?').bind(id)];
  if (op && op.status === 'confirmed') {
    const later = await one(env, "SELECT o.id FROM operations o JOIN operation_lines ol ON ol.operation_id = o.id WHERE o.status = 'confirmed' AND o.id > ? AND ol.vessel_id = ?", op.id, s.vessel_id);
    if (later) fail(409, 'El depósito tuvo operaciones posteriores; revierte esas primero');
    const undo = op.undo ? JSON.parse(op.undo) : { stays: [] };
    for (const st of undo.stays) stmts.push(env.DB.prepare('UPDATE stays SET volume = ?, left_at = ?, volume_out = ?, closed_by_op = ? WHERE id = ?').bind(st.volume, st.left_at, st.volume_out, st.closed_by_op, st.id));
    stmts.push(env.DB.prepare("UPDATE operations SET status = 'reverted', reverted_at = datetime('now') WHERE id = ?").bind(op.id));
  }
  await env.DB.batch(stmts);
  return { ok: true };
}
