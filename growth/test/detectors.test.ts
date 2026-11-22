// The fixed rules behind the suggestions: what they flag, what they leave alone, and the proposal they write.
import { describe, it, expect } from 'vitest';
import { detectTerms, proposalFor, termHash, termEvidenceIds, type TermRow } from '../src/read/detectors.ts';
import { ModelProposal, ActionParameters } from '../src/domain/schemas.ts';

const t = (query: string, clicks: number, pesos: number, sessions = clicks, opened = 0, reservations = 0, campaign = 'MOFU_Conversiones_Search_DB+Tribalo'): TermRow => ({ campaign, query, clicks, costMicros: pesos * 1e6, sessions, opened, reservations });

describe('search-term rules', () => {
  const found = detectTerms([
    t('viñedos en san miguel de allende', 235, 575, 207, 5), t('bodega dos buhos', 70, 170, 60, 11, 2), t('viñedos en queretaro', 53, 153, 20), t('viñedos queretaro', 46, 128, 8),
    t('viñedo la santisima trinidad san miguel', 9, 74, 2, 1, 0, 'EN - In San Miguel (tours & tastings)'), t('viñedos cerca de mi', 50, 89, 4), t('vinos tequisquiapan', 6, 30), t('what to do in san miguel de allende', 8, 83, 7),
  ]);
  it('suggests blocking searches for another wine region or another winery', () => {
    expect(found.filter(f => f.action).map(f => f.query)).toEqual(['viñedos en queretaro', 'viñedos queretaro', 'viñedo la santisima trinidad san miguel']);
    const q = found.find(f => f.query === 'viñedos en queretaro')!;
    expect(q.title).toBe('Dejar de pagar por “viñedos en queretaro”');
    expect(q.why).toEqual(['53 clics y $153 en 28 días.', 'Nadie abrió la reserva y no hubo reservaciones en línea.', 'Es una búsqueda de otra zona (Querétaro), no de San Miguel de Allende.']);
    expect(found.find(f => f.kind === 'negative_competitor')!.why[2]).toContain('La Santísima Trinidad');
  });
  it('never blocks our own name, a search that reserved, or the right search that converts badly', () => {
    expect(found.some(f => f.query === 'bodega dos buhos')).toBe(false);
    expect(detectTerms([t('viñedos en queretaro', 53, 153, 20, 2, 1)])).toEqual([]);
    const core = found.find(f => f.query === 'viñedos en san miguel de allende')!;
    expect(core.kind).toBe('landing_gap'); expect(core.action).toBeNull(); expect(core.why[1]).toBe('Solo 5 de 207 visitas abrieron la reserva.');
  });
  it('leaves small numbers alone', () => {
    expect(found.some(f => f.query === 'vinos tequisquiapan')).toBe(false);           // 6 clicks
    expect(found.some(f => f.query === 'viñedos cerca de mi')).toBe(false);           // not another place, under 100 clicks
    expect(found.some(f => f.query === 'what to do in san miguel de allende')).toBe(false);
  });
  it('ranks by the money at stake', () => { expect(found.map(f => f.moneyMicros)).toEqual([...found.map(f => f.moneyMicros)].sort((a, b) => b - a)); });
});

describe('the proposal written from a finding', () => {
  const f = detectTerms([t('viñedos en queretaro', 53, 153, 20)])[0]!;
  it('is a valid proposal with server-style references', () => {
    const p = proposalFor(f, 'snap_0123456789abcdef', 'res_mofu')!;
    expect(ModelProposal.safeParse(p).success).toBe(true);
    expect(ActionParameters.add_negative_keyword_exact.safeParse(p.parameters).success).toBe(true);
    expect(p.evidenceRefs).toEqual(Object.values(termEvidenceIds('res_mofu', 'viñedos en queretaro')));
    expect(p.evidenceRefs.every(e => /^ev_[a-z0-9_]{3,80}$/.test(e))).toBe(true);
    expect(p.expectedEffect.range).toEqual([12240, 15300]);
  });
  it('gives the same id to the same search however it is typed', () => { expect(termHash('Viñedos  en Querétaro')).toBe(termHash('vinedos en queretaro')); });
  it('does not propose a search the app cannot send as a keyword', () => {
    const odd = detectTerms([t('viñedos queretaro (precios)', 40, 90)])[0]!;
    expect(odd.action).toBeNull(); expect(proposalFor(odd, 'snap_0123456789abcdef', 'res_mofu')).toBeNull(); expect(odd.note).toContain('a mano');
  });
});

// ---------- a rule's proposal through validation, policy and the owner's decision ----------
import { validateProposal } from '../src/policy/validate.ts';
import { liveCoordinator, goodContext, snapshot, LIVE_POLICY } from './helpers.ts';

describe('a rule proposal in the coordinator', () => {
  const setup = () => {
    const live = liveCoordinator({ policy: { ...LIVE_POLICY, allowedAutomaticActions: [] } });
    live.goLive();
    const f = detectTerms([t('viñedos en queretaro', 53, 153, 20, 0, 0, 'Restaurante ES')])[0]!;
    const snap = live.snap, ids = termEvidenceIds('res_resto01', f.query), window = { from: '2026-10-25', to: '2026-11-21' };
    for (const [id, value] of [[ids.cost, 15300], [ids.clicks, 53], [ids.reservations, 0]] as [string, number][]) snap.evidence[id] = { id, metric: 'search_term', window, value, resourceRef: 'res_resto01', provisional: false };
    const v = validateProposal(proposalFor(f, snap.snapshotId, 'res_resto01'), snap);
    if (!v.ok) throw new Error(v.errors.join('; '));
    return { ...live, intent: v.intent };
  };
  it('becomes a negative keyword that waits for the owner and adds no spend', async () => {
    const { core, snap, now, intent } = setup();
    expect(intent.spendIncreasing).toBe(false);
    expect(intent.operations).toEqual([{ kind: 'add_negative_exact', campaignId: '222', text: 'vinedos en queretaro' }]);   // the validator strips accents
    const { action } = await core.propose(intent, 'model', goodContext(snap, now));
    expect(action.state).toBe('APPROVAL_REQUIRED');
  });
  it('is refused when its evidence is not in the snapshot', () => {
    const f = detectTerms([t('viñedos en queretaro', 53, 153, 20, 0, 0, 'Restaurante ES')])[0]!;
    expect(validateProposal(proposalFor(f, 'snap_test0001', 'res_resto01'), snapshot()).ok).toBe(false);
  });
  it('can be declined with a reason, and then it can no longer be approved', async () => {
    const { core, snap, now, intent } = setup();
    const { action } = await core.propose(intent, 'model', goodContext(snap, now));
    expect(core.decline(action.id, 'eric@example.com', 'Quiero ver más datos').state).toBe('REJECTED');
    expect(() => core.decline(action.id, 'eric@example.com', 'otra vez')).toThrow(/REJECTED/);
    expect(() => core.approve(action.id, action.approval_hash, 'eric@example.com')).toThrow(/REJECTED/);
  });
});
