// Dates and times in San Miguel de Allende. The town is UTC-6 all year (Mexico dropped daylight saving in 2022), so
// local time is UTC minus six hours and a local day is a plain YYYY-MM-DD string. The same offset is written into the
// SQL that groups by hour (created_at / 1000 - 21600).
export const OFFSET_MS = 6 * 3_600_000;
export const OFFSET_S = 21_600;
const DIA = 86_400_000;

export const esFecha = (s) => {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s;   // 2026-02-30 parses as March 2: not a date
};
export const fechaLocal = (ms) => new Date(ms - OFFSET_MS).toISOString().slice(0, 10);
/** HH:MM on the local clock. */
export const horaLocal = (ms) => new Date(ms - OFFSET_MS).toISOString().slice(11, 16);
export const sumarDias = (f, n) => new Date(Date.parse(`${f}T00:00:00Z`) + n * DIA).toISOString().slice(0, 10);
export const diasEntre = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DIA);
/** 0 = Sunday ... 6 = Saturday. */
export const diaSemana = (f) => new Date(`${f}T00:00:00Z`).getUTCDay();
/** The Monday of the week a day falls in (weeks run Monday to Sunday). */
export const lunesDe = (f) => sumarDias(f, -((diaSemana(f) + 6) % 7));
export const primeroDelMes = (f) => `${f.slice(0, 8)}01`;
export const finDeMes = (f) => { const [y, m] = f.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
export const rango = (a, b) => { const out = []; for (let d = a; d <= b; d = sumarDias(d, 1)) out.push(d); return out; };
export const menor = (a, b) => (a < b ? a : b);
