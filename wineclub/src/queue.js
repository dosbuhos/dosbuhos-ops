// Fulfillment queue: the home screen and the catch-up review.
// One row per box. The row says who, which box, when, and how it leaves (pickup or shipping); one button does the work.
import { esc, fdate, chip, page, STATUS_LABEL, MESES } from './ui.js';
import { addDays, weekdayMon0, daysBetween } from './schedule.js';
import { allOccurrences } from './data.js';
import { recordedPending, inboxReason } from './visibility.js';
import { buildAlerts } from './alerts.js';
import { okBanner, attribution } from './pages.js';

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const shipHref = (o) => `/envio/${o.subId}/${o.k}`;
const isPickup = (o) => o.sub.delivery_pref !== 'envio';
const sortEff = (a, b) => a.eff.localeCompare(b.eff) || a.sub.member_name.localeCompare(b.sub.member_name);

// Past date, nobody recorded anything: it may already have left. Needs a yes/no, not a delivery.
export const unconfirmed = (o) => o.state === 'overdue' && !recordedPending(o);
// Known to still be owed and due now.
const dueNow = (o, today) => o.state === 'today' || o.state === 'exception' || (o.state === 'overdue' && recordedPending(o)) || (o.state === 'held' && o.holdReleaseDue);

function whenText(o, today) {
  if (o.state === 'done') return `${o.f?.status === 'shipped' || o.f?.status === 'delivered' ? 'Enviado' : 'Entregado'} ${o.f?.done_on ? fdate(o.f.done_on, today, { weekday: false }) : ''}`.trim();
  if (o.state === 'held') return o.holdReleaseDue ? 'Resguardo · ya puede salir' : 'En resguardo en bodega';
  const d = daysBetween(today, o.eff);
  if (d === 0) return 'Hoy';
  if (d < 0) return `Venció hace ${plural(-d, 'día', 'días')}`;
  if (d === 1) return 'Mañana';
  return fdate(o.eff, today);
}

// One box. `action` = 'deliver' (one-tap to the handover form), 'confirm' (yes / still pending), or none.
export function qrow(o, today, { action = null, back = '/' } = {}) {
  const s = o.sub, f = o.f || {};
  const tone = o.state === 'overdue' || o.state === 'exception' ? 'late' : o.state === 'today' || (o.state === 'held' && o.holdReleaseDue) ? 'now' : o.state === 'held' ? 'held' : '';
  const chips = [];
  if (o.status === 'ready') chips.push(chip('Caja lista', 'green'));
  else if (o.status === 'needs_prep') chips.push(chip('Por preparar', 'amber'));
  if (o.state === 'exception') chips.push(chip('Excepción', 'red'));
  if (o.delayed && f.delay_reason) chips.push(chip('Aplazado', 'amber'));
  if (['past_due', 'unpaid'].includes(s.status)) chips.push(chip('Pago vencido', 'amber'));
  if (o.missingAllocation) chips.push(chip('Falta definir botellas', 'red'));
  const how = isPickup(o) ? 'Recoge' : 'Envío';
  const deliverLabel = isPickup(o) ? 'Entregado' : 'Enviado';
  const como = isPickup(o) ? 'handed' : 'shipped';
  const backQ = `&back=${encodeURIComponent(back)}`;
  let btns = '';
  if (action === 'deliver') btns = `<a class="qbtn" href="${shipHref(o)}/entregar?como=${como}${backQ}">${deliverLabel}</a>`;
  if (action === 'confirm') btns = `
    <a class="qbtn" href="${shipHref(o)}/entregar?como=${como}${backQ}">Ya salió</a>
    <form method="post" action="${shipHref(o)}/estado"><input type="hidden" name="version" value="${f.version || 0}"><input type="hidden" name="status" value="needs_prep"><input type="hidden" name="back" value="${esc(back)}"><button class="qbtn ghost">Pendiente</button></form>`;
  return `<article class="qrow ${tone}${action === 'confirm' ? ' confirm' : ''}" id="e${o.subId}-${o.k}">
    <a class="qmain" href="${shipHref(o)}">
      <span class="qwhen">${esc(whenText(o, today))}${o.state !== 'held' && o.state !== 'done' && daysBetween(today, o.eff) < 0 ? ` <span class="muted">· ${esc(fdate(o.eff, today, { weekday: false }))}</span>` : ''}</span>
      <span class="name">${esc(s.member_name)}</span><span class="meta">${esc(o.club.name)} · Envío #${o.n} · ${plural(o.expectedBottles, 'botella', 'botellas')} · ${how}</span>
      ${chips.length ? `<span class="chips">${chips.join('')}</span>` : ''}
    </a>
    ${btns ? `<div class="qacts">${btns}</div>` : ''}
  </article>`;
}

// ---------- home: what has to leave the winery ----------
export function queuePage({ env, user, ctx, url, okAudit }) {
  const today = ctx.today;
  const horizon = Math.min(365, Math.max(14, Number(url.searchParams.get('dias')) || 30));
  const { occ, unmapped } = allOccurrences(ctx, addDays(today, 400));
  const endWeek = addDays(today, 6 - weekdayMon0(today));
  const now = occ.filter(o => dueNow(o, today)).sort(sortEff);
  const toConfirm = occ.filter(unconfirmed).sort(sortEff);
  const upcoming = occ.filter(o => o.state === 'upcoming').sort(sortEff);
  const heldWaiting = occ.filter(o => o.state === 'held' && !o.holdReleaseDue).sort(sortEff);
  const week = upcoming.filter(o => o.eff <= endWeek);
  const later = upcoming.filter(o => o.eff > endWeek && o.eff <= addDays(today, horizon));
  const recent = occ.filter(o => o.state === 'done' && (o.f?.done_on || '') >= addDays(today, -7)).sort((a, b) => (b.f.done_on || '').localeCompare(a.f.done_on || ''));
  const blocked = unmapped;
  const paymentBlocked = occ.filter(o => o.state === 'payment_blocked').length;
  const sync = ctx.settings.last_sync ? JSON.parse(ctx.settings.last_sync) : null;
  const back = '/';
  const rows = (list, action) => list.map(o => qrow(o, today, { action, back })).join('');

  const byMonth = new Map();
  for (const o of later) { const key = o.eff.slice(0, 7); if (!byMonth.has(key)) byMonth.set(key, []); byMonth.get(key).push(o); }

  const alertList = buildAlerts(ctx, user);
  const body = `
  ${okBanner(okAudit, today)}
  <div class="tiles">
    <a class="tile ${now.length ? 'wine' : ''}" href="#entregar"><div class="v">${now.length}</div><div class="l">Por entregar ahora</div></a>
    <a class="tile ${toConfirm.length ? 'red' : ''}" href="/confirmar"><div class="v">${toConfirm.length}</div><div class="l">Por confirmar${blocked.length ? ' · incompleto' : ''}</div></a>
    <a class="tile" href="#semana"><div class="v">${week.length}</div><div class="l">Resto de la semana</div></a>
  </div>

  ${toConfirm.length ? `<section class="catchup">
    <h2>Ponerse al día</h2>
    <p>${plural(toConfirm.length, 'caja tiene', 'cajas tienen')} fecha pasada y nadie registró si ya salió. Revísalas una por una: <b>ya salió</b> o <b>pendiente</b>.</p>
    <a class="btn" href="/confirmar">Revisar ${plural(toConfirm.length, 'caja', 'cajas')}</a>
    <details class="more"><summary>Ver la lista</summary>${rows(toConfirm.slice(0, 60), null)}</details>
  </section>` : ''}

  <h2 class="qh" id="entregar">Por entregar ahora <span class="n">${now.length || ''}</span></h2>
  ${now.length ? rows(now, 'deliver') : `<p class="qempty">Nada pendiente para hoy.${toConfirm.length ? ' Revisa las cajas por confirmar arriba.' : ''}</p>`}

  ${heldWaiting.length ? `<h2 class="qh">En resguardo en bodega <span class="n">${heldWaiting.length}</span></h2><p class="small muted">Cajas guardadas para el socio. Regístralas cuando salgan.</p>${rows(heldWaiting, 'deliver')}` : ''}
  ${occ.some(o => o.state === 'held' && o.holdReleaseDue) ? `<p class="small muted">${occ.filter(o => o.state === 'held' && o.holdReleaseDue).length} resguardo(s) con fecha cumplida: coordinar retiro o envío.</p>` : ''}

  <h2 class="qh" id="hoy"><span id="semana"></span>Resto de esta semana <span class="n">${week.length || ''}</span></h2>
  ${week.length ? rows(week, null) : '<p class="qempty">Nada más esta semana.</p>'}

  ${[...byMonth.entries()].map(([key, list]) => `<h2 class="qh">${MESES[Number(key.slice(5)) - 1]}${key.slice(0, 4) !== today.slice(0, 4) ? ' ' + key.slice(0, 4) : ''} <span class="n">${list.length}</span></h2>${rows(list, null)}`).join('')}
  <form method="get" action="/" class="qrange"><label for="dias">Ver próximos</label>
    <select id="dias" name="dias" onchange="this.form.submit()">${[[30, '30 días'], [90, '3 meses'], [180, '6 meses'], [365, '1 año']].map(([d, l]) => `<option value="${d}" ${d === horizon ? 'selected' : ''}>${l}</option>`).join('')}</select></form>

  ${recent.length ? `<details class="more"><summary>Registrado en los últimos 7 días (${recent.length})</summary><div class="rows">${recent.map(o => `
    <a class="row" href="${shipHref(o)}"><div class="main"><div class="t">${esc(o.sub.member_name)} · #${o.n}</div>
    <div class="s">${esc(attribution(o.f, today))}${o.f.order_ref ? ' · ' + esc(o.f.order_ref) : ''}</div></div></a>`).join('')}</div></details>` : ''}

  ${blocked.length ? `<details class="more" id="bloqueados"><summary>Calendarios bloqueados (${blocked.length})</summary><div class="rows">${blocked.map(s => `<a class="row" href="${user.isManager ? `/conciliar#p-${esc(s.stripe_product_id || '')}` : `/socio/${s.member_id}`}"><div class="main"><div class="t">${esc(s.member_name)}</div>
      <div class="s">${esc(s.product_name || 'sin producto')} · ${esc(s.status)}</div></div>${chip('Resolver', 'red')}</a>`).join('')}</div></details>` : ''}
  <p class="center small"><a href="/preguntar">Pregúntale al club (asistente)</a></p>
  ${QCSS}`;
  return page({ title: 'Por entregar', body, user, env, tab: 'agenda', alerts: alertList.length, alertsRed: alertList.filter(a => a.tone === 'red').length });
}

// ---------- catch-up: past dates nobody recorded ----------
export function confirmPage({ env, user, ctx, url, okAudit }) {
  const today = ctx.today;
  const { occ } = allOccurrences(ctx, today);
  const list = occ.filter(unconfirmed).sort(sortEff);
  const body = `
  <p><a href="/">← Por entregar</a></p>
  ${okBanner(okAudit, today)}
  <h1>Ponerse al día</h1>
  <p class="muted">Cada caja tiene una fecha pasada y ningún registro. Si ya se entregó o envió, toca <b>Ya salió</b> y anota la fecha real. Si no, toca <b>Pendiente</b> y pasa a “Por entregar”.</p>
  ${list.length ? `<p class="qcount"><b>${plural(list.length, 'caja', 'cajas')}</b> por revisar, de la más antigua a la más reciente.</p>${list.map(o => qrow(o, today, { action: 'confirm', back: '/confirmar' })).join('')}`
    : '<div class="card empty"><b>Todo al día.</b><br>No hay cajas con fecha pasada sin registro.</div>'}
  ${QCSS}`;
  return page({ title: 'Ponerse al día', body, user, env, tab: 'agenda' });
}

export const QCSS = `<style>
.qh{display:flex;align-items:baseline;gap:8px;font-size:15px;font-weight:800;margin:22px 0 8px;color:var(--ink)}
.qh .n{font-size:13px;color:var(--muted);font-weight:700}
.qrow{display:flex;flex-direction:column;background:#fff;border:1px solid var(--line);border-left:5px solid var(--line);border-radius:12px;margin:8px 0;overflow:hidden}
.qrow.late{border-left-color:var(--red)}.qrow.now{border-left-color:var(--wine)}.qrow.held{border-left-color:var(--amber)}
.qmain{display:flex;flex-direction:column;gap:2px;padding:12px 14px;text-decoration:none;color:var(--ink);min-height:56px}
.qmain .qwhen{font-size:13px;font-weight:700;color:var(--muted)}.qrow.late .qwhen{color:var(--red)}.qrow.now .qwhen{color:var(--wine)}
.qmain .name{font-size:18px;font-weight:700;line-height:1.2;overflow-wrap:anywhere}
.qmain .meta{font-size:14px;color:var(--muted)}
.qmain .chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:4px}
.qacts{display:flex;gap:8px;padding:0 14px 12px}
.qacts form{margin:0;flex:1;display:flex}
.qbtn{flex:1;display:flex;align-items:center;justify-content:center;min-height:48px;padding:0 14px;border-radius:12px;background:var(--wine);color:#fff;font-weight:700;font-size:16px;text-decoration:none;border:2px solid var(--wine);font-family:inherit;cursor:pointer}
.qbtn.ghost{background:#fff;color:var(--wine)}
@media (min-width:720px){.qrow{flex-direction:row;align-items:center}.qmain{flex:1}.qacts{padding:12px 14px;flex:none;min-width:200px}.qrow.confirm .qacts{min-width:330px}}
.catchup{background:var(--red-soft);border:1px solid #f3c4bf;border-radius:var(--r);padding:14px;margin:14px 0}
.catchup h2{margin:0 0 4px;font-size:18px;color:var(--red)}.catchup p{margin:0 0 12px}
.catchup details.more summary{margin-top:10px}
.alert{display:flex;flex-direction:column;gap:2px;padding:12px 14px;border-radius:12px;margin:8px 0;text-decoration:none}
.alert.red{background:var(--red-soft);color:var(--red)}.alert.amber{background:var(--amber-soft);color:var(--amber)}
.alert span{font-size:14px}
.qempty{color:var(--muted);margin:4px 0 0}
.qrange{display:flex;gap:10px;align-items:center;margin:18px 0}.qrange label{margin:0;white-space:nowrap}.qrange select{width:auto}
.qcount{margin:14px 0 4px}
</style>`;
