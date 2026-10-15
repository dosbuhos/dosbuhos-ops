// Shipment-schedule engine. Pure functions, no I/O.
//
// The schedule is DERIVED, never stored: for every subscription we compute the expected
// shipments from its anchor date and its club's cadence, then lay any fulfillment records
// (what staff actually did) on top. A shipment with no fulfillment record still exists —
// that is what makes a missed shipment show up as OVERDUE instead of disappearing.
//
// All dates are 'YYYY-MM-DD' strings in the winery's local time zone. They compare correctly
// as plain strings, so no Date objects leak into the logic.

export const DONE = new Set(['handed', 'shipped', 'delivered']);
export const STATUSES = ['needs_prep', 'ready', 'handed', 'shipped', 'delivered', 'exception', 'skipped'];

const pad = (n) => String(n).padStart(2, '0');
export const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
export function parse(s) { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return { y, m, d }; }
export const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
export const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

// Calendar-month arithmetic, always measured from the original date so that
// Jan 31 → Feb 28 → Mar 31 (not Mar 28).
export function addMonths(date, n) {
  const { y, m, d } = parse(date);
  const t = y * 12 + (m - 1) + n;
  const ny = Math.floor(t / 12), nm = (t % 12) + 1;
  return ymd(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}
export function addDays(date, n) {
  const { y, m, d } = parse(date);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
export function daysBetween(a, b) { // b - a, in days
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
}
export function weekdayMon0(date) { // Monday = 0 … Sunday = 6
  const { y, m, d } = parse(date);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

// Convert an instant (unix seconds or Date) to the local calendar date in `tz`.
export function localDate(when, tz) {
  const dt = typeof when === 'number' ? new Date(when * 1000) : when;
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(dt);
}

export const dueDate = (anchor, cadenceMonths, k) => addMonths(anchor, (k - 1) * cadenceMonths);

// Which occurrence (k) does a date belong to? Nearest scheduled date wins.
export function nearestK(anchor, cadenceMonths, date) {
  const a = parse(anchor), b = parse(date);
  const months = (b.y - a.y) * 12 + (b.m - a.m) + (b.d - a.d) / 30;
  return Math.max(1, Math.round(months / cadenceMonths) + 1);
}

// Which case (slot) of the club's schedule goes in shipment number n?
export function slotFor(club, n, due) {
  if (club.allocation_mode === 'month') return parse(due).m;
  const cycle = Math.max(1, Math.round(12 / club.cadence_months));
  return ((n - 1) % cycle) + 1;
}

export const caseSlots = (club) => club.allocation_mode === 'month' ? 12 : Math.max(1, Math.round(12 / club.cadence_months));

function bottlesOf(json) {
  if (!json) return null;
  try { const b = JSON.parse(json); return Array.isArray(b) ? b : null; } catch { return null; }
}
export const totalBottles = (list) => (list || []).reduce((s, b) => s + (Number(b.qty) || 0), 0);

// Stripe states in which no shipment is owed at all (first payment never went through).
const NEVER_STARTED = new Set(['incomplete', 'incomplete_expired']);

/**
 * Expected shipments for one subscription.
 *
 * sub:   { id, start_date, anchor_override, seq_offset, ended_on, cancel_at, status }
 * club:  { bottles, cadence_months, allocation_mode } — required
 * opts:  { to, today, trackingStart, fulfillments: Map<k,row>, pauses: [{from_date, until_date}],
 *          caseFor: (club, slot) => bottles[] | null }
 */
export function occurrences(sub, club, opts) {
  const { to, today, trackingStart = '0000-01-01', fulfillments = new Map(), pauses = [], caseFor = () => null } = opts;
  const anchor = sub.anchor_override || sub.start_date;
  const cadence = club.cadence_months;
  const ends = [sub.ended_on, sub.cancel_at].filter(Boolean).sort();
  const endBound = NEVER_STARTED.has(sub.status) ? anchor : ends[0] || null; // first date NOT owed
  const ks = new Set();
  for (let k = 1; k < 1000; k++) {
    const due = dueDate(anchor, cadence, k);
    if (due > to) break;
    if (endBound && due >= endBound) break;
    ks.add(k);
  }
  for (const k of fulfillments.keys()) if (k >= 1) ks.add(k); // anything staff touched stays visible
  const out = [];
  for (const k of [...ks].sort((a, b) => a - b)) {
    const due = dueDate(anchor, cadence, k);
    const f = fulfillments.get(k) || null;
    const n = k + (sub.seq_offset || 0);
    const slot = slotFor(club, n, due);
    const eff = f?.delayed_until && f.delayed_until > due ? f.delayed_until : due;
    const paused = pauses.some(p => due >= p.from_date && (!p.until_date || due < p.until_date));
    const status = f?.status || null;
    let state;
    if (status && DONE.has(status)) state = 'done';
    else if (status === 'skipped') state = 'skipped';
    else if (paused) state = 'paused';
    else if (due < trackingStart) state = 'pretracking';
    else if (status === 'exception') state = 'exception';
    else if (eff < today) state = 'overdue';
    else if (eff === today) state = 'today';
    else state = 'upcoming';

    let bottles = bottlesOf(f?.bottles_json), source = null;
    if (bottles) source = f.bottles_custom ? 'custom' : 'snapshot';
    else if ((bottles = caseFor(club, slot))) source = 'case';
    const open = !['done', 'skipped', 'paused', 'pretracking'].includes(state);
    out.push({
      subId: sub.id, k, n, slot, due, eff, state, status, f,
      delayed: !!(f?.delayed_until && f.delayed_until > due),
      bottles: bottles || null, bottlesSource: source,
      bottlesTotal: bottles ? totalBottles(bottles) : 0,
      expectedBottles: club.bottles,
      missingAllocation: open && !bottles,
      afterEnd: !!(endBound && due >= endBound),
    });
  }
  return out;
}

// Membership year containing `date`, anniversary-based from the anchor.
export function membershipYear(anchor, date) {
  let start = anchor, i = 0;
  while (addMonths(anchor, 12 * (i + 1)) <= date) i++;
  start = addMonths(anchor, 12 * i);
  return { start, end: addDays(addMonths(anchor, 12 * (i + 1)), -1) };
}

// Parse "2 Tempranillo GR" / "2 x Pet Nat" / "Pet Nat" lines into [{wine, qty}].
export function parseBottles(text) {
  const out = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    // A leading 1–2 digit number is a quantity; "1524 Mosaico Tinto" is a wine name.
    const m = line.match(/^(\d{1,2})\s*(?:x|×|\*)?\s+(.+)$/i) || line.match(/^(\d{1,2})\s*(?:x|×|\*)\s*(.+)$/i);
    const qty = m ? Number(m[1]) : 1;
    const wine = (m ? m[2] : line).trim().slice(0, 120);
    if (!wine || qty <= 0) continue;
    const prev = out.find(b => b.wine.toLowerCase() === wine.toLowerCase());
    if (prev) prev.qty += qty; else out.push({ wine, qty: Math.min(qty, 99) });
  }
  return out;
}
export const bottlesToText = (list) => (list || []).map(b => `${b.qty} ${b.wine}`).join('\n');
