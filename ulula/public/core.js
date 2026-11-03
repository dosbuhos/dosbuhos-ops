// Ulula — núcleo del cliente: estado, API, catálogos, modal (apilable), selector de recipientes, tarjetas y gráficos SVG.
// Regla de diseño: en móvil todo es vertical (sin scroll horizontal). Los formularios eligen recipientes, nunca lotes.
import { ico } from './icons.js';
export { ico };

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const fmtN = (n, d = 0) => n == null || n === '' || Number.isNaN(+n) ? '—' : Number(n).toLocaleString('es-MX', { maximumFractionDigits: d, minimumFractionDigits: 0 });
export const fmtL = (n, unit = 'L') => n == null ? '—' : `${fmtN(n, 1)} ${unit}`;
export const fmtD = (d) => { if (!d) return '—'; const [y, m, dd] = d.slice(0, 10).split('-'); return `${dd}/${m}/${y}`; };
export const fmtDT = (d) => { if (!d) return '—'; const s = d.replace('T', ' '); return `${fmtD(s)} ${s.slice(11, 16)}`; };
export const today = () => (S.boot?.today) || new Date().toISOString().slice(0, 10);
export const nowLocal = () => { const d = new Date(Date.now() - 6 * 3600e3); return d.toISOString().slice(0, 16); };
export const daysBetween = (a, b) => Math.max(0, Math.round((Date.parse(b || today()) - Date.parse(a)) / 864e5));

export const S = { boot: null, board: null, route: { path: 'panel', q: {} }, view: localStorage.getItem('ulula.view') || 'cards', group: localStorage.getItem('ulula.group') || 'kind', filter: 'todos', q: '', advanced: localStorage.getItem('ulula.advanced') === '1' };

// ---------------------------------------------------------------- catálogos (etiquetas en español)
export const TYPES = [
  ['pressing', 'Prensado', 'press', 'k-marketing', 'Prensar uva o mosto: el peso da un volumen de mosto y un nuevo lote por fracción.'],
  ['bleeding', 'Sangrado (saignée)', 'drop', 'k-bodega', 'Sangrar mosto de un depósito en maceración sin prensarlo: los litros van a otro depósito y el origen baja los mismos kg.'],
  ['racking', 'Trasiego', 'ops', 'k-ventas', 'Trasegar el vino de un depósito a otro, sin equipo de filtración (deja las lías).'],
  ['barrel_transfer', 'Trasiego a barricas', 'barrel', 'k-hospitalidad', 'Pasar el vino a barricas o sacarlo de ellas.'],
  ['filtration', 'Filtración', 'filter', 'k-equipo', 'Pasar el vino por un filtro para clarificarlo.'],
  ['decantation', 'Desfangado', 'decant', 'k-ventas', 'Separar el vino limpio de las lías por decantación, sin filtro.'],
  ['addition', 'Adiciones / Correcciones', 'lab', 'k-marketing', 'Registrar una adición o corrección (SO₂, bentonita, nutrientes…) en un depósito.'],
  ['topping', 'Rellenado', 'topup', 'k-huerta', 'Rellenar el depósito para reducir el espacio de cabeza y la oxidación.'],
  ['bulk_sale', 'Venta a granel', 'sale', 'k-admin', 'Salida de vino a granel: reduce las existencias del depósito sin crear un lote nuevo.'],
];
export const TYPE_LABEL = { ...Object.fromEntries(TYPES.map((t) => [t[0], t[1]])), blend: 'Coupage', bottling: 'Embotellado', adjustment: 'Conciliación de volumen' };
export const TYPE_ICON = { ...Object.fromEntries(TYPES.map((t) => [t[0], t[2]])), blend: 'blend', bottling: 'bottle', adjustment: 'balances' };
export const WINE = { tinto: 'Tinto', blanco: 'Blanco', rosado: 'Rosado', espumoso: 'Espumoso', base_blanco: 'Vino base blanco', base_rosado: 'Vino base rosado', naranja: 'Naranja', piquette: 'Piquette' };
export const WINE_COLOR = { tinto: '#7a1f2b', blanco: '#e3c24a', rosado: '#ec7fa8', espumoso: '#d6d3b0', base_blanco: '#e3c24a', base_rosado: '#ec7fa8', naranja: '#e8832a', piquette: '#cf8fb3' };
export const PHASE = { recepcion: 'Recepción', fermentacion: 'Fermentación', posfermentacion: 'Posfermentación', fml: 'Fermentación maloláctica', crianza: 'Crianza', preembotellado: 'Preembotellado' };
export const KIND = { tank: 'Depósito', foudre: 'Foudre / Tino', barrel: 'Barrica', bin: 'Bin', keg: 'Keg', amphora: 'Ánfora', egg: 'Huevo', tirage_cage: 'Jaula de tiraje', press: 'Prensa', carboy: 'Garrafón' };
export const MATERIAL = { stainless_steel: 'Acero inoxidable', concrete: 'Hormigón', oak: 'Roble / Madera', fiberglass: 'Fibra de vidrio', clay: 'Barro', chestnut: 'Castaño', acacia: 'Acacia', ceramic: 'Gres / Cerámica', glass: 'Vidrio', terracotta: 'Terracota', plastic: 'Plástico' };
export const VTYPE = { fermentation: 'Fermentación', storage: 'Almacenamiento', aging: 'Crianza' };
export const FRACTION = { free_run: 'Free run', press_1: 'Prensa 1', press_2: 'Prensa 2', press_3: 'Prensa 3', combined: 'Combinado', pomace: 'Orujo' };
export const CATEGORY = { yeast: 'Levadura', bacteria: 'Bacteria', enzyme: 'Enzima', fining: 'Clarificante', acid: 'Ácido', sulfite: 'Sulfito', tannin: 'Tanino', nutrient: 'Nutriente', oak: 'Producto de roble', sugar: 'Azúcar', concentrate: 'Mosto concentrado', juice: 'Zumo de uva', other: 'Otro' };
export const TASTING_PHASE = ['Fermentación', 'Posfermentación', 'Crianza', 'Antes del embotellado', 'Embotellado', 'General'];
export const GRAIN = { fine: 'Fino', medium: 'Medio', coarse: 'Grueso', mixed: 'Mixto' };
export const TOAST = { light: 'Ligero', medium_minus: 'Medio −', medium: 'Medio', medium_plus: 'Medio +', heavy: 'Fuerte' };
export const BARREL_STATUS = { available: 'Disponible', full: 'Llena', empty: 'Vacía', cleaning: 'En limpieza', maintenance: 'Mantenimiento', inactive: 'Inactiva' };
export const LOC_KIND = { building: 'Edificio', room: 'Sala', row: 'Fila', shelf: 'Estante' };
export const ROLE = { admin: 'Administrador', technician: 'Técnico', operator: 'Operario' };
export const AREA = { company: 'Toda la empresa', vineyard: 'Viñedo', winery: 'Bodega', both: 'Viñedo y bodega' };
export const PHEN = { A: 'A · Yema de invierno', B: 'B · Yema hinchada', C: 'C · Punta verde', D: 'D · Salida de hojas', E: 'E · Hojas extendidas', F: 'F · Racimos visibles', G: 'G · Racimos separados', H: 'H · Botones florales separados', I: 'I · Floración', J: 'J · Cuajado', K: 'K · Grano tamaño guisante', L: 'L · Cierre del racimo', M: 'M · Envero', N: 'N · Madurez' };
export const FIELD_OPS = { pruning: 'Poda', tying: 'Atado', green_pruning: 'Poda en verde', cluster_thinning: 'Aclareo de racimos', leaf_removal: 'Deshojado', cover_crop: 'Cubierta vegetal', trellising: 'Emparrado', shoot_thinning: 'Espergurado / Desbrote', grafting: 'Injerto', under_vine_tillage: 'Laboreo bajo cepa', canopy: 'Manejo de la vegetación', trellis_maintenance: 'Mantenimiento de espaldera', uprooting: 'Arranque', planting: 'Plantación', replanting: 'Reposición de marras', cane_shredding: 'Triturado de sarmientos', mowing: 'Siega', cover_sowing: 'Siembra de cubierta', inter_row_tillage: 'Laboreo entre filas', mech_weeding: 'Desherbado mecánico', topping: 'Despunte', bird_nets: 'Mallas antipájaros', frost_protection: 'Protección contra heladas', beneficials: 'Suelta de auxiliares', mating_disruption: 'Confusión sexual', irrigation: 'Riego' };
export const INPUT_TYPE = { pesticide: 'Fitosanitario', fertilizer: 'Fertilizante', biostimulant: 'Bioestimulante', adjuvant: 'Coadyuvante', other: 'Otro' };
export const SPRAY_METHOD = { ground: 'Terrestre', air: 'Aéreo', other: 'Otro' };
export const BOTTLE_STAGE = { filled: 'Llenado', labelled: 'Etiquetado', packed: 'Embalaje' };
export const BATCH_STATUS = { active: 'Activo', quarantine: 'Cuarentena', withdrawn: 'Retirado', discarded: 'Desechado', depleted: 'Agotado' };
export const SUGAR_UNIT = { brix: '°Brix', baume: '°Baumé', density: 'Densidad' };
export const opts = (map, sel, blank) => (blank ? `<option value="">${esc(blank)}</option>` : '') + Object.entries(map).map(([k, v]) => `<option value="${k}" ${String(k) === String(sel) ? 'selected' : ''}>${esc(v)}</option>`).join('');
export const formValues = (m) => Object.fromEntries($$('input,select,textarea', m).filter((i) => i.name).map((i) => [i.name, i.type === 'checkbox' ? i.checked : i.value]));
export const yearsOf = (rows, key) => [...new Set(rows.map((r) => (r[key] || '').slice(0, 4)).filter(Boolean).concat([today().slice(0, 4)]))].sort().reverse();

// ---------------------------------------------------------------- api
export async function api(path, o = {}) {
  const r = await fetch('/api' + path, { headers: { 'content-type': 'application/json' }, ...o, body: o.body ? JSON.stringify(o.body) : undefined });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Error ${r.status}`);
  return data;
}
export async function reload() { S.boot = await api('/bootstrap'); }
export function toast(msg, bad = false) { const t = $('#toast'); t.innerHTML = (bad ? ico('alert') : ico('check')) + esc(msg); t.className = 'toast' + (bad ? ' bad' : ''); t.hidden = false; clearTimeout(t._t); t._t = setTimeout(() => { t.hidden = true; }, bad ? 5200 : 2600); }
export const vessel = (id) => S.boot.vessels.find((v) => v.id === Number(id));
export const vesselByCode = (code) => S.boot.vessels.find((v) => v.code.toLowerCase() === String(code).toLowerCase());
export const lot = (id) => S.boot.lots.find((l) => l.id === Number(id));
export const activeLots = () => S.boot.lots.filter((l) => l.status === 'active');
export const go = (hash) => { if (location.hash === hash) window.dispatchEvent(new HashChangeEvent('hashchange')); else location.hash = hash; };
export const me = () => { const id = localStorage.getItem('ulula.operator'); return S.boot.users.find((u) => String(u.id) === id) || S.boot.users.find((u) => u.role === 'admin') || S.boot.users[0]; };
export const qs = (o) => { const p = new URLSearchParams(Object.fromEntries(Object.entries(o).filter(([, v]) => v !== '' && v != null))).toString(); return p ? '?' + p : ''; };

// ---------------------------------------------------------------- página
export function crumbs(group, ...parts) {
  const all = ['<a href="#/panel">Inicio</a>'].concat(group ? [esc(group)] : []).concat(parts);
  $('#crumbs').innerHTML = all.map((p, i, a) => i === a.length - 1 ? `<b>${p}</b>` : p).join(' <span>›</span> ');
}
export function head({ title, icon, sub, actions = '', k = '', eyebrow = '' }) {
  return `<div class="page-head ${k}"><div>${eyebrow ? `<div class="eyebrow">${esc(eyebrow)}</div>` : ''}<h1>${icon ? ico(icon) : ''}${esc(title)}</h1>${sub ? `<div class="sub">${sub}</div>` : ''}</div>${actions ? `<div class="actions">${actions}</div>` : ''}</div>`;
}
export const empty = (title, text, btn = '', icon = 'info') => `<div class="empty">${ico(icon)}<b>${esc(title)}</b>${esc(text)}${btn ? `<div class="cta">${btn}</div>` : ''}</div>`;
export const kpi = (l, v, s = '', k = '', unit = '') => `<div class="kpi ${k}"><div class="l">${esc(l)}</div><div class="v">${v}${unit ? `<small>${unit}</small>` : ''}</div>${s ? `<div class="s">${s}</div>` : ''}</div>`;
export function tabs(items, cur, base) { return `<div class="tabs">${items.map(([k, l, icon]) => `<a href="${base}${k ? '?tab=' + k : ''}" ${(cur || '') === k ? 'aria-current="page"' : ''}>${icon ? ico(icon) : ''}${esc(l)}</a>`).join('')}</div>`; }
export const bioPill = (b) => b ? `<span class="pill bio ${b.kind}" title="Día biodinámico: ${esc(b.label)}${b.constellation ? ' · ' + esc(b.constellation) : ''}">${ico('moon')}${esc(b.label)}</span>` : '';
export const lotPill = (code) => code ? `<span class="pill lot">${esc(code)}</span>` : '—';

// ---------------------------------------------------------------- modal (apilable: nivel 1 y 2)
export function closeModal(level = 1) { const w = $(level === 2 ? '#modal2' : '#modal'); w.classList.remove('open'); $('.modal', w).innerHTML = ''; }
export function modal(title, body, foot, { eyebrow = 'Bodega', level = 1, narrow = false } = {}) {
  const w = $(level === 2 ? '#modal2' : '#modal'); w.classList.add('open');
  const m = $('.modal', w); m.className = 'modal' + (narrow ? ' narrow' : '');
  m.innerHTML = `<div class="modal-head"><div><div class="eyebrow">${esc(eyebrow)}</div><h2>${esc(title)}</h2></div><button class="x" aria-label="Cerrar">${ico('x')}</button></div><div class="modal-body">${body}</div>${foot ? `<div class="modal-foot">${foot}</div>` : ''}`;
  $('.modal-head .x', w).onclick = () => closeModal(level); $('.scrim', w).onclick = () => closeModal(level);
  const c = $('[data-x=cancel]', m); if (c) c.onclick = () => closeModal(level);
  return m;
}
export function showError(m, msg) { const old = $('.alert.bad', m); if (old) old.remove(); $('.modal-body', m).insertAdjacentHTML('afterbegin', `<div class="alert bad">${ico('alert')}<span>${esc(msg)}</span></div>`); $('.modal-body', m).scrollTop = 0; }
// Formulario genérico: modal con campos, guarda por API y recarga.
export function formModal({ title, eyebrow, body, okLabel = 'Guardar', level = 1, narrow = false, onSave }) {
  const m = modal(title, body, `<button class="btn" data-x="cancel">Cancelar</button><button class="btn primary" data-x="ok">${esc(okLabel)}</button>`, { eyebrow, level, narrow });
  $('[data-x=ok]', m).onclick = async () => { const bs = $$('.modal-foot .btn', m); bs.forEach((b) => b.disabled = true); try { await onSave(formValues(m), m); } catch (e) { bs.forEach((b) => b.disabled = false); showError(m, e.message); } };
  return m;
}
export function confirmDialog(title, text, okLabel = 'Confirmar', danger = false) {
  return new Promise((res) => { const m = modal(title, `<p>${text}</p>`, `<button class="btn" data-x="cancel">Cancelar</button><button class="btn ${danger ? 'danger' : 'primary'}" data-x="ok">${esc(okLabel)}</button>`, { eyebrow: 'Confirmar', level: 2, narrow: true }); $('[data-x=cancel]', m).onclick = () => { closeModal(2); res(false); }; $('[data-x=ok]', m).onclick = () => { closeModal(2); res(true); }; $('.x', m).onclick = () => { closeModal(2); res(false); }; });
}

// ---------------------------------------------------------------- recipientes: selector y tarjeta
export const withWine = (v) => !!v.stay_id, isEmpty = (v) => !v.stay_id, isMaceration = (v) => v.stay_id && v.stay_unit === 'kg', isPress = (v) => v.kind === 'press', inWine = (v) => v.stay_id && v.stay_unit !== 'kg';
export const isBarrel = (v) => ['barrel', 'foudre'].includes(v.kind);
export function vesselLabel(v) { if (!v) return ''; return v.stay_id ? `${v.code} · ${v.lot_code} · ${fmtL(v.stay_volume, v.stay_unit)}` : `${v.code} · vacío`; }
const groupOf = (x) => ['tank', 'press'].includes(x.kind) ? 'inox' : isBarrel(x) ? 'barricas' : 'otros';
const GROUP_LABEL = { inox: 'Inox / depósitos', barricas: 'Barricas', otros: 'Otros' };
// Desplegable: búsqueda + chips + lista agrupada. filter(v) decide qué recipientes se ofrecen.
export function vesselPicker({ id, value, filter, placeholder = 'Depósito…', onPick, disabled = false }) {
  const v = value ? vessel(value) : null;
  const html = `<div class="vp" data-vp="${id}"><button type="button" class="${v ? '' : 'empty'}" ${disabled ? 'disabled' : ''}><span>${v ? esc(vesselLabel(v)) : esc(placeholder)}</span>${ico('down')}</button></div>`;
  setTimeout(() => {
    const root = $(`.vp[data-vp="${id}"]`); if (!root) return;
    const btn = $('button', root);
    btn.onclick = () => {
      if ($('.drop', root)) { $('.drop', root).remove(); return; }
      $$('.vp .drop').forEach((d) => d.remove());
      const drop = document.createElement('div'); drop.className = 'drop';
      let chip = 'todos', text = '';
      const list = () => {
        const q = text.toLowerCase();
        let vs = S.boot.vessels.filter((x) => x.is_active && filter(x));
        if (chip !== 'todos') vs = vs.filter((x) => groupOf(x) === chip);
        if (q) vs = vs.filter((x) => [x.code, x.lot_code, x.varieties, x.location_name].some((y) => (y || '').toLowerCase().includes(q)));
        const groups = ['inox', 'barricas', 'otros'].map((g) => [GROUP_LABEL[g], vs.filter((x) => groupOf(x) === g)]).filter((g) => g[1].length);
        $('.list', drop).innerHTML = groups.length ? groups.map(([g, xs]) => `<div class="gh">${g}</div>` + xs.map((x) => `<button type="button" class="opt ${String(x.id) === String(value) ? 'on' : ''}" data-id="${x.id}"><span><b>${esc(x.code)}</b> <small>${KIND[x.kind] || ''}${x.location_name ? ' · ' + esc(x.location_name) : ''}</small><br><small>${x.stay_id ? `${esc(x.lot_code)} · ${fmtL(x.stay_volume, x.stay_unit)}` : 'vacío'}${x.capacity_l ? ` · ${fmtN(Math.max(0, x.capacity_l - (x.stay_unit === 'kg' ? 0 : x.stay_volume || 0)))} L libres` : ''}</small></span><span class="mini"><i style="width:${x.capacity_l ? Math.min(100, Math.round(((x.stay_volume || 0) / x.capacity_l) * 100)) : 0}%"></i></span></button>`).join('')).join('') : '<div class="none">Sin recipientes que cumplan la condición.</div>';
        $$('.opt', drop).forEach((o) => o.onclick = () => { drop.remove(); onPick(+o.dataset.id); });
      };
      drop.innerHTML = `<input placeholder="Buscar por código, lote o ubicación…" autocomplete="off"><div class="chips">${[['todos', 'Todos'], ['inox', 'Inox / Depósitos'], ['barricas', 'Barricas'], ['otros', 'Otros']].map(([k, l]) => `<button type="button" data-c="${k}" aria-pressed="${k === chip}">${l}</button>`).join('')}</div><div class="list"></div>`;
      root.appendChild(drop);
      $('input', drop).oninput = (e) => { text = e.target.value; list(); };
      $$('.chips button', drop).forEach((c) => c.onclick = () => { chip = c.dataset.c; $$('.chips button', drop).forEach((x) => x.setAttribute('aria-pressed', x === c)); list(); });
      list(); $('input', drop).focus();
    };
  }, 0);
  return html;
}
document.addEventListener('click', (e) => { if (!e.target.closest('.vp')) $$('.vp .drop').forEach((d) => d.remove()); });
// Selección múltiple de barricas: modal apilado con búsqueda y casillas.
export function barrelPickerModal({ title = 'Seleccionar barricas', filter, selected = [], onPick }) {
  const sel = new Set(selected.map(Number)); let text = '';
  const m = modal(title, `<label class="search">${ico('search')}<input placeholder="Buscar barrica, lote o ubicación…" autocomplete="off"></label><div class="between" style="margin:10px 0 6px"><span class="small muted"><b id="bpn">${sel.size}</b> seleccionadas</span><span><button type="button" class="linkish" data-all>Seleccionar todas</button> · <button type="button" class="linkish" data-none>Ninguna</button></span></div><div class="picklist" id="bpl"></div>`,
    `<button class="btn" data-x="cancel">Cancelar</button><button class="btn primary" data-x="ok">Añadir selección</button>`, { eyebrow: 'Barricas', level: 2 });
  const list = () => {
    const q = text.toLowerCase();
    const vs = S.boot.vessels.filter((x) => x.is_active && filter(x) && (!q || [x.code, x.lot_code, x.location_name].some((y) => (y || '').toLowerCase().includes(q))));
    $('#bpl', m).innerHTML = vs.length ? vs.map((x) => `<label class="${sel.has(x.id) ? 'on' : ''}"><input type="checkbox" data-id="${x.id}" ${sel.has(x.id) ? 'checked' : ''}><b>${esc(x.code)}</b><span class="small muted">${x.stay_id ? `${esc(x.lot_code)} · ${fmtL(x.stay_volume, x.stay_unit)}` : 'vacía'}</span><small>${fmtN(x.capacity_l)} L${x.location_name ? ' · ' + esc(x.location_name) : ''}</small></label>`).join('') : '<div class="muted" style="padding:12px">Ninguna barrica cumple la condición.</div>';
    $$('input[type=checkbox]', m).forEach((c) => c.onchange = () => { const id = +c.dataset.id; if (c.checked) sel.add(id); else sel.delete(id); c.closest('label').classList.toggle('on', c.checked); $('#bpn', m).textContent = sel.size; });
    m._vs = vs;
  };
  $('.search input', m).oninput = (e) => { text = e.target.value; list(); };
  $('[data-all]', m).onclick = () => { m._vs.forEach((x) => sel.add(x.id)); list(); $('#bpn', m).textContent = sel.size; };
  $('[data-none]', m).onclick = () => { sel.clear(); list(); $('#bpn', m).textContent = 0; };
  $('[data-x=ok]', m).onclick = () => { closeModal(2); onPick([...sel]); };
  list();
}
export function vcard(v, delta) {
  if (!v) return '';
  const cur = v.stay_volume || 0, cap = v.capacity_l || 0, unit = v.stay_unit || 'L';
  const after = Math.round((cur + delta) * 10) / 10;
  const pct = cap ? Math.min(100, Math.round((cur / cap) * 100)) : 0;
  const over = cap && unit !== 'kg' && after > cap * 1.02 + 0.5, under = after < -0.01;
  return `<div class="vcard"><div class="top"><b>${esc(v.code)}</b><span class="pill ${v.stay_id ? 'ok' : ''}">${v.stay_id ? (unit === 'kg' ? 'Contiene uva' : 'Contiene vino') : 'Vacío'}</span></div><div class="bar"><i style="width:${pct}%"></i></div>
    <div class="kv"><span>${fmtL(cur, unit)}</span><span>Capacidad: <b>${fmtN(cap)} L</b></span></div>
    ${v.stay_id ? `<div class="kv"><span>Lote</span><b>${esc(v.lot_code)}</b></div>` : ''}<div class="kv"><span>Libre</span><b>${fmtN(Math.max(0, cap - (unit === 'kg' ? 0 : cur)))} L</b></div>
    <div class="kv"><span>Tras la operación</span><span class="after ${over || under ? 'bad' : ''}">${fmtL(after, unit)}${cap && unit !== 'kg' ? ` (${fmtN(Math.max(0, cap - after))} L libres)` : ''}${over ? ' · no cabe' : ''}${under ? ' · no alcanza' : ''}</span></div></div>`;
}

// ---------------------------------------------------------------- ilustraciones de recipientes (barricas tumbadas, fudres de frente con puerta, depósitos con patas, ánforas y huevos con su forma)
const SHAPES = {
  tank: { w: 72, h: 120, body: 'M14 14 Q14 6 36 6 Q58 6 58 14 V88 L46 104 H26 L14 88 Z', extra: '<path d="M20 104v10M52 104v10M36 104v8" stroke="#6b7378" stroke-width="3.5" stroke-linecap="round"/><path d="M14 30h44M14 72h44" stroke="rgba(0,0,0,.12)" stroke-width="1.5"/><rect x="31" y="2" width="10" height="6" rx="2" fill="#8a9398"/>', fill: 'url(#g-steel)', top: 6, bottom: 104, label: 52 },
  barrel: { w: 100, h: 62, body: 'M10 14 Q50 2 90 14 Q96 31 90 48 Q50 60 10 48 Q4 31 10 14 Z', extra: '<path d="M26 6.5v49M74 6.5v49M50 4v54" stroke="rgba(60,30,10,.45)" stroke-width="3"/><ellipse cx="50" cy="31" rx="5" ry="5" fill="none" stroke="rgba(60,30,10,.45)" stroke-width="2"/>', fill: 'url(#g-wood)', top: 4, bottom: 58, label: 35 },
  foudre: { w: 90, h: 90, body: 'M45 6 Q84 6 84 45 Q84 84 45 84 Q6 84 6 45 Q6 6 45 6 Z', extra: '<circle cx="45" cy="45" r="39" fill="none" stroke="rgba(60,30,10,.4)" stroke-width="3"/><rect x="36" y="56" width="18" height="22" rx="3" fill="rgba(60,30,10,.35)" stroke="rgba(60,30,10,.6)" stroke-width="1.5"/><circle cx="45" cy="30" r="4" fill="rgba(60,30,10,.4)"/><path d="M6 45h78" stroke="rgba(60,30,10,.25)" stroke-width="2"/>', fill: 'url(#g-wood)', top: 6, bottom: 84, label: 45 },
  amphora: { w: 72, h: 100, body: 'M26 6 h20 v8 q16 4 16 30 q0 30 -26 44 q-26 -14 -26 -44 q0 -26 16 -30 z', extra: '<path d="M26 14h20" stroke="rgba(0,0,0,.25)" stroke-width="2"/><ellipse cx="36" cy="92" rx="12" ry="4" fill="rgba(0,0,0,.25)"/>', fill: 'url(#g-clay)', top: 6, bottom: 88, label: 50 },
  egg: { w: 72, h: 100, body: 'M36 6 q26 4 26 40 q0 36 -26 46 q-26 -10 -26 -46 q0 -36 26 -40 z', extra: '<path d="M18 94h36" stroke="rgba(0,0,0,.3)" stroke-width="3" stroke-linecap="round"/>', fill: 'url(#g-clay)', top: 6, bottom: 92, label: 52 },
  carboy: { w: 72, h: 100, body: 'M28 6 h16 v12 l10 8 v62 a5 5 0 0 1 -5 5 h-26 a5 5 0 0 1 -5 -5 v-62 l10 -8 z', extra: '<rect x="27" y="2" width="18" height="6" rx="2" fill="#8a9398"/>', fill: 'url(#g-glass)', top: 6, bottom: 93, label: 56 },
  press: { w: 100, h: 90, body: 'M10 30 h80 v36 a10 10 0 0 1 -10 10 h-60 a10 10 0 0 1 -10 -10 z', extra: '<rect x="44" y="6" width="12" height="24" rx="3" fill="#8a9398"/><path d="M20 76v10M80 76v10" stroke="#6b7378" stroke-width="4" stroke-linecap="round"/><path d="M10 48h80" stroke="rgba(0,0,0,.15)" stroke-width="2"/>', fill: 'url(#g-steel)', top: 30, bottom: 76, label: 52 },
};
SHAPES.bin = { ...SHAPES.press, body: 'M14 20 h72 l-6 60 a6 6 0 0 1 -6 6 h-48 a6 6 0 0 1 -6 -6 z', extra: '<path d="M14 20h72" stroke="rgba(0,0,0,.2)" stroke-width="2"/>', top: 20, bottom: 86, label: 54, fill: 'url(#g-steel)' };
SHAPES.keg = { ...SHAPES.tank, w: 72, h: 100, body: 'M16 10 a20 6 0 0 1 40 0 v70 a20 6 0 0 1 -40 0 z', extra: '<path d="M16 30h40M16 60h40" stroke="rgba(0,0,0,.18)" stroke-width="2"/><path d="M24 86v8M48 86v8" stroke="#6b7378" stroke-width="3.5" stroke-linecap="round"/>', top: 4, bottom: 86, label: 48 };
SHAPES.tirage_cage = { ...SHAPES.bin, fill: 'url(#g-steel)' };
export function vesselSvg(v, pct, color) {
  const sh = SHAPES[v.kind] || SHAPES.tank; const id = 'c' + v.id; const fill = color || '#9a9a9a';
  const y = sh.bottom - ((sh.bottom - sh.top) * Math.min(100, pct || 0)) / 100;
  return `<svg class="vs vs-${v.kind}" viewBox="0 0 ${sh.w} ${sh.h}"><defs><clipPath id="${id}"><path d="${sh.body}"/></clipPath></defs><path d="${sh.body}" fill="${sh.fill}" stroke="rgba(0,0,0,.4)" stroke-width="1.5"/><g clip-path="url(#${id})">${pct > 0 ? `<rect x="0" y="${y}" width="${sh.w}" height="${sh.h - y}" fill="${fill}" opacity=".92"/><rect x="0" y="${y}" width="${sh.w}" height="2" fill="rgba(255,255,255,.5)"/>` : ''}<rect x="${sh.w * 0.16}" y="0" width="${sh.w * 0.1}" height="${sh.h}" fill="rgba(255,255,255,.22)" rx="4"/></g>${sh.extra}<text x="${sh.w / 2}" y="${sh.label}" text-anchor="middle" font-size="${sh.w >= 90 ? 12 : 11}" font-weight="700" fill="#1f2426" style="font-family:var(--f-mono);paint-order:stroke;stroke:rgba(255,255,255,.75);stroke-width:3px">${esc(v.code)}</text></svg>`;
}
export const SVG_DEFS = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
  <linearGradient id="g-steel" x1="0" x2="1"><stop offset="0" stop-color="#9aa3a8"/><stop offset=".35" stop-color="#e9edef"/><stop offset=".6" stop-color="#c3cacd"/><stop offset="1" stop-color="#8a9398"/></linearGradient>
  <linearGradient id="g-wood" x1="0" x2="1"><stop offset="0" stop-color="#8a5a2b"/><stop offset=".4" stop-color="#c58a4c"/><stop offset=".7" stop-color="#a86f36"/><stop offset="1" stop-color="#7a4b22"/></linearGradient>
  <linearGradient id="g-clay" x1="0" x2="1"><stop offset="0" stop-color="#a86f52"/><stop offset=".45" stop-color="#d9a98a"/><stop offset="1" stop-color="#9b5f43"/></linearGradient>
  <linearGradient id="g-glass" x1="0" x2="1"><stop offset="0" stop-color="#b9d6cf"/><stop offset=".4" stop-color="#eef7f4"/><stop offset="1" stop-color="#9fbfb7"/></linearGradient>
</defs></svg>`;

// ---------------------------------------------------------------- gráficos SVG (sin dependencias)
export function barChart(rows, { label, value, k = '', h = 180, fmt = (n) => fmtN(n) } = {}) {
  if (!rows.length) return '<div class="muted">Sin datos.</div>';
  const W = 600, pad = { l: 36, r: 8, t: 14, b: 30 }, max = Math.max(1, ...rows.map(value));
  const bw = (W - pad.l - pad.r) / rows.length, iw = Math.min(46, bw * 0.68);
  const ticks = 4;
  return `<svg class="chart ${k}" viewBox="0 0 ${W} ${h}" role="img">${[...Array(ticks + 1)].map((_, i) => { const y = pad.t + ((h - pad.t - pad.b) * i) / ticks; const val = max - (max * i) / ticks; return `<line class="grid" x1="${pad.l}" x2="${W - pad.r}" y1="${y}" y2="${y}"/><text x="${pad.l - 6}" y="${y + 4}" text-anchor="end">${fmt(Math.round(val))}</text>`; }).join('')}
    ${rows.map((r, i) => { const v = value(r); const bh = ((h - pad.t - pad.b) * v) / max; const x = pad.l + bw * i + (bw - iw) / 2; const y = h - pad.b - bh; return `<rect class="bar" x="${x}" y="${y}" width="${iw}" height="${bh}" rx="4"><title>${esc(label(r))}: ${fmt(v)}</title></rect><text x="${x + iw / 2}" y="${h - pad.b + 14}" text-anchor="middle">${esc(String(label(r)).slice(0, 9))}</text>`; }).join('')}</svg>`;
}
export function lineChart(series, { h = 200, k = '', xLabel = (p) => p.x, yFmt = (n) => fmtN(n, 1), ymin, ymax } = {}) {
  const pts = series.flatMap((s) => s.points); if (!pts.length) return '<div class="muted">Sin datos.</div>';
  const W = 600, pad = { l: 40, r: 10, t: 12, b: 26 };
  const xs = pts.map((p) => p.t), ys = pts.map((p) => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs) || x0 + 1, y0 = ymin ?? Math.min(...ys), y1 = ymax ?? Math.max(...ys);
  const sx = (t) => pad.l + ((t - x0) / Math.max(1, x1 - x0)) * (W - pad.l - pad.r), sy = (y) => pad.t + (1 - (y - y0) / Math.max(0.001, y1 - y0)) * (h - pad.t - pad.b);
  const ticks = 4;
  return `<svg class="chart ${k}" viewBox="0 0 ${W} ${h}" role="img">${[...Array(ticks + 1)].map((_, i) => { const y = pad.t + ((h - pad.t - pad.b) * i) / ticks; const val = y1 - ((y1 - y0) * i) / ticks; return `<line class="grid" x1="${pad.l}" x2="${W - pad.r}" y1="${y}" y2="${y}"/><text x="${pad.l - 6}" y="${y + 4}" text-anchor="end">${yFmt(val)}</text>`; }).join('')}
    ${series.map((s) => { const ps = s.points.slice().sort((a, b) => a.t - b.t); const d = ps.map((p, i) => `${i ? 'L' : 'M'}${sx(p.t).toFixed(1)} ${sy(p.y).toFixed(1)}`).join(' '); const area = `${d} L${sx(ps[ps.length - 1].t).toFixed(1)} ${h - pad.b} L${sx(ps[0].t).toFixed(1)} ${h - pad.b} Z`; return `<g style="--k:${s.color || 'var(--accent)'}"><path class="area" d="${area}"/><path class="line" d="${d}"/>${ps.map((p) => `<circle class="dot" cx="${sx(p.t).toFixed(1)}" cy="${sy(p.y).toFixed(1)}" r="3.2"><title>${esc(s.name || '')} ${esc(xLabel(p))}: ${yFmt(p.y)}</title></circle>`).join('')}</g>`; }).join('')}
    ${[pts[0], pts[pts.length - 1]].map((p, i) => `<text x="${i ? W - pad.r : pad.l}" y="${h - 8}" text-anchor="${i ? 'end' : 'start'}">${esc(xLabel(p))}</text>`).join('')}</svg>`;
}
export function sparkline(values, k = '') { if (values.length < 2) return ''; const W = 70, H = 26, max = Math.max(...values), min = Math.min(...values); const d = values.map((v, i) => `${i ? 'L' : 'M'}${(i / (values.length - 1)) * W} ${H - 2 - ((v - min) / Math.max(0.001, max - min)) * (H - 4)}`).join(' '); return `<svg class="spark ${k}" viewBox="0 0 ${W} ${H}"><path d="${d}" fill="none" stroke="var(--k, var(--accent))" stroke-width="2" stroke-linejoin="round"/></svg>`; }
export function ring(pct, label = '', k = '') { const r = 50, c = 2 * Math.PI * r; return `<div class="ring ${k}"><svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="${r}" fill="none" stroke="var(--rule)" stroke-width="12"/><circle cx="60" cy="60" r="${r}" fill="none" stroke="var(--k, var(--accent))" stroke-width="12" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - Math.min(1, pct / 100))}"/></svg><div class="c"><div>${Math.round(pct)}%${label ? `<small>${esc(label)}</small>` : ''}</div></div></div>`; }
export function hbars(rows, lab, key = 'n', k = '') { const max = Math.max(1, ...rows.map((r) => r[key])); return rows.length ? `<div class="bars ${k}">${rows.map((r) => `<div class="b"><span>${esc(lab(r))}</span><i style="width:${(r[key] / max) * 100}%"></i><span class="n">${fmtN(r[key])}</span></div>`).join('')}</div>` : '<div class="muted">Sin datos.</div>'; }

// ---------------------------------------------------------------- CSV
export function parseCsv(text, map = {}) {
  const sep = text.split('\n')[0].includes(';') ? ';' : text.split('\n')[0].includes('\t') ? '\t' : ',';
  const lines = text.replace(/\r/g, '').split('\n').filter((l) => l.trim());
  const headRow = lines.shift().split(sep).map((h) => h.trim().toLowerCase().replace(/^"|"$/g, ''));
  return lines.map((l) => { const cells = l.split(sep).map((c) => c.trim().replace(/^"|"$/g, '')); const o = {}; headRow.forEach((h, i) => { const k = map[h] || h.replace(/[^a-z0-9_]/g, '_'); if (k) o[k] = cells[i] ?? ''; }); return o; });
}
export function downloadCsv(name, rows, cols) { const esc2 = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }; const csv = [cols.map((c) => c[1]).join(',')].concat(rows.map((r) => cols.map((c) => esc2(typeof c[0] === 'function' ? c[0](r) : r[c[0]])).join(','))).join('\n'); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' })); a.download = name; a.click(); }
export function importModal({ title, help, map, preview, onImport, template }) {
  const m = modal(title, `<div class="alert info">${ico('info')}<span>${help}</span></div>${template ? `<p class="small" style="margin-bottom:10px"><button type="button" class="linkish" data-tpl>Descargar plantilla CSV</button></p>` : ''}<input type="file" accept=".csv,.txt,text/csv" id="csvf"><div id="csvp" style="margin-top:12px"></div>`, `<button class="btn" data-x="cancel">Cancelar</button><button class="btn primary" data-x="ok" disabled>Importar</button>`, { eyebrow: 'Importar' });
  let rows = [];
  if (template) $('[data-tpl]', m).onclick = () => downloadCsv(template.name, template.rows, template.cols);
  $('#csvf', m).onchange = async (e) => { const f = e.target.files[0]; if (!f) return; rows = parseCsv(await f.text(), map); $('#csvp', m).innerHTML = `<b>${rows.length} líneas detectadas</b>` + preview(rows); $('[data-x=ok]', m).disabled = !rows.length; };
  $('[data-x=ok]', m).onclick = async () => { try { await onImport(rows); closeModal(); } catch (e) { showError(m, e.message); } };
}
