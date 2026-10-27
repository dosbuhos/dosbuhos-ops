// Web adapter: gives the Cellar Target Calendar (built as a Claude artifact) the same window.claude.use(...) API,
// backed by this Worker instead of claude.ai: db -> D1 (/api/db), mcp "Google Sheets" -> /api/sheets (service account),
// sample -> /api/ai (Claude API), user -> /api/me, downloads -> browser download, permissions -> always granted.
(function () {
  const json = async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw Object.assign({ code: j.code || (r.status === 401 ? 'revoked' : 'unavailable') }, j); return j; };
  const call = (path, body, method) => fetch(path, { method: method || 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin', body: body === undefined ? undefined : JSON.stringify(body) }).then(json);

  // ---------- db: Firestore-like collections over D1, kept fresh by polling with ETags ----------
  const subs = {}; // coll -> { cbs:Set, etag, rows, timer }
  const snap = (rows) => ({ docs: rows.map(d => ({ id: d.id, data: () => d.data })), size: rows.length, empty: !rows.length });
  async function pull(coll, force) {
    const s = subs[coll]; if (!s) return;
    try {
      const r = await fetch('/api/db/' + encodeURIComponent(coll), { credentials: 'same-origin', headers: force || !s.etag ? {} : { 'if-none-match': s.etag } });
      if (r.status === 304) return;
      if (r.status === 401) { s.cbs.forEach(c => c.err && c.err({ code: 'revoked' })); return; }
      const j = await json(r);
      s.etag = r.headers.get('etag'); s.rows = j.rows || [];
      s.cbs.forEach(c => { try { c.ok(snap(s.rows)); } catch (e) { console.error(e); } });
    } catch (e) { s.cbs.forEach(c => c.err && c.err(e)); }
  }
  const touch = (coll) => setTimeout(() => pull(coll), 50);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') Object.keys(subs).forEach(c => pull(c)); });
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  const db = {
    collection(coll) {
      const base = '/api/db/' + encodeURIComponent(coll);
      return {
        onSnapshot(ok, err) {
          const s = subs[coll] || (subs[coll] = { cbs: new Set(), etag: null, rows: null });
          const c = { ok, err }; s.cbs.add(c);
          if (s.rows) ok(snap(s.rows)); else pull(coll, true);
          if (!s.timer) s.timer = setInterval(() => { if (document.visibilityState === 'visible') pull(coll); }, 15000);
          return () => { s.cbs.delete(c); if (!s.cbs.size) { clearInterval(s.timer); delete subs[coll]; } };
        },
        async add(data) { const id = newId(); await call(base + '/' + encodeURIComponent(id), data, 'PUT'); touch(coll); return { id }; },
        doc(id) {
          const u = base + '/' + encodeURIComponent(id);
          return {
            id,
            async set(data) { await call(u, data, 'PUT'); touch(coll); },
            async update(data) { await call(u, data, 'PATCH'); touch(coll); },
            async delete() { await call(u, undefined, 'DELETE'); touch(coll); },
          };
        },
      };
    },
  };

  // ---------- mcp: only the Google Sheets tools the page uses, via the Worker ----------
  const cache = new Map();
  const mcp = {
    async callTool(server, tool, args, opts) {
      const c = opts && opts.cache;
      const key = c ? tool + JSON.stringify(args) : null;
      if (key && !c.refresh) {
        const hit = cache.get(key);
        if (hit && Date.now() - hit.storedAt < (c.staleTime || 0)) return { payload: hit.payload, cache: { storedAt: hit.storedAt } };
      }
      let j;
      try { j = await call('/api/sheets', { tool, args }); }
      catch (e) { throw Object.assign({ code: e.code === 'revoked' ? 'revoked' : 'tool_error', message: e.message || 'Google Sheets error' }, { result: e.result || e }); }
      const storedAt = Date.now();
      if (key) cache.set(key, { payload: j.payload, storedAt });
      return { payload: j.payload, cache: { storedAt } };
    },
  };

  // ---------- sample: Claude through the Worker ----------
  async function ask(messages, opts, wantJson) {
    const onText = opts && opts.onText;
    const r = await fetch('/api/ai', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages, json: !!wantJson, stream: !!onText, tier: opts && opts.modelTier }) });
    if (!r.ok) { const j = await r.json().catch(() => ({})); throw { code: r.status === 429 ? 'rate_limited' : (j.code || 'unavailable'), message: j.message }; }
    if (!onText) return (await r.json()).text || '';
    const rd = r.body.getReader(), dec = new TextDecoder(); let buf = '', text = '';
    for (;;) {
      const { value, done } = await rd.read(); if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line.startsWith('data:')) continue;
        try { const ev = JSON.parse(line.slice(5)); if (ev.type === 'content_block_delta' && ev.delta && ev.delta.text) { text += ev.delta.text; onText({ text }); } } catch (e) {}
      }
    }
    return text;
  }
  const toMsgs = (input) => typeof input === 'string' ? [{ role: 'user', content: input }] : input;
  const sample = async (input, opts) => ({ text: await ask(toMsgs(input), opts, false) });
  sample.json = async (input, opts) => {
    const t = await ask(toMsgs(input), opts, true);
    const m = t.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    try { return JSON.parse(m ? m[0] : t); } catch (e) { return null; }
  };

  // ---------- user / downloads / permissions ----------
  let me = null;
  const getMe = async () => me || (me = await call('/api/me', undefined, 'GET').catch(() => ({})));
  const user = {
    async can(what) { const m = await getMe(); return what === 'data.write' ? m.canWrite !== false : true; },
    async canEdit() { const m = await getMe(); return m.canWrite !== false; },
    async info() { return getMe(); },
  };
  const downloads = {
    async save({ filename, data }) {
      const blob = data instanceof Blob ? data : new Blob([data]);
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename || 'download';
      document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    },
  };
  const permissions = { async state() { return 'granted'; }, async request(list) { const o = {}; (list || []).forEach(k => { o[k] = 'granted'; }); return o; }, async manage() {} };

  const api = { db, mcp, sample, user, downloads, permissions };
  window.claude = { use: async (name) => api[name] || null };
})();
