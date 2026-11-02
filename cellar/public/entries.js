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
  const E = { params: [], labsOn: false, me: {}, lots: [], staff: [], ready: null, entries: null, entriesAt: 0, labs: null, labsAt: 0 };

  function toast(msg) {
    let t = $('#enToast'); if (!t) { t = document.createElement('div'); t.id = 'enToast'; t.className = 'en-toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.textContent = msg; t.hidden = false; clearTimeout(t._h); t._h = setTimeout(() => { t.hidden = true; }, 3800);
  }
  function load() {
    if (E.ready) return E.ready;
    E.ready = Promise.all([
      api('/api/params').then(j => { E.params = j.params || []; E.labsOn = !!j.labs; }),
      api('/api/me').then(j => { E.me = j || {}; }).catch(() => {}),
      api('/api/db/lots').then(j => { E.lots = (j.rows || []).map(r => Object.assign({ id: r.id }, r.data)); }).catch(() => {}),
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
      if (!s.tab) continue; const cur = m.get(s.tab);
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
    let ov = $('#enSheet');
    if (!ov) { ov = document.createElement('div'); ov.className = 'overlay en-ov'; ov.id = 'enSheet'; document.body.appendChild(ov); ov.addEventListener('click', e => { if (e.target === ov) closeForm(); }); }
    const core = E.params.filter(p => p.core), more = E.params.filter(p => !p.core);
    const pre = (E.me && E.me.initials) || '';
    ov.innerHTML = `<form class="sheet en-form" novalidate>
      <h2>${o ? 'Anotar resultados y notas' : 'Agregar nota'}</h2>
      ${o ? `<div class="xo-where"><b>${esc(o.wine || o.tab)}</b> · ${esc(o.tab)} · fila ${esc(o.row)}</div><div class="rs-task en-order">${esc(o.note)}</div>`
        : `<div class="field en-lotf"><label>Vino / lote <span class="ed-hint">obligatorio · lo de toda la bodega va en «Bodega (todos)»</span></label>${lotPicker(ctx.tab || tabOfLot(ctx.lot) || '')}</div>`}
      <div class="field"><label for="enUbi">Vasija(s) <span class="ed-hint">tanque, barrica… (si es por barrica, anota cuál)</span></label><input id="enUbi" value="${esc(o ? o.ubi || '' : '')}" placeholder="BBL 101, VC-05…" autocomplete="off"></div>
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
    });
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
    ov.innerHTML = `<div class="sheet en-lab"><h2>Subir lab</h2>
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
    ov.innerHTML = `<div class="sheet en-lab"><h2>Subir lab</h2><div class="en-reading"><span class="en-spin" aria-hidden="true"></span>Leyendo el reporte con Claude… (30–60 s)</div></div>`;
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
    ov.innerHTML = `<form class="sheet en-lab" novalidate><h2>Confirmar resultados</h2>
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
  async function renderReports() {
    const el = $('#labReports'); if (!el) return;
    await load().catch(() => {});
    const d = await labs();
    const files = (d.files || []).slice().sort((a, b) => String(b.at).localeCompare(String(a.at)));
    const h = `<section class="en-reports"><div class="en-rh"><h3>Reportes de laboratorio</h3><button type="button" class="btn primary" data-labup>Subir lab</button></div>` +
      (!E.labsOn ? `<p class="en-hint">Subida de laboratorio aún no activada.</p>` : !files.length ? `<p class="en-hint">Todavía no hay reportes. Sube el PDF de Uva y Vino y Claude lo separa por muestra.</p>` :
        `<ul class="en-files">${files.slice(0, 12).map(f => { const n = (d.labs || []).filter(x => x.hash === f.id).length; return `<li><a href="/api/labs/file?h=${esc(f.id)}" target="_blank" rel="noopener">${esc(f.name)}</a><small>${esc((f.extracted && f.extracted.lab) || '')} ${esc(dm((f.extracted && f.extracted.report_date) || String(f.at).slice(0, 10)))} · ${n} muestra${n === 1 ? '' : 's'} guardada${n === 1 ? '' : 's'} · ${esc(f.by || '')}</small>${n ? '' : ` <button type="button" class="btn sm" data-readlab="${esc(f.id)}">Leer y guardar</button>`}</li>`; }).join('')}</ul>`) + `</section>`;
    if (el.__h !== h) { el.__h = h; el.innerHTML = h; }
  }

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
    const keys = E.params.map(p => p.k).filter(k => recs.some(r => r.values && r.values[k] != null));
    let h = '';
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
