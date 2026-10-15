import {esc,page,bottleList,chip} from './ui.js';
import {loadContext,subOccurrences,subClub} from './data.js';
import {addDays} from './schedule.js';
import {exactDate,paymentBadge} from './visibility.js';
const paid=o=>!!(o.f?.stripe_invoice_id&&o.f?.paid_on);

export function reactivationPlan(ctx) {
  const all=ctx.subs.flatMap(s=>subOccurrences(ctx,{...s,suspended_on:null},addDays(ctx.today,400))||[]);
  return all.filter(o=>!['done','skipped','pretracking','paused'].includes(o.state)&&(o.due<=ctx.today||o.f?.status))
    .sort((a,b)=>a.due.localeCompare(b.due)||a.subId-b.subId);
}
async function digest(ctx,member,rows) {
  const data=JSON.stringify([ctx.today,member.membership_version,ctx.subs,[...ctx.fulByKey].map(([id,fs])=>[id,[...fs]]),rows.map(o=>[o.subId,o.k,o.bottles])]);
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(data)))].map(x=>x.toString(16).padStart(2,'0')).join('');
}

export async function reactivationPage({env,user,member,ctx,error=null,status=200}) {
  const rows=reactivationPlan(ctx),token=await digest(ctx,member,rows);
  const future=ctx.subs.map(s=>({s,next:(subOccurrences(ctx,{...s,suspended_on:null},addDays(ctx.today,400))||[]).find(o=>o.due>ctx.today&&o.state!=='done')}));
  const render=args=>{const response=page(args);return new Response(response.body,{status,headers:response.headers});};
  return render({env,user,tab:'socios',title:'Revisar reactivación',body:`<p><a href="/socio/${member.id}#membresia">← Socio</a></p><h1>Reactivar · ${esc(member.name)}</h1>
    <p>Revisa cada caja antes de quitar la suspensión. No se registra ninguna entrega ni se cobra al cliente desde esta pantalla.</p>
    ${error?`<div class="banner red">${esc(error)}</div>`:''}
    <form method="post" action="/socio/${member.id}/reactivar"><input type="hidden" name="review" value="${token}"><input type="hidden" name="version" value="${member.membership_version}">
    <h2>1. Envíos pendientes (${rows.length})</h2>
    ${rows.map(o=>`<section class="card"><h3>Envío #${o.n} · ${esc(o.club.name)}</h3><p>Fecha original: <b>${esc(exactDate(o.due))}</b></p><div class="chips">${paymentBadge(o.f,{state:'overdue'})}${o.status==='held'?chip('En resguardo','wine'):''}</div>
      ${o.bottles?`<details class="more"><summary>Ver botellas ▾</summary>${bottleList(o.bottles)}</details>`:'<p class="small">Falta definir la caja. Se revisará antes de entregar.</p>'}
      <label for="choice-${o.subId}-${o.k}">Qué hacer con esta caja</label><select id="choice-${o.subId}-${o.k}" name="choice_${o.subId}_${o.k}">
      ${paid(o)?'<option value="keep">Conservar estado actual / volver a su cola</option><option value="prepare">Pasar a preparación</option>':'<option value="block">Mantener bloqueada hasta verificar el pago</option><option value="exception">Autorizar como excepción administrativa</option>'}
      <option value="skip">Omitir esta caja por acuerdo con el socio</option></select>
      <label for="note-${o.subId}-${o.k}">Motivo (obligatorio para omitir o autorizar excepción)</label><input id="note-${o.subId}-${o.k}" name="note_${o.subId}_${o.k}" maxlength="500">
      ${!paid(o)?'<p class="small muted">Sin pago asociado no significa necesariamente impago. Una excepción no marca la caja como pagada. Al asociarse un pago de Stripe, el bloqueo de esta caja se levanta.</p>':''}</section>`).join('')||'<div class="card">No hay cajas pendientes que revisar.</div>'}
    <h2>2. Calendario y cobro</h2><p>Se conservan las fechas originales y el número de cada envío. Una entrega tardía no mueve los siguientes envíos. Omitir una caja no cancela ni perdona una factura.</p>
    ${future.map(({s,next})=>`<div class="card small"><b>${esc(subClub(ctx,s)?.name||s.product_name||'Suscripción')}</b><p>Estado de cobro: <b>${esc(s.status)}</b></p><p>Próxima fecha teórica: <b>${next?esc(exactDate(next.due)):'Sin fecha futura en la suscripción actual'}</b></p>${s.stripe_subscription_id?`<a href="https://dashboard.stripe.com/subscriptions/${encodeURIComponent(s.stripe_subscription_id)}" target="_blank" rel="noopener">Revisar Stripe ↗</a>`:''}${['canceled','manual_ended'].includes(s.status)?'<p class="warn">La suscripción terminó. Reactivar aquí no restablece el cobro ni genera un nuevo calendario. Resuelve la continuidad de la suscripción por separado; las cajas antiguas permanecen en su historial.</p>':''}</div>`).join('')}
    <label style="display:flex;gap:10px;align-items:start"><input type="checkbox" name="billing_reviewed" value="1" required style="width:24px;min-height:24px;flex:none">Revisé el estado de cobro y entiendo que esta acción no modifica Stripe.</label>
    <label for="resume-reason">Motivo de reactivación</label><textarea id="resume-reason" name="reason" required maxlength="500"></textarea><button class="btn" style="margin-top:16px">Confirmar reactivación y decisiones</button></form>`});
}

export async function reactivate(env,user,member,fm) {
  const ctx=await loadContext(env,{memberId:member.id}),rows=reactivationPlan(ctx);
  const fail=(message,status=400)=>reactivationPage({env,user,member,ctx,error:message,status});
  if(!member.suspended_on)return fail('Este socio ya no está suspendido.',409);
  if(Number(fm.version)!==member.membership_version||fm.review!==await digest(ctx,member,rows))return fail('La información cambió. Revisa de nuevo las decisiones antes de confirmar.',409);
  const reason=String(fm.reason||'').trim().slice(0,500);
  if(!reason||fm.billing_reviewed!=='1')return fail('Indica el motivo y confirma que revisaste el cobro.');
  const decisions=[];
  for(const o of rows) {
    const choice=fm[`choice_${o.subId}_${o.k}`],note=String(fm[`note_${o.subId}_${o.k}`]||'').trim().slice(0,500);
    if(!(paid(o)?['keep','prepare','skip']:['block','exception','skip']).includes(choice))return fail(`Elige qué hacer con el envío #${o.n}.`);
    if(['skip','exception'].includes(choice)&&!note)return fail(`Indica el motivo de la decisión para el envío #${o.n}.`);
    decisions.push({o,choice,note});
  }
  const fuls=[...ctx.fulByKey.values()].flatMap(fs=>[...fs.values()]);
  const subs=ctx.subs.map(s=>({id:s.id,synced_at:s.synced_at,anchor:s.anchor_override,start:s.start_date,status:s.status,ended:s.ended_on}));
  const token=crypto.randomUUID();
  // The CHECK is a transaction guard. If any shipment/payment/subscription changed after
  // review, the whole D1 batch rolls back, including reactivation and all decisions.
  const batch=[env.DB.prepare(`INSERT INTO membership_review_commits(token,checked) SELECT ?,
    (EXISTS(SELECT 1 FROM members WHERE id=? AND membership_version=? AND suspended_on IS NOT NULL)
    AND (SELECT COUNT(*) FROM fulfillments f JOIN subscriptions s ON s.id=f.subscription_id WHERE s.member_id=?)=?
    AND NOT EXISTS(SELECT 1 FROM json_each(?) j LEFT JOIN fulfillments f ON f.subscription_id=json_extract(j.value,'$.subscription_id') AND f.k=json_extract(j.value,'$.k') WHERE f.id IS NULL OR f.version IS NOT json_extract(j.value,'$.version') OR f.stripe_invoice_id IS NOT json_extract(j.value,'$.stripe_invoice_id') OR f.paid_on IS NOT json_extract(j.value,'$.paid_on'))
    AND (SELECT COUNT(*) FROM subscriptions WHERE member_id=?)=?
    AND NOT EXISTS(SELECT 1 FROM json_each(?) j LEFT JOIN subscriptions s ON s.id=json_extract(j.value,'$.id') WHERE s.id IS NULL OR s.synced_at IS NOT json_extract(j.value,'$.synced_at') OR s.anchor_override IS NOT json_extract(j.value,'$.anchor') OR s.start_date IS NOT json_extract(j.value,'$.start') OR s.status IS NOT json_extract(j.value,'$.status') OR s.ended_on IS NOT json_extract(j.value,'$.ended')))`)
    .bind(token,member.id,member.membership_version,member.id,fuls.length,JSON.stringify(fuls),member.id,subs.length,JSON.stringify(subs)),
    env.DB.prepare(`UPDATE members SET suspended_on=NULL,suspension_reason=NULL,suspension_by=NULL,membership_version=membership_version+1,updated_at=datetime('now') WHERE id=?`).bind(member.id)];
  for(const {o,choice,note} of decisions) {
    if(choice==='keep')continue;
    const f=o.f||{},fields=choice==='skip'?{status:'skipped',note:[f.note,note].filter(Boolean).join(' · '),payment_blocked:0,payment_release_reason:null}:
      choice==='prepare'?{status:'needs_prep',payment_blocked:0,payment_release_reason:null,...(!f.bottles_json&&o.bottles?{bottles_json:JSON.stringify(o.bottles)}:{})}:
      {payment_blocked:1,payment_release_reason:choice==='exception'?note:null};
    const cols=Object.keys(fields);
    if(f.id)batch.push(env.DB.prepare(`UPDATE fulfillments SET ${cols.map(c=>c+'=?').join(',')},version=version+1,last_change=?,updated_by=?,updated_at=datetime('now') WHERE id=?`).bind(...Object.values(fields),token,user.email,f.id));
    else batch.push(env.DB.prepare(`INSERT INTO fulfillments(subscription_id,k,expected_date,${cols.join(',')},version,last_change,updated_by) VALUES (?,?,?,${cols.map(()=>'?').join(',')},1,?,?)`).bind(o.subId,o.k,o.due,...Object.values(fields),token,user.email));
    batch.push(env.DB.prepare(`INSERT INTO audit_log(who,action,entity,entity_id,before_json,after_json,note) VALUES (?,?,'fulfillment',?,?,?,?)`).bind(user.email,'reactivación: '+choice,`${o.subId}:${o.k}`,JSON.stringify(f),JSON.stringify({...f,...fields}),note||reason));
  }
  batch.push(env.DB.prepare(`INSERT INTO audit_log(who,action,entity,entity_id,before_json,after_json,note) VALUES (?,'reactivar membresía','member',?,?,?,?)`).bind(user.email,String(member.id),JSON.stringify({suspended_on:member.suspended_on,suspension_reason:member.suspension_reason}),JSON.stringify({suspended_on:null,decisions:decisions.map(({o,choice,note})=>({sub:o.subId,k:o.k,choice,note})),billing_reviewed:true}),reason));
  try{await env.DB.batch(batch);}catch(e){if(String(e.message).includes('CHECK constraint'))return fail('La información cambió mientras guardabas. No se aplicó ningún cambio; revisa de nuevo.',409);throw e;}
  return new Response(null,{status:303,headers:{location:`/socio/${member.id}?reactivado=1#calendario`}});
}
