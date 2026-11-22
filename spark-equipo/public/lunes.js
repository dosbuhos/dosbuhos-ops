// Spark CRM — the Monday review: the five numbers of the plan, the commitments that are due, and what gets reviewed with
// each person. Which numbers, their targets and each person's review points come from the database (they name accounts);
// nothing of that lives in this file. The team sees this screen once at least one commitment is shown to them.
import { h, pill, peso, dia, S, datos, ir, formulario, enviar, regla48, puntualidad, ventaNeta, porConciliar } from './app.js';

const D = () => datos();
const dDias = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 864e5);
const plural = (n, uno, varios) => (n === 1 ? `1 ${uno}` : `${n} ${varios}`);
const EQUIPO = ['José Luis', 'Carlos', 'Daniel'];   // the people whose contact log counts for "registro al corriente"
const alDia = (p) => { const g = regla48(p); return g.sin != null && g.sin <= 2; };

// Today's value of one of the plan's numbers, and how to print it. 'manual' numbers are typed in by an admin until Spark can compute them.
function leer(n) {
  const d = D();
  if (n.tipo === 'venta') { const v = ventaNeta(n.desde, n.hasta, EQUIPO); return { txt: peso(v), meta: peso(n.meta), pc: n.meta ? Math.round(v / n.meta * 100) : null, ok: v >= n.meta }; }
  if (n.tipo === 'registro') { const v = EQUIPO.filter(alDia).length; return { txt: `${v} de ${EQUIPO.length}`, meta: `${n.meta} de ${EQUIPO.length}`, pc: Math.round(v / EQUIPO.length * 100), ok: v >= n.meta }; }
  if (n.tipo === 'vencido') { const v = Math.round(((d.cobranza || {}).facturas || []).filter((f) => (f.dias || 0) > 90 && !porConciliar(f)).reduce((t, f) => t + (f.saldo || 0), 0)); return { txt: peso(v), meta: 'menos de ' + peso(n.meta), pc: null, ok: v < n.meta }; }
  const v = Number(n.valor) || 0;
  return { txt: String(v), meta: String(n.meta), pc: n.meta ? Math.round(v / n.meta * 100) : null, ok: v >= n.meta, manual: true };
}

function lunes() {
  const d = D(), cfg = d.lunes, hoy = d.hoy, yo = d.yo;
  if (!cfg) return h('p', { class: 'note' }, 'La revisión del lunes todavía no está lista.');
  const Y = hoy.slice(0, 4), ym = hoy.slice(0, 7), mH = Number(hoy.slice(5, 7));
  const mia = (c) => !S.persona || c.persona === S.persona;
  const cambiar = (n) => formulario('Actualizar: ' + n.titulo, [{ k: 'valor', t: 'Valor de hoy', tipo: 'number', v: n.valor, req: true }], (v) => enviar('api/admin/lunes', { clave: n.clave, valor: v.valor }),
    'Este número se captura a mano en la revisión, hasta que Spark lo pueda calcular.', 'Guardar');
  const cifra = (n) => { const r = leer(n), tarde = n.fecha && n.fecha < hoy, k = r.ok ? 'ok' : tarde || r.pc == null || r.pc < 60 ? 'bad' : 'warn';
    return h('div', { class: 'tit ' + k }, h('span', { class: 'tt' }, n.titulo), h('b', {}, r.txt), h('span', { class: 'ts' }, `Meta: ${r.meta}` + (n.fecha ? ` · ${dia(n.fecha)}` : '')),
      r.pc == null ? null : h('i', {}, h('u', { style: `width:${Math.max(2, Math.min(100, r.pc))}%` })),
      r.manual && yo.admin ? h('button', { class: 'linkb', onclick: () => cambiar(n) }, n.actualizado ? `Actualizar · ${dia(n.actualizado)}` : 'Actualizar') : null); };
  // Open commitments: overdue first, then what is due within seven days.
  const P = (d.plan || []).filter((c) => c.estado !== 'hecho' && c.fecha), venc = P.filter((c) => c.fecha < hoy && mia(c)), sem = P.filter((c) => c.fecha >= hoy && dDias(hoy, c.fecha) <= 7 && mia(c));
  const fila = (c) => { const tarde = c.fecha < hoy, n = tarde ? dDias(c.fecha, hoy) : dDias(hoy, c.fecha);
    return h('li', {}, h('div', { class: 'l1' }, h('span', {}, c.titulo), h('span', { class: 'pl-e' }, pill(tarde ? `Vencido · ${plural(n, 'día', 'días')}` : n === 0 ? 'Vence hoy' : dia(c.fecha), tarde ? 'bad' : 'warn'))),
      h('div', { class: 'l2' }, c.persona + (c.medida ? ' · Se mide: ' + c.medida : ''))); };
  const bloque = (t, L, vacio) => h('section', { class: 'card' }, h('div', { class: 'name' }, t, h('span', { class: 'note' }, L.length ? plural(L.length, 'compromiso', 'compromisos') : '')),
    L.length ? h('ul', { class: 'rows plan' }, L.map(fila)) : h('p', { class: 'note' }, vacio), L.length ? h('p', {}, h('button', { class: 'linkb', onclick: () => ir('plan') }, 'Abrir el Plan para marcarlos')) : null);
  // One card per person: where they stand today and the points to go through with them.
  const dato = (t, v) => h('div', {}, h('span', {}, t), h('b', {}, v));
  const gente = Object.keys(cfg.personas || {}).filter((p) => !S.persona || p === S.persona);
  const tarjeta = (p) => { const eq = EQUIPO.includes(p), g = eq ? puntualidad(p) : null, w = (d.semanas || []).find((r) => r.semana === d.semana_actual && r.persona === p);
    const M = String(d.presupuesto.anio) === Y && (d.presupuesto.meses[p] || []).length === 12 ? d.presupuesto.meses[p][mH - 1] : 0;
    const mios = P.filter((c) => c.persona === p), mv = mios.filter((c) => c.fecha < hoy).length, ms = mios.filter((c) => c.fecha >= hoy && dDias(hoy, c.fecha) <= 7).length;
    return h('section', { class: 'card' }, h('div', { class: 'name' }, p, eq ? pill(alDia(p) ? 'Registro al corriente' : 'Registro atrasado', alDia(p) ? 'ok' : 'bad') : null),
      h('div', { class: 'lund' }, M ? dato('Venta del mes', `${peso(ventaNeta(ym + '-01', ym + '-31', [p]))} de ${peso(M)}`) : null, w ? dato('Contactos de la semana', `${w.contactos} de ${w.meta}`) : null,
        g && g.pc != null ? dato('A tiempo este mes', g.pc + '%') : null, dato('Compromisos', mv ? plural(mv, 'vencido', 'vencidos') : ms ? `${ms} esta semana` : mios.length ? 'al corriente' : 'sin pendientes')),
      h('h3', {}, 'Se revisa'), h('ol', { class: 'lunl' }, (cfg.personas[p] || []).map((t) => h('li', {}, t))),
      eq ? h('p', {}, h('button', { class: 'linkb', onclick: () => ir('hoy', p) }, 'Ver su tablero')) : null); };
  return h('div', {},
    h('p', { class: 'note' }, 'Media hora cada lunes: los cinco números del plan, lo que vence esta semana y los puntos de cada persona.'),
    yo.dueno && !cfg.publicado ? h('p', { class: 'note aviso' }, 'Por ahora solo tú ves esta pantalla: el equipo todavía no ve el plan.') : null,
    h('div', { class: 'lun5' }, (cfg.numeros || []).map(cifra)),
    h('div', { class: 'cols2' }, bloque('Vencidos', venc, 'Nada vencido.'), bloque('Vencen en siete días', sem, 'Nada vence esta semana.')),
    gente.length ? h('div', { class: 'grid3' }, gente.map(tarjeta)) : h('p', { class: 'note' }, 'Esta persona no tiene puntos de revisión.'));
}

export const LUNES_VISTAS = { lunes };
