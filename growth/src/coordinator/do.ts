// AccountCoordinator Durable Object: one instance per ad account (idFromName(accountKey)). It wraps CoordinatorCore
// on the object's SQLite storage and is reachable only through the Worker's own binding (RPC) — there is no public
// route that forwards arbitrary input to it. All methods take IDs or validated proposals, never raw mutations.
import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../env.ts';
import type { SqlStore } from './sql.ts';
import { CoordinatorCore, CoordinatorError, type ContextSource, type ExternalContext, type OutboxEvent } from './core.ts';
import { MockAdsProvider, type MockAccountState } from '../connectors/mock-ads.ts';
import { GoogleAdsApiProvider } from '../connectors/google-ads-api.ts';
import { validateProposal, type ActionIntent, type Snapshot } from '../policy/validate.ts';
import type { Mode } from '../domain/schemas.ts';
import type { Actor } from '../policy/evaluate.ts';
import { localParts, addDays, localDate } from '../domain/time.ts';
import { loadRaw, computeCapacity } from '../read/facts.ts';
import { capacitySupportsGrowth } from '../domain/capacity.ts';
import type { Product } from '../domain/measurement.ts';

function storageSql(ctx: DurableObjectState): SqlStore {
  return {
    all: <T>(q: string, ...b: unknown[]) => ctx.storage.sql.exec(q, ...b).toArray() as T[],
    run: (q: string, ...b: unknown[]) => { ctx.storage.sql.exec(q, ...b); },
    tx: <T>(fn: () => T) => ctx.storage.transactionSync(fn),
  };
}

export class AccountCoordinator extends DurableObject<Env> {
  private core!: CoordinatorCore;
  private mock: MockAdsProvider | null = null;
  private accountKey: string | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      const sql = storageSql(ctx);
      sql.run('CREATE TABLE IF NOT EXISTS mock_state (id INTEGER PRIMARY KEY CHECK (id = 1), json TEXT NOT NULL, account TEXT NOT NULL)');
      const mockEnv = env.ENVIRONMENT === 'dev' || env.ENVIRONMENT === 'demo';
      if (mockEnv) {
        const row = sql.all<{ json: string; account: string }>('SELECT json, account FROM mock_state WHERE id = 1')[0];
        this.mock = new MockAdsProvider(row ? JSON.parse(row.json) as MockAccountState : { budgets: {}, campaigns: {}, ads: {}, negatives: {} }, row?.account ?? '');
      }
      this.core = new CoordinatorCore(sql, { provider: this.mock ?? new GoogleAdsApiProvider(), environment: env.ENVIRONMENT });
      this.accountKey = sql.all<{ v: string }>("SELECT v FROM kv WHERE k = 'account_key'")[0]?.v ?? null;
    });
  }

  private persistMock(): void {
    if (this.mock) this.ctx.storage.sql.exec('INSERT OR REPLACE INTO mock_state (id, json, account) VALUES (1, ?, ?)', JSON.stringify(this.mock.state), this.mock.accountId);
  }

  /** Bind this object to one registered account. Demo/dev also seeds the mock account from the D1 registry. */
  async init(accountKey: string, initialMode: Mode, actor: string): Promise<void> {
    const acct = await this.env.DB.prepare('SELECT external_id FROM ad_accounts WHERE id = ?').bind(accountKey).first<{ external_id: string }>();
    if (!acct) throw new CoordinatorError('unknown_account', 'Account is not registered');
    if (this.accountKey && this.accountKey !== accountKey) throw new CoordinatorError('account_mismatch', 'Coordinator bound to another account');
    if (this.mock && Object.keys(this.mock.state.campaigns).length === 0) {
      const reg = (await this.env.DB.prepare("SELECT kind, external_id, status, budget_id, budget_micros FROM campaign_registry WHERE account_id = ?").bind(accountKey).all<{ kind: string; external_id: string; status: string; budget_id: string | null; budget_micros: number | null }>()).results;
      const state: MockAccountState = { budgets: {}, campaigns: {}, ads: {}, negatives: {} };
      for (const r of reg) {
        if (r.kind === 'campaign') state.campaigns[r.external_id] = (r.status || 'ENABLED') as 'ENABLED';
        else state.ads[r.external_id] = 'ENABLED';
        if (r.budget_id && r.budget_micros !== null) state.budgets[r.budget_id] = r.budget_micros;
      }
      this.mock = new MockAdsProvider(state, acct.external_id);
      this.core = new CoordinatorCore(storageSql(this.ctx), { provider: this.mock, environment: this.env.ENVIRONMENT });
      this.persistMock();
    }
    this.core.initialize(acct.external_id, initialMode, actor);
    this.ctx.storage.sql.exec("INSERT OR REPLACE INTO kv (k, v) VALUES ('account_key', ?)", accountKey);
    this.accountKey = accountKey;
  }

  state() { return this.core.state(); }
  actions(limit = 100) { return this.core.actions(limit).map(a => ({ ...a, intent: JSON.parse(a.intent), decision: JSON.parse(a.decision), op_results: JSON.parse(a.op_results) })); }
  ledger(actionId: string) { return this.core.ledger(actionId); }

  setMode(mode: Mode, actor: string, policyVersion?: number) { this.core.setMode(mode, actor, policyVersion === undefined ? undefined : { policyVersion }); return this.afterChange(); }
  setPolicy(policy: unknown, actor: string) { const v = this.core.setPolicy(policy, actor); void this.afterChange(); return v; }
  setBaseline(micros: number, actor: string) { this.core.setBaseline(micros, actor); return this.afterChange(); }
  setEmergencyLock(on: boolean, actor: string) { this.core.setEmergencyLock(on, actor); return this.afterChange(); }
  setAiStopped(on: boolean, actor: string) { this.core.setAiStopped(on, actor); return this.afterChange(); }
  clearSuspension(key: string, actor: string) { this.core.clearSuspension(key, actor); return this.afterChange(); }

  private async loadSnapshot(id: string): Promise<{ snapshot: Snapshot; contributionRoasByRef: Record<string, number | null> }> {
    const row = await this.env.DB.prepare('SELECT json FROM snapshots WHERE id = ?').bind(id).first<{ json: string }>();
    if (!row) throw new CoordinatorError('unknown_snapshot', 'Snapshot not found');
    const parsed = JSON.parse(row.json) as Snapshot & { contributionRoasByRef?: Record<string, number | null> };
    return { snapshot: parsed, contributionRoasByRef: parsed.contributionRoasByRef ?? {} };
  }

  /** Fresh policy inputs from D1: spend reading, capacity for the campaign's horizon, measurement maturity. */
  private context(snapshotId: string): ContextSource {
    return async (intent: ActionIntent): Promise<ExternalContext> => {
      const { snapshot, contributionRoasByRef } = await this.loadSnapshot(snapshotId.split(':')[0]!);
      const now = Date.now();
      const spend = await this.env.DB.prepare('SELECT * FROM spend_readings WHERE account_id = ? ORDER BY read_at DESC LIMIT 1').bind(this.accountKey).first<Record<string, number>>();
      const raw = await loadRaw({ db: this.env.DB, now, wineryTz: this.env.WINERY_TZ, currency: snapshot.currency, days: 35 });
      const cap = computeCapacity(raw, now, raw.today);
      const touched = snapshot.resources.filter(r => intent.campaignIds.includes(r.externalId));
      const products = [...new Set(touched.flatMap(r => r.products))] as Product[];
      const horizon = Math.max(1, ...touched.map(r => r.bookingHorizonDays));
      const lagKnown = raw.products.filter(p => products.includes(p.id)).every(p => p.lag_estimated_from_data === 1);
      const p = localParts(now, this.env.WINERY_TZ);
      const daysInMonth = new Date(Date.UTC(p.year, p.month, 0)).getUTCDate();
      return {
        snapshot,
        spend: spend ? { readAt: spend.read_at!, dataAsOf: spend.data_as_of!, monthToDateMicros: spend.month_to_date_micros!, observedMaxHourlyMicros: spend.max_hourly_micros!, unmanagedDailyBudgetsMicros: [spend.unmanaged_daily_budget_micros!] } : null,
        measurementMature: lagKnown && products.length > 0,
        capacity: products.length ? capacitySupportsGrowth(cap.days, products, { from: raw.today, to: addDays(raw.today, horizon) }) : null,
        contributionRoasByRef,
        daysRemainingInMonth: daysInMonth - p.day + (24 - p.hour) / 24,
      };
    };
  }

  /** Validate untrusted model output against its snapshot, then let policy decide. */
  async submitProposal(raw: unknown, snapshotId: string, actor: Actor): Promise<{ accepted: boolean; actionId?: string; state?: string; errors?: string[]; reasons?: string[] }> {
    const { snapshot } = await this.loadSnapshot(snapshotId);
    const v = validateProposal(raw, snapshot);
    if (!v.ok) return { accepted: false, errors: v.errors };
    const { action, decision } = await this.core.propose(v.intent, actor, this.context(snapshotId));
    await this.afterChange();
    return { accepted: action.state !== 'REJECTED', actionId: action.id, state: action.state, reasons: decision.reasons };
  }

  approve(actionId: string, hash: string, approver: string) { const a = this.core.approve(actionId, hash, approver); void this.afterChange(); return { id: a.id, state: a.state }; }

  async execute(actionId: string): Promise<{ id: string; state: string }> {
    const a = this.core.action(actionId);
    if (!a) throw new CoordinatorError('not_found', 'No such action');
    const intent = JSON.parse(a.intent) as ActionIntent;
    try { const r = await this.core.execute(actionId, this.context(intent.snapshotId)); return { id: r.id, state: r.state }; }
    finally { this.persistMock(); await this.afterChange(); }
  }
  async reconcile(actionId: string) { try { const r = await this.core.reconcile(actionId); return { id: r.id, state: r.state }; } finally { await this.afterChange(); } }
  async compensate(actionId: string, actor: string) { try { const r = await this.core.compensate(actionId, actor); return { id: r.action.id, state: r.action.state, refused: r.refused ?? null }; } finally { this.persistMock(); await this.afterChange(); } }

  async pauseManaged(snapshotId: string, actor: string) {
    const { snapshot } = await this.loadSnapshot(snapshotId);
    try { return await this.core.pauseManaged(snapshot, actor, this.context(snapshotId)); }
    finally { this.persistMock(); await this.afterChange(); }
  }

  /** Budget changes from provider change history (anyone's) feed the rolling-limit ledger. */
  recordBudgetChanges(changes: { budgetId: string; at: number; fromMicros: number; toMicros: number }[]): number {
    for (const c of changes) this.core.recordExternalBudgetChange(c);
    return changes.length;
  }

  async reconcileAll(actor: string) { try { return await this.core.reconcileAll(actor); } finally { await this.afterChange(); } }
  exportAll() { return this.core.exportAll(); }

  /** Mirror outbox events into D1 (idempotent by event id) and acknowledge them. A failed mirror leaves events
   *  pending; it never causes a second mutation because execution state lives here, not in D1. */
  async drainOutbox(): Promise<{ mirrored: number; pending: number }> {
    const pending = this.core.pendingOutbox(200);
    const acked: string[] = [];
    const stmts: D1PreparedStatement[] = [];
    for (const e of pending) {
      const p = JSON.parse(e.payload) as OutboxEvent & { kind?: string; actor?: string };
      if (p.actionId) {
        stmts.push(this.env.DB.prepare(`INSERT OR IGNORE INTO action_ledger_projection (event_id, account_id, action_id, action_type, actor, label, from_state, to_state, at, operations_json, detail_json, policy_version)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(p.eventId, this.accountKey, p.actionId, p.action.type, p.action.actor, p.action.label, p.from, p.to, p.at, JSON.stringify(p.action.operations), JSON.stringify(p.detail), p.action.policyVersion));
      } else {
        stmts.push(this.env.DB.prepare('INSERT OR IGNORE INTO audit_events (id, at, actor, action, resource, detail_json, config_version) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .bind(p.eventId, p.at, String(p.actor ?? 'system'), String(p.kind ?? 'event'), `coordinator:${this.accountKey}`, JSON.stringify(p.detail ?? {}), this.core.policyVersion()));
      }
      acked.push(e.eventId);
    }
    if (stmts.length) { await this.env.DB.batch(stmts); this.core.ack(acked); }
    this.core.pruneOutbox(30);
    return { mirrored: acked.length, pending: this.core.pendingOutbox(1).length };
  }

  private async afterChange(): Promise<void> {
    try { await this.drainOutbox(); } catch { /* stays pending; the watchdog drains and alerts */ }
  }

  /** For the demo only: simulate an owner/agency edit in the mock account (to show external-change handling). */
  simulateExternalBudgetEdit(budgetId: string, micros: number): void {
    if (!this.mock) throw new CoordinatorError('not_demo', 'Only available with the mock provider');
    this.mock.state.budgets[budgetId] = micros; this.persistMock();
  }
}

export const coordinatorFor = (env: Env, accountKey: string) => env.COORDINATOR.get(env.COORDINATOR.idFromName(accountKey));

/** The coordinator for an account, initialized on first use (DEMO with the mock provider, otherwise OBSERVE).
 *  Any error other than "not initialized" propagates, so a coordinator that is really down still raises an alert. */
export async function readyCoordinator(env: Env, accountKey: string) {
  const stub = coordinatorFor(env, accountKey);
  try { await stub.state(); }
  catch (e) {
    if (!/not initialized/i.test((e as Error).message)) throw e;
    await stub.init(accountKey, env.ENVIRONMENT === 'dev' || env.ENVIRONMENT === 'demo' ? 'DEMO' : 'OBSERVE', 'system');
  }
  return stub;
}
export const todayIn = (tz: string) => localDate(Date.now(), tz);
