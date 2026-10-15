import test from 'node:test';
import assert from 'node:assert/strict';
import {billingIssue,billingIssues,billingWarning,billingPage} from '../src/billing.js';
const sub={id:1,member_id:1,member_name:'Socio Prueba',stripe_subscription_id:'sub_test',status:'past_due',product_club_id:1};
const ctx=(s=sub)=>({today:'2026-10-15',subs:[s],pausesBySub:new Map(),clubs:new Map([[1,{name:'Fundadores'}]]),settings:{last_sync:JSON.stringify({at:'2026-10-15T12:00:00Z',ok:true})}});
test('billing alerts distinguish payment states and clear when status recovers',()=>{
  for(const status of ['past_due','unpaid','incomplete','paused'])assert.ok(billingIssue(ctx(),{...sub,status}));
  assert.equal(billingIssue(ctx(),{...sub,status:'active'}),null);
  assert.equal(billingIssue(ctx(),{...sub,status:'canceled'}),null,'cancellation alone is not proof of failed payment');
});
test('ignored and manual subscriptions do not create Stripe billing alerts',()=>{
  assert.equal(billingIssue(ctx(),{...sub,product_relevance:'ignore',product_club_id:null}),null);
  assert.equal(billingIssue(ctx(),{...sub,stripe_subscription_id:null}),null);
  assert.equal(billingIssue(ctx(),{...sub,status:'incomplete_expired'}),null);
});
test('collection pauses are visible only while the Stripe pause is effective',()=>{
  const c=ctx({...sub,status:'active'});c.pausesBySub.set(1,[{source:'stripe',from_date:'2026-10-01',until_date:'2026-11-01'}]);
  assert.equal(billingIssues(c)[0].title,'Cobro pausado en Stripe');
  c.today='2026-11-01';assert.equal(billingIssues(c).length,0);
});
test('a paid box retains its payment evidence when the subscription has a billing warning',()=>{
  assert.match(billingWarning(ctx(),sub,{paid:true}),/Esta caja tiene un pago asociado/);
  assert.match(billingWarning(ctx(),sub),/no identifica por sí solo qué caja está pagada/);
});
test('billing page discloses freshness and routes to the member and Stripe',async()=>{
  const html=await billingPage({ctx:ctx(),env:{},user:{isManager:false}}).text();
  assert.match(html,/Socio Prueba/);assert.match(html,/href="\/socio\/1"/);assert.match(html,/dashboard.stripe.com\/subscriptions\/sub_test/);
  assert.match(html,/no es una comprobación en tiempo real/);assert.match(html,/no el motivo exacto/);
  assert.doesNotMatch(html,/Sincronizar Stripe en Ajustes/);
});
