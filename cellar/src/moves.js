// Racking and blending orders (Trasiego / Mezcla).
// Eric or Diane create the order: it is written as a normal work-order row in the MASTER lot's Excellovint tab,
// plus a structured record in D1 (coll "moves"). The crew close it from "Anotar resultados": they must say where
// the wine ended up (vessel + liters each) and whether the source is empty. Closing it:
//   - writes a signed result row in the master tab and initials the order row (INI),
//   - updates the lot's location (lots.ubi) and the barrel registry (barrels filled / emptied, barrel_log),
//   - for a blend: every other lot is ARCHIVED into the master. Its Excellovint tab gets a black band row at the
//     bottom ("ARCHIVADO … MEZCLADO EN …"), its history stays readable from the master lot in the app.
import { gs, put, get, list, writeEntry } from './entries.js';
import { headerMap, sync } from './xl.js';

const cell = (v) => String(v == null ? '' : v).trim();
const up = (v) => cell(v).toUpperCase();
const qt = (t) => "'" + String(t).replace(/'/g, "''") + "'";
const colLetter = (i) => { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
const todayMX = () => new Date(Date.now() - 6 * 3600e3).toISOString().slice(0, 10);
const sheetDate = (iso) => { const [y, m, d] = iso.split('-').map(Number); return m + '/' + d + '/' + y; };
const dm = (iso) => { const [, m, d] = iso.split('-').map(Number); return d + '/' + m; };
const fail = (msg, status = 400) => Object.assign(new Error(msg), { status });
const num = (v) => { const n = parseFloat(String(v == null ? '' : v).replace(',', '.').replace(/[^\d.]/g, '')); return isFinite(n) ? n : 0; };
const norm = (s) => up(s).replace(/\s+/g, ' ');
const lotOfTab = (lots, tab) => lots.find(l => !l.archived && (l.sheet || []).some(s => s.tab === tab && !s.archived));
const short = (tab) => up(tab).replace(/\s*-\s*/g, ' ').replace(/\s+/g, ' ');
// "BBL 14, 46 Y 101" → ["14","46","101"]. Only numbers that follow BBL / BARRICA count as barrels (VC-05, TANQUE 6 are not).
export function barrelCodes(text) {
  const out = []; const s = up(text);
  const re = /\b(?:BBLS?|BARRICAS?|BARRILES?)\b[\s#:.]*((?:\d{1,3}\s*(?:,|&|\+|\bY\b|\/|\s)\s*)*\d{1,3})\b/g;
  let m; while ((m = re.exec(s))) for (const n of m[1].match(/\d{1,3}/g) || []) out.push(String(+n));
  return [...new Set(out)];
}

async function readTab(env, tab) {
  const v = (await gs(env, '/values/' + encodeURIComponent(qt(tab) + '!A1:BZ3000'))).values || [];
  const hm = headerMap(v);
  if (!hm || hm.map.note == null) throw fail('No encuentro la fila de encabezados en ' + tab + '.');
  return { v, hm, next: Math.max(v.length, hm.row + 1) + 1 };
}
async function writeRow(env, tab, rowNum, m, fields) {
  const data = Object.entries(fields).filter(([k, val]) => m[k] != null && val !== undefined)
    .map(([k, val]) => ({ range: qt(tab) + '!' + colLetter(m[k]) + rowNum, values: [[val]] }));
  await gs(env, '/values:batchUpdate', { method: 'POST', body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data }) });
}
// Black band across the row (A..last header column), white bold text.
async function blackBand(env, tab, rowNum, lastCol) {
  const meta = await gs(env, '?fields=sheets.properties(sheetId,title)');
  const sh = (meta.sheets || []).find(s => s.properties && s.properties.title === tab);
  if (!sh) return;
  await gs(env, ':batchUpdate', { method: 'POST', body: JSON.stringify({ requests: [{ repeatCell: {
    range: { sheetId: sh.properties.sheetId, startRowIndex: rowNum - 1, endRowIndex: rowNum, startColumnIndex: 0, endColumnIndex: lastCol + 1 },
    cell: { userEnteredFormat: { backgroundColor: { red: 0, green: 0, blue: 0 }, textFormat: { foregroundColor: { red: 1, green: 1, blue: 1 }, bold: true } } },
    fields: 'userEnteredFormat.backgroundColor,userEnteredFormat.textFormat' } }] }) });
}

// ---------- order text (Spanish, caps; "free run" stays English) ----------
function orderText(mv, lots) {
  const nm = (tab) => { const l = (mv.lot && lots.find(x => x.id === mv.lot)) || lotOfTab(lots, tab); return l ? up(l.name) : short(tab); };
  const close = ' AL TERMINAR: EN LA APP «ANOTAR RESULTADOS Y NOTAS» ANOTAR CADA VASIJA DE DESTINO CON SUS LITROS REALES Y SI EL ORIGEN QUEDÓ VACÍO. SIN ESO NO SE CIERRA LA ORDEN.';
  if (mv.kind === 'rack') {
    return 'TRASIEGO: ' + nm(mv.masterTab) + ' DE ' + (up(mv.from) || '?') + ' A ' + (up(mv.to) || '?') + (mv.liters ? ' (~' + mv.liters + ' L)' : '') +
      '. TRASEGAR CON CUIDADO, DEJAR LAS LÍAS GRUESAS, GASIFICAR LA VASIJA DE DESTINO.' + (mv.extra ? ' ' + up(mv.extra) + '.' : '') + close;
  }
  const parts = [{ tab: mv.masterTab, vessels: mv.from, liters: mv.liters }].concat(mv.parents)
    .map(p => short(p.tab) + ' (' + (up(p.vessels) || '?') + (p.liters ? ', ~' + p.liters + ' L' : '') + ')');
  return 'MEZCLA: ' + parts.join(' + ') + ' → ' + (up(mv.to) || '?') + '. MAESTRO: ' + short(mv.masterTab) +
    (mv.name ? ' («' + up(mv.name) + '»)' : '') + '. ' + mv.parents.map(p => short(p.tab)).join(', ') +
    (mv.parents.length > 1 ? ' SE ARCHIVAN' : ' SE ARCHIVA') + ' Y SU HISTORIA SIGUE EN ' + short(mv.masterTab) + '.' +
    (mv.extra ? ' ' + up(mv.extra) + '.' : '') + close;
}

// ---------- create ----------
async function createMove(env, b, user) {
  const kind = b.kind === 'blend' ? 'blend' : 'rack';
  const lots = await list(env, 'lots');
  const masterTab = cell(b.masterTab);
  if (!/^L\d/i.test(masterTab)) throw fail('Elige el vino.');
  const parents = kind === 'blend' ? (Array.isArray(b.parents) ? b.parents : []).map(p => ({ tab: cell(p.tab), vessels: cell(p.vessels).slice(0, 80), liters: num(p.liters) || '' }))
    .filter(p => /^L\d/i.test(p.tab) && p.tab !== masterTab) : [];
  if (kind === 'blend' && !parents.length) throw fail('Una mezcla necesita al menos dos vinos.');
  if (!cell(b.to)) throw fail('Falta a dónde va el vino (vasijas de destino).');
  const date = /^\d{4}-\d{2}-\d{2}$/.test(b.date || '') ? b.date : todayMX();
  const mv = { kind, masterTab, parents, from: cell(b.from).slice(0, 80), liters: num(b.liters) || '', to: cell(b.to).slice(0, 120),
    name: kind === 'blend' ? cell(b.name).slice(0, 80) : '', extra: cell(b.extra).slice(0, 400), date,
    pri: ['URGENT', 'HIGH', 'NORMAL', 'LOW'].includes(up(b.pri)) ? up(b.pri) : 'HIGH', asig: up(b.asig).slice(0, 20) || 'P/J', by: up(user.initials) || 'EM' };
  // The app lot can be named directly (a tab can hold more than one app lot, e.g. Chenin tank + puncheon).
  const byId = (id) => id && lots.find(l => l.id === id && !l.archived && (l.sheet || []).length);
  const master = byId(cell(b.lot)) || lotOfTab(lots, masterTab);
  mv.lot = master ? master.id : '';
  const bp = Array.isArray(b.parents) ? b.parents : [];
  for (const p of parents) { const src = bp.find(x => cell(x.tab) === p.tab) || {}; const l = byId(cell(src.lot)) || lotOfTab(lots, p.tab); p.lot = l ? l.id : ''; p.name = l ? l.name : short(p.tab); }
  mv.note = orderText(mv, lots);
  const { hm, next } = await readTab(env, masterTab);
  await writeRow(env, masterTab, next, hm.map, { date_raw: sheetDate(date), ubi: up(mv.from) || (kind === 'blend' ? 'MEZCLA' : ''), voli: mv.liters || '',
    note: mv.note, pri: mv.pri, by_: mv.by, asig: mv.asig });
  const id = 'mv-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  Object.assign(mv, { tab: masterTab, row: next, status: 'open', at: new Date().toISOString() });
  await put(env, 'moves', id, mv);
  try { await sync(env, [masterTab]); } catch (x) {}
  return Object.assign({ ok: true, id }, mv);
}

// ---------- complete ----------
async function completeMove(env, b, user) {
  const id = cell(b.id), mv = await get(env, 'moves', id);
  if (!mv) throw fail('No encuentro esa orden de trasiego.', 404);
  if (mv.status === 'done') throw fail('Esa orden ya se cerró.', 409);
  const signer = up(b.signer).slice(0, 12); if (!signer) throw fail('Falta «¿Quién lo hizo?».');
  const dest = (Array.isArray(b.dest) ? b.dest : []).map(d => ({ vessel: up(d.vessel).slice(0, 40), liters: num(d.liters) })).filter(d => d.vessel && d.liters > 0);
  if (!dest.length) throw fail('Anota al menos una vasija de destino con sus litros.');
  const sourceEmpty = b.source !== 'left'; const left = sourceEmpty ? 0 : num(b.left);
  const total = Math.round(dest.reduce((s, d) => s + d.liters, 0) * 10) / 10;
  const today = todayMX();
  const lots = await list(env, 'lots');
  const master = mv.lot ? lots.find(l => l.id === mv.lot) : lotOfTab(lots, mv.tab);

  // 1) signed result row in the master tab + initial the order row (found by its text, rows can move).
  const where = dest.map(d => d.vessel + ' ' + d.liters + ' L').join(', ');
  const noteTxt = (mv.kind === 'blend' ? 'MEZCLA HECHA' : 'TRASIEGO HECHO') + ': ' + where + ' = ' + total + ' L. ORIGEN ' +
    (sourceEmpty ? 'VACÍO' : 'CON ' + left + ' L') + (mv.kind === 'blend' ? '. ARCHIVADOS: ' + mv.parents.map(p => short(p.tab)).join(', ') : '') + (cell(b.note) ? '. ' + up(b.note) : '');
  await writeEntry(env, { kind: 'result', tab: mv.tab, ubi: dest.map(d => d.vessel).join(', '), values: { volf: String(total) }, note: noteTxt, signer,
    order: { tab: mv.tab, row: mv.row, note: mv.note }, lot: master ? master.id : '' }, user);
  {
    const { v, hm } = await readTab(env, mv.tab);
    let r = -1; const want = norm(mv.note);
    for (let i = hm.row + 1; i < v.length; i++) if (norm((v[i] || [])[hm.map.note]) === want) { r = i + 1; if (r === mv.row) break; }
    if (r > 0 && hm.map.ini != null) await writeRow(env, mv.tab, r, hm.map, { ini: signer });
  }

  // 2) blend: black band at the bottom of each archived tab.
  const archived = [];
  if (mv.kind === 'blend') {
    for (const p of mv.parents) {
      const { hm, next, v } = await readTab(env, p.tab);
      const text = '■ ARCHIVADO ' + dm(today) + ': MEZCLADO EN ' + short(mv.tab) + (mv.name ? ' («' + up(mv.name) + '»)' : '') +
        (p.liters ? ', ~' + p.liters + ' L' : '') + '. ESTE LOTE YA NO SE USA: LA HISTORIA SIGUE EN LA PESTAÑA ' + up(mv.tab) + '.';
      await writeRow(env, p.tab, next, hm.map, { date_raw: sheetDate(today), ubi: 'ARCHIVADO', note: text, asig: signer, ini: signer });
      const lastCol = Math.max((v[hm.row] || []).length - 1, ...Object.values(hm.map));
      try { await blackBand(env, p.tab, next, lastCol); } catch (x) {}
      archived.push(p.tab);
    }
  }

  // 3) lots: location of the master; archive the merged lots into it.
  if (master) {
    const m = Object.assign({}, master);
    m.ubi = dest.map(d => d.vessel).join(', ') + ' · ' + total.toLocaleString('es-MX') + ' L';
    m.vol = total;
    if (mv.kind === 'blend') {
      if (mv.name) { m.nameBefore = m.nameBefore || m.name; m.name = mv.name; }
      m.mergedFrom = (m.mergedFrom || []).slice();
      const sheet = (m.sheet || []).slice();
      for (const p of mv.parents) {
        const pl = lots.find(l => l.id === p.lot) || lotOfTab(lots, p.tab);
        const entry = ((pl && pl.sheet) || []).find(s => s.tab === p.tab) || { tab: p.tab };
        if (!sheet.some(s => s.tab === p.tab)) sheet.push(Object.assign({}, entry, { archived: true, until: today }));
        m.mergedFrom.push({ tab: p.tab, lot: pl ? pl.id : '', name: pl ? pl.name : short(p.tab), liters: p.liters || '', date: today, move: id });
        if (pl && pl.id !== m.id) {
          const rest = (pl.sheet || []).filter(s => s.tab !== p.tab);
          const upd = Object.assign({}, pl, { sheet: rest });
          if (!rest.filter(s => !s.archived).length) Object.assign(upd, { archived: true, mergedInto: m.id, mergedIntoName: m.name, mergedAt: today, archivedSheet: pl.sheet || [] });
          const { id: _i, ...data } = upd; await put(env, 'lots', pl.id, data);
        }
      }
      m.sheet = sheet;
    }
    const { id: _m, ...data } = m; await put(env, 'lots', master.id, data);
  }

  // 4) barrels: empty the source barrels (if the source is empty), fill the destination barrels.
  const barrels = await list(env, 'barrels'), byCode = new Map(barrels.map(x => [String(x.code || x.id), x]));
  const involved = new Set([master && master.id].concat(mv.parents.map(p => p.lot)).filter(Boolean));
  const srcCodes = sourceEmpty ? barrelCodes([mv.from].concat(mv.parents.map(p => p.vessels)).join(' ; ')) : [];
  const dstCodes = new Map(); for (const d of dest) for (const c of barrelCodes(d.vessel.match(/^\d{1,3}$/) ? 'BBL ' + d.vessel : d.vessel)) dstCodes.set(c, d.liters);
  const now = new Date().toISOString(), log = async (code, kind, text) => put(env, 'barrel_log', 'b' + code + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 4), { code: String(code), at: now, by: signer, kind, text });
  const barrelChanges = [];
  for (const c of srcCodes) {
    if (dstCodes.has(c)) continue; const bb = byCode.get(c); if (!bb) continue;
    if (bb.lot && !involved.has(bb.lot)) continue;  // holds another wine: don't touch
    const { id: bid, ...data } = Object.assign({}, bb, { lot: '', fill: 'empty', vol: '', by: signer, at: now });
    await put(env, 'barrels', bid, data); await log(c, 'empty', 'Vaciada (' + (mv.kind === 'blend' ? 'mezcla' : 'trasiego') + ' ' + dm(today) + ')'); barrelChanges.push(c + ' vacía');
  }
  for (const [c, liters] of dstCodes) {
    const bb = byCode.get(c); if (!bb || !master) continue;
    const size = +bb.size || 225;
    const { id: bid, ...data } = Object.assign({}, bb, { lot: master.id, vol: liters, fill: liters < size * 0.9 ? 'partial' : 'full', status: bb.status === 'confirm' ? 'confirmed' : bb.status, by: signer, at: now });
    await put(env, 'barrels', bid, data); await log(c, 'fill', 'Llenada con ' + (mv.name || master.name) + ' · ' + liters + ' L (' + dm(today) + ')'); barrelChanges.push(c + ' ← ' + liters + ' L');
  }

  Object.assign(mv, { status: 'done', done: { by: signer, at: now, date: today, dest, total, sourceEmpty, left, archived, barrels: barrelChanges, note: cell(b.note) } });
  await put(env, 'moves', id, mv);
  try { await sync(env, [mv.tab].concat(archived)); } catch (x) {}
  return { ok: true, id, total, archived, barrels: barrelChanges, master: master ? master.id : '' };
}

export async function movesRoute(request, env, p, user) {
  const J = (body, status = 200) => ({ status, body });
  try {
    if (p === '/api/moves' && request.method === 'GET') return J({ rows: await list(env, 'moves') });
    if (!user.canWrite) return J({ message: 'Solo lectura.' }, 403);
    if (p === '/api/moves' && request.method === 'POST') {
      if (user.crew) return J({ message: 'Solo Eric o Diane crean órdenes de trabajo.' }, 403);
      return J(await createMove(env, await request.json(), user));
    }
    if (p === '/api/moves/complete' && request.method === 'POST') return J(await completeMove(env, await request.json(), user));
    return J({ message: 'Not found' }, 404);
  } catch (e) { return J({ message: e.message || String(e) }, e.status || 500); }
}
