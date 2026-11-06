// Cotizador de eventos — static app behind a PIN (secret PIN) or the Hub's signed header (secret HUB_SECRET).
import { hubUser } from './hub-auth.js';

const enc = new TextEncoder();
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
async function sign(msg, secret) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64u(await crypto.subtle.sign('HMAC', key, enc.encode(msg)));
}
function cookie(req, name) { const m = (req.headers.get('cookie') || '').match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)')); return m ? m[1] : ''; }
const json = (o, status = 200, extra = {}) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', ...extra } });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const locked = !!env.PIN;
    let ok = !locked;
    if (locked) {
      if (cookie(request, 'cz') === await sign('ok', env.PIN)) ok = true;
      else if (await hubUser(request, env)) ok = true;   // proxied through the Hub, signed with HUB_SECRET
    }
    if (url.pathname === '/login' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      if (!locked || String(body.pin || '') === String(env.PIN)) {
        const tok = await sign('ok', env.PIN || 'open');
        return json({ ok: true }, 200, { 'set-cookie': `cz=${tok}; Path=/; Max-Age=15552000; HttpOnly; Secure; SameSite=Lax` });
      }
      return json({ ok: false }, 401);
    }
    if (url.pathname === '/me') return json({ locked: locked && !ok });
    if (!ok && (url.pathname === '/' || url.pathname === '/index.html' || url.pathname === '/sw.js')) {
      return env.ASSETS.fetch(new Request(new URL('/gate.html', request.url), request));
    }
    return env.ASSETS.fetch(request);
  },
};
