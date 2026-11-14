// Pure rules: which days to check and how to judge what OpenTable answered. No network here.

export const TZ = 'America/Mexico_City';
export const OPEN_DOW = new Set([0, 3, 4, 5, 6]); // Sunday, Wednesday–Saturday
export const MIN_TABLE_SLOTS = 8; // a normal open day shows ~20 slots between 10:00 and 16:00 for 2 people

export const EXPERIENCES = [
  { id: 796500, name: 'Visita guiada + degustación' },
  { id: 842882, name: 'Degustación de 4 vinos' },
  { id: 793495, name: 'Menú degustación 5 tiempos' },
  { id: 793530, name: 'Picnic orgánico' },
  { id: 796410, name: 'Petanque y espumoso' },
];

export function localDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(now); // YYYY-MM-DD
}
export function addDays(ymd, n) {
  const d = new Date(ymd + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const dow = (ymd) => new Date(ymd + 'T12:00:00Z').getUTCDay();

// The next `count` open days, starting tomorrow (today can be legitimately sold out or past cutoff).
export function nextOpenDays(today, count = 5, skip = []) {
  const out = [];
  for (let i = 1; out.length < count && i < 30; i++) {
    const d = addDays(today, i);
    if (OPEN_DOW.has(dow(d)) && !skip.includes(d)) out.push(d);
  }
  return out;
}

// checks: { tables: [{date, party, slots|null, error?}], experiences: [{id, name, days: {date: slots}|null, error?}], site: [{url, ok, problem?}] }
export function judge(checks) {
  const fails = [], warns = [], blind = [];
  for (const t of checks.tables) {
    if (t.slots == null) blind.push(`Mesas ${t.date} (${t.party}p): ${t.error}`);
    else if (t.slots === 0) fails.push(`Sin mesas disponibles el ${t.date} para ${t.party} personas`);
    else if (t.party === 2 && t.slots < MIN_TABLE_SLOTS) warns.push(`Pocas mesas el ${t.date}: ${t.slots} horarios (normal: 15+)`);
  }
  for (const e of checks.experiences) {
    if (e.days == null) { blind.push(`${e.name}: ${e.error}`); continue; }
    const counts = Object.values(e.days);
    if (counts.length && counts.every(n => n === 0)) fails.push(`${e.name}: sin horarios en los próximos ${counts.length} días abiertos`);
  }
  for (const s of checks.site) if (!s.ok) fails.push(`Sitio web ${s.url}: ${s.problem}`);
  const status = fails.length ? 'FAIL' : warns.length ? 'WARN' : blind.length ? 'BLIND' : 'OK';
  return { status, fails, warns, blind };
}
