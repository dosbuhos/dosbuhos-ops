// "Hoy": what the owner needs in one minute. Decisions waiting, the month against its ceiling, and one row per campaign
// with a verdict in words. One number per card and no charts: the trends live in Reportes.
import { useApi } from '../api';
import { Loading, ErrorBox } from '../components';
import { microsMoney, money, int, dayLabel } from '../format';

const VERDICT_CLS: Record<string, string> = { rinde: 's-ok', vigilar: 's-warn', pierde: 's-bad', sin_datos: 's-mute', pausada: 's-mute' };
const MES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
/** Campaign names come from the ad platforms with underscores; spaces let them wrap on a phone. */
export const campaignName = (n: string) => n.replace(/_/g, ' ');
/** Alerts name the connection by its internal id; say it the way the owner would. */
const CONN: Record<string, string> = { opentable_availability: 'Disponibilidad de OpenTable', google_ads_script: 'Google Ads', hub_mirror: 'Gasto de Google y Meta', ga4: 'GA4 (reservaciones en línea)', parrot: 'Parrot', meta_ads: 'Meta' };
const alertTitle = (t: string) => t.replace(/^([a-z0-9_]+):/, (m, id: string) => (CONN[id] ? `${CONN[id]}:` : m));
const firstParagraph = (t: string) => t.replace(/\*\*/g, '').split(/\n\s*\n/)[0]!.trim();

export function Today({ overview, session }: { overview: any; session: any }) {
  const { data: t, error } = useApi('today', 120_000);
  if (!t) return error ? <ErrorBox error={error} /> : <div className="section"><Loading /></div>;
  const cur = t.currency, m = t.month, y = t.yesterday;
  const alerts = (overview?.alerts ?? []).filter((a: any) => a.severity !== 'info');
  const mes = MES[Number(m.month.slice(5)) - 1];
  const governed = m.ceilingScope === 'whole_account' ? m.spentMicros.google : null;      // the ceiling belongs to the Google account
  const pctOf = (x: number) => (m.ceilingMicros ? Math.min(100, Math.round((x / m.ceilingMicros) * 100)) : 0);
  const over = m.ceilingMicros !== null && m.projectedMicros.google > m.ceilingMicros;
  const judged = (t.campaigns as any[]).filter(c => c.verdict.key !== 'pausada');
  const paused = (t.campaigns as any[]).filter(c => c.verdict.key === 'pausada');

  return (
    <>
      {error && <ErrorBox error={error} stale />}
      <section className="section" aria-labelledby="dec">
        <header><h1 id="dec">Hoy</h1><span className="small muted">{dayLabel(t.today)}</span></header>
        {t.pending.length ? (
          <div className="list">{(t.pending as any[]).map(p => (
            <a key={p.id} className="decision" href="#sugerencias">
              <span className="state s-warn">Espera tu decisión</span>
              <b>{p.label}</b>
              <span className="small">{p.hypothesis}</span>
              <span className="go">Revisar y aprobar →</span>
            </a>))}</div>
        ) : (
          <div className="card quiet">
            <b>Sin decisiones pendientes.</b>
            {t.review?.text ? (
              <details className="why"><summary>{t.review.submitted ? 'Qué propuso la revisión de hoy' : `La revisión del ${dayLabel(t.review.date)} no propuso cambios. Ver por qué`}</summary>
                <p className="small">{firstParagraph(t.review.text)}</p><a className="small" href="#sugerencias">Abrir Sugerencias →</a></details>
            ) : <span className="small muted"> La revisión diaria corre a las 8:00.</span>}
          </div>
        )}
      </section>

      {alerts.length > 0 && (
        <section className="section" aria-label="Necesita atención">
          <div className="list">{alerts.map((a: any) => (
            <a key={a.dedupe_key} href={a.link || '#ajustes/conexiones'} className={`notice ${a.severity === 'critical' ? 'bad' : ''}`} style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
              <b>{alertTitle(a.title)}</b><div className="small">{a.detail}</div>
            </a>))}</div>
        </section>
      )}

      <section className="section" aria-labelledby="mes">
        <header><h2 id="mes">El mes</h2><span className="small muted">día {m.dayOfMonth} de {m.daysInMonth}</span></header>
        <div className="card pace">
          <div className="pace-top">
            <div><div className="bignum">{microsMoney(m.spentMicros.total, cur)}</div><div className="small muted">gastado en {mes}, Google y Meta</div></div>
            <div className="pace-proj"><div className={`midnum ${over ? 'warn' : ''}`}>{microsMoney(m.projectedMicros.total, cur)}</div><div className="small muted">donde cierra al ritmo de los últimos 7 días</div></div>
          </div>
          {m.ceilingMicros !== null && governed !== null && (
            <>
              <div className="pacebar" role="img" aria-label={`Google lleva ${pctOf(governed)}% del tope del mes`}>
                <span style={{ width: `${pctOf(governed)}%` }} />
                <i style={{ left: `${Math.round((m.dayOfMonth / m.daysInMonth) * 100)}%` }} title="Hoy" />
              </div>
              <div className="small">
                Google lleva <b>{microsMoney(m.spentMicros.google, cur)}</b> de su tope de <b>{microsMoney(m.ceilingMicros, cur)}</b> y cerraría en <b className={over ? 'warn' : ''}>{microsMoney(m.projectedMicros.google, cur)}</b>.
                {' '}Meta lleva <b>{microsMoney(m.spentMicros.meta, cur)}</b>; el tope no la cubre.
              </div>
            </>
          )}
          {m.ceilingMicros !== null && governed === null && <div className="small">Google {microsMoney(m.spentMicros.google, cur)} · Meta {microsMoney(m.spentMicros.meta, cur)}. Tope de {microsMoney(m.ceilingMicros, cur)} para las campañas que la app administra.</div>}
          {m.ceilingMicros === null && <div className="small muted">Google {microsMoney(m.spentMicros.google, cur)} · Meta {microsMoney(m.spentMicros.meta, cur)}. Todavía no hay tope mensual definido (Ajustes → Controles).</div>}
        </div>
      </section>

      <section className="section" aria-labelledby="camp">
        <header><h2 id="camp">Cómo va cada campaña</h2><span className="small muted">últimos 28 días · reservaciones en línea</span></header>
        <div className="board">
          {judged.map(c => (
            <a key={c.ref} className="brow" href="#campanas">
              <div className="brow-top">
                <span className={`verdict ${VERDICT_CLS[c.verdict.key]}`}>{c.verdict.label}</span>
                <b className="bname">{campaignName(c.name)}</b>
                {c.status !== 'ENABLED' && c.status !== 'ACTIVE' && <span className="chip">pausada</span>}
                <span className="chip">{c.provider === 'meta_ads' ? 'Meta' : 'Google'}</span>
              </div>
              <div className="bnums">
                <div><span>Gasto</span><b>{microsMoney(c.spendMicros, cur)}</b></div>
                <div><span>Reservaciones</span><b>{c.reservations === null ? '—' : int(c.reservations)}</b></div>
                <div><span>Costo de cada una</span><b>{c.costPerReservationMinor === null ? '—' : money(c.costPerReservationMinor, cur)}</b></div>
                <div><span>Deja por cada peso</span><b>{c.verdict.contributionReturn === null ? '—' : `${c.verdict.contributionReturn.toFixed(1)}×`}</b></div>
              </div>
              <div className="small muted">{c.verdict.reason}</div>
            </a>))}
          {!judged.length && <div className="card small muted">No hay campañas activas con gasto en los últimos 28 días.</div>}
        </div>
        {paused.length > 0 && <p className="tiny muted">En pausa y sin gasto: {paused.map(c => campaignName(c.name)).join(' · ')}.</p>}
        <details className="why"><summary>Cómo se decide cada veredicto</summary>
          <p className="small">
            “Deja por cada peso” es lo que dejan sus reservaciones en línea ({t.contributionPerReservationMinor === null ? 'sin valor definido' : `${money(t.contributionPerReservationMinor, cur)} cada una después de costos`}) entre lo que gastó en los días con seguimiento.
            {' '}<b>Rinde</b>: {t.floor.toFixed(1)}× o más con al menos 5 reservaciones. <b>Vigilar</b>: cubre su costo pero no llega al mínimo, o todavía tiene pocas reservaciones. <b>Pierde dinero</b>: gasta más de lo que traen sus reservaciones.
            {' '}No cuenta las reservaciones por teléfono, a quienes llegan sin reservar ni lo que cada mesa consumió, así que es un piso, no una prueba.
          </p>
        </details>
      </section>

      <section className="section" aria-labelledby="ayer">
        <header><h2 id="ayer">Ayer</h2><span className="small muted">{dayLabel(y.date)}</span></header>
        <div className="grid four">
          <div className="card stat"><span>Gasto en anuncios</span><b>{microsMoney(y.spendMicros.total, cur)}</b></div>
          <div className="card stat"><span>Reservaciones en línea</span><b>{y.onlineReservations === null ? '—' : int(y.onlineReservations)}</b>{y.onlineReservations === null && <i>GA4 todavía no entrega el día</i>}</div>
          <div className="card stat"><span>Comensales en el restaurante</span><b>{y.guests === null ? '—' : int(y.guests)}</b></div>
          <div className="card stat"><span>Ventas en Parrot, sin IVA</span><b>{y.posNetMinor === null ? '—' : money(y.posNetMinor, cur)}</b></div>
        </div>
      </section>
      {session?.user?.role === 'viewer' && <p className="tiny muted section">Tu acceso es de lectura.</p>}
    </>
  );
}
