import test from 'node:test';
import assert from 'node:assert/strict';
import { joinedDate, dateFacts, scheduleRow } from '../src/visibility.js';
import { memberPage, reviewPage, membersPage } from '../src/pages.js';
import { subOccurrences } from '../src/data.js';

function fixture() {
  const club={id:5,name:'Círculo Diamante',bottles:12,cadence_months:1,allocation_mode:'month'};
  const s={id:7,member_id:7,member_name:'Valeria',member_email:'v@example.com',member_legacy_id:'3',stripe_subscription_id:'sub_A',product_club_id:5,status:'active',start_date:'2026-08-06',anchor_override:'2026-08-15',seq_offset:0};
  const f={k:1,status:'handed',done_on:'2026-08-18',expected_date:'2026-08-06',handled_by:'Staff',method:'pickup',bottles_json:'[{"wine":"Vino","qty":12}]'};
  return {today:'2026-10-14',subs:[s],clubs:new Map([[5,club]]),cases:new Map(),fulByKey:new Map([[7,new Map([[1,f]])]]),pausesBySub:new Map(),settings:{},trackingStart:'2026-01-01',legacyMembers:new Map([['3',{legacy_id:'3',next_shipment_number:2}]])};
}

test('enrollment date never becomes the adjusted shipment anchor or import date',()=>{
  const ctx=fixture();
  assert.equal(joinedDate(ctx,7),'2026-08-06');
  ctx.subs.unshift({...ctx.subs[0],id:8,start_date:'2020-01-01',product_club_id:null,product_relevance:'ignore'});
  assert.equal(joinedDate(ctx,7),'2026-08-06','irrelevant subscription cannot age the club enrollment');
});

test('theoretical, rescheduled, recorded, and originally stored dates remain distinct',()=>{
  const ctx=fixture(); const o=subOccurrences(ctx,ctx.subs[0],'2026-12-31')[0];
  const html=dateFacts({...o,delayed:true,eff:'2026-08-20'});
  for(const text of ['15 ago 2026','18 ago 2026','20 ago 2026','6 ago 2026']) assert.ok(html.toLowerCase().includes(text));
  assert.match(html,/Fecha prevista por calendario/);assert.match(html,/Fecha real registrada/);
  assert.match(scheduleRow(o),/3 días después/);
});

test('member comparison keeps subsequent theoretical dates anchored after a late delivery',async()=>{
  const ctx=fixture();
  const html=await memberPage({env:{},user:{isManager:false},ctx,member:{id:7,name:'Valeria'},benefits:[],uses:[],url:new URL('http://localhost/socio/7')}).text();
  assert.match(html,/Primera alta del club registrada/);
  assert.match(html,/Calendario esperado y entregas reales/);
  assert.match(html,/15 sep 2026/i);assert.doesNotMatch(html,/18 sep 2026/i);
  assert.match(html,/Sin entrega registrada/);
  assert.ok(html.indexOf('Alta y calendario de envíos')<html.indexOf('Contacto y forma de entrega'));
});

test('review distinguishes recorded pending work from dates without fulfillment evidence',async()=>{
  const ctx=fixture();ctx.subs[0].anchor_override=null;ctx.fulByKey.get(7).set(2,{status:'needs_prep'});
  const html=await reviewPage({env:{},user:{},ctx}).text();
  assert.match(html,/Con trabajo pendiente registrado \(1\)/);
  assert.match(html,/Sin registro: comprobar historial \(1\)/);
  assert.match(html,/El contador no confirma una entrega/);
  assert.match(html,/no confirma/);
});

test('member directory exposes enrollment and searchable contact context',async()=>{
  const ctx=fixture();
  const html=await membersPage({env:{},user:{},ctx,members:[{id:7,name:'Valeria',email:'v@example.com',phone:'5551234'}]}).text();
  assert.match(html,/Alta registrada/);assert.match(html,/6 ago 2026/i);assert.match(html,/5551234/);
});

test('calendar shows the linked Stripe payment date independently of delivery status',()=>{
  const ctx=fixture();const o=subOccurrences(ctx,ctx.subs[0],'2026-12-31')[0];
  const html=scheduleRow({...o,state:'overdue',status:null,f:{stripe_invoice_id:'in_paid',paid_on:'2026-08-06'}});
  assert.match(html,/Pagado · 6 ago 2026/);
  assert.match(html,/Sin entrega registrada/);
  assert.match(html,/15 ago 2026/);
  assert.match(scheduleRow({...o,f:{}}),/Sin pago de Stripe asociado/);
  assert.match(scheduleRow({...o,state:'overdue',f:{}}),/class="chip red"[^>]*>Sin pago de Stripe asociado/);
  assert.match(scheduleRow({...o,state:'upcoming',f:{}}),/class="chip grey"[^>]*>Sin pago de Stripe asociado/);
  assert.doesNotMatch(scheduleRow({...o,f:{paid_on:'2026-08-06'}}),/Pagado ·/);
});

test('benefit history does not infer the server from the recorder on old records',async()=>{
  const ctx=fixture();
  const html=await memberPage({env:{},user:{email:'recorder@example.com'},ctx,member:{id:7,name:'Valeria'},
    benefits:[{id:1,club_id:5,active:1,name:'Kit',unit:'kit',period:'once',quantity:1}],
    uses:[{id:1,benefit_id:1,qty:1,used_on:'2026-08-18',created_by:'old@example.com',created_at:'2026-08-18 12:00:00'}],url:new URL('http://localhost/socio/7?beneficio=1')}).text();
  assert.match(html,/Sin registrar en el historial anterior/);
  assert.match(html,/Registrado por: old@example.com/);
  assert.match(html,/2026-08-18 12:00:00 UTC/);
  assert.match(html,/id="beneficios" open/);
});

test('suspension preserves paid history and theoretical dates, blocks the work queue, and is reversible',async()=>{
  const ctx=fixture(),s=ctx.subs[0];
  const before=subOccurrences(ctx,s,'2026-12-31');
  Object.assign(s,{suspended_on:'2026-10-14',suspension_reason:'Pago bloqueado',suspension_by:'admin@example.com'});
  const after=subOccurrences(ctx,s,'2026-12-31');
  assert.deepEqual(after.map(o=>o.due),before.map(o=>o.due));
  assert.equal(after[0].state,'done');
  assert.ok(after.slice(1).every(o=>o.state==='suspended'));
  assert.match(scheduleRow(after[1]),/Suspendido por falta de pago/);
  const html=await memberPage({env:{},user:{isManager:true},ctx,member:{id:7,name:'Valeria',...s},benefits:[],uses:[],url:new URL('http://localhost/socio/7')}).text();
  assert.match(html,/Reactivar membresía/);assert.match(html,/No modifica los cobros/);
  s.suspended_on=null;
  assert.deepEqual(subOccurrences(ctx,s,'2026-12-31').map(o=>o.state),before.map(o=>o.state));
});
