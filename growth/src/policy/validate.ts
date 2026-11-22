// validateProposal: turns untrusted model output into a server-computed ActionIntent, or rejects it.
// The model never supplies account IDs, external IDs, amounts in micros, or before/after values; it supplies a
// registered resource reference and bounded parameters, and every evidence reference must exist in the snapshot it saw.
import { ActionParameters, ModelProposal, type ActionType } from '../domain/schemas.ts';
import { scaleMicros, micros, type Currency } from '../domain/money.ts';
import type { Product } from '../domain/measurement.ts';
import { canon, fold, hasPhrase, blocks, surfaceForms, namesUs, isProtectedTheme, type MatchType } from '../domain/keywords.ts';

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

/** An active keyword of a campaign with its own numbers for the snapshot's search window. */
export interface SnapshotKeyword { text: string; matchType: MatchType; adGroupId: string; criterionId: string; adGroupName: string; clicks: number; costMicros: number; conversionsMilli: number }
/** A search people typed, with what it cost and what it brought in the snapshot's search window. */
export interface SnapshotTerm { text: string; clicks: number; costMicros: number; opened: number; reservations: number }
export interface SnapshotNegative { text: string; matchType: MatchType; level: 'campaign' | 'ad_group' | 'list' }

export interface Snapshot {
  snapshotId: string;
  accountId: string;
  currency: Currency;
  createdAt: number;
  resources: RegisteredResource[];
  budgets: Record<string, { amountMicros: number; campaignIds: string[] }>;
  keywords: Record<string, string[]>;         // campaignId → active positive keyword texts (for negative conflict checks)
  // The three below arrive with the newer account feed. Without them a theme cannot be blocked: its impact cannot be measured.
  keywordList?: Record<string, SnapshotKeyword[]>;   // campaignId → the same active keywords, with ids and numbers
  terms?: Record<string, SnapshotTerm[]>;            // campaignId → searches of the last 28 days
  negatives?: Record<string, SnapshotNegative[]>;    // campaignId → negative keywords that already apply to it
  termsWindow?: { from: string; to: string };
  evidence: Record<string, Evidence>;
}

export type Operation =
  | { kind: 'set_budget'; budgetId: string; fromMicros: number; toMicros: number }
  | { kind: 'pause_ad'; adId: string; campaignId: string }
  | { kind: 'add_negative_exact'; campaignId: string; text: string }
  | { kind: 'add_negative_phrase'; campaignId: string; text: string }
  | { kind: 'pause_keyword'; campaignId: string; adGroupId: string; criterionId: string; text: string; matchType: MatchType }
  | { kind: 'pause_campaign'; campaignId: string };

/** What a theme block would have stopped in the snapshot's window. Computed by the server, shown to the owner before approving. */
export interface ThemeImpact {
  theme: string; window: { from: string; to: string } | null;
  searches: number; clicks: number; costMicros: number; opened: number; reservations: number; clickSharePct: number;
  top: { text: string; clicks: number; costMicros: number }[];
  keywords: { text: string; matchType: MatchType; clicks: number; costMicros: number }[];
  negatives: string[];
}
/** A theme may take at most this share of a campaign's clicks. Above it, the change is too big for one tap. */
export const MAX_THEME_CLICK_SHARE = 0.25;
export const MAX_THEME_KEYWORDS = 20, MAX_THEME_NEGATIVES = 4;

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
  impact?: ThemeImpact;             // block_search_theme only
}

export type ValidationResult = { ok: true; intent: ActionIntent } | { ok: false; errors: string[] };


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
      if (res.kind !== 'campaign') return { ok: false, errors: ['una palabra clave negativa se agrega a una campaña'] };
      // Sent to Google as typed, accents included: to Google "queretaro" and "querétaro" are different negatives.
      const text = canon((params.data as { text: string }).text), folded = fold(text);
      const known = snapshot.keywords[res.campaignId];
      if (!known) return { ok: false, errors: ['la app todavía no recibe las palabras clave activas de esta campaña, así que no puede comprobar que la negativa no choque con una'] };
      if (!folded) return { ok: false, errors: ['la palabra clave negativa está vacía'] };
      if (namesUs(folded)) return { ok: false, errors: [`“${text}” lleva nuestro nombre`] };
      const conflict = known.map(fold).find(k => k === folded || hasPhrase(k, folded));
      if (conflict) return { ok: false, errors: [`la negativa “${text}” bloquearía la palabra clave activa “${conflict}”`] };
      if ((snapshot.negatives?.[res.campaignId] ?? []).some(n => blocks(n, text))) return { ok: false, errors: [`“${text}” ya está bloqueada por una palabra clave negativa de la campaña`] };
      return { ok: true, intent: { ...base, campaignIds: [res.campaignId], spendIncreasing: false, operations: [{ kind: 'add_negative_exact', campaignId: res.campaignId, text }] } };
    }
    case 'block_search_theme': {
      if (res.kind !== 'campaign') return { ok: false, errors: ['un tema de búsqueda se bloquea en una campaña'] };
      const theme = fold((params.data as { text: string }).text);
      const list = snapshot.keywordList?.[res.campaignId], terms = snapshot.terms?.[res.campaignId];
      if (!list || !terms) return { ok: false, errors: ['la app todavía no recibe las palabras clave de esta campaña, así que no puede medir qué se bloquearía'] };
      if (theme.replace(/ /g, '').length < 4) return { ok: false, errors: ['la palabra es demasiado corta para bloquearla sin riesgo'] };
      if (isProtectedTheme(theme)) return { ok: false, errors: [`“${theme}” es nuestro nombre o nuestro pueblo; eso nunca se bloquea`] };
      // Everything the negative could stop, compared without accents on purpose: the widest reading of its reach.
      const affected = terms.filter(t => hasPhrase(fold(t.text), theme)).sort((a, b) => b.costMicros - a.costMicros);
      if (!affected.length) return { ok: false, errors: [`ninguna búsqueda de los últimos 28 días contiene “${theme}”`] };
      const ours = affected.find(t => namesUs(fold(t.text)));
      if (ours) return { ok: false, errors: [`bloquearía “${ours.text}”, que lleva nuestro nombre`] };
      const reserved = affected.find(t => t.reservations > 0);
      if (reserved) return { ok: false, errors: [`bloquearía “${reserved.text}”, que trajo ${reserved.reservations} ${reserved.reservations === 1 ? 'reservación' : 'reservaciones'} en línea en esos 28 días`] };
      const sum = (xs: SnapshotTerm[], f: (t: SnapshotTerm) => number) => xs.reduce((a, t) => a + f(t), 0);
      const clicks = sum(affected, t => t.clicks), allClicks = sum(terms, t => t.clicks);
      const share = allClicks > 0 ? clicks / allClicks : 1;
      if (share > MAX_THEME_CLICK_SHARE) return { ok: false, errors: [`detendría ${Math.round(share * 100)}% de los clics de la campaña; un cambio de ese tamaño no se decide con un toque`] };
      const kws = list.filter(k => hasPhrase(fold(k.text), theme));
      if (kws.length > MAX_THEME_KEYWORDS) return { ok: false, errors: [`${kws.length} palabras clave contienen “${theme}”; tantas no se pausan en una sola decisión`] };
      const converting = kws.find(k => k.conversionsMilli > 0);
      if (converting) return { ok: false, errors: [`la palabra clave “${converting.text}” tiene conversiones en Google Ads en esos 28 días`] };
      // The negative is added the way people actually write it, most clicked form first; never a form nobody typed.
      const forms = new Map<string, number>();
      for (const t of affected) for (const f of surfaceForms(t.text, theme)) forms.set(f, (forms.get(f) ?? 0) + t.clicks);
      for (const k of kws) for (const f of surfaceForms(k.text, theme)) forms.set(f, forms.get(f) ?? 0);
      const existing = (snapshot.negatives?.[res.campaignId] ?? []).filter(n => n.level !== 'ad_group' && n.matchType !== 'EXACT');
      const add = [...forms].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([f]) => f).filter(f => /^[\p{L}\p{N} '&.-]+$/u.test(f) && !existing.some(n => canon(n.text) === f || (fold(n.text) !== fold(f) && blocks(n, f)))).slice(0, MAX_THEME_NEGATIVES);
      const operations: Operation[] = [
        ...kws.map(k => ({ kind: 'pause_keyword' as const, campaignId: res.campaignId, adGroupId: k.adGroupId, criterionId: k.criterionId, text: canon(k.text), matchType: k.matchType })),
        ...add.map(text => ({ kind: 'add_negative_phrase' as const, campaignId: res.campaignId, text })),
      ];
      if (!operations.length) return { ok: false, errors: [`no queda nada por hacer con “${theme}”: ninguna palabra clave la contiene y ya es negativa`] };
      const impact: ThemeImpact = {
        theme, window: snapshot.termsWindow ?? null, searches: affected.length, clicks, costMicros: sum(affected, t => t.costMicros), opened: sum(affected, t => t.opened), reservations: 0,
        clickSharePct: Math.round(share * 1000) / 10, top: affected.slice(0, 8).map(t => ({ text: t.text, clicks: t.clicks, costMicros: t.costMicros })),
        keywords: kws.map(k => ({ text: canon(k.text), matchType: k.matchType, clicks: k.clicks, costMicros: k.costMicros })), negatives: add,
      };
      return { ok: true, intent: { ...base, campaignIds: [res.campaignId], spendIncreasing: false, operations, impact } };
    }
    case 'pause_campaign':
      if (res.kind !== 'campaign') return { ok: false, errors: ['pause_campaign needs a campaign'] };
      return { ok: true, intent: { ...base, campaignIds: [res.campaignId], spendIncreasing: false, operations: [{ kind: 'pause_campaign', campaignId: res.campaignId }] } };
  }
}
