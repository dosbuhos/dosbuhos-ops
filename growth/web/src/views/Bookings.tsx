// "Reservaciones → De dónde vienen": where online reservations come from, the booking funnel and guests by weekday.
// The same cards used to be spread over Resumen and Campañas.
import { useApi } from '../api';
import { Loading, ErrorBox } from '../components';
import { Sources } from './Data';
import { Funnel, Weekdays } from './Overview';

export function Bookings({ overview }: { overview: any }) {
  const { data, error } = useApi('campaigns', 300_000);
  if (!data) return error ? <ErrorBox error={error} /> : <div className="section"><Loading /></div>;
  return (
    <>
      <section className="section">
        <Sources data={data} />
        {(data.unmatchedMeta?.clicks > 0 || data.unmatchedMeta?.opened > 0) && <p className="tiny muted">Anuncios de Meta etiquetados con el ID de campaña y no con el nombre: {data.unmatchedMeta.clicks} clic(s) en Reservar, {data.unmatchedMeta.opened} abrieron OpenTable, {data.unmatchedMeta.reservations} reservación(es). No se pueden asignar a una campaña.</p>}
      </section>
      {overview?.funnel && <Funnel f={overview.funnel} />}
      {overview?.posWeekdays && <Weekdays w={overview.posWeekdays} />}
      {overview && overview.quality?.bookingsConnected === false && (
        <div className="notice section small">Aquí solo se ven las reservaciones hechas en línea. Las de teléfono, las cancelaciones y lo que consumió cada mesa todavía no están conectados. <a href="#ajustes/conexiones">Ver conexiones →</a></div>
      )}
    </>
  );
}
