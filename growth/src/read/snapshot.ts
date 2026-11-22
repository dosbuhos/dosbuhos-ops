// Evidence snapshots: the only view of the account the optimizer and the model get. Server-issued resource and
// evidence references; budgets from the registry (shared budgets once); per-campaign contribution only where
// bookings are linked to a campaign by a disclosed attribution method.
import type { Snapshot, RegisteredResource, Evidence, SnapshotKeyword, SnapshotTerm, SnapshotNegative } from '../policy/validate.ts';
import type { Product } from '../domain/measurement.ts';
import type { MatchType } from '../domain/keywords.ts';
import { addDays, localDate } from '../domain/time.ts';
import { detect, loadDetectInput, termEvidenceIds } from './detectors.ts';

export async function buildSnapshot(db: D1Database, accountKey: string, now: number, wineryTz: string, maxLagDays: number): Promise<{ snapshot: Snapshot; contributionRoasByRef: Record<string, number | null> }> {
  const acct = await db.prepare('SELECT id, external_id, currency FROM ad_accounts WHERE id = ?').bind(accountKey).first<{ id: string; external_id: string; currency: 'MXN' | 'USD' }>();
  if (!acct) throw new Error(`Ad account ${accountKey} is not registered`);
  const reg = (await db.prepare('SELECT * FROM campaign_registry WHERE account_id = ?').bind(accountKey).all<Record<string, unknown>>()).results;
  const today = localDate(now, wineryTz);
  // Mature window: 28 days ending maxLag days ago, so outcomes have had time to happen.
  const to = addDays(today, -maxLagDays - 1), from = addDays(to, -27);
  const spend = (await db.prepare('SELECT campaign_id, SUM(cost_micros) AS cost, SUM(clicks) AS clicks, SUM(platform_conversions_milli) AS conv FROM campaign_daily WHERE account_id = ? AND date BETWEEN ? AND ? GROUP BY campaign_id').bind(accountKey, from, to).all<{ campaign_id: string; cost: number; clicks: number; conv: number | null }>()).results;
  const contrib = (await db.prepare(`SELECT l.campaign_ref AS ref, SUM(a.contribution_minor) AS contribution, COUNT(*) AS n, SUM(CASE WHEN a.contribution_minor IS NULL THEN 1 ELSE 0 END) AS unknown
    FROM attribution_links l JOIN revenue_allocations a ON a.booking_id = l.booking_id JOIN bookings b ON b.id = l.booking_id
    WHERE l.method != 'unknown' AND l.campaign_ref IS NOT NULL AND date(b.created_at_utc / 1000, 'unixepoch') BETWEEN ? AND ? GROUP BY l.campaign_ref`).bind(from, to).all<{ ref: string; contribution: number | null; n: number; unknown: number }>()).results;

  const resources: RegisteredResource[] = reg.map(r => ({
    ref: String(r.ref), kind: r.kind as 'campaign' | 'ad', accountId: acct.external_id, externalId: String(r.external_id), campaignId: String(r.parent_campaign_id ?? r.external_id),
    budgetId: (r.budget_id as string | null) ?? null, budgetShared: r.budget_shared === 1, label: String(r.name), products: JSON.parse(String(r.products_json)) as Product[],
    bookingHorizonDays: Number(r.booking_horizon_days), brand: r.brand === 1, writable: r.writable === 1, managedBy: r.managed_by as RegisteredResource['managedBy'],
  }));
  const budgets: Snapshot['budgets'] = {};
  for (const r of reg) if (r.budget_id && r.budget_micros !== null) {
    const b = budgets[String(r.budget_id)] ?? { amountMicros: Number(r.budget_micros), campaignIds: [] };
    b.campaignIds.push(String(r.external_id)); budgets[String(r.budget_id)] = b;
  }
  const evidence: Record<string, Evidence> = {};
  const contributionRoasByRef: Record<string, number | null> = {};
  for (const r of resources.filter(x => x.kind === 'campaign')) {
    const s = spend.find(x => x.campaign_id === r.externalId);
    const c = contrib.find(x => x.ref === r.ref);
    const slug = r.ref.replace(/^res_/, '');
    const spendMinor = s ? Math.round(s.cost / 10_000) : null;
    const croas = c && !c.unknown && c.contribution !== null && spendMinor ? c.contribution / spendMinor : null;
    contributionRoasByRef[r.ref] = croas;
    evidence[`ev_${slug}_spend_28d`] = { id: `ev_${slug}_spend_28d`, metric: 'ad_spend_minor', window: { from, to }, value: spendMinor, resourceRef: r.ref, provisional: false };
    evidence[`ev_${slug}_clicks_28d`] = { id: `ev_${slug}_clicks_28d`, metric: 'clicks', window: { from, to }, value: s?.clicks ?? null, resourceRef: r.ref, provisional: false };
    evidence[`ev_${slug}_croas_28d`] = { id: `ev_${slug}_croas_28d`, metric: 'contribution_roas_mature', window: { from, to }, value: croas, resourceRef: r.ref, provisional: false };
  }

  // What people searched in the last 28 complete days, per campaign: the base for measuring what a negative keyword
  // or a keyword pause would stop. Search numbers come from GA4 by campaign name, so they attach by name.
  const termTo = addDays(today, -1), termFrom = addDays(today, -28);
  const input = await loadDetectInput(db, today);
  const byName = new Map(resources.filter(x => x.kind === 'campaign').map(r => [r.label, r]));
  const terms: Record<string, SnapshotTerm[]> = {};
  for (const t of input.terms) { const r = byName.get(t.campaign); if (r) (terms[r.campaignId] ??= []).push({ text: t.query, clicks: t.clicks, costMicros: t.costMicros, opened: t.opened, reservations: t.reservations }); }

  // Keywords and negatives as the account last reported them. `keywords` stays empty until the feed carries them, and
  // then every campaign the app may change gets an entry (an empty one if it has no keywords), so "none" and
  // "unknown" are never confused.
  const q = async <T>(sql: string): Promise<T[]> => (await db.prepare(sql).bind(accountKey).all<T>().catch(() => ({ results: [] as T[] }))).results;
  const fed = (await q<{ t: number | null }>('SELECT keywords_at AS t FROM feed_state WHERE account_id = ?'))[0]?.t ?? null;
  const keywords: Snapshot['keywords'] = {}, keywordList: Record<string, SnapshotKeyword[]> = {}, negatives: Record<string, SnapshotNegative[]> = {};
  if (fed !== null) {
    for (const r of resources) if (r.kind === 'campaign' && /^\d+$/.test(r.externalId)) { keywords[r.campaignId] = []; keywordList[r.campaignId] = []; }
    for (const k of await q<{ campaign_id: string; ad_group_id: string; criterion_id: string; ad_group_name: string; text: string; match_type: MatchType; clicks: number; cost_micros: number; conversions_milli: number }>(
      "SELECT campaign_id, ad_group_id, criterion_id, ad_group_name, text, match_type, clicks, cost_micros, conversions_milli FROM keywords_live WHERE account_id = ? AND status = 'ENABLED' AND ad_group_status = 'ENABLED' ORDER BY cost_micros DESC")) {
      (keywords[k.campaign_id] ??= []).push(k.text);
      (keywordList[k.campaign_id] ??= []).push({ text: k.text, matchType: k.match_type, adGroupId: k.ad_group_id, criterionId: k.criterion_id, adGroupName: k.ad_group_name, clicks: Number(k.clicks) || 0, costMicros: Number(k.cost_micros) || 0, conversionsMilli: Number(k.conversions_milli) || 0 });
    }
  }
  for (const n of await q<{ campaign_id: string; text: string; match_type: MatchType; level: SnapshotNegative['level'] }>('SELECT campaign_id, text, match_type, level FROM negatives_live WHERE account_id = ?'))
    (negatives[n.campaign_id] ??= []).push({ text: n.text, matchType: n.match_type, level: n.level });

  // Each thing the fixed rules flagged cites its own numbers.
  for (const f of detect(input)) {
    const r = byName.get(f.campaign);
    if (!r || !f.query) continue;
    const ids = termEvidenceIds(r.ref, f.query), window = { from: termFrom, to: termTo };
    evidence[ids.cost] = { id: ids.cost, metric: 'search_cost_minor', window, value: Math.round(f.stats.costMicros / 10_000), resourceRef: r.ref, provisional: false };
    evidence[ids.clicks] = { id: ids.clicks, metric: 'search_clicks', window, value: f.stats.clicks, resourceRef: r.ref, provisional: false };
    evidence[ids.reservations] = { id: ids.reservations, metric: 'search_online_reservations', window, value: f.stats.reservations, resourceRef: r.ref, provisional: false };
  }
  const snapshot: Snapshot = { snapshotId: `snap_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`, accountId: acct.external_id, currency: acct.currency, createdAt: now, resources, budgets, keywords, ...(fed !== null ? { keywordList } : {}), terms, negatives, termsWindow: { from: termFrom, to: termTo }, evidence };
  await db.prepare('INSERT INTO snapshots (id, account_id, created_at, json) VALUES (?, ?, ?, ?)').bind(snapshot.snapshotId, accountKey, now, JSON.stringify({ ...snapshot, contributionRoasByRef })).run();
  return { snapshot, contributionRoasByRef };
}
