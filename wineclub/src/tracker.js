// Pass 2: the two scan-first views Eric asked for.
//  · /socios     — one card per member: join date, then a colour-coded pill per shipment; open a shipment to see
//                  the box and log it right there.
//  · /calendario — month → week: what should go out, to whom, and what already went out.
import { esc, fdate, chip, page, STATUS_LABEL, MESES, bottleList, money } from './ui.js';
import { addDays, weekdayMon0, daysBetween } from './schedule.js';
import { subOccurrences, subClub, isIgnored, allOccurrences } from './data.js';
import { exactDate, recordedPending, joinedDate } from './visibility.js';
import { okBanner } from './pages.js';
import { qrow, QCSS } from './queue.js';
import { buildAlerts } from './alerts.js';
const bell = (ctx, user) => { const a = buildAlerts(ctx, user); return { alerts: a.length, alertsRed: a.filter(x => x.tone === 'red').length }; };

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const shipHref = (o) => `/envio/${o.subId}/${o.k}`;
const OPEN_NOW = ['overdue', 'today', 'exception', 'held'];

// One colour per situation, used by the pills, the rows and the legend.
export function tone(o, today) {
  if (o.state === 'done') return 'ok';
  if (['skipped', 'pretracking', 'paused'].includes(o.state)) return 'off';
  if (['payment_blocked', 'suspended'].includes(o.state)) return 'block';
  if (o.state === 'held') return 'hold';
  if (o.state === 'payment_contact') return 'pay';
  if (o.state === 'overdue' || o.state === 'exception') return 'late';
  if (o.state === 'today') return 'now';
  return 'future';
}
const TONE_LABEL = { ok: 'Entregado', late: 'Atrasado', now: 'Hoy', hold: 'En bodega', pay: 'Revisar cobro', block: 'Bloqueado por pago', future: 'Próximo', off: 'Sin registro previo' };

function doneText(o, today) {
  const f = o.f || {};
  const how = f.status === 'shipped' || f.status === 'delivered' ? 'Enviado' : f.method === 'signup' ? 'Se lo llevó al inscribirse' : 'Recogido';
  return `${how} ${f.done_on ? fdate(f.done_on, today, { weekday: false }) : ''}`.trim();
}

// Payment for this box, as Stripe attached it. Manual memberships are billed outside Stripe.
function payInfo(o, today) {
  const f = o.f || {}, s = o.sub;
  if (f.stripe_invoice_id && f.paid_on) return { paid: true, short: `Pagado ${fdate(f.paid_on, today, { weekday: false })}`, long: `Pagado el ${exactDate(f.paid_on)}${f.paid_amount != null ? ' · ' + money(f.paid_amount, s.price_currency) : ''}` };
  if (!s.stripe_subscription_id) return { paid: null, short: 'Cobro manual', long: 'Membresía cobrada fuera de Stripe.' };
  if (o.state === 'upcoming' || o.state === 'today' && !f.paid_on) return { paid: null, short: 'Cobro por venir', long: 'Stripe todavía no registra el cobro de este periodo.' };
  return { paid: false, short: 'Sin pago', long: 'Stripe no tiene un pago asociado a esta caja. Revisa la factura del periodo; esto no confirma un impago.' };
}

// The inline log form: date, how, optional PO. Writes through /rapido with the same version check as every write.
function quickForm(o, today, back) {
  const f = o.f || {}, s = o.sub;
  if (!OPEN_NOW.includes(o.state)) return '';
  const pickup = s.delivery_pref !== 'envio';
  const defDate = o.eff < today ? '' : today;
  return `<form method="post" action="${shipHref(o)}/rapido" class="quick">
    <input type="hidden" name="version" value="${f.version || 0}"><input type="hidden" name="back" value="${esc(back)}">
    <div class="quick-grid">
      <label>Cómo<select name="como">
        <option value="pickup" ${pickup ? 'selected' : ''}>Recogió en bodega</option>
        <option value="courier" ${pickup ? '' : 'selected'}>Enviado a domicilio</option>
        <option value="signup">Se lo llevó al inscribirse</option></select></label>
      <label>Fecha real<input type="date" name="done_on" value="${defDate}" max="${today}" required></label>
    </div>
    <label>Pedido Zoho (opcional)<input name="order_ref" value="${esc(f.order_ref || '')}" placeholder="OV-02072"></label>
    <button class="btn">Guardar entrega</button>
    <p class="small muted">Para revisar la caja botella por botella, guía o foto: <a href="${shipHref(o)}/entregar?back=${encodeURIComponent(back)}">registro completo</a>.</p>
  </form>`;
}

function shipmentRow(o, today, back) {
  const t = tone(o, today), f = o.f || {}, pay = payInfo(o, today);
  const due = o.delayed ? `${fdate(o.eff, today, { weekday: false })} (aplazado)` : fdate(o.due, today, { weekday: false });
  const right = t === 'ok' ? doneText(o, today)
    : t === 'late' ? (recordedPending(o) ? 'Pendiente confirmado' : 'Sin registro')
    : t === 'now' ? 'Toca hoy'
    : t === 'hold' ? 'En bodega'
    : t === 'pay' ? 'Revisar cobro'
    : t === 'block' ? 'Bloqueado por pago'
    : t === 'off' ? (o.state === 'pretracking' ? 'Antes del registro' : STATUS_LABEL[o.status] || 'Omitido')
    : `en ${daysBetween(today, o.eff)} días`;
  const details = `
    <dl class="facts"><dt>Pago</dt><dd>${esc(pay.long)}${f.stripe_invoice_id ? ` · <a href="https://dashboard.stripe.com/invoices/${encodeURIComponent(f.stripe_invoice_id)}" target="_blank" rel="noopener">ver factura</a>` : ''}</dd><dt>Previsto</dt><dd>${esc(exactDate(o.due))}${o.delayed ? ` · aplazado al ${esc(exactDate(o.eff))}` : ''}</dd>
    ${f.done_on ? `<dt>Salió</dt><dd>${esc(doneText(o, today))}${f.handled_by ? ' · ' + esc(f.handled_by) : ''}</dd>` : ''}
    ${f.order_ref ? `<dt>Pedido</dt><dd>${esc(f.order_ref)}</dd>` : ''}${f.tracking ? `<dt>Guía</dt><dd>${esc(f.carrier || '')} ${esc(f.tracking)}</dd>` : ''}
    ${f.note ? `<dt>Nota</dt><dd>${esc(f.note)}</dd>` : ''}</dl>
    ${o.bottles ? `<div class="box"><b>Caja (${o.bottlesTotal} botellas)</b>${bottleList(o.bottles)}</div>` : (o.missingAllocation ? '<p class="warn">Falta definir qué botellas lleva esta caja.</p>' : '')}
    ${quickForm(o, today, back)}
    ${t === 'block' || t === 'pay' ? '<p class="small">Revisa el pago antes de entregar.</p>' : ''}
    <p class="small"><a href="${shipHref(o)}">Abrir envío completo →</a></p>`;
  return `<details class="ship-acc t-${t}" id="e${o.subId}-${o.k}" ${OPEN_NOW.includes(o.state) && t === 'late' ? '' : ''}>
    <summary><span class="dot" aria-hidden="true"></span><span class="sn">#${o.n}</span><span class="sd">${esc(due)}</span>
      <span class="sflags"><span class="pay ${pay.paid ? 'yes' : pay.paid === false ? 'no' : 'na'}">${esc(pay.short)}</span><span class="sr">${esc(right)}</span></span></summary>
    <div class="acc-body">${details}</div></details>`;
}

// ---------- /socios ----------
export function trackerPage({ env, user, ctx, url, okAudit }) {
  const today = ctx.today;
  const q = (url.searchParams.get('q') || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const filter = url.searchParams.get('f') || 'activos';
  const open = url.searchParams.get('abrir');
  const members = new Map();
  for (const s of ctx.subs) {
    if (isIgnored(s)) continue;
    if (!members.has(s.member_id)) members.set(s.member_id, { id: s.member_id, name: s.member_name, subs: [] });
    members.get(s.member_id).subs.push(s);
  }
  const cards = [];
  let counts = { activos: 0, atrasados: 0, aldia: 0, cobro: 0, todos: 0 };
  for (const m of members.values()) {
    const blocks = [];
    let late = 0, done = 0, active = false;
    for (const s of m.subs) {
      const club = subClub(ctx, s);
      const ended = ['canceled', 'manual_ended', 'incomplete_expired'].includes(s.status) || (s.ended_on && s.ended_on <= today);
      if (!ended) active = true;
      if (!club) { blocks.push({ s, club: null, occ: [] }); continue; }
      // Everything up to today, plus the next shipment.
      const all = subOccurrences(ctx, s, addDays(today, club.cadence_months * 31 + 1)) || [];
      const past = all.filter(o => o.eff <= today || ['done', 'overdue', 'exception', 'held'].includes(o.state));
      const next = all.filter(o => !past.includes(o)).slice(0, 1);
      const occ = [...past, ...next].filter(o => o.state !== 'pretracking' || o.f);
      late += occ.filter(o => tone(o, today) === 'late').length;
      done += occ.filter(o => o.state === 'done').length;
      blocks.push({ s, club, occ, ended });
    }
    const hay = (m.name + ' ' + m.subs.map(s => s.member_email || '').join(' ')).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const payProblem = m.subs.some(s => s.suspended_on || s.payment_followup_on) || blocks.some(b => b.occ.some(o => ['block', 'pay'].includes(tone(o, today))));
    counts.todos++; if (active) counts.activos++; if (late) counts.atrasados++; if (payProblem) counts.cobro++; if (!late && !payProblem && active) counts.aldia++;
    if (q && !hay.includes(q)) continue;
    if (filter === 'activos' && !active) continue;
    if (filter === 'atrasados' && !late) continue;
    if (filter === 'aldia' && (late || !active || payProblem)) continue;
    if (filter === 'cobro' && !payProblem) continue;
    cards.push({ m, blocks, late, done, active, joined: joinedDate(ctx, m.id) });
  }
  cards.sort((a, b) => (b.late > 0) - (a.late > 0) || a.m.name.localeCompare(b.m.name, 'es'));
  const back = url.pathname + url.search.replace(/[?&]ok=\d+/, '');
  const card = ({ m, blocks, late, done, active, joined }) => {
    const all = blocks.flatMap(b => b.occ);
    const owed = all.filter(o => !['upcoming', 'pretracking', 'skipped'].includes(o.state));
    const paidN = owed.filter(o => o.f?.stripe_invoice_id && o.f?.paid_on).length, doneN = owed.filter(o => o.state === 'done').length;
    const manual = blocks.every(b => !b.s.stripe_subscription_id);
    const first = blocks[0];
    const pref = first?.s.delivery_pref === 'envio' ? 'Envío a domicilio' : 'Recoge en bodega';
    const noClub = blocks.some(b => !b.club);
    const payIssue = blocks.some(b => b.s.suspended_on) ? 'Pago bloqueado' : all.some(o => ['block', 'pay'].includes(tone(o, today))) ? 'Revisar cobro' : null;
    const status = noClub ? '<span class="mstat late">Sin club</span>' : payIssue ? `<span class="mstat late">${payIssue}</span>` : late ? `<span class="mstat late">${plural(late, 'atrasado', 'atrasados')}</span>` : active ? '<span class="mstat ok">Al día</span>' : '<span class="mstat off">Terminado</span>';
    const isOpen = open === String(m.id) || all.some(o => open === `${o.subId}:${o.k}`);
    return `<details class="member" id="m${m.id}" ${isOpen ? 'open' : ''}>
      <summary>
        <span class="mtop"><span class="mname">${esc(m.name)}</span>${status}</span>
        <span class="msub">${esc(blocks.map(b => b.club ? b.club.name : 'Sin club').join(' · '))} · Alta ${joined ? esc(exactDate(joined)) : '—'}</span>
        ${owed.length ? `<span class="mcount">${doneN} de ${owed.length} entregadas${manual ? ' · cobro manual' : ` · ${paidN} de ${owed.length} pagadas`}</span>` : ''}
        <span class="pills" aria-label="${done} entregados, ${late} atrasados">${all.map(o => `<span class="pill t-${tone(o, today)}" title="Envío #${o.n}: ${esc(TONE_LABEL[tone(o, today)])}">${o.n}</span>`).join('')}</span>
      </summary>
      <div class="mbody">
        <p class="small muted">${esc(pref)}${first?.s.member_phone ? ` · <a href="tel:${esc(first.s.member_phone)}">${esc(first.s.member_phone)}</a>` : ''} · <a href="/socio/${m.id}">Perfil del socio</a></p>
        ${blocks.map(b => !b.club ? `<p class="warn">Esta suscripción no tiene club asignado; sus envíos no se pueden calcular.</p>`
          : `${blocks.length > 1 ? `<h3 class="small">${esc(b.club.name)}${b.ended ? ' · terminada' : ''}</h3>` : ''}${b.occ.map(o => shipmentRow(o, today, back + (back.includes('?') ? '&' : '?') + `abrir=${o.subId}%3A${o.k}`)).join('') || '<p class="small muted">Sin envíos todavía.</p>'}`).join('')}
      </div></details>`;
  };
  const chipLink = (k, label) => `<a href="/socios?f=${k}${q ? '&q=' + encodeURIComponent(q) : ''}" ${filter === k ? 'aria-current="page"' : ''}>${label} <b>${counts[k]}</b></a>`;
  const body = `
  ${okBanner(okAudit, today)}
  <h1>Socios</h1>
  <form method="get" action="/socios" class="msearch"><input type="hidden" name="f" value="${esc(filter)}"><input type="search" name="q" value="${esc(url.searchParams.get('q') || '')}" placeholder="Buscar socio" aria-label="Buscar socio"></form>
  <nav class="mfilters">${chipLink('activos', 'Activos')}${chipLink('atrasados', 'Con atrasos')}${chipLink('aldia', 'Al día')}${chipLink('cobro', 'Cobro')}${chipLink('todos', 'Todos')}</nav>
  <p class="legend"><span><i class="pill t-ok"></i>Entregado</span><span><i class="pill t-late"></i>Atrasado</span><span><i class="pill t-now"></i>Hoy</span><span><i class="pill t-hold"></i>En bodega</span><span><i class="pill t-pay"></i>Revisar cobro</span><span><i class="pill t-block"></i>Pago bloqueado</span><span><i class="pill t-future"></i>Próximo</span></p>
  ${cards.length ? cards.map(card).join('') : `<div class="card empty">${q ? `Nadie coincide con “${esc(url.searchParams.get('q'))}”.` : 'Nadie en esta lista.'}</div>`}
  <p class="small center"><a href="/socios/lista">Directorio completo y alta de socios</a></p>
  ${TCSS}`;
  return page({ title: 'Socios', body, user, env, tab: 'socios', ...bell(ctx, user) });
}

// ---------- /calendario ----------
export function calendarPage({ env, user, ctx, url, okAudit }) {
  const today = ctx.today;
  const months = Math.min(6, Math.max(1, Number(url.searchParams.get('meses')) || 2));
  const start = today.slice(0, 8) + '01';
  const endD = addDays(start, 0).slice(0, 7);
  const [y0, m0] = start.split('-').map(Number);
  const end = (() => { const d = new Date(Date.UTC(y0, m0 - 1 + months, 1)); return addDays(d.toISOString().slice(0, 10), -1); })();
  const { occ } = allOccurrences(ctx, end);
  const late = occ.filter(o => (o.state === 'overdue' || o.state === 'exception') && o.eff < start).sort((a, b) => a.eff.localeCompare(b.eff));
  const inRange = occ.filter(o => o.eff >= start && o.eff <= end && !['pretracking'].includes(o.state))
    .sort((a, b) => a.eff.localeCompare(b.eff) || a.sub.member_name.localeCompare(b.sub.member_name));
  const back = '/calendario' + (url.searchParams.get('meses') ? `?meses=${months}` : '');
  const row = (o) => {
    const t = tone(o, today);
    const action = ['overdue', 'today', 'exception'].includes(o.state) || (o.state === 'held' && o.holdReleaseDue) ? 'deliver' : null;
    return `<div class="cal-row t-${t}">${qrow(o, today, { action, back })}</div>`;
  };
  // Group by month, then by Monday-to-Sunday week.
  const groups = new Map();
  for (const o of inRange) {
    const mk = o.eff.slice(0, 7);
    const wk = addDays(o.eff, -weekdayMon0(o.eff));
    if (!groups.has(mk)) groups.set(mk, new Map());
    const g = groups.get(mk);
    if (!g.has(wk)) g.set(wk, []);
    g.get(wk).push(o);
  }
  const weekTitle = (wk) => { const e = addDays(wk, 6); return `Semana del ${fdate(wk, today, { weekday: false })} al ${fdate(e, today, { weekday: false })}`; };
  const summary = (list) => {
    const done = list.filter(o => o.state === 'done').length, pick = list.filter(o => o.sub.delivery_pref !== 'envio').length;
    return `${plural(list.length, 'caja', 'cajas')} · ${done} ${done === 1 ? 'hecha' : 'hechas'} · ${pick} recoge${list.length - pick ? ` · ${list.length - pick} envío` : ''}`;
  };
  const body = `
  ${okBanner(okAudit, today)}
  <h1>Envíos por semana</h1>
  <nav class="mfilters"><a href="/calendario" aria-current="page">Calendario</a><a href="/envios">Buscar y filtrar</a><a href="/envios?f=resguardo">En resguardo</a><a href="/envios?f=entregados">Entregados</a></nav>
  ${late.length ? `<details class="cal-late"><summary><b>${plural(late.length, 'caja atrasada', 'cajas atrasadas')} de meses anteriores</b><span aria-hidden="true">▾</span></summary>${late.map(row).join('')}</details>` : ''}
  ${[...groups.entries()].map(([mk, weeks]) => {
    const list = [...weeks.values()].flat();
    return `<section class="cal-month"><h2>${MESES[Number(mk.slice(5)) - 1]} ${mk.slice(0, 4)}<span>${summary(list)}</span></h2>
      ${[...weeks.entries()].map(([wk, items]) => `<div class="cal-week ${wk <= today && today <= addDays(wk, 6) ? 'this' : ''}"><h3>${esc(weekTitle(wk))}${wk <= today && today <= addDays(wk, 6) ? ' · esta semana' : ''}<span>${summary(items)}</span></h3>${items.map(row).join('')}</div>`).join('')}
    </section>`;
  }).join('') || '<div class="card empty">No hay envíos en estas fechas.</div>'}
  <form method="get" action="/calendario" class="qrange"><label for="meses">Mostrar</label><select id="meses" name="meses" onchange="this.form.submit()">${[1, 2, 3, 6].map(n => `<option value="${n}" ${n === months ? 'selected' : ''}>${plural(n, 'mes', 'meses')}</option>`).join('')}</select></form>
  ${QCSS}${TCSS}`;
  return page({ title: 'Envíos por semana', body, user, env, tab: 'envios', ...bell(ctx, user) });
}

const TCSS = `<style>
h1{margin:6px 0 10px}
.msearch{margin:0 0 10px}.msearch input{min-height:48px;font-size:16px}
.mfilters{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 12px}
.mfilters a{display:inline-flex;align-items:center;gap:6px;min-height:44px;padding:0 14px;border:1px solid var(--line);border-radius:999px;background:#fff;color:var(--ink);text-decoration:none;font-weight:600;font-size:14px}
.mfilters a[aria-current="page"]{background:var(--wine);border-color:var(--wine);color:#fff}
.legend{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:13px;color:var(--muted);margin:0 0 10px}
.legend span{display:inline-flex;align-items:center;gap:6px}.legend .pill{width:14px;min-width:14px;height:14px;padding:0}
.member{background:#fff;border:1px solid var(--line);border-radius:14px;margin:10px 0;overflow:hidden}
.member>summary{list-style:none;display:flex;flex-direction:column;gap:4px;padding:12px 14px;cursor:pointer;min-height:64px}
.member>summary::-webkit-details-marker{display:none}
.member[open]>summary{border-bottom:1px solid var(--line);background:#fcfaf7}
.mtop{display:flex;align-items:baseline;justify-content:space-between;gap:10px}
.mname{font-size:18px;font-weight:700;overflow-wrap:anywhere}
.msub{font-size:14px;color:var(--muted)}
.mstat{flex:none;font-size:13px;font-weight:700;padding:2px 10px;border-radius:999px}
.mstat.late{background:var(--red-soft);color:var(--red)}.mstat.ok{background:var(--green-soft);color:var(--green)}.mstat.off{background:var(--grey-soft);color:var(--muted)}
.pills{display:flex;flex-wrap:wrap;gap:5px;margin-top:4px}
.pill{display:inline-flex;align-items:center;justify-content:center;min-width:30px;height:26px;padding:0 6px;border-radius:7px;font-size:13px;font-weight:700;font-style:normal;background:var(--grey-soft);color:var(--muted);border:1.5px solid transparent}
.pill.t-ok{background:var(--green);color:#fff}.pill.t-late{background:var(--red);color:#fff}.pill.t-now{background:#fff;color:var(--wine);border:2px solid var(--wine)}.pill.t-pay{background:#fff;color:var(--amber);border:2px dashed var(--amber)}
.pill.t-hold{background:var(--amber-soft);color:var(--amber);border-color:var(--amber)}.pill.t-block{background:var(--red-soft);color:var(--red);border-color:var(--red)}
.pill.t-future{background:#fff;color:var(--muted);border-color:var(--line)}.pill.t-off{background:var(--grey-soft);color:#a39c95}
.mbody{padding:6px 14px 12px}.mbody>p{margin:6px 0 10px}
.ship-acc{border:1px solid var(--line);border-left:5px solid var(--line);border-radius:10px;margin:8px 0;background:#fff}
.ship-acc.t-ok{border-left-color:var(--green)}.ship-acc.t-late{border-left-color:var(--red)}.ship-acc.t-now{border-left-color:var(--wine)}.ship-acc.t-hold,.ship-acc.t-pay{border-left-color:var(--amber)}.ship-acc.t-block{border-left-color:var(--red)}
.ship-acc>summary{list-style:none;display:grid;grid-template-columns:auto auto 1fr;grid-template-areas:'dot n d' '. f f';align-items:center;column-gap:10px;row-gap:4px;min-height:52px;padding:8px 12px;cursor:pointer}
.ship-acc .dot{grid-area:dot}.ship-acc .sn{grid-area:n}.ship-acc .sd{grid-area:d}
.sflags{grid-area:f;display:flex;flex-wrap:wrap;gap:6px}
.sflags>span{font-size:13px;font-weight:700;padding:2px 8px;border-radius:999px;background:var(--grey-soft)}
.pay.yes{background:var(--green-soft);color:var(--green)}.pay.no{background:var(--red-soft);color:var(--red)}.pay.na{color:var(--muted)}
.mcount{font-size:13px;color:var(--muted);font-weight:600}
@media (max-width:480px){.quick-grid{grid-template-columns:1fr}}
@media (min-width:560px){.ship-acc>summary{grid-template-columns:auto auto auto 1fr;grid-template-areas:'dot n d f'}.sflags{justify-content:flex-end}}
.ship-acc>summary::-webkit-details-marker{display:none}
.ship-acc .dot{width:10px;height:10px;border-radius:50%;background:var(--line)}
.ship-acc.t-ok .dot{background:var(--green)}.ship-acc.t-late .dot{background:var(--red)}.ship-acc.t-now .dot{background:var(--wine)}.ship-acc.t-hold .dot,.ship-acc.t-pay .dot{background:var(--amber)}.ship-acc.t-block .dot{background:var(--red)}
.ship-acc .sn{font-weight:800}.ship-acc .sd{color:var(--muted);font-size:14px}
.ship-acc .sr{text-align:left}
.ship-acc.t-ok .sr{color:var(--green)}.ship-acc.t-late .sr{color:var(--red)}.ship-acc.t-now .sr{color:var(--wine)}.ship-acc.t-hold .sr,.ship-acc.t-pay .sr{color:var(--amber)}.ship-acc.t-block .sr{color:var(--red)}.ship-acc.t-future .sr,.ship-acc.t-off .sr{color:var(--muted);font-weight:600}
.acc-body{padding:4px 12px 12px;border-top:1px dashed var(--line)}
.facts{display:grid;grid-template-columns:auto 1fr;gap:4px 12px;margin:10px 0;font-size:14px}.facts dt{color:var(--muted)}.facts dd{margin:0}
.box{background:#fcfaf7;border-radius:10px;padding:8px 10px;margin:8px 0}
.quick{display:grid;gap:10px;margin:12px 0 4px;padding:12px;background:var(--wine-soft);border-radius:12px}
.quick label{margin:0;display:grid;gap:4px;font-size:14px;font-weight:600}
.quick-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.quick .btn{margin:0}
.cal-month h2{display:flex;flex-direction:column;gap:2px;font-size:20px;margin:22px 0 4px;text-transform:capitalize}
.cal-month h2 span,.cal-week h3 span{font-size:13px;font-weight:600;color:var(--muted);text-transform:none}
.cal-week{margin:10px 0 16px;padding-left:10px;border-left:3px solid var(--line)}
.cal-week.this{border-left-color:var(--wine)}
.cal-week h3{display:flex;flex-direction:column;gap:2px;font-size:15px;margin:0 0 4px}
.cal-row .qrow{margin:6px 0}
.cal-row.t-ok .qrow{border-left-color:var(--green)}.cal-row.t-ok .qwhen{color:var(--green)}
.cal-late{background:var(--red-soft);border-radius:12px;padding:0 12px;margin:10px 0}
.cal-late>summary{list-style:none;display:flex;justify-content:space-between;gap:10px;align-items:center;min-height:52px;color:var(--red);cursor:pointer}
.cal-late>summary::-webkit-details-marker{display:none}.cal-late>summary span{font-size:13px}
</style>`;
