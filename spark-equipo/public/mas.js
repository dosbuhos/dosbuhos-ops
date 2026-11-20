// Spark CRM — the account-side screens: collections, client book, surveys, by-the-glass and pipeline, sales materials, and
// what is coming for client communications. Helpers come from app.js; data from /api/data.
import { h, lista, pill, chips, peso, dia, S, personas, vendedores, formulario, enviar, pintar, datos, api, cargar } from './app.js';

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
    { k: 'botellas_mes', t: 'Botellas al mes que podría comprar', tipo: 'number', v: e.botellas_mes || '' },
    { k: 'notas', t: 'Notas', tipo: 'textarea', v: e.notas || '' },
  ], (f) => enviar('api/cuenta', { ...f, nombre: base.nombre }), foco || 'Lo que guardes aquí lo ve todo el equipo.');
}

// ---------------------------------------------------------------- Cobranza
function cobranza() {
  const ps = personas(), C = D().cobranza, F = C.facturas.filter((f) => !S.persona || f.vendedor === S.persona);
  const grupos = new Map();
  for (const f of F) { const g = grupos.get(f.cliente) || { cliente: f.cliente, vendedor: f.vendedor, n: 0, saldo: 0, dias: 0, pronostico: 0, comentario: '' }; g.n++; g.saldo += f.saldo; g.dias = Math.max(g.dias, f.dias || 0); g.pronostico += f.pronostico; if (f.comentario) g.comentario = f.comentario; grupos.set(f.cliente, g); }
  const L = [...grupos.values()].sort((a, b) => b.saldo - a.saldo), total = suma(F, (f) => f.saldo);
  const tramo = (a, b) => suma(F.filter((f) => (f.dias || 0) > a && (f.dias || 0) <= b), (f) => f.saldo), T = [['Hasta 30 días', tramo(-1e9, 30), 'ok'], ['31 a 60', tramo(30, 60), 'warn'], ['61 a 90', tramo(60, 90), 'warn'], ['Más de 90', tramo(90, 1e9), 'bad']];
  const gest = (c) => (C.gestiones || []).find((g) => g.cliente === c);
  const gestion = (g) => formulario(`Gestión de cobro: ${g.cliente}`, [{ k: 'nota', t: 'Qué pasó', tipo: 'textarea', req: true, ph: 'Con quién hablaste y qué dijo' }, { k: 'promesa', t: 'Fecha en que prometió pagar', tipo: 'date', mitad: true }, { k: 'monto', t: 'Monto prometido', tipo: 'number', mitad: true }],
    (v) => enviar('api/cobros', { ...v, cliente: g.cliente }), `Saldo ${peso(g.saldo)} en ${g.n} ${g.n === 1 ? 'factura' : 'facturas'}; la más antigua venció hace ${g.dias} días.`);
  const ultima = (g) => { const x = gest(g.cliente); return x ? `${dia(x.creado)}: ${x.nota.slice(0, 120)}` + (x.promesa ? ` · prometió pagar el ${dia(x.promesa)}` : '') : (g.comentario || '—'); };
  return h('div', {},
    h('div', { class: 'card kpis' }, kpi(peso(total), 'Por cobrar', `${F.length} facturas de ${L.length} clientes`), kpi(peso(T[3][1]), 'Vencido más de 90 días', total ? Math.round(T[3][1] / total * 100) + '% del saldo' : ''),
      kpi(peso(suma(F, (f) => f.pronostico)), 'Pronóstico de cobro del mes', 'según el archivo de Carlos'), kpi((C.gestiones || []).filter((g) => L.some((x) => x.cliente === g.cliente)).length, 'Gestiones registradas aquí', 'llamadas y promesas de pago')),
    h('div', { class: 'card' }, h('h3', { style: 'margin-top:0' }, 'Antigüedad del saldo'), h('div', { class: 'fases' }, T.map(([t, v, k]) => h('div', {}, h('span', {}, t), h('div', { class: 'barra', role: 'img', 'aria-label': `${t}: ${peso(v)}` }, h('i', { class: k, style: `width:${total ? Math.max(1, v / total * 100) : 0}%` })), h('b', {}, peso(v)))))),
    h('h2', {}, 'Por cliente'),
    h('div', { class: 'card' }, lista('cob2', L, 12, (g) => h('li', {}, h('div', { class: 'l1' }, h('span', {}, g.cliente), h('span', {}, peso(g.saldo))),
      h('div', { class: 'l2' }, pill(g.dias > 90 ? `${g.dias} días vencido` : g.dias > 0 ? `${g.dias} días` : 'Al corriente', g.dias > 90 ? 'bad' : g.dias > 30 ? 'warn' : 'ok'), ` ${g.vendedor} · ${g.n} ${g.n === 1 ? 'factura' : 'facturas'}`),
      h('div', { class: 'l2' }, ultima(g)), h('div', { class: 'acc' }, h('button', { class: 'btn sm sec', onclick: () => gestion(g) }, 'Registrar gestión'))), 'Sin facturas por cobrar.',
      [{ t: 'Cliente', v: (g) => g.cliente, s: (g) => g.cliente.toLowerCase(), cls: 'b' }, ps.length > 1 && { t: 'Vendedor', v: (g) => g.vendedor, s: (g) => g.vendedor, cls: 'nw' }, { t: 'Facturas', v: (g) => g.n, s: (g) => g.n, num: true },
        { t: 'Saldo', v: (g) => peso(g.saldo), s: (g) => g.saldo, num: true }, { t: 'Más antigua', v: (g) => pill(`${g.dias} días`, g.dias > 90 ? 'bad' : g.dias > 30 ? 'warn' : 'ok'), s: (g) => g.dias, num: true },
        { t: 'Pronóstico', v: (g) => (g.pronostico ? peso(g.pronostico) : '—'), s: (g) => g.pronostico, num: true }, { t: 'Última gestión', v: ultima, cls: 'mut wide' },
        { t: '', v: (g) => h('button', { class: 'btn sm sec', onclick: () => gestion(g) }, 'Registrar'), cls: 'nw' }])),
    h('p', { class: 'note' }, `Saldos al ${dia(C.corte)}, del archivo de cobranza de Carlos. Todavía no se actualizan solos: para eso Spark necesita permiso de leer facturas en Zoho.`));
}

// ---------------------------------------------------------------- Directorio
const faltan = (d) => [!d.contacto && 'contacto', !d.email && 'correo', !d.telefono && 'teléfono'].filter(Boolean);
function directorio() {
  const A = D().directorio, caja = h('div', {});
  const pinta = () => {
    const q = (S.dirQ || '').toLowerCase(), f = S.dirF || '';
    let L = A.filter((d) => (!q || `${d.nombre} ${d.contacto} ${d.ciudad} ${d.estado} ${d.email}`.toLowerCase().includes(q)) && (f === 'falta' ? faltan(d).length : f === 'mx' ? d.pais === 'México' : f === 'usa' ? d.pais !== 'México' : true));
    const grupos = [...new Set(L.map((d) => d.zona_nombre || 'Sin zona'))].sort((a, b) => (a.startsWith('Estados') ? 1 : 0) - (b.startsWith('Estados') ? 1 : 0) || a.localeCompare(b));
    caja.replaceChildren(...(L.length ? grupos.flatMap((g) => { const G = L.filter((d) => (d.zona_nombre || 'Sin zona') === g).sort((a, b) => a.nombre.localeCompare(b.nombre));
      return [h('h2', {}, `${g} (${G.length})`), h('div', { class: 'card' }, lista('dir' + g, G, 12, (d) => h('li', {}, h('div', { class: 'l1' }, h('span', {}, d.nombre), faltan(d).length ? pill(faltan(d).length === 1 ? 'Falta 1 dato' : `Faltan ${faltan(d).length} datos`, 'warn') : pill('Completo', 'ok')),
        h('div', { class: 'l2' }, [d.tipo, [d.ciudad, d.estado].filter(Boolean).join(', '), d.vendedor].filter(Boolean).join(' · ')),
        d.contacto || d.telefono || d.email ? h('div', { class: 'l2' }, [d.contacto, d.puesto, d.telefono, d.email].filter(Boolean).join(' · ')) : null,
        h('div', { class: 'acc' }, h('button', { class: 'btn sm sec', onclick: () => editarCuenta(d) }, faltan(d).length ? 'Completar datos' : 'Editar'))), '',
        [{ t: 'Cuenta', v: (d) => d.nombre, s: (d) => d.nombre.toLowerCase(), cls: 'b' }, { t: 'Tipo', v: (d) => d.tipo || '—', s: (d) => d.tipo }, { t: 'Ciudad', v: (d) => [d.ciudad, d.estado].filter(Boolean).join(', ') || '—', s: (d) => d.ciudad },
          { t: 'Contacto', v: (d) => [d.contacto, d.puesto].filter(Boolean).join(' · ') || '—', s: (d) => d.contacto }, { t: 'Teléfono', v: (d) => d.telefono || '—', cls: 'nw' }, { t: 'Correo', v: (d) => (d.email ? h('a', { href: 'mailto:' + d.email }, d.email) : '—') },
          { t: 'Atiende', v: (d) => d.vendedor, s: (d) => d.vendedor, cls: 'nw' }, { t: 'Falta', v: (d) => (faltan(d).length ? pill(faltan(d).join(', '), 'warn') : pill('Completo', 'ok')), s: (d) => faltan(d).length, cls: 'nw' },
          { t: '', v: (d) => h('button', { class: 'btn sm sec', onclick: () => editarCuenta(d) }, 'Editar'), cls: 'nw' }]))]; }) : [h('p', { class: 'note' }, 'Ninguna cuenta con ese filtro.')]));
  };
  const comp = A.filter((d) => !faltan(d).length).length, busca = h('input', { type: 'search', placeholder: 'Buscar cuenta, contacto o ciudad', 'aria-label': 'Buscar', value: S.dirQ || '', oninput: (ev) => { S.dirQ = ev.target.value; pinta(); } });
  pinta();
  return h('div', {},
    h('div', { class: 'card kpis' }, kpi(A.length, 'Cuentas en el libro', `${A.filter((d) => d.pais === 'México').length} en México · ${A.filter((d) => d.pais !== 'México').length} en Estados Unidos`),
      kpi(`${comp} de ${A.length}`, 'Con datos completos', 'contacto, correo y teléfono'), kpi(A.filter((d) => !d.email).length, 'Sin correo'), kpi(A.filter((d) => !d.contacto).length, 'Sin persona de contacto')),
    h('div', { class: 'toolbar' }, busca, chips([['', 'Todas'], ['falta', 'Incompletas'], ['mx', 'México'], ['usa', 'Estados Unidos']], S.dirF || '', (v) => { S.dirF = v; })),
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
function materiales() {
  const M = D().materiales || [], cats = [...new Set(M.map((m) => m.categoria))], admin = D().yo.admin;
  const f = admin ? h('form', { class: 'inline', style: 'grid-template-columns:1fr', onsubmit: async (ev) => { ev.preventDefault(); const e = await enviar('api/admin/materiales', Object.fromEntries(new FormData(f))); if (e) alert(e); } },
    h('input', { name: 'titulo', placeholder: 'Título (por ejemplo: Lista de precios restaurantes 2027)', required: true, 'aria-label': 'Título' }), h('input', { name: 'url', type: 'url', placeholder: 'Liga https:// (Drive, PDF, carpeta de fotos)', required: true, 'aria-label': 'Liga' }),
    h('select', { name: 'categoria', 'aria-label': 'Categoría' }, ['Listas de precios', 'Presentaciones', 'Notas de cata', 'Fotos y logos', 'Prensa y premios', 'Otros'].map((c) => h('option', {}, c))), h('input', { name: 'nota', placeholder: 'Nota corta (opcional)', 'aria-label': 'Nota' }), h('button', { class: 'btn' }, 'Agregar material')) : null;
  return h('div', {},
    !M.some((m) => m.categoria === 'Listas de precios') ? h('div', { class: 'alert warn' }, h('b', {}, 'Falta la lista de precios. '), 'Es lo primero que un vendedor necesita aquí. Un administrador puede agregarla abajo con su liga.') : null,
    h('div', { class: 'cols2' }, cats.map((c) => h('section', { class: 'card' }, h('h3', { style: 'margin-top:0' }, c), h('div', { class: 'links' }, M.filter((m) => m.categoria === c).map((m) => h('div', {}, h('a', { href: m.url, target: '_blank', rel: 'noopener' }, m.titulo, m.nota ? h('span', {}, m.nota) : null),
      admin ? h('button', { class: 'linkb note', onclick: () => { if (confirm('¿Quitar este material?')) enviar('api/admin/materiales', { borrar: m.id }); } }, 'Quitar') : null)))))),
    h('h2', {}, 'Botellas'), h('p', { class: 'note' }, 'Toca una botella para abrir la imagen y guardarla o mandarla.'),
    h('div', { class: 'card' }, h('div', { class: 'gal' }, BOTELLAS.map((b) => h('a', { href: `https://hola.dosbuhos.com/bottles/${b}.webp`, target: '_blank', rel: 'noopener' }, h('img', { src: `https://hola.dosbuhos.com/bottles/${b}.webp`, alt: 'Botella ' + b.replace(/-/g, ' '), loading: 'lazy' }), b.replace(/-/g, ' '))))),
    admin ? [h('h2', {}, 'Agregar material'), h('div', { class: 'card' }, h('p', { class: 'note' }, 'Por ahora son ligas (Drive, PDF en la tarjeta QR). Subir archivos directo a Spark es el siguiente paso.'), f)] : null);
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

// Carlos's own distributor prospecting list (from his file), shown under the map.
export function prospeccionCarlos() {
  const P = D().prosp_carlos || [], f = S.pcF || 'En proceso', L = P.filter((p) => p.grupo === f), K = { 'En proceso': 'warn', 'Por contactar': 'mute', Rechazada: 'bad' };
  if (!P.length) return null;
  return [h('h2', {}, 'Distribuidores que Carlos está trabajando'), h('p', { class: 'note' }, 'De su archivo de avance al 13 de noviembre. Todavía no se actualiza solo.'),
    chips(['En proceso', 'Por contactar', 'Rechazada'].map((g) => [g, `${g} (${P.filter((p) => p.grupo === g).length})`]), f, (v) => { S.pcF = v; }),
    h('div', { class: 'card', style: 'margin-top:8px' }, lista('pc', L, 10, (p) => h('li', {}, h('div', { class: 'l1' }, h('span', {}, p.nombre), pill(p.grupo, K[p.grupo])), h('div', { class: 'l2' }, [p.plaza, p.tipo, p.contacto, p.telefono, p.email].filter(Boolean).join(' · ')), h('div', { class: 'l2' }, [p.status, p.avance, p.comentarios].filter(Boolean).join(' · '))), 'Ninguno.',
      [{ t: 'Prospecto', v: (p) => p.nombre, s: (p) => p.nombre.toLowerCase(), cls: 'b' }, { t: 'Plaza', v: (p) => p.plaza, s: (p) => p.plaza }, { t: 'Tipo', v: (p) => p.tipo, s: (p) => p.tipo }, { t: 'Contacto', v: (p) => [p.contacto, p.telefono, p.email].filter(Boolean).join(' · ') || '—' },
        { t: 'Estado', v: (p) => p.status || '—', cls: 'mut' }, { t: 'Avance', v: (p) => p.avance || '—', cls: 'mut' }, { t: 'Siguiente', v: (p) => p.comentarios || '—', cls: 'mut' }, { t: 'Último contacto', v: (p) => (p.ultimo ? dia(p.ultimo) : '?'), s: (p) => p.ultimo || null, cls: 'nw' }]))];
}

export const MAS_VISTAS = { cobranza, directorio, encuestas, copeo, materiales, comunicaciones };
