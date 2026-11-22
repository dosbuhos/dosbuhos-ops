// From what the script sends to a suggestion the owner can approve: the payload is stored, the rules read it, the
// snapshot carries it, and the server builds the exact change. Run against SQLite with every migration applied.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { FeedPayload, feedStatements, SCRIPT_VERSION } from '../src/connectors/google-ads-feed.ts';
import { detect, loadDetectInput, proposalFor } from '../src/read/detectors.ts';
import { buildSnapshot } from '../src/read/snapshot.ts';
import { validateProposal } from '../src/policy/validate.ts';
import { handledFindings, refusedRecently, loadResults, proposeFindings, findingsView, reviewNow, findingKey, keyOfFinding, actionTitle, type ActionLite } from '../src/read/suggestions.ts';
import { sqliteD1, liveCoordinator, goodContext, LIVE_POLICY } from './helpers.ts';

const MOFU = 'MOFU_Conversiones_Search_DB+Tribalo', NOW = Date.UTC(2026, 10, 22, 18, 0), TZ = 'America/Mexico_City';
const base = (over: Record<string, unknown> = {}) => ({
  schemaVersion: '1', generatedAt: '2026-11-22T18:00:00.000Z', account: { customerId: '1234567890', currency: 'MXN', timeZone: TZ, name: 'Cuenta de prueba' },
  campaigns: [{ id: '111', name: MOFU, status: 'ENABLED', channel: 'SEARCH', budgetId: '9', budgetMicros: 190e6, budgetShared: false, biddingStrategy: 'MAXIMIZE_CONVERSIONS' }],
  daily: [{ date: '2026-11-21', campaignId: '111', costMicros: 190e6, impressions: 900, clicks: 60, conversions: 1, conversionValue: 0 }],
  today: { date: '2026-11-22', costMicros: 50e6, maxHourlyMicros: 20e6, dataAsOf: '2026-11-22T18:00:00.000Z' }, monthToDateMicros: 4000e6,
  searchTerms: [{ campaignId: '111', from: '2026-10-25', to: '2026-11-22', term: 'viñedos en queretaro', matchType: 'EXACT', keyword: '', costMicros: 150e6, clicks: 49, conversions: 0 }],
  changes: [], ads: [{ id: '555', campaignId: '111', status: 'ENABLED' }],
  ...over,
});
const NEW = {
  scriptVersion: SCRIPT_VERSION, negativesComplete: true, keywordStats: { from: '2026-10-25', to: '2026-11-22' }, termsWindow: { from: '2026-10-25', to: '2026-11-22' }, warnings: [],
  negatives: [{ campaignId: '111', text: 'empleo', matchType: 'BROAD', level: 'list', scopeId: '7' }],
  keywords: [
    { campaignId: '111', adGroupId: '20', adGroupName: 'Querétaro', criterionId: '301', text: 'viñedos en queretaro', matchType: 'PHRASE', status: 'ENABLED', adGroupStatus: 'ENABLED', clicks: 100, costMicros: 300e6, impressions: 900, conversions: 0 },
    { campaignId: '111', adGroupId: '20', adGroupName: 'Querétaro', criterionId: '302', text: 'viñedos querétaro', matchType: 'EXACT', status: 'ENABLED', adGroupStatus: 'ENABLED', clicks: 10, costMicros: 30e6, impressions: 80, conversions: 0 },
    { campaignId: '111', adGroupId: '21', adGroupName: 'San Miguel', criterionId: '303', text: 'viñedos en san miguel de allende', matchType: 'EXACT', status: 'ENABLED', adGroupStatus: 'ENABLED', clicks: 260, costMicros: 520e6, impressions: 2000, conversions: 0 },
    { campaignId: '111', adGroupId: '21', adGroupName: 'San Miguel', criterionId: '304', text: 'vinos de queretaro', matchType: 'BROAD', status: 'PAUSED', adGroupStatus: 'ENABLED' },
    { campaignId: '111', adGroupId: '21', criterionId: 'not-a-number', text: 'x', matchType: 'EXACT', status: 'ENABLED' },
  ],
  termKeywords: [{ campaignId: '111', adGroupId: '20', criterionId: '301', term: 'viñedos queretaro', keyword: 'viñedos en queretaro', keywordMatchType: 'PHRASE', clicks: 40, costMicros: 120e6 }],
};

async function store(db: ReturnType<typeof sqliteD1>, payload: Record<string, unknown>, now: number) {
  const p = FeedPayload.parse(payload);
  for (const s of feedStatements(db.d1, 'g', p, now, new Set(['111']))) await (s as unknown as { run: () => Promise<unknown> }).run();
  return p;
}
function seeded() {
  const d = sqliteD1();
  d.db.exec(`INSERT INTO ad_accounts (id, provider, external_id, name, currency, account_tz, created_at) VALUES ('g', 'google_ads', '1234567890', 'g', 'MXN', '${TZ}', 0);
    INSERT OR REPLACE INTO connections (id, provider, purpose, health, updated_at) VALUES ('conn_google_ads_script', 'google_ads_script', 'x', 'connected', 0);`);
  const q = d.db.prepare('INSERT INTO ga4_ads_queries (date, campaign, query, sessions, opened, reservations, ad_clicks, ad_cost_micros, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)');
  for (let i = 1; i <= 28; i++) {
    const date = new Date(Date.UTC(2026, 9, 24 + i)).toISOString().slice(0, 10);          // 25 Oct .. 21 Nov
    q.run(date, MOFU, 'viñedos en queretaro', 1, 0, 0, 2, 6e6); q.run(date, MOFU, 'viñedos en querétaro', 0, 0, 0, 1, 3e6);
    q.run(date, MOFU, 'viñedos en san miguel de allende', 7, 0, 0, 8, 20e6); q.run(date, MOFU, 'bodega dos buhos', 11, 2, i % 4 === 0 ? 1 : 0, 13, 28e6);
  }
  return d;
}

describe('the script in this repository', () => {
  it('carries the version the app expects to see', () => {
    const src = readFileSync(new URL('../scripts/google-ads-feed.js', import.meta.url), 'utf8');
    expect(/var SCRIPT_VERSION = '([^']+)'/.exec(src)![1]).toBe(SCRIPT_VERSION);
    expect(src).toContain("var FEED_TOKEN = 'PASTE_TOKEN_HERE';");                        // the app fills the token into this exact line
  });
});

describe('storing what the script sends', () => {
  it('keeps keywords, the keyword behind each search and every negative, and drops only the row it cannot read', async () => {
    const d = seeded(), p = await store(d, base(NEW), NOW);
    expect(p.keywords!.bad).toBe(1);
    expect(d.db.prepare('SELECT criterion_id, text, match_type, status, clicks, cost_micros, stats_from FROM keywords_live ORDER BY criterion_id').all()).toEqual([
      { criterion_id: '301', text: 'viñedos en queretaro', match_type: 'PHRASE', status: 'ENABLED', clicks: 100, cost_micros: 300e6, stats_from: '2026-10-25' },
      { criterion_id: '302', text: 'viñedos querétaro', match_type: 'EXACT', status: 'ENABLED', clicks: 10, cost_micros: 30e6, stats_from: '2026-10-25' },
      { criterion_id: '303', text: 'viñedos en san miguel de allende', match_type: 'EXACT', status: 'ENABLED', clicks: 260, cost_micros: 520e6, stats_from: '2026-10-25' },
      { criterion_id: '304', text: 'vinos de queretaro', match_type: 'BROAD', status: 'PAUSED', clicks: 0, cost_micros: 0, stats_from: '2026-10-25' }]);
    expect(d.db.prepare('SELECT term, keyword, keyword_match_type, clicks, date_from FROM search_term_keywords').all()).toEqual([{ term: 'viñedos queretaro', keyword: 'viñedos en queretaro', keyword_match_type: 'PHRASE', clicks: 40, date_from: '2026-10-25' }]);
    expect(d.db.prepare('SELECT text, match_type, level, scope_id FROM negatives_live').all()).toEqual([{ text: 'empleo', match_type: 'BROAD', level: 'list', scope_id: '7' }]);
    const st = d.db.prepare('SELECT script_version, keywords_at, term_keywords_at, negatives_full_at, warnings_json FROM feed_state').get() as Record<string, unknown>;
    expect(st).toMatchObject({ script_version: SCRIPT_VERSION, keywords_at: NOW, term_keywords_at: NOW, negatives_full_at: NOW });
    expect(JSON.parse(String(st.warnings_json))).toEqual(['1 filas de palabras clave no se pudieron leer']);
  });
  it('replaces the live lists on each run and never leaves them half empty', async () => {
    const d = seeded();
    await store(d, base(NEW), NOW);
    await store(d, base({ ...NEW, keywords: NEW.keywords.slice(0, 1), negatives: [], termKeywords: [] }), NOW + 3_600_000);
    expect(d.db.prepare('SELECT criterion_id FROM keywords_live').all()).toEqual([{ criterion_id: '301' }]);
    expect(d.db.prepare('SELECT COUNT(*) AS n FROM negatives_live').get()).toEqual({ n: 0 });
    expect(d.db.prepare('SELECT COUNT(*) AS n FROM search_term_keywords').get()).toEqual({ n: 0 });
  });
  it('still accepts the older script, and then keeps what the newer one had sent', async () => {
    const d = seeded();
    await store(d, base(NEW), NOW);
    const old = await store(d, base({ negatives: [{ campaignId: '111', text: 'gratis' }], warnings: undefined }), NOW + 3_600_000);
    expect(old.keywords).toBeUndefined();
    expect(d.db.prepare('SELECT COUNT(*) AS n FROM keywords_live').get()).toEqual({ n: 4 });
    expect(d.db.prepare('SELECT text, match_type, level FROM negatives_live').all()).toEqual([{ text: 'gratis', match_type: 'EXACT', level: 'campaign' }]);
    expect(d.db.prepare('SELECT script_version, keywords_at, negatives_full_at FROM feed_state').get()).toEqual({ script_version: '', keywords_at: NOW, negatives_full_at: NOW });
  });
  it('keeps one copy of the search-term window, not one per day', async () => {
    const d = seeded();
    await store(d, base({ searchTerms: [{ campaignId: '111', from: '2026-10-10', to: '2026-11-07', term: 'viejo', matchType: 'BROAD', keyword: '', costMicros: 1e6, clicks: 1, conversions: 0 }] }), NOW - 15 * 86_400_000);
    await store(d, base(), NOW);
    expect(d.db.prepare('SELECT term FROM search_term_facts').all()).toEqual([{ term: 'viñedos en queretaro' }]);
  });
});

describe('from the stored feed to a change the owner can approve', () => {
  it('has nothing to approve while the feed carries no keywords', async () => {
    const d = seeded();
    await store(d, base(), NOW);
    const input = await loadDetectInput(d.d1, '2026-11-22');
    expect(input.keywords).toBeNull();
    const f = detect(input).find(x => x.query === 'queretaro')!;
    expect(f.action).toBeNull();
    expect(f.why[3]).toContain('coincide letra por letra');                               // read from the match type the older script already sends
    const { snapshot } = await buildSnapshot(d.d1, 'g', NOW, TZ, 14);
    expect(snapshot.keywords).toEqual({}); expect(snapshot.keywordList).toBeUndefined();
  });
  it('builds the exact change once the keywords arrive', async () => {
    const d = seeded();
    await store(d, base(NEW), NOW);
    const input = await loadDetectInput(d.d1, '2026-11-22');
    expect(input.keywords!.map(k => k.text)).toEqual(expect.arrayContaining(['viñedos en queretaro', 'viñedos querétaro']));
    expect(input.keywords!.some(k => k.text === 'vinos de queretaro')).toBe(false);        // a paused keyword is not an active one
    const f = detect(input).find(x => x.query === 'queretaro')!;
    expect(f.stats).toMatchObject({ clicks: 84, costMicros: 252e6 });
    expect(f.action).toEqual({ actionType: 'block_search_theme', text: 'queretaro' });
    const { snapshot } = await buildSnapshot(d.d1, 'g', NOW, TZ, 14);
    expect(snapshot.keywords['111']).toHaveLength(3);
    expect(snapshot.terms!['111']!.find(t => t.text === 'bodega dos buhos')).toMatchObject({ clicks: 364, reservations: 7 });
    expect(snapshot.negatives!['111']).toEqual([{ text: 'empleo', matchType: 'BROAD', level: 'list' }]);
    const v = validateProposal(proposalFor(f, snapshot.snapshotId, 'res_c111'), snapshot);
    if (!v.ok) throw new Error(v.errors.join('; '));
    expect(v.intent.operations.map(o => `${o.kind}:${'text' in o ? o.text : ''}`)).toEqual(['pause_keyword:viñedos en queretaro', 'pause_keyword:viñedos querétaro', 'add_negative_phrase:queretaro', 'add_negative_phrase:querétaro']);
    expect(v.intent.impact).toMatchObject({ searches: 2, clicks: 84, costMicros: 252e6 });
    expect(JSON.parse((d.db.prepare('SELECT json FROM snapshots').get() as { json: string }).json).keywordList['111']).toHaveLength(3);
  });
});

describe('what became of a finding, and what happened after', () => {
  const act = (over: Partial<ActionLite> & { text?: string }): ActionLite => ({ id: 'act_1', state: 'APPROVAL_REQUIRED', action_type: 'block_search_theme', created_at: NOW, updated_at: NOW,
    intent: { resourceRef: 'res_c111', resourceLabel: MOFU, proposal: { actionType: 'block_search_theme', parameters: { text: over.text ?? 'queretaro' } } }, ...over });
  const key = findingKey(MOFU, 'block_search_theme', 'Querétaro');
  it('tells waiting from done from declined, and lets an expired one come back', async () => {
    const d = seeded();
    expect((await handledFindings(d.d1, [act({})], NOW)).get(key)).toBe('waiting');
    expect((await handledFindings(d.d1, [act({ state: 'VERIFIED' })], NOW)).get(key)).toBe('done');
    expect((await handledFindings(d.d1, [act({ state: 'VERIFIED', updated_at: NOW - 40 * 86_400_000 })], NOW)).has(key)).toBe(false);
    expect((await handledFindings(d.d1, [act({ state: 'EXPIRED' })], NOW)).has(key)).toBe(false);
    expect((await handledFindings(d.d1, [act({ state: 'REJECTED' })], NOW)).has(key)).toBe(false);          // refused by policy, not by the owner
    d.db.prepare("INSERT INTO action_ledger_projection (event_id, account_id, action_id, action_type, actor, label, from_state, to_state, at, operations_json, detail_json, policy_version) VALUES ('e1', 'g', 'act_1', 'block_search_theme', 'model', ?, 'APPROVAL_REQUIRED', 'REJECTED', ?, '[]', ?, 2)")
      .run(MOFU, NOW, JSON.stringify({ reason: 'Ahora no: Quiero ver más datos', by: 'eric' }));
    expect((await handledFindings(d.d1, [act({ state: 'REJECTED' })], NOW)).get(key)).toBe('declined');
    expect((await handledFindings(d.d1, [act({ state: 'REJECTED' }), act({ id: 'act_2' })], NOW)).get(key)).toBe('waiting');
  });
  it('matches a finding to its action by campaign, kind of change and word', () => {
    const f = { campaign: MOFU, action: { actionType: 'block_search_theme' as const, text: 'queretaro' } } as Parameters<typeof keyOfFinding>[0];
    expect(keyOfFinding(f)).toBe(key);
    expect(actionTitle('block_search_theme', { text: 'queretaro' })).toBe('Dejar de pagar por búsquedas de Querétaro');
  });
  it('remembers for a week why the server would not build a suggestion', async () => {
    const d = seeded();
    d.db.prepare("INSERT INTO proposals (id, action_id, account_id, snapshot_id, run_key, raw_json, validation_errors_json, decision, model, created_at) VALUES ('p1', NULL, 'g', 's', 'r', ?, ?, 'invalid', 'reglas-fijas', ?)")
      .run(JSON.stringify({ resourceRef: 'res_c111', actionType: 'block_search_theme', parameters: { text: 'queretaro' } }), JSON.stringify(['detendría 40% de los clics de la campaña']), NOW - 86_400_000);
    expect((await refusedRecently(d.d1, NOW)).get(findingKey('res_c111', 'block_search_theme', 'queretaro'))).toEqual(['detendría 40% de los clics de la campaña']);
    expect((await refusedRecently(d.d1, NOW + 8 * 86_400_000)).size).toBe(0);
  });
  it('compares equal numbers of whole days before and after the change', async () => {
    const d = seeded();
    const q = d.db.prepare('INSERT INTO ga4_ads_queries (date, campaign, query, sessions, opened, reservations, ad_clicks, ad_cost_micros, fetched_at) VALUES (?, ?, ?, 0, 0, 0, ?, ?, 0)');
    q.run('2026-11-22', MOFU, 'viñedos en queretaro', 3, 9e6); q.run('2026-11-25', MOFU, 'viñedo en querétaro', 1, 3e6);
    const r = d.db.prepare("INSERT INTO ga4_reservations_daily (date, source, medium, campaign, event_name, events, fetched_at) VALUES (?, 'google', 'cpc', ?, 'ot-reservation-made', ?, 0)");
    r.run('2026-11-12', MOFU, 2); r.run('2026-11-20', MOFU, 1); r.run('2026-11-24', MOFU, 3);
    const applied = Date.UTC(2026, 10, 21, 20, 0);                                        // applied 21 Nov, local time
    const day = (n: number) => Date.UTC(2026, 10, n, 18, 0);
    const queued = (await loadResults(d.d1, [act({ state: 'UNKNOWN_OUTCOME' })], day(22), TZ))[0]!;
    expect(queued).toMatchObject({ stage: 'en_cola', title: 'Búsquedas de Querétaro' });
    const early = (await loadResults(d.d1, [act({ state: 'VERIFIED', updated_at: applied })], day(25), TZ))[0]!;      // 3 whole days: 22, 23, 24
    expect(early).toMatchObject({ stage: 'midiendo', daysMeasured: 3, before: { clicks: 9, costMicros: 27e6 }, after: { clicks: 3, costMicros: 9e6 }, verdict: 'sigue_entrando' });
    expect(early.lines[0]).toBe('Los 3 días de antes: 9 clics y MX$27. Los 3 días de después: 3 clics y MX$9.');
    const week = (await loadResults(d.d1, [act({ state: 'VERIFIED', updated_at: applied })], day(29), TZ))[0]!;       // 7 whole days: 22..28
    expect(week).toMatchObject({ stage: 'a7', daysMeasured: 7, before: { clicks: 21, costMicros: 63e6 }, after: { clicks: 4, costMicros: 12e6 }, reservationsBefore: 1, reservationsAfter: 3 });
    expect(week.lines).toEqual(['Los 7 días de antes: 21 clics y MX$63. Los 7 días de después: 4 clics y MX$12.', 'Reservaciones en línea de la campaña: 1 antes y 3 después.', 'Todavía entran: “viñedos en queretaro” (3 clics), “viñedo en querétaro” (1 clic).']);
    const clean = (await loadResults(d.d1, [act({ state: 'VERIFIED', updated_at: applied, text: 'san miguel de allende' })], day(29), TZ))[0]!;
    expect(clean.after).toEqual({ clicks: 0, costMicros: 0 }); expect(clean.verdict).toBe('funciona');
  });
});

describe('the rules submitting their findings', () => {
  async function setup(approved = ['111'], prepare = '') {
    const d = seeded();
    await store(d, base(NEW), NOW);
    d.db.exec(`UPDATE campaign_registry SET writable = 1, managed_by = 'app' WHERE external_id = '111'; ${prepare}`);
    const { snapshot } = await buildSnapshot(d.d1, 'g', NOW, TZ, 14);
    const live = liveCoordinator({ policy: { ...LIVE_POLICY, allowedAutomaticActions: [], approvedCampaignIds: ['111'] } });
    live.goLive();
    const actions = () => live.core.actions().map(a => ({ ...a, intent: JSON.parse(a.intent) })) as unknown as ActionLite[];
    const submit = async (raw: unknown) => {
      const v = validateProposal(raw, snapshot);
      if (!v.ok) return { accepted: false, errors: v.errors };
      const { action, decision } = await live.core.propose(v.intent, 'model', goodContext(snapshot, live.now));
      return { accepted: action.state !== 'REJECTED', actionId: action.id, state: action.state, reasons: decision.reasons };
    };
    const run = (runKey: string) => proposeFindings({ db: d.d1, accountKey: 'g', snapshot, actions: actions(), approved: new Set(approved), today: '2026-11-22', now: NOW, runKey, submit });
    const view = () => findingsView(d.d1, { actions: actions(), approved, today: '2026-11-22', now: NOW });
    return { d, live, snapshot, actions, run, view };
  }
  it('sends a finding for approval once, and the owner then sees a decision instead of advice', async () => {
    const { d, run, view } = await setup();
    expect((await view()).advice.map(a => [a.kind, a.actionable])).toEqual([['brand_split', false], ['theme_place', true]]);
    expect((await view()).advice[1]!.note).toContain('La revisión de mañana');
    expect(await run('r1')).toEqual({ summary: 'Reglas fijas: 2 hallazgos, 1 enviado para tu aprobación, 1 solo para revisar.', submitted: 1, found: 2 });
    const v = await view();
    expect(v.pending).toHaveLength(1);
    expect(v.pending[0]).toMatchObject({ title: 'Dejar de pagar por búsquedas de Querétaro', label: MOFU, actionType: 'block_search_theme', text: 'queretaro', impact: { searches: 2, clicks: 84, costMicros: 252e6 } });
    expect(v.advice.map(a => a.kind)).toEqual(['brand_split']);
    expect((await run('r2')).summary).toBe('Reglas fijas: 2 hallazgos, 0 enviados para tu aprobación, 1 ya esperaba tu decisión, 1 solo para revisar.');
    expect(d.db.prepare("SELECT model, decision FROM proposals").all()).toEqual([{ model: 'reglas-fijas', decision: 'APPROVAL_REQUIRED' }]);
  });
  it('does not bring back what the owner declined, and does bring back what expired unseen', async () => {
    const { d, live, actions, run, view } = await setup();
    await run('r1');
    const id = actions()[0]!.id;
    live.core.decline(id, 'eric', 'Quiero ver más datos');
    d.db.prepare("INSERT INTO action_ledger_projection (event_id, account_id, action_id, action_type, actor, label, from_state, to_state, at, operations_json, detail_json, policy_version) VALUES ('e1', 'g', ?, 'block_search_theme', 'model', ?, 'APPROVAL_REQUIRED', 'REJECTED', ?, '[]', ?, 2)")
      .run(id, MOFU, NOW, JSON.stringify({ reason: 'Ahora no: Quiero ver más datos' }));
    expect(await run('r2')).toMatchObject({ submitted: 0, summary: 'Reglas fijas: 2 hallazgos, 0 enviados para tu aprobación, 1 ya decidido, 1 solo para revisar.' });
    expect((await view()).advice.map(a => a.kind)).toEqual(['brand_split']);
    const again = await setup();
    await again.run('r1');
    again.live.advance(25 * 3_600_000); again.live.core.expireStale();
    expect(again.actions()[0]!.state).toBe('EXPIRED');
    expect((await again.run('r2')).submitted).toBe(1);
  });
  it('leaves a campaign outside the approved list as advice', async () => {
    const { run, view } = await setup([]);
    expect((await run('r1')).summary).toContain('1 en campañas fuera de tu lista aprobada');
    expect((await view()).advice.find(a => a.kind === 'theme_place')!.note).toContain('no está en tu lista');
  });
  it('explains what it cannot do with one tap, and does not try again every morning', async () => {
    const { d, run, view } = await setup(['111'], "DELETE FROM ga4_ads_queries WHERE query LIKE 'viñedos en san miguel%' OR query LIKE 'bodega%'");     // Querétaro is now all the campaign's clicks
    const first = await run('r1');
    expect(first.summary).toContain('1 que la app no puede hacer con un toque');
    const note = (await view()).advice.find(a => a.kind === 'theme_place')!;
    expect(note.note).toMatch(/^La app no lo puede hacer con un toque: detendría 100% de los clics/); expect(note.actionable).toBe(false);
    await run('r2');
    expect(d.db.prepare('SELECT COUNT(*) AS n FROM proposals').get()).toEqual({ n: 1 });
  });
});

describe('what the morning review reads about right now', () => {
  it('gets this month, the last 28 days per campaign and the findings with what became of each', async () => {
    const d = seeded();
    await store(d, base(NEW), NOW);
    const waiting: ActionLite = { id: 'act_1', state: 'APPROVAL_REQUIRED', action_type: 'block_search_theme', created_at: NOW, updated_at: NOW, intent: { resourceLabel: MOFU, proposal: { actionType: 'block_search_theme', parameters: { text: 'queretaro' } } } };
    const v = await reviewNow(d.d1, { now: NOW, tz: TZ, currency: 'MXN', policy: { monthlyAdSpendCeilingNative: 12_000, ceilingCoversWholeAccount: true, minimumAcceptableContributionReturn: 1.5 }, actions: [waiting] });
    expect(v.today).toBe('2026-11-22');
    expect(v.month).toMatchObject({ month: '2026-11', dayOfMonth: 22, daysInMonth: 30, ceilingPesos: 12_000, ceilingCovers: 'whole_account' });
    expect(v.month.spentPesos.google).toBe(190);                                          // the one day of spend in the feed, in whole pesos
    expect(v.last28Days.campaigns.map(c => [c.name, c.platform, c.spendPesos])).toEqual([[MOFU, 'Google', 190]]);
    expect(v.ruleFindings.map(f => [f.kind, f.status])).toEqual([['brand_split', 'advice_only'], ['theme_place', 'sent_waits_for_owner']]);
    expect(v.decisionsWaitingForOwner).toBe(1);
    expect((await reviewNow(d.d1, { now: NOW, tz: TZ, currency: 'MXN', policy: null, actions: [] })).ruleFindings[1]!.status).toBe('not_sent');
  });
});
