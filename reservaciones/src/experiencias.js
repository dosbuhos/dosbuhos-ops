// Which reservations are prepaid experiences (tours, tastings, the tasting menu, picnics)? The OpenTable feed does not
// say, so this is an ESTIMATE built from the prepayments in Stripe: each one carries the experience, the day and the
// hour of the visit, but not the reservation it belongs to. The screen always labels the result "estimación".
//
// The rule, per day and hour:
//   - one reservation at that hour  -> the prepayments of that hour are its own
//   - several reservations          -> a prepayment goes to the reservation whose party size fits the amount, using the
//                                      usual price per person of that experience; when none fits, it stays on the hour
//   - no reservation in the feed    -> listed on its own, so a prepaid visit is never invisible
// Names: growth/src/connectors/opentable-availability.ts (EXPERIENCES); keep in sync.
export const EXPERIENCIAS = {
  796500: 'Visita guiada + degustación',
  842882: 'Degustación de 4 vinos',
  793495: 'Menú degustación 5 tiempos',
  793530: 'Picnic orgánico',
  796410: 'Petanque y espumoso',
};
export const nombreExperiencia = (id) => EXPERIENCIAS[id] || 'Experiencia';

/** How far a prepayment may be from party × price and still count as that party (service charge, a tip, a discount). */
export const TOLERANCIA = 0.12;

const mediana = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };

/** The usual price per person of each experience: the median over past hours where one reservation met one prepayment. */
export function preciosPorPersona(pares) {
  const por = new Map();
  for (const p of pares) {
    const personas = Number(p.personas), monto = Number(p.monto);
    if (!p.experiencia || !(personas > 0) || !(monto > 0)) continue;
    por.set(String(p.experiencia), [...(por.get(String(p.experiencia)) || []), monto / personas]);
  }
  // One sighting is not a price: wait for two.
  return new Map([...por].filter(([, v]) => v.length >= 2).map(([k, v]) => [k, Math.round(mediana(v))]));
}

/** How many people a prepayment covers at the usual price; null when the experience has no known price. */
export function personasEstimadas(cargo, precios) {
  const precio = precios.get(String(cargo.experiencia));
  if (!precio) return null;
  const n = Math.round(cargo.monto / precio);
  return n >= 1 && Math.abs(cargo.monto - n * precio) <= TOLERANCIA * cargo.monto ? n : null;
}

/**
 * One day's reservations against its prepayments.
 * reservas: [{ id, hora: 'HH:MM', personas, estado }]   cargos: [{ id, hora: 'HH:MM', monto, experiencia, pais? }] (monto net of refunds, > 0)
 * Returns { porReserva: Map(id -> { cargos, monto, experiencia, seguridad: 'unica' | 'personas' }), sueltos: [{ ...cargo, personas, motivo: 'varias' | 'sin_reserva' }] }
 */
export function casar(reservas, cargos, precios) {
  const porReserva = new Map(), sueltos = [];
  const asignar = (r, c, seguridad) => {
    const m = porReserva.get(r.id) || { cargos: 0, monto: 0, experiencia: String(c.experiencia), seguridad };
    m.cargos++; m.monto += c.monto; if (c.pais && !m.pais) m.pais = c.pais;
    porReserva.set(r.id, m);
  };
  const horas = new Map();
  for (const c of cargos) if (c.monto > 0 && c.hora) horas.set(c.hora, [...(horas.get(c.hora) || []), c]);
  for (const [hora, lista] of horas) {
    const candidatas = reservas.filter((r) => r.hora === hora && r.estado !== 'cancelled');
    if (!candidatas.length) { for (const c of lista) sueltos.push({ ...c, personas: personasEstimadas(c, precios), motivo: 'sin_reserva' }); continue; }
    if (candidatas.length === 1) { for (const c of lista) asignar(candidatas[0], c, 'unica'); continue; }
    const libres = new Set(candidatas);
    for (const c of [...lista].sort((a, b) => b.monto - a.monto)) {
      const n = personasEstimadas(c, precios);
      const r = n === null ? null : [...libres].find((x) => Number(x.personas) === n);
      if (r) { libres.delete(r); asignar(r, c, 'personas'); }
      else sueltos.push({ ...c, personas: n, motivo: 'varias' });
    }
  }
  sueltos.sort((a, b) => (a.hora < b.hora ? -1 : a.hora > b.hora ? 1 : b.monto - a.monto));
  return { porReserva, sueltos };
}
