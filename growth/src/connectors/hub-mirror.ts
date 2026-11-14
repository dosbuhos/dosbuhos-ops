// Google Ads reads via the Hub (Phase 1, live today). The Hub's Google Ads Script already posts the Dos Búhos account
// hourly into the Hub's D1 (ads_perf, ads_campaigns). Growth binds that database READ-ONLY (HUB_DB, SELECT only, like
// the Hub reads the wine club's database) and mirrors the Google rows into its own tables every hour.
//
// Limits of this source, shown in Connections: campaigns are identified by name (no campaign or budget IDs), money is
// stored by the Hub as MXN decimals (converted here to integer micros), no search terms or change history. Every
// mirrored campaign is non-writable: nothing read this way can be changed by the app.
import { localDate, addDays } from '../domain/time.ts';

/** Stable, short id from a campaign name (FNV-1a). Renaming a campaign in Google Ads makes it a new row. */
export function nameKey(name: string): string {
  let h = 0x811c9dc5;
  for (const ch of new TextEncoder().encode(name)) { h ^= ch; h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36).padStart(7, '0');
}

/** Best guess of which products a campaign books, from its name. Editable later in the registry. */
export function productsFromName(name: string): string[] {
  const n = name.toLowerCase();
  if (/event|evento|boda|wedding/.test(n)) return ['private_event'];
  if (/tienda|store|shop|vino online|online/.test(n)) return ['wine_order'];
  if (/tour|tasting|degusta|cata|recorrido/.test(n)) return ['tour_tasting'];
  if (/restaur|comida|lunch|dinner/.test(n)) return ['restaurant_visit'];
  return ['restaurant_visit', 'tour_tasting'];
}

const micros = (mxn: unknown) => Math.round(Number(mxn ?? 0) * 1_000_000);

export interface MirrorResult { campaigns: number; days: number; dataAsOf: number | null }

/** Google Ads (with a spend reading for the watchdog) and, when a Meta account is registered, Meta Ads. */
export async function mirrorFromHub(hub: D1Database, db: D1Database, accountKey: string, now: number, tz: string, days = 120): Promise<MirrorResult & { meta?: MirrorResult }> {
  const google = await mirrorPlatform(hub, db, 'google', accountKey, now, tz, days);
  const meta = await db.prepare("SELECT id FROM ad_accounts WHERE provider = 'meta_ads' ORDER BY created_at LIMIT 1").first<{ id: string }>();
  return meta ? { ...google, meta: await mirrorPlatform(hub, db, 'meta', meta.id, now, tz, days) } : google;
}

/** One platform's daily rows. Meta money is already in MXN in the Hub (converted at each day's USD rate, which the
 *  Hub keeps); weekly hand-loaded Meta rows (days = 7) are skipped. */
export async function mirrorPlatform(hub: D1Database, db: D1Database, platform: 'google' | 'meta', accountKey: string, now: number, tz: string, days = 120): Promise<MirrorResult> {
  const since = addDays(localDate(now, tz), -days);
  const [perf, camps, cfg] = await Promise.all([
    hub.prepare("SELECT campaign, period_start, spend, impressions, clicks, conversions, value FROM ads_perf WHERE platform = ? AND days = 1 AND period_start >= ?").bind(platform, since).all<Record<string, unknown>>(),
    hub.prepare("SELECT campaign, status, type, daily_budget FROM ads_campaigns WHERE platform = ?").bind(platform).all<Record<string, unknown>>(),
    hub.prepare('SELECT value FROM ads_config WHERE key = ?').bind(platform === 'google' ? 'last_ingest' : 'meta_last_sync').first<{ value: string }>(),
  ]);
  const dataAsOf = cfg ? Number(cfg.value) : null;
  const names = new Set<string>([...camps.results.map(c => String(c.campaign)), ...perf.results.map(r => String(r.campaign))]);
  const byName = new Map(camps.results.map(c => [String(c.campaign), c]));
  const stmts: D1PreparedStatement[] = [];
  for (const name of names) {
    const c = byName.get(name);
    const key = nameKey(name);
    stmts.push(db.prepare(`INSERT INTO campaign_registry (ref, account_id, kind, external_id, name, status, channel, products_json, brand, booking_horizon_days, budget_micros, writable, managed_by, optimization_signal, updated_at)
      VALUES (?, ?, 'campaign', ?, ?, ?, ?, ?, 0, 21, ?, 0, 'unknown', ?, ?)
      ON CONFLICT(account_id, kind, external_id) DO UPDATE SET status = excluded.status, channel = excluded.channel, budget_micros = excluded.budget_micros, updated_at = excluded.updated_at`)
      .bind(`res_${platform === 'google' ? 'h' : 'm'}${key}`, accountKey, `name:${key}`, name.slice(0, 200), String(c?.status ?? ''), String(c?.type ?? '') || (platform === 'google' ? 'SEARCH' : 'META'), JSON.stringify(productsFromName(name)), c?.daily_budget == null ? null : micros(c.daily_budget),
        platform === 'google' ? 'Google Ads primary conversions (as configured in the account)' : 'Meta results (as configured in each ad set)', now));
  }
  for (const r of perf.results) {
    stmts.push(db.prepare(`INSERT INTO campaign_daily (account_id, campaign_id, date, currency, cost_micros, impressions, clicks, platform_conversions_milli, platform_conversion_value_micros, source, fetched_at)
      VALUES (?, ?, ?, 'MXN', ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(account_id, campaign_id, date) DO UPDATE SET cost_micros = excluded.cost_micros, impressions = excluded.impressions, clicks = excluded.clicks,
        platform_conversions_milli = excluded.platform_conversions_milli, platform_conversion_value_micros = excluded.platform_conversion_value_micros, fetched_at = excluded.fetched_at`)
      .bind(accountKey, `name:${nameKey(String(r.campaign))}`, String(r.period_start), micros(r.spend), Math.round(Number(r.impressions ?? 0)), Math.round(Number(r.clicks ?? 0)),
        Math.round(Number(r.conversions ?? 0) * 1000), micros(r.value), platform === 'google' ? 'hub_feed' : 'hub_feed_meta', now));
  }
  // Spend reading for the watchdog and exposure model. The Hub feed has no hourly breakdown: the busiest hour is
  // estimated conservatively as the busiest recent day spread over 8 hours.
  const today = localDate(now, tz), month = today.slice(0, 7);
  const mtd = perf.results.filter(r => String(r.period_start).startsWith(month)).reduce((a, r) => a + micros(r.spend), 0);
  const todaySpend = perf.results.filter(r => r.period_start === today).reduce((a, r) => a + micros(r.spend), 0);
  const perDay = new Map<string, number>();
  for (const r of perf.results) if (String(r.period_start) >= addDays(today, -7)) perDay.set(String(r.period_start), (perDay.get(String(r.period_start)) ?? 0) + micros(r.spend));
  const enabledBudget = camps.results.filter(c => c.status === 'ENABLED').reduce((a, c) => a + micros(c.daily_budget), 0);
  if (dataAsOf && platform === 'google') {
    stmts.push(db.prepare(`INSERT OR REPLACE INTO spend_readings (account_id, read_at, data_as_of, month, month_to_date_micros, today_micros, managed_daily_budget_micros, unmanaged_daily_budget_micros, max_hourly_micros) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`)
      .bind(accountKey, now, dataAsOf, month, mtd, todaySpend, enabledBudget, Math.round(Math.max(0, ...perDay.values()) / 8)));
  }
  stmts.push(db.prepare(`UPDATE connections SET health = ?, last_success_at = ?, freshness_at = ?, last_error = NULL, updated_at = ? WHERE id = ?`)
    .bind(platform === 'google' ? 'limited' : 'connected', now, dataAsOf, now, platform === 'google' ? 'conn_hub_google_ads' : 'conn_meta'));
  for (let i = 0; i < stmts.length; i += 80) await db.batch(stmts.slice(i, i + 80));
  return { campaigns: names.size, days: new Set(perf.results.map(r => r.period_start)).size, dataAsOf };
}
