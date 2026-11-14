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
  if (num === null) return nullMetric(key, 'ratio', numLabel, denLabel, basis, `${numLabel}: no disponible`, provisional);
  if (den === null) return nullMetric(key, 'ratio', numLabel, denLabel, basis, `${denLabel}: no disponible`, provisional);
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
  const m = ratio('revenue_roas', 'Ingresos netos atribuidos', t.revenue?.minor ?? null, 'Gasto en anuncios', t.spend ? microsToMinor(t.spend).minor : null, 'attributed', t.provisional, 'No hubo gasto en anuncios en este periodo');
  if (t.revenue === null) m.reason = 'Los ingresos atribuidos todavía no se miden';
  else if (m.value !== null) m.reason = `Atribución: ${t.attributionMethod}`;
  return m;
}

export function contributionRoas(t: AttributedTotals): Metric {
  if (t.contribution && t.spend) sameCurrency(t.contribution.currency, t.spend.currency);
  const m = ratio('contribution_roas', 'Contribución atribuida antes de marketing', t.contribution?.minor ?? null, 'Gasto en anuncios', t.spend ? microsToMinor(t.spend).minor : null, 'attributed', t.provisional, 'No hubo gasto en anuncios en este periodo');
  if (t.contribution === null) m.reason = 'La contribución necesita costos variables/márgenes aprobados para cada producto';
  return m;
}

export function attributedMarketingRoi(t: AttributedTotals): Metric {
  if (t.contribution === null) return nullMetric('marketing_roi', 'percent', 'Contribución − gasto', 'Gasto en anuncios', 'attributed', 'La contribución necesita costos variables/márgenes aprobados', t.provisional);
  if (t.spend === null) return nullMetric('marketing_roi', 'percent', 'Contribución − gasto', 'Gasto en anuncios', 'attributed', 'El gasto en anuncios no está disponible', t.provisional);
  sameCurrency(t.contribution.currency, t.spend.currency);
  const spendMinor = microsToMinor(t.spend).minor;
  if (spendMinor === 0) return nullMetric('marketing_roi', 'percent', 'Contribución − gasto', 'Gasto en anuncios', 'attributed', 'No hubo gasto en anuncios en este periodo', t.provisional);
  const net = t.contribution.minor - spendMinor;
  return { key: 'marketing_roi', value: (net / spendMinor) * 100, unit: 'percent', numerator: { label: 'Contribución atribuida − gasto en anuncios', value: net }, denominator: { label: 'Gasto en anuncios', value: spendMinor }, basis: 'attributed', provisional: t.provisional };
}

/** Attributed contribution after ad spend (money). Not net profit, not incremental profit. */
export function contributionAfterAds(t: AttributedTotals): Metric {
  if (t.contribution === null) return { ...nullMetric('contribution_after_ads', 'money', 'Contribución atribuida', 'Gasto en anuncios', 'attributed', 'La contribución necesita costos variables/márgenes aprobados', t.provisional), currency: t.currency };
  if (t.spend === null) return { ...nullMetric('contribution_after_ads', 'money', 'Contribución atribuida', 'Gasto en anuncios', 'attributed', 'El gasto en anuncios no está disponible', t.provisional), currency: t.currency };
  sameCurrency(t.contribution.currency, t.spend.currency);
  const spendMinor = microsToMinor(t.spend).minor;
  return { key: 'contribution_after_ads', value: t.contribution.minor - spendMinor, unit: 'money', currency: t.currency, numerator: { label: 'Contribución atribuida antes de marketing', value: t.contribution.minor }, denominator: { label: 'menos gasto en anuncios', value: spendMinor }, basis: 'attributed', provisional: t.provisional, reason: `Atribución: ${t.attributionMethod}. No es la utilidad de todo el negocio ni está probado que sea incremental.` };
}

function costPer(key: string, label: string, t: AttributedTotals, count: number | null): Metric {
  if (t.spend === null) return { ...nullMetric(key, 'money', 'Gasto en anuncios', label, 'attributed', 'El gasto en anuncios no está disponible', t.provisional), currency: t.currency };
  const spendMinor = microsToMinor(t.spend).minor;
  if (count === null) return { ...nullMetric(key, 'money', 'Gasto en anuncios', label, 'attributed', `${label}: todavía no se mide`, t.provisional), currency: t.currency };
  if (count === 0) return { key, value: null, unit: 'money', currency: t.currency, numerator: { label: 'Gasto en anuncios', value: spendMinor }, denominator: { label, value: 0 }, basis: 'attributed', provisional: t.provisional, reason: `Sin ${label.toLowerCase()} en este periodo` };
  return { key, value: Math.round(spendMinor / count), unit: 'money', currency: t.currency, numerator: { label: 'Gasto en anuncios', value: spendMinor }, denominator: { label, value: count }, basis: 'attributed', provisional: t.provisional };
}
export const costPerCompletedVisit = (t: AttributedTotals) => costPer('cost_per_completed_visit', 'Grupos atendidos (atribuidos)', t, t.completedParties);
export const costPerCompletedGuest = (t: AttributedTotals) => costPer('cost_per_completed_guest', 'Comensales atendidos (atribuidos)', t, t.completedGuests);
export const costPerConfirmedBooking = (t: AttributedTotals) => costPer('cost_per_confirmed_booking', 'Reservaciones confirmadas (atribuidas)', t, t.confirmedBookings);

/** Aggregate ROAS across campaigns: sum numerators and denominators first. Never average per-campaign ROAS. */
export function aggregateRoas(rows: readonly { revenue: Minor | null; spend: Micros | null }[], currency: Currency, provisional: boolean): Metric {
  let rev = 0, sp = 0;
  for (const r of rows) {
    if (r.revenue === null || r.spend === null) return nullMetric('revenue_roas', 'ratio', 'Ingresos netos atribuidos', 'Gasto en anuncios', 'attributed', 'Al menos a una campaña le faltan ingresos o gasto en este periodo', provisional);
    sameCurrency(r.revenue.currency, currency); sameCurrency(r.spend.currency, currency);
    rev += r.revenue.minor; sp += microsToMinor(r.spend).minor;
  }
  return ratio('revenue_roas', 'Ingresos netos atribuidos', rev, 'Gasto en anuncios', sp, 'attributed', provisional, 'No hubo gasto en anuncios en este periodo');
}

export interface Delta { absolute: number | null; percent: number | null; window: string; provisional: boolean; note?: string }

/** Change between two values. Percent only when the previous value is a meaningful positive denominator. */
export function delta(current: number | null, previous: number | null, window: string, provisional: boolean): Delta {
  if (current === null || previous === null) return { absolute: null, percent: null, window, provisional, note: 'No hay suficientes datos para comparar' };
  const absolute = current - previous;
  if (previous <= 0) return { absolute, percent: null, window, provisional, note: previous === 0 ? 'El valor anterior fue cero' : 'El valor anterior fue negativo; el cambio porcentual no tiene sentido' };
  return { absolute, percent: (absolute / previous) * 100, window, provisional };
}

/** Occupancy with an explicit denominator: reserved units / sellable units, excluding unknown and closed slots. */
export function occupancy(reserved: number, sellable: number, unknownSlots: number): Metric {
  const base = ratio('occupancy', 'Lugares reservados', reserved, 'Lugares vendibles (solo horarios conocidos)', sellable, 'observed', false, 'No se conoce capacidad vendible en este periodo');
  const m: Metric = { ...base, unit: 'percent', value: base.value === null ? null : base.value * 100 };
  if (unknownSlots > 0) m.reason = `${unknownSlots} horario(s) tienen capacidad desconocida y no se cuentan en el denominador`;
  return m;
}
