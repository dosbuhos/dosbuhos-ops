// Guest names and contact details for the Reservaciones app: what leaves Klaviyo through the KlaviyoGuests entrypoint,
// and what never does. Every person and reservation here is made up.
import { describe, it, expect } from 'vitest';
import { readGuestPage, GUEST_PROFILE_FIELDS } from '../src/connectors/klaviyo-guests.ts';
import { KlaviyoError, KLAVIYO_BASE, KLAVIYO_REVISION } from '../src/connectors/klaviyo-reservations.ts';
import { sqliteD1 } from './helpers.ts';

const NOW = Date.UTC(2026, 10, 23, 20, 30);
const RID = '1258120';

interface Fake { datetime: string; profile: string | null; p: Record<string, unknown> }
const props = (over: Record<string, unknown> = {}) => ({
  'Confirmation ID': 901, 'Scheduled Time': '2026-11-28T19:00:00Z', 'Restaurant ID': 1258120, 'Party Size': 2, 'Table Number': ['ARC2'],
  Server: 'Mesero Inventado', 'Guest Request': 'Alergia a las nueces, mesa junto a la ventana', 'Visit Tags': ['Cumpleaños'], ...over,
});
const PEOPLE: Record<string, Record<string, unknown>> = {
  P1: { first_name: 'Ana', last_name: 'Prueba Uno', email: 'Ana.Prueba@Example.com', phone_number: '+52 415 555 0101', organization: 'Empresa Inventada', location: { city: 'Ciudad Inventada' }, properties: { birthday: '1990-01-01' } },
  P2: { first_name: '  Luis\n', last_name: null, email: 'not-an-email', phone_number: 'llámame' },
  P3: { first_name: '', last_name: '', email: null, phone_number: null },
};

/** A fake Klaviyo events endpoint: pages of `size`, the profiles of that page in `included`, a next link with a cursor. */
function klaviyo(events: Fake[], size = 2) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    calls.push({ url, headers: init.headers as Record<string, string> });
    const u = new URL(url);
    const from = Date.parse(/greater-or-equal\(datetime,([^)]+)\)/.exec(u.searchParams.get('filter') ?? '')?.[1] ?? '');
    const offset = Number(u.searchParams.get('page[cursor]') ?? 0);
    const all = events.filter(e => Date.parse(e.datetime) >= from).sort((a, b) => Date.parse(a.datetime) - Date.parse(b.datetime));
    const page = all.slice(offset, offset + size);
    const next = offset + size < all.length ? `${KLAVIYO_BASE}/events/?${new URLSearchParams({ 'page[cursor]': String(offset + size) })}` : null;
    return new Response(JSON.stringify({
      data: page.map((e, i) => ({ type: 'event', id: `E${offset + i}`, attributes: { datetime: e.datetime.replace('Z', '+00:00'), event_properties: e.p }, relationships: { profile: { data: e.profile ? { type: 'profile', id: e.profile } : null } } })),
      included: [...new Set(page.map(e => e.profile).filter((x): x is string => !!x))].map(id => ({ type: 'profile', id, attributes: PEOPLE[id] })),
      links: { next },
    }));
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}

function d1WithMetric(id: string | null = 'CRE') {
  const s = sqliteD1();
  s.db.prepare('INSERT INTO klaviyo_sync_state (metric, metric_id, cursor, done, updated_at) VALUES (?, ?, NULL, 0, ?)').run('Created Reservation', id, NOW);
  return s.d1;
}

describe('guest details through the KlaviyoGuests entrypoint', () => {
  it('passes on the reservation number and who booked, and nothing else from the event or the profile', async () => {
    const k = klaviyo([{ datetime: '2026-11-22T23:00:00Z', profile: 'P1', p: props() }]);
    const page = await readGuestPage(d1WithMetric(), 'pk_test_local', { metric: 'Created Reservation' }, NOW, { restaurantId: RID, fetchFn: k.fetchFn });
    expect(page).toEqual({
      ready: true, events: 1, newest: '2026-11-22T23:00:00.000Z', cursor: null,
      guests: [{ confirmationId: '901', eventAt: Date.parse('2026-11-22T23:00:00Z'), scheduledAt: Date.parse('2026-11-28T19:00:00Z'), firstName: 'Ana', lastName: 'Prueba Uno', email: 'ana.prueba@example.com', phone: '+52 415 555 0101' }],
    });
    const out = JSON.stringify(page);
    for (const left of ['Mesero', 'nueces', 'ventana', 'Cumpleaños', 'Empresa', 'Ciudad', '1990', 'ARC2']) expect(out).not.toContain(left);
  });

  it('asks Klaviyo only for the four profile fields, with the key in the header and the pinned revision', async () => {
    const k = klaviyo([{ datetime: '2026-11-22T23:00:00Z', profile: 'P1', p: props() }]);
    await readGuestPage(d1WithMetric(), 'pk_test_local', { metric: 'Created Reservation', since: '2026-11-20T00:00:00.000Z' }, NOW, { fetchFn: k.fetchFn });
    expect(k.calls).toHaveLength(1);
    const u = new URL(k.calls[0]!.url);
    expect(`${u.origin}${u.pathname}`).toBe(`${KLAVIYO_BASE}/events/`);
    expect(u.searchParams.get('include')).toBe('profile');
    expect(u.searchParams.get('fields[profile]')).toBe(GUEST_PROFILE_FIELDS);
    expect(GUEST_PROFILE_FIELDS).toBe('first_name,last_name,email,phone_number');
    expect(u.searchParams.get('fields[event]')).toBe('datetime,event_properties');
    expect(u.searchParams.get('filter')).toBe('and(equals(metric_id,"CRE"),greater-or-equal(datetime,2026-11-20T00:00:00Z))');
    expect(k.calls[0]!.headers.authorization).toBe('Klaviyo-API-Key pk_test_local');
    expect(k.calls[0]!.headers.revision).toBe(KLAVIYO_REVISION);
  });

  it('pages with a cursor and never follows a link as it comes', async () => {
    const story: Fake[] = [1, 2, 3].map(n => ({ datetime: `2026-11-2${n}T15:00:00Z`, profile: 'P1', p: props({ 'Confirmation ID': 900 + n }) }));
    const k = klaviyo(story);
    const d1 = d1WithMetric();
    const first = await readGuestPage(d1, 'pk', { metric: 'Created Reservation' }, NOW, { fetchFn: k.fetchFn });
    expect(first.guests.map(g => g.confirmationId)).toEqual(['901', '902']); expect(first.cursor).toBe('2'); expect(first.newest).toBe('2026-11-22T15:00:00.000Z');
    const second = await readGuestPage(d1, 'pk', { metric: 'Created Reservation', cursor: first.cursor }, NOW, { fetchFn: k.fetchFn });
    expect(second.guests.map(g => g.confirmationId)).toEqual(['903']); expect(second.cursor).toBeNull();
    // A next link that points away from Klaviyo gives no cursor, and the request address is always the events endpoint.
    const away = (async () => new Response(JSON.stringify({ data: [], links: { next: 'https://example.com/steal?page%5Bcursor%5D=x' } }))) as unknown as typeof fetch;
    expect((await readGuestPage(d1, 'pk', { metric: 'Created Reservation' }, NOW, { fetchFn: away })).cursor).toBeNull();
    expect(k.calls.every(c => c.url.startsWith(`${KLAVIYO_BASE}/events/?`))).toBe(true);
    await expect(readGuestPage(d1, 'pk', { metric: 'Created Reservation', cursor: 'x'.repeat(2001) }, NOW, { fetchFn: k.fetchFn })).rejects.toBeInstanceOf(KlaviyoError);
  });

  it('drops other restaurants, events with no profile or no usable detail, and blanks what is not an email or a phone', async () => {
    const k = klaviyo([
      { datetime: '2026-11-21T15:00:00Z', profile: 'P1', p: props({ 'Confirmation ID': 1, 'Restaurant ID': 999 }) },
      { datetime: '2026-11-21T16:00:00Z', profile: null, p: props({ 'Confirmation ID': 2 }) },
      { datetime: '2026-11-21T17:00:00Z', profile: 'P3', p: props({ 'Confirmation ID': 3 }) },
      { datetime: '2026-11-21T18:00:00Z', profile: 'P2', p: props({ 'Confirmation ID': 4, 'Scheduled Time': 'mañana' }) },
      { datetime: '2026-11-21T19:00:00Z', profile: 'P1', p: props({ 'Confirmation ID': 'not an id!' }) },
    ], 10);
    const page = await readGuestPage(d1WithMetric(), 'pk', { metric: 'Created Reservation' }, NOW, { restaurantId: RID, fetchFn: k.fetchFn });
    expect(page.events).toBe(5); expect(page.newest).toBe('2026-11-21T19:00:00.000Z');
    expect(page.guests).toEqual([{ confirmationId: '4', eventAt: Date.parse('2026-11-21T18:00:00Z'), scheduledAt: null, firstName: 'Luis', lastName: '', email: '', phone: '' }]);
  });

  it('waits for a metric Klaviyo does not have yet, refuses an unknown one, and reports a refused key', async () => {
    const k = klaviyo([]);
    expect(await readGuestPage(d1WithMetric(null), 'pk', { metric: 'Created Reservation' }, NOW, { fetchFn: k.fetchFn })).toEqual({ ready: false, guests: [], events: 0, newest: null, cursor: null });
    expect(await readGuestPage(sqliteD1().d1, 'pk', { metric: 'No Showed Reservation' }, NOW, { fetchFn: k.fetchFn })).toMatchObject({ ready: false });
    expect(k.calls).toHaveLength(0);
    for (const metric of ['Placed Order', '', 'constructor']) await expect(readGuestPage(d1WithMetric(), 'pk', { metric }, NOW, { fetchFn: k.fetchFn })).rejects.toBeInstanceOf(KlaviyoError);
    const refused = (async () => new Response(JSON.stringify({ errors: [{ detail: 'You do not have permission to read profiles.' }] }), { status: 403 })) as unknown as typeof fetch;
    const e = await readGuestPage(d1WithMetric(), 'bad', { metric: 'Created Reservation' }, NOW, { fetchFn: refused }).catch(x => x);
    expect(e).toBeInstanceOf(KlaviyoError); expect((e as KlaviyoError).status).toBe(403); expect((e as Error).message).toMatch(/Klaviyo 403/);
  });
});
