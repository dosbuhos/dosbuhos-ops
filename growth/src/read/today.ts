// The owner's first screen ("Hoy"): this month's ad spend against the ceiling and where it lands at the current pace,
// yesterday at a glance, and a plain verdict per campaign. Read-only: nothing here can change an ad account.
import { addDays, localDate, type LocalDate } from '../domain/time.ts';
import { RESERVATION_EVENT } from '../connectors/ga4.ts';
import { loadCampaigns, type CampaignRow } from './campaigns.ts';

export type VerdictKey = 'rinde' | 'vigilar' | 'pierde' | 'sin_datos' | 'pausada';
export interface Verdict { key: VerdictKey; label: string; reason: string; contributionReturn: number | null }
export const VERDICT_LABEL: Record<VerdictKey, string> = { rinde: 'Rinde', vigilar: 'Vigilar', pierde: 'Pierde dinero', sin_datos: 'Sin datos', pausada: 'En pausa' };

/** Online reservations a campaign needs before its return is judged instead of watched. */
export const MIN_RESERVATIONS_TO_JUDGE = 5;
/** Return floor used when the policy has none yet (contribution of its reservations ÷ what it spent). */
export const DEFAULT_RETURN_FLOOR = 1.5;

const peso = (minor: number) => `$${Math.round(minor / 100).toLocaleString('en-US')}`;
const veces = (n: number) => `${n.toFixed(1)}×`;

/**
 * One word per campaign, from numbers the screen also shows. "Return" here is the estimated contribution of the campaign's
 * online reservations divided by what it spent on the days reservations were tracked. Reservations by phone, walk-ins and
 * real spend per guest are not in it, so this is a floor on what the campaign brings, not a proof.
 */
export function verdictFor(c: Pick<CampaignRow, 'status' | 'spendMicros' | 'trackedSpendMicros' | 'reservations'> & { note?: string }, contributionMinor: number | null, floor: number): Verdict {
  const v = (key: VerdictKey, reason: string, contributionReturn: number | null = null): Verdict => ({ key, label: VERDICT_LABEL[key], reason, contributionReturn });
  const active = c.status === 'ENABLED' || c.status === 'ACTIVE';
  if (!active && c.spendMicros === 0) return v('pausada', 'Sin gasto en los últimos 28 días.');
  if (c.reservations === null) return v('sin_datos', c.note || 'No se pueden ver sus reservaciones en línea.');   // the campaign's own note says why (GA4 not connected, or untagged Meta visits)
  if (contributionMinor === null || contributionMinor <= 0) return v('sin_datos', 'Falta definir cuánto deja una reservación (Ajustes → Controles).');
  const spent = Math.round((c.trackedSpendMicros ?? 0) / 10_000);   // minor units
  if (spent <= 0) return v(active ? 'sin_datos' : 'pausada', 'Sin gasto desde que se miden las reservaciones.');
  const ret = (c.reservations * contributionMinor) / spent;
  if (c.reservations === 0) {
    if (spent >= 2 * contributionMinor) return v('pierde', `Gastó ${peso(spent)} y no trajo ninguna reservación en línea.`, 0);
    return v('vigilar', `Lleva ${peso(spent)} sin reservación en línea; todavía es poco para juzgarla.`, 0);
  }
  const n = `${c.reservations} ${c.reservations === 1 ? 'reservación' : 'reservaciones'}`;
  if (c.reservations < MIN_RESERVATIONS_TO_JUDGE) {
    if (ret < 1 && spent >= 3 * contributionMinor) return v('pierde', `Deja ${veces(ret)} lo que cuesta, con ${n} por ${peso(spent)}.`, ret);
    return v('vigilar', ret >= floor ? `Va bien (${veces(ret)}), pero con solo ${n} todavía no es concluyente.` : `Deja ${veces(ret)} lo que cuesta y el mínimo es ${veces(floor)}; con solo ${n} todavía no es concluyente.`, ret);
  }
  if (ret >= floor) return v('rinde', `Deja ${veces(ret)} lo que cuesta, con ${n}. El mínimo es ${veces(floor)}.`, ret);
  if (ret >= 1) return v('vigilar', `Deja ${veces(ret)} lo que cuesta, abajo del mínimo de ${veces(floor)}.`, ret);
  return v('pierde', `Deja ${veces(ret)} lo que cuesta: gasta más de lo que traen sus ${n}.`, ret);
}

export interface Split { google: number; meta: number; total: number }
export interface MonthPace {
  month: string; from: LocalDate; through: LocalDate; dayOfMonth: number; daysInMonth: number;
  spentMicros: Split;        // month to date, today's partial day included
  last7AvgMicros: Split;     // average of the last seven complete days
  projectedMicros: Split;    // complete days so far + the 7-day average for every day left, today included
  ceilingMicros: number | null; ceilingScope: 'whole_account' | 'managed_campaigns' | null;
}
export interface Yesterday { date: LocalDate; spendMicros: Split; onlineReservations: number | null; guests: number | null; posNetMinor: number | null }
export interface TodayView {
  today: LocalDate; currency: string; month: MonthPace; yesterday: Yesterday; floor: number;
  window: { from: LocalDate; to: LocalDate }; trackingSince: LocalDate | null;
  valuePerReservationMinor: number | null; contributionPerReservationMinor: number | null;
  campaigns: (CampaignRow & { verdict: Verdict })[];
}
export interface PolicyBits { monthlyAdSpendCeilingNative: number | null; ceilingCoversWholeAccount: boolean | null; minimumAcceptableContributionReturn: number | null }

const ORDER: Record<VerdictKey, number> = { pierde: 0, vigilar: 1, rinde: 2, sin_datos: 3, pausada: 4 };

export function monthPace(rows: { provider: string; date: string; cost: number }[], today: LocalDate, policy: PolicyBits | null): MonthPace {
  const [y, m, d] = today.split('-').map(Number) as [number, number, number];
  const from = `${today.slice(0, 8)}01`, daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const zero = (): Split => ({ google: 0, meta: 0, total: 0 });
  const add = (s: Split, provider: string, cost: number) => { if (provider === 'meta_ads') s.meta += cost; else s.google += cost; s.total += cost; };
  const spent = zero(), complete = zero(), week = zero();
  const weekFrom = addDays(today, -7), yesterday = addDays(today, -1);
  for (const r of rows) {
    const cost = Number(r.cost) || 0;
    if (r.date >= from && r.date <= today) add(spent, r.provider, cost);
    if (r.date >= from && r.date <= yesterday) add(complete, r.provider, cost);
    if (r.date >= weekFrom && r.date <= yesterday) add(week, r.provider, cost);
  }
  const left = daysInMonth - d + 1;   // days still to run, today included
  const avg = (k: keyof Split) => Math.round(week[k] / 7);
  const proj = (k: keyof Split) => complete[k] + avg(k) * left;
  const ceiling = policy?.monthlyAdSpendCeilingNative ?? null;
  return {
    month: today.slice(0, 7), from, through: today, dayOfMonth: d, daysInMonth, spentMicros: spent,
    last7AvgMicros: { google: avg('google'), meta: avg('meta'), total: avg('total') },
    projectedMicros: { google: proj('google'), meta: proj('meta'), total: proj('total') },
    ceilingMicros: ceiling === null ? null : Math.round(ceiling * 1_000_000),
    ceilingScope: ceiling === null || policy?.ceilingCoversWholeAccount == null ? null : policy.ceilingCoversWholeAccount ? 'whole_account' : 'managed_campaigns',
  };
}

export async function loadToday(db: D1Database, now: number, tz: string, currency: string, policy: PolicyBits | null): Promise<TodayView> {
  const today = localDate(now, tz), yesterday = addDays(today, -1);
  const since = [`${today.slice(0, 8)}01`, addDays(today, -7)].sort()[0]!;
  const [view, spend, res, pos] = await Promise.all([
    loadCampaigns(db, now, tz, currency),
    db.prepare(`SELECT a.provider AS provider, d.date AS date, SUM(d.cost_micros) AS cost FROM campaign_daily d JOIN ad_accounts a ON a.id = d.account_id
      WHERE d.date BETWEEN ? AND ? GROUP BY a.provider, d.date`).bind(since, today).all<{ provider: string; date: string; cost: number }>(),
    db.prepare('SELECT SUM(events) AS n, COUNT(*) AS filas FROM ga4_reservations_daily WHERE date = ? AND event_name = ?').bind(yesterday, RESERVATION_EVENT)
      .first<{ n: number | null; filas: number }>().catch(() => null),
    db.prepare(`SELECT COUNT(*) AS orders, SUM(total_minor - taxes_minor) AS net_minor, SUM(CASE WHEN order_type = 'DINE_IN' THEN COALESCE(customers, 0) ELSE 0 END) AS guests
      FROM pos_orders WHERE status = 'FINISHED' AND local_date = ?`).bind(yesterday).first<{ orders: number; net_minor: number | null; guests: number | null }>().catch(() => null),
  ]);
  const floor = policy?.minimumAcceptableContributionReturn ?? DEFAULT_RETURN_FLOOR;
  const contribution = view.estimate?.contributionMinor ?? null;
  const ySpend: Split = { google: 0, meta: 0, total: 0 };
  for (const r of spend.results) if (r.date === yesterday) { const c = Number(r.cost) || 0; if (r.provider === 'meta_ads') ySpend.meta += c; else ySpend.google += c; ySpend.total += c; }
  const campaigns = view.campaigns.map(c => ({ ...c, verdict: verdictFor(c, contribution, floor) }))
    .sort((a, b) => ORDER[a.verdict.key] - ORDER[b.verdict.key] || b.spendMicros - a.spendMicros);
  return {
    today, currency, month: monthPace(spend.results, today, policy), floor, window: view.window, trackingSince: view.trackingSince,
    yesterday: { date: yesterday, spendMicros: ySpend, onlineReservations: res && res.filas > 0 ? Number(res.n ?? 0) : null, guests: pos && pos.orders > 0 ? Number(pos.guests ?? 0) : null, posNetMinor: pos && pos.orders > 0 ? Number(pos.net_minor ?? 0) : null },
    valuePerReservationMinor: view.estimate?.valueMinor ?? null, contributionPerReservationMinor: contribution, campaigns,
  };
}
