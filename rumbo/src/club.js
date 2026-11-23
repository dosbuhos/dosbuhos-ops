// Wine club figures, read-only, from the wine club's own database (binding CLUB → wineclub-production). SELECT only.
import { masDias, VENTANA } from './score.js';

export async function club(env, hoy) {
  if (!env.CLUB) return null;
  try {
    const desde = masDias(hoy, -(VENTANA - 1));
    const base = 'FROM subscriptions s JOIN members m ON m.id = s.member_id WHERE m.merged_into IS NULL';
    const [a, b, act, meses, ult] = await Promise.all([
      env.CLUB.prepare(`SELECT COUNT(*) n ${base} AND substr(s.start_date,1,10) BETWEEN ? AND ?`).bind(desde, hoy).first(),
      env.CLUB.prepare(`SELECT COUNT(*) n ${base} AND s.status = 'canceled' AND substr(COALESCE(s.ended_on,''),1,10) BETWEEN ? AND ?`).bind(desde, hoy).first(),
      env.CLUB.prepare(`SELECT COUNT(*) n ${base} AND s.status IN ('active','trialing','past_due')`).first(),
      env.CLUB.prepare(`SELECT substr(s.start_date,1,7) mes, COUNT(*) n ${base} AND s.start_date >= ? GROUP BY mes ORDER BY mes`).bind(masDias(hoy, -240).slice(0, 7) + '-01').all(),
      env.CLUB.prepare(`SELECT MAX(substr(s.start_date,1,10)) f ${base}`).first(),
    ]);
    // Every month of the last eight, including the ones with no sign-ups.
    const porMes = [], m0 = new Date(hoy.slice(0, 7) + '-01T00:00:00Z');
    const mapa = new Map(meses.results.map((r) => [r.mes, r.n]));
    for (let i = 7; i >= 0; i--) { const d = new Date(m0); d.setUTCMonth(d.getUTCMonth() - i); const k = d.toISOString().slice(0, 7); porMes.push({ mes: k, n: mapa.get(k) || 0 }); }
    return { altas: a.n, bajas: b.n, neto: a.n - b.n, activos: act.n, porMes, ultima: ult.f || '', desde };
  } catch (e) { console.log('club:', String(e)); return null; }
}
