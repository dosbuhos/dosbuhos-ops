// What was charged online by card (Stripe), in the owner's words: experiences paid ahead on OpenTable, what is already
// paid for visits still to come, the club and the web store, and the old Rezdy tours for last year's comparison.
// "Net" is captured minus refunded, IVA included, pesos only. Nothing here is attributed to a campaign, and none of it
// is added to the point-of-sale totals: whether a prepaid visit is also rung up in Parrot is not known from this data.
import { addDays, localDate, weekStart, type LocalDate } from '../domain/time.ts';
import { EXPERIENCES } from '../connectors/opentable-availability.ts';
import { PAYMENT_SOURCES, type PaymentSource } from '../connectors/stripe-payments.ts';
import { YEAR_BACK_DAYS } from './sales.ts';

export interface Bucket { count: number; netMinor: number }
export interface PaymentsView {
  connected: boolean; health: string; healthReason: string; historyComplete: boolean; firstDate: LocalDate | null; lastChargeAt: number | null;
  window: { from: LocalDate; to: LocalDate; prevFrom: LocalDate; prevTo: LocalDate; lastYearFrom: LocalDate; lastYearTo: LocalDate };
  /** Experiences paid online in the window, whichever system took the booking (OpenTable now, Rezdy before November 2026). */
  experiencesPaid: Bucket & { previous: Bucket; lastYear: Bucket | null };
  sources: { source: PaymentSource; current: Bucket; previous: Bucket }[];
  /** The headline's payments three ways. Rezdy's tours are one line in each ("rezdy" / "Rezdy"): it kept no experience or platform. */
  experiences: ({ id: string; name: string } & Bucket)[];
  platforms: ({ platform: string } & Bucket)[];
  cards: ({ country: string } & Bucket)[];
  /** Already charged for reservations from today on. */
  upcoming: Bucket & { through: LocalDate | null; weeks: ({ weekStart: LocalDate } & Bucket)[] };
  months: { month: string; total: number; sources: Record<PaymentSource, number> }[];
  otherCurrencies: ({ currency: string } & Bucket)[];
}

const PAID = "status = 'succeeded' AND amount_minor > refunded_minor";
const zero = (): Bucket => ({ count: 0, netMinor: 0 });
const add = (b: Bucket, n: number, net: number) => { b.count += Number(n) || 0; b.netMinor += Number(net) || 0; };
const EXPERIENCE_NAME = new Map(EXPERIENCES.map(x => [String(x.id), x.name]));
export const experienceName = (id: string) => (id ? EXPERIENCE_NAME.get(id) ?? `Experiencia ${id}` : 'Otro cargo de OpenTable');
const ONLINE_EXPERIENCES: readonly string[] = ['opentable', 'rezdy'];
const REZDY = 'rezdy';
const monthsBack = (today: LocalDate, n: number): string => { const [y, m] = today.split('-').map(Number) as [number, number]; const d = new Date(Date.UTC(y, m - 1 - n, 1)); return d.toISOString().slice(0, 7); };

export async function loadPayments(db: D1Database, now: number, tz: string): Promise<PaymentsView> {
  const today = localDate(now, tz), to = addDays(today, -1), from = addDays(to, -27);
  const prevTo = addDays(from, -1), prevFrom = addDays(prevTo, -27);
  const lastYearFrom = addDays(from, -YEAR_BACK_DAYS), lastYearTo = addDays(to, -YEAR_BACK_DAYS);
  const firstMonth = monthsBack(today, 12);
  const [conn, state, span, daily, detail, coming, monthly, foreign] = await Promise.all([
    db.prepare("SELECT health, health_reason FROM connections WHERE id = 'conn_stripe'").first<{ health: string; health_reason: string }>(),
    db.prepare('SELECT history_done FROM stripe_sync_state WHERE id = 1').first<{ history_done: number }>(),
    db.prepare('SELECT MIN(local_date) AS first, MAX(created_at) AS last FROM stripe_payments').first<{ first: string | null; last: number | null }>(),
    db.prepare(`SELECT local_date AS date, source, COUNT(*) AS n, SUM(amount_minor - refunded_minor) AS net FROM stripe_payments
      WHERE ${PAID} AND currency = 'MXN' AND ((local_date BETWEEN ? AND ?) OR (local_date BETWEEN ? AND ?)) GROUP BY local_date, source`).bind(prevFrom, to, lastYearFrom, lastYearTo).all<{ date: string; source: string; n: number; net: number }>(),
    db.prepare(`SELECT source, experience_id AS id, platform, card_country AS country, COUNT(*) AS n, SUM(amount_minor - refunded_minor) AS net FROM stripe_payments
      WHERE ${PAID} AND currency = 'MXN' AND source IN ('opentable', 'rezdy') AND local_date BETWEEN ? AND ? GROUP BY source, experience_id, platform, card_country`).bind(from, to).all<{ source: string; id: string; platform: string; country: string; n: number; net: number }>(),
    db.prepare(`SELECT service_date AS date, COUNT(*) AS n, SUM(amount_minor - refunded_minor) AS net FROM stripe_payments
      WHERE ${PAID} AND currency = 'MXN' AND source = 'opentable' AND service_date >= ? GROUP BY service_date`).bind(today).all<{ date: string; n: number; net: number }>(),
    db.prepare(`SELECT substr(local_date, 1, 7) AS month, source, SUM(amount_minor - refunded_minor) AS net FROM stripe_payments
      WHERE ${PAID} AND currency = 'MXN' AND local_date >= ? GROUP BY month, source`).bind(`${firstMonth}-01`).all<{ month: string; source: string; net: number }>(),
    db.prepare(`SELECT currency, COUNT(*) AS n, SUM(amount_minor - refunded_minor) AS net FROM stripe_payments WHERE ${PAID} AND currency <> 'MXN' AND local_date BETWEEN ? AND ? GROUP BY currency`).bind(from, to).all<{ currency: string; n: number; net: number }>(),
  ]);

  const cur = new Map<string, Bucket>(), prev = new Map<string, Bucket>();
  const paid = zero(), paidPrev = zero(), paidLastYear = zero();
  for (const r of daily.results) {
    const online = ONLINE_EXPERIENCES.includes(r.source);
    if (r.date >= from && r.date <= to) { add(cur.get(r.source) ?? cur.set(r.source, zero()).get(r.source)!, r.n, r.net); if (online) add(paid, r.n, r.net); }
    else if (r.date >= prevFrom && r.date <= prevTo) { add(prev.get(r.source) ?? prev.set(r.source, zero()).get(r.source)!, r.n, r.net); if (online) add(paidPrev, r.n, r.net); }
    if (r.date >= lastYearFrom && r.date <= lastYearTo && online) add(paidLastYear, r.n, r.net);
  }
  const historyComplete = !!state?.history_done;
  // Last year only counts when the history reaches it: an unfinished load would read as "nothing was sold".
  const lastYearKnown = historyComplete && !!span?.first && span.first <= lastYearFrom;

  // The three breakdowns cover the same payments as the headline: OpenTable's, plus Rezdy's while a window still reaches October 2026.
  const fold = <K extends string>(key: (r: { source: string; id: string; platform: string; country: string }) => K) => {
    const m = new Map<K, Bucket>();
    for (const r of detail.results) add(m.get(key(r)) ?? m.set(key(r), zero()).get(key(r))!, r.n, r.net);
    return [...m.entries()].sort((a, b) => b[1].netMinor - a[1].netMinor);
  };

  const weeks = new Map<LocalDate, Bucket>();
  const upcoming = zero(); let through: LocalDate | null = null;
  for (const r of coming.results) { const w = weekStart(r.date); add(weeks.get(w) ?? weeks.set(w, zero()).get(w)!, r.n, r.net); add(upcoming, r.n, r.net); if (!through || r.date > through) through = r.date; }

  const months = new Map<string, Record<PaymentSource, number>>();
  for (let i = 12; i >= 0; i--) months.set(monthsBack(today, i), Object.fromEntries(PAYMENT_SOURCES.map(s => [s, 0])) as Record<PaymentSource, number>);
  for (const r of monthly.results) { const m = months.get(r.month); if (m && r.source in m) m[r.source as PaymentSource] += Number(r.net) || 0; }

  return {
    connected: conn?.health === 'connected', health: conn?.health ?? 'not_configured', healthReason: conn?.health_reason ?? '', historyComplete, firstDate: span?.first ?? null, lastChargeAt: span?.last ?? null,
    window: { from, to, prevFrom, prevTo, lastYearFrom, lastYearTo },
    experiencesPaid: { ...paid, previous: paidPrev, lastYear: lastYearKnown ? paidLastYear : null },
    sources: PAYMENT_SOURCES.map(source => ({ source, current: cur.get(source) ?? zero(), previous: prev.get(source) ?? zero() })),
    experiences: fold(r => (r.source === 'rezdy' ? REZDY : r.id)).map(([id, b]) => ({ id, name: id === REZDY ? 'Tours reservados por Rezdy' : experienceName(id), ...b })),
    platforms: fold(r => (r.source === 'rezdy' ? 'Rezdy' : r.platform)).map(([platform, b]) => ({ platform, ...b })),
    cards: fold(r => r.country).map(([country, b]) => ({ country, ...b })),
    upcoming: { ...upcoming, through, weeks: [...weeks.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([w, b]) => ({ weekStart: w, ...b })) },
    months: [...months.entries()].map(([month, sources]) => ({ month, sources, total: PAYMENT_SOURCES.reduce((a, s) => a + sources[s], 0) })),
    otherCurrencies: foreign.results.map(r => ({ currency: r.currency, count: Number(r.n) || 0, netMinor: Number(r.net) || 0 })),
  };
}

/** One line for "Hoy": experiences paid online in the last 28 complete days and what is already charged for visits to come. Null until there is something to say. */
export async function prepaidLine(db: D1Database, now: number, tz: string): Promise<{ from: LocalDate; to: LocalDate; paid: Bucket; upcoming: Bucket } | null> {
  const today = localDate(now, tz), to = addDays(today, -1), from = addDays(to, -27);
  const [a, b] = await Promise.all([
    db.prepare(`SELECT COUNT(*) AS n, SUM(amount_minor - refunded_minor) AS net FROM stripe_payments WHERE ${PAID} AND currency = 'MXN' AND source IN ('opentable', 'rezdy') AND local_date BETWEEN ? AND ?`).bind(from, to).first<{ n: number; net: number | null }>(),
    db.prepare(`SELECT COUNT(*) AS n, SUM(amount_minor - refunded_minor) AS net FROM stripe_payments WHERE ${PAID} AND currency = 'MXN' AND source = 'opentable' AND service_date >= ?`).bind(today).first<{ n: number; net: number | null }>(),
  ]).catch(() => [null, null] as const);
  if (!a || !b || (!a.n && !b.n)) return null;
  return { from, to, paid: { count: Number(a.n) || 0, netMinor: Number(a.net) || 0 }, upcoming: { count: Number(b.n) || 0, netMinor: Number(b.net) || 0 } };
}
