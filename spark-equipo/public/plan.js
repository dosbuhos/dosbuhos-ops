// Spark CRM — the 90-day plan (commitments with an owner, a date and a measure) and event requests (ask with numbers,
// approve, close with results). Helpers come from app.js; data from /api/data.
import { h, pill, chips, peso, dia, S, formulario, enviar, datos } from './app.js';

const D = () => datos();
const dDias = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 864e5);
const fechaL = (iso) => (iso ? dia(iso) + (iso.slice(0, 4) !== D().hoy.slice(0, 4) ? ' ' + iso.slice(0, 4) : '') : 'sin fecha');
const plural = (n, uno, varios) => (n === 1 ? `1 ${uno}` : `${n} ${varios}`);

// ---------------------------------------------------------------- Plan
const ETAPAS = ['Esta semana', 'Diciembre', 'Enero', 'Febrero y marzo'];
// Where a commitment stands today: done, overdue, due within a week, or later.
function estadoPlan(c, hoy) {
  if (c.estado === 'hecho') return ['Hecho', 'ok'];
  if (!c.fecha) return ['Sin fecha', 'mute'];
  const d = dDias(hoy, c.fecha);
  return d < 0 ? [`Vencido · ${plural(-d, 'día', 'días')}`, 'bad'] : d === 0 ? ['Vence hoy', 'warn'] : d <= 7 ? [`En ${plural(d, 'día', 'días')}`, 'warn'] : [fechaL(c.fecha), 'mute'];
}
// For Inicio: this person's published commitments that are overdue or due within three days.
export function urgentePlan(p) {
  const d = D(), L = (d.plan || []).filter((c) => c.persona === p && c.visible && c.estado !== 'hecho' && c.fecha && dDias(d.hoy, c.fecha) <= 3), venc = L.filter((c) => c.fecha < d.hoy);
  if (!L.length) return null;
  return venc.length ? { k: 'bad', t: plural(venc.length, 'compromiso vencido', 'compromisos vencidos'), d: venc.slice(0, 2).map((c) => c.titulo).join(' · '), vista: 'plan' }
    : { k: 'warn', t: L.length === 1 ? 'Un compromiso vence en estos días' : `${L.length} compromisos vencen en estos días`, d: L.slice(0, 2).map((c) => `${dia(c.fecha)}: ${c.titulo}`).join(' · '), vista: 'plan' };
}
function plan() {
  const d = D(), yo = d.yo, hoy = d.hoy, P = d.plan || [], todos = (d.reglas || {}).plan_gente || [], gente = todos.filter((g) => P.some((c) => c.persona === g));
  if (S.planP === undefined || (S.planP && !gente.includes(S.planP))) S.planP = yo.persona && gente.includes(yo.persona) ? yo.persona : '';
  const borr = P.filter((c) => !c.visible);
  const campos = (c) => [{ k: 'persona', t: 'De quién es', tipo: 'select', ops: todos, v: c.persona || S.planP || todos[0], mitad: true }, { k: 'fecha', t: 'Para cuándo', tipo: 'date', v: c.fecha || '', req: true, mitad: true },
    { k: 'titulo', t: 'Compromiso', tipo: 'textarea', v: c.titulo || '', req: true, ph: 'Qué va a quedar hecho' }, { k: 'medida', t: 'Cómo se mide', tipo: 'textarea', v: c.medida || '', ph: 'El dato o la evidencia que dirá que se cumplió' },
    { k: 'etapa', t: 'Etapa', tipo: 'select', ops: ETAPAS, v: c.etapa || ETAPAS[0], mitad: true }, c.id ? null : { k: 'visible', t: 'Quién lo ve', tipo: 'select', ops: [['no', 'Borrador: solo yo'], ['si', 'Todo el equipo']], v: 'no', mitad: true }].filter(Boolean);
  const editar = (c) => formulario(c ? 'Cambiar compromiso' : 'Nuevo compromiso', campos(c || {}), (v) => enviar('api/admin/plan', { ...v, id: c ? c.id : undefined }));
  const cerrar = (c) => formulario('Marcar como hecho', [{ k: 'nota', t: 'Qué quedó hecho y dónde se ve', tipo: 'textarea', req: true, ph: 'Por ejemplo: acuerdo firmado; está en la carpeta de contratos' }], (v) => enviar('api/plan/hecho', { id: c.id, ...v }), c.titulo, 'Marcar hecho');
  const puede = (c) => yo.admin || c.persona === yo.persona;
  const fila = (c) => { const [t, k] = estadoPlan(c, hoy), abierto = c.estado !== 'hecho';
    return h('li', { class: abierto ? '' : 'hecho' }, h('div', { class: 'l1' }, h('span', {}, c.titulo), h('span', { class: 'pl-e' }, c.visible ? null : pill('Borrador', 'mute'), pill(t, k))),
      h('div', { class: 'l2' }, [abierto && c.fecha && k !== 'mute' ? 'Para el ' + fechaL(c.fecha) : '', c.medida ? 'Se mide: ' + c.medida : ''].filter(Boolean).join(' · ')),
      abierto ? null : h('div', { class: 'l2' }, `Hecho el ${fechaL(c.hecho_fecha)} por ${c.hecho_por}: ${c.nota}`),
      puede(c) || yo.dueno ? h('div', { class: 'acc' }, puede(c) ? (abierto ? h('button', { class: 'btn sm', onclick: () => cerrar(c) }, 'Marcar hecho') : h('button', { class: 'linkb note', onclick: () => enviar('api/plan/hecho', { id: c.id, deshacer: true }) }, 'Reabrir')) : null,
        yo.dueno ? [h('button', { class: 'linkb note', onclick: () => editar(c) }, 'Cambiar'), h('button', { class: 'linkb note', onclick: () => enviar('api/admin/plan', { publicar: c.id, ocultar: !!c.visible }) }, c.visible ? 'Regresar a borrador' : 'Publicar'),
          h('button', { class: 'linkb note', onclick: () => { if (confirm('¿Quitar este compromiso?')) enviar('api/admin/plan', { borrar: c.id }); } }, 'Quitar')] : null) : null); };
  const orden = (L) => [...L.filter((c) => c.estado !== 'hecho'), ...L.filter((c) => c.estado === 'hecho')];
  const resumen = (L) => { const he = L.filter((c) => c.estado === 'hecho').length, ve = L.filter((c) => c.estado !== 'hecho' && c.fecha && c.fecha < hoy).length, sig = L.find((c) => c.estado !== 'hecho' && c.fecha >= hoy);
    return [`${he} de ${L.length} hechos`, ve ? plural(ve, 'vencido', 'vencidos') : '', sig ? `sigue el ${fechaL(sig.fecha)}` : ''].filter(Boolean).join(' · '); };
  return h('div', {},
    h('p', { class: 'note' }, 'Lo que cada quien se comprometió a entregar, con fecha y cómo se mide. Se revisa aquí cada lunes.' + (yo.persona ? ' Marca “hecho” los tuyos con una nota de qué quedó y dónde se ve.' : '')),
    yo.dueno ? h('div', { class: 'toolbar' }, h('button', { class: 'btn sm', onclick: () => editar() }, 'Agregar compromiso'),
      borr.length ? h('button', { class: 'btn sm sec', onclick: () => { if (confirm(`¿Publicar los ${borr.length} borradores a todo el equipo?`)) enviar('api/admin/plan', { publicar: 'todos' }); } }, `Publicar los ${borr.length} borradores`) : null) : null,
    yo.dueno && borr.length ? h('p', { class: 'note aviso' }, `${plural(borr.length, 'compromiso está', 'compromisos están')} en borrador: solo tú los ves. Publícalos cuando hayas presentado el plan.`) : null,
    gente.length > 1 ? chips([['', 'Todos'], ...gente.map((g) => [g, g])], S.planP, (v) => { S.planP = v; }) : null,
    P.length ? null : h('p', { class: 'note' }, 'Todavía no hay compromisos publicados.'),
    gente.filter((g) => !S.planP || g === S.planP).map((g) => { const L = orden(P.filter((c) => c.persona === g)), nb = L.filter((c) => !c.visible).length;
      return h('section', { class: 'card' }, h('div', { class: 'name' }, g, h('span', { class: 'note' }, resumen(L))),
        yo.dueno && nb ? h('p', { class: 'note' }, h('button', { class: 'linkb', onclick: () => enviar('api/admin/plan', { publicar: g }) }, `Publicar los ${nb} de ${g}`)) : null,
        h('ul', { class: 'rows plan' }, L.map(fila))); }));
}

// ---------------------------------------------------------------- Eventos
const TIPOS_EV = ['Feria o festival', 'Cata o cena maridaje', 'Capacitación', 'Visita de clientes a la bodega', 'Gira con distribuidor', 'Otro'];
const FILTRO = 3;   // expected sales in 60 days must be at least this many times the total cost
// For Inicio: this person's approved events whose date passed and were never closed.
export function urgenteEventos(p) {
  const d = D(), L = (d.eventos || []).filter((e) => e.persona === p && e.estado === 'aprobado' && e.fecha < d.hoy);
  if (!L.length) return null;
  const viejo = Math.max(...L.map((e) => dDias(e.fecha, d.hoy)));
  return { k: viejo > 7 ? 'bad' : 'warn', t: plural(L.length, 'evento sin cerrar', 'eventos sin cerrar'), d: L.slice(0, 2).map((e) => e.nombre).join(' · ') + ' · Registra contactos, botellas y venta', vista: 'eventos' };
}
function eventos() {
  const d = D(), yo = d.yo, hoy = d.hoy, R = d.reglas || {}, vino = R.botella_muestra || 200, tope = R.evento_tope || 10000, E = d.eventos || [];
  const total = (e) => (e.costo || 0) + (e.botellas || 0) * vino, veces = (a, b) => (b ? Math.round(a / b * 10) / 10 : 0);
  const pedir = () => formulario('Pedir un evento', [{ k: 'nombre', t: 'Evento', req: true, ph: 'Por ejemplo: Aire Tinto, Val’Quirico' },
    { k: 'tipo', t: 'Qué es', tipo: 'select', ops: TIPOS_EV, mitad: true }, { k: 'fecha', t: 'Fecha', tipo: 'date', req: true, mitad: true },
    { k: 'lugar', t: 'Ciudad', mitad: true }, { k: 'distribuidor', t: 'Quién surte ahí', ph: 'Distribuidor, o “nadie todavía”', mitad: true },
    { k: 'objetivo', t: 'Para qué vamos', tipo: 'textarea', req: true, ph: 'Qué cuentas o distribuidores queremos abrir o cuidar' },
    { k: 'cuentas_objetivo', t: 'A quién vamos a ver, con nombre', tipo: 'textarea', ph: 'Compradores, sommeliers, distribuidores' },
    { k: 'costo', t: 'Costo en pesos: lugar, viaje, hotel', tipo: 'number', mitad: true }, { k: 'botellas', t: 'Botellas que pides', tipo: 'number', mitad: true },
    { k: 'venta_esperada', t: 'Venta que esperas en 60 días, en pesos', tipo: 'number' }], (v) => enviar('api/eventos', v),
    `El filtro: la venta esperada debe ser al menos ${FILTRO} veces lo que cuesta, contando el vino a ${peso(vino)} por botella. Pídelo con 15 días de anticipación.`, 'Enviar solicitud');
  const autorizar = (e) => formulario('Autorizar ' + e.nombre, [{ k: 'botellas_aprobadas', t: 'Botellas autorizadas', tipo: 'number', v: e.botellas, mitad: true }, { k: 'costo_aprobado', t: 'Gasto autorizado en pesos', tipo: 'number', v: e.costo, mitad: true },
    { k: 'nota', t: 'Condiciones (opcional)', tipo: 'textarea', ph: 'Por ejemplo: va con el distribuidor; cierre en 7 días' }], (v) => enviar('api/admin/eventos', { id: e.id, decision: 'aprobado', ...v }), `${e.persona} · ${fechaL(e.fecha)}`, 'Autorizar');
  const negar = (e) => formulario('No autorizar ' + e.nombre, [{ k: 'nota', t: 'Por qué no', tipo: 'textarea', req: true }], (v) => enviar('api/admin/eventos', { id: e.id, decision: 'rechazado', ...v }), `${e.persona} · ${fechaL(e.fecha)}`, 'No autorizar');
  const cerrar = (e) => formulario('Cerrar ' + e.nombre, [{ k: 'contactos', t: 'Contactos nuevos con nombre', tipo: 'number', v: e.contactos || '', mitad: true }, { k: 'cuentas_nuevas', t: 'Cuentas que ya compraron', tipo: 'number', v: e.cuentas_nuevas || '', mitad: true },
    { k: 'botellas_usadas', t: 'Botellas usadas', tipo: 'number', v: e.botellas_usadas || e.botellas_aprobadas || '', mitad: true }, { k: 'venta_real', t: 'Venta a la fecha, en pesos', tipo: 'number', v: e.venta_real || '', mitad: true },
    { k: 'reporte', t: 'Qué pasó y qué sigue', tipo: 'textarea', req: true, v: e.reporte || '', ph: 'Con quién hablaste, qué pidieron, siguiente paso y fecha' }], (v) => enviar('api/eventos', { cerrar: e.id, ...v }),
    'Registra también cada contacto en su cuenta. La venta se actualiza a los 60 días; sin cierre no se autoriza el siguiente evento.', e.estado === 'cerrado' ? 'Actualizar' : 'Cerrar evento');
  const mio = (e) => yo.admin || e.persona === yo.persona;
  const estado = (e) => (e.estado === 'solicitado' ? ['Por autorizar', 'warn'] : e.estado === 'rechazado' ? ['No autorizado', 'mute'] : e.estado === 'cerrado' ? ['Cerrado', 'ok']
    : e.fecha < hoy ? [`Falta cerrar · ${plural(dDias(e.fecha, hoy), 'día', 'días')}`, dDias(e.fecha, hoy) > 7 ? 'bad' : 'warn'] : ['Autorizado', 'ok']);
  const tarjeta = (e) => { const t = total(e), x = veces(e.venta_esperada, t), real = (e.costo_aprobado || 0) + (e.botellas_usadas || 0) * vino;
    return h('section', { class: 'card ev' }, h('div', { class: 'name' }, e.nombre, pill(...estado(e))),
      h('div', { class: 'l2' }, [e.tipo, e.lugar, fechaL(e.fecha), 'lo pidió ' + e.persona].filter(Boolean).join(' · ')),
      h('p', {}, e.objetivo), e.cuentas_objetivo ? h('p', { class: 'note' }, 'A quién vamos a ver: ' + e.cuentas_objetivo) : null,
      h('div', { class: 'evn' }, h('div', {}, h('b', {}, peso(t)), h('span', {}, `cuesta con ${plural(e.botellas, 'botella', 'botellas')}`)), h('div', {}, h('b', {}, peso(e.venta_esperada)), h('span', {}, 'venta esperada en 60 días')),
        h('div', {}, h('b', { class: x >= FILTRO ? 'up' : 'down' }, x + ' veces'), h('span', {}, x >= FILTRO ? 'pasa el filtro' : `el filtro pide ${FILTRO}`))),
      e.distribuidor ? h('div', { class: 'l2' }, 'Surte: ' + e.distribuidor) : null,
      e.decidio ? h('div', { class: 'l2' }, (e.estado === 'rechazado' ? 'No lo autorizó ' : 'Lo autorizó ') + `${e.decidio} el ${fechaL(e.decidido)}` + (e.estado !== 'rechazado' ? ` · ${plural(e.botellas_aprobadas, 'botella', 'botellas')} y ${peso(e.costo_aprobado)}` : '') + (e.nota_decision ? ` · ${e.nota_decision}` : '')) : null,
      e.estado === 'cerrado' ? h('div', { class: 'evr' }, h('b', {}, `Resultado: ${plural(e.contactos, 'contacto', 'contactos')}, ${plural(e.cuentas_nuevas, 'cuenta nueva', 'cuentas nuevas')}, ${peso(e.venta_real)} de venta` + (real ? ` · ${veces(e.venta_real, real)} veces lo invertido` : '')), h('span', {}, e.reporte)) : null,
      h('div', { class: 'acc' }, e.estado === 'solicitado' && yo.admin ? (t > tope && !yo.dueno ? h('span', { class: 'note' }, `Pasa de ${peso(tope)}: lo decide Dirección.`) : [h('button', { class: 'btn sm', onclick: () => autorizar(e) }, 'Autorizar'), h('button', { class: 'btn sm sec', onclick: () => negar(e) }, 'No autorizar')]) : null,
        ['aprobado', 'cerrado'].includes(e.estado) && mio(e) && e.fecha <= hoy ? h('button', { class: e.estado === 'cerrado' ? 'linkb note' : 'btn sm', onclick: () => cerrar(e) }, e.estado === 'cerrado' ? 'Actualizar resultado' : 'Cerrar evento') : null,
        yo.admin ? h('button', { class: 'linkb note', onclick: () => { if (confirm('¿Quitar esta solicitud?')) enviar('api/admin/eventos', { id: e.id, borrar: true }); } }, 'Quitar') : null)); };
  const grupo = (t, L, nota) => (L.length ? [h('h2', {}, `${t} (${L.length})`), nota ? h('p', { class: 'note' }, nota) : null, h('div', { class: 'cols2' }, L.map(tarjeta))] : null);
  const de = (f) => E.filter(f).sort((a, b) => (a.fecha < b.fecha ? -1 : 1));
  return h('div', {},
    h('div', { class: 'toolbar' }, h('button', { class: 'btn', onclick: pedir }, 'Pedir un evento')),
    h('details', { class: 'card evf', open: E.length ? null : '' }, h('summary', {}, 'Cómo se autoriza un evento'),
      h('ol', {}, h('li', {}, h('b', {}, 'Se pide con números, 15 días antes: '), 'a quién vamos a ver con nombre, cuánto cuesta, cuántas botellas y qué venta se espera en 60 días.'),
        h('li', {}, h('b', {}, `El filtro: venta esperada de al menos ${FILTRO} veces el costo, `), `contando el vino a ${peso(vino)} por botella. Debe haber quien surta en la plaza, o el evento es para abrir a ese distribuidor.`),
        h('li', {}, h('b', {}, 'Quién decide: '), `hasta ${peso(tope)} con vino, la dirección comercial; más, Dirección. Las botellas autorizadas son las que salen de bodega.`),
        h('li', {}, h('b', {}, 'Se cierra en 7 días: '), 'contactos con nombre registrados en su cuenta, botellas usadas y fotos. A los 60 días se pone la venta y se compara con lo que costó.'),
        h('li', {}, h('b', {}, 'Sin cierre no hay siguiente evento '), 'ni muestras para quien lo pidió.'))),
    E.length ? null : h('p', { class: 'note' }, 'Todavía no hay solicitudes. La primera puede ser el próximo evento que ya tengas en mente.'),
    grupo('Por autorizar', de((e) => e.estado === 'solicitado')), grupo('Falta cerrar', de((e) => e.estado === 'aprobado' && e.fecha < hoy), 'Ya pasaron y no tienen resultado.'),
    grupo('Autorizados', de((e) => e.estado === 'aprobado' && e.fecha >= hoy)), grupo('Cerrados', de((e) => e.estado === 'cerrado').reverse()), grupo('No autorizados', de((e) => e.estado === 'rechazado').reverse()));
}

export const PLAN_VISTAS = { plan, eventos };
