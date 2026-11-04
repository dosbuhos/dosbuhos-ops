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
  const SPEC_KEYS = ['size', 'cooperage', 'wood', 'toast', 'year', 'use'];
  // What kind of wine a barrel is for (a red barrel stays a red barrel). Set by hand; otherwise from the wine in it,
  // otherwise from the old paper code (CF24, SY24, AN24 = naranja…).
  const USE = { white: 'Blanco', red: 'Tinto', orange: 'Naranja', rose: 'Rosado' };
  const USE_C = { white: '#d8b43c', red: '#7a1f2b', orange: '#d9822b', rose: '#e0849a' };
  const PAPER_USE = [[/^(L\d+-)?(CFRO|RO|ROS)/i, 'rose'], [/^(L\d+-)?(AN|OR|NAR)/i, 'orange'], [/^(L\d+-)?(SB|CB|CH|SE|MG|BL)/i, 'white'], [/^(L\d+-)?(CF|CS|SY|TE|GR|AG|MO|ME|MA|PS|MO|CFCM|MPCM)/i, 'red']];
  function useOf(b) {
    if (b.use && USE[b.use]) return b.use;
    const g = lotGroup(b.lot); if (USE[g]) return g;
    const p = String((b.paper && b.paper.last) || '').trim(); for (const [re, u] of PAPER_USE) if (re.test(p)) return u;
    return '';
  }
  // One state per barrel so the chip counts and the lists always agree.
  const stateOf = b => needsConfirm(b) ? 'confirm' : (b.lot || (b.fill && b.fill !== 'empty') ? (b.fill === 'partial' ? 'partial' : 'full') : 'empty');
  const WOOD = ['', 'Francesa', 'Americana', 'Húngara', 'Otra'];
  const fmtD = iso => iso ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso + 'T12:00' : iso).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: '2-digit' }) : '';
  const codeOf = v => String(v == null ? '' : v).replace(/\D/g, '').replace(/^0+(?=\d)/, '');
  // Small barrel drawn in the wine's color (the old square badge read like a calendar date).
  const BARREL_SVG = '<svg class="cr-ico" viewBox="0 0 40 44" aria-hidden="true"><path d="M8 3h24c4 6 5 12 5 19s-1 13-5 19H8C4 35 3 29 3 22S4 9 8 3z" fill="var(--c)"/><path d="M5.2 12h29.6M3.4 22h33.2M5.2 32h29.6" stroke="#1f1d1b" stroke-opacity=".55" stroke-width="2.4" fill="none"/><path d="M8 3h24c4 6 5 12 5 19s-1 13-5 19H8C4 35 3 29 3 22S4 9 8 3z" fill="none" stroke="#1f1d1b" stroke-opacity=".35" stroke-width="1.2"/><path d="M14 4c-2 6-3 12-3 18s1 12 3 18M26 4c2 6 3 12 3 18s-1 12-3 18" stroke="#fff" stroke-opacity=".28" stroke-width="1.2" fill="none"/></svg>';
  const specLine = b => [b.cooperage, b.wood, b.toast ? 'tostado ' + b.toast : '', b.year ? 'hecha en ' + b.year : ''].filter(Boolean).join(' · ');
  const DEFAULT_MAP = { zones: [{ id: 'A', name: 'Sala de barricas', rows: [{ id: '1', name: 'Fila 1', slots: 8, levels: 4 }, { id: '2', name: 'Fila 2', slots: 8, levels: 4 }, { id: '3', name: 'Fila 3', slots: 8, levels: 4 }] }] };

  const C = { root: null, lots: [], all: [], canWrite: false, vintage: 2026, vintageOf: () => 2026, phaseOf: () => 'prod', barrels: [], map: null, tab: 'barrels', vessels: [], vint: 'all', q: '', filter: 'all', me: '', loaded: false, crew: false, group: 'wine', sheetTabs: {} };

  // ---------- data ----------
  async function load() {
    const [b, m, me, vs] = await Promise.all([api('barrels'), api('barrel_map').catch(() => ({ rows: [] })), fetch('/api/me').then(r => r.json()).catch(() => ({})), api('vessels').catch(() => ({ rows: [] }))]);
    C.vessels = (vs.rows || []).map(r => Object.assign({ id: r.id }, r.data));
    C.barrels = (b.rows || []).map(r => Object.assign({ id: r.id }, r.data)).sort((x, y) => (+x.code || 0) - (+y.code || 0));
    const md = (m.rows || []).find(r => r.id === 'main'); C.map = md ? md.data : null;
    C.me = me.initials || ''; C.loaded = true;
  }
  const lotById = id => C.all.find(l => l.id === id);
  const lotName = id => { const l = lotById(id); return l ? l.name : (id || ''); };
  const lotGroup = id => { const l = lotById(id); return l ? l.group : ''; };
  // Short label for a lot on the tank plan: its Excellovint tab ("L08 - SE" → "L08 SE"), else the first words of its name.
  const lotAbbr = id => { const l = lotById(id); if (!l) return id || ''; const t = ((l.sheet || []).find(s => !s.archived) || {}).tab; return t ? String(t).replace(/\s*-\s*/g, ' ').replace(/\s+/g, ' ').trim() : String(l.name).split(/\s+/).slice(0, 2).join(' '); };
  const barrelsOf = lot => C.barrels.filter(b => b.lot === lot.id);
  const vintOK = l => C.vint === 'all' || (C.vint === 'old' ? C.vintageOf(l) < C.vintage - 2 : C.vintageOf(l) === +C.vint);
  // Barrels stack up to 4 high: level 1 = on the floor, 4 = top.
  const MAX_LEVELS = 4;
  const lvName = lv => +lv === 1 ? 'piso' : 'nivel ' + lv;
  const locLabel = loc => {
    if (!loc) return '';
    const [z, r, s, lv] = String(loc).split('-'); const zone = (C.map || DEFAULT_MAP).zones.find(x => x.id === z);
    const row = zone && (zone.rows || []).find(x => x.id === r);
    return (zone ? zone.name : 'Zona ' + z) + ' · ' + (row ? row.name : 'Fila ' + r) + ' · Pos ' + s + (lv ? ' · ' + lvName(lv) : '');
  };
  const atLoc = loc => C.barrels.find(b => b.loc === loc);
  // Imported from the paper SO2 records (Barricas_registro_2025-2026.xlsx): barrels that held older wine on paper and
  // nobody knows if it's still there. Diane confirms each with one tap.
  const needsConfirm = b => b.status === 'confirm' && !b.confirmed;
  const paperLine = b => b.paper && b.paper.last ? 'Papel: ' + b.paper.last + (b.paper.date ? ' · ' + fmtD(b.paper.date) : '') : '';
  async function logEvent(code, kind, text) {
    const at = new Date().toISOString();
    await api('barrel_log/' + encodeURIComponent('b' + code + '-' + Date.now().toString(36)), 'PUT', { code: String(code), at, by: C.me, kind, text }).catch(() => {});
  }

  // ---------- shell ----------
  // Layout (v1.3.9): tabs · one toolbar row (search, Filtros n, + Barrica, ⋯ more) · one status row · chips only when a filter is on.
  // Vintage, barrel type, "sin ubicación" and grouping live in the Filtros sheet; Importar / Etiquetas QR / Configurar mapa in ⋯.
  C.panel = false; C.more = false; C.noloc = false;
  const ICON_F = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4"/></svg>';
  const ICON_S = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>';
  function nFilters() { return (C.vint !== 'all' ? 1 : 0) + (C.use ? 1 : 0) + (C.noloc ? 1 : 0); }
  function vintChips() {
    const vints = [...new Set(C.all.map(l => C.vintageOf(l)))].sort((a, b) => b - a);
    return [['all', 'Todas']].concat(vints.filter(v => v >= C.vintage - 2).map(v => [String(v), String(v)])).concat(vints.some(v => v < C.vintage - 2) ? [['old', 'Anteriores']] : []);
  }
  function render() {
    if (!C.root) return;
    if (!C.loaded) { C.root.innerHTML = '<div class="cr-empty">Cargando bodega…</div>'; return; }
    if (C.tab === 'wines') C.tab = 'barrels';
    const tabs = C.tab === 'tanks' ? '' : `<div class="cr-view" role="tablist" aria-label="Vista">
        <button type="button" role="tab" data-ct="barrels" aria-selected="${C.tab === 'barrels'}">Lista</button>
        <button type="button" role="tab" data-ct="map" aria-selected="${C.tab === 'map'}">Mapa</button>
      </div>`;
    let tool = '';
    if (C.tab === 'barrels') {
      const n = nFilters();
      tool = `<div class="cr-tool">
        <label class="cr-search">${ICON_S}<input type="search" class="cr-q" placeholder="Buscar" value="${esc(C.q)}" aria-label="Buscar barrica"></label>
        <button type="button" class="cr-fbtn${n ? ' on' : ''}" data-cpanel aria-expanded="${C.panel}">${ICON_F}<span>Filtros</span>${n ? `<b>${n}</b>` : ''}</button>
        ${C.canWrite ? `<button type="button" class="cr-add" data-ca="new" aria-label="Nueva barrica" title="Nueva barrica">+</button>` : ''}
        <span class="cr-morew"><button type="button" class="cr-more" data-cmore aria-expanded="${C.more}" aria-label="Más opciones">⋯</button>${C.more ? `<div class="cr-menu" role="menu">
          ${C.canWrite ? `<button type="button" role="menuitem" data-ca="import">Importar inventario</button>` : ''}
          <button type="button" role="menuitem" data-ca="labels">Imprimir etiquetas QR</button>
          ${C.canWrite ? `<button type="button" role="menuitem" data-ca="mapcfg">Configurar mapa</button>` : ''}</div>` : ''}</span>
      </div>`;
    } else if (C.tab === 'map' && C.canWrite) {
      tool = `<div class="cr-tool cr-tool-r"><button type="button" class="btn sm" data-ca="mapcfg">Configurar mapa</button></div>`;
    }
    C.root.innerHTML = `<div class="cr">${tabs}${tool}<div class="cr-body" id="crBody"></div></div>`;
    const body = $('#crBody', C.root);
    body.innerHTML = C.tab === 'map' ? renderMap() : C.tab === 'tanks' ? renderTanks() : renderBarrels();
  }
  // Filtros sheet (bottom sheet on phones, centered card on desktop).
  function filterPanel() {
    const uses = [['', 'Todas'], ['white', 'Blanco'], ['red', 'Tinto'], ['orange', 'Naranja'], ['rose', 'Rosado'], ['none', 'Sin tipo']];
    const seg = (attr, list, cur) => `<div class="cr-pseg">${list.map(([k, l, dot]) => `<button type="button" ${attr}="${k}" aria-pressed="${cur === k}">${dot ? `<i style="background:${dot}"></i>` : ''}${l}</button>`).join('')}</div>`;
    return `<div class="cr-panel" data-cpanelbg><div class="cr-pin" role="dialog" aria-label="Filtros">
      <div class="cr-ph"><b>Filtros</b><button type="button" class="cr-px" data-cpanel aria-label="Cerrar">×</button></div>
      <div class="cr-plbl">Tipo de barrica</div>${seg('data-cu', uses.map(([k, l]) => [k, l, USE_C[k]]), C.use || '')}
      <div class="cr-plbl">Añada del vino</div>${seg('data-cv', vintChips(), C.vint)}
      <div class="cr-plbl">Ubicación</div>${seg('data-cl', [['', 'Todas'], ['1', 'Sin ubicación']], C.noloc ? '1' : '')}
      <div class="cr-plbl">Agrupar la lista</div>${seg('data-cg2', [['loc', 'Por ubicación'], ['wine', 'Por vino'], ['none', 'Sin agrupar']], C.group)}
      <div class="cr-pfoot">${nFilters() ? `<button type="button" class="cr-clear" data-cclear="all">Quitar filtros</button>` : '<span></span>'}<button type="button" class="btn primary" data-cpanel>Listo</button></div>
    </div></div>`;
  }
  // ---------- Barricas ----------
  function renderBarrels() {
    const q = C.q.trim().toLowerCase();
    let bs = C.barrels.filter(b => !q || (b.code + ' ' + lotName(b.lot) + ' ' + (b.loc || '') + ' ' + locLabel(b.loc) + ' ' + (b.cooperage || '') + ' ' + (b.toast || '') + ' ' + (b.year || '') + ' ' + (b.notes || '')).toLowerCase().includes(q));
    if (C.vint !== 'all') bs = bs.filter(b => { if (stateOf(b) === 'empty' || stateOf(b) === 'confirm') return true; const l = lotById(b.lot); return l ? vintOK(l) : false; }); // empties have no vintage: always shown
    if (C.use) bs = bs.filter(b => useOf(b) === C.use || (C.use === 'none' && !useOf(b)));
    if (C.noloc) bs = bs.filter(b => !b.loc);
    if (C.filter === 'noloc') C.filter = 'all';
    const base = bs;
    const counts = { all: base.length };
    for (const k of ['confirm', 'full', 'partial', 'empty']) counts[k] = base.filter(b => stateOf(b) === k).length;
    counts.full += counts.partial; // "Con vino" = full + partial
    if (C.filter === 'full') bs = bs.filter(b => ['full', 'partial'].includes(stateOf(b))); else if (C.filter !== 'all') bs = bs.filter(b => stateOf(b) === C.filter);
    // One status row (the question people actually ask: what's full, what's free, what needs checking).
    const st = [['all', 'Todas'], ['full', 'Con vino'], ['empty', 'Vacías']].concat(counts.confirm ? [['confirm', 'Revisar']] : []);
    const fchips = st.map(([k, l]) => `<button type="button" data-cf="${k}" aria-pressed="${C.filter === k}"${k === 'confirm' ? ' title="Por confirmar: vino viejo en papel"' : ''}><span>${l}</span><small>${counts[k]}</small></button>`).join('');
    const chips = [];
    if (C.use) chips.push(['use', 'Tipo: ' + (C.use === 'none' ? 'Sin tipo' : USE[C.use])]);
    if (C.vint !== 'all') chips.push(['vint', 'Añada: ' + (C.vint === 'old' ? 'Anteriores' : C.vint)]);
    if (C.noloc) chips.push(['loc', 'Sin ubicación']);
    let h = `<div class="cr-status" role="group" aria-label="Estado">${fchips}</div>` +
      (chips.length ? `<div class="cr-chips2">${chips.map(([k, l]) => `<button type="button" class="cr-fchip" data-cclear="${k}" aria-label="Quitar ${esc(l)}">${esc(l)} <b aria-hidden="true">×</b></button>`).join('')}<button type="button" class="cr-clear" data-cclear="all">Quitar filtros</button></div>` : '') +
      (C.panel ? filterPanel() : '');
    if (!C.barrels.length) return h + `<div class="cr-empty"><strong>Todavía no hay barricas registradas.</strong>Usa «Importar» para pegar el inventario de barricas desde Excel, o «+ Barrica» para capturar una por una.</div>`;
    if (!bs.length) return h + `<div class="cr-empty">Ninguna barrica coincide.</div>`;
    if (C.filter === 'confirm') return h + `<p class="cr-help">Estas barricas tenían vino de años anteriores en los registros de SO₂ en papel (nov/25 y may/26). Confirma qué tienen hoy; lo de 2026 en Excellovint no se toca.</p><div class="cr-cfm">` +
      bs.map(b => `<article class="cr-cfm-row" data-bb="${esc(b.id)}"><div><b>BBL ${esc(b.code)}</b><span>${esc(paperLine(b) || 'Sin registro')}</span>${b.flag ? `<em>⚠ ${esc(b.flag)}</em>` : ''}</div>${C.canWrite ? `<div class="cr-cfm-a"><button type="button" class="btn sm" data-cfm="same" data-id="${esc(b.id)}">Sigue con ${esc((b.paper && b.paper.last) || 'este vino')}</button><button type="button" class="btn sm" data-cfm="empty" data-id="${esc(b.id)}">Embotellada / vacía</button><button type="button" class="btn sm" data-cfm="other" data-id="${esc(b.id)}">Otro vino…</button></div>` : ''}</article>`).join('') + `</div>`;
    const card = b => {
      const g = lotGroup(b.lot), st = stateOf(b), fill = st === 'confirm' ? 'empty' : st, u = useOf(b);
      return `<article class="cr-bbl f-${fill}" data-bb="${esc(b.id)}" style="--c:${GCOL[g] || '#9aa5b1'}">
        <div class="cr-code">${BARREL_SVG}<b>${esc(b.code)}</b></div>
        <div class="cr-bmain">
          <div class="cr-bh"><b>${b.lot ? esc(lotName(b.lot)) : needsConfirm(b) ? '<span class="cr-cf">Por confirmar</span>' : b.confirmed && b.confirmed.wine ? esc(b.confirmed.wine) : '<span class="cr-none">Vacía</span>'}</b>${u ? `<span class="cr-use-t" style="--u:${USE_C[u]}">${USE[u]}</span>` : ''}</div>
          ${needsConfirm(b) && paperLine(b) ? `<div class="cr-sub">${esc(paperLine(b))}</div>` : ''}
          <div class="cr-sub">${esc([st === 'confirm' || !b.lot ? '' : FILL[fill], b.vol && b.size && +b.vol < +b.size ? b.vol + ' / ' + b.size + ' L' : (b.size || b.vol ? (b.size || b.vol) + ' L' : ''), b.lot && lotById(b.lot) ? C.vintageOf(lotById(b.lot)) : ''].filter(Boolean).join(' · '))}</div>
          ${specLine(b) ? `<div class="cr-sub cr-spec">${esc(specLine(b))}</div>` : ''}
          ${b.loc ? `<div class="cr-sub"><span class="cr-loc">${esc(b.loc)}</span> ${esc(locLabel(b.loc))}</div>` : ''}
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
          else h += `<button type="button" class="cr-cell free" data-loc="${loc}" title="${esc(locLabel(loc))}"${C.canWrite ? '' : ' disabled'}><small>${s}${levels > 1 ? '·' + lv : ''}</small></button>`;
        }
        h += `</div></div>`;
      }
      h += `</section>`;
    }
    const unplaced = C.barrels.filter(b => !b.loc);
    if (unplaced.length) h += `<h3 class="cr-gh">Sin ubicación <small>${unplaced.length}</small></h3><div class="cr-chips">${unplaced.map(b => `<button type="button" class="cr-chip" data-bb="${esc(b.id)}" style="--c:${GCOL[lotGroup(b.lot)] || '#999'}"><b>${esc(b.code)}</b><small>${esc(lotName(b.lot) || 'vacía')}</small></button>`).join('')}</div>`;
    return h;
  }

  // ---------- Tanques: every tank / amphora / puncheon from the vessel registry (coll "vessels") with the wine in it ----------
  // What's in a tank: set by hand on the tank (contents), otherwise read from each wine's location text (ubi) by the
  // tank's name and aliases ("TANQUE 6" → VC-06J). Auto readings are marked so someone confirms them.
  const ROOMS = [['front', 'Sala del frente'], ['back', 'Sala de atrás'], ['', 'Otras vasijas']];
  const tankList = () => C.vessels.filter(v => v.main !== false && v.kind !== 'ibc' && v.kind !== 'plastic_fermenter');
  const normV = s => String(s || '').toUpperCase().replace(/[\s_]+/g, ' ').replace(/\s*-\s*/g, '-').trim();
  const vNames = v => [v.name, v.id].concat(v.aliases || []).map(normV).filter(Boolean);
  function autoContents(v) {
    const out = [], names = vNames(v);
    for (const l of C.all) {
      if (l.archived || l.bottled || !l.ubi) continue;
      const parts = String(l.ubi).split(/\s*·\s*|\s*;\s*/);
      // Text after "→" is a plan, not where the wine is now ("TK-01 → TK-13").
      const nowTxt = normV(String(l.ubi).split('→')[0]);
      const segs = String(l.ubi).split('→')[0].split(/\s*[·,;+]\s*(?=[A-Za-z])/);
      const hit = names.find(n => new RegExp('(^|[^A-Z0-9])' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![0-9])', 'i').test(nowTxt));
      if (!hit) continue;
      let liters = null;
      const seg = segs.find(x => normV(x).includes(hit)) || '';
      const m = (seg + ' ' + (parts.length === 1 ? '' : '')).match(/([\d.,]+)\s*L\b/i) || (segs.length === 1 && String(l.ubi).split('→')[0].match(/([\d.,]+)\s*L\b/i));
      if (m) liters = +String(m[1]).replace(/,/g, '');
      else if (l.vol && segs.length === 1) liters = +l.vol;
      out.push({ lot: l.id, liters, auto: true });
    }
    return out;
  }
  const tankContents = v => (v.contents && Array.isArray(v.contents.items)) ? v.contents.items.filter(x => x.lot) : autoContents(v);
  const fmtL = n => n == null || isNaN(n) ? '' : Math.round(n).toLocaleString('es-MX') + ' L';
  function tankSvg(v, items) {
    const cap = +v.cap || 1, tot = items.reduce((s, x) => s + (+x.liters || 0), 0), known = items.some(x => x.liters != null);
    const frac = items.length ? (known ? Math.min(1, tot / cap) : 0.5) : 0, col = items.length ? (TCOL[lotGroup(items[0].lot)] || "#9aa5b1") : "#e3e5e7";
    const H = 92, W = 58, top = 8, bodyH = H - top - 6, fillH = Math.round(bodyH * frac);
    const shape = v.kind === 'amphora' ? `<path d="M18 6h22l-2 8c10 8 14 20 14 34s-6 30-22 40h-2C12 78 6 62 6 48s4-26 14-34z" fill="#e3e5e7" stroke="#8f969b" stroke-width="1.6"/>` : `<rect x="6" y="${top}" width="${W - 12}" height="${bodyH}" rx="8" fill="#e3e5e7" stroke="#8f969b" stroke-width="1.6"/>`;
    const clip = v.kind === 'amphora' ? `<clipPath id="tc-${esc(v.id)}"><path d="M18 6h22l-2 8c10 8 14 20 14 34s-6 30-22 40h-2C12 78 6 62 6 48s4-26 14-34z"/></clipPath>` : `<clipPath id="tc-${esc(v.id)}"><rect x="6" y="${top}" width="${W - 12}" height="${bodyH}" rx="8"/></clipPath>`;
    return `<svg class="tk-svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true"><defs>${clip}</defs>${shape}<rect clip-path="url(#tc-${esc(v.id)})" x="0" y="${top + bodyH - fillH}" width="${W}" height="${fillH}" fill="${col}" opacity="${known ? 1 : .45}"/>${v.jacket ? `<g stroke="#2d5c8a" stroke-width="1.2" opacity=".55"><line x1="6" y1="${top + 18}" x2="${W - 6}" y2="${top + 18}"/><line x1="6" y1="${top + 26}" x2="${W - 6}" y2="${top + 26}"/></g>` : ''}${v.capacity === 'variable' ? `<line x1="10" y1="${top + bodyH - fillH - 2}" x2="${W - 10}" y2="${top + bodyH - fillH - 2}" stroke="#3a3530" stroke-width="2.4" stroke-linecap="round"${items.length ? '' : ' opacity=".25"'}/>` : ''}</svg>`;
  }
  // Tank floor plan (from the 2019 AutoCAD plan, meters). Tanks are gray; the wine inside fills from the bottom in the
  // wine's color, by liters / capacity. Vessels not on the plan are listed below it.
  const TCOL = { red: '#8a2433', rose: '#e9a3b3', white: '#efd36b', orange: '#e39a46', sparkling: '#a9c9d4' };
  const TCOL_TXT = { red: '#7a1f2b', rose: '#b5506a', white: '#8a6d00', orange: '#a8580f', sparkling: '#3d6f80' };
  let TMAP = null, tmapLoading = null;
  const loadTMap = () => tmapLoading || (tmapLoading = fetch('/tankmap.json').then(r => r.json()).then(j => { TMAP = j; const b = C.root && $('#crBody', C.root); if (b && C.tab === 'tanks') b.innerHTML = renderTanks(); }).catch(() => { tmapLoading = null; }));
  function tankMapSvg(ts) {
    const M = TMAP, pos = M.pos;
    let g = '';
    for (const v of ts) {
      const p = pos[v.id]; if (!p) continue;
      const items = tankContents(v), tot = items.reduce((s, x) => s + (+x.liters || 0), 0), known = items.some(x => x.liters != null);
      const frac = items.length ? (known ? Math.min(1, tot / (+v.cap || 1)) : 0.5) : 0, r = p.d / 2;
      const col = items.length ? (TCOL[lotGroup(items[0].lot)] || '#9aa5b1') : null, cid = 'tkc-' + v.id.replace(/[^A-Za-z0-9-]/g, '');
      const lbl = items.length ? (known ? Math.round(100 * frac) + '%' : '¿L?') : fmtL(+v.cap);
      g += `<g class="tkm${items.length ? ' has' : ''}${v.kind === 'amphora' ? ' amph' : ''}${C.tkSel === v.id ? ' sel' : ''}" data-tksel="${esc(v.id)}" role="button" tabindex="0" aria-label="${esc(v.name)}">
        <clipPath id="${cid}"><circle cx="${p.x}" cy="${p.y}" r="${r}"/></clipPath>
        <circle class="tkm-b" cx="${p.x}" cy="${p.y}" r="${r}"/>
        ${items.length ? `<rect clip-path="url(#${cid})" x="${p.x - r}" y="${p.y + r - 2 * r * frac}" width="${2 * r}" height="${2 * r * frac}" fill="${col}"${known ? '' : ' opacity=".5"'}/>` : ''}
        <circle class="tkm-o" cx="${p.x}" cy="${p.y}" r="${r}"/>${v.jacket ? `<circle class="tkm-j" cx="${p.x}" cy="${p.y}" r="${r * 0.84}"/>` : ''}
        <text x="${p.x}" y="${p.y - r * 0.1}" font-size="${Math.max(0.2, r * 0.4)}">${esc(v.name)}</text>
        <text class="s" x="${p.x}" y="${p.y + r * 0.38}" font-size="${Math.max(0.14, r * 0.26)}">${esc(lbl)}</text>
        ${items.length ? `<text class="lot" x="${p.x}" y="${p.y + r + Math.max(0.3, r * 0.5)}" font-size="${Math.max(0.28, r * 0.44)}" fill="${TCOL_TXT[lotGroup(items[0].lot)] || '#3f4548'}">${esc(items.map(x => lotAbbr(x.lot)).join(' + '))}</text>` : ''}</g>`;
    }
    const bg = Object.entries(M.bg).map(([k, d]) => `<path class="tkm-bg-${k}" d="${d}"/>`).join('');
    const tx = M.texts.map(([x, y, t, h]) => `<text x="${x}" y="${y}" font-size="${h}">${esc(t)}</text>`).join('');
    const fv = tkFit();
    return `<div class="tkm-wrap"><svg class="tkm-svg" id="tkmSvg" viewBox="${fv.x} ${fv.y} ${fv.w} ${fv.h}" preserveAspectRatio="xMidYMid meet" style="aspect-ratio:${(fv.w / fv.h).toFixed(3)}"><g class="tkm-bg">${bg}</g><g class="tkm-tx">${tx}</g>${g}</svg>
      <div class="tkm-zoom"><button type="button" class="btn sm" data-tkz="in" aria-label="Acercar">+</button><button type="button" class="btn sm" data-tkz="out" aria-label="Alejar">−</button><button type="button" class="btn sm" data-tkz="fit">Ajustar</button></div></div>`;
  }
  // Default view: the rooms with tanks (tank positions + 2.5 m), not the whole site plan.
  function tkFit() { const ps = Object.values(TMAP.pos); const x0 = Math.min(...ps.map(p => p.x - p.d)), x1 = Math.max(...ps.map(p => p.x + p.d)), y0 = Math.min(...ps.map(p => p.y - p.d)), y1 = Math.max(...ps.map(p => p.y + p.d)); const pad = 2.5; return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + 2 * pad, h: y1 - y0 + 2 * pad }; }
  function renderTanks() {
    const ts = tankList(); if (!ts.length) return `<div class="cr-empty">No hay tanques registrados.</div>`;
    const card = v => {
      const items = tankContents(v), tot = items.reduce((s, x) => s + (+x.liters || 0), 0);
      const pct = items.length && tot ? Math.round(100 * tot / (+v.cap || 1)) : null;
      return `<button type="button" class="tk-card${items.length ? '' : ' empty'}" data-tk="${esc(v.id)}" style="--c:${items.length ? (TCOL[lotGroup(items[0].lot)] || '#9aa5b1') : '#cfd2d4'}">
        ${tankSvg(v, items)}
        <span class="tk-info"><b class="tk-name">${esc(v.name)}</b><small>${esc((v.aliases || [])[0] || '')}${v.jacket ? ' · ❄︎' : ''}</small>
          ${items.length ? items.map(x => `<span class="tk-wine">${esc(lotName(x.lot))}</span>`).join('') : '<span class="tk-none">Vacío</span>'}
          <span class="tk-l">${items.length ? (tot ? fmtL(tot) + ' / ' : '¿? / ') : ''}${fmtL(+v.cap)}${pct != null ? ` · ${pct}%` : ''}</span>
          ${items.some(x => x.auto) ? '<span class="tk-auto">según la ficha del vino · confirmar</span>' : ''}</span></button>`;
    };
    const full = ts.filter(v => tankContents(v).length), liters = full.reduce((s, v) => s + tankContents(v).reduce((a, x) => a + (+x.liters || 0), 0), 0);
    const legend = Object.entries(TCOL).map(([k, c]) => `<span><i style="background:${c}"></i>${{ red: 'Tinto', rose: 'Rosado', white: 'Blanco', orange: 'Naranja', sparkling: 'Espumoso' }[k]}</span>`).join('') + '<span><i style="background:#e3e5e7;border:1px solid #9aa0a6"></i>Vacío</span><span><i class="half"></i>Falta el dato de litros</span>';
    let h = `<div class="tkm-head"><b>${full.length} con vino</b> · ${fmtL(liters)} registrados · toca un tanque para ver o corregir su contenido</div>`;
    if (!TMAP) { loadTMap(); h += `<div class="cr-empty">Cargando el plano…</div>`; }
    else h += tankMapSvg(ts);
    h += `<div class="tkm-legend">${legend}</div>`;
    // Quick view of the tapped tank.
    const sv = C.tkSel && ts.find(v => v.id === C.tkSel);
    if (sv) {
      const items = tankContents(sv), tot = items.reduce((s, x) => s + (+x.liters || 0), 0);
      h += `<div class="tkm-card"><div><b class="tkm-cn">${esc(sv.name)}</b> <small>${fmtL(+sv.cap)}${sv.jacket ? ' · camisa' : ''}${sv.chiller ? ' · ' + esc(String(sv.chiller).split(' (')[0]) : ''}${sv.maker ? ' · ' + esc(sv.maker) : ''}</small></div>
        ${items.length ? items.map(x => `<div class="tkm-cw"><i style="background:${TCOL[lotGroup(x.lot)] || '#9aa5b1'}"></i><b>${esc(lotName(x.lot))}</b> <small>${esc(lotAbbr(x.lot))}</small> · ${x.liters != null ? fmtL(x.liters) + ' / ' + fmtL(+sv.cap) + ' · ' + Math.round(100 * x.liters / (+sv.cap || 1)) + '%' : 'litros sin dato'}${x.auto ? ' <em>según la ficha del vino · confirmar</em>' : ''}</div>`).join('') : '<div class="tkm-cw">Vacío</div>'}
        <div class="tkm-ca">${items.length ? `<button type="button" class="btn sm" data-open="${esc(items[0].lot)}">Ficha del vino</button>` : ''}<button type="button" class="btn sm" data-tk="${esc(sv.id)}">Ver / corregir contenido</button><button type="button" class="btn sm" data-tksel="">Cerrar</button></div></div>`;
    }
    // Every tank in one list, like the plan legend: what's in it at a glance.
    const order = v => ({ front: 0, back: 1 }[v.room] ?? 2);
    const rows = ts.slice().sort((a, b) => order(a) - order(b) || String(a.name).localeCompare(String(b.name), undefined, { numeric: true }));
    h += `<div class="tkm-list"><table><thead><tr><th>Tanque</th><th>Vino</th><th class="n">Litros</th><th class="n">Lleno</th></tr></thead><tbody>${rows.map(v => {
      const items = tankContents(v), tot = items.reduce((s, x) => s + (+x.liters || 0), 0), known = items.some(x => x.liters != null);
      return `<tr data-tksel="${esc(v.id)}" class="${C.tkSel === v.id ? 'sel' : ''}${items.length ? '' : ' mt'}"><td><b>${esc(v.name)}</b>${TMAP && !TMAP.pos[v.id] ? ' <small>fuera del plano</small>' : ''}</td>
        <td>${items.length ? items.map(x => `<i style="background:${TCOL[lotGroup(x.lot)] || '#9aa5b1'}"></i>${esc(lotAbbr(x.lot))} <small>${esc(lotName(x.lot))}</small>`).join('<br>') : '<span class="tk-none">Vacío</span>'}</td>
        <td class="n">${items.length ? (known ? fmtL(tot) : '¿?') + ' / ' : ''}${fmtL(+v.cap)}</td><td class="n">${items.length && known ? Math.round(100 * tot / (+v.cap || 1)) + '%' : items.length ? '¿?' : '—'}</td></tr>`; }).join('')}</tbody></table></div>`;
    return h;
  }
  // Pan / zoom on the plan (viewBox). A drag doesn't count as a tap on a tank.
  let tkDrag = null, tkMoved = false;
  const tkView = svg => { const v = svg.viewBox.baseVal; return { x: v.x, y: v.y, w: v.width, h: v.height }; };
  const tkSet = (svg, v) => svg.setAttribute('viewBox', `${v.x} ${v.y} ${v.w} ${v.h}`);
  const tkZoom = (svg, f, cx, cy) => { const v = tkView(svg); if (cx == null) { cx = v.x + v.w / 2; cy = v.y + v.h / 2; } const w = Math.min(TMAP.W * 2, Math.max(2, v.w * f)), k = w / v.w; tkSet(svg, { x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k, w, h: v.h * k }); };
  const tkPt = (svg, e) => { const r = svg.getBoundingClientRect(), v = tkView(svg), s = Math.max(v.w / r.width, v.h / r.height); const ox = (r.width * s - v.w) / 2, oy = (r.height * s - v.h) / 2; return { x: v.x - ox + (e.clientX - r.left) * s, y: v.y - oy + (e.clientY - r.top) * s, s }; };
  document.addEventListener('wheel', e => { const svg = e.target.closest && e.target.closest('#tkmSvg'); if (!svg) return; e.preventDefault(); const p = tkPt(svg, e); tkZoom(svg, Math.exp(e.deltaY * 0.0015), p.x, p.y); }, { passive: false });
  const tkPtrs = new Map();
  document.addEventListener('pointerdown', e => { const svg = e.target.closest && e.target.closest('#tkmSvg'); if (!svg) return; tkPtrs.set(e.pointerId, e); tkMoved = false; tkDrag = { svg, x: e.clientX, y: e.clientY, v: tkView(svg), d: null }; if (tkPtrs.size === 2) { const [a, b] = [...tkPtrs.values()]; tkDrag.d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY); } });
  document.addEventListener('pointermove', e => {
    if (!tkDrag || !tkPtrs.has(e.pointerId)) return; tkPtrs.set(e.pointerId, e); const svg = tkDrag.svg;
    if (tkPtrs.size === 2 && tkDrag.d) { const [a, b] = [...tkPtrs.values()]; const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY); const p = tkPt(svg, { clientX: (a.clientX + b.clientX) / 2, clientY: (a.clientY + b.clientY) / 2 }); tkZoom(svg, tkDrag.d / d, p.x, p.y); tkDrag.d = d; tkMoved = true; return; }
    const dx = e.clientX - tkDrag.x, dy = e.clientY - tkDrag.y; if (Math.abs(dx) + Math.abs(dy) > 5) tkMoved = true;
    if (tkMoved) { const s = tkPt(svg, e).s; tkSet(svg, { ...tkDrag.v, x: tkDrag.v.x - dx * s, y: tkDrag.v.y - dy * s }); e.preventDefault(); }
  });
  const tkUp = e => { tkPtrs.delete(e.pointerId); if (!tkPtrs.size) setTimeout(() => { tkDrag = null; }, 0); };
  document.addEventListener('pointerup', tkUp); document.addEventListener('pointercancel', tkUp);
  document.addEventListener('click', e => {
    if (e.target.closest && e.target.closest('#tkmSvg') && tkMoved) { e.stopPropagation(); e.preventDefault(); tkMoved = false; return; }
    const z = e.target.closest && e.target.closest('[data-tkz]'); if (!z) return; const svg = $('#tkmSvg'); if (!svg) return;
    if (z.dataset.tkz === 'fit') tkSet(svg, tkFit()); else tkZoom(svg, z.dataset.tkz === 'in' ? 0.7 : 1.4);
  }, true);
  document.addEventListener('keydown', e => { const g = e.target.closest && e.target.closest('.tkm[data-tk]'); if (g && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openTank(g.dataset.tk); } });
  function openTank(id) {
    const v = C.vessels.find(x => x.id === id); if (!v) return;
    const items = tankContents(v), ro = !C.canWrite;
    const lotOpts = sel => `<option value="">— Vacío —</option>` + C.all.filter(l => !l.archived && !l.bottled && l.group !== 'routine').map(l => `<option value="${esc(l.id)}"${l.id === sel ? ' selected' : ''}>${esc(l.name)}</option>`).join('');
    const rows = (items.length ? items : [{ lot: '', liters: null }]);
    const d = sheet(`<form method="dialog" class="cr-form">
      <div class="cr-sh"><h3>${esc(v.name)} <small class="cr-dim">${esc((v.aliases || []).slice(0, 3).join(' · '))}</small></h3></div>
      <p class="cr-help">${fmtL(+v.cap)} · ${esc({ tank: 'tanque', amphora: 'ánfora', puncheon: 'puncheon' }[v.kind] || v.kind || '')}${v.capacity === 'variable' ? ' · tapa flotante' : ''}${v.jacket ? ' · con chaqueta' : ''}${v.maker ? ' · ' + esc(v.maker) : ''}${v.note ? '<br>' + esc(v.note) : ''}</p>
      <fieldset class="tk-spec"><legend>Ficha técnica</legend>
        <label>Modelo (placa del tanque)<input name="model" id="tkModel" value="${esc(v.model || '')}" placeholder="Ej. PZPK 1900 H11"${ro ? ' disabled' : ''}></label>
        <div class="tk-spec2"><label>Pasa-hombre<select name="manway" id="tkManway"${ro ? ' disabled' : ''}>${[['', '—'], ['none', 'No tiene'], ['top', 'Arriba'], ['side', 'Lateral'], ['both', 'Arriba y lateral']].map(([k, l]) => `<option value="${k}"${(v.manway || '') === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
        <label>Medida pasa-hombre<input name="manwaySize" id="tkManwaySize" value="${esc(v.manwaySize || '')}" placeholder="Ej. 560 × 440 mm"${ro ? ' disabled' : ''}></label>
        <label>Tri-clamp válvulas<select name="triclamp" id="tkTri"${ro ? ' disabled' : ''}>${['', '1"', '1.5"', '2"', '2.5"', '3"', 'Mixto'].map(k => `<option value="${esc(k)}"${(v.triclamp || '') === k ? ' selected' : ''}>${k || '—'}</option>`).join('')}</select></label></div>
      </fieldset>
      ${items.some(x => x.auto) ? `<p class="cr-help"><b>Leído de la ficha del vino</b> (no confirmado). Guarda para confirmarlo o corrígelo.</p>` : ''}
      <div class="tk-rows">${rows.map(x => `<div class="tk-row"><label>Vino<select name="lot"${ro ? ' disabled' : ''}>${lotOpts(x.lot)}</select></label><label>Litros<input name="liters" inputmode="decimal" value="${x.liters != null ? esc(x.liters) : ''}"${ro ? ' disabled' : ''}></label></div>`).join('')}</div>
      ${items.length ? `<div class="cr-row">${items.map(x => `<button type="button" class="btn sm" data-open="${esc(x.lot)}">Ficha: ${esc(lotName(x.lot))}</button>`).join('')}</div>` : ''}
      ${v.contents && v.contents.by ? `<p class="cr-help cr-dim">Última actualización: ${esc(v.contents.by)} · ${esc(fmtD(v.contents.at))}</p>` : ''}
      <div class="cr-err" id="crErr"></div>
      <div class="cr-actions"><button type="button" class="btn" data-cancel>Cerrar</button>${ro ? '' : `<button type="button" class="btn" data-tkempty>Vacío</button><button type="submit" class="btn primary">Guardar</button>`}</div>
    </form>`);
    const f = $('form', d);
    f.querySelector('[data-cancel]').onclick = () => d.close();
    f.addEventListener('click', e => { const o = e.target.closest('[data-open]'); if (o) { d.close(); window.dispatchEvent(new CustomEvent('cellar:open', { detail: { lot: o.dataset.open } })); } });
    const save = async items2 => {
      try { await api('vessels/' + encodeURIComponent(v.id), 'PATCH', { model: (f.querySelector('[name="model"]').value || '').trim(), manway: f.querySelector('[name="manway"]').value, manwaySize: (f.querySelector('[name="manwaySize"]').value || '').trim(), triclamp: f.querySelector('[name="triclamp"]').value, contents: { items: items2, by: C.me, at: new Date().toISOString() } }); d.close(); await refresh(); }
      catch (err) { $('#crErr', f).textContent = err.message; }
    };
    const emp = f.querySelector('[data-tkempty]'); if (emp) emp.onclick = () => save([]);
    f.onsubmit = e => { e.preventDefault(); if (ro) return; const lot = f.querySelector('[name="lot"]').value, lit = f.querySelector('[name="liters"]').value; save(lot ? [{ lot, liters: lit ? +String(lit).replace(',', '.') : null }] : []); };
  }
  // Wine page (drawer): small tank tiles for the tanks this wine is in.
  window.cellarTanksFor = lotId => {
    if (!C.loaded) return '';
    const hits = tankList().map(v => ({ v, x: tankContents(v).find(i => i.lot === lotId) })).filter(o => o.x);
    if (!hits.length) return '';
    return `<div class="tk-mini">${hits.map(({ v, x }) => `<span class="tk-mchip" style="--c:${GCOL[lotGroup(lotId)] || '#9aa5b1'}"><i style="height:${x.liters ? Math.min(100, Math.round(100 * x.liters / (+v.cap || 1))) : 50}%"></i><b>${esc(v.name)}</b> ${x.liters ? fmtL(x.liters) + ' / ' : ''}${fmtL(+v.cap)}${x.auto ? ' <em>¿?</em>' : ''}</span>`).join('')}</div>`;
  };

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
    const ls = `<select name="l">${Array.from({ length: row ? +row.levels || 1 : 1 }, (_, i) => `<option value="${i + 1}"${String(i + 1) === (l0 || '1') ? ' selected' : ''}>${i + 1 === 1 ? '1 · piso' : (i + 1) + (i + 1 === (+row.levels || 1) ? ' · arriba' : '')}</option>`).join('')}</select>`;
    return `<div class="cr-locsel"><label>Zona${zs}</label><label>Fila${rs}</label><label>Pos.${ss}</label><label>Nivel${ls}</label></div>`;
  };
  function openBarrel(id, preset) {
    const b = id ? C.barrels.find(x => x.id === id) : Object.assign({ code: '', size: 225, fill: 'full', lot: '', vol: '', loc: '', cooperage: '', wood: '', toast: '', year: '', notes: '' }, preset || {});
    if (!b) return;
    const isNew = !id, ro = !C.canWrite && !C.crew, specOnly = C.crew && !isNew;
    if (isNew && C.crew) return;
    const lotOpts = `<option value="">— Vacía / sin vino —</option>` + ['red', 'rose', 'white', 'orange', 'sparkling'].map(g => { const ls = C.all.filter(l => l.group === g); return ls.length ? `<optgroup label="${{ red: 'Tintos', rose: 'Rosados', white: 'Blancos', orange: 'Naranjas', sparkling: 'Espumosos' }[g]}">${ls.map(l => `<option value="${esc(l.id)}"${l.id === b.lot ? ' selected' : ''}>${esc(l.name)} (${C.vintageOf(l)}${l.code ? ' · ' + esc(l.code) : ''})</option>`).join('')}</optgroup>` : ''; }).join('');
    const d = sheet(`<form method="dialog" class="cr-form">
      <div class="cr-sh"><h3>${isNew ? 'Nueva barrica' : 'Barrica ' + esc(b.code)}</h3>${!isNew ? `<nav class="cr-stabs"><button type="button" data-st="form" aria-selected="true">Datos</button><button type="button" data-st="hist" aria-selected="false">Historial</button><button type="button" data-st="tag" aria-selected="false">Etiqueta</button></nav>` : ''}</div>
      <div class="cr-pane" data-pane="form">
        <div class="g3"><label>Nº barrica<input name="code" inputmode="numeric" required value="${esc(b.code)}" ${isNew ? '' : 'readonly'} placeholder="101"></label><label>Tamaño (L)<input name="size" inputmode="numeric" value="${esc(b.size)}"></label><label>Llenado<select name="fill">${Object.entries(FILL).map(([k, l]) => `<option value="${k}"${(b.fill || 'full') === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label></div>
        <label>Vino<select name="lot">${lotOpts}</select></label>
        <div class="g2"><label>Litros en la barrica<input name="vol" inputmode="decimal" value="${esc(b.vol)}" placeholder="225"></label><label>Año en que se hizo<input name="year" inputmode="numeric" maxlength="4" value="${esc(b.year)}" placeholder="2022"></label></div>
        <label>Ubicación ${b.loc ? `<span class="cr-loc">${esc(b.loc)}</span>` : ''}${locSelects(b.loc)}</label>
        <div class="g3"><label>Tonelería<input name="cooperage" value="${esc(b.cooperage)}" placeholder="Seguin Moreau"></label><label>Madera<select name="wood">${WOOD.map(w => `<option${w === (b.wood || '') ? ' selected' : ''}>${w}</option>`).join('')}</select></label><label>Tipo<select name="use"><option value="">—</option>${Object.entries(USE).map(([k, l]) => `<option value="${k}"${(b.use || useOf(b)) === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label><label>Tostado<input name="toast" value="${esc(b.toast)}" placeholder="M+" list="crToasts"></label></div><datalist id="crToasts"><option>Ligero (L)</option><option>Medio (M)</option><option>Medio+ (M+)</option><option>Fuerte (H)</option></datalist>
        ${specOnly ? '<p class="cr-help">Puedes anotar tonelería, madera, tostado, año y tamaño. Lo demás lo cambian Eric o Diane.</p>' : ''}
        <label>Notas<textarea name="notes" rows="2">${esc(b.notes)}</textarea></label>
        <div class="cr-err" id="crErr"></div>
      </div>
      ${!isNew ? `<div class="cr-pane" data-pane="hist" hidden><div class="cr-empty">Cargando historial…</div></div><div class="cr-pane" data-pane="tag" hidden></div>` : ''}
      <div class="cr-actions">${!isNew && !ro ? `<button type="button" class="btn danger" data-del>Borrar</button>` : ''}<button type="button" class="btn" data-cancel>Cerrar</button>${ro ? '' : `<button type="submit" class="btn primary">Guardar</button>`}</div>
    </form>`);
    const f = $('form', d);
    if (specOnly) f.querySelectorAll('[data-pane="form"] input, [data-pane="form"] select, [data-pane="form"] textarea').forEach(el => { if (!SPEC_KEYS.includes(el.name)) el.disabled = true; });
    f.querySelector('[data-cancel]').onclick = () => d.close();
    f.addEventListener('change', e => { if (e.target.name === 'z' || e.target.name === 'r') { const z = f.z.value, r = e.target.name === 'z' ? '' : f.r.value; const tmp = locSelects(z ? `${z}-${r || ((C.map || DEFAULT_MAP).zones.find(x => x.id === z) || { rows: [{}] }).rows[0].id}-1-1` : ''); f.querySelector('.cr-locsel').outerHTML = tmp; } });
    if (!isNew) {
      f.querySelector('.cr-stabs').addEventListener('click', e => { const t = e.target.closest('[data-st]'); if (!t) return; f.querySelectorAll('[data-st]').forEach(x => x.setAttribute('aria-selected', x === t)); f.querySelectorAll('.cr-pane').forEach(p => p.hidden = p.dataset.pane !== t.dataset.st); if (t.dataset.st === 'hist') loadHistory(b, f.querySelector('[data-pane="hist"]')); if (t.dataset.st === 'tag') renderTag(b, f.querySelector('[data-pane="tag"]')); });
      const del = f.querySelector('[data-del]'); if (del) del.onclick = async () => { if (!confirm('¿Borrar la barrica ' + b.code + ' del registro?')) return; await api('barrels/' + encodeURIComponent(b.id), 'DELETE'); await logEvent(b.code, 'delete', 'Barrica borrada del registro'); d.close(); await refresh(); };
    }
    f.onsubmit = async e => {
      e.preventDefault(); if (ro) return;
      const fd = new FormData(f), code = codeOf(fd.get('code') || b.code);
      if (specOnly) {
        const patch = { use: fd.get('use') || '', size: +fd.get('size') || '', cooperage: String(fd.get('cooperage') || '').trim(), wood: fd.get('wood') || '', toast: String(fd.get('toast') || '').trim(), year: String(fd.get('year') || '').trim(), by: C.me, at: new Date().toISOString() };
        try { await api('barrels/' + encodeURIComponent(b.id), 'PATCH', patch); await logEvent(b.code, 'spec', 'Datos de la barrica: ' + (specLine(patch) || '—')); d.close(); await refresh(); } catch (err) { $('#crErr', f).textContent = err.message; }
        return;
      }
      if (!code) { $('#crErr', f).textContent = 'Falta el número de barrica.'; return; }
      const z = fd.get('z'), loc = z ? [z, fd.get('r'), fd.get('s'), fd.get('l')].join('-') : '';
      const next = { code, use: fd.get('use') || '', size: +fd.get('size') || '', fill: fd.get('fill'), lot: fd.get('lot') || '', vol: fd.get('vol') ? +String(fd.get('vol')).replace(',', '.') : '', loc, cooperage: String(fd.get('cooperage')).trim(), wood: fd.get('wood'), toast: String(fd.get('toast')).trim(), year: String(fd.get('year')).trim(), notes: String(fd.get('notes')).trim(), by: C.me, at: new Date().toISOString() };
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
      const ph = (b.history || []);
      const paper = (b.flag ? `<p class="cr-flag">⚠ ${esc(b.flag)}</p>` : '') + (b.confirmed ? `<p class="cr-help">Confirmado por ${esc(b.confirmed.by || '')} ${fmtD(b.confirmed.at)}: ${esc(b.confirmed.state === 'same' ? 'sigue con ' + (b.confirmed.wine || '') : b.confirmed.state === 'empty' ? 'embotellada / vacía' : b.confirmed.wine || '')}</p>` : '') +
        `<h4>Registros en papel (SO₂) <small>${ph.length}</small></h4>` + (ph.length ? `<ul class="cr-log">${ph.map(r => `<li><span class="cr-ld">${fmtD(r.date)}</span><span class="cr-lk">${esc(r.wine || '')}</span>${[r.ph != null ? 'pH ' + r.ph : '', r.fso2 != null ? 'SO₂L ' + r.fso2 : '', r.kmbs_g != null ? 'KMBS ' + r.kmbs_g + ' g' : '', r.skipped ? 'omitido (ya en meta)' : r.applied ? 'añadido' : ''].filter(Boolean).map(esc).join(' · ')}${r.note && !/^(Añadido|OMITIR)/.test(r.note) ? ' · ' + esc(r.note) : ''}<small>${esc(r.src || '')}</small></li>`).join('')}</ul>` : '<p class="cr-none">Sin registros en papel.</p>');
      pane.innerHTML = paper + `<h4>Movimientos en la app <small>${mine.length}</small></h4>` + (mine.length ? `<ul class="cr-log">${mine.map(r => `<li><span class="cr-ld">${fmtD(r.at)}</span><span class="cr-lk ${esc(r.kind)}">${esc(r.kind)}</span>${esc(r.text)}<small>${esc(r.by || '')}</small></li>`).join('')}</ul>` : '<p class="cr-none">Nada todavía.</p>') +
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
        ${z.rows.map((r, ri) => `<div class="cr-rcfg"><input value="${esc(r.name || '')}" data-rn="${zi}.${ri}" placeholder="Fila"><label>Posiciones <input type="number" min="1" max="40" value="${r.slots}" data-rs="${zi}.${ri}"></label><label>Niveles (alto) <input type="number" min="1" max="${MAX_LEVELS}" value="${r.levels}" data-rl="${zi}.${ri}"></label><button type="button" class="x" data-rdel="${zi}.${ri}" title="Quitar fila">×</button></div>`).join('')}
        <button type="button" class="btn sm" data-radd="${zi}">+ Fila</button></fieldset>`).join('');
    };
    const d = sheet(`<form method="dialog" class="cr-form"><div class="cr-sh"><h3>Mapa de la cava</h3></div>
      <p class="cr-help">Ubicación estándar = <b>Zona-Fila-Posición-Nivel</b> (hasta 4 de alto: 1 = piso, 4 = arriba) (p. ej. <code>A-2-5-1</code> = zona A, fila 2, posición 5, nivel 1 = piso). Define aquí las zonas y filas reales de la bodega; las etiquetas usan estos códigos.</p>
      <div id="crZones"></div><button type="button" class="btn sm" data-zadd>+ Zona</button>
      <div class="cr-actions"><button type="button" class="btn" data-cancel>Cancelar</button><button type="submit" class="btn primary">Guardar mapa</button></div></form>`);
    draw();
    d.addEventListener('input', e => { const t = e.target; if (t.dataset.zn != null) map.zones[+t.dataset.zn].name = t.value; if (t.dataset.rn) { const [z, r] = t.dataset.rn.split('.'); map.zones[z].rows[r].name = t.value; } if (t.dataset.rs) { const [z, r] = t.dataset.rs.split('.'); map.zones[z].rows[r].slots = +t.value || 1; } if (t.dataset.rl) { const [z, r] = t.dataset.rl.split('.'); map.zones[z].rows[r].levels = +t.value || 1; } });
    d.addEventListener('click', e => {
      const t = e.target.closest('button'); if (!t) return;
      if (t.dataset.zadd != null) { const id = String.fromCharCode(65 + map.zones.length); map.zones.push({ id, name: 'Zona ' + id, rows: [{ id: '1', name: 'Fila 1', slots: 8, levels: 4 }] }); draw(); }
      if (t.dataset.radd != null) { const z = map.zones[+t.dataset.radd]; z.rows.push({ id: String(z.rows.length + 1), name: 'Fila ' + (z.rows.length + 1), slots: 8, levels: 4 }); draw(); }
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

  async function refresh() { await load(); render(); showCount(); }
  // The "Cellar" switch shows how many barrels hold wine (full or partial), not how many wines were moved to Cellar.
  function showCount() {
    const n = C.barrels.filter(b => ['full', 'partial'].includes(stateOf(b))).length; window.cellarFullBarrels = n; const el = document.getElementById('wmCellarN'); if (el) { el.textContent = n || ''; el.title = n + ' barricas con vino'; }
    if (C.vessels.length && C.all.length) { const t = tankList().filter(v => tankContents(v).length).length; window.cellarFullTanks = t; const e2 = document.getElementById('wmTankN'); if (e2) { e2.textContent = t || ''; e2.title = t + ' tanques con vino'; } }
  }
  Promise.all([fetch('/api/db/barrels').then(r => r.ok ? r.json() : { rows: [] }), fetch('/api/db/vessels').then(r => r.ok ? r.json() : { rows: [] }), fetch('/api/db/lots').then(r => r.ok ? r.json() : { rows: [] })]).then(([j, v, l]) => {
    if (!C.loaded) { C.barrels = (j.rows || []).map(r => Object.assign({ id: r.id }, r.data)); C.vessels = (v.rows || []).map(r => Object.assign({ id: r.id }, r.data)); if (!C.all.length) C.all = (l.rows || []).map(r => Object.assign({ id: r.id }, r.data)).filter(x => x.group !== 'routine' && !x.archived); }
    showCount(); setTimeout(showCount, 4000);
  }).catch(() => {});
  // One tap from the "Por confirmar" list: what does this barrel hold today?
  async function confirmBarrel(id, how) {
    const b = C.barrels.find(x => x.id === id); if (!b || !C.canWrite) return;
    let wine = (b.paper && b.paper.last) || '';
    if (how === 'other') { wine = (prompt('¿Qué vino tiene la barrica ' + b.code + '?', '') || '').trim(); if (!wine) return; }
    const patch = { confirmed: { state: how, wine: how === 'empty' ? '' : wine, by: C.me, at: new Date().toISOString() }, status: how === 'empty' ? 'empty' : 'confirmed', by: C.me, at: new Date().toISOString() };
    if (how === 'empty') { patch.fill = 'empty'; patch.lot = ''; } else { patch.fill = 'full'; patch.notes = [b.notes, 'Contiene ' + wine + ' (confirmado ' + new Date().toLocaleDateString('es-MX') + ')'].filter(Boolean).join(' · '); }
    try { await api('barrels/' + encodeURIComponent(id), 'PATCH', patch); await logEvent(b.code, how === 'empty' ? 'empty' : 'fill', how === 'empty' ? 'Confirmada: embotellada / vacía' : 'Confirmada: sigue con ' + wine); await refresh(); }
    catch (err) { alert('No se pudo guardar: ' + err.message); }
  }

  // ---------- events ----------
  document.addEventListener('click', e => {
    if (!C.root || !C.root.contains(e.target)) return;
    const cf = e.target.closest('[data-cfm]'); if (cf) { confirmBarrel(cf.dataset.id, cf.dataset.cfm); return; }
    if (e.target.matches && e.target.matches('[data-cpanelbg]')) { C.panel = false; render(); return; }
    const pn = e.target.closest('[data-cpanel]'); if (pn) { C.panel = !C.panel; C.more = false; render(); return; }
    const mo = e.target.closest('[data-cmore]'); if (mo) { C.more = !C.more; render(); return; }
    const cl = e.target.closest('[data-cclear]'); if (cl) { const k = cl.dataset.cclear; if (k === 'use' || k === 'all') C.use = ''; if (k === 'vint' || k === 'all') C.vint = 'all'; if (k === 'loc' || k === 'all') C.noloc = false; render(); return; }
    const lc = e.target.closest('[data-cl]'); if (lc) { C.noloc = lc.dataset.cl === '1'; render(); return; }
    const g2 = e.target.closest('[data-cg2]'); if (g2) { C.group = g2.dataset.cg2; render(); return; }
    if (C.more && !e.target.closest('.cr-morew')) { C.more = false; }
    const ts0 = e.target.closest('[data-tksel]'); if (ts0 && !e.target.closest('[data-tk],[data-open]')) { if (tkMoved && ts0.closest('#tkmSvg')) return; C.tkSel = C.tkSel === ts0.dataset.tksel || !ts0.dataset.tksel ? '' : ts0.dataset.tksel; render(); if (C.tkSel && ts0.tagName === 'TR') { const sv = C.root.querySelector('#tkmSvg'); if (sv) sv.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } else if (C.tkSel) { const c = C.root.querySelector('.tkm-card'); if (c) c.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } return; }
    const t = e.target.closest('[data-ct],[data-tk],[data-cv],[data-cf],[data-cu],[data-ca],[data-bb],[data-loc],[data-open],[data-phase]'); if (!t) { if (!C.more && C.root.querySelector('.cr-menu')) render(); return; }
    if (t.dataset.ca) C.more = false;
    if (t.dataset.ct) { C.tab = t.dataset.ct; C.q = ''; render(); return; }
    if (t.dataset.cv) { C.vint = t.dataset.cv; render(); return; }
    if (t.dataset.cf) { C.filter = t.dataset.cf; render(); return; }
    if (t.dataset.cu != null) { C.use = t.dataset.cu; render(); return; }
    if (t.dataset.ca === 'new') { openBarrel(null, t.dataset.lot ? { lot: t.dataset.lot } : null); return; }
    if (t.dataset.ca === 'import') { openImport(); return; }
    if (t.dataset.ca === 'labels') { printLabels(null); return; }
    if (t.dataset.ca === 'mapcfg') { openMapCfg(); return; }
    if (t.dataset.bb) { openBarrel(t.dataset.bb); return; }
    if (t.dataset.tk) { openTank(t.dataset.tk); return; }
    if (t.dataset.loc) { if (C.canWrite) openAssign(t.dataset.loc); return; }
    if (t.dataset.open) { window.dispatchEvent(new CustomEvent('cellar:open', { detail: { lot: t.dataset.open } })); return; }
    if (t.dataset.phase) { window.dispatchEvent(new CustomEvent('cellar:phase', { detail: { lot: t.dataset.lot, phase: t.dataset.phase } })); return; }
  });
  document.addEventListener('input', e => { if (C.root && C.root.contains(e.target) && e.target.classList.contains('cr-q')) { C.q = e.target.value; const body = $('#crBody', C.root); if (body) body.innerHTML = C.tab === 'map' ? renderMap() : C.tab === 'tanks' ? renderTanks() : renderBarrels(); } });
  document.addEventListener('change', e => { if (C.root && C.root.contains(e.target) && e.target.matches('[data-cg]')) { C.group = e.target.value; render(); } });

  let loading = null;
  window.addEventListener('cellar:render', async e => {
    const d = e.detail || {};
    if (d.tab === 'tanks') C.tab = 'tanks'; else if (C.tab === 'tanks') C.tab = 'barrels';
    C.root = document.getElementById('cellarView'); C.lots = d.lots || []; C.all = d.all || []; C.canWrite = !!d.canWrite; C.crew = !!d.crew; C.vintage = d.vintage || 2026;
    if (d.vintageOf) C.vintageOf = d.vintageOf; if (d.phaseOf) C.phaseOf = d.phaseOf;
    if (!C.loaded) { if (!loading) loading = load().catch(() => { C.loaded = true; }); render(); await loading; }
    render();
    // Deep link from a tag: /b/101 → /?b=101#cellar
    const m = location.search.match(/[?&]b=(\d+)/);
    if (m && !window.__crOpened) { window.__crOpened = true; const b = C.barrels.find(x => x.id === m[1]); if (b) openBarrel(b.id); else if (C.canWrite) openBarrel(null, { code: m[1] }); }
  });
})();
