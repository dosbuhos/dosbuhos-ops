// Blocking a search theme: what the server builds from one word, what it refuses, and the whole path from the owner's
// approval to a change verified in the account, both with a provider that answers at once and with the hourly script.
import { describe, it, expect } from 'vitest';
import { validateProposal, MAX_THEME_CLICK_SHARE, type Snapshot, type SnapshotTerm, type SnapshotKeyword } from '../src/policy/validate.ts';
import { CoordinatorCore } from '../src/coordinator/core.ts';
import { ScriptAdsProvider } from '../src/connectors/google-ads-script.ts';
import { blocks, surelyBlocks, surfaceForms, isProtectedTheme, canon, fold } from '../src/domain/keywords.ts';
import { queuedAlert, SCRIPT_LATE_MS } from '../src/read/suggestions.ts';
import { liveCoordinator, goodContext, snapshot, proposal, memorySql, sqliteD1, ACCOUNT, M, LIVE_POLICY } from './helpers.ts';

const term = (text: string, clicks: number, pesos: number, reservations = 0, opened = 0): SnapshotTerm => ({ text, clicks, costMicros: pesos * 1e6, opened, reservations });
const kw = (criterionId: string, text: string, matchType: SnapshotKeyword['matchType'], clicks = 0, pesos = 0, conversionsMilli = 0): SnapshotKeyword => ({ text, matchType, adGroupId: '20', criterionId, adGroupName: 'Viñedos', clicks, costMicros: pesos * 1e6, conversionsMilli });
const TERMS = [term('viñedos en san miguel de allende', 260, 520, 0, 5), term('bodega dos buhos', 300, 600, 6, 40), term('viñedos en queretaro', 60, 180), term('viñedos queretaro', 40, 120),
  term('viñedos en querétaro', 4, 12), term('Viñedos  Querétaro precios', 6, 18), term('viñedos cerca de mi', 90, 180, 0, 1)];
const KEYWORDS = [kw('301', 'viñedos en queretaro', 'PHRASE', 100, 300), kw('302', 'viñedos querétaro', 'EXACT', 10, 30), kw('303', 'viñedos en san miguel de allende', 'EXACT', 260, 520), kw('304', 'viñedos', 'BROAD', 90, 170)];

function snap(over: Partial<Snapshot> = {}): Snapshot {
  const s = snapshot();
  return { ...s, keywords: { ...s.keywords, '222': KEYWORDS.map(k => k.text) }, keywordList: { '222': KEYWORDS }, terms: { '222': TERMS }, negatives: { '222': [] }, termsWindow: { from: '2026-10-25', to: '2026-11-21' }, ...over };
}
const theme = (text: string) => proposal({ actionType: 'block_search_theme', resourceRef: 'res_resto01', parameters: { text }, hypothesis: 'Las búsquedas de otra zona no reservan y cuestan dinero cada mes' });
const errorsOf = (text: string, s = snap()) => { const v = validateProposal(theme(text), s); return v.ok ? [] : v.errors; };

describe('keyword text', () => {
  it('keeps accents in what is sent and drops them only to compare', () => {
    expect(canon('  [Viñedos   en QUERÉTARO] ')).toBe('viñedos en querétaro');
    expect(fold('Viñedos en Querétaro')).toBe('vinedos en queretaro');
  });
  it('knows what each kind of negative stops, for certain and at most', () => {
    expect(blocks({ text: 'queretaro', matchType: 'PHRASE' }, 'viñedos en querétaro precios')).toBe(true);         // could stop it
    expect(surelyBlocks({ text: 'queretaro', matchType: 'PHRASE' }, 'viñedos en querétaro precios')).toBe(false);  // but to Google the accent makes it another word
    expect(surelyBlocks({ text: 'querétaro', matchType: 'PHRASE' }, 'viñedos en querétaro precios')).toBe(true);
    expect(blocks({ text: 'viñedos queretaro', matchType: 'EXACT' }, 'viñedos en queretaro')).toBe(false);
    expect(blocks({ text: 'queretaro viñedos', matchType: 'BROAD' }, 'viñedos baratos en queretaro')).toBe(true);
    expect(blocks({ text: 'san lucas', matchType: 'PHRASE' }, 'lucas san')).toBe(false);
  });
  it('finds how a word is really written', () => {
    expect(surfaceForms('Viñedos en Querétaro, precios', 'queretaro')).toEqual(['querétaro']);
    expect(surfaceForms('viñedo san lucas san miguel', 'san lucas')).toEqual(['san lucas']);
  });
  it('protects our name and our town, whole or in pieces', () => {
    for (const w of ['buhos', 'dos buhos', 'bodega dos buhos', 'san miguel', 'allende', 'miguel', 'san miguel de allende', 'de allende']) expect(isProtectedTheme(fold(w)), w).toBe(true);
    for (const w of ['queretaro', 'san lucas', 'trinidad', 'raices', 'napa']) expect(isProtectedTheme(fold(w)), w).toBe(false);
  });
});

describe('what the server builds from one word', () => {
  const v = validateProposal(theme('Querétaro'), snap());
  it('pauses the keywords that carry it and adds it as a negative the way people write it', () => {
    if (!v.ok) throw new Error(v.errors.join('; '));
    expect(v.intent.spendIncreasing).toBe(false);
    expect(v.intent.operations).toEqual([
      { kind: 'pause_keyword', campaignId: '222', adGroupId: '20', criterionId: '301', text: 'viñedos en queretaro', matchType: 'PHRASE' },
      { kind: 'pause_keyword', campaignId: '222', adGroupId: '20', criterionId: '302', text: 'viñedos querétaro', matchType: 'EXACT' },
      { kind: 'add_negative_phrase', campaignId: '222', text: 'queretaro' },
      { kind: 'add_negative_phrase', campaignId: '222', text: 'querétaro' },
    ]);
  });
  it('says exactly what it would have stopped', () => {
    if (!v.ok) throw new Error('invalid');
    expect(v.intent.impact).toMatchObject({ theme: 'queretaro', searches: 4, clicks: 110, costMicros: 330e6, reservations: 0, negatives: ['queretaro', 'querétaro'], window: { from: '2026-10-25', to: '2026-11-21' } });
    expect(v.intent.impact!.clickSharePct).toBe(14.5);
    expect(v.intent.impact!.top[0]).toEqual({ text: 'viñedos en queretaro', clicks: 60, costMicros: 180e6 });
    expect(v.intent.impact!.keywords.map(k => k.text)).toEqual(['viñedos en queretaro', 'viñedos querétaro']);
  });
  it('only adds what is missing', () => {
    const half = validateProposal(theme('queretaro'), snap({ negatives: { '222': [{ text: 'Queretaro', matchType: 'PHRASE', level: 'campaign' }] } }));
    if (!half.ok) throw new Error(half.errors.join('; '));
    expect(half.intent.operations.filter(o => o.kind === 'add_negative_phrase')).toEqual([{ kind: 'add_negative_phrase', campaignId: '222', text: 'querétaro' }]);
    const done = snap({ keywordList: { '222': KEYWORDS.slice(2) }, negatives: { '222': [{ text: 'queretaro', matchType: 'PHRASE', level: 'campaign' }, { text: 'querétaro', matchType: 'BROAD', level: 'list' }] } });
    expect(errorsOf('queretaro', done)[0]).toContain('no queda nada por hacer');
  });
  it('refuses our own name and town, a word too short, and a word nobody searched', () => {
    expect(errorsOf('buhos')[0]).toContain('nuestro nombre o nuestro pueblo');
    expect(errorsOf('allende')[0]).toContain('nuestro nombre o nuestro pueblo');
    expect(errorsOf('qro')).not.toEqual([]);                                       // three letters do not pass the parameter rule
    expect(errorsOf('mendoza')[0]).toContain('ninguna búsqueda');
  });
  it('refuses to block a search that reserved, or one that carries our name', () => {
    expect(errorsOf('queretaro', snap({ terms: { '222': [...TERMS, term('hotel viñedo queretaro', 3, 9, 1)] } }))[0]).toContain('trajo 1 reservación en línea');
    expect(errorsOf('queretaro', snap({ terms: { '222': [...TERMS, term('dos búhos queretaro', 3, 9)] } }))[0]).toContain('lleva nuestro nombre');
  });
  it('refuses a change that would take too much of the campaign, or pause a keyword that converts', () => {
    expect(errorsOf('viñedos')[0]).toMatch(/detendría \d+% de los clics/);
    expect(MAX_THEME_CLICK_SHARE).toBe(0.25);
    expect(errorsOf('queretaro', snap({ keywordList: { '222': [kw('301', 'viñedos en queretaro', 'PHRASE', 100, 300, 2000), ...KEYWORDS.slice(1)] } }))[0]).toContain('tiene conversiones');
  });
  it('cannot measure anything without the keywords and searches of the campaign', () => {
    const { keywordList: _k, ...bare } = snap();
    expect(errorsOf('queretaro', bare as Snapshot)[0]).toContain('todavía no recibe las palabras clave');
    expect(errorsOf('queretaro', snap({ terms: {} }))[0]).toContain('todavía no recibe las palabras clave');
  });
});

describe('one exact negative', () => {
  const exact = (text: string) => proposal({ actionType: 'add_negative_keyword_exact', resourceRef: 'res_resto01', parameters: { text } });
  it('is sent with its accents', () => {
    const v = validateProposal(exact('Mirador de Querétaro'), snap());
    if (!v.ok) throw new Error(v.errors.join('; '));
    expect(v.intent.operations).toEqual([{ kind: 'add_negative_exact', campaignId: '222', text: 'mirador de querétaro' }]);
  });
  it('is refused when it would fight a keyword, with or without the accent', () => {
    const v = validateProposal(exact('viñedos queretaro'), snap());
    expect(v.ok).toBe(false); if (!v.ok) expect(v.errors[0]).toContain('bloquearía la palabra clave activa');
  });
  it('is refused for our name and for what is already blocked', () => {
    const a = validateProposal(exact('dos búhos precios'), snap()), b = validateProposal(exact('empleo en viñedos'), snap({ negatives: { '222': [{ text: 'empleo', matchType: 'BROAD', level: 'list' }] } }));
    expect(a.ok).toBe(false); expect(b.ok).toBe(false);
    if (!b.ok) expect(b.errors[0]).toContain('ya está bloqueada');
  });
});

describe('approval to verified change, with a provider that answers at once', () => {
  const setup = (policy = { ...LIVE_POLICY, allowedAutomaticActions: [] as never[] }) => {
    const live = liveCoordinator({ policy });
    live.provider.state.keywords = { '20~301': 'ENABLED', '20~302': 'ENABLED', '20~303': 'ENABLED' };
    live.goLive();
    const s = snap(), v = validateProposal(theme('queretaro'), s);
    if (!v.ok) throw new Error(v.errors.join('; '));
    return { ...live, s, intent: v.intent };
  };
  it('waits for the owner, then pauses the keywords and adds the negatives, and verifies each', async () => {
    const { core, provider, s, now, intent } = setup();
    const { action } = await core.propose(intent, 'model', goodContext(s, now));
    expect(action.state).toBe('APPROVAL_REQUIRED');
    core.approve(action.id, action.approval_hash, 'eric');
    expect((await core.execute(action.id, goodContext(s, now))).state).toBe('VERIFIED');
    expect(provider.state.keywords).toEqual({ '20~301': 'PAUSED', '20~302': 'PAUSED', '20~303': 'ENABLED' });
    expect(provider.state.phraseNegatives).toEqual({ '222': ['queretaro', 'querétaro'] });
    expect(core.state().activeReservations).toBe(0);
  });
  it('is undone in Google Ads, and says so instead of pretending', async () => {
    const { core, s, now, intent } = setup();
    const { action } = await core.propose(intent, 'model', goodContext(s, now));
    core.approve(action.id, action.approval_hash, 'eric'); await core.execute(action.id, goodContext(s, now));
    const r = await core.compensate(action.id, 'eric');
    expect(r.refused).toContain('se deshace en Google Ads'); expect(r.action.state).toBe('VERIFIED');
  });
  it('is rejected, not applied, when a keyword was already paused by someone else', async () => {
    const { core, provider, s, now, intent } = setup();
    const { action } = await core.propose(intent, 'model', goodContext(s, now));
    provider.state.keywords!['20~302'] = 'PAUSED';
    core.approve(action.id, action.approval_hash, 'eric');
    const r = await core.execute(action.id, goodContext(s, now));
    expect(r.state).toBe('REJECTED'); expect(provider.state.phraseNegatives ?? {}).toEqual({});
  });
  it('keeps a suggestion waiting when the day has no changes left, instead of approving it into a refusal', async () => {
    const { core, s, now, intent } = setup({ ...LIVE_POLICY, allowedAutomaticActions: [], maxOptimizationMutationsPerDay: 1 });
    const first = await core.propose(intent, 'model', goodContext(s, now));
    const other = validateProposal(theme('cerca de mi'), s); if (!other.ok) throw new Error(other.errors.join('; '));
    const second = await core.propose(other.intent, 'model', goodContext(s, now));
    core.approve(first.action.id, first.action.approval_hash, 'eric'); await core.execute(first.action.id, goodContext(s, now));
    expect(core.state().mutationsLast24h).toBe(1);
    expect(() => core.approve(second.action.id, second.action.approval_hash, 'eric')).toThrow(/límite diario/);
    expect(core.action(second.action.id)!.state).toBe('APPROVAL_REQUIRED');
  });
});

describe('approval to verified change, through the hourly Google Ads Script', () => {
  function setup() {
    let t = Date.UTC(2026, 10, 22, 18, 20);
    const now = () => t;
    const { db, d1 } = sqliteD1();
    db.exec(`INSERT INTO ad_accounts (id, provider, external_id, name, currency, account_tz, created_at) VALUES ('g', 'google_ads', '${ACCOUNT}', 'g', 'MXN', 'America/Mexico_City', 0);
      INSERT OR REPLACE INTO connections (id, provider, purpose, health, last_success_at, updated_at) VALUES ('conn_google_ads_script', 'google_ads_script', 'x', 'connected', ${t}, 0);
      INSERT INTO keywords_live (account_id, campaign_id, ad_group_id, criterion_id, text, match_type, status, seen_at) VALUES ('g', '222', '20', '301', 'viñedos en queretaro', 'PHRASE', 'ENABLED', 0), ('g', '222', '20', '302', 'viñedos querétaro', 'EXACT', 'ENABLED', 0);`);
    const core = new CoordinatorCore(memorySql(), { provider: new ScriptAdsProvider(d1, now), now, environment: 'production' });
    core.initialize(ACCOUNT, 'OBSERVE', 'owner'); core.setBaseline(M(800), 'owner');
    core.setPolicy({ ...LIVE_POLICY, allowedAutomaticActions: [], mode: 'OBSERVE' }, 'owner');
    core.setMode('LIMITED_AUTO', 'owner', { policyVersion: core.policyVersion() });
    const s = snap(), v = validateProposal(theme('queretaro'), s);
    if (!v.ok) throw new Error(v.errors.join('; '));
    /** One run of the script: it reports what it did with each queued change, then posts the account as it now is. */
    const scriptRun = (opts: { skip?: string[]; stale?: boolean } = {}) => {
      t += 50 * 60_000;
      for (const o of db.prepare("SELECT id, kind, criterion_id, text FROM script_ops WHERE status IN ('queued', 'sent')").all() as { id: string; kind: string; criterion_id: string | null; text: string }[]) {
        const skipped = opts.skip?.includes(o.criterion_id ?? o.text);
        db.prepare('UPDATE script_ops SET status = ?, detail = ?, done_at = ? WHERE id = ?').run(skipped ? 'skipped' : 'applied', skipped ? 'La palabra clave ya no estaba activa' : '', t, o.id);
        if (skipped || opts.stale) continue;
        if (o.kind === 'pause_keyword') db.prepare("UPDATE keywords_live SET status = 'PAUSED' WHERE criterion_id = ?").run(o.criterion_id);
        else db.prepare("INSERT INTO negatives_live (account_id, campaign_id, text, match_type, level, scope_id, seen_at) VALUES ('g', '222', ?, 'PHRASE', 'campaign', '', ?)").run(o.text, t);
      }
      db.prepare("UPDATE connections SET last_success_at = ? WHERE id = 'conn_google_ads_script'").run(t);
    };
    const approve = async (intent = v.intent) => { const { action } = await core.propose(intent, 'model', goodContext(s, now)); core.approve(action.id, action.approval_hash, 'eric'); return core.execute(action.id, goodContext(s, now)); };
    return { core, db, s, now, approve, scriptRun, advance: (ms: number) => { t += ms; } };
  }

  it('queues every part of the change at once, and one run of the script settles it', async () => {
    const { core, db, approve, scriptRun } = setup();
    const a = await approve();
    expect(a.state).toBe('UNKNOWN_OUTCOME');
    expect(db.prepare('SELECT kind, criterion_id, text, match_type, status FROM script_ops ORDER BY rowid').all()).toEqual([
      { kind: 'pause_keyword', criterion_id: '301', text: 'viñedos en queretaro', match_type: null, status: 'queued' }, { kind: 'pause_keyword', criterion_id: '302', text: 'viñedos querétaro', match_type: null, status: 'queued' },
      { kind: 'add_negative_phrase', criterion_id: null, text: 'queretaro', match_type: 'PHRASE', status: 'queued' }, { kind: 'add_negative_phrase', criterion_id: null, text: 'querétaro', match_type: 'PHRASE', status: 'queued' }]);
    expect((await core.reconcile(a.id)).state).toBe('UNKNOWN_OUTCOME');             // before the script runs, nothing is judged
    scriptRun();
    expect((await core.reconcile(a.id)).state).toBe('VERIFIED');
    expect(core.state().unknownOutcomes).toBe(0);
  });
  it('reports the part the script skipped, with the script\'s own reason', async () => {
    const { core, approve, scriptRun } = setup();
    const a = await approve();
    scriptRun({ skip: ['302'] });
    const r = await core.reconcile(a.id);
    expect(r.state).toBe('PARTIALLY_APPLIED');
    expect(JSON.parse(r.op_results)[1]).toEqual({ index: 1, status: 'failed', detail: 'No se aplicó: La palabra clave ya no estaba activa' });
  });
  it('waits for the next run when the script says applied but its own report does not show it yet', async () => {
    const { core, db, now, approve, scriptRun, advance } = setup();
    const a = await approve();
    scriptRun({ stale: true });
    expect((await core.reconcile(a.id)).state).toBe('UNKNOWN_OUTCOME');             // same run: not proof of anything
    advance(2 * 3_600_000);
    expect((await core.reconcile(a.id)).state).toBe('UNKNOWN_OUTCOME');             // time passing is not a new report
    db.prepare("UPDATE connections SET last_success_at = ? WHERE id = 'conn_google_ads_script'").run(now());
    const r = await core.reconcile(a.id);                                           // a later run reported, and the account still shows nothing
    expect(r.state).toBe('FAILED'); expect(JSON.parse(r.op_results)[0].detail).toContain('la cuenta no lo muestra');
  });
  it('lets two different negatives of one campaign be approved in the same hour', async () => {
    const { core, s, approve, scriptRun } = setup();
    const first = await approve();
    const other = validateProposal(theme('cerca de mi'), s); if (!other.ok) throw new Error(other.errors.join('; '));
    const second = await approve(other.intent);
    expect([first.state, second.state]).toEqual(['UNKNOWN_OUTCOME', 'UNKNOWN_OUTCOME']);
    scriptRun();
    expect((await core.reconcileAll('google_ads_script'))).toEqual({ reconciled: 2, stillUnknown: 0 });
    expect(core.action(second.id)!.state).toBe('VERIFIED');
  });
  it('still stops a budget transfer after its first step', async () => {
    const { core, db, s, now } = setup();
    db.exec(`INSERT INTO campaign_registry (ref, account_id, kind, external_id, name, status, budget_id, budget_micros, updated_at) VALUES ('res_c111', 'g', 'campaign', '111', 'Tours EN', 'ENABLED', 'b1', ${M(500)}, 0), ('res_c222', 'g', 'campaign', '222', 'Restaurante', 'ENABLED', 'b2', ${M(300)}, 0)`);
    const v = validateProposal(proposal({ actionType: 'budget_reallocation', resourceRef: 'res_resto01', parameters: { toResourceRef: 'res_tours01', amountPctOfSource: 10 } }), s);
    if (!v.ok) throw new Error(v.errors.join('; '));
    const { action } = await core.propose(v.intent, 'owner', goodContext(s, now));
    core.approve(action.id, action.approval_hash, 'eric'); await core.execute(action.id, goodContext(s, now));
    expect(db.prepare('SELECT kind, budget_id FROM script_ops').all()).toEqual([{ kind: 'set_budget', budget_id: 'b2' }]);
  });
});

describe('a change waiting for the script', () => {
  const at = Date.UTC(2026, 10, 22, 18, 0);
  it('is not an alarm in its first two hours', () => { expect(queuedAlert(1, 'google_ads_script', at, at + 40 * 60_000)).toMatchObject({ severity: 'info', title: '1 cambio aprobado en cola para Google Ads' }); });
  it('becomes a warning when the script has clearly missed its turn', () => { expect(queuedAlert(2, 'google_ads_script', at, at + SCRIPT_LATE_MS + 3_700_000)).toMatchObject({ severity: 'warning', title: '2 cambios aprobados llevan 3 horas sin aplicarse' }); });
  it('stays critical for a provider that answers at once', () => { expect(queuedAlert(1, 'google_ads_api', at, at + 60_000).severity).toBe('critical'); });
});
