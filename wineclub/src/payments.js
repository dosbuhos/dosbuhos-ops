// Card payments, read-only, for other Dos Búhos apps (service binding, entrypoint StripeRead in index.js).
// This Worker holds the only Stripe key, so it is also the place where personal data stops: a charge leaves here as
// amounts, dates and a few labels from an allowlist. Names, emails, phones, addresses, card numbers, descriptions and
// raw metadata never do. Every OpenTable prepayment is a charge in this same Stripe account, so one reader covers the
// club, the prepaid experiences, the web store and the old Rezdy tours.

import { stripeGet } from './stripe.js';

const MONTHS = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };

/** OpenTable writes the reservation as "16:00 2026-Nov-22" (restaurant local time). Anything else gives null. */
export function parseOpenTableDate(s) {
  const m = /^\s*(\d{1,2}):(\d{2})\s+(\d{4})-([A-Za-z]{3})-(\d{1,2})\s*$/.exec(String(s ?? ''));
  const mon = m && MONTHS[m[4].toLowerCase()];
  if (!m || !mon) return null;
  const h = Number(m[1]), min = Number(m[2]), d = Number(m[5]);
  if (h > 23 || min > 59 || d < 1 || d > 31) return null;
  const date = `${m[3]}-${mon}-${String(d).padStart(2, '0')}`;
  if (new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) return null; // 31 of a 30-day month, etc.
  return { date, time: `${String(h).padStart(2, '0')}:${m[2]}` };
}

// A short label set by the platform (never typed by a guest): letters, digits, spaces and a little punctuation.
const label = (v) => { const t = String(v ?? '').trim(); return /^[\p{L}\p{N}][\p{L}\p{N} ._/+-]{0,39}$/u.test(t) ? t : ''; };
const digits = (v) => { const t = String(v ?? '').trim(); return /^\d{1,12}$/.test(t) ? t : ''; };
const int = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : 0);

/**
 * Where a charge came from, decided only from fields the platforms set:
 *   opentable  metadata written by OpenTable (prepaid experiences, deposits)
 *   rezdy      "Rezdy order XXXXXXX for ..." (tours until October 2026); only the order code is kept
 *   web_store  the website shop (WooCommerce writes site_url / "- Order 123")
 *   wine_club  the customer is a club member in this app's database
 *   other      anything else; no text is kept
 */
export function sourceOf(ch, clubCustomers) {
  const md = ch.metadata || {}, desc = String(ch.description || '');
  if (Object.keys(md).some(k => k.startsWith('OpenTable ')) || /^OpenTable\b/.test(desc)) return 'opentable';
  if (/^Rezdy order\b/.test(desc)) return 'rezdy';
  if (md.site_url || md.order_key || /-\s*(Order|Pedido)\s+#?\d+\s*$/i.test(desc)) return 'web_store';
  if (typeof ch.customer === 'string' && clubCustomers.has(ch.customer)) return 'wine_club';
  return 'other';
}

/** One Stripe charge reduced to what another app may store. */
export function trimCharge(ch, clubCustomers = new Set()) {
  const md = ch.metadata || {};
  const source = sourceOf(ch, clubCustomers);
  const ot = source === 'opentable';
  const service = ot ? parseOpenTableDate(md['OpenTable Reservation Date']) : null;
  const rezdy = source === 'rezdy' ? /^Rezdy order ([A-Z0-9]{4,12})\b/.exec(String(ch.description || '')) : null;
  const app = typeof ch.application === 'string' ? ch.application : ch.application?.id;
  const country = String(ch.payment_method_details?.card?.country ?? '').toUpperCase();
  return {
    id: String(ch.id),
    created: int(ch.created),                                  // unix seconds
    currency: String(ch.currency || '').toUpperCase(),
    amount: int(ch.amount),                                    // minor units (centavos)
    amountCaptured: int(ch.amount_captured ?? (ch.captured ? ch.amount : 0)),
    amountRefunded: int(ch.amount_refunded),
    status: ['succeeded', 'pending', 'failed'].includes(ch.status) ? ch.status : 'other',
    captured: !!ch.captured,
    disputed: !!ch.disputed,
    source,
    kind: ot ? label(md['OpenTable Transaction Type']) : '',   // experiences, ...
    experienceId: ot ? digits(md['OpenTable Experience Id']) : '',
    platform: ot ? label(md['OpenTable Platform']) : '',       // Diner App, ...
    serviceDate: service?.date ?? '',                          // the reservation's day and time, restaurant local
    serviceTime: service?.time ?? '',
    bookingRef: rezdy ? rezdy[1] : '',
    cardCountry: /^[A-Z]{2}$/.test(country) ? country : '',    // where the card was issued; says tourist or local, not who
    application: /^ca_[A-Za-z0-9]{1,40}$/.test(String(app ?? '')) ? String(app) : '',
  };
}

async function clubCustomerIds(env) {
  const r = await env.DB.prepare('SELECT stripe_customer_id AS c FROM members WHERE stripe_customer_id IS NOT NULL UNION SELECT stripe_customer_id FROM member_customers').all();
  return new Set(r.results.map(x => x.c));
}

const pageParams = ({ createdGte, createdLt, startingAfter, limit } = {}, prefix) => {
  const p = [['limit', String(Math.min(100, Math.max(1, int(limit) || 100)))]];
  if (Number.isFinite(createdGte)) p.push(['created[gte]', String(Math.floor(createdGte))]);
  if (Number.isFinite(createdLt)) p.push(['created[lt]', String(Math.floor(createdLt))]);
  if (typeof startingAfter === 'string' && new RegExp(`^${prefix}_[A-Za-z0-9]{1,60}$`).test(startingAfter)) p.push(['starting_after', startingAfter]);
  return p;
};

/** One page of charges, newest first (Stripe's order). Pass `last` back as startingAfter for the next, older page. */
export async function listCharges(env, args = {}) {
  if (!env.STRIPE_SECRET_KEY) throw new Error('Falta STRIPE_SECRET_KEY en wineclub');
  const [j, club] = await Promise.all([stripeGet(env, '/v1/charges', pageParams(args, 'ch'), { timeoutMs: 20000 }), clubCustomerIds(env)]);
  const data = Array.isArray(j?.data) ? j.data : [];
  return { rows: data.map(ch => trimCharge(ch, club)), hasMore: !!j?.has_more, last: data.length ? String(data[data.length - 1].id) : null };
}

/**
 * The charges that were refunded in a window, in their current state (so the refunded amount is Stripe's own total,
 * not a sum we keep). One page of refunds, newest first; a guest can cancel weeks after paying, long after the charge
 * was last read. `last` is the refund to continue after.
 */
export async function listRefundedCharges(env, args = {}) {
  if (!env.STRIPE_SECRET_KEY) throw new Error('Falta STRIPE_SECRET_KEY en wineclub');
  const [j, club] = await Promise.all([stripeGet(env, '/v1/refunds', [...pageParams(args, 're'), ['expand[]', 'data.charge']], { timeoutMs: 20000 }), clubCustomerIds(env)]);
  const data = Array.isArray(j?.data) ? j.data : [];
  const seen = new Set(), rows = [];
  for (const r of data) {
    const ch = r.charge;
    if (!ch || typeof ch !== 'object' || !ch.id || seen.has(ch.id)) continue;   // a refund with no charge attached has nothing to update
    seen.add(ch.id); rows.push(trimCharge(ch, club));
  }
  return { rows, hasMore: !!j?.has_more, last: data.length ? String(data[data.length - 1].id) : null };
}
