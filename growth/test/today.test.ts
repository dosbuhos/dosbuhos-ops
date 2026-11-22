// "Hoy": the verdict per campaign and the month's pace against the ceiling.
import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { verdictFor, monthPace, loadToday } from '../src/read/today.ts';
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

const M = (pesos: number) => pesos * 1_000_000;         // micros
const CONTRIB = 1187_00, FLOOR = 1.5;                    // MX$1,187 per reservation, in minor units
const camp = (status: string, tracked: number, reservations: number | null, spend = tracked) => ({ status, spendMicros: M(spend), trackedSpendMicros: M(tracked), reservations });

describe('campaign verdict', () => {
  it('says it pays when the return clears the floor with enough reservations', () => {
    const v = verdictFor(camp('ENABLED', 4860, 12), CONTRIB, FLOOR);
    expect(v.key).toBe('rinde');
    expect(v.contributionReturn).toBeCloseTo(2.93, 2);
    expect(v.reason).toContain('12 reservaciones');
  });
  it('watches a campaign with few reservations, whichever side of the floor it is on', () => {
    expect(verdictFor(camp('ENABLED', 3716, 4), CONTRIB, FLOOR).key).toBe('vigilar');      // 1.28×, below the floor, only 4
    expect(verdictFor(camp('ENABLED', 1000, 3), CONTRIB, FLOOR).key).toBe('vigilar');      // 3.6×, but only 3
  });
  it('watches spend with no reservation until it is twice what one reservation leaves, then calls it a loss', () => {
    expect(verdictFor(camp('ENABLED', 1178, 0), CONTRIB, FLOOR).key).toBe('vigilar');
    const lost = verdictFor(camp('ENABLED', 3000, 0), CONTRIB, FLOOR);
    expect(lost.key).toBe('pierde');
    expect(lost.reason).toBe('Gastó $3,000 y no trajo ninguna reservación en línea.');
  });
  it('calls a loss when reservations do not cover the spend', () => {
    expect(verdictFor(camp('ENABLED', 9000, 6), CONTRIB, FLOOR).key).toBe('pierde');       // 0.79×
    expect(verdictFor(camp('ENABLED', 9000, 3), CONTRIB, FLOOR).key).toBe('pierde');       // few, but well under 1× on real money
    expect(verdictFor(camp('ENABLED', 5500, 6), CONTRIB, FLOOR).key).toBe('vigilar');      // 1.29×: covers itself, under the floor
  });
  it('never judges what it cannot see', () => {
    expect(verdictFor(camp('ENABLED', 500, null), CONTRIB, FLOOR).key).toBe('sin_datos');  // untagged Meta campaign
    expect(verdictFor(camp('ENABLED', 4860, 12), null, FLOOR).key).toBe('sin_datos');      // no approved value per reservation
    expect(verdictFor(camp('PAUSED', 0, 0, 0), CONTRIB, FLOOR).key).toBe('pausada');
    expect(verdictFor(camp('ENABLED', 0, 0, 0), CONTRIB, FLOOR).key).toBe('sin_datos');
  });
});

describe('month pace', () => {
  const rows = (today: string, days: number) => Array.from({ length: days }, (_, k) => addDays(today, -k)).flatMap(date => [
    { provider: 'google_ads', date, cost: date === today ? M(40) : M(100) },
    { provider: 'meta_ads', date, cost: date === today ? M(4) : M(10) },
  ]);
  it('adds the month to date and projects the rest at the last seven complete days', () => {
    const p = monthPace(rows('2026-11-22', 40), '2026-11-22', { monthlyAdSpendCeilingNative: 12000, ceilingCoversWholeAccount: true, minimumAcceptableContributionReturn: 1.5 });
    expect(p.daysInMonth).toBe(30);
    expect(p.spentMicros).toEqual({ google: M(2140), meta: M(214), total: M(2354) });     // 21 complete days + today's partial
    expect(p.last7AvgMicros.google).toBe(M(100));
    expect(p.projectedMicros.google).toBe(M(3000));                                        // 21 × 100 + 9 days left × 100
    expect(p.projectedMicros.total).toBe(M(3300));
    expect(p.ceilingMicros).toBe(M(12000));
    expect(p.ceilingScope).toBe('whole_account');
  });
  it('starts over on the first days of a month and still has a full week to average', () => {
    const p = monthPace(rows('2026-12-02', 40), '2026-12-02', null);
    expect(p.spentMicros.google).toBe(M(140));                                             // Dec 1 + today's partial
    expect(p.last7AvgMicros.google).toBe(M(100));                                          // Nov 25 – Dec 1
    expect(p.projectedMicros.google).toBe(M(100 + 30 * 100));                              // Dec 1 + 30 days left, today included
    expect(p.ceilingMicros).toBeNull();
  });
});

describe('today view', () => {
  it('puts the campaign that needs a decision first and carries yesterday', async () => {
    const TZ = 'America/Mexico_City', now = Date.UTC(2026, 10, 22, 18, 0), today = localDate(now, TZ);
    const db = new DatabaseSync(':memory:');
    for (const f of readdirSync(new URL('../migrations/', import.meta.url)).sort()) db.exec(readFileSync(new URL(`../migrations/${f}`, import.meta.url), 'utf8'));
    db.exec(`INSERT INTO ad_accounts (id, provider, external_id, name, currency, account_tz, created_at) VALUES ('g', 'google_ads', '1', 'g', 'MXN', '${TZ}', 0), ('m', 'meta_ads', '2', 'm', 'MXN', '${TZ}', 0);
      INSERT INTO campaign_registry (ref, account_id, kind, external_id, name, status, products_json, updated_at) VALUES
        ('res_h1', 'g', 'campaign', 'name:1', 'Busqueda', 'ENABLED', '[]', 0), ('res_h2', 'g', 'campaign', 'name:2', 'Tours', 'ENABLED', '[]', 0);`);
    for (let k = 0; k <= 28; k++) {
      const d = addDays(today, -k);
      db.prepare("INSERT INTO campaign_daily (account_id, campaign_id, date, currency, cost_micros, impressions, clicks, source, fetched_at) VALUES ('g', 'name:1', ?, 'MXN', 100000000, 1, 1, 'x', 0), ('g', 'name:2', ?, 'MXN', 150000000, 1, 1, 'x', 0)").run(d, d);
    }
    const first = addDays(today, -28);
    db.exec(`INSERT INTO ga4_reservations_daily (date, source, medium, campaign, event_name, events, fetched_at) VALUES
      ('${first}', 'google', 'cpc', 'Busqueda', 'ot-reservation-made', 9, 0), ('${addDays(today, -1)}', 'google', 'cpc', 'Busqueda', 'ot-reservation-made', 3, 0);`);
    const v = await loadToday(fakeD1(db), now, TZ, 'MXN', { monthlyAdSpendCeilingNative: 12000, ceilingCoversWholeAccount: true, minimumAcceptableContributionReturn: 1.5 });
    expect(v.today).toBe('2026-11-22');
    expect(v.yesterday.date).toBe('2026-11-21');
    expect(v.yesterday.spendMicros.google).toBe(M(250));
    expect(v.yesterday.onlineReservations).toBe(3);
    expect(v.yesterday.guests).toBeNull();                       // no POS rows: unknown, not zero
    expect(v.month.spentMicros.google).toBe(22 * M(250));
    expect(v.campaigns).toHaveLength(2);
    const rank = { pierde: 0, vigilar: 1, rinde: 2, sin_datos: 3, pausada: 4 } as Record<string, number>;
    expect(rank[v.campaigns[0]!.verdict.key]!).toBeLessThanOrEqual(rank[v.campaigns[1]!.verdict.key]!);
    expect(v.campaigns.every(c => ['rinde', 'vigilar', 'pierde', 'sin_datos', 'pausada'].includes(c.verdict.key))).toBe(true);
  });
});
