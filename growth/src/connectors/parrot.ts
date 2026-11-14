// Parrot POS external API (https://developer.parrotsoftware.io): Bearer private key, base https://api.parrot.rest/external/,
// pages of at most 100 (from 0), date ranges of at most 48 h, 15 requests per minute per user.
// Each run re-reads the most recent 48 h (late edits and closings) and then backfills older 48-hour windows within a
// request budget, so history fills in over a day or two without tripping the rate limit.
import { localDate } from '../domain/time.ts';

export const PARROT_BASE = 'https://api.parrot.rest/external';
export const POS_BACKFILL_FROM = '2025-11-01';
/** Staff started recording guest counts consistently on this date; earlier customersCount values are not used. */
export const POS_GUESTS_RELIABLE_FROM = '2026-11-04';
const WINDOW_MS = 48 * 3600_000;
const ENDPOINTS = ['orders', 'items', 'payments'] as const;
type Endpoint = (typeof ENDPOINTS)[number];
const PATH: Record<Endpoint, string> = { orders: '/v1/orders', items: '/v2/order-items', payments: '/v1/order-payments' };

export class ParrotError extends Error { constructor(public readonly status: number, message: string) { super(message); } }

const minor = (v: unknown): number => { const n = Number(v ?? 0); return Number.isFinite(n) ? Math.round(n * 100) : 0; };
const str = (v: unknown, n = 200) => String(v ?? '').slice(0, n);

/** Every page of one endpoint for one window. Stops early when the request budget runs out (returns null then). */
async function fetchWindow(key: string, ep: Endpoint, start: number, end: number, budget: { left: number }, fetchFn: typeof fetch): Promise<Record<string, unknown>[] | null> {
  const out: Record<string, unknown>[] = [];
  for (let page = 0; page < 200; page++) {
    if (budget.left <= 0) return null;
    budget.left--;
    const q = new URLSearchParams({ startTimestamp: new Date(start).toISOString(), endTimestamp: new Date(end).toISOString(), pageSize: '100', page: String(page), sort: 'createdAt' });
    const r = await fetchFn(`${PARROT_BASE}${PATH[ep]}?${q}`, { headers: { authorization: `Bearer ${key}`, accept: 'application/json' } });
    const j = (await r.json().catch(() => null)) as { data?: Record<string, unknown>[]; pagination?: { next?: number | null }; error?: string } | null;
    if (!r.ok) throw new ParrotError(r.status, `Parrot ${r.status}: ${j?.error ?? 'la solicitud falló'}`.slice(0, 200));
    out.push(...(j?.data ?? []));
    if (j?.pagination?.next === null || j?.pagination?.next === undefined || !(j?.data ?? []).length) break;
  }
  return out;
}

function statements(db: D1Database, ep: Endpoint, rows: Record<string, unknown>[], tz: string, now: number): D1PreparedStatement[] {
  return rows.flatMap(r => {
    const created = Date.parse(str(r.createdAt, 40));
    if (!r.uuid || !Number.isFinite(created)) return [];
    const day = localDate(created, tz);
    if (ep === 'orders') return [db.prepare(`INSERT OR REPLACE INTO pos_orders (uuid, store_uuid, created_at, local_date, status, order_type, order_type_name, table_name, customers, total_minor, taxes_minor, discounts_minor, reference, fetched_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(str(r.uuid, 60), str(r.storeUuid, 60), created, day, str(r.status, 30), str(r.orderType, 30), str(r.orderTypeName, 60), str(r.tableName, 60),
      r.customersCount === null || r.customersCount === undefined ? null : Math.max(0, Math.round(Number(r.customersCount))), minor(r.total), minor(r.totalTaxes), minor(r.totalDiscounts), str(r.orderReference, 40), now)];
    if (ep === 'items') return [db.prepare(`INSERT OR REPLACE INTO pos_items (uuid, order_uuid, local_date, item_name, category, product_type, quantity, total_minor, subtotal_minor, status, fetched_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(str(r.uuid, 60), str(r.orderUuid, 60), day, str(r.itemName), str(r.categoryName, 80), str(r.productType, 80), Number(r.quantity ?? 0) || 0, minor(r.total),
      r.subtotal === undefined || r.subtotal === null ? null : minor(r.subtotal), str(r.itemStatus, 30), now)];
    return [db.prepare(`INSERT OR REPLACE INTO pos_payments (uuid, order_uuid, local_date, status, payment_type, amount_minor, tip_minor, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(str(r.uuid, 60), str(r.orderUuid, 60), day, str(r.status, 30), str(r.paymentTypeName, 60), minor(r.amount), minor(r.tip), now)];
  });
}

/** One run: recent 48 h for every endpoint, then backfill older windows newest-first until the budget is spent. */
export async function syncParrot(db: D1Database, key: string, now: number, tz: string, maxRequests = 12, fetchFn: typeof fetch = fetch): Promise<{ recentRows: number; backfilled: number; oldestDone: string | null; complete: boolean }> {
  const budget = { left: maxRequests };
  const writeAll = async (ep: Endpoint, rows: Record<string, unknown>[]) => { const s = statements(db, ep, rows, tz, now); for (let i = 0; i < s.length; i += 80) await db.batch(s.slice(i, i + 80)); };
  let recentRows = 0;
  // Windows are aligned to whole 48-hour blocks (UTC), so the backfill ledger is stable from run to run.
  const align = (t: number) => Math.floor(t / WINDOW_MS) * WINDOW_MS;
  const currentStart = align(now);
  for (const ep of ENDPOINTS) {
    for (const start of [currentStart - WINDOW_MS, currentStart]) {           // previous block too: catches late closings
      const rows = await fetchWindow(key, ep, start, Math.min(start + WINDOW_MS, now), budget, fetchFn);
      if (rows === null) break;
      await writeAll(ep, rows); recentRows += rows.length;
    }
  }
  let backfilled = 0;
  const floor = Date.parse(`${POS_BACKFILL_FROM}T00:00:00Z`);
  const done = new Set((await db.prepare('SELECT endpoint || \'|\' || window_start AS k FROM pos_sync_windows').all<{ k: string }>()).results.map(r => r.k));
  outer: for (let start = currentStart - 2 * WINDOW_MS; start >= align(floor); start -= WINDOW_MS) {
    for (const ep of ENDPOINTS) {
      const k = `${ep}|${new Date(start).toISOString()}`;
      if (done.has(k)) continue;
      const rows = await fetchWindow(key, ep, start, start + WINDOW_MS, budget, fetchFn);
      if (rows === null) break outer;
      await writeAll(ep, rows);
      await db.prepare('INSERT OR REPLACE INTO pos_sync_windows (endpoint, window_start, done_at, rows) VALUES (?, ?, ?, ?)').bind(ep, new Date(start).toISOString(), now, rows.length).run();
      done.add(k); backfilled++;
    }
  }
  const oldest = await db.prepare('SELECT MIN(local_date) AS d FROM pos_orders').first<{ d: string | null }>();
  const expected = Math.floor((currentStart - 2 * WINDOW_MS - align(floor)) / WINDOW_MS + 1) * ENDPOINTS.length;
  return { recentRows, backfilled, oldestDone: oldest?.d ?? null, complete: done.size >= expected };
}
