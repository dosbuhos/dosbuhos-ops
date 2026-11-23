/* Mantenimiento Dos Búhos — the week planner (wide screens). The lists on the left, the week on the right:
   drag a pendiente onto a day and an hour to plan it, drag it again to move it, pull its lower edge to say how long
   it takes, drop it back on the list to take its date away. It works the way Horizonte does. Needs core.js and app.js. */
const WK = { start: null, who: 'all', q: '' };          // Monday of the week shown, whose week, search text
const HOUR_H = 46;                                      // px per hour
const DAY_START = 6 * 60, DAY_END = 20 * 60, SNAP = 15; // the grid runs 6:00–20:00 in 15-minute steps
const mondayOf = (ymd) => addDays(ymd, -((ymdDate(ymd).getDay() + 6) % 7));
const durOf = (t) => Math.max(15, t.est_min || 60);
const snap = (m) => Math.round(m / SNAP) * SNAP;
const wkDesk = () => matchMedia('(min-width: 960px)').matches;
matchMedia('(min-width: 960px)').addEventListener('change', () => { if (UI.view === 'semana' && S.user) drawWeek(true); });

async function viewWeek(query = {}, keep = false) {
  UI.view = 'semana';
  if (!WK.start) WK.start = mondayOf(todayStr());
  if (!C.open || !keep) {
    if (!C.open) loading({ tab: 'semana' });
    try { await fetchOpen(); } catch (e) { return errorView(e.message, { tab: 'semana' }); }
  }
  drawWeek();
  UI.refresh = () => fetchOpen().then(() => { if (UI.view === 'semana' && !wdrag) drawWeek(true); }).catch(() => {});
}

// Blocks that overlap share the column side by side.
function layoutDay(items) {
  items.sort((a, b) => a.s - b.s || b.e - a.e);
  const out = [];
  let cluster = [];
  let end = -1;
  const flush = () => { const n = Math.max(...cluster.map((x) => x.col)) + 1; cluster.forEach((x) => { x.n = n; out.push(x); }); cluster = []; end = -1; };
  for (const it of items) {
    if (cluster.length && it.s >= end) flush();
    const used = cluster.filter((x) => x.e > it.s).map((x) => x.col);
    let c = 0;
    while (used.includes(c)) c++;
    it.col = c; cluster.push(it); end = Math.max(end, it.e);
  }
  if (cluster.length) flush();
  return out;
}

function drawWeek(keepScroll = false) {
  const today = todayStr();
  const days = Array.from({ length: 7 }, (_, i) => addDays(WK.start, i));
  const last = days[6];
  const all = C.open || [];
  if (typeof WK.who === 'number' && !provOf(WK.who)) WK.who = 'all';
  const inWho = (t) => WK.who === 'all' || t.provider_id === WK.who;
  const week = all.filter((t) => inWho(t) && t.due_date && t.due_date >= WK.start && t.due_date <= last);
  // Left: what still needs a day. No date, or a date that passed before this week (a late one inside the week
  // stays on its day, in red, and is dragged from there). With one person chosen, unassigned work is offered too.
  const s = fold(WK.q.trim());
  const todo = all.filter((t) => (WK.who === 'all' || !t.provider_id || t.provider_id === WK.who)
    && (!t.due_date || (t.due_date < today && t.due_date < WK.start))
    && (!s || fold([t.title, t.area_name, t.provider_name, t.equipment_name].join(' ')).includes(s)));
  const people = [...new Set(all.map((t) => t.provider_id).filter(Boolean))].map(provOf).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));

  const card = (t) => {
    const due = dueInfo(t);
    return `<a class="wcard ${isLate(t) ? 'late' : ''}" href="#/p/${t.id}" data-tid="${t.id}" draggable="false">
      <span class="wt">${esc(t.title)}</span>
      <span class="rm">${areaTag(t)}${t.due_date ? `<span class="due ${due.cls}">${esc(due.text)}</span>` : ''}${t.provider_id ? `<span class="who">${ic('user')}${esc(first(t.provider_name))}</span>` : '<span class="who un">Sin asignar</span>'}</span>
      <button type="button" class="west ${t.est_min ? 'on' : ''}" data-est="${t.id}" aria-label="Tiempo estimado">${ic('clock')}${t.est_min ? fmtDur(t.est_min) : 'Tiempo'}</button></a>`;
  };
  const groups = [1, 2, 3, 4].map((p) => ({ p, items: todo.filter((t) => t.priority === p).sort(byLate) })).filter((g) => g.items.length);
  const list = groups.length
    ? groups.map((g) => `<h2 class="sec ${g.p === 1 ? 'bad' : g.p === 2 ? 'warn' : ''}">${PRIO[g.p]}<span class="n">${g.items.length}</span></h2><div class="wlist">${g.items.map(card).join('')}</div>`).join('')
    : `<p class="wnone">${s ? 'Nada con esa búsqueda.' : all.length ? 'Todo lo abierto ya tiene día.' : 'No hay pendientes.'}</p>`;

  const tot = (d) => week.filter((t) => t.due_date === d).reduce((n, t) => n + (t.est_min || (t.plan_min !== null && t.plan_min !== undefined ? 60 : 0)), 0);
  const head = days.map((d) => {
    const dt = ymdDate(d);
    return `<div class="wd ${d === today ? 'today' : ''} ${d < today ? 'past' : ''}"><span>${DIAS[dt.getDay()].slice(0, 3)}</span><b>${dt.getDate()}</b>${tot(d) ? `<i>${fmtDur(tot(d))}</i>` : ''}</div>`;
  }).join('');
  const chip = (t) => `<a class="wchip c-${esc(t.area_color || 'grey')} ${isLate(t) ? 'late' : ''} ${t.priority === 1 ? 'urg' : ''}" href="#/p/${t.id}" data-tid="${t.id}" draggable="false" title="${esc(t.title)}"><b>${esc(t.title)}</b>${t.est_min ? `<span>${fmtDur(t.est_min)}</span>` : ''}</a>`;
  const allday = days.map((d) => `<div class="wad" data-day="${d}">${week.filter((t) => t.due_date === d && (t.plan_min === null || t.plan_min === undefined)).sort(bySort).map(chip).join('')}</div>`).join('');
  const hours = [];
  for (let m = DAY_START; m < DAY_END; m += 60) hours.push(`<span style="top:${((m - DAY_START) / 60) * HOUR_H}px">${m / 60}:00</span>`);
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const cols = days.map((d) => {
    const items = layoutDay(week.filter((t) => t.due_date === d && t.plan_min !== null && t.plan_min !== undefined).map((t) => {
      const st = Math.min(Math.max(t.plan_min, DAY_START), DAY_END - 15);
      return { t, s: st, e: Math.min(st + durOf(t), DAY_END) };
    }));
    return `<div class="wcol ${d === today ? 'today' : ''} ${d < today ? 'past' : ''}" data-day="${d}">
      ${items.map(({ t, s: st, e, col, n }) => `<a class="wblk c-${esc(t.area_color || 'grey')} ${isLate(t) ? 'late' : ''} ${e - st <= 30 ? 'short' : ''}" href="#/p/${t.id}" data-tid="${t.id}" draggable="false" title="${esc(t.title)}"
          style="top:${((st - DAY_START) / 60) * HOUR_H}px;height:${((e - st) / 60) * HOUR_H - 2}px;left:calc(${(col / n) * 100}% + 2px);width:calc(${100 / n}% - 4px)">
          <b>${t.priority === 1 ? ic('flag') : ''}${esc(t.title)}</b><span>${fmtClock(st)} a ${fmtClock(e)}${WK.who === 'all' && t.provider_id ? ', ' + esc(first(t.provider_name)) : ''}</span><i class="wrz" data-rz></i></a>`).join('')}
      ${d === today && nowMin >= DAY_START && nowMin <= DAY_END ? `<div class="wnow" style="top:${((nowMin - DAY_START) / 60) * HOUR_H}px"></div>` : ''}</div>`;
  }).join('');
  const a = ymdDate(WK.start), b = ymdDate(last);
  const label = a.getMonth() === b.getMonth() ? `${a.getDate()} al ${b.getDate()} de ${MESES_L[b.getMonth()]}` : `${a.getDate()} de ${MESES[a.getMonth()]} al ${b.getDate()} de ${MESES[b.getMonth()]}`;
  if (!wkDesk()) {   // phones: the week as one column of days; a held pendiente is dropped on a day panel
    const mrow = (t) => `<a class="wrow ${isLate(t) ? 'late' : ''}" href="#/p/${t.id}" data-tid="${t.id}" draggable="false">
      <span class="wtime">${t.plan_min !== null && t.plan_min !== undefined && t.due_date ? fmtClock(t.plan_min) : ''}</span>
      <span class="grow"><b>${esc(t.title)}</b><span class="rm">${areaTag(t)}${isLate(t) ? `<span class="due late">${esc(dueInfo(t).text)}</span>` : ''}${t.provider_id ? `<span class="who">${ic('user')}${esc(first(t.provider_name))}</span>` : '<span class="who un">Sin asignar</span>'}${t.est_min ? `<span class="st">${ic('clock')}${fmtDur(t.est_min)}</span>` : ''}</span></span>${ic('chev')}</a>`;
    const secs = days.map((d) => {
      const dt = ymdDate(d);
      const items = week.filter((t) => t.due_date === d).sort((x, y) => (x.plan_min === null || x.plan_min === undefined ? -1 : x.plan_min) - (y.plan_min === null || y.plan_min === undefined ? -1 : y.plan_min) || x.priority - y.priority);
      return `<section class="wday ${d < today ? 'past' : ''}"><h2 class="sec">${cap(DIAS[dt.getDay()])} ${dt.getDate()}${d === today ? '<span class="now">Hoy</span>' : ''}${tot(d) ? `<span class="n">${fmtDur(tot(d))}</span>` : ''}</h2>
        ${items.length ? `<div class="list">${items.map(mrow).join('')}</div>` : '<p class="wk-nada">Nada</p>'}</section>`;
    }).join('');
    render(header('Semana', { right: `<button type="button" class="ib line" data-wk="-7" aria-label="Semana anterior">${ic('back')}</button><button type="button" class="b tonal sm" data-wk="0">Hoy</button><button type="button" class="ib line" data-wk="7" aria-label="Semana siguiente">${ic('chev')}</button>` }) + `<div class="wrap wk-m">
      <div class="subhead"><p>${label}</p></div>
      <label class="sr" for="wk-who">De quién</label><select class="input" id="wk-who"><option value="all">La semana de todos</option>${people.map((p) => `<option value="${p.id}" ${WK.who === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
      <p class="wk-hint">Mantén presionado un pendiente y suéltalo en el día y la hora en que se va a hacer.</p>
      ${secs}
      <h2 class="sec">Por programar<span class="n">${todo.length}</span></h2>
      ${todo.length ? `<div class="list">${todo.sort(bySort).map(mrow).join('')}</div>` : '<p class="wk-nada">Todo lo abierto ya tiene día.</p>'}
    </div>`, { tab: 'semana', keepScroll });
    $('#wk-who').onchange = (e) => { WK.who = e.target.value === 'all' ? 'all' : Number(e.target.value); drawWeek(true); };
    $$('[data-wk]').forEach((x) => (x.onclick = () => { const n = Number(x.dataset.wk); WK.start = n ? addDays(WK.start, n) : mondayOf(todayStr()); drawWeek(true); }));
    return;
  }
  const grid = $('.wk-grid');
  const gy = grid ? grid.scrollTop : null;
  const ly = $('.wk-list') ? $('.wk-list').scrollTop : 0;
  render(`<div class="wkp">
    <header class="wk-top"><h1>Semana</h1><p class="wk-label">${label}</p>
      <div class="wk-tools">
        <label class="sr" for="wk-who">De quién</label><select class="input" id="wk-who"><option value="all">La semana de todos</option>${people.map((p) => `<option value="${p.id}" ${WK.who === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
        <button type="button" class="ib line" data-wk="-7" aria-label="Semana anterior">${ic('back')}</button>
        <button type="button" class="b tonal sm" data-wk="0">Hoy</button>
        <button type="button" class="ib line" data-wk="7" aria-label="Semana siguiente">${ic('chev')}</button>
      </div></header>
    <div class="wk-body">
      <aside class="wk-list" aria-label="Por programar">
        <div class="searchbar">${ic('search')}<label class="sr" for="wk-q">Buscar</label><input id="wk-q" type="search" placeholder="Buscar un pendiente" value="${esc(WK.q)}" autocomplete="off"></div>
        <p class="wk-hint">Arrastra un pendiente al día y la hora en que se va a hacer.</p>
        <div id="wk-items">${list}</div>
      </aside>
      <section class="wk-cal" aria-label="Semana">
        <div class="wk-head"><div></div>${head}</div>
        <div class="wk-all"><div class="wlab">Sin hora</div>${allday}</div>
        <div class="wk-grid"><div class="wk-in" style="height:${((DAY_END - DAY_START) / 60) * HOUR_H}px"><div class="wk-hours">${hours.join('')}</div>${cols}</div></div>
      </section>
    </div>
  </div>`, { tab: 'semana', keepScroll });
  const g2 = $('.wk-grid');
  if (g2) g2.scrollTop = gy !== null ? gy : Math.max(0, ((Math.min(Math.max(nowMin, 8 * 60), 14 * 60) - DAY_START - 120) / 60) * HOUR_H);
  if ($('.wk-list')) $('.wk-list').scrollTop = ly;
  $('#wk-who').onchange = (e) => { WK.who = e.target.value === 'all' ? 'all' : Number(e.target.value); drawWeek(true); };
  $$('[data-wk]').forEach((x) => (x.onclick = () => { const n = Number(x.dataset.wk); WK.start = n ? addDays(WK.start, n) : mondayOf(todayStr()); drawWeek(true); }));
  const q = $('#wk-q');
  q.oninput = debounce(() => { WK.q = q.value; const pos = q.selectionStart; drawWeek(true); const q2 = $('#wk-q'); q2.focus(); q2.setSelectionRange(pos, pos); }, 200);
  $$('[data-est]').forEach((x) => (x.onclick = (e) => {
    e.preventDefault(); e.stopPropagation();
    const t = all.find((y) => y.id === Number(x.dataset.est));
    if (t) estSheet(t, () => fetchOpen().then(() => drawWeek(true)));
  }));
}

// ---------- dragging (pointer events, like Horizonte: press and move 5px) ----------
let wdrag = null;
let wkNoClick = false;
function wkClean() {
  $$('.wghost, .wprev').forEach((x) => x.remove());
  $$('.wad.over, .wk-list.over').forEach((x) => x.classList.remove('over'));
  document.body.classList.remove('wdragging');
}
async function wkSave(t, data, msg) {
  const before = { due_date: t.due_date, plan_min: t.plan_min, est_min: t.est_min, provider_id: t.provider_id, provider_name: t.provider_name };
  Object.assign(t, data);                                   // show it at once
  if (data.due_date === null) t.plan_min = null;
  drawWeek(true);
  try {
    const r = await api('PATCH', '/tasks/' + t.id, data);
    Object.assign(t, r.task);
    UI.lateN = (C.open || []).filter(isLate).length;
    drawWeek(true);
    if (msg) toast(msg);
  } catch (e) { Object.assign(t, before); drawWeek(true); toast(e.message, { bad: true }); }
}
document.addEventListener('pointerdown', (e) => {
  if (UI.view !== 'semana' || e.pointerType !== 'mouse' || e.button !== 0 || document.body.classList.contains('lock')) return;
  const el = e.target.closest('.wkp [data-tid]');
  if (!el || e.target.closest('[data-est]')) return;
  const t = (C.open || []).find((x) => x.id === Number(el.dataset.tid));
  if (!t) return;
  const r = el.getBoundingClientRect();
  wdrag = { t, el, x: e.clientX, y: e.clientY, pid: e.pointerId, on: false, rz: !!e.target.closest('[data-rz]'), grab: el.classList.contains('wblk') ? ((e.clientY - r.top) / HOUR_H) * 60 : 0, target: null, dur: durOf(t) };
});
document.addEventListener('pointermove', (e) => {
  const d = wdrag;
  if (!d || e.pointerId !== d.pid) return;
  if (!d.on) {
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 5) return;
    d.on = true;
    document.body.classList.add('wdragging');
    if (!d.rz) {
      const g = d.el.cloneNode(true);
      g.classList.add('wghost'); g.removeAttribute('href'); g.removeAttribute('style');
      g.style.width = Math.min(d.el.getBoundingClientRect().width, 260) + 'px';
      document.body.appendChild(g); d.ghost = g; d.el.classList.add('lift');
    }
  }
  e.preventDefault();
  if (d.rz) {   // pulling the lower edge: how long it takes
    const st = Math.min(Math.max(d.t.plan_min, DAY_START), DAY_END - 15);
    d.dur = Math.min(Math.max(15, snap(durOf(d.t) + ((e.clientY - d.y) / HOUR_H) * 60)), DAY_END - st);
    d.el.style.height = (d.dur / 60) * HOUR_H - 2 + 'px';
    const sp = $('span', d.el);
    if (sp) sp.textContent = `${fmtClock(st)} a ${fmtClock(st + d.dur)}`;
    return;
  }
  d.ghost.style.transform = `translate(${e.clientX + 10}px, ${e.clientY + 8}px)`;
  $$('.wprev').forEach((x) => x.remove());
  $$('.wad.over, .wk-list.over').forEach((x) => x.classList.remove('over'));
  const under = document.elementFromPoint(e.clientX, e.clientY);
  const col = under && under.closest('.wcol');
  const ad = under && under.closest('.wad');
  const lp = under && under.closest('.wk-list');
  d.target = null;
  if (col) {
    const r = col.getBoundingClientRect();
    const min = Math.min(Math.max(snap(DAY_START + ((e.clientY - r.top) / HOUR_H) * 60 - d.grab), DAY_START), DAY_END - Math.min(d.dur, DAY_END - DAY_START));
    d.target = { day: col.dataset.day, min };
    col.insertAdjacentHTML('beforeend', `<div class="wprev" style="top:${((min - DAY_START) / 60) * HOUR_H}px;height:${(Math.min(d.dur, DAY_END - min) / 60) * HOUR_H - 2}px"><span>${fmtClock(min)}</span></div>`);
  } else if (ad) { ad.classList.add('over'); d.target = { day: ad.dataset.day, min: null }; }
  else if (lp && d.t.due_date) { lp.classList.add('over'); d.target = { un: true }; }
});
document.addEventListener('pointerup', (e) => {
  const d = wdrag;
  if (!d) return;
  wdrag = null;
  if (!d.on) return;                                        // a plain click: the link opens the pendiente
  wkNoClick = true; setTimeout(() => { wkNoClick = false; }, 0);
  wkClean(); d.el.classList.remove('lift');
  const t = d.t;
  if (d.rz) { if (d.dur !== durOf(t) || !t.est_min) wkSave(t, { est_min: d.dur }); else drawWeek(true); return; }
  const tg = d.target;
  if (!tg) return;
  if (tg.un) return wkSave(t, { due_date: null }, 'Quedó sin fecha');
  if (tg.day === t.due_date && tg.min === (t.plan_min === undefined ? null : t.plan_min)) return;
  const data = { due_date: tg.day, plan_min: tg.min, replan: 1 };
  if (tg.min !== null && !t.est_min) data.est_min = 60;     // an hour until someone says otherwise
  let msg = '';
  if (typeof WK.who === 'number' && !t.provider_id) { data.provider_id = WK.who; msg = `Asignado a ${first((provOf(WK.who) || {}).name)}`; }
  wkSave(t, data, msg);
});
document.addEventListener('pointercancel', () => { if (wdrag) { if (wdrag.on) { wkClean(); drawWeek(true); } wdrag = null; } });
// the click that ends a drag must not open the pendiente
document.addEventListener('click', (e) => { if (wkNoClick && e.target.closest('[data-tid], .row[data-id]')) { e.preventDefault(); e.stopPropagation(); } }, true);
document.addEventListener('dragstart', (e) => { if (e.target.closest && e.target.closest('.wkp')) e.preventDefault(); });

// ---------- touch: hold a pendiente, then drop it on a day (the way Horizonte does on a phone) ----------
// Hold 350 ms on a pendiente in any list. A panel with one day slides in: drop on an hour, on "sin hora" or on
// "quitar la fecha"; take the finger to the left or right edge to change the day.
const MHPX = 52;
let hold = null;
let tdrag = null;
const dayTxt = (d) => { const x = fmtDay(d, { weekday: true }); return /^(hoy|mañana|ayer)$/.test(x) ? x : 'el ' + x; };
function ddRender(p, day) {
  const sc0 = $('.dd-scroll', p);
  const keep = sc0 ? sc0.scrollTop : null;
  const d = ymdDate(day);
  const today = todayStr();
  const mine = (C.open || []).filter((t) => t.due_date === day && (!tdrag || t.id !== tdrag.t.id));
  const total = mine.reduce((n, t) => n + (t.est_min || 0), 0);
  let rows = '';
  for (let m = DAY_START; m < DAY_END; m += 60) rows += `<span style="top:${((m - DAY_START) / 60) * MHPX}px">${m / 60}:00</span>`;
  const blocks = mine.filter((t) => t.plan_min !== null && t.plan_min !== undefined).map((t) => {
    const st = Math.min(Math.max(t.plan_min, DAY_START), DAY_END - 15);
    return `<div class="dd-b c-${esc(t.area_color || 'grey')}" style="top:${((st - DAY_START) / 60) * MHPX}px;height:${(Math.min(durOf(t), DAY_END - st) / 60) * MHPX - 2}px">${esc(t.title)}</div>`;
  }).join('');
  const now = new Date();
  const nm = now.getHours() * 60 + now.getMinutes();
  const rel = day === today ? 'Hoy' : day === addDays(today, 1) ? 'Mañana' : '';
  p.dataset.day = day;
  p.innerHTML = `<div class="dd-top"><span class="dd-edge">${day > today ? ic('back') : ''}</span><div class="dd-title"><b>${cap(DIAS[d.getDay()])} ${d.getDate()} de ${MESES_L[d.getMonth()]}${rel ? `<i>${rel}</i>` : ''}</b><small>${total ? fmtDur(total) + ' planeadas. ' : ''}Lleva el dedo a la orilla para cambiar de día.</small></div><span class="dd-edge">${ic('chev')}</span></div>
    <div class="dd-strip"><div class="dd-slot" data-slot="any">Ese día, sin hora</div><div class="dd-slot" data-slot="none">Quitar la fecha</div></div>
    <div class="dd-scroll"><div class="dd-in" style="height:${((DAY_END - DAY_START) / 60) * MHPX}px"><div class="dd-hours">${rows}</div><div class="dd-grid">${blocks}${day === today && nm >= DAY_START && nm <= DAY_END ? `<div class="wnow" style="top:${((nm - DAY_START) / 60) * MHPX}px"></div>` : ''}</div></div></div>`;
  if (keep !== null) $('.dd-scroll', p).scrollTop = keep;
}
function tdStart(h) {
  hold = null;
  if (navigator.vibrate) navigator.vibrate(15);
  const today = todayStr();
  const g = document.createElement('div'); g.className = 'tghost'; g.textContent = h.t.title; document.body.appendChild(g);
  const p = document.createElement('div'); p.className = 'ddrop'; p.setAttribute('aria-hidden', 'true'); document.body.appendChild(p);
  tdrag = { t: h.t, pid: h.pid, ghost: g, panel: p, x: h.x, y: h.y, target: null, dir: 0, edgeT: null, raf: 0 };
  document.body.classList.add('tdragging');
  ddRender(p, h.t.due_date && h.t.due_date >= today ? h.t.due_date : today);
  const now = new Date();
  const at = h.t.plan_min !== null && h.t.plan_min !== undefined ? h.t.plan_min : Math.min(Math.max(now.getHours() * 60, 8 * 60), 15 * 60);
  $('.dd-scroll', p).scrollTop = Math.max(0, ((at - DAY_START) / 60 - 1.5) * MHPX);
  requestAnimationFrame(() => p.classList.add('in'));
  tdMove(h.x, h.y);
  const loop = () => {   // keep scrolling while the finger rests near the top or bottom of the hours
    const d = tdrag;
    if (!d) return;
    const sc = $('.dd-scroll', d.panel);
    if (sc && !d.dir) {
      const r = sc.getBoundingClientRect();
      const v = d.y < r.top + 44 && d.y > r.top - 8 ? -7 : d.y > r.bottom - 44 ? 7 : 0;
      if (v) { const before = sc.scrollTop; sc.scrollTop += v; if (sc.scrollTop !== before) tdMove(d.x, d.y); }
    }
    d.raf = requestAnimationFrame(loop);
  };
  loop();
}
function tdMove(x, y) {
  const d = tdrag;
  d.x = x; d.y = y;
  d.ghost.style.transform = `translate(${Math.min(Math.max(8, x - 100), innerWidth - 208)}px, ${Math.max(4, y - 70)}px)`;
  $$('.dd-slot.over', d.panel).forEach((z) => z.classList.remove('over'));
  const pv = $('.dd-prev', d.panel);
  if (pv) pv.remove();
  d.target = null;
  const dir = x < 26 ? -1 : x > innerWidth - 26 ? 1 : 0;       // the edges change the day
  if (dir !== d.dir) {
    d.dir = dir; clearTimeout(d.edgeT);
    d.panel.classList.toggle('edge-l', dir < 0); d.panel.classList.toggle('edge-r', dir > 0);
    if (dir) d.edgeT = setTimeout(function flip() {
      if (!tdrag || tdrag.dir !== dir) return;
      const nk = addDays(d.panel.dataset.day, dir);
      if (nk < todayStr()) return;
      ddRender(d.panel, nk);
      if (navigator.vibrate) navigator.vibrate(8);
      d.edgeT = setTimeout(flip, 900);
    }, 500);
  }
  if (dir) return;
  const under = document.elementFromPoint(x, y);
  const slot = under && under.closest('.dd-slot');
  if (slot) { slot.classList.add('over'); d.target = { slot: slot.dataset.slot }; return; }
  const sc = $('.dd-scroll', d.panel);
  const sr = sc.getBoundingClientRect();
  if (y < sr.top || y > sr.bottom) return;
  const grid = $('.dd-grid', d.panel);
  const dur = Math.min(durOf(d.t), DAY_END - DAY_START);
  const min = Math.min(Math.max(snap(DAY_START + ((y - 40 - grid.getBoundingClientRect().top) / MHPX) * 60), DAY_START), DAY_END - dur);
  d.target = { min };
  grid.insertAdjacentHTML('beforeend', `<div class="dd-prev" style="top:${((min - DAY_START) / 60) * MHPX}px;height:${(dur / 60) * MHPX - 2}px"><span>${fmtClock(min)} a ${fmtClock(min + dur)}</span></div>`);
}
function tdEnd(commit) {
  const d = tdrag;
  tdrag = null;
  cancelAnimationFrame(d.raf); clearTimeout(d.edgeT);
  d.ghost.remove(); d.panel.classList.remove('in'); setTimeout(() => d.panel.remove(), 200);
  document.body.classList.remove('tdragging');
  wkNoClick = true; setTimeout(() => { wkNoClick = false; }, 400);
  if (!commit || !d.target) return;
  const t = d.t;
  const day = d.panel.dataset.day;
  let data;
  let msg;
  if (d.target.slot === 'none') { if (!t.due_date) return; data = { due_date: null }; msg = 'Quedó sin fecha'; }
  else if (d.target.slot === 'any') { data = { due_date: day, plan_min: null, replan: 1 }; msg = `Quedó para ${dayTxt(day)}`; }
  else { data = { due_date: day, plan_min: d.target.min, replan: 1 }; if (!t.est_min) data.est_min = 60; msg = `Quedó para ${dayTxt(day)} a las ${fmtClock(d.target.min)}`; }
  const undo = { due_date: t.due_date || null, plan_min: t.plan_min === undefined ? null : t.plan_min, replan: 1 };
  patchTask(t, data, msg, () => { if (UI.view === 'semana') fetchOpen().then(() => drawWeek(true)); else if (UI.refresh) UI.refresh(); else route(); }, undo);
}
document.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse' || !S.user || tdrag || document.body.classList.contains('lock')) return;
  const el = e.target.closest('.row[data-id] .rbody, .wkp [data-tid], .wk-m [data-tid]');
  if (!el || e.target.closest('[data-est]')) return;
  const id = Number(el.dataset.tid || el.closest('[data-id]').dataset.id);
  const t = (C.open || []).find((x) => x.id === id);
  if (!t || !isOpen(t)) return;
  hold = { t, x: e.clientX, y: e.clientY, pid: e.pointerId, timer: setTimeout(() => { if (hold) tdStart(hold); }, 350) };
});
document.addEventListener('pointermove', (e) => {
  if (tdrag) { if (e.pointerId === tdrag.pid) { e.preventDefault(); tdMove(e.clientX, e.clientY); } return; }
  if (hold && e.pointerId === hold.pid && Math.hypot(e.clientX - hold.x, e.clientY - hold.y) > 10) { clearTimeout(hold.timer); hold = null; }
}, { passive: false });
document.addEventListener('pointerup', () => { if (hold) { clearTimeout(hold.timer); hold = null; } if (tdrag) tdEnd(true); });
document.addEventListener('pointercancel', () => { if (hold) { clearTimeout(hold.timer); hold = null; } if (tdrag) tdEnd(false); });
document.addEventListener('touchmove', (e) => { if (tdrag) e.preventDefault(); }, { passive: false });
document.addEventListener('contextmenu', (e) => { if (hold || tdrag) e.preventDefault(); });
