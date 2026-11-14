// OpenTable public availability: counts, closed days, failures stay unknown (never zero), day statuses.
import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { syncAvailability, isOpenDay, EXPERIENCES } from '../src/connectors/opentable-availability.ts';
import { summarizeAvailability } from '../src/read/facts.ts';
import { addDays, localDate } from '../src/domain/time.ts';

function fakeD1(db: DatabaseSync): D1Database {
  const stmt = (sql: string, binds: unknown[] = []) => ({
    bind: (...b: unknown[]) => stmt(sql, b),
    all: async () => ({ results: db.prepare(sql).all(...(binds as never[])) }),
    first: async () => db.prepare(sql).get(...(binds as never[])) ?? null,
    run: async () => { db.prepare(sql).run(...(binds as never[])); return { meta: { changes: 1 } }; },
  });
  return { prepare: (sql: string) => stmt(sql), batch: async (ss: { run: () => Promise<unknown> }[]) => { for (const s of ss) await s.run(); return []; } } as unknown as D1Database;
}
const TZ = 'America/Mexico_City';
const now = Date.UTC(2026, 10, 14, 18, 0); // Saturday
const today = localDate(now, TZ);

function db() {
  const d = new DatabaseSync(':memory:');
  for (const f of ['0001_init.sql', '0003_opentable_availability.sql']) d.exec(readFileSync(new URL(`../migrations/${f}`, import.meta.url), 'utf8'));
  d.exec("INSERT INTO connections (id, provider, purpose, updated_at) VALUES ('conn_ot_availability', 'opentable_availability', 'x', 0)");
  return d;
}
/** Fake OpenTable: tables answer with N available slots; experiences with per-day counts; optional hash change. */
function fakeOpenTable(opts: { tables: (date: string, party: number) => number; broken?: boolean }) {
  return (async (url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    if (opts.broken) return new Response(JSON.stringify({ errors: [{ message: 'PersistedQueryNotFound' }] }), { status: 200 });
    if (url.includes('RestRefAvailability')) {
      const n = opts.tables(body.variables.date, body.variables.partySize);
      return new Response(JSON.stringify({ data: { availability: [{ availabilityDays: [{ dayOffset: 0, slots: Array.from({ length: 24 }, (_, i) => ({ isAvailable: i < n })) }] }] } }));
    }
    return new Response(JSON.stringify({ data: { experienceAvailability: { available: Array.from({ length: 30 }, (_, k) => ({ dayOffset: k, restaurantSet: [{ results: { experience: Array.from({ length: k % 3 }) } }] })) } } }));
  }) as unknown as typeof fetch;
}

describe('OpenTable availability', () => {
  it('reads open days only and stores bookable times', async () => {
    const d = db();
    const sat = today, sun = addDays(today, 1), wed = addDays(today, 4);
    const r = await syncAvailability(fakeD1(d), 1258120, now, TZ, 14, fakeOpenTable({ tables: (date, party) => (date === sun ? 0 : party === 2 ? 20 : 12) }));
    const openDays = Array.from({ length: 14 }, (_, i) => addDays(today, i)).filter(isOpenDay).length;
    expect(r).toEqual({ read: openDays * (2 + EXPERIENCES.length), failed: 0, firstError: null });
    const get = (date: string, party: number) => (d.prepare("SELECT slots FROM ot_availability WHERE date = ? AND item = 'tables' AND party_size = ?").get(date, party) as { slots: number } | undefined)?.slots;
    expect(get(sat, 2)).toBe(20);
    expect(get(sun, 2)).toBe(0);
    expect(get(addDays(today, 2), 2)).toBeUndefined(); // Monday: closed, not queried
    const s = summarizeAvailability(d.prepare('SELECT * FROM ot_availability').all() as never, today);
    expect(s.days.find(x => x.date === sat)!.status).toBe('open');
    expect(s.days.find(x => x.date === sun)!.status).toBe('full');
    expect(s.days.find(x => x.date === addDays(today, 2))!.status).toBe('closed');
    expect(s.days.find(x => x.date === wed)!.experienceTimes).toBe(EXPERIENCES.length * (4 % 3));
  });

  it('when OpenTable changes its page, values are unknown with the error, never zero', async () => {
    const d = db();
    const r = await syncAvailability(fakeD1(d), 1258120, now, TZ, 7, fakeOpenTable({ tables: () => 20, broken: true }));
    expect(r.read).toBe(0);
    expect(r.firstError).toMatch(/PersistedQueryNotFound/);
    expect((d.prepare('SELECT COUNT(*) AS n FROM ot_availability WHERE slots IS NOT NULL').get() as { n: number }).n).toBe(0);
    expect(d.prepare("SELECT health FROM connections WHERE id = 'conn_ot_availability'").get()).toEqual({ health: 'reconnect' });
    const s = summarizeAvailability(d.prepare('SELECT * FROM ot_availability').all() as never, today, 7);
    expect(s.days.find(x => x.date === today)!.status).toBe('unknown');
  });
});
