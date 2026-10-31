// /<slug>/… → that app's Worker over its service binding, with the signed identity headers. The app sees the path
// without the prefix (so its routes stay as they are) and X-DB-Prefix = '/<slug>' for the links it renders.
import { identityHeaders, COOKIE } from './auth.js';

const HOP = ['connection', 'keep-alive', 'transfer-encoding', 'te', 'trailer', 'upgrade', 'proxy-authorization', 'proxy-authenticate'];

export async function proxy(request, env, url, app, user, role) {
  const svc = env[app.binding];
  if (!svc) return new Response(`No binding ${app.binding} for ${app.slug}`, { status: 502 });
  const prefix = '/' + app.slug;
  const target = new URL(request.url);
  target.pathname = url.pathname.slice(prefix.length) || '/';
  const headers = new Headers(request.headers);
  for (const h of HOP) headers.delete(h);
  headers.delete('x-db-user'); headers.delete('x-db-sig'); headers.delete('x-db-ts');
  // The Hub's own cookie is not the app's business.
  const cookies = (request.headers.get('cookie') || '').split(/;\s*/).filter(c => c && !c.startsWith(COOKIE + '=') && !c.startsWith('hub_state='));
  if (cookies.length) headers.set('cookie', cookies.join('; ')); else headers.delete('cookie');
  headers.set('X-DB-Prefix', prefix);
  headers.set('X-DB-App', app.slug);
  if (user) for (const [k, v] of Object.entries(await identityHeaders(env, user, role))) headers.set(k, v);
  const init = { method: request.method, headers, redirect: 'manual' };
  if (!['GET', 'HEAD'].includes(request.method)) init.body = request.body;
  const res = await svc.fetch(new Request(target, init));
  const out = new Headers(res.headers);
  // Absolute redirects and cookies the app sets at '/' are re-rooted under its prefix.
  const loc = out.get('location');
  if (loc && loc.startsWith('/') && !loc.startsWith('//')) out.set('location', prefix + loc);
  const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  if (setCookies.length) {
    out.delete('set-cookie');
    for (const c of setCookies) out.append('set-cookie', c.replace(/;\s*Path=\/(?=;|$)/i, `; Path=${prefix}/`));
  }
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: out });
}
