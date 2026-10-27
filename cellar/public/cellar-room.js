// Cellar section (Wines → Cellar): wines that are barreled down or bottle-aging, the barrel registry
// (what is in every barrel, where it sits), the barrel-room map, QR/NFC tags and the inventory import.
// Rendered into #cellarView when the page dispatches "cellar:render". Data lives in the app database:
//   barrels     one doc per barrel (id = code)         {code,size,cooperage,wood,toast,year,lot,vol,fill,loc,notes,by,at}
//   barrel_map  doc "main": zones → rows → slots × levels (standard locations, e.g. A-1-3-2 = zone A, row 1, slot 3, level 2)
//   barrel_log  one doc per event                       {code,at,by,kind,text}
(function () {
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const api = async (path, method, body) => {
    const r = await fetch('/api/db/' + path, { method: method || 'GET', headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.message || 'Error ' + r.status); return j;
  };
  const GCOL = { red: '#7a1f2b', rose: '#e0849a', white: '#d8b43c', orange: '#d9822b', sparkling: '#7fa7b8' };
  const FILL = { full: 'Llena', partial: 'Parcial', empty: 'Vacía' };
  const WOOD = ['', 'Francesa', 'Americana', 'Húngara', 'Otra'];
  const fmtD = iso => iso ? new Date(iso).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: '2-digit' }) : '';
  const codeOf = v => String(v == null ? '' : v).replace(/\D/g, '').replace(/^0+(?=\d)/, '');
  const DEFAULT_MAP = { zones: [{ id: 'A', name: 'Sala de barricas', rows: [{ id: '1', name: 'Fila 1', slots: 8, levels: 2 }, { id: '2', name: 'Fila 2', slots: 8, levels: 2 }, { id: '3', name: 'Fila 3', slots: 8, levels: 2 }] }] };

  const C = { root: null, lots: [], all: [], canWrite: false, vintage: 2026, vintageOf: () => 2026, phaseOf: () => 'prod', barrels: [], map: null, tab: 'wines', vint: 'all', q: '', filter: 'all', me: '', loaded: false, group: 'loc', sheetTabs: {} };

  // ---------- data ----------
  async function load() {
    const [b, m, me] = await Promise.all([api('barrels'), api('barrel_map').catch(() => ({ rows: [] })), fetch('/api/me').then(r => r.json()).catch(() => ({}))]);
    C.barrels = (b.rows || []).map(r => Object.assign({ id: r.id }, r.data)).sort((x, y) => (+x.code || 0) - (+y.code || 0));
    const md = (m.rows || []).find(r => r.id === 'main'); C.map = md ? md.data : null;
    C.me = me.initials || ''; C.loaded = true;
  }
  const lotById = id => C.all.find(l => l.id === id);
  const lotName = id => { const l = lotById(id); return l ? l.name : (id || ''); };
  const lotGroup = id => { const l = lotById(id); return l ? l.group : ''; };
  const barrelsOf = lot => C.barrels.filter(b => b.lot === lot.id);
  const vintOK = l => C.vint === 'all' || (C.vint === 'old' ? C.vintageOf(l) < C.vintage - 2 : C.vintageOf(l) === +C.vint);
  const locLabel = loc => {
    if (!loc) return '';
    const [z, r, s, lv] = String(loc).split('-'); const zone = (C.map || DEFAULT_MAP).zones.find(x => x.id === z);
    const row = zone && (zone.rows || []).find(x => x.id === r);
    return (zone ? zone.name : 'Zona ' + z) + ' · ' + (row ? row.name : 'Fila ' + r) + ' · Pos ' + s + (lv ? (lv === '1' ? ' · abajo' : lv === '2' ? ' · arriba' : ' · nivel ' + lv) : '');
  };
  const atLoc = loc => C.barrels.find(b => b.loc === loc);
  async function logEvent(code, kind, text) {
    const at = new Date().toISOString();
    await api('barrel_log/' + encodeURIComponent('b' + code + '-' + Date.now().toString(36)), 'PUT', { code: String(code), at, by: C.me, kind, text }).catch(() => {});
  }

  // ---------- shell ----------
  function render() {
    if (!C.root) return;
    if (!C.loaded) { C.root.innerHTML = '<div class="cr-empty">Cargando bodega…</div>'; return; }
    const vints = [...new Set(C.all.map(l => C.vintageOf(l)))].sort((a, b) => b - a);
    const chips = [['all', 'Todas']].concat(vints.filter(v => v >= C.vintage - 2).map(v => [String(v), String(v)])).concat(vints.some(v => v < C.vintage - 2) ? [['old', 'Anteriores']] : []);
    const nB = C.barrels.length, nL = C.lots.length;
    C.root.innerHTML = `<div class="cr">
      <div class="cr-tabs" role="tablist">
        <button type="button" role="tab" data-ct="wines" aria-selected="${C.tab === 'wines'}">Por vino <small>${nL}</small></button>
        <button type="button" role="tab" data-ct="barrels" aria-selected="${C.tab === 'barrels'}">Barricas <small>${nB}</small></button>
        <button type="button" role="tab" data-ct="map" aria-selected="${C.tab === 'map'}">Mapa</button>
      </div>
      <div class="cr-bar">
        <div class="seg cr-vint" role="group" aria-label="Añada">${chips.map(([k, l]) => `<button type="button" data-cv="${k}" aria-pressed="${C.vint === k}">${l}</button>`).join('')}</div>
        <input type="search" class="search cr-q" placeholder="${C.tab === 'wines' ? 'Buscar vino, lote o barrica' : 'Buscar barrica, vino, ubicación'}" value="${esc(C.q)}" aria-label="Buscar">
        <div class="cr-acts">
          ${C.canWrite ? `<button type="button" class="btn primary" data-ca="new">+ Barrica</button><button type="button" class="btn" data-ca="import">Importar</button>` : ''}
          <button type="button" class="btn" data-ca="labels">Etiquetas QR</button>
          ${C.canWrite ? `<button type="button" class="btn" data-ca="mapcfg" title="Zonas, filas y posiciones">Configurar mapa</button>` : ''}
        </div>
      </div>
      <div class="cr-body" id="crBody"></div>
    </div>`;
    const body = $('#crBody', C.root);
    body.innerHTML = C.tab === 'wines' ? renderWines() : C.tab === 'barrels' ? renderBarrels() : renderMap();
  }

  // ---------- Por vino ----------
  function renderWines() {
    const q = C.q.trim().toLowerCase();
    const lots = C.lots.filter(vintOK).filter(l => !q || (l.name + ' ' + (l.code || '') + ' ' + (l.ubi || '') + ' ' + barrelsOf(l).map(b => b.code).join(' ')).toLowerCase().includes(q));
    if (!lots.length) return `<div class="cr-empty"><strong>No hay vinos en la cava${C.vint !== 'all' ? ' de esa añada' : ''}.</strong>Abre la ficha de un vino en Production y toca «→ Cellar» cuando esté en barrica o en botella.</div>`;
    const groups = [['red', 'Tintos'], ['rose', 'Rosados'], ['white', 'Blancos'], ['orange', 'Naranjas y piel'], ['sparkling', 'Espumosos']];
    let h = '';
    for (const [g, gl] of groups) {
      const ls = lots.filter(l => l.group === g); if (!ls.length) continue;
      h += `<h3 class="cr-gh" style="--c:${GCOL[g]}">${gl} <small>${ls.length}</small></h3><div class="cr-cards">` + ls.map(l => {
        const bs = barrelsOf(l), litros = bs.reduce((s, b) => s + (+b.vol || 0), 0);
        return `<article class="cr-wine" style="--c:${GCOL[l.group] || '#999'}" data-lot="${esc(l.id)}">
          <header><b>${esc(l.name)}</b><span class="cr-vt">${C.vintageOf(l)}</span></header>
          <div class="cr-sub">${esc([l.code, l.ubi].filter(Boolean).join(' · '))}</div>
          <div class="cr-bbls">${bs.length ? bs.map(b => `<button type="button" class="cr-chip" data-bb="${esc(b.id)}" style="--c:${GCOL[l.group] || '#999'}"><b>${esc(b.code)}</b>${b.loc ? `<small>${esc(b.loc)}</small>` : ''}${b.fill === 'partial' ? '<i title="Parcial">½</i>' : ''}</button>`).join('') : `<span class="cr-none">Sin barricas registradas</span>`}</div>
          <div class="cr-meta">${bs.length ? `${bs.length} barrica${bs.length > 1 ? 's' : ''}${litros ? ' · ' + litros.toLocaleString('es-MX') + ' L' : ''}` : ''}</div>
          <div class="cr-row"><button type="button" class="btn sm" data-open="${esc(l.id)}">Ficha del vino</button>${C.canWrite ? `<button type="button" class="btn sm" data-ca="new" data-lot="${esc(l.id)}">+ Barrica</button><button type="button" class="btn sm ghost" data-phase="prod" data-lot="${esc(l.id)}">→ Production</button>` : ''}</div>
        </article>`;
      }).join('') + '</div>';
    }
    return h;
  }

  // ---------- Barricas ----------
  function renderBarrels() {
    const q = C.q.trim().toLowerCase();
    let bs = C.barrels.filter(b => !q || (b.code + ' ' + lotName(b.lot) + ' ' + (b.loc || '') + ' ' + locLabel(b.loc) + ' ' + (b.cooperage || '') + ' ' + (b.notes || '')).toLowerCase().includes(q));
    if (C.vint !== 'all') bs = bs.filter(b => { const l = lotById(b.lot); return l ? vintOK(l) : false; });
    if (C.filter !== 'all') bs = bs.filter(b => C.filter === 'noloc' ? !b.loc : (b.fill || (b.lot ? 'full' : 'empty')) === C.filter);
    const counts = { all: C.barrels.length, full: C.barrels.filter(b => (b.fill || (b.lot ? 'full' : 'empty')) === 'full').length, partial: C.barrels.filter(b => b.fill === 'partial').length, empty: C.barrels.filter(b => (b.fill || (b.lot ? 'full' : 'empty')) === 'empty').length, noloc: C.barrels.filter(b => !b.loc).length };
    const fchips = [['all', 'Todas'], ['full', 'Llenas'], ['partial', 'Parciales'], ['empty', 'Vacías'], ['noloc', 'Sin ubicación']].map(([k, l]) => `<button type="button" data-cf="${k}" aria-pressed="${C.filter === k}">${l} <small>${counts[k]}</small></button>`).join('');
    const gsel = `<label class="cr-group">Agrupar <select data-cg><option value="loc"${C.group === 'loc' ? ' selected' : ''}>por ubicación</option><option value="wine"${C.group === 'wine' ? ' selected' : ''}>por vino</option><option value="none"${C.group === 'none' ? ' selected' : ''}>sin agrupar</option></select></label>`;
    let h = `<div class="seg cr-f">${fchips}</div><div class="cr-grouprow">${gsel}</div>`;
    if (!C.barrels.length) return h + `<div class="cr-empty"><strong>Todavía no hay barricas registradas.</strong>Usa «Importar» para pegar el inventario de barricas desde Excel, o «+ Barrica» para capturar una por una.</div>`;
    if (!bs.length) return h + `<div class="cr-empty">Ninguna barrica coincide.</div>`;
    const card = b => {
      const g = lotGroup(b.lot), fill = b.fill || (b.lot ? 'full' : 'empty');
      return `<article class="cr-bbl ${fill}" data-bb="${esc(b.id)}" style="--c:${GCOL[g] || '#9aa5b1'}">
        <div class="cr-code"><small>BBL</small><b>${esc(b.code)}</b></div>
        <div class="cr-bmain"><b>${b.lot ? esc(lotName(b.lot)) : '<span class="cr-none">Vacía</span>'}</b>
          <div class="cr-sub">${[b.vol ? b.vol + ' L' : '', b.size ? b.size + ' L' : '', FILL[fill]].filter(Boolean).join(' · ')}${b.lot && lotById(b.lot) ? ' · ' + C.vintageOf(lotById(b.lot)) : ''}</div>
          <div class="cr-sub">${b.loc ? '<span class="cr-loc">' + esc(b.loc) + '</span> ' + esc(locLabel(b.loc)) : '<span class="cr-none">Sin ubicación</span>'}</div>
          ${b.cooperage || b.year ? `<div class="cr-sub cr-dim">${esc([b.cooperage, b.wood, b.toast ? 'tostado ' + b.toast : '', b.year].filter(Boolean).join(' · '))}</div>` : ''}
        </div></article>`;
    };
    if (C.group === 'none') return h + `<div class="cr-cards">${bs.map(card).join('')}</div>`;
    const key = b => C.group === 'wine' ? (b.lot ? lotName(b.lot) : 'Vacías') : (b.loc ? locLabel(b.loc).split(' · ').slice(0, 2).join(' · ') : 'Sin ubicación');
    const by = new Map(); for (const b of bs) { const k = key(b); if (!by.has(k)) by.set(k, []); by.get(k).push(b); }
    const keys = [...by.keys()].sort((a, b) => (a.startsWith('Sin') || a === 'Vacías') - (b.startsWith('Sin') || b === 'Vacías') || a.localeCompare(b, 'es', { numeric: true }));
    for (const k of keys) h += `<h3 class="cr-gh">${esc(k)} <small>${by.get(k).length}</small></h3><div class="cr-cards">${by.get(k).map(card).join('')}</div>`;
    return h;
  }

  // ---------- Mapa ----------
  function renderMap() {
    const map = C.map || DEFAULT_MAP;
    const legend = Object.entries(GCOL).map(([g, c]) => `<span><i style="background:${c}"></i>${{ red: 'Tinto', rose: 'Rosado', white: 'Blanco', orange: 'Naranja', sparkling: 'Espumoso' }[g]}</span>`).join('') + '<span><i style="background:#c9ced3"></i>Vacía</span><span><i class="dash"></i>Libre</span>';
    let h = `<div class="cr-legend">${legend}${!C.map ? '<em>Plano de ejemplo: ajústalo en «Configurar mapa».</em>' : ''}</div>`;
    for (const z of map.zones || []) {
      h += `<section class="cr-zone"><h3 class="cr-gh">${esc(z.name || 'Zona ' + z.id)} <small>${C.barrels.filter(b => (b.loc || '').startsWith(z.id + '-')).length} barricas</small></h3>`;
      for (const r of z.rows || []) {
        const slots = +r.slots || 1, levels = +r.levels || 1;
        h += `<div class="cr-rowmap"><div class="cr-rowlab">${esc(r.name || 'Fila ' + r.id)}</div><div class="cr-grid" style="--n:${slots}">`;
        for (let lv = levels; lv >= 1; lv--) for (let s = 1; s <= slots; s++) {
          const loc = `${z.id}-${r.id}-${s}-${lv}`, b = atLoc(loc);
          if (b) { const g = lotGroup(b.lot); h += `<button type="button" class="cr-cell has ${b.fill === 'partial' ? 'half' : ''}" data-bb="${esc(b.id)}" style="--c:${b.lot ? (GCOL[g] || '#999') : '#c9ced3'}" title="${esc(b.code + ' · ' + (lotName(b.lot) || 'vacía') + ' · ' + locLabel(loc))}"><b>${esc(b.code)}</b><small>${esc((lotName(b.lot) || 'vacía').slice(0, 14))}</small></button>`; }
          else h += `<button type="button" class="cr-cell free" data-loc="${loc}" title="${esc(locLabel(loc))}"${C.canWrite ? '' : ' disabled'}><small>${s}${levels > 1 ? (lv === 1 ? '↓' : '↑') : ''}</small></button>`;
        }
        h += `</div></div>`;
      }
      h += `</section>`;
    }
    const unplaced = C.barrels.filter(b => !b.loc);
    if (unplaced.length) h += `<h3 class="cr-gh">Sin ubicación <small>${unplaced.length}</small></h3><div class="cr-chips">${unplaced.map(b => `<button type="button" class="cr-chip" data-bb="${esc(b.id)}" style="--c:${GCOL[lotGroup(b.lot)] || '#999'}"><b>${esc(b.code)}</b><small>${esc(lotName(b.lot) || 'vacía')}</small></button>`).join('')}</div>`;
    return h;
  }

  // ---------- Barrel sheet ----------
  function sheet(html, cls) {
    let d = $('#crSheet'); if (!d) { d = document.createElement('dialog'); d.id = 'crSheet'; d.className = 'cr-sheet'; document.body.appendChild(d); d.addEventListener('click', e => { if (e.target === d) d.close(); }); }
    d.className = 'cr-sheet ' + (cls || ''); d.innerHTML = html; if (!d.open) d.showModal(); return d;
  }
  const locSelects = (loc) => {
    const map = C.map || DEFAULT_MAP, [z0, r0, s0, l0] = String(loc || '').split('-');
    const zone = map.zones.find(x => x.id === z0) || map.zones[0], row = zone && ((zone.rows || []).find(x => x.id === r0) || zone.rows[0]);
    const zs = `<select name="z"><option value="">—</option>${map.zones.map(z => `<option value="${esc(z.id)}"${loc && z.id === z0 ? ' selected' : ''}>${esc(z.name || z.id)}</option>`).join('')}</select>`;
    const rs = `<select name="r">${(zone ? zone.rows : []).map(r => `<option value="${esc(r.id)}"${loc && r.id === r0 ? ' selected' : ''}>${esc(r.name || r.id)}</option>`).join('')}</select>`;
    const ss = `<select name="s">${Array.from({ length: row ? +row.slots || 1 : 1 }, (_, i) => `<option${String(i + 1) === s0 ? ' selected' : ''}>${i + 1}</option>`).join('')}</select>`;
    const ls = `<select name="l">${Array.from({ length: row ? +row.levels || 1 : 1 }, (_, i) => `<option value="${i + 1}"${String(i + 1) === (l0 || '1') ? ' selected' : ''}>${i + 1 === 1 ? 'Abajo' : i + 1 === 2 ? 'Arriba' : 'Nivel ' + (i + 1)}</option>`).join('')}</select>`;
    return `<div class="cr-locsel"><label>Zona${zs}</label><label>Fila${rs}</label><label>Pos.${ss}</label><label>Nivel${ls}</label></div>`;
  };
  function openBarrel(id, preset) {
    const b = id ? C.barrels.find(x => x.id === id) : Object.assign({ code: '', size: 225, fill: 'full', lot: '', vol: '', loc: '', cooperage: '', wood: '', toast: '', year: '', notes: '' }, preset || {});
    if (!b) return;
    const isNew = !id, ro = !C.canWrite;
    const lotOpts = `<option value="">— Vacía / sin vino —</option>` + ['red', 'rose', 'white', 'orange', 'sparkling'].map(g => { const ls = C.all.filter(l => l.group === g); return ls.length ? `<optgroup label="${{ red: 'Tintos', rose: 'Rosados', white: 'Blancos', orange: 'Naranjas', sparkling: 'Espumosos' }[g]}">${ls.map(l => `<option value="${esc(l.id)}"${l.id === b.lot ? ' selected' : ''}>${esc(l.name)} (${C.vintageOf(l)}${l.code ? ' · ' + esc(l.code) : ''})</option>`).join('')}</optgroup>` : ''; }).join('');
    const d = sheet(`<form method="dialog" class="cr-form">
      <div class="cr-sh"><h3>${isNew ? 'Nueva barrica' : 'Barrica ' + esc(b.code)}</h3>${!isNew ? `<nav class="cr-stabs"><button type="button" data-st="form" aria-selected="true">Datos</button><button type="button" data-st="hist" aria-selected="false">Historial</button><button type="button" data-st="tag" aria-selected="false">Etiqueta</button></nav>` : ''}</div>
      <div class="cr-pane" data-pane="form">
        <div class="g3"><label>Nº barrica<input name="code" inputmode="numeric" required value="${esc(b.code)}" ${isNew ? '' : 'readonly'} placeholder="101"></label><label>Tamaño (L)<input name="size" inputmode="numeric" value="${esc(b.size)}"></label><label>Llenado<select name="fill">${Object.entries(FILL).map(([k, l]) => `<option value="${k}"${(b.fill || 'full') === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label></div>
        <label>Vino<select name="lot">${lotOpts}</select></label>
        <div class="g2"><label>Litros en la barrica<input name="vol" inputmode="decimal" value="${esc(b.vol)}" placeholder="225"></label><label>Año de la barrica<input name="year" inputmode="numeric" value="${esc(b.year)}" placeholder="2022"></label></div>
        <label>Ubicación ${b.loc ? `<span class="cr-loc">${esc(b.loc)}</span>` : ''}${locSelects(b.loc)}</label>
        <div class="g3"><label>Tonelería<input name="cooperage" value="${esc(b.cooperage)}" placeholder="Seguin Moreau"></label><label>Madera<select name="wood">${WOOD.map(w => `<option${w === (b.wood || '') ? ' selected' : ''}>${w}</option>`).join('')}</select></label><label>Tostado<input name="toast" value="${esc(b.toast)}" placeholder="M+"></label></div>
        <label>Notas<textarea name="notes" rows="2">${esc(b.notes)}</textarea></label>
        <div class="cr-err" id="crErr"></div>
      </div>
      ${!isNew ? `<div class="cr-pane" data-pane="hist" hidden><div class="cr-empty">Cargando historial…</div></div><div class="cr-pane" data-pane="tag" hidden></div>` : ''}
      <div class="cr-actions">${!isNew && !ro ? `<button type="button" class="btn danger" data-del>Borrar</button>` : ''}<button type="button" class="btn" data-cancel>Cerrar</button>${ro ? '' : `<button type="submit" class="btn primary">Guardar</button>`}</div>
    </form>`);
    const f = $('form', d);
    f.querySelector('[data-cancel]').onclick = () => d.close();
    f.addEventListener('change', e => { if (e.target.name === 'z' || e.target.name === 'r') { const z = f.z.value, r = e.target.name === 'z' ? '' : f.r.value; const tmp = locSelects(z ? `${z}-${r || ((C.map || DEFAULT_MAP).zones.find(x => x.id === z) || { rows: [{}] }).rows[0].id}-1-1` : ''); f.querySelector('.cr-locsel').outerHTML = tmp; } });
    if (!isNew) {
      f.querySelector('.cr-stabs').addEventListener('click', e => { const t = e.target.closest('[data-st]'); if (!t) return; f.querySelectorAll('[data-st]').forEach(x => x.setAttribute('aria-selected', x === t)); f.querySelectorAll('.cr-pane').forEach(p => p.hidden = p.dataset.pane !== t.dataset.st); if (t.dataset.st === 'hist') loadHistory(b, f.querySelector('[data-pane="hist"]')); if (t.dataset.st === 'tag') renderTag(b, f.querySelector('[data-pane="tag"]')); });
      const del = f.querySelector('[data-del]'); if (del) del.onclick = async () => { if (!confirm('¿Borrar la barrica ' + b.code + ' del registro?')) return; await api('barrels/' + encodeURIComponent(b.id), 'DELETE'); await logEvent(b.code, 'delete', 'Barrica borrada del registro'); d.close(); await refresh(); };
    }
    f.onsubmit = async e => {
      e.preventDefault(); if (ro) return;
      const fd = new FormData(f), code = codeOf(fd.get('code'));
      if (!code) { $('#crErr', f).textContent = 'Falta el número de barrica.'; return; }
      const z = fd.get('z'), loc = z ? [z, fd.get('r'), fd.get('s'), fd.get('l')].join('-') : '';
      const next = { code, size: +fd.get('size') || '', fill: fd.get('fill'), lot: fd.get('lot') || '', vol: fd.get('vol') ? +String(fd.get('vol')).replace(',', '.') : '', loc, cooperage: String(fd.get('cooperage')).trim(), wood: fd.get('wood'), toast: String(fd.get('toast')).trim(), year: String(fd.get('year')).trim(), notes: String(fd.get('notes')).trim(), by: C.me, at: new Date().toISOString() };
      if (!next.lot) next.fill = 'empty';
      const other = loc && C.barrels.find(x => x.loc === loc && x.id !== (isNew ? code : b.id));
      if (other && !confirm('En ' + loc + ' ya está la barrica ' + other.code + '. ¿Poner las dos ahí?')) return;
      if (isNew && C.barrels.some(x => x.id === code)) { $('#crErr', f).textContent = 'La barrica ' + code + ' ya existe; ábrela desde la lista.'; return; }
      try {
        await api('barrels/' + encodeURIComponent(isNew ? code : b.id), 'PUT', next);
        if (isNew) await logEvent(code, 'new', 'Registrada' + (next.lot ? ' con ' + lotName(next.lot) : ' vacía') + (loc ? ' en ' + loc : ''));
        else {
          if (b.loc !== loc) await logEvent(code, 'move', (b.loc || 'sin ubicación') + ' → ' + (loc || 'sin ubicación'));
          if ((b.lot || '') !== next.lot) await logEvent(code, next.lot ? 'fill' : 'empty', next.lot ? 'Llenada con ' + lotName(next.lot) + (next.vol ? ' · ' + next.vol + ' L' : '') : 'Vaciada (antes: ' + lotName(b.lot) + ')');
          else if (String(b.vol || '') !== String(next.vol || '')) await logEvent(code, 'vol', 'Volumen ' + (b.vol || '?') + ' → ' + (next.vol || '?') + ' L');
          else if (b.fill !== next.fill) await logEvent(code, 'fill', 'Llenado: ' + FILL[next.fill]);
        }
        d.close(); await refresh();
      } catch (err) { $('#crErr', f).textContent = err.message; }
    };
  }
  async function loadHistory(b, pane) {
    try {
      const [lg, xl] = await Promise.all([api('barrel_log'), fetch('/api/xl/barrel?code=' + encodeURIComponent(b.code)).then(r => r.json()).catch(() => ({ rows: [] }))]);
      const mine = (lg.rows || []).map(r => r.data).filter(r => String(r.code) === String(b.code)).sort((x, y) => String(y.at).localeCompare(String(x.at)));
      const xrows = (xl.rows || []);
      const RK = [['volf', 'Vol'], ['ph', 'pH'], ['at', 'AT'], ['am', 'Málico'], ['sl', 'SO₂ L'], ['st', 'SO₂ T'], ['aa', 'AV']];
      pane.innerHTML = `<h4>Movimientos en la app <small>${mine.length}</small></h4>` + (mine.length ? `<ul class="cr-log">${mine.map(r => `<li><span class="cr-ld">${fmtD(r.at)}</span><span class="cr-lk ${esc(r.kind)}">${esc(r.kind)}</span>${esc(r.text)}<small>${esc(r.by || '')}</small></li>`).join('')}</ul>` : '<p class="cr-none">Nada todavía.</p>') +
        `<h4>En Excellovint <small>${xrows.length}</small></h4>` + (xrows.length ? `<div class="xlog">${xrows.map(r => `<article class="xe${r.ini ? ' is-done' : r.asig ? ' is-open' : ''}"><div class="xe-h"><span class="xe-d">${esc(r.date ? fmtD(r.date) : r.date_raw || '')}</span><span class="xe-u">${esc(r.tab)}${r.ubi ? ' · ' + esc(r.ubi) : ''}</span>${r.ini ? `<span class="xe-st done">Hecha · ${esc(r.ini)}</span>` : r.asig ? `<span class="xe-st open">Abierta · ${esc(r.asig)}</span>` : ''}</div><div class="xe-b">${RK.some(([k]) => r[k]) ? `<div class="xe-r">${RK.filter(([k]) => r[k]).map(([k, l]) => `<span><i>${l}</i>${esc(r[k])}</span>`).join('')}</div>` : ''}${r.note ? `<p class="xe-n">${esc(r.note)}</p>` : ''}</div></article>`).join('')}</div>` : '<p class="cr-none">Ninguna línea de Excellovint menciona esta barrica (busca «BBL ' + esc(b.code) + '»).</p>');
    } catch (e) { pane.innerHTML = '<p class="cr-none">No se pudo cargar: ' + esc(e.message) + '</p>'; }
  }

  // ---------- Tags: QR + NFC + print ----------
  let qrLib = null;
  function loadQR() { if (qrLib) return qrLib; qrLib = new Promise((res, rej) => { if (window.qrcode) return res(window.qrcode); const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js'; s.onload = () => res(window.qrcode); s.onerror = () => rej(new Error('QR library')); document.head.appendChild(s); }); return qrLib; }
  const tagUrl = code => location.origin + '/b/' + code;
  async function qrSvg(text, size) { const qr = (await loadQR())(0, 'M'); qr.addData(text); qr.make(); return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true }).replace('<svg', `<svg width="${size}" height="${size}"`); }
  async function renderTag(b, pane) {
    pane.innerHTML = '<div class="cr-empty">Generando…</div>';
    try {
      const svg = await qrSvg(tagUrl(b.code), 160);
      pane.innerHTML = `<div class="cr-tag"><div class="cr-label"><div class="cr-lcode"><small>BBL</small><b>${esc(b.code)}</b></div>${svg}<div class="cr-lfoot">${esc(lotName(b.lot) || '')}<br><span>Dos Búhos · ${esc(tagUrl(b.code).replace(/^https?:\/\//, ''))}</span></div></div>
        <p class="cr-help">Al escanear el QR se abre esta barrica. El contenido no va impreso: siempre se lee lo actual.</p>
        <div class="cr-row"><button type="button" class="btn" data-print1>Imprimir esta etiqueta</button>${'NDEFReader' in window ? `<button type="button" class="btn" data-nfc>Escribir tag NFC</button>` : '<small class="cr-dim">NFC: disponible en Android con Chrome.</small>'}</div><div class="cr-err" id="crNfc"></div></div>`;
      pane.querySelector('[data-print1]').onclick = () => printLabels([b]);
      const nfc = pane.querySelector('[data-nfc]'); if (nfc) nfc.onclick = async () => { const o = $('#crNfc', pane); o.textContent = 'Acerca el tag NFC al teléfono…'; try { await new NDEFReader().write({ records: [{ recordType: 'url', data: tagUrl(b.code) }] }); o.textContent = 'Tag escrito ✓'; } catch (e) { o.textContent = 'No se pudo escribir: ' + e.message; } };
    } catch (e) { pane.innerHTML = '<p class="cr-none">' + esc(e.message) + '</p>'; }
  }
  async function printLabels(list) {
    const bs = list || C.barrels; if (!bs.length) return alert('No hay barricas registradas.');
    const svgs = await Promise.all(bs.map(b => qrSvg(tagUrl(b.code), 120)));
    let host = $('#crPrint'); if (!host) { host = document.createElement('div'); host.id = 'crPrint'; document.body.appendChild(host); }
    host.innerHTML = bs.map((b, i) => `<div class="cr-label"><div class="cr-lcode"><small>BBL</small><b>${esc(b.code)}</b></div>${svgs[i]}<div class="cr-lfoot">${esc(lotName(b.lot) || '')}<br><span>Dos Búhos · ${esc(tagUrl(b.code).replace(/^https?:\/\//, ''))}</span></div></div>`).join('');
    document.documentElement.classList.add('cr-printing');
    const done = () => { document.documentElement.classList.remove('cr-printing'); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done); setTimeout(() => window.print(), 150); setTimeout(done, 60000);
  }

  // ---------- Import (paste from Excel) ----------
  function openImport() {
    const d = sheet(`<form method="dialog" class="cr-form"><div class="cr-sh"><h3>Importar inventario de barricas</h3></div>
      <p class="cr-help">Copia las celdas en Excel o Google Sheets (con la fila de encabezados) y pégalas aquí. Columnas que se reconocen: nº barrica, tamaño, tonelería, madera, tostado, año, vino/lote, litros, ubicación, notas. Lo demás se ignora.</p>
      <textarea name="paste" rows="8" placeholder="Barrica\tTamaño\tTonelería\tAño\tVino\tLitros\tUbicación\n101\t225\tSeguin Moreau\t2022\tL14 CF\t112\tA-1-3-1"></textarea>
      <div id="crPrev" class="cr-prev"></div><div class="cr-err" id="crErr"></div>
      <div class="cr-actions"><button type="button" class="btn" data-cancel>Cancelar</button><button type="button" class="btn" data-preview>Revisar</button><button type="submit" class="btn primary" disabled>Importar</button></div></form>`);
    const f = $('form', d); let parsed = [];
    const COLS = { code: /barr|bbl|^#|n[uú]m|c[oó]digo|^id$|^no\.?$/i, size: /tama|size|litros\s*\(cap|capac/i, cooperage: /tonel|cooper|marca|fabric/i, wood: /madera|wood|roble/i, toast: /tost|toast/i, year: /a[ñn]o|year|vint/i, lot: /lote|\blot\b|vino|wine|conten/i, vol: /^vol|litros|^l$|llen/i, loc: /ubic|loc|fila|pos|sala/i, notes: /nota|obs|coment/i };
    const parse = () => {
      const txt = f.paste.value.replace(/\r/g, ''); const lines = txt.split('\n').filter(l => l.trim()); if (lines.length < 2) throw new Error('Pega al menos encabezados y una fila.');
      const sep = lines[0].includes('\t') ? '\t' : lines[0].includes(';') ? ';' : ',';
      const head = lines[0].split(sep).map(h => h.trim()); const idx = {};
      head.forEach((h, i) => { for (const k in COLS) if (idx[k] == null && COLS[k].test(h)) { if (k === 'size' && idx.vol == null && /litros$/i.test(h)) continue; idx[k] = i; } });
      if (idx.code == null) throw new Error('No encuentro la columna del número de barrica (p. ej. «Barrica», «BBL», «#»).');
      const findLot = s => { s = String(s || '').trim(); if (!s) return ''; const u = s.toUpperCase(); let l = C.all.find(x => x.code && u.startsWith(x.code.toUpperCase())) || C.all.find(x => u.includes(x.name.toUpperCase())) || C.all.find(x => { const m = u.match(/L\d{2}/); return m && (x.code || '').toUpperCase().includes(m[0]); }); return l ? l.id : ''; };
      return lines.slice(1).map(l => l.split(sep)).map(c => { const g = k => idx[k] == null ? '' : String(c[idx[k]] || '').trim(); const code = codeOf(g('code')); if (!code) return null; const lotTxt = g('lot'); return { code, size: +g('size').replace(/\D/g, '') || '', cooperage: g('cooperage'), wood: g('wood'), toast: g('toast'), year: g('year').replace(/\D/g, '').slice(0, 4), lot: findLot(lotTxt), lotTxt, vol: g('vol') ? +g('vol').replace(',', '.').replace(/[^\d.]/g, '') || '' : '', loc: g('loc').toUpperCase().replace(/\s+/g, ''), notes: g('notes') }; }).filter(Boolean);
    };
    f.querySelector('[data-cancel]').onclick = () => d.close();
    f.querySelector('[data-preview]').onclick = () => {
      try { parsed = parse(); } catch (e) { $('#crErr', f).textContent = e.message; return; }
      $('#crErr', f).textContent = '';
      const exist = parsed.filter(p => C.barrels.some(b => b.id === p.code)).length, unk = parsed.filter(p => p.lotTxt && !p.lot);
      $('#crPrev', f).innerHTML = `<p><b>${parsed.length}</b> barricas (${exist} ya registradas se actualizan, ${parsed.length - exist} nuevas).${unk.length ? ` <span class="cr-warn">${unk.length} con vino que no reconozco (se guarda en notas): ${esc([...new Set(unk.map(u => u.lotTxt))].slice(0, 5).join(', '))}</span>` : ''}</p>
        <table class="cr-tbl"><tr><th>#</th><th>Vino</th><th>L</th><th>Ubic.</th><th>Tonelería</th><th>Año</th></tr>${parsed.slice(0, 8).map(p => `<tr><td>${p.code}</td><td>${esc(p.lot ? lotName(p.lot) : p.lotTxt || '—')}</td><td>${p.vol || ''}</td><td>${esc(p.loc)}</td><td>${esc(p.cooperage)}</td><td>${esc(p.year)}</td></tr>`).join('')}${parsed.length > 8 ? `<tr><td colspan="6">… y ${parsed.length - 8} más</td></tr>` : ''}</table>`;
      f.querySelector('[type=submit]').disabled = !parsed.length;
    };
    f.onsubmit = async e => {
      e.preventDefault(); if (!parsed.length) return; const btn = f.querySelector('[type=submit]'); btn.disabled = true; btn.textContent = 'Importando…';
      let n = 0;
      for (const p of parsed) {
        const cur = C.barrels.find(b => b.id === p.code) || {};
        const doc = Object.assign({}, cur, { code: p.code, by: C.me, at: new Date().toISOString() });
        for (const k of ['size', 'cooperage', 'wood', 'toast', 'year', 'vol', 'loc']) if (p[k] !== '' && p[k] != null) doc[k] = p[k];
        if (p.lot) doc.lot = p.lot; else if (p.lotTxt) doc.notes = [cur.notes, 'Vino (importado): ' + p.lotTxt].filter(Boolean).join(' · ');
        if (p.notes) doc.notes = [doc.notes, p.notes].filter(Boolean).join(' · ');
        doc.fill = doc.fill || (doc.lot ? (doc.vol && doc.size && doc.vol < doc.size * 0.9 ? 'partial' : 'full') : 'empty');
        try { await api('barrels/' + encodeURIComponent(p.code), 'PUT', doc); n++; } catch (err) { $('#crErr', f).textContent = 'Barrica ' + p.code + ': ' + err.message; }
      }
      await logEvent('*', 'import', n + ' barricas importadas');
      d.close(); await refresh();
    };
  }

  // ---------- Map config ----------
  function openMapCfg() {
    const map = JSON.parse(JSON.stringify(C.map || DEFAULT_MAP));
    const draw = () => {
      $('#crZones', d).innerHTML = map.zones.map((z, zi) => `<fieldset class="cr-zcfg"><legend><input value="${esc(z.name || '')}" data-zn="${zi}" placeholder="Nombre de la zona"> <span class="cr-dim">código ${esc(z.id)}</span> <button type="button" class="x" data-zdel="${zi}" title="Quitar zona">×</button></legend>
        ${z.rows.map((r, ri) => `<div class="cr-rcfg"><input value="${esc(r.name || '')}" data-rn="${zi}.${ri}" placeholder="Fila"><label>Posiciones <input type="number" min="1" max="40" value="${r.slots}" data-rs="${zi}.${ri}"></label><label>Niveles <input type="number" min="1" max="4" value="${r.levels}" data-rl="${zi}.${ri}"></label><button type="button" class="x" data-rdel="${zi}.${ri}" title="Quitar fila">×</button></div>`).join('')}
        <button type="button" class="btn sm" data-radd="${zi}">+ Fila</button></fieldset>`).join('');
    };
    const d = sheet(`<form method="dialog" class="cr-form"><div class="cr-sh"><h3>Mapa de la cava</h3></div>
      <p class="cr-help">Ubicación estándar = <b>Zona-Fila-Posición-Nivel</b> (p. ej. <code>A-2-5-1</code> = zona A, fila 2, posición 5, abajo). Define aquí las zonas y filas reales de la bodega; las etiquetas usan estos códigos.</p>
      <div id="crZones"></div><button type="button" class="btn sm" data-zadd>+ Zona</button>
      <div class="cr-actions"><button type="button" class="btn" data-cancel>Cancelar</button><button type="submit" class="btn primary">Guardar mapa</button></div></form>`);
    draw();
    d.addEventListener('input', e => { const t = e.target; if (t.dataset.zn != null) map.zones[+t.dataset.zn].name = t.value; if (t.dataset.rn) { const [z, r] = t.dataset.rn.split('.'); map.zones[z].rows[r].name = t.value; } if (t.dataset.rs) { const [z, r] = t.dataset.rs.split('.'); map.zones[z].rows[r].slots = +t.value || 1; } if (t.dataset.rl) { const [z, r] = t.dataset.rl.split('.'); map.zones[z].rows[r].levels = +t.value || 1; } });
    d.addEventListener('click', e => {
      const t = e.target.closest('button'); if (!t) return;
      if (t.dataset.zadd != null) { const id = String.fromCharCode(65 + map.zones.length); map.zones.push({ id, name: 'Zona ' + id, rows: [{ id: '1', name: 'Fila 1', slots: 8, levels: 2 }] }); draw(); }
      if (t.dataset.radd != null) { const z = map.zones[+t.dataset.radd]; z.rows.push({ id: String(z.rows.length + 1), name: 'Fila ' + (z.rows.length + 1), slots: 8, levels: 2 }); draw(); }
      if (t.dataset.zdel != null && confirm('¿Quitar la zona? Las barricas ubicadas ahí quedan sin ubicación.')) { map.zones.splice(+t.dataset.zdel, 1); draw(); }
      if (t.dataset.rdel) { const [z, r] = t.dataset.rdel.split('.'); map.zones[z].rows.splice(+r, 1); draw(); }
      if (t.dataset.cancel != null) d.close();
    });
    $('form', d).onsubmit = async e => { e.preventDefault(); await api('barrel_map/main', 'PUT', map); C.map = map; d.close(); render(); };
  }

  // ---------- Assign a barrel to a free slot ----------
  function openAssign(loc) {
    const list = C.barrels.slice().sort((a, b) => (!!a.loc - !!b.loc) || (+a.code - +b.code));
    const d = sheet(`<form method="dialog" class="cr-form"><div class="cr-sh"><h3>${esc(locLabel(loc))}</h3><span class="cr-loc">${esc(loc)}</span></div>
      <input type="search" class="search" placeholder="Buscar barrica o vino" data-aq>
      <div class="cr-chips" data-al>${list.map(b => `<button type="button" class="cr-chip${b.loc ? ' placed' : ''}" data-pick="${esc(b.id)}" style="--c:${GCOL[lotGroup(b.lot)] || '#999'}"><b>${esc(b.code)}</b><small>${esc(lotName(b.lot) || 'vacía')}${b.loc ? ' · ' + esc(b.loc) : ''}</small></button>`).join('') || '<span class="cr-none">No hay barricas registradas; usa «+ Barrica».</span>'}</div>
      <div class="cr-actions"><button type="button" class="btn" data-cancel>Cancelar</button><button type="button" class="btn primary" data-newhere>+ Nueva barrica aquí</button></div></form>`);
    d.querySelector('[data-cancel]').onclick = () => d.close();
    d.querySelector('[data-newhere]').onclick = () => { d.close(); openBarrel(null, { loc }); };
    d.querySelector('[data-aq]').oninput = e => { const q = e.target.value.toLowerCase(); d.querySelectorAll('[data-pick]').forEach(c => c.hidden = q && !c.textContent.toLowerCase().includes(q)); };
    d.querySelector('[data-al]').onclick = async e => { const c = e.target.closest('[data-pick]'); if (!c) return; const b = C.barrels.find(x => x.id === c.dataset.pick); if (!b) return; const from = b.loc; await api('barrels/' + encodeURIComponent(b.id), 'PATCH', { loc, by: C.me, at: new Date().toISOString() }); await logEvent(b.code, 'move', (from || 'sin ubicación') + ' → ' + loc); d.close(); await refresh(); };
  }

  async function refresh() { await load(); render(); }

  // ---------- events ----------
  document.addEventListener('click', e => {
    if (!C.root || !C.root.contains(e.target)) return;
    const t = e.target.closest('[data-ct],[data-cv],[data-cf],[data-ca],[data-bb],[data-loc],[data-open],[data-phase]'); if (!t) return;
    if (t.dataset.ct) { C.tab = t.dataset.ct; C.q = ''; render(); return; }
    if (t.dataset.cv) { C.vint = t.dataset.cv; render(); return; }
    if (t.dataset.cf) { C.filter = t.dataset.cf; render(); return; }
    if (t.dataset.ca === 'new') { openBarrel(null, t.dataset.lot ? { lot: t.dataset.lot } : null); return; }
    if (t.dataset.ca === 'import') { openImport(); return; }
    if (t.dataset.ca === 'labels') { printLabels(null); return; }
    if (t.dataset.ca === 'mapcfg') { openMapCfg(); return; }
    if (t.dataset.bb) { openBarrel(t.dataset.bb); return; }
    if (t.dataset.loc) { if (C.canWrite) openAssign(t.dataset.loc); return; }
    if (t.dataset.open) { window.dispatchEvent(new CustomEvent('cellar:open', { detail: { lot: t.dataset.open } })); return; }
    if (t.dataset.phase) { window.dispatchEvent(new CustomEvent('cellar:phase', { detail: { lot: t.dataset.lot, phase: t.dataset.phase } })); return; }
  });
  document.addEventListener('input', e => { if (C.root && C.root.contains(e.target) && e.target.classList.contains('cr-q')) { C.q = e.target.value; const body = $('#crBody', C.root); if (body) body.innerHTML = C.tab === 'wines' ? renderWines() : C.tab === 'barrels' ? renderBarrels() : renderMap(); } });
  document.addEventListener('change', e => { if (C.root && C.root.contains(e.target) && e.target.matches('[data-cg]')) { C.group = e.target.value; render(); } });

  let loading = null;
  window.addEventListener('cellar:render', async e => {
    const d = e.detail || {};
    C.root = document.getElementById('cellarView'); C.lots = d.lots || []; C.all = d.all || []; C.canWrite = !!d.canWrite; C.vintage = d.vintage || 2026;
    if (d.vintageOf) C.vintageOf = d.vintageOf; if (d.phaseOf) C.phaseOf = d.phaseOf;
    if (!C.loaded) { if (!loading) loading = load().catch(() => { C.loaded = true; }); render(); await loading; }
    render();
    // Deep link from a tag: /b/101 → /?b=101#cellar
    const m = location.search.match(/[?&]b=(\d+)/);
    if (m && !window.__crOpened) { window.__crOpened = true; const b = C.barrels.find(x => x.id === m[1]); if (b) openBarrel(b.id); else if (C.canWrite) openBarrel(null, { code: m[1] }); }
  });
})();
