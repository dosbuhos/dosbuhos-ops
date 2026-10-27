// Google sign-in (OAuth 2.0 / OpenID Connect), used instead of Cloudflare Access when GOOGLE_CLIENT_ID is set.
// Only emails in ALLOWED_EMAILS, ADMIN_EMAILS or VIEWER_EMAILS (read-only) get in. Session = signed cookie, 30 days.
// Needs: var GOOGLE_CLIENT_ID, secret GOOGLE_CLIENT_SECRET; redirect URI https://<host>/auth/callback in Google Cloud.

const COOKIE = 'cel_session', STATE = 'cel_state', DAYS = 30;
const enc = new TextEncoder();
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
// Entries may carry initials: "eric@x.com=EM, diane@y.com=D".
const list = (s) => (s || '').toLowerCase().split(',').map(x => x.split('=')[0].trim()).filter(Boolean);
export function initialsFor(env, email) {
  for (const part of String(env.ALLOWED_EMAILS || '').split(',')) {
    const [e, ini] = part.split('=').map(x => (x || '').trim());
    if (e.toLowerCase() === email && ini) return ini.toUpperCase();
  }
  return (email || '?').slice(0, 2).toUpperCase();
}
export const allowedEmails = (env) => [...new Set([...list(env.ALLOWED_EMAILS), ...list(env.ADMIN_EMAILS), ...list(env.VIEWER_EMAILS)])];

async function hmac(env, data) {
  const key = await crypto.subtle.importKey('raw', enc.encode(env.SESSION_SECRET || env.GOOGLE_CLIENT_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64u(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}
function getCookie(request, name) {
  const m = (request.headers.get('Cookie') || '').match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : null;
}
const cookie = (name, value, maxAge) => `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

export async function sessionEmail(request, env) {
  const v = getCookie(request, COOKIE);
  if (!v) return null;
  const [email, exp, sig] = v.split('|');
  if (!email || !exp || Number(exp) < Date.now() / 1000) return null;
  if (sig !== await hmac(env, `${email}|${exp}`)) return null;
  return allowedEmails(env).includes(email) ? email : null; // removing someone from the list locks them out immediately
}

export function loginPage(env, url, message = '') {
  const next = url.searchParams.get('next') || '/';
  return new Response(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Entrar · Bodega Dos Búhos</title><style>
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f7f4ef;font:16px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#1f1d1b}
.box{background:#fff;border:1px solid #e6e0d8;border-radius:16px;padding:28px 22px;width:min(360px,92vw);text-align:center}
h1{font-family:Georgia,serif;font-weight:400;color:#6b2737;margin:0 0 6px}p{color:#6b6560;margin:0 0 22px}
a.g{display:flex;align-items:center;justify-content:center;gap:10px;min-height:52px;border:1px solid #cfc6bb;border-radius:12px;text-decoration:none;color:#1f1d1b;font-weight:700}
.err{color:#b42318;margin-top:16px;font-weight:600}</style></head><body><div class="box"><h1>Bodega Dos Búhos</h1><p>Calendario de bodega · acceso para el equipo</p>
<a class="g" href="/auth/google?next=${encodeURIComponent(next)}"><svg width="20" height="20" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.4 30.2 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.8 6.1C12.4 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4 7.1-10 7.1-17.5z"/><path fill="#FBBC05" d="M10.5 28.6A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.6l-7.8-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.7l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.9 2.3-8.4 2.3-6.3 0-11.6-4.2-13.5-9.9l-7.9 6.1C6.5 42.6 14.6 48 24 48z"/></svg>Entrar con Google</a>
${message ? `<div class="err">${message}</div>` : ''}</div></body></html>`, { status: message ? 403 : 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}

export async function handleAuth(request, env, url) {
  const redirectUri = `${url.origin}/auth/callback`;
  if (url.pathname === '/auth/google') {
    const state = crypto.randomUUID() + '.' + encodeURIComponent(url.searchParams.get('next') || '/');
    const q = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, redirect_uri: redirectUri, response_type: 'code', scope: 'openid email', state: state, prompt: 'select_account' });
    return new Response(null, { status: 302, headers: { location: 'https://accounts.google.com/o/oauth2/v2/auth?' + q, 'set-cookie': cookie(STATE, state, 600) } });
  }
  if (url.pathname === '/auth/callback') {
    const state = url.searchParams.get('state');
    if (!state || state !== getCookie(request, STATE)) return loginPage(env, url, 'La sesión expiró. Intenta de nuevo.');
    const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code: url.searchParams.get('code') || '', client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: redirectUri, grant_type: 'authorization_code' }) });
    const tok = await r.json();
    if (!r.ok || !tok.id_token) return loginPage(env, url, 'Google no confirmó el acceso.');
    // id_token comes straight from Google's token endpoint over TLS, so its claims can be trusted; still check audience.
    const p = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(tok.id_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))));
    const email = String(p.email || '').toLowerCase();
    if (p.aud !== env.GOOGLE_CLIENT_ID || !p.email_verified || !allowedEmails(env).includes(email)) return loginPage(env, url, `${email || 'Esa cuenta'} no tiene acceso.`);
    const exp = Math.floor(Date.now() / 1000) + DAYS * 86400;
    const next = decodeURIComponent(state.split('.').slice(1).join('.') || '/');
    const headers = new Headers({ location: next.startsWith('/') && !next.startsWith('//') ? next : '/' });
    headers.append('set-cookie', cookie(COOKIE, `${email}|${exp}|${await hmac(env, `${email}|${exp}`)}`, DAYS * 86400));
    headers.append('set-cookie', cookie(STATE, '', 0));
    return new Response(null, { status: 302, headers });
  }
  if (url.pathname === '/auth/salir') return new Response(null, { status: 302, headers: { location: '/', 'set-cookie': cookie(COOKIE, '', 0) } });
  return null;
}
export const isViewer = (env, email) => list(env.VIEWER_EMAILS).includes(email);
