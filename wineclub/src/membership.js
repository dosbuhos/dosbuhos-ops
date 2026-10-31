import {esc,fdate} from './ui.js';
export const paymentBlocked=f=>!!f?.payment_blocked&&!(f.stripe_invoice_id&&f.paid_on)&&!f.payment_release_reason;
export const paymentContact=s=>!s?.suspended_on&&(!!s?.payment_followup_on||!!s?.stripe_subscription_id&&['past_due','unpaid','incomplete'].includes(s.status));
export const contactBlocksShipment=(s,f)=>paymentContact(s)&&!(f?.stripe_invoice_id&&f?.paid_on)&&!f?.payment_release_reason;
export function paymentReviewWarning(f) {
  if(paymentBlocked(f))return '<div class="banner red">Envío bloqueado hasta verificar el pago. Un pago asociado de Stripe levanta este bloqueo. Un administrador puede revisar una excepción desde la reactivación.</div>';
  if(f?.payment_release_reason)return `<div class="banner amber">Entrega autorizada como excepción administrativa: ${esc(f.payment_release_reason)}. Esta autorización no registra un pago.</div>`;
  return '';
}

export function suspensionWarning(s) {
  if(!s?.suspended_on)return '';
  return `<div class="banner red" role="status"><div><b>Suspendido por falta de pago</b><p>${esc(s.suspension_reason)}</p><p class="small">Desde ${esc(fdate(s.suspended_on))} · Registrado por ${esc(s.suspension_by)}. Preparación, entregas y beneficios bloqueados. El historial y el calendario original se conservan.</p><p class="small">Suspensión interna del club. No modifica los cobros ni los reintentos de Stripe.</p>${s.stripe_subscription_id?`<a href="https://dashboard.stripe.com/subscriptions/${encodeURIComponent(s.stripe_subscription_id)}" target="_blank" rel="noopener">Revisar suscripción en Stripe ↗</a>`:''}</div></div>`;
}

export function membershipControls(member,user,ended=false) {
  if(!user.isManager)return '';
  const suspended=!!member.suspended_on;
  return `<details class="more card" id="membresia"><summary><span>Membresía · ${suspended?'Suspendido':member.payment_followup_on?'Contactar para nueva forma de pago':ended?'Terminada':'Activa'}<small>Administrar membresía</small></span><span class="membership-arrow" aria-hidden="true">▾</span></summary>
  <p>Suspender bloquea preparación, entregas y beneficios. Reactivar conserva las fechas originales; revisa las cajas pendientes antes de entregarlas.</p>
  <p class="small">Esta acción no cambia Stripe ni detiene sus reintentos de cobro. Revisa la suscripción y las facturas en Stripe por separado.</p>
  ${suspended?`<a class="btn" href="/socio/${member.id}/reactivar">Reactivar membresía · revisar envíos →</a>`:''}<form method="post" action="/socio/${member.id}/membresia"><input type="hidden" name="version" value="${member.membership_version||0}">
  <label for="membership-reason">Motivo del cambio</label><textarea id="membership-reason" name="reason" required maxlength="500"></textarea>
  <p class="small">Amarillo: contactar y ofrecer otra forma de pago. Rojo: bloqueo de cobro, negativa o salida confirmada. Un fallo de tarjeta no suspende automáticamente al socio.</p>
  <div class="acts"><button class="btn quiet" name="action" value="contact">Contactar para nueva forma de pago</button>${!suspended?'<button class="btn danger" name="action" value="suspend">Suspender por falta de pago</button>':''}</div>${member.payment_followup_on?'<button class="btn quiet" name="action" value="clear_contact">Cerrar seguimiento de pago</button>':''}</form></details>`;
}
