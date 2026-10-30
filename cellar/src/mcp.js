// Remote MCP server: lets a person's own Claude (claude.ai, desktop, phone) use the same tools as the in-app chat.
// Connector URL: https://<host>/mcp. Sign-in is OAuth 2.1 (dynamic client registration + PKCE) on top of the app's
// Google login, so only people in the app's user list get in, with their own initials and role.
// Everything is stored in D1 (coll mcp_clients / mcp_codes / mcp_tokens); tokens are stored only as SHA-256 hashes.
import { sessionEmail, allowedEmails, initialsFor, isViewer } from './google.js';
import { TOOLS, runTool, houseNotes } from './chat.js';

const enc = new TextEncoder();
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const rand = (n = 32) => b64u(crypto.getRandomValues(new Uint8Array(n)));
const sha = async (s) => b64u(await crypto.subtle.digest('SHA-256', enc.encode(s)));
const J = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: Object.assign({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'access-control-allow-origin': '*' }, headers) });
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS', 'access-control-allow-headers': 'authorization, content-type, mcp-protocol-version, mcp-session-id', 'access-control-expose-headers': 'www-authenticate, mcp-session-id' };
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ACCESS_TTL = 30 * 86400, REFRESH_TTL = 365 * 86400, CODE_TTL = 600;
const VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const READ_TOOLS = new Set(['list_wines', 'read_tab', 'open_work_orders', 'calendar_tasks', 'protocols', 'search_chats', 'list_purchases']);

async function get(env, coll, id) {
  const r = await env.DB.prepare('SELECT data FROM docs WHERE coll = ? AND id = ?').bind(coll, id).first();
  return r ? JSON.parse(r.data) : null;
}
const put = (env, coll, id, data) => env.DB.prepare('INSERT INTO docs (coll, id, data, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(coll, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at').bind(coll, id, JSON.stringify(data), Date.now()).run();
const del = (env, coll, id) => env.DB.prepare('DELETE FROM docs WHERE coll = ? AND id = ?').bind(coll, id).run();

async function hmac(env, data) {
  const key = await crypto.subtle.importKey('raw', enc.encode(env.SESSION_SECRET || env.GOOGLE_CLIENT_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64u(await crypto.subtle.sign('HMAC', key, enc.encode('mcp|' + data)));
}
const okRedirect = (u) => { try { const x = new URL(u); return x.protocol === 'https:' || (x.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(x.hostname)); } catch (e) { return false; } };

// Routes this module answers; anything else returns null.
export async function mcpRoute(request, env, url, ctx) {
  const p = url.pathname, origin = url.origin;
  if (request.method === 'OPTIONS' && (p === '/mcp' || p.startsWith('/oauth/') || p.startsWith('/.well-known/'))) return new Response(null, { status: 204, headers: CORS });

  if (p.startsWith('/.well-known/oauth-protected-resource')) return J({ resource: origin + '/mcp', authorization_servers: [origin], bearer_methods_supported: ['header'], resource_name: 'Bodega Dos Búhos' });
  if (p.startsWith('/.well-known/oauth-authorization-server') || p.startsWith('/.well-known/openid-configuration')) return J({
    issuer: origin, authorization_endpoint: origin + '/oauth/authorize', token_endpoint: origin + '/oauth/token', registration_endpoint: origin + '/oauth/register',
    response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'], code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'], scopes_supported: ['cellar'],
  });

  if (p === '/oauth/register' && request.method === 'POST') {
    const b = await request.json().catch(() => ({}));
    const uris = Array.isArray(b.redirect_uris) ? b.redirect_uris.map(String) : [];
    if (!uris.length || !uris.every(okRedirect)) return J({ error: 'invalid_redirect_uri' }, 400);
    const id = 'c_' + rand(18);
    const client = { name: String(b.client_name || 'Claude').slice(0, 100), redirect_uris: uris.slice(0, 10), at: new Date().toISOString() };
    await put(env, 'mcp_clients', id, client);
    return J({ client_id: id, client_name: client.name, redirect_uris: client.redirect_uris, token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], client_id_issued_at: Math.floor(Date.now() / 1000) }, 201);
  }

  if (p === '/oauth/authorize') return authorize(request, env, url);
  if (p === '/oauth/token' && request.method === 'POST') return token(request, env);

  if (p === '/mcp') {
    const user = await bearerUser(request, env);
    if (!user) return new Response(JSON.stringify({ error: 'invalid_token' }), { status: 401, headers: Object.assign({ 'content-type': 'application/json', 'www-authenticate': `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"` }, CORS) });
    if (request.method === 'GET') return new Response(null, { status: 405, headers: Object.assign({ allow: 'POST' }, CORS) }); // no server-initiated stream
    if (request.method === 'DELETE') return new Response(null, { status: 204, headers: CORS });
    if (request.method !== 'POST') return new Response(null, { status: 405, headers: CORS });
    let msg; try { msg = await request.json(); } catch (e) { return J({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, 400); }
    const batch = Array.isArray(msg), out = [];
    for (const m of batch ? msg : [msg]) { const r = await rpc(env, user, m); if (r) out.push(r); }
    if (!out.length) return new Response(null, { status: 202, headers: CORS });
    return J(batch ? out : out[0]);
  }
  return null;
}

async function bearerUser(request, env) {
  const m = (request.headers.get('authorization') || '').match(/^Bearer\s+(\S+)$/i);
  if (!m) return null;
  const t = await get(env, 'mcp_tokens', 'a_' + await sha(m[1]));
  if (!t || t.exp < Date.now() / 1000) return null;
  if (!allowedEmails(env).includes(t.email)) return null; // removed from the app's users = locked out here too
  const initials = initialsFor(env, t.email);
  return { email: t.email, initials, canWrite: !isViewer(env, t.email), name: initials === 'EM' ? 'Eric' : initials === 'D' ? 'Diane' : initials === 'P/J' ? 'Paris y Jimena' : t.email };
}

// ---------- OAuth: authorize (needs the app's Google session) ----------
async function authorize(request, env, url) {
  const src = request.method === 'POST' ? new URLSearchParams(await request.text()) : url.searchParams;
  const f = Object.fromEntries(['client_id', 'redirect_uri', 'state', 'code_challenge', 'code_challenge_method', 'response_type', 'scope'].map(k => [k, src.get(k) || '']));
  const client = f.client_id && await get(env, 'mcp_clients', f.client_id);
  if (!client) return page('Conexión no válida', '<p>Esta aplicación no está registrada. Vuelve a agregar el conector en Claude.</p>', 400);
  if (!client.redirect_uris.includes(f.redirect_uri)) return page('Conexión no válida', '<p>La dirección de regreso no coincide.</p>', 400);
  const back = (params) => { const u = new URL(f.redirect_uri); for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v); if (f.state) u.searchParams.set('state', f.state); return Response.redirect(u.toString(), 302); };
  if (f.response_type !== 'code') return back({ error: 'unsupported_response_type' });
  if (!f.code_challenge || f.code_challenge_method !== 'S256') return back({ error: 'invalid_request', error_description: 'PKCE S256 required' });

  const email = await sessionEmail(request, env);
  if (!email) {
    if (request.method === 'POST') return page('Sesión expirada', '<p>Vuelve a intentar desde Claude.</p>', 401);
    return Response.redirect(url.origin + '/auth/google?next=' + encodeURIComponent(url.pathname + url.search), 302);
  }
  const sigData = [email, f.client_id, f.redirect_uri, f.code_challenge].join('|');
  if (request.method === 'POST') {
    if (src.get('csrf') !== await hmac(env, sigData)) return page('Error', '<p>La solicitud no es válida. Vuelve a intentar desde Claude.</p>', 400);
    if (src.get('ok') !== '1') return back({ error: 'access_denied' });
    const code = rand(32);
    await put(env, 'mcp_codes', 'k_' + await sha(code), { client_id: f.client_id, redirect_uri: f.redirect_uri, challenge: f.code_challenge, email, exp: Math.floor(Date.now() / 1000) + CODE_TTL });
    return back({ code });
  }
  const ini = initialsFor(env, email), csrf = await hmac(env, sigData);
  const hidden = Object.entries(f).map(([k, v]) => `<input type="hidden" name="${k}" value="${esc(v)}">`).join('') + `<input type="hidden" name="csrf" value="${esc(csrf)}">`;
  return page('Conectar Claude', `<p><b>${esc(client.name)}</b> quiere usar el calendario de bodega como <b>${esc(email)}</b> (${esc(ini)}).</p>
<p>Podrá leer Excellovint, crear y cambiar órdenes de trabajo y compras, con tus permisos.</p>
<form method="post" action="/oauth/authorize">${hidden}<button name="ok" value="1">Permitir</button><button name="ok" value="0" class="no">Cancelar</button></form>`);
}

function page(title, body, status = 200) {
  return new Response(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)} · Bodega Dos Búhos</title><style>
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f7f4ef;font:16px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#1f1d1b}
.box{background:#fff;border:1px solid #e6e0d8;border-radius:16px;padding:26px 22px;width:min(380px,92vw)}h1{font-family:Georgia,serif;font-weight:400;color:#6b2737;margin:0 0 12px}
p{color:#4a4541;line-height:1.45}form{display:flex;gap:10px;margin-top:18px}button{flex:1;min-height:50px;border-radius:12px;border:0;background:#6b2737;color:#fff;font:700 16px inherit;cursor:pointer}
button.no{background:#fff;color:#1f1d1b;border:1px solid #cfc6bb}</style></head><body><div class="box"><h1>${esc(title)}</h1>${body}</div></body></html>`,
    { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-frame-options': 'DENY' } });
}

// ---------- OAuth: token ----------
async function token(request, env) {
  const ct = request.headers.get('content-type') || '';
  const b = ct.includes('application/json') ? await request.json().catch(() => ({})) : Object.fromEntries(new URLSearchParams(await request.text()));
  const err = (e, d) => J({ error: e, error_description: d }, 400);
  let email, client_id = String(b.client_id || '');
  if (b.grant_type === 'authorization_code') {
    const key = 'k_' + await sha(String(b.code || '')), c = await get(env, 'mcp_codes', key);
    if (!c) return err('invalid_grant', 'unknown code');
    await del(env, 'mcp_codes', key); // single use
    if (c.exp < Date.now() / 1000) return err('invalid_grant', 'code expired');
    if (c.client_id !== client_id || c.redirect_uri !== String(b.redirect_uri || '')) return err('invalid_grant', 'client mismatch');
    if (await sha(String(b.code_verifier || '')) !== c.challenge) return err('invalid_grant', 'PKCE failed');
    email = c.email;
  } else if (b.grant_type === 'refresh_token') {
    const key = 'r_' + await sha(String(b.refresh_token || '')), r = await get(env, 'mcp_tokens', key);
    if (!r || r.exp < Date.now() / 1000) return err('invalid_grant', 'refresh token expired');
    if (client_id && r.client_id !== client_id) return err('invalid_grant', 'client mismatch');
    await del(env, 'mcp_tokens', key); // rotate
    email = r.email; client_id = r.client_id;
  } else return err('unsupported_grant_type');
  if (!allowedEmails(env).includes(email)) return err('invalid_grant', 'no access');
  const now = Math.floor(Date.now() / 1000), access = rand(32), refresh = rand(32);
  await put(env, 'mcp_tokens', 'a_' + await sha(access), { kind: 'access', email, client_id, exp: now + ACCESS_TTL });
  await put(env, 'mcp_tokens', 'r_' + await sha(refresh), { kind: 'refresh', email, client_id, exp: now + REFRESH_TTL });
  // Housekeeping: drop expired codes/tokens.
  try { await env.DB.prepare("DELETE FROM docs WHERE coll IN ('mcp_codes','mcp_tokens') AND CAST(json_extract(data,'$.exp') AS INTEGER) < ?").bind(now).run(); } catch (e) {}
  return J({ access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL, refresh_token: refresh, scope: 'cellar' });
}

// ---------- MCP JSON-RPC ----------
async function instructions(env, user) {
  const notes = await houseNotes(env);
  const today = new Date(Date.now() - 6 * 3600e3).toISOString().slice(0, 10);
  return `Bodega Dos Búhos cellar tools (certified organic winery, San Miguel de Allende, ~2,000 m). Signed in as ${user.name} (${user.initials}). Today in the cellar: ${today}.
Excellovint is the Google Sheet the crew works from: one tab per lot ("L08 - SE"…) plus "L00 - Winery". Columns: date, ubi (vessel), voli/volf (liters), ph, bx, tp, at (TA), am (malic), sl (free SO2), st (total SO2), aa (VA), note (ACCION = the order), pri (URGENT/HIGH/NORMAL), by, asig (who), ini (initials when done; XX = cancelled, UNDO = reopen).
Rules: use the tools for every fact; don't guess numbers. Read a tab before editing a row and say exactly what you wrote (tab + row). Work order text in Spanish, capitals, concrete numbered steps, dates day/month; write "free run" in English, never "yema"; press wine = VINO DE PRENSA. Match the ASIG style already used in that tab (P/J = Paris and Jimena). Never delete rows: cancel with ini = XX. Things to buy go on the purchases list (add_purchase), not in Excellovint. SO2: molecular = free ÷ (1 + 10^(pH − 1.81)); KMBS grams = mg/L × liters ÷ 576.
House notes (standing rules):
${notes.lines.map(l => '- ' + l.text).join('\n') || '- (none)'}`;
}

async function rpc(env, user, m) {
  if (!m || m.jsonrpc !== '2.0' || typeof m.method !== 'string') return m && m.id != null ? { jsonrpc: '2.0', id: m.id, error: { code: -32600, message: 'Invalid request' } } : null;
  const isNote = m.id == null;
  const ok = (result) => isNote ? null : { jsonrpc: '2.0', id: m.id, result };
  const fail = (code, message) => isNote ? null : { jsonrpc: '2.0', id: m.id, error: { code, message } };
  const params = m.params || {};
  switch (m.method) {
    case 'initialize': {
      const v = VERSIONS.includes(params.protocolVersion) ? params.protocolVersion : VERSIONS[0];
      return ok({ protocolVersion: v, capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'bodega-dos-buhos', title: 'Bodega Dos Búhos', version: '1.0.0' }, instructions: await instructions(env, user) });
    }
    case 'ping': return ok({});
    case 'tools/list': return ok({ tools: TOOLS.filter(t => user.canWrite || READ_TOOLS.has(t.name)).map(t => ({ name: t.name, description: t.description, inputSchema: t.input_schema, annotations: { readOnlyHint: READ_TOOLS.has(t.name) } })) });
    case 'tools/call': {
      const name = String(params.name || ''), tool = TOOLS.find(t => t.name === name);
      if (!tool) return fail(-32602, 'Unknown tool ' + name);
      if (!user.canWrite && !READ_TOOLS.has(name)) return ok({ content: [{ type: 'text', text: 'Read-only access.' }], isError: true });
      const ctx = { initials: user.initials, name: user.name, changed: false, actions: [] };
      try {
        const out = await runTool(env, ctx, name, params.arguments || {});
        const isErr = !!(out && out.error);
        if (!isErr && !READ_TOOLS.has(name)) await logAction(env, user, name, params.arguments);
        return ok({ content: [{ type: 'text', text: JSON.stringify(out).slice(0, 100000) }], isError: isErr });
      } catch (e) { return ok({ content: [{ type: 'text', text: 'Error: ' + String(e && e.message || e) }], isError: true }); }
    }
    default:
      if (m.method.startsWith('notifications/')) return null;
      if (m.method === 'resources/list') return ok({ resources: [] });
      if (m.method === 'prompts/list') return ok({ prompts: [] });
      return fail(-32601, 'Method not found');
  }
}

// Writes from outside Claude apps show in the in-app chat log ("Chats"), so there's a trail of who changed what.
async function logAction(env, user, name, args) {
  try {
    const conv = 'mcp-' + String(user.initials || 'x').replace(/[^\w]/g, '_');
    await put(env, 'chatlog', conv + '-' + Date.now() + '-tool', { conv, role: 'assistant', who: user.initials + ' (Claude)', text: name + ' ' + JSON.stringify(args || {}).slice(0, 1500), at: new Date().toISOString() });
  } catch (e) {}
}
