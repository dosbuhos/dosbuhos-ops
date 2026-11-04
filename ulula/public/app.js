// Ulula — armazón: barra lateral con grupos plegables (misma estructura que GrapeFlow), barra de pestañas móvil, paleta ⌘K, enrutador.
import { S, $, $$, esc, ico, api, reload, toast, go, me, SVG_DEFS } from './core.js';
import * as panel from './v-panel.js';
import * as vinedo from './v-vinedo.js';
import * as vendimia from './v-vendimia.js';
import * as bodega from './v-bodega.js';
import * as embotellado from './v-embotellado.js';
import * as config from './v-config.js';
import * as extra from './v-extra.js';

// Grupos y páginas. adv = solo con «Mostrar módulos avanzados». area = en qué ámbito del panel se muestra el grupo.
export const NAV = [
  { key: 'panel', label: 'Panel', icon: 'panel', top: true, view: panel.viewPanel },
  { key: 'vinedo', label: 'Viñedo', icon: 'vineyard', k: 'k-huerta', area: 'vineyard', kids: [
    { key: 'parcelas', label: 'Parcelas de viñedo', icon: 'parcel', view: vinedo.viewParcels },
    { key: 'fenologia', label: 'Fenología', icon: 'phenology', view: vinedo.viewPhenology },
    { key: 'labores', label: 'Labores', icon: 'fieldops', view: vinedo.viewFieldOps },
    { key: 'tratamientos', label: 'Registro de tratamientos', icon: 'spray', view: vinedo.viewSpray },
  ] },
  { key: 'vendimia', label: 'Vendimia', icon: 'harvest', k: 'k-hospitalidad', area: 'both', kids: [
    { key: 'maduracion', label: 'Maduración', icon: 'maturation', view: vinedo.viewMaturation },
    { key: 'recepcion', label: 'Recepción de uva', icon: 'grape', view: vendimia.viewHarvest },
    { key: 'parcelas-compradas', label: 'Parcelas de uva comprada', icon: 'map', adv: true, view: extra.viewSupplierBlocks },
    { key: 'fermentaciones', label: 'Seguimiento de fermentaciones', icon: 'ferment', view: vendimia.viewFermentations },
  ] },
  { key: 'bodega', label: 'Bodega', icon: 'cellar', k: 'k-bodega', area: 'winery', kids: [
    { key: 'tablero', label: 'Tablero de bodega', icon: 'board', view: bodega.viewBoard },
    { key: 'operaciones', label: 'Operaciones de bodega', icon: 'ops', view: bodega.viewOperations },
    { key: 'conciliacion', label: 'Conciliación de volúmenes', icon: 'balances', adv: true, view: extra.viewReconciliation },
    { key: 'traza', label: 'Trazabilidad', icon: 'trace', view: bodega.viewTrace },
    { key: 'coupage', label: 'Coupage', icon: 'blend', view: bodega.viewCoupage },
    { key: 'analisis', label: 'Análisis de vino y mosto', icon: 'lab', view: bodega.viewAnalyses },
    { key: 'calculadora', label: 'Calculadora de adiciones', icon: 'calc', view: bodega.viewCalculator },
    { key: 'catas', label: 'Notas de cata', icon: 'glass', view: bodega.viewTastings },
    { key: 'limpieza', label: 'Registro de limpieza', icon: 'clean', adv: true, view: extra.viewCleaning },
    { key: 'productos', label: 'Productos enológicos', icon: 'box', adv: true, view: config.viewProducts },
    { key: 'inventario', label: 'Inventario', icon: 'inventory', view: bodega.viewInventory },
  ] },
  { key: 'embotellado', label: 'Embotellado', icon: 'bottle', k: 'k-ventas', area: 'winery', kids: [
    { key: 'embotellados', label: 'Embotellados', icon: 'bottle', view: embotellado.viewBottling },
    { key: 'materiales', label: 'Materiales secos', icon: 'tag', adv: true, view: extra.viewPackaging },
    { key: 'productos-terminados', label: 'Productos terminados', icon: 'product', view: embotellado.viewFinished },
  ] },
  { key: 'configuracion', label: 'Configuración', icon: 'settings', k: 'k-admin', area: 'both', kids: [
    { key: 'perfil', label: 'Perfil de la empresa', icon: 'company', view: config.viewProfile },
    { key: 'alertas', label: 'Alertas', icon: 'alert', adv: true, view: extra.viewAlerts },
    { key: 'depositos', label: 'Depósitos', icon: 'tank', view: config.viewVessels },
    { key: 'equipos', label: 'Equipos', icon: 'settings', adv: true, view: extra.viewEquipment },
    { key: 'operarios', label: 'Operarios', icon: 'user', adv: true, view: extra.viewOperators },
    { key: 'usuarios', label: 'Usuarios', icon: 'users', view: config.viewUsers },
    { key: 'integraciones', label: 'Integraciones', icon: 'link', adv: true, view: extra.viewIntegrations },
    { key: 'saldos', label: 'Saldos de apertura', icon: 'balances', view: config.viewOpening },
  ] },
];
const EXTRA = { recipiente: bodega.viewVessel, parcela: vinedo.viewParcel, actividad: bodega.viewActivity, ayuda: config.viewHelp, ubicaciones: config.viewLocations, mas: viewMore };
const TABS = [['panel', 'Panel', 'panel'], ['parcelas', 'Viñedo', 'vineyard'], ['tablero', 'Bodega', 'cellar'], ['buscar', 'Buscar', 'search'], ['mas', 'Más', 'more']];
const PAGES = NAV.flatMap((n) => n.top ? [{ ...n, group: '' }] : n.kids.map((k) => ({ ...k, group: n.label, gk: n.key, gkey: n.k })));
export const pageOf = (key) => PAGES.find((p) => p.key === key);
const openGroups = new Set(JSON.parse(localStorage.getItem('ulula.groups') || '["bodega"]'));
S.scope = localStorage.getItem('ulula.scope') || '';
const scopeNow = () => S.scope || ({ vineyard: 'vineyard', winery: 'winery' }[S.boot.company?.profile] || 'both');
const groupVisible = (n) => { const sc = scopeNow(); return sc === 'both' || n.area === 'both' || n.area === sc; };
export function setScope(sc) { S.scope = sc; localStorage.setItem('ulula.scope', sc); renderShell(); }

function renderShell() {
  const cur = S.route.path, curPage = pageOf(cur) || (cur === 'recipiente' ? pageOf('tablero') : cur === 'parcela' ? pageOf('parcelas') : cur === 'actividad' ? pageOf('operaciones') : cur === 'ubicaciones' ? pageOf('depositos') : null);
  if (curPage?.gk) openGroups.add(curPage.gk);
  const u = me(); const c = S.boot.company || {};
  const collapsed = localStorage.getItem('ulula.collapsed') === '1';
  document.body.classList.toggle('rail', collapsed);
  $('#side').innerHTML = `<div class="brand"><img src="/logo.png" alt=""><div><b>Ulula</b><small>${esc(c.name || 'Dos Búhos')}</small></div></div>
    <button class="cmdk" id="cmdk">${ico('search')}<span>Buscar páginas…</span><kbd>⌘K</kbd></button>` +
    NAV.filter((n) => n.top || groupVisible(n)).map((n) => n.top ? `<a class="top-link" href="#/${n.key}" ${cur === n.key ? 'aria-current="page"' : ''}>${ico(n.icon)}<span>${esc(n.label)}</span></a>`
      : `<div class="grp ${n.k}" ${openGroups.has(n.key) ? 'open' : ''} data-g="${n.key}"><button type="button" title="${esc(n.label)}">${ico(n.icon)}<span>${esc(n.label)}</span>${ico('fwd', 'chev')}</button><div class="kids">${n.kids.filter((k) => !k.adv || S.advanced).map((k) => `<a class="child" href="#/${k.key}" ${curPage?.key === k.key ? 'aria-current="page"' : ''} title="${esc(k.label)}">${ico(k.icon)}<span>${esc(k.label)}</span></a>`).join('')}</div></div>`).join('') +
    `<div class="foot"><a class="me" href="#/usuarios" title="Usuarios"><div class="avatar">${esc(u?.initials || '?')}</div><div><b>${esc(u?.name || '—')}</b><small>${esc(u?.email || { admin: 'Administrador', technician: 'Técnico', operator: 'Operario' }[u?.role] || '')}</small></div>${ico('edit')}</a>
      <div class="toggle-row"><span>${ico('sparkle')}<span>Mostrar módulos avanzados</span></span><button type="button" class="switch" role="switch" aria-checked="${S.advanced}" id="advsw" aria-label="Mostrar módulos avanzados"></button></div>
      <a class="top-link" href="#/ayuda" ${cur === 'ayuda' ? 'aria-current="page"' : ''}>${ico('help')}<span>Ayuda</span></a>
      <div class="between"><button type="button" class="top-link" id="logout" style="flex:1">${ico('logout')}<span>Cerrar sesión</span></button><button type="button" class="icon-btn" id="collapse" title="${collapsed ? 'Expandir' : 'Contraer'} la barra">${ico(collapsed ? 'fwd' : 'back')}</button></div></div>`;
  $$('#side .grp > button').forEach((b) => b.onclick = () => { if (document.body.classList.contains('rail')) { localStorage.setItem('ulula.collapsed', '0'); renderShell(); } const g = b.parentElement; const k = g.dataset.g; if (g.hasAttribute('open')) { g.removeAttribute('open'); openGroups.delete(k); } else { g.setAttribute('open', ''); openGroups.add(k); } localStorage.setItem('ulula.groups', JSON.stringify([...openGroups])); });
  $('#advsw').onclick = async () => { S.advanced = !S.advanced; localStorage.setItem('ulula.advanced', S.advanced ? '1' : '0'); try { await api('/company', { method: 'PUT', body: { advanced_modules: S.advanced ? 1 : 0 } }); } catch { /* local */ } renderShell(); };
  $('#cmdk').onclick = openPalette;
  $('#collapse').onclick = () => { localStorage.setItem('ulula.collapsed', collapsed ? '0' : '1'); renderShell(); };
  $('#logout').onclick = () => { localStorage.removeItem('ulula.operator'); toast('Sesión local cerrada: elige operario en la próxima operación'); renderShell(); };
  $$('#side a').forEach((a) => a.addEventListener('click', closeSide));
  $('#tabbar').innerHTML = TABS.map((t) => t[0] === 'buscar' ? `<a href="#" data-search>${ico(t[2])}<span>${esc(t[1])}</span></a>` : `<a href="#/${t[0]}" ${(cur === t[0] || (t[0] === 'parcelas' && ['fenologia', 'labores', 'tratamientos', 'parcela'].includes(cur)) || (t[0] === 'tablero' && pageOf(cur)?.gk === 'bodega') || (t[0] === 'mas' && !TABS.some((x) => x[0] === cur) && !['fenologia', 'labores', 'tratamientos', 'parcela'].includes(cur) && pageOf(cur)?.gk !== 'bodega')) ? 'aria-current="page"' : ''}>${ico(t[2])}<span>${esc(t[1])}</span></a>`).join('');
  $('#tabbar [data-search]').onclick = (e) => { e.preventDefault(); openPalette(); };
  $('#ver').textContent = `v${S.boot.version}`;
  $('#today').textContent = S.boot.today;
}
function closeSide() { $('#side').classList.remove('open'); $('#scrim-side').classList.remove('open'); }
function viewMore(page) {
  $('#crumbs').innerHTML = '<b>Más</b>';
  page.innerHTML = `<div class="page-head"><div><h1>${ico('menu')}Más</h1></div></div>` + NAV.filter((n) => !n.top && groupVisible(n)).map((n) => `<div class="group-head ${n.k}">${esc(n.label)}</div><div class="rowlist" style="margin-bottom:10px">${n.kids.filter((k) => !k.adv || S.advanced).map((k) => `<a class="item ${n.k} k" href="#/${k.key}">${ico(k.icon, 'lead')}<div class="body"><div class="t">${esc(k.label)}</div></div>${ico('fwd')}</a>`).join('')}</div>`).join('') +
    `<div class="rowlist" style="margin-top:14px"><a class="item" href="#/ayuda">${ico('help', 'lead')}<div class="body"><div class="t">Ayuda</div></div>${ico('fwd')}</a><a class="item" href="#/actividad">${ico('chart', 'lead')}<div class="body"><div class="t">Actividad y existencias</div></div>${ico('fwd')}</a></div><div class="toggle-row" style="margin-top:10px"><span>Mostrar módulos avanzados</span><button type="button" class="switch" role="switch" aria-checked="${S.advanced}" id="advsw2"></button></div><div class="small muted" style="margin-top:20px">Ulula v${esc(S.boot.version)} · ${esc(S.boot.company?.name || 'Dos Búhos')}</div>`;
  $('#advsw2').onclick = () => { $('#advsw').click(); viewMore(page); };
}

// ---------------------------------------------------------------- paleta ⌘K: páginas + lotes + recipientes
function openPalette() {
  const w = $('#modal2'); w.classList.add('open'); w.classList.add('cmdk-wrap');
  const m = $('.modal', w); m.className = 'modal';
  m.innerHTML = `<div class="modal-body"><label class="search">${ico('search')}<input id="pq" placeholder="Ir a una página, lote o recipiente…" autocomplete="off"></label><div class="cmdk-list" id="pl" style="margin-top:8px"></div></div>`;
  const close = () => { w.classList.remove('open'); w.classList.remove('cmdk-wrap'); m.innerHTML = ''; };
  $('.scrim', w).onclick = close;
  let idx = 0, items = [];
  const draw = (q) => {
    const ql = q.toLowerCase();
    items = PAGES.filter((p) => !p.adv || S.advanced).filter((p) => !ql || p.label.toLowerCase().includes(ql) || (p.group || '').toLowerCase().includes(ql)).map((p) => ({ href: '#/' + p.key, icon: p.icon, label: p.label, sub: p.group || 'Inicio' }));
    if (ql.length >= 2) {
      items = items.concat(S.boot.lots.filter((l) => l.code.toLowerCase().includes(ql) || (l.varieties || '').toLowerCase().includes(ql)).slice(0, 6).map((l) => ({ href: '#/traza?lot=' + l.id, icon: 'trace', label: l.code, sub: `Lote · ${l.varieties || ''}${l.status !== 'active' ? ' · cerrado' : ''}` })),
        S.boot.vessels.filter((v) => v.code.toLowerCase().includes(ql)).slice(0, 6).map((v) => ({ href: '#/recipiente/' + v.id, icon: 'tank', label: v.code, sub: v.lot_code ? `Recipiente · ${v.lot_code}` : 'Recipiente · vacío' })));
    }
    idx = 0;
    $('#pl', m).innerHTML = items.length ? items.slice(0, 14).map((it, i) => `<a href="${it.href}" class="${i === idx ? 'on' : ''}">${ico(it.icon)}<span>${esc(it.label)}</span><small>${esc(it.sub)}</small></a>`).join('') : '<div class="muted" style="padding:12px">Sin resultados</div>';
    $$('#pl a', m).forEach((a) => a.onclick = close);
  };
  const inp = $('#pq', m);
  inp.oninput = () => draw(inp.value);
  inp.onkeydown = (e) => { const as = $$('#pl a', m); if (e.key === 'ArrowDown') idx = Math.min(as.length - 1, idx + 1); else if (e.key === 'ArrowUp') idx = Math.max(0, idx - 1); else if (e.key === 'Enter') { if (as[idx]) { close(); go(as[idx].getAttribute('href')); } return; } else if (e.key === 'Escape') { close(); return; } else return; as.forEach((a, i) => a.classList.toggle('on', i === idx)); };
  draw(''); inp.focus();
}
document.addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); } if (e.key === 'Escape') { const w2 = $('#modal2'); if (w2.classList.contains('open')) { w2.classList.remove('open'); w2.classList.remove('cmdk-wrap'); $('.modal', w2).innerHTML = ''; } else if ($('#modal').classList.contains('open')) { $('#modal').classList.remove('open'); $('#modal .modal').innerHTML = ''; } } });

// ---------------------------------------------------------------- enrutador
function parseRoute() {
  const h = location.hash.replace(/^#\/?/, '') || 'panel';
  const [path, q] = h.split('?');
  const [p, id] = path.split('/');
  return { path: p || 'panel', id, q: Object.fromEntries(new URLSearchParams(q || '')) };
}
export async function route() {
  S.route = parseRoute();
  renderShell();
  const page = $('#page');
  const p = pageOf(S.route.path); const fn = p ? p.view : EXTRA[S.route.path];
  if (!fn) { location.hash = '#/panel'; return; }
  page.classList.remove('with-hero'); $('#main').scrollTop = 0; window.scrollTo(0, 0);
  try { await fn(page, S.route.id); } catch (err) { page.innerHTML = `<div class="alert bad">${ico('alert')}<span>${esc(err.message)}</span></div>`; }
  mobilePolish(page);
}
// Móvil: en las tablas convertidas en tarjetas, las celdas vacías («—») no aportan nada y se ocultan.
function mobilePolish(page) {
  if (!window.matchMedia('(max-width: 719px)').matches) return;
  $$('table.t.cards td[data-l]', page).forEach((td) => { if (td.textContent.trim() === '—') td.classList.add('mhide'); });
}
window.addEventListener('hashchange', route);
(async () => {
  document.body.insertAdjacentHTML('beforeend', SVG_DEFS);
  $('#burger').onclick = () => { $('#side').classList.toggle('open'); $('#scrim-side').classList.toggle('open'); };
  $('#scrim-side').onclick = closeSide;
  try { await reload(); const c = S.boot.company || {}; if (c.advanced_modules != null) { S.advanced = !!c.advanced_modules; localStorage.setItem('ulula.advanced', S.advanced ? '1' : '0'); } if (c.appearance && c.appearance !== 'system') document.documentElement.dataset.theme = c.appearance; await route(); } catch (e) { $('#page').innerHTML = `<div class="alert bad">${esc(e.message)}</div>`; }
})();
