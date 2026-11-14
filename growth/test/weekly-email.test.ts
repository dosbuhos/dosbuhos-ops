// Weekly summary email: last full Mon–Sun week, plain numbers, missing data said in words.
import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { buildWeeklyEmail } from '../src/report/weekly-email.ts';
import { dueJobs, DEFAULT_SCHEDULE } from '../src/domain/scheduler.ts';

function fakeD1(db: DatabaseSync): D1Database {
  const stmt = (sql: string, binds: unknown[] = []) => ({
    bind: (...b: unknown[]) => stmt(sql, b),
    all: async () => ({ results: db.prepare(sql).all(...(binds as never[])) }),
    first: async () => db.prepare(sql).get(...(binds as never[])) ?? null,
    run: async () => { db.prepare(sql).run(...(binds as never[])); return { meta: { changes: 1 } }; },
  });
  return { prepare: (sql: string) => stmt(sql) } as unknown as D1Database;
}
const TZ = 'America/Mexico_City';

describe('weekly summary email', () => {
  it('summarizes last Mon–Sun with estimates and flags incomplete GA4 days', async () => {
    const db = new DatabaseSync(':memory:');
    for (const f of ['0001_init.sql', '0002_ga4_reservations.sql', '0006_reservation_value_estimates.sql', '0007_estimate_costs.sql', '0008_ga4_ads_queries.sql']) db.exec(readFileSync(new URL(`../migrations/${f}`, import.meta.url), 'utf8'));
    db.exec(`INSERT INTO ad_accounts (id, provider, external_id, name, currency, account_tz, created_at) VALUES ('g', 'google_ads', '1', 'g', 'MXN', '${TZ}', 0);
      INSERT INTO campaign_daily (account_id, campaign_id, date, currency, cost_micros, impressions, clicks, source, fetched_at) VALUES ('g', 'c', '2026-11-10', 'MXN', 2000000000, 1, 1, 'x', 0);
      INSERT INTO ga4_reservations_daily (date, source, medium, campaign, event_name, events, fetched_at) VALUES ('2026-11-10', 'google', 'cpc', 'c', 'ot-reservation-made', 2, 0), ('2026-11-11', 'dosbuhos.com', 'referral', '(referral)', 'ot-reservation-made', 2, 0);
      INSERT INTO reservation_value_estimates (id, product, value_minor, basis, approved_by, approved_at) VALUES ('e', 'restaurant_visit', 156000, 'Parrot', 'Eric', 1);
      INSERT INTO estimate_costs (id, key, value, basis, provisional, approved_by, approved_at) VALUES ('a', 'restaurant_cost_pct', 2100, 'b', 1, 'Eric', 1), ('b', 'payment_fee_pct', 290, 'b', 0, 'Eric', 1), ('c', 'opentable_fee_per_reservation', 0, 'b', 1, 'Eric', 1);
      INSERT INTO ga4_ads_queries (date, campaign, query, sessions, fetched_at) VALUES ('2026-11-10', 'c', 'dos buhos', 30, 0), ('2026-11-10', 'c', 'viñedos san miguel', 70, 0);`);
    const m = await buildWeeklyEmail(fakeD1(db), Date.UTC(2026, 10, 16, 16), TZ, 'https://x/'); // Monday Nov 16, 10:00 local
    expect(m.subject).toContain('11-09 a 11-15');
    expect(m.text).toContain('Reservaciones en línea (widget de OpenTable): 4');
    expect(m.text).toContain('Costo por reservación (Google Ads): MX$1,000');
    expect(m.text).toMatch(/Contribución estimada después de Google Ads: MX\$374/); // 2 × 1,187.16 − 2,000
    expect(m.text).toContain('30% del tráfico');
    expect(m.text).toContain('GA4 tiene datos de 2 de 7 días');
    expect(m.text).toContain('2 de 4 reservaciones perdieron su fuente');
    expect(m.text).toContain('2 costo(s) siguen como provisionales');
    expect(m.html).not.toContain('<script');
  });

  it('is due once on Monday from 09:00 winery time', () => {
    const at = (h: number) => dueJobs(Date.UTC(2026, 10, 16, h + 6), DEFAULT_SCHEDULE).filter(j => j.job === 'weekly_email');
    expect(at(8)).toHaveLength(0);
    expect(at(9)).toEqual([{ job: 'weekly_email', runKey: 'weekly_email:2026-11-16', logicalDate: '2026-11-16' }]);
    expect(dueJobs(Date.UTC(2026, 10, 17, 16), DEFAULT_SCHEDULE).some(j => j.job === 'weekly_email')).toBe(false);
  });
});
