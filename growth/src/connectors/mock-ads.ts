// Mock ad provider for DEMO, local dev and failure-mode tests. Holds account state in memory (or in a persisted JSON
// blob for the demo coordinator). Failure injection lets tests lose a response after the change is applied, fail
// definitively, or change state "externally" as an owner or agency would.
import { ProviderError, sameKeywordText, type AdsProvider, type EntityStatus, type KeywordRef, type NegativeMatch } from './ads-provider.ts';

export interface MockAccountState {
  budgets: Record<string, number>;
  campaigns: Record<string, EntityStatus>;
  ads: Record<string, EntityStatus>;
  negatives: Record<string, string[]>;                 // exact negatives per campaign
  phraseNegatives?: Record<string, string[]>;          // phrase negatives per campaign
  keywords?: Record<string, EntityStatus>;             // by "adGroupId~criterionId"
}

export type Fault = { op: 'setBudget' | 'setCampaignStatus' | 'setAdStatus' | 'addNegative' | 'setKeywordStatus'; target?: string; mode: 'apply_then_lose_response' | 'reject' | 'timeout_before_apply' | 'auth' };

export class MockAdsProvider implements AdsProvider {
  readonly kind = 'mock' as const;
  readonly deferred = false;
  readonly calls: { op: string; target: string; value: unknown; key: string }[] = [];
  private faults: Fault[] = [];
  constructor(public state: MockAccountState, readonly accountId: string) {}

  inject(f: Fault): void { this.faults.push(f); }
  private fault(op: Fault['op'], target: string): Fault | undefined {
    const i = this.faults.findIndex(f => f.op === op && (!f.target || f.target === target));
    if (i < 0) return undefined;
    return this.faults.splice(i, 1)[0];
  }
  private check(accountId: string): void { if (accountId !== this.accountId) throw new ProviderError('rejected', 'Unknown account'); }

  async readBudgets(a: string, ids: string[]) { this.check(a); return Object.fromEntries(ids.filter(i => i in this.state.budgets).map(i => [i, this.state.budgets[i]!])); }
  async readCampaignStatus(a: string, ids: string[]) { this.check(a); return Object.fromEntries(ids.filter(i => i in this.state.campaigns).map(i => [i, this.state.campaigns[i]!])); }
  async readAdStatus(a: string, ids: string[]) { this.check(a); return Object.fromEntries(ids.filter(i => i in this.state.ads).map(i => [i, this.state.ads[i]!])); }
  private negatives(c: string, m: NegativeMatch): string[] { return m === 'EXACT' ? (this.state.negatives[c] ??= []) : ((this.state.phraseNegatives ??= {})[c] ??= []); }
  async hasNegative(a: string, c: string, t: string, m: NegativeMatch) { this.check(a); return ((m === 'EXACT' ? this.state.negatives[c] : this.state.phraseNegatives?.[c]) ?? []).some(x => sameKeywordText(x, t)); }
  async readKeywordStatus(a: string, ks: KeywordRef[]) { this.check(a); const all = this.state.keywords ?? {}; return Object.fromEntries(ks.map(k => `${k.adGroupId}~${k.criterionId}`).filter(k => k in all).map(k => [k, all[k]!])); }

  private async mutate(op: Fault['op'], target: string, value: unknown, key: string, apply: () => void): Promise<void> {
    const f = this.fault(op, target);
    if (f?.mode === 'auth') throw new ProviderError('auth', 'Credentials revoked');
    if (f?.mode === 'reject') throw new ProviderError('rejected', 'Provider rejected the operation');
    if (f?.mode === 'timeout_before_apply') throw new ProviderError('ambiguous', 'Timed out');
    // Idempotency: the same key applied twice is a no-op (as a provider-side request ID would be).
    if (!this.calls.some(c => c.key === key)) apply();
    this.calls.push({ op, target, value, key });
    if (f?.mode === 'apply_then_lose_response') throw new ProviderError('ambiguous', 'Connection reset after send');
  }

  setBudget(a: string, id: string, v: number, k: string) { this.check(a); if (!(id in this.state.budgets)) throw new ProviderError('rejected', 'No such budget'); return this.mutate('setBudget', id, v, k, () => { this.state.budgets[id] = v; }); }
  setCampaignStatus(a: string, id: string, s: 'ENABLED' | 'PAUSED', k: string) { this.check(a); if (!(id in this.state.campaigns)) throw new ProviderError('rejected', 'No such campaign'); return this.mutate('setCampaignStatus', id, s, k, () => { this.state.campaigns[id] = s; }); }
  setAdStatus(a: string, id: string, s: 'ENABLED' | 'PAUSED', k: string) { this.check(a); if (!(id in this.state.ads)) throw new ProviderError('rejected', 'No such ad'); return this.mutate('setAdStatus', id, s, k, () => { this.state.ads[id] = s; }); }
  addNegative(a: string, c: string, t: string, m: NegativeMatch, k: string) { this.check(a); return this.mutate('addNegative', c, `${m}:${t}`, k, () => { const l = this.negatives(c, m); if (!l.some(x => sameKeywordText(x, t))) l.push(t); }); }
  setKeywordStatus(a: string, kw: KeywordRef & { campaignId: string; text: string }, s: 'ENABLED' | 'PAUSED', k: string) {
    this.check(a); const id = `${kw.adGroupId}~${kw.criterionId}`;
    if (!this.state.keywords || !(id in this.state.keywords)) throw new ProviderError('rejected', 'No such keyword');
    return this.mutate('setKeywordStatus', id, s, k, () => { this.state.keywords![id] = s; });
  }
}
