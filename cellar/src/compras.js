// Compras (purchases list) ↔ Excellovint "Compras" tab, both directions.
// App → sheet: every add/change/delete in the app upserts its row (matched by the ID column L).
// Sheet → app: pullPurchases() (cron every 5 min, and on "Sincronizar") reads the tab; rows without an ID
// are new purchases from the crew (an ID is written back), rows whose cells changed update the app's record.
import { accessToken } from './sheets.js';

const TAB = 'Compras';
const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets/';
const PRI = { ALTA: 'high', MEDIA: 'medium', BAJA: 'low' }, PRI_ES = { high: 'ALTA', medium: 'MEDIA', low: 'BAJA' };
const ST = { PENDIENTE: 'open', PEDIDA: 'ordered', RECIBIDA: 'received' }, ST_ES = { open: 'PENDIENTE', ordered: 'PEDIDA', received: 'RECIBIDA' };
const cell = (v) => String(v == null ? '' : v).trim();
const toSheetDate = (iso) => { if (!iso) return ''; const d = new Date(iso); return isNaN(d) ? '' : (d.getUTCMonth() + 1) + '/' + d.getUTCDate() + '/' + d.getUTCFullYear(); };
const fromSheetDate = (s) => { const m = cell(s).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); if (m) return new Date(Date.UTC(+m[3], +m[1] - 1, +m[2], 12)).toISOString(); const d = new Date(cell(s)); return isNaN(d) ? '' : d.toISOString(); };

async function gs(env, path, init = {}) {
  const r = await fetch(SHEETS + env.SHEET_ID + path, Object.assign({}, init, { headers: { authorization: 'Bearer ' + await accessToken(env), 'content-type': 'application/json' } }));
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j.error && j.error.message) || 'Google Sheets error ' + r.status);
  return j;
}
const q = `'${TAB}'`;

// Purchase doc → sheet row (A..L).
export function toRow(id, p) {
  return [toSheetDate(p.at), p.item || '', p.qty || '', PRI_ES[p.pri] || 'MEDIA', p.asig || '', p.where || '', p.notes || '', ST_ES[p.status || 'open'] || 'PENDIENTE', p.by || '', toSheetDate(p.orderedAt), toSheetDate(p.receivedAt), id];
}
// Sheet row → purchase fields.
function fromRow(r) {
  const pri = PRI[cell(r[3]).toUpperCase()] || 'medium', status = ST[cell(r[7]).toUpperCase()] || 'open';
  const o = { item: cell(r[1]), qty: cell(r[2]), pri, asig: cell(r[4]).toUpperCase(), where: cell(r[5]), notes: cell(r[6]), status, by: cell(r[8]).toUpperCase() };
  const at = fromSheetDate(r[0]); if (at) o.at = at;
  const oa = fromSheetDate(r[9]); if (oa) o.orderedAt = oa;
  const ra = fromSheetDate(r[10]); if (ra) o.receivedAt = ra;
  return o;
}
const sig = (p) => JSON.stringify([p.item, p.qty, p.pri, p.asig, p.where, p.notes, p.status, p.by, toSheetDate(p.at), toSheetDate(p.orderedAt), toSheetDate(p.receivedAt)]);

async function readTab(env) {
  const j = await gs(env, '/values/' + encodeURIComponent(q + '!A1:L400'));
  return j.values || [];
}
async function findRow(env, id) {
  const v = await readTab(env);
  for (let i = 1; i < v.length; i++) if (cell(v[i][11]) === id) return { row: i + 1, values: v };
  return { row: 0, values: v };
}

// App → sheet. Call after any write to coll "purchases". Never throws (the app record is already saved).
export async function pushPurchase(env, id, p) {
  if (!env.GOOGLE_SA_JSON) return;
  try {
    const { row, values } = await findRow(env, id);
    if (!p) { // deleted in the app: clear the row's cells (keeps row numbers stable)
      if (row) await gs(env, '/values/' + encodeURIComponent(q + '!A' + row + ':L' + row) + ':clear', { method: 'POST', body: '{}' });
      return;
    }
    const target = row || Math.max(values.length, 1) + 1;
    await gs(env, '/values/' + encodeURIComponent(q + '!A' + target + ':L' + target) + '?valueInputOption=USER_ENTERED', { method: 'PUT', body: JSON.stringify({ values: [toRow(id, p)] }) });
    await env.DB.prepare('UPDATE docs SET data = json_set(data, \'$.sheetSig\', ?) WHERE coll = \'purchases\' AND id = ?').bind(sig(p), id).run();
  } catch (e) { console.log('compras push failed', e && e.message); }
}

// Sheet → app. Returns counts.
export async function pullPurchases(env) {
  if (!env.GOOGLE_SA_JSON) return { skipped: true };
  const v = await readTab(env);
  if (!v.length || !/ART/i.test(cell(v[0][1]))) return { skipped: true, reason: 'no Compras tab' };
  const { results } = await env.DB.prepare("SELECT id, data FROM docs WHERE coll = 'purchases'").all();
  const docs = new Map(results.map(r => [r.id, JSON.parse(r.data)]));
  const seen = new Set(), writes = [], idBack = [];
  let added = 0, changed = 0;
  const now = Date.now();
  for (let i = 1; i < v.length; i++) {
    const r = v[i] || [];
    if (!cell(r[1])) continue; // empty / cleared row
    let id = cell(r[11]);
    const fields = fromRow(r);
    if (!id || !docs.has(id)) {
      // New from the sheet (or an ID we don't know): create the record and write the ID back.
      id = id || 'p' + now.toString(36) + i.toString(36);
      const p = Object.assign({ at: new Date().toISOString() }, fields, { source: 'sheet' });
      p.sheetSig = sig(p);
      writes.push(env.DB.prepare('INSERT INTO docs (coll, id, data, updated_at) VALUES (\'purchases\', ?, ?, ?) ON CONFLICT(coll, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at').bind(id, JSON.stringify(p), now));
      if (!cell(r[11])) idBack.push({ range: q + '!L' + (i + 1), values: [[id]] });
      docs.set(id, p); added++;
    } else {
      const cur = docs.get(id), merged = Object.assign({}, cur, fields);
      if (cur.at) merged.at = cur.at; // creation time stays the app's
      const s = sig(merged);
      if (s !== (cur.sheetSig || sig(cur))) { // the sheet row changed since we last wrote it
        if (fields.status === 'ordered' && !merged.orderedAt) merged.orderedAt = new Date().toISOString();
        if (fields.status === 'received' && !merged.receivedAt) merged.receivedAt = new Date().toISOString();
        merged.sheetSig = sig(merged);
        writes.push(env.DB.prepare('UPDATE docs SET data = ?, updated_at = ? WHERE coll = \'purchases\' AND id = ?').bind(JSON.stringify(merged), now, id));
        changed++;
      }
    }
    seen.add(id);
  }
  // Records the app has that the sheet lacks (never pushed, e.g. created while the SA was down): append them.
  const missing = [...docs.entries()].filter(([id]) => !seen.has(id));
  if (missing.length) {
    const start = v.length + 1;
    await gs(env, '/values/' + encodeURIComponent(q + '!A' + start + ':L' + (start + missing.length - 1)) + '?valueInputOption=USER_ENTERED', { method: 'PUT', body: JSON.stringify({ values: missing.map(([id, p]) => toRow(id, p)) }) });
  }
  if (idBack.length) await gs(env, '/values:batchUpdate', { method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data: idBack }) });
  if (writes.length) await env.DB.batch(writes);
  return { added, changed, appended: missing.length };
}
