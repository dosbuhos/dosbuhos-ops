// Reservaciones — phone app. Two screens: the week's reservations as a manifest, and Parrot's sales. Each screen is one
// GET and the page repaints from it. The address says where you are (#r/2026-11-23, #v/semana/2026-11-16), so reload,
// back and a shared link all land on the same place. Everything a guest or the point of sale typed is escaped.
import { columnas, tendencia, ritmo, pesosCorto } from './graficas.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const main = $('#main');

// ---------- Words, dates, money ----------
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MES_C = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const DIA_C = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const SM = 6 * 3_600_000;                                   // San Miguel de Allende is UTC-6 all year
let HOY = new Date(Date.now() - SM).toISOString().slice(0, 10);   // replaced by the server's "today" with every answer
const hoyLocal = () => HOY;
const DEV_HOY = new URLSearchParams(location.search).get('hoy');       // local dev only: the Worker ignores it in production
const pf = (f) => { const [y, m, d] = f.split('-').map(Number); return { y, m, d, w: new Date(Date.UTC(y, m - 1, d)).getUTCDay() }; };
const sumar = (f, n) => new Date(Date.parse(`${f}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const lunesDe = (f) => sumar(f, -((pf(f).w + 6) % 7));
const mayus = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const anio = (f) => (pf(f).y === pf(hoyLocal()).y ? '' : ` ${pf(f).y}`);
const fLargo = (f) => { const p = pf(f); return `${DIAS[p.w]} ${p.d} de ${MESES[p.m - 1]}${anio(f)}`; };
const fCorto = (f) => { const p = pf(f); return `${DIA_C[p.w]} ${p.d} ${MES_C[p.m - 1]}${anio(f)}`; };
const fDiaMes = (f) => { const p = pf(f); return `${p.d} ${MES_C[p.m - 1]}`; };
const rangoTxt = (a, b) => { const x = pf(a), y = pf(b); return x.m === y.m ? `${x.d} – ${y.d} ${MES_C[y.m - 1]}${anio(b)}` : `${x.d} ${MES_C[x.m - 1]} – ${y.d} ${MES_C[y.m - 1]}${anio(b)}`; };
const horaDe = (ms) => new Date(ms - SM).toISOString().slice(11, 16);
const fechaDe = (ms) => new Date(ms - SM).toISOString().slice(0, 10);
const num = (n) => Number(n).toLocaleString('es-MX');
const pesos = (minor) => `$${Math.round(minor / 100).toLocaleString('es-MX')}`;
const cuantos = (n, uno, varios) => `${num(n)} ${n === 1 ? uno : varios}`;
const hace = (ms) => { const m = Math.max(0, Math.round((Date.now() - ms) / 60_000)); return m < 1 ? 'hace un momento' : m < 60 ? `hace ${m} min` : m < 1440 ? `hace ${Math.round(m / 60)} h` : `hace ${Math.round(m / 1440)} días`; };
const duracion = (ms) => { const m = Math.round(ms / 60_000); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`; };
const SD = '<span class="sd">sin dato</span>';

const ic = (d, extra = '') => `<svg viewBox="0 0 24 24" aria-hidden="true"${extra}>${d}</svg>`;
const IC = {
  mesa: ic('<path d="M5 20a7 7 0 0 1 14 0z" transform="translate(0 -3)"/><path d="M3 20h18M12 9.500V8M10 6.500h4"/>'),
  ventas: ic('<path d="M5 20V11M10 20V5M15 20v-6M20 20V8"/>'),
  abajo: ic('<path d="M6 9l6 6 6-6"/>', ' class="gira"'),
  circulo: ic('<circle cx="12" cy="12" r="7.500"/>'),
  palomita: ic('<path d="M5 12.500l4.500 4.500L19 7.500"/>'),
  equis: ic('<path d="M6.500 6.500l11 11M17.500 6.500l-11 11"/>'),
  alerta: ic('<path d="M12 7v6M12 16.800v.2"/><circle cx="12" cy="12" r="8.500"/>'),
  reloj: ic('<circle cx="12" cy="12" r="8.500"/><path d="M12 7.500V12l3 2"/>'),
  punto: ic('<circle cx="12" cy="12" r="4" fill="currentColor"/>'),
  tel: ic('<path d="M6.500 4h3l1.500 4-2 1.500a11 11 0 0 0 5.500 5.500l1.500-2 4 1.500v3a2 2 0 0 1-2 2A15 15 0 0 1 4.500 6a2 2 0 0 1 2-2z"/>'),
  correo: ic('<rect x="3.500" y="5.500" width="17" height="13" rx="2"/><path d="M4 7l8 6 8-6"/>'),
  chat: ic('<path d="M4.500 19.500l1.300-3.800A8 8 0 1 1 8.600 18.400z"/>'),
  grupo: ic('<circle cx="9" cy="8.500" r="3"/><circle cx="16.500" cy="9.500" r="2.300"/><path d="M3.500 19a5.500 5.500 0 0 1 11 0M14.500 14.300A4.500 4.500 0 0 1 20.500 18.500"/>'),
  info: ic('<circle cx="12" cy="12" r="8.500"/><path d="M12 11v5.500M12 7.800v.2"/>'),
  sube: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 2l5 8H1z"/></svg>',
  baja: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 10L1 2h10z"/></svg>',
};

// ---------- State and address ----------
const S = { pendTodos: false, vista: 'r', periodo: 'semana', fecha: HOY, datos: null, yo: null, abiertas: new Set(), huespedes: new Set(), lineas: new Set(), filtro: 'todo', orden: 'neto', mas: false, cargado: 0, error: null };
const clave = () => (S.vista === 'r' ? `r/${lunesDe(S.fecha)}` : `v/${S.periodo}/${S.fecha}`);
function leerRuta() {
  const m = /^#(r|v)(?:\/(dia|semana|mes))?(?:\/(\d{4}-\d{2}-\d{2}))?$/.exec(location.hash);
  S.vista = m ? m[1] : 'r';
  if (m && m[2]) S.periodo = m[2];
  S.fecha = m && m[3] && !Number.isNaN(Date.parse(m[3])) ? m[3] : hoyLocal();
}
const ruta = (vista, fecha, periodo = S.periodo) => (vista === 'r' ? `#r/${fecha}` : `#v/${periodo}/${fecha}`);
function ir(vista, fecha, periodo) { const h = ruta(vista, fecha, periodo); if (location.hash === h) cargar(); else location.hash = h; }

async function api(camino) {
  const r = await fetch(`api${camino}${DEV_HOY ? `&hoy=${encodeURIComponent(DEV_HOY)}` : ''}`, { headers: { accept: 'application/json' } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error || 'No se pudo cargar. Revisa tu conexión e intenta de nuevo.'); e.status = r.status; throw e; }
  return j;
}

let turno = 0;
async function cargar({ quieto = false } = {}) {
  const mio = ++turno, k = clave();
  if (!quieto) { main.classList.add('cargando'); $('#recargar').classList.add('girando'); $('#recargar2').classList.add('girando'); }
  try {
    const datos = await api(S.vista === 'r' ? `/semana?d=${S.fecha}` : `/ventas?p=${S.periodo}&d=${S.fecha}`);
    if (mio !== turno || k !== clave()) return;
    S.datos = datos; S.error = null; S.cargado = Date.now(); if (datos.hoy) HOY = datos.hoy;
    if (datos.yo) S.yo = datos.yo;
    pintar();
  } catch (e) {
    if (mio !== turno) return;
    if (quieto && S.datos) return;                               // a failed background refresh keeps what is on screen
    S.error = e; S.datos = null; pintar();
  } finally {
    if (mio === turno) { main.classList.remove('cargando'); $('#recargar').classList.remove('girando'); $('#recargar2').classList.remove('girando'); }
  }
}

// ---------- Shell: tabs, the stepper row ----------
function armazon() {
  const conVentas = !!S.yo?.ventas;
  const enlaces = [['r', 'Reservaciones', IC.mesa], ['v', 'Ventas', IC.ventas]].map(([v, t, i]) => `<a href="${ruta(v, hoyLocal())}" ${S.vista === v ? 'aria-current="page"' : ''}>${i}<span>${t}</span></a>`).join('');
  $('#pestanas').innerHTML = enlaces; $('#pestanas').hidden = !conVentas;
  $('#nav-lado').innerHTML = conVentas ? enlaces : '';
  document.body.classList.toggle('con-pestanas', conVentas);
  $('#yo').textContent = S.yo?.nombre || '';
  // the app is Pulso; the tabs say which part is open (Eric, 23 Nov 2026: renamed from Reservaciones, no Hub back link)
  document.title = `${S.vista === 'v' ? 'Ventas' : 'Reservaciones'} · Pulso`;
}
function paso(texto, sub, { atras, adelante, actual }) {
  $('#paso').hidden = false;
  $('#donde').innerHTML = `${esc(texto)}${sub ? `<small>${esc(sub)}</small>` : ''}`;
  $('#antes').dataset.ir = atras; $('#despues').dataset.ir = adelante || ''; $('#despues').disabled = !adelante;
  $('#hoy').hidden = actual;
}

let llevadoA = '';
function pintar() {
  armazon();
  if (S.error) return pintarError(S.error);
  if (!S.datos) return;
  main.dataset.vista = S.vista;
  if (S.vista === 'r') pintarManifiesto(S.datos); else pintarVentas(S.datos);
  dibujar();
  // The manifest opens on today: on the first paint of the current week, today's section comes to the top when
  // earlier days sit above it. Only once per week shown, so a refresh never moves the page under a finger.
  if (S.vista === 'r' && llevadoA !== clave()) {
    llevadoA = clave();
    // With today's panel on top there is nothing to jump to: the panel is today.
    const hoy = $('.dia.es-hoy');
    if (hoy && !$('.ahora') && hoy.previousElementSibling?.classList.contains('dia')) hoy.scrollIntoView({ block: 'start' });
  }
}
function pintarError(e) {
  $('#paso').hidden = true;
  const fuera = e.status === 401, sinPermiso = e.status === 403;
  main.innerHTML = `<div class="bloque vacio"><b>${fuera ? 'Abre Pulso desde el Hub' : sinPermiso ? 'Esta parte es para gerencia' : 'No se pudo cargar'}</b>${esc(e.message)}
    <div>${fuera ? '<a class="btn pri" href="https://apps.dosbuhos.com/">Ir al Hub</a>' : sinPermiso ? `<a class="btn" href="${ruta('r', hoyLocal())}">Ver reservaciones</a>` : '<button class="btn pri" type="button" data-reintentar>Intentar de nuevo</button>'}</div></div>`;
}

// ---------- Reservaciones: the week's manifest ----------
// Status as a host reads it. "Sin confirmar" is OpenTable's created: booked, the guest has not confirmed yet.
function estadoDe(r, dia) {
  if (r.estado === 'cancelled') return { c: 'cancelada', t: 'Cancelada', i: IC.equis };
  if (r.estado === 'no_show') return { c: 'nollego', t: 'No llegó', i: IC.alerta };
  if (r.estado === 'completed') return { c: 'atendida', t: 'Atendida', i: IC.palomita };
  if (r.sentado && !r.salio) return { c: 'enmesa', t: 'En mesa', i: IC.punto };
  if (dia.pasado) return { c: 'sincerrar', t: 'Sin cerrar', i: IC.reloj };
  if (r.estado === 'confirmed') return { c: 'confirmada', t: 'Confirmada', i: IC.palomita };
  return { c: 'reservada', t: 'Sin confirmar', i: IC.circulo };
}
const ORIGEN = { web: 'En línea', phone: 'Por teléfono', 'walk-in': 'Sin reservación' };
const ORIGEN_C = { web: 'En línea', phone: 'Teléfono', 'walk-in': 'Walk-in' };
const nombreDe = (r) => (r.huesped?.nombre ? esc(r.huesped.nombre) : r.huesped ? 'Huésped sin nombre' : r.huespedBorrado ? '<span class="sd">nombre borrado</span>' : '<span class="sd">nombre sin dato</span>');
const GRANDE = 6;                                            // a table this size or more gets the dark badge and a to-do
const EXP_C = { 'Visita guiada + degustación': 'Visita guiada', 'Degustación de 4 vinos': 'Degustación', 'Menú degustación 5 tiempos': 'Menú 5 tiempos', 'Picnic orgánico': 'Picnic', 'Petanque y espumoso': 'Petanque' };
const ordinal = (n) => `${n}ª`;
let paises; try { paises = new Intl.DisplayNames(['es-MX'], { type: 'region' }); } catch { paises = null; }
const pais = (c) => { try { return (c && paises?.of(c)) || c || ''; } catch { return c || ''; } };
const minutosDe = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const ahoraMin = () => { const t = new Date(Date.now() - SM); return t.getUTCHours() * 60 + t.getUTCMinutes(); };
const antelacion = (r, dia) => {
  if (!r.reservada || !r.hora) return null;
  const m = Math.round((Date.parse(`${dia.fecha}T${r.hora}:00Z`) + SM - r.reservada) / 60_000);
  if (m < 0) return null;
  return m < 90 ? `${m} min antes` : m < 36 * 60 ? `${Math.round(m / 60)} h antes` : `${Math.round(m / 1440)} días antes`;
};
function telDe(h) {
  const d = String(h?.telefono || '').replace(/\D/g, '');
  if (d.length < 8) return null;
  const wa = d.length === 10 ? `52${d}` : d;                   // ten digits with no country code: a Mexican number
  return { tel: String(h.telefono).trim().startsWith('+') ? `+${d}` : d, wa };
}
function etiquetas(r, dia, { todas = false } = {}) {
  const t = [];
  if (r.mesa) t.push(`<span class="tag mesa">${esc(r.mesa)}</span>`);
  if (r.experiencia) t.push(`<span class="tag prep">Prepagada${todas ? '' : `: ${esc(EXP_C[r.experiencia.nombre] || r.experiencia.nombre)}`}</span>`);
  if (r.historial?.visitas) t.push(`<span class="tag vuelve">${ordinal(r.historial.visitas + 1)} visita</span>`);
  if (r.historial?.faltas) t.push(`<span class="tag falto">No llegó ${r.historial.faltas === 1 ? 'una vez' : `${r.historial.faltas} veces`}</span>`);
  if (!todas && r.origen) t.push(`<span>${ORIGEN_C[r.origen] || esc(r.origen)}</span>`);
  if (!todas && r.reservada && fechaDe(r.reservada) === dia.fecha && !dia.pasado) t.push('<span>Mismo día</span>');
  return t.join('');
}

function filaReserva(r, dia) {
  const e = estadoDe(r, dia), fuera = r.estado === 'cancelled' || r.estado === 'no_show';
  return `<li class="reserva${fuera ? ' fuera' : ''}"><button class="fila s-${e.c}" type="button" data-abrir="${esc(r.id)}" aria-haspopup="dialog">
      <span class="hora">${r.hora ? esc(r.hora) : '<span class="sd">s/h</span>'}</span>
      <span class="pax${r.personas >= GRANDE ? ' grande' : ''}" aria-label="${r.personas ? cuantos(r.personas, 'persona', 'personas') : 'personas sin dato'}">${r.personas ? num(r.personas) : '?'}</span>
      <span class="quien"><span class="n">${nombreDe(r)}</span><span class="meta">${etiquetas(r, dia)}</span></span>
      <span class="estado">${e.i}<span class="txt">${e.t}</span></span></button></li>`;
}

// ---- The reservation sheet ----
const hoja = $('#hoja');
function abrirHoja(id) {
  const hallada = buscarReserva(id); if (!hallada) return;
  const { r, d: dia } = hallada, e = estadoDe(r, dia), h = r.huesped, t = telDe(h);
  const filas = [], fila = (k, v) => filas.push(`<dt>${k}</dt><dd>${v}</dd>`);
  fila('Reservó', `${ORIGEN[r.origen] || SD}${r.reservada ? `, ${fCorto(fechaDe(r.reservada))} a las ${horaDe(r.reservada)}` : ''}`);
  if (r.experiencia) fila('Prepago', `${esc(r.experiencia.nombre)}: ${pesos(r.experiencia.monto)} en línea${r.experiencia.pais ? `, tarjeta de ${esc(pais(r.experiencia.pais))}` : ''} <span class="est">estimación${r.experiencia.seguridad === 'personas' ? ' por hora y personas' : ' por hora'}</span>`);
  if (r.historial) fila('Antes', `${r.historial.visitas ? `${cuantos(r.historial.visitas, 'visita', 'visitas')}, la última el ${fDiaMes(r.historial.ultima)}` : 'Sin visitas'}${r.historial.faltas ? `; no llegó ${r.historial.faltas === 1 ? 'una vez' : `${r.historial.faltas} veces`}` : ''} <span class="est">desde el ${fDiaMes(S.datos.feedDesde)}</span>`);
  if (S.yo?.ventas && (r.cuenta != null || r.estado === 'completed')) fila('Cuenta', r.cuenta != null ? pesos(r.cuenta) : `${SD} <span class="est">OpenTable aún no liga las cuentas de Parrot</span>`);
  if (e.c === 'sincerrar') fila('Pendiente', 'En OpenTable nadie la marcó como atendida, cancelada o que no llegó.');
  fila('Confirmación', `<span class="tnum">${esc(r.id)}</span>`);
  const pasos = [['Reservó', r.reservada && fDiaMes(fechaDe(r.reservada))], ['Llegó', r.llego && horaDe(r.llego)], ['Mesa', r.sentado && horaDe(r.sentado)], ['Salió', r.salio && horaDe(r.salio)]];
  const linea = r.llego || r.sentado || r.salio ? `<div class="linea-t" aria-label="Visita">${pasos.map(([k, v]) => `<div class="${v ? 'si' : ''}"><i></i><b>${v || '–'}</b>${k}</div>`).join('')}</div>${r.sentado && r.salio && r.salio > r.sentado ? `<p class="nota">${duracion(r.salio - r.sentado)} en mesa.</p>` : ''}` : '';
  const acciones = h ? `<div class="acciones">${t ? `<a class="btn pri" href="tel:${esc(t.tel)}">${IC.tel}Llamar</a><a class="btn" href="https://wa.me/${esc(t.wa)}" target="_blank" rel="noopener">${IC.chat}WhatsApp</a>` : ''}${h.correo ? `<a class="btn" href="mailto:${esc(h.correo)}">${IC.correo}Correo</a>` : ''}</div>
    <div class="contacto">${h.telefono ? `<span>${esc(h.telefono)}</span>` : `<span>Teléfono: ${SD}</span>`}${h.correo ? `<a href="mailto:${esc(h.correo)}">${esc(h.correo)}</a>` : `<span>Correo: ${SD}</span>`}</div>`
    : `<p class="nota">${r.huespedBorrado ? `Los datos de este huésped ya se borraron de aquí (pasaron más de ${S.datos.retencionDias} días de la visita). Siguen en OpenTable.` : 'Todavía no llegan los datos de este huésped. Se leen de OpenTable cada 15 minutos.'}</p>`;
  const ant = antelacion(r, dia);
  hoja.innerHTML = `<div class="asa" aria-hidden="true"></div><button class="ico cierra" type="button" data-cerrar aria-label="Cerrar">${IC.equis}</button>
    <div class="cuerpo">
      <div class="encab s-${e.c}"><span class="hora">${r.hora ? esc(r.hora) : '<span class="sd">s/h</span>'}</span><span class="cuando">${mayus(fLargo(dia.fecha))}</span><span class="estado">${e.i}${e.t}</span></div>
      <h2 class="nombre" id="hoja-nombre">${nombreDe(r)}</h2>
      ${etiquetas(r, dia, { todas: true }) ? `<div class="tags">${etiquetas(r, dia, { todas: true })}</div>` : ''}
      <div class="grandes"><div><b>${r.personas ? num(r.personas) : SD}</b><span>${r.personas === 1 ? 'persona' : 'personas'}</span></div><div><b>${r.mesa ? esc(r.mesa) : SD}</b><span>mesa</span></div><div><b>${ant ? esc(ant.replace(' antes', '')) : SD}</b><span>de anticipación</span></div></div>
      ${acciones}${linea}
      <dl class="datos">${filas.join('')}</dl>
      ${h ? `<p class="nota">Datos de OpenTable, para atender esta reservación. Se borran de aquí ${S.datos.retencionDias} días después de la visita.</p>` : ''}
    </div>`;
  if (!hoja.open) { hoja.showModal(); history.pushState({ hoja: true }, ''); }
  hoja.querySelector('.cuerpo').scrollTop = 0;
}
hoja.addEventListener('click', (e) => { if (e.target === hoja || e.target.closest('[data-cerrar]')) hoja.close(); });
hoja.addEventListener('close', () => { if (history.state?.hoja) history.back(); });
addEventListener('popstate', () => { if (hoja.open) hoja.close(); });

// ---- Today: the numbers for the door, the next arrival and the arrivals by half hour ----
function bloqueHoy(dia) {
  const vivas = dia.reservas.filter((r) => r.estado !== 'cancelled' && r.estado !== 'no_show');
  const llegaron = vivas.filter((r) => r.sentado || r.llego || r.estado === 'completed');
  const ya = ahoraMin();
  // Expected: not here yet and not more than 20 minutes past their time. Past that and unmarked, a host should look.
  const faltan = vivas.filter((r) => !llegaron.includes(r));
  const porLlegar = faltan.filter((r) => !r.hora || minutosDe(r.hora) >= ya - 20), tarde = faltan.filter((r) => !porLlegar.includes(r));
  const sig = porLlegar.filter((r) => r.hora).sort((a, b) => minutosDe(a.hora) - minutosDe(b.hora))[0];
  const p = (lista) => lista.reduce((a, r) => a + (r.personas || 0), 0);
  const falta = sig ? minutosDe(sig.hora) - ya : 0;
  return `<section class="bloque ahora" aria-label="Hoy">
    <div class="titulo"><h2>Hoy<span>${DIAS[pf(dia.fecha).w]} ${pf(dia.fecha).d}</span></h2></div>
    <div class="cuatro"><div><b>${num(p(vivas))}</b><span>personas</span></div><div><b>${num(p(porLlegar))}</b><span>por llegar</span></div><div><b>${num(p(llegaron))}</b><span>ya llegaron</span></div><div><b${tarde.length ? ' style="color:var(--st-cerrar)"' : ''}>${num(p(tarde))}</b><span>sin marcar</span></div></div>
    ${sig ? `<button class="siguiente" type="button" data-abrir="${esc(sig.id)}"><span class="h">${esc(sig.hora)}</span><span><span class="que">Siguiente llegada</span><span class="n">${nombreDe(sig)}</span><span class="p">${sig.personas ? cuantos(sig.personas, 'persona', 'personas') : 'personas sin dato'}${sig.mesa ? `, mesa ${esc(sig.mesa)}` : ''}</span></span><span class="en">${falta > 0 ? `en ${duracion(falta * 60_000)}` : 'ahora'}</span></button>`
      : `<p class="nota">${!vivas.length ? 'Sin reservaciones para hoy por ahora.' : tarde.length ? `No queda nadie por llegar. ${cuantos(tarde.length, 'reservación pasó', 'reservaciones pasaron')} su hora sin marcarse en OpenTable.` : 'No queda nadie por llegar.'}</p>`}
    ${dia.franjas.length ? `<div class="ritmo" data-franjas="${esc(JSON.stringify(dia.franjas))}" data-ya="${ya / 30}" style="padding:0"></div>` : ''}
  </section>`;
}

// ---- To-dos: built from what is on screen; each opens its reservation or calls the guest ----
function pendientes(d) {
  const hoy = d.hoy, manana = sumar(hoy, 1), items = [];
  for (const dia of d.dias) {
    for (const r of dia.reservas) {
      const e = estadoDe(r, dia), cuando = dia.fecha === hoy ? 'Hoy' : dia.fecha === manana ? 'Mañana' : mayus(fCorto(dia.fecha));
      const quien = `${nombreDe(r)}, ${r.hora || 's/h'}, ${r.personas ? cuantos(r.personas, 'persona', 'personas') : 'personas sin dato'}`;
      const t = telDe(r.huesped), llamar = t ? `<a class="acc" href="tel:${esc(t.tel)}">${IC.tel}Llamar</a>` : `<button class="acc" type="button" data-abrir="${esc(r.id)}">Ver</button>`;
      const cerca = dia.fecha === hoy || dia.fecha === manana;
      if (e.c === 'reservada' && cerca) items.push({ orden: 1, c: 'var(--st-res)', i: IC.tel, t: `<b>Confirmar</b> · ${cuando}`, s: quien, id: r.id, acc: llamar });
      if (e.c === 'reservada' || e.c === 'confirmada') {
        if (r.historial?.faltas && cerca && e.c !== 'reservada') items.push({ orden: 2, c: 'var(--st-falta)', i: IC.alerta, t: `<b>No llegó la vez pasada</b> · ${cuando}`, s: quien, id: r.id, acc: llamar });
        if (!r.mesa && cerca) items.push({ orden: 3, c: 'var(--st-mesa)', i: IC.mesa, t: `<b>Sin mesa asignada</b> · ${cuando}`, s: quien, id: r.id, acc: `<button class="acc" type="button" data-abrir="${esc(r.id)}">Ver</button>` });
        if (r.personas >= GRANDE && dia.fecha >= hoy) items.push({ orden: 4, c: 'var(--accent)', i: IC.grupo, t: `<b>Mesa de ${num(r.personas)}</b> · ${cuando}`, s: `${nombreDe(r)}, ${r.hora || 's/h'}${r.mesa ? `, ${esc(r.mesa)}` : ''}`, id: r.id, acc: `<button class="acc" type="button" data-abrir="${esc(r.id)}">Ver</button>` });
      }
    }
    if (dia.fecha >= hoy) for (const c of dia.prepagos) if (c.motivo === 'sin_reserva') items.push({ orden: 5, c: 'var(--s2)', i: IC.info, t: `<b>Prepago sin reservación</b> · ${dia.fecha === hoy ? 'Hoy' : dia.fecha === manana ? 'Mañana' : mayus(fCorto(dia.fecha))}`, s: `${esc(c.experiencia)}, ${esc(c.hora)}, ${pesos(c.monto)}${c.personas ? `, ${cuantos(c.personas, 'persona', 'personas')}` : ''}. Búscala en OpenTable.`, dia: dia.fecha, acc: `<button class="acc" type="button" data-dia="${dia.fecha}">Ver día</button>` });
  }
  const sinCerrar = d.dias.filter((x) => x.pasado).flatMap((x) => x.reservas.filter((r) => estadoDe(r, x).c === 'sincerrar'));
  if (sinCerrar.length) items.push({ orden: 6, c: 'var(--st-cerrar)', i: IC.reloj, t: `<b>${cuantos(sinCerrar.length, 'reservación sin cerrar', 'reservaciones sin cerrar')}</b>`, s: 'De días pasados: márcalas en OpenTable como atendidas o que no llegaron.', dia: d.dias.find((x) => x.pasado && x.reservas.some((r) => estadoDe(r, x).c === 'sincerrar'))?.fecha, acc: '' });
  items.sort((a, b) => a.orden - b.orden);
  return items;
}
function bloquePendientes(d) {
  const items = pendientes(d), ver = S.pendTodos ? items : items.slice(0, 5);
  if (!d.dias.some((x) => x.fecha >= d.hoy)) return '';
  return `<section class="bloque pendientes" aria-label="Pendientes"><h2>Pendientes${items.length ? `<span class="cuenta">${num(items.length)}</span>` : ''}</h2>
    ${items.length ? ver.map((p) => `<div class="pend" style="--c:${p.c}"><span class="ic">${p.i}</span><button class="tx" type="button" ${p.id ? `data-abrir="${esc(p.id)}"` : p.dia ? `data-dia="${p.dia}"` : ''}>${p.t}<small>${p.s}</small></button>${p.acc}</div>`).join('')
      + (items.length > 5 ? `<button class="mas" type="button" data-pendientes>${S.pendTodos ? 'Ver menos' : `Ver los ${num(items.length)}`}</button>` : '')
      : `<p class="todo-bien">${IC.palomita}Nada pendiente por ahora.</p>`}</section>`;
}

function bloqueDia(d) {
  const p = pf(d.fecha), t = d.totales;
  const cab = `<div class="res">${t.reservas ? `<div><b>${num(t.personas)}</b><span>personas</span></div><div><b>${num(t.reservas)}</b><span>${t.reservas === 1 ? 'reservación' : 'reservas'}</span></div>` : ''}${t.noLlegaron ? `<div><b style="color:var(--st-falta)">${num(t.noLlegaron)}</b><span>no llegó</span></div>` : ''}</div>`;
  const sueltos = d.prepagos.length ? `<div class="sueltos"><h3>Prepagos en línea sin reservación identificada <span class="est">estimación</span></h3><ul>${d.prepagos.map((c) => `<li><span class="hora">${esc(c.hora)}</span><span>${esc(c.experiencia)}</span><span class="cuanto">${pesos(c.monto)}</span>
      <small>${c.personas ? `Alcanza para ${cuantos(c.personas, 'persona', 'personas')}. ` : ''}${c.motivo === 'sin_reserva' ? 'Su reservación todavía no llega de OpenTable.' : 'Hay varias reservaciones a esa hora y no se puede saber de cuál es.'}</small></li>`).join('')}</ul></div>` : '';
  let parrot = '';
  if (S.yo?.ventas && 'ventas' in d && !(d.fecha > S.datos.hoy)) {
    const v = d.ventas;
    parrot = !v ? `<div class="parrot"><h3>Parrot ese día</h3><p class="nota">${SD}</p></div>`
      : v.cuentas === 0 ? (d.reservas.length ? `<div class="parrot"><h3>Parrot ese día</h3><p class="nota">${d.hoy ? 'Todavía sin cuentas cerradas hoy.' : 'Sin cuentas cerradas.'}</p></div>` : '')
      : `<div class="parrot"><h3>Parrot ese día, sin ligar a las reservaciones</h3><div class="cifras"><div><b>${pesos(v.neto)}</b><span>venta neta</span></div><div><b>${num(v.cuentas)}</b><span>cuentas</span></div>
          <div><b>${v.comensales != null ? num(v.comensales) : SD}</b><span>comensales</span></div><div><b>${v.ticket != null ? pesos(v.ticket) : SD}</b><span>por comensal</span></div></div>
          <a class="ir" href="${ruta('v', d.fecha, 'dia')}">Ver las ventas de ese día ›</a></div>`;
  }
  const activas = d.reservas.filter((r) => r.estado !== 'cancelled'), canceladas = d.reservas.filter((r) => r.estado === 'cancelled');
  // The arrivals strip earns its place from three reservations up (today has its own, in the panel on top).
  const lista = d.reservas.length ? `${t.reservas >= 3 && !d.hoy ? `<div class="ritmo" data-franjas="${esc(JSON.stringify(d.franjas))}"></div>` : ''}${activas.length ? `<ul class="reservas">${activas.map((r) => filaReserva(r, d)).join('')}</ul>` : ''}
      ${canceladas.length ? `<details class="fuera-lista"><summary>${cuantos(canceladas.length, 'cancelada', 'canceladas')}${IC.abajo}</summary><ul class="reservas">${canceladas.map((r) => filaReserva(r, d)).join('')}</ul></details>` : ''}`
    : `<p class="nada">${d.pasado ? 'No hubo reservaciones.' : 'Sin reservaciones por ahora.'}</p>`;
  return `<section class="dia${d.hoy ? ' es-hoy' : ''}" id="dia-${d.fecha}"><div class="cab"><h2>${d.hoy ? `Hoy <span>${DIAS[p.w]} ${p.d}</span>` : `${mayus(DIAS[p.w])} ${p.d}`}</h2>${cab}</div>${lista}${sueltos}${parrot}</section>`;
}

// Covers per day, split: already served (or seated), confirmed, still to confirm.
function partesDia(x) {
  const out = { hecha: 0, conf: 0, res: 0 };
  for (const r of x.reservas) {
    if (r.estado === 'cancelled' || r.estado === 'no_show') continue;
    const e = estadoDe(r, x).c, n = r.personas || 0;
    if (e === 'atendida' || e === 'enmesa' || e === 'sincerrar') out.hecha += n; else if (e === 'confirmada') out.conf += n; else out.res += n;
  }
  return out;
}

function pintarManifiesto(d) {
  const actual = d.hoy >= d.desde && d.hoy <= d.hasta, dif = Math.round((Date.parse(d.desde) - Date.parse(lunesDe(d.hoy))) / 604_800_000);
  paso(rangoTxt(d.desde, d.hasta), dif === 0 ? 'Esta semana' : dif === -1 ? 'Semana pasada' : dif === 1 ? 'Semana próxima' : '', { atras: ruta('r', d.anterior), adelante: ruta('r', d.siguiente), actual });
  const partes = d.dias.map(partesDia), max = Math.max(1, ...partes.map((p) => p.hecha + p.conf + p.res));
  const tira = d.dias.map((x, i) => { const p = pf(x.fecha), q = partes[i], n = q.hecha + q.conf + q.res, alto = (v) => Math.max(v ? 3 : 0, Math.round((v / max) * 54));
    const segs = [['hecha', q.hecha], ['conf', q.conf], ['res', q.res]].filter(([, v]) => v > 0).map(([k, v]) => `<i class="${k}" style="height:${alto(v)}px"></i>`).join('');
    return `<button type="button" data-dia="${x.fecha}" class="${x.hoy ? 'es-hoy ' : ''}${x.abierto ? '' : 'cerrado'}" aria-label="${esc(`${fLargo(x.fecha)}: ${x.abierto ? `${cuantos(n, 'persona', 'personas')}${q.res ? `, ${q.res} sin confirmar` : ''}` : 'sin servicio'}`)}">
      <span class="col${n ? '' : ' cero'}">${segs}</span><span class="n">${x.abierto ? num(n) : '–'}</span><span class="d">${DIA_C[p.w]} ${p.d}</span></button>`; }).join('');
  const t = d.totales, conf = partes.reduce((a, p) => a + p.conf, 0), res = partes.reduce((a, p) => a + p.res, 0), hecha = partes.reduce((a, p) => a + p.hecha, 0);
  const extra = [t.canceladas ? cuantos(t.canceladas, 'cancelada', 'canceladas') : '', t.noLlegaron ? cuantos(t.noLlegaron, 'no llegó', 'no llegaron') : '', t.prepagos ? `${cuantos(t.prepagos, 'prepago', 'prepagos')} sin reservación` : ''].filter(Boolean);
  let izq = '';
  const diaHoy = actual ? d.dias.find((x) => x.hoy) : null;
  if (diaHoy && (diaHoy.abierto || diaHoy.reservas.length)) izq += bloqueHoy(diaHoy);
  izq += bloquePendientes(d);
  izq += `<section class="bloque semana" aria-label="La semana"><div class="tot"><span class="grupo"><b>${num(t.personas)}</b><span>personas</span></span><span class="grupo"><b>${num(t.reservas)}</b><span>reservaciones</span></span></div>
    <div class="tira">${tira}</div>
    <div class="clave">${hecha ? '<span><i class="hecha"></i>Atendidas</span>' : ''}${conf ? '<span><i></i>Confirmadas</span>' : ''}${res ? '<span><i class="res"></i>Sin confirmar</span>' : ''}${extra.length ? `<span>${mayus(extra.join(', '))}</span>` : ''}</div></section>`;
  if (d.dias.some((x) => x.incompleto && x.abierto)) izq += `<div class="aviso">${IC.info}<p>Pueden faltar reservaciones hechas antes del ${fDiaMes(d.feedDesde)}, cuando se conectó OpenTable. Los prepagos en línea sí aparecen.</p></div>`;
  if (d.fresco.errorHuespedes) izq += `<div class="aviso mal">${IC.alerta}<p>Los nombres de los huéspedes no se están actualizando${d.yo.admin ? `: ${esc(d.fresco.errorHuespedes)}` : '. Avisa a quien administra el Hub.'}</p></div>`;
  let h = `<div class="col-izq">${izq}</div>`;
  let cerrados = [];
  const soltar = () => { if (cerrados.length) { h += `<p class="cerrados">${mayus(cerrados.map((f) => `${DIAS[pf(f).w]} ${pf(f).d}`).join(' y '))}: sin servicio.</p>`; cerrados = []; } };
  for (const x of d.dias) { if (x.abierto) { soltar(); h += bloqueDia(x); } else cerrados.push(x.fecha); }
  soltar();
  h += `<div class="pie"><p>Solo reservaciones: quien llega sin reservar no está en este dato.</p><p>Reservaciones de OpenTable${d.fresco.reservas ? `, actualizadas ${hace(d.fresco.reservas)}` : ''}${d.fresco.huespedes ? `; huéspedes ${hace(d.fresco.huespedes)}` : ''}${d.fresco.ventas ? `; Parrot ${hace(d.fresco.ventas)}` : ''}.</p></div>`;
  main.innerHTML = h;
}

// ---------- Ventas ----------
const CORTO = { restaurante: 'Restaurante', experiencias: 'Tours', tienda: 'Tienda', eventos: 'Eventos' };
const TIPO_PAGO = { 'Pay TDC': 'Tarjeta de crédito', 'Pay TDD': 'Tarjeta de débito', Cash: 'Efectivo', Transferencia: 'Transferencia' };
const pct = (x) => { const a = Math.abs(x); return `${a >= 100 ? Math.round(a) : a >= 10 ? a.toFixed(0) : a.toFixed(1).replace(/\.0$/, '')}%`; };
function delta(c) {
  if (!c) return '<span class="delta igual">sin dato</span>';
  const cls = Math.abs(c.pct) < 0.5 ? 'igual' : c.pct > 0 ? 'sube' : 'baja';
  return `<span class="delta ${cls}">${cls === 'sube' ? IC.sube : cls === 'baja' ? IC.baja : ''}${cls === 'igual' ? 'igual' : pct(c.pct)}<span class="sr">${cls === 'sube' ? ' más' : cls === 'baja' ? ' menos' : ''}</span></span>`;
}
const tabla = (cab, filas) => `<details class="tabla"><summary>Ver como tabla</summary><table><thead><tr>${cab.map((c) => `<th scope="col">${c}</th>`).join('')}</tr></thead><tbody>${filas.map((f) => `<tr>${f.map((c, i) => (i ? `<td>${c}</td>` : `<th scope="row">${c}</th>`)).join('')}</tr>`).join('')}</tbody></table></details>`;
const figura = (titulo, sub, cuerpo, { lado = '', ancho = false } = {}) => `<figure class="bloque fig${ancho ? ' ancho' : ''}"><header>${lado ? `<div class="con-lado"><h2>${titulo}</h2>${lado}</div>` : `<h2>${titulo}</h2>`}${sub ? `<p>${sub}</p>` : ''}</header>${cuerpo}</figure>`;

function pintarVentas(v) {
  const P = v.periodo, hoy = v.hoy, actual = hoy >= v.desde && hoy <= v.hasta, w = pf(v.desde).w;
  const titulo = P === 'dia' ? mayus(fCorto(v.desde)) : P === 'semana' ? rangoTxt(v.desde, v.hasta) : `${mayus(MESES[pf(v.desde).m - 1])} ${pf(v.desde).y}`;
  const sub = P === 'dia' ? (v.desde === hoy ? 'Hoy' : v.desde === sumar(hoy, -1) ? 'Ayer' : '') : actual ? (P === 'semana' ? 'Esta semana' : 'Este mes') : '';
  paso(titulo, sub, { atras: ruta('v', v.anterior, P), adelante: v.siguiente <= hoy ? ruta('v', v.siguiente, P) : '', actual });
  const t = v.total, contraAntes = P === 'dia' ? `frente al ${DIAS[w]} anterior` : P === 'semana' ? 'frente a la semana anterior' : 'frente a los mismos días, 4 semanas antes';
  const contraAnio = `${P === 'dia' ? `frente al mismo ${DIAS[w]} hace un año` : P === 'semana' ? 'frente a la misma semana hace un año' : 'frente a los mismos días hace un año'}${t.eventos > 0 ? ', sin eventos privados' : ''}`;
  const seg = `<div class="seg3" role="group" aria-label="Periodo">${[['dia', 'Día'], ['semana', 'Semana'], ['mes', 'Mes']].map(([k, n]) => `<button type="button" data-periodo="${k}" aria-pressed="${P === k}">${n}</button>`).join('')}</div>`;

  let h = `<section class="bloque ancho"><div class="lema"><div class="arr"><span class="que">Venta neta</span>${seg}</div>`;
  if (t.neto === null) h += `<div class="cifra sd">sin dato</div><p class="iva">${v.desde > hoy ? 'Este periodo todavía no empieza.' : 'No hay registro de ventas para estas fechas.'}</p></div></section>`;
  else {
    h += `<div class="cifra">${pesos(t.neto)}</div><p class="iva">Sin IVA. Con IVA: ${pesos(t.conIva)}.${v.enCurso ? ` Va hasta hoy, ${fCorto(v.corte)}; se compara con los mismos días.` : ''}</p>
      <div class="cambios"><div class="cambio">${delta(v.vs.anterior)}<span class="contra">${contraAntes}${v.vs.anterior ? ` (${pesos(v.vs.anterior.antes)})` : ''}</span></div>
      <div class="cambio">${delta(v.vs.anio)}<span class="contra">${contraAnio}${v.vs.anio ? ` (${pesos(v.vs.anio.antes)})` : ''}</span></div></div></div>
      <div class="kpis">
        <div class="kpi"><div class="et">Comensales</div><div class="va${t.comensales == null ? ' sd' : ''}">${t.comensales == null ? 'sin dato' : num(t.comensales)}</div><div class="ap">${t.comensales == null ? `Se cuentan desde el ${fDiaMes(v.comensalesDesde)}` : t.sinConteo ? `Sin contar ${cuantos(t.sinConteo, 'día anterior', 'días anteriores')} al ${fDiaMes(v.comensalesDesde)}` : v.vs.comensales ? `${delta(v.vs.comensales)} ${contraAntes}` : 'En mesas del restaurante'}</div></div>
        <div class="kpi"><div class="et">Ticket por comensal</div><div class="va${t.ticketComensal == null ? ' sd' : ''}">${t.ticketComensal == null ? 'sin dato' : pesos(t.ticketComensal)}</div><div class="ap">Venta en mesas entre comensales, sin IVA</div></div>
        <div class="kpi"><div class="et">Cuentas</div><div class="va">${num(t.cuentas)}</div><div class="ap">${t.ticketCuenta != null ? `${pesos(t.ticketCuenta)} por cuenta` : ''}${t.sinCobro ? `. ${cuantos(t.sinCobro, 'cuenta', 'cuentas')} en $0` : ''}</div></div>
        <div class="kpi"><div class="et">Propinas</div><div class="va${t.propinas == null ? ' sd' : ''}">${t.propinas == null ? 'sin dato' : pesos(t.propinas)}</div><div class="ap">${t.propinas == null ? 'El sistema anterior no las detalla aquí' : 'Aparte de la venta'}</div></div>
      </div></section>`;

    // Sales by day (week and month), with the same weekday a year earlier as a mark on each column.
    if (P !== 'dia') {
      const filas = v.serie.filter((x) => !x.futuro).map((x) => [`${mayus(DIA_C[pf(x.fecha).w])} ${pf(x.fecha).d}`, x.neto == null ? SD : pesos(x.neto), x.cuentas == null ? SD : num(x.cuentas), x.comensales == null ? SD : num(x.comensales), x.anio == null ? SD : pesos(x.anio)]);
      h += figura('Venta por día', 'La raya es el mismo día de la semana, un año antes.', `<div class="lienzo" data-g="dias"></div>
        <div class="leyenda"><span><i></i>Venta neta</span><span><i class="raya"></i>Un año antes${t.eventos > 0 ? ', sin eventos' : ''}</span></div>${tabla(['Día', 'Venta neta', 'Cuentas', 'Comen&shy;sales', 'Un año antes'], filas)}`, { ancho: true });
    }
    if (v.conParrot) {
      h += figura('Venta por hora', P === 'mes' ? 'Promedio por día de la semana, por hora de apertura de la cuenta.' : 'Por hora de apertura de la cuenta.', `<div class="lienzo" data-g="horas"></div>`);
      h += figuraLineas(v) + figuraProductos(v) + figuraPagos(v);
    } else h += `<div class="aviso">${IC.info}<p>Antes del ${v.parrotDesde ? fDiaMes(v.parrotDesde) + ' ' + pf(v.parrotDesde).y : 'inicio de Parrot'} solo hay totales por día del sistema anterior: horas, productos y formas de pago quedan sin dato.</p></div>`;
  }
  if (t.neto === null) h += '';
  const hayTend = v.tendencia.some((x) => x.neto != null);
  if (hayTend) h += figura('Doce semanas', 'Venta neta por semana (lunes a domingo). Gris: un año antes.', `<div class="lienzo" data-g="tendencia"></div>
    <div class="leyenda"><span><i class="linea"></i>Venta neta</span><span><i class="raya" style="border-top-width:1.5px"></i>Un año antes, sin eventos</span></div>
    ${tabla(['Semana del', 'Venta neta', 'Comen&shy;sales', 'Un año antes'], v.tendencia.map((x) => [fDiaMes(x.semana) + (x.parcial ? ' (en curso)' : ''), x.neto == null ? SD : pesos(x.neto), x.comensales == null ? SD : num(x.comensales), x.anio == null ? SD : pesos(x.anio)]))}`, { ancho: true });
  if (v.conParrot) {
    const r = Object.fromEntries(v.reservas.map((x) => [x.estado, x])), at = r.completed, partes = [at ? `<b>${cuantos(at.reservas, 'atendida', 'atendidas')}</b> con ${cuantos(at.personas, 'persona', 'personas')}` : '', r.no_show ? cuantos(r.no_show.reservas, 'no llegó', 'no llegaron') : '', r.cancelled ? cuantos(r.cancelled.reservas, 'cancelada', 'canceladas') : '',
      (r.created || r.confirmed) ? `${num((r.created?.reservas || 0) + (r.confirmed?.reservas || 0))} sin cerrar` : ''].filter(Boolean);
    h += figura('Reservaciones de estas fechas', 'Sin ligar a las cuentas: OpenTable todavía no las relaciona.',
      `<p class="frase">${partes.length ? `${partes.join(', ')}.` : 'Sin reservaciones en estas fechas.'}</p>${conReserva(at, t)}<a class="mas" href="${ruta('r', v.desde)}">Ver el manifiesto de ${P === 'dia' ? 'esa semana' : 'esas fechas'}</a>`, { ancho: true });
  }
  h += `<div class="pie"><p>Venta neta: cuentas cerradas en Parrot, sin IVA y después de descuentos; los mismos números que Growth Terminal. Comensales: personas en cuentas “Comer aquí”, desde el ${fDiaMes(v.comensalesDesde)}. Las visitas prepagadas en línea se registran en Parrot al llegar, así que no se suman aparte.</p>
    <p>${v.fresco ? `Parrot actualizado ${hace(v.fresco)}.` : ''}${v.parrotDesde ? ` Parrot desde el ${fDiaMes(v.parrotDesde)} ${pf(v.parrotDesde).y}; antes, totales diarios del sistema anterior.` : ''}</p></div>`;
  main.innerHTML = h;
}

// Of the guests Parrot counted at tables, how many came with a reservation: an estimate (tour guests are counted
// by OpenTable but may not sit at a table; the rest are walk-ins).
function conReserva(at, t) {
  if (!at?.personas || !(t.comensales > 0)) return '';
  const p = Math.min(100, (at.personas / t.comensales) * 100), con = Math.min(at.personas, t.comensales), sin = Math.max(0, t.comensales - at.personas);
  return `<div class="mezcla"><div class="partes" role="img" aria-label="${esc(`Con reservación ${pct(p)}, sin reservación ${pct(100 - p)}`)}"><i class="c1" style="flex:${con} 1 0"></i>${sin ? `<i style="flex:${sin} 1 0;background:var(--rule-2)"></i>` : ''}</div>
    <div class="leyenda"><span><i></i><b>${pct(p)}</b>&nbsp;llegó con reservación (${num(con)})</span><span><i style="background:var(--rule-2)"></i><b>${pct(100 - p)}</b>&nbsp;sin reservación (${num(sin)})</span></div>
    <p class="nota">De ${cuantos(t.comensales, 'comensal', 'comensales')} en mesas. <span class="est">estimación</span></p></div>`;
}

function figuraLineas(v) {
  const total = v.lineas.reduce((a, l) => a + l.neto, 0);
  if (!total) return figura('Por línea de negocio', '', `<p class="nota">${SD}</p>`);
  const barra = `<div class="partes" role="img" aria-label="${esc(v.lineas.filter((l) => l.neto > 0).map((l) => `${l.nombre} ${pct((l.neto / total) * 100)}`).join(', '))}">${v.lineas.map((l, i) => (l.neto > 0 ? `<i class="c${i + 1}" style="flex:${l.neto} 1 0"></i>` : '')).join('')}</div>`;
  const lista = `<ul class="lineas">${v.lineas.map((l, i) => { const ab = S.lineas.has(l.id);
    return `<li><button class="lin" type="button" data-linea="${l.id}" aria-expanded="${ab}" ${l.categorias.length ? '' : 'disabled'}><span class="cuadro c${i + 1}"></span><span>${esc(l.nombre)}</span><span class="monto">${l.neto ? pesos(l.neto) : '$0'}</span><span class="pct">${pct((l.neto / total) * 100)}</span></button>
      ${ab ? `<ul class="cats">${l.categorias.map((c) => `<li><span>${esc(c.nombre)}</span><b>${pesos(c.neto)}</b></li>`).join('')}</ul>` : ''}</li>`; }).join('')}</ul>`;
  return figura('Por línea de negocio', 'Por categoría de Parrot, sin IVA, antes de descuentos. Toca una línea para abrirla.', barra + lista);
}

function figuraProductos(v) {
  const lineas = v.lineas.filter((l) => l.neto > 0);
  const lista = v.productos.filter((p) => S.filtro === 'todo' || p.linea === S.filtro).sort((a, b) => (S.orden === 'cantidad' ? b.cantidad - a.cantidad || b.neto - a.neto : b.neto - a.neto));
  const cuantosVer = S.mas ? 25 : 8, visibles = lista.slice(0, cuantosVer), max = Math.max(1, ...visibles.map((p) => (S.orden === 'cantidad' ? p.cantidad : p.neto)));
  const chips = `<div class="chips" role="group" aria-label="Línea">${[['todo', 'Todo'], ...lineas.map((l) => [l.id, CORTO[l.id] || l.nombre])].map(([k, n]) => `<button type="button" data-filtro="${k}" aria-pressed="${S.filtro === k}">${esc(n)}</button>`).join('')}</div>`;
  const orden = `<div class="seg3 chico" role="group" aria-label="Ordenar por">${[['neto', 'Venta'], ['cantidad', 'Piezas']].map(([k, n]) => `<button type="button" data-orden="${k}" aria-pressed="${S.orden === k}">${n}</button>`).join('')}</div>`;
  const filas = visibles.length ? `<ol class="rango">${visibles.map((p) => `<li><span class="nom">${esc(p.nombre)}</span><span class="val">${S.orden === 'cantidad' ? num(p.cantidad) : pesos(p.neto)}</span>
    <span class="barra"><i style="width:${Math.max(1, ((S.orden === 'cantidad' ? p.cantidad : p.neto) / max) * 100).toFixed(1)}%"></i></span><span class="ap">${S.orden === 'cantidad' ? pesos(p.neto) : cuantos(p.cantidad, 'pieza', 'piezas')}, ${esc(p.categoria)}</span></li>`).join('')}</ol>` : `<p class="nota">Nada vendido en esta línea.</p>`;
  return figura('Lo más vendido', '', `${chips}${filas}${lista.length > 8 ? `<button class="mas" type="button" data-mas>${S.mas ? 'Ver menos' : `Ver ${Math.min(25, lista.length)} de ${num(lista.length)}`}</button>` : ''}`, { lado: orden });
}

function figuraPagos(v) {
  const total = v.pagos.reduce((a, p) => a + p.monto, 0), propinas = v.pagos.reduce((a, p) => a + p.propina, 0);
  if (!total) return figura('Formas de pago', '', `<p class="nota">${SD}</p>`);
  return figura('Formas de pago', `Lo cobrado en cuentas cerradas, con IVA: ${pesos(total)}${propinas ? `, más ${pesos(propinas)} de propinas` : ''}.`, `<ol class="rango">${v.pagos.map((p) => `<li><span class="nom">${esc(TIPO_PAGO[p.tipo] || p.tipo)}</span><span class="val">${pesos(p.monto)}</span>
    <span class="barra"><i style="width:${Math.max(1, (p.monto / total) * 100).toFixed(1)}%"></i></span><span class="ap">${pct((p.monto / total) * 100)} de lo cobrado, ${cuantos(p.pagos, 'pago', 'pagos')}${p.propina ? `, propinas ${pesos(p.propina)}` : ''}</span></li>`).join('')}</ol>
    <p class="nota">Transferencia es lo que no pasó por la terminal de Parrot; ahí caen las visitas prepagadas en línea.</p>`);
}

// ---------- Charts: drawn after the page is in place, at the width they actually have ----------
function dibujar() {
  for (const el of $$('.ritmo[data-franjas]')) { const ancho = el.clientWidth - 28; if (ancho > 60) el.innerHTML = ritmo({ ancho, franjas: JSON.parse(el.dataset.franjas), ya: el.dataset.ya ? Number(el.dataset.ya) : null }); }
  if (S.vista !== 'v' || !S.datos || S.error) return;
  const v = S.datos, P = v.periodo;
  for (const el of $$('.lienzo[data-g]')) {
    const ancho = el.clientWidth; if (ancho < 80) continue;
    if (el.dataset.g === 'dias') {
      el.innerHTML = columnas({ ancho, datos: v.serie.map((x) => { const p = pf(x.fecha);
        return { et: P === 'mes' ? String(p.d) : DIA_C[p.w], v: x.futuro ? null : x.neto, ref: x.anio, hoy: x.fecha === v.hoy, futuro: x.futuro,
          t: x.futuro ? 'Por venir' : x.neto == null ? 'sin dato' : pesos(x.neto), s: `${mayus(fLargo(x.fecha))}${x.cuentas ? `\n${cuantos(x.cuentas, 'cuenta', 'cuentas')}${x.comensales != null ? `, ${cuantos(x.comensales, 'comensal', 'comensales')}` : ''}` : ''}\nUn año antes: ${x.anio == null ? 'sin dato' : pesos(x.anio)}` }; }) });
    } else if (el.dataset.g === 'tendencia') {
      el.innerHTML = tendencia({ ancho, puntos: v.tendencia.map((x) => ({ et: fDiaMes(x.semana), v: x.neto, ref: x.anio, parcial: x.parcial,
        t: x.neto == null ? 'sin dato' : pesos(x.neto), s: `Semana del ${fDiaMes(x.semana)}${x.parcial ? ' (en curso)' : ''}${x.comensales != null ? `\n${cuantos(x.comensales, 'comensal', 'comensales')}` : ''}\nUn año antes: ${x.anio == null ? 'sin dato' : pesos(x.anio)}` })) });
    } else if (el.dataset.g === 'horas') el.innerHTML = horas(v, ancho);
  }
}

function horas(v, ancho) {
  const P = v.periodo;
  if (!v.horas.length) return `<p class="nota">${SD}</p>`;
  const h0 = Math.min(10, ...v.horas.map((x) => x.hora)), h1 = Math.max(18, ...v.horas.map((x) => x.hora)), hs = []; for (let x = h0; x <= h1; x++) hs.push(x);
  if (P === 'dia') {
    const por = new Map(v.horas.map((x) => [x.hora, x]));
    const filas = hs.map((x) => [`${x}:00`, pesos(por.get(x)?.neto || 0), num(por.get(x)?.cuentas || 0)]);
    return columnas({ ancho, datos: hs.map((x) => ({ et: `${x}`, v: por.get(x)?.neto || 0, ref: null, t: pesos(por.get(x)?.neto || 0), s: `De ${x}:00 a ${x + 1}:00\n${cuantos(por.get(x)?.cuentas || 0, 'cuenta abierta', 'cuentas abiertas')}` })) })
      + tabla(['Hora', 'Venta neta', 'Cuentas'], filas);
  }
  // Rows: each open day of the week, or (for a month) each weekday averaged over its days.
  const filas = [];
  if (P === 'semana') {
    for (const f of [...new Set(v.horas.map((x) => x.fecha))].sort()) filas.push({ et: `${mayus(DIA_C[pf(f).w])} ${pf(f).d}`, largo: mayus(fLargo(f)), dias: 1, celdas: new Map(v.horas.filter((x) => x.fecha === f).map((x) => [x.hora, x])) });
  } else {
    for (const w of [1, 2, 3, 4, 5, 6, 0]) {
      const suyas = v.horas.filter((x) => pf(x.fecha).w === w); if (!suyas.length) continue;
      const dias = new Set(suyas.map((x) => x.fecha)).size, celdas = new Map();
      for (const x of suyas) { const c = celdas.get(x.hora) || { neto: 0, cuentas: 0 }; c.neto += x.neto / dias; c.cuentas += x.cuentas / dias; celdas.set(x.hora, c); }
      filas.push({ et: mayus(DIA_C[w]), largo: `${mayus(DIAS[w])}, promedio de ${cuantos(dias, 'día', 'días')}`, dias, celdas });
    }
  }
  const max = Math.max(1, ...filas.flatMap((f) => [...f.celdas.values()].map((c) => c.neto)));
  const nivel = (x) => (x <= 0 ? 0 : Math.min(6, Math.max(1, Math.ceil((x / max) * 6))));
  let h = `<div class="calor" style="grid-template-columns:auto repeat(${hs.length}, minmax(0, 1fr))"><span></span>${hs.map((x) => `<span class="hh">${x}</span>`).join('')}`;
  for (const f of filas) h += `<span class="et">${esc(f.et)}</span>${hs.map((x) => { const c = f.celdas.get(x), n = c?.neto || 0;
    return `<button type="button" data-n="${nivel(n)}" data-t="${esc(n ? pesos(n) : 'Sin venta')}" data-s="${esc(`${f.largo}\nDe ${x}:00 a ${x + 1}:00${c ? `\n${P === 'mes' ? `${(c.cuentas).toFixed(1)} cuentas en promedio` : cuantos(c.cuentas, 'cuenta abierta', 'cuentas abiertas')}` : ''}`)}" aria-label="${esc(`${f.largo}, ${x}:00: ${n ? pesos(n) : 'sin venta'}`)}"></button>`; }).join('')}`;
  h += '</div>';
  const escala = `<div class="escala"><span>Menos</span>${[1, 2, 3, 4, 5, 6].map((n) => `<i data-n="${n}"></i>`).join('')}<span>Más: ${pesosCorto(max)} en una hora</span></div>`;
  const totales = hs.map((x) => { const s = v.horas.filter((y) => y.hora === x); return [`${x}:00`, pesos(s.reduce((a, y) => a + y.neto, 0)), num(s.reduce((a, y) => a + y.cuentas, 0))]; });
  return h + escala + tabla(['Hora', 'Venta neta', 'Cuentas'], totales);
}

// ---------- Tooltip: the value first, what it is after; the same on hover, tap and keyboard focus ----------
const globo = $('#globo');
let conGlobo = null;
function mostrar(el) {
  conGlobo = el;
  globo.innerHTML = `<b>${esc(el.dataset.t)}</b>${String(el.dataset.s || '').split('\n').filter(Boolean).map((l) => `<span>${esc(l)}</span>`).join('')}`;
  globo.hidden = false;
  const r = el.getBoundingClientRect(), g = globo.getBoundingClientRect();
  const alto = Math.min(r.top, r.top + r.height / 2 - 60);
  let top = Math.max(r.top, alto) - g.height - 8; if (top < 8) top = Math.min(r.bottom + 8, innerHeight - g.height - 8);
  globo.style.left = `${Math.round(Math.min(Math.max(8, r.left + r.width / 2 - g.width / 2), innerWidth - g.width - 8))}px`;
  globo.style.top = `${Math.round(top)}px`;
}
function ocultar() { conGlobo = null; globo.hidden = true; }
document.addEventListener('pointerover', (e) => { if (e.pointerType === 'touch') return; const el = e.target.closest?.('[data-t]'); if (el) mostrar(el); else if (conGlobo) ocultar(); });
document.addEventListener('focusin', (e) => { const el = e.target.closest?.('[data-t]'); if (el) mostrar(el); });
document.addEventListener('focusout', () => ocultar());
addEventListener('scroll', () => { if (conGlobo) ocultar(); }, { passive: true });

// ---------- Actions ----------
function alternar(set, id) { if (set.has(id)) set.delete(id); else set.add(id); return set.has(id); }
function buscarReserva(id) { for (const d of S.datos?.dias || []) { const r = d.reservas.find((x) => x.id === id); if (r) return { r, d }; } return null; }

document.addEventListener('click', (e) => {
  const tip = e.target.closest('[data-t]');
  if (tip) mostrar(tip); else if (conGlobo) ocultar();
  const el = e.target.closest('[data-abrir],[data-pendientes],[data-dia],[data-periodo],[data-linea],[data-filtro],[data-orden],[data-mas],[data-reintentar],[data-ir]');
  if (!el) return;
  const d = el.dataset;
  if ('abrir' in d) { abrirHoja(d.abrir);
  } else if ('dia' in d) {
    const destino = $(`#dia-${d.dia}`); if (destino) destino.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  } else if ('periodo' in d) { ir('v', S.datos?.corte && d.periodo !== 'dia' ? S.datos.corte : S.datos?.corte || S.datos?.desde || S.fecha, d.periodo); }
  else if ('linea' in d) { alternar(S.lineas, d.linea); repintarVentas(); }
  else if ('filtro' in d) { S.filtro = d.filtro; S.mas = false; repintarVentas(); }
  else if ('orden' in d) { S.orden = d.orden; repintarVentas(); }
  else if ('mas' in d) { S.mas = !S.mas; repintarVentas(); }
  else if ('pendientes' in d) { S.pendTodos = !S.pendTodos; const y = scrollY; pintarManifiesto(S.datos); dibujar(); scrollTo(0, y); }
  else if ('reintentar' in d) cargar();
  else if ('ir' in d && d.ir) location.hash = d.ir;
});
function repintarVentas() { const y = scrollY; pintarVentas(S.datos); dibujar(); scrollTo(0, y); }

$('#hoy').addEventListener('click', () => ir(S.vista, hoyLocal()));
$('#recargar').addEventListener('click', () => cargar());
$('#recargar2').addEventListener('click', () => cargar());
addEventListener('hashchange', () => { const antes = S.vista, clv = clave(); leerRuta(); if (antes !== S.vista) S.datos = null; if (clv !== clave()) scrollTo(0, 0); armazon(); cargar(); });
let redibujo = 0;
addEventListener('resize', () => { clearTimeout(redibujo); redibujo = setTimeout(dibujar, 150); });
// Keep the screen fresh while it is being looked at: every five minutes, and when coming back to the tab.
setInterval(() => { if (!document.hidden && Date.now() - S.cargado > 290_000) cargar({ quieto: true }); }, 60_000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - S.cargado > 120_000) cargar({ quieto: true }); });

leerRuta(); armazon(); cargar();
