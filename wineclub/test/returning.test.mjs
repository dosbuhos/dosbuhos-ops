import test from 'node:test';
import assert from 'node:assert/strict';
import { normName, pickReturning } from '../src/stripe.js';
import { interpret, returnEvidence } from '../src/returning.js';

test('names normalize case, accents, inner and trailing spaces', () => {
  assert.equal(normName('Joel del Real Tapia '), normName('Joel Del Real Tapia'));
  assert.equal(normName('  JOSÉ   Ñúñez'), 'jose nunez');
});

test('a new Stripe customer is recognized by email or by a unique name, never by an ambiguous one', () => {
  const joel = { id: 14, name: 'Joel Del Real Tapia', email: 'joel@example.com', returning: true };
  const other = { id: 3, name: 'Ana Pérez', email: 'ana@example.com', returning: false };
  assert.equal(pickReturning({ name: 'Joel del Real Tapia ', email: null }, [joel, other]).member.id, 14);
  assert.equal(pickReturning({ name: 'J. Real', email: 'JOEL@example.com' }, [joel, other]).by, 'email');
  assert.equal(pickReturning({ name: 'Ana Perez', email: 'otra@example.com' }, [joel, other]), null, 'name-only with a different email needs a returning member');
  assert.equal(pickReturning({ name: 'Ana Perez', email: null }, [joel, other]).member.id, 3);
  assert.equal(pickReturning({ name: 'Ana Pérez', email: null }, [other, { ...other, id: 9 }]), null, 'two people with the same name');
  assert.equal(pickReturning({ name: 'Nadie', email: 'nadie@example.com' }, [joel, other]), null);
});

const live = {
  source: 'live',
  subs: [
    { id: 'sub_old', customer: 'cus_old', status: 'canceled', start: '2026-01-05', canceledOn: '2026-07-04', endedOn: '2026-10-25', product: 'p' },
    { id: 'sub_new', customer: 'cus_new', status: 'active', start: '2026-10-21', product: 'p' },
  ],
  invoices: [
    { id: 'in_new', status: 'paid', sub: 'sub_new', on: '2026-10-21', amount: 317000, currency: 'mxn' },
    { id: 'in_fail', status: 'open', attempted: true, sub: 'sub_old', on: '2026-09-03', amount: 317000, currency: 'mxn' },
  ],
};

test('Stripe history reads as one verdict and a newest-first timeline', () => {
  const { verdict, events } = interpret(live, () => 'Círculo Plata');
  assert.equal(verdict.t, 'Al corriente · último pago 21 oct 2026 · $3,170');
  assert.deepEqual(events.map(e => [e.d, e.t]), [
    ['2026-10-25', 'Suscripción anterior cancelada'],
    ['2026-10-21', 'Se suscribió de nuevo (Círculo Plata)'],
    ['2026-10-21', 'Pagó $3,170'],
    ['2026-09-03', 'Pago falló'],
    ['2026-07-04', 'Pidió cancelar · termina el 25 oct 2026'],
    ['2026-01-05', 'Se suscribió (Círculo Plata)'],
  ]);
  const failed = interpret({ ...live, subs: [{ ...live.subs[1], status: 'past_due' }], invoices: [{ id: 'x', status: 'open', attempted: true, sub: 'sub_new', on: '2026-10-03', amount: 1 }] }, () => null);
  assert.equal(failed.verdict.t, 'Pago fallido el 3 oct 2026');
});

test('return evidence needs a suspended or ended member and an active, paid subscription that started after', () => {
  const own = [{ status: 'canceled', start_date: '2026-01-05', ended_on: '2026-10-25' }];
  const suspended = { id: 14, suspended_on: '2026-10-15' };
  const ev = returnEvidence({ member: suspended, ownSubs: own, live, today: '2026-11-01' });
  assert.equal(ev.stripeId, 'sub_new'); assert.equal(ev.start, '2026-10-21'); assert.equal(ev.paidOn, '2026-10-21');
  assert.equal(returnEvidence({ member: { ...suspended, suspended_on: '2026-10-22' }, ownSubs: own, live, today: '2026-11-01' }), null, 'started before the suspension');
  assert.equal(returnEvidence({ member: suspended, ownSubs: own, live: { ...live, invoices: [] }, today: '2026-11-01' }), null, 'not paid');
  assert.equal(returnEvidence({ member: suspended, ownSubs: own, live: { ...live, source: 'sync' }, today: '2026-11-01' }), null, 'synced data is not proof');
  assert.equal(returnEvidence({ member: { id: 14 }, ownSubs: [{ status: 'active', start_date: '2026-01-05' }], live, today: '2026-11-01' }), null, 'still active: nothing to return from');
  assert.equal(returnEvidence({ member: { id: 14 }, ownSubs: own, live, today: '2026-11-01' }).stripeId, 'sub_new', 'ended, not suspended');
});
