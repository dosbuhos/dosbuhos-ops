// JSON API. /api/me and /api/home for everyone signed in; /api/admin/* for Hub admins.
import { audit } from './auth.js';

export const J = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const ROLES = new Set(['admin', 'editor', 'viewer']);
const STATUS = new Set(['live', 'import', 'soon', 'hub']);
const MODES = new Set(['link', 'proxy', 'internal']);
const SLUG = /^[a-z][a-z0-9-]{0,40}$/;

// Hub admins are admins in every app; others get the role of their grant.
export async function roleFor(env, user, slug) {
  if (user.admin) return 'admin';
  const g = await env.DB.prepare('SELECT role FROM grants WHERE email = ? AND slug = ?').bind(user.email, slug).first();
  return g ? g.role : null;
}

export async function api(request, env, url, user) {
  const p = url.pathname, m = request.method;
  const body = async () => { try { return await request.json(); } catch { return {}; } };

  if (p === '/api/me') return J({ email: user.email, name: user.name, admin: user.admin });

  if (p === '/api/home') {
    const sections = (await env.DB.prepare('SELECT slug, name FROM sections ORDER BY sort').all()).results;
    let apps;
    if (user.admin) {
      apps = (await env.DB.prepare('SELECT a.slug, a.name, a.section, a.description, a.status, a.mode, a.url, a.public, a.sort FROM apps a JOIN sections s ON s.slug = a.section ORDER BY s.sort, a.sort').all()).results
        .map(a => ({ ...a, role: 'admin' }));
    } else {
      apps = (await env.DB.prepare('SELECT a.slug, a.name, a.section, a.description, a.status, a.mode, a.url, a.public, a.sort, g.role FROM apps a JOIN grants g ON g.slug = a.slug JOIN sections s ON s.slug = a.section WHERE g.email = ? ORDER BY s.sort, a.sort')
        .bind(user.email).all()).results;
    }
    return J({ sections, apps: apps.map(a => ({ ...a, href: hrefFor(a) })) });
  }

  if (!p.startsWith('/api/admin/')) return J({ code: 'not_found' }, 404);
  if (!user.admin) return J({ code: 'not_granted', message: 'Only a Hub admin can do that.' }, 403);

  if (p === '/api/admin/users' && m === 'GET') {
    const users = (await env.DB.prepare('SELECT email, name, is_admin, active, created_at, last_login FROM users ORDER BY name, email').all()).results;
    const grants = (await env.DB.prepare('SELECT email, slug, role FROM grants').all()).results;
    for (const u of users) u.grants = grants.filter(g => g.email === u.email).map(g => ({ slug: g.slug, role: g.role }));
    return J({ users });
  }
  if (p === '/api/admin/users' && m === 'POST') {
    const b = await body();
    const email = String(b.email || '').trim().toLowerCase();
    if (!EMAIL.test(email)) return J({ code: 'bad_request', message: 'That is not an email address.' }, 400);
    const exists = await env.DB.prepare('SELECT email FROM users WHERE email = ?').bind(email).first();
    if (exists) return J({ code: 'exists', message: `${email} is already on the list.` }, 409);
    await env.DB.prepare('INSERT INTO users (email, name, is_admin, active, created_at) VALUES (?, ?, ?, 1, ?)')
      .bind(email, String(b.name || '').trim().slice(0, 80), b.is_admin ? 1 : 0, Date.now()).run();
    await audit(env, user.email, 'user.add', email, { name: b.name || '', is_admin: !!b.is_admin });
    return J({ ok: true, email });
  }
  let um = p.match(/^\/api\/admin\/users\/([^/]+)$/);
  if (um) {
    const email = decodeURIComponent(um[1]).toLowerCase();
    const u = await env.DB.prepare('SELECT email, name, is_admin, active FROM users WHERE email = ?').bind(email).first();
    if (!u) return J({ code: 'not_found' }, 404);
    if (m === 'PATCH') {
      const b = await body();
      const name = 'name' in b ? String(b.name || '').trim().slice(0, 80) : u.name;
      const isAdmin = 'is_admin' in b ? (b.is_admin ? 1 : 0) : u.is_admin;
      const active = 'active' in b ? (b.active ? 1 : 0) : u.active;
      if (email === user.email && (!isAdmin || !active)) return J({ code: 'bad_request', message: 'You cannot lock yourself out.' }, 400);
      await env.DB.prepare('UPDATE users SET name = ?, is_admin = ?, active = ? WHERE email = ?').bind(name, isAdmin, active, email).run();
      if (!active) await env.DB.prepare('DELETE FROM sessions WHERE email = ?').bind(email).run();
      const changed = {};
      if (name !== u.name) changed.name = name;
      if (isAdmin !== u.is_admin) changed.is_admin = !!isAdmin;
      if (active !== u.active) changed.active = !!active;
      if (Object.keys(changed).length) await audit(env, user.email, 'user.update', email, changed);
      return J({ ok: true });
    }
    if (m === 'DELETE') {
      if (email === user.email) return J({ code: 'bad_request', message: 'You cannot remove yourself.' }, 400);
      await env.DB.batch([
        env.DB.prepare('DELETE FROM grants WHERE email = ?').bind(email),
        env.DB.prepare('DELETE FROM sessions WHERE email = ?').bind(email),
        env.DB.prepare('DELETE FROM users WHERE email = ?').bind(email),
      ]);
      await audit(env, user.email, 'user.remove', email);
      return J({ ok: true });
    }
  }
  if (p === '/api/admin/grants' && m === 'PUT') {
    const b = await body();
    const email = String(b.email || '').toLowerCase(), slug = String(b.slug || '');
    const u = await env.DB.prepare('SELECT email FROM users WHERE email = ?').bind(email).first();
    const a = await env.DB.prepare('SELECT slug FROM apps WHERE slug = ?').bind(slug).first();
    if (!u || !a) return J({ code: 'not_found' }, 404);
    if (b.role === null || b.role === '' || b.role === undefined) {
      const prev = await env.DB.prepare('SELECT role FROM grants WHERE email = ? AND slug = ?').bind(email, slug).first();
      await env.DB.prepare('DELETE FROM grants WHERE email = ? AND slug = ?').bind(email, slug).run();
      if (prev) await audit(env, user.email, 'grant.remove', email, { slug, from: prev.role });
      return J({ ok: true, role: null });
    }
    if (!ROLES.has(b.role)) return J({ code: 'bad_request', message: 'Role must be admin, editor or viewer.' }, 400);
    const prev = await env.DB.prepare('SELECT role FROM grants WHERE email = ? AND slug = ?').bind(email, slug).first();
    await env.DB.prepare('INSERT INTO grants (email, slug, role, granted_by, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(email, slug) DO UPDATE SET role = excluded.role, granted_by = excluded.granted_by')
      .bind(email, slug, b.role, user.email, Date.now()).run();
    await audit(env, user.email, 'grant.set', email, { slug, role: b.role, from: prev ? prev.role : null });
    return J({ ok: true, role: b.role });
  }
  if (p === '/api/admin/apps' && m === 'GET') {
    const sections = (await env.DB.prepare('SELECT slug, name, sort FROM sections ORDER BY sort').all()).results;
    const apps = (await env.DB.prepare('SELECT a.slug, a.name, a.section, a.description, a.status, a.mode, a.url, a.binding, a.public, a.sort FROM apps a JOIN sections s ON s.slug = a.section ORDER BY s.sort, a.sort').all()).results;
    return J({ sections, apps });
  }
  if (p === '/api/admin/apps' && m === 'POST') {
    const b = await body();
    const slug = String(b.slug || '').trim().toLowerCase();
    if (!SLUG.test(slug)) return J({ code: 'bad_request', message: 'Slug: lower-case letters, digits and dashes.' }, 400);
    if (['api', 'auth', 'admin', 'kit'].includes(slug)) return J({ code: 'bad_request', message: 'That slug is reserved.' }, 400);
    if (await env.DB.prepare('SELECT slug FROM apps WHERE slug = ?').bind(slug).first()) return J({ code: 'exists', message: 'That slug is taken.' }, 409);
    const section = await env.DB.prepare('SELECT slug FROM sections WHERE slug = ?').bind(String(b.section || '')).first();
    if (!section) return J({ code: 'bad_request', message: 'Unknown section.' }, 400);
    await env.DB.prepare('INSERT INTO apps (slug, name, section, description, status, mode, url, binding, public, sort) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(slug, String(b.name || slug).slice(0, 80), section.slug, String(b.description || '').slice(0, 200), STATUS.has(b.status) ? b.status : 'soon', MODES.has(b.mode) ? b.mode : 'link', String(b.url || ''), String(b.binding || ''), b.public ? 1 : 0, Number(b.sort) || 99).run();
    await audit(env, user.email, 'app.add', slug, b);
    return J({ ok: true, slug });
  }
  const am = p.match(/^\/api\/admin\/apps\/([^/]+)$/);
  if (am) {
    const slug = decodeURIComponent(am[1]);
    const a = await env.DB.prepare('SELECT * FROM apps WHERE slug = ?').bind(slug).first();
    if (!a) return J({ code: 'not_found' }, 404);
    if (m === 'PATCH') {
      const b = await body();
      const next = {
        name: 'name' in b ? String(b.name || a.name).slice(0, 80) : a.name,
        section: 'section' in b ? String(b.section) : a.section,
        description: 'description' in b ? String(b.description || '').slice(0, 200) : a.description,
        status: 'status' in b && STATUS.has(b.status) ? b.status : a.status,
        mode: 'mode' in b && MODES.has(b.mode) ? b.mode : a.mode,
        url: 'url' in b ? String(b.url || '') : a.url,
        binding: 'binding' in b ? String(b.binding || '') : a.binding,
        public: 'public' in b ? (b.public ? 1 : 0) : a.public,
        sort: 'sort' in b ? (Number(b.sort) || 0) : a.sort,
      };
      if (!(await env.DB.prepare('SELECT slug FROM sections WHERE slug = ?').bind(next.section).first())) return J({ code: 'bad_request', message: 'Unknown section.' }, 400);
      await env.DB.prepare('UPDATE apps SET name = ?, section = ?, description = ?, status = ?, mode = ?, url = ?, binding = ?, public = ?, sort = ? WHERE slug = ?')
        .bind(next.name, next.section, next.description, next.status, next.mode, next.url, next.binding, next.public, next.sort, slug).run();
      const changed = Object.fromEntries(Object.entries(next).filter(([k, v]) => v !== a[k]));
      if (Object.keys(changed).length) await audit(env, user.email, 'app.update', slug, changed);
      return J({ ok: true });
    }
    if (m === 'DELETE') {
      if (a.status === 'hub') return J({ code: 'bad_request', message: 'Hub pages cannot be removed.' }, 400);
      await env.DB.batch([env.DB.prepare('DELETE FROM grants WHERE slug = ?').bind(slug), env.DB.prepare('DELETE FROM apps WHERE slug = ?').bind(slug)]);
      await audit(env, user.email, 'app.remove', slug);
      return J({ ok: true });
    }
  }
  if (p === '/api/admin/audit' && m === 'GET') {
    const limit = Math.min(500, Number(url.searchParams.get('limit')) || 200);
    const rows = (await env.DB.prepare('SELECT id, at, actor, action, target, detail FROM audit_log ORDER BY id DESC LIMIT ?').bind(limit).all()).results;
    return J({ rows });
  }
  if (p === '/api/admin/sessions' && m === 'GET') {
    const rows = (await env.DB.prepare('SELECT id, email, created_at, expires_at, ua FROM sessions WHERE expires_at > ? ORDER BY created_at DESC LIMIT 200').bind(Date.now()).all()).results;
    return J({ rows: rows.map(r => ({ ...r, id: r.id.slice(0, 8) })) });
  }
  return J({ code: 'not_found' }, 404);
}

// Where a card takes you.
export function hrefFor(a) {
  if (a.status === 'soon') return '';
  if (a.mode === 'proxy') return `/${a.slug}/`;
  return a.url || '';
}
