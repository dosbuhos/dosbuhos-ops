import {esc,page,bottleList,chip} from './ui.js';
import {subOccurrences,subClub} from './data.js';
import {addDays,dueDate,isDate,daysBetween} from './schedule.js';
import {exactDate,paymentBadge} from './visibility.js';
import {planContext} from './returning.js';
const paid=o=>!!(o.f?.stripe_invoice_id&&o.f?.paid_on);

export function reactivationPlan(ctx) {
  const all=ctx.subs.flatMap(s=>subOccurrences(ctx,{...s,suspended_on:null},addDays(ctx.today,400))||[]);
  return all.filter(o=>!['done','skipped','pretracking','paused'].includes(o.state)&&(o.due<=ctx.today||o.f?.status))
    .sort((a,b)=>a.due.localeCompare(b.due)||a.subId-b.subId);
}
async function digest(ctx,member,rows,ev) {
  const data=JSON.stringify([ctx.today,member.membership_version,ctx.subs,[...ctx.fulByKey].map(([id,fs])=>[id,[...fs]]),rows.map(o=>[o.subId,o.k,o.bottles]),ev?[ev.stripeId,ev.dup?.id,ev.dup?.membership_version]:null]);
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(data)))].map(x=>x.toString(16).padStart(2,'0')).join('');
}
const choicesFor=(o,canException)=>paid(o)?['keep','prepare','skip']:['block',...(canException?['exception']:[]),'skip'];
const CHOICE_LABEL={keep:'Conservar estado actual / volver a su cola',prepare:'Pasar a preparación',block:'Mantener bloqueada hasta verificar el pago',exception:'Autorizar como excepción administrativa',skip:'Omitir esta caja por acuerdo con el socio'};
const choiceSelect=(o,canException,label='Qué hacer con esta caja')=>`<label for="choice-${o.subId}-${o.k}">${label}</label><select id="choice-${o.subId}-${o.k}" name="choice_${o.subId}_${o.k}">
  ${choicesFor(o,canException).map(c=>`<option value="${c}">${CHOICE_LABEL[c]}</option>`).join('')}</select>`;
const boxCard=(o,canException)=>`<section class="card"><h3>Envío #${o.n} · ${esc(o.club.name)}</h3><p>Fecha original: <b>${esc(exactDate(o.due))}</b></p><div class="chips">${paymentBadge(o.f,{state:'overdue'})}${o.status==='held'?chip('En resguardo','wine'):''}</div>
  ${o.bottles?`<details class="more"><summary>Ver botellas ▾</summary>${bottleList(o.bottles)}</details>`:'<p class="small">Falta definir la caja. Se revisará antes de entregar.</p>'}
  ${choiceSelect(o,canException)}
  <label for="note-${o.subId}-${o.k}">Motivo (obligatorio para omitir${canException?' o autorizar excepción':''})</label><input id="note-${o.subId}-${o.k}" name="note_${o.subId}_${o.k}" maxlength="500">
  ${!paid(o)?'<p class="small muted">Sin pago asociado no significa necesariamente impago. Una excepción no marca la caja como pagada. Al asociarse un pago de Stripe, el bloqueo de esta caja se levanta.</p>':''}</section>`;

// The first box of the new stage (the Stripe subscription that proves the return).
function nextBox(ctx,ev,rows) {
  const sub=ctx.subs.find(s=>s.id===ev.subId);
  if(!sub||!subClub(ctx,sub))return {sub,o:null};
  const o=rows.find(x=>x.subId===sub.id);
  if(o)return {sub,o,inPlan:true};
  return {sub,o:(subOccurrences(ctx,{...sub,suspended_on:null},addDays(ctx.today,400))||[]).find(x=>!['done','skipped','pretracking'].includes(x.state))||null,inPlan:false};
}

export async function reactivationPage({env,user,member,ctx,ev=null,error=null,status=200}) {
  const rows=reactivationPlan(ctx),token=await digest(ctx,member,rows,ev);
  const render=args=>{const response=page(args);return new Response(response.body,{status,headers:response.headers});};
  if(ev)return render({env,user,tab:'socios',title:'Regreso al club',body:returnBody({user,member,ctx,ev,rows,token,error})});
  const future=ctx.subs.map(s=>({s,next:(subOccurrences(ctx,{...s,suspended_on:null},addDays(ctx.today,400))||[]).find(o=>o.due>ctx.today&&o.state!=='done')}));
  return render({env,user,tab:'socios',title:'Revisar reactivación',body:`<p><a href="/socio/${member.id}#membresia">← Socio</a></p><h1>Reactivar · ${esc(member.name)}</h1>
    <p>Revisa cada caja antes de quitar la suspensión. No se registra ninguna entrega ni se cobra al cliente desde esta pantalla.</p>
    ${error?`<div class="banner red">${esc(error)}</div>`:''}
    <form method="post" action="/socio/${member.id}/reactivar"><input type="hidden" name="review" value="${token}"><input type="hidden" name="version" value="${member.membership_version}">
    <h2>1. Envíos pendientes (${rows.length})</h2>
    ${rows.map(o=>boxCard(o,true)).join('')||'<div class="card">No hay cajas pendientes que revisar.</div>'}
    <h2>2. Calendario y cobro</h2><p>Se conservan las fechas originales y el número de cada envío. Una entrega tardía no mueve los siguientes envíos. Omitir una caja no cancela ni perdona una factura.</p>
    ${future.map(({s,next})=>`<div class="card small"><b>${esc(subClub(ctx,s)?.name||s.product_name||'Suscripción')}</b><p>Estado de cobro: <b>${esc(s.status)}</b></p><p>Próxima fecha teórica: <b>${next?esc(exactDate(next.due)):'Sin fecha futura en la suscripción actual'}</b></p>${s.stripe_subscription_id&&user.isManager?`<a href="https://dashboard.stripe.com/subscriptions/${encodeURIComponent(s.stripe_subscription_id)}" target="_blank" rel="noopener">Abrir en Stripe</a>`:''}${['canceled','manual_ended'].includes(s.status)?'<p class="warn">La suscripción terminó. Reactivar aquí no restablece el cobro ni genera un nuevo calendario. Resuelve la continuidad de la suscripción por separado; las cajas antiguas permanecen en su historial.</p>':''}</div>`).join('')}
    <label style="display:flex;gap:10px;align-items:start"><input type="checkbox" name="billing_reviewed" value="1" required style="width:24px;min-height:24px;flex:none">Revisé el estado de cobro y entiendo que esta acción no modifica Stripe.</label>
    <label for="resume-reason">Motivo de reactivación</label><textarea id="resume-reason" name="reason" required maxlength="500"></textarea><button class="btn" style="margin-top:16px">Confirmar reactivación y decisiones</button></form>`});
}

// One screen: Stripe proves the return; staff only confirm the restart date and the next box.
function returnBody({user,member,ctx,ev,rows,token,error}) {
  const nb=nextBox(ctx,ev,rows),others=rows.filter(o=>o!==nb.o),club=nb.sub&&subClub(ctx,nb.sub);
  const anchor=nb.sub?(nb.sub.anchor_override||nb.sub.start_date):ev.start;
  return `<p><a href="/socio/${member.id}">← Socio</a></p><h1>Regreso · ${esc(member.name)}</h1>
    <div class="banner green" role="status"><div><b>Volvió a suscribirse el ${esc(exactDate(ev.start))} · pagado en Stripe</b>${ev.verdict?`<p class="small" style="margin:4px 0 0">${esc(ev.verdict)}</p>`:''}</div></div>
    ${ev.dup?`<p class="small">El registro <a href="/socio/${ev.dup.id}">#${ev.dup.id} ${esc(ev.dup.name.trim())}</a> es este mismo socio. Al confirmar, su suscripción y entregas pasan a esta ficha y ese registro se oculta.</p>`:''}
    ${error?`<div class="banner red">${esc(error)}</div>`:''}
    <form method="post" action="/socio/${member.id}/reactivar" class="return-form"><input type="hidden" name="review" value="${token}"><input type="hidden" name="version" value="${member.membership_version}">
    <input type="hidden" name="mode" value="stripe"><input type="hidden" name="evidence" value="${esc(ev.stripeId)}"><input type="hidden" name="orig_due" value="${esc(nb.o?.due||'')}">
    <section class="card"><h2 style="margin:0">${esc(club?.name||'Nueva etapa')}</h2>
      <label for="restart">Fecha de reinicio · envío #1</label><input id="restart" type="date" name="restart" value="${esc(anchor)}" required>
      <p class="small muted" style="margin:4px 0 0">En Stripe empezó el ${esc(exactDate(ev.start))}. Las siguientes cajas se calculan desde esta fecha.</p></section>
    ${nb.o?`<section class="card"><h2 style="margin:0">Próxima caja · Envío #${nb.o.n}</h2><div class="chips">${paymentBadge(nb.o.f,{state:'overdue'})}</div>
      ${nb.o.bottles?`<details class="more"><summary>Ver botellas ▾</summary>${bottleList(nb.o.bottles)}</details>`:'<p class="small">Falta definir la caja. Se revisará antes de entregar.</p>'}
      <label for="deliver">Fecha de entrega</label><input id="deliver" type="date" name="deliver_on" value="${esc(nb.o.f?.delayed_until||nb.o.due)}">
      ${nb.inPlan?choiceSelect(nb.o,user.isManager,'Qué hacer'):''}</section>`
      :`<div class="card small">${club?'No hay cajas pendientes en la nueva etapa.':'Esta suscripción no tiene club asignado. Un administrador lo asigna en Conciliar; mientras, no se calculan sus cajas.'}</div>`}
    ${others.length?`<details class="more"><summary>Otras cajas pendientes (${others.length}) · se quedan como están</summary>${others.map(o=>boxCard(o,user.isManager)).join('')}</details>`:''}
    <button class="btn" style="margin-top:12px">Reactivar y programar envíos</button>
    <p class="small muted">No cobra ni cambia nada en Stripe. Queda registrado a tu nombre.</p></form>
    <script>(()=>{const r=document.getElementById('restart'),d=document.getElementById('deliver');if(!r||!d)return;let prev=r.value,touched=false;d.addEventListener('input',()=>touched=true);
      r.addEventListener('change',()=>{if(!touched&&prev&&r.value&&d.value){const t=new Date(d.value+'T12:00Z');t.setUTCDate(t.getUTCDate()+Math.round((Date.parse(r.value)-Date.parse(prev))/864e5));d.value=t.toISOString().slice(0,10);}prev=r.value;});})()</script>`;
}

// ev: live Stripe evidence re-checked by the caller on this very request (null = manager's manual review).
export async function reactivate(env,user,member,fm,ev=null) {
  const ctx=await planContext(env,member,ev),rows=reactivationPlan(ctx),dup=ev?.dup||null;
  const fail=(message,status=400)=>reactivationPage({env,user,member,ctx,ev,error:message,status});
  if(!ev&&!member.suspended_on)return fail('Este socio ya no está suspendido.',409);
  if(Number(fm.version)!==member.membership_version||fm.review!==await digest(ctx,member,rows,ev))return fail('La información cambió. Revisa de nuevo las decisiones antes de confirmar.',409);
  let reason;
  if(ev)reason=`Volvió a suscribirse en Stripe el ${ev.start} · pago del ${ev.paidOn} verificado en Stripe`;
  else {
    reason=String(fm.reason||'').trim().slice(0,500);
    if(!reason||fm.billing_reviewed!=='1')return fail('Indica el motivo y confirma que revisaste el cobro.');
  }
  const decisions=[];
  for(const o of rows) {
    const choice=fm[`choice_${o.subId}_${o.k}`],note=String(fm[`note_${o.subId}_${o.k}`]||'').trim().slice(0,500);
    if(!choicesFor(o,user.isManager).includes(choice))return fail(`Elige qué hacer con el envío #${o.n}.`);
    if(['skip','exception'].includes(choice)&&!note)return fail(`Indica el motivo de la decisión para el envío #${o.n}.`);
    decisions.push({o,choice,note});
  }
  // The new stage: restart date (shipment #1) and the date of the next box.
  let anchorChange=null,delay=null,restart=null;
  if(ev) {
    const nb=nextBox(ctx,ev,rows),club=nb.sub&&subClub(ctx,nb.sub);
    restart=String(fm.restart||'').trim();
    if(!isDate(restart))return fail('Indica la fecha de reinicio.');
    if(Math.abs(daysBetween(ev.start,restart))>92)return fail('La fecha de reinicio debe quedar a menos de 3 meses del inicio en Stripe.');
    const cur=nb.sub?(nb.sub.anchor_override||nb.sub.start_date):ev.start;
    if(nb.sub&&restart!==cur)anchorChange={sub:nb.sub,before:nb.sub.anchor_override,after:restart===nb.sub.start_date?null:restart,club};
    if(nb.o&&club) {
      const due=dueDate(restart,club.cadence_months,nb.o.k),want=String(fm.deliver_on||'').trim();
      if(want&&want!==fm.orig_due&&want!==due&&want!==nb.o.f?.delayed_until) {
        if(!isDate(want))return fail('Indica una fecha de entrega válida.');
        if(want<due)return fail('La entrega no puede ser antes de su fecha. Para adelantarla cambia la fecha de reinicio.');
        delay={o:nb.o,fields:{delayed_until:want,delay_reason:'Fecha acordada al regresar al club'}};
      }
    }
  } else restart=null;
  const ids=JSON.stringify([member.id,...(dup?[dup.id]:[])]);
  const fuls=[...ctx.fulByKey.values()].flatMap(fs=>[...fs.values()]);
  const subs=ctx.subs.map(s=>({id:s.id,synced_at:s.synced_at,anchor:s.anchor_override,start:s.start_date,status:s.status,ended:s.ended_on}));
  const token=crypto.randomUUID();
  // The CHECK is a transaction guard. If any member, shipment, payment or subscription changed after review,
  // the whole D1 batch rolls back: reactivation, absorbed duplicate, date changes and all decisions.
  const batch=[env.DB.prepare(`INSERT INTO membership_review_commits(token,checked) SELECT ?,
    (EXISTS(SELECT 1 FROM members WHERE id=? AND membership_version=? AND merged_into IS NULL AND ${ev?'1':'suspended_on IS NOT NULL'})
    AND ${dup?'EXISTS(SELECT 1 FROM members WHERE id=? AND membership_version=? AND merged_into IS NULL)':'?=?'}
    AND (SELECT COUNT(*) FROM fulfillments f JOIN subscriptions s ON s.id=f.subscription_id WHERE s.member_id IN (SELECT value FROM json_each(?)))=?
    AND NOT EXISTS(SELECT 1 FROM json_each(?) j LEFT JOIN fulfillments f ON f.subscription_id=json_extract(j.value,'$.subscription_id') AND f.k=json_extract(j.value,'$.k') WHERE f.id IS NULL OR f.version IS NOT json_extract(j.value,'$.version') OR f.stripe_invoice_id IS NOT json_extract(j.value,'$.stripe_invoice_id') OR f.paid_on IS NOT json_extract(j.value,'$.paid_on'))
    AND (SELECT COUNT(*) FROM subscriptions WHERE member_id IN (SELECT value FROM json_each(?)))=?
    AND NOT EXISTS(SELECT 1 FROM json_each(?) j LEFT JOIN subscriptions s ON s.id=json_extract(j.value,'$.id') WHERE s.id IS NULL OR s.synced_at IS NOT json_extract(j.value,'$.synced_at') OR s.anchor_override IS NOT json_extract(j.value,'$.anchor') OR s.start_date IS NOT json_extract(j.value,'$.start') OR s.status IS NOT json_extract(j.value,'$.status') OR s.ended_on IS NOT json_extract(j.value,'$.ended')))`)
    .bind(token,member.id,member.membership_version,dup?dup.id:0,dup?dup.membership_version:0,ids,fuls.length,JSON.stringify(fuls),ids,subs.length,JSON.stringify(subs))];
  if(dup) {
    // Absorb the duplicate record: its subscriptions (and their fulfillments), benefit uses and Stripe customer
    // move here; the record stays, hidden, pointing at this member.
    const moved=ctx.subs.filter(s=>s.member_id===dup.id).map(s=>s.id);
    batch.push(env.DB.prepare('UPDATE subscriptions SET member_id=? WHERE member_id=?').bind(member.id,dup.id),
      env.DB.prepare('UPDATE benefit_uses SET member_id=? WHERE member_id=?').bind(member.id,dup.id),
      env.DB.prepare('UPDATE member_customers SET member_id=? WHERE member_id=?').bind(member.id,dup.id),
      env.DB.prepare(`INSERT INTO member_customers(stripe_customer_id,member_id,matched_by,created_by) SELECT stripe_customer_id,?,'merge',? FROM members WHERE id=? AND stripe_customer_id IS NOT NULL
        ON CONFLICT(stripe_customer_id) DO UPDATE SET member_id=excluded.member_id`).bind(member.id,user.email,dup.id),
      env.DB.prepare(`UPDATE members SET merged_into=?,membership_version=membership_version+1,updated_at=datetime('now') WHERE id=?`).bind(member.id,dup.id),
      env.DB.prepare(`INSERT INTO audit_log(who,action,entity,entity_id,before_json,after_json,note) VALUES (?,'unir registro duplicado','member',?,?,?,?)`).bind(user.email,String(member.id),
        JSON.stringify({id:dup.id,name:dup.name,email:dup.email,stripe_customer_id:dup.stripe_customer_id,subscriptions:moved}),JSON.stringify({merged_into:member.id,subscriptions:moved}),`#${dup.id} ${dup.name.trim()} es el mismo socio (nuevo cliente de Stripe)`));
  }
  batch.push(env.DB.prepare(`UPDATE members SET suspended_on=NULL,suspension_reason=NULL,suspension_by=NULL,payment_followup_on=NULL,payment_followup_reason=NULL,payment_followup_by=NULL,membership_version=membership_version+1,updated_at=datetime('now') WHERE id=?`).bind(member.id));
  if(anchorChange)batch.push(env.DB.prepare('UPDATE subscriptions SET anchor_override=? WHERE id=?').bind(anchorChange.after,anchorChange.sub.id),
    env.DB.prepare(`INSERT INTO audit_log(who,action,entity,entity_id,before_json,after_json,note) VALUES (?,'corrección de suscripción','subscription',?,?,?,?)`).bind(user.email,String(anchorChange.sub.id),JSON.stringify({anchor_override:anchorChange.before}),JSON.stringify({anchor_override:anchorChange.after}),'Fecha de reinicio al regresar al club'));
  const expected=o=>anchorChange&&o.subId===anchorChange.sub.id&&anchorChange.club?dueDate(restart,anchorChange.club.cadence_months,o.k):o.due;
  const write=(o,fields,action,note)=>{
    const f=o.f||{},cols=Object.keys(fields);
    if(f.id)batch.push(env.DB.prepare(`UPDATE fulfillments SET ${cols.map(c=>c+'=?').join(',')},version=version+1,last_change=?,updated_by=?,updated_at=datetime('now') WHERE id=?`).bind(...Object.values(fields),token,user.email,f.id));
    else batch.push(env.DB.prepare(`INSERT INTO fulfillments(subscription_id,k,expected_date,${cols.join(',')},version,last_change,updated_by) VALUES (?,?,?,${cols.map(()=>'?').join(',')},1,?,?)`).bind(o.subId,o.k,expected(o),...Object.values(fields),token,user.email));
    batch.push(env.DB.prepare(`INSERT INTO audit_log(who,action,entity,entity_id,before_json,after_json,note) VALUES (?,?,'fulfillment',?,?,?,?)`).bind(user.email,action,`${o.subId}:${o.k}`,JSON.stringify(f),JSON.stringify({...f,...fields}),note));
  };
  for(const {o,choice,note} of decisions) {
    const f=o.f||{},extra=delay?.o===o?delay.fields:{};
    const fields=choice==='keep'?{...extra}:choice==='skip'?{status:'skipped',note:[f.note,note].filter(Boolean).join(' · '),payment_blocked:0,payment_release_reason:null}:
      choice==='prepare'?{status:'needs_prep',payment_blocked:0,payment_release_reason:null,...(!f.bottles_json&&o.bottles?{bottles_json:JSON.stringify(o.bottles)}:{}),...extra}:
      {payment_blocked:1,payment_release_reason:choice==='exception'?note:null,...extra};
    if(Object.keys(fields).length)write(o,fields,'reactivación: '+choice,note||reason);
  }
  if(delay&&!decisions.some(d=>d.o===delay.o))write(delay.o,delay.fields,'regreso: fecha de entrega',reason);
  const evidence=ev?{mode:'stripe',stripe_subscription_id:ev.stripeId,stripe_customer_id:ev.customer,start:ev.start,invoice:ev.invoice,paid_on:ev.paidOn,amount:ev.amount,restart,absorbed:dup?.id||null,by_role:user.isManager?'manager':'staff'}:{billing_reviewed:true};
  batch.push(env.DB.prepare(`INSERT INTO audit_log(who,action,entity,entity_id,before_json,after_json,note) VALUES (?,?,'member',?,?,?,?)`).bind(user.email,member.suspended_on||!ev?'reactivar membresía':'regreso al club',String(member.id),JSON.stringify({suspended_on:member.suspended_on,suspension_reason:member.suspension_reason}),JSON.stringify({suspended_on:null,decisions:decisions.map(({o,choice,note})=>({sub:o.subId,k:o.k,choice,note})),...evidence}),reason));
  try{await env.DB.batch(batch);}catch(e){if(String(e.message).includes('CHECK constraint'))return fail('La información cambió mientras guardabas. No se aplicó ningún cambio; revisa de nuevo.',409);throw e;}
  return new Response(null,{status:303,headers:{location:ev?`/socio/${member.id}?regreso=${restart}#calendario`:`/socio/${member.id}?reactivado=1#calendario`}});
}
