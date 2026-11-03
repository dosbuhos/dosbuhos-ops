// Vendimia: recepción de uva (crea los lotes de maceración o de mosto) y seguimiento de fermentaciones.
import { fail, json, num, int, str, dateOk, seasonOf, mxToday, mxNow, all, one, run } from './lib.js';
import { vesselsWithStays, newLotCode, lotAndStayStmts, occupiedCodes } from './core.js';

export async function route({ m, p, env, body, q }) {
  let r;
  if (m === 'GET' && p === '/harvest') return json({ receptions: await receptions(env, int(q('season'))) });
  if (m === 'POST' && p === '/harvest') return json(await createReception(env, await body()));
  if (m === 'POST' && p === '/harvest/import') return json(await importReceptions(env, await body()));
  if (m === 'GET' && p === '/fermentations') return json(await fermentations(env));
  if (m === 'GET' && p === '/fermentations/readings') return json({ readings: await all(env, 'SELECT fr.*, lo.code AS lot_code, v.code AS vessel_code FROM ferment_readings fr JOIN lots lo ON lo.id = fr.lot_id LEFT JOIN vessels v ON v.id = fr.vessel_id WHERE fr.lot_id = ? ORDER BY fr.read_at DESC, fr.id DESC', int(q('lot'))) });
  if (m === 'POST' && p === '/fermentations/readings') return json(await createReading(env, await body()));
  if ((r = p.match(/^\/fermentations\/readings\/(\d+)$/)) && m === 'DELETE') { await run(env, 'DELETE FROM ferment_readings WHERE id = ?', +r[1]); return json({ ok: true }); }
  if ((r = p.match(/^\/fermentations\/(\d+)\/done$/)) && m === 'POST') { await run(env, "UPDATE lots SET fermentation_done = 1, phase = CASE WHEN phase IN ('recepcion','fermentacion') THEN 'posfermentacion' ELSE phase END WHERE id = ?", +r[1]); return json({ ok: true }); }
  return null;
}

async function receptions(env, season) {
  const rows = await all(env, `SELECT hr.*, pa.code AS parcel_code, lo.code AS lot_code_now FROM harvest_receptions hr LEFT JOIN parcels pa ON pa.id = hr.parcel_id LEFT JOIN lots lo ON lo.id = hr.lot_id ${season ? 'WHERE hr.season = ?' : ''} ORDER BY hr.received_at DESC, hr.id DESC`, ...(season ? [season] : []));
  return rows.map((x) => ({ ...x, destinations: JSON.parse(x.destinations || '[]') }));
}

// 1 RECEPCIÓN → 2 ELABORACIÓN → 3 DESTINO. Maceración: lote en kg repartido en los depósitos (todos deben estar vacíos o
// contener ya el mismo lote del día). Prensado directo: el peso se convierte en litros de mosto (rendimiento estimado) y el lote nace en L.
async function createReception(env, b) {
  const d = str(b.received_at) || mxToday(); if (!dateOk(d)) fail(400, 'Fecha inválida');
  const variety = str(b.variety); if (!variety) fail(400, 'Falta la variedad');
  const wine_type = str(b.wine_type) || 'tinto';
  const kg = num(b.weight_kg); if (!kg || kg <= 0) fail(400, 'Peso inválido');
  const origin = b.origin === 'purchased' ? 'purchased' : 'own';
  const parcel_id = int(b.parcel_id);
  const parcel = parcel_id ? await one(env, 'SELECT * FROM parcels WHERE id = ?', parcel_id) : null;
  if (origin === 'own' && !parcel) fail(400, 'Indica la parcela');
  const process = b.process === 'direct_press' ? 'direct_press' : 'maceration';
  const dests = (Array.isArray(b.destinations) ? b.destinations : []).map((x) => ({ vessel_id: int(x.vessel_id), kg: num(x.kg) })).filter((x) => x.vessel_id);
  if (!dests.length) fail(400, 'Indica al menos un depósito de destino');
  const blank = dests.filter((x) => x.kg == null);
  if (blank.length > 1) fail(400, 'Con varios destinos indica los kg de cada uno (uno puede quedar en blanco)');
  const fixed = dests.reduce((a, x) => a + (x.kg || 0), 0);
  if (blank.length === 1) blank[0].kg = Math.round((kg - fixed) * 10) / 10;
  const sum = dests.reduce((a, x) => a + x.kg, 0);
  if (Math.abs(sum - kg) > 0.5) fail(400, `Los destinos suman ${sum} kg y la recepción pesa ${kg} kg`);
  const vmap = Object.fromEntries((await vesselsWithStays(env)).map((v) => [v.id, v]));
  const occupied = dests.filter((x) => vmap[x.vessel_id]?.stay_id).map((x) => vmap[x.vessel_id].code);
  if (occupied.length) fail(409, `Ya tienen contenido: ${occupied.join(', ')}. Vacíalos o elige otros.`);
  const season = int(b.season) || seasonOf(d);
  const code = str(b.lot_code) || await newLotCode(env, wine_type, season);
  if (await one(env, 'SELECT 1 FROM lots WHERE code = ?', code)) fail(409, `Ya existe el lote ${code}`);
  const yieldLpkg = num(b.yield_l_per_kg) || 0.65; // rendimiento de prensado directo
  const unit = process === 'maceration' ? 'kg' : 'L';
  const stmts = [];
  const recStmt = env.DB.prepare('INSERT INTO harvest_receptions (received_at, season, origin, parcel_id, parcel_label, variety, wine_type, weight_kg, brix, ph, ta, temp, reception_notes, process, lot_code, destinations, operator_name) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .bind(d, season, origin, parcel ? parcel.id : null, parcel ? parcel.code : str(b.parcel_label), variety, wine_type, kg, num(b.brix), num(b.ph), num(b.ta), num(b.temp), str(b.reception_notes), process, code, JSON.stringify(dests), str(b.operator_name));
  const rec = await recStmt.run();
  const recId = rec.meta.last_row_id;
  // el lote: una fila; varias estancias si hay varios destinos
  stmts.push(env.DB.prepare('INSERT INTO lots (code, wine_type, vintage, varieties, phase, creation_method, unit, fermentation_done, notes, parcel_id, reception_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .bind(code, wine_type, season, variety, process === 'maceration' ? 'recepcion' : 'fermentacion', 'harvest', unit, 0, str(b.reception_notes), parcel ? parcel.id : null, recId));
  for (const x of dests) {
    const vol = process === 'maceration' ? x.kg : Math.round(x.kg * yieldLpkg * 10) / 10;
    stmts.push(env.DB.prepare('INSERT INTO stays (lot_id, vessel_id, entered_at, volume_in, volume, unit) VALUES ((SELECT id FROM lots WHERE code = ?), ?, ?, ?, ?, ?)').bind(code, x.vessel_id, d, vol, vol, unit));
  }
  stmts.push(env.DB.prepare('UPDATE harvest_receptions SET lot_id = (SELECT id FROM lots WHERE code = ?) WHERE id = ?').bind(code, recId));
  await env.DB.batch(stmts);
  return { ok: true, id: recId, lot_code: code };
}
async function importReceptions(env, b) {
  const rows = Array.isArray(b.rows) ? b.rows : fail(400, 'Faltan filas');
  const vmap = Object.fromEntries((await vesselsWithStays(env)).map((v) => [v.code.toLowerCase(), v.id]));
  const pmap = Object.fromEntries((await all(env, 'SELECT id, code FROM parcels')).map((p) => [p.code.toLowerCase(), p.id]));
  const out = [];
  for (const r of rows) {
    const vid = vmap[String(r.vessel || r.deposito || r.depósito || '').toLowerCase()];
    if (!vid) fail(400, `Recipiente no encontrado en la fila de ${r.variety || r.variedad || '?'}`);
    out.push(await createReception(env, { received_at: r.date || r.fecha, parcel_id: pmap[String(r.parcel || r.parcela || '').toLowerCase()], origin: pmap[String(r.parcel || r.parcela || '').toLowerCase()] ? 'own' : 'purchased', parcel_label: r.parcel || r.parcela, variety: r.variety || r.variedad, wine_type: r.wine_type || r.tipo || 'tinto', weight_kg: r.kg || r.weight_kg || r.peso, brix: r.brix, ph: r.ph, ta: r.ta, process: /press|prens/i.test(r.process || r.elaboracion || '') ? 'direct_press' : 'maceration', lot_code: r.lot || r.lote, destinations: [{ vessel_id: vid }] }));
  }
  return { ok: true, created: out.length, lots: out.map((o) => o.lot_code) };
}

// Fermentaciones activas: un depósito por fila — lotes en fermentación/posfermentación que no se han marcado terminados
async function fermentations(env) {
  const rows = await all(env, `SELECT v.id AS vessel_id, v.code AS vessel_code, v.kind, v.capacity_l, s.volume, s.unit, s.entered_at,
      lo.id AS lot_id, lo.code AS lot_code, lo.varieties, lo.vintage, lo.wine_type, lo.phase, lo.fermentation_done,
      (SELECT COUNT(*) FROM analyses a WHERE a.lot_id = lo.id) AS n_analyses
    FROM stays s JOIN vessels v ON v.id = s.vessel_id JOIN lots lo ON lo.id = s.lot_id
    WHERE s.left_at IS NULL AND lo.fermentation_done = 0 ORDER BY v.code`);
  const ids = [...new Set(rows.map((r) => r.lot_id))];
  const readings = ids.length ? await all(env, `SELECT fr.* FROM ferment_readings fr WHERE fr.lot_id IN (${ids.map(() => '?').join(',')}) ORDER BY fr.read_at`, ...ids) : [];
  const byLot = {}; for (const r of readings) (byLot[r.lot_id] ||= []).push(r);
  const today = mxToday();
  return { today, rows: rows.map((r) => { const rs = byLot[r.lot_id] || []; const last = rs[rs.length - 1] || null; const first = rs[0] || null; const prev = rs[rs.length - 2] || null;
    return { ...r, readings: rs.length, last, first, rate: last && prev ? Math.round(((prev.sugar - last.sugar) / Math.max(0.2, (Date.parse(last.read_at.replace(' ', 'T')) - Date.parse(prev.read_at.replace(' ', 'T'))) / 864e5)) * 100) / 100 : null, stale: !last || (Date.parse(today) - Date.parse(last.read_at.slice(0, 10))) / 864e5 > 2 }; }) };
}
async function createReading(env, b) {
  const lot_id = int(b.lot_id); if (!lot_id) fail(400, 'Indica el lote');
  const sugar = num(b.sugar); if (sugar == null) fail(400, 'Falta el azúcar');
  const recorded_by = str(b.recorded_by); if (!recorded_by) fail(400, 'Indica quién registra');
  const read_at = str(b.read_at) || mxNow();
  const r = await run(env, 'INSERT INTO ferment_readings (lot_id, vessel_id, read_at, sugar, sugar_unit, temp, recorded_by, shift, notes) VALUES (?,?,?,?,?,?,?,?,?)', lot_id, int(b.vessel_id), read_at, sugar, str(b.sugar_unit) || 'brix', num(b.temp), recorded_by, str(b.shift), str(b.notes));
  return { ok: true, id: r.meta.last_row_id };
}
