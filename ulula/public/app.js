// Ulula — bodega por recipientes. SPA sin dependencias.
// Regla: en móvil todo es vertical (sin scroll horizontal). Los formularios eligen recipientes, nunca lotes.

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtN = (n, d = 0) => n == null ? '—' : Number(n).toLocaleString('es-MX', { maximumFractionDigits: d, minimumFractionDigits: 0 });
const fmtL = (n, unit = 'L') => n == null ? '—' : `${fmtN(n, 1)} ${unit}`;
const fmtD = (d) => { if (!d) return '—'; const [y, m, dd] = d.slice(0, 10).split('-'); return `${dd}/${m}/${y}`; };
const today = () => (S.boot?.today) || new Date().toISOString().slice(0, 10);
const ico = (id, cls = '') => `<svg class="${cls}" aria-hidden="true"><use href="#${id}"/></svg>`;

const S = { boot: null, board: null, route: { path: 'tablero', q: {} }, view: localStorage.getItem('ulula.view') || 'cards', group: localStorage.getItem('ulula.group') || 'kind', filter: 'todos', q: '' };

// ---------------------------------------------------------------- catálogos (etiquetas en español)
const TYPES = [
  ['pressing', 'Prensado', 'i-press', 'Prensar uva o mosto: el peso da un volumen de mosto y un nuevo lote por fracción.'],
  ['bleeding', 'Sangrado (saignée)', 'i-drop', 'Sangrar mosto de un depósito en maceración sin prensarlo: los litros van a otro depósito y el origen baja los mismos kg.'],
  ['racking', 'Trasiego', 'i-ops', 'Trasegar el vino de un depósito a otro, sin equipo de filtración (deja las lías).'],
  ['barrel_transfer', 'Trasiego a barricas', 'i-barrel', 'Pasar el vino a barricas o sacarlo de ellas.'],
  ['filtration', 'Filtración', 'i-filter', 'Pasar el vino por un filtro para clarificarlo.'],
  ['decantation', 'Desfangado', 'i-decant', 'Separar el vino limpio de las lías por decantación, sin filtro.'],
  ['addition', 'Adiciones / Correcciones', 'i-lab', 'Registrar una adición o corrección (SO₂, bentonita, nutrientes…) en un depósito.'],
  ['topping', 'Rellenado', 'i-top', 'Rellenar el depósito para reducir el espacio de cabeza y la oxidación.'],
  ['bulk_sale', 'Venta a granel', 'i-sale', 'Salida de vino a granel: reduce las existencias del depósito sin crear un lote nuevo.'],
  ['blend', 'Coupage', 'i-blend', 'Mezclar varios lotes en un lote nuevo.'],
];
const TYPE_LABEL = Object.fromEntries(TYPES.map((t) => [t[0], t[1]]));
const WINE = { tinto: 'Tinto', blanco: 'Blanco', rosado: 'Rosado', espumoso: 'Espumoso', base_blanco: 'Vino base blanco', base_rosado: 'Vino base rosado', naranja: 'Naranja', piquette: 'Piquette' };
const WINE_COLOR = { tinto: '#7a1f2b', blanco: '#e3c24a', rosado: '#ec7fa8', espumoso: '#d6d3b0', base_blanco: '#e3c24a', base_rosado: '#ec7fa8', naranja: '#e8832a', piquette: '#cf8fb3' };
const PHASE = { recepcion: 'Recepción', fermentacion: 'Fermentación', posfermentacion: 'Posfermentación', fml: 'Fermentación maloláctica', crianza: 'Crianza', preembotellado: 'Preembotellado' };
const KIND = { tank: 'Depósito', foudre: 'Foudre / Tino', barrel: 'Barrica', bin: 'Bin', keg: 'Keg', amphora: 'Ánfora', egg: 'Huevo', tirage_cage: 'Jaula de tiraje', press: 'Prensa', carboy: 'Garrafón' };
const MATERIAL = { stainless_steel: 'Acero inoxidable', concrete: 'Hormigón', oak: 'Roble / Madera', fiberglass: 'Fibra de vidrio', clay: 'Barro', chestnut: 'Castaño', acacia: 'Acacia', ceramic: 'Gres / Cerámica', glass: 'Vidrio', terracotta: 'Terracota', plastic: 'Plástico' };
const VTYPE = { fermentation: 'Fermentación', storage: 'Almacenamiento', aging: 'Crianza' };
const FRACTION = { free_run: 'Free run', press_1: 'Prensa 1', press_2: 'Prensa 2', press_3: 'Prensa 3', combined: 'Combinado', pomace: 'Orujo' };
const CATEGORY = { yeast: 'Levadura', bacteria: 'Bacteria', enzyme: 'Enzima', fining: 'Clarificante', acid: 'Ácido', sulfite: 'Sulfito', tannin: 'Tanino', nutrient: 'Nutriente', oak: 'Producto de roble', sugar: 'Azúcar', concentrate: 'Mosto concentrado', juice: 'Zumo de uva', other: 'Otro' };
const TASTING_PHASE = ['Fermentación', 'Posfermentación', 'Crianza', 'Antes del embotellado', 'Embotellado', 'General'];
const opts = (map, sel, blank) => (blank ? `<option value="">${esc(blank)}</option>` : '') + Object.entries(map).map(([k, v]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${esc(v)}</option>`).join('');

// ---------------------------------------------------------------- api
async function api(path, opts = {}) {
  const r = await fetch('/api' + path, { headers: { 'content-type': 'application/json' }, ...opts, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Error ${r.status}`);
  return data;
}
async function reload() { S.boot = await api('/bootstrap'); }
function toast(msg, bad = false) { const t = $('#toast'); t.textContent = msg; t.className = 'toast' + (bad ? ' bad' : ''); t.hidden = false; clearTimeout(t._t); t._t = setTimeout(() => { t.hidden = true; }, bad ? 5000 : 2600); }
const vessel = (id) => S.boot.vessels.find((v) => v.id === Number(id));
const vesselByCode = (code) => S.boot.vessels.find((v) => v.code === code);

// ---------------------------------------------------------------- shell
const NAV = [
  ['BODEGA'],
  ['tablero', 'Tablero de bodega', 'i-board'], ['operaciones', 'Operaciones', 'i-ops'], ['coupage', 'Coupage', 'i-blend'], ['traza', 'Trazabilidad', 'i-trace'],
  ['analisis', 'Análisis', 'i-lab'], ['catas', 'Notas de cata', 'i-glass'], ['actividad', 'Actividad', 'i-chart'],
  ['CONFIGURACIÓN'],
  ['depositos', 'Depósitos', 'i-tank'], ['saldos', 'Saldos de apertura', 'i-box'], ['productos', 'Productos enológicos', 'i-lab'],
];
const TABS = [['tablero', 'Tablero', 'i-board'], ['operaciones', 'Operaciones', 'i-ops'], ['traza', 'Traza', 'i-trace'], ['analisis', 'Labs', 'i-lab'], ['mas', 'Más', 'i-more']];

function renderShell() {
  const cur = S.route.path;
  $('#side').innerHTML = `<div class="brand"><img src="/logo.png" alt=""><div><b>Ulula</b><small>bodega · v${esc(S.boot.version)}</small></div></div>` +
    NAV.map((n) => n.length === 1 ? `<div class="group">${n[0]}</div>` : `<a href="#/${n[0]}" ${cur === n[0] ? 'aria-current="page"' : ''}>${ico(n[2])}${esc(n[1])}</a>`).join('') +
    `<div class="foot">Dos Búhos · ${esc(S.boot.vessels.length)} recipientes · ${esc(S.boot.lots.filter((l) => l.status === 'active').length)} lotes activos</div>`;
  $('#tabbar').innerHTML = TABS.map((t) => `<a href="#/${t[0]}" ${(cur === t[0] || (t[0] === 'mas' && !TABS.some((x) => x[0] === cur))) ? 'aria-current="page"' : ''}>${ico(t[2])}<span>${esc(t[1])}</span></a>`).join('');
  $('#who').textContent = `v${S.boot.version}`;
}
function crumbs(...parts) { $('#crumbs').innerHTML = ['<a href="#/tablero" style="text-decoration:none">Inicio</a>', 'Bodega', ...parts].map((p, i, a) => i === a.length - 1 ? `<b>${p}</b>` : p).join(' <span>›</span> '); }
function head(title, sub, actions = '') { return `<div class="page-head"><div><h1>${title}</h1>${sub ? `<div class="sub">${sub}</div>` : ''}</div><div class="actions">${actions}</div></div>`; }
const empty = (title, text, btn = '') => `<div class="empty"><b>${esc(title)}</b>${esc(text)}${btn ? `<div style="margin-top:12px">${btn}</div>` : ''}</div>`;

function parseRoute() {
  const h = location.hash.replace(/^#\/?/, '') || 'tablero';
  const [path, qs] = h.split('?');
  const q = Object.fromEntries(new URLSearchParams(qs || ''));
  const [p, id] = path.split('/');
  return { path: p || 'tablero', id, q };
}
async function route() {
  S.route = parseRoute();
  renderShell();
  const page = $('#page');
  try {
    switch (S.route.path) {
      case 'tablero': return await viewBoard(page);
      case 'operaciones': return await viewOperations(page);
      case 'coupage': return await viewCoupage(page);
      case 'traza': return await viewTrace(page);
      case 'analisis': return await viewAnalyses(page);
      case 'catas': return await viewTastings(page);
      case 'actividad': return await viewActivity(page);
      case 'depositos': return await viewVessels(page);
      case 'saldos': return await viewOpening(page);
      case 'productos': return await viewProducts(page);
      case 'recipiente': return await viewVessel(page, S.route.id);
      case 'mas': return viewMore(page);
      default: location.hash = '#/tablero';
    }
  } catch (err) { page.innerHTML = `<div class="alert bad">${esc(err.message)}</div>`; }
}

// ---------------------------------------------------------------- tablero
function vesselSvg(v, pct, color) {
  const fill = color || '#999', h = 84;
  let shape, clip;
  if (v.kind === 'barrel' || v.kind === 'foudre') { shape = 'M14 12 Q6 42 14 72 L58 72 Q66 42 58 12 Z'; clip = shape; }
  else if (v.kind === 'amphora') { shape = 'M28 6 h16 v6 q12 6 10 30 q-2 20 -18 24 q-16 -4 -18 -24 q-2 -24 10 -30 z'; clip = shape; }
  else if (v.kind === 'egg') { shape = 'M36 6 q22 4 22 38 q0 30 -22 32 q-22 -2 -22 -32 q0 -34 22 -38 z'; clip = shape; }
  else if (v.kind === 'carboy' || v.kind === 'keg' || v.kind === 'bin') { shape = 'M26 6 h20 v10 l8 6 v46 a4 4 0 0 1 -4 4 h-28 a4 4 0 0 1 -4 -4 v-46 l8 -6 z'; clip = shape; }
  else { shape = 'M16 6 h40 a6 6 0 0 1 6 6 v56 a6 6 0 0 1 -6 6 h-40 a6 6 0 0 1 -6 -6 v-56 a6 6 0 0 1 6 -6 z'; clip = shape; }
  const id = 'c' + v.id;
  const y = 78 - (72 * (pct || 0)) / 100;
  return `<svg viewBox="0 0 72 ${h}"><defs><clipPath id="${id}"><path d="${clip}"/></clipPath></defs><path d="${shape}" fill="var(--paper)" stroke="var(--field-rule)" stroke-width="2"/><rect x="0" y="${y}" width="72" height="${84 - y}" fill="${fill}" clip-path="url(#${id})" opacity=".85"/><text x="36" y="46" text-anchor="middle" font-size="11" font-weight="600" fill="${pct > 55 ? '#fff' : 'var(--ink)'}" style="font-family:var(--f-mono)">${esc(v.code)}</text></svg>`;
}
function cellHtml(v, pict) {
  const occ = !!v.stay_id;
  const badges = v.flags.map((f) => `<span class="badge ${f}">${{ rellenar: 'Rellenar', analisis: 'Análisis', limpiar: 'Limpiar' }[f]}</span>`).join('') + (occ && !v.fermentation_done ? '<span class="badge fa">FA en curso</span>' : '');
  const desc = occ ? `${esc(v.varieties || '')}${v.varieties ? ' · ' : ''}${WINE[v.wine_type] || ''}${v.vintage ? ' · ' + v.vintage : ''}` : (v.last_cleaning ? `Limpio ${fmtD(v.last_cleaning)}` : 'Sin limpiezas registradas');
  if (pict) {
    return `<a class="cell p" href="#/recipiente/${v.id}">${vesselSvg(v, v.pct, occ ? WINE_COLOR[v.wine_type] : null)}<div class="vol">${occ ? fmtL(v.stay_volume, v.stay_unit) : '<span class="muted">Libre</span>'}</div>${occ ? `<div class="lot">${esc(v.lot_code)}</div>` : `<div class="desc">${fmtN(v.capacity_l)} L</div>`}<div class="desc">${desc}</div><div class="badges">${badges}</div></a>`;
  }
  return `<a class="cell ${occ ? '' : 'free'}" href="#/recipiente/${v.id}"><div class="top"><span class="vol">${occ ? fmtL(v.stay_volume, v.stay_unit) : 'Libre'}</span><span class="d">${v.last_op ? fmtD(v.last_op) : ''}</span></div><div class="code">${esc(v.code)}</div><div class="cap">Cap. ${fmtN(v.capacity_l)} L · ${KIND[v.kind] || v.kind}</div>${occ ? `<div class="lot">${esc(v.lot_code)}</div>` : ''}<div class="desc">${desc}</div><div class="badges">${badges}</div></a>`;
}
async function viewBoard(page) {
  crumbs('Tablero de bodega');
  const b = await api('/board'); S.board = b;
  const k = b.kpi;
  page.innerHTML = head('Tablero de bodega', 'La bodega de un vistazo: una celda por recipiente, lo que contiene y lo que necesita.', `<a class="btn" href="#/depositos">${ico('i-tank')} Depósitos</a><button class="btn primary" id="newop">${ico('i-plus')} Nueva operación</button>`) +
    `<div class="kpi-row"><div class="kpi"><div class="l">Recipientes</div><div class="v">${k.vessels}</div><div class="s">${k.occupied} ocupados · ${k.free} libres</div></div><div class="kpi"><div class="l">Volumen en bodega</div><div class="v">${fmtN(k.liters)} L</div><div class="s">Capacidad instalada: ${fmtN(k.capacity)} L</div></div><div class="kpi"><div class="l">Uva en maceración</div><div class="v">${fmtN(k.kg)} kg</div></div><div class="kpi ${k.attention ? 'warn' : ''}"><div class="l">Requieren atención</div><div class="v">${k.attention}</div></div></div>
    <div class="board-tools"><label class="search"><svg><use href="#i-search"/></svg><input id="bq" placeholder="Código, lote o variedad…" value="${esc(S.q)}"></label>
      <div class="seg" role="group" aria-label="Vista"><button data-v="cards" aria-pressed="${S.view === 'cards'}">Tarjetas</button><button data-v="pict" aria-pressed="${S.view === 'pict'}">Bodega</button></div>
      <select class="inline" id="bgroup"><option value="kind" ${S.group === 'kind' ? 'selected' : ''}>Agrupar: tipo de recipiente</option><option value="location" ${S.group === 'location' ? 'selected' : ''}>Agrupar: ubicación</option><option value="none" ${S.group === 'none' ? 'selected' : ''}>Sin agrupar</option></select></div>
    <div class="chips" id="bchips">${[['todos', 'Todos'], ['ocupados', 'Solo ocupados'], ['libres', 'Solo libres'], ['atencion', 'Requieren atención']].map(([v, l]) => `<button data-f="${v}" aria-pressed="${S.filter === v}">${l}</button>`).join('')}</div>
    <div id="cells"></div>`;
  const draw = () => {
    const q = S.q.trim().toLowerCase();
    let vs = b.vessels.filter((v) => v.is_active);
    if (q) vs = vs.filter((v) => [v.code, v.lot_code, v.varieties, v.location_name].some((x) => (x || '').toLowerCase().includes(q)));
    if (S.filter === 'ocupados') vs = vs.filter((v) => v.stay_id);
    if (S.filter === 'libres') vs = vs.filter((v) => !v.stay_id);
    if (S.filter === 'atencion') vs = vs.filter((v) => v.flags.length);
    const groups = {};
    for (const v of vs) { const g = S.group === 'kind' ? (KIND[v.kind] || v.kind) : S.group === 'location' ? (v.location_name || 'Sin ubicación') : ''; (groups[g] ||= []).push(v); }
    const order = Object.keys(groups).sort((a, b2) => (a === 'Sin ubicación') - (b2 === 'Sin ubicación') || a.localeCompare(b2));
    $('#cells').innerHTML = !b.vessels.length ? empty('Aún no hay recipientes registrados', 'Registra tus depósitos, tinas y barricas y el tablero se completa solo.', '<a class="btn primary" href="#/depositos">Ir a Depósitos</a>') : vs.length ? order.map((g) => `${g ? `<div class="group-head">${esc(g)} <small>${groups[g].length} de ${b.vessels.length}</small></div>` : ''}<div class="cells ${S.view === 'pict' ? 'pict' : ''}">${groups[g].map((v) => cellHtml(v, S.view === 'pict')).join('')}</div>`).join('') : empty('Nada que mostrar', 'Ningún recipiente coincide con el filtro.');
  };
  draw();
  $('#bq').addEventListener('input', (e) => { S.q = e.target.value; draw(); });
  $$('.seg button', page).forEach((bt) => bt.addEventListener('click', () => { S.view = bt.dataset.v; localStorage.setItem('ulula.view', S.view); $$('.seg button', page).forEach((x) => x.setAttribute('aria-pressed', x === bt)); draw(); }));
  $('#bgroup').addEventListener('change', (e) => { S.group = e.target.value; localStorage.setItem('ulula.group', S.group); draw(); });
  $$('#bchips button').forEach((bt) => bt.addEventListener('click', () => { S.filter = bt.dataset.f; $$('#bchips button').forEach((x) => x.setAttribute('aria-pressed', x === bt)); draw(); }));
  $('#newop').addEventListener('click', () => openOperation({}));
}

// ---------------------------------------------------------------- recipiente
async function viewVessel(page, id) {
  const d = await api(`/vessels/${id}`); const v = d.vessel, s = d.stay;
  crumbs('<a href="#/tablero" style="text-decoration:none">Tablero</a>', esc(v.code));
  const pct = s ? Math.round((s.volume / v.capacity_l) * 100) : 0;
  page.innerHTML = `<a class="back" href="#/tablero">${ico('i-back')} Tablero</a>
    <div class="vhead"><div class="eyebrow">${KIND[v.kind] || 'Recipiente'}</div><h1>${esc(v.code)}</h1><div class="sub">${VTYPE[v.vessel_type] || ''} · ${MATERIAL[v.material] || ''} · ${fmtN(v.capacity_l)} L${v.location_name ? ' · ' + esc(v.location_name) : ''}${v.always_full ? ' · tapa flotante' : ''}</div></div>
    <div class="stack">
      <div class="card"><div class="between"><span class="small muted" style="letter-spacing:.08em;text-transform:uppercase">Contenido actual</span>${s ? `<span class="pill ok">${pct}% lleno</span>` : '<span class="pill">Vacío</span>'}</div>
        ${s ? `<div class="big" style="margin:8px 0 4px">${fmtN(s.volume, 1)}<small> ${s.unit}</small></div><div><a href="#/traza?lot=${s.lot_id}"><b>${esc(s.lot_code)}</b></a> <span class="muted">${esc(s.varieties || '')} · ${WINE[s.wine_type] || ''}${s.vintage ? ' · ' + s.vintage : ''} · ${PHASE[s.phase] || ''}</span></div><div style="margin-top:8px"><a href="#/traza?lot=${s.lot_id}">Ver trazabilidad completa ›</a></div>` : `<div class="muted" style="margin-top:8px">Libre${d.cleanings[0] ? ` · limpio el ${fmtD(d.cleanings[0].cleaned_at)}` : ' · sin limpiezas registradas'}</div>`}
      </div>
      ${s && !s.fermentation_done ? `<button class="cta" id="fadone"><span><small>Lote en fermentación</small>Marcar fermentación como terminada</span>${ico('i-lab')}</button>` : ''}
      <div class="card"><h3>Acciones rápidas</h3><div class="quick">
        <button class="btn" id="q-op">${ico('i-ops')} Nueva operación</button>
        ${s ? `<button class="btn" id="q-an">${ico('i-lab')} Análisis</button><button class="btn" id="q-cata">${ico('i-glass')} Nota de cata</button>` : `<button class="btn" id="q-clean">Registrar limpieza</button>`}
        <button class="btn" id="q-edit">${ico('i-edit')} Editar recipiente</button></div></div>
      <div class="card"><h3>Últimos movimientos</h3>${d.operations.length ? `<div class="rowlist">${d.operations.map((o) => `<div class="item"><div class="body"><div class="t">${TYPE_LABEL[o.type] || o.type} <span class="pill ${o.status === 'draft' ? 'draft' : 'type'}">${o.status === 'draft' ? 'Borrador' : o.side === 'origin' ? 'Sale' : o.side === 'destination' ? 'Entra' : o.side}</span></div><div class="m">${fmtD(o.op_date)} · ${o.volume != null ? fmtL(o.volume, o.unit || 'L') : o.product_name ? `${esc(o.product_name)} ${fmtN(o.qty, 2)} ${esc(o.unit || '')}` : ''} ${o.operator_name ? '· ' + esc(o.operator_name) : ''}</div></div></div>`).join('')}</div>` : '<div class="muted">No hay operaciones registradas para este recipiente.</div>'}</div>
      <div class="card"><h3>Análisis</h3>${d.analyses.length ? analysesTable(d.analyses) : '<div class="muted">No hay análisis registrados para este lote.</div>'}</div>
      <div class="card"><h3>Notas de cata</h3>${d.tastings.length ? tastingsList(d.tastings) : '<div class="muted">Sin catas registradas.</div>'}</div>
    </div>`;
  $('#q-op').onclick = () => openOperation({ prefillVessel: v });
  if ($('#q-an')) $('#q-an').onclick = () => openAnalysis({ vessel_id: v.id });
  if ($('#q-cata')) $('#q-cata').onclick = () => openTasting({ vessel_id: v.id });
  if ($('#q-clean')) $('#q-clean').onclick = () => openCleaning(v);
  $('#q-edit').onclick = () => openVesselForm(v);
  if ($('#fadone')) $('#fadone').onclick = async () => { try { await api(`/lots/${s.lot_id}`, { method: 'PUT', body: { fermentation_done: 1, phase: 'posfermentacion' } }); toast('Fermentación marcada como terminada'); await reload(); route(); } catch (e) { toast(e.message, true); } };
}

// ---------------------------------------------------------------- operaciones
async function viewOperations(page) {
  crumbs('Operaciones de bodega');
  const q = S.route.q;
  const r = await api(`/operations?${new URLSearchParams(Object.fromEntries(Object.entries(q).filter(([, v]) => v)))}`);
  const ops = r.operations;
  const lotOpts = S.boot.lots.filter((l) => l.status === 'active').map((l) => `<option value="${l.id}" ${String(l.id) === q.lot ? 'selected' : ''}>${esc(l.code)}</option>`).join('');
  const vOpts = S.boot.vessels.map((v) => `<option value="${v.id}" ${String(v.id) === q.vessel ? 'selected' : ''}>${esc(v.code)}</option>`).join('');
  const years = [...new Set(ops.map((o) => o.op_date.slice(0, 4)).concat([String(new Date().getFullYear())]))].sort().reverse();
  page.innerHTML = head('Operaciones de bodega', `${ops.length} ${ops.length === 1 ? 'operación' : 'operaciones'}${S.boot.drafts ? ` · ${S.boot.drafts} borrador${S.boot.drafts > 1 ? 'es' : ''}` : ''}`, `<a class="btn" href="#/actividad">${ico('i-chart')} Actividad</a><button class="btn primary" id="newop">${ico('i-plus')} Nueva operación</button>`) +
    `<div class="filters"><select class="inline" data-f="lot"><option value="">Todos los lotes</option>${lotOpts}</select><select class="inline" data-f="vessel"><option value="">Todos los recipientes</option>${vOpts}</select><select class="inline" data-f="color">${opts(WINE, q.color, 'Todos los colores')}</select><select class="inline" data-f="type">${opts(TYPE_LABEL, q.type, 'Todos los tipos')}</select><select class="inline" data-f="year"><option value="">Todos los años</option>${years.map((y) => `<option ${y === q.year ? 'selected' : ''}>${y}</option>`).join('')}</select><select class="inline" data-f="status"><option value="">Todos los estados</option><option value="confirmed" ${q.status === 'confirmed' ? 'selected' : ''}>Confirmadas</option><option value="draft" ${q.status === 'draft' ? 'selected' : ''}>Borradores</option><option value="reverted" ${q.status === 'reverted' ? 'selected' : ''}>Revertidas</option></select></div>` +
    (ops.length ? `<div class="table-wrap"><table class="t cards"><thead><tr><th>Fecha</th><th>Tipo</th><th>Lote</th><th class="num">Cantidad</th><th>Origen</th><th>Destino</th><th>Operario</th><th></th></tr></thead><tbody>${ops.map(opRow).join('')}</tbody></table></div>`
      : empty('Aún no hay operaciones', 'Trasiegos, coupages, prensados y adiciones se registran aquí para la trazabilidad.', `<button class="btn primary" id="newop2">Nueva operación</button>`));
  $$('.filters select', page).forEach((s) => s.addEventListener('change', () => { const nq = { ...q, [s.dataset.f]: s.value }; location.hash = '#/operaciones?' + new URLSearchParams(Object.fromEntries(Object.entries(nq).filter(([, v]) => v))); }));
  const nw = () => openOperation({});
  $('#newop').onclick = nw; if ($('#newop2')) $('#newop2').onclick = nw;
  $$('[data-act]', page).forEach((b) => b.addEventListener('click', async () => {
    const id = +b.dataset.id, op = ops.find((o) => o.id === id);
    if (b.dataset.act === 'edit') return openOperation({ edit: op });
    if (b.dataset.act === 'revert') { if (!confirm(`¿Revertir la operación #${id}? Las estancias vuelven a su estado anterior.`)) return; try { await api(`/operations/${id}/revert`, { method: 'POST' }); toast('Operación revertida'); await reload(); route(); } catch (e) { toast(e.message, true); } }
    if (b.dataset.act === 'delete') { if (!confirm('¿Eliminar este borrador?')) return; try { await api(`/operations/${id}`, { method: 'DELETE' }); await reload(); route(); } catch (e) { toast(e.message, true); } }
  }));
}
function opRow(o) {
  const origins = o.lines.filter((l) => l.side === 'origin'), dests = o.lines.filter((l) => l.side === 'destination'), prods = o.lines.filter((l) => l.side === 'product');
  const lots = [...new Set(o.lines.map((l) => l.lot_code).filter(Boolean))];
  const qty = o.type === 'addition' ? prods.map((p) => `${esc(p.product_name || '')} ${fmtN(p.qty, 2)} ${esc(p.unit || '')}`).join(', ') : fmtL(dests.reduce((a, l) => a + (l.volume || 0), 0) || origins.reduce((a, l) => a + (l.volume || 0), 0) || o.volume_l, origins[0]?.unit || 'L');
  const st = o.status === 'draft' ? '<span class="pill draft">Borrador</span>' : o.status === 'reverted' ? '<span class="pill reverted">Revertida</span>' : '';
  return `<tr><td data-l="Fecha"><span class="num">${fmtD(o.op_date)}</span> ${st}</td><td data-l="Tipo"><span class="pill type">${TYPE_LABEL[o.type] || o.type}</span></td><td data-l="Lote" class="num">${lots.map(esc).join(', ') || '—'}</td><td data-l="Cantidad" class="num">${qty}</td><td data-l="Origen">${origins.map((l) => esc(l.vessel_code)).join(', ') || '—'}</td><td data-l="Destino">${dests.map((l) => esc(l.vessel_code)).join(', ') || (o.lines.find((l) => l.side === 'lees') ? 'lías → ' + esc(o.lines.find((l) => l.side === 'lees').vessel_code) : '—')}</td><td data-l="Operario">${esc(o.operator_name || '—')}</td><td style="white-space:nowrap">${o.status === 'draft' ? `<button class="icon-btn" title="Editar borrador" data-act="edit" data-id="${o.id}">${ico('i-edit')}</button> <button class="icon-btn" title="Eliminar borrador" data-act="delete" data-id="${o.id}">${ico('i-trash')}</button>` : o.status === 'confirmed' ? `<button class="icon-btn" title="Editar fecha, operario o notas" data-act="edit" data-id="${o.id}">${ico('i-edit')}</button> <button class="icon-btn" title="Revertir" data-act="revert" data-id="${o.id}">${ico('i-undo')}</button>` : ''}</td></tr>`;
}

// ---------------------------------------------------------------- coupage (página) → abre el formulario en modo blend
async function viewCoupage(page) {
  crumbs('Coupage');
  page.innerHTML = head('Coupage', 'Mezclar lotes para crear un lote nuevo.', `<button class="btn primary" id="newblend">${ico('i-blend')} Nuevo coupage</button>`) +
    `<div class="card"><p class="muted">Elige los recipientes de origen (su lote se rellena solo), define el lote resultante y uno o varios depósitos de destino vacíos. El coupage cierra las estancias de origen y abre la del lote nuevo; en Trazabilidad el lote nuevo apunta a sus orígenes.</p></div>`;
  $('#newblend').onclick = () => openOperation({ type: 'blend' });
}

// ---------------------------------------------------------------- formulario de operación
const FORM = { type: 'racking', op_date: '', operator_id: '', notes: '', mode: 'fill', origins: [], destinations: [], products: [], loss_l: '', lees_l: '', lees_vessel_id: '', lees_lot_code: '', volume_l: '', buyer: '', press_vessel_id: '', new_lot: { create: false, code: '', wine_type: '', vintage: '', varieties: '', phase: '' } };
let F = null, FID = null, FSTATUS = null;

function openOperation({ type, edit, prefillVessel }) {
  F = JSON.parse(JSON.stringify(FORM));
  F.op_date = today();
  const me = S.boot.users.find((u) => u.role === 'admin'); F.operator_id = localStorage.getItem('ulula.operator') || (me ? me.id : '');
  FID = null; FSTATUS = null;
  if (edit) {
    FID = edit.id; FSTATUS = edit.status;
    const p = edit.payload || {};
    Object.assign(F, { type: edit.type, op_date: edit.op_date, operator_id: edit.operator_id || '', notes: edit.notes || '', mode: edit.mode || 'fill', loss_l: p.loss_l || '', lees_l: p.lees_l || '', lees_vessel_id: p.lees_vessel_id || '', lees_lot_code: p.lees_lot_code || '', volume_l: p.volume_l ?? '', buyer: p.buyer || '', press_vessel_id: p.press_vessel_id || '' });
    F.origins = (p.origins || []).map((o) => ({ vessel_id: o.vessel_id, volume: o.volume ?? '' }));
    F.destinations = (p.destinations || []).map((d) => ({ vessel_id: d.vessel_id, volume: d.volume ?? '', new_lot_code: d.new_lot_code || '', fraction: d.fraction || 'free_run' }));
    F.products = (p.products || []).map((x) => ({ product_id: x.product_id || '', product_name: x.product_name || '', qty: x.qty ?? '', unit: x.unit || '', note: x.note || '' }));
    if (p.new_lot) F.new_lot = { ...F.new_lot, ...p.new_lot };
  } else if (type) F.type = type;
  if (prefillVessel && !edit) { if (prefillVessel.stay_id) F.origins = [{ vessel_id: prefillVessel.id, volume: '' }]; else F.destinations = [{ vessel_id: prefillVessel.id, volume: '', new_lot_code: '', fraction: 'free_run' }]; }
  renderOpModal();
}
function closeModal() { $('#modal').classList.remove('open'); $('#modal .modal').innerHTML = ''; }
function modal(title, body, foot, eyebrow = 'Bodega') {
  const m = $('#modal'); m.classList.add('open');
  $('.modal', m).innerHTML = `<div class="modal-head"><div><div class="eyebrow">${esc(eyebrow)}</div><h2>${esc(title)}</h2></div><button class="x" aria-label="Cerrar">×</button></div><div class="modal-body">${body}</div><div class="modal-foot">${foot}</div>`;
  $('.modal-head .x', m).onclick = closeModal; $('.scrim', m).onclick = closeModal;
  return $('.modal', m);
}

const withWine = (v) => !!v.stay_id, isEmpty = (v) => !v.stay_id, isMaceration = (v) => v.stay_id && v.stay_unit === 'kg', isPress = (v) => v.kind === 'press';
const inWine = (v) => v.stay_id && v.stay_unit !== 'kg';
function vesselLabel(v, side = 'origin') {
  if (!v) return '';
  if (v.stay_id) return `${v.code} · ${v.lot_code} · ${fmtL(v.stay_volume, v.stay_unit)}`;
  return `${v.code} · vacío`;
}
// Desplegable de recipientes: búsqueda + chips + lista agrupada. filter(v) decide qué recipientes se ofrecen.
function vesselPicker({ id, value, filter, placeholder = 'Depósito…', multi = false, selected = [], onPick }) {
  const v = value ? vessel(value) : null;
  const html = `<div class="vp" data-vp="${id}"><button type="button" class="${v || (multi && selected.length) ? '' : 'empty'}">${multi ? (selected.length ? `${selected.length} seleccionadas` : esc(placeholder)) : v ? esc(vesselLabel(v)) : esc(placeholder)}<span>▾</span></button></div>`;
  setTimeout(() => {
    const root = $(`.vp[data-vp="${id}"]`); if (!root) return;
    const btn = $('button', root);
    btn.onclick = () => {
      if ($('.drop', root)) { $('.drop', root).remove(); return; }
      $$('.vp .drop').forEach((d) => d.remove());
      const drop = document.createElement('div'); drop.className = 'drop';
      let chip = 'todos', text = '';
      const sel = new Set(selected.map(Number));
      const list = () => {
        const q = text.toLowerCase();
        let vs = S.boot.vessels.filter((x) => x.is_active && filter(x));
        if (chip === 'inox') vs = vs.filter((x) => ['tank', 'press'].includes(x.kind));
        if (chip === 'barricas') vs = vs.filter((x) => ['barrel', 'foudre'].includes(x.kind));
        if (chip === 'otros') vs = vs.filter((x) => !['tank', 'press', 'barrel', 'foudre'].includes(x.kind));
        if (q) vs = vs.filter((x) => [x.code, x.lot_code, x.varieties].some((y) => (y || '').toLowerCase().includes(q)));
        const groups = [['Inox / depósitos', vs.filter((x) => ['tank', 'press'].includes(x.kind))], ['Barricas', vs.filter((x) => ['barrel', 'foudre'].includes(x.kind))], ['Otros', vs.filter((x) => !['tank', 'press', 'barrel', 'foudre'].includes(x.kind))]].filter((g) => g[1].length);
        $('.list', drop).innerHTML = groups.length ? groups.map(([g, xs]) => `<div class="gh">${g}</div>` + xs.map((x) => `<button type="button" class="opt ${sel.has(x.id) ? 'on' : ''}" data-id="${x.id}">${multi ? `<input type="checkbox" ${sel.has(x.id) ? 'checked' : ''} tabindex="-1">` : ''}<span><b>${esc(x.code)}</b><br><small>${x.stay_id ? `${esc(x.lot_code)} · ${fmtL(x.stay_volume, x.stay_unit)}` : 'vacío'}${x.capacity_l ? ` · ${fmtN(Math.max(0, x.capacity_l - (x.stay_volume || 0)))} L libres` : ''}</small></span><small>${KIND[x.kind] || ''}</small></button>`).join('')).join('') : '<div class="none">Sin resultados</div>';
        $$('.opt', drop).forEach((o) => o.onclick = () => {
          const vid = +o.dataset.id;
          if (!multi) { drop.remove(); onPick(vid); return; }
          if (sel.has(vid)) sel.delete(vid); else sel.add(vid);
          $('.foot b', drop).textContent = sel.size; list();
        });
      };
      drop.innerHTML = `<input placeholder="Buscar por código o lote…"><div class="chips">${[['todos', 'Todos'], ['inox', 'Inox / Depósitos'], ['barricas', 'Barricas'], ['otros', 'Otros']].map(([k, l]) => `<button type="button" data-c="${k}" aria-pressed="${k === chip}">${l}</button>`).join('')}</div><div class="list"></div>${multi ? `<div class="foot"><span><b>${sel.size}</b> seleccionadas</span><span><button type="button" class="btn sm" data-x="cancel">Cancelar</button> <button type="button" class="btn sm primary" data-x="ok">Añadir selección</button></span></div>` : ''}`;
      root.appendChild(drop);
      $('input', drop).oninput = (e) => { text = e.target.value; list(); };
      $$('.chips button', drop).forEach((c) => c.onclick = () => { chip = c.dataset.c; $$('.chips button', drop).forEach((x) => x.setAttribute('aria-pressed', x === c)); list(); });
      if (multi) { $('[data-x="cancel"]', drop).onclick = () => drop.remove(); $('[data-x="ok"]', drop).onclick = () => { drop.remove(); onPick([...sel]); }; }
      list(); $('input', drop).focus();
    };
  }, 0);
  return html;
}
document.addEventListener('click', (e) => { if (!e.target.closest('.vp')) $$('.vp .drop').forEach((d) => d.remove()); });

function vcard(v, delta, side) {
  if (!v) return '';
  const cur = v.stay_volume || 0, cap = v.capacity_l || 0, unit = v.stay_unit || 'L';
  const after = Math.round((cur + delta) * 10) / 10;
  const pct = cap ? Math.min(100, Math.round((cur / cap) * 100)) : 0;
  const over = cap && after > cap * 1.02 + 0.5, under = after < -0.01;
  return `<div class="vcard"><div class="top"><b>${esc(v.code)}</b><span class="pill ${v.stay_id ? 'ok' : ''}">${v.stay_id ? (unit === 'kg' ? 'Contiene uva' : 'Contiene vino') : 'Vacío'}</span></div><div class="bar"><i style="width:${pct}%"></i></div>
    <div class="kv"><span>${fmtL(cur, unit)}</span><span>Capacidad: <b>${fmtN(cap)} L</b></span></div>
    ${v.stay_id ? `<div class="kv"><span>Lote</span><b>${esc(v.lot_code)}</b></div>` : ''}<div class="kv"><span>Libre</span><b>${fmtN(Math.max(0, cap - cur))} L</b></div>
    <div class="kv"><span>Tras la operación</span><span class="after ${over || under ? 'bad' : ''}">${fmtL(after, unit)}${cap ? ` (${fmtN(Math.max(0, cap - after))} L libres)` : ''}${over ? ' · no cabe' : ''}${under ? ' · no alcanza' : ''}</span></div></div>`;
}

function renderOpModal() {
  const t = F.type, confirmed = FSTATUS === 'confirmed';
  const typeInfo = TYPES.find((x) => x[0] === t);
  const users = S.boot.users.map((u) => `<option value="${u.id}" ${String(u.id) === String(F.operator_id) ? 'selected' : ''}>${esc(u.name)}</option>`).join('');
  const typeGrid = `<div class="field"><span>Tipo de operación *</span><div class="type-grid">${TYPES.map((x) => `<label><input type="radio" name="optype" value="${x[0]}" ${x[0] === t ? 'checked' : ''} ${confirmed ? 'disabled' : ''}>${ico(x[2])}${esc(x[1])}</label>`).join('')}</div><div class="help">${esc(typeInfo[3])}</div></div>`;
  const common = `<div class="row"><label class="field req" style="flex:1"><span>Fecha</span><input type="date" name="op_date" value="${esc(F.op_date)}"></label><label class="field req" style="flex:1"><span>Operario</span><select name="operator_id"><option value="">— Sin operario —</option>${users}</select></label></div>`;
  const notes = `<label class="field" style="margin-top:12px"><span>Notas</span><textarea name="notes" rows="2" placeholder="Notas adicionales…">${esc(F.notes)}</textarea></label>`;
  let body;
  if (confirmed) body = `<div class="alert info">Operación confirmada: solo cambian fecha, operario y notas. Para cambiar volúmenes, reviértela y vuelve a crearla.</div>${common}${notes}`;
  else body = typeGrid + common + typeBody(t) + notes;
  const foot = confirmed ? `<button class="btn" data-x="cancel">Cancelar</button><button class="btn primary" data-x="save">Guardar cambios</button>`
    : `<button class="btn" data-x="cancel">Cancelar</button><button class="btn amber" data-x="draft">Guardar borrador</button><button class="btn primary" data-x="confirm">${FID ? 'Confirmar operación' : 'Crear operación'}</button>`;
  const m = modal(FID ? (confirmed ? `Operación #${FID}` : `Borrador #${FID}`) : 'Nueva operación', body, foot);
  bindOpModal(m);
}
const hasOrigin = (i = 0) => F.origins[i] && vessel(F.origins[i].vessel_id);
function typeBody(t) {
  const O = F.origins[0] || {}, D = F.destinations[0] || {};
  const od = (left, right) => `<div class="od"><div class="pane"><h4>Origen</h4>${left}</div><div class="arrow">→</div><div class="pane"><h4>Destino</h4>${right}</div></div>`;
  const originPicker = (filter, ph) => vesselPicker({ id: 'o0', value: O.vessel_id, filter, placeholder: ph, onPick: (id) => { F.origins = [{ vessel_id: id, volume: O.volume || '' }]; renderOpModal(); } }) + vcard(hasOrigin(), -originOut(), 'origin');
  const destRows = (filter, { single = false, label = 'Depósito…' } = {}) => {
    if (!F.destinations.length) F.destinations = [{ vessel_id: '', volume: '', new_lot_code: '', fraction: 'free_run' }];
    return F.destinations.map((d, i) => `<div class="dest-row">${F.destinations.length > 1 ? `<div class="dest-n">Destino ${i + 1}</div>` : ''}${vesselPicker({ id: 'd' + i, value: d.vessel_id, filter, placeholder: label, onPick: (id) => { F.destinations[i].vessel_id = id; renderOpModal(); } })}<input type="number" step="0.1" min="0" placeholder="p. ej. 1000" value="${esc(d.volume)}" data-dvol="${i}" ${single ? 'style="display:none"' : ''}>${!single && F.destinations.length > 1 ? `<button type="button" class="icon-btn" data-ddel="${i}">${ico('i-x')}</button>` : '<span></span>'}</div>${vcard(d.vessel_id ? vessel(d.vessel_id) : null, +d.volume || destShare(i), 'dest')}`).join('') + (single ? '' : `<button type="button" class="btn sm" data-dadd>+ Añadir destino</button>`);
  };
  if (['racking', 'filtration', 'decantation'].includes(t)) {
    return od(originPicker(inWine, 'Seleccione el depósito de origen…'), destRows((v) => !O.vessel_id || v.id !== +O.vessel_id)) +
      `<div class="sub-box blue"><label class="toggle"><input type="checkbox" name="newlot" ${F.new_lot.create ? 'checked' : ''}> Crear nuevo lote en el destino</label>${F.new_lot.create ? `<input name="newlotcode" placeholder="Código del lote nuevo (vacío = automático)" value="${esc(F.new_lot.code)}" style="margin-top:6px">` : ''}</div>
      <div class="sub-box"><h5>Merma y lías (opcional)</h5><div class="row"><label class="field"><span>Merma (L)</span><input type="number" step="0.1" min="0" name="loss_l" value="${esc(F.loss_l)}" placeholder="0"></label><label class="field"><span>Lías (L)</span><input type="number" step="0.1" min="0" name="lees_l" value="${esc(F.lees_l)}" placeholder="0"></label></div>
      ${+F.lees_l > 0 ? `<div class="row" style="margin-top:8px"><div class="field req" style="flex:1"><span>Depósito de lías</span>${vesselPicker({ id: 'lees', value: F.lees_vessel_id, filter: (v) => v.id !== +O.vessel_id, onPick: (id) => { F.lees_vessel_id = id; renderOpModal(); } })}</div><label class="field" style="flex:1"><span>Código del lote de lías</span><input name="lees_lot_code" value="${esc(F.lees_lot_code)}" placeholder="vacío = automático"></label></div>` : ''}
      <div class="help">Sale del origen: <b id="outtotal">${fmtN(originOut(), 1)} L</b> (destinos + merma + lías)</div></div>
      <label class="field" style="margin-top:12px"><span>Volumen a trasegar (L)</span><input type="number" step="0.1" name="volume_l" value="${esc(F.volume_l)}" placeholder="p. ej. 1000"><div class="help">Déjalo vacío para trasegar todo el volumen de origen (o deja un destino en blanco).</div></label>`;
  }
  if (t === 'barrel_transfer') {
    const fill = F.mode !== 'empty';
    const modeBtns = `<div class="mode"><button type="button" data-mode="fill" aria-pressed="${fill}">Llenar barricas</button><button type="button" data-mode="empty" aria-pressed="${!fill}">Vaciar barricas</button></div>`;
    const barrelFilter = (empty) => (v) => ['barrel', 'foudre'].includes(v.kind) && (empty ? !v.stay_id : !!v.stay_id);
    if (fill) {
      const picked = F.destinations.map((d) => d.vessel_id).filter(Boolean);
      const right = `${vesselPicker({ id: 'bm', multi: true, selected: picked, filter: barrelFilter(true), placeholder: 'Seleccionar barricas vacías', onPick: (ids) => { F.destinations = ids.map((id) => ({ vessel_id: id, volume: '', new_lot_code: '', fraction: '' })); renderOpModal(); } })}
        ${picked.length ? `<div class="rowlist" style="margin-top:8px">${F.destinations.map((d, i) => { const v = vessel(d.vessel_id); return `<div class="dest-row"><span><b>${esc(v.code)}</b> <small class="muted">${fmtN(v.capacity_l)} L</small></span><input type="number" step="0.1" data-dvol="${i}" value="${esc(d.volume)}" placeholder="${fmtN(v.capacity_l - (v.stay_volume || 0))}"><button type="button" class="icon-btn" data-ddel="${i}">${ico('i-x')}</button></div>`; }).join('')}</div>` : '<div class="help">Ninguna barrica seleccionada.</div>'}`;
      return modeBtns + od(originPicker(inWine, 'Seleccione el depósito de origen…'), right) + `<div class="help" style="margin-top:8px">Total a las barricas: <b>${fmtN(barrelTotal(), 1)} L</b> (cada barrica en blanco se llena a su capacidad).</div><div class="sub-box"><h5>Merma (opcional)</h5><label class="field"><span>Merma (L)</span><input type="number" step="0.1" min="0" name="loss_l" value="${esc(F.loss_l)}" placeholder="0"></label></div>`;
    }
    const picked = F.origins.map((o) => o.vessel_id).filter(Boolean);
    const left = `${vesselPicker({ id: 'bm', multi: true, selected: picked, filter: barrelFilter(false), placeholder: 'Seleccionar barricas llenas', onPick: (ids) => { F.origins = ids.map((id) => ({ vessel_id: id, volume: '' })); renderOpModal(); } })}
      ${picked.length ? `<div class="rowlist" style="margin-top:8px">${F.origins.map((o, i) => { const v = vessel(o.vessel_id); return `<div class="dest-row"><span><b>${esc(v.code)}</b> <small class="muted">${esc(v.lot_code)} · ${fmtL(v.stay_volume)}</small></span><input type="number" step="0.1" data-ovol="${i}" value="${esc(o.volume)}" placeholder="${fmtN(v.stay_volume, 1)}"><button type="button" class="icon-btn" data-odel="${i}">${ico('i-x')}</button></div>`; }).join('')}</div>` : '<div class="help">Ninguna barrica seleccionada.</div>'}`;
    return modeBtns + od(left, destRows((v) => !v.stay_id || v.lot_code === (hasOrigin() ? hasOrigin().lot_code : ''), { single: true })) + `<div class="help" style="margin-top:8px">Total de las barricas: <b>${fmtN(barrelTotal(), 1)} L</b>.</div>`;
  }
  if (t === 'bleeding') {
    return od(originPicker(isMaceration, 'Depósito de maceración…') + '<div class="help">Los hollejos siguen macerando, pero el depósito baja 1 kg por cada litro sangrado.</div>', destRows((v) => !v.stay_id || v.lot_code === (hasOrigin()?.lot_code), { single: true })) +
      `<label class="field req" style="margin-top:12px"><span>Mosto a sangrar (L)</span><input type="number" step="0.1" name="volume_l" value="${esc(F.volume_l)}" placeholder="p. ej. 300"></label>`;
  }
  if (t === 'pressing') {
    const presses = S.boot.vessels.filter(isPress);
    return `<div class="field req" style="margin-top:12px"><span>Depósito de maceración</span>${vesselPicker({ id: 'o0', value: O.vessel_id, filter: isMaceration, placeholder: 'Depósito de maceración…', onPick: (id) => { F.origins = [{ vessel_id: id, volume: '' }]; renderOpModal(); } })}${hasOrigin() ? vcard(hasOrigin(), -(hasOrigin().stay_volume || 0)) : '<div class="err" style="margin-top:6px">Un prensado necesita un depósito con uva en maceración (lote en kg).</div>'}</div>
      <label class="field" style="margin-top:12px"><span>Prensa utilizada</span><select name="press_vessel_id"><option value="">—</option>${presses.map((p) => `<option value="${p.id}" ${String(p.id) === String(F.press_vessel_id) ? 'selected' : ''}>${esc(p.code)}</option>`).join('')}</select></label>
      <div class="field" style="margin-top:12px"><span>Fracciones de prensado</span>${F.destinations.length ? F.destinations.map((d, i) => `<div class="frac-row"><label class="field"><span>Fracción</span><select data-dfrac="${i}">${opts(FRACTION, d.fraction || 'free_run')}</select></label><label class="field req"><span>Volumen (L)</span><input type="number" step="0.1" data-dvol="${i}" value="${esc(d.volume)}" placeholder="500"></label><div class="field req w2"><span>Depósito de destino</span>${vesselPicker({ id: 'd' + i, value: d.vessel_id, filter: isEmpty, onPick: (id) => { F.destinations[i].vessel_id = id; renderOpModal(); } })}</div><label class="field w2"><span>Lote</span><input data-dcode="${i}" value="${esc(d.new_lot_code)}" placeholder="Automático (dejar vacío) o escribir manualmente"></label><div class="w2" style="text-align:right"><button type="button" class="btn sm" data-ddel="${i}">Quitar</button></div></div>`).join('') : '<div class="help">Ninguna fracción — haz clic en «+ Añadir fracción».</div>'}<button type="button" class="btn sm" data-dadd>+ Añadir fracción</button></div>`;
  }
  if (t === 'addition') {
    const prods = S.boot.products;
    return `<div class="field req" style="margin-top:12px"><span>Depósito de vino</span>${vesselPicker({ id: 'o0', value: O.vessel_id, filter: withWine, placeholder: 'Depósito con vino…', onPick: (id) => { F.origins = [{ vessel_id: id, volume: '' }]; renderOpModal(); } })}${vcard(hasOrigin(), 0)}</div>
      <div class="field" style="margin-top:12px"><span>Productos utilizados</span>${F.products.length ? F.products.map((x, i) => `<div class="prod-row"><select data-pid="${i}" class="pn"><option value="">Seleccionar…</option>${prods.map((p) => `<option value="${p.id}" ${String(p.id) === String(x.product_id) ? 'selected' : ''}>${esc(p.name)} (${esc(p.unit)})</option>`).join('')}<option value="_free" ${!x.product_id && x.product_name ? 'selected' : ''}>Otro (escribir)…</option></select>${!x.product_id && x.product_name !== undefined && (x.product_name || x._free) ? `<input data-pname="${i}" class="pn" placeholder="Nombre del producto" value="${esc(x.product_name)}">` : ''}<input type="number" step="0.01" data-pqty="${i}" value="${esc(x.qty)}" placeholder="Cant."><input data-pnote="${i}" value="${esc(x.note)}" placeholder="Observaciones…"><button type="button" class="icon-btn" data-pdel="${i}">${ico('i-x')}</button></div>`).join('') : '<div class="help">No se ha añadido ningún producto.</div>'}<button type="button" class="btn sm" data-padd>+ Añadir producto</button>${prods.length ? '' : ' <span class="help">No hay productos en el catálogo: puedes escribirlos o crearlos en Configuración › Productos.</span>'}</div>`;
  }
  if (t === 'topping') {
    return `<div class="field req" style="margin-top:12px"><span>Depósito a rellenar</span>${vesselPicker({ id: 'd0', value: D.vessel_id, filter: inWine, placeholder: 'Depósito con vino…', onPick: (id) => { F.destinations = [{ vessel_id: id, volume: '', new_lot_code: '', fraction: '' }]; renderOpModal(); } })}${vcard(D.vessel_id ? vessel(D.vessel_id) : null, +F.volume_l || 0)}</div>
      <label class="field req" style="margin-top:12px"><span>Volumen (L)</span><input type="number" step="0.1" name="volume_l" value="${esc(F.volume_l)}" placeholder="p. ej. 5"></label>
      <div class="field" style="margin-top:12px"><span>Origen del vino de rellenado (opcional)</span>${vesselPicker({ id: 'o0', value: O.vessel_id, filter: (v) => inWine(v) && v.id !== +D.vessel_id, placeholder: 'Botellas, garrafón u otro depósito…', onPick: (id) => { F.origins = [{ vessel_id: id, volume: '' }]; renderOpModal(); } })}${O.vessel_id ? `${vcard(hasOrigin(), -(+F.volume_l || 0))}<button type="button" class="linkish" data-oclear>Quitar origen</button>` : '<div class="help">Si rellenas de botellas, déjalo vacío.</div>'}</div>`;
  }
  if (t === 'bulk_sale') {
    return `<div class="field req" style="margin-top:12px"><span>Depósito de vino</span>${vesselPicker({ id: 'o0', value: O.vessel_id, filter: inWine, placeholder: 'Depósito con vino…', onPick: (id) => { F.origins = [{ vessel_id: id, volume: '' }]; renderOpModal(); } })}${vcard(hasOrigin(), -(+F.volume_l || 0))}<div class="help">El vino sale de la bodega; las existencias del lote se reducen en el volumen vendido.</div></div>
      <div class="row" style="margin-top:12px"><label class="field req"><span>Volumen (L)</span><input type="number" step="0.1" name="volume_l" value="${esc(F.volume_l)}" placeholder="p. ej. 1000"></label><label class="field"><span>Comprador / Cliente</span><input name="buyer" value="${esc(F.buyer)}" placeholder="Nombre (opcional)"></label></div>`;
  }
  if (t === 'blend') {
    const rows = F.origins.map((o, i) => { const v = vessel(o.vessel_id); return `<div class="dest-row">${vesselPicker({ id: 'o' + i, value: o.vessel_id, filter: inWine, placeholder: 'Depósito…', onPick: (id) => { F.origins[i].vessel_id = id; renderOpModal(); } })}<input type="number" step="0.1" data-ovol="${i}" value="${esc(o.volume)}" placeholder="${v ? fmtN(v.stay_volume, 1) : 'todo'}"><button type="button" class="icon-btn" data-odel="${i}">${ico('i-x')}</button></div>`; }).join('');
    const total = blendTotal();
    const nl = F.new_lot;
    return `<div class="od"><div class="pane"><h4>Lotes de origen</h4>${rows}<div class="row"><button type="button" class="btn sm" data-oadd>+ Añadir lote de origen</button>${vesselPicker({ id: 'bm', multi: true, selected: [], filter: (v) => inWine(v) && ['barrel', 'foudre'].includes(v.kind), placeholder: 'Seleccionar varias barricas', onPick: (ids) => { F.origins = F.origins.filter((o) => o.vessel_id).concat(ids.map((id) => ({ vessel_id: id, volume: '' }))); renderOpModal(); } })}</div><div class="help">Total: <b>${fmtN(total, 1)} L</b></div></div><div class="arrow">→</div><div class="pane"><h4>Nuevo lote resultante</h4>
      <label class="field"><span>Código del lote</span><input name="nl_code" value="${esc(nl.code)}" placeholder="vacío = automático"></label>
      <div class="row" style="margin-top:8px"><label class="field"><span>Tipo de vino</span><select name="nl_type">${opts(WINE, nl.wine_type, '— del primer origen —')}</select></label><label class="field"><span>Añada</span><input type="number" name="nl_vintage" value="${esc(nl.vintage)}" placeholder="2026"></label></div>
      <label class="field" style="margin-top:8px"><span>Variedad(es)</span><input name="nl_var" value="${esc(nl.varieties)}" placeholder="vacío = suma de los orígenes"></label>
      <label class="field" style="margin-top:8px"><span>Fase</span><select name="nl_phase">${opts(PHASE, nl.phase, '— del primer origen —')}</select></label>
      <h4 style="margin-top:12px">Depósitos de destino</h4>${destRows((v) => !v.stay_id || F.origins.some((o) => +o.vessel_id === v.id))}
      <div class="sub-box" style="margin-top:8px"><label class="field"><span>Merma (L)</span><input type="number" step="0.1" min="0" name="loss_l" value="${esc(F.loss_l)}" placeholder="0"></label></div></div></div>`;
  }
  return '';
}
function originOut() {
  const o = hasOrigin(); if (!o) return 0;
  const t = F.type;
  if (['racking', 'filtration', 'decantation'].includes(t)) {
    const ds = F.destinations.filter((d) => d.vessel_id);
    const fixed = ds.reduce((a, d) => a + (+d.volume || 0), 0);
    const blank = ds.some((d) => d.volume === '' || d.volume == null);
    if (F.volume_l) return +F.volume_l + (+F.loss_l || 0) + (+F.lees_l || 0);
    if (!ds.length || blank) return o.stay_volume || 0;
    return fixed + (+F.loss_l || 0) + (+F.lees_l || 0);
  }
  if (t === 'barrel_transfer') return barrelTotal() + (+F.loss_l || 0);
  if (t === 'bulk_sale' || t === 'bleeding' || t === 'topping') return +F.volume_l || 0;
  if (t === 'pressing') return o.stay_volume || 0;
  return 0;
}
function destShare(i) {
  // litros que recibirá un destino en blanco (solo uno puede quedar en blanco)
  if (!['racking', 'filtration', 'decantation', 'blend'].includes(F.type)) return F.type === 'barrel_transfer' && F.mode === 'empty' ? barrelTotal() - (+F.loss_l || 0) : F.type === 'bleeding' ? +F.volume_l || 0 : 0;
  const d = F.destinations[i]; if (!d || d.volume !== '') return 0;
  const blanks = F.destinations.filter((x) => x.volume === '').length; if (blanks > 1) return 0;
  const fixed = F.destinations.reduce((a, x) => a + (+x.volume || 0), 0);
  const total = F.type === 'blend' ? blendTotal() : (F.volume_l ? +F.volume_l : (hasOrigin()?.stay_volume || 0) - (+F.loss_l || 0) - (+F.lees_l || 0));
  return Math.max(0, Math.round((total - fixed) * 10) / 10);
}
function barrelTotal() {
  if (F.mode === 'empty') return F.origins.reduce((a, o) => { const v = vessel(o.vessel_id); return a + (o.volume !== '' ? +o.volume : (v?.stay_volume || 0)); }, 0);
  return F.destinations.reduce((a, d) => { const v = vessel(d.vessel_id); return a + (d.volume !== '' ? +d.volume : v ? Math.max(0, v.capacity_l - (v.stay_volume || 0)) : 0); }, 0);
}
function blendTotal() { return F.origins.reduce((a, o) => { const v = vessel(o.vessel_id); return a + (o.volume !== '' ? +o.volume : (v?.stay_volume || 0)); }, 0); }

function bindOpModal(m) {
  const re = () => renderOpModal();
  $$('input[name=optype]', m).forEach((r) => r.onchange = () => { F.type = r.value; F.origins = []; F.destinations = []; F.products = []; F.volume_l = ''; re(); });
  const bindF = (name, key = name) => { const el = $(`[name=${name}]`, m); if (el) el.oninput = () => { F[key] = el.value; if (name === 'operator_id') localStorage.setItem('ulula.operator', el.value); }; };
  ['op_date', 'operator_id', 'notes', 'buyer', 'press_vessel_id', 'lees_lot_code'].forEach((n) => bindF(n));
  // campos que cambian la vista previa
  const live = (name, key) => { const el = $(`[name=${name}]`, m); if (el) { el.oninput = () => { F[key] = el.value; refreshPreview(m); }; el.onchange = () => { F[key] = el.value; if (name === 'lees_l') re(); }; } };
  live('volume_l', 'volume_l'); live('loss_l', 'loss_l'); live('lees_l', 'lees_l');
  const nlc = $('[name=newlot]', m); if (nlc) nlc.onchange = () => { F.new_lot.create = nlc.checked; re(); };
  const nlcode = $('[name=newlotcode]', m); if (nlcode) nlcode.oninput = () => { F.new_lot.code = nlcode.value; };
  [['nl_code', 'code'], ['nl_type', 'wine_type'], ['nl_vintage', 'vintage'], ['nl_var', 'varieties'], ['nl_phase', 'phase']].forEach(([n, k]) => { const el = $(`[name=${n}]`, m); if (el) el.oninput = () => { F.new_lot[k] = el.value; }; });
  $$('[data-dvol]', m).forEach((el) => { el.oninput = () => { F.destinations[+el.dataset.dvol].volume = el.value; refreshPreview(m); }; });
  $$('[data-ovol]', m).forEach((el) => { el.oninput = () => { F.origins[+el.dataset.ovol].volume = el.value; refreshPreview(m); }; });
  $$('[data-dcode]', m).forEach((el) => el.oninput = () => { F.destinations[+el.dataset.dcode].new_lot_code = el.value; });
  $$('[data-dfrac]', m).forEach((el) => el.onchange = () => { F.destinations[+el.dataset.dfrac].fraction = el.value; });
  $$('[data-ddel]', m).forEach((el) => el.onclick = () => { F.destinations.splice(+el.dataset.ddel, 1); re(); });
  $$('[data-odel]', m).forEach((el) => el.onclick = () => { F.origins.splice(+el.dataset.odel, 1); re(); });
  const dadd = $('[data-dadd]', m); if (dadd) dadd.onclick = () => { F.destinations.push({ vessel_id: '', volume: '', new_lot_code: '', fraction: 'free_run' }); re(); };
  const oadd = $('[data-oadd]', m); if (oadd) oadd.onclick = () => { F.origins.push({ vessel_id: '', volume: '' }); re(); };
  const oclear = $('[data-oclear]', m); if (oclear) oclear.onclick = () => { F.origins = []; re(); };
  $$('[data-mode]', m).forEach((b) => b.onclick = () => { F.mode = b.dataset.mode; F.origins = []; F.destinations = []; re(); });
  $$('[data-pid]', m).forEach((el) => el.onchange = () => { const i = +el.dataset.pid; if (el.value === '_free') { F.products[i].product_id = ''; F.products[i]._free = true; F.products[i].product_name = F.products[i].product_name || ''; } else { const p = S.boot.products.find((x) => String(x.id) === el.value); F.products[i].product_id = el.value; F.products[i].product_name = p ? p.name : ''; F.products[i].unit = p ? p.unit : ''; F.products[i]._free = false; } re(); });
  $$('[data-pname]', m).forEach((el) => el.oninput = () => { F.products[+el.dataset.pname].product_name = el.value; });
  $$('[data-pqty]', m).forEach((el) => el.oninput = () => { F.products[+el.dataset.pqty].qty = el.value; });
  $$('[data-pnote]', m).forEach((el) => el.oninput = () => { F.products[+el.dataset.pnote].note = el.value; });
  $$('[data-pdel]', m).forEach((el) => el.onclick = () => { F.products.splice(+el.dataset.pdel, 1); re(); });
  const padd = $('[data-padd]', m); if (padd) padd.onclick = () => { F.products.push({ product_id: '', product_name: '', qty: '', unit: '', note: '' }); re(); };
  $('[data-x=cancel]', m).onclick = closeModal;
  const save = async (status) => {
    const body = payloadFromForm(status);
    const btns = $$('.modal-foot .btn', m); btns.forEach((b) => b.disabled = true);
    try {
      const r = await api(FID ? `/operations/${FID}` : '/operations', { method: FID ? 'PUT' : 'POST', body });
      closeModal(); toast(status === 'draft' ? 'Borrador guardado' : status === 'confirmed' ? `Operación #${r.id} creada` : 'Cambios guardados');
      await reload(); route();
    } catch (e) {
      btns.forEach((b) => b.disabled = false);
      const old = $('.alert.bad', m); if (old) old.remove();
      $('.modal-body', m).insertAdjacentHTML('afterbegin', `<div class="alert bad">${esc(e.message)}</div>`); $('.modal-body', m).scrollTop = 0;
    }
  };
  const d = $('[data-x=draft]', m); if (d) d.onclick = () => save('draft');
  const c = $('[data-x=confirm]', m); if (c) c.onclick = () => save('confirmed');
  const s = $('[data-x=save]', m); if (s) s.onclick = () => save('confirmed');
}
function refreshPreview(m) {
  // Re-dibuja solo las tarjetas de recipientes (sin perder el foco de los campos).
  const cards = $$('.vcard', m);
  const fresh = typeBody(F.type);
  const tmp = document.createElement('div'); tmp.innerHTML = fresh;
  const nc = $$('.vcard', tmp);
  cards.forEach((c, i) => { if (nc[i]) c.outerHTML = nc[i].outerHTML; });
  const ot = $('#outtotal', m); if (ot) ot.textContent = `${fmtN(originOut(), 1)} L`;
  $$('.help b', tmp); // (totales de barricas/coupage se actualizan al re-render)
  $$('.vp .drop', m).forEach((d) => d.remove());
}
function payloadFromForm(status) {
  const nl = F.new_lot;
  return {
    status, type: F.type, op_date: F.op_date, operator_id: F.operator_id || null, notes: F.notes, mode: F.mode, press_vessel_id: F.press_vessel_id || null, buyer: F.buyer,
    volume_l: F.volume_l === '' ? null : +F.volume_l, loss_l: +F.loss_l || 0, lees_l: +F.lees_l || 0, lees_vessel_id: F.lees_vessel_id || null, lees_lot_code: F.lees_lot_code || null,
    new_lot: (F.type === 'blend' || nl.create) ? { create: nl.create, code: nl.code || null, wine_type: nl.wine_type || null, vintage: nl.vintage || null, varieties: nl.varieties || null, phase: nl.phase || null } : null,
    origins: F.origins.filter((o) => o.vessel_id).map((o) => ({ vessel_id: +o.vessel_id, volume: o.volume === '' ? null : +o.volume })),
    destinations: F.destinations.filter((d) => d.vessel_id).map((d) => ({ vessel_id: +d.vessel_id, volume: d.volume === '' ? null : +d.volume, new_lot_code: d.new_lot_code || null, fraction: d.fraction || null })),
    products: F.products.filter((x) => x.product_id || x.product_name).map((x) => ({ product_id: x.product_id || null, product_name: x.product_name || null, qty: x.qty === '' ? null : +x.qty, unit: x.unit || null, note: x.note || null })),
  };
}

// ---------------------------------------------------------------- trazabilidad
async function viewTrace(page) {
  crumbs('Trazabilidad');
  const q = S.route.q;
  page.innerHTML = head('Trazabilidad', 'Extracto del lote: estancias en recipientes, eventos y origen.') +
    `<label class="search"><svg><use href="#i-search"/></svg><input id="tq" placeholder="Buscar lote o depósito…" autocomplete="off"></label><div id="tres"></div><div id="tbody"></div>`;
  const tq = $('#tq');
  tq.oninput = async () => { const v = tq.value.trim(); if (v.length < 1) { $('#tres').innerHTML = ''; return; } const r = await api('/search?q=' + encodeURIComponent(v)); $('#tres').innerHTML = `<div class="card" style="margin-bottom:12px">${r.lots.length ? `<div class="small muted">LOTES</div>${r.lots.map((l) => `<div><a href="#/traza?lot=${l.id}"><b>${esc(l.code)}</b></a> <span class="muted small">${esc(l.varieties || '')} · ${WINE[l.wine_type] || ''}${l.vintage ? ' · ' + l.vintage : ''}${l.status !== 'active' ? ' · cerrado' : ''}</span></div>`).join('')}` : ''}${r.vessels.length ? `<div class="small muted" style="margin-top:6px">DEPÓSITOS</div>${r.vessels.map((v) => `<div><a href="#/traza?vessel=${v.id}"><b>${esc(v.code)}</b></a> <span class="muted small">${v.lot_code ? esc(v.lot_code) : 'vacío'}</span></div>`).join('')}` : ''}${!r.lots.length && !r.vessels.length ? '<span class="muted">Sin resultados</span>' : ''}</div>`; };
  if (!q.lot && !q.vessel) { $('#tbody').innerHTML = empty('Selecciona un punto de partida', 'Elige un depósito o un lote para visualizar su procedencia.'); return; }
  const t = await api(`/trace?${q.lot ? 'lot=' + q.lot : 'vessel=' + q.vessel}`);
  const lo = t.lot;
  const cur = t.stays.filter((s) => !s.left_at);
  const events = (s) => {
    const inRange = (d) => d >= s.entered_at && (!s.left_at || d <= s.left_at);
    const ev = [];
    for (const o of t.operations) if (o.vessel_id === s.vessel_id && inRange(o.op_date)) ev.push({ d: o.op_date, k: o.type === 'addition' ? 'k-add' : 'k-op', html: `${TYPE_LABEL[o.type] || o.type}${o.side === 'origin' ? ` — salen ${fmtL(o.volume, o.unit || 'L')}` : o.side === 'destination' ? ` — ${fmtL(o.volume, o.unit || 'L')} recibidos` : o.side === 'product' ? ` — ${esc(o.product_name || '')} ${fmtN(o.qty, 2)} ${esc(o.unit || '')}` : ''}${o.operator_name ? ` · ${esc(o.operator_name)}` : ''}` });
    for (const a of t.analyses) if ((a.vessel_id === s.vessel_id || !a.vessel_id) && inRange(a.analysed_at)) ev.push({ d: a.analysed_at, k: 'k-an', html: `Análisis${a.analysed_by ? ' · ' + esc(a.analysed_by) : ''} — ${['ph', 'so2_free', 'so2_total', 'va', 'malic'].filter((k) => a[k] != null).map((k) => `${{ ph: 'pH', so2_free: 'SO₂ libre', so2_total: 'SO₂ total', va: 'AV', malic: 'málico' }[k]} ${a[k]}`).join(' · ')}` });
    for (const c of t.tastings) if ((c.vessel_id === s.vessel_id || !c.vessel_id) && inRange(c.tasted_at)) ev.push({ d: c.tasted_at, k: 'k-cata', html: `Cata${c.taster ? ' · ' + esc(c.taster) : ''}${c.score != null ? ` — ${c.score}/10` : ''}${c.overall ? ` — ${esc(c.overall)}` : ''}` });
    for (const c of t.cleanings) if (c.vessel_id === s.vessel_id && inRange(c.cleaned_at)) ev.push({ d: c.cleaned_at, k: 'k-clean', html: `Limpieza${c.method ? ' · ' + esc(c.method) : ''}` });
    const cleanBefore = t.cleanings.some((c) => c.vessel_id === s.vessel_id && c.cleaned_at <= s.entered_at);
    ev.sort((a, b) => a.d.localeCompare(b.d));
    return (cleanBefore ? '' : `<div class="ev k-clean"><span class="dt"></span><i></i><span class="warn">Sin registro de limpieza antes del llenado</span></div>`) + ev.map((e) => `<div class="ev ${e.k}"><span class="dt">${fmtD(e.d)}</span><i></i><span>${e.html}</span></div>`).join('');
  };
  $('#tbody').innerHTML = `<div class="legend"><span class="k-op"><i></i>Trasiego / coupage</span><span class="k-add"><i></i>Adición</span><span class="k-an"><i></i>Análisis</span><span class="k-cata"><i></i>Cata</span><span class="k-clean"><i></i>Limpieza</span><span class="k-origin"><i></i>Origen</span></div>
    <div class="kpi-row"><div class="kpi"><div class="l">Lote</div><div class="v" style="font-size:20px">${esc(lo.code)}</div><div class="s">${esc(lo.varieties || '')} · ${WINE[lo.wine_type] || ''}${lo.vintage ? ' · ' + lo.vintage : ''}</div></div><div class="kpi"><div class="l">Ubicación actual</div><div class="v" style="font-size:20px">${cur.length ? cur.map((s) => `${esc(s.vessel_code)} — ${fmtL(s.volume, s.unit)}`).join('<br>') : '<span class="muted">—</span>'}</div><div class="s">${PHASE[lo.phase] || ''}${lo.status !== 'active' ? ' · cerrado' : ''}</div></div><div class="kpi"><div class="l">Estancias</div><div class="v">${t.stays.length}</div></div><div class="kpi"><div class="l">Eventos</div><div class="v">${t.operations.length + t.analyses.length + t.tastings.length}</div></div></div>
    ${t.origin ? `<div class="stay"><div class="sh k-origin"><span class="code" style="color:var(--huerta)">Origen</span><span>${TYPE_LABEL[t.origin.type] || t.origin.type} del ${fmtD(t.origin.op_date)}${t.origin.origins.length ? ' de ' + t.origin.origins.map((o) => `<a href="#/traza?lot=${o.lot_id}">${esc(o.lot_code || '?')}</a> (${esc(o.vessel_code)}${o.volume ? ', ' + fmtL(o.volume, o.unit || 'L') : ''})`).join(' + ') : ''}</span></div></div>` : (lo.creation_method === 'manual' ? `<div class="help" style="margin-bottom:10px">Lote cargado como saldo de apertura (sin origen registrado).</div>` : '')}
    ${t.stays.map((s) => `<div class="stay"><div class="sh"><span class="code">${esc(s.vessel_code)}</span><span class="pill lot">${esc(lo.code)}</span>${!s.left_at ? '<span class="pill ok">ACTUAL</span>' : ''}<span class="vol">${fmtL(s.left_at ? s.volume_out : s.volume, s.unit)}</span><span class="range">${fmtD(s.entered_at)} → ${s.left_at ? fmtD(s.left_at) : 'hoy'} · ${Math.max(0, Math.round((Date.parse(s.left_at || today()) - Date.parse(s.entered_at)) / 864e5))} días · ${KIND[s.kind] || ''} ${fmtN(s.capacity_l)} L</span></div>${events(s)}</div>`).join('')}`;
}

// ---------------------------------------------------------------- análisis y catas
function analysesTable(rows) {
  const cols = [['analysed_at', 'Fecha'], ['vessel_code', 'Depósito'], ['lot_code', 'Lote'], ['alcohol', 'Alc %'], ['ph', 'pH'], ['ta', 'AT'], ['va', 'AV'], ['so2_free', 'SO₂ L'], ['so2_total', 'SO₂ T'], ['malic', 'Málico'], ['lactic', 'Láctico'], ['rs', 'Azúcar'], ['temp', '°C'], ['analysed_by', 'Por']];
  return `<div class="table-wrap"><table class="t cards"><thead><tr>${cols.map((c) => `<th>${c[1]}</th>`).join('')}</tr></thead><tbody>${rows.map((a) => `<tr>${cols.map((c) => `<td data-l="${c[1]}" class="${typeof a[c[0]] === 'number' ? 'num' : ''}">${c[0] === 'analysed_at' ? fmtD(a[c[0]]) : esc(a[c[0]] ?? '—')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
function tastingsList(rows) { return `<div class="rowlist">${rows.map((c) => `<div class="item"><div class="body"><div class="t">${fmtD(c.tasted_at)} · ${esc(c.vessel_code || '')} <span class="pill lot">${esc(c.lot_code || '')}</span> ${c.score != null ? `<span class="pill ok">${c.score}/10</span>` : ''} ${c.blind ? '<span class="pill">a ciegas</span>' : ''}</div><div class="m">${[c.phase, c.taster].filter(Boolean).map(esc).join(' · ')}${c.overall ? ' — ' + esc(c.overall) : ''}${c.nose ? ` · Nariz: ${esc(c.nose)}` : ''}${c.palate ? ` · Boca: ${esc(c.palate)}` : ''}</div></div></div>`).join('')}</div>`; }
async function viewAnalyses(page) {
  crumbs('Análisis de vino y mosto');
  const r = await api('/analyses');
  page.innerHTML = head('Análisis de laboratorio', `${r.analyses.length} análisis registrados`, `<button class="btn primary" id="newan">${ico('i-plus')} Nuevo análisis</button>`) + (r.analyses.length ? analysesTable(r.analyses) : empty('Aún no hay análisis', 'Los análisis siguen la evolución de cada lote en su depósito.', '<button class="btn primary" id="newan2">Registrar análisis</button>'));
  const f = () => openAnalysis({}); $('#newan').onclick = f; if ($('#newan2')) $('#newan2').onclick = f;
}
function openAnalysis({ vessel_id }) {
  const params = [['alcohol', 'Alcohol (% vol)', '13.5'], ['va', 'Acidez volátil (g/L)', '0.45'], ['ta', 'Acidez total (g/L)', '6.5'], ['ph', 'pH', '3.40'], ['so2_free', 'SO₂ libre (mg/L)', '25'], ['so2_bound', 'SO₂ combinado (mg/L)', '—'], ['so2_total', 'SO₂ total (mg/L)', '80'], ['so2_molecular', 'SO₂ molecular (mg/L)', '—'], ['malic', 'Ácido málico (g/L)', '1.50'], ['lactic', 'Ácido láctico (g/L)', '0.20'], ['rs', 'Azúcar residual (g/L)', '2.0'], ['brix', 'Brix (°Bx)', '—'], ['temp', 'Temperatura (°C)', '—']];
  let vid = vessel_id || '';
  const m = modal('Nuevo análisis', `<div class="row"><label class="field req" style="flex:1"><span>Fecha</span><input type="date" name="analysed_at" value="${today()}"></label><label class="field" style="flex:1"><span>Analizado por</span><input name="analysed_by" placeholder="Sentia, Uva y Vino, San Lucas…"></label></div>
    <div class="field req" style="margin-top:12px"><span>Depósito con vino</span><div id="anv">${vesselPicker({ id: 'an', value: vid, filter: withWine, placeholder: 'Depósito con vino…', onPick: (id) => { vid = id; $('#anv').innerHTML = vesselPicker({ id: 'an', value: vid, filter: withWine, onPick: (x) => { vid = x; } }); } })}</div></div>
    <div class="small muted" style="margin:14px 0 6px;letter-spacing:.08em;text-transform:uppercase">Parámetros analíticos</div><div class="row">${params.map((p) => `<label class="field" style="flex:1 1 140px"><span>${p[1]}</span><input type="number" step="0.01" name="${p[0]}" placeholder="${p[2]}"></label>`).join('')}</div>
    <label class="field" style="margin-top:12px"><span>Notas</span><textarea name="notes" rows="2"></textarea></label>`, `<button class="btn" data-x="cancel">Cancelar</button><button class="btn primary" data-x="ok">Crear análisis</button>`, 'Laboratorio');
  $('[data-x=cancel]', m).onclick = closeModal;
  $('[data-x=ok]', m).onclick = async () => { const b = Object.fromEntries($$('input,textarea', m).filter((i) => i.name).map((i) => [i.name, i.value])); b.vessel_id = vid; try { await api('/analyses', { method: 'POST', body: b }); closeModal(); toast('Análisis guardado'); route(); } catch (e) { toast(e.message, true); } };
}
async function viewTastings(page) {
  crumbs('Notas de cata');
  const r = await api('/tastings');
  page.innerHTML = head('Notas de cata', `${r.tastings.length} notas registradas`, `<button class="btn primary" id="newc">${ico('i-plus')} Nueva nota de cata</button>`) + (r.tastings.length ? tastingsList(r.tastings) : empty('Aún no hay catas', 'Registra notas de cata para seguir la evolución sensorial de los lotes.', '<button class="btn primary" id="newc2">Registrar cata</button>'));
  const f = () => openTasting({}); $('#newc').onclick = f; if ($('#newc2')) $('#newc2').onclick = f;
}
function openTasting({ vessel_id }) {
  let vid = vessel_id || '';
  const m = modal('Nueva nota de cata', `<div class="row"><label class="field req" style="flex:1"><span>Fecha</span><input type="date" name="tasted_at" value="${today()}"></label><label class="field req" style="flex:1"><span>Catador</span><input name="taster" placeholder="Nombre"></label></div>
    <div class="field req" style="margin-top:12px"><span>Depósito con vino</span><div id="ctv">${vesselPicker({ id: 'ct', value: vid, filter: withWine, placeholder: 'Depósito con vino…', onPick: (id) => { vid = id; $('#ctv').innerHTML = vesselPicker({ id: 'ct', value: vid, filter: withWine, onPick: (x) => { vid = x; } }); } })}</div></div>
    <div class="row" style="margin-top:12px"><label class="field" style="flex:1"><span>Fase</span><select name="phase">${TASTING_PHASE.map((p) => `<option>${p}</option>`).join('')}</select></label><label class="field" style="flex:1"><span>Puntuación (0–10)</span><input type="number" step="0.5" min="0" max="10" name="score"></label><label class="toggle" style="flex:1"><input type="checkbox" name="blind"> Cata a ciegas</label></div>
    <div class="small muted" style="margin:14px 0 6px;letter-spacing:.08em;text-transform:uppercase">Descriptores organolépticos</div>
    ${[['appearance', 'Aspecto / Color'], ['nose', 'Aroma'], ['palate', 'Boca'], ['finish', 'Final'], ['overall', 'Apreciación global']].map((f) => `<label class="field" style="margin-top:8px"><span>${f[1]}</span><input name="${f[0]}"></label>`).join('')}
    <label class="field" style="margin-top:8px"><span>Notas adicionales</span><textarea name="notes" rows="2"></textarea></label>`, `<button class="btn" data-x="cancel">Cancelar</button><button class="btn primary" data-x="ok">Crear nota</button>`);
  $('[data-x=cancel]', m).onclick = closeModal;
  $('[data-x=ok]', m).onclick = async () => { const b = Object.fromEntries($$('input,textarea,select', m).filter((i) => i.name).map((i) => [i.name, i.type === 'checkbox' ? i.checked : i.value])); b.vessel_id = vid; try { await api('/tastings', { method: 'POST', body: b }); closeModal(); toast('Nota de cata guardada'); route(); } catch (e) { toast(e.message, true); } };
}
function openCleaning(v) {
  const m = modal(`Limpieza de ${v.code}`, `<div class="row"><label class="field req" style="flex:1"><span>Fecha</span><input type="date" name="cleaned_at" value="${today()}"></label><label class="field" style="flex:1"><span>Quién</span><input name="by_name"></label></div><label class="field" style="margin-top:12px"><span>Método</span><input name="method" placeholder="Agua caliente, sosa, ozono, azufre…"></label><label class="field" style="margin-top:12px"><span>Notas</span><textarea name="notes" rows="2"></textarea></label>`, `<button class="btn" data-x="cancel">Cancelar</button><button class="btn primary" data-x="ok">Registrar limpieza</button>`);
  $('[data-x=cancel]', m).onclick = closeModal;
  $('[data-x=ok]', m).onclick = async () => { const b = Object.fromEntries($$('input,textarea', m).filter((i) => i.name).map((i) => [i.name, i.value])); b.vessel_id = v.id; try { await api('/cleanings', { method: 'POST', body: b }); closeModal(); toast('Limpieza registrada'); route(); } catch (e) { toast(e.message, true); } };
}

// ---------------------------------------------------------------- actividad
async function viewActivity(page) {
  crumbs('Actividad');
  const a = await api('/activity');
  const bars = (rows, lab, key = 'n') => { const max = Math.max(1, ...rows.map((r) => r[key])); return rows.length ? `<div class="bars">${rows.map((r) => `<div class="b"><span>${esc(lab(r))}</span><i style="width:${(r[key] / max) * 100}%"></i><span class="n">${fmtN(r[key])}</span></div>`).join('')}</div>` : '<div class="muted">Sin datos.</div>'; };
  page.innerHTML = head('Actividad y existencias', 'Volumen de operaciones y vino en bodega.') +
    `<div class="kpi-row"><div class="kpi"><div class="l">Operaciones (30 días)</div><div class="v">${a.ops30}</div></div><div class="kpi ${a.drafts ? 'warn' : ''}"><div class="l">Borradores pendientes</div><div class="v">${a.drafts}</div></div><div class="kpi ${a.toClean ? 'warn' : ''}"><div class="l">Recipientes por limpiar</div><div class="v">${a.toClean}</div></div><div class="kpi"><div class="l">Vino en bodega</div><div class="v">${fmtN(a.kpi.liters)} L</div><div class="s">${a.kpi.occupied} recipientes ocupados</div></div></div>
    <div class="grid2"><div class="card"><h3>Operaciones por tipo (12 meses)</h3>${bars(a.byType, (r) => TYPE_LABEL[r.type] || r.type)}</div><div class="card"><h3>Operaciones por mes</h3>${bars(a.byMonth, (r) => r.month)}</div><div class="card"><h3>Litros por tipo de vino</h3>${bars(a.lotsByType, (r) => `${WINE[r.wine_type] || r.wine_type} (${r.lots})`, 'liters')}</div></div>`;
}

// ---------------------------------------------------------------- depósitos
async function viewVessels(page) {
  crumbs('<a href="#/tablero" style="text-decoration:none">Configuración</a>', 'Depósitos');
  const vs = S.boot.vessels, locs = S.boot.locations;
  const tab = S.route.q.tab || 'recipientes';
  page.innerHTML = head('Depósitos', `${vs.length} recipientes registrados`, `<button class="btn" id="imp">Importar CSV</button><button class="btn" id="seq">Crear secuencia</button><button class="btn primary" id="newv">${ico('i-plus')} Nuevo depósito</button>`) +
    `<div class="tabs"><a href="#/depositos" ${tab === 'recipientes' ? 'aria-current="page"' : ''}>Recipientes</a><a href="#/depositos?tab=ubicaciones" ${tab === 'ubicaciones' ? 'aria-current="page"' : ''}>Ubicaciones</a></div>` +
    (tab === 'ubicaciones' ? `<div class="rowlist">${locs.map((l) => `<div class="item"><div class="body"><div class="t">${esc(l.name)}</div><div class="m">${esc(l.room || '')} · ${vs.filter((v) => v.location_id === l.id).length} recipientes</div></div><button class="btn sm" data-loc="${l.id}">Editar</button></div>`).join('') || '<div class="muted">Aún no hay ubicaciones. Crea salas o zonas y asígnalas a cada recipiente.</div>'}</div><div style="margin-top:12px"><button class="btn" id="newloc">+ Nueva ubicación</button></div>`
      : `<label class="search"><svg><use href="#i-search"/></svg><input id="vq" placeholder="Buscar por código…"></label><div class="table-wrap"><table class="t cards" id="vt"><thead><tr><th>Código</th><th>Tipo</th><th>Material</th><th>Recipiente</th><th class="num">Capacidad</th><th class="num">Vino</th><th>Lote</th><th>Ubicación</th><th>Activo</th><th></th></tr></thead><tbody>${vs.map(vRow).join('')}</tbody></table></div>`);
  if (tab === 'ubicaciones') { $('#newloc').onclick = () => openLocation(); $$('[data-loc]', page).forEach((b) => b.onclick = () => openLocation(locs.find((l) => l.id === +b.dataset.loc))); }
  else { $('#vq').oninput = (e) => { const q = e.target.value.toLowerCase(); $$('#vt tbody tr').forEach((tr) => { tr.style.display = tr.dataset.code.includes(q) ? '' : 'none'; }); }; $$('[data-ev]', page).forEach((b) => b.onclick = () => openVesselForm(vessel(+b.dataset.ev))); }
  $('#newv').onclick = () => openVesselForm(null); $('#seq').onclick = () => openSequence(); $('#imp').onclick = () => openImport();
}
function vRow(v) { return `<tr data-code="${esc((v.code + ' ' + (v.lot_code || '')).toLowerCase())}"><td data-l="Código"><a href="#/recipiente/${v.id}"><b>${esc(v.code)}</b></a></td><td data-l="Tipo">${VTYPE[v.vessel_type] || ''}</td><td data-l="Material">${MATERIAL[v.material] || ''}</td><td data-l="Recipiente">${KIND[v.kind] || ''}</td><td data-l="Capacidad" class="num">${fmtN(v.capacity_l)} L</td><td data-l="Vino" class="num">${v.stay_id ? fmtL(v.stay_volume, v.stay_unit) : '—'}</td><td data-l="Lote">${v.lot_code ? `<span class="pill lot">${esc(v.lot_code)}</span>` : '—'}</td><td data-l="Ubicación">${esc(v.location_name || '—')}</td><td data-l="Activo">${v.is_active ? '<span class="pill ok">Activo</span>' : '<span class="pill">Inactivo</span>'}</td><td><button class="icon-btn" data-ev="${v.id}" title="Editar">${ico('i-edit')}</button></td></tr>`; }
function vesselFormFields(v = {}) {
  return `<div class="row"><label class="field req" style="flex:1"><span>Código del depósito</span><input name="code" value="${esc(v.code || '')}" placeholder="p. ej. TK-01"></label><label class="field req" style="flex:1"><span>Capacidad (L)</span><input type="number" step="1" name="capacity_l" value="${esc(v.capacity_l || '')}" placeholder="p. ej. 2000"></label></div>
    <div class="row" style="margin-top:12px"><label class="field req"><span>Uso</span><select name="vessel_type">${opts(VTYPE, v.vessel_type || 'storage')}</select></label><label class="field req"><span>Material</span><select name="material">${opts(MATERIAL, v.material || 'stainless_steel')}</select></label><label class="field req"><span>Tipo de recipiente</span><select name="kind">${opts(KIND, v.kind || 'tank')}</select></label></div>
    <div class="row" style="margin-top:12px"><label class="field"><span>Ubicación en la bodega</span><select name="location_id"><option value="">Sin ubicación</option>${S.boot.locations.map((l) => `<option value="${l.id}" ${l.id === v.location_id ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select></label></div>
    <div class="row" style="margin-top:12px"><label class="toggle"><input type="checkbox" name="is_active" ${v.is_active === 0 ? '' : 'checked'}> Depósito activo</label><label class="toggle"><input type="checkbox" name="always_full" ${v.always_full ? 'checked' : ''}> Siempre lleno (tapa flotante / capacidad variable)</label></div><div class="help">Tapa flotante: no tiene espacio de cabeza, así que no entra en las alertas de depósitos por rellenar.</div>
    <details style="margin-top:12px"><summary class="muted small">Datos de barrica (opcional)</summary><div class="row" style="margin-top:8px"><label class="field"><span>Tonelería</span><input name="cooperage" value="${esc(v.cooperage || '')}"></label><label class="field"><span>Origen de la madera</span><input name="wood_origin" value="${esc(v.wood_origin || '')}"></label><label class="field"><span>Tostado</span><input name="toast_level" value="${esc(v.toast_level || '')}"></label><label class="field"><span>Formato</span><input name="barrel_format" value="${esc(v.barrel_format || '')}"></label><label class="field"><span>Fecha de compra</span><input type="date" name="acquisition_date" value="${esc(v.acquisition_date || '')}"></label></div></details>
    <label class="field" style="margin-top:12px"><span>Notas</span><textarea name="notes" rows="2">${esc(v.notes || '')}</textarea></label>`;
}
const formValues = (m) => Object.fromEntries($$('input,select,textarea', m).filter((i) => i.name).map((i) => [i.name, i.type === 'checkbox' ? i.checked : i.value]));
function openVesselForm(v) {
  const m = modal(v ? `Editar ${v.code}` : 'Nuevo depósito', vesselFormFields(v || {}), `<button class="btn" data-x="cancel">Cancelar</button><button class="btn primary" data-x="ok">${v ? 'Guardar' : 'Crear depósito'}</button>`, 'Configuración');
  $('[data-x=cancel]', m).onclick = closeModal;
  $('[data-x=ok]', m).onclick = async () => { try { await api(v ? `/vessels/${v.id}` : '/vessels', { method: v ? 'PUT' : 'POST', body: formValues(m) }); closeModal(); toast(v ? 'Depósito guardado' : 'Depósito creado'); await reload(); route(); } catch (e) { toast(e.message, true); } };
}
function openSequence() {
  const m = modal('Crear secuencia', `<div class="row"><label class="field req"><span>Prefijo</span><input name="prefix" placeholder="BBL"></label><label class="field"><span>Inicio</span><input type="number" name="start" value="1"></label><label class="field req"><span>Cantidad</span><input type="number" name="count" value="5"></label><label class="field"><span>Dígitos</span><input type="number" name="digits" value="3"></label></div><div class="help">Genera PREFIJO-001, PREFIJO-002…</div>` + vesselFormFields({ kind: 'barrel', vessel_type: 'aging', material: 'oak', capacity_l: 225 }).replace(/<label class="field req" style="flex:1"><span>Código del depósito<\/span>.*?<\/label>/, ''), `<button class="btn" data-x="cancel">Cancelar</button><button class="btn primary" data-x="ok">Crear secuencia</button>`, 'Configuración');
  $('[data-x=cancel]', m).onclick = closeModal;
  $('[data-x=ok]', m).onclick = async () => { try { const r = await api('/vessels/sequence', { method: 'POST', body: formValues(m) }); closeModal(); toast(`${r.created.length} recipientes creados`); await reload(); route(); } catch (e) { toast(e.message, true); } };
}
function parseCsv(text) {
  const sep = text.split('\n')[0].includes(';') ? ';' : ',';
  const lines = text.replace(/\r/g, '').split('\n').filter((l) => l.trim());
  const head = lines.shift().split(sep).map((h) => h.trim().toLowerCase());
  const map = { codigo: 'code', code: 'code', código: 'code', capacidade_l: 'capacity_l', capacidad_l: 'capacity_l', capacidad: 'capacity_l', capacity_l: 'capacity_l', tipo: 'vessel_type', uso: 'vessel_type', vessel_type: 'vessel_type', material: 'material', vasilha: 'kind', recipiente: 'kind', kind: 'kind', ativo: 'is_active', activo: 'is_active', is_active: 'is_active', cooperage: 'cooperage', toneleria: 'cooperage', tonelería: 'cooperage', wood_origin: 'wood_origin', toast_level: 'toast_level', barrel_format: 'barrel_format', acquisition_date: 'acquisition_date', notas: 'notes', notes: 'notes', ubicacion: 'location', ubicación: 'location', location: 'location', always_full: 'always_full', siempre_lleno: 'always_full' };
  return lines.map((l) => { const cells = l.split(sep); const o = {}; head.forEach((h, i) => { const k = map[h]; if (k) o[k] = (cells[i] || '').trim(); }); return o; });
}
function openImport() {
  const m = modal('Importar depósitos desde CSV', `<div class="alert info">Columnas (coma o punto y coma): <b>codigo, capacidad_l, tipo, material, recipiente, activo, ubicacion, notas</b> (+ tonelería, wood_origin, toast_level, barrel_format, acquisition_date). Valores en español, portugués o inglés: <i>fermentación / almacenamiento / crianza</i>, <i>inox / roble / barro…</i>, <i>depósito / barrica / foudre / ánfora / prensa…</i>. Los códigos ya existentes se omiten.</div><input type="file" accept=".csv,.txt,text/csv" id="csvf"><div id="csvp" style="margin-top:12px"></div>`, `<button class="btn" data-x="cancel">Cancelar</button><button class="btn primary" data-x="ok" disabled>Importar</button>`, 'Configuración');
  let rows = [];
  $('#csvf').onchange = async (e) => { const f = e.target.files[0]; if (!f) return; rows = parseCsv(await f.text()); $('#csvp').innerHTML = `<b>${rows.length} líneas detectadas</b><div class="table-wrap" style="margin-top:6px;max-height:260px;overflow:auto"><table class="t"><thead><tr><th>Código</th><th>Cap.</th><th>Tipo</th><th>Material</th><th>Recipiente</th></tr></thead><tbody>${rows.slice(0, 200).map((r) => `<tr><td>${esc(r.code)}</td><td class="num">${esc(r.capacity_l)}</td><td>${esc(r.vessel_type)}</td><td>${esc(r.material)}</td><td>${esc(r.kind)}</td></tr>`).join('')}</tbody></table></div>`; $('[data-x=ok]', m).disabled = !rows.length; };
  $('[data-x=cancel]', m).onclick = closeModal;
  $('[data-x=ok]', m).onclick = async () => { try { const r = await api('/vessels/import', { method: 'POST', body: { rows } }); closeModal(); toast(`${r.created} creados${r.skipped.length ? `, ${r.skipped.length} ya existían` : ''}`); await reload(); route(); } catch (e) { toast(e.message, true); } };
}
function openLocation(l) {
  const m = modal(l ? 'Editar ubicación' : 'Nueva ubicación', `<label class="field req"><span>Nombre</span><input name="name" value="${esc(l?.name || '')}" placeholder="Sala de barricas · fila 1"></label><label class="field" style="margin-top:12px"><span>Sala</span><input name="room" value="${esc(l?.room || '')}" placeholder="Front room, Back room, Sala de barricas…"></label>`, `<button class="btn" data-x="cancel">Cancelar</button><button class="btn primary" data-x="ok">Guardar</button>`, 'Configuración');
  $('[data-x=cancel]', m).onclick = closeModal;
  $('[data-x=ok]', m).onclick = async () => { try { await api(l ? `/locations/${l.id}` : '/locations', { method: l ? 'PUT' : 'POST', body: formValues(m) }); closeModal(); await reload(); route(); } catch (e) { toast(e.message, true); } };
}

// ---------------------------------------------------------------- saldos de apertura
async function viewOpening(page) {
  crumbs('<a href="#/tablero" style="text-decoration:none">Configuración</a>', 'Saldos de apertura');
  const free = S.boot.vessels.filter((v) => v.is_active && !v.stay_id), busy = S.boot.vessels.filter((v) => v.stay_id);
  let rows = [{}];
  page.innerHTML = head('Saldos de apertura', 'Introduce el vino que hay actualmente en la bodega para empezar a usar el sistema.') +
    `<div class="alert warn"><b>Cómo funciona.</b> Cada fila es un recipiente con vino (o uva en maceración, en kg). Se crea un lote por fila; los recipientes ya ocupados no aparecen. Tras guardar, los lotes quedan disponibles en Operaciones, Análisis y Catas.</div>
    <div class="chips" style="margin-bottom:12px"><span class="chip">Recipientes disponibles: <b>&nbsp;${free.length}</b></span><span class="chip">Ya con lote activo: <b>&nbsp;${busy.length}</b></span></div>
    <div class="row" style="margin-bottom:12px"><label class="field" style="flex:0 1 200px"><span>Fecha del saldo</span><input type="date" id="obdate" value="${today()}"></label></div>
    <div id="obrows" class="stack"></div><div style="margin:12px 0"><button class="btn" id="obadd">+ Añadir recipiente</button></div><div class="between"><span class="muted small" id="obcount"></span><button class="btn primary" id="obsave">Guardar saldos</button></div>`;
  const draw = () => {
    $('#obrows').innerHTML = rows.map((r, i) => `<div class="card"><div class="between"><b>Entrada #${i + 1}</b>${rows.length > 1 ? `<button class="icon-btn" data-del="${i}">${ico('i-x')}</button>` : ''}</div>
      <div class="row" style="margin-top:8px"><label class="field req" style="flex:2"><span>Recipiente</span><select data-k="vessel_id" data-i="${i}"><option value="">Seleccione…</option>${free.filter((v) => !rows.some((x, j) => j !== i && String(x.vessel_id) === String(v.id))).map((v) => `<option value="${v.id}" ${String(r.vessel_id) === String(v.id) ? 'selected' : ''}>${esc(v.code)} — ${KIND[v.kind]} (${fmtN(v.capacity_l)} L)</option>`).join('')}</select></label><label class="field" style="flex:2"><span>Código del lote</span><input data-k="code" data-i="${i}" value="${esc(r.code || '')}" placeholder="Automático (dejar vacío) o escribir"></label><label class="field req" style="flex:1"><span>Volumen actual</span><input type="number" step="0.1" data-k="volume" data-i="${i}" value="${esc(r.volume || '')}" placeholder="p. ej. 1500"></label><label class="field" style="flex:0 1 90px"><span>Unidad</span><select data-k="unit" data-i="${i}"><option value="L">L</option><option value="kg" ${r.unit === 'kg' ? 'selected' : ''}>kg (uva)</option></select></label></div>
      <div class="row" style="margin-top:8px"><label class="field" style="flex:2"><span>Variedad</span><input data-k="varieties" data-i="${i}" value="${esc(r.varieties || '')}" placeholder="p. ej. Sauvignon Blanc"></label><label class="field" style="flex:1"><span>Tipo</span><select data-k="wine_type" data-i="${i}">${opts(WINE, r.wine_type || 'blanco')}</select></label><label class="field" style="flex:0 1 110px"><span>Añada</span><input type="number" data-k="vintage" data-i="${i}" value="${esc(r.vintage || '2026')}"></label><label class="field" style="flex:1"><span>Fase actual</span><select data-k="phase" data-i="${i}">${opts(PHASE, r.phase || 'crianza')}</select></label><label class="field" style="flex:2"><span>Notas</span><input data-k="notes" data-i="${i}" value="${esc(r.notes || '')}" placeholder="Observaciones opcionales…"></label></div></div>`).join('');
    $('#obcount').textContent = `${rows.filter((r) => r.vessel_id && r.volume).length} de ${rows.length} filas completas`;
    $$('#obrows [data-k]').forEach((el) => el.oninput = el.onchange = () => { rows[+el.dataset.i][el.dataset.k] = el.value; if (el.dataset.k === 'vessel_id') draw(); else $('#obcount').textContent = `${rows.filter((r) => r.vessel_id && r.volume).length} de ${rows.length} filas completas`; });
    $$('#obrows [data-del]').forEach((b) => b.onclick = () => { rows.splice(+b.dataset.del, 1); draw(); });
  };
  draw();
  $('#obadd').onclick = () => { rows.push({ wine_type: rows[rows.length - 1]?.wine_type, vintage: rows[rows.length - 1]?.vintage, phase: rows[rows.length - 1]?.phase }); draw(); };
  $('#obsave').onclick = async () => { const valid = rows.filter((r) => r.vessel_id && r.volume); if (!valid.length) return toast('Completa al menos una fila', true); try { const r = await api('/opening-balances', { method: 'POST', body: { date: $('#obdate').value, rows: valid } }); toast(`${r.created.length} lotes creados`); await reload(); location.hash = '#/tablero'; } catch (e) { toast(e.message, true); } };
}

// ---------------------------------------------------------------- productos
async function viewProducts(page) {
  crumbs('<a href="#/tablero" style="text-decoration:none">Configuración</a>', 'Productos enológicos');
  const ps = S.boot.products;
  page.innerHTML = head('Productos enológicos', 'Catálogo de lo que se añade en bodega (SO₂, bentonita, levaduras…).', `<button class="btn primary" id="newp">${ico('i-plus')} Nuevo producto</button>`) + (ps.length ? `<div class="rowlist">${ps.map((p) => `<div class="item"><div class="body"><div class="t">${esc(p.name)} <span class="pill">${CATEGORY[p.category] || p.category}</span></div><div class="m">${esc(p.code || '')} · ${esc(p.unit)}${p.supplier ? ' · ' + esc(p.supplier) : ''}${p.concentration_gl ? ` · ${p.concentration_gl} g/L` : ''}${p.allergen ? ' · alérgeno' : ''}</div></div><button class="btn sm" data-ep="${p.id}">Editar</button></div>`).join('')}</div>` : empty('Sin productos', 'Crea el catálogo para que las adiciones elijan de una lista.'));
  $('#newp').onclick = () => openProduct(null); $$('[data-ep]', page).forEach((b) => b.onclick = () => openProduct(ps.find((p) => p.id === +b.dataset.ep)));
}
function openProduct(p) {
  const m = modal(p ? 'Editar producto' : 'Nuevo producto', `<div class="row"><label class="field"><span>Código</span><input name="code" value="${esc(p?.code || '')}"></label><label class="field req"><span>Tipo</span><select name="category">${opts(CATEGORY, p?.category || 'sulfite')}</select></label></div><label class="field req" style="margin-top:12px"><span>Nombre</span><input name="name" value="${esc(p?.name || '')}" placeholder="p. ej. KMBS (metabisulfito de potasio)"></label><div class="row" style="margin-top:12px"><label class="field"><span>Unidad</span><select name="unit">${['g', 'kg', 'ml', 'L', 'unidad'].map((u) => `<option ${u === (p?.unit || 'g') ? 'selected' : ''}>${u}</option>`).join('')}</select></label><label class="field"><span>Proveedor</span><input name="supplier" value="${esc(p?.supplier || '')}"></label><label class="field"><span>Existencias mínimas</span><input type="number" name="min_stock" value="${esc(p?.min_stock ?? '')}"></label></div><div class="row" style="margin-top:12px"><label class="field"><span>Concentración (g/L)</span><input type="number" step="0.01" name="concentration_gl" value="${esc(p?.concentration_gl ?? '')}"></label><label class="field"><span>Volumen aparente (ml/g)</span><input type="number" step="0.01" name="apparent_vol_mlg" value="${esc(p?.apparent_vol_mlg ?? '')}"></label><label class="toggle"><input type="checkbox" name="allergen" ${p?.allergen ? 'checked' : ''}> Contiene alérgenos</label></div><label class="field" style="margin-top:12px"><span>Notas</span><textarea name="notes" rows="2">${esc(p?.notes || '')}</textarea></label>`, `<button class="btn" data-x="cancel">Cancelar</button><button class="btn primary" data-x="ok">Guardar</button>`, 'Configuración');
  $('[data-x=cancel]', m).onclick = closeModal;
  $('[data-x=ok]', m).onclick = async () => { try { await api(p ? `/products/${p.id}` : '/products', { method: p ? 'PUT' : 'POST', body: formValues(m) }); closeModal(); await reload(); route(); } catch (e) { toast(e.message, true); } };
}

// ---------------------------------------------------------------- más (móvil)
function viewMore(page) {
  crumbs('Más');
  page.innerHTML = head('Más', '') + `<div class="rowlist">${NAV.filter((n) => n.length > 1 && !TABS.some((t) => t[0] === n[0])).map((n) => `<a class="item" href="#/${n[0]}" style="text-decoration:none">${ico(n[2])}<div class="body"><div class="t">${esc(n[1])}</div></div>›</a>`).join('')}</div><div class="foot muted small" style="margin-top:20px">Ulula v${esc(S.boot.version)} · Dos Búhos</div>`;
}

// ---------------------------------------------------------------- arranque
window.addEventListener('hashchange', route);
(async () => { try { await reload(); await route(); } catch (e) { $('#page').innerHTML = `<div class="alert bad">${esc(e.message)}</div>`; } })();
