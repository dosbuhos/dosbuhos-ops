// Inventario: resumen unificado, lotes físicos de productos enológicos (FEFO, caducidad, cuarentena, recuento), entradas.
import { fail, json, num, int, str, dateOk, mxToday, all, one, run } from './lib.js';

export async function route({ m, p, env, body, q }) {
  let r;
  if (m === 'GET' && p === '/inventory') return json(await summary(env));
  if (m === 'GET' && p === '/product-batches') return json({ batches: await batches(env) });
  if (m === 'POST' && p === '/product-batches') return json(await receive(env, await body()));
  if ((r = p.match(/^\/product-batches\/(\d+)\/status$/)) && m === 'POST') return json(await setStatus(env, +r[1], await body()));
  if ((r = p.match(/^\/product-batches\/(\d+)\/count$/)) && m === 'POST') return json(await physicalCount(env, +r[1], await body()));
  if (m === 'GET' && p === '/product-batches/fefo-audit') return json(await fefoAudit(env));
  return null;
}

export async function batches(env) {
  const today = mxToday();
  const rows = await all(env, `SELECT pb.*, pr.name AS product_name, pr.code AS product_code, pr.unit, pr.category FROM product_batches pb JOIN products pr ON pr.id = pb.product_id ORDER BY pb.status = 'active' DESC, COALESCE(pb.expires_at, '9999') ASC, pb.received_at ASC`);
  return rows.map((b) => {
    const days = b.expires_at ? Math.round((Date.parse(b.expires_at) - Date.parse(today)) / 864e5) : null;
    return { ...b, days_to_expiry: days, expiry_state: days == null ? 'ok' : days < 0 ? 'expired' : days <= 30 ? 'soon30' : days <= 90 ? 'soon90' : 'ok' };
  });
}
// Orden FEFO por producto: el lote activo con caducidad más próxima va primero
export function fefoRank(list) {
  const byProduct = {};
  for (const b of list.filter((x) => x.status === 'active' && x.qty_available > 0).sort((a, c) => (a.expires_at || '9999').localeCompare(c.expires_at || '9999') || a.received_at.localeCompare(c.received_at))) {
    byProduct[b.product_id] = (byProduct[b.product_id] || 0) + 1; b.fefo = byProduct[b.product_id];
  }
  return list;
}
async function summary(env) {
  const [bulk, bottled, prods, bs] = await Promise.all([
    all(env, `SELECT lo.id, lo.code, lo.wine_type, lo.vintage, lo.varieties, lo.phase, COALESCE(SUM(CASE WHEN s.unit = 'L' THEN s.volume ELSE 0 END), 0) AS liters, COALESCE(SUM(CASE WHEN s.unit = 'kg' THEN s.volume ELSE 0 END), 0) AS kg, GROUP_CONCAT(v.code, ', ') AS vessels FROM lots lo JOIN stays s ON s.lot_id = lo.id AND s.left_at IS NULL JOIN vessels v ON v.id = s.vessel_id WHERE lo.status = 'active' GROUP BY lo.id ORDER BY liters DESC`),
    all(env, `SELECT fp.id, fp.code, fp.name, fp.category, fp.vintage, COALESCE(SUM(bs.bottles_available), 0) AS bottles, COUNT(bs.id) AS sessions, MAX(bs.bottled_at) AS last_bottled FROM finished_products fp LEFT JOIN bottling_sessions bs ON bs.product_id = fp.id WHERE fp.is_active = 1 GROUP BY fp.id ORDER BY bottles DESC`),
    all(env, `SELECT pr.*, COALESCE(SUM(CASE WHEN pb.status = 'active' THEN pb.qty_available ELSE 0 END), 0) AS stock, COUNT(pb.id) AS batches FROM products pr LEFT JOIN product_batches pb ON pb.product_id = pr.id GROUP BY pr.id ORDER BY pr.category, pr.name`),
    all(env, "SELECT stage, COALESCE(SUM(bottles_available), 0) AS bottles, COUNT(*) AS n FROM bottling_sessions GROUP BY stage"),
  ]);
  const prepack = bs.filter((x) => x.stage !== 'packed').reduce((a, x) => a + x.bottles, 0);
  return { bulk, bottled, consumables: prods, stages: bs, kpi: { bulk_l: Math.round(bulk.reduce((a, x) => a + x.liters, 0)), bulk_lots: bulk.length, prepack_bottles: prepack, prepack_l: Math.round(prepack * 0.75), finished_bottles: bottled.reduce((a, x) => a + x.bottles, 0), skus: bottled.length, consumables: prods.length, low_stock: prods.filter((x) => x.min_stock != null && x.stock < x.min_stock).length } };
}
async function receive(env, b) {
  const product_id = int(b.product_id); if (!product_id) fail(400, 'Indica el producto');
  const supplier_lot = str(b.supplier_lot); if (!supplier_lot) fail(400, 'Falta el lote del proveedor');
  const received_at = str(b.received_at) || mxToday(); if (!dateOk(received_at)) fail(400, 'Fecha de recepción inválida');
  const expires_at = str(b.expires_at); if (expires_at && !dateOk(expires_at)) fail(400, 'Fecha de caducidad inválida');
  const qty = num(b.qty); if (!qty || qty <= 0) fail(400, 'Cantidad inválida');
  const r = await run(env, 'INSERT INTO product_batches (product_id, supplier_lot, supplier, received_at, expires_at, qty_initial, qty_available, unit_cost, invoice_no, status, notes) VALUES (?,?,?,?,?,?,?,?,?,?,?)', product_id, supplier_lot, str(b.supplier), received_at, expires_at, qty, qty, num(b.unit_cost), str(b.invoice_no), 'active', str(b.notes));
  await run(env, "INSERT INTO product_movements (batch_id, moved_at, qty, reason, notes) VALUES (?, ?, ?, 'receipt', ?)", r.meta.last_row_id, received_at, qty, str(b.invoice_no));
  return { ok: true, id: r.meta.last_row_id };
}
async function setStatus(env, id, b) {
  const status = ['active', 'quarantine', 'withdrawn', 'discarded', 'depleted'].includes(b.status) ? b.status : fail(400, 'Estado inválido');
  const cur = await one(env, 'SELECT * FROM product_batches WHERE id = ?', id); if (!cur) fail(404, 'Lote no encontrado');
  const stmts = [env.DB.prepare('UPDATE product_batches SET status = ?, notes = COALESCE(?, notes) WHERE id = ?').bind(status, str(b.notes), id)];
  if (status === 'discarded' && cur.qty_available > 0) { stmts.push(env.DB.prepare("INSERT INTO product_movements (batch_id, moved_at, qty, reason, notes) VALUES (?, ?, ?, 'discard', ?)").bind(id, mxToday(), -cur.qty_available, str(b.notes))); stmts.push(env.DB.prepare('UPDATE product_batches SET qty_available = 0 WHERE id = ?').bind(id)); }
  await env.DB.batch(stmts);
  return { ok: true };
}
async function physicalCount(env, id, b) {
  const counted = num(b.qty); if (counted == null || counted < 0) fail(400, 'Cantidad inválida');
  const cur = await one(env, 'SELECT * FROM product_batches WHERE id = ?', id); if (!cur) fail(404, 'Lote no encontrado');
  const diff = Math.round((counted - cur.qty_available) * 1000) / 1000;
  await env.DB.batch([
    env.DB.prepare("INSERT INTO product_movements (batch_id, moved_at, qty, reason, notes) VALUES (?, ?, ?, 'count', ?)").bind(id, mxToday(), diff, str(b.notes) || `Recuento físico: ${counted}`),
    env.DB.prepare("UPDATE product_batches SET qty_available = ?, status = CASE WHEN ? <= 0 AND status = 'active' THEN 'depleted' ELSE status END WHERE id = ?").bind(counted, counted, id),
  ]);
  return { ok: true, diff };
}
// Consumo FEFO desde una adición: resta de los lotes activos del producto por caducidad ascendente. Devuelve sentencias y los lotes usados.
export async function fefoConsume(env, product_id, qty, opId, date) {
  const list = (await all(env, "SELECT * FROM product_batches WHERE product_id = ? AND status = 'active' AND qty_available > 0 ORDER BY COALESCE(expires_at, '9999') ASC, received_at ASC", product_id));
  const stmts = [], used = []; let left = qty;
  for (const b of list) {
    if (left <= 0) break;
    const take = Math.min(left, b.qty_available); left = Math.round((left - take) * 1000) / 1000;
    const after = Math.round((b.qty_available - take) * 1000) / 1000;
    stmts.push(env.DB.prepare("UPDATE product_batches SET qty_available = ?, status = CASE WHEN ? <= 0 THEN 'depleted' ELSE status END WHERE id = ?").bind(after, after, b.id));
    stmts.push(env.DB.prepare("INSERT INTO product_movements (batch_id, moved_at, qty, reason, operation_id) VALUES (?, ?, ?, 'addition', ?)").bind(b.id, date, -take, opId));
    used.push({ batch_id: b.id, supplier_lot: b.supplier_lot, qty: take });
  }
  return { stmts, used, short: left > 0 ? left : 0 };
}
// Auditoría FEFO: adiciones que consumieron un lote más nuevo habiendo otro más próximo a caducar
async function fefoAudit(env) {
  const mv = await all(env, "SELECT pm.*, pb.product_id, pb.supplier_lot, pb.expires_at, pr.name AS product_name FROM product_movements pm JOIN product_batches pb ON pb.id = pm.batch_id JOIN products pr ON pr.id = pb.product_id WHERE pm.reason = 'addition' ORDER BY pm.moved_at DESC LIMIT 300");
  const allB = await all(env, 'SELECT * FROM product_batches');
  const issues = [];
  for (const m of mv) {
    const older = allB.filter((b) => b.product_id === m.product_id && b.id !== m.batch_id && b.received_at <= m.moved_at && b.expires_at && m.expires_at && b.expires_at < m.expires_at && b.status === 'active');
    if (older.length) issues.push({ ...m, should_have: older.map((b) => b.supplier_lot).join(', ') });
  }
  return { movements: mv.length, issues };
}
