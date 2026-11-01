// npm test. Meta sync against a stubbed Graph API and an in-memory SQLite standing in for D1.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { syncMeta } from '../src/ads-meta.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  const sql = readFileSync(new URL('../migrations/0003_ads.sql', import.meta.url), 'utf8').split('-- The app opens inside the Hub now.')[0];
  db.exec(sql);
  const stmt = (q, args = []) => ({
    bind: (...a) => stmt(q, a),
    run: async () => { db.prepare(q).run(...args); return { meta: {} }; },
    all: async () => ({ results: db.prepare(q).all(...args) }),
    first: async () => db.prepare(q).get(...args) ?? null,
  });
  return { db, prepare: q => stmt(q), batch: async list => { for (const s of list) await s.run(); return []; } };
}

test('meta sync writes daily MXN rows, replaces overlapping weekly rows, maps status and budget', async () => {
  const DB = d1();
  const recent = new Date(Date.now() - 3 * 86400e3).toISOString().slice(0, 10);
  DB.db.prepare("INSERT INTO ads_perf (platform,campaign,period_start,days,spend,updated_at) VALUES ('meta','BOFU Ventas Experiencias',?,7,250,1)").run(recent);
  DB.db.prepare("INSERT INTO ads_perf (platform,campaign,period_start,days,spend,updated_at) VALUES ('meta','Old',?,7,99,1)").run('2025-01-06');
  DB.db.prepare("INSERT INTO ads_config (key,value) VALUES ('meta_token','tok'),('fx_usd_mxn','20'),('fx_date',?)").run(new Date().toISOString().slice(0, 10));
  globalThis.fetch = async (u) => {
    u = String(u);
    const body = u.includes('/insights') ? { data: [{ campaign_name: 'BOFU Ventas Experiencias', date_start: recent, spend: '2.50', impressions: '1000', clicks: '12',
        actions: [{ action_type: 'link_click', value: '12' }, { action_type: 'omni_purchase', value: '2', '7d_click': '1' }, { action_type: 'purchase', value: '2', '7d_click': '1' }],
        action_values: [{ action_type: 'omni_purchase', value: '90', '7d_click': '45.5' }] }] }
      : u.includes('/campaigns') ? { data: [{ name: 'BOFU Ventas Experiencias', effective_status: 'ACTIVE', daily_budget: '200' }, { name: 'Video', effective_status: 'PAUSED' }] }
      : { name: 'Bodega Dos Buhos', currency: 'USD' };
    return new Response(JSON.stringify(body), { status: 200 });
  };
  const r = await syncMeta({ DB });
  assert.equal(r.ok, true, r.message);
  const rows = DB.db.prepare("SELECT campaign, days, spend, conversions, value, spend_native, fx FROM ads_perf WHERE platform='meta' ORDER BY campaign").all();
  assert.deepEqual(rows.map(x => ({ ...x })), [
    { campaign: 'BOFU Ventas Experiencias', days: 1, spend: 50, conversions: 1, value: 910, spend_native: 2.5, fx: 20 },
    { campaign: 'Old', days: 7, spend: 99, conversions: 0, value: 0, spend_native: null, fx: null },
  ]);
  const camps = DB.db.prepare("SELECT campaign, status, daily_budget FROM ads_campaigns ORDER BY campaign").all().map(x => ({ ...x }));
  assert.deepEqual(camps, [{ campaign: 'BOFU Ventas Experiencias', status: 'ENABLED', daily_budget: 40 }, { campaign: 'Video', status: 'PAUSED', daily_budget: null }]);
  assert.equal(DB.db.prepare("SELECT value FROM ads_config WHERE key='meta_last_error'").get().value, '');
});

test('meta sync without a token does nothing; a Meta error is recorded, not thrown', async () => {
  const DB = d1();
  assert.equal((await syncMeta({ DB })).skipped, true);
  DB.db.prepare("INSERT INTO ads_config (key,value) VALUES ('meta_token','bad'),('fx_usd_mxn','20'),('fx_date',?)").run(new Date().toISOString().slice(0, 10));
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: 'Invalid OAuth access token.' } }), { status: 400 });
  const r = await syncMeta({ DB });
  assert.equal(r.ok, false);
  assert.match(DB.db.prepare("SELECT value FROM ads_config WHERE key='meta_last_error'").get().value, /Invalid OAuth/);
});
