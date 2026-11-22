// OpenTable reservations through Klaviyo's OpenTable integration (connected 2026-11-22). Klaviyo receives every
// reservation event in real time; this reads them back with a read-only private key (scopes events:read and
// metrics:read) and keeps one row per reservation. Only the reservation's own facts are kept: confirmation number,
// times, party size, how it was booked, table and status. The guest's profile is never requested, and guest requests,
// visit tags and the server's name are dropped on arrival.
// API: https://developers.klaviyo.com/en/reference/get_events (200 events a page, 350 requests/s, 3500/min).
import { localDate } from '../domain/time.ts';

export const KLAVIYO_BASE = 'https://a.klaviyo.com/api';
export const KLAVIYO_REVISION = '2026-07-15';
/** Klaviyo's metric names for OpenTable, and the status each one gives a reservation. */
export const RESERVATION_METRICS = {
  'Created Reservation': 'created', 'Confirmed Reservation': 'confirmed', 'Completed Reservation': 'completed', 'Cancelled Reservation': 'cancelled', 'No Showed Reservation': 'no_show',
} as const;
export type ReservationStatus = (typeof RESERVATION_METRICS)[keyof typeof RESERVATION_METRICS];
const RANK: Record<ReservationStatus, number> = { created: 1, confirmed: 2, completed: 3, cancelled: 3, no_show: 3 };
/** Klaviyo holds two years of OpenTable history; the first read starts a little before that. */
const HISTORY_MS = 760 * 86_400_000;
/** Once caught up, each run re-reads the last two days: an event can arrive late with an older time. */
const OVERLAP_MS = 2 * 86_400_000;
const METRIC_RETRY_MS = 20 * 3_600_000;

export class KlaviyoError extends Error { constructor(public readonly status: number, message: string) { super(message); } }

type Json = Record<string, unknown>;
async function get(key: string, url: string, fetchFn: typeof fetch): Promise<{ data?: { id?: string; attributes?: Json }[]; links?: { next?: string | null } }> {
  const r = await fetchFn(url, { headers: { authorization: `Klaviyo-API-Key ${key}`, revision: KLAVIYO_REVISION, accept: 'application/vnd.api+json' } });
  const j = (await r.json().catch(() => null)) as { errors?: { detail?: string; title?: string }[] } | null;
  if (!r.ok) throw new KlaviyoError(r.status, `Klaviyo ${r.status}: ${j?.errors?.[0]?.detail ?? j?.errors?.[0]?.title ?? 'la solicitud falló'}`.slice(0, 200));
  return (j ?? {}) as never;
}

export interface ReservationRow {
  confirmationId: string; status: ReservationStatus; statusAt: number;
  createdAt: number | null; scheduledAt: number | null; partySize: number | null; origin: string; tableName: string;
  arrivedAt: number | null; seatedAt: number | null; doneAt: number | null; posTotalMinor: number | null; currency: string;
}

const time = (v: unknown): number | null => { const t = typeof v === 'string' ? Date.parse(v) : NaN; return Number.isFinite(t) && t > Date.UTC(2015, 0, 1) && t < Date.UTC(2100, 0, 1) ? t : null; };
const ORIGIN: Record<string, string> = { web: 'web', phone: 'phone', 'walk-in': 'walk-in', 'walk in': 'walk-in', walkin: 'walk-in' };

/** One Klaviyo event → the reservation facts in it. Null when it is not a usable reservation event (or belongs to another restaurant). */
export function parseReservation(props: Json | null | undefined, status: ReservationStatus, eventAt: number, restaurantId?: string): ReservationRow | null {
  if (!props || !Number.isFinite(eventAt)) return null;
  const id = String(props['Confirmation ID'] ?? '').trim();
  if (!/^[A-Za-z0-9-]{1,40}$/.test(id)) return null;
  if (restaurantId && props['Restaurant ID'] !== undefined && props['Restaurant ID'] !== null && String(props['Restaurant ID']) !== restaurantId) return null;
  const tables = (Array.isArray(props['Table Number']) ? props['Table Number'] : [props['Table Number']]).map(t => String(t ?? '').trim()).filter(t => /^[\p{L}\p{N} ._-]{1,12}$/u.test(t));
  const party = Math.round(Number(props['Party Size']));
  const pos = Number((props['POS Data'] as Json | undefined)?.['POS Total'] ?? props['$value']);
  const currency = String(props['Currency Code'] ?? '').toUpperCase();
  return {
    confirmationId: id, status, statusAt: eventAt,
    createdAt: time(props['Created Date']), scheduledAt: time(props['Scheduled Time']),
    partySize: Number.isFinite(party) && party >= 1 && party <= 500 ? party : null,
    origin: ORIGIN[String(props['Reservation Origin'] ?? '').trim().toLowerCase()] ?? '',
    tableName: tables.slice(0, 4).join('+'),
    arrivedAt: time(props['Arrived Time']), seatedAt: time(props['Seated Time']), doneAt: time(props['Done Time']),
    posTotalMinor: Number.isFinite(pos) && pos > 0 ? Math.round(pos * 100) : null,
    currency: /^[A-Z]{3}$/.test(currency) ? currency : '',
  };
}

/** Events can arrive in any order: the newest one decides the status and the details that can change (time, party,
 *  table); a detail an event does not carry never erases one that is already known. */
function upsert(db: D1Database, r: ReservationRow, tz: string, now: number): D1PreparedStatement {
  const newer = '(excluded.status_at > ot_reservations.status_at OR (excluded.status_at = ot_reservations.status_at AND excluded.status_rank >= ot_reservations.status_rank))';
  const latest = (c: string) => `${c} = CASE WHEN ${newer} THEN COALESCE(excluded.${c}, ot_reservations.${c}) ELSE COALESCE(ot_reservations.${c}, excluded.${c}) END`;
  const latestText = (c: string) => `${c} = CASE WHEN ${newer} AND excluded.${c} <> '' THEN excluded.${c} WHEN ot_reservations.${c} <> '' THEN ot_reservations.${c} ELSE excluded.${c} END`;
  const keep = (c: string) => `${c} = COALESCE(excluded.${c}, ot_reservations.${c})`;
  return db.prepare(`INSERT INTO ot_reservations (confirmation_id, created_at, created_date, scheduled_at, service_date, party_size, origin, status, status_rank, status_at, table_name, arrived_at, seated_at, done_at, pos_total_minor, currency, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(confirmation_id) DO UPDATE SET ${keep('created_at')}, ${keep('created_date')}, ${latest('scheduled_at')}, ${latest('service_date')}, ${latest('party_size')}, ${latestText('origin')}, ${latestText('table_name')},
      ${keep('arrived_at')}, ${keep('seated_at')}, ${keep('done_at')}, ${keep('pos_total_minor')}, ${latestText('currency')},
      status = CASE WHEN ${newer} THEN excluded.status ELSE ot_reservations.status END, status_rank = CASE WHEN ${newer} THEN excluded.status_rank ELSE ot_reservations.status_rank END,
      status_at = MAX(excluded.status_at, ot_reservations.status_at), updated_at = excluded.updated_at`)
    .bind(r.confirmationId, r.createdAt, r.createdAt === null ? null : localDate(r.createdAt, tz), r.scheduledAt, r.scheduledAt === null ? null : localDate(r.scheduledAt, tz), r.partySize, r.origin, r.status, RANK[r.status], r.statusAt,
      r.tableName, r.arrivedAt, r.seatedAt, r.doneAt, r.posTotalMinor, r.currency, now);
}

interface MetricState { metric: string; metric_id: string | null; cursor: string | null; done: number; updated_at: number }

/** Klaviyo creates a metric with its first event, so "No Showed Reservation" may not exist yet: missing ones are asked for again once a day. */
async function resolveMetrics(db: D1Database, key: string, now: number, budget: { left: number }, fetchFn: typeof fetch): Promise<Map<string, MetricState>> {
  const names = Object.keys(RESERVATION_METRICS);
  const rows = (await db.prepare('SELECT metric, metric_id, cursor, done, updated_at FROM klaviyo_sync_state').all<MetricState>()).results;
  const state = new Map(names.map(n => [n, rows.find(r => r.metric === n) ?? { metric: n, metric_id: null, cursor: null, done: 0, updated_at: 0 }]));
  const missing = [...state.values()].filter(s => !s.metric_id);
  if (!missing.length || missing.every(s => now - s.updated_at < METRIC_RETRY_MS && s.updated_at > 0 && rows.some(r => r.metric_id))) return state;
  const found = new Map<string, { id: string; openTable: boolean }>();
  let url: string | null = `${KLAVIYO_BASE}/metrics/`;
  for (let page = 0; url && page < 5 && budget.left > 0; page++) {
    budget.left--;
    const j = await get(key, url, fetchFn);
    for (const m of j.data ?? []) {
      const name = String(m.attributes?.name ?? ''), openTable = /opentable/i.test(String((m.attributes?.integration as Json | undefined)?.name ?? ''));
      if (!m.id || !names.includes(name)) continue;
      const have = found.get(name);
      if (!have || (openTable && !have.openTable)) found.set(name, { id: String(m.id), openTable });   // another integration can use the same name
    }
    url = typeof j.links?.next === 'string' && j.links.next.startsWith(`${KLAVIYO_BASE}/`) ? j.links.next : null;
  }
  const stmts = names.map(n => {
    const s = state.get(n)!;
    if (!s.metric_id && found.has(n)) s.metric_id = found.get(n)!.id;
    s.updated_at = now;
    return db.prepare('INSERT INTO klaviyo_sync_state (metric, metric_id, cursor, done, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(metric) DO UPDATE SET metric_id = COALESCE(klaviyo_sync_state.metric_id, excluded.metric_id), updated_at = excluded.updated_at')
      .bind(n, s.metric_id, s.cursor, s.done, now);
  });
  await db.batch(stmts);
  return state;
}

export interface KlaviyoSyncResult { events: number; stored: number; complete: boolean; reservations: number; oldest: string | null; newestAt: number | null; calls: number; missing: string[] }

/** One run: every reservation metric, a few pages each, oldest first, continuing where the last run stopped. */
export async function syncKlaviyoReservations(db: D1Database, key: string, now: number, tz: string, opts: { restaurantId?: string; maxCalls?: number; fetchFn?: typeof fetch } = {}): Promise<KlaviyoSyncResult> {
  const fetchFn = opts.fetchFn ?? fetch, maxCalls = opts.maxCalls ?? 16;
  const budget = { left: maxCalls };
  const state = await resolveMetrics(db, key, now, budget, fetchFn);
  const ready = [...state.values()].filter(s => s.metric_id);
  const perMetric = Math.max(1, Math.floor(budget.left / Math.max(1, ready.length)));
  let events = 0, stored = 0;
  for (const s of ready) {
    const status = RESERVATION_METRICS[s.metric as keyof typeof RESERVATION_METRICS];
    const from = s.cursor ? Date.parse(s.cursor) - (s.done ? OVERLAP_MS : 0) : now - HISTORY_MS;
    const filter = `and(equals(metric_id,"${s.metric_id}"),greater-or-equal(datetime,${new Date(from).toISOString().replace(/\.\d{3}Z$/, 'Z')}))`;
    let url: string | null = `${KLAVIYO_BASE}/events/?${new URLSearchParams({ filter, sort: 'datetime', 'fields[event]': 'datetime,event_properties' })}`;
    let cursor = s.cursor, done = false;
    for (let page = 0; url && page < perMetric && budget.left > 0; page++) {
      budget.left--;
      const j = await get(key, url, fetchFn);
      const stmts: D1PreparedStatement[] = [];
      for (const e of j.data ?? []) {
        events++;
        const at = time(e.attributes?.datetime);
        if (at === null) continue;
        if (!cursor || at > Date.parse(cursor)) cursor = new Date(at).toISOString();
        const row = parseReservation(e.attributes?.event_properties as Json | undefined, status, at, opts.restaurantId);
        if (row) { stmts.push(upsert(db, row, tz, now)); stored++; }
      }
      url = typeof j.links?.next === 'string' && j.links.next.startsWith(`${KLAVIYO_BASE}/`) ? j.links.next : null;
      done = !url;
      // The page and the note of how far it reached are saved together.
      stmts.push(db.prepare('UPDATE klaviyo_sync_state SET cursor = ?, done = ?, updated_at = ? WHERE metric = ?').bind(cursor, done || s.done ? 1 : 0, now, s.metric));
      for (let i = 0; i < stmts.length; i += 50) await db.batch(stmts.slice(i, i + 50));
    }
    s.cursor = cursor; if (done) s.done = 1;
  }
  const span = await db.prepare('SELECT COUNT(*) AS n, MIN(service_date) AS oldest, MAX(status_at) AS newest FROM ot_reservations').first<{ n: number; oldest: string | null; newest: number | null }>();
  const missing = [...state.values()].filter(s => !s.metric_id).map(s => s.metric);
  return { events, stored, complete: ready.length > 0 && ready.every(s => s.done), reservations: Number(span?.n ?? 0), oldest: span?.oldest ?? null, newestAt: span?.newest ?? null, calls: maxCalls - budget.left, missing };
}
