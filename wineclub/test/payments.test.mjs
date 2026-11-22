import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOpenTableDate, sourceOf, trimCharge, listCharges, listRefundedCharges } from '../src/payments.js';

// Fictional charges shaped like the real ones. The personal fields are here on purpose: the tests prove they do not leave.
const openTable = {
  id: 'ch_ot1', created: 1795374050, currency: 'mxn', amount: 90000, amount_captured: 90000, amount_refunded: 0, status: 'succeeded', captured: true, disputed: false,
  customer: null, application: 'ca_FICTIONALAPP', description: 'OpenTable Experience: Persona Inventada, RID# 1258120, Reservation date 16:00 2026-Nov-22',
  billing_details: { name: 'Persona Inventada', email: 'persona@example.com', address: { postal_code: '77531' } }, receipt_email: 'persona@example.com',
  payment_method_details: { card: { country: 'US', last4: '4242', brand: 'visa' } },
  metadata: { 'OpenTable Experience Id': '842882', 'OpenTable Guest Email': 'persona@example.com', 'OpenTable Guest Name': 'Persona Inventada', 'OpenTable Platform': 'Diner App', 'OpenTable RID': '1258120', 'OpenTable Reservation Date': '16:00 2026-Nov-22', 'OpenTable Transaction Type': 'experiences', order_id: '01FICTIONAL' },
};
const rezdy = { id: 'ch_rz1', created: 1793000000, currency: 'mxn', amount: 140000, amount_captured: 140000, amount_refunded: 70000, status: 'succeeded', captured: true, description: 'Rezdy order RAB12CD for Otra Persona', metadata: {}, payment_method_details: { card: { country: 'MX' } } };
const club = { id: 'ch_wc1', created: 1793100000, currency: 'mxn', amount: 360000, amount_captured: 360000, amount_refunded: 0, status: 'succeeded', captured: true, customer: 'cus_MEMBER', description: 'Subscription update', metadata: {} };
const shop = { id: 'ch_ws1', created: 1793200000, currency: 'mxn', amount: 185000, amount_captured: 185000, amount_refunded: 0, status: 'succeeded', captured: true, customer: 'cus_MEMBER', description: 'Dos Búhos - Order 4312', metadata: { order_id: '4312', site_url: 'https://example.com', customer_email: 'x@example.com', customer_name: 'Alguien Más' } };
const manual = { id: 'ch_ot2', created: 1793300000, currency: 'usd', amount: 50000, amount_captured: 0, amount_refunded: 0, status: 'failed', captured: false, description: 'Boda de Alguien Con Nombre', metadata: { note: 'llamar a Alguien' } };
const members = new Set(['cus_MEMBER']);

test('OpenTable reservation dates are read as restaurant-local day and time, or not at all', () => {
  assert.deepEqual(parseOpenTableDate('16:00 2026-Nov-22'), { date: '2026-11-22', time: '16:00' });
  assert.deepEqual(parseOpenTableDate('9:30 2027-Jan-3'), { date: '2027-01-03', time: '09:30' });
  for (const bad of ['', null, '2026-11-22', '25:00 2026-Nov-22', '12:00 2026-Nov-31', '12:00 2026-Xyz-01', 'Persona 12:00 2026-Nov-22']) assert.equal(parseOpenTableDate(bad), null, String(bad));
});

test('each charge is attributed from platform-set fields only', () => {
  assert.equal(sourceOf(openTable, members), 'opentable');
  assert.equal(sourceOf(rezdy, members), 'rezdy');
  assert.equal(sourceOf(club, members), 'wine_club');
  assert.equal(sourceOf(shop, members), 'web_store', 'a member buying in the shop is a shop sale, not a club payment');
  assert.equal(sourceOf(manual, members), 'other');
  assert.equal(sourceOf({ ...club, customer: 'cus_SOMEONE_ELSE' }, members), 'other', 'a subscription of a non-member is not counted as club');
});

test('a trimmed OpenTable charge keeps the experience, the platform and the reservation day', () => {
  const t = trimCharge(openTable, members);
  assert.deepEqual(t, {
    id: 'ch_ot1', created: 1795374050, currency: 'MXN', amount: 90000, amountCaptured: 90000, amountRefunded: 0, status: 'succeeded', captured: true, disputed: false,
    source: 'opentable', kind: 'experiences', experienceId: '842882', platform: 'Diner App', serviceDate: '2026-11-22', serviceTime: '16:00', bookingRef: '', cardCountry: 'US', application: 'ca_FICTIONALAPP',
  });
});

test('nothing personal leaves: no names, emails, descriptions, card digits or raw metadata', () => {
  for (const ch of [openTable, rezdy, club, shop, manual]) {
    const out = JSON.stringify(trimCharge(ch, members));
    for (const secret of ['Persona', 'Inventada', 'Otra', 'Alguien', 'example.com', '4242', '77531', 'Boda', 'llamar', 'cus_MEMBER', '01FICTIONAL', 'Subscription', 'Order 4312']) assert.ok(!out.includes(secret), `${ch.id} leaked ${secret}`);
  }
  assert.equal(trimCharge(rezdy, members).bookingRef, 'RAB12CD');
  assert.equal(trimCharge(rezdy, members).amountRefunded, 70000);
  const m = trimCharge(manual, members);
  assert.equal(m.source, 'other'); assert.equal(m.status, 'failed'); assert.equal(m.amountCaptured, 0); assert.equal(m.currency, 'USD');
});

test('labels that do not look like platform labels are dropped, not passed through', () => {
  const odd = trimCharge({ ...openTable, metadata: { ...openTable.metadata, 'OpenTable Platform': 'Persona Inventada <persona@example.com>', 'OpenTable Experience Id': '84x', 'OpenTable Reservation Date': 'mañana', 'OpenTable Transaction Type': 'x'.repeat(60) }, application: { id: 'not an app id' }, payment_method_details: { card: { country: 'usa' } } }, members);
  assert.equal(odd.platform, ''); assert.equal(odd.experienceId, ''); assert.equal(odd.serviceDate, ''); assert.equal(odd.kind, ''); assert.equal(odd.application, ''); assert.equal(odd.cardCountry, '');
});

// A fake Stripe and database: listCharges asks for one page and trims it.
function fakeEnv(pages) {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { calls.push({ url: String(url), auth: init.headers.Authorization }); return new Response(JSON.stringify(pages.shift()), { status: 200 }); };
  const env = { STRIPE_SECRET_KEY: 'sk_test_local_mock', STRIPE_API_BASE: 'http://stripe.test', DB: { prepare: () => ({ all: async () => ({ results: [{ c: 'cus_MEMBER' }] }) }) } };
  return { env, calls, restore: () => { globalThis.fetch = realFetch; } };
}

test('listCharges asks Stripe for one page in the window and returns only trimmed rows', async () => {
  const f = fakeEnv([{ data: [openTable, club], has_more: true }]);
  try {
    const r = await listCharges(f.env, { createdGte: 1795000000.7, createdLt: 1796000000, startingAfter: 'ch_prev', limit: 500 });
    assert.equal(r.rows.length, 2); assert.equal(r.hasMore, true); assert.equal(r.last, 'ch_wc1');
    assert.equal(r.rows[1].source, 'wine_club');
    const u = new URL(f.calls[0].url);
    assert.equal(u.pathname, '/v1/charges');
    assert.equal(u.searchParams.get('limit'), '100', 'never more than Stripe allows');
    assert.equal(u.searchParams.get('created[gte]'), '1795000000'); assert.equal(u.searchParams.get('created[lt]'), '1796000000'); assert.equal(u.searchParams.get('starting_after'), 'ch_prev');
  } finally { f.restore(); }
});

test('a cursor that is not a charge id is ignored, and a missing key fails clearly', async () => {
  const f = fakeEnv([{ data: [], has_more: false }]);
  try {
    const r = await listCharges(f.env, { startingAfter: 'ch_1&expand[]=data.customer' });
    assert.deepEqual(r, { rows: [], hasMore: false, last: null });
    assert.equal(new URL(f.calls[0].url).searchParams.get('starting_after'), null);
    await assert.rejects(() => listCharges({ DB: f.env.DB }, {}), /STRIPE_SECRET_KEY/);
  } finally { f.restore(); }
});

test('refunded charges come back whole and trimmed, once each, with the refund to continue after', async () => {
  const refunded = { ...rezdy, amount_refunded: 140000 };
  const f = fakeEnv([{ data: [
    { id: 're_2', charge: refunded, amount: 70000, currency: 'mxn', created: 1793060000, status: 'succeeded', metadata: { who: 'Otra Persona' } },
    { id: 're_1', charge: refunded, amount: 70000, currency: 'mxn', created: 1793050000, status: 'succeeded', reason: 'requested_by_customer' },
    { id: 're_0', charge: null, amount: 100, currency: 'mxn', created: 1793040000, status: 'succeeded' },
  ], has_more: false }]);
  try {
    const r = await listRefundedCharges(f.env, { createdGte: 1793000000 });
    assert.equal(r.rows.length, 1); assert.equal(r.rows[0].id, 'ch_rz1'); assert.equal(r.rows[0].amountRefunded, 140000); assert.equal(r.rows[0].source, 'rezdy');
    assert.equal(r.hasMore, false); assert.equal(r.last, 're_0');
    assert.ok(!JSON.stringify(r).includes('Persona'));
    const u = new URL(f.calls[0].url);
    assert.equal(u.pathname, '/v1/refunds'); assert.equal(u.searchParams.get('expand[]'), 'data.charge'); assert.equal(u.searchParams.get('created[gte]'), '1793000000');
  } finally { f.restore(); }
});
