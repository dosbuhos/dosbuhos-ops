// "Hoy": what the owner needs in one minute. Decisions waiting, the month against its ceiling, and one row per campaign
// with a verdict in words. One number per card and no charts: the trends live in Reportes.
import { useApi } from '../api';
import { Loading, ErrorBox } from '../components';
import { microsMoney, money, int, dayLabel, fullDate, signedPct, pitchTitle, sentences, count } from '../format';
import { ResultLine } from './Operate';

const VERDICT_CLS: Record<string, string> = { rinde: 's-ok', vigilar: 's-warn', pierde: 's-bad', sin_datos: 's-mute', pausada: 's-mute' };
const MES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
/** Campaign names come from the ad platforms with underscores; spaces let them wrap on a phone. */
export const campaignName = (n: string) => n.replace(/_/g, ' ');
/** Alerts name the connection by its internal id; say it the way the owner would. */
const CONN: Record<string, string> = { opentable_availability: 'Disponibilidad de OpenTable', google_ads_script: 'Google Ads', hub_mirror: 'Gasto de Google y Meta', ga4: 'GA4 (reservaciones en línea)', parrot: 'Parrot', meta_ads: 'Meta', stripe: 'Stripe (pagos en línea)' };
const alertTitle = (t: string) => t.replace(/^([a-z0-9_]+):/, (m, id: string) => (CONN[id] ? `${CONN[id]}:` : m));
const firstParagraph = (t: string) => t.replace(/\*\*/g, '').split(/\n\s*\n/)[0]!.trim();

export function Today({ overview, session }: { overview: any; session: any }) {
  const { data: t, error } = useApi('today', 120_000);
  if (!t) return error ? <ErrorBox error={error} /> : <div className="section"><Loading /></div>;
  const cur = t.currency, m = t.month, y = t.yesterday, s28 = t.sales28 ?? null;
  const alerts = (overview?.alerts ?? []).filter((a: any) => a.severity !== 'info');
  const mes = MES[Number(m.month.slice(5)) - 1];
  const governed = m.ceilingScope === 'whole_account' ? m.spentMicros.google : null;      // the ceiling belongs to the Google account
  const pctOf = (x: number) => (m.ceilingMicros ? Math.min(100, Math.round((x / m.ceilingMicros) * 100)) : 0);
  const over = m.ceilingMicros !== null && m.projectedMicros.google > m.ceilingMicros;
  const judged = (t.campaigns as any[]).filter(c => c.verdict.key !== 'pausada');
  const findings = (t.advice as any[] | undefined) ?? [], results = (t.results as any[] | undefined) ?? [];
  const focus = (id: string) => { try { sessionStorage.setItem('growth-focus-action', id); } catch { /* the link still opens Sugerencias */ } };
  const paused = (t.campaigns as any[]).filter(c => c.verdict.key === 'pausada');

  return (
    <>
      {error && <ErrorBox error={error} stale />}
      <section className="section" aria-labelledby="dec">
        <header><h1 id="dec">Hoy</h1><span className="small muted">{dayLabel(t.today)}</span></header>
        {t.pending.length ? (
          <div className="list">{(t.pending as any[]).map(p => (
            <a key={p.id} className="decision" href="#sugerencias" onClick={() => focus(p.id)}>
              <span className="state s-warn">Espera tu decisión</span>
              <b>{p.title || pitchTitle(p.actionType, p, p.label)}</b>
              <span className="tiny muted">Campaña: {campaignName(p.label)}</span>
              <span className="small">{p.impact ? `${count(p.impact.searches, 'búsqueda', 'búsquedas')}, ${count(p.impact.clicks, 'clic', 'clics')} y ${microsMoney(p.impact.costMicros, cur)} en 28 días, sin una sola reservación en línea.` : sentences(p.hypothesis).slice(0, 2).join(' ')}</span>
              <span className="go">Revisar y aprobar →</span>
            </a>))}</div>
        ) : (
          <div className="card quiet">
            <b>Sin decisiones pendientes.</b>
            {t.review?.text || t.review?.rules ? (
              <details className="why"><summary>{t.review.submitted ? `Qué propuso la revisión del ${dayLabel(t.review.date)}` : `La revisión del ${dayLabel(t.review.date)} no propuso cambios. Ver por qué`}</summary>
                {t.review.rules && <p className="small muted">{t.review.rules}</p>}
                {t.review.text && <p className="small">{firstParagraph(t.review.text)}</p>}
                <a className="small" href="#sugerencias">Abrir Sugerencias →</a></details>
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

      {results.length > 0 && (
        <section className="section" aria-labelledby="res">
          <header><h2 id="res">Lo que pasó después</h2><span className="small muted">Los cambios que aprobaste, antes y después</span></header>
          <div className="list">{results.map(r => (
            <a key={r.actionId} className="finding" href="#sugerencias" onClick={() => focus(r.actionId)}>
              <b>{r.title}</b>
              <span className="tiny muted">Campaña: {campaignName(r.campaign)}</span>
              <ResultLine r={r} />
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

      {findings.length > 0 && (
        <section className="section" aria-labelledby="rev">
          <header><h2 id="rev">Hallazgos</h2><span className="small muted">En las búsquedas de los últimos 28 días</span></header>
          {t.script && !t.script.sendsKeywords && findings.some(f => f.kind === 'theme_place' || f.kind === 'theme_competitor') && (
            <a className="notice info small" href="#ajustes/conexiones" style={{ display: 'block', textDecoration: 'none', color: 'inherit', marginBottom: 8 }}>
              <b>Para aprobar estos cambios con un toque falta un paso:</b> pegar el script nuevo de Google Ads. Está listo para copiar en Ajustes → Conexiones →
            </a>
          )}
          <div className="list">{findings.slice(0, 4).map(f => (
            <a key={f.key} className="finding" href="#sugerencias">
              <div className="finding-top"><b>{f.title}</b><span className="mono">{microsMoney(f.money, cur)}</span></div>
              <span className="tiny muted">Campaña: {campaignName(f.campaign)}</span>
              <span className="small">{(f.why as string[]).slice(0, 2).join(' ')}</span>
            </a>))}</div>
          <a className="small more" href="#sugerencias">{findings.length > 4 ? `Y ${findings.length - 4} más, con el detalle de cada uno, en Sugerencias →` : 'El detalle de cada uno está en Sugerencias →'}</a>
        </section>
      )}
      <section className="section" aria-labelledby="ayer">
        <header><h2 id="ayer">Ayer</h2><span className="small muted">{dayLabel(y.date)}</span></header>
        <div className="grid four">
          <div className="card stat"><span>Gasto en anuncios</span><b>{microsMoney(y.spendMicros.total, cur)}</b></div>
          <div className="card stat"><span>Reservaciones en línea</span><b>{y.onlineReservations === null ? '—' : int(y.onlineReservations)}</b>{y.onlineReservations === null && <i>GA4 todavía no entrega el día</i>}</div>
          <div className="card stat"><span>Comensales en el restaurante</span><b>{y.guests === null ? '—' : int(y.guests)}</b></div>
          <div className="card stat"><span>Ventas en Parrot, sin IVA</span><b>{y.posNetMinor === null ? '—' : money(y.posNetMinor, cur)}</b></div>
        </div>
        {s28 && s28.netMinor !== null && (
          <p className="small card yoy">
            <b>Últimos 28 días:</b> {money(s28.netMinor, cur)} vendidos en el punto de venta, sin IVA.{' '}
            {s28.yoy
              ? <><b className={s28.yoy.percent >= 0 ? 'up' : 'down'}>{signedPct(s28.yoy.percent)}</b> contra las mismas semanas de {s28.yoy.lastYearTo.slice(0, 4)} ({money(s28.yoy.lastYearMinor, cur)}, del {fullDate(s28.yoy.lastYearFrom)} al {fullDate(s28.yoy.lastYearTo)}).{s28.yoy.eventsExcludedMinor > 0 ? ` La comparación deja fuera ${money(s28.yoy.eventsExcludedMinor, cur)} de eventos privados.` : ''}</>
              : <span className="muted">Sin comparación con el año pasado: falta cargar el historial de Wansoft en Ajustes → Conexiones.</span>}
          </p>
        )}
        {t.prepaid && (
          <a className="small card yoy paid" href="#reservaciones/pagos">
            <b>Experiencias pagadas en línea:</b> {money(t.prepaid.paid.netMinor, cur)} en {count(t.prepaid.paid.count, 'pago', 'pagos')} con tarjeta en los últimos 28 días.
            {t.prepaid.upcoming.count > 0 && <> Ya cobrado para visitas que vienen: {money(t.prepaid.upcoming.netMinor, cur)} en {count(t.prepaid.upcoming.count, 'reservación', 'reservaciones')}.</>}
            {' '}<span className="go">Ver pagos →</span>
          </a>
        )}
      </section>
      {session?.user?.role === 'viewer' && <p className="tiny muted section">Tu acceso es de lectura.</p>}
    </>
  );
}
