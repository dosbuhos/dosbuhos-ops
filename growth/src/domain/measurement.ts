// Revenue, contribution, booking lifecycle and allocation rules. Pure functions, tested.
import { type Currency, type Minor, minor, CurrencyMismatchError } from './money.ts';
import { daysBetween, type LocalDate } from './time.ts';

export const PRODUCTS = ['restaurant_visit', 'tour_tasting', 'wine_order', 'private_event'] as const;
export type Product = (typeof PRODUCTS)[number];

// ---------- net revenue and contribution ----------

export interface TransactionLine {
  lineId: string;
  product: Product;
  grossMinor: number;          // as charged, including what the source rules say to exclude
  taxMinor: number;
  tipMinor: number;
  passThroughMinor: number;    // e.g. third-party fees collected on someone else's behalf
  refundedMinor: number;
  commissionMinor: number;     // booking/payment commission, if the source revenue is NOT already net of it
}
export interface Transaction { transactionId: string; currency: Currency; paid: boolean; isRefundableDeposit: boolean; lines: TransactionLine[] }

export interface SourceAccountingRules {
  revenueIncludesTax: boolean;
  revenueIncludesTips: boolean;
  revenueIsNetOfCommission: boolean;   // if true, commission must not be subtracted again
}

/** Net revenue for one line: collected sales net of refunds and the configured exclusions. Unpaid → 0 recognized.
 *  A refundable deposit is not earned revenue until the source says it was applied/forfeited. */
export function netRevenueLine(t: Transaction, l: TransactionLine, rules: SourceAccountingRules): number {
  if (!t.paid || t.isRefundableDeposit) return 0;
  let net = l.grossMinor - l.refundedMinor - l.passThroughMinor;
  if (rules.revenueIncludesTax) net -= l.taxMinor;
  if (rules.revenueIncludesTips) net -= l.tipMinor;
  return net;
}

export interface CostAssumption {
  product: Product;
  effectiveFrom: LocalDate;
  effectiveTo: LocalDate | null;
  variableCostPctBp: number | null;     // basis points of net revenue (3000 = 30%)
  variableCostPerGuestMinor: number | null;
  status: 'estimated' | 'actual';
  approvedBy: string | null;            // null = not approved → contribution unknown
}

export function assumptionFor(list: readonly CostAssumption[], product: Product, date: LocalDate): CostAssumption | null {
  const hits = list.filter(a => a.product === product && a.approvedBy && a.effectiveFrom <= date && (a.effectiveTo === null || date <= a.effectiveTo));
  hits.sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1));
  return hits[0] ?? null;
}

/** Contribution before marketing for a line. null when no approved cost assumption exists. */
export function contributionLine(t: Transaction, l: TransactionLine, rules: SourceAccountingRules, guests: number, a: CostAssumption | null): number | null {
  if (!a) return null;
  const net = netRevenueLine(t, l, rules);
  if (net === 0 && (!t.paid || t.isRefundableDeposit)) return 0;
  let cost = 0;
  if (a.variableCostPctBp !== null) cost += Math.round((net * a.variableCostPctBp) / 10_000);
  if (a.variableCostPerGuestMinor !== null) cost += a.variableCostPerGuestMinor * guests;
  if (!rules.revenueIsNetOfCommission) cost += l.commissionMinor;
  return net - cost;
}

// ---------- booking lifecycle ----------

export const BOOKING_STATUSES = ['confirmed', 'modified', 'cancelled', 'attended', 'no_show', 'refunded'] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];
export interface StatusEvent { status: BookingStatus; sourceUpdatedAt: number; receivedAt: number; sourceEventId: string }

/** Current status from possibly out-of-order, duplicated events: the latest source timestamp wins; ties go to the
 *  later-received event; duplicate sourceEventIds are ignored. */
export function currentStatus(events: readonly StatusEvent[]): BookingStatus | null {
  const seen = new Set<string>();
  let best: StatusEvent | null = null;
  for (const e of events) {
    if (seen.has(e.sourceEventId)) continue;
    seen.add(e.sourceEventId);
    if (!best || e.sourceUpdatedAt > best.sourceUpdatedAt || (e.sourceUpdatedAt === best.sourceUpdatedAt && e.receivedAt > best.receivedAt)) best = e;
  }
  return best?.status ?? null;
}

/** Should an incoming source record replace the stored one? Only when it is newer at the source. */
export const isNewerVersion = (incomingSourceUpdatedAt: number, storedSourceUpdatedAt: number | null) =>
  storedSourceUpdatedAt === null || incomingSourceUpdatedAt > storedSourceUpdatedAt;

// ---------- expected vs realized ----------

export interface BookingValueInput {
  status: BookingStatus;
  realizedContributionMinor: number | null;   // set once the visit/sale happened and is matched
  conditionalContributionMinor: number | null; // modeled contribution if attended
  attendanceProbabilityBp: number | null;     // basis points
  forfeitedDepositMinor: number;              // contribution if cancelled late with a kept deposit
  cancellationProbabilityBp: number | null;
}
export interface BookingValue { kind: 'realized' | 'expected' | 'unknown' | 'zero'; minor: number | null; note: string }

/** Realized replaces expected; never both. Cancelled/no-show bookings carry only the kept deposit (if any). */
export function bookingValue(b: BookingValueInput): BookingValue {
  if (b.realizedContributionMinor !== null) return { kind: 'realized', minor: b.realizedContributionMinor, note: 'Matched to a completed sale' };
  if (b.status === 'cancelled' || b.status === 'no_show' || b.status === 'refunded') return { kind: 'zero', minor: b.forfeitedDepositMinor, note: b.forfeitedDepositMinor ? 'Kept deposit only' : 'No value' };
  if (b.status === 'attended') return { kind: 'unknown', minor: null, note: 'Attended but not yet matched to a sale' };
  if (b.conditionalContributionMinor === null || b.attendanceProbabilityBp === null) return { kind: 'unknown', minor: null, note: 'No approved contribution model for this product' };
  const pAttend = b.attendanceProbabilityBp, pCancel = b.cancellationProbabilityBp ?? 0;
  if (pAttend + pCancel > 10_000) throw new RangeError('Attendance + cancellation probability exceeds 100%');
  const v = Math.round((pAttend * b.conditionalContributionMinor + pCancel * b.forfeitedDepositMinor) / 10_000);
  return { kind: 'expected', minor: v, note: `Modeled: ${pAttend / 100}% attendance × contribution if attended` };
}

// ---------- cross-sell allocation ----------

export interface Allocation { transactionId: string; lineId: string; bookingId: string | null; product: Product; minor: number }

/** Allocate each transaction line exactly once. A tasting visit with a wine purchase yields two product components;
 *  the visit total is their sum and is never counted again as a separate amount. */
export function allocateTransaction(t: Transaction, bookingId: string | null, rules: SourceAccountingRules): Allocation[] {
  const seen = new Set<string>();
  const out: Allocation[] = [];
  for (const l of t.lines) {
    if (seen.has(l.lineId)) continue; // duplicated line in a re-import
    seen.add(l.lineId);
    out.push({ transactionId: t.transactionId, lineId: l.lineId, bookingId, product: l.product, minor: netRevenueLine(t, l, rules) });
  }
  return out;
}

/** Sum allocations into a business total, deduplicated by (transactionId, lineId). */
export function businessRevenue(currency: Currency, allocations: readonly (Allocation & { currency: Currency })[]): Minor {
  const seen = new Set<string>();
  let total = 0;
  for (const a of allocations) {
    if (a.currency !== currency) throw new CurrencyMismatchError(a.currency, currency);
    const k = `${a.transactionId}|${a.lineId}`;
    if (seen.has(k)) continue;
    seen.add(k); total += a.minor;
  }
  return minor(currency, total);
}

// ---------- cohort maturity ----------

/** An acquisition cohort is mature when its last day is at least lagDays before the data cutoff. Until the lag has
 *  been estimated from data, the conservative provisional window is used and profitability scaling stays blocked. */
export interface MaturityRule { product: Product; lagDays: number; estimatedFromData: boolean }
export function cohortMaturity(cohortEnd: LocalDate, cutoff: LocalDate, rule: MaturityRule): { mature: boolean; daysRemaining: number; lagKnown: boolean } {
  const age = daysBetween(cohortEnd, cutoff);
  return { mature: age >= rule.lagDays, daysRemaining: Math.max(0, rule.lagDays - age), lagKnown: rule.estimatedFromData };
}

/** Lag estimate: the 90th percentile of (service date − booking-creation date), in days, given enough samples. */
export function estimateLagDays(samples: readonly number[], minSamples = 40): number | null {
  if (samples.length < minSamples) return null;
  const s = [...samples].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(0.9 * s.length) - 1)]!;
}
