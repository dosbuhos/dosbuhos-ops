import {isIgnored,subClub} from './data.js';
import {esc,page,money} from './ui.js';
import {suspensionWarning} from './membership.js';

export function billingIssue(ctx,s) {
  if(s.suspended_on)return {sub:s,title:'Suspendido por falta de pago',detail:s.suspension_reason||'Membresía suspendida por administración.'};
  if(!s.stripe_subscription_id||isIgnored(s))return null;
  const labels={past_due:['Cobro pendiente en Stripe','Stripe indica un cobro vencido o pendiente de completar. Revisa la factura y el intento de pago.'],
    unpaid:['Suscripción sin pagar','Stripe marca la suscripción como no pagada. Revisa las facturas y los intentos de cobro.'],
    incomplete:['Primer pago incompleto','El primer pago no se completó. Revisa Stripe antes de entregar.'],
    paused:['Suscripción pausada en Stripe','Confirma qué periodos están pagados antes de preparar otra caja.']};
  if(labels[s.status])return {sub:s,title:labels[s.status][0],detail:labels[s.status][1]};
  if((ctx.pausesBySub?.get(s.id)||[]).some(p=>p.source==='stripe'&&p.from_date<=ctx.today&&(!p.until_date||p.until_date>ctx.today)))
    return {sub:s,title:'Cobro pausado en Stripe',detail:'La recaudación está pausada. Revisa la factura del periodo antes de entregar.'};
  if(s.missing_in_stripe)return {sub:s,title:'No se pudo verificar la suscripción',detail:'La suscripción ya no aparece en la sincronización de Stripe. Un administrador debe revisarla.'};
  return null;
}
export const billingIssues=ctx=>ctx.subs.map(s=>billingIssue(ctx,s)).filter(Boolean);
export const stripeLink=s=>'https://dashboard.stripe.com/subscriptions/'+encodeURIComponent(s.stripe_subscription_id);
export function billingWarning(ctx,s,{paid=false}={}) {
  if(s.suspended_on)return suspensionWarning(s);
  const issue=billingIssue(ctx,s);if(!issue)return '';
  return `<div class="banner red" role="status"><div><b>⚠ ${esc(issue.title)}</b><br>${esc(issue.detail)}
    <p class="small">${paid?'Esta caja tiene un pago asociado; el problema puede corresponder a otro periodo.':'El estado de la suscripción no identifica por sí solo qué caja está pagada.'} No se cambia ni se elimina una entrega por esta alerta.</p>
    <a href="/alertas">Ver alertas de cobro</a> · <a href="${stripeLink(s)}" target="_blank" rel="noopener">Revisar en Stripe ↗</a></div></div>`;
}
export function billingPage({ctx,env,user}) {
  const issues=billingIssues(ctx);let sync;try{sync=JSON.parse(ctx.settings.last_sync||'null')}catch{}
  return page({env,user,tab:'agenda',title:'Alertas de cobro',body:`<p><a href="/">← Agenda</a></p><h1>Alertas de cobro (${issues.length})</h1>
    <p>Revisa los cobros antes de entregar. Un problema de la suscripción puede corresponder a un periodo distinto de una caja que ya está pagada.</p>
    <p class="small muted">Última sincronización: ${sync?esc(sync.at?.replace('T',' ').slice(0,19))+' UTC':'Sin sincronización registrada'}. Se actualiza al sincronizar Stripe; no es una comprobación en tiempo real.</p>
    ${sync&&!sync.ok?'<div class="banner red">La última sincronización falló. La información puede estar desactualizada.</div>':''}
    ${issues.map(({sub:s,title,detail})=>`<article class="card"><h2 style="margin-top:0"><a href="/socio/${s.member_id}">${esc(s.member_name)}</a></h2><b style="color:var(--red)">${esc(title)}</b><p>${esc(detail)}</p>
      <p class="small">${esc(subClub(ctx,s)?.name||s.product_name||'Club por confirmar')}${s.price_amount!=null?' · '+money(s.price_amount,s.price_currency):''}</p>
      <div class="acts"><a class="btn quiet" href="/socio/${s.member_id}">Ver socio y entregas</a><a class="btn ghost" href="${stripeLink(s)}" target="_blank" rel="noopener">Revisar en Stripe ↗</a></div></article>`).join('')||'<div class="card">Sin alertas por estado de suscripción en los datos sincronizados.</div>'}
    <p class="small muted">Estas alertas muestran estados de suscripción, no el motivo exacto de rechazo de una tarjeta ni todas las facturas abiertas. Para decidir si una caja está pagada, revisa su factura del periodo en Stripe. “Sin pago asociado” en la app requiere comprobarlo; no demuestra un impago.</p>
    ${user.isManager?'<p><a href="/ajustes">Sincronizar Stripe en Ajustes</a></p>':''}`});
}
