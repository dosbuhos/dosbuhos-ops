// GA4 online reservations: service-account auth, report parsing, idempotent sync, and how the dashboard uses it.
import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { signJwt, fetchReservations, syncGa4, Ga4Error, type ServiceAccount } from '../src/connectors/ga4.ts';
import { loadRaw, computeOverview } from '../src/read/facts.ts';
import { addDays, localDate } from '../src/domain/time.ts';

function fakeD1(db: DatabaseSync): D1Database {
  const stmt = (sql: string, binds: unknown[] = []) => ({
    bind: (...b: unknown[]) => stmt(sql, b),
    all: async () => ({ results: db.prepare(sql).all(...(binds as never[])) }),
    first: async () => db.prepare(sql).get(...(binds as never[])) ?? null,
    run: async () => { const r = db.prepare(sql).run(...(binds as never[])); return { meta: { changes: Number(r.changes) } }; },
  });
  return { prepare: (sql: string) => stmt(sql), batch: async (ss: { run: () => Promise<unknown> }[]) => { db.exec('BEGIN'); try { for (const s of ss) await s.run(); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; } return []; } } as unknown as D1Database;
}
function growthDb(): { db: DatabaseSync; d1: D1Database } {
  const db = new DatabaseSync(':memory:');
  for (const f of ['0001_init.sql', '0002_ga4_reservations.sql']) db.exec(readFileSync(new URL(`../migrations/${f}`, import.meta.url), 'utf8'));
  db.exec("INSERT INTO business_settings (id, data_kind, updated_at) VALUES (1, 'real', 0); INSERT INTO connections (id, provider, purpose, updated_at) VALUES ('conn_ga4', 'ga4', 'x', 0);");
  return { db, d1: fakeD1(db) };
}

async function keyPair(): Promise<{ sa: ServiceAccount; publicKey: CryptoKey }> {
  const kp = (await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const pkcs8 = Buffer.from(await crypto.subtle.exportKey('pkcs8', kp.privateKey)).toString('base64');
  const pem = `-----BEGIN PRIVATE KEY-----\n${pkcs8.match(/.{1,64}/g)!.join('\n')}\n-----END PRIVATE KEY-----\n`;
  return { sa: { client_email: 'growth-ga4-reader@dos-buhos.iam.gserviceaccount.com', private_key: pem }, publicKey: kp.publicKey };
}

const TZ = 'America/Mexico_City';
const now = Date.UTC(2026, 10, 14, 18, 0);
const today = localDate(now, TZ);
const ymd = (d: string) => d.replace(/-/g, '');

/** Fake Google: token endpoint + paginated runReport. */
function fakeGoogle(rows: [string, string, string, string, number, string?][], opts: { status?: number } = {}) {
  const calls: { url: string; body: string }[] = [];
  const fn = (async (url: string, init?: RequestInit) => {
    const body = String(init?.body ?? '');
    calls.push({ url, body });
    if (url.includes('oauth2')) return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 });
    if (opts.status) return new Response(JSON.stringify({ error: { message: 'User does not have sufficient permissions for this property.' } }), { status: opts.status });
    const { offset = 0 } = JSON.parse(body) as { offset?: number };
    const page = rows.slice(offset, offset + 10_000).map(([d, s, m, c, n, ev]) => ({ dimensionValues: [{ value: ymd(d) }, { value: ev ?? 'ot-reservation-made' }, { value: s }, { value: m }, { value: c }], metricValues: [{ value: String(n) }, { value: '0' }] }));
    return new Response(JSON.stringify({ rows: page, rowCount: rows.length }), { status: 200 });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe('GA4 connector', () => {
  it('signs a service-account JWT that verifies with the public key and asks only for read access', async () => {
    const { sa, publicKey } = await keyPair();
    const jwt = await signJwt(sa, now);
    const [h, b, s] = jwt.split('.') as [string, string, string];
    const dec = (x: string) => Buffer.from(x.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    expect(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', publicKey, dec(s), new TextEncoder().encode(`${h}.${b}`))).toBe(true);
    const claims = JSON.parse(dec(b).toString());
    expect(claims.scope).toBe('https://www.googleapis.com/auth/analytics.readonly');
    expect(claims.exp - claims.iat).toBe(3600);
  });

  it('reads daily reservation events by source/medium/campaign, filtered to the OpenTable event', async () => {
    const { sa } = await keyPair();
    const g = fakeGoogle([[today, 'google', 'cpc', 'EN - In San Miguel (tours & tastings)', 2], [today, '(direct)', '(none)', '(direct)', 1]]);
    const rows = await fetchReservations(sa, '123456789', addDays(today, -14), today, now, g.fn);
    expect(rows).toEqual([
      { date: today, eventName: 'ot-reservation-made', source: 'google', medium: 'cpc', campaign: 'EN - In San Miguel (tours & tastings)', events: 2, valueMicros: null },
      { date: today, eventName: 'ot-reservation-made', source: '(direct)', medium: '(none)', campaign: '(direct)', events: 1, valueMicros: null },
    ]);
    const report = JSON.parse(g.calls.find(c => c.url.includes('runReport'))!.body);
    expect(report.dimensionFilter.orGroup.expressions).toEqual([
      { filter: { fieldName: 'eventName', stringFilter: { matchType: 'BEGINS_WITH', value: 'ot-' } } },
      { filter: { fieldName: 'eventName', stringFilter: { matchType: 'EXACT', value: 'reserva_click' } } },
    ]);
    await expect(fetchReservations(sa, '12-34', today, today, now, g.fn)).rejects.toThrow(Ga4Error);
  });

  it('re-syncing replaces the window instead of double counting, and a permission error asks to reconnect', async () => {
    const { sa } = await keyPair();
    const { db, d1 } = growthDb();
    const g1 = fakeGoogle([[today, 'google', 'cpc', 'x', 3]]);
    await syncGa4(d1, sa, '123456789', now, addDays(today, -14), today, g1.fn);
    const g2 = fakeGoogle([[today, 'google', 'cpc', 'x', 4]]); // GA4 revised today's count
    await syncGa4(d1, sa, '123456789', now, addDays(today, -14), today, g2.fn);
    expect(db.prepare('SELECT SUM(events) AS n FROM ga4_reservations_daily').get()).toEqual({ n: 4 });
    await expect(syncGa4(d1, sa, '123456789', now, today, today, fakeGoogle([], { status: 403 }).fn)).rejects.toThrow(/sufficient permissions/);
    expect(db.prepare("SELECT health FROM connections WHERE id = 'conn_ga4'").get()).toEqual({ health: 'reconnect' });
    expect(db.prepare('SELECT SUM(events) AS n FROM ga4_reservations_daily').get()).toEqual({ n: 4 }); // failed sync kept the data
  });

  it('with no booking-level source, the dashboard shows online reservations and cost per reservation from Google Ads', async () => {
    const { db, d1 } = growthDb();
    db.exec("INSERT INTO ad_accounts (id, provider, external_id, name, currency, account_tz, created_at) VALUES ('a', 'google_ads', '1', 'x', 'MXN', 'America/Mexico_City', 0)");
    const gap = addDays(today, -3); // a day GA4 recorded nothing at all (like Nov 11)
    for (let k = 60; k >= 0; k--) {
      const d = addDays(today, -k);
      if (d !== gap) db.prepare("INSERT INTO ga4_reservations_daily (date, source, medium, campaign, event_name, events, fetched_at) VALUES (?, '(direct)', '(none)', '(direct)', 'ot-availability-pageview', 10, 0)").run(d);
      db.prepare("INSERT INTO campaign_daily (account_id, campaign_id, date, currency, cost_micros, impressions, clicks, platform_conversions_milli, source, fetched_at) VALUES ('a', 'c1', ?, 'MXN', 350000000, 100, 10, 1000, 'hub_feed', 0)").run(d);
      if (d !== gap) db.prepare("INSERT INTO ga4_reservations_daily (date, source, medium, campaign, event_name, events, fetched_at) VALUES (?, 'google', 'cpc', 'c1', 'ot-reservation-made', 1, 0), (?, '(direct)', '(none)', '(direct)', 'ot-reservation-made', 2, 0)").run(d, d);
    }
    const o = computeOverview(await loadRaw({ db: d1, now, wineryTz: TZ, currency: 'MXN' }), now, TZ, 'MXN');
    const t = Object.fromEntries(o.tickers.map(x => [x.key, x]));
    expect(t.confirmed_bookings!.label).toBe('Reservaciones en línea');
    expect(t.confirmed_bookings!.metric.value).toBe(27 * 3); // the gap day is excluded and named, never counted as zero
    expect(t.confirmed_bookings!.metric.reason).toContain(`Excluye 1 día(s) en que GA4 no registró nada: ${gap}`);
    expect(t.cost_per_online_reservation!.metric.value).toBe(350_00); // spend over the same 27 days / 27 Google Ads reservations
    const daily = o.series.find(s => s.key === 'online_reservations')!.points;
    expect(daily.find(p => p.date === gap)!.value).toBeNull();
    expect(daily.find(p => p.date === addDays(gap, -1))!.value).toBe(3);
    expect(o.funnel!.gaps).toEqual([gap]);
    expect(o.funnel!.steps.find(s => s.event === 'ot-reservation-made')!.count).toBe(27 * 3);
    expect(t.completed_guests!.metric.value).toBeNull(); // GA4 doesn't know who showed up
    expect(t.contribution_after_ads!.metric.value).toBeNull();
    expect(o.heroKey).toBe('online_reservations');
  });
});
