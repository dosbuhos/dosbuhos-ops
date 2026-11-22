// Spark CRM — the account-side screens: collections, client book, surveys, by-the-glass and pipeline, sales materials, and
// what is coming for client communications. Helpers come from app.js; data from /api/data.
import { PREMIOS, DONDE } from './marca.js';
import { ancho, h, lista, pill, chips, peso, dia, S, personas, vendedores, formulario, enviar, pintar, datos, api, cargar, registrar, nuevaCuenta, toca, porConciliar } from './app.js';

const D = () => datos();
const kpi = (n, label, sub) => h('div', { class: 'kpi' }, h('div', { class: 'num' }, n), h('div', { class: 'kl' }, label), sub ? h('div', { class: 'note' }, sub) : null);
const suma = (a, f) => a.reduce((t, x) => t + (f(x) || 0), 0);
const BOTELLAS = ['aglianico', 'anaranjado', 'cab-franc', 'cab-sauvignon', 'chenin', 'espumoso-rose', 'grenache', 'montepulciano', 'mosaico-blanco', 'mosaico-tinto', 'petnat', 'roble', 'rose-1524', 'sauvignon', 'seleccion', 'semillon-sb', 'tempranillo-1524', 'tempranillo-gr', 'vin-dorange'];

// Edit what we know about an account. Used by the client book, copeo and the pipeline.
function editarCuenta(base, foco) {
  const e = (D().cuentas || []).find((c) => c.clave === base.clave) || {}, v = (k) => e[k] || base[k] || '';
  formulario(base.nombre, [
    { k: 'contacto', t: 'Persona de contacto', v: v('contacto'), mitad: true }, { k: 'puesto', t: 'Puesto', v: v('puesto'), ph: 'Compras, sommelier, gerente', mitad: true },
    { k: 'email', t: 'Correo', tipo: 'email', v: v('email'), mitad: true }, { k: 'telefono', t: 'Teléfono o WhatsApp', v: v('telefono'), mitad: true },
    { k: 'ciudad', t: 'Ciudad', v: v('ciudad'), mitad: true }, { k: 'estado', t: 'Estado', v: v('estado'), mitad: true },
    { k: 'tipo', t: 'Tipo de cuenta', tipo: 'select', ops: [['', 'Sin definir'], 'Restaurante', 'Hotel', 'Tienda', 'Distribuidor', 'Bar', 'Evento / catering', 'Particular'], v: v('tipo'), mitad: true },
    { k: 'fase', t: 'Etapa', tipo: 'select', ops: [['', 'La del último registro'], 'Contacto inicial', 'En proceso', 'Catalogado', 'Compra regular'], v: e.fase || '', mitad: true },
    { k: 'copeo', t: 'Copeo (vino por copa)', tipo: 'select', ops: [['', 'No sabemos'], ['si', 'Sí, nos sirven por copa'], ['propuesto', 'Propuesto, sin respuesta'], ['no', 'No'] ], v: e.copeo || '', mitad: true },
    { k: 'copeo_vino', t: 'Qué vino por copa', v: e.copeo_vino || '', mitad: true },
    { k: 'botellas_mes', t: 'Botellas al mes que podría comprar', tipo: 'number', v: e.botellas_mes || '', mitad: true },
    { k: 'pausa', t: 'Envíos pausados por cobranza', tipo: 'select', ops: [['no', 'No'], ['si', 'Sí, pausados hasta que paguen']], v: e.pausa ? 'si' : 'no', mitad: true },
    { k: 'notas', t: 'Notas', tipo: 'textarea', v: e.notas || '' },
  ], (f) => enviar('api/cuenta', { ...f, nombre: base.nombre }), foco || 'Lo que guardes aquí lo ve todo el equipo.');
}

// ---------------------------------------------------------------- Cobranza
function cobranza() {
  const ps = personas(), C = D().cobranza, F0 = C.facturas.filter((f) => !S.persona || f.vendedor === S.persona);
  // Two sets: accounts with a name (debt to chase) and invoices the books still have to reconcile (sales to "Público en general",
  // the export account with no payment applied, and balances on orders older than the cut-off). The Worker marks each one.
  // The numbers and the list below are those of the set on screen.
  const FC = F0.filter(porConciliar), hayC = FC.length > 0; if (!hayC) S.cobC = '';
  const F = !hayC ? F0 : S.cobC ? FC : F0.filter((f) => !porConciliar(f));
  const grupos = new Map();
  for (const f of F) { const g = grupos.get(f.cliente) || { cliente: f.cliente, vendedor: f.vendedor, n: 0, saldo: 0, dias: 0, pronostico: 0, comentario: '' }; g.n++; g.saldo += f.saldo; g.dias = Math.max(g.dias, f.dias || 0); g.pronostico += f.pronostico; if (f.comentario) g.comentario = f.comentario; grupos.set(f.cliente, g); }
  const L = [...grupos.values()].sort((a, b) => b.saldo - a.saldo), total = suma(F, (f) => f.saldo);
  const tramo = (a, b) => suma(F.filter((f) => (f.dias || 0) > a && (f.dias || 0) <= b), (f) => f.saldo), T = [['Hasta 30 días', tramo(-1e9, 30), 'ok'], ['31 a 60', tramo(30, 60), 'warn'], ['61 a 90', tramo(60, 90), 'warn'], ['Más de 90', tramo(90, 1e9), 'bad']];
  const gest = (c) => (C.gestiones || []).find((g) => g.cliente === c);
  const gestion = (g) => formulario(`Gestión de cobro: ${g.cliente}`, [{ k: 'nota', t: 'Qué pasó', tipo: 'textarea', req: true, ph: 'Con quién hablaste y qué dijo' }, { k: 'promesa', t: 'Fecha en que prometió pagar', tipo: 'date', mitad: true }, { k: 'monto', t: 'Monto prometido', tipo: 'number', mitad: true }],
    (v) => enviar('api/cobros', { ...v, cliente: g.cliente }), `Saldo ${peso(g.saldo)} en ${g.n} ${g.n === 1 ? 'factura' : 'facturas'}; la más antigua venció hace ${g.dias} días.`);
  const ultima = (g) => { const x = gest(g.cliente); return x ? `${dia(x.creado)}: ${x.nota.slice(0, 120)}` + (x.promesa ? ` · prometió pagar el ${dia(x.promesa)}` : '') : (g.comentario || ''); };
  return h('div', {},
    hayC ? h('div', { class: 'cobc' }, chips([['', 'Cuentas con nombre'], ['c', `Por conciliar · ${peso(suma(FC, (f) => f.saldo))}`]], S.cobC || '', (v) => { S.cobC = v; })) : null,
    hayC && S.cobC ? h('p', { class: 'note aviso' }, 'Facturas a “Público en general” y de exportación que en Zoho no tienen pago aplicado' + (C.conciliar_antes ? ', y saldos de pedidos de antes de ' + C.conciliar_antes.slice(0, 4) : '') + '. No cuentan en el vencido del equipo: toca a Contabilidad confirmar si se pagaron y conciliarlas.') : null,
    h('div', { class: 'card kpis' }, kpi(peso(total), 'Por cobrar', `${F.length} facturas de ${L.length} clientes`), kpi(peso(T[3][1]), 'Vencido más de 90 días', total ? Math.round(T[3][1] / total * 100) + '% del saldo' : ''),
      C.fuente === 'zoho' ? kpi(L.filter((g) => g.dias > 90).length, 'Clientes con más de 90 días', 'de vencido') : kpi(peso(suma(F, (f) => f.pronostico)), 'Pronóstico de cobro del mes', 'según el archivo de Carlos'), kpi((C.gestiones || []).filter((g) => L.some((x) => x.cliente === g.cliente)).length, 'Gestiones registradas aquí', 'llamadas y promesas de pago')),
    h('div', { class: 'card' }, h('h3', { style: 'margin-top:0' }, 'Antigüedad del saldo'), h('div', { class: 'fases' }, T.map(([t, v, k]) => h('div', {}, h('span', {}, t), h('div', { class: 'barra', role: 'img', 'aria-label': `${t}: ${peso(v)}` }, h('i', { class: k, style: `width:${total ? Math.max(1, v / total * 100) : 0}%` })), h('b', {}, peso(v)))))),
    h('h2', {}, 'Por cliente'),
    h('div', { class: 'card' }, lista('cob2', L, 12, (g) => h('li', {}, h('div', { class: 'l1' }, h('span', {}, g.cliente), h('span', {}, peso(g.saldo))),
      h('div', { class: 'l2' }, pill(g.dias > 90 ? `${g.dias} días vencido` : g.dias > 0 ? `${g.dias} días` : 'Al corriente', g.dias > 90 ? 'bad' : g.dias > 30 ? 'warn' : 'ok'), ` ${g.vendedor} · ${g.n} ${g.n === 1 ? 'factura' : 'facturas'}`),
      h('div', { class: 'l2' }, ultima(g)), h('div', { class: 'acc' }, h('button', { class: 'btn sm sec', onclick: () => gestion(g) }, 'Registrar gestión'))), 'Sin facturas por cobrar.',
      [{ t: 'Cliente', v: (g) => g.cliente, s: (g) => g.cliente.toLowerCase(), cls: 'b' }, ps.length > 1 && { t: 'Vendedor', v: (g) => g.vendedor, s: (g) => g.vendedor, cls: 'nw' }, { t: 'Facturas', v: (g) => g.n, s: (g) => g.n, num: true },
        { t: 'Saldo', v: (g) => peso(g.saldo), s: (g) => g.saldo, num: true }, { t: 'Más antigua', v: (g) => pill(`${g.dias} días`, g.dias > 90 ? 'bad' : g.dias > 30 ? 'warn' : 'ok'), s: (g) => g.dias, num: true },
        C.fuente !== 'zoho' && { t: 'Pronóstico', v: (g) => (g.pronostico ? peso(g.pronostico) : '—'), s: (g) => g.pronostico, num: true }, { t: 'Última gestión', v: ultima, cls: 'mut wide' },
        { t: '', v: (g) => h('button', { class: 'btn sm sec', onclick: () => gestion(g) }, 'Registrar'), cls: 'nw' }])),
    h('p', { class: 'note' }, C.fuente === 'zoho' ? 'Saldos de Zoho: pedidos facturados con saldo pendiente, con los pagos ya aplicados. Se actualizan tres veces al día. El vencimiento se toma a 30 días del pedido.' : `Saldos al ${dia(C.corte)}, del archivo de cobranza de Carlos. Cambia a los saldos de Zoho en la próxima sincronización.`));
}

// ---------------------------------------------------------------- Directorio
const faltan = (d) => [!d.contacto && 'contacto', !d.email && 'correo', !d.telefono && 'teléfono'].filter(Boolean);
function directorio() {
  const A = D().directorio, caja = h('div', {});
  const pinta = () => {
    const q = (S.dirQ || '').toLowerCase(), f = S.dirF || '';
    let L = A.filter((d) => (!S.dirV || d.vendedor === S.dirV) && (!q || `${d.nombre} ${d.contacto} ${d.ciudad} ${d.estado} ${d.email}`.toLowerCase().includes(q)) && (f === 'falta' ? faltan(d).length : f === 'mx' ? d.pais === 'México' : f === 'usa' ? d.pais !== 'México' : true));
    const grupos = [...new Set(L.map((d) => d.zona_nombre || 'Sin zona'))].sort((a, b) => (a.startsWith('Estados') ? 1 : 0) - (b.startsWith('Estados') ? 1 : 0) || a.localeCompare(b));
    caja.replaceChildren(...(L.length ? grupos.flatMap((g) => { const G = L.filter((d) => (d.zona_nombre || 'Sin zona') === g).sort((a, b) => a.nombre.localeCompare(b.nombre));
      return [h('h2', {}, `${g} (${G.length})`), h('div', { class: 'card' }, lista('dir' + g, G, 12, (d) => h('li', { class: 'tapli', onclick: () => { if (!ancho()) editarCuenta(d); } }, h('div', { class: 'l1' }, h('span', {}, d.nombre), faltan(d).length ? pill(faltan(d).length === 1 ? 'Falta 1 dato' : `Faltan ${faltan(d).length} datos`, 'warn') : pill('Completo', 'ok')),
        h('div', { class: 'l2' }, [d.tipo, [d.ciudad, d.estado].filter(Boolean).join(', '), d.vendedor].filter(Boolean).join(' · ')),
        d.contacto || d.telefono || d.email ? h('div', { class: 'l2' }, [d.contacto, d.puesto].filter(Boolean).join(' · '), d.telefono ? [' ', h('a', { href: 'tel:' + d.telefono.replace(/[^\d+]/g, ''), onclick: (e) => e.stopPropagation() }, d.telefono)] : null, d.email ? ' · ' + d.email : null) : null,
        h('div', { class: 'acc' }, h('button', { class: 'btn sm sec', onclick: () => editarCuenta(d) }, faltan(d).length ? 'Completar datos' : 'Editar'))), '',
        [{ t: 'Cuenta', v: (d) => d.nombre, s: (d) => d.nombre.toLowerCase(), cls: 'b' }, { t: 'Tipo', v: (d) => d.tipo || '—', s: (d) => d.tipo }, { t: 'Ciudad', v: (d) => [d.ciudad, d.estado].filter(Boolean).join(', ') || '—', s: (d) => d.ciudad },
          { t: 'Contacto', v: (d) => [d.contacto, d.puesto].filter(Boolean).join(' · ') || '—', s: (d) => d.contacto }, { t: 'Teléfono', v: (d) => d.telefono || '—', cls: 'nw' }, { t: 'Correo', v: (d) => (d.email ? h('a', { href: 'mailto:' + d.email }, d.email) : '—') },
          { t: 'Atiende', v: (d) => d.vendedor, s: (d) => d.vendedor, cls: 'nw' }, { t: 'Falta', v: (d) => (faltan(d).length ? pill(faltan(d).join(', '), 'warn') : pill('Completo', 'ok')), s: (d) => faltan(d).length, cls: 'nw' },
          { t: '', v: (d) => h('button', { class: 'btn sm sec', onclick: () => editarCuenta(d) }, 'Editar'), cls: 'nw' }]))]; }) : [h('p', { class: 'note' }, 'Ninguna cuenta con ese filtro.')]));
  };
  const comp = A.filter((d) => !faltan(d).length).length, busca = h('input', { type: 'search', placeholder: 'Buscar cuenta, contacto o ciudad', 'aria-label': 'Buscar', value: S.dirQ || '', oninput: (ev) => { S.dirQ = ev.target.value; pinta(); } });
  pinta();
  // Who still owes contact details, said plainly: per rep, how many of their accounts are missing a contact, a phone or an email.
  const mx = A.filter((d) => d.pais === 'México'), deuda = ['José Luis', 'Carlos', 'Daniel', 'Tito'].map((v) => ({ v, n: mx.filter((d) => d.vendedor === v && faltan(d).length).length, de: mx.filter((d) => d.vendedor === v).length })).filter((x) => x.n);
  const yo = D().yo.persona, mia = deuda.find((x) => x.v === yo), totalF = deuda.reduce((t, x) => t + x.n, 0);
  const ver = (v) => { S.dirV = v; S.dirF = 'falta'; pintar(); };
  const aviso = totalF ? h('div', { class: 'alert fuerte', role: 'status' }, h('b', {}, mia ? `Te faltan datos en ${mia.n} de tus ${mia.de} cuentas. ` : `Faltan datos de contacto en ${totalF} cuentas. `),
    'Cada una necesita persona de contacto, teléfono y correo.', h('div', { class: 'al-l' }, deuda.map((x) => h('button', { class: 'chip', onclick: () => ver(x.v) }, `${x.v}: ${x.n} de ${x.de}`)),
      S.dirV ? h('button', { class: 'chip', onclick: () => { S.dirV = ''; S.dirF = ''; pintar(); } }, 'Ver todas') : null))
    : h('div', { class: 'alert ok' }, 'Todas las cuentas tienen persona de contacto, teléfono y correo.');
  return h('div', {}, aviso,
    h('div', { class: 'card kpis mini' }, kpi(A.length, 'Cuentas en el libro', `${A.filter((d) => d.pais === 'México').length} en México · ${A.filter((d) => d.pais !== 'México').length} en Estados Unidos`),
      kpi(`${comp} de ${A.length}`, 'Con datos completos', 'contacto, correo y teléfono'), kpi(A.filter((d) => !d.email).length, 'Sin correo'), kpi(A.filter((d) => !d.contacto).length, 'Sin persona de contacto')),
    h('div', { class: 'toolbar' }, busca, chips([['', 'Todas'], ['falta', 'Incompletas'], ['mx', 'México'], ['usa', 'Estados Unidos']], S.dirF || '', (v) => { S.dirF = v; }), h('button', { class: 'btn sm', onclick: () => nuevaCuenta() }, 'Nueva cuenta')),
    caja,
    h('p', { class: 'note' }, 'México: clientes con compras en Zoho; el contacto sale de las notas del CRM hasta que alguien lo corrige aquí. Estados Unidos: cuentas del reporte anual de La Competencia Imports (Texas y Colorado).'),
    (D().usa_envios || []).length ? [h('h2', {}, 'Distribuidores en Estados Unidos (cajas enviadas en 2026)'), h('div', { class: 'card' }, lista('usaenv', D().usa_envios, 10, (e) => h('li', {}, h('div', { class: 'l1' }, h('span', {}, e.cliente), h('span', {}, e.cajas + ' cajas')), h('div', { class: 'l2' }, e.estado)), '',
      [{ t: 'Distribuidor', v: (e) => e.cliente, s: (e) => e.cliente.toLowerCase(), cls: 'b' }, { t: 'Estado', v: (e) => e.estado, s: (e) => e.estado }, { t: 'Cajas', v: (e) => e.cajas, s: (e) => e.cajas, num: true }]))] : null);
}

// ---------------------------------------------------------------- Encuestas
function compartir(e, d) {
  const url = e.url || `${D().encuesta_base}/e/${e.token}`, txt = `Hola, soy ${e.persona} de Bodega Dos Búhos. ¿Nos regalas 20 segundos? Solo dinos si estás contento con nosotros: ${url}`;
  const dlg = document.getElementById('dlg'), copiar = h('button', { type: 'button', class: 'btn sec', onclick: async () => { await navigator.clipboard.writeText(url).catch(() => {}); copiar.textContent = 'Liga copiada'; } }, 'Copiar liga');
  dlg.replaceChildren(h('form', { method: 'dialog' }, h('h2', { id: 'dlg-t' }, `Encuesta para ${e.cliente}`), h('p', { class: 'dnote' }, 'Mándala desde tu teléfono. El cliente toca una cara y, si quiere, escribe por qué.'),
    h('div', { class: 'links' },
      h('a', { href: `https://wa.me/?text=${encodeURIComponent(txt)}`, target: '_blank', rel: 'noopener' }, 'Enviar por WhatsApp', h('span', {}, 'Abre WhatsApp con el mensaje listo; eliges el contacto.')),
      h('a', { href: `mailto:${encodeURIComponent((d && d.email) || '')}?subject=${encodeURIComponent('¿Cómo te va con Dos Búhos?')}&body=${encodeURIComponent(txt)}` }, 'Enviar por correo', h('span', {}, (d && d.email) ? `Para ${d.email}` : 'Sin correo guardado: lo escribes tú.')),
      h('a', { href: url, target: '_blank', rel: 'noopener' }, 'Ver lo que verá el cliente', h('span', {}, url))),
    h('div', { class: 'pie' }, copiar, h('button', { class: 'btn' }, 'Listo'))));
  if (!dlg.open) dlg.showModal();
}
function encuestas() {
  const ps = personas(), E = (D().encuestas || []).filter((e) => ps.includes(e.persona) || e.persona === 'Eric'), resp = E.filter((e) => e.respondida), felices = resp.filter((e) => e.respuesta === 'feliz');
  const hace90 = new Date(Date.parse(D().hoy) - 90 * 864e5).toISOString().slice(0, 10), reciente = new Set(E.filter((e) => e.creada >= hace90).map((e) => e.clave));
  const tocan = D().directorio.filter((d) => d.pais === 'México' && ps.includes(d.vendedor) && d.dias_sin_pedir != null && d.dias_sin_pedir <= 180 && !reciente.has(d.clave)).sort((a, b) => (b.vendido || 0) - (a.vendido || 0));
  const nueva = async (d) => { const r = await api('api/encuestas', { cliente: d.nombre, persona: d.vendedor }); if (r.error) return alert(r.error); await cargar(); compartir({ ...r, cliente: d.nombre, persona: d.vendedor }, d); };
  const est = (e) => (!e.respondida ? pill('Sin responder', 'mute') : e.respuesta === 'feliz' ? pill('Contento', 'ok') : pill('No contento', 'bad'));
  const dDe = (e) => D().directorio.find((d) => d.clave === e.clave);
  return h('div', {},
    h('div', { class: 'card kpis' }, kpi(resp.length ? Math.round(felices.length / resp.length * 100) + '%' : '—', 'Clientes contentos', resp.length ? `${felices.length} de ${resp.length} respuestas` : 'todavía sin respuestas'),
      kpi(resp.filter((e) => e.respuesta === 'no').length, 'No contentos', 'hay que llamarles'), kpi(`${resp.length} de ${E.length}`, 'Respondidas', 'de las enviadas'), kpi(tocan.length, 'Les toca encuesta', 'clientes activos sin encuesta en 90 días')),
    resp.some((e) => e.respuesta === 'no') ? [h('h2', {}, 'No contentos'), h('div', { class: 'card' }, h('ul', { class: 'rows mov' }, resp.filter((e) => e.respuesta === 'no').map((e) => h('li', {}, h('div', { class: 'l1' }, h('span', {}, e.cliente), h('span', { class: 'note' }, dia(e.respondida))), h('div', { class: 'l2' }, e.persona), e.comentario ? h('div', {}, e.comentario) : null))))] : null,
    h('h2', {}, 'Les toca encuesta'), h('p', { class: 'note' }, 'Cada cliente activo, al menos una vez cada 3 meses. Tocas "Enviar", eliges WhatsApp o correo, y el cliente responde con una cara y un comentario.'),
    h('div', { class: 'card' }, lista('enc-toca', tocan, 10, (d) => h('li', {}, h('div', { class: 'l1' }, h('span', {}, d.nombre), h('button', { class: 'btn sm', onclick: () => nueva(d) }, 'Enviar encuesta')), h('div', { class: 'l2' }, [d.vendedor, d.contacto, d.email || 'sin correo guardado'].filter(Boolean).join(' · '))), 'Todos los clientes activos tienen encuesta reciente.',
      [{ t: 'Cliente', v: (d) => d.nombre, s: (d) => d.nombre.toLowerCase(), cls: 'b' }, ps.length > 1 && { t: 'Atiende', v: (d) => d.vendedor, s: (d) => d.vendedor, cls: 'nw' }, { t: 'Contacto', v: (d) => d.contacto || '—' }, { t: 'Correo', v: (d) => d.email || 'sin correo', cls: 'mut' },
        { t: 'Vendido este año', v: (d) => peso(d.vendido), s: (d) => d.vendido, num: true }, { t: '', v: (d) => h('button', { class: 'btn sm', onclick: () => nueva(d) }, 'Enviar encuesta'), cls: 'nw' }])),
    h('h2', {}, 'Enviadas'),
    h('div', { class: 'card' }, lista('enc-env', E, 10, (e) => h('li', {}, h('div', { class: 'l1' }, h('span', {}, e.cliente), est(e)), h('div', { class: 'l2' }, `${e.persona} · enviada el ${dia(e.creada)}` + (e.respondida ? ` · respondió el ${dia(e.respondida)}` : '')), e.comentario ? h('div', { class: 'sug' }, e.comentario) : null,
      !e.respondida ? h('div', { class: 'acc' }, h('button', { class: 'btn sm sec', onclick: () => compartir(e, dDe(e)) }, 'Volver a enviar')) : null), 'Todavía no se manda ninguna encuesta.',
      [{ t: 'Cliente', v: (e) => e.cliente, s: (e) => e.cliente.toLowerCase(), cls: 'b' }, { t: 'Quién', v: (e) => e.persona, s: (e) => e.persona, cls: 'nw' }, { t: 'Enviada', v: (e) => dia(e.creada), s: (e) => e.creada, cls: 'nw' }, { t: 'Respuesta', v: est, s: (e) => e.respuesta || 'z', cls: 'nw' },
        { t: 'Comentario', v: (e) => e.comentario || '—', cls: 'mut wide' }, { t: '', v: (e) => (!e.respondida ? h('button', { class: 'btn sm sec', onclick: () => compartir(e, dDe(e)) }, 'Reenviar') : ''), cls: 'nw' }])));
}

// ---------------------------------------------------------------- Copeo y embudo
function copeo() {
  const ps = personas(), C = D().cuentas || [], porClave = new Map(C.map((c) => [c.clave, c])), norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
  const si = C.filter((c) => c.copeo === 'si'), prop = C.filter((c) => c.copeo === 'propuesto'), no = C.filter((c) => c.copeo === 'no');
  const notas = (D().copeo || []).filter((n) => ps.includes(n.persona) && !(porClave.get(norm(n.cuenta)) || {}).copeo);
  const fila = (c) => h('li', {}, h('div', { class: 'l1' }, h('span', {}, c.nombre), h('button', { class: 'btn sm sec', onclick: () => editarCuenta({ clave: c.clave, nombre: c.nombre }) }, 'Actualizar')), h('div', { class: 'l2' }, [c.copeo_vino || 'vino sin registrar', c.botellas_mes ? `${c.botellas_mes} botellas al mes` : null, c.actualizado ? `actualizado ${dia(c.actualizado)} por ${c.por}` : null].filter(Boolean).join(' · ')));
  const bloque = (t, L, vacio) => h('section', { class: 'card' }, h('div', { class: 'name' }, t, pill(String(L.length), L.length ? 'ok' : 'mute')), L.length ? h('ul', { class: 'rows' }, L.map(fila)) : h('p', { class: 'note' }, vacio));
  const max = Math.max(1, ...D().embudo.filter((e) => ps.includes(e.persona)).flatMap((e) => e.fases.map((f) => f.n)));
  const botellas = suma(C, (c) => c.botellas_mes);
  return h('div', {},
    h('div', { class: 'card kpis' }, kpi(si.length, 'Nos sirven por copa', 'confirmado por el vendedor'), kpi(prop.length, 'Propuesto', 'esperando respuesta'), kpi(notas.length, 'Mencionado en notas', 'falta confirmar'), kpi(botellas ? botellas : '—', 'Botellas al mes estimadas', 'suma de lo que han capturado')),
    h('div', { class: 'grid3' }, bloque('Nos sirven por copa', si, 'Ninguna cuenta confirmada todavía.'), bloque('Propuesto', prop, 'Ninguna propuesta registrada.'), bloque('Dijeron que no', no, 'Ninguna.')),
    h('h2', {}, 'Mencionado en notas: falta confirmar'), h('p', { class: 'note' }, 'El vendedor escribió "copeo" en la nota. Toca "Confirmar" para decir si ya nos sirven por copa, con qué vino y cuántas botellas al mes.'),
    h('div', { class: 'card' }, lista('copeo-n', notas, 10, (n) => h('li', {}, h('div', { class: 'l1' }, h('span', {}, n.cuenta), h('button', { class: 'btn sm', onclick: () => editarCuenta({ clave: norm(n.cuenta), nombre: n.cuenta }, 'Marca el estado del copeo en esta cuenta.') }, 'Confirmar')), h('div', { class: 'l2' }, `${n.persona} · ${dia(n.fecha)}`), h('div', { class: 'l2' }, (n.nota || '').slice(0, 200))), 'No hay menciones sin confirmar.',
      [{ t: 'Cuenta', v: (n) => n.cuenta, s: (n) => n.cuenta.toLowerCase(), cls: 'b' }, { t: 'Quién', v: (n) => n.persona, s: (n) => n.persona, cls: 'nw' }, { t: 'Última mención', v: (n) => dia(n.fecha), s: (n) => n.fecha, cls: 'nw' }, { t: 'Nota', v: (n) => (n.nota || '').slice(0, 200), cls: 'mut wide' },
        { t: '', v: (n) => h('button', { class: 'btn sm', onclick: () => editarCuenta({ clave: norm(n.cuenta), nombre: n.cuenta }, 'Marca el estado del copeo en esta cuenta.') }, 'Confirmar'), cls: 'nw' }])),
    h('h2', {}, 'Embudo: en qué etapa está cada cuenta'), h('p', { class: 'note' }, 'Según la etapa del último registro de cada cuenta abierta. Para que el embudo tenga valor falta el estimado de botellas al mes, que se captura al registrar un contacto o al editar la cuenta.'),
    h('div', { class: 'grid3' }, D().embudo.filter((e) => ps.includes(e.persona)).map((e) => h('section', { class: 'card' }, h('div', { class: 'name' }, e.persona, e.sin_fase ? pill(`${e.sin_fase} sin etapa`, 'warn') : null),
      h('div', { class: 'fases', style: 'margin-top:10px' }, e.fases.map((f) => h('div', {}, h('span', {}, f.fase), h('div', { class: 'barra', role: 'img', 'aria-label': `${f.fase}: ${f.n} cuentas` }, h('i', { style: `width:${f.n / max * 100}%` })), h('b', {}, f.n))))))));
}

// ---------------------------------------------------------------- Materiales
// Files we host on the QR card (hola.dosbuhos.com/docs): pages and size, for the caption under each preview in public/mat/.
const DOCS = { 'Dos-Buhos-Brand-Deck-2025': [16, 3.4], 'Dos-Buhos-Brand-Deck-2025-JP': [16, 3.5], 'Dos-Buhos-Presentacion-Sommeliers-2026': [9, 1.9], 'Dos-Buhos-Fichas-Tecnicas-2025-ES': [22, 3.8], 'Dos-Buhos-Technical-Sheets-2025-EN': [22, 1.8],
  'Dos-Buhos-Kit-de-Prensa-ES': [16, 8.5], 'Dos-Buhos-Press-Kit-EN': [16, 8.5], 'Dos-Buhos-Premios-ES': [1, 0.4], 'Dos-Buhos-Awards-EN': [1, 0.4], 'Dos-Buhos-Press-Photos': [27, 6.6, 'fotos'], 'Dos-Buhos-Logos': [13, 1.5, 'archivos'] };
const VINOS = { aglianico: 'Aglianico Gran Reserva', anaranjado: 'Espontáneo Anaranjado', 'cab-franc': 'Cabernet Franc Gran Reserva', 'cab-sauvignon': 'Cabernet Sauvignon Gran Reserva', chenin: 'Chenin Blanc', 'espumoso-rose': '1524 Espumoso Rosé', grenache: 'Grenache Gran Reserva',
  montepulciano: '1524 Montepulciano', 'mosaico-blanco': '1524 Mosaico Blanco', 'mosaico-tinto': '1524 Mosaico Tinto', petnat: 'Espontáneo Pet Nat', roble: 'Blend Roble', 'rose-1524': '1524 Rosé', sauvignon: 'Sauvignon Blanc', seleccion: 'Selección Especial',
  'semillon-sb': 'Sauvignon Blanc – Semillón', 'tempranillo-1524': '1524 Tempranillo', 'tempranillo-gr': 'Tempranillo Gran Reserva', 'vin-dorange': "1524 Vin d'Orange Amères" };
const HOLA = 'https://hola.dosbuhos.com';
const sinAcento = (t) => String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
// Copy to the clipboard and say so on the button itself.
const copiar = (texto, rotulo = 'Copiar liga') => { const b = h('button', { class: 'linkb', type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(texto); b.textContent = 'Copiado ✓'; } catch { b.textContent = 'No se pudo copiar'; } setTimeout(() => { b.textContent = rotulo; }, 1800); } }, rotulo); return b; };
const mandar = (titulo, url) => (navigator.share ? h('button', { class: 'linkb', type: 'button', onclick: () => navigator.share({ title: titulo, url }).catch(() => {}) }, 'Compartir') : null);
// One document: a preview of its first page when we have one, a plain file tile when we do not.
function docCard(m, admin) {
  const base = (m.url.split('/').pop() || '').replace(/\.(pdf|zip)$/i, ''), info = m.url.startsWith(HOLA + '/docs/') ? DOCS[base] : null, ext = (/\.(pdf|zip)$/i.exec(m.url) || [])[1];
  const tipo = ext ? ext.toUpperCase() : /drive\.google|docs\.google/.test(m.url) ? 'Drive' : 'Liga';
  const meta = info ? `${tipo} · ${info[0]} ${info[2] || (info[0] === 1 ? 'página' : 'páginas')} · ${info[1]} MB` : tipo;
  return h('article', { class: 'doc' },
    h('a', { class: 'thumb' + (info ? '' : ' sin'), href: m.url, target: '_blank', rel: 'noopener', 'aria-label': 'Abrir ' + m.titulo }, info ? h('img', { src: `mat/${base}.webp`, alt: '', loading: 'lazy' }) : h('span', {}, tipo), info ? h('i', {}, tipo) : null),
    h('div', { class: 'dc' }, h('a', { class: 'dt', href: m.url, target: '_blank', rel: 'noopener' }, m.titulo), m.nota ? h('p', { class: 'note' }, m.nota) : null, h('p', { class: 'dm' }, meta),
      h('div', { class: 'da' }, h('a', { href: m.url, target: '_blank', rel: 'noopener' }, 'Abrir'), copiar(m.url), mandar(m.titulo, m.url), admin && m.id ? h('button', { class: 'linkb quita', type: 'button', onclick: () => { if (confirm('¿Quitar este material?')) enviar('api/admin/materiales', { borrar: m.id }); } }, 'Quitar') : null)));
}

function materiales() {
  const M = D().materiales || [], admin = D().yo.admin, tab = S.mat || 'docs';
  const sub = chips([['docs', 'Documentos'], ['botellas', 'Botellas'], ['donde', 'Dónde nos venden']], tab, (v) => { S.mat = v; });
  if (tab === 'botellas') return h('div', { class: 'matp' }, sub, h('p', { class: 'note' }, 'Toca una botella para abrir la foto y guardarla o mandarla.'),
    h('div', { class: 'bots' }, BOTELLAS.map((b) => h('a', { href: `${HOLA}/bottles/${b}.webp`, target: '_blank', rel: 'noopener' }, h('img', { src: `${HOLA}/bottles/${b}.webp`, alt: '', loading: 'lazy' }), h('span', {}, VINOS[b] || b)))));
  if (tab === 'donde') return h('div', { class: 'matp' }, sub, donde());
  const orden = ['Listas de precios', 'Presentaciones', 'Notas de cata', 'Prensa y premios', 'Fotos y logos'], cats = [...new Set([...orden, ...M.map((m) => m.categoria)])].filter((c) => M.some((m) => m.categoria === c));
  const TIT = { 'Notas de cata': 'Fichas técnicas y notas de cata' };
  const f = admin ? h('form', { class: 'inline', style: 'grid-template-columns:1fr', onsubmit: async (ev) => { ev.preventDefault(); const e = await enviar('api/admin/materiales', Object.fromEntries(new FormData(f))); if (e) alert(e); } },
    h('input', { name: 'titulo', placeholder: 'Título (por ejemplo: Lista de precios restaurantes 2027)', required: true, 'aria-label': 'Título' }), h('input', { name: 'url', type: 'url', placeholder: 'Liga https:// (Drive, PDF, carpeta de fotos)', required: true, 'aria-label': 'Liga' }),
    h('select', { name: 'categoria', 'aria-label': 'Categoría' }, ['Listas de precios', 'Presentaciones', 'Notas de cata', 'Fotos y logos', 'Prensa y premios', 'Otros'].map((c) => h('option', {}, c))), h('input', { name: 'nota', placeholder: 'Nota corta (opcional)', 'aria-label': 'Nota' }), h('button', { class: 'btn' }, 'Agregar')) : null;
  return h('div', { class: 'matp' }, sub,
    !M.some((m) => m.categoria === 'Listas de precios') ? h('div', { class: 'alert warn' }, h('b', {}, 'Falta la lista de precios. '), admin ? 'Es lo primero que un vendedor necesita aquí. Agrégala abajo con su liga.' : 'Pídesela a Dirección mientras se sube aquí.') : null,
    cats.map((c) => h('section', {}, h('h2', {}, TIT[c] || c), h('div', { class: 'docs' }, M.filter((m) => m.categoria === c).map((m) => docCard(m, admin))))),
    h('p', { class: 'note', style: 'margin-top:18px' }, 'Los premios y puntajes, vino por vino, están en ', h('a', { href: '#premios' }, 'Recursos → Premios'), '.'),
    admin ? h('details', { class: 'card', style: 'margin-top:18px' }, h('summary', {}, 'Agregar material'), h('p', { class: 'note', style: 'margin:8px 0' }, 'Por ahora son ligas (Drive o un PDF). Los que no tienen vista previa salen con un recuadro sencillo.'), f) : null);
}

// Where Dos Búhos is sold: the same list as the QR card and the press kit (public/marca.js).
function donde() {
  const pais = DONDE.find((d) => d.pais === S.pais) || DONDE[0], n = (g) => new Set(g.filas.flatMap((f) => f[1])).size;
  const texto = (g) => `Dos Búhos · ${g.titulo} en ${pais.pais}\n` + g.filas.map(([r, L]) => (r ? r + ': ' : '') + L.join(', ')).join('\n');
  const caja = h('div', {}, pais.grupos.map((g) => h('section', { class: 'card dg' }, h('div', { class: 'nm' }, h('span', {}, g.titulo, n(g) > 1 ? h('small', {}, ' ' + n(g)) : null), n(g) > 1 ? copiar(texto(g), 'Copiar lista') : null),
    g.filas.map(([r, L]) => h('div', { class: 'dr' + (r ? '' : ' solo') }, r ? h('b', {}, r) : null, h('p', {}, L.map((x, i) => [i ? h('span', { class: 'sep' }, ' · ') : null, h('span', { class: 'lug', 'data-n': sinAcento(x) }, x)])))))));
  const vacio = h('p', { class: 'note', hidden: true }, 'No aparece en esta lista. Revisa el otro país o el Directorio.');
  const q = h('input', { type: 'search', placeholder: '¿Está en…? Busca un restaurante, tienda o distribuidor', 'aria-label': 'Buscar lugar', oninput: () => { const t = sinAcento(q.value.trim()); let hay = 0;
    caja.querySelectorAll('.lug').forEach((e) => { const ok = t && e.dataset.n.includes(t); e.classList.toggle('hit', !!ok); if (ok) hay++; });
    caja.querySelectorAll('.dr').forEach((e) => { e.hidden = !!t && !e.querySelector('.hit'); }); caja.querySelectorAll('.dg').forEach((e) => { e.hidden = !!t && !e.querySelector('.hit'); }); vacio.hidden = !t || hay > 0; } });
  return h('div', {},
    h('div', { class: 'toolbar' }, chips(DONDE.map((d) => [d.pais, d.pais]), pais.pais, (v) => { S.pais = v; }), q),
    h('div', { class: 'card' }, h('div', { class: 'kpis' }, pais.grupos.filter((g) => n(g) > 1).map((g) => kpi(n(g), g.titulo)))),
    vacio, caja,
    h('p', { class: 'note' }, 'Es la misma lista de la tarjeta QR y del kit de prensa. México: CRM y Zoho, corte al 10 de noviembre de 2026. Estados Unidos: reporte de ventas 2026. Si falta o sobra un lugar, avísale a Eric.'));
}

// ---------------------------------------------------------------- Premios y puntajes
const MED = { gg: ['Gran Oro', 4], g: ['Oro', 3], s: ['Plata', 2], b: ['Bronce', 1], m: ['Mérito', 0] };
const pts = (m) => (/pts/.test(m) ? Number(m.split(' ')[0]) : 0);
const corto = (c) => c.replace('Concours Mondial de Bruxelles', 'Bruselas').replace('Los Angeles International Wine Competition', 'Los Ángeles').replace('Los Angeles International · Label Design', 'Los Ángeles').replace(/Bacchus.*/, 'Bacchus').replace(/Guía Catadores.*/, 'Guía Catadores');
// Awards name the vintage; group them under the wine a buyer knows, with its bottle when we have the photo.
const FAMILIA = [['Moscato Giallo Pet Nat', 'Espontáneo Pet Nat', 'petnat'], ['Moscato Giallo', '1524 Moscato Giallo'], ['Anaranjado', 'Espontáneo Anaranjado', 'anaranjado'], ['Grenache', 'Grenache Gran Reserva', 'grenache'], ['Aglianico', 'Aglianico Gran Reserva', 'aglianico'],
  ['Tempranillo', 'Tempranillo Gran Reserva', 'tempranillo-gr'], ['Cabernet Franc', 'Cabernet Franc Gran Reserva', 'cab-franc'], ['Cabernet Sauvignon', 'Cabernet Sauvignon Gran Reserva', 'cab-sauvignon'], ['Sauvignon Blanc', 'Sauvignon Blanc', 'sauvignon'], ['Chenin Blanc', 'Chenin Blanc', 'chenin'],
  ['Espumoso Ros', '1524 Espumoso Rosé', 'espumoso-rose'], ['Espumoso Blanco', '1524 Espumoso Blanco'], ['Mosaico Tinto', '1524 Mosaico Tinto', 'mosaico-tinto'], ['Selección Especial', 'Selección Especial', 'seleccion'], ['Chardonnay', 'Chardonnay']];
function premios() {
  const todos = PREMIOS.flatMap((p) => p.vinos.map(([vino, m]) => ({ vino, m, p, cosecha: (/(?:19|20)\d{2}/.exec(vino) || [''])[0], fam: FAMILIA.find((f) => vino.includes(f[0])) || [vino, vino] })));
  const etq = (x) => x.p.concurso.includes('Label Design'), cuenta = (k) => todos.filter((x) => x.m === k && !etq(x)).length, mejor = todos.reduce((a, x) => (pts(x.m) > pts(a.m) ? x : a)), n90 = new Set(todos.filter((x) => pts(x.m) >= 90).map((x) => x.vino)).size;
  const anio = (p) => (p.anio ? (pts(p.vinos[0][1]) ? 'Edición ' : '') + p.anio : 'Ediciones anteriores');
  const marca = (m) => (pts(m) ? h('b', { class: 'pt' }, pts(m), h('small', {}, 'pts')) : h('i', { class: 'disc ' + m, title: MED[m][0] }));
  const frase = (x) => (pts(x.m) ? `${pts(x.m)} puntos` : MED[x.m][0] + (etq(x) ? ' al diseño de etiqueta' : '')) + ` · ${corto(x.p.concurso)}${x.p.anio ? ' ' + x.p.anio : ''}`;
  const destacados = [todos.find((x) => x.m === 'gg'), mejor, ...todos.filter((x) => x.m === 'g')].filter(Boolean).slice(0, 5);
  const modo = S.prem || 'vino';
  let cuerpo;
  if (modo === 'concurso') cuerpo = h('div', { class: 'pgrid' }, PREMIOS.map((p) => h('section', { class: 'card pc' },
    h('div', { class: 'ph' }, p.icono ? h('img', { src: `mat/${p.icono}.webp`, alt: '', loading: 'lazy' }) : h('span', { class: 'guia' }, 'GC'), h('div', {}, h('b', {}, p.concurso), h('span', { class: 'note' }, anio(p)))),
    h('ul', { class: 'pl' }, p.vinos.map(([v, m]) => h('li', {}, marca(m), h('span', {}, v), pts(m) ? null : h('em', {}, MED[m][0])))))));
  else {
    const G = new Map(); todos.forEach((x) => { const k = x.fam[1]; if (!G.has(k)) G.set(k, { nombre: k, bot: x.fam[2], L: [] }); G.get(k).L.push(x); });
    const peso = (x) => (pts(x.m) ? pts(x.m) / 10 - 6 : MED[x.m][1] + .5), fam = [...G.values()].map((g) => ({ ...g, L: g.L.sort((a, b) => peso(b) - peso(a) || (b.p.anio || 0) - (a.p.anio || 0)) })).sort((a, b) => peso(b.L[0]) - peso(a.L[0]) || b.L.length - a.L.length);
    cuerpo = h('div', { class: 'pgrid' }, fam.map((g) => h('section', { class: 'card pv', 'data-n': sinAcento(g.nombre) },
      g.bot ? h('img', { class: 'bot', src: `${HOLA}/bottles/${g.bot}.webp`, alt: '', loading: 'lazy', onerror: (e) => { e.target.style.visibility = 'hidden'; } }) : h('span', { class: 'bot' }),
      h('div', {}, h('div', { class: 'nm' }, h('span', {}, g.nombre), copiar(`${g.nombre} · Dos Búhos\n` + g.L.map((x) => `${frase(x)}${x.cosecha ? ' (cosecha ' + x.cosecha + ')' : ''}`).join('\n'), 'Copiar')),
        h('ul', { class: 'pl' }, g.L.map((x) => h('li', {}, marca(x.m), h('span', {}, pts(x.m) ? corto(x.p.concurso) + (x.p.anio ? ' ' + x.p.anio : '') : frase(x), null), x.cosecha ? h('em', {}, 'Cosecha ' + x.cosecha) : null)))))));
  }
  const q = modo === 'vino' ? h('input', { type: 'search', placeholder: 'Buscar vino', 'aria-label': 'Buscar vino', oninput: () => { const t = sinAcento(q.value.trim()); cuerpo.querySelectorAll('.pv').forEach((e) => { e.hidden = !!t && !e.dataset.n.includes(t); }); } }) : null;
  const pdf = (base, titulo) => docCard({ url: `${HOLA}/docs/${base}.pdf`, titulo, nota: 'Una hoja para mandar o imprimir' }, false);
  return h('div', { class: 'matp' },
    h('div', { class: 'card' }, h('div', { class: 'kpis' }, kpi(cuenta('gg'), 'Gran Medalla de Oro', 'Bruselas 2024'), kpi(cuenta('g'), 'Medallas de oro'), kpi(cuenta('s'), 'Medallas de plata'), kpi(pts(mejor.m), 'Puntaje más alto', mejor.vino + ' · Guía Catadores'), kpi(n90, 'Vinos con 90 puntos o más', 'Guía Catadores del Vino Mexicano'))),
    h('h2', {}, 'Para abrir la conversación'),
    h('div', { class: 'dest' }, destacados.map((x) => h('div', { class: 'de' }, x.p.icono ? h('img', { src: `mat/${x.p.icono}.webp`, alt: '' }) : h('b', { class: 'pt' }, pts(x.m), h('small', {}, 'pts')), h('div', {}, h('b', {}, pts(x.m) ? `${pts(x.m)} puntos` : MED[x.m][0] === 'Gran Oro' ? 'Gran Medalla de Oro' : 'Medalla de ' + MED[x.m][0].toLowerCase()), h('span', {}, x.vino), h('small', {}, corto(x.p.concurso) + (x.p.anio ? ' ' + x.p.anio : '')))))),
    h('h2', {}, 'Todos los reconocimientos'),
    h('div', { class: 'toolbar' }, chips([['vino', 'Por vino'], ['concurso', 'Por concurso']], modo, (v) => { S.prem = v; }), q),
    cuerpo,
    h('h2', {}, 'Para mandar'), h('div', { class: 'docs' }, pdf('Dos-Buhos-Premios-ES', 'Premios y puntajes (español)'), pdf('Dos-Buhos-Awards-EN', 'Awards and scores (English)')),
    h('p', { class: 'note', style: 'margin-top:14px' }, 'Fuente: la hoja de premios de Dos Búhos y la Guía Catadores del Vino Mexicano de Rodolfo Gerschman. Es la misma lista de la tarjeta QR y el kit de prensa.'));
}

// ---------------------------------------------------------------- Comunicaciones (what is coming)
function comunicaciones() {
  const b = (t, estado, ...p) => h('section', { class: 'card prox' }, h('div', { class: 'name' }, t, pill(estado, 'mute')), p.map((x) => h('p', { style: 'margin-top:8px' }, x)));
  return h('div', {},
    h('div', { class: 'alert warn' }, h('b', {}, 'Próximamente. '), 'Hoy la comunicación con clientes vive en el WhatsApp y el correo personal de cada vendedor. La meta: que toda pase por canales de Dos Búhos y se pueda leer aquí, cuenta por cuenta.'),
    h('div', { class: 'cols2' },
      b('WhatsApp de ventas', 'Por construir', 'Un solo número de WhatsApp Business para ventas. Los pedidos y mensajes de clientes llegan a una bandeja compartida, se asignan al vendedor de la cuenta y quedan ligados a esa cuenta en Spark.',
        'Dirección puede leer cada conversación y mandar avisos a clientes (lanzamientos, promociones, recordatorio de pedido) con plantillas aprobadas.', 'Tecnología: WhatsApp Business Platform (API oficial de Meta) con respond.io como bandeja, conectado a Spark por webhooks. Falta decidir el número y quién contesta fuera de horario.'),
      b('Correo de ventas', 'Por construir', 'Cada vendedor con correo @dosbuhos.com. Spark lee esos buzones y marca lo que se está cayendo: correos de clientes sin respuesta en 2 días, cotizaciones sin seguimiento, pedidos sin confirmar.',
        'Los correos con clientes se registran solos como contactos, sin que el vendedor los capture.', 'Tecnología: Gmail de Google Workspace con acceso delegado al dominio. Requiere que José Luis deje de usar su Gmail personal para ventas.'),
      b('Prospectos nuevos', 'Por construir', 'Lo que entra por el sitio, Instagram, el WhatsApp de ventas o una tarjeta QR aparece aquí como prospecto, se asigna a un vendedor y arranca su seguimiento con fecha.', 'Tecnología: formularios del sitio y webhooks de respond.io hacia Spark.'),
      b('Pedidos de clientes', 'En la ruta', 'Una página sencilla para que el cliente haga su pedido desde el teléfono: su lista de precios, sus vinos de siempre, repetir el último pedido. El pedido entra a Zoho y le avisa al vendedor.', 'Con eso se pueden mandar avisos a los clientes que la instalen. Tecnología: app web instalable sobre Cloudflare Workers, como Spark.')),
    h('h2', {}, 'Qué falta decidir'),
    h('div', { class: 'card' }, h('ul', { class: 'foco' }, ['¿Número nuevo para el WhatsApp de ventas o se migra uno existente? Migrar un número a la API lo saca de la app normal de WhatsApp.', '¿respond.io o Bonnie para la bandeja? Bonnie ya contesta reservaciones; respond.io está pensado para equipos de ventas.', 'Correo @dosbuhos.com para José Luis y Daniel.', '¿Quién puede mandar avisos masivos a clientes?'].map((t) => h('li', { class: 'meta' }, h('span', { style: 'color:var(--text)' }, t))))));
}

// ---------------------------------------------------------------- Estrategia, metas y promociones
// A promotion with a target per account: who already earned it, who is one order away, and who has not bought in the period.
// Amounts are Zoho order totals, with taxes, like the targets in the letter that went to the clients.
function avancePromo(p, hoy) {
  const A = p.avance.map((a) => ({ ...a, falta: Math.max(0, Math.round(a.objetivo - a.lleva)), pc: a.objetivo ? Math.round(a.lleva / a.objetivo * 100) : 0 }));
  const gano = A.filter((a) => !a.falta), cerca = A.filter((a) => a.falta && a.pc >= 90), nada = A.filter((a) => !a.lleva), lleva = suma(A, (a) => a.lleva), obj = suma(A, (a) => a.objetivo);
  const dias = Math.max(0, Math.round((new Date(p.fin + 'T12:00:00') - new Date(hoy + 'T12:00:00')) / 864e5)), mio = (a) => S.persona && a.vendedor === S.persona;
  const orden = [...A.filter((a) => a.falta && a.lleva).sort((x, y) => x.falta - y.falta), ...nada.sort((x, y) => y.objetivo - x.objetivo), ...gano];
  const estado = (a) => (!a.falta ? pill('Ya lo ganó', 'ok') : !a.lleva ? pill('Sin compras', 'bad') : a.pc >= 90 ? pill('A un pedido', 'warn') : pill(a.pc + '%', 'mute'));
  return h('section', { class: 'card bono' }, h('div', { class: 'name' }, 'Avance por cuenta · ' + p.nombre, pill(dias ? `Quedan ${dias} días` : 'Terminó', dias > 14 ? 'mute' : 'warn')),
    h('p', { class: 'note' }, `${gano.length} ya lo ganaron, ${cerca.length} están a un pedido y ${nada.length} no han comprado en el periodo. Entre todas llevan ${peso(lleva)} de ${peso(obj)} (${obj ? Math.round(lleva / obj * 100) : 0}%). Pedidos de Zoho con impuestos, como los objetivos de la carta; quien tenga saldo vencido al cierre lo pierde.`),
    h('ul', { class: 'rows bn' }, orden.map((a) => h('li', { class: mio(a) ? 'mio' : '' }, h('div', { class: 'l1' }, h('span', {}, a.cuenta), estado(a)),
      h('div', { class: 'l2' }, [a.vendedor, `lleva ${peso(a.lleva)} de ${peso(a.objetivo)}`, a.falta ? `le faltan ${peso(a.falta)}` : `pasó el objetivo por ${peso(a.lleva - a.objetivo)}`].filter(Boolean).join(' · ')),
      a.vencido ? h('div', { class: 'l2 venc' }, `Tiene ${peso(a.vencido)} vencido: si no lo paga antes del cierre, pierde el bono.`) : null))));
}
const MESN = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const promoEstado = (p, hoy) => (p.fin && p.fin < hoy ? ['Terminó', 'mute'] : p.inicio && p.inicio > hoy ? ['Próxima', 'warn'] : ['Vigente', 'ok']);
function estrategia() {
  const d = D(), admin = d.yo.admin, hoy = d.hoy, Y = hoy.slice(0, 4), mesHoy = Number(hoy.slice(5, 7));
  const E = d.estrategia || [], P = d.promociones || [], metas = E.filter((e) => e.tipo === 'meta'), docs = E.filter((e) => e.tipo !== 'meta');
  const real = (v, m) => Math.round(suma(d.ordenes.filter((o) => o.vendedor === v && o.fecha.slice(0, 4) === Y && Number(o.fecha.slice(5, 7)) === m), (o) => o.total) / 1.4674);   // before IEPS and IVA, like the goals
  const vis = (t, x) => (admin ? h('button', { class: 'linkb note', onclick: () => enviar(`api/admin/${t}`, { visible_id: x.id, visible: !x.visible }) }, x.visible ? 'Visible para el equipo' : 'Solo administradores') : null);
  const quitar = (t, x) => (admin ? h('button', { class: 'linkb note', onclick: () => { if (confirm('¿Quitar?')) enviar(`api/admin/${t}`, { borrar: x.id }); } }, 'Quitar') : null);
  const nuevoDoc = (tipo) => formulario(tipo === 'meta' ? 'Nueva meta' : 'Nuevo documento de estrategia', [{ k: 'titulo', t: tipo === 'meta' ? 'Meta' : 'Título', req: true, ph: tipo === 'meta' ? 'Por ejemplo: 40 cuentas con copeo al cierre de 2027' : 'Plan comercial 2027' },
    { k: 'url', t: 'Liga al documento (opcional)', tipo: 'url', ph: 'https://' }, { k: 'nota', t: tipo === 'meta' ? 'Cómo se mide y para cuándo' : 'De qué trata', tipo: 'textarea' },
    { k: 'anio', t: 'Año', tipo: 'number', v: Y, mitad: true }, { k: 'visible', t: 'Quién lo ve', tipo: 'select', ops: [['no', 'Solo administradores'], ['si', 'Todo el equipo']], v: 'no', mitad: true }], (v) => enviar('api/admin/estrategia', { ...v, tipo }));
  // The original document travels as base64 inside the JSON body.
  const aB64 = (f) => new Promise((ok, mal) => { const r = new FileReader(); r.onload = () => ok({ nombre: f.name, mime: f.type, b64: String(r.result).split(',')[1] }); r.onerror = () => mal(new Error('No se pudo leer el documento')); r.readAsDataURL(f); });
  const conArchivo = async (v) => { const f = v.archivo; delete v.archivo; if (f && f.size) v.archivo = await aB64(f); return v; };
  const adjuntar = (p) => formulario(p.archivo_id ? 'Cambiar el documento original' : 'Adjuntar el documento original', [{ k: 'archivo', t: 'Documento (PDF, PNG o JPG, hasta 1.5 MB)', tipo: 'file', req: true }], async (v) => enviar('api/admin/promociones', { archivo_para: p.id, ...(await conArchivo(v)) }), p.nombre);
  const nuevaPromo = () => formulario('Nueva promoción', [{ k: 'nombre', t: 'Promoción', req: true, ph: 'Por ejemplo: 6 + 1 en Mosaico Blanco' }, { k: 'resumen', t: 'La oferta en una línea', ph: '1 botella sin costo por cada 6 de la misma etiqueta' }, { k: 'detalle', t: 'Condiciones completas: etiquetas, vigencia, cómo se valida', tipo: 'textarea' }, { k: 'archivo', t: 'Documento original (PDF, opcional)', tipo: 'file' }, { k: 'aplica', t: 'A quién aplica', ph: 'Restaurantes de San Miguel, distribuidores, todos' },
    { k: 'inicio', t: 'Empieza', tipo: 'date', mitad: true }, { k: 'fin', t: 'Termina', tipo: 'date', mitad: true }, { k: 'autorizo', t: 'Quién la autorizó', v: d.yo.nombre || '', mitad: true }, { k: 'autorizada', t: 'Fecha de autorización', tipo: 'date', v: hoy, mitad: true },
    { k: 'visible', t: 'Quién la ve', tipo: 'select', ops: [['si', 'Todo el equipo'], ['no', 'Solo administradores']], v: 'si' }], async (v) => enviar('api/admin/promociones', await conArchivo(v)));
  const vend = ['José Luis', 'Carlos'].filter((v) => (d.presupuesto.meses[v] || []).length);
  const filas = MESN.map((n, i) => ({ mes: n, i, ...Object.fromEntries(vend.flatMap((v) => [[v + '_p', d.presupuesto.meses[v][i]], [v + '_r', i + 1 <= mesHoy ? real(v, i + 1) : null]])) }));
  const pct = (r, p) => (r == null || !p ? '—' : h('span', { class: r >= p ? 'up' : r >= p * 0.6 ? '' : 'down' }, Math.round(r / p * 100) + '%'));
  const otros = Object.entries(d.presupuesto.meses).filter(([k]) => !vend.includes(k));
  return h('div', {},
    !admin && !E.length && !P.length ? h('p', { class: 'note', style: 'margin-bottom:12px' }, 'Dirección todavía no comparte documentos ni promociones aquí. Abajo está el presupuesto del año.') : null,
    h('h2', {}, 'Promociones'), admin ? h('div', { class: 'toolbar' }, h('button', { class: 'btn sm', onclick: nuevaPromo }, 'Agregar promoción')) : null,
    P.length ? h('div', { class: 'promos' }, P.map((p) => h('section', { class: 'card promo' },
      h('div', { class: 'name' }, p.nombre, pill(...promoEstado(p, hoy))),
      h('div', { class: 'l2' }, [p.inicio || p.fin ? `${p.inicio ? dia(p.inicio) + ' ' + p.inicio.slice(0, 4) : '?'} a ${p.fin ? dia(p.fin) + ' ' + p.fin.slice(0, 4) : 'sin fecha de fin'}` : 'Sin fechas', p.aplica].filter(Boolean).join(' · ')),
      p.resumen ? h('p', { class: 'pres' }, p.resumen) : null,
      p.detalle ? (p.resumen ? h('details', {}, h('summary', {}, 'Condiciones completas'), h('div', { class: 'pdet' }, p.detalle)) : h('div', { class: 'pdet' }, p.detalle)) : null,
      p.archivo_id ? h('p', {}, h('a', { class: 'btn sm sec', href: `api/archivo/${p.archivo_id}`, target: '_blank', rel: 'noopener' }, 'Abrir el documento original')) : null,
      h('div', { class: 'l2' }, p.autorizo || p.autorizada ? `Autorizó ${p.autorizo || '?'}` + (p.autorizada ? ` el ${dia(p.autorizada)} ${p.autorizada.slice(0, 4)}` : '') : 'Sin registro de quién la autorizó',
        admin ? [' · ', h('button', { class: 'linkb note', onclick: () => adjuntar(p) }, p.archivo_id ? 'Cambiar documento' : 'Adjuntar documento'), ' · ', vis('promociones', p), ' · ', quitar('promociones', p)] : null))))
      : h('p', { class: 'note' }, admin ? 'Todavía no hay promociones registradas. Agrega las vigentes y las pasadas, con quién las autorizó y cuándo.' : 'No hay promociones vigentes.'),
    P.filter((p) => p.avance && p.avance.length).map((p) => avancePromo(p, hoy)),
    h('h2', {}, `Metas ${Y}`), admin ? h('div', { class: 'toolbar' }, h('button', { class: 'btn sm', onclick: () => nuevoDoc('meta') }, 'Agregar meta')) : null,
    metas.length ? h('div', { class: 'cols2' }, metas.map((e) => h('section', { class: 'card' }, h('div', { class: 'name' }, e.titulo, e.anio ? pill(String(e.anio), 'mute') : null), e.nota ? h('p', { style: 'margin-top:6px' }, e.nota) : null,
      e.url ? h('p', { style: 'margin-top:6px' }, h('a', { href: e.url, target: '_blank', rel: 'noopener' }, 'Abrir documento')) : null, h('p', { class: 'note', style: 'margin-top:8px' }, vis('estrategia', e), ' ', quitar('estrategia', e))))) : h('p', { class: 'note' }, admin ? 'Sin metas escritas todavía, fuera del presupuesto de abajo.' : 'Dirección no ha compartido metas aquí, fuera del presupuesto de abajo.'),
    h('h2', {}, `Presupuesto de ventas ${d.presupuesto.anio}`), h('p', { class: 'note' }, 'Metas antes de impuestos. "Real" son los pedidos en Zoho sin IEPS ni IVA, sin cuentas de la casa ni muestras.'),
    (ancho() ? [vend] : vend.map((v) => [v])).map((vend) => h('div', { class: 'card' }, h('div', { class: 'tblwrap' }, h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, h('th', {}, 'Mes'), vend.flatMap((v) => [h('th', { class: 'r' }, v + (ancho() ? ' · presupuesto' : ' · ppto.')), h('th', { class: 'r' }, 'Real'), h('th', { class: 'r' }, '%')]))),
      h('tbody', {}, filas.map((f) => h('tr', {}, h('td', { class: 'b' }, f.mes), vend.flatMap((v) => [h('td', { class: 'r' }, peso(f[v + '_p'])), h('td', { class: 'r' }, f[v + '_r'] == null ? '—' : peso(f[v + '_r'])), h('td', { class: 'r' }, pct(f[v + '_r'], f[v + '_p']))]))),
        h('tr', {}, h('td', { class: 'b' }, `Acumulado a ${MESN[mesHoy - 1].toLowerCase()}`), vend.flatMap((v) => { const p = suma(filas.slice(0, mesHoy), (f) => f[v + '_p']), r = suma(filas.slice(0, mesHoy), (f) => f[v + '_r']); return [h('td', { class: 'r b' }, peso(p)), h('td', { class: 'r b' }, peso(r)), h('td', { class: 'r b' }, pct(r, p))]; })),
        h('tr', {}, h('td', { class: 'b' }, 'Año completo'), vend.flatMap((v) => [h('td', { class: 'r b' }, peso(suma(filas, (f) => f[v + '_p']))), h('td', {}), h('td', {})]))))))),
    otros.length ? h('p', { class: 'note' }, 'Otros renglones del presupuesto anual: ' + otros.map(([k, v]) => `${k} ${peso(suma(v, (x) => x))}`).join(' · ') + '.') : null,
    h('h2', {}, 'Documentos de estrategia'), admin ? h('div', { class: 'toolbar' }, h('button', { class: 'btn sm', onclick: () => nuevoDoc('documento') }, 'Agregar documento')) : null,
    docs.length ? h('div', { class: 'card' }, h('div', { class: 'links' }, docs.map((e) => h('div', {}, e.url ? h('a', { href: e.url, target: '_blank', rel: 'noopener' }, e.titulo, e.nota ? h('span', {}, e.nota) : null) : h('div', {}, h('b', {}, e.titulo), e.nota ? h('div', { class: 'note' }, e.nota) : null),
      h('span', { class: 'note' }, vis('estrategia', e), ' ', quitar('estrategia', e)))))) : h('p', { class: 'note' }, admin ? 'Sin documentos todavía. Por ahora se agregan como liga (Drive o PDF); nacen visibles solo para administradores.' : 'Dirección no ha compartido documentos aquí.'));
}

// ---------------------------------------------------------------- Distribuidores
// Distributor scouting: who is being worked, where it stands and when it was last touched. The list itself is kept in the
// "Distribuidores" tab of the CRM sheet; contacts logged here count too.
function distribuidores() {
  const d = D(), L0 = d.prospectos.filter((p) => p.de_carlos), f = S.distF || 'En proceso', zn = new Map(d.zonas.map((z) => [z.zona, z.nombre.split(' (')[0]]));
  const es = (p, g) => (g === 'frio' ? ['En proceso', 'Catalogado'].includes(p.avance) && p.dias > 30 : g === 'Rechazado' ? p.avance === 'Rechazado' : p.avance === g);
  const n = (g) => L0.filter((p) => es(p, g)).length, K = { 'En proceso': 'warn', Catalogado: 'ok', 'Por contactar': 'mute', Rechazado: 'bad' };
  const L = L0.filter((p) => es(p, f)).sort((a, b) => (b.dias ?? -1) - (a.dias ?? -1));
  const cuando = (p) => (p.ultimo_contacto ? `${dia(p.ultimo_contacto)} · hace ${p.dias} días` : 'Nunca');
  const tocar = (p) => registrar({ cuenta: p.nombre, actividad: 'Prospección', ultimo_contacto: p.ultimo_contacto, dias_sin_contacto: p.dias, ultima_nota: [p.status, p.paso, p.siguiente].filter(Boolean).join(' · '), persona: S.persona || d.yo.persona || (p.responsable === 'Carlos' && d.yo.admin ? 'Tito' : p.responsable) });
  const hoja = d.crm_hoja ? `https://docs.google.com/spreadsheets/d/${d.crm_hoja}/edit#gid=120` : null;
  // Coverage by zone: who distributes for us there today (from the zone table, fed by Zoho sales) next to the prospect list for that zone.
  // The prospect list alone read as "no distributors" in zones where we already sell (Los Cabos has Cactus Wine and no prospects).
  const KZ = { Fuerte: 'ok', 'Presencia débil': 'warn', 'Sin presencia': 'bad' };
  const filaZ = (x) => h('li', {},
    h('div', { class: 'l1' }, h('span', {}, x.z), pill(x.zo.estado, KZ[x.zo.estado])),
    h('div', { class: 'l2' }, 'Hoy nos distribuye: ' + x.hoy),
    h('div', { class: 'l2' }, x.pros));
  const porZona = d.zonas.map((z) => { const Lz = L0.filter((p) => p.zona === z.zona), c = (g) => Lz.filter((p) => p.avance === g).length, u = Lz.reduce((m, p) => (p.ultimo_contacto && p.ultimo_contacto > m ? p.ultimo_contacto : m), '');
    return { z: z.nombre.split(' (')[0], zo: z, L: Lz, c, u, hoy: z.distribuidores || 'Nadie',
      pros: Lz.length ? `Prospectos: ${c('En proceso')} en proceso · ${c('Catalogado')} catalogados · ${c('Por contactar')} por contactar · ${c('Rechazado')} rechazados · último contacto ${u ? dia(u) : 'nunca'}` : 'Sin prospectos en la lista' }; });
  return h('div', {},
    h('div', { class: 'card kpis mini' }, kpi(n('En proceso'), 'En proceso', `${n('frio')} sin contacto en más de 30 días`), kpi(n('Catalogado'), 'Catalogados', 'ya nos compran o están por hacerlo'),
      kpi(n('Por contactar'), 'Por contactar', 'identificados, sin primer contacto'), kpi(n('Rechazado'), 'Rechazados', `${L0.filter((p) => /dos b[uú]hos/i.test(p.motivo + ' ' + p.siguiente)).length} por decisión nuestra`)),
    h('details', { class: 'nota' }, h('summary', {}, 'De dónde sale esta lista'), h('p', { class: 'note' }, 'La lista vive en la pestaña "Distribuidores" de la hoja del CRM; Spark la lee tres veces al día. ',
      'Un contacto registrado aquí, tocando el renglón, actualiza la fecha de inmediato. ', hoja ? h('a', { href: hoja, target: '_blank', rel: 'noopener' }, 'Abrir la hoja') : null, d.dist_fuente === 'archivo' ? ' · Mostrando el archivo de Carlos del 21 de noviembre; cambia a la hoja en la próxima sincronización.' : '')),
    h('div', { class: 'toolbar' }, chips([['En proceso', `En proceso ${n('En proceso')}`], ['frio', `Fríos ${n('frio')}`], ['Catalogado', `Catalogados ${n('Catalogado')}`], ['Por contactar', `Por contactar ${n('Por contactar')}`], ['Rechazado', `Rechazados ${n('Rechazado')}`]], f, (v) => { S.distF = v; }), h('button', { class: 'btn sm', onclick: () => nuevaCuenta({ titulo: 'Nuevo distribuidor', tipo: 'Distribuidor' }) }, 'Nuevo distribuidor')),
    h('div', { class: 'card' }, lista('dist', L, 12, (p) => h('li', toca(() => tocar(p)),
      h('div', { class: 'l1' }, h('span', {}, p.nombre), pill(p.avance, K[p.avance])),
      h('div', { class: 'l2' }, [p.plaza, zn.get(p.zona), p.tipo, p.responsable].filter(Boolean).join(' · ')),
      p.status || p.paso ? h('div', { class: 'l2' }, [p.status, p.paso].filter(Boolean).join(' · ')) : null,
      p.contacto || p.telefono || p.email ? h('div', { class: 'l2' }, [p.contacto, p.telefono, p.email].filter(Boolean).join(' · ')) : null,
      h('div', { class: 'l2' }, 'Último contacto: ' + cuando(p) + (p.contacto_por && p.ultimo_contacto ? ` · ${p.contacto_por}` : '') + (p.siguiente ? ` · Siguiente: ${p.siguiente}` : '') + (p.proximo ? ` · próximo ${dia(p.proximo)}` : ''))), 'Ninguno en este grupo.',
      [{ t: 'Distribuidor', v: (p) => [p.nombre, h('div', { class: 'note' }, [p.plaza, p.tipo].filter(Boolean).join(' · '))], s: (p) => p.nombre.toLowerCase(), cls: 'b' }, { t: 'Zona', v: (p) => zn.get(p.zona), s: (p) => p.zona, cls: 'nw' },
        { t: 'Estado', v: (p) => pill(p.avance, K[p.avance]), s: (p) => p.avance, cls: 'nw' }, { t: 'Último contacto', v: (p) => [cuando(p), p.contacto_por && p.ultimo_contacto ? h('div', { class: 'note' }, p.contacto_por) : null], s: (p) => p.ultimo_contacto || null, cls: 'nw' },
        { t: f === 'Rechazado' ? 'Motivo' : 'Qué pasó', v: (p) => [p.status, p.paso].filter(Boolean).join(' · ') || '—', largo: true }, { t: 'Siguiente paso', v: (p) => (p.siguiente || p.proximo ? [p.siguiente || '', p.proximo ? h('span', { class: 'note' }, (p.siguiente ? ' · ' : '') + 'próximo ' + dia(p.proximo)) : null] : '—'), largo: true },
        { t: 'Contacto', v: (p) => [p.contacto, p.telefono, p.email].filter(Boolean).join(' · ') || '—', largo: true }, { t: 'Línea', v: (p) => p.linea || '—', cls: 'nw' }], tocar)),
    h('h2', {}, 'Cobertura por zona'),
    h('p', { class: 'note' }, 'Quién nos distribuye hoy en cada zona y cómo va la lista de prospectos de esa zona. Los distribuidores de hoy salen de las ventas; los prospectos, de la hoja.'),
    // Nine zones: on a phone all of them show (lista() would fold the ninth behind "Ver los 9", and that one is Los Cabos).
    h('div', { class: 'card' }, !ancho() ? h('ul', { class: 'rows' }, porZona.map(filaZ)) : lista('cobz', porZona, 9, filaZ, 'Sin zonas.',
      [{ t: 'Zona', v: (x) => x.z, s: (x) => x.z, cls: 'b' }, { t: 'Presencia', v: (x) => pill(x.zo.estado, KZ[x.zo.estado]), s: (x) => x.zo.estado, cls: 'nw' },
        { t: 'En proceso', v: (x) => x.c('En proceso'), s: (x) => x.c('En proceso'), num: true }, { t: 'Catalogados', v: (x) => x.c('Catalogado'), s: (x) => x.c('Catalogado'), num: true },
        { t: 'Por contactar', v: (x) => x.c('Por contactar'), s: (x) => x.c('Por contactar'), num: true }, { t: 'Rechazados', v: (x) => x.c('Rechazado'), s: (x) => x.c('Rechazado'), num: true },
        { t: 'Último contacto', v: (x) => (x.u ? dia(x.u) : x.L.length ? 'Nunca' : 'Sin prospectos'), s: (x) => x.u || null, cls: 'nw' },
        { t: 'Hoy nos distribuye', v: (x) => x.hoy, largo: true }])));
}

export const MAS_VISTAS = { cobranza, directorio, encuestas, copeo, materiales, premios, comunicaciones, estrategia, distribuidores };
