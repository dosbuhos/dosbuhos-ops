// GA4 (Google Analytics Data API) → online reservations. OpenTable's GA4 integration (already connected in GuestCenter)
// sends `ot-reservation-made` for each reservation made through the OpenTable widget. We read daily counts by the
// session's source / medium / campaign, read-only, with a service account that is a Viewer on the GA4 property.
//
// Setup: GA4_SA_KEY secret = the service account's JSON key (pasted by Eric); the GA4 property ID is stored in D1
// (connections.account_ref for conn_ga4), set from Connections. Scope: analytics.readonly.

export const RESERVATION_EVENT = 'ot-reservation-made';
/** Booking funnel, in order: the website's own booking-button click, then OpenTable widget steps, then the booking. */
export const FUNNEL = [
  { event: 'reserva_click', label: 'Clicked “Reservar” on dosbuhos.com' },
  { event: 'ot-availability-pageview', label: 'Opened OpenTable availability' },
  { event: 'ot-time-slot-selected', label: 'Picked a time' },
  { event: 'ot-booking-details-pageview', label: 'Reached booking details' },
  { event: RESERVATION_EVENT, label: 'Booked' },
] as const;
const SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

const enc = new TextEncoder();
const b64url = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b instanceof Uint8Array ? b : new Uint8Array(b)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export interface ServiceAccount { client_email: string; private_key: string; token_uri?: string }

export function parseServiceAccount(json: string | undefined): ServiceAccount | null {
  if (!json) return null;
  try {
    const o = JSON.parse(json) as Partial<ServiceAccount>;
    return o.client_email && o.private_key ? { client_email: o.client_email, private_key: o.private_key, token_uri: o.token_uri } : null;
  } catch { return null; }
}

function pemToPkcs8(pem: string): ArrayBuffer {
  const b = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\s+/g, '');
  return Uint8Array.from(atob(b), c => c.charCodeAt(0)).buffer;
}

export async function signJwt(sa: ServiceAccount, now: number): Promise<string> {
  const iat = Math.floor(now / 1000);
  const head = b64url(enc.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const body = b64url(enc.encode(JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud: sa.token_uri ?? TOKEN_URL, iat, exp: iat + 3600 })));
  const key = await crypto.subtle.importKey('pkcs8', pemToPkcs8(sa.private_key), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(`${head}.${body}`));
  return `${head}.${body}.${b64url(sig)}`;
}

export class Ga4Error extends Error { constructor(public readonly kind: 'auth' | 'permission' | 'not_found' | 'transient' | 'bad_request', message: string) { super(message); } }

let cached: { email: string; token: string; exp: number } | null = null;

export async function accessToken(sa: ServiceAccount, now: number, fetchFn: typeof fetch = fetch): Promise<string> {
  if (cached && cached.email === sa.client_email && cached.exp - 60_000 > now) return cached.token;
  const res = await fetchFn(sa.token_uri ?? TOKEN_URL, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: await signJwt(sa, now) }),
  });
  const j = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (!res.ok || !j.access_token) throw new Ga4Error(res.status >= 500 ? 'transient' : 'auth', `Google sign-in failed: ${j.error ?? res.status} ${j.error_description ?? ''}`.trim());
  cached = { email: sa.client_email, token: j.access_token, exp: now + (j.expires_in ?? 3600) * 1000 };
  return j.access_token;
}

export interface Ga4Row { date: string; eventName: string; source: string; medium: string; campaign: string; events: number; valueMicros: number | null }

/** Daily OpenTable widget events (ot-*) and the site's reserva_click, by session source / medium / campaign.
 *  Paginates; dates come back as YYYYMMDD. */
export async function fetchReservations(sa: ServiceAccount, propertyId: string, from: string, to: string, now: number, fetchFn: typeof fetch = fetch): Promise<Ga4Row[]> {
  if (!/^\d{4,15}$/.test(propertyId)) throw new Ga4Error('bad_request', 'GA4 property ID must be digits');
  const token = await accessToken(sa, now, fetchFn);
  const out: Ga4Row[] = [];
  for (let offset = 0; offset < 200_000; offset += 10_000) {
    const res = await fetchFn(`https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`, {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        dateRanges: [{ startDate: from, endDate: to }],
        dimensions: [{ name: 'date' }, { name: 'eventName' }, { name: 'sessionSource' }, { name: 'sessionMedium' }, { name: 'sessionCampaignName' }],
        metrics: [{ name: 'eventCount' }, { name: 'eventValue' }],
        dimensionFilter: { orGroup: { expressions: [
          { filter: { fieldName: 'eventName', stringFilter: { matchType: 'BEGINS_WITH', value: 'ot-' } } },
          { filter: { fieldName: 'eventName', stringFilter: { matchType: 'EXACT', value: 'reserva_click' } } },
        ] } },
        limit: 10_000, offset, keepEmptyRows: false,
      }),
    });
    const j = (await res.json().catch(() => ({}))) as { rows?: { dimensionValues: { value: string }[]; metricValues: { value: string }[] }[]; rowCount?: number; error?: { status?: string; message?: string } };
    if (!res.ok) {
      const kind = res.status === 403 ? 'permission' : res.status === 404 ? 'not_found' : res.status === 401 ? 'auth' : res.status >= 500 || res.status === 429 ? 'transient' : 'bad_request';
      throw new Ga4Error(kind, `GA4 ${res.status}: ${j.error?.message ?? 'request failed'}`.slice(0, 300));
    }
    for (const r of j.rows ?? []) {
      const [d, name, src, med, camp] = r.dimensionValues.map(v => v.value);
      const ev = Math.round(Number(r.metricValues[0]?.value ?? 0));
      const val = Number(r.metricValues[1]?.value ?? 0);
      if (!d || !/^\d{8}$/.test(d) || ev <= 0) continue;
      out.push({ date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`, eventName: (name ?? '').slice(0, 60), source: (src ?? '(not set)').slice(0, 120), medium: (med ?? '(not set)').slice(0, 60), campaign: (camp ?? '(not set)').slice(0, 200), events: ev, valueMicros: Number.isFinite(val) && val > 0 ? Math.round(val * 1e6) : null });
    }
    if (!j.rowCount || offset + 10_000 >= j.rowCount) break;
  }
  return out;
}

/** Sync into D1. Re-reads a recent window each time (GA4 revises recent days); replaces those days atomically. */
export async function syncGa4(db: D1Database, sa: ServiceAccount, propertyId: string, now: number, from: string, to: string, fetchFn: typeof fetch = fetch): Promise<{ rows: number; reservations: number }> {
  try {
    const rows = await fetchReservations(sa, propertyId, from, to, now, fetchFn);
    const stmts: D1PreparedStatement[] = [db.prepare('DELETE FROM ga4_reservations_daily WHERE date BETWEEN ? AND ?').bind(from, to)];
    for (const r of rows) stmts.push(db.prepare('INSERT OR REPLACE INTO ga4_reservations_daily (date, source, medium, campaign, event_name, events, value_micros, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(r.date, r.source, r.medium, r.campaign, r.eventName, r.events, r.valueMicros, now));
    stmts.push(db.prepare("UPDATE connections SET health = 'connected', health_reason = ?, last_success_at = ?, freshness_at = ?, last_error = NULL, updated_at = ? WHERE id = 'conn_ga4'")
      .bind(`Reading "${RESERVATION_EVENT}" (OpenTable widget reservations) from GA4 property ${propertyId}`, now, now, now));
    await db.batch(stmts); // one batch = one transaction: the window is never half-replaced
    return { rows: rows.length, reservations: rows.filter(r => r.eventName === RESERVATION_EVENT).reduce((a, r) => a + r.events, 0) };
  } catch (e) {
    const g = e instanceof Ga4Error ? e : new Ga4Error('transient', (e as Error).message);
    const health = g.kind === 'transient' ? 'limited' : 'reconnect';
    await db.prepare('UPDATE connections SET health = ?, last_error = ?, updated_at = ? WHERE id = ?').bind(health, g.message.slice(0, 300), now, 'conn_ga4').run();
    throw g;
  }
}

/** Is this GA4 traffic from Google Ads? (auto-tagged sessions report google / cpc). */
export const isGoogleAds = (source: string, medium: string) => /^google/i.test(source) && /^(cpc|paid|ppc)$/i.test(medium);
