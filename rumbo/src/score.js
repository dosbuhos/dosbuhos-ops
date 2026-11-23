// Rumbo's score, as pure functions (tested in test/score.test.js). One initiative scores 0–100:
//   Ritmo 30      — a check-in in the last 7 days (20; 10 if within 14) + a dated next step that is not overdue (10; 4 if overdue)
//   Avance 30     — the stage (Planeación 8, En marcha 16, Resultado 22) + 8 × share of milestones done
//   Resultado 40  — measures with a target: last 28 days against the target, capped at 100% each, averaged.
//                   No measure with a target: 40 × share of milestones done.
// The overall score is the plain average of the initiatives in Planeación, En marcha or Resultado.

export const ETAPAS = ['idea', 'planeacion', 'marcha', 'resultado', 'pausada', 'cerrada'];
export const CUENTAN = ['planeacion', 'marcha', 'resultado'];      // stages that get a score
export const ACTIVAS = ['planeacion', 'marcha'];                   // stages that count against the cap
const BASE = { idea: 0, planeacion: 8, marcha: 16, resultado: 22, pausada: 0, cerrada: 0 };
export const VENTANA = 28;

export const dias = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5);
export const masDias = (f, n) => new Date(Date.parse(f + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
export function hoyEn(tz = 'America/Mexico_City', d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

// The target for the 28-day window: a weekly target counts four times, a monthly one once.
export const metaVentana = (m) => (m.meta == null ? null : m.modo === 'ultimo' ? m.meta : m.periodo === 'semana' ? m.meta * 4 : m.meta);

// What a measure shows for the window ending today: { valor, meta, pct } (valor null = nothing logged yet).
export function lectura(m, registros, hoy, autos = {}) {
  const meta = metaVentana(m);
  let valor = null;
  if (m.auto) valor = autos[m.auto] ?? null;
  else {
    const desde = masDias(hoy, -(VENTANA - 1));
    const con = registros.filter((r) => r.fecha >= desde && r.fecha <= hoy && r.valores && r.valores[m.id] != null && r.valores[m.id] !== '')
      .sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : a.id - b.id));
    if (con.length) valor = m.modo === 'ultimo' ? Number(con[con.length - 1].valores[m.id]) : con.reduce((s, r) => s + Number(r.valores[m.id] || 0), 0);
  }
  let pct = null;
  if (meta != null && meta > 0 && valor != null) pct = m.sentido === 'baja' ? (valor <= 0 ? 1 : Math.min(1, meta / valor)) : Math.max(0, Math.min(1, valor / meta));
  return { valor, meta, pct };
}

export function calificar(ini, hoy, autos = {}) {
  const registros = ini.registros || [], pasos = ini.pasos || [], medidas = ini.medidas || [];
  if (!CUENTAN.includes(ini.etapa)) return null;
  const notas = [];
  // Ritmo
  const ultimo = registros.reduce((m, r) => (r.fecha > m ? r.fecha : m), '');
  const hace = ultimo ? dias(ultimo, hoy) : null;
  let ritmo = hace == null ? 0 : hace <= 7 ? 20 : hace <= 14 ? 10 : 0;
  if (hace == null) notas.push('Sin registro todavía'); else if (hace > 7) notas.push(`Último registro hace ${hace} días`);
  if (ini.siguiente && ini.siguiente_fecha) { if (ini.siguiente_fecha >= hoy) ritmo += 10; else { ritmo += 4; notas.push('El siguiente paso ya venció'); } }
  else notas.push('Falta el siguiente paso con fecha');
  // Avance
  const hechos = pasos.filter((p) => p.hecho).length, parte = pasos.length ? hechos / pasos.length : 0;
  const avance = BASE[ini.etapa] + Math.round(8 * parte);
  if (!pasos.length) notas.push('Sin hitos: agrega los pasos clave');
  // Resultado
  const conMeta = medidas.map((m) => ({ m, l: lectura(m, registros, hoy, autos) })).filter((x) => x.l.meta != null && x.l.meta > 0);
  let resultado, porHitos = false;
  if (conMeta.length) {
    resultado = Math.round(40 * conMeta.reduce((s, x) => s + (x.l.pct || 0), 0) / conMeta.length);
    if (conMeta.some((x) => x.l.valor == null)) notas.push('Hay números sin registrar en los últimos 28 días');
  } else { porHitos = true; resultado = Math.round(40 * parte); }
  const total = ritmo + avance + resultado;
  return { ritmo, avance, resultado, total, porHitos, hace, notas, hitos: { hechos, total: pasos.length } };
}

export function general(iniciativas, hoy, autos = {}) {
  const s = iniciativas.map((i) => calificar(i, hoy, autos)).filter(Boolean);
  if (!s.length) return { total: null, n: 0 };
  const prom = (k) => Math.round(s.reduce((a, x) => a + x[k], 0) / s.length);
  return { total: prom('total'), ritmo: prom('ritmo'), avance: prom('avance'), resultado: prom('resultado'), n: s.length };
}
