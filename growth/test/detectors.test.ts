// The fixed rules behind the suggestions: what they flag, what they leave alone, and the proposal they write.
import { describe, it, expect } from 'vitest';
import { detect, proposalFor, termHash, termEvidenceIds, themeLabel, type TermRow, type DetectInput } from '../src/read/detectors.ts';
import { ModelProposal, ActionParameters } from '../src/domain/schemas.ts';

const MOFU = 'MOFU_Conversiones_Search_DB+Tribalo', EN = 'EN - In San Miguel (tours & tastings)';
const t = (query: string, clicks: number, pesos: number, sessions = clicks, opened = 0, reservations = 0, campaign = MOFU, recentClicks?: number): TermRow => ({ campaign, query, clicks, costMicros: pesos * 1e6, sessions, opened, reservations, ...(recentClicks === undefined ? {} : { recentClicks }) });

// Made-up numbers in the shape of a real account: a region that is not ours, other wineries by name, our own name, and the right search.
const TERMS: TermRow[] = [
  t('viñedos en san miguel de allende', 260, 520, 220, 5), t('bodega dos buhos', 300, 600, 270, 40, 6),
  t('viñedos en queretaro', 60, 180, 24), t('viñedos queretaro', 40, 120, 10), t('viñedos en querétaro precios', 6, 18, 2), t('viñedo queretaro', 4, 12, 1),
  t('viñedos cerca de mi', 90, 180, 70, 1), t('vinos tequisquiapan', 6, 24),
  t('viñedo la santisima trinidad san miguel', 10, 80, 3, 1, 0, EN), t('viñedo santísima trinidad san miguel de allende', 6, 36, 1, 0, 0, EN), t('viñedo la trinidad san miguel de allende', 2, 16, 0, 0, 0, EN),
  t('viñedo tres raices', 4, 28, 2, 0, 0, EN), t('viñedo 3 raices', 3, 21, 1, 0, 0, EN), t('dos buhos winery', 12, 36, 10, 2, 1, EN), t('what to do in san miguel de allende', 8, 64, 7, 0, 0, EN),
];
const input = (over: Partial<DetectInput> = {}): DetectInput => ({ terms: TERMS, ...over });

describe('search themes', () => {
  const found = detect(input());
  const q = found.find(f => f.key === `theme:${MOFU}:queretaro`)!;
  it('adds up every way of writing the same thing, instead of judging each search alone', () => {
    expect(q.kind).toBe('theme_place');
    expect(q.title).toBe('Dejar de pagar por búsquedas de Querétaro');
    expect(q.stats).toMatchObject({ clicks: 110, costMicros: 330e6, reservations: 0 });
    expect(q.why.slice(0, 3)).toEqual(['4 búsquedas distintas, 110 clics y MX$330 en 28 días.', 'Nadie abrió la reserva y no hubo reservaciones en línea.', 'Buscan en otra zona (Querétaro), no en San Miguel de Allende.']);
    expect(q.searches!.map(s => s.query)).toEqual(['viñedos en queretaro', 'viñedos queretaro', 'viñedos en querétaro precios', 'viñedo queretaro']);
  });
  it('finds another winery by its distinctive word, however it was typed', () => {
    const tr = found.find(f => f.key === `theme:${EN}:trinidad`)!;
    expect(tr.kind).toBe('theme_competitor');
    expect(tr.stats.clicks).toBe(18);
    expect(tr.why[1]).toBe('1 visita abrió la reserva y ninguna terminó en reservación en línea.');
    expect(tr.why[2]).toBe('Buscan otro viñedo (La Santísima Trinidad), no el nuestro.');
    expect(found.some(f => f.key === `theme:${EN}:raices`)).toBe(false);            // 7 clicks: under the bar of 8
    expect(found.some(f => f.query === 'tequisquiapan')).toBe(false);               // 6 clicks
  });
  it('cannot act until the feed carries the keywords, and says so without telling the owner to do it by hand', () => {
    expect(q.action).toBeNull();
    expect(q.note).toContain('script nuevo');
    expect(q.note).not.toContain('a mano:');
  });
  it('reads from the match type that a search is itself a keyword of the campaign', () => {
    const f = detect(input({ entries: [{ campaign: MOFU, term: 'viñedos en queretaro', matchType: 'EXACT' }, { campaign: MOFU, term: 'viñedos queretaro', matchType: 'NEAR_EXACT' }] })).find(x => x.query === 'queretaro')!;
    expect(f.why[3]).toBe('Una coincide letra por letra con una palabra clave de la campaña (“viñedos en queretaro”): alguien la puso a propósito.');
    expect(f.note).toContain('chocarían con las palabras clave');
  });
  it('offers the one-tap block once the keywords are known, naming the ones behind the theme', () => {
    const f = detect(input({ keywords: [{ campaign: MOFU, text: 'viñedos en queretaro', matchType: 'PHRASE' }, { campaign: MOFU, text: 'viñedos querétaro', matchType: 'EXACT' }, { campaign: MOFU, text: 'viñedos', matchType: 'BROAD' }] })).find(x => x.query === 'queretaro')!;
    expect(f.action).toEqual({ actionType: 'block_search_theme', text: 'queretaro' });
    expect(f.note).toBeUndefined();
    expect(f.why[3]).toBe('La campaña tiene 2 palabras clave de Querétaro, puestas a propósito: “viñedos en queretaro”, “viñedos querétaro”.');
    const stray = detect(input({ keywords: [{ campaign: EN, text: 'winery san miguel', matchType: 'PHRASE' }] })).find(x => x.query === 'trinidad')!;
    expect(stray.why[3]).toContain('No es una palabra clave de la campaña');
    expect(stray.action).toEqual({ actionType: 'block_search_theme', text: 'trinidad' });
  });
  it('drops a theme that is already blocked, that stopped coming in, or that reserved', () => {
    const two = [t('viñedos en queretaro', 50, 150, 20), t('viñedos en querétaro', 20, 60, 8)], neg = (text: string) => ({ campaign: MOFU, text, matchType: 'PHRASE' as const });
    expect(detect({ terms: two, keywords: [], negatives: [neg('queretaro')] }).some(f => f.query === 'queretaro')).toBe(true);     // to Google the accented word is another negative
    expect(detect({ terms: two, keywords: [], negatives: [neg('queretaro'), neg('querétaro')] }).some(f => f.query === 'queretaro')).toBe(false);
    expect(detect({ terms: TERMS.map(x => ({ ...x, recentClicks: /quer/.test(x.query) ? 0 : 3 })) }).some(f => f.query === 'queretaro')).toBe(false);
    expect(detect({ terms: TERMS.map(x => (x.query === 'viñedos queretaro' ? { ...x, reservations: 1 } : x)) }).some(f => f.query === 'queretaro')).toBe(false);
  });
  it('does not call a small theme stopped just because of a few quiet days', () => {
    expect(detect({ terms: TERMS.map(x => ({ ...x, recentClicks: 0 })) }).some(f => f.query === 'trinidad')).toBe(true);     // 18 clicks in 28 days: four empty days prove nothing
  });
  it('will not block a word that also appears next to our own name', () => {
    const f = detect(input({ keywords: [], terms: [...TERMS, t('dos buhos queretaro', 3, 9, 3, 1)] })).find(x => x.query === 'queretaro')!;
    expect(f.action).toBeNull(); expect(f.note).toContain('nuestro nombre');
    expect(f.stats.clicks).toBe(110);                                                // our own search is not counted as waste
  });
  it('ranks by the money at stake', () => { expect(found.map(f => f.moneyMicros)).toEqual([...found.map(f => f.moneyMicros)].sort((a, b) => b - a)); });
});

describe('our name against everything else', () => {
  const found = detect(input());
  it('shows that the campaign only reserves on searches for our name', () => {
    const s = found.find(f => f.key === `split:${MOFU}`)!;
    expect(s.title).toBe('En esta campaña solo reserva quien ya nos busca por nombre');
    expect(s.why[0]).toBe('Búsquedas con nuestro nombre: MX$600, 300 clics y 6 reservaciones en línea en 28 días.');
    expect(s.why[1]).toBe('Todas las demás: MX$1,054, 466 clics y 0 reservaciones; 6 de 333 visitas abrieron la reserva.');
    expect(s.why[2]).toBe('La más grande: “viñedos en san miguel de allende”, MX$520; 5 de 220 visitas abrieron la reserva.');
    expect(s.measure).toBe('Meta: que al menos 1 de cada 10 de esas visitas abra la reserva. Hoy la abren 2 de cada 100.');
    expect(s.action).toBeNull();
  });
  it('says the same once, not again as a separate card for the biggest search', () => {
    expect(found.some(f => f.kind === 'landing_gap' && f.campaign === MOFU)).toBe(false);
  });
  it('stays quiet where there are few clicks outside our name', () => { expect(found.some(f => f.key === `split:${EN}`)).toBe(false); });
  it('says how much more a reservation costs outside our name, when there are some', () => {
    const s = detect({ terms: [t('dos buhos winery', 50, 200, 44, 6, 2, EN), t('wineries san miguel de allende', 240, 1800, 80, 0, 1, EN)] }).find(f => f.kind === 'brand_split')!;
    expect(s.title).toBe('En esta campaña, una reservación fuera de nuestro nombre cuesta 18 veces más');
    expect(s.why[1]).toBe('Todas las demás: MX$1,800, 240 clics y 1 reservación; ninguna de sus 80 visitas abrió la reserva.');
    expect(s.measure).toContain('Hoy no la abre ninguna.');
  });
  it('still flags the right search with a page that does not convert when there is no split to say it', () => {
    const f = detect({ terms: [t('viñedos en san miguel de allende', 120, 300, 100, 2)] });
    expect(f.map(x => x.kind)).toEqual(['landing_gap']); expect(f[0]!.why[1]).toBe('Solo 2 de 100 visitas abrieron la reserva.');
    expect(detect({ terms: [t('viñedos en san miguel de allende', 120, 300, 100, 0)] })[0]!.why[1]).toBe('Ninguna de sus 100 visitas abrió la reserva.');
  });
  it('never blocks our own name or a search that reserved', () => {
    expect(found.some(f => /buhos/.test(f.query))).toBe(false);
  });
});

describe('the proposal written from a finding', () => {
  const f = detect(input({ keywords: [{ campaign: MOFU, text: 'viñedos en queretaro', matchType: 'PHRASE' }] })).find(x => x.query === 'queretaro')!;
  it('is a valid proposal with server-style references', () => {
    const p = proposalFor(f, 'snap_0123456789abcdef', 'res_mofu')!;
    expect(ModelProposal.safeParse(p).success).toBe(true);
    expect(ActionParameters.block_search_theme.safeParse(p.parameters).success).toBe(true);
    expect(p.evidenceRefs).toEqual(Object.values(termEvidenceIds('res_mofu', 'queretaro')));
    expect(p.evidenceRefs.every(e => /^ev_[a-z0-9_]{3,80}$/.test(e))).toBe(true);
    expect(p.expectedEffect.range).toEqual([26400, 33000]);
    expect(p.hypothesis.endsWith('.')).toBe(true);                                   // whole sentences, never cut mid-word
  });
  it('gives the same id to the same words however they are typed', () => { expect(termHash('Viñedos  en Querétaro')).toBe(termHash('vinedos en queretaro')); });
  it('has nothing to propose for a finding the app cannot act on', () => { expect(proposalFor(detect(input()).find(x => x.query === 'queretaro')!, 'snap_0123456789abcdef', 'res_mofu')).toBeNull(); });
  it('names a theme the way the owner would', () => { expect(themeLabel('queretaro')).toBe('Querétaro'); expect(themeLabel('raices')).toBe('Tres Raíces'); expect(themeLabel('mirador')).toBe('“mirador”'); });
});
