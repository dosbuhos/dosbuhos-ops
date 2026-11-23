// Who made each OpenTable reservation: name, email and phone, read from Klaviyo for the Reservaciones app
// (reservaciones/). Growth Terminal neither stores nor shows any of this: the rows go straight out through the
// KlaviyoGuests entrypoint (src/guests.ts) to the one Worker that binds it, and the key stays here. Read-only
// (scopes events:read and profiles:read). Everything else in the event stays behind: guest requests, visit tags and
// the server's name are never passed on.
// API: https://developers.klaviyo.com/en/reference/get_events with include=profile (200 events a page).
import { KLAVIYO_BASE, KLAVIYO_REVISION, KlaviyoError, RESERVATION_METRICS } from './klaviyo-reservations.ts';

export interface GuestRow { confirmationId: string; eventAt: number; scheduledAt: number | null; firstName: string; lastName: string; email: string; phone: string }
/** `since` is an ISO 8601 time; `cursor` is the one the previous page returned (same metric and since). */
export interface GuestQuery { metric: string; since?: string | null; cursor?: string | null }
export interface GuestPage {
  ready: boolean;            // false while Klaviyo has no such metric yet (a metric appears with its first event), or no key
  guests: GuestRow[];
  events: number;            // events on this page, usable or not
  newest: string | null;     // time of the newest event on this page (ISO 8601): how far the read has reached
  cursor: string | null;     // null on the last page
}
export const NOT_READY: GuestPage = { ready: false, guests: [], events: 0, newest: null, cursor: null };

/** Klaviyo holds two years of OpenTable history; a read with no `since` starts a little before that. */
const HISTORY_MS = 760 * 86_400_000;
/** The only profile fields ever asked for. */
export const GUEST_PROFILE_FIELDS = 'first_name,last_name,email,phone_number';

type Json = Record<string, unknown>;
interface Resource { type?: string; id?: string; attributes?: Json; relationships?: { profile?: { data?: { id?: string } | null } } }
interface Body { data?: Resource[]; included?: Resource[]; links?: { next?: string | null }; errors?: { detail?: string; title?: string }[] }

const time = (v: unknown): number | null => { const t = typeof v === 'string' ? Date.parse(v) : NaN; return Number.isFinite(t) && t > Date.UTC(2015, 0, 1) && t < Date.UTC(2100, 0, 1) ? t : null; };
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const text = (v: unknown, max: number) => (typeof v === 'string' ? v : '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const emailOf = (v: unknown) => { const s = text(v, 200).toLowerCase(); return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : ''; };
const phoneOf = (v: unknown) => { const s = text(v, 40); return /^\+?[0-9][0-9 ()\-.]{5,30}$/.test(s) ? s : ''; };

/** One page of the reservation events of one metric, each reduced to the reservation number and who booked it. */
export async function readGuestPage(db: D1Database, key: string, q: GuestQuery, now: number, opts: { restaurantId?: string; fetchFn?: typeof fetch } = {}): Promise<GuestPage> {
  const fetchFn = opts.fetchFn ?? fetch;
  const metric = typeof q?.metric === 'string' ? q.metric : '';
  if (!Object.hasOwn(RESERVATION_METRICS, metric)) throw new KlaviyoError(400, 'Métrica de reservación desconocida');
  // The reservations sync has already found each metric's id; until it has, there is nothing to read.
  const known = await db.prepare('SELECT metric_id FROM klaviyo_sync_state WHERE metric = ?').bind(metric).first<{ metric_id: string | null }>();
  const id = known?.metric_id ?? '';
  if (!/^[A-Za-z0-9]{1,40}$/.test(id)) return NOT_READY;

  const params = new URLSearchParams({
    filter: `and(equals(metric_id,"${id}"),greater-or-equal(datetime,${iso(time(q.since) ?? now - HISTORY_MS)}))`, sort: 'datetime',
    'fields[event]': 'datetime,event_properties', include: 'profile', 'fields[profile]': GUEST_PROFILE_FIELDS,
  });
  // Only the page cursor is taken from the caller: the address, the filter and the fields are always the ones above.
  if (q.cursor !== undefined && q.cursor !== null) {
    if (typeof q.cursor !== 'string' || !q.cursor || q.cursor.length > 2000) throw new KlaviyoError(400, 'Cursor inválido');
    params.set('page[cursor]', q.cursor);
  }
  const r = await fetchFn(`${KLAVIYO_BASE}/events/?${params}`, { headers: { authorization: `Klaviyo-API-Key ${key}`, revision: KLAVIYO_REVISION, accept: 'application/vnd.api+json' } });
  const j = (await r.json().catch(() => null)) as Body | null;
  if (!r.ok) throw new KlaviyoError(r.status, `Klaviyo ${r.status}: ${j?.errors?.[0]?.detail ?? j?.errors?.[0]?.title ?? 'la solicitud falló'}`.slice(0, 200));

  const profiles = new Map<string, Json>();
  for (const p of j?.included ?? []) if (p?.type === 'profile' && p.id) profiles.set(String(p.id), p.attributes ?? {});
  const guests: GuestRow[] = [];
  let newest: number | null = null, events = 0;
  for (const e of j?.data ?? []) {
    events++;
    const at = time(e?.attributes?.datetime);
    if (at === null) continue;
    if (newest === null || at > newest) newest = at;
    const props = e.attributes?.event_properties as Json | null | undefined;
    const confirmationId = String(props?.['Confirmation ID'] ?? '').trim();
    if (!props || !/^[A-Za-z0-9-]{1,40}$/.test(confirmationId)) continue;
    if (opts.restaurantId && props['Restaurant ID'] !== undefined && props['Restaurant ID'] !== null && String(props['Restaurant ID']) !== opts.restaurantId) continue;
    const a = profiles.get(String(e.relationships?.profile?.data?.id ?? ''));
    if (!a) continue;
    const g: GuestRow = { confirmationId, eventAt: at, scheduledAt: time(props['Scheduled Time']), firstName: text(a.first_name, 80), lastName: text(a.last_name, 80), email: emailOf(a.email), phone: phoneOf(a.phone_number) };
    if (g.firstName || g.lastName || g.email || g.phone) guests.push(g);
  }
  // Klaviyo's next link is never followed as it comes: only its page cursor is kept.
  const next = typeof j?.links?.next === 'string' && j.links.next.startsWith(`${KLAVIYO_BASE}/`) ? new URL(j.links.next).searchParams.get('page[cursor]') : null;
  return { ready: true, guests, events, newest: newest === null ? null : new Date(newest).toISOString(), cursor: next || null };
}
