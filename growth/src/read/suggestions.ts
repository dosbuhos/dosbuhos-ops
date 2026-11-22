// What became of each thing the rules found (waiting for the owner, already done, or declined), and what happened in
// the account after a change was applied. Read-only: nothing here can change an ad account.
import { fold, hasPhrase } from '../domain/keywords.ts';
import { addDays, dateRange, localDate, type LocalDate } from '../domain/time.ts';
import { RESERVATION_EVENT } from '../connectors/ga4.ts';
import type { ThemeImpact, Snapshot } from '../policy/validate.ts';
import { detect, loadDetectInput, proposalFor, themeLabel, DETECTOR_VERSION, type Finding } from './detectors.ts';
import { loadToday, type PolicyBits } from './today.ts';

export interface ActionLite {
  id: string; state: string; action_type: string; created_at: number; updated_at: number; approval_hash?: string;
  intent?: { resourceRef?: string; resourceLabel?: string; proposal?: { actionType?: string; hypothesis?: string; parameters?: { text?: string; changePct?: number } }; impact?: ThemeImpact };
}

/** A finding the owner declined, or one already applied, is not brought back for this long. */
export const DO_NOT_REPEAT_DAYS = 30;
/** A suggestion the server refused to build is not retried every morning. */
export const RETRY_REFUSED_DAYS = 7;
const DAY = 86_400_000;

export const findingKey = (campaign: string, actionType: string, text: string) => `${campaign}|${actionType}|${fold(text)}`;
export const keyOfFinding = (f: Finding) => (f.action ? findingKey(f.campaign, f.action.actionType, f.action.text) : null);
export const keyOfAction = (a: ActionLite) => { const p = a.intent?.proposal; return p?.actionType && typeof p.parameters?.text === 'string' ? findingKey(String(a.intent?.resourceLabel ?? ''), p.actionType, p.parameters.text) : null; };

/** A suggestion's headline in plain words: what would change. */
export function actionTitle(actionType: string | null | undefined, params: { text?: string | null; changePct?: number | null } | null | undefined, fallback = ''): string {
  switch (actionType) {
    case 'block_search_theme': return `Dejar de pagar por búsquedas de ${themeLabel(String(params?.text ?? ''))}`;
    case 'add_negative_keyword_exact': return `Dejar de pagar por “${params?.text ?? ''}”`;
    case 'campaign_budget_change': return `${(params?.changePct ?? 0) > 0 ? 'Subir' : 'Bajar'} ${Math.abs(params?.changePct ?? 0)}% el presupuesto diario`;
    case 'budget_reallocation': return 'Mover presupuesto a otra campaña';
    case 'pause_campaign': return 'Pausar la campaña';
    case 'pause_ad': return 'Pausar un anuncio';
    default: return fallback;
  }
}

export type Handled = 'waiting' | 'done' | 'declined';
const WAITING = new Set(['APPROVAL_REQUIRED', 'APPROVED', 'PREPARING', 'EXECUTING']);
const DONE = new Set(['UNKNOWN_OUTCOME', 'RECONCILING', 'APPLIED', 'VERIFIED', 'PARTIALLY_APPLIED']);
const RANK: Record<Handled, number> = { declined: 1, done: 2, waiting: 3 };

/** For each finding that already has a decision or a change behind it: which. A proposal that expired unseen, failed,
 *  or was refused by policy is not in the map, so the next review brings it back. */
export async function handledFindings(db: D1Database, actions: ActionLite[], now: number): Promise<Map<string, Handled>> {
  const since = now - DO_NOT_REPEAT_DAYS * DAY;
  const declined = new Set((await db.prepare("SELECT action_id FROM action_ledger_projection WHERE to_state = 'REJECTED' AND at >= ? AND json_extract(detail_json, '$.reason') LIKE 'Ahora no:%'").bind(since)
    .all<{ action_id: string }>().catch(() => ({ results: [] as { action_id: string }[] }))).results.map(r => r.action_id));
  const out = new Map<string, Handled>();
  for (const a of actions) {
    const k = keyOfAction(a);
    if (!k) continue;
    const h: Handled | null = WAITING.has(a.state) ? 'waiting' : a.updated_at < since ? null : DONE.has(a.state) ? 'done' : a.state === 'REJECTED' && declined.has(a.id) ? 'declined' : null;
    const prev = out.get(k);
    if (h && (!prev || RANK[h] > RANK[prev])) out.set(k, h);
  }
  return out;
}

/** Why the server would not build a suggestion the rules asked for, by "resourceRef|actionType|text". Recent ones only. */
export async function refusedRecently(db: D1Database, now: number): Promise<Map<string, string[]>> {
  const rows = (await db.prepare("SELECT raw_json, validation_errors_json FROM proposals WHERE model = 'reglas-fijas' AND action_id IS NULL AND created_at >= ? ORDER BY created_at").bind(now - RETRY_REFUSED_DAYS * DAY)
    .all<{ raw_json: string; validation_errors_json: string }>().catch(() => ({ results: [] as { raw_json: string; validation_errors_json: string }[] }))).results;
  const out = new Map<string, string[]>();
  for (const r of rows) {
    try {
      const raw = JSON.parse(r.raw_json) as { resourceRef?: string; actionType?: string; parameters?: { text?: string } }, errors = JSON.parse(r.validation_errors_json) as string[];
      if (raw.resourceRef && raw.actionType && raw.parameters?.text && errors.length) out.set(findingKey(raw.resourceRef, raw.actionType, raw.parameters.text), errors);
    } catch { /* an unreadable row explains nothing */ }
  }
  return out;
}

// ---------------- from findings to suggestions ----------------

export const MAX_RULE_PROPOSALS_PER_RUN = 3;
export type SubmitResult = { accepted: boolean; actionId?: string; state?: string; errors?: string[]; reasons?: string[] };

/** Fixed rules look at the searches of the last 28 days and submit what the app can do about them. Each one goes
 *  through the same validation, policy and owner approval as a proposal from the model, and nothing is applied here:
 *  an approved change is executed only by the owner's approval.
 *  A finding is skipped while it is waiting, for 30 days after it was applied or declined, and for 7 days after the
 *  server refused to build it. One that expired unseen comes back with the next review. */
export async function proposeFindings(o: { db: D1Database; accountKey: string; snapshot: Snapshot; actions: ActionLite[]; approved: ReadonlySet<string>; today: LocalDate; now: number; runKey: string; submit: (raw: unknown) => Promise<SubmitResult> }): Promise<{ summary: string; submitted: number; found: number }> {
  const all = detect(await loadDetectInput(o.db, o.today)), findings = all.filter(f => f.action);
  if (!all.length) return { summary: 'Reglas fijas: nada nuevo que proponer.', submitted: 0, found: 0 };
  const handled = await handledFindings(o.db, o.actions, o.now), refused = await refusedRecently(o.db, o.now);
  let submitted = 0, waiting = 0, decided = 0, notAllowed = 0, invalid = 0;
  for (const f of findings) {
    const state = handled.get(keyOfFinding(f)!);
    if (state) { if (state === 'waiting') waiting++; else decided++; continue; }
    const res = o.snapshot.resources.find(r => r.kind === 'campaign' && r.label === f.campaign);
    // A campaign outside the owner's approved list is never proposed for: the finding stays as advice.
    if (!res || !res.writable || !o.approved.has(res.externalId)) { notAllowed++; continue; }
    if (refused.has(findingKey(res.ref, f.action!.actionType, f.action!.text))) { invalid++; continue; }
    if (submitted >= MAX_RULE_PROPOSALS_PER_RUN) break;
    const raw = proposalFor(f, o.snapshot.snapshotId, res.ref);
    if (!raw || !raw.evidenceRefs.every(e => o.snapshot.evidence[e])) continue;
    const r = await o.submit(raw);
    await o.db.prepare('INSERT INTO proposals (id, action_id, account_id, snapshot_id, run_key, raw_json, validation_errors_json, decision, reasons_json, model, prompt_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(`prop_${crypto.randomUUID().slice(0, 18)}`, r.actionId ?? null, o.accountKey, o.snapshot.snapshotId, o.runKey, JSON.stringify(raw).slice(0, 20_000), JSON.stringify(r.errors ?? []), r.state ?? 'invalid', JSON.stringify(r.reasons ?? []), 'reglas-fijas', DETECTOR_VERSION, o.now).run();
    if (r.accepted) submitted++; else if (r.errors?.length) invalid++;
  }
  const advice = all.length - findings.length;
  const parts = [`${all.length} ${all.length === 1 ? 'hallazgo' : 'hallazgos'}`, `${submitted} ${submitted === 1 ? 'enviado' : 'enviados'} para tu aprobación`,
    ...(waiting ? [`${waiting} ya ${waiting === 1 ? 'esperaba' : 'esperaban'} tu decisión`] : []), ...(decided ? [`${decided} ya ${decided === 1 ? 'decidido' : 'decididos'}`] : []), ...(advice ? [`${advice} solo para revisar`] : []),
    ...(invalid ? [`${invalid} que la app no puede hacer con un toque`] : []), ...(notAllowed ? [`${notAllowed} en campañas fuera de tu lista aprobada`] : [])];
  return { summary: `Reglas fijas: ${parts.join(', ')}.`, submitted, found: all.length };
}

/** What the owner sees: the decisions waiting, and what the rules found that is not already waiting, done or declined.
 *  A finding the app can act on says how it gets to the owner; one it cannot says why. */
export async function findingsView(db: D1Database, o: { actions: ActionLite[]; approved: string[]; today: LocalDate; now: number }) {
  const pending = o.actions.filter(x => x.state === 'APPROVAL_REQUIRED').map(x => {
    const p = x.intent?.proposal, i = x.intent?.impact;
    return { id: x.id, label: String(x.intent?.resourceLabel ?? ''), title: actionTitle(p?.actionType, p?.parameters, String(x.intent?.resourceLabel ?? '')), hypothesis: String(p?.hypothesis ?? ''), actionType: p?.actionType ?? null,
      text: p?.parameters?.text ?? null, changePct: p?.parameters?.changePct ?? null, createdAt: x.created_at, impact: i ? { searches: i.searches, clicks: i.clicks, costMicros: i.costMicros } : null };
  });
  const handled = await handledFindings(db, o.actions, o.now), refused = await refusedRecently(db, o.now);
  type Reg = { name: string; ref: string; writable: number; external_id: string };
  const refs = new Map((await db.prepare("SELECT name, ref, writable, external_id FROM campaign_registry WHERE kind = 'campaign'").all<Reg>().catch(() => ({ results: [] as Reg[] }))).results.map(r => [r.name, r]));
  const approved = new Set(o.approved);
  const advice = detect(await loadDetectInput(db, o.today)).filter(f => !f.action || !handled.has(keyOfFinding(f)!)).slice(0, 6).map(f => {
    const reg = refs.get(f.campaign), why = f.action && reg ? refused.get(findingKey(reg.ref, f.action.actionType, f.action.text)) : undefined;
    const note = f.note ?? (!f.action ? null
      : why ? `La app no lo puede hacer con un toque: ${why[0]}.`
      : !reg || !reg.writable || !approved.has(reg.external_id) ? 'Esta campaña no está en tu lista de campañas que la app puede cambiar (Ajustes → Controles).'
      : 'La revisión de mañana lo manda para tu aprobación. Para no esperar, usa “Pedir sugerencias ahora”.');
    return { key: f.key, kind: f.kind, campaign: f.campaign, title: f.title, why: f.why, expect: f.expect, measure: f.measure, note, money: f.moneyMicros, searches: f.searches ?? [], moreSearches: f.moreSearches ?? 0, actionable: !!f.action && !why };
  });
  return { pending, advice };
}

// ---------------- what the review reads about right now ----------------

/** The same picture the owner has on his first screen, for the model: this month against the ceiling, the last 28
 *  days per campaign with its verdict, and what the fixed rules found with what became of each. Money in whole pesos,
 *  so the model repeats a number instead of converting one. */
export async function reviewNow(db: D1Database, o: { now: number; tz: string; currency: string; policy: PolicyBits | null; actions: ActionLite[] }) {
  const t = await loadToday(db, o.now, o.tz, o.currency, o.policy);
  const handled = await handledFindings(db, o.actions, o.now);
  const whole = (micros: number) => Math.round(micros / 1e6);
  const fromMinor = (minor: number | null | undefined) => (minor === null || minor === undefined ? null : Math.round(minor / 100));
  const split = (x: { google: number; meta: number; total: number }) => ({ google: whole(x.google), meta: whole(x.meta), total: whole(x.total) });
  return {
    today: t.today, currency: t.currency,
    month: { month: t.month.month, dayOfMonth: t.month.dayOfMonth, daysInMonth: t.month.daysInMonth, spentPesos: split(t.month.spentMicros), projectedPesos: split(t.month.projectedMicros),
      ceilingPesos: t.month.ceilingMicros === null ? null : whole(t.month.ceilingMicros), ceilingCovers: t.month.ceilingScope },
    last28Days: { from: t.window.from, to: t.window.to, contributionPerReservationPesos: fromMinor(t.contributionPerReservationMinor), returnFloor: t.floor,
      campaigns: t.campaigns.filter(c => c.verdict.key !== 'pausada').map(c => ({ ref: c.ref, name: c.name, platform: c.provider === 'meta_ads' ? 'Meta' : 'Google', status: c.status, spendPesos: whole(c.spendMicros),
        onlineReservations: c.reservations, costPerReservationPesos: fromMinor(c.costPerReservationMinor), verdict: c.verdict.label, verdictReason: c.verdict.reason })) },
    ruleFindings: detect(await loadDetectInput(db, t.today)).slice(0, 8).map(f => ({ kind: f.kind, campaign: f.campaign, title: f.title, why: f.why, expect: f.expect,
      status: !f.action ? 'advice_only' : handled.get(keyOfFinding(f)!) === 'waiting' ? 'sent_waits_for_owner' : handled.get(keyOfFinding(f)!) ?? 'not_sent', note: f.note ?? null })),
    decisionsWaitingForOwner: o.actions.filter(a => a.state === 'APPROVAL_REQUIRED').length,
  };
}

// ---------------- what happened after a change ----------------

export type ResultStage = 'en_cola' | 'midiendo' | 'a7' | 'a14';
export interface ResultCard {
  actionId: string; campaign: string; title: string; stage: ResultStage; verdict: 'funciona' | 'sigue_entrando' | 'midiendo';
  appliedDate: LocalDate | null; daysMeasured: number;
  before: { clicks: number; costMicros: number } | null; after: { clicks: number; costMicros: number } | null;
  reservationsBefore: number | null; reservationsAfter: number | null;
  still: { query: string; clicks: number }[];           // searches of the theme that kept coming in after the change
  lines: string[];
}
const RESULT_TYPES = new Set(['block_search_theme', 'add_negative_keyword_exact']);
const pesos = (micros: number) => `MX$${Math.round(micros / 1e6).toLocaleString('en-US')}`;
const n = (x: number, one: string, many: string) => `${x.toLocaleString('en-US')} ${x === 1 ? one : many}`;

/** One card per change of the last weeks: the searches it was meant to stop, before and after, and the campaign's
 *  online reservations over the same days. Compared over equal numbers of complete days: 7, then 14. */
export async function loadResults(db: D1Database, actions: ActionLite[], now: number, tz: string): Promise<ResultCard[]> {
  const today = localDate(now, tz), yesterday = addDays(today, -1);
  const mine = actions.filter(a => RESULT_TYPES.has(a.action_type) && DONE.has(a.state) && typeof a.intent?.proposal?.parameters?.text === 'string' && a.updated_at >= now - 35 * DAY);
  const out: ResultCard[] = [];
  for (const a of mine) {
    const campaign = String(a.intent!.resourceLabel ?? ''), text = a.intent!.proposal!.parameters!.text!, theme = fold(text);
    const isTheme = a.action_type === 'block_search_theme';
    const title = isTheme ? `Búsquedas de ${themeLabel(theme)}` : `La búsqueda “${text}”`;
    if (a.state !== 'VERIFIED' && a.state !== 'PARTIALLY_APPLIED') {
      out.push({ actionId: a.id, campaign, title, stage: 'en_cola', verdict: 'midiendo', appliedDate: null, daysMeasured: 0, before: null, after: null, reservationsBefore: null, reservationsAfter: null, still: [],
        lines: ['Aprobado y en cola: el script de Google Ads lo aplica en su próxima corrida, cada hora.'] });
      continue;
    }
    const applied = localDate(a.updated_at, tz);
    const complete = Math.max(0, dateRange(addDays(applied, 1), yesterday).length);     // whole days since the day it was applied
    const days = complete >= 14 ? 14 : complete >= 7 ? 7 : complete;
    const stage: ResultStage = complete >= 14 ? 'a14' : complete >= 7 ? 'a7' : 'midiendo';
    const span = Math.max(days, 1), beforeFrom = addDays(applied, -span), beforeTo = addDays(applied, -1), afterFrom = addDays(applied, 1), afterTo = addDays(applied, span);
    const rows = (await db.prepare('SELECT date, query, COALESCE(ad_clicks, 0) AS clicks, COALESCE(ad_cost_micros, 0) AS cost FROM ga4_ads_queries WHERE campaign = ? AND date BETWEEN ? AND ?').bind(campaign, beforeFrom, afterTo)
      .all<{ date: string; query: string; clicks: number; cost: number }>().catch(() => ({ results: [] as { date: string; query: string; clicks: number; cost: number }[] }))).results
      .filter(r => (isTheme ? hasPhrase(fold(r.query), theme) : fold(r.query) === theme));
    const side = (from: LocalDate, to: LocalDate) => rows.filter(r => r.date >= from && r.date <= to).reduce((s, r) => ({ clicks: s.clicks + Number(r.clicks), costMicros: s.costMicros + Number(r.cost) }), { clicks: 0, costMicros: 0 });
    const before = side(beforeFrom, beforeTo), after = days ? side(afterFrom, afterTo) : { clicks: 0, costMicros: 0 };
    const res = (await db.prepare('SELECT date, SUM(events) AS n FROM ga4_reservations_daily WHERE event_name = ? AND campaign = ? AND date BETWEEN ? AND ? GROUP BY date').bind(RESERVATION_EVENT, campaign, beforeFrom, afterTo)
      .all<{ date: string; n: number }>().catch(() => null))?.results ?? null;
    const resSide = (from: LocalDate, to: LocalDate) => (res === null ? null : res.filter(r => r.date >= from && r.date <= to).reduce((s, r) => s + Number(r.n), 0));
    const still = new Map<string, number>();
    if (days) for (const r of rows) if (r.date >= afterFrom && r.date <= afterTo && Number(r.clicks) > 0) still.set(r.query, (still.get(r.query) ?? 0) + Number(r.clicks));
    const stillList = [...still].map(([query, clicks]) => ({ query, clicks })).sort((x, y) => y.clicks - x.clicks).slice(0, 4);
    const rb = resSide(beforeFrom, beforeTo), ra = days ? resSide(afterFrom, afterTo) : null;
    const verdict: ResultCard['verdict'] = after.clicks > 0 ? 'sigue_entrando' : stage === 'midiendo' ? 'midiendo' : 'funciona';
    const lines: string[] = [];
    if (!days) lines.push('Aplicado hoy o ayer. El primer día completo se ve mañana.');
    else {
      lines.push(`Los ${n(days, 'día', 'días')} de antes: ${n(before.clicks, 'clic', 'clics')} y ${pesos(before.costMicros)}. Los ${n(days, 'día', 'días')} de después: ${n(after.clicks, 'clic', 'clics')} y ${pesos(after.costMicros)}.`);
      if (rb !== null && ra !== null) lines.push(`Reservaciones en línea de la campaña: ${rb} antes y ${ra} después.`);
      if (stillList.length) lines.push(`Todavía entran: ${stillList.map(s => `“${s.query}” (${n(s.clicks, 'clic', 'clics')})`).join(', ')}.`);
      if (stage === 'midiendo') lines.push(`Van ${n(complete, 'día completo', 'días completos')}; el primer corte es a los 7.`);
    }
    out.push({ actionId: a.id, campaign, title, stage, verdict, appliedDate: applied, daysMeasured: days, before, after: days ? after : null, reservationsBefore: rb, reservationsAfter: ra, still: stillList, lines });
  }
  return out;
}

// ---------------- a change that is waiting for its outcome ----------------

/** A change approved with the Google Ads Script waits up to an hour for the script's next run: that is the normal path,
 *  not an alarm. It becomes a warning when the script has clearly missed its turn, and stays critical for a provider
 *  that answers at once (there, an unknown outcome really is unknown). */
export const SCRIPT_LATE_MS = 2 * 3_600_000;
export interface QueuedAlert { key: string; severity: 'critical' | 'warning' | 'info'; title: string; detail: string; link: string }
export function queuedAlert(count: number, providerKind: string, oldestAt: number | null, now: number): QueuedAlert {
  const n = `${count} ${count === 1 ? 'cambio' : 'cambios'}`;
  if (providerKind !== 'google_ads_script') return { key: 'unknown_outcome', severity: 'critical', title: `${n} en anuncios con resultado desconocido`, detail: 'Los cambios a esos recursos están bloqueados hasta conciliarlos. Abre Sugerencias → Conciliar con Google Ads.', link: '#sugerencias' };
  const waited = oldestAt === null ? 0 : now - oldestAt;
  if (waited < SCRIPT_LATE_MS) return { key: 'unknown_outcome', severity: 'info', title: `${n} ${count === 1 ? 'aprobado' : 'aprobados'} en cola para Google Ads`, detail: 'El script de Google Ads los aplica en su próxima corrida, cada hora, y la app los verifica con el siguiente reporte de la cuenta.', link: '#sugerencias' };
  return { key: 'unknown_outcome', severity: 'warning', title: `${n} ${count === 1 ? 'aprobado lleva' : 'aprobados llevan'} ${Math.floor(waited / 3_600_000)} horas sin aplicarse`, detail: 'El script de Google Ads debió aplicarlos en su corrida de cada hora. Revisa en Google Ads (Herramientas → Secuencias de comandos) que siga programado y sin errores.', link: '#sugerencias' };
}
