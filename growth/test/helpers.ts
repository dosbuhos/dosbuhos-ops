import { DatabaseSync } from 'node:sqlite';
import type { SqlStore } from '../src/coordinator/sql.ts';
import { CoordinatorCore, type ContextSource } from '../src/coordinator/core.ts';
import { MockAdsProvider } from '../src/connectors/mock-ads.ts';
import { DEFAULT_POLICY, type PolicyConfig, type ModelProposal } from '../src/domain/schemas.ts';
import type { Snapshot } from '../src/policy/validate.ts';

/** Node's built-in SQLite behind the coordinator's SqlStore interface (same SQL dialect as Durable Object storage). */
export function memorySql(): SqlStore {
  const db = new DatabaseSync(':memory:');
  let depth = 0;
  return {
    all: <T>(q: string, ...b: unknown[]) => db.prepare(q).all(...(b as never[])) as T[],
    run: (q: string, ...b: unknown[]) => { db.prepare(q).run(...(b as never[])); },
    tx: <T>(fn: () => T): T => {
      if (depth > 0) return fn();
      depth++; db.exec('BEGIN');
      try { const r = fn(); db.exec('COMMIT'); return r; }
      catch (e) { db.exec('ROLLBACK'); throw e; }
      finally { depth--; }
    },
  };
}

export const ACCOUNT = '1234567890';
export const M = (units: number) => units * 1_000_000;

export function snapshot(budgets: Record<string, number> = { b1: M(500), b2: M(300) }): Snapshot {
  return {
    snapshotId: 'snap_test0001', accountId: ACCOUNT, currency: 'MXN', createdAt: 0,
    resources: [
      { ref: 'res_tours01', kind: 'campaign', accountId: ACCOUNT, externalId: '111', campaignId: '111', budgetId: 'b1', budgetShared: false, label: 'Tours EN', products: ['tour_tasting'], bookingHorizonDays: 21, brand: false, writable: true, managedBy: 'app' },
      { ref: 'res_resto01', kind: 'campaign', accountId: ACCOUNT, externalId: '222', campaignId: '222', budgetId: 'b2', budgetShared: false, label: 'Restaurante ES', products: ['restaurant_visit'], bookingHorizonDays: 10, brand: false, writable: true, managedBy: 'app' },
      { ref: 'res_brand01', kind: 'campaign', accountId: ACCOUNT, externalId: '333', campaignId: '333', budgetId: 'b3', budgetShared: false, label: 'Marca', products: ['restaurant_visit', 'tour_tasting'], bookingHorizonDays: 30, brand: true, writable: false, managedBy: 'owner' },
      { ref: 'res_ad00001', kind: 'ad', accountId: ACCOUNT, externalId: 'ad1', campaignId: '111', budgetId: null, budgetShared: false, label: 'Tours EN · ad 1', products: ['tour_tasting'], bookingHorizonDays: 21, brand: false, writable: true, managedBy: 'app' },
    ],
    budgets: { b1: { amountMicros: budgets.b1 ?? M(500), campaignIds: ['111'] }, b2: { amountMicros: budgets.b2 ?? M(300), campaignIds: ['222'] }, b3: { amountMicros: M(200), campaignIds: ['333'] } },
    keywords: { '111': ['wine tour san miguel', 'vineyard tour'], '222': ['restaurante san miguel'] },
    evidence: { ev_tours_croas_28d: { id: 'ev_tours_croas_28d', metric: 'contribution_roas', window: { from: '2026-10-01', to: '2026-10-28' }, value: 2.4, resourceRef: 'res_tours01', provisional: false } },
  };
}

export function proposal(over: Partial<ModelProposal> = {}): ModelProposal {
  return {
    schemaVersion: '1', snapshotId: 'snap_test0001', hypothesis: 'Tours EN is budget-limited with mature contribution ROAS above the floor',
    actionType: 'campaign_budget_change', resourceRef: 'res_tours01', parameters: { changePct: 10 }, evidenceRefs: ['ev_tours_croas_28d'],
    expectedEffect: { metric: 'completed_guests', direction: 'increase', range: null }, risks: ['Marginal returns may be lower'],
    alternative: 'Keep budget; bookings stay capped by budget', evaluationPlan: 'Mature 21-day cohort contribution after ads vs prior 28 days', rollbackPlan: 'Restore previous budget if still unchanged',
    ...over,
  };
}

export const LIVE_POLICY: PolicyConfig = {
  ...DEFAULT_POLICY, mode: 'LIMITED_AUTO', monthlyAdSpendCeilingNative: 60_000, ceilingCoversWholeAccount: true, minimumAcceptableContributionReturn: 1.5,
  approvedCampaignIds: ['111', '222'], allowedAutomaticActions: ['campaign_budget_change', 'budget_reallocation', 'pause_ad', 'add_negative_keyword_exact'],
  protectiveStopPctOfCeiling: 95, warningPctOfCeiling: 80, maxOptimizationMutationsPerDay: 5, maxTotalBudgetBaselineIncreasePct: 10,
};

export const goodContext = (snap: Snapshot, now: () => number): ContextSource => async () => ({
  snapshot: snap,
  spend: { readAt: now(), dataAsOf: now() - 10 * 60_000, monthToDateMicros: M(12_000), observedMaxHourlyMicros: M(80), unmanagedDailyBudgetsMicros: [M(200)] },
  measurementMature: true,
  capacity: { ok: true, reason: '120 places open' },
  contributionRoasByRef: { res_tours01: 2.4, res_resto01: 1.8 },
  daysRemainingInMonth: 16,
});

export function liveCoordinator(opts: { policy?: PolicyConfig; budgets?: Record<string, number> } = {}) {
  let t = Date.UTC(2026, 10, 14, 15, 0);
  const now = () => t;
  const advance = (ms: number) => { t += ms; };
  const sql = memorySql();
  const provider = new MockAdsProvider({ budgets: { b1: M(500), b2: M(300), b3: M(200), ...opts.budgets }, campaigns: { '111': 'ENABLED', '222': 'ENABLED', '333': 'ENABLED' }, ads: { ad1: 'ENABLED' }, negatives: {} }, ACCOUNT);
  const core = new CoordinatorCore(sql, { provider, now, environment: 'dev' });
  core.initialize(ACCOUNT, 'OBSERVE', 'owner');
  core.setBaseline(M(800), 'owner');
  const policy = opts.policy ?? LIVE_POLICY;
  core.setPolicy({ ...policy, mode: 'OBSERVE' }, 'owner');
  return { core, provider, sql, now, advance, snap: snapshot(), goLive: () => core.setMode(policy.mode, 'owner', { policyVersion: core.policyVersion() }) };
}
