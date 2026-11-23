// Sales as Parrot rang them up, read from the growth database (pos_orders, pos_items, pos_payments), plus the old
// point of sale's daily totals (pos_daily_history, Wansoft) for the same weeks a year earlier. Read-only.
//
// Definitions, the same as Growth Terminal so both apps show the same numbers (growth/src/read/sales.ts):
//   venta neta      finished checks, total minus IVA, after discounts
//   comensales      customers on dine-in checks ("Comer aquí"), trusted from COMENSALES_DESDE on; never from take-out
//                   checks (the shop and the counter ring one "customer" per check)
//   comparable      net without the "Eventos" category: private events were never rung up in Wansoft, so counting them
//                   would overstate growth against last year
//   un año antes    52 weeks back (364 days), so every day is compared with the same weekday
import { sumarDias, rango, lunesDe, primeroDelMes, finDeMes, diasEntre, diaSemana, menor, OFFSET_S } from './fechas.js';

export const COMENSALES_DESDE = '2026-11-04';
export const CATEGORIA_EVENTOS = 'Eventos';
const ANIO = 364;
/** Closed days (Monday and Tuesday) may sit between the last Wansoft day and the first Parrot day. */
const HUECO_MAX = 4;

const todos = (db, sql, ...b) => db.prepare(sql).bind(...b).all().then((r) => r.results || []);
const n = (v) => Number(v) || 0;

// ---------- The lines of business, from Parrot's item categories ----------
// Anything not listed is the kitchen and the bar, so a new menu section lands in Restaurante; the screen lists the
// categories inside each line, so nothing is filed out of sight.
export const LINEAS = [
  { id: 'restaurante', nombre: 'Restaurante' },
  { id: 'experiencias', nombre: 'Tours y degustaciones' },
  { id: 'tienda', nombre: 'Tienda y vino para llevar' },
  { id: 'eventos', nombre: 'Eventos' },
];
export function lineaDe(categoria) {
  const c = String(categoria || '').trim().toLowerCase();
  if (c === 'eventos') return 'eventos';
  if (['enoturismo', 'degustaciones', 'picnics'].includes(c)) return 'experiencias';
  if (c.startsWith('tienda') || c === 'vino para llevar' || c.includes('wine library')) return 'tienda';
  return 'restaurante';
}

// ---------- Daily totals across both points of sale ----------
let primerParrot = { at: 0, d: null };
/** Tests start from a clean slate. */
export function olvidar() { primerParrot = { at: 0, d: null }; abiertos = { at: 0, dias: null }; }
async function inicioParrot(db, ahora) {
  if (primerParrot.d && ahora - primerParrot.at < 3_600_000) return primerParrot.d;
  const r = await db.prepare('SELECT MIN(local_date) AS d FROM pos_orders').first();
  primerParrot = { at: ahora, d: r?.d ?? null };
  return primerParrot.d;
}

/** One entry per day with sales, between two dates, and what is needed to tell "closed" from "nobody was recording". */
export async function ventasDiarias(db, desde, hasta, ahora = Date.now()) {
  const parrotDesde = await inicioParrot(db, ahora);
  const [parrot, eventos, historia, tramo] = await Promise.all([
    todos(db, `SELECT local_date AS d, COUNT(*) AS cuentas, SUM(total_minor - taxes_minor) AS neto, SUM(total_minor) AS con_iva, SUM(discounts_minor) AS descuentos,
        SUM(CASE WHEN total_minor = 0 THEN 1 ELSE 0 END) AS sin_cobro,
        SUM(CASE WHEN order_type = 'DINE_IN' THEN customers END) AS comensales, SUM(CASE WHEN order_type = 'DINE_IN' THEN total_minor - taxes_minor ELSE 0 END) AS neto_mesa
      FROM pos_orders WHERE status = 'FINISHED' AND local_date BETWEEN ? AND ? GROUP BY local_date`, desde, hasta),
    todos(db, `SELECT i.local_date AS d, SUM(COALESCE(i.subtotal_minor, CAST(ROUND(i.total_minor / 1.16) AS INTEGER))) AS neto FROM pos_items i JOIN pos_orders o ON o.uuid = i.order_uuid
      WHERE o.status = 'FINISHED' AND i.status = 'ACTIVE' AND i.category = ? AND i.local_date BETWEEN ? AND ? GROUP BY i.local_date`, CATEGORIA_EVENTOS, desde, hasta),
    todos(db, 'SELECT local_date AS d, orders AS cuentas, guests AS comensales, net_minor AS neto, total_minor AS con_iva, dine_in_net_minor AS neto_mesa, discounts_minor AS descuentos FROM pos_daily_history WHERE local_date BETWEEN ? AND ?', desde, hasta),
    db.prepare('SELECT MIN(local_date) AS a, MAX(local_date) AS b FROM pos_daily_history').first(),
  ]);
  const dias = new Map();
  for (const r of historia) if (!parrotDesde || r.d < parrotDesde) dias.set(r.d, { neto: n(r.neto), comparable: n(r.neto), conIva: n(r.con_iva), cuentas: n(r.cuentas), comensales: r.comensales === null ? null : n(r.comensales), netoMesa: n(r.neto_mesa), descuentos: n(r.descuentos), sinCobro: null, fuente: 'wansoft' });
  const ev = new Map(eventos.map((r) => [r.d, n(r.neto)]));
  for (const r of parrot) {
    const neto = n(r.neto), fiable = r.d >= COMENSALES_DESDE;
    dias.set(r.d, { neto, comparable: Math.max(0, neto - (ev.get(r.d) || 0)), conIva: n(r.con_iva), cuentas: n(r.cuentas), comensales: fiable && r.comensales !== null ? n(r.comensales) : null,
      netoMesa: fiable ? n(r.neto_mesa) : null, descuentos: n(r.descuentos), sinCobro: n(r.sin_cobro), fuente: 'parrot' });
  }
  const historiaDesde = tramo?.a ?? null, historiaHasta = tramo?.b ?? null;
  /** True when a day with no row means "closed", not "nobody was recording". */
  const cubierto = (d, hoy) => {
    if (d > hoy) return false;
    if (parrotDesde && d >= parrotDesde) return true;
    if (!historiaDesde || !historiaHasta || d < historiaDesde) return false;
    if (d <= historiaHasta) return true;
    return !!parrotDesde && diasEntre(historiaHasta, parrotDesde) <= HUECO_MAX;
  };
  return { dias, cubierto, parrotDesde };
}

// ---------- The Ventas screen ----------
export const PERIODOS = ['dia', 'semana', 'mes'];
/** The dates of a period and how far back its "previous" one sits: a day and a week compare with the week before; a
 *  month compares with four weeks before, so weekdays line up (a calendar month has a different mix of weekends). */
export function periodoDe(periodo, fecha) {
  if (periodo === 'dia') return { desde: fecha, hasta: fecha, atras: 7, anterior: sumarDias(fecha, -1), siguiente: sumarDias(fecha, 1) };
  if (periodo === 'mes') { const a = primeroDelMes(fecha), b = finDeMes(fecha); return { desde: a, hasta: b, atras: 28, anterior: primeroDelMes(sumarDias(a, -1)), siguiente: sumarDias(b, 1) }; }
  const a = lunesDe(fecha); return { desde: a, hasta: sumarDias(a, 6), atras: 7, anterior: sumarDias(a, -7), siguiente: sumarDias(a, 7) };
}

const cambio = (actual, antes) => (antes > 0 ? { antes, pct: ((actual - antes) / antes) * 100 } : null);

export async function ventas(env, periodo, fecha, hoy, ahora = Date.now()) {
  const db = env.GROWTH, P = periodoDe(periodo, fecha);
  const corte = menor(P.hasta, hoy), dias = P.desde <= corte ? rango(P.desde, corte) : [];
  const tendDesde = sumarDias(lunesDe(corte < P.desde ? P.desde : corte), -77);                 // 12 weeks, Monday to Sunday, ending with the current one
  const [actual, antes, tend, tendAnio] = await Promise.all([
    ventasDiarias(db, sumarDias(P.desde, -P.atras), P.hasta, ahora),
    ventasDiarias(db, sumarDias(P.desde, -ANIO), sumarDias(P.hasta, -ANIO), ahora),
    ventasDiarias(db, tendDesde, corte, ahora),
    ventasDiarias(db, sumarDias(tendDesde, -ANIO), sumarDias(corte, -ANIO), ahora),
  ]);
  const de = (S, d) => S.dias.get(d);
  const suma = (S, fechas, campo) => fechas.reduce((a, d) => a + (de(S, d)?.[campo] ?? 0), 0);

  // Totals of the period so far.
  const neto = suma(actual, dias, 'neto'), cuentas = suma(actual, dias, 'cuentas');
  const conComensales = dias.filter((d) => de(actual, d) && de(actual, d).comensales !== null);
  const comensales = conComensales.length ? suma(actual, conComensales, 'comensales') : null;
  const netoMesa = conComensales.length ? suma(actual, conComensales, 'netoMesa') : null;
  const sinConteo = dias.filter((d) => de(actual, d) && de(actual, d).comensales === null).length;

  // Against the period before (same weekdays) and the same weekdays a year earlier. Null unless every day of both
  // sides was being recorded, so a gap never passes for a drop.
  const cubiertoTodo = (S, fechas) => fechas.length > 0 && fechas.every((d) => S.cubierto(d, hoy));
  const previas = dias.map((d) => sumarDias(d, -P.atras)), anuales = dias.map((d) => sumarDias(d, -ANIO));
  const vsAnterior = cubiertoTodo(actual, dias) && cubiertoTodo(actual, previas) ? cambio(neto, suma(actual, previas, 'neto')) : null;
  const comparable = suma(actual, dias, 'comparable');
  const vsAnio = cubiertoTodo(actual, dias) && cubiertoTodo(antes, anuales) ? cambio(comparable, suma(antes, anuales, 'comparable')) : null;
  const previasCom = conComensales.map((d) => sumarDias(d, -P.atras));
  const comensalesAntes = conComensales.length && previasCom.every((d) => d >= COMENSALES_DESDE && actual.cubierto(d, hoy)) ? cambio(comensales, suma(actual, previasCom, 'comensales')) : null;

  const serie = rango(P.desde, P.hasta).map((d) => {
    const x = de(actual, d), y = de(antes, sumarDias(d, -ANIO)), z = de(actual, sumarDias(d, -P.atras));
    const visto = actual.cubierto(d, hoy);
    return { fecha: d, futuro: d > hoy, neto: visto ? x?.neto ?? 0 : null, cuentas: visto ? x?.cuentas ?? 0 : null, comensales: x ? x.comensales : visto && d >= COMENSALES_DESDE ? 0 : null,
      anterior: actual.cubierto(sumarDias(d, -P.atras), hoy) ? z?.neto ?? 0 : null, anio: antes.cubierto(sumarDias(d, -ANIO), hoy) ? y?.comparable ?? 0 : null };
  });

  // Twelve weeks of weekly sales, with the same weeks a year earlier.
  const tendencia = [];
  for (let w = tendDesde; w <= corte; w = sumarDias(w, 7)) {
    const fechas = rango(w, sumarDias(w, 6)), vistas = fechas.filter((d) => d <= hoy);
    tendencia.push({ semana: w, parcial: vistas.length < 7, neto: vistas.every((d) => tend.cubierto(d, hoy)) ? suma(tend, vistas, 'neto') : null,
      comensales: vistas.some((d) => de(tend, d)) && vistas.filter((d) => de(tend, d)).every((d) => de(tend, d).comensales !== null) ? suma(tend, vistas, 'comensales') : null,
      anio: vistas.every((d) => tendAnio.cubierto(sumarDias(d, -ANIO), hoy)) ? suma(tendAnio, vistas.map((d) => sumarDias(d, -ANIO)), 'comparable') : null });
  }

  // The parts only Parrot has: hours, products, payments.
  const conParrot = !!actual.parrotDesde && dias.length > 0 && corte >= actual.parrotDesde;
  const [horas, productos, pagos, reservas, fresco] = conParrot ? await Promise.all([
    todos(db, `SELECT local_date AS d, CAST(strftime('%H', created_at / 1000 - ${OFFSET_S}, 'unixepoch') AS INTEGER) AS h, COUNT(*) AS cuentas, SUM(total_minor - taxes_minor) AS neto
      FROM pos_orders WHERE status = 'FINISHED' AND local_date BETWEEN ? AND ? GROUP BY local_date, h`, P.desde, corte),
    todos(db, `SELECT i.item_name AS nombre, i.category AS categoria, SUM(i.quantity) AS cantidad, SUM(COALESCE(i.subtotal_minor, CAST(ROUND(i.total_minor / 1.16) AS INTEGER))) AS neto
      FROM pos_items i JOIN pos_orders o ON o.uuid = i.order_uuid WHERE o.status = 'FINISHED' AND i.status = 'ACTIVE' AND i.local_date BETWEEN ? AND ? GROUP BY i.item_name, i.category`, P.desde, corte),
    todos(db, `SELECT p.payment_type AS tipo, COUNT(*) AS pagos, SUM(p.amount_minor) AS monto, SUM(p.tip_minor) AS propina FROM pos_payments p JOIN pos_orders o ON o.uuid = p.order_uuid
      WHERE p.status = 'CHARGED' AND o.status = 'FINISHED' AND p.local_date BETWEEN ? AND ? GROUP BY p.payment_type`, P.desde, corte),
    todos(db, 'SELECT status AS estado, COUNT(*) AS reservas, SUM(COALESCE(party_size, 0)) AS personas FROM ot_reservations WHERE service_date BETWEEN ? AND ? GROUP BY status', P.desde, corte),
    db.prepare('SELECT MAX(fetched_at) AS t FROM pos_orders').first(),
  ]) : [[], [], [], [], null];

  const porLinea = new Map(LINEAS.map((l) => [l.id, { ...l, neto: 0, categorias: new Map() }]));
  const items = productos.map((p) => ({ nombre: String(p.nombre), categoria: String(p.categoria || 'Sin categoría'), linea: lineaDe(p.categoria), cantidad: n(p.cantidad), neto: n(p.neto) })).filter((p) => p.neto > 0 || p.cantidad > 0);
  for (const p of items) { const l = porLinea.get(p.linea); l.neto += p.neto; l.categorias.set(p.categoria, (l.categorias.get(p.categoria) || 0) + p.neto); }
  const lineas = [...porLinea.values()].map((l) => ({ id: l.id, nombre: l.nombre, neto: l.neto, categorias: [...l.categorias].map(([nombre, neto]) => ({ nombre, neto })).sort((a, b) => b.neto - a.neto || a.nombre.localeCompare(b.nombre, 'es')) }));
  items.sort((a, b) => b.neto - a.neto || a.nombre.localeCompare(b.nombre, 'es'));

  return {
    hoy, periodo, desde: P.desde, hasta: P.hasta, corte: dias.length ? corte : null, anterior: P.anterior, siguiente: P.siguiente, atras: P.atras, enCurso: P.hasta > hoy && P.desde <= hoy,
    parrotDesde: actual.parrotDesde, conParrot, comensalesDesde: COMENSALES_DESDE,
    total: { neto: dias.length ? neto : null, conIva: suma(actual, dias, 'conIva'), cuentas, comensales, sinConteo, ticketComensal: comensales ? Math.round(netoMesa / comensales) : null,
      ticketCuenta: cuentas ? Math.round(neto / cuentas) : null, descuentos: suma(actual, dias, 'descuentos'), sinCobro: conParrot ? suma(actual, dias, 'sinCobro') : null,
      propinas: conParrot ? pagos.reduce((a, p) => a + n(p.propina), 0) : null, eventos: neto - comparable },
    vs: { anterior: vsAnterior, anio: vsAnio, comensales: comensalesAntes },
    serie, tendencia,
    horas: horas.map((r) => ({ fecha: r.d, hora: n(r.h), cuentas: n(r.cuentas), neto: n(r.neto) })),
    lineas, productos: items.slice(0, 80), productosTotal: items.length,
    pagos: pagos.map((p) => ({ tipo: String(p.tipo || 'Sin tipo'), pagos: n(p.pagos), monto: n(p.monto), propina: n(p.propina) })).sort((a, b) => b.monto - a.monto),
    reservas: reservas.map((r) => ({ estado: r.estado, reservas: n(r.reservas), personas: n(r.personas) })),
    fresco: fresco?.t ?? null,
  };
}

/** Sales of each day of a week, for the manifest: side by side with the reservations, never joined to them. */
export async function ventasDeLaSemana(db, desde, hasta, hoy, ahora = Date.now()) {
  const S = await ventasDiarias(db, desde, hasta, ahora);
  const out = new Map();
  for (const d of rango(desde, hasta)) {
    const x = S.dias.get(d);
    if (!x) { out.set(d, S.cubierto(d, hoy) ? { neto: 0, conIva: 0, cuentas: 0, comensales: d >= COMENSALES_DESDE ? 0 : null, ticket: null } : null); continue; }
    out.set(d, { neto: x.neto, conIva: x.conIva, cuentas: x.cuentas, comensales: x.comensales, ticket: x.comensales ? Math.round(x.netoMesa / x.comensales) : null });
  }
  return out;
}

/** The weekdays the restaurant has been open lately (0 = Sunday), from the checks of the last eight weeks. */
let abiertos = { at: 0, dias: null };
export async function diasAbiertos(db, hoy, ahora = Date.now()) {
  if (abiertos.dias && ahora - abiertos.at < 3_600_000) return abiertos.dias;
  const r = await todos(db, "SELECT DISTINCT local_date AS d FROM pos_orders WHERE status = 'FINISHED' AND local_date >= ?", sumarDias(hoy, -56));
  const cuenta = new Map();
  for (const x of r) cuenta.set(diaSemana(x.d), (cuenta.get(diaSemana(x.d)) || 0) + 1);
  // A weekday counts as open when it had sales in at least three of those weeks (one private event does not open Mondays).
  const dias = new Set([...cuenta].filter(([, c]) => c >= 3).map(([d]) => d));
  abiertos = { at: ahora, dias: dias.size ? dias : new Set([0, 1, 2, 3, 4, 5, 6]) };
  return abiertos.dias;
}
