// Arqueo — phone first, always vertical. The count panel is the only screen that really matters: pallets, cases,
// loose bottles, and no expected quantity anywhere until the count has been sent.

const $ = (s, r = document) => r.querySelector(s);
const main = $('#main'), tabs = $('#tabs'), fab = $('#fab'), pop = $('#pop'), dlg = $('#dlg');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const n = (v) => Number(v || 0).toLocaleString('es-MX');
const api = async (p, body, metodo) => {
  const r = await fetch(p, body === undefined ? {} : { method: metodo || 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({ error: 'Respuesta ilegible' }));
  if (!r.ok) throw new Error(j.error || 'Error ' + r.status);
  return j;
};
let toastT;
const aviso = (t) => { const e = $('#toast'); e.textContent = t; e.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (e.hidden = true), 3200); };
const hoja = (titulo, html) => { dlg.innerHTML = `<div class="cuerpo"><div class="head"><h2 id="dlg-t">${esc(titulo)}</h2><button class="lnk" data-cerrar>Cerrar</button></div>${html}</div>`; dlg.showModal(); };
dlg.addEventListener('click', (e) => { if (e.target.dataset.cerrar !== undefined || e.target === dlg) dlg.close(); });

let E = null;          // /api/estado
let vista = '';

const ICONOS = {
  surtir: '<path d="M4 7h16v12H4zM4 7l2-3h12l2 3M9 12h6"/>',
  vinos: '<path d="M7 3h10l-1 6a4 4 0 01-8 0zM12 13v8M9 21h6"/>',
  mov: '<path d="M4 7h12M4 7l3-3M4 7l3 3M20 17H8m12 0l-3-3m3 3l-3 3"/>',
  conc: '<path d="M4 19V5m0 14h16M8 16V9m4 7v-4m4 4V7"/>',
};

function pintaTabs() {
  const items = [['surtir', 'Surtir'], ['vinos', 'Vinos'], ['mov', 'Movimientos']];
  items.push(E.yo.admin ? ['conc', 'Conciliación'] : ['conteos', 'Conteos']);
  tabs.innerHTML = items.map(([k, t]) => `<a href="#${k}" ${vista === k ? 'aria-current="page"' : ''}>
    <svg viewBox="0 0 24 24" aria-hidden="true">${ICONOS[k] || ICONOS.conc}</svg><span>${t}</span></a>`).join('');
}
const titulo = (t, s) => { $('#titulo').textContent = t; $('#sub').textContent = s || ''; };
const cargando = () => (main.innerHTML = '<p class="note pad">Cargando…</p>');
const vacio = (b, p) => `<div class="card vacio"><b>${esc(b)}</b><span>${esc(p || '')}</span></div>`;

// ---------- Surtir: the pick queue ----------
async function vSurtir() {
  titulo('Surtir', E.almacen);
  cargando();
  fab.hidden = true;
  const { ovs } = await api('api/ovs');
  const r = E.resumen;
  main.innerHTML = `
    <div class="kpis">
      <div class="kpi"><b class="tnum">${ovs.length}</b><span>órdenes por surtir</span></div>
      <div class="kpi"><b class="tnum">${r.surtidos_hoy}</b><span>surtidas hoy</span></div>
    </div>
    ${E.cfg.base_cerrada ? '' : `<div class="card"><div class="head"><h2>Falta la línea base</h2></div>
      <p class="note">El conteo contra Zoho no significa nada hasta cerrar el conteo general del almacén. Se puede surtir mientras tanto: cada conteo ya queda guardado.</p></div>`}
    ${ovs.length ? `<div class="lista">${ovs.map((o) => `<button class="fila" data-ov="${esc(o.ov_id)}">
      <div class="r1"><b>${esc(o.ov)} · ${esc(o.cliente)}</b><span class="n">${n(o.botellas)} bot</span></div>
      <div class="r2"><span>${esc(o.fecha)}</span>${o.vendedor ? `<span>· ${esc(o.vendedor)}</span>` : ''}${o.entrega ? `<span class="chip">${esc(o.entrega)}</span>` : ''}</div>
    </button>`).join('')}</div>` : vacio('Nada pendiente', 'No hay órdenes de venta abiertas en Zoho para Almacén 1.')}`;
  main.querySelectorAll('[data-ov]').forEach((b) => b.onclick = () => (location.hash = '#ov/' + b.dataset.ov));
}

// ---------- The count panel ----------
const panelConteo = (l, i) => {
  const conTarima = Number(l.cajas_tarima) > 0;
  return `<div class="card" data-linea="${i}" data-item="${esc(l.item_id)}" data-caja="${l.botellas_caja}" data-tarima="${l.cajas_tarima}">
    <div class="head"><h2>${esc(l.nombre)}</h2>${l.posicion ? `<span class="chip">${esc(l.posicion)}</span>` : ''}</div>
    ${l.sin_sku ? '<p class="note">Este vino no está en el catálogo de Arqueo. Sincroniza con Zoho antes de surtirlo.</p>' : `
    <label class="sacar">Botellas que sacaste <input type="number" inputmode="numeric" min="0" class="js-surtido" value="${l.pedido}"></label>
    <p class="note">Pedido: ${n(l.pedido)} botellas</p>
    <div class="conteo">
      <h3>Cuenta todo lo que queda de este vino</h3>
      <div class="cuenta ${conTarima ? '' : 'dos'}">
        ${conTarima ? `<label>Tarimas <input type="number" inputmode="numeric" min="0" class="js-t" value="0"></label>` : ''}
        <label>Cajas <input type="number" inputmode="numeric" min="0" class="js-c" value="0"></label>
        <label>Sueltas <input type="number" inputmode="numeric" min="0" class="js-s" value="0"></label>
      </div>
      <div class="suma"><span class="note">${conTarima ? `Tarima ${l.cajas_tarima} cajas · ` : ''}Caja ${l.botellas_caja} botellas</span><b class="js-total tnum">0</b></div>
    </div>`}
  </div>`;
};

function leeLineas(raiz) {
  return [...raiz.querySelectorAll('[data-linea]')].map((c) => {
    const v = (s) => Math.max(0, Math.trunc(Number($(s, c)?.value || 0)));
    return { item_id: c.dataset.item, surtido: v('.js-surtido'), pedido: Number($('.js-surtido', c)?.dataset.pedido || $('.js-surtido', c)?.defaultValue || 0),
      tarimas: v('.js-t'), cajas: v('.js-c'), sueltas: v('.js-s'),
      contado: v('.js-t') * Number(c.dataset.tarima) * Number(c.dataset.caja) + v('.js-c') * Number(c.dataset.caja) + v('.js-s') };
  });
}

function vivoTotales(raiz) {
  raiz.addEventListener('input', (e) => {
    const c = e.target.closest('[data-linea]');
    if (!c) return;
    const v = (s) => Math.max(0, Math.trunc(Number($(s, c)?.value || 0)));
    const t = v('.js-t') * Number(c.dataset.tarima) * Number(c.dataset.caja) + v('.js-c') * Number(c.dataset.caja) + v('.js-s');
    $('.js-total', c).textContent = n(t) + ' botellas';
  });
}

// ---------- Surtido of one OV ----------
async function vOv(id) {
  titulo('Surtido', '');
  cargando();
  fab.hidden = true;
  const o = await api('api/ov/' + id);
  titulo(o.ov || 'Surtido', o.cliente);
  main.innerHTML = `
    <div class="card">
      <div class="head"><h2>${esc(o.ov)}</h2><span class="note">${esc(o.fecha)}</span></div>
      <p class="note">${esc(o.cliente)}${o.entrega ? ' · ' + esc(o.entrega) : ''}</p>
    </div>
    ${o.lineas.map(panelConteo).join('')}
    <label><input type="checkbox" id="parcial" style="width:auto;min-height:0"> La orden no se pudo surtir completa</label>
    <button class="btn pri ancho" id="cerrar">Cerrar surtido</button>
    <p class="note">Al cerrar verás la diferencia contra el saldo. Antes no: el conteo es a ciegas.</p>`;
  vivoTotales(main);
  $('#cerrar').onclick = () => enviaSurtido(id, o);
}

async function enviaSurtido(id, o, motivos) {
  const b = $('#cerrar');
  b.disabled = true;
  try {
    const lineas = leeLineas(main).map((l, i) => ({ ...l, pedido: o.lineas[i]?.pedido || 0, ...(motivos?.[l.item_id] || {}) }));
    const r = await api('api/surtido', { ov_id: id, ov: o.ov, cliente: o.cliente, parcial: $('#parcial')?.checked ? 1 : 0, lineas });
    if (r.faltan) return pideMotivos(r.faltan, (m) => enviaSurtido(id, o, m));
    resultado(r, '#surtir');
  } catch (e) { aviso(e.message); b.disabled = false; }
}

// Second pass of a blind count: the difference is on screen now, so the app can ask what happened.
function pideMotivos(lineas, seguir) {
  const malas = lineas.filter((l) => l.falta);
  hoja('Diferencias', `
    <p class="note">Lo contado no coincide con el saldo. Dinos qué pasó y se guarda el conteo como verdadero.</p>
    ${malas.map((l) => `<div class="card" data-m="${esc(l.item_id)}">
      <div class="head"><h2>${esc(l.nombre)}</h2><span class="chip ${l.nivel}">${l.variacion > 0 ? '+' : ''}${n(l.variacion)}</span></div>
      <p class="note">Contaste ${n(l.contado)} · el sistema esperaba ${n(l.esperado)}</p>
      <label>Motivo <select class="js-motivo"><option value="">Elige…</option>${E.motivos.map((m) => `<option>${esc(m)}</option>`).join('')}</select></label>
      ${l.nivel === 'rojo' ? `<label>Foto <input type="file" accept="image/*" capture="environment" class="js-foto"></label>` : ''}
      <label>Nota (opcional) <textarea class="js-nota" rows="2"></textarea></label>
    </div>`).join('')}
    <button class="btn pri ancho" id="guardar">Guardar conteo</button>`);
  $('#guardar').onclick = async () => {
    const btn = $('#guardar');
    btn.disabled = true;
    try {
      const m = {};
      for (const c of dlg.querySelectorAll('[data-m]')) {
        const motivo = $('.js-motivo', c).value;
        if (!motivo) throw new Error('Falta un motivo');
        const f = $('.js-foto', c)?.files?.[0];
        m[c.dataset.m] = { motivo, nota: $('.js-nota', c).value, foto: f ? await subeFoto(f) : '' };
      }
      dlg.close();
      seguir(m);
    } catch (e) { aviso(e.message); btn.disabled = false; }
  };
}

async function subeFoto(file) {
  const r = await fetch('api/foto', { method: 'POST', headers: { 'content-type': file.type || 'image/jpeg' }, body: file });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || 'No se pudo subir la foto');
  return j.foto;
}

function resultado(r, volver) {
  const verdes = r.lineas.filter((l) => l.nivel === 'verde').length;
  main.innerHTML = `<div class="card">
      <div class="head"><h2>Conteo guardado</h2><span class="chip ${r.rojas ? 'rojo' : 'verde'}">${verdes} de ${r.lineas.length} sin diferencia</span></div>
      <div class="res">${r.lineas.map((l) => `<div class="l"><span>${esc(l.nombre)}<br><span class="note">quedan ${n(l.contado)}</span></span>
        <span class="v ${l.nivel}">${l.variacion > 0 ? '+' : ''}${n(l.variacion)}</span></div>`).join('')}</div>
    </div>
    <button class="btn pri ancho" id="volver">Listo</button>`;
  $('#volver').onclick = () => (location.hash = volver);
  E = null;
}

// ---------- Vinos ----------
async function vVinos() {
  titulo('Vinos', E.almacen);
  cargando();
  fab.hidden = true;
  const [{ skus, posiciones }, { pendientes }] = await Promise.all([api('api/skus'), api('api/rotacion')]);
  const fila = (s) => `<button class="fila" data-sku="${esc(s.item_id)}">
      <div class="r1"><b>${esc(s.nombre)}</b>${s.saldo === null ? '' : `<span class="n">${n(s.saldo)}</span>`}</div>
      <div class="r2">${s.posicion ? `<span class="chip">${esc(s.posicion)}</span>` : '<span class="chip">sin posición</span>'}
        <span>caja ${s.botellas_caja}${s.cajas_tarima ? ` · tarima ${s.cajas_tarima}` : ''}</span>
        ${s.contado_at ? `<span>· contado ${esc(s.contado_at)}</span>` : '<span>· nunca contado</span>'}</div>
    </button>`;
  main.innerHTML = `
    ${pendientes.length ? `<div class="card"><div class="head"><h2>Pendientes de conteo</h2><span class="chip ambar">${pendientes.length}</span></div>
      <p class="note">Vinos que nadie ha movido en un buen rato, o que vienen saliendo con diferencia.</p>
      <div class="lista" style="margin-top:10px">${pendientes.map((s) => `<button class="fila" data-contar="${esc(s.item_id)}">
        <div class="r1"><b>${esc(s.nombre)}</b><span class="n">contar</span></div>
        <div class="r2"><span>${esc(s.razon)}</span></div></button>`).join('')}</div></div>` : ''}
    <input class="busca" id="busca" type="search" placeholder="Buscar vino o SKU" autocomplete="off">
    <div class="lista" id="filas">${skus.filter((s) => s.activo).map(fila).join('')}</div>
    ${E.yo.admin ? `<button class="btn ancho" id="sync">Sincronizar catálogo con Zoho</button>` : ''}`;
  if ($('#sync')) $('#sync').onclick = async () => {
    const b = $('#sync'); b.disabled = true; b.textContent = 'Sincronizando…';
    try { const r = await api('api/sync', {}); aviso(`${r.skus} vinos al día`); E = null; ruta(); }
    catch (e) { aviso(e.message); b.disabled = false; b.textContent = 'Sincronizar catálogo con Zoho'; }
  };
  const pinta = (q) => {
    const t = q.trim().toLowerCase();
    $('#filas').innerHTML = skus.filter((s) => s.activo && (!t || (s.nombre + ' ' + s.sku).toLowerCase().includes(t))).map(fila).join('');
    enlaza();
  };
  const enlaza = () => {
    main.querySelectorAll('[data-sku]').forEach((b) => b.onclick = () => hojaSku(skus.find((s) => s.item_id === b.dataset.sku), posiciones));
    main.querySelectorAll('[data-contar]').forEach((b) => b.onclick = () => contarSuelto(skus.find((s) => s.item_id === b.dataset.contar)));
  };
  $('#busca').oninput = (e) => pinta(e.target.value);
  enlaza();
}

function hojaSku(s, posiciones) {
  hoja(s.nombre, `
    ${s.saldo === null ? '' : `<div class="kpis"><div class="kpi"><b class="tnum">${n(s.saldo)}</b><span>en Arqueo</span></div>
      <div class="kpi"><b class="tnum">${n(Math.round(s.zoho_stock || 0))}</b><span>en Zoho</span></div></div>`}
    <label>Botellas por caja <input type="number" inputmode="numeric" min="1" id="bc" value="${s.botellas_caja}"></label>
    <label>Cajas por tarima <input type="number" inputmode="numeric" min="0" id="ct" value="${s.cajas_tarima}"></label>
    <label>Posición <select id="pos"><option value="">Sin posición</option>${posiciones.map((p) => `<option value="${p.id}" ${p.id === s.posicion_id ? 'selected' : ''}>${esc(p.codigo)}${p.zona ? ' · ' + esc(p.zona) : ''}</option>`).join('')}</select></label>
    <button class="btn pri ancho" id="g">Guardar</button>
    <button class="btn ancho" id="c">Contar este vino</button>`);
  $('#g').onclick = async () => {
    try {
      await api('api/sku', { item_id: s.item_id, botellas_caja: $('#bc').value, cajas_tarima: $('#ct').value, posicion_id: $('#pos').value || null });
      dlg.close(); aviso('Guardado'); E = null; ruta();
    } catch (e) { aviso(e.message); }
  };
  $('#c').onclick = () => { dlg.close(); contarSuelto(s); };
}

// A count with no OV behind it: rotación or a spot check.
function contarSuelto(s) {
  titulo('Conteo', s.nombre);
  main.innerHTML = `${panelConteo({ ...s, pedido: 0, posicion: s.posicion, sin_sku: false }, 0).replace(/<label class="sacar">[\s\S]*?<\/label>\s*<p class="note">Pedido[\s\S]*?<\/p>/, '')}
    <button class="btn pri ancho" id="cerrar">Guardar conteo</button>
    <p class="note">Cuenta todo lo que haya de este vino, en todas sus posiciones.</p>`;
  vivoTotales(main);
  const enviar = async (motivos) => {
    const b = $('#cerrar'); b.disabled = true;
    try {
      const lineas = leeLineas(main).map((l) => ({ ...l, surtido: 0, ...(motivos?.[l.item_id] || {}) }));
      const r = await api('api/conteo', { tipo: 'rotacion', lineas });
      if (r.faltan) return pideMotivos(r.faltan, enviar);
      resultado(r, '#vinos');
    } catch (e) { aviso(e.message); b.disabled = false; }
  };
  $('#cerrar').onclick = () => enviar();
}

// ---------- Movimientos ----------
async function vMov() {
  titulo('Movimientos', E.almacen);
  cargando();
  const { movimientos } = await api('api/movimientos');
  fab.hidden = !E.yo.almacen;
  const etiqueta = { salida_ov: 'Salida OV', ajuste_conteo: 'Ajuste de conteo', traspaso: 'Traspaso', entrada: 'Entrada', devolucion: 'Devolución', merma: 'Merma', muestra: 'Muestra', base: 'Línea base' };
  main.innerHTML = movimientos.length ? `<div class="lista">${movimientos.map((m) => `<div class="fila plano">
      <div class="r1"><b>${esc(m.nombre)}</b><span class="n ${m.botellas < 0 ? '' : ''}">${m.botellas > 0 ? '+' : ''}${n(m.botellas)}</span></div>
      <div class="r2"><span class="chip">${esc(etiqueta[m.tipo] || m.tipo)}</span><span>${esc(m.fecha)}</span>
        ${m.ov ? `<span>· ${esc(m.ov)}</span>` : ''}${m.destino ? `<span>· ${esc(m.destino)}</span>` : ''}${m.motivo ? `<span>· ${esc(m.motivo)}</span>` : ''}</div>
    </div>`).join('')}</div>` : vacio('Sin movimientos', 'Aquí aparece cada botella que entra o sale.');
}

function hojaMovimiento(tipo) {
  const titulos = { traspaso: 'Traspaso', entrada: 'Entrada por embotellado', devolucion: 'Devolución', merma: 'Merma', muestra: 'Muestra' };
  api('api/skus').then(({ skus }) => {
    hoja(titulos[tipo], `
      <label>Vino <select id="item"><option value="">Elige…</option>${skus.filter((s) => s.activo).map((s) => `<option value="${esc(s.item_id)}">${esc(s.nombre)}</option>`).join('')}</select></label>
      <label>Botellas <input type="number" inputmode="numeric" min="1" id="bot"></label>
      ${tipo === 'traspaso' ? `<label>Destino <select id="destino">${E.destinos.map((d) => `<option>${esc(d)}</option>`).join('')}</select></label>` : ''}
      ${tipo === 'merma' ? `<label>Motivo <select id="motivo">${E.mermas.map((d) => `<option>${esc(d)}</option>`).join('')}</select></label><label>Foto <input type="file" accept="image/*" capture="environment" id="foto"></label>` : ''}
      ${tipo === 'devolucion' ? `<label>Origen <select id="motivo">${E.origenes.map((d) => `<option>${esc(d)}</option>`).join('')}</select></label>` : ''}
      <label>Nota <textarea id="nota" rows="2"></textarea></label>
      <button class="btn pri ancho" id="g">Guardar</button>`);
    $('#g').onclick = async () => {
      const b = $('#g'); b.disabled = true;
      try {
        const f = $('#foto')?.files?.[0];
        await api('api/movimiento', { tipo, item_id: $('#item').value, botellas: $('#bot').value, destino: $('#destino')?.value || '',
          motivo: $('#motivo')?.value || '', nota: $('#nota').value, foto: f ? await subeFoto(f) : '' });
        dlg.close(); aviso('Guardado'); E = null; ruta();
      } catch (e) { aviso(e.message); b.disabled = false; }
    };
  });
}

// ---------- Conciliación (supervisores) ----------
async function vConc() {
  titulo('Conciliación', 'Arqueo contra Zoho');
  cargando();
  fab.hidden = true;
  const [{ filas, ajustes }, { fantasmas }] = await Promise.all([api('api/conciliacion'), api('api/fantasmas')]);
  const dif = filas.filter((f) => f.diferencia !== 0);
  const total = dif.reduce((a, f) => a + Math.abs(f.diferencia), 0);
  main.innerHTML = `
    ${E.cfg.base_cerrada ? '' : `<div class="card"><div class="head"><h2>Falta la línea base</h2><span class="chip ambar">pendiente</span></div>
      <p class="note">Todavía no hay un conteo general del almacén, así que el saldo de Arqueo arranca en cero y estas diferencias
      son contra nada. Cierra la línea base y entonces la lista de ajustes dice la verdad.</p></div>`}
    <div class="kpis">
      <div class="kpi ${total ? 'alerta' : ''}"><b class="tnum">${n(total)}</b><span>botellas de diferencia</span></div>
      <div class="kpi"><b class="tnum">${dif.length}</b><span>vinos que no cuadran</span></div>
      <div class="kpi"><b class="tnum">${n(E.resumen.botellas_fantasma)}</b><span>botellas en OVs fantasma</span></div>
      <div class="kpi"><b class="tnum">${ajustes.length}</b><span>ajustes por capturar</span></div>
    </div>
    <div class="card">
      <div class="head"><h2>Ajustes para administración</h2>${ajustes.length ? '<a href="api/ajustes.csv">CSV</a>' : ''}</div>
      ${ajustes.length ? `<div class="conc">${ajustes.map((a) => `<div class="r">
          <span class="nom">${esc(a.nombre)}</span><span class="d ${a.botellas > 0 ? 'mas' : 'menos'}">${a.botellas > 0 ? '+' : ''}${n(a.botellas)}</span>
          <span class="sub">Zoho ${n(a.zoho)} → ${n(a.arqueo)} · ${esc(a.descripcion)} <button class="lnk" data-ap="${a.id}">Marcar capturado</button></span>
        </div>`).join('')}</div>`
        : `<p class="note">No hay ajustes pendientes.</p>`}
      <button class="btn ancho" id="gen" style="margin-top:12px">Generar lista de ajustes</button>
    </div>
    <div class="card">
      <div class="head"><h2>Vino por vino</h2><span class="note">${filas.length} vinos</span></div>
      <div class="conc">${filas.map((f) => `<div class="r">
        <span class="nom">${esc(f.nombre)}</span>
        <span class="d ${f.diferencia === 0 ? 'cero' : f.diferencia > 0 ? 'mas' : 'menos'}">${f.diferencia > 0 ? '+' : ''}${n(f.diferencia)}</span>
        <span class="sub">Arqueo ${n(f.arqueo)} · Zoho ${n(f.zoho)} · ${f.dias_sin_contar > 900 ? 'nunca contado' : `contado hace ${f.dias_sin_contar} d`}</span>
      </div>`).join('')}</div>
    </div>
    <div class="card">
      <div class="head"><h2>OVs fantasma</h2><span class="chip ${fantasmas.length ? 'rojo' : 'verde'}">${fantasmas.length}</span></div>
      <p class="note">Órdenes abiertas en Zoho que ya tienen factura: las botellas salieron pero Zoho las sigue apartando.</p>
      ${fantasmas.length ? `<div class="conc" style="margin-top:8px">${fantasmas.map((f) => `<div class="r">
        <span class="nom">${esc(f.ov)} · ${esc(f.cliente)}</span><span class="d menos">${n(f.botellas)}</span>
        <span class="sub">${esc(f.fecha)} · factura ${esc(f.factura)} · ${f.dias} días abierta</span></div>`).join('')}</div>` : ''}
    </div>`;
  $('#gen').onclick = async () => {
    try { const r = await api('api/ajustes/generar', {}); aviso(r.creados ? `${r.creados} ajustes generados` : 'Todo cuadra'); E = null; ruta(); }
    catch (e) { aviso(e.message); }
  };
  main.querySelectorAll('[data-ap]').forEach((b) => b.onclick = async () => {
    try { await api('api/ajuste', { id: b.dataset.ap }); aviso('Marcado'); E = null; ruta(); } catch (e) { aviso(e.message); }
  });
}

// ---------- Conteos (historial) ----------
async function vConteos() {
  titulo('Conteos', E.almacen);
  cargando();
  fab.hidden = true;
  const { conteos } = await api('api/conteos');
  main.innerHTML = conteos.length ? `<div class="lista">${conteos.map((c) => `<button class="fila" data-c="${c.id}">
      <div class="r1"><b>${esc(c.ov || (c.tipo === 'base' ? 'Línea base' : c.tipo === 'rotacion' ? 'Rotación' : 'Auditoría'))}</b>
        <span class="chip ${c.difs ? 'ambar' : 'verde'}">${c.difs ? c.difs + ' con diferencia' : 'sin diferencias'}</span></div>
      <div class="r2"><span>${esc((c.cerrado_at || '').slice(0, 10))}</span><span>· ${esc(c.cliente || '')}</span><span>· ${c.lineas} vinos</span></div>
    </button>`).join('')}</div>` : vacio('Sin conteos todavía', 'Cada surtido deja uno aquí.');
  main.querySelectorAll('[data-c]').forEach((b) => b.onclick = async () => {
    const { conteo, lineas } = await api('api/conteo/' + b.dataset.c);
    hoja(conteo.ov || 'Conteo', `<p class="note">${esc(conteo.usuario)} · ${esc((conteo.cerrado_at || '').slice(0, 10))}</p>
      <div class="res">${lineas.map((l) => `<div class="l"><span>${esc(l.nombre)}<br><span class="note">contó ${n(l.contado)}${l.surtido ? ` · sacó ${n(l.surtido)}` : ''}${l.motivo ? ` · ${esc(l.motivo)}` : ''}</span></span>
        <span class="v ${l.variacion === 0 ? 'verde' : Math.abs(l.variacion) >= 6 ? 'rojo' : 'ambar'}">${l.variacion > 0 ? '+' : ''}${n(l.variacion)}</span></div>`).join('')}</div>`);
  });
}

// ---------- Router ----------
const VISTAS = { surtir: vSurtir, vinos: vVinos, mov: vMov, conc: vConc, conteos: vConteos };

async function ruta() {
  const h = location.hash.slice(1) || 'surtir';
  const [k, arg] = h.split('/');
  try {
    if (!E) E = await api('api/estado');
    E.almacen = E.almacen || 'Almacén 1';
    vista = k === 'ov' ? 'surtir' : k;
    pintaTabs();
    $('#atras').hidden = k !== 'ov';
    if (k === 'ov') return vOv(arg);
    (VISTAS[k] || vSurtir)();
  } catch (e) {
    main.innerHTML = `<div class="card vacio"><b>No se pudo cargar</b><span>${esc(e.message)}</span></div>`;
  }
}

$('#atras').onclick = () => (location.hash = '#surtir');
$('#recargar').onclick = () => { E = null; ruta(); };
fab.onclick = () => {
  pop.hidden = !pop.hidden;
  pop.innerHTML = ['traspaso', 'entrada', 'devolucion', 'merma', 'muestra']
    .map((t) => `<button data-t="${t}">${({ traspaso: 'Traspaso a barra, tienda…', entrada: 'Entrada por embotellado', devolucion: 'Devolución', merma: 'Merma', muestra: 'Muestra' })[t]}</button>`).join('');
  pop.querySelectorAll('[data-t]').forEach((b) => b.onclick = () => { pop.hidden = true; hojaMovimiento(b.dataset.t); });
};
document.addEventListener('click', (e) => { if (!pop.hidden && !pop.contains(e.target) && e.target !== fab && !fab.contains(e.target)) pop.hidden = true; });
addEventListener('hashchange', ruta);
ruta();
