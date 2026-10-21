/* Mantenimiento Dos Búhos — front end (vanilla JS, no build step) */
'use strict';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const APP = $('#app');
const NAV = $('#nav');

const S = { user: null, areas: [], providers: [], equipment: [], users: [] };
const PRIO = { 1: ['Urgente', 'var(--p1)'], 2: ['Alta', 'var(--p2)'], 3: ['Normal', 'var(--p3)'], 4: ['Baja', 'var(--p4)'] };
const STATUS = { pendiente: 'Pendiente', en_proceso: 'En proceso', en_espera: 'En espera', hecha: 'Hecha', cancelada: 'Cancelada' };
const OPEN = ['pendiente', 'en_proceso', 'en_espera'];

// ---------- utils ----------
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
  toast._t = setTimeout(() => (t.className = 'toast'), bad ? 3500 : 1800);
}
const parseUTC = (s) => (s ? new Date(s.replace(' ', 'T') + 'Z') : null);
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
function fmtDay(ymd) {
  if (!ymd) return '';
  const [y, m, d] = ymd.split('-').map(Number);
  const sameYear = y === new Date().getFullYear();
  return `${d} ${MESES[m - 1]}${sameYear ? '' : ' ' + y}`;
}
function fmtDateTime(s) {
  const d = parseUTC(s);
  if (!d) return '';
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return `${d.getDate()} ${MESES[d.getMonth()]}${sameYear ? '' : ' ' + d.getFullYear()}, ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function localYmd(s) {
  const d = parseUTC(s);
  if (!d) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
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
  return fmtDateTime(s).split(',')[0];
}
function daysBetween(a, b) {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}
function addDays(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}
function waNumber(phone) {
  let d = String(phone || '').replace(/\D/g, '');
  if (d.length === 10) d = '52' + d;
  return d;
}
const isAdmin = () => S.user && S.user.role === 'admin';
const areaName = (id) => (S.areas.find((a) => a.id === id) || {}).name || 'Sin área';
const activeProviders = () => S.providers.filter((p) => p.active);

// ---------- API ----------
async function api(method, path, data) {
  const opts = { method, headers: {}, credentials: 'same-origin' };
  if (data !== undefined) {
    opts.headers['content-type'] = 'application/json';
    opts.body = JSON.stringify(data);
  }
  let res;
  try {
    res = await fetch('/api' + path, opts);
  } catch {
    throw new Error('Sin conexión. Revisa tu internet.');
  }
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
async function loadBoot() {
  const b = await api('GET', '/bootstrap');
  Object.assign(S, b);
}

// ---------- photos ----------
function compress(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const max = 1600;
        const w = img.naturalWidth, h = img.naturalHeight;
        const s = Math.min(1, max / Math.max(w, h));
        const c = document.createElement('canvas');
        c.width = Math.round(w * s);
        c.height = Math.round(h * s);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        c.toBlob((b) => resolve(b || file), 'image/jpeg', 0.78);
      } catch {
        URL.revokeObjectURL(url);
        resolve(file);
      }
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}
async function uploadPhoto(path, file) {
  const blob = await compress(file);
  if (blob.size > 4 * 1024 * 1024) throw new Error('Foto demasiado grande');
  const res = await fetch('/api' + path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': blob.type || 'image/jpeg' },
    body: blob,
  });
  if (!res.ok) {
    let e = {};
    try { e = await res.json(); } catch { /* */ }
    throw new Error(e.error || 'No se pudo subir la foto');
  }
}
function openViewer(photoId, canDelete, onDelete) {
  const v = $('#viewer');
  v.innerHTML = `<div class="vbar"><button data-close>✕ Cerrar</button>${canDelete ? '<button data-del>🗑 Borrar foto</button>' : ''}</div>
    <img src="/api/photos/${photoId}" alt="">`;
  v.classList.remove('hidden');
  $('[data-close]', v).onclick = () => v.classList.add('hidden');
  const del = $('[data-del]', v);
  if (del) del.onclick = async () => {
    if (!confirm('¿Borrar esta foto?')) return;
    try {
      await api('DELETE', '/photos/' + photoId);
      v.classList.add('hidden');
      toast('Foto borrada');
      onDelete && onDelete();
    } catch (e) { toast(e.message, true); }
  };
}
function photoGrid(photos, addId) {
  return `<div class="photos">
    ${photos.map((p) => `<div class="ph" data-photo="${p.id}" data-uid="${p.user_id}"><img loading="lazy" src="/api/photos/${p.id}" alt=""></div>`).join('')}
    <label class="add" for="${addId}"><b>📷</b>Agregar</label>
  </div>
  <input type="file" id="${addId}" accept="image/*" multiple hidden>`;
}
function bindPhotoGrid(root, addId, uploadPath, reload) {
  $$('[data-photo]', root).forEach((el) => {
    el.onclick = () => {
      const canDel = isAdmin() || Number(el.dataset.uid) === S.user.id;
      openViewer(el.dataset.photo, canDel, reload);
    };
  });
  const input = $('#' + addId, root);
  input.onchange = async () => {
    const files = [...input.files];
    if (!files.length) return;
    const grid = $('.photos', root);
    const add = $('.add', grid);
    const placeholders = files.map(() => {
      const d = document.createElement('div');
      d.className = 'ph uploading';
      grid.insertBefore(d, add);
      return d;
    });
    let ok = 0;
    for (let i = 0; i < files.length; i++) {
      try {
        await uploadPhoto(uploadPath, files[i]);
        ok++;
      } catch (e) { toast(e.message, true); }
      placeholders[i].classList.remove('uploading');
    }
    if (ok) toast(ok === 1 ? 'Foto agregada' : `${ok} fotos agregadas`);
    reload();
  };
}

// ---------- shell ----------
function header(title, { back = false, right = '' } = {}) {
  return `<header class="top">
    ${back ? '<button class="back" data-back aria-label="Atrás">‹</button>' : ''}
    <h1>${esc(title)}</h1>${right}
  </header>`;
}
function render(html, tab, keepScroll = false) {
  const y = window.scrollY;
  APP.innerHTML = html;
  NAV.classList.remove('hidden');
  $$('a[data-tab]', NAV).forEach((a) => a.classList.toggle('on', a.dataset.tab === tab));
  const back = $('[data-back]', APP);
  if (back) back.onclick = goBack;
  window.scrollTo(0, keepScroll ? y : 0);
}
let inAppNavs = 0; // hash changes since the page loaded; 0 = opened from a link
function goBack() {
  if (inAppNavs > 0) history.back();
  else location.hash = '#/';
}
function loading(tab) {
  render('<div class="boot">Cargando…</div>', tab);
}

// ---------- login / setup ----------
async function showLogin() {
  NAV.classList.add('hidden');
  let st;
  try {
    const r = await fetch('/api/status', { credentials: 'same-origin' });
    st = await r.json();
  } catch {
    APP.innerHTML = '<div class="login"><h1>Sin conexión</h1><p>Revisa tu internet y recarga.</p></div>';
    return;
  }
  if (st.user) { S.user = st.user; return start(); }
  if (st.setup) return showSetup();

  let selected = store('mt_last_user');
  if (!st.names.some((n) => n.id === selected)) selected = null;
  APP.innerHTML = `<div class="login">
    <h1>Mantenimiento</h1>
    <div class="small">Dos Búhos · ¿Quién eres?</div>
    <div class="names">${st.names.map((n) => `<button data-id="${n.id}" class="${n.id === selected ? 'on' : ''}">${esc(n.name)}</button>`).join('')}</div>
    <div class="field"><label>PIN</label>
      <input id="pin" class="pin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="8" autocomplete="current-password"></div>
    <button class="btn" id="go">Entrar</button>
    <div class="err" id="err"></div>
    <p class="small center mt">¿No apareces? Pide a un administrador que te dé de alta.</p>
  </div>`;
  $$('.names button').forEach((b) => (b.onclick = () => {
    selected = Number(b.dataset.id);
    $$('.names button').forEach((x) => x.classList.toggle('on', x === b));
    $('#pin').focus();
  }));
  const submit = async () => {
    $('#err').textContent = '';
    if (!selected) return ($('#err').textContent = 'Elige tu nombre');
    const btn = $('#go');
    btn.disabled = true;
    try {
      const r = await api('POST', '/login', { user_id: selected, pin: $('#pin').value });
      store('mt_last_user', selected);
      S.user = r.user;
      start();
    } catch (e) {
      $('#err').textContent = e.message;
      $('#pin').value = '';
      btn.disabled = false;
    }
  };
  $('#go').onclick = submit;
  $('#pin').onkeydown = (e) => { if (e.key === 'Enter') submit(); };
}

function showSetup() {
  NAV.classList.add('hidden');
  APP.innerHTML = `<div class="login">
    <h1>Configurar app</h1>
    <p class="small">Primer uso. Crea tu usuario administrador. Después das de alta a los demás desde “Más”.</p>
    <div class="field"><label>Tu nombre</label><input id="n" type="text" autocomplete="name"></div>
    <div class="field"><label>PIN (4 a 8 dígitos)</label><input id="p1" class="pin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="8"></div>
    <div class="field"><label>Repite el PIN</label><input id="p2" class="pin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="8"></div>
    <button class="btn" id="go">Crear y entrar</button>
    <div class="err" id="err"></div>
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
function listFilters() {
  return Object.assign({ view: 'open', area: '', provider: '', q: '' }, store('mt_filters') || {});
}
function saveFilters(f) { store('mt_filters', f); }

function taskCard(t) {
  const [plabel, pcolor] = PRIO[t.priority] || PRIO[3];
  const open = OPEN.includes(t.status);
  const late = open && t.due_date && t.due_date < todayStr();
  const assignee = t.provider_id
    ? `<span class="tag ${t.provider_kind === 'externo' ? 'ext' : 'int'}">👤 ${esc(t.provider_name)}</span>`
    : (open ? '<span class="tag unassigned">Sin asignar</span>' : '');
  const due = t.due_date && open ? `<span class="tag ${late ? 'late' : ''}">📅 ${late ? 'Vencida ' : ''}${fmtDay(t.due_date)}</span>` : '';
  const done = !open && t.completed_at ? `<span class="tag">✓ ${fmtDay(localYmd(t.completed_at))}</span>` : '';
  const sub = [t.area_name || 'Sin área', t.equipment_name].filter(Boolean).map(esc).join(' · ');
  return `<a class="card pr" style="--pc:${pcolor}" href="#/t/${t.id}">
    <div class="t">${t.kind === 'servicio' ? '🔧 ' : ''}${esc(t.title)}</div>
    <div class="sub">${sub}</div>
    <div class="sub">Pidió ${esc(t.created_by_name || '—')} · ${rel(t.created_at)}</div>
    <div class="meta">
      <span class="tag"><span class="prdot" style="--pc:${pcolor}"></span>${plabel}</span>
      <span class="tag st-${t.status}">${STATUS[t.status]}</span>
      ${assignee}${due}${done}
      ${t.photo_count ? `<span class="tag">📷 ${t.photo_count}</span>` : ''}
      ${t.note_count ? `<span class="tag">💬 ${t.note_count}</span>` : ''}
    </div>
  </a>`;
}

const TL = { key: null, tasks: [] };

async function viewTasks({ silent = false } = {}) {
  const f = listFilters();
  const params = f.view === 'open' ? 'view=open' : f.view === 'done' ? 'view=done' : 'view=all&mine=1';
  if (!silent || TL.key !== params) loading('tareas');
  try {
    TL.tasks = (await api('GET', '/tasks?' + params)).tasks;
    TL.key = params;
  } catch (e) { return render(header('Tareas') + `<div class="wrap empty">${esc(e.message)}</div>`, 'tareas'); }
  drawTasks(silent);
}

function drawTasks(keepScroll = false, refocus = false) {
  const f = listFilters();
  const tasks = TL.tasks;
  const q = f.q.trim().toLowerCase();
  const byText = tasks.filter((t) => !q || [t.title, t.description, t.equipment_name, t.provider_name, t.created_by_name, '#' + t.id]
    .join(' ').toLowerCase().includes(q));
  const byProv = byText.filter((t) => !f.provider || (f.provider === 'none' ? !t.provider_id : String(t.provider_id) === f.provider));
  const shown = byProv.filter((t) => !f.area || String(t.area_id || 0) === f.area);

  const areaCounts = {};
  byProv.forEach((t) => { const k = String(t.area_id || 0); areaCounts[k] = (areaCounts[k] || 0) + 1; });
  const areaChips = S.areas.filter((a) => a.active || areaCounts[a.id])
    .map((a) => `<button class="chip ${f.area === String(a.id) ? 'on' : ''}" data-area="${a.id}">${esc(a.name)}<span class="n">${areaCounts[a.id] || 0}</span></button>`).join('')
    + (areaCounts['0'] ? `<button class="chip ${f.area === '0' ? 'on' : ''}" data-area="0">Sin área<span class="n">${areaCounts['0']}</span></button>` : '');

  const unassigned = f.view !== 'done'
    ? byText.filter((t) => !t.provider_id && OPEN.includes(t.status) && (!f.area || String(t.area_id || 0) === f.area)).length : 0;

  const provOpts = `<option value="">Todos los responsables</option>
    <option value="none" ${f.provider === 'none' ? 'selected' : ''}>Sin asignar (bandeja)</option>
    ${activeProviders().map((p) => `<option value="${p.id}" ${f.provider === String(p.id) ? 'selected' : ''}>${esc(p.name)}${p.kind === 'externo' ? ' (externo)' : ''}</option>`).join('')}`;

  let body = '';
  if (!shown.length) {
    body = `<div class="empty">${f.view === 'open' && !q ? 'Nada pendiente aquí 👌' : 'Sin tareas'}</div>`;
  } else if (f.view === 'open' && !f.area) {
    const groups = {};
    shown.forEach((t) => { (groups[t.area_id || 0] ||= []).push(t); });
    const order = [...S.areas.map((a) => a.id), 0];
    body = order.filter((id) => groups[id]).map((id) =>
      `<div class="group"><span>${esc(id ? areaName(id) : 'Sin área')}</span><span>${groups[id].length}</span></div>${groups[id].map(taskCard).join('')}`
    ).join('');
  } else {
    body = shown.map(taskCard).join('');
  }

  render(header('Tareas', { right: '<button class="iconbtn" data-refresh aria-label="Actualizar">↻</button>' }) + `<div class="wrap">
    <div class="seg">
      <button data-view="open" class="${f.view === 'open' ? 'on' : ''}">Abiertas</button>
      <button data-view="mine" class="${f.view === 'mine' ? 'on' : ''}">Las que pedí</button>
      <button data-view="done" class="${f.view === 'done' ? 'on' : ''}">Hechas</button>
    </div>
    ${unassigned && f.provider !== 'none' ? `<a class="banner" data-inbox><b>${unassigned}</b> sin asignar en la bandeja<span class="go">Ver ›</span></a>` : ''}
    ${f.provider === 'none' ? `<a class="banner" data-allprov>Viendo solo la bandeja (sin asignar)<span class="go">Ver todas ›</span></a>` : ''}
    <div class="chips"><button class="chip ${!f.area ? 'on' : ''}" data-area="">Todas<span class="n">${byProv.length}</span></button>${areaChips}</div>
    <div class="filterrow"><select id="prov" aria-label="Responsable">${provOpts}</select></div>
    <div class="searchbar"><input type="search" id="q" placeholder="Buscar…" value="${esc(f.q)}"></div>
    ${body}
  </div>`, 'tareas', keepScroll);

  const set = (k, v) => { f[k] = v; saveFilters(f); };
  $$('[data-view]').forEach((b) => (b.onclick = () => { set('view', b.dataset.view); viewTasks(); }));
  $$('[data-area]').forEach((b) => (b.onclick = () => { set('area', b.dataset.area); drawTasks(true); }));
  $('#prov').onchange = (e) => { set('provider', e.target.value); drawTasks(true); };
  const inbox = $('[data-inbox]');
  if (inbox) inbox.onclick = () => { set('provider', 'none'); drawTasks(); };
  const allp = $('[data-allprov]');
  if (allp) allp.onclick = () => { set('provider', ''); drawTasks(); };
  $('[data-refresh]').onclick = async () => { await loadBoot().catch(() => {}); await viewTasks({ silent: true }); toast('Actualizado'); };
  let tmr;
  const qi = $('#q');
  if (refocus) { qi.focus(); const n = qi.value.length; qi.setSelectionRange(n, n); }
  qi.oninput = (e) => {
    clearTimeout(tmr);
    tmr = setTimeout(() => { set('q', e.target.value); drawTasks(true, true); }, 300);
  };
}

// ---------- task form (new / edit / service) ----------
function providerOptions(selected, emptyLabel) {
  const avail = S.providers.filter((p) => p.active || p.id === Number(selected));
  const ints = avail.filter((p) => p.kind === 'interno');
  const exts = avail.filter((p) => p.kind === 'externo');
  const opt = (p) => `<option value="${p.id}" ${Number(selected) === p.id ? 'selected' : ''}>${esc(p.name)}${p.specialty ? ' · ' + esc(p.specialty) : ''}</option>`;
  return `<option value="">${esc(emptyLabel)}</option>
    ${ints.length ? `<optgroup label="Personal interno">${ints.map(opt).join('')}</optgroup>` : ''}
    ${exts.length ? `<optgroup label="Proveedores externos">${exts.map(opt).join('')}</optgroup>` : ''}`;
}
function equipmentOptions(areaId, selected) {
  const list = S.equipment.filter((e) => (e.active || e.id === Number(selected)) && (!areaId || e.area_id === Number(areaId) || e.id === Number(selected)));
  return `<option value="">— Ninguno —</option>` + list.map((e) =>
    `<option value="${e.id}" ${Number(selected) === e.id ? 'selected' : ''}>${esc(e.name)}</option>`).join('');
}

async function viewTaskForm({ id = null, query = {} } = {}) {
  const service = query.servicio === '1';
  let t = {
    title: service ? 'Servicio de mantenimiento' : '', description: '', priority: 3,
    area_id: query.area ? Number(query.area) : null,
    equipment_id: query.equipment ? Number(query.equipment) : null,
    provider_id: null, due_date: '', cost: '',
  };
  if (t.equipment_id && !t.area_id) {
    const eq = S.equipment.find((e) => e.id === t.equipment_id);
    if (eq) t.area_id = eq.area_id;
  }
  if (service && t.equipment_id) {
    // default provider = equipment's usual provider
    try {
      const d = await api('GET', '/equipment/' + t.equipment_id);
      t.provider_id = d.equipment.provider_id;
      t.title = `Servicio · ${d.equipment.name}`;
    } catch { /* */ }
  }
  if (id) {
    loading('tareas');
    const d = await api('GET', '/tasks/' + id);
    t = d.task;
  }
  const title = id ? 'Editar tarea' : service ? 'Registrar servicio' : 'Nueva tarea';
  const pending = [];

  render(header(title, { back: true }) + `<div class="wrap">
    <div class="field"><label>${service ? '¿Qué se hizo?' : '¿Qué se necesita?'}</label>
      <input type="text" id="f-title" maxlength="200" value="${esc(t.title)}" placeholder="${service ? 'Ej. Limpieza y recarga de gas' : 'Ej. Fuga en baño de mujeres'}"></div>
    <div class="field"><label>Área</label>
      <div class="chipgrid" id="f-area">${S.areas.filter((a) => a.active || a.id === t.area_id).map((a) =>
        `<button type="button" class="chip ${t.area_id === a.id ? 'on' : ''}" data-id="${a.id}">${esc(a.name)}</button>`).join('')}</div></div>
    ${service ? '' : `<div class="field"><label>Prioridad</label>
      <div class="prio" id="f-prio">${[1, 2, 3, 4].map((p) =>
        `<button type="button" style="--pc:${PRIO[p][1]}" class="${t.priority === p ? 'on' : ''}" data-p="${p}">${PRIO[p][0]}</button>`).join('')}</div></div>`}
    <div class="field"><label>Detalles ${service ? '' : '(opcional)'}</label>
      <textarea id="f-desc" maxlength="4000" placeholder="${service ? 'Qué se revisó, piezas cambiadas, recomendaciones…' : 'Dónde exactamente, qué pasa, desde cuándo…'}">${esc(t.description || '')}</textarea></div>
    <div class="field"><label>Equipo (opcional)</label>
      <select id="f-equip">${equipmentOptions(t.area_id, t.equipment_id)}</select></div>
    ${id ? '' : `<div class="field"><label>${service ? '¿Quién lo hizo?' : 'Asignar a'}</label>
      <select id="f-prov">${providerOptions(t.provider_id, service ? '— Seleccionar —' : 'Bandeja de mantenimiento (Adrián decide)')}</select></div>`}
    ${service ? `<div class="row">
        <div class="field"><label>Fecha del servicio</label><input type="date" id="f-date" value="${todayStr()}" max="${todayStr()}"></div>
        <div class="field"><label>Costo (opcional)</label><input type="number" id="f-cost" inputmode="decimal" min="0" step="0.01" placeholder="$"></div>
      </div>`
    : (id ? `<div class="field"><label>Costo (opcional)</label><input type="number" id="f-cost" inputmode="decimal" min="0" step="0.01" value="${t.cost ?? ''}"></div>`
          : `<div class="field"><label>Fecha estimada (opcional)</label><input type="date" id="f-due" min="${todayStr()}"></div>`)}
    ${id ? '' : `<div class="field"><label>Fotos</label>
      <div class="photos" id="f-photos"><label class="add" for="f-file"><b>📷</b>Agregar</label></div>
      <input type="file" id="f-file" accept="image/*" multiple hidden></div>`}
    <button class="btn" id="f-save">${id ? 'Guardar cambios' : service ? 'Guardar servicio' : 'Enviar a mantenimiento'}</button>
  </div>`, id ? 'tareas' : '');

  let areaId = t.area_id;
  let prio = t.priority;
  $$('#f-area .chip').forEach((b) => (b.onclick = () => {
    const nid = Number(b.dataset.id);
    areaId = areaId === nid ? null : nid;
    $$('#f-area .chip').forEach((x) => x.classList.toggle('on', Number(x.dataset.id) === areaId));
    const cur = $('#f-equip').value;
    $('#f-equip').innerHTML = equipmentOptions(areaId, cur);
  }));
  $$('#f-prio button').forEach((b) => (b.onclick = () => {
    prio = Number(b.dataset.p);
    $$('#f-prio button').forEach((x) => x.classList.toggle('on', x === b));
  }));
  $('#f-equip').onchange = (e) => {
    const eq = S.equipment.find((x) => x.id === Number(e.target.value));
    if (eq && eq.area_id && !areaId) {
      areaId = eq.area_id;
      $$('#f-area .chip').forEach((x) => x.classList.toggle('on', Number(x.dataset.id) === areaId));
    }
  };
  const fileInput = $('#f-file');
  if (fileInput) fileInput.onchange = () => {
    for (const file of fileInput.files) {
      const url = URL.createObjectURL(file);
      pending.push(file);
      const d = document.createElement('div');
      d.className = 'ph';
      d.innerHTML = `<img src="${url}" alt=""><button class="x" type="button">✕</button>`;
      $('.x', d).onclick = () => { pending.splice(pending.indexOf(file), 1); d.remove(); };
      $('#f-photos').insertBefore(d, $('#f-photos .add'));
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
    if (!payload.title.trim()) return toast('Escribe qué se necesita', true);
    if (!id && !service && !areaId) return toast('Elige un área', true);
    if (!service) payload.priority = prio;
    btn.disabled = true;
    btn.textContent = 'Guardando…';
    try {
      if (id) {
        payload.cost = $('#f-cost').value;
        await api('PATCH', '/tasks/' + id, payload);
        toast('Guardado');
        location.replace('#/t/' + id);
        return;
      }
      payload.provider_id = $('#f-prov').value || null;
      if (service) {
        if (!payload.equipment_id && !areaId) { btn.disabled = false; btn.textContent = 'Guardar servicio'; return toast('Elige el equipo o el área', true); }
        payload.kind = 'servicio';
        payload.status = 'hecha';
        payload.priority = 3;
        payload.completed_date = $('#f-date').value || todayStr();
        payload.cost = $('#f-cost').value;
      } else {
        payload.due_date = $('#f-due').value || null;
      }
      const r = await api('POST', '/tasks', payload);
      const newId = r.task.id;
      for (let i = 0; i < pending.length; i++) {
        btn.textContent = `Subiendo foto ${i + 1} de ${pending.length}…`;
        try { await uploadPhoto(`/tasks/${newId}/photos`, pending[i]); } catch (e) { toast(e.message, true); }
      }
      toast(service ? 'Servicio registrado' : 'Enviada a mantenimiento');
      location.replace(service && payload.equipment_id ? '#/e/' + payload.equipment_id : '#/t/' + newId);
    } catch (e) {
      toast(e.message, true);
      btn.disabled = false;
      btn.textContent = id ? 'Guardar cambios' : service ? 'Guardar servicio' : 'Enviar a mantenimiento';
    }
  };
  if (!id) setTimeout(() => $('#f-title') && !service && $('#f-title').focus(), 50);
}

// ---------- task detail ----------
async function viewTask(id, keep = false) {
  if (!keep) loading('tareas');
  let d;
  try { d = await api('GET', '/tasks/' + id); } catch (e) {
    return render(header('Tarea', { back: true }) + `<div class="wrap empty">${esc(e.message)}</div>`, 'tareas');
  }
  const t = d.task;
  const open = OPEN.includes(t.status);
  const late = open && t.due_date && t.due_date < todayStr();
  const prov = S.providers.find((p) => p.id === t.provider_id);
  const link = `${location.origin}/#/t/${t.id}`;
  const shareText = `*Mantenimiento #${t.id}* — ${t.title}\nÁrea: ${t.area_name || 'Sin área'}${t.equipment_name ? '\nEquipo: ' + t.equipment_name : ''}\nPrioridad: ${PRIO[t.priority][0]}${t.description ? '\n\n' + t.description : ''}\n\n${link}`;

  render(header(`#${t.id}`, { back: true, right: `<a class="iconbtn" href="#/t/${t.id}/editar">Editar</a>` }) + `<div class="wrap">
    <div class="panel">
      <div class="bigtitle">${t.kind === 'servicio' ? '🔧 ' : ''}${esc(t.title)}</div>
      <div class="small">Pidió <b>${esc(t.created_by_name || '—')}</b> · ${fmtDateTime(t.created_at)}</div>
      ${t.description ? `<div class="desc mt">${esc(t.description)}</div>` : ''}
    </div>

    <div class="panel">
      <span class="lbl">Estado</span>
      <div class="status" id="d-status">${['pendiente', 'en_proceso', 'en_espera', 'hecha'].map((s) =>
        `<button class="st-${s} ${t.status === s ? 'on' : ''}" data-s="${s}">${STATUS[s]}</button>`).join('')}</div>
      ${t.status === 'cancelada' ? '<div class="small mt">Esta tarea está <b>cancelada</b>. Elige un estado para reabrirla.</div>' : ''}
      ${t.completed_at && t.status === 'hecha' ? `<div class="small mt">✓ Terminada ${fmtDateTime(t.completed_at)}</div>` : ''}

      <span class="lbl mt">Prioridad</span>
      <div class="prio" id="d-prio">${[1, 2, 3, 4].map((p) =>
        `<button style="--pc:${PRIO[p][1]}" class="${t.priority === p ? 'on' : ''}" data-p="${p}">${PRIO[p][0]}</button>`).join('')}</div>

      <div class="field mt"><label>Asignada a</label>
        <select id="d-prov">${providerOptions(t.provider_id, 'Sin asignar (bandeja)')}</select></div>
      <div class="field" style="margin-bottom:0"><label>Fecha estimada de término ${late ? '<span style="color:var(--late)">· vencida</span>' : ''}</label>
        <input type="date" id="d-due" value="${esc(t.due_date || '')}"></div>
    </div>

    <div class="panel">
      <div class="kv"><span>Área</span><span>${esc(t.area_name || 'Sin área')}</span></div>
      ${t.equipment_id ? `<div class="kv"><span>Equipo</span><span><a href="#/e/${t.equipment_id}" style="color:var(--accent);font-weight:600">${esc(t.equipment_name)} ›</a></span></div>` : ''}
      ${t.cost ? `<div class="kv"><span>Costo</span><span>$${Number(t.cost).toLocaleString('es-MX')}</span></div>` : ''}
      <div class="kv"><span>Última actualización</span><span>${rel(t.updated_at)}</span></div>
    </div>

    <div class="panel" id="d-photos">
      <span class="lbl">Fotos</span>
      ${photoGrid(d.photos, 'd-file')}
    </div>

    <div class="panel">
      <span class="lbl">Notas e historial</span>
      <ul class="timeline">${d.notes.map((n) => n.kind === 'sistema'
        ? `<li class="sys">${esc(n.body)} · ${fmtDateTime(n.created_at)}</li>`
        : `<li><div class="who"><span><b>${esc(n.user_name || '—')}</b> · ${fmtDateTime(n.created_at)}</span>
            ${(isAdmin() || n.user_id === S.user.id) ? `<button class="del" data-delnote="${n.id}">borrar</button>` : ''}</div>
            <div class="body">${esc(n.body)}</div></li>`).join('')}</ul>
      <div class="notebox">
        <textarea id="d-note" placeholder="Agregar nota…" maxlength="4000"></textarea>
        <button class="btn sm" id="d-addnote">Enviar</button>
      </div>
    </div>

    <div class="stack">
      ${prov && prov.phone ? `<a class="btn wa" target="_blank" rel="noopener" href="https://wa.me/${waNumber(prov.phone)}?text=${encodeURIComponent(shareText)}">Enviar a ${esc(prov.name)} por WhatsApp</a>` : ''}
      <a class="btn sec" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(shareText)}">Compartir por WhatsApp</a>
      ${t.status !== 'cancelada' ? '<button class="btn sec" id="d-cancel">Cancelar tarea</button>' : ''}
      ${isAdmin() ? '<button class="btn danger" id="d-del">Eliminar tarea</button>' : ''}
    </div>
  </div>`, 'tareas', keep);

  const patch = async (data, msg = 'Guardado') => {
    try {
      await api('PATCH', '/tasks/' + id, data);
      toast(msg);
      viewTask(id, true);
    } catch (e) { toast(e.message, true); }
  };
  $$('#d-status button').forEach((b) => (b.onclick = () => { if (b.dataset.s !== t.status) patch({ status: b.dataset.s }); }));
  $$('#d-prio button').forEach((b) => (b.onclick = () => { if (Number(b.dataset.p) !== t.priority) patch({ priority: Number(b.dataset.p) }); }));
  $('#d-prov').onchange = (e) => {
    patch({ provider_id: e.target.value || null }, e.target.value ? 'Asignada' : 'Regresó a la bandeja');
  };
  $('#d-due').onchange = (e) => patch({ due_date: e.target.value || null }, e.target.value ? 'Fecha guardada' : 'Fecha quitada');
  bindPhotoGrid($('#d-photos'), 'd-file', `/tasks/${id}/photos`, () => viewTask(id, true));
  $('#d-addnote').onclick = async () => {
    const v = $('#d-note').value.trim();
    if (!v) return;
    $('#d-addnote').disabled = true;
    try {
      await api('POST', `/tasks/${id}/notes`, { body: v });
      toast('Nota agregada');
      viewTask(id, true);
    } catch (e) { toast(e.message, true); $('#d-addnote').disabled = false; }
  };
  $$('[data-delnote]').forEach((b) => (b.onclick = async () => {
    if (!confirm('¿Borrar esta nota?')) return;
    try { await api('DELETE', '/notes/' + b.dataset.delnote); viewTask(id, true); } catch (e) { toast(e.message, true); }
  }));
  const cancel = $('#d-cancel');
  if (cancel) cancel.onclick = () => { if (confirm('¿Cancelar esta tarea? (no se borra, queda en Hechas)')) patch({ status: 'cancelada' }, 'Cancelada'); };
  const del = $('#d-del');
  if (del) del.onclick = async () => {
    if (!confirm('¿Eliminar esta tarea para siempre? Se borran también sus fotos y notas.')) return;
    try {
      await api('DELETE', '/tasks/' + id);
      toast('Tarea eliminada');
      location.replace('#/');
    } catch (e) { toast(e.message, true); }
  };
}

// ---------- equipment ----------
function serviceInfo(e) {
  const last = e.last_service ? localYmd(e.last_service) : null;
  let next = null, left = null;
  if (last && e.service_interval_days) {
    next = addDays(last, e.service_interval_days);
    left = daysBetween(todayStr(), next);
  }
  return { last, next, left };
}
function dueTag(e) {
  const { last, left } = serviceInfo(e);
  if (!e.service_interval_days) return '';
  if (!last) return '<span class="tag unassigned">Sin servicio registrado</span>';
  if (left < 0) return `<span class="tag late">Servicio vencido hace ${-left} d</span>`;
  if (left <= 14) return `<span class="tag unassigned">Servicio en ${left} d</span>`;
  return `<span class="tag st-hecha">Próximo en ${left} d</span>`;
}

const EQ = { list: [] };
async function viewEquipmentList() {
  loading('equipos');
  try { EQ.list = (await api('GET', '/equipment')).equipment; } catch (e) {
    return render(header('Equipos') + `<div class="wrap empty">${esc(e.message)}</div>`, 'equipos');
  }
  drawEquipmentList();
}
function drawEquipmentList(refocus = false) {
  const list = EQ.list;
  const q = (store('mt_eq_q') || '').toLowerCase();
  const shown = list.filter((e) => !q || [e.name, e.location, e.brand_model, e.area_name].join(' ').toLowerCase().includes(q));
  const groups = {};
  shown.forEach((e) => { (groups[e.area_id || 0] ||= []).push(e); });
  const order = [...S.areas.map((a) => a.id), 0];
  const body = shown.length ? order.filter((id) => groups[id]).map((id) =>
    `<div class="group"><span>${esc(id ? areaName(id) : 'Sin área')}</span><span>${groups[id].length}</span></div>` +
    groups[id].map((e) => {
      const { last } = serviceInfo(e);
      return `<a class="card" href="#/e/${e.id}">
        <div class="t">${esc(e.name)}</div>
        <div class="sub">${[e.location, e.brand_model].filter(Boolean).map(esc).join(' · ') || '&nbsp;'}</div>
        <div class="meta">
          <span class="tag">Último servicio: ${last ? fmtDay(last) : '—'}</span>
          ${dueTag(e)}
          ${e.open_count ? `<span class="tag st-pendiente">${e.open_count} abierta${e.open_count > 1 ? 's' : ''}</span>` : ''}
        </div></a>`;
    }).join('')).join('')
    : `<div class="empty">${list.length ? 'Sin resultados' : 'Aún no hay equipos. Agrega chillers, A/C, bombas, cámaras de frío…'}</div>`;

  render(header('Equipos', { right: '<a class="iconbtn" href="#/e/nuevo">+ Nuevo</a>' }) + `<div class="wrap">
    <div class="searchbar"><input type="search" id="eq-q" placeholder="Buscar equipo…" value="${esc(store('mt_eq_q') || '')}"></div>
    ${body}</div>`, 'equipos', refocus);
  let tmr;
  const qi = $('#eq-q');
  if (refocus) { qi.focus(); const n = qi.value.length; qi.setSelectionRange(n, n); }
  qi.oninput = (e) => {
    clearTimeout(tmr);
    tmr = setTimeout(() => { store('mt_eq_q', e.target.value); drawEquipmentList(true); }, 300);
  };
}

async function viewEquipment(id, keep = false) {
  if (!keep) loading('equipos');
  let d;
  try { d = await api('GET', '/equipment/' + id); } catch (e) {
    return render(header('Equipo', { back: true }) + `<div class="wrap empty">${esc(e.message)}</div>`, 'equipos');
  }
  const e = d.equipment;
  const { last, next } = serviceInfo(e);
  const openT = d.tasks.filter((t) => OPEN.includes(t.status));
  const doneT = d.tasks.filter((t) => !OPEN.includes(t.status));
  render(header(e.name, { back: true, right: `<a class="iconbtn" href="#/e/${id}/editar">Editar</a>` }) + `<div class="wrap">
    ${!e.active ? '<div class="banner">Este equipo fue dado de baja.</div>' : ''}
    <div class="row" style="margin-bottom:12px">
      <a class="btn" href="#/nueva?equipment=${id}">Reportar falla</a>
      <a class="btn sec" href="#/nueva?servicio=1&equipment=${id}">Registrar servicio</a>
    </div>
    <div class="panel">
      <div class="kv"><span>Área</span><span>${esc(e.area_name || 'Sin área')}</span></div>
      ${e.location ? `<div class="kv"><span>Ubicación</span><span>${esc(e.location)}</span></div>` : ''}
      ${e.brand_model ? `<div class="kv"><span>Marca / modelo</span><span>${esc(e.brand_model)}</span></div>` : ''}
      ${e.serial ? `<div class="kv"><span>No. de serie</span><span>${esc(e.serial)}</span></div>` : ''}
      ${e.provider_name ? `<div class="kv"><span>Proveedor habitual</span><span><a href="#/r/${e.provider_id}" style="color:var(--accent);font-weight:600">${esc(e.provider_name)} ›</a></span></div>` : ''}
      <div class="kv"><span>Último servicio</span><span>${last ? fmtDay(last) : '—'}</span></div>
      ${e.service_interval_days ? `<div class="kv"><span>Servicio cada</span><span>${e.service_interval_days} días</span></div>
        <div class="kv"><span>Próximo servicio</span><span>${next ? fmtDay(next) : '—'}</span></div>` : ''}
      ${e.notes ? `<div class="desc mt">${esc(e.notes)}</div>` : ''}
      <div class="meta">${dueTag(e)}</div>
    </div>
    <div class="panel" id="e-photos"><span class="lbl">Fotos (placa, ubicación, etc.)</span>${photoGrid(d.photos, 'e-file')}</div>
    ${openT.length ? `<div class="group"><span>Tareas abiertas</span><span>${openT.length}</span></div>${openT.map(taskCard).join('')}` : ''}
    <div class="group"><span>Historial de servicio</span><span>${doneT.length}</span></div>
    ${doneT.length ? doneT.map(taskCard).join('') : '<div class="empty" style="padding:16px">Sin registros todavía</div>'}
  </div>`, 'equipos', keep);
  bindPhotoGrid($('#e-photos'), 'e-file', `/equipment/${id}/photos`, () => viewEquipment(id, true));
}

async function viewEquipmentForm(id) {
  let e = { name: '', area_id: null, location: '', brand_model: '', serial: '', provider_id: null, service_interval_days: '', notes: '' };
  if (id) {
    loading('equipos');
    e = (await api('GET', '/equipment/' + id)).equipment;
  }
  render(header(id ? 'Editar equipo' : 'Nuevo equipo', { back: true }) + `<div class="wrap">
    <div class="field"><label>Nombre</label><input type="text" id="q-name" value="${esc(e.name)}" placeholder="Ej. Chiller cava / A/C salón"></div>
    <div class="field"><label>Área</label><select id="q-area"><option value="">— Sin área —</option>
      ${S.areas.filter((a) => a.active || a.id === e.area_id).map((a) => `<option value="${a.id}" ${a.id === e.area_id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></div>
    <div class="field"><label>Ubicación exacta</label><input type="text" id="q-loc" value="${esc(e.location || '')}" placeholder="Ej. Azotea cocina"></div>
    <div class="row">
      <div class="field"><label>Marca / modelo</label><input type="text" id="q-brand" value="${esc(e.brand_model || '')}"></div>
      <div class="field"><label>No. de serie</label><input type="text" id="q-serial" value="${esc(e.serial || '')}"></div>
    </div>
    <div class="field"><label>Proveedor habitual</label><select id="q-prov">${providerOptions(e.provider_id, '— Ninguno —')}</select></div>
    <div class="field"><label>Servicio preventivo cada (días)</label>
      <input type="number" id="q-int" inputmode="numeric" min="0" value="${e.service_interval_days ?? ''}" placeholder="Vacío = sin recordatorio">
      <div class="chips" style="padding-top:8px">${[[30, 'Mensual'], [90, 'Trimestral'], [180, 'Semestral'], [365, 'Anual']].map(([d, l]) =>
        `<button type="button" class="chip" data-int="${d}">${l}</button>`).join('')}</div></div>
    <div class="field"><label>Notas</label><textarea id="q-notes">${esc(e.notes || '')}</textarea></div>
    <button class="btn" id="q-save">${id ? 'Guardar' : 'Agregar equipo'}</button>
    ${id && isAdmin() && e.active ? '<button class="btn danger mt" id="q-del">Dar de baja</button>' : ''}
  </div>`, 'equipos');
  $$('[data-int]').forEach((b) => (b.onclick = () => ($('#q-int').value = b.dataset.int)));
  $('#q-save').onclick = async () => {
    const data = {
      name: $('#q-name').value, area_id: $('#q-area').value || null, location: $('#q-loc').value,
      brand_model: $('#q-brand').value, serial: $('#q-serial').value, provider_id: $('#q-prov').value || null,
      service_interval_days: $('#q-int').value || null, notes: $('#q-notes').value,
    };
    if (!data.name.trim()) return toast('Escribe el nombre', true);
    $('#q-save').disabled = true;
    try {
      let newId = id;
      if (id) await api('PATCH', '/equipment/' + id, data);
      else newId = (await api('POST', '/equipment', data)).id;
      await loadBoot();
      toast('Guardado');
      location.replace('#/e/' + newId);
    } catch (err) { toast(err.message, true); $('#q-save').disabled = false; }
  };
  const del = $('#q-del');
  if (del) del.onclick = async () => {
    if (!confirm('¿Dar de baja este equipo? Su historial se conserva.')) return;
    try { await api('DELETE', '/equipment/' + id); await loadBoot(); toast('Equipo dado de baja'); location.replace('#/equipos'); }
    catch (err) { toast(err.message, true); }
  };
}

// ---------- providers ----------
async function viewProviders() {
  loading('responsables');
  let list;
  try { list = (await api('GET', '/providers')).providers; } catch (e) {
    return render(header('Responsables') + `<div class="wrap empty">${esc(e.message)}</div>`, 'responsables');
  }
  const item = (p) => `<a class="item" href="#/r/${p.id}">
      <div class="grow"><div class="t">${esc(p.name)}</div>
        <div class="sub">${[p.specialty, p.phone].filter(Boolean).map(esc).join(' · ') || '&nbsp;'}</div>
        ${p.late_count ? `<div class="sub" style="color:var(--late);font-weight:600">${p.late_count} vencida${p.late_count > 1 ? 's' : ''}</div>` : ''}</div>
      <span class="badge ${p.open_count ? (p.late_count ? 'red' : '') : 'zero'}">${p.open_count}</span></a>`;
  const ints = list.filter((p) => p.kind === 'interno');
  const exts = list.filter((p) => p.kind === 'externo');
  render(header('Responsables', { right: '<a class="iconbtn" href="#/r/nuevo">+ Nuevo</a>' }) + `<div class="wrap list">
    <p class="small">Quién hace el trabajo. El número es cuántas tareas abiertas tiene.</p>
    <div class="group"><span>Personal interno</span><span>${ints.length}</span></div>
    ${ints.map(item).join('') || '<div class="small">Agrega a Adrián, carpinteros, etc.</div>'}
    <div class="group"><span>Proveedores externos</span><span>${exts.length}</span></div>
    ${exts.map(item).join('') || '<div class="small">Plomero, electricista, técnico de A/C…</div>'}
  </div>`, 'responsables');
}

async function viewProvider(id) {
  loading('responsables');
  let tasks;
  try {
    await loadBoot();
    tasks = (await api('GET', `/tasks?view=all&provider=${id}`)).tasks;
  } catch (e) { return render(header('Responsable', { back: true }) + `<div class="wrap empty">${esc(e.message)}</div>`, 'responsables'); }
  const p = S.providers.find((x) => x.id === Number(id));
  if (!p) return render(header('Responsable', { back: true }) + '<div class="wrap empty">No encontrado</div>', 'responsables');
  const openT = tasks.filter((t) => OPEN.includes(t.status));
  const doneT = tasks.filter((t) => !OPEN.includes(t.status)).sort((a, b) => (b.completed_at || b.updated_at).localeCompare(a.completed_at || a.updated_at)).slice(0, 30);
  render(header(p.name, { back: true, right: `<a class="iconbtn" href="#/r/${id}/editar">Editar</a>` }) + `<div class="wrap">
    <div class="panel">
      <div class="kv"><span>Tipo</span><span>${p.kind === 'interno' ? 'Personal interno' : 'Proveedor externo'}</span></div>
      ${p.specialty ? `<div class="kv"><span>Especialidad</span><span>${esc(p.specialty)}</span></div>` : ''}
      ${p.phone ? `<div class="kv"><span>Teléfono</span><span>${esc(p.phone)}</span></div>` : ''}
    </div>
    ${p.phone ? `<div class="row" style="margin-bottom:12px">
      <a class="btn sec" href="tel:${esc(p.phone.replace(/[^\d+]/g, ''))}">Llamar</a>
      <a class="btn wa" target="_blank" rel="noopener" href="https://wa.me/${waNumber(p.phone)}">WhatsApp</a></div>` : ''}
    <div class="group"><span>Abiertas</span><span>${openT.length}</span></div>
    ${openT.map(taskCard).join('') || '<div class="empty" style="padding:16px">Nada pendiente</div>'}
    <div class="group"><span>Terminadas recientes</span><span>${doneT.length}</span></div>
    ${doneT.map(taskCard).join('') || '<div class="empty" style="padding:16px">—</div>'}
  </div>`, 'responsables');
}

async function viewProviderForm(id) {
  let p = { name: '', kind: 'externo', specialty: '', phone: '', notes: '' };
  if (id) {
    await loadBoot();
    p = S.providers.find((x) => x.id === Number(id)) || p;
  }
  render(header(id ? 'Editar responsable' : 'Nuevo responsable', { back: true }) + `<div class="wrap">
    <div class="field"><label>Tipo</label><div class="seg">
      <button type="button" data-k="interno" class="${p.kind === 'interno' ? 'on' : ''}">Personal interno</button>
      <button type="button" data-k="externo" class="${p.kind === 'externo' ? 'on' : ''}">Proveedor externo</button></div></div>
    <div class="field"><label>Nombre</label><input type="text" id="p-name" value="${esc(p.name)}" placeholder="Ej. Adrián / Plomería Hernández"></div>
    <div class="field"><label>Especialidad</label><input type="text" id="p-spec" value="${esc(p.specialty || '')}" placeholder="Plomero, carpintero, A/C, electricista…"></div>
    <div class="field"><label>Teléfono (WhatsApp)</label><input type="tel" id="p-phone" value="${esc(p.phone || '')}" placeholder="10 dígitos"></div>
    <div class="field"><label>Notas</label><textarea id="p-notes">${esc(p.notes || '')}</textarea></div>
    <button class="btn" id="p-save">${id ? 'Guardar' : 'Agregar'}</button>
    ${id && isAdmin() ? '<button class="btn danger mt" id="p-del">Quitar de la lista</button>' : ''}
  </div>`, 'responsables');
  let kind = p.kind;
  $$('[data-k]').forEach((b) => (b.onclick = () => { kind = b.dataset.k; $$('[data-k]').forEach((x) => x.classList.toggle('on', x === b)); }));
  $('#p-save').onclick = async () => {
    const data = { name: $('#p-name').value, kind, specialty: $('#p-spec').value, phone: $('#p-phone').value, notes: $('#p-notes').value };
    if (!data.name.trim()) return toast('Escribe el nombre', true);
    $('#p-save').disabled = true;
    try {
      let newId = id;
      if (id) await api('PATCH', '/providers/' + id, data);
      else newId = (await api('POST', '/providers', data)).id;
      await loadBoot();
      toast('Guardado');
      location.replace('#/r/' + newId);
    } catch (e) { toast(e.message, true); $('#p-save').disabled = false; }
  };
  const del = $('#p-del');
  if (del) del.onclick = async () => {
    if (!confirm('¿Quitar de la lista? Sus tareas e historial se conservan.')) return;
    try { await api('DELETE', '/providers/' + id); await loadBoot(); toast('Quitado'); location.replace('#/responsables'); }
    catch (e) { toast(e.message, true); }
  };
}

// ---------- more / settings ----------
async function viewMore() {
  if (isAdmin()) await loadBoot().catch(() => {});
  render(header('Más') + `<div class="wrap">
    <div class="panel"><div class="kv"><span>Sesión</span><span><b>${esc(S.user.name)}</b> ${isAdmin() ? '· admin' : ''}</span></div></div>
    <div class="panel">
      <span class="lbl">Cambiar mi PIN</span>
      <div class="row"><input id="m-pin" class="pin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="8" placeholder="Nuevo PIN">
      <button class="btn sm" id="m-pinsave" style="flex:0 0 auto">Guardar</button></div>
    </div>
    ${isAdmin() ? `
    <div class="panel list">
      <span class="lbl">Usuarios (quién puede entrar)</span>
      ${S.users.map((u) => `<a class="item" href="#/usuarios/${u.id}"><div class="grow"><div class="t">${esc(u.name)}</div>
        <div class="sub">${u.role === 'admin' ? 'Administrador (puede borrar)' : 'Usuario'}${u.active ? '' : ' · desactivado'}</div></div><span>›</span></a>`).join('')}
      <a class="btn sec" href="#/usuarios/nuevo">+ Agregar usuario</a>
    </div>
    <div class="panel list">
      <span class="lbl">Áreas</span>
      ${S.areas.map((a) => `<div class="item"><div class="grow"><div class="t" style="${a.active ? '' : 'opacity:.5'}">${esc(a.name)}</div></div>
        <button class="iconbtn" data-rename="${a.id}">Renombrar</button>
        <button class="iconbtn" data-toggle="${a.id}" data-active="${a.active}">${a.active ? 'Ocultar' : 'Mostrar'}</button></div>`).join('')}
      <div class="row"><input type="text" id="m-area" placeholder="Nueva área"><button class="btn sm" id="m-areaadd" style="flex:0 0 auto">Agregar</button></div>
    </div>` : ''}
    <div class="stack">
      <button class="btn sec" id="m-share">Compartir enlace de la app</button>
      <button class="btn danger" id="m-out">Cerrar sesión</button>
    </div>
    <p class="small center mt">Tip: en el teléfono, “Agregar a pantalla de inicio” para usarla como app.</p>
  </div>`, 'mas');

  $('#m-pinsave').onclick = async () => {
    try { await api('POST', '/me/pin', { pin: $('#m-pin').value }); $('#m-pin').value = ''; toast('PIN actualizado'); }
    catch (e) { toast(e.message, true); }
  };
  $('#m-out').onclick = async () => { await api('POST', '/logout').catch(() => {}); S.user = null; location.hash = '#/'; showLogin(); };
  $('#m-share').onclick = async () => {
    const url = location.origin;
    try {
      if (navigator.share) await navigator.share({ title: 'Mantenimiento Dos Búhos', url });
      else { await navigator.clipboard.writeText(url); toast('Enlace copiado'); }
    } catch { /* cancelled */ }
  };
  $$('[data-rename]').forEach((b) => (b.onclick = async () => {
    const a = S.areas.find((x) => x.id === Number(b.dataset.rename));
    const name = prompt('Nuevo nombre del área', a.name);
    if (!name || name === a.name) return;
    try { await api('PATCH', '/areas/' + a.id, { name }); toast('Área renombrada'); viewMore(); } catch (e) { toast(e.message, true); }
  }));
  $$('[data-toggle]').forEach((b) => (b.onclick = async () => {
    try { await api('PATCH', '/areas/' + b.dataset.toggle, { active: b.dataset.active !== '1' }); viewMore(); } catch (e) { toast(e.message, true); }
  }));
  const add = $('#m-areaadd');
  if (add) add.onclick = async () => {
    const name = $('#m-area').value.trim();
    if (!name) return;
    try { await api('POST', '/areas', { name }); toast('Área agregada'); viewMore(); } catch (e) { toast(e.message, true); }
  };
}

async function viewUserForm(id) {
  if (!isAdmin()) return (location.hash = '#/mas');
  await loadBoot();
  const u = id ? S.users.find((x) => x.id === Number(id)) : { name: '', role: 'staff', active: 1 };
  if (!u) return (location.hash = '#/mas');
  render(header(id ? 'Editar usuario' : 'Nuevo usuario', { back: true }) + `<div class="wrap">
    <div class="field"><label>Nombre</label><input type="text" id="u-name" value="${esc(u.name)}"></div>
    <div class="field"><label>Permisos</label><div class="seg">
      <button type="button" data-r="staff" class="${u.role !== 'admin' ? 'on' : ''}">Usuario</button>
      <button type="button" data-r="admin" class="${u.role === 'admin' ? 'on' : ''}">Administrador</button></div>
      <div class="small">Administrador puede borrar tareas, gestionar usuarios y áreas. Dale este permiso a Adrián.</div></div>
    <div class="field"><label>${id ? 'Nuevo PIN (dejar vacío para no cambiar)' : 'PIN (4 a 8 dígitos)'}</label>
      <input id="u-pin" class="pin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="8"></div>
    <button class="btn" id="u-save">${id ? 'Guardar' : 'Crear usuario'}</button>
    ${id && u.id !== S.user.id ? `<button class="btn ${u.active ? 'danger' : 'sec'} mt" id="u-toggle">${u.active ? 'Desactivar acceso' : 'Reactivar acceso'}</button>` : ''}
  </div>`, 'mas');
  let role = u.role;
  $$('[data-r]').forEach((b) => (b.onclick = () => { role = b.dataset.r; $$('[data-r]').forEach((x) => x.classList.toggle('on', x === b)); }));
  $('#u-save').onclick = async () => {
    const data = { name: $('#u-name').value, role };
    const pin = $('#u-pin').value;
    if (pin || !id) data.pin = pin;
    try {
      if (id) await api('PATCH', '/users/' + id, data);
      else await api('POST', '/users', data);
      await loadBoot();
      toast('Guardado');
      location.replace('#/mas');
    } catch (e) { toast(e.message, true); }
  };
  const tg = $('#u-toggle');
  if (tg) tg.onclick = async () => {
    try { await api('PATCH', '/users/' + id, { active: !u.active }); await loadBoot(); toast('Listo'); location.replace('#/mas'); }
    catch (e) { toast(e.message, true); }
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
    location.hash = '#/';
  } catch (e) {
    if (S.user) render(header('Error', { back: true }) + `<div class="wrap empty">${esc(e.message)}</div>`, '');
  }
}

async function start() {
  try { await loadBoot(); } catch { return; }
  route();
}

window.addEventListener('hashchange', () => { inAppNavs++; route(); });
document.addEventListener('visibilitychange', () => {
  // refresh the task list when the phone comes back to the app
  if (document.visibilityState === 'visible' && S.user && (location.hash === '' || location.hash === '#/')) viewTasks({ silent: true });
});
showLogin();
