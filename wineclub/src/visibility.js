import { esc, fdate, chip, stateLabel, STATE, STATUS_LABEL } from './ui.js';
import { daysBetween } from './schedule.js';
import { isIgnored, subClub } from './data.js';

export const exactDate = (date) => date ? fdate(date, null, { weekday: false }) : 'Sin fecha';

// Subscription start is evidence of an enrollment, never the date we imported the member.
// An adjusted shipment anchor must not rewrite that enrollment date.
export function joinedDate(ctx, memberId) {
  return ctx.subs.filter(s => s.member_id === memberId && !isIgnored(s) && subClub(ctx, s))
    .map(s => s.start_date).filter(Boolean).sort()[0] || null;
}

export const recordedPending = (o) => ['needs_prep', 'ready', 'exception'].includes(o.status);
export const visibleStatus = (o) => o.state === 'overdue' && !recordedPending(o) ? 'Por comprobar' : stateLabel(o);

export function dateFacts(o) {
  const f = o.f || {};
  return `<dl class="date-facts">
    <div><dt>Fecha prevista por calendario</dt><dd>${esc(exactDate(o.due))}</dd></div>
    ${o.delayed ? `<div><dt>Reprogramado para</dt><dd>${esc(exactDate(o.eff))}</dd></div>` : ''}
    <div><dt>Fecha real registrada</dt><dd>${f.done_on ? esc(exactDate(f.done_on)) : '<span class="muted">Sin entrega registrada</span>'}</dd></div>
    ${f.delivered_on ? `<div><dt>Recibido por el socio</dt><dd>${esc(exactDate(f.delivered_on))}</dd></div>` : ''}
    ${f.expected_date && f.expected_date !== o.due ? `<div><dt>Fecha prevista al crear el registro</dt><dd>${esc(exactDate(f.expected_date))}</dd></div>` : ''}
  </dl>`;
}

export function scheduleRow(o) {
  const f = o.f || {};
  const delta = f.done_on ? daysBetween(o.due, f.done_on) : null;
  const timing = delta == null ? '' : delta === 0 ? 'En la fecha prevista' : delta > 0 ? `${delta} días después de la fecha prevista` : `${-delta} días antes de la fecha prevista`;
  const result = f.done_on ? `${STATUS_LABEL[o.status] || 'Entrega'}: ${exactDate(f.done_on)}` : o.state === 'done' ? 'Entrega registrada sin fecha real' : o.state === 'upcoming' ? 'Programado; todavía no toca' : ['paused','skipped','pretracking'].includes(o.state) ? stateLabel(o) : 'Sin entrega registrada';
  return `<a class="schedule-row ${o.state}" href="/envio/${o.subId}/${o.k}">
    <div class="schedule-top"><b>Envío #${o.n}</b>${chip(visibleStatus(o), o.state === 'overdue' && !recordedPending(o) ? 'amber' : STATE[o.state].tone)}</div>
    <div class="expected"><span>Fecha prevista</span><strong>${esc(exactDate(o.due))}</strong></div>
    ${o.delayed ? `<p class="small rescheduled">Reprogramado: <b>${esc(exactDate(o.eff))}</b>${f.delay_reason ? ' · ' + esc(f.delay_reason) : ''}</p>` : ''}
    <p class="small actual ${o.state === 'done' ? 'complete' : ''}">${esc(result)}</p>
    ${timing ? `<p class="small muted">${esc(timing)}</p>` : ''}
    ${f.handled_by ? `<p class="small muted">Por ${esc(f.handled_by)}</p>` : ''}
    ${o.missingAllocation ? '<p class="small allocation-gap">Falta definir la caja</p>' : ''}
    ${f.order_ref ? `<p class="small muted">Pedido: ${esc(f.order_ref)}</p>` : ''}
  </a>`;
}
