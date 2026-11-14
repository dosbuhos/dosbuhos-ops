// CoordinatorCore — the single authority, per ad account, for autonomy mode, emergency lock, policy version, action
// state, resource reservations and idempotency. It is the only code that calls AdsProvider write methods.
//
// Invariants:
//  * Every state transition and its outbox event commit in one storage transaction.
//  * A pending action and its reservations are persisted BEFORE any external write; reservations are held until the
//    outcome is known, so an UNKNOWN_OUTCOME blocks conflicting changes until reconciliation.
//  * The emergency lock and mode are re-read immediately before each provider call.
//  * Retries never repeat a mutation blindly: an ambiguous outcome is reconciled by reading provider state.
//  * Compensation only runs if the provider still matches the after-state this app applied.
import type { SqlStore } from './sql.ts';
import { COORDINATOR_SCHEMA, one } from './sql.ts';
import { assertTransition, type ActionState } from './states.ts';
import { ProviderError, type AdsProvider } from '../connectors/ads-provider.ts';
import { PolicyConfig, DEFAULT_POLICY, type Mode } from '../domain/schemas.ts';
import { evaluatePolicy, type Actor, type BudgetChangeRecord, type PolicyContext, type PolicyDecision } from '../policy/evaluate.ts';
import type { ActionIntent, Operation, Snapshot } from '../policy/validate.ts';

export type ExternalContext = Pick<PolicyContext, 'snapshot' | 'spend' | 'measurementMature' | 'capacity' | 'contributionRoasByRef' | 'daysRemainingInMonth'> & { behavior?: PolicyContext['behavior'] };
export type ContextSource = (intent: ActionIntent) => Promise<ExternalContext>;

export interface ActionRow {
  id: string; idem_key: string; state: ActionState; action_type: string; actor: Actor; intent: string; decision: string;
  approval_hash: string; approved_by: string | null; approved_at: number | null; expires_at: number; policy_version: number;
  before_state: string | null; op_results: string; created_at: number; updated_at: number;
}
export interface OpResult { index: number; status: 'applied' | 'failed' | 'unknown' | 'not_attempted' | 'compensated'; detail?: string }
export interface OutboxEvent { eventId: string; accountId: string; actionId: string; from: ActionState | null; to: ActionState; at: number; detail: Record<string, unknown>; action: { type: string; actor: string; label: string; operations: Operation[]; policyVersion: number } }

export interface CoordinatorState {
  accountId: string; mode: Mode; emergencyLock: boolean; aiStopped: boolean; restoredLocked: boolean;
  policyVersion: number; policy: PolicyConfig; baselineAggregateMicros: number | null; providerKind: AdsProvider['kind'];
  activeReservations: number; unknownOutcomes: number; suspensions: { resourceKey: string; reason: string; at: number }[];
}

export class CoordinatorError extends Error { constructor(public readonly code: string, message: string) { super(message); } }

const enc = new TextEncoder();
async function sha256(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', enc.encode(s));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}
/** Canonical JSON: sorted keys, so equal intents hash equally. */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v as object).sort().map(k => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(v);
}

const resourceKeys = (ops: readonly Operation[]): string[] => [...new Set(ops.flatMap(o => {
  switch (o.kind) {
    case 'set_budget': return [`budget:${o.budgetId}`];
    case 'pause_campaign': return [`campaign:${o.campaignId}`];
    case 'pause_ad': return [`ad:${o.adId}`, `campaign:${o.campaignId}:ads`];
    case 'add_negative_exact': return [`campaign:${o.campaignId}:negatives`];
  }
}))];

export interface CoreOptions { provider: AdsProvider; now?: () => number; environment: 'dev' | 'demo' | 'staging' | 'production' }

export class CoordinatorCore {
  private readonly provider: AdsProvider;
  private readonly now: () => number;
  constructor(private readonly sql: SqlStore, opts: CoreOptions) {
    // Demo and dev can only ever hold the mock provider; staging/production can never hold it.
    const mockEnv = opts.environment === 'dev' || opts.environment === 'demo';
    if (mockEnv !== (opts.provider.kind === 'mock')) throw new CoordinatorError('provider_environment_mismatch', `El proveedor ${opts.provider.kind} no se permite en ${opts.environment}`);
    this.provider = opts.provider;
    this.now = opts.now ?? Date.now;
    for (const q of COORDINATOR_SCHEMA) this.sql.run(q);
  }

  // ---------------- key/value state ----------------
  private get(k: string): string | undefined { return one(this.sql.all<{ v: string }>('SELECT v FROM kv WHERE k = ?', k))?.v; }
  private put(k: string, v: string): void { this.sql.run('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v', k, v); }

  initialize(accountId: string, initialMode: Mode, actor: string): void {
    const existing = this.get('account_id');
    if (existing && existing !== accountId) throw new CoordinatorError('account_mismatch', 'Este coordinador está ligado a otra cuenta');
    if (existing) return;
    if (initialMode === 'DEMO' && this.provider.kind !== 'mock') throw new CoordinatorError('demo_requires_mock', 'DEMO mode requires the mock provider');
    this.sql.tx(() => {
      this.put('account_id', accountId);
      this.put('mode', initialMode);
      this.put('emergency_lock', '0');
      this.put('ai_stopped', '0');
      this.put('restored_locked', '0');
      this.sql.run('INSERT INTO policy_versions (version, json, created_at, created_by) VALUES (1, ?, ?, ?)', JSON.stringify({ ...DEFAULT_POLICY, mode: initialMode }), this.now(), actor);
      this.put('policy_version', '1');
    });
  }

  private accountId(): string { const a = this.get('account_id'); if (!a) throw new CoordinatorError('not_initialized', 'El coordinador no está inicializado'); return a; }
  mode(): Mode { return (this.get('mode') ?? 'OBSERVE') as Mode; }
  policyVersion(): number { return Number(this.get('policy_version') ?? 1); }
  policy(): PolicyConfig {
    const row = one(this.sql.all<{ json: string }>('SELECT json FROM policy_versions WHERE version = ?', this.policyVersion()));
    // The mode lives in coordinator state (kv), not in the policy document; the copy in policy is informational.
    return PolicyConfig.parse({ ...(row ? JSON.parse(row.json) : DEFAULT_POLICY), mode: this.mode() });
  }

  state(): CoordinatorState {
    const b = this.get('baseline_aggregate_micros');
    return {
      accountId: this.accountId(), mode: this.mode(), emergencyLock: this.get('emergency_lock') === '1', aiStopped: this.get('ai_stopped') === '1',
      restoredLocked: this.get('restored_locked') === '1', policyVersion: this.policyVersion(), policy: this.policy(),
      baselineAggregateMicros: b ? Number(b) : null, providerKind: this.provider.kind,
      activeReservations: Number(one(this.sql.all<{ n: number }>('SELECT COUNT(*) AS n FROM reservations'))?.n ?? 0),
      unknownOutcomes: Number(one(this.sql.all<{ n: number }>("SELECT COUNT(*) AS n FROM actions WHERE state IN ('UNKNOWN_OUTCOME','RECONCILING')"))?.n ?? 0),
      suspensions: this.sql.all<{ resource_key: string; reason: string; at: number }>('SELECT resource_key, reason, at FROM suspensions').map(s => ({ resourceKey: s.resource_key, reason: s.reason, at: s.at })),
    };
  }

  // ---------------- owner controls (no model involvement) ----------------

  setPolicy(next: unknown, actor: string): number {
    const parsed = PolicyConfig.parse(next);
    if (parsed.mode !== this.mode()) throw new CoordinatorError('mode_via_policy', 'Cambia el modo con el control de modo, no editando la política');
    const v = this.policyVersion() + 1;
    this.sql.tx(() => {
      this.sql.run('INSERT INTO policy_versions (version, json, created_at, created_by) VALUES (?, ?, ?, ?)', v, JSON.stringify(parsed), this.now(), actor);
      this.put('policy_version', String(v));
      this.audit('policy_changed', actor, { version: v });
    });
    return v;
  }

  setBaseline(micros: number, actor: string): void {
    if (!Number.isSafeInteger(micros) || micros <= 0) throw new CoordinatorError('bad_baseline', 'La base debe ser un número entero positivo de micros');
    this.sql.tx(() => { this.put('baseline_aggregate_micros', String(micros)); this.audit('baseline_set', actor, { micros }); });
  }

  /** Go-live and other mode changes. LIMITED_AUTO needs a concrete, complete policy and the owner's confirmation of
   *  the exact policy version they previewed. */
  setMode(mode: Mode, actor: string, confirm?: { policyVersion: number }): void {
    const s = this.state();
    if (s.restoredLocked) throw new CoordinatorError('restored_locked', 'Se restauró el almacenamiento; primero concilia el estado real');
    if (mode === 'DEMO' && this.provider.kind !== 'mock') throw new CoordinatorError('demo_requires_mock', 'El modo Demo solo existe con el proveedor simulado');
    if (mode === 'LIMITED_AUTO') {
      const p = s.policy;
      const missing: string[] = [];
      if (p.monthlyAdSpendCeilingNative === null) missing.push('tope mensual de gasto en anuncios');
      if (p.ceilingCoversWholeAccount === null) missing.push('si el tope cubre toda la cuenta');
      if (p.minimumAcceptableContributionReturn === null) missing.push('retorno mínimo de contribución');
      if (!p.approvedCampaignIds.length) missing.push('campañas aprobadas');
      if (p.protectiveStopPctOfCeiling === null) missing.push('umbral del paro de protección');
      if (s.baselineAggregateMicros === null) missing.push('base del presupuesto total');
      if (missing.length) throw new CoordinatorError('policy_incomplete', `No se puede activar Automático limitado: define ${missing.join(', ')}`);
      if (!confirm || confirm.policyVersion !== s.policyVersion) throw new CoordinatorError('confirm_policy', 'Confirma la versión exacta de la política que se muestra en la vista previa');
    }
    this.sql.tx(() => {
      this.put('mode', mode);
      if (mode === 'EMERGENCY_LOCK') this.put('emergency_lock', '1');
      this.audit('mode_changed', actor, { from: s.mode, to: mode, policyVersion: s.policyVersion });
    });
  }

  setEmergencyLock(on: boolean, actor: string): void {
    if (!on && this.get('restored_locked') === '1') throw new CoordinatorError('restored_locked', 'Se restauró el almacenamiento; primero concilia el estado real');
    this.sql.tx(() => {
      this.put('emergency_lock', on ? '1' : '0');
      if (!on && this.mode() === 'EMERGENCY_LOCK') this.put('mode', 'PAUSED'); // unlocking lands in PAUSED, never straight into automation
      this.audit(on ? 'emergency_lock_on' : 'emergency_lock_off', actor, {});
    });
  }

  /** "Stop AI changes": no model-originated actions run. Ads keep running; that is the separate pause control. */
  setAiStopped(on: boolean, actor: string): void {
    this.sql.tx(() => {
      this.put('ai_stopped', on ? '1' : '0');
      if (on) for (const a of this.sql.all<ActionRow>("SELECT * FROM actions WHERE actor = 'model' AND state IN ('APPROVAL_REQUIRED','APPROVED')")) this.transition(a, 'REJECTED', { reason: 'El dueño detuvo los cambios de la IA' });
      this.audit(on ? 'ai_stopped' : 'ai_resumed', actor, {});
    });
  }

  clearSuspension(resourceKey: string, actor: string): void {
    this.sql.tx(() => { this.sql.run('DELETE FROM suspensions WHERE resource_key = ?', resourceKey); this.audit('suspension_cleared', actor, { resourceKey }); });
  }

  private audit(kind: string, actor: string, detail: Record<string, unknown>): void {
    const eventId = crypto.randomUUID();
    const at = this.now();
    this.sql.run('INSERT INTO outbox (event_id, payload, created_at) VALUES (?, ?, ?)', eventId, JSON.stringify({ eventId, accountId: this.accountId(), kind, actor, at, detail }), at);
  }

  // ---------------- proposals ----------------

  private budgetHistory(since: number): BudgetChangeRecord[] {
    return this.sql.all<{ budget_id: string; at: number; from_micros: number; to_micros: number; source: 'app' | 'external' }>('SELECT budget_id, at, from_micros, to_micros, source FROM budget_changes WHERE at >= ?', since)
      .map(r => ({ budgetId: r.budget_id, at: r.at, fromMicros: r.from_micros, toMicros: r.to_micros, source: r.source }));
  }
  /** Record a budget change seen in provider change history (by anyone). Idempotent per (budget, at, to). */
  recordExternalBudgetChange(c: Omit<BudgetChangeRecord, 'source'>): void {
    const dup = this.sql.all('SELECT 1 FROM budget_changes WHERE budget_id = ? AND at = ? AND to_micros = ?', c.budgetId, c.at, c.toMicros);
    if (!dup.length) this.sql.run('INSERT INTO budget_changes (budget_id, at, from_micros, to_micros, source) VALUES (?, ?, ?, ?, ?)', c.budgetId, c.at, c.fromMicros, c.toMicros, 'external');
  }
  private appMutationsLast24h(exceptActionId?: string): number {
    const since = this.now() - 86_400_000;
    const executed = Number(one(this.sql.all<{ n: number }>("SELECT COUNT(DISTINCT e.action_id) AS n FROM action_events e JOIN actions a ON a.id = e.action_id WHERE e.to_state = 'EXECUTING' AND e.at >= ? AND a.action_type != 'pause_campaign'", since))?.n ?? 0);
    const preparing = Number(one(this.sql.all<{ n: number }>("SELECT COUNT(*) AS n FROM actions WHERE state = 'PREPARING' AND action_type != 'pause_campaign' AND id != ?", exceptActionId ?? ''))?.n ?? 0);
    return executed + preparing;
  }
  private blockedResource(ops: readonly Operation[], exceptActionId?: string): boolean {
    for (const k of resourceKeys(ops)) {
      const r = one(this.sql.all<{ action_id: string }>('SELECT action_id FROM reservations WHERE resource_key = ?', k));
      if (r && r.action_id !== exceptActionId) return true;
      if (this.sql.all('SELECT 1 FROM suspensions WHERE resource_key = ?', k).length) return true;
    }
    return false;
  }

  private fullContext(intent: ActionIntent, ext: ExternalContext, actor: Actor, exceptActionId?: string): PolicyContext {
    const s = this.state();
    return {
      ...ext, now: this.now(), mode: s.mode, emergencyLock: s.emergencyLock, aiStopped: s.aiStopped, actor, policy: s.policy, policyVersion: s.policyVersion,
      budgetHistory: this.budgetHistory(this.now() - 8 * 86_400_000), appMutationsLast24h: this.appMutationsLast24h(exceptActionId),
      baselineAggregateMicros: s.baselineAggregateMicros, unresolvedOutcomeOnResource: this.blockedResource(intent.operations, exceptActionId),
    };
  }

  /** Submit a validated intent. Returns the existing action for a duplicate submission (same canonical intent). */
  async propose(intent: ActionIntent, actor: Actor, context: ContextSource): Promise<{ action: ActionRow; decision: PolicyDecision; duplicate: boolean }> {
    if (intent.accountId !== this.accountId()) throw new CoordinatorError('account_mismatch', 'La propuesta es para otra cuenta');
    const idem = await sha256(canonical({ accountId: intent.accountId, operations: intent.operations, snapshotId: intent.snapshotId }));
    const existing = one(this.sql.all<ActionRow>('SELECT * FROM actions WHERE idem_key = ?', idem));
    if (existing) return { action: existing, decision: JSON.parse(existing.decision) as PolicyDecision, duplicate: true };
    const decision = evaluatePolicy(intent, this.fullContext(intent, await context(intent), actor));
    const id = `act_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
    const policyVersion = this.policyVersion();
    const approvalHash = await sha256(canonical({ id, operations: intent.operations, policyVersion }));
    const now = this.now();
    const expires = now + this.policy().proposalExpiryHours * 3_600_000;
    const row: ActionRow = { id, idem_key: idem, state: 'PROPOSED', action_type: intent.actionType, actor, intent: JSON.stringify(intent), decision: JSON.stringify(decision), approval_hash: approvalHash, approved_by: null, approved_at: null, expires_at: expires, policy_version: policyVersion, before_state: null, op_results: '[]', created_at: now, updated_at: now };
    this.sql.tx(() => {
      this.sql.run(`INSERT INTO actions (id, idem_key, state, action_type, actor, intent, decision, approval_hash, expires_at, policy_version, op_results, created_at, updated_at)
        VALUES (?, ?, 'PROPOSED', ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?)`, id, idem, intent.actionType, actor, row.intent, row.decision, approvalHash, expires, policyVersion, now, now);
      this.event(row, null, 'PROPOSED', { decision: decision.decision });
      const to: ActionState = decision.decision === 'rejected' ? 'REJECTED' : decision.decision === 'shadow_only' ? 'SHADOWED' : decision.decision === 'approval_required' ? 'APPROVAL_REQUIRED' : 'APPROVED';
      this.transition(row, to, { reasons: decision.reasons });
    });
    return { action: this.action(id)!, decision, duplicate: false };
  }

  action(id: string): ActionRow | undefined { return one(this.sql.all<ActionRow>('SELECT * FROM actions WHERE id = ?', id)); }
  actions(limit = 100): ActionRow[] { return this.sql.all<ActionRow>('SELECT * FROM actions ORDER BY created_at DESC LIMIT ?', limit); }

  /** Owner approval bound to the exact action, operations and policy version the owner saw. */
  approve(id: string, approvalHash: string, approver: string): ActionRow {
    const a = this.action(id);
    if (!a) throw new CoordinatorError('not_found', 'No existe esa acción');
    if (a.state !== 'APPROVAL_REQUIRED') throw new CoordinatorError('bad_state', `La acción está en ${a.state}`);
    if (a.approval_hash !== approvalHash) throw new CoordinatorError('approval_mismatch', 'La aprobación no coincide con esta acción');
    if (a.policy_version !== this.policyVersion()) throw new CoordinatorError('policy_changed', 'La política cambió desde que se propuso; vuelve a proponer');
    if (this.now() > a.expires_at) { this.sql.tx(() => this.transition(a, 'EXPIRED', {})); throw new CoordinatorError('expired', 'La propuesta venció'); }
    this.sql.tx(() => {
      this.sql.run('UPDATE actions SET approved_by = ?, approved_at = ? WHERE id = ?', approver, this.now(), id);
      this.transition({ ...a, approved_by: approver }, 'APPROVED', { approver });
    });
    return this.action(id)!;
  }

  expireStale(): number {
    const rows = this.sql.all<ActionRow>("SELECT * FROM actions WHERE state IN ('APPROVAL_REQUIRED','APPROVED') AND expires_at < ?", this.now());
    this.sql.tx(() => { for (const r of rows) this.transition(r, 'EXPIRED', {}); });
    return rows.length;
  }

  // ---------------- execution ----------------

  private async readLive(ops: readonly Operation[]): Promise<Record<string, unknown>> {
    const acct = this.accountId();
    const live: Record<string, unknown> = {};
    const budgets = ops.flatMap(o => (o.kind === 'set_budget' ? [o.budgetId] : []));
    if (budgets.length) for (const [k, v] of Object.entries(await this.provider.readBudgets(acct, budgets))) live[`budget:${k}`] = v;
    const camps = ops.flatMap(o => (o.kind === 'pause_campaign' ? [o.campaignId] : []));
    if (camps.length) for (const [k, v] of Object.entries(await this.provider.readCampaignStatus(acct, camps))) live[`campaign:${k}`] = v;
    const ads = ops.flatMap(o => (o.kind === 'pause_ad' ? [o.adId] : []));
    if (ads.length) for (const [k, v] of Object.entries(await this.provider.readAdStatus(acct, ads))) live[`ad:${k}`] = v;
    for (const o of ops) if (o.kind === 'add_negative_exact') live[`neg:${o.campaignId}:${o.text}`] = (await this.provider.readNegatives(acct, o.campaignId)).includes(o.text);
    return live;
  }
  private static expectedBefore(o: Operation): [string, unknown] {
    switch (o.kind) {
      case 'set_budget': return [`budget:${o.budgetId}`, o.fromMicros];
      case 'pause_campaign': return [`campaign:${o.campaignId}`, 'ENABLED'];
      case 'pause_ad': return [`ad:${o.adId}`, 'ENABLED'];
      case 'add_negative_exact': return [`neg:${o.campaignId}:${o.text}`, false];
    }
  }
  private static expectedAfter(o: Operation): [string, unknown] {
    switch (o.kind) {
      case 'set_budget': return [`budget:${o.budgetId}`, o.toMicros];
      case 'pause_campaign': return [`campaign:${o.campaignId}`, 'PAUSED'];
      case 'pause_ad': return [`ad:${o.adId}`, 'PAUSED'];
      case 'add_negative_exact': return [`neg:${o.campaignId}:${o.text}`, true];
    }
  }

  private guardWrite(a: ActionRow): void {
    const s = this.state();
    const intent = JSON.parse(a.intent) as ActionIntent;
    const protective = intent.actionType === 'pause_campaign' && a.actor !== 'model';
    if (s.emergencyLock && !protective) throw new CoordinatorError('emergency_lock', 'El bloqueo de emergencia está activo');
    if (s.restoredLocked && !protective) throw new CoordinatorError('restored_locked', 'Almacenamiento restaurado; primero concilia');
    if (a.actor === 'model' && s.aiStopped) throw new CoordinatorError('ai_stopped', 'AI changes are stopped');
    // Only DEMO (mock provider, enforced in the constructor) and LIMITED_AUTO execute. OBSERVE, SHADOW, PAUSED and
    // EMERGENCY_LOCK refuse every optimization write, owner-approved or not; protective pauses are always allowed.
    if (!protective && s.mode !== 'DEMO' && s.mode !== 'LIMITED_AUTO') throw new CoordinatorError('mode', `El modo ${s.mode} no permite ejecutar`);
  }

  /** Execute an APPROVED action by ID. Nothing else can be executed: there is no free-form execution input. */
  async execute(id: string, context: ContextSource): Promise<ActionRow> {
    let a = this.action(id);
    if (!a) throw new CoordinatorError('not_found', 'No existe esa acción');
    if (a.state !== 'APPROVED') throw new CoordinatorError('bad_state', `La acción está en ${a.state}, no en APPROVED`);
    if (this.now() > a.expires_at) { this.sql.tx(() => this.transition(a!, 'EXPIRED', {})); return this.action(id)!; }
    const intent = JSON.parse(a.intent) as ActionIntent;
    this.guardWrite(a);

    // 1. Reserve every touched resource and enter PREPARING atomically (fails if anything else holds it).
    const keys = resourceKeys(intent.operations);
    try {
      this.sql.tx(() => {
        for (const k of keys) {
          if (this.sql.all('SELECT 1 FROM reservations WHERE resource_key = ?', k).length) throw new CoordinatorError('resource_busy', `${k} está reservado por otra acción`);
          if (this.sql.all('SELECT 1 FROM suspensions WHERE resource_key = ?', k).length) throw new CoordinatorError('resource_suspended', `${k} está suspendido hasta conciliarlo`);
          this.sql.run('INSERT INTO reservations (resource_key, action_id, at) VALUES (?, ?, ?)', k, id, this.now());
        }
        this.transition(a!, 'PREPARING', { reserved: keys });
      });
    } catch (e) {
      if (e instanceof CoordinatorError) { this.sql.tx(() => this.transition(a!, 'REJECTED', { reason: e.message })); return this.action(id)!; }
      throw e;
    }
    a = this.action(id)!;

    // 2. Re-fetch live state, compare to the expected before-state, and re-evaluate policy with fresh numbers.
    let live: Record<string, unknown>;
    try { live = await this.readLive(intent.operations); }
    catch (e) { return this.rejectPreparing(a, `No se pudo leer el estado real: ${(e as Error).message}`); }
    const mismatch = intent.operations.map(CoordinatorCore.expectedBefore).filter(([k, v]) => live[k] !== v);
    if (mismatch.length) {
      for (const o of intent.operations) if (o.kind === 'set_budget' && typeof live[`budget:${o.budgetId}`] === 'number' && live[`budget:${o.budgetId}`] !== o.fromMicros)
        this.recordExternalBudgetChange({ budgetId: o.budgetId, at: this.now(), fromMicros: o.fromMicros, toMicros: live[`budget:${o.budgetId}`] as number });
      return this.rejectPreparing(a, `El estado real cambió desde la propuesta (${mismatch.map(([k]) => k).join(', ')}); vuelve a proponer con datos recientes`);
    }
    const ext = await context(intent);
    const decision = evaluatePolicy(intent, this.fullContext(intent, ext, a.actor, id));
    const authorized = decision.decision === 'authorized' || (decision.decision === 'approval_required' && !!a.approved_by && a.policy_version === this.policyVersion());
    if (!authorized) return this.rejectPreparing(a, `Nueva revisión de la política: ${decision.reasons.join('; ') || decision.decision}`);

    // 3. Record the exact mutation intent, then send operations in order, re-checking the lock before each one.
    this.sql.tx(() => {
      this.sql.run('UPDATE actions SET before_state = ? WHERE id = ?', JSON.stringify(live), id);
      this.transition(this.action(id)!, 'EXECUTING', { operations: intent.operations.length });
    });
    const results: OpResult[] = intent.operations.map((_, i) => ({ index: i, status: 'not_attempted' }));
    const acct = this.accountId();
    for (let i = 0; i < intent.operations.length; i++) {
      const o = intent.operations[i]!;
      try { this.guardWrite(this.action(id)!); }
      catch (e) { results[i] = { index: i, status: 'not_attempted', detail: (e as Error).message }; break; }
      const key = `${a.idem_key.slice(0, 32)}:${i}`;
      try {
        switch (o.kind) {
          case 'set_budget': await this.provider.setBudget(acct, o.budgetId, o.toMicros, key); break;
          case 'pause_campaign': await this.provider.setCampaignStatus(acct, o.campaignId, 'PAUSED', key); break;
          case 'pause_ad': await this.provider.setAdStatus(acct, o.adId, 'PAUSED', key); break;
          case 'add_negative_exact': await this.provider.addNegativeExact(acct, o.campaignId, o.text, key); break;
        }
        // Verify each step before the next (a transfer reduces first, verifies, then increases).
        const [k, want] = CoordinatorCore.expectedAfter(o);
        const after = await this.readLive([o]);
        if (after[k] !== want) { results[i] = { index: i, status: 'unknown', detail: 'El proveedor aceptó, pero el estado todavía no muestra el cambio' }; break; }
        results[i] = { index: i, status: 'applied' };
        if (o.kind === 'set_budget') this.sql.run('INSERT INTO budget_changes (budget_id, at, from_micros, to_micros, source, action_id) VALUES (?, ?, ?, ?, ?, ?)', o.budgetId, this.now(), o.fromMicros, o.toMicros, 'app', id);
      } catch (e) {
        const kind = e instanceof ProviderError ? e.kind : 'ambiguous';
        results[i] = { index: i, status: kind === 'ambiguous' ? 'unknown' : 'failed', detail: (e as Error).message };
        if (kind === 'auth') this.sql.tx(() => { this.put('emergency_lock', '1'); this.audit('credentials_invalid', 'coordinator', { message: (e as Error).message }); });
        break;
      }
    }
    return this.settle(id, results);
  }

  private rejectPreparing(a: ActionRow, reason: string): ActionRow {
    this.sql.tx(() => { this.transition(a, 'REJECTED', { reason }); this.release(a.id); });
    return this.action(a.id)!;
  }
  private release(actionId: string): void { this.sql.run('DELETE FROM reservations WHERE action_id = ?', actionId); }

  private settle(id: string, results: OpResult[]): ActionRow {
    const a = this.action(id)!;
    const applied = results.filter(r => r.status === 'applied').length;
    const unknown = results.some(r => r.status === 'unknown');
    const failed = results.some(r => r.status === 'failed' || (r.status === 'not_attempted' && r.detail));
    this.sql.tx(() => {
      this.sql.run('UPDATE actions SET op_results = ? WHERE id = ?', JSON.stringify(results), id);
      if (unknown) { this.transition(a, 'UNKNOWN_OUTCOME', { results }); return; } // reservation kept
      if (applied === results.length) { this.transition(a, 'APPLIED', { results }); this.transition({ ...a, state: 'APPLIED' }, 'VERIFIED', { results }); this.release(id); return; }
      if (applied > 0) { this.transition(a, 'PARTIALLY_APPLIED', { results, note: 'No se restauró en automático; no quedó ningún aumento total aplicado' }); this.release(id); return; }
      this.transition(a, 'FAILED', { results, ...(failed ? {} : { note: 'No se envió nada' }) }); this.release(id);
    });
    return this.action(id)!;
  }

  /** Resolve UNKNOWN_OUTCOME (or re-check APPLIED) by reading the provider. Never re-sends a mutation. */
  async reconcile(id: string): Promise<ActionRow> {
    let a = this.action(id);
    if (!a) throw new CoordinatorError('not_found', 'No existe esa acción');
    if (!['UNKNOWN_OUTCOME', 'APPLIED', 'RECONCILING'].includes(a.state)) return a;
    if (a.state !== 'RECONCILING') { this.sql.tx(() => this.transition(a!, 'RECONCILING', {})); a = this.action(id)!; }
    const intent = JSON.parse(a.intent) as ActionIntent;
    let live: Record<string, unknown>;
    try { live = await this.readLive(intent.operations); }
    catch (e) { this.sql.tx(() => this.transition(a!, 'UNKNOWN_OUTCOME', { reason: `Falló la lectura para conciliar: ${(e as Error).message}` })); return this.action(id)!; }
    const results: OpResult[] = intent.operations.map((o, i) => {
      const [k, after] = CoordinatorCore.expectedAfter(o), [, before] = CoordinatorCore.expectedBefore(o);
      if (live[k] === after) return { index: i, status: 'applied' };
      if (live[k] === before) return { index: i, status: 'failed', detail: 'No se aplicó' };
      return { index: i, status: 'unknown', detail: `El proveedor muestra ${String(live[k])}: se cambió fuera de esta app` };
    });
    const external = results.some(r => r.status === 'unknown');
    this.sql.tx(() => {
      this.sql.run('UPDATE actions SET op_results = ? WHERE id = ?', JSON.stringify(results), id);
      for (const [i, r] of results.entries()) {
        const o = intent.operations[i]!;
        if (r.status === 'applied' && o.kind === 'set_budget' && !this.sql.all("SELECT 1 FROM budget_changes WHERE action_id = ? AND budget_id = ?", id, o.budgetId).length)
          this.sql.run('INSERT INTO budget_changes (budget_id, at, from_micros, to_micros, source, action_id) VALUES (?, ?, ?, ?, ?, ?)', o.budgetId, this.now(), o.fromMicros, o.toMicros, 'app', id);
      }
      if (external) {
        for (const k of resourceKeys(intent.operations)) this.sql.run('INSERT OR REPLACE INTO suspensions (resource_key, reason, at) VALUES (?, ?, ?)', k, `Se detectó un cambio externo al conciliar ${id}`, this.now());
        this.transition(a!, 'FAILED', { results, externalChange: true }); this.release(id); return;
      }
      const applied = results.filter(r => r.status === 'applied').length;
      if (applied === results.length) this.transition(a!, 'VERIFIED', { results });
      else if (applied === 0) this.transition(a!, 'FAILED', { results });
      else this.transition(a!, 'PARTIALLY_APPLIED', { results });
      this.release(id);
    });
    return this.action(id)!;
  }

  /** Conditional rollback: only if the provider still shows exactly what this app applied. */
  async compensate(id: string, actor: string): Promise<{ action: ActionRow; refused?: string }> {
    const a = this.action(id);
    if (!a) throw new CoordinatorError('not_found', 'No existe esa acción');
    if (!['VERIFIED', 'PARTIALLY_APPLIED', 'COMPENSATION_REQUIRED'].includes(a.state)) throw new CoordinatorError('bad_state', `No se puede revertir una acción en ${a.state}`);
    if (this.state().emergencyLock) throw new CoordinatorError('emergency_lock', 'El bloqueo de emergencia está activo');
    const intent = JSON.parse(a.intent) as ActionIntent;
    const prev = JSON.parse(a.op_results) as OpResult[];
    const applied = intent.operations.map((o, i) => ({ o, i })).filter(({ i }) => prev[i]?.status === 'applied');
    if (applied.some(({ o }) => o.kind === 'add_negative_exact')) return { action: a, refused: 'Quitar una palabra clave negativa no se puede hacer en automático; quítala en Google Ads' };
    if (applied.some(({ o }) => o.kind === 'pause_campaign')) return { action: a, refused: 'Reanudar una campaña pausada es una decisión de gasto: usa Reanudar en Controles, que vuelve a revisar la autorización y el presupuesto' };
    if (a.state !== 'COMPENSATION_REQUIRED') this.sql.tx(() => this.transition(a, 'COMPENSATION_REQUIRED', { actor }));
    const live = await this.readLive(applied.map(x => x.o));
    const drift = applied.filter(({ o }) => { const [k, v] = CoordinatorCore.expectedAfter(o); return live[k] !== v; });
    if (drift.length) {
      this.sql.tx(() => this.transition(this.action(id)!, a.state === 'PARTIALLY_APPLIED' ? 'PARTIALLY_APPLIED' : 'VERIFIED', { compensationRefused: 'Cambió desde que esta app lo aplicó; no se sobrescribe una edición manual posterior' }));
      return { action: this.action(id)!, refused: 'El recurso se cambió después de que esta app aplicó la acción. Revertir sobrescribiría ese cambio, así que no se intentó.' };
    }
    // Undo in reverse order; for a transfer that means reducing the increased budget first.
    const acct = this.accountId();
    for (const { o, i } of [...applied].reverse()) {
      const key = `${a.idem_key.slice(0, 32)}:undo:${i}`;
      if (o.kind === 'set_budget') await this.provider.setBudget(acct, o.budgetId, o.fromMicros, key);
      if (o.kind === 'pause_ad') await this.provider.setAdStatus(acct, o.adId, 'ENABLED', key);
      prev[i] = { index: i, status: 'compensated' };
      if (o.kind === 'set_budget') this.sql.run('INSERT INTO budget_changes (budget_id, at, from_micros, to_micros, source, action_id) VALUES (?, ?, ?, ?, ?, ?)', o.budgetId, this.now(), o.toMicros, o.fromMicros, 'app', id);
    }
    this.sql.tx(() => { this.sql.run('UPDATE actions SET op_results = ? WHERE id = ?', JSON.stringify(prev), id); this.transition(this.action(id)!, 'COMPENSATED', { actor, limits: 'El gasto ya hecho, las impresiones ya mostradas y cualquier reinicio del aprendizaje no se deshacen' }); });
    return { action: this.action(id)! };
  }

  /** "Pause managed ads": protective pause of every approved campaign, reported per resource. No model involved;
   *  allowed under EMERGENCY_LOCK. */
  async pauseManaged(snapshot: Snapshot, actor: string, context: ContextSource): Promise<{ campaignId: string; label: string; outcome: string; actionId?: string }[]> {
    const out: { campaignId: string; label: string; outcome: string; actionId?: string }[] = [];
    const policy = this.policy();
    for (const r of snapshot.resources.filter(x => x.kind === 'campaign' && policy.approvedCampaignIds.includes(x.externalId))) {
      const intent: ActionIntent = {
        actionType: 'pause_campaign', accountId: snapshot.accountId, currency: snapshot.currency, resourceRef: r.ref, resourceLabel: r.label, campaignIds: [r.externalId],
        operations: [{ kind: 'pause_campaign', campaignId: r.externalId }], spendIncreasing: false, snapshotId: `${snapshot.snapshotId}:pause:${this.now()}`, evidenceRefs: [],
        proposal: { schemaVersion: '1', snapshotId: snapshot.snapshotId, hypothesis: 'El dueño pidió pausar como protección los anuncios administrados', actionType: 'pause_campaign', resourceRef: r.ref, parameters: {}, evidenceRefs: ['ev_owner_request'], expectedEffect: { metric: 'spend', direction: 'decrease', range: null }, risks: ['Detiene las reservaciones de esta campaña'], alternative: 'Dejarla activa', evaluationPlan: 'El dueño decide cuándo reanudar', rollbackPlan: 'Reactivar en Controles después de las revisiones actuales de autorización y presupuesto' },
      };
      try {
        const live = await this.provider.readCampaignStatus(snapshot.accountId, [r.externalId]);
        if (live[r.externalId] === 'PAUSED') { out.push({ campaignId: r.externalId, label: r.label, outcome: 'ya estaba pausada' }); continue; }
        const { action } = await this.propose(intent, 'owner', context);
        if (action.state !== 'APPROVED') { out.push({ campaignId: r.externalId, label: r.label, outcome: `no se pausó: ${action.state}`, actionId: action.id }); continue; }
        const done = await this.execute(action.id, context);
        out.push({ campaignId: r.externalId, label: r.label, outcome: done.state === 'VERIFIED' ? 'pausada (verificada)' : done.state === 'UNKNOWN_OUTCOME' ? 'desconocido: revisa Google Ads directamente' : `falló: ${done.state}`, actionId: action.id });
      } catch (e) {
        out.push({ campaignId: r.externalId, label: r.label, outcome: `falló: ${(e as Error).message}` });
      }
    }
    this.sql.tx(() => this.audit('pause_managed_ads', actor, { results: out }));
    return out;
  }

  // ---------------- ledger, outbox, recovery ----------------

  private event(a: ActionRow, from: ActionState | null, to: ActionState, detail: Record<string, unknown>): void {
    const eventId = crypto.randomUUID();
    const at = this.now();
    const intent = JSON.parse(a.intent) as ActionIntent;
    this.sql.run('INSERT INTO action_events (event_id, action_id, from_state, to_state, at, detail) VALUES (?, ?, ?, ?, ?, ?)', eventId, a.id, from, to, at, JSON.stringify(detail));
    const payload: OutboxEvent = { eventId, accountId: this.accountId(), actionId: a.id, from, to, at, detail, action: { type: a.action_type, actor: a.actor, label: intent.resourceLabel, operations: intent.operations, policyVersion: a.policy_version } };
    this.sql.run('INSERT INTO outbox (event_id, payload, created_at) VALUES (?, ?, ?)', eventId, JSON.stringify(payload), at);
  }
  /** Must be called inside sql.tx so the transition and its outbox event commit together. */
  private transition(a: ActionRow, to: ActionState, detail: Record<string, unknown>): void {
    const current = one(this.sql.all<{ state: ActionState }>('SELECT state FROM actions WHERE id = ?', a.id))?.state ?? a.state;
    assertTransition(current, to);
    this.sql.run('UPDATE actions SET state = ?, updated_at = ? WHERE id = ?', to, this.now(), a.id);
    this.event({ ...a, state: to }, current, to, detail);
  }

  pendingOutbox(limit = 200): { eventId: string; payload: string }[] {
    return this.sql.all<{ event_id: string; payload: string }>('SELECT event_id, payload FROM outbox WHERE acked_at IS NULL ORDER BY created_at LIMIT ?', limit).map(r => ({ eventId: r.event_id, payload: r.payload }));
  }
  ack(eventIds: string[]): void {
    this.sql.tx(() => { for (const e of eventIds) this.sql.run('UPDATE outbox SET acked_at = ? WHERE event_id = ? AND acked_at IS NULL', this.now(), e); });
  }
  /** Retention: drop acknowledged outbox events older than `days`. The action_events ledger is never pruned here. */
  pruneOutbox(days: number): void { this.sql.run('DELETE FROM outbox WHERE acked_at IS NOT NULL AND acked_at < ?', this.now() - days * 86_400_000); }

  ledger(actionId?: string): { seq: number; event_id: string; action_id: string; from_state: string | null; to_state: string; at: number; detail: string }[] {
    return actionId ? this.sql.all('SELECT * FROM action_events WHERE action_id = ? ORDER BY seq', actionId) : this.sql.all('SELECT * FROM action_events ORDER BY seq');
  }

  /** Rebuild each action's state from the ledger alone and report any disagreement with the actions table. */
  verifyLedger(): { actionId: string; table: string; ledger: string }[] {
    const last = new Map<string, string>();
    for (const e of this.ledger()) last.set(e.action_id, e.to_state);
    return this.sql.all<{ id: string; state: string }>('SELECT id, state FROM actions').filter(a => last.get(a.id) !== a.state).map(a => ({ actionId: a.id, table: a.state, ledger: last.get(a.id) ?? 'missing' }));
  }

  /** Full export for backup: configuration, actions, ledger, outbox, reservations, change history. */
  exportAll(): Record<string, unknown[]> {
    const t = (n: string) => this.sql.all(`SELECT * FROM ${n}`);
    return { kv: t('kv'), policy_versions: t('policy_versions'), actions: t('actions'), action_events: t('action_events'), outbox: t('outbox'), reservations: t('reservations'), budget_changes: t('budget_changes'), suspensions: t('suspensions') };
  }

  /** Restore from a backup. Automation starts locked; only reconcileAll() can clear the restore lock. */
  restoreAll(dump: Record<string, Record<string, unknown>[]>): void {
    const tables = ['kv', 'policy_versions', 'actions', 'action_events', 'outbox', 'reservations', 'budget_changes', 'suspensions'];
    this.sql.tx(() => {
      for (const n of tables) {
        this.sql.run(`DELETE FROM ${n}`);
        for (const row of dump[n] ?? []) {
          const cols = Object.keys(row);
          this.sql.run(`INSERT INTO ${n} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, ...cols.map(c => row[c]));
        }
      }
      this.put('restored_locked', '1');
      this.put('emergency_lock', '1');
      this.put('mode', 'EMERGENCY_LOCK');
      this.audit('restored_from_backup', 'system', {});
    });
  }

  /** Reconcile every action whose outcome is not settled, then lift the restore lock (the emergency lock stays on
   *  until the owner turns it off). */
  async reconcileAll(actor: string): Promise<{ reconciled: number; stillUnknown: number }> {
    const open = this.sql.all<{ id: string }>("SELECT id FROM actions WHERE state IN ('UNKNOWN_OUTCOME','APPLIED','RECONCILING','EXECUTING','PREPARING')");
    let still = 0;
    for (const { id } of open) {
      const a = this.action(id)!;
      if (a.state === 'EXECUTING' || a.state === 'PREPARING') {
        // Interrupted mid-flight (e.g. restored or crashed): its outcome is unknown until read.
        if (a.state === 'PREPARING') { this.sql.tx(() => { this.transition(a, 'REJECTED', { reason: 'Se interrumpió antes de enviar' }); this.release(id); }); continue; }
        this.sql.tx(() => this.transition(a, 'UNKNOWN_OUTCOME', { reason: 'Se interrumpió durante la ejecución' }));
      }
      const r = await this.reconcile(id);
      if (r.state === 'UNKNOWN_OUTCOME') still++;
    }
    if (!still) this.sql.tx(() => { this.put('restored_locked', '0'); this.audit('reconciled_after_restore', actor, { reconciled: open.length }); });
    return { reconciled: open.length, stillUnknown: still };
  }
}
