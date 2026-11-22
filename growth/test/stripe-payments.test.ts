// Card payments from Stripe through the wine club Worker: the sync (recent days, refunds, history that resumes) and
// what the screen reads from it. Every figure here is made up.
import { describe, it, expect } from 'vitest';
import { syncStripePayments, type StripeCharge, type StripeReader } from '../src/connectors/stripe-payments.ts';
import { loadPayments, prepaidLine, experienceName } from '../src/read/payments.ts';
import { dueJobs, DEFAULT_SCHEDULE } from '../src/domain/scheduler.ts';
import { sqliteD1 } from './helpers.ts';

const TZ = 'America/Mexico_City';
const NOW = Date.UTC(2026, 10, 22, 20, 0);            // Sunday 22 Nov 2026, 14:00 in San Miguel
const at = (ymd: string, hour = 18) => Math.floor(Date.parse(`${ymd}T${String(hour).padStart(2, '0')}:00:00Z`) / 1000);
let seq = 0;
const charge = (over: Partial<StripeCharge> = {}): StripeCharge => ({
  id: `ch_${String(++seq).padStart(4, '0')}`, created: at('2026-11-21'), currency: 'MXN', amount: 90000, amountCaptured: 90000, amountRefunded: 0, status: 'succeeded', captured: true, disputed: false,
  source: 'opentable', kind: 'experiences', experienceId: '842882', platform: 'Diner App', serviceDate: '2026-11-28', serviceTime: '13:00', bookingRef: '', cardCountry: 'US', application: 'ca_TEST', ...over,
});

/** A fake of the other Worker: charges newest first, pages of `size`, with the same cursor rules as Stripe. */
function reader(all: StripeCharge[], refundedNow: StripeCharge[] = [], size = 2) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const sorted = () => [...all].sort((a, b) => b.created - a.created || b.id.localeCompare(a.id));
  const r: StripeReader = {
    async charges(args) {
      calls.push({ fn: 'charges', args });
      let rows = sorted().filter(c => (args.createdGte === undefined || c.created >= args.createdGte) && (args.createdLt === undefined || c.created < args.createdLt));
      if (args.startingAfter) rows = rows.slice(rows.findIndex(c => c.id === args.startingAfter) + 1);
      const page = rows.slice(0, size);
      return { rows: page, hasMore: rows.length > size, last: page.length ? page[page.length - 1]!.id : null };
    },
    async refundedCharges(args) { calls.push({ fn: 'refundedCharges', args }); return { rows: refundedNow, hasMore: false, last: refundedNow.length ? 're_last' : null }; },
  };
  return { r, calls };
}

describe('Stripe payments sync', () => {
  it('reads the recent days, then history a few pages at a time, and resumes where it stopped', async () => {
    const { db, d1 } = sqliteD1();
    const all = [
      charge({ created: at('2026-11-22', 16) }), charge({ created: at('2026-11-21') }), charge({ created: at('2026-11-10') }),
      charge({ created: at('2026-10-20'), source: 'rezdy', kind: '', experienceId: '', platform: '', serviceDate: '', serviceTime: '', bookingRef: 'RAB12CD', cardCountry: 'MX' }),
      charge({ created: at('2026-10-06'), source: 'wine_club', kind: '', experienceId: '', platform: '', serviceDate: '', serviceTime: '', cardCountry: 'MX' }),
      charge({ created: at('2025-11-15'), source: 'rezdy', kind: '', experienceId: '', platform: '', serviceDate: '', serviceTime: '', bookingRef: 'RZZ99XY' }),
      charge({ created: at('2026-11-21', 17), status: 'failed', amountCaptured: 0 }),
    ];
    const { r, calls } = reader(all);
    const first = await syncStripePayments(d1, r, NOW, TZ, 4);     // 4 calls: recent takes 2 (3 rows, one failed), refunds 1, history 1
    expect(first.calls).toBe(4);
    expect(first.recent).toBe(3);
    expect(first.complete).toBe(false);
    expect((db.prepare('SELECT COUNT(*) AS n FROM stripe_payments').get() as { n: number }).n).toBe(2);   // the failed attempt is not kept
    expect(calls[0]!.args.createdGte).toBe(Math.floor((NOW - 3 * 86_400_000) / 1000));
    expect(db.prepare('SELECT history_done, history_cursor IS NOT NULL AS has_cursor, refunds_read_at FROM stripe_sync_state').get()).toEqual({ history_done: 0, has_cursor: 1, refunds_read_at: NOW });

    let runs = 0, last = first;
    while (!last.complete && runs++ < 10) last = await syncStripePayments(d1, r, NOW + runs * 900_000, TZ, 4);
    expect(last.complete).toBe(true);
    expect(last.oldest).toBe('2025-11-15');
    expect((db.prepare('SELECT COUNT(*) AS n FROM stripe_payments').get() as { n: number }).n).toBe(6);
    const before = calls.length;
    await syncStripePayments(d1, r, NOW + 20 * 900_000, TZ, 4);
    expect(calls.slice(before).map(c => c.fn)).toEqual(['charges', 'charges', 'refundedCharges']);   // history is done: only the recent days and refunds

    const row = db.prepare("SELECT local_date, currency, amount_minor, source, kind, experience_id, platform, service_date, service_time, card_country FROM stripe_payments WHERE created_at = ?").get(at('2026-11-22', 16) * 1000);
    expect(row).toEqual({ local_date: '2026-11-22', currency: 'MXN', amount_minor: 90000, source: 'opentable', kind: 'experiences', experience_id: '842882', platform: 'Diner App', service_date: '2026-11-28', service_time: '13:00', card_country: 'US' });
    expect(db.prepare("SELECT booking_ref, service_date FROM stripe_payments WHERE source = 'rezdy' AND local_date = '2026-10-20'").get()).toEqual({ booking_ref: 'RAB12CD', service_date: null });
  });

  it('a refund that arrives weeks later updates the charge it belongs to', async () => {
    const { db, d1 } = sqliteD1();
    const old = charge({ id: 'ch_old1', created: at('2026-10-01') });
    const { r } = reader([old]);
    let s = await syncStripePayments(d1, r, NOW, TZ);
    expect(s.complete).toBe(true);
    expect(db.prepare("SELECT refunded_minor FROM stripe_payments WHERE id = 'ch_old1'").get()).toEqual({ refunded_minor: 0 });
    const { r: r2, calls } = reader([old], [{ ...old, amountRefunded: 90000 }]);
    s = await syncStripePayments(d1, r2, NOW + 2 * 3_600_000, TZ);
    expect(s.refunded).toBe(1);
    expect(db.prepare("SELECT refunded_minor, amount_minor FROM stripe_payments WHERE id = 'ch_old1'").get()).toEqual({ refunded_minor: 90000, amount_minor: 90000 });
    // Refunds are asked for over the three recent days at least...
    expect(calls.find(c => c.fn === 'refundedCharges')!.args.createdGte).toBe(Math.floor((NOW + 2 * 3_600_000 - 3 * 86_400_000) / 1000));
    // ...and after a long silence, from a day before the last good read, so nothing in the gap is missed.
    const { r: r3, calls: later } = reader([old]);
    await syncStripePayments(d1, r3, NOW + 10 * 86_400_000, TZ);
    expect(later.find(c => c.fn === 'refundedCharges')!.args.createdGte).toBe(Math.floor((NOW + 2 * 3_600_000 - 86_400_000) / 1000));
  });

  it('rows that are not charges, and labels that are not labels, do not get in', async () => {
    const { db, d1 } = sqliteD1();
    const odd = [
      charge({ id: 'not a charge id' }), charge({ created: 0 }),
      charge({ id: 'ch_odd1', source: 'somewhere_else', serviceDate: 'mañana', serviceTime: '25h', experienceId: '12a', cardCountry: 'usa', currency: 'mxn' }),
    ];
    const { r } = reader(odd, [], 10);
    await syncStripePayments(d1, r, NOW, TZ);
    expect(db.prepare('SELECT id, source, service_date, service_time, experience_id, card_country, currency FROM stripe_payments').all()).toEqual([{ id: 'ch_odd1', source: 'other', service_date: null, service_time: null, experience_id: '', card_country: '', currency: 'MXN' }]);
  });

  it('an error from the other Worker stops the run without marking refunds as read', async () => {
    const { db, d1 } = sqliteD1();
    const r: StripeReader = { charges: async () => ({ rows: [], hasMore: false, last: null }), refundedCharges: async () => { throw new Error('Stripe 401: Invalid API Key'); } };
    await expect(syncStripePayments(d1, r, NOW, TZ)).rejects.toThrow(/Stripe 401/);
    expect(db.prepare('SELECT refunds_read_at FROM stripe_sync_state').get()).toEqual({ refunds_read_at: null });
  });

  it('is on the schedule every 15 minutes', () => {
    const jobs = dueJobs(NOW, DEFAULT_SCHEDULE).filter(j => j.job === 'payments_sync');
    expect(jobs).toEqual([{ job: 'payments_sync', runKey: `payments_sync:${Math.floor(NOW / 900_000)}` }]);
  });
});

describe('what the payments screen reads', () => {
  async function seeded(historyDone = true) {
    const { db, d1 } = sqliteD1();
    const rows = [
      // The last 28 complete days: 25 Oct to 21 Nov 2026.
      charge({ created: at('2026-11-21'), amountCaptured: 90000, serviceDate: '2026-11-28', platform: 'Diner App', cardCountry: 'US' }),
      charge({ created: at('2026-11-20'), amountCaptured: 140000, experienceId: '796500', serviceDate: '2026-12-05', platform: 'Restaurant Website', cardCountry: 'MX' }),
      charge({ created: at('2026-11-05'), amountCaptured: 90000, amountRefunded: 30000, serviceDate: '2026-11-08', cardCountry: 'US' }),
      charge({ created: at('2026-11-04'), amountCaptured: 70000, amountRefunded: 70000, serviceDate: '2026-11-07' }),             // refunded in full: not a payment
      charge({ created: at('2026-10-27'), amountCaptured: 120000, source: 'rezdy', experienceId: '', platform: '', serviceDate: '', serviceTime: '', cardCountry: 'MX' }),
      charge({ created: at('2026-11-06'), amountCaptured: 360000, source: 'wine_club', experienceId: '', platform: '', serviceDate: '', serviceTime: '' }),
      charge({ created: at('2026-11-12'), amountCaptured: 50000, currency: 'USD', source: 'other', experienceId: '', platform: '', serviceDate: '', serviceTime: '' }),
      charge({ created: at('2026-11-22', 16), amountCaptured: 90000, serviceDate: '2026-11-22' }),                               // today: not in the 28 complete days, but an upcoming visit
      // The 28 days before: 27 Sep to 24 Oct.
      charge({ created: at('2026-10-10'), amountCaptured: 200000, source: 'rezdy', experienceId: '', platform: '', serviceDate: '', serviceTime: '' }),
      // The same weeks last year (364 days back: 26 Oct to 22 Nov 2025).
      charge({ created: at('2025-11-10'), amountCaptured: 250000, source: 'rezdy', experienceId: '', platform: '', serviceDate: '', serviceTime: '' }),
      charge({ created: at('2025-10-20'), amountCaptured: 999900, source: 'rezdy', experienceId: '', platform: '', serviceDate: '', serviceTime: '' }),   // just outside that window
    ];
    await syncStripePayments(d1, reader(rows, [], 100).r, NOW, TZ);
    if (!historyDone) db.exec('UPDATE stripe_sync_state SET history_done = 0');
    db.exec("UPDATE connections SET health = 'connected' WHERE id = 'conn_stripe'");
    return { db, d1 };
  }

  it('adds up experiences paid online, net of refunds, against the weeks before and the same weeks last year', async () => {
    const { d1 } = await seeded();
    const v = await loadPayments(d1, NOW, TZ);
    expect(v.window).toEqual({ from: '2026-10-25', to: '2026-11-21', prevFrom: '2026-09-27', prevTo: '2026-10-24', lastYearFrom: '2025-10-26', lastYearTo: '2025-11-22' });
    expect(v.experiencesPaid).toEqual({ count: 4, netMinor: 90000 + 140000 + 60000 + 120000, previous: { count: 1, netMinor: 200000 }, lastYear: { count: 1, netMinor: 250000 } });
    expect(v.sources.find(s => s.source === 'opentable')!.current).toEqual({ count: 3, netMinor: 290000 });
    expect(v.sources.find(s => s.source === 'wine_club')!.current).toEqual({ count: 1, netMinor: 360000 });
    expect(v.otherCurrencies).toEqual([{ currency: 'USD', count: 1, netMinor: 50000 }]);
    expect(v.connected).toBe(true); expect(v.historyComplete).toBe(true); expect(v.firstDate).toBe('2025-10-20');
  });

  it('breaks the same payments down by experience, by where the guest booked and by card country', async () => {
    const { d1 } = await seeded();
    const v = await loadPayments(d1, NOW, TZ);
    expect(v.experiences).toEqual([{ id: '842882', name: 'Degustación de 4 vinos', count: 2, netMinor: 150000 }, { id: '796500', name: 'Visita guiada + degustación', count: 1, netMinor: 140000 }, { id: 'rezdy', name: 'Tours reservados por Rezdy', count: 1, netMinor: 120000 }]);
    expect(v.platforms).toEqual([{ platform: 'Diner App', count: 2, netMinor: 150000 }, { platform: 'Restaurant Website', count: 1, netMinor: 140000 }, { platform: 'Rezdy', count: 1, netMinor: 120000 }]);
    expect(v.cards).toEqual([{ country: 'MX', count: 2, netMinor: 260000 }, { country: 'US', count: 2, netMinor: 150000 }]);
    // Each breakdown adds up to the headline.
    for (const rows of [v.experiences, v.platforms, v.cards]) expect(rows.reduce((a, x) => a + x.netMinor, 0)).toBe(v.experiencesPaid.netMinor);
    expect(experienceName('123456')).toBe('Experiencia 123456'); expect(experienceName('')).toBe('Otro cargo de OpenTable');
  });

  it('shows what is already charged for visits from today on, week by week', async () => {
    const { d1 } = await seeded();
    const v = await loadPayments(d1, NOW, TZ);
    expect(v.upcoming.count).toBe(3); expect(v.upcoming.netMinor).toBe(90000 + 90000 + 140000); expect(v.upcoming.through).toBe('2026-12-05');
    expect(v.upcoming.weeks).toEqual([{ weekStart: '2026-11-16', count: 1, netMinor: 90000 }, { weekStart: '2026-11-23', count: 1, netMinor: 90000 }, { weekStart: '2026-11-30', count: 1, netMinor: 140000 }]);
  });

  it('gives thirteen months by source, and no last-year figure until the history reaches it', async () => {
    const { d1 } = await seeded(false);
    const v = await loadPayments(d1, NOW, TZ);
    expect(v.months).toHaveLength(13);
    expect(v.months[0]!.month).toBe('2025-11'); expect(v.months[12]!.month).toBe('2026-11');
    expect(v.months[0]!.sources.rezdy).toBe(250000);
    expect(v.months[12]!.sources).toEqual({ opentable: 90000 + 140000 + 60000 + 90000, rezdy: 0, web_store: 0, wine_club: 360000, other: 0 });
    expect(v.months[12]!.total).toBe(380000 + 360000);
    expect(v.experiencesPaid.lastYear).toBeNull();
  });

  it('gives Hoy one line, and nothing at all before the first payment is read', async () => {
    const { d1 } = await seeded();
    expect(await prepaidLine(d1, NOW, TZ)).toEqual({ from: '2026-10-25', to: '2026-11-21', paid: { count: 4, netMinor: 410000 }, upcoming: { count: 3, netMinor: 320000 } });
    expect(await prepaidLine(sqliteD1().d1, NOW, TZ)).toBeNull();
    const empty = await loadPayments(sqliteD1().d1, NOW, TZ);
    expect(empty.connected).toBe(false); expect(empty.experiencesPaid.count).toBe(0); expect(empty.upcoming.weeks).toEqual([]); expect(empty.firstDate).toBeNull();
  });
});
