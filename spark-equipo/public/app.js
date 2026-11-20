// Spark Equipo — phone-first UI. Every figure comes computed from /api/data; this file only lays it out.
const $ = (id) => document.getElementById(id);
const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v; else if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  return el;
};
const svg = (tag, attrs = {}, ...kids) => {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  for (const c of kids.flat(Infinity)) if (c != null) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  return el;
};
const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MESL = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const dia = (iso) => (iso ? Number(iso.slice(8)) + ' ' + MES[Number(iso.slice(5, 7)) - 1] : '—');
const peso = (n) => (n == null ? '—' : '$' + Math.round(n).toLocaleString('en-US'));
const pct = (p) => (p == null ? '—' : (p > 0 ? '+' : '') + p + '%');
const mas = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const KIND = { Productiva: 'ok', 'A medias': 'warn', Floja: 'bad', 'En cero': 'bad', 'Sin datos': 'mute' };
const pill = (text, kind) => h('span', { class: 'pill ' + kind }, text);

let D = null;
const S = { vista: 'hoy', persona: '', semana: null, segFiltro: 'vencida', segOrden: 'viejo', zona: '', clase: '', abierto: {}, orden: {} };

// Bottom tabs: the four daily screens plus "Más".
const TABS = [['hoy', 'Hoy'], ['semanas', 'Semanas'], ['seguimiento', 'Seguimiento'], ['ventas', 'Ventas'], ['mas', 'Más']];
const MAS = [['clientes', 'Clientes año contra año'], ['zonas', 'Zonas y prospectos'], ['efectividad', 'Efectividad', true], ['ajustes', 'Ajustes', true]];

function ir(vista, persona) {
  if (persona !== undefined && D.yo.admin) S.persona = persona;
  S.vista = vista; $('sheet').hidden = true;
  if (location.hash.slice(1) !== vista) history.pushState(null, '', '#' + vista); // so the phone's back button walks the screens
  pintar(); window.scrollTo(0, 0);
}
const deHash = () => { const v = location.hash.slice(1); S.vista = VISTAS[v] && (D.yo.admin || !['efectividad', 'ajustes'].includes(v)) ? v : 'hoy'; };
addEventListener('popstate', () => { if (D) { deHash(); $('sheet').hidden = true; pintar(); } });
const personas = () => (D.yo.admin ? (S.persona ? [S.persona] : ['José Luis', 'Carlos', 'Daniel']) : [D.yo.persona]);
const vendedores = () => personas().filter((p) => p !== 'Daniel');
const veo = (p) => personas().includes(p);

// Semicircle gauge: red under half the goal, amber up to it, green from there.
function gauge(n, meta, label) {
  const W = 200, r = 88, cx = 100, cy = 100, max = Math.max(meta * 1.5, 1);
  const pt = (v, rad) => { const a = Math.PI * (1 - Math.min(v, max) / max); return [cx + rad * Math.cos(a), cy - rad * Math.sin(a)]; };
  const arc = (a, b, color) => { const [x0, y0] = pt(a, r), [x1, y1] = pt(b, r); return svg('path', { d: `M${x0} ${y0} A${r} ${r} 0 0 1 ${x1} ${y1}`, fill: 'none', stroke: color, 'stroke-width': 22 }); };
  const [nx, ny] = pt(n, r - 4);
  return svg('svg', { viewBox: `0 0 ${W} 112`, role: 'img', 'aria-label': label, style: 'width:100%;max-width:240px;display:block;margin:4px auto' },
    arc(0, meta / 2, 'var(--bad)'), arc(meta / 2, meta, 'var(--warn)'), arc(meta, max, 'var(--ok)'),
    svg('line', { x1: cx, y1: cy, x2: nx, y2: ny, stroke: 'var(--text)', 'stroke-width': 4, 'stroke-linecap': 'round' }), svg('circle', { cx, cy, r: 6, fill: 'var(--text)' }));
}
// Desktop layout from 960px: top navigation, wider grid, and lists as sortable tables.
const mq = matchMedia('(min-width: 960px)');
const ancho = () => mq.matches;
mq.addEventListener('change', () => { if (D) { $('sheet').hidden = true; pintar(); } });
// A list capped at n with a "show all" button. On a phone each item is a stacked row (fila); on desktop, when cols is given,
// it is a table whose headers sort. cols: [{ t: header, v: row => cell, s: row => sort value, num: right-aligned }].
function lista(key, items, n, fila, vacio, cols) {
  if (!items.length) return h('p', { class: 'note' }, vacio);
  const open = S.abierto[key], mas = items.length > n ? h('button', { class: 'more', onclick: () => { S.abierto[key] = !open; pintar(); } }, open ? 'Ver menos' : `Ver los ${items.length}`) : null;
  if (!cols || !ancho()) return h('div', {}, h('ul', { class: 'rows' }, (open ? items : items.slice(0, n)).map(fila)), mas);
  cols = cols.filter(Boolean);
  const o = S.orden[key];
  if (o && cols[o[0]] && cols[o[0]].s) { const f = cols[o[0]].s; items = items.slice().sort((a, b) => { const x = f(a), y = f(b); return (x == null ? 1 : y == null ? -1 : x < y ? -1 : x > y ? 1 : 0) * o[1]; }); }
  const th = (c, i) => h('th', { class: c.num ? 'r' : null, 'aria-sort': o && o[0] === i ? (o[1] > 0 ? 'ascending' : 'descending') : null },
    c.s ? h('button', { onclick: () => { S.orden[key] = [i, o && o[0] === i ? -o[1] : (c.num ? -1 : 1)]; pintar(); } }, c.t, o && o[0] === i ? (o[1] > 0 ? ' ▲' : ' ▼') : '') : c.t);
  return h('div', {}, h('div', { class: 'tblwrap' }, h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, cols.map(th))),
    h('tbody', {}, (open ? items : items.slice(0, n)).map((r) => h('tr', {}, cols.map((c) => h('td', { class: (c.num ? 'r ' : '') + (c.cls || '') }, c.v(r)))))))), mas);
}
const chips = (opts, cur, set) => h('div', { class: 'chips' }, opts.map(([v, t]) => h('button', { class: 'chip', 'aria-pressed': String(cur === v), onclick: () => { set(v); pintar(); } }, t)));
const semDe = (w, p) => D.semanas.find((r) => r.semana === w && r.persona === p);

const VISTAS = {
  hoy() {
    return h('div', { class: 'grid3' }, personas().map((p) => {
      const w = semDe(D.semana_actual, p), items = D.foco.filter((f) => f.persona === p).sort((a, b) => a.orden - b.orden);
      const ul = (rows) => h('ul', { class: 'foco' }, rows.map((f) => h('li', { class: f.tipo }, h('button', { onclick: () => ir(f.vista, D.yo.admin ? p : undefined) }, f.titulo), f.detalle ? h('span', {}, f.detalle) : null)));
      const todo = items.filter((f) => f.tipo !== 'bien'), bien = items.filter((f) => f.tipo === 'bien');
      return h('section', { class: 'card' },
        h('div', { class: 'name' }, p, w ? pill(w.veredicto, KIND[w.veredicto]) : null),
        w ? h('div', {}, h('span', { class: 'num' }, `${w.contactos} / ${w.meta}`), h('span', { class: 'note' }, ' contactos esta semana')) : null,
        h('h3', {}, 'Enfócate en'), todo.length ? ul(todo) : h('p', { class: 'note' }, 'Sin pendientes urgentes.'),
        bien.length ? [h('h3', {}, 'Va bien'), ul(bien)] : null);
    }));
  },

  semanas() {
    const todas = [...new Set(D.semanas.map((r) => r.semana))];
    const w = S.semana && todas.includes(S.semana) ? S.semana : D.semana_actual, i = todas.indexOf(w), m = w.slice(0, 7);
    const set = (x) => { S.semana = x; pintar(); };
    const ps = personas();
    const NW = ancho() ? 16 : 8;
    const heat = h('div', { class: 'heat', style: `grid-template-columns:auto repeat(${Math.min(todas.length, NW)},minmax(0,1fr))` });
    const ult = todas.slice(-NW);
    heat.append(h('span'));
    ult.forEach((x, k) => heat.append(h('span', { class: 'h' }, k === 0 || x.slice(5, 7) !== ult[k - 1].slice(5, 7) ? MES[Number(x.slice(5, 7)) - 1] : '·')));
    for (const p of ps) {
      heat.append(h('span', { class: 'rn' }, p));
      for (const x of ult) {
        const r = semDe(x, p);
        if (!r || r.veredicto === 'Sin datos') { heat.append(h('span', { class: 'h' }, '–')); continue; }
        heat.append(h('button', { class: (r.contactos ? '' : 'zero') + (x === w ? ' cur' : ''), style: r.contactos ? `background:var(--${KIND[r.veredicto]})` : null,
          'aria-label': `${p}, semana del ${dia(x)}: ${r.contactos} contactos, ${r.veredicto}`, onclick: () => set(x) }, r.contactos));
      }
    }
    const delMes = D.semanas.filter((r) => r.semana.slice(0, 7) === m && ps.includes(r.persona));
    const ceros = delMes.filter((r) => r.veredicto === 'En cero' && !r.en_curso);
    const diag = D.meses.filter((r) => r.mes === m && ps.includes(r.persona));
    const cont = D.contactos.filter((r) => r.semana === w && ps.includes(r.persona)).slice().reverse();
    const ords = D.ordenes.filter((r) => r.semana === w && ps.includes(r.vendedor)).slice().reverse();
    return h('div', {},
      h('div', { class: 'weeknav' },
        h('button', { 'aria-label': 'Semana anterior', disabled: i <= 0, onclick: () => set(todas[i - 1]) }, '‹'),
        h('div', { class: 'lbl' }, `${dia(w)} – ${dia(mas(w, 6))}`),
        h('button', { 'aria-label': 'Semana siguiente', disabled: i >= todas.length - 1, onclick: () => set(todas[i + 1]) }, '›')),
      h('div', { class: 'grid3' }, ps.map((p) => {
        const r = semDe(w, p);
        if (!r) return null;
        return h('section', { class: 'card' },
          h('div', { class: 'name' }, p, pill(r.veredicto + (r.en_curso ? ' · en curso' : ''), KIND[r.veredicto])),
          gauge(r.contactos, r.meta, `${p}: ${r.contactos} de ${r.meta} contactos`),
          h('div', { style: 'text-align:center' }, h('span', { class: 'num' }, r.contactos), h('span', { class: 'note' }, ` de ${r.meta} contactos`)),
          h('div', { class: 'kv', style: 'margin-top:8px' },
            r.ventas != null ? [h('span', {}, 'Ventas de la semana'), h('b', {}, `${peso(r.ventas)} · ${r.ordenes} órd.`)] : null,
            h('span', {}, 'Cuentas distintas'), h('b', {}, r.cuentas), h('span', {}, 'Presenciales'), h('b', {}, r.presencial),
            h('span', {}, 'Prospección'), h('b', {}, r.prospeccion),
            p === 'Daniel' ? [h('span', {}, 'Catas, capacitaciones, eventos'), h('b', {}, r.catas)] : [h('span', {}, 'Cobranza'), h('b', {}, r.cobranza)]));
      })),
      h('h2', {}, 'Semáforo'), h('div', { class: 'card' }, heat, h('p', { class: 'note', style: 'margin:8px 0 0' }, 'Verde 30+, ámbar 15–29, rojo menos de 15. Toca una semana para abrirla.')),
      h('h2', {}, `Resumen de ${MESL[Number(m.slice(5)) - 1]}`),
      h('div', { class: 'alert' + (ceros.length ? '' : ' ok') }, ceros.length ? [h('b', {}, 'Semanas en cero: '), ceros.map((r) => `${r.persona}, semana del ${dia(r.semana)}`).join(' · ')] : 'Nadie tuvo una semana en cero este mes.'),
      h('div', { class: 'grid3' }, diag.map((r) => {
        const kind = r.semanas === 0 ? 'mute' : r.en_cero > 0 || r.flojas + r.en_cero > r.semanas / 2 ? 'bad' : r.productivas >= r.semanas / 2 ? 'ok' : 'warn';
        return h('section', { class: 'card' },
          h('div', { class: 'name' }, r.persona, pill({ ok: 'Buen mes', warn: 'Mes regular', bad: 'Mes flojo', mute: 'Sin datos' }[kind], kind)),
          h('div', {}, h('span', { class: 'num' }, r.contactos), h('span', { class: 'note' }, ' contactos')),
          h('ul', { class: 'foco', style: 'margin-top:8px' },
            h('li', { class: r.en_cero ? '' : 'bien' }, h('span', {}, `Semanas: ${r.productivas} productivas · ${r.a_medias} a medias · ${r.flojas} flojas · ${r.en_cero} en cero.`)),
            r.ventas != null ? h('li', { class: 'bien' }, h('span', {}, `Vendió ${peso(r.ventas)} en ${r.ordenes} órdenes.`)) : null,
            r.descuidados.length ? h('li', {}, h('span', {}, `Clientes a la baja que nadie tocó (${r.descuidados.length}): ${r.descuidados.join(' · ')}.`)) : null,
            r.promesas.length ? h('li', {}, h('span', {}, `Prometió volver y no lo registró (${r.promesas.length}): ${r.promesas.join(' · ')}.`)) : h('li', { class: 'bien' }, h('span', {}, 'Cumplió los seguimientos que prometió.'))));
      })),
      h('h2', {}, 'A quién contactaron'),
      h('div', { class: 'card' }, lista('cont', cont, 8, (r) => h('li', {}, h('div', { class: 'l1' }, h('span', {}, r.cuenta), h('span', { class: 'note' }, dia(r.fecha))), h('div', { class: 'l2' }, [ps.length > 1 ? r.persona : null, r.actividad, r.medio].filter(Boolean).join(' · ')), r.resultado ? h('div', { class: 'l2' }, r.resultado) : null), 'Sin contactos registrados esta semana.',
        [{ t: 'Fecha', v: (r) => dia(r.fecha), s: (r) => r.fecha, cls: 'nw' }, ps.length > 1 && { t: 'Quién', v: (r) => r.persona, s: (r) => r.persona, cls: 'nw' }, { t: 'Cuenta', v: (r) => r.cuenta, s: (r) => r.cuenta.toLowerCase(), cls: 'b' },
          { t: 'Actividad', v: (r) => r.actividad, s: (r) => r.actividad }, { t: 'Medio', v: (r) => r.medio, s: (r) => r.medio }, { t: 'Resultado', v: (r) => r.resultado, cls: 'mut' }])),
      ps.some((p) => p !== 'Daniel') ? [h('h2', {}, 'Qué vendieron'),
        h('div', { class: 'card' }, lista('ords', ords, 8, (r) => h('li', {}, h('div', { class: 'l1' }, h('span', {}, r.cliente), h('span', {}, peso(r.total))), h('div', { class: 'l2' }, [dia(r.fecha), r.orden, ps.length > 1 ? r.vendedor : null].filter(Boolean).join(' · '))), 'Sin órdenes esta semana.',
          [{ t: 'Fecha', v: (r) => dia(r.fecha), s: (r) => r.fecha, cls: 'nw' }, { t: 'Cliente', v: (r) => r.cliente, s: (r) => r.cliente.toLowerCase(), cls: 'b' }, { t: 'Orden', v: (r) => r.orden, cls: 'mut' },
            ps.length > 1 && { t: 'Vendedor', v: (r) => r.vendedor, s: (r) => r.vendedor }, { t: 'Total', v: (r) => peso(r.total), s: (r) => r.total, num: true }]))] : null);
  },

  seguimiento() {
    const ps = personas();
    const cob = D.cobertura.filter((c) => ps.includes(c.vendedor)).slice().sort((a, b) => (b.dias ?? 1e6) - (a.dias ?? 1e6));
    let seg = D.seguimiento.filter((r) => ps.includes(r.persona) && (S.segFiltro ? r.estado === S.segFiltro : r.estado !== 'cerrada'));
    seg = seg.slice().sort(S.segOrden === 'reciente' ? (a, b) => a.dias_sin_contacto - b.dias_sin_contacto : S.segOrden === 'proximo' ? (a, b) => ((a.proximo || '9999') < (b.proximo || '9999') ? -1 : 1) : (a, b) => b.dias_sin_contacto - a.dias_sin_contacto);
    const n = (e) => D.seguimiento.filter((r) => ps.includes(r.persona) && r.estado === e).length;
    const est = (r) => (r.estado === 'al día' ? pill('Al día', 'ok') : r.estado === 'vencida' ? pill(`Vencida · ${r.dias_vencido} d`, 'bad') : r.estado === 'cerrada' ? pill('Cerrada', 'mute') : pill('Sin fecha', 'warn'));
    const dot = { verde: 'ok', amarillo: 'warn', rojo: 'bad', 'sin registro': 'bad' };
    return h('div', {},
      h('h2', {}, 'Seguimiento por cuenta'),
      h('div', { class: 'toolbar' }, chips([['vencida', `Vencidas ${n('vencida')}`], ['al día', `Al día ${n('al día')}`], ['sin fecha', `Sin fecha ${n('sin fecha')}`], ['', 'Todas']], S.segFiltro, (v) => { S.segFiltro = v; }),
        ancho() ? null : h('select', { 'aria-label': 'Ordenar', onchange: (e) => { S.segOrden = e.target.value; pintar(); } },
        [['viejo', 'Más tiempo sin contacto'], ['reciente', 'Contacto más reciente'], ['proximo', 'Próximo contacto']].map(([v, t]) => h('option', { value: v, selected: S.segOrden === v }, t)))),
      ancho() ? h('p', { class: 'note' }, 'Toca un encabezado para ordenar.') : null,
      h('div', { class: 'card' }, lista('seg', seg, 10, (r) => h('li', {},
        h('div', { class: 'l1' }, h('span', {}, r.cuenta), est(r)),
        h('div', { class: 'l2' }, [ps.length > 1 ? r.persona : null, `Último contacto ${dia(r.ultimo_contacto)} (${r.dias_sin_contacto} días)`, r.proximo ? `próximo ${dia(r.proximo)}` : null].filter(Boolean).join(' · ')),
        r.ultima_nota ? h('div', { class: 'l2' }, r.ultima_nota.slice(0, 160)) : null), 'No hay cuentas en esta lista.',
        [{ t: 'Cuenta', v: (r) => r.cuenta, s: (r) => r.cuenta.toLowerCase(), cls: 'b' }, ps.length > 1 && { t: 'Quién', v: (r) => r.persona, s: (r) => r.persona, cls: 'nw' },
          { t: 'Último contacto', v: (r) => dia(r.ultimo_contacto), s: (r) => r.ultimo_contacto, cls: 'nw' }, { t: 'Días sin contacto', v: (r) => r.dias_sin_contacto, s: (r) => r.dias_sin_contacto, num: true },
          { t: 'Próximo', v: (r) => dia(r.proximo), s: (r) => r.proximo || null, cls: 'nw' }, { t: 'Estado', v: est, s: (r) => (r.estado === 'vencida' ? -r.dias_vencido : 1), cls: 'nw' }, { t: 'Última nota', v: (r) => (r.ultima_nota || '').slice(0, 140), cls: 'mut' }])),
      vendedores().length ? [h('h2', {}, 'Clientes principales'),
        h('p', { class: 'note' }, 'Los 15 más grandes de cada vendedor, primero los que llevan más tiempo sin contacto.'),
        h('div', { class: 'card' }, lista('cob', cob, 10, (c) => h('li', {},
          h('div', { class: 'l1' }, h('span', {}, c.cliente), pill(c.dias == null ? 'Sin registro' : `${c.dias} días`, dot[c.estado])),
          h('div', { class: 'l2' }, [ps.length > 1 ? c.vendedor : null, `${peso(c.actual)} este año`, c.cambio_pct != null ? `${pct(c.cambio_pct)} vs. año pasado` : 'nuevo'].filter(Boolean).join(' · ')),
          c.ultima_nota ? h('div', { class: 'l2' }, (c.contacto_por && c.contacto_por !== c.vendedor ? `(${c.contacto_por}) ` : '') + c.ultima_nota.slice(0, 140)) : null), 'Sin clientes.',
          [{ t: 'Cliente', v: (c) => c.cliente, s: (c) => c.cliente.toLowerCase(), cls: 'b' }, ps.length > 1 && { t: 'Vendedor', v: (c) => c.vendedor, s: (c) => c.vendedor, cls: 'nw' },
            { t: 'Este año', v: (c) => peso(c.actual), s: (c) => c.actual, num: true }, { t: 'vs. año pasado', v: (c) => (c.cambio_pct == null ? 'nuevo' : h('span', { class: c.cambio_pct >= 0 ? 'up' : 'down' }, pct(c.cambio_pct))), s: (c) => c.cambio_pct, num: true },
            { t: 'Sin contacto', v: (c) => pill(c.dias == null ? 'Sin registro' : `${c.dias} días`, dot[c.estado]), s: (c) => (c.dias == null ? 1e6 : c.dias), num: true }, { t: 'Última nota', v: (c) => (c.ultima_nota || '').slice(0, 140), cls: 'mut' }]))] : null);
  },

  ventas() {
    const vs = vendedores();
    if (!vs.length) return h('p', { class: 'note' }, 'Daniel no factura: sus números están en Semanas y Seguimiento.');
    const ym = D.hoy.slice(0, 7), ords = D.ordenes.filter((o) => o.fecha.slice(0, 7) === ym && vs.includes(o.vendedor));
    const E = { invoiced: 'Facturada', not_invoiced: 'Sin facturar', partially_invoiced: 'Factura parcial', paid: 'pagada', unpaid: 'sin pagar', partially_paid: 'pago parcial' };
    return h('div', {},
      h('h2', {}, `Ventas de ${MESL[Number(ym.slice(5)) - 1]}`),
      h('div', { class: 'grid3' }, D.mes.filter((r) => vs.includes(r.vendedor)).map((r) => h('section', { class: 'card' },
        h('div', { class: 'name' }, r.vendedor), h('div', { class: 'num' }, peso(r.total)),
        h('div', { class: 'kv' }, h('span', {}, 'Órdenes'), h('b', {}, r.ordenes), h('span', {}, 'Clientes'), h('b', {}, r.clientes),
          h('span', {}, 'Sin facturar'), h('b', {}, peso(r.sin_facturar)), h('span', {}, 'Facturado sin pagar'), h('b', {}, peso(r.por_cobrar)))))),
      h('h2', {}, 'Órdenes del mes'),
      h('div', { class: 'card' }, lista('mes', ords, 12, (o) => h('li', {}, h('div', { class: 'l1' }, h('span', {}, o.cliente), h('span', {}, peso(o.total))),
        h('div', { class: 'l2' }, [dia(o.fecha), o.orden, vs.length > 1 ? o.vendedor : null, E[o.facturacion] || o.facturacion, E[o.pago] || o.pago].filter(Boolean).join(' · '))), 'Todavía no hay órdenes este mes.',
        [{ t: 'Fecha', v: (o) => dia(o.fecha), s: (o) => o.fecha, cls: 'nw' }, { t: 'Cliente', v: (o) => o.cliente, s: (o) => o.cliente.toLowerCase(), cls: 'b' }, { t: 'Orden', v: (o) => o.orden, cls: 'mut' },
          vs.length > 1 && { t: 'Vendedor', v: (o) => o.vendedor, s: (o) => o.vendedor }, { t: 'Facturación', v: (o) => E[o.facturacion] || o.facturacion, s: (o) => o.facturacion }, { t: 'Pago', v: (o) => E[o.pago] || o.pago, s: (o) => o.pago },
          { t: 'Total', v: (o) => peso(o.total), s: (o) => o.total, num: true }])),
      h('p', { class: 'note' }, 'Órdenes de venta de Zoho, con IVA, sin muestras.'));
  },

  clientes() {
    const vs = vendedores();
    if (!vs.length) return h('p', { class: 'note' }, 'Sin clientes facturados.');
    const Y = Number(D.hoy.slice(0, 4));
    return h('div', {}, vs.map((v) => {
      const L = D.clientes.filter((c) => c.vendedor === v), t = (k) => L.reduce((s, c) => s + c[k], 0), ch = t('pasado_mp') ? Math.round((t('actual') - t('pasado_mp')) / t('pasado_mp') * 1000) / 10 : null;
      return [h('h2', {}, v),
        h('p', { class: 'note' }, `${peso(t('actual'))} este año contra ${peso(t('pasado_mp'))} a la misma fecha del año pasado (`, h('span', { class: ch >= 0 ? 'up' : 'down' }, pct(ch)), ').'),
        h('div', { class: 'card' }, lista('yoy' + v, L, 15, (c) => {
          const mx = Math.max(c.antepasado, c.pasado, c.actual, 1);
          return h('li', {}, h('div', { class: 'l1' }, h('span', {}, c.cliente),
            h('span', { class: 'bar3', role: 'img', 'aria-label': `Hace dos años ${peso(c.antepasado)}, año pasado ${peso(c.pasado)}, este año ${peso(c.actual)}` }, [c.antepasado, c.pasado, c.actual].map((x) => h('i', { style: `height:${Math.round(x / mx * 100)}%` })))),
            h('div', { class: 'l2' }, `${peso(c.actual)} este año · `, c.cambio_pct == null ? (c.actual > 0 ? 'nuevo' : '—') : h('span', { class: c.cambio_pct >= 0 ? 'up' : 'down' }, pct(c.cambio_pct)), ` · última factura ${dia(c.ultima_factura)}${c.ultima_factura && c.ultima_factura.slice(0, 4) !== D.hoy.slice(0, 4) ? ' ' + c.ultima_factura.slice(0, 4) : ''}`));
        }, 'Sin clientes facturados.',
        [{ t: 'Cliente', v: (c) => c.cliente, s: (c) => c.cliente.toLowerCase(), cls: 'b' }, { t: Y - 2, v: (c) => peso(c.antepasado), s: (c) => c.antepasado, num: true }, { t: Y - 1, v: (c) => peso(c.pasado), s: (c) => c.pasado, num: true },
          { t: `${Y - 1} a la fecha`, v: (c) => peso(c.pasado_mp), s: (c) => c.pasado_mp, num: true }, { t: Y, v: (c) => peso(c.actual), s: (c) => c.actual, num: true },
          { t: 'Cambio', v: (c) => (c.cambio_pct == null ? (c.actual > 0 ? 'nuevo' : '—') : h('span', { class: c.cambio_pct >= 0 ? 'up' : 'down' }, pct(c.cambio_pct))), s: (c) => c.cambio_pct, num: true },
          { t: 'Tendencia', v: (c) => { const mx = Math.max(c.antepasado, c.pasado, c.actual, 1); return h('span', { class: 'bar3', 'aria-hidden': 'true' }, [c.antepasado, c.pasado, c.actual].map((x) => h('i', { style: `height:${Math.round(x / mx * 100)}%` }))); } },
          { t: 'Última factura', v: (c) => dia(c.ultima_factura) + (c.ultima_factura && c.ultima_factura.slice(0, 4) != Y ? ' ' + c.ultima_factura.slice(0, 4) : ''), s: (c) => c.ultima_factura, cls: 'nw' }]))];
    }));
  },

  zonas() {
    const COL = { Fuerte: 'var(--ok)', 'Presencia débil': 'var(--warn)', 'Sin presencia': 'var(--bad)' }, K = { Fuerte: 'ok', 'Presencia débil': 'warn', 'Sin presencia': 'bad' };
    const byZ = new Map(D.zonas.map((z) => [z.zona, z])), cur = byZ.get(S.zona);
    const map = h('div', { class: 'card' });
    estados().then((E) => {
      // Plain Mercator; good enough at Mexico's size.
      const P = ([lon, lat]) => [lon * 20, -Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) * 180 / Math.PI * 20];
      const ring = (r) => 'M' + r.map((p) => P(p).map((x) => x.toFixed(1)).join(' ')).join('L') + 'Z';
      const d = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates).map((poly) => poly.map(ring).join('')).join('');
      const box = (rows) => { let a = [1e9, 1e9, -1e9, -1e9]; for (const s of rows) for (const poly of (s.g.type === 'Polygon' ? [s.g.coordinates] : s.g.coordinates)) for (const p of poly[0]) { const [x, y] = P(p); a = [Math.min(a[0], x), Math.min(a[1], y), Math.max(a[2], x), Math.max(a[3], y)]; } return a; };
      const b = box(S.zona ? E.filter((s) => s.zona === S.zona) : E), pad = S.zona ? 30 : 6;
      const el = svg('svg', { class: 'map', viewBox: `${b[0] - pad} ${b[1] - pad} ${b[2] - b[0] + 2 * pad} ${b[3] - b[1] + 2 * pad}`, role: 'img', 'aria-label': 'Mapa de México por zona: verde fuerte, ámbar presencia débil, rojo sin presencia' },
        E.map((s) => svg('path', { d: d(s.g), fill: COL[(byZ.get(s.zona) || {}).estado] || 'var(--muted)', 'fill-opacity': !S.zona || s.zona === S.zona ? 0.6 : 0.2 }, svg('title', {}, `${s.nombre} · ${(byZ.get(s.zona) || {}).nombre}`))));
      el.addEventListener('click', (ev) => { const i = [...el.children].indexOf(ev.target); if (i >= 0) { S.zona = S.zona === E[i].zona ? '' : E[i].zona; pintar(); } });
      map.replaceChildren(el, h('p', { class: 'note', style: 'margin:8px 0 0' }, S.zona ? h('button', { class: 'chip', onclick: () => { S.zona = ''; pintar(); } }, '← Ver todo México') : 'Toca una zona para acercarte y ver sus prospectos.'));
    }).catch(() => map.replaceChildren(h('p', { class: 'note' }, 'No se pudo cargar el mapa.')));
    const ord = new Map(D.zonas.map((z, i) => [z.zona, i])), kO = { dist: 0, tienda: 1, horeca: 2, cliente: 3 };
    const pros = D.prospectos.filter((p) => (!S.zona || p.zona === S.zona) && (!S.clase || p.clase === S.clase || (S.clase === 'dist' && /distribu/i.test(p.tipo)) || (S.clase === 'tienda' && /retail|tienda/i.test(p.tipo))))
      .sort((a, b) => (ord.get(a.zona) - ord.get(b.zona)) || (kO[a.clase] - kO[b.clase]));
    return h('div', {},
      h('h2', {}, cur ? cur.nombre : '¿Dónde tenemos presencia?'),
      h('div', { class: 'cols2' }, h('div', {}, map), h('div', {},
      cur ? h('div', { class: 'card' }, h('div', { class: 'name' }, cur.nombre, pill(cur.estado, K[cur.estado])), h('p', {}, `${cur.peso}% del mercado y ${cur.pct_ventas}% de nuestras ventas: ${peso(cur.ventas)} este año con ${cur.clientes_activos} clientes activos. ` + (cur.brecha ? `Al ritmo de Caribe vendería ${peso(cur.potencial)}; la brecha es ${peso(cur.brecha)}.` : 'Va al ritmo de nuestras mejores zonas.')), h('p', { class: 'note' }, cur.distribuidores || 'Sin distribuidor')) : null,
      !cur ? [h('h3', {}, 'Ranking de oportunidad'),
        h('div', { class: 'card' }, h('ul', { class: 'rows' }, D.zonas.map((z, i) => h('li', { onclick: () => { S.zona = z.zona; pintar(); window.scrollTo(0, 0); }, style: 'cursor:pointer' },
          h('div', { class: 'l1' }, h('span', {}, `${z.brecha ? i + 1 + '. ' : ''}${z.nombre}`), pill(z.estado, K[z.estado])),
          h('div', { class: 'l2' }, `${z.peso}% del mercado · ${peso(z.ventas)} vendidos · ` + (z.brecha ? `brecha ${peso(z.brecha)}` : 'sin brecha')),
          h('div', { class: 'l2' }, z.distribuidores || 'Sin distribuidor')))))] : null)),
      h('h2', {}, 'Prospectos'),
      chips([['', 'Todos'], ['dist', 'Distribuidores'], ['tienda', 'Tiendas'], ['horeca', 'Restaurantes y hoteles'], ['cliente', 'Clientes actuales']], S.clase, (v) => { S.clase = v; }),
      h('div', { class: 'card', style: 'margin-top:8px' }, lista('pros', pros, 10, (p) => h('li', {},
        h('div', { class: 'l1' }, h('span', {}, p.nombre), pill(p.estado, p.estado === 'Prospecto nuevo' ? 'mute' : p.estado === 'Reactivar' ? 'bad' : 'warn')),
        h('div', { class: 'l2' }, [S.zona ? null : (byZ.get(p.zona) || {}).nombre, p.tipo, p.ciudades].filter(Boolean).join(' · ')),
        h('div', { class: 'l2' }, p.razon),
        h('div', { class: 'l2' }, p.ultimo_contacto ? `Último contacto ${dia(p.ultimo_contacto)} · ${p.contacto_por}` : 'Nunca contactado', p.fuente ? [' · ', h('a', { href: p.fuente, target: '_blank', rel: 'noopener' }, 'fuente')] : null)), 'Sin prospectos con este filtro.',
        [{ t: 'Prospecto', v: (p) => (p.fuente ? h('a', { href: p.fuente, target: '_blank', rel: 'noopener' }, p.nombre) : p.nombre), s: (p) => p.nombre.toLowerCase(), cls: 'b' }, !S.zona && { t: 'Zona', v: (p) => (byZ.get(p.zona) || {}).nombre, s: (p) => p.zona },
          { t: 'Tipo', v: (p) => p.tipo, s: (p) => p.tipo }, { t: 'Ciudades', v: (p) => p.ciudades, cls: 'mut' }, { t: 'Por qué', v: (p) => p.razon, cls: 'mut' },
          { t: 'Estado', v: (p) => pill(p.estado, p.estado === 'Prospecto nuevo' ? 'mute' : p.estado === 'Reactivar' ? 'bad' : 'warn'), s: (p) => p.estado, cls: 'nw' },
          { t: 'Último contacto', v: (p) => (p.ultimo_contacto ? `${dia(p.ultimo_contacto)} · ${p.contacto_por}` : 'Nunca'), s: (p) => p.ultimo_contacto || null, cls: 'nw' }])),
      h('p', { class: 'note' }, 'El peso de cada zona es una estimación: 65% economía (PIB estatal, INEGI) y 35% turismo (cuartos de hotel, DataTur). Ventas facturadas en Zoho a clientes de Carlos y José Luis.'));
  },

  efectividad() {
    return h('div', { class: 'grid3' }, D.efectividad.filter((e) => veo(e.persona)).map((e) => h('section', { class: 'card' },
      h('div', { class: 'name' }, e.persona, pill(`${e.calificacion} de 100`, e.calificacion >= 70 ? 'ok' : e.calificacion >= 35 ? 'warn' : 'bad')),
      gauge(e.calificacion, 70, `${e.persona}: efectividad ${e.calificacion} de 100`),
      h('div', { class: 'kv' }, e.partes.map((x) => [h('span', {}, x.nombre), h('b', {}, `${x.valor} · ${x.pts}/${x.de}`)])),
      e.total != null ? [h('h3', {}, 'Sin cuentas heredadas'),
        h('p', { class: 'note' }, `${e.heredadas_pct}% de su venta (${peso(e.heredadas)}) viene de cuentas heredadas. El resto: ${peso(e.sin_heredadas)} contra ${peso(e.sin_heredadas_pasado)} el año pasado (${pct(e.crecimiento_pct)}).`),
        h('h3', {}, `Clientes nuevos (${e.nuevos.length}) y perdidos (${e.perdidos.length})`),
        lista('nv' + e.persona, [...e.nuevos.map((c) => ({ ...c, t: 'Nuevo' })), ...e.perdidos.map((c) => ({ ...c, t: 'Perdido' }))], 6, (c) => h('li', {}, h('div', { class: 'l1' }, h('span', {}, c.cliente), pill(c.t, c.t === 'Nuevo' ? 'ok' : 'bad')), h('div', { class: 'l2' }, peso(c.monto) + (c.t === 'Nuevo' ? ' este año' : ' el año pasado'))), 'Sin cambios.'),
        h('h3', {}, 'Prospección'),
        lista('pr' + e.persona, e.prospeccion, 6, (p) => h('li', {}, h('div', { class: 'l1' }, h('span', {}, p.cuenta), pill(p.compro ? 'Compró' : 'Sin compra', p.compro ? 'ok' : 'mute')), h('div', { class: 'l2' }, `Primera prospección ${dia(p.primera)}` + (p.vendido ? ` · ${peso(p.vendido)} después` : ''))), 'Sin prospección registrada.')] : null)));
  },

  ajustes() {
    const box = h('div', {}, h('p', { class: 'note' }, 'Cargando…'));
    api('api/admin/people').then((r) => {
      const f = h('form', { class: 'inline', onsubmit: async (ev) => { ev.preventDefault(); const fd = new FormData(f); const res = await api('api/admin/people', { email: fd.get('email'), persona: fd.get('persona'), rol: fd.get('persona') === 'admin' ? 'admin' : 'rep' }); if (res.error) alert(res.error); else pintar(); } },
        h('input', { name: 'email', type: 'email', placeholder: 'correo con el que entra al Hub', required: true, 'aria-label': 'Correo' }),
        h('select', { name: 'persona', 'aria-label': 'Quién es' }, [...r.gente.map((g) => h('option', { value: g }, g)), h('option', { value: 'admin' }, 'Administrador (ve a todos)')]),
        h('button', { class: 'btn' }, 'Guardar'));
      const st = (k, t) => { const s = D.sync[k]; return h('li', {}, h('div', { class: 'l1' }, h('span', {}, t), pill(!s ? 'Nunca' : s.ok ? 'Bien' : 'Falló', !s ? 'mute' : s.ok ? 'ok' : 'bad')), h('div', { class: 'l2' }, !s ? 'Todavía no corre.' : new Date(s.at).toLocaleString('es-MX') + (s.error ? ' · ' + s.error : s.skipped ? ' · ' + s.skipped : s.rows != null ? ` · ${s.rows} renglones` : ` · ${s.orders} órdenes, ${s.invoices} facturas` + (s.pending ? ' (todavía cargando el histórico)' : '') + (s.aviso ? ' · ' + s.aviso : '')))); };
      box.replaceChildren(
        h('h2', {}, 'Datos'), h('div', { class: 'card' }, h('ul', { class: 'rows' }, st('hoja', 'Hoja del CRM (diario, 6:00)'), st('zoho', 'Zoho (6:00, 12:00 y 18:00)')),
          r.correo_hoja && !(D.sync.hoja && D.sync.hoja.ok) ? h('p', { class: 'note' }, 'La hoja del CRM debe estar compartida (lector) con ', h('b', {}, r.correo_hoja), '.') : null,
          h('button', { class: 'btn', style: 'margin-top:8px;width:100%', onclick: async (ev) => { ev.target.disabled = true; ev.target.textContent = 'Sincronizando…'; await api('api/admin/sync', {}); await cargar(); } }, 'Sincronizar ahora')),
        h('h2', {}, 'Quién ve qué'), h('p', { class: 'note' }, 'Cada vendedor ve solo sus números. Liga aquí el correo con el que entra al Hub.'),
        h('div', { class: 'card' }, r.people.length ? h('ul', { class: 'rows' }, r.people.map((p) => h('li', {}, h('div', { class: 'l1' }, h('span', {}, p.email), h('button', { class: 'chip', onclick: async () => { await api('api/admin/people', { email: p.email, borrar: true }); pintar(); } }, 'Quitar')), h('div', { class: 'l2' }, p.rol === 'admin' ? 'Administrador' : p.persona)))) : h('p', { class: 'note' }, 'Nadie dado de alta todavía.'), f));
    });
    return box;
  }
};

let _estados = null;
const estados = () => (_estados ||= fetch('estados.json').then((r) => r.json()).then((rows) => rows.map((s) => ({ ...s, g: JSON.parse(s.geom) }))));
async function api(path, body) {
  const r = await fetch(path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
  return r.json().catch(() => ({ error: 'Respuesta inválida' }));
}

function pintar() {
  const admin = D.yo.admin;
  $('who').replaceChildren(...(admin && !['zonas', 'ajustes'].includes(S.vista) ? [['', 'Todos'], ['José Luis', 'José Luis'], ['Carlos', 'Carlos'], ['Daniel', 'Daniel']].map(([v, t]) =>
    h('button', { class: 'chip', 'aria-pressed': String(S.persona === v), onclick: () => { S.persona = v; pintar(); } }, t)) : [h('span', { class: 'note' }, admin ? '' : D.yo.persona)]));
  const enMas = MAS.some(([v]) => v === S.vista);
  const wide = ancho();
  document.body.classList.toggle('wide', wide);
  const tabs = wide ? [...TABS.filter(([v]) => v !== 'mas'), ...MAS.filter(([, , soloAdmin]) => !soloAdmin || admin).map(([v, t]) => [v, t.replace(' año contra año', '').replace(' y prospectos', '')])] : TABS;
  $('tabs').replaceChildren(...tabs.map(([v, t]) => h('button', { 'aria-current': (v === S.vista || (v === 'mas' && enMas)) ? 'page' : null,
    onclick: () => { if (v !== 'mas') return ir(v); $('sheet').hidden = false; } }, t)));
  $('sheet').replaceChildren(h('div', {}, MAS.filter(([, , soloAdmin]) => !soloAdmin || admin).map(([v, t]) => h('button', { onclick: () => ir(v) }, t)), h('button', { onclick: () => { $('sheet').hidden = true; } }, 'Cerrar')));
  $('main').replaceChildren((VISTAS[S.vista] || VISTAS.hoy)());
}
$('sheet').addEventListener('click', (ev) => { if (ev.target === $('sheet')) $('sheet').hidden = true; });

async function cargar() {
  const r = await fetch('api/data'), j = await r.json().catch(() => ({ error: 'No se pudo leer la respuesta' }));
  if (!r.ok) { $('main').replaceChildren(h('div', { class: 'alert' }, j.error || 'No se pudo cargar.')); return; }
  D = j; deHash(); pintar();
}
cargar().catch(() => $('main').replaceChildren(h('div', { class: 'alert' }, 'Sin conexión. Vuelve a intentar.')));
