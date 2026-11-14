// SYNTHETIC DEMONSTRATION DATA — not Dos Búhos results. Deterministic (seeded) and generated relative to "today" so
// the demo stays current. It deliberately contains: a decline period, a 3-day conversion tracking gap, cancellations
// and no-shows, unmatched sales, unknown capacity, a blocked day, a sold-out day, budget changes by "the owner",
// and failed / inconclusive experiments. It is only ever written to a database whose business_settings.data_kind is
// 'demo' (separate D1 database), so it cannot mix with real data.
import { addDays, localDate, weekdayOf, zonedToUtc } from '../src/domain/time.ts';

export const DEMO_ACCOUNT = { id: 'acct_google_demo', externalId: '0000000000', currency: 'MXN' as const, tz: 'America/Mexico_City' };

function rng(seed: number) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export interface Stmt { sql: string; binds: unknown[] }
const S = (sql: string, ...binds: unknown[]): Stmt => ({ sql, binds });

const CAMPAIGNS = [
  { id: '111', ref: 'res_c111', name: 'Tours & Tastings — EN (demo)', products: ['tour_tasting'], horizon: 21, budgetId: '9001', budget: 600, brand: 0, lang: 'en', managedBy: 'app', writable: 1, status: 'ENABLED' },
  { id: '222', ref: 'res_c222', name: 'Restaurante — ES (demo)', products: ['restaurant_visit'], horizon: 10, budgetId: '9002', budget: 450, brand: 0, lang: 'es', managedBy: 'app', writable: 1, status: 'ENABLED' },
  { id: '333', ref: 'res_c333', name: 'Marca Dos Búhos (demo)', products: ['restaurant_visit', 'tour_tasting'], horizon: 30, budgetId: '9003', budget: 250, brand: 1, lang: 'es', managedBy: 'owner', writable: 0, status: 'ENABLED' },
  { id: '444', ref: 'res_c444', name: 'Eventos privados (demo)', products: ['private_event'], horizon: 120, budgetId: '9004', budget: 200, brand: 0, lang: 'es', managedBy: 'owner', writable: 0, status: 'PAUSED' },
];

export function demoStatements(now: number): Stmt[] {
  const r = rng(20261114);
  const tz = DEMO_ACCOUNT.tz;
  const today = localDate(now, tz);
  const out: Stmt[] = [];

  out.push(S(`INSERT OR IGNORE INTO ad_accounts (id, provider, external_id, name, currency, account_tz, access_status, known_automation_json, created_at) VALUES (?, 'google_ads', ?, 'Demo account (synthetic)', 'MXN', ?, 'demo', '[]', ?)`, DEMO_ACCOUNT.id, DEMO_ACCOUNT.externalId, tz, now));
  const conns: [string, string, string, string, string][] = [
    ['conn_google_ads_script', 'google_ads_script', 'Google Ads reads (hourly script feed)', 'connected', 'Demo: synthetic feed'],
    ['conn_google_ads_api', 'google_ads_api', 'Google Ads changes (API)', 'not_configured', 'Needs approved Google Ads API access for the owner’s Cloud project and owner OAuth'],
    ['conn_opentable_csv', 'opentable_csv', 'Restaurant + experience bookings (CSV export)', 'connected', 'Demo: synthetic bookings. OpenTable offers no reservation API to restaurants'],
    ['conn_ga4', 'ga4', 'Website analytics', 'not_configured', 'Tag audit pending (owner approval before any change)'],
    ['conn_anthropic', 'anthropic', 'Analysis and report narrative', 'limited', 'Optional: without a key, reports use the factual template and no proposals are drafted'],
    ['conn_data_manager', 'google_data_manager', 'Offline conversions back to Google Ads', 'not_configured', 'Phase 2: needs a reliable completed-visit signal first'],
    ['conn_zoho_inventory', 'zoho_inventory', 'Wine sales', 'not_configured', 'Phase 3'],
    ['conn_parrot', 'parrot_pos', 'Restaurant checks', 'not_configured', 'No public API found; export-based import in Phase 3'],
    ['conn_meta', 'meta_ads', 'Meta Ads', 'not_configured', 'Phase 4 (read today in the Hub’s Anuncios)'],
  ];
  for (const [id, p, purpose, h, reason] of conns) out.push(S(`INSERT OR IGNORE INTO connections (id, provider, purpose, health, health_reason, last_success_at, freshness_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, id, p, purpose, h, reason, h === 'connected' ? now - 40 * 60_000 : null, h === 'connected' ? now - 45 * 60_000 : null, now));

  for (const c of CAMPAIGNS) {
    out.push(S(`INSERT OR IGNORE INTO campaign_registry (ref, account_id, kind, external_id, name, status, channel, products_json, intent, brand, language, booking_horizon_days, budget_id, budget_shared, budget_micros, writable, managed_by, optimization_signal, updated_at)
      VALUES (?, ?, 'campaign', ?, ?, ?, 'SEARCH', ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`, c.ref, DEMO_ACCOUNT.id, c.id, c.name, c.status, JSON.stringify(c.products), c.products[0], c.brand, c.lang, c.horizon, c.budgetId, c.budget * 1e6, c.writable, c.managedBy, 'Confirmed booking (proxy value)', now));
  }
  out.push(S(`INSERT OR IGNORE INTO campaign_registry (ref, account_id, kind, external_id, parent_campaign_id, name, status, products_json, booking_horizon_days, writable, managed_by, updated_at) VALUES ('res_a7001', ?, 'ad', '7001', '111', 'Tours EN · “Vineyard tour & tasting” (demo)', 'ENABLED', '["tour_tasting"]', 21, 1, 'app', ?)`, DEMO_ACCOUNT.id, now));
  out.push(S(`INSERT OR IGNORE INTO campaign_registry (ref, account_id, kind, external_id, parent_campaign_id, name, status, products_json, booking_horizon_days, writable, managed_by, updated_at) VALUES ('res_a7002', ?, 'ad', '7002', '111', 'Tours EN · “Cheap wine tasting” (demo, failing)', 'ENABLED', '["tour_tasting"]', 21, 1, 'app', ?)`, DEMO_ACCOUNT.id, now));

  out.push(S(`INSERT OR IGNORE INTO cost_assumptions (id, product, effective_from, variable_cost_pct_bp, variable_cost_per_guest_minor, currency, status, source, approved_by, approved_at) VALUES ('ca_rest_demo', 'restaurant_visit', '2025-01-01', 6200, NULL, 'MXN', 'estimated', 'Demo assumption', 'demo-owner', ?)`, now));
  out.push(S(`INSERT OR IGNORE INTO cost_assumptions (id, product, effective_from, variable_cost_pct_bp, variable_cost_per_guest_minor, currency, status, source, approved_by, approved_at) VALUES ('ca_tour_demo', 'tour_tasting', '2025-01-01', 3500, 8000, 'MXN', 'estimated', 'Demo assumption', 'demo-owner', ?)`, now));
  out.push(S(`UPDATE products SET lag_estimated_from_data = 1 WHERE id IN ('restaurant_visit', 'tour_tasting')`));

  // ---- ads: 120 days ----
  for (let k = 120; k >= 0; k--) {
    const d = addDays(today, -k), wd = weekdayOf(d), weekend = wd >= 5;
    const decline = k >= 30 && k <= 40;
    const gap = k >= 16 && k <= 18;
    for (const c of CAMPAIGNS) {
      if (c.status === 'PAUSED' && k < 60) continue;
      const budget = c.id === '111' && k > 50 ? 520 : c.budget;
      const frac = k === 0 ? 0.55 : 0.82 + r() * 0.2 + (weekend ? 0.05 : 0);
      const cost = Math.round(budget * frac * 100) * 10_000;
      const clicks = Math.round((cost / 1e6) / (c.brand ? 4 : 11 + r() * 4));
      const convRate = (c.brand ? 0.16 : 0.07) * (decline && c.id === '111' ? 0.55 : 1) * (0.8 + r() * 0.4);
      const conv = gap ? null : Math.round(clicks * convRate * 1000);
      out.push(S(`INSERT OR IGNORE INTO campaign_daily (account_id, campaign_id, date, currency, cost_micros, impressions, clicks, platform_conversions_milli, platform_conversion_value_micros, conversion_action, attribution_model, source, fetched_at) VALUES (?, ?, ?, 'MXN', ?, ?, ?, ?, ?, 'OpenTable booking (demo)', 'DATA_DRIVEN', 'demo', ?)`,
        DEMO_ACCOUNT.id, c.id, d, cost, clicks * 9, clicks, conv, conv === null ? null : conv * 1200 * 1000, now));
    }
  }
  const mtdDays = Number(today.slice(8, 10));
  const mtd = CAMPAIGNS.filter(c => c.status === 'ENABLED').reduce((a, c) => a + c.budget * 0.92 * (mtdDays - 0.45), 0);
  out.push(S(`INSERT OR IGNORE INTO spend_readings (account_id, read_at, data_as_of, month, month_to_date_micros, today_micros, managed_daily_budget_micros, unmanaged_daily_budget_micros, max_hourly_micros) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    DEMO_ACCOUNT.id, now - 20 * 60_000, now - 25 * 60_000, today.slice(0, 7), Math.round(mtd) * 1e6, 720e6, 1050e6, 250e6, 95e6));

  // ---- bookings: past 120 days of service + next 30 days ----
  const channels = (paidShare: number) => { const x = r(); return x < paidShare ? 'google / cpc' : x < paidShare + 0.33 ? 'organic' : x < paidShare + 0.52 ? 'direct' : x < paidShare + 0.6 ? 'opentable network' : 'unknown'; };
  let n = 0;
  for (let k = -120; k <= 30; k++) {
    const d = addDays(today, k), wd = weekdayOf(d);
    if (wd === 1 || wd === 2) continue; // closed Mon/Tue
    const decline = k <= -30 && k >= -40;
    const lift = k > -28 ? 1.12 : 1; // recent improvement in restaurant demand
    const restParties = Math.round((wd >= 5 ? 26 : 15) * lift * (0.8 + r() * 0.4) * (k > 0 ? Math.max(0.15, 1 - k / 14) : 1));
    const tourParties = Math.round((wd >= 5 ? 9 : 5) * (decline ? 0.6 : 1) * (0.7 + r() * 0.6) * (k > 0 ? Math.max(0.2, 1 - k / 25) : 1));
    const make = (product: 'restaurant_visit' | 'tour_tasting', i: number) => {
      const isTour = product === 'tour_tasting';
      const party = isTour ? 2 + Math.floor(r() * 3) : 2 + Math.floor(r() * 4);
      const hour = isTour ? [11, 13, 15][Math.floor(r() * 3)]! : 13 + Math.floor(r() * 4);
      const service = zonedToUtc(d, hour, 0, tz);
      const lead = Math.floor(r() * (isTour ? 22 : 9));
      const created = Math.min(now - 3_600_000, service - lead * 86_400_000 - Math.floor(r() * 36e6));
      const ch = channels(isTour ? 0.34 : 0.24);
      let status = 'confirmed';
      if (k < 0) { const x = r(); status = x < 0.1 ? 'cancelled' : x < 0.15 ? 'no_show' : 'attended'; }
      else if (r() < 0.05) status = 'cancelled';
      const perGuest = isTour ? 950_00 : 640_00 + Math.floor(r() * 160_00);
      const quoted = isTour ? perGuest * party : null;
      const paid = status === 'attended' && r() < 0.9 ? Math.round(perGuest * party * (0.9 + r() * 0.25)) : null;
      const id = `opentable:DEMO${String(++n).padStart(6, '0')}`;
      out.push(S(`INSERT OR IGNORE INTO bookings (id, source, external_id, product, experience_name, created_at_utc, service_at_utc, service_date, source_tz, party_size, status, channel, currency, quoted_minor, paid_minor, source_updated_at) VALUES (?, 'demo', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'MXN', ?, ?, ?)`,
        id, id.slice(10), product, isTour ? 'Recorrido y cata (demo)' : '', created, service, d, tz, party, status, ch, quoted, paid, now));
      if (ch === 'google / cpc' && created <= now) {
        const camp = r() < 0.25 ? 'res_c333' : isTour ? 'res_c111' : 'res_c222';
        out.push(S(`INSERT OR IGNORE INTO attribution_links (id, booking_id, campaign_ref, method, evidence, lookback_days, confidence) VALUES (?, ?, ?, 'booking_source_field', 'OpenTable source = google / cpc (demo)', 30, 'attributed')`, `al_${id}`, id, camp));
        const net = paid ?? (status === 'confirmed' ? quoted ?? perGuest * party : null);
        const contrib = net === null ? 0 : isTour ? net - Math.round(net * 0.35) - 80_00 * party : net - Math.round(net * 0.62);
        out.push(S(`INSERT OR IGNORE INTO orders_and_checks (id, source, transaction_at, service_date, currency, paid, lines_json, matched_booking_id, match_method, match_confidence, source_updated_at) VALUES (?, 'demo', ?, ?, 'MXN', ?, '[]', ?, 'booking_ref', 'observed', ?)`, `tx_${id}`, service, d, paid ? 1 : 0, id, now));
        out.push(S(`INSERT OR IGNORE INTO revenue_allocations (transaction_id, line_id, booking_id, product, currency, net_minor, contribution_minor) VALUES (?, 'l1', ?, ?, 'MXN', ?, ?)`, `tx_${id}`, id, product, net ?? 0, status === 'cancelled' || status === 'no_show' ? 0 : contrib));
      }
    };
    for (let i = 0; i < restParties; i++) make('restaurant_visit', i);
    for (let i = 0; i < tourParties; i++) make('tour_tasting', i);
  }

  // ---- capacity: resources and the next 30 days ----
  out.push(S(`INSERT OR IGNORE INTO capacity_resources (id, kind, label, quantity) VALUES ('seats', 'seats', 'Restaurant seats', 60), ('guides', 'guide', 'Tour guides', 2), ('cava', 'space', 'Tasting room', 1)`));
  for (let k = 0; k < 30; k++) {
    const d = addDays(today, k), wd = weekdayOf(d);
    const closed = wd === 1 || wd === 2;
    const entered = k < 21; // staff have entered three weeks; the rest is unknown
    const updated = now - 3 * 3_600_000;
    if (entered && !closed) {
      out.push(S(`INSERT OR IGNORE INTO capacity_resource_windows (resource_id, date, start_min, end_min, quantity, updated_at, updated_by) VALUES ('seats', ?, 780, 1110, 60, ?, 'demo'), ('guides', ?, 600, 1080, ?, ?, 'demo'), ('cava', ?, 600, 1080, 1, ?, 'demo')`, d, updated, d, wd >= 5 ? 2 : 1, updated, d, updated));
    }
    const blocked = k === 9 && !closed;
    for (const [start, label] of [[780, 'Comida 13:00'], [840, 'Comida 14:00'], [900, 'Comida 15:00'], [960, 'Comida 16:00']] as const) {
      out.push(S(`INSERT OR IGNORE INTO capacity_slots (id, product, label, date, start_min, duration_min, buffer_min, requires_json, max_guests, state, reserved_guests, source, source_updated_at, updated_by) VALUES (?, 'restaurant_visit', ?, ?, ?, 90, 15, ?, NULL, ?, 0, 'manual', ?, 'demo')`,
        `slot_rest_${d}_${start}`, label, d, start, JSON.stringify([{ resourceId: 'seats', perGuest: 1, perSlot: 0 }]), closed ? 'closed' : blocked ? 'blocked' : 'open', entered ? updated : null));
    }
    for (const [start, label] of [[660, 'Recorrido 11:00'], [780, 'Recorrido 13:00'], [900, 'Recorrido 15:00']] as const) {
      out.push(S(`INSERT OR IGNORE INTO capacity_slots (id, product, label, date, start_min, duration_min, buffer_min, requires_json, max_guests, state, reserved_guests, source, source_updated_at, updated_by) VALUES (?, 'tour_tasting', ?, ?, ?, 90, 30, ?, 14, ?, 0, 'manual', ?, 'demo')`,
        `slot_tour_${d}_${start}`, label, d, start, JSON.stringify([{ resourceId: 'guides', perGuest: 0, perSlot: 1 }, { resourceId: 'cava', perGuest: 0, perSlot: 1 }]), closed ? 'closed' : blocked ? 'blocked' : 'open', entered ? updated : null));
    }
  }
  // Reserved guests per slot from the future bookings (nearest slot start).
  out.push(S(`UPDATE capacity_slots SET reserved_guests = COALESCE((SELECT SUM(b.party_size) FROM bookings b WHERE b.status != 'cancelled' AND b.service_date = capacity_slots.date AND b.product = capacity_slots.product
    AND ((b.service_at_utc / 60000) % 1440 + 1440 - 360) % 1440 BETWEEN capacity_slots.start_min AND capacity_slots.start_min + 59), 0) WHERE date >= ?`, today));
  // Make next Saturday's lunch sold out, as staff would see it.
  let sat = today; while (weekdayOf(sat) !== 6) sat = addDays(sat, 1);
  out.push(S(`UPDATE capacity_slots SET reserved_guests = 60 WHERE id IN (?, ?)`, `slot_rest_${sat}_780`, `slot_rest_${sat}_840`));
  out.push(S(`UPDATE capacity_slots SET reserved_guests = 0 WHERE id = ?`, `slot_rest_${sat}_900`));

  // ---- experiments ----
  const exp = (id: string, title: string, hyp: string, status: string, from: number, to: number | null, metric: string, result: string, limits: string, spent: number, next: string | null) =>
    S(`INSERT OR IGNORE INTO experiments (id, title, hypothesis, unit, primary_metric, guardrails_json, status, start_date, end_date, allocation, max_cost_micros, spent_micros, maturation_days, stop_loss, evidence_json, result, limitations, next_evaluation, review_after, created_at)
      VALUES (?, ?, ?, 'Google Ads experiment arm (50/50 cookie split)', ?, '["cancellation rate","party size","cost per completed guest"]', ?, ?, ?, '50 / 50', 6000000000, ?, 21, 'Stop if cost per completed guest is 40% worse after 10 days', '{}', ?, ?, ?, ?, ?)`,
      id, title, hyp, metric, status, addDays(today, from), to === null ? null : addDays(today, to), spent, result, limits, next, addDays(today, 90), now);
  out.push(exp('exp_demo_copy', 'Spanish vs English ad copy for tours (demo)', 'Spanish copy lifts completed tour guests from Mexican searchers by ≥15%', 'inconclusive', -75, -40, 'completed tour guests', 'No clear difference: +6% with a wide interval that includes a loss.', 'Low volume (≈40 conversions per arm); overlapped a holiday week.', 3800e6, null));
  out.push(exp('exp_demo_broad', 'Broad match on “wine tasting” (demo)', 'Broad match finds more qualified tour bookers at similar cost per completed guest', 'failed', -60, -45, 'cost per completed guest', 'Cost per completed guest rose 52%; more cancellations. Stopped by stop-loss.', 'Observational before/after on one campaign; seasonality not controlled.', 4100e6, null));
  out.push(exp('exp_demo_neg', 'Exact negatives for job-seeker and “free” searches (demo)', 'Removing non-buyer searches lowers cost per confirmed booking without fewer completed guests', 'active', -9, null, 'cost per confirmed booking', '', 'Before/after comparison: matched weekdays only, still maturing.', 900e6, addDays(today, 12)));

  out.push(S(`UPDATE connections SET freshness_at = ? WHERE provider = 'opentable_csv'`, now - 2 * 3_600_000));
  return out;
}
