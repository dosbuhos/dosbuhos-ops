// "Reservaciones → De dónde vienen": every OpenTable reservation (through Klaviyo) when it is connected, then where
// online reservations come from, the booking funnel and guests by weekday.
import { useApi } from '../api';
import { Loading, ErrorBox } from '../components';
import { int, count, dayLabel, signedPct, fullDate } from '../format';
import { Sources } from './Data';
import { Funnel, Weekdays } from './Overview';

const ORIGIN: Record<string, string> = { web: 'Por la web', phone: 'Por teléfono o capturadas por el equipo', 'walk-in': 'Sin reservar (llegaron)', '': 'Sin dato' };
const dayMonth = (d: string) => dayLabel(d).split(' ').slice(1).join(' ');

/** Every reservation OpenTable holds, counted: made, how, how the visits ended, and the next two weeks. Nothing until Klaviyo is read. */
function AllReservations({ r }: { r: any }) {
  if (!r?.first) return null;
  const m = r.made, v = r.visits, w = r.window;
  const vs = m.previous.count > 0 ? ((m.count - m.previous.count) / m.previous.count) * 100 : null;
  const web = (m.byOrigin as any[]).find(o => o.origin === 'web');
  const maxGuests = Math.max(1, ...(r.upcoming.days as any[]).map(d => d.guests));
  return (
    <>
      {!r.historyComplete && <div className="notice info section small"><b>Cargando el historial de reservaciones.</b> Ya está desde el {fullDate(r.first)}; se completa solo. Los números de abajo pueden subir.</div>}
      <section className="section" aria-labelledby="res-all">
        <header><h2 id="res-all">Todas las reservaciones</h2><span className="small muted">OpenTable · últimos 28 días · {dayMonth(w.from)} a {dayMonth(w.to)}</span></header>
        <div className="grid four">
          <div className="card stat"><span>Reservaciones hechas</span><b>{int(m.count)}</b><i>{int(m.guests)} personas{vs !== null ? ` · ${signedPct(vs)} contra los 28 días anteriores` : ''}</i></div>
          {(m.byOrigin as any[]).map(o => (
            <div key={o.origin} className="card stat"><span>{ORIGIN[o.origin] ?? o.origin}</span><b>{int(o.count)}</b><i>{int(o.guests)} personas</i></div>))}
          {m.medianLeadDays !== null && <div className="card stat"><span>Anticipación en la web</span><b>{m.medianLeadDays < 1 ? 'el mismo día' : `${m.medianLeadDays} días`}</b><i>la mitad reserva con eso o menos</i></div>}
        </div>
        {web && m.webSeenByGa4 !== null && (
          <p className="tiny muted">De las {int(web.count)} hechas por la web, GA4 registró {int(m.webSeenByGa4)}: son las que pasan por el botón de dosbuhos.com. {web.count > m.webSeenByGa4 ? `Las otras ${int(web.count - m.webSeenByGa4)} se hicieron en opentable.com o en su app, o perdieron el rastro, y los reportes de anuncios no las ven.` : ''}</p>
        )}
      </section>

      <div className="grid cols-2 even section">
        <section className="card stack" aria-labelledby="res-end">
          <h3 id="res-end">Cómo terminaron las visitas</h3>
          <div className="kv">
            <div><span>Llegaron</span><b>{int(v.completed.count)}</b><span>{int(v.completed.guests)} personas</span></div>
            <div><span>Cancelaron</span><b>{int(v.cancelled.count)}</b><span>{v.cancelledPct === null ? '' : `${v.cancelledPct}% de las reservaciones`}</span></div>
            <div><span>No llegaron</span><b>{int(v.noShow.count)}</b><span>{v.noShowPct === null ? '' : `${v.noShowPct}%`}</span></div>
            {v.open.count > 0 && <div><span>Sin cerrar en OpenTable</span><b>{int(v.open.count)}</b><span>nadie marcó si llegaron</span></div>}
          </div>
          <p className="tiny muted">Reservaciones cuya visita cayó en esos 28 días ({int(v.total)}).</p>
          {r.quickClose && r.quickClose.quick > 0 && (
            <p className="small">{int(r.quickClose.quick)} de {count(r.quickClose.completed, 'visita', 'visitas')} se cerraron en OpenTable menos de 5 minutos después de sentarlas. A esas OpenTable no les puede ligar la cuenta de Parrot.</p>
          )}
        </section>
        <section className="card stack" aria-labelledby="res-next">
          <h3 id="res-next">Ya reservado para los próximos 14 días</h3>
          {r.upcoming.count > 0 ? (
            <>
              <div><span className="midnum">{int(r.upcoming.guests)}</span> <span className="small muted">personas en {count(r.upcoming.count, 'reservación', 'reservaciones')}</span></div>
              <div className="stack">{(r.upcoming.days as any[]).map(d => (
                <div key={d.date} className="payrow">
                  <div className="payrow-top"><span className="small">{d.date === r.today ? 'Hoy' : dayLabel(d.date)}</span><span><b className="mono">{int(d.guests)}</b> <span className="tiny muted">personas</span></span></div>
                  <div className="payrow-bar"><div className="bar" style={{ width: '100%', height: 8 }}><span style={{ width: `${Math.max(2, (d.guests / maxGuests) * 100)}%` }} /></div><span className="tiny muted">{count(d.count, 'reserva', 'reservas')}</span></div>
                </div>))}</div>
            </>
          ) : <p className="small muted">No hay reservaciones para los próximos 14 días.</p>}
          <p className="tiny muted">Restaurante y experiencias juntos. No incluye a quien llega sin reservar.</p>
        </section>
      </div>
    </>
  );
}

export function Bookings({ overview }: { overview: any }) {
  const { data, error } = useApi('campaigns', 300_000);
  const all = useApi('reservations', 300_000);
  if (!data) return error ? <ErrorBox error={error} /> : <div className="section"><Loading /></div>;
  const haveAll = !!all.data?.first;
  return (
    <>
      <AllReservations r={all.data} />
      <section className="section">
        <Sources data={data} />
        {(data.unmatchedMeta?.clicks > 0 || data.unmatchedMeta?.opened > 0) && <p className="tiny muted">Anuncios de Meta etiquetados con el ID de campaña y no con el nombre: {data.unmatchedMeta.clicks} clic(s) en Reservar, {data.unmatchedMeta.opened} abrieron OpenTable, {data.unmatchedMeta.reservations} reservación(es). No se pueden asignar a una campaña.</p>}
      </section>
      {overview?.funnel && <Funnel f={overview.funnel} />}
      {overview?.posWeekdays && <Weekdays w={overview.posWeekdays} />}
      {overview && overview.quality?.bookingsConnected === false && (
        haveAll
          ? <div className="notice info section small">Lo que consumió cada mesa todavía no está ligado a su reservación. <a href="#ajustes/conexiones">Ver conexiones →</a></div>
          : <div className="notice section small">Aquí solo se ven las reservaciones hechas en línea. Las de teléfono, las cancelaciones y lo que consumió cada mesa todavía no están conectados. <a href="#ajustes/conexiones">Ver conexiones →</a></div>
      )}
    </>
  );
}
