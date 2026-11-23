// Rumbo — phone app. One GET /api/estado paints everything; every change posts and repaints.
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let S = null;                                    // state from the server
const ui = { ini: 'activas', ideas: 'todo', logros: 'todo' };

const AREA = { restaurante: 'Restaurante', enoturismo: 'Enoturismo', eventos: 'Eventos', club: 'Club', alianzas: 'Alianzas', costos: 'Costos', controles: 'Controles', equipo: 'Equipo' };
const ETAPA = { idea: 'Idea', planeacion: 'Planeación', marcha: 'En marcha', resultado: 'Resultado', pausada: 'Pausada', cerrada: 'Cerrada' };
const ETAPA_L = { propuesta: 'Propuesta', marcha: 'En marcha', resultado: 'Resultado' };
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const IC = {
  inicio: '<path d="M4 11l8-6.500 8 6.500"/><path d="M6 10v9h12v-9"/>',
  iniciativas: '<circle cx="12" cy="12" r="8.500"/><circle cx="12" cy="12" r="4.500"/><circle cx="12" cy="12" r=".800"/>',
  ideas: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.600 10.800c.6.5 1 1.200 1 2v.2h5.200v-.2c0-.8.4-1.500 1-2A6 6 0 0 0 12 3z"/>',
  logros: '<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H5v1a3 3 0 0 0 3 3M16 6h3v1a3 3 0 0 1-3 3M12 13v4M9 20h6"/>',
};
const TABS = [['inicio', 'Inicio'], ['iniciativas', 'Iniciativas'], ['ideas', 'Ideas'], ['logros', 'Logros']];

// ---- helpers
const fFecha = (f, conAnio) => { if (!f) return ''; const [y, m, d] = f.split('-').map(Number); return `${d} ${MESES[m - 1]}${conAnio || String(y) !== S.hoy.slice(0, 4) ? ' ' + y : ''}`; };
const diasEntre = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
const hace = (f) => { const d = diasEntre(f, S.hoy); return d <= 0 ? 'hoy' : d === 1 ? 'ayer' : d < 14 ? `hace ${d} días` : fFecha(f); };
const fNum = (v, u) => { if (v == null) return '—'; const n = Number(v).toLocaleString('es-MX', { maximumFractionDigits: Math.abs(v) < 100 && v % 1 ? 1 : 0 }); return u === '$' ? '$' + n : u === '%' ? n + '%' : n; };
const uni = (u) => (u && u !== '$' && u !== '%' ? ' ' + esc(u) : '');
const tono = (n) => (n == null ? '' : n >= 70 ? 'alto' : n < 40 ? 'bajo' : '');
const anillo = (n, sm) => { const r = sm ? 18 : 44, c = 2 * Math.PI * r, t = sm ? 44 : 104, v = n == null ? 0 : n;
  return `<div class="anillo ${sm ? 'sm' : ''} ${tono(n)}"><svg viewBox="0 0 ${t} ${t}"><circle class="f" cx="${t / 2}" cy="${t / 2}" r="${r}"/><circle class="v" cx="${t / 2}" cy="${t / 2}" r="${r}" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - v / 100)}"/></svg><div class="t"><b class="tnum">${n == null ? '—' : n}</b>${sm ? '' : '<span>de 100</span>'}</div></div>`; };
const partes = (s) => [['Ritmo', s.ritmo, 30], ['Avance', s.avance, 30], ['Resultado', s.resultado, 40]].map(([t, v, m]) => `<div class="parte"><span>${t}</span><b class="tnum">${v}<span style="font-weight:400;color:var(--muted)"> / ${m}</span></b><div class="bar"><i style="width:${Math.round(100 * v / m)}%"></i></div></div>`).join('');
const chipE = (e, mapa = ETAPA) => `<span class="chip e-${e}">${mapa[e] || e}</span>`;
const porId = (id) => S.iniciativas.find((i) => i.id === +id);
const toast = (t) => { const el = $('#toast'); el.textContent = t; el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (el.hidden = true), 3200); };

async function api(path, method = 'GET', body) {
  const r = await fetch('api' + path, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'No se pudo guardar. Revisa tu conexión.');
  return j;
}
async function cargar() { S = await api('/estado'); pintar(); }
async function hacer(fn, ok) { try { const r = await fn(); await cargar(); if (ok) toast(ok); return r; } catch (e) { toast(e.message); return null; } }

// ---- router
function ruta() { const h = location.hash.replace(/^#/, '') || 'inicio'; const [v, id] = h.split('/'); return { v, id }; }
function pintar() {
  const { v, id } = ruta(), tab = v === 'i' ? 'iniciativas' : v;
  const nav = TABS.map(([k, t]) => `<a href="#${k}" ${k === tab ? 'aria-current="page"' : ''}><svg viewBox="0 0 24 24" aria-hidden="true">${IC[k]}</svg><span>${t}</span></a>`).join('');
  $('#tabs').innerHTML = nav; $('#nav').innerHTML = nav + `<a href="#rol" ${v === 'rol' ? 'aria-current="page"' : ''}><svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.600"/><path d="M4.500 20c1-4 4-5.500 7.500-5.500s6.500 1.500 7.500 5.500"/></svg><span>Mi rol</span></a>`;
  $('#me').textContent = S.yo.nombre; $('#fab').hidden = !S.yo.puede; $('#pop').hidden = true;
  $('#rol').toggleAttribute('aria-current', v === 'rol'); if (v === 'rol') $('#rol').setAttribute('aria-current', 'page');
  const det = v === 'i'; $('#atras').hidden = !det; $('.brand.mob').hidden = det;
  const vistas = { inicio: vInicio, iniciativas: vIniciativas, i: () => vDetalle(id), ideas: vIdeas, logros: vLogros, rol: vRol };
  const [titulo, html] = (vistas[v] || vInicio)();
  $('#titulo').textContent = titulo; $('#main').innerHTML = html;
  if (pintar.ultima !== location.hash) { window.scrollTo(0, 0); pintar.ultima = location.hash; }
}

// ---- Inicio
function vInicio() {
  const g = S.score, act = S.iniciativas.filter((i) => i.score);
  const pend = act.filter((i) => i.score.hace == null || i.score.hace > 7 || (i.siguiente_fecha && i.siguiente_fecha < S.hoy) || !i.siguiente);
  const porConf = S.iniciativas.filter((i) => i.revisar).length + S.logros.filter((l) => l.revisar).length;
  const mes = S.hoy.slice(0, 7), delMes = S.logros.filter((l) => l.fecha.startsWith(mes)).length, conRes = S.logros.filter((l) => l.etapa === 'resultado').length;
  let h = `<section class="card"><div class="hero">${anillo(g.total)}<div class="partes">${g.total == null ? '<p class="note">Aún no hay iniciativas con calificación. Adopta una idea o crea la tuya.</p>' : partes(g)}</div></div>
    <p class="note" style="margin-top:12px">${g.n ? `Promedio de ${g.n} iniciativa${g.n === 1 ? '' : 's'} · ${S.activas} de ${S.tope} lugares activos. ` : ''}${g.n && g.ritmo === 0 ? 'Sube en cuanto hagas el primer registro de la semana. ' : ''}<button class="lnk" data-a="formula">Cómo se calcula</button></p></section>`;
  if (porConf && S.yo.puede) h += `<section class="card"><div class="head"><h2>Por confirmar</h2><span class="chip aviso">${porConf}</span></div><p class="note">Dejamos cargado lo que ya has hecho desde abril. Abre cada uno, completa el detalle y confírmalo para que cuente como tuyo.</p>
    <div class="chips" style="margin-top:10px"><a class="btn sm" href="#logros" data-f="logros:confirmar">Logros por confirmar</a><a class="btn sm" href="#iniciativas">Iniciativas</a></div></section>`;
  h += `<section class="card"><div class="head"><h2>Esta semana</h2><a href="#iniciativas">Todas</a></div>${pend.length ? pend.map((i) => {
    const t = i.score.hace == null ? 'Sin registro todavía' : i.score.hace > 7 ? `Último registro ${hace(i.registros[0].fecha)}` : !i.siguiente ? 'Falta el siguiente paso' : 'El siguiente paso ya venció';
    return `<div class="fila">${anillo(i.score.total, true)}<a class="cx" href="#i/${i.id}"><b>${esc(i.titulo)}</b><span>${t}</span></a>${S.yo.puede ? `<button class="btn sm" data-a="registro" data-id="${i.id}">Registrar</button>` : ''}</div>`; }).join('')
    : `<p class="note">${act.length ? 'Todo al día: cada iniciativa tiene su registro de la semana y su siguiente paso.' : 'Cuando tengas iniciativas en marcha, aquí verás cuáles necesitan su registro semanal.'}</p>`}</section>`;
  if (S.club) { const c = S.club, max = Math.max(4, ...c.porMes.map((m) => m.n));
    h += `<section class="card"><div class="head"><h2>Club de vinos</h2><span class="note">directo del sistema del club</span></div>
      <div class="kpis"><div><b class="tnum">${c.altas}</b><span>altas en ${S.ventana} días</span></div><div><b class="tnum">${c.bajas}</b><span>bajas en ${S.ventana} días</span></div><div><b class="tnum">${c.activos}</b><span>socios activos</span></div></div>
      <div class="mes" role="img" aria-label="Altas por mes">${c.porMes.map((m) => `<div><i class="${m.n >= 4 ? 'ok' : ''}" style="height:${Math.max(3, Math.round(100 * m.n / max))}%"><b>${m.n}</b></i>${MESES[+m.mes.slice(5) - 1]}</div>`).join('')}</div>
      <p class="note" style="margin-top:8px">Altas por mes. ${c.ultima ? `La última fue el ${fFecha(c.ultima)}.` : ''}</p></section>`; }
  h += `<section class="card"><div class="head"><h2>Logros</h2><a href="#logros">Ver todos</a></div><div class="kpis"><div><b class="tnum">${S.logros.length}</b><span>en total</span></div><div><b class="tnum">${conRes}</b><span>con resultado</span></div><div><b class="tnum">${delMes}</b><span>este mes</span></div></div>
    ${S.logros.slice(0, 3).map((l) => `<div class="fila" style="${''}"><div class="cx"><b>${esc(l.titulo)}</b><span>${fFecha(l.fecha)} · ${AREA[l.area] || l.area}</span></div>${chipE(l.etapa, ETAPA_L)}</div>`).join('').replace('<div class="fila"', '<div class="fila" style="margin-top:12px;border-top:0"')}</section>`;
  return ['Rumbo', h];
}

// ---- Iniciativas
function tarjetaIni(i) {
  const m = i.medidas.find((x) => x.lectura.meta != null), tarde = i.siguiente_fecha && i.siguiente_fecha < S.hoy;
  return `<a class="card ini" href="#i/${i.id}"><div><h2>${esc(i.titulo)}</h2><div class="chips"><span class="chip">${AREA[i.area] || i.area}</span>${chipE(i.etapa)}${i.revisar ? '<span class="chip aviso">Por confirmar</span>' : ''}${i.origen === 'sugerida' ? '<span class="chip">Sugerida por Eric</span>' : ''}</div></div>${i.score ? anillo(i.score.total, true) : ''}
    ${m ? `<div class="med"><span>${esc(m.nombre)}: <b style="color:var(--text)">${fNum(m.lectura.valor, m.unidad)}</b> de ${fNum(m.lectura.meta, m.unidad)}${uni(m.unidad)}</span><div class="bar ${m.lectura.pct >= 1 ? 'ok' : ''}"><i style="width:${Math.round(100 * (m.lectura.pct || 0))}%"></i></div></div>` : ''}
    ${i.score ? `<div class="sig ${tarde ? 'tarde' : ''}">${i.siguiente ? `<span>Sigue:</span><b>${esc(i.siguiente)}${i.siguiente_fecha ? ' · ' + fFecha(i.siguiente_fecha) : ''}</b>` : '<span>Falta definir el siguiente paso</span>'}</div>` : ''}</a>`;
}
function vIniciativas() {
  const g = { activas: S.iniciativas.filter((i) => i.score), ideas: S.iniciativas.filter((i) => i.etapa === 'idea'), fuera: S.iniciativas.filter((i) => ['pausada', 'cerrada'].includes(i.etapa)) };
  if (!g[ui.ini].length && ui.ini !== 'activas' ) ui.ini = 'activas';
  const seg = [['activas', 'En curso'], ['ideas', 'Ideas'], ['fuera', 'Pausadas y cerradas']].filter(([k]) => k === 'activas' || g[k].length)
    .map(([k, t]) => `<button data-f="ini:${k}" aria-pressed="${ui.ini === k}">${t}<span class="n">${g[k].length}</span></button>`).join('');
  const l = g[ui.ini].slice().sort((a, b) => (a.score && b.score ? a.score.total - b.score.total : 0));
  const vacio = `<div class="card vacio"><b>${ui.ini === 'activas' ? 'Todavía no hay iniciativas en curso' : 'Nada aquí'}</b>Elige una idea de la biblioteca o escribe la tuya.<br><a class="btn pri" href="#ideas">Ver ideas</a></div>`;
  return ['Iniciativas', `<div class="seg">${seg}</div>${ui.ini === 'activas' && l.length ? `<p class="note">${S.activas} de ${S.tope} lugares activos (Planeación y En marcha). Primero las que más atención piden.</p>` : ''}${ui.ini === 'ideas' ? '<p class="note">Ideas guardadas. Ábrela y pásala a Planeación cuando la vayas a trabajar.</p>' : ''}<div class="lista">${l.length ? l.map(tarjetaIni).join('') : vacio}</div>`];
}

function vDetalle(id) {
  const i = porId(id); if (!i) return ['Iniciativa', '<div class="card vacio"><b>Esta iniciativa ya no existe</b><a class="btn" href="#iniciativas">Volver</a></div>'];
  const p = S.yo.puede, s = i.score, logros = S.logros.filter((l) => l.iniciativa_id === i.id), coms = S.comentarios.filter((c) => c.tipo === 'iniciativa' && c.ref_id === i.id);
  const nomM = new Map(i.medidas.map((m) => [String(m.id), m]));
  let h = `<section class="card det"><div class="chips" style="margin-bottom:8px"><span class="chip">${AREA[i.area] || i.area}</span><span class="chip">${{ ingreso: 'Genera ingreso', ahorro: 'Ahorra', base: 'Base de la operación' }[i.tipo]}</span>${i.revisar ? '<span class="chip aviso">Por confirmar</span>' : ''}</div>
    <h2 class="t">${esc(i.titulo)}</h2>${i.porque ? `<p class="porque">${esc(i.porque)}</p>` : ''}
    <div class="linea" style="margin-top:14px"><label class="note" for="etapa">Etapa</label>${p ? `<select class="sel" id="etapa" data-id="${i.id}">${Object.entries(ETAPA).map(([k, t]) => `<option value="${k}" ${k === i.etapa ? 'selected' : ''}>${t}</option>`).join('')}</select>` : chipE(i.etapa)}</div>
    ${i.revisar && p ? `<div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn pri sm" data-a="confirmar-ini" data-id="${i.id}">Confirmar: sí la estoy trabajando</button></div><p class="note" style="margin-top:6px">La dejamos cargada por lo que ya vienes haciendo. Ajusta la etapa, los hitos y las metas a la realidad.</p>` : ''}</section>`;
  if (s) h += `<section class="card"><div class="hero">${anillo(s.total)}<div class="partes">${partes(s)}</div></div>${s.notas.length ? `<ul class="notas">${s.notas.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}${s.porHitos ? '<p class="note" style="margin-top:8px">Sin meta numérica: el Resultado se califica por hitos cumplidos.</p>' : ''}</section>`;
  else if (i.etapa === 'idea') h += `<section class="card"><p class="note">Es una idea: todavía no se califica. Pásala a Planeación cuando la vayas a trabajar${S.activas >= S.tope ? ` (hoy tienes ${S.activas} de ${S.tope} lugares activos: cierra o pausa una primero)` : ''}.</p></section>`;
  if (s) h += `<section class="card"><div class="head"><h2>Siguiente paso</h2>${p ? `<button class="lnk" data-a="siguiente" data-id="${i.id}">${i.siguiente ? 'Cambiar' : 'Definir'}</button>` : ''}</div>${i.siguiente ? `<p><b style="font-weight:600">${esc(i.siguiente)}</b></p><p class="note" style="${i.siguiente_fecha && i.siguiente_fecha < S.hoy ? 'color:var(--bad)' : ''}">${i.siguiente_fecha ? (i.siguiente_fecha < S.hoy ? 'Venció el ' : 'Para el ') + fFecha(i.siguiente_fecha) : 'Sin fecha'}</p>` : '<p class="note">Una sola acción concreta, con fecha.</p>'}</section>`;
  h += `<section class="card"><div class="head"><h2>Números</h2>${p ? `<button class="lnk" data-a="medida" data-id="${i.id}">Agregar</button>` : ''}</div>${i.medidas.length ? i.medidas.map((m) => { const l = m.lectura;
    return `<div class="medida"><div class="r"><b>${esc(m.nombre)}</b><span><b class="tnum">${fNum(l.valor, m.unidad)}</b>${l.meta != null ? ` de ${fNum(l.meta, m.unidad)}` : ''}${uni(m.unidad)}</span></div>${l.meta != null ? `<div class="bar ${l.pct >= 1 ? 'ok' : ''}"><i style="width:${Math.round(100 * (l.pct || 0))}%"></i></div>` : ''}
      <div class="pie"><span>${m.auto ? 'Automático, del sistema del club' : m.modo === 'ultimo' ? 'Último dato' : 'Suma'} · ${S.ventana} días${m.sentido === 'baja' ? ' · menos es mejor' : ''}${l.meta == null ? ' · sin meta' : ''}</span>${p ? `<button class="lnk" data-a="medida" data-id="${i.id}" data-m="${m.id}">Editar</button>` : ''}</div></div>`; }).join('') : '<p class="note">Sin números. Agrega uno o dos que digan si esto está funcionando.</p>'}</section>`;
  h += `<section class="card"><div class="head"><h2>Hitos</h2><span class="note">${i.pasos.filter((x) => x.hecho).length} de ${i.pasos.length}</span></div>${i.pasos.map((x) => `<label class="paso ${x.hecho ? 'hecho' : ''}"><input type="checkbox" data-paso="${x.id}" ${x.hecho ? 'checked' : ''} ${p ? '' : 'disabled'}><span>${esc(x.texto)}</span>${p ? `<button type="button" data-a="borra-paso" data-id="${x.id}" aria-label="Quitar hito">×</button>` : ''}</label>`).join('')}
    ${p ? `<form class="agrega" data-form="paso" data-id="${i.id}"><label class="c"><input name="texto" placeholder="Agregar hito" maxlength="200" aria-label="Nuevo hito"></label><button class="btn">Agregar</button></form>` : ''}</section>`;
  h += `<section class="card"><div class="head"><h2>Registros</h2>${p && s ? `<button class="btn pri sm" data-a="registro" data-id="${i.id}">Registrar</button>` : ''}</div>${i.registros.length ? i.registros.slice(0, 12).map((r) => `<div class="reg"><div class="r"><span>${fFecha(r.fecha)}</span>${p ? `<button class="x" data-a="borra-reg" data-id="${r.id}" aria-label="Borrar registro">×</button>` : ''}</div>
      ${Object.keys(r.valores).length ? `<div class="v">${Object.entries(r.valores).map(([k, v]) => nomM.has(k) ? `<span class="chip">${esc(nomM.get(k).nombre)}: ${fNum(v, nomM.get(k).unidad)}</span>` : '').join('')}</div>` : ''}${r.nota ? `<p>${esc(r.nota)}</p>` : ''}</div>`).join('') : '<p class="note">Un registro por semana: los números, qué pasó y qué sigue.</p>'}</section>`;
  h += `<section class="card"><div class="head"><h2>Logros de esta iniciativa</h2>${p ? `<button class="lnk" data-a="logro" data-ini="${i.id}">Agregar</button>` : ''}</div>${logros.length ? logros.map((l) => `<div class="fila"><div class="cx"><b>${esc(l.titulo)}</b><span>${fFecha(l.fecha)}</span></div>${chipE(l.etapa, ETAPA_L)}</div>`).join('') : '<p class="note">Aún no hay logros ligados.</p>'}</section>`;
  h += comentarios('iniciativa', i.id, coms);
  if (p) h += `<div style="display:flex;justify-content:center"><button class="btn peligro sm" data-a="borra-ini" data-id="${i.id}">Eliminar iniciativa</button></div>`;
  return [i.titulo, h];
}
const comentarios = (tipo, id, coms) => `<section class="card"><div class="head"><h2>Comentarios</h2></div>${coms.map((c) => `<div class="com"><div class="r"><span>${esc(c.nombre || c.por)} · ${hace(c.creado.slice(0, 10))}</span>${c.por === S.yo.email || S.yo.admin ? `<button class="x" data-a="borra-com" data-id="${c.id}" aria-label="Borrar comentario">×</button>` : ''}</div><p>${esc(c.texto)}</p></div>`).join('')}
  <form class="agrega" data-form="com" data-tipo="${tipo}" data-id="${id}"><label class="c"><input name="texto" placeholder="Escribe un comentario" maxlength="1000" aria-label="Comentario"></label><button class="btn">Enviar</button></form></section>`;

// ---- Ideas
function vIdeas() {
  const mias = new Map(S.iniciativas.filter((i) => i.clave && i.etapa !== 'cerrada').map((i) => [i.clave, i]));
  const f = { todo: () => true, ingreso: (c) => c.tipo === 'ingreso', ahorro: (c) => c.tipo === 'ahorro', base: (c) => c.tipo === 'base' };
  const cuenta = (k) => S.biblioteca.filter(f[k]).length;
  const seg = [['todo', 'Todas'], ['ingreso', 'Generar ingreso'], ['ahorro', 'Ahorrar'], ['base', 'Bases']].map(([k, t]) => `<button data-f="ideas:${k}" aria-pressed="${ui.ideas === k}">${t}<span class="n">${cuenta(k)}</span></button>`).join('');
  const l = S.biblioteca.filter(f[ui.ideas]), areas = S.areas.filter((a) => l.some((c) => c.area === a)), sug = S.yo.admin && !S.yo.director;
  const h = areas.map((a) => `<div class="grupo"><h3>${AREA[a]}</h3><div class="lista">${l.filter((c) => c.area === a).map((c) => { const m = mias.get(c.clave);
    return `<details class="card idea"><summary><h2><span>${esc(c.titulo)}</span></h2><p>${esc(c.resumen)}</p>${m ? `<div class="chips" style="margin-top:4px">${chipE(m.etapa)}<span class="chip">En tu tablero</span></div>` : ''}</summary><div class="cuerpo">
      <div><h3>Por qué paga</h3><p class="paga">${esc(c.paga)}</p></div><div><h3>Primeros pasos</h3><ol>${c.pasos.map((x) => `<li>${esc(x)}</li>`).join('')}</ol></div>
      <div><h3>Lo que registras</h3><div class="chips">${c.medidas.map((x) => `<span class="chip">${esc(x.nombre)}${x.meta != null ? ` · meta ${fNum(x.meta, x.unidad)}${x.modo === 'ultimo' ? '' : x.periodo === 'semana' ? ' por semana' : ' al mes'}` : ''}</span>`).join('')}</div></div>
      ${m ? `<a class="btn" href="#i/${m.id}">Abrir en mi tablero</a>` : S.yo.puede ? `<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn pri" data-a="adoptar" data-clave="${c.clave}">${sug ? 'Sugerir a Michael' : 'Adoptar'}</button>${sug ? '' : `<button class="btn" data-a="adoptar" data-clave="${c.clave}" data-idea="1">Guardar como idea</button>`}</div>` : ''}</div></details>`; }).join('')}</div></div>`).join('');
  return ['Ideas', `<p class="note">Jugadas probadas de un director de A&B para generar ingreso o ahorrar. Adopta una y entra a tu tablero con sus hitos y sus números listos; todo se puede ajustar.</p><div class="seg">${seg}</div>${h}${S.yo.puede ? `<div class="card vacio"><b>¿Tienes otra en mente?</b>Escribe tu propia iniciativa.<br><button class="btn" data-a="nueva">Crear iniciativa propia</button></div>` : ''}`];
}

// ---- Logros
function vLogros() {
  const f = { todo: () => true, resultado: (l) => l.etapa === 'resultado', marcha: (l) => l.etapa === 'marcha', propuesta: (l) => l.etapa === 'propuesta', confirmar: (l) => l.revisar };
  const seg = [['todo', 'Todos'], ['resultado', 'Resultado'], ['marcha', 'En marcha'], ['propuesta', 'Propuesta'], ['confirmar', 'Por confirmar']].filter(([k]) => k !== 'confirmar' || S.logros.some(f.confirmar))
    .map(([k, t]) => `<button data-f="logros:${k}" aria-pressed="${ui.logros === k}">${t}<span class="n">${S.logros.filter(f[k]).length}</span></button>`).join('');
  const l = S.logros.filter(f[ui.logros] || f.todo), meses = [...new Set(l.map((x) => x.fecha.slice(0, 7)))];
  const h = meses.map((m) => `<div class="grupo"><h3>${MESES[+m.slice(5) - 1]} ${m.slice(0, 4)}</h3><div class="lista">${l.filter((x) => x.fecha.startsWith(m)).map((x) => { const ini = x.iniciativa_id && porId(x.iniciativa_id);
    return `<button class="card logro" data-a="logro" data-id="${x.id}"><div><h2>${esc(x.titulo)}</h2>${x.detalle && !x.revisar ? `<p>${esc(x.detalle)}</p>` : ''}<div class="chips">${chipE(x.etapa, ETAPA_L)}<span class="chip">${AREA[x.area] || x.area}</span>${ini ? `<span class="chip">${esc(ini.titulo.length > 26 ? ini.titulo.slice(0, 25) + '…' : ini.titulo)}</span>` : ''}${x.url ? '<span class="chip">Enlace</span>' : ''}${x.revisar ? '<span class="chip aviso">Por confirmar</span>' : ''}</div></div>${x.archivo_id ? `<img src="api/archivos/${x.archivo_id}" alt="" loading="lazy">` : ''}</button>`; }).join('')}</div></div>`).join('');
  return ['Logros', `<div class="seg">${seg}</div>${ui.logros === 'propuesta' && l.length ? '<p class="note">Lo que sigue en propuesta. Cuando arranque o dé resultado, ábrelo y cámbiale la etapa.</p>' : ''}${l.length ? h : `<div class="card vacio"><b>${S.logros.length ? 'Nada con este filtro' : 'Aún no hay logros'}</b>Todo cuenta: un sistema que armaste, un cliente que cerraste, un problema que ya no existe.${S.yo.puede ? '<br><button class="btn pri" data-a="logro">Registrar logro</button>' : ''}</div>`}`];
}

// ---- Mi rol
function vRol() {
  const r = S.rol;
  return ['Mi rol', `<section class="card rol"><h3>${esc(r.titulo)}</h3><p style="margin-top:6px">${esc(r.proposito)}</p></section>
    <section class="card rol"><div class="head"><h2>Las tres unidades</h2></div><dl>${r.unidades.map((u) => `<div><dt>${esc(u.nombre)}</dt><dd>${esc(u.texto)}</dd></div>`).join('')}</dl></section>
    <section class="card rol"><div class="head"><h2>Quién hace qué</h2></div><dl>${r.quien.map((u) => `<div><dt>${esc(u.quien)}</dt><dd>${esc(u.hace)}</dd></div>`).join('')}</dl></section>
    <section class="card rol"><div class="head"><h2>Responsabilidades</h2></div><dl>${r.responsabilidades.map((u) => `<div><dt>${esc(u.t)}</dt><dd>${esc(u.d)}</dd></div>`).join('')}</dl></section>
    <section class="card rol"><div class="head"><h2>Cómo se evalúa el puesto</h2><span class="note">tablero trimestral</span></div>${r.tablero.map((u) => `<div class="peso"><b class="p tnum">${u.p}%</b><div><b>${esc(u.t)}</b><span>${esc(u.d)}</span></div></div>`).join('')}</section>
    <section class="card rol"><div class="head"><h2>El ritmo</h2></div><ul style="display:grid;gap:6px">${r.ritmo.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></section>`];
}

// ---- dialogs
const dlg = $('#dlg');
function abrir(titulo, cuerpo, guardar, { boton = 'Guardar', extra = '' } = {}) {
  dlg.innerHTML = `<form method="dialog" novalidate><header><h2 id="dlg-t">${esc(titulo)}</h2><button type="button" class="ico" data-cerrar aria-label="Cerrar"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></header><div class="cuerpo">${cuerpo}<p class="err" hidden></p></div>${guardar ? `<footer>${extra}<button class="btn pri" value="ok">${boton}</button></footer>` : ''}</form>`;
  const f = $('form', dlg);
  f.onsubmit = async (e) => { e.preventDefault(); if (!guardar) return dlg.close(); const b = $('.btn.pri', f), err = $('.err', f); b.disabled = true; err.hidden = true;
    try { const m = await guardar(Object.fromEntries(new FormData(f)), f); await cargar(); dlg.close(); if (typeof m === 'string') toast(m); } catch (x) { err.textContent = x.message; err.hidden = false; b.disabled = false; } };
  dlg.showModal(); const p = $('input:not([type=hidden]):not([type=radio]):not([type=file]), textarea', f); if (p && matchMedia('(min-width: 900px)').matches) p.focus();
}
dlg.addEventListener('click', (e) => { if (e.target === dlg || e.target.closest('[data-cerrar]')) dlg.close(); });
const campo = (et, html, nota) => `<label class="c"><span>${et}${nota ? ` <small>${nota}</small>` : ''}</span>${html}</label>`;
const opc = (name, ops, val) => `<div class="opc" role="radiogroup">${ops.map(([k, t]) => `<label><input type="radio" name="${name}" value="${k}" ${k === val ? 'checked' : ''}><span>${t}</span></label>`).join('')}</div>`;
const selArea = (v) => `<select name="area">${S.areas.map((a) => `<option value="${a}" ${a === v ? 'selected' : ''}>${AREA[a]}</option>`).join('')}</select>`;

function dRegistro(id) {
  const i = porId(id), man = i.medidas.filter((m) => !m.auto);
  abrir('Registro de la semana', `<p class="note">${esc(i.titulo)}</p>${campo('Fecha', `<input type="date" name="fecha" value="${S.hoy}" max="${S.hoy}" required>`)}
    ${man.map((m) => campo(esc(m.nombre), `<div class="conu"><input type="number" inputmode="decimal" step="any" name="m${m.id}" placeholder="${m.modo === 'ultimo' ? 'Dato actual' : 'Lo de esta semana'}"><em>${esc(m.unidad || '')}</em></div>`, m.lectura.meta != null ? `meta ${fNum(m.meta, m.unidad)}${m.modo === 'ultimo' ? '' : m.periodo === 'semana' ? ' por semana' : ' al mes'}` : '')).join('')}
    ${i.medidas.some((m) => m.auto) ? '<p class="note">Las altas del club se leen solas del sistema del club; no hace falta escribirlas.</p>' : ''}
    ${campo('Qué pasó', '<textarea name="nota" maxlength="1000" placeholder="Qué hiciste, qué funcionó, qué no"></textarea>')}
    ${campo('Siguiente paso', `<input name="siguiente" maxlength="200" value="${esc(i.siguiente)}" placeholder="Una acción concreta">`)}${campo('Para cuándo', `<input type="date" name="siguiente_fecha" value="${i.siguiente_fecha && i.siguiente_fecha >= S.hoy ? i.siguiente_fecha : ''}" min="${S.hoy}">`)}`,
    async (d) => { const valores = {}; for (const m of man) if (d['m' + m.id] !== '') valores[m.id] = d['m' + m.id];
      await api(`/iniciativas/${id}/registros`, 'POST', { fecha: d.fecha, nota: d.nota, valores, siguiente: d.siguiente, siguiente_fecha: d.siguiente_fecha, arrancar: true }); return 'Registro guardado'; }, { boton: 'Guardar registro' });
}
function dSiguiente(id) { const i = porId(id);
  abrir('Siguiente paso', `${campo('Qué sigue', `<input name="siguiente" maxlength="200" value="${esc(i.siguiente)}" placeholder="Una acción concreta" required>`)}${campo('Para cuándo', `<input type="date" name="siguiente_fecha" value="${i.siguiente_fecha}" min="${S.hoy}">`)}`,
    async (d) => { if (!d.siguiente.trim()) throw new Error('Escribe el siguiente paso'); await api(`/iniciativas/${id}`, 'PATCH', d); }); }
function dMedida(id, mid) { const i = porId(id), m = i.medidas.find((x) => x.id === +mid) || { nombre: '', unidad: '', meta: '', periodo: 'mes', modo: 'suma', sentido: 'sube' };
  abrir(mid ? 'Editar número' : 'Nuevo número', `${campo('Qué se mide', `<input name="nombre" maxlength="80" value="${esc(m.nombre)}" placeholder="Ej. Botellas vendidas" required>`)}
    <div class="dos">${campo('Unidad', `<input name="unidad" maxlength="16" value="${esc(m.unidad)}" placeholder="$, %, botellas">`)}${campo('Meta', `<input type="number" inputmode="decimal" step="any" name="meta" value="${m.meta ?? ''}" placeholder="Opcional">`)}</div>
    ${m.auto ? '<p class="note">Este número se lee solo del sistema del club. Puedes cambiar la meta.</p>' : `<div><span class="note" style="font-weight:600">Cómo se lleva</span>${opc('modo', [['suma', 'Se suma cada semana'], ['ultimo', 'Último dato (%, promedio)']], m.modo).replace('repeat(3', 'repeat(2')}</div>`}
    <div><span class="note" style="font-weight:600">La meta es</span>${opc('periodo', [['semana', 'Por semana'], ['mes', 'Al mes']], m.periodo).replace('repeat(3', 'repeat(2')}</div>
    <div><span class="note" style="font-weight:600">Qué es mejor</span>${opc('sentido', [['sube', 'Más es mejor'], ['baja', 'Menos es mejor']], m.sentido).replace('repeat(3', 'repeat(2')}</div>`,
    async (d) => { if (!d.nombre.trim()) throw new Error('Falta el nombre'); const b = { ...d, modo: d.modo || m.modo, auto: m.auto || '' }; await api(mid ? `/medidas/${mid}` : `/iniciativas/${id}/medidas`, mid ? 'PATCH' : 'POST', b); },
    { extra: mid && !m.auto ? `<button type="button" class="btn peligro" data-a="borra-medida" data-id="${mid}">Quitar</button>` : '' }); }
function dNueva() {
  abrir('Iniciativa propia', `${campo('Nombre', '<input name="titulo" maxlength="120" placeholder="Ej. Brunch de domingo" required>')}${campo('Área', selArea('restaurante'))}
    <div><span class="note" style="font-weight:600">Para qué</span>${opc('tipo', [['ingreso', 'Genera ingreso'], ['ahorro', 'Ahorra'], ['base', 'Base']], 'ingreso')}</div>
    ${campo('Por qué vale la pena', '<textarea name="porque" maxlength="600" placeholder="Qué problema resuelve o cuánto puede dejar"></textarea>')}
    ${campo('Número principal', '<input name="mnombre" maxlength="80" placeholder="Ej. Venta del domingo">', 'opcional; se pueden agregar más después')}
    <div class="dos">${campo('Unidad', '<input name="munidad" maxlength="16" placeholder="$">')}${campo('Meta al mes', '<input type="number" inputmode="decimal" step="any" name="mmeta">')}</div>`,
    async (d) => { if (!d.titulo.trim()) throw new Error('Falta el nombre');
      const r = await api('/iniciativas', 'POST', { titulo: d.titulo, area: d.area, tipo: d.tipo, porque: d.porque, medidas: d.mnombre.trim() ? [{ nombre: d.mnombre, unidad: d.munidad, meta: d.mmeta, periodo: 'mes' }] : [] });
      location.hash = '#i/' + r.id; return r.aviso || 'Iniciativa creada'; }, { boton: 'Crear' }); }
let foto;   // undefined = leave as is, null = remove, string = new data URL
function dLogro(id, iniId) { const l = S.logros.find((x) => x.id === +id) || { titulo: '', detalle: '', area: iniId ? porId(iniId).area : 'restaurante', iniciativa_id: iniId ? +iniId : null, fecha: S.hoy, etapa: 'marcha', url: '' };
  foto = undefined; const p = S.yo.puede, coms = l.id ? S.comentarios.filter((c) => c.tipo === 'logro' && c.ref_id === l.id) : [];
  if (!p) return abrir(l.titulo, `<div class="chips">${chipE(l.etapa, ETAPA_L)}<span class="chip">${AREA[l.area]}</span><span class="chip">${fFecha(l.fecha, true)}</span></div>${l.detalle ? `<p style="white-space:pre-wrap">${esc(l.detalle)}</p>` : ''}${l.archivo_id ? `<img src="api/archivos/${l.archivo_id}" alt="" style="width:100%;border-radius:10px">` : ''}${l.url ? `<a class="btn" href="${esc(l.url)}" target="_blank" rel="noopener">Abrir enlace</a>` : ''}`, null);
  abrir(l.id ? 'Logro' : 'Registrar logro', `${l.revisar ? '<p class="note"><span class="chip aviso">Por confirmar</span> Completa el detalle y guarda para confirmarlo.</p>' : ''}
    ${campo('Qué lograste', `<input name="titulo" maxlength="140" value="${esc(l.titulo)}" placeholder="Ej. Primer pedido de etiqueta privada" required>`)}
    <div><span class="note" style="font-weight:600">En qué va</span>${opc('etapa', [['propuesta', 'Propuesta'], ['marcha', 'En marcha'], ['resultado', 'Resultado']], l.etapa)}</div>
    ${campo('Detalle', `<textarea name="detalle" maxlength="1500" placeholder="Qué resolvió, qué cambió, a quién le sirve">${l.revisar ? '' : esc(l.detalle)}</textarea>`, 'opcional')}
    <div class="dos">${campo('Fecha', `<input type="date" name="fecha" value="${l.fecha}" max="${S.hoy}" required>`)}${campo('Área', selArea(l.area))}</div>
    ${campo('Iniciativa', `<select name="iniciativa_id"><option value="">Ninguna</option>${S.iniciativas.filter((i) => i.etapa !== 'cerrada' || i.id === l.iniciativa_id).map((i) => `<option value="${i.id}" ${i.id === l.iniciativa_id ? 'selected' : ''}>${esc(i.titulo)}</option>`).join('')}</select>`, 'opcional')}
    ${campo('Enlace', `<input name="url" inputmode="url" maxlength="500" value="${esc(l.url)}" placeholder="Página, documento o app">`, 'opcional')}
    <div class="prev" id="prev">${l.archivo_id ? `<img src="api/archivos/${l.archivo_id}" alt=""><button type="button" class="btn sm" data-a="quita-foto">Quitar foto</button>` : ''}</div>
    ${campo('Foto', '<input type="file" id="foto" accept="image/*">', 'opcional')}
    ${coms.length ? `<div>${coms.map((c) => `<div class="com"><div class="r"><span>${esc(c.nombre || c.por)} · ${hace(c.creado.slice(0, 10))}</span></div><p>${esc(c.texto)}</p></div>`).join('')}</div>` : ''}`,
    async (d) => { if (!d.titulo.trim()) throw new Error('Escribe qué lograste'); const b = { ...d, iniciativa_id: d.iniciativa_id || null }; if (foto !== undefined) b.foto = foto;
      await api(l.id ? `/logros/${l.id}` : '/logros', l.id ? 'PATCH' : 'POST', b); return l.id ? (l.revisar ? 'Logro confirmado' : 'Logro guardado') : 'Logro registrado'; },
    { boton: l.revisar ? 'Guardar y confirmar' : 'Guardar', extra: l.id ? `<button type="button" class="btn peligro" data-a="borra-logro" data-id="${l.id}">Eliminar</button>` : '' });
  $('#foto', dlg).onchange = async (e) => { const f = e.target.files[0]; if (!f) return; try { foto = await achicar(f); $('#prev', dlg).innerHTML = `<img src="${foto}" alt=""><span class="note">Foto lista</span>`; } catch { toast('No se pudo leer la foto'); } };
}
// Photos are downsized in the phone before upload (longest side 1280 px, JPEG) so they stay small.
async function achicar(file) { const img = await createImageBitmap(file), k = Math.min(1, 1280 / Math.max(img.width, img.height)), c = document.createElement('canvas');
  c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); return c.toDataURL('image/jpeg', .8); }
function dFormula() { abrir('Cómo se calcula', `<div class="formula"><p>Cada iniciativa en Planeación, En marcha o Resultado tiene hasta 100 puntos. Tu calificación es el promedio de todas.</p>
  <div><b class="n">Ritmo · 30</b><p>20 por un registro en los últimos 7 días (10 si fue hace 8 a 14). 10 por tener un siguiente paso con fecha vigente (4 si ya venció).</p></div>
  <div><b class="n">Avance · 30</b><p>Por etapa: Planeación 8, En marcha 16, Resultado 22. Más 8 según la parte de hitos cumplidos.</p></div>
  <div><b class="n">Resultado · 40</b><p>Tus números de los últimos ${S.ventana} días contra su meta, con tope de 100% cada uno. Si la iniciativa no tiene meta numérica, estos 40 puntos siguen a los hitos cumplidos.</p></div>
  <p class="note">Las ideas, pausadas y cerradas no se califican. Puedes tener hasta ${S.tope} iniciativas en Planeación o En marcha a la vez.</p></div>`, null); }

// ---- events
document.addEventListener('click', async (e) => {
  const f = e.target.closest('[data-f]'); if (f) { const [k, v] = f.dataset.f.split(':'); ui[k] = v; if (f.tagName === 'A') return; return pintar(); }
  const a = e.target.closest('[data-a]'); if (!a) { if (!e.target.closest('#fab')) $('#pop').hidden = true; return; }
  const d = a.dataset; $('#pop').hidden = true;
  const acc = {
    formula: dFormula, registro: () => dRegistro(d.id), siguiente: () => dSiguiente(d.id), medida: () => dMedida(d.id, d.m), nueva: dNueva, logro: () => dLogro(d.id, d.ini),
    'elige-registro': () => { const l = S.iniciativas.filter((i) => i.score); if (!l.length) return toast('Primero adopta o crea una iniciativa');
      abrir('¿De cuál iniciativa?', l.map((i) => `<button type="button" class="fila" style="background:none;border:0;border-top:1px solid var(--rule);text-align:left;cursor:pointer;width:100%" data-a="registro" data-id="${i.id}">${anillo(i.score.total, true)}<span class="cx"><b>${esc(i.titulo)}</b><span>${i.registros[0] ? 'Último registro ' + hace(i.registros[0].fecha) : 'Sin registro todavía'}</span></span></button>`).join('').replace('border-top:1px solid var(--rule);', ''), null); },
    adoptar: () => hacer(async () => { const r = await api('/iniciativas', 'POST', { clave: d.clave, etapa: d.idea ? 'idea' : undefined }); toast(r.aviso || (r.etapa === 'idea' ? 'Guardada como idea' : 'Adoptada: ya está en tu tablero')); if (r.etapa !== 'idea') location.hash = '#i/' + r.id; }),
    'confirmar-ini': () => hacer(() => api(`/iniciativas/${d.id}`, 'PATCH', { revisar: 0 }), 'Confirmada'),
    'borra-paso': () => hacer(() => api(`/pasos/${d.id}`, 'DELETE')),
    'borra-reg': () => confirm('¿Borrar este registro?') && hacer(() => api(`/registros/${d.id}`, 'DELETE'), 'Registro borrado'),
    'borra-com': () => hacer(() => api(`/comentarios/${d.id}`, 'DELETE')),
    'borra-ini': () => confirm('¿Eliminar esta iniciativa con sus registros? No se puede deshacer. Si solo quieres dejarla, cámbiala a Pausada o Cerrada.') && hacer(async () => { await api(`/iniciativas/${d.id}`, 'DELETE'); location.hash = '#iniciativas'; }, 'Iniciativa eliminada'),
    'borra-medida': () => confirm('¿Quitar este número?') && hacer(async () => { await api(`/medidas/${d.id}`, 'DELETE'); dlg.close(); }),
    'borra-logro': () => confirm('¿Eliminar este logro?') && hacer(async () => { await api(`/logros/${d.id}`, 'DELETE'); dlg.close(); }, 'Logro eliminado'),
    'quita-foto': () => { foto = null; $('#prev', dlg).innerHTML = '<span class="note">Se quitará la foto al guardar</span>'; },
  }[d.a];
  if (acc) { e.preventDefault(); acc(); }
});
$('#fab').onclick = () => { const p = $('#pop'); p.hidden = !p.hidden;
  p.innerHTML = `<button role="menuitem" data-a="logro"><b>Logro</b><span>Algo que ya hiciste o resolviste</span></button><button role="menuitem" data-a="elige-registro"><b>Registro de la semana</b><span>Números y avance de una iniciativa</span></button><button role="menuitem" data-a="nueva"><b>Iniciativa propia</b><span>Una idea que no está en la biblioteca</span></button>`; };
$('#atras').onclick = () => { if (history.length > 1 && document.referrer !== '' || pintar.ultima) history.back(); else location.hash = '#iniciativas'; };
document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.matches('[data-paso]')) hacer(() => api(`/pasos/${t.dataset.paso}`, 'PATCH', { hecho: t.checked }));
  if (t.id === 'etapa') hacer(() => api(`/iniciativas/${t.dataset.id}`, 'PATCH', { etapa: t.value }), 'Etapa actualizada').then((r) => { if (!r) pintar(); });
});
document.addEventListener('submit', (e) => {
  const f = e.target.closest('[data-form]'); if (!f) return; e.preventDefault();
  const texto = new FormData(f).get('texto').trim(); if (!texto) return;
  if (f.dataset.form === 'paso') hacer(() => api(`/iniciativas/${f.dataset.id}/pasos`, 'POST', { texto }));
  if (f.dataset.form === 'com') hacer(() => api('/comentarios', 'POST', { tipo: f.dataset.tipo, ref_id: +f.dataset.id, texto }));
});
addEventListener('hashchange', () => S && pintar());
cargar().catch((e) => { $('#main').innerHTML = `<div class="card vacio"><b>No se pudo abrir Rumbo</b>${esc(e.message)}</div>`; });
