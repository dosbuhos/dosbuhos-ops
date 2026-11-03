// Ulula — bodega por recipientes. Cloudflare Worker (API + static assets).
// Bindings: DB (D1), ASSETS (static files). Sin dependencias.
//
// Regla central: los formularios eligen recipientes, nunca lotes. El lote es lo que hay en el recipiente,
// y cada operación reescribe esa relación por medio de "estancias" (stays): lote × recipiente × fechas × volumen.

const VERSION = '0.1.0';

const TYPES = ['pressing', 'bleeding', 'racking', 'barrel_transfer', 'filtration', 'decantation', 'addition', 'topping', 'bulk_sale', 'blend'];
const MOVE_TYPES = new Set(['racking', 'filtration', 'decantation']);
const WINE_ABBR = { tinto: 'TI', blanco: 'BL', rosado: 'RO', espumoso: 'ES', base_blanco: 'BB', base_rosado: 'BR', naranja: 'NA', piquette: 'PQ' };
const FRACTION_SUFFIX = { free_run: 'FR', press_1: 'P1', press_2: 'P2', press_3: 'P3', combined: 'C', pomace: 'OR' };
const BARREL_KINDS = new Set(['barrel', 'foudre']);
const MX_OFFSET_H = 6; // San Miguel: UTC-6 todo el año
const mxToday = () => new Date(Date.now() - MX_OFFSET_H * 3600000).toISOString().slice(0, 10);

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = (status, message) => { throw new HttpError(status, message); };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const num = (v) => { if (v === '' || v == null) return null; const n = Number(String(v).replace(',', '.')); return Number.isFinite(n) ? n : null; };
const int = (v) => { const n = num(v); return n == null ? null : Math.round(n); };
const str = (v) => (v == null ? null : String(v).trim() || null);
const round1 = (n) => Math.round(n * 10) / 10;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      try {
        return await api(request, env, url);
      } catch (err) {
        if (err instanceof HttpError) return json({ error: err.message }, err.status);
        console.error(err);
        return json({ error: 'Error del servidor: ' + (err.message || err) }, 500);
      }
    }
    return env.ASSETS.fetch(request);
  },
};

// ---------------------------------------------------------------- router
async function api(request, env, url) {
  const m = request.method;
  const p = url.pathname.replace(/^\/api/, '');
  const body = async () => { try { return await request.json(); } catch { fail(400, 'JSON inválido'); } };
  const q = (k) => url.searchParams.get(k);
  let r;

  if (m === 'GET' && p === '/bootstrap') return json(await bootstrap(env));
  if (m === 'GET' && p === '/board') return json(await board(env));
  if (m === 'GET' && p === '/activity') return json(await activity(env));
  if (m === 'GET' && p === '/search') return json(await search(env, q('q') || ''));
  if (m === 'GET' && p === '/trace') return json(await trace(env, { lot: int(q('lot')), vessel: int(q('vessel')) }));

  if (m === 'GET' && p === '/vessels') return json({ vessels: await vesselsWithStays(env) });
  if (m === 'POST' && p === '/vessels') return json(await createVessel(env, await body()));
  if (m === 'POST' && p === '/vessels/sequence') return json(await createVesselSequence(env, await body()));
  if (m === 'POST' && p === '/vessels/import') return json(await importVessels(env, await body()));
  if ((r = p.match(/^\/vessels\/(\d+)$/)) && m === 'PUT') return json(await updateVessel(env, +r[1], await body()));
  if ((r = p.match(/^\/vessels\/(\d+)$/)) && m === 'GET') return json(await vesselDetail(env, +r[1]));
  if (m === 'POST' && p === '/locations') return json(await createLocation(env, await body()));
  if ((r = p.match(/^\/locations\/(\d+)$/)) && m === 'PUT') return json(await updateLocation(env, +r[1], await body()));

  if (m === 'POST' && p === '/opening-balances') return json(await openingBalances(env, await body()));
  if (m === 'GET' && p === '/lots') return json({ lots: await lotsWithVolume(env) });
  if ((r = p.match(/^\/lots\/(\d+)$/)) && m === 'PUT') return json(await updateLot(env, +r[1], await body()));

  if (m === 'GET' && p === '/operations') return json(await listOperations(env, { lot: int(q('lot')), vessel: int(q('vessel')), year: int(q('year')), type: str(q('type')), status: str(q('status')), color: str(q('color')) }));
  if (m === 'POST' && p === '/operations') return json(await saveOperation(env, null, await body()));
  if ((r = p.match(/^\/operations\/(\d+)$/)) && m === 'GET') return json(await getOperation(env, +r[1]));
  if ((r = p.match(/^\/operations\/(\d+)$/)) && m === 'PUT') return json(await saveOperation(env, +r[1], await body()));
  if ((r = p.match(/^\/operations\/(\d+)$/)) && m === 'DELETE') return json(await deleteDraft(env, +r[1]));
  if ((r = p.match(/^\/operations\/(\d+)\/revert$/)) && m === 'POST') return json(await revertOperation(env, +r[1]));

  if (m === 'GET' && p === '/analyses') return json({ analyses: await listSimple(env, 'analyses', 'analysed_at', q('lot')) });
  if (m === 'POST' && p === '/analyses') return json(await createAnalysis(env, await body()));
  if (m === 'GET' && p === '/tastings') return json({ tastings: await listSimple(env, 'tastings', 'tasted_at', q('lot')) });
  if (m === 'POST' && p === '/tastings') return json(await createTasting(env, await body()));
  if (m === 'POST' && p === '/cleanings') return json(await createCleaning(env, await body()));
  if (m === 'GET' && p === '/products') return json({ products: (await env.DB.prepare('SELECT * FROM products ORDER BY category, name').all()).results });
  if (m === 'POST' && p === '/products') return json(await createProduct(env, await body()));
  if ((r = p.match(/^\/products\/(\d+)$/)) && m === 'PUT') return json(await updateProduct(env, +r[1], await body()));
  if (m === 'POST' && p === '/users') return json(await createUser(env, await body()));

  fail(404, 'Ruta no encontrada');
}

// ---------------------------------------------------------------- reads
async function vesselsWithStays(env) {
  const sql = `
    SELECT v.*, l.name AS location_name, l.room AS location_room,
           s.id AS stay_id, s.volume AS stay_volume, s.unit AS stay_unit, s.entered_at AS stay_entered_at,
           lo.id AS lot_id, lo.code AS lot_code, lo.wine_type, lo.vintage, lo.varieties, lo.phase, lo.fermentation_done
    FROM vessels v
    LEFT JOIN locations l ON l.id = v.location_id
    LEFT JOIN stays s ON s.vessel_id = v.id AND s.left_at IS NULL
    LEFT JOIN lots lo ON lo.id = s.lot_id
    ORDER BY v.code`;
  return (await env.DB.prepare(sql).all()).results;
}

async function lotsWithVolume(env) {
  const sql = `
    SELECT lo.*, COALESCE(SUM(s.volume), 0) AS volume,
           GROUP_CONCAT(v.code, ', ') AS vessel_codes, COUNT(s.id) AS vessel_count
    FROM lots lo
    LEFT JOIN stays s ON s.lot_id = lo.id AND s.left_at IS NULL
    LEFT JOIN vessels v ON v.id = s.vessel_id
    GROUP BY lo.id ORDER BY lo.status, lo.code`;
  return (await env.DB.prepare(sql).all()).results;
}

async function bootstrap(env) {
  const [vessels, lots, locations, users, products, drafts] = await Promise.all([
    vesselsWithStays(env), lotsWithVolume(env),
    env.DB.prepare('SELECT * FROM locations ORDER BY sort, name').all().then((r) => r.results),
    env.DB.prepare('SELECT * FROM users WHERE active = 1 ORDER BY role, name').all().then((r) => r.results),
    env.DB.prepare('SELECT * FROM products ORDER BY category, name').all().then((r) => r.results),
    env.DB.prepare("SELECT COUNT(*) AS n FROM operations WHERE status = 'draft'").first(),
  ]);
  return { version: VERSION, today: mxToday(), vessels, lots, locations, users, products, drafts: drafts.n };
}

async function board(env) {
  const vessels = await vesselsWithStays(env);
  const [lastOps, lastAn, lastClean, emptied] = await Promise.all([
    env.DB.prepare(`SELECT ol.vessel_id, MAX(o.op_date) AS last_op FROM operation_lines ol JOIN operations o ON o.id = ol.operation_id WHERE o.status = 'confirmed' AND ol.vessel_id IS NOT NULL GROUP BY ol.vessel_id`).all().then((r) => r.results),
    env.DB.prepare('SELECT lot_id, MAX(analysed_at) AS last_an FROM analyses GROUP BY lot_id').all().then((r) => r.results),
    env.DB.prepare('SELECT vessel_id, MAX(cleaned_at) AS last_clean FROM cleaning_records GROUP BY vessel_id').all().then((r) => r.results),
    env.DB.prepare('SELECT vessel_id, MAX(left_at) AS emptied_at FROM stays WHERE left_at IS NOT NULL GROUP BY vessel_id').all().then((r) => r.results),
  ]);
  const idx = (rows, k, v) => Object.fromEntries(rows.map((r) => [r[k], r[v]]));
  const op = idx(lastOps, 'vessel_id', 'last_op'), an = idx(lastAn, 'lot_id', 'last_an'), cl = idx(lastClean, 'vessel_id', 'last_clean'), em = idx(emptied, 'vessel_id', 'emptied_at');
  const today = mxToday();
  const daysAgo = (d) => (d ? Math.round((Date.parse(today) - Date.parse(d)) / 864e5) : null);
  let occupied = 0, liters = 0, kg = 0, capacity = 0, attention = 0;
  const out = vessels.map((v) => {
    const r = { ...v, last_op: op[v.id] || null, last_analysis: v.lot_id ? an[v.lot_id] || null : null, last_cleaning: cl[v.id] || null, emptied_at: em[v.id] || null, flags: [] };
    if (v.is_active) capacity += v.capacity_l;
    if (v.stay_id) {
      occupied++;
      if (v.stay_unit === 'kg') kg += v.stay_volume; else liters += v.stay_volume;
      const head = v.capacity_l - v.stay_volume;
      if (!v.always_full && v.stay_unit !== 'kg' && head > Math.max(5, v.capacity_l * 0.02)) r.flags.push('rellenar');
      const d = daysAgo(r.last_analysis);
      if (d == null || d > 30) r.flags.push('analisis');
    } else if (r.emptied_at && (!r.last_cleaning || r.last_cleaning < r.emptied_at)) {
      r.flags.push('limpiar');
    }
    r.pct = v.stay_id && v.capacity_l ? Math.min(100, Math.round((v.stay_volume / v.capacity_l) * 100)) : 0;
    if (r.flags.length) attention++;
    return r;
  });
  return { today, vessels: out, kpi: { vessels: vessels.length, occupied, free: vessels.length - occupied, liters: round1(liters), kg: round1(kg), capacity: round1(capacity), attention } };
}

async function vesselDetail(env, id) {
  const v = await env.DB.prepare(`SELECT v.*, l.name AS location_name FROM vessels v LEFT JOIN locations l ON l.id = v.location_id WHERE v.id = ?`).bind(id).first();
  if (!v) fail(404, 'Recipiente no encontrado');
  const stay = await env.DB.prepare(`SELECT s.*, lo.code AS lot_code, lo.wine_type, lo.vintage, lo.varieties, lo.phase, lo.fermentation_done FROM stays s JOIN lots lo ON lo.id = s.lot_id WHERE s.vessel_id = ? AND s.left_at IS NULL`).bind(id).first();
  const ops = (await env.DB.prepare(`SELECT o.id, o.type, o.op_date, o.status, o.operator_name, o.notes, ol.side, ol.volume, ol.fraction, ol.product_name, ol.qty, ol.unit
      FROM operation_lines ol JOIN operations o ON o.id = ol.operation_id WHERE ol.vessel_id = ? AND o.status <> 'reverted' ORDER BY o.op_date DESC, o.id DESC LIMIT 40`).bind(id).all()).results;
  const analyses = stay ? (await env.DB.prepare('SELECT * FROM analyses WHERE lot_id = ? ORDER BY analysed_at DESC LIMIT 10').bind(stay.lot_id).all()).results : [];
  const tastings = stay ? (await env.DB.prepare('SELECT * FROM tastings WHERE lot_id = ? ORDER BY tasted_at DESC LIMIT 10').bind(stay.lot_id).all()).results : [];
  const cleanings = (await env.DB.prepare('SELECT * FROM cleaning_records WHERE vessel_id = ? ORDER BY cleaned_at DESC LIMIT 5').bind(id).all()).results;
  return { vessel: v, stay, operations: ops, analyses, tastings, cleanings };
}

async function listSimple(env, table, dateCol, lot) {
  const base = `SELECT t.*, lo.code AS lot_code, v.code AS vessel_code FROM ${table} t LEFT JOIN lots lo ON lo.id = t.lot_id LEFT JOIN vessels v ON v.id = t.vessel_id`;
  const st = lot ? env.DB.prepare(`${base} WHERE t.lot_id = ? ORDER BY t.${dateCol} DESC, t.id DESC`).bind(+lot) : env.DB.prepare(`${base} ORDER BY t.${dateCol} DESC, t.id DESC LIMIT 300`);
  return (await st.all()).results;
}

async function search(env, qs) {
  const like = `%${qs}%`;
  const [lots, vessels] = await Promise.all([
    env.DB.prepare(`SELECT lo.id, lo.code, lo.wine_type, lo.vintage, lo.varieties, lo.status FROM lots lo WHERE lo.code LIKE ? OR lo.varieties LIKE ? ORDER BY lo.status, lo.code LIMIT 20`).bind(like, like).all().then((r) => r.results),
    env.DB.prepare(`SELECT v.id, v.code, v.kind, v.capacity_l, lo.code AS lot_code FROM vessels v LEFT JOIN stays s ON s.vessel_id = v.id AND s.left_at IS NULL LEFT JOIN lots lo ON lo.id = s.lot_id WHERE v.code LIKE ? ORDER BY v.code LIMIT 20`).bind(like).all().then((r) => r.results),
  ]);
  return { lots, vessels };
}

async function listOperations(env, f) {
  const where = ["o.status <> 'deleted'"], args = [];
  if (f.status) { where.push('o.status = ?'); args.push(f.status); }
  if (f.type) { where.push('o.type = ?'); args.push(f.type); }
  if (f.year) { where.push("substr(o.op_date, 1, 4) = ?"); args.push(String(f.year)); }
  if (f.lot) { where.push('o.id IN (SELECT operation_id FROM operation_lines WHERE lot_id = ?)'); args.push(f.lot); }
  if (f.vessel) { where.push('o.id IN (SELECT operation_id FROM operation_lines WHERE vessel_id = ?)'); args.push(f.vessel); }
  if (f.color) { where.push('o.id IN (SELECT ol.operation_id FROM operation_lines ol JOIN lots lo ON lo.id = ol.lot_id WHERE lo.wine_type = ?)'); args.push(f.color); }
  const ops = (await env.DB.prepare(`SELECT o.* FROM operations o WHERE ${where.join(' AND ')} ORDER BY o.op_date DESC, o.id DESC LIMIT 400`).bind(...args).all()).results;
  if (!ops.length) return { operations: [] };
  const ids = ops.map((o) => o.id);
  const lines = (await env.DB.prepare(`SELECT ol.*, v.code AS vessel_code, lo.code AS lot_code, lo.wine_type FROM operation_lines ol LEFT JOIN vessels v ON v.id = ol.vessel_id LEFT JOIN lots lo ON lo.id = ol.lot_id WHERE ol.operation_id IN (${ids.map(() => '?').join(',')}) ORDER BY ol.sort, ol.id`).bind(...ids).all()).results;
  const byOp = {};
  for (const l of lines) (byOp[l.operation_id] ||= []).push(l);
  return { operations: ops.map((o) => ({ ...o, payload: o.payload ? JSON.parse(o.payload) : null, undo: undefined, lines: byOp[o.id] || [] })) };
}

async function getOperation(env, id) {
  const o = await env.DB.prepare('SELECT * FROM operations WHERE id = ?').bind(id).first();
  if (!o) fail(404, 'Operación no encontrada');
  const lines = (await env.DB.prepare(`SELECT ol.*, v.code AS vessel_code, lo.code AS lot_code FROM operation_lines ol LEFT JOIN vessels v ON v.id = ol.vessel_id LEFT JOIN lots lo ON lo.id = ol.lot_id WHERE ol.operation_id = ? ORDER BY ol.sort, ol.id`).bind(id).all()).results;
  return { operation: { ...o, payload: o.payload ? JSON.parse(o.payload) : null, undo: undefined, lines } };
}

async function activity(env) {
  const today = mxToday();
  const since30 = new Date(Date.parse(today) - 30 * 864e5).toISOString().slice(0, 10);
  const since12 = new Date(Date.parse(today) - 365 * 864e5).toISOString().slice(0, 7) + '-01';
  const [ops30, drafts, byType, byMonth, lotsByType, b] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS n FROM operations WHERE status = 'confirmed' AND op_date >= ?").bind(since30).first(),
    env.DB.prepare("SELECT COUNT(*) AS n FROM operations WHERE status = 'draft'").first(),
    env.DB.prepare("SELECT type, COUNT(*) AS n FROM operations WHERE status = 'confirmed' AND op_date >= ? GROUP BY type ORDER BY n DESC").bind(since12).all().then((r) => r.results),
    env.DB.prepare("SELECT substr(op_date, 1, 7) AS month, COUNT(*) AS n FROM operations WHERE status = 'confirmed' AND op_date >= ? GROUP BY month ORDER BY month").bind(since12).all().then((r) => r.results),
    env.DB.prepare("SELECT lo.wine_type, COUNT(DISTINCT lo.id) AS lots, COALESCE(SUM(CASE WHEN s.unit = 'L' THEN s.volume ELSE 0 END), 0) AS liters FROM lots lo JOIN stays s ON s.lot_id = lo.id AND s.left_at IS NULL WHERE lo.status = 'active' GROUP BY lo.wine_type ORDER BY liters DESC").all().then((r) => r.results),
    board(env),
  ]);
  const toClean = b.vessels.filter((v) => v.flags.includes('limpiar')).length;
  return { today, ops30: ops30.n, drafts: drafts.n, toClean, byType, byMonth, lotsByType, kpi: b.kpi };
}

async function trace(env, { lot, vessel }) {
  let lotId = lot;
  if (!lotId && vessel) {
    const s = await env.DB.prepare('SELECT lot_id FROM stays WHERE vessel_id = ? AND left_at IS NULL').bind(vessel).first()
      || await env.DB.prepare('SELECT lot_id FROM stays WHERE vessel_id = ? ORDER BY entered_at DESC, id DESC LIMIT 1').bind(vessel).first();
    if (!s) fail(404, 'Ese recipiente no ha tenido vino registrado');
    lotId = s.lot_id;
  }
  const lo = await env.DB.prepare('SELECT lo.*, p.code AS parent_code FROM lots lo LEFT JOIN lots p ON p.id = lo.parent_lot_id WHERE lo.id = ?').bind(lotId).first();
  if (!lo) fail(404, 'Lote no encontrado');
  const stays = (await env.DB.prepare(`SELECT s.*, v.code AS vessel_code, v.kind, v.capacity_l FROM stays s JOIN vessels v ON v.id = s.vessel_id WHERE s.lot_id = ? ORDER BY s.entered_at DESC, s.id DESC`).bind(lotId).all()).results;
  const ops = (await env.DB.prepare(`SELECT o.id, o.type, o.op_date, o.operator_name, o.notes, o.status, ol.side, ol.vessel_id, ol.volume, ol.fraction, ol.product_name, ol.qty, ol.unit, v.code AS vessel_code
      FROM operation_lines ol JOIN operations o ON o.id = ol.operation_id JOIN vessels v ON v.id = ol.vessel_id
      WHERE o.status = 'confirmed' AND (ol.lot_id = ? OR o.id = ?) ORDER BY o.op_date, o.id`).bind(lotId, lo.created_by_op || 0).all()).results;
  const [analyses, tastings] = await Promise.all([
    env.DB.prepare('SELECT a.*, v.code AS vessel_code FROM analyses a LEFT JOIN vessels v ON v.id = a.vessel_id WHERE a.lot_id = ? ORDER BY a.analysed_at').bind(lotId).all().then((r) => r.results),
    env.DB.prepare('SELECT t.*, v.code AS vessel_code FROM tastings t LEFT JOIN vessels v ON v.id = t.vessel_id WHERE t.lot_id = ? ORDER BY t.tasted_at').bind(lotId).all().then((r) => r.results),
  ]);
  const vids = [...new Set(stays.map((s) => s.vessel_id))];
  const cleanings = vids.length ? (await env.DB.prepare(`SELECT * FROM cleaning_records WHERE vessel_id IN (${vids.map(() => '?').join(',')}) ORDER BY cleaned_at`).bind(...vids).all()).results : [];
  // Origen: operación que creó el lote (prensado, coupage, lías) con sus líneas de origen
  let origin = null;
  if (lo.created_by_op) {
    const o = await env.DB.prepare('SELECT id, type, op_date, notes FROM operations WHERE id = ?').bind(lo.created_by_op).first();
    const lines = (await env.DB.prepare(`SELECT ol.side, ol.volume, ol.unit, v.code AS vessel_code, lo2.code AS lot_code, lo2.id AS lot_id FROM operation_lines ol LEFT JOIN vessels v ON v.id = ol.vessel_id LEFT JOIN lots lo2 ON lo2.id = ol.lot_id WHERE ol.operation_id = ? AND ol.side = 'origin'`).bind(lo.created_by_op).all()).results;
    origin = { ...o, origins: lines };
  }
  return { lot: lo, stays, operations: ops, analyses, tastings, cleanings, origin };
}

// ---------------------------------------------------------------- master data
const TYPE_MAP = { fermentation: 'fermentation', fermentación: 'fermentation', fermentacion: 'fermentation', fermentação: 'fermentation', storage: 'storage', almacenamiento: 'storage', armazenamento: 'storage', aging: 'aging', crianza: 'aging', envelhecimento: 'aging' };
const MATERIAL_MAP = { stainless_steel: 'stainless_steel', inox: 'stainless_steel', acero: 'stainless_steel', 'acero inoxidable': 'stainless_steel', concrete: 'concrete', hormigón: 'concrete', hormigon: 'concrete', betão: 'concrete', oak: 'oak', roble: 'oak', 'roble / madera': 'oak', madera: 'oak', madeira: 'oak', fiberglass: 'fiberglass', 'fibra de vidrio': 'fiberglass', fibra: 'fiberglass', clay: 'clay', barro: 'clay', chestnut: 'chestnut', castaño: 'chestnut', acacia: 'acacia', ceramic: 'ceramic', 'gres / cerámica': 'ceramic', gres: 'ceramic', cerámica: 'ceramic', glass: 'glass', vidrio: 'glass', terracotta: 'terracotta', terracota: 'terracotta', plastic: 'plastic', plástico: 'plastic', plastico: 'plastic' };
const KIND_MAP = { tank: 'tank', depósito: 'tank', deposito: 'tank', 'depósito / cuba': 'tank', cuba: 'tank', tanque: 'tank', foudre: 'foudre', 'foudre / tino': 'foudre', tino: 'foudre', puncheon: 'foudre', barrel: 'barrel', barrica: 'barrel', barril: 'barrel', bin: 'bin', keg: 'keg', amphora: 'amphora', ánfora: 'amphora', anfora: 'amphora', egg: 'egg', huevo: 'egg', ovo: 'egg', tirage_cage: 'tirage_cage', 'jaula de tiraje': 'tirage_cage', press: 'press', prensa: 'press', carboy: 'carboy', garrafón: 'carboy', garrafon: 'carboy', damajuana: 'carboy' };
const norm = (map, v, dflt) => { if (v == null || v === '') return dflt; const k = String(v).trim().toLowerCase(); return map[k] || (Object.values(map).includes(k) ? k : fail(400, `Valor no reconocido: ${v}`)); };
const bool = (v, dflt) => { if (v == null || v === '') return dflt; if (typeof v === 'boolean') return v ? 1 : 0; const s = String(v).trim().toLowerCase(); return ['1', 'si', 'sí', 'sim', 'yes', 'true', 'y'].includes(s) ? 1 : 0; };

function vesselFields(b) {
  const code = str(b.code); if (!code) fail(400, 'Falta el código del recipiente');
  const capacity = num(b.capacity_l); if (!capacity || capacity <= 0) fail(400, `Capacidad inválida en ${code}`);
  return {
    code, capacity_l: capacity,
    vessel_type: norm(TYPE_MAP, b.vessel_type, 'storage'), material: norm(MATERIAL_MAP, b.material, 'stainless_steel'), kind: norm(KIND_MAP, b.kind, 'tank'),
    location_id: int(b.location_id), is_active: bool(b.is_active, 1), always_full: bool(b.always_full, 0),
    cooperage: str(b.cooperage), wood_origin: str(b.wood_origin), toast_level: str(b.toast_level), barrel_format: str(b.barrel_format), acquisition_date: str(b.acquisition_date), notes: str(b.notes),
  };
}
const VESSEL_COLS = ['code', 'capacity_l', 'vessel_type', 'material', 'kind', 'location_id', 'is_active', 'always_full', 'cooperage', 'wood_origin', 'toast_level', 'barrel_format', 'acquisition_date', 'notes'];
const insertVesselStmt = (env, f) => env.DB.prepare(`INSERT INTO vessels (${VESSEL_COLS.join(',')}) VALUES (${VESSEL_COLS.map(() => '?').join(',')})`).bind(...VESSEL_COLS.map((c) => f[c]));

async function createVessel(env, b) {
  const f = vesselFields(b);
  if (await env.DB.prepare('SELECT 1 FROM vessels WHERE code = ?').bind(f.code).first()) fail(409, `Ya existe el recipiente ${f.code}`);
  const r = await insertVesselStmt(env, f).run();
  return { ok: true, id: r.meta.last_row_id };
}
async function createVesselSequence(env, b) {
  const prefix = str(b.prefix); if (!prefix) fail(400, 'Falta el prefijo');
  const start = int(b.start) ?? 1, count = int(b.count) || 0, digits = int(b.digits) ?? 3;
  if (count < 1 || count > 200) fail(400, 'Cantidad entre 1 y 200');
  const codes = [];
  for (let i = 0; i < count; i++) codes.push(`${prefix}-${String(start + i).padStart(digits, '0')}`);
  const existing = (await env.DB.prepare(`SELECT code FROM vessels WHERE code IN (${codes.map(() => '?').join(',')})`).bind(...codes).all()).results.map((r) => r.code);
  if (existing.length) fail(409, `Ya existen: ${existing.join(', ')}`);
  await env.DB.batch(codes.map((code) => insertVesselStmt(env, vesselFields({ ...b, code }))));
  return { ok: true, created: codes };
}
async function importVessels(env, b) {
  const rows = Array.isArray(b.rows) ? b.rows : fail(400, 'Faltan filas');
  if (!rows.length || rows.length > 500) fail(400, 'Entre 1 y 500 filas');
  const fields = rows.map(vesselFields);
  const codes = fields.map((f) => f.code);
  if (new Set(codes).size !== codes.length) fail(400, 'Hay códigos repetidos en el archivo');
  const existing = (await env.DB.prepare(`SELECT code FROM vessels WHERE code IN (${codes.map(() => '?').join(',')})`).bind(...codes).all()).results.map((r) => r.code);
  const skip = new Set(existing);
  const toInsert = fields.filter((f) => !skip.has(f.code));
  if (toInsert.length) await env.DB.batch(toInsert.map((f) => insertVesselStmt(env, f)));
  return { ok: true, created: toInsert.length, skipped: existing };
}
async function updateVessel(env, id, b) {
  const cur = await env.DB.prepare('SELECT * FROM vessels WHERE id = ?').bind(id).first();
  if (!cur) fail(404, 'Recipiente no encontrado');
  const f = vesselFields({ ...cur, ...b });
  const dup = await env.DB.prepare('SELECT id FROM vessels WHERE code = ? AND id <> ?').bind(f.code, id).first();
  if (dup) fail(409, `Ya existe el recipiente ${f.code}`);
  await env.DB.prepare(`UPDATE vessels SET ${VESSEL_COLS.map((c) => `${c} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`).bind(...VESSEL_COLS.map((c) => f[c]), id).run();
  return { ok: true };
}
async function createLocation(env, b) {
  const name = str(b.name); if (!name) fail(400, 'Falta el nombre');
  const r = await env.DB.prepare('INSERT INTO locations (name, room, sort) VALUES (?, ?, ?)').bind(name, str(b.room), int(b.sort) || 0).run();
  return { ok: true, id: r.meta.last_row_id };
}
async function updateLocation(env, id, b) {
  await env.DB.prepare('UPDATE locations SET name = COALESCE(?, name), room = ?, sort = COALESCE(?, sort) WHERE id = ?').bind(str(b.name), str(b.room), int(b.sort), id).run();
  return { ok: true };
}
async function createProduct(env, b) {
  const name = str(b.name); if (!name) fail(400, 'Falta el nombre del producto');
  const r = await env.DB.prepare('INSERT INTO products (code, category, name, unit, supplier, min_stock, concentration_gl, apparent_vol_mlg, allergen, notes) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .bind(str(b.code), str(b.category) || 'other', name, str(b.unit) || 'g', str(b.supplier), num(b.min_stock), num(b.concentration_gl), num(b.apparent_vol_mlg), bool(b.allergen, 0), str(b.notes)).run();
  return { ok: true, id: r.meta.last_row_id };
}
async function updateProduct(env, id, b) {
  await env.DB.prepare('UPDATE products SET code = ?, category = ?, name = ?, unit = ?, supplier = ?, min_stock = ?, concentration_gl = ?, apparent_vol_mlg = ?, allergen = ?, notes = ? WHERE id = ?')
    .bind(str(b.code), str(b.category) || 'other', str(b.name), str(b.unit) || 'g', str(b.supplier), num(b.min_stock), num(b.concentration_gl), num(b.apparent_vol_mlg), bool(b.allergen, 0), str(b.notes), id).run();
  return { ok: true };
}
async function createUser(env, b) {
  const name = str(b.name); if (!name) fail(400, 'Falta el nombre');
  const r = await env.DB.prepare('INSERT INTO users (name, initials, role) VALUES (?, ?, ?)').bind(name, str(b.initials), b.role === 'admin' ? 'admin' : 'crew').run();
  return { ok: true, id: r.meta.last_row_id };
}
async function updateLot(env, id, b) {
  const cur = await env.DB.prepare('SELECT * FROM lots WHERE id = ?').bind(id).first();
  if (!cur) fail(404, 'Lote no encontrado');
  const code = str(b.code) || cur.code;
  const dup = await env.DB.prepare('SELECT id FROM lots WHERE code = ? AND id <> ?').bind(code, id).first();
  if (dup) fail(409, `Ya existe el lote ${code}`);
  await env.DB.prepare('UPDATE lots SET code = ?, wine_type = ?, vintage = ?, varieties = ?, phase = ?, fermentation_done = ?, notes = ? WHERE id = ?')
    .bind(code, str(b.wine_type) || cur.wine_type, int(b.vintage) ?? cur.vintage, b.varieties === undefined ? cur.varieties : str(b.varieties), str(b.phase) || cur.phase, b.fermentation_done === undefined ? cur.fermentation_done : bool(b.fermentation_done, 1), b.notes === undefined ? cur.notes : str(b.notes), id).run();
  return { ok: true };
}

async function nextLotCode(env, wineType, vintage) {
  const y = String((vintage || new Date().getFullYear()) % 100).padStart(2, '0');
  const prefix = `${y}-${WINE_ABBR[wineType] || 'LT'}-`;
  const r = await env.DB.prepare('SELECT COUNT(*) AS n FROM lots WHERE code LIKE ?').bind(prefix + '%').first();
  let n = (r.n || 0) + 1, code;
  do { code = prefix + String(n).padStart(3, '0'); n++; } while (await env.DB.prepare('SELECT 1 FROM lots WHERE code = ?').bind(code).first());
  return code;
}

// Saldos de apertura: una fila por recipiente con vino → crea el lote y su estancia.
async function openingBalances(env, b) {
  const rows = Array.isArray(b.rows) ? b.rows : fail(400, 'Faltan filas');
  if (!rows.length) fail(400, 'No hay filas');
  const date = str(b.date) || mxToday();
  const stmts = [], created = [];
  const vids = rows.map((r) => int(r.vessel_id)).filter(Boolean);
  const occupied = vids.length ? (await env.DB.prepare(`SELECT v.code FROM stays s JOIN vessels v ON v.id = s.vessel_id WHERE s.left_at IS NULL AND s.vessel_id IN (${vids.map(() => '?').join(',')})`).bind(...vids).all()).results.map((r) => r.code) : [];
  if (occupied.length) fail(409, `Ya tienen vino: ${occupied.join(', ')}`);
  if (new Set(vids).size !== vids.length) fail(400, 'Un recipiente aparece dos veces');
  const codes = new Set();
  for (const r of rows) {
    const vessel_id = int(r.vessel_id); if (!vessel_id) fail(400, 'Falta el recipiente en una fila');
    const volume = num(r.volume); if (!volume || volume <= 0) fail(400, 'Volumen inválido');
    const wine_type = str(r.wine_type) || 'blanco', vintage = int(r.vintage);
    let code = str(r.code) || await nextLotCode(env, wine_type, vintage);
    if (codes.has(code)) fail(400, `Código de lote repetido: ${code}`);
    codes.add(code);
    if (await env.DB.prepare('SELECT 1 FROM lots WHERE code = ?').bind(code).first()) fail(409, `Ya existe el lote ${code}`);
    const unit = r.unit === 'kg' ? 'kg' : 'L';
    stmts.push(env.DB.prepare('INSERT INTO lots (code, wine_type, vintage, varieties, phase, creation_method, unit, fermentation_done, notes) VALUES (?,?,?,?,?,?,?,?,?)')
      .bind(code, wine_type, vintage, str(r.varieties), str(r.phase) || 'crianza', 'manual', unit, bool(r.fermentation_done, 1), str(r.notes)));
    stmts.push(env.DB.prepare('INSERT INTO stays (lot_id, vessel_id, entered_at, volume_in, volume, unit) VALUES ((SELECT id FROM lots WHERE code = ?), ?, ?, ?, ?, ?)')
      .bind(code, vessel_id, date, volume, volume, unit));
    created.push(code);
  }
  await env.DB.batch(stmts);
  return { ok: true, created };
}

// ---------------------------------------------------------------- operations
const emptyPayload = () => ({ origins: [], destinations: [], products: [] });

function normalizePayload(b) {
  const type = str(b.type);
  if (!TYPES.includes(type)) fail(400, 'Tipo de operación inválido');
  const p = {
    type, op_date: str(b.op_date) || mxToday(), operator_id: int(b.operator_id), notes: str(b.notes),
    mode: str(b.mode), press_vessel_id: int(b.press_vessel_id), buyer: str(b.buyer),
    volume_l: num(b.volume_l), loss_l: num(b.loss_l) || 0, lees_l: num(b.lees_l) || 0, lees_vessel_id: int(b.lees_vessel_id), lees_lot_code: str(b.lees_lot_code),
    new_lot: b.new_lot && typeof b.new_lot === 'object' ? { create: !!b.new_lot.create, code: str(b.new_lot.code), wine_type: str(b.new_lot.wine_type), vintage: int(b.new_lot.vintage), varieties: str(b.new_lot.varieties), phase: str(b.new_lot.phase) } : null,
    origins: (Array.isArray(b.origins) ? b.origins : []).map((o) => ({ vessel_id: int(o.vessel_id), volume: num(o.volume) })).filter((o) => o.vessel_id),
    destinations: (Array.isArray(b.destinations) ? b.destinations : []).map((d) => ({ vessel_id: int(d.vessel_id), volume: num(d.volume), new_lot_code: str(d.new_lot_code), fraction: str(d.fraction) })).filter((d) => d.vessel_id),
    products: (Array.isArray(b.products) ? b.products : []).map((x) => ({ product_id: int(x.product_id), product_name: str(x.product_name), qty: num(x.qty), unit: str(x.unit), note: str(x.note) })).filter((x) => x.product_id || x.product_name),
  };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.op_date)) fail(400, 'Fecha inválida');
  if (p.loss_l < 0 || p.lees_l < 0) fail(400, 'Merma y lías no pueden ser negativas');
  return p;
}

async function saveOperation(env, id, b) {
  const p = normalizePayload(b);
  const status = b.status === 'confirmed' ? 'confirmed' : 'draft';
  const operator = p.operator_id ? await env.DB.prepare('SELECT name FROM users WHERE id = ?').bind(p.operator_id).first() : null;
  let op;
  if (id) {
    op = await env.DB.prepare('SELECT * FROM operations WHERE id = ?').bind(id).first();
    if (!op) fail(404, 'Operación no encontrada');
    if (op.status === 'confirmed') {
      // Una operación confirmada solo cambia de fecha, operario y notas; para cambiar volúmenes: Revertir y volver a crear.
      await env.DB.prepare('UPDATE operations SET op_date = ?, operator_id = ?, operator_name = ?, notes = ? WHERE id = ?').bind(p.op_date, p.operator_id, operator?.name || null, p.notes, id).run();
      return { ok: true, id, status: 'confirmed' };
    }
    if (op.status === 'reverted') fail(409, 'Una operación revertida no se edita');
    await env.DB.batch([
      env.DB.prepare('UPDATE operations SET type = ?, op_date = ?, operator_id = ?, operator_name = ?, mode = ?, press_vessel_id = ?, buyer = ?, volume_l = ?, loss_l = ?, lees_l = ?, lees_vessel_id = ?, lees_lot_code = ?, new_lot_json = ?, notes = ?, payload = ? WHERE id = ?')
        .bind(p.type, p.op_date, p.operator_id, operator?.name || null, p.mode, p.press_vessel_id, p.buyer, p.volume_l, p.loss_l, p.lees_l, p.lees_vessel_id, p.lees_lot_code, p.new_lot ? JSON.stringify(p.new_lot) : null, p.notes, JSON.stringify(p), id),
      env.DB.prepare('DELETE FROM operation_lines WHERE operation_id = ?').bind(id),
    ]);
  } else {
    const r = await env.DB.prepare('INSERT INTO operations (type, op_date, operator_id, operator_name, status, mode, press_vessel_id, buyer, volume_l, loss_l, lees_l, lees_vessel_id, lees_lot_code, new_lot_json, notes, payload) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(p.type, p.op_date, p.operator_id, operator?.name || null, 'draft', p.mode, p.press_vessel_id, p.buyer, p.volume_l, p.loss_l, p.lees_l, p.lees_vessel_id, p.lees_lot_code, p.new_lot ? JSON.stringify(p.new_lot) : null, p.notes, JSON.stringify(p)).run();
    id = r.meta.last_row_id;
  }
  if (status === 'draft') {
    const dl = draftLines(env, id, p);
    if (dl.length) await env.DB.batch(dl);
    return { ok: true, id, status: 'draft' };
  }
  try {
    const result = await confirm(env, id, p);
    return { ok: true, id, status: 'confirmed', ...result };
  } catch (err) {
    // La operación queda como borrador con sus líneas, para corregir y reintentar.
    const dl = draftLines(env, id, p);
    if (dl.length) await env.DB.batch(dl);
    throw err;
  }
}

function draftLines(env, id, p) {
  const stmts = []; let sort = 0;
  const line = (side, x) => env.DB.prepare('INSERT INTO operation_lines (operation_id, side, vessel_id, volume, fraction, new_lot_code, product_id, product_name, qty, unit, line_note, sort) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
    .bind(id, side, x.vessel_id || null, x.volume ?? null, x.fraction || null, x.new_lot_code || null, x.product_id || null, x.product_name || null, x.qty ?? null, x.unit || null, x.note || null, sort++);
  for (const o of p.origins) stmts.push(line('origin', o));
  for (const d of p.destinations) stmts.push(line('destination', d));
  for (const x of p.products) stmts.push(line('product', x));
  return stmts;
}

async function deleteDraft(env, id) {
  const op = await env.DB.prepare('SELECT status FROM operations WHERE id = ?').bind(id).first();
  if (!op) fail(404, 'Operación no encontrada');
  if (op.status !== 'draft') fail(409, 'Solo se eliminan borradores; una operación confirmada se revierte');
  await env.DB.batch([env.DB.prepare('DELETE FROM operation_lines WHERE operation_id = ?').bind(id), env.DB.prepare('DELETE FROM operations WHERE id = ?').bind(id)]);
  return { ok: true };
}

// El motor: lee el estado actual, valida, y escribe todo en un solo batch (atómico en D1).
async function confirm(env, id, p) {
  const vmap = Object.fromEntries((await vesselsWithStays(env)).map((v) => [v.id, v]));
  const V = (vid) => vmap[vid] || fail(400, `Recipiente ${vid} no existe`);
  const stayOf = (vid) => { const v = V(vid); return v.stay_id ? { id: v.stay_id, lot_id: v.lot_id, lot_code: v.lot_code, wine_type: v.wine_type, vintage: v.vintage, varieties: v.varieties, phase: v.phase, volume: v.stay_volume, unit: v.stay_unit, vessel: v } : null; };
  const stmts = [], lines = [], undo = { stays: [], fills: [], lots: [] };
  let sort = 0;
  const addLine = (side, x) => lines.push({ side, ...x, sort: sort++ });
  const touched = new Set();
  const pending = {}; // vessel_id → volumen proyectado tras esta operación (para destinos repetidos)
  const emptiedNow = new Set(); // recipientes cuya estancia se cierra en esta misma operación

  const takeOut = (vid, amount, { closeIfEmpty = true } = {}) => {
    const s = stayOf(vid); if (!s || emptiedNow.has(vid)) fail(400, `${V(vid).code} está vacío`);
    const left = round1(s.volume - amount);
    if (left < -0.01) fail(400, `${s.vessel.code} tiene ${s.volume} ${s.unit}; no puede salir ${amount}`);
    undo.stays.push({ id: s.id, volume: s.volume, left_at: null, volume_out: null, closed_by_op: null });
    if (closeIfEmpty && left < 0.5) { stmts.push(env.DB.prepare('UPDATE stays SET volume = 0, left_at = ?, volume_out = ?, closed_by_op = ? WHERE id = ?').bind(p.op_date, s.volume, id, s.id)); emptiedNow.add(vid); pending[vid] = 0; }
    else { stmts.push(env.DB.prepare('UPDATE stays SET volume = ? WHERE id = ?').bind(left, s.id)); pending[vid] = left; }
    touched.add(vid);
    return s;
  };
  // lot: {id} existente o {code (nuevo), wine_type, vintage, varieties, phase, unit, creation_method, parent_lot_id}
  const putIn = (vid, amount, lot, unit = 'L', { allowOtherLot = false } = {}) => {
    const v = V(vid);
    const s = emptiedNow.has(vid) ? null : stayOf(vid);
    const projected = (pending[vid] ?? (s ? s.volume : 0)) + amount;
    if (unit === 'L' && v.capacity_l && projected > v.capacity_l * 1.02 + 0.5) fail(400, `${v.code} (${v.capacity_l} L) no cabe ${round1(projected)} L`);
    pending[vid] = projected;
    touched.add(vid);
    if (s) {
      const same = lot.id ? s.lot_id === lot.id : false;
      if (!same && !allowOtherLot) fail(400, `${v.code} contiene ${s.lot_code}; para mezclar lotes usa Coupage`);
      undo.stays.push({ id: s.id, volume: s.volume, left_at: null, volume_out: null, closed_by_op: null });
      stmts.push(env.DB.prepare('UPDATE stays SET volume = volume + ? WHERE id = ?').bind(amount, s.id));
      return { lot_id: s.lot_id, lot_code: s.lot_code };
    }
    if (lot.id) {
      stmts.push(env.DB.prepare('INSERT INTO stays (lot_id, vessel_id, entered_at, volume_in, volume, unit, opened_by_op) VALUES (?,?,?,?,?,?,?)').bind(lot.id, vid, p.op_date, amount, amount, unit, id));
    } else {
      stmts.push(env.DB.prepare('INSERT INTO stays (lot_id, vessel_id, entered_at, volume_in, volume, unit, opened_by_op) VALUES ((SELECT id FROM lots WHERE code = ?),?,?,?,?,?,?)').bind(lot.code, vid, p.op_date, amount, amount, unit, id));
    }
    if (BARREL_KINDS.has(v.kind)) { stmts.push(env.DB.prepare('UPDATE vessels SET fill_count = fill_count + 1 WHERE id = ?').bind(vid)); undo.fills.push(vid); }
    return { lot_id: lot.id || null, lot_code: lot.code };
  };
  const newLotsCreated = new Set();
  const createLot = async (lot) => {
    const code = lot.code || await nextLotCode(env, lot.wine_type, lot.vintage);
    if (newLotsCreated.has(code) || await env.DB.prepare('SELECT 1 FROM lots WHERE code = ?').bind(code).first()) fail(409, `Ya existe el lote ${code}`);
    newLotsCreated.add(code);
    stmts.unshift(env.DB.prepare('INSERT INTO lots (code, wine_type, vintage, varieties, phase, creation_method, unit, fermentation_done, parent_lot_id, created_by_op, notes) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .bind(code, lot.wine_type || 'blanco', lot.vintage ?? null, lot.varieties ?? null, lot.phase || 'crianza', lot.creation_method || 'split', lot.unit || 'L', lot.fermentation_done ?? 1, lot.parent_lot_id ?? null, id, lot.notes ?? null));
    undo.lots.push(code);
    return { code };
  };
  const cloneFrom = (s, code, method) => ({ code, wine_type: s.wine_type, vintage: s.vintage, varieties: s.varieties, phase: s.phase, creation_method: method, unit: 'L', parent_lot_id: s.lot_id });
  const lotRef = (s) => ({ id: s.lot_id, code: s.lot_code });
  const one = (arr, what) => { if (arr.length !== 1) fail(400, `Indica un ${what}`); return arr[0]; };

  // ---- lías (opcional, en los trasiegos): salen del origen y forman su propio lote en otro recipiente
  const handleLees = async (s) => {
    if (!p.lees_l) return;
    if (!p.lees_vessel_id) fail(400, 'Selecciona el recipiente de destino de las lías.');
    const ls = stayOf(p.lees_vessel_id);
    if (ls) { putIn(p.lees_vessel_id, p.lees_l, lotRef(ls), 'L', { allowOtherLot: true }); addLine('lees', { vessel_id: p.lees_vessel_id, lot_id: ls.lot_id, volume: p.lees_l }); }
    else {
      const lot = await createLot(cloneFrom(s, p.lees_lot_code || `${s.lot_code}-LIAS`, 'lees'));
      putIn(p.lees_vessel_id, p.lees_l, lot, 'L');
      addLine('lees', { vessel_id: p.lees_vessel_id, lot_code: lot.code, volume: p.lees_l, new_lot_code: lot.code });
    }
  };

  switch (p.type) {
    case 'racking': case 'filtration': case 'decantation': {
      const o = one(p.origins, 'depósito de origen');
      const s = stayOf(o.vessel_id) || fail(400, `${V(o.vessel_id).code} está vacío`);
      if (!p.destinations.length) fail(400, 'Indica al menos un depósito de destino');
      const dests = p.destinations.map((d) => ({ ...d }));
      const blank = dests.filter((d) => d.volume == null);
      const fixed = dests.reduce((a, d) => a + (d.volume || 0), 0);
      if (blank.length > 1) fail(400, 'Con varios destinos, indica los litros de cada uno (puedes dejar uno en blanco)');
      const available = s.volume - p.loss_l - p.lees_l;
      if (blank.length === 1) blank[0].volume = round1(available - fixed);
      if (blank[0] && blank[0].volume <= 0) fail(400, 'No queda volumen para el destino en blanco');
      const total = dests.reduce((a, d) => a + d.volume, 0) + p.loss_l + p.lees_l;
      if (total > s.volume + 0.5) fail(400, `Sale ${round1(total)} L pero ${s.vessel.code} solo tiene ${s.volume} L`);
      takeOut(o.vessel_id, total);
      addLine('origin', { vessel_id: o.vessel_id, lot_id: s.lot_id, volume: round1(total - p.loss_l - p.lees_l) });
      for (const d of dests) {
        if (d.vessel_id === o.vessel_id) fail(400, 'Origen y destino son el mismo recipiente');
        let lot = lotRef(s);
        if (p.new_lot?.create || d.new_lot_code) lot = await createLot(cloneFrom(s, d.new_lot_code || p.new_lot?.code, 'split'));
        const r = putIn(d.vessel_id, d.volume, lot);
        addLine('destination', { vessel_id: d.vessel_id, lot_id: r.lot_id, lot_code: r.lot_code, volume: d.volume, new_lot_code: lot.id ? null : lot.code });
      }
      await handleLees(s);
      break;
    }
    case 'barrel_transfer': {
      const mode = p.mode === 'empty' ? 'empty' : 'fill';
      if (mode === 'fill') {
        const o = one(p.origins, 'depósito de origen');
        const s = stayOf(o.vessel_id) || fail(400, `${V(o.vessel_id).code} está vacío`);
        if (!p.destinations.length) fail(400, 'Selecciona las barricas a llenar');
        const dests = p.destinations.map((d) => { const v = V(d.vessel_id); const cur = stayOf(d.vessel_id); return { ...d, volume: d.volume ?? round1(v.capacity_l - (cur ? cur.volume : 0)) }; });
        const total = dests.reduce((a, d) => a + d.volume, 0) + p.loss_l;
        if (total > s.volume + 0.5) fail(400, `Las barricas suman ${round1(total)} L y ${s.vessel.code} solo tiene ${s.volume} L`);
        takeOut(o.vessel_id, total);
        addLine('origin', { vessel_id: o.vessel_id, lot_id: s.lot_id, volume: round1(total - p.loss_l) });
        for (const d of dests) { const r = putIn(d.vessel_id, d.volume, lotRef(s)); addLine('destination', { vessel_id: d.vessel_id, lot_id: r.lot_id, volume: d.volume }); }
      } else {
        if (!p.origins.length) fail(400, 'Selecciona las barricas a vaciar');
        const d = one(p.destinations, 'depósito de destino');
        const lotIds = new Set(), ins = [];
        let total = 0;
        for (const o of p.origins) {
          const s = stayOf(o.vessel_id) || fail(400, `${V(o.vessel_id).code} está vacía`);
          const amount = o.volume ?? s.volume;
          takeOut(o.vessel_id, amount); total += amount; lotIds.add(s.lot_id);
          addLine('origin', { vessel_id: o.vessel_id, lot_id: s.lot_id, volume: amount }); ins.push(s);
        }
        if (lotIds.size > 1) fail(400, 'Las barricas tienen lotes distintos; usa Coupage para juntarlos');
        const vol = round1(total - p.loss_l);
        const r = putIn(d.vessel_id, vol, lotRef(ins[0]));
        addLine('destination', { vessel_id: d.vessel_id, lot_id: r.lot_id, volume: vol });
      }
      break;
    }
    case 'bleeding': {
      const o = one(p.origins, 'depósito de maceración');
      const s = stayOf(o.vessel_id) || fail(400, `${V(o.vessel_id).code} está vacío`);
      if (s.unit !== 'kg') fail(400, `${s.vessel.code} no está en maceración (su lote está en litros)`);
      const d = one(p.destinations, 'depósito de destino');
      const amount = p.volume_l || d.volume; if (!amount) fail(400, 'Indica el mosto a sangrar (L)');
      takeOut(o.vessel_id, amount); // 1 kg por litro sangrado
      addLine('origin', { vessel_id: o.vessel_id, lot_id: s.lot_id, volume: amount, unit: 'kg' });
      const r = putIn(d.vessel_id, amount, lotRef(s), 'L');
      addLine('destination', { vessel_id: d.vessel_id, lot_id: r.lot_id, volume: amount, unit: 'L' });
      break;
    }
    case 'pressing': {
      const o = one(p.origins, 'depósito de maceración');
      const s = stayOf(o.vessel_id) || fail(400, `${V(o.vessel_id).code} está vacío`);
      if (!p.destinations.length) fail(400, 'Añade al menos una fracción de prensado');
      takeOut(o.vessel_id, s.volume); // se prensa todo lo que hay
      addLine('origin', { vessel_id: o.vessel_id, lot_id: s.lot_id, volume: s.volume, unit: s.unit });
      for (const d of p.destinations) {
        if (!d.volume) fail(400, 'Cada fracción necesita litros');
        const fr = d.fraction || 'free_run';
        const lot = await createLot({ ...cloneFrom(s, d.new_lot_code || `${s.lot_code}-${FRACTION_SUFFIX[fr] || 'X'}`, 'pressing'), phase: 'fermentacion', fermentation_done: 0 });
        putIn(d.vessel_id, d.volume, lot);
        addLine('destination', { vessel_id: d.vessel_id, lot_code: lot.code, volume: d.volume, fraction: fr, new_lot_code: lot.code });
      }
      if (p.press_vessel_id) addLine('press', { vessel_id: p.press_vessel_id, volume: null });
      break;
    }
    case 'addition': {
      const o = one(p.origins, 'depósito de vino');
      const s = stayOf(o.vessel_id) || fail(400, `${V(o.vessel_id).code} está vacío`);
      if (!p.products.length) fail(400, 'Añade al menos un producto');
      touched.add(o.vessel_id);
      addLine('origin', { vessel_id: o.vessel_id, lot_id: s.lot_id, volume: null });
      for (const x of p.products) addLine('product', { vessel_id: o.vessel_id, lot_id: s.lot_id, product_id: x.product_id, product_name: x.product_name, qty: x.qty, unit: x.unit, note: x.note });
      break;
    }
    case 'topping': {
      const d = one(p.destinations, 'depósito a rellenar');
      const ds = stayOf(d.vessel_id) || fail(400, `${V(d.vessel_id).code} está vacío; un rellenado necesita vino dentro`);
      const amount = p.volume_l || d.volume; if (!amount) fail(400, 'Indica los litros del rellenado');
      if (p.origins.length) {
        const o = one(p.origins, 'origen del rellenado');
        const s = takeOut(o.vessel_id, amount);
        addLine('origin', { vessel_id: o.vessel_id, lot_id: s.lot_id, volume: amount });
      }
      putIn(d.vessel_id, amount, lotRef(ds), 'L', { allowOtherLot: true });
      addLine('destination', { vessel_id: d.vessel_id, lot_id: ds.lot_id, volume: amount });
      break;
    }
    case 'bulk_sale': {
      const o = one(p.origins, 'depósito de vino');
      const amount = p.volume_l || o.volume; if (!amount) fail(400, 'Indica los litros vendidos');
      const s = takeOut(o.vessel_id, amount);
      addLine('origin', { vessel_id: o.vessel_id, lot_id: s.lot_id, volume: amount });
      break;
    }
    case 'blend': {
      if (!p.origins.length) fail(400, 'Añade los lotes de origen');
      if (!p.destinations.length) fail(400, 'Indica el depósito de destino');
      const nl = p.new_lot || {};
      let total = 0; const srcs = [];
      for (const o of p.origins) {
        const s = stayOf(o.vessel_id) || fail(400, `${V(o.vessel_id).code} está vacío`);
        const amount = o.volume ?? s.volume;
        takeOut(o.vessel_id, amount); total += amount; srcs.push(s);
        addLine('origin', { vessel_id: o.vessel_id, lot_id: s.lot_id, volume: amount });
      }
      const first = srcs[0];
      const lot = await createLot({ code: nl.code, wine_type: nl.wine_type || first.wine_type, vintage: nl.vintage ?? first.vintage, varieties: nl.varieties || [...new Set(srcs.map((s) => s.varieties).filter(Boolean))].join(', ') || null, phase: nl.phase || first.phase, creation_method: 'blend', unit: 'L', parent_lot_id: first.lot_id, notes: `Coupage de ${srcs.map((s) => s.lot_code).join(' + ')}` });
      const dests = p.destinations.map((d) => ({ ...d }));
      const blank = dests.filter((d) => d.volume == null);
      const fixed = dests.reduce((a, d) => a + (d.volume || 0), 0);
      const available = round1(total - p.loss_l);
      if (blank.length > 1) fail(400, 'Con varios destinos indica los litros de cada uno');
      if (blank.length === 1) blank[0].volume = round1(available - fixed);
      const sum = dests.reduce((a, d) => a + d.volume, 0);
      if (Math.abs(sum - available) > 0.5) fail(400, `Los destinos suman ${round1(sum)} L y el coupage tiene ${available} L`);
      for (const d of dests) {
        // El destino debe estar vacío, o vaciarse en esta misma operación (coupage en el propio tanque).
        if (stayOf(d.vessel_id) && !emptiedNow.has(d.vessel_id)) fail(400, `${V(d.vessel_id).code} no está vacío`);
        putIn(d.vessel_id, d.volume, lot, 'L');
        addLine('destination', { vessel_id: d.vessel_id, lot_code: lot.code, volume: d.volume, new_lot_code: lot.code });
      }
      break;
    }
    default: fail(400, 'Tipo no soportado');
  }

  // Líneas, estado y deshacer
  stmts.push(env.DB.prepare('DELETE FROM operation_lines WHERE operation_id = ?').bind(id));
  for (const l of lines) {
    stmts.push(env.DB.prepare('INSERT INTO operation_lines (operation_id, side, vessel_id, lot_id, volume, fraction, new_lot_code, product_id, product_name, qty, unit, line_note, sort) VALUES (?,?,?,' + (l.lot_id ? '?' : '(SELECT id FROM lots WHERE code = ?)') + ',?,?,?,?,?,?,?,?,?)')
      .bind(id, l.side, l.vessel_id || null, l.lot_id || l.lot_code || null, l.volume ?? null, l.fraction || null, l.new_lot_code || null, l.product_id || null, l.product_name || null, l.qty ?? null, l.unit || null, l.note || null, l.sort));
  }
  stmts.push(env.DB.prepare("UPDATE operations SET status = 'confirmed', confirmed_at = datetime('now'), payload = ?, undo = ? WHERE id = ?").bind(JSON.stringify(p), JSON.stringify(undo), id));
  await env.DB.batch(stmts);
  return { touched: [...touched] };
}

async function revertOperation(env, id) {
  const op = await env.DB.prepare('SELECT * FROM operations WHERE id = ?').bind(id).first();
  if (!op) fail(404, 'Operación no encontrada');
  if (op.status !== 'confirmed') fail(409, 'Solo se revierte una operación confirmada');
  const undo = op.undo ? JSON.parse(op.undo) : { stays: [], fills: [], lots: [] };
  const vids = (await env.DB.prepare('SELECT DISTINCT vessel_id FROM operation_lines WHERE operation_id = ? AND vessel_id IS NOT NULL').bind(id).all()).results.map((r) => r.vessel_id);
  if (vids.length) {
    const later = await env.DB.prepare(`SELECT o.id, o.type, o.op_date FROM operations o JOIN operation_lines ol ON ol.operation_id = o.id WHERE o.status = 'confirmed' AND o.id > ? AND ol.vessel_id IN (${vids.map(() => '?').join(',')}) ORDER BY o.id LIMIT 1`).bind(id, ...vids).first();
    if (later) fail(409, `Primero revierte la operación #${later.id} (${later.type}, ${later.op_date}), que tocó los mismos recipientes después`);
  }
  const stmts = [env.DB.prepare('DELETE FROM stays WHERE opened_by_op = ?').bind(id)];
  for (const s of undo.stays) stmts.push(env.DB.prepare('UPDATE stays SET volume = ?, left_at = ?, volume_out = ?, closed_by_op = ? WHERE id = ?').bind(s.volume, s.left_at, s.volume_out, s.closed_by_op, s.id));
  for (const v of undo.fills || []) stmts.push(env.DB.prepare('UPDATE vessels SET fill_count = MAX(0, fill_count - 1) WHERE id = ?').bind(v));
  for (const code of undo.lots || []) stmts.push(env.DB.prepare('DELETE FROM lots WHERE code = ? AND created_by_op = ? AND NOT EXISTS (SELECT 1 FROM stays WHERE stays.lot_id = lots.id) AND NOT EXISTS (SELECT 1 FROM analyses WHERE analyses.lot_id = lots.id) AND NOT EXISTS (SELECT 1 FROM tastings WHERE tastings.lot_id = lots.id) AND NOT EXISTS (SELECT 1 FROM lots c WHERE c.parent_lot_id = lots.id)').bind(code, id));
  stmts.push(env.DB.prepare("UPDATE operations SET status = 'reverted', reverted_at = datetime('now') WHERE id = ?").bind(id));
  await env.DB.batch(stmts);
  return { ok: true };
}

// ---------------------------------------------------------------- records
async function lotOfVessel(env, vessel_id) {
  const s = await env.DB.prepare('SELECT lot_id FROM stays WHERE vessel_id = ? AND left_at IS NULL').bind(vessel_id).first();
  return s ? s.lot_id : null;
}
async function createAnalysis(env, b) {
  const vessel_id = int(b.vessel_id); let lot_id = int(b.lot_id);
  if (!lot_id && vessel_id) lot_id = await lotOfVessel(env, vessel_id);
  if (!lot_id) fail(400, 'Indica el depósito con vino');
  const cols = ['alcohol', 'va', 'ta', 'ph', 'so2_free', 'so2_bound', 'so2_total', 'so2_molecular', 'malic', 'lactic', 'rs', 'brix', 'temp'];
  const r = await env.DB.prepare(`INSERT INTO analyses (lot_id, vessel_id, analysed_at, ${cols.join(',')}, analysed_by, source, notes) VALUES (?,?,?,${cols.map(() => '?').join(',')},?,?,?)`)
    .bind(lot_id, vessel_id, str(b.analysed_at) || mxToday(), ...cols.map((c) => num(b[c])), str(b.analysed_by), str(b.source), str(b.notes)).run();
  return { ok: true, id: r.meta.last_row_id };
}
async function createTasting(env, b) {
  const vessel_id = int(b.vessel_id); let lot_id = int(b.lot_id);
  if (!lot_id && vessel_id) lot_id = await lotOfVessel(env, vessel_id);
  if (!lot_id) fail(400, 'Indica el depósito con vino');
  const r = await env.DB.prepare('INSERT INTO tastings (lot_id, vessel_id, tasted_at, taster, phase, score, blind, appearance, nose, palate, finish, overall, notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .bind(lot_id, vessel_id, str(b.tasted_at) || mxToday(), str(b.taster), str(b.phase), num(b.score), bool(b.blind, 0), str(b.appearance), str(b.nose), str(b.palate), str(b.finish), str(b.overall), str(b.notes)).run();
  return { ok: true, id: r.meta.last_row_id };
}
async function createCleaning(env, b) {
  const vessel_id = int(b.vessel_id); if (!vessel_id) fail(400, 'Indica el recipiente');
  const r = await env.DB.prepare('INSERT INTO cleaning_records (vessel_id, cleaned_at, by_name, method, notes) VALUES (?,?,?,?,?)').bind(vessel_id, str(b.cleaned_at) || mxToday(), str(b.by_name), str(b.method), str(b.notes)).run();
  return { ok: true, id: r.meta.last_row_id };
}
