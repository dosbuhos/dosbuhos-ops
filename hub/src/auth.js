// Google sign-in (OAuth 2.0 / OpenID Connect) and Hub sessions.
// Who gets in: anyone in the users table with active = 1, plus the HUB_ADMIN_EMAILS secret (created as admins on first sign-in).
// Session = a row in D1 plus a signed cookie that names it, 30 days; removing the row or deactivating the user locks them out at once.
// Needs: var GOOGLE_CLIENT_ID, secrets GOOGLE_CLIENT_SECRET and SESSION_SECRET; redirect URI https://<host>/auth/callback in Google Cloud.

export const COOKIE = 'hub_session';
const STATE = 'hub_state', DAYS = 30;
const enc = new TextEncoder();
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const list = (s) => String(s || '').toLowerCase().split(',').map(x => x.trim()).filter(Boolean);

export async function hmac(env, data) {
  const key = await crypto.subtle.importKey('raw', enc.encode(env.SESSION_SECRET || env.GOOGLE_CLIENT_SECRET || 'dev'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64u(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}
export function getCookie(request, name) {
  const m = (request.headers.get('Cookie') || '').match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : null;
}
const cookie = (name, value, maxAge) => `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

export async function audit(env, actor, action, target = '', detail = '') {
  await env.DB.prepare('INSERT INTO audit_log (at, actor, action, target, detail) VALUES (?, ?, ?, ?, ?)')
    .bind(Date.now(), actor, action, target, typeof detail === 'string' ? detail : JSON.stringify(detail)).run();
}

// The signed-in person, or null. { email, name, admin, sid }
export async function currentUser(request, env) {
  const v = getCookie(request, COOKIE);
  if (!v) return null;
  const [sid, exp, sig] = v.split('|');
  if (!sid || !exp || Number(exp) < Date.now() / 1000) return null;
  if (sig !== await hmac(env, `${sid}|${exp}`)) return null;
  const row = await env.DB.prepare(
    'SELECT s.id sid, u.email, u.name, u.is_admin FROM sessions s JOIN users u ON u.email = s.email WHERE s.id = ? AND s.expires_at > ? AND u.active = 1'
  ).bind(sid, Date.now()).first();
  if (!row) return null;
  return { email: row.email, name: row.name, admin: row.is_admin === 1, sid: row.sid };
}

async function userFor(env, email, name) {
  const admins = list(env.HUB_ADMIN_EMAILS);
  let u = await env.DB.prepare('SELECT email, name, is_admin, active FROM users WHERE email = ?').bind(email).first();
  if (!u && admins.includes(email)) {
    await env.DB.prepare('INSERT INTO users (email, name, is_admin, active, created_at) VALUES (?, ?, 1, 1, ?)').bind(email, name || '', Date.now()).run();
    u = { email, name: name || '', is_admin: 1, active: 1 };
  }
  if (!u || u.active !== 1) return null;
  // Keep the admin flag in step with the secret, and fill in a missing name from Google.
  const isAdmin = admins.includes(email) ? 1 : u.is_admin;
  await env.DB.prepare('UPDATE users SET last_login = ?, is_admin = ?, name = CASE WHEN name = \'\' THEN ? ELSE name END WHERE email = ?')
    .bind(Date.now(), isAdmin, name || '', email).run();
  return u;
}

export function loginPage(url, message = '') {
  const next = url.searchParams.get('next') || '/';
  return new Response(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Entrar · Dos Búhos</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600&family=IBM+Plex+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/kit/kit.css"><link rel="icon" href="/icon-192.png"></head>
<body class="login"><main class="login-card">
<img class="login-logo wordmark-img" src="/logo-word.png" alt="dos búhos" width="730" height="160">
<p class="login-sub">Las herramientas del equipo, en un solo lugar.</p>
<a class="btn btn-google" href="/auth/google?next=${encodeURIComponent(next)}"><svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.4 30.2 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.8 6.1C12.4 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4 7.1-10 7.1-17.5z"/><path fill="#FBBC05" d="M10.5 28.6A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.6l-7.8-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.7l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.9 2.3-8.4 2.3-6.3 0-11.6-4.2-13.5-9.9l-7.9 6.1C6.5 42.6 14.6 48 24 48z"/></svg>Entrar con Google</a>
${message ? `<p class="login-err">${message}</p>` : ''}
</main></body></html>`, { status: message ? 403 : 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}

export async function handleAuth(request, env, url) {
  const redirectUri = `${url.origin}/auth/callback`;
  if (url.pathname === '/auth/google') {
    const state = crypto.randomUUID() + '.' + encodeURIComponent(url.searchParams.get('next') || '/');
    const q = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, redirect_uri: redirectUri, response_type: 'code', scope: 'openid email profile', state, prompt: 'select_account' });
    return new Response(null, { status: 302, headers: { location: 'https://accounts.google.com/o/oauth2/v2/auth?' + q, 'set-cookie': cookie(STATE, state, 600) } });
  }
  if (url.pathname === '/auth/callback') {
    const state = url.searchParams.get('state');
    if (!state || state !== getCookie(request, STATE)) return loginPage(url, 'La sesión expiró. Intenta de nuevo.');
    const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code: url.searchParams.get('code') || '', client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: redirectUri, grant_type: 'authorization_code' }) });
    const tok = await r.json();
    if (!r.ok || !tok.id_token) { console.log('google token exchange failed', r.status, tok.error, tok.error_description); return loginPage(url, `Google no confirmó el acceso (${tok.error || r.status}).`); }
    // id_token comes straight from Google's token endpoint over TLS, so its claims can be trusted; still check audience.
    const p = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(tok.id_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))));
    const email = String(p.email || '').toLowerCase();
    if (p.aud !== env.GOOGLE_CLIENT_ID || !p.email_verified || !email) return loginPage(url, 'Google no confirmó el acceso.');
    const u = await userFor(env, email, String(p.name || ''));
    if (!u) { await audit(env, email, 'login.denied'); return loginPage(url, `${email} no tiene acceso. Pide a Eric que te agregue.`); }
    const sid = crypto.randomUUID();
    const exp = Math.floor(Date.now() / 1000) + DAYS * 86400;
    await env.DB.prepare('INSERT INTO sessions (id, email, created_at, expires_at, ua) VALUES (?, ?, ?, ?, ?)')
      .bind(sid, email, Date.now(), exp * 1000, (request.headers.get('user-agent') || '').slice(0, 200)).run();
    await audit(env, email, 'login');
    const next = decodeURIComponent(state.split('.').slice(1).join('.') || '/');
    const headers = new Headers({ location: next.startsWith('/') && !next.startsWith('//') ? next : '/' });
    headers.append('set-cookie', cookie(COOKIE, `${sid}|${exp}|${await hmac(env, `${sid}|${exp}`)}`, DAYS * 86400));
    headers.append('set-cookie', cookie(STATE, '', 0));
    return new Response(null, { status: 302, headers });
  }
  // Setup check: shows the shape of the sign-in settings (never their values) so a bad paste is easy to spot.
  if (url.pathname === '/auth/check') {
    const sec = String(env.GOOGLE_CLIENT_SECRET || '');
    const lines = [
      `client id: ${env.GOOGLE_CLIENT_ID || '(missing)'}`,
      `client secret: ${sec ? `${sec.slice(0, 7)}… ${sec.length} characters${/\s/.test(sec) ? ' — CONTAINS A SPACE OR LINE BREAK' : ''}${sec.startsWith('GOCSPX-') ? '' : ' — does not start with GOCSPX-'}` : '(missing)'}`,
      `session secret: ${env.SESSION_SECRET ? `set, ${String(env.SESSION_SECRET).length} characters` : '(missing)'}`,
      `hub admins: ${env.HUB_ADMIN_EMAILS ? `${String(env.HUB_ADMIN_EMAILS).split(',').length} set` : '(missing)'}`,
      `redirect URI to register in Google: ${url.origin}/auth/callback`,
    ];
    return new Response(lines.join('\n'), { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
  }
  if (url.pathname === '/auth/salir' || url.pathname === '/auth/logout') {
    const v = getCookie(request, COOKIE);
    if (v) { const sid = v.split('|')[0]; const s = await env.DB.prepare('SELECT email FROM sessions WHERE id = ?').bind(sid).first(); await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(sid).run(); if (s) await audit(env, s.email, 'logout'); }
    return new Response(null, { status: 302, headers: { location: '/', 'set-cookie': cookie(COOKIE, '', 0) } });
  }
  return null;
}

// What an app receives on every proxied request: who this is and what they may do in that app.
// X-DB-User = base64url(JSON), X-DB-Sig = HMAC(ts + '.' + json) with SESSION_SECRET, X-DB-Ts = ts. See lib/hub-auth.js.
export async function identityHeaders(env, user, role) {
  const json = JSON.stringify({ email: user.email, name: user.name, role, hubAdmin: user.admin });
  const ts = String(Math.floor(Date.now() / 1000));
  return { 'X-DB-User': b64u(enc.encode(json)), 'X-DB-Ts': ts, 'X-DB-Sig': await hmac(env, `${ts}.${json}`) };
}
