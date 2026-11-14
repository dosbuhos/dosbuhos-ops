// Time zones. Events are stored in UTC milliseconds; reporting happens in named IANA zones.
// Three different zones exist and must never silently default to each other:
//   winery operations (America/Mexico_City), the Google Ads account's own zone, and the owner's notification zone.
// Cloudflare Cron runs in UTC, so every local schedule goes through zonedToUtc / localParts.

export type LocalDate = string; // YYYY-MM-DD
export const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short' });
    fmtCache.set(tz, f);
  }
  return f;
}

export function assertTimeZone(tz: string | null | undefined): string {
  if (!tz) throw new Error('Time zone is not configured');
  try { fmt(tz).format(0); } catch { throw new Error(`Unknown time zone ${tz}`); }
  return tz;
}

export interface LocalParts { date: LocalDate; year: number; month: number; day: number; hour: number; minute: number; second: number; weekday: number /* 1=Mon … 7=Sun */ }
const WD: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

export function localParts(utcMs: number, tz: string): LocalParts {
  const parts = Object.fromEntries(fmt(tz).formatToParts(new Date(utcMs)).map(p => [p.type, p.value]));
  const year = Number(parts.year), month = Number(parts.month), day = Number(parts.day);
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`, year, month, day,
    hour: Number(parts.hour), minute: Number(parts.minute), second: Number(parts.second), weekday: WD[parts.weekday ?? ''] ?? 0,
  };
}

export const localDate = (utcMs: number, tz: string): LocalDate => localParts(utcMs, tz).date;

/** Offset (ms) of `tz` from UTC at instant utcMs. */
function offsetAt(utcMs: number, tz: string): number {
  const p = localParts(utcMs, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - (utcMs - (utcMs % 1000));
}

/** The UTC instant of a local wall-clock time. A time that does not exist (spring-forward gap) resolves to the first
 *  valid instant after it; an ambiguous time (fall-back) resolves to the earlier instant. */
export function zonedToUtc(date: LocalDate, hour: number, minute: number, tz: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const naive = Date.UTC(y, m - 1, d, hour, minute, 0);
  // Try both candidate offsets (before/after a transition) and keep the earliest that round-trips.
  const candidates = [offsetAt(naive - 36e5 * 12, tz), offsetAt(naive, tz), offsetAt(naive + 36e5 * 12, tz)];
  const valid = [...new Set(candidates)].map(off => naive - off).filter(t => {
    const p = localParts(t, tz); return p.date === date && p.hour === hour && p.minute === minute;
  }).sort((a, b) => a - b);
  if (valid.length) return valid[0]!;
  // Gap: step forward minute by minute (gaps are at most a couple of hours).
  for (let add = 1; add <= 180; add++) {
    const hh = hour + Math.floor((minute + add) / 60), mm = (minute + add) % 60;
    for (const off of new Set(candidates)) {
      const c = Date.UTC(y, m - 1, d, hh, mm, 0) - off;
      const p = localParts(c, tz);
      if (p.date === date && p.hour === hh && p.minute === mm) return c;
    }
  }
  throw new Error(`Cannot resolve ${date} ${hour}:${minute} in ${tz}`);
}

export function addDays(date: LocalDate, n: number): LocalDate {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
export function daysBetween(a: LocalDate, b: LocalDate): number {
  const t = (s: LocalDate) => { const [y, m, d] = s.split('-').map(Number) as [number, number, number]; return Date.UTC(y, m - 1, d); };
  return Math.round((t(b) - t(a)) / 864e5);
}
export function dateRange(from: LocalDate, toInclusive: LocalDate): LocalDate[] {
  const out: LocalDate[] = [];
  for (let d = from; d <= toInclusive; d = addDays(d, 1)) out.push(d);
  return out;
}
/** ISO weekday of a calendar date (1=Mon … 7=Sun). */
export function weekdayOf(date: LocalDate): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return wd === 0 ? 7 : wd;
}
/** Monday of the ISO week containing `date`. */
export const weekStart = (date: LocalDate): LocalDate => addDays(date, 1 - weekdayOf(date));
