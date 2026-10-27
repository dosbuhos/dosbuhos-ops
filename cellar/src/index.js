// Cellar Target Calendar (Calendario de bodega) — Bodega Dos Búhos.
// The page is the Claude artifact, plus app/web-shim.js which points its window.claude API at the routes below.
import { handleAuth, loginPage, sessionEmail, isViewer } from './google.js';
import { sheetsTool } from './sheets.js';

const J = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: Object.assign({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }, headers) });
const COLL = /^[a-z][a-z0-9_-]{0,40}$/i;
const ID = /^[\w.\-]{1,120}$/;

export default {
  async fetch(request, env) {
    const url = new URL(request.url), p = url.pathname;
    if (p.startsWith('/auth/')) { const a = await handleAuth(request, env, url); if (a) return a; }
    // PUBLIC="1" (for now): no sign-in, everyone can view and edit. Set PUBLIC to "0" and add the Google secrets to require login.
    const open = env.PUBLIC === '1';
    const email = open ? 'public' : await sessionEmail(request, env);
    if (!email) {
      if (p.startsWith('/api/')) return J({ code: 'revoked', message: 'Sign in again.' }, 401);
      return loginPage(env, url);
    }
    const canWrite = open || !isViewer(env, email);
    try {
      if (p === '/api/me') return J({ email, canWrite });
      if (p.startsWith('/api/db/')) return await dbRoute(request, env, p, canWrite);
      if (p === '/api/sheets' && request.method === 'POST') {
        const { tool, args } = await request.json();
        if (!canWrite && !/^get_/.test(tool)) return J({ code: 'tool_error', message: 'Read-only access.' }, 403);
        const r = await sheetsTool(env, tool, args || {});
        return J(r.body, r.status);
      }
      if (p === '/api/ai' && request.method === 'POST') return await ai(request, env);
      if (p.startsWith('/api/')) return J({ code: 'not_found' }, 404);
    } catch (e) {
      return J({ code: 'unavailable', message: String(e && e.message || e) }, 500);
    }
    const res = await env.ASSETS.fetch(request);
    const h = new Headers(res.headers); h.set('cache-control', 'no-store'); h.set('x-robots-tag', 'noindex');
    return new Response(res.body, { status: res.status, headers: h });
  },
};

// ---------- db: collections of JSON docs in D1 (same shape as the artifact's shared database) ----------
async function dbRoute(request, env, p, canWrite) {
  const [, , , coll, id] = p.split('/').map(decodeURIComponent);
  if (!COLL.test(coll || '')) return J({ code: 'bad_request' }, 400);
  const m = request.method;
  if (m === 'GET' && !id) {
    const v = await env.DB.prepare('SELECT COUNT(*) n, MAX(updated_at) u FROM docs WHERE coll = ?').bind(coll).first();
    const etag = `"${coll}-${v.n}-${v.u || 0}"`;
    if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers: { etag } });
    const { results } = await env.DB.prepare('SELECT id, data FROM docs WHERE coll = ?').bind(coll).all();
    return J({ rows: results.map(r => ({ id: r.id, data: JSON.parse(r.data) })) }, 200, { etag });
  }
  if (!ID.test(id || '')) return J({ code: 'bad_request' }, 400);
  if (!canWrite) return J({ code: 'not_granted', message: 'Read-only access.' }, 403);
  const now = Date.now();
  if (m === 'DELETE') { await env.DB.prepare('DELETE FROM docs WHERE coll = ? AND id = ?').bind(coll, id).run(); return J({ ok: true }); }
  const body = await request.json();
  if (!body || typeof body !== 'object' || Array.isArray(body)) return J({ code: 'bad_request' }, 400);
  if (m === 'PUT') {
    await env.DB.prepare('INSERT INTO docs (coll, id, data, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(coll, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at')
      .bind(coll, id, JSON.stringify(body), now).run();
    return J({ ok: true, id });
  }
  if (m === 'PATCH') {
    // Shallow merge, like the artifact database's update(). json_patch merges objects; nulls delete keys, so do it in JS.
    const cur = await env.DB.prepare('SELECT data FROM docs WHERE coll = ? AND id = ?').bind(coll, id).first();
    if (!cur) return J({ code: 'not_found' }, 404);
    const merged = Object.assign(JSON.parse(cur.data), body);
    await env.DB.prepare('UPDATE docs SET data = ?, updated_at = ? WHERE coll = ? AND id = ?').bind(JSON.stringify(merged), now, coll, id).run();
    return J({ ok: true, id });
  }
  return J({ code: 'bad_request' }, 405);
}

// ---------- ai: the tutor and the blend-trial tidy-up, through the Claude API ----------
async function ai(request, env) {
  if (!env.ANTHROPIC_API_KEY) return J({ code: 'unavailable', message: 'ANTHROPIC_API_KEY is not set.' }, 503);
  const { messages, json, stream } = await request.json();
  const msgs = (messages || []).filter(m => m && (m.role === 'user' || m.role === 'assistant')).slice(-30)
    .map(m => ({ role: m.role, content: String(m.content || '').slice(0, 40000) }));
  if (!msgs.length) return J({ code: 'bad_request' }, 400);
  const body = { model: env.AI_MODEL || 'claude-sonnet-5-5', max_tokens: 4000, messages: msgs, stream: !!stream };
  if (json) body.system = 'Reply with one JSON value only. No prose, no code fences.';
  const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST',
    headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) { const t = await r.text(); return J({ code: r.status === 429 ? 'rate_limited' : 'unavailable', message: t.slice(0, 500) }, r.status === 429 ? 429 : 502); }
  if (stream) return new Response(r.body, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store' } });
  const j = await r.json();
  return J({ text: (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('') });
}
