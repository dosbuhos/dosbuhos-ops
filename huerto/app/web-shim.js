// Adaptador para la versión web pública: reemplaza la base de datos de Claude por la API del Worker (/api/*).
(function () {
  const KEY = 'huerto-pin';
  const getPin = () => { try { return localStorage.getItem(KEY) || ''; } catch (e) { return ''; } };
  const setPin = p => { try { p ? localStorage.setItem(KEY, p) : localStorage.removeItem(KEY); } catch (e) {} };
  async function ensurePin() {
    let p = getPin();
    if (p) return p;
    p = (prompt('PIN para guardar cambios (pídelo a Eric o Melanie):') || '').trim();
    if (!p) throw { code: 'no_pin' };
    const r = await fetch('/api/pin', { method: 'POST', headers: { 'x-pin': p } });
    const j = await r.json().catch(() => ({}));
    if (!j.ok) { alert('PIN incorrecto'); throw { code: 'bad_pin' }; }
    setPin(p);
    return p;
  }
  const refresh = () => window.dispatchEvent(new Event('huerto-refresh'));
  async function post(path, body) {
    let pin;
    try { pin = await ensurePin(); } catch (e) { refresh(); throw e; }
    const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-pin': pin }, body: JSON.stringify(body) });
    if (r.status === 401) { setPin(''); refresh(); throw { code: 'bad_pin' }; }
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
          await post('/api/cosechas', doc); refresh();
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
