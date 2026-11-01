// Anuncios — Google + Meta ads inside the Hub. Page /ads/, JSON under /ads/api/.
// Who: anyone with a grant on the 'ads' app (Hub admins always). viewer reads; editor also edits pendientes;
// admin also edits targets. The Google Ads script posts to /ads/api/ingest with a bearer token (hash in ads_config).
import { audit } from './auth.js';
import { syncMeta, checkMetaToken } from './ads-meta.js';

const J = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const numOrNull = (v) => (v === '' || v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));
const str = (v, max = 300) => String(v ?? '').trim().slice(0, max);

export async function sha256hex(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function isIngest(url, request) { return url.pathname === '/ads/api/ingest' && request.method === 'POST'; }

// POST /ads/api/ingest   Authorization: Bearer <token>
// { google_daily: [{date, campaign, spend, impressions, clicks, conversions, conversion_value}],
//   google_campaigns: [{campaign, status, type, daily_budget, lost_is_budget}] }
export async function ingest(request, env) {
  const auth = request.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  const row = await env.DB.prepare("SELECT value FROM ads_config WHERE key = 'ingest_token_hash'").first();
  if (!token || !row || (await sha256hex(token)) !== row.value) return J({ code: 'not_granted', message: 'Bad token.' }, 401);
  let b; try { b = await request.json(); } catch { return J({ code: 'bad_request', message: 'Send JSON.' }, 400); }
  const now = Date.now(), stmts = [];
  for (const r of (Array.isArray(b.google_daily) ? b.google_daily : []).slice(0, 5000)) {
    if (!DAY.test(r.date) || !r.campaign) continue;
    stmts.push(perfUpsert(env, 'google', str(r.campaign, 200), r.date, 1, r, now));
  }
  for (const c of (Array.isArray(b.google_campaigns) ? b.google_campaigns : []).slice(0, 200)) {
    if (!c.campaign) continue;
    stmts.push(env.DB.prepare(`INSERT INTO ads_campaigns (platform, campaign, status, type, daily_budget, lost_is_budget, updated_at) VALUES ('google', ?, ?, ?, ?, ?, ?)
      ON CONFLICT(platform, campaign) DO UPDATE SET status = excluded.status, type = excluded.type, daily_budget = excluded.daily_budget, lost_is_budget = excluded.lost_is_budget, updated_at = excluded.updated_at`)
      .bind(str(c.campaign, 200), str(c.status, 30), str(c.type, 40), numOrNull(c.daily_budget), numOrNull(c.lost_is_budget), now));
  }
  stmts.push(env.DB.prepare("INSERT INTO ads_config (key, value) VALUES ('last_ingest', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(String(now)));
  for (let i = 0; i < stmts.length; i += 90) await env.DB.batch(stmts.slice(i, i + 90));
  return J({ ok: true, rows: stmts.length - 1 });
}

function perfUpsert(env, platform, campaign, start, days, r, now) {
  return env.DB.prepare(`INSERT INTO ads_perf (platform, campaign, period_start, days, spend, impressions, clicks, conversions, value, spend_native, fx, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(platform, campaign, period_start) DO UPDATE SET days = excluded.days, spend = excluded.spend, impressions = excluded.impressions, clicks = excluded.clicks,
      conversions = excluded.conversions, value = excluded.value, spend_native = excluded.spend_native, fx = excluded.fx, updated_at = excluded.updated_at`)
    .bind(platform, campaign, start, days, num(r.spend), Math.round(num(r.impressions)), Math.round(num(r.clicks)), num(r.conversions),
      num(r.conversion_value ?? r.value), numOrNull(r.spend_native), numOrNull(r.fx), now);
}

// Everything under /ads/ for a signed-in person with a role on the app.
export async function adsRoute(request, env, url, user, role) {
  const p = url.pathname, m = request.method;
  if (p === '/ads') return Response.redirect(url.origin + '/ads/' + url.search, 302);
  if (!p.startsWith('/ads/api/')) {
    const res = await env.ASSETS.fetch(new Request(new URL('/ads.html', request.url), { headers: request.headers }));
    return new Response(res.body, { status: res.status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } });
  }
  const body = async () => { try { return await request.json(); } catch { return {}; } };
  const canEdit = role === 'admin' || role === 'editor';

  if (p === '/ads/api/data' && m === 'GET') {
    const since = new Date(Date.now() - 400 * 86400e3).toISOString().slice(0, 10);
    const [perf, campaigns, targets, bookings, todos, cfg] = await Promise.all([
      env.DB.prepare('SELECT platform, campaign, period_start AS start, days, spend, impressions, clicks, conversions, value FROM ads_perf WHERE period_start >= ? ORDER BY period_start').bind(since).all(),
      env.DB.prepare('SELECT platform, campaign, status, type, daily_budget, lost_is_budget, note, updated_at FROM ads_campaigns').all(),
      env.DB.prepare('SELECT platform, monthly_budget, target_roas, target_cpa, note, updated_by, updated_at FROM ads_targets').all(),
      env.DB.prepare('SELECT date, system, source, bookings, covers, value FROM ads_bookings WHERE date >= ? ORDER BY date').bind(since).all(),
      env.DB.prepare('SELECT id, task, area, owner, due, done, notes, created_by, created_at, done_at FROM ads_todos ORDER BY done, CASE WHEN due = \'\' THEN 1 ELSE 0 END, due, id').all(),
      env.DB.prepare("SELECT key, CASE WHEN key = 'meta_token' THEN '1' ELSE value END AS value FROM ads_config WHERE key IN ('last_ingest', 'meta_token', 'meta_last_sync', 'meta_last_error', 'meta_account_name', 'fx_usd_mxn')").all(),
    ]);
    // Freshness: the last day each platform has numbers for.
    const fresh = (await env.DB.prepare('SELECT platform, MAX(date(period_start, \'+\' || (days - 1) || \' days\')) AS through, MAX(updated_at) AS updated_at FROM ads_perf GROUP BY platform').all()).results;
    return J({
      role, me: { email: user.email, name: user.name },
      perf: perf.results, campaigns: campaigns.results, targets: targets.results, bookings: bookings.results, todos: todos.results,
      fresh, config: Object.fromEntries(cfg.results.map(r => [r.key, r.value])),
    });
  }

  if (p === '/ads/api/todos' && m === 'POST') {
    if (!canEdit) return J({ code: 'not_granted', message: 'Solo ver: no puedes agregar pendientes.' }, 403);
    const b = await body();
    const task = str(b.task, 300);
    if (!task) return J({ code: 'bad_request', message: 'Escribe el pendiente.' }, 400);
    const due = DAY.test(b.due) ? b.due : '';
    const r = await env.DB.prepare('INSERT INTO ads_todos (task, area, owner, due, notes, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(task, str(b.area, 40), str(b.owner, 40), due, str(b.notes, 1000), user.email, Date.now()).run();
    return J({ ok: true, id: r.meta.last_row_id });
  }
  const tm = p.match(/^\/ads\/api\/todos\/(\d+)$/);
  if (tm) {
    if (!canEdit) return J({ code: 'not_granted', message: 'Solo ver: no puedes cambiar pendientes.' }, 403);
    const id = Number(tm[1]);
    const t = await env.DB.prepare('SELECT * FROM ads_todos WHERE id = ?').bind(id).first();
    if (!t) return J({ code: 'not_found' }, 404);
    if (m === 'PATCH') {
      const b = await body();
      const next = {
        task: 'task' in b ? (str(b.task, 300) || t.task) : t.task,
        area: 'area' in b ? str(b.area, 40) : t.area,
        owner: 'owner' in b ? str(b.owner, 40) : t.owner,
        due: 'due' in b ? (DAY.test(b.due) ? b.due : '') : t.due,
        notes: 'notes' in b ? str(b.notes, 1000) : t.notes,
        done: 'done' in b ? (b.done ? 1 : 0) : t.done,
      };
      const doneAt = next.done ? (t.done ? t.done_at : Date.now()) : null;
      await env.DB.prepare('UPDATE ads_todos SET task = ?, area = ?, owner = ?, due = ?, notes = ?, done = ?, done_at = ? WHERE id = ?')
        .bind(next.task, next.area, next.owner, next.due, next.notes, next.done, doneAt, id).run();
      return J({ ok: true });
    }
    if (m === 'DELETE') {
      await env.DB.prepare('DELETE FROM ads_todos WHERE id = ?').bind(id).run();
      return J({ ok: true });
    }
  }

  const gm = p.match(/^\/ads\/api\/targets\/(google|meta)$/);
  if (gm && m === 'PUT') {
    if (role !== 'admin') return J({ code: 'not_granted', message: 'Solo quien administra la app cambia las metas.' }, 403);
    const b = await body();
    await env.DB.prepare(`INSERT INTO ads_targets (platform, monthly_budget, target_roas, target_cpa, note, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(platform) DO UPDATE SET monthly_budget = excluded.monthly_budget, target_roas = excluded.target_roas, target_cpa = excluded.target_cpa, note = excluded.note, updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
      .bind(gm[1], numOrNull(b.monthly_budget), numOrNull(b.target_roas), numOrNull(b.target_cpa), str(b.note, 300), user.email, Date.now()).run();
    await audit(env, user.email, 'ads.targets', gm[1], { monthly_budget: b.monthly_budget, target_roas: b.target_roas, target_cpa: b.target_cpa });
    return J({ ok: true });
  }

  // Meta: connect (admin pastes a token; checked against the ad account before it is kept), disconnect, sync now.
  if (p === '/ads/api/meta/token' && (m === 'POST' || m === 'DELETE')) {
    if (role !== 'admin') return J({ code: 'not_granted', message: 'Solo quien administra la app conecta Meta.' }, 403);
    if (m === 'DELETE') {
      await env.DB.prepare("DELETE FROM ads_config WHERE key = 'meta_token'").run();
      await audit(env, user.email, 'ads.meta.disconnect', 'meta');
      return J({ ok: true });
    }
    const b = await body();
    const token = str(b.token, 1000).replace(/\s+/g, '');
    const account = /^act_\d+$/.test(b.account || '') ? b.account : 'act_3735139310045103';
    if (token.length < 20) return J({ code: 'bad_request', message: 'Pega el token completo.' }, 400);
    let info;
    try { info = await checkMetaToken(token, account); }
    catch (e) { return J({ code: 'bad_request', message: 'Meta no aceptó el token: ' + String(e.message || e) }, 400); }
    await env.DB.batch([
      env.DB.prepare("INSERT INTO ads_config (key, value) VALUES ('meta_token', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(token),
      env.DB.prepare("INSERT INTO ads_config (key, value) VALUES ('meta_account', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(account),
    ]);
    await audit(env, user.email, 'ads.meta.connect', account, { name: info.name, currency: info.currency });
    const r = await syncMeta(env);
    return J({ ok: true, account: info, sync: r });
  }
  if (p === '/ads/api/meta/sync' && m === 'POST') {
    if (!canEdit) return J({ code: 'not_granted', message: 'Solo ver.' }, 403);
    return J(await syncMeta(env));
  }

  // A new ingest token (admin only). Shown once; only its hash is kept.
  if (p === '/ads/api/token' && m === 'POST') {
    if (!user.admin) return J({ code: 'not_granted', message: 'Only a Hub admin can do that.' }, 403);
    const bytes = crypto.getRandomValues(new Uint8Array(24));
    const token = 'dbads_' + [...bytes].map(x => x.toString(16).padStart(2, '0')).join('');
    await env.DB.prepare("INSERT INTO ads_config (key, value) VALUES ('ingest_token_hash', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(await sha256hex(token)).run();
    await audit(env, user.email, 'ads.token', 'ingest');
    return J({ ok: true, token });
  }
  return J({ code: 'not_found' }, 404);
}

