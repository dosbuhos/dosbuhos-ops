// Meta (Facebook/Instagram) ads → Anuncios. Runs every hour from the Hub's cron and on demand from the page.
// Reads the Marketing API with a token a Hub admin pastes on the Anuncios page (stored in ads_config, never sent back).
// Pulls the last 90 days by campaign and day, plus each campaign's status and daily budget. Money arrives in the ad
// account's currency (USD) and is stored in MXN at the day's USD→MXN rate; the USD figure and the rate are kept too.

const GRAPH = 'https://graph.facebook.com/v24.0';
const DAYS = 90;
// Meta reports a purchase under several names for the same event; take the first one present.
const PURCHASE = ['omni_purchase', 'purchase', 'offsite_conversion.fb_pixel_purchase', 'onsite_web_purchase'];

const iso = d => d.toISOString().slice(0, 10);
async function cfg(env, keys) {
  const rows = (await env.DB.prepare(`SELECT key, value FROM ads_config WHERE key IN (${keys.map(() => '?').join(',')})`).bind(...keys).all()).results;
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}
const setCfg = (env, key, value) => env.DB.prepare('INSERT INTO ads_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(key, String(value));

async function graph(url) {
  const r = await fetch(url);
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error((j.error && (j.error.error_user_msg || j.error.message)) || `Meta respondió ${r.status}`);
  return j;
}
async function all(url) {
  const out = [];
  for (let next = url, pages = 0; next && pages < 50; pages++) { const j = await graph(next); out.push(...(j.data || [])); next = j.paging && j.paging.next; }
  return out;
}
function pick(list, win = '7d_click') {
  if (!Array.isArray(list)) return 0;
  for (const t of PURCHASE) { const a = list.find(x => x.action_type === t); if (a) return Number(a[win] ?? a.value ?? 0) || 0; }
  return 0;
}

// USD→MXN, refreshed once a day from a free rate service; falls back to the last known rate (or 18.4).
async function usdMxn(env, c) {
  const today = iso(new Date());
  if (c.fx_usd_mxn && c.fx_date === today) return Number(c.fx_usd_mxn);
  try {
    const r = await fetch('https://open.er-api.com/v6/latest/USD');
    const j = await r.json();
    const v = Number(j && j.rates && j.rates.MXN);
    if (v > 5 && v < 50) { await env.DB.batch([setCfg(env, 'fx_usd_mxn', v), setCfg(env, 'fx_date', today)]); return v; }
  } catch {}
  return Number(c.fx_usd_mxn) || 18.4;
}

export async function syncMeta(env) {
  const c = await cfg(env, ['meta_token', 'meta_account', 'fx_usd_mxn', 'fx_date']);
  if (!c.meta_token) return { ok: false, skipped: true, message: 'Meta no está conectado.' };
  const acct = c.meta_account || 'act_3735139310045103';
  const tok = encodeURIComponent(c.meta_token);
  try {
    const until = new Date(), since = new Date(Date.now() - (DAYS - 1) * 86400e3);
    const range = encodeURIComponent(JSON.stringify({ since: iso(since), until: iso(until) }));
    const [rows, camps, info] = await Promise.all([
      all(`${GRAPH}/${acct}/insights?level=campaign&time_increment=1&time_range=${range}&fields=campaign_name,spend,impressions,clicks,actions,action_values&action_attribution_windows=${encodeURIComponent('["7d_click"]')}&limit=500&access_token=${tok}`),
      all(`${GRAPH}/${acct}/campaigns?fields=name,effective_status,daily_budget&limit=200&access_token=${tok}`),
      graph(`${GRAPH}/${acct}?fields=currency,name&access_token=${tok}`),
    ]);
    const fx = info.currency === 'MXN' ? 1 : await usdMxn(env, c);
    const now = Date.now();
    const stmts = [
      // The weekly rows Claude typed in by hand give way to daily API rows wherever the two overlap.
      env.DB.prepare("DELETE FROM ads_perf WHERE platform = 'meta' AND days > 1 AND date(period_start, '+' || (days - 1) || ' days') >= ?").bind(iso(since)),
    ];
    for (const r of rows) {
      const spend = Number(r.spend) || 0;
      stmts.push(env.DB.prepare(`INSERT INTO ads_perf (platform, campaign, period_start, days, spend, impressions, clicks, conversions, value, spend_native, fx, updated_at)
        VALUES ('meta', ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(platform, campaign, period_start) DO UPDATE SET days = 1, spend = excluded.spend, impressions = excluded.impressions, clicks = excluded.clicks,
          conversions = excluded.conversions, value = excluded.value, spend_native = excluded.spend_native, fx = excluded.fx, updated_at = excluded.updated_at`)
        .bind(r.campaign_name, r.date_start, Math.round(spend * fx * 100) / 100, Number(r.impressions) || 0, Number(r.clicks) || 0,
          pick(r.actions), Math.round(pick(r.action_values) * fx * 100) / 100, spend, fx, now));
    }
    for (const k of camps) {
      const status = k.effective_status === 'ACTIVE' ? 'ENABLED' : k.effective_status === 'PAUSED' || k.effective_status === 'CAMPAIGN_PAUSED' ? 'PAUSED' : k.effective_status === 'DELETED' || k.effective_status === 'ARCHIVED' ? 'REMOVED' : String(k.effective_status || '');
      const budget = k.daily_budget ? Math.round(Number(k.daily_budget) / 100 * fx * 100) / 100 : null; // minor units → MXN
      stmts.push(env.DB.prepare(`INSERT INTO ads_campaigns (platform, campaign, status, type, daily_budget, lost_is_budget, note, updated_at) VALUES ('meta', ?, ?, '', ?, NULL, '', ?)
        ON CONFLICT(platform, campaign) DO UPDATE SET status = excluded.status, daily_budget = excluded.daily_budget, updated_at = excluded.updated_at`).bind(k.name, status, budget, now));
    }
    stmts.push(setCfg(env, 'meta_last_sync', now), setCfg(env, 'meta_last_error', ''), setCfg(env, 'meta_account_name', info.name || ''));
    for (let i = 0; i < stmts.length; i += 90) await env.DB.batch(stmts.slice(i, i + 90));
    return { ok: true, rows: rows.length, campaigns: camps.length, fx };
  } catch (e) {
    const msg = String(e && e.message || e).slice(0, 300);
    await env.DB.batch([setCfg(env, 'meta_last_error', msg), setCfg(env, 'meta_last_error_at', Date.now())]);
    return { ok: false, message: msg };
  }
}

// Check a pasted token before saving it: it must read the ad account.
export async function checkMetaToken(token, account) {
  const j = await graph(`${GRAPH}/${account}?fields=name,currency&access_token=${encodeURIComponent(token)}`);
  return { name: j.name, currency: j.currency };
}
