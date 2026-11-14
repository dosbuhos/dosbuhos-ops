// One canonical scheduler: a single UTC cron (every 15 minutes) calls dueJobs(). Each job has a *logical run key*
// (e.g. daily_review:2026-11-14) derived from the job's own local zone. The key is claimed in job_runs with a UNIQUE
// constraint, so duplicate cron firings, retries and catch-up after a missed tick all run a logical job exactly once.
import { localParts, weekStart, type LocalDate } from './time.ts';

export type JobKey = 'watchdog' | 'spend_poll' | 'ads_ingest' | 'booking_sync' | 'ot_availability' | 'ai_visibility' | 'daily_review' | 'weekly_review' | 'notify_daily' | 'notify_weekly';

export interface ScheduleSettings {
  wineryTz: string;                 // America/Mexico_City
  dailyReviewLocal: { hour: number; minute: number };   // 08:00 winery time
  weeklyReviewLocal: { weekday: number; hour: number; minute: number }; // Monday 08:30 winery time
  spendPollMinutes: number;         // 15
  notificationTz: string | null;    // owner's zone; null = notifications off (never inherits the server's zone)
  notifyLocal: { hour: number; minute: number } | null;
}

export const DEFAULT_SCHEDULE: ScheduleSettings = {
  wineryTz: 'America/Mexico_City',
  dailyReviewLocal: { hour: 8, minute: 0 },
  weeklyReviewLocal: { weekday: 1, hour: 8, minute: 30 },
  spendPollMinutes: 15,
  notificationTz: null,
  notifyLocal: null,
};

export interface DueJob { job: JobKey; runKey: string; logicalDate?: LocalDate }

const atOrAfter = (p: { hour: number; minute: number }, t: { hour: number; minute: number }) => p.hour > t.hour || (p.hour === t.hour && p.minute >= t.minute);

/** Every job whose logical run is due at `nowMs`. Callers claim each runKey before doing work. */
export function dueJobs(nowMs: number, s: ScheduleSettings): DueJob[] {
  const out: DueJob[] = [];
  const slot = Math.floor(nowMs / (s.spendPollMinutes * 60_000));
  out.push({ job: 'watchdog', runKey: `watchdog:${slot}` });
  out.push({ job: 'spend_poll', runKey: `spend_poll:${slot}` });
  const hour = Math.floor(nowMs / 3_600_000);
  out.push({ job: 'ads_ingest', runKey: `ads_ingest:${hour}` });
  out.push({ job: 'booking_sync', runKey: `booking_sync:${Math.floor(nowMs / 1_800_000)}` });
  out.push({ job: 'ot_availability', runKey: `ot_availability:${Math.floor(nowMs / 10_800_000)}` }); // every 3 h

  const w = localParts(nowMs, s.wineryTz);
  // Monthly AI visibility check: once per winery-local month, from the 1st at the daily review time.
  if (atOrAfter(w, s.dailyReviewLocal)) out.push({ job: 'ai_visibility', runKey: `ai_visibility:${w.date.slice(0, 7)}`, logicalDate: w.date.slice(0, 7) });
  if (atOrAfter(w, s.dailyReviewLocal)) out.push({ job: 'daily_review', runKey: `daily_review:${w.date}`, logicalDate: w.date });
  const monday = weekStart(w.date);
  const weeklyDue = w.weekday > s.weeklyReviewLocal.weekday || (w.weekday === s.weeklyReviewLocal.weekday && atOrAfter(w, s.weeklyReviewLocal));
  if (weeklyDue) out.push({ job: 'weekly_review', runKey: `weekly_review:${monday}`, logicalDate: monday });

  if (s.notificationTz && s.notifyLocal) {
    const n = localParts(nowMs, s.notificationTz);
    if (atOrAfter(n, s.notifyLocal)) out.push({ job: 'notify_daily', runKey: `notify_daily:${n.date}`, logicalDate: n.date });
    if (n.weekday === 1 && atOrAfter(n, s.notifyLocal)) out.push({ job: 'notify_weekly', runKey: `notify_weekly:${weekStart(n.date)}`, logicalDate: weekStart(n.date) });
  }
  return out;
}

/** Expected: the daily review for `date` should have completed by this many minutes after its local start. */
export const DAILY_REVIEW_GRACE_MINUTES = 120;
