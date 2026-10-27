// In-app chat: Claude with tools over Excellovint (Google Sheets) and the app database (D1).
// Every message is saved in D1 (coll "chatlog"); standing rules live in coll "housenotes", doc "main".
import { accessToken } from './sheets.js';
import { sync } from './xl.js';

const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets/';
const q = (tab) => "'" + String(tab).replace(/'/g, "''") + "'";
const colLetter = (i) => { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
const colIndex = (L) => String(L).toUpperCase().split('').reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
const todayMX = () => new Date(Date.now() - 6 * 3600e3).toISOString().slice(0, 10);
const sheetDate = (iso) => { const [y, m, d] = iso.split('-').map(Number); return m + '/' + d + '/' + y; };
const cell = (v) => String(v == null ? '' : v).trim();

async function gs(env, path, init = {}) {
  const r = await fetch(SHEETS + env.SHEET_ID + path, Object.assign({}, init, { headers: { authorization: 'Bearer ' + await accessToken(env), 'content-type': 'application/json' } }));
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j.error && j.error.message) || 'Google Sheets error ' + r.status);
  return j;
}
async function tabValues(env, tab) { return (await gs(env, '/values/' + encodeURIComponent(q(tab) + '!A1:Q600'))).values || []; }

// Same header detection as the page (SheetParse.headerMap).
function headerMap(values) {
  for (let r = 0; r < Math.min(values.length, 15); r++) {
    const row = (values[r] || []).map(c => cell(c).toUpperCase().replace(/[.\s]/g, ''));
    if (row.includes('UBI') && row.some(c => c.startsWith('ACCION'))) {
      const m = { date: 0 };
      row.forEach((c, i) => {
        if (c === 'FECHA' || c === 'FETCH' || c === 'DATE') m.date = i;
        else if (c === 'UBI') m.ubi = i; else if (c === 'VOLI') m.voli = i; else if (c === 'VOLF') m.volf = i;
        else if (['PH', 'BX', 'TP', 'AT', 'AM', 'SL', 'ST', 'AA'].includes(c)) m[c.toLowerCase()] = i;
        else if (c.startsWith('ACCION')) m.note = i; else if (c === 'PRI' || c.startsWith('PRIOR')) m.pri = i;
        else if (c.startsWith('ASSGN')) m.by = i; else if (c === 'ASIG') m.asig = i; else if (c.startsWith('INI')) m.ini = i;
      });
      return { row: r, map: m };
    }
  }
  return null;
}
const rowObj = (hm, r, n) => { const o = { row: n }; for (const [k, i] of Object.entries(hm.map)) { const v = cell(r[i]); if (v) o[k] = v; } return o; };

async function lotTabs(env) {
  const j = await gs(env, '?fields=sheets.properties.title');
  return j.sheets.map(s => s.properties.title).filter(t => /^L\d/i.test(t) && !/BTs/i.test(t));
}
async function dbList(env, coll) {
  const { results } = await env.DB.prepare('SELECT id, data FROM docs WHERE coll = ?').bind(coll).all();
  return results.map(r => Object.assign({ id: r.id }, JSON.parse(r.data)));
}
async function dbPut(env, coll, id, data) {
  await env.DB.prepare('INSERT INTO docs (coll, id, data, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(coll, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at')
    .bind(coll, id, JSON.stringify(data), Date.now()).run();
}

// ---------- tools ----------
const TOOLS = [
  { name: 'list_wines', description: 'All wines/lots in the cellar app: id, name, vessel/volume line, and which Excellovint tab(s) hold their log.', input_schema: { type: 'object', properties: {} } },
  { name: 'read_tab', description: 'Read the last rows of one Excellovint tab (e.g. "L08 - SE", "L00 - Winery"). Returns rows with their sheet row number and named columns: date, ubi, voli, volf, ph, bx, tp, at, am (malic), sl (free SO2), st (total SO2), aa (VA), note (ACCION), pri, by, asig, ini (done initials; XX = cancelled).', input_schema: { type: 'object', properties: { tab: { type: 'string' }, last: { type: 'integer', description: 'How many of the last rows (default 30, max 120)' } }, required: ['tab'] } },
  { name: 'open_work_orders', description: 'Every open work order across all lot tabs: rows with ASIG set and INI empty, optionally only those dated on/before a date or assigned to someone.', input_schema: { type: 'object', properties: { asig: { type: 'string', description: 'Filter, e.g. "P", "J", "P/J", "D"' }, through: { type: 'string', description: 'YYYY-MM-DD; only rows dated on or before this' } } } },
  { name: 'create_work_order', description: 'Append a work order row to a lot tab in Excellovint. Write the ACCION text in Spanish, in capitals, clear for the crew. The row appears in Excellovint immediately.', input_schema: { type: 'object', properties: { tab: { type: 'string' }, date: { type: 'string', description: 'YYYY-MM-DD, default today' }, ubi: { type: 'string', description: 'Vessel, e.g. VC-02, BBL 101' }, vol: { type: 'string', description: 'Volume in liters if known' }, text: { type: 'string' }, asig: { type: 'string', description: 'Crew initials: P, J, P/J, D, EM, EM/D…' }, pri: { type: 'string', enum: ['URGENT', 'HIGH', 'NORMAL', ''] } }, required: ['tab', 'text', 'asig'] } },
  { name: 'update_row', description: 'Change cells in an existing row of a lot tab (e.g. mark done with initials in ini, cancel with XX, change date, priority, assignee, text, or record a lab value). Only the fields given are changed. Read the row first.', input_schema: { type: 'object', properties: { tab: { type: 'string' }, row: { type: 'integer' }, set: { type: 'object', description: 'Field → value, using the read_tab field names (date as YYYY-MM-DD).', additionalProperties: { type: 'string' } } }, required: ['tab', 'row', 'set'] } },
  { name: 'calendar_tasks', description: 'Tasks on the app calendar (not Excellovint), optionally for one wine id and/or one week (Monday YYYY-MM-DD).', input_schema: { type: 'object', properties: { lot: { type: 'string' }, week: { type: 'string' }, open_only: { type: 'boolean' } } } },
  { name: 'protocols', description: 'List protocol/lesson ids and titles, or get one protocol\'s full text by id.', input_schema: { type: 'object', properties: { id: { type: 'string' } } } },
  { name: 'add_house_note', description: 'Save a standing rule or decision the user wants remembered (always loaded into this chat). Only when the user asks to remember something or states a lasting rule.', input_schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
  { name: 'search_chats', description: 'Search earlier chat messages (all users) for a word or phrase, to recall past decisions.', input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
  { name: 'list_purchases', description: 'The winery purchases list (Compras): things to buy, ranked high/medium/low, with who buys it, where, and status open/ordered/received.', input_schema: { type: 'object', properties: { status: { type: 'string', description: 'open (default), ordered, received, or all' } } } },
  { name: 'add_purchase', description: 'Add an item to the purchases list.', input_schema: { type: 'object', properties: { item: { type: 'string', description: 'What to buy, short' }, qty: { type: 'string' }, pri: { type: 'string', description: 'high | medium | low' }, asig: { type: 'string', description: 'Who buys it: EM, D, P/J, P, J' }, where: { type: 'string', description: 'EE. UU., México, En línea, or a store/site' }, notes: { type: 'string', description: 'Brand, model, supplier, link, why' } }, required: ['item'] } },
  { name: 'update_purchase', description: 'Change a purchase: status (open/ordered/received), priority, assignee, notes, or delete it.', input_schema: { type: 'object', properties: { id: { type: 'string' }, set: { type: 'object', description: 'Fields to change: item, qty, pri, asig, where, notes, status' }, delete: { type: 'boolean' } }, required: ['id'] } },
];

async function runTool(env, ctx, name, a) {
  if (name === 'list_wines') {
    return (await dbList(env, 'lots')).map(l => ({ id: l.id, name: l.name, line: l.ubi, tabs: (l.sheet || []).map(x => x.tab), group: l.group }));
  }
  if (name === 'read_tab') {
    const v = await tabValues(env, a.tab), hm = headerMap(v);
    if (!hm) return { error: 'No header row in ' + a.tab };
    const n = Math.min(a.last || 30, 120), start = Math.max(hm.row + 1, v.length - n);
    const rows = []; for (let i = start; i < v.length; i++) if ((v[i] || []).some(c => cell(c))) rows.push(rowObj(hm, v[i], i + 1));
    return { tab: a.tab, rows };
  }
  if (name === 'open_work_orders') {
    const tabs = await lotTabs(env);
    const j = await gs(env, '/values:batchGet?' + tabs.map(t => 'ranges=' + encodeURIComponent(q(t) + '!A1:Q600')).join('&'));
    const out = [];
    j.valueRanges.forEach((vr, k) => {
      const v = vr.values || [], hm = headerMap(v); if (!hm || hm.map.asig == null) return;
      for (let i = hm.row + 1; i < v.length; i++) {
        const o = rowObj(hm, v[i] || [], i + 1);
        if (!o.asig || o.ini) continue;
        if (a.asig && !o.asig.toUpperCase().split(/[\/,&\s]+/).some(x => a.asig.toUpperCase().split('/').includes(x))) continue;
        out.push(Object.assign({ tab: tabs[k] }, o));
      }
    });
    return out.slice(-150);
  }
  if (name === 'create_work_order') {
    const v = await tabValues(env, a.tab), hm = headerMap(v);
    if (!hm || hm.map.note == null) return { error: 'No header row in ' + a.tab };
    const m = hm.map, rowNum = Math.max(v.length, hm.row + 1) + 1, width = Math.max(...Object.values(m)) + 1;
    const row = new Array(width).fill('');
    row[m.date] = sheetDate(a.date || todayMX());
    if (m.ubi != null) row[m.ubi] = String(a.ubi || '?').toUpperCase();
    if (m.volf != null) row[m.volf] = a.vol || '?';
    row[m.note] = String(a.text).toUpperCase();
    if (m.pri != null) row[m.pri] = (a.pri || '').toUpperCase();
    if (m.by != null) row[m.by] = ctx.initials;
    if (m.asig != null) row[m.asig] = String(a.asig).toUpperCase();
    await gs(env, '/values/' + encodeURIComponent(q(a.tab) + '!A' + rowNum + ':' + colLetter(width - 1) + rowNum) + '?valueInputOption=USER_ENTERED', { method: 'PUT', body: JSON.stringify({ values: [row] }) });
    ctx.changed = true;
    try { await sync(env, [a.tab]); } catch (e) {}
    return { ok: true, tab: a.tab, row: rowNum };
  }
  if (name === 'update_row') {
    const v = await tabValues(env, a.tab), hm = headerMap(v);
    if (!hm) return { error: 'No header row in ' + a.tab };
    if (a.row <= hm.row + 1) return { error: 'That is the header area.' };
    const data = [];
    for (const [k, val] of Object.entries(a.set || {})) {
      const i = hm.map[k]; if (i == null) return { error: 'Unknown field ' + k };
      const out = k === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(val) ? sheetDate(val) : (k === 'note' ? String(val).toUpperCase() : val);
      data.push({ range: q(a.tab) + '!' + colLetter(i) + a.row, values: [[out]] });
    }
    await gs(env, '/values:batchUpdate', { method: 'POST', body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data }) });
    ctx.changed = true;
    try { await sync(env, [a.tab]); } catch (e) {}
    return { ok: true, before: rowObj(hm, v[a.row - 1] || [], a.row) };
  }
  if (name === 'calendar_tasks') {
    let t = await dbList(env, 'tasks');
    if (a.lot) t = t.filter(x => x.lot === a.lot);
    if (a.week) t = t.filter(x => x.week === a.week);
    if (a.open_only) t = t.filter(x => !x.done);
    return t.slice(0, 120).map(x => ({ id: x.id, lot: x.lot, week: x.week, day: x.day, text: x.text, done: !!x.done, pri: x.pri, asig: x.asig, wo: x.wo ? x.wo.tab + ' row ' + x.wo.row : undefined }));
  }
  if (name === 'protocols') {
    const p = await dbList(env, 'protocols');
    if (!a.id) return p.map(x => ({ id: x.id, title: x.title, cat: x.cat }));
    const d = p.find(x => x.id === a.id); return d ? { id: d.id, title: d.title, md: String(d.md || '').slice(0, 20000) } : { error: 'not found' };
  }
  if (name === 'add_house_note') {
    const notes = await houseNotes(env);
    notes.lines.push({ text: String(a.text).slice(0, 500), by: ctx.initials, at: new Date().toISOString() });
    await dbPut(env, 'housenotes', 'main', notes);
    return { ok: true, count: notes.lines.length };
  }
  if (name === 'search_chats') {
    const like = '%' + String(a.query).replace(/[%_]/g, '') + '%';
    const { results } = await env.DB.prepare("SELECT data FROM docs WHERE coll = 'chatlog' AND data LIKE ? ORDER BY updated_at DESC LIMIT 20").bind(like).all();
    return results.map(r => { const d = JSON.parse(r.data); return { at: d.at, who: d.who, role: d.role, text: String(d.text).slice(0, 600) }; });
  }
  if (name === 'list_purchases') {
    const st = a.status || 'open', order = { high: 0, medium: 1, low: 2 };
    return (await dbList(env, 'purchases')).filter(p => st === 'all' || (p.status || 'open') === st)
      .sort((x, y) => (order[x.pri] ?? 1) - (order[y.pri] ?? 1))
      .map(p => ({ id: p.id, item: p.item, qty: p.qty, pri: p.pri, asig: p.asig, where: p.where, status: p.status || 'open', notes: p.notes, by: p.by, at: p.at }));
  }
  if (name === 'add_purchase') {
    const id = 'p' + Date.now().toString(36);
    const pri = ['high', 'medium', 'low'].includes(String(a.pri || '').toLowerCase()) ? String(a.pri).toLowerCase() : 'medium';
    await dbPut(env, 'purchases', id, { item: String(a.item).slice(0, 200), qty: String(a.qty || '').slice(0, 60), pri, asig: String(a.asig || ctx.initials).toUpperCase(), where: String(a.where || '').slice(0, 60), notes: String(a.notes || '').slice(0, 1000), status: 'open', by: ctx.initials, at: new Date().toISOString() });
    ctx.actions.push({ kind: 'purchase', text: 'Compra: ' + a.item + ' (' + pri + ', ' + String(a.asig || ctx.initials).toUpperCase() + ')' });
    return { ok: true, id };
  }
  if (name === 'update_purchase') {
    const cur = (await dbList(env, 'purchases')).find(p => p.id === a.id);
    if (!cur) return { error: 'No purchase with id ' + a.id };
    if (a.delete) { await env.DB.prepare("DELETE FROM docs WHERE coll = 'purchases' AND id = ?").bind(a.id).run(); return { ok: true, deleted: cur.item }; }
    const set = a.set || {}, next = Object.assign({}, cur);
    delete next.id;
    for (const k of ['item', 'qty', 'pri', 'asig', 'where', 'notes', 'status']) if (set[k] != null) next[k] = String(set[k]);
    if (next.status === 'ordered' && cur.status !== 'ordered') next.orderedAt = new Date().toISOString();
    if (next.status === 'received' && cur.status !== 'received') next.receivedAt = new Date().toISOString();
    await dbPut(env, 'purchases', a.id, next);
    ctx.actions.push({ kind: 'purchase', text: 'Compra actualizada: ' + next.item + (set.status ? ' → ' + set.status : '') });
    return { ok: true, item: next.item, status: next.status };
  }
  return { error: 'unknown tool' };
}

async function houseNotes(env) {
  const r = await env.DB.prepare("SELECT data FROM docs WHERE coll = 'housenotes' AND id = 'main'").first();
  return r ? JSON.parse(r.data) : { lines: [] };
}

function system(notes, ctx) {
  return `You are the cellar assistant inside Bodega Dos Búhos' Cellar Target Calendar (certified organic winery, San Miguel de Allende, ~2,000 m). You are talking with ${ctx.name} (${ctx.initials}). Today is ${todayMX()} (America/Mexico_City).

Excellovint is the Google Sheet the crew works from: one tab per lot ("L08 - SE" …) plus "L00 - Winery" for winery-wide jobs. Work order columns: FECHA, UBI, VOL I/F, PH, BX, TP, AT, AM (malic), SL (free SO2), ST (total SO2), AA (VA), ACCION, PRI (URGENT/HIGH/NORMAL), ASSGN BY, ASIG (who), INI (initials when done; XX = cancelled).
Crew: P = Paris, J = Jimena, P/J = both; D = Diane (head winemaker); EM = Eric (owner); Margaro helps move barrels; Ángel and Eduvijes ("Vijes") help with tasks like bottling. Voice-to-text garbles names ("Barisan Jimena" = P/J, "Uvai Vino" = Uva y Vino).

How to work:
- Be concise and direct. No filler.
- Use the tools for any fact about wines, numbers or orders; don't guess. Read a tab before editing a row.
- Create or change Excellovint rows when asked, then say exactly what you wrote (tab, row). If a request is ambiguous (which tab, who, which day), ask one short question first.
- Work order text: Spanish, capitals, concrete steps the crew can follow; keep numbers and units.
- Things to BUY (reagents, supplies, parts, equipment) go on the purchases list (Compras) with add_purchase, not into Excellovint. Priority high/medium/low; assignee defaults to the person talking.
- SO2 math: molecular = free ÷ (1 + 10^(pH − 1.81)); KMBS grams = mg/L × liters ÷ 576.

House notes (standing rules and decisions; follow them):
${notes.lines.map(l => '- ' + l.text).join('\n') || '- (none yet)'}`;
}

export async function chat(request, env, user) {
  if (!env.ANTHROPIC_API_KEY) return { status: 503, body: { message: 'ANTHROPIC_API_KEY is not set.' } };
  const { text } = await request.json();
  if (!String(text || '').trim()) return { status: 400, body: { message: 'bad request' } };
  const conv = 'u-' + String(user.initials || 'x').replace(/[^\w]/g, '_'); // one running thread per person
  const ctx = { initials: user.initials, name: user.name, changed: false, actions: [] };
  const now = Date.now();
  const save = (role, t) => dbPut(env, 'chatlog', conv + '-' + Date.now() + '-' + role, { conv, role, who: role === 'user' ? user.initials : 'claude', text: t, at: new Date().toISOString() });

  // Recent history of this conversation (last 20 messages).
  const { results } = await env.DB.prepare("SELECT data FROM docs WHERE coll = 'chatlog' AND id LIKE ? ORDER BY updated_at DESC LIMIT 30").bind(conv + '-%').all();
  const hist = results.map(r => JSON.parse(r.data)).reverse().map(m => ({ role: m.role, content: m.text }));
  await save('user', String(text).slice(0, 8000));
  const messages = hist.concat([{ role: 'user', content: String(text).slice(0, 8000) }]);
  // Anthropic requires alternating roles starting with user.
  while (messages.length && messages[0].role !== 'user') messages.shift();

  const sys = system(await houseNotes(env), ctx);
  let final = '';
  for (let step = 0; step < 10; step++) {
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST',
      headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: env.AI_MODEL || 'claude-sonnet-5-5', max_tokens: 3000, system: sys, tools: TOOLS, messages }) });
    if (!r.ok) { const t = await r.text(); return { status: r.status === 429 ? 429 : 502, body: { message: t.slice(0, 400) } }; }
    const j = await r.json();
    messages.push({ role: 'assistant', content: j.content });
    const uses = j.content.filter(c => c.type === 'tool_use');
    final = j.content.filter(c => c.type === 'text').map(c => c.text).join('');
    if (j.stop_reason !== 'tool_use' || !uses.length) break;
    const results2 = [];
    for (const u of uses) {
      let out;
      try { out = await runTool(env, ctx, u.name, u.input || {}); } catch (e) { out = { error: String(e && e.message || e) }; }
      if (/^(create_work_order|update_row|add_house_note)$/.test(u.name) && out && out.ok) ctx.actions.push({ tool: u.name, input: u.input, result: out });
      results2.push({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(out).slice(0, 60000) });
    }
    messages.push({ role: 'user', content: results2 });
  }
  await save('assistant', final || '(no answer)');
  return { status: 200, body: { text: final, changed: ctx.changed, actions: ctx.actions, ms: Date.now() - now } };
}

export async function chatHistory(env, user) {
  const conv = 'u-' + String(user.initials || 'x').replace(/[^\w]/g, '_');
  const { results } = await env.DB.prepare("SELECT data FROM docs WHERE coll = 'chatlog' AND id LIKE ? ORDER BY updated_at DESC LIMIT 80").bind(conv + '-%').all();
  return results.reverse().map(r => { const d = JSON.parse(r.data); return { role: d.role, text: d.text, who: d.who, at: d.at }; });
}
export { houseNotes };
