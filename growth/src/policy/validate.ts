// validateProposal: turns untrusted model output into a server-computed ActionIntent, or rejects it.
// The model never supplies account IDs, external IDs, amounts in micros, or before/after values; it supplies a
// registered resource reference and bounded parameters, and every evidence reference must exist in the snapshot it saw.
import { ActionParameters, ModelProposal, type ActionType } from '../domain/schemas.ts';
import { scaleMicros, micros, type Currency } from '../domain/money.ts';
import type { Product } from '../domain/measurement.ts';

export interface RegisteredResource {
  ref: string;                       // res_… — server-issued, stable
  kind: 'campaign' | 'ad';
  accountId: string;                 // provider account (customer) ID
  externalId: string;                // provider resource ID
  campaignId: string;                // for ads: parent campaign
  budgetId: string | null;           // campaign budget resource; shared budgets have several campaigns
  budgetShared: boolean;
  label: string;
  products: Product[];
  bookingHorizonDays: number;
  brand: boolean;
  writable: boolean;                 // registry flag; also must be in the policy allowlist
  managedBy: 'app' | 'owner' | 'agency' | 'script' | 'unknown'; // only one budget controller per campaign
}

export interface Evidence { id: string; metric: string; window: { from: string; to: string }; value: number | null; resourceRef: string | null; provisional: boolean }

export interface Snapshot {
  snapshotId: string;
  accountId: string;
  currency: Currency;
  createdAt: number;
  resources: RegisteredResource[];
  budgets: Record<string, { amountMicros: number; campaignIds: string[] }>;
  keywords: Record<string, string[]>;         // campaignId → active positive keyword texts (for negative conflict checks)
  evidence: Record<string, Evidence>;
}

export type Operation =
  | { kind: 'set_budget'; budgetId: string; fromMicros: number; toMicros: number }
  | { kind: 'pause_ad'; adId: string; campaignId: string }
  | { kind: 'add_negative_exact'; campaignId: string; text: string }
  | { kind: 'pause_campaign'; campaignId: string };

export interface ActionIntent {
  actionType: ActionType;
  accountId: string;
  currency: Currency;
  resourceRef: string;
  resourceLabel: string;
  campaignIds: string[];
  operations: Operation[];          // in execution order (reallocation: decrease first)
  spendIncreasing: boolean;
  snapshotId: string;
  evidenceRefs: string[];
  proposal: ModelProposal;
}

export type ValidationResult = { ok: true; intent: ActionIntent } | { ok: false; errors: string[] };

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

export function validateProposal(raw: unknown, snapshot: Snapshot): ValidationResult {
  const parsed = ModelProposal.safeParse(raw);
  if (!parsed.success) return { ok: false, errors: parsed.error.issues.map(i => `${i.path.join('.') || 'proposal'}: ${i.message}`) };
  const p = parsed.data;
  const errors: string[] = [];
  if (p.snapshotId !== snapshot.snapshotId) errors.push('snapshotId does not match the evidence snapshot this run was given');
  for (const e of p.evidenceRefs) if (!snapshot.evidence[e]) errors.push(`evidence ${e} is not in the snapshot`);
  const res = snapshot.resources.find(r => r.ref === p.resourceRef);
  if (!res) errors.push('resourceRef is not a registered resource');
  if (res && res.accountId !== snapshot.accountId) errors.push('resource belongs to another account');
  const paramSchema = ActionParameters[p.actionType];
  const params = paramSchema.safeParse(p.parameters);
  if (!params.success) errors.push(...params.error.issues.map(i => `parameters.${i.path.join('.')}: ${i.message}`));
  if (errors.length || !res || !params.success) return { ok: false, errors };

  const base = { actionType: p.actionType, accountId: snapshot.accountId, currency: snapshot.currency, resourceRef: res.ref, resourceLabel: res.label, snapshotId: snapshot.snapshotId, evidenceRefs: p.evidenceRefs, proposal: p };
  const budgetOf = (r: RegisteredResource) => (r.budgetId ? snapshot.budgets[r.budgetId] : undefined);

  switch (p.actionType) {
    case 'campaign_budget_change': {
      if (res.kind !== 'campaign' || !res.budgetId) return { ok: false, errors: ['budget change needs a campaign with a budget'] };
      const b = budgetOf(res);
      if (!b) return { ok: false, errors: ['campaign budget not in snapshot'] };
      const pct = (params.data as { changePct: number }).changePct;
      const to = scaleMicros(micros(snapshot.currency, b.amountMicros), Math.round((100 + pct) * 100), 10_000).micros;
      if (to === b.amountMicros) return { ok: false, errors: ['change rounds to no change'] };
      return { ok: true, intent: { ...base, campaignIds: b.campaignIds, operations: [{ kind: 'set_budget', budgetId: res.budgetId, fromMicros: b.amountMicros, toMicros: to }], spendIncreasing: to > b.amountMicros } };
    }
    case 'budget_reallocation': {
      const prm = params.data as { toResourceRef: string; amountPctOfSource: number };
      const dest = snapshot.resources.find(r => r.ref === prm.toResourceRef);
      if (!dest || dest.kind !== 'campaign' || !dest.budgetId || !res.budgetId || res.kind !== 'campaign') return { ok: false, errors: ['reallocation needs two registered campaigns with budgets'] };
      if (dest.budgetId === res.budgetId) return { ok: false, errors: ['source and destination share one budget; reallocation would do nothing'] };
      const src = budgetOf(res), dst = budgetOf(dest);
      if (!src || !dst) return { ok: false, errors: ['budget not in snapshot'] };
      const moveRaw = scaleMicros(micros(snapshot.currency, src.amountMicros), Math.round(prm.amountPctOfSource * 100), 10_000).micros;
      if (moveRaw <= 0) return { ok: false, errors: ['amount rounds to zero'] };
      return { ok: true, intent: { ...base, campaignIds: [...src.campaignIds, ...dst.campaignIds], spendIncreasing: true, operations: [
        { kind: 'set_budget', budgetId: res.budgetId, fromMicros: src.amountMicros, toMicros: src.amountMicros - moveRaw },
        { kind: 'set_budget', budgetId: dest.budgetId, fromMicros: dst.amountMicros, toMicros: dst.amountMicros + moveRaw },
      ] } };
    }
    case 'pause_ad':
      if (res.kind !== 'ad') return { ok: false, errors: ['pause_ad needs an ad resource'] };
      return { ok: true, intent: { ...base, campaignIds: [res.campaignId], spendIncreasing: false, operations: [{ kind: 'pause_ad', adId: res.externalId, campaignId: res.campaignId }] } };
    case 'add_negative_keyword_exact': {
      if (res.kind !== 'campaign') return { ok: false, errors: ['negative keywords attach to a campaign'] };
      const text = norm((params.data as { text: string }).text);
      const known = snapshot.keywords[res.campaignId];
      if (!known) return { ok: false, errors: ['active keywords for this campaign are not in the snapshot, so conflicts cannot be checked'] };
      const kws = known.map(norm);
      const conflict = kws.find(k => k === text || ` ${k} `.includes(` ${text} `));
      if (conflict) return { ok: false, errors: [`negative "${text}" would block active keyword "${conflict}"`] };
      return { ok: true, intent: { ...base, campaignIds: [res.campaignId], spendIncreasing: false, operations: [{ kind: 'add_negative_exact', campaignId: res.campaignId, text }] } };
    }
    case 'pause_campaign':
      if (res.kind !== 'campaign') return { ok: false, errors: ['pause_campaign needs a campaign'] };
      return { ok: true, intent: { ...base, campaignIds: [res.campaignId], spendIncreasing: false, operations: [{ kind: 'pause_campaign', campaignId: res.campaignId }] } };
  }
}
