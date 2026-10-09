// Identity comes from Cloudflare Access: every request reaching the Worker carries a signed JWT
// (Cf-Access-Jwt-Assertion). We verify it against the team's public keys, then map the email to a role.

let certCache = { at: 0, keys: null };

function b64urlToBytes(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}

async function accessKeys(team) {
  if (certCache.keys && Date.now() - certCache.at < 3600_000) return certCache.keys;
  const r = await fetch(`https://${team}/cdn-cgi/access/certs`);
  if (!r.ok) throw new Error('No se pudieron leer las llaves de Cloudflare Access');
  const { keys } = await r.json();
  certCache = { at: Date.now(), keys };
  return keys;
}

async function verifyAccessJwt(token, env) {
  const [h, p, s] = token.split('.');
  if (!h || !p || !s) return null;
  const header = JSON.parse(new TextDecoder().decode(b64urlToBytes(h)));
  const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(p)));
  const keys = await accessKeys(env.ACCESS_TEAM_DOMAIN);
  const jwk = keys.find(k => k.kid === header.kid);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlToBytes(s), new TextEncoder().encode(`${h}.${p}`));
  if (!ok) return null;
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now) return null;
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (env.ACCESS_AUD && !aud.includes(env.ACCESS_AUD)) return null;
  return payload.email ? String(payload.email).toLowerCase() : null;
}

export async function identify(request, env) {
  let email = null;
  if (env.ACCESS_TEAM_DOMAIN) {
    const token = request.headers.get('Cf-Access-Jwt-Assertion');
    if (token) {
      try { email = await verifyAccessJwt(token, env); } catch (e) { email = null; }
    }
  } else if (env.DEV_USER) {
    // Local development only: no Access in front of the Worker.
    const url = new URL(request.url);
    email = (url.searchParams.get('as') || request.headers.get('x-dev-user') || cookie(request, 'devuser') || env.DEV_USER).toLowerCase();
  }
  if (!email) return null;
  const admins = (env.ADMIN_EMAILS || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
  const rep = await env.DB.prepare('SELECT * FROM reps WHERE lower(email)=? AND active=1').bind(email).first();
  return { email, isAdmin: admins.includes(email), rep };
}

function cookie(request, name) {
  const c = request.headers.get('Cookie') || '';
  const m = c.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : null;
}
