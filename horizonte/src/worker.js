// Horizonte — Eric's personal planner. Serves the app (static assets) and two things the app needs from
// a server: Google sign-in limited to OWNER_EMAIL, and /api/sync, which stores every device's changes in
// D1 and hands back what other devices changed. The app itself runs entirely from the device's own copy.
import { applyOp, validOp } from './merge.js';
import * as gcal from './gcal.js';

const COOKIE = 'hz_session', STATE = 'hz_state', DAYS = 60;
const enc = new TextEncoder();
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const cookie = (name, value, maxAge) => `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

const b64bytes = (str) => Uint8Array.from(atob(str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4)), c => c.charCodeAt(0));
const b64json = (str) => JSON.parse(new TextDecoder().decode(b64bytes(str)));
const newSid = () => b64u(crypto.getRandomValues(new Uint8Array(32)));

// Verifies a Google ID token (from the Sign in with Google button) against Google's public keys. No client secret needed.
async function verifyGoogleIdToken(token, clientId) {
  const [h, p, sig] = String(token).split('.');
  if (!h || !p || !sig) throw new Error('malformed token');
  const header = b64json(h), payload = b64json(p);
  const jwks = await (await fetch('https://www.googleapis.com/oauth2/v3/certs', { cf: { cacheTtl: 3600, cacheEverything: true } })).json();
  const jwk = (jwks.keys || []).find(k => k.kid === header.kid);
  if (!jwk || header.alg !== 'RS256') throw new Error('unknown signing key');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  if (!await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64bytes(sig), enc.encode(`${h}.${p}`))) throw new Error('bad signature');
  if (payload.aud !== clientId) throw new Error('wrong audience');
  if (!['accounts.google.com', 'https://accounts.google.com'].includes(payload.iss)) throw new Error('wrong issuer');
  if (!(payload.exp * 1000 > Date.now())) throw new Error('expired');
  return payload;
}
async function startSession(request, env, email) {
  const sid = newSid();
  await env.DB.prepare('INSERT INTO sessions (id, email, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .bind(sid, email, Date.now(), Date.now() + DAYS * 864e5).run();
  return cookie(COOKIE, sid, DAYS * 86400);
}
function getCookie(request, name) {
  const m = (request.headers.get('Cookie') || '').match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : null;
}

async function currentUser(request, env) {
  if (env.DEV_USER && /^(localhost|127\.0\.0\.1)$/.test(new URL(request.url).hostname)) return { email: env.DEV_USER };
  const sid = getCookie(request, COOKIE);
  if (!sid || sid.length < 40) return null;
  const row = await env.DB.prepare('SELECT email FROM sessions WHERE id = ? AND expires_at > ?').bind(sid, Date.now()).first();
  if (!row || row.email !== String(env.OWNER_EMAIL).toLowerCase()) return null;
  return { email: row.email, sid };
}

function page(msg) {
  return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Horizonte</title>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;font:16px system-ui,sans-serif;color:#16181D;background:#fff">
<div style="max-width:340px;padding:24px;text-align:center"><p>${msg}</p><p><a href="/" style="color:#1D4ED8">Back to Horizonte</a></p></div>`,
    { status: 403, headers: { 'content-type': 'text/html; charset=utf-8' } });
}

async function auth(request, env, url) {
  const redirectUri = `${url.origin}/auth/callback`;
  if (url.pathname === '/auth/google') {
    if (!env.GOOGLE_CLIENT_SECRET) return page('Sign-in is not set up yet: the GOOGLE_CLIENT_SECRET secret is missing.');
    const state = crypto.randomUUID();
    const q = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, redirect_uri: redirectUri, response_type: 'code', scope: 'openid email profile', state, prompt: 'select_account', login_hint: env.OWNER_EMAIL });
    return new Response(null, { status: 302, headers: { location: 'https://accounts.google.com/o/oauth2/v2/auth?' + q, 'set-cookie': cookie(STATE, state, 600) } });
  }
  if (url.pathname === '/auth/callback') {
    const state = url.searchParams.get('state');
    if (!state || state !== getCookie(request, STATE)) return page('The sign-in expired. Try again.');
    const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code: url.searchParams.get('code') || '', client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: redirectUri, grant_type: 'authorization_code' }) });
    const tok = await r.json();
    if (!r.ok || !tok.id_token) return page(`Google did not confirm the sign-in (${tok.error || r.status}).`);
    const p = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(tok.id_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))));
    const email = String(p.email || '').toLowerCase();
    if (p.aud !== env.GOOGLE_CLIENT_ID || !p.email_verified || email !== String(env.OWNER_EMAIL).toLowerCase()) return page(`${email || 'This account'} can't use Horizonte.`);
    const headers = new Headers({ location: '/' });
    headers.append('set-cookie', await startSession(request, env, email));
    headers.append('set-cookie', cookie(STATE, '', 0));
    return new Response(null, { status: 302, headers });
  }
  if (url.pathname === '/auth/gsi' && request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    let p; try { p = await verifyGoogleIdToken(body.credential, env.GOOGLE_CLIENT_ID); } catch (e) { return json({ error: `Google sign-in failed (${e.message})` }, 401); }
    const email = String(p.email || '').toLowerCase();
    if (!p.email_verified || email !== String(env.OWNER_EMAIL).toLowerCase()) return json({ error: `${email || 'This account'} can't use Horizonte.` }, 403);
    return new Response(JSON.stringify({ email }), { headers: { 'content-type': 'application/json', 'set-cookie': await startSession(request, env, email) } });
  }
  if (url.pathname === '/auth/logout') {
    const v = getCookie(request, COOKIE);
    if (v) await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(v).run();
    return new Response(null, { status: 302, headers: { location: '/', 'set-cookie': cookie(COOKIE, '', 0) } });
  }
  return null;
}

async function applyOps(env, ops) {
  for (const op of ops) {
    if (!validOp(op)) continue;
    const row = await env.DB.prepare('SELECT data, vers FROM rec WHERE kind = ? AND id = ?').bind(op.k, op.id).first();
    const cur = row ? { data: JSON.parse(row.data), vers: JSON.parse(row.vers) } : null;
    const next = applyOp(cur, op);
    if (!next.changed) continue;
    const { v: seq } = await env.DB.prepare("UPDATE counter SET v = v + 1 WHERE name = 'seq' RETURNING v").first();
    await env.DB.prepare('INSERT INTO rec (kind, id, data, vers, seq) VALUES (?, ?, ?, ?, ?) ON CONFLICT (kind, id) DO UPDATE SET data = excluded.data, vers = excluded.vers, seq = excluded.seq')
      .bind(op.k, op.id, JSON.stringify(next.data), JSON.stringify(next.vers), seq).run();
  }
}

// POST /api/sync { ops: [{k, id, f, t}], cursor } → { cursor, changes: [{k, id, d}] }
async function sync(request, env, ctx) {
  const body = await request.json().catch(() => null);
  if (!body || !Array.isArray(body.ops) || body.ops.length > 500) return json({ error: 'bad request' }, 400);
  await applyOps(env, body.ops);
  if (env.GOOGLE_CLIENT_SECRET) {
    const touched = body.ops.filter(o => o && o.k === 'task' && typeof o.id === 'string').map(o => o.id);
    if (touched.length) ctx.waitUntil(gcal.pushTasks(env, touched, applyOps).catch(e => console.log('gcal push', e.message)));
    try { await gcal.pull(env, applyOps); } catch (e) { console.log('gcal pull', e.message); }
  }
  const cursor = Number(body.cursor) || 0;
  const { results } = await env.DB.prepare('SELECT kind, id, data, seq FROM rec WHERE seq > ? ORDER BY seq LIMIT 2000').bind(cursor).all();
  const last = results.length ? results[results.length - 1].seq : cursor;
  return json({ cursor: last, more: results.length === 2000, changes: results.map(r => ({ k: r.kind, id: r.id, d: JSON.parse(r.data) })) });
}

// POST /api/import { ops } with header x-import-token: a one-time bulk import (Timestripe), sent from the browser tab that
// holds the data. Only works while a matching, unexpired row exists in import_tokens.
const IMPORT_ORIGINS = ['https://timestripe.com'];
async function importOps(request, env) {
  const origin = request.headers.get('origin') || '';
  const cors = { 'access-control-allow-origin': IMPORT_ORIGINS.includes(origin) ? origin : 'null', 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type, x-import-token', vary: 'origin' };
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  const tok = request.headers.get('x-import-token') || '';
  const ok = tok.length >= 32 && await env.DB.prepare('SELECT 1 FROM import_tokens WHERE token = ? AND expires_at > ?').bind(tok, Date.now()).first();
  if (!ok) return new Response('{"error":"forbidden"}', { status: 403, headers: { ...cors, 'content-type': 'application/json' } });
  const body = await request.json().catch(() => null);
  if (!body || !Array.isArray(body.ops) || body.ops.length > 500) return new Response('{"error":"bad request"}', { status: 400, headers: cors });
  await applyOps(env, body.ops);
  return new Response(JSON.stringify({ ok: true, n: body.ops.length }), { headers: { ...cors, 'content-type': 'application/json' } });
}

export default {
  async scheduled(event, env, ctx) { if (env.GOOGLE_CLIENT_SECRET) ctx.waitUntil(gcal.pull(env, applyOps, { force: true }).catch(e => console.log('cron pull', e.message))); },
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/auth/')) return (await auth(request, env, url)) || new Response('Not found', { status: 404 });
    if (url.pathname === '/api/import') return importOps(request, env);
    if (url.pathname.startsWith('/api/')) {
      const user = await currentUser(request, env).catch(() => null);
      if (url.pathname === '/api/me') return json(user ? { email: user.email } : { email: null, setup: true, clientId: env.GOOGLE_CLIENT_ID }, user ? 200 : 401);
      if (!user) return json({ error: 'sign in' }, 401);
      if (url.pathname === '/api/sync' && request.method === 'POST') return sync(request, env, ctx);
      if (url.pathname === '/api/gcal' && request.method === 'GET') {
        const row = await gcal.gcalRow(env);
        return json({ available: !!env.GOOGLE_CLIENT_SECRET, connected: !!row?.refresh_token, email: row?.email || null, clientId: env.GOOGLE_CLIENT_ID });
      }
      if (url.pathname === '/api/gcal/connect' && request.method === 'POST') {
        if (!env.GOOGLE_CLIENT_SECRET) return json({ error: 'Calendar link needs the GOOGLE_CLIENT_SECRET secret in Cloudflare.' }, 400);
        const { code } = await request.json().catch(() => ({}));
        try { const email = await gcal.connect(env, String(code || '')); await gcal.pull(env, applyOps, { force: true }).catch(e => console.log('first pull', e.message));
          const ids = (await env.DB.prepare("SELECT id FROM rec WHERE kind = 'task' AND json_extract(data, '$.kind') = 'meeting' AND COALESCE(json_extract(data, '$.gev'), '') = ''").all()).results.map(r => r.id);
          if (ids.length) ctx.waitUntil(gcal.pushTasks(env, ids, applyOps));
          return json({ ok: true, email }); }
        catch (e) { return json({ error: e.message }, 400); }
      }
      if (url.pathname === '/api/gcal/disconnect' && request.method === 'POST') { await env.DB.prepare('DELETE FROM gcal WHERE id = 1').run(); return json({ ok: true }); }
      return json({ error: 'not found' }, 404);
    }
    return env.ASSETS.fetch(request);
  },
};
