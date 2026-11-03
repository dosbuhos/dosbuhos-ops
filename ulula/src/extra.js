// Módulos avanzados (paridad GrapeFlow): alertas, conciliación de volúmenes, registro de limpieza, parcelas de uva comprada,
// materiales secos, equipos, operarios sin acceso, claves de API y la API de solo lectura /api/v1.
import { fail, json, num, int, str, bool, dateOk, mxToday, all, one, run } from './lib.js';
import { vesselsWithStays } from './core.js';
import { qrSvg } from './qr.js';

export const ALERT_DEFAULTS = { analysis_days: 30, expiry_days: 30, min_fill_pct: 98, clean_window_days: 90, maintenance_days: 7, ferment_enabled: 1, temp_min: 12, temp_max: 30, brix_drop_min: 0.5, stale_days: 2, nutrient_open_pct: 33, nutrient_close_pct: 66, high_sugar_brix: 25, yan_base: 150, yan_ref_alc: 12, yan_per_alc: 10 };
export async function alertSettings(env) {
  const c = await one(env, 'SELECT alerts FROM company WHERE id = 1').catch(() => null);
  let a = {}; try { a = c?.alerts ? JSON.parse(c.alerts) : {}; } catch { a = {}; }
  return { ...ALERT_DEFAULTS, ...a };
}

export async function route({ m, p, env, body, q, request }) {
  let r;
  if (m === 'GET' && p === '/alerts') return json({ alerts: await alertSettings(env), defaults: ALERT_DEFAULTS });
  if (m === 'PUT' && p === '/alerts') { const b = await body(); const cur = await alertSettings(env); const next = {}; for (const k of Object.keys(ALERT_DEFAULTS)) next[k] = b[k] == null || b[k] === '' ? cur[k] : (k === 'ferment_enabled' ? bool(b[k], 1) : num(b[k]) ?? cur[k]); await run(env, 'UPDATE company SET alerts = ? WHERE id = 1', JSON.stringify(next)); return json({ ok: true, alerts: next }); }
  // Conciliación de volúmenes
  if (m === 'GET' && p === '/reconciliations') return json(await reconciliations(env));
  if (m === 'POST' && p === '/reconciliations') return json(await measure(env, await body()));
  if (m === 'PUT' && p === '/reconciliations/settings') { const b = await body(); await run(env, 'UPDATE company SET reconcile_tolerance_pct = ?, reconcile_self_approve = ? WHERE id = 1', num(b.tolerance_pct) ?? 0, bool(b.self_approve, 0)); return json({ ok: true }); }
  if ((r = p.match(/^\/reconciliations\/(\d+)\/(approve|reject)$/)) && m === 'POST') return json(await decide(env, +r[1], r[2], await body()));
  // Registro de limpieza
  if (m === 'GET' && p === '/cleanings') return json({ records: await cleanings(env, q) });
  if (m === 'POST' && p === '/cleanings/batch') return json(await batchCleaning(env, await body()));
  if ((r = p.match(/^\/cleanings\/(\d+)\/verify$/)) && m === 'POST') { const b = await body(); await run(env, "UPDATE cleaning_records SET status = 'verified', verified_by = ?, verified_at = ? WHERE id = ?", str(b.by_name) || 'verificado', mxToday(), +r[1]); return json({ ok: true }); }
  // Parcelas de uva comprada
  if (m === 'GET' && p === '/supplier-blocks') return json({ blocks: await all(env, 'SELECT * FROM supplier_blocks ORDER BY is_active DESC, supplier, name') });
  if (m === 'POST' && p === '/supplier-blocks') return json(await saveBlock(env, null, await body()));
  if ((r = p.match(/^\/supplier-blocks\/(\d+)$/)) && m === 'PUT') return json(await saveBlock(env, +r[1], await body()));
  // Equipos
  if ((r = p.match(/^\/equipment\/(\d+)\/qr\.svg$/)) && m === 'GET') { const e = await one(env, 'SELECT code, name FROM equipment WHERE id = ?', +r[1]); if (!e) fail(404, 'Equipo no encontrado'); return new Response(qrSvg(`${new URL(request.url).origin}/#/equipos?q=${encodeURIComponent(e.code)}`, { label: `QR ${e.code}` }), { headers: { 'content-type': 'image/svg+xml; charset=utf-8', 'cache-control': 'public, max-age=86400' } }); }
  if (m === 'GET' && p === '/equipment') return json({ equipment: await all(env, 'SELECT e.*, l.name AS location_name FROM equipment e LEFT JOIN locations l ON l.id = e.location_id ORDER BY e.is_active DESC, e.code') });
  if (m === 'POST' && p === '/equipment') return json(await saveEquipment(env, null, await body()));
  if ((r = p.match(/^\/equipment\/(\d+)$/)) && m === 'PUT') return json(await saveEquipment(env, +r[1], await body()));
  // Materiales secos
  if (m === 'GET' && p === '/packaging') return json({ materials: await materials(env) });
  if (m === 'POST' && p === '/packaging') return json(await saveMaterial(env, null, await body()));
  if (m === 'POST' && p === '/packaging/import') return json(await importMaterials(env, await body()));
  if ((r = p.match(/^\/packaging\/(\d+)$/)) && m === 'PUT') return json(await saveMaterial(env, +r[1], await body()));
  if (m === 'GET' && p === '/packaging/moves') return json({ moves: await all(env, 'SELECT pm.*, m.name AS material_name, m.code AS material_code, m.unit FROM packaging_moves pm JOIN packaging_materials m ON m.id = pm.material_id ORDER BY pm.moved_at DESC, pm.id DESC LIMIT 300') });
  if (m === 'POST' && p === '/packaging/moves') return json(await addMove(env, await body()));
  // Operarios sin acceso
  if (m === 'POST' && p === '/operators') { const b = await body(); const name = str(b.name); if (!name) fail(400, 'Falta el nombre'); const rr = await run(env, "INSERT INTO users (name, initials, role, active, area, login, applicator_cert, cert_expires) VALUES (?,?,'operator',1,?,0,?,?)", name, str(b.initials) || name.split(/\s+/).map((w) => w[0]).join('').toUpperCase().slice(0, 3), ['company', 'vineyard', 'winery', 'both'].includes(b.area) ? b.area : 'company', str(b.applicator_cert), str(b.cert_expires)); return json({ ok: true, id: rr.meta.last_row_id }); }
  // Claves de API
  if (m === 'GET' && p === '/api-keys') return json({ keys: (await all(env, 'SELECT id, name, key, created_at, last_used, is_active FROM api_keys ORDER BY id DESC')).map((k) => ({ ...k, key: k.key.slice(0, 8) + '…' })) });
  if (m === 'POST' && p === '/api-keys') { const b = await body(); const name = str(b.name); if (!name) fail(400, 'Falta el nombre de la clave'); const key = 'ulk_' + [...crypto.getRandomValues(new Uint8Array(24))].map((x) => x.toString(16).padStart(2, '0')).join(''); const rr = await run(env, 'INSERT INTO api_keys (name, key) VALUES (?, ?)', name, key); return json({ ok: true, id: rr.meta.last_row_id, key }); }
  if ((r = p.match(/^\/api-keys\/(\d+)$/)) && m === 'DELETE') { await run(env, 'UPDATE api_keys SET is_active = 0 WHERE id = ?', +r[1]); return json({ ok: true }); }
  return null;
}

// ---------------------------------------------------------------- API de solo lectura /api/v1 (Bearer)
export async function v1(request, env, path) {
  const auth = request.headers.get('authorization') || '';
  const key = auth.replace(/^Bearer\s+/i, '').trim();
  const k = key ? await one(env, 'SELECT * FROM api_keys WHERE key = ? AND is_active = 1', key) : null;
  if (!k) return json({ error: 'Clave de API inválida. Usa la cabecera Authorization: Bearer <clave>.' }, 401);
  await run(env, 'UPDATE api_keys SET last_used = ? WHERE id = ?', mxToday(), k.id);
  if (request.method !== 'GET') return json({ error: 'La API de integración es de solo lectura' }, 405);
  const res = { vessels: () => vesselsWithStays(env), lots: () => all(env, 'SELECT * FROM lots ORDER BY id'), operations: () => all(env, "SELECT id, type, op_date, status, operator_name, notes, volume_l FROM operations WHERE status <> 'draft' ORDER BY op_date DESC LIMIT 500"), analyses: () => all(env, 'SELECT * FROM analyses ORDER BY analysed_at DESC LIMIT 500'), parcels: () => all(env, 'SELECT id, code, vineyard, variety, area_ha, planted_year, wine_type FROM parcels'), bottling: () => all(env, 'SELECT * FROM bottling_sessions ORDER BY bottled_at DESC LIMIT 500'), products: () => all(env, 'SELECT * FROM products'), batches: () => all(env, 'SELECT * FROM product_batches') };
  const name = path.replace(/^\/+|\/+$/g, '');
  if (!name) return json({ api: 'ulula/v1', resources: Object.keys(res).map((x) => `/api/v1/${x}`), read_only: true });
  if (!res[name]) return json({ error: 'Recurso no encontrado' }, 404);
  return json({ [name]: await res[name]() });
}

// ---------------------------------------------------------------- conciliación
async function reconciliations(env) {
  const c = await one(env, 'SELECT reconcile_tolerance_pct, reconcile_self_approve FROM company WHERE id = 1');
  const rows = await all(env, 'SELECT rc.*, v.code AS vessel_code, lo.code AS lot_code FROM reconciliations rc JOIN vessels v ON v.id = rc.vessel_id LEFT JOIN lots lo ON lo.id = rc.lot_id ORDER BY rc.id DESC LIMIT 300');
  const vessels = (await vesselsWithStays(env)).filter((v) => v.is_active && v.stay_id && v.stay_unit === 'L');
  return { settings: { tolerance_pct: c?.reconcile_tolerance_pct || 0, self_approve: !!c?.reconcile_self_approve }, pending: rows.filter((x) => x.status === 'pending'), history: rows.filter((x) => x.status !== 'pending'), vessels: vessels.map((v) => ({ id: v.id, code: v.code, capacity_l: v.capacity_l, lot_id: v.lot_id, lot_code: v.lot_code, system_l: v.stay_volume, stay_id: v.stay_id })) };
}
const REASONS = ['measurement', 'count', 'evaporation', 'spill', 'other'];
// Mide uno o varios recipientes. Dentro de la tolerancia se aplica; por encima queda pendiente para un técnico/administrador.
async function measure(env, b) {
  const d = str(b.measured_at) || mxToday(); if (!dateOk(d)) fail(400, 'Fecha inválida');
  const reason = REASONS.includes(b.reason) ? b.reason : 'measurement';
  const rows = (Array.isArray(b.rows) ? b.rows : [{ vessel_id: b.vessel_id, measured_l: b.measured_l }]).map((x) => ({ vessel_id: int(x.vessel_id), measured_l: num(x.measured_l) })).filter((x) => x.vessel_id && x.measured_l != null);
  if (!rows.length) fail(400, 'Indica el recipiente y el volumen medido');
  const c = await one(env, 'SELECT reconcile_tolerance_pct, reconcile_self_approve FROM company WHERE id = 1');
  const vs = await vesselsWithStays(env); const role = str(b.role) || 'operator'; const out = [];
  for (const x of rows) {
    const v = vs.find((y) => y.id === x.vessel_id); if (!v || !v.stay_id || v.stay_unit !== 'L') fail(400, `El recipiente ${v?.code || x.vessel_id} no tiene vino en litros`);
    if (x.measured_l < 0 || x.measured_l > v.capacity_l * 1.05) fail(400, `Volumen medido fuera de rango en ${v.code}`);
    const diff = Math.round((x.measured_l - v.stay_volume) * 10) / 10;
    const within = Math.abs(diff) <= (v.stay_volume * (c?.reconcile_tolerance_pct || 0)) / 100 + 0.05;
    const autoOk = within || (role === 'admin' && c?.reconcile_self_approve);
    const rr = await run(env, 'INSERT INTO reconciliations (measured_at, vessel_id, lot_id, system_l, measured_l, diff_l, reason, note, status, measured_by) VALUES (?,?,?,?,?,?,?,?,?,?)', d, v.id, v.lot_id, v.stay_volume, x.measured_l, diff, reason, str(b.note), diff === 0 ? 'applied' : autoOk ? 'approved' : 'pending', str(b.measured_by));
    const id = rr.meta.last_row_id;
    if (diff !== 0 && autoOk) await apply(env, id, str(b.measured_by) || 'auto', within ? 'tolerancia' : 'autoaprobación');
    out.push({ id, vessel: v.code, diff, status: diff === 0 ? 'applied' : autoOk ? 'applied' : 'pending' });
  }
  return { ok: true, results: out };
}
async function apply(env, id, by, how) {
  const rc = await one(env, 'SELECT * FROM reconciliations WHERE id = ?', id);
  const st = await one(env, 'SELECT * FROM stays WHERE vessel_id = ? AND left_at IS NULL', rc.vessel_id); if (!st) fail(409, 'El recipiente ya no tiene vino');
  const op = await run(env, "INSERT INTO operations (type, op_date, operator_name, status, volume_l, notes, confirmed_at) VALUES ('adjustment', ?, ?, 'confirmed', ?, ?, datetime('now'))", rc.measured_at, by, rc.diff_l, `Conciliación ${rc.reason}${rc.note ? ': ' + rc.note : ''} (${how})`);
  const opId = op.meta.last_row_id;
  await env.DB.batch([
    env.DB.prepare("INSERT INTO operation_lines (operation_id, side, vessel_id, lot_id, volume, sort) VALUES (?, 'origin', ?, ?, ?, 0)").bind(opId, rc.vessel_id, st.lot_id, rc.diff_l),
    env.DB.prepare('UPDATE stays SET volume = ? WHERE id = ?').bind(rc.measured_l, st.id),
    env.DB.prepare('UPDATE operations SET undo = ? WHERE id = ?').bind(JSON.stringify({ stays: [{ id: st.id, volume: st.volume, left_at: null, volume_out: null, closed_by_op: null }], fills: [], lots: [] }), opId),
    env.DB.prepare("UPDATE reconciliations SET status = 'applied', approved_by = ?, approved_at = ?, operation_id = ? WHERE id = ?").bind(by, mxToday(), opId, id),
  ]);
}
async function decide(env, id, action, b) {
  const rc = await one(env, 'SELECT * FROM reconciliations WHERE id = ?', id); if (!rc) fail(404, 'Medición no encontrada'); if (rc.status !== 'pending') fail(409, 'La medición ya no está pendiente');
  if (action === 'reject') { await run(env, "UPDATE reconciliations SET status = 'rejected', approved_by = ?, approved_at = ? WHERE id = ?", str(b.by_name), mxToday(), id); return { ok: true }; }
  await apply(env, id, str(b.by_name) || 'aprobado', 'aprobación'); return { ok: true };
}

// ---------------------------------------------------------------- limpieza
async function cleanings(env, q) {
  const where = [], args = [];
  if (q('status')) { where.push('c.status = ?'); args.push(q('status')); }
  if (q('protocol')) { where.push('c.protocol = ?'); args.push(q('protocol')); }
  if (q('from')) { where.push('c.cleaned_at >= ?'); args.push(q('from')); }
  if (q('to')) { where.push('c.cleaned_at <= ?'); args.push(q('to')); }
  return all(env, `SELECT c.*, v.code AS vessel_code, e.name AS equipment_name FROM cleaning_records c LEFT JOIN vessels v ON v.id = c.vessel_id LEFT JOIN equipment e ON e.id = c.equipment_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY c.cleaned_at DESC, c.id DESC LIMIT 400`, ...args);
}
export const PROTOCOLS = ['cleaning', 'disinfection', 'rinse', 'full'];
async function batchCleaning(env, b) {
  const ids = (Array.isArray(b.vessel_ids) ? b.vessel_ids : []).map(Number).filter(Boolean); if (!ids.length) fail(400, 'Selecciona recipientes');
  const c = await one(env, 'SELECT cleaning_four_eyes FROM company WHERE id = 1');
  const d = str(b.cleaned_at) || mxToday(); const protocol = PROTOCOLS.includes(b.protocol) ? b.protocol : 'cleaning';
  await env.DB.batch(ids.map((id) => env.DB.prepare('INSERT INTO cleaning_records (vessel_id, cleaned_at, by_name, method, notes, protocol, status, products) VALUES (?,?,?,?,?,?,?,?)').bind(id, d, str(b.by_name), str(b.method), str(b.notes), protocol, c?.cleaning_four_eyes ? 'pending' : 'registered', str(b.products))));
  return { ok: true, count: ids.length };
}

// ---------------------------------------------------------------- catálogos sencillos
async function saveBlock(env, id, b) {
  const name = str(b.name); if (!name) fail(400, 'Falta el nombre de la parcela');
  const args = [name, str(b.supplier), str(b.variety), str(b.locality), num(b.area_ha), str(b.wine_type), str(b.production_mode), str(b.notes), bool(b.is_active, 1)];
  if (id) { await run(env, 'UPDATE supplier_blocks SET name = ?, supplier = ?, variety = ?, locality = ?, area_ha = ?, wine_type = ?, production_mode = ?, notes = ?, is_active = ? WHERE id = ?', ...args, id); return { ok: true, id }; }
  const r = await run(env, 'INSERT INTO supplier_blocks (name, supplier, variety, locality, area_ha, wine_type, production_mode, notes, is_active) VALUES (?,?,?,?,?,?,?,?,?)', ...args); return { ok: true, id: r.meta.last_row_id };
}
export const EQUIP_KINDS = ['press', 'pump', 'filter', 'destemmer', 'bottling_line', 'labeler', 'tractor', 'sprayer', 'chiller', 'other'];
async function saveEquipment(env, id, b) {
  const code = str(b.code); const name = str(b.name); if (!code || !name) fail(400, 'Faltan código y nombre');
  if (await one(env, 'SELECT id FROM equipment WHERE code = ? AND id <> ?', code, id || 0)) fail(409, `Ya existe el equipo ${code}`);
  const args = [code, name, EQUIP_KINDS.includes(b.kind) ? b.kind : 'other', str(b.brand), str(b.model), str(b.serial), int(b.location_id), str(b.acquisition_date), str(b.notes), bool(b.is_active, 1)];
  if (id) { await run(env, 'UPDATE equipment SET code = ?, name = ?, kind = ?, brand = ?, model = ?, serial = ?, location_id = ?, acquisition_date = ?, notes = ?, is_active = ? WHERE id = ?', ...args, id); return { ok: true, id }; }
  const r = await run(env, 'INSERT INTO equipment (code, name, kind, brand, model, serial, location_id, acquisition_date, notes, is_active) VALUES (?,?,?,?,?,?,?,?,?,?)', ...args); return { ok: true, id: r.meta.last_row_id };
}
export const PACK_CATS = ['bottle', 'cork', 'capsule', 'label', 'back_label', 'box', 'divider', 'other'];
async function materials(env) { return all(env, 'SELECT m.*, COALESCE((SELECT SUM(qty) FROM packaging_moves pm WHERE pm.material_id = m.id), 0) AS stock, (SELECT MAX(moved_at) FROM packaging_moves pm WHERE pm.material_id = m.id AND pm.reason = \'receipt\') AS last_receipt FROM packaging_materials m ORDER BY m.is_active DESC, m.category, m.name'); }
function materialFields(b) { const code = str(b.code), name = str(b.name); if (!code || !name) fail(400, 'Faltan código y nombre'); return [code, name, PACK_CATS.includes(b.category) ? b.category : 'other', str(b.unit) || 'unidad', num(b.min_stock), str(b.supplier), str(b.notes), bool(b.is_active, 1)]; }
async function saveMaterial(env, id, b) {
  const f = materialFields(b);
  if (await one(env, 'SELECT id FROM packaging_materials WHERE code = ? AND id <> ?', f[0], id || 0)) fail(409, `Ya existe el material ${f[0]}`);
  if (id) { await run(env, 'UPDATE packaging_materials SET code = ?, name = ?, category = ?, unit = ?, min_stock = ?, supplier = ?, notes = ?, is_active = ? WHERE id = ?', ...f, id); return { ok: true, id }; }
  const r = await run(env, 'INSERT INTO packaging_materials (code, name, category, unit, min_stock, supplier, notes, is_active) VALUES (?,?,?,?,?,?,?,?)', ...f); return { ok: true, id: r.meta.last_row_id };
}
async function importMaterials(env, b) {
  const rows = Array.isArray(b.rows) ? b.rows : fail(400, 'Faltan filas');
  const existing = new Set((await all(env, 'SELECT code FROM packaging_materials')).map((x) => x.code.toLowerCase()));
  const ins = rows.map((x) => { try { return materialFields(x); } catch { return null; } }).filter((f) => f && !existing.has(f[0].toLowerCase()));
  if (ins.length) await env.DB.batch(ins.map((f) => env.DB.prepare('INSERT INTO packaging_materials (code, name, category, unit, min_stock, supplier, notes, is_active) VALUES (?,?,?,?,?,?,?,?)').bind(...f)));
  return { ok: true, created: ins.length, skipped: rows.length - ins.length };
}
async function addMove(env, b) {
  const material_id = int(b.material_id); if (!material_id) fail(400, 'Indica el material');
  const qty = num(b.qty); if (!qty) fail(400, 'Cantidad inválida');
  const reason = ['receipt', 'consumption', 'adjustment', 'count'].includes(b.reason) ? b.reason : 'receipt';
  const signed = reason === 'consumption' ? -Math.abs(qty) : qty;
  const r = await run(env, 'INSERT INTO packaging_moves (material_id, moved_at, qty, reason, supplier_lot, invoice_no, unit_cost, bottling_id, notes) VALUES (?,?,?,?,?,?,?,?,?)', material_id, str(b.moved_at) || mxToday(), signed, reason, str(b.supplier_lot), str(b.invoice_no), num(b.unit_cost), int(b.bottling_id), str(b.notes));
  return { ok: true, id: r.meta.last_row_id };
}
