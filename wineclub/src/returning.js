// "Socio que regresó": a member's Stripe history read live and told in plain words, the evidence that a
// suspended (or ended) member paid again, and the duplicate record a new Stripe customer may have created.
import { stripeGet, historyCache, normName, tzOf, upsertSubscription } from './stripe.js';
import { localDate } from './schedule.js';
import { esc, fdate, money } from './ui.js';
import { loadContext, subClub, isIgnored } from './data.js';
import { subEnded, subStart, exactDate } from './visibility.js';

const TTL = 60_000;
const amt = (cents, cur) => money(cents, cur && cur !== 'mxn' ? cur : null);
const emailsOf = (m) => [m.email, m.contact_email].map(e => String(e || '').trim().toLowerCase()).filter(Boolean);
const LIVE = new Set(['active', 'trialing', 'past_due', 'unpaid', 'paused', 'incomplete']);

export async function memberCustomers(env, member) {
  const links = (await env.DB.prepare('SELECT stripe_customer_id FROM member_customers WHERE member_id=?').bind(member.id).all()).results.map(r => r.stripe_customer_id);
  return [...new Set([member.stripe_customer_id, ...links].filter(Boolean))];
}

// Other visible records of the same person (email, or normalized name), e.g. one the sync created before
// customer matching existed.
export async function findDuplicates(env, member) {
  if (member.merged_into) return [];
  const rows = (await env.DB.prepare('SELECT * FROM members WHERE merged_into IS NULL AND id<>?').bind(member.id).all()).results;
  const mine = emailsOf(member), name = normName(member.name);
  return rows.filter(m => emailsOf(m).some(e => mine.includes(e)) || (name && normName(m.name) === name));
}

// ---------- reading Stripe ----------
async function liveHistory(env, customers, fresh) {
  const key = [...customers].sort().join(',');
  const hit = historyCache.get(key);
  if (!fresh && hit && Date.now() - hit.at < TTL) return hit.value;
  if (!env.STRIPE_SECRET_KEY) throw new Error('Falta la llave de Stripe');
  const tz = tzOf(env), opt = { timeoutMs: 5000 };
  const per = await Promise.all(customers.map(c => Promise.all([
    stripeGet(env, '/v1/subscriptions', [['customer', c], ['status', 'all'], ['limit', '20']], opt),
    stripeGet(env, '/v1/invoices', [['customer', c], ['limit', '12']], opt)])));
  const d = (t) => t ? localDate(t, tz) : null;
  const value = {
    source: 'live',
    subs: per.flatMap(([s]) => s.data).map(s => {
      const price = s.items?.data?.[0]?.price || s.items?.data?.[0]?.plan || {};
      return { id: s.id, customer: typeof s.customer === 'string' ? s.customer : s.customer?.id, status: s.status, start: d(s.start_date || s.created),
        canceledOn: d(s.canceled_at), endedOn: d(s.ended_at || (s.status === 'canceled' ? s.canceled_at : null)), cancelAt: d(s.cancel_at),
        product: typeof price.product === 'string' ? price.product : price.product?.id || null, paused: !!s.pause_collection, raw: s };
    }),
    invoices: per.flatMap(([, i]) => i.data).map(i => ({ id: i.id, status: i.status, attempted: !!i.attempted || (i.attempt_count || 0) > 0,
      sub: (typeof i.subscription === 'string' ? i.subscription : i.subscription?.id) || i.parent?.subscription_details?.subscription || null,
      on: d(i.status === 'paid' ? i.status_transitions?.paid_at || i.created : i.created), amount: i.status === 'paid' ? i.amount_paid : i.amount_due, currency: i.currency }))
      .sort((a, b) => b.on.localeCompare(a.on)).slice(0, 12),
  };
  historyCache.set(key, { at: Date.now(), value });
  return value;
}

// Same shape from the last sync: subscriptions and the payments attached to shipments. No failed attempts here.
function syncedHistory(ctx) {
  return {
    source: 'sync',
    subs: ctx.subs.filter(s => s.stripe_subscription_id).map(s => ({ id: s.stripe_subscription_id, status: s.status, start: s.start_date, endedOn: s.ended_on, cancelAt: s.cancel_at, product: s.stripe_product_id, paused: false })),
    invoices: ctx.subs.flatMap(s => [...(ctx.fulByKey.get(s.id)?.values() || [])].filter(f => f.paid_on && f.stripe_invoice_id)
      .map(f => ({ id: f.stripe_invoice_id, status: 'paid', sub: s.stripe_subscription_id, on: f.paid_on, amount: f.paid_amount, currency: s.price_currency }))).sort((a, b) => b.on.localeCompare(a.on)).slice(0, 12),
  };
}

// ---------- telling it in plain words ----------
export function interpret(h, clubName) {
  const subs = [...h.subs].sort((a, b) => a.start.localeCompare(b.start));
  const events = [];
  subs.forEach((s, i) => {
    const club = clubName(s.product);
    events.push({ d: s.start, r: 0, t: `${i ? 'Se suscribió de nuevo' : 'Se suscribió'}${club ? ` (${club})` : ''}`, tone: 'green' });
    const newer = subs.slice(i + 1).length > 0;
    if (s.canceledOn && (s.endedOn ? s.canceledOn < s.endedOn : s.cancelAt)) events.push({ d: s.canceledOn, r: 2, t: `Pidió cancelar · termina el ${exactDate(s.endedOn || s.cancelAt)}`, tone: 'grey' });
    if (s.endedOn) events.push({ d: s.endedOn, r: 2, t: newer ? 'Suscripción anterior cancelada' : 'Suscripción cancelada', tone: 'grey' });
  });
  for (const i of h.invoices) {
    if (i.status === 'paid' && i.amount > 0) events.push({ d: i.on, r: 1, t: `Pagó ${amt(i.amount, i.currency)}`, tone: 'green' });
    else if (i.status === 'open' && i.attempted) events.push({ d: i.on, r: 1, t: 'Pago falló', tone: 'red' });
    else if (i.status === 'uncollectible') events.push({ d: i.on, r: 1, t: 'Pago no cobrado (incobrable)', tone: 'red' });
  }
  events.sort((a, b) => b.d.localeCompare(a.d) || a.r - b.r);

  const current = subs.filter(s => LIVE.has(s.status) && !s.endedOn).sort((a, b) => b.start.localeCompare(a.start))[0];
  let verdict;
  if (current) {
    const inv = h.invoices.filter(i => i.sub === current.id);
    const paid = inv.find(i => i.status === 'paid' && i.amount > 0);
    const failed = inv.find(i => (i.status === 'open' && i.attempted) || i.status === 'uncollectible');
    const failedLast = failed && (!paid || failed.on > paid.on);
    if (['past_due', 'unpaid'].includes(current.status) || failedLast) verdict = { tone: 'red', t: failedLast ? `Pago fallido el ${exactDate(failed.on)}` : 'Pago pendiente en Stripe' };
    else if (current.paused || current.status === 'paused') verdict = { tone: 'amber', t: 'Cobro en pausa' };
    else if (current.status === 'incomplete') verdict = { tone: 'amber', t: 'Primer pago incompleto' };
    else if (current.status === 'trialing') verdict = { tone: 'green', t: 'En periodo de prueba' };
    else verdict = paid ? { tone: 'green', t: `Al corriente · último pago ${exactDate(paid.on)} · ${amt(paid.amount, paid.currency)}` } : { tone: 'amber', t: 'Activa · sin pago registrado' };
    if (current.cancelAt) verdict.t += ` · se cancela el ${exactDate(current.cancelAt)}`;
  } else if (subs.length) {
    const end = subs.map(s => s.endedOn).filter(Boolean).sort().pop();
    verdict = { tone: 'grey', t: `Sin suscripción activa${end ? ` · terminó el ${exactDate(end)}` : ''}` };
  } else verdict = { tone: 'grey', t: 'Sin suscripciones en Stripe' };
  return { verdict, events };
}

// ---------- evidence that the member came back ----------
// Eligible: suspended, or every club subscription of their own has ended. Evidence: a live, ACTIVE subscription
// with a PAID invoice, on this member's customers or a duplicate's, that started on/after the suspension
// (or, if they were not suspended, after every subscription they had).
export function returnEvidence({ member, ownSubs, live, today }) {
  if (!live || live.source !== 'live' || member.merged_into) return null;
  const ended = ownSubs.length > 0 && ownSubs.every(s => subEnded(s, today));
  if (!member.suspended_on && !ended) return null;
  const prior = ownSubs.map(subStart).sort().pop() || '0000';
  const cands = live.subs.filter(s => s.status === 'active' && !s.endedOn && (member.suspended_on ? s.start >= member.suspended_on : s.start > prior))
    .map(s => ({ s, paid: live.invoices.find(i => i.sub === s.id && i.status === 'paid' && i.amount > 0) })).filter(x => x.paid)
    .sort((a, b) => b.s.start.localeCompare(a.s.start));
  if (!cands.length) return null;
  const { s, paid } = cands[0];
  return { stripeId: s.id, customer: s.customer, start: s.start, paidOn: paid.on, amount: paid.amount, currency: paid.currency, invoice: paid.id, raw: s.raw };
}

// Everything the member page and the return screen need. `fresh` skips the cache (always on POST).
export async function returnState(env, member, { fresh = false } = {}) {
  const dups = await findDuplicates(env, member);
  const newer = dups.filter(d => d.id > member.id), older = dups.filter(d => d.id < member.id);
  const customers = [...new Set([...(await memberCustomers(env, member)), ...(await Promise.all(newer.map(d => memberCustomers(env, d)))).flat()])];
  const ctx = await loadContext(env, { memberIds: [member.id, ...newer.map(d => d.id)] });
  const names = new Map((await env.DB.prepare('SELECT p.product_id, COALESCE(c.name, p.name) AS name FROM stripe_products p LEFT JOIN clubs c ON c.id=p.club_id').all()).results.map(r => [r.product_id, r.name]));
  let live = null, error = null;
  if (customers.length) { try { live = await liveHistory(env, customers, fresh); } catch (e) { error = String(e.message || e); } }
  const ownSubs = ctx.subs.filter(s => s.member_id === member.id && subClub(ctx, s) && !isIgnored(s));
  let ev = returnEvidence({ member, ownSubs, live, today: ctx.today });
  if (ev) {
    let row = await env.DB.prepare('SELECT id, member_id FROM subscriptions WHERE stripe_subscription_id=?').bind(ev.stripeId).first();
    if (!row && ev.raw) { await upsertSubscription(env, ev.raw); row = await env.DB.prepare('SELECT id, member_id FROM subscriptions WHERE stripe_subscription_id=?').bind(ev.stripeId).first(); }
    const dup = row && row.member_id !== member.id ? newer.find(d => d.id === row.member_id) : null;
    ev = row && (row.member_id === member.id || dup) ? { ...ev, subId: row.id, dup } : null;
  }
  const history = customers.length ? interpret(live || syncedHistory(ctx), (p) => names.get(p) || null) : null;
  return { ctx, dups, newer, older, customers, live, error, ev, history, source: live ? 'live' : 'sync' };
}

// The reactivation plan covers this member plus the duplicate record it absorbs (never other records).
export const planContext = (env, member, ev) => loadContext(env, { memberIds: [member.id, ...(ev?.dup ? [ev.dup.id] : [])] });

// ---------- rendering ----------
export function returnBanner(member, rs) {
  if (!rs?.ev) return '';
  return `<div class="banner green return-banner" role="status"><b>Volvió a suscribirse el ${esc(exactDate(rs.ev.start))} · pagado en Stripe</b>
    <a class="btn" href="/socio/${member.id}/reactivar">Reactivar y programar envíos</a></div>`;
}

export function historyCard(member, rs, user) {
  if (!rs?.history) return '';
  const { verdict, events } = rs.history;
  let lastYear = null;
  const row = (e) => { const y = e.d.slice(0, 4), label = fdate(e.d, lastYear === y ? y : null, { weekday: false }); lastYear = y;
    return `<li class="${e.tone}"><time datetime="${esc(e.d)}">${esc(label)}</time> · ${esc(e.t)}</li>`; };
  const rows = events.map(row), head = rows.slice(0, 6), rest = rows.slice(6);
  const dupNote = [...rs.newer.map(d => ({ d, t: rs.ev?.dup?.id === d.id ? 'Se une a esta ficha al reactivar.' : 'Mismo socio.' })), ...rs.older.map(d => ({ d, t: 'Registro anterior de este socio.' }))]
    .map(({ d, t }) => `<p class="small sh-dup">Otro registro: <a href="/socio/${d.id}">#${d.id} ${esc(d.name.trim())}</a> · ${esc(t)}</p>`).join('');
  const open = user.isManager && rs.customers.length ? `<a class="sh-open small" href="https://dashboard.stripe.com/customers/${encodeURIComponent(rs.customers[rs.customers.length - 1])}" target="_blank" rel="noopener">Abrir en Stripe</a>` : '';
  return `<section class="card stripe-history" id="stripe"><div class="sh-head"><h2>Historial en Stripe</h2>${open}</div>
    <p class="sh-verdict ${verdict.tone}">${esc(verdict.t)}</p>
    ${rs.source === 'sync' ? '<p class="small muted sh-src">Datos de la última sincronización · Stripe no respondió.</p>' : ''}${dupNote}
    ${head.length ? `<ol class="sh-tl">${head.join('')}</ol>` : '<p class="small muted">Sin movimientos.</p>'}
    ${rest.length ? `<details class="more"><summary>Ver ${rest.length} más</summary><ol class="sh-tl">${rest.join('')}</ol></details>` : ''}</section>`;
}

export const RETURN_CSS = `<style>
.return-banner{flex-direction:column;align-items:stretch}.return-banner .btn{width:100%;min-height:48px;font-size:16px}
.stripe-history h2{margin:0;font-size:18px}.sh-head{display:flex;justify-content:space-between;align-items:center;gap:10px}
.sh-open{display:inline-flex;align-items:center;min-height:44px;font-weight:700}
.sh-verdict{margin:8px 0 6px;font-weight:800}.sh-verdict.green{color:var(--green)}.sh-verdict.red{color:var(--red)}.sh-verdict.amber{color:var(--amber)}.sh-verdict.grey{color:var(--ink)}
.sh-src,.sh-dup{margin:4px 0}.sh-tl{list-style:none;margin:6px 0 0;padding:0}.sh-tl li{padding:7px 0 7px 12px;border-top:1px solid var(--line);border-left:3px solid var(--line);font-size:14px;overflow-wrap:anywhere}
.sh-tl li:first-child{border-top:0}.sh-tl li.green{border-left-color:var(--green)}.sh-tl li.red{border-left-color:var(--red)}.sh-tl time{font-weight:700}
</style>`;
