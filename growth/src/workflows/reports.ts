// Reports: numbers first (deterministic fact payload), then an optional narrative that may only restate them.
// If the model is unavailable or its text fails validation, the templated narrative is published instead.
import type { Overview } from '../read/facts.ts';
import type { Metric, Delta } from '../domain/metrics.ts';
import { formatMinor } from '../domain/money.ts';

// Display words for enum values that appear in report text.
const PRODUCT_ES: Record<string, string> = { restaurant_visit: 'restaurante', tour_tasting: 'tours y catas', wine_order: 'pedidos de vino', private_event: 'eventos' };
const STATE_ES: Record<string, string> = { VERIFIED: 'verificado', PARTIALLY_APPLIED: 'aplicado en parte' };
const SEVERITY_ES: Record<string, string> = { critical: 'crítico', warning: 'aviso', info: 'info' };

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
  if (m.value === null) return `desconocido (${m.reason ?? 'no disponible'})`;
  switch (m.unit) {
    case 'money': return formatMinor({ currency: m.currency ?? currency, minor: Math.round(m.value) }, 'en-US');
    case 'ratio': return `${m.value.toFixed(2)}x`;
    case 'percent': return `${m.value.toFixed(0)}%`;
    default: return m.value.toLocaleString('en-US');
  }
}
export function displayDelta(d: Delta, m: Metric, currency: 'MXN' | 'USD'): string {
  if (d.absolute === null) return d.note ?? 'sin comparación';
  const abs = m.unit === 'money' ? formatMinor({ currency, minor: Math.round(d.absolute) }, 'en-US') : m.unit === 'ratio' ? `${d.absolute.toFixed(2)}x` : d.absolute.toLocaleString('en-US');
  const sign = d.absolute > 0 && !abs.startsWith('-') ? '+' : '';
  return `${sign}${abs}${d.percent !== null ? ` (${d.percent > 0 ? '+' : ''}${d.percent.toFixed(0)}%)` : ''} vs. los 28 días anteriores${d.provisional ? ', provisional' : ''}`;
}

export function buildFacts(kind: 'daily' | 'weekly', o: Overview, currency: 'MXN' | 'USD', activity: { label: string; state: string; actor: string; reason?: string }[], alerts: { severity: string; title: string }[]): ReportFacts {
  const fwd = (n: number) => o.capacity.days.filter(d => d.date >= o.today && d.date < addDaysStr(o.today, n) && (d.product === 'restaurant_visit' || d.product === 'tour_tasting'));
  const places = (ds: typeof o.capacity.days) => { const s = ds.reduce((a, d) => a + d.sellable, 0), r = ds.reduce((a, d) => a + d.reserved, 0), u = ds.reduce((a, d) => a + d.unknownSlots, 0); return `${r} de ${s} lugares conocidos reservados${u ? `; ${u} horario(s) con capacidad desconocida` : ''}`; };
  const q = o.quality;
  return {
    kind, period: { from: o.window.from!, to: o.window.to! }, cutoff: o.cutoff, dataKind: q.dataKind,
    headline: o.tickers.map(t => ({ key: t.key, label: t.label, display: displayMetric(t.metric, currency), change: displayDelta(t.delta, t.metric, currency), provisional: t.metric.provisional, basis: t.metric.basis, ...(t.metric.reason ? { reason: t.metric.reason } : {}) })),
    capacity: {
      next7: places(fwd(7)), next14: places(fwd(14)),
      soldOutDays: [...new Set(fwd(14).filter(d => d.status === 'sold_out').map(d => `${d.date} ${PRODUCT_ES[d.product] ?? d.product}`))],
      unknownDays: [...new Set(fwd(14).filter(d => d.status === 'unknown').map(d => `${d.date} ${PRODUCT_ES[d.product] ?? d.product}`))],
    },
    actions: {
      executed: activity.filter(a => a.state === 'VERIFIED' || a.state === 'PARTIALLY_APPLIED').map(a => `${a.label} (${STATE_ES[a.state] ?? a.state.toLowerCase()})`),
      rejected: activity.filter(a => a.state === 'REJECTED').map(a => `${a.label}${a.reason ? `: ${a.reason}` : ''}`),
      pendingApproval: activity.filter(a => a.state === 'APPROVAL_REQUIRED').map(a => a.label),
      shadow: activity.filter(a => a.state === 'SHADOWED').map(a => a.label),
    },
    attention: [
      ...alerts.filter(a => a.severity !== 'info').map(a => `${SEVERITY_ES[a.severity] ?? a.severity}: ${a.title}`),
      ...(q.contributionMissing ? [q.contributionMissing] : []),
      ...(q.spendDaysMissing.length ? [`Falta el gasto en anuncios de ${q.spendDaysMissing.length} día(s)`] : []),
      ...(q.conversionDaysMissing.length ? [`Faltan datos de conversiones de ${q.conversionDaysMissing.length} día(s); esos días no se cuentan como cero`] : []),
    ],
    dataQuality: [
      { display: `Cobertura de atribución: ${q.attributionCoverage === null ? 'desconocida' : `${q.attributionCoverage}%`} de las reservaciones pasadas tienen un canal conocido` },
      { display: `Cruce de ventas: ${q.salesMatchingCoverage === null ? 'desconocido' : `${q.salesMatchingCoverage}%`} de las reservaciones atendidas se cruzaron con un pago` },
      { display: `Cancelaciones ${q.cancellationRate ?? 'desconocido'}%, inasistencias ${q.noShowRate ?? 'desconocido'}%` },
      { display: q.lagKnown ? 'El tiempo de maduración de las reservaciones se estimó con datos' : 'Todavía no se estima el tiempo de maduración de las reservaciones: las cohortes recientes son provisionales y el escalamiento por rentabilidad está apagado' },
    ],
    attributionMethod: o.attributionMethod,
  };
}

function addDaysStr(d: string, n: number): string { const [y, m, dd] = d.split('-').map(Number) as [number, number, number]; return new Date(Date.UTC(y, m - 1, dd + n)).toISOString().slice(0, 10); }

/** Factual narrative with no model involved. Used when Claude is not configured, fails, or fails validation. */
export function templateNarrative(f: ReportFacts): string {
  const lines: string[] = [];
  lines.push(`${f.kind === 'daily' ? 'Reporte diario' : 'Reporte semanal'} del ${f.period.from} al ${f.period.to} (datos hasta el ${f.cutoff})${f.dataKind === 'demo' ? ' — DATOS DE DEMO, no son resultados reales' : ''}.`);
  for (const h of f.headline) lines.push(`${h.label}: ${h.display}; ${h.change}.`);
  const worse = f.headline.filter(h => /^-/.test(h.change));
  if (worse.length) lines.push(`Peor que el periodo anterior: ${worse.map(h => h.label.toLowerCase()).join(', ')}. Revisa el ritmo de gasto, la cobertura del seguimiento, la capacidad y los cambios recientes antes de sacar conclusiones.`);
  lines.push(`Capacidad de los próximos 7 días: ${f.capacity.next7}. Próximos 14 días: ${f.capacity.next14}.`);
  if (f.capacity.soldOutDays.length) lines.push(`Agotado: ${f.capacity.soldOutDays.join(', ')}.`);
  const a = f.actions;
  lines.push(a.executed.length ? `Cambios hechos: ${a.executed.join('; ')}.` : 'No se hizo ningún cambio en la cuenta de anuncios.');
  if (a.rejected.length) lines.push(`Rechazado por la política: ${a.rejected.join('; ')}.`);
  if (a.pendingApproval.length) lines.push(`Esperando tu aprobación: ${a.pendingApproval.join('; ')}.`);
  if (a.shadow.length) lines.push(`Modo sombra (no se ejecutó): ${a.shadow.join('; ')}.`);
  if (f.attention.length) lines.push(`Necesita atención: ${f.attention.join('; ')}.`);
  lines.push(`Atribución: ${f.attributionMethod}. Los resultados atribuidos no prueban resultados incrementales.`);
  return lines.join('\n');
}

/** Every string a narrative may quote numbers from. */
export const allowedNumbers = (f: ReportFacts): string[] => [
  ...f.headline.flatMap(h => [h.display, h.change]), f.capacity.next7, f.capacity.next14, ...f.capacity.soldOutDays, ...f.dataQuality.map(d => d.display), f.period.from, f.period.to, f.cutoff, ...f.attention,
];
