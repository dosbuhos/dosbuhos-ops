// Signed entries: results of a work order, notes outside an order, and lab results.
// Every entry is a NEW row at the bottom of the lot's Excellovint tab (the order's own text is never touched),
// plus a structured record in D1 (coll "entries"), so measurements aren't only sheet text.
// Lab reports (PDF or photo) are stored in R2 (binding LABS, bucket cellar-labs), read by Claude, confirmed by a person,
// then saved as one D1 record per sample (coll "labs") and one row per sample in the lot's tab.
import { accessToken, sheetsBase } from './sheets.js';
import { headerMap, sync } from './xl.js';
import { PARAMS, normHead } from './params.js';

const cell = (v) => String(v == null ? '' : v).trim();
const qt = (t) => "'" + String(t).replace(/'/g, "''") + "'";
const colLetter = (i) => { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
const todayMX = () => new Date(Date.now() - 6 * 3600e3).toISOString().slice(0, 10);
const sheetDate = (iso) => { const [y, m, d] = iso.split('-').map(Number); return m + '/' + d + '/' + y; };
const dm = (iso) => { const [, m, d] = iso.split('-').map(Number); return d + '/' + m; };
const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9+%]+/g, ' ').trim();
const fail = (msg, status = 400) => Object.assign(new Error(msg), { status });
const BY_K = Object.fromEntries(PARAMS.map(p => [p.k, p]));

export async function gs(env, path, init = {}) {
  const r = await fetch(sheetsBase(env) + env.SHEET_ID + path,
    Object.assign({}, init, { headers: { authorization: 'Bearer ' + await accessToken(env), 'content-type': 'application/json' } }));
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error((j.error && j.error.message) || 'Google Sheets error ' + r.status), { status: r.status === 429 ? 429 : 502 });
  return j;
}
export const put = (env, coll, id, data) => env.DB.prepare('INSERT INTO docs (coll, id, data, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(coll, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at').bind(coll, id, JSON.stringify(data), Date.now()).run();
export async function get(env, coll, id) { const r = await env.DB.prepare('SELECT data FROM docs WHERE coll = ? AND id = ?').bind(coll, id).first(); return r ? JSON.parse(r.data) : null; }
export async function list(env, coll) { const { results } = await env.DB.prepare('SELECT id, data FROM docs WHERE coll = ?').bind(coll).all(); return results.map(r => Object.assign({ id: r.id }, JSON.parse(r.data))); }

// Clean a value from a form or a lab report: numbers keep their decimal point; text params stay text.
function cleanVal(k, v) {
  const s = cell(v); if (!s) return '';
  const p = BY_K[k];
  if (p && p.type === 'text') return s.slice(0, 40);
  const n = s.replace(/\s/g, '').replace(',', '.');
  return /^[<>≤≥~]?-?\d*\.?\d+$/.test(n) ? n : s.slice(0, 40);
}

// ---------- write one signed row ----------
// e = { tab, kind: 'result'|'note'|'lab', ubi, values: {k: v}, others: [{name, value, unit}], note, signer, order: {tab,row,note}|null,
//       lab, pdf, ini (labs: 'UYV LAB'), lot }
export async function writeEntry(env, e, user) {
  const tab = cell(e.tab);
  if (!/^L\d/i.test(tab)) throw fail('Elige el vino / lote.');
  const signer = cell(e.signer).toUpperCase().slice(0, 12);
  if (!signer && e.kind !== 'lab') throw fail('Falta quién lo hizo.');
  const values = {};
  for (const [k, v] of Object.entries(e.values || {})) { if (!BY_K[k]) continue; const c = cleanVal(k, v); if (c !== '') values[k] = c; }
  const others = (Array.isArray(e.others) ? e.others : []).map(o => ({ name: cell(o.name).slice(0, 60), value: cell(o.value).slice(0, 40), unit: cell(o.unit).slice(0, 20) })).filter(o => o.name && o.value !== '');
  const noteIn = cell(e.note).toUpperCase().slice(0, 1500);
  if (!noteIn && !Object.keys(values).length && !others.length) throw fail('Escribe una nota o al menos un valor.');

  const v = (await gs(env, '/values/' + encodeURIComponent(qt(tab) + '!A1:BZ3000'))).values || [];
  const hm = headerMap(v);
  if (!hm || hm.map.note == null) throw fail('No encuentro la fila de encabezados en ' + tab + '.');
  const m = hm.map, head = v[hm.row] || [];
  // Column for each parameter: core ones from the header map, the rest by header text; missing ones are appended.
  const byHead = {}; head.forEach((h, i) => { const n = normHead(h); if (n && byHead[n] == null) byHead[n] = i; });
  const colOf = {}; const newCols = [];
  let next = Math.max(head.length - 1, ...Object.values(m)) + 1;
  const used = (i) => v.some((r, ri) => ri !== hm.row && cell((r || [])[i]));
  const ensure = (h) => {
    const n = normHead(h);
    if (byHead[n] != null) return byHead[n];
    while (used(next) || cell(head[next])) next++;   // never write a header over stray values (some tabs have them)
    const i = next++; byHead[n] = i; newCols.push([i, h]); return i;
  };
  const coreKey = { voli: 'voli', volf: 'volf', ph: 'ph', bx: 'bx', tp: 'tp', at: 'at', am: 'am', sl: 'sl', st: 'st', aa: 'aa' };
  for (const k of Object.keys(values)) colOf[k] = coreKey[k] && m[coreKey[k]] != null ? m[coreKey[k]] : ensure(BY_K[k].h);
  const labCol = e.lab ? ensure('LAB') : null, pdfCol = e.pdf ? ensure('PDF') : null;

  const today = todayMX();
  let note;
  if (e.kind === 'result' && e.order) note = 'RESULTADO (ORDEN ' + cell(e.order.tab).toUpperCase() + ' FILA ' + (+e.order.row || '?') + ')' + (noteIn ? ': ' + noteIn : '');
  else if (e.kind === 'lab') note = 'RESULTADOS ' + (cell(e.lab).toUpperCase() || 'LABORATORIO') + ' ' + dm(e.reportDate && /^\d{4}-\d{2}-\d{2}$/.test(e.reportDate) ? e.reportDate : today) + (noteIn ? ': ' + noteIn : '');
  else note = 'NOTA' + (noteIn ? ': ' + noteIn : '');
  if (others.length) note += ' · OTROS: ' + others.map(o => o.name.toUpperCase() + ' ' + o.value + (o.unit ? ' ' + o.unit : '')).join('; ');

  const rowNum = Math.max(v.length, hm.row + 1) + 1;
  const ini = e.kind === 'lab' ? (cell(e.ini).toUpperCase() || 'UYV LAB') : signer;
  const cells = [[m.date_raw, sheetDate(today)], [m.note, note]];
  if (m.ubi != null) cells.push([m.ubi, cell(e.ubi).toUpperCase().slice(0, 80)]);
  if (m.asig != null) cells.push([m.asig, ini]);
  if (m.ini != null) cells.push([m.ini, ini]);
  for (const [k, val] of Object.entries(values)) cells.push([colOf[k], val]);
  if (labCol != null) cells.push([labCol, cell(e.lab).toUpperCase()]);
  if (pdfCol != null) cells.push([pdfCol, cell(e.pdf)]);
  const data = newCols.map(([i, h]) => ({ range: qt(tab) + '!' + colLetter(i) + (hm.row + 1), values: [[h]] }))
    .concat(cells.filter(([i]) => i != null).map(([i, val]) => ({ range: qt(tab) + '!' + colLetter(i) + rowNum, values: [[val]] })));
  await gs(env, '/values:batchUpdate', { method: 'POST', body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data }) });

  const id = 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const rec = { kind: e.kind || 'note', tab, row: rowNum, lot: cell(e.lot), ubi: cell(e.ubi).toUpperCase(), date: today, values, others, note: noteIn,
    signer: ini, by: user.initials, at: new Date().toISOString(), order: e.order ? { tab: cell(e.order.tab), row: +e.order.row || null, note: cell(e.order.note).slice(0, 300) } : null,
    lab: cell(e.lab) || undefined, pdf: cell(e.pdf) || undefined, newCols: newCols.map(([, h]) => h) };
  await put(env, 'entries', id, rec);
  try { await sync(env, [tab]); } catch (x) {}
  return Object.assign({ ok: true, id }, rec);
}

// ---------- lab reports ----------
const LAB_PROMPT = `You are reading a wine laboratory report (usually "Uva y Vino" or "San Lucas", Mexico, in Spanish).
Return ONE JSON object only, no prose:
{"lab": "Uva y Vino" | "San Lucas" | other name as printed, "report_date": "YYYY-MM-DD" or "", "sampled_date": "YYYY-MM-DD" or "",
 "samples": [{"label": "sample name exactly as printed", "sampled_date": "YYYY-MM-DD" or "", "params": [{"name": "parameter as printed", "value": "number or text as printed (use a dot for decimals)", "unit": "unit as printed"}]}]}
Include EVERY sample and EVERY parameter in the report, including ones you don't recognise. Do not convert units. Do not invent values; skip empty cells.
Dates in the report are day/month/year.`;

function matchParam(name) {
  const f = fold(name);
  for (const p of PARAMS) {
    if (fold(p.label) === f || fold(p.h) === f) return p.k;
    for (const a of p.aka || []) if (f === fold(a) || f.startsWith(fold(a) + ' ') || f.includes(fold(a)) && fold(a).length > 5) return p.k;
  }
  return null;
}
// "L 11 Chenin TK + BBL 21 Dos Buhos" → tab "L11 - CB", vessel "TK + BBL 21".
function matchSample(label, tabs) {
  const s = String(label || '').toUpperCase();
  let tab = '';
  const m = s.match(/\bL\s*-?\s*(\d{1,2})\b/);
  if (m) { const n = String(+m[1]).padStart(2, '0'); tab = tabs.find(t => new RegExp('^L\\s*' + n + '\\b', 'i').test(t)) || ''; }
  const ves = [];
  const re = /\b(BBLS?|BARRICAS?|TK|TANQUE|VC|T|PUNCH(?:EON)?|FOUDRE|SS|A|ANFORA)\s*-?\s*(\d{1,4})?\b/g; let x;
  while ((x = re.exec(s))) { if (x[1] === 'A' && !x[2]) continue; if (x[1] === 'T' && !x[2]) continue; ves.push((x[1] + (x[2] ? ' ' + x[2] : '')).replace(/^BARRICAS?/, 'BBL').replace(/^TANQUE/, 'TK')); }
  return { tab, ubi: [...new Set(ves)].join(' + ') };
}

async function sha256Hex(buf) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', buf))].map(b => b.toString(16).padStart(2, '0')).join(''); }
function b64(buf) { let s = ''; const a = new Uint8Array(buf); for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000)); return btoa(s); }

async function extract(env, file) {
  if (!env.ANTHROPIC_API_KEY) throw fail('ANTHROPIC_API_KEY no está configurada.', 503);
  const obj = await env.LABS.get(file.key); if (!obj) throw fail('No encuentro el archivo.', 404);
  const buf = await obj.arrayBuffer(), data = b64(buf);
  const block = /pdf/i.test(file.type) ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }
    : { type: 'image', source: { type: 'base64', media_type: /png/i.test(file.type) ? 'image/png' : /webp/i.test(file.type) ? 'image/webp' : 'image/jpeg', data } };
  const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST',
    headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: env.AI_MODEL || 'claude-sonnet-5-5', max_tokens: 12000, messages: [{ role: 'user', content: [block, { type: 'text', text: LAB_PROMPT }] }] }) });
  if (!r.ok) throw fail('Claude no pudo leer el archivo: ' + (await r.text()).slice(0, 300), 502);
  const j = await r.json();
  const txt = (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
  const a = txt.indexOf('{'), b = txt.lastIndexOf('}');
  let out; try { out = JSON.parse(txt.slice(a, b + 1)); } catch (e) { throw fail('No pude interpretar el reporte. Intenta con una foto más clara.', 502); }
  return out;
}

const labId = (hash, label, tab) => 'lab-' + hash.slice(0, 16) + '-' + fold(tab + ' ' + label).replace(/\s+/g, '-').slice(0, 60);

export async function entriesRoute(request, env, p, url, user) {
  const J = (body, status = 200) => ({ status, body });
  try {
    if (p === '/api/params') return J({ params: PARAMS, labs: !!env.LABS });
    if (p === '/api/entries' && request.method === 'GET') {
      let rows = await list(env, 'entries');
      const tab = url.searchParams.get('tab'), ord = url.searchParams.get('order');
      if (tab) rows = rows.filter(r => r.tab === tab);
      if (ord) { const [t, row] = ord.split('|'); rows = rows.filter(r => r.order && r.order.tab === t && String(r.order.row) === row); }
      const since = url.searchParams.get('since'); if (since) rows = rows.filter(r => (r.date || '') >= since);
      rows.sort((a, b) => String(b.at).localeCompare(String(a.at)));
      return J({ rows: rows.slice(0, 500) });
    }
    if (p === '/api/entries' && request.method === 'POST') {
      if (!user.canWrite) return J({ message: 'Solo lectura.' }, 403);
      const b = await request.json();
      if (!['result', 'note'].includes(b.kind)) return J({ message: 'kind?' }, 400);
      return J(await writeEntry(env, b, user));
    }
    if (p.startsWith('/api/labs')) {
      if (p === '/api/labs' && request.method === 'GET') {
        const [labs, files] = await Promise.all([list(env, 'labs'), list(env, 'labfiles')]);
        labs.sort((a, b) => String(b.report_date || b.at).localeCompare(String(a.report_date || a.at)));
        return J({ enabled: !!env.LABS, labs, files });
      }
      if (!env.LABS) return J({ message: 'Subida de laboratorio aún no activada.', code: 'labs_off' }, 503);
      if (p === '/api/labs/file') {
        const f = await get(env, 'labfiles', url.searchParams.get('h') || '');
        if (!f) return J({ message: 'No existe.' }, 404);
        const obj = await env.LABS.get(f.key); if (!obj) return J({ message: 'No existe.' }, 404);
        return { raw: new Response(obj.body, { headers: { 'content-type': f.type || 'application/octet-stream', 'content-disposition': 'inline; filename="' + String(f.name || 'lab').replace(/"/g, '') + '"', 'cache-control': 'private, max-age=3600' } }) };
      }
      if (!user.canWrite) return J({ message: 'Solo lectura.' }, 403);
      if (p === '/api/labs/upload' && request.method === 'POST') {
        const type = (request.headers.get('content-type') || '').split(';')[0];
        if (!/^(application\/pdf|image\/(jpeg|png|webp|heic))$/.test(type)) return J({ message: 'Sube un PDF o una foto (JPG/PNG).' }, 400);
        const buf = await request.arrayBuffer();
        if (buf.byteLength > 15 * 1024 * 1024) return J({ message: 'El archivo pasa de 15 MB.' }, 400);
        const hash = await sha256Hex(buf), prev = await get(env, 'labfiles', hash);
        if (prev) return J(Object.assign({ hash, dup: true }, prev));
        const ext = type === 'application/pdf' ? 'pdf' : type.split('/')[1];
        const key = 'labs/' + hash + '.' + ext, name = cell(url.searchParams.get('name')).slice(0, 120) || key;
        await env.LABS.put(key, buf, { httpMetadata: { contentType: type } });
        const f = { key, name, type, size: buf.byteLength, by: user.initials, at: new Date().toISOString() };
        await put(env, 'labfiles', hash, f);
        return J(Object.assign({ hash, dup: false }, f));
      }
      if (p === '/api/labs/extract' && request.method === 'POST') {
        const b = await request.json(), f = await get(env, 'labfiles', b.hash || '');
        if (!f) return J({ message: 'Primero sube el archivo.' }, 400);
        const out = await extract(env, f);
        const { results } = await env.DB.prepare('SELECT tab FROM xl_tabs ORDER BY tab').all();
        const tabs = results.map(r => r.tab);
        const saved = (await list(env, 'labs')).filter(x => x.hash === b.hash).map(x => x.id);
        const samples = (out.samples || []).map(s => {
          const values = {}, extras = [];
          for (const pr of s.params || []) {
            const k = matchParam(pr.name);
            if (k && values[k] == null) values[k] = cleanVal(k, pr.value); else extras.push({ name: cell(pr.name), value: cell(pr.value), unit: cell(pr.unit) });
          }
          const mt = matchSample(s.label, tabs);
          return { label: cell(s.label), sampled: s.sampled_date || out.sampled_date || '', tab: mt.tab, ubi: mt.ubi, values, extras, dup: saved.includes(labId(b.hash, s.label, mt.tab)) };
        });
        f.extracted = { lab: out.lab || '', report_date: out.report_date || '', n: samples.length, at: new Date().toISOString() };
        await put(env, 'labfiles', b.hash, f);
        return J({ hash: b.hash, lab: out.lab || '', report_date: out.report_date || '', samples, tabs });
      }
      if (p === '/api/labs/save' && request.method === 'POST') {
        const b = await request.json(), f = await get(env, 'labfiles', b.hash || '');
        if (!f) return J({ message: 'Primero sube el archivo.' }, 400);
        const labName = cell(b.lab) || 'Uva y Vino', isSL = /lucas/i.test(labName);
        const out = [];
        for (const s of b.samples || []) {
          if (s.skip || !s.tab) continue;
          const id = labId(b.hash, s.label, s.tab);
          if (await get(env, 'labs', id)) { out.push({ id, dup: true, label: s.label }); continue; }
          const w = await writeEntry(env, { kind: 'lab', tab: s.tab, ubi: s.ubi, values: s.values, others: s.extras, lab: labName, pdf: 'app:' + b.hash.slice(0, 12),
            ini: isSL ? 'VSL LAB' : /interno/i.test(labName) ? 'LAB' : 'UYV LAB', reportDate: b.report_date }, user);
          const rec = { hash: b.hash, file: f.key, fileName: f.name, label: cell(s.label), tab: s.tab, ubi: cell(s.ubi).toUpperCase(), lab: labName,
            sampled: cell(s.sampled), report_date: cell(b.report_date), values: w.values, extras: w.others, row: w.row, by: user.initials, at: new Date().toISOString() };
          await put(env, 'labs', id, rec);
          out.push({ id, tab: s.tab, row: w.row, label: s.label });
        }
        return J({ ok: true, saved: out });
      }
    }
  } catch (e) { return J({ message: String(e.message || e) }, e.status && e.status < 600 ? e.status : 500); }
  return null;
}
