// Pure calculations for Spark Equipo. No I/O: rows in, view model out, so it runs the same in the Worker and in tests.
// Ported from the "Tablero de ventas" Claude artifact (Nov 2026).

export const GENTE = ['José Luis', 'Carlos', 'Daniel'];
export const VENDEDORES = ['José Luis', 'Carlos'];
export const META_DIA = 6; // logged client touches per working day
// Accounts handed to each rep when they started (per Eric, 20 Nov 2026). Shown apart in Efectividad.
export const HEREDADAS = { 'José Luis': ['SMDA HOTELES', 'ROSEWOOD MAYAKOBA', 'VIÑA DEL MAR CANCÚN'], 'Carlos': ['Cactus Wine', 'LIZA STIKER'] };
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

export const vendedorDe = (s) => { s = String(s || '').trim(); return s.startsWith('Carlos') ? 'Carlos' : /^Jos[eé] Luis/.test(s) ? 'José Luis' : null; };
// A client touch: any CRM row except internal work.
export const esContacto = (r) => !['Otro', 'Administrativo', 'Junta interna'].includes(r.actividad) && r.tipo !== 'Interno' && !/^interno/i.test(r.cuenta || '');

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
  const inv = invoices.filter((x) => !['void', 'draft'].includes(x.estado) && x.total >= 1 && esFecha(x.fecha)).sort((a, b) => (a.fecha < b.fecha ? -1 : 1));
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
  return [...g.values()].map((a) => ({ cliente: a.cliente, vendedor: a.vendedor, antepasado: r0(a.a2), pasado: r0(a.a1), pasado_mp: r0(a.a1_mp), actual: r0(a.a0),
    cambio_pct: a.a1_mp > 0 ? r0((a.a0 - a.a1_mp) / a.a1_mp * 1000) / 10 : null, ultima_factura: a.ultima }))
    .sort((a, b) => (b.pasado + b.actual) - (a.pasado + a.actual));
}

export function build({ activity, orders, invoices, alias, zonasCfg, prospectos, hoy }) {
  const match = matcher(alias);
  const actual = lunes(hoy);
  const act = activity.filter((r) => esFecha(r.fecha) && GENTE.includes(r.persona));
  const contactos = act.filter(esContacto).map((r) => ({ ...r, semana: lunes(r.fecha) })).sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
  const ordenes = orders.filter((o) => o.estado !== 'void' && o.total >= 1 && vendedorDe(o.vendedor) && esFecha(o.fecha))
    .map((o) => ({ fecha: o.fecha, semana: lunes(o.fecha), orden: o.numero, cliente: o.cliente, vendedor: vendedorDe(o.vendedor), total: o.total, facturacion: o.facturacion, pago: o.pago }))
    .sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
  const clientes = clientesPorAno(invoices, hoy);

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
    for (const v of GENTE) {
      const c = contactos.filter((r) => r.semana === w && r.persona === v), o = ordenes.filter((r) => r.semana === w && r.vendedor === v), n = c.length;
      semanas.push({ semana: w, persona: v, en_curso: w === actual, meta, contactos: n,
        veredicto: w < (inicio[v] || '9999') ? 'Sin datos' : n === 0 ? (w > fin[v] ? 'Pendiente' : 'En cero') : n >= meta ? 'Productiva' : n >= meta / 2 ? 'A medias' : 'Floja',
        cuentas: new Set(c.map((r) => norm(r.cuenta))).size, presencial: c.filter((r) => r.medio === 'Presencial').length,
        prospeccion: c.filter((r) => r.actividad === 'Prospección').length, cobranza: c.filter((r) => r.actividad === 'Cobranza').length,
        catas: c.filter((r) => ['Cata / prueba de vino', 'Capacitación', 'Evento'].includes(r.actividad)).length,
        ventas: v === 'Daniel' ? null : r0(sum(o, (r) => r.total)), ordenes: v === 'Daniel' ? null : o.length });
    }
  }

  // ---- Top clients: last contact vs sales ----
  const cobertura = [];
  for (const v of VENDEDORES) {
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
  const mes = VENDEDORES.map((v) => {
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
    for (const v of GENTE) {
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
      meses.push({ mes: m, persona: v, semanas: ws.length, pendientes: n('Pendiente'), productivas: n('Productiva'), a_medias: n('A medias'), flojas: n('Floja'), en_cero: cero.length, semanas_en_cero: cero.map((w) => w.semana),
        contactos: c.length, cuentas: new Set(c.map((r) => norm(r.cuenta))).size, prospeccion: c.filter((r) => r.actividad === 'Prospección').length,
        ventas: v === 'Daniel' ? null : r0(sum(o, (r) => r.total)), ordenes: v === 'Daniel' ? null : o.length, descuidados, promesas: [...promesas.values()] });
    }
  }

  // ---- Zones ----
  const zonaDe = (c) => (zonasCfg.clientes[c.cliente] || 'bajio');
  const totalActual = sum(clientes, (c) => c.actual) || 1;
  let zonas = zonasCfg.zonas.map((z) => {
    const cl = clientes.filter((c) => zonaDe(c) === z.zona);
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
  const prospectosCRM = prospectos.map((p) => {
    const keys = String(p.claves || '').split('|').map(norm).filter((k) => k.length >= 3);
    const last = contactos.find((r) => keys.some((k) => norm(r.cuenta).includes(k)));
    return { zona: p.zona, nombre: p.nombre, tipo: p.tipo, clase: tipoDe(p), ciudades: p.ciudades, razon: p.razon, estado: p.estado, fuente: p.fuente, ultimo_contacto: last ? last.fecha : null, contacto_por: last ? last.persona : '' };
  });

  // ---- Effectiveness ----
  const corte = masDias(hoy, -30);
  const efectividad = VENDEDORES.map((v) => {
    const L = clientes.filter((c) => c.vendedor === v), H = HEREDADAS[v] || [];
    const her = L.filter((c) => H.includes(c.cliente)), sin = L.filter((c) => !H.includes(c.cliente));
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

  return { hoy, semana_actual: actual, semanas, contactos, ordenes, clientes, cobertura, seguimiento, mes, foco, meses, zonas, prospectos: prospectosCRM, efectividad };
}

// What one signed-in person may see. Reps get their own rows; the map and prospects are for everyone; Efectividad is admin only.
export function paraVer(m, quien) {
  if (quien.admin) return { ...m, yo: quien };
  const p = quien.persona, mio = (k) => (r) => r[k] === p;
  return { hoy: m.hoy, semana_actual: m.semana_actual, yo: quien,
    semanas: m.semanas.filter(mio('persona')), contactos: m.contactos.filter(mio('persona')), ordenes: m.ordenes.filter(mio('vendedor')),
    clientes: m.clientes.filter(mio('vendedor')), cobertura: m.cobertura.filter(mio('vendedor')), seguimiento: m.seguimiento.filter(mio('persona')),
    mes: m.mes.filter(mio('vendedor')), foco: m.foco.filter(mio('persona')), meses: m.meses.filter(mio('persona')),
    zonas: m.zonas, prospectos: m.prospectos, efectividad: [] };
}
