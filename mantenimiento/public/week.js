/* Mantenimiento Dos Búhos — the week planner (wide screens). The lists on the left, the week on the right:
   drag a pendiente onto a day and an hour to plan it, drag it again to move it, pull its lower edge to say how long
   it takes, drop it back on the list to take its date away. It works the way Horizonte does. Needs core.js and app.js. */
const WK = { start: null, who: 'all', q: '' };          // Monday of the week shown, whose week, search text
const HOUR_H = 46;                                      // px per hour
const DAY_START = 6 * 60, DAY_END = 20 * 60, SNAP = 15; // the grid runs 6:00–20:00 in 15-minute steps
const mondayOf = (ymd) => addDays(ymd, -((ymdDate(ymd).getDay() + 6) % 7));
const durOf = (t) => Math.max(15, t.est_min || 60);
const snap = (m) => Math.round(m / SNAP) * SNAP;

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
    <p class="wk-phone">La semana se arma en una pantalla grande. En el teléfono, agrupa los pendientes por fecha desde <b>Filtrar</b>.</p>
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
  if (UI.view !== 'semana' || e.button !== 0 || document.body.classList.contains('lock')) return;
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
document.addEventListener('click', (e) => { if (wkNoClick && e.target.closest('.wkp [data-tid]')) { e.preventDefault(); e.stopPropagation(); } }, true);
document.addEventListener('dragstart', (e) => { if (e.target.closest && e.target.closest('.wkp')) e.preventDefault(); });
