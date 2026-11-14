// Per-campaign view: spend from the ad platforms, matched to OpenTable online reservations in GA4 by campaign name.
// Google auto-tagging reports the Google Ads campaign name as the GA4 session campaign (source google / medium cpc).
// Meta ads tag campaigns by ID (utm_campaign = numeric), and the Hub stores Meta campaigns by name, so Meta cannot
// be matched per campaign yet. Reservation metrics only use days GA4 was tracking reservations.
import { addDays, localDate, type LocalDate } from '../domain/time.ts';
import { isBrandQuery, RESERVATION_EVENT, isGoogleAds, isMetaAds } from '../connectors/ga4.ts';
import { loadEstimates } from './estimates.ts';

export interface CampaignRow {
  ref: string; provider: 'google_ads' | 'meta_ads'; name: string; status: string; channel: string; products: string[];
  budgetMicros: number | null; managedBy: string; writable: boolean;
  spendMicros: number; clicks: number; impressions: number; convMilli: number | null; convMissingDays: number; days: number;
  trackedSpendMicros: number | null;      // spend on the days GA4 tracked reservations
  openedAvailability: number | null;      // ot-availability-pageview from this campaign's sessions
  reservations: number | null;
  costPerReservationMinor: number | null;
  estimatedRevenueMinor: number | null;   // reservations × owner-approved value per reservation
  estimatedReturn: number | null;
  estimatedContributionMinor: number | null; // reservations × contribution per reservation − spend on the tracked days         // estimated revenue ÷ spend on the tracked days
  note: string;
}
export interface SourceShare { group: string; reservations: number }
export interface TermTotals { sessions: number; opened: number; reservations: number; clicks: number | null; costMinor: number | null }
export interface SearchTerms { from: LocalDate; to: LocalDate; withCost: boolean; brand: TermTotals; other: TermTotals; top: ({ query: string; campaign: string; brand: boolean } & TermTotals)[] }
export interface CampaignsView { searchTerms: SearchTerms | null; estimate: { valueMinor: number; basis: string; sourcePeriod: string; approvedBy: string; contributionMinor: number | null } | null; window: { from: LocalDate; to: LocalDate }; trackingSince: LocalDate | null; currency: string; campaigns: CampaignRow[]; sources: SourceShare[]; unmatchedGoogleAds: number; unmatchedMeta: { reservations: number; opened: number; clicks: number } }

/** Where an online reservation's session came from, in plain groups. */
export function sourceGroup(source: string, medium: string): string {
  if (isGoogleAds(source, medium)) return 'Google Ads';
  if (isMetaAds(source, medium)) return 'Anuncios de Meta (etiquetados)';
  if (/dosbuhos\.com/i.test(source)) return 'Fuente perdida (referencia de dosbuhos.com)';
  if (/^\(not set\)$|^\(data not available\)$|^$/i.test(source)) return 'Sin definir';
  if (/^\(direct\)$/i.test(source)) return 'Directo';
  if (/organic/i.test(medium)) return 'Búsqueda (orgánica)';
  if (/(facebook|instagram|^ig$|^fb$)/i.test(source)) return 'Facebook / Instagram (orgánico o anuncios sin etiqueta)';
  if (/opentable/i.test(source)) return 'OpenTable';
  if (/ai-assistant/i.test(medium)) return 'Asistentes de IA';
  return 'Otras referencias';
}

export async function loadCampaigns(db: D1Database, now: number, tz: string, currency: string): Promise<CampaignsView> {
  const all = await loadEstimates(db);
  const est = all.current.restaurant_visit ?? null;
  const perContribution = all.contribution.restaurant_visit ?? null;
  const to = addDays(localDate(now, tz), -1), from = addDays(to, -27);
  const start = await db.prepare('SELECT MIN(date) AS d FROM ga4_reservations_daily WHERE event_name = ?').bind(RESERVATION_EVENT).first<{ d: string | null }>().catch(() => null);
  const trackingSince = start?.d ?? null;
  const tFrom = trackingSince && trackingSince > from ? trackingSince : from;
  const [reg, spend, tracked, ga4] = await Promise.all([
    db.prepare(`SELECT r.ref, r.external_id, r.name, r.status, r.channel, r.products_json, r.budget_micros, r.managed_by, r.writable, a.provider
      FROM campaign_registry r JOIN ad_accounts a ON a.id = r.account_id WHERE r.kind = 'campaign'`).all<Record<string, unknown>>(),
    db.prepare(`SELECT account_id, campaign_id, SUM(cost_micros) AS cost, SUM(clicks) AS clicks, SUM(impressions) AS impr, SUM(platform_conversions_milli) AS conv,
      SUM(CASE WHEN platform_conversions_milli IS NULL THEN 1 ELSE 0 END) AS conv_missing, COUNT(*) AS days FROM campaign_daily WHERE date BETWEEN ? AND ? GROUP BY account_id, campaign_id`).bind(from, to).all<Record<string, number | string>>(),
    db.prepare('SELECT account_id, campaign_id, SUM(cost_micros) AS cost FROM campaign_daily WHERE date BETWEEN ? AND ? GROUP BY account_id, campaign_id').bind(tFrom, to).all<Record<string, number | string>>(),
    db.prepare('SELECT event_name, source, medium, campaign, SUM(events) AS n FROM ga4_reservations_daily WHERE date BETWEEN ? AND ? GROUP BY event_name, source, medium, campaign').bind(tFrom, to).all<{ event_name: string; source: string; medium: string; campaign: string; n: number }>().catch(() => ({ results: [] as { event_name: string; source: string; medium: string; campaign: string; n: number }[] })),
  ]);
  const accountOf = await db.prepare('SELECT id, provider FROM ad_accounts').all<{ id: string; provider: string }>();
  const acct = new Map(accountOf.results.map(a => [a.provider, a.id]));
  const key = (accountId: string, campaignId: string) => `${accountId}|${campaignId}`;
  const spendBy = new Map(spend.results.map(s => [key(String(s.account_id), String(s.campaign_id)), s]));
  const trackedBy = new Map(tracked.results.map(s => [key(String(s.account_id), String(s.campaign_id)), Number(s.cost)]));
  const haveGa4 = trackingSince !== null;
  const metaEvents = (name: string, ev: string) => ga4.results.filter(r => r.event_name === ev && isMetaAds(r.source, r.medium) && r.campaign === name).reduce((a, r) => a + Number(r.n), 0);
  const googleEvents = (name: string, ev: string) => ga4.results.filter(r => r.event_name === ev && isGoogleAds(r.source, r.medium) && r.campaign === name).reduce((a, r) => a + Number(r.n), 0);

  const campaigns: CampaignRow[] = reg.results.map(r => {
    const provider = r.provider === 'meta_ads' ? 'meta_ads' as const : 'google_ads' as const;
    const accountId = acct.get(provider) ?? '';
    const s = spendBy.get(key(accountId, String(r.external_id)));
    const trackedSpend = haveGa4 ? trackedBy.get(key(accountId, String(r.external_id))) ?? 0 : null;
    const name = String(r.name);
    let reservations: number | null = null, opened: number | null = null, note = '';
    if (!haveGa4) note = 'GA4 no está conectado, así que no se conocen las reservaciones por campaña.';
    else if (provider === 'meta_ads') {
      // Meta ads tagged with utm_campaign={{campaign.name}} match by name; older ads tagged with the numeric campaign ID can't.
      reservations = metaEvents(name, RESERVATION_EVENT); opened = metaEvents(name, 'ot-availability-pageview');
      const clicks = metaEvents(name, 'reserva_click');
      if (!reservations && !opened && !clicks) { reservations = null; opened = null; note = 'Las visitas de esta campaña no traen su nombre en la etiqueta (utm_campaign), así que no se pueden ver sus reservaciones. En Meta, usa utm_campaign={{campaign.name}} en los parámetros de URL.'; }
      else note = `${clicks} clic(s) en “Reservar” en dosbuhos.com desde esta campaña.`;
    }
    else { reservations = googleEvents(name, RESERVATION_EVENT); opened = googleEvents(name, 'ot-availability-pageview'); }
    const cpr = reservations && trackedSpend !== null ? Math.round(trackedSpend / 10_000 / reservations) : null;
    if (haveGa4 && reservations === 0 && provider === 'meta_ads' && opened !== null) note = `${note} GA4 no le ha atribuido reservaciones en línea desde que empezó el seguimiento.`;
    if (provider === 'google_ads' && haveGa4 && reservations === 0) note = trackedSpend ? 'GA4 no le ha atribuido reservaciones en línea a esta campaña desde que empezó el seguimiento.' : 'Sin gasto y sin reservaciones desde que empezó el seguimiento.';
    return {
      ref: String(r.ref), provider, name, status: String(r.status), channel: String(r.channel), products: JSON.parse(String(r.products_json ?? '[]')),
      budgetMicros: r.budget_micros === null ? null : Number(r.budget_micros), managedBy: String(r.managed_by), writable: r.writable === 1,
      spendMicros: Number(s?.cost ?? 0), clicks: Number(s?.clicks ?? 0), impressions: Number(s?.impr ?? 0), convMilli: s?.conv == null ? null : Number(s.conv),
      convMissingDays: Number(s?.conv_missing ?? 0), days: Number(s?.days ?? 0),
      trackedSpendMicros: trackedSpend, openedAvailability: opened, reservations, costPerReservationMinor: cpr, note,
      estimatedRevenueMinor: reservations !== null && est ? reservations * est.valueMinor : null,
      estimatedReturn: reservations !== null && est && trackedSpend ? (reservations * est.valueMinor) / (trackedSpend / 10_000) : null,
      estimatedContributionMinor: reservations !== null && perContribution !== null && trackedSpend !== null ? reservations * perContribution - Math.round(trackedSpend / 10_000) : null,
    };
  }).filter(c => c.spendMicros > 0 || c.status === 'ENABLED' || (c.reservations ?? 0) > 0)
    .sort((a, b) => (a.provider === b.provider ? b.spendMicros - a.spendMicros : a.provider === 'google_ads' ? -1 : 1));

  const searchTerms = await loadSearchTerms(db, from, to);
  const groups = new Map<string, number>();
  for (const r of ga4.results.filter(x => x.event_name === RESERVATION_EVENT)) groups.set(sourceGroup(r.source, r.medium), (groups.get(sourceGroup(r.source, r.medium)) ?? 0) + Number(r.n));
  const knownGoogle = new Set(campaigns.filter(c => c.provider === 'google_ads').map(c => c.name));
  const knownMeta = new Set(campaigns.filter(c => c.provider === 'meta_ads').map(c => c.name));
  const metaIdRows = ga4.results.filter(r => isMetaAds(r.source, r.medium) && !knownMeta.has(r.campaign));
  const unmatchedMeta = { reservations: metaIdRows.filter(r => r.event_name === RESERVATION_EVENT).reduce((a, r) => a + Number(r.n), 0), opened: metaIdRows.filter(r => r.event_name === 'ot-availability-pageview').reduce((a, r) => a + Number(r.n), 0), clicks: metaIdRows.filter(r => r.event_name === 'reserva_click').reduce((a, r) => a + Number(r.n), 0) };
  const unmatchedGoogleAds = ga4.results.filter(r => r.event_name === RESERVATION_EVENT && isGoogleAds(r.source, r.medium) && !knownGoogle.has(r.campaign)).reduce((a, r) => a + Number(r.n), 0);
  return { searchTerms, estimate: est ? { valueMinor: est.valueMinor, basis: est.basis, sourcePeriod: est.sourcePeriod, approvedBy: est.approvedBy, contributionMinor: perContribution } : null, window: { from, to }, trackingSince, currency, campaigns, sources: [...groups.entries()].map(([group, reservations]) => ({ group, reservations })).sort((a, b) => b.reservations - a.reservations), unmatchedGoogleAds, unmatchedMeta };
}

/** Google Ads search terms (via GA4), split into searches for our own name vs. everything else. */
async function loadSearchTerms(db: D1Database, from: LocalDate, to: LocalDate): Promise<SearchTerms | null> {
  const rows = (await db.prepare(`SELECT query, campaign, SUM(sessions) AS sessions, SUM(opened) AS opened, SUM(reservations) AS reservations, SUM(ad_clicks) AS clicks, SUM(ad_cost_micros) AS cost, COUNT(ad_cost_micros) AS with_cost
    FROM ga4_ads_queries WHERE date BETWEEN ? AND ? GROUP BY query, campaign`).bind(from, to).all<Record<string, number | string | null>>().catch(() => null))?.results;
  if (!rows?.length) return null;
  const withCost = rows.some(r => Number(r.with_cost) > 0);
  const zero = (): TermTotals => ({ sessions: 0, opened: 0, reservations: 0, clicks: withCost ? 0 : null, costMinor: withCost ? 0 : null });
  const brand = zero(), other = zero();
  const top = rows.map(r => ({ query: String(r.query), campaign: String(r.campaign), brand: isBrandQuery(String(r.query)), sessions: Number(r.sessions), opened: Number(r.opened), reservations: Number(r.reservations),
    clicks: withCost ? Number(r.clicks ?? 0) : null, costMinor: withCost ? Math.round(Number(r.cost ?? 0) / 10_000) : null }));
  for (const t of top) { const g = t.brand ? brand : other; g.sessions += t.sessions; g.opened += t.opened; g.reservations += t.reservations; if (withCost) { g.clicks! += t.clicks!; g.costMinor! += t.costMinor!; } }
  top.sort((a, b) => (withCost ? b.costMinor! - a.costMinor! : 0) || b.sessions - a.sessions);
  return { from, to, withCost, brand, other, top: top.slice(0, 30) };
}
