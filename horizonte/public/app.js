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
  left: '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 6l-6 6 6 6"/></svg>',
  right: '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 6l6 6-6 6"/></svg>',
  plus: (s = 22, w = 2) => `<svg aria-hidden="true" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}"><path d="M12 5v14M5 12h14"/></svg>`,
  minus: '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14"/></svg>',
  star: (s = 14) => `<svg class="star" role="img" aria-label="Target" width="${s}" height="${s}" viewBox="0 0 24 24" fill="var(--accent)"><path d="M12 2l3 6.5 7 .9-5.1 4.9 1.3 7L12 17.8 5.8 21.3l1.3-7L2 9.4l7-.9z"/></svg>`,
  lock: (s = 12) => `<svg aria-hidden="true" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>`,
  today: (w) => `<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}"><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>`,
  plan: (w) => `<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/></svg>`,
  boards: (w) => `<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}"><rect x="4" y="4" width="6" height="16" rx="1.5"/><rect x="14" y="4" width="6" height="10" rx="1.5"/></svg>`,
  inbox: (w) => `<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}"><path d="M4 13l3-8h10l3 8v6H4z"/><path d="M4 13h5l1 2h4l1-2h5"/></svg>`,
  chev: '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 6l6 6-6 6"/></svg>',
  down: '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>',
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
const clockAP = (t) => { const n = toMin(t), h = Math.floor(n / 60) % 24; return `${h % 12 || 12}:${pad(n % 60)} ${h < 12 ? 'AM' : 'PM'}`; };

// ── data ──────────────────────────────────────────────────────
const S = {
  tasks: new Map(), boards: new Map(),
  prefs: { dayStart: '09:00', dayEnd: '18:00', cap: 3 },
  outbox: [], cursor: 0, me: null, setup: true, net: 'idle', lastSync: 0, undo: [],
  ui: Object.assign({ zoom: 'days', anchor: null, hday: null, src: 'inbox', sort: 'manual', mtab: 'today', mzoom: 'days', manchor: null, board: null, open: {} }, store.get('ui', {})),
};
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
  try { const r = await fetch('/api/me', { cache: 'no-store' }); const j = await r.json(); S.me = j.email || null; S.setup = j.setup !== false; }
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
function sortList(list, mode = 'manual') {
  const by = { manual: order, priority: (a, b) => priRank[a.pri || 'normal'] - priRank[b.pri || 'normal'] || order(a, b),
    age: (a, b) => String(a.created).localeCompare(String(b.created)), duration: (a, b) => (a.dur || 30) - (b.dur || 30) || order(a, b) }[mode] || order;
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
  const targets = sortList(all.filter(t => t.pri === 'target'));
  const timed = sortList(open.filter(t => t.at && t.pri !== 'target'), 'manual').sort((a, b) => toMin(a.at) - toMin(b.at));
  const rest = sortList(open.filter(t => !t.at && t.pri !== 'target'), 'priority');
  return { all, open, done, targets, timed, rest, doneNonTarget: done.filter(t => t.pri !== 'target') };
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
function addLines(text, fields) {
  const lines = String(text).split(/\n+/).map(s => s.replace(/^\s*[-*•]\s*/, '').trim()).filter(Boolean);
  batch(g => lines.forEach((title, i) => { const id = rid('t_');
    put('task', id, { title, notes: '', board: '', section: '', pri: 'normal', status: 'open', dur: 30, when: null, at: '', rolls: 0, src: 'typed', created: new Date().toISOString(), o: Date.now() + i, ...fields }, { group: g }); }));
  return lines.length;
}
function toggleDone(id) {
  const t = S.tasks.get(id); if (!t) return;
  const done = t.status !== 'done';
  put('task', id, { status: done ? 'done' : 'open', doneAt: done ? new Date().toISOString() : null });
  render(); if (done) toast('Done', true);
}
function place(id, when, at, label) {
  const t = S.tasks.get(id); if (!t) return;
  const f = { when: when || null, at: at || '' };
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
function cardHTML(t, opts = {}) {
  const pri = t.pri || 'normal', done = t.status === 'done';
  const cls = ['card', pri, done ? 'done' : '', opts.sched ? 'sched' : ''].join(' ');
  const stuck = !done && (t.rolls || 0) >= 3 ? `<span class="sub">Pushed ${t.rolls} times · stuck</span>` : '';
  const meta = opts.meta ?? (done ? '' : pri === 'someday' && !t.when ? 'Someday' : fmtDur(t.dur || 30));
  return `<div class="${cls}" data-tid="${t.id}" style="${opts.style || ''}">
<label class="ck"><input type="checkbox" ${done ? 'checked' : ''} aria-label="Done: ${esc(t.title)}" data-act="done"></label>
<div class="body" data-act="open"><span class="t">${esc(t.title) || '<span class="muted">Untitled</span>'}</span>${stuck}</div>
${pri === 'target' && !done ? I.star(opts.mobile ? 16 : 14) : ''}${meta ? `<span class="meta">${esc(meta)}</span>` : ''}</div>`;
}
function loadText(k) { return `${fmtDur(dayLoad(k))} of ${fmtDur(workMin())}`; }
function meterHTML(k) {
  const pct = Math.round(dayLoad(k) / workMin() * 100);
  return `<div class="meter ${pct >= 125 ? 'red' : pct >= 100 ? 'amber' : ''}" role="img" aria-label="Day is ${pct} percent full"><i style="width:${Math.min(100, pct)}%"></i></div>`;
}
function saveUI() { store.set('ui', S.ui); }

let lastLayout = null;
function render() {
  const desk = isDesk();
  if (!S.ui.anchor) S.ui.anchor = addDays(todayK(), -1);
  if (!S.ui.hday) S.ui.hday = todayK();
  if (!S.ui.manchor) S.ui.manchor = todayK();
  const app = $('#app');
  const keep = document.activeElement && document.activeElement.id && app.contains(document.activeElement) ? { id: document.activeElement.id, v: document.activeElement.value } : null;
  const tl = $('.tl'), tlScroll = tl ? [tl.scrollLeft, tl.scrollTop] : null, mm = $('.mm'), mScroll = mm ? mm.scrollTop : null, pnl = $('.panel'), pScroll = pnl ? pnl.scrollTop : 0;
  app.innerHTML = desk ? renderDesk() : renderMobile();
  if (desk && lastLayout === 'desk' && tlScroll) { const n = $('.tl'); n.scrollLeft = tlScroll[0]; n.scrollTop = tlScroll[1]; }
  if (desk && pnl) { const n = $('.panel'); if (n) n.scrollTop = pScroll; }
  if (!desk && lastLayout === 'mob' && mScroll != null && $('.mm')) $('.mm').scrollTop = mScroll;
  if (desk && S.ui.zoom === 'hours' && !tlScroll) scrollHoursToNow();
  lastLayout = desk ? 'desk' : 'mob';
  if (keep) { const el = document.getElementById(keep.id); if (el) { el.focus(); if ('value' in el && keep.v != null) el.value = keep.v; } }
  paintSync(); saveUI();
}

// ── rendering: desktop ────────────────────────────────────────
const ZOOMS = [['hours', 'Hours'], ['days', 'Days'], ['weeks', 'Weeks'], ['months', 'Months'], ['quarters', 'Quarters'], ['years', 'Years']];
function deskTitle() {
  const z = S.ui.zoom;
  if (z === 'hours') { const d = parseD(S.ui.hday); return `${DOWL[d.getDay()]}, ${MONL[d.getMonth()]} ${d.getDate()}`; }
  if (z === 'days') { const d = parseD(addDays(S.ui.anchor, 1)); return `${MONL[d.getMonth()]} ${d.getFullYear()}`; }
  return String(parseD(periodRange(S.ui.pk || todayK())[0]).getFullYear());
}
function renderDesk() {
  return `<div class="d">
<header class="top">
<button class="brand" data-act="settings" title="Settings">Horizonte</button>
<nav class="seg" aria-label="Zoom level">${ZOOMS.map(([z, l], i) => `<button aria-pressed="${S.ui.zoom === z}" data-zoom="${z}" title="${l} (${i + 1})">${l}</button>`).join('')}</nav>
<div class="steps"><button class="btn icon" aria-label="Earlier" data-act="prev">${I.left}</button><button class="btn" data-act="today">Today</button><button class="btn icon" aria-label="Later" data-act="next">${I.right}</button></div>
<div class="title">${esc(deskTitle())}</div>
<div class="right"><button data-sync class="dot" data-act="settings"></button></div>
</header>
<div class="main">${renderPanel()}<main class="tl" aria-label="Timeline">${renderTimeline()}</main></div></div>`;
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
  const src = S.ui.src, srcs = sources();
  if (!srcs.some(s => s[0] === src)) S.ui.src = 'inbox';
  const board = S.ui.src.startsWith('b:') ? S.boards.get(S.ui.src.slice(2)) : null;
  const addLabel = board ? `Add to ${board.name}` : S.ui.src === 'week' ? 'Add to this week' : S.ui.src === 'month' ? 'Add to this month' : 'Add to Inbox';
  const od = overdueTasks().filter(t => t.pri === 'target').length;
  return `<aside class="panel" aria-label="Task lists" data-drop="list">
${od ? `<button class="banner" data-act="review"><span>${od} unfinished target${od > 1 ? 's' : ''} from earlier days</span>Review</button>` : ''}
<div class="chips">${srcs.map(([k, l]) => `<button class="chip" aria-pressed="${S.ui.src === k}" data-src="${k}" ${k.startsWith('b:') ? `data-drop="board:${k.slice(2)}"` : k === 'inbox' ? 'data-drop="board:"' : ''}>${esc(l)}</button>`).join('')}<button class="chip add" data-act="newboard" aria-label="New board">+ Board</button></div>
<div class="qa"><label for="qa">${esc(addLabel)}</label><input id="qa" type="text" placeholder="Type a task and press Enter" autocomplete="off" enterkeyhint="done"></div>
<div class="hint"><span>Drag onto any day, hour or horizon</span><button class="link" data-act="sort">Sort: ${S.ui.sort}</button></div>
${renderPanelList(board)}
${board ? `<div class="hint"><span></span><button class="link" data-act="editboard" data-bid="${board.id}">Edit board</button></div>` : ''}
</aside>`;
}
function renderPanelList(board) {
  const sort = S.ui.sort, src = S.ui.src;
  const stack = (list, sched, key = src) => `<div class="stack">${capped('p' + key, list, t => cardHTML(t, sched ? { sched: !!t.when && isOpen(t), meta: isOpen(t) && t.when ? whenText(t) : undefined } : {}))}</div>`;
  if (board) {
    const all = boardTasks(board.id), open = all.filter(isOpen), done = all.filter(t => !isOpen(t));
    const secs = [''].concat(board.sections || []);
    let html = '';
    for (const s of secs) {
      const list = sortList(open.filter(t => (t.section || '') === s || (s === '' && t.section && !(board.sections || []).includes(t.section))), sort);
      if (s === '' && !list.length) continue;
      if (s) html += `<div class="eyebrow">${esc(s)} · ${list.length}</div>`;
      html += stack(list, true, board.id + s);
    }
    if (!open.length) html += `<div class="empty">Nothing on this board. Type above to add.</div>`;
    if (done.length) html += doneToggle('b' + board.id, done);
    return html;
  }
  let list = src === 'overdue' ? overdueTasks() : src === 'week' ? placedOn(isoWeek(todayK())).filter(isOpen) : src === 'month' ? placedOn(periodOf('month', todayK())).filter(isOpen) : inboxTasks();
  list = sortList(list, sort);
  if (!list.length) return `<div class="empty">${src === 'inbox' ? 'Inbox is empty.' : 'Nothing here.'}</div>`;
  return stack(list, src === 'overdue');
}
function doneToggle(key, done) {
  const open = S.ui.open[key];
  return `<button class="link" style="align-self:flex-start;text-decoration:none;color:var(--ink-2)" data-act="toggle" data-key="${key}">Done · ${done.length} ${open ? '▴' : '▾'}</button>${open ? `<div class="stack">${sortList(done).map(t => cardHTML(t)).join('')}</div>` : ''}`;
}
function renderTimeline() {
  const z = S.ui.zoom;
  if (z === 'hours') return renderHours();
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
    head = `<div class="head"><div><b>${label}</b> ${rel ? `<span class="small">${rel}</span>` : ''}</div>${open ? `<span class="pill warn">${open} open</span>` : ''}</div>${tg}`;
    const body = [...P.open].sort(order).map(x => cardHTML(x)).join('');
    const doneList = P.done;
    return `<section class="col past dropcol" data-drop="day:${k}" aria-label="${label}">${head}${body}${doneList.length ? doneToggle('d' + k, doneList) : ''}<div class="dropzone">Drop to schedule on ${label}</div></section>`;
  }
  head = `<div class="head"><div><b>${label}</b>${today ? ' <span class="pill">Today</span>' : ''}</div><span class="small">${loadText(k)}</span></div>${meterHTML(k)}`;
  let body = '';
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
  const heads = days.map(k => { const P = dayParts(k), untimed = [...P.targets.filter(t => !t.at), ...P.rest].filter(isOpen);
    return `<div class="hcol dropcol" data-drop="day:${k}"><div class="head" style="display:flex;justify-content:space-between;align-items:center"><div><b>${dayShort(k)}</b>${k === todayK() ? ' <span class="pill">Today</span>' : ''}</div><span class="small" style="font-size:12px;color:var(--ink-2)">${loadText(k)}</span></div>
<div class="small" style="font-size:12px;color:var(--ink-2)">No set time</div>${untimed.map(t => cardHTML(t)).join('') || ''}<div class="dropzone">Drop on ${dayShort(k)}, no time</div></div>`; }).join('');
  let gutter = ''; for (let h = h0; h < h1; h++) gutter += `<div style="height:${HPX}px">${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}</div>`;
  const grids = days.map(k => {
    const timed = placedOn(k).filter(t => t.at);
    const lanes = layoutLanes(timed);
    const cards = timed.map(t => { const top = (toMin(t.at) / 60 - h0) * HPX + 1, ht = Math.max(24, (t.dur || 30) / 60 * HPX - 2), L = lanes.get(t.id);
      const style = `top:${top}px;height:${ht}px;left:calc(6px + (100% - 12px) * ${L.i / L.n});right:auto;width:calc((100% - 12px) / ${L.n} - ${L.n > 1 ? 4 : 0}px)`;
      return cardHTML(t, { style, meta: `${clock(t.at)} – ${clock(fromMin(toMin(t.at) + (t.dur || 30)))}` }).replace('class="card', `class="card${ht < 34 ? ' short' : ''}`).replace(/<\/div>$/, '<div class="resize" data-resize="1"></div></div>'); }).join('');
    let now = ''; if (k === todayK()) { const n = new Date(), m = n.getHours() * 60 + n.getMinutes(); if (m >= h0 * 60 && m <= h1 * 60) now = `<div class="nowline" style="top:${(m / 60 - h0) * HPX}px"><span>Now ${clock(fromMin(m))}</span></div>`; }
    return `<div class="grid" data-drop="slot:${k}" style="height:${(h1 - h0) * HPX}px">${cards}${now}</div>`;
  }).join('');
  return `<div class="hours"><div class="hrow sticky"><div class="gutter"></div>${heads}</div><div class="hrow"><div class="gutter" aria-hidden="true">${gutter}</div>${grids}</div>
<div class="legend">Outlined cards are tasks: drag to move, drag the bottom edge to change length. Google Calendar appointments will show as solid blocks once Calendar is connected.</div></div>`;
}
function layoutLanes(list) { // side-by-side lanes for overlapping timed tasks
  const items = list.map(t => ({ id: t.id, s: toMin(t.at), e: toMin(t.at) + (t.dur || 30) })).sort((a, b) => a.s - b.s || b.e - a.e);
  const out = new Map(); let group = [], end = -1;
  const flush = () => { const lanes = []; for (const it of group) { let i = lanes.findIndex(e => e <= it.s); if (i < 0) { i = lanes.length; lanes.push(0); } lanes[i] = it.e; it.i = i; } for (const it of group) out.set(it.id, { i: it.i, n: lanes.length }); group = []; };
  for (const it of items) { if (it.s >= end && group.length) flush(); group.push(it); end = Math.max(end, it.e); }
  if (group.length) flush(); return out;
}
function scrollHoursToNow() { requestAnimationFrame(() => { const tl = $('.tl'); if (!tl) return; const n = new Date(); tl.scrollTop = Math.max(0, (n.getHours() - 1 - H0()) * HPX); }); }

// ── rendering: mobile ─────────────────────────────────────────
function renderMobile() {
  const tab = S.ui.mtab, n = inboxTasks().length;
  const main = tab === 'plan' ? mPlan() : tab === 'boards' ? mBoards() : tab === 'inbox' ? mInbox() : mToday();
  const btn = (k, label, icon) => `<button data-tab="${k}" ${tab === k ? 'aria-current="page"' : ''}>${icon(tab === k ? 2.2 : 2)}${label}</button>`;
  return `<div class="m">${main}
<nav class="tabs" aria-label="Main">${btn('today', 'Today', I.today)}${btn('plan', 'Plan', I.plan)}<button class="cap" aria-label="Capture a task" data-act="capture">${I.plus(26, 2.5)}</button>${btn('boards', 'Boards', I.boards)}${btn('inbox', `Inbox${n ? ' · ' + n : ''}`, I.inbox)}</nav></div>`;
}
const mcard = (t, o = {}) => cardHTML(t, { mobile: true, ...o });
function mToday() {
  const k = todayK(), d = parseD(k), P = dayParts(k), od = overdueTasks();
  const tgDone = P.targets.filter(t => !isOpen(t)).length;
  let body = '';
  if (od.length) body += `<button class="banner" data-act="review"><span>${od.length} unfinished from earlier days</span>Review</button>`;
  if (P.targets.length) body += `<div class="eyebrow">Targets · ${tgDone} of ${Math.max(P.targets.length, S.prefs.cap)}</div>` + P.targets.map(t => mcard(t, { meta: t.at && isOpen(t) ? clock(t.at) : '' })).join('');
  if (P.timed.length) body += `<div class="eyebrow ${P.targets.length ? 'gap' : ''}">Schedule</div>` + P.timed.map(t => mcard(t, { meta: clock(t.at) })).join('');
  if (P.rest.length) body += `<div class="eyebrow ${P.targets.length || P.timed.length ? 'gap' : ''}">${P.targets.length || P.timed.length ? "If there's time" : 'Today'}</div>` + P.rest.map(t => mcard(t)).join('');
  if (!P.all.length) body += `<div class="empty">Nothing planned today. Tap + to dump what's on your mind.</div>`;
  if (P.doneNonTarget.length) body += mDoneToggle('d' + k, P.doneNonTarget);
  const pct = Math.round(dayLoad(k) / workMin() * 100);
  return `<header class="mh"><div class="r1"><h1>${DOWL[d.getDay()]}, ${MON[d.getMonth()]} ${d.getDate()}</h1><button data-sync class="dot" data-act="settings"></button></div>
<div class="loadrow"><div>${fmtDur(dayLoad(k))} planned of ${fmtDur(workMin())}<div class="meter ${pct >= 125 ? 'red' : pct >= 100 ? 'amber' : ''}" role="img" aria-label="Day is ${pct} percent full"><i style="width:${Math.min(100, pct)}%"></i></div></div></div></header>
<main class="mm" data-list="today">${body}</main>`;
}
function mDoneToggle(key, done) {
  const open = S.ui.open[key];
  return `<button class="showmore" style="text-decoration:none;color:var(--ink-2)" data-act="toggle" data-key="${key}">Done · ${done.length} ${open ? '▴' : '▾'}</button>${open ? sortList(done).map(t => mcard(t)).join('') : ''}`;
}
const MZ = [['days', 'Days'], ['weeks', 'Weeks'], ['months', 'Months'], ['quarters', 'Qtrs'], ['years', 'Years']];
function mPlan() {
  const z = S.ui.mzoom; let body = '';
  const head = (k, label, extra) => `<div class="dayhead" data-drop="${kindOf(k) === 'day' ? 'day' : 'period'}:${k}"><b>${esc(label)}</b>${extra}<button class="plain" aria-label="Add to ${esc(label)}" data-act="capture" data-k="${k}">${I.plus(22)}</button></div>`;
  const items = (k, list) => { const key = 'm' + k, lim = S.ui.open[key] ? 999 : 3; let s = list.slice(0, lim).map(t => mcard(t, { meta: t.at && isOpen(t) ? clock(t.at) : undefined })).join('');
    if (list.length > lim) s += `<button class="showmore" data-act="toggle" data-key="${key}">Show ${list.length - lim} more</button>`; return s; };
  if (z === 'days') {
    for (let i = 0; i < 14; i++) { const k = addDays(S.ui.manchor, i), P = dayParts(k), list = [...P.timed, ...P.targets.filter(isOpen), ...P.rest];
      const isT = k === todayK(); const load = P.all.length ? loadText(k) : 'Nothing planned';
      body += head(k, dayShort(k), `${isT ? '<span class="pill">Today</span>' : ''}<span class="small">${load}</span>`) + items(k, list); }
  } else {
    const kind = { weeks: 'week', months: 'month', quarters: 'quarter', years: 'year' }[z];
    let k = periodOf(kind, S.ui.manchor);
    for (let i = 0; i < 8; i++, k = shiftPeriod(k, 1)) { const list = sortList(placedOn(k).filter(isOpen), 'priority');
      body += head(k, periodLabel(k, true), `<span class="small">${list.length ? list.length + ' task' + (list.length > 1 ? 's' : '') : 'Nothing placed'}</span>`) + items(k, list); }
  }
  return `<header class="mh" style="padding-bottom:10px"><div class="r1"><h1>Plan</h1><div style="display:flex;align-items:center;gap:4px">
<button class="ib" aria-label="Earlier" data-act="mprev">${I.left.replace(/16/g, '20')}</button><button class="tb" data-act="mtoday">Today</button><button class="ib" aria-label="Later" data-act="mnext">${I.right.replace(/16/g, '20')}</button></div></div>
<nav class="seg" aria-label="Zoom level">${MZ.map(([k, l]) => `<button aria-pressed="${z === k}" data-mzoom="${k}">${l}</button>`).join('')}</nav></header>
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
    if (!open.length) body += `<div class="empty">Nothing on this board yet.</div>`;
    if (done.length) body += mDoneToggle('b' + b.id, done);
    return `<header class="mh"><div class="r1"><button class="ib" aria-label="All boards" data-act="boardsback">${I.left.replace(/16/g, '20')}</button><h1 style="flex:1">${esc(b.name)}</h1>
<button class="plain" aria-label="Edit board" data-act="editboard" data-bid="${b.id}">•••</button><button class="ib" aria-label="Add to ${esc(b.name)}" data-act="capture" data-board="${b.id}">${I.plus(20)}</button></div></header>
<main class="mm" data-list="board">${body}<div class="empty" style="margin-top:12px">Tip: hold a task, then drag it right onto a day.</div></main>`;
  }
  const rows = boardsSorted().map(x => `<button class="rowlink" data-act="openboard" data-bid="${x.id}"><span>${esc(x.name)}</span><span class="n">${boardTasks(x.id).filter(isOpen).length}</span>${I.chev}</button>`).join('');
  return `<header class="mh"><div class="r1"><h1>Boards</h1><button class="tb" data-act="newboard">New board</button></div></header>
<main class="mm" style="gap:0">${rows}<button class="rowlink" data-act="settings" style="margin-top:24px;color:var(--ink-2)"><span>Settings</span><span class="n" data-sync></span></button></main>`;
}
function mInbox() {
  const list = sortList(inboxTasks()), od = overdueTasks();
  let body = '';
  if (od.length) body += `<button class="banner" data-act="review"><span>${od.length} overdue from earlier days</span>Review</button>`;
  body += capped('minbox', list, t => mcard(t)) || `<div class="empty">Inbox is empty. Tap + to capture.</div>`;
  if (list.length) body += `<div class="empty" style="margin-top:12px">Swipe right to finish, left to schedule. Hold to drag onto a day.</div>`;
  return `<header class="mh"><div class="r1"><h1>Inbox${list.length ? ' · ' + list.length : ''}</h1></div></header><main class="mm" data-list="inbox">${body}</main>`;
}

// ── sheets ────────────────────────────────────────────────────
let sheetState = null;
function closeSheet() { $('.scrim')?.remove(); $('.sheet')?.remove(); sheetState = null; }
function openSheet(html, state) {
  closeSheet(); $('.toast')?.remove(); sheetState = state;
  const root = isDesk() ? document.body : ($('.m') || document.body);
  root.insertAdjacentHTML('beforeend', `<div class="scrim" data-act="close"></div><section class="sheet" role="dialog" aria-modal="true">${html}</section>`);
  const sh = $('.sheet'); const f = sh.querySelector('[autofocus]'); if (f) setTimeout(() => f.focus(), 30);
  return sh;
}
function taskSheet(id, view = 'main') {
  const t = S.tasks.get(id); if (!t) return;
  const bd = t.board ? S.boards.get(t.board) : null;
  const where = (bd ? bd.name + (t.section ? ' · ' + t.section : '') : 'In Inbox') + ' · ' + (t.when ? whenText(t) : 'not scheduled');
  if (view === 'board') {
    const opts = [['', '', 'Inbox']].concat(boardsSorted().flatMap(b => [[b.id, '', b.name], ...(b.sections || []).map(s => [b.id, s, `${b.name} · ${s}`])]));
    openSheet(`<div class="grab"></div><div style="font-size:20px;font-weight:700">Move to</div><div class="list-pick">${opts.map(([b, s, l]) => `<button data-act="setboard" data-b="${b}" data-s="${esc(s)}" aria-pressed="${(t.board || '') === b && (t.section || '') === s}"><span>${esc(l)}</span></button>`).join('')}</div>
<button class="bigbtn" data-act="sheetback">Back</button>`, { id, view });
    return;
  }
  const T = todayK(), chips = [['Today', T], ['Tomorrow', addDays(T, 1)], ['This week', isoWeek(T)], ['Next week', shiftPeriod(isoWeek(T), 1)], ['This month', periodOf('month', T)]];
  const pri = t.pri || 'normal';
  openSheet(`<div class="grab"></div>
<div style="display:flex;flex-direction:column;gap:2px"><textarea class="ttl" rows="1" data-field="title" aria-label="Task name">${esc(t.title)}</textarea><div style="font-size:13px;color:var(--ink-2)">${esc(where)}</div></div>
<div class="grp"><div class="eyebrow">When</div><div class="when">${chips.map(([l, k]) => `<button data-act="when" data-k="${k}" aria-pressed="${t.when === k}">${l}</button>`).join('')}
<button aria-pressed="${!!t.when && !chips.some(c => c[1] === t.when)}">Pick date<input class="overlay-input" type="date" data-act="pickdate" value="${kindOf(t.when) === 'day' ? t.when : ''}" aria-label="Pick a date"></button></div></div>
<div class="grp"><div class="eyebrow">Time, optional</div><div class="row">
<button class="bigbtn" style="flex:1">${t.at ? `Starts ${clockAP(t.at)}` : 'Add a start time'}<input class="overlay-input" type="time" step="900" data-act="picktime" value="${t.at || ''}" aria-label="Start time"></button>
${t.at ? `<button class="bigbtn" style="padding:0 12px" data-act="cleartime" aria-label="Remove time">✕</button>` : ''}
<div class="stepper"><button aria-label="Shorter" data-act="dur" data-d="-15">${I.minus}</button><div>${t.dur || 30} min</div><button aria-label="Longer" data-act="dur" data-d="15">${I.plus(18, 2.5)}</button></div></div></div>
<div class="grp"><div class="eyebrow">Priority</div><div class="seg">
<button data-act="pri" data-p="target" aria-pressed="${pri === 'target'}">${I.star(15)}Target</button><button data-act="pri" data-p="normal" aria-pressed="${pri === 'normal'}">Normal</button><button data-act="pri" data-p="someday" aria-pressed="${pri === 'someday'}">Someday</button></div></div>
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
  const label = dest.board ? S.boards.get(dest.board)?.name : dest.when ? periodLabel(dest.when, true) : 'Inbox';
  openSheet(`<div class="grab"></div><div style="display:flex;flex-direction:column;gap:2px"><div style="font-size:20px;font-weight:700">Capture</div><div style="font-size:13px;color:var(--ink-2)">Adding to ${esc(label)} · one task per line</div></div>
<textarea class="dump" id="dump" autofocus placeholder="What's on your mind?" enterkeyhint="enter"></textarea>
<button class="bigbtn dark" data-act="savecapture">Add</button>`, { capture: dest });
}
function reviewSheet() {
  const od = overdueTasks(), targets = od.filter(t => t.pri === 'target'), others = od.filter(t => t.pri !== 'target');
  const tm = addDays(todayK(), 1);
  const item = (t) => `<div class="review-item" data-tid="${t.id}"><div style="font-weight:600">${esc(t.title)}${(t.rolls || 0) >= 3 ? ` <span class="sub" style="font-size:12px;color:var(--warn)">· pushed ${t.rolls} times</span>` : ''}</div>
<div style="font-size:13px;color:var(--ink-2)">Was on ${esc(periodLabel(t.when, true))}</div><div class="row">
<button data-act="rv" data-k="${todayK()}">Today</button><button data-act="rv" data-k="${tm}">Tomorrow</button>
<button>Pick a day<input class="overlay-input" type="date" data-act="rvpick" aria-label="Pick a day"></button>${(t.rolls || 0) >= 3 ? `<button data-act="rvdrop">Drop</button>` : `<button data-act="rv" data-k="">To list</button>`}</div></div>`;
  openSheet(`<div class="grab"></div><div style="font-size:20px;font-weight:700">Review</div>
<div style="font-size:13px;color:var(--ink-2)">Nothing rolls over by itself. Decide each unfinished target; the rest go back to their lists.</div>
${targets.map(item).join('') || '<div class="empty">No unfinished targets.</div>'}
${others.length ? `<button class="bigbtn" data-act="rvrest">Return ${others.length} other task${others.length > 1 ? 's' : ''} to ${others.length > 1 ? 'their lists' : 'its list'}</button>` : ''}
<button class="bigbtn dark" data-act="close">Done</button>`, { review: true });
}
function pushTask(id, when) { const t = S.tasks.get(id); put('task', id, { when: when || null, at: '', rolls: (t.rolls || 0) + 1 }); }
function boardSheet(id) {
  const b = id ? S.boards.get(id) : null;
  openSheet(`<div class="grab"></div><div style="font-size:20px;font-weight:700">${b ? 'Edit board' : 'New board'}</div>
<div class="field"><label class="eyebrow" for="bname">Name</label><input id="bname" value="${esc(b?.name || '')}" autofocus autocomplete="off"></div>
<div class="field"><label class="eyebrow" for="bsecs">Sections, one per line</label><textarea class="notes" id="bsecs" placeholder="e.g. Cellar&#10;Sales&#10;Events">${esc((b?.sections || []).join('\n'))}</textarea></div>
<div class="foot">${b && b.id !== 'backlog' ? `<button class="link" style="font-size:14px;color:var(--now)" data-act="delboard" data-bid="${b.id}">Delete board</button>` : '<span></span>'}<button class="bigbtn dark" style="padding:0 20px" data-act="saveboard" data-bid="${b?.id || ''}">Save</button></div>`, { board: id });
}
function settingsSheet() {
  const s = syncState();
  openSheet(`<div class="grab"></div><div style="font-size:20px;font-weight:700">Settings</div>
<div class="grp"><div class="eyebrow">Account</div>
${S.me ? `<div>${esc(S.me)} · <span class="muted">${esc(s.text)}${S.lastSync ? ' · ' + new Date(S.lastSync).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : ''}</span></div><div class="row"><button class="bigbtn" style="flex:1" data-act="syncnow">Sync now</button><a class="bigbtn" style="flex:1;display:flex;align-items:center;justify-content:center;text-decoration:none;color:inherit" href="/auth/logout">Sign out</a></div>`
  : S.setup ? `<div class="muted" style="font-size:14px">Your tasks are saved on this device. Sign in to sync between phone and computer.</div><a class="bigbtn dark" style="display:flex;align-items:center;justify-content:center;text-decoration:none" href="/auth/google">Sign in with Google</a>`
  : `<div class="muted" style="font-size:14px">Your tasks are saved on this device. Sync turns on once Google sign-in is set up for Horizonte.</div>`}</div>
<div class="grp"><div class="eyebrow">Workday</div><div class="row"><label class="field" style="flex:1">Starts<input type="time" data-pref="dayStart" value="${S.prefs.dayStart}"></label><label class="field" style="flex:1">Ends<input type="time" data-pref="dayEnd" value="${S.prefs.dayEnd}"></label></div></div>
<div class="grp"><div class="eyebrow">Daily targets</div><div class="row"><div class="stepper"><button aria-label="Fewer" data-act="cap" data-d="-1">${I.minus}</button><div>${S.prefs.cap}</div><button aria-label="More" data-act="cap" data-d="1">${I.plus(18, 2.5)}</button></div><span class="muted" style="font-size:14px">targets per day</span></div></div>
<div class="row"><button class="bigbtn" style="flex:1" data-act="export">Export all data</button><button class="bigbtn" style="flex:1" data-act="close">Close</button></div>`, { settings: true });
}

// ── toast ─────────────────────────────────────────────────────
let toastTimer;
function toast(msg, withUndo) {
  $('.toast')?.remove(); clearTimeout(toastTimer);
  (isDesk() ? document.body : ($('.m') || document.body)).insertAdjacentHTML('beforeend', `<div class="toast" role="status"><span>${esc(msg)}</span>${withUndo ? '<button data-act="undo">Undo</button>' : ''}</div>`);
  toastTimer = setTimeout(() => $('.toast')?.remove(), 5000);
}

// ── clicks ────────────────────────────────────────────────────
document.addEventListener('click', (e) => {
  if (suppressClick) { suppressClick = false; e.preventDefault(); e.stopPropagation(); return; }
  const el = e.target.closest('[data-act],[data-zoom],[data-src],[data-tab],[data-mzoom]'); if (!el) return;
  const card = e.target.closest('[data-tid]'), tid = card?.dataset.tid;
  if (el.dataset.zoom) { S.ui.zoom = el.dataset.zoom; S.ui.pk = null; render(); if (S.ui.zoom === 'hours') scrollHoursToNow(); return; }
  if (el.dataset.src) { S.ui.src = el.dataset.src; render(); return; }
  if (el.dataset.tab) { S.ui.mtab = el.dataset.tab; if (el.dataset.tab !== 'boards') S.ui.board = null; render(); $('.mm') && ($('.mm').scrollTop = 0); return; }
  if (el.dataset.mzoom) { S.ui.mzoom = el.dataset.mzoom; render(); return; }
  const act = el.dataset.act, st = sheetState;
  switch (act) {
    case 'done': if (e.target.tagName === 'INPUT') { e.preventDefault(); toggleDone(tid); } return;
    case 'open': if (tid) taskSheet(tid); return;
    case 'close': closeSheet(); render(); return;
    case 'undo': $('.toast')?.remove(); undo(); return;
    case 'today': if (S.ui.zoom === 'hours') S.ui.hday = todayK(); else if (S.ui.zoom === 'days') S.ui.anchor = addDays(todayK(), -1); else S.ui.pk = null; render(); { const tl = $('.tl'); if (tl && S.ui.zoom !== 'hours') tl.scrollLeft = 0; } if (S.ui.zoom === 'hours') scrollHoursToNow(); return;
    case 'prev': case 'next': { const n = act === 'prev' ? -1 : 1;
      if (S.ui.zoom === 'hours') S.ui.hday = addDays(S.ui.hday, n); else if (S.ui.zoom === 'days') S.ui.anchor = addDays(S.ui.anchor, 7 * n); else S.ui.pk = shiftPeriod(S.ui.pk, n);
      render(); return; }
    case 'mprev': case 'mnext': { const n = act === 'mprev' ? -1 : 1, z = S.ui.mzoom;
      S.ui.manchor = z === 'days' ? addDays(S.ui.manchor, 7 * n) : periodRange(shiftPeriod(periodOf({ weeks: 'week', months: 'month', quarters: 'quarter', years: 'year' }[z], S.ui.manchor), 8 * n))[0];
      render(); $('.mm').scrollTop = 0; return; }
    case 'mtoday': S.ui.manchor = todayK(); render(); $('.mm').scrollTop = 0; return;
    case 'sort': { const m = ['manual', 'priority', 'age', 'duration']; S.ui.sort = m[(m.indexOf(S.ui.sort) + 1) % m.length]; render(); return; }
    case 'toggle': S.ui.open[el.dataset.key] = !S.ui.open[el.dataset.key]; render(); return;
    case 'addto': S.ui.adding = el.dataset.k; render(); $(`#ia-${CSS.escape(el.dataset.k)}`)?.focus(); return;
    case 'capture': captureSheet(el.dataset.board ? { board: el.dataset.board } : el.dataset.k ? { when: el.dataset.k } : S.ui.mtab === 'today' && !isDesk() ? { when: todayK() } : {}); return;
    case 'savecapture': { const n = addLines($('#dump').value, captureDest(st?.capture)); closeSheet(); render(); if (n) toast(`Added ${n} task${n > 1 ? 's' : ''}`, true); return; }
    case 'review': reviewSheet(); return;
    case 'rv': { const id = el.closest('[data-tid]').dataset.tid; pushTask(id, el.dataset.k); render(); reviewSheet(); return; }
    case 'rvdrop': { const id = el.closest('[data-tid]').dataset.tid; put('task', id, { status: 'dropped' }); render(); reviewSheet(); return; }
    case 'rvrest': batch(g => overdueTasks().filter(t => t.pri !== 'target').forEach(t => put('task', t.id, { when: null, at: '', rolls: (t.rolls || 0) + 1 }, { group: g }))); render(); reviewSheet(); return;
    case 'when': put('task', st.id, { when: el.dataset.k }); closeSheet(); render(); toast(`Moved to ${periodLabel(el.dataset.k)}`, true); return;
    case 'cleartime': put('task', st.id, { at: '' }); render(); taskSheet(st.id); return;
    case 'dur': { const t = S.tasks.get(st.id); put('task', st.id, { dur: Math.max(15, Math.min(480, (t.dur || 30) + Number(el.dataset.d))) }); render(); taskSheet(st.id); return; }
    case 'pri': put('task', st.id, { pri: el.dataset.p }); render(); taskSheet(st.id); return;
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
      closeSheet(); if (!el.dataset.bid) { S.ui.src = 'b:' + id; S.ui.board = id; } render(); return; }
    case 'delboard': { const id = el.dataset.bid; batch(g => { put('board', id, { del: new Date().toISOString() }, { group: g }); boardTasks(id).forEach(t => put('task', t.id, { board: '', section: '' }, { group: g })); });
      closeSheet(); S.ui.board = null; S.ui.src = 'inbox'; render(); toast('Board deleted; its tasks moved to Inbox', true); return; }
    case 'openboard': S.ui.board = el.dataset.bid; render(); $('.mm').scrollTop = 0; return;
    case 'boardsback': S.ui.board = null; render(); return;
    case 'settings': settingsSheet(); return;
    case 'syncnow': syncNow().then(() => sheetState?.settings && settingsSheet()); return;
    case 'cap': S.prefs.cap = Math.max(1, Math.min(5, S.prefs.cap + Number(el.dataset.d))); put('pref', 'main', { cap: S.prefs.cap }, { quiet: true }); render(); settingsSheet(); return;
    case 'export': { const blob = new Blob([JSON.stringify({ exported: new Date().toISOString(), tasks: [...S.tasks.values()], boards: [...S.boards.values()], prefs: S.prefs }, null, 2)], { type: 'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `horizonte-${todayK()}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); return; }
  }
});
function captureDest(d = {}) {
  if (d.board) return { board: d.board };
  if (d.when) return { when: d.when };
  if (isDesk()) { const s = S.ui.src; if (s.startsWith('b:')) return { board: s.slice(2) }; if (s === 'week') return { when: isoWeek(todayK()) }; if (s === 'month') return { when: periodOf('month', todayK()) }; }
  return {};
}
document.addEventListener('change', (e) => {
  const el = e.target, st = sheetState;
  if (el.dataset.act === 'pickdate' && el.value) { put('task', st.id, { when: el.value }); closeSheet(); render(); toast(`Moved to ${periodLabel(el.value)}`, true); }
  else if (el.dataset.act === 'picktime' && el.value) { const t = S.tasks.get(st.id); put('task', st.id, { at: el.value, when: kindOf(t.when) === 'day' ? t.when : todayK() }); render(); taskSheet(st.id); }
  else if (el.dataset.act === 'rvpick' && el.value) { pushTask(el.closest('[data-tid]').dataset.tid, el.value); render(); reviewSheet(); }
  else if (el.dataset.pref) { S.prefs[el.dataset.pref] = el.value; put('pref', 'main', { [el.dataset.pref]: el.value }, { quiet: true }); render(); }
  else if (el.dataset.field) sheetField(el);
});
document.addEventListener('focusout', (e) => { if (e.target.dataset?.field) sheetField(e.target); });
document.addEventListener('keydown', (e) => {
  const el = e.target;
  if (el.id === 'qa' && e.key === 'Enter') {
    e.preventDefault(); const v = el.value.trim(); if (!v) return;
    const n = addLines(v, { ...captureDest(), src: 'typed' }); el.value = ''; render(); $('#qa')?.focus(); if (n > 1) toast(`Added ${n} tasks`, true); return;
  }
  if (el.dataset?.addto) {
    if (e.key === 'Escape') { S.ui.adding = null; render(); return; }
    if (e.key === 'Enter') { e.preventDefault(); const v = el.value.trim(); const k = el.dataset.addto; if (v) addLines(v, { when: k }); render(); $(`#ia-${CSS.escape(k)}`)?.focus(); return; }
  }
  if (el.classList?.contains('ttl') && e.key === 'Enter') { e.preventDefault(); el.blur(); return; }
  if (el.id === 'dump' && e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { $('[data-act=savecapture]')?.click(); return; }
  if (e.key === 'Escape' && sheetState) { closeSheet(); render(); return; }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !/INPUT|TEXTAREA/.test(el.tagName)) { e.preventDefault(); undo(); return; }
  if (/INPUT|TEXTAREA|SELECT/.test(el.tagName) || e.metaKey || e.ctrlKey || e.altKey || sheetState || !isDesk()) return;
  const k = e.key;
  if (k >= '1' && k <= '6') { S.ui.zoom = ZOOMS[Number(k) - 1][0]; S.ui.pk = null; render(); }
  else if (k === 'n' || k === 'N') { e.preventDefault(); $('#qa')?.focus(); }
  else if (k === 'd' || k === 'D') { e.preventDefault(); captureSheet(captureDest()); }
  else if (k === 't' || k === 'T') $('[data-act=today]')?.click();
  else if (k === '[' || k === ']') { const s = sources().map(x => x[0]); S.ui.src = s[(s.indexOf(S.ui.src) + (k === ']' ? 1 : s.length - 1)) % s.length]; render(); }
  else if (k === '\\') { $('.panel')?.classList.toggle('collapsed'); }
});
document.addEventListener('focusout', (e) => { if (e.target.dataset?.addto && !e.target.value.trim()) setTimeout(() => { if (S.ui.adding === e.target.dataset.addto && !document.activeElement?.dataset?.addto) { S.ui.adding = null; render(); } }, 120); });

// ── drag and drop (mouse, pen, touch) ─────────────────────────
// Mouse: press and move 5px. Touch: hold 350 ms. On a phone the week rail slides in from the right.
let drag = null, press = null, suppressClick = false;
document.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || sheetState) return;
  const card = e.target.closest('.card[data-tid]'); if (!card || e.target.closest('input,.ck')) return;
  const resize = e.target.closest('[data-resize]');
  press = { id: card.dataset.tid, card, x: e.clientX, y: e.clientY, type: e.pointerType, resize: !!resize, pid: e.pointerId, t: Date.now(), swipe: null };
  if (e.pointerType !== 'mouse') press.timer = setTimeout(() => { if (press && !press.swipe) startDrag(e.clientX, e.clientY); }, 350);
});
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
document.addEventListener('contextmenu', (e) => { if (e.target.closest('.card')) e.preventDefault(); });

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
  if (dx > 80) { navigator.vibrate?.(15); toggleDone(id); return; }
  c.style.transition = 'transform 150ms ease-out'; c.style.transform = ''; setTimeout(() => { c.querySelector('.swipe-hint')?.remove(); c.classList.remove('swiping'); c.style.transition = ''; }, 160);
  if (dx < -80) taskSheet(id);
}
function startDrag(x, y) {
  const p = press; if (!p) return; press = null; clearTimeout(p.timer);
  const r = p.card.getBoundingClientRect();
  const ghost = p.card.cloneNode(true); ghost.classList.add('ghost'); ghost.style.width = (isDesk() ? r.width : Math.min(r.width, innerWidth * 0.62)) + 'px'; ghost.style.height = Math.min(r.height, 80) + 'px';
  ghost.style.left = '0px'; ghost.style.top = '0px'; ghost.style.position = 'fixed'; ghost.style.right = 'auto';
  (isDesk() ? document.body : $('.m')).appendChild(ghost);
  p.card.classList.add('dragging'); document.body.classList.add('is-dragging');
  drag = { id: p.id, card: p.card, ghost, ox: x - r.left, oy: y - r.top, over: null, rail: null };
  if (!isDesk()) { navigator.vibrate?.(20); drag.rail = openRail(); }
  moveDrag(x, y);
}
function openRail() {
  const T = todayK(), rows = [];
  for (let i = 0; i < 7; i++) { const k = addDays(T, i); rows.push([`day:${k}`, i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : dayShort(k), placedOn(k).length ? fmtDur(dayLoad(k)) : 'Free']); }
  rows.push([`period:${shiftPeriod(isoWeek(T), 1)}`, 'Next week', ''], [`period:${periodOf('month', T)}`, 'This month', ''], ['list', 'Unschedule', '']);
  $('.m').insertAdjacentHTML('beforeend', `<div class="rail" aria-hidden="true"><div class="eyebrow">Drop on</div>${rows.map(([d, l, s]) => `<div class="slot" data-drop="${d}">${l}${s ? `<small>${s}</small>` : ''}</div>`).join('')}</div>`);
  const rail = $('.rail'); requestAnimationFrame(() => rail.classList.add('in')); return rail;
}
function dropAt(x, y) {
  const el = document.elementFromPoint(x, y); if (!el) return null;
  const t = el.closest('[data-drop]'); if (!t) return null;
  if (drag?.rail && !t.closest('.rail')) return null; // on a phone, only the rail and day headers take drops
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
    let m = Math.round(((y - d.oy + 6 - r.top) / HPX * 60 + H0() * 60) / 15) * 15; m = Math.max(0, Math.min(24 * 60 - dur, m)); d.slot = fromMin(m);
    let line = t.querySelector('.slotline'); if (!line) { t.insertAdjacentHTML('beforeend', '<div class="slotline"><span></span></div>'); line = t.querySelector('.slotline'); }
    line.style.top = ((m / 60 - H0()) * HPX) + 'px'; line.firstElementChild.textContent = clock(d.slot);
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
  if (d.rail) { d.rail.classList.remove('in'); setTimeout(() => d.rail.remove(), 200); }
  suppressClick = true; setTimeout(() => { suppressClick = false; }, 50);
  return d;
}
function cancelDrag() { cleanupDrag(); }
function endDrag(x, y) {
  const d = cleanupDrag(), t = d.over; if (!t) return;
  const [kind, val] = t.dataset.drop.split(/:(.*)/s), task = S.tasks.get(d.id); if (!task) return;
  if (kind === 'day') { if (task.when === val && kindOf(task.when) === 'day' && !task.at) return; place(d.id, val, kindOf(task.when) === 'day' && task.when !== val ? task.at : '', null); }
  else if (kind === 'slot') place(d.id, val, d.slot, `${dayShort(val)} ${clock(d.slot)}`);
  else if (kind === 'period') place(d.id, val, '');
  else if (kind === 'list') { if (task.when) place(d.id, null, ''); }
  else if (kind === 'board') { if ((task.board || '') !== val) { put('task', d.id, { board: val, section: '' }); render(); toast(`Moved to ${val ? S.boards.get(val)?.name : 'Inbox'}`, true); } }
  if (navigator.vibrate && d.rail) navigator.vibrate(10);
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
  ensureDefaults(); render(); whoami();
  matchMedia('(min-width: 900px)').addEventListener('change', () => { closeSheet(); render(); });
  addEventListener('online', () => { paintSync(); syncNow(); }); addEventListener('offline', paintSync);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { if (todayK() !== lastDay) { lastDay = todayK(); S.ui.anchor = addDays(lastDay, -1); S.ui.hday = lastDay; render(); } syncNow(); } });
  setInterval(() => { if (todayK() !== lastDay) { lastDay = todayK(); S.ui.anchor = addDays(lastDay, -1); S.ui.hday = lastDay; } if (!sheetState && !drag && !press && !document.activeElement?.matches('input,textarea')) render(); }, 60000);
  setInterval(syncNow, 60000);
  if ('serviceWorker' in navigator && location.hostname !== 'localhost') navigator.serviceWorker.register('/sw.js').catch(() => {});
}
start();
