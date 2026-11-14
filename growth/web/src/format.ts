// Formatting. Money arrives in integer minor units (or micros) with a currency; never floating-point arithmetic here.
export const money = (minor: number | null | undefined, currency = 'MXN', digits = 0) =>
  minor === null || minor === undefined ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: digits, minimumFractionDigits: digits }).format(minor / 100);
export const microsMoney = (m: number | null | undefined, currency = 'MXN') => (m === null || m === undefined ? '—' : money(Math.round(m / 10_000), currency));
export const int = (n: number | null | undefined) => (n === null || n === undefined ? '—' : new Intl.NumberFormat('en-US').format(Math.round(n)));
export const ratio = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${n.toFixed(2)}×`);
export const pct = (n: number | null | undefined, d = 0) => (n === null || n === undefined ? '—' : `${n.toFixed(d)}%`);

export function metricValue(m: { value: number | null; unit: string; currency?: string }, currency = 'MXN'): string {
  if (m.value === null) return 'Desconocido';
  if (m.unit === 'money') return money(m.value, m.currency ?? currency);
  if (m.unit === 'ratio') return ratio(m.value);
  if (m.unit === 'percent') return pct(m.value);
  return int(m.value);
}
export function deltaText(d: { absolute: number | null; percent: number | null; note?: string }, unit: string, currency = 'MXN'): string {
  if (d.absolute === null) return d.note ?? 'Sin comparación';
  const sign = d.absolute > 0 ? '+' : d.absolute < 0 ? '−' : '±';
  const a = Math.abs(d.absolute);
  const abs = unit === 'money' ? money(a, currency) : unit === 'ratio' ? `${a.toFixed(2)}×` : unit === 'percent' ? `${a.toFixed(0)} pts` : int(a);
  return `${sign}${abs}${d.percent !== null ? ` (${d.percent > 0 ? '+' : d.percent < 0 ? '−' : ''}${Math.abs(d.percent).toFixed(0)}%)` : ''}`;
}

const TZ = 'America/Mexico_City';
export const ago = (ms: number | null | undefined) => {
  if (!ms) return 'nunca';
  const m = Math.round((Date.now() - ms) / 60_000);
  if (m < 1) return 'justo ahora';
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 36) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} d`;
};
export const when = (ms: number | null | undefined) => (ms ? new Intl.DateTimeFormat('es-MX', { timeZone: TZ, dateStyle: 'medium', timeStyle: 'short' }).format(ms) : '—');
/** "sáb 14 nov": weekday first, single spaces, no "de" or trailing dots (callers split on spaces). */
const DAY_FMT = new Intl.DateTimeFormat('es-MX', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' });
export const dayLabel = (d: string) => {
  const [y, m, dd] = d.split('-').map(Number);
  const parts = DAY_FMT.formatToParts(Date.UTC(y!, m! - 1, dd!));
  const part = (t: string) => (parts.find(p => p.type === t)?.value ?? '').replace(/[.,]/g, '');
  return `${part('weekday')} ${part('day')} ${part('month')}`;
};
export const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

export const PRODUCT_LABEL: Record<string, string> = { restaurant_visit: 'Restaurante', tour_tasting: 'Tours y catas', wine_order: 'Pedidos de vino', private_event: 'Eventos' };
export const MODE_INFO: Record<string, { label: string; cls: string; text: string }> = {
  DEMO: { label: 'Demo', cls: 's-warn', text: 'Datos sintéticos y una cuenta de anuncios simulada. Nada llega a Google Ads.' },
  OBSERVE: { label: 'Observar', cls: 's-info', text: 'Lecturas y reportes reales. No se ejecuta ninguna propuesta.' },
  SHADOW: { label: 'Sombra', cls: 's-info', text: 'Las propuestas y decisiones hipotéticas se registran, pero nunca se ejecutan. Los resultados hipotéticos no son ganancias.' },
  LIMITED_AUTO: { label: 'Automático limitado', cls: 's-ok', text: 'Solo los tipos de acción que permitiste corren en automático, dentro de tus límites. Todo lo demás espera tu aprobación.' },
  PAUSED: { label: 'En pausa', cls: 's-mute', text: 'Sin cambios de optimización. Los reportes y los datos siguen.' },
  EMERGENCY_LOCK: { label: 'Bloqueo de emergencia', cls: 's-bad', text: 'Se rechazan todos los cambios de crecimiento. Las pausas de protección siguen funcionando.' },
};
export const STATE_CLS: Record<string, string> = {
  VERIFIED: 's-ok', COMPENSATED: 's-info', REJECTED: 's-mute', SHADOWED: 's-info', APPROVAL_REQUIRED: 's-warn', APPROVED: 's-info', EXPIRED: 's-mute',
  PREPARING: 's-info', EXECUTING: 's-info', APPLIED: 's-info', PARTIALLY_APPLIED: 's-warn', UNKNOWN_OUTCOME: 's-bad', RECONCILING: 's-warn', COMPENSATION_REQUIRED: 's-warn', FAILED: 's-bad',
};
const STATE_LABEL: Record<string, string> = {
  PROPOSED: 'Propuesta', VERIFIED: 'Verificada', COMPENSATED: 'Revertida', REJECTED: 'Rechazada', SHADOWED: 'En sombra', APPROVAL_REQUIRED: 'Requiere aprobación',
  APPROVED: 'Aprobada', EXPIRED: 'Vencida', PREPARING: 'Preparando', EXECUTING: 'Ejecutando', APPLIED: 'Aplicada', PARTIALLY_APPLIED: 'Aplicada en parte',
  UNKNOWN_OUTCOME: 'Resultado desconocido', RECONCILING: 'Conciliando', COMPENSATION_REQUIRED: 'Requiere reversión', FAILED: 'Fallida',
};
export const stateLabel = (s: string) => STATE_LABEL[s] ?? s.replace(/_/g, ' ').toLowerCase().replace(/^./, c => c.toUpperCase());

// Display words for enum values the API sends as codes. Unknown codes fall back to the code itself.
const label = (map: Record<string, string>) => (k: string | null | undefined) => (k == null ? '—' : map[k] ?? k);
export const basisLabel = label({ observed: 'observado', attributed: 'atribuido', modeled: 'modelado', experimental: 'experimental' });
export const jobStatusLabel = label({ succeeded: 'completada', failed: 'fallida', skipped: 'omitida', claimed: 'en curso', running: 'en curso' });
export const importStatusLabel = label({ previewed: 'en vista previa', committed: 'importada' });
export const campaignStatusLabel = (s: string) => ({ ENABLED: 'activa', ACTIVE: 'activa', PAUSED: 'pausada', REMOVED: 'eliminada', ARCHIVED: 'archivada' } as Record<string, string>)[s] ?? (s.toLowerCase() || 'desconocido');
export const bookingStatusLabel = label({ confirmed: 'confirmada', cancelled: 'cancelada', attended: 'atendida', no_show: 'no se presentó', refunded: 'reembolsada' });
export const managedByLabel = label({ app: 'esta app', owner: 'el dueño', agency: 'la agencia', unknown: 'desconocido' });
export const directionLabel = label({ increase: 'sube', decrease: 'baja', no_change: 'sin cambio' });
export const slotStatusLabel = label({ open: 'libre', sold_out: 'agotado', blocked: 'bloqueado', closed: 'cerrado', unknown: 'desconocido' });
/** Connection purposes are seeded in English in D1; show the known ones in Spanish (anything else as stored). */
const PURPOSE_ES: Record<string, string> = {
  'Google Ads reads (hourly script feed)': 'Lectura de Google Ads (feed del script, cada hora)', 'Google Ads changes (API)': 'Cambios en Google Ads (API)',
  'Restaurant + experience bookings (CSV export)': 'Reservaciones del restaurante y experiencias (exportación CSV)', 'Website analytics': 'Analítica del sitio web',
  'Analysis and report narrative': 'Análisis y narrativa de los reportes', 'Offline conversions back to Google Ads': 'Conversiones offline de vuelta a Google Ads',
  'Wine sales': 'Ventas de vino', 'Restaurant checks': 'Cuentas del restaurante',
};
export const purposeLabel = (purpose: string) => PURPOSE_ES[purpose] ?? purpose;
