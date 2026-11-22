// Card payments from Stripe, through the wine club Worker (service binding STRIPE → wineclub's StripeRead entrypoint).
// Growth holds no Stripe key and never sees a guest's name: the rows arrive already reduced to amounts, dates and a few
// labels (wineclub/src/payments.js). Every OpenTable prepayment is a charge in that same Stripe account.
// Each run: the charges of the last three days (late captures), the charges refunded since the last run, then older
// pages of history within a call budget, newest first, until Stripe says there are no more.
import { localDate, LOCAL_DATE } from '../domain/time.ts';

export interface StripeCharge {
  id: string; created: number; currency: string; amount: number; amountCaptured: number; amountRefunded: number; status: string; captured: boolean; disputed: boolean;
  source: string; kind: string; experienceId: string; platform: string; serviceDate: string; serviceTime: string; bookingRef: string; cardCountry: string; application: string;
}
export interface StripePage { rows: StripeCharge[]; hasMore: boolean; last: string | null }
/** What the wine club Worker's StripeRead entrypoint offers (RPC over the service binding). */
export interface StripeReader {
  charges(args: { createdGte?: number; createdLt?: number; startingAfter?: string; limit?: number }): Promise<StripePage>;
  refundedCharges(args: { createdGte?: number; startingAfter?: string; limit?: number }): Promise<StripePage>;
}

export const PAYMENT_SOURCES = ['opentable', 'rezdy', 'web_store', 'wine_club', 'other'] as const;
export type PaymentSource = (typeof PAYMENT_SOURCES)[number];
const RECENT_MS = 3 * 86_400_000;
const DAY_MS = 86_400_000;

const str = (v: unknown, n: number) => String(v ?? '').slice(0, n);
const whole = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0; };

/** Rows that are money or may become money. Failed attempts are not kept. The other Worker is ours, but what it sends is still checked. */
function statements(db: D1Database, rows: StripeCharge[], tz: string, now: number): D1PreparedStatement[] {
  return rows.flatMap(c => {
    const created = whole(c?.created) * 1000;
    if (!c || !/^ch_[A-Za-z0-9]{1,80}$/.test(String(c.id)) || !created || (c.status !== 'succeeded' && c.status !== 'pending')) return [];
    const source: PaymentSource = (PAYMENT_SOURCES as readonly string[]).includes(c.source) ? (c.source as PaymentSource) : 'other';
    const service = LOCAL_DATE.test(String(c.serviceDate)) ? String(c.serviceDate) : null;
    return [db.prepare(`INSERT INTO stripe_payments (id, created_at, local_date, currency, amount_minor, refunded_minor, status, disputed, source, kind, experience_id, platform, service_date, service_time, booking_ref, card_country, application, fetched_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET amount_minor = excluded.amount_minor, refunded_minor = excluded.refunded_minor, status = excluded.status, disputed = excluded.disputed, source = excluded.source, kind = excluded.kind,
        experience_id = excluded.experience_id, platform = excluded.platform, service_date = excluded.service_date, service_time = excluded.service_time, booking_ref = excluded.booking_ref, card_country = excluded.card_country,
        application = excluded.application, fetched_at = excluded.fetched_at`)
      .bind(c.id, created, localDate(created, tz), str(c.currency, 3).toUpperCase(), whole(c.amountCaptured), whole(c.amountRefunded), c.status, c.disputed ? 1 : 0, source, str(c.kind, 40), /^\d{1,12}$/.test(String(c.experienceId)) ? String(c.experienceId) : '',
        str(c.platform, 40), service, service && /^\d{2}:\d{2}$/.test(String(c.serviceTime)) ? String(c.serviceTime) : null, str(c.bookingRef, 20), /^[A-Z]{2}$/.test(String(c.cardCountry)) ? String(c.cardCountry) : '', str(c.application, 60), now)];
  });
}

export interface StripeSyncResult { recent: number; refunded: number; history: number; complete: boolean; oldest: string | null; newestAt: number | null; calls: number }

export async function syncStripePayments(db: D1Database, reader: StripeReader, now: number, tz: string, maxCalls = 14): Promise<StripeSyncResult> {
  let left = maxCalls;
  // `also` rides in the last batch, so a page and the note of having read it are saved together.
  const write = async (rows: StripeCharge[], also: D1PreparedStatement[] = []) => { const s = [...statements(db, rows, tz, now), ...also]; for (let i = 0; i < s.length; i += 50) await db.batch(s.slice(i, i + 50)); };
  const state = await db.prepare('SELECT history_cursor, history_done, refunds_read_at FROM stripe_sync_state WHERE id = 1').first<{ history_cursor: string | null; history_done: number; refunds_read_at: number | null }>();

  // 1. The last three days, every page: a charge can be authorized now and captured later.
  let recent = 0, after: string | undefined;
  while (left > 0) {
    left--;
    const p = await reader.charges({ createdGte: Math.floor((now - RECENT_MS) / 1000), startingAfter: after });
    await write(p.rows); recent += p.rows.length;
    if (!p.hasMore || !p.last) break;
    after = p.last;
  }

  // 2. Charges refunded since the last successful read (with a day of overlap), in their current state.
  let refunded = 0, refundsOk = false;
  after = undefined;
  const refundsFrom = Math.min(now - RECENT_MS, (state?.refunds_read_at ?? now) - DAY_MS);
  while (left > 0) {
    left--;
    const p = await reader.refundedCharges({ createdGte: Math.floor(refundsFrom / 1000), startingAfter: after });
    await write(p.rows); refunded += p.rows.length;
    if (!p.hasMore || !p.last) { refundsOk = true; break; }
    after = p.last;
  }

  // 3. History, newest first, continuing where the last run stopped.
  let history = 0, cursor = state?.history_cursor ?? null, done = !!state?.history_done;
  while (!done && left > 0) {
    left--;
    const p = await reader.charges(cursor ? { startingAfter: cursor } : {});
    if (p.last) cursor = p.last;
    if (!p.hasMore || !p.last) done = true;
    await write(p.rows, [db.prepare('UPDATE stripe_sync_state SET history_cursor = ?, history_done = ?, updated_at = ? WHERE id = 1').bind(cursor, done ? 1 : 0, now)]);
    history += p.rows.length;
  }
  if (refundsOk) await db.prepare('UPDATE stripe_sync_state SET refunds_read_at = ?, updated_at = ? WHERE id = 1').bind(now, now).run();

  const span = await db.prepare('SELECT MIN(local_date) AS oldest, MAX(created_at) AS newest FROM stripe_payments').first<{ oldest: string | null; newest: number | null }>();
  return { recent, refunded, history, complete: done, oldest: span?.oldest ?? null, newestAt: span?.newest ?? null, calls: maxCalls - left };
}
