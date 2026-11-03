// Viñedo: parcelas, fenología, labores de campo, spray log (aplicaciones + catálogo de insumos), maduración.
import { fail, json, num, int, str, bool, jsonArr, dateOk, seasonOf, mxToday, all, one, run } from './lib.js';

const STAGES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N'];
const FIELD_OPS = ['pruning', 'tying', 'green_pruning', 'cluster_thinning', 'leaf_removal', 'cover_crop', 'trellising', 'shoot_thinning', 'grafting', 'under_vine_tillage', 'canopy', 'trellis_maintenance', 'uprooting', 'planting', 'replanting', 'cane_shredding', 'mowing', 'cover_sowing', 'inter_row_tillage', 'mech_weeding', 'topping', 'bird_nets', 'frost_protection', 'beneficials', 'mating_disruption', 'irrigation'];

export async function route({ m, p, env, body, q }) {
  let r;
  // parcelas
  if (m === 'GET' && p === '/parcels') return json({ parcels: await parcels(env) });
  if (m === 'POST' && p === '/parcels') return json(await saveParcel(env, null, await body()));
  if (m === 'POST' && p === '/parcels/import') return json(await importParcels(env, await body()));
  if ((r = p.match(/^\/parcels\/(\d+)$/)) && m === 'PUT') return json(await saveParcel(env, +r[1], await body()));
  if ((r = p.match(/^\/parcels\/(\d+)$/)) && m === 'GET') return json(await parcelDetail(env, +r[1]));
  // fenología
  if (m === 'GET' && p === '/phenology') return json({ records: await all(env, 'SELECT ph.*, pa.code AS parcel_code FROM phenology ph JOIN parcels pa ON pa.id = ph.parcel_id' + (q('parcel') ? ' WHERE ph.parcel_id = ?' : '') + (q('season') ? (q('parcel') ? ' AND' : ' WHERE') + ' ph.season = ?' : '') + ' ORDER BY ph.observed_at DESC, ph.id DESC', ...[q('parcel'), q('season')].filter(Boolean).map(Number)) });
  if (m === 'POST' && p === '/phenology') return json(await savePhenology(env, await body()));
  if (m === 'POST' && p === '/phenology/batch') return json(await batchPhenology(env, await body()));
  if ((r = p.match(/^\/phenology\/(\d+)$/)) && m === 'DELETE') { await run(env, 'DELETE FROM phenology WHERE id = ?', +r[1]); return json({ ok: true }); }
  // labores
  if (m === 'GET' && p === '/field-ops') return json({ ops: (await all(env, 'SELECT * FROM field_ops ORDER BY started_at DESC, id DESC')).map((o) => ({ ...o, parcel_ids: jsonArr(o.parcel_ids) })) });
  if (m === 'POST' && p === '/field-ops') return json(await saveFieldOp(env, null, await body()));
  if ((r = p.match(/^\/field-ops\/(\d+)$/)) && m === 'PUT') return json(await saveFieldOp(env, +r[1], await body()));
  if ((r = p.match(/^\/field-ops\/(\d+)$/)) && m === 'DELETE') { await run(env, 'DELETE FROM field_ops WHERE id = ?', +r[1]); return json({ ok: true }); }
  // spray log
  if (m === 'GET' && p === '/spray/inputs') return json({ inputs: await all(env, 'SELECT * FROM spray_inputs ORDER BY is_active DESC, name') });
  if (m === 'POST' && p === '/spray/inputs') return json(await saveInput(env, null, await body()));
  if ((r = p.match(/^\/spray\/inputs\/(\d+)$/)) && m === 'PUT') return json(await saveInput(env, +r[1], await body()));
  if (m === 'GET' && p === '/spray/apps') return json({ apps: (await all(env, 'SELECT * FROM spray_apps ORDER BY started_at DESC, id DESC')).map(hydrateApp), restrictions: await restrictions(env) });
  if (m === 'POST' && p === '/spray/apps') return json(await saveApp(env, null, await body()));
  if ((r = p.match(/^\/spray\/apps\/(\d+)$/)) && m === 'PUT') return json(await saveApp(env, +r[1], await body()));
  // maduración
  if (m === 'GET' && p === '/maturation') return json({ samples: await all(env, 'SELECT ms.*, pa.code AS parcel_code, pa.variety, pa.wine_type FROM maturation_samples ms JOIN parcels pa ON pa.id = ms.parcel_id ORDER BY ms.sampled_at DESC, ms.id DESC') });
  if (m === 'POST' && p === '/maturation') return json(await saveSample(env, null, await body()));
  if (m === 'POST' && p === '/maturation/import') return json(await importSamples(env, await body()));
  if ((r = p.match(/^\/maturation\/(\d+)$/)) && m === 'PUT') return json(await saveSample(env, +r[1], await body()));
  if ((r = p.match(/^\/maturation\/(\d+)$/)) && m === 'DELETE') { await run(env, 'DELETE FROM maturation_samples WHERE id = ?', +r[1]); return json({ ok: true }); }
  return null;
}

export async function parcels(env) {
  const rows = await all(env, `SELECT pa.*, (SELECT stage FROM phenology ph WHERE ph.parcel_id = pa.id ORDER BY observed_at DESC, id DESC LIMIT 1) AS last_stage,
      (SELECT observed_at FROM phenology ph WHERE ph.parcel_id = pa.id ORDER BY observed_at DESC, id DESC LIMIT 1) AS last_stage_at,
      (SELECT MAX(sampled_at) FROM maturation_samples ms WHERE ms.parcel_id = pa.id) AS last_sample_at
    FROM parcels pa ORDER BY pa.is_active DESC, pa.vineyard, pa.code`);
  return rows.map((r) => ({ ...r, geojson: r.geojson ? JSON.parse(r.geojson) : null }));
}
function parcelFields(b) {
  const code = str(b.code); if (!code) fail(400, 'Falta el código de parcela');
  const vineyard = str(b.vineyard); if (!vineyard) fail(400, 'Falta el viñedo');
  const variety = str(b.variety); if (!variety) fail(400, 'Falta la variedad');
  const area = num(b.area_ha); if (!area || area <= 0) fail(400, 'Superficie inválida');
  return { code, vineyard, variety, area_ha: area, planted_year: int(b.planted_year), wine_type: str(b.wine_type), appellation: str(b.appellation), locality: str(b.locality), target_wine: str(b.target_wine), soil: str(b.soil), orientation: str(b.orientation), spacing: str(b.spacing), rootstock: str(b.rootstock), clone: str(b.clone), irrigation: str(b.irrigation), production_mode: str(b.production_mode), vines: int(b.vines), expected_yield_t_ha: num(b.expected_yield_t_ha), irrigation_method: str(b.irrigation_method), ec: num(b.ec), geojson: b.geojson ? JSON.stringify(b.geojson) : null, notes: str(b.notes), is_active: bool(b.is_active, 1) };
}
const PCOLS = ['code', 'vineyard', 'variety', 'area_ha', 'planted_year', 'wine_type', 'appellation', 'locality', 'target_wine', 'soil', 'orientation', 'spacing', 'rootstock', 'clone', 'irrigation', 'production_mode', 'vines', 'expected_yield_t_ha', 'irrigation_method', 'ec', 'geojson', 'notes', 'is_active'];
async function saveParcel(env, id, b) {
  const f = parcelFields(id ? { ...(await one(env, 'SELECT * FROM parcels WHERE id = ?', id)), ...b } : b);
  const dup = await one(env, 'SELECT id FROM parcels WHERE code = ? AND id <> ?', f.code, id || 0);
  if (dup) fail(409, `Ya existe la parcela ${f.code}`);
  if (id) { await run(env, `UPDATE parcels SET ${PCOLS.map((c) => c + ' = ?').join(', ')} WHERE id = ?`, ...PCOLS.map((c) => f[c]), id); return { ok: true, id }; }
  const r = await run(env, `INSERT INTO parcels (${PCOLS.join(',')}) VALUES (${PCOLS.map(() => '?').join(',')})`, ...PCOLS.map((c) => f[c]));
  return { ok: true, id: r.meta.last_row_id };
}
async function importParcels(env, b) {
  const rows = Array.isArray(b.rows) ? b.rows : fail(400, 'Faltan filas');
  const fields = rows.map(parcelFields); const codes = fields.map((f) => f.code);
  const existing = codes.length ? (await all(env, `SELECT code FROM parcels WHERE code IN (${codes.map(() => '?').join(',')})`, ...codes)).map((r) => r.code) : [];
  const ins = fields.filter((f) => !existing.includes(f.code));
  if (ins.length) await env.DB.batch(ins.map((f) => env.DB.prepare(`INSERT INTO parcels (${PCOLS.join(',')}) VALUES (${PCOLS.map(() => '?').join(',')})`).bind(...PCOLS.map((c) => f[c]))));
  return { ok: true, created: ins.length, skipped: existing };
}
async function parcelDetail(env, id) {
  const parcel = await one(env, 'SELECT * FROM parcels WHERE id = ?', id); if (!parcel) fail(404, 'Parcela no encontrada');
  parcel.geojson = parcel.geojson ? JSON.parse(parcel.geojson) : null;
  const [phen, samples, receptions] = await Promise.all([
    all(env, 'SELECT * FROM phenology WHERE parcel_id = ? ORDER BY observed_at DESC LIMIT 30', id),
    all(env, 'SELECT * FROM maturation_samples WHERE parcel_id = ? ORDER BY sampled_at DESC LIMIT 30', id),
    all(env, 'SELECT * FROM harvest_receptions WHERE parcel_id = ? ORDER BY received_at DESC LIMIT 30', id),
  ]);
  const ops = (await all(env, 'SELECT * FROM field_ops ORDER BY started_at DESC')).filter((o) => jsonArr(o.parcel_ids).includes(id)).slice(0, 30);
  return { parcel, phenology: phen, samples, receptions, field_ops: ops };
}

async function savePhenology(env, b) {
  const parcel_id = int(b.parcel_id); if (!parcel_id) fail(400, 'Indica la parcela');
  const d = str(b.observed_at) || mxToday(); if (!dateOk(d)) fail(400, 'Fecha inválida');
  const stage = String(b.stage || '').trim().toUpperCase().slice(0, 1); if (!STAGES.includes(stage)) fail(400, 'Estadio inválido');
  const r = await run(env, 'INSERT INTO phenology (parcel_id, observed_at, season, stage, operator_name, notes) VALUES (?,?,?,?,?,?)', parcel_id, d, int(b.season) || seasonOf(d), stage, str(b.operator_name), str(b.notes));
  return { ok: true, id: r.meta.last_row_id };
}
async function batchPhenology(env, b) {
  const ids = (Array.isArray(b.parcel_ids) ? b.parcel_ids : []).map(Number).filter(Boolean); if (!ids.length) fail(400, 'Selecciona parcelas');
  const d = str(b.observed_at) || mxToday(); const stage = String(b.stage || '').trim().toUpperCase().slice(0, 1); if (!STAGES.includes(stage)) fail(400, 'Estadio inválido');
  await env.DB.batch(ids.map((pid) => env.DB.prepare('INSERT INTO phenology (parcel_id, observed_at, season, stage, operator_name, notes) VALUES (?,?,?,?,?,?)').bind(pid, d, int(b.season) || seasonOf(d), stage, str(b.operator_name), str(b.notes))));
  return { ok: true, created: ids.length };
}

async function saveFieldOp(env, id, b) {
  const op_type = str(b.op_type); if (!FIELD_OPS.includes(op_type)) fail(400, 'Tipo de labor inválido');
  const started = str(b.started_at) || mxToday(); if (!dateOk(started)) fail(400, 'Fecha inválida');
  const ended = str(b.ended_at); if (ended && ended < started) fail(400, 'La fecha final es anterior al inicio');
  const ids = (Array.isArray(b.parcel_ids) ? b.parcel_ids : []).map(Number).filter(Boolean); if (!ids.length) fail(400, 'Selecciona al menos una parcela');
  const args = [op_type, started, ended, JSON.stringify(ids), str(b.equipment), str(b.crew), str(b.notes)];
  if (id) { await run(env, 'UPDATE field_ops SET op_type = ?, started_at = ?, ended_at = ?, parcel_ids = ?, equipment = ?, crew = ?, notes = ? WHERE id = ?', ...args, id); return { ok: true, id }; }
  const r = await run(env, 'INSERT INTO field_ops (op_type, started_at, ended_at, parcel_ids, equipment, crew, notes) VALUES (?,?,?,?,?,?,?)', ...args);
  return { ok: true, id: r.meta.last_row_id };
}

async function saveInput(env, id, b) {
  const name = str(b.name); if (!name) fail(400, 'Falta el nombre del producto');
  const args = [str(b.input_type) || 'pesticide', name, str(b.registration_no), str(b.active_ingredient), num(b.rei_hours), num(b.phi_days), num(b.default_rate), str(b.unit), bool(b.is_active, 1), str(b.manufacturer), str(b.notes)];
  if (id) { await run(env, 'UPDATE spray_inputs SET input_type = ?, name = ?, registration_no = ?, active_ingredient = ?, rei_hours = ?, phi_days = ?, default_rate = ?, unit = ?, is_active = ?, manufacturer = ?, notes = ? WHERE id = ?', ...args, id); return { ok: true, id }; }
  const r = await run(env, 'INSERT INTO spray_inputs (input_type, name, registration_no, active_ingredient, rei_hours, phi_days, default_rate, unit, is_active, manufacturer, notes) VALUES (?,?,?,?,?,?,?,?,?,?,?)', ...args);
  return { ok: true, id: r.meta.last_row_id };
}
const hydrateApp = (a) => ({ ...a, blocks: jsonArr(a.blocks), products: jsonArr(a.products), history: a.history ? JSON.parse(a.history) : [] });
function appFields(b) {
  const started = str(b.started_at), ended = str(b.ended_at);
  if (!started || !ended) fail(400, 'Indica inicio y fin de la aplicación');
  if (ended < started) fail(400, 'El fin es anterior al inicio');
  const applicator = str(b.applicator); if (!applicator) fail(400, 'Falta el aplicador');
  const blocks = (Array.isArray(b.blocks) ? b.blocks : []).map((x) => ({ parcel_id: int(x.parcel_id), area_ha: num(x.area_ha) })).filter((x) => x.parcel_id);
  if (!blocks.length) fail(400, 'Añade al menos una parcela tratada');
  const products = (Array.isArray(b.products) ? b.products : []).map((x) => ({ input_id: int(x.input_id), input_type: str(x.input_type) || 'pesticide', name: str(x.name), registration_no: str(x.registration_no), active_ingredient: str(x.active_ingredient), target: str(x.target), rate: num(x.rate), unit: str(x.unit), total: num(x.total), rei_hours: num(x.rei_hours), phi_days: num(x.phi_days), notes: str(x.notes) })).filter((x) => x.name);
  if (!products.length) fail(400, 'Añade al menos un producto');
  for (const x of products) if (!x.active_ingredient) fail(400, `Falta el ingrediente activo de ${x.name}`);
  return { started_at: started, ended_at: ended, applicator, applicator_cert: str(b.applicator_cert), equipment: str(b.equipment), method: ['ground', 'air', 'other'].includes(b.method) ? b.method : 'ground', wind_kmh: num(b.wind_kmh), wind_dir: str(b.wind_dir), temp_c: num(b.temp_c), blocks, products, notes: str(b.notes) };
}
async function saveApp(env, id, b) {
  const f = appFields(b);
  if (id) {
    // Corrección: nunca se borra; la versión anterior queda en el historial y hace falta un motivo.
    const cur = await one(env, 'SELECT * FROM spray_apps WHERE id = ?', id); if (!cur) fail(404, 'Aplicación no encontrada');
    const reason = str(b.correction_reason); if (!reason) fail(400, 'Una corrección necesita un motivo');
    const history = cur.history ? JSON.parse(cur.history) : [];
    history.push({ version: cur.version, saved_at: new Date().toISOString(), reason, record: { ...hydrateApp(cur), history: undefined } });
    await run(env, 'UPDATE spray_apps SET started_at = ?, ended_at = ?, applicator = ?, applicator_cert = ?, equipment = ?, method = ?, wind_kmh = ?, wind_dir = ?, temp_c = ?, blocks = ?, products = ?, notes = ?, version = version + 1, correction_reason = ?, history = ? WHERE id = ?',
      f.started_at, f.ended_at, f.applicator, f.applicator_cert, f.equipment, f.method, f.wind_kmh, f.wind_dir, f.temp_c, JSON.stringify(f.blocks), JSON.stringify(f.products), f.notes, reason, JSON.stringify(history), id);
    return { ok: true, id };
  }
  const r = await run(env, 'INSERT INTO spray_apps (started_at, ended_at, applicator, applicator_cert, equipment, method, wind_kmh, wind_dir, temp_c, blocks, products, notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
    f.started_at, f.ended_at, f.applicator, f.applicator_cert, f.equipment, f.method, f.wind_kmh, f.wind_dir, f.temp_c, JSON.stringify(f.blocks), JSON.stringify(f.products), f.notes);
  return { ok: true, id: r.meta.last_row_id };
}
// Parcelas que siguen en plazo de reentrada o de seguridad (PHI) hoy
export async function restrictions(env) {
  const apps = (await all(env, "SELECT * FROM spray_apps WHERE ended_at >= date('now', '-120 days') ORDER BY ended_at DESC")).map(hydrateApp);
  const now = Date.now(), out = [];
  for (const a of apps) {
    const end = Date.parse(a.ended_at.length > 10 ? a.ended_at.replace(' ', 'T') : a.ended_at + 'T12:00');
    for (const pr of a.products) {
      const rei = pr.rei_hours ? end + pr.rei_hours * 3600e3 : 0, phi = pr.phi_days ? end + pr.phi_days * 864e5 : 0;
      for (const bl of a.blocks) {
        if (rei > now) out.push({ parcel_id: bl.parcel_id, kind: 'rei', until: new Date(rei).toISOString(), product: pr.name, app_id: a.id });
        if (phi > now) out.push({ parcel_id: bl.parcel_id, kind: 'phi', until: new Date(phi).toISOString().slice(0, 10), product: pr.name, app_id: a.id });
      }
    }
  }
  return out;
}

function sampleFields(b) {
  const parcel_id = int(b.parcel_id); if (!parcel_id) fail(400, 'Indica la parcela');
  const d = str(b.sampled_at) || mxToday(); if (!dateOk(d)) fail(400, 'Fecha inválida');
  return { parcel_id, sampled_at: d, season: int(b.season) || seasonOf(d), brix: num(b.brix), ph: num(b.ph), ta: num(b.ta), potential_alc: num(b.potential_alc), temp: num(b.temp), gluconic: num(b.gluconic), berry_weight_100: num(b.berry_weight_100), ammonium: num(b.ammonium), alpha_amino: num(b.alpha_amino), operator_name: str(b.operator_name), notes: str(b.notes) };
}
const SCOLS = ['parcel_id', 'sampled_at', 'season', 'brix', 'ph', 'ta', 'potential_alc', 'temp', 'gluconic', 'berry_weight_100', 'ammonium', 'alpha_amino', 'operator_name', 'notes'];
async function saveSample(env, id, b) {
  const f = sampleFields(b);
  if (id) { await run(env, `UPDATE maturation_samples SET ${SCOLS.map((c) => c + ' = ?').join(', ')} WHERE id = ?`, ...SCOLS.map((c) => f[c]), id); return { ok: true, id }; }
  const r = await run(env, `INSERT INTO maturation_samples (${SCOLS.join(',')}) VALUES (${SCOLS.map(() => '?').join(',')})`, ...SCOLS.map((c) => f[c]));
  return { ok: true, id: r.meta.last_row_id };
}
async function importSamples(env, b) {
  const rows = Array.isArray(b.rows) ? b.rows : fail(400, 'Faltan filas');
  const parcelsByCode = Object.fromEntries((await all(env, 'SELECT id, code FROM parcels')).map((p) => [p.code.toLowerCase(), p.id]));
  const fields = rows.map((r) => sampleFields({ ...r, parcel_id: r.parcel_id || parcelsByCode[String(r.parcel || r.parcela || '').toLowerCase()] }));
  await env.DB.batch(fields.map((f) => env.DB.prepare(`INSERT INTO maturation_samples (${SCOLS.join(',')}) VALUES (${SCOLS.map(() => '?').join(',')})`).bind(...SCOLS.map((c) => f[c]))));
  return { ok: true, created: fields.length };
}
