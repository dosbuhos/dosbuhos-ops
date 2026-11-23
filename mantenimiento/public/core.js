/* Pulso, el mantenimiento de Dos Búhos — shared pieces (plain JS, no build step). The planner is in planner.js, the other screens in app.js and more.js. */
'use strict';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const APP = $('#app');
const NAV = $('#nav');

// What every screen needs: who I am, areas (the coloured tags), contacts, equipment names, people, settings.
const S = { user: null, areas: [], providers: [], equipment: [], users: [], settings: {}, today: null };
const C = { open: null, openAt: 0 };          // cache: open pendientes, so the list paints at once on a weak signal
const UI = { lastFocus: null, lateN: 0 };

const PRIO = { 1: 'Urgente', 2: 'Alta', 3: 'Normal', 4: 'Baja' };
const PRIO_HINT = { 1: 'Peligro, fuga o detiene el servicio', 2: 'Hay que verlo hoy o mañana', 3: 'Esta semana', 4: 'Cuando se pueda' };
const STATUS = { pendiente: 'Por hacer', en_proceso: 'En curso', en_espera: 'Esperando', hecha: 'Hecho', cancelada: 'No aplica' };
const WAIT = { material: 'Esperando material', proveedor: 'Esperando al externo' };
const OPEN = ['pendiente', 'en_proceso', 'en_espera'];
const COLORS = ['red', 'orange', 'amber', 'yellow', 'green', 'teal', 'cyan', 'blue', 'indigo', 'purple', 'pink', 'grey'];
const COLOR_NAME = { red: 'rojo', orange: 'naranja', amber: 'ámbar', yellow: 'amarillo', green: 'verde', teal: 'verde azulado', cyan: 'turquesa', blue: 'azul', indigo: 'índigo', purple: 'morado', pink: 'rosa', grey: 'gris' };
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MESES_L = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const TRADES = ['Plomería', 'Electricidad', 'Carpintería', 'Herrería', 'Refrigeración', 'Albañilería', 'Pintura', 'Jardinería', 'Gas', 'Cerrajería', 'Internet y cámaras', 'Limpieza'];

// ---------- small tools ----------
const ic = (n, cls = '') => `<svg aria-hidden="true"${cls ? ` class="${cls}"` : ''}><use href="#i-${n}"/></svg>`;
function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function store(key, val) {
  try {
    if (val === undefined) return JSON.parse(localStorage.getItem(key));
    localStorage.setItem(key, JSON.stringify(val));
  } catch { /* private mode: nothing is remembered, nothing breaks */ }
  return null;
}
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '');
const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const first = (name) => String(name || '').trim().split(/\s+/)[0] || '';
const initials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase();
const debounce = (fn, ms = 250) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const money = (n) => '$' + Number(n || 0).toLocaleString('es-MX', { maximumFractionDigits: 0 });

// ---------- dates (the day is the phone's day; the server answers with San Miguel's) ----------
const pad2 = (n) => String(n).padStart(2, '0');
const ymdOf = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const todayStr = () => S.today || ymdOf(new Date());
const ymdDate = (ymd) => { const [y, m, d] = ymd.split('-').map(Number); return new Date(y, m - 1, d); };
const parseUTC = (s) => (s ? new Date(s.replace(' ', 'T') + 'Z') : null);
const localYmd = (s) => { const d = parseUTC(s); return d ? ymdOf(d) : null; };
function daysBetween(a, b) {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}
function addDays(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
// "hoy", "mañana", "jue 26 nov", "3 mar 2027"
function fmtDay(ymd, { weekday = false, rel = true } = {}) {
  if (!ymd) return '';
  const d = ymdDate(ymd);
  const diff = daysBetween(todayStr(), ymd);
  if (rel && diff === 0) return 'hoy';
  if (rel && diff === 1) return 'mañana';
  if (rel && diff === -1) return 'ayer';
  const yr = d.getFullYear() === Number(todayStr().slice(0, 4)) ? '' : ' ' + d.getFullYear();
  return `${weekday ? DIAS[d.getDay()].slice(0, 3) + ' ' : ''}${d.getDate()} ${MESES[d.getMonth()]}${yr}`;
}
function fmtDateTime(s) {
  const d = parseUTC(s);
  if (!d) return '';
  return `${fmtDay(ymdOf(d))}, ${d.getHours()}:${pad2(d.getMinutes())}`;
}
// For sentences: "hoy a las 14:32", "ayer a las 9:05", "el 13 nov a las 14:32".
function fmtWhen(s) {
  const d = parseUTC(s);
  if (!d) return '';
  const day = fmtDay(ymdOf(d));
  return `${/^\d/.test(day) ? 'el ' : ''}${day} a las ${d.getHours()}:${pad2(d.getMinutes())}`;
}
// 45 → "45 min", 60 → "1 h", 90 → "1 h 30"; and minutes after midnight → "9:30"
const fmtDur = (m) => (!m ? '' : m < 60 ? `${m} min` : m % 60 ? `${Math.floor(m / 60)} h ${m % 60}` : `${m / 60} h`);
const fmtClock = (m) => `${Math.floor(m / 60)}:${pad2(m % 60)}`;
function ago(ymd) {
  const n = daysBetween(ymd, todayStr());
  if (n <= 0) return 'hoy';
  if (n === 1) return 'ayer';
  if (n < 60) return `hace ${n} días`;
  if (n < 730) return `hace ${Math.round(n / 30)} meses`;
  return `hace ${Math.round(n / 365)} años`;
}

// ---------- people, areas, pendientes ----------
const isAdmin = () => !!S.user && S.user.role === 'admin';
const myCard = () => (S.user && S.user.provider_id) || null;
const areaOf = (id) => S.areas.find((a) => a.id === id) || null;
const provOf = (id) => S.providers.find((p) => p.id === id) || null;
const activeAreas = () => S.areas.filter((a) => a.active);
const activeProviders = () => S.providers.filter((p) => p.active);
const isOpen = (t) => OPEN.includes(t.status);
const isLate = (t) => isOpen(t) && !!t.due_date && t.due_date < todayStr();
const statusText = (t) => (t.status === 'en_espera' && WAIT[t.wait_reason]) || STATUS[t.status] || t.status;

// Words + a class for the date of an open pendiente. Never colour alone: late always says "Atrasado".
function dueInfo(t) {
  if (!isOpen(t)) return null;
  if (!t.due_date) return { cls: 'none', text: 'Sin fecha', icon: 'cal' };
  const diff = daysBetween(todayStr(), t.due_date);
  if (diff < -1) return { cls: 'late', text: `Atrasado ${-diff} días`, icon: 'alert' };
  if (diff === -1) return { cls: 'late', text: 'Atrasado desde ayer', icon: 'alert' };
  if (diff === 0) return { cls: 'today', text: 'Para hoy', icon: 'cal' };
  if (diff === 1) return { cls: '', text: 'Para mañana', icon: 'cal' };
  return { cls: '', text: `Para el ${fmtDay(t.due_date, { weekday: diff < 7 })}`, icon: 'cal' };
}
const tag = (name, color, extra = '') => `<span class="tag c-${esc(color || 'grey')}" ${extra}>${esc(name)}</span>`;
const areaTag = (t) => (t.area_name ? tag(t.area_name, t.area_color) : '');
// The address people are sent to. On the live hosts it is always Pulso's own; anywhere else (a laptop) it is where you are.
const APP_URL = /(^|\.)dosbuhos\.com$|\.workers\.dev$/.test(location.hostname) ? 'https://pulso.dosbuhos.com' : location.origin;
const avatar = (name, cls = '') => `<span class="av ${cls}" aria-hidden="true">${esc(initials(name))}</span>`;
// Facts that sit side by side (a phone and an email): each in its own span, spaced by the row.
const bits = (arr) => arr.filter(Boolean).map((x) => `<span>${esc(x)}</span>`).join('');

// phones
function waNumber(phone) {
  let d = String(phone || '').replace(/\D/g, '');
  if (d.length === 10) d = '52' + d;                       // a bare 10-digit number is Mexican
  if (d.length === 13 && d.startsWith('521')) d = '52' + d.slice(3);
  return d;
}
const telHref = (phone) => 'tel:' + String(phone || '').replace(/[^\d+]/g, '');
const waHref = (phone, text = '') => `https://wa.me/${waNumber(phone)}${text ? '?text=' + encodeURIComponent(text) : ''}`;
function fmtPhone(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  const g = (x) => `${x.slice(0, 3)} ${x.slice(3, 6)} ${x.slice(6)}`;
  if (d.length === 10) return g(d);
  if (d.length === 12 && d.startsWith('52')) return '+52 ' + g(d.slice(2));
  if (d.length === 13 && d.startsWith('521')) return '+52 ' + g(d.slice(3));
  if (d.length === 11 && d.startsWith('1')) return '+1 ' + g(d.slice(1));
  return String(phone || '');
}

// ---------- API ----------
async function api(method, path, data) {
  const opts = { method, headers: {}, credentials: 'same-origin', keepalive: !!UI.unloading };
  if (data !== undefined) {
    opts.headers['content-type'] = 'application/json';
    opts.body = JSON.stringify(data);
  }
  let res;
  try { res = await fetch('/api' + path, opts); } catch { throw new Error('Sin señal. Revisa tu internet e intenta de nuevo.'); }
  let out = {};
  try { out = await res.json(); } catch { /* empty */ }
  if (res.status === 401 && path !== '/enter') {
    S.user = null;
    showEnter();
    throw new Error('Regístrate para continuar');
  }
  if (!res.ok) throw new Error(out.error || 'Algo falló (' + res.status + '). Intenta de nuevo.');
  return out;
}
async function loadBoot() {
  const b = await api('GET', '/bootstrap');
  UI.lateN = b.late || 0;   // the counts on Atrasados and Bandeja, right on whichever screen the app opens; fetchOpen() keeps them current
  UI.inboxN = b.inbox || 0;
  delete b.late; delete b.inbox;
  Object.assign(S, b);
}

// ---------- photos ----------
function loadImg(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('img')); };
    img.src = url;
  });
}
function shrink(img, max, q) {
  return new Promise((resolve) => {
    const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.naturalWidth * s));
    c.height = Math.max(1, Math.round(img.naturalHeight * s));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    c.toBlob((b) => resolve(b), 'image/jpeg', q);
  });
}
// A phone photo (3–8 MB) becomes ~250 KB plus a ~10 KB preview for lists.
async function prepPhoto(file) {
  let img;
  try { img = await loadImg(file); } catch {
    if (file.size > 1800000) throw new Error('No se pudo leer esa foto. Prueba con otra.');
    return { full: file, thumb: null };
  }
  let full = await shrink(img, 1440, 0.74);
  if (full && full.size > 1500000) full = await shrink(img, 1100, 0.6);
  if (!full) throw new Error('No se pudo leer esa foto. Prueba con otra.');
  return { full, thumb: await shrink(img, 320, 0.6) };
}
async function uploadPhoto(path, file) {
  const { full, thumb } = await prepPhoto(file);
  const form = new FormData();
  form.append('photo', full, 'foto.jpg');
  if (thumb) form.append('thumb', thumb, 'mini.jpg');
  let res;
  try { res = await fetch('/api' + path, { method: 'POST', credentials: 'same-origin', body: form }); }
  catch { throw new Error('Sin señal: la foto no se subió. Intenta de nuevo.'); }
  if (!res.ok) {
    let e = {};
    try { e = await res.json(); } catch { /* */ }
    throw new Error(e.error || 'La foto no se subió. Intenta de nuevo.');
  }
}
async function uploadAll(path, files) {
  let ok = 0;
  for (let i = 0; i < files.length; i++) {
    if (files.length > 1 || i > 0) toast(`Subiendo foto ${i + 1} de ${files.length}…`, { ms: 20000 });
    else toast('Subiendo foto…', { ms: 20000 });
    try { await uploadPhoto(path, files[i]); ok++; } catch (e) { toast(e.message, { bad: true }); await new Promise((r) => setTimeout(r, 1800)); }
  }
  if (ok === files.length) $('#toast').classList.remove('show');   // take the "subiendo…" message down
  return ok;
}
// The phone's Back button closes the open sheet or photo instead of leaving the page. Opening one adds a history entry
// (same address); closing it from the screen takes that entry away first and only then goes on, so a navigation that
// follows the sheet never races with it.
const OV = { open: false, onBack: null, after: null };
function ovPush(onBack) {
  OV.onBack = onBack;
  try { history.pushState({ ov: 1 }, ''); OV.open = true; } catch { OV.open = false; }
}
function ovPop(after) {
  if (!OV.open) { OV.onBack = null; return after(); }
  OV.open = false; OV.onBack = null; OV.after = after;
  history.back();
}
window.addEventListener('popstate', () => {
  if (OV.after) { const f = OV.after; OV.after = null; f(); return; }
  if (OV.open && OV.onBack) { OV.open = false; const f = OV.onBack; OV.onBack = null; f(); }
});

function openViewer(photoId, { canDelete = false, onDelete = null } = {}) {
  const v = $('#viewer');
  UI.lastFocus = document.activeElement;
  v.innerHTML = `<div class="vbar"><button class="ib" data-close aria-label="Cerrar foto">${ic('x')}</button>
    ${canDelete ? `<button class="ib" data-del aria-label="Borrar foto">${ic('trash')}</button>` : ''}</div>
    <img src="/api/photos/${photoId}" alt="Foto">`;
  v.classList.remove('hidden');
  document.body.classList.add('lock');
  const hide = () => {
    v.classList.add('hidden'); v.innerHTML = ''; document.body.classList.remove('lock'); openViewer.close = null;
    if (UI.lastFocus && UI.lastFocus.isConnected) UI.lastFocus.focus({ preventScroll: true });
  };
  const close = (then) => { if (v.classList.contains('hidden')) return; hide(); ovPop(() => { if (typeof then === 'function') then(); }); };
  openViewer.close = close;
  ovPush(hide);
  $('[data-close]', v).onclick = () => close();
  v.onclick = (e) => { if (e.target === v) close(); };
  $('[data-close]', v).focus();
  const del = $('[data-del]', v);
  if (del) del.onclick = () => close(() => {
    const thumbs = $$(`[data-photo="${photoId}"]`);
    later('Foto borrada', () => api('DELETE', '/photos/' + photoId), {
      hide: () => thumbs.forEach((el) => el.classList.add('hidden')),
      undo: () => thumbs.forEach((el) => el.classList.remove('hidden')),
      done: onDelete,
    });
  });
}
// Photos already saved, with an "add" tile. inputId = the hidden file input.
function photoGrid(photos, inputId, { add = true, label = 'Agregar foto' } = {}) {
  const input = add ? `<input type="file" id="${inputId}" accept="image/*" multiple hidden>` : '';
  if (!photos.length) return add ? `<label class="b line block addphoto" for="${inputId}" role="button" tabindex="0">${ic('camera')}${label}</label>${input}` : '';
  return `<div class="photos" data-grid="${inputId}">
    ${photos.map((p) => `<button class="ph" type="button" data-photo="${p.id}" data-uid="${p.user_id}" aria-label="Ver foto"><img loading="lazy" src="/api/photos/${p.id}?t=1" alt=""></button>`).join('')}
    ${add ? `<label class="ph add" for="${inputId}" role="button" tabindex="0">${ic('camera')}<span>${label}</span></label>` : ''}
  </div>${input}`;
}
function bindPhotoGrid(root, inputId, uploadPath, reload) {
  $$('[data-photo]', root).forEach((el) => {
    el.onclick = () => openViewer(el.dataset.photo, { canDelete: isAdmin() || Number(el.dataset.uid) === S.user.id, onDelete: reload });
  });
  const input = $('#' + inputId, root);
  if (!input) return;
  const lbl = $(`label[for="${inputId}"]`, root);
  if (lbl) lbl.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } };
  input.onchange = async () => {
    const files = [...input.files];
    input.value = '';
    if (!files.length) return;
    const ok = await uploadAll(uploadPath, files);
    if (ok) toast(ok === 1 ? 'Foto guardada' : `${ok} fotos guardadas`);
    reload();
  };
}
// Photos picked in a form before the thing exists (a new report, "hecho" with a photo). `list` fills with Files.
function pickerHtml(id, { label = 'Tomar foto' } = {}) {
  return `<div class="picker" id="${id}">
    <div class="photos" data-local></div>
    <div class="pickbtns">
      <label class="b tonal grow" for="${id}-cam" role="button" tabindex="0">${ic('camera')}${label}</label>
      <label class="b line" for="${id}-gal" role="button" tabindex="0" aria-label="Elegir de la galería">${ic('image')}<span class="hide-s">Galería</span></label>
    </div>
    <input type="file" id="${id}-cam" accept="image/*" capture="environment" hidden>
    <input type="file" id="${id}-gal" accept="image/*" multiple hidden>
  </div>`;
}
function bindPicker(root, id, list) {
  const box = $('#' + id, root);
  const grid = $('[data-local]', box);
  $$('input[type=file]', box).forEach((inp) => {
    inp.onchange = () => {
      for (const file of inp.files) {
        if (list.length >= 6) { toast('Máximo 6 fotos por reporte', { bad: true }); break; }
        list.push(file);
        const d = document.createElement('div');
        d.className = 'ph';
        d.innerHTML = `<img src="${URL.createObjectURL(file)}" alt="Foto por subir"><button class="x" type="button" aria-label="Quitar foto">${ic('x')}</button>`;
        $('.x', d).onclick = () => { list.splice(list.indexOf(file), 1); d.remove(); };
        grid.appendChild(d);
      }
      inp.value = '';
    };
  });
  $$('label[role=button]', box).forEach((l) => (l.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('#' + l.htmlFor, box).click(); } }));
}

// ---------- toast (with an optional action, e.g. Deshacer) ----------
function toast(msg, { bad = false, action = null, ms = null } = {}) {
  const t = $('#toast');
  t.innerHTML = `<span class="tmsg">${esc(msg)}</span>${action ? `<button type="button">${esc(action.label)}</button>` : ''}`;
  t.className = 'toast show' + (bad ? ' bad' : '');
  const hide = () => { t.className = 'toast' + (bad ? ' bad' : ''); };
  if (action) $('button', t).onclick = () => { hide(); action.fn(); };
  clearTimeout(toast._t);
  toast._t = setTimeout(hide, ms || (action ? 7000 : bad ? 4500 : 2200));
}
// Something destructive, with undo: hides now, really happens when the toast closes unless they tap Deshacer.
const PENDING = new Set();
function later(msg, commit, { hide = null, undo = null, done = null } = {}) {
  let tm = null;
  const job = {
    run: async () => {
      if (!PENDING.has(job)) return;
      PENDING.delete(job); clearTimeout(tm);
      try { await commit(); if (done) done(); } catch (e) { toast(e.message, { bad: true }); if (undo) undo(); }
    },
  };
  PENDING.add(job);
  tm = setTimeout(job.run, 6000);
  if (hide) hide();
  toast(msg, { action: { label: 'Deshacer', fn: () => { PENDING.delete(job); clearTimeout(tm); if (undo) undo(); toast('Deshecho'); } }, ms: 6000 });
}
window.addEventListener('pagehide', () => { UI.unloading = true; for (const j of [...PENDING]) j.run(); });

// ---------- bottom sheet ----------
// opts: a list to pick from (resolves with the option's value). body: free HTML. acts: buttons; an act's value may be a
// function (w) => value, and returning undefined keeps the sheet open (validation failed).
function sheet({ title = '', sub = '', subHtml = '', right = '', cls = '', opts = null, body = '', acts = null, onOpen = null }) {
  return new Promise((resolve) => {
    if (sheet.close) sheet.close();
    $('#toast').classList.remove('show');   // a leftover toast would sit on top of the sheet's buttons
    const w = $('#sheet');
    UI.lastFocus = document.activeElement;
    let lastGroup = null;
    const optHtml = opts ? `<div class="opts" role="listbox">${opts.map((o, i) => {
      const g = o.group && o.group !== lastGroup ? `<div class="ogroup">${esc(o.group)}</div>` : '';
      lastGroup = o.group || lastGroup;
      return `${g}<button type="button" class="opt ${o.on ? 'on' : ''} ${o.cls || ''}" data-opt="${i}" role="option" aria-selected="${!!o.on}">
        ${o.icon ? `<span class="oi">${ic(o.icon)}</span>` : ''}${o.html || ''}<span class="grow"><span class="ol">${esc(o.label)}</span>${o.sub ? `<span class="os">${esc(o.sub)}</span>` : ''}</span>
        ${o.right ? `<span class="or">${esc(o.right)}</span>` : ''}<span class="tick">${ic('check')}</span></button>`;
    }).join('')}</div>` : '';
    w.innerHTML = `<div class="sheet ${cls}" role="dialog" aria-modal="true" aria-label="${esc(title || 'Opciones')}" tabindex="-1">
      <div class="shead"><div class="grow">${title ? `<h2>${esc(title)}</h2>` : ''}${subHtml ? `<p class="sub">${subHtml}</p>` : sub ? `<p class="sub">${esc(sub)}</p>` : ''}</div>
        ${right}<button type="button" class="ib" data-x aria-label="Cerrar">${ic('x')}</button></div>
      <div class="sbody">${body}${optHtml}</div>
      ${acts ? `<div class="acts">${acts.map((a, i) => `<button type="button" class="b ${a.cls || ''}" data-act="${i}">${a.label}</button>`).join('')}</div>` : ''}
    </div>`;
    w.classList.remove('hidden');
    document.body.classList.add('lock');
    let done = false;
    const hide = () => {
      w.classList.add('hidden'); w.innerHTML = ''; w.onclick = null; sheet.close = null; sheet.closeThen = null;
      document.body.classList.remove('lock');
      if (UI.lastFocus && UI.lastFocus.isConnected) UI.lastFocus.focus({ preventScroll: true });
    };
    // closed from the screen: take our history entry away, then answer
    const close = (v) => { if (done) return; done = true; hide(); ovPop(() => resolve(v)); };
    sheet.close = () => close(null);
    // close and then go somewhere: the sheet's history entry is taken away before the address changes
    sheet.closeThen = (fn) => { if (done) return fn(); done = true; hide(); ovPop(() => { resolve(null); fn(); }); };
    // closed with the phone's Back button: the entry is already gone
    ovPush(() => { if (done) return; done = true; hide(); resolve(null); });
    w.onclick = (e) => { if (e.target === w) close(null); };
    $('[data-x]', w).onclick = () => close(null);
    $$('[data-opt]', w).forEach((b) => (b.onclick = () => close(opts[Number(b.dataset.opt)].value)));
    $$('[data-act]', w).forEach((b) => (b.onclick = () => {
      const a = acts[Number(b.dataset.act)];
      const v = typeof a.value === 'function' ? a.value(w) : a.value;
      if (v === undefined) return;
      close(v);
    }));
    const on = $('.opt.on', w);
    if (on) on.scrollIntoView({ block: 'center' });
    // move focus into the sheet, unless the person is already typing in one of its fields
    setTimeout(() => { const s = $('.sheet', w); if (s && !s.contains(document.activeElement)) s.focus({ preventScroll: true }); }, 30);
    if (onOpen) onOpen(w, close);
  });
}
function confirmSheet(title, sub, okLabel, danger = false) {
  return sheet({ title, sub, acts: [{ label: 'Cancelar', cls: 'plain', value: false }, { label: okLabel, cls: danger ? 'danger' : '', value: true }] });
}
function inputSheet(title, value, okLabel, { sub = '', placeholder = '', max = 60 } = {}) {
  return sheet({
    title, sub,
    body: `<div class="pad"><label class="sr" for="sh-in">${esc(title)}</label><input class="input" id="sh-in" type="text" value="${esc(value || '')}" placeholder="${esc(placeholder)}" maxlength="${max}" autocomplete="off" enterkeyhint="done"></div>`,
    acts: [{ label: 'Cancelar', cls: 'plain', value: null }, { label: okLabel, value: (w) => $('#sh-in', w).value.trim() }],
    onOpen: (w, close) => {
      const i = $('#sh-in', w);
      setTimeout(() => i.focus(), 60);
      i.onkeydown = (e) => { if (e.key === 'Enter') close(i.value.trim()); };
    },
  });
}

// ---------- shell ----------
// Laid out the way Horizonte is. Phones: a ribbon of views along the bottom and a floating +. Wide screens: one bar
// along the top. There is no side menu; the lists live in the planner's own panel.
const isDesk = () => matchMedia('(min-width: 960px)').matches;
const MTABS = [
  { tab: 'bandeja', href: '#/bandeja', label: 'Bandeja' },
  { tab: 'atrasados', href: '#/atrasados', label: 'Atrasados' },
  { tab: 'dia', href: '#/', label: 'Día' },
  { tab: 'semana', href: '#/semana', label: 'Semana' },
  { tab: 'todo', href: '#/todo', label: 'Todo' },
];
function navCounts() {
  if (!C.open) return { inbox: UI.inboxN || 0, late: UI.lateN || 0 };
  return { inbox: C.open.filter((t) => !t.due_date).length, late: C.open.filter(isLate).length };
}
function drawNav(tab) {
  const n = navCounts();
  const num = (x) => (x > 99 ? '99+' : x);
  if (isDesk()) {
    const cal = tab === 'dia' || tab === 'semana';
    const lists = P.panel ? 'Ocultar las listas' : 'Mostrar las listas';
    NAV.className = 'nav dtop';
    NAV.innerHTML = `<div class="brandrow">
        ${cal ? `<button type="button" class="ibtn" data-go="panel" aria-pressed="${!!P.panel}" aria-label="${lists}" title="${lists}">${ic('side')}</button>` : ''}
        <a class="dbrand" href="#/" data-tab aria-label="Pulso: ir a hoy">${ic('pulse')}<span>Pulso</span></a></div>
      <div class="zoom" role="group" aria-label="Vista">
        <a href="#/" data-tab ${tab === 'dia' ? 'aria-current="page"' : ''}>Día</a><a href="#/semana" data-tab ${tab === 'semana' ? 'aria-current="page"' : ''}>Semana</a></div>
      ${cal ? `<div class="steps"><button type="button" class="ibtn" data-step="-1" aria-label="${tab === 'semana' ? 'Semana anterior' : 'Día anterior'}">${ic('back')}</button>
        <button type="button" class="tbtn" data-step="0">Hoy</button>
        <button type="button" class="ibtn" data-step="1" aria-label="${tab === 'semana' ? 'Semana siguiente' : 'Día siguiente'}">${ic('chev')}</button>
        <h1 class="dtitle">${esc(planTitle())}</h1></div>` : ''}
      <div class="dright">
        ${cal ? whoSelect() : ''}
        <button type="button" class="ibtn" data-go="contacts" aria-label="Contactos" title="Contactos">${ic('phone')}</button>
        <a class="tbtn dark" href="#/nuevo">${ic('plus')}Reportar</a>
        <a class="dacct" href="#/cuenta" aria-label="Mi cuenta: ${esc(S.user.name)}" title="Mi cuenta">${avatar(S.user.name)}</a></div>`;
    return;
  }
  NAV.className = 'nav mnav';
  NAV.innerHTML = `<a class="fab" href="#/nuevo" aria-label="Reportar un problema">${ic('plus')}</a>
    <div class="mbar">${MTABS.map((t) => `<a href="${t.href}" data-tab ${t.tab === tab ? 'aria-current="page"' : ''}>${t.label}${t.tab === 'bandeja' && n.inbox ? `<span class="n" aria-label="${n.inbox} sin programar">${num(n.inbox)}</span>` : t.tab === 'atrasados' && n.late ? `<span class="n late" aria-label="${plural(n.late, 'atrasado', 'atrasados')}">${num(n.late)}</span>` : ''}</a>`).join('')}</div>`;
  const bar = $('.mbar', NAV);
  const cur = $('[aria-current]', bar);
  if (cur) bar.scrollLeft = cur.offsetLeft - (bar.clientWidth - cur.offsetWidth) / 2;   // the ribbon scrolls sideways: keep the current view in sight
}
// Phones, top of a main screen: menu (tableros, prioridades, cuenta) · title · actions. Inner screens (back: true): arrow, centred title.
const mtop = (title, right = '') => `<div class="mtop"><button type="button" class="pb mmenu" data-go="menu" aria-label="Menú">${ic('grid')}</button><div class="ttl">${title}</div><div class="acts">${right}</div></div>`;
const phoneBtn = () => `<button type="button" class="pb" data-go="contacts" aria-label="Contactos">${ic('phone')}</button>`;
function header(title, { back = false, right = '' } = {}) {
  if (back) {
    return `<header class="top sub"><button class="ib" data-back aria-label="Atrás">${ic('back')}</button>
      <h1>${esc(title)}</h1><div class="hr">${right}</div></header>`;
  }
  return `<header class="mh">${mtop(`<h1 class="date">${esc(title)}</h1>`, right)}</header>`;
}
let inAppNavs = 0;
function goBack(fallback = '#/') {
  if (inAppNavs > 0) history.back();
  else location.hash = fallback;
}
// tab: which view is lit. bar: sticky buttons at the bottom (they take the ribbon's place on phones).
// cal: the planner on a wide screen, which fills the window and scrolls inside itself.
function render(html, { tab = '', bar = '', keepScroll = false, cal = false, skel = false } = {}) {
  const y = window.scrollY;
  APP.innerHTML = html + (bar ? `<div class="actionbar"><div class="abin">${bar}</div></div>` : '');
  document.body.classList.add('authed');
  document.body.classList.toggle('has-bar', !!bar);
  document.body.classList.toggle('cal', !!cal);
  drawNav(tab);
  $$('[data-back]', APP).forEach((b) => (b.onclick = () => goBack(b.dataset.back || '#/')));
  // coming back to a screen puts it where it was left (the router sets UI.backY); a skeleton does not use that up
  const back = skel ? 0 : UI.backY || 0;
  if (!skel) UI.backY = 0;
  window.scrollTo(0, keepScroll ? y : back);
}
function loading(opts) {
  render(`<div class="skel" aria-busy="true" aria-label="Cargando">${'<i></i>'.repeat(5)}</div>`, { ...opts, skel: true });
}
function errorView(msg, opts = {}) {
  render(header('No se pudo abrir', { back: true }) + `<div class="wrap"><div class="empty"><h2>Algo falló</h2><p>${esc(msg)}</p>
    <button class="b tonal" onclick="location.reload()">${ic('refresh')}Volver a intentar</button></div></div>`, opts);
}

// ---------- form pieces ----------
// An error right under the thing that is wrong (and scrolled into view), instead of somewhere down the page.
function fieldErr(el, msg) {
  clearErrs(el.closest('form, .sheet') || document);
  const box = el.closest('.field') || el.parentElement;
  const e = document.createElement('p');
  e.className = 'err ferr'; e.setAttribute('role', 'alert'); e.textContent = msg;
  box.appendChild(e);
  box.scrollIntoView({ block: 'center', behavior: 'smooth' });
  if (el.matches('input, textarea, select')) el.focus({ preventScroll: true });
  return undefined;
}
function clearErrs(root) { $$('.ferr', root).forEach((x) => x.remove()); }
const optTxt = '<span class="opt-l">opcional</span>';
function fInput(id, label, { value = '', type = 'text', placeholder = '', hint = '', optional = false, attrs = '', max = 200 } = {}) {
  return `<div class="field"><label class="flabel" for="${id}">${esc(label)}${optional ? ' ' + optTxt : ''}</label>
    <input class="input" id="${id}" type="${type}" value="${esc(value ?? '')}" placeholder="${esc(placeholder)}" maxlength="${max}" ${attrs}>
    ${hint ? `<p class="hint">${hint}</p>` : ''}</div>`;
}
function fText(id, label, { value = '', placeholder = '', hint = '', optional = false, rows = 3 } = {}) {
  return `<div class="field"><label class="flabel" for="${id}">${esc(label)}${optional ? ' ' + optTxt : ''}</label>
    <textarea class="input" id="${id}" rows="${rows}" maxlength="4000" placeholder="${esc(placeholder)}">${esc(value ?? '')}</textarea>
    ${hint ? `<p class="hint">${hint}</p>` : ''}</div>`;
}
function fSelect(id, label, options, { hint = '', optional = false } = {}) {
  return `<div class="field"><label class="flabel" for="${id}">${esc(label)}${optional ? ' ' + optTxt : ''}</label>
    <select class="input" id="${id}">${options}</select>${hint ? `<p class="hint">${hint}</p>` : ''}</div>`;
}
// One-of-many as big chips. items: [{ v, label, sub?, color?, cls? }]
function choice(name, items, selected, { label = '', cls = '' } = {}) {
  return `<div class="choice ${cls}" role="radiogroup" data-choice="${name}" ${label ? `aria-label="${esc(label)}"` : ''}>
    ${items.map((o) => `<button type="button" role="radio" class="ch ${o.cls || ''} ${o.color ? 'tagc c-' + o.color : ''} ${String(o.v) === String(selected) ? 'on' : ''}" aria-checked="${String(o.v) === String(selected)}" data-v="${esc(o.v)}">
      <span class="cl">${esc(o.label)}</span>${o.sub ? `<span class="cs">${esc(o.sub)}</span>` : ''}</button>`).join('')}</div>`;
}
function bindChoice(root, name, cb, { toggle = false } = {}) {
  const box = $(`[data-choice="${name}"]`, root);
  if (!box) return () => null;
  $$('.ch', box).forEach((b) => (b.onclick = () => {
    const was = b.classList.contains('on');
    $$('.ch', box).forEach((x) => { x.classList.remove('on'); x.setAttribute('aria-checked', 'false'); });
    if (!(toggle && was)) { b.classList.add('on'); b.setAttribute('aria-checked', 'true'); }
    if (cb) cb(toggle && was ? '' : b.dataset.v);
  }));
  return () => { const on = $('.ch.on', box); return on ? on.dataset.v : ''; };
}
const areaChoice = (selected, name = 'area') => choice(name, activeAreas().map((a) => ({ v: a.id, label: a.name, color: a.color })), selected, { label: 'Área', cls: 'tags' });

// The 12 months as toggles (4 × 3), for "N veces al año"
function monthGrid(selected) {
  return `<div class="months" data-months role="group" aria-label="Meses">${MESES.map((m, i) => `<button type="button" class="mo ${selected.includes(i + 1) ? 'on' : ''}" aria-pressed="${selected.includes(i + 1)}" data-m="${i + 1}">${cap(m)}</button>`).join('')}</div>`;
}
function bindMonthGrid(root, cb) {
  const box = $('[data-months]', root);
  const get = () => $$('.mo.on', box).map((b) => Number(b.dataset.m));
  $$('.mo', box).forEach((b) => (b.onclick = () => {
    b.classList.toggle('on');
    b.setAttribute('aria-pressed', b.classList.contains('on'));
    if (cb) cb(get());
  }));
  return { get, set: (ms) => $$('.mo', box).forEach((b) => { const on = ms.includes(Number(b.dataset.m)); b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); }) };
}
// N months spread evenly over the year, starting next month (2 → every 6 months, 4 → every 3…)
function spreadMonths(n) {
  const start = (ymdDate(todayStr()).getMonth() + 1) % 12; // next month, 0-based
  const out = [];
  for (let i = 0; i < n; i++) out.push(((start + Math.round((i * 12) / n)) % 12) + 1);
  return [...new Set(out)].sort((a, b) => a - b);
}
function monthsText(ms) {
  if (!ms.length) return 'Elige al menos un mes';
  if (ms.length === 12) return 'Cada mes';
  return `${ms.length} ${ms.length === 1 ? 'vez' : 'veces'} al año: ${ms.map((m) => MESES[m - 1]).join(', ')}`;
}
// "Sin asignar (lo decide Adrián)": names whoever is set as the coordinator in Cuenta → Personas
function unassignedLabel() {
  const co = S.settings.coordinator ? provOf(S.settings.coordinator) : null;
  return co ? `Sin asignar (lo decide ${first(co.name)})` : 'Sin asignar';
}
function contactOptions(selected, emptyLabel) {
  const avail = S.providers.filter((p) => p.active || p.id === Number(selected));
  const opt = (p) => `<option value="${p.id}" ${Number(selected) === p.id ? 'selected' : ''}>${esc(p.name)}${p.specialty ? ' (' + esc(p.specialty) + ')' : ''}</option>`;
  const ints = avail.filter((p) => p.kind === 'interno');
  const exts = avail.filter((p) => p.kind === 'externo');
  return `<option value="">${esc(emptyLabel)}</option>
    ${ints.length ? `<optgroup label="Equipo de la casa">${ints.map(opt).join('')}</optgroup>` : ''}
    ${exts.length ? `<optgroup label="Externos">${exts.map(opt).join('')}</optgroup>` : ''}`;
}
function equipmentOptions(areaId, selected, emptyLabel = 'Ninguno') {
  const list = S.equipment.filter((e) => (e.active || e.id === Number(selected)) && (!areaId || !e.area_id || e.area_id === Number(areaId) || e.id === Number(selected)));
  return `<option value="">${esc(emptyLabel)}</option>` + list.map((e) => `<option value="${e.id}" ${Number(selected) === e.id ? 'selected' : ''}>${esc(e.name)}</option>`).join('');
}
