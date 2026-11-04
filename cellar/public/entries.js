// Signed results, notes and lab uploads (v1.1). Pairs with entries.css; served next to the main page.
// - "Anotar resultados y notas" on a work order → a NEW signed row in the lot's tab (the order text is never touched).
// - "Agregar nota" (lot page, + Agregar → Nota) → the same form with no order.
// - "Subir lab" (Labs, + Agregar → Subir lab, or inside the form) → PDF/photo to R2, Claude reads it, a person confirms,
//   one record per sample + one row per sample in the lot's tab.
// Talks to the Worker: /api/params, /api/entries, /api/labs/*. Listens for cellar:results / cellar:note / cellar:lab.
(function () {
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => [...(r || document).querySelectorAll(s)];
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const dm = iso => { const [, m, d] = String(iso || '').split('-').map(Number); return d && m ? d + '/' + m : ''; };
  const api = async (path, opts) => { const r = await fetch(path, Object.assign({ credentials: 'same-origin' }, opts || {})); const j = await r.json().catch(() => ({})); if (!r.ok) throw Object.assign(new Error(j.message || 'Error ' + r.status), { status: r.status, code: j.code }); return j; };
  const post = (path, body) => api(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const E = { params: [], labsOn: false, me: {}, lots: [], staff: [], ready: null, moves: [], barrels: [], entries: null, entriesAt: 0, labs: null, labsAt: 0 };

  function toast(msg) {
    let t = $('#enToast'); if (!t) { t = document.createElement('div'); t.id = 'enToast'; t.className = 'en-toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.textContent = msg; t.hidden = false; clearTimeout(t._h); t._h = setTimeout(() => { t.hidden = true; }, 3800);
  }
  // Racking / blending orders (moves): the open ones are matched to their work-order row.
  async function loadMoves() { try { E.moves = (await api('/api/moves')).rows || []; } catch (e) { E.moves = []; } }
  const normT = s => String(s || '').toUpperCase().replace(/\s+/g, ' ').trim();
  function moveFor(o) { if (!o) return null; return E.moves.find(m => m.status === 'open' && m.tab === o.tab && (m.row === +o.row || normT(m.note) === normT(o.note))) || null; }
  window.cellarMoveFor = moveFor;
  loadMoves();
  function load() {
    if (E.ready) return E.ready;
    E.ready = Promise.all([
      api('/api/params').then(j => { E.params = j.params || []; E.labsOn = !!j.labs; }),
      api('/api/me').then(j => { E.me = j || {}; }).catch(() => {}),
      api('/api/db/lots').then(j => { E.lots = (j.rows || []).map(r => Object.assign({ id: r.id }, r.data)); }).catch(() => {}),
      loadMoves(),
      api('/api/db/staff').then(j => { E.staff = (j.rows || []).map(r => Object.assign({ id: r.id }, r.data)).filter(s => s.active !== false); }).catch(() => {}),
    ]).catch(e => { E.ready = null; throw e; });
    return E.ready;
  }
  // Tabs people can write to, labelled by wine: "Chenin (tank wine) · L11 - CB".
  function tabOptions(sel) {
    const seen = new Map();
    for (const l of E.lots) for (const s of (l.sheet || [])) { if (!s.tab) continue; const name = l.id === 'all' ? 'Bodega (todos)' : l.name; seen.set(s.tab, (seen.get(s.tab) ? seen.get(s.tab) + ' / ' : '') + name); }
    const tabs = [...seen.keys()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    return `<option value="">Elige el vino / lote…</option>` + tabs.map(t => `<option value="${esc(t)}"${t === sel ? ' selected' : ''}>${esc(seen.get(t))} · ${esc(t)}</option>`).join('');
  }
  // Quick lot picker: search box + big buttons, recently used first.
  const GC = { red: '#7a1f2b', rose: '#e0849a', white: '#d8b43c', orange: '#d9822b', sparkling: '#7fa7b8' };
  const RECENT_K = 'cellar.notelots';
  const recentTabs = () => { try { return JSON.parse(localStorage.getItem(RECENT_K) || '[]'); } catch (e) { return []; } };
  const rememberTab = t => { try { localStorage.setItem(RECENT_K, JSON.stringify([t].concat(recentTabs().filter(x => x !== t)).slice(0, 6))); } catch (e) {} };
  function lotTabs() {
    const m = new Map();
    for (const l of E.lots) for (const s of (l.sheet || [])) {
      if (!s.tab || l.archived || s.archived) continue; const cur = m.get(s.tab);
      const name = l.id === 'all' ? 'Bodega (todos)' : l.name;
      if (cur) cur.name += ' / ' + name; else m.set(s.tab, { tab: s.tab, name, group: l.group || '', ubi: l.ubi || '' });
    }
    return [...m.values()].sort((a, b) => a.tab.localeCompare(b.tab, undefined, { numeric: true }));
  }
  function lotPicker(sel) {
    const all = lotTabs(), rec = recentTabs().filter(t => all.some(x => x.tab === t));
    const btn = x => `<button type="button" class="en-lot" data-lt="${esc(x.tab)}" aria-pressed="${x.tab === sel}" style="--c:${GC[x.group] || '#9aa5b1'}"><b>${esc(x.name)}</b><small>${esc(x.tab)}</small></button>`;
    return `<input type="hidden" id="enTab" value="${esc(sel || '')}">
      <input type="search" class="en-lotq" placeholder="Buscar: chenin, L21, tanque 6…" aria-label="Buscar vino o lote" autocomplete="off">
      ${rec.length ? `<div class="en-lotlab">Recientes</div><div class="en-lots en-rec">${rec.map(t => btn(all.find(x => x.tab === t))).join('')}</div><div class="en-lotlab">Todos</div>` : ''}
      <div class="en-lots en-all">${all.map(btn).join('')}</div>`;
  }
  const tabOfLot = id => { const l = E.lots.find(x => x.id === id); return l && (l.sheet || [])[0] ? l.sheet[0].tab : ''; };
  // Signer chips: who did the work. Pre-picked from the login (P/J → both).
  function signerTag(s) { const a = (s.aliases || []).find(x => String(x).length <= 2); return String(a || s.tag || s.name).toUpperCase(); }
  function signerChips(pre) {
    const want = String(pre || '').toUpperCase().split(/\s*[\/+,&]\s*/).filter(Boolean);
    const list = E.staff.slice().sort((a, b) => (a.role === 'receiver' ? 0 : 1) - (b.role === 'receiver' ? 0 : 1) || (a.order || 0) - (b.order || 0));
    const chips = list.map(s => { const t = signerTag(s), on = want.includes(t) || want.includes(String(s.tag).toUpperCase()); return `<button type="button" class="en-chip" data-sig="${esc(t)}" aria-pressed="${on}">${esc(s.name)}</button>`; });
    const known = list.map(signerTag).concat(list.map(s => String(s.tag).toUpperCase()));
    const other = want.filter(w => !known.includes(w)).join('/');
    return chips.join('') + `<input class="en-sig-other" placeholder="Otro (iniciales)" value="${esc(other)}" aria-label="Otra persona (iniciales)">`;
  }
  const signerValue = root => { const v = $$('.en-chip[aria-pressed="true"]', root).map(b => b.dataset.sig); const o = $('.en-sig-other', root).value.trim().toUpperCase(); if (o) v.push(o); return v.join('/'); };

  // ---------- results / note form ----------
  function paramBox(p, val) {
    return `<label class="en-p"><span>${esc(p.label)}${p.unit ? ` <small>${esc(p.unit)}</small>` : ''}</span><input data-pk="${esc(p.k)}" ${p.type === 'text' ? 'type="text"' : 'inputmode="decimal"'} value="${esc(val || '')}" autocomplete="off"></label>`;
  }
  function otherRow(o) { return `<div class="en-other"><input placeholder="Parámetro" value="${esc(o && o.name || '')}" data-o="name"><input placeholder="Valor" inputmode="decimal" value="${esc(o && o.value || '')}" data-o="value"><input placeholder="Unidad" value="${esc(o && o.unit || '')}" data-o="unit"><button type="button" class="en-x" data-odel aria-label="Quitar">×</button></div>`; }
  let F = null; // the open form: { order, tab, lot }
  async function openForm(ctx) {
    try { await load(); } catch (e) { toast('No se pudo abrir: ' + e.message); return; }
    F = ctx;
    const o = ctx.order;
    if (o) await loadMoves();
    const MV = moveFor(o); F.move = MV;
    let ov = $('#enSheet');
    if (!ov) { ov = document.createElement('div'); ov.className = 'overlay en-ov'; ov.id = 'enSheet'; document.body.appendChild(ov); ov.addEventListener('click', e => { if (e.target === ov) guardClose($('form', ov), closeForm); }); }
    const core = E.params.filter(p => p.core), more = E.params.filter(p => !p.core);
    const pre = (E.me && E.me.initials) || '';
    ov.innerHTML = `<form class="sheet en-form" novalidate>
      <h2>${o ? 'Anotar resultados y notas' : 'Agregar nota'}</h2>${XBTN}
      ${o ? `<div class="xo-where"><b>${esc(o.wine || o.tab)}</b> · ${esc(o.tab)} · fila ${esc(o.row)}</div><div class="rs-task en-order">${esc(o.note)}</div>`
        : `<div class="field en-lotf"><label>Vino / lote <span class="ed-hint">obligatorio · lo de toda la bodega va en «Bodega (todos)»</span></label>${lotPicker(ctx.tab || tabOfLot(ctx.lot) || '')}</div>`}
      ${MV ? moveSection(MV) : ''}
      <div class="field"${MV ? ' hidden' : ''}><label for="enUbi">Vasija(s) <span class="ed-hint">tanque, barrica… (si es por barrica, anota cuál)</span></label><input id="enUbi" value="${esc(o ? o.ubi || '' : '')}" placeholder="BBL 101, VC-05…" autocomplete="off"></div>
      <div class="field"><label>¿Quién lo hizo? <span class="ed-hint">obligatorio · toca una o más personas</span></label><div class="en-sig">${signerChips(pre)}</div></div>
      <div class="field"><label for="enNote">Notas / cata <span class="ed-hint">olor, sabor, lo que se vio, decisiones</span></label><textarea id="enNote" rows="4" maxlength="1500" placeholder="Ej.: TAMBO 01 LIMPIO, CÍTRICO. TAMBO 02 LIGERA CEBOLLA → NO TRASEGAR"></textarea></div>
      <div class="rs-lbl">Mediciones <span class="ed-hint">solo lo que se midió</span></div>
      <div class="en-grid">${core.map(p => paramBox(p)).join('')}</div>
      <details class="en-more"><summary>Laboratorio completo (Uva y Vino)</summary>
        <div class="en-grid">${more.map(p => paramBox(p)).join('')}</div>
        <div class="en-others"></div>
        <button type="button" class="btn sm" data-oadd>+ otro parámetro</button>
      </details>
      <div class="en-file">${E.labsOn ? `<label class="btn sm en-up">Subir hoja de lab (PDF o foto)<input type="file" accept="application/pdf,image/*" hidden data-fup></label><span class="en-fname"></span>` : `<small class="en-hint">Subida de laboratorio aún no activada.</small>`}</div>
      ${o && !o.ini ? `<label class="rs-done"><input type="checkbox" id="enDone" checked> Marcar la orden como hecha</label>` : ''}
      <div class="err" id="enErr" role="alert"></div>
      <div class="actions"><span></span><div class="right"><button type="button" class="btn" data-cancel>Cancelar</button><button type="submit" class="btn primary" id="enSave">Guardar</button></div></div>
    </form>`;
    ov.hidden = false;
    document.documentElement.classList.add('m-modal');
    const form = $('form', ov);
    form.addEventListener('click', e => {
      const lt = e.target.closest('[data-lt]'); if (lt) {
        $('#enTab').value = lt.dataset.lt;
        $$('[data-lt]', form).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.lt === lt.dataset.lt)));
        const x = lotTabs().find(t => t.tab === lt.dataset.lt); if (x && x.ubi) $('#enUbi').placeholder = x.ubi;
        return;
      }
      const c = e.target.closest('.en-chip'); if (c) { c.setAttribute('aria-pressed', String(c.getAttribute('aria-pressed') !== 'true')); return; }
      if (e.target.closest('[data-oadd]')) { $('.en-others', form).insertAdjacentHTML('beforeend', otherRow()); $('.en-others .en-other:last-child input', form).focus(); return; }
      const d = e.target.closest('[data-odel]'); if (d) { d.parentElement.remove(); return; }
      if (e.target.closest('[data-cancel]')) closeForm();
      if (e.target.closest('[data-dadd]')) { $('.mv-dest', form).insertAdjacentHTML('beforeend', destRow('', '')); $('.mv-dest .mv-d:last-child input', form).focus(); return; }
      if (e.target.closest('[data-fadd]')) { $('.mv-fmts', form).insertAdjacentHTML('beforeend', fmtRow(375, '')); $('.mv-fmts .mv-f:last-child input', form).focus(); return; }
      const dd = e.target.closest('[data-ddel]'); if (dd) { dd.parentElement.remove(); calcBl(); return; }
    });
    // Liters bottled: suggested from bottles × size until someone types their own number.
    const calcBl = () => { const bl = $('[data-bl]', form); if (!bl) return; const l = $$('.mv-f', form).reduce((s, r) => s + (+$('[data-fml]', r).value || 0) * (+$('[data-fn]', r).value.replace(/[.,\s]/g, '') || 0), 0) / 1000; bl.placeholder = l ? (Math.round(l * 10) / 10) + ' (calculado)' : 'se calcula'; };
    form.addEventListener('input', e => { if (e.target.matches('[data-fn]')) calcBl(); });
    form.addEventListener('change', e => { if (e.target.name === 'mvsrc') $('.mv-left', form).hidden = e.target.value !== 'left'; if (e.target.matches('[data-fml]')) calcBl(); });
    const fup = $('[data-fup]', form);
    if (fup) fup.addEventListener('change', async () => {
      const f = fup.files[0]; if (!f) return;
      $('.en-fname', form).textContent = 'Subiendo ' + f.name + '…';
      try {
        const up = await uploadFile(f); F.pdf = up.hash;
        $('.en-fname', form).innerHTML = `✓ ${esc(f.name)}${/pdf/i.test(up.type) ? ` · <button type="button" class="btn sm" data-readlab="${esc(up.hash)}">Leer con Claude y guardar por muestra</button>` : ''}`;
      } catch (e) { $('.en-fname', form).textContent = e.message; }
    });
    form.addEventListener('click', e => { const r = e.target.closest('[data-readlab]'); if (r) { const h = r.dataset.readlab; closeForm(); openLab({ hash: h }); } });
    form.addEventListener('submit', e => { e.preventDefault(); saveForm(form); });
    const lq = $('.en-lotq', form);
    if (lq) lq.addEventListener('input', () => { const q = lq.value.trim().toLowerCase(); $$('.en-all [data-lt]', form).forEach(b => { b.hidden = !!q && !b.textContent.toLowerCase().includes(q); }); const r = $('.en-rec', form); if (r) { r.hidden = !!q; r.previousElementSibling.hidden = !!q; } });
    setTimeout(() => { const f = o ? $('#enNote') : null; if (f) f.focus(); }, 30);
  }
  function destRow(v, l) { return `<div class="mv-d"><input data-dv placeholder="BBL 60 / TANQUE 6" value="${esc(v)}" autocomplete="off" aria-label="Vasija"><input data-dl inputmode="decimal" placeholder="Litros" value="${esc(l)}" aria-label="Litros"><button type="button" class="en-x" data-ddel aria-label="Quitar">×</button></div>`; }
  // "BBL 60, 61 Y TANQUE 6" → ["BBL 60", "BBL 61", "TANQUE 6"]
  function splitVessels(t) {
    let pre = ''; return String(t || '').toUpperCase().split(/\s*(?:,|\+|\bY\b|&|;)\s*/).map(x => x.trim()).filter(Boolean).map(x => {
      const m = x.match(/^(BBLS?|BARRICAS?|TANQUES?|TK|VC)[\s-]*(.*)$/); if (m) { pre = m[1].replace(/S$/, '') === 'BBL' || /^BARRICA/.test(m[1]) ? 'BBL ' : ''; return x; }
      return /^\d{1,3}$/.test(x) && pre ? pre + x : x;
    });
  }
  const FMT = [[750, '750 mL'], [375, '375 mL'], [500, '500 mL'], [1500, '1.5 L']];
  const fmtRow = (ml, n) => `<div class="mv-d mv-f"><select data-fml aria-label="Formato">${FMT.map(([v, l]) => `<option value="${v}"${+ml === v ? ' selected' : ''}>${l}</option>`).join('')}</select><input data-fn inputmode="numeric" placeholder="Botellas" value="${esc(n || '')}" aria-label="Botellas"><button type="button" class="en-x" data-ddel aria-label="Quitar">×</button></div>`;
  function bottleSection(mv) {
    const b = mv.bottle || {};
    return `<div class="mv-box"><b>Es un embotellado.</b> Para cerrarlo anota cuántas botellas salieron y de qué tamaño, los litros embotellados y la merma. Si el origen queda vacío, el vino pasa a «Embotellado».
      <div class="mv-lbl">Botellas</div><div class="mv-dest mv-fmts">${fmtRow(b.format || 750, '')}</div>
      <button type="button" class="btn sm" data-fadd>+ otro formato</button>
      <div class="en-row2"><label>Litros embotellados<input data-bl inputmode="decimal" placeholder="se calcula"></label><label>Merma (lías + filtro), L<input data-bloss inputmode="decimal" placeholder="0"></label></div>
      <div class="en-row2"><label>SO₂ libre al embotellar<input data-bfs inputmode="decimal" placeholder="mg/L"></label><label>SO₂ total<input data-bts inputmode="decimal" placeholder="mg/L"></label></div>
      <label>Lote de la etiqueta <span class="ed-hint">opcional</span><input data-blot autocomplete="off" placeholder="L15-2611"></label>
      <div class="mv-lbl">¿Cómo quedó el origen (${esc(mv.from || '—')})?</div>
      <label class="mv-r"><input type="radio" name="mvsrc" value="empty" checked> Vacío (todo el vino quedó en botella)</label>
      <label class="mv-r"><input type="radio" name="mvsrc" value="left"> Quedó vino</label>
      <label class="mv-left" hidden>Litros que quedaron <input data-left inputmode="decimal" placeholder="L"></label></div>`;
  }
  function moveSection(mv) {
    if (mv.kind === 'bottle') return bottleSection(mv);
    const kind = mv.kind === 'blend' ? 'mezcla' : 'trasiego';
    const dests = splitVessels(mv.to);
    return `<div class="mv-box"><b>Es una ${kind}.</b> Para cerrarla anota dónde quedó el vino: cada vasija con sus litros reales.${mv.kind === 'blend' ? ` Al cerrar, ${esc((mv.parents || []).map(p => p.tab).join(', '))} se archiva y sigue en ${esc(mv.tab)}.` : ''}
      <div class="mv-lbl">Vasijas de destino</div><div class="mv-dest">${(dests.length ? dests : ['']).map(v => destRow(v, '')).join('')}</div>
      <button type="button" class="btn sm" data-dadd>+ vasija</button>
      <div class="mv-lbl">¿Cómo quedó el origen (${esc(mv.from || (mv.parents || []).map(p => p.vessels).join(', ') || '—')})?</div>
      <label class="mv-r"><input type="radio" name="mvsrc" value="empty" checked> Vacío</label>
      <label class="mv-r"><input type="radio" name="mvsrc" value="left"> Quedó vino</label>
      <label class="mv-left" hidden>Litros que quedaron <input data-left inputmode="decimal" placeholder="L"></label></div>`;
  }
  async function saveBottle(form, x) {
    const err = $('#enErr'), btn = $('#enSave'), mv = F.move;
    const formats = $$('.mv-f', form).map(r => ({ ml: $('[data-fml]', r).value, bottles: $('[data-fn]', r).value.trim().replace(/[.,\s]/g, '') })).filter(f => f.bottles);
    if (!formats.length || formats.some(f => !(+f.bottles > 0))) { err.textContent = 'Anota cuántas botellas salieron (o quita las filas vacías).'; return; }
    const src = (form.querySelector('[name="mvsrc"]:checked') || {}).value || 'empty', left = ($('[data-left]', form) || {}).value || '';
    if (src === 'left' && !(+String(left).replace(',', '.') > 0)) { err.textContent = 'Anota cuántos litros quedaron en el origen.'; return; }
    const g = sel => (($(sel, form) || {}).value || '').trim().replace(',', '.');
    btn.disabled = true; btn.textContent = 'Guardando…';
    try {
      const r = await post('/api/moves/complete', { id: mv.id, signer: x.signer, formats, liters: g('[data-bl]'), loss: g('[data-bloss]'), fso2: g('[data-bfs]'), tso2: g('[data-bts]'), lotno: g('[data-blot]'), source: src, left, note: x.note });
      await loadMoves(); E.entriesAt = 0; closeForm();
      toast('Embotellado cerrado · ' + r.bottles + ' botellas · ' + r.total + ' L' + (r.bottled ? ' · el vino pasa a Embotellado' : ''));
      window.dispatchEvent(new CustomEvent('cellar:refresh')); window.dispatchEvent(new CustomEvent('cellar:lotschanged'));
      setTimeout(decorateOrders, 400); refreshLotPanels();
    } catch (e) { err.textContent = e.message; } finally { btn.disabled = false; btn.textContent = 'Guardar'; }
  }
  async function saveMove(form, x) {
    if (F.move && F.move.kind === 'bottle') return saveBottle(form, x);
    const err = $('#enErr'), btn = $('#enSave'), mv = F.move;
    const dest = $$('.mv-d', form).map(r => ({ vessel: $('[data-dv]', r).value.trim(), liters: $('[data-dl]', r).value.trim().replace(',', '.') })).filter(d => d.vessel || d.liters);
    if (!dest.length || dest.some(d => !d.vessel || !(+d.liters > 0))) { err.textContent = 'Anota cada vasija de destino con sus litros (o quita las filas vacías).'; return; }
    const src = (form.querySelector('[name="mvsrc"]:checked') || {}).value || 'empty', left = ($('[data-left]', form) || {}).value || '';
    if (src === 'left' && !(+String(left).replace(',', '.') > 0)) { err.textContent = 'Anota cuántos litros quedaron en el origen.'; return; }
    btn.disabled = true; btn.textContent = 'Guardando…';
    try {
      const r = await post('/api/moves/complete', { id: mv.id, signer: x.signer, dest, source: src, left, note: x.note });
      // Extra measurements typed in the same form go in their own signed row.
      if (Object.keys(x.values).length || x.others.length) { try { await post('/api/entries', { kind: 'result', tab: mv.tab, lot: mv.lot, ubi: dest.map(d => d.vessel).join(', '), values: x.values, others: x.others, note: '', signer: x.signer, order: { tab: mv.tab, row: mv.row, note: mv.note } }); } catch (e) {} }
      await loadMoves(); E.entriesAt = 0; closeForm();
      toast((mv.kind === 'blend' ? 'Mezcla cerrada' : 'Trasiego cerrado') + ' · ' + r.total + ' L' + (r.archived && r.archived.length ? ' · archivado: ' + r.archived.join(', ') : '') + (r.barrels && r.barrels.length ? ' · barricas: ' + r.barrels.join(', ') : ''));
      window.dispatchEvent(new CustomEvent('cellar:refresh')); window.dispatchEvent(new CustomEvent('cellar:lotschanged'));
      setTimeout(decorateOrders, 400); refreshLotPanels();
    } catch (e) { err.textContent = e.message; } finally { btn.disabled = false; btn.textContent = 'Guardar'; }
  }

  // ---------- new racking / blending order (Eric and Diane) ----------
  const tabShort = t => String(t || '').toUpperCase().replace(/\s*-\s*/g, ' ').replace(/\s+/g, ' ').trim();
  const ubiOnly = u => String(u || '').split(/\s+[·→]\s+/)[0];
  async function openMove() {
    try { await load(); } catch (e) { toast('No se pudo abrir: ' + e.message); return; }
    try { E.barrels = ((await api('/api/db/barrels')).rows || []).map(r => Object.assign({ id: r.id }, r.data)); } catch (e) { E.barrels = []; }
    const lots = E.lots.filter(l => !l.archived && !l.bottled && l.group !== 'routine' && (l.sheet || []).some(s => s.tab && !s.archived))
      .sort((a, b) => String(a.sheet[0].tab).localeCompare(String(b.sheet[0].tab), undefined, { numeric: true }));
    const M = { kind: 'rack', sel: [], master: '', name: '', nameEdited: false };
    let ov = $('#mvSheet');
    if (!ov) { ov = document.createElement('div'); ov.className = 'overlay en-ov'; ov.id = 'mvSheet'; document.body.appendChild(ov); ov.addEventListener('click', e => { if (e.target === ov) guardClose($('form', ov), () => { ov.hidden = true; document.documentElement.classList.remove('m-modal'); }); }); }
    const close = () => { ov.hidden = true; document.documentElement.classList.remove('m-modal'); };
    const tabOf = l => l.sheet.find(s => !s.archived).tab;
    const empties = E.barrels.filter(b => !b.lot && b.fill !== 'full' && b.status !== 'confirm').sort((a, b) => (+a.code || 0) - (+b.code || 0)).slice(0, 24);
    const staffChips = E.staff.slice().sort((a, b) => (a.role === 'receiver' ? 0 : 1) - (b.role === 'receiver' ? 0 : 1) || (a.order || 0) - (b.order || 0))
      .map(s => `<button type="button" class="en-chip" data-mas="${esc(signerTag(s))}" aria-pressed="${['P', 'J'].includes(signerTag(s))}">${esc(s.name)}</button>`).join('');
    const today = new Date(Date.now() - 6 * 3600e3).toISOString().slice(0, 10);
    ov.innerHTML = `<form class="sheet en-form mv-form" novalidate>
      <h2>Trasiego · mezcla · embotellado</h2>${XBTN}
      <div class="en-sig" role="group" aria-label="Tipo"><button type="button" class="en-chip" data-mk="rack" aria-pressed="true">Trasiego<small> · un vino a otra vasija</small></button><button type="button" class="en-chip" data-mk="blend" aria-pressed="false">Mezcla<small> · juntar lotes</small></button><button type="button" class="en-chip" data-mk="bottle" aria-pressed="false">Embotellado<small> · a botellas</small></button></div>
      <div class="field"><label>Vino(s) <span class="ed-hint mv-hint">toca el vino que se mueve</span></label>
        <input type="search" class="en-lotq" placeholder="Buscar: rosé, L15…" autocomplete="off">
        <div class="en-lots en-all">${lots.map(l => `<button type="button" class="en-lot" data-ml="${esc(l.id)}" aria-pressed="false" style="--c:${GC[l.group] || '#9aa5b1'}"><b>${esc(l.name)}</b><small>${esc(tabOf(l))}${l.ubi ? ' · ' + esc(ubiOnly(l.ubi)) : ''}</small></button>`).join('')}</div></div>
      <div class="mv-sel"></div>
      <div class="field mv-namef" hidden><label for="mvName">Nombre del lote mezclado <span class="ed-hint">se propone solo; puedes cambiarlo</span></label><input id="mvName" autocomplete="off"></div>
      <div class="mv-btl" hidden>
        <div class="en-row2"><label>Formato<select id="mvFmt"><option value="750" selected>750 mL</option><option value="375">375 mL</option><option value="500">500 mL</option><option value="1500">1.5 L</option></select></label><label>Botellas aprox.<input id="mvBot" inputmode="numeric" placeholder="1,040"></label></div>
        <div class="en-row2"><label>Cierre<select id="mvClo"><option>Corcho</option><option>Rosca</option><option>Corcholata</option><option>Otro</option></select></label><label>Filtración<select id="mvFil"><option value="none">Sin filtrar</option><option value="pad">Placas (ligera)</option><option value="sterile">Estéril 0.45 µm</option><option value="both" selected>Placas + estéril</option></select></label></div>
        <label class="mv-so2">SO₂ libre meta al embotellar (mg/L) <span class="ed-hint">opcional</span><input id="mvSo2" inputmode="decimal" placeholder="28"></label>
      </div>
      <div class="field mv-tof"><label for="mvTo">¿A dónde va? <span class="ed-hint">vasijas de destino</span></label><input id="mvTo" placeholder="BBL 60, 61 · TANQUE 6" autocomplete="off">
        ${empties.length ? `<div class="mv-empties"><small class="en-hint">Barricas vacías:</small> ${empties.map(b => `<button type="button" class="cr-chipmini" data-eb="${esc(b.code)}">${esc(b.code)}</button>`).join('')}</div>` : ''}</div>
      <div class="en-row2"><label>Fecha<input type="date" id="mvDate" value="${today}"></label><label>Prioridad<select id="mvPri"><option>URGENT</option><option selected>HIGH</option><option>NORMAL</option><option>LOW</option></select></label></div>
      <div class="field"><label>Asignar a</label><div class="en-sig">${staffChips}</div></div>
      <div class="field"><label for="mvExtra">Indicaciones extra <span class="ed-hint">opcional</span></label><textarea id="mvExtra" rows="2" maxlength="400"></textarea></div>
      <div class="err" id="mvErr" role="alert"></div>
      <div class="actions"><span></span><div class="right"><button type="button" class="btn" data-mvc>Cancelar</button><button type="submit" class="btn primary" id="mvSave">Crear orden</button></div></div>
    </form>`;
    ov.hidden = false; document.documentElement.classList.add('m-modal');
    const f = $('form', ov);
    const lotById = id => lots.find(l => l.id === id);
    const autoName = () => { const ms = lotById(M.master); if (!ms) return ''; return [tabShort(tabOf(ms))].concat(M.sel.filter(id => id !== M.master).map(id => tabShort(tabOf(lotById(id))))).join(' + '); };
    const drawSel = () => {
      $$('[data-ml]', f).forEach(b => b.setAttribute('aria-pressed', String(M.sel.includes(b.dataset.ml))));
      if (M.sel.length && !M.sel.includes(M.master)) M.master = M.sel[0];
      const keep = {}; $$('.mv-row', f).forEach(r => { keep[r.dataset.lot] = { v: $('[data-fv]', r).value, l: $('[data-fl]', r).value }; });
      $('.mv-sel', f).innerHTML = M.sel.map(id => { const l = lotById(id), k = keep[id] || { v: ubiOnly(l.ubi), l: l.vol || '' };
        return `<div class="mv-row" data-lot="${esc(id)}"><div class="mv-rh"><b>${esc(l.name)}</b> <small>${esc(tabOf(l))}</small>${M.kind === 'blend' ? `<label class="mv-r"><input type="radio" name="mvm" value="${esc(id)}"${id === M.master ? ' checked' : ''}> Maestro</label>` : ''}</div>
          <div class="en-row2"><label>Desde (vasijas)<input data-fv value="${esc(k.v)}" placeholder="BBL 44, 48"></label><label>Litros aprox.<input data-fl inputmode="decimal" value="${esc(k.l)}"></label></div></div>`; }).join('');
      $('.mv-namef', f).hidden = M.kind !== 'blend';
      $('.mv-tof', f).hidden = M.kind === 'bottle'; $('.mv-btl', f).hidden = M.kind !== 'bottle';
      if (M.kind === 'bottle') { const r = $('.mv-row [data-fl]', f), n = $('#mvBot', f); if (r && r.value && !n.dataset.ed) n.value = Math.floor(+r.value * 1000 / (+$('#mvFmt', f).value || 750)) || ''; }
      if (M.kind === 'blend' && !M.nameEdited) $('#mvName', f).value = autoName();
      $('.mv-hint', f).textContent = M.kind === 'blend' ? 'toca dos o más vinos; elige cuál es el maestro (se queda con su pestaña)' : M.kind === 'bottle' ? 'toca el vino que se embotella' : 'toca el vino que se mueve';
    };
    f.addEventListener('click', e => {
      const k = e.target.closest('[data-mk]'); if (k) { M.kind = k.dataset.mk; $$('[data-mk]', f).forEach(b => b.setAttribute('aria-pressed', String(b === k))); if (M.kind !== 'blend') M.sel = M.sel.slice(0, 1); drawSel(); return; }
      const l = e.target.closest('[data-ml]'); if (l) { const id = l.dataset.ml; if (M.kind !== 'blend') M.sel = M.sel[0] === id ? [] : [id]; else M.sel = M.sel.includes(id) ? M.sel.filter(x => x !== id) : M.sel.concat(id); drawSel(); return; }
      const eb = e.target.closest('[data-eb]'); if (eb) { const t = $('#mvTo', f); const cur = t.value.trim(); t.value = cur ? cur + ', ' + (/BBL/i.test(cur) ? '' : 'BBL ') + eb.dataset.eb : 'BBL ' + eb.dataset.eb; eb.disabled = true; return; }
      const a = e.target.closest('[data-mas]'); if (a) { a.setAttribute('aria-pressed', String(a.getAttribute('aria-pressed') !== 'true')); return; }
      if (e.target.closest('[data-mvc]')) close();
    });
    const drawBot = () => { const r = $('.mv-row [data-fl]', f), n = $('#mvBot', f); if (r && r.value && !n.dataset.ed) n.value = Math.floor(+String(r.value).replace(',', '.') * 1000 / (+$('#mvFmt', f).value || 750)) || ''; };
    f.addEventListener('change', e => { if (e.target.name === 'mvm') { M.master = e.target.value; drawSel(); } if (e.target.id === 'mvFmt') drawBot(); });
    f.addEventListener('input', e => { if (e.target.id === 'mvName') M.nameEdited = true; if (e.target.id === 'mvBot') e.target.dataset.ed = '1'; if (e.target.matches('[data-fl]') && M.kind === 'bottle') drawBot(); if (e.target.classList.contains('en-lotq')) { const q = e.target.value.trim().toLowerCase(); $$('[data-ml]', f).forEach(b => { b.hidden = !!q && !b.textContent.toLowerCase().includes(q); }); } });
    f.addEventListener('submit', async e => {
      e.preventDefault(); const err = $('#mvErr', f), btn = $('#mvSave', f); err.textContent = '';
      if (!M.sel.length) { err.textContent = 'Elige el vino.'; return; }
      if (M.kind === 'blend' && M.sel.length < 2) { err.textContent = 'Para una mezcla elige dos o más vinos.'; return; }
      const to = M.kind === 'bottle' ? 'BOTELLAS' : $('#mvTo', f).value.trim(); if (!to) { err.textContent = 'Falta a dónde va el vino.'; return; }
      const asig = $$('[data-mas][aria-pressed="true"]', f).map(b => b.dataset.mas).join('/'); if (!asig) { err.textContent = 'Asigna a alguien.'; return; }
      const row = id => { const r = $(`.mv-row[data-lot="${CSS.escape(id)}"]`, f); return { v: $('[data-fv]', r).value.trim(), l: $('[data-fl]', r).value.trim() }; };
      const ms = lotById(M.master), mr = row(M.master);
      if (M.kind === 'bottle' && !mr.v) { err.textContent = 'Anota de qué vasijas sale el vino.'; return; }
      const body = { kind: M.kind, lot: ms.id, masterTab: tabOf(ms), from: mr.v, liters: mr.l, to, date: $('#mvDate', f).value, pri: $('#mvPri', f).value, asig, extra: $('#mvExtra', f).value.trim(),
        bottle: M.kind === 'bottle' ? { format: $('#mvFmt', f).value, bottles: $('#mvBot', f).value, closure: $('#mvClo', f).value, filter: $('#mvFil', f).value, so2: $('#mvSo2', f).value } : null,
        name: M.kind === 'blend' ? $('#mvName', f).value.trim() : '', parents: M.kind === 'blend' ? M.sel.filter(id => id !== M.master).map(id => { const r = row(id); return { lot: id, tab: tabOf(lotById(id)), vessels: r.v, liters: r.l }; }) : [] };
      btn.disabled = true; btn.textContent = 'Creando…';
      try { const r = await post('/api/moves', body); await loadMoves(); close(); toast('Orden creada en ' + r.tab + ', fila ' + r.row); window.dispatchEvent(new CustomEvent('cellar:refresh')); }
      catch (x) { err.textContent = x.message; } finally { btn.disabled = false; btn.textContent = 'Crear orden'; }
    });
    drawSel();
  }
  window.addEventListener('cellar:move', openMove);

  // ---------- Embotellado: upcoming bottling orders + every bottling done ----------
  const FILTL = { none: 'Sin filtrar', pad: 'Placas', sterile: 'Estéril', both: 'Placas + estéril' };
  const fmtL = n => (Math.round(+n * 10) / 10).toLocaleString('es-MX');
  const dmy = iso => iso ? +iso.slice(8, 10) + '/' + +iso.slice(5, 7) + '/' + iso.slice(2, 4) : '';
  const fmtTxt = fs => (fs || []).map(f => f.bottles.toLocaleString('es-MX') + ' × ' + (f.ml >= 1000 ? f.ml / 1000 + ' L' : f.ml + ' mL')).join(' + ');
  function bottlingRuns(lots) {
    const runs = [];
    for (const l of lots) for (const b of (l.bottlings || [])) runs.push(Object.assign({ lot: l }, b));
    return runs.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  }
  async function renderBottling(lotsIn) {
    const box = document.getElementById('bottleDone') || document.getElementById('bottleView'); if (!box) return;
    try { await load(); } catch (e) {}
    const lots = lotsIn && lotsIn.length ? lotsIn : E.lots;
    const lotById = id => lots.find(l => l.id === id) || E.lots.find(l => l.id === id);
    const open = E.moves.filter(m => m.kind === 'bottle' && m.status === 'open').sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const runs = bottlingRuns(lots);
    const n = document.getElementById('wmBottleN'); if (n) n.textContent = runs.length || '';
    const total = runs.reduce((s, r) => s + (r.bottles || 0), 0), liters = runs.reduce((s, r) => s + (+r.liters || 0), 0);
    const dot = l => `<i class="bt-dot" style="background:${GC[(l || {}).group] || '#9aa5b1'}"></i>`;
    let h = `<div class="bt-head"><b>${runs.length} embotellado${runs.length === 1 ? '' : 's'}</b> · ${total.toLocaleString('es-MX')} botellas · ${fmtL(liters)} L${open.length ? ` · <b>${open.length} programado${open.length > 1 ? 's' : ''}</b>` : ''}</div>`;
    if (open.length) h += `<h3 class="cr-gh">Próximos <small>órdenes abiertas</small></h3><div class="bt-up">${open.map(m => { const l = lotById(m.lot), b = m.bottle || {};
      return `<article class="bt-card"><div class="bt-d">${esc(dmy(m.date))}</div><div>${dot(l)}<b>${esc((l || {}).name || m.tab)}</b><small>${esc(m.from || '')}${m.liters ? ' · ~' + fmtL(m.liters) + ' L' : ''}</small>
        <span class="bt-m">${b.bottles ? '~' + (+b.bottles).toLocaleString('es-MX') + ' × ' : ''}${b.format || 750} mL · ${esc(FILTL[b.filter] || 'Sin filtrar')} · ${esc(b.closure || '')}${b.so2 ? ' · SO₂ ' + b.so2 : ''}</span></div>
        <span class="bt-t">${esc(m.tab)}, fila ${m.row}</span></article>`; }).join('')}</div>`;
    h += `<h3 class="cr-gh">Embotellado <small>lo más reciente primero</small></h3>`;
    if (!runs.length) h += `<div class="cr-empty">Todavía no hay embotellados registrados. Se crean con «Agregar → Trasiego · mezcla · embotellado → Embotellado» y se cierran desde «Anotar resultados» al terminar.</div>`;
    else h += `<div class="bt-wrap"><table class="bt-tbl"><thead><tr><th>Fecha</th><th>Vino</th><th>Botellas</th><th>Litros</th><th>Merma</th><th>Filtración</th><th>SO₂ libre / total</th><th>Lote</th></tr></thead><tbody>${runs.map(r => `<tr>
      <td class="n">${esc(dmy(r.date))}</td><td>${dot(r.lot)}<b>${esc(r.wine || r.lot.name)}</b>${r.sourceEmpty === false ? ' <span class="bt-part">parcial</span>' : ''}<small>${esc(r.from || '')}</small></td>
      <td class="n">${esc(fmtTxt(r.formats))}</td><td class="n">${fmtL(r.liters || 0)}</td><td class="n">${r.loss ? fmtL(r.loss) + ' L' : '—'}</td>
      <td>${esc(FILTL[r.filter] || r.filter || '—')}</td><td class="n">${esc((r.fso2 || '—') + ' / ' + (r.tso2 || '—'))}</td><td class="n">${esc(r.lotno || '—')}</td></tr>`).join('')}</tbody></table></div>`;
    box.innerHTML = h;
  }
  window.addEventListener('cellar:bottling', e => renderBottling((e.detail || {}).lots));
  // Keep the tab's count fresh even before someone opens it.
  load().then(() => { const n = document.getElementById('wmBottleN'); if (n) n.textContent = bottlingRuns(E.lots).length || ''; }).catch(() => {});

  // × in the top-right of every sheet; asks before throwing away typed work.
  const XBTN = '<button type="button" class="en-close" data-xclose aria-label="Cerrar">×</button>';
  function dirty(form) { return !!form && form.dataset.dirty === '1'; }
  function guardClose(form, close) { if (!dirty(form) || confirm('¿Salir sin guardar? Lo que escribiste se pierde.')) close(); }
  document.addEventListener('input', e => { const f = e.target.closest && e.target.closest('.en-form'); if (f && !e.target.classList.contains('en-lotq')) f.dataset.dirty = '1'; }, true);
  document.addEventListener('click', e => {
    const x = e.target.closest('[data-xclose]'); if (!x) return;
    const ov = x.closest('.overlay'); const f = x.closest('form');
    guardClose(f, () => { if (ov && ov.id === 'enSheet') closeForm(); else if (ov) { ov.hidden = true; document.documentElement.classList.remove('m-modal'); } });
  });
  function closeForm() { const ov = $('#enSheet'); if (ov) ov.hidden = true; F = null; document.documentElement.classList.remove('m-modal'); }
  async function saveForm(form) {
    const err = $('#enErr'), btn = $('#enSave');
    const o = F.order, tab = o ? o.tab : $('#enTab').value;
    const values = {}; $$('[data-pk]', form).forEach(i => { if (i.value.trim()) values[i.dataset.pk] = i.value.trim(); });
    const others = $$('.en-other', form).map(r => ({ name: $('[data-o="name"]', r).value.trim(), value: $('[data-o="value"]', r).value.trim(), unit: $('[data-o="unit"]', r).value.trim() })).filter(x => x.name && x.value);
    const note = $('#enNote').value.trim(), signer = signerValue(form), done = !!($('#enDone') && $('#enDone').checked);
    err.textContent = '';
    if (!tab) { err.textContent = 'Elige el vino / lote.'; return; }
    if (!signer) { err.textContent = 'Falta «¿Quién lo hizo?».'; return; }
    if (F.move && done) return saveMove(form, { values, others, note, signer });
    if (!note && !Object.keys(values).length && !others.length) {
      if (o && done) { // nothing to record: just mark it done
        if (/ANOTAR|LITROS|GRAMOS/i.test(o.note || '') && !form.dataset.warned) { form.dataset.warned = '1'; err.textContent = 'La orden pide anotar un valor (litros, gramos, resultado…). Toca Guardar otra vez para marcarla hecha sin valor.'; return; }
        window.dispatchEvent(new CustomEvent('cellar:orderdone', { detail: { key: o.key, ini: signer } })); closeForm(); toast('Orden marcada como hecha (' + signer + ')'); return;
      }
      err.textContent = 'Escribe una nota o al menos un valor.'; return;
    }
    if (o && done && /ANOTAR|LITROS|GRAMOS/i.test(o.note || '') && !Object.keys(values).length && !form.dataset.warned) {
      form.dataset.warned = '1'; err.textContent = 'Aviso: la orden pide anotar un valor y no hay ninguno. Toca Guardar otra vez para guardar así.'; return;
    }
    if (F.move && done) return saveMove(form, { values, others, note, signer });
    btn.disabled = true; btn.textContent = 'Guardando…';
    try {
      const r = await post('/api/entries', { kind: o ? 'result' : 'note', tab, lot: o ? o.lot : '', ubi: $('#enUbi').value.trim(), values, others, note, signer, pdf: F.pdf ? 'app:' + F.pdf.slice(0, 12) : '', order: o ? { tab: o.tab, row: o.row, note: o.note } : null });
      if (!o) rememberTab(tab);
      if (o && done) window.dispatchEvent(new CustomEvent('cellar:orderdone', { detail: { key: o.key, ini: signer } }));
      E.entriesAt = 0; closeForm();
      toast('Guardado en ' + r.tab + ', fila ' + r.row + (o && done ? ' · orden hecha' : ''));
      window.dispatchEvent(new CustomEvent('cellar:refresh'));
      setTimeout(decorateOrders, 400); refreshLotPanels();
    } catch (e) { err.textContent = e.message; } finally { btn.disabled = false; btn.textContent = 'Guardar'; }
  }

  // ---------- results under each work order ----------
  async function entries() {
    if (E.entries && Date.now() - E.entriesAt < 60000) return E.entries;
    const since = new Date(Date.now() - 45 * 864e5).toISOString().slice(0, 10);
    try { E.entries = (await api('/api/entries?since=' + since)).rows || []; E.entriesAt = Date.now(); } catch (e) { E.entries = E.entries || []; }
    return E.entries;
  }
  const label = k => { const p = E.params.find(x => x.k === k); return p ? p.label : k; };
  const valLine = r => Object.entries(r.values || {}).map(([k, v]) => label(k) + ' ' + v).concat((r.others || []).map(o => o.name + ' ' + o.value)).join(' · ');
  async function decorateOrders() {
    const slots = $$('.asg-results[data-results]'); if (!slots.length) return;
    await load().catch(() => {});
    const rows = await entries();
    for (const s of slots) {
      const [tab, row] = s.dataset.results.split('|');
      const mine = rows.filter(r => r.order && r.order.tab === tab && String(r.order.row) === row);
      const h = mine.map(r => `<span class="en-res"><b>${esc(dm(r.date))} · ${esc(r.signer)}</b>${r.ubi ? ' · ' + esc(r.ubi) : ''}${valLine(r) ? ' · ' + esc(valLine(r)) : ''}${r.note ? ' · ' + esc(r.note) : ''}</span>`).join('');
      if (s.__h !== h) { s.__h = h; s.innerHTML = h; }
    }
  }
  window.addEventListener('cellar:asgrendered', () => decorateOrders());

  // ---------- lab upload + confirm ----------
  async function uploadFile(f) {
    if (f.size > 15 * 1024 * 1024) throw new Error('El archivo pasa de 15 MB.');
    const type = f.type || (/\.pdf$/i.test(f.name) ? 'application/pdf' : 'image/jpeg');
    return api('/api/labs/upload?name=' + encodeURIComponent(f.name), { method: 'POST', headers: { 'content-type': type }, body: f });
  }
  let L = null;
  async function openLab(ctx) {
    try { await load(); } catch (e) { toast(e.message); return; }
    let ov = $('#labSheet');
    if (!ov) { ov = document.createElement('div'); ov.className = 'overlay en-ov'; ov.id = 'labSheet'; document.body.appendChild(ov); ov.addEventListener('click', e => { if (e.target === ov) closeLab(); }); }
    L = { hash: ctx && ctx.hash || '', step: 'pick' };
    ov.hidden = false; document.documentElement.classList.add('m-modal');
    if (!E.labsOn) { ov.innerHTML = `<div class="sheet"><h2>Subir lab</h2><p>Subida de laboratorio aún no activada.</p><div class="actions"><span></span><div class="right"><button type="button" class="btn" data-lclose>Cerrar</button></div></div></div>`; $('[data-lclose]', ov).onclick = closeLab; return; }
    if (L.hash) return readLab(ov);
    ov.innerHTML = `<div class="sheet en-lab"><h2>Subir lab</h2>${XBTN}
      <p class="en-hint">PDF de Uva y Vino o San Lucas, o una foto clara de la hoja. Claude lee cada muestra y tú confirmas antes de guardar.</p>
      <label class="btn primary en-pick">Elegir PDF o foto<input type="file" accept="application/pdf,image/*" hidden id="labFile"></label>
      <div class="err" id="labErr" role="alert"></div>
      <div class="actions"><span></span><div class="right"><button type="button" class="btn" data-lclose>Cancelar</button></div></div></div>`;
    $('[data-lclose]', ov).onclick = closeLab;
    $('#labFile').addEventListener('change', async e => {
      const f = e.target.files[0]; if (!f) return;
      $('#labErr').textContent = 'Subiendo ' + f.name + '…';
      try { const up = await uploadFile(f); L.hash = up.hash; if (up.dup) toast('Ese archivo ya se había subido; lo vuelvo a leer.'); readLab(ov); }
      catch (x) { $('#labErr').textContent = x.message; }
    });
  }
  function closeLab() { const ov = $('#labSheet'); if (ov) ov.hidden = true; L = null; document.documentElement.classList.remove('m-modal'); }
  async function readLab(ov) {
    ov.innerHTML = `<div class="sheet en-lab"><h2>Subir lab</h2>${XBTN}<div class="en-reading"><span class="en-spin" aria-hidden="true"></span>Leyendo el reporte con Claude… (30–60 s)</div></div>`;
    let x;
    try { x = await post('/api/labs/extract', { hash: L.hash }); }
    catch (e) { ov.innerHTML = `<div class="sheet"><h2>Subir lab</h2><div class="err">${esc(e.message)}</div><div class="actions"><span></span><div class="right"><button type="button" class="btn" data-lclose>Cerrar</button></div></div></div>`; $('[data-lclose]', ov).onclick = closeLab; return; }
    L.x = x;
    const tabOpts = sel => `<option value="">— no guardar —</option>` + (x.tabs || []).map(t => `<option${t === sel ? ' selected' : ''}>${esc(t)}</option>`).join('');
    const card = (s, i) => {
      const vals = Object.entries(s.values || {});
      return `<article class="en-sample${s.dup ? ' dup' : ''}" data-i="${i}">
        <header><b>${esc(s.label)}</b>${s.dup ? '<span class="en-dup">ya guardada</span>' : ''}</header>
        <div class="en-row2"><label>Lote / pestaña<select data-f="tab">${tabOpts(s.tab)}</select></label><label>Vasija<input data-f="ubi" value="${esc(s.ubi)}"></label><label>Muestreo<input data-f="sampled" type="date" value="${esc(s.sampled)}"></label></div>
        <table class="en-vals"><tbody>${vals.map(([k, v]) => `<tr><th>${esc(label(k))}</th><td><input data-v="${esc(k)}" value="${esc(v)}"></td><td class="u">${esc((E.params.find(p => p.k === k) || {}).unit || '')}</td></tr>`).join('')}
        ${(s.extras || []).map((o, j) => `<tr class="ex"><th>${esc(o.name)} <small>otro</small></th><td><input data-x="${j}" value="${esc(o.value)}"></td><td class="u">${esc(o.unit)}</td></tr>`).join('')}</tbody></table>
      </article>`;
    };
    ov.innerHTML = `<form class="sheet en-lab en-form" data-dirty="1" novalidate><h2>Confirmar resultados</h2>${XBTN}
      <div class="en-row2"><label>Laboratorio<input id="labName" value="${esc(x.lab || 'Uva y Vino')}"></label><label>Fecha del reporte<input id="labDate" type="date" value="${esc(x.report_date || '')}"></label></div>
      <p class="en-hint">${x.samples.length} muestra${x.samples.length === 1 ? '' : 's'}. Revisa el lote y la vasija de cada una; las que dejes en «no guardar» no se guardan. Los parámetros que no conocemos se guardan como «otro».</p>
      ${x.samples.map(card).join('')}
      <div class="err" id="labErr" role="alert"></div>
      <div class="actions"><span></span><div class="right"><button type="button" class="btn" data-lclose>Cancelar</button><button type="submit" class="btn primary" id="labSave">Guardar ${x.samples.filter(s => !s.dup).length} muestras</button></div></div></form>`;
    $('[data-lclose]', ov).onclick = closeLab;
    $('form', ov).addEventListener('submit', async e => {
      e.preventDefault();
      const samples = $$('.en-sample', ov).map(a => {
        const s = L.x.samples[+a.dataset.i], values = {}, extras = (s.extras || []).map(o => Object.assign({}, o));
        $$('[data-v]', a).forEach(i => { if (i.value.trim()) values[i.dataset.v] = i.value.trim(); });
        $$('[data-x]', a).forEach(i => { extras[+i.dataset.x].value = i.value.trim(); });
        return { label: s.label, tab: $('[data-f="tab"]', a).value, ubi: $('[data-f="ubi"]', a).value, sampled: $('[data-f="sampled"]', a).value, values, extras: extras.filter(o => o.value) };
      });
      const btn = $('#labSave'); btn.disabled = true; btn.textContent = 'Guardando…';
      try {
        const r = await post('/api/labs/save', { hash: L.hash, lab: $('#labName').value, report_date: $('#labDate').value, samples });
        const n = r.saved.filter(x => !x.dup).length, d = r.saved.length - n;
        closeLab(); toast(n + ' muestra' + (n === 1 ? '' : 's') + ' guardada' + (n === 1 ? '' : 's') + (d ? ' · ' + d + ' ya estaba' + (d === 1 ? '' : 'n') : ''));
        E.labsAt = 0; renderReports(); refreshLotPanels(); window.dispatchEvent(new CustomEvent('cellar:refresh'));
      } catch (x2) { $('#labErr').textContent = x2.message; btn.disabled = false; btn.textContent = 'Guardar'; }
    });
  }

  // ---------- Labs section: every report, with its file ----------
  async function labs() {
    if (E.labs && Date.now() - E.labsAt < 60000) return E.labs;
    try { E.labs = await api('/api/labs'); E.labsAt = Date.now(); } catch (e) { E.labs = E.labs || { labs: [], files: [], enabled: false }; }
    return E.labs;
  }
  // Reportes: one card per lab file (PDF icon · lab · date · how many samples) with the lots it covers as chips;
  // "Ver muestras" lists each sample → lot tab · vessel · Excellovint row. Filter by lab and search by lot.
  const PDF_ICO = '<svg class="en-pdf" viewBox="0 0 28 34" aria-hidden="true"><path d="M3 1h15l8 8v23a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1z" fill="#fff" stroke="#b3261e" stroke-width="1.6"/><path d="M18 1v8h8" fill="none" stroke="#b3261e" stroke-width="1.6"/><rect x="0" y="17" width="22" height="10" rx="1.5" fill="#b3261e"/><text x="11" y="25" text-anchor="middle" font-size="7.5" font-weight="700" fill="#fff" font-family="Arial,sans-serif">PDF</text></svg>';
  const fmtLong = iso => { if (!/^\d{4}-\d{2}-\d{2}/.test(iso || '')) return ''; const d = new Date(iso.slice(0, 10) + 'T12:00'); return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' }); };
  const lotCode = tab => (String(tab).match(/^L\s*\d+/i) || [tab])[0].replace(/\s+/g, '').toUpperCase();
  const RP = { q: '', lab: '' };
  function reportInfo(f, labsRecs) {
    const r = f.report || {}, ex = f.extracted || {};
    const recs = labsRecs.filter(x => x.hash === f.id);
    const samples = (r.samples && r.samples.length ? r.samples : recs.map(x => ({ label: x.label, tab: x.tab, ubi: x.ubi, row: x.row })));
    return { lab: r.lab || ex.lab || (recs[0] && recs[0].lab) || '', date: r.report_date || ex.report_date || (recs[0] && recs[0].report_date) || String(f.at || '').slice(0, 10), samples, pending: !samples.length };
  }
  async function renderReports() {
    const el = $('#labReports'); if (!el) return;
    await load().catch(() => {});
    const d = await labs();
    const all = (d.files || []).map(f => Object.assign({ f }, reportInfo(f, d.labs || []))).sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const labsList = [...new Set(all.map(x => x.lab).filter(Boolean))];
    const q = RP.q.trim().toLowerCase();
    const shown = all.filter(x => (!RP.lab || x.lab === RP.lab) && (!q || (x.lab + ' ' + x.f.name + ' ' + x.samples.map(s => s.label + ' ' + s.tab + ' ' + s.ubi).join(' ')).toLowerCase().includes(q)));
    const wineOf = tab => { const l = E.lots.find(l => (l.sheet || []).some(s => s.tab === tab)); return l ? (l.id === 'all' ? 'Bodega' : l.name) : ''; };
    const card = x => {
      const lots = [...new Set(x.samples.map(s => s.tab))];
      const hit = s => q && (s.label + ' ' + s.tab + ' ' + s.ubi).toLowerCase().includes(q);
      return `<article class="rp-card">
        <a class="rp-ico" href="/api/labs/file?h=${esc(x.f.id)}" target="_blank" rel="noopener" aria-label="Abrir PDF">${PDF_ICO}</a>
        <div class="rp-main">
          <div class="rp-h"><b>${esc(x.lab || 'Laboratorio')}</b><span>${esc(fmtLong(x.date))}</span></div>
          <div class="rp-sub">${x.pending ? 'Sin leer todavía' : `${x.samples.length} muestra${x.samples.length === 1 ? '' : 's'} · ${lots.length} lote${lots.length === 1 ? '' : 's'}`} · <a href="/api/labs/file?h=${esc(x.f.id)}" target="_blank" rel="noopener">${esc(x.f.name)}</a></div>
          ${lots.length ? `<div class="rp-lots">${lots.map(t => `<span class="rp-lot${x.samples.some(s => s.tab === t && hit(s)) ? ' hit' : ''}" title="${esc(wineOf(t) + ' · ' + t)}">${esc(lotCode(t))}</span>`).join('')}</div>` : ''}
          ${x.samples.length ? `<details class="rp-det"${q && x.samples.some(hit) ? ' open' : ''}><summary>Ver muestras</summary><table class="rp-tbl"><thead><tr><th>Muestra en el PDF</th><th>Lote</th><th>Vasija</th><th>Fila</th></tr></thead><tbody>${(q && x.samples.some(hit) ? x.samples.filter(hit) : x.samples).map(s => `<tr${hit(s) ? ' class="hit"' : ''}><td>${esc(s.label)}</td><td>${esc(lotCode(s.tab))} <small>${esc(wineOf(s.tab))}</small></td><td>${esc(s.ubi || '')}</td><td>${s.row ? 'fila ' + esc(s.row) : ''}</td></tr>`).join('')}</tbody></table></details>` : ''}
          ${x.pending && E.labsOn ? `<button type="button" class="btn sm" data-readlab="${esc(x.f.id)}">Leer con Claude y guardar</button>` : ''}
        </div></article>`;
    };
    const h = `<section class="en-reports"><div class="en-rh"><h3>Reportes de laboratorio <small>${all.length}</small></h3><button type="button" class="btn primary" data-labup>Subir lab</button></div>` +
      (!E.labsOn ? `<p class="en-hint">Subida de laboratorio aún no activada.</p>` : !all.length ? `<p class="en-hint">Todavía no hay reportes. Sube el PDF de Uva y Vino y Claude lo separa por muestra.</p>` :
        `<div class="rp-bar"><input type="search" class="rp-q" placeholder="Buscar lote o muestra: L11, chenin, BBL 115…" value="${esc(RP.q)}" aria-label="Buscar en reportes">${labsList.length > 1 ? `<div class="seg rp-labs">${[['', 'Todos']].concat(labsList.map(l => [l, l])).map(([k, l]) => `<button type="button" data-rplab="${esc(k)}" aria-pressed="${RP.lab === k}">${esc(l)}</button>`).join('')}</div>` : ''}</div>` +
        (shown.length ? `<div class="rp-list">${shown.map(card).join('')}</div>` : `<p class="en-hint">Ningún reporte coincide.</p>`)) + `</section>`;
    if (el.__h !== h) { const foc = document.activeElement && document.activeElement.classList.contains('rp-q'); el.__h = h; el.innerHTML = h; if (foc) { const i = $('.rp-q', el); i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }
  }
  document.addEventListener('input', e => { if (e.target.classList && e.target.classList.contains('rp-q')) { RP.q = e.target.value; renderReports(); } });
  document.addEventListener('click', e => { const b = e.target.closest('[data-rplab]'); if (b) { RP.lab = b.dataset.rplab; renderReports(); } });

  // ---------- lot page: lab history + recent notes ----------
  function spark(points) {
    if (points.length < 2) return '';
    const xs = points.map(p => Date.parse(p[0])), ys = points.map(p => p[1]), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const W = 90, H = 24, px = x => x1 === x0 ? W / 2 : 2 + (x - x0) / (x1 - x0) * (W - 4), py = y => y1 === y0 ? H / 2 : H - 3 - (y - y0) / (y1 - y0) * (H - 6);
    return `<svg class="en-spark" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true"><polyline fill="none" stroke="currentColor" stroke-width="1.6" points="${points.map(p => px(Date.parse(p[0])) + ',' + py(p[1])).join(' ')}"/><circle r="2.2" fill="currentColor" cx="${px(xs[xs.length - 1])}" cy="${py(ys[ys.length - 1])}"/></svg>`;
  }
  async function fillLot(el) {
    const tabs = (el.dataset.tabs || '').split('|').filter(Boolean); if (!tabs.length) { el.innerHTML = ''; return; }
    await load().catch(() => {});
    const [d, ents] = await Promise.all([labs(), entries()]);
    const recs = (d.labs || []).filter(x => tabs.includes(x.tab)).sort((a, b) => String(b.report_date || b.at).localeCompare(String(a.report_date || a.at)));
    const notes = ents.filter(r => tabs.includes(r.tab) && r.kind !== 'lab').slice(0, 8);
    const reps = (d.files || []).map(f => Object.assign({ f }, reportInfo(f, d.labs || []))).filter(x => x.samples.some(s => tabs.includes(s.tab))).sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const repHtml = reps.length ? `<div class="rp-mini"><small>Reportes:</small> ${reps.map(x => `<a href="/api/labs/file?h=${esc(x.f.id)}" target="_blank" rel="noopener" title="${esc(x.samples.filter(s => tabs.includes(s.tab)).map(s => s.label).join(' · '))}">${PDF_ICO}${esc(x.lab)} ${esc(dm(x.date))}</a>`).join('')}</div>` : '';
    const keys = E.params.map(p => p.k).filter(k => recs.some(r => r.values && r.values[k] != null));
    let h = repHtml ? `<h3>Laboratorio</h3>${repHtml}` : '';
    if (recs.length) {
      const trend = ['aa', 'am', 'sl'].map(k => { const pts = recs.filter(r => r.values && r.values[k] != null && !isNaN(parseFloat(r.values[k]))).map(r => [r.report_date || r.sampled || r.at.slice(0, 10), parseFloat(r.values[k])]).reverse(); return pts.length > 1 ? `<span class="en-tr"><small>${esc(label(k))}</small>${spark(pts)}<b>${esc(pts[pts.length - 1][1])}</b></span>` : ''; }).join('');
      h += `<h3>Historial de laboratorio</h3>${trend ? `<div class="en-trends">${trend}</div>` : ''}<div class="en-tw"><table class="en-hist"><thead><tr><th>Fecha</th><th>Vasija</th>${keys.map(k => `<th>${esc(label(k))}</th>`).join('')}<th>Otros</th><th></th></tr></thead><tbody>` +
        recs.map(r => `<tr><td>${esc(dm(r.report_date || r.sampled || String(r.at).slice(0, 10)))}<small>${esc(r.lab || '')}</small></td><td>${esc(r.ubi || r.label)}</td>${keys.map(k => `<td>${esc(r.values && r.values[k] != null ? r.values[k] : '')}</td>`).join('')}<td>${esc((r.extras || []).map(o => o.name + ' ' + o.value).join('; '))}</td><td><a href="/api/labs/file?h=${esc(r.hash)}" target="_blank" rel="noopener">PDF</a></td></tr>`).join('') + `</tbody></table></div>`;
    }
    if (notes.length) h += `<h3>Notas y resultados recientes</h3><ul class="en-notes">${notes.map(r => `<li><b>${esc(dm(r.date))} · ${esc(r.signer)}</b>${r.ubi ? ' · ' + esc(r.ubi) : ''}${r.order ? ' · orden fila ' + esc(r.order.row) : ''}<br>${esc([r.note, valLine(r)].filter(Boolean).join(' · '))}</li>`).join('')}</ul>`;
    if (el.__h !== h) { el.__h = h; el.innerHTML = h; }
  }
  function refreshLotPanels() { E.labsAt = 0; E.entriesAt = 0; $$('[data-lotlabs]').forEach(fillLot); }
  const drawer = document.getElementById('drawerBody');
  if (drawer) new MutationObserver(() => $$('[data-lotlabs]', drawer).forEach(el => { if (!el.__filled) { el.__filled = true; fillLot(el); } })).observe(drawer, { childList: true, subtree: true });
  const labsView = document.getElementById('labsView');
  if (labsView) new MutationObserver(() => { if (!labsView.hidden) renderReports(); }).observe(labsView, { attributes: true, attributeFilter: ['hidden'] });
  if (labsView && !labsView.hidden) renderReports();

  // ---------- entry points ----------
  window.addEventListener('cellar:results', e => openForm({ order: e.detail.order }));
  window.addEventListener('cellar:note', e => openForm({ lot: (e.detail && e.detail.lot) || '' }));
  window.addEventListener('cellar:lab', () => openLab());
  document.addEventListener('click', e => {
    const n = e.target.closest('[data-addnote]'); if (n) { openForm({ lot: n.dataset.addnote }); return; }
    if (e.target.closest('[data-labup]')) { openLab(); return; }
    const r = e.target.closest('#labReports [data-readlab]'); if (r) openLab({ hash: r.dataset.readlab });
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { if ($('#enSheet') && !$('#enSheet').hidden) closeForm(); if ($('#labSheet') && !$('#labSheet').hidden) closeLab(); } });
  load().catch(() => {});
})();
