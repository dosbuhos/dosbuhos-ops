// Parrot POS connector: paging, 48-hour windows, request budget, backfill ledger, and storage.
import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { syncParrot } from '../src/connectors/parrot.ts';

function fakeD1(db: DatabaseSync): D1Database {
  const stmt = (sql: string, binds: unknown[] = []): any => ({
    bind: (...b: unknown[]) => stmt(sql, b),
    all: async () => ({ results: db.prepare(sql).all(...(binds as never[])) }),
    first: async () => db.prepare(sql).get(...(binds as never[])) ?? null,
    run: async () => { db.prepare(sql).run(...(binds as never[])); return { meta: { changes: 1 } }; },
  });
  return { prepare: (sql: string) => stmt(sql), batch: async (s: any[]) => { for (const x of s) await x.run(); return []; } } as unknown as D1Database;
}

describe('Parrot sync', () => {
  it('reads recent windows, pages, stores orders/items/payments and stays within the request budget', async () => {
    const db = new DatabaseSync(':memory:');
    for (const f of ['0001_init.sql', '0010_parrot_pos.sql']) db.exec(readFileSync(new URL(`../migrations/${f}`, import.meta.url), 'utf8'));
    const calls: string[] = [];
    const fetchFn = (async (url: string, init: RequestInit) => {
      calls.push(url);
      expect((init.headers as Record<string, string>).authorization).toBe('Bearer pk_test');
      const u = new URL(url), page = Number(u.searchParams.get('page'));
      const span = Date.parse(u.searchParams.get('endTimestamp')!) - Date.parse(u.searchParams.get('startTimestamp')!);
      expect(span).toBeLessThanOrEqual(48 * 3600_000);
      const at = u.searchParams.get('startTimestamp')!.replace('.000', '');
      const data = u.pathname.endsWith('/v1/orders') ? [{ uuid: `o${calls.length}`, createdAt: at, status: 'FINISHED', orderType: 'DINE_IN', customersCount: 3, total: '1160.00', totalTaxes: '160.00', totalDiscounts: '0.00', storeUuid: 's' }]
        : u.pathname.endsWith('/v2/order-items') ? [{ uuid: `i${calls.length}`, orderUuid: 'o1', createdAt: at, itemName: 'Tour con Degustación de 4 Vinos', categoryName: 'Enoturismo', quantity: 1, total: 700, subtotal: 603.45 }]
        : [{ uuid: `p${calls.length}`, orderUuid: 'o1', createdAt: at, status: 'CHARGED', paymentTypeName: 'Pay TDC', amount: 1160, tip: 100 }];
      return new Response(JSON.stringify({ data, pagination: { next: page === 0 && u.pathname.endsWith('/v1/orders') ? 1 : null } }), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await syncParrot(fakeD1(db), 'pk_test', Date.UTC(2026, 10, 14, 20), 'America/Mexico_City', 12, fetchFn);
    expect(calls.length).toBeLessThanOrEqual(12);
    expect(r.recentRows).toBeGreaterThan(0);
    expect(r.complete).toBe(false);
    const o = db.prepare('SELECT customers, total_minor, taxes_minor FROM pos_orders LIMIT 1').get();
    expect(o).toEqual({ customers: 3, total_minor: 116000, taxes_minor: 16000 });
    expect(db.prepare('SELECT subtotal_minor, category FROM pos_items LIMIT 1').get()).toEqual({ subtotal_minor: 60345, category: 'Enoturismo' });
    expect(db.prepare('SELECT tip_minor FROM pos_payments LIMIT 1').get()).toEqual({ tip_minor: 10000 });
    const before = (db.prepare('SELECT COUNT(*) AS n FROM pos_sync_windows').get() as { n: number }).n;
    await syncParrot(fakeD1(db), 'pk_test', Date.UTC(2026, 10, 14, 20, 15), 'America/Mexico_City', 12, fetchFn);
    expect((db.prepare('SELECT COUNT(*) AS n FROM pos_sync_windows').get() as { n: number }).n).toBeGreaterThan(before); // backfill resumes
  });

  it('a 401 surfaces as an error (key wrong or revoked)', async () => {
    const db = new DatabaseSync(':memory:');
    for (const f of ['0001_init.sql', '0010_parrot_pos.sql']) db.exec(readFileSync(new URL(`../migrations/${f}`, import.meta.url), 'utf8'));
    const fetchFn = (async () => new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })) as unknown as typeof fetch;
    await expect(syncParrot(fakeD1(db), 'bad', Date.UTC(2026, 10, 14, 20), 'America/Mexico_City', 12, fetchFn)).rejects.toThrow(/401/);
  });
});
