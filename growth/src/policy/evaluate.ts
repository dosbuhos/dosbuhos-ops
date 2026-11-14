// evaluatePolicy: the deterministic authorizer. Independent of the model — replacing or compromising the model cannot
// widen what this function allows. Every check is recorded so the owner can see exactly why something was decided.
import type { PolicyConfig, Mode } from '../domain/schemas.ts';
import type { ActionIntent, RegisteredResource, Snapshot } from './validate.ts';
import { projectExposure, GOOGLE_ADS_DEFAULT_BEHAVIOR, type SpendState, type PlatformSpendBehavior } from './exposure.ts';

export type Decision = 'authorized' | 'approval_required' | 'shadow_only' | 'rejected';
export interface Check { name: string; ok: boolean; detail: string; blocksAutomationOnly?: boolean }
export interface PolicyDecision { decision: Decision; checks: Check[]; reasons: string[]; policyVersion: number }

/** A budget change seen on the account — by this app, the owner, an agency, a script — from provider change history. */
export interface BudgetChangeRecord { budgetId: string; at: number; fromMicros: number; toMicros: number; source: 'app' | 'external' }

export type Actor = 'model' | 'owner' | 'watchdog';

export interface PolicyContext {
  now: number;
  mode: Mode;
  emergencyLock: boolean;
  aiStopped: boolean;
  actor: Actor;
  policy: PolicyConfig;
  policyVersion: number;
  snapshot: Snapshot;
  budgetHistory: BudgetChangeRecord[];        // last ≥ 7 days, all sources
  appMutationsLast24h: number;                // executed or in-flight optimization mutations
  baselineAggregateMicros: number | null;     // owner-approved aggregate daily budget of managed campaigns at go-live
  spend: SpendState | null;
  measurementMature: boolean;                 // acquisition cohorts for these campaigns are past their maturation lag
  capacity: { ok: boolean; reason: string } | null;
  contributionRoasByRef: Record<string, number | null>; // mature-cohort contribution ROAS per campaign ref
  unresolvedOutcomeOnResource: boolean;       // an UNKNOWN_OUTCOME action touches the same campaign/budget
  behavior?: PlatformSpendBehavior;
  daysRemainingInMonth: number;
}

const DAY = 86_400_000;
const isProtective = (i: ActionIntent) => i.actionType === 'pause_campaign';

/** Budget amount at the start of the rolling window: undo every change inside the window, newest first. */
export function budgetAtWindowStart(budgetId: string, current: number, history: readonly BudgetChangeRecord[], windowStart: number): number {
  const inWindow = history.filter(h => h.budgetId === budgetId && h.at >= windowStart).sort((a, b) => b.at - a.at);
  let amount = current;
  for (const h of inWindow) amount = h.fromMicros;
  return amount;
}

export function evaluatePolicy(intent: ActionIntent, ctx: PolicyContext): PolicyDecision {
  const checks: Check[] = [];
  const add = (name: string, ok: boolean, detail: string, blocksAutomationOnly = false) => checks.push({ name, ok, detail, ...(blocksAutomationOnly ? { blocksAutomationOnly } : {}) });
  const p = ctx.policy;
  const resources = intent.campaignIds.map(id => ctx.snapshot.resources.find(r => r.kind === 'campaign' && r.externalId === id)).filter((r): r is RegisteredResource => !!r);

  // ---- mode and locks ----
  const protectiveByOwner = isProtective(intent) && (ctx.actor === 'owner' || ctx.actor === 'watchdog');
  if (ctx.emergencyLock && !protectiveByOwner) add('emergency_lock', false, 'El bloqueo de emergencia está activo: se rechazan todos los cambios de crecimiento y optimización');
  if (ctx.aiStopped && ctx.actor === 'model') add('ai_stopped', false, 'El dueño detuvo los cambios de la IA');
  const modeOk: Record<Mode, boolean> = { DEMO: true, OBSERVE: false, SHADOW: true, LIMITED_AUTO: true, PAUSED: false, EMERGENCY_LOCK: protectiveByOwner };
  add('mode', modeOk[ctx.mode] || protectiveByOwner, `El modo de la cuenta es ${ctx.mode}`);
  if (ctx.snapshot.accountId !== intent.accountId) add('account_binding', false, 'La cuenta de la acción no coincide con la cuenta del coordinador');

  // ---- resource allowlist and controller ----
  for (const id of intent.campaignIds) {
    const r = resources.find(x => x.externalId === id);
    const allow = p.approvedCampaignIds.includes(id);
    add(`allowlist:${id}`, allow && !!r?.writable, allow ? (r?.writable ? `${r.label} está aprobada y se puede modificar` : `${r?.label ?? id} no está marcada como modificable`) : `La campaña ${id} no está en la lista aprobada`);
    if (r && r.managedBy !== 'app' && !protectiveByOwner) add(`controller:${id}`, false, `${r.label} la administra ${r.managedBy}; solo se permite un controlador del presupuesto`);
  }
  if (ctx.unresolvedOutcomeOnResource) add('unknown_outcome', false, 'Un cambio anterior a este recurso tiene un resultado desconocido; concílialo primero');

  // ---- protective pauses stop here: no spend, freshness or financial gates ----
  if (protectiveByOwner) return finish(checks, intent, ctx, true);

  // ---- explicit owner-only capabilities ----
  if (intent.spendIncreasing) {
    if (p.monthlyAdSpendCeilingNative === null) add('ceiling_set', false, 'No está definido el tope mensual de gasto en anuncios');
    if (p.minimumAcceptableContributionReturn === null) add('return_floor_set', false, 'No está definido el retorno mínimo aceptable de contribución');
    if (ctx.baselineAggregateMicros === null) add('baseline_set', false, 'No se ha aprobado la base del presupuesto total');
  }

  // ---- rate limits (rolling, cumulative, all sources) ----
  add('daily_mutation_limit', ctx.appMutationsLast24h < p.maxOptimizationMutationsPerDay, `${ctx.appMutationsLast24h} de ${p.maxOptimizationMutationsPerDay} cambios de optimización usados en las últimas 24 h`);

  const budgetOps = intent.operations.filter(o => o.kind === 'set_budget');
  for (const op of budgetOps) {
    if (op.kind !== 'set_budget') continue;
    const last = ctx.budgetHistory.filter(h => h.budgetId === op.budgetId).sort((a, b) => b.at - a.at)[0];
    const hoursSince = last ? (ctx.now - last.at) / 3_600_000 : Infinity;
    add(`min_interval:${op.budgetId}`, hoursSince >= p.minHoursBetweenBudgetChanges, last ? `Último cambio a este presupuesto hace ${hoursSince.toFixed(0)} h (${last.source}); mínimo ${p.minHoursBetweenBudgetChanges} h` : 'Sin cambios recientes a este presupuesto');
    const start = budgetAtWindowStart(op.budgetId, op.fromMicros, ctx.budgetHistory, ctx.now - 7 * DAY);
    const cumPct = start === 0 ? Infinity : (Math.abs(op.toMicros - start) / start) * 100;
    add(`rolling_7d:${op.budgetId}`, cumPct <= p.maxCampaignBudgetChangePctPer7Days + 1e-9, `El cambio acumulado vs. hace 7 días sería de ${Number.isFinite(cumPct) ? cumPct.toFixed(1) : '∞'}% (límite ${p.maxCampaignBudgetChangePctPer7Days}%), contando los cambios de cualquier persona`);
  }

  // ---- aggregate budget: distinct budgets counted once ----
  if (budgetOps.length && ctx.baselineAggregateMicros !== null) {
    const managed = new Map<string, number>();
    for (const r of ctx.snapshot.resources) if (r.kind === 'campaign' && r.budgetId && p.approvedCampaignIds.includes(r.externalId)) managed.set(r.budgetId, ctx.snapshot.budgets[r.budgetId]?.amountMicros ?? 0);
    for (const op of budgetOps) if (op.kind === 'set_budget') managed.set(op.budgetId, op.toMicros);
    const after = [...managed.values()].reduce((a, b) => a + b, 0);
    const limit = Math.floor(ctx.baselineAggregateMicros * (1 + p.maxTotalBudgetBaselineIncreasePct / 100));
    add('aggregate_budget', after <= limit, `Presupuestos diarios administrados después del cambio: ${(after / 1e6).toFixed(0)}; permitido: ${(limit / 1e6).toFixed(0)} (base + ${p.maxTotalBudgetBaselineIncreasePct}%)`);
  }

  // ---- spend freshness and exposure ----
  if (intent.spendIncreasing) {
    const s = ctx.spend;
    const ageMin = s ? (ctx.now - s.dataAsOf) / 60_000 : Infinity;
    add('fresh_spend', !!s && ageMin <= p.maxSpendDataAgeMinutes, s ? `Los datos de gasto tienen ${ageMin.toFixed(0)} min de antigüedad (máx. ${p.maxSpendDataAgeMinutes})` : 'No hay lectura de gasto');
    if (s && p.monthlyAdSpendCeilingNative !== null) {
      const managed = new Map<string, number>();
      for (const r of ctx.snapshot.resources) if (r.kind === 'campaign' && r.budgetId) managed.set(r.budgetId, ctx.snapshot.budgets[r.budgetId]?.amountMicros ?? 0);
      for (const op of budgetOps) if (op.kind === 'set_budget') managed.set(op.budgetId, op.toMicros);
      const ex = projectExposure({ monthToDateSpendMicros: s.monthToDateMicros, spendDataAgeMinutes: ageMin, daysRemainingInMonth: ctx.daysRemainingInMonth, managedDailyBudgetsMicros: [...managed.values()], unmanagedDailyBudgetsMicros: s.unmanagedDailyBudgetsMicros, observedMaxHourlySpendMicros: s.observedMaxHourlyMicros, behavior: ctx.behavior ?? GOOGLE_ADS_DEFAULT_BEHAVIOR });
      const ceiling = p.monthlyAdSpendCeilingNative * 1_000_000;
      const reserve = 1 - p.spendReservePct / 100;
      add('exposure_expected', ex.expectedMonthMicros <= ceiling * reserve, `Gasto esperado del mes ${(ex.expectedMonthMicros / 1e6).toFixed(0)} vs. tope ${p.monthlyAdSpendCeilingNative} menos ${p.spendReservePct}% de reserva`);
      add('exposure_worst_case', ex.worstCaseMonthMicros <= ceiling, `Gasto del mes en el peor caso ${(ex.worstCaseMonthMicros / 1e6).toFixed(0)} vs. tope ${p.monthlyAdSpendCeilingNative}`);
      if (p.ceilingCoversWholeAccount !== true) add('ceiling_scope', true, 'No está confirmado que el tope cubra toda la cuenta; las campañas no administradas se incluyen en la proyección, pero la app no las puede pausar');
    }
  }

  // ---- measurement and capacity for scaling ----
  if (intent.spendIncreasing) {
    add('mature_measurement', ctx.measurementMature, ctx.measurementMature ? 'Las cohortes de adquisición ya maduraron' : 'Las cohortes recientes todavía están madurando; aún no se escala por rentabilidad');
    add('capacity', !!ctx.capacity?.ok, ctx.capacity?.reason ?? 'No hay información de capacidad para el horizonte de reservación');
    const destRef = intent.actionType === 'budget_reallocation' ? (intent.proposal.parameters as { toResourceRef?: string }).toResourceRef ?? intent.resourceRef : intent.resourceRef;
    const roas = ctx.contributionRoasByRef[destRef] ?? null;
    if (p.minimumAcceptableContributionReturn !== null) add('return_floor', roas !== null && roas >= p.minimumAcceptableContributionReturn, roas === null ? 'El ROAS de contribución de esta campaña es desconocido' : `ROAS de contribución maduro ${roas.toFixed(2)} vs. mínimo ${p.minimumAcceptableContributionReturn}`);
  }

  // ---- automation scope (failing this means "ask the owner", not "refuse") ----
  add('automatic_action_allowed', p.allowedAutomaticActions.includes(intent.actionType), p.allowedAutomaticActions.includes(intent.actionType) ? `${intent.actionType} se permite en automático` : `${intent.actionType} necesita la aprobación del dueño`, true);
  return finish(checks, intent, ctx, false);
}

function finish(checks: Check[], _intent: ActionIntent, ctx: PolicyContext, protective: boolean): PolicyDecision {
  const hard = checks.filter(c => !c.ok && !c.blocksAutomationOnly);
  const soft = checks.filter(c => !c.ok && c.blocksAutomationOnly);
  const reasons = [...hard, ...soft].map(c => c.detail);
  let decision: Decision;
  if (hard.length) decision = 'rejected';
  else if (ctx.mode === 'SHADOW' && !protective) decision = 'shadow_only';
  else if (soft.length) decision = 'approval_required'; // the coordinator accepts this only with a bound owner approval
  else decision = 'authorized';
  return { decision, checks, reasons, policyVersion: ctx.policyVersion };
}
