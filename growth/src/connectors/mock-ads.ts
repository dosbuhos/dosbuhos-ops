// Mock ad provider for DEMO, local dev and failure-mode tests. Holds account state in memory (or in a persisted JSON
// blob for the demo coordinator). Failure injection lets tests lose a response after the change is applied, fail
// definitively, or change state "externally" as an owner or agency would.
import { ProviderError, type AdsProvider, type EntityStatus } from './ads-provider.ts';

export interface MockAccountState {
  budgets: Record<string, number>;
  campaigns: Record<string, EntityStatus>;
  ads: Record<string, EntityStatus>;
  negatives: Record<string, string[]>;
}

export type Fault = { op: 'setBudget' | 'setCampaignStatus' | 'setAdStatus' | 'addNegativeExact'; target?: string; mode: 'apply_then_lose_response' | 'reject' | 'timeout_before_apply' | 'auth' };

export class MockAdsProvider implements AdsProvider {
  readonly kind = 'mock' as const;
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
  async readNegatives(a: string, c: string) { this.check(a); return [...(this.state.negatives[c] ?? [])]; }

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
  addNegativeExact(a: string, c: string, t: string, k: string) { this.check(a); return this.mutate('addNegativeExact', c, t, k, () => { const l = this.state.negatives[c] ?? []; if (!l.includes(t)) l.push(t); this.state.negatives[c] = l; }); }
}
