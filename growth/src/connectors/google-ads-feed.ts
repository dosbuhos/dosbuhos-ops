// Google Ads Script feed (Phase 1 read path). scripts/google-ads-feed.js runs inside the owner's Google Ads account
// on Google's scheduler and POSTs this payload with a bearer token. It needs no Google Ads API developer access.
// The payload is untrusted input: validated, size-limited, bound to a registered account, and stored as data.
//
// The sections added after the first version (keywords, the keyword behind each search, negatives with their match
// type, warnings) are optional and read row by row: an older script keeps working, and one odd row never costs the
// spend numbers that arrive in the same payload.
import { z } from 'zod';
import { MATCH_TYPES } from '../domain/keywords.ts';

const Id = z.string().regex(/^\d{1,20}$/);
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Int = z.number().int().nonnegative().max(1e15);
const Text = (n: number) => z.string().max(n).transform(s => s.replace(/[\u0000-\u001f\u007f]/g, ' ').trim());
const Match = z.enum(MATCH_TYPES);

/** Rows that do not fit the schema are dropped and counted, instead of failing the whole payload. */
function rows<S extends z.ZodTypeAny>(schema: S, max: number) {
  return z.array(z.unknown()).max(max).transform(list => {
    const ok: z.output<S>[] = []; let bad = 0;
    for (const r of list) { const p = schema.safeParse(r); if (p.success) ok.push(p.data as z.output<S>); else bad++; }
    return { ok, bad };
  });
}

const Keyword = z.object({
  campaignId: Id, adGroupId: Id, adGroupName: Text(200).default(''), criterionId: Id, text: Text(200).pipe(z.string().min(1)), matchType: Match,
  status: z.enum(['ENABLED', 'PAUSED']), adGroupStatus: z.enum(['ENABLED', 'PAUSED']).default('ENABLED'),
  clicks: Int.default(0), costMicros: Int.default(0), impressions: Int.default(0), conversions: z.number().nonnegative().max(1e9).default(0),
});
const TermKeyword = z.object({
  campaignId: Id, adGroupId: Id.or(z.literal('')).default(''), criterionId: Id.or(z.literal('')).default(''), term: Text(200).pipe(z.string().min(1)),
  keyword: Text(200).pipe(z.string().min(1)), keywordMatchType: Text(30).default(''), clicks: Int, costMicros: Int,
});
const Negative = z.object({
  campaignId: Id, text: Text(200).pipe(z.string().min(1)), matchType: Match.default('EXACT'),
  level: z.enum(['campaign', 'ad_group', 'list']).default('campaign'), scopeId: z.string().max(40).regex(/^\d*$/).default(''),
});

export const FeedPayload = z.object({
  schemaVersion: z.literal('1'),
  generatedAt: z.string().datetime({ offset: true }),
  scriptVersion: Text(40).optional(),
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
  ads: z.array(z.object({ id: Id, campaignId: Id, status: z.enum(['ENABLED', 'PAUSED', 'REMOVED']) })).max(20_000).optional(),
  negatives: rows(Negative, 20_000).optional(),
  // true when `negatives` holds every level and match type; an older script sends only the campaign's exact ones
  negativesComplete: z.boolean().optional(),
  keywords: rows(Keyword, 20_000).optional(),
  keywordStats: z.object({ from: Day, to: Day }).optional(),
  termKeywords: rows(TermKeyword, 20_000).optional(),
  termsWindow: z.object({ from: Day, to: Day }).optional(),
  warnings: z.array(Text(300)).max(20).optional(),
  changes: z.array(z.object({ at: z.string().datetime({ offset: true }), resourceType: Text(40), campaignId: Id.nullable(), budgetId: Id.nullable(), oldBudgetMicros: Int.nullable(), newBudgetMicros: Int.nullable(), clientType: Text(40) })).max(5_000).default([]),
});
export type FeedPayload = z.infer<typeof FeedPayload>;

export const MAX_FEED_BYTES = 8 * 1024 * 1024;
/** The version of scripts/google-ads-feed.js in this repository (a test keeps the two equal). The app compares it with
 *  what the running script reports, to say whether the copy in Google Ads is the current one. */
export const SCRIPT_VERSION = '2026-11-22.2';

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
  // Each run sends the whole 28-day window again, so older windows are only copies of the same searches.
  if (p.searchTerms.length) s.push(db.prepare('DELETE FROM search_term_facts WHERE account_id = ? AND date_to < ?').bind(accountId, shiftDay(p.today.date, -7)));
  for (const t of p.searchTerms) {
    s.push(db.prepare(`INSERT OR REPLACE INTO search_term_facts (account_id, campaign_id, date_from, date_to, term, match_type, keyword, cost_micros, clicks, conversions_milli) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(accountId, t.campaignId, t.from, t.to, t.term, t.matchType, t.keyword, t.costMicros, t.clicks, t.conversions === null ? null : Math.round(t.conversions * 1000)));
  }
  // Live ads, negatives and keywords of enabled campaigns: what the write path checks before and after a change.
  // Rows are written first and the ones this run did not carry are swept at the end, so a reader never finds a table
  // half empty (the statements run in several batches).
  const sweep: D1PreparedStatement[] = [];
  if (p.ads) {
    for (const a of p.ads) s.push(db.prepare('INSERT OR REPLACE INTO ads_live (account_id, ad_id, campaign_id, status, seen_at) VALUES (?, ?, ?, ?, ?)').bind(accountId, a.id, a.campaignId, a.status, now));
    sweep.push(db.prepare('DELETE FROM ads_live WHERE account_id = ? AND seen_at < ?').bind(accountId, now));
  }
  if (p.negatives) {
    for (const n of p.negatives.ok) s.push(db.prepare('INSERT OR REPLACE INTO negatives_live (account_id, campaign_id, text, match_type, level, scope_id, seen_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(accountId, n.campaignId, n.text, n.matchType, n.level, n.scopeId, now));
    sweep.push(db.prepare('DELETE FROM negatives_live WHERE account_id = ? AND seen_at < ?').bind(accountId, now));
  }
  if (p.keywords) {
    for (const k of p.keywords.ok) s.push(db.prepare(`INSERT OR REPLACE INTO keywords_live (account_id, campaign_id, ad_group_id, criterion_id, ad_group_name, text, match_type, status, ad_group_status, clicks, cost_micros, impressions, conversions_milli, stats_from, stats_to, seen_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(accountId, k.campaignId, k.adGroupId, k.criterionId, k.adGroupName, k.text, k.matchType, k.status, k.adGroupStatus, k.clicks, k.costMicros, k.impressions, Math.round(k.conversions * 1000), p.keywordStats?.from ?? null, p.keywordStats?.to ?? null, now));
    sweep.push(db.prepare('DELETE FROM keywords_live WHERE account_id = ? AND seen_at < ?').bind(accountId, now));
  }
  if (p.termKeywords) {
    const w = p.termsWindow ?? (p.searchTerms[0] ? { from: p.searchTerms[0].from, to: p.searchTerms[0].to } : { from: shiftDay(p.today.date, -28), to: p.today.date });
    for (const t of p.termKeywords.ok) s.push(db.prepare(`INSERT OR REPLACE INTO search_term_keywords (account_id, campaign_id, term, ad_group_id, criterion_id, keyword, keyword_match_type, clicks, cost_micros, date_from, date_to, seen_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(accountId, t.campaignId, t.term, t.adGroupId, t.criterionId, t.keyword, t.keywordMatchType, t.clicks, t.costMicros, w.from, w.to, now));
    sweep.push(db.prepare('DELETE FROM search_term_keywords WHERE account_id = ? AND seen_at < ?').bind(accountId, now));
  }
  // What this run carried and what it could not read. A section that stops arriving keeps its last time, so the app
  // can tell "never sent" from "sent until yesterday".
  const dropped = [['palabras clave', p.keywords?.bad], ['palabra clave de cada búsqueda', p.termKeywords?.bad], ['negativas', p.negatives?.bad]].filter(([, n]) => Number(n) > 0).map(([what, n]) => `${n} filas de ${what} no se pudieron leer`);
  s.push(db.prepare(`INSERT INTO feed_state (account_id, script_version, keywords_at, term_keywords_at, negatives_full_at, warnings_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(account_id) DO UPDATE SET script_version = excluded.script_version, keywords_at = COALESCE(excluded.keywords_at, feed_state.keywords_at),
      term_keywords_at = COALESCE(excluded.term_keywords_at, feed_state.term_keywords_at), negatives_full_at = COALESCE(excluded.negatives_full_at, feed_state.negatives_full_at),
      warnings_json = excluded.warnings_json, updated_at = excluded.updated_at`)
    .bind(accountId, p.scriptVersion ?? '', p.keywords ? now : null, p.termKeywords ? now : null, p.negatives && p.negativesComplete ? now : null, JSON.stringify([...(p.warnings ?? []), ...dropped]), now));
  s.push(...sweep);
  // This feed replaces the Hub mirror for Google (real IDs instead of name keys): drop the mirror's rows so nothing is counted twice.
  s.push(db.prepare("DELETE FROM campaign_daily WHERE account_id = ? AND campaign_id LIKE 'name:%'").bind(accountId));
  s.push(db.prepare("DELETE FROM campaign_registry WHERE account_id = ? AND external_id LIKE 'name:%'").bind(accountId));
  s.push(db.prepare(`UPDATE connections SET health = 'connected', health_reason = '', last_success_at = ?, freshness_at = ?, last_error = NULL, updated_at = ? WHERE provider = 'google_ads_script'`).bind(now, Date.parse(p.today.dataAsOf), now));
  return s;
}

const shiftDay = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Budget changes from change history, for the coordinator's rolling-limit ledger (changes by anyone count). */
export function budgetChanges(p: FeedPayload): { budgetId: string; at: number; fromMicros: number; toMicros: number; clientType: string }[] {
  return p.changes.filter(c => c.budgetId && c.oldBudgetMicros !== null && c.newBudgetMicros !== null)
    .map(c => ({ budgetId: c.budgetId!, at: Date.parse(c.at), fromMicros: c.oldBudgetMicros!, toMicros: c.newBudgetMicros!, clientType: c.clientType }));
}
