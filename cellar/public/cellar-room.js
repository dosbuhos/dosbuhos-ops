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
  const USE = { white: 'Blanco', red: 'Tinto', orange: 'Naranja', rose: 'Rosado', port: 'Oporto', vermouth: 'Vermut' };
  const USE_C = { white: '#d8b43c', red: '#7a1f2b', orange: '#d9822b', rose: '#e0849a', port: '#4a2340', vermouth: '#6b7a3a' };
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
  // Coopers from "Instrucciones para control de barricas" (paper codes in brackets, as on the sheet).
  const COOPERS = [["D'Aquitaine", 'AQ'], ['Bel Air', 'BE'], ['Cadus', 'CA'], ['Dargaud & Jaegle', 'DJ'], ['Darnajou', 'DA'], ['De Jarnac', 'JA'], ['European Coopers', 'EC'], ['François Frères', 'FF'], ['Giraud', 'GI'], ['Kalina', 'KA'], ['Master Coopers', 'MC'], ['Montgillard', 'MG'], ['Orion', 'OR'], ['Saint Martin', 'SM'], ['Seguin Moreau', 'SE'], ['Sylvain', 'SY'], ['Taransaud', 'TA'], ['Treuil', 'TR'], ['Vicard', 'VI'], ['Desconocida', 'XX']];
  const TOASTS = ['', 'Ligero (L)', 'Medio (M)', 'Medio+ (M+)', 'Fuerte (H)'];
  // Wine codes on the paper sheet (2 letters + last digit of the vintage), spelled out.
  const WINE_CODES = { AG: 'Aglianico', AN: 'Naranja', AC: 'Naranja carbónico', MO: 'Montepulciano', MP: 'Montepulciano', CF: 'Cabernet Franc', OP: 'Oporto', CH: 'Chardonnay', RC: 'Reserva de la Casa', CN: 'Chenin', SF: 'Syrah–Cab Franc', CO: 'Cabernet orgánico', SY: 'Syrah', CS: 'Cabernet Sauvignon', TC: 'Tempranillo–Cab Sauv', GR: 'Garnacha', TE: 'Tempranillo', MM: 'Merlot–Malbec', ME: 'Merlot', MA: 'Malbec', SB: 'Sauvignon Blanc', SE: 'Semillón', RF: 'Rosado de Cab Franc', RT: 'Rosado Tempranillo', PC: 'Petite Sirah carbónico', FC: 'Cab Franc carbónico', LT: 'Cosecha tardía', VM: 'Vermut', OR: 'Naranja' };
  const wineCode = c => { const m = /^([A-Z]{2})(\d)$/.exec(String(c || '')); return m && WINE_CODES[m[1]] ? WINE_CODES[m[1]] + ' 202' + m[2] : String(c || ''); };
  const fmtD = iso => iso ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso + 'T12:00' : iso).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: '2-digit' }) : '';
  // Barrel numbers always show with 3 digits (79 → 079, 1 → 001); stored codes stay as they are.
  const bn = c => /^\d{1,2}$/.test(String(c == null ? '' : c)) ? String(c).padStart(3, '0') : String(c == null ? '' : c);
  const codeOf = v => String(v == null ? '' : v).replace(/\D/g, '').replace(/^0+(?=\d)/, '');
  // Small barrel drawn in the wine's color (the old square badge read like a calendar date).
  const BARREL_SVG = '<svg class="cr-ico" viewBox="0 0 40 44" aria-hidden="true"><path d="M8 3h24c4 6 5 12 5 19s-1 13-5 19H8C4 35 3 29 3 22S4 9 8 3z" fill="var(--c)"/><path d="M5.2 12h29.6M3.4 22h33.2M5.2 32h29.6" stroke="#1f1d1b" stroke-opacity=".55" stroke-width="2.4" fill="none"/><path d="M8 3h24c4 6 5 12 5 19s-1 13-5 19H8C4 35 3 29 3 22S4 9 8 3z" fill="none" stroke="#1f1d1b" stroke-opacity=".35" stroke-width="1.2"/><path d="M14 4c-2 6-3 12-3 18s1 12 3 18M26 4c2 6 3 12 3 18s-1 12-3 18" stroke="#fff" stroke-opacity=".28" stroke-width="1.2" fill="none"/></svg>';
  const specLine = b => [b.cooperage, b.wood, b.toast ? 'tostado ' + b.toast : '', b.year ? 'hecha en ' + b.year : ''].filter(Boolean).join(' · ');
  const DEFAULT_MAP = { zones: [{ id: 'A', name: 'Sala de barricas', rows: [{ id: '1', name: 'Fila 1', slots: 8, levels: 4 }, { id: '2', name: 'Fila 2', slots: 8, levels: 4 }, { id: '3', name: 'Fila 3', slots: 8, levels: 4 }] }] };

  // who did it: the person picked on this device (the crew shares one account), else the account's initials
  const whoB = () => { try { return localStorage.getItem('fb-by') || C.me || ''; } catch (e) { return C.me || ''; } };
  const C = { root: null, lots: [], all: [], canWrite: false, vintage: 2026, vintageOf: () => 2026, phaseOf: () => 'prod', barrels: [], map: null, tab: 'map', vessels: [], vint: 'all', q: '', filter: 'full', me: '', loaded: false, crew: false, group: 'wine', sheetTabs: {} };

  // ---------- data ----------
  async function load() {
    const [b, m, me, vs] = await Promise.all([api('barrels'), api('barrel_map').catch(() => ({ rows: [] })), fetch('/api/me').then(r => r.json()).catch(() => ({})), api('vessels').catch(() => ({ rows: [] }))]);
    C.vessels = (vs.rows || []).map(r => Object.assign({ id: r.id }, r.data));
    C.barrels = (b.rows || []).map(r => Object.assign({ id: r.id }, r.data)).sort((x, y) => (+x.code || 0) - (+y.code || 0));
    const md = (m.rows || []).find(r => r.id === 'main'); C.map = md ? md.data : null;
    C.me = me.initials || ''; C.loaded = true;
    loadSo2(); loadLogs();
  }
  // ---------- Mantenimiento de barricas (the paper "Mantenimiento quincenal" sheet, in the app) ----------
  // Protocols from "Instrucciones para control de barricas" (10/10/2024). Paper colors: red p1, blue p2, gray/black p3, green fill.
  const PROTO = {
    p1: { n: 'Vaciada', d: 'Al vaciar (máx. 3 días): lavar, vaporizar, azufrar', c: '#b3261e', full: false },
    p2: { n: 'Vacía · mensual', d: 'Mojar por fuera, llenar con agua (si fuga, esperar a que selle), vaciar, vaporizar, azufrar al día siguiente', c: '#2d6fb3', full: false },
    p3: { n: 'Llena · mensual', d: 'Rellenar hasta arriba (vino que indique la enóloga), quitar velo y sanitizar con SO₂, tapones firmes, cisnes con agua y sulfitos', c: '#4a4f54', full: true },
    fill: { n: 'Llenado', d: 'Se llenó después de estar vacía', c: '#2f7d32', full: true },
    top: { n: 'Relleno', d: 'Solo rellenar (sin el resto del mensual)', c: '#6b4a2a', full: true },
    otro: { n: 'Otro', d: 'Algo más: bâtonnage, revisión de fuga, cambio de tapón… (escríbelo en la nota)', c: '#7a6a55', full: null },
  };
  const MANT_DAYS = 30;
  C.logs = []; let logsAt = 0;
  function loadLogs(force) {
    if (!force && Date.now() - logsAt < 120e3) return; logsAt = Date.now();
    return api('barrel_log').then(j => { C.logs = (j.rows || []).map(r => Object.assign({ id: r.id }, r.data)); C.mant = {}; for (const l of C.logs) if (l.kind === 'mant' && l.proto !== 'otro') { const k = String(l.code); if (!C.mant[k] || String(l.at) > String(C.mant[k].at)) C.mant[k] = l; } if (C.root && C.tab === 'barrels') render(); }).catch(() => { logsAt = 0; });
  }
  const mantOf = b => (C.mant || {})[String(b.code)] || null;
  // Due when the last protocol is older than 30 days (or never logged).
  const mantDue = b => { const m = mantOf(b); if (!m) return true; return (Date.now() - new Date(m.at)) / 864e5 > MANT_DAYS; };
  const mantLine = b => {
    const m = mantOf(b);
    if (!m) return `<div class="cr-sub cr-mant due">Mantenimiento: sin registro</div>`;
    const days = Math.round((Date.now() - new Date(m.at)) / 864e5), P = PROTO[m.proto] || {};
    return `<div class="cr-sub cr-mant${days > MANT_DAYS ? ' due' : ''}"><i style="background:${P.c || '#999'}"></i>${esc(P.n || m.proto)} ${esc(fmtD(m.at))} · hace ${days} d${days > MANT_DAYS ? ' · <b>toca</b>' : ''}</div>`;
  };
  function openMant(preset) {
    const bs = C.barrels.slice();
    const groups = new Map(); for (const b of bs) { const k = b.lot ? lotName(b.lot) : stateOf(b) === 'empty' ? 'Vacías' : 'Por confirmar / otras'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(b); }
    const keys = [...groups.keys()].sort((a, b) => (a === 'Vacías') - (b === 'Vacías') || a.localeCompare(b, 'es'));
    const today = new Date(Date.now() - 6 * 3600e3).toISOString().slice(0, 10);
    const d = sheet(`<form class="cr-form cr-mantf" method="dialog"><h3>Registro de mantenimiento masivo</h3><p class="cr-help">Se registra a nombre de <b>${esc(whoB() || '—')}</b>${C.crew ? ' (cámbialo en el mapa: «Registrando como…»)' : ''}.</p>
      <fieldset class="cr-protos">${Object.entries(PROTO).map(([k, P], i) => `<label class="cr-proto"><input type="radio" name="proto" value="${k}"${i === 2 ? ' checked' : ''}><span><b><i style="background:${P.c}"></i>${P.n}</b><small>${P.d}</small></span></label>`).join('')}</fieldset>
      <label>Fecha (el último día, si tomó varios)<input type="date" name="d" value="${today}" max="${today}"></label>
      <div class="cr-p3x"><label>Litros para rellenar (cada barrica)<input name="topL" inputmode="decimal" placeholder="0.7"></label><label>Vino usado para rellenar<input name="topW" placeholder="BBL 15, VC-04…"></label>
      <label class="cr-chk"><input type="checkbox" name="velo"> Había velo (se quitó y sanitizó)</label></div>
      <label>Nota<textarea name="note" rows="2" placeholder="Opcional; para «Otro», qué se hizo"></textarea></label>
      <div class="cr-mpick"><label class="cr-mnums">Escribe números (separados por coma o espacio)<input name="nums" inputmode="numeric" placeholder="44, 48, 51" autocomplete="off"></label><div class="cr-mh"><b>Barricas</b> <small id="crMn">0</small> <button type="button" class="lnk" data-mall="due">Marcar las que tocan</button> <button type="button" class="lnk" data-mall="none">Ninguna</button></div>
      ${keys.map(k => `<div class="cr-mg"><label class="cr-mgh"><input type="checkbox" data-mgrp="${esc(k)}"> <b>${esc(k)}</b> <small>${groups.get(k).length}</small></label><div class="cr-mbs">${groups.get(k).map(b => `<label class="cr-mb${mantDue(b) ? ' due' : ''}"><input type="checkbox" name="bb" value="${esc(b.code)}" data-g="${esc(k)}"${preset && preset.includes(String(b.code)) ? ' checked' : ''}><span>${esc(bn(b.code))}</span></label>`).join('')}</div></div>`).join('')}</div>
      <p class="cr-err" id="crErr"></p><div class="cr-row"><button type="button" class="btn" data-x>Cancelar</button><button type="submit" class="btn primary">Guardar</button></div></form>`, 'cr-wide');
    const f = $('form', d), cnt = () => { $('#crMn', d).textContent = f.querySelectorAll('[name="bb"]:checked').length; };
    const showP3 = () => { const v = (f.querySelector('[name="proto"]:checked') || {}).value; $('.cr-p3x', d).hidden = v !== 'p3' && v !== 'top'; };
    f.nums.addEventListener('input', () => { const ns = (f.nums.value.match(/\d+/g) || []).map(n => String(+n)); f.querySelectorAll('[name="bb"]').forEach(x => { if (ns.includes(String(+x.value))) x.checked = true; }); cnt(); });
    showP3(); cnt();
    if (preset && preset.length) { const pk = $('.cr-mpick', d); pk.hidden = true; pk.insertAdjacentHTML('beforebegin', `<div class="cr-mpre"><b>${preset.length} barrica${preset.length === 1 ? '' : 's'}:</b> ${preset.map(c => esc(bn(c))).join(', ')} <button type="button" class="lnk" data-mshow>Cambiar</button></div>`); $('[data-mshow]', d).onclick = () => { pk.hidden = false; $('.cr-mpre', d).remove(); }; }
    f.addEventListener('change', e => { const g = e.target.dataset.mgrp; if (g != null) f.querySelectorAll(`[name="bb"][data-g="${CSS.escape(g)}"]`).forEach(x => { x.checked = e.target.checked; }); showP3(); cnt(); });
    f.addEventListener('click', e => { const a = e.target.closest('[data-mall]'); if (!a) return; const v = a.dataset.mall, P = (f.querySelector('[name="proto"]:checked') || {}).value;
      f.querySelectorAll('[name="bb"]').forEach(x => { const b = C.barrels.find(y => String(y.code) === x.value); x.checked = v === 'due' && !!b && mantDue(b) && (!P || PROTO[P].full == null || (PROTO[P].full ? stateOf(b) !== 'empty' : stateOf(b) === 'empty')); }); cnt(); });
    $('[data-x]', d).onclick = () => d.close();
    f.onsubmit = async e => {
      e.preventDefault();
      const proto = f.proto.value, date = f.d.value, codes = [...f.querySelectorAll('[name="bb"]:checked')].map(x => x.value);
      if (!codes.length) { $('#crErr', d).textContent = 'Marca al menos una barrica.'; return; }
      if (proto === 'otro' && !f.note.value.trim()) { $('#crErr', d).textContent = 'Escribe en la nota qué se hizo.'; f.note.focus(); return; }
      const P = PROTO[proto], extra = proto === 'p3' || proto === 'top' ? [f.topL.value ? 'rellenada ' + f.topL.value + ' L' + (f.topW.value ? ' con ' + f.topW.value : '') : '', f.velo.checked ? 'velo quitado' : ''].filter(Boolean) : [];
      const text = [P.n, ...extra, f.note.value.trim()].filter(Boolean).join(' · ');
      const btn = f.querySelector('[type="submit"]'); btn.disabled = true; btn.textContent = 'Guardando…';
      let n = 0;
      for (const code of codes) {
        const doc = { code: String(code), at: date + 'T12:00:00.000Z', by: whoB(), acct: C.me, kind: 'mant', proto, text, src: 'app' };
        doc.extra = [...extra, f.note.value.trim()].filter(Boolean).join(' · ');
        if (proto === 'p3' || proto === 'top') { if (f.topL.value) doc.topL = +f.topL.value || f.topL.value; if (f.topW.value) doc.topW = f.topW.value; if (f.velo.checked) doc.velo = true; }
        try { await api('barrel_log/' + encodeURIComponent('b' + code + '-m' + date.replace(/-/g, '') + proto + '-' + Date.now().toString(36)), 'PUT', doc); n++; } catch (err) { $('#crErr', d).textContent = 'Barrica ' + code + ': ' + err.message; }
      }
      btn.disabled = false; btn.textContent = 'Guardar';
      if (n === codes.length) { d.close(); await loadLogs(true); render(); }
    };
  }

  // Free SO2 + last addition per barrel, from Excellovint (refreshed at most every 10 min: it scans the whole log).
  let so2At = 0;
  function loadSo2() {
    if (Date.now() - so2At < 600e3) return; so2At = Date.now();
    fetch('/api/xl/barrel-so2').then(r => r.ok ? r.json() : null).then(j => { if (j && j.barrels) { C.so2 = j.barrels; if (C.root && C.tab === 'barrels') render(); } }).catch(() => { so2At = 0; });
  }
  const daysOld = iso => iso ? Math.round((Date.now() - new Date(iso + 'T12:00')) / 864e5) : null;
  const so2Line = b => {
    const x = C.so2 && C.so2[String(+b.code)]; if (!x || !b.lot) return '';
    const r = x.so2, a = x.add, old = r && daysOld(r.d) > 14;
    const rd = r ? `<span class="cr-so2v${old ? ' old' : ''}${/^</.test(r.v) || +r.v < 10 ? ' low' : ''}">SO₂ libre ${esc(r.v)}</span> ${esc(fmtD(r.d))}${a && a.tab === r.tab && a.row === r.row ? ' <small>(antes de agregar)</small>' : ''}` : '<span class="cr-so2v none">SO₂ libre sin lectura</span>';
    const ad = a ? ` · <span class="cr-so2a">+${a.g ? esc(a.g) + ' g' : ''}${a.g && a.ppm ? ' · ' : ''}${a.ppm ? esc(a.ppm) + ' ppm' : ''} ${esc(fmtD(a.d))}</span>` : '';
    return `<div class="cr-sub cr-so2">${rd}${ad}</div>`;
  };
  const lotById = id => C.all.find(l => l.id === id);
  const lotName = id => { const l = lotById(id); return l ? l.name : (id || ''); };
  const lotGroup = id => { const l = lotById(id); return l ? l.group : ''; };
  // Short label for a lot on the tank plan: its Excellovint tab ("L08 - SE" → "L08 SE"), else the first words of its name.
  const lotAbbr = id => { const l = lotById(id); if (!l) return id || ''; const t = ((l.sheet || []).find(s => !s.archived) || {}).tab; return t ? String(t).replace(/\s*-\s*/g, ' ').replace(/\s+/g, ' ').trim() : String(l.name).split(/\s+/).slice(0, 2).join(' '); };
  const barrelsOf = lot => C.barrels.filter(b => b.lot === lot.id);
  // Filters can combine: several wine types and several vintages at once (empty set = all).
  C.uses = C.uses || new Set(); C.vints = C.vints || new Set();
  const vintOK = l => !C.vints.size || [...C.vints].some(v => v === 'old' ? C.vintageOf(l) < C.vintage - 2 : C.vintageOf(l) === +v);
  // Barrels stack up to 4 high: level 1 = on the floor, 4 = top.
  const MAX_LEVELS = 4;
  const lvName = lv => +lv === 1 ? 'piso' : 'nivel ' + lv;
  const locLabel = loc => {
    if (!loc) return '';
    if (!/^[A-Z]-\d+-\d+-\d+$/.test(String(loc))) { const b = C.barrels.find(x => x.loc === loc); return (b && b.locName) || String(loc); }
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
    await api('barrel_log/' + encodeURIComponent('b' + code + '-' + Date.now().toString(36)), 'PUT', { code: String(code), at, by: whoB(), acct: C.me, kind, text }).catch(() => {});
  }

  // ---------- shell ----------
  // Layout (v1.3.9): tabs · one toolbar row (search, Filtros n, + Barrica, ⋯ more) · one status row · chips only when a filter is on.
  // Vintage, barrel type, "sin ubicación" and grouping live in the Filtros sheet; Importar / Etiquetas QR / Configurar mapa in ⋯.
  C.panel = false; C.more = false; C.noloc = false;
  const ICON_F = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4"/></svg>';
  const ICON_S = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>';
  function nFilters() { return C.vints.size + C.uses.size + (C.noloc ? 1 : 0); }
  function vintChips() {
    const vints = [...new Set(C.all.map(l => C.vintageOf(l)))].sort((a, b) => b - a);
    return [['all', 'Todas']].concat(vints.filter(v => v >= C.vintage - 2).map(v => [String(v), String(v)])).concat(vints.some(v => v < C.vintage - 2) ? [['old', 'Anteriores']] : []);
  }
  function render() {
    if (!C.root) return;
    if (!C.loaded) { C.root.innerHTML = '<div class="cr-empty">Cargando bodega…</div>'; return; }
    if (C.tab === 'wines') C.tab = 'map';
    const tabs = C.tab === 'tanks' ? '' : `<div class="cr-view" role="tablist" aria-label="Vista">
        <button type="button" role="tab" data-ct="map" aria-selected="${C.tab === 'map'}">Mapa</button>
        <button type="button" role="tab" data-ct="barrels" aria-selected="${C.tab === 'barrels'}">Lista</button>
      </div>`;
    let tool = '';
    if (C.tab === 'barrels') {
      const n = nFilters();
      tool = `<div class="cr-tool cr-tool1">${tabs}
        <label class="cr-search">${ICON_S}<input type="search" class="cr-q" placeholder="Buscar barrica, vino, lugar" value="${esc(C.q)}" aria-label="Buscar barrica"></label>
        <button type="button" class="cr-fbtn${n ? ' on' : ''}" data-cpanel aria-expanded="${C.panel}">${ICON_F}<span>Filtros</span>${n ? `<b>${n}</b>` : ''}</button>
        ${C.canWrite || C.crew ? `<button type="button" class="btn sm cr-mantb" data-ca="mant">Registro masivo</button>` : ''}
        <span class="cr-morew"><button type="button" class="cr-more" data-cmore aria-expanded="${C.more}" aria-label="Más opciones"><i class="cr-more-i" aria-hidden="true">⋯</i><span class="cr-more-l">Más</span></button>${C.more ? `<div class="cr-menu" role="menu">
          ${C.canWrite ? `<button type="button" role="menuitem" data-ca="new">+ Nueva barrica</button>` : ''}
          ${C.canWrite ? `<button type="button" role="menuitem" data-ca="import">Importar inventario</button>` : ''}
          ${C.canWrite || C.crew ? `<button type="button" role="menuitem" data-ca="mant">Registro de mantenimiento masivo</button>` : ''}
          <button type="button" role="menuitem" data-ca="labels">Imprimir etiquetas QR</button>
          ${C.canWrite ? `<button type="button" role="menuitem" data-ca="mapcfg">Configurar mapa</button>` : ''}</div>` : ''}</span>
      </div>`;
    }
    C.root.innerHTML = `<div class="cr">${C.tab === 'barrels' ? '' : tabs}${tool}<div class="cr-body" id="crBody"></div></div>`;
    const body = $('#crBody', C.root);
    body.innerHTML = C.tab === 'map' ? renderMap() : C.tab === 'tanks' ? renderTanks() : renderBarrels();
    if (C.tab === 'map') mountMap();
  }
  // Filtros sheet (bottom sheet on phones, centered card on desktop).
  function filterPanel() {
    const uses = [['', 'Todas'], ['white', 'Blanco'], ['red', 'Tinto'], ['orange', 'Naranja'], ['rose', 'Rosado'], ['none', 'Sin tipo']];
    const segM = (attr, list, set, none) => `<div class="cr-pseg">${list.map(([k, l, dot]) => `<button type="button" ${attr}="${k}" aria-pressed="${k === none ? !set.size : set.has(k)}">${dot ? `<i style="background:${dot}"></i>` : ''}${l}</button>`).join('')}</div>`;
    const seg = (attr, list, cur) => `<div class="cr-pseg">${list.map(([k, l, dot]) => `<button type="button" ${attr}="${k}" aria-pressed="${cur === k}">${dot ? `<i style="background:${dot}"></i>` : ''}${l}</button>`).join('')}</div>`;
    return `<div class="cr-panel" data-cpanelbg><div class="cr-pin" role="dialog" aria-label="Filtros">
      <div class="cr-ph"><b>Filtros</b><button type="button" class="cr-px" data-cpanel aria-label="Cerrar">×</button></div>
      <div class="cr-plbl">Tipo de barrica <small>(puedes elegir varios)</small></div>${segM('data-cu', uses.map(([k, l]) => [k, l, USE_C[k]]), C.uses, '')}
      <div class="cr-plbl">Añada del vino <small>(puedes elegir varias)</small></div>${segM('data-cv', vintChips(), C.vints, 'all')}
      <div class="cr-plbl">Ubicación</div>${seg('data-cl', [['', 'Todas'], ['1', 'Sin ubicación']], C.noloc ? '1' : '')}
      <div class="cr-psort"><div class="cr-plbl">Ordenar por</div>${seg('data-csortb', SORTS, C.sortB || 'type')}</div>
      <div class="cr-pfoot">${nFilters() ? `<button type="button" class="cr-clear" data-cclear="all">Quitar filtros</button>` : '<span></span>'}<button type="button" class="btn primary" data-cpanel>Listo</button></div>
    </div></div>`;
  }
  // ---------- Lista: one row per barrel, select rows, bulk actions (v1.9) ----------
  C.selB = C.selB || new Set(); C.openB = C.openB || new Set();
  const SORTS = [['type', 'Tipo de vino'], ['wine', 'Vino'], ['vint', 'Añada'], ['loc', 'Ubicación'], ['mant', 'Mantenimiento'], ['num', 'Número']];
  const typeOf = b => { const st = stateOf(b); if (st === 'confirm') return 'confirm'; if (st === 'empty') return 'empty'; return lotGroup(b.lot) || useOf(b) || 'other'; };
  const TYPE_N = { red: 'Tintos', white: 'Blancos', orange: 'Naranjas', rose: 'Rosados', sparkling: 'Espumosos', port: 'Oporto', vermouth: 'Vermut', other: 'Con vino (sin tipo)', confirm: 'Por confirmar', empty: 'Vacías' };
  const TYPE_O = ['red', 'rose', 'orange', 'white', 'sparkling', 'port', 'vermouth', 'other', 'confirm', 'empty'];
  const vintB = b => { const l = lotById(b.lot); return l ? C.vintageOf(l) : ''; };
  const mantDays = b => { const m = mantOf(b); return m ? Math.round((Date.now() - new Date(m.at)) / 864e5) : null; };
  const so2Cell = b => { const x = C.so2 && C.so2[String(+b.code)], r = x && x.so2; if (!r || !b.lot) return '<span class="cr-dim">—</span>'; const low = /^</.test(r.v) || +r.v < 10, old = daysOld(r.d) > 14; return `<span class="cr-so2v${low ? ' low' : ''}${old ? ' old' : ''}">${esc(r.v)}</span><small>${esc(fmtD(r.d))}</small>`; };
  const mantCell = b => { const m = mantOf(b), d = mantDays(b); if (!m) return '<span class="cr-due">Sin registro</span>'; const P = PROTO[m.proto] || {}; return `<span class="${d > MANT_DAYS ? 'cr-due' : ''}"><i class="cr-pdot" style="background:${P.c || '#999'}"></i>${d > MANT_DAYS ? 'Toca · ' : ''}hace ${d} d</span><small>${esc(P.n || '')}</small>`; };
  const locShort = b => b.loc ? (b.locName || locLabel(b.loc)) : '';
  function renderBarrels() {
    const q = C.q.trim().toLowerCase();
    let bs = C.barrels.filter(b => !q || (b.code + ' ' + bn(b.code) + ' ' + lotName(b.lot) + ' ' + locShort(b) + ' ' + (b.cooperage || '') + ' ' + (b.toast || '') + ' ' + (b.year || '') + ' ' + (b.notes || '')).toLowerCase().includes(q));
    if (C.vints.size) bs = bs.filter(b => { if (stateOf(b) === 'empty' || stateOf(b) === 'confirm') return true; const l = lotById(b.lot); return l ? vintOK(l) : false; });
    if (C.uses.size) bs = bs.filter(b => C.uses.has(useOf(b) || 'none'));
    if (C.noloc) bs = bs.filter(b => !b.loc);
    const counts = { all: bs.length }; for (const k of ['confirm', 'full', 'partial', 'empty']) counts[k] = bs.filter(b => stateOf(b) === k).length;
    counts.full += counts.partial; counts.due = bs.filter(mantDue).length;
    if (C.filter === 'full') bs = bs.filter(b => ['full', 'partial'].includes(stateOf(b))); else if (C.filter === 'due') bs = bs.filter(mantDue); else if (C.filter !== 'all') bs = bs.filter(b => stateOf(b) === C.filter);
    const st = [['all', 'Todas'], ['full', 'Con vino'], ['empty', 'Vacías'], ['due', 'Toca mantenimiento']].concat(counts.confirm ? [['confirm', 'Por confirmar']] : []);
    const fchips = st.map(([k, l]) => `<button type="button" data-cf="${k}" aria-pressed="${C.filter === k}"><span>${l}</span><small>${counts[k]}</small></button>`).join('');
    const chips = []; for (const u of C.uses) chips.push(['use:' + u, u === 'none' ? 'Sin tipo' : USE[u]]); for (const v of C.vints) chips.push(['vint:' + v, v === 'old' ? 'Añadas anteriores' : 'Añada ' + v]); if (C.noloc) chips.push(['loc', 'Sin ubicación']);
    let h = `<div class="cr-subbar"><div class="cr-status cr-status2" role="group" aria-label="Estado">${fchips}</div><button type="button" class="cr-sortln" data-cpanel>Orden: <b>${esc((SORTS.find(x => x[0] === (C.sortB || 'type')) || SORTS[0])[1])}</b> ▾</button><label class="cr-lsort"><span>Ordenar</span><select data-csort>${SORTS.map(([k, l]) => `<option value="${k}"${k === (C.sortB || 'type') ? ' selected' : ''}>${l}</option>`).join('')}</select></label></div>` +
      (chips.length ? `<div class="cr-chips2">${chips.map(([k, l]) => `<button type="button" class="cr-fchip" data-cclear="${k}">${esc(l)} <b aria-hidden="true">×</b></button>`).join('')}<button type="button" class="cr-clear" data-cclear="all">Quitar filtros</button></div>` : '') + (C.panel ? filterPanel() : '');
    if (!C.barrels.length) return h + `<div class="cr-empty"><strong>Todavía no hay barricas registradas.</strong>Usa «Importar» o «+ Barrica».</div>`;
    // sort + group
    const sortBy = C.sortB || 'type';
    const numCmp = (a, b) => (+a.code || 0) - (+b.code || 0);
    const cmp = { num: numCmp, wine: (a, b) => lotName(a.lot).localeCompare(lotName(b.lot), 'es') || numCmp(a, b), vint: (a, b) => (+vintB(b) || 0) - (+vintB(a) || 0) || numCmp(a, b), loc: (a, b) => locShort(a).localeCompare(locShort(b), 'es', { numeric: true }) || numCmp(a, b), mant: (a, b) => (mantDays(b) ?? 9999) - (mantDays(a) ?? 9999) || numCmp(a, b), type: (a, b) => lotName(a.lot).localeCompare(lotName(b.lot), 'es') || numCmp(a, b) }[sortBy];
    bs = bs.slice().sort(cmp);
    const groupKey = sortBy === 'type' ? b => typeOf(b) : sortBy === 'vint' ? b => (stateOf(b) === 'empty' ? 'empty' : vintB(b) || 'Sin añada') : sortBy === 'wine' ? b => (b.lot ? lotName(b.lot) : TYPE_N[typeOf(b)]) : null;
    const gname = k => TYPE_N[k] || String(k);
    const ids = new Set(bs.map(b => b.id)); for (const id of [...C.selB]) if (!C.barrels.some(b => b.id === id)) C.selB.delete(id);
    const nSel = C.selB.size, allOn = bs.length && bs.every(b => C.selB.has(b.id));
    if (nSel) h += `<div class="cr-bulk on" role="region" aria-label="Acciones en lote"><b>${nSel + ' seleccionada' + (nSel === 1 ? '' : 's')}</b>${nSel ? `<select data-cbulk aria-label="Acción en lote"><option value="">Acciones…</option>${C.canWrite || C.crew ? '<option value="mant">Registrar mantenimiento</option><option value="so2">Registrar SO₂</option><option value="wine">Cambiar vino</option><option value="empty">Marcar vacías</option>' : ''}<option value="labels">Imprimir etiquetas QR</option></select><button type="button" class="cr-clear" data-cselnone>Quitar selección</button>` : ''}</div>`;
    if (!bs.length) return h + `<div class="cr-empty">Ninguna barrica coincide.</div>`;
    const row = b => {
      const stt = stateOf(b), g = lotGroup(b.lot), u = useOf(b), col = b.lot ? (GCOL[g] || '#9aa5b1') : stt === 'confirm' ? '#d79a1f' : 'transparent';
      const wine = b.discarded ? '<span class="cr-disc">✕ Descartada</span>' : b.lot ? esc(lotName(b.lot)) : stt === 'confirm' ? `<span class="cr-cf">Por confirmar</span>${b.paper && b.paper.last ? ` <small>papel: ${esc(b.paper.last)}</small>` : ''}` : '<span class="cr-none">Vacía</span>';
      // phones: two dense lines — BBL nº · vino · 📍 lugar / tonelería · SO₂ · relleno; tapping the row opens the card
      const m = mantOf(b), md = mantDays(b), x = C.so2 && C.so2[String(+b.code)], r = x && x.so2;
      const coop = [b.cooperage, b.wood, b.year].filter(Boolean).join(' · ');
      const so2T = r ? `<span class="c-pso2${/^</.test(r.v) || +r.v < 10 ? ' low' : ''}${daysOld(r.d) > 14 ? ' old' : ''}">SO₂ <b>${esc(r.v)}</b></span>` : b.lot ? '<span class="c-pso2 none">SO₂ —</span>' : '';
      const fillT = `<span class="c-pfill${!m || md > MANT_DAYS ? ' due' : ''}">${b.lot ? 'Relleno' : 'Mant.'}${m ? (md > MANT_DAYS ? ' tarde' : '') + ' ' + md + ' d' : ' —'}</span>`;
      const ph = `<div class="c-ph"><div class="c-ph1"><b>BBL&#8239;${esc(bn(b.code))}</b><i class="cr-wdot" style="background:${col}"></i><span class="c-phw">${wine}</span>${b.loc ? `<span class="c-phl">📍${esc(locShort(b))}</span>` : ''}</div>
          <div class="c-ph2">${fillT}${so2T}${coop ? `<span class="c-pcoop">${esc(coop)}</span>` : '<span class="c-pcoop cr-dim">tonelería ?</span>'}</div></div>`;
      return `<div class="cr-tr${C.selB.has(b.id) ? ' sel' : ''}" data-bbrow="${esc(b.id)}" role="row">
        <label class="cr-td c-sel" aria-label="Seleccionar ${esc(bn(b.code))}"><input type="checkbox" data-bsel="${esc(b.id)}"${C.selB.has(b.id) ? ' checked' : ''}></label>
        <div class="cr-td c-num"><b>${esc(bn(b.code))}</b></div>
        <div class="cr-td c-wine"><i class="cr-wdot" style="background:${col}"></i><span>${wine}</span>${u ? `<span class="cr-use-t" style="--u:${USE_C[u]}">${USE[u]}</span>` : ''}</div>
        <div class="cr-td c-vint">${esc(vintB(b) || '')}</div>
        <div class="c-meta">
        <div class="cr-td c-loc">${b.loc ? '<i class="cr-ph-l" aria-hidden="true">📍 </i>' + esc(locShort(b)) : '<span class="cr-dim">sin ubicación</span>'}</div>
        <div class="cr-td c-so2"><i class="cr-ph-l">SO₂ </i>${so2Cell(b)}</div>
        <div class="cr-td c-mant">${mantCell(b)}</div>
        </div>
        <div class="cr-td c-spec">${esc([b.cooperage, b.wood, b.year, b.toast ? 'T ' + b.toast : ''].filter(Boolean).join(' · ')) || '<span class="cr-dim">—</span>'}</div>
        ${ph}
      </div>`;
    };
    const head = `<div class="cr-tr cr-th" role="row"><label class="cr-td c-sel" aria-label="Seleccionar todas"><input type="checkbox" data-bselall${allOn ? ' checked' : ''}></label><div class="cr-td c-num">Nº</div><div class="cr-td c-wine">Vino</div><div class="cr-td c-vint">Añada</div><div class="cr-td c-loc">Ubicación</div><div class="cr-td c-so2">SO₂ libre</div><div class="cr-td c-mant">Mantenimiento</div><div class="cr-td c-spec">Barrica</div></div>`;
    let body = '';
    if (!groupKey) body = bs.map(row).join('');
    else {
      const by = new Map(); for (const b of bs) { const k = groupKey(b); if (!by.has(k)) by.set(k, []); by.get(k).push(b); }
      const keys = [...by.keys()].sort((a, b) => sortBy === 'type' ? TYPE_O.indexOf(a) - TYPE_O.indexOf(b) : sortBy === 'vint' ? (a === 'empty') - (b === 'empty') || (+b || 0) - (+a || 0) : String(a).localeCompare(String(b), 'es'));
      for (const k of keys) { const list = by.get(k), on = list.every(b => C.selB.has(b.id)); body += `<div class="cr-tg" role="row"><div class="cr-tgh"><b>${esc(sortBy === 'vint' && k === 'empty' ? 'Vacías' : gname(k))}</b> <small>${list.length}</small></div><label class="cr-tgsel"><input type="checkbox" data-bselg="${esc(list.map(b => b.id).join(','))}"${on ? ' checked' : ''}> <span>Elegir todas</span></label></div>` + list.map(row).join(''); }
    }
    return h + `<div class="cr-table" role="table" aria-label="Barricas">${head}${body}</div>`;
  }
  function selCodes() { return C.barrels.filter(b => C.selB.has(b.id)); }
  async function bulk(action) {
    const bs = selCodes(); if (!bs.length) return;
    if (action === 'labels') { printLabels(bs); return; }
    if (action === 'mant') { openMant(bs.map(b => String(b.code))); return; }
    if (action === 'so2') { openBulkSo2(bs); return; }
    if (action === 'wine' || action === 'empty') {
      const d = sheet(`<form class="cr-form" method="dialog"><h3>${action === 'wine' ? 'Cambiar vino' : 'Marcar vacías'} · ${bs.length} barrica${bs.length === 1 ? '' : 's'}</h3>
        <p class="cr-help">${bs.map(b => esc(bn(b.code))).join(', ')}</p>${action === 'wine' ? winePicker('') : '<p class="cr-help">Quedan sin vino. Se anota en el historial de cada barrica.</p>'}
        <p class="cr-err" id="crErr"></p><div class="cr-row"><button type="button" class="btn" data-x>Cancelar</button><button type="submit" class="btn primary">Guardar</button></div></form>`);
      const f = $('form', d); if (action === 'wine') wirePicker(f); $('[data-x]', d).onclick = () => d.close();
      f.onsubmit = async e => { e.preventDefault(); let lot = '';
        if (action === 'wine') { lot = f.querySelector('[name="lot"]').value; if (lot === '__new') { try { lot = await newWineFrom(f); } catch (err) { $('#crErr', d).textContent = err.message; return; } } if (!lot) { $('#crErr', d).textContent = 'Elige el vino.'; return; } }
        const btn = f.querySelector('[type="submit"]'); btn.disabled = true; btn.textContent = 'Guardando…'; const at = new Date().toISOString();
        for (const b of bs) { const patch = lot ? { lot, fill: 'full', status: 'occupied2026', by: whoB(), acct: C.me, at } : { lot: '', fill: 'empty', by: whoB(), acct: C.me, at };
          if (needsConfirm(b)) { patch.confirmed = { state: lot ? 'other' : 'empty', wine: lot ? lotName(lot) : '', by: whoB(), acct: C.me, at }; if (!lot) patch.status = 'empty'; }
          try { await api('barrels/' + encodeURIComponent(b.id), 'PATCH', patch); await logEvent(b.code, lot ? 'fill' : 'empty', lot ? 'Con ' + lotName(lot) + ' (en lote)' : 'Vacía (antes: ' + (lotName(b.lot) || '—') + ', en lote)'); } catch (err) { $('#crErr', d).textContent = 'Barrica ' + b.code + ': ' + err.message; btn.disabled = false; btn.textContent = 'Guardar'; return; } }
        d.close(); C.selB.clear(); await refresh(); };
    }
  }
  function openBulkSo2(bs) {
    const today = new Date(Date.now() - 6 * 3600e3).toISOString().slice(0, 10);
    const d = sheet(`<form class="cr-form" method="dialog"><h3>Registrar SO₂ · ${bs.length} barrica${bs.length === 1 ? '' : 's'}</h3>
      <fieldset class="cr-protos"><label class="cr-proto"><input type="radio" name="k" value="read" checked><span><b>Lectura</b><small>SO₂ libre medido (ppm). Si cada barrica dio distinto, escríbelo por barrica abajo.</small></span></label><label class="cr-proto"><input type="radio" name="k" value="add"><span><b>Adición</b><small>Gramos de KMBS agregados a cada barrica.</small></span></label></fieldset>
      <div class="g2"><label>Fecha<input type="date" name="d" value="${today}" max="${today}"></label><label class="cr-k-read">SO₂ libre (ppm) para todas<input name="v" inputmode="decimal" placeholder="25"></label><label class="cr-k-add" hidden>KMBS (g) por barrica<input name="g" inputmode="decimal" placeholder="6"></label></div>
      <div class="cr-k-read cr-so2each">${bs.map(b => `<label>${esc(bn(b.code))}<input name="v_${esc(b.id)}" inputmode="decimal" placeholder="—"></label>`).join('')}</div>
      <label>Nota (opcional)<textarea name="note" rows="2"></textarea></label>
      <p class="cr-err" id="crErr"></p><div class="cr-row"><button type="button" class="btn" data-x>Cancelar</button><button type="submit" class="btn primary">Guardar</button></div></form>`, 'cr-wide');
    const f = $('form', d); $('[data-x]', d).onclick = () => d.close();
    f.addEventListener('change', () => { const k = f.k.value; f.querySelectorAll('.cr-k-read').forEach(x => x.hidden = k !== 'read'); f.querySelectorAll('.cr-k-add').forEach(x => x.hidden = k !== 'add'); });
    f.onsubmit = async e => { e.preventDefault(); const k = f.k.value, date = f.d.value, num = v => { const x = parseFloat(String(v || '').replace(',', '.')); return isFinite(x) ? x : null; };
      const all = num(k === 'read' ? f.v.value : f.g.value); let n = 0;
      for (const b of bs) { const v = k === 'read' ? (num(f['v_' + b.id] && f['v_' + b.id].value) ?? all) : all; if (v == null) continue;
        const doc = { code: String(b.code), at: date + 'T12:00:00.000Z', by: whoB(), acct: C.me, kind: 'so2', so2kind: k, fso2: k === 'read' ? v : null, kmbs_g: k === 'add' ? v : null, note: f.note.value.trim(), text: k === 'read' ? 'Lectura SO₂ libre ' + v + ' ppm' : 'Adición de SO₂: KMBS ' + v + ' g', src: 'app' };
        try { await api('barrel_log/' + encodeURIComponent('b' + b.code + '-s' + date.replace(/-/g, '') + '-' + Date.now().toString(36)), 'PUT', doc); n++; } catch (err) { $('#crErr', d).textContent = err.message; return; } }
      if (!n) { $('#crErr', d).textContent = k === 'read' ? 'Escribe la lectura.' : 'Escribe los gramos.'; return; }
      d.close(); C.selB.clear(); await loadLogs(true); render(); };
  }
  // ---------- the barrel card (same page as the map: /barricas.html?b=NNN) ----------
  function openCard(id, tab) {
    const b = C.barrels.find(x => x.id === id); if (!b) return;
    let d = $('#crCard'); if (!d) { d = document.createElement('dialog'); d.id = 'crCard'; d.className = 'cr-card'; document.body.appendChild(d); d.addEventListener('click', e => { if (e.target === d) d.close(); }); d.addEventListener('close', () => { d.innerHTML = ''; if (d.dataset.hist === '1') { d.dataset.hist = ''; try { history.back(); } catch (e) {} } if (C.dirty) { C.dirty = false; refresh(); } });
      // the phone's Back button closes the card instead of leaving the app
      window.addEventListener('popstate', () => { if (d.open) { d.dataset.hist = ''; d.close(); } }); }
    d.innerHTML = `<iframe title="Barrica ${esc(bn(b.code))}" src="/barricas.html?b=${encodeURIComponent(b.code)}${tab ? '&tab=' + tab : ''}"></iframe>`;
    if (!d.open) { d.showModal(); try { history.pushState({ crCard: id }, ''); d.dataset.hist = '1'; } catch (e) {} }
  }
  let mapFrame = null;
  // One scroll for the whole page: the map frame is as tall as its content, and is told which part of it is on screen.
  let vpRaf = 0;
  function sendVp() { if (!mapFrame || !mapFrame.isConnected || !mapFrame.contentWindow) return; const r = mapFrame.getBoundingClientRect(), nav = window.innerWidth <= 760 ? 64 : 0;
    try { mapFrame.contentWindow.postMessage({ type: 'bm:vp', top: Math.max(0, Math.round(-r.top)), h: Math.max(200, Math.round(Math.min(window.innerHeight - nav, r.bottom) - Math.max(0, r.top))) }, location.origin); } catch (e) {} }
  // The page may scroll in a container rather than the window: scroll whichever ancestor actually scrolls.
  function scroller(el) { for (let n = el && el.parentElement; n && n !== document.body; n = n.parentElement) { const o = getComputedStyle(n).overflowY; if ((o === 'auto' || o === 'scroll') && n.scrollHeight > n.clientHeight + 2) return n; } return document.scrollingElement || document.documentElement; }
  function scrollFrameTo(y) { const sc = scroller(mapFrame), r = mapFrame.getBoundingClientRect(), top0 = sc === document.scrollingElement || sc === document.documentElement ? 0 : sc.getBoundingClientRect().top;
    const target = Math.max(0, sc.scrollTop + r.top - top0 + y - 8); sc.scrollTo({ top: target, behavior: 'smooth' });
    // a smooth scroll can be cut short when the frame grows meanwhile: make sure it lands
    clearTimeout(scrollFrameTo.t); scrollFrameTo.t = setTimeout(() => { const max = sc.scrollHeight - sc.clientHeight; if (Math.abs(sc.scrollTop - Math.min(target, max)) > 30) sc.scrollTo({ top: target, behavior: 'auto' }); }, 650); }
  const vpLater = () => { if (!vpRaf) vpRaf = requestAnimationFrame(() => { vpRaf = 0; sendVp(); }); };
  window.addEventListener('scroll', vpLater, { passive: true, capture: true }); window.addEventListener('resize', vpLater);
  function renderMap() { return '<div class="cr-mapslot"></div>'; }
  function mountMap() {
    const slot = C.root && C.root.querySelector('.cr-mapslot'); if (!slot) return;
    if (!mapFrame) { mapFrame = document.createElement('iframe'); mapFrame.className = 'cr-mapframe'; mapFrame.title = 'Mapa de barricas'; mapFrame.src = '/barricas.html'; mapFrame.setAttribute('scrolling', 'no'); mapFrame.addEventListener('load', () => setTimeout(sendVp, 50)); }
    slot.appendChild(mapFrame);
  }
  window.addEventListener('message', e => {
    if (e.origin !== location.origin || !e.data) return;
    const t = e.data.type;
    if (t === 'bm:close') { const d = $('#crCard'); if (d && d.open) d.close(); }
    else if (t === 'bm:changed') { if ($('#crCard') && $('#crCard').open) C.dirty = true; else if (C.tab !== 'map') refresh(); else load(); }
    else if (t === 'bm:mant') openMant();
    else if (t === 'bm:h' && mapFrame) { mapFrame.style.height = Math.max(300, +e.data.h || 0) + 'px'; sendVp(); }
    else if (t === 'bm:scroll' && mapFrame) { if (e.data.h) mapFrame.style.height = Math.max(300, +e.data.h) + 'px'; scrollFrameTo(+e.data.y || 0); }
    else if (t === 'bm:top' && mapFrame) scrollFrameTo(0);
  });

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
    // Labels sit on one common line per row of tanks (not under each circle), so different tank sizes don't sawtooth.
    const placed = ts.filter(v => pos[v.id]).map(v => ({ id: v.id, y: pos[v.id].y, b: pos[v.id].y + pos[v.id].d / 2 })).sort((a, b) => a.y - b.y);
    const rowBase = {}; let cur = null;
    for (const t of placed) { if (!cur || t.y - cur.y0 > 0.8) { cur = { y0: t.y, b: t.b, ids: [] }; } cur.b = Math.max(cur.b, t.b); cur.ids.push(t.id); for (const id of cur.ids) rowBase[id] = cur; }
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
        ${items.length ? (() => { const parts = items.map(x => String(lotAbbr(x.lot)).split(' ')), code = parts.map(a => a[0]).join(' + '), desc = parts.map(a => a.slice(1).join(' ')).filter(Boolean).join(' + '), by = rowBase[v.id].b + 0.62, fc = TCOL_TXT[lotGroup(items[0].lot)] || '#3f4548';
          return `<text class="lot" x="${p.x}" y="${by}" font-size="0.3" fill="${fc}">${esc(code)}</text>${desc ? `<text class="lot2" x="${p.x}" y="${by + 0.32}" font-size="0.22" fill="${fc}">${esc(desc)}</text>` : ''}`; })() : ''}</g>`;
    }
    const bg = Object.entries(M.bg).map(([k, d]) => `<path class="tkm-bg-${k}" d="${d}"/>`).join('');
    const tx = M.texts.map(([x, y, t, h]) => `<text x="${x}" y="${y}" font-size="${h}">${esc(t)}</text>`).join('');
    const fv = tkFit();
    return `<div class="tkm-wrap"><svg class="tkm-svg" id="tkmSvg" viewBox="${fv.x} ${fv.y} ${fv.w} ${fv.h}" preserveAspectRatio="xMidYMid meet" style="aspect-ratio:${(fv.w / fv.h).toFixed(3)}"><g class="tkm-bg">${bg}</g><g class="tkm-tx">${tx}</g>${g}</svg>
      <div class="tkm-zoom"><button type="button" class="btn sm" data-tkz="in" aria-label="Acercar">+</button><button type="button" class="btn sm" data-tkz="out" aria-label="Alejar">−</button><button type="button" class="btn sm" data-tkz="fit">Ajustar</button></div></div>`;
  }
  // Default view: the rooms with tanks (tank positions + 2.5 m), not the whole site plan.
  // Default view: the whole building (outer walls ≈ x 4.4–39.8 m, y −0.2–24.8 m in tankmap.json) with a small margin,
  // so nothing of the winery is cropped; zoom/pan from there.
  function tkFit() { return { x: 3.6, y: -0.8, w: 37.0, h: 26.4 }; }
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
    const lotOpts = sel => `<option value="">— Vacío —</option>` + C.all.filter(l => !l.archived && !l.bottled && l.group !== 'routine').sort((a, b) => wineLabel(b).localeCompare(wineLabel(a), 'es')).map(l => `<option value="${esc(l.id)}"${l.id === sel ? ' selected' : ''}>${esc(wineLabel(l))}</option>`).join('');
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
      try { await api('vessels/' + encodeURIComponent(v.id), 'PATCH', { model: (f.querySelector('[name="model"]').value || '').trim(), manway: f.querySelector('[name="manway"]').value, manwaySize: (f.querySelector('[name="manwaySize"]').value || '').trim(), triclamp: f.querySelector('[name="triclamp"]').value, contents: { items: items2, by: whoB(), acct: C.me, at: new Date().toISOString() } }); d.close(); await refresh(); }
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
  // ---------- Wine picker: Añada → Vino (+ add an older wine that becomes reusable) ----------
  const VARIETIES = [['Cabernet Franc', 'red'], ['Cabernet Sauvignon', 'red'], ['Merlot', 'red'], ['Malbec', 'red'], ['Syrah', 'red'], ['Garnacha', 'red'], ['Tempranillo', 'red'], ['Montepulciano', 'red'], ['Aglianico', 'red'], ['Petite Sirah', 'red'],
    ['Merlot–Malbec', 'red'], ['Syrah–Cab Franc', 'red'], ['Tempranillo–Cab Franc', 'red'], ['Tempranillo–Cab Sauv', 'red'], ['Reserva de la Casa', 'red'], ['Sauvignon Blanc', 'white'], ['Semillón', 'white'], ['Chenin', 'white'], ['Chardonnay', 'white'],
    ['Moscato Giallo', 'white'], ['Naranja', 'orange'], ['Rosado', 'rose'], ['Oporto', 'red'], ['Vermut', 'red']];
  const GNAME = { red: 'Tinto', rose: 'Rosado', white: 'Blanco', orange: 'Naranja', sparkling: 'Espumoso' };
  const NO_VINT = 0; // port, vermouth, solera: no single vintage
  const wineLabel = l => { const y = C.vintageOf(l); return (y && y !== NO_VINT ? y + ' · ' : '') + l.name + (l.code ? ' · ' + l.code : ''); };
  const winesOf = y => C.all.filter(l => !l.archived && l.group !== 'routine' && (+C.vintageOf(l) || NO_VINT) === +y).sort((a, b) => wineLabel(a).localeCompare(wineLabel(b), 'es'));
  const YEARS = [2026, 2025, 2024, 2023, 2022, 2021, NO_VINT];
  const yearOpt = (y, sel) => `<option value="${y}"${+y === +sel ? ' selected' : ''}>${y === NO_VINT ? 'Sin añada (oporto, vermut…)' : y}</option>`;
  const wineOpts = (y, sel) => `<option value="">— Vacía / sin vino —</option>` + winesOf(y).map(l => `<option value="${esc(l.id)}"${l.id === sel ? ' selected' : ''}>${esc(wineLabel(l))}</option>`).join('') + `<option value="__new">+ Otro vino de ${+y === NO_VINT ? 'esta categoría' : 'esta añada'}…</option>`;
  const winePicker = cur => {
    const l = cur && lotById(cur), y0 = l ? (+C.vintageOf(l) || NO_VINT) : 2026;
    return `<div class="g2"><label>Añada<select name="vy">${YEARS.map(y => yearOpt(y, y0)).join('')}</select></label><label>Vino<select name="lot">${wineOpts(y0, cur)}</select></label></div>
      <div class="cr-newwine" hidden><div class="g3"><label>Variedad o mezcla<select name="nwv"><option value="">—</option>${VARIETIES.map(([n, g]) => `<option value="${esc(n)}" data-g="${g}">${esc(n)}</option>`).join('')}<option value="__other">Otra / mezcla (escribir)</option></select></label>
      <label>Color<select name="nwg">${Object.entries(GNAME).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label><label>Nº de lote (si tiene)<input name="nwcode" placeholder="L17"></label></div>
      <label class="cr-nwname" hidden>Nombre del vino o mezcla<input name="nwname" placeholder="CF 60 / ME 40"></label><p class="cr-help">Se guarda como vino de la bodega y queda en la lista para las demás barricas.</p></div>`;
  };
  function wirePicker(f) {
    const vy = f.querySelector('[name="vy"]'), lot = f.querySelector('[name="lot"]'), box = f.querySelector('.cr-newwine'); if (!vy) return;
    const sync = () => { box.hidden = lot.value !== '__new'; };
    vy.onchange = () => { lot.innerHTML = wineOpts(vy.value, ''); sync(); };
    lot.onchange = sync;
    const v = f.querySelector('[name="nwv"]'), g = f.querySelector('[name="nwg"]'), nm = f.querySelector('.cr-nwname');
    v.onchange = () => { const o = v.selectedOptions[0]; if (o && o.dataset.g) g.value = o.dataset.g; nm.hidden = v.value !== '__other'; };
  }
  // Creates the older wine as a lot (cellar phase, no Excellovint tab) and returns its id.
  async function newWineFrom(f) {
    const y = +f.querySelector('[name="vy"]').value, v = f.querySelector('[name="nwv"]').value;
    const name = (v === '__other' ? f.querySelector('[name="nwname"]').value : v || '').trim();
    if (!name) throw new Error('Elige la variedad o escribe el nombre del vino.');
    const code = (f.querySelector('[name="nwcode"]').value || '').trim().toUpperCase(), group = f.querySelector('[name="nwg"]').value || 'red';
    const dup = winesOf(y).find(l => l.name.toLowerCase() === name.toLowerCase() && (l.code || '') === code); if (dup) return dup.id;
    const id = 'w-' + (y || 'nv') + '-' + name.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) + (code ? '-' + code.toLowerCase() : '');
    const doc = { name, code, group, vintage: y || null, phase: 'cellar', sheet: [], src: 'barricas', by: whoB(), acct: C.me, at: new Date().toISOString() };
    await api('lots/' + encodeURIComponent(id), 'PUT', doc);
    C.all.push(Object.assign({ id }, doc)); return id;
  }
  function openBarrel(id, preset) {
    const b = id ? C.barrels.find(x => x.id === id) : Object.assign({ code: '', size: 225, fill: 'full', lot: '', vol: '', loc: '', cooperage: '', wood: '', toast: '', year: '', notes: '' }, preset || {});
    if (!b) return;
    const isNew = !id, ro = !C.canWrite && !C.crew, specOnly = false;
    if (isNew && C.crew) return;
    const lotOpts = `<option value="">— Vacía / sin vino —</option>` + ['red', 'rose', 'white', 'orange', 'sparkling'].map(g => { const ls = C.all.filter(l => l.group === g); return ls.length ? `<optgroup label="${{ red: 'Tintos', rose: 'Rosados', white: 'Blancos', orange: 'Naranjas', sparkling: 'Espumosos' }[g]}">${ls.map(l => `<option value="${esc(l.id)}"${l.id === b.lot ? ' selected' : ''}>${esc(l.name)} (${C.vintageOf(l)}${l.code ? ' · ' + esc(l.code) : ''})</option>`).join('')}</optgroup>` : ''; }).join('');
    const d = sheet(`<form method="dialog" class="cr-form">
      <div class="cr-sh"><h3>${isNew ? 'Nueva barrica' : 'Barrica ' + esc(bn(b.code))}</h3>${!isNew ? `<nav class="cr-stabs"><button type="button" data-st="form" aria-selected="true">Datos</button><button type="button" data-st="hist" aria-selected="false">Historial</button><button type="button" data-st="tag" aria-selected="false">Etiqueta</button></nav>` : ''}</div>
      <div class="cr-pane" data-pane="form">
        <div class="g3"><label>Nº barrica<input name="code" inputmode="numeric" required value="${esc(b.code)}" ${isNew ? '' : 'readonly'} placeholder="101"></label><label>Tamaño (L)<input name="size" inputmode="numeric" value="${esc(b.size)}"></label><label>Llenado<select name="fill">${Object.entries(FILL).map(([k, l]) => `<option value="${k}"${(b.fill || 'full') === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label></div>
        ${winePicker(b.lot)}
        <div class="g2"><label>Litros en la barrica<input name="vol" inputmode="decimal" value="${esc(b.vol)}" placeholder="225"></label><label>Año en que se hizo<select name="year"><option value="">—</option>${Array.from({ length: 2027 - 1995 }, (_, i) => 2026 - i).map(y => `<option${String(y) === String(b.year || '') ? ' selected' : ''}>${y}</option>`).join('')}</select></label></div>
        <label>Ubicación ${b.loc ? `<span class="cr-loc">${esc(b.loc)}</span>` : ''}${locSelects(b.loc)}</label>
        <div class="g3"><label>Tonelería<select name="cooperage"><option value="">—</option>${COOPERS.map(([n, c]) => `<option value="${esc(n)}"${n === (b.cooperage || '') ? ' selected' : ''}>${esc(n)} (${c})</option>`).join('')}${b.cooperage && !COOPERS.some(([n]) => n === b.cooperage) ? `<option value="${esc(b.cooperage)}" selected>${esc(b.cooperage)} (código de la hoja, sin identificar)</option>` : ''}</select></label><label>Madera<select name="wood">${WOOD.map(w => `<option${w === (b.wood || '') ? ' selected' : ''}>${w}</option>`).join('')}</select></label><label>Tipo<select name="use"><option value="">—</option>${Object.entries(USE).map(([k, l]) => `<option value="${k}"${(b.use || useOf(b)) === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label><label>Tostado<select name="toast">${TOASTS.map(t => `<option value="${esc(t)}"${t === (b.toast || '') ? ' selected' : ''}>${t || '—'}</option>`).join('')}${b.toast && !TOASTS.includes(b.toast) ? `<option value="${esc(b.toast)}" selected>${esc(b.toast)}</option>` : ''}</select></label></div>
        <label>Notas<textarea name="notes" rows="2">${esc(b.notes)}</textarea></label>
        <div class="cr-err" id="crErr"></div>
      </div>
      ${!isNew ? `<div class="cr-pane" data-pane="hist" hidden><div class="cr-empty">Cargando historial…</div></div><div class="cr-pane" data-pane="tag" hidden></div>` : ''}
      <div class="cr-actions">${!isNew && !ro && !C.crew ? `<button type="button" class="btn danger" data-del>Borrar</button>` : ''}<button type="button" class="btn" data-cancel>Cerrar</button>${ro ? '' : `<button type="submit" class="btn primary">Guardar</button>`}</div>
    </form>`);
    const f = $('form', d); wirePicker(f);
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
        const patch = { use: fd.get('use') || '', size: +fd.get('size') || '', cooperage: String(fd.get('cooperage') || '').trim(), wood: fd.get('wood') || '', toast: String(fd.get('toast') || '').trim(), year: String(fd.get('year') || '').trim(), by: whoB(), acct: C.me, at: new Date().toISOString() };
        try { await api('barrels/' + encodeURIComponent(b.id), 'PATCH', patch); await logEvent(b.code, 'spec', 'Datos de la barrica: ' + (specLine(patch) || '—')); d.close(); await refresh(); } catch (err) { $('#crErr', f).textContent = err.message; }
        return;
      }
      if (!code) { $('#crErr', f).textContent = 'Falta el número de barrica.'; return; }
      if (fd.get('lot') === '__new') { try { fd.set('lot', await newWineFrom(f)); } catch (err) { $('#crErr', f).textContent = err.message; return; } }
      const z = fd.get('z'), loc = z ? [z, fd.get('r'), fd.get('s'), fd.get('l')].join('-') : '';
      const next = { code, use: fd.get('use') || '', size: +fd.get('size') || '', fill: fd.get('fill'), lot: fd.get('lot') || '', vol: fd.get('vol') ? +String(fd.get('vol')).replace(',', '.') : '', loc, cooperage: String(fd.get('cooperage')).trim(), wood: fd.get('wood'), toast: String(fd.get('toast')).trim(), year: String(fd.get('year')).trim(), notes: String(fd.get('notes')).trim(), by: whoB(), acct: C.me, at: new Date().toISOString() };
      if (!next.lot) next.fill = 'empty';
      // Choosing a wine settles a "por confirmar" barrel; existing barrels are merged (PATCH) so paper history, sheet data and logs survive.
      if (next.lot) { next.status = 'occupied2026'; if (needsConfirm(b)) next.confirmed = { state: 'other', wine: lotName(next.lot), by: whoB(), acct: C.me, at: new Date().toISOString() }; }
      else if (!isNew && needsConfirm(b)) { next.status = 'empty'; next.confirmed = { state: 'empty', wine: '', by: whoB(), acct: C.me, at: new Date().toISOString() }; }
      const other = loc && C.barrels.find(x => x.loc === loc && x.id !== (isNew ? code : b.id));
      if (other && !confirm('En ' + loc + ' ya está la barrica ' + other.code + '. ¿Poner las dos ahí?')) return;
      if (isNew && C.barrels.some(x => x.id === code)) { $('#crErr', f).textContent = 'La barrica ' + code + ' ya existe; ábrela desde la lista.'; return; }
      try {
        await api('barrels/' + encodeURIComponent(isNew ? code : b.id), isNew ? 'PUT' : 'PATCH', next);
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
      const hist = (b.wines || []).length ? `<h4>Historial de vinos <small>hoja</small></h4><p class="cr-help">${(b.wines || []).map(c => esc(wineCode(c))).join(' → ')}${b.sheet && b.sheet.state ? ` · según la hoja: <b>${b.sheet.state === 'full' ? 'llena' : 'vacía'}</b> (${esc(fmtD(b.sheet.d))})` : ''}</p>` : '';
      pane.innerHTML = hist + paper + `<h4>Mantenimiento y movimientos <small>${mine.length}</small></h4>` + (mine.length ? `<ul class="cr-log">${mine.slice().sort((x, y) => String(y.at).localeCompare(String(x.at))).map(r => `<li><span class="cr-ld">${fmtD(r.at)}</span><span class="cr-lk ${esc(r.kind)}"${r.kind === 'mant' && PROTO[r.proto] ? ` style="background:${PROTO[r.proto].c};color:#fff"` : ''}>${esc(r.kind === 'mant' && PROTO[r.proto] ? PROTO[r.proto].n : r.kind)}</span>${esc(r.text)}<small>${esc(r.by || '')}</small></li>`).join('')}</ul>` : '<p class="cr-none">Nada todavía.</p>') +
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
      pane.innerHTML = `<div class="cr-tag"><div class="cr-label"><div class="cr-lcode"><small>BBL</small><b>${esc(bn(b.code))}</b></div>${svg}<div class="cr-lfoot">${esc(lotName(b.lot) || '')}<br><span>Dos Búhos · ${esc(tagUrl(b.code).replace(/^https?:\/\//, ''))}</span></div></div>
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
    host.innerHTML = bs.map((b, i) => `<div class="cr-label"><div class="cr-lcode cr-lcode1"><b>BBL ${esc(bn(b.code))}</b></div>${svgs[i]}<div class="cr-lfoot"><span>Dos Búhos</span></div></div>`).join('');
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
        const doc = Object.assign({}, cur, { code: p.code, by: whoB(), acct: C.me, at: new Date().toISOString() });
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
      <div class="cr-chips" data-al>${list.map(b => `<button type="button" class="cr-chip${b.loc ? ' placed' : ''}" data-pick="${esc(b.id)}" style="--c:${GCOL[lotGroup(b.lot)] || '#999'}"><b>${esc(bn(b.code))}</b><small>${esc(lotName(b.lot) || 'vacía')}${b.loc ? ' · ' + esc(b.loc) : ''}</small></button>`).join('') || '<span class="cr-none">No hay barricas registradas; usa «+ Barrica».</span>'}</div>
      <div class="cr-actions"><button type="button" class="btn" data-cancel>Cancelar</button><button type="button" class="btn primary" data-newhere>+ Nueva barrica aquí</button></div></form>`);
    d.querySelector('[data-cancel]').onclick = () => d.close();
    d.querySelector('[data-newhere]').onclick = () => { d.close(); openBarrel(null, { loc }); };
    d.querySelector('[data-aq]').oninput = e => { const q = e.target.value.toLowerCase(); d.querySelectorAll('[data-pick]').forEach(c => c.hidden = q && !c.textContent.toLowerCase().includes(q)); };
    d.querySelector('[data-al]').onclick = async e => { const c = e.target.closest('[data-pick]'); if (!c) return; const b = C.barrels.find(x => x.id === c.dataset.pick); if (!b) return; const from = b.loc; await api('barrels/' + encodeURIComponent(b.id), 'PATCH', { loc, by: whoB(), acct: C.me, at: new Date().toISOString() }); await logEvent(b.code, 'move', (from || 'sin ubicación') + ' → ' + loc); d.close(); await refresh(); };
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
    const patch = { confirmed: { state: how, wine: how === 'empty' ? '' : wine, by: whoB(), acct: C.me, at: new Date().toISOString() }, status: how === 'empty' ? 'empty' : 'confirmed', by: whoB(), acct: C.me, at: new Date().toISOString() };
    if (how === 'empty') { patch.fill = 'empty'; patch.lot = ''; } else { patch.fill = 'full'; patch.notes = [b.notes, 'Contiene ' + wine + ' (confirmado ' + new Date().toLocaleDateString('es-MX') + ')'].filter(Boolean).join(' · '); }
    try { await api('barrels/' + encodeURIComponent(id), 'PATCH', patch); await logEvent(b.code, how === 'empty' ? 'empty' : 'fill', how === 'empty' ? 'Confirmada: embotellada / vacía' : 'Confirmada: sigue con ' + wine); await refresh(); }
    catch (err) { alert('No se pudo guardar: ' + err.message); }
  }

  // ---------- events ----------
  document.addEventListener('click', e => {
    if (!C.root || !C.root.contains(e.target)) return;
    const cf = e.target.closest('[data-cfm]'); if (cf) { confirmBarrel(cf.dataset.id, cf.dataset.cfm); return; }
    // Lista: selection and bulk actions
    if (e.target.closest('.c-sel,.cr-tg label')) return; // checkboxes: handled on change
    if (e.target.closest('[data-cselnone]')) { C.selB.clear(); render(); return; }
    if (e.target.closest('[data-cbulkgo]')) { const v = (C.root.querySelector('[data-cbulk]') || {}).value; if (v) bulk(v); return; }
    const br = e.target.closest('[data-bbrow]'); if (br && !e.target.closest('select,input,button')) { openCard(br.dataset.bbrow); return; }
    if (e.target.matches && e.target.matches('[data-cpanelbg]')) { C.panel = false; render(); return; }
    const pn = e.target.closest('[data-cpanel]'); if (pn) { C.panel = !C.panel; C.more = false; render(); return; }
    const mo = e.target.closest('[data-cmore]'); if (mo) { C.more = !C.more; render(); return; }
    const cl = e.target.closest('[data-cclear]'); if (cl) { const k = cl.dataset.cclear; if (k.startsWith('use:')) C.uses.delete(k.slice(4)); if (k.startsWith('vint:')) C.vints.delete(k.slice(5)); if (k === 'use' || k === 'all') C.uses.clear(); if (k === 'vint' || k === 'all') C.vints.clear(); if (k === 'loc' || k === 'all') C.noloc = false; render(); return; }
    const lc = e.target.closest('[data-cl]'); if (lc) { C.noloc = lc.dataset.cl === '1'; render(); return; }
    const sb = e.target.closest('[data-csortb]'); if (sb) { C.sortB = sb.dataset.csortb; render(); return; }
    const g2 = e.target.closest('[data-cg2]'); if (g2) { C.group = g2.dataset.cg2; render(); return; }
    if (C.more && !e.target.closest('.cr-morew')) { C.more = false; }
    const ts0 = e.target.closest('[data-tksel]'); if (ts0 && !e.target.closest('[data-tk],[data-open]')) { if (tkMoved && ts0.closest('#tkmSvg')) return; C.tkSel = C.tkSel === ts0.dataset.tksel || !ts0.dataset.tksel ? '' : ts0.dataset.tksel; render(); if (C.tkSel && ts0.tagName === 'TR') { const sv = C.root.querySelector('#tkmSvg'); if (sv) sv.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } else if (C.tkSel) { const c = C.root.querySelector('.tkm-card'); if (c) c.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } return; }
    const t = e.target.closest('[data-ct],[data-tk],[data-cv],[data-cf],[data-cu],[data-ca],[data-bb],[data-loc],[data-open],[data-phase]'); if (!t) { if (!C.more && C.root.querySelector('.cr-menu')) render(); return; }
    if (t.dataset.ca) C.more = false;
    if (t.dataset.ct) { C.tab = t.dataset.ct; C.q = ''; render(); return; }
    if (t.dataset.cv) { const v = t.dataset.cv; if (v === 'all') C.vints.clear(); else if (C.vints.has(v)) C.vints.delete(v); else C.vints.add(v); render(); return; }
    if (t.dataset.cf) { C.filter = t.dataset.cf; render(); return; }
    if (t.dataset.cu != null) { const u = t.dataset.cu; if (!u) C.uses.clear(); else if (C.uses.has(u)) C.uses.delete(u); else C.uses.add(u); render(); return; }
    if (t.dataset.ca === 'new') { openBarrel(null, t.dataset.lot ? { lot: t.dataset.lot } : null); return; }
    if (t.dataset.ca === 'import') { openImport(); return; }
    if (t.dataset.ca === 'mant') { openMant(); return; }
    if (t.dataset.ca === 'labels') { printLabels(null); return; }
    if (t.dataset.ca === 'mapcfg') { openMapCfg(); return; }
    if (t.dataset.bb) { openCard(t.dataset.bb); return; }
    if (t.dataset.tk) { openTank(t.dataset.tk); return; }
    if (t.dataset.loc) { if (C.canWrite) openAssign(t.dataset.loc); return; }
    if (t.dataset.open) { window.dispatchEvent(new CustomEvent('cellar:open', { detail: { lot: t.dataset.open } })); return; }
    if (t.dataset.phase) { window.dispatchEvent(new CustomEvent('cellar:phase', { detail: { lot: t.dataset.lot, phase: t.dataset.phase } })); return; }
  });
  document.addEventListener('input', e => { if (C.root && C.root.contains(e.target) && e.target.classList.contains('cr-q')) { C.q = e.target.value; const body = $('#crBody', C.root); if (body) body.innerHTML = C.tab === 'map' ? renderMap() : C.tab === 'tanks' ? renderTanks() : renderBarrels(); } });
  document.addEventListener('change', e => {
    if (!C.root || !C.root.contains(e.target)) return;
    const t = e.target;
    if (t.matches('[data-cg]')) { C.group = t.value; render(); return; }
    if (t.matches('[data-csort]')) { C.sortB = t.value; render(); return; }
    if (t.matches('[data-bsel]')) { if (t.checked) C.selB.add(t.dataset.bsel); else C.selB.delete(t.dataset.bsel); render(); return; }
    if (t.matches('[data-bselg]')) { for (const id of t.dataset.bselg.split(',')) if (t.checked) C.selB.add(id); else C.selB.delete(id); render(); return; }
    if (t.matches('[data-bselall]')) { C.root.querySelectorAll('[data-bsel]').forEach(x => { if (t.checked) C.selB.add(x.dataset.bsel); else C.selB.delete(x.dataset.bsel); }); render(); return; }
    if (t.matches('[data-cbulk]') && t.value) { bulk(t.value); t.value = ''; }
  });

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
    if (m && !window.__crOpened) { window.__crOpened = true; const b = C.barrels.find(x => x.id === m[1]); if (b) openCard(b.id); else if (C.canWrite) openBarrel(null, { code: m[1] }); }
  });
})();
