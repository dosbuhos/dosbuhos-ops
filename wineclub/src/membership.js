import {esc,fdate} from './ui.js';

export function suspensionWarning(s) {
  if(!s?.suspended_on)return '';
  return `<div class="banner red" role="status"><div><b>Suspendido por falta de pago</b><p>${esc(s.suspension_reason)}</p><p class="small">Desde ${esc(fdate(s.suspended_on))} · Registrado por ${esc(s.suspension_by)}. Preparación, entregas y beneficios bloqueados. El historial y el calendario original se conservan.</p><p class="small">Suspensión interna del club. No modifica los cobros ni los reintentos de Stripe.</p>${s.stripe_subscription_id?`<a href="https://dashboard.stripe.com/subscriptions/${encodeURIComponent(s.stripe_subscription_id)}" target="_blank" rel="noopener">Revisar suscripción en Stripe ↗</a>`:''}</div></div>`;
}

export function membershipControls(member,user) {
  if(!user.isManager)return '';
  const suspended=!!member.suspended_on;
  return `<details class="more card" id="membresia"><summary><span>Estado de membresía · ${suspended?'Suspendido':'Activo en el club'}<small>Administrar membresía</small></span><span class="membership-arrow" aria-hidden="true">▾</span></summary>
  <p>Suspender bloquea preparación, entregas y beneficios. Reactivar conserva las fechas originales; revisa las cajas pendientes antes de entregarlas.</p>
  <p class="small">Esta acción no cambia Stripe ni detiene sus reintentos de cobro. Revisa la suscripción y las facturas en Stripe por separado.</p>
  <form method="post" action="/socio/${member.id}/membresia"><input type="hidden" name="version" value="${member.membership_version||0}"><input type="hidden" name="action" value="${suspended?'resume':'suspend'}">
  <label for="membership-reason">${suspended?'Motivo de reactivación':'Motivo de suspensión por falta de pago'}</label><textarea id="membership-reason" name="reason" required maxlength="500"></textarea>
  <button class="btn" style="margin-top:12px">${suspended?'Reactivar membresía':'Suspender por falta de pago'}</button></form></details>`;
}
