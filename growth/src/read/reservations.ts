// Every OpenTable reservation (through Klaviyo), in the owner's words: how many were made and how, what happened to
// the visits (came, cancelled, did not show), and what is booked for the next two weeks. Counts only; no guest data
// is stored. Online reservations seen by GA4 are shown next to the web total, because the difference is what the ad
// reports cannot see.
import { addDays, dateRange, localDate, type LocalDate } from '../domain/time.ts';
import { RESERVATION_EVENT } from '../connectors/ga4.ts';

export interface Count { count: number; guests: number }
export interface ReservationsView {
  connected: boolean; health: string; healthReason: string; historyComplete: boolean; first: LocalDate | null; lastEventAt: number | null;
  today: LocalDate;
  window: { from: LocalDate; to: LocalDate; prevFrom: LocalDate; prevTo: LocalDate };
  /** Reservations made in the window, by the day they were made. */
  made: Count & { previous: Count; byOrigin: ({ origin: string } & Count)[]; webSeenByGa4: number | null; medianLeadDays: number | null };
  /** Reservations whose visit fell in the window, by how they ended. `open` were never closed in OpenTable. */
  visits: { total: number; completed: Count; cancelled: Count; noShow: Count; open: Count; cancelledPct: number | null; noShowPct: number | null };
  /** Completed visits that were closed less than five minutes after being seated: OpenTable cannot attach a check to those. */
  quickClose: { completed: number; quick: number } | null;
  upcoming: Count & { days: ({ date: LocalDate } & Count)[] };
}

const zero = (): Count => ({ count: 0, guests: 0 });
const add = (c: Count, n: unknown, g: unknown) => { c.count += Number(n) || 0; c.guests += Number(g) || 0; };
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);
const ORIGINS = ['web', 'phone', 'walk-in', ''];

export async function loadReservations(db: D1Database, now: number, tz: string): Promise<ReservationsView> {
  const today = localDate(now, tz), to = addDays(today, -1), from = addDays(to, -27), prevTo = addDays(from, -1), prevFrom = addDays(prevTo, -27);
  const upTo = addDays(today, 13);
  const none = <T>() => ({ results: [] as T[] });
  const [conn, sync, span, made, visits, quick, coming, leads, ga4] = await Promise.all([
    db.prepare("SELECT health, health_reason FROM connections WHERE id = 'conn_klaviyo'").first<{ health: string; health_reason: string }>().catch(() => null),
    db.prepare('SELECT COUNT(*) AS n, SUM(CASE WHEN metric_id IS NOT NULL AND done = 1 THEN 1 ELSE 0 END) AS done, SUM(CASE WHEN metric_id IS NOT NULL THEN 1 ELSE 0 END) AS known FROM klaviyo_sync_state').first<{ n: number; done: number | null; known: number | null }>().catch(() => null),
    db.prepare('SELECT MIN(service_date) AS first, MAX(status_at) AS last FROM ot_reservations').first<{ first: string | null; last: number | null }>().catch(() => null),
    db.prepare('SELECT created_date AS d, origin, COUNT(*) AS n, SUM(COALESCE(party_size, 0)) AS g FROM ot_reservations WHERE created_date BETWEEN ? AND ? GROUP BY created_date, origin').bind(prevFrom, to)
      .all<{ d: string; origin: string; n: number; g: number }>().catch(() => none<{ d: string; origin: string; n: number; g: number }>()),
    // How visits ended is about reservations: walk-ins (imported from Guest Center) count as made, never as visits.
    db.prepare("SELECT status, COUNT(*) AS n, SUM(COALESCE(party_size, 0)) AS g FROM ot_reservations WHERE service_date BETWEEN ? AND ? AND origin <> 'walk-in' GROUP BY status").bind(from, to)
      .all<{ status: string; n: number; g: number }>().catch(() => none<{ status: string; n: number; g: number }>()),
    db.prepare("SELECT COUNT(*) AS n, SUM(CASE WHEN done_at - seated_at < 300000 THEN 1 ELSE 0 END) AS quick FROM ot_reservations WHERE status = 'completed' AND origin <> 'walk-in' AND service_date BETWEEN ? AND ? AND seated_at IS NOT NULL AND done_at IS NOT NULL").bind(from, to)
      .first<{ n: number; quick: number | null }>().catch(() => null),
    db.prepare("SELECT service_date AS d, COUNT(*) AS n, SUM(COALESCE(party_size, 0)) AS g FROM ot_reservations WHERE service_date BETWEEN ? AND ? AND status IN ('created', 'confirmed') GROUP BY service_date").bind(today, upTo)
      .all<{ d: string; n: number; g: number }>().catch(() => none<{ d: string; n: number; g: number }>()),
    db.prepare("SELECT scheduled_at - created_at AS lead FROM ot_reservations WHERE created_date BETWEEN ? AND ? AND origin = 'web' AND scheduled_at IS NOT NULL AND created_at IS NOT NULL AND scheduled_at >= created_at ORDER BY lead").bind(from, to)
      .all<{ lead: number }>().catch(() => none<{ lead: number }>()),
    db.prepare('SELECT SUM(events) AS n, COUNT(*) AS filas FROM ga4_reservations_daily WHERE date BETWEEN ? AND ? AND event_name = ?').bind(from, to, RESERVATION_EVENT).first<{ n: number | null; filas: number }>().catch(() => null),
  ]);

  const cur = zero(), prev = zero(), byOrigin = new Map(ORIGINS.map(o => [o, zero()]));
  for (const r of made.results) {
    if (r.d >= from) { add(cur, r.n, r.g); add(byOrigin.get(ORIGINS.includes(r.origin) ? r.origin : '')!, r.n, r.g); }
    else add(prev, r.n, r.g);
  }
  const lead = leads.results, mid = lead.length ? lead[Math.floor((lead.length - 1) / 2)]!.lead : null;

  const by = (s: string) => { const r = visits.results.find(x => x.status === s); return { count: Number(r?.n) || 0, guests: Number(r?.g) || 0 }; };
  const completed = by('completed'), cancelled = by('cancelled'), noShow = by('no_show');
  const open = zero(); for (const s of ['created', 'confirmed']) { const b = by(s); add(open, b.count, b.guests); }
  const total = completed.count + cancelled.count + noShow.count + open.count;

  const comingBy = new Map(coming.results.map(r => [r.d, { count: Number(r.n) || 0, guests: Number(r.g) || 0 }]));
  const days = dateRange(today, upTo).filter(d => comingBy.has(d)).map(d => ({ date: d, ...comingBy.get(d)! }));

  return {
    connected: conn?.health === 'connected', health: conn?.health ?? 'not_configured', healthReason: conn?.health_reason ?? '',
    historyComplete: !!sync && Number(sync.known ?? 0) > 0 && Number(sync.done ?? 0) === Number(sync.known ?? 0), first: span?.first ?? null, lastEventAt: span?.last ?? null,
    today, window: { from, to, prevFrom, prevTo },
    made: { ...cur, previous: prev, byOrigin: ORIGINS.map(o => ({ origin: o, ...byOrigin.get(o)! })).filter(o => o.count > 0), webSeenByGa4: ga4 && ga4.filas > 0 ? Number(ga4.n ?? 0) : null, medianLeadDays: mid === null ? null : Math.round((mid / 86_400_000) * 10) / 10 },
    visits: { total, completed, cancelled, noShow, open, cancelledPct: pct(cancelled.count, total), noShowPct: pct(noShow.count, total) },
    quickClose: quick && quick.n > 0 ? { completed: Number(quick.n), quick: Number(quick.quick ?? 0) } : null,
    upcoming: { count: days.reduce((a, d) => a + d.count, 0), guests: days.reduce((a, d) => a + d.guests, 0), days },
  };
}
