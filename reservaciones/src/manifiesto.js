// The week's reservations, day by day: the manifest. Reservations come from the growth database (ot_reservations, read
// only), the guests from this app's own database, prepaid experiences from Stripe as an estimate, and each day carries
// its Parrot numbers side by side. Nothing ties a reservation to its check yet (OpenTable matches no checks), so the
// two are never joined.
import { horaLocal, sumarDias, rango, diaSemana, OFFSET_S } from './fechas.js';
import { casar, preciosPorPersona, nombreExperiencia } from './experiencias.js';
import { ventasDeLaSemana, diasAbiertos } from './ventas.js';
import { estadoSync, RETENCION_DIAS } from './huespedes.js';

/** OpenTable was connected to Klaviyo on this day. A reservation booked earlier for a later date is not in the feed
 *  until OpenTable sends another event for it, so the days ahead can be short for a while. */
export const FEED_DESDE = '2026-11-22';
/** Nearly every booking is made within a few weeks of the visit; after this many days the warning stops. */
const AVISO_DIAS = 60;

const todos = (db, sql, ...b) => db.prepare(sql).bind(...b).all().then((r) => r.results || []);
const FINALES = ['completed', 'cancelled', 'no_show'];

let precios = { at: 0, mapa: null };
async function preciosConocidos(db, hoy, ahora) {
  if (precios.mapa && ahora - precios.at < 600_000) return precios.mapa;
  const desde = sumarDias(hoy, -180);
  const pares = await todos(db, `WITH r AS (
      SELECT service_date AS d, strftime('%H:%M', scheduled_at / 1000 - ${OFFSET_S}, 'unixepoch') AS t, COUNT(*) AS n, MAX(party_size) AS personas
      FROM ot_reservations WHERE status <> 'cancelled' AND scheduled_at IS NOT NULL AND service_date >= ? GROUP BY d, t
    ), c AS (
      SELECT service_date AS d, service_time AS t, COUNT(*) AS n, MAX(experience_id) AS e, MAX(amount_minor) AS monto
      FROM stripe_payments WHERE source = 'opentable' AND status = 'succeeded' AND refunded_minor = 0 AND service_time IS NOT NULL AND service_date >= ? GROUP BY d, t
    )
    SELECT c.e AS experiencia, c.monto AS monto, r.personas AS personas FROM c JOIN r ON r.d = c.d AND r.t = c.t WHERE c.n = 1 AND r.n = 1 AND r.personas > 0 AND c.e <> ''`, desde, desde);
  precios = { at: ahora, mapa: preciosPorPersona(pares) };
  return precios.mapa;
}
export function olvidar() { precios = { at: 0, mapa: null }; }

async function huespedesDe(db, ids) {
  const out = new Map();
  for (let i = 0; i < ids.length; i += 80) {
    const parte = ids.slice(i, i + 80);
    for (const g of await todos(db, `SELECT confirmation_id, first_name, last_name, email, phone FROM guests WHERE confirmation_id IN (${parte.map(() => '?').join(',')})`, ...parte)) out.set(g.confirmation_id, g);
  }
  return out;
}

/** yo: { ventas: boolean }. desde: the Monday of the week. */
export async function semana(env, yo, desde, hoy, ahora = Date.now()) {
  const g = env.GROWTH, hasta = sumarDias(desde, 6);
  const [reservas, cargos, mapaPrecios, abiertos, ventas, frescura, sync] = await Promise.all([
    todos(g, `SELECT confirmation_id, created_at, scheduled_at, service_date, party_size, origin, status, table_name, arrived_at, seated_at, done_at, pos_total_minor
      FROM ot_reservations WHERE service_date BETWEEN ? AND ? ORDER BY scheduled_at, confirmation_id`, desde, hasta),
    todos(g, `SELECT id, service_date, service_time, amount_minor - refunded_minor AS monto, experience_id FROM stripe_payments
      WHERE source = 'opentable' AND status = 'succeeded' AND amount_minor > refunded_minor AND service_time IS NOT NULL AND service_date BETWEEN ? AND ?`, desde, hasta),
    preciosConocidos(g, hoy, ahora),
    diasAbiertos(g, hoy, ahora),
    yo.ventas ? ventasDeLaSemana(g, desde, hasta, hoy, ahora) : null,
    g.prepare('SELECT (SELECT MAX(updated_at) FROM ot_reservations) AS reservas, (SELECT MAX(fetched_at) FROM pos_orders) AS ventas').first(),
    estadoSync(env.DB),
  ]);
  const huespedes = await huespedesDe(env.DB, reservas.map((r) => r.confirmation_id));
  const borradoAntesDe = sumarDias(hoy, -RETENCION_DIAS);
  const avisoHasta = sumarDias(FEED_DESDE, AVISO_DIAS);

  let sinHuesped = 0;
  const dias = rango(desde, hasta).map((fecha) => {
    const delDia = reservas.filter((r) => r.service_date === fecha);
    const filas = delDia.map((r) => ({ id: r.confirmation_id, hora: r.scheduled_at === null ? null : horaLocal(r.scheduled_at), personas: r.party_size, estado: r.status }));
    const { porReserva, sueltos } = casar(filas, cargos.filter((c) => c.service_date === fecha).map((c) => ({ id: c.id, hora: c.service_time, monto: Number(c.monto) || 0, experiencia: c.experience_id })), mapaPrecios);
    const lista = delDia.map((r, i) => {
      const h = huespedes.get(r.confirmation_id), exp = porReserva.get(r.confirmation_id);
      const nombre = h ? `${h.first_name} ${h.last_name}`.trim() : '';
      if (!h && r.status !== 'cancelled' && fecha >= borradoAntesDe) sinHuesped++;
      return {
        id: r.confirmation_id, hora: filas[i].hora, personas: r.party_size, mesa: r.table_name || null, origen: r.origin || null, estado: r.status,
        reservada: r.created_at, llego: r.arrived_at, sentado: r.seated_at, salio: r.done_at, cuenta: r.pos_total_minor,
        huesped: h ? { nombre: nombre || null, telefono: h.phone || null, correo: h.email || null } : null,
        huespedBorrado: !h && fecha < borradoAntesDe,
        experiencia: exp ? { nombre: nombreExperiencia(exp.experiencia), monto: exp.monto, seguridad: exp.seguridad } : null,
      };
    });
    const vivas = lista.filter((r) => r.estado !== 'cancelled' && r.estado !== 'no_show');
    // People arriving per half hour, for the day's strip (cancelled and no-shows left out).
    const franjas = new Map();
    for (const r of vivas) if (r.hora) { const [hh, mm] = r.hora.split(':').map(Number), k = hh * 2 + (mm >= 30 ? 1 : 0); franjas.set(k, (franjas.get(k) || 0) + (r.personas || 0)); }
    const v = ventas ? ventas.get(fecha) : undefined;
    return {
      fecha, hoy: fecha === hoy, pasado: fecha < hoy,
      abierto: abiertos.has(diaSemana(fecha)) || lista.length > 0 || sueltos.length > 0 || (!!v && v.cuentas > 0),
      incompleto: fecha >= hoy && fecha > FEED_DESDE && fecha <= avisoHasta,
      totales: { reservas: vivas.length, personas: vivas.reduce((a, r) => a + (r.personas || 0), 0), canceladas: lista.filter((r) => r.estado === 'cancelled').length, noLlegaron: lista.filter((r) => r.estado === 'no_show').length,
        porLlegar: lista.filter((r) => !FINALES.includes(r.estado)).length },
      franjas: [...franjas].sort((a, b) => a[0] - b[0]).map(([k, personas]) => ({ media: k, personas })),
      reservas: lista,
      prepagos: sueltos.map((c) => ({ hora: c.hora, experiencia: nombreExperiencia(c.experiencia), monto: c.monto, personas: c.personas, motivo: c.motivo })),
      ...(yo.ventas ? { ventas: v ?? null } : {}),
    };
  });

  const t = (k) => dias.reduce((a, d) => a + d.totales[k], 0);
  return {
    hoy, desde, hasta, anterior: sumarDias(desde, -7), siguiente: sumarDias(desde, 7),
    yo: { nombre: yo.nombre, ventas: !!yo.ventas, admin: !!yo.admin },
    totales: { reservas: t('reservas'), personas: t('personas'), canceladas: t('canceladas'), noLlegaron: t('noLlegaron'), prepagos: dias.reduce((a, d) => a + d.prepagos.length, 0) },
    dias,
    feedDesde: FEED_DESDE, retencionDias: RETENCION_DIAS,
    fresco: { reservas: frescura?.reservas ?? null, ventas: yo.ventas ? frescura?.ventas ?? null : undefined, huespedes: sync.bien, errorHuespedes: yo.admin ? sync.error : sync.error ? 'pendiente' : '' },
    sinHuesped, syncCorrio: sync.corrio,
  };
}
