// Mobile behaviour for the Cellar Target Calendar (phones). Pairs with mobile.css.
// Adds an app bar, SVG icons in the bottom nav, a search toggle, card actions on Today,
// a back button for protocols, and hides the nav while a sheet or the wine card is open.
(function () {
  const I = {
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/></svg>',
    sync: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 1-15.5 6.2M3 12a9 9 0 0 1 15.5-6.2"/><path d="M21 4v5h-5M3 20v-5h5"/></svg>',
    gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
    menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
    plusBig: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    more: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>',
    cart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2 3h3l2.7 12.4a2 2 0 0 0 2 1.6h8.8a2 2 0 0 0 2-1.6L22 7H6"/></svg>',
    // bottom nav
    today: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4M9 15l2 2 4-4"/></svg>',
    wines: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3h8l1 6a5 5 0 0 1-10 0z"/><path d="M12 14v6M8 21h8"/><path d="M7.4 9h9.2" opacity=".5"/></svg>',
    labs: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3h6M10 3v6l-5.5 9A2 2 0 0 0 6.2 21h11.6a2 2 0 0 0 1.7-3L14 9V3"/><path d="M7.5 15h9" opacity=".6"/></svg>',
    protocols: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1M9 10h6M9 14h6M9 18h4"/></svg>',
    trials: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3v7l-4 8a2 2 0 0 0 1.8 3h5.4A2 2 0 0 0 12 18l-4-8V3"/><path d="M5 3h5"/><path d="M16 3v6l3 6a2 2 0 0 1-1.8 3h-2.4" opacity=".7"/><path d="M14 3h4" opacity=".7"/></svg>',
  };
  const $ = s => document.querySelector(s);
  const mq = window.matchMedia('(max-width: 760px), (pointer: coarse) and (max-height: 540px)');
  // Phone ↔ desktop switch (rotating a phone or tablet): the phone layer rearranges the page, so reload to rebuild cleanly.
  // iPad/iPhone Chrome doesn't always fire the media-query change (or restores the page from the back/forward
  // cache, or settles the viewport after load), so also re-check on resize, rotation, return to the tab and shortly after load.
  const startPhone = mq.matches;
  let reloading = false;
  const recheck = () => { if (!reloading && mq.matches !== startPhone) { reloading = true; setTimeout(() => location.reload(), 150); } };
  mq.addEventListener('change', recheck);
  ['resize', 'orientationchange', 'pageshow', 'focus'].forEach(ev => window.addEventListener(ev, recheck));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) recheck(); });
  [400, 1200, 3000].forEach(ms => setTimeout(recheck, ms));
  if (!mq.matches) return; // desktop / tablet: leave the page as it is
  const TITLES = { weeks: 'Calendar', wines: 'Wines', labs: 'Labs', protocols: 'Protocols', blends: 'Trials', learn: 'Learn', audit: 'Audit', 'vy-season': 'Season', 'vy-harvest': 'Harvest', 'vy-prune': 'Pruning', 'vy-blocks': 'Blocks', 'vy-treat': 'Treatments' };
  const SEARCH = { protocols: '.pl-q' }; // Wines and Trials have their own search + Filtros bar (below)
  const html = document.documentElement;

  // ---- App bar ----
  const bar = document.createElement('header');
  bar.className = 'mbar';
  bar.innerHTML = `<h1 id="mbarTitle">Today</h1>
    <button type="button" class="ib q" data-m="search" aria-label="Search" aria-pressed="false">${I.search}</button>
    <button type="button" class="ib more" data-m="more" aria-label="Menú" aria-haspopup="menu">${I.menu}<b class="m-badge" hidden></b></button>`;
  // Secondary actions live in the ☰ menu; + (new work order) sits in the middle of the bottom nav.
  const mm = document.createElement('div'); mm.className = 'm-vmenu m-more-menu'; mm.hidden = true;
  mm.innerHTML = `<button type="button" data-mm="sync">${I.sync}<span>Sincronizar con Excellovint</span></button><a href="/purchases">${I.cart}<span>Compras</span><b class="m-badge in" hidden></b></a><a href="/settings">${I.gear}<span>Ajustes</span></a>`;
  document.body.appendChild(mm);
  mm.addEventListener('click', e => { const b = e.target.closest('[data-mm]'); if (!b) return; mm.hidden = true; const sb = $('#syncBtn'); if (sb) sb.click(); });
  document.addEventListener('click', e => { if (!mm.hidden && !e.target.closest('.m-more-menu, [data-m="more"]')) mm.hidden = true; }, true);
  const page = document.querySelector('.page') || document.body;
  page.insertBefore(bar, page.firstChild);
  if (!mq.matches) bar.style.display = 'none';
  mq.addEventListener('change', e => { bar.style.display = e.matches ? '' : 'none'; });
  // Badge on the cart: number of high-priority purchases still open.
  fetch('/api/db/purchases').then(r => r.ok ? r.json() : { rows: [] }).then(j => {
    const n = (j.rows || []).filter(r => (r.data.status || 'open') === 'open' && r.data.pri === 'high').length;
    if (n) document.querySelectorAll('.mbar .m-badge, .m-more-menu .m-badge').forEach(b => { b.textContent = n > 9 ? '9+' : n; b.hidden = false; });
  }).catch(() => {});

  let view = 'weeks';
  function currentView() {
    const cur = document.querySelector('.mnav button[aria-current="page"]');
    if (cur && cur.dataset.mtoday) return 'weeks';
    const vt = document.querySelector('.vynav [data-view][aria-selected="true"]');
    if (vt && (vt.dataset.view === 'labs' || vt.dataset.view === 'blends')) return vt.dataset.view;
    if (cur && cur.dataset.view) return cur.dataset.view;
    const t = document.querySelector('.vynav [role="tab"][aria-selected="true"]');
    return t && t.dataset.view ? t.dataset.view : view;
  }
  function syncBar() {
    view = currentView();
    const asgOn = view === 'weeks' && html.classList.contains('v-asg');
    if (asgOn) dayTitle();
    else if (view === 'weeks') weekTitle();
    else if (view === 'labs' || view === 'blends') $('#mbarTitle').innerHTML = `<span class="m-seg" role="group"><button type="button" data-mseg="labs" aria-pressed="${view === 'labs'}">Labs</button><button type="button" data-mseg="blends" aria-pressed="${view === 'blends'}">Trials</button></span>`;
    else $('#mbarTitle').textContent = TITLES[view] || 'Cellar';
    bar.classList.toggle('m-daybar', view === 'weeks');
    const q = bar.querySelector('[data-m="search"]');
    q.hidden = !SEARCH[view];
    if (!SEARCH[view]) { html.classList.remove('m-q'); q.setAttribute('aria-pressed', 'false'); }
    if (view !== 'protocols') html.classList.remove('m-doc');
  }
  // Today: the date lives in the app bar title as ‹ Hoy ›, driven by the page's own day buttons (.asg-day, hidden on phones).
  function dayTitle() {
    const lbl = document.querySelector('#asgView .ad-lbl'), next = document.querySelector('#asgView [data-asgday="1"]');
    const txt = lbl ? (lbl.firstChild ? lbl.firstChild.textContent : lbl.textContent).trim() : 'Hoy';
    $('#mbarTitle').innerHTML = `<button type="button" class="m-day" data-mday="-1" aria-label="Anterior">${I.back}</button><button type="button" class="m-dlbl" aria-haspopup="menu">${txt}<i aria-hidden="true">▾</i></button><button type="button" class="m-day nx" data-mday="1" aria-label="Día siguiente"${next && next.disabled ? ' disabled' : ''}>${I.back}</button>`;
  }
  // Week (plan) view: ‹ 26 Oct – 1 Nov ▾ › in the bar, driving the page's own week arrows.
  function weekTitle() {
    const bd = $('#board'), lbl = (bd && bd.dataset.ppLabel) || 'Semana';
    $('#mbarTitle').innerHTML = `<button type="button" class="m-day" data-mwk="-1" aria-label="Semana anterior">${I.back}</button><button type="button" class="m-dlbl m-wlbl" aria-haspopup="menu">${lbl}<i aria-hidden="true">▾</i></button><button type="button" class="m-day nx" data-mwk="1" aria-label="Semana siguiente">${I.back}</button>`;
  }
  window.addEventListener('cellar:planrendered', () => { if (currentView() === 'weeks' && !html.classList.contains('v-asg')) weekTitle(); });
  // Date menu: Día · Semana · Ir a hoy
  const vm = document.createElement('div'); vm.className = 'm-vmenu'; vm.hidden = true;
  vm.innerHTML = '<button type="button" data-vm="day">Órdenes asignadas<small>por día · ‹ › para días anteriores</small></button><button type="button" data-vm="plan">Plan semanal<small>por vino · ‹ › para otras semanas</small></button><button type="button" data-vm="today">Ir a hoy</button>';
  document.body.appendChild(vm);
  function openViewMenu() { vm.hidden = false; const plan = !html.classList.contains('v-asg'), wk = !!document.querySelector('#asgView .wk-day'); vm.querySelectorAll('[data-vm]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.vm === (plan ? 'plan' : 'day')))); }
  vm.addEventListener('click', e => { const b = e.target.closest('[data-vm]'); vm.hidden = true; if (!b) return; if (b.dataset.vm === 'plan') window.dispatchEvent(new CustomEvent('cellar:plan')); else window.dispatchEvent(new CustomEvent('cellar:asgmode', { detail: { mode: b.dataset.vm } })); setTimeout(syncBar, 0); });
  document.addEventListener('click', e => { if (!vm.hidden && !e.target.closest('.m-vmenu, .m-dlbl')) vm.hidden = true; }, true);
  bar.addEventListener('click', e => {
    const d = e.target.closest('[data-mday]');
    if (d) { const b = document.querySelector(`#asgView [data-asgday="${d.dataset.mday}"]`); if (b && !b.disabled) b.click(); return; }
    const wk = e.target.closest('[data-mwk]');
    if (wk) { const b = document.querySelector(`#board [data-pp="${wk.dataset.mwk}"]`); if (b) b.click(); return; }
    if (e.target.closest('.m-dlbl')) { openViewMenu(); return; }
    const sg = e.target.closest('[data-mseg]');
    if (sg) { const t = document.querySelector(`.mnav [data-view="${sg.dataset.mseg}"]`); if (t) t.click(); setTimeout(syncBar, 0); return; }
    const b = e.target.closest('[data-m]'); if (!b) return;
    const a = b.dataset.m;
    if (a === 'add') { const n = $('#newWoBtn'); if (n) n.click(); }
    if (a === 'more') { mm.hidden = !mm.hidden; return; }
    if (a === 'sync') { const s = $('#syncBtn'); if (s) s.click(); b.classList.add('spin'); setTimeout(() => b.classList.remove('spin'), 2500); }
    if (a === 'search') {
      const on = html.classList.toggle('m-q'); b.setAttribute('aria-pressed', String(on));
      if (on) { const inp = document.querySelector(SEARCH[view] || '#q'); if (inp) setTimeout(() => inp.focus(), 30); }
      else { const inp = document.querySelector(SEARCH[view] || '#q'); if (inp && inp.value) { inp.value = ''; inp.dispatchEvent(new Event('input', { bubbles: true })); } }
    }
  });

  // ---- Bottom nav icons ----
  function navIcons() {
    document.querySelectorAll('.mnav button').forEach(b => {
      if (b.querySelector('.mi')) return;
      const key = b.dataset.mtoday ? 'today' : b.dataset.view === 'blends' ? 'trials' : b.dataset.view;
      const span = b.querySelector('span');
      const mi = document.createElement('span'); mi.className = 'mi'; mi.setAttribute('aria-hidden', 'true'); mi.innerHTML = I[key] || I.protocols;
      if (span) span.replaceWith(mi); else b.insertBefore(mi, b.firstChild);
    });
  }
  navIcons();
  const nav = $('#mnav');
  if (nav) {
    const tr = nav.querySelector('[data-view="blends"]'); if (tr) tr.classList.add('m-hide');
    const lb = nav.querySelector('[data-view="labs"]');
    if (lb) { const mi = lb.querySelector('.mi'); if (mi) mi.innerHTML = I.trials; lb.lastChild.textContent = 'L + T'; lb.setAttribute('aria-label', 'Labs y trials'); }
    const add = document.createElement('button'); add.type = 'button'; add.className = 'm-add'; add.setAttribute('aria-label', 'Nueva orden de trabajo');
    add.innerHTML = `<span class="m-add-c">${I.plusBig}</span>`;
    add.addEventListener('click', () => { const n = $('#newWoBtn'); if (n) n.click(); });
    if (lb) nav.insertBefore(add, lb); else nav.appendChild(add);
  }
  if (nav) new MutationObserver(syncBar).observe(nav, { attributes: true, subtree: true, attributeFilter: ['aria-current'] });
  document.querySelectorAll('.vynav [role="tab"]').forEach(t => t.addEventListener('click', () => setTimeout(syncBar, 0)));
  syncBar();

  // ---- Today: card actions (✓ Done, ⋯ more) ----
  function decorateAsg() {
    if (!mq.matches) return; // a tablet that turned wide: the page reloads into the desktop layout
    document.querySelectorAll('#asgView .asg-row:not(.asg-head):not(.m-dec)').forEach(row => {
      row.classList.add('m-dec');
      const pri = row.querySelector('select.asg-pri'), asig = row.querySelector('.asg-who'), st = row.querySelector('select.asg-st');
      const p = pri ? pri.value : '';
      if (p === 'URGENT') row.classList.add('m-urgent'); else if (p === 'HIGH') row.classList.add('m-high');
      // Date → calendar tile (month band, big day, weekday or days overdue).
      const dateEl = row.querySelector('.asg-date');
      const dm = dateEl && /^([A-Za-z]{3})\w*\s+(\d{1,2})$/.exec(dateEl.textContent.trim());
      if (dm) {
        const MON = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
        const ES = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];
        const DOW = ['DOM', 'LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB'];
        const mi = MON.indexOf(dm[1].toLowerCase()), day = +dm[2];
        const now = new Date(); now.setHours(0, 0, 0, 0);
        let d = new Date(now.getFullYear(), mi, day);
        if (d - now > 60 * 864e5) d = new Date(now.getFullYear() - 1, mi, day);
        const diff = Math.round((now - d) / 864e5);
        const late = diff > 0 && row.classList.contains('is-over');
        const st = late ? (diff === 1 ? 'Atrasada · ayer' : 'Atrasada ' + diff + ' días') : diff === 0 ? 'Hoy' : diff === -1 ? 'Mañana' : DOW[d.getDay()].charAt(0) + DOW[d.getDay()].slice(1).toLowerCase();
        dateEl.innerHTML = `<span class="m-pri-slot"></span><span class="m-due${late ? ' late' : diff === 0 ? ' today' : ''}">${st}</span><span class="m-dd">${day} ${(mi >= 0 ? ES[mi] : dm[1]).toLowerCase()}</span>`;
      }
      // Controls always visible: Prioridad · Asignado · Estado in one row (the selects are the page's own, so changes save as before).
      const ctl = document.createElement('div'); ctl.className = 'm-ctl';
      const wrap = (sel, label) => { if (!sel) return; const l = document.createElement('label'); l.textContent = label; l.appendChild(sel); ctl.appendChild(l); };
      wrap(pri, 'Prioridad'); wrap(asig, 'Asignado'); wrap(st, 'Estado');
      row.appendChild(ctl);
      if (pri) pri.addEventListener('change', () => { row.classList.toggle('m-urgent', pri.value === 'URGENT'); row.classList.toggle('m-high', pri.value === 'HIGH'); });
      // Notes: grow with content while typing.
      const ta = row.querySelector('.asg-txt');
      if (ta) ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; });
    });
  }
  const asg = $('#asgView');
  if (asg) {
    new MutationObserver(() => { decorateAsg(); if (bar.classList.contains('m-daybar') && html.classList.contains('v-asg')) dayTitle(); }).observe(asg, { childList: true }); decorateAsg();
    // Swipe right = previous day, swipe left = next day (vertical scrolling unaffected).
    let sx = null, sy = null;
    asg.addEventListener('touchstart', e => { if (e.target.closest('select, textarea, input, button')) { sx = null; return; } sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
    asg.addEventListener('touchend', e => { if (sx == null) return; const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy; sx = null; if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.6) { const b = asg.querySelector(`[data-asgday="${dx > 0 ? -1 : 1}"]`); if (b && !b.disabled) b.click(); } }, { passive: true });
  }

  // ---- Protocols: list → document, with a back button ----
  function decorateProto() {
    const main = document.querySelector('#proto .pmain');
    if (main && !main.querySelector('.m-back')) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'm-back'; b.innerHTML = I.back + 'Protocols';
      b.addEventListener('click', () => { html.classList.remove('m-doc'); window.scrollTo(0, 0); });
      main.insertBefore(b, main.firstChild);
    }
  }
  const proto = $('#proto');
  if (proto) {
    new MutationObserver(decorateProto).observe(proto, { childList: true });
    proto.addEventListener('click', e => {
      if (!mq.matches) return;
      const b = e.target.closest('[data-proto]'); if (!b) return;
      html.classList.add('m-doc'); setTimeout(() => { decorateProto(); window.scrollTo(0, 0); }, 0);
    });
  }

  // ---- Hide the nav while a sheet or the wine card is open ----

  // ---- Filter bar (phones): search + "Filtros" button with a count + removable chips; every option lives in one bottom sheet. ----
  if (mq.matches) (function () {
    const FI = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M7 12h10M10 18h4"/></svg>';
    const sheet = document.createElement('div'); sheet.className = 'mf-ov'; sheet.hidden = true;
    sheet.innerHTML = '<div class="mf-sheet" role="dialog" aria-label="Filtros"><div class="mf-head"><b>Filtros</b><button type="button" class="mf-reset">Quitar todos</button></div><div class="mf-body"></div><div class="mf-foot"><button type="button" class="mf-done">Listo</button></div></div>';
    document.body.appendChild(sheet);
    const body = sheet.querySelector('.mf-body');
    let cur = null;
    const close = () => { sheet.hidden = true; html.classList.remove('m-modal'); };
    sheet.addEventListener('click', e => { if (e.target === sheet || e.target.closest('.mf-done')) close(); if (e.target.closest('.mf-reset') && cur) { cur.reset(); refreshAll(); } });
    const views = [];
    function make(cfg) {
      // cfg: { anchor (insert bar before), search (input), sections: [[title, el]], chips() -> [{label, clear}], reset() }
      if (!cfg.anchor || !cfg.search) return;
      const bar = document.createElement('div'); bar.className = 'mf-bar';
      bar.innerHTML = `<div class="mf-search">${I.search}</div><button type="button" class="mf-btn">${FI}<span>Filtros</span><b class="mf-n" hidden></b></button>`;
      bar.querySelector('.mf-search').appendChild(cfg.search);
      const chips = document.createElement('div'); chips.className = 'mf-chips';
      cfg.anchor.parentNode.insertBefore(bar, cfg.anchor); bar.after(chips);
      const panel = document.createElement('div'); panel.className = 'mf-panel'; panel.hidden = true;
      for (const [t, el] of cfg.sections) { if (!el) continue; const sec = document.createElement('section'); sec.innerHTML = `<h4>${t}</h4>`; sec.appendChild(el); panel.appendChild(sec); }
      body.appendChild(panel);
      const v = Object.assign({ bar, chips, panel }, cfg);
      v.refresh = () => {
        const list = cfg.chips();
        chips.innerHTML = list.map((c, i) => `<button type="button" class="mf-chip" data-i="${i}">${c.label}<span aria-hidden="true">×</span></button>`).join('');
        chips.hidden = !list.length;
        const n = bar.querySelector('.mf-n'); n.textContent = list.length; n.hidden = !list.length;
        chips._list = list;
      };
      chips.addEventListener('click', e => { const b = e.target.closest('.mf-chip'); if (b) { chips._list[+b.dataset.i].clear(); setTimeout(refreshAll, 30); } });
      bar.querySelector('.mf-btn').addEventListener('click', () => { cur = v; body.querySelectorAll('.mf-panel').forEach(p => p.hidden = p !== panel); sheet.hidden = false; html.classList.add('m-modal'); });
      new MutationObserver(() => setTimeout(v.refresh, 0)).observe(panel, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-pressed'] });
      panel.addEventListener('change', () => setTimeout(v.refresh, 0));
      views.push(v); v.refresh();
    }
    function refreshAll() { views.forEach(v => v.refresh()); }
    const txt = el => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
    const press = sel => { const b = document.querySelector(sel); if (b) b.click(); };

    // Wines
    const sortLbl = document.querySelector('#wineCtl .sortsel');
    make({
      anchor: document.getElementById('stats'), search: document.getElementById('q'),
      sections: [['Tipo de vino', document.getElementById('groups')], ['Mostrar solo', document.getElementById('stats')], ['Ordenar', sortLbl]],
      chips: () => {
        const out = [];
        document.querySelectorAll('#groups [aria-pressed="true"]').forEach(g => { if (g.dataset.group && g.dataset.group !== 'all') out.push({ label: txt(g), clear: () => g.click() }); });
        document.querySelectorAll('#stats [aria-pressed="true"]').forEach(q => out.push({ label: txt(q).replace(/^\d+\s*/, ''), clear: () => q.click() }));
        const so = document.getElementById('sortSel'); if (so && so.selectedIndex > 0) out.push({ label: 'Orden: ' + txt(so.options[so.selectedIndex]), clear: () => { so.selectedIndex = 0; so.dispatchEvent(new Event('change', { bubbles: true })); } });
        return out;
      },
      reset() { press('#groups [data-group="all"]'); document.querySelectorAll('#stats [aria-pressed="true"]').forEach(q => q.click()); const so = document.getElementById('sortSel'); if (so && so.selectedIndex > 0) { so.selectedIndex = 0; so.dispatchEvent(new Event('change', { bubbles: true })); } }
    });
    // Trials
    const blf = document.querySelector('.bl-filter');
    if (blf) {
      const segs = blf.querySelectorAll('.seg');
      const holder = document.createElement('div'); holder.className = 'bl-filter mf-blf'; // keeps the page's own click handler (it listens on .bl-filter)
      blf.parentNode.insertBefore(holder, blf);
      make({
        anchor: blf, search: document.getElementById('blSearch'),
        sections: [['Tipo de prueba', segs[0]], ['Vino', segs[1]], ['Estado', document.getElementById('blStatus')]],
        chips: () => {
          const out = [];
          document.querySelectorAll('[data-blk][aria-pressed="true"]').forEach(k => { if (k.dataset.blk) out.push({ label: txt(k), clear: () => k.click() }); });
          document.querySelectorAll('[data-blg][aria-pressed="true"]').forEach(g => { if (g.dataset.blg) out.push({ label: txt(g), clear: () => g.click() }); });
          const st = document.getElementById('blStatus'); if (st && st.value) out.push({ label: txt(st.options[st.selectedIndex]), clear: () => { st.value = ''; st.dispatchEvent(new Event('change', { bubbles: true })); } });
          return out;
        },
        reset() { press('[data-blk=""]'); press('[data-blg=""]'); const st = document.getElementById('blStatus'); if (st && st.value) { st.value = ''; st.dispatchEvent(new Event('change', { bubbles: true })); } }
      });
      // The moved chip rows must still reach the page's .bl-filter click handler: forward clicks.
      const v = views[views.length - 1];
      v.panel.addEventListener('click', e => { const b = e.target.closest('[data-blk],[data-blg]'); if (b) { e.stopPropagation(); const ev = new MouseEvent('click', { bubbles: true }); blf.dispatchEvent(Object.defineProperty(ev, 'target', { value: b })); } });
      blf.classList.add('mf-left'); holder.remove();
    }
  })();
  const modals = ['editor', 'xoSheet', 'woSheet', 'copySheet', 'tempSheet', 'crewSheet', 'drawer', 'diagSheet'].map(id => document.getElementById(id)).filter(Boolean);
  const checkModal = () => html.classList.toggle('m-modal', modals.some(m => !m.hidden));
  modals.forEach(m => new MutationObserver(checkModal).observe(m, { attributes: true, attributeFilter: ['hidden'] }));
  checkModal();
})();
