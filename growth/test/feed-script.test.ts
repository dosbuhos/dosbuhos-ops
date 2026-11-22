// The Google Ads Script cannot be run outside Google Ads, so it is run here against a stand-in for the Google Ads
// objects it uses. What is checked: the payload it builds is one the server accepts, a query Google refuses costs
// only its own section, and each approved change calls the right thing on the right entity (or refuses to).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { FeedPayload } from '../src/connectors/google-ads-feed.ts';

const SOURCE = readFileSync(new URL('../scripts/google-ads-feed.js', import.meta.url), 'utf8');

type Row = Record<string, unknown>;
interface Fake {
  rows: Record<string, Row[]>;                 // by the resource after FROM
  fail?: string[];                             // resources whose query throws
  ops?: Row[];                                 // what GET /ops returns
  preview?: boolean;
  keywords?: Record<string, { text: string; enabled: boolean; calls: string[] }>;   // "adGroupId~criterionId"
  campaignNegatives?: { text: string; matchType: string; removed?: boolean }[];
}

function run(fake: Fake) {
  const posts: { url: string; body: any }[] = [], created: string[] = [], logs: string[] = [], queries: string[] = [];
  const iter = <T,>(list: T[]) => { let i = 0; return { hasNext: () => i < list.length, next: () => list[i++]! }; };
  const fmt = (d: Date, _tz: string, f: string) => { const local = new Date(d.getTime() - 6 * 3600_000).toISOString(); return f === 'yyyy-MM-dd' ? local.slice(0, 10) : `${local.slice(0, 10)} ${local.slice(11, 19)}`; };
  const campaign = { createNegativeKeyword: (t: string) => { created.push(t); }, isEnabled: () => true, pause: () => {}, negativeKeywords: () => ({ get: () => iter((fake.campaignNegatives ?? []).map(n => ({ getText: () => (n.matchType === 'EXACT' ? `[${n.text}]` : n.matchType === 'PHRASE' ? `"${n.text}"` : n.text), getMatchType: () => n.matchType, remove: () => { n.removed = true; } }))) }) };
  const AdsApp = {
    getExecutionInfo: () => ({ isPreview: () => !!fake.preview }),
    currentAccount: () => ({ getTimeZone: () => 'America/Mexico_City', getCustomerId: () => '123-456-7890', getCurrencyCode: () => 'MXN', getName: () => 'Dos Búhos' }),
    search: (q: string) => {
      queries.push(q);
      const from = / FROM (\w+)/.exec(q)![1]!;
      const key = from === 'shared_criterion' && q.includes('ACCOUNT_LEVEL') ? 'shared_criterion_account' : from === 'customer' && q.includes('segments.hour') ? 'customer_hourly' : from;
      if (fake.fail?.includes(key)) throw new Error(`QueryError: ${key} is not available`);
      return iter(fake.rows[key] ?? []);
    },
    campaigns: () => ({ withIds: (ids: number[]) => ({ get: () => iter(ids[0] === 111 ? [campaign] : []) }) }),
    keywords: () => ({ withIds: (ids: number[][]) => ({ get: () => { const k = fake.keywords?.[`${ids[0]![0]}~${ids[0]![1]}`]; return iter(k ? [{ getText: () => k.text, isEnabled: () => k.enabled, isPaused: () => !k.enabled, pause: () => { k.enabled = false; k.calls.push('pause'); }, enable: () => { k.enabled = true; k.calls.push('enable'); } }] : []); } }) }),
    budgets: () => ({ withIds: () => ({ get: () => iter([]) }) }),
    ads: () => ({ withCondition: () => ({ get: () => iter([]) }) }),
  };
  const UrlFetchApp = { fetch: (url: string, opts: any) => {
    const body = opts.payload ? JSON.parse(opts.payload) : null;
    posts.push({ url, body });
    const text = url.includes('/ops?') ? JSON.stringify({ ops: fake.ops ?? [] }) : '{"ok":true}';
    return { getResponseCode: () => 200, getContentText: () => text };
  } };
  const Utilities = { formatDate: fmt, parseDate: (s: string) => new Date(`${s.replace(' ', 'T')}-06:00`) };
  const Logger = { log: (m: unknown) => { logs.push(String(m)); } };
  new Function('AdsApp', 'UrlFetchApp', 'Utilities', 'Logger', `${SOURCE}\nmain();`)(AdsApp, UrlFetchApp, Utilities, Logger);
  const feed = posts.find(p => p.url.endsWith('/api/feed/google-ads'))!;
  const results = posts.find(p => p.url.endsWith('/ops') && p.body)?.body?.results as { id: string; status: string; detail: string }[] | undefined;
  return { payload: feed.body, results, created, logs, queries };
}

const kwRow = (adGroupId: number, criterionId: number, text: string, matchType: string, negative = false, status = 'ENABLED') =>
  ({ campaign: { id: 111 }, adGroup: { id: adGroupId, name: 'Viñedos', status: 'ENABLED' }, adGroupCriterion: { criterionId, keyword: { text, matchType }, status, negative } });
const BASE: Fake['rows'] = {
  campaign: [{ campaign: { id: 111, name: 'MOFU', status: 'ENABLED', advertisingChannelType: 'SEARCH', biddingStrategyType: 'MAXIMIZE_CONVERSIONS' }, campaignBudget: { id: 9, amountMicros: 190_000_000, explicitlySharedd: false }, segments: { date: '2026-11-21' }, metrics: { costMicros: 5_000_000, impressions: 90, clicks: 4, conversions: 0, conversionsValue: 0 } }],
  customer: [{ metrics: { costMicros: 5_000_000 } }],
  customer_hourly: [{ segments: { hour: 10 }, metrics: { costMicros: 2_000_000 } }],
  search_term_view: [{ campaign: { id: 111 }, adGroup: { id: 20 }, searchTermView: { searchTerm: 'viñedos queretaro' }, segments: { searchTermMatchType: 'NEAR_EXACT', keyword: { info: { text: 'viñedos en queretaro', matchType: 'PHRASE' }, adGroupCriterion: 'customers/1234567890/adGroupCriteria/20~301' } }, metrics: { costMicros: 128_100_000, clicks: 46, conversions: 0 } }],
  change_event: [],
  ad_group_ad: [{ adGroupAd: { ad: { id: 555 }, status: 'ENABLED' }, campaign: { id: 111 } }],
  campaign_criterion: [{ campaign: { id: 111 }, campaignCriterion: { keyword: { text: 'empleo', matchType: 'BROAD' } } }],
  ad_group_criterion: [kwRow(20, 301, 'viñedos en queretaro', 'PHRASE'), kwRow(20, 302, 'viñedos en san miguel de allende', 'EXACT'), kwRow(20, 303, 'gratis', 'PHRASE', true), kwRow(21, 304, 'vinos', 'BROAD', false, 'PAUSED')],
  keyword_view: [{ adGroup: { id: 20 }, adGroupCriterion: { criterionId: 301 }, metrics: { clicks: 99, costMicros: 281_000_000, impressions: 900, conversions: 0 } }],
  campaign_shared_set: [{ campaign: { id: 111 }, sharedSet: { id: 7 } }],
  shared_criterion: [{ sharedSet: { id: 7 }, sharedCriterion: { keyword: { text: 'trabajo', matchType: 'PHRASE' } } }],
  shared_criterion_account: [{ sharedSet: { id: 8 }, sharedCriterion: { keyword: { text: 'porno', matchType: 'BROAD' } } }],
};

describe('the Google Ads Script, run against a stand-in account', () => {
  it('builds a payload the server accepts, with keywords, the keyword behind each search and every kind of negative', () => {
    const { payload } = run({ rows: BASE });
    const parsed = FeedPayload.safeParse(payload);
    expect(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues.slice(0, 3))).toBe(true);
    const p = parsed.data!;
    expect(p.scriptVersion).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
    expect(p.keywords!.bad).toBe(0);
    expect(p.keywords!.ok.map(k => [k.text, k.matchType, k.status, k.clicks, k.costMicros])).toEqual([
      ['viñedos en queretaro', 'PHRASE', 'ENABLED', 99, 281_000_000], ['viñedos en san miguel de allende', 'EXACT', 'ENABLED', 0, 0], ['vinos', 'BROAD', 'PAUSED', 0, 0]]);
    expect(p.termKeywords!.ok).toEqual([{ campaignId: '111', adGroupId: '20', criterionId: '301', term: 'viñedos queretaro', keyword: 'viñedos en queretaro', keywordMatchType: 'PHRASE', clicks: 46, costMicros: 128_100_000 }]);
    expect(p.negatives!.ok.map(n => `${n.level}:${n.matchType}:${n.text}`).sort()).toEqual(['ad_group:PHRASE:gratis', 'campaign:BROAD:empleo', 'list:BROAD:porno', 'list:PHRASE:trabajo']);
    expect(p.negativesComplete).toBe(true);
    expect(p.warnings).toEqual([]);
    expect(p.keywordStats).toEqual(p.termsWindow);
  });

  it('still sends the spend numbers when Google refuses a new query, and says which one', () => {
    const { payload } = run({ rows: BASE, fail: ['ad_group_criterion', 'campaign_shared_set'] });
    const p = FeedPayload.parse(payload);
    expect(p.daily).toHaveLength(1);
    expect(p.keywords).toBeUndefined();
    expect(p.termKeywords!.ok).toHaveLength(1);
    expect(p.negativesComplete).toBe(false);
    expect(p.warnings!.map(w => w.split(':')[0])).toEqual(['palabras clave', 'listas de negativas']);
  });

  it('keeps the keywords when only their numbers are refused', () => {
    const p = FeedPayload.parse(run({ rows: BASE, fail: ['keyword_view'] }).payload);
    expect(p.keywords!.ok).toHaveLength(3);
    expect(p.warnings![0]).toContain('números de las palabras clave');
  });

  it('applies an approved keyword pause and both kinds of negative, and reports each', () => {
    const keywords = { '20~301': { text: '"viñedos en queretaro"', enabled: true, calls: [] as string[] } };
    const { results, created } = run({ rows: BASE, keywords, ops: [
      { id: 'a', kind: 'pause_keyword', campaign_id: '111', ad_group_id: '20', criterion_id: '301', text: 'viñedos en queretaro' },
      { id: 'b', kind: 'add_negative_phrase', campaign_id: '111', text: 'querétaro' },
      { id: 'c', kind: 'add_negative_exact', campaign_id: '111', text: 'viñedo tres raices' },
    ] });
    expect(results!.map(r => [r.id, r.status])).toEqual([['a', 'applied'], ['b', 'applied'], ['c', 'applied']]);
    expect(keywords['20~301'].calls).toEqual(['pause']);
    expect(created).toEqual(['"querétaro"', '[viñedo tres raices]']);            // accents are sent as typed
  });

  it('refuses to pause a keyword that is no longer the one approved, is already paused, or does not exist', () => {
    const keywords = { '20~301': { text: 'bodega dos buhos', enabled: true, calls: [] as string[] }, '20~302': { text: '[viñedos]', enabled: false, calls: [] as string[] } };
    const { results } = run({ rows: BASE, keywords, ops: [
      { id: 'a', kind: 'pause_keyword', ad_group_id: '20', criterion_id: '301', text: 'viñedos en queretaro' },
      { id: 'b', kind: 'pause_keyword', ad_group_id: '20', criterion_id: '302', text: 'viñedos' },
      { id: 'c', kind: 'pause_keyword', ad_group_id: '20', criterion_id: '999', text: 'x' },
      { id: 'd', kind: 'pause_campaign', campaign_id: '999' },
      { id: 'e', kind: 'something_new' },
    ] });
    expect(results!.map(r => r.status)).toEqual(['skipped', 'skipped', 'failed', 'failed', 'failed']);
    expect(keywords['20~301'].calls).toEqual([]);
  });

  it('knows how to undo: reactivates a paused keyword and removes a negative of the campaign', () => {
    const keywords = { '20~301': { text: 'viñedos en queretaro', enabled: false, calls: [] as string[] } };
    const campaignNegatives: NonNullable<Fake['campaignNegatives']> = [{ text: 'querétaro', matchType: 'PHRASE' }, { text: 'querétaro', matchType: 'EXACT' }];
    const { results } = run({ rows: BASE, keywords, campaignNegatives, ops: [
      { id: 'a', kind: 'enable_keyword', ad_group_id: '20', criterion_id: '301', text: 'viñedos en queretaro' },
      { id: 'b', kind: 'remove_negative', campaign_id: '111', text: 'querétaro', match_type: 'PHRASE' },
      { id: 'c', kind: 'remove_negative', campaign_id: '111', text: 'no existe', match_type: 'PHRASE' },
    ] });
    expect(results!.map(r => r.status)).toEqual(['applied', 'applied', 'skipped']);
    expect(keywords['20~301'].calls).toEqual(['enable']);
    expect(campaignNegatives.map(n => !!n.removed)).toEqual([true, false]);
  });

  it('changes nothing in a preview run', () => {
    const keywords = { '20~301': { text: 'viñedos en queretaro', enabled: true, calls: [] as string[] } };
    const { results, payload } = run({ rows: BASE, keywords, preview: true, ops: [{ id: 'a', kind: 'pause_keyword', ad_group_id: '20', criterion_id: '301', text: 'viñedos en queretaro' }] });
    expect(results).toBeUndefined(); expect(keywords['20~301'].calls).toEqual([]); expect(FeedPayload.safeParse(payload).success).toBe(true);
  });
});
