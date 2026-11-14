// Acceptance criteria 3–7, 16, 19 (spec §24).
import { describe, it, expect } from 'vitest';
import { minor, micros, addMinor, microsToMinor, convertMinor, CurrencyMismatchError, divRoundHalfEven, scaleMicros } from '../src/domain/money.ts';
import { zonedToUtc, localParts, addDays } from '../src/domain/time.ts';
import { dueJobs, DEFAULT_SCHEDULE } from '../src/domain/scheduler.ts';
import { revenueRoas, contributionRoas, aggregateRoas, costPerCompletedVisit, delta, contributionAfterAds, occupancy, type AttributedTotals } from '../src/domain/metrics.ts';
import { netRevenueLine, contributionLine, currentStatus, bookingValue, allocateTransaction, businessRevenue, cohortMaturity, type Transaction } from '../src/domain/measurement.ts';
import { resolveCapacity, summarizeDays, capacitySupportsGrowth, type Slot } from '../src/domain/capacity.ts';
import { projectExposure, GOOGLE_ADS_DEFAULT_BEHAVIOR } from '../src/policy/exposure.ts';

describe('money (AC 6)', () => {
  it('never mixes currencies without a dated rate', () => {
    expect(() => addMinor(minor('MXN', 100), minor('USD', 100))).toThrow(CurrencyMismatchError);
    const usd = convertMinor(minor('USD', 10_00), { from: 'USD', to: 'MXN', date: '2026-11-13', rateMicros: 18_250_000, source: 'Banxico FIX' });
    expect(usd).toEqual({ currency: 'MXN', minor: 182_50 });
  });
  it('converts provider micros exactly and rounds half to even', () => {
    expect(microsToMinor(micros('MXN', 123_455_000))).toEqual({ currency: 'MXN', minor: 12346 });
    expect(divRoundHalfEven(25, 10)).toBe(2);
    expect(divRoundHalfEven(35, 10)).toBe(4);
    expect(scaleMicros(micros('MXN', 500_000_000), 11_000, 10_000).micros).toBe(550_000_000);
    expect(() => minor('MXN', 1.5)).toThrow();
  });
});

const totals = (o: Partial<AttributedTotals>): AttributedTotals => ({ currency: 'MXN', revenue: minor('MXN', 100_000_00), contribution: minor('MXN', 40_000_00), spend: micros('MXN', 10_000_000_000), completedParties: 50, completedGuests: 140, confirmedBookings: 60, attributionMethod: 'Google Ads, 30-day click', provisional: false, ...o });

describe('metrics (AC 4, 6)', () => {
  it('computes ROAS with named numerator and denominator', () => {
    const r = revenueRoas(totals({}));
    expect(r.value).toBe(10);
    expect(r.numerator.label).toMatch(/ingresos/i);
    expect(r.denominator?.value).toBe(10_000_00);
  });
  it('zero spend and missing data are null with a reason, never 0 or Infinity', () => {
    const z = revenueRoas(totals({ spend: micros('MXN', 0) }));
    expect(z.value).toBeNull(); expect(z.reason).toMatch(/No hubo gasto en anuncios/);
    const m = contributionRoas(totals({ contribution: null }));
    expect(m.value).toBeNull(); expect(m.reason).toMatch(/márgenes/);
    expect(contributionAfterAds(totals({ contribution: null })).value).toBeNull();
    expect(costPerCompletedVisit(totals({ completedParties: null })).value).toBeNull();
    expect(costPerCompletedVisit(totals({ completedParties: 0 })).value).toBeNull();
  });
  it('aggregates ROAS from sums, not by averaging', () => {
    const rows = [{ revenue: minor('MXN', 1000_00), spend: micros('MXN', 100_000_000) }, { revenue: minor('MXN', 100_00), spend: micros('MXN', 100_000_000) }];
    expect(aggregateRoas(rows, 'MXN', false).value).toBeCloseTo(5.5); // (1000+100)/(100+100), not (10+1)/2
    expect(aggregateRoas([...rows, { revenue: null, spend: micros('MXN', 1) }], 'MXN', false).value).toBeNull();
  });
  it('percent change only against a meaningful positive base', () => {
    expect(delta(12, 10, '7d', false).percent).toBeCloseTo(20);
    expect(delta(5, 0, '7d', false).percent).toBeNull();
    expect(delta(-5, -10, '7d', false).percent).toBeNull();
    expect(delta(null, 10, '7d', false).absolute).toBeNull();
  });
  it('occupancy excludes unknown slots from the denominator and says so', () => {
    const o = occupancy(30, 40, 2);
    expect(o.value).toBe(75); expect(o.reason).toMatch(/2 horario/);
  });
});

describe('revenue and lifecycle (AC 2, 3, 5)', () => {
  const rules = { revenueIncludesTax: true, revenueIncludesTips: true, revenueIsNetOfCommission: false };
  const tx: Transaction = { transactionId: 't1', currency: 'MXN', paid: true, isRefundableDeposit: false, lines: [
    { lineId: 'l1', product: 'tour_tasting', grossMinor: 2320_00, taxMinor: 320_00, tipMinor: 0, passThroughMinor: 0, refundedMinor: 0, commissionMinor: 100_00 },
    { lineId: 'l2', product: 'wine_order', grossMinor: 1160_00, taxMinor: 160_00, tipMinor: 0, passThroughMinor: 0, refundedMinor: 0, commissionMinor: 0 },
    { lineId: 'l2', product: 'wine_order', grossMinor: 1160_00, taxMinor: 160_00, tipMinor: 0, passThroughMinor: 0, refundedMinor: 0, commissionMinor: 0 },
  ] };
  it('excludes tax and tips and does not recognize a refundable deposit', () => {
    expect(netRevenueLine(tx, tx.lines[0]!, rules)).toBe(2000_00);
    expect(netRevenueLine({ ...tx, isRefundableDeposit: true }, tx.lines[0]!, rules)).toBe(0);
  });
  it('subtracts commission only when revenue is not already net of it', () => {
    const a = { product: 'tour_tasting' as const, effectiveFrom: '2026-01-01', effectiveTo: null, variableCostPctBp: 3000, variableCostPerGuestMinor: null, status: 'estimated' as const, approvedBy: 'owner' };
    expect(contributionLine(tx, tx.lines[0]!, rules, 2, a)).toBe(2000_00 - 600_00 - 100_00);
    expect(contributionLine(tx, tx.lines[0]!, { ...rules, revenueIsNetOfCommission: true }, 2, a)).toBe(1400_00);
    expect(contributionLine(tx, tx.lines[0]!, rules, 2, null)).toBeNull();
  });
  it('allocates cross-sell once: tasting + wine = two components, one visit total', () => {
    const alloc = allocateTransaction(tx, 'bk1', rules);
    expect(alloc.map(a => a.product)).toEqual(['tour_tasting', 'wine_order']);
    const total = businessRevenue('MXN', [...alloc, ...alloc].map(a => ({ ...a, currency: 'MXN' as const })));
    expect(total.minor).toBe(3000_00);
  });
  it('out-of-order and replayed status events resolve to the latest source state', () => {
    const ev = [
      { status: 'cancelled' as const, sourceUpdatedAt: 300, receivedAt: 1, sourceEventId: 'e3' },
      { status: 'confirmed' as const, sourceUpdatedAt: 100, receivedAt: 2, sourceEventId: 'e1' },
      { status: 'confirmed' as const, sourceUpdatedAt: 100, receivedAt: 3, sourceEventId: 'e1' },
      { status: 'modified' as const, sourceUpdatedAt: 200, receivedAt: 4, sourceEventId: 'e2' },
    ];
    expect(currentStatus(ev)).toBe('cancelled');
  });
  it('realized replaces expected and a late cancellation drops the modeled value', () => {
    const base = { status: 'confirmed' as const, realizedContributionMinor: null, conditionalContributionMinor: 1000_00, attendanceProbabilityBp: 8500, forfeitedDepositMinor: 0, cancellationProbabilityBp: 1500 };
    expect(bookingValue(base)).toMatchObject({ kind: 'expected', minor: 850_00 });
    expect(bookingValue({ ...base, realizedContributionMinor: 1200_00 })).toMatchObject({ kind: 'realized', minor: 1200_00 });
    expect(bookingValue({ ...base, status: 'cancelled' })).toMatchObject({ kind: 'zero', minor: 0 });
    expect(bookingValue({ ...base, conditionalContributionMinor: null }).minor).toBeNull();
  });
  it('recent cohorts are provisional until the maturation lag passes', () => {
    expect(cohortMaturity('2026-11-10', '2026-11-14', { product: 'tour_tasting', lagDays: 21, estimatedFromData: false })).toMatchObject({ mature: false, daysRemaining: 17, lagKnown: false });
  });
});

describe('capacity (AC 7)', () => {
  const now = Date.UTC(2026, 10, 14, 12);
  const slot = (id: string, product: Slot['product'], start: number, o: Partial<Slot> = {}): Slot => ({ slotId: id, product, date: '2026-11-15', startMin: start, durationMin: 90, bufferMin: 15, requires: [], maxGuests: null, state: 'open', source: 'manual', sourceUpdatedAt: now - 60_000, ...o });
  const resources = [{ id: 'guide', kind: 'guide' as const, label: 'Guides', quantity: 1 }, { id: 'seats', kind: 'seats' as const, label: 'Restaurant seats', quantity: 40 }];
  const windows = [{ resourceId: 'guide', date: '2026-11-15', startMin: 600, endMin: 1080, quantity: 1 }, { resourceId: 'seats', date: '2026-11-15', startMin: 780, endMin: 1080, quantity: 40 }];

  it('one guide cannot run two overlapping tours', () => {
    const slots = [slot('t12', 'tour_tasting', 720, { requires: [{ resourceId: 'guide', perGuest: 0, perSlot: 1 }], maxGuests: 12 }), slot('t1230', 'tour_tasting', 750, { requires: [{ resourceId: 'guide', perGuest: 0, perSlot: 1 }], maxGuests: 12 })];
    const r = resolveCapacity({ resources, windows, slots, reservations: [{ reservationId: 'r1', slotId: 't12', guests: 4, status: 'confirmed' }], freshness: [], now });
    expect(r.find(s => s.slotId === 't12')).toMatchObject({ status: 'open', remainingGuests: 8 });
    expect(r.find(s => s.slotId === 't1230')).toMatchObject({ status: 'sold_out', sellableGuests: 0 });
  });
  it('restaurant seats turn over by duration + buffer, and products are never summed', () => {
    const slots = [slot('l13', 'restaurant_visit', 780, { requires: [{ resourceId: 'seats', perGuest: 1, perSlot: 0 }] }), slot('l14', 'restaurant_visit', 840, { requires: [{ resourceId: 'seats', perGuest: 1, perSlot: 0 }] }), slot('l15', 'restaurant_visit', 900, { requires: [{ resourceId: 'seats', perGuest: 1, perSlot: 0 }] })];
    const r = resolveCapacity({ resources, windows, slots, reservations: [{ reservationId: 'a', slotId: 'l13', guests: 30, status: 'confirmed' }], freshness: [], now });
    expect(r.find(s => s.slotId === 'l14')?.sellableGuests).toBe(10);   // overlaps 13:00 seating (13:00–14:45)
    expect(r.find(s => s.slotId === 'l15')?.sellableGuests).toBe(40);   // 13:00 seating has turned
  });
  it('unknown is never zero or unlimited, and stale capacity blocks growth', () => {
    const r = resolveCapacity({ resources, windows: [], slots: [slot('x', 'tour_tasting', 720, { requires: [{ resourceId: 'guide', perGuest: 0, perSlot: 1 }] })], reservations: [], freshness: [], now });
    expect(r[0]).toMatchObject({ status: 'unknown', sellableGuests: null });
    const stale = resolveCapacity({ resources, windows, slots: [slot('t', 'tour_tasting', 720, { requires: [{ resourceId: 'guide', perGuest: 0, perSlot: 1 }], maxGuests: 12, sourceUpdatedAt: now - 3 * 86_400_000 })], reservations: [], freshness: [{ product: 'tour_tasting', maxAgeMinutes: 24 * 60 }], now });
    const days = summarizeDays(stale);
    expect(capacitySupportsGrowth(days, ['tour_tasting'], { from: '2026-11-14', to: '2026-11-30' })).toMatchObject({ ok: false, reason: expect.stringMatching(/desactualizada/) });
    expect(capacitySupportsGrowth(days, ['restaurant_visit'], { from: '2026-11-14', to: '2026-11-30' }).ok).toBe(false);
  });
});

describe('spend exposure (AC 16)', () => {
  it('includes unreported spend and unmanaged campaigns; worst case respects overdelivery and the monthly limit', () => {
    const e = projectExposure({ monthToDateSpendMicros: 10_000e6, spendDataAgeMinutes: 120, daysRemainingInMonth: 10, managedDailyBudgetsMicros: [500e6], unmanagedDailyBudgetsMicros: [300e6], observedMaxHourlySpendMicros: 50e6, behavior: GOOGLE_ADS_DEFAULT_BEHAVIOR });
    expect(e.unreportedMicros).toBe(100e6);
    expect(e.expectedMonthMicros).toBe(10_000e6 + 100e6 + 8_000e6);
    expect(e.worstCaseMonthMicros).toBe(Math.max(e.expectedMonthMicros, Math.min(10_100e6 + 16_000e6, 800e6 * 30.4)));
  });
});

describe('schedules (AC 19)', () => {
  it('converts local schedules from UTC cron, once per logical day, across DST in a configured owner zone', () => {
    const at = (iso: string) => Date.parse(iso);
    // Mexico City has no DST: 08:00 local = 14:00 UTC.
    expect(zonedToUtc('2026-11-14', 8, 0, 'America/Mexico_City')).toBe(at('2026-11-14T14:00:00Z'));
    const before = dueJobs(at('2026-11-14T13:45:00Z'), DEFAULT_SCHEDULE).map(j => j.job);
    expect(before).not.toContain('daily_review');
    const t1 = dueJobs(at('2026-11-14T14:00:00Z'), DEFAULT_SCHEDULE).find(j => j.job === 'daily_review');
    const t2 = dueJobs(at('2026-11-14T22:15:00Z'), DEFAULT_SCHEDULE).find(j => j.job === 'daily_review');
    expect(t1?.runKey).toBe('daily_review:2026-11-14');
    expect(t2?.runKey).toBe(t1?.runKey); // retries / later ticks claim the same key → runs once
    // Weekly: Monday 08:30 local; a missed Monday catches up Tuesday with Monday's key.
    expect(dueJobs(at('2026-11-17T16:00:00Z'), DEFAULT_SCHEDULE).find(j => j.job === 'weekly_review')?.runKey).toBe('weekly_review:2026-11-16');
    // Owner in Los Angeles: DST ends 2026-11-01. 07:00 local is 14:00Z before and 15:00Z after.
    expect(zonedToUtc('2026-10-31', 7, 0, 'America/Los_Angeles')).toBe(at('2026-10-31T14:00:00Z'));
    expect(zonedToUtc('2026-11-02', 7, 0, 'America/Los_Angeles')).toBe(at('2026-11-02T15:00:00Z'));
    // Spring-forward gap (02:30 does not exist on 2026-03-08 in LA) resolves to the first valid minute after.
    expect(localParts(zonedToUtc('2026-03-08', 2, 30, 'America/Los_Angeles'), 'America/Los_Angeles').hour).toBe(3);
    // Ambiguous 01:30 on fall-back day resolves to the earlier instant (PDT).
    expect(zonedToUtc('2026-11-01', 1, 30, 'America/Los_Angeles')).toBe(at('2026-11-01T08:30:00Z'));
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
  it('notifications are off when no owner zone is configured (never the server zone)', () => {
    const jobs = dueJobs(Date.parse('2026-11-14T20:00:00Z'), DEFAULT_SCHEDULE).map(j => j.job);
    expect(jobs).not.toContain('notify_daily');
    const withTz = dueJobs(Date.parse('2026-11-14T20:00:00Z'), { ...DEFAULT_SCHEDULE, notificationTz: 'America/Los_Angeles', notifyLocal: { hour: 8, minute: 0 } });
    expect(withTz.find(j => j.job === 'notify_daily')?.runKey).toBe('notify_daily:2026-11-14');
  });
});
