import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { Env, User } from '../env.ts';
import { authenticate, checkWriteOrigin, can } from './auth.ts';
import { readyCoordinator } from '../coordinator/do.ts';
import { loadRaw, computeOverview } from '../read/facts.ts';
import { buildSnapshot } from '../read/snapshot.ts';
import { assertDataKind, defaultAccount, writeReport, watchdog, syncGa4IfConfigured } from '../workflows/jobs.ts';
import { SCRIPT_OP_TTL_MS } from '../connectors/google-ads-script.ts';
import { FeedPayload, MAX_FEED_BYTES, feedStatements, budgetChanges } from '../connectors/google-ads-feed.ts';
import { previewOpenTable, DEFAULT_OPENTABLE_MAPPING, type OpenTableMapping } from '../connectors/opentable-csv.ts';
import { sha256Hex, safeEqual } from '../connectors/crypto.ts';
import { toCsv } from '../connectors/csv.ts';
import { mirrorFromHub } from '../connectors/hub-mirror.ts';
import { loadCampaigns } from '../read/campaigns.ts';
import { loadToday } from '../read/today.ts';
import { parseHistoryCsv, HISTORY_SOURCE } from '../read/sales.ts';
import { loadEstimates, saveEstimate, saveCost } from '../read/estimates.ts';
import { runVisibilityCheck } from '../ai/visibility.ts';
import { readSecret } from '../ai/key.ts';
import { buildWeeklyEmail, sendViaResend } from '../report/weekly-email.ts';
import { APP_URL, EMAIL_FROM } from '../workflows/jobs.ts';
import { syncAvailability } from '../connectors/opentable-availability.ts';
import { parseServiceAccount } from '../connectors/ga4.ts';
import { Mode, ManualCapacityInput, PolicyConfig } from '../domain/schemas.ts';
import { addDays, localDate } from '../domain/time.ts';
import { runDemoBootstrap } from '../../fixtures/demo-actions.ts';
import { DEMO_ACCOUNT } from '../../fixtures/demo-data.ts';

type H = { Bindings: Env; Variables: { user: User } };
export const app = new Hono<H>();

const json = (c: Context<H>, body: unknown, status = 200) => c.json(body as object, status as 200, { 'cache-control': 'no-store' });
const fail = (c: Context<H>, status: number, code: string, message: string) => json(c, { code, message }, status);

// ---------------- public, separately authenticated ----------------

app.get('/healthz', c => c.text('ok'));

/** Bearer feed token check shared by the Google Ads Script routes. Returns an error response or null. */
async function feedAuth(c: Context<H>): Promise<Response | null> {
  const env = c.env;
  if (!env.FEED_TOKEN_PEPPER) return fail(c, 503, 'not_configured', 'Feed is not configured');
  const auth = c.req.header('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(token)) return fail(c, 401, 'bad_token', 'Bad token');
  const hash = await sha256Hex(`${env.FEED_TOKEN_PEPPER}:${token}`);
  const row = await env.DB.prepare('SELECT token_hash FROM feed_tokens WHERE token_hash = ? AND revoked_at IS NULL').bind(hash).first<{ token_hash: string }>();
  if (!row || !safeEqual(row.token_hash, hash)) return fail(c, 401, 'bad_token', 'Bad token');
  return null;
}
const scriptAccount = (env: Env, customerId: string) => env.DB.prepare("SELECT id, currency FROM ad_accounts WHERE provider = 'google_ads' AND external_id = ?").bind(customerId.replace(/-/g, '')).first<{ id: string; currency: string }>();

/** Approved changes waiting for the Google Ads Script. Stale ones (not picked up within 6 h) expire instead. */
app.get('/api/feed/google-ads/ops', async c => {
  const denied = await feedAuth(c); if (denied) return denied;
  const acct = await scriptAccount(c.env, c.req.query('customerId') ?? '');
  if (!acct) return fail(c, 403, 'unregistered_account', 'This Google Ads account is not registered');
  const now = Date.now();
  await c.env.DB.prepare("UPDATE script_ops SET status = 'expired', detail = 'El script no lo recogió a tiempo; no se aplicó', done_at = ? WHERE account_id = ? AND status IN ('queued', 'sent') AND created_at < ?").bind(now, acct.id, now - SCRIPT_OP_TTL_MS).run();
  const ops = (await c.env.DB.prepare("SELECT id, kind, campaign_id, budget_id, ad_id, text, from_micros, to_micros FROM script_ops WHERE account_id = ? AND status IN ('queued', 'sent') ORDER BY created_at, id LIMIT 20").bind(acct.id).all()).results;
  if (ops.length) await c.env.DB.prepare(`UPDATE script_ops SET status = 'sent', sent_at = ? WHERE status = 'queued' AND id IN (${ops.map(() => '?').join(',')})`).bind(now, ...ops.map(o => String(o.id))).run();
  return json(c, { ops });
});

/** The script's result for each operation. Verification happens later, against the live state in the next feed. */
app.post('/api/feed/google-ads/ops', async c => {
  const denied = await feedAuth(c); if (denied) return denied;
  const b = z.object({ customerId: z.string().max(20), results: z.array(z.object({ id: z.string().max(80), status: z.enum(['applied', 'skipped', 'failed']), detail: z.string().max(500).default('') })).max(50) }).safeParse(await c.req.json().catch(() => ({})));
  if (!b.success) return fail(c, 400, 'bad_payload', 'Bad results');
  const acct = await scriptAccount(c.env, b.data.customerId);
  if (!acct) return fail(c, 403, 'unregistered_account', 'This Google Ads account is not registered');
  const now = Date.now();
  for (const r of b.data.results) await c.env.DB.prepare("UPDATE script_ops SET status = ?, detail = ?, done_at = ? WHERE id = ? AND account_id = ? AND status IN ('queued', 'sent')").bind(r.status, r.detail, now, r.id, acct.id).run();
  return json(c, { ok: true });
});

/** Google Ads Script feed. Bearer token (hash stored, peppered), size-limited, bound to a registered account. */
app.post('/api/feed/google-ads', async c => {
  const env = c.env;
  const denied = await feedAuth(c); if (denied) return denied;
  const len = Number(c.req.header('content-length') ?? '0');
  if (len > MAX_FEED_BYTES) return fail(c, 413, 'too_large', 'Payload too large');
  const text = await c.req.text();
  if (text.length > MAX_FEED_BYTES) return fail(c, 413, 'too_large', 'Payload too large');
  let parsed;
  try { parsed = FeedPayload.safeParse(JSON.parse(text)); } catch { return fail(c, 400, 'bad_json', 'Send JSON'); }
  if (!parsed.success) return fail(c, 400, 'bad_payload', parsed.error.issues.slice(0, 5).map(i => `${i.path.join('.')}: ${i.message}`).join('; '));
  const p = parsed.data;
  try { await assertDataKind(env); } catch (e) { return fail(c, 409, 'wrong_database', (e as Error).message); }
  const acct = await env.DB.prepare("SELECT id, currency FROM ad_accounts WHERE provider = 'google_ads' AND external_id = ?").bind(p.account.customerId).first<{ id: string; currency: string }>();
  if (!acct) return fail(c, 403, 'unregistered_account', 'This Google Ads account is not registered in the Growth Terminal');
  if (acct.currency !== p.account.currency) return fail(c, 409, 'currency_mismatch', 'Account currency differs from the registered one');
  const now = Date.now();
  const policy = (await (await readyCoordinator(env, acct.id)).state().catch(() => null))?.policy;
  const stmts = feedStatements(env.DB, acct.id, p, now, new Set(policy?.approvedCampaignIds ?? []));
  for (let i = 0; i < stmts.length; i += 80) await env.DB.batch(stmts.slice(i, i + 80));
  await env.ARCHIVE.put(`feeds/google-ads/${p.today.date}/${now}.json`, text, { customMetadata: { account: acct.id } });
  const changes = budgetChanges(p);
  // Every budget change (owner, agency, scripts) counts toward rolling limits. Phase 1 makes no API writes, so none of
  // these are ours; if one ever were, counting it twice only makes the limit stricter (the safe direction).
  if (changes.length) await (await readyCoordinator(env, acct.id)).recordBudgetChanges(changes);
  // Fresh live state just arrived: settle any change the script was asked to make (still-queued ones stay pending).
  let reconciled = null;
  if (env.ADS_PROVIDER === 'google_ads_script') reconciled = await (await readyCoordinator(env, acct.id)).reconcileAll('google_ads_script').catch(e => ({ error: (e as Error).message }));
  return json(c, { ok: true, rows: stmts.length, budgetChanges: changes.length, reconciled });
});

// ---------------- private ----------------

app.use('/api/*', async (c, next) => {
  const r = await authenticate(c.req.raw, c.env);
  if (!r.ok) return fail(c, r.status, 'unauthorized', r.message);
  c.set('user', r.user);
  if (!['GET', 'HEAD'].includes(c.req.method)) {
    const bad = checkWriteOrigin(c.req.raw);
    if (bad) return fail(c, 403, 'forbidden', bad);
  }
  await next();
});
const need = (c: Context<H>, role: 'editor' | 'admin') => (can(c.get('user'), role) ? null : fail(c, 403, 'forbidden', `Necesitas el rol ${role}`));

async function account(c: Context<H>) {
  const a = await defaultAccount(c.env.DB);
  if (!a) return null;
  return { ...a, stub: await readyCoordinator(c.env, a.id) };
}

app.get('/api/session', async c => {
  await assertDataKind(c.env);
  if (c.env.DATA_KIND === 'demo') await runDemoBootstrap(c.env, DEMO_ACCOUNT.id);
  const a = await account(c);
  // First visit on a real database: pull the Google Ads rows right away instead of waiting for the hourly job.
  if (a && c.env.DATA_KIND === 'real' && c.env.HUB_DB && !(await c.env.DB.prepare('SELECT 1 FROM campaign_daily LIMIT 1').first())) await mirrorFromHub(c.env.HUB_DB, c.env.DB, a.id, Date.now(), c.env.WINERY_TZ);
  const st = a ? await a.stub.state() : null;
  return json(c, { user: c.get('user'), environment: c.env.ENVIRONMENT, dataKind: c.env.DATA_KIND, account: a ? { id: a.id, currency: a.currency } : null, coordinator: st, model: c.env.ANTHROPIC_MODEL, aiConfigured: !!c.env.ANTHROPIC_API_KEY });
});

app.get('/api/overview', async c => {
  await assertDataKind(c.env);
  const a = await defaultAccount(c.env.DB);
  const currency = a?.currency ?? 'MXN';
  const now = Date.now();
  const raw = await loadRaw({ db: c.env.DB, now, wineryTz: c.env.WINERY_TZ, currency });
  const o = computeOverview(raw, now, c.env.WINERY_TZ, currency);
  const st = a ? await (await readyCoordinator(c.env, a.id)).state().catch(() => null) : null;
  const lastReview = raw.jobs.find(j => String(j.job) === 'daily_review');
  return json(c, { ...o, currency, coordinator: st, alerts: raw.alerts, connections: raw.connections, lastRefresh: raw.spend ? Number(raw.spend.data_as_of) : null, lastReview: lastReview ?? null, dataKind: c.env.DATA_KIND });
});

app.get('/api/campaigns', async c => {
  const a = await defaultAccount(c.env.DB);
  const view = await loadCampaigns(c.env.DB, Date.now(), c.env.WINERY_TZ, a?.currency ?? 'MXN');
  const st = a ? await (await readyCoordinator(c.env, a.id)).state().catch(() => null) : null;
  return json(c, { ...view, approved: st?.policy.approvedCampaignIds ?? [] });
});

// The owner's first screen: month pace against the ceiling, yesterday, and a verdict per campaign. Read-only.
app.get('/api/today', async c => {
  await assertDataKind(c.env);
  const a = await account(c);
  const st = a ? await a.stub.state().catch(() => null) : null;
  const view = await loadToday(c.env.DB, Date.now(), c.env.WINERY_TZ, a?.currency ?? 'MXN', st?.policy ?? null);
  // Decisions waiting for the owner, and what this morning's review said (it drops off the activity list by the afternoon).
  type Act = { id: string; state: string; created_at: number; intent?: { resourceLabel?: string; proposal?: { hypothesis?: string } } };
  const acts = (a ? await a.stub.actions(60).catch(() => []) : []) as unknown as Act[];
  const pending = acts.filter(x => x.state === 'APPROVAL_REQUIRED').map(x => ({ id: x.id, label: String(x.intent?.resourceLabel ?? ''), hypothesis: String(x.intent?.proposal?.hypothesis ?? ''), createdAt: x.created_at }));
  const job = await c.env.DB.prepare("SELECT run_key, status, detail, started_at FROM job_runs WHERE job = 'daily_review' ORDER BY started_at DESC LIMIT 1").first<{ run_key: string; status: string; detail: string | null; started_at: number }>().catch(() => null);
  let review: { date: string; status: string; text: string; submitted: number } | null = null;
  if (job) {
    let d: { review?: unknown; submitted?: unknown } = {};
    try { d = JSON.parse(job.detail ?? '{}'); } catch { /* older rows hold plain text */ }
    review = { date: job.run_key.split(':')[1] ?? '', status: job.status, text: typeof d.review === 'string' ? d.review : '', submitted: Number(d.submitted ?? 0) || 0 };
  }
  return json(c, { ...view, approved: st?.policy.approvedCampaignIds ?? [], mode: st?.mode ?? null, pending, review });
});

app.get('/api/capacity', async c => {
  const days = c.req.query('days') === '30' ? 30 : 14;
  const now = Date.now();
  const raw = await loadRaw({ db: c.env.DB, now, wineryTz: c.env.WINERY_TZ, currency: 'MXN', days: 35 });
  const { computeCapacity } = await import('../read/facts.ts');
  const cap = computeCapacity(raw, now, raw.today);
  const until = addDays(raw.today, days - 1);
  const { summarizeAvailability } = await import('../read/facts.ts');
  return json(c, { today: raw.today, days, availability: summarizeAvailability(raw.otAvailability, raw.today, days), lastUpdate: cap.lastUpdate, summary: cap.days.filter(d => d.date <= until), slots: cap.slots.filter(s => s.date <= until), resources: raw.resources });
});

app.post('/api/capacity/slots', async c => {
  const denied = need(c, 'editor'); if (denied) return denied;
  const parsed = ManualCapacityInput.extend({ reservedGuests: z.number().int().min(0).max(2000).default(0) }).safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return fail(c, 400, 'bad_request', parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '));
  const s = parsed.data;
  const id = s.slotId ?? `slot_${s.product}_${s.date}_${s.startMin}`;
  const now = Date.now();
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO capacity_slots (id, product, label, date, start_min, duration_min, buffer_min, requires_json, max_guests, state, reserved_guests, source, source_updated_at, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?, ?) ON CONFLICT(id) DO UPDATE SET label = excluded.label, start_min = excluded.start_min, duration_min = excluded.duration_min, buffer_min = excluded.buffer_min,
      requires_json = excluded.requires_json, max_guests = excluded.max_guests, state = excluded.state, reserved_guests = excluded.reserved_guests, source = 'manual', source_updated_at = excluded.source_updated_at, updated_by = excluded.updated_by`)
      .bind(id, s.product, s.label, s.date, s.startMin, s.durationMin, s.bufferMin, JSON.stringify(s.requires), s.maxGuests, s.state, s.reservedGuests, now, c.get('user').email),
    c.env.DB.prepare('INSERT INTO audit_events (id, at, actor, action, resource, detail_json) VALUES (?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), now, c.get('user').email, 'capacity_slot_saved', id, JSON.stringify(s)),
  ]);
  return json(c, { ok: true, id });
});

/** Confirm a whole day's capacity is still correct (updates freshness without retyping). */
app.post('/api/capacity/confirm-day', async c => {
  const denied = need(c, 'editor'); if (denied) return denied;
  const b = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).safeParse(await c.req.json().catch(() => ({})));
  if (!b.success) return fail(c, 400, 'bad_request', 'Falta la fecha');
  const r = await c.env.DB.prepare('UPDATE capacity_slots SET source_updated_at = ?, updated_by = ? WHERE date = ?').bind(Date.now(), c.get('user').email, b.data.date).run();
  return json(c, { ok: true, slots: r.meta.changes });
});

// ---------- OpenTable CSV import: preview then commit ----------

const Mapping = z.object({ timezone: z.string().min(1), currency: z.enum(['MXN', 'USD']), dateFormat: z.enum(['iso', 'mdy', 'dmy']), columns: z.object({ externalId: z.string(), createdAt: z.string(), serviceAt: z.string(), partySize: z.string(), status: z.string(), experience: z.string().optional(), quotedTotal: z.string().optional(), source: z.string().optional() }).optional() });

app.post('/api/imports/opentable/preview', async c => {
  const denied = need(c, 'editor'); if (denied) return denied;
  const b = z.object({ fileName: z.string().max(200), csv: z.string().max(5_000_000), mapping: Mapping }).safeParse(await c.req.json().catch(() => ({})));
  if (!b.success) return fail(c, 400, 'bad_request', b.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '));
  const mapping: OpenTableMapping = { ...DEFAULT_OPENTABLE_MAPPING, ...b.data.mapping, columns: { ...DEFAULT_OPENTABLE_MAPPING.columns, ...b.data.mapping.columns } };
  let preview;
  try { preview = previewOpenTable(b.data.csv, mapping, c.env.WINERY_TZ, Date.now()); } catch (e) { return fail(c, 400, 'bad_csv', (e as Error).message); }
  const existing = new Set<string>();
  const ids = preview.ok.map(x => x.id);
  for (let i = 0; i < ids.length; i += 90) {
    const chunk = ids.slice(i, i + 90);
    for (const r of (await c.env.DB.prepare(`SELECT id FROM bookings WHERE id IN (${chunk.map(() => '?').join(',')})`).bind(...chunk).all<{ id: string }>()).results) existing.add(r.id);
  }
  const id = `imp_${crypto.randomUUID().slice(0, 18)}`;
  const key = `imports/${id}.csv`;
  await c.env.ARCHIVE.put(key, b.data.csv, { customMetadata: { by: c.get('user').email } });
  await c.env.DB.prepare('INSERT INTO imports (id, kind, file_name, r2_key, mapping_json, rows_total, rows_ok, rows_duplicate, rows_error, errors_json, status, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, 'opentable_bookings', b.data.fileName, key, JSON.stringify(mapping), preview.total, preview.ok.length, preview.duplicatesInFile, preview.errors.length, JSON.stringify(preview.errors.slice(0, 500)), 'previewed', c.get('user').email, Date.now()).run();
  return json(c, { importId: id, total: preview.total, valid: preview.ok.length, updatesExisting: preview.ok.filter(x => existing.has(x.id)).length, duplicatesInFile: preview.duplicatesInFile, missingColumns: preview.missingColumns, headers: preview.headers, errors: preview.errors.slice(0, 200), sample: preview.ok.slice(0, 10).map(x => ({ ...x, createdAt: new Date(x.createdAtUtc).toISOString(), serviceAt: new Date(x.serviceAtUtc).toISOString() })) });
});

app.post('/api/imports/:id/commit', async c => {
  const denied = need(c, 'editor'); if (denied) return denied;
  const imp = await c.env.DB.prepare("SELECT * FROM imports WHERE id = ? AND status = 'previewed'").bind(c.req.param('id')).first<Record<string, string>>();
  if (!imp) return fail(c, 404, 'not_found', 'No hay una importación en vista previa con ese id');
  const obj = await c.env.ARCHIVE.get(imp.r2_key!);
  if (!obj) return fail(c, 410, 'gone', 'No se encontró el archivo de importación');
  const now = Date.now();
  const preview = previewOpenTable(await obj.text(), JSON.parse(imp.mapping_json!) as OpenTableMapping, c.env.WINERY_TZ, Number(imp.created_at));
  const stmts: D1PreparedStatement[] = [];
  for (const b of preview.ok) {
    // Upsert only if newer at the source; history keeps every status we have seen.
    stmts.push(c.env.DB.prepare(`INSERT INTO bookings (id, source, external_id, product, experience_name, created_at_utc, service_at_utc, service_date, source_tz, party_size, status, channel, currency, quoted_minor, source_updated_at, import_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(source, external_id) DO UPDATE SET product = excluded.product, experience_name = excluded.experience_name, service_at_utc = excluded.service_at_utc,
      service_date = excluded.service_date, party_size = excluded.party_size, status = excluded.status, channel = excluded.channel, quoted_minor = excluded.quoted_minor, source_updated_at = excluded.source_updated_at, import_id = excluded.import_id
      WHERE excluded.source_updated_at > bookings.source_updated_at`)
      .bind(b.id, 'opentable_csv', b.externalId, b.product, b.experienceName, b.createdAtUtc, b.serviceAtUtc, b.serviceDate, b.sourceTz, b.partySize, b.status, b.channel, b.currency, b.quotedMinor, b.sourceUpdatedAt, imp.id));
    stmts.push(c.env.DB.prepare('INSERT OR IGNORE INTO booking_status_history (booking_id, source_event_id, status, source_updated_at, received_at) VALUES (?, ?, ?, ?, ?)').bind(b.id, `${imp.id}:${b.status}`, b.status, b.sourceUpdatedAt, now));
  }
  for (let i = 0; i < stmts.length; i += 90) await c.env.DB.batch(stmts.slice(i, i + 90));
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE imports SET status = 'committed' WHERE id = ?").bind(imp.id),
    c.env.DB.prepare("UPDATE connections SET health = 'connected', last_success_at = ?, freshness_at = ?, updated_at = ? WHERE provider = 'opentable_csv'").bind(now, now, now),
    c.env.DB.prepare('INSERT INTO audit_events (id, at, actor, action, resource, detail_json) VALUES (?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), now, c.get('user').email, 'import_committed', imp.id!, JSON.stringify({ rows: preview.ok.length })),
  ]);
  return json(c, { ok: true, rows: preview.ok.length });
});

// ---------- experiments, activity, reports, connections ----------

app.get('/api/experiments', async c => json(c, { experiments: (await c.env.DB.prepare('SELECT * FROM experiments ORDER BY CASE status WHEN \'active\' THEN 0 WHEN \'planned\' THEN 1 ELSE 2 END, created_at DESC').all()).results }));

app.get('/api/activity', async c => {
  const a = await account(c);
  const ledger = (await c.env.DB.prepare('SELECT * FROM action_ledger_projection ORDER BY at DESC LIMIT 400').all()).results;
  const actions = a ? await a.stub.actions(100) : [];
  const proposals = (await c.env.DB.prepare('SELECT id, action_id, snapshot_id, run_key, validation_errors_json, decision, reasons_json, model, prompt_version, created_at FROM proposals ORDER BY created_at DESC LIMIT 50').all()).results;
  const jobs = (await c.env.DB.prepare('SELECT run_key, job, status, detail, started_at, finished_at, ai_cost_micro_usd FROM job_runs WHERE job IN (\'daily_review\', \'weekly_review\', \'watchdog\') ORDER BY started_at DESC LIMIT 30').all()).results;
  return json(c, { actions, ledger, proposals, jobs });
});

app.get('/api/reports', async c => json(c, { reports: (await c.env.DB.prepare('SELECT id, kind, period_from, period_to, cutoff_at, narrative, narrative_source, revision, created_at FROM reports ORDER BY created_at DESC LIMIT 60').all()).results }));
app.get('/api/reports/:id', async c => {
  const r = await c.env.DB.prepare('SELECT * FROM reports WHERE id = ?').bind(c.req.param('id')).first<Record<string, string>>();
  if (!r) return fail(c, 404, 'not_found', 'No existe ese reporte');
  if (c.req.query('format') === 'csv') {
    const f = JSON.parse(r.facts_json!) as { headline: { label: string; display: string; change: string; basis: string; provisional: boolean }[] };
    return new Response(toCsv(['métrica', 'valor', 'cambio', 'base', 'provisional'], f.headline.map(h => [h.label, h.display, h.change, h.basis, h.provisional])), { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${String(r.id).replace(/[^a-z0-9-]/gi, '_')}.csv"` } });
  }
  return json(c, { ...r, facts: JSON.parse(r.facts_json!), dataQuality: JSON.parse(r.data_quality_json!) });
});

app.get('/api/connections', async c => {
  const rows = (await c.env.DB.prepare('SELECT id, provider, purpose, health, health_reason, scopes_json, last_success_at, last_error, freshness_at, updated_at FROM connections ORDER BY provider').all()).results;
  const tokens = (await c.env.DB.prepare('SELECT id, connection_id, created_by, created_at, revoked_at FROM feed_tokens ORDER BY created_at DESC').all()).results;
  const imports = (await c.env.DB.prepare('SELECT id, kind, file_name, rows_total, rows_ok, rows_duplicate, rows_error, status, created_by, created_at FROM imports ORDER BY created_at DESC LIMIT 20').all()).results;
  const sa = parseServiceAccount(c.env.GA4_SA_KEY);
  const ga4 = await c.env.DB.prepare("SELECT account_ref FROM connections WHERE id = 'conn_ga4'").first<{ account_ref: string | null }>();
  return json(c, { connections: rows, feedTokens: tokens, imports, ga4: { propertyId: ga4?.account_ref ?? null, serviceAccountEmail: sa?.client_email ?? null }, secrets: { GA4_SA_KEY: !!sa, HUB_SECRET: !!c.env.HUB_SECRET || c.env.ENVIRONMENT === 'dev', ANTHROPIC_API_KEY: !!c.env.ANTHROPIC_API_KEY, FEED_TOKEN_PEPPER: !!c.env.FEED_TOKEN_PEPPER, TOKEN_ENCRYPTION_KEY_V1: !!c.env.TOKEN_ENCRYPTION_KEY_V1 } });
});

app.post('/api/connections/google-ads-script/token', async c => {
  const denied = need(c, 'admin'); if (denied) return denied;
  if (!c.env.FEED_TOKEN_PEPPER) return fail(c, 503, 'not_configured', 'Primero configura el secreto FEED_TOKEN_PEPPER');
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const now = Date.now();
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE feed_tokens SET revoked_at = ? WHERE connection_id = 'conn_google_ads_script' AND revoked_at IS NULL").bind(now),
    c.env.DB.prepare('INSERT INTO feed_tokens (id, connection_id, token_hash, created_by, created_at) VALUES (?, ?, ?, ?, ?)').bind(`ft_${crypto.randomUUID().slice(0, 12)}`, 'conn_google_ads_script', await sha256Hex(`${c.env.FEED_TOKEN_PEPPER}:${token}`), c.get('user').email, now),
    c.env.DB.prepare('INSERT INTO audit_events (id, at, actor, action, resource) VALUES (?, ?, ?, ?, ?)').bind(crypto.randomUUID(), now, c.get('user').email, 'feed_token_created', 'conn_google_ads_script'),
  ]);
  return json(c, { token, note: 'Se muestra una sola vez. Pégalo en el Google Ads Script; el token anterior deja de funcionar desde ahora.' });
});

// ---------- proposals and actions (IDs only — no free-form execution input) ----------

const ApproveBody = z.object({ approvalHash: z.string().regex(/^[0-9a-f]{64}$/) });
app.post('/api/proposals/:id/approve', async c => {
  const denied = need(c, 'admin'); if (denied) return denied;
  const b = ApproveBody.safeParse(await c.req.json().catch(() => ({})));
  if (!b.success) return fail(c, 400, 'bad_request', 'Falta approvalHash');
  const a = await account(c); if (!a) return fail(c, 409, 'no_account', 'No hay cuenta de anuncios');
  try {
    await a.stub.approve(c.req.param('id'), b.data.approvalHash, c.get('user').email);
    const ex = await a.stub.execute(c.req.param('id'));
    return json(c, ex);
  } catch (e) { return fail(c, 409, 'refused', (e as Error).message); }
});
app.post('/api/actions/:id/reconcile', async c => {
  const denied = need(c, 'admin'); if (denied) return denied;
  const a = await account(c); if (!a) return fail(c, 409, 'no_account', 'No hay cuenta de anuncios');
  try { return json(c, await a.stub.reconcile(c.req.param('id'))); } catch (e) { return fail(c, 409, 'refused', (e as Error).message); }
});
app.post('/api/actions/:id/compensate', async c => {
  const denied = need(c, 'admin'); if (denied) return denied;
  const a = await account(c); if (!a) return fail(c, 409, 'no_account', 'No hay cuenta de anuncios');
  try { return json(c, await a.stub.compensate(c.req.param('id'), c.get('user').email)); } catch (e) { return fail(c, 409, 'refused', (e as Error).message); }
});

// ---------- controls ----------

app.post('/api/control/mode', async c => {
  const denied = need(c, 'admin'); if (denied) return denied;
  const b = z.object({ mode: Mode, policyVersion: z.number().int().optional() }).safeParse(await c.req.json().catch(() => ({})));
  if (!b.success) return fail(c, 400, 'bad_request', 'Falta el modo');
  const a = await account(c); if (!a) return fail(c, 409, 'no_account', 'No hay cuenta de anuncios');
  try { await a.stub.setMode(b.data.mode, c.get('user').email, b.data.policyVersion); return json(c, await a.stub.state()); } catch (e) { return fail(c, 409, 'refused', (e as Error).message); }
});
app.post('/api/control/policy', async c => {
  const denied = need(c, 'admin'); if (denied) return denied;
  const a = await account(c); if (!a) return fail(c, 409, 'no_account', 'No hay cuenta de anuncios');
  const st = await a.stub.state();
  const b = PolicyConfig.safeParse({ ...(await c.req.json().catch(() => ({}))), mode: st.mode });
  if (!b.success) return fail(c, 400, 'bad_request', b.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '));
  let v: number;
  try { v = await a.stub.setPolicy(b.data, c.get('user').email); } catch (e) { return fail(c, 409, 'refused', (e as Error).message); }
  await syncWritableCampaigns(c.env.DB, a.id, b.data.approvedCampaignIds, Date.now());
  return json(c, { policyVersion: v });
});
/** The approved list is the one place the owner says which campaigns the app may change, so the registry flags the
 *  policy engine checks (writable, managed_by = 'app') follow it. Campaigns dropped from the list stop being writable
 *  and go back to the owner as budget controller. */
async function syncWritableCampaigns(db: D1Database, accountId: string, approved: string[], now: number) {
  const list = JSON.stringify(approved);
  await db.batch([
    db.prepare("UPDATE campaign_registry SET writable = 1, managed_by = 'app', updated_at = ? WHERE account_id = ? AND kind = 'campaign' AND external_id IN (SELECT value FROM json_each(?))").bind(now, accountId, list),
    db.prepare("UPDATE campaign_registry SET writable = 0, managed_by = CASE WHEN managed_by = 'app' THEN 'owner' ELSE managed_by END, updated_at = ? WHERE account_id = ? AND kind = 'campaign' AND writable = 1 AND external_id NOT IN (SELECT value FROM json_each(?))").bind(now, accountId, list),
  ]);
}
app.post('/api/control/baseline', async c => {
  const denied = need(c, 'admin'); if (denied) return denied;
  const b = z.object({ dailyBudgetNative: z.number().int().positive().max(10_000_000) }).safeParse(await c.req.json().catch(() => ({})));
  if (!b.success) return fail(c, 400, 'bad_request', 'Falta dailyBudgetNative (en unidades enteras de la moneda)');
  const a = await account(c); if (!a) return fail(c, 409, 'no_account', 'No hay cuenta de anuncios');
  await a.stub.setBaseline(b.data.dailyBudgetNative * 1_000_000, c.get('user').email);
  return json(c, await a.stub.state());
});
const Toggle = z.object({ on: z.boolean() });
app.post('/api/control/stop-ai', async c => {
  const denied = need(c, 'admin'); if (denied) return denied;
  const b = Toggle.safeParse(await c.req.json().catch(() => ({}))); if (!b.success) return fail(c, 400, 'bad_request', 'Falta on');
  const a = await account(c); if (!a) return fail(c, 409, 'no_account', 'No hay cuenta de anuncios');
  await a.stub.setAiStopped(b.data.on, c.get('user').email);
  return json(c, { ...(await a.stub.state()), note: b.data.on ? 'Cambios de la IA detenidos. Los anuncios siguen corriendo; usa “Pausar anuncios administrados” para detener el gasto.' : 'Cambios de la IA permitidos otra vez con la política actual.' });
});
app.post('/api/control/emergency-lock', async c => {
  const denied = need(c, 'admin'); if (denied) return denied;
  const b = Toggle.safeParse(await c.req.json().catch(() => ({}))); if (!b.success) return fail(c, 400, 'bad_request', 'Falta on');
  const a = await account(c); if (!a) return fail(c, 409, 'no_account', 'No hay cuenta de anuncios');
  try { await a.stub.setEmergencyLock(b.data.on, c.get('user').email); return json(c, await a.stub.state()); } catch (e) { return fail(c, 409, 'refused', (e as Error).message); }
});
app.post('/api/control/pause-managed-ads', async c => {
  const denied = need(c, 'admin'); if (denied) return denied;
  const a = await account(c); if (!a) return fail(c, 409, 'no_account', 'No hay cuenta de anuncios');
  const { snapshot } = await buildSnapshot(c.env.DB, a.id, Date.now(), c.env.WINERY_TZ, 0);
  const results = await a.stub.pauseManaged(snapshot.snapshotId, c.get('user').email);
  return json(c, { results, note: 'Resultados por campaña según el proveedor. La app nunca toca las campañas que no están en tu lista aprobada.' });
});
app.post('/api/control/reconcile-all', async c => {
  const denied = need(c, 'admin'); if (denied) return denied;
  const a = await account(c); if (!a) return fail(c, 409, 'no_account', 'No hay cuenta de anuncios');
  return json(c, await a.stub.reconcileAll(c.get('user').email));
});
app.post('/api/control/clear-suspension', async c => {
  const denied = need(c, 'admin'); if (denied) return denied;
  const b = z.object({ resourceKey: z.string().max(120) }).safeParse(await c.req.json().catch(() => ({}))); if (!b.success) return fail(c, 400, 'bad_request', 'Falta resourceKey');
  const a = await account(c); if (!a) return fail(c, 409, 'no_account', 'No hay cuenta de anuncios');
  await a.stub.clearSuspension(b.data.resourceKey, c.get('user').email);
  return json(c, await a.stub.state());
});
app.post('/api/control/sync-now', async c => {
  const denied = need(c, 'admin'); if (denied) return denied;
  const a = await defaultAccount(c.env.DB);
  if (!c.env.HUB_DB || !a) return fail(c, 409, 'not_configured', 'No hay una fuente de Google Ads conectada');
  const ads = await mirrorFromHub(c.env.HUB_DB, c.env.DB, a.id, Date.now(), c.env.WINERY_TZ);
  let ga4: unknown = null;
  try { ga4 = await syncGa4IfConfigured(c.env, Date.now()); } catch (e) { ga4 = { error: (e as Error).message }; }
  const availability = c.env.OPENTABLE_RID ? await syncAvailability(c.env.DB, Number(c.env.OPENTABLE_RID), Date.now(), c.env.WINERY_TZ).catch(e => ({ error: (e as Error).message })) : null;
  return json(c, { ads, ga4, availability });
});

/** GA4: save the property ID (digits; not a secret, kept in D1 rather than the public repo) and run a first sync. */
app.post('/api/connections/ga4', async c => {
  const denied = need(c, 'admin'); if (denied) return denied;
  const b = z.object({ propertyId: z.string().regex(/^\d{4,15}$/, 'El ID de propiedad de GA4 solo lleva dígitos') }).safeParse(await c.req.json().catch(() => ({})));
  if (!b.success) return fail(c, 400, 'bad_request', b.error.issues[0]?.message ?? 'Falta propertyId');
  const now = Date.now();
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE connections SET account_ref = ?, health = 'limited', health_reason = 'Propiedad guardada; esperando la primera sincronización', updated_at = ? WHERE id = 'conn_ga4'").bind(b.data.propertyId, now),
    c.env.DB.prepare('INSERT INTO audit_events (id, at, actor, action, resource, detail_json) VALUES (?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), now, c.get('user').email, 'ga4_property_set', 'conn_ga4', JSON.stringify({ propertyId: b.data.propertyId })),
  ]);
  if (!parseServiceAccount(c.env.GA4_SA_KEY)) return json(c, { saved: true, synced: false, message: 'Guardado. Agrega el secreto GA4_SA_KEY al Worker de growth y luego presiona Sincronizar ahora.' });
  try { return json(c, { saved: true, synced: true, ...(await syncGa4IfConfigured(c.env, now)) }); }
  catch (e) { return fail(c, 502, 'ga4_failed', `Se guardó, pero GA4 lo rechazó: ${(e as Error).message}. Revisa que la cuenta de servicio tenga el rol Lector en esta propiedad y que la Analytics Data API esté habilitada.`); }
});
// ---------- estimated value per reservation (owner-approved, shown with its basis) ----------
app.get('/api/estimates', async c => json(c, await loadEstimates(c.env.DB)));
app.post('/api/estimates', async c => {
  const denied = need(c, 'admin'); if (denied) return denied;
  const b = z.object({ product: z.enum(['restaurant_visit', 'tour_tasting']), value: z.number().positive().max(1_000_000), basis: z.string().min(3).max(500), sourcePeriod: z.string().max(80).default(''), note: z.string().max(300).default('') }).safeParse(await c.req.json().catch(() => ({})));
  if (!b.success) return fail(c, 400, 'bad_request', b.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '));
  const now = Date.now();
  const saved = await saveEstimate(c.env.DB, { product: b.data.product, valueMinor: Math.round(b.data.value * 100), basis: b.data.basis, sourcePeriod: b.data.sourcePeriod, note: b.data.note }, c.get('user').email, now);
  await c.env.DB.prepare('INSERT INTO audit_events (id, at, actor, action, resource, detail_json) VALUES (?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), now, c.get('user').email, 'estimate_set', b.data.product, JSON.stringify(saved)).run();
  return json(c, saved);
});

app.post('/api/costs', async c => {
  const denied = need(c, 'admin'); if (denied) return denied;
  const b = z.object({ key: z.enum(['restaurant_cost_pct', 'tour_cost_pct', 'payment_fee_pct', 'opentable_fee_per_reservation']), value: z.number().min(0).max(99.99), basis: z.string().min(3).max(500), sourcePeriod: z.string().max(80).default(''), provisional: z.boolean().default(false), note: z.string().max(300).default('') }).safeParse(await c.req.json().catch(() => ({})));
  if (!b.success) return fail(c, 400, 'bad_request', b.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '));
  if (b.data.key === 'opentable_fee_per_reservation' && b.data.value > 1000) return fail(c, 400, 'bad_request', 'value: máximo MX$1,000');
  const now = Date.now();
  // Percentages arrive as percent (21.5) and are stored as basis points; the OpenTable fee arrives in pesos and is stored in cents.
  const saved = await saveCost(c.env.DB, { ...b.data, value: Math.round(b.data.value * 100) }, c.get('user').email, now);
  await c.env.DB.prepare('INSERT INTO audit_events (id, at, actor, action, resource, detail_json) VALUES (?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), now, c.get('user').email, 'cost_set', b.data.key, JSON.stringify(saved)).run();
  return json(c, saved);
});

// ---------- AI visibility check ----------
app.get('/api/ai-visibility', async c => {
  const runs = (await c.env.DB.prepare('SELECT run_key, SUM(error IS NULL) AS asked, SUM(mentioned) AS mentioned, SUM(dosbuhos_cited) AS cited, SUM(cost_micro_usd) AS cost, MAX(checked_at) AS at FROM ai_visibility_results GROUP BY run_key ORDER BY at DESC LIMIT 12').all().catch(() => ({ results: [] }))).results as Record<string, unknown>[];
  const latest = runs[0] ? (await c.env.DB.prepare('SELECT r.question_id, q.lang, q.question, r.assistant, r.mentioned, r.rank, r.excerpt, r.cited_json, r.dosbuhos_cited, r.error FROM ai_visibility_results r JOIN ai_visibility_questions q ON q.id = r.question_id WHERE r.run_key = ? ORDER BY q.sort').bind(String(runs[0].run_key)).all()).results : [];
  return json(c, { runs, latest });
});
app.post('/api/control/weekly-email-test', async c => {
  const denied = need(c, 'admin'); if (denied) return denied;
  if (!c.env.RESEND_API_KEY || !c.env.REPORT_EMAIL_TO) return fail(c, 409, 'not_configured', 'Falta RESEND_API_KEY o REPORT_EMAIL_TO en los secretos del Worker');
  const mail = await buildWeeklyEmail(c.env.DB, Date.now(), c.env.WINERY_TZ, APP_URL);
  await sendViaResend(c.env.RESEND_API_KEY, EMAIL_FROM, c.env.REPORT_EMAIL_TO.split(',').map(s => s.trim()).filter(Boolean), mail);
  return json(c, { sent: true, subject: mail.subject });
});
app.get('/api/weekly-email-preview', async c => { const m = await buildWeeklyEmail(c.env.DB, Date.now(), c.env.WINERY_TZ, APP_URL); return c.html(m.html); });
app.post('/api/control/ai-visibility-run', async c => {
  const denied = need(c, 'admin'); if (denied) return denied;
  const apiKey = await readSecret(c.env.ANTHROPIC_API_KEY);
  if (!apiKey) return fail(c, 409, 'not_configured', 'Falta ANTHROPIC_API_KEY');
  const today = new Date().toISOString().slice(0, 10);
  const done = await c.env.DB.prepare("SELECT 1 FROM ai_visibility_results WHERE run_key = ? LIMIT 1").bind(`manual:${today}`).first();
  if (done) return fail(c, 409, 'already_ran', 'Ya se corrió hoy; los resultados están abajo. (Límite: una revisión manual por día.)');
  const r = await runVisibilityCheck({ db: c.env.DB, apiKey, model: c.env.ANTHROPIC_MODEL, runKey: `manual:${today}`, now: Date.now() });
  return json(c, r);
});

app.post('/api/control/run-report', async c => {
  const denied = need(c, 'admin'); if (denied) return denied;
  const r = await writeReport(c.env, { runKey: `manual:${Date.now()}`, kind: c.req.query('kind') === 'weekly' ? 'weekly' : 'daily' }, Date.now());
  await watchdog(c.env, Date.now());
  return json(c, r);
});
// Same review as the 08:00 daily job (report + model suggestions), started on demand. Suggestions still go
// through the policy and wait for approval. Capped to keep model cost and noise down.
const MANUAL_REVIEWS_PER_DAY = 3;
app.post('/api/control/run-review', async c => {
  const denied = need(c, 'admin'); if (denied) return denied;
  const a = await account(c); if (!a) return fail(c, 409, 'no_account', 'No hay cuenta de anuncios');
  const st = await a.stub.state();
  if (!['SHADOW', 'LIMITED_AUTO', 'DEMO'].includes(st.mode)) return fail(c, 409, 'mode', 'Las sugerencias solo se generan en Sombra o Automático limitado');
  if (st.aiStopped || st.emergencyLock) return fail(c, 409, 'stopped', 'Los cambios de la IA están detenidos o el bloqueo de emergencia está activo');
  const now = Date.now();
  const today = localDate(now, c.env.WINERY_TZ);
  const running = await c.env.DB.prepare("SELECT 1 FROM job_runs WHERE job = 'manual_review' AND status IN ('claimed','running') AND started_at > ? LIMIT 1").bind(now - 10 * 60_000).first();
  if (running) return fail(c, 409, 'running', 'Ya hay una revisión en curso; espera unos minutos');
  const count = (await c.env.DB.prepare("SELECT COUNT(*) AS n FROM job_runs WHERE job = 'manual_review' AND run_key LIKE ?").bind(`manual_review:${today}:%`).first<{ n: number }>())?.n ?? 0;
  if (count >= MANUAL_REVIEWS_PER_DAY) return fail(c, 409, 'limit', `Límite de ${MANUAL_REVIEWS_PER_DAY} revisiones manuales por día`);
  const runKey = `manual_review:${today}:${now}`;
  await c.env.DB.prepare("INSERT INTO job_runs (run_key, job, status, attempts, started_at) VALUES (?, 'manual_review', 'claimed', 1, ?)").bind(runKey, now).run();
  await c.env.DAILY_REVIEW.create({ id: runKey.replace(/:/g, '-'), params: { runKey, kind: 'daily' } });
  return json(c, { runKey, note: 'Revisión iniciada. Las sugerencias aparecen en Acciones en 1–3 minutos.' });
});
app.get('/api/export/coordinator', async c => {
  const denied = need(c, 'admin'); if (denied) return denied;
  const a = await account(c); if (!a) return fail(c, 409, 'no_account', 'No hay cuenta de anuncios');
  const dump = await a.stub.exportAll();
  const key = `backups/coordinator/${a.id}/${new Date().toISOString()}.json`;
  await c.env.ARCHIVE.put(key, JSON.stringify(dump));
  return json(c, { stored: key, tables: Object.fromEntries(Object.entries(dump).map(([k, v]) => [k, (v as unknown[]).length])) });
});

// ---------- demo only ----------

// ---------- Sales history from the point of sale used before Parrot (Wansoft) ----------
// Loaded once so a period can be compared with the same weeks a year earlier. Days on or after Parrot's first day are
// refused: Parrot already has them. Loading the same file again replaces the same days; it never adds them twice.

app.get('/api/pos-history', async c => {
  const h = await c.env.DB.prepare('SELECT MIN(local_date) AS first, MAX(local_date) AS last, COUNT(*) AS days, SUM(net_minor) AS net_minor, MAX(loaded_at) AS loaded_at FROM pos_daily_history')
    .first<{ first: string | null; last: string | null; days: number; net_minor: number | null; loaded_at: number | null }>().catch(() => null);
  const p = await c.env.DB.prepare('SELECT MIN(local_date) AS d FROM pos_orders').first<{ d: string | null }>().catch(() => null);
  return json(c, { source: HISTORY_SOURCE, first: h?.first ?? null, last: h?.last ?? null, days: Number(h?.days ?? 0), netMinor: Number(h?.net_minor ?? 0), loadedAt: h?.loaded_at ?? null, parrotFrom: p?.d ?? null });
});

app.post('/api/control/pos-history', async c => {
  const denied = need(c, 'admin'); if (denied) return denied;
  const b = z.object({ fileName: z.string().max(200), csv: z.string().min(1).max(400_000) }).safeParse(await c.req.json().catch(() => ({})));
  if (!b.success) return fail(c, 400, 'bad_request', 'Falta el archivo, o pesa más de 400 KB');
  const { rows, errors } = parseHistoryCsv(b.data.csv);
  if (errors.length) return fail(c, 400, 'bad_csv', errors.slice(0, 5).map(e => `Fila ${e.row}: ${e.message}`).join(' · ') + (errors.length > 5 ? ` · y ${errors.length - 5} más` : ''));
  if (!rows.length) return fail(c, 400, 'bad_csv', 'El archivo no trae ningún día');
  const parrotFrom = (await c.env.DB.prepare('SELECT MIN(local_date) AS d FROM pos_orders').first<{ d: string | null }>().catch(() => null))?.d ?? null;
  const keep = rows.filter(r => !parrotFrom || r.date < parrotFrom), now = Date.now();
  const stmt = c.env.DB.prepare(`INSERT INTO pos_daily_history (local_date, source, orders, guests, net_minor, total_minor, dine_in_net_minor, tips_minor, discounts_minor, loaded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(local_date) DO UPDATE SET source = excluded.source, orders = excluded.orders, guests = excluded.guests, net_minor = excluded.net_minor, total_minor = excluded.total_minor,
      dine_in_net_minor = excluded.dine_in_net_minor, tips_minor = excluded.tips_minor, discounts_minor = excluded.discounts_minor, loaded_at = excluded.loaded_at`);
  for (let i = 0; i < keep.length; i += 80) await c.env.DB.batch(keep.slice(i, i + 80).map(r => stmt.bind(r.date, HISTORY_SOURCE, r.orders, r.guests, r.netMinor, r.totalMinor, r.dineInNetMinor, r.tipsMinor, r.discountsMinor, now)));
  const sorted = keep.map(r => r.date).sort();
  return json(c, { loaded: keep.length, skippedParrotDays: rows.length - keep.length, first: sorted[0] ?? null, last: sorted[sorted.length - 1] ?? null, by: c.get('user').email });
});

app.post('/api/demo/simulate-external-edit', async c => {
  if (c.env.DATA_KIND !== 'demo') return fail(c, 404, 'not_found', 'No encontrado');
  const denied = need(c, 'admin'); if (denied) return denied;
  const b = z.object({ budgetId: z.string().max(40), dailyBudgetNative: z.number().int().positive().max(100_000) }).safeParse(await c.req.json().catch(() => ({})));
  if (!b.success) return fail(c, 400, 'bad_request', 'Faltan budgetId y dailyBudgetNative');
  const a = await account(c); if (!a) return fail(c, 409, 'no_account', 'No hay cuenta de anuncios');
  await a.stub.simulateExternalBudgetEdit(b.data.budgetId, b.data.dailyBudgetNative * 1_000_000);
  return json(c, { ok: true });
});
