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
  PREPARING: 's-info', EXECUTING: 's-info', APPLIED: 's-info', PARTIALLY_APPLIED: 's-warn', UNKNOWN_OUTCOME: 's-warn', RECONCILING: 's-warn', COMPENSATION_REQUIRED: 's-warn', FAILED: 's-bad',
};
const STATE_LABEL: Record<string, string> = {
  PROPOSED: 'Propuesta', VERIFIED: 'Verificada', COMPENSATED: 'Revertida', REJECTED: 'Rechazada', SHADOWED: 'En sombra', APPROVAL_REQUIRED: 'Requiere aprobación',
  APPROVED: 'Aprobada', EXPIRED: 'Vencida', PREPARING: 'Preparando', EXECUTING: 'Ejecutando', APPLIED: 'Aplicada', PARTIALLY_APPLIED: 'Aplicada en parte',
  UNKNOWN_OUTCOME: 'En cola / por verificar', RECONCILING: 'Conciliando', COMPENSATION_REQUIRED: 'Requiere reversión', FAILED: 'Fallida',
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
/** Connection purposes and the first status texts were stored in English in D1; show the known ones in Spanish
 *  (anything else as stored: what the jobs write later is already in Spanish). Apostrophes are compared straight. */
const PURPOSE_ES: Record<string, string> = {
  'Google Ads reads (hourly script feed)': 'Lectura de Google Ads (feed del script, cada hora)', 'Google Ads changes (API)': 'Cambios en Google Ads (API)',
  "Google Ads reads (Growth's own richer script feed)": 'Google Ads: lectura y cambios aprobados (script de Growth, cada hora)',
  "Google Ads reads (via the Hub's hourly Google Ads Script)": 'Google Ads por medio del Hub (feed anterior)',
  "Meta Ads reads (via the Hub's hourly Meta sync)": 'Lectura de Meta Ads (copia del Hub, cada hora)', 'Meta Ads': 'Meta Ads',
  'Restaurant + experience bookings (CSV export)': 'Reservaciones del restaurante y experiencias (exportación CSV)', 'Restaurant + experience bookings': 'Reservaciones del restaurante y experiencias (datos de OpenTable)',
  'OpenTable online reservations (via GA4 event ot-reservation-made)': 'Reservaciones en línea de OpenTable (vía GA4)',
  'Capacity: bookable times on OpenTable (restaurant + Experiences)': 'Capacidad: horarios disponibles en OpenTable (restaurante y experiencias)',
  'Website analytics': 'Analítica del sitio web',
  'Analysis and report narrative': 'Análisis y narrativa de los reportes', 'Offline conversions back to Google Ads': 'Conversiones offline de vuelta a Google Ads',
  'Wine sales': 'Ventas de vino', 'Restaurant checks': 'Cuentas del restaurante',
};
const REASON_ES: Record<string, string> = {
  'Shared ANTHROPIC_API_KEY from the account Secrets Store: report narrative now; analysis proposals only in Shadow mode': 'Usa la clave compartida de la cuenta (ANTHROPIC_API_KEY): escribe los reportes y hace la revisión de cada mañana.',
  "Needs approved Google Ads API access for the owner's Cloud project and owner OAuth": 'Falta que Google apruebe el acceso a su API. Mientras tanto, los cambios que apruebas los aplica el script.',
  'Reading the Hub feed: daily spend, clicks and platform conversions per campaign by name; no campaign IDs or search terms yet': 'Feed anterior, por medio del Hub. Ya no se usa: lo reemplazó el script de Growth, que lee más datos.',
  'Mirrored hourly from the Hub: daily spend and results per campaign (by name), converted to MXN; no changes possible': 'Copiado cada hora desde el Hub: gasto y resultados diarios por campaña, en pesos. Desde aquí no se puede cambiar nada en Meta.',
  'OpenTable reservation data is partner-only; requested through the OpenTable account manager': 'OpenTable solo entrega los datos de reservaciones a socios; se piden por medio del ejecutivo de cuenta de OpenTable.',
  'Create a feed token and install scripts/google-ads-feed.js in Google Ads': 'Copia el script desde esta tarjeta y pégalo en Google Ads.',
  'Import a GuestCenter reservation export': 'Importa un archivo de reservaciones de GuestCenter.',
  'Tag audit pending': 'Falta revisar las etiquetas.', 'Tag audit pending (owner approval before any change)': 'Falta revisar las etiquetas (se pide tu aprobación antes de cualquier cambio).',
  'Optional secret ANTHROPIC_API_KEY': 'Opcional: secreto ANTHROPIC_API_KEY.',
  'Optional: without a key, reports use the factual template and no proposals are drafted': 'Opcional: sin la clave, los reportes usan la plantilla con los datos y no se redactan propuestas.',
  'Phase 2': 'Fase 2', 'Phase 3': 'Fase 3', 'Phase 4': 'Fase 4', 'Phase 2: needs a reliable completed-visit signal first': 'Fase 2: primero hace falta una señal confiable de visita completada.',
  'No public API found; export-based import in Phase 3': 'No se encontró una API pública; importación por archivo en la fase 3.',
  "Phase 4 (read today in the Hub's Anuncios)": 'Fase 4 (hoy se lee en Anuncios, en el Hub).',
  'Demo: synthetic feed': 'Demo: feed sintético.', 'Demo: synthetic bookings. OpenTable offers no reservation API to restaurants': 'Demo: reservaciones sintéticas. OpenTable no ofrece una API de reservaciones a los restaurantes.',
};
const straight = (t: string) => t.replace(/[\u2018\u2019]/g, "'");
export const purposeLabel = (purpose: string) => PURPOSE_ES[straight(purpose)] ?? purpose;
export const reasonLabel = (reason: string | null | undefined) => (reason ? REASON_ES[straight(reason)] ?? reason : '');

/** 9 ago 2026: a day with its year, for periods that are not this year. */
export const fullDate = (d: string) => {
  const [y, m, dd] = d.split('-').map(Number);
  return `${dd} ${['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'][m! - 1]} ${y}`;
};
/** +26% / −4%, with a real minus sign. */
export const signedPct = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${Math.abs(n).toFixed(0)}%`;

/** A suggestion's headline in plain words: what would change. */
export function pitchTitle(actionType: string | null | undefined, params: { text?: string | null; changePct?: number | null } | null | undefined, fallback = ''): string {
  switch (actionType) {
    case 'add_negative_keyword_exact': return `Dejar de pagar por “${params?.text ?? ''}”`;
    case 'block_search_theme': return `Dejar de pagar por búsquedas con “${params?.text ?? ''}”`;
    case 'campaign_budget_change': return `${(params?.changePct ?? 0) > 0 ? 'Subir' : 'Bajar'} ${Math.abs(params?.changePct ?? 0)}% el presupuesto diario`;
    case 'budget_reallocation': return 'Mover presupuesto a otra campaña';
    case 'pause_campaign': return 'Pausar la campaña';
    case 'pause_ad': return 'Pausar un anuncio';
    default: return fallback;
  }
}
/** A paragraph as bullets, one per sentence. */
export const sentences = (text: string): string[] => String(text ?? '').split(/(?<=[.!?])\s+/).map(x => x.trim()).filter(Boolean);
/** 12 clics, 1 clic: a count with its word. */
export const count = (n: number, one: string, many: string) => `${int(n)} ${n === 1 ? one : many}`;
