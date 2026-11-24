// OpenTable reservations through Klaviyo: what is kept from an event, how events in any order become one row per
// reservation, how the read resumes, and what the screen reads. Every reservation here is made up.
import { describe, it, expect } from 'vitest';
import { parseReservation, syncKlaviyoReservations, KlaviyoError, KLAVIYO_BASE, KLAVIYO_REVISION } from '../src/connectors/klaviyo-reservations.ts';
import { loadReservations } from '../src/read/reservations.ts';
import { sqliteD1 } from './helpers.ts';

const TZ = 'America/Mexico_City';
const NOW = Date.UTC(2026, 10, 22, 20, 30);            // Sunday 22 Nov 2026, 14:30 in San Miguel
const RID = '1258120';
/** Shaped like a real event: a numeric confirmation, tables as a list, nulls where OpenTable has nothing. */
const props = (over: Record<string, unknown> = {}) => ({
  'Created Date': '2026-11-20T15:10:00Z', 'Confirmation ID': 901, 'Scheduled Time': '2026-11-22T20:00:00Z', 'Seated Time': null, 'Arrived Time': null, 'Done Time': null,
  'Table Number': ['ARC2'], 'Table Category': null, Server: 'Mesero Inventado', 'Currency Code': null, 'Restaurant ID': 1258120, 'Reservation Origin': 'Web', 'Restaurant Name': 'Restaurante de prueba',
  'Guest Request': 'Mesa junto a la ventana, cumpleaños de Persona Inventada', 'Party Size': 2, 'Visit Tags': ['Cumpleaños'], ...over,
});
const at = (iso: string) => Date.parse(iso);

describe('what is kept from a Klaviyo reservation event', () => {
  it('keeps the reservation and drops everything about the guest', () => {
    const r = parseReservation(props({ 'Seated Time': '2026-11-22T19:59:19Z', 'Arrived Time': '2026-11-22T19:02:00Z', 'Done Time': '2026-11-22T21:30:00Z' }), 'completed', at('2026-11-22T21:30:00Z'), RID)!;
    expect(r).toEqual({
      confirmationId: '901', status: 'completed', statusAt: at('2026-11-22T21:30:00Z'), createdAt: at('2026-11-20T15:10:00Z'), scheduledAt: at('2026-11-22T20:00:00Z'), partySize: 2, origin: 'web', tableName: 'ARC2',
      arrivedAt: at('2026-11-22T19:02:00Z'), seatedAt: at('2026-11-22T19:59:19Z'), doneAt: at('2026-11-22T21:30:00Z'), posTotalMinor: null, currency: '',
    });
    const out = JSON.stringify(r);
    for (const secret of ['Mesero', 'Inventado', 'ventana', 'cumpleaños', 'Cumpleaños', 'Persona', 'Restaurante de prueba']) expect(out).not.toContain(secret);
  });

  it('reads several tables, phone and walk-in, and a matched check when there is one', () => {
    const r = parseReservation(props({ 'Table Number': ['M1', 'M2'], 'Reservation Origin': 'Walk-in', 'Party Size': '6', 'POS Data': { 'Check IDs': ['x'], 'POS Total': 1840.5 }, 'Currency Code': 'mxn' }), 'completed', NOW, RID)!;
    expect(r.tableName).toBe('M1+M2'); expect(r.origin).toBe('walk-in'); expect(r.partySize).toBe(6); expect(r.posTotalMinor).toBe(184050); expect(r.currency).toBe('MXN');
    expect(parseReservation(props({ 'Reservation Origin': 'Phone', 'Table Number': 'PIR5' }), 'created', NOW, RID)!.origin).toBe('phone');
    expect(parseReservation(props({ 'Table Number': 'PIR5' }), 'created', NOW, RID)!.tableName).toBe('PIR5');
  });

  it('refuses what is not a reservation of this restaurant, and does not guess odd values', () => {
    expect(parseReservation(props({ 'Restaurant ID': 999 }), 'created', NOW, RID)).toBeNull();
    expect(parseReservation(props({ 'Confirmation ID': null }), 'created', NOW, RID)).toBeNull();
    expect(parseReservation(props({ 'Confirmation ID': 'not an id!' }), 'created', NOW, RID)).toBeNull();
    expect(parseReservation(null, 'created', NOW, RID)).toBeNull();
    const odd = parseReservation(props({ 'Party Size': 0, 'Reservation Origin': 'Concierge desk', 'Table Number': ['<script>'], 'Scheduled Time': 'mañana', 'Currency Code': 'pesos' }), 'created', NOW, RID)!;
    expect(odd.partySize).toBeNull(); expect(odd.origin).toBe(''); expect(odd.tableName).toBe(''); expect(odd.scheduledAt).toBeNull(); expect(odd.currency).toBe('');
  });
});

/** A fake Klaviyo: the metrics list and, per metric, events sorted by time in pages of `size` with a next link. */
function klaviyo(events: Record<string, { datetime: string; p: Record<string, unknown> }[]>, opts: { size?: number; metrics?: { id: string; name: string; integration?: string }[] } = {}) {
  const size = opts.size ?? 2;
  const metrics = opts.metrics ?? [
    { id: 'OTHER1', name: 'Created Reservation', integration: 'Otro sistema' }, { id: 'CRE', name: 'Created Reservation', integration: 'OpenTable' }, { id: 'CON', name: 'Confirmed Reservation', integration: 'OpenTable' },
    { id: 'COM', name: 'Completed Reservation', integration: 'OpenTable' }, { id: 'CAN', name: 'Cancelled Reservation', integration: 'OpenTable' }, { id: 'PLACED', name: 'Placed Order', integration: 'OpenTable' },
  ];
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    calls.push({ url, headers: init.headers as Record<string, string> });
    const u = new URL(url);
    if (u.pathname === '/api/metrics/') return new Response(JSON.stringify({ data: metrics.map(m => ({ type: 'metric', id: m.id, attributes: { name: m.name, integration: { name: m.integration } } })), links: { next: null } }));
    const filter = u.searchParams.get('filter') ?? '';
    const id = /equals\(metric_id,"([^"]+)"\)/.exec(filter)?.[1] ?? '', from = Date.parse(/greater-or-equal\(datetime,([^)]+)\)/.exec(filter)?.[1] ?? '');
    const offset = Number(u.searchParams.get('page[cursor]') ?? 0);
    const all = (events[id] ?? []).filter(e => Date.parse(e.datetime) >= from).sort((a, b) => Date.parse(a.datetime) - Date.parse(b.datetime));
    const page = all.slice(offset, offset + size);
    const next = offset + size < all.length ? `${KLAVIYO_BASE}/events/?${new URLSearchParams({ filter, sort: 'datetime', 'page[cursor]': String(offset + size) })}` : null;
    return new Response(JSON.stringify({ data: page.map((e, i) => ({ type: 'event', id: `${id}${offset + i}`, attributes: { datetime: e.datetime.replace('Z', '+00:00'), event_properties: e.p } })), links: { next } }));
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}

describe('Klaviyo reservations sync', () => {
  const story = {
    CRE: [
      { datetime: '2026-11-18T16:00:00Z', p: props({ 'Confirmation ID': 1, 'Created Date': '2026-11-18T16:00:00Z', 'Scheduled Time': '2026-11-21T19:00:00Z', 'Table Number': null }) },
      { datetime: '2026-11-19T17:00:00Z', p: props({ 'Confirmation ID': 2, 'Created Date': '2026-11-19T17:00:00Z', 'Scheduled Time': '2026-11-21T20:00:00Z', 'Reservation Origin': 'Phone', 'Party Size': 4 }) },
      { datetime: '2026-11-20T15:10:00Z', p: props({ 'Confirmation ID': 3, 'Scheduled Time': '2026-11-28T19:00:00Z' }) },
    ],
    CON: [{ datetime: '2026-11-19T18:00:00Z', p: props({ 'Confirmation ID': 1, 'Created Date': '2026-11-18T16:00:00Z', 'Scheduled Time': '2026-11-21T19:00:00Z', 'Table Number': null }) }],
    COM: [{ datetime: '2026-11-21T21:10:00Z', p: props({ 'Confirmation ID': 1, 'Created Date': '2026-11-18T16:00:00Z', 'Scheduled Time': '2026-11-21T19:00:00Z', 'Table Number': ['M4'], 'Party Size': 3, 'Seated Time': '2026-11-21T19:05:00Z', 'Done Time': '2026-11-21T21:10:00Z' }) }],
    CAN: [{ datetime: '2026-11-20T12:00:00Z', p: props({ 'Confirmation ID': 2, 'Created Date': '2026-11-19T17:00:00Z', 'Scheduled Time': '2026-11-21T20:00:00Z', 'Reservation Origin': 'Phone', 'Party Size': 4 }) }],
  };

  it('finds OpenTable\'s metrics, reads every page, and ends with one row per reservation in its final state', async () => {
    const { db, d1 } = sqliteD1();
    const k = klaviyo(story);
    const r = await syncKlaviyoReservations(d1, 'pk_test_local', NOW, TZ, { restaurantId: RID, fetchFn: k.fetchFn });
    expect(r.reservations).toBe(3); expect(r.events).toBe(6); expect(r.complete).toBe(true); expect(r.missing).toEqual(['No Showed Reservation']);
    expect(db.prepare('SELECT confirmation_id AS id, status, origin, party_size, table_name, service_date, created_date FROM ot_reservations ORDER BY confirmation_id').all()).toEqual([
      { id: '1', status: 'completed', origin: 'web', party_size: 3, table_name: 'M4', service_date: '2026-11-21', created_date: '2026-11-18' },
      { id: '2', status: 'cancelled', origin: 'phone', party_size: 4, table_name: 'ARC2', service_date: '2026-11-21', created_date: '2026-11-19' },
      { id: '3', status: 'created', origin: 'web', party_size: 2, table_name: 'ARC2', service_date: '2026-11-28', created_date: '2026-11-20' },
    ]);
    expect(db.prepare("SELECT seated_at, done_at FROM ot_reservations WHERE confirmation_id = '1'").get()).toEqual({ seated_at: at('2026-11-21T19:05:00Z'), done_at: at('2026-11-21T21:10:00Z') });
    // The key goes in the header, the revision is pinned, the OpenTable metric wins over a namesake, and no guest profile is asked for.
    for (const c of k.calls) { expect(c.headers.authorization).toBe('Klaviyo-API-Key pk_test_local'); expect(c.headers.revision).toBe(KLAVIYO_REVISION); expect(c.url).not.toMatch(/include|profile/); }
    expect(k.calls.some(c => c.url.includes('OTHER1'))).toBe(false);
    expect(k.calls.filter(c => c.url.includes('/events/')).every(c => new URL(c.url).searchParams.get('fields[event]') === 'datetime,event_properties' || c.url.includes('page%5Bcursor%5D'))).toBe(true);
    expect(db.prepare("SELECT metric_id, done, cursor FROM klaviyo_sync_state WHERE metric = 'Created Reservation'").get()).toEqual({ metric_id: 'CRE', done: 1, cursor: '2026-11-20T15:10:00.000Z' });
    expect(db.prepare("SELECT metric_id, done FROM klaviyo_sync_state WHERE metric = 'No Showed Reservation'").get()).toEqual({ metric_id: null, done: 0 });
  });

  it('gives the same rows whatever order the events arrive in', async () => {
    const { db, d1 } = sqliteD1();
    // Only the final events first (as if "created" were still loading), then everything.
    await syncKlaviyoReservations(d1, 'pk', NOW, TZ, { restaurantId: RID, fetchFn: klaviyo({ COM: story.COM, CAN: story.CAN }).fetchFn });
    expect(db.prepare("SELECT status, party_size, table_name FROM ot_reservations WHERE confirmation_id = '1'").get()).toEqual({ status: 'completed', party_size: 3, table_name: 'M4' });
    db.exec('DELETE FROM klaviyo_sync_state');
    await syncKlaviyoReservations(d1, 'pk', NOW + 1, TZ, { restaurantId: RID, fetchFn: klaviyo(story).fetchFn });
    expect(db.prepare('SELECT confirmation_id AS id, status, party_size, table_name FROM ot_reservations ORDER BY confirmation_id').all()).toEqual([
      { id: '1', status: 'completed', party_size: 3, table_name: 'M4' },   // the older "created" event did not undo the visit, its party or its table
      { id: '2', status: 'cancelled', party_size: 4, table_name: 'ARC2' },
      { id: '3', status: 'created', party_size: 2, table_name: 'ARC2' },
    ]);
  });

  it('replaces a reservation imported from Guest Center (gc- id) when the real one arrives: same visit date, made the same minute', async () => {
    const { db, d1 } = sqliteD1();
    const ins = db.prepare("INSERT INTO ot_reservations (confirmation_id, created_at, created_date, scheduled_at, service_date, party_size, origin, status, status_rank, status_at, table_name, currency, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'phone', 'created', 1, 1, '', '', 1)");
    ins.run('gc-aaaaaaaaaaaa', at('2026-11-19T17:00:00Z'), '2026-11-19', at('2026-11-21T20:00:00Z'), '2026-11-21', 4);     // reservation 2, imported earlier
    ins.run('gc-bbbbbbbbbbbb', at('2026-11-19T17:05:00Z'), '2026-11-19', at('2026-11-21T20:00:00Z'), '2026-11-21', 4);     // another booking, five minutes later: stays
    ins.run('gc-cccccccccccc', at('2026-11-19T17:00:00Z'), '2026-11-19', at('2026-11-22T20:00:00Z'), '2026-11-22', 4);     // same minute, another day: stays
    await syncKlaviyoReservations(d1, 'pk', NOW, TZ, { restaurantId: RID, fetchFn: klaviyo(story).fetchFn });
    expect(db.prepare("SELECT confirmation_id AS id FROM ot_reservations WHERE confirmation_id LIKE 'gc-%' ORDER BY id").all()).toEqual([{ id: 'gc-bbbbbbbbbbbb' }, { id: 'gc-cccccccccccc' }]);
    expect(db.prepare("SELECT status FROM ot_reservations WHERE confirmation_id = '2'").get()).toEqual({ status: 'cancelled' });
  });

  it('reads the history a few pages at a time and resumes; once caught up it re-reads the last two days', async () => {
    const { db, d1 } = sqliteD1();
    const many = { CRE: Array.from({ length: 9 }, (_, i) => ({ datetime: `2026-10-${String(i + 1).padStart(2, '0')}T15:00:00Z`, p: props({ 'Confirmation ID': 100 + i, 'Created Date': `2026-10-${String(i + 1).padStart(2, '0')}T15:00:00Z`, 'Scheduled Time': '2026-10-20T19:00:00Z' }) })) };
    const k = klaviyo(many, { metrics: [{ id: 'CRE', name: 'Created Reservation', integration: 'OpenTable' }] });
    let r = await syncKlaviyoReservations(d1, 'pk', NOW, TZ, { fetchFn: k.fetchFn, maxCalls: 3 });   // one call for the metrics, two pages of two
    expect(r.calls).toBe(3); expect(r.reservations).toBe(4); expect(r.complete).toBe(false);
    for (let i = 0; i < 6 && !r.complete; i++) r = await syncKlaviyoReservations(d1, 'pk', NOW + (i + 1) * 60_000, TZ, { fetchFn: k.fetchFn, maxCalls: 3 });
    expect(r.complete).toBe(true); expect(r.reservations).toBe(9);
    expect(k.calls.filter(c => c.url.endsWith('/metrics/'))).toHaveLength(1);   // the metric ids are remembered
    const before = k.calls.length;
    await syncKlaviyoReservations(d1, 'pk', NOW + 3_600_000, TZ, { fetchFn: k.fetchFn, maxCalls: 3 });
    const filter = new URL(k.calls[before]!.url).searchParams.get('filter')!;
    expect(filter).toBe('and(equals(metric_id,"CRE"),greater-or-equal(datetime,2026-10-07T15:00:00Z))');   // the cursor (9 Oct) minus two days
    expect((db.prepare('SELECT COUNT(*) AS n FROM ot_reservations').get() as { n: number }).n).toBe(9);
  });

  it('a refused key is an error that says so, and never follows a link that leaves Klaviyo', async () => {
    const { d1 } = sqliteD1();
    const refused = (async () => new Response(JSON.stringify({ errors: [{ detail: 'Missing or invalid private key.' }] }), { status: 401 })) as unknown as typeof fetch;
    const e = await syncKlaviyoReservations(d1, 'bad', NOW, TZ, { fetchFn: refused }).catch(x => x);
    expect(e).toBeInstanceOf(KlaviyoError); expect((e as KlaviyoError).status).toBe(401); expect((e as Error).message).toMatch(/Klaviyo 401/);
    const urls: string[] = [];
    const elsewhere = (async (url: string) => { urls.push(url); return new Response(JSON.stringify(url.endsWith('/metrics/') ? { data: [{ id: 'CRE', attributes: { name: 'Created Reservation', integration: { name: 'OpenTable' } } }], links: { next: 'https://example.com/steal' } } : { data: [], links: { next: 'https://example.com/steal' } })); }) as unknown as typeof fetch;
    await syncKlaviyoReservations(sqliteD1().d1, 'pk', NOW, TZ, { fetchFn: elsewhere });
    expect(urls.every(u => u.startsWith(`${KLAVIYO_BASE}/`))).toBe(true);
  });
});

describe('what the reservations card reads', () => {
  async function seeded() {
    const { db, d1 } = sqliteD1();
    const made = (id: number, created: string, scheduled: string, over: Record<string, unknown> = {}) => ({ datetime: created, p: props({ 'Confirmation ID': id, 'Created Date': created, 'Scheduled Time': scheduled, ...over }) });
    const ended = (id: number, when: string, created: string, scheduled: string, over: Record<string, unknown> = {}) => ({ datetime: when, p: props({ 'Confirmation ID': id, 'Created Date': created, 'Scheduled Time': scheduled, ...over }) });
    const events = {
      CRE: [
        made(1, '2026-11-10T16:00:00Z', '2026-11-14T19:00:00Z'), made(2, '2026-11-11T16:00:00Z', '2026-11-15T19:00:00Z', { 'Reservation Origin': 'Phone', 'Party Size': 4 }),
        made(3, '2026-11-12T16:00:00Z', '2026-11-13T19:00:00Z'), made(4, '2026-11-12T18:00:00Z', '2026-11-20T19:00:00Z', { 'Party Size': 5 }),
        made(5, '2026-11-21T16:00:00Z', '2026-11-25T19:00:00Z', { 'Party Size': 3 }), made(6, '2026-11-22T15:00:00Z', '2026-11-22T22:00:00Z'),          // made today: an upcoming visit, not in the 28 complete days
        made(7, '2026-10-05T16:00:00Z', '2026-10-06T19:00:00Z'),                                                                                         // the 28 days before
      ],
      COM: [
        ended(1, '2026-11-14T21:00:00Z', '2026-11-10T16:00:00Z', '2026-11-14T19:00:00Z', { 'Seated Time': '2026-11-14T19:02:00Z', 'Done Time': '2026-11-14T21:00:00Z' }),
        ended(3, '2026-11-13T19:01:00Z', '2026-11-12T16:00:00Z', '2026-11-13T19:00:00Z', { 'Seated Time': '2026-11-13T19:00:40Z', 'Done Time': '2026-11-13T19:01:00Z' }),   // seated and closed in 20 seconds
      ],
      CAN: [ended(2, '2026-11-14T12:00:00Z', '2026-11-11T16:00:00Z', '2026-11-15T19:00:00Z', { 'Reservation Origin': 'Phone', 'Party Size': 4 })],
      NOS: [ended(4, '2026-11-20T20:00:00Z', '2026-11-12T18:00:00Z', '2026-11-20T19:00:00Z', { 'Party Size': 5 })],
    };
    const k = klaviyo(events, { size: 50, metrics: [{ id: 'CRE', name: 'Created Reservation', integration: 'OpenTable' }, { id: 'COM', name: 'Completed Reservation', integration: 'OpenTable' }, { id: 'CAN', name: 'Cancelled Reservation', integration: 'OpenTable' }, { id: 'NOS', name: 'No Showed Reservation', integration: 'OpenTable' }, { id: 'CON', name: 'Confirmed Reservation', integration: 'OpenTable' }] });
    await syncKlaviyoReservations(d1, 'pk', NOW, TZ, { restaurantId: RID, fetchFn: k.fetchFn });
    db.exec("UPDATE connections SET health = 'connected' WHERE id = 'conn_klaviyo'");
    db.exec("INSERT INTO ga4_reservations_daily (date, source, medium, campaign, event_name, events, fetched_at) VALUES ('2026-11-12', 'google', 'cpc', 'x', 'ot-reservation-made', 2, 0)");
    return { db, d1 };
  }

  it('counts what was made and how, how the visits ended, and the next two weeks', async () => {
    const { d1 } = await seeded();
    const v = await loadReservations(d1, NOW, TZ);
    expect(v.window).toEqual({ from: '2026-10-25', to: '2026-11-21', prevFrom: '2026-09-27', prevTo: '2026-10-24' });
    expect(v.made.count).toBe(5); expect(v.made.guests).toBe(2 + 4 + 2 + 5 + 3); expect(v.made.previous).toEqual({ count: 1, guests: 2 });
    expect(v.made.byOrigin).toEqual([{ origin: 'web', count: 4, guests: 12 }, { origin: 'phone', count: 1, guests: 4 }]);
    expect(v.made.webSeenByGa4).toBe(2);
    expect(v.made.medianLeadDays).toBe(4.1);   // web reservations made in the window, sorted by notice: 1.1, 4.1, 4.1 and 8 days; the lower middle one
    expect(v.visits).toEqual({ total: 4, completed: { count: 2, guests: 4 }, cancelled: { count: 1, guests: 4 }, noShow: { count: 1, guests: 5 }, open: { count: 0, guests: 0 }, cancelledPct: 25, noShowPct: 25 });
    expect(v.quickClose).toEqual({ completed: 2, quick: 1 });
    expect(v.upcoming).toEqual({ count: 2, guests: 5, days: [{ date: '2026-11-22', count: 1, guests: 2 }, { date: '2026-11-25', count: 1, guests: 3 }] });
    expect(v.connected).toBe(true); expect(v.historyComplete).toBe(true); expect(v.today).toBe('2026-11-22');
  });

  it('is empty, not broken, before the key is in', async () => {
    const v = await loadReservations(sqliteD1().d1, NOW, TZ);
    expect(v.connected).toBe(false); expect(v.health).toBe('not_configured'); expect(v.first).toBeNull();
    expect(v.made.count).toBe(0); expect(v.made.byOrigin).toEqual([]); expect(v.made.webSeenByGa4).toBeNull(); expect(v.visits.total).toBe(0); expect(v.visits.cancelledPct).toBeNull(); expect(v.quickClose).toBeNull(); expect(v.upcoming.days).toEqual([]);
  });
});
