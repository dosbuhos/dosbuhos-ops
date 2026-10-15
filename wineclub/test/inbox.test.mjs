import test from 'node:test';
import assert from 'node:assert/strict';
import {inboxReason} from '../src/visibility.js';
const today='2026-10-15';
test('Inbox includes unassigned work due now or within seven days',()=>{
  for(const eff of ['2026-08-01','2026-10-15','2026-10-22'])assert.equal(inboxReason({state:eff<today?'overdue':'upcoming',eff,status:null},today),'Sin clasificar');
  assert.equal(inboxReason({state:'upcoming',eff:'2026-10-23',status:null},today),null);
});
test('assigned preparation, ready and completed shipments are outside the Inbox',()=>{
  for(const status of ['needs_prep','ready'])assert.equal(inboxReason({state:'overdue',eff:'2026-10-01',status},today),null);
  for(const state of ['done','skipped','paused','pretracking'])assert.equal(inboxReason({state,eff:'2026-10-01'},today),null);
});
test('holds and postponements return only when action is due; exceptions remain actionable',()=>{
  assert.equal(inboxReason({state:'held',holdReleaseDue:false},today),null);
  assert.equal(inboxReason({state:'held',holdReleaseDue:true},today),'Fecha de resguardo cumplida');
  assert.equal(inboxReason({state:'upcoming',status:null,delayed:true,eff:'2026-10-16'},today),null);
  assert.equal(inboxReason({state:'today',status:null,delayed:true,eff:today},today),'Sin clasificar');
  assert.equal(inboxReason({state:'exception',status:'exception'},today),'Excepción por resolver');
});
