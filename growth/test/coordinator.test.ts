// Acceptance criteria 8–13, 17, 21 (spec §24): execution boundary, rolling limits, concurrency, unknown outcomes,
// partial transfers, external edits and restore.
import { describe, it, expect } from 'vitest';
import { validateProposal } from '../src/policy/validate.ts';
import { CoordinatorCore, CoordinatorError } from '../src/coordinator/core.ts';
import { MockAdsProvider } from '../src/connectors/mock-ads.ts';
import { liveCoordinator, goodContext, proposal, memorySql, ACCOUNT, M, snapshot, LIVE_POLICY } from './helpers.ts';
import type { Mode } from '../src/domain/schemas.ts';

const intentOf = (p = proposal(), snap = snapshot()) => { const v = validateProposal(p, snap); if (!v.ok) throw new Error(v.errors.join('; ')); return v.intent; };

describe('execution boundary by mode (AC 8)', () => {
  for (const mode of ['OBSERVE', 'SHADOW', 'PAUSED', 'EMERGENCY_LOCK'] as Mode[]) {
    it(`${mode} never sends a growth write`, async () => {
      const { core, provider, snap, now } = liveCoordinator();
      core.setMode(mode, 'owner');
      const { action } = await core.propose(intentOf(), 'model', goodContext(snap, now));
      expect(['REJECTED', 'SHADOWED']).toContain(action.state);
      await expect(core.execute(action.id, goodContext(snap, now))).rejects.toThrow();
      expect(provider.calls).toHaveLength(0);
      expect(provider.state.budgets.b1).toBe(M(500));
    });
  }

  it('LIMITED_AUTO executes an allowed, in-bounds change and verifies it', async () => {
    const { core, provider, snap, now, goLive } = liveCoordinator();
    goLive();
    const { action } = await core.propose(intentOf(), 'model', goodContext(snap, now));
    expect(action.state).toBe('APPROVED');
    const done = await core.execute(action.id, goodContext(snap, now));
    expect(done.state).toBe('VERIFIED');
    expect(provider.state.budgets.b1).toBe(M(550));
    expect(core.verifyLedger()).toEqual([]);
  });

  it('the default 0% aggregate allowance blocks any net budget increase', async () => {
    const { core, snap, now, goLive } = liveCoordinator({ policy: { ...LIVE_POLICY, maxTotalBudgetBaselineIncreasePct: 0 } });
    goLive();
    const { action, decision } = await core.propose(intentOf(), 'model', goodContext(snap, now));
    expect(action.state).toBe('REJECTED');
    expect(decision.reasons.join(' ')).toMatch(/after change: 850; allowed: 800/);
  });

  it('LIMITED_AUTO refuses to go live with an incomplete policy', () => {
    const { core } = liveCoordinator({ policy: { ...LIVE_POLICY, monthlyAdSpendCeilingNative: null } });
    expect(() => core.setMode('LIMITED_AUTO', 'owner', { policyVersion: core.policyVersion() })).toThrow(/monthly ad spend ceiling/);
  });

  it('LIMITED_AUTO needs confirmation of the exact previewed policy version', () => {
    const { core } = liveCoordinator();
    expect(() => core.setMode('LIMITED_AUTO', 'owner', { policyVersion: core.policyVersion() - 1 })).toThrow(/Confirm/);
  });

  it('Stop AI blocks model actions but a protective pause still works (AC 17)', async () => {
    const { core, provider, snap, now, goLive } = liveCoordinator();
    goLive();
    core.setAiStopped(true, 'owner');
    const { action } = await core.propose(intentOf(), 'model', goodContext(snap, now));
    expect(action.state).toBe('REJECTED');
    const res = await core.pauseManaged(snap, 'owner', goodContext(snap, now));
    expect(res.map(r => r.outcome)).toEqual(['paused (verified)', 'paused (verified)']);
    expect(provider.state.campaigns['111']).toBe('PAUSED');
    expect(provider.state.campaigns['333']).toBe('ENABLED'); // not managed → never touched
  });

  it('pause managed ads works under EMERGENCY_LOCK and reports an unknown outcome honestly', async () => {
    const { core, provider, snap, now } = liveCoordinator();
    core.setMode('EMERGENCY_LOCK', 'owner');
    provider.inject({ op: 'setCampaignStatus', target: '222', mode: 'timeout_before_apply' });
    const res = await core.pauseManaged(snap, 'owner', goodContext(snap, now));
    expect(res.find(r => r.campaignId === '111')?.outcome).toBe('paused (verified)');
    expect(res.find(r => r.campaignId === '222')?.outcome).toMatch(/unknown/);
  });
});

describe('model output cannot widen authority (AC 9)', () => {
  it('rejects unknown resources, foreign evidence, extra fields and unregistered actions', () => {
    const snap = snapshot();
    expect(validateProposal(proposal({ resourceRef: 'res_notreal99' }), snap).ok).toBe(false);
    expect(validateProposal(proposal({ evidenceRefs: ['ev_invented_metric'] }), snap).ok).toBe(false);
    expect(validateProposal({ ...proposal(), approved: true }, snap).ok).toBe(false);
    expect(validateProposal({ ...proposal(), actionType: 'set_policy' }, snap).ok).toBe(false);
    expect(validateProposal(proposal({ parameters: { changePct: 10, accountId: '999' } }), snap).ok).toBe(false);
    expect(validateProposal(proposal({ snapshotId: 'snap_other0001' }), snap).ok).toBe(false);
  });

  it('a campaign outside the allowlist is rejected even if the model proposes it', async () => {
    const { core, snap, now, goLive } = liveCoordinator();
    goLive();
    const { action, decision } = await core.propose(intentOf(proposal({ resourceRef: 'res_brand01' })), 'model', goodContext(snap, now));
    expect(action.state).toBe('REJECTED');
    expect(decision.reasons.join(' ')).toMatch(/not on the approved list|managed by owner/);
  });

  it('owner approval is bound to the exact action and expires', async () => {
    const { core, snap, now, advance, goLive } = liveCoordinator({ policy: { ...LIVE_POLICY, allowedAutomaticActions: [] } });
    goLive();
    const { action } = await core.propose(intentOf(), 'model', goodContext(snap, now));
    expect(action.state).toBe('APPROVAL_REQUIRED');
    expect(() => core.approve(action.id, 'f'.repeat(64), 'owner')).toThrow(/does not match/);
    advance(25 * 3_600_000);
    expect(() => core.approve(action.id, action.approval_hash, 'owner')).toThrow(/expired/);
  });

  it('an approved action is re-checked against policy at execution time', async () => {
    const { core, snap, now, goLive } = liveCoordinator({ policy: { ...LIVE_POLICY, allowedAutomaticActions: [] } });
    goLive();
    const { action } = await core.propose(intentOf(), 'model', goodContext(snap, now));
    core.approve(action.id, action.approval_hash, 'owner');
    const stale = async () => ({ ...(await goodContext(snap, now)(undefined as never)), spend: null });
    const done = await core.execute(action.id, stale);
    expect(done.state).toBe('REJECTED');
  });
});

describe('rolling limits and concurrency (AC 10)', () => {
  it('two consecutive 10% increases cannot evade a 10% weekly limit', async () => {
    const { core, provider, snap, now, advance, goLive } = liveCoordinator({ policy: { ...LIVE_POLICY, minHoursBetweenBudgetChanges: 0 } });
    goLive();
    const first = await core.propose(intentOf(), 'model', goodContext(snap, now));
    expect((await core.execute(first.action.id, goodContext(snap, now))).state).toBe('VERIFIED');
    advance(3_600_000);
    const snap2 = snapshot({ b1: provider.state.budgets.b1! });
    const second = await core.propose(intentOf(proposal({ hypothesis: 'Increase again because it worked once' }), snap2), 'model', goodContext(snap2, now));
    expect(second.action.state).toBe('REJECTED');
    expect(second.decision.reasons.join(' ')).toMatch(/Cumulative change vs 7 days ago would be 21\.0%/);
  });

  it('the daily mutation limit counts other actions, not the one being executed', async () => {
    const { core, snap, now, goLive } = liveCoordinator({ policy: { ...LIVE_POLICY, maxOptimizationMutationsPerDay: 1 } });
    goLive();
    const first = await core.propose(intentOf(), 'model', goodContext(snap, now));
    expect((await core.execute(first.action.id, goodContext(snap, now))).state).toBe('VERIFIED');
    const second = await core.propose(intentOf(proposal({ actionType: 'pause_ad', resourceRef: 'res_ad00001', parameters: {} })), 'model', goodContext(snap, now));
    expect(second.action.state).toBe('REJECTED');
    expect(second.decision.reasons.join(' ')).toMatch(/1 of 1 optimization changes/);
  });

  it('a change made by someone else counts toward the rolling limit', async () => {
    const { core, snap, now, goLive } = liveCoordinator({ policy: { ...LIVE_POLICY, minHoursBetweenBudgetChanges: 0 } });
    goLive();
    core.recordExternalBudgetChange({ budgetId: 'b1', at: now() - 2 * 86_400_000, fromMicros: M(460), toMicros: M(500) });
    const r = await core.propose(intentOf(), 'model', goodContext(snap, now));
    expect(r.action.state).toBe('REJECTED');
  });

  it('a retry of the same proposal is the same action, not a second mutation', async () => {
    const { core, provider, snap, now, goLive } = liveCoordinator();
    goLive();
    const a = await core.propose(intentOf(), 'model', goodContext(snap, now));
    const b = await core.propose(intentOf(), 'model', goodContext(snap, now));
    expect(b.duplicate).toBe(true);
    expect(b.action.id).toBe(a.action.id);
    await core.execute(a.action.id, goodContext(snap, now));
    await expect(core.execute(a.action.id, goodContext(snap, now))).rejects.toThrow(/not APPROVED/);
    expect(provider.calls).toHaveLength(1);
  });

  it('concurrent executions on the same budget: only one reaches the provider', async () => {
    const { core, provider, snap, now, goLive } = liveCoordinator({ policy: { ...LIVE_POLICY, minHoursBetweenBudgetChanges: 0, maxCampaignBudgetChangePctPer7Days: 50 } });
    goLive();
    const a = await core.propose(intentOf(proposal({ parameters: { changePct: 5 } })), 'model', goodContext(snap, now));
    const b = await core.propose(intentOf(proposal({ parameters: { changePct: 8 } })), 'model', goodContext(snap, now));
    const [ra, rb] = await Promise.all([core.execute(a.action.id, goodContext(snap, now)), core.execute(b.action.id, goodContext(snap, now))]);
    expect([ra.state, rb.state].sort()).toEqual(['REJECTED', 'VERIFIED']);
    expect(provider.calls.filter(c => c.op === 'setBudget')).toHaveLength(1);
  });

  it('shared budget is counted once in the aggregate', async () => {
    const snap = snapshot();
    snap.resources[1]!.budgetId = 'b1'; snap.budgets.b1!.campaignIds = ['111', '222'];
    const { core, now, goLive } = liveCoordinator();
    goLive();
    // baseline 800: b1 (500, shared by 111 and 222) counted once; +10% → 550 ≤ 800
    const r = await core.propose(intentOf(proposal(), snap), 'model', goodContext(snap, now));
    expect(r.decision.checks.find(c => c.name === 'aggregate_budget')?.ok).toBe(true);
  });
});

describe('unknown outcomes and reconciliation (AC 11)', () => {
  it('a lost response becomes UNKNOWN_OUTCOME, blocks conflicting changes, and reconciles by reading', async () => {
    const { core, provider, snap, now, goLive } = liveCoordinator({ policy: { ...LIVE_POLICY, minHoursBetweenBudgetChanges: 0, maxCampaignBudgetChangePctPer7Days: 50 } });
    goLive();
    provider.inject({ op: 'setBudget', mode: 'apply_then_lose_response' });
    const a = await core.propose(intentOf(), 'model', goodContext(snap, now));
    expect((await core.execute(a.action.id, goodContext(snap, now))).state).toBe('UNKNOWN_OUTCOME');
    const b = await core.propose(intentOf(proposal({ parameters: { changePct: -5 } })), 'model', goodContext(snap, now));
    expect(b.action.state).toBe('REJECTED');
    expect(b.decision.reasons.join(' ')).toMatch(/unknown outcome/);
    const callsBefore = provider.calls.length;
    expect((await core.reconcile(a.action.id)).state).toBe('VERIFIED');
    expect(provider.calls.length).toBe(callsBefore); // reconciliation never re-sends
    expect(core.state().activeReservations).toBe(0);
  });

  it('revoked credentials lock writes immediately', async () => {
    const { core, provider, snap, now, goLive } = liveCoordinator();
    goLive();
    provider.inject({ op: 'setBudget', mode: 'auth' });
    const a = await core.propose(intentOf(), 'model', goodContext(snap, now));
    expect((await core.execute(a.action.id, goodContext(snap, now))).state).toBe('FAILED');
    expect(core.state().emergencyLock).toBe(true);
  });
});

describe('budget transfers (AC 12)', () => {
  it('reduces first, and a failed increase leaves no aggregate increase', async () => {
    const { core, provider, snap, now, goLive } = liveCoordinator({ policy: { ...LIVE_POLICY, maxCampaignBudgetChangePctPer7Days: 50 } });
    goLive();
    provider.inject({ op: 'setBudget', target: 'b2', mode: 'reject' });
    const p = proposal({ actionType: 'budget_reallocation', resourceRef: 'res_tours01', parameters: { toResourceRef: 'res_resto01', amountPctOfSource: 10 } });
    const a = await core.propose(intentOf(p), 'model', goodContext(snap, now));
    expect(a.action.state).toBe('APPROVED');
    const done = await core.execute(a.action.id, goodContext(snap, now));
    expect(done.state).toBe('PARTIALLY_APPLIED');
    expect(provider.state.budgets.b1).toBe(M(450));
    expect(provider.state.budgets.b2).toBe(M(300));
    expect(provider.calls[0]?.target).toBe('b1');
    expect(provider.state.budgets.b1! + provider.state.budgets.b2!).toBeLessThanOrEqual(M(800));
  });
});

describe('external edits (AC 13)', () => {
  it('a manual edit before execution invalidates the stale precondition', async () => {
    const { core, provider, snap, now, goLive } = liveCoordinator();
    goLive();
    const a = await core.propose(intentOf(), 'model', goodContext(snap, now));
    provider.state.budgets.b1 = M(520); // owner changed it in Google Ads
    const done = await core.execute(a.action.id, goodContext(snap, now));
    expect(done.state).toBe('REJECTED');
    expect(provider.calls).toHaveLength(0);
  });

  it('compensation refuses to overwrite a later manual change', async () => {
    const { core, provider, snap, now, goLive } = liveCoordinator();
    goLive();
    const a = await core.propose(intentOf(), 'model', goodContext(snap, now));
    await core.execute(a.action.id, goodContext(snap, now));
    provider.state.budgets.b1 = M(600);
    const r = await core.compensate(a.action.id, 'owner');
    expect(r.refused).toMatch(/changed after this app applied/);
    expect(provider.state.budgets.b1).toBe(M(600));
  });

  it('compensation restores the before-state when nothing changed since', async () => {
    const { core, provider, snap, now, goLive } = liveCoordinator();
    goLive();
    const a = await core.propose(intentOf(), 'model', goodContext(snap, now));
    await core.execute(a.action.id, goodContext(snap, now));
    const r = await core.compensate(a.action.id, 'owner');
    expect(r.action.state).toBe('COMPENSATED');
    expect(provider.state.budgets.b1).toBe(M(500));
  });
});

describe('restore (AC 21) and environment separation (AC 1)', () => {
  it('restored storage stays locked until live state is reconciled', async () => {
    const { core, provider, snap, now, goLive } = liveCoordinator();
    goLive();
    provider.inject({ op: 'setBudget', mode: 'apply_then_lose_response' });
    const a = await core.propose(intentOf(), 'model', goodContext(snap, now));
    await core.execute(a.action.id, goodContext(snap, now));
    const dump = core.exportAll() as Record<string, Record<string, unknown>[]>;

    const restored = new CoordinatorCore(memorySql(), { provider, now, environment: 'dev' });
    restored.restoreAll(dump);
    expect(restored.state().mode).toBe('EMERGENCY_LOCK');
    expect(() => restored.setEmergencyLock(false, 'owner')).toThrow(/reconcile/);
    expect(() => restored.setMode('LIMITED_AUTO', 'owner', { policyVersion: restored.policyVersion() })).toThrow(/reconcile/);
    const r = await restored.reconcileAll('owner');
    expect(r.stillUnknown).toBe(0);
    expect(restored.action(a.action.id)?.state).toBe('VERIFIED');
    restored.setEmergencyLock(false, 'owner');
    expect(restored.state().mode).toBe('PAUSED');
  });

  it('demo/dev can only hold the mock provider, production never can', () => {
    const mock = new MockAdsProvider({ budgets: {}, campaigns: {}, ads: {}, negatives: {} }, ACCOUNT);
    expect(() => new CoordinatorCore(memorySql(), { provider: mock, environment: 'production' })).toThrow(CoordinatorError);
    const fakeReal = { ...mock, kind: 'google_ads_api' } as unknown as MockAdsProvider;
    expect(() => new CoordinatorCore(memorySql(), { provider: fakeReal, environment: 'demo' })).toThrow(CoordinatorError);
  });

  it('every transition has an outbox event; acknowledging is idempotent', async () => {
    const { core, snap, now, goLive } = liveCoordinator();
    goLive();
    const a = await core.propose(intentOf(), 'model', goodContext(snap, now));
    await core.execute(a.action.id, goodContext(snap, now));
    const transitions = core.ledger(a.action.id).length;
    const pending = core.pendingOutbox().filter(e => JSON.parse(e.payload).actionId === a.action.id);
    expect(pending).toHaveLength(transitions);
    core.ack(pending.map(p => p.eventId));
    core.ack(pending.map(p => p.eventId));
    expect(core.pendingOutbox().filter(e => JSON.parse(e.payload).actionId === a.action.id)).toHaveLength(0);
  });
});
