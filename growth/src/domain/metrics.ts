// Deterministic metric formulas. The model never computes these; it reads them.
// Every metric carries its numerator, denominator and basis so the UI can show them in a tooltip, and is null (with a
// reason) when it cannot be computed honestly — never 0 or Infinity as a stand-in.
import { type Currency, type Micros, type Minor, microsToMinor, CurrencyMismatchError } from './money.ts';

export type Basis = 'observed' | 'attributed' | 'modeled' | 'experimental';
export type Unit = 'ratio' | 'money' | 'count' | 'percent';

export interface Metric {
  key: string;
  value: number | null;              // ratio as a plain number (2.5 = 2.5x); money in minor units; percent 0–100
  unit: Unit;
  currency?: Currency;
  numerator: { label: string; value: number | null };
  denominator?: { label: string; value: number | null };
  basis: Basis;
  provisional: boolean;
  reason?: string;                   // set whenever value is null, or to qualify a value
}

export interface SpendInput { spend: Micros | null }                // null = spend not known for the window
export interface Window { from: string; to: string; label: string }

function nullMetric(key: string, unit: Unit, num: string, den: string | undefined, basis: Basis, reason: string, provisional = false): Metric {
  return { key, value: null, unit, numerator: { label: num, value: null }, ...(den ? { denominator: { label: den, value: null } } : {}), basis, provisional, reason };
}

/** a / b with explicit zero/unknown handling. */
function ratio(key: string, numLabel: string, num: number | null, denLabel: string, den: number | null, basis: Basis, provisional: boolean, zeroDenReason: string): Metric {
  if (num === null) return nullMetric(key, 'ratio', numLabel, denLabel, basis, `${numLabel} is not available`, provisional);
  if (den === null) return nullMetric(key, 'ratio', numLabel, denLabel, basis, `${denLabel} is not available`, provisional);
  if (den === 0) return { ...nullMetric(key, 'ratio', numLabel, denLabel, basis, zeroDenReason, provisional), numerator: { label: numLabel, value: num }, denominator: { label: denLabel, value: 0 } };
  return { key, value: num / den, unit: 'ratio', numerator: { label: numLabel, value: num }, denominator: { label: denLabel, value: den }, basis, provisional };
}

function sameCurrency(a: Currency, b: Currency): void { if (a !== b) throw new CurrencyMismatchError(a, b); }

export interface AttributedTotals {
  currency: Currency;
  revenue: Minor | null;            // attributed net revenue, null if conversion data missing
  contribution: Minor | null;       // attributed contribution before marketing, null if margins unknown
  spend: Micros | null;
  completedParties: number | null;
  completedGuests: number | null;
  confirmedBookings: number | null;
  attributionMethod: string;        // disclosed method, e.g. "Google Ads data-driven, 30-day click"
  provisional: boolean;
}

export function revenueRoas(t: AttributedTotals): Metric {
  if (t.revenue && t.spend) sameCurrency(t.revenue.currency, t.spend.currency);
  const m = ratio('revenue_roas', 'Attributed net revenue', t.revenue?.minor ?? null, 'Ad spend', t.spend ? microsToMinor(t.spend).minor : null, 'attributed', t.provisional, 'No ad spend in this window');
  if (t.revenue === null) m.reason = 'Attributed revenue is not measured yet';
  else if (m.value !== null) m.reason = `Attribution: ${t.attributionMethod}`;
  return m;
}

export function contributionRoas(t: AttributedTotals): Metric {
  if (t.contribution && t.spend) sameCurrency(t.contribution.currency, t.spend.currency);
  const m = ratio('contribution_roas', 'Attributed contribution before marketing', t.contribution?.minor ?? null, 'Ad spend', t.spend ? microsToMinor(t.spend).minor : null, 'attributed', t.provisional, 'No ad spend in this window');
  if (t.contribution === null) m.reason = 'Contribution needs approved variable costs/margins for each product';
  return m;
}

export function attributedMarketingRoi(t: AttributedTotals): Metric {
  if (t.contribution === null) return nullMetric('marketing_roi', 'percent', 'Contribution − spend', 'Ad spend', 'attributed', 'Contribution needs approved variable costs/margins', t.provisional);
  if (t.spend === null) return nullMetric('marketing_roi', 'percent', 'Contribution − spend', 'Ad spend', 'attributed', 'Ad spend is not available', t.provisional);
  sameCurrency(t.contribution.currency, t.spend.currency);
  const spendMinor = microsToMinor(t.spend).minor;
  if (spendMinor === 0) return nullMetric('marketing_roi', 'percent', 'Contribution − spend', 'Ad spend', 'attributed', 'No ad spend in this window', t.provisional);
  const net = t.contribution.minor - spendMinor;
  return { key: 'marketing_roi', value: (net / spendMinor) * 100, unit: 'percent', numerator: { label: 'Attributed contribution − ad spend', value: net }, denominator: { label: 'Ad spend', value: spendMinor }, basis: 'attributed', provisional: t.provisional };
}

/** Attributed contribution after ad spend (money). Not net profit, not incremental profit. */
export function contributionAfterAds(t: AttributedTotals): Metric {
  if (t.contribution === null) return { ...nullMetric('contribution_after_ads', 'money', 'Attributed contribution', 'Ad spend', 'attributed', 'Contribution needs approved variable costs/margins', t.provisional), currency: t.currency };
  if (t.spend === null) return { ...nullMetric('contribution_after_ads', 'money', 'Attributed contribution', 'Ad spend', 'attributed', 'Ad spend is not available', t.provisional), currency: t.currency };
  sameCurrency(t.contribution.currency, t.spend.currency);
  const spendMinor = microsToMinor(t.spend).minor;
  return { key: 'contribution_after_ads', value: t.contribution.minor - spendMinor, unit: 'money', currency: t.currency, numerator: { label: 'Attributed contribution before marketing', value: t.contribution.minor }, denominator: { label: 'minus ad spend', value: spendMinor }, basis: 'attributed', provisional: t.provisional, reason: `Attribution: ${t.attributionMethod}. Not whole-business profit and not proven incremental.` };
}

function costPer(key: string, label: string, t: AttributedTotals, count: number | null): Metric {
  if (t.spend === null) return { ...nullMetric(key, 'money', 'Ad spend', label, 'attributed', 'Ad spend is not available', t.provisional), currency: t.currency };
  const spendMinor = microsToMinor(t.spend).minor;
  if (count === null) return { ...nullMetric(key, 'money', 'Ad spend', label, 'attributed', `${label} is not measured yet`, t.provisional), currency: t.currency };
  if (count === 0) return { key, value: null, unit: 'money', currency: t.currency, numerator: { label: 'Ad spend', value: spendMinor }, denominator: { label, value: 0 }, basis: 'attributed', provisional: t.provisional, reason: `No ${label.toLowerCase()} in this window` };
  return { key, value: Math.round(spendMinor / count), unit: 'money', currency: t.currency, numerator: { label: 'Ad spend', value: spendMinor }, denominator: { label, value: count }, basis: 'attributed', provisional: t.provisional };
}
export const costPerCompletedVisit = (t: AttributedTotals) => costPer('cost_per_completed_visit', 'Completed parties (attributed)', t, t.completedParties);
export const costPerCompletedGuest = (t: AttributedTotals) => costPer('cost_per_completed_guest', 'Attended guests (attributed)', t, t.completedGuests);
export const costPerConfirmedBooking = (t: AttributedTotals) => costPer('cost_per_confirmed_booking', 'Confirmed bookings (attributed)', t, t.confirmedBookings);

/** Aggregate ROAS across campaigns: sum numerators and denominators first. Never average per-campaign ROAS. */
export function aggregateRoas(rows: readonly { revenue: Minor | null; spend: Micros | null }[], currency: Currency, provisional: boolean): Metric {
  let rev = 0, sp = 0;
  for (const r of rows) {
    if (r.revenue === null || r.spend === null) return nullMetric('revenue_roas', 'ratio', 'Attributed net revenue', 'Ad spend', 'attributed', 'At least one campaign is missing revenue or spend for this window', provisional);
    sameCurrency(r.revenue.currency, currency); sameCurrency(r.spend.currency, currency);
    rev += r.revenue.minor; sp += microsToMinor(r.spend).minor;
  }
  return ratio('revenue_roas', 'Attributed net revenue', rev, 'Ad spend', sp, 'attributed', provisional, 'No ad spend in this window');
}

export interface Delta { absolute: number | null; percent: number | null; window: string; provisional: boolean; note?: string }

/** Change between two values. Percent only when the previous value is a meaningful positive denominator. */
export function delta(current: number | null, previous: number | null, window: string, provisional: boolean): Delta {
  if (current === null || previous === null) return { absolute: null, percent: null, window, provisional, note: 'Not enough data to compare' };
  const absolute = current - previous;
  if (previous <= 0) return { absolute, percent: null, window, provisional, note: previous === 0 ? 'Previous value was zero' : 'Previous value was negative; percent change is not meaningful' };
  return { absolute, percent: (absolute / previous) * 100, window, provisional };
}

/** Occupancy with an explicit denominator: reserved units / sellable units, excluding unknown and closed slots. */
export function occupancy(reserved: number, sellable: number, unknownSlots: number): Metric {
  const base = ratio('occupancy', 'Reserved seats/places', reserved, 'Sellable seats/places (known slots only)', sellable, 'observed', false, 'No sellable capacity known in this window');
  const m: Metric = { ...base, unit: 'percent', value: base.value === null ? null : base.value * 100 };
  if (unknownSlots > 0) m.reason = `${unknownSlots} slot(s) have unknown capacity and are excluded from the denominator`;
  return m;
}
