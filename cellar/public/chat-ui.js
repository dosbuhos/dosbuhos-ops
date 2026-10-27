// Chat button + panel: talk to Claude about the cellar; it can read and write Excellovint (see src/chat.js).
// Pattern: a messaging sheet. One running thread per signed-in person. Composer = one full-width pill with the
// mic inside; the mic becomes a send arrow once there is text. Dictation language is a small toggle in the header.
(function () {
  const css = `
  .cc-fab{position:fixed;right:18px;bottom:18px;z-index:9000;width:56px;height:56px;border-radius:50%;border:0;background:#5c1f33;color:#fff;box-shadow:0 6px 18px rgba(0,0,0,.25);cursor:pointer;display:flex;align-items:center;justify-content:center}
  .cc-fab svg{width:26px;height:26px}
  .cc-panel{position:fixed;right:18px;bottom:86px;z-index:9001;width:min(440px,calc(100vw - 24px));height:min(680px,calc(100vh - 110px));background:#f7f5f0;color:#1f2426;border:1px solid #d9d0c4;border-radius:18px;box-shadow:0 12px 40px rgba(0,0,0,.25);display:flex;flex-direction:column;overflow:hidden;font:15px/1.45 "IBM Plex Sans",-apple-system,"Segoe UI",Roboto,sans-serif}
  .cc-panel[hidden]{display:none}
  .cc-scrim{position:fixed;inset:0;z-index:9000;background:rgba(20,22,24,.35);display:none}
  /* header */
  .cc-head{display:flex;align-items:center;gap:8px;padding:10px 8px 10px 16px;background:#5c1f33;color:#fff;position:relative;flex:none}
  .cc-head b{flex:1;font-family:"Barlow Condensed","Arial Narrow",sans-serif;letter-spacing:.06em;font-size:19px;text-transform:uppercase;line-height:1}
  .cc-head b small{display:block;font:500 11px/1.2 "IBM Plex Sans",sans-serif;letter-spacing:0;text-transform:none;opacity:.8;margin-top:3px}
  .cc-ib{width:40px;height:40px;border:0;background:transparent;color:#fff;border-radius:12px;display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0;flex:none}
  .cc-ib svg{width:22px;height:22px}
  .cc-ib:active{background:rgba(255,255,255,.14)}
  .cc-lang{height:30px;padding:0 9px;border:1px solid rgba(255,255,255,.45);border-radius:999px;background:transparent;color:#fff;font:700 11.5px/1 "IBM Plex Mono",monospace;letter-spacing:.06em;cursor:pointer;flex:none;display:flex;align-items:center;gap:5px}
  .cc-lang svg{width:13px;height:13px;opacity:.9}
  .cc-grip{position:absolute;left:50%;top:6px;width:40px;height:4px;margin-left:-20px;border-radius:2px;background:rgba(255,255,255,.55);display:none}
  /* thread */
  .cc-log{flex:1;overflow:auto;padding:14px 14px 8px;display:flex;flex-direction:column;gap:8px;overscroll-behavior:contain;-webkit-overflow-scrolling:touch}
  .cc-m{max-width:86%;padding:9px 13px;border-radius:18px;word-wrap:break-word;font-size:15.5px;line-height:1.42}
  .cc-m p{margin:0 0 6px}.cc-m p:last-child{margin:0}
  .cc-m code{font:13px "IBM Plex Mono",monospace;background:rgba(0,0,0,.06);padding:0 4px;border-radius:4px}
  .cc-user{align-self:flex-end;background:#5c1f33;color:#fff;border-bottom-right-radius:6px}
  .cc-user code{background:rgba(255,255,255,.18)}
  .cc-assistant{align-self:flex-start;background:#fff;border:1px solid #e6e0d6;border-bottom-left-radius:6px}
  .cc-user+.cc-user,.cc-assistant+.cc-assistant{margin-top:-4px}
  .cc-act{align-self:flex-start;display:inline-flex;align-items:center;gap:6px;font:600 12.5px "IBM Plex Sans",sans-serif;color:#2f6b34;background:#e3f0e1;border-radius:999px;padding:5px 11px;text-decoration:none}
  a.cc-act{color:#5c1f33;background:#f2e5e8}
  .cc-typing{align-self:flex-start;display:flex;gap:4px;padding:12px 14px;background:#fff;border:1px solid #e6e0d6;border-radius:18px;border-bottom-left-radius:6px}
  .cc-typing i{width:7px;height:7px;border-radius:50%;background:#9aa0a6;animation:ccdot 1.2s infinite}
  .cc-typing i:nth-child(2){animation-delay:.2s}.cc-typing i:nth-child(3){animation-delay:.4s}
  @keyframes ccdot{0%,60%,100%{transform:translateY(0);opacity:.5}30%{transform:translateY(-4px);opacity:1}}
  .cc-day{align-self:center;font:600 11px "IBM Plex Mono",monospace;letter-spacing:.08em;text-transform:uppercase;color:#7a8084;margin:8px 0 2px}
  /* empty state */
  .cc-empty{margin:auto 0;display:flex;flex-direction:column;align-items:center;gap:14px;padding:12px 8px;text-align:center}
  .cc-empty p{margin:0;color:#5d6568;font-size:15px;max-width:30ch}
  .cc-sugg{display:flex;flex-wrap:wrap;gap:8px;justify-content:center}
  .cc-sugg button{border:1px solid #d9d0c4;background:#fff;color:#1f2426;border-radius:999px;padding:9px 14px;font:14px "IBM Plex Sans",sans-serif;cursor:pointer;text-align:left}
  .cc-sugg button:active{background:#f2e5e8}
  /* composer */
  .cc-in{flex:none;display:flex;align-items:flex-end;gap:8px;padding:8px 10px calc(10px + env(safe-area-inset-bottom,0px));background:#f7f5f0;border-top:1px solid #e6e0d6}
  .cc-pill{flex:1;display:flex;align-items:flex-end;min-height:46px;border:1px solid #d9d0c4;border-radius:23px;background:#fff;padding:4px 4px 4px 16px;min-width:0}
  .cc-pill:focus-within{border-color:#5c1f33;box-shadow:0 0 0 3px rgba(92,31,51,.12)}
  .cc-pill textarea{flex:1;min-width:0;border:0;outline:0;resize:none;background:transparent;font:16px/1.4 "IBM Plex Sans",sans-serif;color:#1f2426;padding:8px 0;max-height:132px}
  .cc-pill textarea::placeholder{color:#8a9094}
  .cc-mic,.cc-send{flex:none;width:38px;height:38px;border-radius:50%;border:0;display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0;margin:0 0 0 4px}
  .cc-mic{background:transparent;color:#5c1f33}
  .cc-mic svg,.cc-send svg{width:22px;height:22px}
  .cc-mic.on{background:#b3261e;color:#fff;animation:ccpulse 1.2s infinite}
  @keyframes ccpulse{50%{box-shadow:0 0 0 6px rgba(179,38,30,.18)}}
  .cc-send{background:#5c1f33;color:#fff}
  .cc-send:disabled{opacity:.45}
  .cc-in.has-text .cc-mic{display:none}
  .cc-in:not(.has-text) .cc-send{display:none}
  .cc-in.recording .cc-mic{display:flex}
  .cc-listen{position:absolute;left:0;right:0;bottom:100%;padding:6px 16px;background:#b3261e;color:#fff;font:600 13px "IBM Plex Sans",sans-serif;text-align:center;display:none}
  .cc-in.recording .cc-listen{display:block}
  .cc-inwrap{position:relative;flex:none}
  /* phones: a sheet from the bottom, nearly full height, draggable between half and full */
  @media (max-width:760px){
    .cc-fab{bottom:80px;right:12px;width:50px;height:50px}.cc-fab svg{width:23px;height:23px}
    .cc-panel{left:0;right:0;bottom:0;width:auto;height:88dvh;border-radius:20px 20px 0 0;border:0;box-shadow:0 -8px 30px rgba(0,0,0,.25);transition:height .18s ease}
    .cc-panel.cc-half{height:52dvh}
    body.cc-open .cc-fab{display:none}
    body.cc-open .cc-scrim{display:block}
    .cc-head{padding-top:14px}
    .cc-grip{display:block}
    .cc-m{max-width:88%}
  }
  @media (min-width:761px){.cc-head [data-a="size"]{display:none}}
  `;
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const md = s => esc(s).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>')
    .split(/\n{2,}/).map(p => '<p>' + p.replace(/^[-•]\s+/gm, '• ').replace(/\n/g, '<br>') + '</p>').join('');
  const get = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const set = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
  const conv = 'main'; // one running conversation per signed-in person (the server scopes it by user)
  const I = {
    chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>',
    mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
    send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>',
    globe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>'
  };

  const fab = document.createElement('button');
  fab.className = 'cc-fab'; fab.title = 'Chat with Claude'; fab.setAttribute('aria-label', 'Chat with Claude'); fab.innerHTML = I.chat;
  const scrim = document.createElement('div'); scrim.className = 'cc-scrim';
  const panel = document.createElement('section');
  panel.className = 'cc-panel'; panel.hidden = true; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Claude');
  panel.innerHTML = `<div class="cc-head"><span class="cc-grip"></span><b>Claude<small>Lee y escribe Excellovint</small></b>
      <button type="button" class="cc-lang" id="ccLang" title="Idioma del dictado"></button>
      <button type="button" class="cc-ib" data-a="size" aria-label="Tamaño">${I.down}</button>
      <button type="button" class="cc-ib" data-a="close" aria-label="Cerrar">${I.close}</button></div>
    <div class="cc-log" id="ccLog"></div>
    <div class="cc-inwrap"><div class="cc-listen">Escuchando… toca el micrófono para terminar</div>
    <form class="cc-in" id="ccForm"><div class="cc-pill"><textarea id="ccTa" rows="1" placeholder="Pregunta o dicta una orden…" aria-label="Mensaje"></textarea><button type="button" class="cc-mic" id="ccMic" aria-label="Dictar"></button><button type="submit" class="cc-send" id="ccSend" aria-label="Enviar">${I.send}</button></div></form></div>`;
  document.body.appendChild(scrim); document.body.appendChild(fab); document.body.appendChild(panel);
  const log = panel.querySelector('#ccLog'), ta = panel.querySelector('#ccTa'), send = panel.querySelector('#ccSend'), form = panel.querySelector('#ccForm'), micBtn = panel.querySelector('#ccMic');
  micBtn.innerHTML = I.mic;

  const SUGG = ['¿Qué hay pendiente hoy?', 'Orden urgente para Paris: …', '¿Cómo va el málico del L16?', 'Agrega a compras: …'];
  function add(role, text) {
    const d = document.createElement('div'); d.className = 'cc-m cc-' + role; d.innerHTML = md(text);
    log.appendChild(d); scrollEnd(); return d;
  }
  function empty() {
    if (log.children.length) return;
    log.innerHTML = `<div class="cc-empty"><p>Pregunta por cualquier vino o dicta una orden de trabajo: va directo a Excellovint.</p><div class="cc-sugg">${SUGG.map(s => `<button type="button" data-s="${esc(s)}">${esc(s)}</button>`).join('')}</div></div>`;
  }
  const scrollEnd = () => { log.scrollTop = log.scrollHeight; };
  async function loadConv() {
    log.innerHTML = '';
    try {
      const j = await (await fetch('/api/chat?conv=' + encodeURIComponent(conv))).json();
      let lastDay = '';
      (j.messages || []).forEach(m => {
        const day = m.at ? new Date(m.at).toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short' }) : '';
        if (day && day !== lastDay) { lastDay = day; const s = document.createElement('div'); s.className = 'cc-day'; s.textContent = day; log.appendChild(s); }
        add(m.role, m.text);
      });
    } catch (e) {}
    empty(); scrollEnd();
  }
  let loaded = false;
  const setOpen = o => { panel.hidden = !o; document.body.classList.toggle('cc-open', o); if (o) { if (!loaded) { loaded = true; loadConv(); } setTimeout(() => { scrollEnd(); if (window.matchMedia('(min-width:761px)').matches) ta.focus(); }, 60); } };
  fab.addEventListener('click', () => setOpen(panel.hidden));
  scrim.addEventListener('click', () => setOpen(false));
  panel.addEventListener('click', e => {
    const s = e.target.closest('[data-s]'); if (s) { ta.value = s.dataset.s.replace(/…$/, ''); grow(); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); return; }
    const a = e.target.closest('[data-a]'); if (!a) return;
    if (a.dataset.a === 'close') setOpen(false);
    if (a.dataset.a === 'size') panel.classList.toggle('cc-half');
  });
  // Drag the handle / header to switch between half and full height.
  let y0 = null;
  panel.querySelector('.cc-head').addEventListener('touchstart', e => { y0 = e.touches[0].clientY; }, { passive: true });
  panel.querySelector('.cc-head').addEventListener('touchend', e => { if (y0 == null) return; const dy = e.changedTouches[0].clientY - y0; y0 = null; if (dy > 60) { if (panel.classList.contains('cc-half')) setOpen(false); else panel.classList.add('cc-half'); } else if (dy < -40) panel.classList.remove('cc-half'); });

  // Composer: grow with the text; mic ↔ send swap.
  const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 132) + 'px'; form.classList.toggle('has-text', !!ta.value.trim()); };
  ta.addEventListener('input', grow);
  ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && window.matchMedia('(min-width:761px)').matches) { e.preventDefault(); form.requestSubmit(); } });

  // Dictation: browser speech recognition (Chrome on Android/desktop, Safari). Tap the mic to start/stop; ES/EN in the header.
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const langBtn = panel.querySelector('#ccLang');
  let lang = get('cc.lang') || 'ES';
  const drawLang = () => { langBtn.innerHTML = I.globe + (lang === 'ES' ? 'ES' : 'EN'); langBtn.title = 'Dictado en ' + (lang === 'ES' ? 'español' : 'inglés') + ' · toca para cambiar'; };
  drawLang();
  langBtn.addEventListener('click', () => { lang = lang === 'EN' ? 'ES' : 'EN'; set('cc.lang', lang); drawLang(); if (rec) rec.stop(); });
  let rec = null;
  if (!SR) { micBtn.hidden = true; langBtn.hidden = true; form.classList.add('has-text'); }
  micBtn.addEventListener('click', () => {
    if (rec) { rec.stop(); return; }
    rec = new SR(); rec.lang = lang === 'ES' ? 'es-MX' : 'en-US'; rec.continuous = true; rec.interimResults = true;
    const base = ta.value ? ta.value.replace(/\s*$/, ' ') : '';
    // Rebuild the whole transcript on every update. Android Chrome sends each new result with everything said
    // before it ("hola", "hola cómo", "hola cómo estás"), so a result that starts with the text so far replaces it.
    rec.onresult = ev => {
      let acc = '';
      for (let i = 0; i < ev.results.length; i++) {
        const t = ev.results[i][0].transcript.trim(); if (!t) continue;
        const a = acc.toLowerCase(), tl = t.toLowerCase();
        if (!acc || tl.startsWith(a)) acc = t;            // cumulative result: replace
        else if (a.endsWith(tl) || a.includes(tl)) { }     // repeat of something already there: skip
        else acc += ' ' + t;                               // genuinely new phrase: append
      }
      ta.value = base + acc; grow();
    };
    rec.onend = () => { rec = null; micBtn.classList.remove('on'); form.classList.remove('recording'); grow(); if (ta.value.trim()) ta.focus(); };
    rec.onerror = ev => { if (ev.error === 'not-allowed') add('assistant', 'Permite el micrófono para este sitio en el navegador para dictar.'); };
    micBtn.classList.add('on'); form.classList.add('recording'); rec.start();
  });
  form.addEventListener('submit', async e => {
    e.preventDefault(); if (rec) rec.stop();
    const text = ta.value.trim(); if (!text || send.disabled) return;
    const em = log.querySelector('.cc-empty'); if (em) em.remove();
    add('user', text); ta.value = ''; grow(); send.disabled = true;
    const wait = document.createElement('div'); wait.className = 'cc-typing'; wait.innerHTML = '<i></i><i></i><i></i>'; log.appendChild(wait); scrollEnd();
    try {
      const r = await fetch('/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ conv, text }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(r.status === 401 ? 'Se cerró la sesión. Recarga la página e inicia sesión.' : (j.message || 'Error ' + r.status));
      wait.replaceWith(add('assistant', j.text || '(sin respuesta)'));
      (j.actions || []).forEach(a => {
        const d = document.createElement(a.kind === 'purchase' ? 'a' : 'div'); d.className = 'cc-act';
        if (a.kind === 'purchase') { d.href = '/purchases'; d.textContent = '🛒 ' + a.text + ' → Compras'; }
        else d.textContent = a.tool === 'create_work_order' ? '✓ Guardada en ' + a.result.tab + ', fila ' + a.result.row
          : a.tool === 'update_row' ? '✓ Actualizada ' + a.input.tab + ', fila ' + a.input.row : '✓ Guardado en notas de la casa';
        log.appendChild(d);
      });
      if (j.changed) { const b = document.getElementById('syncBtn'); if (b) b.click(); }
    } catch (err) { wait.replaceWith(add('assistant', 'No pude responder: ' + err.message)); }
    send.disabled = false; scrollEnd();
  });
})();
