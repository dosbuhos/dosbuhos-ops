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
    cart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2 3h3l2.7 12.4a2 2 0 0 0 2 1.6h8.8a2 2 0 0 0 2-1.6L22 7H6"/></svg>',
    // bottom nav
    today: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4M9 15l2 2 4-4"/></svg>',
    wines: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3h8l1 6a5 5 0 0 1-10 0z"/><path d="M12 14v6M8 21h8"/><path d="M7.4 9h9.2" opacity=".5"/></svg>',
    labs: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3h6M10 3v6l-5.5 9A2 2 0 0 0 6.2 21h11.6a2 2 0 0 0 1.7-3L14 9V3"/><path d="M7.5 15h9" opacity=".6"/></svg>',
    protocols: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1M9 10h6M9 14h6M9 18h4"/></svg>',
    trials: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3v7l-4 8a2 2 0 0 0 1.8 3h5.4A2 2 0 0 0 12 18l-4-8V3"/><path d="M5 3h5"/><path d="M16 3v6l3 6a2 2 0 0 1-1.8 3h-2.4" opacity=".7"/><path d="M14 3h4" opacity=".7"/></svg>',
  };
  const $ = s => document.querySelector(s);
  const mq = window.matchMedia('(max-width: 760px)');
  const TITLES = { weeks: 'Today', wines: 'Wines', labs: 'Labs', protocols: 'Protocols', blends: 'Trials', learn: 'Learn', audit: 'Audit', 'vy-season': 'Season', 'vy-harvest': 'Harvest', 'vy-prune': 'Pruning', 'vy-blocks': 'Blocks', 'vy-treat': 'Treatments' };
  const SEARCH = { wines: '#q', protocols: '.pl-q', blends: '#blSearch' };
  const html = document.documentElement;

  // ---- App bar ----
  const bar = document.createElement('header');
  bar.className = 'mbar';
  bar.innerHTML = `<h1 id="mbarTitle">Today</h1>
    <button type="button" class="ib q" data-m="search" aria-label="Search" aria-pressed="false">${I.search}</button>
    <button type="button" class="ib add" data-m="add" aria-label="New work order">${I.plus}</button>
    <button type="button" class="ib" data-m="sync" aria-label="Sync with Excellovint">${I.sync}</button>
    <a class="ib cart" href="/purchases" aria-label="Compras (purchases list)">${I.cart}<b class="m-badge" hidden></b></a>
    <a class="ib" href="/settings" aria-label="Settings">${I.gear}</a>`;
  const page = document.querySelector('.page') || document.body;
  page.insertBefore(bar, page.firstChild);
  if (!mq.matches) bar.style.display = 'none';
  mq.addEventListener('change', e => { bar.style.display = e.matches ? '' : 'none'; });
  // Badge on the cart: number of high-priority purchases still open.
  fetch('/api/db/purchases').then(r => r.ok ? r.json() : { rows: [] }).then(j => {
    const n = (j.rows || []).filter(r => (r.data.status || 'open') === 'open' && r.data.pri === 'high').length;
    const b = bar.querySelector('.m-badge'); if (b && n) { b.textContent = n > 9 ? '9+' : n; b.hidden = false; }
  }).catch(() => {});

  let view = 'weeks';
  function currentView() {
    const cur = document.querySelector('.mnav button[aria-current="page"]');
    if (cur && cur.dataset.mtoday) return 'weeks';
    if (cur && cur.dataset.view) return cur.dataset.view;
    const t = document.querySelector('.vynav [role="tab"][aria-selected="true"]');
    return t && t.dataset.view ? t.dataset.view : view;
  }
  function syncBar() {
    view = currentView();
    $('#mbarTitle').textContent = TITLES[view] || 'Cellar';
    const q = bar.querySelector('[data-m="search"]');
    q.hidden = !SEARCH[view];
    if (!SEARCH[view]) { html.classList.remove('m-q'); q.setAttribute('aria-pressed', 'false'); }
    if (view !== 'protocols') html.classList.remove('m-doc');
  }
  bar.addEventListener('click', e => {
    const b = e.target.closest('[data-m]'); if (!b) return;
    const a = b.dataset.m;
    if (a === 'add') { const n = $('#newWoBtn'); if (n) n.click(); }
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
  if (nav) new MutationObserver(syncBar).observe(nav, { attributes: true, subtree: true, attributeFilter: ['aria-current'] });
  document.querySelectorAll('.vynav [role="tab"]').forEach(t => t.addEventListener('click', () => setTimeout(syncBar, 0)));
  syncBar();

  // ---- Today: card actions (✓ Done, ⋯ more) ----
  function decorateAsg() {
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
        const sub = diff > 0 && row.classList.contains('is-over') ? (diff === 1 ? 'AYER' : 'HACE ' + diff + ' D') : diff === 0 ? 'HOY' : DOW[d.getDay()];
        dateEl.innerHTML = `<small>${mi >= 0 ? ES[mi] : dm[1].toUpperCase()}</small><b>${day}</b><i>${sub}</i>`;
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
  if (asg) { new MutationObserver(decorateAsg).observe(asg, { childList: true }); decorateAsg(); }

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
  const modals = ['editor', 'xoSheet', 'woSheet', 'copySheet', 'tempSheet', 'crewSheet', 'drawer', 'diagSheet'].map(id => document.getElementById(id)).filter(Boolean);
  const checkModal = () => html.classList.toggle('m-modal', modals.some(m => !m.hidden));
  modals.forEach(m => new MutationObserver(checkModal).observe(m, { attributes: true, attributeFilter: ['hidden'] }));
  checkModal();
})();
