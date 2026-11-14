// Deterministic facts for the dashboard and reports, computed from D1. All numbers the UI and reports show come from
// here. Attribution is disclosed: in Phase 1 a booking counts as ad-attributed only when the booking system's own
// source field says Google Ads paid search. Without that, channel is "unknown" — never inferred from timestamps.
import { addDays, dateRange, localDate, weekdayOf, type LocalDate } from '../domain/time.ts';
import { minor, micros, microsToMinor } from '../domain/money.ts';
import { revenueRoas, contributionAfterAds, contributionRoas, costPerCompletedVisit, costPerConfirmedBooking, delta, occupancy, type AttributedTotals, type Metric, type Delta } from '../domain/metrics.ts';
import { assumptionFor, bookingValue, type CostAssumption, type Product, PRODUCTS } from '../domain/measurement.ts';
import { isGoogleAds, isMetaAds, RESERVATION_EVENT, FUNNEL } from '../connectors/ga4.ts';
import { resolveCapacity, summarizeDays, type Slot, type Reservation, type DayProductSummary } from '../domain/capacity.ts';

export const ATTRIBUTION_METHOD = 'Booking system source field = Google Ads paid search (last touch as reported by OpenTable); click date approximated by booking date';
const PAID = /google.*(cpc|paid|ads)|adwords|gclid/i;

export interface DayPoint { date: LocalDate; value: number | null; provisional: boolean }
export interface Ticker { key: string; label: string; metric: Metric; delta: Delta; spark: DayPoint[]; window: string }
export interface Series { key: string; label: string; unit: 'money' | 'count' | 'ratio' | 'percent'; view: 'acquisition' | 'service' | 'forward'; points: DayPoint[]; trend7: (number | null)[]; trend28: (number | null)[]; available: boolean; missing?: string }
export interface ActionMarker { actionId: string; date: LocalDate; label: string; state: string; actor: string }

interface BookingRow { id: string; product: Product; created_at_utc: number; service_at_utc: number; service_date: string; party_size: number; status: string; channel: string; currency: string; quoted_minor: number | null; paid_minor: number | null }
interface DailyRow { date: string; provider: string; campaign_id: string; cost_micros: number; clicks: number; impressions: number; platform_conversions_milli: number | null; platform_conversion_value_micros: number | null }

export interface FactsInput { db: D1Database; now: number; wineryTz: string; currency: 'MXN' | 'USD'; days?: number }

export async function loadRaw(i: FactsInput) {
  const days = i.days ?? 120;
  const today = localDate(i.now, i.wineryTz);
  const from = addDays(today, -days);
  const [bookings, daily, campaigns, costs, products, settings, spend, slots, windows, resources, connections, alerts, jobs, actions] = await Promise.all([
    i.db.prepare('SELECT id, product, created_at_utc, service_at_utc, service_date, party_size, status, channel, currency, quoted_minor, paid_minor FROM bookings WHERE service_date >= ? OR created_at_utc >= ?').bind(from, i.now - days * 864e5).all<BookingRow>(),
    i.db.prepare('SELECT d.date, a.provider, d.campaign_id, d.cost_micros, d.clicks, d.impressions, d.platform_conversions_milli, d.platform_conversion_value_micros FROM campaign_daily d JOIN ad_accounts a ON a.id = d.account_id WHERE d.date >= ?').bind(from).all<DailyRow>(),
    i.db.prepare("SELECT ref, external_id, name, status, channel, products_json, brand, language, booking_horizon_days, budget_id, budget_shared, budget_micros, writable, managed_by, optimization_signal, updated_at FROM campaign_registry WHERE kind = 'campaign'").all<Record<string, unknown>>(),
    i.db.prepare('SELECT product, effective_from, effective_to, variable_cost_pct_bp, variable_cost_per_guest_minor, status, approved_by FROM cost_assumptions').all<Record<string, unknown>>(),
    i.db.prepare('SELECT id, label, maturation_lag_days, lag_estimated_from_data, capacity_max_age_minutes FROM products').all<{ id: Product; label: string; maturation_lag_days: number; lag_estimated_from_data: number; capacity_max_age_minutes: number }>(),
    i.db.prepare('SELECT * FROM business_settings WHERE id = 1').first<Record<string, unknown>>(),
    i.db.prepare('SELECT * FROM spend_readings ORDER BY read_at DESC LIMIT 1').first<Record<string, number | string>>(),
    i.db.prepare('SELECT * FROM capacity_slots WHERE date >= ? AND date <= ?').bind(today, addDays(today, 31)).all<Record<string, unknown>>(),
    i.db.prepare('SELECT * FROM capacity_resource_windows WHERE date >= ? AND date <= ?').bind(today, addDays(today, 31)).all<Record<string, unknown>>(),
    i.db.prepare('SELECT * FROM capacity_resources').all<Record<string, unknown>>(),
    i.db.prepare('SELECT id, provider, purpose, health, health_reason, scopes_json, last_success_at, last_error, freshness_at, updated_at FROM connections ORDER BY provider').all<Record<string, unknown>>(),
    i.db.prepare('SELECT * FROM alerts WHERE resolved_at IS NULL ORDER BY CASE severity WHEN \'critical\' THEN 0 WHEN \'warning\' THEN 1 ELSE 2 END, opened_at DESC LIMIT 50').all<Record<string, unknown>>(),
    i.db.prepare('SELECT run_key, job, status, detail, started_at, finished_at FROM job_runs ORDER BY started_at DESC LIMIT 40').all<Record<string, unknown>>(),
    i.db.prepare('SELECT * FROM action_ledger_projection WHERE at >= ? ORDER BY at').bind(i.now - days * 864e5).all<Record<string, unknown>>(),
  ]);
  // Online reservations from GA4 (OpenTable widget event). Daily aggregates by session source / medium / campaign.
  const ga4 = (await i.db.prepare('SELECT date, event_name, source, medium, campaign, events FROM ga4_reservations_daily WHERE date >= ?').bind(from).all<{ date: string; event_name: string; source: string; medium: string; campaign: string; events: number }>().catch(() => ({ results: [] as { date: string; event_name: string; source: string; medium: string; campaign: string; events: number }[] }))).results;
  const otAvailability = (await i.db.prepare('SELECT date, product, item, party_size, slots, error, checked_at FROM ot_availability WHERE date >= ? ORDER BY date').bind(today).all<{ date: string; product: string; item: string; party_size: number; slots: number | null; error: string | null; checked_at: number }>().catch(() => ({ results: [] as { date: string; product: string; item: string; party_size: number; slots: number | null; error: string | null; checked_at: number }[] }))).results;
  return { today, from, ga4, otAvailability, bookings: bookings.results, daily: daily.results, campaigns: campaigns.results, costs: costs.results, products: products.results, settings, spend, slots: slots.results, windows: windows.results, resources: resources.results, connections: connections.results, alerts: alerts.results, jobs: jobs.results, actions: actions.results };
}
export type Raw = Awaited<ReturnType<typeof loadRaw>>;

const toAssumptions = (rows: Record<string, unknown>[]): CostAssumption[] => rows.map(r => ({
  product: r.product as Product, effectiveFrom: String(r.effective_from), effectiveTo: (r.effective_to as string | null) ?? null,
  variableCostPctBp: (r.variable_cost_pct_bp as number | null) ?? null, variableCostPerGuestMinor: (r.variable_cost_per_guest_minor as number | null) ?? null,
  status: r.status as 'estimated' | 'actual', approvedBy: (r.approved_by as string | null) ?? null,
}));

const isPaid = (b: BookingRow) => PAID.test(b.channel);
const isConfirmedish = (s: string) => s !== 'cancelled';

/** Historical attendance rate for past service dates, by product (needs ≥ 30 settled bookings). */
function attendanceRates(bookings: BookingRow[], today: LocalDate): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const p of PRODUCTS) {
    const settled = bookings.filter(b => b.product === p && b.service_date < today && ['attended', 'no_show', 'cancelled'].includes(b.status));
    out[p] = settled.length >= 30 ? Math.round((settled.filter(b => b.status === 'attended').length / settled.length) * 10_000) : null;
  }
  return out;
}

/** Contribution (minor) of one booking: realized when attended and paid, else modeled, never both. null = unknown. */
/** Average paid net revenue per guest for completed visits, by product (needs ≥ 30 matched visits). Used only to
 *  model the value of future bookings that carry no quoted price; replaced by the realized value once it happens. */
function netPerGuest(bookings: BookingRow[]): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const p of PRODUCTS) {
    const done = bookings.filter(b => b.product === p && b.status === 'attended' && b.paid_minor !== null);
    const guests = done.reduce((a, b) => a + b.party_size, 0);
    out[p] = done.length >= 30 && guests > 0 ? Math.round(done.reduce((a, b) => a + (b.paid_minor ?? 0), 0) / guests) : null;
  }
  return out;
}

function bookingContribution(b: BookingRow, assumptions: CostAssumption[], rates: Record<string, number | null>, today: LocalDate, perGuest: Record<string, number | null> = {}): { value: number | null; realized: boolean } {
  const a = assumptionFor(assumptions, b.product, b.service_date);
  if (!a) return { value: null, realized: false };
  const contrib = (net: number) => net - Math.round((net * (a.variableCostPctBp ?? 0)) / 10_000) - (a.variableCostPerGuestMinor ?? 0) * b.party_size;
  const realized = b.status === 'attended' && b.paid_minor !== null ? contrib(b.paid_minor) : null;
  // Past bookings still "confirmed" (no update from the source) and attended visits with no matched payment are
  // modeled as attended at the conditional contribution; a matched payment replaces the model.
  const attendedUnmatched = realized === null && (b.status === 'attended' || (b.status === 'confirmed' && b.service_date < today));
  const conditional = b.quoted_minor !== null ? contrib(b.quoted_minor) : perGuest[b.product] != null ? contrib(perGuest[b.product]! * b.party_size) : null;
  const v = bookingValue({
    status: (attendedUnmatched ? 'confirmed' : b.status) as never, realizedContributionMinor: realized, conditionalContributionMinor: conditional,
    attendanceProbabilityBp: attendedUnmatched ? 10_000 : rates[b.product] ?? null, forfeitedDepositMinor: 0, cancellationProbabilityBp: null,
  });
  return { value: v.minor, realized: v.kind === 'realized' };
}

const sumOrNull = (xs: (number | null)[]) => (xs.some(x => x === null) ? null : xs.reduce<number>((a, b) => a + (b ?? 0), 0));
const trailing = (vals: (number | null)[], n: number) => vals.map((_, i) => { if (i < n - 1) return null; const w = vals.slice(i - n + 1, i + 1); return w.some(v => v === null) ? null : w.reduce<number>((a, b) => a + (b ?? 0), 0) / n; });

export function computeOverview(raw: Raw, now: number, wineryTz: string, currency: 'MXN' | 'USD') {
  const today = raw.today;
  const assumptions = toAssumptions(raw.costs);
  const rates = attendanceRates(raw.bookings, today);
  const perGuest = netPerGuest(raw.bookings);
  const bcCache = new Map<string, { value: number | null; realized: boolean }>();
  const bc = (b: BookingRow) => { let v = bcCache.get(b.id); if (!v) { v = bookingContribution(b, assumptions, rates, today, perGuest); bcCache.set(b.id, v); } return v; };
  const lagByProduct = Object.fromEntries(raw.products.map(p => [p.id, p.maturation_lag_days]));
  const lagKnown = raw.products.filter(p => p.id === 'restaurant_visit' || p.id === 'tour_tasting').every(p => p.lag_estimated_from_data === 1);
  const maxLag = Math.max(...raw.products.filter(p => p.id === 'restaurant_visit' || p.id === 'tour_tasting').map(p => p.maturation_lag_days), 0);
  const end = addDays(today, -1); // last complete day
  const days = dateRange(addDays(end, -55), end);
  const cur = days.slice(-28), prev = days.slice(0, 28);
  const isProvisional = (d: LocalDate) => addDays(d, maxLag) > today;
  const dataKind = String(raw.settings?.data_kind ?? 'unknown');

  // ---- per-day aggregates ----
  // Google Ads drives every "ad spend / Google" figure; Meta is kept separate, never summed into Google metrics.
  const google = raw.daily.filter(r => r.provider !== 'meta_ads'), metaRows = raw.daily.filter(r => r.provider === 'meta_ads');
  const metaSpendBy = new Map<string, number>();
  for (const r of metaRows) metaSpendBy.set(r.date, (metaSpendBy.get(r.date) ?? 0) + r.cost_micros);
  const metaDays = new Set(metaRows.map(r => r.date));
  const metaMinorOn = (d: LocalDate): number | null => (metaDays.has(d) ? microsToMinor(micros(currency, metaSpendBy.get(d) ?? 0)).minor : null);
  const spendBy = new Map<string, number>(), convBy = new Map<string, number | null>();
  for (const r of google) {
    spendBy.set(r.date, (spendBy.get(r.date) ?? 0) + r.cost_micros);
    const c = convBy.get(r.date);
    convBy.set(r.date, r.platform_conversions_milli === null || c === null ? null : (c ?? 0) + r.platform_conversions_milli);
  }
  const spendDays = new Set(google.map(r => r.date));
  // Index once: formatting a local date per booking per day was the hot path.
  const byCreated = new Map<string, BookingRow[]>(), byService = new Map<string, BookingRow[]>();
  for (const b of raw.bookings) {
    const cd = localDate(b.created_at_utc, wineryTz);
    if (isConfirmedish(b.status)) (byCreated.get(cd) ?? byCreated.set(cd, []).get(cd)!).push(b);
    if (b.status === 'attended') (byService.get(b.service_date) ?? byService.set(b.service_date, []).get(b.service_date)!).push(b);
  }
  const bookingsCreated = (d: LocalDate) => byCreated.get(d) ?? [];
  const paidByDay = new Map<string, BookingRow[]>();
  const paidCreated = (d: LocalDate) => { let x = paidByDay.get(d); if (!x) { x = bookingsCreated(d).filter(isPaid); paidByDay.set(d, x); } return x; };
  const attendedOn = (d: LocalDate) => byService.get(d) ?? [];
  const contribCache = new Map<string, number | null>();

  const contributionOn = (d: LocalDate): number | null => { if (!contribCache.has(d)) contribCache.set(d, sumOrNull(paidCreated(d).map(b => bc(b).value))); return contribCache.get(d)!; };
  const revenueOn = (d: LocalDate): number => paidCreated(d).filter(b => b.status === 'attended').reduce((a, b) => a + (b.paid_minor ?? 0), 0);
  const spendMinorOn = (d: LocalDate): number | null => (spendDays.has(d) ? microsToMinor(micros(currency, spendBy.get(d) ?? 0)).minor : null);

  const series: Series[] = [];
  const mk = (key: string, label: string, unit: Series['unit'], view: Series['view'], f: (d: LocalDate) => number | null, provisionalAware = true, missing?: string): Series => {
    const pts = days.map(d => ({ date: d, value: missing ? null : f(d), provisional: provisionalAware && view === 'acquisition' ? isProvisional(d) : false }));
    const vals = pts.map(p => p.value);
    return { key, label, unit, view, points: pts, trend7: trailing(vals, 7), trend28: trailing(vals, 28), available: !missing && vals.some(v => v !== null), ...(missing ? { missing } : {}) };
  };
  // With no booking source at all, every booking-derived number is unknown — never zero.
  const noBookings = raw.bookings.length === 0;
  const NB = 'No booking source connected yet (OpenTable reservation data is partner-only; requested through the account manager)';
  // GA4 online reservations: used for booking counts only while no booking-level source exists.
  const ga4All = new Map<string, number>(), ga4Ads = new Map<string, number>(), ga4Meta = new Map<string, number>();
  const ga4Days = new Set(raw.ga4.map(r => r.date)); // days GA4 recorded any booking-flow event: a day with none is a GA4 gap, not zero bookings
  for (const r of raw.ga4) {
    if (r.event_name !== RESERVATION_EVENT) continue;
    ga4All.set(r.date, (ga4All.get(r.date) ?? 0) + r.events);
    if (isGoogleAds(r.source, r.medium)) ga4Ads.set(r.date, (ga4Ads.get(r.date) ?? 0) + r.events);
    if (isMetaAds(r.source, r.medium)) ga4Meta.set(r.date, (ga4Meta.get(r.date) ?? 0) + r.events);
  }
  const haveGa4 = noBookings && raw.ga4.length > 0;
  const firstGa4 = raw.ga4.filter(r => r.event_name === RESERVATION_EVENT).map(r => r.date).sort()[0] ?? null; // tracking start
  const ga4On = (m: Map<string, number>, d: LocalDate): number | null => (firstGa4 !== null && d >= firstGa4 && ga4Days.has(d) ? m.get(d) ?? 0 : null);
  /** Sum over the days GA4 recorded; gap days are excluded and listed. More than 7 missing days → unknown. */
  const ga4Sum = (m: Map<string, number>, ds: LocalDate[]) => {
    const known = ds.filter(d => ga4On(m, d) !== null);
    const before = ds.filter(d => firstGa4 === null || d < firstGa4);         // tracking had not started
    const excluded = ds.filter(d => firstGa4 !== null && d >= firstGa4 && ga4On(m, d) === null); // GA4 gaps after start
    const value = excluded.length > 7 || known.length === 0 || before.length === ds.length ? null : known.reduce((a, d) => a + (m.get(d) ?? 0), 0);
    return { value, known, excluded, before, partial: before.length > 0 };
  };
  const GA4_NOTE = 'Online reservations made through the OpenTable widget, counted by GA4 (event ot-reservation-made) on the day they were made. Phone and walk-in bookings are not included; later cancellations are not removed.';
  const contribMissing = noBookings ? NB : assumptions.some(a => a.approvedBy) ? undefined : 'Approved variable costs or margins per product are missing, so contribution cannot be measured';
  series.push(mk('contribution_after_ads', 'Attributed contribution after ad spend', 'money', 'acquisition', d => { const c = contributionOn(d), s = spendMinorOn(d); return c === null || s === null ? null : c - s; }, true, contribMissing));
  series.push(mk('confirmed_bookings', 'Confirmed bookings (all channels)', 'count', 'acquisition', d => bookingsCreated(d).length, false, noBookings ? NB : undefined));
  series.push(mk('online_reservations', 'Online reservations (OpenTable via GA4)', 'count', 'acquisition', d => ga4On(ga4All, d), false, raw.ga4.length ? undefined : 'GA4 is not connected yet. Set it up in Connections → “OpenTable online reservations (via Google Analytics)”.'));
  series.push(mk('online_reservations_google_ads', 'Online reservations from Google Ads (GA4)', 'count', 'acquisition', d => ga4On(ga4Ads, d), false, raw.ga4.length ? undefined : 'GA4 is not connected yet. Set it up in Connections → “OpenTable online reservations (via Google Analytics)”.'));
  series.push(mk('completed_guests', 'Completed guests (all channels)', 'count', 'service', d => (d <= end ? attendedOn(d).reduce((a, b) => a + b.party_size, 0) : null), true, noBookings ? NB : undefined));
  series.push(mk('revenue', 'Attributed net revenue (completed, paid)', 'money', 'acquisition', d => revenueOn(d), true, noBookings ? NB : undefined));
  series.push(mk('ad_spend', 'Ad spend (Google)', 'money', 'acquisition', spendMinorOn, false));
  series.push(mk('meta_spend', 'Ad spend (Meta)', 'money', 'acquisition', metaMinorOn, false, metaRows.length ? undefined : 'Meta Ads is not connected'));
  series.push(mk('platform_conversions', 'Google Ads conversions (as Google counts them)', 'count', 'acquisition', d => { if (!spendDays.has(d)) return null; const c = convBy.get(d); return c === null || c === undefined ? null : c / 1000; }, false));
  series.push(mk('contribution_roas', 'Contribution ROAS', 'ratio', 'acquisition', d => { const c = contributionOn(d), s = spendMinorOn(d); return c === null || !s ? null : c / s; }, true, contribMissing));

  // ---- 28-day totals and tickers ----
  const totalsFor = (ds: LocalDate[]): AttributedTotals => {
    const paid = ds.flatMap(paidCreated);
    const spendKnown = ds.every(d => spendDays.has(d));
    const contribs = paid.map(b => bc(b).value);
    if (noBookings) return { currency, attributionMethod: ATTRIBUTION_METHOD, provisional: false, revenue: null, contribution: null, spend: spendKnown ? micros(currency, ds.reduce((a, d) => a + (spendBy.get(d) ?? 0), 0)) : null, completedParties: null, completedGuests: null, confirmedBookings: null };
    return {
      currency, attributionMethod: ATTRIBUTION_METHOD, provisional: ds.some(isProvisional),
      revenue: minor(currency, paid.filter(b => b.status === 'attended').reduce((a, b) => a + (b.paid_minor ?? 0), 0)),
      contribution: contribMissing ? null : (contribs.some(c => c === null) ? null : minor(currency, contribs.reduce<number>((a, b) => a + (b ?? 0), 0))),
      spend: spendKnown ? micros(currency, ds.reduce((a, d) => a + (spendBy.get(d) ?? 0), 0)) : null,
      completedParties: paid.filter(b => b.status === 'attended').length,
      completedGuests: paid.filter(b => b.status === 'attended').reduce((a, b) => a + b.party_size, 0),
      confirmedBookings: paid.length,
    };
  };
  const tCur = totalsFor(cur), tPrev = totalsFor(prev);
  const w = `last 28 days (${cur[0]} – ${cur[27]}) vs previous 28`;
  const sparkOf = (key: string) => series.find(s => s.key === key)!.points.slice(-28);
  const countMetric = (key: string, label: string, v: number, basis: Metric['basis'], provisional: boolean, reason?: string): Metric => ({ key, value: v, unit: 'count', numerator: { label, value: v }, basis, provisional, ...(reason ? { reason } : {}) });

  const guestsCur = cur.reduce((a, d) => a + attendedOn(d).reduce((x, b) => x + b.party_size, 0), 0);
  const guestsPrev = prev.reduce((a, d) => a + attendedOn(d).reduce((x, b) => x + b.party_size, 0), 0);
  const bookCur = cur.reduce((a, d) => a + bookingsCreated(d).length, 0), bookPrev = prev.reduce((a, d) => a + bookingsCreated(d).length, 0);

  const cap = computeCapacity(raw, now, today);
  const fwd = cap.days.filter(d => d.date >= today && d.date < addDays(today, 14) && (d.product === 'restaurant_visit' || d.product === 'tour_tasting'));
  const occ = occupancy(fwd.reduce((a, d) => a + d.reserved, 0), fwd.reduce((a, d) => a + d.sellable, 0), fwd.reduce((a, d) => a + d.unknownSlots, 0));
  const caOff = contributionAfterAds(tCur), caPrev = contributionAfterAds(tPrev);
  const rCur = revenueRoas(tCur), rPrev = revenueRoas(tPrev);

  const unknownCount = (key: string, label: string): Metric => ({ key, value: null, unit: 'count', numerator: { label, value: null }, basis: 'observed', provisional: false, reason: NB });
  const spendCur = cur.every(d => spendDays.has(d)) ? cur.reduce((a, d) => a + (spendMinorOn(d) ?? 0), 0) : null;
  const spendPrev = prev.every(d => spendDays.has(d)) ? prev.reduce((a, d) => a + (spendMinorOn(d) ?? 0), 0) : null;
  const convSum = (ds: LocalDate[]) => (ds.some(d => !spendDays.has(d) || convBy.get(d) === null) ? null : ds.reduce((a, d) => a + (convBy.get(d) ?? 0), 0) / 1000);
  const convCur = convSum(cur), convPrev = convSum(prev);
  const tickers: Ticker[] = [
    { key: 'completed_guests', label: 'Completed guests', metric: noBookings ? unknownCount('completed_guests', 'Guests marked attended') : countMetric('completed_guests', 'Guests marked attended (service date, all channels)', guestsCur, 'observed', false), delta: delta(noBookings ? null : guestsCur, noBookings ? null : guestsPrev, w, false), spark: noBookings ? [] : sparkOf('completed_guests'), window: w },
    haveGa4 ? (() => {
      const c = ga4Sum(ga4All, cur), p = ga4Sum(ga4All, prev);
      const since = c.partial ? ` Tracking began ${firstGa4}: this covers ${c.known.length} day(s), not 28.` : '';
      const d = p.partial || p.value === null ? { absolute: null, percent: null, window: w, provisional: false, note: `No comparison yet: GA4 reservation tracking began ${firstGa4}` } : delta(c.value, p.value, w, false);
      return { key: 'confirmed_bookings', label: c.partial ? `Online reservations (since ${firstGa4})` : 'Online reservations', metric: { key: 'online_reservations', value: c.value, unit: 'count' as const, numerator: { label: 'OpenTable widget reservations counted by GA4', value: c.value }, basis: 'observed' as const, provisional: false, reason: c.value === null ? 'GA4 is missing more than 7 days of this window' : `${GA4_NOTE}${since}${c.excluded.length ? ` Excludes ${c.excluded.length} day(s) GA4 recorded nothing: ${c.excluded.join(', ')}.` : ''}` }, delta: d, spark: sparkOf('online_reservations'), window: w };
    })() : { key: 'confirmed_bookings', label: 'Confirmed bookings', metric: noBookings ? unknownCount('confirmed_bookings', 'Bookings created and not cancelled') : countMetric('confirmed_bookings', 'Bookings created and not cancelled (all channels)', bookCur, 'observed', false), delta: delta(noBookings ? null : bookCur, noBookings ? null : bookPrev, w, false), spark: noBookings ? [] : sparkOf('confirmed_bookings'), window: w },
    { key: 'ad_spend', label: 'Ad spend (Google)', metric: { key: 'ad_spend', value: spendCur, unit: 'money', currency, numerator: { label: 'Google Ads cost, all campaigns', value: spendCur }, basis: 'observed', provisional: false, ...(spendCur === null ? { reason: 'Spend missing for some days' } : {}) }, delta: delta(spendCur, spendPrev, w, false), spark: sparkOf('ad_spend'), window: w },
    ...(metaRows.length ? [(() => {
      const mSpend = (ds: LocalDate[]) => (ds.every(d => metaDays.has(d)) ? ds.reduce((a, d) => a + (metaMinorOn(d) ?? 0), 0) : null);
      const v = mSpend(cur), p = mSpend(prev);
      return { key: 'meta_spend', label: 'Ad spend (Meta)', metric: { key: 'meta_spend', value: v, unit: 'money', currency, numerator: { label: 'Meta Ads cost, all campaigns (converted from USD at each day’s rate by the Hub)', value: v }, basis: 'observed', provisional: false, ...(v === null ? { reason: 'Meta spend missing for some days' } : {}) }, delta: delta(v, p, w, false), spark: sparkOf('meta_spend'), window: w } as Ticker;
    })()] : []),
    ...(haveGa4 && metaRows.length ? [(() => {
      const spendOn = (ds: LocalDate[]) => (ds.every(d => metaDays.has(d)) ? ds.reduce((a, d) => a + (metaMinorOn(d) ?? 0), 0) : null);
      const a = ga4Sum(ga4Meta, cur), n = a.value, sp = spendOn(a.known);
      const v = sp === null || !n ? null : Math.round(sp / n);
      const m: Metric = { key: 'cost_per_online_reservation_meta', value: v, unit: 'money', currency, numerator: { label: 'Meta Ads cost', value: sp }, denominator: { label: 'Online reservations from Meta ad sessions (GA4 source facebook/instagram, paid medium)', value: n }, basis: 'attributed', provisional: false,
        reason: v === null ? (n === 0 ? 'GA4 credits no reservations to Meta ads in this window. Meta ad links may be missing UTM tags (utm_medium=paid), so their visits show as social or direct.' : 'Spend or GA4 data missing for part of the window') : 'GA4 session attribution, online widget reservations only. Not proof the ads caused them.' };
      return { key: 'cost_per_online_reservation_meta', label: 'Cost per online reservation (Meta)', metric: m, delta: { absolute: null, percent: null, window: w, provisional: false, note: 'No comparison yet' }, spark: [], window: w } as Ticker;
    })()] : []),
    ...(haveGa4 ? [(() => {
      // Spend over exactly the days GA4 recorded, so both sides of the ratio cover the same days.
      const spendOn = (ds: LocalDate[]) => (ds.every(d => spendDays.has(d)) ? ds.reduce((a, d) => a + (spendMinorOn(d) ?? 0), 0) : null);
      const cpr = (sp: number | null, n: number | null): number | null => (sp === null || !n ? null : Math.round(sp / n));
      const aCur = ga4Sum(ga4Ads, cur), aPrev = ga4Sum(ga4Ads, prev);
      const nCur = aCur.value, nPrev = aPrev.value;
      const vCur = cpr(spendOn(aCur.known), nCur), vPrev = aPrev.partial ? null : cpr(spendOn(aPrev.known), nPrev);
      const m: Metric = { key: 'cost_per_online_reservation', value: vCur, unit: 'money', currency, numerator: { label: 'Google Ads cost, all campaigns', value: spendCur }, denominator: { label: 'Online reservations from Google Ads sessions (GA4, last session source google / cpc)', value: nCur }, basis: 'attributed', provisional: false,
        reason: vCur === null ? (nCur === 0 ? 'No reservations from Google Ads sessions in this window' : 'Spend or GA4 data missing for part of the window') : `GA4 session attribution, online widget reservations only${aCur.partial ? `, spend and reservations since ${firstGa4}` : ''}. Likely overstated while GA4 credits some reservations to “dosbuhos.com / referral” (lost ad source). Not proof the ads caused them.` };
      return { key: 'cost_per_online_reservation', label: 'Cost per online reservation (Google Ads)', metric: m, delta: delta(vCur, vPrev, w, false), spark: [], window: w } as Ticker;
    })()] : []),
    { key: 'platform_conversions', label: 'Google Ads conversions', metric: { key: 'platform_conversions', value: convCur, unit: 'count', numerator: { label: 'Conversions as Google Ads counts them (whatever conversion actions the account has set up — not verified bookings)', value: convCur }, basis: 'attributed', provisional: false, reason: 'Platform-reported. Not deduplicated against OpenTable; may include clicks on the booking button rather than completed bookings' }, delta: delta(convCur, convPrev, w, false), spark: sparkOf('platform_conversions'), window: w },
    { key: 'contribution_after_ads', label: 'Contribution after ads', metric: caOff, delta: delta(caOff.value, caPrev.value, w, tCur.provisional), spark: sparkOf('contribution_after_ads'), window: w },
    { key: 'revenue_roas', label: 'Revenue ROAS', metric: rCur, delta: delta(rCur.value, rPrev.value, w, tCur.provisional), spark: sparkOf('revenue').map((p, i) => { const s = sparkOf('ad_spend')[i]?.value; return { ...p, value: p.value !== null && s ? p.value / s : null }; }), window: w },
    { key: 'forward_utilization', label: 'Next 14 days booked', metric: occ, delta: { absolute: null, percent: null, window: 'next 14 days', provisional: false, note: 'Forward-looking: no comparison' }, spark: [], window: 'next 14 days, restaurant + experiences (separate denominators summed only as places)' },
  ];

  const heroKey = noBookings ? (haveGa4 ? 'online_reservations' : 'ad_spend') : contribMissing ? 'completed_guests' : 'contribution_after_ads';
  const markers: ActionMarker[] = raw.actions.filter(a => ['VERIFIED', 'PARTIALLY_APPLIED', 'COMPENSATED', 'UNKNOWN_OUTCOME', 'SHADOWED'].includes(String(a.to_state)))
    .map(a => ({ actionId: String(a.action_id), date: localDate(Number(a.at), wineryTz), label: String(a.label), state: String(a.to_state), actor: String(a.actor) }));

  // ---- data quality ----
  const pastPaidOrAll = raw.bookings.filter(b => b.service_date < today && b.service_date >= cur[0]!);
  const known = pastPaidOrAll.filter(b => b.channel && b.channel !== 'unknown').length;
  const quality = {
    dataKind,
    attributionCoverage: pastPaidOrAll.length ? Math.round((known / pastPaidOrAll.length) * 100) : null,
    salesMatchingCoverage: (() => { const att = pastPaidOrAll.filter(b => b.status === 'attended'); return att.length ? Math.round((att.filter(b => b.paid_minor !== null).length / att.length) * 100) : null; })(),
    cancellationRate: pastPaidOrAll.length ? Math.round((pastPaidOrAll.filter(b => b.status === 'cancelled').length / pastPaidOrAll.length) * 100) : null,
    noShowRate: pastPaidOrAll.length ? Math.round((pastPaidOrAll.filter(b => b.status === 'no_show').length / pastPaidOrAll.length) * 100) : null,
    spendDaysMissing: cur.filter(d => !spendDays.has(d)),
    conversionDaysMissing: cur.filter(d => spendDays.has(d) && convBy.get(d) === null),
    lagKnown, lagDays: lagByProduct,
    lastSpendDataAsOf: raw.spend ? Number(raw.spend.data_as_of) : null,
    contributionMissing: contribMissing ?? null,
    bookingsConnected: !noBookings,
    ga4Connected: raw.ga4.length > 0,
  };

  return {
    today, cutoff: end, window: { from: cur[0], to: cur[27], prevFrom: prev[0], prevTo: prev[27] },
    availability: summarizeAvailability(raw.otAvailability, today),
    funnel: raw.ga4.length ? (() => {
      const inCur = (d: string) => d >= cur[0]! && d <= cur[27]!;
      const gaps = cur.filter(d => d >= (firstGa4 ?? d) && !ga4Days.has(d));
      return { window: `${cur[0]} – ${cur[27]}`, gaps, steps: FUNNEL.map(f => ({ ...f, count: raw.ga4.filter(r => r.event_name === f.event && inCur(r.date)).reduce((a, r) => a + r.events, 0) })) };
    })() : null,
    tickers, series, heroKey, markers, quality, capacity: cap, totals: { current: tCur, previous: tPrev },
    metrics: { contributionRoas: contributionRoas(tCur), costPerCompletedVisit: costPerCompletedVisit(tCur), costPerConfirmedBooking: costPerConfirmedBooking(tCur) },
    attributionMethod: ATTRIBUTION_METHOD,
    weekdayOfToday: weekdayOf(today),
  };
}
export type Overview = ReturnType<typeof computeOverview>;

export interface AvailabilityDay { date: string; status: 'closed' | 'full' | 'limited' | 'open' | 'unknown'; tables2: number | null; tables4: number | null; experienceTimes: number | null; experiences: { name: string; slots: number | null }[] }
/** Bookable times on OpenTable per day (not seats). ~20 table times for 2 is a normal open day (canario's yardstick);
 *  under 8 is "limited"; 0 is "full". Mon/Tue are closed. Unreadable stays unknown. */
export function summarizeAvailability(rows: { date: string; product: string; item: string; party_size: number; slots: number | null; checked_at: number }[], today: LocalDate, days = 14): { checkedAt: number | null; days: AvailabilityDay[] } {
  if (!rows.length) return { checkedAt: null, days: [] };
  const out: AvailabilityDay[] = [];
  for (let k = 0; k < days; k++) {
    const date = addDays(today, k);
    const r = rows.filter(x => x.date === date);
    const t2 = r.find(x => x.item === 'tables' && x.party_size === 2)?.slots ?? null, t4 = r.find(x => x.item === 'tables' && x.party_size === 4)?.slots ?? null;
    const ex = r.filter(x => x.product === 'tour_tasting').map(x => ({ name: x.item, slots: x.slots }));
    const exTotal = ex.length && ex.every(x => x.slots !== null) ? ex.reduce((a, x) => a + (x.slots ?? 0), 0) : null;
    const closed = [1, 2].includes(weekdayOf(date)) && !r.length;
    const status = closed ? 'closed' : t2 === null ? 'unknown' : t2 === 0 ? 'full' : t2 < 8 ? 'limited' : 'open';
    out.push({ date, status, tables2: t2, tables4: t4, experienceTimes: exTotal, experiences: ex });
  }
  return { checkedAt: Math.max(...rows.map(x => x.checked_at)), days: out };
}

export function computeCapacity(raw: Raw, now: number, today: LocalDate) {
  const slots: Slot[] = raw.slots.map(s => ({
    slotId: String(s.id), product: s.product as Product, date: String(s.date), startMin: Number(s.start_min), durationMin: Number(s.duration_min), bufferMin: Number(s.buffer_min),
    requires: JSON.parse(String(s.requires_json)), maxGuests: s.max_guests === null ? null : Number(s.max_guests), state: s.state as Slot['state'],
    source: s.source as Slot['source'], sourceUpdatedAt: s.source_updated_at === null ? null : Number(s.source_updated_at),
  }));
  const reservations: Reservation[] = raw.slots.filter(s => Number(s.reserved_guests) > 0).map(s => ({ reservationId: `r:${s.id}`, slotId: String(s.id), guests: Number(s.reserved_guests), status: 'confirmed' }));
  const resolved = resolveCapacity({
    resources: raw.resources.map(r => ({ id: String(r.id), kind: r.kind as 'seats', label: String(r.label), quantity: Number(r.quantity) })),
    windows: raw.windows.map(w => ({ resourceId: String(w.resource_id), date: String(w.date), startMin: Number(w.start_min), endMin: Number(w.end_min), quantity: Number(w.quantity) })),
    slots, reservations, now,
    freshness: raw.products.map(p => ({ product: p.id, maxAgeMinutes: p.capacity_max_age_minutes })),
  });
  const days: DayProductSummary[] = summarizeDays(resolved);
  const horizon = dateRange(today, addDays(today, 29));
  const lastUpdate = slots.reduce<number | null>((m, s) => (s.sourceUpdatedAt !== null && (m === null || s.sourceUpdatedAt > m) ? s.sourceUpdatedAt : m), null);
  return { slots: resolved, days, horizon, lastUpdate };
}
