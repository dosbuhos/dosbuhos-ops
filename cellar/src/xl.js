// Cellar records (Excellovint moved into D1). PREVIEW: one-way import from the sheet; nothing writes back.
import { accessToken } from './sheets.js';

const FIELDS = ['date_raw', 'ubi', 'voli', 'volf', 'ph', 'bx', 'tp', 'at', 'am', 'sl', 'st', 'aa', 'note', 'pri', 'by_', 'asig', 'ini'];
const MON = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, SEPT: 9, OCT: 10, NOV: 11, DEC: 12 };
const cell = (v) => String(v == null ? '' : v).trim();
const pad = (n) => String(n).padStart(2, '0');

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
function headerMap(values) {
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

// One-way import: Excellovint → D1. Replaces everything in xl_tabs / xl_rows.
export async function importAll(env) {
  const base = 'https://sheets.googleapis.com/v4/spreadsheets/' + env.SHEET_ID;
  const auth = { authorization: 'Bearer ' + await accessToken(env) };
  const meta = await (await fetch(base + '?fields=sheets.properties.title', { headers: auth })).json();
  const tabs = meta.sheets.map(s => s.properties.title).filter(t => /^L\d/i.test(t) && !/BTs/i.test(t));
  const q = (t) => "'" + t.replace(/'/g, "''") + "'!A1:Q1000";
  const j = await (await fetch(base + '/values:batchGet?' + tabs.map(t => 'ranges=' + encodeURIComponent(q(t))).join('&'), { headers: auth })).json();
  if (!j.valueRanges) throw new Error('Sheets read failed: ' + JSON.stringify(j).slice(0, 300));
  const now = Date.now(), stmts = [env.DB.prepare('DELETE FROM xl_rows'), env.DB.prepare('DELETE FROM xl_tabs')];
  let rows = 0;
  j.valueRanges.forEach((vr, k) => {
    const tab = tabs[k], v = vr.values || [], hm = headerMap(v);
    stmts.push(env.DB.prepare('INSERT INTO xl_tabs (tab, lote, vino, header_row, imported_at) VALUES (?, ?, ?, ?, ?)')
      .bind(tab, hm ? labelAfter(v, hm.row, 'LOTE') : '', hm ? labelAfter(v, hm.row, 'VINO') : '', hm ? hm.row + 1 : null, now));
    if (!hm) return;
    let prev = null;
    for (let i = hm.row + 1; i < v.length; i++) {
      const r = v[i] || []; if (!r.some(c => cell(c))) continue;
      const o = {}; for (const f of FIELDS) o[f] = hm.map[f] == null ? '' : cell(r[hm.map[f]]);
      const iso = parseDate(o.date_raw, prev); if (iso) prev = iso;
      stmts.push(env.DB.prepare(`INSERT INTO xl_rows (tab, row, date, ${FIELDS.join(', ')}, updated_at) VALUES (?, ?, ?, ${FIELDS.map(() => '?').join(', ')}, ?)`)
        .bind(tab, i + 1, iso, ...FIELDS.map(f => o[f]), now));
      rows++;
    }
  });
  for (let i = 0; i < stmts.length; i += 90) await env.DB.batch(stmts.slice(i, i + 90));
  return { tabs: tabs.length, rows, at: new Date(now).toISOString() };
}

export async function xlRoute(request, env, p, url, isAdmin) {
  if (p === '/api/xl/import' && request.method === 'POST') {
    if (!isAdmin) return { status: 403, body: { message: 'Only Eric can run the import.' } };
    return { status: 200, body: await importAll(env) };
  }
  if (p === '/api/xl/tabs') {
    const { results } = await env.DB.prepare(`SELECT t.tab, t.lote, t.vino, t.imported_at, COUNT(r.row) n, MAX(r.date) last,
      SUM(CASE WHEN r.asig <> '' AND r.ini = '' THEN 1 ELSE 0 END) open FROM xl_tabs t LEFT JOIN xl_rows r ON r.tab = t.tab GROUP BY t.tab ORDER BY t.tab`).all();
    return { status: 200, body: { tabs: results } };
  }
  if (p === '/api/xl/rows') {
    const { results } = await env.DB.prepare('SELECT * FROM xl_rows WHERE tab = ? ORDER BY row').bind(url.searchParams.get('tab') || '').all();
    return { status: 200, body: { rows: results } };
  }
  if (p === '/api/xl/open') {
    const { results } = await env.DB.prepare("SELECT * FROM xl_rows WHERE asig <> '' AND ini = '' ORDER BY COALESCE(date, '9999'), tab, row").all();
    return { status: 200, body: { rows: results } };
  }
  return { status: 404, body: { message: 'not found' } };
}
