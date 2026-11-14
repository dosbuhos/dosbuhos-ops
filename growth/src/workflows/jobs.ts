// Scheduled work. The cron handler claims each logical run key once (job_runs.run_key is UNIQUE), runs the cheap
// deterministic jobs inline, and starts a Workflow instance (instance id = run key) for daily/weekly reviews.
// The watchdog never calls the model.
import type { Env } from '../env.ts';
import { dueJobs, DEFAULT_SCHEDULE, DAILY_REVIEW_GRACE_MINUTES, type DueJob, type ScheduleSettings } from '../domain/scheduler.ts';
import { localParts, zonedToUtc } from '../domain/time.ts';
import { loadRaw, computeOverview } from '../read/facts.ts';
import { buildSnapshot } from '../read/snapshot.ts';
import { buildFacts, templateNarrative, allowedNumbers } from './reports.ts';
import { narrate, runReview, PROMPT_VERSION } from '../ai/claude.ts';
import { readyCoordinator } from '../coordinator/do.ts';
import { mirrorFromHub } from '../connectors/hub-mirror.ts';

export async function claim(db: D1Database, job: DueJob, now: number): Promise<boolean> {
  const r = await db.prepare("INSERT OR IGNORE INTO job_runs (run_key, job, status, attempts, started_at) VALUES (?, ?, 'claimed', 1, ?)").bind(job.runKey, job.job, now).run();
  return (r.meta.changes ?? 0) > 0;
}
export async function finishJob(db: D1Database, runKey: string, status: 'succeeded' | 'failed' | 'skipped', detail: string, usage?: { in: number; out: number; cost: number }) {
  await db.prepare('UPDATE job_runs SET status = ?, detail = ?, finished_at = ?, ai_input_tokens = ai_input_tokens + ?, ai_output_tokens = ai_output_tokens + ?, ai_cost_micro_usd = ai_cost_micro_usd + ? WHERE run_key = ?')
    .bind(status, detail.slice(0, 1000), Date.now(), usage?.in ?? 0, usage?.out ?? 0, usage?.cost ?? 0, runKey).run();
}

export async function scheduleSettings(db: D1Database, env: Env): Promise<ScheduleSettings> {
  const s = await db.prepare('SELECT winery_tz, notification_tz, notification_local_time FROM business_settings WHERE id = 1').first<{ winery_tz: string; notification_tz: string | null; notification_local_time: string | null }>();
  const [h, m] = (s?.notification_local_time ?? '').split(':').map(Number);
  return { ...DEFAULT_SCHEDULE, wineryTz: s?.winery_tz ?? env.WINERY_TZ, notificationTz: s?.notification_tz ?? null, notifyLocal: s?.notification_tz && Number.isFinite(h) ? { hour: h!, minute: m ?? 0 } : null };
}

export async function defaultAccount(db: D1Database): Promise<{ id: string; currency: 'MXN' | 'USD' } | null> {
  return db.prepare("SELECT id, currency FROM ad_accounts WHERE provider = 'google_ads' ORDER BY created_at LIMIT 1").first();
}

/** The cron entry point: every 15 minutes, UTC. */
export async function runSchedule(env: Env, now: number): Promise<{ ran: string[] }> {
  await assertDataKind(env);
  const ran: string[] = [];
  const jobs = dueJobs(now, await scheduleSettings(env.DB, env));
  // The watchdog goes last, so it sees the reviews this same tick has just started.
  for (const job of [...jobs.filter(j => j.job !== 'watchdog'), ...jobs.filter(j => j.job === 'watchdog')]) {
    if (!(await claim(env.DB, job, now))) continue;
    ran.push(job.runKey);
    try {
      switch (job.job) {
        case 'watchdog': await finishJob(env.DB, job.runKey, 'succeeded', JSON.stringify(await watchdog(env, now))); break;
        case 'ads_ingest': {
          const acct = await defaultAccount(env.DB);
          if (env.HUB_DB && acct && env.DATA_KIND === 'real') {
            const r = await mirrorFromHub(env.HUB_DB, env.DB, acct.id, now, env.WINERY_TZ);
            await finishJob(env.DB, job.runKey, 'succeeded', `Hub feed: ${r.campaigns} campaigns, ${r.days} days, data as of ${r.dataAsOf ? new Date(r.dataAsOf).toISOString() : 'unknown'}`);
          } else await finishJob(env.DB, job.runKey, 'skipped', env.ADS_PROVIDER === 'mock' ? 'Mock provider: demo data is static' : 'No Google Ads source bound');
          break;
        }
        case 'spend_poll':
          await finishJob(env.DB, job.runKey, 'skipped', env.ADS_PROVIDER === 'mock' ? 'Mock provider: demo data is static' : 'Spend arrives hourly with the Google Ads feed; 15-minute polling needs Google Ads API access'); break;
        case 'booking_sync': await finishJob(env.DB, job.runKey, 'skipped', 'No booking source connected: OpenTable reservation data is partner-only (requested via the account manager)'); break;
        case 'daily_review': await env.DAILY_REVIEW.create({ id: job.runKey.replace(/:/g, '-'), params: { runKey: job.runKey, kind: 'daily', logicalDate: job.logicalDate } }); break;
        case 'weekly_review': await env.WEEKLY_REVIEW.create({ id: job.runKey.replace(/:/g, '-'), params: { runKey: job.runKey, kind: 'weekly', logicalDate: job.logicalDate } }); break;
        case 'notify_daily': case 'notify_weekly': await finishJob(env.DB, job.runKey, 'skipped', 'No notification provider is configured; reports are in the app'); break;
      }
    } catch (e) {
      await finishJob(env.DB, job.runKey, 'failed', (e as Error).message);
    }
  }
  return { ran };
}

/** Demo and real data must never share a database: the Worker refuses to run against the wrong kind. */
export async function assertDataKind(env: Env): Promise<void> {
  const s = await env.DB.prepare('SELECT data_kind FROM business_settings WHERE id = 1').first<{ data_kind: string }>();
  if (!s) throw new Error('business_settings row missing: run migrations and setup');
  if (s.data_kind !== env.DATA_KIND) throw new Error(`Database holds ${s.data_kind} data but this Worker is configured for ${env.DATA_KIND}`);
}

// ---------------- watchdog (no LLM) ----------------

interface AlertIn { key: string; severity: 'critical' | 'warning' | 'info'; title: string; detail: string; link: string }

export async function watchdog(env: Env, now: number): Promise<{ open: number }> {
  const alerts: AlertIn[] = [];
  const settings = await scheduleSettings(env.DB, env);
  const acct = await defaultAccount(env.DB);
  if (acct) {
    try {
      const stub = await readyCoordinator(env, acct.id);
      const st = await stub.state();
      if (st.unknownOutcomes > 0) alerts.push({ key: 'unknown_outcome', severity: 'critical', title: `${st.unknownOutcomes} ad change(s) with unknown outcome`, detail: 'Writes to those resources are blocked until reconciled. Open Agent activity → Reconcile.', link: '#activity' });
      if (st.restoredLocked) alerts.push({ key: 'restored_locked', severity: 'warning', title: 'Restored from backup: automation locked', detail: 'Reconcile live state in Controls before any writes.', link: '#controls' });
      for (const s of st.suspensions) alerts.push({ key: `suspended:${s.resourceKey}`, severity: 'warning', title: 'External change detected', detail: `${s.reason}. Automation on ${s.resourceKey} is suspended until you acknowledge it.`, link: '#activity' });
      const drained = await stub.drainOutbox();
      if (drained.pending > 0) alerts.push({ key: 'outbox_backlog', severity: 'warning', title: 'Activity feed is behind', detail: 'Some coordinator events have not reached the dashboard yet.', link: '#activity' });
      const spend = await env.DB.prepare('SELECT * FROM spend_readings WHERE account_id = ? ORDER BY read_at DESC LIMIT 1').bind(acct.id).first<Record<string, number>>();
      const ageMin = spend ? (now - spend.data_as_of!) / 60_000 : Infinity;
      if (env.DATA_KIND === 'real' && ageMin > st.policy.maxSpendDataAgeMinutes) alerts.push({ key: 'stale_spend', severity: st.mode === 'LIMITED_AUTO' ? 'critical' : 'warning', title: spend ? `Spend data is ${Math.round(ageMin / 60)} h old` : 'No spend data yet', detail: 'Growth writes are blocked until fresh spend arrives. Ads that are running keep spending during an outage — check Google Ads directly.', link: '#connections' });
      const ceiling = st.policy.monthlyAdSpendCeilingNative;
      if (spend && ceiling) {
        const pct = (spend.month_to_date_micros! / (ceiling * 1e6)) * 100;
        if (st.policy.protectiveStopPctOfCeiling !== null && pct >= st.policy.protectiveStopPctOfCeiling) alerts.push({ key: 'spend_protective_stop', severity: 'critical', title: `Month spend at ${pct.toFixed(0)}% of ceiling`, detail: 'At or past the protective stop. Use “Pause managed ads” in Controls. Unmanaged campaigns are not paused by the app.', link: '#controls' });
        else if (st.policy.warningPctOfCeiling !== null && pct >= st.policy.warningPctOfCeiling) alerts.push({ key: 'spend_warning', severity: 'warning', title: `Month spend at ${pct.toFixed(0)}% of ceiling`, detail: 'Approaching the owner ceiling.', link: '#overview' });
      }
    } catch (e) {
      alerts.push({ key: 'coordinator_unreachable', severity: 'critical', title: 'Account coordinator did not answer', detail: `${(e as Error).message}. No writes can happen while it is down; running ads keep running.`, link: '#controls' });
    }
  }
  // Missed daily review (checked without the model).
  const lp = localParts(now, settings.wineryTz);
  const due = zonedToUtc(lp.date, settings.dailyReviewLocal.hour, settings.dailyReviewLocal.minute, settings.wineryTz);
  if (now > due + DAILY_REVIEW_GRACE_MINUTES * 60_000) {
    const r = await env.DB.prepare('SELECT status, started_at FROM job_runs WHERE run_key = ?').bind(`daily_review:${lp.date}`).first<{ status: string }>();
    const startedAt = r ? Number((r as { started_at?: number }).started_at ?? 0) : 0;
    const stuck = r && (r.status === 'claimed' || r.status === 'running') && now - startedAt > 2 * 3_600_000;
    if (!r || r.status === 'failed' || stuck) alerts.push({ key: `missed_daily:${lp.date}`, severity: 'warning', title: 'Daily review has not completed today', detail: !r ? 'It never started.' : r.status === 'failed' ? 'It failed: see Agent activity → Scheduled runs.' : 'It started more than 2 h ago and has not finished.', link: '#activity' });
  }
  for (const c of (await env.DB.prepare("SELECT provider, health, health_reason FROM connections WHERE health IN ('reconnect', 'limited')").all<{ provider: string; health: string; health_reason: string }>()).results)
    alerts.push({ key: `connection:${c.provider}`, severity: c.health === 'reconnect' ? 'warning' : 'info', title: `${c.provider}: ${c.health === 'reconnect' ? 'reconnection needed' : 'limited'}`, detail: c.health_reason, link: '#connections' });
  const capUpd = await env.DB.prepare("SELECT MAX(source_updated_at) AS t FROM capacity_slots WHERE date >= ?").bind(lp.date).first<{ t: number | null }>();
  // Never set up is not the same as stale: the first is a to-do (info), the second a warning.
  if (!capUpd?.t) alerts.push({ key: 'capacity_not_set_up', severity: 'info', title: 'Capacity not set up yet', detail: 'No slots entered for upcoming dates. Reporting works without it; capacity-based budget increases stay off.', link: '#capacity' });
  else if (now - capUpd.t > 36 * 3_600_000) alerts.push({ key: 'stale_capacity', severity: 'warning', title: 'Capacity calendar not updated in 36 h', detail: 'Capacity-based scaling is blocked until staff update the calendar or confirm it is still correct.', link: '#capacity' });

  // Upsert seen alerts; resolve the ones not seen this run (dedupe = no alert storms).
  const seen = new Set(alerts.map(a => a.key));
  const stmts = alerts.map(a => env.DB.prepare(`INSERT INTO alerts (dedupe_key, severity, title, detail, link, opened_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(dedupe_key) DO UPDATE SET severity = excluded.severity, title = excluded.title, detail = excluded.detail, last_seen_at = excluded.last_seen_at, occurrences = occurrences + 1,
      resolved_at = NULL, opened_at = CASE WHEN alerts.resolved_at IS NOT NULL THEN excluded.opened_at ELSE alerts.opened_at END`).bind(a.key, a.severity, a.title, a.detail, a.link, now, now));
  const open = (await env.DB.prepare('SELECT dedupe_key FROM alerts WHERE resolved_at IS NULL').all<{ dedupe_key: string }>()).results;
  for (const o of open) if (!seen.has(o.dedupe_key)) stmts.push(env.DB.prepare('UPDATE alerts SET resolved_at = ? WHERE dedupe_key = ?').bind(now, o.dedupe_key));
  if (stmts.length) await env.DB.batch(stmts);
  return { open: alerts.length };
}

// ---------------- reviews ----------------

export interface ReviewParams { runKey: string; kind: 'daily' | 'weekly'; logicalDate?: string }

/** Step 1: deterministic report. Always succeeds without the model. */
export async function writeReport(env: Env, p: ReviewParams, now: number): Promise<{ reportId: string; narrativeSource: 'model' | 'template'; usage: { in: number; out: number; cost: number } }> {
  await assertDataKind(env);
  const acct = await defaultAccount(env.DB);
  const currency = acct?.currency ?? 'MXN';
  const raw = await loadRaw({ db: env.DB, now, wineryTz: env.WINERY_TZ, currency });
  const o = computeOverview(raw, now, env.WINERY_TZ, currency);
  const since = now - (p.kind === 'daily' ? 1 : 7) * 86_400_000;
  const activity = (await env.DB.prepare(`SELECT label, to_state AS state, actor, json_extract(detail_json, '$.reason') AS reason FROM action_ledger_projection WHERE at >= ? AND to_state IN ('VERIFIED','PARTIALLY_APPLIED','REJECTED','APPROVAL_REQUIRED','SHADOWED') ORDER BY at`).bind(since).all<{ label: string; state: string; actor: string; reason: string | null }>()).results.map(a => ({ ...a, reason: a.reason ?? undefined }));
  const alerts = (await env.DB.prepare('SELECT severity, title FROM alerts WHERE resolved_at IS NULL').all<{ severity: string; title: string }>()).results;
  const facts = buildFacts(p.kind, o, currency, activity, alerts);
  let narrative = templateNarrative(facts), source: 'model' | 'template' = 'template';
  const usage = { in: 0, out: 0, cost: 0 };
  if (env.ANTHROPIC_API_KEY) {
    const lang = (await env.DB.prepare('SELECT report_language FROM business_settings WHERE id = 1').first<{ report_language: string }>())?.report_language ?? 'en';
    const n = await narrate({ apiKey: env.ANTHROPIC_API_KEY, model: env.ANTHROPIC_MODEL, facts: facts as unknown as Record<string, unknown>, allowedNumbers: allowedNumbers(facts), language: lang });
    if (n) { narrative = `${n.text}\n\n${facts.dataKind === 'demo' ? 'DEMO DATA. ' : ''}Numbers above are restated from the fact table below.`; source = 'model'; usage.in = n.usage.inputTokens; usage.out = n.usage.outputTokens; usage.cost = n.usage.costMicroUsd; }
  }
  const id = `${p.kind}:${p.logicalDate ?? o.today}`;
  await env.DB.prepare(`INSERT INTO reports (id, kind, period_from, period_to, cutoff_at, data_quality_json, facts_json, narrative, narrative_source, revision, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?) ON CONFLICT(id) DO UPDATE SET facts_json = excluded.facts_json, data_quality_json = excluded.data_quality_json, narrative = excluded.narrative,
    narrative_source = excluded.narrative_source, cutoff_at = excluded.cutoff_at, revision = reports.revision + 1`)
    .bind(id, p.kind, facts.period.from, facts.period.to, now, JSON.stringify(o.quality), JSON.stringify(facts), narrative, source, now).run();
  return { reportId: id, narrativeSource: source, usage };
}

/** Step 2: optional model review → proposals → policy → (LIMITED_AUTO/DEMO) execution. */
export async function reviewAndPropose(env: Env, p: ReviewParams, now: number): Promise<{ summary: string; submitted: number; executed: string[]; usage: { in: number; out: number; cost: number } }> {
  const acct = await defaultAccount(env.DB);
  const usage = { in: 0, out: 0, cost: 0 };
  if (!acct) return { summary: 'No ad account registered', submitted: 0, executed: [], usage };
  const stub = await readyCoordinator(env, acct.id);
  const st = await stub.state();
  if (!['SHADOW', 'LIMITED_AUTO', 'DEMO'].includes(st.mode) || st.aiStopped || st.emergencyLock) return { summary: `No proposals: mode ${st.mode}${st.aiStopped ? ', AI stopped' : ''}${st.emergencyLock ? ', emergency lock' : ''}`, submitted: 0, executed: [], usage };
  if (!env.ANTHROPIC_API_KEY) return { summary: 'No proposals: ANTHROPIC_API_KEY is not configured', submitted: 0, executed: [], usage };
  const maxLag = Math.max(...(await env.DB.prepare("SELECT maturation_lag_days AS d FROM products WHERE id IN ('restaurant_visit','tour_tasting')").all<{ d: number }>()).results.map(r => r.d));
  const { snapshot } = await buildSnapshot(env.DB, acct.id, now, env.WINERY_TZ, maxLag);
  const raw = await loadRaw({ db: env.DB, now, wineryTz: env.WINERY_TZ, currency: acct.currency });
  const o = computeOverview(raw, now, env.WINERY_TZ, acct.currency);
  const experiments = (await env.DB.prepare('SELECT title, hypothesis, status, primary_metric, result, limitations, start_date, end_date FROM experiments ORDER BY created_at DESC LIMIT 20').all()).results;
  const brand = await env.DB.prepare('SELECT brand_facts_json FROM business_settings WHERE id = 1').first<{ brand_facts_json: string }>();
  const executed: string[] = [];
  const result = await runReview({
    apiKey: env.ANTHROPIC_API_KEY, model: env.ANTHROPIC_MODEL,
    ctx: { snapshot, performance: { totals: o.tickers.map(t => ({ key: t.key, value: t.metric.value, provisional: t.metric.provisional, reason: t.metric.reason })) }, dataQuality: o.quality, capacity: o.capacity.days.slice(0, 40), experiments, brandFacts: JSON.parse(brand?.brand_facts_json ?? '[]') },
    onSubmit: async raw => {
      const r = await stub.submitProposal(raw, snapshot.snapshotId, 'model');
      await env.DB.prepare('INSERT INTO proposals (id, action_id, account_id, snapshot_id, run_key, raw_json, validation_errors_json, decision, reasons_json, model, prompt_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(`prop_${crypto.randomUUID().slice(0, 18)}`, r.actionId ?? null, acct.id, snapshot.snapshotId, p.runKey, JSON.stringify(raw).slice(0, 20_000), JSON.stringify(r.errors ?? []), r.state ?? 'invalid', JSON.stringify(r.reasons ?? []), env.ANTHROPIC_MODEL, PROMPT_VERSION, Date.now()).run();
      if (r.state === 'APPROVED' && r.actionId) { const ex = await stub.execute(r.actionId); executed.push(`${r.actionId}:${ex.state}`); }
      return { accepted: r.accepted, state: r.state, errors: r.errors, reasons: r.reasons };
    },
  });
  usage.in = result.usage.inputTokens; usage.out = result.usage.outputTokens; usage.cost = result.usage.costMicroUsd;
  return { summary: result.summary, submitted: result.submitted, executed, usage };
}
