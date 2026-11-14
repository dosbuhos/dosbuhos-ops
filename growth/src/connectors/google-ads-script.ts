// Write path through a Google Ads Script (no API developer token). Writes are queued in D1; the script in the Google
// Ads account applies them (checking the "before" value first) and posts the account's live state back through the
// feed. Reads come from that posted state. While an operation on a resource is still queued, reads of that resource
// fail as "ambiguous", so the coordinator keeps the action in UNKNOWN_OUTCOME instead of judging it too early.
import { ProviderError, type AdsProvider, type EntityStatus } from './ads-provider.ts';

/** Posted state older than this is not trusted for a before/after check. */
export const SCRIPT_STATE_MAX_AGE_MS = 3 * 3600_000;
/** Queued operations the script has not picked up by then are dropped, never applied late. */
export const SCRIPT_OP_TTL_MS = 6 * 3600_000;

export class ScriptAdsProvider implements AdsProvider {
  readonly kind = 'google_ads_script' as const;
  constructor(private readonly db: D1Database, private readonly now: () => number = Date.now) {}

  private async account(externalId: string): Promise<string> {
    const a = await this.db.prepare("SELECT id FROM ad_accounts WHERE provider = 'google_ads' AND external_id = ?").bind(externalId).first<{ id: string }>();
    if (!a) throw new ProviderError('rejected', `La cuenta ${externalId} no está registrada`);
    return a.id;
  }
  private async freshState(acct: string): Promise<void> {
    const c = await this.db.prepare("SELECT last_success_at FROM connections WHERE id = 'conn_google_ads_script'").first<{ last_success_at: number | null }>();
    if (!c?.last_success_at || this.now() - c.last_success_at > SCRIPT_STATE_MAX_AGE_MS) throw new ProviderError('ambiguous', 'El script de Google Ads no ha reportado el estado de la cuenta en las últimas 3 horas');
    void acct;
  }
  private async notPending(acct: string, column: 'budget_id' | 'campaign_id' | 'ad_id', ids: string[], kind?: string): Promise<void> {
    if (!ids.length) return;
    const rows = (await this.db.prepare(`SELECT ${column} AS id FROM script_ops WHERE account_id = ? AND status IN ('queued', 'sent') AND ${column} IN (${ids.map(() => '?').join(',')})${kind ? ' AND kind = ?' : ''}`)
      .bind(acct, ...ids, ...(kind ? [kind] : [])).all<{ id: string }>()).results;
    if (rows.length) throw new ProviderError('ambiguous', `Hay un cambio en cola para ${rows.map(r => r.id).join(', ')}; el script todavía no lo aplica`);
  }

  async readBudgets(accountId: string, budgetIds: string[]): Promise<Record<string, number>> {
    const acct = await this.account(accountId); await this.freshState(acct); await this.notPending(acct, 'budget_id', budgetIds);
    const rows = (await this.db.prepare(`SELECT budget_id, budget_micros FROM campaign_registry WHERE account_id = ? AND budget_id IN (${budgetIds.map(() => '?').join(',')})`).bind(acct, ...budgetIds).all<{ budget_id: string; budget_micros: number | null }>()).results;
    return Object.fromEntries(rows.filter(r => r.budget_micros !== null).map(r => [r.budget_id, Number(r.budget_micros)]));
  }
  async readCampaignStatus(accountId: string, campaignIds: string[]): Promise<Record<string, EntityStatus>> {
    const acct = await this.account(accountId); await this.freshState(acct); await this.notPending(acct, 'campaign_id', campaignIds, 'pause_campaign');
    const rows = (await this.db.prepare(`SELECT external_id, status FROM campaign_registry WHERE account_id = ? AND kind = 'campaign' AND external_id IN (${campaignIds.map(() => '?').join(',')})`).bind(acct, ...campaignIds).all<{ external_id: string; status: string }>()).results;
    return Object.fromEntries(rows.map(r => [r.external_id, r.status as EntityStatus]));
  }
  async readAdStatus(accountId: string, adIds: string[]): Promise<Record<string, EntityStatus>> {
    const acct = await this.account(accountId); await this.freshState(acct); await this.notPending(acct, 'ad_id', adIds);
    const rows = (await this.db.prepare(`SELECT ad_id, status FROM ads_live WHERE account_id = ? AND ad_id IN (${adIds.map(() => '?').join(',')})`).bind(acct, ...adIds).all<{ ad_id: string; status: string }>()).results;
    return Object.fromEntries(rows.map(r => [r.ad_id, r.status as EntityStatus]));
  }
  async readNegatives(accountId: string, campaignId: string): Promise<string[]> {
    const acct = await this.account(accountId); await this.freshState(acct); await this.notPending(acct, 'campaign_id', [campaignId], 'add_negative_exact');
    return (await this.db.prepare('SELECT text FROM negatives_live WHERE account_id = ? AND campaign_id = ?').bind(acct, campaignId).all<{ text: string }>()).results.map(r => r.text);
  }

  private async enqueue(accountId: string, id: string, op: { kind: string; campaignId?: string; budgetId?: string; adId?: string; text?: string; fromMicros?: number; toMicros?: number }): Promise<void> {
    const acct = await this.account(accountId);
    await this.db.prepare('INSERT OR IGNORE INTO script_ops (id, account_id, kind, campaign_id, budget_id, ad_id, text, from_micros, to_micros, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(id, acct, op.kind, op.campaignId ?? null, op.budgetId ?? null, op.adId ?? null, op.text ?? null, op.fromMicros ?? null, op.toMicros ?? null, this.now()).run();
  }
  async setBudget(accountId: string, budgetId: string, amountMicros: number, idempotencyKey: string): Promise<void> {
    const before = (await this.readBudgets(accountId, [budgetId]))[budgetId];
    if (before === undefined) throw new ProviderError('rejected', `No se conoce el presupuesto ${budgetId}`);
    await this.enqueue(accountId, idempotencyKey, { kind: 'set_budget', budgetId, fromMicros: before, toMicros: amountMicros });
  }
  async setCampaignStatus(accountId: string, campaignId: string, status: 'ENABLED' | 'PAUSED', idempotencyKey: string): Promise<void> {
    if (status !== 'PAUSED') throw new ProviderError('not_enabled', 'El script solo pausa campañas; reanudar se hace en Google Ads');
    await this.enqueue(accountId, idempotencyKey, { kind: 'pause_campaign', campaignId });
  }
  async setAdStatus(accountId: string, adId: string, status: 'ENABLED' | 'PAUSED', idempotencyKey: string): Promise<void> {
    if (status !== 'PAUSED') throw new ProviderError('not_enabled', 'El script solo pausa anuncios');
    await this.enqueue(accountId, idempotencyKey, { kind: 'pause_ad', adId });
  }
  async addNegativeExact(accountId: string, campaignId: string, text: string, idempotencyKey: string): Promise<void> {
    await this.enqueue(accountId, idempotencyKey, { kind: 'add_negative_exact', campaignId, text });
  }
}
