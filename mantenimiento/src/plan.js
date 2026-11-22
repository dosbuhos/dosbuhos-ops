// Dates for Mantenimiento: "today" in San Miguel, and when a preventive plan comes up next. No I/O, so it is unit-tested
// (test/plan.test.mjs). Dates are YYYY-MM-DD strings throughout.

export const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

// San Miguel de Allende: UTC-6 all year (no daylight saving since 2022)
export const MX_OFFSET_H = 6;
export const mxToday = () => new Date(Date.now() - MX_OFFSET_H * 3600000).toISOString().slice(0, 10);
export const pad2 = (n) => String(n).padStart(2, '0');
export function addDaysYmd(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
export function addMonthsYmd(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  const last = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + n, Math.min(d, last))).toISOString().slice(0, 10);
}
export function fmtDate(d) {
  const [y, m, day] = d.split('-').map(Number);
  return `${day} ${MES[m - 1]}${y === Number(mxToday().slice(0, 4)) ? '' : ' ' + y}`;
}

// ---------- preventive plan dates ----------
// unit: 'day' | 'week' | 'month' (every N…), 'months' (the calendar months in `months`, on day `day`), 'once'.
export function parseMonths(s) {
  return [...new Set(String(s || '').split(',').map((n) => parseInt(n, 10)).filter((n) => n >= 1 && n <= 12))].sort((a, b) => a - b);
}
function monthDate(y, m, day) {
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${y}-${pad2(m)}-${pad2(Math.min(Math.max(1, day || 1), last))}`;
}
// First date on or after `from` that falls in one of `months` on day `day`.
export function monthsOnOrAfter(months, day, from) {
  if (!months.length) return null;
  const y = Number(from.slice(0, 4));
  for (let yy = y; yy <= y + 2; yy++) {
    for (const m of months) {
      const d = monthDate(yy, m, day);
      if (d >= from) return d;
    }
  }
  return null;
}
// The plan's next date after `ymd` (null for one-time plans).
export function advancePlan(s, ymd) {
  if (s.unit === 'once') return null;
  if (s.unit === 'months') return monthsOnOrAfter(parseMonths(s.months), s.day || 1, addDaysYmd(ymd, 1));
  const n = Math.max(1, s.every_n || 1);
  if (s.unit === 'day') return addDaysYmd(ymd, n);
  if (s.unit === 'week') return addDaysYmd(ymd, 7 * n);
  return addMonthsYmd(ymd, n);
}
// About how many times a year a plan comes up (the year view folds what happens every month or more often).
export function perYear(s) {
  if (s.unit === 'once') return 1;
  if (s.unit === 'months') return parseMonths(s.months).length;
  const n = Math.max(1, s.every_n || 1);
  return Math.round((s.unit === 'day' ? 365 : s.unit === 'week' ? 52 : 12) / n);
}
const UNIT_LABEL = { day: ['día', 'días'], week: ['semana', 'semanas'], month: ['mes', 'meses'] };
export function everyText(s) {
  if (s.unit === 'once') return 'una sola vez';
  if (s.unit === 'months') {
    const ms = parseMonths(s.months);
    if (ms.length === 12) return 'cada mes';
    return `${ms.length} ${ms.length === 1 ? 'vez' : 'veces'} al año (${ms.map((m) => MES[m - 1]).join(', ')})`;
  }
  const n = Math.max(1, s.every_n || 1);
  return `cada ${n > 1 ? n + ' ' : ''}${UNIT_LABEL[s.unit][n > 1 ? 1 : 0]}`;
}


// Last 10 digits: the same person whether they type 415 123 4567, +52 415 123 4567 or 5214151234567.
export const phoneKey = (v) => { const d = String(v || '').replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : null; };

// The same number typed again without its country code ("512 555 0100" over "+1 512 555 0100"):
// keep the stored one, so WhatsApp links to a number from outside Mexico keep working.
export function mergePhone(stored, typed) {
  const a = String(stored || '').replace(/\D/g, '');
  const b = String(typed || '').replace(/\D/g, '');
  return b.length === 10 && a.length > 10 && a.endsWith(b) ? stored : typed;
}
