// Per-campaign cost per online reservation, and where reservations come from.
import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { loadCampaigns, sourceGroup } from '../src/read/campaigns.ts';
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

const TZ = 'America/Mexico_City';
const now = Date.UTC(2026, 10, 14, 18, 0);
const today = localDate(now, TZ);

describe('campaigns view', () => {
  it('matches Google campaigns to GA4 reservations by name, only over tracked days', async () => {
    const db = new DatabaseSync(':memory:');
    for (const f of ['0001_init.sql', '0002_ga4_reservations.sql']) db.exec(readFileSync(new URL(`../migrations/${f}`, import.meta.url), 'utf8'));
    db.exec(`INSERT INTO ad_accounts (id, provider, external_id, name, currency, account_tz, created_at) VALUES ('g', 'google_ads', '1', 'g', 'MXN', '${TZ}', 0), ('m', 'meta_ads', '2', 'm', 'MXN', '${TZ}', 0);
      INSERT INTO campaign_registry (ref, account_id, kind, external_id, name, status, products_json, updated_at) VALUES
        ('res_h1', 'g', 'campaign', 'name:1', 'MOFU_Conversiones_Search_DB+Tribalo', 'ENABLED', '[]', 0),
        ('res_h2', 'g', 'campaign', 'name:2', 'EN - In San Miguel (tours & tastings)', 'ENABLED', '[]', 0),
        ('res_m1', 'm', 'campaign', 'name:3', '20261106_BOFU_Reservas_Schedule', 'ENABLED', '[]', 0);`);
    const tracking = addDays(today, -10);
    for (let k = 1; k <= 28; k++) {
      const d = addDays(today, -k);
      db.prepare("INSERT INTO campaign_daily (account_id, campaign_id, date, currency, cost_micros, impressions, clicks, source, fetched_at) VALUES ('g', 'name:1', ?, 'MXN', 200000000, 1, 1, 'x', 0), ('g', 'name:2', ?, 'MXN', 100000000, 1, 1, 'x', 0), ('m', 'name:3', ?, 'MXN', 50000000, 1, 1, 'x', 0)").run(d, d, d);
      if (d >= tracking) db.prepare("INSERT INTO ga4_reservations_daily (date, source, medium, campaign, event_name, events, fetched_at) VALUES (?, 'google', 'cpc', 'MOFU_Conversiones_Search_DB+Tribalo', 'ot-availability-pageview', 3, 0)").run(d);
    }
    db.exec(`INSERT INTO ga4_reservations_daily (date, source, medium, campaign, event_name, events, fetched_at) VALUES
      ('${tracking}', 'google', 'cpc', 'MOFU_Conversiones_Search_DB+Tribalo', 'ot-reservation-made', 4, 0),
      ('${addDays(tracking, 1)}', 'dosbuhos.com', 'referral', '(referral)', 'ot-reservation-made', 3, 0),
      ('${addDays(tracking, 2)}', '(direct)', '(none)', '(direct)', 'ot-reservation-made', 2, 0);`);

    const v = await loadCampaigns(fakeD1(db), now, TZ, 'MXN');
    expect(v.trackingSince).toBe(tracking);
    const mofu = v.campaigns.find(c => c.name.startsWith('MOFU'))!;
    expect(mofu.spendMicros).toBe(28 * 200_000_000);
    expect(mofu.trackedSpendMicros).toBe(10 * 200_000_000); // only the 10 tracked days (yesterday back to tracking start)
    expect(mofu.reservations).toBe(4);
    expect(mofu.openedAvailability).toBe(30);
    expect(mofu.costPerReservationMinor).toBe(500_00); // MX$2,000 / 4
    const en = v.campaigns.find(c => c.name.startsWith('EN'))!;
    expect(en.reservations).toBe(0);
    expect(en.costPerReservationMinor).toBeNull();
    const meta = v.campaigns.find(c => c.provider === 'meta_ads')!;
    expect(meta.reservations).toBeNull();
    expect(meta.note).toMatch(/ID de campaña/);
    expect(v.sources).toEqual([
      { group: 'Google Ads', reservations: 4 },
      { group: 'Fuente perdida (referencia de dosbuhos.com)', reservations: 3 },
      { group: 'Directo', reservations: 2 },
    ]);
  });

  it('groups sources in plain terms', () => {
    expect(sourceGroup('google', 'cpc')).toBe('Google Ads');
    expect(sourceGroup('fb', 'paid')).toBe('Anuncios de Meta (etiquetados)');
    expect(sourceGroup('m.facebook.com', 'referral')).toBe('Facebook / Instagram (orgánico o anuncios sin etiqueta)');
    expect(sourceGroup('google', 'organic')).toBe('Búsqueda (orgánica)');
    expect(sourceGroup('chatgpt.com', 'ai-assistant')).toBe('Asistentes de IA');
  });
});
