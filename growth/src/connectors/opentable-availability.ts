// OpenTable public availability → automatic capacity signal. Same public queries as canario (canario/src/worker.js):
// what a guest's browser asks on the booking page, no login, no secrets. If OpenTable changes its persisted-query
// hashes the read fails and the connection says so (canario calls this "BLIND"); nothing is ever stored as zero then.
import { addDays, localDate, weekdayOf } from '../domain/time.ts';

const OT = 'https://www.opentable.com.mx';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
// Keep in sync with canario/src/worker.js (HASH) and canario/src/logic.js (EXPERIENCES, OPEN_DOW).
const HASH = {
  RestRefAvailability: 'ed441b6fe912d7d87384f37febecf2789d21cdaf1b7d15b07f461281f2a8d47f',
  ExperienceAvailability: 'ad6cc72822c0b7bc03c4e0b2d41a7805e0a14f78ffde70441e0c620a54fbb7b8',
} as const;
export const EXPERIENCES = [
  { id: 796500, name: 'Visita guiada + degustación' },
  { id: 842882, name: 'Degustación de 4 vinos' },
  { id: 793495, name: 'Menú degustación 5 tiempos' },
  { id: 793530, name: 'Picnic orgánico' },
  { id: 796410, name: 'Petanque y espumoso' },
];
/** Open Wednesday–Sunday (ISO weekday 1 = Monday). */
export const isOpenDay = (date: string) => ![1, 2].includes(weekdayOf(date));

type Fetch = typeof fetch;

async function gql(op: keyof typeof HASH, pageType: string, variables: Record<string, unknown>, fetchFn: Fetch): Promise<any> {
  const r = await fetchFn(`${OT}/dapi/fe/gql?optype=query&opname=${op}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: '*/*', 'user-agent': UA, origin: OT, referer: `${OT}/booking/restref/availability`, 'ot-page-type': pageType, 'ot-page-group': 'booking', 'accept-language': 'es-MX,es;q=0.9' },
    body: JSON.stringify({ operationName: op, variables, extensions: { persistedQuery: { version: 1, sha256Hash: HASH[op] } } }),
  });
  if (!r.ok) throw new Error(`OpenTable answered ${r.status}`);
  const j = (await r.json().catch(() => null)) as { data?: any; errors?: { message?: string }[] } | null;
  if (!j) throw new Error('OpenTable answer was not JSON');
  if (j.errors?.length) throw new Error(j.errors[0]?.message ?? 'OpenTable error');
  return j.data;
}

export async function tableSlots(rid: number, date: string, party: number, fetchFn: Fetch = fetch): Promise<number> {
  const d = await gql('RestRefAvailability', 'restref_availability', {
    privilegedAccess: [], transformOutdoorToDefault: false, forwardDays: 0, requireTypes: ['Standard', 'Experience', 'RemoteWaitlist'],
    enableTicketedExperiences: true, enableExperienceDeposits: false, enablePrivateDiningExperiences: false, restaurantIds: [rid],
    slotDiscovery: ['off'], date, time: '13:00', partySize: party, databaseRegion: 'NA', rid,
    forwardTimeslots: 12, backwardTimeslots: 12, forwardMinutes: 180, backwardMinutes: 180,
  }, fetchFn);
  const day = d?.availability?.[0]?.availabilityDays?.find((x: { dayOffset: number }) => x.dayOffset === 0);
  if (!day) throw new Error('OpenTable answer had no day');
  return (day.slots as { isAvailable: boolean }[]).filter(s => s.isAvailable).length;
}

export async function experienceDays(rid: number, id: number, today: string, fetchFn: Fetch = fetch): Promise<Record<string, number>> {
  const d = await gql('ExperienceAvailability', 'experiences_availability', {
    includeDiningAreas: true, transformOutdoorToDefault: false, privilegedAccess: [], restaurantIds: [rid], partySize: 2,
    dateTime: `${today}T13:00`, experienceId: id, type: 'Experience', returnTimeSlots: true, backwardMinutes: 210, forwardMinutes: 210, forwardDays: 30,
  }, fetchFn);
  const avail = d?.experienceAvailability?.available;
  if (!Array.isArray(avail)) throw new Error('OpenTable answer had no days');
  const out: Record<string, number> = {};
  for (const a of avail) out[addDays(today, a.dayOffset)] = a.restaurantSet?.[0]?.results?.experience?.length || 0;
  return out;
}

/** Read the next `days` days and store them. Unreadable values are stored as NULL with the error, never as 0. */
export async function syncAvailability(db: D1Database, rid: number, now: number, tz: string, days = 14, fetchFn: Fetch = fetch): Promise<{ read: number; failed: number; firstError: string | null }> {
  const today = localDate(now, tz);
  const dates = Array.from({ length: days }, (_, i) => addDays(today, i));
  const rows: { date: string; product: string; item: string; party: number; slots: number | null; error: string | null }[] = [];
  for (const date of dates.filter(isOpenDay)) {
    for (const party of [2, 4]) {
      try { rows.push({ date, product: 'restaurant_visit', item: 'tables', party, slots: await tableSlots(rid, date, party, fetchFn), error: null }); }
      catch (e) { rows.push({ date, product: 'restaurant_visit', item: 'tables', party, slots: null, error: (e as Error).message.slice(0, 200) }); }
    }
  }
  for (const x of EXPERIENCES) {
    try {
      const byDate = await experienceDays(rid, x.id, today, fetchFn);
      for (const date of dates.filter(isOpenDay)) rows.push({ date, product: 'tour_tasting', item: x.name, party: 2, slots: byDate[date] ?? 0, error: null });
    } catch (e) {
      for (const date of dates.filter(isOpenDay)) rows.push({ date, product: 'tour_tasting', item: x.name, party: 2, slots: null, error: (e as Error).message.slice(0, 200) });
    }
  }
  const stmts = [db.prepare('DELETE FROM ot_availability WHERE date < ?').bind(addDays(today, -1))];
  for (const r of rows) stmts.push(db.prepare('INSERT OR REPLACE INTO ot_availability (date, product, item, party_size, slots, error, checked_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(r.date, r.product, r.item, r.party, r.slots, r.error, now));
  const failed = rows.filter(r => r.slots === null).length, firstError = rows.find(r => r.error)?.error ?? null;
  stmts.push(db.prepare('UPDATE connections SET health = ?, health_reason = ?, last_success_at = CASE WHEN ? THEN ? ELSE last_success_at END, freshness_at = ?, last_error = ?, updated_at = ? WHERE id = ?')
    .bind(failed === 0 ? 'connected' : failed < rows.length ? 'limited' : 'reconnect',
      failed === 0 ? 'Bookable times read from OpenTable’s public booking page every 3 hours (next 14 days)' : failed < rows.length ? `${failed} of ${rows.length} reads failed` : 'OpenTable did not answer (its booking page may have changed: update the hashes, as for canario)',
      failed < rows.length ? 1 : 0, now, now, firstError, now, 'conn_ot_availability'));
  await db.batch(stmts);
  return { read: rows.length - failed, failed, firstError };
}
