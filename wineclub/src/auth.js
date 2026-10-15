// Identity comes from Cloudflare Access. Every request that reaches the Worker through Access carries a
// signed JWT (Cf-Access-Jwt-Assertion); we verify it against the team's public keys and this app's AUD tag.
// Without ACCESS_AUD configured the app stays locked — it never serves member data unauthenticated.
// Anyone the Access policy lets in is staff; ADMIN_EMAILS are managers.

let certCache = { at: 0, team: null, keys: null };

function b64urlToBytes(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Uint8Array.from(atob(s), c => c.charCodeAt(0));
}
const decodeJson = (part) => JSON.parse(new TextDecoder().decode(b64urlToBytes(part)));

async function accessKeys(team) {
  if (certCache.keys && certCache.team === team && Date.now() - certCache.at < 3600_000) return certCache.keys;
  const r = await fetch(`https://${team}/cdn-cgi/access/certs`);
  if (!r.ok) throw new Error('Could not read Cloudflare Access keys');
  const { keys } = await r.json();
  certCache = { at: Date.now(), team, keys };
  return keys;
}

async function verifyAccessJwt(token, env) {
  const [h, p, s] = token.split('.');
  if (!h || !p || !s) return null;
  const header = decodeJson(h), payload = decodeJson(p);
  const jwk = (await accessKeys(env.ACCESS_TEAM_DOMAIN)).find(k => k.kid === header.kid);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlToBytes(s), new TextEncoder().encode(`${h}.${p}`));
  if (!ok) return null;
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now) return null;
  if (payload.iss && payload.iss !== `https://${env.ACCESS_TEAM_DOMAIN}`) return null;
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(env.ACCESS_AUD)) return null;
  return payload.email ? String(payload.email).toLowerCase() : null;
}

// Returns { email, isManager } | { locked: true } | null
export async function identify(request, env) {
  let email = null;
  if (env.ACCESS_TEAM_DOMAIN) {
    if (!env.ACCESS_AUD) return { locked: true };
    const token = request.headers.get('Cf-Access-Jwt-Assertion');
    if (token) {
      try { email = await verifyAccessJwt(token, env); } catch { email = null; }
    }
  } else if (env.DEV_USER) {
    // Local development only (wrangler dev): no Access in front of the Worker.
    const c = (request.headers.get('Cookie') || '').match(/(?:^|; )devuser=([^;]*)/);
    email = (new URL(request.url).searchParams.get('as') || (c && decodeURIComponent(c[1])) || env.DEV_USER).toLowerCase();
  }
  if (!email) return null;
  const managers = (env.ADMIN_EMAILS || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
  return { email, isManager: managers.includes(email) };
}
