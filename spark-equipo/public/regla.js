// The 48-hour rule as plain functions with no page state, so the tests can run them.

// Working days from one date to another: Saturdays and Sundays do not count, so a Friday contact logged on Monday is one
// day old, not three. The 48 hours of the rule are two working days.
export const dHab = (a, b) => { let n = 0; for (let t = new Date(a + 'T12:00:00'), f = new Date(b + 'T12:00:00'); t < f;) { t.setDate(t.getDate() + 1); if (t.getDay() % 6) n++; } return n; };

// contactos: newest first, each { persona, fecha, registrado }. hoy: today. desde: the day the rule started.
//   n, tarde  this month's contacts since the rule started that carry a logged-on date, and how many of those were logged
//             more than two working days after they happened. A contact with no logged-on date is neither.
//   sin       working days since the day of the last logged contact. It goes by the day the contact happened, never by the
//             day it was typed in: catching up on old contacts, or a sync that dates old rows, must not make the log look current.
//   cumple    the log is current (two working days at most) and nothing this month was logged late.
export function regla48de(contactos, p, hoy, desde) {
  const mes = hoy.slice(0, 7), L = contactos.filter((c) => c.persona === p && c.fecha >= desde && c.fecha.slice(0, 7) === mes && c.registrado);
  const tarde = L.filter((c) => dHab(c.fecha, c.registrado.slice(0, 10)) > 2).length;
  const ult = contactos.find((c) => c.persona === p && c.fecha <= hoy), sin = ult ? dHab(ult.fecha, hoy) : null;
  return { n: L.length, tarde, sin, cumple: sin != null && sin <= 2 && tarde === 0 };
}

// The day the 48-hour rule started, and the first month whose commission it adjusts (earlier closes are dry runs).
export const REGLA_DESDE = '2026-11-21', AJUSTE_DESDE = '2026-12';
// Percent taken off the month's commission: 90% or more on time pays in full, 70 to 89% pays 15% less, under 70% (or a
// month with nothing logged) pays 30% less.
export const ajusteDe = (pc) => (pc == null ? 30 : pc >= 90 ? 0 : pc >= 70 ? 15 : 30);
// One person's month for the close: contacts judged, how many were logged late, the percent on time, the adjustment,
// and the late ones themselves (the reason, shown to the person).
export function cierreDe(contactos, p, mes, desde = REGLA_DESDE) {
  const L = contactos.filter((c) => c.persona === p && c.fecha >= desde && c.fecha.slice(0, 7) === mes && c.registrado);
  const tardios = L.map((c) => ({ fecha: c.fecha, cuenta: c.cuenta || '', registrado: c.registrado.slice(0, 10), dias: dHab(c.fecha, c.registrado.slice(0, 10)) })).filter((c) => c.dias > 2)
    .sort((a, b) => (a.fecha < b.fecha ? -1 : 1));
  const pc = L.length ? Math.round((L.length - tardios.length) / L.length * 100) : null;
  return { n: L.length, tarde: tardios.length, pc, ajuste: ajusteDe(pc), tardios };
}
