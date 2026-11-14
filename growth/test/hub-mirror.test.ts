// The live Phase 1 path: Google Ads rows from the Hub's database → Growth facts, with no booking source connected.
import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { mirrorFromHub, nameKey } from '../src/connectors/hub-mirror.ts';
import { loadRaw, computeOverview } from '../src/read/facts.ts';
import { addDays, localDate } from '../src/domain/time.ts';

/** Minimal D1 over node:sqlite: enough of prepare/bind/all/first/run/batch for these modules. */
function fakeD1(db: DatabaseSync): D1Database {
  const stmt = (sql: string, binds: unknown[] = []) => ({
    bind: (...b: unknown[]) => stmt(sql, b),
    all: async () => ({ results: db.prepare(sql).all(...(binds as never[])) }),
    first: async () => db.prepare(sql).get(...(binds as never[])) ?? null,
    run: async () => { const r = db.prepare(sql).run(...(binds as never[])); return { meta: { changes: Number(r.changes) } }; },
  });
  return { prepare: (sql: string) => stmt(sql), batch: async (ss: { run: () => Promise<unknown> }[]) => { for (const s of ss) await s.run(); return []; } } as unknown as D1Database;
}

const TZ = 'America/Mexico_City';
const now = Date.UTC(2026, 10, 14, 17, 0);
const today = localDate(now, TZ);

function hub(): D1Database {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE ads_perf (platform TEXT, campaign TEXT, period_start TEXT, days INTEGER, spend REAL, impressions INTEGER, clicks INTEGER, conversions REAL, value REAL, spend_native REAL, fx REAL, updated_at INTEGER);
    CREATE TABLE ads_campaigns (platform TEXT, campaign TEXT, status TEXT, type TEXT, daily_budget REAL, lost_is_budget REAL, note TEXT, updated_at INTEGER);
    CREATE TABLE ads_config (key TEXT PRIMARY KEY, value TEXT);`);
  for (let k = 60; k >= 0; k--) {
    const d = addDays(today, -k);
    db.prepare("INSERT INTO ads_perf VALUES ('google', 'EN - In San Miguel (tours & tastings)', ?, 1, 175.37, 400, 60, 0.5, 0, NULL, NULL, 0)").run(d);
    db.prepare("INSERT INTO ads_perf VALUES ('google', 'MOFU_Conversiones_Search_DB+Tribalo', ?, 1, 190.1, 500, 50, 0, 0, NULL, NULL, 0)").run(d);
    db.prepare("INSERT INTO ads_perf VALUES ('meta', 'Meta campaign', ?, 1, 99, 1, 1, 1, 0, NULL, NULL, 0)").run(d);
  }
  db.exec(`INSERT INTO ads_campaigns VALUES ('google', 'EN - In San Miguel (tours & tastings)', 'ENABLED', 'SEARCH', 175, 19.3, '', 0), ('google', 'MOFU_Conversiones_Search_DB+Tribalo', 'ENABLED', 'SEARCH', 190, 15.3, '', 0), ('google', 'Dos búhos - Eventos', 'PAUSED', 'SEARCH', 30, NULL, '', 0);`);
  db.prepare("INSERT INTO ads_config VALUES ('last_ingest', ?)").run(String(now - 20 * 60_000));
  return fakeD1(db);
}
function growth(): D1Database {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../migrations/0001_init.sql', import.meta.url), 'utf8'));
  db.exec(`INSERT INTO business_settings (id, data_kind, updated_at) VALUES (1, 'real', 0);
    INSERT INTO ad_accounts (id, provider, external_id, name, currency, account_tz, created_at) VALUES ('acct_google_main', 'google_ads', '1', 'x', 'MXN', '${TZ}', 0);
    INSERT INTO connections (id, provider, purpose, updated_at) VALUES ('conn_hub_google_ads', 'hub_google_ads_feed', 'x', 0);`);
  return fakeD1(db);
}

describe('Hub mirror (live Phase 1 path)', () => {
  it('copies Google rows only, in integer micros, idempotently, with stable name keys', async () => {
    const h = hub(), g = growth();
    const r1 = await mirrorFromHub(h, g, 'acct_google_main', now, TZ);
    const r2 = await mirrorFromHub(h, g, 'acct_google_main', now, TZ);
    expect(r1).toEqual(r2);
    expect(r1.campaigns).toBe(3);
    const rows = (await g.prepare('SELECT COUNT(*) AS n, SUM(cost_micros) AS c FROM campaign_daily').first()) as { n: number; c: number };
    expect(rows.n).toBe(61 * 2); // Meta excluded, replay did not duplicate
    expect(rows.c).toBe(61 * (175_370_000 + 190_100_000));
    expect(nameKey('MOFU_Conversiones_Search_DB+Tribalo')).toBe(nameKey('MOFU_Conversiones_Search_DB+Tribalo'));
    const reg = (await g.prepare('SELECT COUNT(*) AS n, SUM(writable) AS w FROM campaign_registry').first()) as { n: number; w: number };
    expect(reg).toEqual({ n: 3, w: 0 }); // nothing read this way is writable
  });

  it('with no booking source, booking metrics are unknown (never zero) and spend leads', async () => {
    const h = hub(), g = growth();
    await mirrorFromHub(h, g, 'acct_google_main', now, TZ);
    const o = computeOverview(await loadRaw({ db: g, now, wineryTz: TZ, currency: 'MXN' }), now, TZ, 'MXN');
    const t = Object.fromEntries(o.tickers.map(x => [x.key, x]));
    expect(t.completed_guests!.metric.value).toBeNull();
    expect(t.confirmed_bookings!.metric.value).toBeNull();
    expect(t.contribution_after_ads!.metric.value).toBeNull(); // not "minus all spend"
    expect(t.revenue_roas!.metric.value).toBeNull();
    expect(t.ad_spend!.metric.value).toBe(28 * (17537 + 19010));
    expect(t.platform_conversions!.metric.value).toBeCloseTo(14);
    expect(o.heroKey).toBe('ad_spend');
    expect(o.series.find(s => s.key === 'completed_guests')!.available).toBe(false);
  });
});
