// Horizonte — local-first planner. Everything reads and writes the device's own copy (IndexedDB);
// changes queue in an outbox and sync to the Worker when signed in and online.

// ── helpers ───────────────────────────────────────────────────
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rid = (p) => p + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const store = { get(k, d) { try { const v = localStorage.getItem('hz.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('hz.' + k, JSON.stringify(v)); } catch {} } };

const I = {
  // Horizonte mark: the sun crossed by the horizon, one reflection bar beneath. Same geometry as the app icon.
  logo: (s = 22) => `<svg aria-hidden="true" width="${s}" height="${s}" viewBox="0 0 32 32"><defs><linearGradient id="hzsun" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFC25C"/><stop offset="1" stop-color="#F07A2A"/></linearGradient></defs><circle cx="16" cy="14.5" r="8.4" fill="url(#hzsun)"/><rect x="1" y="14.5" width="30" height="2.9" rx="1.45" fill="currentColor"/><rect x="7" y="20.8" width="18" height="2.5" rx="1.25" fill="currentColor" opacity=".55"/></svg>`,
  left: '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 6l-6 6 6 6"/></svg>',
  right: '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 6l6 6-6 6"/></svg>',
  plus: (s = 22, w = 2) => `<svg aria-hidden="true" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}"><path d="M12 5v14M5 12h14"/></svg>`,
  minus: '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14"/></svg>',
  search: `<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4-4"/></svg>`,
  play: `<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M7 5v14l12-7z"/></svg>`,
  stopsq: `<svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>`,
  chart: `<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>`,
  filter: `<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M7 12h10M10 17h4"/></svg>`,
  pin: (s = 12) => `<svg aria-hidden="true" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4h6l-1 6 3 3v2H7v-2l3-3z"/><path d="M12 15v6"/></svg>`,
  star: (s = 14) => `<svg class="star" role="img" aria-label="Target" width="${s}" height="${s}" viewBox="0 0 24 24" fill="var(--accent)"><path d="M12 2l3 6.5 7 .9-5.1 4.9 1.3 7L12 17.8 5.8 21.3l1.3-7L2 9.4l7-.9z"/></svg>`,
  people: (s = 12) => `<svg aria-hidden="true" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.2"/><path d="M2.8 19c.5-3.3 3-5 6.2-5s5.7 1.7 6.2 5"/><circle cx="17" cy="9" r="2.6"/><path d="M16.2 14.2c2.8.2 4.6 1.8 5 4.8"/></svg>`,
  lock: (s = 12) => `<svg aria-hidden="true" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>`,
  today: (w) => `<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}"><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>`,
  plan: (w) => `<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/></svg>`,
  boards: (w) => `<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}"><rect x="4" y="4" width="6" height="16" rx="1.5"/><rect x="14" y="4" width="6" height="10" rx="1.5"/></svg>`,
  inbox: (w) => `<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}"><path d="M4 13l3-8h10l3 8v6H4z"/><path d="M4 13h5l1 2h4l1-2h5"/></svg>`,
  clock: '<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
  month: '<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/><path d="M8 14h2M12 14h2M16 14h2M8 17h2M12 17h2"/></svg>',
  side: '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/></svg>',
  chev: '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 6l6 6-6 6"/></svg>',
  grid: '<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/></svg>',
  close: '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  more: '<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>',
  down: '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>',
  check: '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
};

// ── dates and periods ─────────────────────────────────────────
const pad = (n) => String(n).padStart(2, '0');
const dkey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseD = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d, 12); };
const addDays = (k, n) => { const d = parseD(k); d.setDate(d.getDate() + n); return dkey(d); };
const todayK = () => dkey(new Date());
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DOWL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function isoWeek(k) {
  const d = parseD(k); const day = (d.getDay() + 6) % 7; d.setDate(d.getDate() - day + 3);
  const y = d.getFullYear(); const jan4 = new Date(y, 0, 4, 12);
  const w = 1 + Math.round(((d - jan4) / 864e5 - 3 + ((jan4.getDay() + 6) % 7)) / 7);
  return `${y}-W${pad(w)}`;
}
function weekStart(wk) { // Monday of ISO week
  const [y, w] = wk.split('-W').map(Number); const jan4 = new Date(y, 0, 4, 12);
  const mon = new Date(jan4); mon.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7) + (w - 1) * 7); return dkey(mon);
}
const kindOf = (k) => !k ? null : /^\d{4}-\d\d-\d\d$/.test(k) ? 'day' : /W/.test(k) ? 'week' : /Q/.test(k) ? 'quarter' : /^\d{4}-\d\d$/.test(k) ? 'month' : 'year';
function periodOf(kind, dk) {
  const d = parseD(dk);
  if (kind === 'day') return dk;
  if (kind === 'week') return isoWeek(dk);
  if (kind === 'month') return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  if (kind === 'quarter') return `${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`;
  return String(d.getFullYear());
}
function periodRange(k) { // [first day, last day]
  const kind = kindOf(k);
  if (kind === 'day') return [k, k];
  if (kind === 'week') { const s = weekStart(k); return [s, addDays(s, 6)]; }
  if (kind === 'month') { const [y, m] = k.split('-').map(Number); return [`${y}-${pad(m)}-01`, dkey(new Date(y, m, 0, 12))]; }
  if (kind === 'quarter') { const [y, q] = k.split('-Q').map(Number); return [`${y}-${pad(q * 3 - 2)}-01`, dkey(new Date(y, q * 3, 0, 12))]; }
  return [`${k}-01-01`, `${k}-12-31`];
}
function shiftPeriod(k, n) {
  const kind = kindOf(k), [s] = periodRange(k), d = parseD(s);
  if (kind === 'day') return addDays(k, n);
  if (kind === 'week') return isoWeek(addDays(s, 7 * n));
  if (kind === 'month') { d.setMonth(d.getMonth() + n); return periodOf('month', dkey(d)); }
  if (kind === 'quarter') { d.setMonth(d.getMonth() + 3 * n); return periodOf('quarter', dkey(d)); }
  return String(Number(k) + n);
}
const isPast = (k) => k && periodRange(k)[1] < todayK();
function dayShort(k) { const d = parseD(k); return `${DOW[d.getDay()]} ${d.getDate()}`; }
function relDay(k) { const t = todayK(); return k === t ? 'Today' : k === addDays(t, 1) ? 'Tomorrow' : k === addDays(t, -1) ? 'Yesterday' : ''; }
function periodLabel(k, long) {
  const kind = kindOf(k);
  if (kind === 'day') { const r = relDay(k); return r && !long ? r : dayShort(k); }
  if (kind === 'week') { const [s, e] = periodRange(k), a = parseD(s), b = parseD(e);
    const cur = isoWeek(todayK()); const name = k === cur ? 'This week' : k === shiftPeriod(cur, 1) ? 'Next week' : `Week ${Number(k.split('-W')[1])}`;
    return long ? `${name} · ${MON[a.getMonth()]} ${a.getDate()}–${a.getMonth() === b.getMonth() ? '' : MON[b.getMonth()] + ' '}${b.getDate()}` : name; }
  if (kind === 'month') { const [y, m] = k.split('-').map(Number); const cur = periodOf('month', todayK());
    return !long && k === cur ? 'This month' : `${MONL[m - 1]}${y !== new Date().getFullYear() ? ' ' + y : ''}`; }
  if (kind === 'quarter') { const [y, q] = k.split('-Q'); return `Q${q} ${y}`; }
  return k;
}
function fmtDur(min) { min = Math.round(min || 0); const h = Math.floor(min / 60), m = min % 60; return h && m ? `${h}h ${m}m` : h || !m ? `${h}h` : `${m}m`; }
const toMin = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + (m || 0); };
const fromMin = (n) => `${pad(Math.floor(n / 60) % 24)}:${pad(n % 60)}`;
const clock = (t) => { const n = toMin(t), h = Math.floor(n / 60) % 24; return `${h % 12 || 12}:${pad(n % 60)}`; };
// "9", "9am", "9:30", "930", "2 pm", "14:00" → "HH:MM"; null if it is not a time
function parseTime(str) {
  const m = String(str).trim().toLowerCase().match(/^(\d{1,2})(?::?(\d{2}))?\s*(a|p|am|pm)?$/); if (!m) return null;
  let h = +m[1], mi = +(m[2] || 0); if (mi > 59) return null;
  if (m[3]) { if (h < 1 || h > 12) return null; h = h % 12 + (m[3][0] === 'p' ? 12 : 0); } else if (h > 23) return null;
  return `${pad(h)}:${pad(mi)}`;
}
function setStart(id, at) { const t = S.tasks.get(id); if (!t) return; put('task', id, { at, when: kindOf(t.when) === 'day' ? t.when : todayK() }); render(); taskSheet(id); }
const clockAP = (t) => { const n = toMin(t), h = Math.floor(n / 60) % 24; return `${h % 12 || 12}:${pad(n % 60)} ${h < 12 ? 'AM' : 'PM'}`; };

// ── data ──────────────────────────────────────────────────────
const S = {
  tasks: new Map(), boards: new Map(),
  prefs: { dayStart: '09:00', dayEnd: '18:00', cap: 3 },
  outbox: [], cursor: 0, me: null, setup: true, net: 'idle', lastSync: 0, undo: [],
  ui: Object.assign({ zoom: 'days', anchor: null, hday: null, src: 'inbox', sort: 'manual', mtab: 'hours', mzoom: 'days', manchor: null, board: null, open: {} }, store.get('ui', {})),
};
// Phone tabs used to be today/plan/boards/inbox; map a stored one onto the new bar. The hours view always opens on today.
{ const m = { today: 'hours', plan: S.ui.mzoom || 'days', boards: 'hours', board: 'hours' }; if (m[S.ui.mtab]) S.ui.mtab = m[S.ui.mtab]; S.ui.mday = todayK(); S.ui.board = null; }
const device = store.get('device', null) || (() => { const d = Math.random().toString(36).slice(2, 8); store.set('device', d); return d; })();
let lastMs = 0, ctr = 0;
function tick() { const n = Date.now(); if (n > lastMs) { lastMs = n; ctr = 0; } else ctr++; return `${lastMs.toString(36).padStart(9, '0')}.${ctr.toString(36).padStart(3, '0')}.${device}`; }

// IndexedDB: 'rec' holds records (key "kind:id"), 'meta' holds the outbox and the sync cursor.
let idb;
function openDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('horizonte', 1);
    r.onupgradeneeded = () => { r.result.createObjectStore('rec'); r.result.createObjectStore('meta'); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
const tx = (name, mode, fn) => new Promise((res, rej) => { const t = idb.transaction(name, mode); const out = fn(t.objectStore(name)); t.oncomplete = () => res(out instanceof IDBRequest ? out.result : out); t.onerror = () => rej(t.error); });
async function loadAll() {
  idb = await openDB();
  const all = await new Promise((res) => { const out = []; const t = idb.transaction('rec'); const c = t.objectStore('rec').openCursor();
    c.onsuccess = () => { const cur = c.result; if (cur) { out.push(cur.value); cur.continue(); } else res(out); }; });
  for (const r of all) setLocal(r.k, r.id, r.d);
  S.outbox = (await tx('meta', 'readonly', s => s.get('outbox'))) || [];
  S.cursor = (await tx('meta', 'readonly', s => s.get('cursor'))) || 0;
}
function mapOf(k) { return k === 'task' ? S.tasks : k === 'board' ? S.boards : null; }
function setLocal(k, id, d) { if (k === 'pref') { if (id === 'main') Object.assign(S.prefs, d); return; } const m = mapOf(k); if (m) m.set(id, { ...d, id }); }
function getLocal(k, id) { return k === 'pref' ? S.prefs : mapOf(k)?.get(id); }
const persistRec = (k, id) => { const d = { ...getLocal(k, id) }; delete d.id; return tx('rec', 'readwrite', s => s.put({ k, id, d }, `${k}:${id}`)); };
const persistMeta = () => tx('meta', 'readwrite', s => { s.put(S.outbox, 'outbox'); s.put(S.cursor, 'cursor'); });

// The one write path. fields: { name: value }. Records undo unless quiet.
function put(k, id, fields, opts = {}) {
  const cur = getLocal(k, id);
  if (!opts.quiet) {
    const before = {}; for (const f of Object.keys(fields)) before[f] = cur ? (cur[f] ?? null) : null;
    (opts.group || (S.undo.push({ items: [] }), S.undo[S.undo.length - 1])).items.push({ k, id, before });
    if (S.undo.length > 50) S.undo.shift();
  }
  setLocal(k, id, { ...(cur || {}), ...fields });
  S.outbox.push({ k, id, f: fields, t: tick() });
  persistRec(k, id); persistMeta(); scheduleSync();
}
function batch(fn) { const g = { items: [] }; fn(g); if (g.items.length) { S.undo.push(g); if (S.undo.length > 50) S.undo.shift(); } }
function undo() {
  const g = S.undo.pop(); if (!g) return;
  for (const it of g.items.reverse()) put(it.k, it.id, it.before, { quiet: true });
  render(); toast('Undone');
}

// ── sync ──────────────────────────────────────────────────────
let syncTimer = null, syncing = false;
function scheduleSync(ms = 800) { clearTimeout(syncTimer); syncTimer = setTimeout(syncNow, ms); }
async function syncNow() {
  if (syncing || !S.me || !navigator.onLine) { paintSync(); return; }
  syncing = true; S.net = 'syncing'; paintSync();
  try {
    for (let i = 0; i < 20; i++) {
      const ops = S.outbox.slice(0, 500);
      const r = await fetch('/api/sync', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ops, cursor: S.cursor }) });
      if (r.status === 401) { S.me = null; break; }
      if (!r.ok) throw new Error('sync ' + r.status);
      const res = await r.json();
      S.outbox.splice(0, ops.length);
      for (const c of res.changes) {
        let d = { ...c.d };
        for (const op of S.outbox) if (op.k === c.k && op.id === c.id) d = { ...d, ...op.f }; // local changes not yet sent stay on top
        setLocal(c.k, c.id, d); persistRec(c.k, c.id);
      }
      S.cursor = res.cursor; await persistMeta();
      if (res.changes.length) render();
      if (!res.more && !S.outbox.length) break;
    }
    S.net = 'idle'; S.lastSync = Date.now();
  } catch { S.net = 'error'; }
  syncing = false; paintSync();
}
async function whoami() {
  try { const r = await fetch('/api/me', { cache: 'no-store' }); const j = await r.json(); S.me = j.email || null; S.setup = j.setup !== false; if (j.clientId) S.clientId = j.clientId; S.calReady = !!j.calendarReady; }
  catch { /* offline: keep working locally */ }
  paintSync(); if (S.me) syncNow();
}
function syncState() {
  if (!S.me) return { cls: 'off', text: S.setup ? 'Not signed in' : 'Local only' };
  if (!navigator.onLine) return { cls: 'off', text: `Offline${S.outbox.length ? ` · ${S.outbox.length} waiting` : ''}` };
  if (S.net === 'syncing') return { cls: 'syncing', text: 'Syncing' };
  if (S.net === 'error') return { cls: 'warn', text: `Not synced${S.outbox.length ? ` · ${S.outbox.length} waiting` : ''}` };
  return { cls: '', text: 'Synced' };
}
function paintSync() { const s = syncState(); for (const el of $$('[data-sync]')) { el.className = 'dot ' + s.cls; el.innerHTML = `<i></i>${esc(s.text)}`; } }

// ── queries ───────────────────────────────────────────────────
const live = () => [...S.tasks.values()].filter(t => !t.del && t.status !== 'dropped');
const isOpen = (t) => t.status !== 'done';
const order = (a, b) => (a.o ?? 0) - (b.o ?? 0) || String(a.created).localeCompare(String(b.created));
const priRank = { target: 0, normal: 1, someday: 2 };
// ── tags ──────────────────────────────────────────────────────
// Tags live in prefs as [{ id, name, color }]; a task carries `tags: [id]`. Colors are names from TAGCOLORS.
const TAGCOLORS = ['red', 'orange', 'amber', 'yellow', 'green', 'teal', 'cyan', 'blue', 'indigo', 'purple', 'pink', 'grey'];
const tagsList = () => Array.isArray(S.prefs.tags) ? S.prefs.tags.filter(t => t && t.id) : [];
const tagById = (id) => tagsList().find(t => t.id === id);
const slugTag = (name) => String(name).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32);
function ensureTag(name, color) { // returns the tag id, creating the tag when it is new
  const id = slugTag(name); if (!id) return null;
  if (!tagById(id)) { const list = tagsList(); put('pref', 'main', { tags: [...list, { id, name: String(name).trim(), color: color || TAGCOLORS[list.length % TAGCOLORS.length] }] }, { quiet: true }); }
  return id;
}
const tagChip = (t, extra = '') => `<span class="tag c-${esc(t.color || 'grey')}" ${extra}>${esc(t.name)}</span>`;
const taskTags = (t) => (t.tags || []).map(tagById).filter(Boolean);
const tagSortKey = (t) => taskTags(t).map(x => x.name.toLowerCase()).sort()[0] || '\uffff';
function sortList(list, mode = 'manual') {
  const by = { manual: order, priority: (a, b) => priRank[a.pri || 'normal'] - priRank[b.pri || 'normal'] || order(a, b),
    age: (a, b) => String(a.created).localeCompare(String(b.created)), newest: (a, b) => String(b.created).localeCompare(String(a.created)), duration: (a, b) => (a.dur || 30) - (b.dur || 30) || order(a, b),
    tag: (a, b) => tagSortKey(a).localeCompare(tagSortKey(b)) || order(a, b) }[mode] || order;
  return [...list].sort(by);
}
const boardsSorted = () => [...S.boards.values()].filter(b => !b.del && !b.archived).sort((a, b) => (a.name === 'Backlog') - (b.name === 'Backlog') || (a.o ?? 0) - (b.o ?? 0) || a.name.localeCompare(b.name));
const inboxTasks = () => live().filter(t => isOpen(t) && !t.board && !t.when);
const overdueTasks = () => live().filter(t => isOpen(t) && t.when && isPast(t.when));
const placedOn = (k) => live().filter(t => t.when === k);
const boardTasks = (id) => live().filter(t => t.board === id);
function dayLoad(k) { return placedOn(k).reduce((s, t) => s + (t.dur || 30), 0); }
const workMin = () => Math.max(60, toMin(S.prefs.dayEnd) - toMin(S.prefs.dayStart));
function dayParts(k) {
  const all = placedOn(k), open = all.filter(isOpen), done = all.filter(t => !isOpen(t));
  const isM = (t) => t.kind === 'meeting';
  const meetings = all.filter(isM).sort((a, b) => (a.at ? toMin(a.at) : 9999) - (b.at ? toMin(b.at) : 9999));
  const tasks = all.filter(t => !isM(t));
  const targets = sortList(tasks.filter(t => t.pri === 'target'));
  const timed = sortList(open.filter(t => !isM(t) && t.at && t.pri !== 'target'), 'manual').sort((a, b) => toMin(a.at) - toMin(b.at));
  const rest = sortList(open.filter(t => !isM(t) && !t.at && t.pri !== 'target'), 'priority');
  return { all, open, done, meetings, targets, timed, rest, doneNonTarget: done.filter(t => t.pri !== 'target' && !isM(t)) };
}
function whenText(t) {
  if (!t.when) return '';
  if (kindOf(t.when) === 'day') { const r = relDay(t.when); return (r && r !== 'Yesterday' ? r : dayShort(t.when)) + (t.at ? ' ' + clock(t.at) : ''); }
  return periodLabel(t.when);
}

// ── mutations ─────────────────────────────────────────────────
function newTask(fields) {
  const id = rid('t_');
  put('task', id, { title: '', notes: '', board: '', section: '', pri: 'normal', status: 'open', dur: 30, when: null, at: '', rolls: 0, src: 'typed', created: new Date().toISOString(), o: Date.now(), ...fields });
  return id;
}
// Quick-add shortcuts inside a line: "@meeting" (or @mtg) makes it a meeting; "5pm", "5:30pm", "17:00" set a start time.
function parseQuick(line, fields) {
  const out = {}; let title = ' ' + line + ' ';
  if (/\s@(meeting|mtg|reunion|reunión)\b/i.test(title)) { out.kind = 'meeting'; out.dur = 60; title = title.replace(/\s@(meeting|mtg|reunion|reunión)\b/ig, ' '); }
  let m = title.match(/\s(\d{1,2})(?::(\d{2}))?\s?(am|pm)(?=\s)/i) || title.match(/\s([01]?\d|2[0-3]):([0-5]\d)(?=\s)/);
  if (m) { let h = Number(m[1]) % (m[3] ? 12 : 24); if (m[3] && m[3].toLowerCase() === 'pm') h += 12; out.at = `${pad(h)}:${m[2] || '00'}`; title = title.replace(m[0], ' ');
    if (!(fields.when && kindOf(fields.when) === 'day')) out.when = todayK(); }
  // "#tag" adds a tag (created if new); "!high" / "!medium" / "!low" add the matching priority tag
  const tags = [];
  title = title.replace(/\s[#!]([\p{L}\p{N}][\p{L}\p{N}_-]*)(?=\s)/gu, (m0, name) => { const id = ensureTag(name.replace(/[-_]+/g, ' ')); if (id && !tags.includes(id)) tags.push(id); return ' '; });
  if (tags.length) out.tags = [...(fields.tags || []), ...tags.filter(t => !(fields.tags || []).includes(t))];
  out.title = title.replace(/\s+/g, ' ').trim() || line.trim();
  const em = out.title.match(/^(\p{Extended_Pictographic}\uFE0F?)\s+(.+)$/u); // a leading emoji becomes the task's icon
  if (em) { out.emoji = em[1]; out.title = em[2]; }
  return out;
}
function addLines(text, fields) {
  const lines = String(text).split(/\n+/).map(s => s.replace(/^\s*[-*•]\s*/, '').trim()).filter(Boolean);
  // New tasks go to the top of their list (smaller `o` sorts first); the first line typed stays first.
  const minO = Math.min(0, ...live().map(t => t.o ?? 0)), ids = [];
  batch(g => lines.forEach((line, i) => { const id = rid('t_'); ids.push(id);
    put('task', id, { title: line, notes: '', board: '', section: '', pri: 'normal', status: 'open', dur: 30, when: null, at: '', rolls: 0, src: 'typed', created: new Date().toISOString(), o: minO - lines.length + i, ...fields, ...parseQuick(line, fields) }, { group: g }); }));
  flash(ids);
  return lines.length;
}
// Briefly mark freshly added cards so the eye finds them.
const flashed = new Set(); let flashTimer;
function flash(ids) { ids.forEach(i => flashed.add(i)); clearTimeout(flashTimer); flashTimer = setTimeout(() => { flashed.clear(); $$('.card.new').forEach(c => c.classList.remove('new')); }, 1800); }
function toggleDone(id) {
  const t = S.tasks.get(id); if (!t) return;
  const done = t.status !== 'done';
  let moved = 0;
  batch(g => {
    const f = { status: done ? 'done' : 'open', doneAt: done ? new Date().toISOString() : null };
    if (done && t.timer) { const mins = Math.max(1, Math.round(elapsedSec(t) / 60)); f.timer = null; f.spent = (t.spent || 0) + mins; }
    if (done && (f.spent ?? t.spent)) f.dur = Math.max(5, round5(f.spent ?? t.spent)); // what it took, not what was planned
    // Reflow: a timeboxed task on today, finished before its end, shrinks to the time it took and the rest slide up.
    if (done && canReflow(t)) { const start = toMin(t.at), now = nowMin();
      if (start <= now) { const took = Math.max(5, round5(now - start)), planned = t.dur || 30;
        if (took !== planned && !(f.spent ?? t.spent)) f.dur = took;
        if (took < planned) { put('task', id, f, { group: g }); moved = reflowDay(t.when, start + 1, 'up', now, g, now - (start + planned)); return; } } }
    put('task', id, f, { group: g });
  });
  S.ui.flip = true; render();
  if (done) { if (t.at && t.when && t.kind !== 'meeting') doneToast(id); else toast('Done', true); }
}
// ── timer ─────────────────────────────────────────────────────
// t.timer = ISO start while running; t.spent = minutes logged so far. One timer at a time. When a task with logged time
// is checked off, its duration becomes the logged time, so In review reports what it took rather than what was planned.
const runningTask = () => live().find(t => t.timer && isOpen(t));
const elapsedSec = (t) => t.timer ? Math.max(0, Math.round((Date.now() - new Date(t.timer)) / 1000)) : 0;
const fmtClock = (sec) => { const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60; return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`; };
function startTimer(id) {
  batch(g => { for (const o of live()) if (o.timer && o.id !== id) stopTimer(o.id, g); put('task', id, { timer: new Date().toISOString() }, { group: g }); });
  render(); const t = S.tasks.get(id); toast(`Timer started · ${t.title}`);
}
function stopTimer(id, g) {
  const t = S.tasks.get(id); if (!t?.timer) return 0;
  const mins = Math.max(1, Math.round(elapsedSec(t) / 60)); put('task', id, { timer: null, spent: (t.spent || 0) + mins }, g ? { group: g } : {}); return mins;
}
function addTime(id, mins) { const t = S.tasks.get(id); if (!t) return; put('task', id, { spent: Math.max(0, (t.spent || 0) + mins) }); }
// Live counters tick without a full re-render.
setInterval(() => { for (const el of $$('[data-timer]')) { const t = S.tasks.get(el.dataset.timer); if (t?.timer) el.textContent = fmtClock(elapsedSec(t)); } }, 1000);
function runPill(mobile) { const t = runningTask(); if (!t) return ''; return `<button class="runpill" data-act="open" data-tid="${t.id}" title="Timer running"><i></i><span class="rt">${esc(t.title)}</span><b data-timer="${t.id}">${fmtClock(elapsedSec(t))}</b><span class="stop" data-act="tstop" data-tid="${t.id}" role="button" aria-label="Stop timer">${I.stopsq}</span></button>`; }
// ── reflow (today, timeboxed tasks only) ──────────────────────
// Meetings and pinned tasks never move. Finish early → following tasks slide up to now; run over → the block slides down under the now line (never grows).
const nowMin = () => { const n = new Date(); return n.getHours() * 60 + n.getMinutes(); };
const round5 = (m) => Math.round(m / 5) * 5;
const reflowOn = (k) => !(S.prefs.reflowOff || {})[k];
const isFixed = (t) => t.kind === 'meeting' || !!t.pin;
const canReflow = (t) => t.when === todayK() && !!t.at && !isFixed(t) && reflowOn(t.when);
// Earliest start at or after `start` where a block of `dur` misses every fixed block; null if it would end after `limit`.
function firstFit(start, dur, blocks, limit) {
  let s = start;
  for (let i = 0; i < 60; i++) { const hit = blocks.find(([a, b]) => s < b && s + dur > a); if (!hit) break; s = hit[1]; }
  return s + dur <= limit ? s : null;
}
// mode 'up': tasks starting at/after `from` come up by `shift` (never before `cursor` = now), keeping their spacing.
// mode 'down': tasks starting at/after `from` are pushed only as far as needed to clear `cursor` (the stretched task's new end).
function reflowDay(k, from, mode, cursor, g, shift = 0, skip = null) {
  const limit = toMin(S.prefs.dayEnd), now = nowMin();
  const movers = placedOn(k).filter(t => isOpen(t) && t.at && !isFixed(t) && t.id !== skip && toMin(t.at) >= from).sort((a, b) => toMin(a.at) - toMin(b.at));
  const blocks = placedOn(k).filter(t => t.at && isFixed(t) && (isOpen(t) || t.kind === 'meeting')).map(t => [toMin(t.at), toMin(t.at) + (t.dur || 30)]);
  let moved = 0; // 'up': shift < 0 is how far every mover may come up (now minus the finished task's planned end)
  for (const t of movers) {
    const old = toMin(t.at), dur = t.dur || 30;
    const want = mode === 'up' ? Math.max(old + shift, cursor, now) : Math.max(old, cursor);
    let s = firstFit(round5(want), dur, blocks, limit);
    if (mode === 'up' && s != null && s >= old) s = old; // sliding up never sends a task later
    if (s == null) { if (!t.nofit) put('task', t.id, { nofit: true }, { group: g }); blocks.push([old, old + dur]); cursor = old + dur; continue; } // stays put, flagged
    if (s !== old || t.nofit) { put('task', t.id, { at: fromMin(s), nofit: false }, { group: g }); if (s !== old) moved++; }
    blocks.push([s, s + dur]); cursor = s + dur;
  }
  return moved;
}
// Every minute: the task that is running over stretches to now (up to 2 h over) and pushes what follows.
function reflowTick() {
  const k = todayK(); if (!reflowOn(k)) return;
  const now = nowMin();
  const running = placedOn(k).filter(t => isOpen(t) && t.at && !isFixed(t) && toMin(t.at) <= now && toMin(t.at) + (t.dur || 30) < now).sort((a, b) => toMin(b.at) - toMin(a.at))[0];
  if (!running) return;
  // The block keeps its length and slides down to sit under the now line; what follows is pushed. Nothing ever grows on its own.
  const start = toMin(running.at), dur = running.dur || 30, over = now - (start + dur);
  if (over < 5 || over > 180) return;
  if (running.timer) { // the timer proves it is being worked on: the block grows to now so it records what it is taking
    const nd = round5(now - start) + 5; if (nd <= dur) return;
    batch(g => { put('task', running.id, { dur: nd }, { group: g }); reflowDay(k, start + 1, 'down', start + nd, g, 0, running.id); });
  } else { // not being timed: keep its length and slide it under the now line
    const at = round5(now) - dur + 5; if (at <= start) return;
    batch(g => { reflowDay(k, start + 1, 'down', at + dur, g, 0, running.id); put('task', running.id, { at: fromMin(at) }, { group: g }); });
  }
  S.ui.flip = true; render();
}
function place(id, when, at, label) {
  const t = S.tasks.get(id); if (!t) return;
  const f = { when: when || null, at: at || '', nofit: false };
  put('task', id, f); render();
  toast(when ? `Moved to ${label || (at ? periodLabel(when) + ' ' + clock(at) : periodLabel(when, false))}` : 'Unscheduled', true);
}
function ensureDefaults() {
  if (!S.boards.has('backlog')) put('board', 'backlog', { name: 'Backlog', color: '', sections: [], o: 9999, archived: false }, { quiet: true });
}

// ── rendering: shared ─────────────────────────────────────────
const CAP = 100;
function capped(key, list, render) { // long lists show the first 100, then a button for the rest
  const lim = S.ui.open['cap' + key] ? Infinity : CAP;
  let h = list.slice(0, lim).map(render).join('');
  if (list.length > lim) h += `<button class="link" style="align-self:flex-start;font-size:13px;padding:8px 2px" data-act="toggle" data-key="cap${key}">Show ${list.length - lim} more</button>`;
  return h;
}
const isDesk = () => matchMedia('(min-width: 900px)').matches;
// Google Calendar's event colors (colorId 1–11); '' = default blue. Stored on the task as `color`, synced as colorId.
const GCOLORS = [['', '#1D4ED8', 'Default'], ['1', '#7986CB', 'Lavender'], ['2', '#33B679', 'Sage'], ['3', '#8E24AA', 'Grape'], ['4', '#E67C73', 'Flamingo'], ['5', '#F6BF26', 'Banana'], ['6', '#F4511E', 'Tangerine'], ['7', '#039BE5', 'Peacock'], ['8', '#616161', 'Graphite'], ['9', '#3F51B5', 'Blueberry'], ['10', '#0B8043', 'Basil'], ['11', '#D50000', 'Tomato']];
const EMOJIS = ['🔥', '❗', '⭐', '💰', '📞', '✉️', '🍷', '🏠', '🚗', '🛒', '💡', '🎯'];
const colorHex = (c) => (GCOLORS.find(x => x[0] === String(c || '')) || GCOLORS[0])[1];
const colorStyle = (t) => t.color ? `--mt:${colorHex(t.color)};${t.color === '5' ? 'color:#16181D;' : ''}` : '';
function meetingHTML(t, opts = {}) {
  const done = t.status === 'done';
  const range = t.at ? `${clock(t.at)} – ${clock(fromMin(toMin(t.at) + (t.dur || 60)))}` : 'No time set';
  const meta = opts.meta ?? (opts.sched ? (whenText(t) || 'Not scheduled') : range);
  return `<div class="card meeting ${done ? 'done' : ''}" data-tid="${t.id}" style="${colorStyle(t)}${opts.style || ''}" title="Meeting">
<span class="lk">${I.people(opts.mobile ? 17 : 15)}</span>
<div class="body" data-act="open"><span class="t">${esc(t.title) || 'Untitled meeting'}</span></div><span class="meta">${esc(meta)}</span></div>`;
}
function cardHTML(t, opts = {}) {
  if (t.kind === 'meeting') return meetingHTML(t, opts);
  const pri = t.pri || 'normal', done = t.status === 'done';
  const run = !done && !!t.timer;
  const hl = !done && t.color; // highlighted task: coloured left bar + faint wash (meetings are solid; targets show a star; independent signals)
  const cls = ['card', pri, done ? 'done' : '', opts.sched ? 'sched' : '', hl ? 'hl' : '', flashed.has(t.id) ? 'new' : '', run ? 'running' : '', opts.late && !done ? 'late' : ''].join(' ');
  const stuck = !done && (t.rolls || 0) >= 3 ? `<span class="sub">Pushed ${t.rolls} times · stuck</span>` : !done && t.nofit && t.at ? `<span class="sub">Won't fit today</span>` : '';
  const meta = run ? '' : opts.meta ?? (done ? (t.spent ? fmtDur(t.dur || 30) : '') : pri === 'someday' && !t.when ? 'Someday' : (t.dur && t.dur !== 30 ? fmtDur(t.dur) : '') + (t.spent ? `${t.dur && t.dur !== 30 ? ' · ' : ''}${fmtDur(t.spent)} logged` : ''));
  const live_ = run ? `<span class="meta live"><i></i><span data-timer="${t.id}">${fmtClock(elapsedSec(t))}</span></span>` : '';
  return `<div class="${cls}" data-tid="${t.id}" style="${hl ? `--mt:${colorHex(t.color)};` : ''}${opts.style || ''}">
<label class="ck"><input type="checkbox" ${done ? 'checked' : ''} aria-label="Done: ${esc(t.title)}" data-act="done"><span class="box" aria-hidden="true"><svg viewBox="0 0 12 12"><path d="M2.5 6.5l2.3 2.3L9.6 3.8"/></svg></span></label>
<div class="body" data-act="open"><span class="t">${esc(t.title) || '<span class="muted">Untitled</span>'}</span>${stuck}${!opts.style && taskTags(t).length ? `<span class="tags">${taskTags(t).map(x => tagChip(x)).join('')}${taskTags(t).length > 2 ? `<span class="more">+${taskTags(t).length - 2}</span>` : ''}</span>` : ''}</div>
${t.pin && t.at && !done ? `<span class="pinicon" title="Pinned: does not move">${I.pin(opts.mobile ? 14 : 12)}</span>` : ''}${t.emoji && !done ? `<span class="emo">${esc(t.emoji)}</span>` : ''}${pri === 'target' && !done ? I.star(opts.mobile ? 15 : 13) : ''}${meta ? `<span class="meta">${esc(meta)}</span>` : ''}${live_}${opts.late && !done ? `<button class="rollbtn" data-act="rollto" aria-label="Move to today">Today ${I.right}</button>` : ''}</div>`;
}
function loadText(k) { return `${fmtDur(dayLoad(k))} of ${fmtDur(workMin())}`; }
function meterHTML(k) {
  const pct = Math.round(dayLoad(k) / workMin() * 100);
  return `<div class="meter ${pct >= 125 ? 'red' : pct >= 100 ? 'amber' : ''}" role="img" aria-label="Day is ${pct} percent full"><i style="width:${Math.min(100, pct)}%"></i></div>`;
}
function saveUI() { store.set('ui', S.ui); }

let lastLayout = null;
// Theme: '' follows the system, 'light'/'dark' force one (stored per device, applied before first paint by index.html too).
function applyTheme() { const t = S.ui.theme || ''; if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
  const dark = t === 'dark' || (!t && matchMedia('(prefers-color-scheme: dark)').matches); for (const m of document.querySelectorAll('meta[name=theme-color]')) m.content = dark ? '#111318' : '#FFFFFF'; }
function render() {
  const desk = isDesk();
  if (!S.ui.anchor) S.ui.anchor = addDays(todayK(), -1);
  if (!S.ui.hday) S.ui.hday = todayK();
  if (!S.ui.manchor) S.ui.manchor = todayK();
  const app = $('#app');
  const keep = document.activeElement && document.activeElement.id && app.contains(document.activeElement) ? { id: document.activeElement.id, v: document.activeElement.value } : null;
  const tl = $('.tl'), tlScroll = tl ? [tl.scrollLeft, tl.scrollTop] : null, mm = $('.mm'), mScroll = mm ? mm.scrollTop : null, pnl = $('.panel'), pScroll = pnl ? pnl.scrollTop : 0;
  let before = null; if (S.ui.flip) { before = new Map(); for (const c of app.querySelectorAll('.d .grid .card[data-tid]')) before.set(c.dataset.tid, c.getBoundingClientRect()); }
  const overlay = [...app.querySelectorAll(':scope .scrim, :scope .sheet')]; // a phone sheet lives inside the app root; carry it across the re-render
  app.innerHTML = desk ? renderDesk() : renderMobile();
  if (overlay.length) ($('.m') || app).append(...overlay);
  if (before) { S.ui.flip = false;
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) for (const c of app.querySelectorAll('.d .grid .card[data-tid]')) { const b = before.get(c.dataset.tid); if (!b) continue; const n = c.getBoundingClientRect(), dy = b.top - n.top, dh = b.height - n.height;
      if (Math.abs(dy) < 1 && Math.abs(dh) < 1) continue; c.style.transition = 'none'; c.style.transform = `translateY(${dy}px)`; c.style.height = (n.height + dh) + 'px';
      requestAnimationFrame(() => { c.style.transition = 'transform 220ms ease-out, height 220ms ease-out'; c.style.transform = ''; c.style.height = (n.height) + 'px'; setTimeout(() => { c.style.transition = ''; }, 260); }); } }
  if (desk && lastLayout === 'desk' && tlScroll) { const n = $('.tl'); n.scrollLeft = tlScroll[0]; n.scrollTop = tlScroll[1]; }
  if (desk && pnl) { const n = $('.panel'); if (n) n.scrollTop = pScroll; }
  if (!desk && lastLayout === 'mob' && mScroll != null && $('.mm') && !S.ui.mjump) $('.mm').scrollTop = mScroll;
  if (!desk && S.ui.mtab === 'hours' && (S.ui.mjump || lastLayout !== 'mob')) scrollPhoneHours();
  if (!desk) { S.ui.mjump = false; $('.mbar [aria-current]')?.scrollIntoView({ inline: 'center', block: 'nearest' }); }
  if (desk && S.ui.zoom === 'hours' && !tlScroll) scrollHoursToNow();
  lastLayout = desk ? 'desk' : 'mob';
  if (keep) { const el = document.getElementById(keep.id); if (el) { el.focus(); if ('value' in el && keep.v != null) el.value = keep.v; } }
  paintSync(); saveUI();
}

// ── rendering: desktop ────────────────────────────────────────
const ZOOMS = [['horizons', 'Horizons'], ['hours', 'Hours'], ['days', 'Days'], ['weeks', 'Weeks'], ['months', 'Months'], ['quarters', 'Quarters'], ['years', 'Years']];
function deskTitle() {
  const z = S.ui.zoom;
  if (z === 'hours' || z === 'horizons') { const d = parseD(z === 'hours' ? S.ui.hday : (S.ui.hzday || todayK())); return `${DOWL[d.getDay()]}, ${MONL[d.getMonth()]} ${d.getDate()}`; }
  if (z === 'days') { const d = parseD(addDays(S.ui.anchor, 1)); return `${MONL[d.getMonth()]} ${d.getFullYear()}`; }
  return String(parseD(periodRange(S.ui.pk || todayK())[0]).getFullYear());
}
function renderDesk() {
  return `<div class="d">
<header class="top">
<div class="brandrow"><button class="btn icon" data-act="togglepanel" aria-label="${S.ui.panelHidden ? 'Show lists' : 'Hide lists'}" title="${S.ui.panelHidden ? 'Show lists' : 'Hide lists'} (\\)" aria-pressed="${!S.ui.panelHidden}">${I.side}</button><button class="brand" data-act="settings" title="Settings">${I.logo(22)}<span class="wm">Horizonte</span></button></div>
<nav class="seg" aria-label="Zoom level">${ZOOMS.map(([z, l], i) => `<button aria-pressed="${S.ui.zoom === z}" data-zoom="${z}" title="${l} (${i + 1})">${l}</button>`).join('')}</nav>
<div class="steps"><button class="btn icon" aria-label="Earlier" data-act="prev">${I.left}</button><button class="btn" data-act="today">Today</button><button class="btn icon" aria-label="Later" data-act="next">${I.right}</button><div class="title">${esc(deskTitle())}</div></div>
<div class="right">${runPill()}<button class="btn icon" data-act="summary" aria-label="Day in review" title="Day in review (r)">${I.chart}</button><button data-sync class="dot" data-act="settings"></button></div>
</header>
<div class="main" style="--pw:${S.ui.pw || 320}px">${S.ui.panelHidden ? '' : renderPanel() + '<div class="resizer" data-resize="panel" role="separator" aria-orientation="vertical" aria-label="Resize lists panel" title="Drag to resize · double-click to reset"></div>'}<main class="tl" aria-label="Timeline">${renderTimeline()}</main></div></div>`;
}
function sources() {
  const out = [['inbox', `Inbox · ${inboxTasks().length}`]];
  const od = overdueTasks().length; if (od) out.push(['overdue', `Overdue · ${od}`]);
  const wk = placedOn(isoWeek(todayK())).filter(isOpen).length; out.push(['week', `This week · ${wk}`]);
  const mo = placedOn(periodOf('month', todayK())).filter(isOpen).length; if (mo) out.push(['month', `This month · ${mo}`]);
  for (const b of boardsSorted()) out.push(['b:' + b.id, b.name === 'Backlog' ? `Backlog · ${boardTasks(b.id).filter(isOpen).length}` : b.name]);
  return out;
}
function renderPanel() {
  const srcs = sources();
  if (!srcs.some(x => x[0] === S.ui.src)) S.ui.src = 'inbox';
  const od = overdueTasks().filter(t => t.pri === 'target').length;
  const banner = signinBanner() + odBanner(od);
  if (S.ui.panelView !== 'list') {
    const ico = { inbox: I.inbox(1.8), overdue: I.clock, week: I.plan(1.8), month: I.month };
    const row = (k, name, n, drop) => `<button class="navrow" data-src="${k}" ${drop ? `data-drop="${drop}"` : ''} aria-current="${S.ui.src === k}"><span class="ni">${ico[k] || `<i class="bdot"></i>`}</span><span class="lbl">${esc(name)}</span><span class="n">${n}</span></button>`;
    const wk = placedOn(isoWeek(todayK())).filter(isOpen).length, mo = placedOn(periodOf('month', todayK())).filter(isOpen).length, ov = overdueTasks().length;
    const boards = boardsSorted().map(b => row('b:' + b.id, b.name, boardTasks(b.id).filter(isOpen).length || '', 'board:' + b.id)).join('');
    if (S.ui.q) return `<aside class="panel" aria-label="Search">${banner}${searchBox('q')}${searchResults(false)}</aside>`;
    return `<aside class="panel" aria-label="Task lists">${banner}${searchBox('q')}
<div class="navgroup">${row('inbox', 'Inbox', inboxTasks().length || '', 'board:')}${ov ? row('overdue', 'Overdue', ov) : ''}${row('week', 'This week', wk || '')}${mo ? row('month', 'This month', mo) : ''}</div>
<div class="navhead"><span class="eyebrow">Boards</span><button class="link" data-act="newboard">+ New board</button></div>
<div class="navgroup">${boards}</div>
<div class="hint"><span>Drop a task on a board to move it there</span></div></aside>`;
  }
  const board = S.ui.src.startsWith('b:') ? S.boards.get(S.ui.src.slice(2)) : null;
  const name = board ? board.name : (srcs.find(x => x[0] === S.ui.src)?.[1] || 'Inbox').replace(/ · \d+$/, '');
  const addLabel = board ? `Add to ${board.name}` : S.ui.src === 'week' ? 'Add to this week' : S.ui.src === 'month' ? 'Add to this month' : 'Add to Inbox';
  const n = board ? boardTasks(board.id).filter(isOpen).length : S.ui.src === 'overdue' ? overdueTasks().length : S.ui.src === 'week' ? placedOn(isoWeek(todayK())).filter(isOpen).length : S.ui.src === 'month' ? placedOn(periodOf('month', todayK())).filter(isOpen).length : inboxTasks().length;
  if (S.ui.q) return `<aside class="panel" aria-label="Search">${banner}${searchBox('q')}${searchResults(false)}</aside>`;
  return `<aside class="panel" aria-label="${esc(name)}" data-drop="list">${banner}${searchBox('q')}
<div class="listhead"><button class="link back" data-act="panelnav">${I.left} All lists</button>${board ? `<button class="link" data-act="editboard" data-bid="${board.id}">Edit board</button>` : ''}</div>
<div class="listtitle"><b>${esc(name)}</b><span class="muted">${n}</span></div>
<div class="qa"><label for="qa">${esc(addLabel)}</label><input id="qa" type="text" placeholder="Type a task and press Enter" autocomplete="off" enterkeyhint="done"></div>
<div class="hint"><span>Drag onto any day, hour or horizon</span></div>
${renderPanelList(board)}
</aside>`;
}
// ── filter & sort ─────────────────────────────────────────────
// One control for both: a filter button next to the search box opens a sheet with the sort order and the tag filter.
// While a filter is active a slim bar under the search box says so and clears it in one tap.
const SORTS = [['manual', 'My order'], ['newest', 'Newest first'], ['age', 'Oldest first'], ['priority', 'Priority'], ['tag', 'Tag'], ['duration', 'Shortest first']];
const sortLabel = () => (SORTS.find(x => x[0] === S.ui.sort) || SORTS[0])[1];
const filterActive = () => !!S.ui.tagFilter || (S.ui.sort && S.ui.sort !== 'manual');
function filterBar() {
  const f = S.ui.tagFilter; if (f && !tagById(f)) S.ui.tagFilter = null;
  if (!filterActive()) return '';
  const parts = []; if (S.ui.tagFilter) parts.push(tagChip(tagById(S.ui.tagFilter))); if (S.ui.sort !== 'manual') parts.push(`<span class="muted">${esc(sortLabel())}</span>`);
  return `<div class="filterbar">${parts.join('')}<button class="link" data-act="filterclear">Clear</button></div>`;
}
function filterSheet() {
  const f = S.ui.tagFilter, tags = tagsList();
  openSheet(`<div class="grab"></div><div class="sheethead"><div class="sheettitle">Filter &amp; sort</div><button class="link" data-act="filterclear">Clear</button></div>
<div class="grp"><div class="eyebrow">Sort by</div><div class="list-pick">${SORTS.map(([k, l]) => `<button data-act="sortset" data-s="${k}" aria-pressed="${S.ui.sort === k}">${l}${S.ui.sort === k ? I.check : ''}</button>`).join('')}</div></div>
${tags.length ? `<div class="grp"><div class="eyebrow">Show only</div><div class="tagpick">${tags.map(x => tagChip(x, `role="button" tabindex="0" data-act="tagfilter" data-t="${x.id}" aria-pressed="${f === x.id}"`)).join('')}</div></div>` : ''}
<button class="bigbtn" data-act="close">Done</button>`, { filter: true });
}
const byTag = (list) => S.ui.tagFilter ? list.filter(t => (t.tags || []).includes(S.ui.tagFilter)) : list;
// ── search ────────────────────────────────────────────────────
// Matches title, notes, board name and tag names; every word must match. Open tasks first, then by date, then done ones.
const fold = (x) => String(x || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
function searchTasks(q) {
  const words = fold(q).split(/\s+/).filter(Boolean); if (!words.length) return [];
  const hay = (t) => fold([t.title, t.notes, S.boards.get(t.board)?.name, ...taskTags(t).map(x => x.name)].join(' '));
  const rank = (t) => (isOpen(t) ? 0 : 1);
  return [...S.tasks.values()].filter(t => !t.del && t.status !== 'dropped').filter(t => { const h = hay(t); return words.every(w => h.includes(w)); })
    .sort((a, b) => rank(a) - rank(b) || String(a.when || '9').localeCompare(String(b.when || '9')) || (a.at || '').localeCompare(b.at || '') || order(a, b)).slice(0, 60);
}
function searchBox(id) {
  return `<div class="searchrow"><div class="search"><span class="sicon">${I.search}</span><input id="${id}" type="search" placeholder="Search tasks" autocomplete="off" value="${esc(S.ui.q || '')}" aria-label="Search tasks">${S.ui.q ? `<button class="sclear" data-act="qclear" aria-label="Clear search">✕</button>` : ''}</div><button class="fbtn" data-act="filter" aria-label="Filter and sort" aria-pressed="${filterActive()}">${I.filter}</button></div>${S.ui.q ? '' : filterBar()}`;
}
function searchResults(mobile) {
  const list = searchTasks(S.ui.q);
  const where = (t) => { const b = S.boards.get(t.board); const parts = [b ? b.name : (t.when ? '' : 'Inbox'), t.when ? dayShort(t.when) + (t.at ? ' ' + clock(t.at) : '') : ''].filter(Boolean); return parts.join(' · '); };
  if (!list.length) return `<div class="empty">No tasks match “${esc(S.ui.q)}”.</div>`;
  return `<div class="muted" style="font-size:12px">${list.length}${list.length === 60 ? '+' : ''} result${list.length === 1 ? '' : 's'}</div><div class="stack">${list.map(t => (mobile ? mcard : cardHTML)(t, { meta: where(t) })).join('')}</div>`;
}
function renderPanelList(board) {
  const sort = S.ui.sort, src = S.ui.src;
  const stack = (list, sched, key = src) => `<div class="stack">${capped('p' + key, list, t => cardHTML(t, sched ? { sched: !!t.when && isOpen(t), meta: isOpen(t) && t.when ? whenText(t) : undefined } : {}))}</div>`;
  if (board) {
    const all = boardTasks(board.id), open = all.filter(isOpen), done = all.filter(t => !isOpen(t));
    const secs = [''].concat(board.sections || []);
    let html = '';
    for (const s of secs) {
      const list = byTag(sortList(open.filter(t => (t.section || '') === s || (s === '' && t.section && !(board.sections || []).includes(t.section))), sort));
      if (s === '' && !list.length) continue;
      if (s) html += `<div class="eyebrow">${esc(s)} · ${list.length}</div>`;
      html += stack(list, true, board.id + s);
    }
    if (!open.length) html += `<div class="empty">Nothing on this board. Type above to add.</div>`;
    if (done.length) html += doneToggle('b' + board.id, done);
    return html;
  }
  let list = src === 'overdue' ? overdueTasks() : src === 'week' ? placedOn(isoWeek(todayK())).filter(isOpen) : src === 'month' ? placedOn(periodOf('month', todayK())).filter(isOpen) : inboxTasks();
  list = byTag(sortList(list, sort));
  if (!list.length) return `<div class="empty">${S.ui.tagFilter ? 'Nothing here with this tag.' : src === 'inbox' ? 'Inbox is empty. Type above to add a task.' : src === 'overdue' ? 'Nothing overdue.' : `Nothing placed on this ${src} yet. Type above or drag a task here.`}</div>`;
  return stack(list, src === 'overdue');
}
function doneToggle(key, done) {
  const open = S.ui.open[key];
  return `<button class="link" style="align-self:flex-start;text-decoration:none;color:var(--ink-2)" data-act="toggle" data-key="${key}">Done · ${done.length} ${open ? '▴' : '▾'}</button>${open ? `<div class="stack">${sortList(done).map(t => cardHTML(t)).join('')}</div>` : ''}`;
}
function renderTimeline() {
  const z = S.ui.zoom;
  if (z === 'hours') return renderHours();
  if (z === 'horizons') { // Timestripe's signature: one day beside its week, month, quarter and year, so a task can be dragged to the horizon it belongs on
    const d = S.ui.hzday || todayK(); S.ui.hzday = d;
    return `<div class="cols horizons">${dayCol(d)}${['week', 'month', 'quarter', 'year'].map(kind => periodCol(periodOf(kind, d))).join('')}</div>`; }
  if (z === 'days') { const cols = []; for (let i = 0; i < 14; i++) cols.push(dayCol(addDays(S.ui.anchor, i))); return `<div class="cols">${cols.join('')}</div>`; }
  const kind = { weeks: 'week', months: 'month', quarters: 'quarter', years: 'year' }[z];
  const n = { week: 8, month: 6, quarter: 4, year: 3 }[kind];
  let k = S.ui.pk && kindOf(S.ui.pk) === kind ? S.ui.pk : periodOf(kind, todayK()); S.ui.pk = k;
  const cols = []; for (let i = 0; i < n; i++) cols.push(periodCol(shiftPeriod(k, i)));
  return `<div class="cols">${cols.join('')}</div>`;
}
function dayCol(k) {
  const t = todayK(), past = k < t, today = k === t, P = dayParts(k);
  const label = dayShort(k), rel = relDay(k);
  let head;
  if (past) {
    const tg = P.targets.length ? `<div class="small">${P.targets.filter(x => !isOpen(x)).length} of ${P.targets.length} targets done</div>` : '';
    const open = P.open.length;
    head = `<div class="head"><div class="date"><span class="num">${Number(k.slice(8))}</span><span class="dow">${DOW[parseD(k).getDay()]}${rel ? ' · ' + rel : ''}</span></div>${open ? `<span class="pill warn">${open} open</span>` : ''}</div>${tg}`;
    const body = [...P.open].sort(order).map(x => cardHTML(x)).join('');
    const doneList = P.done;
    return `<section class="col past dropcol" data-drop="day:${k}" aria-label="${label}">${head}${body}${doneList.length ? doneToggle('d' + k, doneList) : ''}<div class="dropzone">Drop to schedule on ${label}</div></section>`;
  }
  const dnum = Number(k.slice(8)), dow = DOW[parseD(k).getDay()];
  head = `<div class="head"><div class="date"><span class="num ${today ? 'today' : ''}">${dnum}</span><span class="dow">${dow}${today ? ' · Today' : rel ? ' · ' + rel : ''}</span></div><span class="small">${loadText(k)}</span></div>${meterHTML(k)}`;
  let body = '';
  for (const x of P.meetings) body += cardHTML(x);
  for (const x of P.timed) body += cardHTML(x, { meta: clock(x.at) });
  if (P.targets.length) body += `<div class="eyebrow">Targets · ${P.targets.filter(x => !isOpen(x)).length} of ${Math.max(P.targets.length, S.prefs.cap)}</div>` + P.targets.map(x => cardHTML(x, { meta: x.at && isOpen(x) ? clock(x.at) : undefined })).join('');
  if (P.rest.length) body += (P.targets.length ? `<div class="eyebrow">If there's time</div>` : '') + P.rest.map(x => cardHTML(x)).join('');
  if (!P.all.length) body += `<div class="empty">Nothing planned</div>`;
  if (P.doneNonTarget.length) body += doneToggle('d' + k, P.doneNonTarget);
  body += S.ui.adding === k ? `<input class="inline-add" id="ia-${k}" data-addto="${k}" placeholder="Task name, Enter" autocomplete="off">` : `<button class="btn addbtn" data-act="addto" data-k="${k}">Add</button>`;
  return `<section class="col dropcol ${today ? 'today' : ''}" data-drop="day:${k}" aria-label="${label}${today ? ', today' : ''}">${head}${body}<div class="dropzone">Drop to schedule on ${label}</div></section>`;
}
function periodCol(k) {
  const list = placedOn(k), open = sortList(list.filter(isOpen), 'priority'), done = list.filter(t => !isOpen(t));
  const cur = periodOf(kindOf(k), todayK()) === k, [s, e] = periodRange(k), a = parseD(s), b = parseD(e);
  const range = kindOf(k) === 'year' ? '' : `${MON[a.getMonth()]} ${a.getDate()} – ${MON[b.getMonth()]} ${b.getDate()}`;
  const mins = open.reduce((x, t) => x + (t.dur || 30), 0);
  let body = open.map(t => cardHTML(t)).join('') || `<div class="empty">Nothing placed here</div>`;
  if (done.length) body += doneToggle('p' + k, done);
  body += S.ui.adding === k ? `<input class="inline-add" id="ia-${k}" data-addto="${k}" placeholder="Task name, Enter" autocomplete="off">` : `<button class="btn addbtn" data-act="addto" data-k="${k}">Add</button>`;
  return `<section class="col dropcol ${cur ? 'today' : ''} ${k < periodOf(kindOf(k), todayK()) ? 'past' : ''}" data-drop="period:${k}" aria-label="${esc(periodLabel(k, true))}">
<div class="head"><div><b>${esc(kindOf(k) === 'week' ? periodLabel(k) : periodLabel(k, true))}</b>${cur ? ' <span class="pill">Now</span>' : ''}</div><span class="small">${open.length ? fmtDur(mins) : ''}</span></div>
${range ? `<div class="small">${range}</div>` : ''}${body}<div class="dropzone">Drop to place in ${esc(periodLabel(k, true))}</div></section>`;
}
const HPX = 56; const H0 = () => Math.max(0, Math.min(toMin(S.prefs.dayStart) / 60 - 2, 7)); const H1 = () => Math.min(24, Math.max(toMin(S.prefs.dayEnd) / 60 + 4, 20));
function renderHours() {
  const days = [S.ui.hday, addDays(S.ui.hday, 1)], h0 = H0(), h1 = H1();
  const heads = days.map(k => { const P = dayParts(k), untimed = [...P.meetings.filter(t => !t.at), ...P.targets.filter(t => !t.at), ...P.rest].filter(isOpen);
    return `<div class="hcol dropcol" data-drop="day:${k}"><div class="head" style="display:flex;justify-content:space-between;align-items:flex-end"><div class="date"><span class="num ${k === todayK() ? 'today' : ''}">${Number(k.slice(8))}</span><span class="dow">${DOW[parseD(k).getDay()]}${k === todayK() ? ' · Today' : ''}</span></div><span class="small" style="font-size:12px;color:var(--ink-2);display:flex;gap:10px;align-items:center">${k === todayK() ? `<button class="link reflowsw" data-act="reflowtoggle" data-k="${k}" aria-pressed="${reflowOn(k)}" title="Finish a task early and the rest slide up; run over and they slide down. Meetings and pinned tasks stay put.">Reflow ${reflowOn(k) ? 'on' : 'off'}</button>` : ''}${loadText(k)}</span></div>
<div class="small" style="font-size:12px;color:var(--ink-2)">No set time</div>${untimed.map(t => cardHTML(t)).join('') || ''}${S.ui.adding === k ? `<input class="inline-add" id="ia-${k}" data-addto="${k}" placeholder="Task name, Enter" autocomplete="off">` : `<button class="btn addbtn" data-act="addto" data-k="${k}">Add</button>`}<div class="dropzone">Drop on ${dayShort(k)}, no time</div></div>`; }).join('');
  let gutter = ''; for (let h = h0; h < h1; h++) gutter += `<div style="height:${HPX}px">${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}</div>`;
  const grids = days.map(k => gridHTML(k, HPX, h0, h1)).join('');
  return `<div class="hours"><div class="hrow sticky"><div class="gutter"></div>${heads}</div><div class="hrow"><div class="gutter" aria-hidden="true">${gutter}</div>${grids}</div>
<div class="legend">Outlined cards are tasks, solid blocks are meetings. Click or drag on empty space to add one. Drag to move, drag the bottom edge to change length. Today reflows: finish early and the next tasks slide up; meetings and pinned tasks stay.</div></div>`;
}
// One day's hour grid: timed blocks in lanes, the now line, and (desktop) the block being drawn. Shared by the desktop Hours zoom and the phone.
function gridHTML(k, hpx, h0, h1, opts = {}) {
    const timed = placedOn(k).filter(t => t.at && !(opts.skipOpen && isOpen(t) && t.kind !== 'meeting'));
    const lanes = layoutLanes(timed), edge = opts.edge ?? 6;
    const cards = timed.map(t => { const top = (toMin(t.at) / 60 - h0) * hpx + 1, ht = Math.max(24, (t.dur || 30) / 60 * hpx - 2), L = lanes.get(t.id);
      const style = `top:${top}px;height:${ht}px;left:calc(${edge}px + (100% - ${2 * edge}px) * ${L.i / L.n});right:auto;width:calc((100% - ${2 * edge}px) / ${L.n} - ${L.n > 1 ? 4 : 0}px)`;
      return cardHTML(t, { style, mobile: opts.mobile, meta: `${clock(t.at)} – ${clock(fromMin(toMin(t.at) + (t.dur || 30)))}` }).replace('class="card', `class="card${ht < 34 ? ' short' : ''}${ht >= 80 ? ' tall' : ''}`).replace('data-tid=', `title="${esc(t.title)}" data-tid=`).replace(/<\/div>$/, '<div class="resize" data-resize="1"></div></div>'); }).join('');
    let now = ''; if (k === todayK()) { const n = new Date(), m = n.getHours() * 60 + n.getMinutes(); if (m >= h0 * 60 && m <= h1 * 60) now = `<div class="nowline" style="top:${(m / 60 - h0) * hpx}px"><span>Now ${clock(fromMin(m))}</span></div>`; }
    // a block being created (click or drag on empty space), with its quick-create popover
    let add = ''; const D = opts.mobile ? null : S.ui.draft;
    if (D && D.k === k) { const top = (toMin(D.at) / 60 - h0) * hpx + 1, ht = Math.max(24, D.dur / 60 * hpx - 2), gridH = (h1 - h0) * hpx;
      const below = top + ht + 230 < gridH; const end = clock(fromMin(toMin(D.at) + D.dur));
      add = `<div class="card draft ${D.kind === 'meeting' ? 'meeting' : ''}" style="${colorStyle(D)}top:${top}px;height:${ht}px"><div class="body"><span class="t">${esc(D.title) || '<span class="muted">(No title)</span>'}</span></div><span class="meta">${clock(D.at)} – ${end}</span><div class="resize" data-draftresize="1"></div></div>
<div class="qc" style="${below ? `top:${top + ht + 8}px` : `bottom:${gridH - top + 8}px`}">
<input id="qc-title" placeholder="Add title" autocomplete="off" value="${esc(D.title)}">
<div class="seg kindseg"><button data-act="qckind" data-v="task" aria-pressed="${D.kind !== 'meeting'}">Task</button><button data-act="qckind" data-v="meeting" aria-pressed="${D.kind === 'meeting'}">${I.people(15)}Meeting</button></div>
${D.kind === 'meeting' ? `<div class="swatches">${GCOLORS.map(([c, hex, name]) => `<button class="sw" data-act="qccolor" data-c="${c}" style="background:${hex}" aria-label="${name}" aria-pressed="${String(D.color || '') === c}" title="${name}"></button>`).join('')}</div>` : ''}
<div class="qc-time"><span>${dayShort(k)} · ${clock(D.at)} – ${end}</span><div class="stepper"><button aria-label="Shorter" data-act="qcdur" data-d="-15">${I.minus}</button><div>${fmtDur(D.dur)}</div><button aria-label="Longer" data-act="qcdur" data-d="15">${I.plus(16, 2.5)}</button></div></div>
<div class="qc-foot"><button class="link" data-act="qcmore">More options</button><span><button class="btn" data-act="qccancel">Cancel</button><button class="btn primary" data-act="qcsave">Save</button></span></div></div>`; }
    return `<div class="grid" data-drop="slot:${k}" data-hpx="${hpx}" data-h0="${h0}" style="height:${(h1 - h0) * hpx}px">${cards}${now}${add}</div>`;
}
function layoutLanes(list) { // side-by-side lanes for overlapping timed tasks
  const items = list.map(t => ({ id: t.id, s: toMin(t.at), e: toMin(t.at) + (t.dur || 30) })).sort((a, b) => a.s - b.s || b.e - a.e);
  const out = new Map(); let group = [], end = -1;
  const flush = () => { const lanes = []; for (const it of group) { let i = lanes.findIndex(e => e <= it.s); if (i < 0) { i = lanes.length; lanes.push(0); } lanes[i] = it.e; it.i = i; } for (const it of group) out.set(it.id, { i: it.i, n: lanes.length }); group = []; };
  for (const it of items) { if (it.s >= end && group.length) flush(); group.push(it); end = Math.max(end, it.e); }
  if (group.length) flush(); return out;
}
// Phone hours: land on the now line for today, on the start of the working day otherwise.
function scrollPhoneHours() { const mm = $('.mm'), g = $('.m .grid'), nr = $('.m .nowrow'); if (!mm || !(g || nr)) return;
  if (S.ui.mday !== todayK()) { mm.scrollTop = 0; return; } // other days open at the top: the list first, then the hours
  const n = new Date(), y = g ? g.offsetTop - mm.offsetTop + (n.getHours() + n.getMinutes() / 60 - H0()) * MG : nr.offsetTop - mm.offsetTop; // now line, in list coordinates
  if (y > mm.scrollTop + 120 && y < mm.scrollTop + mm.clientHeight - 140) return; // already in view
  mm.scrollTop = Math.max(0, y - mm.clientHeight * 0.4); }
function scrollHoursToNow() { requestAnimationFrame(() => { const tl = $('.tl'); if (!tl) return; const n = new Date(); tl.scrollTop = Math.max(0, (n.getHours() - 1 - H0()) * HPX); }); }

// ── rendering: mobile ─────────────────────────────────────────
// Overdue bar: tap to review, × hides it until tomorrow (Overdue stays in the menu / lists).
function odBanner(n) { return n && S.ui.odHide !== todayK() ? `<div class="banner split"><button data-act="review"><span>${n} overdue from earlier days</span>Review</button><button class="x" data-act="odhide" aria-label="Hide until tomorrow">${I.close}</button></div>` : ''; }
function signinBanner() {
  return !S.me && S.setup && navigator.onLine ? `<button class="banner signin" data-act="settings"><span>Sign in to load your boards and sync with your computer</span>Sign in</button>` : '';
}
const MBAR = [['inbox', 'Inbox'], ['hours', 'Hours'], ['days', 'Days'], ['weeks', 'Weeks'], ['months', 'Months'], ['quarters', 'Quarters'], ['years', 'Years'], ['horizons', 'Horizons']];
const MG = 60; // px per hour on the phone grid
function renderMobile() {
  const tab = S.ui.mtab, n = inboxTasks().length;
  if (['days', 'weeks', 'months', 'quarters', 'years', 'horizons'].includes(tab)) S.ui.mzoom = tab;
  let main = tab === 'inbox' ? mInbox() : tab === 'board' ? mBoards() : tab === 'hours' ? mHours() : mPlan();
  const sb = (runPill(true) || '') + (signinBanner() || (!navigator.onLine ? `<div class="banner off"><span>Offline · changes are saved here and sync when you’re back</span></div>` : ''));
  if (sb) main = main.replace('<main class="mm"', `<div style="padding:10px 16px 0">${sb}</div><main class="mm"`);
  const bar = MBAR.map(([k, l]) => `<button data-tab="${k}" ${tab === k ? 'aria-current="page"' : ''}>${l}${k === 'inbox' && n ? `<span class="n">${n > 99 ? '99+' : n}</span>` : ''}</button>`).join('');
  return `<div class="m">${main}<button class="fab" aria-label="Add a task" data-act="capture">${I.plus(28, 2.4)}</button>
<nav class="mbar" aria-label="Views">${bar}</nav></div>`;
}
const mcard = (t, o = {}) => cardHTML(t, { mobile: true, ...o });
// Top row of every phone screen: menu (boards, review, settings) · title · actions.
const mtop = (title, right = '') => `<div class="mtop"><button class="plain" aria-label="Menu" data-act="menu">${I.grid}</button><div class="ttl">${title}</div><div class="acts">${right}</div></div>`;
function weekStrip(k) {
  const t = todayK(), mon = weekStart(isoWeek(k)); let h = '';
  for (let i = 0; i < 7; i++) { const kk = addDays(mon, i), P = dayParts(kk), late = kk < t && P.open.length;
    h += `<button data-act="mday" data-k="${kk}" aria-pressed="${kk === k}" class="${kk === t ? 'today' : ''}" aria-label="${DOWL[parseD(kk).getDay()]} ${Number(kk.slice(8))}${kk === t ? ', today' : ''}${late ? `, ${P.open.length} not done` : ''}"><span class="dw">${DOW[parseD(kk).getDay()][0]}</span><span class="dn">${Number(kk.slice(8))}</span><i class="${late ? 'late' : P.all.length ? 'has' : ''}"></i></button>`; }
  return `<div class="wstrip" data-swipe="week">${h}</div>`;
}
function mHours() {
  const k = S.ui.mday, t = todayK(), past = k < t, P = dayParts(k), d = parseD(k), od = overdueTasks(), grid = !!S.ui.mgrid;
  const late = past ? P.open.filter(x => x.kind !== 'meeting').sort(order) : []; // meetings that passed are not "not done"
  let body = '';
  if (late.length) body += `<div class="latebar"><span>${late.length} not done</span><button data-act="rollall" data-k="${k}">Move all to today ${I.right}</button></div>`;
  else if (k === t) body += odBanner(od.length);
  body += `<div class="qadd"><span class="box" aria-hidden="true"></span><input class="inline-add" id="ia-${k}" data-addto="${k}" placeholder="Add…" aria-label="Add a task to ${relDay(k) || dayShort(k)}" autocomplete="off" enterkeyhint="done"></div>`;
  if (past) body += late.map(x => mcard(x, { late: true, meta: x.at ? clock(x.at) : undefined })).join('');
  else { const untimed = [...P.meetings.filter(x => !x.at), ...P.targets, ...P.rest].filter(isOpen);
    if (untimed.length && (P.timed.length || grid)) body += `<div class="eyebrow">Anytime</div>`;
    body += untimed.map(x => mcard(x)).join(''); }
  const done = (past ? P.done : P.doneNonTarget).filter(x => !x.at || past); if (done.length) body += mDoneToggle('d' + k, done);
  if (grid) { const h0 = H0(), h1 = H1(); let gutter = ''; for (let h = h0; h < h1; h++) gutter += `<div style="height:${MG}px">${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}</div>`;
    body += `<div class="hgrid"><div class="gutter" aria-hidden="true">${gutter}</div>${gridHTML(k, MG, h0, h1, { mobile: true, edge: 3, skipOpen: past })}</div>`; }
  else body += agendaHTML(k, past);
  const title = `<button class="tdy ${k === t ? 'cur' : ''}" data-act="mtoday" ${k === t ? 'aria-current="date"' : ''}>Today</button><span class="date">${MON[d.getMonth()]} ${d.getDate()}, ${DOW[d.getDay()]}</span>`;
  const right = `<button class="plain" aria-label="${grid ? 'Show as list' : 'Show hour grid'}" aria-pressed="${grid}" data-act="mgrid">${I.clock}</button><button class="plain" aria-label="In review" data-act="summary" data-k="${k}">${I.chart}</button><button class="plain" data-sync aria-label="Sync status" data-act="settings"></button>`;
  return `<header class="mh hours">${mtop(title, right)}${weekStrip(k)}</header>
<main class="mm" data-list="hours" data-swipe="day" data-k="${k}">${body}</main>`;
}
// The day as a time-ordered list: a time rail, the now line in its place, and free gaps named. Past days list what happened, dimmed.
function agendaHTML(k, past) {
  const t = todayK(), today = k === t, nowM = nowMin();
  const items = placedOn(k).filter(x => x.at && !(past && isOpen(x) && x.kind !== 'meeting')).sort((a, b) => toMin(a.at) - toMin(b.at) || order(a, b));
  if (!items.length) return today || k > t ? `<div class="empty">Nothing scheduled${today ? ' yet' : ''}. Hold a task and drop it on an hour, or tap the clock for the grid.</div>` : '';
  let h = `<div class="eyebrow gap">Scheduled</div>`, nowDone = !today, lastEnd = null;
  const row = (x) => { const end = toMin(x.at) + (x.dur || 30), over = today && end <= nowMin() && isOpen(x) && x.kind !== 'meeting';
    const meta = x.kind === 'meeting' ? `to ${clock(fromMin(end))}` : isOpen(x) && today && toMin(x.at) > nowM && toMin(x.at) - nowM <= 120 ? `in ${fmtDur(toMin(x.at) - nowM)}` : !isOpen(x) && x.spent ? fmtDur(x.dur || 30) : '';
    return `<div class="arow"><div class="tm"><b>${clock(x.at)}</b><span>${fmtDur(x.dur || 30)}</span></div>${mcard(x, { meta, style: past || (!isOpen(x)) ? 'opacity:.55' : over ? 'opacity:.8' : '' })}</div>`; };
  for (const x of items) {
    const st = toMin(x.at);
    if (!nowDone && st > nowM) { h += `<div class="nowrow" aria-label="Now ${clock(fromMin(nowM))}"><span>${clock(fromMin(nowM))}</span><i></i></div>`; nowDone = true; }
    if (lastEnd != null && st - lastEnd >= 30 && (k > t || (today && st > nowM))) h += `<div class="gaprow"><span></span><span>${fmtDur(st - lastEnd)} free</span></div>`;
    h += row(x); lastEnd = Math.max(lastEnd ?? 0, st + (x.dur || 30));
  }
  if (!nowDone && nowM <= toMin(S.prefs.dayEnd)) h += `<div class="nowrow" aria-label="Now ${clock(fromMin(nowM))}"><span>${clock(fromMin(nowM))}</span><i></i></div>`;
  return h;
}
function mDoneToggle(key, done) {
  const open = S.ui.open[key];
  return `<button class="showmore" style="text-decoration:none;color:var(--ink-2)" data-act="toggle" data-key="${key}">Done · ${done.length} ${open ? '▴' : '▾'}</button>${open ? sortList(done).map(t => mcard(t)).join('') : ''}`;
}
function mPlan() {
  const z = S.ui.mzoom; let body = '';
  const head = (k, label, extra) => `<div class="dayhead" data-drop="${kindOf(k) === 'day' ? 'day' : 'period'}:${k}"><b>${esc(label)}</b>${extra}<button class="plain" aria-label="Add to ${esc(label)}" data-act="capture" data-k="${k}">${I.plus(22)}</button></div>`;
  const items = (k, list) => { const key = 'm' + k, lim = S.ui.open[key] ? 999 : 3; let s = list.slice(0, lim).map(t => mcard(t, { meta: t.at && isOpen(t) && t.kind !== 'meeting' ? clock(t.at) : undefined })).join('');
    if (list.length > lim) s += `<button class="showmore" data-act="toggle" data-key="${key}">Show ${list.length - lim} more</button>`; return s; };
  if (z === 'horizons') { // the day and every horizon it sits in, stacked
    const d = S.ui.manchor, P = dayParts(d), dl = [...P.meetings.filter(isOpen), ...P.timed, ...P.targets.filter(isOpen), ...P.rest];
    body += head(d, `${relDay(d) || DOWL[parseD(d).getDay()]}, ${MON[parseD(d).getMonth()]} ${parseD(d).getDate()}`, `<span class="small">${P.all.length ? loadText(d) : 'Nothing planned'}</span>`) + items(d, dl);
    for (const kind of ['week', 'month', 'quarter', 'year']) { const k = periodOf(kind, d), list = sortList(placedOn(k).filter(isOpen), 'priority');
      const lbl = kind === 'week' ? 'This week' : kind === 'month' ? MONL[parseD(d).getMonth()] : periodLabel(k, true), range = kind === 'week' ? periodLabel(k, true).split(' · ')[1] || '' : '';
      body += head(k, lbl, `<span class="small">${range ? esc(range) + ' · ' : ''}${list.length ? list.length + ' task' + (list.length > 1 ? 's' : '') : 'Nothing placed'}</span>`) + items(k, list); }
  } else if (z === 'days') {
    for (let i = 0; i < 14; i++) { const k = addDays(S.ui.manchor, i), P = dayParts(k), past = k < todayK(), list = past ? P.open.filter(x => x.kind !== 'meeting').sort(order) : [...P.meetings.filter(isOpen), ...P.timed, ...P.targets.filter(isOpen), ...P.rest];
      const isT = k === todayK(); const load = past ? (list.length ? `${list.length} not done` : P.all.length ? 'Done' : '') : P.all.length ? loadText(k) : 'Nothing planned';
      body += head(k, dayShort(k), `${isT ? '<span class="pill">Today</span>' : ''}<span class="small">${load}</span>`) + (past ? list.map(t => mcard(t, { late: true, meta: t.at ? clock(t.at) : undefined })).join('') : items(k, list)); }
  } else {
    const kind = { weeks: 'week', months: 'month', quarters: 'quarter', years: 'year' }[z];
    let k = periodOf(kind, S.ui.manchor);
    for (let i = 0; i < 8; i++, k = shiftPeriod(k, 1)) { const list = sortList(placedOn(k).filter(isOpen), 'priority');
      const [lbl, range] = kind === 'week' ? periodLabel(k, true).split(' · ') : [periodLabel(k, true), ''];
      const count = list.length ? list.length + ' task' + (list.length > 1 ? 's' : '') : 'Nothing placed';
      body += head(k, lbl, `<span class="small">${range ? esc(range) + ' · ' : ''}${count}</span>`) + items(k, list); }
  }
  const name = MBAR.find(x => x[0] === z)?.[1] || 'Plan';
  const right = `<button class="plain" aria-label="Earlier" data-act="mprev">${I.left.replace(/16/g, '20')}</button><button class="tb" data-act="mtoday">Today</button><button class="plain" aria-label="Later" data-act="mnext">${I.right.replace(/16/g, '20')}</button>`;
  return `<header class="mh">${mtop(`<span class="date">${name}</span>`, right)}</header>
<main class="mm" style="gap:6px;padding-top:4px" data-list="plan">${body}</main>`;
}
function mBoards() {
  const b = S.ui.board ? S.boards.get(S.ui.board) : null;
  if (b && !b.del) {
    const all = boardTasks(b.id), open = all.filter(isOpen), done = all.filter(t => !isOpen(t)), secs = [''].concat(b.sections || []);
    let body = '';
    for (const s of secs) {
      const list = sortList(open.filter(t => (t.section || '') === s || (s === '' && t.section && !(b.sections || []).includes(t.section))), 'manual');
      if (s === '' && !list.length) continue;
      const key = 's' + b.id + s, closed = S.ui.open[key];
      if (s) body += `<button class="sec eyebrow" data-act="toggle" data-key="${key}" aria-expanded="${!closed}">${esc(s)} · ${list.length} ${closed ? '▸' : '▾'}</button>`;
      if (!closed) body += capped('m' + b.id + s, list, t => mcard(t, { sched: !!t.when, meta: t.when ? whenText(t) : undefined }));
    }
    if (!open.length) body += `<div class="empty">Nothing on this board yet. Tap + to add a task.</div>`;
    if (done.length) body += mDoneToggle('b' + b.id, done);
    return `<header class="mh">${mtop(`<span class="date">${esc(b.name)}</span>`, `<button class="plain" aria-label="Edit board" data-act="editboard" data-bid="${b.id}">${I.more}</button>`).replace('data-act="menu"', 'data-act="boardsback" aria-label="Back"').replace(I.grid, I.left.replace(/16/g, '22'))}</header>
<main class="mm" data-list="board">${body}</main>`;
  }
  return `<header class="mh">${mtop('<span class="date">Boards</span>', `<button class="tb" data-act="newboard">New board</button>`)}</header><main class="mm" style="gap:0">${boardRows()}</main>`;
}
const boardRows = () => boardsSorted().map((x, i) => `<button class="rowlink" data-act="openboard" data-bid="${x.id}"><i class="bdot b${i % 4}"></i><span>${esc(x.name)}</span><span class="n">${boardTasks(x.id).filter(isOpen).length}</span>${I.chev}</button>`).join('') || '<div class="empty">No boards yet. A board holds the tasks for one project or area.</div>';
// The grid-icon menu: boards, then the things that are not a view.
function menuSheet() {
  const od = overdueTasks().length;
  openSheet(`<div class="grab"></div><div class="sheettitle" style="display:flex;justify-content:space-between;align-items:center">Boards<button class="link" style="font-size:14px" data-act="newboard">New board</button></div>
<div class="rows">${boardRows()}</div>
<div class="rows" style="margin-top:14px"><button class="rowlink" data-act="summary" data-k="${todayK()}"><span>In review</span><span class="n"></span>${I.chev}</button>${od ? `<button class="rowlink" data-act="review"><span>Overdue</span><span class="n">${od}</span>${I.chev}</button>` : ''}<button class="rowlink" data-act="settings"><span>Settings</span><span class="n" data-sync></span>${I.chev}</button></div>`, { menu: true });
}
function mInbox() {
  const list = byTag(sortList(inboxTasks(), S.ui.sort)), od = overdueTasks();
  let body = '';
  body += odBanner(od.length);
  body += capped('minbox', list, t => mcard(t)) || `<div class="empty">${S.ui.tagFilter ? 'Nothing in Inbox with this tag.' : 'Inbox is empty. Tap + to capture what’s on your mind.'}</div>`;
  if (list.length && !(S.ui.hintSeen ??= store.get('hintSeen', false))) body += `<div class="empty" style="margin-top:12px">Swipe right to finish, left to schedule. Hold to drop it on an hour.</div>`;
  if (S.ui.q) body = searchResults(true);
  return `<header class="mh">${mtop(`<span class="date">${S.ui.q ? 'Search' : `Inbox${list.length ? ' · ' + list.length : ''}`}</span>`)}${searchBox('mq')}</header><main class="mm" data-list="inbox">${body}</main>`;
}

// ── sheets ────────────────────────────────────────────────────
let sheetState = null;
// Sheets and the board detail screen are history entries, so the phone's back button/gesture closes them instead of leaving the app.
let popping = false;
const removeSheetDom = () => { $('.scrim')?.remove(); $('.sheet')?.remove(); $('.timelist')?.remove(); sheetState = null; };
function closeSheet() { removeSheetDom(); if (history.state?.hz === 'sheet') { popping = true; history.back(); } }
function openSheet(html, state) {
  if (sheetState?.id !== state?.id) { S.ui.tagAdding = false; S.ui.tagEdit = null; } // transient picker state belongs to one sheet
  const cur = $('.sheet'), same = cur && sheetState?.id && sheetState.id === state?.id;
  if (same) { // same task: swap the content in place so the sheet does not re-animate or lose its scroll position
    const top = cur.scrollTop; cur.innerHTML = html; cur.scrollTop = top; sheetState = state; $('.toast')?.remove(); return cur;
  }
  const had = !!sheetState; removeSheetDom(); $('.toast')?.remove(); sheetState = state;
  if (!had && history.state?.hz !== 'sheet') history.pushState({ hz: 'sheet' }, '');
  const root = isDesk() ? document.body : ($('.m') || document.body);
  root.insertAdjacentHTML('beforeend', `<div class="scrim" data-act="close"></div><section class="sheet" role="dialog" aria-modal="true">${html}</section>`);
  const sh = $('.sheet'); const f = sh.querySelector('[autofocus]'); if (f) setTimeout(() => f.focus(), 30);
  if (!isDesk()) sheetSwipe(sh);
  return sh;
}
// Drag a phone sheet down to dismiss it (only when its content is scrolled to the top and the drag did not start in a text field).
function sheetSwipe(sh) {
  let y0 = null, dy = 0;
  sh.addEventListener('pointerdown', (e) => { const top = e.clientY - sh.getBoundingClientRect().top; if (e.pointerType === 'mouse' || (sh.scrollTop > 0 && !e.target.closest('.grab')) || top > 72 || e.target.closest('input,textarea,select')) return; y0 = e.clientY; dy = 0; }, { passive: true });
  sh.addEventListener('pointermove', (e) => { if (y0 == null) return; dy = Math.max(0, e.clientY - y0); if (dy > 6) { sh.style.transition = 'none'; sh.style.transform = `translateY(${dy}px)`; } }, { passive: true });
  let swallow = false; // a drag must not also count as a tap on whatever is under the finger
  sh.addEventListener('click', (e) => { if (swallow) { e.stopPropagation(); e.preventDefault(); swallow = false; } }, true);
  const end = () => { if (y0 == null) return; y0 = null; sh.style.transition = 'transform .18s ease-out'; swallow = dy > 10;
    if (dy > 90) { sh.style.transform = 'translateY(100%)'; setTimeout(() => { closeSheet(); render(); }, 150); } else sh.style.transform = ''; setTimeout(() => { swallow = false; }, 300); };
  sh.addEventListener('pointerup', end); sh.addEventListener('pointercancel', end);
}
function taskSheet(id, view = 'main') {
  const t = S.tasks.get(id); if (!t) return;
  const bd = t.board ? S.boards.get(t.board) : null;
  const where = (bd ? bd.name + (t.section ? ' · ' + t.section : '') : 'In Inbox') + ' · ' + (t.when ? whenText(t) : 'not scheduled');
  if (view === 'board') {
    const opts = [['', '', 'Inbox']].concat(boardsSorted().flatMap(b => [[b.id, '', b.name], ...(b.sections || []).map(s => [b.id, s, `${b.name} · ${s}`])]));
    openSheet(`<div class="grab"></div><div class="sheettitle">Move to</div><div class="list-pick">${opts.map(([b, s, l]) => `<button data-act="setboard" data-b="${b}" data-s="${esc(s)}" aria-pressed="${(t.board || '') === b && (t.section || '') === s}"><span>${esc(l)}</span></button>`).join('')}</div>
<button class="bigbtn" data-act="sheetback">Back</button>`, { id, view });
    return;
  }
  const T = todayK(), chips = [['Today', T], ['Tomorrow', addDays(T, 1)], ['This week', isoWeek(T)], ['Next week', shiftPeriod(isoWeek(T), 1)], ['This month', periodOf('month', T)]];
  const pri = t.pri || 'normal';
  openSheet(`<div class="grab"></div>
<div style="display:flex;flex-direction:column;gap:2px"><textarea class="ttl" rows="1" data-field="title" aria-label="Task name">${esc(t.title)}</textarea><div style="font-size:13px;color:var(--ink-2)">${esc(where)}</div></div>
<div class="seg kindseg"><button data-act="kind" data-v="task" aria-pressed="${t.kind !== 'meeting'}">Task</button><button data-act="kind" data-v="meeting" aria-pressed="${t.kind === 'meeting'}">${I.people(15)}Meeting</button></div>
<div class="grp"><div class="eyebrow">When</div><div class="when">${chips.map(([l, k]) => `<button data-act="when" data-k="${k}" aria-pressed="${t.when === k}">${l}</button>`).join('')}
<button aria-pressed="${!!t.when && !chips.some(c => c[1] === t.when)}">Pick date<input class="overlay-input" type="date" data-act="pickdate" value="${kindOf(t.when) === 'day' ? t.when : ''}" aria-label="Pick a date"></button></div></div>
<div class="grp"><div class="eyebrow">${t.kind === 'meeting' ? 'Time' : 'Time, optional'}</div><div class="row">
${isDesk()
  ? `<div class="timefield" style="flex:1"><input class="timein" type="text" inputmode="numeric" autocomplete="off" placeholder="Add a start time" value="${t.at ? clockAP(t.at) : ''}" aria-label="Start time, e.g. 2pm or 14:30" data-act="timein">${t.at ? `<button class="tclear" data-act="timeclear" aria-label="Remove start time">✕</button>` : ''}</div>`
  : `<button class="bigbtn" style="flex:1">${t.at ? `Starts ${clockAP(t.at)}` : 'Add a start time'}<input class="overlay-input" type="time" step="900" data-act="picktime" value="${t.at || ''}" aria-label="Start time"></button>`}
${t.at ? `<button class="bigbtn" style="padding:0 12px" data-act="cleartime" aria-label="Remove time">✕</button>` : ''}
${t.at && t.kind !== 'meeting' ? `<button class="bigbtn pinbtn" style="padding:0 12px;display:flex;align-items:center;gap:6px" data-act="pin" aria-pressed="${!!t.pin}" title="Pinned tasks keep their time when the day reflows">${I.pin(16)}${t.pin ? 'Pinned' : 'Pin'}</button>` : ''}
<div class="stepper"><button aria-label="Shorter" data-act="dur" data-d="-15">${I.minus}</button><div>${t.dur || 30} min</div><button aria-label="Longer" data-act="dur" data-d="15">${I.plus(18, 2.5)}</button></div></div>
${t.kind === 'meeting' || t.status === 'done' ? '' : `<div class="timerrow">${t.timer
    ? `<button class="bigbtn tstop" data-act="tstop" data-tid="${t.id}">${I.stopsq} Stop · <span data-timer="${t.id}">${fmtClock(elapsedSec(t))}</span></button>`
    : `<button class="bigbtn tstart" data-act="tstart" data-tid="${t.id}">${I.play} Start timer</button>`}
  <div class="logged"><span>${t.spent ? `${fmtDur(t.spent)} logged` : 'Nothing logged yet'}</span><span class="chips"><button data-act="tadd" data-m="15">+15</button><button data-act="tadd" data-m="30">+30</button><button data-act="tadd" data-m="60">+1h</button>${t.spent ? `<button data-act="tadd" data-m="-15" aria-label="Remove 15 minutes">−15</button>` : ''}</span></div></div>`}</div>
<div class="grp" ${t.kind === 'meeting' ? 'style="display:none"' : ''}><div class="eyebrow">Priority</div><div class="seg">
<button data-act="pri" data-p="target" aria-pressed="${pri === 'target'}">${I.star(15)}Target</button><button data-act="pri" data-p="normal" aria-pressed="${pri === 'normal'}">Normal</button><button data-act="pri" data-p="someday" aria-pressed="${pri === 'someday'}">Someday</button></div></div>
<div class="grp"><div class="eyebrow">${t.kind === 'meeting' ? 'Color' : 'Highlight'}</div><div class="swatches">${GCOLORS.map(([c, hex, name]) => c === '' && t.kind !== 'meeting' ? `<button class="sw none" data-act="color" data-c="" aria-label="No highlight" aria-pressed="${!t.color}" title="None"></button>` : `<button class="sw" data-act="color" data-c="${c}" style="background:${hex}" aria-label="${name}" aria-pressed="${String(t.color || '') === c}" title="${name}"></button>`).join('')}</div></div>
${t.kind === 'meeting' ? '' : `<div class="grp"><div class="eyebrow">Icon</div><div class="emopick"><button class="none" data-act="emoji" data-e="" aria-pressed="${!t.emoji}">None</button>${EMOJIS.map(e => `<button data-act="emoji" data-e="${e}" aria-pressed="${t.emoji === e}">${e}</button>`).join('')}</div></div>`}
<div class="grp"><div class="eyebrow">Tags</div>${S.ui.tagAdding
    ? `<div class="tagpick">${tagsList().map(x => tagChip(x, `role="button" tabindex="0" data-act="tagtoggle" data-t="${x.id}" aria-pressed="${(t.tags || []).includes(x.id)}"`)).join('')}</div><div class="row"><input id="newtag" class="newtag" style="flex:1" placeholder="New tag" autocomplete="off" enterkeyhint="done"><button class="link" data-act="tagdone">Done</button></div>`
    : `<div class="tagpick">${taskTags(t).map(x => tagChip(x, `role="button" tabindex="0" data-act="tagtoggle" data-t="${x.id}" aria-pressed="true" title="Remove tag"`)).join('')}<button class="tag c-new" data-act="tagnew">+ Tag</button></div>`}</div>
<button class="boardrow" data-act="sheetboard"><span><span style="color:var(--ink-2)">Board</span>&nbsp;&nbsp;<b style="font-weight:600">${esc(bd ? bd.name + (t.section ? ' · ' + t.section : '') : 'Inbox')}</b></span>${I.chev}</button>
${t.notes || S.ui.notesOpen === id ? `<textarea class="notes" data-field="notes" placeholder="Notes">${esc(t.notes || '')}</textarea>` : `<button class="link" style="align-self:flex-start;font-size:14px" data-act="notes">Add notes</button>`}
<div class="foot">${t.when ? `<button class="link" style="font-size:14px" data-act="unschedule">Unschedule</button>` : '<span></span>'}
<span><button class="link" style="font-size:14px" data-act="${t.status === 'done' ? 'reopen' : 'markdone'}">${t.status === 'done' ? 'Mark not done' : 'Mark done'}</button><button class="link" style="font-size:14px;color:var(--now)" data-act="delete">Delete</button></span></div>`, { id, view: 'main' });
  const ta = $('.sheet .ttl'); const fit = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; }; fit(); ta.addEventListener('input', fit);
}
function sheetField(el) { // title and notes save on change
  const id = sheetState?.id; if (!id) return; const f = el.dataset.field; const v = f === 'title' ? el.value.replace(/\n/g, ' ').trim() : el.value;
  const t = S.tasks.get(id); if (t && t[f] !== v) { put('task', id, { [f]: v }); render(); }
}
function captureSheet(dest = {}) {
  const label = dest.board ? S.boards.get(dest.board)?.name : dest.when ? periodLabel(dest.when, true) + (dest.at ? ' · ' + clock(dest.at) : '') : 'Inbox';
  openSheet(`<div class="grab"></div><div style="display:flex;flex-direction:column;gap:2px"><div class="sheettitle">Capture</div><div style="font-size:13px;color:var(--ink-2)">Adding to ${esc(label)} · one task per line · add @meeting 5pm for a meeting</div></div>
<textarea class="dump" id="dump" autofocus placeholder="What's on your mind?" enterkeyhint="enter"></textarea>
<button class="bigbtn dark" data-act="savecapture">Add</button>`, { capture: dest });
}
function reviewSheet() {
  const od = overdueTasks(), targets = od.filter(t => t.pri === 'target'), others = od.filter(t => t.pri !== 'target');
  const tm = addDays(todayK(), 1);
  const item = (t) => `<div class="review-item" data-tid="${t.id}"><div style="font-weight:600">${esc(t.title)}${(t.rolls || 0) >= 3 ? ` <span class="sub" style="font-size:12px;color:var(--warn)">· pushed ${t.rolls} times</span>` : ''}</div>
<div style="font-size:13px;color:var(--ink-2)">Was on ${esc(periodLabel(t.when, true))}</div><div class="row">
<button data-act="rv" data-k="${todayK()}">Today</button><button data-act="rv" data-k="${tm}">Tomorrow</button>
<button>Pick day<input class="overlay-input" type="date" data-act="rvpick" aria-label="Pick a day"></button>${(t.rolls || 0) >= 3 ? `<button data-act="rvdrop">Drop</button>` : `<button data-act="rv" data-k="">To list</button>`}</div></div>`;
  openSheet(`<div class="grab"></div><div class="sheettitle">Review</div>
<div style="font-size:13px;color:var(--ink-2)">Nothing rolls over by itself. Decide each overdue target; the rest go back to their lists.</div>
${targets.map(item).join('') || '<div class="empty">No overdue targets.</div>'}
${others.length ? `<button class="bigbtn" data-act="rvrest">Return ${others.length} other task${others.length > 1 ? 's' : ''} to ${others.length > 1 ? 'their lists' : 'its list'}</button>` : ''}
<button class="bigbtn dark" data-act="close">Done</button>`, { review: true });
}
function pushTask(id, when) { const t = S.tasks.get(id); put('task', id, { when: when || null, at: '', rolls: (t.rolls || 0) + 1 }); }
function boardSheet(id) {
  const b = id ? S.boards.get(id) : null;
  openSheet(`<div class="grab"></div><div class="sheettitle">${b ? 'Edit board' : 'New board'}</div>
<div class="field"><label class="eyebrow" for="bname">Name</label><input id="bname" value="${esc(b?.name || '')}" autofocus autocomplete="off"></div>
<div class="field"><label class="eyebrow" for="bsecs">Sections, one per line</label><textarea class="notes" id="bsecs" placeholder="e.g. Cellar&#10;Sales&#10;Events">${esc((b?.sections || []).join('\n'))}</textarea></div>
<div class="foot">${b && b.id !== 'backlog' ? `<button class="link" style="font-size:14px;color:var(--now)" data-act="delboard" data-bid="${b.id}">Delete board</button>` : '<span></span>'}<button class="bigbtn dark" style="padding:0 20px" data-act="saveboard" data-bid="${b?.id || ''}">Save</button></div>`, { board: id });
}
// ── Day / week in review ───────────────────────────────────────
// Where the time went, from what is on the calendar: meetings (fixed), tasks done, tasks still open — by board and by tag —
// targets hit, pushed/stuck tasks, and one line that suggests the next move. Durations are the recorded ones
// (a finished task's duration is what it took: the ±15 toast or an early finish adjusts it).
function summarize(days, weekKey) {
  const list = live().filter(t => t.when && (days.includes(t.when) || (weekKey && t.when === weekKey)));
  const dur = (t) => t.dur || 30, sum = (l) => l.reduce((a, t) => a + dur(t), 0);
  const meetings = list.filter(t => t.kind === 'meeting'), tasks = list.filter(t => t.kind !== 'meeting');
  const done = tasks.filter(t => !isOpen(t)), open = tasks.filter(isOpen), targets = tasks.filter(t => t.pri === 'target');
  const group = (fn) => { const m = new Map(); for (const t of tasks.concat(meetings)) { const key = fn(t); const g = m.get(key) || { key, done: 0, open: 0, n: 0 }; g[t.kind === 'meeting' || !isOpen(t) ? 'done' : 'open'] += dur(t); g.n++; m.set(key, g); } return [...m.values()].sort((a, b) => (b.done + b.open) - (a.done + a.open)); };
  const byBoard = group(t => t.kind === 'meeting' ? 'Meetings' : t.board ? (S.boards.get(t.board)?.name || 'Board') : 'No board');
  const byTag = group(t => t.kind === 'meeting' ? 'Meetings' : (t.tags || [])[0] ? (tagById(t.tags[0])?.name || 'Tag') : 'Untagged');
  const perDay = days.map(k => { const l = live().filter(t => t.when === k); return { k, meet: sum(l.filter(t => t.kind === 'meeting')), done: sum(l.filter(t => t.kind !== 'meeting' && !isOpen(t))), open: sum(l.filter(t => t.kind !== 'meeting' && isOpen(t))) }; });
  // Checked off during these days but never placed on them (inbox, a board, another horizon): counts as done, not as time spent here.
  const doneDay = (t) => t.doneAt ? dkey(new Date(t.doneAt)) : null;
  const cleared = live().filter(t => !isOpen(t) && t.kind !== 'meeting' && !list.includes(t) && days.includes(doneDay(t)));
  return { meetings, tasks, done, open, targets, cleared, tDone: targets.filter(t => !isOpen(t)).length, meetMin: sum(meetings), doneMin: sum(done), openMin: sum(open),
    pushed: tasks.filter(t => (t.rolls || 0) > 0), stuck: open.filter(t => (t.rolls || 0) >= 3), byBoard, byTag, perDay, work: workMin() * days.length };
}
function insight(S_, mode, k) {
  const late = mode === 'day' && k === todayK() && nowMin() >= toMin(S.prefs.dayEnd) - 60;
  const openT = S_.targets.filter(isOpen);
  if (openT.length && (late || k < todayK())) return { text: `${openT.length} target${openT.length > 1 ? 's' : ''} still open: ${openT.map(t => t.title).join(', ')}.`, act: 'sum-push', label: 'Move to tomorrow' };
  if (S_.stuck.length) return { text: `Pushed three times or more: ${S_.stuck.map(t => t.title).join(', ')}. Schedule them, or let them go.` };
  const top = S_.byBoard.find(b => b.key !== 'Meetings'); const total = S_.meetMin + S_.doneMin + S_.openMin;
  if (total && S_.meetMin / total > 0.6) return { text: `Meetings took ${Math.round(100 * S_.meetMin / total)}% of the ${mode}. ${S_.open.length ? 'The open tasks need a protected block.' : ''}` };
  if (top && total && (top.done + top.open) / total > 0.5 && S_.byBoard.length > 2) return { text: `${top.key} got ${Math.round(100 * (top.done + top.open) / total)}% of the time; everything else shared the rest.` };
  if (S_.tasks.length && S_.done.length === S_.tasks.length) return { text: mode === 'day' ? 'Everything planned got done.' : 'Every planned task this week got done.' };
  if (S_.targets.length && S_.tDone === S_.targets.length) return { text: 'All targets hit.' };
  return null;
}
// Activity: which days had at least one task checked off (by doneAt), current and longest streak, and a 26-week heatmap.
function activity() {
  const counts = new Map();
  for (const t of S.tasks.values()) { if (t.del || t.status !== 'done' || !t.doneAt || t.kind === 'meeting') continue; const k = dkey(new Date(t.doneAt)); counts.set(k, (counts.get(k) || 0) + 1); }
  const today = todayK(); let cur = 0, k = counts.has(today) ? today : addDays(today, -1);
  while (counts.has(k)) { cur++; k = addDays(k, -1); }
  let best = 0, bestEnd = null; const days = [...counts.keys()].sort(); let run = 0, prev = null;
  for (const d of days) { run = prev && addDays(prev, 1) === d ? run + 1 : 1; if (run > best) { best = run; bestEnd = d; } prev = d; }
  const weeks = 26, end = addDays(weekStart(isoWeek(today)), 6), start = addDays(end, -7 * weeks + 1), max = Math.max(1, ...counts.values());
  const cells = []; for (let i = 0; i < 7 * weeks; i++) { const d = addDays(start, i); cells.push({ d, n: counts.get(d) || 0, future: d > today }); }
  const yearDays = [...counts.keys()].filter(d => d.startsWith(today.slice(0, 4))).length, dayOfYear = Math.round((parseD(today) - parseD(today.slice(0, 4) + '-01-01')) / 864e5) + 1;
  return { cur, best, bestEnd, cells, max, weeks, yearPct: Math.round(100 * yearDays / dayOfYear), total: [...counts.values()].reduce((a, b) => a + b, 0) };
}
function activityHTML() {
  const A = activity(); if (!A.total) return '';
  const lvl = (n) => n === 0 ? 0 : n >= A.max * 0.75 ? 4 : n >= A.max * 0.5 ? 3 : n >= A.max * 0.25 ? 2 : 1;
  return `<div class="grp"><div class="eyebrow">Activity</div>
<div class="streaks"><div><b>${A.cur}</b><span>day streak</span></div><div><b>${A.best}</b><span>longest${A.bestEnd ? ' · to ' + esc(dayShort(A.bestEnd)) : ''}</span></div><div><b>${A.yearPct}%</b><span>active days this year</span></div></div>
<div class="heat" role="img" aria-label="Tasks done per day, last ${A.weeks} weeks" style="grid-template-columns:repeat(${A.weeks}, 1fr)">${A.cells.map(c => `<i class="l${lvl(c.n)} ${c.future ? 'fut' : ''} ${c.d === todayK() ? 'now' : ''}" title="${esc(dayShort(c.d))} · ${c.n} done"></i>`).join('')}</div></div>`;
}
function summarySheet(k = S.ui.sumK || todayK(), mode = S.ui.sumMode || 'day') {
  S.ui.sumK = k; S.ui.sumMode = mode;
  const wk = isoWeek(k), days = mode === 'day' ? [k] : Array.from({ length: 7 }, (_, i) => addDays(weekStart(wk), i));
  const R = summarize(days, mode === 'week' ? wk : null), total = Math.max(R.work, R.meetMin + R.doneMin + R.openMin) || 1;
  const pct = (m) => Math.round(100 * m / total);
  const bar = (seg) => `<div class="sbar" role="img" aria-label="${seg.map(([l, m]) => `${l} ${fmtDur(m)}`).join(', ')}">${seg.filter(([, m]) => m > 0).map(([l, m, c]) => `<i class="${c}" style="width:${pct(m)}%" title="${l} · ${fmtDur(m)}"></i>`).join('')}</div>`;
  const legend = (seg) => `<div class="slegend">${seg.filter(([, m]) => m > 0).map(([l, m, c]) => `<span><i class="${c}"></i>${l} <b>${fmtDur(m)}</b></span>`).join('')}</div>`;
  const free = Math.max(0, R.work - R.meetMin - R.doneMin - R.openMin);
  const seg = [['Meetings', R.meetMin, 'm'], ['Done', R.doneMin, 'd'], ['Still open', R.openMin, 'o'], ['Unplanned', free, 'f']];
  const rows = (groups) => { const max = Math.max(1, ...groups.map(g => g.done + g.open)); return `<div class="srows">${groups.slice(0, 8).map(g => `<div class="srow"><span class="l">${esc(g.key)}</span><span class="track"><i class="d" style="width:${100 * g.done / max}%"></i><i class="o" style="width:${100 * g.open / max}%"></i></span><span class="v">${fmtDur(g.done + g.open)}</span></div>`).join('')}</div>`; };
  const ins = insight(R, mode, k);
  const title = mode === 'day' ? `${relDay(k) || DOWL[parseD(k).getDay()]}, ${MON[parseD(k).getMonth()]} ${parseD(k).getDate()}` : periodLabel(wk, true);
  const dayStrip = mode === 'week' ? `<div class="sdays">${R.perDay.map(d => { const m = Math.max(1, ...R.perDay.map(x => x.meet + x.done + x.open)); const h = (v) => Math.round(100 * v / m); return `<div class="sday ${d.k === todayK() ? 'today' : ''}" title="${dayShort(d.k)} · ${fmtDur(d.meet + d.done + d.open)}"><span class="col"><i class="o" style="height:${h(d.open)}%"></i><i class="d" style="height:${h(d.done)}%"></i><i class="m" style="height:${h(d.meet)}%"></i></span><span class="lbl">${DOW[parseD(d.k).getDay()][0]}</span></div>`; }).join('')}</div>` : '';
  openSheet(`<div class="grab"></div>
<div class="sheethead"><div><div class="sheettitle">In review</div><div class="muted" style="font-size:14px">${esc(title)}</div></div><div class="seg small"><button data-act="sum-mode" data-m="day" aria-pressed="${mode === 'day'}">Day</button><button data-act="sum-mode" data-m="week" aria-pressed="${mode === 'week'}">Week</button></div></div>
<div class="row" style="justify-content:space-between"><button class="btn icon" data-act="sum-nav" data-n="-1" aria-label="Earlier">${I.left}</button><button class="link" data-act="sum-nav" data-n="0">${mode === 'day' ? 'Today' : 'This week'}</button><button class="btn icon" data-act="sum-nav" data-n="1" aria-label="Later">${I.right}</button></div>
${!R.tasks.length && !R.meetings.length && !R.cleared.length ? `<div class="empty">Nothing was planned ${mode === 'day' ? 'on this day' : 'this week'}.</div>` : `
<div class="grp">${bar(seg)}${legend(seg)}</div>
<div class="stats"><div><b>${R.tDone}<span class="muted">/${R.targets.length}</span></b><span>targets</span></div><div><b>${R.done.length}</b><span>done</span>${R.cleared.length ? `<small>+${R.cleared.length} from inbox</small>` : ''}</div><div><b>${R.open.length}</b><span>open</span></div><div><b>${R.pushed.length}</b><span>pushed</span></div></div>
${dayStrip}
${ins ? `<div class="sins"><span>${esc(ins.text)}</span>${ins.act ? `<button class="btn" data-act="${ins.act}">${ins.label}</button>` : ''}</div>` : ''}
${activityHTML()}
<div class="grp"><div class="eyebrow">By board</div>${rows(R.byBoard)}</div>
<div class="grp"><div class="eyebrow">By tag</div>${rows(R.byTag)}</div>
${R.done.length || R.cleared.length ? `<div class="grp"><div class="eyebrow">Done</div><div class="sdone">${R.done.map(t => `<span>${esc(t.title)}<small> ${fmtDur(t.dur || 30)}</small></span>`).join('')}${R.cleared.map(t => `<span class="muted">${esc(t.title)}<small> · ${t.when ? esc(periodLabel(t.when)) : t.board ? esc(S.boards.get(t.board)?.name || 'board') : 'inbox'}</small></span>`).join('')}</div></div>` : ''}`}
<button class="bigbtn" data-act="close">Done</button>`, { summary: true });
}
function settingsSheet() {
  setTimeout(mountGoogleButton, 0); setTimeout(mountGcal, 0); setTimeout(mountTokens, 0); setTimeout(mountPush, 0);
  const s = syncState();
  openSheet(`<div class="grab"></div><div class="sheettitle">Settings</div>
<div class="grp"><div class="eyebrow">Account</div>
${S.me ? `<div>${esc(S.me)} · <span class="muted">${esc(s.text)}${S.lastSync ? ' · ' + new Date(S.lastSync).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : ''}</span></div><div class="row"><button class="bigbtn" style="flex:1" data-act="syncnow">Sync now</button><a class="bigbtn" style="flex:1;display:flex;align-items:center;justify-content:center;text-decoration:none;color:inherit" href="/auth/logout">Sign out</a></div>`
  : S.setup ? `<div class="muted" style="font-size:14px">Your tasks are saved on this device. Sign in to sync between phone and computer and load your boards.</div><div id="gsi" style="min-height:44px;display:flex;justify-content:center"></div><div id="gsimsg" class="muted" style="font-size:13px"></div>`
  : `<div class="muted" style="font-size:14px">Your tasks are saved on this device. Sync turns on once Google sign-in is set up for Horizonte.</div>`}</div>
${S.me ? `<div class="grp"><div class="eyebrow">Google Calendar</div><div id="gcalbox" class="muted" style="font-size:14px">Checking…</div></div>
<div class="grp"><div class="eyebrow">Assistants</div><div class="muted" style="font-size:14px">Let Claude or ChatGPT read and change your planner. Each gets its own access link; revoke it here any time.</div><div id="tokbox" class="muted" style="font-size:14px">Checking…</div></div>` : ''}
${S.me ? `<div class="grp"><div class="eyebrow">Reminders</div><div id="pushbox" class="muted" style="font-size:14px">Checking…</div></div>` : ''}
<div class="grp"><div class="eyebrow">Appearance</div><div class="seg">${[['', 'System'], ['light', 'Light'], ['dark', 'Dark']].map(([k, l]) => `<button data-act="theme" data-t="${k}" aria-pressed="${(S.ui.theme || '') === k}">${l}</button>`).join('')}</div></div>
<div class="grp"><div class="eyebrow">Workday</div><div class="row"><label class="field" style="flex:1">Starts<input type="time" data-pref="dayStart" value="${S.prefs.dayStart}"></label><label class="field" style="flex:1">Ends<input type="time" data-pref="dayEnd" value="${S.prefs.dayEnd}"></label></div></div>
<div class="grp"><div class="eyebrow">Daily targets</div><div class="row"><div class="stepper"><button aria-label="Fewer" data-act="cap" data-d="-1">${I.minus}</button><div>${S.prefs.cap}</div><button aria-label="More" data-act="cap" data-d="1">${I.plus(18, 2.5)}</button></div><span class="muted" style="font-size:14px">targets per day</span></div></div>
${tagsList().length ? `<div class="grp"><div class="eyebrow">Tags</div><div class="taglist">${tagsList().map(x => { const n = live().filter(t => (t.tags || []).includes(x.id)).length, ed = S.ui.tagEdit === x.id;
    return `<div class="tagrow" aria-expanded="${ed}"><button class="tagbtn" data-act="tagedit" data-t="${x.id}">${tagChip(x)}<span class="muted">${n}</span>${I.down}</button>${ed ? `<div class="tagopts"><span class="dots">${TAGCOLORS.map(c => `<button class="cdot c-${c}" data-act="tagcolor" data-t="${x.id}" data-c="${c}" aria-label="${c}" aria-pressed="${x.color === c}"></button>`).join('')}</span><button class="link" style="color:var(--now)" data-act="tagdel" data-t="${x.id}">Remove tag</button></div>` : ''}</div>`; }).join('')}</div><div class="muted" style="font-size:13px">Add a tag from any task, or type #tag when capturing.</div></div>` : ''}
<div class="row"><button class="bigbtn" style="flex:1" data-act="export">Export all data</button><button class="bigbtn" style="flex:1" data-act="close">Close</button></div>`, { settings: true });
}

// Sign in with Google button (Google Identity Services). Only needs the public client id.
function loadGsi() { return window.google?.accounts?.id ? Promise.resolve() : new Promise((res, rej) => { const sc = document.createElement('script'); sc.src = 'https://accounts.google.com/gsi/client'; sc.async = true; sc.onload = res; sc.onerror = rej; document.head.appendChild(sc); }); }
async function mountGoogleButton() {
  const box = $('#gsi'); if (!box || S.me) return;
  if (!S.clientId) { await whoami(); if (!S.clientId) { $('#gsimsg').textContent = 'Connect to the internet to sign in.'; return; } }
  try { await loadGsi(); } catch { $('#gsimsg').textContent = 'Could not reach Google. Check your connection.'; return; }
  if (S.calReady) { // sign-in and calendar link in one Google step
    box.innerHTML = `<button class="bigbtn dark" style="width:100%" data-act="signincal">Sign in with Google</button>`;
    $('#gsimsg').textContent = 'Also links your Google Calendar: meetings go there, tasks stay here.';
    return;
  }
  google.accounts.id.initialize({ client_id: S.clientId, use_fedcm_for_button: true, callback: async (resp) => {
    $('#gsimsg') && ($('#gsimsg').textContent = 'Signing in…');
    const r = await fetch('/auth/gsi', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ credential: resp.credential }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { $('#gsimsg') && ($('#gsimsg').textContent = j.error || 'Sign-in failed.'); return; }
    S.me = j.email; toast('Signed in · loading your boards'); closeSheet(); render(); await syncNow(); render();
  } });
  google.accounts.id.renderButton(box, { theme: 'outline', size: 'large', text: 'signin_with', shape: 'pill', width: Math.min(320, box.clientWidth || 320) });
}

// Google Calendar link: meetings go to Google, Google events come back as meetings. Tasks stay in Horizonte.
// Settings › Reminders: web push for this device. Two kinds: the morning digest and a nudge 10 minutes before a timed task.
const pushReady = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
async function pushSub() { try { const reg = await navigator.serviceWorker.ready; return await reg.pushManager.getSubscription(); } catch { return null; } }
async function mountPush() {
  const box = $('#pushbox'); if (!box) return;
  if (!pushReady()) { box.innerHTML = /iPhone|iPad/.test(navigator.userAgent) ? 'On iPhone, add Horizonte to the Home Screen first (Share → Add to Home Screen); reminders work from there.' : 'This browser does not support notifications.'; return; }
  if (location.hostname === 'localhost') { box.textContent = 'Reminders need the live site (service worker is off on localhost).'; return; }
  if (Notification.permission === 'denied') { box.textContent = 'Notifications are blocked for this site in the browser settings.'; return; }
  const sub = await pushSub(); let st = { subscribed: false, digest: true, alerts: true, devices: 0, digestHour: 9 };
  try { st = await (await fetch('/api/push/status', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpoint: sub?.endpoint }) })).json(); } catch { box.textContent = 'Connect to the internet to manage reminders.'; return; }
  if (!sub || !st.subscribed) { box.innerHTML = `<div>Get a morning summary and a nudge 10 minutes before a timed task.${st.devices ? ` <span class="muted">On for ${st.devices} other device${st.devices > 1 ? 's' : ''}.</span>` : ''}</div><button class="btn" style="margin-top:8px" data-act="pushon">Turn on for this device</button>`; return; }
  box.innerHTML = `<label class="chk"><input type="checkbox" data-act="pushopt" data-o="digest" ${st.digest ? 'checked' : ''}> Morning summary at ${st.digestHour}:00</label>
<label class="chk"><input type="checkbox" data-act="pushopt" data-o="alerts" ${st.alerts ? 'checked' : ''}> 10 minutes before a timed task</label>
<div class="row" style="margin-top:6px"><button class="link" data-act="pushtest">Send a test</button><button class="link" style="color:var(--now)" data-act="pushoff">Turn off on this device</button></div>`;
}
async function pushSave(sub, digest, alerts) { await fetch('/api/push/subscribe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sub: sub.toJSON(), label: navigator.userAgent.slice(0, 80), digest: digest ? 1 : 0, alerts: alerts ? 1 : 0 }) }); }
// Settings › Assistants: list, mint and revoke MCP access tokens. The link is shown once, right after minting.
async function mountTokens() {
  const box = $('#tokbox'); if (!box) return;
  let st; try { st = await (await fetch('/api/tokens', { cache: 'no-store' })).json(); } catch { box.textContent = 'Connect to the internet to manage assistant access.'; return; }
  const rows = (st.tokens || []).map(t => `<div class="tokrow"><span><b>${esc(t.name)}</b><span class="muted"> · ${t.last_used ? 'used ' + relTime(t.last_used) : 'never used'}</span></span><button class="link" style="color:var(--now)" data-act="tokdel" data-id="${t.id}">Revoke</button></div>`).join('');
  box.innerHTML = `${rows || ''}<div class="row" style="margin-top:${rows ? 8 : 0}px"><input id="tokname" class="newtag" style="flex:1" placeholder="Name, e.g. Claude" autocomplete="off"><button class="btn" data-act="toknew">Create link</button></div>`;
}
function relTime(ms) { const d = Date.now() - ms; return d < 36e5 ? `${Math.max(1, Math.round(d / 6e4))} min ago` : d < 864e5 ? `${Math.round(d / 36e5)} h ago` : `${Math.round(d / 864e5)} d ago`; }
async function mountGcal() {
  const box = $('#gcalbox'); if (!box) return;
  let st; try { st = await (await fetch('/api/gcal', { cache: 'no-store' })).json(); } catch { box.textContent = 'Connect to the internet to see the calendar link.'; return; }
  if (!$('#gcalbox')) return;
  if (!st.available) { box.innerHTML = 'Calendar sync needs one setup step in Cloudflare (the Google client secret).'; return; }
  if (st.connected) { box.innerHTML = `<div style="color:var(--ink)">Connected to ${esc(st.email || 'Google Calendar')}. Meetings sync both ways; tasks stay here.</div><div class="row" style="margin-top:8px"><button class="bigbtn" style="flex:1" data-act="gcalsync">Sync calendar now</button><button class="bigbtn" style="flex:1" data-act="gcalon">Use a different calendar</button></div><button class="link" style="font-size:13px;margin-top:6px" data-act="gcaloff">Disconnect calendar</button>`; return; }
  box.innerHTML = `<div>Send meetings to Google Calendar (with Google's reminders) and show your Google events here. Tasks stay in Horizonte.</div><button class="bigbtn dark" style="width:100%;margin-top:8px" data-act="gcalon">Connect Google Calendar</button>`;
  S.clientId = S.clientId || st.clientId;
}
async function connectGcal() {
  try { await loadGsi(); } catch { toast('Could not reach Google'); return; }
  const client = google.accounts.oauth2.initCodeClient({ client_id: S.clientId, scope: 'openid email https://www.googleapis.com/auth/calendar.events', ux_mode: 'popup', select_account: true,
    callback: async (resp) => {
      if (resp.error) { toast('Calendar not connected'); return; }
      const box = $('#gcalbox'); if (box) box.textContent = 'Connecting…';
      const r = await fetch('/api/gcal/connect', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: resp.code }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { if ($('#gcalbox')) $('#gcalbox').textContent = j.error || 'Could not connect.'; return; }
      toast('Google Calendar connected'); await syncNow(); mountGcal();
    } });
  client.requestCode();
}

function signInWithCalendar() {
  const client = google.accounts.oauth2.initCodeClient({ client_id: S.clientId, scope: 'openid email profile https://www.googleapis.com/auth/calendar.events', ux_mode: 'popup', select_account: true,
    callback: async (resp) => {
      if (resp.error) { $('#gsimsg') && ($('#gsimsg').textContent = 'Sign-in cancelled.'); return; }
      $('#gsimsg') && ($('#gsimsg').textContent = 'Signing in…');
      const r = await fetch('/auth/code', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: resp.code }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { $('#gsimsg') && ($('#gsimsg').textContent = j.error || 'Sign-in failed.'); return; }
      S.me = j.email; toast(j.calendar ? 'Signed in · calendar linked' : 'Signed in'); closeSheet(); render(); await syncNow(); render();
    } });
  client.requestCode();
}

// ── toast ─────────────────────────────────────────────────────
let toastTimer;
function toast(msg, withUndo, extra = '') {
  $('.toast')?.remove(); clearTimeout(toastTimer);
  (isDesk() ? document.body : ($('.m') || document.body)).insertAdjacentHTML('beforeend', `<div class="toast" role="status"><span>${esc(msg)}</span>${extra}${withUndo ? '<button data-act="undo">Undo</button>' : ''}</div>`);
  toastTimer = setTimeout(() => $('.toast')?.remove(), 5000);
}
// After checking off a timed task: one tap to say it took longer or shorter. Optional; the toast goes away on its own.
function doneToast(id) { const t = S.tasks.get(id); if (!t) return;
  toast(`Done · ${fmtDur(t.dur || 30)}`, true, `<button class="tk" data-act="took" data-id="${id}" data-d="-15" aria-label="Took 15 minutes less">−15</button><button class="tk" data-act="took" data-id="${id}" data-d="15" aria-label="Took 15 minutes more">+15</button>`); }

// ── clicks ────────────────────────────────────────────────────
document.addEventListener('click', async (e) => {
  if (suppressClick) { suppressClick = false; e.preventDefault(); e.stopPropagation(); return; }
  // a quick-create popover is open: a click anywhere outside it dismisses it (like Google Calendar)
  if (S.ui.draft && !e.target.closest('.qc,.draft')) { S.ui.draft = null; render(); return; }
  if (!isDesk() && e.target.matches('.m .grid')) { const g = e.target, r = g.getBoundingClientRect(), h0 = Number(g.dataset.h0), hpx = Number(g.dataset.hpx);
    const m = Math.max(0, Math.min(23 * 60 + 30, Math.floor(((e.clientY - r.top) / hpx * 60 + h0 * 60) / 30) * 30)); captureSheet({ when: g.dataset.drop.slice(5), at: fromMin(m) }); return; }
  const el = e.target.closest('[data-act],[data-zoom],[data-src],[data-tab],[data-mzoom]'); if (!el) return;
  const card = e.target.closest('[data-tid]'), tid = card?.dataset.tid;
  if (el.dataset.zoom) { S.ui.zoom = el.dataset.zoom; S.ui.pk = null; render(); if (S.ui.zoom === 'hours') scrollHoursToNow(); return; }
  if (el.dataset.src) { S.ui.src = el.dataset.src; S.ui.panelView = 'list'; render(); const p = $('.panel'); if (p) p.scrollTop = 0; return; }
  if (el.dataset.tab) { // remember where each tab was scrolled to; tapping the current tab scrolls it to the top
    const cur = S.ui.mtab, mm = $('.mm'); S.ui.scroll ??= {}; if (mm) S.ui.scroll[cur] = mm.scrollTop;
    if (el.dataset.tab === cur) { if (mm) mm.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    S.ui.mtab = el.dataset.tab; if (el.dataset.tab !== 'board') S.ui.board = null; if (el.dataset.tab === 'hours') S.ui.mjump = true; render(); const n = $('.mm'); if (n && el.dataset.tab !== 'hours') n.scrollTop = S.ui.scroll[el.dataset.tab] || 0; return; }
  if (el.dataset.mzoom) { S.ui.mzoom = el.dataset.mzoom; render(); return; }
  const act = el.dataset.act, st = sheetState;
  switch (act) {
    case 'done': if (e.target.tagName === 'INPUT') { e.preventDefault(); toggleDone(tid); } return;
    case 'open': if (tid) taskSheet(tid); return;
    case 'close': closeSheet(); render(); return;
    case 'undo': $('.toast')?.remove(); undo(); return;
    case 'today': if (S.ui.zoom === 'hours') S.ui.hday = todayK(); else if (S.ui.zoom === 'horizons') S.ui.hzday = todayK(); else if (S.ui.zoom === 'days') S.ui.anchor = addDays(todayK(), -1); else S.ui.pk = null; render(); { const tl = $('.tl'); if (tl && S.ui.zoom !== 'hours') tl.scrollLeft = 0; } if (S.ui.zoom === 'hours') scrollHoursToNow(); return;
    case 'prev': case 'next': { const n = act === 'prev' ? -1 : 1;
      if (S.ui.zoom === 'hours') S.ui.hday = addDays(S.ui.hday, n); else if (S.ui.zoom === 'horizons') S.ui.hzday = addDays(S.ui.hzday || todayK(), n); else if (S.ui.zoom === 'days') S.ui.anchor = addDays(S.ui.anchor, 7 * n); else S.ui.pk = shiftPeriod(S.ui.pk, n);
      render(); return; }
    case 'mprev': case 'mnext': { const n = act === 'mprev' ? -1 : 1, z = S.ui.mzoom;
      S.ui.manchor = z === 'horizons' ? addDays(S.ui.manchor, n) : z === 'days' ? addDays(S.ui.manchor, 7 * n) : periodRange(shiftPeriod(periodOf({ weeks: 'week', months: 'month', quarters: 'quarter', years: 'year' }[z], S.ui.manchor), 8 * n))[0];
      render(); $('.mm').scrollTop = 0; return; }
    case 'mtoday': if (S.ui.mtab === 'hours') { S.ui.mday = todayK(); S.ui.mjump = true; render(); return; } S.ui.manchor = todayK(); render(); $('.mm').scrollTop = 0; return;
    case 'mday': S.ui.mday = el.dataset.k; S.ui.mjump = true; render(); return;
    case 'menu': menuSheet(); return;
    case 'odhide': S.ui.odHide = todayK(); render(); return;
    case 'mgrid': S.ui.mgrid = !S.ui.mgrid; S.ui.mjump = true; render(); return;
    case 'rollto': if (tid) { pushTask(tid, todayK()); render(); toast('Moved to today', true); } return;
    case 'rollall': { const open = dayParts(el.dataset.k).open.filter(x => x.kind !== 'meeting'); batch(g => open.forEach(t => put('task', t.id, { when: todayK(), at: '', rolls: (t.rolls || 0) + 1 }, { group: g }))); render(); toast(`Moved ${open.length} to today`, true); return; }
    case 'panelnav': S.ui.panelView = 'nav'; render(); return;
    case 'togglepanel': S.ui.panelHidden = !S.ui.panelHidden; render(); return;
    case 'filter': filterSheet(); return;
    case 'sortset': S.ui.sort = el.dataset.s; render(); if (sheetState?.filter) filterSheet(); return;
    case 'filterclear': S.ui.sort = 'manual'; S.ui.tagFilter = null; render(); if (sheetState?.filter) filterSheet(); return;
    case 'qclear': { const inp = $('#q,#mq'); S.ui.q = ''; if (inp) { inp.value = ''; inp.blur(); } render(); $('#q,#mq')?.focus(); return; }
    case 'tagfilter': S.ui.tagFilter = S.ui.tagFilter === el.dataset.t ? null : el.dataset.t; render(); if (sheetState?.filter) filterSheet(); return;
    case 'tagtoggle': { const t = S.tasks.get(st.id); if (!t) return; const cur = t.tags || [], id = el.dataset.t; put('task', st.id, { tags: cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id] }); render(); taskSheet(st.id); return; }
    case 'tagnew': S.ui.tagAdding = true; taskSheet(st.id); return;
    case 'tagdone': { const v = $('#newtag')?.value.trim(); S.ui.tagAdding = false; if (v) { const t = S.tasks.get(st.id), id = ensureTag(v); if (id && t && !(t.tags || []).includes(id)) put('task', t.id, { tags: [...(t.tags || []), id] }); render(); } taskSheet(st.id); return; }
    case 'summary': summarySheet(el.dataset.k || todayK(), S.ui.sumMode || 'day'); return;
    case 'sum-mode': summarySheet(S.ui.sumK, el.dataset.m); return;
    case 'sum-nav': { const n = +el.dataset.n, k = S.ui.sumK || todayK(); summarySheet(n === 0 ? todayK() : S.ui.sumMode === 'week' ? addDays(k, 7 * n) : addDays(k, n)); return; }
    case 'sum-push': { const k = S.ui.sumK || todayK(), ids = live().filter(t => t.when === k && isOpen(t) && t.pri === 'target' && t.kind !== 'meeting').map(t => t.id); batch(g => ids.forEach(id => { const t = S.tasks.get(id); put('task', id, { when: addDays(k, 1), at: '', rolls: (t.rolls || 0) + 1 }, { group: g }); })); render(); summarySheet(); toast(`${ids.length} moved to ${periodLabel(addDays(k, 1))}`, true); return; }
    case 'tstart': startTimer(el.dataset.tid || st?.id); if (sheetState) taskSheet(sheetState.id); return;
    case 'tstop': { e.stopPropagation(); const id = el.dataset.tid || st?.id, m = stopTimer(id); render(); if (sheetState) taskSheet(sheetState.id); toast(`Stopped · ${fmtDur(m)} logged`); return; }
    case 'tadd': addTime(st.id, +el.dataset.m); render(); taskSheet(st.id); return;
    case 'cm-timer': closeMenu(); { const t = S.tasks.get(el.dataset.tid); if (t.timer) { const m = stopTimer(t.id); render(); toast(`Stopped · ${fmtDur(m)} logged`); } else startTimer(t.id); } return;
    case 'cm-done': closeMenu(); toggleDone(el.dataset.tid); return;
    case 'cm-open': closeMenu(); taskSheet(el.dataset.tid); return;
    case 'cm-when': { closeMenu(); const w = el.dataset.w, t = S.tasks.get(el.dataset.tid); put('task', t.id, { when: w || null, at: w && kindOf(w) === 'day' ? t.at : '' }); render(); toast(w ? `Moved to ${periodLabel(w)}` : 'Unscheduled', true); return; }
    case 'cm-pri': closeMenu(); put('task', el.dataset.tid, { pri: el.dataset.p }); render(); return;
    case 'cm-delete': closeMenu(); put('task', el.dataset.tid, { del: new Date().toISOString() }); render(); toast('Deleted', true); return;
    case 'took': { const t = S.tasks.get(el.dataset.id); if (!t) return; put('task', t.id, { dur: Math.max(5, (t.dur || 30) + +el.dataset.d) }, { quiet: true }); render(); doneToast(t.id); return; }
    case 'timeclear': { const t = S.tasks.get(st.id); put('task', st.id, { at: '' }); render(); taskSheet(st.id); return; }
    case 'timeslot': timeList(null); setStart(st.id, el.dataset.at); return;
    case 'pushon': { el.disabled = true;
      try { const perm = await Notification.requestPermission(); if (perm !== 'granted') { mountPush(); return; }
        const { key } = await (await fetch('/api/push/key')).json(); const reg = await navigator.serviceWorker.ready;
        const raw = Uint8Array.from(atob(key.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
        const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: raw });
        await pushSave(sub, true, true); toast('Reminders on'); } catch (e) { toast('Could not turn on reminders: ' + e.message); }
      mountPush(); return; }
    case 'pushopt': { const sub = await pushSub(); if (!sub) return; const d = $('#pushbox [data-o=digest]').checked, a = $('#pushbox [data-o=alerts]').checked; await pushSave(sub, d, a); return; }
    case 'pushtest': { const sub = await pushSub(); const r = await (await fetch('/api/push/test', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpoint: sub?.endpoint }) })).json(); toast(r.ok ? 'Test sent' : 'Could not send (' + (r.status || r.error) + ')'); return; }
    case 'pushoff': { const sub = await pushSub(); if (sub) { await fetch('/api/push/unsubscribe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }) }); await sub.unsubscribe(); } toast('Reminders off on this device'); mountPush(); return; }
    case 'toknew': { const name = $('#tokname')?.value.trim() || 'Assistant'; el.disabled = true;
      let r; try { r = await (await fetch('/api/tokens', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) })).json(); } catch { toast('Could not create the link'); el.disabled = false; return; }
      const box = $('#tokbox'); if (!box) return;
      box.innerHTML = `<div class="tokshow"><div><b>${esc(name)}</b> · copy this link now; it is not shown again.</div><code>${esc(r.url)}</code><div class="row"><button class="btn" data-act="tokcopy" data-url="${esc(r.url)}">Copy link</button><button class="link" data-act="tokdone">Done</button></div>
<div class="muted" style="font-size:13px;margin-top:8px">Claude: Settings → Connectors → Add custom connector → paste the link. ChatGPT: Settings → Connectors → Create (developer mode) → MCP server URL, no authentication.</div></div>`; return; }
    case 'tokcopy': { try { await navigator.clipboard.writeText(el.dataset.url); toast('Link copied'); } catch { toast('Select the link and copy it'); } return; }
    case 'tokdone': mountTokens(); return;
    case 'tokdel': { if (!confirm('Revoke this assistant\'s access?')) return; await fetch('/api/tokens/' + el.dataset.id, { method: 'DELETE' }); mountTokens(); return; }
    case 'theme': S.ui.theme = el.dataset.t; saveUI(); applyTheme(); settingsSheet(); return;
    case 'tagedit': S.ui.tagEdit = S.ui.tagEdit === el.dataset.t ? null : el.dataset.t; settingsSheet(); return;
    case 'tagcolor': { const list = tagsList().map(t => t.id === el.dataset.t ? { ...t, color: el.dataset.c } : t); put('pref', 'main', { tags: list }, { quiet: true }); render(); settingsSheet(); return; }
    case 'tagdel': { const id = el.dataset.t; batch(g => { put('pref', 'main', { tags: tagsList().filter(t => t.id !== id) }, { group: g }); for (const t of live()) if ((t.tags || []).includes(id)) put('task', t.id, { tags: t.tags.filter(x => x !== id) }, { group: g }); }); if (S.ui.tagFilter === id) S.ui.tagFilter = null; render(); settingsSheet(); toast('Tag removed', true); return; }
    case 'toggle': S.ui.open[el.dataset.key] = !S.ui.open[el.dataset.key]; render(); return;
    case 'addto': S.ui.adding = el.dataset.k; render(); $(`#ia-${CSS.escape(el.dataset.k)}`)?.focus(); return;
    case 'qckind': S.ui.draft.kind = el.dataset.v === 'meeting' ? 'meeting' : ''; if (S.ui.draft.kind === 'meeting' && S.ui.draft.dur < 60 && !S.ui.draft.durSet) S.ui.draft.dur = 60; render(); $('#qc-title')?.focus(); return;
    case 'qcdur': S.ui.draft.dur = Math.max(15, Math.min(480, S.ui.draft.dur + Number(el.dataset.d))); S.ui.draft.durSet = true; render(); return;
    case 'qccolor': S.ui.draft.color = el.dataset.c; render(); $('#qc-title')?.focus(); return;
    case 'qccancel': S.ui.draft = null; render(); return;
    case 'qcsave': { const id = saveDraft(); if (id) toast(`Added ${S.ui.draft?.kind === 'meeting' ? 'meeting' : 'task'} at ${clock(S.tasks.get(id).at)}`, true); S.ui.draft = null; render(); return; }
    case 'qcmore': { const id = saveDraft(); S.ui.draft = null; render(); if (id) taskSheet(id); return; }
    case 'capture': captureSheet(el.dataset.board ? { board: el.dataset.board } : el.dataset.k ? { when: el.dataset.k, at: el.dataset.at || '' } : isDesk() ? {} : S.ui.mtab === 'hours' ? { when: S.ui.mday } : S.ui.mtab === 'board' && S.ui.board ? { board: S.ui.board } : {}); return;
    case 'savecapture': { const n = addLines($('#dump').value, captureDest(st?.capture)); closeSheet(); render(); $('.mm')?.scrollTo({ top: 0, behavior: 'smooth' }); if (n) toast(`Added ${n} task${n > 1 ? 's' : ''}`, true); return; }
    case 'review': reviewSheet(); return;
    case 'rv': { const id = el.closest('[data-tid]').dataset.tid; pushTask(id, el.dataset.k); render(); reviewSheet(); return; }
    case 'rvdrop': { const id = el.closest('[data-tid]').dataset.tid; put('task', id, { status: 'dropped' }); render(); reviewSheet(); return; }
    case 'rvrest': batch(g => overdueTasks().filter(t => t.pri !== 'target').forEach(t => put('task', t.id, { when: null, at: '', rolls: (t.rolls || 0) + 1 }, { group: g }))); render(); reviewSheet(); return;
    case 'when': put('task', st.id, { when: el.dataset.k }); closeSheet(); render(); toast(`Moved to ${periodLabel(el.dataset.k)}`, true); return;
    case 'cleartime': put('task', st.id, { at: '' }); render(); taskSheet(st.id); return;
    case 'pin': { const t = S.tasks.get(st.id); put('task', st.id, { pin: !t.pin }); render(); taskSheet(st.id); return; }
    case 'reflowtoggle': { const off = { ...(S.prefs.reflowOff || {}) }; const k = el.dataset.k; if (off[k]) delete off[k]; else off[k] = true; put('pref', 'main', { reflowOff: off }); render(); toast(off[k] ? 'Reflow off for today' : 'Reflow on'); return; }
    case 'dur': { const t = S.tasks.get(st.id); put('task', st.id, { dur: Math.max(15, Math.min(480, (t.dur || 30) + Number(el.dataset.d))) }); render(); taskSheet(st.id); return; }
    case 'pri': put('task', st.id, { pri: el.dataset.p }); render(); taskSheet(st.id); return;
    case 'color': put('task', st.id, { color: el.dataset.c }); render(); taskSheet(st.id); return;
    case 'emoji': put('task', st.id, { emoji: el.dataset.e }); render(); taskSheet(st.id); return;
    case 'kind': { const t = S.tasks.get(st.id); if (!t) return;
      if (el.dataset.v === 'meeting') { const f = { kind: 'meeting' };
        if (!t.at) { const n = new Date(); f.at = `${pad(Math.min(23, n.getHours() + 1))}:00`; }
        if (kindOf(t.when) !== 'day') f.when = todayK();
        if ((t.dur || 30) < 60) f.dur = 60;
        put('task', st.id, f); render(); taskSheet(st.id);
        if (!t.at) { try { $('.sheet [data-act=picktime]').showPicker(); } catch {} } }
      else { put('task', st.id, { kind: '' }); render(); taskSheet(st.id); }
      return; }
    case 'sheetboard': taskSheet(st.id, 'board'); return;
    case 'sheetback': taskSheet(st.id); return;
    case 'setboard': put('task', st.id, { board: el.dataset.b, section: el.dataset.s }); render(); taskSheet(st.id); return;
    case 'notes': S.ui.notesOpen = st.id; taskSheet(st.id); $('.sheet .notes')?.focus(); return;
    case 'unschedule': put('task', st.id, { when: null, at: '' }); closeSheet(); render(); toast('Unscheduled', true); return;
    case 'markdone': case 'reopen': toggleDone(st.id); closeSheet(); render(); return;
    case 'delete': put('task', st.id, { del: new Date().toISOString() }); closeSheet(); render(); toast('Deleted', true); return;
    case 'newboard': boardSheet(null); return;
    case 'editboard': boardSheet(el.dataset.bid); return;
    case 'saveboard': { const name = $('#bname').value.trim(); if (!name) { $('#bname').focus(); return; }
      const secs = $('#bsecs').value.split('\n').map(s => s.trim()).filter(Boolean); const id = el.dataset.bid || rid('b_');
      put('board', id, el.dataset.bid ? { name, sections: secs } : { name, sections: secs, color: '', o: Date.now(), archived: false });
      closeSheet(); if (!el.dataset.bid) { S.ui.src = 'b:' + id; S.ui.board = id; S.ui.panelView = 'list'; } render(); return; }
    case 'delboard': { const id = el.dataset.bid; batch(g => { put('board', id, { del: new Date().toISOString() }, { group: g }); boardTasks(id).forEach(t => put('task', t.id, { board: '', section: '' }, { group: g })); });
      closeSheet(); S.ui.board = null; S.ui.src = 'inbox'; render(); toast('Board deleted; its tasks moved to Inbox', true); return; }
    case 'openboard': S.ui.board = el.dataset.bid; if (!isDesk()) { if (sheetState) removeSheetDom(); if (S.ui.mtab !== 'board') S.ui.mprev = S.ui.mtab; S.ui.mtab = 'board'; if (history.state?.hz !== 'board') history.pushState({ hz: 'board' }, ''); } render(); $('.mm').scrollTop = 0; return;
    case 'boardsback': if (history.state?.hz === 'board') { history.back(); return; } S.ui.board = null; if (!isDesk()) S.ui.mtab = S.ui.mprev || 'hours'; render(); return;
    case 'settings': settingsSheet(); return;
    case 'gcalon': connectGcal(); return;
    case 'signincal': signInWithCalendar(); return;
    case 'gcaloff': await fetch('/api/gcal/disconnect', { method: 'POST' }); mountGcal(); toast('Calendar disconnected'); return;
    case 'gcalsync': { const b = $('#gcalbox'); if (b) b.style.opacity = .6; await syncNow(); render(); mountGcal(); if (b) b.style.opacity = 1; toast('Calendar synced'); return; }
    case 'syncnow': syncNow().then(() => sheetState?.settings && settingsSheet()); return;
    case 'cap': S.prefs.cap = Math.max(1, Math.min(5, S.prefs.cap + Number(el.dataset.d))); put('pref', 'main', { cap: S.prefs.cap }, { quiet: true }); render(); settingsSheet(); return;
    case 'export': { const blob = new Blob([JSON.stringify({ exported: new Date().toISOString(), tasks: [...S.tasks.values()], boards: [...S.boards.values()], prefs: S.prefs }, null, 2)], { type: 'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `horizonte-${todayK()}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); return; }
  }
});
function captureDest(d = {}) {
  if (d.board) return { board: d.board };
  if (d.when) return d.at ? { when: d.when, at: d.at } : { when: d.when };
  if (isDesk()) { const s = S.ui.src; if (s.startsWith('b:')) return { board: s.slice(2) }; if (s === 'week') return { when: isoWeek(todayK()) }; if (s === 'month') return { when: periodOf('month', todayK()) }; }
  return {};
}
// Desktop start-time field: a typed value plus a popover of 15-minute slots around the workday.
function timeList(inp) {
  $('.timelist')?.remove(); if (!inp) return;
  const pref = S.prefs || {}, from = Math.max(0, toMin(pref.dayStart || '07:00') - 120), to = Math.min(24 * 60, toMin(pref.dayEnd || '20:00') + 180);
  const cur = sheetState?.id && S.tasks.get(sheetState.id)?.at, q = inp.value.trim(), typed = parseTime(q);
  const r = inp.getBoundingClientRect(); let html = '';
  for (let m = from; m < to; m += 15) { const at = `${pad(Math.floor(m / 60))}:${pad(m % 60)}`; html += `<button data-act="timeslot" data-at="${at}" aria-pressed="${at === (typed || cur)}">${clockAP(at)}</button>`; }
  document.body.insertAdjacentHTML('beforeend', `<div class="timelist" role="listbox" style="left:${r.left}px;top:${r.bottom + 4}px;width:${r.width}px">${html}</div>`);
  const list = $('.timelist'); const sel = list.querySelector('[aria-pressed=true]');
  if (sel) list.scrollTop = sel.offsetTop - 80;
  else { // nothing chosen yet: open at the next quarter-hour today, or the start of the workday
    const t = S.tasks.get(sheetState?.id), nowQ = Math.ceil(nowMin() / 15) * 15, start = t?.when === todayK() ? nowQ : toMin(pref.dayStart || '09:00');
    const b = list.querySelector(`[data-at="${pad(Math.floor(start / 60))}:${pad(start % 60)}"]`); if (b) list.scrollTop = b.offsetTop - 4; }
}
document.addEventListener('focusin', (e) => { if (e.target.dataset?.act === 'timein') { e.target.select(); timeList(e.target); } });
document.addEventListener('focusout', (e) => { if (e.target.dataset?.act === 'timein') setTimeout(() => { if (!document.activeElement?.closest?.('.timelist')) timeList(null); }, 120); });
document.addEventListener('input', (e) => { if (e.target.dataset?.act === 'timein') { const at = parseTime(e.target.value); const b = $(`.timelist [data-at="${at}"]`); $$('.timelist [aria-pressed=true]').forEach(x => x.setAttribute('aria-pressed', 'false')); if (b) { b.setAttribute('aria-pressed', 'true'); b.scrollIntoView({ block: 'center' }); } } });
document.addEventListener('keydown', (e) => { if (e.target.dataset?.act !== 'timein') return;
  if (e.key === 'Enter') { e.preventDefault(); const at = parseTime(e.target.value); if (at) { timeList(null); setStart(sheetState.id, at); } else if (!e.target.value.trim()) { timeList(null); put('task', sheetState.id, { at: '' }); render(); taskSheet(sheetState.id); } else e.target.classList.add('bad'); }
  if (e.key === 'Escape') { e.stopPropagation(); timeList(null); e.target.blur(); } });
// Invisible date/time inputs laid over buttons: open the native picker on any click, not only on the browser's tiny icon.
document.addEventListener('click', (e) => { const el = e.target; if (el.classList?.contains('overlay-input') && el.showPicker) { try { el.showPicker(); } catch {} } });
document.addEventListener('change', (e) => {
  const el = e.target, st = sheetState;
  if (el.dataset.act === 'pickdate' && el.value) { put('task', st.id, { when: el.value }); closeSheet(); render(); toast(`Moved to ${periodLabel(el.value)}`, true); }
  else if (el.dataset.act === 'picktime' && el.value) { const t = S.tasks.get(st.id); put('task', st.id, { at: el.value, when: kindOf(t.when) === 'day' ? t.when : todayK() }); render(); taskSheet(st.id); }
  else if (el.dataset.act === 'rvpick' && el.value) { pushTask(el.closest('[data-tid]').dataset.tid, el.value); render(); reviewSheet(); }
  else if (el.dataset.pref) { S.prefs[el.dataset.pref] = el.value; put('pref', 'main', { [el.dataset.pref]: el.value }, { quiet: true }); render(); }
  else if (el.dataset.field) sheetField(el);
});
document.addEventListener('focusout', (e) => { if (e.target.dataset?.field) sheetField(e.target); });
// Drag the divider between the lists panel and the timeline to resize the panel (persisted in ui.pw). Double-click resets.
document.addEventListener('pointerdown', (e) => {
  const h = e.target.closest('[data-resize=panel]'); if (!h) return;
  const main = h.parentElement, x0 = e.clientX, w0 = main.querySelector('.panel').getBoundingClientRect().width;
  h.setPointerCapture(e.pointerId); h.classList.add('active'); document.body.classList.add('resizing');
  const mv = (ev) => { const w = Math.max(260, Math.min(Math.round(innerWidth * 0.6), w0 + ev.clientX - x0)); main.style.setProperty('--pw', w + 'px'); S.ui.pw = w; };
  const up = () => { h.classList.remove('active'); document.body.classList.remove('resizing'); h.removeEventListener('pointermove', mv); h.removeEventListener('pointerup', up); h.removeEventListener('pointercancel', up); store.set('ui', S.ui); };
  h.addEventListener('pointermove', mv); h.addEventListener('pointerup', up); h.addEventListener('pointercancel', up); e.preventDefault();
});
document.addEventListener('dblclick', (e) => { if (e.target.closest('[data-resize=panel]')) { S.ui.pw = 320; store.set('ui', S.ui); render(); } });
window.addEventListener('popstate', () => {
  if (popping) { popping = false; return; }
  if (sheetState) { removeSheetDom(); render(); return; }
  if (!isDesk() && S.ui.mtab === 'board') { S.ui.board = null; S.ui.mtab = S.ui.mprev || 'hours'; render(); }
});
document.addEventListener('keydown', (e) => {
  const el = e.target;
  if ((el.id === 'q' || el.id === 'mq') && e.key === 'Escape') { e.preventDefault(); const id = el.id; S.ui.q = ''; el.value = ''; el.blur(); render(); $('#' + id)?.focus(); return; }
  // "/" focuses search on desktop when not typing elsewhere
  if (e.key === '/' && !e.metaKey && !e.ctrlKey && !sheetState && !el.matches('input,textarea,[contenteditable]')) { e.preventDefault(); const q = $('#q'); if (q) { q.focus(); q.select(); } return; }
  if (el.id === 'qa' && e.key === 'Enter') {
    e.preventDefault(); const v = el.value.trim(); if (!v) return;
    const n = addLines(v, { ...captureDest(), src: 'typed' }); el.value = ''; render(); $('#qa')?.focus(); if (n > 1) toast(`Added ${n} tasks`, true); return;
  }
  if (el.dataset?.addto) {
    if (e.key === 'Escape') { S.ui.adding = null; render(); return; }
    if (e.key === 'Enter') { e.preventDefault(); const v = el.value.trim(); const k = el.dataset.addto; if (v) addLines(v, { when: k }); el.value = ''; render(); $(`#ia-${CSS.escape(k)}`)?.focus(); return; }
  }
  if (el.id === 'newtag') {
    if (e.key === 'Escape') { S.ui.tagAdding = false; taskSheet(sheetState.id); return; }
    if (e.key === 'Enter') { e.preventDefault(); const v = el.value.trim(); S.ui.tagAdding = false; if (v && sheetState?.id) { const id = ensureTag(v); const t = S.tasks.get(sheetState.id); if (id && t && !(t.tags || []).includes(id)) put('task', t.id, { tags: [...(t.tags || []), id] }); } render(); taskSheet(sheetState.id); return; }
    return;
  }
  if (el.id === 'qc-title') {
    if (e.key === 'Escape') { S.ui.draft = null; render(); return; }
    if (e.key === 'Enter') { e.preventDefault(); $('[data-act=qcsave]')?.click(); return; }
    return;
  }
  if (el.classList?.contains('ttl') && e.key === 'Enter') { e.preventDefault(); el.blur(); return; }
  if (el.id === 'dump' && e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { $('[data-act=savecapture]')?.click(); return; }
  if (e.key === 'Escape' && sheetState) { closeSheet(); render(); return; }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !/INPUT|TEXTAREA/.test(el.tagName)) { e.preventDefault(); undo(); return; }
  if (/INPUT|TEXTAREA|SELECT/.test(el.tagName) || e.metaKey || e.ctrlKey || e.altKey || sheetState || !isDesk()) return;
  const k = e.key;
  if (k >= '1' && k <= '7') { S.ui.zoom = ZOOMS[Number(k) - 1][0]; S.ui.pk = null; render(); }
  else if (k === 'n' || k === 'N') { e.preventDefault(); $('#qa')?.focus(); }
  else if (k === 'r' || k === 'R') { e.preventDefault(); summarySheet(todayK()); }
  else if (k === 'd' || k === 'D') { e.preventDefault(); captureSheet(captureDest()); }
  else if (k === 't' || k === 'T') $('[data-act=today]')?.click();
  else if (k === '[' || k === ']') { const s = sources().map(x => x[0]); S.ui.src = s[(s.indexOf(S.ui.src) + (k === ']' ? 1 : s.length - 1)) % s.length]; S.ui.panelView = 'list'; render(); }
  else if (k === '\\') { S.ui.panelHidden = !S.ui.panelHidden; render(); }
});
document.addEventListener('focusout', (e) => { if (e.target.dataset?.addto && !e.target.value.trim()) setTimeout(() => { if (S.ui.adding === e.target.dataset.addto && !document.activeElement?.dataset?.addto) { S.ui.adding = null; render(); } }, 120); });
document.addEventListener('input', (e) => {
  if (e.target.id === 'q' || e.target.id === 'mq') { // search as you type; keep the caret where it was across the re-render
    const id = e.target.id, v = e.target.value, pos = e.target.selectionStart; S.ui.q = v; render(); const el = $('#' + id); if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch {} } return; }
  if (e.target.id === 'qc-title' && S.ui.draft) { S.ui.draft.title = e.target.value; const t = $('.draft .t'); if (t) t.innerHTML = esc(e.target.value) || '<span class="muted">(No title)</span>'; } });
// Save the quick-create draft as a task or meeting; returns the new id.
function saveDraft() {
  const D = S.ui.draft; if (!D) return null;
  const id = rid('t_'), title = D.title.trim() || '(No title)';
  put('task', id, { title, notes: '', board: '', section: '', pri: 'normal', status: 'open', dur: D.dur, when: D.k, at: D.at, kind: D.kind || '', color: D.kind === 'meeting' ? (D.color || '') : '', rolls: 0, src: 'typed', created: new Date().toISOString(), o: Date.now() });
  return id;
}

// ── drag and drop (mouse, pen, touch) ─────────────────────────
// Mouse: press and move 5px. Touch: hold 350 ms. On a phone the week rail slides in from the right.
let drag = null, press = null, suppressClick = false;
document.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || sheetState) return;
  // Desktop Hours grid, Google Calendar style: press on empty space and drag down to draw a new block,
  // drag the draft to move it, or its bottom edge to resize it. A plain click makes a 30-minute block.
  const grid = e.target.closest('.d .grid[data-drop^="slot:"]');
  if (grid && !e.target.closest('.card[data-tid],.appt,.qc,.nowline') && e.pointerType !== 'touch') { startDraw(e, grid); return; }
  const card = e.target.closest('.card[data-tid]'); if (!card || e.target.closest('input,.ck')) return;
  const resize = e.target.closest('[data-resize]');
  press = { id: card.dataset.tid, card, x: e.clientX, y: e.clientY, type: e.pointerType, resize: !!resize, pid: e.pointerId, t: Date.now(), swipe: null };
  if (e.pointerType !== 'mouse') press.timer = setTimeout(() => { if (press && !press.swipe) startDrag(e.clientX, e.clientY); }, 350);
});
// Phone: a horizontal swipe on the week strip moves a week, on the hours screen a day (cards keep their own swipe).
let hswipe = null;
document.addEventListener('pointerdown', (e) => {
  if (isDesk() || sheetState || e.pointerType === 'mouse' || e.target.closest('.card[data-tid],input,button')) return;
  const z = e.target.closest('[data-swipe]'); if (!z) return; hswipe = { x: e.clientX, y: e.clientY, pid: e.pointerId, kind: z.dataset.swipe };
}, { passive: true });
document.addEventListener('pointermove', (e) => {
  if (!hswipe || e.pointerId !== hswipe.pid) return; const dx = e.clientX - hswipe.x, dy = e.clientY - hswipe.y;
  if (Math.abs(dy) > 24 && Math.abs(dy) > Math.abs(dx)) { hswipe = null; return; }
  if (Math.abs(dx) > 56 && Math.abs(dx) > Math.abs(dy) * 1.5) { const n = dx < 0 ? 1 : -1, kind = hswipe.kind; hswipe = null;
    S.ui.mday = addDays(S.ui.mday, kind === 'week' ? 7 * n : n); S.ui.mjump = true; render(); const mm = $('.mm'); if (mm) { mm.classList.add(n > 0 ? 'in-l' : 'in-r'); setTimeout(() => mm.classList.remove('in-l', 'in-r'), 240); } navigator.vibrate?.(8); }
}, { passive: true });
document.addEventListener('pointerup', () => { hswipe = null; }); document.addEventListener('pointercancel', () => { hswipe = null; });
document.addEventListener('pointermove', (e) => {
  if (drag) { e.preventDefault(); moveDrag(e.clientX, e.clientY); return; }
  if (!press || e.pointerId !== press.pid) return;
  const dx = e.clientX - press.x, dy = e.clientY - press.y;
  if (press.type === 'mouse') { if (Math.hypot(dx, dy) > 5) { if (press.resize) startResize(e); else startDrag(e.clientX, e.clientY); } return; }
  // touch before the long press fires: horizontal = swipe, vertical = let the list scroll
  if (!press.swipe && Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.5 && !isDesk()) { press.swipe = true; clearTimeout(press.timer); press.card.classList.add('swiping'); }
  if (press.swipe) { swipeMove(dx); return; }
  if (Math.hypot(dx, dy) > 10) { clearTimeout(press.timer); press = null; }
});
document.addEventListener('pointerup', (e) => { if (drag) { endDrag(e.clientX, e.clientY); return; } if (press?.swipe) swipeEnd(e.clientX - press.x); if (press) clearTimeout(press.timer); press = null; });
document.addEventListener('pointercancel', () => { if (drag) cancelDrag(); if (press?.swipe) swipeEnd(0); if (press) clearTimeout(press.timer); press = null; });
document.addEventListener('touchmove', (e) => { if (drag || press?.swipe) e.preventDefault(); }, { passive: false });
// Desktop right-click menu on a task card: the common actions without opening the sheet.
function closeMenu() { $('.ctxmenu')?.remove(); }
document.addEventListener('contextmenu', (e) => {
  const card = e.target.closest('.card[data-tid]'); if (!card) return; e.preventDefault();
  if (!isDesk() || e.pointerType === 'touch') return;
  const t = S.tasks.get(card.dataset.tid); if (!t) return; closeMenu();
  const done = t.status === 'done', mtg = t.kind === 'meeting', tk = todayK();
  const item = (act, label, extra = '') => `<button data-act="${act}" data-tid="${t.id}" ${extra}>${label}</button>`;
  const items = [
    item('cm-done', done ? 'Mark not done' : 'Mark done'),
    item('cm-open', 'Open…'),
    !done && !mtg ? item('cm-timer', t.timer ? 'Stop timer' : 'Start timer') : '',
    '<hr>',
    t.when !== tk ? item('cm-when', 'Today', `data-w="${tk}"`) : '', t.when !== addDays(tk, 1) ? item('cm-when', 'Tomorrow', `data-w="${addDays(tk, 1)}"`) : '',
    t.when !== isoWeek(tk) ? item('cm-when', 'This week', `data-w="${isoWeek(tk)}"`) : '', t.when ? item('cm-when', 'Unschedule', 'data-w=""') : '',
    mtg ? '' : '<hr>' + item('cm-pri', t.pri === 'target' ? 'Remove target' : 'Make target', `data-p="${t.pri === 'target' ? 'normal' : 'target'}"`) + item('cm-pri', t.pri === 'someday' ? 'Not someday' : 'Someday', `data-p="${t.pri === 'someday' ? 'normal' : 'someday'}"`),
    '<hr>', item('cm-delete', 'Delete', 'class="danger"')].filter(Boolean).join('');
  document.body.insertAdjacentHTML('beforeend', `<div class="ctxmenu" role="menu">${items}</div>`);
  const m = $('.ctxmenu'), r = m.getBoundingClientRect();
  m.style.left = Math.min(e.clientX, innerWidth - r.width - 8) + 'px'; m.style.top = Math.min(e.clientY, innerHeight - r.height - 8) + 'px';
});
document.addEventListener('pointerdown', (e) => { if (!e.target.closest('.ctxmenu')) closeMenu(); }, true);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); }, true);
window.addEventListener('blur', closeMenu); window.addEventListener('scroll', closeMenu, true);

function swipeMove(dx) {
  const c = press.card; c.style.transform = `translateX(${dx}px)`;
  let hint = c.querySelector('.swipe-hint'); if (!hint) { c.insertAdjacentHTML('afterbegin', '<div class="swipe-hint"></div>'); hint = c.querySelector('.swipe-hint'); }
  hint.style.background = dx > 0 ? 'var(--ok)' : 'var(--ink)'; hint.style.justifyContent = dx > 0 ? 'flex-start' : 'flex-end';
  hint.style.transform = `translateX(${-dx}px)`; hint.style.width = '100%'; hint.style.zIndex = -1;
  hint.textContent = dx > 0 ? (S.tasks.get(press.id)?.status === 'done' ? 'Not done' : 'Done') : 'Schedule';
  c.style.zIndex = 1;
}
function swipeEnd(dx) {
  const c = press.card, id = press.id; suppressClick = Math.abs(dx) > 12;
  setTimeout(() => { suppressClick = false; }, 50);
  if (Math.abs(dx) > 80 && !S.ui.hintSeen) { S.ui.hintSeen = true; store.set('hintSeen', true); } // they know how to swipe now
  if (dx > 80) { navigator.vibrate?.(15); toggleDone(id); return; }
  c.style.transition = 'transform 150ms ease-out'; c.style.transform = ''; setTimeout(() => { c.querySelector('.swipe-hint')?.remove(); c.classList.remove('swiping'); c.style.transition = ''; }, 160);
  if (dx < -80) taskSheet(id);
}
function startDrag(x, y) {
  const p = press; if (!p) return; press = null; clearTimeout(p.timer);
  const r = p.card.getBoundingClientRect();
  const ghost = p.card.cloneNode(true); ghost.classList.add('ghost'); ghost.style.width = (isDesk() ? r.width : Math.min(r.width, innerWidth * 0.7)) + 'px'; ghost.style.height = (isDesk() ? Math.min(r.height, 80) : 44) + 'px';
  ghost.style.left = '0px'; ghost.style.top = '0px'; ghost.style.position = 'fixed'; ghost.style.right = 'auto';
  (isDesk() ? document.body : $('.m')).appendChild(ghost);
  p.card.classList.add('dragging'); document.body.classList.add('is-dragging');
  drag = { id: p.id, card: p.card, ghost, ox: x - r.left, oy: y - r.top, over: null, rail: null };
  if (!isDesk()) { navigator.vibrate?.(20); const t = S.tasks.get(p.id); drag.rail = openDayDrop(kindOf(t?.when) === 'day' && t.when >= todayK() ? t.when : todayK()); }
  moveDrag(x, y);
}
// Phone drag: holding a task opens a full-screen day. Drop on an hour; hold at the right or left edge to change day.
const MHPX = 52, MH0 = 6, MH1 = 24;
function openDayDrop(k) {
  const el = document.createElement('div'); el.className = 'daydrop'; el.setAttribute('aria-hidden', 'true');
  $('.m').appendChild(el); renderDayDrop(el, k);
  const sc = el.querySelector('.dd-scroll'), n = new Date();
  const startH = k === todayK() ? n.getHours() - 1 : toMin(S.prefs.dayStart) / 60 - 1;
  sc.scrollTop = Math.max(0, (startH - MH0) * MHPX);
  requestAnimationFrame(() => el.classList.add('in')); return el;
}
function renderDayDrop(el, k) {
  const keep = el.querySelector('.dd-scroll')?.scrollTop;
  const d = parseD(k), rel = relDay(k);
  const items = placedOn(k).filter(t => t.at && (!drag || t.id !== drag.id));
  let rows = ''; for (let h = MH0; h < MH1; h++) rows += `<div class="dd-h" style="height:${MHPX}px"><span>${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}</span></div>`;
  const blocks = items.map(t => { const top = (toMin(t.at) / 60 - MH0) * MHPX, ht = Math.max(20, (t.dur || 30) / 60 * MHPX - 2);
    return `<div class="dd-b ${t.kind === 'meeting' ? 'mt' : ''}" style="${colorStyle(t)}top:${top}px;height:${ht}px">${esc(t.title)} · ${clock(t.at)}</div>`; }).join('');
  let now = ''; if (k === todayK()) { const n = new Date(), m = n.getHours() * 60 + n.getMinutes(); now = `<div class="nowline" style="top:${(m / 60 - MH0) * MHPX}px"></div>`; }
  el.innerHTML = `<div class="dd-top"><div class="dd-edge">‹</div><div class="dd-title"><b>${DOWL[d.getDay()]}, ${MON[d.getMonth()]} ${d.getDate()}</b>${rel ? ` <span class="pill">${rel}</span>` : ''}<small>${loadText(k)} · hold at an edge to change day</small></div><div class="dd-edge">›</div></div>
<div class="dd-strip"><div class="slot" data-drop="day:${k}">Anytime ${esc(rel || dayShort(k))}</div><div class="slot" data-drop="list">Unschedule</div></div>
<div class="dd-scroll"><div class="dd-wrap"><div class="dd-rows">${rows}</div><div class="dd-grid" data-drop="slot:${k}" data-hpx="${MHPX}" data-h0="${MH0}" style="height:${(MH1 - MH0) * MHPX}px">${blocks}${now}</div></div></div>`;
  el.dataset.k = k;
  if (keep != null) el.querySelector('.dd-scroll').scrollTop = keep;
}
function dropAt(x, y) {
  const el = document.elementFromPoint(x, y); if (!el) return null;
  const t = el.closest('[data-drop]'); if (!t) return null;
  if (drag?.rail && !t.closest('.daydrop')) return null; // on a phone, only the full-screen day takes drops
  return t;
}
let autoScroll = null;
function moveDrag(x, y) {
  const d = drag; const gx = d.rail ? Math.min(x - d.ox, x - d.ghost.offsetWidth * 0.55) : x - d.ox, gy = d.rail ? y - d.ghost.offsetHeight - 18 : y - d.oy;
  d.ghost.style.transform = `translate(${gx}px, ${gy}px) rotate(-1.5deg)`;
  const t = dropAt(x, y);
  if (d.over !== t) { d.over?.classList.remove('over'); t?.classList.add('over'); if (d.over?.dataset.drop?.startsWith('slot')) $('.slotline')?.remove(); d.over = t; }
  if (t?.dataset.drop.startsWith('slot:')) {
    const r = t.getBoundingClientRect(), dur = S.tasks.get(d.id)?.dur || 30;
    const hpx = Number(t.dataset.hpx) || HPX, h0 = t.dataset.h0 != null ? Number(t.dataset.h0) : H0(), yy = d.rail ? y - 10 : y - d.oy + 6;
    let m = Math.round(((yy - r.top) / hpx * 60 + h0 * 60) / 15) * 15; m = Math.max(0, Math.min(24 * 60 - dur, m)); d.slot = fromMin(m);
    let line = t.querySelector('.slotline'); if (!line) { t.insertAdjacentHTML('beforeend', '<div class="slotline"><span></span></div>'); line = t.querySelector('.slotline'); }
    line.style.top = ((m / 60 - h0) * hpx) + 'px'; line.firstElementChild.textContent = clock(d.slot);
  }
  // phone: edges change the day, top/bottom scroll the hours
  if (d.rail) {
    clearInterval(autoScroll);
    const dir = x > innerWidth - 34 ? 1 : x < 34 ? -1 : 0;
    if (dir !== d.edgeDir) { clearTimeout(d.edgeTimer); d.edgeDir = dir;
      if (dir) d.edgeTimer = setTimeout(function flip() { if (!drag || drag.edgeDir !== dir) return; const nk = addDays(d.rail.dataset.k, dir); if (dir < 0 && nk < todayK()) return;
        renderDayDrop(d.rail, nk); d.over = null; navigator.vibrate?.(8); d.edgeTimer = setTimeout(flip, 900); }, 550); }
    const sc = d.rail.querySelector('.dd-scroll'), r = sc.getBoundingClientRect(); let vy = 0;
    if (y > r.bottom - 60) vy = 10; else if (y < r.top + 50 && y > r.top - 40) vy = -10;
    if (vy) autoScroll = setInterval(() => { sc.scrollTop += vy; }, 16);
    return;
  }
  // auto-scroll the timeline near its edges
  const tl = $('.tl'); clearInterval(autoScroll);
  if (tl && isDesk()) { const r = tl.getBoundingClientRect(); let vx = 0, vy = 0;
    if (x > r.right - 60 && x < r.right + 10) vx = 14; else if (x < r.left + 40 && x > r.left - 10) vx = -14;
    if (S.ui.zoom === 'hours') { if (y > r.bottom - 50) vy = 12; else if (y < r.top + 40 && y > r.top - 10) vy = -12; }
    if (vx || vy) autoScroll = setInterval(() => { tl.scrollLeft += vx; tl.scrollTop += vy; }, 16); }
}
function cleanupDrag() {
  clearInterval(autoScroll); const d = drag; drag = null;
  d.ghost.remove(); d.card.classList.remove('dragging'); d.over?.classList.remove('over'); $('.slotline')?.remove(); document.body.classList.remove('is-dragging');
  clearTimeout(d.edgeTimer); if (d.rail) { d.rail.classList.remove('in'); setTimeout(() => d.rail.remove(), 200); }
  suppressClick = true; setTimeout(() => { suppressClick = false; }, 50);
  return d;
}
function cancelDrag() { cleanupDrag(); }
function endDrag(x, y) {
  const d = cleanupDrag(), t = d.over; if (!t) return;
  const [kind, val] = t.dataset.drop.split(/:(.*)/s), task = S.tasks.get(d.id); if (!task) return;
  if (!isDesk() && (kind === 'day' || kind === 'slot')) { if (S.ui.mtab !== 'hours' || S.ui.mday !== val) { S.ui.mtab = 'hours'; S.ui.mday = val; S.ui.mjump = true; S.ui.board = null; } }
  if (kind === 'day') { if (task.when === val && kindOf(task.when) === 'day' && !task.at) { render(); return; } place(d.id, val, kindOf(task.when) === 'day' && task.when !== val ? task.at : '', null); }
  else if (kind === 'slot') place(d.id, val, d.slot, `${dayShort(val)} ${clockAP(d.slot)}`);
  if (!isDesk() && (kind === 'day' || kind === 'slot')) $(`.m .mm [data-tid="${d.id}"]`)?.scrollIntoView({ block: 'center' });
  else if (kind === 'period') place(d.id, val, '');
  else if (kind === 'list') { if (task.when) place(d.id, null, ''); }
  else if (kind === 'board') { if ((task.board || '') !== val) { put('task', d.id, { board: val, section: '' }); render(); toast(`Moved to ${val ? S.boards.get(val)?.name : 'Inbox'}`, true); } }
  if (navigator.vibrate && d.rail) navigator.vibrate(10);
}
function startDraw(e, grid) {
  e.preventDefault();
  const k = grid.dataset.drop.slice(5), hpx = Number(grid.dataset.hpx), h0 = Number(grid.dataset.h0), r = grid.getBoundingClientRect();
  const minAt = (y) => Math.max(0, Math.min(24 * 60, Math.round(((y - r.top) / hpx * 60 + h0 * 60) / 15) * 15));
  const onDraft = e.target.closest('.draft'), resize = !!e.target.closest('[data-draftresize]');
  // A popover is open and the press is elsewhere: that press only dismisses it (Google Calendar does the same).
  if (S.ui.draft && !onDraft) { S.ui.draft = null; render(); suppressClick = true; setTimeout(() => { suppressClick = false; }, 50); return; }
  const D0 = S.ui.draft && S.ui.draft.k === k ? { ...S.ui.draft } : null;
  const m0 = minAt(e.clientY), y0 = e.clientY; let moved = false;
  // Fresh press on empty space: a new draft starts here (replaces any open one).
  if (!onDraft) S.ui.draft = { k, at: fromMin(Math.min(m0, 24 * 60 - 30)), dur: 30, kind: S.ui.draft?.kind || '', color: S.ui.draft?.color || '', title: '', durSet: false };
  const D = S.ui.draft;
  let el = grid.querySelector('.draft');
  const paint = () => { if (!el) { grid.insertAdjacentHTML('beforeend', `<div class="card draft ${D.kind === 'meeting' ? 'meeting' : ''}"><div class="body"><span class="t">${esc(D.title) || '<span class="muted">(No title)</span>'}</span></div><span class="meta"></span></div>`); el = grid.querySelector('.draft'); }
    el.style.top = ((toMin(D.at) / 60 - h0) * hpx + 1) + 'px'; el.style.height = Math.max(24, D.dur / 60 * hpx - 2) + 'px';
    el.querySelector('.meta').textContent = `${clock(D.at)} – ${clock(fromMin(toMin(D.at) + D.dur))}`; };
  grid.querySelector('.qc')?.remove(); if (!onDraft) paint();
  document.body.classList.add('is-dragging');
  const mv = (ev) => {
    if (!moved && Math.abs(ev.clientY - y0) < 4) return; moved = true;
    const m = minAt(ev.clientY);
    if (resize) { const want = Math.round((D0.dur + (ev.clientY - y0) / hpx * 60) / 15) * 15; D.dur = Math.max(15, Math.min(24 * 60 - toMin(D0.at), want)); D.durSet = true; }
    else if (onDraft) { let a = toMin(D0.at) + (m - m0); a = Math.max(0, Math.min(24 * 60 - D0.dur, a)); D.at = fromMin(a); }
    else { const a = Math.min(m0, m), b = Math.max(m0, m); D.at = fromMin(Math.min(a, 24 * 60 - 15)); D.dur = Math.max(15, b - a); D.durSet = D.dur !== 30; }
    paint();
  };
  const up = () => { document.removeEventListener('pointermove', mv); document.removeEventListener('pointerup', up); document.body.classList.remove('is-dragging');
    suppressClick = true; setTimeout(() => { suppressClick = false; }, 50);
    render(); const inp = $('#qc-title'); if (inp) { inp.focus(); if (onDraft && !moved) inp.select(); } };
  document.addEventListener('pointermove', mv); document.addEventListener('pointerup', up);
}
function startResize(e) {
  const p = press; press = null; const t = S.tasks.get(p.id); if (!t) return;
  const startDur = t.dur || 30, y0 = p.y; let cur = startDur; document.body.classList.add('is-dragging');
  const mv = (ev) => { cur = Math.max(15, Math.round((startDur + (ev.clientY - y0) / HPX * 60) / 15) * 15); p.card.style.height = (cur / 60 * HPX - 2) + 'px'; p.card.querySelector('.meta').textContent = `${clock(t.at)} – ${clock(fromMin(toMin(t.at) + cur))}`; };
  const up = () => { document.removeEventListener('pointermove', mv); document.removeEventListener('pointerup', up); document.body.classList.remove('is-dragging');
    suppressClick = true; setTimeout(() => { suppressClick = false; }, 50); if (cur !== startDur) { put('task', p.id, { dur: cur }); toast(`${fmtDur(cur)}`, true); } render(); };
  document.addEventListener('pointermove', mv); document.addEventListener('pointerup', up);
}

// ── start ─────────────────────────────────────────────────────
let lastDay = todayK();
async function start() {
  try { await loadAll(); } catch (err) { console.error('local storage unavailable', err); }
  ensureDefaults();
  try { const zone = Intl.DateTimeFormat().resolvedOptions().timeZone; if (zone && S.prefs.tz !== zone) put('pref', 'main', { tz: zone }, { quiet: true }); } catch {}
  applyTheme(); render(); whoami();
  matchMedia('(min-width: 900px)').addEventListener('change', () => { closeSheet(); render(); });
  addEventListener('online', () => { render(); syncNow(); }); addEventListener('offline', render);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { if (!sheetState && !drag && !S.ui.draft) reflowTick(); if (todayK() !== lastDay) { lastDay = todayK(); S.ui.anchor = addDays(lastDay, -1); S.ui.hday = lastDay; render(); } syncNow(); } });
  setInterval(() => { if (todayK() !== lastDay) { lastDay = todayK(); S.ui.anchor = addDays(lastDay, -1); S.ui.hday = lastDay; } if (!sheetState && !drag && !press && !S.ui.draft && !document.activeElement?.matches('input,textarea')) { reflowTick(); render(); } }, 60000);
  setInterval(syncNow, 60000);
  if ('serviceWorker' in navigator && location.hostname !== 'localhost') navigator.serviceWorker.register('/sw.js').catch(() => {});
}
start();
