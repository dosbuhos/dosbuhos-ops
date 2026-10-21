/* Tecolote — mantenimiento Dos Búhos (vanilla JS, no build step) */
'use strict';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const APP = $('#app');
const NAV = $('#nav');
const FAB = $('#fab');

const S = { user: null, areas: [], providers: [], equipment: [], users: [] };
const PRIO = { 1: ['Urgente', 'var(--red)'], 2: ['Alta', 'var(--amber)'], 3: ['Normal', 'var(--blue)'], 4: ['Baja', 'var(--grey)'] };
const STATUS = { pendiente: 'Pendiente', en_proceso: 'En proceso', en_espera: 'En espera', hecha: 'Hecha', cancelada: 'Cancelada' };
const OPEN = ['pendiente', 'en_proceso', 'en_espera'];

// ---------- utils ----------
const ic = (n) => `<svg aria-hidden="true"><use href="#i-${n}"/></svg>`;
function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function store(key, val) {
  try {
    if (val === undefined) return JSON.parse(localStorage.getItem(key));
    localStorage.setItem(key, JSON.stringify(val));
  } catch { return null; }
}
function toast(msg, bad = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast show' + (bad ? ' bad' : '');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.className = 'toast' + (bad ? ' bad' : '')), bad ? 3500 : 1700);
}
const parseUTC = (s) => (s ? new Date(s.replace(' ', 'T') + 'Z') : null);
const pad2 = (n) => String(n).padStart(2, '0');
const ymdOf = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const todayStr = () => ymdOf(new Date());
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
function fmtDay(ymd) {
  if (!ymd) return '';
  const [y, m, d] = ymd.split('-').map(Number);
  if (ymd === todayStr()) return 'hoy';
  return `${d} ${MESES[m - 1]}${y === new Date().getFullYear() ? '' : ' ' + y}`;
}
function fmtDateTime(s) {
  const d = parseUTC(s);
  if (!d) return '';
  const day = ymdOf(d) === todayStr() ? 'Hoy' : `${d.getDate()} ${MESES[d.getMonth()]}${d.getFullYear() === new Date().getFullYear() ? '' : ' ' + d.getFullYear()}`;
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
function daysBetween(a, b) {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}
function addDays(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
function waNumber(phone) {
  let d = String(phone || '').replace(/\D/g, '');
  if (d.length === 10) d = '52' + d;
  return d;
}
const isAdmin = () => S.user && S.user.role === 'admin';
const myProv = () => (S.user && S.user.provider_id) || null;
const areaName = (id) => (S.areas.find((a) => a.id === id) || {}).name || 'Sin área';
const activeProviders = () => S.providers.filter((p) => p.active);
const provLabel = (p) => p.name + (p.company ? ` (${p.company})` : '');

// ---------- API ----------
async function api(method, path, data) {
  const opts = { method, headers: {}, credentials: 'same-origin' };
  if (data !== undefined) {
    opts.headers['content-type'] = 'application/json';
    opts.body = JSON.stringify(data);
  }
  let res;
  try { res = await fetch('/api' + path, opts); } catch { throw new Error('Sin conexión. Revisa tu internet.'); }
  let out = {};
  try { out = await res.json(); } catch { /* empty */ }
  if (res.status === 401 && !path.startsWith('/login') && !path.startsWith('/setup')) {
    S.user = null;
    showLogin();
    throw new Error('Inicia sesión');
  }
  if (!res.ok) throw new Error(out.error || 'Error ' + res.status);
  return out;
}
async function loadBoot() { Object.assign(S, await api('GET', '/bootstrap')); }

// ---------- photos ----------
function compress(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const s = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * s);
        c.height = Math.round(img.naturalHeight * s);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        c.toBlob((b) => resolve(b || file), 'image/jpeg', 0.78);
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
function openViewer(photoId, canDelete, onDelete) {
  const v = $('#viewer');
  v.innerHTML = `<div class="vbar"><button class="ib" data-close aria-label="Cerrar">${ic('x')}</button>
    ${canDelete ? `<button class="ib" data-del aria-label="Borrar foto">${ic('trash')}</button>` : ''}</div>
    <img src="/api/photos/${photoId}" alt="">`;
  v.classList.remove('hidden');
  $('[data-close]', v).onclick = () => v.classList.add('hidden');
  const del = $('[data-del]', v);
  if (del) del.onclick = async () => {
    if (!(await confirmSheet('¿Borrar esta foto?', 'No se puede recuperar.', 'Borrar foto', true))) return;
    try {
      await api('DELETE', '/photos/' + photoId);
      v.classList.add('hidden');
      toast('Foto borrada');
      onDelete && onDelete();
    } catch (e) { toast(e.message, true); }
  };
}
function photoStrip(photos, inputId) {
  return `<div class="strip">
    <label class="add" for="${inputId}">${ic('camera')}Agregar</label>
    ${photos.map((p) => `<button class="ph" data-photo="${p.id}" data-uid="${p.user_id}" aria-label="Ver foto"><img loading="lazy" src="/api/photos/${p.id}" alt=""></button>`).join('')}
  </div><input type="file" id="${inputId}" accept="image/*" multiple hidden>`;
}
function bindPhotoStrip(root, inputId, uploadPath, reload) {
  $$('[data-photo]', root).forEach((el) => {
    el.onclick = () => openViewer(el.dataset.photo, isAdmin() || Number(el.dataset.uid) === S.user.id, reload);
  });
  const input = $('#' + inputId);
  if (!input) return;
  input.onchange = async () => {
    const files = [...input.files];
    input.value = '';
    if (!files.length) return;
    const strip = $('.strip', root);
    const after = $('.add', strip);
    const holders = files.map(() => {
      const d = document.createElement('div');
      d.className = 'ph uploading';
      after.after(d);
      return d;
    });
    let ok = 0;
    for (const f of files) {
      try { await uploadPhoto(uploadPath, f); ok++; } catch (e) { toast(e.message, true); }
    }
    holders.forEach((h) => h.remove());
    if (ok) toast(ok === 1 ? 'Foto agregada' : `${ok} fotos agregadas`);
    reload();
  };
}

// ---------- bottom sheet ----------
function sheet({ title = '', sub = '', opts = null, body = '', acts = null, onOpen = null }) {
  return new Promise((resolve) => {
    const w = $('#sheet');
    let lastGroup = null;
    const optHtml = opts ? `<div class="opts">${opts.map((o, i) => {
      const g = o.group && o.group !== lastGroup ? `<div class="ogroup">${esc(o.group)}</div>` : '';
      lastGroup = o.group || lastGroup;
      return `${g}<button class="opt ${o.on ? 'on' : ''}" data-opt="${i}">
        ${o.icon ? ic(o.icon) : ''}<span class="grow">${esc(o.label)}${o.sub ? `<div class="s">${esc(o.sub)}</div>` : ''}</span>
        <span class="tick">${ic('check')}</span></button>`;
    }).join('')}</div>` : '';
    w.innerHTML = `<div class="sheet" role="dialog" aria-label="${esc(title)}"><div class="grab"></div>
      ${title ? `<h3>${esc(title)}</h3>` : ''}${sub ? `<p class="sub">${esc(sub)}</p>` : ''}
      ${optHtml}${body}
      ${acts ? `<div class="acts">${acts.map((a, i) => `<button class="b ${a.cls || ''}" data-act="${i}">${a.label}</button>`).join('')}</div>` : ''}
    </div>`;
    w.classList.remove('hidden');
    const close = (v) => { w.classList.add('hidden'); w.innerHTML = ''; w.onclick = null; resolve(v); };
    w.onclick = (e) => { if (e.target === w) close(null); };
    $$('[data-opt]', w).forEach((b) => (b.onclick = () => close(opts[Number(b.dataset.opt)].value)));
    $$('[data-act]', w).forEach((b) => (b.onclick = () => {
      const a = acts[Number(b.dataset.act)];
      close(typeof a.value === 'function' ? a.value(w) : a.value);
    }));
    if (onOpen) onOpen(w, close);
  });
}
function confirmSheet(title, sub, okLabel, danger = false) {
  return sheet({ title, sub, acts: [{ label: 'Cancelar', cls: 'plain', value: false }, { label: okLabel, cls: danger ? 'danger' : '', value: true }] });
}
function inputSheet(title, value, okLabel, { sub = '', type = 'text', placeholder = '', mode = '' } = {}) {
  return sheet({
    title, sub,
    body: `<div class="pad"><input class="input" id="sh-in" type="${type}" ${mode ? `inputmode="${mode}"` : ''} value="${esc(value || '')}" placeholder="${esc(placeholder)}" maxlength="80"></div>`,
    acts: [{ label: 'Cancelar', cls: 'plain', value: null }, { label: okLabel, value: (w) => $('#sh-in', w).value.trim() }],
    onOpen: (w, close) => {
      const i = $('#sh-in', w);
      setTimeout(() => i.focus(), 60);
      i.onkeydown = (e) => { if (e.key === 'Enter') close(i.value.trim()); };
    },
  });
}
function pickProvider(selected, emptyLabel = 'Bandeja (sin asignar)') {
  const avail = S.providers.filter((p) => p.active || p.id === selected);
  const opts = [{ value: 0, label: emptyLabel, sub: 'Mantenimiento decide quién la hace', icon: 'inbox', on: !selected }];
  for (const p of avail.filter((x) => x.kind === 'interno')) opts.push({ value: p.id, label: p.name, sub: p.specialty, icon: 'user', on: p.id === selected, group: 'Personal interno' });
  for (const p of avail.filter((x) => x.kind === 'externo')) opts.push({ value: p.id, label: provLabel(p), sub: p.specialty, icon: 'user', on: p.id === selected, group: 'Proveedores externos' });
  return sheet({ title: 'Asignar a', opts });
}

// ---------- shell ----------
function rootHeader(title, right = '') {
  const brand = title === null;
  return `<header class="top">${brand
    ? `<div class="brand"><span class="mark">${ic('owl')}</span><b>Tecolote</b></div>`
    : `<h1>${esc(title)}</h1>`}${right}</header>`;
}
function subHeader(title, right = '', { close = false } = {}) {
  return `<header class="top sub">
    <button class="ib" data-back aria-label="${close ? 'Cerrar' : 'Atrás'}">${ic(close ? 'x' : 'back')}</button>
    <h1>${esc(title)}</h1>${right || '<span style="width:40px"></span>'}</header>`;
}
let inAppNavs = 0;
function goBack() {
  if (inAppNavs > 0) history.back();
  else location.hash = '#/';
}
function render(html, { tab = '', root = false, bar = '', keepScroll = false } = {}) {
  const y = window.scrollY;
  APP.innerHTML = html + (bar ? `<div class="actionbar">${bar}</div>` : '');
  NAV.classList.toggle('hidden', !root);
  const fab = root && (tab === 'tareas' || tab === 'equipos');
  FAB.classList.toggle('hidden', !fab);
  document.body.classList.toggle('no-fab', !fab);
  document.body.classList.toggle('has-tabs', root);
  document.body.classList.toggle('has-bar', !root && !!bar);
  $$('a[data-tab]', NAV).forEach((a) => a.classList.toggle('on', a.dataset.tab === tab));
  const back = $('[data-back]', APP);
  if (back) back.onclick = goBack;
  window.scrollTo(0, keepScroll ? y : 0);
}
function loading(opts) { render('<div class="boot"></div>', opts); }
function errorView(msg, root) {
  render((root ? rootHeader('Tecolote') : subHeader('')) + `<div class="wrap"><div class="empty"><h3>No se pudo cargar</h3><p>${esc(msg)}</p>
    <button class="b tonal" onclick="location.reload()">${ic('refresh')}Reintentar</button></div></div>`, { root });
}

// ---------- login / setup ----------
async function showLogin() {
  NAV.classList.add('hidden');
  FAB.classList.add('hidden');
  document.body.className = '';
  let st;
  try {
    st = await (await fetch('/api/status', { credentials: 'same-origin' })).json();
  } catch {
    APP.innerHTML = `<div class="login"><h1>Sin conexión</h1><p class="tag">Revisa tu internet y vuelve a abrir la app.</p></div>`;
    return;
  }
  if (st.user) { S.user = st.user; return start(); }
  if (st.setup) return showSetup();

  let selected = store('mt_last_user');
  if (!st.names.some((n) => n.id === selected)) selected = st.names.length === 1 ? st.names[0].id : null;
  let pin = '';
  APP.innerHTML = `<div class="login">
    <div class="logo">${ic('owl')}</div>
    <h1>Tecolote</h1>
    <p class="tag">Mantenimiento Dos Búhos. ¿Quién eres?</p>
    <div class="names">${st.names.map((n) => `<button data-id="${n.id}" class="${n.id === selected ? 'on' : ''}">${esc(n.name)}</button>`).join('')}</div>
    <div class="dots" id="dots"></div>
    <div class="err" id="err"></div>
    <div class="keypad">
      ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button data-k="${n}">${n}</button>`).join('')}
      <button class="fn" data-k="del" aria-label="Borrar">${ic('del')}</button>
      <button data-k="0">0</button>
      <button class="go" data-k="go" aria-label="Entrar">${ic('check')}</button>
    </div>
  </div>`;
  const dots = $('#dots');
  const draw = () => {
    const n = Math.max(4, pin.length);
    dots.innerHTML = Array.from({ length: n }, (_, i) => `<i class="${i < pin.length ? 'f' : ''}"></i>`).join('');
    $('[data-k="go"]').disabled = pin.length < 4 || !selected;
  };
  draw();
  $$('.names button').forEach((b) => (b.onclick = () => {
    selected = Number(b.dataset.id);
    $$('.names button').forEach((x) => x.classList.toggle('on', x === b));
    $('#err').textContent = '';
    draw();
  }));
  let busy = false;
  const submit = async () => {
    if (busy) return;
    if (!selected) { $('#err').textContent = 'Toca tu nombre arriba'; return; }
    if (pin.length < 4) return;
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
    if (k === 'del') pin = pin.slice(0, -1);
    else if (k === 'go') return submit();
    else if (pin.length < 8) pin += k;
    $('#err').textContent = '';
    draw();
  };
  $$('.keypad button').forEach((b) => (b.onclick = () => press(b.dataset.k)));
  const onKey = (e) => {
    if (/^\d$/.test(e.key)) press(e.key);
    else if (e.key === 'Backspace') press('del');
    else if (e.key === 'Enter') press('go');
  };
  if (showLogin.onKey) document.removeEventListener('keydown', showLogin.onKey);
  showLogin.onKey = onKey;
  document.addEventListener('keydown', onKey);
}

function showSetup() {
  APP.innerHTML = `<div class="login">
    <div class="logo">${ic('owl')}</div>
    <h1>Tecolote</h1>
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

// ---------- task list ----------
const TL = { key: null, tasks: [], searching: false };
function listFilters() {
  const f = Object.assign({ view: 'open', area: '', provider: '', q: '' }, store('mt_filters') || {});
  if (f.view === 'mine' && !myProv()) f.view = 'open';
  return f;
}
const saveFilters = (f) => store('mt_filters', f);

function taskCard(t, { showArea = true } = {}) {
  const [plabel, pcolor] = PRIO[t.priority] || PRIO[3];
  const open = OPEN.includes(t.status);
  const late = open && t.due_date && t.due_date < todayStr();
  const who = t.provider_id
    ? `<span>${ic('user')}${esc(t.provider_name)}${t.provider_company ? ', ' + esc(t.provider_company) : ''}</span>`
    : (open ? `<span class="inb">${ic('inbox')}Bandeja</span>` : '');
  const due = open && t.due_date ? `<span class="${late ? 'late' : ''}">${ic(late ? 'alert' : 'cal')}${late ? 'Vencida, ' : ''}${fmtDay(t.due_date)}</span>` : '';
  const done = !open && t.completed_at ? `<span>${ic('check')}${fmtDay(localYmd(t.completed_at))}</span>` : '';
  return `<a class="tcard" style="--pc:${pcolor}" href="#/t/${t.id}">
    <div class="row1"><div class="t">${t.kind === 'servicio' && !/^servicio/i.test(t.title) ? 'Servicio: ' : ''}${esc(t.title)}</div>
      <span class="pill st-${t.status}">${STATUS[t.status]}</span></div>
    <div class="meta">
      ${open ? `<span class="pr" style="--pc:${pcolor}">${plabel}</span>` : ''}
      ${who}${due}${done}
      ${showArea ? `<span>${ic('pin')}${esc(t.area_name || 'Sin área')}${t.equipment_name ? ', ' + esc(t.equipment_name) : ''}</span>` : (t.equipment_name ? `<span>${ic('wrench')}${esc(t.equipment_name)}</span>` : '')}
      ${t.photo_count ? `<span>${ic('camera')}${t.photo_count}</span>` : ''}
      ${t.note_count ? `<span>${ic('chat')}${t.note_count}</span>` : ''}
    </div>
    <div class="meta"><span>Pidió ${esc(t.created_by_name || '—')}, ${rel(t.created_at)}</span></div>
  </a>`;
}

async function viewTasks({ silent = false } = {}) {
  const f = listFilters();
  const key = f.view === 'done' ? 'view=done' : f.view === 'asked' ? 'view=all&mine=1' : 'view=open';
  if (!silent || TL.key !== key) loading({ tab: 'tareas', root: true });
  try {
    TL.tasks = (await api('GET', '/tasks?' + key)).tasks;
    TL.key = key;
  } catch (e) { return errorView(e.message, true); }
  drawTasks({ keepScroll: silent });
}

function drawTasks({ keepScroll = false, refocus = false } = {}) {
  const f = listFilters();
  const me = myProv();
  let base = TL.tasks;
  if (f.view === 'mine') base = base.filter((t) => t.provider_id === me);
  const q = f.q.trim().toLowerCase();
  const byText = base.filter((t) => !q || [t.title, t.description, t.equipment_name, t.provider_name, t.provider_company, t.created_by_name, t.area_name, '#' + t.id]
    .join(' ').toLowerCase().includes(q));
  const byProv = byText.filter((t) => !f.provider || (f.provider === 'none' ? !t.provider_id : String(t.provider_id) === f.provider));
  const shown = byProv.filter((t) => !f.area || String(t.area_id || 0) === f.area);

  const counts = {};
  byProv.forEach((t) => { const k = String(t.area_id || 0); counts[k] = (counts[k] || 0) + 1; });
  const inboxN = f.view === 'open'
    ? byText.filter((t) => !t.provider_id && (!f.area || String(t.area_id || 0) === f.area)).length : 0;
  const prov = f.provider && f.provider !== 'none' ? S.providers.find((p) => String(p.id) === f.provider) : null;

  const chips = `<div class="chips">
    <button class="chip ${!f.area ? 'on' : ''}" data-area="">Todas<span class="n">${byProv.length}</span></button>
    ${S.areas.filter((a) => a.active || counts[a.id]).map((a) =>
      `<button class="chip ${f.area === String(a.id) ? 'on' : ''}" data-area="${a.id}">${esc(a.name)}<span class="n">${counts[a.id] || 0}</span></button>`).join('')}
    ${counts['0'] ? `<button class="chip ${f.area === '0' ? 'on' : ''}" data-area="0">Sin área<span class="n">${counts['0']}</span></button>` : ''}
    ${f.view !== 'mine' ? `<button class="chip ${prov ? 'on' : ''}" data-prov>${ic('user')}${prov ? esc(prov.name) : 'Responsable'}${ic('down')}</button>` : ''}
    ${isAdmin() ? `<a class="chip dashed" href="#/areas">${ic('edit')}Áreas</a>` : ''}
  </div>`;

  let body;
  if (!shown.length) {
    const msgs = {
      open: ['Todo en orden', 'No hay nada pendiente aquí.'],
      mine: ['Nada asignado a ti', 'Revisa la bandeja para tomar algo.'],
      asked: ['No has pedido nada', 'Cuando reportes algo, aquí ves en qué va.'],
      done: ['Aún no hay tareas terminadas', ''],
    };
    const [h, p] = q || f.area || f.provider ? ['Sin resultados', 'Prueba con otro filtro.'] : msgs[f.view];
    body = `<div class="empty"><div class="mark">${ic('owl')}</div><h3>${h}</h3><p>${p}</p>
      ${f.view === 'open' && !q ? `<a class="b accent" href="#/nueva">${ic('plus')}Reportar algo</a>` : ''}</div>`;
  } else if ((f.view === 'open' || f.view === 'mine') && !f.area) {
    const groups = {};
    shown.forEach((t) => (groups[t.area_id || 0] ||= []).push(t));
    body = [...S.areas.map((a) => a.id), 0].filter((id) => groups[id]).map((id) =>
      `<div class="sec"><h2>${esc(id ? areaName(id) : 'Sin área')}</h2><span class="n">${groups[id].length}</span></div>
       ${groups[id].map((t) => taskCard(t, { showArea: false })).join('')}`).join('');
  } else {
    body = `<div style="height:6px"></div>` + shown.map((t) => taskCard(t)).join('');
  }

  const views = [['open', 'Abiertas'], ...(me ? [['mine', 'Mías']] : []), ['asked', 'Pedí'], ['done', 'Hechas']];
  render(rootHeader(null, `
      <button class="ib" data-search aria-label="Buscar">${ic('search')}</button>
      <button class="ib" data-refresh aria-label="Actualizar">${ic('refresh')}</button>`) + `<div class="wrap">
    <div class="seg" role="tablist">${views.map(([v, l]) => `<button role="tab" data-view="${v}" class="${f.view === v ? 'on' : ''}">${l}</button>`).join('')}</div>
    ${TL.searching || f.q ? `<div class="searchbox">${ic('search')}<input type="search" id="q" placeholder="Buscar tarea, equipo, persona" value="${esc(f.q)}"><button class="ib" data-clearq aria-label="Cerrar búsqueda">${ic('x')}</button></div>` : ''}
    ${f.view === 'open' && (inboxN || f.provider === 'none') ? `<button class="inbox ${f.provider === 'none' ? 'on' : ''}" data-inbox>
      <span class="cnt">${inboxN}</span>${f.provider === 'none' ? 'Viendo solo la bandeja' : 'Sin asignar en la bandeja'}
      <span class="go">${f.provider === 'none' ? 'Ver todas' : 'Ver'}${ic('chev')}</span></button>` : ''}
    ${chips}
    ${body}
  </div>`, { tab: 'tareas', root: true, keepScroll });

  const set = (k, v) => { f[k] = v; saveFilters(f); };
  $$('[data-view]').forEach((b) => (b.onclick = () => {
    const v = b.dataset.view;
    set('view', v);
    if (v === 'mine') set('provider', '');
    const key = v === 'done' ? 'view=done' : v === 'asked' ? 'view=all&mine=1' : 'view=open';
    if (key === TL.key) drawTasks(); else viewTasks();
  }));
  $$('[data-area]').forEach((b) => (b.onclick = () => { set('area', b.dataset.area); drawTasks({ keepScroll: true }); }));
  const pb = $('[data-prov]');
  if (pb) pb.onclick = async () => {
    const opts = [{ value: '', label: 'Todos', on: !f.provider }, { value: 'none', label: 'Bandeja (sin asignar)', icon: 'inbox', on: f.provider === 'none' },
      ...activeProviders().map((p) => ({ value: String(p.id), label: provLabel(p), sub: p.specialty, icon: 'user', on: f.provider === String(p.id), group: p.kind === 'interno' ? 'Personal interno' : 'Proveedores externos' }))];
    const v = await sheet({ title: 'Filtrar por responsable', opts });
    if (v === null) return;
    set('provider', v);
    drawTasks();
  };
  const inbox = $('[data-inbox]');
  if (inbox) inbox.onclick = () => { set('provider', f.provider === 'none' ? '' : 'none'); drawTasks(); };
  $('[data-refresh]').onclick = async () => { await loadBoot().catch(() => {}); await viewTasks({ silent: true }); toast('Actualizado'); };
  $('[data-search]').onclick = () => { TL.searching = true; drawTasks({ keepScroll: true, refocus: true }); };
  const qi = $('#q');
  if (qi) {
    if (refocus) { qi.focus(); const n = qi.value.length; qi.setSelectionRange(n, n); }
    let tmr;
    qi.oninput = (e) => { clearTimeout(tmr); tmr = setTimeout(() => { set('q', e.target.value); drawTasks({ keepScroll: true, refocus: true }); }, 280); };
    $('[data-clearq]').onclick = () => { TL.searching = false; set('q', ''); drawTasks(); };
  }
}

// ---------- task form ----------
function providerOptions(selected, emptyLabel) {
  const avail = S.providers.filter((p) => p.active || p.id === Number(selected));
  const opt = (p) => `<option value="${p.id}" ${Number(selected) === p.id ? 'selected' : ''}>${esc(provLabel(p))}</option>`;
  const ints = avail.filter((p) => p.kind === 'interno');
  const exts = avail.filter((p) => p.kind === 'externo');
  return `<option value="">${esc(emptyLabel)}</option>
    ${ints.length ? `<optgroup label="Personal interno">${ints.map(opt).join('')}</optgroup>` : ''}
    ${exts.length ? `<optgroup label="Proveedores externos">${exts.map(opt).join('')}</optgroup>` : ''}`;
}
function equipmentOptions(areaId, selected) {
  const list = S.equipment.filter((e) => (e.active || e.id === Number(selected)) && (!areaId || e.area_id === Number(areaId) || e.id === Number(selected)));
  return '<option value="">Ninguno</option>' + list.map((e) => `<option value="${e.id}" ${Number(selected) === e.id ? 'selected' : ''}>${esc(e.name)}</option>`).join('');
}

async function viewTaskForm({ id = null, query = {} } = {}) {
  const service = query.servicio === '1';
  let t = {
    title: '', description: '', priority: 3, area_id: query.area ? Number(query.area) : null,
    equipment_id: query.equipment ? Number(query.equipment) : null, provider_id: null, cost: '',
  };
  let eqName = '';
  if (t.equipment_id) {
    const eq = S.equipment.find((e) => e.id === t.equipment_id);
    if (eq) { t.area_id ||= eq.area_id; eqName = eq.name; }
    if (service) {
      try { t.provider_id = (await api('GET', '/equipment/' + t.equipment_id)).equipment.provider_id; } catch { /* */ }
    }
  }
  if (id) {
    loading({});
    try { t = (await api('GET', '/tasks/' + id)).task; } catch (e) { return errorView(e.message); }
  }
  const title = id ? 'Editar tarea' : service ? 'Registrar servicio' : 'Reportar';
  const pending = [];
  const showMore = !!id || service || !!t.equipment_id;
  const saveLabel = id ? 'Guardar cambios' : service ? 'Guardar servicio' : 'Enviar a mantenimiento';

  render(subHeader(title, '', { close: !id }) + `<div class="wrap">
    ${service && eqName ? `<div class="group"><div class="cell"><span class="ic">${ic('wrench')}</span><div class="lbl"><div class="t">${esc(eqName)}</div><div class="s">${esc(areaName(t.area_id))}</div></div></div></div>` : ''}
    <div class="field"><label class="flabel" for="f-title">${service ? '¿Qué se hizo?' : '¿Qué pasa?'}</label>
      <input type="text" class="big" id="f-title" maxlength="200" value="${esc(id ? t.title : '')}" placeholder="${service ? 'Ej. Limpieza y recarga de gas' : 'Ej. Fuga en el baño de mujeres'}" autocomplete="off"></div>
    ${service && eqName ? '' : `<div class="field"><span class="flabel">Área</span>
      <div class="chipwrap" id="f-area">${S.areas.filter((a) => a.active || a.id === t.area_id).map((a) =>
        `<button type="button" class="chip ${t.area_id === a.id ? 'on' : ''}" data-id="${a.id}">${esc(a.name)}</button>`).join('')}</div></div>`}
    ${service ? '' : `<div class="field"><span class="flabel">Prioridad</span>
      <div class="prio" id="f-prio">${[1, 2, 3, 4].map((p) => `<button type="button" style="--pc:${PRIO[p][1]}" class="${t.priority === p ? 'on' : ''}" data-p="${p}">${PRIO[p][0]}</button>`).join('')}</div></div>`}
    ${id ? '' : `<div class="field"><span class="flabel">Fotos</span><div class="strip" id="f-photos"><label class="add" for="f-file">${ic('camera')}Agregar</label></div>
      <input type="file" id="f-file" accept="image/*" multiple hidden></div>`}
    ${showMore ? '' : `<button type="button" class="more" id="f-more">Más detalles${ic('down')}</button>`}
    <div id="f-extra" class="${showMore ? '' : 'hidden'}">
      <div class="field"><label class="flabel" for="f-desc">${service ? 'Notas del servicio' : 'Detalles'}</label>
        <textarea id="f-desc" maxlength="4000" placeholder="${service ? 'Qué se revisó, piezas cambiadas, recomendaciones' : 'Dónde exactamente, desde cuándo, qué se intentó'}">${esc(t.description || '')}</textarea></div>
      ${service && eqName ? `<input type="hidden" id="f-equip" value="${t.equipment_id}">` : `<div class="field"><label class="flabel" for="f-equip">Equipo</label><select id="f-equip">${equipmentOptions(t.area_id, t.equipment_id)}</select></div>`}
      ${id ? '' : `<div class="field"><label class="flabel" for="f-prov">${service ? '¿Quién lo hizo?' : 'Asignar a'}</label>
        <select id="f-prov">${providerOptions(t.provider_id, service ? 'Seleccionar' : 'Bandeja (mantenimiento decide)')}</select></div>`}
      ${service ? `<div class="row2">
          <div class="field"><label class="flabel" for="f-date">Fecha</label><input type="date" id="f-date" value="${todayStr()}" max="${todayStr()}"></div>
          <div class="field"><label class="flabel" for="f-cost">Costo</label><input type="number" id="f-cost" inputmode="decimal" min="0" step="0.01" placeholder="$"></div></div>`
        : id ? `<div class="field"><label class="flabel" for="f-cost">Costo</label><input type="number" id="f-cost" inputmode="decimal" min="0" step="0.01" value="${t.cost ?? ''}" placeholder="$"></div>`
          : `<div class="field"><label class="flabel" for="f-due">Para cuándo</label><input type="date" id="f-due" min="${todayStr()}"></div>`}
    </div>
  </div>`, { bar: `<button class="b block" id="f-save">${ic(id ? 'check' : 'send')}${saveLabel}</button>` });

  let areaId = t.area_id;
  let prio = t.priority;
  $$('#f-area .chip').forEach((b) => (b.onclick = () => {
    const nid = Number(b.dataset.id);
    areaId = areaId === nid ? null : nid;
    $$('#f-area .chip').forEach((x) => x.classList.toggle('on', Number(x.dataset.id) === areaId));
    const sel = $('select#f-equip');
    if (sel) sel.innerHTML = equipmentOptions(areaId, sel.value);
  }));
  $$('#f-prio button').forEach((b) => (b.onclick = () => {
    prio = Number(b.dataset.p);
    $$('#f-prio button').forEach((x) => x.classList.toggle('on', x === b));
  }));
  const more = $('#f-more');
  if (more) more.onclick = () => { $('#f-extra').classList.toggle('hidden'); more.classList.toggle('open'); };
  const eqSel = $('select#f-equip');
  if (eqSel) eqSel.onchange = () => {
    const eq = S.equipment.find((x) => x.id === Number(eqSel.value));
    if (eq && eq.area_id && !areaId) {
      areaId = eq.area_id;
      $$('#f-area .chip').forEach((x) => x.classList.toggle('on', Number(x.dataset.id) === areaId));
    }
  };
  const fileInput = $('#f-file');
  if (fileInput) fileInput.onchange = () => {
    for (const file of fileInput.files) {
      pending.push(file);
      const d = document.createElement('div');
      d.className = 'ph';
      d.innerHTML = `<img src="${URL.createObjectURL(file)}" alt=""><button class="x" type="button" aria-label="Quitar foto">${ic('x')}</button>`;
      $('.x', d).onclick = () => { pending.splice(pending.indexOf(file), 1); d.remove(); };
      $('#f-photos').appendChild(d);
    }
    fileInput.value = '';
  };

  $('#f-save').onclick = async () => {
    const btn = $('#f-save');
    const payload = {
      title: $('#f-title').value,
      description: $('#f-desc').value,
      area_id: areaId,
      equipment_id: $('#f-equip').value || null,
    };
    if (service && !payload.title.trim()) payload.title = 'Servicio de mantenimiento';
    if (!payload.title.trim()) { toast('Escribe qué pasa', true); return $('#f-title').focus(); }
    if (!id && !service && !areaId) return toast('Elige el área', true);
    if (service && !payload.equipment_id && !areaId) return toast('Elige el equipo o el área', true);
    if (!service) payload.priority = prio;
    const idle = btn.innerHTML;
    btn.disabled = true;
    btn.textContent = 'Guardando…';
    try {
      if (id) {
        payload.cost = $('#f-cost').value;
        await api('PATCH', '/tasks/' + id, payload);
        toast('Cambios guardados');
        return location.replace('#/t/' + id);
      }
      payload.provider_id = $('#f-prov').value || null;
      if (service) {
        Object.assign(payload, { kind: 'servicio', status: 'hecha', priority: 3, completed_date: $('#f-date').value || todayStr(), cost: $('#f-cost').value });
      } else {
        payload.due_date = $('#f-due').value || null;
      }
      const r = await api('POST', '/tasks', payload);
      for (let i = 0; i < pending.length; i++) {
        btn.textContent = `Subiendo foto ${i + 1} de ${pending.length}…`;
        try { await uploadPhoto(`/tasks/${r.task.id}/photos`, pending[i]); } catch (e) { toast(e.message, true); }
      }
      toast(service ? 'Servicio guardado' : 'Enviado a mantenimiento');
      location.replace(service && payload.equipment_id ? '#/e/' + payload.equipment_id : '#/t/' + r.task.id);
    } catch (e) {
      toast(e.message, true);
      btn.disabled = false;
      btn.innerHTML = idle;
    }
  };
  if (!id && !service) setTimeout(() => $('#f-title') && $('#f-title').focus(), 80);
}

// ---------- task detail ----------
async function viewTask(id, keep = false) {
  if (!keep) loading({});
  let d;
  try { d = await api('GET', '/tasks/' + id); } catch (e) { return errorView(e.message); }
  const t = d.task;
  const open = OPEN.includes(t.status);
  const late = open && t.due_date && t.due_date < todayStr();
  const prov = S.providers.find((p) => p.id === t.provider_id);
  const me = myProv();
  const [plabel, pcolor] = PRIO[t.priority];

  let primary;
  if (open && !t.provider_id && me) primary = { act: 'take', label: 'Tomar tarea', icon: 'user', cls: '' };
  else if (t.status === 'pendiente' || t.status === 'en_espera') primary = { act: 'start', label: 'Empezar', icon: 'play', cls: '' };
  else if (t.status === 'en_proceso') primary = { act: 'finish', label: 'Terminar', icon: 'check', cls: '' };
  else primary = { act: 'reopen', label: 'Reabrir', icon: 'undo', cls: 'tonal' };

  render(subHeader(`#${t.id}`, `<button class="ib" data-menu aria-label="Opciones">${ic('more')}</button>`) + `<div class="wrap">
    <div class="hero">
      <div class="meta" style="display:flex;gap:12px;align-items:center;color:var(--muted);font-size:14px">
        <span class="pr" style="--pc:${pcolor}">${plabel}</span><span>${esc(t.area_name || 'Sin área')}</span></div>
      <h2>${esc(t.title)}</h2>
      <div class="by">Pidió <b>${esc(t.created_by_name || '—')}</b>, ${fmtDateTime(t.created_at)}</div>
      ${t.description ? `<div class="desc">${esc(t.description)}</div>` : ''}
    </div>
    <div id="d-photos">${photoStrip(d.photos, 'd-file')}</div>
    <div class="statusbar" role="radiogroup" aria-label="Estado">${['pendiente', 'en_proceso', 'en_espera', 'hecha'].map((s) =>
      `<button role="radio" aria-checked="${t.status === s}" class="st-${s} ${t.status === s ? 'on' : ''}" data-s="${s}">${STATUS[s]}</button>`).join('')}</div>
    ${t.status === 'cancelada' ? `<p class="small" style="margin:-6px 4px 12px">Cancelada. Elige un estado para reabrirla.</p>` : ''}
    <div class="group">
      <button class="cell" data-pick="prov"><span class="ic">${ic(t.provider_id ? 'user' : 'inbox')}</span><span class="lbl"><span class="t">Responsable</span></span>
        <span class="val ${t.provider_id ? 'strong' : ''}">${t.provider_id ? esc(prov ? provLabel(prov) : t.provider_name) : 'Bandeja'}</span>${ic('chev').replace('<svg', '<svg class="chev"')}</button>
      <label class="cell"><span class="ic">${ic('cal')}</span><span class="lbl"><span class="t">Para cuándo</span>${late ? '<div class="s" style="color:var(--red);font-weight:600">Vencida</div>' : ''}</span>
        <input type="date" id="d-due" value="${esc(t.due_date || '')}" aria-label="Fecha estimada"></label>
      <button class="cell" data-pick="prio"><span class="ic">${ic('flag')}</span><span class="lbl"><span class="t">Prioridad</span></span>
        <span class="val strong" style="color:${pcolor}">${plabel}</span>${ic('chev').replace('<svg', '<svg class="chev"')}</button>
      ${t.equipment_id ? `<a class="cell" href="#/e/${t.equipment_id}"><span class="ic">${ic('wrench')}</span><span class="lbl"><span class="t">Equipo</span></span>
        <span class="val">${esc(t.equipment_name)}</span>${ic('chev').replace('<svg', '<svg class="chev"')}</a>` : ''}
      ${t.cost ? `<div class="cell"><span class="ic">$</span><span class="lbl"><span class="t">Costo</span></span><span class="val">$${Number(t.cost).toLocaleString('es-MX')}</span></div>` : ''}
      ${t.status === 'hecha' && t.completed_at ? `<div class="cell"><span class="ic">${ic('check')}</span><span class="lbl"><span class="t">Terminada</span></span><span class="val">${fmtDateTime(t.completed_at)}</span></div>` : ''}
    </div>
    <div class="group">
      <div class="gtitle">Notas e historial</div>
      <ul class="timeline">${d.notes.map((n) => n.kind === 'sistema'
        ? `<li class="sys">${esc(n.body)}, ${fmtDateTime(n.created_at).toLowerCase()}</li>`
        : `<li><div class="who"><span><b>${esc(n.user_name || '—')}</b>, ${fmtDateTime(n.created_at).toLowerCase()}</span>
            ${(isAdmin() || n.user_id === S.user.id) ? `<button class="del" data-delnote="${n.id}">Borrar</button>` : ''}</div>
            <div class="body">${esc(n.body)}</div></li>`).join('')}</ul>
      <div class="composer"><textarea id="d-note" rows="1" placeholder="Escribe una nota" maxlength="4000"></textarea>
        <button class="ib" id="d-addnote" aria-label="Enviar nota" disabled>${ic('send')}</button></div>
    </div>
  </div>`, {
    keepScroll: keep,
    bar: `<label class="ib filled" for="d-file" aria-label="Agregar foto" style="width:48px;height:48px">${ic('camera')}</label>
          <button class="b block grow ${primary.cls}" id="d-primary">${ic(primary.icon)}${primary.label}</button>`,
  });

  const patch = async (data, msg = 'Guardado') => {
    try { await api('PATCH', '/tasks/' + id, data); toast(msg); viewTask(id, true); } catch (e) { toast(e.message, true); }
  };
  const finish = async () => {
    const note = await sheet({
      title: '¿Terminar tarea?', sub: 'Puedes dejar una nota de lo que se hizo.',
      body: '<div class="pad"><textarea id="sh-note" placeholder="Opcional"></textarea></div>',
      acts: [{ label: 'Cancelar', cls: 'plain', value: null }, { label: 'Terminar', value: (w) => ({ text: $('#sh-note', w).value.trim() }) }],
    });
    if (!note) return;
    try {
      if (note.text) await api('POST', `/tasks/${id}/notes`, { body: note.text });
      await api('PATCH', '/tasks/' + id, { status: 'hecha' });
      toast('Tarea terminada');
      viewTask(id, true);
    } catch (e) { toast(e.message, true); }
  };
  $('#d-primary').onclick = () => {
    if (primary.act === 'take') patch({ provider_id: me, status: 'en_proceso' }, 'Es tuya');
    else if (primary.act === 'start') patch({ status: 'en_proceso' }, 'En proceso');
    else if (primary.act === 'finish') finish();
    else patch({ status: 'pendiente' }, 'Reabierta');
  };
  $$('.statusbar button').forEach((b) => (b.onclick = () => {
    if (b.dataset.s === t.status) return;
    if (b.dataset.s === 'hecha') return finish();
    patch({ status: b.dataset.s }, STATUS[b.dataset.s]);
  }));
  $('[data-pick="prov"]').onclick = async () => {
    const v = await pickProvider(t.provider_id);
    if (v === null || (v || null) === t.provider_id) return;
    patch({ provider_id: v || null }, v ? 'Asignada' : 'Regresó a la bandeja');
  };
  $('[data-pick="prio"]').onclick = async () => {
    const v = await sheet({ title: 'Prioridad', opts: [1, 2, 3, 4].map((p) => ({ value: p, label: PRIO[p][0], on: p === t.priority })) });
    if (v && v !== t.priority) patch({ priority: v }, 'Prioridad: ' + PRIO[v][0]);
  };
  $('#d-due').onchange = (e) => patch({ due_date: e.target.value || null }, e.target.value ? 'Fecha guardada' : 'Fecha quitada');
  bindPhotoStrip($('#d-photos'), 'd-file', `/tasks/${id}/photos`, () => viewTask(id, true));

  const note = $('#d-note');
  const send = $('#d-addnote');
  note.oninput = () => {
    send.disabled = !note.value.trim();
    note.style.height = 'auto';
    note.style.height = Math.min(140, note.scrollHeight) + 'px';
  };
  send.onclick = async () => {
    const v = note.value.trim();
    if (!v) return;
    send.disabled = true;
    try { await api('POST', `/tasks/${id}/notes`, { body: v }); toast('Nota agregada'); viewTask(id, true); }
    catch (e) { toast(e.message, true); send.disabled = false; }
  };
  $$('[data-delnote]').forEach((b) => (b.onclick = async () => {
    if (!(await confirmSheet('¿Borrar esta nota?', '', 'Borrar nota', true))) return;
    try { await api('DELETE', '/notes/' + b.dataset.delnote); viewTask(id, true); } catch (e) { toast(e.message, true); }
  }));

  $('[data-menu]').onclick = async () => {
    const link = `${location.origin}/#/t/${t.id}`;
    const text = `*Tarea #${t.id}*: ${t.title}\nÁrea: ${t.area_name || 'Sin área'}${t.equipment_name ? '\nEquipo: ' + t.equipment_name : ''}\nPrioridad: ${plabel}${t.description ? '\n\n' + t.description : ''}\n\n${link}`;
    const opts = [{ value: 'edit', label: 'Editar', icon: 'edit' }];
    if (prov && prov.phone) opts.push({ value: 'wa-prov', label: `Enviar a ${prov.name} por WhatsApp`, icon: 'send' });
    opts.push({ value: 'wa', label: 'Compartir por WhatsApp', icon: 'share' });
    if (t.status !== 'cancelada') opts.push({ value: 'cancel', label: 'Cancelar tarea', icon: 'x' });
    if (isAdmin()) opts.push({ value: 'delete', label: 'Eliminar', icon: 'trash' });
    const v = await sheet({ opts });
    if (v === 'edit') location.hash = `#/t/${id}/editar`;
    else if (v === 'wa-prov') window.open(`https://wa.me/${waNumber(prov.phone)}?text=${encodeURIComponent(text)}`, '_blank');
    else if (v === 'wa') window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
    else if (v === 'cancel') {
      if (await confirmSheet('¿Cancelar esta tarea?', 'No se borra; queda en Hechas como cancelada.', 'Cancelar tarea', true)) patch({ status: 'cancelada' }, 'Tarea cancelada');
    } else if (v === 'delete') {
      if (!(await confirmSheet('¿Eliminar para siempre?', 'Se borran también sus fotos y notas.', 'Eliminar', true))) return;
      try { await api('DELETE', '/tasks/' + id); toast('Tarea eliminada'); location.replace('#/'); } catch (e) { toast(e.message, true); }
    }
  };
}

// ---------- equipment ----------
function serviceInfo(e) {
  const last = e.last_service ? localYmd(e.last_service) : null;
  let next = null, left = null;
  if (last && e.service_interval_days) { next = addDays(last, e.service_interval_days); left = daysBetween(todayStr(), next); }
  return { last, next, left };
}
function duePill(e) {
  const { last, left } = serviceInfo(e);
  if (!e.service_interval_days) return '';
  if (!last) return '<span class="pill st-en_espera">Sin registro</span>';
  if (left < 0) return `<span class="pill st-pendiente">Vencido ${-left} d</span>`;
  if (left <= 14) return `<span class="pill st-en_espera">En ${left} d</span>`;
  return `<span class="pill st-hecha">En ${left} d</span>`;
}

const EQ = { list: [], searching: false };
async function viewEquipmentList() {
  loading({ tab: 'equipos', root: true });
  try { EQ.list = (await api('GET', '/equipment')).equipment; } catch (e) { return errorView(e.message, true); }
  drawEquipmentList();
}
function drawEquipmentList(refocus = false) {
  const qv = store('mt_eq_q') || '';
  const q = qv.toLowerCase();
  const shown = EQ.list.filter((e) => !q || [e.name, e.location, e.brand_model, e.area_name].join(' ').toLowerCase().includes(q));
  const groups = {};
  shown.forEach((e) => (groups[e.area_id || 0] ||= []).push(e));
  const due = EQ.list.filter((e) => { const { left, last } = serviceInfo(e); return e.service_interval_days && (!last || left < 0); }).length;
  const body = shown.length
    ? [...S.areas.map((a) => a.id), 0].filter((id) => groups[id]).map((id) => `<div class="sec"><h2>${esc(id ? areaName(id) : 'Sin área')}</h2><span class="n">${groups[id].length}</span></div>
      <div class="group">${groups[id].map((e) => {
        const { last } = serviceInfo(e);
        return `<a class="cell" href="#/e/${e.id}"><span class="ic">${ic('wrench')}</span>
          <span class="lbl"><div class="t">${esc(e.name)}</div><div class="s">${last ? 'Último servicio ' + fmtDay(last) : 'Sin servicios registrados'}${e.open_count ? `, ${e.open_count} abierta${e.open_count > 1 ? 's' : ''}` : ''}</div></span>
          ${duePill(e)}${ic('chev').replace('<svg', '<svg class="chev"')}</a>`;
      }).join('')}</div>`).join('')
    : `<div class="empty"><div class="mark">${ic('owl')}</div>${EQ.list.length ? '<h3>Sin resultados</h3><p>Prueba con otra palabra.</p>'
      : '<h3>Registra tus equipos</h3><p>Chillers, aires, bombas, cámaras de frío. Así queda el historial de cada servicio.</p>'}
      <a class="b" href="#/e/nuevo">${ic('plus')}Agregar equipo</a></div>`;

  render(rootHeader('Equipos', `<button class="ib" data-search aria-label="Buscar">${ic('search')}</button>
      <a class="b tonal sm" href="#/e/nuevo">${ic('plus')}Nuevo</a>`) + `<div class="wrap">
    ${EQ.searching || qv ? `<div class="searchbox" style="margin-top:0">${ic('search')}<input type="search" id="eq-q" placeholder="Buscar equipo" value="${esc(qv)}"><button class="ib" data-clearq aria-label="Cerrar búsqueda">${ic('x')}</button></div>` : ''}
    ${due ? `<div class="inbox" style="background:var(--red-soft);color:var(--red)"><span class="cnt" style="background:var(--red);color:#fff">${due}</span>Con servicio vencido o sin registro</div>` : ''}
    ${body}
  </div>`, { tab: 'equipos', root: true, keepScroll: refocus });
  $('[data-search]').onclick = () => { EQ.searching = true; drawEquipmentList(true); };
  const qi = $('#eq-q');
  if (qi) {
    if (refocus) { qi.focus(); const n = qi.value.length; qi.setSelectionRange(n, n); }
    let tmr;
    qi.oninput = (e) => { clearTimeout(tmr); tmr = setTimeout(() => { store('mt_eq_q', e.target.value); drawEquipmentList(true); }, 280); };
    $('[data-clearq]').onclick = () => { EQ.searching = false; store('mt_eq_q', ''); drawEquipmentList(); };
  }
}

async function viewEquipment(id, keep = false) {
  if (!keep) loading({});
  let d;
  try { d = await api('GET', '/equipment/' + id); } catch (e) { return errorView(e.message); }
  const e = d.equipment;
  const { last, next } = serviceInfo(e);
  const openT = d.tasks.filter((t) => OPEN.includes(t.status));
  const doneT = d.tasks.filter((t) => !OPEN.includes(t.status));
  const row = (icon, label, val, href) => val ? `<${href ? `a href="${href}"` : 'div'} class="cell"><span class="ic">${ic(icon)}</span><span class="lbl"><span class="t">${label}</span></span><span class="val">${val}</span>${href ? ic('chev').replace('<svg', '<svg class="chev"') : ''}</${href ? 'a' : 'div'}>` : '';
  render(subHeader('Equipo', `<a class="ib" href="#/e/${id}/editar" aria-label="Editar">${ic('edit')}</a>`) + `<div class="wrap">
    <div class="hero">
      <div style="display:flex;gap:8px;align-items:center;color:var(--muted);font-size:14px">${esc(e.area_name || 'Sin área')}${e.location ? ', ' + esc(e.location) : ''} ${duePill(e)}</div>
      <h2>${esc(e.name)}</h2>
      ${!e.active ? '<div class="by" style="color:var(--red)">Dado de baja</div>' : ''}
    </div>
    <div class="group">
      ${row('cal', 'Último servicio', last ? fmtDay(last) : '—')}
      ${e.service_interval_days ? row('refresh', 'Servicio cada', `${e.service_interval_days} días`) + row('flag', 'Próximo', next ? fmtDay(next) : '—') : ''}
      ${row('user', 'Proveedor', e.provider_name ? esc(e.provider_name) : '', e.provider_id ? `#/r/${e.provider_id}` : '')}
      ${row('tasks', 'Marca y modelo', esc(e.brand_model || ''))}
      ${row('tasks', 'Número de serie', esc(e.serial || ''))}
    </div>
    ${e.notes ? `<div class="group"><div class="cell"><div class="lbl" style="white-space:pre-wrap">${esc(e.notes)}</div></div></div>` : ''}
    <div class="sec"><h2>Fotos</h2></div>
    <div id="e-photos">${photoStrip(d.photos, 'e-file')}</div>
    ${openT.length ? `<div class="sec"><h2>Abiertas</h2><span class="n">${openT.length}</span></div>${openT.map((t) => taskCard(t, { showArea: false })).join('')}` : ''}
    <div class="sec"><h2>Historial de servicio</h2><span class="n">${doneT.length}</span></div>
    ${doneT.length ? doneT.map((t) => taskCard(t, { showArea: false })).join('') : '<p class="small" style="margin:0 4px">Aún no hay servicios registrados.</p>'}
  </div>`, {
    keepScroll: keep,
    bar: `<a class="b plain grow" href="#/nueva?equipment=${id}">${ic('alert')}Reportar falla</a>
          <a class="b grow" href="#/nueva?servicio=1&equipment=${id}">${ic('check')}Registrar servicio</a>`,
  });
  bindPhotoStrip($('#e-photos'), 'e-file', `/equipment/${id}/photos`, () => viewEquipment(id, true));
}

async function viewEquipmentForm(id) {
  let e = { name: '', area_id: null, location: '', brand_model: '', serial: '', provider_id: null, service_interval_days: '', notes: '', active: 1 };
  if (id) {
    loading({});
    try { e = (await api('GET', '/equipment/' + id)).equipment; } catch (err) { return errorView(err.message); }
  }
  render(subHeader(id ? 'Editar equipo' : 'Nuevo equipo', '', { close: !id }) + `<div class="wrap">
    <div class="field"><label class="flabel" for="q-name">Nombre</label><input type="text" class="big" id="q-name" value="${esc(e.name)}" placeholder="Ej. Chiller de la cava"></div>
    <div class="field"><label class="flabel" for="q-area">Área</label><select id="q-area"><option value="">Sin área</option>
      ${S.areas.filter((a) => a.active || a.id === e.area_id).map((a) => `<option value="${a.id}" ${a.id === e.area_id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></div>
    <div class="field"><label class="flabel" for="q-int">Servicio preventivo cada</label>
      <div class="chipwrap" style="margin-bottom:8px">${[[30, 'Mes'], [90, '3 meses'], [180, '6 meses'], [365, 'Año']].map(([d, l]) =>
        `<button type="button" class="chip ${Number(e.service_interval_days) === d ? 'on' : ''}" data-int="${d}">${l}</button>`).join('')}</div>
      <input type="number" id="q-int" inputmode="numeric" min="0" value="${e.service_interval_days ?? ''}" placeholder="Días (vacío = sin recordatorio)"></div>
    <div class="field"><label class="flabel" for="q-prov">Proveedor de servicio</label><select id="q-prov">${providerOptions(e.provider_id, 'Ninguno')}</select></div>
    <div class="field"><label class="flabel" for="q-loc">Ubicación exacta</label><input type="text" id="q-loc" value="${esc(e.location || '')}" placeholder="Ej. Azotea de la cocina"></div>
    <div class="row2">
      <div class="field"><label class="flabel" for="q-brand">Marca y modelo</label><input type="text" id="q-brand" value="${esc(e.brand_model || '')}"></div>
      <div class="field"><label class="flabel" for="q-serial">Número de serie</label><input type="text" id="q-serial" value="${esc(e.serial || '')}"></div>
    </div>
    <div class="field"><label class="flabel" for="q-notes">Notas</label><textarea id="q-notes">${esc(e.notes || '')}</textarea></div>
    ${id && isAdmin() && e.active ? `<div class="group"><button class="cell danger" id="q-del"><span class="ic">${ic('trash')}</span><span class="lbl"><span class="t">Dar de baja</span><div class="s">Su historial se conserva</div></span></button></div>` : ''}
  </div>`, { bar: `<button class="b block" id="q-save">${ic('check')}${id ? 'Guardar cambios' : 'Agregar equipo'}</button>` });
  $$('[data-int]').forEach((b) => (b.onclick = () => {
    $('#q-int').value = b.dataset.int;
    $$('[data-int]').forEach((x) => x.classList.toggle('on', x === b));
  }));
  $('#q-int').oninput = () => $$('[data-int]').forEach((x) => x.classList.toggle('on', x.dataset.int === $('#q-int').value));
  $('#q-save').onclick = async () => {
    const data = {
      name: $('#q-name').value, area_id: $('#q-area').value || null, location: $('#q-loc').value,
      brand_model: $('#q-brand').value, serial: $('#q-serial').value, provider_id: $('#q-prov').value || null,
      service_interval_days: $('#q-int').value || null, notes: $('#q-notes').value,
    };
    if (!data.name.trim()) { toast('Escribe el nombre', true); return $('#q-name').focus(); }
    $('#q-save').disabled = true;
    try {
      let newId = id;
      if (id) await api('PATCH', '/equipment/' + id, data);
      else newId = (await api('POST', '/equipment', data)).id;
      await loadBoot();
      toast(id ? 'Cambios guardados' : 'Equipo agregado');
      location.replace('#/e/' + newId);
    } catch (err) { toast(err.message, true); $('#q-save').disabled = false; }
  };
  const del = $('#q-del');
  if (del) del.onclick = async () => {
    if (!(await confirmSheet('¿Dar de baja este equipo?', 'Deja de aparecer en la lista; su historial se conserva.', 'Dar de baja', true))) return;
    try { await api('DELETE', '/equipment/' + id); await loadBoot(); toast('Equipo dado de baja'); location.replace('#/equipos'); }
    catch (err) { toast(err.message, true); }
  };
}

// ---------- providers ----------
async function viewProviders() {
  loading({ tab: 'responsables', root: true });
  let list;
  try { list = (await api('GET', '/providers')).providers; } catch (e) { return errorView(e.message, true); }
  const cell = (p) => `<a class="cell" href="#/r/${p.id}"><span class="ic">${ic('user')}</span>
    <span class="lbl"><div class="t">${esc(p.name)}</div><div class="s">${esc([p.company, p.specialty].filter(Boolean).join(', ') || (p.kind === 'interno' ? 'Personal interno' : 'Proveedor'))}${p.late_count ? `<b style="color:var(--red)">, ${p.late_count} vencida${p.late_count > 1 ? 's' : ''}</b>` : ''}</div></span>
    <span class="badge ${p.open_count ? (p.late_count ? 'red' : '') : 'zero'}" aria-label="${p.open_count} abiertas">${p.open_count}</span></a>`;
  const ints = list.filter((p) => p.kind === 'interno');
  const exts = list.filter((p) => p.kind === 'externo');
  const body = list.length ? `
    <p class="small" style="margin:0 4px 4px">El número es cuántas tareas abiertas tiene cada quien.</p>
    ${ints.length ? `<div class="sec"><h2>Personal interno</h2><span class="n">${ints.length}</span></div><div class="group">${ints.map(cell).join('')}</div>` : ''}
    ${exts.length ? `<div class="sec"><h2>Proveedores externos</h2><span class="n">${exts.length}</span></div><div class="group">${exts.map(cell).join('')}</div>` : ''}`
    : `<div class="empty"><div class="mark">${ic('owl')}</div><h3>¿Quién hace el trabajo?</h3><p>Agrega a Adrián, a los carpinteros y a los proveedores externos para poder asignarles tareas.</p>
      <a class="b" href="#/r/nuevo">${ic('plus')}Agregar responsable</a></div>`;
  render(rootHeader('Responsables', `<a class="b tonal sm" href="#/r/nuevo">${ic('plus')}Nuevo</a>`) + `<div class="wrap">${body}</div>`, { tab: 'responsables', root: true });
}

async function viewProvider(id) {
  loading({});
  let tasks;
  try { await loadBoot(); tasks = (await api('GET', `/tasks?view=all&provider=${id}`)).tasks; } catch (e) { return errorView(e.message); }
  const p = S.providers.find((x) => x.id === Number(id));
  if (!p) return errorView('Este responsable ya no existe.');
  const openT = tasks.filter((t) => OPEN.includes(t.status));
  const doneT = tasks.filter((t) => !OPEN.includes(t.status)).sort((a, b) => (b.completed_at || b.updated_at).localeCompare(a.completed_at || a.updated_at)).slice(0, 30);
  render(subHeader(p.kind === 'interno' ? 'Personal' : 'Proveedor', `<a class="ib" href="#/r/${id}/editar" aria-label="Editar">${ic('edit')}</a>`) + `<div class="wrap">
    <div class="hero">
      <h2>${esc(p.name)}</h2>
      <div class="by">${esc([p.company, p.specialty].filter(Boolean).join(', ') || (p.kind === 'interno' ? 'Personal interno' : 'Proveedor externo'))}</div>
      ${p.notes ? `<div class="desc">${esc(p.notes)}</div>` : ''}
    </div>
    ${p.phone ? `<div class="row2" style="margin-bottom:6px">
      <a class="b plain" href="tel:${esc(p.phone.replace(/[^\d+]/g, ''))}">${ic('phone')}Llamar</a>
      <a class="b wa" target="_blank" rel="noopener" href="https://wa.me/${waNumber(p.phone)}">${ic('chat')}WhatsApp</a></div>` : ''}
    <div class="sec"><h2>Abiertas</h2><span class="n">${openT.length}</span></div>
    ${openT.map((t) => taskCard(t)).join('') || '<p class="small" style="margin:0 4px">Nada pendiente.</p>'}
    <div class="sec"><h2>Terminadas recientes</h2><span class="n">${doneT.length}</span></div>
    ${doneT.map((t) => taskCard(t)).join('') || '<p class="small" style="margin:0 4px">Todavía nada.</p>'}
  </div>`, {});
}

async function viewProviderForm(id) {
  let p = { name: '', kind: 'externo', company: '', specialty: '', phone: '', notes: '' };
  if (id) { await loadBoot(); p = S.providers.find((x) => x.id === Number(id)) || p; }
  render(subHeader(id ? 'Editar responsable' : 'Nuevo responsable', '', { close: !id }) + `<div class="wrap">
    <div class="field"><div class="seg">
      <button type="button" data-k="interno" class="${p.kind === 'interno' ? 'on' : ''}">Personal interno</button>
      <button type="button" data-k="externo" class="${p.kind === 'externo' ? 'on' : ''}">Proveedor externo</button></div></div>
    <div class="field"><label class="flabel" for="p-name">Nombre</label><input type="text" class="big" id="p-name" value="${esc(p.name)}" placeholder="Ej. Juan Hernández"></div>
    <div class="field" id="p-company-f" ${p.kind === 'interno' ? 'style="display:none"' : ''}><label class="flabel" for="p-company">Empresa</label><input type="text" id="p-company" value="${esc(p.company || '')}" placeholder="Ej. Plomería Hernández"></div>
    <div class="field"><label class="flabel" for="p-spec">Especialidad</label><input type="text" id="p-spec" value="${esc(p.specialty || '')}" placeholder="Plomería, carpintería, aires, electricidad"></div>
    <div class="field"><label class="flabel" for="p-phone">WhatsApp</label><input type="tel" id="p-phone" value="${esc(p.phone || '')}" placeholder="10 dígitos"></div>
    <div class="field"><label class="flabel" for="p-notes">Notas</label><textarea id="p-notes" placeholder="Horarios, cómo cobra, etc.">${esc(p.notes || '')}</textarea></div>
    ${id && isAdmin() ? `<div class="group"><button class="cell danger" id="p-del"><span class="ic">${ic('trash')}</span><span class="lbl"><span class="t">Quitar de la lista</span><div class="s">Sus tareas e historial se conservan</div></span></button></div>` : ''}
  </div>`, { bar: `<button class="b block" id="p-save">${ic('check')}${id ? 'Guardar cambios' : 'Agregar'}</button>` });
  let kind = p.kind;
  $$('[data-k]').forEach((b) => (b.onclick = () => {
    kind = b.dataset.k;
    $$('[data-k]').forEach((x) => x.classList.toggle('on', x === b));
    $('#p-company-f').style.display = kind === 'interno' ? 'none' : '';
  }));
  $('#p-save').onclick = async () => {
    const data = { name: $('#p-name').value, kind, company: kind === 'interno' ? '' : $('#p-company').value, specialty: $('#p-spec').value, phone: $('#p-phone').value, notes: $('#p-notes').value };
    if (!data.name.trim()) { toast('Escribe el nombre', true); return $('#p-name').focus(); }
    $('#p-save').disabled = true;
    try {
      let newId = id;
      if (id) await api('PATCH', '/providers/' + id, data);
      else newId = (await api('POST', '/providers', data)).id;
      await loadBoot();
      toast(id ? 'Cambios guardados' : 'Responsable agregado');
      location.replace('#/r/' + newId);
    } catch (e) { toast(e.message, true); $('#p-save').disabled = false; }
  };
  const del = $('#p-del');
  if (del) del.onclick = async () => {
    if (!(await confirmSheet('¿Quitar de la lista?', 'Ya no se le podrán asignar tareas. Su historial se conserva.', 'Quitar', true))) return;
    try { await api('DELETE', '/providers/' + id); await loadBoot(); toast('Quitado de la lista'); location.replace('#/responsables'); }
    catch (e) { toast(e.message, true); }
  };
}

// ---------- más ----------
async function viewMore() {
  const me = S.providers.find((p) => p.id === myProv());
  const chev = ic('chev').replace('<svg', '<svg class="chev"');
  render(rootHeader('Más') + `<div class="wrap">
    <div class="group">
      <div class="cell"><span class="ic">${ic('user')}</span><span class="lbl"><div class="t">${esc(S.user.name)}</div>
        <div class="s">${isAdmin() ? 'Administrador' : 'Usuario'}${me ? `, recibe tareas como ${esc(me.name)}` : ''}</div></span></div>
      <button class="cell" id="m-pin"><span class="ic">${ic('lock')}</span><span class="lbl"><span class="t">Cambiar mi PIN</span></span>${chev}</button>
    </div>
    ${isAdmin() ? `<div class="group">
      <a class="cell" href="#/usuarios"><span class="ic">${ic('users')}</span><span class="lbl"><div class="t">Usuarios</div><div class="s">Quién puede entrar a la app</div></span>${chev}</a>
      <a class="cell" href="#/areas"><span class="ic">${ic('map')}</span><span class="lbl"><div class="t">Áreas</div><div class="s">Renombrar, ordenar, agregar</div></span>${chev}</a>
    </div>` : ''}
    <div class="group">
      <button class="cell" id="m-share"><span class="ic">${ic('share')}</span><span class="lbl"><span class="t">Compartir la app</span></span>${chev}</button>
      <button class="cell danger" id="m-out"><span class="ic">${ic('logout')}</span><span class="lbl"><span class="t">Cerrar sesión</span></span></button>
    </div>
    <p class="small center">En el teléfono, usa “Agregar a pantalla de inicio” para abrir Tecolote como app.</p>
  </div>`, { tab: 'mas', root: true });
  $('#m-pin').onclick = async () => {
    const v = await inputSheet('Nuevo PIN', '', 'Guardar', { type: 'password', mode: 'numeric', sub: 'De 4 a 8 dígitos.' });
    if (v === null) return;
    try { await api('POST', '/me/pin', { pin: v }); toast('PIN actualizado'); } catch (e) { toast(e.message, true); }
  };
  $('#m-out').onclick = async () => {
    if (!(await confirmSheet('¿Cerrar sesión?', 'Necesitarás tu PIN para volver a entrar.', 'Cerrar sesión', true))) return;
    await api('POST', '/logout').catch(() => {});
    S.user = null;
    history.replaceState(null, '', '#/');
    showLogin();
  };
  $('#m-share').onclick = async () => {
    const url = location.origin;
    try {
      if (navigator.share) await navigator.share({ title: 'Tecolote · Mantenimiento Dos Búhos', url });
      else { await navigator.clipboard.writeText(url); toast('Enlace copiado'); }
    } catch { /* cancelled */ }
  };
}

async function viewUsers() {
  if (!isAdmin()) return (location.hash = '#/mas');
  loading({});
  try { await loadBoot(); } catch (e) { return errorView(e.message); }
  const chev = ic('chev').replace('<svg', '<svg class="chev"');
  render(subHeader('Usuarios') + `<div class="wrap">
    <div class="group">${S.users.map((u) => {
      const p = S.providers.find((x) => x.id === u.provider_id);
      return `<a class="cell" href="#/usuarios/${u.id}" style="${u.active ? '' : 'opacity:.55'}"><span class="ic">${ic('user')}</span>
        <span class="lbl"><div class="t">${esc(u.name)}</div><div class="s">${u.role === 'admin' ? 'Administrador' : 'Usuario'}${p ? `, recibe tareas como ${esc(p.name)}` : ''}${u.active ? '' : ', sin acceso'}</div></span>${chev}</a>`;
    }).join('')}</div>
  </div>`, { bar: `<a class="b block" href="#/usuarios/nuevo">${ic('plus')}Agregar usuario</a>` });
}

async function viewUserForm(id) {
  if (!isAdmin()) return (location.hash = '#/mas');
  await loadBoot();
  const u = id ? S.users.find((x) => x.id === Number(id)) : { name: '', role: 'staff', active: 1, provider_id: null };
  if (!u) return (location.hash = '#/usuarios');
  const ints = S.providers.filter((p) => p.active || p.id === u.provider_id);
  render(subHeader(id ? 'Editar usuario' : 'Nuevo usuario', '', { close: !id }) + `<div class="wrap">
    <div class="field"><label class="flabel" for="u-name">Nombre</label><input type="text" class="big" id="u-name" value="${esc(u.name)}"></div>
    <div class="field"><span class="flabel">Permisos</span><div class="seg">
      <button type="button" data-r="staff" class="${u.role !== 'admin' ? 'on' : ''}">Usuario</button>
      <button type="button" data-r="admin" class="${u.role === 'admin' ? 'on' : ''}">Administrador</button></div>
      <p class="hint">Un administrador puede borrar tareas y manejar usuarios y áreas. Dale este permiso a quien lleva mantenimiento.</p></div>
    <div class="field"><label class="flabel" for="u-prov">Recibe tareas como</label>
      <select id="u-prov"><option value="">No recibe tareas</option>${ints.map((p) => `<option value="${p.id}" ${p.id === u.provider_id ? 'selected' : ''}>${esc(provLabel(p))}</option>`).join('')}</select>
      <p class="hint">Si esta persona también hace trabajos (por ejemplo Adrián), elige su ficha de responsable. Así le aparece la pestaña “Mías” y el botón “Tomar tarea”.</p></div>
    <div class="field"><label class="flabel" for="u-pin">${id ? 'Nuevo PIN (déjalo vacío para no cambiarlo)' : 'PIN de 4 a 8 dígitos'}</label>
      <input id="u-pin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="8" autocomplete="new-password"></div>
    ${id && u.id !== S.user.id ? `<div class="group"><button class="cell ${u.active ? 'danger' : ''}" id="u-toggle"><span class="ic">${ic(u.active ? 'lock' : 'check')}</span>
      <span class="lbl"><span class="t">${u.active ? 'Quitar acceso' : 'Devolver acceso'}</span></span></button></div>` : ''}
  </div>`, { bar: `<button class="b block" id="u-save">${ic('check')}${id ? 'Guardar cambios' : 'Crear usuario'}</button>` });
  let role = u.role;
  $$('[data-r]').forEach((b) => (b.onclick = () => { role = b.dataset.r; $$('[data-r]').forEach((x) => x.classList.toggle('on', x === b)); }));
  $('#u-save').onclick = async () => {
    const data = { name: $('#u-name').value, role, provider_id: $('#u-prov').value || null };
    const pin = $('#u-pin').value;
    if (pin || !id) data.pin = pin;
    try {
      if (id) await api('PATCH', '/users/' + id, data);
      else await api('POST', '/users', data);
      await loadBoot();
      if (Number(id) === S.user.id) S.user = Object.assign(S.user, { provider_id: data.provider_id ? Number(data.provider_id) : null, name: data.name.trim() || S.user.name });
      toast(id ? 'Cambios guardados' : 'Usuario creado');
      location.replace('#/usuarios');
    } catch (e) { toast(e.message, true); }
  };
  const tg = $('#u-toggle');
  if (tg) tg.onclick = async () => {
    if (u.active && !(await confirmSheet(`¿Quitar acceso a ${u.name}?`, 'Se cierra su sesión. Sus tareas se conservan.', 'Quitar acceso', true))) return;
    try { await api('PATCH', '/users/' + id, { active: !u.active }); await loadBoot(); toast(u.active ? 'Acceso quitado' : 'Acceso devuelto'); location.replace('#/usuarios'); }
    catch (e) { toast(e.message, true); }
  };
}

async function viewAreas() {
  if (!isAdmin()) return (location.hash = '#/mas');
  await loadBoot();
  const list = S.areas;
  render(subHeader('Áreas') + `<div class="wrap">
    <p class="small" style="margin:0 4px 10px">Toca un área para renombrarla u ocultarla. Las flechas cambian el orden en toda la app.</p>
    <div class="group">${list.map((a, i) => `<div class="cell" style="${a.active ? '' : 'opacity:.5'}">
      <button class="lbl" data-edit="${a.id}" style="border:0;background:none;text-align:left;padding:6px 0">
        <div class="t">${esc(a.name)}</div>${a.active ? '' : '<div class="s">Oculta</div>'}</button>
      <button class="ib" data-up="${i}" aria-label="Subir" ${i === 0 ? 'disabled style="opacity:.25"' : ''}>${ic('up')}</button>
      <button class="ib" data-down="${i}" aria-label="Bajar" ${i === list.length - 1 ? 'disabled style="opacity:.25"' : ''}>${ic('down')}</button>
    </div>`).join('')}</div>
  </div>`, { keepScroll: true, bar: `<button class="b block" id="a-add">${ic('plus')}Agregar área</button>` });
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
    } catch (e) { toast(e.message, true); }
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
    } catch (e) { toast(e.message, true); }
  };
  $$('[data-up]').forEach((b) => (b.onclick = () => swap(Number(b.dataset.up), Number(b.dataset.up) - 1)));
  $$('[data-down]').forEach((b) => (b.onclick = () => swap(Number(b.dataset.down), Number(b.dataset.down) + 1)));
  $('#a-add').onclick = async () => {
    const name = await inputSheet('Nueva área', '', 'Agregar', { placeholder: 'Ej. Estacionamiento' });
    if (!name) return;
    try { await api('POST', '/areas', { name }); toast('Área agregada'); viewAreas(); } catch (e) { toast(e.message, true); }
  };
}

// ---------- router ----------
async function route() {
  if (!S.user) return showLogin();
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = raw.split('?');
  const query = Object.fromEntries(new URLSearchParams(qs || ''));
  const p = path.split('/').filter(Boolean);
  $('#viewer').classList.add('hidden');
  const sh = $('#sheet');
  if (!sh.classList.contains('hidden')) { sh.classList.add('hidden'); sh.innerHTML = ''; }
  try {
    if (!p.length) return await viewTasks();
    if (p[0] === 'nueva') return await viewTaskForm({ query });
    if (p[0] === 't' && p[1] && p[2] === 'editar') return await viewTaskForm({ id: p[1] });
    if (p[0] === 't' && p[1]) return await viewTask(p[1]);
    if (p[0] === 'equipos') return await viewEquipmentList();
    if (p[0] === 'e' && p[1] === 'nuevo') return await viewEquipmentForm(null);
    if (p[0] === 'e' && p[1] && p[2] === 'editar') return await viewEquipmentForm(p[1]);
    if (p[0] === 'e' && p[1]) return await viewEquipment(p[1]);
    if (p[0] === 'responsables') return await viewProviders();
    if (p[0] === 'r' && p[1] === 'nuevo') return await viewProviderForm(null);
    if (p[0] === 'r' && p[1] && p[2] === 'editar') return await viewProviderForm(p[1]);
    if (p[0] === 'r' && p[1]) return await viewProvider(p[1]);
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

window.addEventListener('hashchange', () => { inAppNavs++; route(); });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && S.user && (location.hash === '' || location.hash === '#/')) viewTasks({ silent: true });
});
showLogin();
