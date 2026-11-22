// Approved change → queued for the Google Ads Script → applied there → verified only against the next live report.
import { describe, it, expect } from 'vitest';
import { validateProposal } from '../src/policy/validate.ts';
import { CoordinatorCore } from '../src/coordinator/core.ts';
import { ScriptAdsProvider } from '../src/connectors/google-ads-script.ts';
import { goodContext, proposal, memorySql, sqliteD1, ACCOUNT, M, snapshot, LIVE_POLICY } from './helpers.ts';

function setup() {
  let t = Date.UTC(2026, 10, 14, 15, 0);
  const now = () => t;
  const { db, d1 } = sqliteD1();
  db.exec(`INSERT INTO ad_accounts (id, provider, external_id, name, currency, account_tz, created_at) VALUES ('g', 'google_ads', '${ACCOUNT}', 'g', 'MXN', 'America/Mexico_City', 0);
    INSERT INTO campaign_registry (ref, account_id, kind, external_id, name, status, budget_id, budget_micros, updated_at) VALUES
      ('res_c111', 'g', 'campaign', '111', 'Tours EN', 'ENABLED', 'b1', ${M(500)}, 0), ('res_c222', 'g', 'campaign', '222', 'Restaurante', 'ENABLED', 'b2', ${M(300)}, 0);
    INSERT OR REPLACE INTO connections (id, provider, purpose, health, last_success_at, updated_at) VALUES ('conn_google_ads_script', 'google_ads_script', 'x', 'connected', ${t}, 0);`);
  const core = new CoordinatorCore(memorySql(), { provider: new ScriptAdsProvider(d1, now), now, environment: 'production' });
  core.initialize(ACCOUNT, 'OBSERVE', 'owner');
  core.setBaseline(M(800), 'owner');
  core.setPolicy({ ...LIVE_POLICY, allowedAutomaticActions: [], mode: 'OBSERVE' }, 'owner'); // every change waits for approval
  core.setMode('LIMITED_AUTO', 'owner', { policyVersion: core.policyVersion() });
  const snap = snapshot();
  const intent = (() => { const v = validateProposal(proposal(), snap); if (!v.ok) throw new Error(v.errors.join('; ')); return v.intent; })();
  /** What the script does: report the op result, then post the account's live state (feed). */
  const scriptRun = (status: 'applied' | 'skipped', budgetAfter: number) => {
    t += 30 * 60_000;
    db.prepare("UPDATE script_ops SET status = ?, done_at = ?").run(status, t);
    db.prepare("UPDATE campaign_registry SET budget_micros = ? WHERE budget_id = 'b1'").run(budgetAfter);
    db.prepare("UPDATE connections SET last_success_at = ? WHERE id = 'conn_google_ads_script'").run(t);
  };
  return { core, db, snap, now, intent, scriptRun };
}

describe('Google Ads Script write path', () => {
  it('approve → queued (unknown) → script applies → verified', async () => {
    const { core, db, snap, now, intent, scriptRun } = setup();
    const { action } = await core.propose(intent, 'model', goodContext(snap, now));
    expect(action.state).toBe('APPROVAL_REQUIRED');
    core.approve(action.id, action.approval_hash, 'eric');
    const ran = await core.execute(action.id, goodContext(snap, now));
    expect(ran.state).toBe('UNKNOWN_OUTCOME');
    expect(db.prepare('SELECT kind, budget_id, from_micros, to_micros, status FROM script_ops').all()).toEqual([{ kind: 'set_budget', budget_id: 'b1', from_micros: M(500), to_micros: M(550), status: 'queued' }]);
    // Before the script runs, reconciling must not judge it.
    expect((await core.reconcile(action.id)).state).toBe('UNKNOWN_OUTCOME');
    scriptRun('applied', M(550));
    expect((await core.reconcile(action.id)).state).toBe('VERIFIED');
  });

  it('the script skips a change when the budget moved; the action ends FAILED, nothing applied', async () => {
    const { core, snap, now, intent, scriptRun } = setup();
    const { action } = await core.propose(intent, 'model', goodContext(snap, now));
    core.approve(action.id, action.approval_hash, 'eric');
    await core.execute(action.id, goodContext(snap, now));
    scriptRun('skipped', M(500));
    expect((await core.reconcile(action.id)).state).toBe('FAILED');
  });

  it('refuses to start when the script has not reported recently', async () => {
    const { core, db, snap, now, intent } = setup();
    db.prepare("UPDATE connections SET last_success_at = ? WHERE id = 'conn_google_ads_script'").run(now() - 4 * 3600_000);
    const { action } = await core.propose(intent, 'model', goodContext(snap, now));
    core.approve(action.id, action.approval_hash, 'eric');
    const r = await core.execute(action.id, goodContext(snap, now));
    expect(r.state).toBe('REJECTED');
    expect(db.prepare('SELECT COUNT(*) AS n FROM script_ops').get()).toEqual({ n: 0 });
  });
});
