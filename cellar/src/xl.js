// Cellar records: Excellovint mirrored into D1, running side by side.
// - Pull: every 5 minutes (cron) and after every write, changed rows in the sheet are copied into D1 (hash per row).
// - Write: the app writes to Excellovint FIRST (it stays the master and the backup), then re-reads that tab into D1.
// - Conflict check: an update says what text it expected; if the crew changed that row in the sheet meanwhile, it's refused.
import { accessToken } from './sheets.js';

const FIELDS = ['date_raw', 'ubi', 'voli', 'volf', 'ph', 'bx', 'tp', 'at', 'am', 'sl', 'st', 'aa', 'note', 'pri', 'by_', 'asig', 'ini'];
const EDITABLE = ['date_raw', 'ubi', 'voli', 'volf', 'ph', 'bx', 'tp', 'at', 'am', 'sl', 'st', 'aa', 'note', 'pri', 'asig', 'ini'];
const MON = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, SEPT: 9, OCT: 10, NOV: 11, DEC: 12 };
const cell = (v) => String(v == null ? '' : v).trim();
const pad = (n) => String(n).padStart(2, '0');
const norm = (s) => cell(s).toUpperCase().replace(/\s+/g, ' ');
const colLetter = (i) => { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
const qt = (t) => "'" + String(t).replace(/'/g, "''") + "'";
const todayMX = () => new Date(Date.now() - 6 * 3600e3).toISOString().slice(0, 10);
const sheetDate = (iso) => { const [y, m, d] = iso.split('-').map(Number); return m + '/' + d + '/' + y; };

function parseDate(s, prev) {
  s = cell(s).toUpperCase(); if (!s) return null;
  let y, m, d, t;
  if ((t = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/))) { m = +t[1]; d = +t[2]; y = +t[3]; if (y < 100) y += 2000; }
  else if ((t = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) { y = +t[1]; m = +t[2]; d = +t[3]; }
  else if ((t = s.match(/^([A-Z]{3,4})\.?\s+(\d{1,2})\b/)) && MON[t[1]]) { m = MON[t[1]]; d = +t[2]; y = prev ? +prev.slice(0, 4) : new Date().getFullYear(); }
  else return null;
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31) || y < 2000 || y > 2100) return null;
  return y + '-' + pad(m) + '-' + pad(d);
}
export function headerMap(values) {
  for (let r = 0; r < Math.min(values.length, 15); r++) {
    const row = (values[r] || []).map(c => cell(c).toUpperCase().replace(/[.\s]/g, ''));
    if (row.includes('UBI') && row.some(c => c.startsWith('ACCION'))) {
      const m = { date_raw: 0 };
      row.forEach((c, i) => {
        if (c === 'FECHA' || c === 'FETCH' || c === 'DATE') m.date_raw = i;
        else if (c === 'UBI') m.ubi = i; else if (c === 'VOLI') m.voli = i; else if (c === 'VOLF') m.volf = i;
        else if (['PH', 'BX', 'TP', 'AT', 'AM', 'SL', 'ST', 'AA'].includes(c)) m[c.toLowerCase()] = i;
        else if (c.startsWith('ACCION')) m.note = i; else if (c === 'PRI' || c.startsWith('PRIOR')) m.pri = i;
        else if (c.startsWith('ASSGN')) m.by_ = i; else if (c === 'ASIG') m.asig = i; else if (c.startsWith('INI')) m.ini = i;
      });
      return { row: r, map: m };
    }
  }
  return null;
}
function labelAfter(values, upto, label) {
  for (let r = 0; r < upto; r++) {
    const row = values[r] || [];
    for (let i = 0; i < row.length; i++) if (cell(row[i]).toUpperCase().replace(/[:.\s]/g, '') === label) {
      for (let j = i + 1; j < row.length; j++) if (cell(row[j])) return cell(row[j]);
    }
  }
  return '';
}

async function gs(env, path, init = {}) {
  const r = await fetch('https://sheets.googleapis.com/v4/spreadsheets/' + env.SHEET_ID + path,
    Object.assign({}, init, { headers: { authorization: 'Bearer ' + await accessToken(env), 'content-type': 'application/json' } }));
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error((j.error && j.error.message) || 'Google Sheets error ' + r.status), { status: r.status });
  return j;
}
async function lotTabs(env) {
  const j = await gs(env, '?fields=sheets.properties.title');
  return j.sheets.map(s => s.properties.title).filter(t => /^L\d/i.test(t) && !/BTs/i.test(t));
}

// Pull: copy changed rows from the sheet into D1. tabs = null → every lot tab.
export async function sync(env, tabs) {
  const full = !tabs;
  if (full) tabs = await lotTabs(env);
  if (!tabs.length) return { tabs: 0, changed: 0 };
  const j = await gs(env, '/values:batchGet?' + tabs.map(t => 'ranges=' + encodeURIComponent(qt(t) + '!A1:Q1000')).join('&'));
  const now = Date.now(), stmts = [];
  let changed = 0, total = 0;
  for (let k = 0; k < tabs.length; k++) {
    const tab = tabs[k], v = (j.valueRanges[k] || {}).values || [], hm = headerMap(v);
    stmts.push(env.DB.prepare('INSERT INTO xl_tabs (tab, lote, vino, header_row, imported_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(tab) DO UPDATE SET lote = excluded.lote, vino = excluded.vino, header_row = excluded.header_row, imported_at = excluded.imported_at')
      .bind(tab, hm ? labelAfter(v, hm.row, 'LOTE') : '', hm ? labelAfter(v, hm.row, 'VINO') : '', hm ? hm.row + 1 : null, now));
    const { results } = await env.DB.prepare('SELECT row, h FROM xl_rows WHERE tab = ?').bind(tab).all();
    const have = new Map(results.map(r => [r.row, r.h]));
    const seen = new Set();
    if (hm) {
      let prev = null;
      for (let i = hm.row + 1; i < v.length; i++) {
        const r = v[i] || []; if (!r.some(c => cell(c))) continue;
        const o = {}; for (const f of FIELDS) o[f] = hm.map[f] == null ? '' : cell(r[hm.map[f]]);
        const iso = parseDate(o.date_raw, prev); if (iso) prev = iso;
        const h = JSON.stringify(FIELDS.map(f => o[f])); const rowNum = i + 1;
        seen.add(rowNum); total++;
        if (have.get(rowNum) === h) continue;
        changed++;
        stmts.push(env.DB.prepare(`INSERT INTO xl_rows (tab, row, date, ${FIELDS.join(', ')}, h, updated_at) VALUES (?, ?, ?, ${FIELDS.map(() => '?').join(', ')}, ?, ?)
          ON CONFLICT(tab, row) DO UPDATE SET date = excluded.date, ${FIELDS.map(f => f + ' = excluded.' + f).join(', ')}, h = excluded.h, updated_at = excluded.updated_at`)
          .bind(tab, rowNum, iso, ...FIELDS.map(f => o[f]), h, now));
      }
    }
    for (const rowNum of have.keys()) if (!seen.has(rowNum)) { changed++; stmts.push(env.DB.prepare('DELETE FROM xl_rows WHERE tab = ? AND row = ?').bind(tab, rowNum)); }
  }
  if (full) {
    // Tabs that disappeared from the sheet.
    const { results } = await env.DB.prepare('SELECT tab FROM xl_tabs').all();
    for (const r of results) if (!tabs.includes(r.tab)) { stmts.push(env.DB.prepare('DELETE FROM xl_rows WHERE tab = ?').bind(r.tab)); stmts.push(env.DB.prepare('DELETE FROM xl_tabs WHERE tab = ?').bind(r.tab)); }
  }
  for (let i = 0; i < stmts.length; i += 90) await env.DB.batch(stmts.slice(i, i + 90));
  return { tabs: tabs.length, rows: total, changed, at: new Date(now).toISOString() };
}

// Write one or more cells of an existing row: sheet first, then mirror.
export async function updateRow(env, tab, row, set, expectNote) {
  const v = (await gs(env, '/values/' + encodeURIComponent(qt(tab) + '!A1:Q15'))).values || [], hm = headerMap(v);
  if (!hm) throw Object.assign(new Error('No header row in ' + tab), { status: 400 });
  if (row <= hm.row + 1) throw Object.assign(new Error('That row is in the header.'), { status: 400 });
  const cur = ((await gs(env, '/values/' + encodeURIComponent(qt(tab) + '!A' + row + ':Q' + row))).values || [[]])[0] || [];
  if (expectNote != null && hm.map.note != null && norm(cur[hm.map.note]) !== norm(expectNote)) {
    await sync(env, [tab]);
    throw Object.assign(new Error('This row changed in Excellovint since you loaded it. It has been refreshed; check it and try again.'), { status: 409 });
  }
  const data = [];
  for (const [k, val] of Object.entries(set || {})) {
    if (!EDITABLE.includes(k) || hm.map[k] == null) continue;
    const out = k === 'date_raw' && /^\d{4}-\d{2}-\d{2}$/.test(val) ? sheetDate(val) : k === 'note' ? String(val).toUpperCase() : String(val);
    data.push({ range: qt(tab) + '!' + colLetter(hm.map[k]) + row, values: [[out]] });
  }
  if (!data.length) throw Object.assign(new Error('Nothing to change.'), { status: 400 });
  await gs(env, '/values:batchUpdate', { method: 'POST', body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data }) });
  await sync(env, [tab]);
  return { ok: true, tab, row };
}

// New work order at the bottom of a lot tab: sheet first, then mirror.
export async function createRow(env, a, by) {
  const v = (await gs(env, '/values/' + encodeURIComponent(qt(a.tab) + '!A1:Q1000'))).values || [], hm = headerMap(v);
  if (!hm || hm.map.note == null) throw Object.assign(new Error('No header row in ' + a.tab), { status: 400 });
  const m = hm.map, rowNum = Math.max(v.length, hm.row + 1) + 1, width = Math.max(...Object.values(m)) + 1;
  const row = new Array(width).fill('');
  row[m.date_raw] = sheetDate(a.date || todayMX());
  if (m.ubi != null) row[m.ubi] = String(a.ubi || '?').toUpperCase();
  if (m.volf != null) row[m.volf] = a.vol || '?';
  row[m.note] = String(a.text || '').toUpperCase();
  if (m.pri != null) row[m.pri] = String(a.pri || '').toUpperCase();
  if (m.by_ != null) row[m.by_] = by;
  if (m.asig != null) row[m.asig] = String(a.asig || '').toUpperCase();
  await gs(env, '/values/' + encodeURIComponent(qt(a.tab) + '!A' + rowNum + ':' + colLetter(width - 1) + rowNum) + '?valueInputOption=USER_ENTERED', { method: 'PUT', body: JSON.stringify({ values: [row] }) });
  await sync(env, [a.tab]);
  return { ok: true, tab: a.tab, row: rowNum };
}

export async function xlRoute(request, env, p, url, user) {
  const err = (e) => ({ status: e.status && e.status < 500 ? e.status : 502, body: { message: String(e.message || e) } });
  try {
    if (p === '/api/xl/import' && request.method === 'POST') return { status: 200, body: await sync(env) };
    if (p === '/api/xl/update' && request.method === 'POST') {
      if (!user.canWrite) return { status: 403, body: { message: 'Read-only access.' } };
      const b = await request.json();
      return { status: 200, body: await updateRow(env, b.tab, +b.row, b.set, b.expect) };
    }
    if (p === '/api/xl/create' && request.method === 'POST') {
      if (!user.canWrite) return { status: 403, body: { message: 'Read-only access.' } };
      const b = await request.json();
      if (!b.tab || !String(b.text || '').trim() || !b.asig) return { status: 400, body: { message: 'Lote, texto y asignado son obligatorios.' } };
      return { status: 200, body: await createRow(env, b, user.initials) };
    }
  } catch (e) { return err(e); }
  if (p === '/api/xl/tabs') {
    const { results } = await env.DB.prepare(`SELECT t.tab, t.lote, t.vino, t.imported_at, COUNT(r.row) n, MAX(r.date) last,
      SUM(CASE WHEN r.asig <> '' AND r.ini = '' THEN 1 ELSE 0 END) open FROM xl_tabs t LEFT JOIN xl_rows r ON r.tab = t.tab GROUP BY t.tab ORDER BY t.tab`).all();
    return { status: 200, body: { tabs: results } };
  }
  if (p === '/api/xl/rows') {
    const { results } = await env.DB.prepare('SELECT * FROM xl_rows WHERE tab = ? ORDER BY row').bind(url.searchParams.get('tab') || '').all();
    return { status: 200, body: { rows: results } };
  }
  if (p === '/api/xl/barrel') {
    // Every Excellovint line that names this barrel ("BBL 101", "BBL 100, 101", "BARRICA 101", "½ BBL 122"), newest first.
    const code = (url.searchParams.get('code') || '').replace(/\D/g, '').replace(/^0+/, '');
    if (!code) return { status: 400, body: { message: 'code required' } };
    const like = '%' + code + '%';
    const { results } = await env.DB.prepare("SELECT tab, row, date, date_raw, ubi, volf, ph, at, am, sl, st, aa, note, asig, ini FROM xl_rows WHERE ubi LIKE ? OR note LIKE ? ORDER BY COALESCE(date, '') DESC, row DESC LIMIT 600").bind(like, like).all();
    const nums = (s) => { const out = []; const re = /\b(?:BBLS?|BARRICAS?|BARRELS?|B)\s*#?\s*((?:\d+\s*(?:,|\+|Y|AND|·|&|-|–)\s*)*\d+)/gi; let m; while ((m = re.exec(s || ''))) for (const n of m[1].match(/\d+/g) || []) out.push(String(+n)); return out; };
    const rows = results.filter(r => {
      const u = String(r.ubi || ''); const inUbi = /B(?:BL|ARRICA|ARREL)/i.test(u) ? (u.match(/\d+/g) || []).map(n => String(+n)) : [];
      return inUbi.includes(code) || nums(u).includes(code) || nums(r.note).includes(code);
    }).slice(0, 150);
    return { status: 200, body: { code, rows } };
  }
  if (p === '/api/xl/today') {
    // Same rows as Excellovint's "Today's Work Orders": everything dated today, plus open (assigned, not initialed)
    // rows from the last 14 days. Never future rows.
    const today = new Date(Date.now() - 6 * 3600e3).toISOString().slice(0, 10);
    const from = new Date(Date.parse(today) - 14 * 864e5).toISOString().slice(0, 10);
    const { results } = await env.DB.prepare(`SELECT * FROM xl_rows WHERE note <> '' AND date IS NOT NULL AND date <= ?1
      AND (date = ?1 OR (date >= ?2 AND asig <> '' AND (ini = '' OR UPPER(ini) = 'UNDO'))) ORDER BY date, tab, row`).bind(today, from).all();
    return { status: 200, body: { today, rows: results.map(r => (/^UNDO$/i.test(r.ini || '') ? Object.assign(r, { ini: '' }) : r)) } };
  }
  if (p === '/api/xl/open') {
    const { results } = await env.DB.prepare("SELECT * FROM xl_rows WHERE asig <> '' AND ini = '' ORDER BY COALESCE(date, '9999'), tab, row").all();
    return { status: 200, body: { rows: results } };
  }
  return { status: 404, body: { message: 'not found' } };
}
