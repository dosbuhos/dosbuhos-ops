// Evidence snapshots: the only view of the account the optimizer and the model get. Server-issued resource and
// evidence references; budgets from the registry (shared budgets once); per-campaign contribution only where
// bookings are linked to a campaign by a disclosed attribution method.
import type { Snapshot, RegisteredResource, Evidence } from '../policy/validate.ts';
import type { Product } from '../domain/measurement.ts';
import { addDays, localDate } from '../domain/time.ts';

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
  const snapshot: Snapshot = { snapshotId: `snap_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`, accountId: acct.external_id, currency: acct.currency, createdAt: now, resources, budgets, keywords: {}, evidence };
  await db.prepare('INSERT INTO snapshots (id, account_id, created_at, json) VALUES (?, ?, ?, ?)').bind(snapshot.snapshotId, accountKey, now, JSON.stringify({ ...snapshot, contributionRoasByRef })).run();
  return { snapshot, contributionRoasByRef };
}
