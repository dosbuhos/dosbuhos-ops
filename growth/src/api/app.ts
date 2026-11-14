import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { Env, User } from '../env.ts';
import { authenticate, checkWriteOrigin, can } from './auth.ts';
import { readyCoordinator } from '../coordinator/do.ts';
import { loadRaw, computeOverview } from '../read/facts.ts';
import { buildSnapshot } from '../read/snapshot.ts';
import { assertDataKind, defaultAccount, writeReport, watchdog, syncGa4IfConfigured } from '../workflows/jobs.ts';
import { FeedPayload, MAX_FEED_BYTES, feedStatements, budgetChanges } from '../connectors/google-ads-feed.ts';
import { previewOpenTable, DEFAULT_OPENTABLE_MAPPING, type OpenTableMapping } from '../connectors/opentable-csv.ts';
import { sha256Hex, safeEqual } from '../connectors/crypto.ts';
import { toCsv } from '../connectors/csv.ts';
import { mirrorFromHub } from '../connectors/hub-mirror.ts';
import { parseServiceAccount } from '../connectors/ga4.ts';
import { Mode, ManualCapacityInput, PolicyConfig } from '../domain/schemas.ts';
import { addDays } from '../domain/time.ts';
import { runDemoBootstrap } from '../../fixtures/demo-actions.ts';
import { DEMO_ACCOUNT } from '../../fixtures/demo-data.ts';

type H = { Bindings: Env; Variables: { user: User } };
export const app = new Hono<H>();

const json = (c: Context<H>, body: unknown, status = 200) => c.json(body as object, status as 200, { 'cache-control': 'no-store' });
const fail = (c: Context<H>, status: number, code: string, message: string) => json(c, { code, message }, status);

// ---------------- public, separately authenticated ----------------

app.get('/healthz', c => c.text('ok'));

/** Google Ads Script feed. Bearer token (hash stored, peppered), size-limited, bound to a registered account. */
app.post('/api/feed/google-ads', async c => {
  const env = c.env;
  if (!env.FEED_TOKEN_PEPPER) return fail(c, 503, 'not_configured', 'Feed is not configured');
  const auth = c.req.header('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(token)) return fail(c, 401, 'bad_token', 'Bad token');
  const hash = await sha256Hex(`${env.FEED_TOKEN_PEPPER}:${token}`);
  const row = await env.DB.prepare('SELECT token_hash FROM feed_tokens WHERE token_hash = ? AND revoked_at IS NULL').bind(hash).first<{ token_hash: string }>();
  if (!row || !safeEqual(row.token_hash, hash)) return fail(c, 401, 'bad_token', 'Bad token');
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
  return json(c, { ok: true, rows: stmts.length, budgetChanges: changes.length });
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
const need = (c: Context<H>, role: 'editor' | 'admin') => (can(c.get('user'), role) ? null : fail(c, 403, 'forbidden', `Needs ${role} role`));

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
  const from = addDays(new Date().toISOString().slice(0, 10), -28);
  const rows = (await c.env.DB.prepare(`SELECT r.ref, r.external_id, r.name, r.status, r.channel, r.brand, r.language, r.products_json, r.booking_horizon_days, r.budget_micros, r.budget_shared, r.writable, r.managed_by, r.optimization_signal,
      SUM(d.cost_micros) AS cost_micros, SUM(d.clicks) AS clicks, SUM(d.impressions) AS impressions, SUM(d.platform_conversions_milli) AS conv_milli,
      SUM(CASE WHEN d.platform_conversions_milli IS NULL THEN 1 ELSE 0 END) AS conv_missing_days, COUNT(d.date) AS days
    FROM campaign_registry r LEFT JOIN campaign_daily d ON d.campaign_id = r.external_id AND d.account_id = r.account_id AND d.date >= ?
    WHERE r.kind = 'campaign' AND r.account_id = ? GROUP BY r.ref ORDER BY cost_micros DESC`).bind(from, a?.id ?? '').all()).results;
  const st = a ? await (await readyCoordinator(c.env, a.id)).state().catch(() => null) : null;
  return json(c, { window: `${from} → yesterday`, currency: a?.currency ?? 'MXN', campaigns: rows, approved: st?.policy.approvedCampaignIds ?? [] });
});

app.get('/api/capacity', async c => {
  const days = c.req.query('days') === '30' ? 30 : 14;
  const now = Date.now();
  const raw = await loadRaw({ db: c.env.DB, now, wineryTz: c.env.WINERY_TZ, currency: 'MXN', days: 35 });
  const { computeCapacity } = await import('../read/facts.ts');
  const cap = computeCapacity(raw, now, raw.today);
  const until = addDays(raw.today, days - 1);
  return json(c, { today: raw.today, days, lastUpdate: cap.lastUpdate, summary: cap.days.filter(d => d.date <= until), slots: cap.slots.filter(s => s.date <= until), resources: raw.resources });
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
  if (!b.success) return fail(c, 400, 'bad_request', 'date required');
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
  if (!imp) return fail(c, 404, 'not_found', 'No previewed import with that id');
  const obj = await c.env.ARCHIVE.get(imp.r2_key!);
  if (!obj) return fail(c, 410, 'gone', 'Import file not found');
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
  if (!r) return fail(c, 404, 'not_found', 'No such report');
  if (c.req.query('format') === 'csv') {
    const f = JSON.parse(r.facts_json!) as { headline: { label: string; display: string; change: string; basis: string; provisional: boolean }[] };
    return new Response(toCsv(['metric', 'value', 'change', 'basis', 'provisional'], f.headline.map(h => [h.label, h.display, h.change, h.basis, h.provisional])), { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${String(r.id).replace(/[^a-z0-9-]/gi, '_')}.csv"` } });
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
  if (!c.env.FEED_TOKEN_PEPPER) return fail(c, 503, 'not_configured', 'Set the FEED_TOKEN_PEPPER secret first');
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const now = Date.now();
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE feed_tokens SET revoked_at = ? WHERE connection_id = 'conn_google_ads_script' AND revoked_at IS NULL").bind(now),
    c.env.DB.prepare('INSERT INTO feed_tokens (id, connection_id, token_hash, created_by, created_at) VALUES (?, ?, ?, ?, ?)').bind(`ft_${crypto.randomUUID().slice(0, 12)}`, 'conn_google_ads_script', await sha256Hex(`${c.env.FEED_TOKEN_PEPPER}:${token}`), c.get('user').email, now),
    c.env.DB.prepare('INSERT INTO audit_events (id, at, actor, action, resource) VALUES (?, ?, ?, ?, ?)').bind(crypto.randomUUID(), now, c.get('user').email, 'feed_token_created', 'conn_google_ads_script'),
  ]);
  return json(c, { token, note: 'Shown once. Paste it into the Google Ads Script; the previous token stops working now.' });
});

// ---------- proposals and actions (IDs only — no free-form execution input) ----------

const ApproveBody = z.object({ approvalHash: z.string().regex(/^[0-9a-f]{64}$/) });
app.post('/api/proposals/:id/approve', async c => {
  const denied = need(c, 'admin'); if (denied) return denied;
  const b = ApproveBody.safeParse(await c.req.json().catch(() => ({})));
  if (!b.success) return fail(c, 400, 'bad_request', 'approvalHash required');
  const a = await account(c); if (!a) return fail(c, 409, 'no_account', 'No ad account');
  try {
    await a.stub.approve(c.req.param('id'), b.data.approvalHash, c.get('user').email);
    const ex = await a.stub.execute(c.req.param('id'));
    return json(c, ex);
  } catch (e) { return fail(c, 409, 'refused', (e as Error).message); }
});
app.post('/api/actions/:id/reconcile', async c => {
  const denied = need(c, 'admin'); if (denied) return denied;
  const a = await account(c); if (!a) return fail(c, 409, 'no_account', 'No ad account');
  try { return json(c, await a.stub.reconcile(c.req.param('id'))); } catch (e) { return fail(c, 409, 'refused', (e as Error).message); }
});
app.post('/api/actions/:id/compensate', async c => {
  const denied = need(c, 'admin'); if (denied) return denied;
  const a = await account(c); if (!a) return fail(c, 409, 'no_account', 'No ad account');
  try { return json(c, await a.stub.compensate(c.req.param('id'), c.get('user').email)); } catch (e) { return fail(c, 409, 'refused', (e as Error).message); }
});

// ---------- controls ----------

app.post('/api/control/mode', async c => {
  const denied = need(c, 'admin'); if (denied) return denied;
  const b = z.object({ mode: Mode, policyVersion: z.number().int().optional() }).safeParse(await c.req.json().catch(() => ({})));
  if (!b.success) return fail(c, 400, 'bad_request', 'mode required');
  const a = await account(c); if (!a) return fail(c, 409, 'no_account', 'No ad account');
  try { await a.stub.setMode(b.data.mode, c.get('user').email, b.data.policyVersion); return json(c, await a.stub.state()); } catch (e) { return fail(c, 409, 'refused', (e as Error).message); }
});
app.post('/api/control/policy', async c => {
  const denied = need(c, 'admin'); if (denied) return denied;
  const a = await account(c); if (!a) return fail(c, 409, 'no_account', 'No ad account');
  const st = await a.stub.state();
  const b = PolicyConfig.safeParse({ ...(await c.req.json().catch(() => ({}))), mode: st.mode });
  if (!b.success) return fail(c, 400, 'bad_request', b.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '));
  try { const v = await a.stub.setPolicy(b.data, c.get('user').email); return json(c, { policyVersion: v }); } catch (e) { return fail(c, 409, 'refused', (e as Error).message); }
});
app.post('/api/control/baseline', async c => {
  const denied = need(c, 'admin'); if (denied) return denied;
  const b = z.object({ dailyBudgetNative: z.number().int().positive().max(10_000_000) }).safeParse(await c.req.json().catch(() => ({})));
  if (!b.success) return fail(c, 400, 'bad_request', 'dailyBudgetNative (whole currency units) required');
  const a = await account(c); if (!a) return fail(c, 409, 'no_account', 'No ad account');
  await a.stub.setBaseline(b.data.dailyBudgetNative * 1_000_000, c.get('user').email);
  return json(c, await a.stub.state());
});
const Toggle = z.object({ on: z.boolean() });
app.post('/api/control/stop-ai', async c => {
  const denied = need(c, 'admin'); if (denied) return denied;
  const b = Toggle.safeParse(await c.req.json().catch(() => ({}))); if (!b.success) return fail(c, 400, 'bad_request', 'on required');
  const a = await account(c); if (!a) return fail(c, 409, 'no_account', 'No ad account');
  await a.stub.setAiStopped(b.data.on, c.get('user').email);
  return json(c, { ...(await a.stub.state()), note: b.data.on ? 'AI changes stopped. Ads keep running — use “Pause managed ads” to stop spend.' : 'AI changes allowed again under the current policy.' });
});
app.post('/api/control/emergency-lock', async c => {
  const denied = need(c, 'admin'); if (denied) return denied;
  const b = Toggle.safeParse(await c.req.json().catch(() => ({}))); if (!b.success) return fail(c, 400, 'bad_request', 'on required');
  const a = await account(c); if (!a) return fail(c, 409, 'no_account', 'No ad account');
  try { await a.stub.setEmergencyLock(b.data.on, c.get('user').email); return json(c, await a.stub.state()); } catch (e) { return fail(c, 409, 'refused', (e as Error).message); }
});
app.post('/api/control/pause-managed-ads', async c => {
  const denied = need(c, 'admin'); if (denied) return denied;
  const a = await account(c); if (!a) return fail(c, 409, 'no_account', 'No ad account');
  const { snapshot } = await buildSnapshot(c.env.DB, a.id, Date.now(), c.env.WINERY_TZ, 0);
  const results = await a.stub.pauseManaged(snapshot.snapshotId, c.get('user').email);
  return json(c, { results, note: 'Per-campaign results from the provider. Campaigns not on your approved list are never touched by the app.' });
});
app.post('/api/control/reconcile-all', async c => {
  const denied = need(c, 'admin'); if (denied) return denied;
  const a = await account(c); if (!a) return fail(c, 409, 'no_account', 'No ad account');
  return json(c, await a.stub.reconcileAll(c.get('user').email));
});
app.post('/api/control/clear-suspension', async c => {
  const denied = need(c, 'admin'); if (denied) return denied;
  const b = z.object({ resourceKey: z.string().max(120) }).safeParse(await c.req.json().catch(() => ({}))); if (!b.success) return fail(c, 400, 'bad_request', 'resourceKey required');
  const a = await account(c); if (!a) return fail(c, 409, 'no_account', 'No ad account');
  await a.stub.clearSuspension(b.data.resourceKey, c.get('user').email);
  return json(c, await a.stub.state());
});
app.post('/api/control/sync-now', async c => {
  const denied = need(c, 'admin'); if (denied) return denied;
  const a = await defaultAccount(c.env.DB);
  if (!c.env.HUB_DB || !a) return fail(c, 409, 'not_configured', 'No Google Ads source bound');
  const ads = await mirrorFromHub(c.env.HUB_DB, c.env.DB, a.id, Date.now(), c.env.WINERY_TZ);
  let ga4: unknown = null;
  try { ga4 = await syncGa4IfConfigured(c.env, Date.now()); } catch (e) { ga4 = { error: (e as Error).message }; }
  return json(c, { ads, ga4 });
});

/** GA4: save the property ID (digits; not a secret, kept in D1 rather than the public repo) and run a first sync. */
app.post('/api/connections/ga4', async c => {
  const denied = need(c, 'admin'); if (denied) return denied;
  const b = z.object({ propertyId: z.string().regex(/^\d{4,15}$/, 'GA4 property ID is digits only') }).safeParse(await c.req.json().catch(() => ({})));
  if (!b.success) return fail(c, 400, 'bad_request', b.error.issues[0]?.message ?? 'propertyId required');
  const now = Date.now();
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE connections SET account_ref = ?, health = 'limited', health_reason = 'Property saved; waiting for the first sync', updated_at = ? WHERE id = 'conn_ga4'").bind(b.data.propertyId, now),
    c.env.DB.prepare('INSERT INTO audit_events (id, at, actor, action, resource, detail_json) VALUES (?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), now, c.get('user').email, 'ga4_property_set', 'conn_ga4', JSON.stringify({ propertyId: b.data.propertyId })),
  ]);
  if (!parseServiceAccount(c.env.GA4_SA_KEY)) return json(c, { saved: true, synced: false, message: 'Saved. Add the GA4_SA_KEY secret to the growth Worker, then press Sync now.' });
  try { return json(c, { saved: true, synced: true, ...(await syncGa4IfConfigured(c.env, now)) }); }
  catch (e) { return fail(c, 502, 'ga4_failed', `Saved, but GA4 refused: ${(e as Error).message}. Check that the service account is a Viewer on this property and the Analytics Data API is enabled.`); }
});
app.post('/api/control/run-report', async c => {
  const denied = need(c, 'admin'); if (denied) return denied;
  const r = await writeReport(c.env, { runKey: `manual:${Date.now()}`, kind: c.req.query('kind') === 'weekly' ? 'weekly' : 'daily' }, Date.now());
  await watchdog(c.env, Date.now());
  return json(c, r);
});
app.get('/api/export/coordinator', async c => {
  const denied = need(c, 'admin'); if (denied) return denied;
  const a = await account(c); if (!a) return fail(c, 409, 'no_account', 'No ad account');
  const dump = await a.stub.exportAll();
  const key = `backups/coordinator/${a.id}/${new Date().toISOString()}.json`;
  await c.env.ARCHIVE.put(key, JSON.stringify(dump));
  return json(c, { stored: key, tables: Object.fromEntries(Object.entries(dump).map(([k, v]) => [k, (v as unknown[]).length])) });
});

// ---------- demo only ----------

app.post('/api/demo/simulate-external-edit', async c => {
  if (c.env.DATA_KIND !== 'demo') return fail(c, 404, 'not_found', 'Not found');
  const denied = need(c, 'admin'); if (denied) return denied;
  const b = z.object({ budgetId: z.string().max(40), dailyBudgetNative: z.number().int().positive().max(100_000) }).safeParse(await c.req.json().catch(() => ({})));
  if (!b.success) return fail(c, 400, 'bad_request', 'budgetId and dailyBudgetNative required');
  const a = await account(c); if (!a) return fail(c, 409, 'no_account', 'No ad account');
  await a.stub.simulateExternalBudgetEdit(b.data.budgetId, b.data.dailyBudgetNative * 1_000_000);
  return json(c, { ok: true });
});
