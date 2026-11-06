// Drop-in for an app behind the Hub. Copy this file into the app and call hubUser(request, env) at the top of fetch().
//
//   import { hubUser, withPrefix } from './hub-auth.js';
//   const who = await hubUser(request, env);   // { email, name, role, hubAdmin } or null
//   if (!who) return new Response('Sign in through the Hub', { status: 401 });
//   const prefix = withPrefix(request);        // '/cellar' — put it in front of absolute links and fetch() URLs
//
// The Hub signs every proxied request with SESSION_SECRET: give the app the same value as secret HUB_SECRET and the
// signature is checked; without HUB_SECRET the header is trusted as-is, which is only safe once the app's workers.dev
// address is off ("workers_dev": false) so the service binding is the only way in.

const enc = new TextEncoder();
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64u = (s) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)));

export async function hubUser(request, env, maxAgeSeconds = 300) {
  const u = request.headers.get('X-DB-User');
  if (!u) return null;
  const json = fromB64u(u);
  if (env.HUB_SECRET) {
    const ts = request.headers.get('X-DB-Ts') || '', sig = request.headers.get('X-DB-Sig') || '';
    if (!ts || Math.abs(Date.now() / 1000 - Number(ts)) > maxAgeSeconds) return null;
    const key = await crypto.subtle.importKey('raw', enc.encode(env.HUB_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const want = b64u(await crypto.subtle.sign('HMAC', key, enc.encode(`${ts}.${json}`)));
    if (want !== sig) return null;
  }
  try { const o = JSON.parse(json); return o && o.email ? o : null; } catch { return null; }
}

// '/cellar' when served through the Hub, '' when opened directly.
export const withPrefix = (request) => request.headers.get('X-DB-Prefix') || '';
