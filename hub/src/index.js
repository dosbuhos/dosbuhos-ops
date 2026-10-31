// Hub — the Dos Búhos command center. One sign-in (Google), one place to open every app, one admin for who gets what.
// Routes: /auth/*  sign-in · /api/*  JSON · /admin/  Hub admin pages · /<slug>/…  proxied apps · everything else = public/ assets.
import { handleAuth, loginPage, currentUser } from './auth.js';
import { api, roleFor, J } from './api.js';
import { proxy } from './proxy.js';

// Served without sign-in: the kit (the login page uses it), the logos, PWA bits.
const OPEN = /^\/(kit\/|logo-[\w-]+\.png$|icon-[\w-]+\.png$|manifest\.webmanifest$|favicon\.ico$|robots\.txt$)/;
const RESERVED = new Set(['api', 'auth', 'admin', 'kit']);

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url), p = url.pathname;
    if (p.startsWith('/auth/')) { const a = await handleAuth(request, env, url); if (a) return a; }
    if (OPEN.test(p)) return assets(request, env, 'public, max-age=3600');

    const user = await currentUser(request, env);
    const seg = p.split('/')[1] || '';

    // Proxied apps. Public apps let anyone through to their public pages; the app decides what else needs a person.
    if (seg && !RESERVED.has(seg)) {
      const app = await env.DB.prepare('SELECT slug, name, mode, binding, public, status FROM apps WHERE slug = ?').bind(seg).first();
      if (app && app.mode === 'proxy') {
        if (p === '/' + seg) return Response.redirect(url.origin + p + '/' + url.search, 302);
        const role = user ? await roleFor(env, user, app.slug) : null;
        if (!user && !app.public) return login(url);
        if (user && !role && !app.public) return denied(app.name);
        return proxy(request, env, url, app, user, role);
      }
    }

    if (!user) {
      if (p.startsWith('/api/')) return J({ code: 'revoked', message: 'Sign in again.' }, 401);
      return login(url);
    }
    if (p.startsWith('/api/')) {
      try { return await api(request, env, url, user); }
      catch (e) { return J({ code: 'unavailable', message: String(e && e.message || e) }, 500); }
    }
    if (p === '/admin' || p === '/admin.html') return Response.redirect(url.origin + '/admin/', 302);
    if (p.startsWith('/admin/')) {
      if (!user.admin) return denied('Hub admin');
      return assets(request, env, 'no-store', '/admin.html');
    }
    if (p === '/' || p === '/index.html') return assets(request, env, 'no-store', '/index.html');
    return assets(request, env);
  },
};

async function assets(request, env, cache = 'no-store', path = null) {
  const req = path ? new Request(new URL(path, request.url), { method: 'GET', headers: request.headers }) : request;
  const res = await env.ASSETS.fetch(req);
  const h = new Headers(res.headers); h.set('cache-control', cache); h.set('x-robots-tag', 'noindex');
  return new Response(res.body, { status: res.status, headers: h });
}
function login(url) {
  const next = url.pathname + url.search;
  const u = new URL(url); u.pathname = '/'; u.search = ''; u.searchParams.set('next', next);
  return loginPage(u);
}
function denied(what) {
  return new Response(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sin acceso · Dos Búhos</title>
<link rel="stylesheet" href="/kit/kit.css"></head><body class="login"><main class="login-card"><h1 class="h-display">Sin acceso</h1>
<p class="login-sub">Tu cuenta no tiene acceso a ${what}. Pide a Eric que te lo dé.</p><a class="btn" href="/">Volver al inicio</a></main></body></html>`,
    { status: 403, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}
