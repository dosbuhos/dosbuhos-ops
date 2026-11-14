import { useCallback, useMemo, useState } from 'react';
import { TickerCard, HeroChart, SeriesTable, Loading, ErrorBox } from '../components';
import { MODE_INFO, PRODUCT_LABEL, dayLabel, ago, stateLabel, jobStatusLabel } from '../format';

const VIEW_KEYS: [string, string][] = [['contribution_after_ads', 'Contribución después de anuncios'], ['online_reservations', 'Reservaciones en línea'], ['online_reservations_google_ads', 'Reservaciones de Google Ads'], ['confirmed_bookings', 'Reservaciones'], ['completed_guests', 'Comensales atendidos'], ['revenue', 'Ingresos'], ['ad_spend', 'Gasto en anuncios (Google)'], ['meta_spend', 'Gasto en anuncios (Meta)'], ['platform_conversions', 'Conversiones de Google'], ['contribution_roas', 'ROAS de contribución']];

export function Overview({ o, error, session }: { o: any; error: string | null; session: any }) {
  const [key, setKey] = useState<string | null>(null);
  const [trend, setTrend] = useState<0 | 7 | 28>(7);
  const [table, setTable] = useState(false);
  const onMarker = useCallback((id: string) => { location.hash = `activity`; sessionStorage.setItem('growth-focus-action', id); }, []);
  const k = key ?? o?.heroKey;
  const series = useMemo(() => o?.series?.find((s: any) => s.key === k), [o, k]);
  if (!o) return error ? <ErrorBox error={error} /> : <div className="section"><Loading /></div>;
  const mode = o.coordinator?.mode;
  const alerts = (o.alerts ?? []).filter((a: any) => a.severity !== 'info');
  const fwd = o.capacity.days.filter((d: any) => d.date < addDays(o.today, 14) && (d.product === 'restaurant_visit' || d.product === 'tour_tasting'));
  const byDate = groupBy(fwd, (d: any) => d.date);

  return (
    <>
      {error && <ErrorBox error={error} stale />}
      <section className="section" aria-labelledby="needs">
        <header><h2 id="needs">¿Qué necesita de mí?</h2><span className="small muted">{alerts.length ? `${alerts.length} pendiente(s)` : 'Nada por ahora'}</span></header>
        {alerts.length ? <div className="list">{alerts.map((a: any) => (
          <a key={a.dedupe_key} href={a.link || '#overview'} className={`notice ${a.severity === 'critical' ? 'bad' : ''}`} style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
            <b>{a.severity === 'critical' ? '⛔ ' : '⚠ '}{a.title}</b><div className="small">{a.detail}</div>
          </a>))}</div> : <div className="small muted">Sin alertas. Cada 15 minutos, y sin usar la IA, el vigilante revisa que el gasto esté al día, que no falten revisiones, los resultados desconocidos y la capacidad.</div>}
      </section>

      <section className="section" aria-labelledby="tick">
        <header><h2 id="tick">Últimos 28 días</h2><span className="small muted">{o.window.from} – {o.window.to} vs. {o.window.prevFrom} – {o.window.prevTo}</span></header>
        <div className="grid tickers">{o.tickers.map((t: any) => <TickerCard key={t.key} t={t} currency={o.currency} />)}</div>
      </section>

      <section className="section card" aria-labelledby="hero">
        <header style={{ display: 'grid', gap: 8 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2 id="hero">{series?.label ?? 'Desempeño'}{series?.unit === 'money' ? ` (${o.currency})` : ''}</h2>
            <span className="small muted">{series?.view === 'service' ? 'Por fecha de servicio (operación)' : 'Por fecha en que se hizo la reservación (cohorte de adquisición)'}</span>
          </div>
          <div className="seg" role="group" aria-label="Métrica">{VIEW_KEYS.map(([sk, l]) => <button key={sk} aria-pressed={k === sk} onClick={() => setKey(sk)}>{l}</button>)}</div>
          <div className="row">
            <div className="seg" role="group" aria-label="Línea de tendencia">{([0, 7, 28] as const).map(n => <button key={n} aria-pressed={trend === n} onClick={() => setTrend(n)}>{n ? `Tendencia ${n} días` : 'Solo diario'}</button>)}</div>
            <div className="seg"><button aria-pressed={table} onClick={() => setTable(!table)}>Vista de tabla</button></div>
          </div>
        </header>
        {series && !series.available ? (
          <div className="notice" style={{ marginTop: 10 }}><b>{series.label}: no se puede mostrar.</b> {series.missing ?? 'No hay datos para este periodo.'}{series.key === 'revenue' || series.key.startsWith('contribution') ? ' Los ingresos nunca se presentan como utilidad.' : ''} {series.missing?.includes('Conexiones') && <a href="#connections">Abrir Conexiones →</a>}</div>
        ) : series ? (
          <>
            <div style={{ marginTop: 10 }}><HeroChart series={series} markers={o.markers} cutoff={o.cutoff} currency={o.currency} trend={trend} onMarker={onMarker} /></div>
            {table && <SeriesTable series={series} currency={o.currency} />}
            <p className="small muted">Se muestran todos los días, también los malos. {series.view === 'acquisition' ? 'Las cohortes recientes son provisionales porque algunas reservaciones todavía no suceden.' : ''} Un marcador de acción antes de una mejora no significa que la acción la causó; revisa el periodo de evaluación de la acción. Atribución: {o.attributionMethod}.</p>
          </>
        ) : null}
      </section>

      {o.funnel && <Funnel f={o.funnel} />}

      <div className="grid cols-2 section">
        <section className="card" aria-labelledby="cap14">
          <header className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}><h3 id="cap14">Próximos 14 días</h3><a href="#capacity" className="small">Calendario completo</a></header>
          {Object.keys(byDate).length === 0 && (o.availability?.days?.length ? <AvailabilityList a={o.availability} /> : <p className="small muted">Todavía no se ha capturado capacidad. El personal puede agregar horarios en Capacidad; nada aquí se toma como lleno ni vacío.</p>)}
          <div className="cal">{Object.entries(byDate).map(([date, ds]) => (
            <div key={date} className="cal-day"><div className="d">{dayLabel(date).split(' ').slice(1).join(' ')}<small>{dayLabel(date).split(' ')[0]}</small></div>
              <div className="cal-prods">{(ds as any[]).map(d => <CapChip key={d.product} d={d} />)}</div></div>))}</div>
          <p className="tiny muted">Última actualización de capacidad: {ago(o.capacity.lastUpdate)}. Desconocido significa que nadie la ha capturado; nunca se toma como vacía ni ilimitada.</p>
        </section>
        <section className="card" aria-labelledby="agent">
          <h3 id="agent">¿Qué está haciendo el agente?</h3>
          <div className="stack" style={{ marginTop: 8 }}>
            {mode && <div><span className={`state ${MODE_INFO[mode]?.cls}`}>{MODE_INFO[mode]?.label}</span> <span className="small">{MODE_INFO[mode]?.text}</span></div>}
            <div className="small">Última revisión diaria: <b>{o.lastReview ? `${jobStatusLabel(o.lastReview.status)} · ${ago(Number(o.lastReview.started_at))}` : 'todavía no corre'}</b></div>
            <div className="small">Análisis con IA: <b>{session?.aiConfigured ? `activo (${session.model})` : 'apagado: los reportes usan la plantilla de datos, sin propuestas'}</b></div>
            <div className="small">Cambios en la gráfica: {o.markers.length ? o.markers.slice(-4).reverse().map((m: any) => <div key={m.actionId + m.state}>● {m.date} · {m.label} <span className="muted">({stateLabel(m.state).toLowerCase()})</span></div>) : 'ninguno'}</div>
            <a className="small" href="#activity">Todas las propuestas y decisiones →</a>
          </div>
          <hr />
          <h3>Calidad de los datos</h3>
          <ul className="small" style={{ paddingLeft: 18, margin: '6px 0 0' }}>
            {o.quality.bookingsConnected === false ? <li>Todavía no hay fuente de reservaciones conectada, así que no se pueden medir la atribución, el cruce de ventas, las cancelaciones ni las inasistencias</li> : <>
              <li>Cobertura de atribución {o.quality.attributionCoverage ?? '—'}% · ventas cruzadas {o.quality.salesMatchingCoverage ?? '—'}%</li>
              <li>Cancelaciones {o.quality.cancellationRate ?? '—'}% · inasistencias {o.quality.noShowRate ?? '—'}%</li></>}
            {o.quality.conversionDaysMissing.length > 0 && <li>Faltan datos de conversiones del {o.quality.conversionDaysMissing.join(', ')}; se muestran como huecos, no como ceros</li>}
            {o.quality.spendDaysMissing.length > 0 && <li>Falta el gasto de {o.quality.spendDaysMissing.length} día(s)</li>}
            <li>{o.quality.lagKnown ? 'Tiempo de maduración estimado con datos' : 'Todavía no se estima el tiempo de maduración; el escalamiento por rentabilidad está apagado'}</li>
          </ul>
        </section>
      </div>
    </>
  );
}

function Funnel({ f }: { f: { window: string; gaps: string[]; steps: { event: string; label: string; count: number }[] } }) {
  const top = Math.max(1, ...f.steps.map(s => s.count));
  return (
    <section className="section card" aria-labelledby="funnel">
      <header className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}><h3 id="funnel">Embudo de reservaciones en línea</h3><span className="small muted">{f.window}, todo el tráfico, de GA4</span></header>
      <div className="stack">{f.steps.map((s, i) => {
        const prev = i ? f.steps[i - 1]!.count : null;
        return (
          <div key={s.event} className="row" style={{ flexWrap: 'nowrap', gap: 10 }}>
            <div style={{ flex: '0 1 46%', minWidth: 0 }} className="small">{s.label}</div>
            <div style={{ flex: 1, minWidth: 0 }}><div className="bar" style={{ width: '100%', height: 10 }}><span style={{ width: `${(s.count / top) * 100}%` }} /></div></div>
            <b className="mono" style={{ minWidth: 44, textAlign: 'right' }}>{s.count}</b>
            <span className="tiny muted" style={{ minWidth: 48, textAlign: 'right' }}>{prev ? `${Math.round((s.count / prev) * 100)}%` : ''}</span>
          </div>
        );
      })}</div>
      <p className="tiny muted">GA4 cuenta cada paso por separado (eventos, no personas únicas), así que los porcentajes son aproximados. “Reservó” solo cuenta reservaciones del widget en línea; aquí no están las reservaciones por teléfono ni las cancelaciones.{f.gaps.length ? ` GA4 no registró nada el ${f.gaps.join(', ')}: esos días se toman como faltantes, no como cero.` : ''}</p>
    </section>
  );
}

const AV: Record<string, [string, string]> = { open: ['open', 'open'], limited: ['limited', 'open'], full: ['full', 'sold_out'], closed: ['closed', 'closed'], unknown: ['unknown', 'unknown'] };
export function AvailabilityList({ a, detail = false }: { a: { checkedAt: number | null; days: any[] }; detail?: boolean }) {
  return (
    <>
      <div className="cal">{a.days.map(d => (
        <div key={d.date} className="cal-day">
          <div className="d">{dayLabel(d.date).split(' ').slice(1).join(' ')}<small>{dayLabel(d.date).split(' ')[0]}</small></div>
          <div className="cal-prods">
            {d.status === 'closed' ? <span className="cap closed">cerrado</span> : <>
              <span className={`cap ${AV[d.status]![1]}`} title="Horarios de mesa disponibles en OpenTable para 2 personas (unos 20 es un día normal)">Restaurante <b className="mono">{d.tables2 === null ? '?' : d.tables2 === 0 ? 'lleno' : `${d.tables2} horarios`}</b>{d.tables4 !== null && d.tables2 !== 0 ? <span className="tiny muted">· {d.tables4} para 4</span> : null}</span>
              <span className={`cap ${d.experienceTimes === null ? 'unknown' : d.experienceTimes === 0 ? 'sold_out' : 'open'}`} title="Horarios de experiencias disponibles en OpenTable, todas las experiencias">Experiencias <b className="mono">{d.experienceTimes === null ? '?' : d.experienceTimes === 0 ? 'ninguno' : `${d.experienceTimes} horarios`}</b></span>
            </>}
          </div>
          {detail && d.status !== 'closed' && <div className="tiny muted" style={{ gridColumn: '1 / -1' }}>{d.experiences.map((x: any) => `${x.name}: ${x.slots ?? '?'}`).join(' · ')}</div>}
        </div>))}</div>
      <p className="tiny muted">Horarios disponibles en la página pública de reservaciones de OpenTable (no son lugares), revisados cada 3 horas{a.checkedAt ? `; la última vez ${ago(a.checkedAt)}` : ''}. Unos 20 horarios de mesa para 2 es un día abierto normal; “lleno” significa que no se puede reservar nada en línea.</p>
    </>
  );
}

export function CapChip({ d }: { d: any }) {
  const pct = d.sellable ? Math.round((d.reserved / d.sellable) * 100) : 0;
  const label = PRODUCT_LABEL[d.product] ?? d.product;
  const text = d.status === 'closed' ? 'cerrado' : d.status === 'blocked' ? 'bloqueado' : d.status === 'unknown' ? 'desconocido' : d.status === 'sold_out' ? 'agotado' : `${d.remaining} libres`;
  return (
    <span className={`cap ${d.status}`} title={`${label}: ${d.reserved} reservados de ${d.sellable} lugares conocidos${d.unknownSlots ? `, ${d.unknownSlots} horario(s) desconocido(s)` : ''}${d.staleSlots ? ', desactualizado' : ''}`}>
      <span>{label.split(' ')[0]}</span><b className="mono">{text}</b>
      {(d.status === 'open' || d.status === 'sold_out') && <span className="bar" aria-hidden><span style={{ width: `${Math.min(100, pct)}%` }} /></span>}
      {d.staleSlots > 0 && <span title="Desactualizado">⏱</span>}
    </span>
  );
}

export const addDays = (d: string, n: number) => { const [y, m, dd] = d.split('-').map(Number); return new Date(Date.UTC(y!, m! - 1, dd! + n)).toISOString().slice(0, 10); };
export function groupBy<T>(xs: T[], f: (x: T) => string): Record<string, T[]> { const o: Record<string, T[]> = {}; for (const x of xs) (o[f(x)] ??= []).push(x); return o; }
