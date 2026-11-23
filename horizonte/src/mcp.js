// MCP server for Horizonte: lets an assistant (Claude, ChatGPT, anything that speaks MCP over Streamable HTTP)
// read and write the planner. Stateless JSON-RPC over POST; no sessions, no SSE. Auth is a token minted in
// Settings, carried in the path (/mcp/<token>) or as a Bearer header. Writes go through the same field-merge
// as devices do (applyOps), with the clock device id "mcp", so every device converges and meetings sync to Google.

const PROTOCOL = '2025-06-18';
const SERVER = { name: 'horizonte', version: '1.0.0' };
const pad = (n) => String(n).padStart(2, '0');
const toMin = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };
const fromMin = (m) => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;
const fmtDur = (m) => m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ' ' + (m % 60) + 'm' : ''}` : `${m}m`;

// ── tokens ────────────────────────────────────────────────────
export async function sha256(str) { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str)); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join(''); }
export function newToken() { const b = crypto.getRandomValues(new Uint8Array(24)); return 'hz_' + btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
async function tokenRow(env, token) {
  if (!token || !token.startsWith('hz_') || token.length < 20) return null;
  const row = await env.DB.prepare('SELECT id, name FROM api_tokens WHERE hash = ?').bind(await sha256(token)).first();
  if (row) await env.DB.prepare('UPDATE api_tokens SET last_used = ? WHERE id = ?').bind(Date.now(), row.id).run();
  return row;
}

// ── dates in the planner's time zone ─────────────────────────
function tzParts(tz, d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d).map(x => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, min: (Number(p.hour) % 24) * 60 + Number(p.minute) };
}
const parseD = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d, 12)); };
const dkey = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const addDays = (k, n) => { const d = parseD(k); d.setUTCDate(d.getUTCDate() + n); return dkey(d); };
function isoWeek(k) { const d = parseD(k); const day = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - day + 3); const y = d.getUTCFullYear(); const jan4 = new Date(Date.UTC(y, 0, 4, 12));
  return `${y}-W${pad(1 + Math.round(((d - jan4) / 864e5 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7))}`; }
const kindOf = (k) => !k ? null : /^\d{4}-\d\d-\d\d$/.test(k) ? 'day' : /W/.test(k) ? 'week' : /Q/.test(k) ? 'quarter' : /^\d{4}-\d\d$/.test(k) ? 'month' : 'year';
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function periodRange(k) { // [first day, last day] of a period key
  const kind = kindOf(k);
  if (kind === 'day') return [k, k];
  if (kind === 'week') { const [y, w] = k.split('-W').map(Number); const jan4 = new Date(Date.UTC(y, 0, 4, 12)); jan4.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7) + (w - 1) * 7); const s = dkey(jan4); return [s, addDays(s, 6)]; }
  if (kind === 'month') { const [y, m] = k.split('-').map(Number); return [`${k}-01`, dkey(new Date(Date.UTC(y, m, 0, 12)))]; }
  if (kind === 'quarter') { const [y, q] = k.split('-Q').map(Number); const m0 = (q - 1) * 3; return [`${y}-${pad(m0 + 1)}-01`, dkey(new Date(Date.UTC(y, m0 + 3, 0, 12)))]; }
  return [`${k}-01-01`, `${k}-12-31`];
}

// ── data access ──────────────────────────────────────────────
async function loadAll(env) {
  const { results } = await env.DB.prepare("SELECT kind, id, data FROM rec WHERE kind IN ('task','board','pref')").all();
  const tasks = [], boards = []; let pref = {};
  for (const r of results) { const d = JSON.parse(r.data); d.id = r.id; if (r.kind === 'task') tasks.push(d); else if (r.kind === 'board') boards.push(d); else if (r.id === 'main') pref = d; }
  return { tasks, boards, pref };
}
const live = (tasks) => tasks.filter(t => !t.del && t.status !== 'dropped');
const isOpen = (t) => t.status !== 'done';
const clock = () => `${Date.now().toString(36).padStart(9, '0')}.000.mcp`;
const rid = () => 't_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

function view(t, ctx) {
  const board = t.board ? ctx.boards.find(b => b.id === t.board) : null;
  const o = { id: t.id, title: t.title, kind: t.kind === 'meeting' ? 'meeting' : 'task', status: t.status || 'open', priority: t.pri || 'normal', when: t.when || null, time: t.at || null, duration_minutes: t.dur || 30 };
  if (t.at) o.ends = fromMin(toMin(t.at) + (t.dur || 30));
  if (board) o.board = board.name; if (t.section) o.section = t.section;
  if (t.tags?.length) o.tags = t.tags.map(id => ctx.tagName(id));
  if (t.notes) o.notes = t.notes; if (t.emoji) o.icon = t.emoji; if (t.color) o.highlight = t.color;
  if (t.spent) o.logged_minutes = t.spent; if (t.timer) o.timer_running_since = t.timer;
  if (t.rolls) o.times_pushed = t.rolls; if (t.doneAt) o.done_at = t.doneAt; if (t.created) o.created = t.created;
  return o;
}

// ── tools ────────────────────────────────────────────────────
const TOOLS = [
  { name: 'get_day', description: 'The plan for one day: meetings, timed tasks, untimed tasks, what is done, targets, free time inside the workday. Defaults to today in the planner\'s time zone. Use this first when asked about "today" or "my day".',
    inputSchema: { type: 'object', properties: { date: { type: 'string', description: 'YYYY-MM-DD; omit for today' } } } },
  { name: 'list_tasks', description: 'List open tasks by scope: inbox (unplaced, no board), overdue (placed on a past day/period, still open), week (this week\'s days and the week itself), board (give board), upcoming (next 14 days), all. Optional text query and tag filter. Done tasks only with include_done.',
    inputSchema: { type: 'object', properties: { scope: { type: 'string', enum: ['inbox', 'overdue', 'week', 'board', 'upcoming', 'all'] }, board: { type: 'string', description: 'board name or id (scope=board)' }, tag: { type: 'string' }, query: { type: 'string', description: 'words that must appear in title or notes' }, include_done: { type: 'boolean' }, limit: { type: 'integer', minimum: 1, maximum: 300 } }, required: ['scope'] } },
  { name: 'list_boards', description: 'Boards (projects/areas) with their sections and open-task counts, plus the tag list and the workday settings.', inputSchema: { type: 'object', properties: {} } },
  { name: 'add_task', description: 'Create a task or meeting. "when" is a day (YYYY-MM-DD) or a horizon key: week YYYY-Www, month YYYY-MM, quarter YYYY-Qn, year YYYY; omit to leave it in the inbox. Meetings need a day and a time and sync to Google Calendar. Tags and boards are matched by name (tags are created if new). priority: target (one of the day\'s few must-dos), normal, someday.',
    inputSchema: { type: 'object', properties: { title: { type: 'string' }, when: { type: 'string' }, time: { type: 'string', description: 'HH:MM 24h' }, duration_minutes: { type: 'integer', minimum: 5 }, priority: { type: 'string', enum: ['target', 'normal', 'someday'] }, tags: { type: 'array', items: { type: 'string' } }, board: { type: 'string' }, section: { type: 'string' }, kind: { type: 'string', enum: ['task', 'meeting'] }, notes: { type: 'string' }, icon: { type: 'string', description: 'one emoji' }, highlight: { type: 'string', description: 'colour 1-11 (Google Calendar palette) or "" for none' } }, required: ['title'] } },
  { name: 'update_task', description: 'Change any fields of a task: reschedule (when/time), duration, title, notes, priority, tags (replaces the list), board/section, status (open|done|dropped), icon, highlight. Set when to "" to send it back to the inbox, time to "" to drop the start time.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' }, when: { type: 'string' }, time: { type: 'string' }, duration_minutes: { type: 'integer', minimum: 5 }, priority: { type: 'string', enum: ['target', 'normal', 'someday'] }, tags: { type: 'array', items: { type: 'string' } }, board: { type: 'string' }, section: { type: 'string' }, status: { type: 'string', enum: ['open', 'done', 'dropped'] }, notes: { type: 'string' }, icon: { type: 'string' }, highlight: { type: 'string' } }, required: ['id'] } },
  { name: 'complete_task', description: 'Mark a task done (optionally recording how long it actually took).', inputSchema: { type: 'object', properties: { id: { type: 'string' }, took_minutes: { type: 'integer', minimum: 5 } }, required: ['id'] } },
  { name: 'delete_task', description: 'Delete a task (soft delete; recoverable only from the database).', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'day_summary', description: 'Where the time went on a day or in a week: minutes planned in meetings vs tasks, by board and by tag, targets hit, tasks done, tasks pushed. Defaults to today. Give a week key (YYYY-Www) for a weekly summary.',
    inputSchema: { type: 'object', properties: { period: { type: 'string', description: 'YYYY-MM-DD or YYYY-Www; omit for today' } } } },
];

function ctxFor(all, tz) {
  const tags = all.pref.tags || [];
  const now = tzParts(tz);
  return { ...all, tz, today: now.day, nowMin: now.min, tagName: (id) => (tags.find(x => x.id === id) || {}).name || id,
    tagId: (name) => { const n = String(name).trim().toLowerCase(); return (tags.find(x => x.name.toLowerCase() === n || x.id === n) || {}).id || null; },
    boardId: (name) => { if (!name) return null; const n = String(name).trim().toLowerCase(); return (all.boards.find(b => !b.del && (b.name.toLowerCase() === n || b.id === n)) || {}).id || null; } };
}
const slug = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const TAGCOLORS = ['red', 'orange', 'amber', 'yellow', 'green', 'teal', 'cyan', 'blue', 'indigo', 'purple', 'pink', 'grey'];

async function run(name, a, env, ctx, commit) {
  const T = live(ctx.tasks);
  const placedOn = (k) => T.filter(t => t.when === k);
  const inRange = (t, s, e) => { if (!t.when) return false; const [a1, b1] = periodRange(t.when); return b1 >= s && a1 <= e; };
  switch (name) {
    case 'get_day': {
      const k = a.date || ctx.today, pref = ctx.pref, ws = toMin(pref.dayStart || '09:00'), we = toMin(pref.dayEnd || '18:00');
      const all = placedOn(k).map(t => view(t, ctx)), meetings = all.filter(t => t.kind === 'meeting'), tasks = all.filter(t => t.kind === 'task');
      const timed = all.filter(t => t.time && t.status !== 'done').map(t => [toMin(t.time), toMin(t.time) + t.duration_minutes]).sort((x, y) => x[0] - y[0]);
      let free = 0, cur = Math.max(ws, k === ctx.today ? ctx.nowMin : ws); for (const [s, e] of timed) { if (s > cur) free += Math.min(s, we) - cur > 0 ? Math.min(s, we) - cur : 0; cur = Math.max(cur, e); } if (we > cur) free += we - cur;
      const targets = tasks.filter(t => t.priority === 'target');
      return { date: k, weekday: DOW[parseD(k).getUTCDay()], is_today: k === ctx.today, now: k === ctx.today ? fromMin(ctx.nowMin) : undefined, workday: `${pref.dayStart || '09:00'}–${pref.dayEnd || '18:00'}`,
        planned: fmtDur(all.filter(t => t.status !== 'done').reduce((s, t) => s + t.duration_minutes, 0)), free_in_workday: fmtDur(Math.max(0, free)),
        targets: `${targets.filter(t => t.status === 'done').length} of ${targets.length} done`, done: all.filter(t => t.status === 'done').length,
        meetings: meetings.sort((x, y) => (x.time || '').localeCompare(y.time || '')), timed_tasks: tasks.filter(t => t.time).sort((x, y) => x.time.localeCompare(y.time)), untimed_tasks: tasks.filter(t => !t.time),
        overdue_count: T.filter(t => isOpen(t) && t.when && periodRange(t.when)[1] < ctx.today).length };
    }
    case 'list_tasks': {
      let list = T; const lim = Math.min(a.limit || 100, 300);
      if (!a.include_done) list = list.filter(isOpen);
      const wk = isoWeek(ctx.today), [ws, we] = periodRange(wk);
      if (a.scope === 'inbox') list = list.filter(t => !t.board && !t.when);
      else if (a.scope === 'overdue') list = list.filter(t => isOpen(t) && t.when && periodRange(t.when)[1] < ctx.today);
      else if (a.scope === 'week') list = list.filter(t => t.when === wk || (kindOf(t.when) === 'day' && t.when >= ws && t.when <= we));
      else if (a.scope === 'upcoming') list = list.filter(t => inRange(t, ctx.today, addDays(ctx.today, 14)));
      else if (a.scope === 'board') { const id = ctx.boardId(a.board); if (!id) throw new Error(`No board named "${a.board}"`); list = list.filter(t => t.board === id); }
      if (a.tag) { const id = ctx.tagId(a.tag); list = id ? list.filter(t => (t.tags || []).includes(id)) : []; }
      if (a.query) { const words = String(a.query).toLowerCase().split(/\s+/).filter(Boolean); list = list.filter(t => { const h = `${t.title} ${t.notes || ''}`.toLowerCase(); return words.every(w => h.includes(w)); }); }
      list = list.sort((x, y) => (x.when || '9').localeCompare(y.when || '9') || (x.at || '').localeCompare(y.at || '') || (x.o ?? 0) - (y.o ?? 0));
      return { count: list.length, tasks: list.slice(0, lim).map(t => view(t, ctx)) };
    }
    case 'list_boards': {
      const boards = ctx.boards.filter(b => !b.del && !b.archived).map(b => ({ id: b.id, name: b.name, sections: b.sections || [], open_tasks: T.filter(t => isOpen(t) && t.board === b.id).length }));
      return { boards, tags: (ctx.pref.tags || []).map(x => x.name), workday: `${ctx.pref.dayStart || '09:00'}–${ctx.pref.dayEnd || '18:00'}`, targets_per_day: ctx.pref.cap || 3, time_zone: ctx.tz, today: ctx.today };
    }
    case 'add_task': case 'update_task': {
      const isNew = name === 'add_task'; const t = isNew ? null : T.find(x => x.id === a.id) || ctx.tasks.find(x => x.id === a.id);
      if (!isNew && !t) throw new Error(`No task ${a.id}`);
      const f = {}, ops = [];
      if (isNew) Object.assign(f, { title: '', notes: '', board: '', section: '', pri: 'normal', status: 'open', dur: 30, when: null, at: '', rolls: 0, src: 'mcp', created: new Date().toISOString(), o: -Date.now(), tags: [] });
      if (a.title != null) f.title = String(a.title).trim();
      if (a.notes != null) f.notes = String(a.notes);
      if (a.when != null) { const w = String(a.when).trim(); if (w && !kindOf(w)) throw new Error('when must be YYYY-MM-DD, YYYY-Www, YYYY-MM, YYYY-Qn or YYYY'); f.when = w || null; }
      if (a.time != null) { const tm = String(a.time).trim(); if (tm && !/^\d{2}:\d{2}$/.test(tm)) throw new Error('time must be HH:MM'); f.at = tm; if (tm && kindOf(f.when ?? t?.when) !== 'day') f.when = ctx.today; }
      if (a.duration_minutes != null) f.dur = Math.max(5, Math.round(a.duration_minutes / 5) * 5);
      if (a.priority) f.pri = a.priority;
      if (a.kind) { f.kind = a.kind === 'meeting' ? 'meeting' : ''; if (f.kind && (f.dur ?? t?.dur ?? 30) < 60 && a.duration_minutes == null) f.dur = 60; }
      if (a.status) { f.status = a.status; f.doneAt = a.status === 'done' ? new Date().toISOString() : null; }
      if (a.icon != null) f.emoji = String(a.icon).trim();
      if (a.highlight != null) f.color = String(a.highlight);
      if (a.board != null) { if (a.board === '') { f.board = ''; f.section = ''; } else { const id = ctx.boardId(a.board); if (!id) throw new Error(`No board named "${a.board}"`); f.board = id; f.section = a.section || ''; } }
      else if (a.section != null) f.section = a.section;
      if (a.tags) { const tags = [...(ctx.pref.tags || [])]; let added = false; f.tags = [];
        for (const n of a.tags) { let id = ctx.tagId(n); if (!id) { id = slug(n) || 't' + Date.now().toString(36); tags.push({ id, name: String(n).trim(), color: TAGCOLORS[tags.length % TAGCOLORS.length] }); added = true; } if (!f.tags.includes(id)) f.tags.push(id); }
        if (added) ops.push({ k: 'pref', id: 'main', f: { tags }, t: clock() }); }
      if ((f.kind ?? t?.kind) === 'meeting' && !(f.at ?? t?.at)) throw new Error('A meeting needs a time');
      const id = isNew ? rid() : t.id; ops.push({ k: 'task', id, f, t: clock() });
      await commit(ops, [id]);
      const fresh = await loadAll(env); const c2 = ctxFor(fresh, ctx.tz); const nt = fresh.tasks.find(x => x.id === id);
      return { ok: true, task: view(nt, c2) };
    }
    case 'complete_task': {
      const t = T.find(x => x.id === a.id); if (!t) throw new Error(`No task ${a.id}`);
      const f = { status: 'done', doneAt: new Date().toISOString() }; if (a.took_minutes) f.dur = Math.max(5, Math.round(a.took_minutes / 5) * 5);
      await commit([{ k: 'task', id: t.id, f, t: clock() }], [t.id]); return { ok: true, id: t.id, title: t.title, status: 'done' };
    }
    case 'delete_task': {
      const t = ctx.tasks.find(x => x.id === a.id); if (!t) throw new Error(`No task ${a.id}`);
      await commit([{ k: 'task', id: t.id, f: { del: new Date().toISOString() }, t: clock() }], [t.id]); return { ok: true, id: t.id, deleted: t.title };
    }
    case 'day_summary': {
      const k = a.period || ctx.today, kind = kindOf(k); if (!['day', 'week'].includes(kind)) throw new Error('period must be a day or a week');
      const [s, e] = periodRange(k); const list = T.filter(t => t.when && kindOf(t.when) === 'day' && t.when >= s && t.when <= e || (kind === 'week' && t.when === k));
      const by = (fn) => { const m = {}; for (const t of list) { const key = fn(t) || '(none)'; m[key] = (m[key] || 0) + (t.dur || 30); } return Object.fromEntries(Object.entries(m).sort((x, y) => y[1] - x[1]).map(([kk, v]) => [kk, fmtDur(v)])); };
      const meetings = list.filter(t => t.kind === 'meeting'), tasks = list.filter(t => t.kind !== 'meeting'), done = tasks.filter(t => !isOpen(t)), targets = tasks.filter(t => t.pri === 'target');
      return { period: k, days: `${s}${e !== s ? ' – ' + e : ''}`, meetings: { count: meetings.length, time: fmtDur(meetings.reduce((x, t) => x + (t.dur || 30), 0)) },
        tasks: { planned: tasks.length, done: done.length, open: tasks.length - done.length, time_done: fmtDur(done.reduce((x, t) => x + (t.dur || 30), 0)), time_open: fmtDur(tasks.filter(isOpen).reduce((x, t) => x + (t.dur || 30), 0)) },
        targets: `${targets.filter(t => !isOpen(t)).length} of ${targets.length} done`, pushed: tasks.filter(t => (t.rolls || 0) > 0).length, stuck: tasks.filter(t => (t.rolls || 0) >= 3 && isOpen(t)).map(t => t.title),
        time_by_board: by(t => t.board ? (ctx.boards.find(b => b.id === t.board) || {}).name : 'No board'), time_by_tag: by(t => (t.tags || [])[0] ? ctx.tagName(t.tags[0]) : 'Untagged'),
        done_titles: done.map(t => t.title) };
    }
    default: throw new Error(`Unknown tool ${name}`);
  }
}

// ── JSON-RPC / Streamable HTTP ───────────────────────────────
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST, GET, OPTIONS, DELETE', 'access-control-allow-headers': 'content-type, authorization, mcp-protocol-version, mcp-session-id', 'access-control-expose-headers': 'mcp-session-id' };
const reply = (obj, status = 200) => new Response(obj == null ? null : JSON.stringify(obj), { status, headers: { ...CORS, 'content-type': 'application/json', 'cache-control': 'no-store' } });
const rpcErr = (id, code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

export async function handle(request, env, ctx, url, deps) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const m = url.pathname.match(/^\/mcp(?:\/([^/]+))?\/?$/); if (!m) return reply({ error: 'not found' }, 404);
  const token = m[1] || (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const who = await tokenRow(env, token);
  if (!who) return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { ...CORS, 'content-type': 'application/json', 'www-authenticate': 'Bearer realm="horizonte"' } });
  if (request.method === 'GET') return reply({ error: 'This server does not stream; POST JSON-RPC to this URL.' }, 405);
  if (request.method === 'DELETE') return new Response(null, { status: 204, headers: CORS });
  if (request.method !== 'POST') return reply({ error: 'method' }, 405);
  const body = await request.json().catch(() => null);
  if (!body) return reply(rpcErr(null, -32700, 'Parse error'), 400);
  const msgs = Array.isArray(body) ? body : [body]; const out = [];
  for (const msg of msgs) { const r = await handleMsg(msg, env, ctx, deps); if (r) out.push(r); }
  if (!out.length) return new Response(null, { status: 202, headers: CORS });
  return reply(Array.isArray(body) ? out : out[0]);
}

async function handleMsg(msg, env, ctx, deps) {
  if (!msg || msg.jsonrpc !== '2.0') return rpcErr(msg?.id, -32600, 'Invalid request');
  const { id, method, params = {} } = msg;
  if (id == null) return null; // notifications (initialized, cancelled …) need no answer
  try {
    switch (method) {
      case 'initialize': return { jsonrpc: '2.0', id, result: { protocolVersion: PROTOCOL, capabilities: { tools: { listChanged: false } }, serverInfo: SERVER,
        instructions: 'Horizonte is Eric\'s personal planner. Days hold meetings (fixed) and tasks (timed or untimed); tasks can also sit on a week, month, quarter or year horizon, or in the inbox. A "target" is one of the few must-dos of a day. Start with get_day or list_tasks before changing anything; when asked to plan, propose first, then use update_task. Times are 24h HH:MM in the planner\'s time zone.' } };
      case 'ping': return { jsonrpc: '2.0', id, result: {} };
      case 'tools/list': return { jsonrpc: '2.0', id, result: { tools: TOOLS } };
      case 'tools/call': {
        const tool = TOOLS.find(t => t.name === params.name); if (!tool) return rpcErr(id, -32602, `Unknown tool ${params.name}`);
        const all = await loadAll(env); const c = ctxFor(all, all.pref.tz || 'America/Mexico_City');
        const commit = async (ops, touched) => { await deps.applyOps(env, ops); if (deps.afterWrite) await deps.afterWrite(touched); };
        try { const result = await run(params.name, params.arguments || {}, env, c, commit);
          return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(result, null, 1) }], structuredContent: result } }; }
        catch (e) { return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: e.message }], isError: true } }; }
      }
      default: return rpcErr(id, -32601, `Method not found: ${method}`);
    }
  } catch (e) { return rpcErr(id, -32603, e.message); }
}
