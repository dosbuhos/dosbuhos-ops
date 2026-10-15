// Stripe is the source of WHO is subscribed, to WHAT, since WHEN. It never decides whether a shipment exists:
// the schedule engine does that from the subscription's start date and the club's cadence. Payments are only
// attached to shipments that already exist in the schedule (never creating duplicates).
//
// Requests pin Stripe-Version so response shapes are known. Webhook payloads use the endpoint's own API version,
// so every field read here tolerates both pre- and post-2025-03-31.basil shapes (e.g. invoice.subscription moved to
// invoice.parent.subscription_details.subscription in basil).

import { localDate, nearestK, dueDate } from './schedule.js';
import { setSetting, clubForSub } from './data.js';

export const STRIPE_VERSION = '2025-03-31.basil';
const base = (env) => env.STRIPE_API_BASE || 'https://api.stripe.com';
export const tzOf = (env) => env.TIMEZONE || 'America/Mexico_City';

async function stripeGet(env, path, params = []) {
  const url = new URL(base(env) + path);
  for (const [k, v] of params) url.searchParams.append(k, v);
  const r = await fetch(url, { headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, 'Stripe-Version': STRIPE_VERSION } });
  let j = null; try { j = await r.json(); } catch { /* non-JSON */ }
  if (!r.ok) throw new Error(`Stripe ${r.status}: ${j?.error?.message || 'error'}`);
  return j;
}

async function listAll(env, path, params = []) {
  const out = []; let after = null;
  for (let page = 0; page < 50; page++) {
    const p = [...params, ['limit', '100']];
    if (after) p.push(['starting_after', after]);
    const j = await stripeGet(env, path, p);
    out.push(...j.data);
    if (!j.has_more || !j.data.length) break;
    after = j.data[j.data.length - 1].id;
  }
  return out;
}

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
export function autoClub(productName, clubs) {
  const name = norm(productName);
  const hits = clubs.filter(c => (c.keywords || '').split(',').map(w => norm(w).trim()).filter(Boolean)
    .some(w => new RegExp(`(^|[^a-z])${w}([^a-z]|$)`).test(name)));
  return hits.length === 1 ? hits[0].id : null; // ambiguous or none → leave for a manager to map
}

function addressOf(c) {
  const a = c?.shipping?.address || c?.address;
  if (!a) return null;
  return [a.line1, a.line2, a.city, a.state, a.postal_code, a.country].filter(Boolean).join(', ') || null;
}

async function ensureProduct(env, productId, name, clubs) {
  const row = await env.DB.prepare('SELECT product_id, name FROM stripe_products WHERE product_id=?').bind(productId).first();
  if (row) {
    if (name && name !== row.name) await env.DB.prepare(`UPDATE stripe_products SET name=?, seen_at=datetime('now') WHERE product_id=?`).bind(name, productId).run();
    return;
  }
  if (!name && env.STRIPE_SECRET_KEY) { try { name = (await stripeGet(env, `/v1/products/${productId}`)).name; } catch { /* keep unnamed */ } }
  clubs = clubs || (await env.DB.prepare('SELECT id, keywords FROM clubs').all()).results;
  const club = autoClub(name, clubs);
  await env.DB.prepare(`INSERT INTO stripe_products (product_id, name, club_id, mapped_by, mapped_at) VALUES (?,?,?,?,CASE WHEN ? IS NULL THEN NULL ELSE datetime('now') END)`)
    .bind(productId, name || null, club, club ? 'auto (nombre)' : null, club).run();
}

async function upsertMember(env, customer, customerId) {
  if (!customer && env.STRIPE_SECRET_KEY) { try { customer = await stripeGet(env, `/v1/customers/${customerId}`); } catch { customer = null; } }
  const c = customer && !customer.deleted ? customer : null;
  const name = c?.name || c?.shipping?.name || c?.email || customerId;
  const existing = await env.DB.prepare('SELECT id FROM members WHERE stripe_customer_id=?').bind(customerId).first();
  if (existing) {
    if (c) await env.DB.prepare(`UPDATE members SET name=?, email=?, phone=?, stripe_address=?, updated_at=datetime('now') WHERE id=?`)
      .bind(name, c.email || null, c.phone || c.shipping?.phone || null, addressOf(c), existing.id).run();
    return existing.id;
  }
  const r = await env.DB.prepare(`INSERT INTO members (stripe_customer_id, name, email, phone, stripe_address) VALUES (?,?,?,?,?) RETURNING id`)
    .bind(customerId, name, c?.email || null, c?.phone || c?.shipping?.phone || null, addressOf(c)).first();
  return r.id;
}

export async function upsertSubscription(env, s, ctx = {}) {
  const tz = tzOf(env);
  const today = localDate(new Date(), tz);
  const customerId = typeof s.customer === 'string' ? s.customer : s.customer?.id;
  const memberId = await upsertMember(env, typeof s.customer === 'object' ? s.customer : null, customerId);
  const items = s.items?.data || [];
  const item = items[0];
  const price = item?.price || item?.plan || {};
  const productId = typeof price.product === 'string' ? price.product : price.product?.id || null;
  if (productId) await ensureProduct(env, productId, ctx.productNames?.get(productId) || (typeof price.product === 'object' ? price.product.name : null), ctx.clubs);
  const recurring = price.recurring || { interval: price.interval, interval_count: price.interval_count };
  const endedAt = s.ended_at || (s.status === 'canceled' ? s.canceled_at : null);
  const vals = {
    member_id: memberId,
    stripe_product_id: productId,
    stripe_price_id: price.id || null,
    price_amount: price.unit_amount ?? price.amount ?? null,
    price_currency: price.currency || null,
    billing_interval: recurring?.interval || null,
    billing_interval_count: recurring?.interval_count || null,
    status: s.status,
    start_date: localDate(s.start_date || s.created, tz),
    ended_on: endedAt ? localDate(endedAt, tz) : null,
    cancel_at: s.cancel_at ? localDate(s.cancel_at, tz) : null,
  };
  const cols = Object.keys(vals);
  const row = await env.DB.prepare(
    `INSERT INTO subscriptions (stripe_subscription_id, ${cols.join(',')}, synced_at) VALUES (?, ${cols.map(() => '?').join(',')}, datetime('now'))
     ON CONFLICT(stripe_subscription_id) DO UPDATE SET ${cols.map(c => `${c}=excluded.${c}`).join(',')}, missing_in_stripe=0, synced_at=datetime('now')
     RETURNING id`).bind(s.id, ...cols.map(c => vals[c])).first();

  // Payment-collection pauses (and Stripe's own 'paused' status) become a pause window.
  const pausedNow = !!s.pause_collection || s.status === 'paused';
  const resumes = s.pause_collection?.resumes_at ? localDate(s.pause_collection.resumes_at, tz) : null;
  const open = await env.DB.prepare(`SELECT id, until_date FROM pauses WHERE subscription_id=? AND source='stripe' AND (until_date IS NULL OR until_date > ?) ORDER BY id DESC LIMIT 1`).bind(row.id, today).first();
  if (pausedNow && !open) await env.DB.prepare(`INSERT INTO pauses (subscription_id, from_date, until_date, source, note, created_by) VALUES (?,?,?,'stripe','Cobro pausado en Stripe','stripe')`).bind(row.id, today, resumes).run();
  else if (pausedNow && open && (open.until_date || null) !== resumes) await env.DB.prepare('UPDATE pauses SET until_date=? WHERE id=?').bind(resumes, open.id).run();
  else if (!pausedNow && open) await env.DB.prepare('UPDATE pauses SET until_date=? WHERE id=?').bind(today, open.id).run();
  return row.id;
}

// Attach a paid invoice to the shipment it pays for. Idempotent: the first invoice recorded for a shipment wins.
export async function applyInvoice(env, inv) {
  const tz = tzOf(env);
  const subStripeId = (typeof inv.subscription === 'string' ? inv.subscription : inv.subscription?.id)
    || inv.parent?.subscription_details?.subscription || null;
  if (!subStripeId) return 'no-subscription';
  const sub = await env.DB.prepare(`SELECT s.*, p.club_id AS product_club_id FROM subscriptions s LEFT JOIN stripe_products p ON p.product_id=s.stripe_product_id WHERE s.stripe_subscription_id=?`).bind(subStripeId).first();
  if (!sub) return 'unknown-subscription';
  const club = await clubForSub(env, sub);
  if (!club) return 'unmapped';
  const line = (inv.lines?.data || []).find(l => l.period?.start) || null;
  const periodStart = line?.period?.start || inv.status_transitions?.paid_at || inv.created;
  const paidAt = inv.status_transitions?.paid_at || inv.created;
  const anchor = sub.anchor_override || sub.start_date;
  const k = nearestK(anchor, club.cadence_months, localDate(periodStart, tz));
  const expected = dueDate(anchor, club.cadence_months, k);
  await env.DB.prepare(
    `INSERT INTO fulfillments (subscription_id, k, expected_date, stripe_invoice_id, paid_on, paid_amount, updated_by) VALUES (?,?,?,?,?,?,'stripe')
     ON CONFLICT(subscription_id, k) DO UPDATE SET
       stripe_invoice_id=COALESCE(fulfillments.stripe_invoice_id, excluded.stripe_invoice_id),
       paid_on=COALESCE(fulfillments.paid_on, excluded.paid_on),
       paid_amount=COALESCE(fulfillments.paid_amount, excluded.paid_amount)`)
    .bind(sub.id, k, expected, inv.id, localDate(paidAt, tz), inv.amount_paid ?? null).run();
  return 'ok';
}

export async function syncStripe(env, who) {
  const started = new Date().toISOString();
  const summary = { at: started, by: who, ok: false };
  try {
    if (!env.STRIPE_SECRET_KEY) throw new Error('Falta la llave de Stripe (secreto STRIPE_SECRET_KEY)');
    const clubs = (await env.DB.prepare('SELECT id, keywords FROM clubs').all()).results;
    const products = await listAll(env, '/v1/products');
    const productNames = new Map(products.map(p => [p.id, p.name]));
    for (const p of products) await ensureProduct(env, p.id, p.name, clubs);

    const subs = await listAll(env, '/v1/subscriptions', [['status', 'all'], ['expand[]', 'data.customer']]);
    const seen = [];
    for (const s of subs) { await upsertSubscription(env, s, { productNames, clubs }); seen.push(s.id); }
    // Subscriptions we know that Stripe no longer returns (deleted in Stripe) are flagged, never silently dropped.
    const known = (await env.DB.prepare('SELECT id, stripe_subscription_id FROM subscriptions WHERE stripe_subscription_id IS NOT NULL').all()).results;
    const seenSet = new Set(seen);
    for (const k of known) if (!seenSet.has(k.stripe_subscription_id)) await env.DB.prepare('UPDATE subscriptions SET missing_in_stripe=1 WHERE id=?').bind(k.id).run();

    const since = Math.floor(Date.now() / 1000) - 450 * 86400;
    const invoices = await listAll(env, '/v1/invoices', [['status', 'paid'], ['created[gte]', String(since)]]);
    let attached = 0;
    for (const inv of invoices) if ((await applyInvoice(env, inv)) === 'ok') attached++;
    Object.assign(summary, { ok: true, products: products.length, subscriptions: subs.length, invoices: invoices.length, attached });
  } catch (e) {
    summary.error = String(e.message || e);
  }
  summary.finished = new Date().toISOString();
  await setSetting(env, 'last_sync', JSON.stringify(summary));
  return summary;
}

// ---------- webhooks ----------
const hex = (buf) => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
export async function verifyStripeSignature(payload, header, secret, toleranceSec = 300) {
  if (!header) return false;
  const parts = header.split(',').map(p => p.trim());
  const t = parts.find(p => p.startsWith('t='))?.slice(2);
  const sigs = parts.filter(p => p.startsWith('v1=')).map(p => p.slice(3));
  if (!t || !sigs.length) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - Number(t)) > toleranceSec) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${payload}`)));
  return sigs.some(s => safeEqual(s, mac));
}

const SUB_EVENTS = new Set(['customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted',
  'customer.subscription.paused', 'customer.subscription.resumed', 'customer.subscription.trial_will_end', 'customer.subscription.pending_update_applied']);

export async function handleWebhook(request, env) {
  if (!env.STRIPE_WEBHOOK_SECRET) return new Response('Webhook not configured', { status: 503 });
  const payload = await request.text();
  if (!(await verifyStripeSignature(payload, request.headers.get('stripe-signature'), env.STRIPE_WEBHOOK_SECRET))) {
    return new Response('Invalid signature', { status: 400 });
  }
  const evt = JSON.parse(payload);
  const prior = await env.DB.prepare('SELECT processed_at FROM stripe_events WHERE id=?').bind(evt.id).first();
  if (prior?.processed_at) return Response.json({ ok: true, duplicate: true });
  try {
    const obj = evt.data?.object || {};
    if (SUB_EVENTS.has(evt.type)) await upsertSubscription(env, obj);
    else if (evt.type === 'invoice.paid') await applyInvoice(env, obj);
    else if (evt.type === 'customer.updated') {
      const m = await env.DB.prepare('SELECT id FROM members WHERE stripe_customer_id=?').bind(obj.id).first();
      if (m) await upsertMember(env, obj, obj.id);
    } else if (evt.type === 'product.created' || evt.type === 'product.updated') await ensureProduct(env, obj.id, obj.name);
    await env.DB.prepare(`INSERT INTO stripe_events (id, type, api_version, processed_at) VALUES (?,?,?,datetime('now'))
      ON CONFLICT(id) DO UPDATE SET processed_at=excluded.processed_at, error=NULL`).bind(evt.id, evt.type, evt.api_version || null).run();
    await setSetting(env, 'last_webhook', JSON.stringify({ at: new Date().toISOString(), type: evt.type, api_version: evt.api_version || null }));
    return Response.json({ ok: true });
  } catch (e) {
    await env.DB.prepare(`INSERT INTO stripe_events (id, type, api_version, error) VALUES (?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET error=excluded.error`).bind(evt.id, evt.type, evt.api_version || null, String(e.message || e)).run();
    return new Response('Processing failed; Stripe will retry', { status: 500 });
  }
}

