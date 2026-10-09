import { layout, esc, fdate, mxn, int, pill } from './ui.js';
import { holdings, repSummary, dueInfo, eventFull, eventMoney } from './data.js';

const STATUS = { abierto: 'Por reportar', enviado: 'Enviado', devuelto: 'Devuelto', aprobado: 'Aprobado' };

export async function home(env, user) {
  const rep = user.rep;
  const s = await repSummary(env, rep);
  const overdue = s.open.filter(e => dueInfo(e).state === 'overdue');
  const returned = s.open.filter(e => e.status === 'devuelto');
  const leads = (await env.DB.prepare(`SELECT * FROM leads WHERE rep_id=? AND done=0 ORDER BY due IS NULL, due LIMIT 5`).bind(rep.id).all()).results;
  const recent = (await env.DB.prepare(`SELECT e.*, (SELECT SUM(qty) FROM event_lines WHERE event_id=e.id) AS bottles FROM events e
     WHERE e.rep_id=? AND e.status IN ('enviado','aprobado') AND e.kind='evento' ORDER BY e.event_date DESC LIMIT 5`).bind(rep.id).all()).results;
  const body = `
  <h1>Hola, ${esc(rep.name.split(' ')[0])}</h1>
  ${overdue.length ? `<div class="banner red">${overdue.length} ${overdue.length === 1 ? 'evento vencido' : 'eventos vencidos'}. Ciérralos para que se aprueben nuevas muestras.</div>` : ''}
  ${returned.length ? `<div class="banner amber">${returned.length} ${returned.length === 1 ? 'reporte devuelto' : 'reportes devueltos'} con comentarios.</div>` : ''}
  <h2>Eventos por cerrar</h2>
  ${s.open.length ? s.open.map(e => { const d = dueInfo(e); return `
    <a class="card" style="display:block;text-decoration:none;color:inherit" href="/evento/${e.id}">
      <div class="row"><strong>${esc(e.name)}</strong><span class="spacer"></span>${e.status === 'devuelto' ? pill('devuelto', 'Devuelto') : pill(d.state === 'overdue' ? 'overdue' : 'abierto', d.label)}</div>
      <div class="muted small">${fdate(e.event_date)} · ${e.so_number ? esc(e.so_number) + ' · ' : ''}${int(e.bottles)} botellas</div>
    </a>`; }).join('') : '<p class="muted">No tienes eventos pendientes.</p>'}
  <div class="row" style="margin:12px 0"><a class="btn ghost small" href="/evento/nuevo">+ Evento con vino de mi bodega</a></div>
  <h2>Mi bodega <span class="muted small">· lo que deberías tener hoy</span></h2>
  <div class="card scroll">${s.hold.length ? `<table><tr><th>Vino</th><th class="n">Botellas</th></tr>
    ${s.hold.map(h => `<tr><td>${esc(h.wine)}</td><td class="n" ${h.qty < 0 ? 'style="color:var(--red);font-weight:700"' : ''}>${int(h.qty)}</td></tr>`).join('')}
    <tr><th>Total</th><th class="n">${int(s.shouldHold)}</th></tr></table>` : '<p class="muted">Sin botellas registradas.</p>'}
  <p class="small muted" style="margin:8px 0 0">Incluye las botellas de eventos que aún no reportas. Si algo no cuadra, haz un <a href="/conteo">conteo</a>.</p></div>
  ${leads.length ? `<h2>Seguimientos pendientes</h2>${leads.map(l => `<div class="card"><strong>${esc(l.name)}</strong>${l.business ? ' · ' + esc(l.business) : ''}<div class="small">${esc(l.next_step || '')}${l.due ? ' · <span class="muted">' + fdate(l.due) + '</span>' : ''}</div></div>`).join('')}<a href="/seguimientos">Ver todos</a>` : ''}
  ${recent.length ? `<h2>Últimos reportes</h2>${recent.map(e => `<a class="card" style="display:block;text-decoration:none;color:inherit" href="/evento/${e.id}"><div class="row"><span>${esc(e.name)}</span><span class="spacer"></span>${pill(e.status, STATUS[e.status])}</div><div class="muted small">${fdate(e.event_date)} · ${int(e.bottles)} botellas</div></a>`).join('')}` : ''}`;
  return layout({ title: 'Mi bodega', body, user });
}

const TIPOS = ['Degustación en tienda', 'Cata profesional / trade', 'Feria o festival', 'Cena maridaje', 'Visita a cliente', 'Capacitación de personal', 'Catalogación / muestra a comprador', 'Otro'];
const PERFILES = ['Consumidores', 'Compradores', 'Sommeliers', 'Restauranteros', 'Prensa / influencers', 'Staff de piso'];

export async function eventPage(env, user, id) {
  const ev = await eventFull(env, id);
  if (!ev || (ev.rep_id !== user.rep?.id && !user.isAdmin)) return null;
  const editable = ev.rep_id === user.rep?.id && ['abierto', 'devuelto'].includes(ev.status) && ev.kind === 'evento';
  if (!editable) return readOnlyEvent(env, user, ev);
  const r = ev.report;
  const v = (k) => esc(r[k] ?? '');
  const money = eventMoney(ev);
  const wineOptions = ev.lines.map(l => `<option ${r.mejor_vino === l.wine ? 'selected' : ''}>${esc(l.wine)}</option>`).join('');
  const body = `
  <a href="/" class="small">← Mi bodega</a>
  <h1>Cerrar evento</h1>
  ${ev.status === 'devuelto' ? `<div class="banner amber">Devuelto por ${esc(ev.reviewed_by)}: ${esc(ev.review_note || '')}</div>` : ''}
  <div class="card"><strong>${esc(ev.name)}</strong><div class="muted small">${ev.so_number ? esc(ev.so_number) + ' · ' : ''}orden del ${fdate(ev.event_date)}</div>
  ${ev.zoho_terms ? `<details class="small" style="margin-top:6px"><summary class="muted">Lo que escribiste en Zoho</summary><p style="white-space:pre-wrap">${esc(ev.zoho_terms)}</p></details>` : ''}</div>

  <form id="f" onsubmit="return false">
  <h2>1 · El evento</h2>
  <label>Nombre del evento</label><input name="nombre" value="${esc(r.nombre ?? ev.name)}">
  <div class="grid2"><div><label>Fecha en que se realizó</label><input type="date" name="fecha" value="${v('fecha') || esc(ev.event_date)}"></div>
  <div><label>Tipo</label><select name="tipo"><option value="">Elige…</option>${TIPOS.map(t => `<option ${r.tipo === t ? 'selected' : ''}>${t}</option>`).join('')}</select></div></div>
  <div class="grid2"><div><label>Lugar o cuenta</label><input name="lugar" value="${v('lugar')}" placeholder="Restaurante, tienda, recinto"></div>
  <div><label>Ciudad</label><input name="ciudad" value="${v('ciudad')}"></div></div>
  <div class="grid2"><div><label>Horas de servicio</label><input type="number" step="0.5" min="0" name="horas" value="${v('horas')}"></div>
  <div><label>¿Asistió alguien del distribuidor?</label><input name="distribuidor" value="${v('distribuidor')}" placeholder="Nombre, o deja vacío"></div></div>

  <h2>2 · Botellas</h2>
  <p class="small muted">Cada botella de la orden debe quedar en una casilla. “Me quedan” son las que regresan a tu bodega.</p>
  ${ev.lines.map(l => `
  <div class="wine-row" data-line="${l.id}" data-qty="${l.qty}">
    <div class="head"><strong>${esc(l.wine)}</strong><span class="muted">${l.qty} ${l.received ? 'recibidas' : 'de tu bodega'}</span></div>
    <div class="nums">
      <div><label>Servidas</label><input type="number" min="0" inputmode="numeric" data-k="poured" value="${l.poured || ''}"></div>
      <div><label>Regaladas</label><input type="number" min="0" inputmode="numeric" data-k="gifted" value="${l.gifted || ''}"></div>
      <div><label>Vendidas</label><input type="number" min="0" inputmode="numeric" data-k="sold" value="${l.sold || ''}"></div>
      <div><label>Rotas</label><input type="number" min="0" inputmode="numeric" data-k="broken" value="${l.broken || ''}"></div>
      <div><label>Devueltas a bodega SMA</label><input type="number" min="0" inputmode="numeric" data-k="returned" value="${l.returned || ''}"></div>
      <div><label>Me quedan</label><input type="number" min="0" inputmode="numeric" data-k="kept" value="${l.kept || ''}"></div>
    </div>
    <div class="gift" style="${l.gifted ? '' : 'display:none'}"><label>¿A quién se regalaron? (nombre y negocio)</label><input data-k="gifted_to" value="${esc(l.gifted_to || '')}"></div>
    <div class="sold" style="${l.sold ? '' : 'display:none'}"><label>¿A quién se vendieron? (cliente y orden o factura)</label><input data-k="sold_to" value="${esc(l.sold_to || '')}"></div>
    <div class="status" style="margin-top:6px"></div>
  </div>`).join('')}

  <h2>3 · Fotos</h2>
  ${['montaje|Montaje con las botellas (obligatoria)', 'botellas|Botellas abiertas o vacías con etiqueta visible (obligatoria)', 'rotas|Botellas rotas (si hubo)', 'exhibicion|Exhibición, anaquel o material POP', 'otra|Otras: público, recibos'].map(x => {
    const [k, label] = x.split('|');
    return `<div class="upl"><div class="row"><strong class="small">${label}</strong><span class="spacer"></span>
      <label class="btn ghost small" style="margin:0">Subir<input type="file" accept="image/*" multiple hidden onchange="up(this,'${k}')"></label></div>
      <div class="photos" id="ph-${k}">${ev.photos.filter(p => p.kind === k).map(p => `<img src="/foto/${p.id}" loading="lazy">`).join('')}</div></div>`;
  }).join('')}

  <h2>4 · Público</h2>
  <div class="grid2"><div><label>Personas que probaron</label><input type="number" min="0" name="personas" value="${v('personas')}"></div>
  <div><label>Contactos obtenidos</label><input type="number" min="0" name="contactos" value="${v('contactos')}"></div></div>
  <label>¿Quiénes eran?</label><div class="row">${PERFILES.map(p => `<label style="font-weight:400;display:flex;gap:6px;align-items:center;margin:4px 10px 4px 0"><input type="checkbox" name="perfil" value="${p}" style="width:auto" ${(r.perfil || []).includes(p) ? 'checked' : ''}>${p}</label>`).join('')}</div>

  <h2>5 · Resultados</h2>
  <div class="grid2"><div><label>Pedidos generados (cajas)</label><input type="number" min="0" name="pedidos_cajas" value="${v('pedidos_cajas')}"></div>
  <div><label>Pedidos generados (MXN)</label><input type="number" min="0" name="pedidos_mxn" value="${v('pedidos_mxn')}"></div></div>
  <label>Colocaciones nuevas (copeo, carta o anaquel)</label>
  <div id="placements">${(ev.placements.length ? ev.placements : []).map(p => placementRow(p, ev.lines)).join('')}</div>
  <button type="button" class="btn ghost small" onclick="addPlacement()">+ Colocación</button>
  <label>Calificación del evento</label><select name="calificacion"><option value="">Elige…</option>${[5, 4, 3, 2, 1].map(n => `<option value="${n}" ${String(r.calificacion) === String(n) ? 'selected' : ''}>${n} ${n === 5 ? '· excelente' : n === 1 ? '· no valió la pena' : ''}</option>`).join('')}</select>
  <label>Lo que funcionó</label><textarea name="funciono">${v('funciono')}</textarea>

  <h2>6 · Seguimientos</h2>
  <p class="small muted">Cada contacto con un siguiente paso y fecha. Aparecen en tu inicio hasta que los marques como hechos.</p>
  <div id="leads">${ev.leads.map(l => leadRow(l)).join('')}</div>
  <button type="button" class="btn ghost small" onclick="addLead()">+ Contacto</button>

  <h2>7 · Lo que dijeron</h2>
  <label>Vino que mejor se mostró</label><select name="mejor_vino"><option value="">Elige…</option>${wineOptions}</select>
  <label>Reacciones al precio</label><textarea name="precio">${v('precio')}</textarea>
  <label>Objeciones y citas de compradores</label><textarea name="objeciones">${v('objeciones')}</textarea>

  <h2>8 · Competencia y material</h2>
  <label>¿Quién más servía, a qué precio y qué se movía?</label><textarea name="competencia">${v('competencia')}</textarea>
  <label>Material POP usado</label><input name="pop" value="${v('pop')}">

  <h2>9 · Costos</h2>
  <div class="grid3"><div><label>Cuota del evento</label><input type="number" min="0" name="cuota" value="${v('cuota')}"></div>
  <div><label>Viáticos</label><input type="number" min="0" name="viaticos" value="${v('viaticos')}"></div>
  <div><label>Otros</label><input type="number" min="0" name="otros_costos" value="${v('otros_costos')}"></div></div>
  <p class="small muted">El valor de las botellas (${mxn(money.bottleValue)} a precio de lista) se suma solo.</p>

  <h2>10 · ¿Lo repetirías?</h2>
  <select name="repetir"><option value="">Elige…</option><option ${r.repetir === 'Sí' ? 'selected' : ''}>Sí</option><option ${r.repetir === 'No' ? 'selected' : ''}>No</option></select>
  <label>¿Qué cambiarías?</label><textarea name="cambiar">${v('cambiar')}</textarea>

  <div id="errs"></div>
  <div class="sticky-foot row"><button class="btn ghost" type="button" onclick="save(false)">Guardar</button><span class="spacer"></span><button class="btn" type="button" onclick="save(true)">Enviar reporte</button></div>
  </form>
  <template id="tpl-lead">${leadRow({})}</template>
  <template id="tpl-pl">${placementRow({}, ev.lines)}</template>
  <script>
  const EID=${ev.id};
  function lineState(row){const q=+row.dataset.qty;let s=0;row.querySelectorAll('.nums input').forEach(i=>s+=+(i.value||0));
    const g=+(row.querySelector('[data-k=gifted]').value||0),so=+(row.querySelector('[data-k=sold]').value||0);
    row.querySelector('.gift').style.display=g?'':'none';row.querySelector('.sold').style.display=so?'':'none';
    const st=row.querySelector('.status');if(s===q){st.textContent='✓ Cuadra';st.className='status ok'}else{st.textContent=(s<q?'Faltan ':'Sobran ')+Math.abs(q-s)+' botellas';st.className='status bad'}}
  document.querySelectorAll('.wine-row').forEach(r=>{r.addEventListener('input',()=>lineState(r));lineState(r)});
  function addLead(){document.getElementById('leads').insertAdjacentHTML('beforeend',document.getElementById('tpl-lead').innerHTML)}
  function addPlacement(){document.getElementById('placements').insertAdjacentHTML('beforeend',document.getElementById('tpl-pl').innerHTML)}
  function collect(){const f=document.getElementById('f');const rep={};
    f.querySelectorAll('[name]').forEach(el=>{if(el.name==='perfil')return;rep[el.name]=el.value});
    rep.perfil=[...f.querySelectorAll('[name=perfil]:checked')].map(x=>x.value);
    const lines=[...document.querySelectorAll('.wine-row')].map(r=>{const o={id:+r.dataset.line};r.querySelectorAll('[data-k]').forEach(i=>o[i.dataset.k]=i.type==='number'?+(i.value||0):i.value);return o});
    const leads=[...document.querySelectorAll('#leads .lead')].map(r=>{const o={};r.querySelectorAll('[data-k]').forEach(i=>o[i.dataset.k]=i.value);return o}).filter(l=>l.name);
    const placements=[...document.querySelectorAll('#placements .pl')].map(r=>{const o={};r.querySelectorAll('[data-k]').forEach(i=>o[i.dataset.k]=i.value);return o}).filter(p=>p.account);
    return {report:rep,lines,leads,placements}}
  async function save(submit){const res=await fetch('/api/eventos/'+EID+(submit?'/enviar':''),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(collect())});
    const j=await res.json();const e=document.getElementById('errs');
    if(j.errors&&j.errors.length){e.innerHTML='<ul class="errs">'+j.errors.map(x=>'<li>'+x.replace(/</g,'&lt;')+'</li>').join('')+'</ul>';e.scrollIntoView({behavior:'smooth'});toast('Revisa lo que falta');return}
    e.innerHTML='';if(submit){location.href='/?ok=1'}else toast('Guardado')}
  async function shrink(file){const img=await createImageBitmap(file);const m=1600,s=Math.min(1,m/Math.max(img.width,img.height));
    const c=document.createElement('canvas');c.width=Math.round(img.width*s);c.height=Math.round(img.height*s);c.getContext('2d').drawImage(img,0,0,c.width,c.height);
    return await new Promise(r=>c.toBlob(r,'image/jpeg',.82))}
  async function up(input,kind){for(const file of input.files){toast('Subiendo foto…');let blob;try{blob=await shrink(file)}catch(e){blob=file}
    const fd=new FormData();fd.append('file',blob,'foto.jpg');fd.append('kind',kind);fd.append('event_id',EID);
    const r=await fetch('/api/fotos',{method:'POST',body:fd});const j=await r.json();
    if(j.id){document.getElementById('ph-'+kind).insertAdjacentHTML('beforeend','<img src="/foto/'+j.id+'">');toast('Foto guardada')}else toast(j.error||'No se pudo subir')}input.value=''}
  </script>`;
  return layout({ title: 'Cerrar evento', body, user });
}

function leadRow(l) {
  return `<div class="card lead"><div class="grid2"><div><label>Nombre</label><input data-k="name" value="${esc(l.name || '')}"></div><div><label>Negocio</label><input data-k="business" value="${esc(l.business || '')}"></div></div>
  <div class="grid2"><div><label>Teléfono o correo</label><input data-k="contact" value="${esc(l.contact || '')}"></div><div><label>Fecha del siguiente paso</label><input type="date" data-k="due" value="${esc(l.due || '')}"></div></div>
  <label>Siguiente paso</label><input data-k="next_step" placeholder="Enviar precios, agendar cita, mandar muestra…" value="${esc(l.next_step || '')}"></div>`;
}
function placementRow(p, lines) {
  return `<div class="card pl"><div class="grid3"><div><label>Cuenta</label><input data-k="account" value="${esc(p.account || '')}"></div>
  <div><label>Vino</label><select data-k="wine"><option value=""></option>${lines.map(l => `<option ${p.wine === l.wine ? 'selected' : ''}>${esc(l.wine)}</option>`).join('')}</select></div>
  <div><label>Tipo</label><select data-k="kind">${['Copeo', 'Carta', 'Anaquel'].map(k => `<option ${p.kind === k ? 'selected' : ''}>${k}</option>`).join('')}</select></div></div></div>`;
}

export async function readOnlyEvent(env, user, ev, adminActions = '') {
  const r = ev.report; const m = eventMoney(ev);
  const kv = (label, val) => val === undefined || val === '' || val === null ? '' : `<dt>${label}</dt><dd>${esc(Array.isArray(val) ? val.join(', ') : val)}</dd>`;
  const body = `
  <a href="${adminActions ? '/admin/eventos' : '/'}" class="small">← Volver</a>
  <div class="row"><h1 style="margin-right:8px">${esc(r.nombre || ev.name)}</h1>${pill(ev.status, STATUS[ev.status] || ev.status)}</div>
  <p class="muted">${esc(ev.rep_name)} · ${ev.so_number ? esc(ev.so_number) + ' · ' : ''}${fdate(r.fecha || ev.event_date)}${ev.kind === 'reposicion' ? ' · reposición de bodega' : ''}</p>
  ${ev.status === 'devuelto' ? `<div class="banner amber">Devuelto: ${esc(ev.review_note || '')}</div>` : ''}
  ${adminActions}
  ${ev.kind === 'evento' && ev.submitted_at ? `<div class="kpis">
    <div class="kpi"><div class="v">${int(m.used)}</div><div class="l">botellas usadas</div></div>
    <div class="kpi"><div class="v">${mxn(m.total)}</div><div class="l">costo total (botellas ${mxn(m.bottleValue)} + gastos ${mxn(m.costs)})</div></div>
    <div class="kpi"><div class="v">${mxn(m.orders)}</div><div class="l">pedidos generados</div></div>
    <div class="kpi ${m.roi !== null && m.roi < 1 ? 'bad' : ''}"><div class="v">${m.roi === null ? '—' : m.roi.toFixed(1) + '×'}</div><div class="l">retorno (pedidos ÷ costo)</div></div></div>` : ''}
  <h2>Botellas</h2><div class="card scroll"><table><tr><th>Vino</th><th class="n">Total</th><th class="n">Servidas</th><th class="n">Regaladas</th><th class="n">Vendidas</th><th class="n">Rotas</th><th class="n">Devueltas</th><th class="n">Le quedan</th></tr>
  ${ev.lines.map(l => `<tr><td>${esc(l.wine)}${l.gifted_to ? `<div class="small muted">Regalo: ${esc(l.gifted_to)}</div>` : ''}${l.sold_to ? `<div class="small muted">Venta: ${esc(l.sold_to)}</div>` : ''}</td><td class="n">${l.qty}</td><td class="n">${l.poured}</td><td class="n">${l.gifted}</td><td class="n">${l.sold}</td><td class="n">${l.broken}</td><td class="n">${l.returned}</td><td class="n">${l.kept}</td></tr>`).join('')}</table></div>
  ${ev.photos.length ? `<h2>Fotos</h2><div class="photos">${ev.photos.map(p => `<a href="/foto/${p.id}" target="_blank"><img src="/foto/${p.id}" title="${esc(p.kind)}"></a>`).join('')}</div>` : ''}
  ${ev.kind === 'evento' ? `<h2>Reporte</h2><div class="card"><dl class="kv">
    ${kv('Tipo', r.tipo)}${kv('Lugar', [r.lugar, r.ciudad].filter(Boolean).join(', '))}${kv('Horas', r.horas)}${kv('Distribuidor', r.distribuidor)}
    ${kv('Personas', r.personas)}${kv('Perfil', r.perfil)}${kv('Contactos', r.contactos)}${kv('Pedidos', r.pedidos_cajas ? r.pedidos_cajas + ' cajas · ' + mxn(r.pedidos_mxn) : '')}
    ${kv('Calificación', r.calificacion)}${kv('Funcionó', r.funciono)}${kv('Mejor vino', r.mejor_vino)}${kv('Precio', r.precio)}${kv('Objeciones', r.objeciones)}
    ${kv('Competencia', r.competencia)}${kv('POP', r.pop)}${kv('Cuota', r.cuota ? mxn(r.cuota) : '')}${kv('Viáticos', r.viaticos ? mxn(r.viaticos) : '')}${kv('Otros costos', r.otros_costos ? mxn(r.otros_costos) : '')}
    ${kv('¿Repetir?', r.repetir)}${kv('Cambiaría', r.cambiar)}</dl></div>
  ${ev.placements.length ? `<h3>Colocaciones</h3><div class="card"><table>${ev.placements.map(p => `<tr><td>${esc(p.account)}</td><td>${esc(p.wine || '')}</td><td>${esc(p.kind || '')}</td></tr>`).join('')}</table></div>` : ''}
  ${ev.leads.length ? `<h3>Seguimientos</h3><div class="card"><table>${ev.leads.map(l => `<tr><td>${esc(l.name)}<div class="small muted">${esc(l.business || '')} ${esc(l.contact || '')}</div></td><td>${esc(l.next_step || '')}</td><td>${fdate(l.due)}</td><td>${l.done ? '✓' : ''}</td></tr>`).join('')}</table></div>` : ''}` : ''}
  ${ev.zoho_terms ? `<h3>Términos en Zoho</h3><p class="small" style="white-space:pre-wrap">${esc(ev.zoho_terms)}</p>` : ''}`;
  return layout({ title: ev.name, body, user, wide: !!adminActions, admin: !!adminActions });
}

export async function newEventPage(env, user) {
  const hold = (await holdings(env, user.rep.id)).filter(h => h.qty > 0);
  const body = `<a href="/" class="small">← Mi bodega</a><h1>Evento con vino de mi bodega</h1>
  <p class="muted">Para catas o entregas que hagas con botellas que ya tienes. Elige cuántas llevaste de cada vino; después cierras el evento como siempre.</p>
  <form method="post" action="/evento/nuevo">
  <label>Nombre del evento</label><input name="name" required>
  <label>Fecha</label><input type="date" name="date" required value="${new Date().toISOString().slice(0, 10)}">
  <h2>Botellas que llevaste</h2>
  ${hold.length ? hold.map((h, i) => `<div class="wine-row"><div class="head"><span>${esc(h.wine)}</span><span class="muted small">tienes ${h.qty}</span></div>
     <input type="hidden" name="wine${i}" value="${esc(h.wine)}"><input type="number" min="0" max="${h.qty}" name="qty${i}" inputmode="numeric" style="margin-top:6px"></div>`).join('') : '<p class="muted">No tienes botellas en tu bodega.</p>'}
  <input type="hidden" name="n" value="${hold.length}"><div class="sticky-foot"><button class="btn block">Crear evento</button></div></form>`;
  return layout({ title: 'Nuevo evento', body, user });
}

export async function countPage(env, user) {
  const hold = await holdings(env, user.rep.id);
  const wines = (await env.DB.prepare(`SELECT DISTINCT wine FROM event_lines l JOIN events e ON e.id=l.event_id WHERE e.rep_id=? ORDER BY wine`).bind(user.rep.id).all()).results.map(r => r.wine);
  const all = [...new Set([...hold.map(h => h.wine), ...wines])].sort();
  const pending = await env.DB.prepare(`SELECT id FROM counts WHERE rep_id=? AND status='enviado'`).bind(user.rep.id).first();
  const body = `<a href="/" class="small">← Mi bodega</a><h1>Conteo de bodega</h1>
  ${pending ? '<div class="banner amber">Tienes un conteo esperando revisión. Puedes enviar otro si encontraste algo más.</div>' : ''}
  <p class="muted">Cuenta físicamente lo que tienes hoy, vino por vino, y toma una foto del inventario. Escribe 0 si no tienes de un vino.</p>
  <form id="c" onsubmit="return false">
  ${all.map((w, i) => `<div class="wine-row row"><span style="flex:1">${esc(w)}</span><input type="number" min="0" inputmode="numeric" data-wine="${esc(w)}" style="max-width:90px"></div>`).join('')}
  <div class="wine-row"><label style="margin-top:0">¿Otro vino que no aparece?</label><div class="row"><input id="ow" placeholder="Nombre y añada" style="flex:1"><input id="oq" type="number" min="0" style="max-width:90px"></div></div>
  <div class="upl"><div class="row"><strong class="small">Foto del inventario (obligatoria)</strong><span class="spacer"></span>
  <label class="btn ghost small" style="margin:0">Subir<input type="file" accept="image/*" hidden onchange="pick(this)"></label></div><div class="photos" id="ph"></div></div>
  <label>Notas</label><textarea id="note"></textarea>
  <div id="errs"></div>
  <div class="sticky-foot"><button class="btn block" onclick="send()">Enviar conteo</button></div></form>
  <script>
  let photo=null;
  async function shrink(file){const img=await createImageBitmap(file);const m=1600,s=Math.min(1,m/Math.max(img.width,img.height));const c=document.createElement('canvas');c.width=Math.round(img.width*s);c.height=Math.round(img.height*s);c.getContext('2d').drawImage(img,0,0,c.width,c.height);return await new Promise(r=>c.toBlob(r,'image/jpeg',.82))}
  async function pick(i){try{photo=await shrink(i.files[0])}catch(e){photo=i.files[0]}document.getElementById('ph').innerHTML='<img src="'+URL.createObjectURL(photo)+'">'}
  async function send(){const lines=[...document.querySelectorAll('[data-wine]')].map(i=>({wine:i.dataset.wine,counted:i.value===''?null:+i.value}));
    const ow=document.getElementById('ow').value.trim();if(ow)lines.push({wine:ow,counted:+(document.getElementById('oq').value||0)});
    const errs=[];if(lines.some(l=>l.counted===null))errs.push('Escribe una cantidad en cada vino (0 si no tienes).');if(!photo)errs.push('Falta la foto del inventario.');
    const e=document.getElementById('errs');if(errs.length){e.innerHTML='<ul class="errs">'+errs.map(x=>'<li>'+x+'</li>').join('')+'</ul>';return}
    const fd=new FormData();fd.append('lines',JSON.stringify(lines));fd.append('note',document.getElementById('note').value);fd.append('file',photo,'conteo.jpg');
    const r=await fetch('/api/conteos',{method:'POST',body:fd});const j=await r.json();if(j.ok)location.href='/?conteo=1';else e.innerHTML='<ul class="errs"><li>'+(j.error||'Error')+'</li></ul>'}
  </script>`;
  return layout({ title: 'Conteo', body, user });
}

export async function leadsPage(env, user) {
  const { results } = await env.DB.prepare(`SELECT l.*, e.name AS ev FROM leads l LEFT JOIN events e ON e.id=l.event_id WHERE l.rep_id=? ORDER BY l.done, l.due IS NULL, l.due`).bind(user.rep.id).all();
  const body = `<h1>Seguimientos</h1>${results.length ? results.map(l => `<div class="card" style="${l.done ? 'opacity:.55' : ''}"><div class="row"><strong>${esc(l.name)}</strong><span class="muted">${esc(l.business || '')}</span><span class="spacer"></span>
    ${l.done ? '<span class="pill aprobado">Hecho</span>' : `<form method="post" action="/seguimientos/${l.id}/hecho" style="margin:0"><button class="btn small ghost">Marcar hecho</button></form>`}</div>
    <div>${esc(l.next_step || '')} ${l.due ? '<span class="muted small">· ' + fdate(l.due) + '</span>' : ''}</div><div class="small muted">${esc(l.contact || '')} · ${esc(l.ev || '')}</div></div>`).join('') : '<p class="muted">Aún no tienes seguimientos. Se agregan al cerrar un evento.</p>'}`;
  return layout({ title: 'Seguimientos', body, user });
}
