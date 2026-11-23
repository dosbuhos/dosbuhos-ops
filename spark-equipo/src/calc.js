// Pure calculations for Spark Equipo. No I/O: rows in, view model out, so it runs the same in the Worker and in tests.
// Ported from the "Tablero de ventas" Claude artifact (Nov 2026).

export const GENTE = ['José Luis', 'Carlos', 'Daniel'];
export const VENDEDORES = ['José Luis', 'Carlos'];
// The house account: sales and prospecting Eric and Diane do themselves, under one shared name. It logs contacts and owns
// orders like a rep, but has no contact goal, no rating, and stays out of the team's totals.
export const CASA = 'Tito';
// An order or an account reassigned to this name is not a sale at all (stock placed with a marketplace, a transfer keyed
// as an order): it leaves sales and receivables.
export const NO_VENTA = 'No es venta';
// Who applies the month's punctuality adjustment.
export const APLICA_AJUSTE = 'Carlos';
export const PERSONAS = [...GENTE, CASA];
// Who can own a commitment in the 90-day plan: the reps, the commercial lead, Dirección and the accountants.
export const PLAN_GENTE = ['José Luis', 'Carlos', 'Daniel', 'Ily', 'Dirección', 'Contabilidad'];
// Events: any admin decides up to this total cost (money plus wine); above it, the owner. A sample bottle is valued at
// about its distributor price to compare what an event costs with what it is expected to sell.
export const EVENTO_TOPE = 10000;
export const BOTELLA_MUESTRA = 200;
export const META_DIA = 6; // logged client touches per working day
// Rough time a logged contact takes, to turn a count into hours of work: a visit in person about an hour with the trip,
// a call ten minutes, a message five. An estimate, shown as such.
export const MINUTOS = { presencial: 60, llamada: 10, mensaje: 5 };
// Minutes one contact took: what the rep entered, or the estimate for its medium.
export const tipoMedio = (r) => (r.medio === 'Presencial' ? 'presencial' : /llamada|tel[eé]fono/i.test(r.medio || '') ? 'llamada' : 'mensaje');
export const minutosDe = (r) => (Number(r.minutos) > 0 ? Number(r.minutos) : MINUTOS[tipoMedio(r)]);
export function esfuerzo(c, habiles) {
  const n = (t) => c.filter((r) => tipoMedio(r) === t).length;
  return { habiles, por_dia: habiles ? Math.round(c.length / habiles * 10) / 10 : 0, presencial: n('presencial'), llamadas: n('llamada'), mensajes: n('mensaje'),
    horas: Math.round(c.reduce((t, r) => t + minutosDe(r), 0) / 6) / 10, horas_habiles: habiles * 8, con_tiempo: c.filter((r) => Number(r.minutos) > 0).length };
}
// Zoho "clients" that are not client sales: the house's own accounts (Eric, Diane, events, kitchen, tasting room, online
// store) and sample accounts. They stay out of every salesperson's numbers.
// Receivables that are a bookkeeping gap and not debt to chase. Two rules, both kept in the database: a pattern over the client
// name (sales to "Público en general", the export account), and a cut-off date (balances on orders older than it stay apart
// until Contabilidad confirms whether they were paid). Returns the test for one receivable { cliente, fecha }.
export function conciliador(patron, antes) {
  let re = null; try { re = patron ? new RegExp(patron, 'i') : null; } catch { re = null; }
  const corte = /^\d{4}-\d\d-\d\d$/.test(antes || '') ? antes : '';
  return (f) => !!((re && re.test(f.cliente || '')) || (corte && f.fecha && f.fecha < corte));
}
export const esInterno = (cliente) => /^(dos b[uú]hos\b|tienda online)/i.test(String(cliente || '').trim()) || /\bmuestras\b/i.test(cliente || '');
// Eric's own accounts, whoever keyed the order (per Eric, 20 Nov 2026: La Competencia Imports is his US importer; Carlos only
// helps maintain it). Reported apart, never under a salesperson.
export const DE_ERIC = [{ patron: /la competencia/i, nombre: 'La Competencia Imports', lugar: 'Estados Unidos (Texas)' }];
export const deEric = (cliente) => DE_ERIC.find((e) => e.patron.test(cliente || '')) || null;
// Eric's own accounts count as house sales (Tito), whoever keyed the order in Zoho.
const propia = (cliente) => !esInterno(cliente);
const vend = (x) => (deEric(x.cliente) ? CASA : vendedorDe(x.vendedor));
// Accounts handed to each rep when they started (per Eric, 20 Nov 2026). Shown apart in Efectividad.
// Accounts opened by Ángeles Sánchez (she sold them until February 2025) and handed over already buying.
export const HEREDADAS = { 'José Luis': ['SMDA HOTELES', 'ROSEWOOD MAYAKOBA', 'VIÑA DEL MAR CANCÚN', 'VI&A DEL MAR', 'HIPERVINOS'], 'Carlos': ['Cactus Wine', 'LIZA STIKER', 'VENTANAS AL PARAISO'] };
// Daniel's distributors as they appear in Zoho (LIZA STIKER = Acuyo).
export const DIST_DANIEL = ['Vivid Distribución', 'Grandes Viñedos de Francia', 'LIZA STIKER'];

export const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
const ms = (d) => Date.parse(d + 'T00:00:00Z');
export const diff = (a, b) => Math.round((ms(b) - ms(a)) / 86400000);
export const masDias = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const lunes = (iso) => masDias(iso, -((new Date(iso + 'T00:00:00Z').getUTCDay() + 6) % 7));
export const hoyEn = (tz = 'America/Mexico_City', now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(now);
const esFecha = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
const sum = (l, f) => l.reduce((t, x) => t + (f(x) || 0), 0);
const r0 = Math.round;
const sc = (x, lo, hi) => Math.max(0, Math.min(1, (x - lo) / (hi - lo)));
const cut = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s || '');

export const vendedorDe = (s) => { s = String(s || '').trim(); return s === CASA ? CASA : s.startsWith('Carlos') ? 'Carlos' : /^Jos[eé] Luis/.test(s) ? 'José Luis' : null; };
// A client touch: any CRM row except internal work.
export const esContacto = (r) => !['Otro', 'Administrativo', 'Junta interna', 'Entrega'].includes(r.actividad) && r.tipo !== 'Interno' && !/^interno/i.test(r.cuenta || '');

// Does a CRM account name refer to this Zoho client? Uses the Zoho ↔ CRM alias table.
export function matcher(alias) {
  const aka = new Map((alias || []).map((a) => [a.cliente, String(a.claves || '').split('|').map(norm).filter(Boolean)]));
  return (cuenta, cliente) => {
    const cu = norm(cuenta);
    if (!cu) return false;
    return [...(aka.get(cliente) || []), norm(cliente)].some((k) => cu === k || (k.length >= 5 && cu.includes(k)) || (cu.length >= 5 && k.includes(cu)));
  };
}

// Invoiced totals per client and year. Owner = salesperson on the client's latest invoice since last year.
export function clientesPorAno(invoices, hoy) {
  const y = Number(hoy.slice(0, 4)), md = hoy.slice(5);
  const todas = invoices.filter((x) => !['void', 'draft'].includes(x.estado) && x.total >= 1 && esFecha(x.fecha) && propia(x.cliente)).sort((a, b) => (a.fecha < b.fecha ? -1 : 1));
  // House sales are carved out order by order: they never decide whose client it is and never add to a rep's client totals.
  // They are listed apart, as the house's own clients.
  const inv = todas.filter((x) => vend(x) !== CASA), casa = new Map();
  for (const x of todas.filter((x) => vend(x) === CASA)) {
    const a = casa.get(x.cliente_id) || { cliente: x.cliente, vendedor: CASA, a2: 0, a1: 0, a0: 0, a1_mp: 0, ultima: '' }, yr = Number(x.fecha.slice(0, 4));
    if (yr === y) a.a0 += x.total; else if (yr === y - 1) { a.a1 += x.total; if (x.fecha.slice(5) <= md) a.a1_mp += x.total; } else if (yr === y - 2) a.a2 += x.total;
    if (x.fecha > a.ultima) a.ultima = x.fecha; casa.set(x.cliente_id, a);
  }
  const owner = new Map();
  for (const x of inv) { const v = vendedorDe(x.vendedor); if (v && x.fecha >= (y - 1) + '-01-01') owner.set(x.cliente_id, v); }
  const g = new Map();
  for (const x of inv) {
    if (!owner.has(x.cliente_id)) continue;
    const a = g.get(x.cliente_id) || { cliente: x.cliente, vendedor: owner.get(x.cliente_id), a2: 0, a1: 0, a0: 0, a1_mp: 0, ultima: '' };
    const yr = Number(x.fecha.slice(0, 4));
    if (yr === y) a.a0 += x.total; else if (yr === y - 1) { a.a1 += x.total; if (x.fecha.slice(5) <= md) a.a1_mp += x.total; } else if (yr === y - 2) a.a2 += x.total;
    a.cliente = x.cliente; if (x.fecha > a.ultima) a.ultima = x.fecha;
    g.set(x.cliente_id, a);
  }
  return [...g.values(), ...casa.values()].map((a) => ({ cliente: a.cliente, vendedor: a.vendedor, antepasado: r0(a.a2), pasado: r0(a.a1), pasado_mp: r0(a.a1_mp), actual: r0(a.a0),
    cambio_pct: a.a1_mp > 0 ? r0((a.a0 - a.a1_mp) / a.a1_mp * 1000) / 10 : null, ultima_factura: a.ultima }))
    .sort((a, b) => (b.pasado + b.actual) - (a.pasado + a.actual));
}

// Ordering behaviour per salesperson, from sales orders: new clients, repeat rate, how often each client orders and who is
// overdue against their own rhythm. `ordenes` rows: { fecha, cliente, vendedor, total }.
export function metricasPedidos(ordenes, hoy) {
  const med = (a) => { const b = a.slice().sort((x, y) => x - y), n = b.length; return n ? (n % 2 ? b[(n - 1) / 2] : (b[n / 2 - 1] + b[n / 2]) / 2) : null; };
  const desde = ordenes.reduce((m, o) => (o.fecha < m ? o.fecha : m), hoy);        // first order on record, any client
  const por = new Map();
  for (const o of ordenes.slice().sort((a, b) => (a.fecha < b.fecha ? -1 : 1))) {
    const c = por.get(o.cliente) || { cliente: o.cliente, vendedor: o.vendedor, fechas: [], total_12m: 0 };
    if (o.vendedor !== CASA || c.vendedor === CASA) c.vendedor = o.vendedor;           // the latest order decides whose client it is; a carved-out house sale does not take a rep's client
    if (c.fechas[c.fechas.length - 1] !== o.fecha) c.fechas.push(o.fecha);           // two orders the same day count as one purchase
    if (diff(o.fecha, hoy) <= 365) c.total_12m += o.total;
    por.set(o.cliente, c);
  }
  const clientes = [...por.values()].map((c) => {
    const gaps = c.fechas.slice(1).map((f, i) => diff(c.fechas[i], f)), cada = gaps.length ? Math.round(med(gaps)) : null;
    const primera = c.fechas[0], ultima = c.fechas[c.fechas.length - 1], dias = diff(ultima, hoy);
    // "New" needs the first order to be well after the start of the records; otherwise the client may simply be older than them.
    const nuevo = diff(desde, primera) > 90 && diff(primera, hoy) <= 90;
    const estado = dias > 180 ? 'Inactivo' : nuevo && c.fechas.length === 1 ? 'Nuevo' : cada && c.fechas.length >= 3 && dias > Math.max(45, cada * 1.5) ? 'Ya le tocaba' : 'Al corriente';
    return { cliente: c.cliente, vendedor: c.vendedor, pedidos: c.fechas.length, pedidos_12m: c.fechas.filter((f) => diff(f, hoy) <= 365).length, primera, ultima, dias_sin_pedir: dias, cada_dias: cada,
      total_12m: r0(c.total_12m), estado, es_nuevo: diff(desde, primera) > 90 };
  });
  const lun = lunes(hoy), mes = hoy.slice(0, 7);
  const resumen = [...new Set(clientes.map((c) => c.vendedor))].map((v) => {
    const L = clientes.filter((c) => c.vendedor === v), o90 = ordenes.filter((o) => o.vendedor === v && diff(o.fecha, hoy) <= 90);
    const nuevos = L.filter((c) => c.es_nuevo), base = nuevos.filter((c) => diff(c.primera, hoy) >= 60 && diff(c.primera, hoy) <= 365), volvieron = base.filter((c) => c.pedidos >= 2);
    const meses = []; for (let i = 5; i >= 0; i--) { const d = new Date(Date.UTC(Number(hoy.slice(0, 4)), Number(hoy.slice(5, 7)) - 1 - i, 1)).toISOString().slice(0, 7); meses.push({ mes: d, n: nuevos.filter((c) => c.primera.slice(0, 7) === d).length }); }
    return { vendedor: v, activos_90: L.filter((c) => c.dias_sin_pedir <= 90).length, clientes: L.length,
      nuevos_semana: nuevos.filter((c) => c.primera >= lun).map((c) => c.cliente), nuevos_mes: nuevos.filter((c) => c.primera.slice(0, 7) === mes).map((c) => c.cliente), nuevos_por_mes: meses,
      recompra_base: base.length, recompra_n: volvieron.length, recompra_pct: base.length ? Math.round(volvieron.length / base.length * 100) : null,
      ticket: o90.length ? r0(o90.reduce((t, o) => t + o.total, 0) / o90.length) : null, pedidos_90: o90.length,
      ya_les_tocaba: L.filter((c) => c.estado === 'Ya le tocaba').sort((a, b) => b.total_12m - a.total_12m) };
  });
  return { clientes, resumen, desde };
}

// Accounts whose notes mention pouring by the glass (copeo). The CRM has no field for it yet, so this only reads the notes.
export function copeoEnNotas(contactos) {
  const out = new Map();
  for (const r of contactos) {            // newest first
    if (!/cope|por copa|by the glass/i.test(`${r.resultado || ''} ${r.siguiente_paso || ''}`)) continue;
    const k = r.persona + '|' + norm(r.cuenta);
    const e = out.get(k) || { persona: r.persona, cuenta: r.cuenta, fecha: r.fecha, nota: r.resultado || r.siguiente_paso, menciones: 0 };
    e.menciones++; out.set(k, e);
  }
  return [...out.values()];
}

export function build({ activity, orders, invoices, alias, zonasCfg, prospectos, distribuidores = [], hoy }) {
  const match = matcher(alias);
  const actual = lunes(hoy);
  const act = activity.filter((r) => esFecha(r.fecha) && PERSONAS.includes(r.persona));
  const contactos = act.filter(esContacto).map((r) => ({ ...r, semana: lunes(r.fecha), min: minutosDe(r), min_real: Number(r.minutos) > 0 })).sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
  const ordenes = orders.filter((o) => o.estado !== 'void' && o.total >= 1 && vend(o) && esFecha(o.fecha) && propia(o.cliente))
    .map((o) => ({ fecha: o.fecha, semana: lunes(o.fecha), orden: o.numero, cliente: o.cliente, vendedor: vend(o), total: o.total, facturacion: o.facturacion, pago: o.pago, ...(o.vendedor_zoho !== undefined ? { en_zoho: vendedorDe(o.vendedor_zoho) || 'sin vendedor' } : deEric(o.cliente) ? { en_zoho: vendedorDe(o.vendedor) || 'sin vendedor' } : {}) }))
    .sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
  // Eric's own accounts, from sales orders: this year, last year to the same date, and the last order.
  const y0 = hoy.slice(0, 4), y1 = String(Number(y0) - 1), md = hoy.slice(5);
  const eric = DE_ERIC.map((e) => {
    const o = orders.filter((x) => x.estado !== 'void' && (x.usd != null ? x.usd : x.total) >= 1 && esFecha(x.fecha) && e.patron.test(x.cliente || ''));
    // Export orders arrive converted to pesos and grossed up by 1.4674 (see worker.js); undo the gross-up, they carry no tax.
    const mx = (x) => (x.usd != null ? x.total / 1.4674 : x.total), deAno = o.filter((x) => x.fecha.slice(0, 4) === y0);
    return { cliente: e.nombre, lugar: e.lugar, actual: r0(sum(deAno, mx)), usd: r0(sum(deAno, (x) => x.usd || 0)), pasado_mp: r0(sum(o.filter((x) => x.fecha.slice(0, 4) === y1 && x.fecha.slice(5) <= md), mx)),
      pedidos_12m: o.filter((x) => diff(x.fecha, hoy) <= 365).length, ultima: o.reduce((m, x) => (x.fecha > m ? x.fecha : m), '') };
  });
  const pedidos = metricasPedidos(ordenes, hoy), pedidoDe = new Map(pedidos.clientes.map((c) => [c.cliente, c]));
  const clientes = clientesPorAno(invoices, hoy).map((c) => { const p = pedidoDe.get(c.cliente); return { ...c, pedidos_12m: p ? p.pedidos_12m : 0, cada_dias: p ? p.cada_dias : null, dias_sin_pedir: p ? p.dias_sin_pedir : null, ritmo: p ? p.estado : '' }; });

  // ---- Weeks ----
  const inicio = {};
  for (const r of contactos) if (!inicio[r.persona] || r.semana < inicio[r.persona]) inicio[r.persona] = r.semana;
  // The last week each person logged anything. A zero week before it is a real gap ('En cero'): they logged later weeks and
  // skipped this one. A zero week after it is 'Pendiente': the reps log late, so it may still get filled in.
  const fin = {};
  for (const r of contactos) if (!fin[r.persona] || r.semana > fin[r.persona]) fin[r.persona] = r.semana;
  const primera = Object.values(inicio).sort()[0] || actual;
  const semanas = [];
  for (let w = primera; w <= actual; w = masDias(w, 7)) {
    const habiles = w === actual ? Math.min(5, diff(w, hoy) + 1) : 5, meta = META_DIA * habiles;
    for (const v of PERSONAS) {
      const c = contactos.filter((r) => r.semana === w && r.persona === v), o = ordenes.filter((r) => r.semana === w && r.vendedor === v), n = c.length;
      semanas.push({ semana: w, persona: v, en_curso: w === actual, meta: v === CASA ? 0 : meta, contactos: n,
        veredicto: v === CASA ? (n || o.length ? 'Casa' : 'Sin datos') : w < (inicio[v] || '9999') ? 'Sin datos' : n === 0 ? (w > fin[v] ? 'Pendiente' : 'En cero') : n >= meta ? 'Productiva' : n >= meta / 2 ? 'A medias' : 'Floja',
        cuentas: new Set(c.map((r) => norm(r.cuenta))).size, ...esfuerzo(c, habiles),
        prospeccion: c.filter((r) => r.actividad === 'Prospección').length, cobranza: c.filter((r) => r.actividad === 'Cobranza').length,
        catas: c.filter((r) => ['Cata / prueba de vino', 'Capacitación', 'Evento'].includes(r.actividad)).length,
        entregas: act.filter((r) => r.actividad === 'Entrega' && r.persona === v && lunes(r.fecha) === w).length,   // logged, but not counted as a sales contact
        ventas: v === 'Daniel' ? null : r0(sum(o, (r) => r.total)), ordenes: v === 'Daniel' ? null : o.length });
    }
  }

  // ---- Top clients: last contact vs sales ----
  const cobertura = [];
  for (const v of [...VENDEDORES, CASA]) {
    for (const c of clientes.filter((x) => x.vendedor === v).slice(0, 15)) {
      const hits = contactos.filter((r) => match(r.cuenta, c.cliente) || (norm(c.cliente).length >= 5 && norm(r.resultado).includes(norm(c.cliente))));
      const last = hits[0], d = last ? diff(last.fecha, hoy) : null;
      cobertura.push({ cliente: c.cliente, vendedor: v, actual: c.actual, cambio_pct: c.cambio_pct, ultimo_contacto: last ? last.fecha : null, dias: d,
        estado: d === null ? 'sin registro' : d <= 14 ? 'verde' : d <= 30 ? 'amarillo' : 'rojo', contacto_por: last ? last.persona : '', ultima_nota: last ? last.resultado : '' });
    }
  }

  // ---- Follow-up per account ----
  const ult = new Map();
  for (const r of contactos) { const k = r.persona + '|' + norm(r.cuenta); if (!ult.has(k)) ult.set(k, r); } // contactos is newest first
  const seguimiento = [...ult.values()].map((r) => {
    const ok = esFecha(r.proximo) && r.proximo >= r.fecha, cerrada = /^cerrado/i.test(r.siguiente_paso || '');
    const estado = cerrada ? 'cerrada' : !ok ? 'sin fecha' : r.proximo < hoy ? 'vencida' : 'al día';
    return { cuenta: r.cuenta, persona: r.persona, ultimo_contacto: r.fecha, dias_sin_contacto: diff(r.fecha, hoy), proximo: ok ? r.proximo : null,
      dias_vencido: estado === 'vencida' ? diff(r.proximo, hoy) : 0, estado, etapa: r.etapa || '', ultima_nota: r.resultado || '' };
  }).sort((a, b) => b.dias_sin_contacto - a.dias_sin_contacto);

  // ---- This month's orders ----
  const ym = hoy.slice(0, 7), delMes = ordenes.filter((o) => o.fecha.slice(0, 7) === ym);
  const mes = [...VENDEDORES, CASA].map((v) => {
    const l = delMes.filter((o) => o.vendedor === v);
    return { vendedor: v, total: r0(sum(l, (o) => o.total)), ordenes: l.length, clientes: new Set(l.map((o) => o.cliente)).size,
      sin_facturar: r0(sum(l.filter((o) => o.facturacion !== 'invoiced'), (o) => o.total)),
      por_cobrar: r0(sum(l.filter((o) => o.facturacion === 'invoiced' && o.pago !== 'paid'), (o) => o.total)) };
  });

  // ---- Where to focus ----
  const foco = [];
  for (const v of GENTE) {
    const add = (orden, tipo, titulo, detalle, vista) => foco.push({ persona: v, orden, tipo, titulo, detalle, vista });
    const mine = contactos.filter((r) => r.persona === v), ultimo = mine[0] ? mine[0].fecha : null, dias = ultimo ? diff(ultimo, hoy) : null;
    if (dias === null) add(1, 'registrar', 'Empieza a registrar tus contactos', 'No hay ningún contacto registrado.', 'semanas');
    else if (dias >= 3) add(1, 'registrar', 'Pon tu registro al día', `Tu último contacto registrado fue hace ${dias} días. Lo que no está registrado no cuenta.`, 'semanas');
    const w = semanas.find((r) => r.semana === actual && r.persona === v);
    if (w && w.contactos < w.meta) add(2, 'meta', `Esta semana: ${w.contactos} de ${w.meta} contactos`, `Faltan ${w.meta - w.contactos} para ir al ritmo de ${META_DIA} al día.`, 'semanas');
    if (v !== 'Daniel') {
      cobertura.filter((c) => c.vendedor === v && ['rojo', 'sin registro'].includes(c.estado) && (c.cambio_pct ?? 0) < -20).sort((a, b) => b.actual - a.actual).slice(0, 3)
        .forEach((c) => add(3, 'cliente', 'Busca a ' + c.cliente, `Va ${c.cambio_pct}% contra el año pasado y ` + (c.dias === null ? 'no tiene ningún contacto registrado.' : `lleva ${c.dias} días sin contacto.`), 'seguimiento'));
      seguimiento.filter((r) => r.persona === v && r.estado === 'vencida').sort((a, b) => a.dias_vencido - b.dias_vencido).slice(0, 3)
        .forEach((r) => add(4, 'seguimiento', 'Retoma ' + r.cuenta, `Quedaste de volver hace ${r.dias_vencido} ${r.dias_vencido === 1 ? 'día' : 'días'}. ` + cut(r.ultima_nota, 110), 'seguimiento'));
      const pv = mes.find((r) => r.vendedor === v);
      if (pv && pv.total > 0) add(9, 'bien', `$${pv.total.toLocaleString('en-US')} vendidos este mes`, `${pv.ordenes} órdenes a ${pv.clientes} clientes.`, 'ventas');
      cobertura.filter((c) => c.vendedor === v && (c.cambio_pct ?? 0) > 20 && c.actual > 0).sort((a, b) => b.actual - a.actual).slice(0, 2)
        .forEach((c) => add(9, 'bien', `${c.cliente} crece +${c.cambio_pct}%`, `$${c.actual.toLocaleString('en-US')} este año.`, 'clientes'));
    } else {
      seguimiento.filter((r) => r.persona === v && r.dias_sin_contacto > 30).sort((a, b) => a.dias_sin_contacto - b.dias_sin_contacto).slice(0, 3)
        .forEach((r) => add(4, 'seguimiento', 'Retoma ' + r.cuenta, `Último contacto hace ${r.dias_sin_contacto} días. ` + cut(r.ultima_nota, 110), 'seguimiento'));
    }
    const ok = seguimiento.filter((r) => r.persona === v && r.estado === 'al día').length;
    if (ok) add(9, 'bien', ok + (ok === 1 ? ' seguimiento al día' : ' seguimientos al día'), '', 'seguimiento');
    const prod = semanas.filter((r) => r.persona === v && r.veredicto === 'Productiva').length;
    if (prod) add(9, 'bien', prod + (prod === 1 ? ' semana productiva' : ' semanas productivas'), 'Semanas con 30 contactos o más.', 'semanas');
  }

  // ---- Monthly diagnosis ----
  const meses = [];
  for (const m of [...new Set(semanas.map((w) => w.semana.slice(0, 7)))].sort()) {
    const enMes = contactos.filter((r) => r.fecha.slice(0, 7) === m);
    for (const v of PERSONAS) {
      const ws = semanas.filter((w) => w.semana.slice(0, 7) === m && w.persona === v && w.veredicto !== 'Sin datos');
      const c = enMes.filter((r) => r.persona === v), o = ordenes.filter((r) => r.fecha.slice(0, 7) === m && r.vendedor === v);
      const descuidados = v === 'Daniel' ? [] : clientes.filter((x) => x.vendedor === v).slice(0, 15).filter((x) => x.cambio_pct !== null && x.cambio_pct < -20)
        .filter((x) => !enMes.some((r) => match(r.cuenta, x.cliente))).map((x) => x.cliente);
      const mine = contactos.filter((r) => r.persona === v), promesas = new Map();
      for (const r of mine) {
        if (!esFecha(r.proximo) || r.proximo.slice(0, 7) !== m || r.proximo >= hoy || r.proximo < r.fecha || /^cerrado/i.test(r.siguiente_paso || '')) continue;
        const k = norm(r.cuenta);
        if (!mine.some((x) => norm(x.cuenta) === k && x.fecha > r.fecha)) promesas.set(k, r.cuenta);
      }
      const n = (x) => ws.filter((w) => w.veredicto === x).length, cero = ws.filter((w) => w.veredicto === 'En cero' && !w.en_curso);
      // Working days of the month so far, from the person's first logged week on.
      let habiles = 0;
      for (let d = m + '-01'; d.slice(0, 7) === m && d <= hoy; d = masDias(d, 1)) if (d >= (inicio[v] || '9999') && ![0, 6].includes(new Date(d + 'T00:00:00Z').getUTCDay())) habiles++;
      const meta = v === CASA ? 0 : META_DIA * habiles, nc = c.length;
      const nivel = v === CASA ? (ws.length ? 'Casa' : 'Sin datos') : !ws.length ? 'Sin datos' : nc === 0 ? (m > (fin[v] || '').slice(0, 7) ? 'Pendiente' : 'En cero') : nc >= meta ? 'Productivo' : nc >= meta / 2 ? 'A medias' : 'Flojo';
      meses.push({ mes: m, persona: v, en_curso: m === hoy.slice(0, 7), meta, veredicto: nivel, ...esfuerzo(c, habiles), catas: c.filter((r) => ['Cata / prueba de vino', 'Capacitación', 'Evento'].includes(r.actividad)).length, cobranza: c.filter((r) => r.actividad === 'Cobranza').length, semanas: ws.length, pendientes: n('Pendiente'), productivas: n('Productiva'), a_medias: n('A medias'), flojas: n('Floja'), en_cero: cero.length, semanas_en_cero: cero.map((w) => w.semana),
        contactos: c.length, cuentas: new Set(c.map((r) => norm(r.cuenta))).size, prospeccion: c.filter((r) => r.actividad === 'Prospección').length,
        ventas: v === 'Daniel' ? null : r0(sum(o, (r) => r.total)), ordenes: v === 'Daniel' ? null : o.length, descuidados, promesas: [...promesas.values()] });
    }
  }

  // ---- Zones ----
  const zonaDe = (c) => (zonasCfg.clientes[c.cliente] || 'bajio');
  const totalActual = sum(clientes.filter((c) => !deEric(c.cliente)), (c) => c.actual) || 1;
  let zonas = zonasCfg.zonas.map((z) => {
    const cl = clientes.filter((c) => zonaDe(c) === z.zona && !deEric(c.cliente));       // the US importer is not a Mexican zone
    const ventas = r0(sum(cl, (c) => c.actual));
    return { ...z, ventas, ventas_pasado: r0(sum(cl, (c) => c.pasado)), clientes_activos: cl.filter((c) => c.actual > 0).length, pct_ventas: r0(ventas / totalActual * 1000) / 10 };
  });
  const ref = zonas.find((z) => z.zona === 'caribe'), bench = ref && ref.mercado_mdp ? ref.ventas / ref.mercado_mdp : 0;
  zonas = zonas.map((z) => {
    const ratio = bench ? (z.ventas / z.mercado_mdp) / bench : 0, potencial = r0(bench * z.mercado_mdp);
    return { ...z, ritmo_pct: r0(ratio * 100), potencial, brecha: Math.max(0, potencial - z.ventas),
      estado: z.zona === 'bajio' || ratio >= 0.8 ? 'Fuerte' : (z.n_dist === 0 || ratio < 0.1) ? 'Sin presencia' : 'Presencia débil' };
  }).sort((a, b) => b.brecha - a.brecha);
  const tipoDe = (p) => (/cliente/i.test(p.tipo) ? 'cliente' : /distribu|br[oó]ker/i.test(p.tipo) ? 'dist' : /retail|tienda|autoservicio|vinater|departament/i.test(p.tipo) ? 'tienda' : 'horeca');
  // Prospects: the researched list per zone, merged with the distributor list Carlos keeps (his file: who he reached, when,
  // what they said, who turned us down). A contact logged in the CRM counts too; the most recent of the two wins.
  const dist = distribuidores.map((d) => ({ ...d, k: norm(d.nombre).replace(/\(.*?\)/g, '').trim() })), usados = new Set();
  const avanceDe = (d, ult) => (d.grupo === 'Rechazada' ? 'Rechazado' : d.grupo === 'Catalogado' ? 'Catalogado' : d.grupo === 'En proceso' || ult ? 'En proceso' : 'Por contactar');
  const unir = (p, d, last) => {
    const crm = last ? last.fecha : '', arch = d ? d.ultimo || '' : '', ult = crm > arch ? crm : arch;
    return { ...p, ultimo_contacto: ult || null, dias: ult ? diff(ult, hoy) : null, contacto_por: ult ? (crm >= arch && last ? last.persona : (d && d.responsable) || 'Carlos') : '',
      avance: d ? avanceDe(d, ult) : ult ? 'En proceso' : 'Sin contactar', de_carlos: !!d,
      contacto: d ? d.contacto : '', telefono: d ? d.telefono : '', email: d ? d.email : '', status: d ? d.status : '', paso: d ? d.avance : '', siguiente: d ? d.comentarios : (last ? last.siguiente_paso || '' : ''),
      proximo: d ? d.proximo || '' : '', motivo: d ? d.motivo || '' : '', linea: d ? d.linea || '' : '', responsable: d ? d.responsable || 'Carlos' : '', plaza: d ? d.plaza : '' };
  };
  const prospectosCRM = prospectos.map((p) => {
    const keys = String(p.claves || '').split('|').map(norm).filter((k) => k.length >= 3);
    const last = contactos.find((r) => keys.some((k) => norm(r.cuenta).includes(k)));
    const d = dist.find((x) => x.zona === p.zona && !usados.has(x) && keys.some((k) => x.k.includes(k) || (x.k.length >= 5 && k.includes(x.k))));
    if (d) usados.add(d);
    const u = unir({ zona: p.zona, nombre: p.nombre, tipo: p.tipo, clase: tipoDe(p), ciudades: p.ciudades, razon: p.razon, estado: p.estado, fuente: p.fuente }, d, last);
    // An account someone created in Spark carries its own contact details and owner.
    return p.nueva ? { ...u, nueva: true, contacto: u.contacto || p.contacto || '', telefono: u.telefono || p.telefono || '', email: u.email || p.email || '', responsable: p.vendedor || '' } : u;
  });
  for (const d of dist) {
    if (usados.has(d)) continue;
    const last = contactos.find((r) => d.k.length >= 4 && norm(r.cuenta).includes(d.k));
    prospectosCRM.push(unir({ zona: d.zona, nombre: d.nombre, tipo: d.tipo || 'Distribuidor', clase: tipoDe({ tipo: d.tipo || 'Distribuidor' }), ciudades: d.plaza, razon: '', estado: 'Lista de Carlos', fuente: '' }, d, last));
  }
  // How much of each zone's list has actually been worked.
  zonas = zonas.map((z) => { const L = prospectosCRM.filter((p) => p.zona === z.zona && p.clase !== 'cliente');
    return { ...z, prospectos: L.length, en_proceso: L.filter((p) => ['En proceso', 'Catalogado'].includes(p.avance)).length, rechazados: L.filter((p) => p.avance === 'Rechazado').length,
      sin_contactar: L.filter((p) => !p.ultimo_contacto).length, ultimo_prospecto: L.reduce((m, p) => (p.ultimo_contacto && p.ultimo_contacto > m ? p.ultimo_contacto : m), '') }; });
  // Carlos's open distributors join his follow-up list when the CRM has no contact for them, dated as in his file.
  for (const d of dist) {
    const quien = GENTE.includes(d.responsable) ? d.responsable : 'Carlos';
    if (!['En proceso', 'Catalogado'].includes(d.grupo) || !d.ultimo || seguimiento.some((r) => r.persona === quien && d.k.length >= 4 && norm(r.cuenta).includes(d.k))) continue;
    seguimiento.push({ cuenta: d.nombre, persona: quien, ultimo_contacto: d.ultimo, dias_sin_contacto: diff(d.ultimo, hoy), proximo: esFecha(d.proximo) ? d.proximo : null, dias_vencido: esFecha(d.proximo) && d.proximo < hoy ? diff(d.proximo, hoy) : 0, estado: !esFecha(d.proximo) ? 'sin fecha' : d.proximo < hoy ? 'vencida' : 'al día', etapa: '',
      ultima_nota: [d.plaza, d.status, d.avance, d.comentarios].filter(Boolean).join(' · '), de_archivo: true });
  }
  seguimiento.sort((a, b) => b.dias_sin_contacto - a.dias_sin_contacto);

  // ---- Effectiveness ----
  const corte = masDias(hoy, -30);
  const efectividad = VENDEDORES.map((v) => {
    const L = clientes.filter((c) => c.vendedor === v), H = (HEREDADAS[v] || []).map(norm);
    const her = L.filter((c) => H.includes(norm(c.cliente))), sin = L.filter((c) => !H.includes(norm(c.cliente)));
    const sinA = sum(sin, (c) => c.actual), sinP = sum(sin, (c) => c.pasado_mp), crec = sinP ? (sinA - sinP) / sinP * 100 : null;
    const mine = contactos.filter((r) => r.persona === v), names = L.map((c) => c.cliente);
    const acct = new Map();
    for (const r of mine) { if (r.fecha > corte) continue; const k = norm(r.cuenta); (acct.get(k) || acct.set(k, { cuenta: r.cuenta, fechas: [] }).get(k)).fechas.push(r.fecha); }
    let compraron = 0;
    for (const e of acct.values()) {
      const cli = names.find((n) => match(e.cuenta, n));
      if (!cli) continue;
      const os = ordenes.filter((o) => o.cliente === cli);
      if (e.fechas.some((f) => os.some((o) => o.fecha >= f && diff(f, o.fecha) <= 30))) compraron += 1;
    }
    const desde = mine.length ? mine[mine.length - 1].fecha : hoy, os = ordenes.filter((o) => o.vendedor === v && o.fecha >= desde);
    const conSeg = os.filter((o) => mine.some((r) => r.fecha <= o.fecha && diff(r.fecha, o.fecha) <= 60 && match(r.cuenta, o.cliente)));
    const pros = new Map();
    for (const r of mine) if (r.actividad === 'Prospección') { const k = norm(r.cuenta); if (!pros.has(k) || r.fecha < pros.get(k).fecha) pros.set(k, r); }
    const prospeccion = [...pros.values()].map((r) => {
      const cli = [...new Set([...names, ...ordenes.map((o) => o.cliente)])].find((n) => match(r.cuenta, n)) || null;
      const after = cli ? ordenes.filter((o) => o.cliente === cli && o.fecha >= r.fecha) : [];
      return { cuenta: r.cuenta, primera: r.fecha, cliente_zoho: cli, compro: after.length > 0, vendido: r0(sum(after, (o) => o.total)) };
    }).sort((a, b) => (b.compro - a.compro) || (b.vendido - a.vendido));
    const nuevos = sin.filter((c) => c.antepasado === 0 && c.pasado === 0 && c.actual > 0), perdidos = sin.filter((c) => c.pasado > 0 && c.actual === 0);
    const conv = acct.size ? compraron / acct.size * 100 : 0, vOs = sum(os, (o) => o.total), seg = vOs ? sum(conSeg, (o) => o.total) / vOs * 100 : 0;
    const pC = prospeccion.filter((p) => p.compro).length, pPct = prospeccion.length ? pC / prospeccion.length * 100 : 0;
    const nV = sum(nuevos, (c) => c.actual), nPct = sinA ? nV / sinA * 100 : 0;
    const pts = [25 * sc(conv, 0, 40), 25 * sc(crec ?? 0, -30, 30), 20 * sc(nPct, 0, 25), 15 * sc(pPct, 0, 25), 15 * sc(seg, 0, 70)].map(r0);
    const total = sum(L, (c) => c.actual);
    return { persona: v, calificacion: sum(pts, (x) => x), total, heredadas: r0(sum(her, (c) => c.actual)), heredadas_pct: total ? r0(sum(her, (c) => c.actual) / total * 100) : 0,
      sin_heredadas: r0(sinA), sin_heredadas_pasado: r0(sinP), crecimiento_pct: crec === null ? null : r0(crec * 10) / 10,
      partes: [
        { nombre: 'Contactos que compran en 30 días', valor: `${r0(conv)}% (${compraron} de ${acct.size})`, pts: pts[0], de: 25 },
        { nombre: 'Crecimiento sin cuentas heredadas', valor: crec === null ? '—' : (crec > 0 ? '+' : '') + (r0(crec * 10) / 10) + '%', pts: pts[1], de: 25 },
        { nombre: 'Venta de clientes nuevos', valor: `${r0(nPct)}% ($${r0(nV).toLocaleString('en-US')})`, pts: pts[2], de: 20 },
        { nombre: 'Prospectos que ya compraron', valor: `${pC} de ${prospeccion.length}`, pts: pts[3], de: 15 },
        { nombre: 'Ventas con contacto previo', valor: r0(seg) + '%', pts: pts[4], de: 15 }],
      nuevos: nuevos.map((c) => ({ cliente: c.cliente, monto: c.actual })), perdidos: perdidos.map((c) => ({ cliente: c.cliente, monto: c.pasado })), prospeccion };
  });
  { // Daniel: brand ambassador, judged on what he moves rather than on invoices.
    const dist = clientes.filter((c) => DIST_DANIEL.includes(c.cliente)), dA = sum(dist, (c) => c.actual), dP = sum(dist, (c) => c.pasado_mp), crec = dP ? (dA - dP) / dP * 100 : 0;
    const mine = contactos.filter((r) => r.persona === 'Daniel'), last = new Map();
    for (const r of mine) { if (/vivid|gvf|grandes vi|acuyo/i.test(r.cuenta)) continue; const k = norm(r.cuenta); if (!last.has(k)) last.set(k, r); }
    const cuentas = [...last.values()], cat = cuentas.filter((r) => ['Catalogado', 'Compra regular'].includes(r.etapa));
    const semanasN = mine.length ? Math.max(1, diff(mine[mine.length - 1].fecha, hoy) / 7) : 1;
    const actW = mine.filter((r) => ['Cata / prueba de vino', 'Capacitación', 'Evento'].includes(r.actividad)).length / semanasN;
    const cob = cuentas.filter((r) => diff(r.fecha, hoy) <= 30).length;
    const catPct = cuentas.length ? cat.length / cuentas.length * 100 : 0, cobPct = cuentas.length ? cob / cuentas.length * 100 : 0;
    const pts = [35 * sc(crec, -30, 30), 35 * sc(catPct, 0, 30), 15 * sc(actW, 0, 3), 15 * sc(cobPct, 0, 70)].map(r0);
    efectividad.push({ persona: 'Daniel', calificacion: sum(pts, (x) => x), partes: [
      { nombre: 'Compras de sus distribuidores vs. año pasado', valor: (crec > 0 ? '+' : '') + (r0(crec * 10) / 10) + '%', pts: pts[0], de: 35 },
      { nombre: 'Cuentas catalogadas o comprando', valor: `${cat.length} de ${cuentas.length}`, pts: pts[1], de: 35 },
      { nombre: 'Catas, capacitaciones y eventos por semana', valor: String(r0(actW * 10) / 10), pts: pts[2], de: 15 },
      { nombre: 'Cuentas con contacto en 30 días', valor: `${cob} de ${cuentas.length}`, pts: pts[3], de: 15 }], nuevos: [], perdidos: [], prospeccion: [] });
  }

  // ---- Client book: every buying client with the contact details found in the reps' notes ----
  const zonaNombre = new Map(zonasCfg.zonas.map((z) => [z.zona, z.nombre]));
  const directorio = clientes.map((c) => {
    const notas = contactos.filter((r) => match(r.cuenta, c.cliente));            // newest first
    // "NA", "por conseguir" and the like are the reps' way of leaving a field blank.
    const real = (v) => { v = (v || '').trim(); return v && !/^(n\.?\/?a\.?|no|s\/?n|sin( dato| datos| info)?|por conseguir|pendiente|\?+|-+|x+)$/i.test(v); };
    const con = notas.find((r) => real(r.contacto)), tel = notas.find((r) => real(r.telefono));
    const dato = tel ? tel.telefono.trim() : '', correo = (dato.match(/[\w.+-]+@[\w-]+\.[\w.]+/) || [''])[0];
    const fuera = deEric(c.cliente);
    return { clave: norm(c.cliente), nombre: c.cliente, pais: fuera ? 'Estados Unidos' : 'México', zona: fuera ? 'usa' : zonaDe(c), zona_nombre: fuera ? 'Estados Unidos · importador' : zonaNombre.get(zonaDe(c)) || '', vendedor: c.vendedor, tipo: (notas.find((r) => r.tipo) || {}).tipo || '',
      contacto: con ? con.contacto.trim() : '', telefono: correo ? dato.replace(correo, '').replace(/[\/|,;\s]+$/, '').trim() : dato, email: correo, ciudad: '', estado: '', puesto: '', notas: '',
      vendido: c.actual, ritmo: c.ritmo, dias_sin_pedir: c.dias_sin_pedir, ultimo_contacto: notas[0] ? notas[0].fecha : '' };
  });

  // ---- Pipeline: where each account stands, from the stage on its latest CRM entry ----
  const FASES = ['Contacto inicial', 'En proceso', 'Catalogado', 'Compra regular'];
  const embudo = PERSONAS.map((v) => ({ persona: v, fases: FASES.map((f) => { const L = seguimiento.filter((r) => r.persona === v && r.estado !== 'cerrada' && r.etapa === f); return { fase: f, n: L.length, cuentas: L.map((r) => r.cuenta) }; }),
    sin_fase: seguimiento.filter((r) => r.persona === v && r.estado !== 'cerrada' && !FASES.includes(r.etapa)).length }));

  return { hoy, semana_actual: actual, directorio, embudo, semanas, contactos, ordenes, clientes, cobertura, seguimiento, mes, foco, meses, zonas, prospectos: prospectosCRM, efectividad, pedidos: pedidos.resumen, copeo: copeoEnNotas(contactos), eric };
}

// What one signed-in person may see. Reps get their own rows; the map and prospects are for everyone; Efectividad is admin only.
// What a signed-in person gets. The whole team's numbers are visible to everyone on the team; the effectiveness rating stays
// with admins.
export function paraVer(m, quien) {
  // Everyone sees the growth facts (against last year without inherited accounts, accounts opened and lost); the full score stays with admins.
  const crecimiento = (m.efectividad || []).map((e) => ({ persona: e.persona, total: e.total, crecimiento_pct: e.crecimiento_pct, nuevos: e.nuevos, perdidos: e.perdidos }));
  return { ...m, crecimiento, efectividad: quien.admin ? m.efectividad : [], yo: { admin: !!quien.admin, dueno: !!quien.dueno, persona: quien.persona || null, nombre: quien.nombre || '' } };
}
