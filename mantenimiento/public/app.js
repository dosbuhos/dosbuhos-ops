/* Mantenimiento Dos Búhos (vanilla JS, no build step) */
'use strict';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const APP = $('#app');
const NAV = $('#nav');
const SIDE = $('#side');
const PANEL = $('#panel');

const S = { user: null, areas: [], providers: [], equipment: [], users: [], features: {}, today: null };
const UI = { mainHash: null, panelId: null, lastFocus: null };
const PRIO = { 1: 'Urgente', 2: 'Alta', 3: 'Normal', 4: 'Baja' };
const PRIO_HINT = { 1: 'Peligro, fuga o detiene el servicio', 2: 'Hay que verlo hoy o mañana', 3: 'Esta semana', 4: 'Cuando se pueda' };
const STATUS = { pendiente: 'Por hacer', en_proceso: 'En curso', en_espera: 'Esperando', hecha: 'Hecho', cancelada: 'No aplica' };
const WAIT = { material: 'Esperando material', proveedor: 'Esperando proveedor' };
const OPEN = ['pendiente', 'en_proceso', 'en_espera'];
const PST = { pedido: 'Pedido', comprado: 'Comprado', recibido: 'Recibido', cancelado: 'Cancelado' };
const UNIT = { day: ['día', 'días'], week: ['semana', 'semanas'], month: ['mes', 'meses'] };

// ---------- utils ----------
const ic = (n, cls = '') => `<svg aria-hidden="true"${cls ? ` class="${cls}"` : ''}><use href="#i-${n}"/></svg>`;
function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function store(key, val) {
  try {
    if (val === undefined) return JSON.parse(localStorage.getItem(key));
    localStorage.setItem(key, JSON.stringify(val));
  } catch { return null; }
  return null;
}
const isDesk = () => window.matchMedia('(min-width: 1024px)').matches;
const parseUTC = (s) => (s ? new Date(s.replace(' ', 'T') + 'Z') : null);
const pad2 = (n) => String(n).padStart(2, '0');
const ymdOf = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const todayStr = () => ymdOf(new Date());
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MESES_L = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const ymdDate = (ymd) => { const [y, m, d] = ymd.split('-').map(Number); return new Date(y, m - 1, d); };
function daysBetween(a, b) {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}
function addDays(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
function fmtDay(ymd, { weekday = false } = {}) {
  if (!ymd) return '';
  const d = ymdDate(ymd);
  const diff = daysBetween(todayStr(), ymd);
  if (diff === 0) return 'hoy';
  if (diff === 1) return 'mañana';
  if (diff === -1) return 'ayer';
  return `${weekday ? DIAS[d.getDay()].slice(0, 3) + ' ' : ''}${d.getDate()} ${MESES[d.getMonth()]}${d.getFullYear() === new Date().getFullYear() ? '' : ' ' + d.getFullYear()}`;
}
function fmtDateTime(s) {
  const d = parseUTC(s);
  if (!d) return '';
  const day = ymdOf(d) === todayStr() ? 'hoy' : `${d.getDate()} ${MESES[d.getMonth()]}${d.getFullYear() === new Date().getFullYear() ? '' : ' ' + d.getFullYear()}`;
  return `${day}, ${d.getHours()}:${pad2(d.getMinutes())}`;
}
const localYmd = (s) => { const d = parseUTC(s); return d ? ymdOf(d) : null; };
function rel(s) {
  const d = parseUTC(s);
  if (!d) return '';
  const mins = Math.round((Date.now() - d) / 60000);
  if (mins < 1) return 'ahora';
  if (mins < 60) return `hace ${mins} min`;
  const h = Math.round(mins / 60);
  if (h < 24) return `hace ${h} h`;
  const days = Math.round(h / 24);
  if (days < 30) return `hace ${days} d`;
  return fmtDay(ymdOf(d));
}
const money = (n) => '$' + Number(n || 0).toLocaleString('es-MX', { maximumFractionDigits: 0 });
function waNumber(phone) {
  let d = String(phone || '').replace(/\D/g, '');
  if (d.length === 10) d = '52' + d;
  return d;
}
const telHref = (phone) => 'tel:' + String(phone || '').replace(/[^\d+]/g, '');
const waHref = (phone, text = '') => `https://wa.me/${waNumber(phone)}${text ? '?text=' + encodeURIComponent(text) : ''}`;
const isAdmin = () => !!S.user && S.user.role === 'admin';
const myProv = () => (S.user && S.user.provider_id) || null;
const isDoer = () => isAdmin() || !!myProv();
const areaName = (id) => (S.areas.find((a) => a.id === id) || {}).name || 'Sin área';
const activeProviders = () => S.providers.filter((p) => p.active);
const provLabel = (p) => p.name + (p.company ? ` (${p.company})` : '');
const statusText = (t) => (t.status === 'en_espera' && WAIT[t.wait_reason]) || STATUS[t.status] || t.status;
const isOpen = (t) => OPEN.includes(t.status);
const isLate = (t) => isOpen(t) && t.due_date && t.due_date < todayStr();
const everyText = (n, unit) => (unit === 'once' ? 'Una sola vez' : `Cada ${n > 1 ? n + ' ' : ''}${UNIT[unit][n > 1 ? 1 : 0]}`);
function dueText(t) {
  if (!t.due_date) return '';
  const diff = daysBetween(todayStr(), t.due_date);
  if (!isOpen(t)) return fmtDay(t.due_date);
  if (diff < -1) return `Venció hace ${-diff} días`;
  if (diff === -1) return 'Venció ayer';
  if (diff === 0) return 'Vence hoy';
  if (diff === 1) return 'Vence mañana';
  return `Vence ${fmtDay(t.due_date, { weekday: diff < 7 })}`;
}
const debounce = (fn, ms = 250) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

// ---------- API ----------
async function api(method, path, data) {
  const opts = { method, headers: {}, credentials: 'same-origin', keepalive: !!UI.unloading };
  if (data !== undefined) {
    opts.headers['content-type'] = 'application/json';
    opts.body = JSON.stringify(data);
  }
  let res;
  try { res = await fetch('/api' + path, opts); } catch { throw new Error('Sin conexión. Revisa tu internet e intenta de nuevo.'); }
  let out = {};
  try { out = await res.json(); } catch { /* empty */ }
  if (res.status === 401 && !/^\/(login|setup|auth\/)/.test(path)) {
    S.user = null;
    showLogin();
    throw new Error('Inicia sesión');
  }
  if (!res.ok) throw new Error(out.error || 'Error ' + res.status);
  return out;
}
async function loadBoot() {
  Object.assign(S, await api('GET', '/bootstrap'));
  S.features = S.features || {};
}

// ---------- photos ----------
function compress(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const s = Math.min(1, 1440 / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * s);
        c.height = Math.round(img.naturalHeight * s);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        c.toBlob((b) => resolve(b || file), 'image/jpeg', 0.74);
      } catch { URL.revokeObjectURL(url); resolve(file); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}
async function uploadPhoto(path, file) {
  const blob = await compress(file);
  if (blob.size > 4 * 1024 * 1024) throw new Error('La foto es demasiado grande');
  const res = await fetch('/api' + path, {
    method: 'POST', credentials: 'same-origin',
    headers: { 'content-type': blob.type || 'image/jpeg' }, body: blob,
  });
  if (!res.ok) {
    let e = {};
    try { e = await res.json(); } catch { /* */ }
    throw new Error(e.error || 'No se pudo subir la foto');
  }
}
function openViewer(photoId, { canDelete = false, onDelete = null, caption = '' } = {}) {
  const v = $('#viewer');
  UI.lastFocus = document.activeElement;
  v.innerHTML = `<div class="vbar"><button class="ib" data-close aria-label="Cerrar foto">${ic('x')}</button>
    ${canDelete ? `<button class="ib" data-del aria-label="Borrar foto">${ic('trash')}</button>` : ''}</div>
    <img src="/api/photos/${photoId}" alt="Foto de la orden">${caption ? `<div class="cap">${esc(caption)}</div>` : ''}`;
  v.classList.remove('hidden');
  const close = () => { v.classList.add('hidden'); v.innerHTML = ''; UI.lastFocus && UI.lastFocus.focus && UI.lastFocus.focus(); };
  $('[data-close]', v).onclick = close;
  $('[data-close]', v).focus();
  const del = $('[data-del]', v);
  if (del) del.onclick = () => {
    close();
    const thumbs = $$(`[data-photo="${photoId}"]`);
    later('Foto borrada', () => api('DELETE', '/photos/' + photoId), {
      hide: () => thumbs.forEach((el) => el.classList.add('hidden')),
      undo: () => thumbs.forEach((el) => el.classList.remove('hidden')),
      done: onDelete,
    });
  };
}
// photo picker tiles: returns html; bind with bindPicker
function photoGrid(photos, inputId, { add = true } = {}) {
  return `<div class="photos" data-grid="${inputId}">
    ${add ? `<label class="add" for="${inputId}">${ic('camera')}<span>Foto</span></label>` : ''}
    ${photos.map((p) => `<button class="ph" type="button" data-photo="${p.id}" data-uid="${p.user_id}" aria-label="Ver foto"><img loading="lazy" src="/api/photos/${p.id}" alt=""></button>`).join('')}
  </div><input type="file" id="${inputId}" accept="image/*" multiple hidden>`;
}
function bindPhotoGrid(root, inputId, uploadPath, reload) {
  $$('[data-photo]', root).forEach((el) => {
    el.onclick = () => openViewer(el.dataset.photo, { canDelete: isAdmin() || Number(el.dataset.uid) === S.user.id, onDelete: reload });
  });
  const input = $('#' + inputId, root);
  if (!input) return;
  input.onchange = async () => {
    const files = [...input.files];
    input.value = '';
    if (!files.length) return;
    const grid = $(`[data-grid="${inputId}"]`, root);
    const holders = files.map(() => {
      const d = document.createElement('div');
      d.className = 'ph uploading';
      grid.appendChild(d);
      return d;
    });
    let ok = 0;
    for (const f of files) {
      try { await uploadPhoto(uploadPath, f); ok++; } catch (e) { toast(e.message, { bad: true }); }
    }
    holders.forEach((h) => h.remove());
    if (ok) toast(ok === 1 ? 'Foto agregada' : `${ok} fotos agregadas`);
    reload();
  };
}
// local (not yet uploaded) photos: for forms/sheets
function localPhotos(root, inputSel, gridSel, list) {
  const input = $(inputSel, root);
  const grid = $(gridSel, root);
  const onChange = (inp) => () => {
    for (const file of inp.files) {
      list.push(file);
      const d = document.createElement('div');
      d.className = 'ph';
      d.innerHTML = `<img src="${URL.createObjectURL(file)}" alt="Foto por subir"><button class="x" type="button" aria-label="Quitar foto">${ic('x')}</button>`;
      $('.x', d).onclick = () => { list.splice(list.indexOf(file), 1); d.remove(); };
      grid.appendChild(d);
    }
    inp.value = '';
  };
  $$(inputSel, root).forEach((inp) => (inp.onchange = onChange(inp)));
  return input;
}

// ---------- toast (with optional action, e.g. Deshacer) ----------
function toast(msg, { bad = false, action = null, ms = null } = {}) {
  const t = $('#toast');
  t.innerHTML = `<span class="tmsg">${esc(msg)}</span>${action ? `<button type="button">${esc(action.label)}</button>` : ''}`;
  t.className = 'toast show' + (bad ? ' bad' : '');
  if (action) $('button', t).onclick = () => { hide(); action.fn(); };
  function hide() { t.className = 'toast' + (bad ? ' bad' : ''); }
  clearTimeout(toast._t);
  toast._t = setTimeout(hide, ms || (action ? 6000 : bad ? 4000 : 2000));
}
// Destructive action with undo: hides now, commits after the toast closes unless the user taps Deshacer.
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

// ---------- bottom sheet / dialog ----------
function sheet({ title = '', sub = '', opts = null, body = '', acts = null, onOpen = null, label = '' }) {
  return new Promise((resolve) => {
    const w = $('#sheet');
    UI.lastFocus = document.activeElement;
    let lastGroup = null;
    const optHtml = opts ? `<div class="opts" role="listbox">${opts.map((o, i) => {
      const g = o.group && o.group !== lastGroup ? `<div class="ogroup">${esc(o.group)}</div>` : '';
      lastGroup = o.group || lastGroup;
      return `${g}<button class="opt ${o.on ? 'on' : ''} ${o.cls || ''}" data-opt="${i}" role="option" aria-selected="${!!o.on}">
        ${o.icon ? ic(o.icon) : ''}${o.swatch ? `<span class="sw ${o.swatch}" aria-hidden="true"></span>` : ''}<span class="grow">${esc(o.label)}${o.sub ? `<div class="s">${esc(o.sub)}</div>` : ''}</span>
        <span class="tick">${ic('check')}</span></button>`;
    }).join('')}</div>` : '';
    w.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title || label)}" tabindex="-1"><div class="grab"></div>
      ${title ? `<h3>${esc(title)}</h3>` : ''}${sub ? `<p class="sub">${esc(sub)}</p>` : ''}
      ${optHtml}${body}
      ${acts ? `<div class="acts">${acts.map((a, i) => `<button class="b ${a.cls || ''}" data-act="${i}">${a.label}</button>`).join('')}</div>` : ''}
    </div>`;
    w.classList.remove('hidden');
    const close = (v) => {
      w.classList.add('hidden'); w.innerHTML = ''; w.onclick = null; sheet.close = null;
      if (UI.lastFocus && UI.lastFocus.isConnected) UI.lastFocus.focus();
      resolve(v);
    };
    sheet.close = () => close(null);
    w.onclick = (e) => { if (e.target === w) close(null); };
    $$('[data-opt]', w).forEach((b) => (b.onclick = () => close(opts[Number(b.dataset.opt)].value)));
    $$('[data-act]', w).forEach((b) => (b.onclick = () => {
      const a = acts[Number(b.dataset.act)];
      const v = typeof a.value === 'function' ? a.value(w) : a.value;
      if (v === undefined) return; // validation failed; keep open
      close(v);
    }));
    const first = $('.opt.on, input, textarea, .opt, button', $('.sheet', w));
    setTimeout(() => (first || $('.sheet', w)).focus(), 40);
    if (onOpen) onOpen(w, close);
  });
}
function confirmSheet(title, sub, okLabel, danger = false) {
  return sheet({ title, sub, acts: [{ label: 'Cancelar', cls: 'plain', value: false }, { label: okLabel, cls: danger ? 'danger' : '', value: true }] });
}
function inputSheet(title, value, okLabel, { sub = '', type = 'text', placeholder = '', mode = '' } = {}) {
  return sheet({
    title, sub,
    body: `<div class="pad"><label class="sr" for="sh-in">${esc(title)}</label><input class="input" id="sh-in" type="${type}" ${mode ? `inputmode="${mode}"` : ''} value="${esc(value || '')}" placeholder="${esc(placeholder)}" maxlength="80"></div>`,
    acts: [{ label: 'Cancelar', cls: 'plain', value: null }, { label: okLabel, value: (w) => $('#sh-in', w).value.trim() }],
    onOpen: (w, close) => {
      const i = $('#sh-in', w);
      i.onkeydown = (e) => { if (e.key === 'Enter') close(i.value.trim()); };
    },
  });
}

// ---------- shell ----------
function tabs() {
  const home = isDoer() ? ['today', 'Hoy'] : ['home', 'Inicio'];
  return [
    { tab: 'hoy', href: '#/', icon: home[0], label: home[1] },
    { tab: 'ordenes', href: '#/ordenes', icon: 'tasks', label: 'Órdenes' },
    { tab: 'reportar', href: '#/reportar', icon: 'plus', label: 'Reportar', cls: 'report' },
    { tab: 'equipos', href: '#/equipos', icon: 'wrench', label: 'Equipos' },
    { tab: 'mas', href: '#/mas', icon: 'menu', label: 'Más' },
  ];
}
function drawNav(tab) {
  NAV.innerHTML = tabs().map((t) => `<a href="${t.href}" class="${t.cls || ''} ${t.tab === tab ? 'on' : ''}" ${t.tab === tab ? 'aria-current="page"' : ''}>${ic(t.icon === 'today' ? 'today' : t.icon)}<span>${t.label}</span></a>`).join('');
  const F = S.features || {};
  const items = [
    ['hoy', '#/', isDoer() ? 'today' : 'home', isDoer() ? 'Hoy' : 'Inicio'],
    ['ordenes', '#/ordenes', 'tasks', 'Órdenes'],
    ...(F.pm ? [['preventivo', '#/preventivo', 'repeat', 'Preventivo']] : []),
    ['equipos', '#/equipos', 'wrench', 'Equipos'],
    ['proveedores', '#/proveedores', 'users', 'Proveedores'],
    ...(F.purchases ? [['compras', '#/compras', 'cart', 'Compras']] : []),
    ...(isAdmin() ? [['usuarios', '#/usuarios', 'user', 'Usuarios'], ['areas', '#/areas', 'map', 'Áreas']] : []),
  ];
  SIDE.innerHTML = `<div class="brand"><img class="logo-img" src="/logo-word.png" alt="Dos Búhos"><span>Mantenimiento</span></div>
    <a class="b" href="#/reportar">${ic('plus')}Reportar <span class="kbd" aria-hidden="true">N</span></a>
    ${items.map(([k, h, i, l]) => `<a class="nv ${k === tab ? 'on' : ''}" href="${h}" ${k === tab ? 'aria-current="page"' : ''}>${ic(i)}${l}${k === 'ordenes' && UI.lateN ? `<span class="n bad" aria-label="${UI.lateN} vencidas">${UI.lateN}</span>` : ''}</a>`).join('')}
    <div class="sp"></div>
    <a class="nv ${tab === 'mas' ? 'on' : ''}" href="#/mas">${ic('user')}${esc(S.user.name.split(' ')[0])} · Cuenta</a>
    <div class="me">Atajos: <kbd>/</kbd> buscar · <kbd>N</kbd> reportar · <kbd>Esc</kbd> cerrar</div>`;
}
function header(title, { back = false, close = false, right = '', sub = '', search = false, lined = false } = {}) {
  const gs = search && isDesk()
    ? `<div class="gsearch" role="search">${ic('search')}<label class="sr" for="gsearch">Buscar</label><input id="gsearch" type="search" placeholder="Buscar órdenes, equipos, proveedores" autocomplete="off"><kbd aria-hidden="true">/</kbd></div>`
    : search ? `<a class="ib" href="#/buscar" aria-label="Buscar">${ic('search')}</a>` : '';
  return `<header class="top ${back || close ? 'sub' : ''} ${lined ? 'lined' : ''}">
    ${back || close ? `<button class="ib" data-back aria-label="${close ? 'Cerrar' : 'Atrás'}">${ic(close ? 'x' : 'back')}</button>` : ''}
    <h1>${esc(title)}${sub ? `<small>${esc(sub)}</small>` : ''}</h1>${gs}${right}${back && !right ? '<span style="width:44px"></span>' : ''}</header>`;
}
let inAppNavs = 0;
function goBack(fallback = '#/') {
  if (inAppNavs > 0) history.back();
  else location.hash = fallback;
}
function render(html, { tab = '', bar = '', keepScroll = false, main = true } = {}) {
  const y = window.scrollY;
  APP.innerHTML = html + (bar ? `<div class="actionbar">${bar}</div>` : '');
  document.body.classList.add('authed');
  document.body.classList.toggle('has-bar', !!bar);
  NAV.classList.toggle('hidden', !!bar && !isDesk());
  SIDE.classList.remove('hidden');
  drawNav(tab);
  $$('[data-back]', APP).forEach((b) => (b.onclick = () => goBack()));
  bindGlobalSearch(APP);
  window.scrollTo(0, keepScroll ? y : 0);
  UI.mainHash = main ? location.hash || '#/' : null;
  if (!keepScroll) closePanel(false);
}
function loading(opts) { render(`<div class="skel" aria-busy="true" aria-label="Cargando">${'<i></i>'.repeat(5)}</div>`, Object.assign({ main: false }, opts)); }
function errorView(msg, opts = {}) {
  render(header('No se pudo cargar', { back: true }) + `<div class="wrap"><div class="empty"><h3>Algo falló</h3><p>${esc(msg)}</p>
    <button class="b tonal" onclick="location.reload()">${ic('refresh')}Volver a intentar</button></div></div>`, opts);
}
function bindGlobalSearch(root) {
  const g = $('#gsearch', root);
  if (!g) return;
  g.onkeydown = (e) => {
    if (e.key === 'Enter' && g.value.trim()) location.hash = '#/buscar?q=' + encodeURIComponent(g.value.trim());
    if (e.key === 'Escape') g.blur();
  };
}
// header hides on scroll down (phones), comes back on scroll up
let lastY = 0;
window.addEventListener('scroll', () => {
  const y = window.scrollY;
  const top = $('#app > .top');
  if (top && !isDesk()) top.classList.toggle('tuck', y > 80 && y > lastY + 2);
  if (top && y < lastY - 2) top.classList.remove('tuck');
  if (top) top.classList.toggle('lined', y > 4);
  lastY = y;
}, { passive: true });

// ---------- work order row ----------
function stPill(t) { return `<span class="st st-${t.status}">${esc(statusText(t))}</span>`; }
function woRow(t, { area = true, mark = true, sel = false, move = false } = {}) {
  const late = isLate(t);
  const today = isOpen(t) && t.due_date === todayStr();
  const where = [area ? (t.area_name || 'Sin área') : '', t.equipment_name].filter(Boolean).map(esc).join(' · ');
  const due = isOpen(t) && t.due_date ? `<span class="${late ? 'due-late' : today ? 'due-today' : ''}">${ic(late ? 'alert' : 'cal')}${esc(dueText(t))}</span>`
    : !isOpen(t) && t.completed_at ? `<span>${ic('check')}${fmtDay(localYmd(t.completed_at))}</span>` : '';
  const who = t.provider_id ? `<span>${ic('user')}${esc(t.provider_name)}</span>` : isOpen(t) ? `<span>${ic('inbox')}Sin asignar</span>` : '';
  const canMark = mark && isDoer();
  return `<article class="wo p${t.priority} ${sel ? 'sel' : ''}" data-id="${t.id}" ${move ? 'draggable="true"' : ''} style="--pc:${late || t.priority === 1 ? 'var(--bad)' : t.priority === 2 ? 'var(--warn)' : 'var(--line)'}">
    <div class="meta"><span class="id">#${t.id}</span>${isOpen(t) && t.priority <= 2 ? `<span class="prio">${PRIO[t.priority]}</span>` : ''}${t.kind === 'preventivo' ? `<span class="kindtag">${ic('repeat')}Preventivo</span>` : ''}<span>${where}</span></div>
    <a class="ttl" href="#/t/${t.id}">${esc(t.title)}</a>
    <div class="foot">${due}${who}
      ${t.photo_count ? `<span aria-label="${t.photo_count} fotos">${ic('camera')}${t.photo_count}</span>` : ''}
      ${t.note_count ? `<span aria-label="${t.note_count} notas">${ic('chat')}${t.note_count}</span>` : ''}
      ${t.open_purchases ? `<span aria-label="${t.open_purchases} pedidos de material">${ic('cart')}${t.open_purchases}</span>` : ''}
      ${move ? `<label class="sr" for="mv-${t.id}">Mover orden #${t.id}</label><select class="sel movesel" id="mv-${t.id}" data-move="${t.id}">${['pendiente', 'en_proceso', 'en_espera', 'hecha', 'cancelada'].map((s) => `<option value="${s}" ${t.status === s ? 'selected' : ''}>${s === t.status ? statusText(t) : 'Mover a ' + STATUS[s].toLowerCase()}</option>`).join('')}</select>`
        : canMark ? `<button class="st st-${t.status} stbtn" data-mark="${t.id}" aria-label="Estado: ${esc(statusText(t))}. Cambiar">${esc(statusText(t))}${ic('down')}</button>` : `<span class="stbtn">${stPill(t)}</span>`}
    </div>
  </article>`;
}
// binds quick status buttons inside a list; `byId` maps id → task; reload refreshes the view
function bindRows(root, byId, reload) {
  $$('[data-mark]', root).forEach((b) => (b.onclick = async (e) => {
    e.preventDefault(); e.stopPropagation();
    const t = byId(Number(b.dataset.mark));
    if (t) await markAs(t, { reload });
  }));
  $$('[data-move]', root).forEach((s) => (s.onchange = async () => {
    const t = byId(Number(s.dataset.move));
    const v = s.value;
    s.value = t.status;
    if (t) await markAs(t, { reload, preset: v });
  }));
}

// ---------- "Marcar como…" ----------
const MARK_OPTS = [
  { k: 'pendiente', label: 'Por hacer', sub: 'Todavía nadie empieza', swatch: 'st-pendiente' },
  { k: 'en_proceso', label: 'En curso', sub: 'Ya alguien está trabajando en esto', swatch: 'st-en_proceso' },
  { k: 'en_espera:material', label: 'Esperando material', sub: 'Falta una pieza o insumo; anota qué se pide', swatch: 'st-en_espera' },
  { k: 'en_espera:proveedor', label: 'Esperando proveedor', sub: 'Lo tiene que venir a hacer alguien de fuera', swatch: 'st-en_espera' },
  { k: 'hecha', label: 'Hecho', sub: 'Quedó resuelto; deja nota y foto', swatch: 'st-hecha' },
  { k: 'cancelada', label: 'No aplica', sub: 'Duplicado, no era falla o ya no se necesita', swatch: 'st-cancelada' },
];
const REASONS = {
  'en_espera:proveedor': ['Ya se le llamó', 'Viene esta semana', 'Esperando cotización', 'No contesta'],
  hecha: ['Se reparó', 'Se cambió la pieza', 'Se limpió / ajustó', 'Lo hizo el proveedor'],
  cancelada: ['Duplicado', 'No era una falla', 'Ya se resolvió solo', 'Ya no se necesita'],
};
function curKey(t) { return t.status === 'en_espera' ? 'en_espera:' + (t.wait_reason || 'proveedor') : t.status; }

async function markAs(t, { reload, preset = null } = {}) {
  let key = preset;
  if (!key) {
    const cur = curKey(t);
    const opts = MARK_OPTS.map((o) => ({ value: o.k, label: o.label, sub: o.sub, swatch: o.swatch, on: o.k === cur }));
    key = await sheet({ title: 'Marcar como…', sub: `#${t.id} · ${t.title}`, opts });
    if (!key) return;
  }
  if (key === 'en_espera') key = 'en_espera:proveedor';
  if (key === curKey(t) && !['hecha', 'en_espera:material'].includes(key)) return;
  const [status, wait] = key.split(':');
  const prev = { status: t.status, wait_reason: t.wait_reason };
  // simple moves: one tap, with undo
  if (status === 'pendiente' || status === 'en_proceso') {
    const data = { status };
    if (status === 'en_proceso' && !t.provider_id && myProv()) data.provider_id = myProv();
    return applyStatus(t, data, prev, reload);
  }
  const opt = MARK_OPTS.find((o) => o.k === key);
  const files = [];
  const reasons = REASONS[key] || [];
  const mat = key === 'en_espera:material' && S.features.purchases;
  const res = await sheet({
    title: opt.label, sub: `#${t.id} · ${t.title}`,
    body: `${reasons.length ? `<div class="reasons" role="group" aria-label="Motivos comunes">${reasons.map((r) => `<button type="button" class="chip" data-r="${esc(r)}">${esc(r)}</button>`).join('')}</div>` : ''}
      ${mat ? `<div class="pad"><label class="flabel" for="mk-item">¿Qué material falta?</label>
          <input class="input" id="mk-item" maxlength="200" placeholder="Ej. Capacitor 45/5 µF" autocomplete="off">
          <div class="row2 mt"><div><label class="flabel" for="mk-qty">Cantidad</label><input class="input" id="mk-qty" maxlength="60" placeholder="Ej. 1 pza"></div>
          <div><label class="flabel" for="mk-cost">Costo aprox.</label><input class="input" id="mk-cost" type="number" inputmode="decimal" min="0" step="1" placeholder="$"></div></div>
          <p class="small">Queda en Compras para que alguien lo compre; el costo se suma a la orden.</p></div>` : ''}
      <div class="pad"><label class="flabel" for="mk-note">${key === 'hecha' ? '¿Qué se hizo?' : 'Nota'} <span class="muted">(opcional)</span></label>
        <textarea id="mk-note" maxlength="4000" placeholder="${key === 'hecha' ? 'Ej. Se cambió el flotador y se probó 10 minutos' : 'Algo que el equipo deba saber'}"></textarea></div>
      ${key === 'hecha' ? `<div class="pad"><div class="photos" id="mk-grid"><label class="add" for="mk-cam">${ic('camera')}<span>Foto</span></label></div>
        <input type="file" id="mk-cam" accept="image/*" capture="environment" hidden></div>` : ''}`,
    acts: [{ label: 'Cancelar', cls: 'plain', value: null }, {
      label: `Guardar: ${opt.label}`,
      value: (w) => {
        const r = { note: $('#mk-note', w).value.trim() };
        if (mat) {
          r.item = $('#mk-item', w).value.trim();
          r.qty = $('#mk-qty', w).value.trim();
          r.cost = $('#mk-cost', w).value;
        }
        return r;
      },
    }],
    onOpen: (w) => {
      $$('[data-r]', w).forEach((b) => (b.onclick = () => {
        const n = $('#mk-note', w);
        n.value = n.value ? n.value.replace(/\s*$/, '. ') + b.dataset.r : b.dataset.r;
        b.classList.add('on');
      }));
      if (key === 'hecha') localPhotos(w, '#mk-cam', '#mk-grid', files);
      const f = $('#mk-item', w) || $('#mk-note', w);
      setTimeout(() => f.focus(), 60);
    },
  });
  if (!res) return;
  const data = { status, note: res.note || undefined };
  if (wait) data.wait_reason = wait;
  if (res.item) {
    try { await api('POST', '/purchases', { task_id: t.id, item: res.item, qty: res.qty, cost: res.cost }); } catch (e) { toast(e.message, { bad: true }); }
  }
  await applyStatus(t, data, prev, reload, files);
}
async function applyStatus(t, data, prev, reload, files = []) {
  try {
    await api('PATCH', '/tasks/' + t.id, data);
    for (let i = 0; i < files.length; i++) {
      toast(`Subiendo foto ${i + 1} de ${files.length}…`);
      try { await uploadPhoto(`/tasks/${t.id}/photos`, files[i]); } catch (e) { toast(e.message, { bad: true }); }
    }
    const label = data.status === 'en_espera' ? WAIT[data.wait_reason] || STATUS.en_espera : STATUS[data.status];
    toast(`#${t.id}: ${label}`, {
      action: {
        label: 'Deshacer',
        fn: async () => {
          try { await api('PATCH', '/tasks/' + t.id, { status: prev.status, wait_reason: prev.wait_reason }); toast('Deshecho'); reload && reload(); }
          catch (e) { toast(e.message, { bad: true }); }
        },
      },
    });
    reload && reload();
  } catch (e) { toast(e.message, { bad: true }); }
}

// ---------- assignment ----------
function providerOptions(selected, emptyLabel, short = false) {
  const avail = S.providers.filter((p) => p.active || p.id === Number(selected));
  const opt = (p) => `<option value="${p.id}" ${Number(selected) === p.id ? 'selected' : ''}>${esc(short ? p.name : provLabel(p))}</option>`;
  const ints = avail.filter((p) => p.kind === 'interno');
  const exts = avail.filter((p) => p.kind === 'externo');
  return `<option value="">${esc(emptyLabel)}</option>
    ${ints.length ? `<optgroup label="Personal interno">${ints.map(opt).join('')}</optgroup>` : ''}
    ${exts.length ? `<optgroup label="Proveedores externos">${exts.map(opt).join('')}</optgroup>` : ''}`;
}
function areaOptions(selected, emptyLabel = 'Sin área') {
  return `<option value="">${esc(emptyLabel)}</option>` + S.areas.filter((a) => a.active || a.id === Number(selected))
    .map((a) => `<option value="${a.id}" ${Number(selected) === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('');
}
function equipmentOptions(areaId, selected, emptyLabel = 'Ninguno / no sé') {
  const list = S.equipment.filter((e) => (e.active || e.id === Number(selected)) && (!areaId || e.area_id === Number(areaId) || e.id === Number(selected)));
  return `<option value="">${esc(emptyLabel)}</option>` + list.map((e) => `<option value="${e.id}" ${Number(selected) === e.id ? 'selected' : ''}>${esc(e.name)}</option>`).join('');
}

// ---------- task detail (page on phone, side panel on desktop) ----------
async function loadTask(id) { return api('GET', '/tasks/' + id); }

function taskBody(d, { inPanel = false } = {}) {
  const t = d.task;
  const open = isOpen(t);
  const late = isLate(t);
  const doer = isDoer();
  const notes = d.notes.map((n) => ({ ...n, at: n.created_at, type: n.kind }));
  const photos = d.photos.map((p) => ({ ...p, at: p.created_at, type: 'foto' }));
  const timeline = [...notes, ...photos].sort((a, b) => a.at.localeCompare(b.at) || (a.type === 'foto' ? 1 : -1));
  const matCost = d.purchases.filter((p) => p.status !== 'cancelado').reduce((s, p) => s + (p.cost || 0), 0);
  const steps = [['Recibido', true], ['Asignado', !!t.provider_id || !open], ['En curso', ['en_proceso', 'en_espera', 'hecha'].includes(t.status)], ['Hecho', t.status === 'hecha']];
  return `
    <div class="hero">
      <div class="meta">${open ? `<span class="prio p${t.priority}">${PRIO[t.priority]}</span>` : ''}
        ${t.kind === 'preventivo' ? `<span class="kindtag">${ic('repeat')}Preventivo</span>` : t.kind === 'servicio' ? '<span class="kindtag">Servicio</span>' : ''}
        <span>${esc(t.area_name || 'Sin área')}</span>
        ${t.equipment_id ? `<a href="#/e/${t.equipment_id}">${esc(t.equipment_name)}</a>` : ''}</div>
      <h2 id="t-title">${esc(t.title)}</h2>
      <div class="by">Reportó ${esc(t.created_by_name || 'el plan preventivo')} · ${fmtDateTime(t.created_at)}</div>
    </div>
    ${doer ? `<div class="statusbox"><span class="st st-${t.status}">${esc(statusText(t))}</span>
        <span class="grow">${t.status === 'hecha' && t.completed_at ? 'Terminada ' + fmtDateTime(t.completed_at) : ''}</span>
        <button class="b tonal sm" data-markd>${ic('check')}Marcar como…</button></div>`
      : `<div class="progress" aria-label="Avance">${steps.map(([l, on]) => `<div class="${on ? 'on' : ''}">${l}</div>`).join('')}</div>
         ${t.status === 'cancelada' ? '<p class="small">Mantenimiento la marcó como “No aplica”. Revisa el historial para ver por qué.</p>' : ''}`}
    ${t.description ? `<div class="desc">${esc(t.description)}</div>` : ''}
    <div class="facts">
      <div class="fact ${doer ? 'ctl' : ''}"><label for="d-prov">Responsable</label>${doer
        ? `<select id="d-prov">${providerOptions(t.provider_id, 'Sin asignar', true)}</select>`
        : `<b>${esc(t.provider_name || 'Sin asignar')}</b>`}</div>
      <div class="fact ${doer ? 'ctl' : ''} ${late ? 'late' : ''}"><label for="d-due">${late ? esc(dueText(t)) : 'Fecha límite'}</label>${doer
        ? `<input type="date" id="d-due" value="${esc(t.due_date || '')}">` : `<b>${t.due_date ? esc(fmtDay(t.due_date)) : 'Sin fecha'}</b>`}</div>
      <div class="fact ${doer ? 'ctl' : ''}"><label for="d-prio">Prioridad</label>${doer
        ? `<select id="d-prio">${[1, 2, 3, 4].map((p) => `<option value="${p}" ${t.priority === p ? 'selected' : ''}>${PRIO[p]}</option>`).join('')}</select>`
        : `<b>${PRIO[t.priority]}</b>`}</div>
      ${t.provider_phone && doer && t.provider_id !== myProv() ? `<div class="fact wide"><span>Contacto de ${esc(t.provider_name.split(' ')[0])}</span><div class="row-btns" style="margin-top:4px">
          <a class="b plain sm" href="${telHref(t.provider_phone)}" aria-label="Llamar a ${esc(t.provider_name)}">${ic('phone')}Llamar</a>
          <a class="b wa sm" target="_blank" rel="noopener" href="${waHref(t.provider_phone, `Hola, sobre la orden #${t.id}: ${t.title}`)}" aria-label="WhatsApp a ${esc(t.provider_name)}">${ic('wa')}WhatsApp</a></div></div>` : ''}
    </div>
    <div class="sec"><h2>Fotos</h2><span class="n">${d.photos.length}</span></div>
    <div id="d-photos">${photoGrid(d.photos, 'd-file')}</div>
    ${S.features.purchases && (doer || d.purchases.length) ? `<div class="sec"><h2>Material y costos</h2>${d.purchases.length ? `<span class="n">${d.purchases.length}</span>` : ''}
        ${doer ? '<button class="linkbtn act" data-buy>+ Pedir material</button>' : ''}</div>
      <div class="group">
        ${d.purchases.map((p) => `<div class="mat"><div class="lbl"><div class="t">${esc(p.item)}${p.qty ? ` <span class="muted">· ${esc(p.qty)}</span>` : ''}</div>
            <div class="s">${p.cost ? money(p.cost) + ' · ' : ''}pidió ${esc((p.requested_by_name || '').split(' ')[0])} ${rel(p.created_at)}</div></div>
            <button class="pst pst-${p.status}" data-pu="${p.id}" aria-label="Pedido: ${PST[p.status]}. Cambiar">${PST[p.status]}${ic('down')}</button></div>`).join('')}
        ${d.purchases.length ? '' : `<div class="mat"><div class="lbl"><div class="s">Sin material pedido. Si falta una pieza, pídela aquí para que quede en Compras.</div></div></div>`}
        <div class="costrow"><span class="lbl">Material</span><b class="money">${money(matCost)}</b></div>
        <div class="costrow"><label class="lbl" for="d-cost">Mano de obra y otros</label>${doer ? `<input id="d-cost" type="number" inputmode="decimal" min="0" step="1" value="${t.cost ?? ''}" placeholder="$0">` : `<b class="money">${money(t.cost)}</b>`}</div>
        <div class="costrow"><span class="lbl"><b style="color:var(--ink)">Total</b></span><b class="money" id="d-total">${money(matCost + (t.cost || 0))}</b></div>
      </div>` : ''}
    <div class="sec"><h2>Historial</h2></div>
    <div class="group">
      <ul class="timeline">${timeline.map((n) => n.type === 'sistema'
        ? `<li class="sys"><span class="dot"></span><div class="tx">${esc(n.body)} · ${fmtDateTime(n.at)}</div></li>`
        : n.type === 'foto'
          ? `<li class="nt"><span class="dot"></span><div class="tx"><div class="who"><b>${esc(n.user_name || '—')}</b> agregó una foto · ${fmtDateTime(n.at)}</div>
              <button class="tph" data-photo="${n.id}" data-uid="${n.user_id}" aria-label="Ver foto"><img loading="lazy" src="/api/photos/${n.id}" alt=""></button></div></li>`
          : `<li class="nt" data-note="${n.id}"><span class="dot"></span><div class="tx"><div class="who" style="display:flex;align-items:center"><span><b>${esc(n.user_name || '—')}</b> · ${fmtDateTime(n.at)}</span>
              ${(isAdmin() || n.user_id === S.user.id) ? `<button class="del" data-delnote="${n.id}" aria-label="Borrar nota">Borrar</button>` : ''}</div>
              <div class="body">${esc(n.body)}</div></div></li>`).join('')}</ul>
      <div class="composer"><label class="sr" for="d-note">Escribe una nota</label><textarea id="d-note" rows="1" placeholder="Escribe una nota o pregunta" maxlength="4000"></textarea>
        <button class="ib" id="d-addnote" aria-label="Enviar nota" disabled>${ic('send')}</button></div>
    </div>`;
}
function primaryFor(t) {
  const me = myProv();
  if (!isDoer()) return isOpen(t) ? null : null;
  if (isOpen(t) && !t.provider_id && me) return { act: 'take', label: 'Tomar y empezar', icon: 'play' };
  if (t.status === 'pendiente') return { act: 'start', label: 'Empezar', icon: 'play' };
  if (t.status === 'en_espera') return { act: 'start', label: 'Continuar', icon: 'play' };
  if (t.status === 'en_proceso') return { act: 'finish', label: 'Marcar hecho', icon: 'check' };
  return { act: 'reopen', label: 'Reabrir', icon: 'undo', cls: 'tonal' };
}
function taskBar(t) {
  const p = primaryFor(t);
  return `<label class="ib line" for="d-file" aria-label="Agregar foto">${ic('camera')}</label>
    ${p ? `<button class="b grow ${p.cls || ''}" id="d-primary">${ic(p.icon)}${p.label}</button>` : `<button class="b grow tonal" data-focusnote>${ic('chat')}Escribir nota</button>`}`;
}
function bindTask(root, d, reload) {
  const t = d.task;
  const id = t.id;
  const patch = async (data, msg) => {
    try { await api('PATCH', '/tasks/' + id, data); toast(msg); reload(); refreshLists(); } catch (e) { toast(e.message, { bad: true }); reload(); }
  };
  const after = () => { reload(); refreshLists(); };
  const mk = $('[data-markd]', root);
  if (mk) mk.onclick = () => markAs(t, { reload: after });
  const pr = $('#d-primary', root);
  if (pr) pr.onclick = () => {
    const p = primaryFor(t);
    const prev = { status: t.status, wait_reason: t.wait_reason };
    if (p.act === 'take') applyStatus(t, { provider_id: myProv(), status: 'en_proceso' }, prev, after);
    else if (p.act === 'start') applyStatus(t, { status: 'en_proceso' }, prev, after);
    else if (p.act === 'finish') markAs(t, { reload: after, preset: 'hecha' });
    else applyStatus(t, { status: 'pendiente' }, prev, after);
  };
  const fn = $('[data-focusnote]', root);
  if (fn) fn.onclick = () => $('#d-note', root).focus();
  const prov = $('#d-prov', root);
  if (prov) prov.onchange = () => patch({ provider_id: prov.value || null }, prov.value ? 'Asignada a ' + prov.options[prov.selectedIndex].text : 'Quedó sin asignar');
  const due = $('#d-due', root);
  if (due) due.onchange = () => patch({ due_date: due.value || null }, due.value ? 'Fecha límite: ' + fmtDay(due.value) : 'Sin fecha límite');
  const prio = $('#d-prio', root);
  if (prio) prio.onchange = () => patch({ priority: Number(prio.value) }, 'Prioridad: ' + PRIO[prio.value]);
  const cost = $('#d-cost', root);
  if (cost) cost.onchange = () => patch({ cost: cost.value === '' ? null : cost.value }, 'Costo guardado');
  bindPhotoGrid(root, 'd-file', `/tasks/${id}/photos`, reload);
  $$('.tph', root).forEach((el) => (el.onclick = () => openViewer(el.dataset.photo, { canDelete: isAdmin() || Number(el.dataset.uid) === S.user.id, onDelete: reload })));
  const buy = $('[data-buy]', root);
  if (buy) buy.onclick = () => purchaseSheet({ task_id: id }, reload);
  $$('[data-pu]', root).forEach((b) => (b.onclick = () => purchaseStatus(d.purchases.find((p) => p.id === Number(b.dataset.pu)), reload)));
  const note = $('#d-note', root);
  const send = $('#d-addnote', root);
  note.oninput = () => {
    send.disabled = !note.value.trim();
    note.style.height = 'auto';
    note.style.height = Math.min(160, note.scrollHeight) + 'px';
  };
  note.onkeydown = (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send.click(); };
  send.onclick = async () => {
    const v = note.value.trim();
    if (!v) return;
    send.disabled = true;
    try { await api('POST', `/tasks/${id}/notes`, { body: v }); toast('Nota agregada'); reload(); } catch (e) { toast(e.message, { bad: true }); send.disabled = false; }
  };
  $$('[data-delnote]', root).forEach((b) => (b.onclick = () => {
    const li = b.closest('li');
    later('Nota borrada', () => api('DELETE', '/notes/' + b.dataset.delnote), {
      hide: () => li.classList.add('hidden'), undo: () => li.classList.remove('hidden'),
    });
  }));
}
async function taskMenu(t, { onDeleted } = {}) {
  const link = `${location.origin}/#/t/${t.id}`;
  const text = `*Orden #${t.id}*: ${t.title}\nÁrea: ${t.area_name || 'Sin área'}${t.equipment_name ? '\nEquipo: ' + t.equipment_name : ''}\nPrioridad: ${PRIO[t.priority]}${t.description ? '\n\n' + t.description : ''}\n\n${link}`;
  const opts = [{ value: 'edit', label: 'Editar título, área y detalles', icon: 'edit' }];
  if (t.provider_phone) opts.push({ value: 'wa-prov', label: `Mandar a ${t.provider_name} por WhatsApp`, icon: 'wa' });
  opts.push({ value: 'wa', label: 'Compartir por WhatsApp', icon: 'share' });
  if (isAdmin()) opts.push({ value: 'delete', label: 'Eliminar orden', sub: 'Mejor usa “No aplica” si fue un error; eliminar borra fotos y notas', icon: 'trash', cls: 'danger' });
  const v = await sheet({ title: `Orden #${t.id}`, opts });
  if (v === 'edit') location.hash = `#/t/${t.id}/editar`;
  else if (v === 'wa-prov') window.open(waHref(t.provider_phone, text), '_blank');
  else if (v === 'wa') window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
  else if (v === 'delete') {
    later(`Orden #${t.id} eliminada`, () => api('DELETE', '/tasks/' + t.id), {
      hide: () => onDeleted && onDeleted(),
      undo: () => { location.hash = '#/t/' + t.id; },
      done: () => refreshLists(),
    });
  }
}

async function viewTask(id, keep = false) {
  if (isDesk()) return openPanel(id);
  if (!keep) loading({ tab: 'ordenes' });
  let d;
  try { d = await loadTask(id); } catch (e) { return errorView(e.message, { tab: 'ordenes' }); }
  render(header(`Orden #${d.task.id}`, { back: true, right: `<button class="ib" data-menu aria-label="Más opciones">${ic('more')}</button>` })
    + `<div class="wrap">${taskBody(d)}</div>`, { tab: 'ordenes', keepScroll: keep, bar: taskBar(d.task), main: false });
  bindTask(APP, d, () => viewTask(id, true));
  $('[data-menu]').onclick = () => taskMenu(d.task, { onDeleted: () => goBack('#/ordenes') });
}

// desktop side panel
async function openPanel(id, keep = false) {
  if (!UI.mainHash) { await viewOrders(); UI.mainHash = '#/ordenes'; }
  UI.panelId = Number(id);
  document.body.classList.add('panel-open');
  PANEL.classList.remove('hidden');
  $$('#app .wo, #app tr[data-id]').forEach((el) => el.classList.toggle('sel', Number(el.dataset.id) === UI.panelId));
  if (!keep) PANEL.innerHTML = `<div class="skel" aria-busy="true">${'<i></i>'.repeat(4)}</div>`;
  let d;
  try { d = await loadTask(id); } catch (e) { PANEL.innerHTML = `<div class="wrap"><div class="empty flat"><h3>No se pudo abrir</h3><p>${esc(e.message)}</p></div></div>`; return; }
  if (UI.panelId !== Number(id)) return;
  const y = PANEL.scrollTop;
  PANEL.innerHTML = `<header class="top sub"><button class="ib" data-pclose aria-label="Cerrar detalle (Esc)">${ic('x')}</button><h1>Orden #${d.task.id}</h1>
      <a class="ib" href="#/t/${d.task.id}/editar" aria-label="Editar">${ic('edit')}</a><button class="ib" data-menu aria-label="Más opciones">${ic('more')}</button></header>
    <div class="wrap">${taskBody(d, { inPanel: true })}</div><div class="actionbar">${taskBar(d.task)}</div>`;
  if (keep) PANEL.scrollTop = y;
  bindTask(PANEL, d, () => openPanel(id, true));
  $('[data-pclose]', PANEL).onclick = () => closePanel(true);
  $('[data-menu]', PANEL).onclick = () => taskMenu(d.task, { onDeleted: () => closePanel(true) });
  if (!keep) $('[data-pclose]', PANEL).focus();
}
function closePanel(nav = true) {
  if (PANEL.classList.contains('hidden')) return;
  PANEL.classList.add('hidden');
  PANEL.innerHTML = '';
  document.body.classList.remove('panel-open');
  $$('#app .sel').forEach((el) => el.classList.remove('sel'));
  const id = UI.panelId;
  UI.panelId = null;
  if (nav && UI.mainHash && location.hash !== UI.mainHash) { UI.skipRoute = true; location.hash = UI.mainHash; }
  const row = id && $(`#app [data-id="${id}"] a, #app tr[data-id="${id}"]`);
  if (row && nav) row.focus && row.focus();
}
// lists on screen refresh after a change in the panel
function refreshLists() { if (isDesk() && UI.refresh) UI.refresh(); }

// ---------- task edit form ----------
async function viewTaskEdit(id) {
  loading({ tab: 'ordenes' });
  let t;
  try { t = (await loadTask(id)).task; } catch (e) { return errorView(e.message); }
  render(header(`Editar orden #${id}`, { back: true }) + `<div class="wrap narrow">
    <div class="field"><label class="flabel" for="f-title">¿Qué pasa?</label><input type="text" class="big" id="f-title" maxlength="200" value="${esc(t.title)}"></div>
    <div class="field"><label class="flabel" for="f-desc">Detalles</label><textarea id="f-desc" maxlength="4000">${esc(t.description || '')}</textarea></div>
    <div class="row2"><div class="field"><label class="flabel" for="f-area">Área</label><select id="f-area">${areaOptions(t.area_id)}</select></div>
      <div class="field"><label class="flabel" for="f-equip">Equipo</label><select id="f-equip">${equipmentOptions(t.area_id, t.equipment_id)}</select></div></div>
  </div>`, { tab: 'ordenes', bar: `<button class="b block lg" id="f-save">${ic('check')}Guardar cambios</button>`, main: false });
  $('#f-area').onchange = () => { $('#f-equip').innerHTML = equipmentOptions($('#f-area').value, $('#f-equip').value); };
  $('#f-save').onclick = async () => {
    const data = { title: $('#f-title').value, description: $('#f-desc').value, area_id: $('#f-area').value || null, equipment_id: $('#f-equip').value || null };
    if (!data.title.trim()) { toast('Escribe qué pasa', { bad: true }); return $('#f-title').focus(); }
    try { await api('PATCH', '/tasks/' + id, data); toast('Cambios guardados'); location.replace('#/t/' + id); } catch (e) { toast(e.message, { bad: true }); }
  };
}

// ---------- Hoy (doers) / Inicio (reporters) / dashboard (desktop) ----------
async function viewHome({ silent = false } = {}) {
  if (!isDoer()) return viewMyReports({ silent });
  if (!silent) loading({ tab: 'hoy' });
  let tasks, sum;
  try {
    [tasks, sum] = await Promise.all([api('GET', '/tasks?view=open'), api('GET', '/summary')]);
  } catch (e) { return errorView(e.message, { tab: 'hoy' }); }
  UI.lateN = sum.counts.overdue;
  const me = myProv();
  const scope = me ? (store('mt_scope') || 'mine') : 'all';
  const all = tasks.tasks;
  const pool = scope === 'mine' ? all.filter((t) => t.provider_id === me || !t.provider_id) : all;
  const today = todayStr();
  const week = addDays(today, 7);
  const used = new Set();
  const take = (fn) => pool.filter((t) => !used.has(t.id) && fn(t)).map((t) => (used.add(t.id), t));
  const groups = [
    ['Vencidas', 'bad', take((t) => isLate(t))],
    ['Para hoy', '', take((t) => t.priority === 1 || t.due_date === today)],
    ['En curso', '', take((t) => t.status === 'en_proceso')],
    ['Esperando', '', take((t) => t.status === 'en_espera')],
    ['Próximos 7 días', '', take((t) => t.due_date && t.due_date <= week)],
    ['Más adelante o sin fecha', 'fold', take(() => true)],
  ];
  const byId = (id) => all.find((t) => t.id === id);
  const c = sum.counts;
  const d = ymdDate(today);
  const dateSub = `${DIAS[d.getDay()]} ${d.getDate()} de ${MESES_L[d.getMonth()]}`;
  const listHtml = groups.filter(([, , l]) => l.length).map(([h, cls, l]) => cls === 'fold'
    ? `<details class="fold"><summary>${esc(h)} <span class="n">${l.length}</span>${ic('down')}</summary><div class="list">${l.map((t) => woRow(t)).join('')}</div></details>`
    : `<div class="sec ${cls}"><h2>${esc(h)}</h2><span class="n">${l.length}</span></div><div class="list">${l.map((t) => woRow(t)).join('')}</div>`).join('')
    || `<div class="empty"><h3>Todo en orden</h3><p>No hay nada pendiente${scope === 'mine' ? ' para ti' : ''}.</p><a class="b" href="#/reportar">${ic('plus')}Reportar un problema</a></div>`;
  const tile = (n, label, href, cls = '') => `<a class="stat ${n ? cls : 'zero'}" href="${href}"><b>${n}</b><span>${label}</span></a>`;
  const desk = isDesk();
  const side = desk ? `<div>
      <div class="sec"><h2>Preventivo próximo</h2><a class="linkbtn act" href="#/preventivo">Ver calendario</a></div>
      <div class="group">${sum.pm_next.length ? sum.pm_next.map((p) => `<a class="cell" href="#/preventivo/${p.id}"><span class="ic">${ic('repeat')}</span>
          <span class="lbl"><div class="t">${esc(p.title)}</div><div class="s">${esc(p.equipment_name || p.area_name || '')} · ${esc(everyText(p.every_n, p.unit))}</div></span>
          <span class="val ${p.next_due < today ? 'due-late' : ''}">${esc(fmtDay(p.next_due))}</span></a>`).join('')
        : `<div class="cell"><span class="lbl"><span class="s">${S.features.pm ? 'Nada en las próximas 3 semanas.' : 'Disponible al aplicar la migración 0005.'}</span></span></div>`}</div>
      <div class="sec"><h2>Compras</h2><a class="linkbtn act" href="#/compras">Ver compras</a></div>
      <div class="group"><a class="cell" href="#/compras"><span class="ic">${ic('cart')}</span><span class="lbl"><div class="t">${sum.purchases.pending} por comprar · ${sum.purchases.bought} por recibir</div>
        <div class="s">Gastado este mes: material ${money(sum.material_month)} · mano de obra ${money(sum.labor_month)}</div></span></a></div>
      <div class="sec"><h2>Fallas que se repiten</h2><span class="n">90 días</span></div>
      <div class="group">${sum.recurring.length ? sum.recurring.map((e) => `<a class="cell" href="#/e/${e.id}"><span class="ic">${ic('wrench')}</span>
          <span class="lbl"><div class="t">${esc(e.name)}</div><div class="s">${esc(e.area_name || '')}</div></span><span class="val due-late">${e.n} fallas</span></a>`).join('')
        : '<div class="cell"><span class="lbl"><span class="s">Ningún equipo con 2 o más fallas.</span></span></div>'}</div>
    </div>` : '';
  render(header(desk ? 'Hoy' : 'Hoy', { sub: dateSub, search: true }) + `<div class="wrap">
    ${desk ? `<div class="tiles">
        ${tile(c.open, 'Abiertas', '#/ordenes')}${tile(c.overdue, 'Vencidas', '#/ordenes?f=vencidas', 'bad')}${tile(c.week, 'Vencen esta semana', '#/ordenes?f=semana', 'warn')}
        ${tile(c.waiting, 'Esperando', '#/ordenes?f=en_espera')}${tile(c.unassigned, 'Sin asignar', '#/ordenes?f=sin_asignar', 'warn')}
        <a class="stat" href="#/compras"><b class="money">${money(sum.cost_month)}</b><span>Costos del mes</span></a></div>`
      : `<div class="stats">${tile(pool.filter(isLate).length, 'Vencidas', '#/ordenes?f=vencidas', 'bad')}${tile(pool.filter((t) => t.priority === 1).length, 'Urgentes', '#/ordenes?f=urgentes', 'bad')}${tile(c.unassigned, 'Sin asignar', '#/ordenes?f=sin_asignar', 'warn')}</div>`}
    ${S.features.ready === false && isAdmin() ? `<div class="banner">${ic('alert')}<span>Falta aplicar la migración <b>0005</b> en la base de datos: preventivo y compras aparecen cuando se aplique.</span></div>` : ''}
    <div class="${desk ? 'dash' : ''}"><div>
      ${me ? `<div class="seg" role="tablist" aria-label="Qué mostrar" style="margin-top:8px">
          <button role="tab" data-scope="mine" class="${scope === 'mine' ? 'on' : ''}" aria-selected="${scope === 'mine'}">Mías y sin asignar</button>
          <button role="tab" data-scope="all" class="${scope === 'all' ? 'on' : ''}" aria-selected="${scope === 'all'}">Todas</button></div>` : ''}
      ${listHtml}
    </div>${side}</div>
  </div>`, { tab: 'hoy', keepScroll: silent });
  bindRows(APP, byId, () => viewHome({ silent: true }));
  $$('[data-scope]').forEach((b) => (b.onclick = () => { store('mt_scope', b.dataset.scope); viewHome({ silent: true }); }));
  UI.refresh = () => viewHome({ silent: true });
  if (UI.panelId) $$('#app .wo').forEach((el) => el.classList.toggle('sel', Number(el.dataset.id) === UI.panelId));
}

async function viewMyReports({ silent = false } = {}) {
  if (!silent) loading({ tab: 'hoy' });
  let tasks;
  try { tasks = (await api('GET', '/tasks?view=all&mine=1&limit=60')).tasks; } catch (e) { return errorView(e.message, { tab: 'hoy' }); }
  const open = tasks.filter(isOpen);
  const done = tasks.filter((t) => !isOpen(t));
  render(header(`Hola, ${S.user.name.split(' ')[0]}`, { sub: 'Tus reportes a mantenimiento', search: true }) + `<div class="wrap narrow">
    <a class="b block lg" href="#/reportar" style="margin:6px 0 4px">${ic('camera')}Reportar un problema</a>
    <p class="small center" style="margin:4px 0 0">Foto, lugar y qué pasa. Toma menos de un minuto.</p>
    <div class="sec"><h2>En proceso</h2><span class="n">${open.length}</span></div>
    ${open.length ? `<div class="list">${open.map((t) => woRow(t, { mark: false })).join('')}</div>` : '<div class="empty flat"><p>No tienes reportes abiertos.</p></div>'}
    ${done.length ? `<div class="sec"><h2>Resueltos</h2><span class="n">${done.length}</span></div><div class="list">${done.slice(0, 20).map((t) => woRow(t, { mark: false })).join('')}</div>` : ''}
  </div>`, { tab: 'hoy', keepScroll: silent });
  UI.refresh = () => viewMyReports({ silent: true });
}

// ---------- Órdenes ----------
const F_STATUS = [
  ['abiertas', 'Abiertas'], ['vencidas', 'Vencidas'], ['urgentes', 'Urgentes'], ['semana', 'Vencen esta semana'], ['sin_asignar', 'Sin asignar'],
  ['pendiente', 'Por hacer'], ['en_proceso', 'En curso'], ['en_espera', 'Esperando'], ['hechas', 'Hechas y no aplica'], ['mias', 'Reporté yo'],
];
const OV = { tasks: [], more: false, key: null };
function orderFilters(query = {}) {
  const f = Object.assign({ f: 'abiertas', area: '', prov: '', prio: '', q: '' }, store('mt_of') || {});
  if (query.f) Object.assign(f, { f: query.f, area: '', prov: '', prio: '' });
  return f;
}
function filterTasks(list, f) {
  const today = todayStr();
  const week = addDays(today, 7);
  return list.filter((t) => {
    if (f.f === 'vencidas' && !isLate(t)) return false;
    if (f.f === 'urgentes' && !(isOpen(t) && t.priority === 1)) return false;
    if (f.f === 'semana' && !(isOpen(t) && t.due_date && t.due_date >= today && t.due_date <= week)) return false;
    if (f.f === 'sin_asignar' && !(isOpen(t) && !t.provider_id)) return false;
    if (['pendiente', 'en_proceso', 'en_espera'].includes(f.f) && t.status !== f.f) return false;
    if (f.area && String(t.area_id || 0) !== f.area) return false;
    if (f.prov && (f.prov === 'none' ? t.provider_id : String(t.provider_id) !== f.prov)) return false;
    if (f.prio && String(t.priority) !== f.prio) return false;
    if (f.q) {
      const q = f.q.toLowerCase();
      if (![t.title, t.description, t.equipment_name, t.provider_name, t.area_name, t.created_by_name, '#' + t.id].join(' ').toLowerCase().includes(q)) return false;
    }
    return true;
  });
}
const serverKey = (f, view) => (view === 'tablero' ? 'board' : f.f === 'hechas' ? 'done' : f.f === 'mias' ? 'mine' : 'open');
async function fetchOrders(key, more = false) {
  const path = key === 'done' ? '/tasks?view=done&limit=60' : key === 'mine' ? '/tasks?view=all&mine=1&limit=100'
    : key === 'board' ? null : '/tasks?view=open';
  if (key === 'board') {
    const [o, d] = await Promise.all([api('GET', '/tasks?view=open'), api('GET', `/tasks?view=done&limit=40&from=${addDays(todayStr(), -14)}`)]);
    return { tasks: [...o.tasks, ...d.tasks], more: false };
  }
  return api('GET', path + (more ? `&offset=${OV.tasks.length}` : ''));
}

async function viewOrders(query = {}, { silent = false } = {}) {
  const f = orderFilters(query);
  if (query.f) store('mt_of', f);
  const desk = isDesk();
  const view = desk ? (query.v || store('mt_ov') || 'lista') : 'lista';
  if (view === 'calendario') return viewOrdersCalendar(query);
  const key = serverKey(f, view);
  if (!silent || OV.key !== key) {
    if (!silent) loading({ tab: 'ordenes' });
    try { const r = await fetchOrders(key); OV.tasks = r.tasks; OV.more = r.more; OV.key = key; } catch (e) { return errorView(e.message, { tab: 'ordenes' }); }
  }
  drawOrders(f, view, { keepScroll: silent });
}
function filterControls(f, { mobile = false } = {}) {
  const statusSel = `<label class="sr" for="of-f">Estado</label><select class="sel ${f.f !== 'abiertas' ? 'on' : ''}" id="of-f">${F_STATUS.map(([v, l]) => `<option value="${v}" ${f.f === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  const areaSel = `<label class="sr" for="of-area">Área</label><select class="sel ${f.area ? 'on' : ''}" id="of-area"><option value="">Todas las áreas</option>${S.areas.filter((a) => a.active).map((a) => `<option value="${a.id}" ${f.area === String(a.id) ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select>`;
  const provSel = `<label class="sr" for="of-prov">Responsable</label><select class="sel ${f.prov ? 'on' : ''}" id="of-prov"><option value="">Todos</option><option value="none" ${f.prov === 'none' ? 'selected' : ''}>Sin asignar</option>
    ${activeProviders().map((p) => `<option value="${p.id}" ${f.prov === String(p.id) ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>`;
  const prioSel = `<label class="sr" for="of-prio">Prioridad</label><select class="sel ${f.prio ? 'on' : ''}" id="of-prio"><option value="">Toda prioridad</option>${[1, 2, 3, 4].map((p) => `<option value="${p}" ${f.prio === String(p) ? 'selected' : ''}>${PRIO[p]}</option>`).join('')}</select>`;
  return mobile ? `<div class="filters">${statusSel}${areaSel}${provSel}</div>` : statusSel + prioSel + areaSel + provSel;
}
const SORTS = {
  id: (t) => t.id, title: (t) => t.title.toLowerCase(), area: (t) => (t.area_name || '') + (t.equipment_name || ''), prio: (t) => t.priority,
  status: (t) => ['pendiente', 'en_proceso', 'en_espera', 'hecha', 'cancelada'].indexOf(t.status), prov: (t) => t.provider_name || '~',
  due: (t) => t.due_date || '9999', cost: (t) => (t.cost || 0) + (t.material_cost || 0), created: (t) => t.created_at,
};
function drawOrders(f, view, { keepScroll = false } = {}) {
  const desk = isDesk();
  const shown = filterTasks(OV.tasks, f);
  const byId = (id) => OV.tasks.find((t) => t.id === id);
  const sort = store('mt_sort') || { k: null, dir: 1 };
  let content;
  if (!shown.length) {
    const filtered = f.area || f.prov || f.prio || f.q || f.f !== 'abiertas';
    content = `<div class="empty"><h3>${filtered ? 'Nada con estos filtros' : 'Todo en orden'}</h3><p>${filtered ? 'Prueba quitando un filtro.' : 'No hay órdenes abiertas.'}</p>
      ${filtered ? '<button class="b tonal" data-clear>Quitar filtros</button>' : `<a class="b" href="#/reportar">${ic('plus')}Reportar un problema</a>`}</div>`;
  } else if (desk && view === 'tablero') {
    const cols = [['pendiente', 'Por hacer'], ['en_proceso', 'En curso'], ['en_espera', 'Esperando'], ['hecha', 'Hecho (14 días)']];
    content = `<div class="board">${cols.map(([s, l]) => {
      const items = shown.filter((t) => t.status === s);
      return `<section class="col" data-col="${s}" aria-label="${l}"><h3><span class="st st-${s}">${l}</span><span class="n">${items.length}</span></h3>
        <div class="list">${items.map((t) => woRow(t, { move: true, sel: t.id === UI.panelId })).join('')}</div></section>`;
    }).join('')}</div>`;
  } else if (desk) {
    const list = [...shown];
    if (sort.k && SORTS[sort.k]) list.sort((a, b) => { const x = SORTS[sort.k](a); const y = SORTS[sort.k](b); return (x < y ? -1 : x > y ? 1 : 0) * sort.dir; });
    const th = (k, l, cls = '') => `<th class="${cls}" aria-sort="${sort.k === k ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none'}"><button data-sort="${k}">${l}${sort.k === k ? ic(sort.dir > 0 ? 'up' : 'down') : ''}</button></th>`;
    content = `<table class="tbl"><thead><tr>${th('id', '#')}${th('title', 'Orden')}${th('area', 'Área / equipo', 'opt opt2')}${th('prio', 'Prioridad')}${th('status', 'Estado')}${th('prov', 'Responsable', 'opt')}${th('due', 'Fecha límite')}${th('cost', 'Costo', 'num opt')}</tr></thead>
      <tbody>${list.map((t) => `<tr data-id="${t.id}" class="${t.id === UI.panelId ? 'sel' : ''}">
        <td class="muted">${t.id}</td>
        <td><a class="rowlink" href="#/t/${t.id}">${esc(t.title)}</a>${t.kind === 'preventivo' ? ` <span class="kindtag">${ic('repeat')}Preventivo</span>` : ''}<div class="s"><span class="area2">${esc(t.area_name || 'Sin área')} · </span>Reportó ${esc((t.created_by_name || 'plan preventivo').split(' ')[0])} ${rel(t.created_at)}</div></td>
        <td class="opt opt2">${esc(t.area_name || 'Sin área')}${t.equipment_name ? `<div class="s">${esc(t.equipment_name)}</div>` : ''}</td>
        <td><span class="prio p${t.priority}">${PRIO[t.priority]}</span></td>
        <td>${isDoer() ? `<button class="st st-${t.status}" data-mark="${t.id}" aria-label="Estado: ${esc(statusText(t))}. Cambiar">${esc(statusText(t))}${ic('down')}</button>` : stPill(t)}</td>
        <td class="opt">${t.provider_name ? esc(t.provider_name) : '<span class="muted">Sin asignar</span>'}</td>
        <td class="due ${isLate(t) ? 'due-late' : ''}">${t.due_date ? esc(isOpen(t) ? dueText(t) : fmtDay(t.due_date)) : '<span class="muted">—</span>'}</td>
        <td class="num money opt">${(t.cost || 0) + (t.material_cost || 0) ? money((t.cost || 0) + (t.material_cost || 0)) : '<span class="muted">—</span>'}</td></tr>`).join('')}</tbody></table>`;
  } else {
    content = `<div class="list">${shown.map((t) => woRow(t)).join('')}</div>`;
  }
  const more = OV.more && ['done', 'mine'].includes(OV.key) ? `<button class="b plain block mt" data-more>Cargar más</button>` : '';
  const vSeg = desk ? `<div class="seg" role="tablist" aria-label="Vista">${[['lista', 'list', 'Lista'], ['tablero', 'board', 'Tablero'], ['calendario', 'cal', 'Calendario']].map(([v, i, l]) =>
    `<button role="tab" data-v="${v}" class="${view === v ? 'on' : ''}" aria-selected="${view === v}">${ic(i)}${l}</button>`).join('')}</div>` : '';
  render(header('Órdenes', { search: true }) + `<div class="wrap">
    ${desk ? `<div class="toolbar">${vSeg}<span class="grow"></span>
        <label class="sr" for="of-q">Filtrar esta lista</label><input class="sel" id="of-q" type="search" placeholder="Filtrar esta lista" value="${esc(f.q)}" style="background-image:none;min-width:220px"></div>
      <div class="toolbar">${filterControls(f)}${f.f !== 'abiertas' || f.area || f.prov || f.prio || f.q ? '<button class="linkbtn" data-clear>Quitar filtros</button>' : ''}
        <span class="count">${shown.length} ${shown.length === 1 ? 'orden' : 'órdenes'}</span></div>`
      : `${filterControls(f, { mobile: true })}<div class="countline"><span>${shown.length} ${shown.length === 1 ? 'orden' : 'órdenes'}${f.f === 'abiertas' ? ' · lo más urgente arriba' : ''}</span>
        ${f.f !== 'abiertas' || f.area || f.prov ? '<button class="linkbtn" data-clear>Quitar filtros</button>' : ''}</div>`}
    ${content}${more}
  </div>`, { tab: 'ordenes', keepScroll });
  const set = (k, v) => { f[k] = v; store('mt_of', f); const nk = serverKey(f, view); if (nk !== OV.key) viewOrders({}, { silent: true }); else drawOrders(f, view, { keepScroll: true }); };
  $('#of-f').onchange = (e) => set('f', e.target.value);
  $('#of-area').onchange = (e) => set('area', e.target.value);
  $('#of-prov').onchange = (e) => set('prov', e.target.value);
  const pr = $('#of-prio');
  if (pr) pr.onchange = (e) => set('prio', e.target.value);
  const q = $('#of-q');
  if (q) q.oninput = debounce(() => { f.q = q.value; store('mt_of', f); drawOrders(f, view, { keepScroll: true }); setTimeout(() => { const n = $('#of-q'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }); }, 300);
  $$('[data-clear]').forEach((b) => (b.onclick = () => { Object.assign(f, { f: 'abiertas', area: '', prov: '', prio: '', q: '' }); store('mt_of', f); viewOrders({}, { silent: true }); }));
  $$('[data-v]').forEach((b) => (b.onclick = () => { store('mt_ov', b.dataset.v); viewOrders({ v: b.dataset.v }); }));
  $$('[data-sort]').forEach((b) => (b.onclick = () => { const k = b.dataset.sort; store('mt_sort', { k, dir: sort.k === k ? -sort.dir : 1 }); drawOrders(f, view, { keepScroll: true }); }));
  const mb = $('[data-more]');
  if (mb) mb.onclick = async () => { mb.disabled = true; try { const r = await fetchOrders(OV.key, true); OV.tasks = OV.tasks.concat(r.tasks); OV.more = r.more; drawOrders(f, view, { keepScroll: true }); } catch (e) { toast(e.message, { bad: true }); mb.disabled = false; } };
  $$('#app tr[data-id]').forEach((tr) => (tr.onclick = (e) => { if (e.target.closest('button,a,select')) return; location.hash = '#/t/' + tr.dataset.id; }));
  bindRows(APP, byId, () => viewOrders({}, { silent: true }));
  if (view === 'tablero') bindBoard(byId);
  UI.refresh = () => viewOrders({}, { silent: true });
}
function bindBoard(byId) {
  let dragId = null;
  $$('.col .wo').forEach((el) => {
    el.ondragstart = (e) => { dragId = Number(el.dataset.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(dragId)); };
  });
  $$('.col').forEach((col) => {
    col.ondragover = (e) => { e.preventDefault(); col.classList.add('drop'); };
    col.ondragleave = () => col.classList.remove('drop');
    col.ondrop = async (e) => {
      e.preventDefault(); col.classList.remove('drop');
      const t = byId(dragId || Number(e.dataTransfer.getData('text/plain')));
      if (!t || t.status === col.dataset.col) return;
      await markAs(t, { reload: () => viewOrders({}, { silent: true }), preset: col.dataset.col });
    };
  });
}

// ---------- calendar (orders due + preventive) ----------
function monthOf(query) {
  const m = /^\d{4}-\d{2}$/.test(query.m || '') ? query.m : todayStr().slice(0, 7);
  return m;
}
function monthShift(m, n) { const [y, mo] = m.split('-').map(Number); const d = new Date(Date.UTC(y, mo - 1 + n, 1)); return d.toISOString().slice(0, 7); }
async function calendarHtml(m, base, { pmOnly = false } = {}) {
  const [y, mo] = m.split('-').map(Number);
  const first = new Date(y, mo - 1, 1);
  const startOff = (first.getDay() + 6) % 7; // weeks start Monday
  const gridStart = addDays(`${m}-01`, -startOff);
  const daysIn = new Date(y, mo, 0).getDate();
  const cells = Math.ceil((startOff + daysIn) / 7) * 7;
  const gridEnd = addDays(gridStart, cells - 1);
  const data = await api('GET', `/calendar?from=${gridStart}&to=${gridEnd}`);
  const byDay = {};
  if (pmOnly) data.tasks = data.tasks.filter((t) => t.kind === 'preventivo');
  data.tasks.forEach((t) => (byDay[t.due_date] ||= []).push({ t }));
  data.planned.filter((p) => !data.tasks.some((t) => t.pm_id === p.pm_id && t.due_date === p.date)).forEach((p) => (byDay[p.date] ||= []).push({ p }));
  const today = todayStr();
  const ev = ({ t, p }) => t
    ? `<a class="ev st-${t.status} ${isLate(t) ? 'late' : ''}" href="#/t/${t.id}" title="${esc(t.title)}">${esc(t.title)}</a>`
    : `<a class="ev plan" href="#/preventivo/${p.pm_id}" title="Preventivo: ${esc(p.title)}">${esc(p.title)}</a>`;
  let grid = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'].map((d) => `<div class="dow">${d}</div>`).join('');
  for (let i = 0; i < cells; i++) {
    const day = addDays(gridStart, i);
    const items = byDay[day] || [];
    grid += `<div class="cd ${day.slice(0, 7) !== m ? 'out' : ''} ${day === today ? 'today' : ''}"><span class="num">${Number(day.slice(8))}</span>
      ${items.slice(0, 4).map(ev).join('')}${items.length > 4 ? `<span class="more">+${items.length - 4} más</span>` : ''}</div>`;
  }
  const agendaDays = Object.keys(byDay).filter((d) => d.slice(0, 7) === m).sort();
  const agenda = agendaDays.map((day) => `<div class="day ${day === today ? 'today' : ''}"><h4>${DIAS[ymdDate(day).getDay()]} ${Number(day.slice(8))}${day === today ? ' · hoy' : ''}</h4>
    ${byDay[day].map(({ t, p }) => t
      ? `<a class="calitem" href="#/t/${t.id}"><span class="lbl">${esc(t.title)}<div class="s"><b class="${isLate(t) ? 'due-late' : ''}">${esc(statusText(t))}</b> · ${esc(t.area_name || '')}${t.equipment_name ? ' · ' + esc(t.equipment_name) : ''}</div></span></a>`
      : `<a class="calitem plan" href="#/preventivo/${p.pm_id}">${ic('repeat')}<span class="lbl">${esc(p.title)}<div class="s">Preventivo programado${p.provider_name ? ' · ' + esc(p.provider_name) : ''}</div></span></a>`).join('')}</div>`).join('')
    || '<div class="empty flat"><p>Nada programado este mes.</p></div>';
  return `<div class="stepper"><a class="ib line" href="${base}m=${monthShift(m, -1)}" aria-label="Mes anterior">${ic('back')}</a>
      <h3>${MESES_L[mo - 1]} ${y}</h3><a class="ib line" href="${base}m=${monthShift(m, 1)}" aria-label="Mes siguiente">${ic('fwd')}</a></div>
    <div class="calgrid">${grid}</div><div class="agenda mob">${agenda}</div>
    <p class="small" style="margin-top:8px">Las órdenes aparecen en su fecha límite; los cuadros con borde son preventivos que se van a crear solos.</p>`;
}
async function viewOrdersCalendar(query) {
  loading({ tab: 'ordenes' });
  const m = monthOf(query);
  let cal;
  try { cal = await calendarHtml(m, '#/ordenes?v=calendario&'); } catch (e) { return errorView(e.message, { tab: 'ordenes' }); }
  render(header('Órdenes', { search: true }) + `<div class="wrap"><div class="toolbar"><div class="seg" role="tablist" aria-label="Vista">${[['lista', 'list', 'Lista'], ['tablero', 'board', 'Tablero'], ['calendario', 'cal', 'Calendario']].map(([v, i, l]) =>
    `<button role="tab" data-v="${v}" class="${v === 'calendario' ? 'on' : ''}" aria-selected="${v === 'calendario'}">${ic(i)}${l}</button>`).join('')}</div></div>${cal}</div>`, { tab: 'ordenes' });
  $$('[data-v]').forEach((b) => (b.onclick = () => { store('mt_ov', b.dataset.v); viewOrders({ v: b.dataset.v }); }));
  UI.refresh = () => viewOrdersCalendar(query);
}

// ---------- Reportar un problema ----------
async function viewReport(query = {}) {
  const doer = isDoer();
  const lastArea = store('mt_last_area');
  let areaId = query.area ? Number(query.area) : null;
  const eqId = query.equipment ? Number(query.equipment) : null;
  const eq = eqId && S.equipment.find((e) => e.id === eqId);
  if (eq) areaId = eq.area_id;
  if (!areaId && S.areas.some((a) => a.id === lastArea && a.active)) areaId = lastArea;
  let prio = 3;
  const files = [];
  const areas = S.areas.filter((a) => a.active || a.id === areaId);
  render(header('Reportar un problema', { close: true }) + `<div class="wrap narrow">
    <div class="field"><span class="flabel" id="lb-area">¿Dónde?</span>
      <div class="chipwrap" id="f-area" role="radiogroup" aria-labelledby="lb-area">${areas.map((a) =>
        `<button type="button" role="radio" aria-checked="${areaId === a.id}" class="chip ${areaId === a.id ? 'on' : ''}" data-id="${a.id}">${esc(a.name)}</button>`).join('')}</div></div>
    <div class="field"><label class="flabel" for="f-title">¿Qué pasa?</label>
      <textarea id="f-title" class="big" maxlength="1000" rows="3" placeholder="Ej. Gotea la llave de la tarja; ya se cerró la llave de paso" style="min-height:84px"></textarea></div>
    <div class="field"><span class="flabel">Foto</span>
      <div class="camrow"><label class="b plain" for="f-cam">${ic('camera')}Tomar foto</label><label class="b plain" for="f-gal">${ic('image')}De la galería</label></div>
      <input type="file" id="f-cam" accept="image/*" capture="environment" hidden><input type="file" id="f-gal" accept="image/*" multiple hidden>
      <div class="photos" id="f-photos"></div></div>
    <div class="field"><span class="flabel" id="lb-urg">¿Qué tan urgente?</span><p class="why">Ayuda a decidir qué se atiende primero.</p>
      <div class="urg" role="radiogroup" aria-labelledby="lb-urg">${[1, 2, 3, 4].map((p) => `<button type="button" role="radio" aria-checked="${p === prio}" class="p${p} ${p === prio ? 'on' : ''}" data-p="${p}"><b>${PRIO[p]}</b><span>${PRIO_HINT[p]}</span></button>`).join('')}</div></div>
    <div class="field"><label class="flabel" for="f-equip">¿Es un equipo? <span class="muted">(opcional)</span></label>
      <p class="why">Así queda en el historial del equipo y se ve si falla seguido.</p>
      <select id="f-equip">${equipmentOptions(areaId, eqId)}</select></div>
    ${doer ? `<details class="fold"><summary>Asignar y fecha <span class="n">(opcional)</span>${ic('down')}</summary>
      <div class="row2"><div class="field"><label class="flabel" for="f-prov">Responsable</label><select id="f-prov">${providerOptions(null, 'Sin asignar')}</select></div>
      <div class="field"><label class="flabel" for="f-due">Fecha límite</label><input type="date" id="f-due" min="${todayStr()}"></div></div>
      <p class="small">Si no pones fecha: urgente vence hoy, alta mañana y normal en 7 días.</p></details>` : ''}
  </div>`, { tab: 'reportar', bar: `<button class="b block lg" id="f-save">${ic('send')}Enviar reporte</button>`, main: false });
  $$('#f-area .chip').forEach((b) => (b.onclick = () => {
    areaId = Number(b.dataset.id);
    $$('#f-area .chip').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', String(x === b)); });
    const sel = $('#f-equip');
    sel.innerHTML = equipmentOptions(areaId, sel.value);
  }));
  $('#f-equip').onchange = () => {
    const e = S.equipment.find((x) => x.id === Number($('#f-equip').value));
    if (e && e.area_id && e.area_id !== areaId) { const c = $(`#f-area .chip[data-id="${e.area_id}"]`); if (c) c.click(); $('#f-equip').value = String(e.id); }
  };
  $$('.urg button').forEach((b) => (b.onclick = () => {
    prio = Number(b.dataset.p);
    $$('.urg button').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', String(x === b)); });
  }));
  localPhotos(APP, '#f-cam, #f-gal', '#f-photos', files);
  $('#f-save').onclick = async () => {
    const btn = $('#f-save');
    const text = $('#f-title').value.trim();
    if (!areaId) { toast('Elige dónde es', { bad: true }); return $('#f-area .chip').focus(); }
    if (!text) { toast('Escribe qué pasa', { bad: true }); return $('#f-title').focus(); }
    // first line / sentence becomes the title; the rest stays as details
    const lines = text.split('\n');
    const firstLine = lines[0].trim();
    const short = firstLine.length <= 120;
    const title = short ? firstLine : firstLine.slice(0, 117).replace(/\s+\S*$/, '') + '…';
    const description = short ? (lines.slice(1).join('\n').trim() || null) : text;
    const payload = { title, description, area_id: areaId, equipment_id: $('#f-equip').value || null, priority: prio };
    if (doer) {
      payload.provider_id = $('#f-prov').value || null;
      if ($('#f-due').value) payload.due_date = $('#f-due').value;
    }
    btn.disabled = true;
    btn.textContent = 'Enviando…';
    try {
      const r = await api('POST', '/tasks', payload);
      store('mt_last_area', areaId);
      for (let i = 0; i < files.length; i++) {
        btn.textContent = `Subiendo foto ${i + 1} de ${files.length}…`;
        try { await uploadPhoto(`/tasks/${r.task.id}/photos`, files[i]); } catch (e) { toast(e.message, { bad: true }); }
      }
      location.replace('#/reportado/' + r.task.id);
    } catch (e) {
      toast(e.message, { bad: true });
      btn.disabled = false;
      btn.innerHTML = `${ic('send')}Enviar reporte`;
    }
  };
  if (!isDesk()) return;
  setTimeout(() => $('#f-title') && $('#f-title').focus(), 60);
}
function viewReported(id) {
  render(header('Reporte enviado', { close: true }) + `<div class="wrap narrow"><div class="okbox">
    <div class="big">${ic('check')}</div><h2>¡Recibido!</h2>
    <p>Quedó como la orden <b>#${esc(id)}</b>. Mantenimiento ya la ve. Puedes revisar cómo va en ${isDoer() ? 'Órdenes' : 'Inicio'}.</p>
    <div class="row-btns"><a class="b plain lg" href="#/t/${esc(id)}">Ver mi reporte</a><a class="b lg" href="#/reportar">${ic('plus')}Reportar otro</a></div>
  </div></div>`, { tab: 'reportar', main: false });
  $('[data-back]').onclick = () => (location.hash = '#/');
}

// ---------- equipment ----------
function nextSvc(e) {
  if (e.next_service) return e.next_service;
  return null;
}
function svcBadge(e) {
  const n = nextSvc(e);
  if (!n) return '';
  const d = daysBetween(todayStr(), n);
  if (d < 0) return `<span class="st st-pendiente" style="color:var(--bad);background:var(--bad-soft)">Vencido</span>`;
  if (d <= 14) return `<span class="st st-en_espera">En ${d} d</span>`;
  return '';
}
const EQ = { list: [] };
async function viewEquipmentList() {
  loading({ tab: 'equipos' });
  try { EQ.list = (await api('GET', '/equipment')).equipment; } catch (e) { return errorView(e.message, { tab: 'equipos' }); }
  drawEquipmentList();
}
function drawEquipmentList(refocus = false) {
  const f = Object.assign({ q: '', area: '' }, store('mt_eqf') || {});
  const q = f.q.toLowerCase();
  const shown = EQ.list.filter((e) => (!q || [e.name, e.location, e.brand_model, e.area_name, e.provider_name].join(' ').toLowerCase().includes(q)) && (!f.area || String(e.area_id) === f.area));
  const desk = isDesk();
  const sort = store('mt_eqsort') || { k: null, dir: 1 };
  let body;
  if (!shown.length) {
    body = `<div class="empty">${EQ.list.length ? '<h3>Sin resultados</h3><p>Prueba con otra palabra o área.</p>'
      : '<h3>Registra tus equipos</h3><p>Bombas, minisplits, cámaras de frío, prensa… Así queda el historial de cada servicio.</p>'}
      <a class="b" href="#/e/nuevo">${ic('plus')}Agregar equipo</a></div>`;
  } else if (desk) {
    const SK = { name: (e) => e.name.toLowerCase(), area: (e) => e.area_name || '', next: (e) => nextSvc(e) || '9999', last: (e) => e.last_service || '', open: (e) => e.open_count, fails: (e) => e.fails_90, prov: (e) => e.provider_name || '~' };
    const list = [...shown];
    if (sort.k) list.sort((a, b) => { const x = SK[sort.k](a); const y = SK[sort.k](b); return (x < y ? -1 : x > y ? 1 : 0) * sort.dir; });
    const th = (k, l, cls = '') => `<th class="${cls}" aria-sort="${sort.k === k ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none'}"><button data-sort="${k}">${l}${sort.k === k ? ic(sort.dir > 0 ? 'up' : 'down') : ''}</button></th>`;
    body = `<table class="tbl"><thead><tr>${th('name', 'Equipo')}${th('area', 'Área')}${th('next', 'Próximo servicio')}${th('last', 'Último servicio')}${th('open', 'Abiertas', 'num')}${th('fails', 'Fallas 90 d', 'num')}${th('prov', 'Proveedor')}</tr></thead>
      <tbody>${list.map((e) => `<tr data-href="#/e/${e.id}"><td><a class="rowlink" href="#/e/${e.id}">${esc(e.name)}</a>${e.brand_model ? `<div class="s">${esc(e.brand_model)}</div>` : ''}</td>
        <td>${esc(e.area_name || 'Sin área')}${e.location ? `<div class="s">${esc(e.location)}</div>` : ''}</td>
        <td class="${nextSvc(e) && nextSvc(e) < todayStr() ? 'due-late' : ''}">${nextSvc(e) ? esc(fmtDay(nextSvc(e))) : '<span class="muted">Sin plan</span>'}</td>
        <td>${e.last_service ? esc(fmtDay(localYmd(e.last_service))) : '<span class="muted">—</span>'}</td>
        <td class="num">${e.open_count || '<span class="muted">0</span>'}</td><td class="num ${e.fails_90 >= 2 ? 'due-late' : ''}">${e.fails_90 || '<span class="muted">0</span>'}</td>
        <td>${e.provider_name ? esc(e.provider_name) : '<span class="muted">—</span>'}</td></tr>`).join('')}</tbody></table>`;
  } else {
    const groups = {};
    shown.forEach((e) => (groups[e.area_id || 0] ||= []).push(e));
    body = [...S.areas.map((a) => a.id), 0].filter((id) => groups[id]).map((id) => `<div class="sec"><h2>${esc(id ? areaName(id) : 'Sin área')}</h2><span class="n">${groups[id].length}</span></div>
      <div class="group">${groups[id].map((e) => `<a class="cell" href="#/e/${e.id}"><span class="lbl"><div class="t">${esc(e.name)}</div>
          <div class="s">${nextSvc(e) ? 'Próximo servicio ' + esc(fmtDay(nextSvc(e))) : e.last_service ? 'Último servicio ' + esc(fmtDay(localYmd(e.last_service))) : 'Sin servicios registrados'}${e.open_count ? ` · <b class="due-today">${e.open_count} abierta${e.open_count > 1 ? 's' : ''}</b>` : ''}</div></span>
          ${svcBadge(e)}${ic('chev', 'chev')}</a>`).join('')}</div>`).join('');
  }
  render(header('Equipos', { search: true, right: `<a class="b tonal sm" href="#/e/nuevo">${ic('plus')}Nuevo</a>` }) + `<div class="wrap">
    <div class="filters" style="--n:2"><label class="sr" for="eq-q">Buscar equipo</label><input class="sel" id="eq-q" type="search" placeholder="Buscar equipo" value="${esc(f.q)}" style="background-image:none">
      <label class="sr" for="eq-area">Área</label><select class="sel ${f.area ? 'on' : ''}" id="eq-area"><option value="">Todas las áreas</option>${S.areas.filter((a) => a.active).map((a) => `<option value="${a.id}" ${f.area === String(a.id) ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></div>
    ${body}
  </div>`, { tab: 'equipos', keepScroll: refocus });
  const qi = $('#eq-q');
  if (refocus) { qi.focus(); qi.setSelectionRange(qi.value.length, qi.value.length); }
  qi.oninput = debounce(() => { f.q = qi.value; store('mt_eqf', f); drawEquipmentList(true); }, 280);
  $('#eq-area').onchange = (e) => { f.area = e.target.value; store('mt_eqf', f); drawEquipmentList(); };
  $$('[data-sort]').forEach((b) => (b.onclick = () => { const k = b.dataset.sort; store('mt_eqsort', { k, dir: sort.k === k ? -sort.dir : 1 }); drawEquipmentList(); }));
  $$('tr[data-href]').forEach((tr) => (tr.onclick = (e) => { if (!e.target.closest('a')) location.hash = tr.dataset.href; }));
  UI.refresh = null;
}

async function viewEquipment(id, keep = false) {
  if (!keep) loading({ tab: 'equipos' });
  let d;
  try { d = await api('GET', '/equipment/' + id); } catch (e) { return errorView(e.message, { tab: 'equipos' }); }
  const e = d.equipment;
  const openT = d.tasks.filter(isOpen);
  const doneT = d.tasks.filter((t) => !isOpen(t));
  const last = e.last_service ? localYmd(e.last_service) : null;
  const next = d.pm.length ? d.pm[0].next_due : null;
  const warr = e.warranty_until ? (e.warranty_until >= todayStr() ? `Vigente hasta ${fmtDay(e.warranty_until)}` : `Venció ${fmtDay(e.warranty_until)}`) : null;
  const desk = isDesk();
  const info = `<div class="facts">
      <div class="fact ${next && next < todayStr() ? 'late' : ''}"><span>Próximo servicio</span><b>${next ? esc(fmtDay(next)) : 'Sin plan'}</b></div>
      <div class="fact"><span>Último servicio</span><b>${last ? esc(fmtDay(last)) : 'Nunca'}</b></div>
      <div class="fact ${e.fails_90 >= 2 ? 'late' : ''}"><span>Fallas en 90 días</span><b>${e.fails_90}</b></div>
      <div class="fact"><span>Gasto en el año</span><b class="money">${money(d.year_cost)}</b></div>
      ${S.features.equipExtra ? `<div class="fact ${warr && warr.startsWith('Venció') ? 'late' : ''}"><span>Garantía</span><b>${warr ? esc(warr) : 'Sin dato'}</b></div>
      <div class="fact"><span>Manual</span>${e.manual_url ? `<a class="fx" href="${esc(e.manual_url)}" target="_blank" rel="noopener"><b style="text-decoration:underline">Abrir manual</b> ${ic('ext')}</a>` : '<b>Sin enlace</b>'}</div>` : ''}
      ${e.brand_model ? `<div class="fact"><span>Marca y modelo</span><b>${esc(e.brand_model)}</b></div>` : ''}
      ${e.serial ? `<div class="fact"><span>Número de serie</span><b>${esc(e.serial)}</b></div>` : ''}
    </div>
    ${e.provider_id ? `<div class="group"><div class="cell"><span class="ic">${ic('user')}</span><span class="lbl"><a class="t stretch" href="#/r/${e.provider_id}">${esc(e.provider_name)}</a><div class="s">${esc(e.provider_company || 'Proveedor de servicio')}</div></span>
        ${e.provider_phone ? `<span class="acts"><a class="ib line" href="${telHref(e.provider_phone)}" aria-label="Llamar a ${esc(e.provider_name)}">${ic('phone')}</a>
        <a class="ib line" style="color:var(--wa)" target="_blank" rel="noopener" href="${waHref(e.provider_phone, `Hola, sobre ${e.name} de Dos Búhos:`)}" aria-label="WhatsApp a ${esc(e.provider_name)}">${ic('wa')}</a></span>` : ''}</div></div>` : ''}
    ${e.notes ? `<div class="desc">${esc(e.notes)}</div>` : ''}
    <div class="sec"><h2>Fotos y placa</h2><span class="n">${d.photos.length}</span></div>
    <div id="e-photos">${photoGrid(d.photos, 'e-file')}</div>`;
  const plans = S.features.pm ? `<div class="sec"><h2>Preventivo</h2><a class="linkbtn act" href="#/preventivo/nuevo?equipment=${id}">+ Programar</a></div>
    ${d.pm.length ? `<div class="group">${d.pm.map((p) => `<a class="cell" href="#/preventivo/${p.id}"><span class="ic">${ic('repeat')}</span><span class="lbl"><div class="t">${esc(p.title)}</div>
      <div class="s">${esc(everyText(p.every_n, p.unit))} · próximo ${esc(fmtDay(p.next_due))}</div></span>${ic('chev', 'chev')}</a>`).join('')}</div>`
      : '<p class="small pad-x">Sin plan preventivo. Programa uno para que la orden se cree sola.</p>'}` : '';
  const hist = `${openT.length ? `<div class="sec"><h2>Abiertas</h2><span class="n">${openT.length}</span></div><div class="list">${openT.map((t) => woRow(t, { area: false })).join('')}</div>` : ''}
    <div class="sec"><h2>Historial</h2><span class="n">${doneT.length}</span></div>
    ${doneT.length ? `<div class="list">${doneT.map((t) => woRow(t, { area: false, mark: false })).join('')}</div>` : '<p class="small pad-x">Aún no hay servicios registrados.</p>'}`;
  const bar = `<a class="b plain grow" href="#/reportar?equipment=${id}">${ic('alert')}Reportar falla</a>
    <a class="b grow" href="#/servicio/${id}">${ic('check')}Anotar servicio</a>`;
  render(header(e.name, { back: true, sub: [e.area_name, e.location].filter(Boolean).join(' · '), right: `<a class="ib" href="#/e/${id}/editar" aria-label="Editar equipo">${ic('edit')}</a>` })
    + `<div class="wrap">${!e.active ? '<div class="banner">Este equipo está dado de baja.</div>' : ''}
      ${desk ? `<div class="two"><div>${info}${plans}<div class="actionbar">${bar}</div></div><div>${hist}</div></div>` : info + plans + hist}</div>`,
  { tab: 'equipos', keepScroll: keep, bar: desk ? '' : bar, main: false });
  bindPhotoGrid(APP, 'e-file', `/equipment/${id}/photos`, () => viewEquipment(id, true));
  bindRows(APP, (tid) => d.tasks.find((t) => t.id === tid), () => viewEquipment(id, true));
}

async function viewService(eqId) {
  const e = S.equipment.find((x) => x.id === Number(eqId));
  if (!e) return errorView('Ese equipo ya no existe.');
  let provider = null;
  try { provider = (await api('GET', '/equipment/' + eqId)).equipment.provider_id; } catch { /* */ }
  render(header('Registrar servicio', { close: true, sub: e.name }) + `<div class="wrap narrow">
    <p class="why">Para servicios ya hechos (mantenimiento, recarga, limpieza). Queda en el historial del equipo.</p>
    <div class="field"><label class="flabel" for="s-title">¿Qué se hizo?</label><input type="text" class="big" id="s-title" maxlength="200" placeholder="Ej. Limpieza y recarga de gas"></div>
    <div class="row2"><div class="field"><label class="flabel" for="s-date">Fecha</label><input type="date" id="s-date" value="${todayStr()}" max="${todayStr()}"></div>
      <div class="field"><label class="flabel" for="s-cost">Costo</label><input type="number" id="s-cost" inputmode="decimal" min="0" step="1" placeholder="$"></div></div>
    <div class="field"><label class="flabel" for="s-prov">¿Quién lo hizo?</label><select id="s-prov">${providerOptions(provider, 'Elegir')}</select></div>
    <div class="field"><label class="flabel" for="s-desc">Notas</label><textarea id="s-desc" maxlength="4000" placeholder="Qué se revisó, piezas cambiadas, recomendaciones"></textarea></div>
  </div>`, { tab: 'equipos', bar: `<button class="b block lg" id="s-save">${ic('check')}Guardar servicio</button>`, main: false });
  $('#s-save').onclick = async () => {
    const payload = { kind: 'servicio', status: 'hecha', priority: 3, equipment_id: Number(eqId), area_id: e.area_id, title: $('#s-title').value.trim() || 'Servicio de mantenimiento',
      description: $('#s-desc').value, provider_id: $('#s-prov').value || null, completed_date: $('#s-date').value || todayStr(), cost: $('#s-cost').value, due_date: null };
    try { await api('POST', '/tasks', payload); toast('Servicio guardado'); location.replace('#/e/' + eqId); } catch (err) { toast(err.message, { bad: true }); }
  };
}

async function viewEquipmentForm(id) {
  let e = { name: '', area_id: null, location: '', brand_model: '', serial: '', provider_id: null, service_interval_days: '', notes: '', active: 1, warranty_until: '', manual_url: '' };
  if (id) {
    loading({ tab: 'equipos' });
    try { e = (await api('GET', '/equipment/' + id)).equipment; } catch (err) { return errorView(err.message); }
  }
  const legacy = !S.features.pm;
  render(header(id ? 'Editar equipo' : 'Nuevo equipo', { close: !id, back: !!id }) + `<div class="wrap narrow">
    <div class="field"><label class="flabel" for="q-name">Nombre</label><input type="text" class="big" id="q-name" value="${esc(e.name)}" placeholder="Ej. Bomba de agua principal"></div>
    <div class="row2"><div class="field"><label class="flabel" for="q-area">Área</label><select id="q-area">${areaOptions(e.area_id)}</select></div>
      <div class="field"><label class="flabel" for="q-loc">Ubicación exacta</label><input type="text" id="q-loc" value="${esc(e.location || '')}" placeholder="Ej. Cuarto de bombas"></div></div>
    <div class="field"><label class="flabel" for="q-prov">Proveedor de servicio</label><p class="why">Aparece con botón de llamar y WhatsApp en el equipo y sus órdenes.</p>
      <select id="q-prov">${providerOptions(e.provider_id, 'Ninguno')}</select></div>
    <div class="row2"><div class="field"><label class="flabel" for="q-brand">Marca y modelo</label><input type="text" id="q-brand" value="${esc(e.brand_model || '')}"></div>
      <div class="field"><label class="flabel" for="q-serial">Número de serie</label><input type="text" id="q-serial" value="${esc(e.serial || '')}"></div></div>
    ${S.features.equipExtra ? `<div class="row2"><div class="field"><label class="flabel" for="q-warr">Garantía hasta</label><input type="date" id="q-warr" value="${esc(e.warranty_until || '')}"></div>
      <div class="field"><label class="flabel" for="q-manual">Enlace al manual</label><input type="url" id="q-manual" value="${esc(e.manual_url || '')}" placeholder="https://"></div></div>` : ''}
    ${legacy ? `<div class="field"><label class="flabel" for="q-int">Servicio preventivo cada (días)</label><input type="number" id="q-int" inputmode="numeric" min="0" value="${e.service_interval_days ?? ''}"></div>`
      : `<p class="why">El servicio preventivo se programa desde el equipo, en “Preventivo”.</p>`}
    <div class="field"><label class="flabel" for="q-notes">Notas</label><textarea id="q-notes" placeholder="Dónde está la llave de paso, quién tiene la garantía, etc.">${esc(e.notes || '')}</textarea></div>
    ${id && isAdmin() && e.active ? `<div class="group"><button class="cell danger" id="q-del"><span class="ic">${ic('trash')}</span><span class="lbl"><span class="t">Dar de baja</span><div class="s">Deja de aparecer; su historial se conserva</div></span></button></div>` : ''}
  </div>`, { tab: 'equipos', bar: `<button class="b block lg" id="q-save">${ic('check')}${id ? 'Guardar cambios' : 'Agregar equipo'}</button>`, main: false });
  $('#q-save').onclick = async () => {
    const data = {
      name: $('#q-name').value, area_id: $('#q-area').value || null, location: $('#q-loc').value,
      brand_model: $('#q-brand').value, serial: $('#q-serial').value, provider_id: $('#q-prov').value || null,
      service_interval_days: legacy ? ($('#q-int').value || null) : e.service_interval_days, notes: $('#q-notes').value,
      warranty_until: $('#q-warr') ? $('#q-warr').value : null, manual_url: $('#q-manual') ? $('#q-manual').value : null,
    };
    if (!data.name.trim()) { toast('Escribe el nombre', { bad: true }); return $('#q-name').focus(); }
    $('#q-save').disabled = true;
    try {
      let newId = id;
      if (id) await api('PATCH', '/equipment/' + id, data);
      else newId = (await api('POST', '/equipment', data)).id;
      await loadBoot();
      toast(id ? 'Cambios guardados' : 'Equipo agregado');
      location.replace('#/e/' + newId);
    } catch (err) { toast(err.message, { bad: true }); $('#q-save').disabled = false; }
  };
  const del = $('#q-del');
  if (del) del.onclick = async () => {
    if (!(await confirmSheet('¿Dar de baja este equipo?', 'Deja de aparecer en la lista; su historial se conserva.', 'Dar de baja', true))) return;
    try { await api('DELETE', '/equipment/' + id); await loadBoot(); toast('Equipo dado de baja'); location.replace('#/equipos'); } catch (err) { toast(err.message, { bad: true }); }
  };
}

// ---------- preventive ----------
async function viewPM(query = {}) {
  if (!S.features.pm) return errorView('El preventivo se activa al aplicar la migración 0005 de la base de datos.', { tab: 'preventivo' });
  loading({ tab: 'preventivo' });
  const m = monthOf(query);
  const desk = isDesk();
  const mode = desk ? 'both' : (query.v || store('mt_pmv') || 'lista');
  let list, cal = '';
  try {
    list = (await api('GET', '/pm')).pm;
    if (mode !== 'lista') cal = await calendarHtml(m, '#/preventivo?v=calendario&', { pmOnly: true });
  } catch (e) { return errorView(e.message, { tab: 'preventivo' }); }
  const today = todayStr();
  const rows = list.length ? `<div class="group">${list.map((p) => {
    const d = daysBetween(today, p.next_due);
    const when = d < 0 ? `<b class="due-late">Atrasado ${-d} d</b>` : d === 0 ? '<b class="due-today">Hoy</b>' : `en ${d} d`;
    return `<a class="cell" href="#/preventivo/${p.id}"><span class="ic">${ic('repeat')}</span><span class="lbl"><div class="t">${esc(p.title)}</div>
      <div class="s">${esc(p.equipment_name || p.area_name || 'General')} · ${esc(everyText(p.every_n, p.unit))} · ${esc(fmtDay(p.next_due))} (${when})${p.last_status && OPEN.includes(p.last_status) ? ' · orden abierta' : ''}</div></span>${ic('chev', 'chev')}</a>`;
  }).join('')}</div>` : `<div class="empty"><h3>Sin planes preventivos</h3><p>Ej. “Limpiar filtros de la campana cada 3 meses”. La orden se crea sola unos días antes.</p><a class="b" href="#/preventivo/nuevo">${ic('plus')}Nuevo plan</a></div>`;
  const seg = desk ? '' : `<div class="seg" role="tablist" aria-label="Vista" style="margin-bottom:8px">${[['lista', 'Lista'], ['calendario', 'Calendario']].map(([v, l]) => `<button role="tab" data-pv="${v}" class="${mode === v ? 'on' : ''}" aria-selected="${mode === v}">${l}</button>`).join('')}</div>`;
  render(header('Preventivo', { search: true, right: `<a class="b tonal sm" href="#/preventivo/nuevo">${ic('plus')}Nuevo plan</a>` }) + `<div class="wrap">
    <p class="why">Trabajos que se repiten. Cada plan crea su orden sola, unos días antes de la fecha, y no crea otra mientras la anterior siga abierta.</p>
    ${seg}${desk ? `<div class="two cal"><div>${cal}</div><div><div class="sec" style="margin-top:4px"><h2>Planes</h2><span class="n">${list.length}</span></div>${rows}</div></div>` : mode === 'lista' ? rows : cal}
  </div>`, { tab: 'preventivo' });
  $$('[data-pv]').forEach((b) => (b.onclick = () => { store('mt_pmv', b.dataset.pv); viewPM({ v: b.dataset.pv }); }));
}
async function viewPMForm(id, query = {}) {
  if (!S.features.pm) return errorView('El preventivo se activa al aplicar la migración 0005.');
  let p = { title: '', description: '', area_id: null, equipment_id: query.equipment ? Number(query.equipment) : null, provider_id: null, priority: 3, every_n: 3, unit: 'month', next_due: addDays(todayStr(), 7), lead_days: 3 };
  let tasks = [];
  if (id) {
    loading({ tab: 'preventivo' });
    try { const r = await api('GET', '/pm/' + id); p = r.pm; tasks = r.tasks; } catch (e) { return errorView(e.message); }
  } else if (p.equipment_id) {
    const e = S.equipment.find((x) => x.id === p.equipment_id);
    if (e) { p.area_id = e.area_id; p.title = 'Servicio preventivo: ' + e.name; }
  }
  render(header(id ? 'Plan preventivo' : 'Nuevo plan preventivo', { back: !!id, close: !id }) + `<div class="wrap narrow">
    ${id && !p.active ? '<div class="banner">Este plan está desactivado; guárdalo para reactivarlo.</div>' : ''}
    <div class="field"><label class="flabel" for="pm-title">¿Qué hay que hacer?</label><input type="text" class="big" id="pm-title" maxlength="200" value="${esc(p.title)}" placeholder="Ej. Limpiar filtros de la campana"></div>
    <div class="row2"><div class="field"><label class="flabel" for="pm-equip">Equipo</label><select id="pm-equip">${equipmentOptions(null, p.equipment_id, 'Ninguno')}</select></div>
      <div class="field"><label class="flabel" for="pm-area">Área</label><select id="pm-area">${areaOptions(p.area_id)}</select></div></div>
    <div class="field"><span class="flabel" id="lb-every">¿Cada cuándo?</span>
      <div class="row2" role="group" aria-labelledby="lb-every"><div><label class="sr" for="pm-n">Número</label><input type="number" id="pm-n" min="1" max="365" inputmode="numeric" value="${p.every_n || 1}" ${p.unit === 'once' ? 'disabled' : ''}></div>
        <div><label class="sr" for="pm-unit">Unidad</label><select id="pm-unit">${[['day', 'Días'], ['week', 'Semanas'], ['month', 'Meses'], ['once', 'Una sola vez']].map(([v, l]) => `<option value="${v}" ${p.unit === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div></div>
    <div class="row2"><div class="field"><label class="flabel" for="pm-next">Próxima fecha</label><input type="date" id="pm-next" value="${esc(p.next_due)}"></div>
      <div class="field"><label class="flabel" for="pm-lead">Crear la orden antes</label><select id="pm-lead">${[0, 1, 3, 7, 14, 30].map((d) => `<option value="${d}" ${Number(p.lead_days) === d ? 'selected' : ''}>${d === 0 ? 'El mismo día' : d === 1 ? '1 día antes' : d + ' días antes'}</option>`).join('')}</select></div></div>
    <p class="why" style="margin-top:-8px">Con anticipación da tiempo de pedir material o llamar al proveedor.</p>
    <div class="row2"><div class="field"><label class="flabel" for="pm-prov">Responsable</label><select id="pm-prov">${providerOptions(p.provider_id, 'Sin asignar')}</select></div>
      <div class="field"><label class="flabel" for="pm-prio">Prioridad</label><select id="pm-prio">${[1, 2, 3, 4].map((x) => `<option value="${x}" ${p.priority === x ? 'selected' : ''}>${PRIO[x]}</option>`).join('')}</select></div></div>
    <div class="field"><label class="flabel" for="pm-desc">Instrucciones</label><textarea id="pm-desc" maxlength="4000" placeholder="Pasos, piezas, dónde está la herramienta">${esc(p.description || '')}</textarea></div>
    ${id ? `<div class="group">${p.active ? `<button class="cell" id="pm-run"><span class="ic">${ic('play')}</span><span class="lbl"><span class="t">Crear la orden ahora</span><div class="s">Adelanta la siguiente sin esperar la fecha</div></span></button>
        <button class="cell danger" id="pm-off"><span class="ic">${ic('trash')}</span><span class="lbl"><span class="t">Desactivar plan</span><div class="s">Deja de crear órdenes; las ya creadas se quedan</div></span></button>` : ''}</div>
      ${tasks.length ? `<div class="sec"><h2>Órdenes de este plan</h2><span class="n">${tasks.length}</span></div><div class="list">${tasks.map((t) => woRow(t, { mark: false })).join('')}</div>` : ''}` : ''}
  </div>`, { tab: 'preventivo', bar: `<button class="b block lg" id="pm-save">${ic('check')}${id ? 'Guardar plan' : 'Crear plan'}</button>`, main: false });
  $('#pm-unit').onchange = () => { $('#pm-n').disabled = $('#pm-unit').value === 'once'; };
  $('#pm-equip').onchange = () => {
    const e = S.equipment.find((x) => x.id === Number($('#pm-equip').value));
    if (e) { $('#pm-area').value = e.area_id || ''; if (!$('#pm-title').value.trim()) $('#pm-title').value = 'Servicio preventivo: ' + e.name; }
  };
  $('#pm-save').onclick = async () => {
    const data = { title: $('#pm-title').value, equipment_id: $('#pm-equip').value || null, area_id: $('#pm-area').value || null, every_n: $('#pm-n').value,
      unit: $('#pm-unit').value, next_due: $('#pm-next').value, lead_days: $('#pm-lead').value, provider_id: $('#pm-prov').value || null, priority: $('#pm-prio').value, description: $('#pm-desc').value };
    if (!data.title.trim()) { toast('Escribe qué hay que hacer', { bad: true }); return $('#pm-title').focus(); }
    if (!data.next_due) { toast('Elige la próxima fecha', { bad: true }); return $('#pm-next').focus(); }
    try {
      const r = id ? await api('PATCH', '/pm/' + id, data) : await api('POST', '/pm', data);
      toast(id ? 'Plan guardado' : 'Plan creado');
      location.replace('#/preventivo/' + (id || r.id));
    } catch (e) { toast(e.message, { bad: true }); }
  };
  const run = $('#pm-run');
  if (run) run.onclick = async () => {
    try { const r = await api('POST', `/pm/${id}/run`); if (r.task_id) { toast('Orden creada'); location.hash = '#/t/' + r.task_id; } } catch (e) { toast(e.message, { bad: true }); }
  };
  const off = $('#pm-off');
  if (off) off.onclick = () => later('Plan desactivado', () => api('PATCH', '/pm/' + id, { active: false }), {
    hide: () => { location.hash = '#/preventivo'; }, undo: () => { location.hash = '#/preventivo/' + id; },
  });
}

// ---------- providers ----------
async function viewProviders() {
  loading({ tab: 'proveedores' });
  let list;
  try { list = (await api('GET', '/providers')).providers; await loadBoot(); } catch (e) { return errorView(e.message, { tab: 'proveedores' }); }
  const linked = new Set(S.users.filter((u) => u.active && u.provider_id).map((u) => u.provider_id));
  const cell = (p) => `<div class="cell"><span class="lbl"><a class="t stretch" href="#/r/${p.id}">${esc(p.name)}</a>
      <div class="s">${esc([p.specialty, p.company].filter(Boolean).join(' · ') || (p.kind === 'interno' ? 'Personal interno' : 'Proveedor'))}${linked.has(p.id) ? ' · usa la app' : ''}
      ${p.open_count ? ` · <b class="${p.late_count ? 'due-late' : ''}">${p.open_count} abierta${p.open_count > 1 ? 's' : ''}${p.late_count ? `, ${p.late_count} vencida${p.late_count > 1 ? 's' : ''}` : ''}</b>` : ''}</div></span>
    ${p.phone ? `<span class="acts"><a class="ib line" href="${telHref(p.phone)}" aria-label="Llamar a ${esc(p.name)}">${ic('phone')}</a>
      <a class="ib line" style="color:var(--wa)" target="_blank" rel="noopener" href="${waHref(p.phone)}" aria-label="WhatsApp a ${esc(p.name)}">${ic('wa')}</a></span>` : ''}</div>`;
  const add = (tipo, label) => `<a class="cell" href="#/r/nuevo?tipo=${tipo}"><span class="ic">${ic('plus')}</span><span class="lbl"><span class="t">${label}</span></span></a>`;
  const ints = list.filter((p) => p.kind === 'interno');
  const exts = list.filter((p) => p.kind === 'externo');
  render(header('Proveedores', { search: true }) + `<div class="wrap">
    <p class="why">Quién hace los trabajos: el equipo de la casa y proveedores de fuera. No necesitan entrar a la app para que se les asignen órdenes.</p>
    <div class="${isDesk() ? 'two' : ''}"><div><div class="sec"><h2>Proveedores externos</h2><span class="n">${exts.length}</span></div>
    <div class="group">${exts.map(cell).join('')}${add('externo', 'Agregar proveedor')}</div></div>
    <div><div class="sec"><h2>Personal interno</h2><span class="n">${ints.length}</span></div>
    <div class="group">${ints.map(cell).join('')}${add('interno', 'Agregar personal interno')}</div></div></div>
  </div>`, { tab: 'proveedores' });
}
async function viewProvider(id) {
  loading({ tab: 'proveedores' });
  let tasks;
  try { await loadBoot(); tasks = (await api('GET', `/tasks?view=all&provider=${id}&limit=80`)).tasks; } catch (e) { return errorView(e.message); }
  const p = S.providers.find((x) => x.id === Number(id));
  if (!p) return errorView('Este proveedor ya no existe.');
  const openT = tasks.filter(isOpen);
  const doneT = tasks.filter((t) => !isOpen(t)).slice(0, 30);
  const spent = tasks.filter((t) => t.completed_at && t.completed_at.slice(0, 4) === todayStr().slice(0, 4)).reduce((s, t) => s + (t.cost || 0) + (t.material_cost || 0), 0);
  render(header(p.name, { back: true, sub: [p.specialty, p.company].filter(Boolean).join(' · ') || (p.kind === 'interno' ? 'Personal interno' : 'Proveedor externo'), right: `<a class="ib" href="#/r/${id}/editar" aria-label="Editar">${ic('edit')}</a>` }) + `<div class="wrap narrow">
    ${p.phone ? `<div class="row-btns" style="margin:4px 0 12px"><a class="b plain lg" href="${telHref(p.phone)}">${ic('phone')}Llamar</a>
      <a class="b wa lg" target="_blank" rel="noopener" href="${waHref(p.phone)}">${ic('wa')}WhatsApp</a></div>` : '<p class="small">Sin teléfono. Agrégalo para llamar o escribir con un toque.</p>'}
    ${p.notes ? `<div class="desc">${esc(p.notes)}</div>` : ''}
    <div class="stats" style="--n:3"><div class="stat ${openT.length ? '' : 'zero'}"><b>${openT.length}</b><span>Abiertas</span></div><div class="stat"><b>${tasks.filter((t) => t.status === 'hecha').length}</b><span>Terminadas</span></div><div class="stat"><b class="money">${money(spent)}</b><span>Pagado en el año</span></div></div>
    <div class="sec"><h2>Abiertas</h2><span class="n">${openT.length}</span></div>
    ${openT.length ? `<div class="list">${openT.map((t) => woRow(t)).join('')}</div>` : '<p class="small pad-x">Nada pendiente.</p>'}
    <div class="sec"><h2>Terminadas recientes</h2><span class="n">${doneT.length}</span></div>
    ${doneT.length ? `<div class="list">${doneT.map((t) => woRow(t, { mark: false })).join('')}</div>` : '<p class="small pad-x">Todavía nada.</p>'}
  </div>`, { tab: 'proveedores', main: false });
  bindRows(APP, (tid) => tasks.find((t) => t.id === tid), () => viewProvider(id));
}
async function viewProviderForm(id, query = {}) {
  let p = { name: '', kind: query.tipo === 'interno' ? 'interno' : 'externo', company: '', specialty: '', phone: '', notes: '' };
  if (id) { await loadBoot(); p = S.providers.find((x) => x.id === Number(id)) || p; }
  render(header(id ? 'Editar proveedor' : 'Nuevo proveedor', { close: !id, back: !!id }) + `<div class="wrap narrow">
    <div class="field"><div class="seg" role="radiogroup" aria-label="Tipo">
      <button type="button" role="radio" data-k="externo" class="${p.kind === 'externo' ? 'on' : ''}" aria-checked="${p.kind === 'externo'}">Proveedor externo</button>
      <button type="button" role="radio" data-k="interno" class="${p.kind === 'interno' ? 'on' : ''}" aria-checked="${p.kind === 'interno'}">Personal interno</button></div></div>
    <div class="field"><label class="flabel" for="p-name">Nombre</label><input type="text" class="big" id="p-name" value="${esc(p.name)}" placeholder="Ej. Juan Hernández"></div>
    <div class="field" id="p-company-f" ${p.kind === 'interno' ? 'style="display:none"' : ''}><label class="flabel" for="p-company">Empresa</label><input type="text" id="p-company" value="${esc(p.company || '')}" placeholder="Ej. Plomería Hernández"></div>
    <div class="field"><label class="flabel" for="p-spec">Especialidad</label><input type="text" id="p-spec" value="${esc(p.specialty || '')}" placeholder="Plomería, electricidad, refrigeración…"></div>
    <div class="field"><label class="flabel" for="p-phone">Teléfono / WhatsApp</label><p class="why">Con esto se le llama o escribe con un toque desde cada orden.</p><input type="tel" id="p-phone" value="${esc(p.phone || '')}" placeholder="10 dígitos"></div>
    <div class="field"><label class="flabel" for="p-notes">Notas</label><textarea id="p-notes" placeholder="Horarios, cómo cobra, si da factura">${esc(p.notes || '')}</textarea></div>
    ${id && isAdmin() ? `<div class="group"><button class="cell danger" id="p-del"><span class="ic">${ic('trash')}</span><span class="lbl"><span class="t">Quitar de la lista</span><div class="s">Sus órdenes e historial se conservan</div></span></button></div>` : ''}
  </div>`, { tab: 'proveedores', bar: `<button class="b block lg" id="p-save">${ic('check')}${id ? 'Guardar cambios' : 'Agregar'}</button>`, main: false });
  let kind = p.kind;
  $$('[data-k]').forEach((b) => (b.onclick = () => {
    kind = b.dataset.k;
    $$('[data-k]').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', String(x === b)); });
    $('#p-company-f').style.display = kind === 'interno' ? 'none' : '';
  }));
  $('#p-save').onclick = async () => {
    const data = { name: $('#p-name').value, kind, company: kind === 'interno' ? '' : $('#p-company').value, specialty: $('#p-spec').value, phone: $('#p-phone').value, notes: $('#p-notes').value };
    if (!data.name.trim()) { toast('Escribe el nombre', { bad: true }); return $('#p-name').focus(); }
    $('#p-save').disabled = true;
    try {
      let newId = id;
      if (id) await api('PATCH', '/providers/' + id, data);
      else newId = (await api('POST', '/providers', data)).id;
      await loadBoot();
      toast(id ? 'Cambios guardados' : 'Proveedor agregado');
      location.replace('#/r/' + newId);
    } catch (e) { toast(e.message, { bad: true }); $('#p-save').disabled = false; }
  };
  const del = $('#p-del');
  if (del) del.onclick = async () => {
    if (!(await confirmSheet('¿Quitar de la lista?', 'Ya no se le podrán asignar órdenes. Su historial se conserva.', 'Quitar', true))) return;
    try { await api('DELETE', '/providers/' + id); await loadBoot(); toast('Quitado de la lista'); location.replace('#/proveedores'); } catch (e) { toast(e.message, { bad: true }); }
  };
}

// ---------- purchases ----------
async function purchaseSheet(base, reload) {
  const r = await sheet({
    title: 'Pedir material', sub: base.task_id ? `Para la orden #${base.task_id}` : 'Material suelto (sin orden)',
    body: `<div class="pad"><label class="flabel" for="pu-item">¿Qué se necesita?</label><input class="input" id="pu-item" maxlength="200" placeholder="Ej. Llave de paso de 1/2&quot;" autocomplete="off">
      <div class="row2 mt"><div><label class="flabel" for="pu-qty">Cantidad</label><input class="input" id="pu-qty" maxlength="60" placeholder="Ej. 2 pzas"></div>
      <div><label class="flabel" for="pu-cost">Costo aprox.</label><input class="input" id="pu-cost" type="number" inputmode="decimal" min="0" step="1" placeholder="$"></div></div>
      <label class="flabel mt" for="pu-prov">¿Dónde se compra? <span class="muted">(opcional)</span></label><select class="input" id="pu-prov">${providerOptions(null, 'No sé / ferretería')}</select></div>`,
    acts: [{ label: 'Cancelar', cls: 'plain', value: null }, {
      label: 'Pedir', value: (w) => {
        const item = $('#pu-item', w).value.trim();
        if (!item) { $('#pu-item', w).focus(); toast('Escribe qué se necesita', { bad: true }); return undefined; }
        return { item, qty: $('#pu-qty', w).value, cost: $('#pu-cost', w).value, provider_id: $('#pu-prov', w).value || null };
      },
    }],
  });
  if (!r) return;
  try { await api('POST', '/purchases', Object.assign({}, base, r)); toast('Material pedido; ya aparece en Compras'); reload && reload(); refreshLists(); } catch (e) { toast(e.message, { bad: true }); }
}
async function purchaseStatus(p, reload) {
  if (!p) return;
  const r = await sheet({
    title: p.item, sub: [p.qty, p.task_id ? `Orden #${p.task_id}` : 'Sin orden'].filter(Boolean).join(' · '),
    opts: [['pedido', 'Pedido', 'Falta comprarlo'], ['comprado', 'Comprado', 'Ya se pagó; falta que llegue'], ['recibido', 'Recibido', 'Ya está aquí'], ['cancelado', 'Cancelado', 'Ya no se necesita']]
      .map(([v, l, s]) => ({ value: v, label: l, sub: s, on: p.status === v, swatch: 'pst-' + v })),
    body: `<div class="pad"><label class="flabel" for="pu-c2">Costo real</label><input class="input" id="pu-c2" type="number" inputmode="decimal" min="0" step="1" value="${p.cost ?? ''}" placeholder="$">
      <p class="small">Se suma al costo de la orden y a los costos del mes.</p></div>
      ${(isAdmin() || p.requested_by === S.user.id) ? `<div class="pad"><button class="b danger block" data-pdel>${ic('trash')}Borrar pedido</button></div>` : ''}`,
    onOpen: (w, close) => {
      // options close the sheet with the status; also carry the cost typed
      $$('[data-opt]', w).forEach((b, i) => (b.onclick = () => close({ status: ['pedido', 'comprado', 'recibido', 'cancelado'][i], cost: $('#pu-c2', w).value })));
      $('#pu-c2', w).onkeydown = (e) => { if (e.key === 'Enter') close({ status: p.status, cost: $('#pu-c2', w).value }); };
      $('#pu-c2', w).onchange = () => { w.dataset.cost = '1'; };
      const del = $('[data-pdel]', w);
      if (del) del.onclick = () => close({ del: true });
      w.onclick = (e) => { if (e.target === w) close(w.dataset.cost ? { status: p.status, cost: $('#pu-c2', w).value } : null); };
    },
  });
  if (!r) return;
  if (r.del) {
    return later('Pedido borrado', () => api('DELETE', '/purchases/' + p.id), { hide: () => { const el = $(`[data-pu="${p.id}"]`); if (el) el.closest('.mat, tr, .cell').classList.add('hidden'); }, undo: reload, done: reload });
  }
  const data = {};
  if (r.status !== p.status) data.status = r.status;
  if (String(r.cost ?? '') !== String(p.cost ?? '')) data.cost = r.cost === '' ? null : r.cost;
  if (!Object.keys(data).length) return;
  try {
    await api('PATCH', '/purchases/' + p.id, data);
    toast(data.status ? `${p.item}: ${PST[data.status]}` : 'Costo guardado', data.status ? { action: { label: 'Deshacer', fn: async () => { await api('PATCH', '/purchases/' + p.id, { status: p.status }); reload && reload(); } } } : {});
    reload && reload();
    refreshLists();
  } catch (e) { toast(e.message, { bad: true }); }
}
async function viewPurchases(query = {}) {
  if (!S.features.purchases) return errorView('Compras se activa al aplicar la migración 0005 de la base de datos.', { tab: 'compras' });
  loading({ tab: 'compras' });
  const f = query.f || store('mt_puf') || 'open';
  let list, sum;
  try { [list, sum] = await Promise.all([api('GET', '/purchases?status=' + (f === 'all' ? '' : f)), api('GET', '/summary')]); } catch (e) { return errorView(e.message, { tab: 'compras' }); }
  list = list.purchases;
  const desk = isDesk();
  const groups = f === 'open' ? [['pedido', 'Por comprar'], ['comprado', 'Comprado, por recibir']] : [[null, null]];
  const row = (p) => `<div class="mat"><div class="lbl"><div class="t">${esc(p.item)}${p.qty ? ` <span class="muted">· ${esc(p.qty)}</span>` : ''}</div>
      <div class="s">${p.task_id ? `<a href="#/t/${p.task_id}" style="text-decoration:underline">#${p.task_id} ${esc(p.task_title || '')}</a>` : 'Sin orden'}${p.provider_name ? ' · ' + esc(p.provider_name) : ''} · ${esc((p.requested_by_name || '').split(' ')[0])} ${rel(p.created_at)}${p.cost ? ' · <b>' + money(p.cost) + '</b>' : ''}</div></div>
      <button class="pst pst-${p.status}" data-pu="${p.id}" aria-label="${esc(p.item)}: ${PST[p.status]}. Cambiar">${PST[p.status]}${ic('down')}</button></div>`;
  const body = list.length ? groups.map(([st, label]) => {
    const items = st ? list.filter((p) => p.status === st) : list;
    if (!items.length) return '';
    return `${label ? `<div class="sec"><h2>${label}</h2><span class="n">${items.length}</span><span class="act small money">${money(items.reduce((s, p) => s + (p.cost || 0), 0))}</span></div>` : ''}<div class="group">${items.map(row).join('')}</div>`;
  }).join('') : `<div class="empty"><h3>${f === 'open' ? 'Nada por comprar' : 'Sin pedidos'}</h3><p>Los pedidos se hacen desde cada orden con “Pedir material”.</p></div>`;
  render(header('Compras', { search: true, right: `<button class="b tonal sm" data-new>${ic('plus')}Pedido</button>` }) + `<div class="wrap ${desk ? 'narrow' : ''}">
    <div class="stats"><div class="stat ${sum.purchases.pending ? 'warn' : 'zero'}"><b>${sum.purchases.pending}</b><span>Por comprar</span></div>
      <div class="stat ${sum.purchases.bought ? '' : 'zero'}"><b>${sum.purchases.bought}</b><span>Por recibir</span></div>
      <div class="stat"><b class="money">${money(sum.material_month)}</b><span>Material del mes</span></div></div>
    <div class="seg" role="tablist" aria-label="Mostrar" style="margin:10px 0 4px">${[['open', 'Pendientes'], ['recibido', 'Recibidos'], ['all', 'Todos']].map(([v, l]) => `<button role="tab" data-pf="${v}" class="${f === v ? 'on' : ''}" aria-selected="${f === v}">${l}</button>`).join('')}</div>
    ${body}
  </div>`, { tab: 'compras' });
  $$('[data-pf]').forEach((b) => (b.onclick = () => { store('mt_puf', b.dataset.pf); viewPurchases({ f: b.dataset.pf }); }));
  $$('[data-pu]').forEach((b) => (b.onclick = () => purchaseStatus(list.find((p) => p.id === Number(b.dataset.pu)), () => viewPurchases({ f }))));
  $('[data-new]').onclick = () => purchaseSheet({}, () => viewPurchases({ f }));
}

// ---------- search ----------
async function viewSearch(query = {}) {
  const q = (query.q || '').trim();
  render(header('Buscar', { back: true }) + `<div class="wrap narrow">
    <div class="field" role="search"><label class="sr" for="s-q">Buscar</label><input id="s-q" type="search" class="big" placeholder="Orden, equipo, proveedor o #número" value="${esc(q)}" autocomplete="off" enterkeyhint="search"></div>
    <div id="s-res">${q ? '<div class="skel"><i></i><i></i></div>' : '<p class="small center">Escribe al menos 2 letras.</p>'}</div></div>`, { tab: '', main: false });
  const input = $('#s-q');
  input.focus();
  input.setSelectionRange(q.length, q.length);
  const run = async (v) => {
    history.replaceState(null, '', '#/buscar?q=' + encodeURIComponent(v));
    if (v.length < 2 && !/^#?\d+$/.test(v)) { $('#s-res').innerHTML = '<p class="small center">Escribe al menos 2 letras.</p>'; return; }
    let r;
    try { r = await api('GET', '/search?q=' + encodeURIComponent(v)); } catch (e) { $('#s-res').innerHTML = `<div class="empty flat"><p>${esc(e.message)}</p></div>`; return; }
    if (input.value.trim() !== v) return;
    const none = !r.tasks.length && !r.equipment.length && !r.providers.length;
    $('#s-res').innerHTML = none ? `<div class="empty flat"><h3>Sin resultados</h3><p>Prueba con otra palabra.</p></div>` : `
      ${r.tasks.length ? `<div class="sec"><h2>Órdenes</h2><span class="n">${r.tasks.length}</span></div><div class="list">${r.tasks.map((t) => woRow(t, { mark: false })).join('')}</div>` : ''}
      ${r.equipment.length ? `<div class="sec"><h2>Equipos</h2><span class="n">${r.equipment.length}</span></div><div class="group">${r.equipment.map((e) => `<a class="cell" href="#/e/${e.id}"><span class="ic">${ic('wrench')}</span><span class="lbl"><div class="t">${esc(e.name)}</div><div class="s">${esc([e.area_name, e.location].filter(Boolean).join(' · '))}</div></span>${ic('chev', 'chev')}</a>`).join('')}</div>` : ''}
      ${r.providers.length ? `<div class="sec"><h2>Proveedores</h2><span class="n">${r.providers.length}</span></div><div class="group">${r.providers.map((p) => `<a class="cell" href="#/r/${p.id}"><span class="ic">${ic('user')}</span><span class="lbl"><div class="t">${esc(p.name)}</div><div class="s">${esc([p.specialty, p.company].filter(Boolean).join(' · '))}</div></span>${ic('chev', 'chev')}</a>`).join('')}</div>` : ''}`;
  };
  input.oninput = debounce(() => run(input.value.trim()), 250);
  if (q) run(q);
}

// ---------- login / setup ----------
async function showLogin(msg = '') {
  NAV.classList.add('hidden');
  SIDE.classList.add('hidden');
  closePanel(false);
  document.body.className = '';
  // Access link: /#/entrar/<token>
  const m = location.hash.match(/^#\/entrar\/([a-f0-9]{20,})/);
  if (m) {
    history.replaceState(null, '', '#/');
    try {
      const r = await api('POST', '/auth/link', { token: m[1] });
      S.user = r.user;
      return start();
    } catch (e) { msg = e.message; }
  }
  let st;
  try {
    st = await (await fetch('/api/status', { credentials: 'same-origin' })).json();
  } catch {
    APP.innerHTML = `<div class="login"><img class="logo logo-img" src="/logo.png" alt="dos búhos"><h1>Sin conexión</h1><p class="tag">Revisa tu internet y vuelve a abrir la app.</p></div>`;
    return;
  }
  if (st.user) { S.user = st.user; return start(); }
  if (st.setup) return showSetup();
  const lastEmail = store('mt_last_email') || '';

  APP.innerHTML = `<div class="login">
    <img class="logo logo-img" src="/logo.png" alt="dos búhos">
    <h1>Mantenimiento</h1>
    ${st.email ? `
      <div id="lg-email">
        <p class="tag">Escribe tu correo y te mandamos un enlace para entrar.</p>
        <div class="field"><input type="email" id="lg-mail" inputmode="email" autocomplete="email" placeholder="tu@correo.com" value="${esc(lastEmail)}"></div>
        <button class="b block" id="lg-send">Enviarme el acceso</button>
      </div>
      <div id="lg-code" class="hidden">
        <p class="tag">Te enviamos un correo. Toca el enlace, o escribe aquí el código de 6 dígitos.</p>
        <div class="field"><input type="text" id="lg-c" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="000000" style="text-align:center;letter-spacing:.4em;font-size:24px;font-weight:700"></div>
        <button class="b block" id="lg-go">Entrar</button>
        <button class="b ghost block mt" id="lg-back">Usar otro correo</button>
      </div>
      <p class="small mt">¿No tienes correo en la app? Pídele a un administrador tu enlace por WhatsApp.</p>`
    : `<p class="tag">Para entrar, abre el enlace que te mandó un administrador por WhatsApp. Si se te perdió, pídele uno nuevo.</p>`}
    <div class="err mt" id="err">${esc(msg)}</div>
    ${st.names.length ? `<button class="b ghost" id="lg-pin" style="margin-top:auto;align-self:center">Entrar con PIN</button>` : ''}
  </div>`;
  const err = (t) => ($('#err').textContent = t || '');
  if (st.email) {
    const mail = $('#lg-mail');
    const send = async () => {
      err();
      const email = mail.value.trim();
      if (!email) return err('Escribe tu correo');
      $('#lg-send').disabled = true;
      try {
        await api('POST', '/auth/email', { email });
        store('mt_last_email', email);
        $('#lg-email').classList.add('hidden');
        $('#lg-code').classList.remove('hidden');
        setTimeout(() => $('#lg-c').focus(), 50);
      } catch (e) { err(e.message); }
      $('#lg-send').disabled = false;
    };
    $('#lg-send').onclick = send;
    mail.onkeydown = (e) => { if (e.key === 'Enter') send(); };
    const go = async () => {
      err();
      try {
        const r = await api('POST', '/auth/code', { email: mail.value.trim(), code: $('#lg-c').value });
        S.user = r.user;
        start();
      } catch (e) { err(e.message); }
    };
    $('#lg-go').onclick = go;
    $('#lg-c').oninput = (e) => { if (e.target.value.replace(/\D/g, '').length === 6) go(); };
    $('#lg-back').onclick = () => { $('#lg-code').classList.add('hidden'); $('#lg-email').classList.remove('hidden'); err(); };
  }
  const pinBtn = $('#lg-pin');
  if (pinBtn) pinBtn.onclick = () => showPinLogin(st.names);
}

function showPinLogin(names) {
  let selected = store('mt_last_user');
  if (!names.some((n) => n.id === selected)) selected = names.length === 1 ? names[0].id : null;
  let pin = '';
  APP.innerHTML = `<div class="login">
    <img class="logo logo-img" src="/logo.png" alt="dos búhos">
    <h1>Entrar con PIN</h1>
    <div class="names" style="margin-top:14px">${names.map((n) => `<button data-id="${n.id}" class="${n.id === selected ? 'on' : ''}">${esc(n.name)}</button>`).join('')}</div>
    <div class="dots" id="dots"></div>
    <div class="err" id="err"></div>
    <div class="keypad">
      ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button data-k="${n}">${n}</button>`).join('')}
      <button class="fn" data-k="back" aria-label="Volver">${ic('back')}</button>
      <button data-k="0">0</button>
      <button class="go" data-k="go" aria-label="Entrar">${ic('check')}</button>
    </div>
  </div>`;
  const dots = $('#dots');
  const draw = () => {
    dots.innerHTML = Array.from({ length: Math.max(4, pin.length) }, (_, i) => `<i class="${i < pin.length ? 'f' : ''}"></i>`).join('');
    $('[data-k="go"]').disabled = pin.length < 4 || !selected;
    $('[data-k="back"]').innerHTML = pin ? ic('del') : ic('back');
  };
  draw();
  $$('.names button').forEach((b) => (b.onclick = () => {
    selected = Number(b.dataset.id);
    $$('.names button').forEach((x) => x.classList.toggle('on', x === b));
    draw();
  }));
  let busy = false;
  const submit = async () => {
    if (busy || pin.length < 4 || !selected) return;
    busy = true;
    try {
      const r = await api('POST', '/login', { user_id: selected, pin });
      store('mt_last_user', selected);
      S.user = r.user;
      document.removeEventListener('keydown', onKey);
      start();
    } catch (e) {
      $('#err').textContent = e.message;
      dots.classList.remove('shake'); void dots.offsetWidth; dots.classList.add('shake');
      pin = ''; draw();
    }
    busy = false;
  };
  const press = (k) => {
    if (k === 'back') { if (!pin) { document.removeEventListener('keydown', onKey); return showLogin(); } pin = pin.slice(0, -1); }
    else if (k === 'go') return submit();
    else if (pin.length < 8) pin += k;
    $('#err').textContent = '';
    draw();
  };
  $$('.keypad button').forEach((b) => (b.onclick = () => press(b.dataset.k)));
  const onKey = (e) => {
    if (/^\d$/.test(e.key)) press(e.key);
    else if (e.key === 'Backspace') press('back');
    else if (e.key === 'Enter') press('go');
  };
  if (showPinLogin.onKey) document.removeEventListener('keydown', showPinLogin.onKey);
  showPinLogin.onKey = onKey;
  document.addEventListener('keydown', onKey);
}

function showSetup() {
  APP.innerHTML = `<div class="login">
    <img class="logo logo-img" src="/logo.png" alt="dos búhos">
    <h1>Mantenimiento</h1>
    <p class="tag">Primera vez. Crea tu usuario de administrador; después das de alta al equipo desde Más.</p>
    <div class="field"><label class="flabel" for="n">Tu nombre</label><input id="n" type="text" autocomplete="name"></div>
    <div class="field"><label class="flabel" for="p1">PIN de 4 a 8 dígitos</label><input id="p1" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="8"></div>
    <div class="field"><label class="flabel" for="p2">Repite el PIN</label><input id="p2" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="8"></div>
    <button class="b block" id="go">Crear y entrar</button>
    <div class="err mt" id="err"></div>
  </div>`;
  $('#go').onclick = async () => {
    const err = $('#err');
    if ($('#p1').value !== $('#p2').value) return (err.textContent = 'Los PIN no coinciden');
    try {
      const r = await api('POST', '/setup', { name: $('#n').value, pin: $('#p1').value });
      S.user = r.user;
      store('mt_last_user', r.user.id);
      start();
    } catch (e) { err.textContent = e.message; }
  };
}


// ---------- users & areas (admin) ----------
async function viewUsers() {
  if (!isAdmin()) return (location.hash = '#/mas');
  loading({ tab: 'usuarios' });
  try { await loadBoot(); } catch (e) { return errorView(e.message); }
  const chev = ic('chev').replace('<svg', '<svg class="chev"');
  render(header('Usuarios', { back: true }) + `<div class="wrap">
    <p class="small" style="margin:0 4px 10px">Cada persona entra con un enlace${S.email_enabled ? ' o con su correo' : ' que le mandas por WhatsApp'}. Queda dentro en su teléfono; no hay contraseñas.</p>
    <div class="group">${S.users.map((u) => {
      const contact = [u.email, u.phone].filter(Boolean).join(', ');
      const seen = !u.active ? 'Sin acceso' : u.last_seen ? `Entró ${rel(u.last_seen)}` : 'Aún no entra';
      return `<a class="cell" href="#/usuarios/${u.id}" style="${u.active ? '' : 'opacity:.55'}"><span class="ic">${ic('user')}</span>
        <span class="lbl"><div class="t">${esc(u.name)}${u.role === 'admin' ? ' <span class="small">(admin)</span>' : ''}</div>
        <div class="s">${esc(seen)}${contact ? ', ' + esc(contact) : ''}</div></span>${chev}</a>`;
    }).join('')}</div>
  </div>`, { bar: `<a class="b block" href="#/usuarios/nuevo">${ic('plus')}Agregar usuario</a>` });
}

async function sendAccess(u) {
  let url;
  try { url = (await api('POST', `/users/${u.id}/access`, { via: 'link' })).url; } catch (e) { return toast(e.message, { bad: true }); }
  const first = u.name.split(' ')[0];
  const text = `Hola ${first}, este es tu acceso a Mantenimiento Dos Búhos. Ábrelo en tu teléfono y quedas dentro:\n${url}\n\n(Vence en 7 días.)`;
  const wa = `https://wa.me/${u.phone ? waNumber(u.phone) : ''}?text=${encodeURIComponent(text)}`;
  const canEmail = S.email_enabled && u.email;
  await sheet({
    title: `Enviar acceso a ${first}`,
    sub: 'Al abrir el enlace queda dentro de la app en su teléfono.',
    body: `<div class="opts">
      <a class="opt" href="${wa}" target="_blank" rel="noopener" data-done>${ic('chat')}<span class="grow">Enviar por WhatsApp${u.phone ? `<div class="s">${esc(u.phone)}</div>` : '<div class="s">Eliges el contacto en WhatsApp</div>'}</span></a>
      ${canEmail ? `<button class="opt" data-mail>${ic('send')}<span class="grow">Enviar por correo<div class="s">${esc(u.email)}</div></span></button>` : ''}
      <button class="opt" data-copy>${ic('share')}<span class="grow">Copiar enlace</span></button>
    </div>`,
    onOpen: (w, close) => {
      $('[data-done]', w).onclick = () => setTimeout(() => close(true), 300);
      $('[data-copy]', w).onclick = async () => {
        try { await navigator.clipboard.writeText(url); toast('Enlace copiado'); } catch { prompt('Copia el enlace:', url); }
        close(true);
      };
      const m = $('[data-mail]', w);
      if (m) m.onclick = async () => {
        close(true);
        try { await api('POST', `/users/${u.id}/access`, { via: 'email' }); toast('Correo enviado a ' + u.email); } catch (e) { toast(e.message, { bad: true }); }
      };
    },
  });
}

async function viewUserForm(id) {
  if (!isAdmin()) return (location.hash = '#/mas');
  await loadBoot();
  const u = id ? S.users.find((x) => x.id === Number(id)) : { name: '', role: 'staff', active: 1, provider_id: null, email: '', phone: '' };
  if (!u) return (location.hash = '#/usuarios');
  const avail = S.providers.filter((p) => p.active || p.id === u.provider_id);
  let receives = !!u.provider_id;
  render(header(id ? 'Editar usuario' : 'Nuevo usuario', { close: !id, back: !!id }) + `<div class="wrap">
    ${id && u.active ? `<div class="group"><button class="cell add" id="u-access"><span class="ic">${ic('send')}</span>
      <span class="lbl"><span class="t">Enviar acceso</span><div class="s" style="font-weight:400">${u.last_seen ? 'Entró ' + rel(u.last_seen) : 'Aún no entra'}</div></span></button></div>` : ''}
    <div class="field"><label class="flabel" for="u-name">Nombre</label><input type="text" class="big" id="u-name" value="${esc(u.name)}" autocomplete="off"></div>
    <div class="row2">
      <div class="field"><label class="flabel" for="u-phone">WhatsApp</label><input type="tel" id="u-phone" value="${esc(u.phone || '')}" placeholder="10 dígitos"></div>
      <div class="field"><label class="flabel" for="u-email">Correo</label><input type="email" id="u-email" inputmode="email" value="${esc(u.email || '')}" placeholder="Opcional" autocomplete="off"></div>
    </div>
    <div class="field"><span class="flabel">Permisos</span><div class="seg">
      <button type="button" data-r="staff" class="${u.role !== 'admin' ? 'on' : ''}">Usuario</button>
      <button type="button" data-r="admin" class="${u.role === 'admin' ? 'on' : ''}">Administrador</button></div>
      <p class="hint">Un administrador puede eliminar órdenes, dar acceso a otros y manejar áreas.</p></div>
    <div class="field"><span class="flabel">¿Se le asignan trabajos?</span><div class="seg">
      <button type="button" data-rx="0" class="${receives ? '' : 'on'}">No</button>
      <button type="button" data-rx="1" class="${receives ? 'on' : ''}">Sí</button></div>
      <p class="hint">Sí: aparece en Proveedores como personal interno, ve “Mías” en Hoy y puede tomar órdenes.</p></div>
    <div id="u-rx" class="${receives ? '' : 'hidden'}">
      ${avail.length ? `<div class="field"><label class="flabel" for="u-prov">Ficha de responsable</label>
        <select id="u-prov"><option value="new">Crear su ficha</option>${avail.map((p) => `<option value="${p.id}" ${p.id === u.provider_id ? 'selected' : ''}>${esc(provLabel(p))}</option>`).join('')}</select>
        <p class="hint">Si ya tiene ficha, elígela para no duplicarlo.</p></div>` : '<input type="hidden" id="u-prov" value="new">'}
      <div id="u-new" class="${u.provider_id ? 'hidden' : ''}">
        <div class="field"><label class="flabel" for="u-spec">Especialidad</label><input type="text" id="u-spec" placeholder="Ej. Mantenimiento"></div>
      </div>
    </div>
    ${id && u.id !== S.user.id ? `<div class="group"><button class="cell ${u.active ? 'danger' : ''}" id="u-toggle"><span class="ic">${ic(u.active ? 'lock' : 'check')}</span>
      <span class="lbl"><span class="t">${u.active ? 'Quitar acceso' : 'Devolver acceso'}</span><div class="s">${u.active ? 'Cierra su sesión en todos sus dispositivos' : ''}</div></span></button></div>` : ''}
  </div>`, { tab: 'usuarios', main: false, bar: `<button class="b block lg" id="u-save">${ic('check')}${id ? 'Guardar cambios' : 'Crear y enviar acceso'}</button>` });
  let role = u.role;
  $$('[data-r]').forEach((b) => (b.onclick = () => { role = b.dataset.r; $$('[data-r]').forEach((x) => x.classList.toggle('on', x === b)); }));
  const provSel = $('#u-prov');
  const syncNew = () => $('#u-new').classList.toggle('hidden', provSel.value !== 'new');
  const matchByName = () => {
    if (u.provider_id || provSel.tagName !== 'SELECT') return;
    const n = $('#u-name').value.trim().toLowerCase();
    const m = n && avail.find((p) => p.name.trim().toLowerCase() === n);
    provSel.value = m ? String(m.id) : 'new';
    syncNew();
  };
  $$('[data-rx]').forEach((b) => (b.onclick = () => {
    receives = b.dataset.rx === '1';
    $$('[data-rx]').forEach((x) => x.classList.toggle('on', x === b));
    $('#u-rx').classList.toggle('hidden', !receives);
    if (receives) matchByName();
  }));
  if (provSel.tagName === 'SELECT') provSel.onchange = syncNew;
  $('#u-name').onchange = () => { if (receives) matchByName(); };
  const acc = $('#u-access');
  if (acc) acc.onclick = () => sendAccess(Object.assign({}, u, { phone: $('#u-phone').value.trim(), email: $('#u-email').value.trim() }));
  $('#u-save').onclick = async () => {
    const data = { name: $('#u-name').value, role, phone: $('#u-phone').value, email: $('#u-email').value };
    if (!data.name.trim()) { toast('Escribe el nombre', { bad: true }); return $('#u-name').focus(); }
    if (!receives) data.provider_id = null;
    else if (provSel.value === 'new') Object.assign(data, { provider_id: 'new', specialty: $('#u-spec').value });
    else data.provider_id = Number(provSel.value);
    const btn = $('#u-save');
    btn.disabled = true;
    try {
      const r = id ? await api('PATCH', '/users/' + id, data) : await api('POST', '/users', data);
      await loadBoot();
      if (Number(id) === S.user.id) S.user = Object.assign(S.user, { provider_id: r.provider_id ?? S.user.provider_id, name: data.name.trim() });
      if (!id) {
        history.replaceState(null, '', '#/usuarios/' + r.id);
        await viewUserForm(r.id);
        const nu = S.users.find((x) => x.id === r.id);
        if (nu) sendAccess(nu);
        return;
      }
      toast('Cambios guardados');
      location.replace('#/usuarios');
    } catch (e) { toast(e.message, { bad: true }); btn.disabled = false; }
  };
  const tg = $('#u-toggle');
  if (tg) tg.onclick = async () => {
    if (u.active && !(await confirmSheet(`¿Quitar acceso a ${u.name}?`, 'Se cierra su sesión y sus enlaces dejan de servir. Sus tareas se conservan.', 'Quitar acceso', true))) return;
    try { await api('PATCH', '/users/' + id, { active: !u.active }); await loadBoot(); toast(u.active ? 'Acceso quitado' : 'Acceso devuelto'); location.replace('#/usuarios'); }
    catch (e) { toast(e.message, { bad: true }); }
  };
}

async function viewAreas() {
  if (!isAdmin()) return (location.hash = '#/mas');
  await loadBoot();
  const list = S.areas;
  render(header('Áreas', { back: true }) + `<div class="wrap">
    <p class="small" style="margin:0 4px 10px">Toca un área para renombrarla u ocultarla. Las flechas cambian el orden en toda la app.</p>
    <div class="group">${list.map((a, i) => `<div class="cell" style="${a.active ? '' : 'opacity:.5'}">
      <button class="lbl" data-edit="${a.id}" style="border:0;background:none;text-align:left;padding:0;min-height:44px;color:inherit">
        <div class="t">${esc(a.name)}</div>${a.active ? '' : '<div class="s">Oculta</div>'}</button>
      <button class="ib" data-up="${i}" aria-label="Subir" ${i === 0 ? 'disabled style="opacity:.25"' : ''}>${ic('up')}</button>
      <button class="ib" data-down="${i}" aria-label="Bajar" ${i === list.length - 1 ? 'disabled style="opacity:.25"' : ''}>${ic('down')}</button>
    </div>`).join('')}</div>
  </div>`, { tab: 'areas', keepScroll: true, bar: `<button class="b block lg" id="a-add">${ic('plus')}Agregar área</button>` });
  $$('[data-edit]').forEach((b) => (b.onclick = async () => {
    const a = list.find((x) => x.id === Number(b.dataset.edit));
    const v = await sheet({
      title: 'Editar área',
      body: `<div class="pad"><input class="input" id="sh-in" value="${esc(a.name)}" maxlength="60"></div>`,
      acts: [{ label: a.active ? 'Ocultar' : 'Mostrar', cls: 'plain', value: { toggle: true } }, { label: 'Guardar', value: (w) => ({ name: $('#sh-in', w).value.trim() }) }],
    });
    if (!v) return;
    try {
      if (v.toggle) { await api('PATCH', '/areas/' + a.id, { active: !a.active }); toast(a.active ? 'Área oculta' : 'Área visible'); }
      else if (v.name && v.name !== a.name) { await api('PATCH', '/areas/' + a.id, { name: v.name }); toast('Área renombrada'); }
      viewAreas();
    } catch (e) { toast(e.message, { bad: true }); }
  }));
  const swap = async (i, j) => {
    const order = list.map((x) => x.id);
    [order[i], order[j]] = [order[j], order[i]];
    try {
      await Promise.all(order.map((aid, k) => {
        const a = list.find((x) => x.id === aid);
        return a.sort !== k + 1 ? api('PATCH', '/areas/' + aid, { sort: k + 1 }) : null;
      }));
      viewAreas();
    } catch (e) { toast(e.message, { bad: true }); }
  };
  $$('[data-up]').forEach((b) => (b.onclick = () => swap(Number(b.dataset.up), Number(b.dataset.up) - 1)));
  $$('[data-down]').forEach((b) => (b.onclick = () => swap(Number(b.dataset.down), Number(b.dataset.down) + 1)));
  $('#a-add').onclick = async () => {
    const name = await inputSheet('Nueva área', '', 'Agregar', { placeholder: 'Ej. Estacionamiento' });
    if (!name) return;
    try { await api('POST', '/areas', { name }); toast('Área agregada'); viewAreas(); } catch (e) { toast(e.message, { bad: true }); }
  };
}


// ---------- Más ----------
async function viewMore() {
  const me = S.providers.find((p) => p.id === myProv());
  const F = S.features;
  const link = (h, i, t, s) => `<a class="cell" href="${h}"><span class="ic">${ic(i)}</span><span class="lbl"><div class="t">${t}</div>${s ? `<div class="s">${s}</div>` : ''}</span>${ic('chev', 'chev')}</a>`;
  render(header('Más') + `<div class="wrap narrow">
    <div class="group">
      <div class="cell"><span class="ic">${ic('user')}</span><span class="lbl"><div class="t">${esc(S.user.name)}</div>
        <div class="s">${isAdmin() ? 'Administrador' : 'Usuario'}${me ? ` · recibe órdenes como ${esc(me.name)}` : ''}</div></span></div>
      <button class="cell" id="m-pin"><span class="ic">${ic('lock')}</span><span class="lbl"><span class="t">PIN de respaldo</span><div class="s">Por si pierdes tu enlace de acceso</div></span>${ic('chev', 'chev')}</button>
    </div>
    <div class="group">
      ${F.pm ? link('#/preventivo', 'repeat', 'Preventivo', 'Trabajos que se repiten y su calendario') : ''}
      ${link('#/proveedores', 'users', 'Proveedores', 'Llamar o escribir con un toque')}
      ${F.purchases ? link('#/compras', 'cart', 'Compras', 'Material pedido, comprado y recibido') : ''}
      ${link('#/buscar', 'search', 'Buscar', 'Órdenes, equipos y proveedores')}
    </div>
    ${isAdmin() ? `<div class="group">
      ${link('#/usuarios', 'user', 'Usuarios', 'Quién entra y enviar accesos')}
      ${link('#/areas', 'map', 'Áreas', 'Renombrar, ordenar, agregar')}
    </div>` : ''}
    <div class="group">
      <button class="cell" id="m-share"><span class="ic">${ic('share')}</span><span class="lbl"><span class="t">Compartir la app</span></span>${ic('chev', 'chev')}</button>
      <button class="cell danger" id="m-out"><span class="ic">${ic('logout')}</span><span class="lbl"><span class="t">Cerrar sesión</span></span></button>
    </div>
    <p class="small center">En el teléfono, usa “Agregar a pantalla de inicio” para abrirla como app.</p>
  </div>`, { tab: 'mas' });
  $('#m-pin').onclick = async () => {
    const v = await inputSheet('Nuevo PIN', '', 'Guardar PIN', { type: 'password', mode: 'numeric', sub: 'De 4 a 8 dígitos.' });
    if (v === null) return;
    try { await api('POST', '/me/pin', { pin: v }); toast('PIN actualizado'); } catch (e) { toast(e.message, { bad: true }); }
  };
  $('#m-out').onclick = async () => {
    if (!(await confirmSheet('¿Cerrar sesión?', 'Para volver a entrar necesitarás un enlace nuevo, tu correo o tu PIN.', 'Cerrar sesión', true))) return;
    await api('POST', '/logout').catch(() => {});
    S.user = null;
    history.replaceState(null, '', '#/');
    showLogin();
  };
  $('#m-share').onclick = async () => {
    const url = location.origin;
    try {
      if (navigator.share) await navigator.share({ title: 'Mantenimiento Dos Búhos', url });
      else { await navigator.clipboard.writeText(url); toast('Enlace copiado'); }
    } catch { /* cancelled */ }
  };
}

// ---------- router ----------
async function route() {
  if (!S.user || /^#\/entrar\//.test(location.hash)) {
    if (S.user) { history.replaceState(null, '', '#/'); } else return showLogin();
  }
  if (UI.skipRoute) { UI.skipRoute = false; return; }
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = raw.split('?');
  const query = Object.fromEntries(new URLSearchParams(qs || ''));
  const p = path.split('/').filter(Boolean);
  $('#viewer').classList.add('hidden');
  if (sheet.close) sheet.close();
  // desktop: an order opens in the side panel over the list that is already on screen
  if (isDesk() && p[0] === 't' && p[1] && !p[2]) return openPanel(p[1]);
  if (isDesk() && UI.panelId && location.hash === UI.mainHash) return closePanel(false);
  UI.refresh = null;
  try {
    if (!p.length) return await viewHome();
    if (p[0] === 'ordenes') return await viewOrders(query);
    if (p[0] === 'reportar' || p[0] === 'nueva') return await viewReport(query);
    if (p[0] === 'reportado' && p[1]) return viewReported(p[1]);
    if (p[0] === 't' && p[1] && p[2] === 'editar') return await viewTaskEdit(p[1]);
    if (p[0] === 't' && p[1]) return await viewTask(p[1]);
    if (p[0] === 'equipos') return await viewEquipmentList();
    if (p[0] === 'e' && p[1] === 'nuevo') return await viewEquipmentForm(null);
    if (p[0] === 'e' && p[1] && p[2] === 'editar') return await viewEquipmentForm(p[1]);
    if (p[0] === 'e' && p[1]) return await viewEquipment(p[1]);
    if (p[0] === 'servicio' && p[1]) return await viewService(p[1]);
    if (p[0] === 'preventivo' && p[1] === 'nuevo') return await viewPMForm(null, query);
    if (p[0] === 'preventivo' && p[1]) return await viewPMForm(p[1]);
    if (p[0] === 'preventivo') return await viewPM(query);
    if (p[0] === 'proveedores' || p[0] === 'responsables') return await viewProviders();
    if (p[0] === 'r' && p[1] === 'nuevo') return await viewProviderForm(null, query);
    if (p[0] === 'r' && p[1] && p[2] === 'editar') return await viewProviderForm(p[1]);
    if (p[0] === 'r' && p[1]) return await viewProvider(p[1]);
    if (p[0] === 'compras') return await viewPurchases(query);
    if (p[0] === 'buscar') return await viewSearch(query);
    if (p[0] === 'mas') return await viewMore();
    if (p[0] === 'usuarios' && p[1] === 'nuevo') return await viewUserForm(null);
    if (p[0] === 'usuarios' && p[1]) return await viewUserForm(p[1]);
    if (p[0] === 'usuarios') return await viewUsers();
    if (p[0] === 'areas') return await viewAreas();
    location.hash = '#/';
  } catch (e) {
    if (S.user) errorView(e.message);
  }
}

async function start() {
  try { await loadBoot(); } catch { return; }
  route();
}

// ---------- keyboard ----------
document.addEventListener('keydown', (e) => {
  if (!S.user) return;
  const typing = e.target.closest && e.target.closest('input, textarea, select, [contenteditable]');
  if (e.key === 'Escape') {
    if (sheet.close) { e.preventDefault(); return sheet.close(); }
    if (!$('#viewer').classList.contains('hidden')) { const c = $('#viewer [data-close]'); if (c) c.click(); return; }
    if (typing) return;
    if (UI.panelId) { e.preventDefault(); return closePanel(true); }
    return;
  }
  if (typing || e.metaKey || e.ctrlKey || e.altKey || sheet.close) return;
  if (e.key === '/') {
    e.preventDefault();
    const g = $('#gsearch');
    if (g) g.focus(); else location.hash = '#/buscar';
  } else if (e.key === 'n' || e.key === 'N') {
    e.preventDefault();
    location.hash = '#/reportar';
  }
});

window.addEventListener('hashchange', () => { inAppNavs++; route(); });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && S.user && UI.refresh && !sheet.close) UI.refresh();
});
let wasDesk = isDesk();
window.addEventListener('resize', debounce(() => { if (isDesk() !== wasDesk) { wasDesk = isDesk(); if (S.user) { closePanel(false); route(); } } }, 200));
showLogin();
