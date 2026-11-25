/* Esmero — the planner. The day and the week with their hours, the month as a calendar, the lists you plan from (Bandeja,
   Atrasados, Esta semana, Todo, one per priority), and the sheets that go with them: one pendiente, Contactos, the menu.
   It is laid out the way Horizonte is: lists on the left and hours on the right; on a phone, the day first and a ribbon
   of views. Drag a pendiente onto a day and an hour to plan it; on a phone, hold it. Needs core.js and app.js. */
'use strict';

const P = Object.assign({ zoom: 'dia', src: null, who: 'all', panel: true, unt: true, areas: false }, store('mt_pl') || {});
P.day = null;      // the day shown (the first of the two on a wide screen); set on the first draw
P.follow = true;   // it is showing today: keep showing today when the date changes
P.tab = 'dia';     // phones: the view that is up
P.list = null;     // phones: which list a list view shows
P.q = '';          // search text in a list
const saveP = () => store('mt_pl', { zoom: P.zoom, src: P.src, who: P.who, panel: P.panel, unt: P.unt, areas: P.areas });

const DAY_START = 6 * 60, DAY_END = 20 * 60, SNAP = 15;   // the hours run 6:00–20:00 in 15-minute steps
const HOUR_H = 52;                                        // px per hour on a wide screen
const MG = 56;                                            // px per hour on a phone
const DURS = [15, 30, 45, 60, 90, 120, 180, 240, 300, 360, 480];
const mondayOf = (ymd) => addDays(ymd, -((ymdDate(ymd).getDay() + 6) % 7));
const durOf = (t) => Math.max(15, t.est_min || 60);
const snap = (m) => Math.round(m / SNAP) * SNAP;
const timed = (t) => t.plan_min !== null && t.plan_min !== undefined;
const inWho = (t) => P.who === 'all' || t.provider_id === P.who;                        // on the calendar
const inWhoList = (t) => P.who === 'all' || !t.provider_id || t.provider_id === P.who;  // in a list: unassigned work is offered too
const dayTasks = (d) => (C.open || []).filter((t) => t.due_date === d && inWho(t));
const dayLoad = (d) => dayTasks(d).reduce((n, t) => n + (t.est_min || (timed(t) ? 60 : 0)), 0);
const byPlan = (a, b) => (timed(a) ? a.plan_min : 1e9) - (timed(b) ? b.plan_min : 1e9) || bySort(a, b);
const dayName = (ymd, short = true) => { const d = ymdDate(ymd); return `${cap(short ? DIAS[d.getDay()].slice(0, 3) : DIAS[d.getDay()])} ${d.getDate()}`; };

// ---------- the lists ----------
const SRC = {
  // what I reported or what is mine to do: where it stands and when it is scheduled (Eric, 25 Nov 2026)
  mine: { label: 'Lo mío', icon: 'user', has: (t) => t.created_by === S.user.id || (!!myCard() && t.provider_id === myCard()) },
  inbox: { label: 'Bandeja', icon: 'inbox', has: (t) => !t.due_date },
  late: { label: 'Atrasados', icon: 'clock', has: (t) => isLate(t) },
  week: { label: 'Esta semana', icon: 'cal', has: (t) => !!t.due_date && t.due_date >= mondayOf(todayStr()) && t.due_date <= addDays(mondayOf(todayStr()), 6) },
  all: { label: 'Todo', icon: 'tasks', has: () => true },
};
for (const p of [1, 2, 3, 4]) SRC['p' + p] = { label: PRIO[p], prio: p, has: (t) => t.priority === p };
// The definition of a list. Besides the fixed ones there is one per area ("a3") and one for what has no area ("a0"):
// those are made when asked for, because the areas change.
function srcOf(k) {
  if (SRC[k]) return SRC[k];
  const m = /^a(\d+)$/.exec(k || '');
  if (!m) return null;
  const id = Number(m[1]);
  const a = id ? areaOf(id) : null;
  if (id && !a) return null;
  return { label: a ? a.name : 'Sin área', area: id, color: a ? a.color : 'grey', has: (t) => (t.area_id || 0) === id };
}
const isSub = (k) => { const x = srcOf(k); return !!x && (!!x.prio || x.area !== undefined); };   // a list reached from the menu, not from the ribbon
const TAB_SRC = { mio: 'mine', bandeja: 'inbox', atrasados: 'late', todo: 'all' };
const EMPTY = {
  mine: ['Nada pendiente tuyo', 'Lo que reportes o te toque hacer aparece aquí, con el día en que quedó agendado.'],
  inbox: ['La Bandeja está vacía', 'Lo que se reporta sin día llega aquí, para darle día y hora.'],
  late: ['Nada atrasado', 'Lo que pasa de su día sin hacerse aparece aquí.'],
  week: ['Nada para esta semana', 'Lleva un pendiente a un día para programarlo.'],
  all: ['No hay pendientes', 'Cuando alguien reporte algo, aparece aquí.'],
};
// the filter sheet (Todo): whose, which areas, which priorities
const isMio = (t) => t.created_by === S.user.id || (!!myCard() && t.provider_id === myCard());
const passF = (t) => (F.who === 'all' || (F.who === 'mio' ? isMio(t) : F.who === 'mine' ? t.provider_id === myCard() : F.who === 'none' ? !t.provider_id : F.who === 'reported' ? t.created_by === S.user.id : t.provider_id === F.who))
  && (!F.areas.length || F.areas.includes(t.area_id)) && (!F.prios.length || F.prios.includes(t.priority));
const filterCount = () => (F.who !== 'all' ? 1 : 0) + F.areas.length + F.prios.length + (F.sort !== 'auto' ? 1 : 0);
// What a list holds. The filter of "Filtrar y ordenar" narrows whichever list is open; `raw` is the list whole, for the counts.
function srcTasks(k, raw = false) {
  const src = srcOf(k);
  // "Lo mío" on the Bandeja: everything you reported or have to do, scheduled or not, to follow it to the end
  const wide = !raw && F.who === 'mio' && k === 'inbox';
  const list = (C.open || []).filter((t) => (wide || src.has(t)) && inWhoList(t));
  return raw ? list : list.filter(passF);
}
function srcGroups(k, list) {
  const today = todayStr();
  const used = new Set();
  const take = (fn) => list.filter((t) => !used.has(t.id) && fn(t)).map((t) => (used.add(t.id), t));
  const byPrio = () => [1, 2, 3, 4].map((p) => ({ head: PRIO[p], cls: p === 1 ? 'bad' : p === 2 ? 'warn' : '', items: list.filter((t) => t.priority === p).sort(byLate) }));
  const so = F.sort;
  if (F.who === 'mio' && so === 'auto') k = 'mine';
  // an order someone chose in "Filtrar y ordenar" applies to whichever list is open
  if (so === 'prio') return byPrio();
  if (so === 'old' || so === 'new') {   // by the day it was reported: what has been sitting longest, or what just came in
    const age = (t) => daysBetween(localYmd(t.created_at), today);
    const ord = (x, y) => (so === 'old' ? 1 : -1) * (x.created_at < y.created_at ? -1 : x.created_at > y.created_at ? 1 : x.id - y.id);
    const g = [
      { head: 'Hace más de un mes', cls: 'bad', items: take((t) => age(t) > 30).sort(ord) },
      { head: 'Hace más de una semana', cls: 'warn', items: take((t) => age(t) > 7).sort(ord) },
      { head: 'Esta semana', items: take((t) => age(t) > 0).sort(ord) },
      { head: 'Hoy', items: take(() => true).sort(ord) },
    ];
    return so === 'old' ? g : g.reverse();
  }
  if (so === 'by') {   // who reported it
    const names = [...new Set(list.map((t) => t.created_by_name || ''))];
    const cnt = (n) => list.filter((t) => (t.created_by_name || '') === n).length;
    names.sort((x, y) => (x === '' ? 1 : y === '' ? -1 : cnt(y) - cnt(x) || x.localeCompare(y)));
    return names.map((n) => ({ head: esc(n ? 'Reportó ' + n : 'Del plan preventivo'), items: list.filter((t) => (t.created_by_name || '') === n).sort(byLate) }));
  }
  if (so === 'short') {   // what takes least first: the quick ones for a free moment
    const ord = (x, y) => (x.est_min || 0) - (y.est_min || 0) || bySort(x, y);
    return [
      { head: 'Hasta media hora', items: take((t) => t.est_min && t.est_min <= 30).sort(ord) },
      { head: 'Hasta una hora', items: take((t) => t.est_min && t.est_min <= 60).sort(ord) },
      { head: 'Más de una hora', items: take((t) => !!t.est_min).sort(ord) },
      { head: 'Sin estimar', items: take(() => true).sort(bySort) },
    ];
  }
  if (so === 'area') {
    const ids = [...new Set(list.map((t) => t.area_id || 0))];
    ids.sort((a, b) => (areaOf(a) ? areaOf(a).sort : 999) - (areaOf(b) ? areaOf(b).sort : 999));
    return ids.map((id) => ({ head: id && areaOf(id) ? tag(areaOf(id).name, areaOf(id).color) : 'Sin área', items: list.filter((t) => (t.area_id || 0) === id).sort(byLate) }));
  }
  if (so === 'who') {
    const ids = [...new Set(list.map((t) => t.provider_id || 0))];
    const cnt = (id) => list.filter((t) => (t.provider_id || 0) === id).length;
    ids.sort((a, b) => (a === 0 ? -1 : b === 0 ? 1 : cnt(b) - cnt(a)));
    return ids.map((id) => ({ head: esc(id ? (provOf(id) || {}).name || 'Alguien' : 'Sin asignar'), cls: id ? '' : 'warn', items: list.filter((t) => (t.provider_id || 0) === id).sort(byLate) }));
  }
  if (so === 'date') {
    const week = addDays(today, 7);
    return [
      { head: 'Atrasados', cls: 'bad', items: take(isLate).sort(byLate) },
      { head: 'Para hoy', cls: 'warn', items: take((t) => t.due_date === today).sort(byPlan) },
      { head: 'Esta semana', items: take((t) => t.due_date && t.due_date <= week).sort(byLate) },
      { head: 'Más adelante', items: take((t) => !!t.due_date).sort(byLate) },
      { head: 'Sin fecha', items: take(() => true).sort(bySort) },
    ];
  }
  // otherwise each list in its own order
  if (k === 'mine') {
    const me = myCard();
    return [
      { head: 'Me toca hacerlo', cls: 'warn', items: take((t) => !!me && t.provider_id === me).sort(byLate) },
      { head: 'Agendado', items: take((t) => !!t.due_date).sort(byLate) },
      { head: 'Esperando día (en la Bandeja)', items: take(() => true).sort(bySort) },
    ];
  }
  if (k === 'late' || k === 'week') {
    const days = [...new Set(list.map((t) => t.due_date))].sort();
    if (k === 'late') days.reverse();
    return days.map((d) => ({ head: esc(cap(fmtDay(d, { weekday: true }))), cls: d < today ? 'bad' : d === today ? 'warn' : '', items: list.filter((t) => t.due_date === d).sort(byPlan) }));
  }
  if (srcOf(k).prio) {
    return [
      { head: 'Atrasados', cls: 'bad', items: take(isLate).sort(byLate) },
      { head: 'Para hoy', cls: 'warn', items: take((t) => t.due_date === today).sort(byPlan) },
      { head: 'Con día', items: take((t) => !!t.due_date).sort(byLate) },
      { head: 'En la Bandeja', items: take(() => true).sort(byLate) },
    ];
  }
  return byPrio();
}
const SORTS = [['auto', 'Como viene'], ['prio', 'Prioridad'], ['old', 'Más antiguos'], ['new', 'Más nuevos'], ['date', 'Fecha'], ['area', 'Área'], ['who', 'Quién lo hace'], ['by', 'Quién lo reportó'], ['short', 'Más cortos']];
// The line that drops a pendiente straight into the list you are in, as in Horizonte: the Bandeja, an area, a priority.
const canAdd = (k) => k === 'inbox' || (srcOf(k) && (srcOf(k).prio || srcOf(k).area !== undefined));
const addRow = (k) => (canAdd(k) ? `<form class="qadd" data-qadd="${k}"><label class="sr" for="pl-add">Agregar a ${esc(srcOf(k).label)}</label><input class="input" id="pl-add" type="text" maxlength="200" placeholder="Escribe un pendiente y presiona Enter" autocomplete="off" enterkeyhint="done"></form>` : '');

// ---------- one pendiente as a card ----------
// ctx: 'list' (in a list: the second line says where, when and who), 'day' (under its day: the day is not said again),
// 'chip' (one line, in the week's "sin hora" row), 'grid' (a block on the hours).
function cardHTML(t, o = {}) {
  const { ctx = 'list', prio = true, area = true, due: showDue = true, done = true, age = false, thumb = true, style = '', cls = '' } = o;
  const open = isOpen(t);
  const late = isLate(t);
  const due = dueInfo(t);
  const b = [];
  if (ctx === 'list' || ctx === 'day') {
    if (area && (t.area_name || t.place)) b.push(areaTag(t));
    if (open && prio && t.priority === 1) b.push(`<b class="urgent">${ic('flag')}Urgente</b>`);
    else if (open && prio && t.priority === 2) b.push('<span class="st hi">Alta</span>');
    if (open && ctx === 'list' && showDue && due) b.push(`<span class="due ${due.cls}">${esc(due.text)}${timed(t) && t.due_date ? ', ' + fmtClock(t.plan_min) : ''}</span>`);
    else if (open && late && ctx === 'day') b.push(`<span class="due late">${esc(due.text)}</span>`);
    else if (!open && t.completed_at) b.push(`<span class="due ok">${ic('check')}Hecho ${esc(fmtDay(localYmd(t.completed_at)))}</span>`);
  }
  if (ctx !== 'chip') {
    if (t.provider_id) b.push(`<span class="who">${ic('user')}${esc(first(t.provider_name))}</span>`);
    else if (open) b.push('<span class="who un">Sin asignar</span>');
  }
  if (ctx === 'list' || ctx === 'day') {
    if (t.status === 'en_proceso') b.push('<span class="st go">En curso</span>');
    else if (t.status === 'en_espera') b.push(`<span class="st wait">${esc(statusText(t))}</span>`);
    else if (t.status === 'cancelada') b.push('<span class="st">No aplica</span>');
    if (t.pending) b.push(`<span class="st wait">${ic('clock')}Por enviar</span>`);
    if (t.kind === 'preventivo') b.push(`<span class="st">${ic('repeat')}Preventivo</span>`);
    else if (t.kind === 'servicio') b.push('<span class="st">Servicio</span>');
    if (t.postponed) b.push(`<span class="st">${ic('clock')}Pospuesto ${t.postponed === 1 ? '1 vez' : t.postponed + ' veces'}</span>`);
    if (age && open && t.created_at) {
      const born = localYmd(t.created_at);
      b.push(`<span class="st ${daysBetween(born, todayStr()) >= 7 ? 'wait' : ''}">Reportado ${esc(ago(born))}</span>`);
    }
  }
  const meta = o.meta !== undefined ? o.meta : ctx === 'day' && timed(t) ? fmtClock(t.plan_min) : t.est_min && open ? fmtDur(t.est_min) : '';
  const tint = (ctx === 'grid' || ctx === 'chip') && t.area_color ? `hl c-${esc(t.area_color)}` : '';
  return `<div class="card in-${ctx} p${t.priority} ${late ? 'late' : ''} ${open ? '' : 'closed'} ${tint} ${cls}" data-tid="${t.id}"${style ? ` style="${style}"` : ''}${ctx === 'grid' || ctx === 'chip' ? ` title="${esc(t.title)}"` : ''}>
    ${open && done ? `<button type="button" class="ck" data-done="${t.id}" aria-label="Marcar hecho: ${esc(t.title)}"><span class="box">${ic('check')}</span></button>`
      : `<span class="ck static ${t.status === 'hecha' ? 'ok' : ''}" aria-hidden="true"><span class="box">${ic(t.status === 'cancelada' ? 'x' : 'check')}</span></span>`}
    <a class="body" href="#/p/${t.id}" draggable="false"><span class="t">${ctx !== 'list' && ctx !== 'day' && open && t.priority === 1 ? ic('flag') : ''}${esc(t.title)}</span>${b.length ? `<span class="rm">${b.join('')}</span>` : ''}</a>
    ${thumb && t.thumb_id && (ctx === 'list' || ctx === 'day') ? `<img class="cth" loading="lazy" src="/api/photos/${t.thumb_id}?t=1" alt="">` : ''}
    ${meta ? `<span class="meta">${esc(meta)}</span>` : ''}${ctx === 'grid' ? '<i class="rz" data-rz></i>' : ''}</div>`;
}
function bindRows(root, list, reload) {
  $$('[data-done]', root).forEach((b) => (b.onclick = () => {
    const t = list.find((x) => x.id === Number(b.dataset.done));
    if (t) completeSheet(t, reload);
  }));
}

// A list as groups of cards. Returns how many there are and the markup.
function listHTML(k) {
  const s = fold(P.q.trim());
  const total = srcTasks(k);
  const list = s ? total.filter((t) => fold([t.title, t.area_name, t.place, t.provider_name, t.equipment_name, '#' + t.id].join(' ')).includes(s)) : total;
  const groups = srcGroups(k, list).filter((g) => g.items.length);
  const o = F.sort === 'old' || F.sort === 'new' ? { age: true, due: k !== 'inbox' }
    : F.sort !== 'auto' ? { prio: F.sort !== 'prio', area: F.sort !== 'area' && srcOf(k).area === undefined }
    : k === 'inbox' && F.who === 'mio' ? { prio: false }   // yours, scheduled or not: say when
    : k === 'inbox' ? { prio: false, due: false, age: true }
    : k === 'late' ? { due: false }
      : k === 'week' ? { ctx: 'day' }
        : srcOf(k).prio ? { prio: false }
          : srcOf(k).area !== undefined ? { prio: false, area: false }
            : { prio: F.sort !== 'prio' && F.sort !== 'auto', area: F.sort !== 'area' };
  let html;
  if (groups.length) {
    html = groups.map((g) => `<h2 class="eyebrow ${g.cls || ''}">${g.head}<span class="n">${g.items.length}</span></h2>${g.items.map((t) => cardHTML(t, o)).join('')}`).join('');
  } else if (s) {
    html = `<div class="empty"><h2>Nada con «${esc(P.q.trim())}»</h2><p>Aquí se busca en ${esc(srcOf(k).label)}.</p></div>`;
  } else if (total.length < srcTasks(k, true).length) {
    html = `<div class="empty"><h2>Nada con este filtro</h2><p>Hay ${plural(srcTasks(k, true).length, 'pendiente', 'pendientes')} en ${esc(srcOf(k).label)}.</p><button type="button" class="b tonal" data-go="nofilter">Ver todos</button></div>`;
  } else {
    const e = EMPTY[k] || [srcOf(k).area !== undefined ? `Nada abierto en ${srcOf(k).label}` : `Nada con prioridad ${srcOf(k).label.toLowerCase()}`, ''];
    html = `<div class="empty"><h2>${e[0]}</h2>${e[1] ? `<p>${e[1]}</p>` : ''}${k === 'all' || k === 'inbox' ? `<a class="b" href="#/nuevo">${ic('camera')}Reportar un problema</a>` : ''}</div>`;
  }
  if (F.who === 'mio' && C.mioDone && C.mioDone.length && !s) {   // and what of yours was already done
    html += `<h2 class="eyebrow">Ya se hizo, últimos 30 días<span class="n">${C.mioDone.length}</span></h2>${C.mioDone.map((t) => cardHTML(t, { done: false })).join('')}`;
  }
  if (s) html += `<a class="showmore" href="#/buscar?q=${encodeURIComponent(P.q.trim())}">Buscar también en lo hecho, equipos y contactos</a>`;
  return { n: list.length, html };
}
function filterChips() {
  const WHO = { mio: 'Lo mío', mine: 'Los que me tocan', none: 'Sin asignar', reported: 'Los que reporté' };
  const chips = [];
  if (F.who !== 'all') chips.push(`<button type="button" class="fchip" data-clear="who" aria-label="Quitar filtro">${esc(WHO[F.who] || 'De ' + first((provOf(F.who) || {}).name))}${ic('x')}</button>`);
  for (const p of F.prios) chips.push(`<button type="button" class="fchip" data-clear="p${p}" aria-label="Quitar filtro ${PRIO[p]}">${PRIO[p]}${ic('x')}</button>`);
  for (const id of F.areas) chips.push(`<button type="button" class="fchip tagc c-${areaOf(id).color}" data-clear="${id}" aria-label="Quitar filtro ${esc(areaOf(id).name)}">${esc(areaOf(id).name)}${ic('x')}</button>`);
  if (F.sort !== 'auto') chips.push(`<button type="button" class="fchip" data-clear="sort" aria-label="Quitar el orden">${esc((SORTS.find((x) => x[0] === F.sort) || [])[1] || '')}${ic('x')}</button>`);
  return chips.length ? `<div class="fchips">${chips.join('')}</div>` : '';
}
const searchRow = (k, ph = 'Buscar pendientes') => `<div class="searchrow"><div class="search">${ic('search')}<label class="sr" for="pl-q">Buscar</label><input id="pl-q" type="search" placeholder="${ph}" value="${esc(P.q)}" autocomplete="off" enterkeyhint="search"></div>
  ${k ? `<button type="button" class="fbtn" data-go="filter" aria-pressed="${filterCount() > 0}" aria-label="Filtrar y ordenar" title="Filtrar y ordenar">${ic('filter')}</button>` : ''}</div>`;
const showStarter = () => isAdmin() && !store('mt_starter') && (S.equipment.length === 0 || !S.providers.some((p) => p.kind === 'externo' && p.active) || S.users.length < 3);
function whoSelect() {
  const ids = [...new Set((C.open || []).map((t) => t.provider_id).filter(Boolean))];
  if (typeof P.who === 'number' && !ids.includes(P.who)) ids.push(P.who);
  const people = ids.map(provOf).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
  if (!people.length) return '';
  return `<label class="sr" for="pl-who">De quién</label><select class="whosel" id="pl-who" data-who><option value="all">De todos</option>${people.map((p) => `<option value="${p.id}" ${P.who === p.id ? 'selected' : ''}>${esc(isDesk() ? p.name : first(p.name))}</option>`).join('')}</select>`;
}
// What the calendar is showing, for the top bar. `short` is the same in fewer letters, for a narrow window.
function planTitle(short = false) {
  const day = P.day || todayStr();
  const yr = (d) => (d.getFullYear() === Number(todayStr().slice(0, 4)) ? '' : (short ? ' ' : ' de ') + d.getFullYear());
  if (P.zoom === 'mes') return short ? `${cap(MESES[Number(day.slice(5, 7)) - 1])} ${day.slice(0, 4)}` : monthName(day.slice(0, 7));
  if (P.zoom === 'semana') {
    const a = ymdDate(mondayOf(day)), b = ymdDate(addDays(mondayOf(day), 6));
    if (short) return (a.getMonth() === b.getMonth() ? `${a.getDate()} al ${b.getDate()} ${MESES[b.getMonth()]}` : `${a.getDate()} ${MESES[a.getMonth()]} al ${b.getDate()} ${MESES[b.getMonth()]}`) + yr(b);
    return (a.getMonth() === b.getMonth() ? `${a.getDate()} al ${b.getDate()} de ${MESES_L[b.getMonth()]}` : `${a.getDate()} de ${MESES[a.getMonth()]} al ${b.getDate()} de ${MESES[b.getMonth()]}`) + yr(b);
  }
  const d = ymdDate(day);
  if (short) return `${cap(DIAS[d.getDay()].slice(0, 3))} ${d.getDate()} ${MESES[d.getMonth()]}${yr(d)}`;
  return `${cap(DIAS[d.getDay()])} ${d.getDate()} de ${MESES_L[d.getMonth()]}${yr(d)}`;
}

// ---------- time blocks: someone's time that is not a pendiente ("Huerto", "Compras") ----------
// Everyone sees them, so it is plain when Adrián has room; administrators write them. Two weeks around the day on screen.
const BK = { list: [], names: [], key: '', busy: '' };
function needBlocks() {
  const a = mondayOf(P.day || todayStr()), b = addDays(a, 13), key = a + '_' + b;
  if (BK.key === key || BK.busy === key) return;
  BK.busy = key;
  api('GET', `/blocks?from=${a}&to=${b}`).then((r) => {
    BK.list = r.blocks || []; BK.names = r.names || []; BK.key = key; BK.busy = '';
    if (UI.plan && !wdrag && !tdrag && !sw) drawPlanner(true);
  }).catch(() => { BK.busy = ''; });
}
const reloadBlocks = () => { BK.key = ''; needBlocks(); };
const dayBlocks = (d) => BK.list.filter((b) => b.day === d && (P.who === 'all' || b.provider_id === P.who)).sort((x, y) => x.start_min - y.start_min);
const blockWho = (b) => (P.who === 'all' && b.provider_name ? first(b.provider_name) : '');
const blockSpan = (b) => `${fmtClock(b.start_min)} a ${fmtClock(b.end_min)}`;
// a block on the hours: behind the pendientes, so what is planned over it still shows
function blockHTML(b, hh) {
  const st = Math.max(b.start_min, DAY_START), en = Math.min(b.end_min, DAY_END);
  if (en <= st) return '';
  const who = blockWho(b);
  return `<div class="tblk ${en - st <= 30 ? 'short' : ''}" data-bid="${b.id}" style="top:${((st - DAY_START) / 60) * hh}px;height:${((en - st) / 60) * hh - 2}px" title="${esc(b.title)}, ${blockSpan(b)}">
    <b>${esc(b.title)}</b><span class="meta">${blockSpan(b)}${who ? ', ' + esc(who) : ''}</span>${isAdmin() ? '<i class="rz" data-rz></i>' : ''}</div>`;
}
// a block in a list of the day (phone week)
const blockRow = (b) => `<div class="brow" data-bid="${b.id}"><span class="bt">${fmtClock(b.start_min)}<br>${fmtClock(b.end_min)}</span><span class="grow"><b>${esc(b.title)}</b>${blockWho(b) ? `<span class="small">${esc(blockWho(b))}</span>` : ''}</span></div>`;
const blockDefaultWho = () => (typeof P.who === 'number' ? P.who : store('mt_bwho') || S.settings.coordinator || myCard());
const timeOpts = (sel, from = DAY_START, to = DAY_END) => { let o = ''; for (let m = from; m <= to; m += SNAP) o += `<option value="${m}" ${m === sel ? 'selected' : ''}>${fmtClock(m)}</option>`; return o; };
async function blockSheet(b0) {
  if (!isAdmin()) return;
  const isNew = !b0.id;
  const ppl = activeProviders().filter((p) => p.kind === 'interno');
  const who = b0.provider_id || blockDefaultWho();
  const st = b0.start_min ?? 9 * 60, en = b0.end_min ?? st + 60;
  const res = await sheet({
    title: isNew ? 'Bloquear tiempo' : 'Bloque de tiempo', sub: 'Todos lo ven en el calendario, para saber cuándo hay espacio.',
    body: `<div class="pad">
      <div class="field"><label class="flabel" for="bk-title">Nombre</label><input class="input" id="bk-title" list="bk-names" maxlength="60" value="${esc(b0.title || '')}" placeholder="Ej. Huerto" autocomplete="off" autocapitalize="sentences">
        <datalist id="bk-names">${BK.names.map((n) => `<option value="${esc(n)}">`).join('')}</datalist></div>
      ${BK.names.length ? `<div class="quick" role="group" aria-label="Usados antes">${BK.names.slice(0, 6).map((n) => `<button type="button" class="qchip" data-bn="${esc(n)}">${esc(n)}</button>`).join('')}</div>` : ''}
      ${fInput('bk-day', 'Día', { type: 'date', value: b0.day || P.day || todayStr() })}
      <div class="trow2"><div class="field"><label class="flabel" for="bk-st">De</label><select class="input" id="bk-st">${timeOpts(st)}</select></div>
        <div class="field"><label class="flabel" for="bk-en">A</label><select class="input" id="bk-en">${timeOpts(en)}</select></div></div>
      <div class="field"><label class="flabel" for="bk-who">De quién es el tiempo</label><select class="input" id="bk-who">${ppl.map((p) => `<option value="${p.id}" ${p.id === who ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>
      <p class="err hidden" id="bk-err" role="alert"></p></div>`,
    acts: [isNew ? { label: 'Cancelar', cls: 'plain', value: null } : { label: `${ic('trash')}Eliminar`, cls: 'plain danger', value: 'del' }, {
      label: 'Guardar', value: (w) => {
        const v = { title: $('#bk-title', w).value.trim(), day: $('#bk-day', w).value, start_min: Number($('#bk-st', w).value), end_min: Number($('#bk-en', w).value), provider_id: Number($('#bk-who', w).value) };
        const bad = !v.title ? 'Ponle nombre al bloque' : !v.day ? 'Elige el día' : v.end_min - v.start_min < 15 ? 'La hora de fin va después de la de inicio' : !v.provider_id ? 'Elige de quién es el tiempo' : '';
        if (bad) { const e = $('#bk-err', w); e.textContent = bad; e.classList.remove('hidden'); return undefined; }
        return v;
      },
    }],
    onOpen: (w) => {
      $$('[data-bn]', w).forEach((b) => (b.onclick = () => { $('#bk-title', w).value = b.dataset.bn; }));
      const sS = $('#bk-st', w), sE = $('#bk-en', w);
      sS.onchange = () => { const d = Number(sE.value) - st; if (Number(sE.value) <= Number(sS.value)) sE.value = String(Math.min(Number(sS.value) + Math.max(d, 60), DAY_END)); };
      if (isNew && matchMedia('(min-width: 600px)').matches) $('#bk-title', w).focus();
    },
  });
  if (!res) return;
  if (res === 'del') return deleteBlock(b0);
  store('mt_bwho', res.provider_id);
  try {
    await api(isNew ? 'POST' : 'PATCH', isNew ? '/blocks' : '/blocks/' + b0.id, res);
    toast(isNew ? 'Tiempo bloqueado' : 'Guardado');
    if (res.day !== P.day && isNew) { P.day = res.day; P.follow = P.day === todayStr(); }
    reloadBlocks();
  } catch (e) { toast(e.message, { bad: true }); }
}
function deleteBlock(b) {
  later('Bloque eliminado', () => api('DELETE', '/blocks/' + b.id), {
    hide: () => { BK.list = BK.list.filter((x) => x.id !== b.id); if (UI.plan) drawPlanner(true); },
    undo: () => { if (!BK.list.some((x) => x.id === b.id)) BK.list.push(b); if (UI.plan) drawPlanner(true); },
    done: () => reloadBlocks(),
  });
}
function blockTap(id) {
  const b = BK.list.find((x) => x.id === id);
  if (!b) return;
  if (isAdmin()) blockSheet(b);
  else toast(`${b.provider_name ? first(b.provider_name) + ': ' : ''}${b.title}, ${blockSpan(b)}`);
}
async function copyWeekSheet() {
  if (!isAdmin()) return;
  const ppl = activeProviders().filter((p) => p.kind === 'interno');
  const mon = mondayOf(P.day || todayStr()), prev = addDays(mon, -7);
  const fmt = (d) => `${ymdDate(d).getDate()} ${MESES[ymdDate(d).getMonth()]}`;
  const res = await sheet({
    title: 'Copiar la semana pasada', sub: `Los bloques del ${fmt(prev)} al ${fmt(addDays(prev, 6))} pasan a esta semana (${fmt(mon)} al ${fmt(addDays(mon, 6))}). Después los ajustas.`,
    body: `<div class="pad"><div class="field"><label class="flabel" for="cw-who">De quién</label><select class="input" id="cw-who">${ppl.map((p) => `<option value="${p.id}" ${p.id === blockDefaultWho() ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div></div>`,
    acts: [{ label: 'Cancelar', cls: 'plain', value: null }, { label: 'Copiar', value: (w) => Number($('#cw-who', w).value) }],
  });
  if (!res) return;
  try {
    const r = await api('POST', '/blocks/copy', { from: prev, to: mon, provider_id: res });
    toast(r.copied ? `Se copiaron ${plural(r.copied, 'bloque', 'bloques')}` : 'La semana pasada no tenía bloques nuevos que copiar');
    reloadBlocks();
  } catch (e) { toast(e.message, { bad: true }); }
}

// ---------- the hours ----------
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
const nowMin = () => { const n = new Date(); return n.getHours() * 60 + n.getMinutes(); };
const gutterHTML = (hh) => { let s = ''; for (let m = DAY_START; m < DAY_END; m += 60) s += `<div style="height:${hh}px"><span>${m / 60}:00</span></div>`; return s; };
function gridHTML(day, hh) {
  const today = todayStr();
  const items = layoutDay(dayTasks(day).filter(timed).map((t) => {
    const st = Math.min(Math.max(t.plan_min, DAY_START), DAY_END - 15);
    return { t, s: st, e: Math.min(st + durOf(t), DAY_END) };
  }));
  const nm = nowMin();
  return `<div class="grid ${day === today ? 'today' : ''} ${day < today ? 'past' : ''} ${isAdmin() ? 'canblk' : ''}" data-day="${day}" style="height:${((DAY_END - DAY_START) / 60) * hh}px;--hh:${hh}px">
    ${dayBlocks(day).map((b) => blockHTML(b, hh)).join('')}
    ${items.map(({ t, s, e, col, n }) => cardHTML(t, {
      ctx: 'grid', cls: `blk ${e - s <= 30 ? 'short' : e - s >= 90 ? 'tall' : ''} ${n > 1 ? 'split' : ''}`, meta: `${fmtClock(s)} a ${fmtClock(e)}`,
      style: `top:${((s - DAY_START) / 60) * hh}px;height:${((e - s) / 60) * hh - 2}px;left:calc(${(col / n) * 100}% + 3px);width:calc(${100 / n}% - 6px)`,
    })).join('')}
    ${day === today && nm >= DAY_START && nm <= DAY_END ? `<div class="nowline" style="top:${((nm - DAY_START) / 60) * hh}px"><span>${fmtClock(nm)}</span></div>` : ''}</div>`;
}
// the red line moves with the clock without drawing the screen again
setInterval(() => {
  if (!UI.plan || document.hidden) return;
  const nm = nowMin();
  $$('.grid.today .nowline').forEach((el) => {
    const hh = parseFloat(getComputedStyle(el.parentElement).getPropertyValue('--hh')) || HOUR_H;
    el.style.top = ((nm - DAY_START) / 60) * hh + 'px';
    const sp = $('span', el);
    if (sp) sp.textContent = fmtClock(nm);
  });
}, 60000);

// ---------- phones ----------
function phoneDay() {
  const k = P.day, today = todayStr(), d = ymdDate(k), mon = mondayOf(k);
  const unt = dayTasks(k).filter((t) => !timed(t)).sort(bySort);
  let strip = '';
  for (let i = 0; i < 7; i++) {
    const kk = addDays(mon, i), dd = ymdDate(kk), n = dayTasks(kk).length;
    strip += `<button type="button" data-day="${kk}" aria-pressed="${kk === k}" class="${kk === today ? 'today' : ''}" aria-label="${DIAS[dd.getDay()]} ${dd.getDate()}${kk === today ? ', hoy' : ''}${n ? ', ' + plural(n, 'pendiente', 'pendientes') : ''}">
      <span class="dw">${'DLMMJVS'[dd.getDay()]}</span><span class="dn">${dd.getDate()}</span><i class="${n ? (kk < today ? 'late' : 'has') : ''}"></i></button>`;
  }
  const title = `<button type="button" class="tdy ${k === today ? 'cur' : ''}" data-step="0" ${k === today ? 'aria-current="date"' : ''}>Hoy</button><h1 class="date">${dayName(k)} ${MESES[d.getMonth()]}</h1>`;
  const load = dayLoad(k);
  const foldRow = `<div class="foldrow">${unt.length
    ? `<button type="button" class="lbl" data-go="fold" aria-expanded="${!!P.unt}">${unt.length} sin hora${ic(P.unt ? 'down' : 'chev')}</button>`
    : '<span class="lbl none">Nada sin hora</span>'}${load ? `<span class="small">${fmtDur(load)} planeadas</span>` : ''}${whoSelect()}</div>`;
  return `<header class="mh hours">${mtop(title, phoneBtn())}<div class="wstrip" data-swipe="week">${strip}</div></header>
    <div class="mm" data-swipe="day">${foldRow}${P.unt ? unt.map((t) => cardHTML(t, { ctx: 'day' })).join('') : ''}
      <div class="hgrid"><div class="gutter" aria-hidden="true">${gutterHTML(MG)}</div>${gridHTML(k, MG)}</div>
      ${!isAdmin() ? '' : store('mt_held') ? (store('mt_btap') ? '' : '<p class="mhint">Toca una hora vacía para bloquear tiempo.</p>') : '<p class="mhint">Mantén presionado un pendiente para llevarlo a otro día o a una hora. Toca una hora vacía para bloquear tiempo.</p>'}</div>`;
}
function phoneWeek() {
  const today = todayStr(), mon = mondayOf(P.day);
  let body = '';
  let wn = 0, wl = 0;
  for (let i = 0; i < 7; i++) {
    const k = addDays(mon, i), d = ymdDate(k), list = dayTasks(k).sort(byPlan), load = dayLoad(k);
    wn += list.length; wl += load;
    body += `<section class="mday ${k < today ? 'past' : ''}"><div class="dayhead"><b>${dayName(k)}</b>${k === today ? '<span class="tpill">Hoy</span>' : ''}
        <span class="small">${list.length ? `${plural(list.length, 'pendiente', 'pendientes')}${load ? ', ' + fmtDur(load) : ''}` : 'Nada'}</span>
        <a class="pb" href="#/nuevo?fecha=${k}" aria-label="Reportar algo para el ${DIAS[d.getDay()]} ${d.getDate()}">${ic('plus')}</a></div>
      ${[...list.map((t) => ({ m: timed(t) ? t.plan_min : 1e9, h: cardHTML(t, { ctx: 'day' }) })), ...dayBlocks(k).map((b) => ({ m: b.start_min - 0.5, h: blockRow(b) }))]
        .sort((x, y) => x.m - y.m).map((x) => x.h).join('')}</section>`;
  }
  const a = ymdDate(mon), b = ymdDate(addDays(mon, 6));
  const label = a.getMonth() === b.getMonth() ? `${a.getDate()} al ${b.getDate()} ${MESES[b.getMonth()]}` : `${a.getDate()} ${MESES[a.getMonth()]} al ${b.getDate()} ${MESES[b.getMonth()]}`;
  const right = `<button type="button" class="pb" data-step="-1" aria-label="Semana anterior">${ic('back')}</button><button type="button" class="tb" data-step="0">Hoy</button><button type="button" class="pb" data-step="1" aria-label="Semana siguiente">${ic('chev')}</button>`;
  return `<header class="mh">${mtop(`<h1 class="date">${label}</h1>`, right)}</header>
    <div class="mm" data-swipe="week">${whoSelect() ? `<div class="foldrow week">${whoSelect()}${wn ? `<span class="small">${plural(wn, 'pendiente', 'pendientes')}${wl ? ', ' + fmtDur(wl) : ''}</span>` : ''}</div>` : ''}${body}</div>`;
}
function phoneList(k) {
  const L = listHTML(k);
  return `<header class="mh">${mtop(`<h1 class="date">${esc(srcOf(k).label)}<span class="cnt" id="pl-n">${L.n || ''}</span></h1>`, phoneBtn())}${searchRow(k)}</header>
    <div class="mm lists">${addRow(k)}${filterChips()}${k === 'inbox' && showStarter() ? starterCard() : ''}<div id="pl-items">${L.html}</div></div>`;
}

// ---------- the month ----------
// A Monday-to-Sunday calendar of the month the anchor day is in. Each day shows its open pendientes (titles on a wide
// screen, bars on a phone) and the preventive visits still to come: a plan's order is only made some days ahead, so
// without them a month looked emptier than it is. A day opens in Día; a pendiente dropped on a day moves to it.
const monthEnd = (ym) => { const d = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0); return `${ym}-${pad2(d.getDate())}`; };
const monthShift = (ym, n) => { const d = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 + n, 1); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`; };
const monthName = (ym) => `${cap(MESES_L[Number(ym.slice(5, 7)) - 1])} ${ym.slice(0, 4)}`;
const PMY = {};   // the year's preventive work, by year: { at, items, wait }
function loadPlanned(y) {
  const c = PMY[y] || (PMY[y] = { at: 0, items: null, wait: null });
  if (c.wait) return;
  c.wait = api('GET', '/pm/year?y=' + y)
    .then((r) => { c.items = r.items || []; c.at = Date.now(); if (UI.plan && (isDesk() ? P.zoom : P.tab) === 'mes' && !wdrag && !tdrag && !document.body.classList.contains('lock')) drawPlanner(true); })
    .catch(() => { c.at = Date.now(); })                    // no signal: the month shows what it has and tries again in a minute
    .finally(() => { c.wait = null; });
}
// The visits of a month that are not pendientes yet.
function plannedIn(ym) {
  const y = Number(ym.slice(0, 4));
  const c = PMY[y];
  if (!c || Date.now() - c.at > 60000) loadPlanned(y);
  return c && c.items ? c.items.filter((it) => it.status === 'future' && !it.task_id && it.date.slice(0, 7) === ym && (P.who === 'all' || it.provider_id === P.who)) : [];
}
function monthStats(ym, plan) {
  const today = todayStr(), a = ym + '-01', b = monthEnd(ym);
  const list = (C.open || []).filter((t) => t.due_date && t.due_date >= a && t.due_date <= b && inWho(t));
  const late = list.filter((t) => t.due_date < today).length;
  const mins = list.reduce((n, t) => n + (t.est_min || (timed(t) ? 60 : 0)), 0);
  const bits = [];
  if (list.length) bits.push(plural(list.length, 'pendiente', 'pendientes'));
  if (late) bits.push(late === 1 ? '1 atrasado' : late + ' atrasados');
  if (mins) bits.push(fmtDur(mins));
  if (plan.length) bits.push(plan.length === 1 ? '1 preventivo por venir' : plan.length + ' preventivos por venir');
  return { n: list.length, late, text: bits.join(', ') || 'Nada programado' };
}
const planChip = (it) => `<a class="card in-chip plan c-${esc(it.area_color || 'grey')}" href="#/plan/${it.pm_id}" title="Preventivo, todavía no es un pendiente: ${esc(it.title)}">${ic('repeat')}<span class="t">${esc(it.title)}</span></a>`;
const planRow = (it) => `<a class="prow" href="#/plan/${it.pm_id}">${ic('repeat')}<span class="grow"><b>${esc(it.title)}</b><span class="rm"><span>Preventivo</span>${it.provider_name ? `<span>${esc(first(it.provider_name))}</span>` : ''}${it.area_name ? tag(it.area_name, it.area_color) : ''}</span></span>${ic('chev')}</a>`;
function monthHTML(ym, plan, fit) {
  const today = todayStr(), a = ym + '-01', b = monthEnd(ym);
  let k = mondayOf(a);
  let cells = '';
  for (let i = 0; i < 42; i++, k = addDays(k, 1)) {
    if (i === 35 && k > b) break;                             // five rows when the sixth would be all next month
    const dn = Number(k.slice(8));
    if (k < a || k > b) { cells += `<div class="mcell out" aria-hidden="true"><span class="dn">${dn}</span></div>`; continue; }
    const list = dayTasks(k).sort(byPlan), pl = plan.filter((x) => x.date === k);
    const n = list.length + pl.length, late = k < today && list.length > 0;
    const say = `${DIAS[ymdDate(k).getDay()]} ${dn}${k === today ? ', hoy' : ''}${n ? ', ' + plural(n, 'cosa', 'cosas') : ''}${late ? ', con atrasados' : ''}`;
    let inner;
    if (fit) {   // a wide screen: as many titles as the row has room for
      const show = n <= fit ? n : Math.max(1, fit - 1);
      inner = [...list.map((t) => cardHTML(t, { ctx: 'chip' })), ...pl.map(planChip)].slice(0, show).join('') + (n > show ? `<a class="mmore" href="#/" data-mday="${k}">${n - show} más</a>` : '');
    } else {     // a phone: one bar each, in the colour of its area
      inner = `<span class="bars">${[...list.map((t) => `<i class="${late ? 'late' : 'tagc c-' + esc(t.area_color || 'grey')}"></i>`), ...pl.map(() => '<i class="plan"></i>')].slice(0, 3).join('')}</span>${n > 3 ? `<span class="mmore">+${n - 3}</span>` : ''}`;
    }
    const cls = `mcell ${k === today ? 'today' : ''} ${k < today ? 'past' : ''} ${late ? 'late' : ''}`;
    cells += fit   // wide: the number is the way into the day, the rest of the cell is where pendientes are dropped; phone: the whole day is the button
      ? `<div class="${cls}" data-day="${k}"><a class="dn" href="#/" data-mday="${k}" aria-label="${say}">${dn}</a>${inner}</div>`
      : `<a class="${cls}" href="#/" data-mday="${k}" data-day="${k}" aria-label="${say}"><span class="dn">${dn}</span>${inner}</a>`;
  }
  return `<div class="mcal ${fit ? '' : 'mob'}"><div class="mdow" aria-hidden="true">${['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((x) => `<span>${x}</span>`).join('')}</div><div class="mcells">${cells}</div></div>`;
}
function phoneMonth() {
  const today = todayStr(), ym = P.day.slice(0, 7), cur = ym === today.slice(0, 7), b = monthEnd(ym);
  const plan = plannedIn(ym), st = monthStats(ym, plan);
  let body = '';
  // under the calendar, the days that have something; in the month we are in, from today on (what is late has its own tab)
  for (let k = cur ? today : ym + '-01'; k <= b; k = addDays(k, 1)) {
    const list = dayTasks(k).sort(byPlan), pl = plan.filter((x) => x.date === k);
    if (!list.length && !pl.length) continue;
    const d = ymdDate(k), load = dayLoad(k);
    body += `<section class="mday ${k < today ? 'past' : ''}"><div class="dayhead"><b>${dayName(k)}</b>${k === today ? '<span class="tpill">Hoy</span>' : ''}
        <span class="small">${list.length ? `${plural(list.length, 'pendiente', 'pendientes')}${load ? ', ' + fmtDur(load) : ''}` : 'Preventivo'}</span>
        <a class="pb" href="#/nuevo?fecha=${k}" aria-label="Reportar algo para el ${DIAS[d.getDay()]} ${d.getDate()}">${ic('plus')}</a></div>
      ${list.map((t) => cardHTML(t, { ctx: 'day' })).join('')}${pl.map(planRow).join('')}</section>`;
  }
  const right = `<button type="button" class="pb" data-step="-1" aria-label="Mes anterior">${ic('back')}</button><button type="button" class="tb" data-step="0">Hoy</button><button type="button" class="pb" data-step="1" aria-label="Mes siguiente">${ic('chev')}</button>`;
  return `<header class="mh">${mtop(`<h1 class="date">${monthName(ym)}</h1>`, right)}</header>
    <div class="mm mes" data-swipe="month"><div class="foldrow week">${whoSelect()}<span class="small">${st.text}</span></div>
      ${monthHTML(ym, plan, 0)}
      ${cur && st.late ? `<a class="mesl" href="#/atrasados" data-tab>${st.late === 1 ? '1 atrasado de días anteriores' : st.late + ' atrasados de días anteriores'}<b>Ver</b></a>` : ''}
      ${body || `<p class="mesn">${st.n || plan.length ? 'Nada más en lo que queda del mes.' : 'Nada programado este mes.'}</p>`}</div>`;
}
function monthPane() {
  const ym = P.day.slice(0, 7), plan = plannedIn(ym);
  const rows = addDays(mondayOf(ym + '-01'), 35) > monthEnd(ym) ? 5 : 6;
  const rowH = Math.max(104, (innerHeight - 54 - 72) / rows);    // the bar on top, then the month's line and the letters of the days
  return `<div class="mesv"><div class="mroll"><span class="small">${monthStats(ym, plan).text}</span><span class="small">Un día se abre con su número. Arrastra un pendiente a otro día para moverlo.</span></div>
    ${monthHTML(ym, plan, Math.max(1, Math.floor((rowH - 30) / 29)))}</div>`;
}

// ---------- wide screens ----------
function hoursHTML() {
  const today = todayStr();
  const wk = P.zoom === 'semana';
  const days = wk ? Array.from({ length: 7 }, (_, i) => addDays(mondayOf(P.day), i)) : [P.day, addDays(P.day, 1)];
  const rel = (k) => (k === today ? 'Hoy' : k === addDays(today, 1) ? 'Mañana' : k === addDays(today, -1) ? 'Ayer' : '');
  const head = days.map((k) => {
    const d = ymdDate(k), load = dayLoad(k), n = dayTasks(k).length;
    return `<div class="hcol ${k === today ? 'today' : ''} ${k < today ? 'past' : ''}" data-day="${k}"><div class="head"><div class="date"><span class="num ${k === today ? 'today' : ''}">${d.getDate()}</span>
      <span class="dow">${cap(wk ? DIAS[d.getDay()].slice(0, 3) : DIAS[d.getDay()])}</span>${rel(k) && !wk ? `<span class="rel">${rel(k)}</span>` : ''}</div>
      ${n ? `<span class="small" ${wk ? `title="${plural(n, 'pendiente', 'pendientes')}${load ? ', ' + fmtDur(load) + ' planeadas' : ''}"` : ''}>${wk ? (load ? fmtDur(load) : n) : `${plural(n, 'pendiente', 'pendientes')}${load ? ', ' + fmtDur(load) : ''}`}</span>` : ''}</div></div>`;
  }).join('');
  const unt = days.map((k) => {
    const list = dayTasks(k).filter((t) => !timed(t)).sort(bySort);
    return `<div class="ucol" data-day="${k}">${list.map((t) => cardHTML(t, wk ? { ctx: 'chip' } : { ctx: 'day' })).join('')}</div>`;
  }).join('');
  return `<div class="hours ${wk ? 'n7' : 'n2'}">
    <div class="hrow sticky"><div class="gutter"></div>${head}</div>
    <div class="hrow unt"><div class="gutter"><span>Sin hora</span></div>${unt}</div>
    <div class="hrow"><div class="gutter hrs" aria-hidden="true">${gutterHTML(HOUR_H)}</div>${days.map((k) => gridHTML(k, HOUR_H)).join('')}</div></div>`;
}
function panelHTML() {
  if (P.src && srcOf(P.src)) {
    const k = P.src;
    const L = listHTML(k);
    return `<div class="listhead"><button type="button" class="back" data-src="">${ic('back')}Listas</button></div>
      <div class="listtitle">${srcOf(k).area !== undefined ? `<i class="pdot tagc c-${esc(srcOf(k).color)}"></i>` : ''}<b>${esc(srcOf(k).label)}</b><span class="muted" id="pl-n">${L.n || ''}</span></div>
      ${searchRow(k)}
      <p class="phint">Arrastra un pendiente a un día y a una hora.</p>
      ${addRow(k)}${filterChips()}
      <div class="stack" id="pl-items">${L.html}</div>`;
  }
  const n = (k) => srcTasks(k, true).length;
  const urgentIn = (C.open || []).some((t) => !t.due_date && t.priority === 1 && inWhoList(t));   // something urgent waits in the Bandeja: its count goes red
  const row = (k) => { const x = srcOf(k); return `<button type="button" class="navrow ${(k === 'late' && n(k)) || (k === 'inbox' && urgentIn) ? 'late' : ''}" data-src="${k}"><span class="ni">${x.prio ? `<i class="pdot p${x.prio}"></i>` : x.area !== undefined ? `<i class="pdot tagc c-${esc(x.color)}"></i>` : ic(x.icon)}</span><span class="lbl">${esc(x.label)}</span><span class="n">${n(k) || ''}</span></button>`; };
  const areaKeys = [...activeAreas().map((a) => 'a' + a.id), ...(n('a0') ? ['a0'] : [])];
  const link = (href, icon, label, count = '') => `<a class="navrow" href="${href}"><span class="ni">${ic(icon)}</span><span class="lbl">${label}</span><span class="n">${count}</span></a>`;
  const late = n('late');
  return `${late ? `<button type="button" class="pbanner" data-src="late"><span>${late === 1 ? '1 atrasado de días anteriores' : late + ' atrasados de días anteriores'}</span>Ver</button>` : ''}
    ${searchRow('', 'Buscar pendientes')}
    <div class="navgroup">${row('inbox')}${row('late')}${row('week')}${row('all')}</div>
    ${isAdmin() ? `<div class="navhead"><span class="eyebrow">Tiempo</span></div>
    <div class="navgroup"><button type="button" class="navrow" data-go="block"><span class="ni">${ic('clock')}</span><span class="lbl">Bloquear tiempo</span><span class="n"></span></button><button type="button" class="navrow" data-go="copyweek"><span class="ni">${ic('repeat')}</span><span class="lbl">Copiar la semana pasada</span><span class="n"></span></button></div>` : ''}
    <div class="navhead"><span class="eyebrow">Prioridad</span></div>
    <div class="navgroup">${[1, 2, 3, 4].map((p) => row('p' + p)).join('')}</div>
    <div class="navhead"><button type="button" class="eyebrow foldh" data-go="areas" aria-expanded="${!!P.areas}">Áreas${ic(P.areas ? 'down' : 'chev')}</button></div>
    ${P.areas ? `<div class="navgroup">${areaKeys.map(row).join('')}</div>` : ''}
    <div class="navhead"><span class="eyebrow">Tableros</span></div>
    <div class="navgroup">${link('#/equipos', 'wrench', 'Equipos', S.equipment.filter((e) => e.active).length || '')}${link('#/preventivo', 'repeat', 'Preventivo')}${link('#/mascotas', 'user', 'Mascotas', S.pets.length || '')}</div>
    <div class="navgroup foot">${link('#/hechos', 'check', 'Lo que ya se hizo')}${link('#/resumen', 'chart', 'Resumen')}</div>
    ${showStarter() ? starterCard() : ''}
    <p class="phint">Abre una lista y arrastra un pendiente a un día y a una hora.</p>`;
}

// ---------- drawing ----------
const planAfter = () => fetchOpen().then(() => { if (UI.plan) drawPlanner(true); }).catch(() => {});
function drawPlanner(keep = false) {
  const typing = document.activeElement && document.activeElement.id === 'pl-add' ? document.activeElement.value : null;   // a redraw keeps the cursor in the quick-add line
  drawPlanner0(keep);
  const a = typing !== null && $('#pl-add');
  if (a) { a.value = typing; a.focus(); }
}
function drawPlanner0(keep) {
  const today = todayStr();
  if (!P.day || (P.follow && P.day !== today)) P.day = today;
  needBlocks();
  if (F.who === 'mio' && Date.now() - (C.mioAt || 0) > 30000) {
    C.mioAt = Date.now();
    api('GET', '/tasks?view=done&mine=1&limit=30').then((r) => {
      const since = addDays(todayStr(), -30);
      C.mioDone = r.tasks.filter((t) => t.completed_at && localYmd(t.completed_at) >= since);
      if (UI.plan && !wdrag && !tdrag && !sw) drawPlanner(true);
    }).catch(() => {});
  }
  if (typeof P.who === 'number' && !provOf(P.who)) P.who = 'all';
  F.areas = F.areas.filter((id) => areaOf(id));
  if (typeof F.who === 'number' && !provOf(F.who)) F.who = 'all';
  if (isDesk()) {
    const tl0 = $('.tl'), pn0 = $('.panel');
    const pos = keep && tl0 ? { y: tl0.scrollTop, x: tl0.scrollLeft, p: pn0 ? pn0.scrollTop : 0 } : null;
    render(`<div class="dmain"><aside class="panel ${P.panel ? '' : 'collapsed'}" aria-label="Listas">${panelHTML()}</aside>
      <section class="tl ${P.zoom === 'mes' ? 'mes' : ''}" aria-label="${P.zoom === 'mes' ? 'El mes' : P.zoom === 'semana' ? 'La semana' : 'El día'}">${P.zoom === 'mes' ? monthPane() : hoursHTML()}</section></div>`, { tab: P.zoom, cal: true });
    const tl = $('.tl');
    if (pos) { tl.scrollTop = pos.y; tl.scrollLeft = pos.x; if ($('.panel')) $('.panel').scrollTop = pos.p; }
    else if (P.zoom !== 'mes') {   // in the afternoon, open with the hours that are left in view
      const g = $('.grid', tl), nm = nowMin();
      if (g && nm >= 11 * 60) tl.scrollTop = Math.max(0, g.offsetTop + ((Math.min(nm, 16 * 60) - 120 - DAY_START) / 60) * HOUR_H - 80);
    }
  } else {
    render(P.tab === 'dia' ? phoneDay() : P.tab === 'semana' ? phoneWeek() : P.tab === 'mes' ? phoneMonth() : phoneList(P.list), { tab: P.list && isSub(P.list) ? '' : P.tab, keepScroll: keep });
  }
  bindPlanner();
}
function bindPlanner() {
  bindRows(APP, C.open || [], planAfter);
  const q = $('#pl-q');
  if (q) q.oninput = debounce(() => {
    P.q = q.value;
    if (isDesk() && !P.src) {   // typing in the panel's search opens Todo, narrowed down
      const pos = q.selectionStart;
      P.src = 'all'; drawPlanner(true);
      const q2 = $('#pl-q');
      if (q2) { q2.focus(); q2.setSelectionRange(pos, pos); }
      return;
    }
    const L = listHTML(isDesk() ? P.src : P.list);
    $('#pl-items').innerHTML = L.html;
    if ($('#pl-n')) $('#pl-n').textContent = L.n || '';
    bindRows($('#pl-items'), C.open || [], planAfter);
  }, 180);
  $$('[data-clear]', APP).forEach((b) => (b.onclick = () => {
    const c = b.dataset.clear;
    if (c === 'sort') F.sort = 'auto'; else if (c === 'who') F.who = 'all'; else if (c[0] === 'p') F.prios = F.prios.filter((x) => x !== Number(c.slice(1))); else F.areas = F.areas.filter((x) => x !== Number(c));
    saveF(); drawPlanner(true);
  }));
  const qa = $('[data-qadd]', APP);
  if (qa) qa.onsubmit = async (e) => {   // Enter: it is in the list, and the line is ready for the next one
    e.preventDefault();
    const inp = $('#pl-add', qa), title = inp.value.trim(), x = srcOf(qa.dataset.qadd);
    if (!title || qa.dataset.busy) return;
    qa.dataset.busy = 1;
    try {
      const r = await api('POST', '/tasks', { title, priority: x.prio || 3, area_id: x.area || null });
      if (C.open) C.open.push(r.task);
      inp.value = '';
      touch(); drawPlanner(true);
      const again = $('#pl-add'); if (again) again.focus();
      planAfter();
    } catch (err) { delete qa.dataset.busy; toast(err.message, { bad: true }); }
  };
  const hs = $('[data-hidestarter]', APP);
  if (hs) hs.onclick = () => { store('mt_starter', 1); drawPlanner(true); };
}

async function viewPlanner(tab, arg) {
  const src = tab === 'prio' ? 'p' + ([1, 2, 3, 4].includes(arg) ? arg : 3) : tab === 'area' ? 'a' + (arg || 0) : TAB_SRC[tab] || null;
  if (src && !srcOf(src)) { location.replace('#/todo'); return; }   // an area that is no longer there
  if (isDesk()) {
    // one screen on a wide window: a list opens in the panel, beside whichever calendar was up
    if (src) { P.src = src; P.q = ''; saveP(); location.replace(P.zoom === 'semana' ? '#/semana' : P.zoom === 'mes' ? '#/mes' : '#/'); return; }
    P.zoom = tab; saveP();
  } else if (src !== P.list) P.q = '';
  P.tab = tab; P.list = src;
  UI.view = tab; UI.plan = true;
  if (!C.open) {
    loading({ tab });
    try { await fetchOpen(); } catch (e) { UI.plan = false; return errorView(e.message, { tab }); }
  } else if (!C.openAt) {
    try { await fetchOpen(); } catch (e) { toast(e.message, { bad: true }); }   // something was just changed: never paint a list we know is out of date
  } else if (Date.now() - C.openAt > 15000) {
    fetchOpen().then(() => { if (UI.plan && UI.view === tab && !wdrag && !tdrag) drawPlanner(true); }).catch(() => {});   // paint what we have, refresh behind
  }
  if (!UI.plan || UI.view !== tab) return;   // they went somewhere else while it loaded
  drawPlanner();
  UI.refresh = () => fetchOpen().then(() => { if (UI.plan && !wdrag && !tdrag) drawPlanner(true); }).catch(() => {});
}
function stepPlan(n, anim = '') {
  const today = todayStr();
  const view = isDesk() ? P.zoom : P.tab;
  if (view === 'mes' && n) {   // a month at a time; the month we are in stays on today
    const ym = monthShift((P.day || today).slice(0, 7), n);
    P.day = ym === today.slice(0, 7) ? today : ym + '-01';
  } else P.day = n ? addDays(P.day || today, n * (view === 'semana' ? 7 : 1)) : today;
  P.follow = P.day === today;
  drawPlanner(true);
  const mm = anim && $('.mm');
  if (mm) mm.classList.add(anim);
}
matchMedia('(min-width: 960px)').addEventListener('change', () => { if (S.user && !document.body.classList.contains('lock')) route(); });

// ---------- taps: one listener for the whole planner ----------
document.addEventListener('click', (e) => {
  if (!S.user || e.defaultPrevented) return;
  const el = e.target.closest ? e.target : e.target.parentElement;
  if (!el) return;
  // a link inside a sheet: close the sheet properly (its history entry goes), then follow it
  const inSheet = el.closest('#sheet a[href^="#/"]');
  if (inSheet && sheet.closeThen) { e.preventDefault(); const h = inSheet.getAttribute('href'); sheet.closeThen(() => { location.hash = h; }); return; }
  // the views of the ribbon and the top bar take each other's place in history instead of piling up
  const tab = el.closest('a[data-tab]');
  if (tab && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
    e.preventDefault();
    const h = tab.getAttribute('href');
    if ((location.hash || '#/') === h) { if (h === '#/' && UI.plan) stepPlan(0); else window.scrollTo(0, 0); } else location.replace(h);
    return;
  }
  const go = el.closest('[data-go]');
  if (go) {
    const a = go.dataset.go;
    if (a === 'menu') menuSheet();
    else if (a === 'contacts') contactsSheet();
    else if (a === 'panel') { P.panel = !P.panel; saveP(); drawPlanner(true); }
    else if (a === 'areas') { P.areas = !P.areas; saveP(); drawPlanner(true); }
    else if (a === 'fold') { P.unt = !P.unt; saveP(); drawPlanner(true); }
    else if (a === 'filter') filterSheet();
    else if (a === 'block' || a === 'copyweek') { const f = a === 'block' ? () => blockSheet({ day: P.day || todayStr() }) : copyWeekSheet; if (sheet.closeThen && sheet.close) sheet.closeThen(f); else f(); }
    else if (a === 'nofilter') { F.who = 'all'; F.areas = []; F.prios = []; saveF(); drawPlanner(true); }
    return;
  }
  const st = el.closest('[data-step]');
  if (st && UI.plan) { stepPlan(Number(st.dataset.step)); return; }
  const md = el.closest('[data-mday]');
  if (md && UI.plan) {   // a day of the month: it opens in Día
    e.preventDefault();
    P.day = md.dataset.mday; P.follow = P.day === todayStr();
    location.replace('#/');
    return;
  }
  const dy = el.closest('.wstrip [data-day]');
  if (dy && UI.plan) { P.day = dy.dataset.day; P.follow = P.day === todayStr(); drawPlanner(true); return; }
  const sr = el.closest('[data-src]');
  if (sr && UI.plan) { P.src = sr.dataset.src || null; P.q = ''; saveP(); drawPlanner(true); if ($('.panel')) $('.panel').scrollTop = 0; return; }
  // a block of time: administrators edit it; anyone else sees whose and when
  const bk = el.closest('[data-bid]');
  if (bk && UI.plan) { e.preventDefault(); if (!planNoClick) blockTap(Number(bk.dataset.bid)); return; }
  // an empty hour, for an administrator: block time there
  const gr = !el.closest('.card') && el.closest('.grid.canblk');
  if (gr && UI.plan && !planNoClick) {
    const hh = parseFloat(getComputedStyle(gr).getPropertyValue('--hh')) || HOUR_H;
    const m = Math.min(Math.max(Math.floor((DAY_START + ((e.clientY - gr.getBoundingClientRect().top) / hh) * 60) / 30) * 30, DAY_START), DAY_END - 60);
    store('mt_btap', 1);
    blockSheet({ day: gr.dataset.day, start_min: m, end_min: m + 60 });
    return;
  }
  // a pendiente: its sheet opens over the screen you are on (a closed one, or one not in the list, opens its page)
  const body = el.closest('.card[data-tid] .body');
  if (body && !e.metaKey && !e.ctrlKey && !e.shiftKey && openTask(Number(body.parentElement.dataset.tid))) e.preventDefault();
});
document.addEventListener('change', (e) => {
  const s = e.target.closest && e.target.closest('[data-who]');
  if (!s || !UI.plan) return;
  P.who = s.value === 'all' ? 'all' : Number(s.value);
  saveP(); drawPlanner(true);
});
// phones: slide the day sideways to change it, the strip of days to change the week
let swipe = null;
document.addEventListener('touchstart', (e) => {
  const el = e.target.closest && !e.target.closest(SWIPE_SEL) && e.target.closest('[data-swipe]');
  swipe = el && e.touches.length === 1 && UI.plan && !tdrag ? { kind: el.dataset.swipe, x: e.touches[0].clientX, y: e.touches[0].clientY, at: Date.now() } : null;
}, { passive: true });
document.addEventListener('touchend', (e) => {
  const s = swipe;
  swipe = null;
  if (!s || tdrag || !UI.plan || document.body.classList.contains('lock')) return;
  const c = e.changedTouches[0];
  const dx = c.clientX - s.x, dy = c.clientY - s.y;
  if (Math.abs(dx) < 64 || Math.abs(dx) < Math.abs(dy) * 2 || Date.now() - s.at > 700) return;
  const dir = dx < 0 ? 1 : -1;
  if (s.kind === 'week' && P.tab === 'dia') { P.day = addDays(P.day, dir * 7); P.follow = false; drawPlanner(true); $('.mm').classList.add(dir > 0 ? 'in-l' : 'in-r'); } else stepPlan(dir, dir > 0 ? 'in-l' : 'in-r');
}, { passive: true });

// ---------- one pendiente, in a sheet over the calendar ----------
function openTask(id) {
  if (planNoClick) return true;                       // the click that ends a drag opens nothing
  const t = (C.open || []).find((x) => x.id === id);
  if (!t) return false;
  taskSheet(t);
  return true;
}
function taskSheet(t0) {
  const id = t0.id;
  const cur = () => (C.open || []).find((x) => x.id === id) || t0;
  const behind = () => { if (UI.plan) drawPlanner(true); else if (UI.refresh) UI.refresh(); };
  const draw = () => {
    const x = cur();
    const today = todayStr();
    const due = dueInfo(x);
    const tm = timed(x);
    const p = x.provider_id ? provOf(x.provider_id) : null;
    const other = !!x.due_date && x.due_date !== today && x.due_date !== addDays(today, 1);
    const whenBtn = (d, label) => `<button type="button" data-when="${d}" aria-pressed="${x.due_date === d}">${label}</button>`;
    const media = [x.photo_count ? plural(x.photo_count, 'foto', 'fotos') : '', x.note_count ? plural(x.note_count, 'nota', 'notas') : ''].filter(Boolean).join(' y ');
    return `${x.description ? `<p class="tdesc">${esc(x.description)}${x.description.length >= 240 ? '…' : ''}</p>` : ''}
      ${x.note_count ? `<a class="tmedia" href="#/p/${id}"><span class="grow">${plural(x.note_count, 'nota', 'notas')}</span>${ic('chev')}</a>` : ''}
      ${!isAdmin() ? `<div class="grp"><h3 class="eyebrow">Cuándo</h3><p class="twhen">${x.due_date ? `Agendado: ${esc(cap(fmtDay(x.due_date, { weekday: true })))}${tm ? ' a las ' + fmtClock(x.plan_min) : ''}` : 'Espera en la Bandeja a que lo agenden.'}</p>
        <button type="button" class="boardrow" data-whenok><span class="grow"><b>${x.when_ok ? esc(x.when_ok) : '¿Cuándo te conviene?'}</b><span>${x.when_ok ? 'Lo que sugeriste. Tócalo para cambiarlo.' : 'Sugiere un horario; un administrador lo agenda.'}</span></span>${ic('chev')}</button></div>` : `<div class="grp"><h3 class="eyebrow">Cuándo</h3>${x.when_ok ? `<p class="twhen">Le conviene: ${esc(x.when_ok)}</p>` : ''}
        <div class="when">${whenBtn(today, 'Hoy')}${whenBtn(addDays(today, 1), 'Mañana')}<button type="button" data-when="pick" aria-pressed="${other}">${other ? esc(dayName(x.due_date) + (x.due_date.slice(0, 7) === today.slice(0, 7) ? '' : ' ' + MESES[Number(x.due_date.slice(5, 7)) - 1])) : 'Otro día'}</button><button type="button" data-when="" aria-pressed="${!x.due_date}">Sin día</button></div>
        ${isLate(x) ? `<p class="twhen"><span class="due late">${esc(due.text)}</span>${x.postponed ? `<span>Pospuesto ${x.postponed === 1 ? '1 vez' : x.postponed + ' veces'}</span>` : ''}</p>` : x.due_date ? '' : '<p class="twhen">Sin día, espera en la Bandeja.</p>'}</div>
      <div class="grp"><div class="ghead"><h3 class="eyebrow">Hora y duración</h3>${tm ? '<button type="button" class="linkbtn" data-notime>Quitar la hora</button>' : ''}</div>
        <div class="trow"><label class="sr" for="ts-time">Hora</label><input class="input" type="time" id="ts-time" step="900" value="${tm ? pad2(Math.floor(x.plan_min / 60)) + ':' + pad2(x.plan_min % 60) : ''}">
          <div class="stepper" role="group" aria-label="Duración"><button type="button" data-dur="-1" aria-label="Menos tiempo" ${x.est_min ? '' : 'disabled'}>${ic('minus')}</button><div aria-live="polite">${x.est_min ? fmtDur(x.est_min) : 'Sin estimar'}</div><button type="button" data-dur="1" aria-label="Más tiempo" ${x.est_min >= DURS[DURS.length - 1] ? 'disabled' : ''}>${ic('plus')}</button></div></div></div>`}
      <div class="grp"><h3 class="eyebrow">Prioridad</h3>
        <div class="seg" role="radiogroup" aria-label="Prioridad">${[1, 2, 3, 4].map((n) => `<button type="button" role="radio" aria-checked="${x.priority === n}" class="${x.priority === n ? 'on' : ''}" data-prio="${n}">${PRIO[n]}</button>`).join('')}</div></div>
      <div class="grp"><h3 class="eyebrow">Lo hace</h3>
        <button type="button" class="boardrow wide" data-pickwho>${p ? `<span class="grow"><b>${esc(p.name)}</b>${p.kind === 'externo' && (p.specialty || p.company) ? `<span>${esc(p.specialty || p.company)}</span>` : ''}</span>` : '<span class="grow"><b class="un">Sin asignar</b><span>Elige a alguien de la casa o a un contacto</span></span>'}${ic('chev')}</button>
        ${p && p.phone && p.id !== myCard() ? `<div class="callrow"><a class="b line grow" href="${telHref(p.phone)}">${ic('phone')}Llamar</a><button type="button" class="b line wa grow" data-watask>${ic('wa')}WhatsApp</button></div>` : ''}</div>`;
  };
  const by = t0.created_by_name ? `${t0.kind === 'preventivo' ? 'Plan de' : 'Lo reportó'} ${esc(first(t0.created_by_name))} ${esc(ago(localYmd(t0.created_at)))}` : t0.kind === 'preventivo' ? 'Del plan preventivo' : '';
  const stt = t0.status === 'en_proceso' ? '<span class="st go">En curso</span>' : t0.status === 'en_espera' ? `<span class="st wait">${esc(statusText(t0))}</span>` : '';
  sheet({
    title: t0.title, cls: 'tsheet',
    subHtml: `${areaTag(t0)}<span>#${id}</span>${by ? `<span>${by}</span>` : ''}${stt}${t0.equipment_name ? `<span>${ic('wrench')}${esc(t0.equipment_name)}</span>` : ''}`,
    body: `${t0.thumb_id ? `<div id="ts-ph">${photoStrip([{ id: t0.thumb_id }])}</div>` : ''}<div class="pad" id="ts">${draw()}</div>`,
    acts: [{ label: 'Ver todo', cls: 'tonal', value: 'page' }, { label: `${ic('check')}Hecho`, cls: 'ok', value: 'done' }],
    onOpen: (w, close) => {
      // the photo is one tap from full size; when there are more, they come in behind the first
      const ph = $('#ts-ph', w);
      const bindPh = () => { bindStrip(ph); $$('[data-photo]', ph).forEach((el) => (el.onclick = () => openViewer(el.dataset.photo))); };
      if (ph) {
        bindPh();
        if (t0.photo_count > 1) api('GET', '/tasks/' + id).then((d) => { if (ph.isConnected && d.photos && d.photos.length > 1) { ph.innerHTML = photoStrip(d.photos); bindPh(); } }).catch(() => {});
      }
      const box = $('#ts', w);
      const redraw = () => {
        const a = document.activeElement;
        const key = a && box.contains(a) ? ['when', 'dur', 'prio'].map((k) => (a.dataset[k] !== undefined ? `[data-${k}="${a.dataset[k]}"]` : '')).find(Boolean) || (a.id ? '#' + a.id : '') : '';
        box.innerHTML = draw();
        bind();
        const again = key && $(key, box);
        if (again && !again.disabled) again.focus({ preventScroll: true });
      };
      const save = async (data) => {
        const x = cur();
        const before = { due_date: x.due_date, plan_min: x.plan_min, est_min: x.est_min, priority: x.priority };
        const { replan, ...shown } = data;
        Object.assign(x, shown);                      // show it at once
        if (data.due_date === null) x.plan_min = null;
        redraw(); behind();
        try {
          const r = await api('PATCH', '/tasks/' + id, data);
          Object.assign(x, r.task);
          UI.lateN = (C.open || []).filter(isLate).length;
        } catch (e) { Object.assign(x, before); toast(e.message, { bad: true }); }
        if ($('#ts', w) === box) redraw();
        behind();
      };
      const bind = () => {
        $$('[data-when]', box).forEach((b) => (b.onclick = () => {
          const d = b.dataset.when;
          if (d === 'pick') return close('date');
          if (d === (cur().due_date || '')) return;
          save(d ? { due_date: d, replan: 1 } : { due_date: null });
        }));
        const wk = $('[data-whenok]', box);
        if (wk) wk.onclick = () => close('when');
        const tm = $('#ts-time', box);
        if (tm) tm.onchange = () => {
          const x = cur();
          const m = /^(\d\d):(\d\d)/.exec(tm.value);
          if (!m) { if (timed(x)) save({ plan_min: null }); return; }
          const data = { plan_min: Number(m[1]) * 60 + Number(m[2]), replan: 1 };
          if (!x.due_date) data.due_date = P.day && P.day >= todayStr() ? P.day : todayStr();   // an hour needs a day: the one on screen
          if (!x.est_min) data.est_min = 60;
          save(data);
        };
        const nt = $('[data-notime]', box);
        if (nt) nt.onclick = () => save({ plan_min: null });
        $$('[data-dur]', box).forEach((b) => (b.onclick = () => {
          const c = cur().est_min || 0;
          const next = Number(b.dataset.dur) > 0 ? DURS.find((d) => d > c) : [...DURS].reverse().find((d) => d < c) || null;
          if (next === undefined || next === (cur().est_min || null)) return;
          save({ est_min: next });
        }));
        $$('[data-prio]', box).forEach((b) => (b.onclick = () => { const n = Number(b.dataset.prio); if (n !== cur().priority) save({ priority: n }); }));
        $('[data-pickwho]', box).onclick = () => close('who');
        const wt = $('[data-watask]', box);
        if (wt) wt.onclick = () => { const x = cur(), pp = provOf(x.provider_id); if (pp) waTask(x, pp, `Hola ${first(pp.name)}, te pasaron este pendiente de mantenimiento en Dos Búhos:`); };
      };
      bind();
    },
  }).then(async (v) => {
    if (v === 'page') { location.hash = '#/p/' + id; return; }
    if (v === 'done') return completeSheet(cur(), () => (UI.plan ? planAfter() : UI.refresh && UI.refresh()));
    if (v !== 'who' && v !== 'date' && v !== 'when') return;
    // a list to pick from takes the sheet's place; when it is answered the pendiente comes back with the change
    if (v === 'who') await assignSheet(cur(), null); else if (v === 'when') await whenSheet(cur(), null); else await dateSheet(cur(), null);
    try { await fetchOpen(); } catch { /* shows what it has */ }
    behind();
    const x = (C.open || []).find((y) => y.id === id);
    if (x) taskSheet(x);
  });
}

// ---------- Contactos, one tap away ----------
function contactsSheet() {
  const list = activeProviders().map((p) => ({ ...p, open_count: (C.open || []).filter((x) => x.provider_id === p.id).length }));
  sheet({
    title: 'Contactos', cls: 'csheet',
    right: `<a class="tb" href="#/c/nuevo">${ic('plus')}Nuevo</a>`,
    body: `<div class="pad" id="cs-box">${contactsHTML(list, { sheet: true })}<a class="showmore" href="#/contactos">Abrir Contactos</a></div>`,
    onOpen: (w) => {
      const box = $('#cs-box', w);
      const redraw = () => { box.innerHTML = contactsHTML(list, { sheet: true }) + '<a class="showmore" href="#/contactos">Abrir Contactos</a>'; bindContacts(box, list, redraw); };
      bindContacts(box, list, redraw);
    },
  });
}

// ---------- the menu (phones): tableros, prioridades, and what is not a view ----------
function menuSheet() {
  const n = (k) => (C.open ? srcTasks(k, true).length : 0) || '';
  const row = (href, left, label, count = '') => `<a class="rowlink" href="${href}">${left}<span>${label}</span><span class="n">${count}</span>${ic('chev')}</a>`;
  sheet({
    title: 'Tableros', cls: 'msheet',
    body: `<div class="pad">
      <div class="rows">${row('#/equipos', ic('wrench'), 'Equipos', S.equipment.filter((e) => e.active).length || '')}${row('#/preventivo', ic('repeat'), 'Preventivo')}${row('#/mascotas', ic('user'), 'Mascotas', S.pets.length || '')}</div>
      ${isAdmin() ? `<h3 class="eyebrow">Tiempo</h3><div class="rows"><button type="button" class="rowlink" data-go="block">${ic('clock')}<span>Bloquear tiempo</span><span class="n"></span>${ic('chev')}</button><button type="button" class="rowlink" data-go="copyweek">${ic('repeat')}<span>Copiar la semana pasada</span><span class="n"></span>${ic('chev')}</button></div>` : ''}
      <h3 class="eyebrow">Prioridad</h3>
      <div class="rows">${[1, 2, 3, 4].map((p) => row('#/prioridad/' + p, `<i class="pdot p${p}"></i>`, PRIO[p], n('p' + p))).join('')}</div>
      <details class="mfold" ${P.areas ? 'open' : ''}><summary><span class="eyebrow">Áreas</span>${ic('down')}</summary>
        <div class="rows">${activeAreas().map((a) => row('#/area/' + a.id, `<i class="pdot tagc c-${esc(a.color)}"></i>`, esc(a.name), n('a' + a.id))).join('')}${n('a0') ? row('#/area/0', '<i class="pdot tagc c-grey"></i>', 'Sin área', n('a0')) : ''}</div></details>
      <div class="rows last">${row('#/contactos', ic('phone'), 'Contactos')}${row('#/hechos', ic('check'), 'Lo que ya se hizo')}${row('#/resumen', ic('chart'), 'Resumen')}${row('#/cuenta', ic('user'), 'Mi cuenta', esc(first(S.user.name)))}</div></div>`,
    onOpen: (w) => { const f = $('.mfold', w); if (f) f.ontoggle = () => { P.areas = f.open; saveP(); }; },
  });
}

// ---------- dragging with a mouse (press and move 5px, as in Horizonte) ----------
let wdrag = null;
let planNoClick = false;
function dragClean() {
  $$('.card.ghost, .tblk.ghost, .prev').forEach((x) => x.remove());
  $$('.ucol.over, .panel.over, .hcol.over, .mcell.over').forEach((x) => x.classList.remove('over'));
  document.body.classList.remove('wdragging');
}
async function planSave(t, data, msg) {
  const before = { due_date: t.due_date, plan_min: t.plan_min, est_min: t.est_min, provider_id: t.provider_id, provider_name: t.provider_name };
  const { replan, ...shown } = data;
  Object.assign(t, shown);                                   // show it at once
  if (data.due_date === null) t.plan_min = null;
  drawPlanner(true);
  try {
    const r = await api('PATCH', '/tasks/' + t.id, data);
    Object.assign(t, r.task);
    UI.lateN = (C.open || []).filter(isLate).length;
    drawPlanner(true);
    if (msg) toast(msg);
  } catch (e) { Object.assign(t, before); drawPlanner(true); toast(e.message, { bad: true }); }
}
document.addEventListener('pointerdown', (e) => {
  if (!UI.plan || e.pointerType !== 'mouse' || e.button !== 0 || document.body.classList.contains('lock') || !isAdmin()) return;
  const bel = e.target.closest('.dmain .tblk[data-bid]');
  if (bel) {   // a block of time: the same moves as a pendiente on the hours, saved to the block
    const b = BK.list.find((x) => x.id === Number(bel.dataset.bid));
    if (!b) return;
    const r = bel.getBoundingClientRect();
    wdrag = { bk: b, t: { id: -b.id, due_date: b.day, plan_min: b.start_min, est_min: b.end_min - b.start_min }, el: bel, x: e.clientX, y: e.clientY, pid: e.pointerId, on: false, rz: !!e.target.closest('[data-rz]'), grab: ((e.clientY - r.top) / HOUR_H) * 60, target: null, dur: b.end_min - b.start_min };
    return;
  }
  const el = e.target.closest('.dmain .card[data-tid]');
  if (!el || e.target.closest('.ck')) return;
  const t = (C.open || []).find((x) => x.id === Number(el.dataset.tid));
  if (!t) return;
  const r = el.getBoundingClientRect();
  const blk = el.classList.contains('blk');
  wdrag = { t, el, x: e.clientX, y: e.clientY, pid: e.pointerId, on: false, rz: blk && !!e.target.closest('[data-rz]'), grab: blk ? ((e.clientY - r.top) / HOUR_H) * 60 : 0, target: null, dur: durOf(t) };
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
      g.classList.add('ghost'); g.classList.remove('blk', 'short', 'tall', 'split'); g.removeAttribute('style');
      g.style.width = Math.min(d.el.getBoundingClientRect().width, 280) + 'px';
      document.body.appendChild(g); d.ghost = g; d.el.classList.add('lift');
    }
  }
  e.preventDefault();
  if (d.rz) {   // pulling the lower edge: how long it takes
    const st = Math.min(Math.max(d.t.plan_min, DAY_START), DAY_END - 15);
    d.dur = Math.min(Math.max(15, snap(durOf(d.t) + ((e.clientY - d.y) / HOUR_H) * 60)), DAY_END - st);
    d.el.style.height = (d.dur / 60) * HOUR_H - 2 + 'px';
    const sp = $('.meta', d.el);
    if (sp) sp.textContent = `${fmtClock(st)} a ${fmtClock(st + d.dur)}`;
    return;
  }
  d.ghost.style.transform = `translate(${e.clientX + 10}px, ${e.clientY + 8}px)`;
  $$('.prev').forEach((x) => x.remove());
  $$('.ucol.over, .panel.over, .hcol.over, .mcell.over').forEach((x) => x.classList.remove('over'));
  const under = document.elementFromPoint(e.clientX, e.clientY);
  const col = under && under.closest('.grid');
  const ad = under && under.closest('.ucol, .hcol');
  const lp = under && under.closest('.panel');
  const mc = under && under.closest('.mcell[data-day]');
  d.target = null;
  if (mc) { mc.classList.add('over'); d.target = { day: mc.dataset.day, keep: true }; }   // a day of the month
  else if (col) {
    const r = col.getBoundingClientRect();
    const min = Math.min(Math.max(snap(DAY_START + ((e.clientY - r.top) / HOUR_H) * 60 - d.grab), DAY_START), DAY_END - Math.min(d.dur, DAY_END - DAY_START));
    d.target = { day: col.dataset.day, min };
    col.insertAdjacentHTML('beforeend', `<div class="prev" style="top:${((min - DAY_START) / 60) * HOUR_H}px;height:${(Math.min(d.dur, DAY_END - min) / 60) * HOUR_H - 2}px"><span>${fmtClock(min)}</span></div>`);
  } else if (ad) {
    const zone = $(`.ucol[data-day="${ad.dataset.day}"]`) || ad;
    zone.classList.add('over'); d.target = { day: ad.dataset.day, min: null };
  } else if (lp && d.t.due_date) { lp.classList.add('over'); d.target = { un: true }; }
});
document.addEventListener('pointerup', () => {
  const d = wdrag;
  if (!d) return;
  wdrag = null;
  if (!d.on) return;                                        // a plain click: the pendiente opens
  planNoClick = true; setTimeout(() => { planNoClick = false; }, 0);
  dragClean(); d.el.classList.remove('lift');
  if (d.bk) return blockMoved(d);
  const t = d.t;
  if (d.rz) { if (d.dur !== durOf(t) || !t.est_min) planSave(t, { est_min: d.dur }); else drawPlanner(true); return; }
  const tg = d.target;
  if (!tg) return;
  if (tg.un) return planSave(t, { due_date: null }, 'Volvió a la Bandeja');
  if (tg.keep ? tg.day === t.due_date : tg.day === t.due_date && tg.min === (t.plan_min === undefined ? null : t.plan_min)) return;
  const data = tg.keep ? { due_date: tg.day, replan: 1 } : { due_date: tg.day, plan_min: tg.min, replan: 1 };   // dropped on a day of the month, it keeps its hour
  if (!tg.keep && tg.min !== null && !t.est_min) data.est_min = 60;     // an hour until someone says otherwise
  let msg = tg.keep ? `Quedó para ${dayTxt(tg.day)}` : '';
  if (typeof P.who === 'number' && !t.provider_id) { data.provider_id = P.who; msg = `Asignado a ${first((provOf(P.who) || {}).name)}`; }
  planSave(t, data, msg);
});
document.addEventListener('pointercancel', () => { if (wdrag) { if (wdrag.on) { dragClean(); drawPlanner(true); } wdrag = null; } });
document.addEventListener('dragstart', (e) => { if (e.target.closest && e.target.closest('.card')) e.preventDefault(); });

async function blockMoved(d) {
  const b = d.bk, tg = d.target;
  let data = null;
  if (d.rz) { if (d.dur !== b.end_min - b.start_min) data = { end_min: b.start_min + d.dur }; }
  else if (tg && tg.day && tg.min !== null && tg.min !== undefined && !tg.keep && (tg.day !== b.day || tg.min !== b.start_min)) data = { day: tg.day, start_min: tg.min, end_min: tg.min + d.dur };
  if (!data) { drawPlanner(true); return; }
  const before = { ...b };
  Object.assign(b, data); drawPlanner(true);
  try { const r = await api('PATCH', '/blocks/' + b.id, data); Object.assign(b, r.block); }
  catch (e) { Object.assign(b, before); toast(e.message, { bad: true }); }
  drawPlanner(true);
}

// ---------- touch: hold a pendiente, then drop it on a day (the way Horizonte does on a phone) ----------
// Hold 350 ms on a pendiente anywhere. A panel with one day slides in: drop on an hour, on "sin hora" or on
// "a la Bandeja"; take the finger to the left or right edge and the days turn like pages under the pendiente.
const MHPX = 52;
let hold = null;
let tdrag = null;
const dayTxt = (d) => { const x = fmtDay(d, { weekday: true }); return /^(hoy|mañana|ayer)$/.test(x) ? x : 'el ' + x; };
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)');
// What changes in the panel from one day to the next: its title and its blocks.
function ddDay(day) {
  const d = ymdDate(day);
  const today = todayStr();
  const mine = (C.open || []).filter((t) => t.due_date === day && (!tdrag || t.id !== tdrag.t.id));
  const total = mine.reduce((n, t) => n + (t.est_min || 0), 0);
  const blocks = mine.filter(timed).map((t) => {
    const st = Math.min(Math.max(t.plan_min, DAY_START), DAY_END - 15);
    return `<div class="dd-b c-${esc(t.area_color || 'grey')}" style="top:${((st - DAY_START) / 60) * MHPX}px;height:${(Math.min(durOf(t), DAY_END - st) / 60) * MHPX - 2}px">${esc(t.title)}</div>`;
  }).join('');
  const kb = BK.list.filter((b) => b.day === day && (typeof P.who !== 'number' || b.provider_id === P.who)).map((b) => {
    const st = Math.max(b.start_min, DAY_START), en = Math.min(b.end_min, DAY_END);
    return en > st ? `<div class="dd-k" style="top:${((st - DAY_START) / 60) * MHPX}px;height:${((en - st) / 60) * MHPX - 2}px">${esc(b.title)}</div>` : '';
  }).join('');
  const nm = nowMin();
  const rel = day === today ? 'Hoy' : day === addDays(today, 1) ? 'Mañana' : '';
  return {
    title: `<div class="dd-title"><b>${cap(DIAS[d.getDay()])} ${d.getDate()} de ${MESES_L[d.getMonth()]}</b><small>${rel ? `<i>${rel}</i>` : ''}${mine.length ? plural(mine.length, 'pendiente', 'pendientes') + (total ? ', ' + fmtDur(total) : '') : 'Día libre'}</small></div>`,
    grid: `<div class="dd-grid">${kb}${blocks}${day === today && nm >= DAY_START && nm <= DAY_END ? `<div class="wnow" style="top:${((nm - DAY_START) / 60) * MHPX}px"></div>` : ''}</div>`,
  };
}
// Puts `html` in `win` in place of what it shows. With a direction the day turns like a page under the pendiente
// being held: the one on screen leaves toward the side the finger came from, the next comes in from the edge it rests on.
function ddSwap(win, html, dir) {
  $$('.out', win).forEach((x) => x.remove());                // a turn still on its way: let it go
  const old = win.lastElementChild;
  win.insertAdjacentHTML('beforeend', html);
  if (!old) return;
  if (!dir || REDUCED.matches) { old.remove(); return; }
  const neu = win.lastElementChild;
  old.classList.add('out', dir > 0 ? 'to-l' : 'to-r');
  neu.classList.add(dir > 0 ? 'from-r' : 'from-l');
  const done = () => { old.remove(); neu.classList.remove('from-r', 'from-l'); };
  old.addEventListener('animationend', done, { once: true });
  setTimeout(done, 520);                                     // in case the animation never runs (a tab in the background)
}
function ddRender(p, day, dir = 0) {
  if (!p.firstChild) {   // the frame is drawn once: the arrows, the two slots and the hours stay still while the days pass
    let rows = '';
    for (let m = DAY_START; m < DAY_END; m += 60) rows += `<span style="top:${((m - DAY_START) / 60) * MHPX}px">${m / 60}:00</span>`;
    p.innerHTML = `<div class="dd-top"><span class="dd-edge">${ic('back')}</span><div class="dd-mid"><div class="dd-win"></div>${store('mt_edge') ? '' : '<p class="dd-hint">Lleva el dedo a la orilla para cambiar de día.</p>'}</div><span class="dd-edge">${ic('chev')}</span></div>
    <div class="dd-strip"><div class="dd-slot" data-slot="any">Ese día, sin hora</div><div class="dd-slot" data-slot="none">A la Bandeja</div></div>
    <div class="dd-scroll"><div class="dd-in" style="height:${((DAY_END - DAY_START) / 60) * MHPX}px"><div class="dd-hours">${rows}</div><div class="dd-win days"></div></div></div>`;
  }
  const x = ddDay(day);
  p.dataset.day = day;
  p.classList.toggle('first', day <= todayStr());            // nothing before today: the left arrow rests
  const [tw, gw] = $$('.dd-win', p);
  ddSwap(tw, x.title, dir);
  ddSwap(gw, x.grid, dir);
}
function tdStart(h) {
  hold = null;
  if (navigator.vibrate) navigator.vibrate(15);
  const today = todayStr();
  const g = document.createElement('div'); g.className = 'tghost'; g.textContent = h.t.title; document.body.appendChild(g);
  const p = document.createElement('div'); p.className = 'ddrop'; p.setAttribute('aria-hidden', 'true'); document.body.appendChild(p);
  tdrag = { t: h.t, pid: h.pid, ghost: g, panel: p, x: h.x, y: h.y, target: null, dir: 0, edgeT: null, raf: 0 };
  document.body.classList.add('tdragging');
  // it opens on the day you are looking at; a pendiente that already has a day ahead opens on its own
  const start = h.t.due_date && h.t.due_date >= today ? h.t.due_date : UI.plan && P.tab !== 'semana' && P.day && P.day >= today && !isDesk() && P.tab === 'dia' ? P.day : today;
  ddRender(p, start);
  const now = new Date();
  const at = timed(h.t) ? h.t.plan_min : Math.min(Math.max(now.getHours() * 60, 8 * 60), 15 * 60);
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
  $$('.dd-prev', d.panel).forEach((z) => z.remove());
  d.target = null;
  const pr = d.panel.getBoundingClientRect();
  const dir = x < pr.left + 26 ? -1 : x > pr.right - 26 ? 1 : 0;       // the edges change the day
  if (dir !== d.dir) {
    d.dir = dir; clearTimeout(d.edgeT);
    d.panel.classList.toggle('edge-l', dir < 0); d.panel.classList.toggle('edge-r', dir > 0);
    if (dir) d.edgeT = setTimeout(function flip() {
      if (!tdrag || tdrag.dir !== dir) return;
      const nk = addDays(d.panel.dataset.day, dir);
      if (nk < todayStr()) return;
      ddRender(d.panel, nk, dir);                             // the day slides over
      store('mt_edge', 1);                                    // they know the edges now: the hint goes
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
  const grid = $('.dd-grid:not(.out)', d.panel);
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
  planNoClick = true; setTimeout(() => { planNoClick = false; }, 400);
  if (!commit || !d.target) return;
  store('mt_held', 1);                                       // they know how it works: the hint goes
  const t = d.t;
  const day = d.panel.dataset.day;
  let data;
  let msg;
  if (d.target.slot === 'none') { if (!t.due_date) return; data = { due_date: null }; msg = 'Volvió a la Bandeja'; }
  else if (d.target.slot === 'any') { data = { due_date: day, plan_min: null, replan: 1 }; msg = `Quedó para ${dayTxt(day)}`; }
  else { data = { due_date: day, plan_min: d.target.min, replan: 1 }; if (!t.est_min) data.est_min = 60; msg = `Quedó para ${dayTxt(day)} a las ${fmtClock(d.target.min)}`; }
  const undo = { due_date: t.due_date || null, plan_min: t.plan_min === undefined ? null : t.plan_min, replan: 1 };
  patchTask(t, data, msg, () => { if (UI.plan) planAfter(); else if (UI.refresh) UI.refresh(); else route(); }, undo);
}
document.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse' || !S.user || tdrag || document.body.classList.contains('lock') || !isAdmin()) return;
  const el = e.target.closest('.card[data-tid]');
  if (!el || e.target.closest('.ck, [data-rz]')) return;
  const t = (C.open || []).find((x) => x.id === Number(el.dataset.tid));
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
// the click that ends a drag must not open the pendiente
document.addEventListener('click', (e) => { if (planNoClick && e.target.closest && e.target.closest('.card[data-tid], [data-bid]')) { e.preventDefault(); e.stopPropagation(); } }, true);

// ---------- phones: swipe a pendiente right for done, left to delete (as in Horizonte) ----------
// Only administrators delete; a block of time only goes left. A swipe that is not allowed stops short and says why.
const SWIPE_SEL = '.card.in-list[data-tid], .card.in-day[data-tid], .brow[data-bid]';
let sw = null;
function swWhat(s) {
  if (s.el.dataset.bid) { const b = BK.list.find((x) => x.id === Number(s.el.dataset.bid)); return b ? { b } : null; }
  const t = (C.open || []).find((x) => x.id === Number(s.el.dataset.tid));
  return t && isOpen(t) ? { t } : null;
}
const swAllowed = (w, dir) => (dir > 0 ? !!w.t : isAdmin());
document.addEventListener('pointerdown', (e) => {
  sw = null;
  if (e.pointerType === 'mouse' || !S.user || document.body.classList.contains('lock')) return;
  const el = e.target.closest(SWIPE_SEL);
  if (!el || e.target.closest('.ck, .cbtns, button')) return;
  sw = { el, x: e.clientX, y: e.clientY, pid: e.pointerId, on: false, dx: 0 };
});
document.addEventListener('pointermove', (e) => {
  const s = sw;
  if (!s || e.pointerId !== s.pid || tdrag) return;
  const dx = e.clientX - s.x, dy = e.clientY - s.y;
  if (!s.on) {
    if (Math.abs(dy) > 12 && Math.abs(dy) >= Math.abs(dx)) { sw = null; return; }   // scrolling the list
    if (Math.abs(dx) < 14 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    s.what = swWhat(s);
    if (!s.what) { sw = null; return; }
    s.on = true;
    if (hold) { clearTimeout(hold.timer); hold = null; }
    s.el.classList.add('swiping');
    const h = document.createElement('div');
    h.className = 'swipe-hint';
    h.style.cssText = `top:${s.el.offsetTop}px;left:${s.el.offsetLeft}px;width:${s.el.offsetWidth}px;height:${s.el.offsetHeight}px`;
    s.el.parentNode.insertBefore(h, s.el);
    s.hint = h;
  }
  const ok = swAllowed(s.what, dx);
  s.dx = ok ? dx : Math.sign(dx) * Math.min(Math.abs(dx), 34);
  s.el.style.transform = `translateX(${s.dx}px)`;
  const right = dx > 0;
  s.hint.className = `swipe-hint ${right ? 'r' : 'l'} ${ok ? '' : 'no'} ${Math.abs(s.dx) > 80 ? 'go' : ''}`;
  s.hint.innerHTML = right ? (ok ? `${ic('check')}Hecho` : '') : ok ? `Eliminar${ic('trash')}` : 'Solo un administrador elimina';
});
function swReset(s) {
  const c = s.el;
  c.style.transition = 'transform 150ms ease-out'; c.style.transform = '';
  setTimeout(() => { if (s.hint) s.hint.remove(); c.classList.remove('swiping'); c.style.transition = ''; }, 160);
}
function swOut(s, fn) {
  const c = s.el;
  c.style.transition = 'transform 160ms ease-in'; c.style.transform = `translateX(${s.dx > 0 ? 110 : -110}%)`;
  setTimeout(() => { if (s.hint) s.hint.remove(); fn(); }, 150);
}
const swAfter = () => (UI.plan ? planAfter() : UI.refresh ? UI.refresh() : route());
document.addEventListener('pointerup', () => {
  const s = sw;
  sw = null;
  if (!s || !s.on) return;
  planNoClick = true; setTimeout(() => { planNoClick = false; }, 400);
  const w = s.what;
  if (s.dx > 80 && w.t) {
    if (navigator.vibrate) navigator.vibrate(15);
    return swOut(s, () => {
      const t = w.t, data = { status: 'hecha' };
      if (!t.provider_id && myCard()) data.provider_id = myCard();
      if (C.open) C.open = C.open.filter((x) => x.id !== t.id);
      if (UI.plan) drawPlanner(true);
      patchTask(t, data, 'Hecho. Bien.', swAfter, { status: t.status, wait_reason: t.wait_reason || null, ...(data.provider_id ? { provider_id: null } : {}) });
    });
  }
  if (s.dx < -80 && isAdmin()) {
    if (navigator.vibrate) navigator.vibrate(15);
    return swOut(s, () => {
      if (w.b) return deleteBlock(w.b);
      const t = w.t;
      later('Pendiente eliminado', () => api('DELETE', '/tasks/' + t.id), {
        hide: () => { if (C.open) C.open = C.open.filter((x) => x.id !== t.id); if (UI.plan) drawPlanner(true); else s.el.remove(); },
        undo: () => { if (C.open && !C.open.some((x) => x.id === t.id)) C.open.push(t); if (UI.plan) drawPlanner(true); else swAfter(); },
        done: () => { touch(); swAfter(); },
      });
    });
  }
  swReset(s);
});
document.addEventListener('pointercancel', () => { const s = sw; sw = null; if (s && s.on) swReset(s); });
document.addEventListener('touchmove', (e) => { if (sw && sw.on) e.preventDefault(); }, { passive: false });
