// Cellar Target Calendar (Calendario de bodega) — Bodega Dos Búhos.
// The page is the Claude artifact, plus app/web-shim.js which points its window.claude API at the routes below.
import { handleAuth, loginPage, sessionEmail, isViewer, isAdmin, isCrew, initialsFor } from './google.js';
import { sheetsTool } from './sheets.js';
import { chat, chatHistory, houseNotes } from './chat.js';
import { xlRoute, sync } from './xl.js';
import { pushPurchase, pullPurchases } from './compras.js';

const J = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: Object.assign({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }, headers) });
const COLL = /^[a-z][a-z0-9_-]{0,40}$/i;
const ID = /^[\w.\-]{1,120}$/;

export default {
  // Every 5 minutes: copy whatever changed in Excellovint into the app's records.
  async scheduled(event, env, ctx) { if (env.GOOGLE_SA_JSON) { ctx.waitUntil(sync(env).catch(e => console.log('sync failed', e && e.message))); ctx.waitUntil(pullPurchases(env).catch(e => console.log('compras pull failed', e && e.message))); } },
  async fetch(request, env, ctx) {
    const url = new URL(request.url), p = url.pathname;
    // App-managed users (Settings → Users), alongside the ALLOWED_EMAILS secret.
    try { const { results } = await env.DB.prepare("SELECT id, data FROM docs WHERE coll = 'users'").all(); env.__users = results.map(r => Object.assign({ email: r.id }, JSON.parse(r.data))); } catch (e) { env.__users = []; }
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
      const initials = open ? 'EM' : initialsFor(env, email);
      const admin = open || isAdmin(env, email);
      const crew = !open && !admin && isCrew(env, email);
      if (crew && /^\/settings(\.html)?\/?$/.test(p)) return Response.redirect(url.origin + '/', 302);
      if (p === '/api/me') return J({ email, canWrite, initials, admin, role: crew ? 'crew' : admin ? 'admin' : canWrite ? 'editor' : 'viewer' });
      if (p === '/api/users') {
        if (!admin) return J({ message: 'Only an admin can manage users.' }, 403);
        if (request.method === 'GET') return J({ users: env.__users, fromSecret: String(env.ALLOWED_EMAILS || '').split(',').map(x => x.split('=')[0].trim()).filter(Boolean) });
        if (request.method === 'PUT') {
          const b = await request.json();
          const users = (Array.isArray(b.users) ? b.users : []).map(u => ({ email: String(u.email || '').trim().toLowerCase(), initials: String(u.initials || '').trim().toUpperCase().slice(0, 8), role: ['viewer', 'crew'].includes(u.role) ? u.role : 'editor' })).filter(u => /^[^@\s]+@[^@\s]+$/.test(u.email) && u.initials);
          const stmts = [env.DB.prepare("DELETE FROM docs WHERE coll = 'users'")];
          for (const u of users) stmts.push(env.DB.prepare("INSERT INTO docs (coll, id, data, updated_at) VALUES ('users', ?, ?, ?)").bind(u.email, JSON.stringify({ initials: u.initials, role: u.role }), Date.now()));
          await env.DB.batch(stmts);
          return J({ ok: true, users });
        }
      }
      if (p === '/api/chat' && request.method === 'POST') {
        if (!canWrite) return J({ message: 'Read-only access.' }, 403);
        const r = await chat(request, env, { email, initials, name: initials === 'EM' ? 'Eric' : initials === 'D' ? 'Diane' : initials === 'P/J' ? 'Paris y Jimena' : email });
        return J(r.body, r.status);
      }
      if (p === '/api/chat' && request.method === 'GET') return J({ messages: await chatHistory(env, { initials }) });
      if (p.startsWith('/api/xl/')) {
        const r = await xlRoute(request, env, p, url, { initials, canWrite });
        if (p === '/api/xl/import' && r.status === 200) { try { r.body.compras = await pullPurchases(env); } catch (e) { r.body.compras = { error: String(e && e.message) }; } }
        return J(r.body, r.status);
      }
      if (p === '/api/compras/sync' && request.method === 'POST') return J(await pullPurchases(env));
      if (p === '/api/chats') {
        const { results } = await env.DB.prepare("SELECT data FROM docs WHERE coll = 'chatlog' ORDER BY updated_at DESC LIMIT 600").all();
        return J({ messages: results.map(r => JSON.parse(r.data)) });
      }
      if (p === '/api/notes' && request.method === 'GET') return J(await houseNotes(env));
      if (p === '/api/notes' && request.method === 'PUT') {
        if (!canWrite || crew) return J({ message: 'Read-only access.' }, 403);
        const b = await request.json();
        const lines = (Array.isArray(b.lines) ? b.lines : []).map(l => ({ text: String(l.text || '').slice(0, 500), by: l.by || initials, at: l.at || new Date().toISOString() })).filter(l => l.text.trim());
        await env.DB.prepare("INSERT INTO docs (coll, id, data, updated_at) VALUES ('housenotes', 'main', ?, ?) ON CONFLICT(coll, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at").bind(JSON.stringify({ lines }), Date.now()).run();
        return J({ ok: true });
      }
      if (p.startsWith('/api/db/')) return await dbRoute(request, env, p, canWrite, ctx, crew);
      if (p === '/api/sheets' && request.method === 'POST') {
        const { tool, args } = await request.json();
        if (!canWrite && !/^get_/.test(tool)) return J({ code: 'tool_error', message: 'Read-only access.' }, 403);
        const r = await sheetsTool(env, tool, args || {});
        // A write from the calendar page: mirror that tab into the app's records right away.
        if (r.status === 200 && tool === 'update_values' && args && args.range) {
          const m = String(args.range).match(/^'((?:[^']|'')+)'!/);
          if (m && /^L\d/i.test(m[1])) ctx.waitUntil(sync(env, [m[1].replace(/''/g, "'")]).catch(() => {}));
        }
        return J(r.body, r.status);
      }
      if (p === '/api/ai' && request.method === 'POST') return await ai(request, env);
      if (p.startsWith('/api/')) return J({ code: 'not_found' }, 404);
    } catch (e) {
      return J({ code: 'unavailable', message: String(e && e.message || e) }, 500);
    }
    // Short link printed on barrel tags: /b/101 → the barrel's card in the Cellar section.
    const bm = p.match(/^\/b\/(\d{1,4})\/?$/);
    if (bm) return Response.redirect(url.origin + '/?b=' + bm[1] + '#cellar', 302);
    const res = await env.ASSETS.fetch(request);
    const h = new Headers(res.headers); h.set('cache-control', 'no-store'); h.set('x-robots-tag', 'noindex');
    return new Response(res.body, { status: res.status, headers: h });
  },
};

// ---------- db: collections of JSON docs in D1 (same shape as the artifact's shared database) ----------
// What the crew role may write. Tasks: only the fields that follow a work order (done, the order itself, its assignee/priority/date).
const CREW_COLLS = new Set(['progress', 'woqueue', 'wocache', 'labcache', 'purchases', 'barrel_log', 'trials']);
const CREW_TASK_KEYS = new Set(['done', 'wo', 'asig', 'pri', 'day', 'week']);
async function dbRoute(request, env, p, canWrite, ctx, crew) {
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
  const planOnly = () => J({ code: 'not_granted', message: 'Solo Eric o Diane pueden cambiar el plan, los vinos, los protocolos o los ajustes.' }, 403);
  if (crew && !CREW_COLLS.has(coll) && coll !== 'tasks') return planOnly();
  if (crew && coll === 'tasks' && m !== 'PATCH') return planOnly();
  if (m === 'DELETE') { await env.DB.prepare('DELETE FROM docs WHERE coll = ? AND id = ?').bind(coll, id).run(); if (coll === 'purchases') ctx.waitUntil(pushPurchase(env, id, null)); return J({ ok: true }); }
  const body = await request.json();
  if (!body || typeof body !== 'object' || Array.isArray(body)) return J({ code: 'bad_request' }, 400);
  if (m === 'PUT') {
    await env.DB.prepare('INSERT INTO docs (coll, id, data, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(coll, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at')
      .bind(coll, id, JSON.stringify(body), now).run();
    if (coll === 'purchases') ctx.waitUntil(pushPurchase(env, id, body));
    return J({ ok: true, id });
  }
  if (m === 'PATCH') {
    if (crew && coll === 'tasks' && !Object.keys(body).every(k => CREW_TASK_KEYS.has(k))) return planOnly();
    // Shallow merge, like the artifact database's update(). json_patch merges objects; nulls delete keys, so do it in JS.
    const cur = await env.DB.prepare('SELECT data FROM docs WHERE coll = ? AND id = ?').bind(coll, id).first();
    if (!cur) return J({ code: 'not_found' }, 404);
    const merged = Object.assign(JSON.parse(cur.data), body);
    await env.DB.prepare('UPDATE docs SET data = ?, updated_at = ? WHERE coll = ? AND id = ?').bind(JSON.stringify(merged), now, coll, id).run();
    if (coll === 'purchases') ctx.waitUntil(pushPurchase(env, id, merged));
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
