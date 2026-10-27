// Chat button + panel: talk to Claude about the cellar; it can read and write Excellovint (see src/chat.js).
(function () {
  const css = `
  .cc-fab{position:fixed;right:18px;bottom:18px;z-index:9000;width:56px;height:56px;border-radius:50%;border:0;background:#5c1f33;color:#fff;box-shadow:0 6px 18px rgba(0,0,0,.25);cursor:pointer;display:flex;align-items:center;justify-content:center}
  .cc-fab svg{width:26px;height:26px}
  @media (max-width:760px){.cc-fab{bottom:80px;right:12px;width:48px;height:48px}.cc-fab svg{width:22px;height:22px}}
  .cc-panel{position:fixed;right:18px;bottom:86px;z-index:9001;width:min(440px,calc(100vw - 24px));height:min(640px,calc(100vh - 110px));background:#fffdf9;color:#1f1d1b;border:1px solid #d9d0c4;border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.25);display:flex;flex-direction:column;overflow:hidden;font:15px/1.45 "IBM Plex Sans",-apple-system,Segoe UI,Roboto,sans-serif}
  /* Phones: a bottom sheet over the lower part of the screen so the calendar stays visible above it; Expand for full screen. */
  @media (max-width:760px){
    .cc-panel{left:0;right:0;bottom:0;width:auto;height:46dvh;border-radius:16px 16px 0 0;border-bottom:0;box-shadow:0 -8px 30px rgba(0,0,0,.22)}
    .cc-panel.cc-big{height:92dvh}
    body.cc-open{padding-bottom:46dvh}
    body.cc-open .cc-fab{display:none}
    .cc-head{padding:8px 10px}.cc-head b{font-size:16px}
    .cc-grip{position:absolute;left:50%;top:4px;width:40px;height:4px;margin-left:-20px;border-radius:2px;background:rgba(255,255,255,.55)}
    .cc-log{padding:10px}.cc-m{max-width:92%}
    .cc-in{padding:8px}.cc-in textarea{font-size:16px}
  }
  @media (min-width:761px){.cc-grip,.cc-head [data-a="size"]{display:none}}
  .cc-panel[hidden]{display:none}
  .cc-head{display:flex;align-items:center;gap:8px;padding:10px 12px;background:#5c1f33;color:#fff}
  .cc-head b{flex:1;font-family:"Barlow Condensed",sans-serif;letter-spacing:.04em;font-size:18px;text-transform:uppercase}
  .cc-head button{background:transparent;border:1px solid rgba(255,255,255,.5);color:#fff;border-radius:8px;padding:5px 10px;cursor:pointer;font:inherit;font-size:13px;white-space:nowrap;flex:0 0 auto}
  .cc-log{flex:1;overflow:auto;padding:12px;display:flex;flex-direction:column;gap:10px}
  .cc-m{max-width:88%;padding:8px 11px;border-radius:12px;white-space:normal;word-wrap:break-word}
  .cc-m p{margin:0 0 6px}.cc-m p:last-child{margin:0}
  .cc-user{align-self:flex-end;background:#5c1f33;color:#fff;border-bottom-right-radius:4px}
  .cc-assistant{align-self:flex-start;background:#f1ebe2;border-bottom-left-radius:4px}
  .cc-act{align-self:flex-start;font-size:12.5px;color:#2f5d34;background:#e8f1e6;border-radius:8px;padding:4px 8px}
  .cc-hint{color:#6b6560;font-size:13.5px;text-align:center;margin:auto 10px}
  .cc-in{display:flex;gap:8px;padding:10px;border-top:1px solid #e6ded3;background:#fff}
  .cc-in textarea{flex:1;resize:none;border:1px solid #cfc6bb;border-radius:10px;padding:8px 10px;font:inherit;max-height:140px}
  .cc-in button{border:0;background:#5c1f33;color:#fff;border-radius:10px;padding:0 14px;font:inherit;font-weight:600;cursor:pointer}
  .cc-in button:disabled{opacity:.5}
  .cc-notes{flex:1;display:flex;flex-direction:column;padding:12px;gap:8px}
  .cc-notes textarea{flex:1;border:1px solid #cfc6bb;border-radius:10px;padding:10px;font:14px/1.5 inherit}
  .cc-notes small{color:#6b6560}
  `;
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const md = s => esc(s).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>')
    .split(/\n{2,}/).map(p => '<p>' + p.replace(/\n/g, '<br>') + '</p>').join('');
  const get = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const set = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
  const newConv = () => 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  let conv = get('cc.conv') || newConv(); set('cc.conv', conv);

  const fab = document.createElement('button');
  fab.className = 'cc-fab'; fab.title = 'Chat with Claude'; fab.setAttribute('aria-label', 'Chat with Claude');
  fab.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>';
  const panel = document.createElement('div');
  panel.className = 'cc-panel'; panel.hidden = true;
  panel.innerHTML = `<div class="cc-head"><span class="cc-grip"></span><b>Claude</b><button type="button" data-a="size">Expand</button><button type="button" data-a="new">New chat</button><button type="button" data-a="close">✕</button></div>
    <div class="cc-log" id="ccLog"></div>
    <div class="cc-notes" id="ccNotes" hidden><small>House notes: rules and decisions the chat always follows. One per line.</small><textarea id="ccNotesTa"></textarea><div style="display:flex;gap:8px;justify-content:flex-end"><button type="button" class="btn" data-a="notesBack">Back</button><button type="button" class="btn primary" data-a="notesSave">Save</button></div></div>
    <form class="cc-in" id="ccForm"><textarea id="ccTa" rows="2" placeholder="Ask, or: “orden urgente para Paris mañana: …”"></textarea><button type="submit" id="ccSend">Send</button></form>`;
  document.body.appendChild(fab); document.body.appendChild(panel);
  const log = panel.querySelector('#ccLog'), ta = panel.querySelector('#ccTa'), send = panel.querySelector('#ccSend');

  function add(role, text) {
    const d = document.createElement('div'); d.className = 'cc-m cc-' + role; d.innerHTML = role === 'user' ? md(text) : md(text);
    log.appendChild(d); log.scrollTop = log.scrollHeight; return d;
  }
  function hint() { if (!log.children.length) log.innerHTML = '<div class="cc-hint">Ask about any wine, or tell me a work order to create.<br>It goes straight into Excellovint.</div>'; }
  async function loadConv() {
    log.innerHTML = '';
    try { const j = await (await fetch('/api/chat?conv=' + encodeURIComponent(conv))).json(); (j.messages || []).forEach(m => add(m.role, m.text)); } catch (e) {}
    hint();
  }
  let loaded = false;
  const setOpen = o => { panel.hidden = !o; document.body.classList.toggle('cc-open', o); };
  fab.addEventListener('click', () => { setOpen(panel.hidden); if (!panel.hidden) { if (!loaded) { loaded = true; loadConv(); } setTimeout(() => ta.focus(), 50); } });
  panel.addEventListener('click', async e => {
    const a = e.target.closest('[data-a]'); if (!a) return;
    const act = a.dataset.a;
    if (act === 'close') setOpen(false);
    if (act === 'size') { const big = panel.classList.toggle('cc-big'); a.textContent = big ? 'Shrink' : 'Expand'; }
    if (act === 'new') { conv = newConv(); set('cc.conv', conv); log.innerHTML = ''; hint(); ta.focus(); }
    if (act === 'notes') {
      const j = await (await fetch('/api/notes')).json();
      panel.querySelector('#ccNotesTa').value = (j.lines || []).map(l => l.text).join('\n');
      log.hidden = true; panel.querySelector('#ccForm').hidden = true; panel.querySelector('#ccNotes').hidden = false;
    }
    if (act === 'notesBack' || act === 'notesSave') {
      if (act === 'notesSave') {
        const lines = panel.querySelector('#ccNotesTa').value.split('\n').map(t => ({ text: t.trim() })).filter(l => l.text);
        await fetch('/api/notes', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ lines }) });
      }
      log.hidden = false; panel.querySelector('#ccForm').hidden = false; panel.querySelector('#ccNotes').hidden = true;
    }
  });
  ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); panel.querySelector('#ccForm').requestSubmit(); } });
  panel.querySelector('#ccForm').addEventListener('submit', async e => {
    e.preventDefault();
    const text = ta.value.trim(); if (!text || send.disabled) return;
    const h = log.querySelector('.cc-hint'); if (h) h.remove();
    add('user', text); ta.value = ''; send.disabled = true;
    const wait = add('assistant', '…');
    try {
      const r = await fetch('/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ conv, text }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(r.status === 401 ? 'Signed out. Reload the page and sign in.' : (j.message || 'Error ' + r.status));
      wait.innerHTML = md(j.text || '(no answer)');
      (j.actions || []).forEach(a => {
        const d = document.createElement('div'); d.className = 'cc-act';
        d.textContent = a.tool === 'create_work_order' ? '✓ Added to ' + a.result.tab + ', row ' + a.result.row
          : a.tool === 'update_row' ? '✓ Updated ' + a.input.tab + ', row ' + a.input.row : '✓ Saved to house notes';
        log.appendChild(d);
      });
      if (j.changed) { const b = document.getElementById('syncBtn'); if (b) b.click(); }
    } catch (err) { wait.innerHTML = md('Couldn’t get an answer: ' + err.message); }
    send.disabled = false; log.scrollTop = log.scrollHeight; ta.focus();
  });
})();
