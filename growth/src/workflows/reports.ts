// Reports: numbers first (deterministic fact payload), then an optional narrative that may only restate them.
// If the model is unavailable or its text fails validation, the templated narrative is published instead.
import type { Overview } from '../read/facts.ts';
import type { Metric, Delta } from '../domain/metrics.ts';
import { formatMinor } from '../domain/money.ts';

export interface ReportFacts {
  kind: 'daily' | 'weekly';
  period: { from: string; to: string };
  cutoff: string;
  dataKind: string;
  headline: { key: string; label: string; display: string; change: string; provisional: boolean; basis: string; reason?: string }[];
  capacity: { next7: string; next14: string; soldOutDays: string[]; unknownDays: string[] };
  actions: { executed: string[]; rejected: string[]; pendingApproval: string[]; shadow: string[] };
  attention: string[];
  dataQuality: { display: string }[];
  attributionMethod: string;
}

export function displayMetric(m: Metric, currency: 'MXN' | 'USD'): string {
  if (m.value === null) return `unknown (${m.reason ?? 'not available'})`;
  switch (m.unit) {
    case 'money': return formatMinor({ currency: m.currency ?? currency, minor: Math.round(m.value) }, 'en-US');
    case 'ratio': return `${m.value.toFixed(2)}x`;
    case 'percent': return `${m.value.toFixed(0)}%`;
    default: return m.value.toLocaleString('en-US');
  }
}
export function displayDelta(d: Delta, m: Metric, currency: 'MXN' | 'USD'): string {
  if (d.absolute === null) return d.note ?? 'no comparison';
  const abs = m.unit === 'money' ? formatMinor({ currency, minor: Math.round(d.absolute) }, 'en-US') : m.unit === 'ratio' ? `${d.absolute.toFixed(2)}x` : d.absolute.toLocaleString('en-US');
  const sign = d.absolute > 0 && !abs.startsWith('-') ? '+' : '';
  return `${sign}${abs}${d.percent !== null ? ` (${d.percent > 0 ? '+' : ''}${d.percent.toFixed(0)}%)` : ''} vs previous 28 days${d.provisional ? ', provisional' : ''}`;
}

export function buildFacts(kind: 'daily' | 'weekly', o: Overview, currency: 'MXN' | 'USD', activity: { label: string; state: string; actor: string; reason?: string }[], alerts: { severity: string; title: string }[]): ReportFacts {
  const fwd = (n: number) => o.capacity.days.filter(d => d.date >= o.today && d.date < addDaysStr(o.today, n) && (d.product === 'restaurant_visit' || d.product === 'tour_tasting'));
  const places = (ds: typeof o.capacity.days) => { const s = ds.reduce((a, d) => a + d.sellable, 0), r = ds.reduce((a, d) => a + d.reserved, 0), u = ds.reduce((a, d) => a + d.unknownSlots, 0); return `${r} of ${s} known places booked${u ? `; ${u} slot(s) with unknown capacity` : ''}`; };
  const q = o.quality;
  return {
    kind, period: { from: o.window.from!, to: o.window.to! }, cutoff: o.cutoff, dataKind: q.dataKind,
    headline: o.tickers.map(t => ({ key: t.key, label: t.label, display: displayMetric(t.metric, currency), change: displayDelta(t.delta, t.metric, currency), provisional: t.metric.provisional, basis: t.metric.basis, ...(t.metric.reason ? { reason: t.metric.reason } : {}) })),
    capacity: {
      next7: places(fwd(7)), next14: places(fwd(14)),
      soldOutDays: [...new Set(fwd(14).filter(d => d.status === 'sold_out').map(d => `${d.date} ${d.product}`))],
      unknownDays: [...new Set(fwd(14).filter(d => d.status === 'unknown').map(d => `${d.date} ${d.product}`))],
    },
    actions: {
      executed: activity.filter(a => a.state === 'VERIFIED' || a.state === 'PARTIALLY_APPLIED').map(a => `${a.label} (${a.state.toLowerCase()})`),
      rejected: activity.filter(a => a.state === 'REJECTED').map(a => `${a.label}${a.reason ? `: ${a.reason}` : ''}`),
      pendingApproval: activity.filter(a => a.state === 'APPROVAL_REQUIRED').map(a => a.label),
      shadow: activity.filter(a => a.state === 'SHADOWED').map(a => a.label),
    },
    attention: [
      ...alerts.filter(a => a.severity !== 'info').map(a => `${a.severity}: ${a.title}`),
      ...(q.contributionMissing ? [q.contributionMissing] : []),
      ...(q.spendDaysMissing.length ? [`Ad spend missing for ${q.spendDaysMissing.length} day(s)`] : []),
      ...(q.conversionDaysMissing.length ? [`Conversion data missing for ${q.conversionDaysMissing.length} day(s) — those days are not counted as zero`] : []),
    ],
    dataQuality: [
      { display: `Attribution coverage: ${q.attributionCoverage === null ? 'unknown' : `${q.attributionCoverage}%`} of past bookings have a known channel` },
      { display: `Sales matching: ${q.salesMatchingCoverage === null ? 'unknown' : `${q.salesMatchingCoverage}%`} of attended bookings matched to a payment` },
      { display: `Cancellations ${q.cancellationRate ?? 'unknown'}%, no-shows ${q.noShowRate ?? 'unknown'}%` },
      { display: q.lagKnown ? 'Booking maturation lag estimated from data' : 'Booking maturation lag not yet estimated: recent cohorts are provisional and profitability-based scaling is off' },
    ],
    attributionMethod: o.attributionMethod,
  };
}

function addDaysStr(d: string, n: number): string { const [y, m, dd] = d.split('-').map(Number) as [number, number, number]; return new Date(Date.UTC(y, m - 1, dd + n)).toISOString().slice(0, 10); }

/** Factual narrative with no model involved. Used when Claude is not configured, fails, or fails validation. */
export function templateNarrative(f: ReportFacts): string {
  const lines: string[] = [];
  lines.push(`${f.kind === 'daily' ? 'Daily' : 'Weekly'} report for ${f.period.from} to ${f.period.to} (data through ${f.cutoff})${f.dataKind === 'demo' ? ' — DEMO DATA, not real results' : ''}.`);
  for (const h of f.headline) lines.push(`${h.label}: ${h.display}; ${h.change}.`);
  const worse = f.headline.filter(h => /^-/.test(h.change));
  if (worse.length) lines.push(`Worse than the previous period: ${worse.map(h => h.label.toLowerCase()).join(', ')}. Check spend pacing, tracking coverage, capacity and recent changes before drawing conclusions.`);
  lines.push(`Capacity next 7 days: ${f.capacity.next7}. Next 14 days: ${f.capacity.next14}.`);
  if (f.capacity.soldOutDays.length) lines.push(`Sold out: ${f.capacity.soldOutDays.join(', ')}.`);
  const a = f.actions;
  lines.push(a.executed.length ? `Changes made: ${a.executed.join('; ')}.` : 'No changes were made to the ad account.');
  if (a.rejected.length) lines.push(`Rejected by policy: ${a.rejected.join('; ')}.`);
  if (a.pendingApproval.length) lines.push(`Waiting for your approval: ${a.pendingApproval.join('; ')}.`);
  if (a.shadow.length) lines.push(`Shadow mode (not executed): ${a.shadow.join('; ')}.`);
  if (f.attention.length) lines.push(`Needs attention: ${f.attention.join('; ')}.`);
  lines.push(`Attribution: ${f.attributionMethod}. Attributed results are not proof of incremental results.`);
  return lines.join('\n');
}

/** Every string a narrative may quote numbers from. */
export const allowedNumbers = (f: ReportFacts): string[] => [
  ...f.headline.flatMap(h => [h.display, h.change]), f.capacity.next7, f.capacity.next14, ...f.capacity.soldOutDays, ...f.dataQuality.map(d => d.display), f.period.from, f.period.to, f.cutoff, ...f.attention,
];
