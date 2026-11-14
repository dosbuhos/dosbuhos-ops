// Owner-approved value per reservation: newest wins, history kept, used only for "estimated" numbers.
import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { loadEstimates, saveEstimate } from '../src/read/estimates.ts';
import { loadCampaigns } from '../src/read/campaigns.ts';
import { addDays, localDate } from '../src/domain/time.ts';

function fakeD1(db: DatabaseSync): D1Database {
  const stmt = (sql: string, binds: unknown[] = []) => ({
    bind: (...b: unknown[]) => stmt(sql, b),
    all: async () => ({ results: db.prepare(sql).all(...(binds as never[])) }),
    first: async () => db.prepare(sql).get(...(binds as never[])) ?? null,
    run: async () => { db.prepare(sql).run(...(binds as never[])); return { meta: { changes: 1 } }; },
  });
  return { prepare: (sql: string) => stmt(sql) } as unknown as D1Database;
}
const mig = (db: DatabaseSync, ...files: string[]) => { for (const f of files) db.exec(readFileSync(new URL(`../migrations/${f}`, import.meta.url), 'utf8')); };
const TZ = 'America/Mexico_City';

describe('reservation value estimates', () => {
  it('uses the newest approval per product and keeps the history', async () => {
    const db = new DatabaseSync(':memory:'); mig(db, '0006_reservation_value_estimates.sql');
    const d = fakeD1(db);
    expect((await loadEstimates(d)).current).toEqual({});
    await saveEstimate(d, { product: 'restaurant_visit', valueMinor: 150000, basis: 'a', sourcePeriod: '', note: '' }, 'eric', 1);
    await saveEstimate(d, { product: 'restaurant_visit', valueMinor: 156000, basis: 'Parrot', sourcePeriod: 'p', note: '' }, 'eric', 2);
    await saveEstimate(d, { product: 'tour_tasting', valueMinor: 250000, basis: 'Rezdy', sourcePeriod: '', note: '' }, 'eric', 3);
    const e = await loadEstimates(d);
    expect(e.current.restaurant_visit).toMatchObject({ valueMinor: 156000, basis: 'Parrot', approvedBy: 'eric' });
    expect(e.current.tour_tasting?.valueMinor).toBe(250000);
    expect(e.history).toHaveLength(3);
    await expect(saveEstimate(d, { product: 'tour_tasting', valueMinor: 0, basis: 'x', sourcePeriod: '', note: '' }, 'eric', 4)).rejects.toThrow();
  });

  it('campaign estimated revenue and return use the approved value; none without one', async () => {
    const now = Date.UTC(2026, 10, 14, 18, 0), today = localDate(now, TZ), day = addDays(today, -2);
    const db = new DatabaseSync(':memory:'); mig(db, '0001_init.sql', '0002_ga4_reservations.sql', '0006_reservation_value_estimates.sql');
    db.exec(`INSERT INTO ad_accounts (id, provider, external_id, name, currency, account_tz, created_at) VALUES ('g', 'google_ads', '1', 'g', 'MXN', '${TZ}', 0);
      INSERT INTO campaign_registry (ref, account_id, kind, external_id, name, status, products_json, updated_at) VALUES ('res_h1', 'g', 'campaign', 'name:1', 'MOFU', 'ENABLED', '[]', 0);
      INSERT INTO campaign_daily (account_id, campaign_id, date, currency, cost_micros, impressions, clicks, source, fetched_at) VALUES ('g', 'name:1', '${day}', 'MXN', 1000000000, 1, 1, 'x', 0);
      INSERT INTO ga4_reservations_daily (date, source, medium, campaign, event_name, events, fetched_at) VALUES ('${day}', 'google', 'cpc', 'MOFU', 'ot-reservation-made', 2, 0);`);
    const d = fakeD1(db);
    let c = (await loadCampaigns(d, now, TZ, 'MXN')).campaigns[0]!;
    expect(c.estimatedRevenueMinor).toBeNull();
    await saveEstimate(d, { product: 'restaurant_visit', valueMinor: 156000, basis: 'Parrot', sourcePeriod: '', note: '' }, 'eric', 1);
    const v = await loadCampaigns(d, now, TZ, 'MXN'); c = v.campaigns[0]!;
    expect(v.estimate?.valueMinor).toBe(156000);
    expect(c.estimatedRevenueMinor).toBe(312000);           // 2 × MX$1,560
    expect(c.estimatedReturn).toBeCloseTo(3120 / 1000, 5);  // MX$3,120 estimated ÷ MX$1,000 spend
  });
});
