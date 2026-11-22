// Fixed rules that look for known situations in the search terms people actually typed, and write the pitch for each
// one from the numbers: what to do, why, what to expect and how we will know. A rule only finds; anything it suggests
// goes through the same validation, policy and owner approval as a proposal from the model.
//
// What these rules deliberately do NOT do: block a search just because it has not produced an online reservation.
// "viñedos en san miguel de allende" is the right search even on a month it converts badly; that is a landing-page
// problem, so it comes back as advice, not as a negative keyword.
import type { LocalDate } from '../domain/time.ts';

export const DETECTOR_VERSION = 'reglas-2026-11-22.1';
export interface TermRow { campaign: string; query: string; clicks: number; costMicros: number; sessions: number; opened: number; reservations: number }
export type FindingKind = 'negative_place' | 'negative_competitor' | 'landing_gap';
export interface Finding {
  key: string; kind: FindingKind; campaign: string; query: string;
  title: string; why: string[]; expect: string; measure: string;
  moneyMicros: number;                                    // spend at stake in the window, used to rank
  action: { actionType: 'add_negative_keyword_exact'; text: string } | null;
  note?: string;                                          // why the app cannot act on it, when it cannot
  stats: { clicks: number; costMicros: number; sessions: number; opened: number; reservations: number };
}

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
const BRAND = ['buhos'];
/** Wine regions and cities that are not San Miguel de Allende. Someone searching these wants a winery somewhere else. */
const OTHER_PLACES: [string, string][] = [['queretaro', 'Querétaro'], ['tequisquiapan', 'Tequisquiapan'], ['bernal', 'Bernal'], ['ezequiel montes', 'Ezequiel Montes'], ['valle de guadalupe', 'Valle de Guadalupe'],
  ['ensenada', 'Ensenada'], ['baja california', 'Baja California'], ['parras', 'Parras'], ['aguascalientes', 'Aguascalientes'], ['zacatecas', 'Zacatecas'], ['napa', 'Napa'], ['mendoza', 'Mendoza']];
/** Other wineries by name. */
const COMPETITORS: [string, string][] = [['santisima trinidad', 'La Santísima Trinidad'], ['tres raices', 'Tres Raíces'], ['cuna de tierra', 'Cuna de Tierra'], ['san lucas', 'San Lucas'], ['toyan', 'Toyan'],
  ['puerta del lobo', 'Puerta del Lobo'], ['freixenet', 'Freixenet'], ['la redonda', 'La Redonda'], ['de cote', 'De Cote']];
const NEGATIVE_TEXT = /^[\p{L}\p{N} '&.-]+$/u;            // what the policy accepts as a negative keyword
export const MIN_CLICKS_PLACE = 15, MIN_CLICKS_COMPETITOR = 8, MIN_CLICKS_LANDING = 100, LANDING_OPEN_RATE = 0.05;

const pesos = (micros: number) => `$${Math.round(micros / 1e6).toLocaleString('en-US')}`;
/** Short stable id for a search term, safe inside an evidence reference. */
export function termHash(query: string): string {
  let h = 0x811c9dc5;
  for (const ch of norm(query)) { h ^= ch.codePointAt(0)!; h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}
export const termEvidenceIds = (resourceRef: string, query: string) => { const b = `ev_${resourceRef.replace(/^res_/, '')}_q${termHash(query)}`; return { cost: `${b}_cost_28d`, clicks: `${b}_clicks_28d`, reservations: `${b}_res_28d` }; };

export async function loadTerms(db: D1Database, from: LocalDate, to: LocalDate): Promise<TermRow[]> {
  const r = await db.prepare(`SELECT campaign, query, SUM(COALESCE(ad_clicks, 0)) AS clicks, SUM(COALESCE(ad_cost_micros, 0)) AS cost, SUM(sessions) AS sessions, SUM(opened) AS opened, SUM(reservations) AS reservations
    FROM ga4_ads_queries WHERE date BETWEEN ? AND ? GROUP BY campaign, query HAVING SUM(COALESCE(ad_clicks, 0)) > 0 ORDER BY cost DESC LIMIT 400`).bind(from, to)
    .all<{ campaign: string; query: string; clicks: number; cost: number; sessions: number; opened: number; reservations: number }>().catch(() => ({ results: [] as { campaign: string; query: string; clicks: number; cost: number; sessions: number; opened: number; reservations: number }[] }));
  return r.results.map(x => ({ campaign: x.campaign, query: x.query, clicks: Number(x.clicks) || 0, costMicros: Number(x.cost) || 0, sessions: Number(x.sessions) || 0, opened: Number(x.opened) || 0, reservations: Number(x.reservations) || 0 }));
}

export function detectTerms(terms: TermRow[]): Finding[] {
  const out: Finding[] = [];
  for (const t of terms) {
    const q = norm(t.query);
    if (!q || BRAND.some(b => q.includes(b)) || t.reservations > 0) continue;
    const stats = { clicks: t.clicks, costMicros: t.costMicros, sessions: t.sessions, opened: t.opened, reservations: t.reservations };
    const opened = t.opened === 0 ? 'Nadie abrió la reserva y no hubo reservaciones en línea.' : `${t.opened} abrieron la reserva y ninguna terminó en reservación en línea.`;
    const place = OTHER_PLACES.find(([k]) => q.includes(k)), rival = COMPETITORS.find(([k]) => q.includes(k));
    const usable = NEGATIVE_TEXT.test(t.query) && t.query.length <= 80;
    if ((place && t.clicks >= MIN_CLICKS_PLACE) || (rival && t.clicks >= MIN_CLICKS_COMPETITOR)) {
      out.push({
        key: `neg:${t.campaign}:${q}`, kind: place ? 'negative_place' : 'negative_competitor', campaign: t.campaign, query: t.query, stats, moneyMicros: t.costMicros,
        title: `Dejar de pagar por “${t.query}”`,
        why: [`${t.clicks} clics y ${pesos(t.costMicros)} en 28 días.`, opened, place ? `Es una búsqueda de otra zona (${place[1]}), no de San Miguel de Allende.` : `Busca otro viñedo (${rival![1]}), no el nuestro.`],
        expect: `Ahorro de unos ${pesos(t.costMicros)} cada 28 días. Riesgo bajo: se bloquea solo esa búsqueda exacta y las demás siguen igual.`,
        measure: 'En 14 días: gasto en esa búsqueda en cero y las reservaciones de la campaña sin bajar.',
        action: usable ? { actionType: 'add_negative_keyword_exact', text: t.query } : null,
        ...(usable ? {} : { note: 'La búsqueda tiene caracteres que la app no puede mandar como palabra negativa; se agrega a mano en Google Ads.' }),
      });
    } else if (!place && !rival && t.clicks >= MIN_CLICKS_LANDING && t.sessions >= 50 && t.opened / t.sessions < LANDING_OPEN_RATE) {
      out.push({
        key: `landing:${t.campaign}:${q}`, kind: 'landing_gap', campaign: t.campaign, query: t.query, stats, moneyMicros: t.costMicros,
        title: `“${t.query}” trae visitas que no llegan a reservar`,
        why: [`${t.clicks} clics y ${pesos(t.costMicros)} en 28 días.`, `Solo ${t.opened} de ${t.sessions} visitas abrieron la reserva.`, 'Es la búsqueda correcta para nosotros: no conviene bloquearla.'],
        expect: 'Lo que falla es la página a la que llegan. Si 1 de cada 10 abriera la reserva, esta búsqueda sería de las que más reservan.',
        measure: 'Meta: que al menos 10% de estas visitas abra la reserva. Se ve aquí mismo, por búsqueda.',
        action: null, note: 'Se arregla en la página de destino del anuncio, no con un cambio en la campaña.',
      });
    }
  }
  return out.sort((a, b) => b.moneyMicros - a.moneyMicros);
}

/** The proposal the coordinator validates, written from a finding. Field limits are the ones in ModelProposal. */
export function proposalFor(f: Finding, snapshotId: string, resourceRef: string) {
  if (!f.action) return null;
  const ev = termEvidenceIds(resourceRef, f.query), costMinor = Math.round(f.stats.costMicros / 10_000);
  return {
    schemaVersion: '1' as const, snapshotId, hypothesis: f.why.join(' ').slice(0, 600), actionType: f.action.actionType, resourceRef, parameters: { text: f.action.text },
    evidenceRefs: [ev.cost, ev.clicks, ev.reservations],
    expectedEffect: { metric: 'gasto en esa búsqueda (28 días)', direction: 'decrease' as const, range: [Math.round(costMinor * 0.8), costMinor] as [number, number] },
    risks: ['Si esa búsqueda trae gente que reserva por teléfono o llega sin reservar, dejaríamos de verla. Las reservaciones en línea no lo muestran.'],
    alternative: 'Dejarla correr y revisar otra vez en 28 días.', evaluationPlan: f.measure,
    rollbackPlan: 'Quitar la palabra negativa en Google Ads; la app no la quita sola',
  };
}
