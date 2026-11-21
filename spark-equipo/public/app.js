import { MAS_VISTAS } from './mas.js';

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
// A client move of this many pesos against the same date last year counts as a critical loss or a strong gain.
const UMBRAL = 30000;
const KIND = { Productiva: 'ok', Productivo: 'ok', 'A medias': 'warn', Floja: 'bad', Flojo: 'bad', 'En cero': 'bad', Pendiente: 'bad', 'Sin datos': 'mute' };
const vtxt = (r) => (r.veredicto === 'Pendiente' ? 'Pendiente de registrar' : r.veredicto) + (r.en_curso ? ' · en curso' : '');
const pill = (text, kind) => h('span', { class: 'pill ' + kind }, text);

let D = null;
const S = { vista: 'hoy', persona: '', semana: null, periodo: 'semana', mes: null, segFiltro: 'vencida', segOrden: 'viejo', zona: '', clase: '', abierto: {}, orden: {} };

// Every screen, grouped the way the sidebar shows them. [slug, sidebar label, page title, admin only, coming soon]
const GRUPOS = [
  ['Mi trabajo', [['hoy', 'Inicio', 'Inicio'], ['buzon', 'Buzón', 'Buzón'], ['seguimiento', 'Seguimiento', 'Seguimiento de cuentas'], ['semanas', 'Semanas y meses', 'Semanas y meses'], ['kpis', 'KPIs', 'KPIs: cómo vas contra tu tablero']]],
  ['Ventas', [['ventas', 'Ventas del mes', 'Ventas del mes'], ['cobranza', 'Cobranza', 'Cobranza'], ['clientes', 'Clientes', 'Clientes: cómo va cada uno']]],
  ['Cuentas', [['directorio', 'Directorio', 'Directorio de clientes'], ['copeo', 'Copeo y embudo', 'Copeo y embudo'], ['encuestas', 'Encuestas', 'Encuestas a clientes'], ['distribuidores', 'Distribuidores', 'Prospección de distribuidores'], ['zonas', 'Zonas y prospectos', 'Zonas y prospectos']]],
  ['Recursos', [['estrategia', 'Estrategia y promociones', 'Estrategia, metas y promociones'], ['materiales', 'Materiales de venta', 'Materiales de venta'], ['premios', 'Premios', 'Premios y puntajes'], ['comunicaciones', 'Comunicaciones', 'Comunicaciones con clientes', false, true]]],
  ['Dirección', [['efectividad', 'Efectividad', 'Efectividad', true], ['ajustes', 'Ajustes', 'Ajustes', true]]],
];
const PANT = new Map(GRUPOS.flatMap(([, L]) => L.map((x) => [x[0], x])));
const ABAJO = ['hoy', 'buzon', 'seguimiento', 'semanas', 'clientes'];           // first on the phone ribbon; the rest follow in menu order
const SIN_FILTRO = ['zonas', 'ajustes', 'materiales', 'premios', 'comunicaciones', 'directorio', 'estrategia', 'distribuidores'];   // screens the person filter does not apply to

function ir(vista, persona) {
  if (persona !== undefined) S.persona = persona;
  S.vista = vista; $('sheet').hidden = true;
  if (location.hash.slice(1) !== vista) history.pushState(null, '', '#' + vista); // so the phone's back button walks the screens
  pintar(); window.scrollTo(0, 0);
}
const deHash = () => { const v = location.hash.slice(1) === 'pendientes' ? 'buzon' : location.hash.slice(1), x = PANT.get(v); S.vista = VISTAS[v] && x && (D.yo.admin || !x[3]) ? v : 'hoy'; };
addEventListener('popstate', () => { if (D) { deHash(); $('sheet').hidden = true; pintar(); } });
// Whether the signed-in person may write on behalf of p.
const puede = (p) => D.yo.admin || D.yo.persona === p;
const personas = () => (S.persona ? [S.persona] : ['José Luis', 'Carlos', 'Daniel']);
const vendedores = () => personas().filter((p) => p !== 'Daniel');
const veo = (p) => personas().includes(p);

// Semicircle gauge: red under half the goal, amber up to it, green from there.
function gauge(n, meta, label) {
  const max = Math.max(meta * 1.5, 1);
  // Phone: a flat meter. The same three bands laid out left to right, with a marker that slides to where the person is.
  if (!ancho()) {
    const W = 300, x = (v) => 4 + (W - 8) * Math.min(v, max) / max, seg = (a, b, c) => svg('rect', { x: x(a), y: 14, width: x(b) - x(a) - 2, height: 12, rx: 3, fill: c });
    return svg('svg', { class: 'meter', viewBox: `0 0 ${W} 44`, role: 'img', 'aria-label': label },
      seg(0, meta / 2, 'var(--bad)'), seg(meta / 2, meta, 'var(--warn)'), seg(meta, max, 'var(--ok)'),
      svg('path', { d: `M${x(n) - 7} 2h14l-7 10z`, fill: 'var(--text)' }), svg('rect', { x: x(n) - 1.5, y: 10, width: 3, height: 20, rx: 1.5, fill: 'var(--text)' }),
      [[0, 'start'], [meta / 2, 'middle'], [meta, 'middle']].map(([v, an]) => svg('text', { x: v ? x(v) : 4, y: 42, 'text-anchor': an, 'font-size': 10, fill: 'var(--muted)' }, Math.round(v))));
  }
  const W = 200, r = 88, cx = 100, cy = 100;
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
// Makes a whole row open something. Buttons and links inside the row keep doing their own thing.
const toca = (fn) => ({ class: 'toca', tabindex: 0, role: 'button', onclick: (ev) => { if (!ev.target.closest('button, a, input, select, textarea')) fn(); },
  onkeydown: (ev) => { if ((ev.key === 'Enter' || ev.key === ' ') && ev.target === ev.currentTarget) { ev.preventDefault(); fn(); } } });
const pausado = (r) => (r.pausa ? pill('Envíos pausados por cobranza', 'warn') : null);
// A list capped at n with a "show all" button. On a phone each item is a stacked row (fila); on desktop, when cols is given,
// it is a table whose headers sort. cols: [{ t: header, v: row => cell, s: row => sort value, num: right-aligned }].
function lista(key, items, n, fila, vacio, cols, tocar) {
  if (!items.length) return h('p', { class: 'note' }, vacio);
  if (!ancho()) n = Math.min(n, 8);   // on a phone a long list is a long scroll: show the first few, the rest behind the button
  const open = S.abierto[key], mas = items.length > n ? h('button', { class: 'more', onclick: () => { S.abierto[key] = !open; pintar(); } }, open ? 'Ver menos' : `Ver los ${items.length}`) : null;
  if (!cols || !ancho()) return h('div', {}, h('ul', { class: 'rows' }, (open ? items : items.slice(0, n)).map(fila)), mas);
  cols = cols.filter(Boolean);
  const o = S.orden[key];
  if (o && cols[o[0]] && cols[o[0]].s) { const f = cols[o[0]].s; items = items.slice().sort((a, b) => { const x = f(a), y = f(b); return (x == null ? 1 : y == null ? -1 : x < y ? -1 : x > y ? 1 : 0) * o[1]; }); }
  const th = (c, i) => h('th', { class: c.num ? 'r' : null, 'aria-sort': o && o[0] === i ? (o[1] > 0 ? 'ascending' : 'descending') : null },
    c.s ? h('button', { onclick: () => { S.orden[key] = [i, o && o[0] === i ? -o[1] : (c.num ? -1 : 1)]; pintar(); } }, c.t, o && o[0] === i ? (o[1] > 0 ? ' ▲' : ' ▼') : '') : c.t);
  // Columns that hold free text (notes, suggestions, comments) do not fit a table cell: the row would be a tall, narrow
  // paragraph. Those lists become records instead: the short facts on one line, the text underneath at full width, striped.
  const largas = cols.filter((c) => c.largo || /\b(wide|sugc)\b/.test(c.cls || '')), cortas = cols.filter((c) => !largas.includes(c));
  if (largas.length) {
    const gt = 'grid-template-columns:' + cortas.map((c, i) => (i === 0 ? 'minmax(0, 2.2fr)' : !c.t ? '120px' : 'minmax(0, 1fr)')).join(' ');
    const vacia = (x) => x == null || x === '' || x === '—';
    return h('div', {}, h('div', { class: 'recs' },
      h('div', { class: 'rech', style: gt }, cortas.map((c) => { const i = cols.indexOf(c); return h('span', { 'aria-sort': o && o[0] === i ? (o[1] > 0 ? 'ascending' : 'descending') : null },
        c.s ? h('button', { onclick: () => { S.orden[key] = [i, o && o[0] === i ? -o[1] : (c.num ? -1 : 1)]; pintar(); } }, c.t, o && o[0] === i ? (o[1] > 0 ? ' ▲' : ' ▼') : '') : c.t); })),
      (open ? items : items.slice(0, n)).map((r) => { const L = largas.map((c) => [c.t, c.v(r)]).filter(([, x]) => !vacia(x));
        return h('article', { ...(tocar ? toca(() => tocar(r)) : {}), class: 'rec' + (tocar ? ' toca' : '') }, h('div', { class: 'recf', style: gt }, cortas.map((c, i) => h('div', { class: (i === 0 ? 'b ' : '') + (c.cls || '') }, c.v(r)))),
          L.length ? h('div', { class: 'recl', style: `grid-template-columns:repeat(${L.length}, minmax(0, 1fr))` }, L.map(([t, x]) => h('div', {}, h('b', {}, t), h('p', {}, x)))) : null); })), mas);
  }
  return h('div', {}, h('div', { class: 'tblwrap' }, h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, cols.map(th))),
    h('tbody', {}, (open ? items : items.slice(0, n)).map((r) => h('tr', tocar ? toca(() => tocar(r)) : {}, cols.map((c) => h('td', { class: (c.num ? 'r ' : '') + (c.cls || '') }, c.v(r)))))))), mas);
}
// Weekly trend for one person: contacts as a line over the green/amber/red bands (30 and 15), that week's sales as bars behind.
// Weeks still waiting to be logged are left out of the line.
function tendencia(p, ws) {
  const W = 340, H = 170, pl = 26, pr = 6, pt = 8, pb = 22, n = ws.length, iw = (W - pl - pr) / Math.max(n, 1);
  const maxC = Math.max(45, ...ws.map((w) => w.contactos)), maxV = Math.max(1, ...ws.map((w) => w.ventas || 0));
  const x = (i) => pl + (i + 0.5) * iw, y = (c) => pt + (H - pt - pb) * (1 - c / maxC), band = (a, b, col) => svg('rect', { x: pl, y: y(b), width: W - pl - pr, height: y(a) - y(b), fill: col, 'fill-opacity': 0.13 });
  const log = ws.map((w, i) => ({ w, i })).filter((d) => d.w.veredicto !== 'Pendiente');
  const prom = (a) => (a.length ? a.reduce((t, d) => t + d.w.contactos, 0) / a.length : null);
  const hechas = log.filter((d) => !d.w.en_curso), ult = prom(hechas.slice(-4)), ant = prom(hechas.slice(-8, -4));
  const dir = ult == null || ant == null ? '' : ult > ant * 1.15 ? 'subiendo' : ult < ant * 0.85 ? 'bajando' : 'estable';
  const txt = dir ? `Contactos ${dir}: ${Math.round(ant)} → ${Math.round(ult)} por semana (últimas 4 contra las 4 anteriores).` : 'Todavía no hay 8 semanas registradas para ver la tendencia.';
  return h('section', { class: 'card' },
    h('div', { class: 'name' }, p, dir ? pill(dir === 'subiendo' ? 'Subiendo' : dir === 'bajando' ? 'Bajando' : 'Estable', dir === 'subiendo' ? 'ok' : dir === 'bajando' ? 'bad' : 'mute') : null),
    svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `${p}. ${txt}`, style: 'width:100%;height:auto;display:block;margin-top:6px' },
      band(30, maxC, 'var(--ok)'), band(15, 30, 'var(--warn)'), band(0, 15, 'var(--bad)'),
      [15, 30].map((t) => svg('text', { x: pl - 4, y: y(t) + 3, 'text-anchor': 'end', 'font-size': 9, fill: 'var(--muted)' }, t)),
      ws.map((w, i) => (w.ventas ? svg('rect', { x: x(i) - iw * 0.3, y: H - pb - (H - pt - pb) * 0.55 * (w.ventas / maxV), width: iw * 0.6, height: (H - pt - pb) * 0.55 * (w.ventas / maxV), fill: 'var(--text)', 'fill-opacity': 0.22 }, svg('title', {}, `Semana del ${dia(w.semana)}: ${peso(w.ventas)}`)) : null)),
      svg('polyline', { points: log.map((d) => `${x(d.i).toFixed(1)},${y(d.w.contactos).toFixed(1)}`).join(' '), fill: 'none', stroke: 'var(--accent)', 'stroke-width': 2.2, 'stroke-linejoin': 'round' }),
      log.map((d) => svg('circle', { cx: x(d.i), cy: y(d.w.contactos), r: 3, fill: 'var(--accent)' }, svg('title', {}, `Semana del ${dia(d.w.semana)}: ${d.w.contactos} contactos`))),
      ws.map((w, i) => (i === 0 || w.semana.slice(5, 7) !== ws[i - 1].semana.slice(5, 7) ? svg('text', { x: x(i), y: H - 6, 'text-anchor': 'middle', 'font-size': 9, fill: 'var(--muted)' }, MES[Number(w.semana.slice(5, 7)) - 1]) : null))),
    h('p', { class: 'note', style: 'margin:6px 0 0' }, txt));
}
// Open questions: asked by Eric, answered here by the person they are for. Everyone sees them; admins can add and remove.
function preguntas() {
  const ps = personas(), admin = D.yo.admin, L = (D.preguntas || []).filter((q) => ps.includes(q.para)), abiertas = L.filter((q) => !q.respondida), hechas = L.filter((q) => q.respondida);
  if (!L.length && !admin) return null;
  const enviar = async (url, body) => { const r = await api(url, body); if (r.error) alert(r.error); await cargar(); };
  const una = (q) => {
    const mia = admin || q.para === D.yo.persona, ta = h('textarea', { rows: 3, placeholder: 'Escribe tu respuesta', 'aria-label': 'Respuesta para: ' + q.texto.slice(0, 60) });
    return h('li', { class: q.respondida ? 'bien' : '' },
      h('div', { class: 'l1' }, h('span', {}, q.texto), pill(q.para, q.respondida ? 'ok' : 'warn')),
      h('div', { class: 'l2' }, `Preguntó ${q.creada_por || 'Eric'} el ${dia(q.creada)}` + (q.respondida ? ` · respondida el ${dia(q.respondida)}` : '')),
      q.respondida ? h('div', { class: 'sug' }, q.respuesta) : mia ? h('div', { class: 'resp' }, ta, h('button', { class: 'btn', onclick: () => enviar('api/preguntas/responder', { id: q.id, respuesta: ta.value }) }, 'Responder')) : null,
      admin ? h('div', { class: 'l2' }, q.respondida ? h('button', { class: 'linkb', onclick: () => enviar('api/admin/preguntas', { reabrir: q.id }) }, 'Reabrir') : null, ' ', h('button', { class: 'linkb', onclick: () => { if (confirm('¿Quitar esta pregunta?')) enviar('api/admin/preguntas', { borrar: q.id }); } }, 'Quitar')) : null);
  };
  const f = admin ? h('form', { class: 'inline', onsubmit: (ev) => { ev.preventDefault(); const fd = new FormData(f); enviar('api/admin/preguntas', { para: fd.get('para'), texto: fd.get('texto') }); } },
    h('input', { name: 'texto', placeholder: 'Nueva pregunta para el equipo', required: true, 'aria-label': 'Nueva pregunta' }),
    h('select', { name: 'para', 'aria-label': 'Para quién' }, ['José Luis', 'Carlos', 'Daniel'].map((g) => h('option', { value: g, selected: S.persona === g }, g))), h('button', { class: 'btn' }, 'Preguntar')) : null;
  return h('section', { class: 'card preg' }, h('div', { class: 'name' }, 'Preguntas abiertas', pill(abiertas.length ? `${abiertas.length} sin responder` : 'Al día', abiertas.length ? 'warn' : 'ok')),
    abiertas.length ? h('ul', { class: 'rows' }, abiertas.map(una)) : h('p', { class: 'note' }, 'No hay preguntas pendientes.'),
    hechas.length ? h('details', {}, h('summary', {}, `Respondidas (${hechas.length})`), h('ul', { class: 'rows' }, hechas.map(una))) : null, f);
}
// What a count means day to day: contacts per working day against the goal of 6, and roughly how many hours of work it is.
// The hours are an estimate (a visit ≈ 1 h with the trip, a call ≈ 10 min, a message ≈ 5 min).
function ritmo(r, detalle) {
  if (!r.contactos || !r.habiles || !r.meta) return null;
  const k = r.por_dia >= 6 ? 'ok' : r.por_dia >= 3 ? 'warn' : 'bad', pd = r.por_dia === 1 ? '1 contacto' : `${r.por_dia} contactos`;
  const partes = [r.presencial && `${r.presencial} ${r.presencial === 1 ? 'visita' : 'visitas'} × 1 h`, r.llamadas && `${r.llamadas} ${r.llamadas === 1 ? 'llamada' : 'llamadas'} × 10 min`, r.mensajes && `${r.mensajes} ${r.mensajes === 1 ? 'mensaje' : 'mensajes'} × 5 min`].filter(Boolean).join(' · ');
  return h('div', { class: 'ritmo ' + k },
    h('div', {}, h('b', {}, `${pd} al día`), ` en ${r.habiles} ${r.habiles === 1 ? 'día hábil' : 'días hábiles'}. La meta es 6.`),
    h('div', {}, 'Trabajo registrado: ', h('b', {}, `≈ ${r.horas} h de ${r.horas_habiles} h`), '.'),
    detalle && partes ? h('div', { class: 'note' }, 'Estimado: ' + partes) : null);
}
// The team as one line: everyone's contacts against the sum of their goals, and what was sold.
function equipo(filas, cuando) {
  if (filas.length < 2) return null;
  const c = filas.reduce((t, r) => t + r.contactos, 0), meta = filas.reduce((t, r) => t + r.meta, 0), v = filas.reduce((t, r) => t + (r.ventas || 0), 0), hb = Math.max(...filas.map((r) => r.habiles || 0));
  const pc = meta ? Math.round(c / meta * 100) : 0;
  return h('div', { class: 'alert team ' + (pc >= 100 ? 'ok' : pc >= 50 ? 'warn' : '') }, h('b', {}, 'Equipo: '), `${c} de ${meta} contactos ${cuando} (${pc}%)`,
    hb ? ` · ${Math.round(c / hb / filas.length * 10) / 10} por persona al día` : '', ` · ${peso(v)} vendidos`);
}
const chips = (opts, cur, set) => h('div', { class: 'chips' }, opts.map(([v, t]) => h('button', { class: 'chip', 'aria-pressed': String(cur === v), onclick: () => { set(v); pintar(); } }, t)));
// Admins: credit an order to someone other than the salesperson on the Zoho order (a house sale, a sale keyed under the wrong rep).
const reasignar = (r) => h('button', { class: 'linkb', onclick: () => formulario(`${r.orden} · ${r.cliente}`, [
  { k: 'vendedor', t: 'Esta venta es de', tipo: 'select', ops: ['José Luis', 'Carlos', ['Tito', 'Tito (casa: Eric y Diane)'], r.en_zoho ? ['', `Como está en Zoho (${r.en_zoho})`] : null].filter(Boolean), v: r.vendedor },
  { k: 'nota', t: 'Por qué', ph: 'Quién la vendió en realidad' }],
  (v) => enviar('api/admin/asignar', { tipo: 'orden', clave: r.orden, vendedor: v.vendedor, nota: v.nota }), `${peso(r.total)} · ${dia(r.fecha)}. Solo cambia Spark; la orden en Zoho queda igual.`) }, 'Reasignar');
// Sales before taxes: Zoho order totals carry IEPS (26.5%) and IVA (16%) on wine; the reps' goals do not.
const neto = (n) => Math.round(n / 1.4674);
const semDe = (w, p) => D.semanas.find((r) => r.semana === w && r.persona === p);

export { h, svg, lista, pill, chips, peso, dia, pct, api, S, MES, personas, vendedores, ancho, formulario, enviar, registrar, nuevaCuenta, pintar, cargar, ir, toca };
export const datos = () => D;

// ---- Inicio: where each person stands (sales and contacts against their goals), then the few things that cannot wait.
// Notes, nudges and Eric's questions live in Buzón.
const sumar = (L, f) => L.reduce((t, x) => t + (f(x) || 0), 0);
const abiertasDe = (p) => (D.preguntas || []).filter((q) => !q.respondida && q.para === p);
// The 48-hour rule: a contact counts as on time when it was logged within two days of the day it happened. Applies to
// contacts from the day the rule started; sheet rows are dated by the sync that first saw them.
const REGLA_DESDE = '2026-11-21';
const dDias = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 864e5);
function regla48(p) {
  const mes = D.hoy.slice(0, 7), L = D.contactos.filter((c) => c.persona === p && c.fecha >= REGLA_DESDE && c.fecha.slice(0, 7) === mes && c.registrado);
  const tarde = L.filter((c) => dDias(c.fecha, c.registrado) > 2).length, ult = D.contactos.find((c) => c.persona === p), sin = ult ? dDias(ult.registrado && ult.registrado > ult.fecha ? ult.registrado : ult.fecha, D.hoy) : null;
  const cumple = sin != null && sin <= 2 && tarde === 0;
  return { n: L.length, tarde, sin, cumple };
}
// Badge for how late the log is: fine up to 2 days, yellow at 3 and 4, red from 5 on (or with nothing logged at all).
function regPill(p, w) {
  const g = regla48(p), v = w && w.veredicto;
  if (g.sin == null) return pill('Sin ningún registro', 'bad');
  if (g.sin >= 5) return pill(`Sin registrar · ${g.sin} días`, 'bad');
  if (g.sin >= 3) return pill(`Registro atrasado · ${g.sin} días`, 'warn');
  return v && v !== 'Pendiente' ? pill(v, KIND[v]) : pill('Registro al corriente', 'ok');
}
function urgente(p) {
  const U = [], nq = abiertasDe(p).length;
  if (nq) U.push({ k: 'bad', t: nq === 1 ? '1 pregunta de Eric sin responder' : `${nq} preguntas de Eric sin responder`, vista: 'buzon' });
  const reg = D.foco.find((f) => f.persona === p && f.tipo === 'registrar');
  if (reg) U.push({ k: 'warn', t: reg.titulo, d: reg.detalle, vista: 'semanas' });
  const venc = D.seguimiento.filter((r) => r.persona === p && r.estado === 'vencida' && r.dias_vencido > 14).sort((a, b) => b.dias_vencido - a.dias_vencido);
  if (venc.length) U.push({ k: 'bad', t: venc.length === 1 ? '1 seguimiento con más de 14 días de atraso' : `${venc.length} seguimientos con más de 14 días de atraso`, d: venc.slice(0, 3).map((r) => `${r.cuenta} (${r.dias_vencido} d)`).join(' · '), vista: 'seguimiento' });
  const toca = (D.pedidos.find((x) => x.vendedor === p) || {}).ya_les_tocaba || [];
  if (toca.length) U.push({ k: 'warn', t: toca.length === 1 ? '1 cliente ya debía pedir' : `${toca.length} clientes ya debían pedir`, d: toca.slice(0, 3).map((c) => c.cliente).join(' · '), vista: 'clientes' });
  // Dependence: one account carrying more than a quarter of the book, worse when that same account owes past 90 days.
  const C = D.clientes.filter((c) => c.vendedor === p && c.actual > 0).sort((a, b) => b.actual - a.actual), tot = sumar(C, (c) => c.actual);
  if (C.length && tot && C[0].actual / tot > .25) { const debe = sumar(((D.cobranza || {}).facturas || []).filter((f) => f.cliente === C[0].cliente && (f.dias || 0) > 90), (f) => f.saldo);
    U.push({ k: debe ? 'bad' : 'warn', t: `${C[0].cliente} es el ${Math.round(C[0].actual / tot * 100)}% de la cartera`, d: debe ? `Y debe ${peso(debe)} con más de 90 días. Abre cuentas para depender menos.` : 'Una sola cuenta pesa demasiado. Abre cuentas para depender menos.', vista: 'clientes' }); }
  const viejas = ((D.cobranza || {}).facturas || []).filter((f) => f.vendedor === p && (f.dias || 0) > 90);
  if (viejas.length) U.push({ k: 'bad', t: `${peso(sumar(viejas, (f) => f.saldo))} por cobrar con más de 90 días`, d: `${new Set(viejas.map((f) => f.cliente)).size} clientes`, vista: 'cobranza' });
  return U;
}
// The notes that go to Buzón: what to work on, what is going well, and the promotions in force.
function notasDe(p) {
  const N = D.foco.filter((f) => f.persona === p && f.tipo !== 'registrar').sort((a, b) => a.orden - b.orden).map((f) => ({ clave: `${p}|${f.titulo}`, persona: p, bien: f.tipo === 'bien', t: f.titulo, d: f.detalle, vista: f.vista }));
  return N.map((n) => ({ ...n, hecho: (D.hechos || []).includes(n.clave) }));
}
const promosHoy = () => (D.promociones || []).filter((p) => p.visible && (!p.inicio || p.inicio <= D.hoy) && (!p.fin || p.fin >= D.hoy)).map((p) => ({ clave: 'promo|' + p.id, promo: true, t: 'Promoción vigente: ' + p.nombre, d: [p.detalle, p.aplica, p.fin ? `hasta el ${dia(p.fin)}` : ''].filter(Boolean).join(' · '), vista: 'estrategia', hecho: (D.hechos || []).includes('promo|' + p.id) }));
// What shows as unread: for a rep, their open questions and notes to act on; for an admin, the questions still unanswered.
const sinLeer = () => (D.yo.persona && !D.yo.admin ? abiertasDe(D.yo.persona).length + notasDe(D.yo.persona).filter((n) => !n.bien && !n.hecho).length + promosHoy().filter((n) => !n.hecho).length : (D.preguntas || []).filter((q) => !q.respondida).length);
function marcador(p, compacto) {
  const Y = D.hoy.slice(0, 4), ym = D.hoy.slice(0, 7), mH = Number(D.hoy.slice(5, 7)), dH = Number(D.hoy.slice(8)), dMes = new Date(Number(Y), mH, 0).getDate();
  const M = String(D.presupuesto.anio) === Y && (D.presupuesto.meses[p] || []).length === 12 ? D.presupuesto.meses[p] : null;
  const vMesDe = (m) => neto(sumar(D.ordenes.filter((o) => o.vendedor === p && o.fecha.slice(0, 4) === Y && Number(o.fecha.slice(5, 7)) === m), (o) => o.total));
  const vMes = vMesDe(mH), vAnio = sumar([...Array(mH).keys()], (i) => vMesDe(i + 1)), aFecha = M ? Math.round(sumar(M.slice(0, mH - 1), (x) => x) + M[mH - 1] * dH / dMes) : 0;
  const ws = D.semanas.filter((r) => r.persona === p && r.veredicto !== 'Sin datos' && r.semana.slice(0, 4) === Y), w = semDe(D.semana_actual, p), wm = ws.filter((r) => r.semana.slice(0, 7) === ym);
  // One line of the scoreboard: label, "real de meta", a bar, and what is missing.
  const fila = (rot, real, meta, f, falta) => { const pc = meta ? Math.round(real / meta * 100) : null;
    return h('div', { class: 'mf' }, h('span', { class: 'ml' }, rot), h('b', {}, f(real)), meta ? h('span', { class: 'mm' }, ` de ${f(meta)}`) : null, pc != null ? h('em', { class: pc >= 100 ? 'up' : pc >= 60 ? '' : 'down' }, pc + '%') : null,
      pc != null ? h('div', { class: 'barra', role: 'img', 'aria-label': `${pc}% de la meta` }, h('i', { class: pc >= 100 ? 'ok' : pc >= 60 ? 'warn' : 'bad', style: `width:${Math.min(100, pc)}%` })) : null,
      pc != null && falta ? h('span', { class: 'mn' }, real >= meta ? `Vas ${f(real - meta)} arriba` : `Te faltan ${f(meta - real)}`) : null); };
  const n = (x) => String(x), U = urgente(p), nb = notasDe(p).filter((x) => !x.bien && !x.hecho).length;
  const quien = (v) => (S.persona || D.yo.persona === p ? v : v.replace('Te faltan', 'Le faltan').replace('Vas ', 'Va '));
  if (compacto) { const pcd = (a, b) => (b ? h('b', { class: a / b >= 1 ? 'up' : a / b >= .6 ? '' : 'down' }, Math.round(a / b * 100) + '%') : h('b', {}, '—'));
    return h('button', { class: 'card marc mini', onclick: () => { S.persona = p; pintar(); scrollTo(0, 0); } },
      h('div', { class: 'name' }, p, U.length ? pill(U.length === 1 ? '1 urgente' : `${U.length} urgentes`, 'bad') : pill('Sin urgentes', 'ok')),
      p !== 'Tito' ? h('div', { class: 'mreg' }, regPill(p, null)) : null,
      p !== 'Daniel' ? h('div', { class: 'mi' }, h('span', {}, 'Ventas'), h('span', {}, 'mes ', M ? pcd(vMes, M[mH - 1]) : h('b', {}, peso(vMes))), h('span', {}, 'año ', M ? pcd(vAnio, aFecha) : h('b', {}, peso(vAnio)))) : null,
      h('div', { class: 'mi' }, h('span', {}, 'Contactos'), h('span', {}, 'sem. ', w && w.meta ? pcd(w.contactos, w.meta) : h('b', {}, w ? w.contactos : 0)), h('span', {}, 'mes ', pcd(sumar(wm, (r) => r.contactos), sumar(wm, (r) => r.meta))), h('span', {}, 'año ', pcd(sumar(ws, (r) => r.contactos), sumar(ws, (r) => r.meta)))),
      M ? h('div', { class: 'mn' }, `${peso(vMes)} de ${peso(M[mH - 1])} este mes`) : null); }
  const card = h('section', { class: 'card marc' },
    h('div', { class: 'name' }, p, p === 'Tito' ? pill('Casa', 'mute') : regPill(p, w)),
    p !== 'Daniel' ? [h('h3', {}, 'Ventas', h('small', {}, ' antes de impuestos')), h('button', { class: 'mbtn', onclick: () => ir('ventas', p) },
      fila('Mes', vMes, M ? M[mH - 1] : 0, peso, true), fila('Año', vAnio, aFecha, peso, true))] : null,
    // Growth, said plainly: against last year without the inherited accounts, and what was opened and lost this year.
    ((e) => (e && e.total ? [h('h3', {}, 'Crecimiento'), h('button', { class: 'mbtn crec', onclick: () => ir('clientes', p) },
      h('div', { class: 'cr' }, h('b', { class: e.crecimiento_pct >= 0 ? 'up' : 'down' }, (e.crecimiento_pct > 0 ? '+' : '') + e.crecimiento_pct + '%'), h('span', {}, `las mismas cuentas contra ${Number(D.hoy.slice(0, 4)) - 1}, sin las heredadas`)),
      h('div', { class: 'cr' }, h('b', {}, e.nuevos.length), h('span', {}, `cuentas nuevas este año · ${peso(neto(sumar(e.nuevos, (c) => c.monto)))}`)),
      h('div', { class: 'cr' }, h('b', { class: e.perdidos.length ? 'down' : '' }, e.perdidos.length), h('span', {}, 'cuentas que dejaron de comprar')))] : null))((D.crecimiento || []).find((x) => x.persona === p)),
    h('h3', {}, 'Contactos'), h('button', { class: 'mbtn', onclick: () => ir('semanas', p) },
      fila('Semana', w ? w.contactos : 0, w ? w.meta : 0, n, true), fila('Mes', sumar(wm, (r) => r.contactos), sumar(wm, (r) => r.meta), n), fila('Año', sumar(ws, (r) => r.contactos), sumar(ws, (r) => r.meta), n), ws.length && ws[0].semana.slice(5, 7) !== '01' ? h('span', { class: 'mn' }, `El año cuenta desde el ${dia(ws[0].semana)} (primer registro).`) : null),
    p !== 'Tito' ? ((g) => h('div', { class: 'r48 ' + (g.cumple ? 'ok' : g.sin != null && g.sin < 5 && !g.tarde ? 'warn' : 'bad') }, h('b', {}, 'Regla de 48 horas: ' + (g.cumple ? 'al corriente' : g.sin != null && g.sin < 5 && !g.tarde ? 'atrasado' : 'fuera')),
      h('span', {}, g.sin == null ? 'Sin ningún registro.' : `Último registro hace ${g.sin} ${g.sin === 1 ? 'día' : 'días'}` + (g.n ? ` · ${g.n - g.tarde} de ${g.n} a tiempo este mes` : '') + (g.tarde ? ` · ${g.tarde} fuera de plazo` : '') + '. El variable del mes se paga con el registro al corriente.')))(regla48(p)) : null,
    h('h3', {}, 'Urgente'), U.length ? h('ul', { class: 'foco' }, U.map((u) => h('li', { class: u.k === 'bad' ? 'cliente' : 'meta' }, h('button', { onclick: () => ir(u.vista, p) }, u.t), u.d ? h('span', {}, u.d) : null))) : h('p', { class: 'note' }, 'Nada urgente.'),
    nb ? h('p', { class: 'note', style: 'margin-top:10px' }, h('button', { class: 'linkb', onclick: () => ir('buzon', p) }, nb === 1 ? '1 nota en el Buzón' : `${nb} notas en el Buzón`)) : null);
  card.querySelectorAll('.mn').forEach((e) => { e.textContent = quien(e.textContent); });
  return card;
}

const VISTAS = {
  hoy() {
    return h('div', {}, equipo(personas().map((p) => semDe(D.semana_actual, p)).filter(Boolean), 'esta semana'), h('div', { class: 'grid3' }, personas().map((p) => marcador(p, !ancho() && personas().length > 1))),
      !ancho() && personas().length > 1 ? h('p', { class: 'note' }, 'Porcentajes contra la meta a la fecha. Toca a una persona para ver su tablero completo.') : null);
  },

  // Buzón: Eric's questions, the notes on what to work on and what is going well, and promotions. A note leaves when marked done.
  buzon() {
    const ps = personas(), ver = S.buzonHechas, hecho = (n) => h('button', { class: 'linkb', onclick: () => enviar('api/buzon/hecho', { clave: n.clave, deshacer: n.hecho || undefined }) }, n.hecho ? 'Regresar' : 'Hecho');
    const item = (n) => h('li', { class: (n.bien ? 'bien' : n.promo ? 'meta' : 'cliente') + (n.hecho ? ' hecho' : '') }, h('button', { onclick: () => ir(n.vista, n.persona) }, n.t), n.d ? h('span', {}, n.d) : null, h('div', { class: 'bz' }, hecho(n)));
    const promos = promosHoy().filter((n) => ver || !n.hecho), q = preguntas();
    const porP = ps.map((p) => [p, notasDe(p).filter((n) => ver || !n.hecho)]).filter(([, N]) => N.length);
    const nHechas = ps.reduce((t, p) => t + notasDe(p).filter((n) => n.hecho).length, 0) + promosHoy().filter((n) => n.hecho).length;
    return h('div', {},
      q ? [h('h2', {}, 'Preguntas de Eric'), q] : null,
      promos.length ? [h('h2', {}, 'Promociones'), h('div', { class: 'card' }, h('ul', { class: 'foco' }, promos.map(item)))] : null,
      porP.length ? [h('h2', {}, 'Notas'), h('div', { class: 'grid3' }, porP.map(([p, N]) => { const A = N.filter((n) => !n.bien), B = N.filter((n) => n.bien);
        const ct = !ancho() && ps.length > 1, resto = ct ? Math.max(0, A.length - 3) + B.length : 0;
        return h('section', { class: 'card' }, ps.length > 1 ? h('div', { class: 'name' }, p) : null, A.length ? [h('h3', {}, 'Por atender'), h('ul', { class: 'foco' }, (ct ? A.slice(0, 3) : A).map(item))] : null, B.length && !ct ? [h('h3', {}, 'Va bien'), h('ul', { class: 'foco' }, B.map(item))] : null,
          resto ? h('p', {}, h('button', { class: 'more', onclick: () => ir('buzon', p) }, `Ver ${resto} más de ${p}`)) : null); }))] : null,
      !q && !promos.length && !porP.length ? h('p', { class: 'note' }, 'Buzón vacío.') : null,
      nHechas || ver ? h('p', { style: 'margin-top:14px' }, h('button', { class: 'linkb note', onclick: () => { S.buzonHechas = !ver; pintar(); } }, ver ? 'Ocultar las hechas' : `Ver las hechas (${nHechas})`)) : null);
  },

  semanas() {
    const ps = personas(), NW = ancho() ? 16 : 8;
    const todas = [...new Set(D.semanas.map((r) => r.semana))], mesesT = [...new Set(D.meses.map((r) => r.mes))];
    const esMes = S.periodo === 'mes';
    const w = S.semana && todas.includes(S.semana) ? S.semana : D.semana_actual, i = todas.indexOf(w);
    const m = S.mes && mesesT.includes(S.mes) ? S.mes : (esMes && S.semana ? w.slice(0, 7) : D.hoy.slice(0, 7)), mi = mesesT.indexOf(m);
    const set = (x) => { S.semana = x; S.periodo = 'semana'; pintar(); };
    const nav = h('div', { class: 'toolbar' },
      chips([['semana', 'Semana'], ['mes', 'Mes']], S.periodo, (v) => { S.periodo = v; if (v === 'mes') S.mes = w.slice(0, 7); }),
      esMes ? h('div', { class: 'weeknav' },
        h('button', { 'aria-label': 'Mes anterior', disabled: mi <= 0, onclick: () => { S.mes = mesesT[mi - 1]; pintar(); } }, '‹'),
        h('div', { class: 'lbl' }, `${MESL[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}`),
        h('button', { 'aria-label': 'Mes siguiente', disabled: mi >= mesesT.length - 1, onclick: () => { S.mes = mesesT[mi + 1]; pintar(); } }, '›'))
      : h('div', { class: 'weeknav' },
        h('button', { 'aria-label': 'Semana anterior', disabled: i <= 0, onclick: () => set(todas[i - 1]) }, '‹'),
        h('div', { class: 'lbl' }, `${dia(w)} – ${dia(mas(w, 6))}`),
        h('button', { 'aria-label': 'Semana siguiente', disabled: i >= todas.length - 1, onclick: () => set(todas[i + 1]) }, '›')));
    // One card per person for the period: gauge, what the count means per day, and the breakdown.
    const tarjeta = (r, p) => h('section', { class: 'card' },
      h('div', { class: 'name' }, p, r.meta ? pill(vtxt(r), KIND[r.veredicto]) : pill('Casa · sin meta', 'mute')),
      r.meta ? gauge(r.contactos, r.meta, `${p}: ${r.contactos} de ${r.meta} contactos`) : null,
      h('div', { style: 'text-align:center' }, h('span', { class: 'num' }, r.contactos), h('span', { class: 'note' }, r.meta ? ` de ${r.meta} contactos` : ' contactos')),
      ritmo(r, true),
      h('div', { class: 'kv', style: 'margin-top:10px' },
        r.ventas != null ? [h('span', {}, esMes ? 'Ventas del mes' : 'Ventas de la semana'), h('b', {}, `${peso(r.ventas)} · ${r.ordenes} órd.`)] : null,
        h('span', {}, 'Cuentas distintas'), h('b', {}, r.cuentas), h('span', {}, 'Visitas en persona'), h('b', {}, r.presencial),
        h('span', {}, 'Llamadas'), h('b', {}, r.llamadas), h('span', {}, 'Mensajes (WhatsApp, correo)'), h('b', {}, r.mensajes),
        h('span', {}, 'Prospección'), h('b', {}, r.prospeccion),
        p === 'Daniel' ? [h('span', {}, 'Catas, capacitaciones, eventos'), h('b', {}, r.catas)] : [h('span', {}, 'Cobranza'), h('b', {}, r.cobranza)],
        r.entregas ? [h('span', {}, 'Entregas (no cuentan como contacto)'), h('b', {}, r.entregas)] : null));
    // Minutes per contact: estimated (≈) until the rep says how long it really took.
    const tiempo = (r) => { const t = (r.min_real ? '' : '≈ ') + r.min + ' min';
      return puede(r.persona) ? h('button', { class: 'linkb', title: 'Corregir el tiempo', onclick: () => formulario('Tiempo que tomó', [{ k: 'minutos', t: `${r.cuenta} · ${dia(r.fecha)} · minutos con el traslado`, tipo: 'number', v: r.min, req: true, max: 600 }],
        (v) => enviar('api/tiempo', { persona: r.persona, fecha: r.fecha, cuenta: r.cuenta, actividad: r.actividad, minutos: v.minutos }), 'El estimado es 60 min por visita, 10 por llamada y 5 por mensaje. Corrígelo si fue más o menos.') }, t) : t; };
    const tablaCont = (cont, vacio) => h('div', { class: 'card' }, lista('cont', cont, 8, (r) => h('li', {}, h('div', { class: 'l1' }, h('span', {}, r.cuenta), h('span', { class: 'note' }, dia(r.fecha))), h('div', { class: 'l2' }, [ps.length > 1 ? r.persona : null, r.actividad, r.medio].filter(Boolean).join(' · '), ' · ', tiempo(r)), r.resultado ? h('div', { class: 'l2' }, r.resultado) : null), vacio,
      [{ t: 'Fecha', v: (r) => dia(r.fecha), s: (r) => r.fecha, cls: 'nw' }, ps.length > 1 && { t: 'Quién', v: (r) => r.persona, s: (r) => r.persona, cls: 'nw' }, { t: 'Cuenta', v: (r) => r.cuenta, s: (r) => r.cuenta.toLowerCase(), cls: 'b' },
        { t: 'Actividad', v: (r) => r.actividad, s: (r) => r.actividad }, { t: 'Medio', v: (r) => r.medio, s: (r) => r.medio },
        { t: 'Tiempo', v: tiempo, s: (r) => r.min, num: true }, { t: 'Resultado', v: (r) => r.resultado, largo: true }]));
    const tablaOrd = (ords, vacio) => (ps.some((p) => p !== 'Daniel') ? [h('h2', {}, 'Qué vendieron'),
      h('div', { class: 'card' }, lista('ords', ords, 8, (r) => h('li', {}, h('div', { class: 'l1' }, h('span', {}, r.cliente), h('span', {}, peso(r.total))), h('div', { class: 'l2' }, [dia(r.fecha), r.orden, ps.length > 1 ? r.vendedor : null, r.en_zoho ? `en Zoho: ${r.en_zoho}` : null].filter(Boolean).join(' · '), D.yo.admin ? [' · ', reasignar(r)] : null)), vacio,
        [{ t: 'Fecha', v: (r) => dia(r.fecha), s: (r) => r.fecha, cls: 'nw' }, { t: 'Cliente', v: (r) => r.cliente, s: (r) => r.cliente.toLowerCase(), cls: 'b' }, { t: 'Orden', v: (r) => r.orden, cls: 'mut' },
          { t: 'Vendedor', v: (r) => [r.vendedor, r.en_zoho ? h('div', { class: 'note' }, `en Zoho: ${r.en_zoho}`) : null], s: (r) => r.vendedor }, { t: 'Total', v: (r) => peso(r.total), s: (r) => r.total, num: true },
          D.yo.admin && { t: '', v: reasignar, cls: 'nw' }]))] : null);
    // Week blocks; `solo` limits them to a list of weeks (the month view shows that month's weeks).
    const semaforo = (ult) => {
      const heat = h('div', { class: 'heat', style: `grid-template-columns:auto repeat(${ult.length},minmax(0,1fr))` });
      heat.append(h('span'));
      ult.forEach((x, k) => heat.append(h('span', { class: 'h' }, esMes ? dia(x) : (k === 0 || x.slice(5, 7) !== ult[k - 1].slice(5, 7) ? MES[Number(x.slice(5, 7)) - 1] : '·'))));
      for (const p of ps) {
        heat.append(h('span', { class: 'rn' }, p));
        for (const x of ult) {
          const r = semDe(x, p);
          if (!r || r.veredicto === 'Sin datos') { heat.append(h('span', { class: 'h' }, '–')); continue; }
          if (r.veredicto === 'Casa') { heat.append(h('button', { class: !esMes && x === w ? 'cur' : '', style: 'background:var(--rule);color:var(--text)', 'aria-label': `${p}, semana del ${dia(x)}: ${r.contactos} contactos`, onclick: () => set(x) }, r.contactos)); continue; }
          heat.append(h('button', { class: (r.contactos ? '' : r.veredicto === 'Pendiente' ? 'pend' : 'zero') + (!esMes && x === w ? ' cur' : ''), style: r.contactos ? `background:var(--${KIND[r.veredicto]})` : null,
            'aria-label': `${p}, semana del ${dia(x)}: ${r.contactos} contactos, ${r.veredicto}`, onclick: () => set(x) }, r.contactos));
        }
      }
      return h('div', { class: 'card' }, heat, h('p', { class: 'note', style: 'margin:8px 0 0' }, 'Verde 30+, ámbar 15–29, rojo menos de 15, rojo oscuro: semana que se saltaron sin registrar nada; punteado: todavía no registran. Toca una semana para abrirla.'),
        ps.includes('Carlos') ? h('p', { class: 'note', style: 'margin:4px 0 0' }, '¿Carlos, enero a septiembre? No hay registro de sus actividades antes de octubre: él confirmó que no lo llevaba.') : null);
    };

    if (esMes) {
      const filas = D.meses.filter((r) => r.mes === m && ps.includes(r.persona) && r.veredicto !== 'Sin datos');
      const ceros = D.semanas.filter((r) => r.semana.slice(0, 7) === m && ps.includes(r.persona) && r.veredicto === 'En cero' && !r.en_curso);
      return h('div', {}, nav, equipo(filas, 'en el mes'),
        filas.length ? h('div', { class: 'grid3' }, filas.map((r) => tarjeta(r, r.persona))) : h('p', { class: 'note' }, 'Sin registros en este mes.'),
        h('h2', {}, 'Semana por semana'), semaforo(todas.filter((x) => x.slice(0, 7) === m)),
        h('h2', {}, 'Diagnóstico del mes'),
        h('div', { class: 'alert' + (ceros.length ? '' : ' ok') }, ceros.length ? [h('b', {}, 'Semanas en cero: '), ceros.map((r) => `${r.persona}, semana del ${dia(r.semana)}`).join(' · ')] : 'Nadie se saltó una semana completa este mes.'),
        h('div', { class: 'grid3' }, filas.map((r) => h('section', { class: 'card' },
          h('div', { class: 'name' }, r.persona),
          h('ul', { class: 'foco', style: 'margin-top:8px' },
            h('li', { class: r.en_cero ? '' : 'bien' }, h('span', {}, `Semanas: ${r.productivas} productivas · ${r.a_medias} a medias · ${r.flojas} flojas · ${r.en_cero} en cero` + (r.pendientes ? ` · ${r.pendientes} pendientes de registrar.` : '.'))),
            r.ventas != null ? h('li', { class: 'bien' }, h('span', {}, `Vendió ${peso(r.ventas)} en ${r.ordenes} órdenes.`)) : null,
            r.descuidados.length ? h('li', {}, h('span', {}, `Clientes a la baja que nadie tocó (${r.descuidados.length}): ${r.descuidados.join(' · ')}.`)) : null,
            r.promesas.length ? h('li', {}, h('span', {}, `Prometió volver y no lo registró (${r.promesas.length}): ${r.promesas.join(' · ')}.`)) : h('li', { class: 'bien' }, h('span', {}, 'Cumplió los seguimientos que prometió.')))))),
        h('h2', {}, 'A quién contactaron'), tablaCont(D.contactos.filter((r) => r.fecha.slice(0, 7) === m && ps.includes(r.persona)).slice().reverse(), 'Sin contactos registrados este mes.'),
        tablaOrd(D.ordenes.filter((r) => r.fecha.slice(0, 7) === m && ps.includes(r.vendedor)).slice().reverse(), 'Sin órdenes este mes.'));
    }
    const filas = ps.map((p) => semDe(w, p)).filter(Boolean);
    return h('div', {}, nav, equipo(filas.filter((r) => r.veredicto !== 'Sin datos'), 'en la semana'),
      h('div', { class: 'grid3' }, filas.map((r) => tarjeta(r, r.persona))),
      h('h2', {}, 'Semáforo'), semaforo(todas.slice(-NW)),
      h('h2', {}, 'Tendencia'),
      h('div', { class: 'grid3' }, ps.filter((p) => p !== 'Tito').map((p) => tendencia(p, D.semanas.filter((r) => r.persona === p && r.veredicto !== 'Sin datos').slice(-NW)))),
      h('p', { class: 'note' }, 'Línea: contactos por semana sobre las franjas verde (30+), ámbar (15–29) y roja. Barras: ventas de esa semana.'),
      h('h2', {}, 'A quién contactaron'), tablaCont(D.contactos.filter((r) => r.semana === w && ps.includes(r.persona)).slice().reverse(), 'Sin contactos registrados esta semana.'),
      tablaOrd(D.ordenes.filter((r) => r.semana === w && ps.includes(r.vendedor)).slice().reverse(), 'Sin órdenes esta semana.'));
  },

  // Questions Eric needs answered (what is inside "Público en general", whose account something is). Kept off the home screen.
  pendientes() {
    return h('div', {}, h('p', { class: 'note', style: 'margin-bottom:12px' }, 'Dudas sobre clientes y ventas que solo el vendedor puede aclarar. Lo que respondas aquí lo ve Eric.'), preguntas() || h('p', { class: 'note' }, 'No hay preguntas.'));
  },

  seguimiento() {
    const ps = personas();
    const cob = D.cobertura.filter((c) => ps.includes(c.vendedor)).slice().sort((a, b) => (b.dias ?? 1e6) - (a.dias ?? 1e6));
    let seg = D.seguimiento.filter((r) => ps.includes(r.persona) && (S.segFiltro ? r.estado === S.segFiltro : r.estado !== 'cerrada'));
    seg = seg.slice().sort(S.segOrden === 'reciente' ? (a, b) => a.dias_sin_contacto - b.dias_sin_contacto : S.segOrden === 'proximo' ? (a, b) => ((a.proximo || '9999') < (b.proximo || '9999') ? -1 : 1) : (a, b) => b.dias_sin_contacto - a.dias_sin_contacto);
    const n = (e) => D.seguimiento.filter((r) => ps.includes(r.persona) && r.estado === e).length;
    const est = (r) => (r.estado === 'al día' ? pill('Al día', 'ok') : r.estado === 'vencida' ? pill(`Vencida · ${r.dias_vencido} d`, 'bad') : r.estado === 'cerrada' ? pill('Cerrada', 'mute') : pill('Sin fecha', 'warn'));
    const dot = { verde: 'ok', amarillo: 'warn', rojo: 'bad', 'sin registro': 'bad' };
    const deCob = (c) => ({ cuenta: c.cliente, persona: c.vendedor, ultimo_contacto: c.ultimo_contacto, dias_sin_contacto: c.dias, ultima_nota: c.ultima_nota, pausa: c.pausa });
    return h('div', {},
      h('div', { class: 'toolbar' }, chips([['vencida', `Vencidas ${n('vencida')}`], ['al día', `Al día ${n('al día')}`], ['sin fecha', `Sin fecha ${n('sin fecha')}`], ['', 'Todas']], S.segFiltro, (v) => { S.segFiltro = v; }),
        ancho() ? null : h('select', { 'aria-label': 'Ordenar', onchange: (e) => { S.segOrden = e.target.value; pintar(); } },
        [['viejo', 'Más tiempo sin contacto'], ['reciente', 'Contacto más reciente'], ['proximo', 'Próximo contacto']].map(([v, t]) => h('option', { value: v, selected: S.segOrden === v }, t)))),

      h('p', { class: 'note', style: 'margin-bottom:8px' }, 'Toca una cuenta para registrar el contacto. Si ya la contactaste y no lo anotaste, ponle la fecha en que fue.'),
      h('div', { class: 'card' }, lista('seg', seg, 10, (r) => h('li', puede(r.persona) ? toca(() => registrar(r)) : {},
        h('div', { class: 'l1' }, h('span', {}, r.cuenta), est(r)),
        r.pausa ? h('div', { class: 'l2' }, pausado(r)) : null,
        r.de_archivo ? h('div', { class: 'l2' }, pill('Del archivo de Carlos, sin registro en el CRM', 'mute')) : null,
        h('div', { class: 'l2' }, [ps.length > 1 ? r.persona : null, `Último contacto ${dia(r.ultimo_contacto)} (${r.dias_sin_contacto} días)`, r.proximo ? `próximo ${dia(r.proximo)}` : null].filter(Boolean).join(' · ')),
        r.ultima_nota ? h('div', { class: 'l2' }, r.ultima_nota.slice(0, 160)) : null,
        r.sugerencia ? h('div', { class: 'sug' }, h('b', {}, 'Siguiente paso'), h('span', {}, r.sugerencia)) : null,
        puede(r.persona) ? h('div', { class: 'acc' }, h('button', { class: 'btn sm', onclick: () => registrar(r) }, 'Registrar contacto')) : null), 'No hay cuentas en esta lista.',
        [{ t: 'Cuenta', v: (r) => [r.cuenta, r.pausa ? h('div', {}, pausado(r)) : null], s: (r) => r.cuenta.toLowerCase(), cls: 'b' }, ps.length > 1 && { t: 'Quién', v: (r) => r.persona, s: (r) => r.persona, cls: 'nw' },
          { t: 'Último contacto', v: (r) => dia(r.ultimo_contacto), s: (r) => r.ultimo_contacto, cls: 'nw' }, { t: 'Días sin contacto', v: (r) => r.dias_sin_contacto, s: (r) => r.dias_sin_contacto, num: true },
          { t: 'Estado', v: (r) => [est(r), r.proximo && r.estado !== 'vencida' ? h('div', { class: 'note' }, 'próximo ' + dia(r.proximo)) : null], s: (r) => (r.estado === 'vencida' ? -r.dias_vencido : 1), cls: 'nw' }, { t: 'Última nota', v: (r) => r.ultima_nota || '', largo: true }, { t: 'Siguiente paso sugerido', v: (r) => r.sugerencia || '—', cls: 'sugc' },
          { t: '', v: (r) => (puede(r.persona) ? h('button', { class: 'btn sm sec', onclick: () => registrar(r) }, 'Registrar') : ''), cls: 'nw' }], (r) => { if (puede(r.persona)) registrar(r); })),
      vendedores().length ? [h('h2', {}, 'Clientes principales'),
        h('p', { class: 'note' }, 'Los 15 más grandes de cada vendedor, primero los que llevan más tiempo sin contacto.'),
        h('div', { class: 'card' }, lista('cob', cob, 10, (c) => h('li', puede(c.vendedor) ? toca(() => registrar(deCob(c))) : {},
          h('div', { class: 'l1' }, h('span', {}, c.cliente), pill(c.dias == null ? 'Sin registro' : (c.dias === 1 ? '1 día' : `${c.dias} días`), dot[c.estado])),
          c.pausa ? h('div', { class: 'l2' }, pausado(c)) : null,
          h('div', { class: 'l2' }, [ps.length > 1 ? c.vendedor : null, `${peso(c.actual)} este año`, c.cambio_pct != null ? `${pct(c.cambio_pct)} vs. año pasado` : 'nuevo'].filter(Boolean).join(' · ')),
          c.ultima_nota ? h('div', { class: 'l2' }, (c.contacto_por && c.contacto_por !== c.vendedor ? `(${c.contacto_por}) ` : '') + c.ultima_nota.slice(0, 140)) : null), 'Sin clientes.',
          [{ t: 'Cliente', v: (c) => [c.cliente, c.pausa ? h('div', {}, pausado(c)) : null], s: (c) => c.cliente.toLowerCase(), cls: 'b' }, ps.length > 1 && { t: 'Vendedor', v: (c) => c.vendedor, s: (c) => c.vendedor, cls: 'nw' },
            { t: 'Este año', v: (c) => peso(c.actual), s: (c) => c.actual, num: true }, { t: 'vs. año pasado', v: (c) => (c.cambio_pct == null ? 'nuevo' : h('span', { class: c.cambio_pct >= 0 ? 'up' : 'down' }, pct(c.cambio_pct))), s: (c) => c.cambio_pct, num: true },
            { t: 'Sin contacto', v: (c) => pill(c.dias == null ? 'Sin registro' : (c.dias === 1 ? '1 día' : `${c.dias} días`), dot[c.estado]), s: (c) => (c.dias == null ? 1e6 : c.dias), num: true }, { t: 'Última nota', v: (c) => (c.ultima_nota || '').slice(0, 140), largo: true }], (c) => { if (puede(c.vendedor)) registrar(deCob(c)); }))] : null);
  },

  ventas() {
    const vs = vendedores();
    if (!vs.length) return h('p', { class: 'note' }, 'Daniel no factura: sus números están en Semanas y Seguimiento.');
    const ym = D.hoy.slice(0, 7), ords = D.ordenes.filter((o) => o.fecha.slice(0, 7) === ym && vs.includes(o.vendedor));
    // Month budget from Carlos's 2026 plan, against what Zoho shows so far.
    const presu = (r) => { const P = (D.presupuesto.meses[r.vendedor] || [])[Number(ym.slice(5)) - 1]; if (!P) return null; const pc = Math.round(neto(r.total) / P * 100);
      return h('div', { style: 'margin-top:12px' }, h('div', { class: 'kv' }, h('span', {}, 'Antes de impuestos'), h('b', {}, peso(neto(r.total))), h('span', {}, 'Meta del mes'), h('b', {}, `${peso(P)} · ${pc}%`)), h('div', { class: 'barra', role: 'img', 'aria-label': `${pc}% de la meta del mes` }, h('i', { class: pc >= 100 ? 'ok' : pc >= 60 ? 'warn' : 'bad', style: `width:${Math.min(100, pc)}%` }))); };
    // The year against each rep's sales goal: so far against the goal to date (this month counted by days gone), and against the whole year.
    const Y = D.hoy.slice(0, 4), mH = Number(D.hoy.slice(5, 7)), dH = Number(D.hoy.slice(8)), dMes = new Date(Number(Y), mH, 0).getDate();
    const realMes = (v, m) => neto(D.ordenes.filter((o) => o.vendedor === v && o.fecha.slice(0, 4) === Y && Number(o.fecha.slice(5, 7)) === m).reduce((t, o) => t + o.total, 0));
    const barra = (pc, txt) => h('div', { class: 'barra', role: 'img', 'aria-label': txt }, h('i', { class: pc >= 100 ? 'ok' : pc >= 80 ? 'warn' : 'bad', style: `width:${Math.min(100, pc)}%` }));
    const conMeta = vs.filter((v) => (D.presupuesto.meses[v] || []).length === 12 && String(D.presupuesto.anio) === Y);
    const anual = conMeta.map((v) => { const M = D.presupuesto.meses[v], R = M.map((_, i) => (i + 1 <= mH ? realMes(v, i + 1) : null));
      const real = R.reduce((t, x) => t + (x || 0), 0), meta = M.reduce((t, x) => t + x, 0), aFecha = Math.round(M.slice(0, mH - 1).reduce((t, x) => t + x, 0) + M[mH - 1] * dH / dMes);
      return { v, M, R, real, meta, aFecha, pcF: aFecha ? Math.round(real / aFecha * 100) : 0, pcA: Math.round(real / meta * 100) }; });
    const E = { invoiced: 'Facturada', not_invoiced: 'Sin facturar', partially_invoiced: 'Factura parcial', paid: 'pagada', unpaid: 'sin pagar', partially_paid: 'pago parcial' };
    return h('div', {},
      h('h2', {}, `Ventas de ${MESL[Number(ym.slice(5)) - 1]}`),
      h('div', { class: 'grid3' }, D.mes.filter((r) => vs.includes(r.vendedor)).map((r) => h('section', { class: 'card' },
        h('div', { class: 'name' }, r.vendedor), h('div', { class: 'num' }, peso(r.total)),
        h('div', { class: 'kv' }, h('span', {}, 'Órdenes'), h('b', {}, r.ordenes), h('span', {}, 'Clientes'), h('b', {}, r.clientes),
          h('span', {}, 'Sin facturar'), h('b', {}, peso(r.sin_facturar)), h('span', {}, 'Facturado sin pagar'), h('b', {}, peso(r.por_cobrar))),
        presu(r)))),
      anual.length ? [h('h2', {}, `Meta de ventas ${Y}`),
        h('div', { class: 'grid3' }, anual.map((a) => h('section', { class: 'card' }, h('div', { class: 'name' }, a.v, pill(a.pcF >= 100 ? 'Arriba de la meta' : a.pcF >= 80 ? 'Cerca de la meta' : 'Abajo de la meta', a.pcF >= 100 ? 'ok' : a.pcF >= 80 ? 'warn' : 'bad')),
          h('div', { class: 'num' }, peso(a.real)), h('p', { class: 'note', style: 'margin:0 0 10px' }, `vendido antes de impuestos, de enero al ${dia(D.hoy)}`),
          h('div', { class: 'kv' }, h('span', {}, 'Meta a la fecha'), h('b', {}, `${peso(a.aFecha)} · ${a.pcF}%`)), barra(a.pcF, `${a.pcF}% de la meta a la fecha`),
          h('p', { class: 'note', style: 'margin:4px 0 10px' }, a.real >= a.aFecha ? `Va ${peso(a.real - a.aFecha)} arriba.` : `Le faltan ${peso(a.aFecha - a.real)} para ir al día.`),
          h('div', { class: 'kv' }, h('span', {}, 'Meta del año'), h('b', {}, `${peso(a.meta)} · ${a.pcA}%`)), barra(a.pcA, `${a.pcA}% de la meta del año`),
          h('p', { class: 'note', style: 'margin:4px 0 0' }, `Faltan ${peso(Math.max(0, a.meta - a.real))} en lo que queda del año.`)))),
        h('h3', { style: 'margin-top:14px' }, 'Mes por mes'),
        (ancho() ? [anual] : anual.map((a) => [a])).map((anual) => h('div', { class: 'card' }, h('div', { class: 'tblwrap' }, h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, h('th', {}, 'Mes'), anual.flatMap((a) => [h('th', { class: 'r' }, a.v + ' · meta'), h('th', { class: 'r' }, 'Vendido'), h('th', { class: 'r' }, '%')]))),
          h('tbody', {}, MESL.map((n, i) => h('tr', { style: i + 1 === mH ? 'font-weight:600' : null }, h('td', {}, n.charAt(0).toUpperCase() + n.slice(1) + (i + 1 === mH && ancho() ? ' (en curso)' : '')),
            anual.flatMap((a) => { const r = a.R[i], pc = r == null ? null : Math.round(r / a.M[i] * 100); return [h('td', { class: 'r' }, peso(a.M[i])), h('td', { class: 'r' }, r == null ? '—' : peso(r)), h('td', { class: 'r' }, pc == null ? '—' : h('span', { class: pc >= 100 ? 'up' : pc >= 60 ? '' : 'down' }, pc + '%'))]; }))),
            h('tr', { style: 'font-weight:700' }, h('td', {}, 'Año'), anual.flatMap((a) => [h('td', { class: 'r' }, peso(a.meta)), h('td', { class: 'r' }, peso(a.real)), h('td', { class: 'r' }, a.pcA + '%')]))))))),
        h('p', { class: 'note' }, 'Metas del archivo "Ajuste de metas", antes de IEPS e IVA; de agosto a diciembre son las ajustadas. "Vendido" son los pedidos en Zoho sin impuestos (el total entre 1.4674: IEPS 26.5% más IVA 16%), sin muestras ni cuentas de la casa; la exportación y lo reasignado a Tito no cuentan para ningún vendedor.')] : null,
      h('h2', {}, 'Órdenes del mes'),
      h('div', { class: 'card' }, lista('mes', ords, 12, (o) => h('li', {}, h('div', { class: 'l1' }, h('span', {}, o.cliente), h('span', {}, peso(o.total))),
        h('div', { class: 'l2' }, [dia(o.fecha), o.orden, vs.length > 1 ? o.vendedor : null, E[o.facturacion] || o.facturacion, E[o.pago] || o.pago].filter(Boolean).join(' · '))), 'Todavía no hay órdenes este mes.',
        [{ t: 'Fecha', v: (o) => dia(o.fecha), s: (o) => o.fecha, cls: 'nw' }, { t: 'Cliente', v: (o) => o.cliente, s: (o) => o.cliente.toLowerCase(), cls: 'b' }, { t: 'Orden', v: (o) => o.orden, cls: 'mut' },
          vs.length > 1 && { t: 'Vendedor', v: (o) => o.vendedor, s: (o) => o.vendedor }, { t: 'Facturación', v: (o) => E[o.facturacion] || o.facturacion, s: (o) => o.facturacion }, { t: 'Pago', v: (o) => E[o.pago] || o.pago, s: (o) => o.pago },
          { t: 'Total', v: (o) => peso(o.total), s: (o) => o.total, num: true }])),
      h('p', { class: 'note' }, 'Órdenes de venta de Zoho, con IVA, sin muestras.'));
  },

  clientes() {
    const vs = vendedores(), ps = personas();
    const Y = Number(D.hoy.slice(0, 4));
    const RK = { 'Al corriente': 'ok', 'Ya le tocaba': 'bad', Nuevo: 'warn', Inactivo: 'mute' };
    const copeo = D.copeo.filter((c) => ps.includes(c.persona));
    // Vino por copa: the CRM has no field for it yet, so this is what the notes mention.
    const secCopeo = [h('h2', {}, 'Copeo (vino por copa)'),
      h('p', { class: 'note' }, 'El CRM todavía no tiene un campo de copeo: esto sale de las notas donde lo mencionan. No distingue entre "ya lo sirven por copa" y "se lo propuse".'),
      h('div', { class: 'card' }, lista('copeo', copeo, 10, (c) => h('li', {}, h('div', { class: 'l1' }, h('span', {}, c.cuenta), h('span', { class: 'note' }, dia(c.fecha))), h('div', { class: 'l2' }, c.persona), h('div', { class: 'l2' }, (c.nota || '').slice(0, 200))), 'Nadie ha registrado copeo en sus notas.',
        [{ t: 'Cuenta', v: (c) => c.cuenta, s: (c) => c.cuenta.toLowerCase(), cls: 'b' }, { t: 'Quién', v: (c) => c.persona, s: (c) => c.persona, cls: 'nw' }, { t: 'Última mención', v: (c) => dia(c.fecha), s: (c) => c.fecha, cls: 'nw' },
          { t: 'Veces', v: (c) => c.menciones, s: (c) => c.menciones, num: true }, { t: 'Nota', v: (c) => (c.nota || '').slice(0, 220), cls: 'mut wide' }]))];
    if (!vs.length) return h('div', {}, secCopeo);
    const corto = !ancho() && vs.length > 1;
    return h('div', {}, vs.map((v) => {
      const L = D.clientes.filter((c) => c.vendedor === v), t = (k) => L.reduce((s, c) => s + c[k], 0), ch = t('pasado_mp') ? Math.round((t('actual') - t('pasado_mp')) / t('pasado_mp') * 1000) / 10 : null;
      const P = D.pedidos.find((x) => x.vendedor === v);
      // The biggest moves in pesos against the same date last year. A percentage alone hides how much money a client is worth.
      const dif = (c) => c.actual - c.pasado_mp;
      const perdidas = L.filter((c) => dif(c) <= -UMBRAL && (c.cambio_pct == null || c.cambio_pct <= -30)).sort((a, b) => dif(a) - dif(b));
      const ganancias = L.filter((c) => dif(c) >= UMBRAL && (c.cambio_pct == null || c.cambio_pct >= 25)).sort((a, b) => dif(b) - dif(a));
      const mov = (c, k) => h('li', { class: k }, h('div', { class: 'l1' }, h('span', {}, c.cliente), h('span', { class: k === 'bad' ? 'down' : 'up' }, (dif(c) > 0 ? '+' : '−') + peso(Math.abs(dif(c))))),
        h('div', { class: 'l2' }, `${peso(c.pasado_mp)} → ${peso(c.actual)}` + (c.cambio_pct == null ? ' · cliente nuevo' : ` · ${pct(c.cambio_pct)}`) + (c.dias_sin_pedir != null ? ` · último pedido hace ${c.dias_sin_pedir} días` : '')));
      const movimientos = h('div', { class: 'cols2 movs' },
        h('section', { class: 'card' }, h('div', { class: 'name' }, 'Pérdidas críticas', pill(perdidas.length ? '−' + peso(Math.abs(perdidas.reduce((t, c) => t + dif(c), 0))) : 'Ninguna', perdidas.length ? 'bad' : 'ok')),
          perdidas.length ? h('ul', { class: 'rows mov' }, perdidas.slice(0, corto ? 4 : 8).map((c) => mov(c, 'bad'))) : h('p', { class: 'note' }, `Ningún cliente ha bajado ${peso(UMBRAL)} o más contra el año pasado.`)),
        h('section', { class: 'card' }, h('div', { class: 'name' }, 'Ganancias fuertes', pill(ganancias.length ? '+' + peso(ganancias.reduce((t, c) => t + dif(c), 0)) : 'Ninguna', ganancias.length ? 'ok' : 'mute')),
          ganancias.length ? h('ul', { class: 'rows mov' }, ganancias.slice(0, corto ? 4 : 8).map((c) => mov(c, 'ok'))) : h('p', { class: 'note' }, `Ningún cliente ha subido ${peso(UMBRAL)} o más contra el año pasado.`)));
      const kpi = (n, label, sub) => h('div', { class: 'kpi' }, h('div', { class: 'num' }, n), h('div', { class: 'kl' }, label), sub ? h('div', { class: 'note' }, sub) : null);
      const metricas = P ? [h('div', { class: 'card kpis' },
          kpi(P.activos_90, 'Clientes activos', 'pidieron en los últimos 90 días'),
          kpi(P.nuevos_mes.length, 'Clientes nuevos este mes', P.nuevos_mes.length ? P.nuevos_mes.join(' · ') : `${P.nuevos_semana.length} esta semana`),
          kpi(P.recompra_pct == null ? '—' : P.recompra_pct + '%', 'Recompra de clientes nuevos', P.recompra_base ? `${P.recompra_n} de ${P.recompra_base} volvieron a pedir` : 'sin clientes nuevos con 60+ días'),
          kpi(peso(P.ticket), 'Pedido promedio', `${P.pedidos_90} pedidos en 90 días`),
          h('div', { class: 'kpi' }, h('div', { class: 'minibars', role: 'img', 'aria-label': 'Clientes nuevos por mes: ' + P.nuevos_por_mes.map((x) => `${MES[Number(x.mes.slice(5)) - 1]} ${x.n}`).join(', ') },
            P.nuevos_por_mes.map((x) => h('span', {}, h('b', {}, x.n), h('i', { style: `height:${Math.max(3, x.n / Math.max(1, ...P.nuevos_por_mes.map((y) => y.n)) * 34)}px` }), h('small', {}, MES[Number(x.mes.slice(5)) - 1])))), h('div', { class: 'kl' }, 'Clientes nuevos por mes'))),
        h('h3', {}, `Ya les tocaba pedir (${P.ya_les_tocaba.length})`),
        h('div', { class: 'card' }, lista('toca' + v, P.ya_les_tocaba, 8, (c) => h('li', {}, h('div', { class: 'l1' }, h('span', {}, c.cliente), pill(`${c.dias_sin_pedir} días sin pedir`, 'bad')), h('div', { class: 'l2' }, `Suele pedir cada ${c.cada_dias} días · último pedido ${dia(c.ultima)} · ${peso(c.total_12m)} en 12 meses`)), 'Todos los clientes con ritmo de compra van al corriente.',
          [{ t: 'Cliente', v: (c) => c.cliente, s: (c) => c.cliente.toLowerCase(), cls: 'b' }, { t: 'Último pedido', v: (c) => dia(c.ultima), s: (c) => c.ultima, cls: 'nw' }, { t: 'Días sin pedir', v: (c) => c.dias_sin_pedir, s: (c) => c.dias_sin_pedir, num: true },
            { t: 'Suele pedir cada', v: (c) => c.cada_dias + ' días', s: (c) => c.cada_dias, num: true }, { t: 'Pedidos 12 meses', v: (c) => c.pedidos_12m, s: (c) => c.pedidos_12m, num: true }, { t: 'Vendido 12 meses', v: (c) => peso(c.total_12m), s: (c) => c.total_12m, num: true }])),
        h('h3', {}, 'Año contra año')] : [];
      return [h('h2', {}, v),
        h('p', { class: 'note' }, `${peso(t('actual'))} este año contra ${peso(t('pasado_mp'))} a la misma fecha del año pasado (`, h('span', { class: ch >= 0 ? 'up' : 'down' }, pct(ch)), ').'), ((sf) => (sf.length ? h('p', { class: 'note' }, `Incluye ${peso(neto(sumar(sf, (o) => o.total)))} en ${sf.length} pedidos de este año todavía sin facturar: ` + sf.slice(0, 5).map((o) => o.cliente).join(' · ') + (sf.length > 5 ? '…' : '') + '.') : null))(D.ordenes.filter((o) => o.vendedor === v && o.fecha.slice(0, 4) === String(Y) && !['invoiced', 'partially_invoiced'].includes(o.facturacion))),
        movimientos, corto ? h('p', {}, h('button', { class: 'more', onclick: () => ir('clientes', v) }, `Ver todo de ${v}`)) : null, corto ? null : metricas,
        corto ? null : h('div', { class: 'card' }, lista('yoy' + v, L, 15, (c) => {
          const mx = Math.max(c.antepasado, c.pasado, c.actual, 1);
          return h('li', {}, h('div', { class: 'l1' }, h('span', {}, c.cliente),
            h('span', { class: 'bar3', role: 'img', 'aria-label': `Hace dos años ${peso(c.antepasado)}, año pasado ${peso(c.pasado)}, este año ${peso(c.actual)}` }, [c.antepasado, c.pasado, c.actual].map((x) => h('i', { style: `height:${Math.round(x / mx * 100)}%` })))),
            c.ritmo ? h('div', { class: 'l2' }, pill(c.ritmo, RK[c.ritmo]), c.cada_dias ? ` pide cada ${c.cada_dias} días · ${c.pedidos_12m} pedidos en 12 meses` : ` ${c.pedidos_12m} pedidos en 12 meses`) : null,
            h('div', { class: 'l2' }, `${peso(c.actual)} este año · `, c.cambio_pct == null ? (c.actual > 0 ? 'nuevo' : '—') : h('span', { class: c.cambio_pct >= 0 ? 'up' : 'down' }, pct(c.cambio_pct)), ` · última factura ${dia(c.ultima_factura)}${c.ultima_factura && c.ultima_factura.slice(0, 4) !== D.hoy.slice(0, 4) ? ' ' + c.ultima_factura.slice(0, 4) : ''}`));
        }, 'Sin clientes facturados.',
        [{ t: 'Cliente', v: (c) => c.cliente, s: (c) => c.cliente.toLowerCase(), cls: 'b' }, { t: Y - 1, v: (c) => peso(c.pasado), s: (c) => c.pasado, num: true },
          { t: `${Y - 1} a la fecha`, v: (c) => peso(c.pasado_mp), s: (c) => c.pasado_mp, num: true }, { t: Y, v: (c) => peso(c.actual), s: (c) => c.actual, num: true },
          { t: 'Diferencia', v: (c) => { const d = c.actual - c.pasado_mp; return h('span', { class: (d < 0 ? 'down' : d > 0 ? 'up' : '') + (Math.abs(d) >= UMBRAL ? ' fuerte' : '') }, (d > 0 ? '+' : d < 0 ? '−' : '') + peso(Math.abs(d))); }, s: (c) => c.actual - c.pasado_mp, num: true },
          { t: 'Cambio', v: (c) => (c.cambio_pct == null ? (c.actual > 0 ? 'nuevo' : '—') : h('span', { class: c.cambio_pct >= 0 ? 'up' : 'down' }, pct(c.cambio_pct))), s: (c) => c.cambio_pct, num: true },
          { t: 'Pedidos 12 m', v: (c) => c.pedidos_12m, s: (c) => c.pedidos_12m, num: true }, { t: 'Pide cada', v: (c) => (c.cada_dias ? c.cada_dias + ' días' : '—'), s: (c) => c.cada_dias, num: true },
          { t: 'Ritmo', v: (c) => (c.ritmo ? pill(c.ritmo, RK[c.ritmo]) : '—'), s: (c) => c.ritmo, cls: 'nw' },
          { t: 'Última factura', v: (c) => dia(c.ultima_factura) + (c.ultima_factura && c.ultima_factura.slice(0, 4) != Y ? ' ' + c.ultima_factura.slice(0, 4) : ''), s: (c) => c.ultima_factura, cls: 'nw' }]))];
    }), secCopeo);
  },

  zonas() {
    const COL = { Fuerte: 'var(--ok)', 'Presencia débil': 'var(--warn)', 'Sin presencia': 'var(--bad)' }, K = { Fuerte: 'ok', 'Presencia débil': 'warn', 'Sin presencia': 'bad' };
    const byZ = new Map(D.zonas.map((z) => [z.zona, z])), cur = byZ.get(S.zona);
    const prosZ = (z) => `Prospectos: ${z.prospectos - z.sin_contactar} de ${z.prospectos} contactados · ${z.en_proceso} en proceso · ${z.rechazados} rechazados` + (z.ultimo_prospecto ? ` · último contacto ${dia(z.ultimo_prospecto)}` : ' · ningún contacto');
    const map = h('div', { class: 'card' });
    // Shade: the bigger the market we are missing in a zone, the deeper its colour. Strong zones stay an even green.
    const maxB = Math.max(1, ...D.zonas.map((z) => z.brecha || 0)), tono = (z) => (!z ? 0.4 : z.estado === 'Fuerte' ? 0.6 : 0.3 + 0.55 * Math.sqrt((z.brecha || 0) / maxB));
    const corto = (n) => (n >= 1e6 ? '$' + (n / 1e6).toFixed(1) + ' M' : n >= 1e3 ? '$' + Math.round(n / 1e3) + ' mil' : peso(n));
    estados().then((E) => {
      // Plain Mercator; good enough at Mexico's size.
      const P = ([lon, lat]) => [lon * 20, -Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) * 180 / Math.PI * 20];
      const ring = (r) => 'M' + r.map((p) => P(p).map((x) => x.toFixed(1)).join(' ')).join('L') + 'Z';
      const d = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates).map((poly) => poly.map(ring).join('')).join('');
      const box = (rows) => { let a = [1e9, 1e9, -1e9, -1e9]; for (const s of rows) for (const poly of (s.g.type === 'Polygon' ? [s.g.coordinates] : s.g.coordinates)) for (const p of poly[0]) { const [x, y] = P(p); a = [Math.min(a[0], x), Math.min(a[1], y), Math.max(a[2], x), Math.max(a[3], y)]; } return a; };
      const b = box(S.zona ? E.filter((s) => s.zona === S.zona) : E), pad = S.zona ? 30 : 6;
      const [ux, uy] = P([-99.2, 30.6]), usa = (D.eric || [])[0];
      const el = svg('svg', { class: 'map', viewBox: `${b[0] - pad} ${b[1] - pad} ${b[2] - b[0] + 2 * pad} ${b[3] - b[1] + 2 * pad}`, role: 'img', 'aria-label': 'Mapa de México por zona: verde fuerte, ámbar presencia débil, rojo sin presencia' },
        E.map((s) => svg('path', { d: d(s.g), fill: COL[(byZ.get(s.zona) || {}).estado] || 'var(--muted)', 'fill-opacity': (!S.zona || s.zona === S.zona ? 1 : 0.3) * tono(byZ.get(s.zona)) }, svg('title', {}, `${s.nombre} · ${(byZ.get(s.zona) || {}).nombre}`))));
      // One bubble per zone, sized by what we sold there this year, with the zone's name and amount beside it.
      const maxV = Math.max(1, ...D.zonas.map((z) => z.ventas)), LADO = { bajio: [-1, -0.9], centro: [-1, 1.5], occidente: [-1, 0.2], golfo: [1, 0.3], pacsur: [0, 1.8], caribe: [0, -1.5], cabos: [-1, 0], noroeste: [0, -1.6], noreste: [1, -0.2] };
      const burbujas = svg('g', { class: 'burb' }, D.zonas.filter((z) => !S.zona || z.zona === S.zona).map((z) => { const [x, y] = P([z.lon, z.lat]), r = z.ventas ? 5 + 17 * Math.sqrt(z.ventas / maxV) : 4, [lx, ly] = LADO[z.zona] || [1, 0];
        const tx = x + lx * (r + 5), ty = y + ly * (r + 6) - (ly < 0 ? 11 : 0) + (ly === 0 ? -2 : 0), anc = lx < 0 ? 'end' : lx > 0 ? 'start' : 'middle';
        return svg('g', { 'data-zona': z.zona, style: 'cursor:pointer' }, svg('circle', { cx: x, cy: y, r, fill: z.ventas ? 'var(--text)' : 'var(--card)', 'fill-opacity': z.ventas ? 0.82 : 1, stroke: z.ventas ? 'var(--card)' : 'var(--text)', 'stroke-width': 1.5 }),
          svg('text', { x: tx, y: ty, 'text-anchor': anc, 'font-size': 10.5, 'font-weight': 700 }, z.nombre.split(' (')[0]),
          svg('text', { x: tx, y: ty + 11, 'text-anchor': anc, 'font-size': 9.5 }, z.ventas ? `${corto(z.ventas)} · ${z.pct_ventas}% de la venta` : `$0 · ${z.peso}% del mercado`),
          svg('title', {}, `${z.nombre}: ${peso(z.ventas)} este año, ${z.clientes_activos} clientes activos` + (z.brecha ? `, brecha ${peso(z.brecha)}` : ''))); }));
      el.append(burbujas);
      // Eric's importer, just north of the border. Not a sales zone: a marker only.
      if (usa && !S.zona) el.append(svg('g', { class: 'usa', 'aria-label': `${usa.cliente}, ${usa.lugar}: ${peso(usa.actual)} este año` }, svg('circle', { cx: ux, cy: uy, r: 7, fill: 'var(--accent)', stroke: 'var(--card)', 'stroke-width': 2 }),
        svg('text', { x: ux + 12, y: uy - 2, 'font-size': 11, 'font-weight': 600, fill: 'var(--text)' }, usa.cliente), svg('text', { x: ux + 12, y: uy + 11, 'font-size': 10, fill: 'var(--muted)' }, `EE. UU. · ${peso(usa.actual)} este año · cuenta de la casa (Tito)`)));
      // Zoom where the pointer is (wheel), with the + and − buttons, and drag to move. A drag does not count as a tap on a zone.
      const base = [b[0] - pad, b[1] - pad, b[2] - b[0] + 2 * pad, b[3] - b[1] + 2 * pad]; let vb = base.slice(), arr = null, movio = false;
      const pon = () => el.setAttribute('viewBox', vb.map((n) => n.toFixed(1)).join(' '));
      const aSvg = (x, y) => { const p = el.createSVGPoint(); p.x = x; p.y = y; const q = p.matrixTransform(el.getScreenCTM().inverse()); return [q.x, q.y]; };
      const zoom = (f, cx = vb[0] + vb[2] / 2, cy = vb[1] + vb[3] / 2) => { const w = Math.min(base[2], Math.max(base[2] / 14, vb[2] * f)), k = w / vb[2]; vb = w >= base[2] ? base.slice() : [cx - (cx - vb[0]) * k, cy - (cy - vb[1]) * k, w, vb[3] * k]; pon(); };
      el.addEventListener('wheel', (ev) => { ev.preventDefault(); zoom(ev.deltaY < 0 ? 0.8 : 1.25, ...aSvg(ev.clientX, ev.clientY)); }, { passive: false });
      el.addEventListener('pointerdown', (ev) => { if (ev.pointerType !== 'mouse' || vb[2] >= base[2]) return; arr = { x: ev.clientX, y: ev.clientY, vb: vb.slice() }; movio = false; });
      el.addEventListener('pointermove', (ev) => { if (!arr) return; const dx = ev.clientX - arr.x, dy = ev.clientY - arr.y; if (Math.abs(dx) + Math.abs(dy) < 4) return; movio = true; el.setPointerCapture(ev.pointerId); el.style.cursor = 'grabbing';
        const k = Math.max(arr.vb[2] / el.clientWidth, arr.vb[3] / el.clientHeight); vb = [arr.vb[0] - dx * k, arr.vb[1] - dy * k, arr.vb[2], arr.vb[3]]; pon(); });
      const suelta = () => { arr = null; el.style.cursor = ''; };
      el.addEventListener('pointerup', suelta); el.addEventListener('pointercancel', suelta);
      el.addEventListener('click', (ev) => { if (movio) { movio = false; return; } const bz = ev.target.closest('[data-zona]'); if (bz) { S.zona = S.zona === bz.dataset.zona ? '' : bz.dataset.zona; pintar(); return; } const i = [...el.children].indexOf(ev.target); if (i >= 0 && E[i]) { S.zona = S.zona === E[i].zona ? '' : E[i].zona; pintar(); } });
      const ctl = h('div', { class: 'mapctl' }, h('button', { type: 'button', 'aria-label': 'Acercar', onclick: () => zoom(0.7) }, '+'), h('button', { type: 'button', 'aria-label': 'Alejar', onclick: () => zoom(1.43) }, '−'),
        h('button', { type: 'button', 'aria-label': 'Ver todo', title: 'Ver todo', onclick: () => { vb = base.slice(); pon(); } }, '⤢'));
      map.replaceChildren(h('div', { class: 'mapbox' }, el, ctl), h('p', { class: 'note', style: 'margin:8px 0 0' }, S.zona ? h('button', { class: 'chip', onclick: () => { S.zona = ''; pintar(); } }, '← Ver todo México') : 'Verde: zona fuerte. Ámbar: presencia débil. Rojo: sin presencia; más oscuro mientras más mercado estamos dejando. El círculo es lo vendido este año. Toca una zona para ver sus prospectos; ' + (ancho() ? 'acerca con la rueda del ratón o con + y −.' : 'acerca con + y − y arrastra para moverte.')));
    }).catch(() => map.replaceChildren(h('p', { class: 'note' }, 'No se pudo cargar el mapa.')));
    const ord = new Map(D.zonas.map((z, i) => [z.zona, i])), kO = { dist: 0, tienda: 1, horeca: 2, cliente: 3 };
    const base = D.prospectos.filter((p) => !S.zona || p.zona === S.zona), nA = (a) => base.filter((p) => p.avance === a).length;
    const AV = { 'En proceso': 'warn', Rechazado: 'bad', 'Por contactar': 'mute', 'Sin contactar': 'mute' };
    const av = (p) => pill(p.clase === 'cliente' && !p.de_carlos ? p.estado : p.avance, p.clase === 'cliente' && !p.de_carlos ? 'ok' : AV[p.avance]);
    const cuando = (p) => (p.ultimo_contacto ? `${dia(p.ultimo_contacto)} (hace ${p.dias} días) · ${p.contacto_por}` : 'Nunca contactado');
    const tocar = (p) => registrar({ cuenta: p.nombre, actividad: 'Prospección', ultimo_contacto: p.ultimo_contacto, dias_sin_contacto: p.dias, ultima_nota: [p.status, p.paso, p.siguiente].filter(Boolean).join(' · '), persona: S.persona || D.yo.persona || 'Tito' });
    const okAv = (p) => (!S.avance || (S.avance === 'nunca' ? !p.ultimo_contacto : S.avance === 'frio' ? p.avance !== 'Rechazado' && p.dias > 30 : p.avance === S.avance));
    const pros = D.prospectos.filter((p) => okAv(p) && (!S.zona || p.zona === S.zona) && (!S.clase || p.clase === S.clase || (S.clase === 'dist' && /distribu/i.test(p.tipo)) || (S.clase === 'tienda' && /retail|tienda/i.test(p.tipo))))
      .sort((a, b) => (ord.get(a.zona) - ord.get(b.zona)) || (kO[a.clase] - kO[b.clase]));
    return h('div', {},
      cur ? h('h2', {}, cur.nombre) : null,
      h('div', { class: 'mapwide' }, map),
      h('div', {},
      cur ? h('div', { class: 'card' }, h('div', { class: 'name' }, cur.nombre, pill(cur.estado, K[cur.estado])), h('p', {}, `${cur.peso}% del mercado y ${cur.pct_ventas}% de nuestras ventas: ${peso(cur.ventas)} este año con ${cur.clientes_activos} clientes activos. ` + (cur.brecha ? `Al ritmo de Caribe vendería ${peso(cur.potencial)}; la brecha es ${peso(cur.brecha)}.` : 'Va al ritmo de nuestras mejores zonas.')), h('p', { class: 'note' }, cur.distribuidores || 'Sin distribuidor'), h('p', { class: 'note' }, prosZ(cur))) : null,
      !cur ? [h('h2', {}, 'Ranking de oportunidad'),
        h('div', { class: 'card' }, lista('rank', D.zonas, 9, (z) => h('li', { onclick: () => { S.zona = z.zona; pintar(); window.scrollTo(0, 0); }, style: 'cursor:pointer' },
          h('div', { class: 'l1' }, h('span', {}, `${z.brecha ? D.zonas.indexOf(z) + 1 + '. ' : ''}${z.nombre}`), pill(z.estado, K[z.estado])),
          h('div', { class: 'l2' }, `${z.peso}% del mercado · ${peso(z.ventas)} vendidos · ` + (z.brecha ? `brecha ${peso(z.brecha)}` : 'sin brecha')),
          h('div', { class: 'l2' }, z.distribuidores || 'Sin distribuidor'), h('div', { class: 'l2' }, prosZ(z))), 'Sin zonas.',
          [{ t: 'Zona', v: (z) => h('button', { class: 'linkb', onclick: () => { S.zona = z.zona; pintar(); window.scrollTo(0, 0); } }, z.nombre), s: (z) => z.nombre, cls: 'b' },
            { t: 'Estado', v: (z) => pill(z.estado, K[z.estado]), s: (z) => z.estado, cls: 'nw' }, { t: '% del mercado', v: (z) => z.peso + '%', s: (z) => z.peso, num: true },
            { t: 'Vendido este año', v: (z) => peso(z.ventas), s: (z) => z.ventas, num: true }, { t: 'Potencial', v: (z) => peso(z.potencial), s: (z) => z.potencial, num: true },
            { t: 'Brecha', v: (z) => (z.brecha ? peso(z.brecha) : 'sin brecha'), s: (z) => z.brecha, num: true }, { t: 'Clientes activos', v: (z) => z.clientes_activos, s: (z) => z.clientes_activos, num: true },
            { t: 'Prospectos trabajados', v: (z) => `${z.prospectos - z.sin_contactar} de ${z.prospectos}`, s: (z) => (z.prospectos ? (z.prospectos - z.sin_contactar) / z.prospectos : 0), num: true },
            { t: 'Último contacto a un prospecto', v: (z) => (z.ultimo_prospecto ? dia(z.ultimo_prospecto) : 'Nunca'), s: (z) => z.ultimo_prospecto || null, cls: 'nw' },
            { t: 'Distribuidores', v: (z) => z.distribuidores || 'Sin distribuidor', largo: true }]))] : null),
      !cur && (D.eric || []).length ? [h('h2', {}, 'Fuera de México'), h('div', { class: 'card' }, h('ul', { class: 'rows' }, D.eric.map((e) => h('li', {},
        h('div', { class: 'l1' }, h('span', {}, `${e.cliente} · ${e.lugar}`), h('span', {}, peso(e.actual))),
        h('div', { class: 'l2' }, `Cuenta de la casa: sus ventas cuentan para Tito, no para un vendedor. ${peso(e.pasado_mp)} a la misma fecha del año pasado · ${e.pedidos_12m} pedidos en 12 meses · último ${dia(e.ultima)}.`)))))] : null,
      h('h2', {}, 'Prospectos'),
      h('p', { class: 'note' }, `${base.length} en la lista: ${nA('En proceso')} en proceso, ${nA('Sin contactar') + nA('Por contactar')} sin contactar, ${nA('Rechazado')} rechazados. Incluye la lista de distribuidores de Carlos (su archivo del 21 de noviembre) y lo registrado en Spark. Toca uno para registrar un contacto.`),
      h('div', { class: 'toolbar' }, chips([['', 'Todos'], ['dist', 'Distribuidores'], ['tienda', 'Tiendas'], ['horeca', 'Restaurantes y hoteles'], ['cliente', 'Clientes actuales']], S.clase, (v) => { S.clase = v; }),
        h('select', { 'aria-label': 'Avance', onchange: (e) => { S.avance = e.target.value; pintar(); } }, [['', 'Cualquier avance'], ['En proceso', 'En proceso'], ['nunca', 'Sin contactar'], ['frio', 'Contactados hace más de 30 días'], ['Rechazado', 'Rechazados']].map(([v, t]) => h('option', { value: v, selected: (S.avance || '') === v }, t)))),
      h('div', { class: 'card', style: 'margin-top:8px' }, lista('pros', pros, 10, (p) => h('li', toca(() => tocar(p)),
        h('div', { class: 'l1' }, h('span', {}, p.nombre), av(p)),
        h('div', { class: 'l2' }, [S.zona ? null : (byZ.get(p.zona) || {}).nombre, p.tipo, p.ciudades].filter(Boolean).join(' · ')),
        p.razon ? h('div', { class: 'l2' }, p.razon) : null,
        p.status || p.paso ? h('div', { class: 'l2' }, [p.status, p.paso].filter(Boolean).join(' · ')) : null,
        p.contacto || p.telefono || p.email ? h('div', { class: 'l2' }, [p.contacto, p.telefono, p.email].filter(Boolean).join(' · ')) : null,
        h('div', { class: 'l2' }, cuando(p), p.siguiente ? ` · Siguiente: ${p.siguiente}` : '', p.fuente ? [' · ', h('a', { href: p.fuente, target: '_blank', rel: 'noopener' }, 'fuente')] : null)), 'Sin prospectos con este filtro.',
        [{ t: 'Prospecto', v: (p) => [p.fuente ? h('a', { href: p.fuente, target: '_blank', rel: 'noopener' }, p.nombre) : p.nombre, h('div', { class: 'note' }, [p.tipo, p.ciudades].filter(Boolean).join(' · '))], s: (p) => p.nombre.toLowerCase(), cls: 'b' },
          !S.zona && { t: 'Zona', v: (p) => (byZ.get(p.zona) || {}).nombre, s: (p) => p.zona },
          { t: 'Avance', v: av, s: (p) => p.avance, cls: 'nw' },
          { t: 'Último contacto', v: cuando, s: (p) => p.ultimo_contacto || null, cls: 'nw' },
          { t: 'Qué pasó', v: (p) => [p.status, p.paso].filter(Boolean).join(' · ') || p.razon || '—', largo: true },
          { t: 'Siguiente', v: (p) => p.siguiente || '—', largo: true },
          { t: 'Contacto', v: (p) => [p.contacto, p.telefono, p.email].filter(Boolean).join(' · ') || '—', cls: 'mut' }], tocar)),
      h('p', { class: 'note' }, 'El peso de cada zona es una estimación: 65% economía (PIB estatal, INEGI) y 35% turismo (cuartos de hotel, DataTur). Ventas facturadas en Zoho a clientes de Carlos y José Luis.'));
  },

  // KPIs: each person against the scoreboard of the June 2026 KPI documents. An estimate: what Spark can measure is
  // scored, what it cannot (by-the-glass placements, key-account wins, brand events) is shown as not measured.
  kpis() {
    const Y = D.hoy.slice(0, 4), mH = Number(D.hoy.slice(5, 7)), dH = Number(D.hoy.slice(8)), dMes = new Date(Number(Y), mH, 0).getDate();
    const venta = (p) => neto(sumar(D.ordenes.filter((o) => o.vendedor === p && o.fecha.slice(0, 4) === Y), (o) => o.total));
    const meta = (p) => { const M = (D.presupuesto.meses || {})[p]; return M && M.length === 12 ? Math.round(sumar(M.slice(0, mH - 1), (x) => x) + M[mH - 1] * dH / dMes) : 0; };
    const F = (D.cobranza || {}).facturas || [], saldo = (L) => sumar(L, (f) => f.saldo);
    const cartera = (L) => { const t = saldo(L); return t ? Math.round(saldo(L.filter((f) => (f.dias || 0) <= 30)) / t * 100) : 100; };
    const fila = (k, peso_, res, pts, nota) => h('div', { class: 'kp' }, h('div', {}, h('b', {}, k), nota ? h('span', {}, nota) : null), h('em', {}, peso_ + '%'), h('div', { class: 'kr' }, res), h('div', { class: 'kpt' }, pts == null ? pill('Sin dato', 'mute') : h('b', { class: pts / peso_ >= .9 ? 'up' : pts / peso_ >= .6 ? '' : 'down' }, pts.toFixed(0))));
    const tarjeta = (p, rol, filas, filtros) => { const med = filas.filter((f) => f[3] != null), pts = sumar(med, (f) => f[3]), pesoMed = sumar(med, (f) => f[1]);
      return h('section', { class: 'card' }, h('div', { class: 'name' }, p, pill(`${Math.round(pts)} de 100 · estimado`, pts >= 80 ? 'ok' : pts >= 60 ? 'warn' : 'bad')), h('p', { class: 'note' }, rol + (pesoMed < 100 ? ` · Spark mide ${pesoMed}% del tablero; lo demás cuenta cero hasta que haya dato.` : '')),
        h('div', { class: 'kp kph' }, h('div', {}, 'Indicador'), h('em', {}, 'Peso'), h('div', { class: 'kr' }, 'Resultado'), h('div', { class: 'kpt' }, 'Puntos')), filas.map((f) => fila(...f)),
        filtros ? [h('h3', {}, 'Filtros para cobrar el variable'), h('ul', { class: 'foco' }, filtros.map(([ok, t, d]) => h('li', { class: ok ? 'bien' : 'cliente' }, h('b', {}, (ok ? 'Cumple · ' : 'No cumple · ') + t), d ? h('span', {}, d) : null)))] : null); };
    const cap = (x) => Math.max(0, Math.min(1, x));
    const ejecutivo = (p) => { const v = venta(p), m = meta(p), pc = m ? v / m : 0, e = (D.crecimiento || []).find((x) => x.persona === p) || { nuevos: [] }, cal = e.nuevos.filter((c) => neto(c.monto) >= 3500).length;
      const mios = F.filter((f) => f.vendedor === p), venc = mios.filter((f) => (f.dias || 0) > 30), g = regla48(p);
      return tarjeta(p, 'Ejecutivo comercial', [['Ingresos contra presupuesto', 70, `${peso(v)} de ${peso(m)} a la fecha (${Math.round(pc * 100)}%)`, 70 * cap(pc)],
        ['Cuentas nuevas calificadas', 15, `${cal} del año con $3,500 o más`, null, 'El documento no fija meta mensual; falta definirla.'], ['Copeos activos (VPC)', 15, 'El CRM todavía no registra copeos', null]],
        [[!venc.length, 'Cartera al corriente', venc.length ? `${peso(saldo(venc))} con más de 30 días de vencido en ${new Set(venc.map((f) => f.cliente)).size} clientes` : ''], [g.cumple, 'Registro en CRM dentro de 48 horas', g.sin == null ? 'Sin ningún registro' : `Último registro hace ${g.sin} días`]]); };
    const director = (p) => { const vs = vendedores(), v = sumar(vs, venta), m = sumar(vs, meta), pc = m ? v / m : 0, ct = cartera(F), dist = (D.distribuidores || []).filter((d) => /compr|activo|catalog/i.test(d.estado || d.status || '')).length;
      return tarjeta(p + ' · Dirección comercial', 'Director comercial', [['Venta del equipo contra presupuesto', 35, `${peso(v)} de ${peso(m)} (${Math.round(pc * 100)}%)`, 35 * cap(pc)],
        ['Distribuidores activados y recomprando', 25, `${dist} de ${(D.distribuidores || []).length} prospectados con compra`, 0, 'Solo cuenta con 2 pedidos o más y 5 cuentas activas. Ninguno llega todavía.'],
        ['Cuentas clave ganadas', 20, 'Spark no las registra todavía', null], ['Cartera del equipo al corriente', 10, `${ct}% al corriente (meta 90%)`, 10 * cap(ct / 90)],
        ['Productividad por ejecutivo', 5, `${Math.round(pc * 100)}% del presupuesto por persona`, 5 * cap(pc)], ['Apoyo en construcción de marca', 5, 'Spark no lo registra todavía', null]]); };
    const embajador = (p) => tarjeta(p, 'Embajador de marca', [['Mantener catalogación y recompra', 50, 'Falta el reporte de venta por cuenta del distribuidor', null], ['Catalogaciones nuevas con pedido', 20, 'Sin dato', null], ['Colocaciones a copeo', 15, 'Sin dato', null], ['Mezcla premium', 5, 'Sin dato', null], ['Tasa de resurtido', 5, 'Sin dato', null], ['Apoyo en construcción de marca', 5, 'Sin dato', null]],
      [[regla48(p).cumple, 'Registro en CRM dentro de 48 horas', '']]);
    const ps = personas().filter((p) => p !== 'Tito');
    return h('div', {}, h('p', { class: 'note' }, 'Estimado con los tableros de junio de 2026. Ventas del año a la fecha, antes de impuestos. No sustituye el cálculo de comisiones.'),
      h('div', { class: 'grid3' }, ps.flatMap((p) => (p === 'Daniel' ? [embajador(p)] : p === 'Carlos' ? [director(p), ejecutivo(p)] : [ejecutivo(p)]))));
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
      const st = (k, t) => { const s = D.sync[k]; return h('li', {}, h('div', { class: 'l1' }, h('span', {}, t), pill(!s ? 'Nunca' : s.ok ? 'Bien' : 'Falló', !s ? 'mute' : s.ok ? 'ok' : 'bad')), h('div', { class: 'l2' }, !s ? 'Todavía no corre.' : new Date(s.at).toLocaleString('es-MX') + (s.error ? ' · ' + s.error : s.skipped ? ' · ' + s.skipped : s.rows != null ? ` · ${s.rows} renglones` : s.escritas != null ? ` · ${s.escritas} nuevas` + (s.faltan ? `, faltan ${s.faltan}` : '') : ` · ${s.orders} órdenes, ${s.invoices} facturas` + (s.pending ? ' (todavía cargando el histórico)' : '') + (s.aviso ? ' · ' + s.aviso : '')))); };
      box.replaceChildren(
        h('h2', {}, 'Datos'), h('div', { class: 'card' }, h('ul', { class: 'rows' }, st('hoja', 'Hoja del CRM (diario, 6:00)'), st('zoho', 'Zoho (6:00, 12:00 y 18:00)'), st('ia', 'Siguientes pasos sugeridos (Claude)')),
          r.correo_hoja && !(D.sync.hoja && D.sync.hoja.ok) ? h('p', { class: 'note' }, 'La hoja del CRM debe estar compartida (lector) con ', h('b', {}, r.correo_hoja), '.') : null,
          h('button', { class: 'btn', style: 'margin-top:8px;width:100%', onclick: async (ev) => { ev.target.disabled = true; ev.target.textContent = 'Sincronizando…'; await api('api/admin/sync', {}); await cargar(); } }, 'Sincronizar ahora')),
        h('h2', {}, 'Quién ve qué'), h('p', { class: 'note' }, 'Todos ven los números del equipo; cada quien abre en los suyos. Efectividad y Ajustes solo los ven los administradores. Liga aquí el correo con el que entra al Hub.'),
        h('div', { class: 'card' }, r.people.length ? h('ul', { class: 'rows' }, r.people.map((p) => h('li', {}, h('div', { class: 'l1' }, h('span', {}, p.email), h('button', { class: 'chip', onclick: async () => { await api('api/admin/people', { email: p.email, borrar: true }); pintar(); } }, 'Quitar')), h('div', { class: 'l2' }, p.rol === 'admin' ? 'Administrador' : p.persona)))) : h('p', { class: 'note' }, 'Nadie dado de alta todavía.'), f));
    });
    return box;
  }
};

Object.assign(VISTAS, MAS_VISTAS);

let _estados = null;
const estados = () => (_estados ||= fetch('estados.json').then((r) => r.json()).then((rows) => rows.map((s) => ({ ...s, g: JSON.parse(s.geom) }))));
async function api(path, body) {
  const r = await fetch(path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
  return r.json().catch(() => ({ error: 'Respuesta inválida' }));
}

function pintar() {
  const admin = D.yo.admin, wide = ancho(), yo = PANT.get(S.vista) || PANT.get('hoy');
  const nPend = sinLeer();
  const visibles = GRUPOS.map(([g, L]) => [g, L.filter((x) => !x[3] || admin)]).filter(([, L]) => L.length);
  const boton = ([v, t, , , prox]) => h('button', { 'aria-current': v === S.vista ? 'page' : null, onclick: () => ir(v) }, h('span', {}, t),
    v === 'buzon' && nPend ? h('span', { class: 'cnt', 'aria-label': `${nPend} sin responder` }, nPend) : prox ? h('span', { class: 'soon' }, 'Pronto') : null);
  $('titulo').textContent = yo[2];
  $('sub').textContent = new Date(D.hoy + 'T12:00:00').toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });
  $('who').replaceChildren(...(!SIN_FILTRO.includes(S.vista) ? [['', 'Equipo'], ['José Luis', 'José Luis'], ['Carlos', 'Carlos'], ['Daniel', 'Daniel'], ['Tito', 'Tito · casa']].map(([v, t]) =>
    h('button', { class: 'chip', 'aria-pressed': String(S.persona === v), onclick: () => { S.persona = v; pintar(); } }, t)) : []));
  $('nuevo').hidden = !(D.yo.persona || admin) || !['hoy', 'semanas', 'seguimiento'].includes(S.vista);
  $('nav').replaceChildren(...visibles.flatMap(([g, L]) => [h('h3', {}, g), ...L.map(boton)]));
  $('me').textContent = (D.yo.nombre || '') + (admin ? ' · administrador' : D.yo.persona ? ' · ' + D.yo.persona : '');
  // Phone: one ribbon with every screen, most used first; it scrolls sideways and keeps the current one in view.
  const CORTO = { semanas: 'Semanas', ventas: 'Ventas', copeo: 'Copeo', zonas: 'Zonas', estrategia: 'Estrategia', materiales: 'Materiales' };
  const todas = visibles.flatMap(([, L]) => L), cinta = [...ABAJO.map((v) => PANT.get(v)), ...todas.filter((x) => !ABAJO.includes(x[0]))];
  $('tabs').replaceChildren(...cinta.map(([v, t]) => h('button', { 'aria-current': v === S.vista ? 'page' : null, onclick: () => ir(v) }, CORTO[v] || t, v === 'buzon' && nPend ? h('span', { class: 'cnt' }, nPend) : null)));
  if (!wide) { const act = $('tabs').querySelector('[aria-current]'); if (act) $('tabs').scrollLeft = Math.max(0, act.offsetLeft - ($('tabs').clientWidth - act.offsetWidth) / 2); }
  $('main').replaceChildren((VISTAS[S.vista] || VISTAS.hoy)());
}
$('sheet').addEventListener('click', (ev) => { if (ev.target === $('sheet')) $('sheet').hidden = true; });
$('nuevo').addEventListener('click', () => registrar({}));

// One dialog for every form in the app. campos: [{ k, t, tipo: text|textarea|select|date|number|email, ops, v, req, ph, mitad }].
// guardar(values) returns an error message, or nothing when it worked.
function formulario(titulo, campos, guardar, nota, boton = 'Guardar') {
  const d = $('dlg'), err = h('span', { class: 'err', role: 'alert' });
  const campo = (c) => { if (c.el) return c.el; const a = { name: c.k, required: !!c.req, placeholder: c.ph || null, autofocus: c.foco ? '' : null };
    const el = c.tipo === 'textarea' ? h('textarea', a, c.v || '') : c.tipo === 'select' ? h('select', a, c.ops.map((o) => { const [v, t] = Array.isArray(o) ? o : [o, o]; return h('option', { value: v, selected: String(c.v ?? '') === String(v) }, t); }))
      : h('input', { ...a, type: c.tipo || 'text', value: c.v ?? null, min: c.tipo === 'number' ? 0 : null, inputmode: c.tipo === 'number' ? 'numeric' : c.k === 'telefono' ? 'tel' : null, max: c.max || null });
    if (c.lista) { el.setAttribute('list', 'dl-' + c.k); el.setAttribute('autocomplete', 'off'); return h('label', {}, c.t, el, h('datalist', { id: 'dl-' + c.k }, c.lista.map((x) => h('option', { value: x })))); }
    return h('label', {}, c.t, el); };
  const filas = []; for (let i = 0; i < campos.length; i++) { const c = campos[i]; if (c.mitad && campos[i + 1] && campos[i + 1].mitad) { filas.push(h('div', { class: 'dos' }, campo(c), campo(campos[++i]))); } else filas.push(campo(c)); }
  const f = h('form', { method: 'dialog', onsubmit: async (ev) => { ev.preventDefault(); const b = f.querySelector('.btn:not(.sec)'); b.disabled = true; err.textContent = '';
      const e = await guardar(Object.fromEntries(new FormData(f))).catch((x) => String(x.message || x)); b.disabled = false; if (e) { err.textContent = e; return; } d.close(); } },
    h('h2', { id: 'dlg-t' }, titulo), nota ? h('p', { class: 'dnote' }, nota) : null, filas,
    h('div', { class: 'pie' }, err, h('button', { type: 'button', class: 'btn sec', onclick: () => d.close() }, 'Cancelar'), h('button', { class: 'btn' }, boton)));
  d.replaceChildren(f); d.showModal();
}
const enviar = async (url, body) => { const r = await api(url, body); if (r.error) return r.error; await cargar(); };
// Every account name the app knows: Zoho clients, accounts with logged contacts, prospects and accounts created here.
const todasLasCuentas = () => { const m = new Map(); for (const n of [...D.directorio.map((d) => d.nombre), ...D.seguimiento.map((r) => r.cuenta), ...D.prospectos.map((p) => p.nombre)]) { const k = n.trim().toLowerCase(); if (k && !m.has(k)) m.set(k, n.trim()); }
  return [...m.values()].sort((a, b) => a.localeCompare(b)); };
const plano = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
const TIPOS_CUENTA = ['Restaurante', 'Hotel', 'Tienda', 'Distribuidor', 'Bar', 'Evento / catering', 'Particular'];
// The fields a new account needs: what it is, where, and one way to reach someone there.
const camposNueva = (pre = {}) => h('div', { class: 'nueva' },
  h('div', { class: 'dos' }, h('label', {}, 'Tipo', h('select', { name: 'n_tipo' }, TIPOS_CUENTA.map((t) => h('option', { value: t, selected: pre.tipo === t }, t)))),
    h('label', {}, 'Zona', h('select', { name: 'n_zona' }, [h('option', { value: '' }, 'Elige la zona'), ...D.zonas.map((z) => h('option', { value: z.zona, selected: pre.zona === z.zona }, z.nombre.split(' (')[0]))]))),
  h('div', { class: 'dos' }, h('label', {}, 'Ciudad', h('input', { name: 'n_ciudad', placeholder: 'San Miguel de Allende' })), h('label', {}, 'Persona de contacto', h('input', { name: 'n_contacto', placeholder: 'Nombre y puesto' }))),
  h('div', { class: 'dos' }, h('label', {}, 'Teléfono o WhatsApp', h('input', { name: 'n_telefono', inputmode: 'tel' })), h('label', {}, 'Correo', h('input', { name: 'n_email', type: 'email' }))),
  h('p', { class: 'dnote', style: 'margin:0' }, 'Teléfono o correo: al menos uno.'));
// Account field for the contact form: type to search; the first choice is always "Nueva cuenta", which opens the new-account fields.
function selectorCuenta() {
  const todas = todasLasCuentas(), claves = new Set(todas.map(plano)); let nueva = false;
  const inp = h('input', { name: 'cuenta', required: true, autocomplete: 'off', placeholder: 'Escribe el nombre del cliente o prospecto', 'aria-label': 'Cuenta' });
  const sug = h('div', { class: 'sugs', role: 'listbox' }), extra = h('div', { hidden: true });
  const elegir = (n) => { inp.value = n; nueva = false; extra.hidden = true; extra.replaceChildren(); sug.replaceChildren(); };
  const abrirNueva = () => { nueva = true; sug.replaceChildren(); extra.replaceChildren(h('p', { class: 'dnote', style: 'margin:0 0 6px' }, h('b', {}, 'Cuenta nueva. '), 'Queda en el Directorio y en su zona del mapa.'), camposNueva()); extra.hidden = false; if (!inp.value.trim()) inp.focus(); };
  const pinta = () => { const q = plano(inp.value); if (nueva) { return; }
    const hits = q ? todas.filter((n) => plano(n).includes(q)).slice(0, 7) : [];
    sug.replaceChildren(h('button', { type: 'button', class: 'opc nueva', onclick: abrirNueva }, h('b', {}, '＋ Nueva cuenta'), q && !claves.has(q) ? h('span', {}, ` · dar de alta "${inp.value.trim()}"`) : null),
      ...hits.map((n) => h('button', { type: 'button', class: 'opc', onclick: () => elegir(n) }, n))); };
  inp.addEventListener('input', () => { if (nueva && claves.has(plano(inp.value))) { nueva = false; extra.hidden = true; extra.replaceChildren(); } pinta(); });
  inp.addEventListener('focus', pinta);
  return { el: h('div', { class: 'pick' }, h('label', {}, 'Cuenta', inp), sug, extra), nueva: () => nueva, existe: (n) => claves.has(plano(n)) };
}
// A new account on its own, with no contact to log yet (a lead someone passed along).
function nuevaCuenta(pre = {}) {
  const todas = todasLasCuentas(), aviso = h('p', { class: 'dnote', style: 'margin:0' });
  const inp = h('input', { name: 'nombre', required: true, autocomplete: 'off', placeholder: 'Nombre del negocio', oninput: () => { const q = plano(inp.value), p = q.length >= 3 ? todas.filter((n) => plano(n).includes(q)).slice(0, 3) : []; aviso.textContent = p.length ? 'Ya existe algo parecido: ' + p.join(' · ') : ''; } });
  formulario(pre.titulo || 'Nueva cuenta', [{ el: h('div', {}, h('label', {}, 'Nombre', inp), aviso) }, D.yo.admin ? { k: 'persona', t: 'La lleva', tipo: 'select', ops: ['José Luis', 'Carlos', 'Daniel', ['Tito', 'Tito (casa)']], v: S.persona || D.yo.persona || 'Tito' } : null, { el: camposNueva(pre) }].filter(Boolean),
    async (v) => { const r = await api('api/cuenta/nueva', { nombre: v.nombre, tipo: v.n_tipo, zona: v.n_zona, ciudad: v.n_ciudad, contacto: v.n_contacto, telefono: v.n_telefono, email: v.n_email, persona: v.persona }); if (r.error) return r.error; await cargar(); },
    'Para un prospecto que todavía no compra. Queda en el Directorio y en su zona; el primer contacto se registra después.', 'Crear cuenta');
}
// Log a contact from the app. It lands in the same table the CRM sheet feeds, so it shows up everywhere at once.
// pre: { cuenta, persona, ultimo_contacto, dias_sin_contacto, ultima_nota, sugerencia, pausa } when opened from an account row.
function registrar(pre) {
  const quien = pre.persona || S.persona || D.yo.persona || 'Tito', cuentas = [...new Set(D.seguimiento.map((r) => r.cuenta))].sort((a, b) => a.localeCompare(b));
  const hoy = D.hoy || new Date(Date.now() - 6 * 3600e3).toISOString().slice(0, 10);
  const antes = pre.ultimo_contacto ? `Último contacto registrado: ${dia(pre.ultimo_contacto)} (hace ${pre.dias_sin_contacto} días).` + (pre.ultima_nota ? ' "' + pre.ultima_nota.slice(0, 180) + '"' : '') : pre.cuenta ? 'Sin contacto registrado todavía.' : '';
  const pick = pre.cuenta ? null : selectorCuenta();
  formulario(pre.cuenta || 'Registrar contacto', [
    D.yo.admin ? { k: 'persona', t: 'A nombre de', tipo: 'select', ops: ['José Luis', 'Carlos', 'Daniel', ['Tito', 'Tito (casa: Eric y Diane)']], v: quien } : null,
    pre.cuenta ? null : { el: pick.el },
    { k: 'fecha', t: 'Cuándo fue', tipo: 'date', v: hoy, max: hoy, req: true, mitad: true },
    { k: 'medio', t: 'Cómo', tipo: 'select', ops: ['Presencial', 'Llamada', 'WhatsApp', 'Correo'], v: 'Presencial', mitad: true },
    { k: 'resultado', t: 'Qué pasó', tipo: 'textarea', req: true, foco: !!pre.cuenta, ph: 'Con quién hablaste, qué dijeron, qué quedó pendiente' },
    { k: 'siguiente_paso', t: 'Siguiente paso', ph: pre.sugerencia ? pre.sugerencia.slice(0, 90) : 'Lo que vas a hacer después', mitad: true },
    { k: 'proximo', t: 'Próximo contacto', tipo: 'date', mitad: true },
    { k: 'actividad', t: 'Qué fue', tipo: 'select', ops: ['Seguimiento', 'Prospección', 'Cata / prueba de vino', 'Cobranza', 'Entrega', 'Capacitación', 'Evento', 'Presencia de marca'], v: pre.actividad || 'Seguimiento', mitad: true },
    { k: 'pausa', t: 'Envíos pausados por cobranza', tipo: 'select', ops: [['', pre.pausa ? 'Siguen pausados' : 'No'], pre.pausa ? ['no', 'Ya no, se reanudaron'] : ['si', 'Sí, pausados hasta que paguen']], v: '', mitad: true },
    { k: 'minutos', t: 'Tiempo que te tomó (minutos)', tipo: 'number', ph: 'Con el traslado', max: 600, mitad: true },
    { k: 'botellas_mes', t: 'Botellas al mes que podría comprar', tipo: 'number', ph: 'Tu estimado', mitad: true },
    { k: 'etapa', t: 'Etapa de la cuenta', tipo: 'select', ops: [['', 'Sin cambio'], 'Contacto inicial', 'En proceso', 'Catalogado', 'Compra regular'], v: '' },
  ].filter(Boolean), async (v) => {
    // A new account is created first; then the contact is logged against it.
    if (pick && pick.nueva()) { const r = await api('api/cuenta/nueva', { nombre: v.cuenta, tipo: v.n_tipo, zona: v.n_zona, ciudad: v.n_ciudad, contacto: v.n_contacto, telefono: v.n_telefono, email: v.n_email, persona: v.persona || quien }); if (r.error) return r.error; }
    else if (pick && !pick.existe(v.cuenta)) return 'Elige una cuenta de la lista, o toca "Nueva cuenta" para darla de alta.';
    return enviar('api/actividad', { ...v, cuenta: pre.cuenta || v.cuenta, persona: v.persona || quien, contacto: v.n_contacto || '', telefono: v.n_telefono || '' });
  }, [antes, pre.pausa ? 'Envíos pausados por cobranza: igual toca contactarlos, para cobrar y para que vuelvan a pedir.' : ''].filter(Boolean).join(' ') || 'Queda guardado en Spark.');
}

async function cargar() {
  const r = await fetch('api/data'), j = await r.json().catch(() => ({ error: 'No se pudo leer la respuesta' }));
  if (!r.ok) { $('main').replaceChildren(h('div', { class: 'alert' }, j.error || 'No se pudo cargar.')); return; }
  if (!D && j.yo.persona && !j.yo.admin) S.persona = j.yo.persona;   // a rep opens on their own numbers; Equipo is one tap away
  D = j; deHash(); pintar();
}
cargar().catch(() => $('main').replaceChildren(h('div', { class: 'alert' }, 'Sin conexión. Vuelve a intentar.')));
