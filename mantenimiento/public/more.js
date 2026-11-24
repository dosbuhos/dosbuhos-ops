/* Esmero — Preventivo, Equipos, Contactos, Cuenta, and the router. Needs core.js, app.js and planner.js. */
'use strict';

// ---------- Preventivo: the year, month by month ----------
const PM_ST = {
  done: { icon: 'check', cls: 'ok', label: 'Hecho' },
  open: { icon: 'clock', cls: 'go', label: 'Ya en el calendario' },
  late: { icon: 'alert', cls: 'bad', label: 'Atrasado' },
  future: { icon: 'cal', cls: '', label: 'Programado' },
};
const PM_IDEAS = [
  ['Servicio de refrigeradores', 2], ['Servicio de chillers', 2], ['Fumigación', 4], ['Revisar extintores', 1],
  ['Limpiar trampas de grasa', 12], ['Lavar cisterna y tinacos', 2], ['Probar la planta de luz', 12], ['Desazolvar drenajes', 1],
];
const pmTabs = (cur) => `<div class="seg" role="tablist" aria-label="Vista">
  <a role="tab" aria-selected="${cur === 'year'}" class="${cur === 'year' ? 'on' : ''}" href="#/preventivo">El año</a>
  <a role="tab" aria-selected="${cur === 'plans'}" class="${cur === 'plans' ? 'on' : ''}" href="#/planes">Planes</a></div>`;
const newPlanBtn = `<a class="hbtn" href="#/plan/nuevo">${ic('plus')}Nuevo</a>`;

async function viewPM(query = {}, keep = false) {
  UI.view = 'pm';
  const thisYear = Number(todayStr().slice(0, 4));
  const y = Number(query.y) || thisYear;
  // From July on, this year's page continues into the next one (January … last month), so there is always
  // about a year ahead in view: in November nearly everything that is coming falls in the following year.
  const ahead = y === thisYear && Number(todayStr().slice(5, 7)) >= 7;
  if (!keep) loading({ tab: 'preventivo' });
  let r;
  let nx = null;
  try {
    [r, nx] = await Promise.all([api('GET', '/pm/year?y=' + y), ahead ? api('GET', '/pm/year?y=' + (y + 1)).catch(() => null) : null]);
  } catch (e) { return errorView(e.message, { tab: 'preventivo' }); }
  S.today = r.today;
  const cnt = (st) => r.items.filter((i) => i.status === st).length;
  const curM = r.today.slice(0, 7);
  const lastM = Number(curM.slice(5)) - 1;
  const nextItems = nx ? nx.items.filter((it) => Number(it.date.slice(5, 7)) <= lastM) : [];
  const all = r.items.concat(nextItems);
  const pmRow = (it) => {
    const st = PM_ST[it.status];
    const d = ymdDate(it.date);
    const when = it.status === 'done' && it.done_at ? `Hecho ${fmtDay(localYmd(it.done_at), { rel: false })}` : st.label;
    // the equipment is not said twice when the plan is already named after it
    const what = it.equipment_name ? (it.title.includes(it.equipment_name) ? '' : it.equipment_name) : (it.area_name || '');
    const sub = [what, it.provider_name ? first(it.provider_name) : ''].filter(Boolean).join(', ');
    return `<button type="button" class="pmrow ${st.cls}" data-it="${all.indexOf(it)}">
      <span class="pmday"><b>${d.getDate()}</b><span>${DIAS[d.getDay()].slice(0, 3)}</span></span>
      <span class="grow"><b class="pmt">${esc(it.title)}</b>${sub ? `<span class="ls">${esc(sub)}</span>` : ''}
        <span class="pmst ${st.cls}">${ic(st.icon)}${esc(when)}</span></span>${ic('chev')}</button>`;
  };
  const monthSec = (yy, list) => (name, i) => {
    const key = `${yy}-${pad2(i + 1)}`;
    const items = list.filter((it) => it.date.slice(0, 7) === key);
    const late = items.filter((it) => it.status === 'late').length;
    const past = key < curM;
    // What comes up every month is folded into one line unless it needs attention, so the yearly services stand out.
    const routine = items.filter((it) => it.per_year >= 12 && (it.status === 'future' || it.status === 'done'));
    const main = items.filter((it) => !routine.includes(it));
    const rdone = routine.filter((it) => it.status === 'done').length;
    return `<section class="month ${key === curM ? 'cur' : ''} ${past ? 'past' : ''} ${items.length ? '' : 'none'}" id="${yy === y ? 'm' : 'n'}-${i + 1}">
      <h2 class="mhead">${cap(name)}${key === curM ? '<span class="now">Este mes</span>' : ''}${items.length ? `<span class="n">${items.length}</span>` : ''}${late ? `<span class="mlate">${ic('alert')}${plural(late, 'atrasado', 'atrasados')}</span>` : ''}</h2>
      ${main.length ? `<div class="list">${main.map(pmRow).join('')}</div>` : ''}
      ${routine.length ? `<details class="routine"><summary>${ic('repeat')}<span class="grow"><b>Lo de cada mes</b><span>${esc([...new Set(routine.map((it) => it.title))].join(', '))}</span></span><span class="rn ${rdone === routine.length ? 'ok' : ''}">${rdone ? `${rdone} de ${routine.length} ${rdone === 1 ? 'hecho' : 'hechos'}` : routine.length}</span>${ic('down')}</summary>
        <div class="list">${routine.map(pmRow).join('')}</div></details>` : ''}
      ${items.length ? '' : '<p class="mnone">Nada programado</p>'}
    </section>`;
  };
  const months = MESES_L.map(monthSec(y, r.items)).join('');
  const following = nx ? `<div class="yearnext"><h2>${y + 1}</h2><a href="#/preventivo?y=${y + 1}">Ver todo ${y + 1}${ic('chev')}</a></div>
      ${MESES_L.slice(0, lastM).map(monthSec(y + 1, nextItems)).join('')}` : '';
  const empty = !r.items.length && !r.plans;
  render(header('Preventivo', { right: newPlanBtn }) + `<div class="wrap">
    ${pmTabs('year')}
    ${empty ? `<div class="empty"><h2>Todavía no hay nada programado</h2>
        <p>Aquí va lo que se repite: el servicio de los refrigeradores, la fumigación, los extintores. Lo programas una vez y la app lo pone en el calendario cuando toca.</p>
        <a class="b" href="#/plan/nuevo">${ic('plus')}Programar el primero</a></div>
      <h2 class="sec">Ideas para empezar</h2>
      <div class="ideas">${PM_IDEAS.map(([t, n]) => `<a class="idea" href="#/plan/nuevo?t=${encodeURIComponent(t)}&n=${n}"><b>${esc(t)}</b><span>${n === 12 ? 'Cada mes' : plural(n, 'vez al año', 'veces al año')}</span></a>`).join('')}</div>`
      : `<div class="yearbar"><a class="ib line" href="#/preventivo?y=${y - 1}" aria-label="Año anterior">${ic('back')}</a><h2>${y}</h2><a class="ib line" href="#/preventivo?y=${y + 1}" aria-label="Año siguiente">${ic('chev')}</a></div>
      <p class="ysum">${r.items.length ? `${cnt('done') ? `<span class="ok">${ic('check')}${plural(cnt('done'), 'hecho', 'hechos')}</span>` : ''}${cnt('late') ? `<span class="bad">${ic('alert')}${plural(cnt('late'), 'atrasado', 'atrasados')}</span>` : ''}${cnt('future') + cnt('open') ? `<span>${ic('cal')}${cnt('future') + cnt('open')} por venir</span>` : ''}` : nextItems.length ? `Nada en ${y}. Lo que sigue cae en ${y + 1}.` : 'Nada programado este año.'}</p>
      ${months}${following}`}
  </div>`, { tab: 'preventivo', keepScroll: keep });
  $$('[data-it]', APP).forEach((b) => (b.onclick = async () => {
    const it = all[Number(b.dataset.it)];
    if (it.task_id) { location.hash = '#/p/' + it.task_id; return; }
    const v = await sheet({
      title: it.title, sub: `${it.status === 'late' ? 'Tocaba' : 'Toca'} ${fmtDay(it.date, { weekday: true })}${it.equipment_name && !it.title.includes(it.equipment_name) ? ', ' + it.equipment_name : ''}`,
      opts: [{ value: 'run', label: 'Hacerlo ya', sub: 'Lo pone en el día de hoy', icon: 'play' }, { value: 'plan', label: 'Ver o cambiar el plan', sub: 'Fechas, quién lo hace, cada cuándo', icon: 'repeat' }],
    });
    if (v === 'plan') location.hash = '#/plan/' + it.pm_id;
    if (v === 'run') {
      try { const x = await api('POST', `/pm/${it.pm_id}/run`); touch(); if (x.task_id) location.hash = '#/p/' + x.task_id; else viewPM(query, true); } catch (e) { toast(e.message, { bad: true }); }
    }
  }));
  if (!keep && y === thisYear && !empty) {
    const cur = $('.month.cur');
    const first6 = Number(curM.slice(5)) > 1;
    // the current month lands right under whatever is stuck to the top (the bar on a wide screen, the title)
    const under = (isDesk() ? NAV.offsetHeight : 0) + ($('.mh') ? $('.mh').offsetHeight : 0) + 14;
    if (cur && first6) requestAnimationFrame(() => window.scrollTo(0, Math.max(0, cur.getBoundingClientRect().top + window.scrollY - under)));
  }
  UI.refresh = () => viewPM(query, true);
}

async function viewPlans() {
  UI.view = 'plans';
  loading({ tab: 'preventivo' });
  let r;
  try { r = await api('GET', '/pm'); } catch (e) { return errorView(e.message, { tab: 'preventivo' }); }
  S.today = r.today;
  render(header('Preventivo', { right: newPlanBtn }) + `<div class="wrap">
    ${pmTabs('plans')}
    ${r.pm.length ? `<div class="list">${r.pm.map((p) => {
      const late = p.next_due < r.today;
      return `<a class="lrow" href="#/plan/${p.id}"><span class="lth ico">${ic('repeat')}</span><span class="grow"><b>${esc(p.title)}</b>
        <span class="ls">${esc(cap([p.equipment_name && !p.title.includes(p.equipment_name) ? p.equipment_name : (p.equipment_name ? '' : p.area_name), p.every_text].filter(Boolean).join(', ')))}</span>
        <span class="ls ${late ? 'bad' : ''}">${late ? ic('alert') : ''}${p.last_status && OPEN.includes(p.last_status) ? 'Ya está en el calendario; el siguiente, ' : late ? 'Tocaba ' : 'Toca '}${esc(fmtDay(p.next_due, { weekday: true }))}</span></span>${ic('chev')}</a>`;
    }).join('')}</div>`
      : `<div class="empty"><h2>No hay planes</h2><p>Un plan es algo que se repite: cada mes, dos veces al año, cada año.</p><a class="b" href="#/plan/nuevo">${ic('plus')}Programar el primero</a></div>`}
  </div>`, { tab: 'preventivo' });
}

async function viewPlan(id) {
  UI.view = 'plan';
  loading({ tab: 'preventivo' });
  let r;
  try { r = await api('GET', '/pm/' + id); } catch (e) { return errorView(e.message, { tab: 'preventivo' }); }
  const p = r.pm;
  S.today = r.today;
  const waiting = p.last_status && OPEN.includes(p.last_status);
  const fact = (l, v) => `<div class="cell static"><div class="cmain"><span class="cl">${l}</span><span class="cv">${v}</span></div></div>`;
  render(header('Plan', { back: true }) + `<div class="wrap detail">
    <div class="hero"><div class="hmeta">${p.area_name ? tag(p.area_name, p.area_color) : ''}${p.active ? '' : '<span class="pill off">Terminado</span>'}</div>
      <h2>${esc(p.title)}</h2>${p.description ? `<p class="desc">${esc(p.description)}</p>` : ''}</div>
    <div class="cells">
      ${fact('Cada cuándo', esc(cap(p.every_text)))}
      ${p.active ? fact(waiting ? 'Después toca' : 'Toca', `${esc(fmtDay(p.next_due, { weekday: true, rel: false }))}<span class="csub">Aparece en el calendario ${p.lead_days ? plural(p.lead_days, 'día', 'días') + ' antes' : 'ese día'}</span>`) : ''}
      ${p.equipment_id ? `<div class="cell"><a class="cmain" href="#/e/${p.equipment_id}"><span class="cl">Equipo</span><span class="cv">${esc(p.equipment_name)}</span>${ic('chev')}</a></div>` : ''}
      ${fact('Lo hace', p.provider_name ? esc(p.provider_name) : '<span class="un">Sin asignar</span>')}
    </div>
    <h2 class="sec">Lo que ha salido de este plan<span class="n">${r.tasks.length}</span></h2>
    ${r.tasks.length ? `<div class="list">${r.tasks.map((t) => taskRow(t, { done: false })).join('')}</div>` : '<p class="small">Todavía nada. El primero aparece en el calendario cuando se acerque la fecha.</p>'}
    ${p.active ? `<button class="b plain danger block" data-del>${ic('trash')}Quitar este plan</button>` : ''}
  </div>`, { tab: 'preventivo', bar: p.active ? `<a class="b tonal ${waiting ? 'grow' : ''}" href="#/plan/${id}/editar">${ic('edit')}Cambiar</a>${waiting ? '' : `<button class="b grow" data-run>${ic('play')}Hacerlo ya</button>`}` : '' });
  const run = $('[data-run]');
  if (run) run.onclick = async () => {
    run.disabled = true;
    try { const x = await api('POST', `/pm/${id}/run`); touch(); if (x.task_id) location.hash = '#/p/' + x.task_id; } catch (e) { toast(e.message, { bad: true }); run.disabled = false; }
  };
  const del = $('[data-del]');
  if (del) del.onclick = async () => {
    if (!(await confirmSheet('¿Quitar este plan?', 'Ya no va a crear pendientes. Lo que ya se hizo se queda en el historial.', 'Quitar', true))) return;
    try { await api('DELETE', '/pm/' + id); toast('Plan quitado'); goBack('#/planes'); } catch (e) { toast(e.message, { bad: true }); }
  };
}

const FREQS = [{ v: '1', label: '1 vez al año' }, { v: '2', label: '2 veces al año' }, { v: '3', label: '3 veces al año' }, { v: '4', label: '4 veces al año' }, { v: '12', label: 'Cada mes' }, { v: 'every', label: 'Cada cierto tiempo' }, { v: 'once', label: 'Una sola vez' }];
async function viewPlanForm(id, query = {}) {
  UI.view = 'planform';
  let p = null;
  if (id) {
    loading({ tab: 'preventivo' });
    try { p = (await api('GET', '/pm/' + id)).pm; } catch (e) { return errorView(e.message, { tab: 'preventivo' }); }
  }
  const eq0 = !p && query.equipo ? S.equipment.find((e) => e.id === Number(query.equipo)) : null;
  const today = todayStr();
  let months = p && p.unit === 'months' ? String(p.months || '').split(',').map(Number).filter(Boolean) : spreadMonths(Number(query.n) || 2);
  let freq = !p ? String(Number(query.n) || 2) : p.unit === 'months' ? (['1', '2', '3', '4', '12'].includes(String(months.length)) ? String(months.length) : 'n') : p.unit === 'once' ? 'once' : 'every';
  const st = { title: p ? p.title : (query.t || (eq0 ? `Servicio: ${eq0.name}` : '')), equipment_id: p ? p.equipment_id : eq0 ? eq0.id : '', area_id: p ? p.area_id : eq0 ? eq0.area_id : '', provider_id: p ? p.provider_id : eq0 ? eq0.provider_id : '' };
  render(header(p ? 'Editar plan' : 'Programar', { back: true }) + `<form class="wrap form" id="pf" novalidate>
    ${fInput('pf-title', '¿Qué hay que hacer?', { value: st.title, placeholder: 'Ej. Servicio de refrigeradores', attrs: 'list="pf-ideas" autocomplete="off"' })}
    <datalist id="pf-ideas">${PM_IDEAS.map(([t]) => `<option value="${t}">`).join('')}</datalist>
    <div class="field"><span class="flabel">¿Cada cuándo?</span>${choice('pf-freq', FREQS, freq, { cls: 'wrapc' })}</div>
    <div class="field" id="pf-months"><span class="flabel">¿En qué meses?</span>${monthGrid(months)}
      <div class="inline"><label class="flabel" for="pf-day">Día del mes</label><input class="input num" id="pf-day" type="number" inputmode="numeric" min="1" max="28" value="${(p && p.day) || 1}"></div></div>
    <div class="field hidden" id="pf-every"><span class="flabel">Cada</span>
      <div class="inline2"><label class="sr" for="pf-n">Número</label><input class="input num" id="pf-n" type="number" inputmode="numeric" min="1" max="365" value="${(p && p.every_n) || 1}">
        <label class="sr" for="pf-unit">Unidad</label><select class="input" id="pf-unit">${[['day', 'días'], ['week', 'semanas'], ['month', 'meses']].map(([v, l]) => `<option value="${v}" ${(p ? p.unit : 'week') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>
    <div class="field hidden" id="pf-datebox"><label class="flabel" for="pf-date" id="pf-datelbl">Empieza el</label>
      <input class="input" id="pf-date" type="date" value="${p && p.unit !== 'months' ? p.next_due : addDays(today, 7)}"></div>
    <p class="plansum" id="pf-sum" aria-live="polite"></p>
    ${S.equipment.some((e) => e.active) ? fSelect('pf-equip', '¿A qué equipo?', equipmentOptions('', st.equipment_id, 'A ninguno en particular'), { optional: true }) : ''}
    <div id="pf-areabox">${areaSelect('pf-area', st.area_id, { empty: 'Sin área' })}</div>
    ${fSelect('pf-who', '¿Quién lo hace?', contactOptions(st.provider_id, unassignedLabel()))}
    ${fSelect('pf-lead', 'Ponerlo en el calendario', [[0, 'El mismo día'], [3, '3 días antes'], [7, 'Una semana antes'], [14, '2 semanas antes'], [30, 'Un mes antes']].map(([v, l]) => `<option value="${v}" ${(p ? p.lead_days : 7) === v ? 'selected' : ''}>${l}</option>`).join(''))}
    ${fText('pf-desc', 'Instrucciones', { value: p ? p.description : '', optional: true, placeholder: '1. Revisar…\n2. Limpiar…\n3. Anotar…', hint: 'Escribe los pasos numerados (1. 2. 3.) y cada uno será una casilla para marcar.' })}
    <p class="err hidden" id="pf-err" role="alert"></p>
  </form>`, { tab: 'preventivo', bar: `<button class="b block lg" form="pf" type="submit" id="pf-save">${ic('check')}${p ? 'Guardar cambios' : 'Programar'}</button>` });
  const mg = bindMonthGrid(APP, (ms) => {
    months = ms;
    freq = ['1', '2', '3', '4', '12'].includes(String(ms.length)) ? String(ms.length) : 'n';
    $$('[data-choice="pf-freq"] .ch').forEach((b) => { const on = b.dataset.v === freq; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); });
    sync();
  });
  bindChoice(APP, 'pf-freq', (v) => {
    freq = v;
    if (/^\d+$/.test(v) && months.length !== Number(v)) { months = spreadMonths(Number(v)); mg.set(months); }
    sync();
  });
  const getArea = bindAreaSelect('pf-area').area;
  const eqSel = $('#pf-equip');
  const syncEq = () => { $('#pf-areabox').classList.toggle('hidden', !!(eqSel && eqSel.value)); };
  if (eqSel) eqSel.onchange = () => {
    syncEq();
    const e = S.equipment.find((x) => x.id === Number(eqSel.value));
    if (e && !$('#pf-title').value.trim()) $('#pf-title').value = `Servicio: ${e.name}`;
    if (e && e.provider_id && !$('#pf-who').value) $('#pf-who').value = e.provider_id;
  };
  function sync() {
    const byMonth = /^\d+$/.test(freq) || freq === 'n';
    $('#pf-months').classList.toggle('hidden', !byMonth);
    $('#pf-every').classList.toggle('hidden', freq !== 'every');
    $('#pf-datebox').classList.toggle('hidden', byMonth);
    $('#pf-datelbl').textContent = freq === 'once' ? '¿Qué día?' : 'Empieza el';
    const day = Math.min(28, Math.max(1, Number($('#pf-day').value) || 1));
    const n = Math.max(1, Number($('#pf-n').value) || 1);
    const unit = $('#pf-unit').value;
    const U = { day: ['día', 'días'], week: ['semana', 'semanas'], month: ['mes', 'meses'] }[unit];
    $('#pf-sum').textContent = byMonth ? (months.length ? `${monthsText(months)}, el día ${day}.` : 'Elige al menos un mes.')
      : freq === 'once' ? ($('#pf-date').value ? `Una sola vez, el ${fmtDay($('#pf-date').value, { weekday: true, rel: false })}.` : 'Elige el día.')
        : `Cada ${n > 1 ? n + ' ' + U[1] : U[0]}${$('#pf-date').value ? `, empezando el ${fmtDay($('#pf-date').value, { weekday: true, rel: false })}` : ''}.`;
  }
  ['pf-day', 'pf-n', 'pf-unit', 'pf-date'].forEach((k) => ($('#' + k).oninput = sync));
  syncEq(); sync();
  $('#pf').onsubmit = async (e) => {
    e.preventDefault();
    const err = $('#pf-err');
    clearErrs(APP);
    err.classList.add('hidden');
    const title = $('#pf-title').value.trim();
    if (!title) return fieldErr($('#pf-title'), 'Escribe qué hay que hacer');
    const byMonth = /^\d+$/.test(freq) || freq === 'n';
    if (byMonth && !months.length) return fieldErr($('[data-months]'), 'Elige al menos un mes');
    if (!byMonth && !$('#pf-date').value) return fieldErr($('#pf-date'), freq === 'once' ? 'Elige el día' : 'Elige desde cuándo');
    const data = {
      title, description: $('#pf-desc').value, equipment_id: eqSel ? eqSel.value || null : null, area_id: getArea() || null,
      provider_id: $('#pf-who').value || null, lead_days: Number($('#pf-lead').value),
      unit: byMonth ? 'months' : freq === 'once' ? 'once' : $('#pf-unit').value,
      months, day: Math.min(28, Math.max(1, Number($('#pf-day').value) || 1)), every_n: Number($('#pf-n').value) || 1,
      next_due: byMonth ? null : $('#pf-date').value,
    };
    const btn = $('#pf-save');
    btn.disabled = true;
    try {
      if (p) await api('PATCH', '/pm/' + id, data); else await api('POST', '/pm', data);
      touch();
      toast(p ? 'Plan guardado' : 'Programado');
      if (inAppNavs > 0) history.back(); else location.replace('#/preventivo');
    } catch (ex) { btn.disabled = false; err.textContent = ex.message; err.classList.remove('hidden'); err.scrollIntoView({ block: 'center' }); }
  };
}

// ---------- Equipos ----------
// How an equipment stands on service: late, soon (30 days), fine, or no plan at all.
function svcState(e) {
  const today = todayStr();
  if (!e.next_service) return { cls: 'none', text: 'Sin plan de servicio', short: 'Sin plan', icon: 'info' };
  const diff = daysBetween(today, e.next_service);
  if (diff < 0) return { cls: 'bad', text: `Servicio atrasado ${-diff === 1 ? 'desde ayer' : -diff + ' días'}`, short: -diff === 1 ? 'Atrasado desde ayer' : `Atrasado ${-diff} días`, icon: 'alert' };
  if (diff <= 30) return { cls: 'warn', text: `Le toca servicio ${diff === 0 ? 'hoy' : diff === 1 ? 'mañana' : 'el ' + fmtDay(e.next_service)}`, short: diff === 0 ? 'Le toca hoy' : diff === 1 ? 'Le toca mañana' : `En ${diff} días`, icon: 'clock' };
  return { cls: 'ok', text: `Al día, le toca el ${fmtDay(e.next_service)}`, short: 'Al día', icon: 'check' };
}
// The service record of an equipment: when it was last serviced, and when it is due.
function svcRecord(e) {
  const st = svcState(e);
  const last = e.last_service ? localYmd(e.last_service) : null;
  return `<div class="svc">
    <div class="${last ? '' : 'none'}"><span>Último servicio</span><b>${last ? esc(fmtDay(last, { rel: false })) : 'Sin anotar'}</b>${last ? `<i>${esc(cap(ago(last)))}</i>` : ''}</div>
    <div class="${st.cls}"><span>Próximo servicio</span><b>${e.next_service ? esc(fmtDay(e.next_service, { rel: false })) : 'Sin programar'}</b>${e.next_service ? `<i>${ic(st.icon)}${esc(st.short)}</i>` : ''}</div>
  </div>`;
}

async function viewEquipos() {
  UI.view = 'equipos';
  loading({ tab: 'equipos' });
  let r;
  try { r = await api('GET', '/equipment'); } catch (e) { return errorView(e.message, { tab: 'equipos' }); }
  S.today = r.today;
  const list = r.equipment;
  const draw = (q = '') => {
    const s = fold(q.trim());
    const shown = s ? list.filter((e) => fold([e.name, e.brand_model, e.location, e.area_name, e.serial].join(' ')).includes(s)) : list;
    const keys = [...new Set(shown.map((e) => e.area_id || 0))].sort((a, b) => (a === 0) - (b === 0));
    return shown.length ? keys.map((k) => {
      const items = shown.filter((e) => (e.area_id || 0) === k);
      return `<section><h2 class="sec">${k ? tag(items[0].area_name, items[0].area_color) : 'Sin área'}<span class="n">${items.length}</span></h2><div class="list">${items.map((e) => {
        const st = svcState(e);
        return `<a class="lrow eq" href="#/e/${e.id}">${e.cover_id ? `<img class="lth big" loading="lazy" src="/api/photos/${e.cover_id}?t=1" alt="">` : `<span class="lth big ph0">${ic('wrench')}</span>`}
          <span class="grow"><b>${esc(e.name)}</b>${e.brand_model ? `<span class="ls">${esc(e.brand_model)}</span>` : ''}
            <span class="ls st ${st.cls}">${ic(st.icon)}${esc(st.text)}</span>
            ${e.last_service ? `<span class="ls">Último servicio ${esc(ago(localYmd(e.last_service)))}</span>` : ''}
            ${e.open_count ? `<span class="ls warn">${ic('tasks')}${plural(e.open_count, 'pendiente abierto', 'pendientes abiertos')}</span>` : ''}</span>${ic('chev')}</a>`;
      }).join('')}</div></section>`;
    }).join('') : `<div class="empty"><h2>Nada con «${esc(q)}»</h2></div>`;
  };
  render(header('Equipos', { right: `<a class="hbtn" href="#/e/nuevo">${ic('plus')}Nuevo</a>` }) + `<div class="wrap">
    ${list.length > 7 ? `<div class="searchbar">${ic('search')}<label class="sr" for="eq-q">Buscar equipo</label><input id="eq-q" type="search" placeholder="Buscar equipo" autocomplete="off"></div>` : ''}
    ${list.length ? `<div id="eq-list">${draw()}</div>`
      : `<div class="empty"><h2>Todavía no hay equipos</h2><p>Da de alta lo que necesita servicio: refrigeradores, chillers, bombas, la planta de luz. Con una foto y el nombre basta.</p>
        <a class="b" href="#/e/nuevo">${ic('camera')}Agregar el primero</a></div>`}
  </div>`, { tab: 'equipos' });
  const q = $('#eq-q');
  if (q) q.oninput = () => { $('#eq-list').innerHTML = draw(q.value); };
}

async function viewEquipo(id, keep = false) {
  UI.view = 'equipo';
  if (!keep) loading({ tab: 'equipos' });
  let d;
  try { d = await api('GET', '/equipment/' + id); } catch (e) { return errorView(e.message, { tab: 'equipos' }); }
  S.today = d.today;
  const e = d.equipment;
  const reload = () => viewEquipo(id, true);
  const st = svcState(e);
  const open = d.tasks.filter(isOpen);
  const hist = d.tasks.filter((t) => t.status === 'hecha');
  const kindLabel = (t) => (t.kind === 'servicio' ? 'Servicio' : t.kind === 'preventivo' ? 'Preventivo' : 'Reparación');
  const fact = (label, value, cls = '') => `<div class="fact ${cls}"><span>${label}</span><b>${value}</b></div>`;
  const more = [e.location && ['Ubicación', esc(e.location)], e.serial && ['No. de serie', esc(e.serial)],
    e.warranty_until && ['Garantía', `${e.warranty_until < d.today ? 'Venció el' : 'Hasta el'} ${esc(fmtDay(e.warranty_until, { rel: false }))}`],
    e.manual_url && ['Manual', `<a class="link" href="${esc(e.manual_url)}" target="_blank" rel="noopener">Abrir${ic('ext')}</a>`],
    d.year_cost ? ['Gastado este año', money(d.year_cost)] : null, e.notes && ['Notas', esc(e.notes)]].filter(Boolean);
  render(header('Equipo', { back: true, right: `<a class="ib" href="#/e/${id}/editar" aria-label="Editar">${ic('edit')}</a>` }) + `<div class="wrap detail">
    ${e.cover_id ? `<button class="cover" data-photo="${e.cover_id}" data-uid="${(d.photos[0] || {}).user_id}" aria-label="Ver foto"><img src="/api/photos/${e.cover_id}" alt="Foto de ${esc(e.name)}"></button>` : ''}
    <div class="hero"><div class="hmeta">${e.area_name ? tag(e.area_name, e.area_color) : ''}</div><h2>${esc(e.name)}</h2>${e.brand_model ? `<p class="by">${esc(e.brand_model)}</p>` : ''}</div>
    ${svcRecord(e)}
    <div class="facts">${fact('Abiertos', open.length, open.length ? 'warn' : '')}${fact('Fallas en 90 días', e.fails_90, e.fails_90 >= 2 ? 'bad' : '')}${fact('Servicios', hist.filter((t) => t.kind !== 'tarea').length)}</div>
    <div class="cells">
      <div class="cell"><a class="cmain" href="#/e/${id}/editar"><span class="cl">Lo atiende</span><span class="cv">${e.provider_id ? `${esc(e.provider_name)}${e.provider_kind === 'externo' ? `<span class="csub">${e.provider_specialty ? esc(e.provider_specialty) + ', externo' : 'Externo'}</span>` : ''}` : '<span class="un">Nadie todavía</span>'}</span>${ic('chev')}</a>
        ${e.provider_phone ? `<div class="cunder"><a class="b line sm" href="${telHref(e.provider_phone)}">${ic('phone')}Llamar</a><a class="b line sm wa" target="_blank" rel="noopener" href="${waHref(e.provider_phone, `Hola ${first(e.provider_name)}, te escribo de Dos Búhos por el equipo: ${e.name}${e.brand_model ? ' (' + e.brand_model + ')' : ''}.`)}">${ic('wa')}WhatsApp</a></div>` : ''}</div>
    </div>
    <h2 class="sec">Servicio programado<span class="n">${d.pm.length}</span></h2>
    ${d.pm.length ? `<div class="list">${d.pm.map((p) => `<a class="lrow" href="#/plan/${p.id}"><span class="lth ico">${ic('repeat')}</span><span class="grow"><b>${esc(p.title)}</b><span class="ls">${esc(cap(p.every_text))}</span><span class="ls ${p.next_due < d.today ? 'bad' : ''}">${p.next_due < d.today ? 'Tocaba' : 'Toca'} ${esc(fmtDay(p.next_due, { weekday: true }))}</span></span>${ic('chev')}</a>`).join('')}</div>` : ''}
    <a class="b tonal block" href="#/plan/nuevo?equipo=${id}">${ic('plus')}${d.pm.length ? 'Programar otro servicio' : 'Programar su servicio'}</a>
    ${open.length ? `<h2 class="sec warn">Abiertos<span class="n">${open.length}</span></h2><div class="list">${open.map((t) => taskRow(t)).join('')}</div>` : ''}
    <h2 class="sec">Historial<span class="n">${hist.length}</span></h2>
    ${hist.length ? `<ul class="hist">${hist.map((t) => `<li><a href="#/p/${t.id}"><span class="hd">${esc(fmtDay(localYmd(t.completed_at), { rel: false }))}<span>${esc(ago(localYmd(t.completed_at)))}</span></span>
        <span class="grow"><b>${esc(t.title)}</b><span class="ls"><span class="pill ${t.kind === 'tarea' ? 'hi' : ''}">${kindLabel(t)}</span>${bits([t.provider_name ? first(t.provider_name) : '', t.cost ? money(t.cost) : ''])}</span></span>${ic('chev')}</a></li>`).join('')}</ul>`
      : '<p class="small">Todavía no hay servicios ni reparaciones anotados.</p>'}
    <h2 class="sec">Fotos<span class="n">${d.photos.length}</span></h2>
    <div id="e-photos">${photoGrid(d.photos, 'e-file', { label: 'Agregar foto' })}</div>
    ${more.length ? `<h2 class="sec">Más datos</h2><dl class="dl">${more.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>` : ''}
  </div>`, { tab: 'equipos', keepScroll: keep, bar: `<a class="b tonal" href="#/nuevo?equipo=${id}">${ic('alert')}Reportar falla</a><a class="b grow" href="#/e/${id}/servicio">${ic('check')}Anotar servicio</a>` });
  bindPhotoGrid(APP, 'e-file', `/equipment/${id}/photos`, reload);
  bindRows(APP, d.tasks, reload);
  UI.refresh = reload;
}

async function viewEquipoForm(id) {
  UI.view = 'equipoform';
  let e = null;
  if (id) {
    loading({ tab: 'equipos' });
    try { e = (await api('GET', '/equipment/' + id)).equipment; } catch (ex) { return errorView(ex.message, { tab: 'equipos' }); }
  }
  const files = [];
  let months = [];
  render(header(e ? 'Editar equipo' : 'Nuevo equipo', { back: true }) + `<form class="wrap form" id="ef" novalidate>
    ${e ? '' : `<div class="field"><span class="flabel">Foto</span>${pickerHtml('ef-pick')}<p class="hint">Tómale una al equipo y otra a su placa de datos: así no hay que escribir el modelo ni la serie.</p></div>`}
    ${fInput('ef-name', 'Nombre', { value: e ? e.name : '', placeholder: 'Ej. Refrigerador de la barra', max: 120, attrs: 'autocomplete="off"' })}
    ${areaSelect('ef-area', e ? e.area_id : '', { label: '¿Dónde está?', empty: 'Sin área' })}
    ${fInput('ef-model', 'Marca y modelo', { value: e ? e.brand_model : '', placeholder: 'Ej. Torrey R-36', optional: true, attrs: 'autocomplete="off"' })}
    ${fSelect('ef-who', '¿Quién lo atiende?', contactOptions(e ? e.provider_id : '', 'Nadie todavía'), { hint: 'A quién se le habla cuando falla o le toca servicio. Si no está en la lista, agrégalo en Contactos.' })}
    ${e ? '' : `<div class="field"><span class="flabel">¿Cada cuándo le toca servicio?</span>
        ${choice('ef-freq', [{ v: '0', label: 'No sé todavía' }, { v: '1', label: '1 vez al año' }, { v: '2', label: '2 veces al año' }, { v: '3', label: '3 veces al año' }, { v: '4', label: '4 veces al año' }, { v: '12', label: 'Cada mes' }], '0', { cls: 'wrapc' })}
        <div id="ef-months" class="hidden"><span class="flabel">¿En qué meses?</span>${monthGrid([])}<p class="plansum" id="ef-sum"></p></div></div>
      ${fInput('ef-last', '¿Cuándo fue su último servicio?', { type: 'date', optional: true, attrs: `max="${todayStr()}"`, hint: 'Aunque sea aproximado. Queda como el primer renglón de su historial.' })}`}
    <details class="more" ${e && (e.serial || e.location || e.warranty_until || e.manual_url || e.notes) ? 'open' : ''}><summary>Más datos ${optTxt}${ic('down')}</summary>
      ${fInput('ef-serial', 'No. de serie', { value: e ? e.serial : '', max: 120, attrs: 'autocomplete="off"' })}
      ${fInput('ef-loc', 'Ubicación exacta', { value: e ? e.location : '', placeholder: 'Ej. Cocina, junto a la estufa', attrs: 'autocomplete="off"' })}
      ${fInput('ef-war', 'Garantía hasta', { value: e ? e.warranty_until : '', type: 'date' })}
      ${fInput('ef-manual', 'Liga al manual', { value: e ? e.manual_url : '', type: 'url', placeholder: 'https://', max: 500, attrs: 'autocapitalize="none" autocomplete="off"' })}
      ${fText('ef-notes', 'Notas', { value: e ? e.notes : '', placeholder: 'Refacciones que usa, mañas, dónde está la llave de paso' })}
    </details>
    <p class="err hidden" id="ef-err" role="alert"></p>
    ${e && isAdmin() ? `<button type="button" class="b plain danger block" data-del>${ic('trash')}Dar de baja este equipo</button>` : ''}
  </form>`, { tab: 'equipos', bar: `<button class="b block lg" form="ef" type="submit" id="ef-save">${ic('check')}${e ? 'Guardar cambios' : 'Guardar equipo'}</button>` });
  if (!e) {
    bindPicker(APP, 'ef-pick', files);
    const mg = bindMonthGrid(APP, (ms) => { months = ms; $('#ef-sum').textContent = monthsText(ms) + (ms.length ? '.' : ''); });
    bindChoice(APP, 'ef-freq', (v) => {
      months = Number(v) ? spreadMonths(Number(v)) : [];
      mg.set(months);
      $('#ef-months').classList.toggle('hidden', !Number(v));
      $('#ef-sum').textContent = months.length ? monthsText(months) + '. Toca un mes para cambiarlo.' : '';
    });
  }
  const getArea = bindAreaSelect('ef-area').area;
  const del = $('[data-del]');
  if (del) del.onclick = async () => {
    if (!(await confirmSheet('¿Dar de baja este equipo?', 'Sale de la lista y se detienen sus servicios programados. Su historial no se borra.', 'Dar de baja', true))) return;
    try { await api('DELETE', '/equipment/' + id); await loadBoot(); toast('Equipo dado de baja'); location.replace('#/equipos'); } catch (ex) { toast(ex.message, { bad: true }); }
  };
  $('#ef').onsubmit = async (ev) => {
    ev.preventDefault();
    const err = $('#ef-err');
    const name = $('#ef-name').value.trim();
    if (!name) { err.textContent = 'Escribe el nombre del equipo'; err.classList.remove('hidden'); $('#ef-name').focus(); return; }
    const data = {
      name, area_id: getArea() || null, brand_model: $('#ef-model').value, provider_id: $('#ef-who').value || null, serial: $('#ef-serial').value,
      location: $('#ef-loc').value, warranty_until: $('#ef-war').value, manual_url: $('#ef-manual').value, notes: $('#ef-notes').value,
    };
    if (!e) { data.plan_months = months; data.last_service = $('#ef-last').value; }
    const btn = $('#ef-save');
    btn.disabled = true;
    try {
      let eid = id;
      if (e) await api('PATCH', '/equipment/' + id, data);
      else { eid = (await api('POST', '/equipment', data)).id; if (files.length) await uploadAll(`/equipment/${eid}/photos`, files); }
      await loadBoot();
      touch();
      toast(e ? 'Equipo guardado' : 'Equipo dado de alta');
      location.replace('#/e/' + eid);
    } catch (ex) { btn.disabled = false; err.textContent = ex.message; err.classList.remove('hidden'); }
  };
}

// A service that was done (today or before): goes straight into the equipment's history.
async function viewService(eqId) {
  UI.view = 'service';
  loading({ tab: 'equipos' });
  let d;
  try { d = await api('GET', '/equipment/' + eqId); } catch (e) { return errorView(e.message, { tab: 'equipos' }); }
  const e = d.equipment;
  const pending = d.tasks.find((t) => isOpen(t) && t.kind === 'preventivo');
  const files = [];
  render(header('Anotar servicio', { back: true }) + `<form class="wrap form" id="sf" novalidate>
    <p class="fixed">${ic('wrench')}${esc(e.name)}</p>
    ${pending ? `<div class="banner">${ic('info')}<div class="grow"><b>Ya hay un servicio programado abierto</b><span>${esc(pending.title)}, ${esc(dueInfo(pending).text.toLowerCase())}</span></div></div>
      <button type="button" class="b tonal block" data-close-pending>${ic('check')}Marcar ese como hecho</button><p class="small center">O anota abajo un servicio distinto.</p>` : ''}
    ${fInput('sf-date', '¿Cuándo se hizo?', { type: 'date', value: todayStr(), attrs: `max="${todayStr()}"` })}
    ${fInput('sf-title', '¿Qué se le hizo?', { value: 'Servicio', placeholder: 'Ej. Limpieza de condensador y carga de gas', max: 200 })}
    ${fSelect('sf-who', '¿Quién lo hizo?', contactOptions(e.provider_id || myCard() || '', 'No sé'))}
    <div class="field"><label class="flabel" for="sf-cost">¿Cuánto costó? ${optTxt}</label><div class="money-in"><span>$</span><input class="input" id="sf-cost" type="number" inputmode="decimal" min="0" step="1" placeholder="0"></div></div>
    ${fText('sf-notes', 'Notas', { optional: true, placeholder: 'Qué encontró, qué recomienda, cuándo vuelve' })}
    <div class="field"><span class="flabel">Foto ${optTxt}</span>${pickerHtml('sf-pick', { label: 'Tomar foto' })}</div>
    <p class="err hidden" id="sf-err" role="alert"></p>
  </form>`, { tab: 'equipos', bar: `<button class="b block lg" form="sf" type="submit" id="sf-save">${ic('check')}Guardar servicio</button>` });
  bindPicker(APP, 'sf-pick', files);
  const cp = $('[data-close-pending]');
  if (cp) cp.onclick = () => completeSheet(pending, () => location.replace('#/e/' + eqId));
  $('#sf').onsubmit = async (ev) => {
    ev.preventDefault();
    const err = $('#sf-err');
    const title = $('#sf-title').value.trim() || 'Servicio';
    const date = $('#sf-date').value;
    if (!date || date > todayStr()) { err.textContent = 'Elige el día en que se hizo (hoy o antes)'; err.classList.remove('hidden'); return; }
    const btn = $('#sf-save');
    btn.disabled = true;
    try {
      const r = await api('POST', '/tasks', { kind: 'servicio', title, equipment_id: e.id, provider_id: $('#sf-who').value || null, completed_date: date, cost: $('#sf-cost').value, description: $('#sf-notes').value });
      if (files.length) await uploadAll(`/tasks/${r.task.id}/photos`, files);
      toast('Servicio anotado');
      if (inAppNavs > 0) history.back(); else location.replace('#/e/' + eqId);
    } catch (ex) { btn.disabled = false; err.textContent = ex.message; err.classList.remove('hidden'); }
  };
}

// ---------- Contactos: the house team and every outside provider ----------
const contactBtns = (p, text = '') => (p.phone ? `<span class="cbtns"><a class="ib line" href="${telHref(p.phone)}" aria-label="Llamar a ${esc(p.name)}">${ic('phone')}</a><a class="ib line wa" target="_blank" rel="noopener" href="${waHref(p.phone, text)}" aria-label="WhatsApp a ${esc(p.name)}">${ic('wa')}</a></span>` : '');
async function viewContactos() {
  UI.view = 'contactos';
  loading({ tab: 'contactos' });
  let r;
  try { r = await api('GET', '/providers'); } catch (e) { return errorView(e.message, { tab: 'contactos' }); }
  S.today = r.today;
  const list = r.providers;
  const row = (p) => `<div class="lrow person"><a class="pmain" href="#/c/${p.id}">${avatar(p.name)}<span class="grow"><b>${esc(p.name)}</b>
      <span class="ls">${esc(p.kind === 'externo' ? [p.specialty || 'Externo', p.company].filter(Boolean).join(', ') : (p.specialty || 'De la casa'))}</span>
      ${p.open_count ? `<span class="ls ${p.late_count ? 'bad' : ''}">${p.late_count ? ic('alert') : ''}${plural(p.open_count, 'abierto', 'abiertos')}${p.late_count ? `, ${plural(p.late_count, 'atrasado', 'atrasados')}` : ''}</span>` : ''}</span></a>${contactBtns(p)}</div>`;
  const draw = (q = '') => {
    const s = fold(q.trim());
    const shown = s ? list.filter((p) => fold([p.name, p.specialty, p.company].join(' ')).includes(s)) : list;
    const exts = shown.filter((p) => p.kind === 'externo').sort((a, b) => (a.specialty || 'zz').localeCompare(b.specialty || 'zz') || a.name.localeCompare(b.name));
    const ints = shown.filter((p) => p.kind === 'interno');
    if (!shown.length) return `<div class="empty"><h2>Nadie con «${esc(q)}»</h2></div>`;
    return `<section><h2 class="sec">Externos<span class="n">${exts.length}</span></h2>
        ${exts.length ? `<div class="list">${exts.map(row).join('')}</div>` : `<p class="small">${s ? 'Ninguno con esa búsqueda.' : 'Agrega al plomero, al carpintero, al de refrigeración, al herrero: a quien se le habla cuando algo no se puede resolver en casa.'}</p>`}</section>
      <section><h2 class="sec">De la casa<span class="n">${ints.length}</span></h2>
        ${ints.length ? `<div class="list">${ints.map(row).join('')}</div>` : '<p class="small">Quien se registra en la app aparece aquí solo.</p>'}</section>`;
  };
  render(header('Contactos', { right: `<a class="hbtn" href="#/c/nuevo">${ic('plus')}Nuevo</a>` }) + `<div class="wrap">
    ${list.length > 7 ? `<div class="searchbar">${ic('search')}<label class="sr" for="ct-q">Buscar</label><input id="ct-q" type="search" placeholder="Buscar por nombre u oficio" autocomplete="off"></div>` : ''}
    <div id="ct-list">${draw()}</div>
  </div>`, { tab: 'contactos' });
  const q = $('#ct-q');
  if (q) q.oninput = () => { $('#ct-list').innerHTML = draw(q.value); };
}

async function viewContacto(id) {
  UI.view = 'contacto';
  loading({ tab: 'contactos' });
  let p, tasks;
  try {
    const [a, b] = await Promise.all([api('GET', '/providers'), api('GET', '/tasks?view=open&provider=' + id)]);
    p = a.providers.find((x) => x.id === Number(id));
    tasks = b.tasks;
    S.today = b.today;
  } catch (e) { return errorView(e.message, { tab: 'contactos' }); }
  if (!p) return errorView('Ese contacto ya no está en la lista.', { tab: 'contactos' });
  const reload = () => viewContacto(id);
  render(header('Contacto', { back: true, right: `<a class="ib" href="#/c/${id}/editar" aria-label="Editar">${ic('edit')}</a>` }) + `<div class="wrap detail">
    <div class="who-card">${avatar(p.name, 'xl')}<h2>${esc(p.name)}</h2>
      <p class="by">${esc(p.kind === 'externo' ? [p.specialty || 'Externo', p.company].filter(Boolean).join(', ') : (p.specialty || 'De la casa'))}${p.user_id ? ', usa la app' : ''}</p>
      ${p.phone ? `<p class="phone">${esc(fmtPhone(p.phone))}</p>` : '<p class="small">Sin teléfono. Agrégalo con el lápiz de arriba.</p>'}</div>
    ${p.phone ? `<div class="callrow"><a class="b tonal grow" href="${telHref(p.phone)}">${ic('phone')}Llamar</a><a class="b wa grow" target="_blank" rel="noopener" href="${waHref(p.phone)}">${ic('wa')}WhatsApp</a></div>` : ''}
    ${p.notes ? `<p class="desc">${esc(p.notes)}</p>` : ''}
    <h2 class="sec ${p.late_count ? 'bad' : ''}">Lo que tiene abierto<span class="n">${tasks.length}</span></h2>
    ${tasks.length ? `<div class="list">${tasks.sort(byLate).map((t) => taskRow(t)).join('')}</div>` : '<p class="small">Nada abierto.</p>'}
    <p class="small">${p.done_count ? `Ha terminado ${plural(p.done_count, 'trabajo', 'trabajos')}.` : ''}</p>
  </div>`, { tab: 'contactos' });
  bindRows(APP, tasks, reload);
  UI.refresh = reload;
}

async function viewContactoForm(id) {
  UI.view = 'contactoform';
  const p = id ? provOf(Number(id)) : null;
  if (id && !p) return errorView('Ese contacto ya no está en la lista.', { tab: 'contactos' });
  render(header(p ? 'Editar contacto' : 'Nuevo contacto', { back: true }) + `<form class="wrap form" id="cf" novalidate>
    ${fInput('cf-name', 'Nombre', { value: p ? p.name : '', placeholder: 'Ej. Oscar Ramírez', max: 120, attrs: 'autocapitalize="words" autocomplete="off"' })}
    <div class="field"><span class="flabel">¿Es de la casa o de fuera?</span>${choice('cf-kind', [{ v: 'externo', label: 'De fuera', sub: 'Plomero, carpintero, técnico' }, { v: 'interno', label: 'De la casa', sub: 'Trabaja en Dos Búhos' }], p ? p.kind : 'externo')}</div>
    ${fInput('cf-spec', 'Oficio', { value: p ? p.specialty : '', placeholder: 'Ej. Plomería', max: 120, attrs: 'list="cf-trades" autocomplete="off"' })}
    <datalist id="cf-trades">${TRADES.map((x) => `<option value="${x}">`).join('')}</datalist>
    ${fInput('cf-phone', 'WhatsApp', { value: p ? p.phone : '', type: 'tel', placeholder: '10 dígitos', max: 24, attrs: 'inputmode="tel" autocomplete="off"', hint: 'Con esto se le llama o se le escribe con un toque.' })}
    ${fInput('cf-company', 'Empresa', { value: p ? p.company : '', optional: true, max: 120, attrs: 'autocomplete="off"' })}
    ${fText('cf-notes', 'Notas', { value: p ? p.notes : '', optional: true, placeholder: 'Horario, cómo cobra, quién lo recomendó' })}
    <p class="err hidden" id="cf-err" role="alert"></p>
    ${p && isAdmin() ? `<button type="button" class="b plain danger block" data-del>${ic('trash')}Quitar de Contactos</button>` : ''}
  </form>`, { tab: 'contactos', bar: `<button class="b block lg" form="cf" type="submit" id="cf-save">${ic('check')}Guardar</button>` });
  const getKind = bindChoice(APP, 'cf-kind');
  const del = $('[data-del]');
  if (del) del.onclick = async () => {
    if (!(await confirmSheet(`¿Quitar a ${p.name}?`, 'Sale de la lista. Lo que hizo se queda en el historial.', 'Quitar', true))) return;
    try { await api('DELETE', '/providers/' + id); await loadBoot(); toast('Quitado de Contactos'); location.replace('#/contactos'); } catch (ex) { toast(ex.message, { bad: true }); }
  };
  $('#cf').onsubmit = async (ev) => {
    ev.preventDefault();
    const err = $('#cf-err');
    const name = $('#cf-name').value.trim();
    if (!name) { err.textContent = 'Escribe el nombre'; err.classList.remove('hidden'); $('#cf-name').focus(); return; }
    const data = { name, kind: getKind() || 'externo', specialty: $('#cf-spec').value, phone: $('#cf-phone').value, company: $('#cf-company').value, notes: $('#cf-notes').value };
    const btn = $('#cf-save');
    btn.disabled = true;
    try {
      const r = p ? await api('PATCH', '/providers/' + id, data) : await api('POST', '/providers', data);
      await loadBoot();
      toast('Contacto guardado');
      if (inAppNavs > 0) history.back(); else location.replace('#/c/' + (p ? id : r.id));
    } catch (ex) { btn.disabled = false; err.textContent = ex.message; err.classList.remove('hidden'); }
  };
}

// ---------- Cuenta ----------
const appLink = () => APP_URL + '/';
// The message an administrator sends someone with their one-time code.
const codeText = (name, code, days) => `Hola ${first(name)}. Ya tienes acceso a Esmero, donde llevamos el mantenimiento de Dos Búhos: ${APP_URL}\n\nEntra con tu WhatsApp y este código: *${code}*\nTe va a pedir que elijas tu contraseña. El código sirve ${days} días.`;
async function codeSheet(x, r) {
  const v = await sheet({
    title: `Código para ${first(x.name)}`, sub: `Sirve una vez, durante ${r.days} días. Con él elige su contraseña.`,
    body: `<div class="pad"><p class="bigcode" aria-label="Código ${r.code.split('').join(' ')}">${r.code}</p></div>`,
    acts: [{ label: 'Cerrar', cls: 'plain', value: null }, { label: 'Mandar por WhatsApp', value: 'wa' }],
  });
  if (v === 'wa') window.open(waHref(x.phone, codeText(x.name, r.code, r.days)), '_blank');
}
function viewCuenta() {
  UI.view = 'cuenta';
  const u = S.user;
  const item = (href, icon, title, sub, attrs = '') => `<a class="lrow" href="${href}" ${attrs}><span class="lth ico">${ic(icon)}</span><span class="grow"><b>${title}</b><span class="ls">${sub}</span></span>${ic('chev')}</a>`;
  render(header('Mi cuenta', { back: true }) + `<div class="wrap detail">
    <div class="who-card">${avatar(u.name, 'xl')}<h2>${esc(u.name)}</h2>
      <p class="by">${isAdmin() ? 'Administrador' : 'Equipo'}</p>
      <p class="phone">${esc(fmtPhone(u.phone))}</p>${u.email ? `<p class="by">${esc(u.email)}</p>` : ''}
      <button class="b tonal sm" data-edit>${ic('edit')}Cambiar mis datos</button></div>
    <div class="list">
      ${item('#/resumen', 'chart', 'Resumen', 'Cómo vamos: abiertos, atrasados, por persona y por área')}
      ${item('#/hechos', 'check', 'Lo que ya se hizo', 'Todo lo terminado, con buscador')}
      ${item('#/', 'lock', 'Cambiar mi contraseña', u.has_pass ? 'La que usas para entrar con tu WhatsApp' : 'Todavía no tienes: elige una', 'data-pass')}
      ${isAdmin() ? item('#/personas', 'users', 'Personas', 'Agregar a alguien, darle un código de entrada, administradores') + item('#/areas', 'tag', 'Áreas', 'Las etiquetas de colores: nombres, colores y orden') : ''}
    </div>
    <div class="tip">${ic('info')}<p><b>Para tenerla como app:</b> abre el menú del navegador y elige «Agregar a pantalla de inicio».</p></div>
    <button class="b plain block" data-out>${ic('logout')}Salir de mi cuenta en este teléfono</button>
  </div>`, { tab: 'cuenta' });
  $('[data-out]').onclick = async () => {
    if (!(await confirmSheet('¿Salir de tu cuenta?', 'Para volver a entrar escribes tu WhatsApp y tu contraseña.', 'Salir'))) return;
    try { await api('POST', '/logout'); } catch { /* */ }
    S.user = null; C.open = null;
    location.hash = '#/';
    showEnter();
  };
  $('[data-pass]').onclick = async (e) => {
    e.preventDefault();
    const res = await sheet({
      title: 'Cambiar mi contraseña', sub: 'Los otros teléfonos donde entraste te la van a pedir.',
      body: `<form class="pad" onsubmit="return false"><input type="hidden" autocomplete="username" value="${esc(u.phone || '')}">
        ${u.has_pass ? fInput('me-cur', 'Contraseña actual', { type: 'password', max: 64, attrs: 'autocomplete="current-password"' }) : ''}
        ${fInput('me-new', 'Nueva contraseña', { type: 'password', max: 64, attrs: 'autocomplete="new-password"', hint: 'Al menos 8 letras o números.' })}</form>`,
      acts: [{ label: 'Cancelar', cls: 'plain', value: null }, { label: 'Guardar', value: (w) => ({ current: $('#me-cur', w) ? $('#me-cur', w).value : undefined, password: $('#me-new', w).value }) }],
    });
    if (!res) return;
    try { await api('POST', '/me/password', res); S.user.has_pass = 1; toast('Contraseña cambiada'); viewCuenta(); } catch (ex) { toast(ex.message, { bad: true }); }
  };
  $('[data-edit]').onclick = async () => {
    const res = await sheet({
      title: 'Mis datos',
      body: `<div class="pad">${fInput('me-name', 'Nombre y apellido', { value: u.name, max: 60, attrs: 'autocomplete="name"' })}
        ${fInput('me-phone', 'WhatsApp', { value: u.phone, type: 'tel', max: 24, attrs: 'inputmode="tel" autocomplete="tel"' })}
        ${fInput('me-email', 'Correo', { value: u.email, type: 'email', max: 120, optional: true, attrs: 'autocapitalize="none" autocomplete="email"' })}</div>`,
      acts: [{ label: 'Cancelar', cls: 'plain', value: null }, { label: 'Guardar', value: (w) => ({ name: $('#me-name', w).value.trim(), phone: $('#me-phone', w).value.trim(), email: $('#me-email', w).value.trim() }) }],
    });
    if (!res) return;
    try {
      const r = await api('PATCH', '/me', res);
      S.user = r.user;
      store('mt_me', { name: r.user.name, phone: r.user.phone, email: r.user.email });
      await loadBoot();
      toast('Datos guardados');
      viewCuenta();
    } catch (e) { toast(e.message, { bad: true }); }
  };
}

async function viewPersonas() {
  UI.view = 'personas';
  if (!isAdmin()) return viewCuenta();
  try { await loadBoot(); } catch (e) { return errorView(e.message, { tab: 'cuenta' }); }
  const users = S.users;
  render(header('Personas', { back: true }) + `<div class="wrap detail">
    <p class="small">Solo entra quien está en esta lista. Agrega a alguien con su WhatsApp y mándale su código: con él elige su contraseña.</p>
    <button class="b block" type="button" data-add>${ic('plus')}Agregar persona</button>
    ${fSelect('pp-coord', 'A quién se le avisa de lo urgente', contactOptions(S.settings.coordinator || '', 'A nadie'), { hint: 'Quien reporta algo sin asignar ve un botón para avisarle por WhatsApp.' })}
    <h2 class="sec">Registrados<span class="n">${users.filter((x) => x.active).length}</span></h2>
    <div class="list">${users.map((x) => `<button type="button" class="lrow ${x.active ? '' : 'off'}" data-u="${x.id}">${avatar(x.name)}<span class="grow"><b>${esc(x.name)}${x.id === S.user.id ? ' (tú)' : ''}</b>
      <span class="ls">${bits([fmtPhone(x.phone) || 'Sin teléfono', x.email])}</span>
      <span class="ls">${!x.active ? 'Sin acceso' : x.has_code && !x.has_pass ? 'Tiene código, todavía no elige contraseña' : !x.has_pass ? 'Sin contraseña: dale un código' : x.last_seen ? 'Entró ' + esc(fmtDay(localYmd(x.last_seen))) : 'Todavía no entra'}</span></span>
      ${x.role === 'admin' ? '<span class="pill go">Admin</span>' : ''}${ic('chev')}</button>`).join('')}</div>
  </div>`, { tab: 'cuenta' });
  $('[data-add]').onclick = async () => {
    const res = await sheet({
      title: 'Agregar persona', sub: 'Entra con su WhatsApp. Te damos un código para mandárselo.',
      body: `<div class="pad">${fInput('np-name', 'Nombre y apellido', { max: 60, attrs: 'autocapitalize="words" autocomplete="off"' })}
        ${fInput('np-phone', 'WhatsApp', { type: 'tel', placeholder: '10 dígitos', max: 24, attrs: 'inputmode="tel" autocomplete="off"', hint: 'Si es de Estados Unidos, empieza con +1.' })}
        <label class="checkrow"><input type="checkbox" id="np-admin"><span>Administrador <span class="muted">(agrega personas, elimina cosas, cambia áreas)</span></span></label></div>`,
      acts: [{ label: 'Cancelar', cls: 'plain', value: null }, { label: 'Agregar', value: (w) => ({ name: $('#np-name', w).value.trim(), phone: $('#np-phone', w).value.trim(), role: $('#np-admin', w).checked ? 'admin' : 'staff' }) }],
    });
    if (!res) return;
    try { const r = await api('POST', '/users', res); await loadBoot(); viewPersonas(); await codeSheet(res, r); } catch (e) { toast(e.message, { bad: true }); }
  };
  $('#pp-coord').onchange = async (e) => {
    try { const r = await api('PATCH', '/settings', { coordinator: e.target.value || null }); S.settings = r.settings; toast('Guardado'); } catch (ex) { toast(ex.message, { bad: true }); }
  };
  $$('[data-u]').forEach((b) => (b.onclick = async () => {
    const x = users.find((u) => u.id === Number(b.dataset.u));
    const self = x.id === S.user.id;
    const opts = [];
    if (!self && x.active) opts.push({ value: 'code', label: x.has_pass ? 'Darle un código nuevo' : 'Darle su código de entrada', sub: x.has_pass ? 'Si olvidó su contraseña. La que tenía deja de servir.' : 'Para que entre por primera vez y elija su contraseña', icon: 'lock' });
    if (x.phone && !self) opts.push({ value: 'wa', label: 'Escribirle por WhatsApp', icon: 'wa' });
    if (!self && x.active) opts.push(x.role === 'admin' ? { value: 'staff', label: 'Quitarle lo de administrador', icon: 'user' } : { value: 'admin', label: 'Hacer administrador', sub: 'Puede eliminar cosas, quitar personas y cambiar las áreas', icon: 'shield' });
    if (!self) opts.push(x.active ? { value: 'off', label: 'Quitarle el acceso', sub: 'Se le cierra la app en todos sus teléfonos', icon: 'x', cls: 'danger' } : { value: 'on', label: 'Devolverle el acceso', icon: 'check' });
    if (!opts.length) return toast('Para cambiar tus datos ve a Mi cuenta');
    const v = await sheet({ title: x.name, opts });
    if (!v) return;
    if (v === 'wa') return window.open(waHref(x.phone), '_blank');
    if (v === 'code') {
      if (x.has_pass && !(await confirmSheet(`¿Código nuevo para ${first(x.name)}?`, 'Su contraseña deja de servir y se le cierra la app en sus teléfonos hasta que entre con el código.', 'Darle código'))) return;
      try { const r = await api('POST', `/users/${x.id}/code`); await codeSheet(x, r); viewPersonas(); } catch (e) { toast(e.message, { bad: true }); }
      return;
    }
    if (v === 'off' && !(await confirmSheet(`¿Quitarle el acceso a ${first(x.name)}?`, 'Lo que reportó e hizo se queda. Se lo puedes devolver después.', 'Quitar acceso', true))) return;
    try {
      await api('PATCH', '/users/' + x.id, v === 'admin' || v === 'staff' ? { role: v } : { active: v === 'on' });
      toast('Listo');
      viewPersonas();
    } catch (e) { toast(e.message, { bad: true }); }
  }));
}

async function viewAreas() {
  UI.view = 'areas';
  if (!isAdmin()) return viewCuenta();
  try { await loadBoot(); if (!C.open) await fetchOpen(); } catch (e) { return errorView(e.message, { tab: 'cuenta' }); }
  const areas = S.areas;
  const act = areas.filter((a) => a.active);
  render(header('Áreas', { back: true, right: `<button class="hbtn" data-new>${ic('plus')}Nueva</button>` }) + `<div class="wrap detail">
    <p class="small">Son las etiquetas de colores con las que se agrupa y se filtra todo. Toca una para cambiarle el nombre o el color.</p>
    <div class="list">${areas.map((a) => {
      const i = act.indexOf(a);
      return `<div class="lrow area ${a.active ? '' : 'off'}"><button type="button" class="pmain" data-a="${a.id}">${tag(a.name, a.color)}<span class="grow"></span><span class="ls">${a.active ? plural((C.open || []).filter((t) => t.area_id === a.id).length, 'abierto', 'abiertos') : 'Ya no se usa'}</span></button>
        ${a.active ? `<span class="cbtns"><button class="ib line" data-mv="${a.id}" data-dir="-1" aria-label="Subir ${esc(a.name)}" ${i === 0 ? 'disabled' : ''}>${ic('up')}</button><button class="ib line" data-mv="${a.id}" data-dir="1" aria-label="Bajar ${esc(a.name)}" ${i === act.length - 1 ? 'disabled' : ''}>${ic('down')}</button></span>` : ''}</div>`;
    }).join('')}</div>
  </div>`, { tab: 'cuenta', keepScroll: true });
  const again = async () => { await loadBoot(); viewAreas(); };
  $('[data-new]').onclick = async () => {
    const name = await inputSheet('Nueva área', '', 'Agregar', { placeholder: 'Ej. Estacionamiento', max: 40 });
    if (!name) return;
    try { await api('POST', '/areas', { name }); toast('Área agregada'); again(); } catch (e) { toast(e.message, { bad: true }); }
  };
  $$('[data-mv]').forEach((b) => (b.onclick = async () => {
    const i = act.findIndex((a) => a.id === Number(b.dataset.mv));
    const j = i + Number(b.dataset.dir);
    if (j < 0 || j >= act.length) return;
    const order = act.slice();
    [order[i], order[j]] = [order[j], order[i]];
    try { await Promise.all(order.map((a, k) => (a.sort !== k + 1 ? api('PATCH', '/areas/' + a.id, { sort: k + 1 }) : null))); again(); } catch (e) { toast(e.message, { bad: true }); }
  }));
  $$('[data-a]').forEach((b) => (b.onclick = async () => {
    const a = areas.find((x) => x.id === Number(b.dataset.a));
    const res = await sheet({
      title: 'Área',
      body: `<div class="pad">${fInput('ar-name', 'Nombre', { value: a.name, max: 40, attrs: 'autocomplete="off"' })}
        <span class="flabel">Color</span><div class="cdots" role="radiogroup" aria-label="Color">${COLORS.map((c) => `<button type="button" role="radio" class="cdot tagc c-${c} ${a.color === c ? 'on' : ''}" aria-checked="${a.color === c}" aria-label="${COLOR_NAME[c]}" data-c="${c}"></button>`).join('')}</div>
        <p class="tagprev">${tag(a.name, a.color, 'id="ar-prev"')}</p></div>`,
      acts: [{ label: a.active ? 'Dejar de usarla' : 'Volver a usarla', cls: 'plain', value: { active: !a.active } }, { label: 'Guardar', value: (w) => ({ name: $('#ar-name', w).value.trim(), color: $('.cdot.on', w).dataset.c }) }],
      onOpen: (w) => {
        $$('.cdot', w).forEach((d) => (d.onclick = () => {
          $$('.cdot', w).forEach((x) => { x.classList.remove('on'); x.setAttribute('aria-checked', 'false'); });
          d.classList.add('on'); d.setAttribute('aria-checked', 'true');
          $('#ar-prev', w).className = 'tag c-' + d.dataset.c;
        }));
        $('#ar-name', w).oninput = (e) => { $('#ar-prev', w).textContent = e.target.value || a.name; };
      },
    });
    if (!res) return;
    if ('name' in res && !res.name) return toast('El nombre no puede quedar vacío', { bad: true });
    try { await api('PATCH', '/areas/' + a.id, res); touch(); toast('Guardado'); again(); } catch (e) { toast(e.message, { bad: true }); }
  }));
}

// The numbers: are we catching up or falling behind, and who and where is the load.
async function viewResumen() {
  UI.view = 'resumen';
  loading({ tab: 'cuenta' });
  let r;
  try { [r] = await Promise.all([api('GET', '/summary'), fetchOpen()]); } catch (e) { return errorView(e.message, { tab: 'cuenta' }); }
  const all = C.open;
  const late = all.filter(isLate);
  const stat = (n, label, cls = '') => `<div class="tile static ${n ? cls : 'zero'}"><b>${n}</b><span>${label}</span></div>`;
  const max = Math.max(1, ...r.weeks.map((w) => Math.max(w.created, w.done)));
  const bars = r.weeks.map((w, i) => {
    const d = ymdDate(w.start);
    return `<div class="wk"><div class="wbars"><i class="c" style="height:${Math.round((w.created / max) * 100)}%" title="${w.created} reportados"></i><i class="d" style="height:${Math.round((w.done / max) * 100)}%" title="${w.done} hechos"></i></div>
      <span>${i === r.weeks.length - 1 ? 'esta' : d.getDate() + ' ' + MESES[d.getMonth()]}</span></div>`;
  }).join('');
  const tc = r.weeks.reduce((s, w) => s + w.created, 0);
  const td = r.weeks.reduce((s, w) => s + w.done, 0);
  const ppl = [...new Set(all.map((t) => t.provider_id || 0))].map((id) => ({ id, name: id ? (provOf(id) || {}).name || 'Alguien' : 'Sin asignar', n: all.filter((t) => (t.provider_id || 0) === id).length, late: late.filter((t) => (t.provider_id || 0) === id).length }))
    .sort((a, b) => b.late - a.late || b.n - a.n);
  const ars = [...new Set(all.map((t) => t.area_id || 0))].map((id) => ({ id, a: areaOf(id), n: all.filter((t) => (t.area_id || 0) === id).length, late: late.filter((t) => (t.area_id || 0) === id).length })).sort((a, b) => b.n - a.n);
  const amax = Math.max(1, ...ars.map((a) => a.n));
  const oldest = all.filter((t) => t.kind === 'tarea').slice().sort((a, b) => a.created_at.localeCompare(b.created_at)).slice(0, 5);
  render(header('Resumen', { back: true }) + `<div class="wrap detail">
    <div class="tiles four">${stat(all.length, 'Abiertos')}${stat(late.length, 'Atrasados', 'bad')}${stat(all.filter((t) => !t.provider_id).length, 'Sin asignar', 'warn')}${stat(r.done_7, 'Hechos en 7 días', 'ok')}</div>
    <h2 class="sec">Reportados y hechos por semana</h2>
    <div class="chart" role="img" aria-label="En 8 semanas se reportaron ${tc} y se hicieron ${td}">${bars}</div>
    <p class="legend"><span><i class="c"></i>Reportados (${tc})</span><span><i class="d"></i>Hechos (${td})</span></p>
    <p class="small">${tc + td === 0 ? 'Todavía no hay movimiento que mostrar.' : td >= tc ? 'En 8 semanas se hizo tanto o más de lo que se reportó: vamos al corriente.' : tc - td === 1 ? 'En 8 semanas se reportó 1 más de lo que se hizo: se está acumulando.' : `En 8 semanas se reportaron ${tc - td} más de los que se hicieron: se está acumulando.`}${r.avg_days !== null ? ` Un reporte tarda en promedio ${r.avg_days === 1 ? '1 día' : r.avg_days + ' días'} en resolverse.` : ''}${r.cost_month ? ` Este mes se han gastado ${money(r.cost_month)}.` : ''}</p>
    <h2 class="sec">Por persona</h2>
    ${ppl.length ? `<div class="list">${ppl.map((p) => `<button type="button" class="lrow" data-who="${p.id}">${p.id ? avatar(p.name) : `<span class="av un" aria-hidden="true">${ic('user')}</span>`}<span class="grow"><b>${esc(p.name)}</b><span class="ls ${p.late ? 'bad' : ''}">${p.late ? ic('alert') : ''}${plural(p.n, 'abierto', 'abiertos')}${p.late ? `, ${plural(p.late, 'atrasado', 'atrasados')}` : ''}</span></span>${ic('chev')}</button>`).join('')}</div>` : '<p class="small">Nada abierto.</p>'}
    <h2 class="sec">Por área</h2>
    ${ars.length ? `<div class="abars">${ars.map((x) => `<button type="button" class="abar" data-area="${x.id}"><span class="al">${x.a ? tag(x.a.name, x.a.color) : '<span class="tag c-grey">Sin área</span>'}</span>
      <span class="at"><i class="tagc c-${x.a ? x.a.color : 'grey'}" style="width:${Math.max(4, Math.round((x.n / amax) * 100))}%"></i></span><span class="an">${x.n}</span>
      ${x.late ? `<span class="alate">${ic('alert')}${plural(x.late, 'atrasado', 'atrasados')}</span>` : ''}</button>`).join('')}</div>` : '<p class="small">Nada abierto.</p>'}
    ${oldest.length ? `<h2 class="sec">Lo más viejo sin resolver</h2><div class="list">${oldest.map((t) => `<a class="lrow" href="#/p/${t.id}"><span class="grow"><b>${esc(t.title)}</b><span class="ls">Reportado ${esc(ago(localYmd(t.created_at)))}, ${t.provider_id ? 'lo tiene ' + esc(first(t.provider_name)) : 'sin asignar'}</span></span>${ic('chev')}</a>`).join('')}</div>` : ''}
  </div>`, { tab: 'cuenta' });
  $$('[data-who]').forEach((b) => (b.onclick = () => { F.who = Number(b.dataset.who) || 'none'; F.areas = []; F.prios = []; saveF(); P.src = 'all'; location.hash = '#/todo'; }));
  $$('[data-area]').forEach((b) => (b.onclick = () => { if (!Number(b.dataset.area)) return; F.who = 'all'; F.areas = [Number(b.dataset.area)]; F.prios = []; saveF(); P.src = 'all'; location.hash = '#/todo'; }));
}

// ---------- router ----------
function parseHash() {
  const h = location.hash.replace(/^#\/?/, '');
  const [path, qs] = h.split('?');
  const query = {};
  if (qs) for (const kv of qs.split('&')) { const [k, v] = kv.split('='); try { query[decodeURIComponent(k)] = decodeURIComponent((v || '').replace(/\+/g, ' ')); } catch { /* bad escape */ } }
  return { seg: path.split('/').filter(Boolean), query };
}
// Where we have been, to tell "back" from "forward": coming back to a screen puts it where it was left.
const TRAIL = [];
async function route() {
  if (!S.user) return showEnter();
  // a real navigation with a sheet or photo still open (a typed address, the Back button twice): drop it without touching history
  if (sheet.close || openViewer.close) { OV.open = false; OV.onBack = null; OV.after = null; }
  if (sheet.close) sheet.close();
  if (openViewer.close) openViewer.close();
  UI.refresh = null;
  UI.plan = false;
  const here = location.hash || '#/';
  const top = TRAIL[TRAIL.length - 1];
  if (top && top.h !== here) top.y = window.scrollY;
  if (TRAIL.length > 1 && TRAIL[TRAIL.length - 2].h === here) { TRAIL.pop(); UI.backY = TRAIL[TRAIL.length - 1].y || 0; }
  else if (!top || top.h !== here) { TRAIL.push({ h: here, y: 0 }); UI.backY = 0; if (TRAIL.length > 30) TRAIL.shift(); }
  const { seg, query } = parseHash();
  const [a, b, c] = seg;
  const n = /^-?\d+$/.test(b || '') ? Number(b) : null;   // negative: a pendiente still on the phone (offline.js)
  try {
    if (!a) return await viewPlanner('dia');
    if (a === 'semana' || a === 'mes' || a === 'bandeja' || a === 'atrasados' || a === 'todo') return await viewPlanner(a);
    if (a === 'prioridad' && n) return await viewPlanner('prio', n);
    if (a === 'area' && n !== null) return await viewPlanner('area', n);
    if (a === 'p' && n) return await viewTask(n);
    if (a === 't' && n) return location.replace('#/p/' + n);          // links from the old version
    if (a === 'nuevo') return await viewReport(query);
    if (a === 'enviado' && n) return await viewReported(n);
    if (a === 'hechos') return await viewDone(query);
    if (a === 'buscar') return await viewSearch(query);
    if (a === 'preventivo') return await viewPM(query);
    if (a === 'planes') return await viewPlans();
    if (a === 'plan' && b === 'nuevo') return await viewPlanForm(null, query);
    if (a === 'plan' && n) return c === 'editar' ? await viewPlanForm(n) : await viewPlan(n);
    if (a === 'equipos') return await viewEquipos();
    if (a === 'e' && b === 'nuevo') return await viewEquipoForm(null);
    if (a === 'e' && n) return c === 'editar' ? await viewEquipoForm(n) : c === 'servicio' ? await viewService(n) : await viewEquipo(n);
    if (a === 'contactos') return await viewContactos();
    if (a === 'c' && b === 'nuevo') return await viewContactoForm(null);
    if (a === 'c' && n) return c === 'editar' ? await viewContactoForm(n) : await viewContacto(n);
    if (a === 'cuenta') return viewCuenta();
    if (a === 'personas') return await viewPersonas();
    if (a === 'areas') return await viewAreas();
    if (a === 'resumen') return await viewResumen();
    location.replace('#/');
  } catch (e) {
    console.error(e);
    if (S.user) errorView('No se pudo abrir esta pantalla. ' + (e && e.message ? e.message : ''));
  }
}
window.addEventListener('hashchange', () => { inAppNavs++; route(); });
// Coming back to the app after a while: bring the screen up to date without losing the place.
document.addEventListener('visibilitychange', () => {
  if (document.hidden || !S.user || !UI.refresh || !$('#sheet').classList.contains('hidden')) return;
  if (UI.plan && Date.now() - C.openAt > 30000) UI.refresh();
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (openViewer.close) openViewer.close();
  else if (sheet.close) sheet.close();
});

async function start() {
  await OFF.load();
  try {
    const st = await api('GET', '/status');
    UI.firstRun = !!st.first;
    if (!st.user) return showEnter();
    S.user = st.user;
    await loadBoot();
    route();
  } catch (e) {
    APP.innerHTML = `<div class="enter"><img class="logo" src="/logo-word.png" alt="Dos Búhos" width="183" height="40"><h1>Esmero</h1>
      <p class="lead">${esc(e.message)}</p><button class="b block lg" onclick="location.reload()">${ic('refresh')}Volver a intentar</button></div>`;
  }
}
start();
