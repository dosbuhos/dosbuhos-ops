// Fixed rules that look for known situations in the searches people actually typed, and write the pitch for each one
// from the numbers: what to do, why, what to expect and how we will know. A rule only finds; anything it suggests
// goes through the same validation, policy and owner approval as a proposal from the model.
//
// The unit is a THEME, not a single search: "viñedos en queretaro", "viñedos querétaro precios" and thirty more are
// one decision (do we pay for Querétaro searches or not), and counted one by one each of them looks too small to act
// on. A theme is another wine region or another winery's name.
//
// What these rules deliberately do NOT do: block a search just because it has not produced an online reservation.
// "viñedos en san miguel de allende" is the right search even on a month it converts badly; that is a landing-page
// problem, so it comes back as advice, not as a change to the campaign.
import type { LocalDate } from '../domain/time.ts';
import { addDays } from '../domain/time.ts';
import { fold, hasPhrase, surelyBlocks, namesUs, type MatchType } from '../domain/keywords.ts';

export const DETECTOR_VERSION = 'reglas-2026-11-22.2';
export interface TermRow { campaign: string; query: string; clicks: number; costMicros: number; sessions: number; opened: number; reservations: number; recentClicks?: number }
/** How Google says a search got in: how close it was to the keyword that matched, and that keyword when the feed names it. */
export interface TermEntry { campaign: string; term: string; matchType: string; keyword?: string }
export interface KeywordInfo { campaign: string; text: string; matchType: MatchType }
export interface NegativeInfo { campaign: string; text: string; matchType: MatchType }
export interface DetectInput {
  terms: TermRow[];
  entries?: TermEntry[];
  keywords?: KeywordInfo[] | null;      // null or absent: the account feed does not carry the campaigns' keywords yet
  negatives?: NegativeInfo[];
}

export type FindingKind = 'theme_place' | 'theme_competitor' | 'landing_gap' | 'brand_split';
export type FindingAction = { actionType: 'block_search_theme'; text: string };
export interface Finding {
  key: string; kind: FindingKind; campaign: string;
  query: string;                                          // the theme word, or the search itself; empty for a campaign-wide finding
  title: string; why: string[]; expect: string; measure: string;
  moneyMicros: number;                                    // spend at stake in the window, used to rank
  action: FindingAction | null;
  note?: string;                                          // why the app cannot act on it, when it cannot
  searches?: { query: string; clicks: number; costMicros: number }[];   // the biggest searches behind a theme
  moreSearches?: number;
  stats: { clicks: number; costMicros: number; sessions: number; opened: number; reservations: number };
}

interface Theme { word: string; label: string; kind: 'place' | 'competitor' }
/** One distinctive word (without accents) per theme: the word a negative keyword would carry. */
const THEMES: Theme[] = [
  // Wine regions and cities that are not San Miguel de Allende. Someone searching these wants a winery somewhere else.
  ...([['queretaro', 'Querétaro'], ['tequisquiapan', 'Tequisquiapan'], ['bernal', 'Bernal'], ['ezequiel montes', 'Ezequiel Montes'], ['valle de guadalupe', 'Valle de Guadalupe'], ['ensenada', 'Ensenada'],
    ['baja california', 'Baja California'], ['parras', 'Parras'], ['aguascalientes', 'Aguascalientes'], ['zacatecas', 'Zacatecas'], ['napa', 'Napa'], ['mendoza', 'Mendoza']] as const).map(([word, label]) => ({ word, label, kind: 'place' as const })),
  // Other wineries by name.
  ...([['trinidad', 'La Santísima Trinidad'], ['raices', 'Tres Raíces'], ['cuna de tierra', 'Cuna de Tierra'], ['san lucas', 'San Lucas'], ['toyan', 'Toyan'], ['puerta del lobo', 'Puerta del Lobo'],
    ['freixenet', 'Freixenet'], ['la redonda', 'La Redonda'], ['cote', 'De Cote']] as const).map(([word, label]) => ({ word, label, kind: 'competitor' as const })),
];
/** How a theme is called on screen: "queretaro" is Querétaro. A word that is not a known theme is shown as it is. */
export const themeLabel = (word: string) => THEMES.find(t => t.word === fold(word))?.label ?? `“${word}”`;
export const MIN_CLICKS_PLACE = 15, MIN_CLICKS_COMPETITOR = 8, MIN_CLICKS_LANDING = 100, LANDING_OPEN_RATE = 0.05;
export const MIN_CLICKS_SPLIT = 200, SPLIT_COST_RATIO = 5, RECENT_DAYS = 4;

const pesos = (micros: number) => `MX$${Math.round(micros / 1e6).toLocaleString('en-US')}`;
const plural = (n: number, one: string, many: string) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
const quoted = (xs: string[], max = 3) => `${xs.slice(0, max).map(x => `“${x}”`).join(', ')}${xs.length > max ? ` y ${xs.length - max} más` : ''}`;
/** Short stable id for a search or a theme, safe inside an evidence reference. */
export function termHash(query: string): string {
  let h = 0x811c9dc5;
  for (const ch of fold(query)) { h ^= ch.codePointAt(0)!; h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}
export const termEvidenceIds = (resourceRef: string, query: string) => { const b = `ev_${resourceRef.replace(/^res_/, '')}_q${termHash(query)}`; return { cost: `${b}_cost_28d`, clicks: `${b}_clicks_28d`, reservations: `${b}_res_28d` }; };

const sumOf = (xs: TermRow[]) => xs.reduce((a, t) => ({ clicks: a.clicks + t.clicks, costMicros: a.costMicros + t.costMicros, sessions: a.sessions + t.sessions, opened: a.opened + t.opened, reservations: a.reservations + t.reservations }), { clicks: 0, costMicros: 0, sessions: 0, opened: 0, reservations: 0 });
/** "5 de 207 visitas abrieron la reserva", and the plain way to say none did. */
const openedOf = (opened: number, sessions: number) => (opened === 0 ? `ninguna de ${sessions === 1 ? 'su visita' : `sus ${sessions.toLocaleString('en-US')} visitas`} abrió la reserva` : `${opened} de ${plural(sessions, 'visita abrió', 'visitas abrieron')} la reserva`);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const openedLine = (s: { opened: number }) => (s.opened === 0 ? 'Nadie abrió la reserva y no hubo reservaciones en línea.' : `${plural(s.opened, 'visita abrió', 'visitas abrieron')} la reserva y ninguna terminó en reservación en línea.`);

export function detect(input: DetectInput): Finding[] {
  const out: Finding[] = [];
  const known = Array.isArray(input.keywords);
  const byCampaign = new Map<string, TermRow[]>();
  for (const t of input.terms) if (fold(t.query)) { const l = byCampaign.get(t.campaign); if (l) l.push(t); else byCampaign.set(t.campaign, [t]); }

  for (const [campaign, terms] of byCampaign) {
    const themed = new Set<TermRow>();
    for (const theme of THEMES) {
      const members = terms.filter(t => !themed.has(t) && hasPhrase(fold(t.query), theme.word));
      if (!members.length) continue;
      for (const m of members) themed.add(m);
      const ours = members.filter(t => namesUs(fold(t.query))), rest = members.filter(t => !ours.includes(t)).sort((a, b) => b.costMicros - a.costMicros);
      const stats = sumOf(rest);
      if (stats.reservations > 0 || stats.clicks < (theme.kind === 'place' ? MIN_CLICKS_PLACE : MIN_CLICKS_COMPETITOR)) continue;
      // Already dealt with: a negative keyword of the campaign stops them, or they simply stopped coming in.
      const negs = (input.negatives ?? []).filter(n => n.campaign === campaign);
      const stopped = rest.filter(t => negs.some(n => surelyBlocks(n, t.query))).reduce((a, t) => a + t.costMicros, 0);
      if (stats.costMicros > 0 && stopped / stats.costMicros >= 0.9) continue;
      const expectedRecent = stats.clicks * RECENT_DAYS / 28;
      if (expectedRecent >= 5 && rest.every(t => t.recentClicks !== undefined) && rest.reduce((a, t) => a + (t.recentClicks ?? 0), 0) === 0) continue;

      // How they get in: through keywords that carry the word (somebody chose them), or as strays of other keywords.
      const kws = known ? input.keywords!.filter(k => k.campaign === campaign && hasPhrase(fold(k.text), theme.word)).map(k => k.text) : [];
      const exact = [...new Set((input.entries ?? []).filter(e => e.campaign === campaign && e.matchType === 'EXACT' && hasPhrase(fold(e.term), theme.word)).map(e => e.term))];
      const entry = kws.length ? `La campaña tiene ${plural(kws.length, 'palabra clave', 'palabras clave')} de ${theme.label}, ${kws.length === 1 ? 'puesta' : 'puestas'} a propósito: ${quoted(kws)}.`
        : known ? 'No es una palabra clave de la campaña: estas búsquedas entran porque Google las considera parecidas a otras.'
        : exact.length === 1 ? `Una coincide letra por letra con una palabra clave de la campaña (${quoted(exact)}): alguien la puso a propósito.`
        : exact.length ? `Coinciden letra por letra con palabras clave de la campaña (${quoted(exact)}): alguien las puso a propósito.` : null;
      const action: FindingAction | null = known && !ours.length ? { actionType: 'block_search_theme', text: theme.word } : null;
      const note = action ? undefined
        : ours.length ? `Hay búsquedas que llevan nuestro nombre junto con ${theme.label} (${quoted(ours.map(t => t.query), 2)}), así que la app no bloquea la palabra completa. Se revisa a mano en Google Ads.`
        : `La app lo podrá hacer con un toque cuando reciba las palabras clave de la campaña: falta pegar el script nuevo en Google Ads (Ajustes → Conexiones).${exact.length ? ' No conviene agregar negativas a mano: chocarían con las palabras clave que ya están en la campaña.' : ''}`;
      out.push({
        key: `theme:${campaign}:${theme.word}`, kind: theme.kind === 'place' ? 'theme_place' : 'theme_competitor', campaign, query: theme.word, stats, moneyMicros: stats.costMicros,
        title: `Dejar de pagar por búsquedas de ${theme.label}`,
        why: [`${plural(rest.length, 'búsqueda', 'búsquedas distintas')}, ${plural(stats.clicks, 'clic', 'clics')} y ${pesos(stats.costMicros)} en 28 días.`, openedLine(stats),
          theme.kind === 'place' ? `Buscan en otra zona (${theme.label}), no en San Miguel de Allende.` : `Buscan otro viñedo (${theme.label}), no el nuestro.`, ...(entry ? [entry] : [])],
        expect: `Ahorro de unos ${pesos(stats.costMicros)} cada 28 días. Riesgo bajo: en 28 días ninguna de estas búsquedas reservó en línea.`,
        measure: 'En 14 días: gasto en esas búsquedas en cero y las reservaciones de la campaña sin bajar.',
        action, ...(note ? { note } : {}),
        searches: rest.slice(0, 6).map(t => ({ query: t.query, clicks: t.clicks, costMicros: t.costMicros })), moreSearches: Math.max(0, rest.length - 6),
      });
    }

    // Our name against everything else: where the campaign's money goes and which part of it reserves.
    const brand = sumOf(terms.filter(t => namesUs(fold(t.query)))), others = terms.filter(t => !namesUs(fold(t.query))).sort((a, b) => b.costMicros - a.costMicros), rest = sumOf(others);
    const split = rest.clicks >= MIN_CLICKS_SPLIT && rest.costMicros >= brand.costMicros
      && (rest.reservations === 0 || (brand.reservations > 0 && rest.costMicros / rest.reservations >= SPLIT_COST_RATIO * (brand.costMicros / brand.reservations)));
    if (split) {
      const top = others.find(t => !themed.has(t)), share = Math.round((rest.costMicros / (rest.costMicros + brand.costMicros)) * 100);
      const rate = rest.sessions ? (rest.opened / rest.sessions) * 100 : 0;
      const times = rest.reservations > 0 && brand.reservations > 0 ? Math.round((rest.costMicros / rest.reservations) / (brand.costMicros / brand.reservations)) : 0;
      out.push({
        key: `split:${campaign}`, kind: 'brand_split', campaign, query: '', stats: rest, moneyMicros: rest.costMicros,
        title: rest.reservations === 0 ? 'En esta campaña solo reserva quien ya nos busca por nombre' : `En esta campaña, una reservación fuera de nuestro nombre cuesta ${times} veces más`,
        why: [`Búsquedas con nuestro nombre: ${pesos(brand.costMicros)}, ${plural(brand.clicks, 'clic', 'clics')} y ${plural(brand.reservations, 'reservación', 'reservaciones')} en línea en 28 días.`,
          `Todas las demás: ${pesos(rest.costMicros)}, ${plural(rest.clicks, 'clic', 'clics')} y ${plural(rest.reservations, 'reservación', 'reservaciones')}; ${openedOf(rest.opened, rest.sessions)}.`,
          ...(top ? [`La más grande: “${top.query}”, ${pesos(top.costMicros)}; ${openedOf(top.opened, top.sessions)}.`] : [])],
        expect: `Es ${share}% de lo que la campaña gasta en búsquedas que se pueden ver. O la página a la que llegan los convence de reservar, o ese gasto no regresa.`,
        measure: `Meta: que al menos 1 de cada 10 de esas visitas abra la reserva. ${rest.opened === 0 ? 'Hoy no la abre ninguna.' : `Hoy la ${rate < 1.5 ? 'abre 1' : `abren ${Math.round(rate)}`} de cada 100.`}`,
        action: null, note: 'No se arregla con un cambio en la campaña: se trabaja en la página a la que llega el anuncio y en qué búsquedas se compran. Cuenta solo reservaciones en línea, no las de teléfono.',
      });
    }

    // The right search with a page that does not convert. One card per campaign is enough when the split already says it.
    if (!split) for (const t of terms) {
      if (themed.has(t) || namesUs(fold(t.query)) || t.reservations > 0) continue;
      if (t.clicks < MIN_CLICKS_LANDING || t.sessions < 50 || t.opened / t.sessions >= LANDING_OPEN_RATE) continue;
      out.push({
        key: `landing:${campaign}:${fold(t.query)}`, kind: 'landing_gap', campaign, query: t.query, moneyMicros: t.costMicros,
        stats: { clicks: t.clicks, costMicros: t.costMicros, sessions: t.sessions, opened: t.opened, reservations: t.reservations },
        title: `“${t.query}” trae visitas que no llegan a reservar`,
        why: [`${plural(t.clicks, 'clic', 'clics')} y ${pesos(t.costMicros)} en 28 días.`, `${cap(t.opened === 0 ? openedOf(0, t.sessions) : `solo ${openedOf(t.opened, t.sessions)}`)}.`, 'Es la búsqueda correcta para nosotros: no conviene bloquearla.'],
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
    schemaVersion: '1' as const, snapshotId, hypothesis: fit(f.why, 600), actionType: f.action.actionType, resourceRef, parameters: { text: f.action.text },
    evidenceRefs: [ev.cost, ev.clicks, ev.reservations],
    expectedEffect: { metric: 'gasto en esas búsquedas (28 días)', direction: 'decrease' as const, range: [Math.round(costMinor * 0.8), costMinor] as [number, number] },
    risks: ['Si alguna de esas búsquedas trae gente que reserva por teléfono o llega sin reservar, dejaríamos de verla. Las reservaciones en línea no lo muestran.'],
    alternative: 'Dejarlas correr y revisar otra vez en 28 días.', evaluationPlan: f.measure,
    rollbackPlan: 'Reactivar las palabras clave pausadas y quitar la negativa en Google Ads; la app todavía no lo deshace sola',
  };
}
/** Whole sentences up to a length, so a rationale is never cut in the middle of a word. */
const fit = (lines: string[], max: number) => { let s = ''; for (const l of lines) { if ((s ? s.length + 1 : 0) + l.length > max) break; s = s ? `${s} ${l}` : l; } return s || lines[0]!.slice(0, max); };

// ---------------- loading what the rules read ----------------

export async function loadTerms(db: D1Database, from: LocalDate, to: LocalDate): Promise<TermRow[]> {
  type R = { campaign: string; query: string; clicks: number; cost: number; sessions: number; opened: number; reservations: number; recent: number };
  const recentFrom = addDays(to, -(RECENT_DAYS - 1));
  const r = await db.prepare(`SELECT campaign, query, SUM(COALESCE(ad_clicks, 0)) AS clicks, SUM(COALESCE(ad_cost_micros, 0)) AS cost, SUM(sessions) AS sessions, SUM(opened) AS opened, SUM(reservations) AS reservations,
      SUM(CASE WHEN date >= ? THEN COALESCE(ad_clicks, 0) ELSE 0 END) AS recent
    FROM ga4_ads_queries WHERE date BETWEEN ? AND ? GROUP BY campaign, query HAVING SUM(COALESCE(ad_clicks, 0)) > 0 ORDER BY cost DESC LIMIT 3000`).bind(recentFrom, from, to)
    .all<R>().catch(() => ({ results: [] as R[] }));
  return r.results.map(x => ({ campaign: x.campaign, query: x.query, clicks: Number(x.clicks) || 0, costMicros: Number(x.cost) || 0, sessions: Number(x.sessions) || 0, opened: Number(x.opened) || 0, reservations: Number(x.reservations) || 0, recentClicks: Number(x.recent) || 0 }));
}

/** Everything the rules read. Keywords are null until the account feed has carried them at least once. */
export async function loadDetectInput(db: D1Database, today: LocalDate): Promise<DetectInput> {
  const terms = await loadTerms(db, addDays(today, -28), addDays(today, -1));
  const name = `(SELECT name FROM campaign_registry r WHERE r.account_id = x.account_id AND r.kind = 'campaign' AND r.external_id = x.campaign_id)`;
  const q = async <T>(sql: string): Promise<T[]> => (await db.prepare(sql).all<T>().catch(() => ({ results: [] as T[] }))).results;
  const entries = await q<{ campaign: string | null; term: string; match_type: string }>(`SELECT ${name} AS campaign, term, match_type FROM search_term_facts x WHERE date_to = (SELECT MAX(date_to) FROM search_term_facts)`);
  const fed = (await q<{ t: number | null }>('SELECT MAX(keywords_at) AS t FROM feed_state'))[0]?.t ?? null;
  const keywords = fed === null ? null : await q<{ campaign: string | null; text: string; match_type: MatchType }>(`SELECT ${name} AS campaign, text, match_type FROM keywords_live x WHERE status = 'ENABLED' AND ad_group_status = 'ENABLED'`);
  const negatives = await q<{ campaign: string | null; text: string; match_type: MatchType }>(`SELECT ${name} AS campaign, text, match_type FROM negatives_live x`);
  return {
    terms,
    entries: entries.filter(e => e.campaign).map(e => ({ campaign: e.campaign!, term: e.term, matchType: e.match_type })),
    keywords: keywords === null ? null : keywords.filter(k => k.campaign).map(k => ({ campaign: k.campaign!, text: k.text, matchType: k.match_type })),
    negatives: negatives.filter(n => n.campaign).map(n => ({ campaign: n.campaign!, text: n.text, matchType: n.match_type })),
  };
}
