// Adaptador para la versión web pública: reemplaza la base de datos de Claude por la API del Worker (/api/*).
(function () {
  const KEY = 'huerto-pin';
  const getPin = () => { try { return localStorage.getItem(KEY) || ''; } catch (e) { return ''; } };
  const setPin = p => { try { p ? localStorage.setItem(KEY, p) : localStorage.removeItem(KEY); } catch (e) {} };
  // Hoja dentro de la app para pedir el PIN (campo numérico oculto). Resuelve con el PIN ya verificado, o '' si se cancela.
  // Se superpone a la página: no borra lo que la persona estaba escribiendo.
  let asking = null;
  function askPin(why) {
    if (asking) return asking;
    asking = new Promise(resolve => {
      const back = document.activeElement;
      const el = document.createElement('div');
      el.className = 'sheet pinsheet';
      el.innerHTML = '<form class="in" role="dialog" aria-modal="true" aria-labelledby="pin-t" novalidate>'
        + '<div class="pinh"><b id="pin-t">PIN para guardar</b></div>'
        + (why ? '<p class="small muted" style="margin:0">' + why + '</p>' : '')
        + '<label class="fl" for="pin-i"><span class="fll">PIN (pídelo a Eric o Melanie)</span>'
        + '<input id="pin-i" type="password" inputmode="numeric" pattern="[0-9]*" autocomplete="off" maxlength="12" enterkeyhint="done" aria-describedby="pin-e pin-h"></label>'
        + '<p class="ferr" id="pin-e" role="alert" hidden></p>'
        + '<p class="small muted" id="pin-h" style="margin:0">Se recuerda en este teléfono: no hay que escribirlo cada vez.</p>'
        + '<div class="pinb"><button type="submit" class="btn primary">Guardar con este PIN</button><button type="button" class="btn" data-x>Cancelar</button></div></form>';
      document.body.appendChild(el);
      const form = el.querySelector('form'), inp = el.querySelector('#pin-i'), err = el.querySelector('#pin-e'), ok = el.querySelector('button[type=submit]');
      const done = v => { el.remove(); document.removeEventListener('keydown', onKey, true); asking = null; if (back && back.focus) try { back.focus({ preventScroll: true }); } catch (e) {} resolve(v); };
      const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); done(''); } };
      document.addEventListener('keydown', onKey, true);
      el.addEventListener('click', e => { if (e.target === el) done(''); });
      el.querySelector('[data-x]').onclick = () => done('');
      const show = m => { err.textContent = m; err.hidden = false; inp.classList.add('invalid'); inp.setAttribute('aria-invalid', 'true'); inp.select(); };
      inp.oninput = () => { err.hidden = true; inp.classList.remove('invalid'); inp.removeAttribute('aria-invalid'); };
      form.onsubmit = async e => {
        e.preventDefault();
        const p = inp.value.trim();
        if (!p) { show('Escribe el PIN'); return; }
        ok.disabled = true; ok.textContent = 'Revisando…';
        let j = null;
        try { j = await (await fetch('/api/pin', { method: 'POST', headers: { 'x-pin': p } })).json(); } catch (e2) { j = { net: true }; }
        ok.disabled = false; ok.textContent = 'Guardar con este PIN';
        if (j && j.ok) { setPin(p); done(p); return; }
        show(j && j.net ? 'Sin conexión. Intenta de nuevo.' : 'PIN incorrecto');
      };
      setTimeout(() => inp.focus(), 30);
    });
    return asking;
  }
  async function ensurePin(why) {
    const p = getPin();
    if (p) return p;
    const n = await askPin(why);
    if (!n) throw { code: 'no_pin' };
    return n;
  }
  const refresh = () => window.dispatchEvent(new Event('huerto-refresh'));
  async function post(path, body) {
    let pin;
    try { pin = await ensurePin(); } catch (e) { refresh(); throw e; }
    const send = p => fetch(path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-pin': p }, body: JSON.stringify(body) });
    let r;
    try { r = await send(pin); } catch (e) { refresh(); throw { code: 'unavailable' }; }
    if (r.status === 401) {
      // El PIN guardado ya no sirve (lo cambiaron): pedirlo otra vez y reintentar una sola vez.
      setPin('');
      try { pin = await ensurePin('El PIN guardado en este teléfono ya no sirve. Escríbelo de nuevo.'); } catch (e) { refresh(); throw e; }
      try { r = await send(pin); } catch (e) { refresh(); throw { code: 'unavailable' }; }
      if (r.status === 401) { setPin(''); refresh(); throw { code: 'bad_pin' }; }
    }
    if (r.status === 400) { const j = await r.json().catch(() => ({})); throw { code: 'invalid', message: j.error || 'Datos inválidos' }; }
    if (!r.ok) { refresh(); throw { code: 'unavailable' }; }
    return r.json().catch(() => ({}));
  }
  const snap = rows => ({ docs: rows.map(d => ({ id: d.id, data: () => d })), size: rows.length, empty: !rows.length });
  function poll(load, cb) {
    const run = async () => { try { cb(snap(await load())); } catch (e) {} };
    run();
    const t = setInterval(() => { if (document.visibilityState === 'visible') run(); }, 20000);
    window.addEventListener('huerto-refresh', run);
    return () => { clearInterval(t); window.removeEventListener('huerto-refresh', run); };
  }
  const db = {
    collection(name) {
      let w = null, ayuda = false;
      const q = {
        where(f, op, v) { if (f === 'estado') ayuda = true; else w = v; return q; },
        orderBy() { return q; },
        limit() { return q; },
        onSnapshot(cb) {
          if (name === 'hechas' && ayuda) return poll(async () => (await (await fetch('/api/avisos')).json()).rows, cb);
          if (name === 'camas') return poll(async () => (await (await fetch('/api/camas')).json()).rows, cb);
          if (name === 'hechas') return poll(async () => (await (await fetch('/api/hechas?w=' + w)).json()).rows, cb);
          return poll(async () => (await (await fetch('/api/cosechas')).json()).rows, cb);
        },
        async add(doc) {
          if (name === 'camas') { const j = await post('/api/camas', doc); refresh(); return { id: j.id }; }
          const j = await post('/api/cosechas', doc); refresh(); return { id: j && j.id };
        },
      };
      return q;
    },
    doc(path) {
      const c = path.match(/^camas\/(.+)$/);
      if (c) return { async delete() { await post('/api/camas', { del: c[1] }); refresh(); } };
      const m = path.match(/^hechas\/w(\d+)-(.+)$/);
      return {
        async set(d) { await post('/api/hechas', { w: Number(m[1]), id: m[2], done: true, estado: d && d.estado, nota: d && d.nota, txt: d && d.txt }); refresh(); },
        async delete() { await post('/api/hechas', { w: Number(m[1]), id: m[2], done: false }); refresh(); },
      };
    },
  };
  window.claude = { use: async n => (n === 'db' ? db : null) };
  window.huertoApi = { post };
})();
