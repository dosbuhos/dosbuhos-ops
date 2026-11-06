// Cellar Target Calendar (Calendario de bodega) — Bodega Dos Búhos.
// The page is the Claude artifact, plus app/web-shim.js which points its window.claude API at the routes below.
import { handleAuth, loginPage, sessionEmail, isViewer, isAdmin, isCrew, initialsFor } from './google.js';
import { sheetsTool } from './sheets.js';
import { chat, chatHistory, houseNotes } from './chat.js';
import { xlRoute, sync } from './xl.js';
import { pushPurchase, pullPurchases } from './compras.js';
import { readInventory, addMovement, saveItem } from './inventario.js';
import { mcpRoute } from './mcp.js';
import { entriesRoute } from './entries.js';
import { movesRoute } from './moves.js';
import { VERSION_LABEL, APP_NAME, APP_SHORT } from './version.js';
import { crewSheetsGuard, staffName, staffTags } from './guard.js';
import { reviewAll, reviewOne } from './review.js';

const J = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: Object.assign({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }, headers) });
const COLL = /^[a-z][a-z0-9_-]{0,40}$/i;
const ID = /^[\w.\-]{1,120}$/;

export default {
  // Every 5 minutes: copy whatever changed in Excellovint into the app's records.
  async scheduled(event, env, ctx) {
    if (env.STAGING === '1') return; // staging never syncs, reviews or writes to Google
    // 18:00 / 22:00 / 01:00 UTC = 12:00, 16:00, 19:00 in San Miguel (UTC−6): Claude reviews every active wine (src/review.js).
    if (event.cron && event.cron !== '*/5 * * * *') { ctx.waitUntil(reviewAll(env).catch(e => console.log('review failed', e && e.message))); return; }
    if (env.GOOGLE_SA_JSON) { ctx.waitUntil(sync(env).catch(e => console.log('sync failed', e && e.message))); ctx.waitUntil(pullPurchases(env).catch(e => console.log('compras pull failed', e && e.message))); } },
  async fetch(request, env, ctx) {
    const url = new URL(request.url), p = url.pathname;
    // App-managed users (Settings → Users), alongside the ALLOWED_EMAILS secret.
    // App users change rarely: read them from D1 at most once a minute per Worker instance, not on every request.
    env.__users = await appUserList(env);
    if (p === '/manifest.webmanifest') return new Response(JSON.stringify({ name: APP_NAME, short_name: APP_SHORT, start_url: '/', display: 'standalone', background_color: '#ffffff', theme_color: '#5c1f33',
      icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' }, { src: '/icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }] }),
      { headers: { 'content-type': 'application/manifest+json', 'cache-control': 'public, max-age=3600' } });
    if (p.startsWith('/icons/')) return env.ASSETS.fetch(request); // public: home-screen icons
    if (p.startsWith('/brand/')) return brandAsset(env, p);             // public: the Dos Búhos logos (login page + header)
    if (p.startsWith('/auth/')) { const a = await handleAuth(request, env, url); if (a) return a; }
    // Remote MCP server for people's own Claude apps (/mcp + its OAuth endpoints); see src/mcp.js.
    if (p === '/mcp' || p.startsWith('/oauth/') || p.startsWith('/.well-known/oauth') || p.startsWith('/.well-known/openid')) { const r = await mcpRoute(request, env, url, ctx); if (r) return r; }
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
      if (p === '/api/me') return J({ email, canWrite, initials, admin, name: await staffName(env, initials, email), role: crew ? 'crew' : admin ? 'admin' : canWrite ? 'editor' : 'viewer', version: VERSION_LABEL });
      if (p === '/api/version') return J({ version: VERSION_LABEL });
      // Staging only: refresh this copy's data from production (read-only on PROD_DB). Crew logins are not copied.
      if (p === '/api/staging/seed') { // open it in the browser once after the first deploy, or any time to refresh
        if (env.STAGING !== '1' || !env.PROD_DB || !admin) return J({ message: 'Not available.' }, 404);
        const out = {};
        for (const [t, cols, where] of [['docs', 'coll, id, data, updated_at', "WHERE coll <> 'users'"], ['xl_tabs', 'tab, lote, vino, header_row, imported_at', ''], ['xl_rows', 'tab, row, date, date_raw, ubi, voli, volf, ph, bx, tp, at, am, sl, st, aa, note, pri, by_, asig, ini, updated_at, h', '']]) {
          const rows = (await env.PROD_DB.prepare(`SELECT ${cols} FROM ${t} ${where}`).all()).results || [];
          const names = cols.split(',').map(x => x.trim()), qs = names.map(() => '?').join(',');
          await env.DB.prepare(`DELETE FROM ${t}`).run();
          for (let i = 0; i < rows.length; i += 50) await env.DB.batch(rows.slice(i, i + 50).map(r => env.DB.prepare(`INSERT OR REPLACE INTO ${t} (${cols}) VALUES (${qs})`).bind(...names.map(n => r[n] ?? null))));
          out[t] = rows.length;
        }
        return J({ ok: true, copied: out });
      }
      if (p === '/api/users') {
        if (!admin) return J({ message: 'Only an admin can manage users.' }, 403);
        if (request.method === 'GET') return J({ users: env.__users, fromSecret: String(env.ALLOWED_EMAILS || '').split(',').map(x => x.split('=')[0].trim()).filter(Boolean) });
        if (request.method === 'PUT') {
          const b = await request.json();
          const users = (Array.isArray(b.users) ? b.users : []).map(u => ({ email: String(u.email || '').trim().toLowerCase(), initials: String(u.initials || '').trim().toUpperCase().slice(0, 8), role: ['viewer', 'crew'].includes(u.role) ? u.role : 'editor' })).filter(u => /^[^@\s]+@[^@\s]+$/.test(u.email) && u.initials);
          const stmts = [env.DB.prepare("DELETE FROM docs WHERE coll = 'users'")];
          for (const u of users) stmts.push(env.DB.prepare("INSERT INTO docs (coll, id, data, updated_at) VALUES ('users', ?, ?, ?)").bind(u.email, JSON.stringify({ initials: u.initials, role: u.role }), Date.now()));
          await env.DB.batch(stmts);
          USERS_CACHE.at = 0; // next request re-reads the list
          return J({ ok: true, users });
        }
      }
      if (p === '/api/chat' && request.method === 'POST') {
        if (!canWrite) return J({ message: 'Read-only access.' }, 403);
        const r = await chat(request, env, { email, initials, crew, tags: await staffTags(env, initials), name: await staffName(env, initials, email) });
        return J(r.body, r.status);
      }
      if (p === '/api/chat' && request.method === 'GET') return J({ messages: await chatHistory(env, { initials }) });
      if (p === '/api/params' || p === '/api/entries' || p.startsWith('/api/labs')) {
        const r = await entriesRoute(request, env, p, url, { initials, canWrite, crew, email });
        if (r) return r.raw || J(r.body, r.status);
      }
      if (p === '/api/moves' || p === '/api/moves/complete') {
        const r = await movesRoute(request, env, p, { initials, canWrite, crew, email });
        return J(r.body, r.status);
      }
      if (crew && (p === '/api/xl/create' || p === '/api/xl/import')) return J({ message: 'Solo Eric o Diane crean órdenes de trabajo.' }, 403);
      if (crew && p === '/api/xl/update') {
        const b = await request.clone().json().catch(() => ({}));
        if (Object.keys(b.set || {}).some(k => k !== 'ini') || /^XX$/i.test(String((b.set || {}).ini || ''))) return J({ message: 'El equipo solo marca órdenes como hechas (o las reabre). Para notas y valores usa «Anotar resultados y notas».' }, 403);
      }
      if (p.startsWith('/api/xl/')) {
        const r = await xlRoute(request, env, p, url, { initials, canWrite });
        if (p === '/api/xl/import' && r.status === 200) { try { r.body.compras = await pullPurchases(env); } catch (e) { r.body.compras = { error: String(e && e.message) }; } }
        return J(r.body, r.status);
      }
      if (p === '/api/compras/sync' && request.method === 'POST') return J(await pullPurchases(env));
      // Inventario: reads/writes the Excellovint "Inventarios" tabs directly (crew included).
      if (p === '/api/inv' && request.method === 'GET') return J(await readInventory(env));
      if ((p === '/api/inv/mov' || p === '/api/inv/item') && request.method === 'POST') {
        if (!canWrite) return J({ message: 'Read-only access.' }, 403);
        try { const b = await request.json(); return J(p === '/api/inv/mov' ? await addMovement(env, b, initials) : await saveItem(env, b)); }
        catch (e) { return J({ message: String(e && e.message || e) }, 400); }
      }
      if (p === '/api/review/lot' && request.method === 'POST') {
        if (crew || !canWrite) return J({ message: 'Solo Eric o Diane.' }, 403);
        try { return J(await reviewOne(env, url.searchParams.get('id') || '', initials)); } catch (e) { return J({ message: String(e.message || e) }, e.status || 500); }
      }
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
      // One cheap call for every collection's version: the page polls this, then pulls only what changed.
      if (p === '/api/dbver' && request.method === 'GET') {
        const { results } = await env.DB.prepare('SELECT coll, v FROM coll_ver').all();
        const etags = {}; for (const r of results) etags[r.coll] = `"${r.coll}-v${r.v}"`;
        return J({ etags });
      }
      if (p.startsWith('/api/db/')) return await dbRoute(request, env, p, canWrite, ctx, crew);
      if (p === '/api/sheets' && request.method === 'POST') {
        const { tool, args } = await request.json();
        if (!canWrite && !/^get_/.test(tool)) return J({ code: 'tool_error', message: 'Read-only access.' }, 403);
        if (crew && !/^get_/.test(tool)) { const no = await crewSheetsGuard(env, tool, args || {}); if (no) return J({ code: 'tool_error', message: no }, 403); }
        const r = await sheetsTool(env, tool, args || {});
        // A write from the calendar page: mirror that tab into the app's records right away.
        if (r.status === 200 && tool === 'update_values' && args && args.range) {
          const m = String(args.range).match(/^'((?:[^']|'')+)'!/);
          if (m && /^L\d/i.test(m[1])) ctx.waitUntil(sync(env, [m[1].replace(/''/g, "'")]).catch(() => {}));
        }
        return J(r.body, r.status);
      }
      if (p === '/api/ai' && request.method === 'POST') {
        if (!canWrite) return J({ code: 'not_granted', message: 'Read-only access.' }, 403);
        if (crew) { const b = await request.clone().json().catch(() => ({})); if (!b.json || b.stream || (b.messages || []).length > 4) return J({ code: 'not_granted', message: 'Esta función es solo para Eric y Diane.' }, 403); }
        return await ai(request, env);
      }
      if (p.startsWith('/api/')) return J({ code: 'not_found' }, 404);
    } catch (e) {
      return J({ code: 'unavailable', message: String(e && e.message || e) }, 500);
    }
    // Short link printed on barrel tags: /b/101 → the barrel's card in the Cellar section.
    const bm = p.match(/^\/b\/(\d{1,4})\/?$/);
    if (bm) return Response.redirect(url.origin + '/?b=' + bm[1] + '#cellar', 302);
    const res = await env.ASSETS.fetch(request);
    const h = new Headers(res.headers); h.set('cache-control', 'no-store'); h.set('x-robots-tag', 'noindex');
    if ((h.get('content-type') || '').includes('text/html')) {
      // One version, stored in src/version.js, stamped into every page's footer.
      let html = (await res.text()).split('__APP_VERSION__').join(VERSION_LABEL);
      if (env.STAGING === '1') html = html.replace(/<body([^>]*)>/i, '<body$1><div style="position:fixed;z-index:2147483647;top:0;left:50%;transform:translateX(-50%);background:#e0a526;color:#2b2118;font:700 11px/1 system-ui;letter-spacing:.12em;padding:4px 10px 5px;border-radius:0 0 8px 8px;pointer-events:none">STAGING · copia de prueba</div>');
      h.delete('content-length');
      return new Response(html, { status: res.status, headers: h });
    }
    return new Response(res.body, { status: res.status, headers: h });
  },
};

// ---------- app users (Settings → Users), cached per Worker instance ----------
const USERS_CACHE = { at: 0, list: [] };
async function appUserList(env) {
  if (Date.now() - USERS_CACHE.at < 60000) return USERS_CACHE.list;
  try {
    const { results } = await env.DB.prepare("SELECT id, data FROM docs WHERE coll = 'users'").all();
    USERS_CACHE.list = results.map(r => Object.assign({ email: r.id }, JSON.parse(r.data)));
    USERS_CACHE.at = Date.now();
  } catch (e) { if (!USERS_CACHE.at) USERS_CACHE.list = []; }
  return USERS_CACHE.list;
}

// ---------- db: collections of JSON docs in D1 (same shape as the artifact's shared database) ----------
// What the crew role may write. Tasks: only the fields that follow a work order (done, the order itself, its assignee/priority/date).
const CREW_COLLS = new Set(['progress', 'woqueue', 'wocache', 'labcache', 'purchases', 'barrel_log', 'trials', 'barrel_pos', 'barrel_lists']);
// Crew follow the orders Eric and Diane give: they mark tasks done (and the order link that goes with it), nothing else.
const CREW_TASK_KEYS = new Set(['done', 'wo']);
// Barrels: crew may fill in the barrel's own data (cooper, wood, toast, year made, size), not what it holds or where it sits.
// Crew keeps barrel records current: specs plus what's in it, how full, where (not delete, not new barrels).
const CREW_BARREL_KEYS = new Set(['code', 'size', 'cooperage', 'wood', 'toast', 'year', 'use', 'fill', 'lot', 'vol', 'loc', 'notes', 'status', 'confirmed', 'th', 'locName', 'by', 'acct', 'at']);
async function dbRoute(request, env, p, canWrite, ctx, crew) {
  const [, , , coll, id] = p.split('/').map(decodeURIComponent);
  if (!COLL.test(coll || '') || /^mcp_/i.test(coll)) return J({ code: 'bad_request' }, 400);
  // entries / labs / labfiles are written only through /api/entries and /api/labs (signed rows + Excellovint).
  if (request.method !== 'GET' && /^(entries|labs|labfiles|users|moves)$/.test(coll)) return J({ code: 'not_granted', message: 'Use the app forms.' }, 403);
  const m = request.method;
  if (m === 'GET' && !id) {
    // coll_ver is bumped by D1 triggers on every docs insert/update/delete: the freshness check reads 1 row, not the whole collection.
    const v = await env.DB.prepare('SELECT v FROM coll_ver WHERE coll = ?').bind(coll).first();
    const etag = `"${coll}-v${v ? v.v : 0}"`;
    // Cloudflare may weaken the ETag (W/"…") when it compresses the response; compare without the W/ prefix.
    if ((request.headers.get('if-none-match') || '').replace(/^W\//, '') === etag) return new Response(null, { status: 304, headers: { etag } });
    const { results } = await env.DB.prepare('SELECT id, data FROM docs WHERE coll = ?').bind(coll).all();
    return J({ rows: results.map(r => ({ id: r.id, data: JSON.parse(r.data) })) }, 200, { etag });
  }
  if (!ID.test(id || '')) return J({ code: 'bad_request' }, 400);
  if (!canWrite) return J({ code: 'not_granted', message: 'Read-only access.' }, 403);
  const now = Date.now();
  const planOnly = () => J({ code: 'not_granted', message: 'Solo Eric o Diane pueden cambiar el plan, los vinos, los protocolos o los ajustes.' }, 403);
  // Crew may add an older cellar wine from the barrel form (ids "w-…", new docs only).
  if (crew && coll === 'lots' && m === 'PUT' && /^w-/.test(id)) {
    const ex = await env.DB.prepare("SELECT 1 FROM docs WHERE coll = 'lots' AND id = ?").bind(id).first();
    if (ex) return planOnly();
  } else if (crew && !CREW_COLLS.has(coll) && coll !== 'tasks' && coll !== 'barrels') return planOnly();
  if (crew && coll === 'barrels' && m !== 'PATCH') return planOnly();
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
    if (crew && coll === 'barrels' && !Object.keys(body).every(k => CREW_BARREL_KEYS.has(k))) return planOnly();
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

// ---------- brand: the Dos Búhos logos, copied once from dosbuhos.com into R2 and served from here (no hotlinking) ----------
const BRAND = {
  '/brand/logo-dark.webp': 'https://dosbuhos.com/wp-content/uploads/2025/10/cropped-logo-cabecera.webp',   // dark logo, light backgrounds
  '/brand/logo-white.webp': 'https://dosbuhos.com/wp-content/uploads/2022/10/dos-buhos-logo-blanco.webp',  // white logo, dark backgrounds
};
async function brandAsset(env, p) {
  const src = BRAND[p]; if (!src) return new Response('not found', { status: 404 });
  const key = 'brand' + p.slice(6), headers = { 'content-type': 'image/webp', 'cache-control': 'public, max-age=86400' };
  if (env.LABS) { const o = await env.LABS.get(key); if (o) return new Response(o.body, { headers }); }
  let r; try { r = await fetch(src, { cf: { cacheTtl: 86400 } }); } catch (e) { r = null; }
  if (!r || !r.ok) return new Response('logo unavailable', { status: 502 });
  const buf = await r.arrayBuffer();
  if (env.LABS) { try { await env.LABS.put(key, buf, { httpMetadata: { contentType: 'image/webp' } }); } catch (e) {} }
  return new Response(buf, { headers });
}
