// Demo bootstrap: loads the synthetic dataset into the DEMO database and runs a few SCRIPTED proposals (labelled
// "[Demo script]", not model output) through the real validate → policy → coordinator path against the mock
// provider, so the activity feed shows real accept/reject decisions. Runs once per demo database.
import type { Env } from '../src/env.ts';
import { demoStatements, DEMO_ACCOUNT } from './demo-data.ts';
import { coordinatorFor } from '../src/coordinator/do.ts';
import { buildSnapshot } from '../src/read/snapshot.ts';
import { writeReport, watchdog } from '../src/workflows/jobs.ts';
import { DEFAULT_POLICY, type ModelProposal } from '../src/domain/schemas.ts';

export async function runDemoBootstrap(env: Env, accountKey: string): Promise<void> {
  if (env.DATA_KIND !== 'demo' || accountKey !== DEMO_ACCOUNT.id) return;
  const claimed = await env.DB.prepare("INSERT OR IGNORE INTO job_runs (run_key, job, status, started_at) VALUES ('demo_bootstrap', 'demo_bootstrap', 'running', ?)").bind(Date.now()).run();
  if (!claimed.meta.changes) return;
  try {
    await loadDemoData(env);
    const stub = coordinatorFor(env, accountKey);
    await stub.init(accountKey, 'DEMO', 'demo');
    await stub.setPolicy({
      ...DEFAULT_POLICY, mode: 'DEMO', monthlyAdSpendCeilingNative: 60_000, ceilingCoversWholeAccount: false, minimumAcceptableContributionReturn: 1.5,
      approvedCampaignIds: ['111', '222'], allowedAutomaticActions: ['budget_reallocation', 'pause_ad'], protectiveStopPctOfCeiling: 95, warningPctOfCeiling: 80, maxTotalBudgetBaselineIncreasePct: 0,
    }, 'demo');
    await stub.setBaseline((600 + 450) * 1e6, 'demo');
    const now = Date.now();
    const { snapshot } = await buildSnapshot(env.DB, accountKey, now, env.WINERY_TZ, 21);
    const base = (o: Partial<ModelProposal>): ModelProposal => ({
      schemaVersion: '1', snapshotId: snapshot.snapshotId, hypothesis: '[Demo script] placeholder hypothesis', actionType: 'campaign_budget_change', resourceRef: 'res_c111', parameters: {},
      evidenceRefs: ['ev_c111_croas_28d'], expectedEffect: { metric: 'completed_guests', direction: 'increase', range: null }, risks: ['Synthetic demo data'],
      alternative: 'Leave settings unchanged', evaluationPlan: 'Compare mature 21-day cohorts on matched weekdays', rollbackPlan: 'Conditional restore of the previous value', ...o,
    });
    const scripted: ModelProposal[] = [
      base({ hypothesis: '[Demo script] Tours EN has the higher mature contribution ROAS; move 10% of Restaurante budget to it without raising the total', actionType: 'budget_reallocation', resourceRef: 'res_c222', parameters: { toResourceRef: 'res_c111', amountPctOfSource: 10 }, evidenceRefs: ['ev_c111_croas_28d', 'ev_c222_croas_28d'] }),
      base({ hypothesis: '[Demo script] Raise Tours EN budget 15% because bookings rose last week', actionType: 'campaign_budget_change', parameters: { changePct: 15 } }),
      base({ hypothesis: '[Demo script] The “cheap wine tasting” ad has 3× the cost per completed guest of its sibling over 28 mature days', actionType: 'pause_ad', resourceRef: 'res_a7002', parameters: {}, evidenceRefs: ['ev_c111_clicks_28d'], expectedEffect: { metric: 'cost_per_completed_guest', direction: 'decrease', range: null } }),
      base({ hypothesis: '[Demo script] Add exact negative “trabajo” to Restaurante (job-seeker searches)', actionType: 'add_negative_keyword_exact', resourceRef: 'res_c222', parameters: { text: 'trabajo' }, evidenceRefs: ['ev_c222_clicks_28d'], expectedEffect: { metric: 'cost_per_confirmed_booking', direction: 'decrease', range: null } }),
      base({ hypothesis: '[Demo script] Increase brand campaign budget 5%', actionType: 'campaign_budget_change', resourceRef: 'res_c333', parameters: { changePct: 5 }, evidenceRefs: ['ev_c333_croas_28d'] }),
    ];
    for (const p of scripted) {
      const r = await stub.submitProposal(p, snapshot.snapshotId, 'model');
      await env.DB.prepare('INSERT INTO proposals (id, action_id, account_id, snapshot_id, run_key, raw_json, validation_errors_json, decision, reasons_json, model, prompt_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(`prop_${crypto.randomUUID().slice(0, 18)}`, r.actionId ?? null, accountKey, snapshot.snapshotId, 'demo_bootstrap', JSON.stringify(p), JSON.stringify(r.errors ?? []), r.state ?? 'invalid', JSON.stringify(r.reasons ?? []), 'demo-script', 'demo', Date.now()).run();
      if (r.state === 'APPROVED' && r.actionId) await stub.execute(r.actionId);
    }
    await writeReport(env, { runKey: 'demo_bootstrap', kind: 'daily' }, now);
    await writeReport(env, { runKey: 'demo_bootstrap', kind: 'weekly' }, now);
    await watchdog(env, now);
    await env.DB.prepare("UPDATE job_runs SET status = 'succeeded', finished_at = ? WHERE run_key = 'demo_bootstrap'").bind(Date.now()).run();
  } catch (e) {
    await env.DB.prepare("UPDATE job_runs SET status = 'failed', detail = ?, finished_at = ? WHERE run_key = 'demo_bootstrap'").bind((e as Error).message.slice(0, 500), Date.now()).run();
    throw e;
  }
}

export async function loadDemoData(env: Env): Promise<void> {
  const s = await env.DB.prepare('SELECT data_kind FROM business_settings WHERE id = 1').first<{ data_kind: string }>();
  if (s?.data_kind !== 'demo') throw new Error('Refusing to write synthetic data into a non-demo database');
  const stmts = demoStatements(Date.now()).map(x => env.DB.prepare(x.sql).bind(...x.binds));
  for (let i = 0; i < stmts.length; i += 100) await env.DB.batch(stmts.slice(i, i + 100));
}
