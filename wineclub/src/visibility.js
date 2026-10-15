import { esc, fdate, chip, stateLabel, STATE, STATUS_LABEL } from './ui.js';
import { daysBetween,addDays } from './schedule.js';
import { isIgnored, subClub } from './data.js';

export const exactDate = (date) => date ? fdate(date, null, { weekday: false }) : 'Sin fecha';

// Subscription start is evidence of an enrollment, never the date we imported the member.
// An adjusted shipment anchor must not rewrite that enrollment date.
export function joinedDate(ctx, memberId) {
  return ctx.subs.filter(s => s.member_id === memberId && !isIgnored(s) && subClub(ctx, s))
    .map(s => s.start_date).filter(Boolean).sort()[0] || null;
}

export const recordedPending = (o) => ['needs_prep', 'ready', 'exception'].includes(o.status) || !!o.f?.delayed_until;
export const visibleStatus = (o) => ['suspended','payment_blocked','payment_contact'].includes(o.state) ? stateLabel(o) : o.holdReleaseDue ? 'Resguardo · fecha cumplida' : o.delayed && o.state === 'upcoming' ? 'Aplazado por solicitud' : o.state === 'overdue' && !recordedPending(o) ? 'Por comprobar' : stateLabel(o);
export const holdTerm = o => o.f?.hold_until ? `Liberar a partir del ${exactDate(o.f.hold_until)}` : 'Resguardo indefinido · sin fecha de liberación';

export function inboxReason(o,today) {
  if(o.state==='held')return o.holdReleaseDue?'Fecha de resguardo cumplida':null;
  if(o.state==='exception')return 'Excepción por resolver';
  if(!['overdue','today','upcoming'].includes(o.state)||o.status&&o.status!=='scheduled')return null;
  if(o.delayed&&o.eff>today)return null;
  return o.eff<=addDays(today,7)?'Sin clasificar':null;
}

export function paymentBadge(f,o) {
  const paid=!!(f?.stripe_invoice_id&&f?.paid_on);
  const needsReview=['overdue','today','exception','held','done','suspended','payment_blocked'].includes(o?.state);
  const label=paid?`Pagado · ${exactDate(f.paid_on)}`:'Sin pago de Stripe asociado';
  return `<span class="chip ${paid?'green':o?.state==='payment_contact'?'amber':needsReview?'red':'grey'}" title="${esc(paid?'Pago registrado en Stripe':'Requiere comprobar la factura; no confirma un impago')}">${esc(label)}</span>`;
}

export function dateFacts(o) {
  const f = o.f || {};
  return `<dl class="date-facts">
    <div><dt>Fecha prevista por calendario</dt><dd>${esc(exactDate(o.due))}</dd></div>
    ${o.delayed ? `<div><dt>Reprogramado para</dt><dd>${esc(exactDate(o.eff))}</dd></div>` : ''}
    <div><dt>Fecha real registrada</dt><dd>${f.done_on ? esc(exactDate(f.done_on)) : '<span class="muted">Sin entrega registrada</span>'}</dd></div>
    ${f.delivered_on ? `<div><dt>Recibido por el socio</dt><dd>${esc(exactDate(f.delivered_on))}</dd></div>` : ''}
    ${f.held_on ? `<div><dt>${o.state==='held'?'Resguardo registrado':'Resguardo anterior registrado'}</dt><dd>${esc(exactDate(f.held_on))}</dd></div>` : ''}
    ${o.state==='held'?`<div><dt>Liberación del resguardo</dt><dd>${esc(f.hold_until?exactDate(f.hold_until):'Indefinido · sin fecha')}</dd></div>`:''}
    ${f.expected_date && f.expected_date !== o.due ? `<div><dt>Fecha prevista al crear el registro</dt><dd>${esc(exactDate(f.expected_date))}</dd></div>` : ''}
  </dl>`;
}

export function scheduleRow(o) {
  const f = o.f || {};
  const delta = f.done_on ? daysBetween(o.due, f.done_on) : null;
  const timing = delta == null || delta === 0 ? '' : delta > 0 ? `${delta} días después de la fecha prevista` : `${-delta} días antes de la fecha prevista`;
  const result = o.state === 'done' ? 'Entrega registrada sin fecha real' : ['overdue','today','exception'].includes(o.state) ? 'Sin entrega registrada' : '';
  const metadata=[f.handled_by?'Por '+f.handled_by:null,f.order_ref?'Pedido: '+f.order_ref:null].filter(Boolean);
  return `<a class="schedule-row ${o.state}" href="/envio/${o.subId}/${o.k}">
    <div class="schedule-top"><b>Envío #${o.n}</b><div class="schedule-badges">${chip(visibleStatus(o), o.state === 'overdue' && !recordedPending(o) ? 'amber' : STATE[o.state].tone)}${paymentBadge(f,o)}</div></div>
    <dl class="shipment-dates"><div><dt>${o.delayed?'Fecha original':'Fecha prevista'}</dt><dd>${esc(exactDate(o.due))}</dd></div>
    ${o.delayed?`<div class="rescheduled"><dt>Entrega aplazada</dt><dd>${esc(exactDate(o.eff))}</dd></div>`:''}
    ${f.done_on?`<div class="complete"><dt>${esc(STATUS_LABEL[o.status]||'Entrega registrada')}</dt><dd>${esc(exactDate(f.done_on))}</dd></div>`:''}</dl>
    ${o.delayed && f.delay_reason?`<p class="small rescheduled">${esc(f.delay_reason)}</p>`:''}
    ${o.state==='held'?`<p class="small"><b>${esc(holdTerm(o))}</b></p><p class="small">${esc(f.hold_reason||'Conservado en bodega hasta su retiro o envío')}</p>`:''}
    ${!f.done_on && result?`<p class="small actual">${esc(result)}</p>`:''}
    ${timing ? `<p class="small muted">${esc(timing)}</p>` : ''}
    ${metadata.length?`<p class="small muted shipment-meta">${esc(metadata.join(' · '))}</p>`:''}
    ${o.missingAllocation ? '<p class="small allocation-gap">Falta definir la caja</p>' : ''}
  </a>`;
}
