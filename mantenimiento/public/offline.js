/* Esmero — working without signal (Adrián's garden has little).
   Reading: sw.js keeps the app and the last answer to every GET on the phone; a kept answer comes back marked and the
   page says "Sin señal" with how much is waiting to go out.
   Writing: a report, a change to a pendiente, a note or a photo made with no signal goes to an outbox kept on the phone
   (IndexedDB, so photos fit) and the page carries on as if it had gone out. What is in the outbox is laid over what the
   server last said, so the lists, the calendar and the pendiente show it. The outbox goes out in order when the signal
   comes back (on "online", when the app is opened again, and every 30 s while something waits).
   A pendiente reported offline has a temporary negative id until the server gives it its number; whatever was done to
   it meanwhile (a change, a note, a photo) goes out after it with the real number. */
const OFF = (() => {
  let db = null;
  let OUT = [];                 // the outbox, in order: { k, method, path, data, photo?: { full, thumb }, at }
  let busy = false;
  let timer = null;
  let stale = false;            // the last thing read came from the phone, not the server
  const MAP = {};               // temporary id → the server's number, once known

  // ---------- the outbox on the phone ----------
  const open = () => new Promise((resolve) => {
    if (db) return resolve(db);
    let r;
    try { r = indexedDB.open('esmero', 1); } catch { return resolve(null); }
    r.onupgradeneeded = () => r.result.createObjectStore('out', { keyPath: 'k', autoIncrement: true });
    r.onsuccess = () => { db = r.result; resolve(db); };
    r.onerror = () => resolve(null);       // private mode and the like: the outbox lives in memory only
  });
  const tx = async (mode, fn) => {
    const d = await open();
    if (!d) return null;
    return new Promise((resolve) => {
      const t = d.transaction('out', mode);
      const req = fn(t.objectStore('out'));
      t.oncomplete = () => resolve(req && req.result);
      t.onerror = () => resolve(null);
    });
  };
  async function load() {
    const rows = await tx('readonly', (s) => s.getAll());
    OUT = (rows || []).sort((a, b) => a.k - b.k);
    let min = 0;
    for (const o of OUT) if (o.tmp && o.tmp < min) min = o.tmp;
    nextTmp = min - 1;
    paint();
    if (OUT.length) soon(1000);
  }
  async function add(o) {
    o.at = Date.now();
    const k = await tx('readwrite', (s) => s.add(o));
    o.k = k || (OUT.length ? OUT[OUT.length - 1].k + 1 : 1);
    OUT.push(o);
    paint();
    soon(4000);
  }
  async function drop(o) {
    OUT = OUT.filter((x) => x !== o);
    await tx('readwrite', (s) => s.delete(o.k));
    paint();
  }
  async function save(o) { await tx('readwrite', (s) => s.put(o)); }

  // ---------- what may wait ----------
  const RX = { patch: /^\/tasks\/(-?\d+)$/, note: /^\/tasks\/(-?\d+)\/notes$/, photo: /^\/tasks\/(-?\d+)\/photos$/ };
  const queueable = (method, path) => (method === 'POST' && path === '/tasks') || (method === 'PATCH' && RX.patch.test(path)) || (method === 'POST' && RX.note.test(path));
  const idIn = (path) => { const m = /^\/tasks\/(-?\d+)/.exec(path); return m ? Number(m[1]) : null; };
  let nextTmp = -1;

  // a pendiente the way the server would describe it, from what is known here
  function describe(t, data) {
    const x = { ...t, ...data };
    if ('area_id' in data) { const a = areaOf(Number(data.area_id) || 0); x.area_id = a ? a.id : null; x.area_name = a ? a.name : null; x.area_color = a ? a.color : null; if (a) x.place = null; }
    if ('place' in data && data.place) { x.area_id = null; x.area_name = null; x.area_color = null; }
    if ('provider_id' in data) { const p = provOf(Number(data.provider_id) || 0); x.provider_id = p ? p.id : null; x.provider_name = p ? p.name : null; }
    if ('priority' in data) x.priority = Number(data.priority) || 3;
    if ('due_date' in data && !data.due_date) { x.due_date = null; x.plan_min = null; }
    if (data.status === 'hecha' && !x.completed_at) x.completed_at = new Date().toISOString().slice(0, 19).replace('T', ' ');
    delete x.note; delete x.replan; delete x.cost_note;
    x.pending = true;   // shown with a mark until it is on the server
    return x;
  }
  const known = (id) => (C.open || []).find((t) => t.id === id) || (C.task && C.task.id === id ? C.task : null);

  async function enqueue(method, path, data) {
    if (method === 'POST' && path === '/tasks') {
      const tmp = nextTmp--;
      const task = describe({
        id: tmp, kind: data.kind || 'tarea', status: data.kind === 'servicio' ? 'hecha' : 'pendiente', title: data.title, description: data.description || '',
        priority: 3, due_date: null, plan_min: null, est_min: null, photo_count: 0, note_count: 0, postponed: 0, cost: null,
        created_at: new Date().toISOString().slice(0, 19).replace('T', ' '), created_by: S.user.id, created_by_name: S.user.name,
        equipment_id: data.equipment_id || null, equipment_name: null, place: null,
      }, { ...data, due_date: data.due_date || null });
      if (data.due_date) task.due_date = data.due_date;
      await add({ method, path, data, tmp, task });
      if (C.open) C.open.push(task);
      return { task };
    }
    await add({ method, path, data });
    const id = idIn(path);
    if (RX.patch.test(path)) {
      const t = known(id);
      const task = t ? describe(t, data) : { id, ...data, pending: true };
      if (t) Object.assign(t, task);
      return { task };
    }
    return { ok: true };
  }
  async function queuePhoto(path, full, thumb) { await add({ method: 'POST', path, photo: { full, thumb } }); }

  // ---------- laid over what the server last said ----------
  function overlay(path, out) {
    if (!OUT.length) return out;
    if (path.startsWith('/tasks?view=open') && Array.isArray(out.tasks)) {
      const by = new Map(out.tasks.map((t) => [t.id, t]));
      for (const o of OUT) {
        if (o.tmp && o.task) { if (!by.has(o.tmp)) { const t = { ...o.task }; by.set(o.tmp, t); } continue; }
        if (o.method === 'PATCH') { const id = idIn(o.path); const t = by.get(id); if (t) by.set(id, describe(t, o.data)); }
      }
      out.tasks = [...by.values()].filter((t) => OPEN.includes(t.status));
      return out;
    }
    const m = /^\/tasks\/(-?\d+)$/.exec(path);
    if (m && out.task) {
      const id = Number(m[1]);
      for (const o of OUT) {
        if (o.method === 'PATCH' && idIn(o.path) === id) out.task = describe(out.task, o.data);
        if (RX.note.test(o.path) && idIn(o.path) === id) {
          out.notes = [...(out.notes || []), { id: 'p' + o.k, body: o.data.body, user_name: S.user.name, user_id: S.user.id, created_at: new Date(o.at).toISOString().slice(0, 19).replace('T', ' '), pending: true }];
        }
      }
      const ph = OUT.filter((o) => o.photo && idIn(o.path) === id).length;
      if (ph) out.task.photos_waiting = ph;
    }
    return out;
  }
  // a pendiente that exists only here so far
  function local(path) {
    const m = /^\/tasks\/(-\d+)$/.exec(path);
    if (!m) return null;
    const id = Number(m[1]);
    if (MAP[id]) return { redirect: MAP[id] };
    const o = OUT.find((x) => x.tmp === id);
    return o ? overlay(path, { task: { ...o.task }, notes: [], photos: [], log: [] }) : null;
  }

  // ---------- sending ----------
  const soon = (ms) => { clearTimeout(timer); timer = setTimeout(flush, ms); };
  async function send(o) {
    const path = o.path.replace(/^\/tasks\/(-\d+)/, (s, id) => (MAP[id] ? '/tasks/' + MAP[id] : s));
    if (/^\/tasks\/-\d+/.test(path)) return 'wait';    // its pendiente has not gone out yet
    let res;
    try {
      if (o.photo) {
        const form = new FormData();
        form.append('photo', o.photo.full, 'foto.jpg');
        if (o.photo.thumb) form.append('thumb', o.photo.thumb, 'mini.jpg');
        res = await fetch('/api' + path, { method: 'POST', credentials: 'same-origin', body: form });
      } else {
        res = await fetch('/api' + path, { method: o.method, credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(o.data) });
      }
    } catch { return 'net'; }
    if (res.status === 401) return 'net';               // signed out: it waits until they are back in
    if (res.status >= 500) return 'net';
    let body = {};
    try { body = await res.json(); } catch { /* */ }
    if (!res.ok) { toast(`No se pudo guardar: ${body.error || res.status}`, { bad: true }); return 'drop'; }
    if (o.tmp && body.task) {
      MAP[o.tmp] = body.task.id;
      if (C.open) { const t = C.open.find((x) => x.id === o.tmp); if (t) Object.assign(t, body.task, { pending: false }); }
      if (location.hash === '#/p/' + o.tmp) location.replace('#/p/' + body.task.id);
      for (const x of OUT) if (x !== o && idIn(x.path) === o.tmp) { x.path = x.path.replace('/tasks/' + o.tmp, '/tasks/' + body.task.id); save(x); }
    }
    return 'ok';
  }
  async function flush() {
    if (busy || !OUT.length) return;
    if (navigator.onLine === false) { soon(30000); return; }
    busy = true;
    let sent = 0, failed = false;
    for (const o of [...OUT]) {
      const r = await send(o);
      if (r === 'net') { failed = true; break; }
      if (r === 'wait') continue;
      await drop(o);
      if (r === 'ok') sent++;
    }
    busy = false;
    if (sent) {
      touch();
      toast(sent === 1 ? 'Se envió lo que estaba pendiente' : `Se enviaron ${sent} cambios pendientes`);
      if (UI.refresh && !document.hidden && $('#sheet').classList.contains('hidden')) UI.refresh();
    }
    if (OUT.length) soon(failed ? 30000 : 3000);
  }

  // ---------- the line that says so ----------
  function paint() {
    let el = document.getElementById('net');
    if (!el) {
      el = document.createElement('div');
      el.id = 'net';
      el.setAttribute('role', 'status');
      el.onclick = () => { stale = false; flush(); paint(); };
      document.body.appendChild(el);
    }
    const n = OUT.length;
    const off = navigator.onLine === false || stale;
    el.className = n || off ? 'show' : '';
    el.textContent = off
      ? (n ? `Sin señal · ${n === 1 ? '1 cambio' : n + ' cambios'} por enviar` : 'Sin señal · mostrando lo último guardado')
      : n ? `Enviando ${n === 1 ? '1 cambio' : n + ' cambios'}…` : '';
  }
  const seen = (fromPhone) => { if (stale !== fromPhone) { stale = fromPhone; paint(); } if (!fromPhone && OUT.length) soon(500); };

  // keep the photos of what is open on the phone, so they can be seen in the garden
  async function keepPhotos(tasks) {
    if (navigator.onLine === false || !('caches' in self)) return;
    const done = new Set(store('mt_kept') || []);
    const ids = tasks.map((t) => t.thumb_id).filter((id) => id && !done.has(id)).slice(0, 40);
    for (const id of ids) {
      try { const r = await fetch('/api/photos/' + id); if (r.ok) done.add(id); } catch { break; }
    }
    store('mt_kept', [...done].slice(-400));
  }

  window.addEventListener('online', () => { paint(); flush(); });
  window.addEventListener('offline', paint);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) flush(); });
  if ('serviceWorker' in navigator && location.hostname !== '127.0.0.1') {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  } else if ('serviceWorker' in navigator && new URLSearchParams(location.search).has('sw')) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});   // local tests ask for it
  }
  return { load, queueable, enqueue, queuePhoto, overlay, local, seen, flush, keepPhotos, get count() { return OUT.length; } };
})();
