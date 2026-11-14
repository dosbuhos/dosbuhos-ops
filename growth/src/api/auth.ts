// Identity boundary. The Growth Terminal is served behind the Hub (apps.dosbuhos.com/growth/), which signs every
// proxied request with HMAC(SESSION_SECRET) over `${ts}.${userJson}`. Outside dev the signature is mandatory: if
// HUB_SECRET is missing the app refuses every private request (fail closed), and production has no workers.dev or
// custom route of its own, so there is no unprotected alternate hostname.
import type { Env, Role, User } from '../env.ts';

const enc = new TextEncoder();
const b64u = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64u = (s: string) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)));

export type AuthResult = { ok: true; user: User } | { ok: false; status: 401 | 503; message: string };

export async function authenticate(request: Request, env: Env, maxAgeSeconds = 300): Promise<AuthResult> {
  if (env.ENVIRONMENT === 'dev' && !request.headers.get('X-DB-User')) {
    return { ok: true, user: { email: env.DEV_USER_EMAIL || 'dev@localhost', name: 'Desarrollo local', role: 'admin' } };
  }
  if (!env.HUB_SECRET) return { ok: false, status: 503, message: 'HUB_SECRET no está configurado; las rutas privadas están desactivadas' };
  const u = request.headers.get('X-DB-User'), ts = request.headers.get('X-DB-Ts') || '', sig = request.headers.get('X-DB-Sig') || '';
  if (!u || !ts || !sig) return { ok: false, status: 401, message: 'Inicia sesión a través del Hub' };
  if (!/^\d{9,11}$/.test(ts) || Math.abs(Date.now() / 1000 - Number(ts)) > maxAgeSeconds) return { ok: false, status: 401, message: 'La firma venció' };
  let json: string;
  try { json = fromB64u(u); } catch { return { ok: false, status: 401, message: 'Encabezado de identidad inválido' }; }
  const key = await crypto.subtle.importKey('raw', enc.encode(env.HUB_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const sigBytes = (() => { try { return Uint8Array.from(atob(sig.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)); } catch { return null; } })();
  if (!sigBytes || !(await crypto.subtle.verify('HMAC', key, sigBytes, enc.encode(`${ts}.${json}`)))) return { ok: false, status: 401, message: 'Firma inválida' };
  let o: { email?: string; name?: string; role?: string; hubAdmin?: boolean };
  try { o = JSON.parse(json); } catch { return { ok: false, status: 401, message: 'Identidad inválida' }; }
  if (!o.email) return { ok: false, status: 401, message: 'Sin identidad' };
  const role: Role = o.hubAdmin || o.role === 'admin' ? 'admin' : o.role === 'editor' ? 'editor' : 'viewer';
  return { ok: true, user: { email: o.email, name: o.name ?? o.email, role } };
}

/** For tests and the Hub contract: produce headers the way the Hub's identityHeaders() does. */
export async function signForTest(secret: string, user: object, ts = Math.floor(Date.now() / 1000)): Promise<Record<string, string>> {
  const json = JSON.stringify(user);
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const s = b64u(await crypto.subtle.sign('HMAC', key, enc.encode(`${ts}.${json}`)));
  return { 'X-DB-User': btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''), 'X-DB-Ts': String(ts), 'X-DB-Sig': s };
}

/** Browser writes must be same-origin and carry the app's request header (CSRF defense in depth). */
export function checkWriteOrigin(request: Request): string | null {
  if (request.headers.get('X-Growth-Request') !== '1') return 'Falta el encabezado X-Growth-Request';
  const site = request.headers.get('Sec-Fetch-Site');
  if (site && site !== 'same-origin' && site !== 'none') return 'Solicitud entre sitios rechazada';
  const origin = request.headers.get('Origin');
  if (origin) {
    const host = request.headers.get('X-Forwarded-Host') || new URL(request.url).host;
    try { if (new URL(origin).host !== host) return 'El origen no coincide'; } catch { return 'Origen inválido'; }
  }
  return null;
}

export const can = (u: User, need: Role) => ({ viewer: 0, editor: 1, admin: 2 })[u.role] >= ({ viewer: 0, editor: 1, admin: 2 })[need];
