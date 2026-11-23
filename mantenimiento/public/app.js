/* Mantenimiento Dos Búhos — entering, Pendientes, one pendiente, reporting. Needs core.js. */
'use strict';

// ---------- entering: sign up once per phone, no PIN, no approval ----------
function showEnter() {
  if (sheet.close) sheet.close();
  if (openViewer.close) openViewer.close();
  NAV.classList.add('hidden');
  document.body.classList.remove('authed', 'has-bar');
  const me = store('mt_me') || {};
  APP.innerHTML = `<div class="enter">
    <img class="logo" src="/logo-word.png" alt="Dos Búhos" width="183" height="40">
    <h1>Mantenimiento</h1>
    <p class="lead">Regístrate una sola vez en este teléfono. Después entras directo.</p>
    <form id="en-form" novalidate>
      ${fInput('en-name', 'Tu nombre y apellido', { value: me.name, placeholder: 'Ej. Lupita Ramírez', max: 60, attrs: 'autocomplete="name" autocapitalize="words" enterkeyhint="next"' })}
      ${fInput('en-phone', 'Tu WhatsApp', { value: me.phone, type: 'tel', placeholder: '10 dígitos', max: 24, attrs: 'autocomplete="tel" inputmode="tel" enterkeyhint="next"', hint: 'Si tu número es de Estados Unidos, empieza con +1.' })}
      ${fInput('en-email', 'Tu correo', { value: me.email, type: 'email', placeholder: 'nombre@correo.com', max: 120, optional: true, attrs: 'autocomplete="email" autocapitalize="none" spellcheck="false" enterkeyhint="go"' })}
      <p class="err hidden" id="en-err" role="alert"></p>
      <button class="b block lg" type="submit" id="en-go">Entrar</button>
    </form>
    <p class="small center">¿Ya te habías registrado? Escribe el mismo WhatsApp y entras a tu cuenta.</p>
  </div>`;
  window.scrollTo(0, 0);
  const err = $('#en-err');
  $('#en-form').onsubmit = async (e) => {
    e.preventDefault();
    const data = { name: $('#en-name').value.trim(), phone: $('#en-phone').value.trim(), email: $('#en-email').value.trim() };
    const bad = (msg, id) => { err.textContent = msg; err.classList.remove('hidden'); if (id) $('#' + id).focus(); };
    // Only the phone is checked here: someone who is already registered gets in with it alone, and the server asks
    // a new person for their name.
    if (data.phone.replace(/\D/g, '').length < 10) return bad(data.name ? 'Escribe tu WhatsApp con los 10 dígitos' : 'Escribe tu nombre y tu WhatsApp', data.name ? 'en-phone' : 'en-name');
    const go = $('#en-go');
    go.disabled = true; go.textContent = 'Entrando…';
    try {
      const r = await api('POST', '/enter', data);
      S.user = r.user;
      store('mt_me', { name: r.user.name, phone: r.user.phone || data.phone, email: r.user.email || data.email });
      await loadBoot();
      route();
    } catch (ex) {
      go.disabled = false; go.textContent = 'Entrar';
      bad(ex.message);
    }
  };
}

// ---------- Pendientes ----------
// who: 'all' | 'mine' | 'none' | a contact id. areas: area ids (any of). group: 'date' | 'area' | 'who'.
// What the list shows. It opens grouped by priority: the point of the screen is to triage.
const F = Object.assign({ who: 'all', areas: [], prios: [], group: 'prio' }, store('mt_f2') || {});
let QUICK = null; // tile tapped: 'late' | 'today' | 'none'
const saveF = () => store('mt_f2', F);
const filterOn = () => F.who !== 'all' || F.areas.length > 0;

async function fetchOpen() {
  const r = await api('GET', '/tasks?view=open');
  S.today = r.today;
  C.open = r.tasks;
  C.openAt = Date.now();
  UI.lateN = C.open.filter(isLate).length;
  return C.open;
}
const touch = () => { C.openAt = 0; };  // something changed: the list is fetched again next time
const bySort = (a, b) => a.priority - b.priority || (a.due_date || '9').localeCompare(b.due_date || '9') || a.id - b.id;
const byLate = (a, b) => (a.due_date || '9').localeCompare(b.due_date || '9') || a.priority - b.priority || a.id - b.id;

function taskRow(t, { done = true, area = true, prio: showPrio = true } = {}) {
  const due = dueInfo(t);
  const open = isOpen(t);
  const urg = open && t.priority === 1;
  const hi = open && t.priority === 2;
  // One line under the title, in this order: where, how urgent, when, who, and only then anything unusual about it.
  const prio = !open || !showPrio ? '' : urg ? `<b class="urgent">${ic('flag')}Urgente</b>` : hi ? '<span class="st hi">Alta</span>' : `<span class="st">${PRIO[t.priority] || ''}</span>`;
  const when = open ? (due ? `<span class="due ${due.cls}">${ic(due.icon)}${esc(due.text)}</span>` : '')
    : t.completed_at ? `<span class="due ok">${ic('check')}Hecho ${esc(fmtDay(localYmd(t.completed_at)))}</span>` : '';
  const who = t.provider_id
    ? `<span class="who">${ic('user')}${esc(first(t.provider_name))}</span>`
    : open ? '<span class="who un">Sin asignar</span>' : '';
  const st = t.status === 'en_proceso' ? '<span class="st go">En curso</span>'
    : t.status === 'en_espera' ? `<span class="st wait">${esc(statusText(t))}</span>`
      : t.status === 'cancelada' ? '<span class="st">No aplica</span>' : '';
  const kind = t.kind === 'preventivo' ? `<span class="st">${ic('repeat')}Preventivo</span>` : t.kind === 'servicio' ? '<span class="st">Servicio</span>' : '';
  const post = t.postponed ? `<span class="st">${ic('clock')}Pospuesto ${t.postponed === 1 ? '1 vez' : t.postponed + ' veces'}</span>` : '';
  return `<article class="row ${urg ? 'urg' : hi ? 'hi' : ''} ${isLate(t) ? 'late' : ''}" data-id="${t.id}">
    ${open && done ? `<button class="chk" data-done="${t.id}" aria-label="Marcar hecho: ${esc(t.title)}"><span>${ic('check')}</span></button>`
      : `<span class="chk static ${t.status === 'hecha' ? 'ok' : ''}" aria-hidden="true"><span>${ic(t.status === 'cancelada' ? 'x' : 'check')}</span></span>`}
    <a class="rbody ${t.thumb_id ? 'has-th' : ''}" href="#/p/${t.id}">
      <span class="rt">${esc(t.title)}</span>
      <span class="rm">${area ? areaTag(t) : ''}${prio}${when}${who}${st}${kind}${post}</span>
      ${t.thumb_id ? `<img class="rthumb" loading="lazy" src="/api/photos/${t.thumb_id}?t=1" alt="">` : ''}
    </a>
  </article>`;
}
function bindRows(root, list, reload) {
  $$('[data-done]', root).forEach((b) => (b.onclick = () => {
    const t = list.find((x) => x.id === Number(b.dataset.done));
    if (t) completeSheet(t, reload);
  }));
}

async function viewPendientes({ silent = false } = {}) {
  if (!C.open) {
    if (!silent) loading({ tab: 'pendientes' });
    try { await fetchOpen(); } catch (e) { return errorView(e.message, { tab: 'pendientes' }); }
  } else if (!C.openAt) {
    // something was just changed: never paint a list we know is out of date
    try { await fetchOpen(); } catch (e) { toast(e.message, { bad: true }); }
  } else if (Date.now() - C.openAt > 15000) {
    // paint what we have, refresh behind
    fetchOpen().then(() => { if (UI.view === 'pendientes') drawPendientes(true); }).catch(() => {});
  }
  drawPendientes(silent);
}

function drawPendientes(keepScroll = false) {
  UI.view = 'pendientes';
  const all = C.open || [];
  const me = myCard();
  F.areas = F.areas.filter((id) => areaOf(id));
  if (typeof F.who === 'number' && !provOf(F.who)) F.who = 'all';
  const pool = all.filter((t) => (F.who === 'all' || (F.who === 'mine' ? t.provider_id === me : F.who === 'none' ? !t.provider_id : F.who === 'reported' ? t.created_by === S.user.id : t.provider_id === F.who))
    && (!F.areas.length || F.areas.includes(t.area_id)) && (!F.prios.length || F.prios.includes(t.priority)));
  const today = todayStr();
  const n = { late: pool.filter(isLate).length, today: pool.filter((t) => t.due_date === today).length, none: pool.filter((t) => !t.provider_id).length };
  if (QUICK && !n[QUICK]) QUICK = null;
  const list = QUICK === 'late' ? pool.filter(isLate) : QUICK === 'today' ? pool.filter((t) => t.due_date === today) : QUICK === 'none' ? pool.filter((t) => !t.provider_id) : pool;

  // groups
  let groups;
  if (F.group === 'prio') {
    groups = [1, 2, 3, 4].map((p) => ({ head: PRIO[p], cls: p === 1 ? 'bad' : p === 2 ? 'warn' : '', items: list.filter((t) => t.priority === p).sort(byLate) }));
  } else if (F.group === 'area') {
    const ids = [...new Set(list.map((t) => t.area_id || 0))];
    ids.sort((a, b) => (areaOf(a) ? areaOf(a).sort : 999) - (areaOf(b) ? areaOf(b).sort : 999));
    groups = ids.map((id) => ({ head: id && areaOf(id) ? tag(areaOf(id).name, areaOf(id).color) : 'Sin área', items: list.filter((t) => (t.area_id || 0) === id).sort(byLate) }));
  } else if (F.group === 'who') {
    const ids = [...new Set(list.map((t) => t.provider_id || 0))];
    const cnt = (id) => list.filter((t) => (t.provider_id || 0) === id).length;
    ids.sort((a, b) => (a === 0 ? -1 : b === 0 ? 1 : cnt(b) - cnt(a)));
    groups = ids.map((id) => ({ head: esc(id ? (provOf(id) || {}).name || 'Alguien' : 'Sin asignar'), cls: id ? '' : 'warn', items: list.filter((t) => (t.provider_id || 0) === id).sort(byLate) }));
  } else {
    const week = addDays(today, 7);
    const used = new Set();
    const take = (fn) => list.filter((t) => !used.has(t.id) && fn(t)).map((t) => (used.add(t.id), t));
    groups = [
      { head: 'Atrasados', cls: 'bad', items: take(isLate).sort(byLate) },
      { head: 'Para hoy', cls: 'warn', items: take((t) => t.due_date === today).sort(bySort) },
      { head: 'Esta semana', items: take((t) => t.due_date && t.due_date <= week).sort(byLate) },
      { head: 'Más adelante', items: take((t) => !!t.due_date).sort(byLate) },
      { head: 'Sin fecha', items: take(() => true).sort(bySort) },
    ];
  }
  groups = groups.filter((g) => g.items.length);

  const tile = (k, label, cls) => `<button type="button" class="tile ${n[k] ? cls : 'zero'} ${QUICK === k ? 'on' : ''}" data-quick="${k}" aria-pressed="${QUICK === k}" ${n[k] ? '' : 'disabled'}><b>${n[k]}</b><span>${label}</span></button>`;
  const chips = [];
  const WHO = { mine: 'Los que me tocan', none: 'Sin asignar', reported: 'Los que reporté' };
  if (F.who !== 'all') chips.push(`<button class="fchip" data-clear="who" aria-label="Quitar filtro">${esc(WHO[F.who] || 'De ' + first((provOf(F.who) || {}).name))}${ic('x')}</button>`);
  for (const p of F.prios) chips.push(`<button class="fchip" data-clear="p${p}" aria-label="Quitar filtro ${PRIO[p]}">${PRIO[p]}${ic('x')}</button>`);
  for (const id of F.areas) chips.push(`<button class="fchip tagc c-${areaOf(id).color}" data-clear="${id}" aria-label="Quitar filtro ${esc(areaOf(id).name)}">${esc(areaOf(id).name)}${ic('x')}</button>`);
  const d = ymdDate(today);
  const starter = isAdmin() && !store('mt_starter') && (S.equipment.length === 0 || !S.providers.some((p) => p.kind === 'externo' && p.active) || S.users.length < 3);
  const body = groups.length
    ? groups.map((g) => `<section><h2 class="sec ${g.cls || ''}">${g.head}<span class="n">${g.items.length}</span></h2><div class="list">${g.items.map((t) => taskRow(t, { area: F.group !== 'area', prio: F.group !== 'prio' })).join('')}</div></section>`).join('')
    : all.length
      ? `<div class="empty"><h2>Nada con este filtro</h2><p>Hay ${plural(all.length, 'pendiente', 'pendientes')} en total.</p><button class="b tonal" data-clearall>Ver todos</button></div>`
      : `<div class="empty"><h2>No hay pendientes</h2><p>Cuando alguien reporte algo, aparece aquí.</p><a class="b" href="#/nuevo">${ic('camera')}Reportar un problema</a></div>`;
  const nf = (F.who !== 'all' ? 1 : 0) + F.areas.length + F.prios.length + (F.group !== 'prio' ? 1 : 0);
  render(header('Pendientes', { right: `<a class="ib" href="#/buscar" aria-label="Buscar">${ic('search')}</a>` }) + `<div class="wrap">
    <div class="subhead"><p>${cap(DIAS[d.getDay()])} ${d.getDate()} de ${MESES_L[d.getMonth()]}</p>
      <button type="button" class="fbtn ${nf ? 'on' : ''}" data-filter>${ic('filter')}Filtrar${nf ? `<b>${nf}</b>` : ''}</button></div>
    <div class="tiles">${tile('late', 'Atrasados', 'bad')}${tile('today', 'Para hoy', 'warn')}${tile('none', 'Sin asignar', 'plain')}</div>
    ${chips.length ? `<div class="fchips">${chips.join('')}</div>` : ''}
    ${starter ? starterCard() : ''}
    ${body}
    <p class="foot-links"><a href="#/hechos">${ic('check')}Ver lo que ya se hizo</a><a href="#/resumen">${ic('chart')}Ver el resumen</a></p>
  </div>`, { tab: 'pendientes', keepScroll });
  const reload = () => viewPendientes({ silent: true });
  bindRows(APP, all, reload);
  $$('[data-quick]').forEach((b) => (b.onclick = () => { QUICK = QUICK === b.dataset.quick ? null : b.dataset.quick; drawPendientes(true); }));
  $$('[data-clear]').forEach((b) => (b.onclick = () => {
    const c = b.dataset.clear;
    if (c === 'who') F.who = 'all'; else if (c[0] === 'p') F.prios = F.prios.filter((x) => x !== Number(c.slice(1))); else F.areas = F.areas.filter((x) => x !== Number(c));
    saveF(); drawPendientes(true);
  }));
  const ca = $('[data-clearall]');
  if (ca) ca.onclick = () => { F.who = 'all'; F.areas = []; F.prios = []; QUICK = null; saveF(); drawPendientes(); };
  $('[data-filter]').onclick = () => filterSheet();
  const hs = $('[data-hidestarter]');
  if (hs) hs.onclick = () => { store('mt_starter', 1); drawPendientes(true); };
  UI.refresh = reload;
}

function starterCard() {
  const step = (ok, text, href) => `<a class="st-step ${ok ? 'ok' : ''}" href="${href}"><span class="st-n">${ok ? ic('check') : ''}</span><span class="grow">${text}</span>${ic('chev')}</a>`;
  return `<section class="starter" aria-label="Para arrancar">
    <div class="st-head"><h2>Para arrancar</h2><button class="linkbtn" data-hidestarter>Ocultar</button></div>
    ${step(S.providers.some((p) => p.kind === 'externo' && p.active), 'Agrega a tus externos: plomero, carpintero, refrigeración', '#/contactos')}
    ${step(S.equipment.length > 0, 'Da de alta los equipos: refrigeradores, chillers, bombas', '#/equipos')}
    ${step(S.users.length >= 3, 'Invita al equipo por WhatsApp', '#/cuenta')}
  </section>`;
}

// The filter sheet (same idea as Horizonte's): who, area tags, how to group. Applies as you tap.
function filterSheet() {
  const all = C.open || [];
  const me = myCard();
  const cntWho = (id) => all.filter((t) => t.provider_id === id).length;
  const people = [...new Set(all.map((t) => t.provider_id).filter(Boolean))].filter((id) => id !== me && provOf(id)).sort((a, b) => cntWho(b) - cntWho(a));
  const draw = () => {
    const whoBtn = (v, label, n) => `<button type="button" class="ch ${String(F.who) === String(v) ? 'on' : ''}" data-who="${v}" aria-pressed="${String(F.who) === String(v)}"><span class="cl">${esc(label)}</span>${n !== null ? `<span class="cn">${n}</span>` : ''}</button>`;
    return `<div class="pad">
      <h3 class="flabel">¿De quién?</h3>
      <div class="choice wrapc">${whoBtn('all', 'Todos', all.length)}${me ? whoBtn('mine', 'Los que me tocan', cntWho(me)) : ''}${whoBtn('none', 'Sin asignar', all.filter((t) => !t.provider_id).length)}${whoBtn('reported', 'Los que reporté', all.filter((t) => t.created_by === S.user.id).length)}
        ${people.map((id) => whoBtn(id, first(provOf(id).name), cntWho(id))).join('')}</div>
      <h3 class="flabel">Prioridad</h3>
      <div class="choice wrapc">${[1, 2, 3, 4].map((p) => `<button type="button" class="ch ${F.prios.includes(p) ? 'on' : ''}" data-prio="${p}" aria-pressed="${F.prios.includes(p)}"><span class="pdot p${p}"></span><span class="cl">${PRIO[p]}</span><span class="cn">${all.filter((t) => t.priority === p).length}</span></button>`).join('')}</div>
      <h3 class="flabel">Área</h3>
      <div class="choice wrapc tags">${activeAreas().map((a) => `<button type="button" class="ch tagc c-${a.color} ${F.areas.includes(a.id) ? 'on' : ''}" data-area="${a.id}" aria-pressed="${F.areas.includes(a.id)}"><span class="cl">${esc(a.name)}</span><span class="cn">${all.filter((t) => t.area_id === a.id).length}</span></button>`).join('')}</div>
      <h3 class="flabel">Agrupar por</h3>
      <div class="seg" role="radiogroup" aria-label="Agrupar por">${[['prio', 'Prioridad'], ['date', 'Fecha'], ['area', 'Área'], ['who', 'Persona']].map(([v, l]) => `<button type="button" role="radio" aria-checked="${F.group === v}" class="${F.group === v ? 'on' : ''}" data-group="${v}">${l}</button>`).join('')}</div>
    </div>`;
  };
  sheet({
    title: 'Filtrar',
    body: `<div id="f-body">${draw()}</div>`,
    acts: [{ label: 'Quitar filtros', cls: 'plain', value: 'clear' }, { label: 'Listo', value: 'ok' }],
    onOpen: (w) => {
      const bind = () => {
        $$('[data-who]', w).forEach((b) => (b.onclick = () => { F.who = /^\d+$/.test(b.dataset.who) ? Number(b.dataset.who) : b.dataset.who; apply(); }));
        $$('[data-area]', w).forEach((b) => (b.onclick = () => { const id = Number(b.dataset.area); F.areas = F.areas.includes(id) ? F.areas.filter((x) => x !== id) : [...F.areas, id]; apply(); }));
        $$('[data-prio]', w).forEach((b) => (b.onclick = () => { const p = Number(b.dataset.prio); F.prios = F.prios.includes(p) ? F.prios.filter((x) => x !== p) : [...F.prios, p].sort(); apply(); }));
        $$('[data-group]', w).forEach((b) => (b.onclick = () => { F.group = b.dataset.group; apply(); }));
      };
      const apply = () => { saveF(); QUICK = null; $('#f-body', w).innerHTML = draw(); bind(); drawPendientes(true); };
      bind();
    },
  }).then((v) => { if (v === 'clear') { F.who = 'all'; F.areas = []; F.prios = []; F.group = 'prio'; QUICK = null; saveF(); drawPendientes(true); } });
}

// ---------- what you can do to a pendiente ----------
async function patchTask(t, data, msg, after, undoData = null) {
  try {
    await api('PATCH', '/tasks/' + t.id, data);
    touch();
    toast(msg, undoData ? {
      action: { label: 'Deshacer', fn: async () => { try { await api('PATCH', '/tasks/' + t.id, undoData); touch(); toast('Deshecho'); if (after) after(); } catch (e) { toast(e.message, { bad: true }); } } },
    } : {});
    if (after) after();
    return true;
  } catch (e) { toast(e.message, { bad: true }); return false; }
}
const taskLink = (t) => `${location.origin}/#/p/${t.id}`;
function taskMsg(t, hello = '') {
  const due = t.due_date ? `\nPara: ${fmtDay(t.due_date, { weekday: true, rel: false })}` : '';
  return `${hello ? hello + '\n\n' : ''}*${t.title}*\n${t.area_name ? 'Área: ' + t.area_name + '\n' : ''}${t.equipment_name ? 'Equipo: ' + t.equipment_name + '\n' : ''}Prioridad: ${PRIO[t.priority]}${due}${t.description ? '\n\n' + t.description : ''}\n\nFotos y avances: ${taskLink(t)}`;
}

const DONE_WORDS = ['Se reparó', 'Se cambió la pieza', 'Se limpió o ajustó', 'Lo hizo el externo'];
async function completeSheet(t, after) {
  const files = [];
  const res = await sheet({
    title: 'Marcar hecho', sub: t.title,
    body: `<div class="pad">
      <div class="quick" role="group" aria-label="Qué se hizo">${DONE_WORDS.map((r) => `<button type="button" class="qchip" data-r="${esc(r)}">${esc(r)}</button>`).join('')}</div>
      <label class="flabel" for="dn-note">¿Qué se hizo? ${optTxt}</label>
      <textarea class="input" id="dn-note" rows="2" maxlength="4000" placeholder="Ej. Se cambió el empaque y se probó"></textarea>
      <label class="flabel">Foto de cómo quedó ${optTxt}</label>
      ${pickerHtml('dn-pick')}
      <label class="flabel" for="dn-cost">¿Cuánto costó? ${optTxt}</label>
      <div class="money-in"><span>$</span><input class="input" id="dn-cost" type="number" inputmode="decimal" min="0" step="1" value="${t.cost ?? ''}" placeholder="0"></div>
    </div>`,
    acts: [{ label: 'Cancelar', cls: 'plain', value: null }, { label: `${ic('check')}Hecho`, cls: 'ok', value: (w) => ({ note: $('#dn-note', w).value.trim(), cost: $('#dn-cost', w).value }) }],
    onOpen: (w) => {
      bindPicker(w, 'dn-pick', files);
      $$('[data-r]', w).forEach((b) => (b.onclick = () => {
        const nt = $('#dn-note', w);
        nt.value = nt.value ? nt.value.replace(/[.\s]*$/, '. ') + b.dataset.r : b.dataset.r;
        b.classList.add('on');
      }));
    },
  });
  if (!res) return;
  const data = { status: 'hecha' };
  if (res.note) data.note = res.note;
  if (res.cost !== '' && Number(res.cost) !== Number(t.cost || 0)) data.cost = res.cost;
  if (!t.provider_id && myCard()) data.provider_id = myCard();
  try {
    await api('PATCH', '/tasks/' + t.id, data);
    touch();
    if (files.length) await uploadAll(`/tasks/${t.id}/photos`, files);
    toast('Hecho. Bien.', { action: { label: 'Deshacer', fn: async () => { try { await api('PATCH', '/tasks/' + t.id, { status: t.status, wait_reason: t.wait_reason }); touch(); toast('Deshecho'); if (after) after(); } catch (e) { toast(e.message, { bad: true }); } } } });
    if (after) after();
  } catch (e) { toast(e.message, { bad: true }); }
}

const WHY_LATE = ['Falta material', 'Espero al externo', 'No hubo tiempo', 'Depende de otra cosa'];
// Posponer (it has a date) or Poner fecha (it doesn't). A postponed pendiente keeps count and the reason.
async function dateSheet(t, after) {
  const today = todayStr();
  const has = !!t.due_date;
  const late = isLate(t);
  const picks = [...(has && t.due_date >= today ? [] : [[0, 'Hoy']]), [1, 'Mañana'], [3, 'En 3 días'], [7, 'En una semana'], [14, 'En 2 semanas'], [30, 'En un mes']]
    .map(([n, l]) => ({ d: addDays(today, n), l })).filter((p) => p.d !== t.due_date);
  const res = await sheet({
    title: has ? 'Posponer' : 'Poner fecha',
    sub: has ? `${late ? 'Estaba' : 'Está'} para el ${fmtDay(t.due_date, { weekday: true, rel: false })}. ¿Para cuándo queda?` : '¿Para cuándo queda?',
    body: `<div class="pad">
      <div class="dgrid" role="radiogroup" aria-label="Nueva fecha">${picks.map((p) => `<button type="button" role="radio" aria-checked="false" class="dopt" data-d="${p.d}"><b>${p.l}</b><span>${fmtDay(p.d, { weekday: true, rel: false })}</span></button>`).join('')}</div>
      <label class="flabel" for="ds-date">Otra fecha</label>
      <input class="input" type="date" id="ds-date" min="${today}">
      ${has ? `<label class="flabel" for="ds-why">¿Por qué se pospone? ${optTxt}</label>
        <div class="quick" role="group">${WHY_LATE.map((r) => `<button type="button" class="qchip" data-r="${esc(r)}">${esc(r)}</button>`).join('')}</div>
        <input class="input" id="ds-why" maxlength="200" placeholder="Ej. La pieza llega el jueves" autocomplete="off">` : ''}
      <p class="err hidden" id="ds-err" role="alert"></p>
    </div>`,
    acts: [...(has ? [{ label: 'Quitar fecha', cls: 'plain', value: { due: null } }] : [{ label: 'Cancelar', cls: 'plain', value: null }]), {
      label: has ? 'Guardar nueva fecha' : 'Guardar fecha',
      value: (w) => {
        const on = $('.dopt.on', w);
        const due = (on && on.dataset.d) || $('#ds-date', w).value;
        if (!due) { const e = $('#ds-err', w); e.textContent = 'Elige una fecha'; e.classList.remove('hidden'); return undefined; }
        return { due, why: has ? $('#ds-why', w).value.trim() : '' };
      },
    }],
    onOpen: (w) => {
      $$('.dopt', w).forEach((b) => (b.onclick = () => {
        $$('.dopt', w).forEach((x) => { x.classList.remove('on'); x.setAttribute('aria-checked', 'false'); });
        b.classList.add('on'); b.setAttribute('aria-checked', 'true');
        $('#ds-date', w).value = '';
      }));
      $('#ds-date', w).onchange = () => $$('.dopt', w).forEach((x) => { x.classList.remove('on'); x.setAttribute('aria-checked', 'false'); });
      $$('[data-r]', w).forEach((b) => (b.onclick = () => { $('#ds-why', w).value = b.dataset.r; $$('[data-r]', w).forEach((x) => x.classList.toggle('on', x === b)); }));
    },
  });
  if (!res) return;
  if (res.due === null) return patchTask(t, { due_date: null }, 'Quedó sin fecha', after, { due_date: t.due_date });
  const data = { due_date: res.due };
  if (res.why) data.postpone_reason = res.why;
  return patchTask(t, data, has && res.due > t.due_date ? `Pospuesto para ${fmtDay(res.due, { weekday: true })}` : `Queda para ${fmtDay(res.due, { weekday: true })}`, after);
}

// Who does it: me, someone from the house, or an outside provider. Shows each one's load.
async function assignSheet(t, after) {
  if (!C.open) { try { await fetchOpen(); } catch { /* the list still opens, without the counts */ } }
  const load = (id) => (C.open || []).filter((x) => x.provider_id === id).length;
  const me = myCard();
  const list = activeProviders();
  const ints = list.filter((p) => p.kind === 'interno').sort((a, b) => (a.id === me ? -1 : b.id === me ? 1 : a.name.localeCompare(b.name)));
  const exts = list.filter((p) => p.kind === 'externo').sort((a, b) => (a.specialty || 'zz').localeCompare(b.specialty || 'zz') || a.name.localeCompare(b.name));
  const row = (p) => `<button type="button" class="opt ${t.provider_id === p.id ? 'on' : ''}" data-p="${p.id}" data-s="${esc(fold(p.name + ' ' + (p.specialty || '') + ' ' + (p.company || '')))}">
      ${avatar(p.name)}<span class="grow"><span class="ol">${esc(p.name)}${p.id === me ? ' (yo)' : ''}</span>${p.kind === 'externo' || p.specialty ? `<span class="os">${esc([p.specialty || 'Externo', p.company].filter(Boolean).join(', '))}</span>` : ''}</span>
      ${load(p.id) ? `<span class="or">${plural(load(p.id), 'abierto', 'abiertos')}</span>` : ''}<span class="tick">${ic('check')}</span></button>`;
  const res = await sheet({
    title: t.provider_id ? 'Pasar a otro' : '¿Quién lo hace?', sub: t.title,
    body: `${list.length > 7 ? `<div class="pad"><label class="sr" for="as-q">Buscar</label><input class="input" id="as-q" type="search" placeholder="Buscar por nombre u oficio" autocomplete="off"></div>` : ''}
      <div class="opts">
        ${ints.length ? `<div class="ogroup">De la casa</div>${ints.map(row).join('')}` : ''}
        <div class="ogroup">Externos</div>${exts.map(row).join('') || '<p class="onone">Todavía no hay externos. Agrega al plomero, al carpintero, al de refrigeración…</p>'}
        <button type="button" class="opt add" data-new>${`<span class="oi">${ic('plus')}</span>`}<span class="grow"><span class="ol">Agregar un contacto</span><span class="os">Alguien que no está en la lista</span></span></button>
        ${t.provider_id ? `<button type="button" class="opt" data-p=""><span class="oi">${ic('x')}</span><span class="grow"><span class="ol">Dejar sin asignar</span></span></button>` : ''}
      </div>`,
    onOpen: (w, close) => {
      $$('[data-p]', w).forEach((b) => (b.onclick = () => close({ id: b.dataset.p ? Number(b.dataset.p) : null })));
      $('[data-new]', w).onclick = () => close({ add: true });
      const q = $('#as-q', w);
      if (q) q.oninput = () => { const s = fold(q.value.trim()); $$('[data-s]', w).forEach((b) => b.classList.toggle('hidden', !!s && !b.dataset.s.includes(s))); };
    },
  });
  if (!res) return;
  let pid = res.id;
  if (res.add) {
    const c = await contactSheet();
    if (!c) return;
    pid = c.id;
  }
  if (pid === t.provider_id) return;
  const p = pid ? provOf(pid) : null;
  try {
    await api('PATCH', '/tasks/' + t.id, { provider_id: pid });
    touch();
    if (p && p.phone && p.id !== me) {
      toast(`Asignado a ${first(p.name)}`, { ms: 9000, action: { label: 'Avisar por WhatsApp', fn: () => window.open(waHref(p.phone, taskMsg({ ...t, provider_id: pid }, `Hola ${first(p.name)}, te pasaron este pendiente de mantenimiento en Dos Búhos:`)), '_blank') } });
    } else toast(p ? `Asignado a ${first(p.name)}` : 'Quedó sin asignar');
    if (after) after();
  } catch (e) { toast(e.message, { bad: true }); }
}

// A quick new contact from inside another flow. Resolves { id } after saving, or null.
async function contactSheet() {
  const res = await sheet({
    title: 'Nuevo contacto',
    body: `<div class="pad">
      ${fInput('nc-name', 'Nombre', { placeholder: 'Ej. Oscar Ramírez', max: 120, attrs: 'autocapitalize="words" autocomplete="off"' })}
      ${fInput('nc-spec', 'Oficio', { placeholder: 'Ej. Plomería', max: 120, attrs: 'list="nc-trades" autocomplete="off"' })}
      <datalist id="nc-trades">${TRADES.map((x) => `<option value="${x}">`).join('')}</datalist>
      ${fInput('nc-phone', 'WhatsApp', { type: 'tel', placeholder: '10 dígitos', max: 24, attrs: 'inputmode="tel" autocomplete="off"', optional: true })}
      <div class="field"><span class="flabel">¿Es de la casa o de fuera?</span>${choice('nc-kind', [{ v: 'externo', label: 'De fuera' }, { v: 'interno', label: 'De la casa' }], 'externo')}</div>
      <p class="err hidden" id="nc-err" role="alert"></p>
    </div>`,
    acts: [{ label: 'Cancelar', cls: 'plain', value: null }, {
      label: 'Guardar',
      value: (w) => {
        const name = $('#nc-name', w).value.trim();
        if (!name) { const e = $('#nc-err', w); e.textContent = 'Escribe el nombre'; e.classList.remove('hidden'); $('#nc-name', w).focus(); return undefined; }
        return { name, specialty: $('#nc-spec', w).value.trim(), phone: $('#nc-phone', w).value.trim(), kind: $('[data-choice="nc-kind"] .ch.on', w).dataset.v };
      },
    }],
    onOpen: (w) => { bindChoice(w, 'nc-kind'); setTimeout(() => $('#nc-name', w).focus(), 60); },
  });
  if (!res) return null;
  try {
    const r = await api('POST', '/providers', res);
    await loadBoot();
    return { id: r.id };
  } catch (e) { toast(e.message, { bad: true }); return null; }
}

async function prioSheet(t, after) {
  const v = await sheet({ title: 'Prioridad', sub: t.title, opts: [1, 2, 3, 4].map((p) => ({ value: p, label: PRIO[p], sub: PRIO_HINT[p], on: t.priority === p, html: `<span class="pdot p${p}"></span>` })) });
  if (v && v !== t.priority) patchTask(t, { priority: v }, `Prioridad: ${PRIO[v]}`, after, { priority: t.priority });
}
async function areaSheet(t, after) {
  const v = await sheet({
    title: 'Área', sub: t.title,
    opts: [...activeAreas().map((a) => ({ value: a.id, label: a.name, on: t.area_id === a.id, html: `<span class="pdot tagc c-${a.color}"></span>` })), { value: 0, label: 'Sin área', on: !t.area_id }],
  });
  if (v === null || v === (t.area_id || 0)) return;
  patchTask(t, { area_id: v || null }, v ? `Área: ${areaOf(v).name}` : 'Quedó sin área', after, { area_id: t.area_id });
}
async function equipSheet(t, after) {
  const list = S.equipment.filter((e) => e.active);
  const near = list.filter((e) => !t.area_id || e.area_id === t.area_id);
  const rest = list.filter((e) => !near.includes(e));
  const opt = (e, group) => ({ value: e.id, label: e.name, on: t.equipment_id === e.id, group, sub: (areaOf(e.area_id) || {}).name || '' });
  const v = await sheet({
    title: 'Equipo', sub: 'Así queda en el historial del equipo.',
    opts: [...near.map((e) => opt(e, t.area_id && rest.length ? 'De esta área' : '')), ...rest.map((e) => opt(e, 'De otras áreas')), { value: 0, label: 'Ninguno', on: !t.equipment_id, group: list.length ? 'Otro' : '' }],
  });
  if (v === null || v === (t.equipment_id || 0)) return;
  patchTask(t, { equipment_id: v || null }, v ? 'Equipo guardado' : 'Quedó sin equipo', after, { equipment_id: t.equipment_id });
}
async function costSheet(t, after) {
  const res = await sheet({
    title: 'Costo', sub: 'Lo que costó en total: material y mano de obra.',
    body: `<div class="pad"><label class="sr" for="cs-in">Costo</label><div class="money-in"><span>$</span><input class="input" id="cs-in" type="number" inputmode="decimal" min="0" step="1" value="${t.cost ?? ''}" placeholder="0"></div></div>`,
    acts: [{ label: 'Cancelar', cls: 'plain', value: null }, { label: 'Guardar', value: (w) => ({ cost: $('#cs-in', w).value }) }],
    onOpen: (w) => setTimeout(() => $('#cs-in', w).focus(), 60),
  });
  if (res) patchTask(t, { cost: res.cost === '' ? null : res.cost }, 'Costo guardado', after);
}
const NA_WORDS = ['Está repetido', 'No era una falla', 'Ya no se necesita'];
// How long the job should take: what the week planner uses for the size of its block.
async function estSheet(t, after) {
  const opts = [[15, '15 min'], [30, '30 min'], [60, '1 h'], [90, '1 h 30'], [120, '2 h'], [180, '3 h'], [240, 'Medio día', '4 h'], [480, 'Todo el día', '8 h']];
  const v = await sheet({
    title: '¿Cuánto tiempo lleva?', sub: t.title,
    opts: [...opts.map(([m, label, sub]) => ({ value: m, label, sub: sub || '', on: t.est_min === m })), { value: 0, label: 'Sin estimar', on: !t.est_min }],
  });
  if (v === null || v === undefined || (v || null) === (t.est_min || null)) return;
  await patchTask(t, { est_min: v || null }, v ? `Tiempo: ${fmtDur(v)}` : 'Sin tiempo estimado', after, { est_min: t.est_min || null });
}
async function statusSheet(t, after) {
  const cur = t.status === 'en_espera' ? 'en_espera:' + (t.wait_reason || 'proveedor') : t.status;
  const O = [
    ['pendiente', 'Por hacer', 'Todavía nadie empieza', 'tasks'], ['en_proceso', 'En curso', 'Ya alguien está en esto', 'play'],
    ['en_espera:material', 'Esperando material', 'Falta una pieza o un insumo', 'pause'], ['en_espera:proveedor', 'Esperando al externo', 'Lo tiene que venir a hacer alguien de fuera', 'pause'],
    ['hecha', 'Hecho', 'Quedó resuelto', 'check'], ['cancelada', 'No aplica', 'Repetido, no era falla o ya no se necesita', 'x'],
  ];
  const key = await sheet({ title: 'Estado', sub: t.title, opts: O.map(([value, label, sub, icon]) => ({ value, label, sub, icon, on: value === cur })) });
  if (!key || key === cur) return;
  if (key === 'hecha') return completeSheet(t, after);
  const [status, wait] = key.split(':');
  const data = { status };
  if (wait) data.wait_reason = wait;
  if (status === 'en_proceso' && !t.provider_id && myCard()) data.provider_id = myCard();
  if (status === 'cancelada') {
    const why = await sheet({ title: 'No aplica', sub: '¿Por qué?', opts: NA_WORDS.map((r) => ({ value: r, label: r })) });
    if (!why) return;
    data.note = why;
  }
  const label = O.find((o) => o[0] === key)[1];
  patchTask(t, data, label, after, { status: t.status, wait_reason: t.wait_reason });
}
async function editSheet(t, after) {
  const res = await sheet({
    title: 'Editar',
    body: `<div class="pad">${fInput('ed-title', '¿Qué pasa?', { value: t.title, max: 200 })}${fText('ed-desc', 'Detalles', { value: t.description, optional: true, rows: 4 })}<p class="err hidden" id="ed-err" role="alert"></p></div>`,
    acts: [{ label: 'Cancelar', cls: 'plain', value: null }, {
      label: 'Guardar',
      value: (w) => {
        const title = $('#ed-title', w).value.trim();
        if (!title) { const e = $('#ed-err', w); e.textContent = 'Escribe qué pasa'; e.classList.remove('hidden'); return undefined; }
        return { title, description: $('#ed-desc', w).value.trim() };
      },
    }],
  });
  if (res) patchTask(t, res, 'Guardado', after);
}

// ---------- one pendiente ----------
async function viewTask(id, keep = false) {
  UI.view = 'task';
  if (!keep) loading({ tab: 'pendientes' });
  let d;
  try { d = await api('GET', '/tasks/' + id); } catch (e) { return errorView(e.message, { tab: 'pendientes' }); }
  const t = d.task;
  const open = isOpen(t);
  const late = isLate(t);
  const due = dueInfo(t);
  const me = myCard();
  const reload = () => viewTask(id, true);
  const cell = (key, label, value, { cls = '', under = '' } = {}) => `<div class="cell ${cls}"><button type="button" class="cmain" data-set="${key}"><span class="cl">${label}</span><span class="cv">${value}</span>${ic('chev')}</button>${under ? `<div class="cunder">${under}</div>` : ''}</div>`;
  const contact = t.provider_phone && t.provider_id !== me ? `<a class="b line sm" href="${telHref(t.provider_phone)}">${ic('phone')}Llamar</a>
      <a class="b line sm wa" target="_blank" rel="noopener" href="${waHref(t.provider_phone, taskMsg(t, `Hola ${first(t.provider_name)}, sobre este pendiente de mantenimiento en Dos Búhos:`))}">${ic('wa')}WhatsApp</a>` : '';
  const stCls = t.status === 'hecha' ? 'ok' : t.status === 'en_proceso' ? 'go' : t.status === 'en_espera' ? 'wait' : t.status === 'cancelada' ? 'off' : '';
  const notes = d.notes;
  render(header(`Pendiente #${t.id}`, { back: true, right: `<button class="ib" data-menu aria-label="Más opciones">${ic('more')}</button>` }) + `<div class="wrap detail">
    ${late ? `<div class="banner bad" role="status">${ic('alert')}<div class="grow"><b>${esc(due.text)}</b><span>Era para el ${esc(fmtDay(t.due_date, { weekday: true, rel: false }))}.${t.postponed ? ` Pospuesto ${t.postponed === 1 ? '1 vez' : t.postponed + ' veces'}.` : ''}</span></div>
        <button class="b line sm" data-set="who">${t.provider_id ? 'Pasar a otro' : 'Asignar'}</button></div>` : ''}
    <div class="hero">
      <div class="hmeta">${areaTag(t)}${t.kind === 'preventivo' ? `<span class="pill">${ic('repeat')}Preventivo</span>` : t.kind === 'servicio' ? '<span class="pill">Servicio</span>' : ''}${open && t.priority === 1 ? `<b class="urgent">${ic('flag')}Urgente</b>` : ''}</div>
      <h2>${esc(t.title)}</h2>
      <p class="by">${t.created_by_name ? `${t.kind === 'servicio' ? 'Lo anotó' : t.kind === 'preventivo' ? 'Plan de' : 'Lo reportó'} ${esc(t.created_by_name)}` : 'Lo creó el plan preventivo'} ${esc(fmtWhen(t.created_at))}</p>
      ${t.description ? `<p class="desc">${esc(t.description)}</p>` : ''}
    </div>
    <div id="d-photos">${photoGrid(d.photos, 'd-file', { label: 'Agregar foto' })}</div>
    <div class="cells">
      ${cell('status', 'Estado', `<span class="pill big ${stCls}">${esc(statusText(t))}</span>${t.status === 'hecha' && t.completed_at ? `<span class="csub">${esc(fmtDay(localYmd(t.completed_at)))}</span>` : ''}`)}
      ${cell('who', 'Lo hace', t.provider_id ? `${esc(t.provider_name)}${t.provider_kind === 'externo' ? `<span class="csub">${t.provider_specialty ? esc(t.provider_specialty) + ', externo' : 'Externo'}</span>` : ''}` : '<span class="un">Sin asignar</span>', { under: contact })}
      ${open ? cell('due', 'Fecha', due.cls === 'none' ? '<span class="un">Sin fecha</span>' : `<span class="due ${due.cls}">${ic(due.icon)}${esc(due.text)}</span><span class="csub">${esc(fmtDay(t.due_date, { weekday: true, rel: false }))}${t.plan_min !== null && t.plan_min !== undefined ? ` a las ${fmtClock(t.plan_min)}` : ''}${t.postponed ? `, pospuesto ${t.postponed === 1 ? '1 vez' : t.postponed + ' veces'}` : ''}</span>`, { cls: late ? 'late' : '' }) : ''}
      ${open ? cell('est', 'Tiempo', t.est_min ? fmtDur(t.est_min) : '<span class="muted">Sin estimar</span>') : ''}
      ${cell('prio', 'Prioridad', `<span class="pdot p${t.priority}"></span>${PRIO[t.priority]}`)}
      ${cell('area', 'Área', t.area_name ? areaTag(t) : '<span class="un">Sin área</span>')}
      ${cell('equip', 'Equipo', t.equipment_id ? esc(t.equipment_name) : '<span class="muted">Ninguno</span>', { under: t.equipment_id ? `<a class="b line sm" href="#/e/${t.equipment_id}">${ic('wrench')}Ver el equipo</a>` : '' })}
      ${cell('cost', 'Costo', t.cost ? money(t.cost) : '<span class="muted">Sin anotar</span>')}
    </div>
    <h2 class="sec">Notas e historial</h2>
    <ul class="timeline">${notes.map((nt) => nt.kind === 'sistema'
      ? `<li class="sys"><span class="tdot"></span><p class="grow">${esc(nt.body)}</p><span class="tt">${esc(fmtDateTime(nt.created_at))}</span></li>`
      : `<li class="note" data-note="${nt.id}">${avatar(nt.user_name || '?')}<div class="nb"><p class="nh"><b>${esc(nt.user_name || 'Alguien')}</b> <span class="tt">${esc(fmtDateTime(nt.created_at))}</span>
          ${(isAdmin() || nt.user_id === S.user.id) ? `<button class="linkbtn del" data-delnote="${nt.id}">Borrar</button>` : ''}</p><p class="nt">${esc(nt.body)}</p></div></li>`).join('')}</ul>
    <div class="composer"><label class="sr" for="d-note">Escribe una nota</label><textarea class="input" id="d-note" rows="1" placeholder="Escribe una nota" maxlength="4000"></textarea>
      <button class="ib send" id="d-send" aria-label="Guardar nota" disabled>${ic('send')}</button></div>
  </div>`, {
    tab: 'pendientes', keepScroll: keep,
    bar: open
      ? `<button class="b tonal" data-set="due">${ic('clock')}${t.due_date ? 'Posponer' : 'Poner fecha'}</button><button class="b ok grow" data-finish>${ic('check')}Hecho</button>`
      : `<button class="b tonal grow" data-reopen>${ic('undo')}Volver a abrir</button>`,
  });
  const acts = { status: statusSheet, who: assignSheet, due: dateSheet, est: estSheet, prio: prioSheet, area: areaSheet, equip: equipSheet, cost: costSheet };
  $$('[data-set]', APP).forEach((b) => (b.onclick = () => acts[b.dataset.set](t, reload)));
  const fin = $('[data-finish]');
  if (fin) fin.onclick = () => completeSheet(t, reload);
  const ro = $('[data-reopen]');
  if (ro) ro.onclick = () => patchTask(t, { status: 'pendiente' }, 'Abierto otra vez', reload, { status: t.status });
  bindPhotoGrid(APP, 'd-file', `/tasks/${id}/photos`, reload);
  const note = $('#d-note');
  const send = $('#d-send');
  note.oninput = () => {
    send.disabled = !note.value.trim();
    note.style.height = 'auto';
    note.style.height = Math.min(160, note.scrollHeight + 2) + 'px';
  };
  send.onclick = async () => {
    const v = note.value.trim();
    if (!v) return;
    send.disabled = true;
    try { await api('POST', `/tasks/${id}/notes`, { body: v }); touch(); toast('Nota guardada'); reload(); } catch (e) { toast(e.message, { bad: true }); send.disabled = false; }
  };
  $$('[data-delnote]').forEach((b) => (b.onclick = () => {
    const li = b.closest('li');
    later('Nota borrada', () => api('DELETE', '/notes/' + b.dataset.delnote), { hide: () => li.classList.add('hidden'), undo: () => li.classList.remove('hidden') });
  }));
  $('[data-menu]').onclick = async () => {
    const opts = [{ value: 'edit', label: 'Editar título y detalles', icon: 'edit' }, { value: 'share', label: 'Compartir por WhatsApp', icon: 'wa' }];
    if (open) opts.push({ value: 'na', label: 'No aplica', sub: 'Repetido, no era falla o ya no se necesita', icon: 'x' });
    if (isAdmin()) opts.push({ value: 'delete', label: 'Eliminar', sub: 'Se borran sus fotos y notas', icon: 'trash', cls: 'danger' });
    const v = await sheet({ title: `Pendiente #${t.id}`, opts });
    if (v === 'edit') editSheet(t, reload);
    else if (v === 'share') window.open(`https://wa.me/?text=${encodeURIComponent(taskMsg(t))}`, '_blank');
    else if (v === 'na') {
      const why = await sheet({ title: 'No aplica', sub: '¿Por qué?', opts: NA_WORDS.map((r) => ({ value: r, label: r })) });
      if (why) patchTask(t, { status: 'cancelada', note: why }, 'No aplica', reload, { status: t.status, wait_reason: t.wait_reason });
    } else if (v === 'delete') {
      if (await confirmSheet('¿Eliminar este pendiente?', 'Se borran también sus fotos y notas. No se puede deshacer.', 'Eliminar', true)) {
        try { await api('DELETE', '/tasks/' + id); touch(); toast('Eliminado'); goBack('#/'); } catch (e) { toast(e.message, { bad: true }); }
      }
    }
  };
  UI.refresh = reload;
}

// ---------- reporting ----------
async function viewReport(query = {}) {
  UI.view = 'report';
  const eq = query.equipo ? S.equipment.find((e) => e.id === Number(query.equipo)) : null;
  const files = [];
  let area = eq ? eq.area_id : '';
  render(header(eq ? 'Reportar falla' : 'Reportar', { back: true }) + `<form class="wrap form" id="r-form" novalidate>
    <div class="field"><span class="flabel">Foto ${optTxt}</span>${pickerHtml('r-pick')}</div>
    <div class="field"><label class="flabel" for="r-title">¿Qué pasa?</label>
      <input class="input big" id="r-title" type="text" maxlength="200" placeholder="Ej. Gotea la llave del baño de visitas" autocomplete="off" enterkeyhint="done"></div>
    ${eq ? `<div class="field"><span class="flabel">Equipo</span><p class="fixed">${ic('wrench')}${esc(eq.name)}</p></div>` : ''}
    <div class="field"><span class="flabel">¿Dónde?</span>${areaChoice(area, 'r-area')}</div>
    <div class="field"><span class="flabel">¿Qué tan urgente?</span>
      ${choice('r-prio', [{ v: 1, label: 'Urgente', sub: 'Peligro, fuga o detiene el servicio', cls: 'urg' }, { v: 3, label: 'Normal', sub: 'Esta semana' }, { v: 4, label: 'Puede esperar', sub: 'Cuando se pueda' }], 3, { cls: 'stack' })}</div>
    <details class="more"><summary>Más detalles ${optTxt}${ic('down')}</summary>
      ${fText('r-desc', 'Detalles', { placeholder: 'Lo que ayude a quien lo va a arreglar', rows: 3 })}
      ${eq ? '' : fSelect('r-equip', 'Equipo', equipmentOptions(area, ''))}
      ${fSelect('r-who', '¿Quién lo hace?', contactOptions('', unassignedLabel()))}
      ${fInput('r-due', 'Fecha', { type: 'date', attrs: `min="${todayStr()}"`, hint: 'Si la dejas en blanco: urgente es para hoy y normal para dentro de una semana.' })}
    </details>
    <p class="err hidden" id="r-err" role="alert"></p>
  </form>`, { tab: 'nuevo', bar: `<button class="b block lg" id="r-send" form="r-form" type="submit">${ic('send')}Enviar reporte</button>` });
  bindPicker(APP, 'r-pick', files);
  const getArea = bindChoice(APP, 'r-area', (v) => {
    area = v;
    const sel = $('#r-equip');
    if (sel) sel.innerHTML = equipmentOptions(v, sel.value);
  });
  const getPrio = bindChoice(APP, 'r-prio');
  const err = $('#r-err');
  $('#r-title').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } };
  $('#r-form').onsubmit = async (e) => {
    e.preventDefault();
    clearErrs(APP);
    const title = $('#r-title').value.trim();
    if (!title) return fieldErr($('#r-title'), 'Escribe qué pasa');
    const equipId = eq ? eq.id : ($('#r-equip').value || null);
    if (!getArea() && !equipId) return fieldErr($('[data-choice="r-area"]'), 'Elige dónde está el problema');
    const data = { title, area_id: getArea() || null, priority: Number(getPrio() || 3), description: $('#r-desc').value, equipment_id: equipId, provider_id: $('#r-who').value || null };
    if ($('#r-due').value) data.due_date = $('#r-due').value;
    const btn = $('#r-send');
    btn.disabled = true; btn.innerHTML = 'Enviando…';
    err.classList.add('hidden');
    try {
      const r = await api('POST', '/tasks', data);
      touch();
      if (files.length) await uploadAll(`/tasks/${r.task.id}/photos`, files);
      UI.sent = r.task;
      location.replace('#/enviado/' + r.task.id);
    } catch (ex) {
      btn.disabled = false; btn.innerHTML = `${ic('send')}Enviar reporte`;
      err.textContent = ex.message.startsWith('Sin señal') ? 'Sin señal. Tu reporte sigue aquí: vuelve a tocar Enviar cuando tengas internet.' : ex.message;
      err.classList.remove('hidden');
      err.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  };
}

async function viewReported(id) {
  UI.view = 'sent';
  let t = UI.sent && UI.sent.id === Number(id) ? UI.sent : null;
  if (!t) { try { t = (await api('GET', '/tasks/' + id)).task; } catch { location.replace('#/'); return; } }
  const co = S.settings.coordinator ? provOf(S.settings.coordinator) : null;
  const tell = co && co.phone && co.id !== myCard() && !t.provider_id;
  render(`<div class="wrap sent">
    <div class="okmark">${ic('check')}</div>
    <h1>Reporte enviado</h1>
    <p class="lead">${esc(t.title)}</p>
    <p class="small">Es el pendiente #${t.id}. ${t.due_date ? `Quedó ${esc(dueInfo(t).text.toLowerCase())}.` : 'Quedó sin fecha.'} ${t.provider_id ? `Lo tiene ${esc(first(t.provider_name))}.` : 'Falta asignarlo.'}</p>
    ${tell ? `<a class="b block lg wa" target="_blank" rel="noopener" href="${waHref(co.phone, taskMsg(t, `Hola ${first(co.name)}, reporté esto en Mantenimiento:`))}">${ic('wa')}Avisar a ${esc(first(co.name))} por WhatsApp</a>` : ''}
    <a class="b block lg ${tell ? 'tonal' : ''}" href="#/p/${t.id}">Ver el reporte</a>
    <a class="b block lg tonal" href="#/nuevo">${ic('plus')}Reportar otro</a>
    <a class="b block lg plain" href="#/">Ir a Pendientes</a>
  </div>`, { tab: 'nuevo' });
}

// ---------- done ----------
async function viewDone(query = {}) {
  UI.view = 'done';
  const q = (query.q || '').trim();
  loading({ tab: 'pendientes' });
  let r;
  try { r = await api('GET', `/tasks?view=done&limit=40${q ? '&q=' + encodeURIComponent(q) : ''}`); } catch (e) { return errorView(e.message, { tab: 'pendientes' }); }
  let list = r.tasks;
  let more = r.more;
  const draw = () => {
    render(header('Lo que ya se hizo', { back: true }) + `<div class="wrap">
      <form class="searchbar" id="dn-form" role="search">${ic('search')}<label class="sr" for="dn-q">Buscar</label><input id="dn-q" type="search" value="${esc(q)}" placeholder="Buscar en lo hecho" autocomplete="off" enterkeyhint="search"></form>
      ${list.length ? `<div class="list">${list.map((t) => taskRow(t)).join('')}</div>${more ? '<button class="b tonal block" id="dn-more">Ver más</button>' : ''}`
        : `<div class="empty"><h2>${q ? 'Nada con esa búsqueda' : 'Todavía no hay nada hecho'}</h2><p>${q ? 'Prueba con otra palabra.' : 'Lo que se marque como hecho aparece aquí.'}</p></div>`}
    </div>`, { tab: 'pendientes', keepScroll: list.length > 40 });
    $('#dn-form').onsubmit = (e) => { e.preventDefault(); const v = $('#dn-q').value.trim(); location.replace('#/hechos' + (v ? '?q=' + encodeURIComponent(v) : '')); };
    const m = $('#dn-more');
    if (m) m.onclick = async () => {
      m.disabled = true;
      try { const n = await api('GET', `/tasks?view=done&limit=40&offset=${list.length}${q ? '&q=' + encodeURIComponent(q) : ''}`); list = list.concat(n.tasks); more = n.more; draw(); } catch (e) { toast(e.message, { bad: true }); m.disabled = false; }
    };
  };
  draw();
}

// ---------- search ----------
async function viewSearch(query = {}) {
  UI.view = 'search';
  const q = (query.q || '').trim();
  render(header('Buscar', { back: true }) + `<div class="wrap">
    <form class="searchbar" id="s-form" role="search">${ic('search')}<label class="sr" for="s-q">Buscar</label><input id="s-q" type="search" value="${esc(q)}" placeholder="Pendientes, equipos, contactos" autocomplete="off" enterkeyhint="search"></form>
    <div id="s-res">${q ? `<div class="skel">${'<i></i>'.repeat(3)}</div>` : '<p class="small center">Escribe una palabra o el número del pendiente.</p>'}</div></div>`, { tab: 'pendientes' });
  const inp = $('#s-q');
  if (!q) inp.focus();
  const go = (v) => location.replace('#/buscar' + (v ? '?q=' + encodeURIComponent(v) : ''));
  $('#s-form').onsubmit = (e) => { e.preventDefault(); go(inp.value.trim()); inp.blur(); };
  inp.oninput = debounce(() => { if (inp.value.trim().length >= 2 || !inp.value.trim()) run(inp.value.trim()); }, 350);
  async function run(v) {
    const box = $('#s-res');
    if (!box) return;
    if (!v) { box.innerHTML = '<p class="small center">Escribe una palabra o el número del pendiente.</p>'; return; }
    let r;
    try { r = await api('GET', '/search?q=' + encodeURIComponent(v)); } catch (e) { box.innerHTML = `<div class="empty"><p>${esc(e.message)}</p></div>`; return; }
    if (!$('#s-res') || inp.value.trim() !== v) return;
    const none = !r.tasks.length && !r.equipment.length && !r.providers.length;
    box.innerHTML = none ? `<div class="empty"><h2>Nada con «${esc(v)}»</h2><p>Prueba con otra palabra.</p></div>` : `
      ${r.tasks.length ? `<h2 class="sec">Pendientes<span class="n">${r.tasks.length}</span></h2><div class="list">${r.tasks.map((t) => taskRow(t, { done: false })).join('')}</div>` : ''}
      ${r.equipment.length ? `<h2 class="sec">Equipos<span class="n">${r.equipment.length}</span></h2><div class="list">${r.equipment.map((e) => `<a class="lrow" href="#/e/${e.id}">${e.cover_id ? `<img class="lth" loading="lazy" src="/api/photos/${e.cover_id}?t=1" alt="">` : `<span class="lth ph0">${ic('wrench')}</span>`}<span class="grow"><b>${esc(e.name)}</b><span class="ls">${esc([e.brand_model, e.area_name].filter(Boolean).join(', '))}</span></span>${ic('chev')}</a>`).join('')}</div>` : ''}
      ${r.providers.length ? `<h2 class="sec">Contactos<span class="n">${r.providers.length}</span></h2><div class="list">${r.providers.map((p) => `<a class="lrow" href="#/c/${p.id}">${avatar(p.name)}<span class="grow"><b>${esc(p.name)}</b><span class="ls">${esc(p.kind === 'externo' ? (p.specialty || 'Externo') : 'De la casa')}</span></span>${ic('chev')}</a>`).join('')}</div>` : ''}`;
  }
  if (q) run(q);
}
