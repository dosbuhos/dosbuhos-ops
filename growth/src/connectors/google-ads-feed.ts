// Google Ads Script feed (Phase 1 read path). scripts/google-ads-feed.js runs inside the owner's Google Ads account
// on Google's scheduler and POSTs this payload with a bearer token. It needs no Google Ads API developer access.
// The payload is untrusted input: validated, size-limited, bound to a registered account, and stored as data.
import { z } from 'zod';

const Id = z.string().regex(/^\d{1,20}$/);
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Int = z.number().int().nonnegative().max(1e15);
const Text = (n: number) => z.string().max(n).transform(s => s.replace(/[\u0000-\u001f\u007f]/g, ' ').trim());

export const FeedPayload = z.object({
  schemaVersion: z.literal('1'),
  generatedAt: z.string().datetime({ offset: true }),
  account: z.object({ customerId: Id, currency: z.enum(['MXN', 'USD']), timeZone: z.string().max(64), name: Text(120) }),
  campaigns: z.array(z.object({
    id: Id, name: Text(200), status: z.enum(['ENABLED', 'PAUSED', 'REMOVED']), channel: Text(40),
    budgetId: Id.nullable(), budgetMicros: Int.nullable(), budgetShared: z.boolean(), biddingStrategy: Text(60),
  })).max(500),
  daily: z.array(z.object({
    date: Day, campaignId: Id, costMicros: Int, impressions: Int, clicks: Int,
    conversions: z.number().nonnegative().max(1e9).nullable(), conversionValue: z.number().nonnegative().max(1e13).nullable(),
  })).max(60_000),
  today: z.object({ date: Day, costMicros: Int, maxHourlyMicros: Int, dataAsOf: z.string().datetime({ offset: true }) }),
  monthToDateMicros: Int,
  searchTerms: z.array(z.object({ campaignId: Id, from: Day, to: Day, term: Text(200), matchType: Text(30), keyword: Text(200), costMicros: Int, clicks: Int, conversions: z.number().nonnegative().nullable() })).max(20_000).default([]),
  changes: z.array(z.object({ at: z.string().datetime({ offset: true }), resourceType: Text(40), campaignId: Id.nullable(), budgetId: Id.nullable(), oldBudgetMicros: Int.nullable(), newBudgetMicros: Int.nullable(), clientType: Text(40) })).max(5_000).default([]),
});
export type FeedPayload = z.infer<typeof FeedPayload>;

export const MAX_FEED_BYTES = 8 * 1024 * 1024;

/** D1 statements for one payload. Idempotent: replaying the same payload yields the same rows. */
export function feedStatements(db: D1Database, accountId: string, p: FeedPayload, now: number, managedCampaignIds: ReadonlySet<string>): D1PreparedStatement[] {
  const s: D1PreparedStatement[] = [];
  for (const c of p.campaigns) {
    s.push(db.prepare(`INSERT INTO campaign_registry (ref, account_id, kind, external_id, name, status, channel, budget_id, budget_shared, budget_micros, updated_at)
      VALUES (?, ?, 'campaign', ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(account_id, kind, external_id) DO UPDATE SET name = excluded.name, status = excluded.status, channel = excluded.channel,
        budget_id = excluded.budget_id, budget_shared = excluded.budget_shared, budget_micros = excluded.budget_micros, updated_at = excluded.updated_at`)
      .bind(`res_c${c.id}`, accountId, c.id, c.name, c.status, c.channel, c.budgetId, c.budgetShared ? 1 : 0, c.budgetMicros, now));
  }
  for (const d of p.daily) {
    s.push(db.prepare(`INSERT INTO campaign_daily (account_id, campaign_id, date, currency, cost_micros, impressions, clicks, platform_conversions_milli, platform_conversion_value_micros, source, fetched_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'google_ads_script', ?)
      ON CONFLICT(account_id, campaign_id, date) DO UPDATE SET cost_micros = excluded.cost_micros, impressions = excluded.impressions, clicks = excluded.clicks,
        platform_conversions_milli = excluded.platform_conversions_milli, platform_conversion_value_micros = excluded.platform_conversion_value_micros, fetched_at = excluded.fetched_at`)
      .bind(accountId, d.campaignId, d.date, p.account.currency, d.costMicros, d.impressions, d.clicks,
        d.conversions === null ? null : Math.round(d.conversions * 1000), d.conversionValue === null ? null : Math.round(d.conversionValue * 1e6), now));
  }
  const managed = p.campaigns.filter(c => c.status === 'ENABLED' && managedCampaignIds.has(c.id));
  const unmanaged = p.campaigns.filter(c => c.status === 'ENABLED' && !managedCampaignIds.has(c.id));
  const budgetSum = (cs: typeof p.campaigns) => [...new Map(cs.map(c => [c.budgetId ?? c.id, c.budgetMicros ?? 0])).values()].reduce((a, b) => a + b, 0);
  s.push(db.prepare(`INSERT OR REPLACE INTO spend_readings (account_id, read_at, data_as_of, month, month_to_date_micros, today_micros, managed_daily_budget_micros, unmanaged_daily_budget_micros, max_hourly_micros)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(accountId, now, Date.parse(p.today.dataAsOf), p.today.date.slice(0, 7), p.monthToDateMicros, p.today.costMicros, budgetSum(managed), budgetSum(unmanaged), p.today.maxHourlyMicros));
  for (const t of p.searchTerms) {
    s.push(db.prepare(`INSERT OR REPLACE INTO search_term_facts (account_id, campaign_id, date_from, date_to, term, match_type, keyword, cost_micros, clicks, conversions_milli) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(accountId, t.campaignId, t.from, t.to, t.term, t.matchType, t.keyword, t.costMicros, t.clicks, t.conversions === null ? null : Math.round(t.conversions * 1000)));
  }
  s.push(db.prepare(`UPDATE connections SET health = 'connected', health_reason = '', last_success_at = ?, freshness_at = ?, last_error = NULL, updated_at = ? WHERE provider = 'google_ads_script'`).bind(now, Date.parse(p.today.dataAsOf), now));
  return s;
}

/** Budget changes from change history, for the coordinator's rolling-limit ledger (changes by anyone count). */
export function budgetChanges(p: FeedPayload): { budgetId: string; at: number; fromMicros: number; toMicros: number; clientType: string }[] {
  return p.changes.filter(c => c.budgetId && c.oldBudgetMicros !== null && c.newBudgetMicros !== null)
    .map(c => ({ budgetId: c.budgetId!, at: Date.parse(c.at), fromMicros: c.oldBudgetMicros!, toMicros: c.newBudgetMicros!, clientType: c.clientType }));
}
