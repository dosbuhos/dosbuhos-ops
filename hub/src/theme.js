// Diseño — one theme for every Dos Búhos app, served as shared CSS tokens.
// Public (no sign-in, CORS *): GET /theme.css, /theme.json, /theme/logo-light, /theme/logo-dark, /theme/icon  (?app=<slug> for a pinned preset)
// Admin (Hub admins):          GET/PUT /api/admin/theme, POST /api/admin/theme/activate, POST|DELETE /api/admin/theme/logo/<kind>,
//                              POST /api/admin/theme/import (JSON, text or a file → preview; text goes through Claude)
// Tables are created at runtime (Workers Builds does not run migrations). Token contract: THEME.md.
import { audit } from './auth.js';
import {
  DEFAULT_THEME, PRESETS, FONTS, COLOR_KEYS, normalizeTheme, contrastReport, contrastFailures, failureMessage,
  themeForApp, buildCss, tokens, staticTokens, schemaDoc, rulesDoc, extractJson,
} from '../public/kit/theme-core.js';

const J = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra } });
const KINDS = ['logo-light', 'logo-dark', 'icon'];
const MAX_ASSET = 300 * 1024;
const MAX_TEXT = 40000;
const SLUG = /^[a-z][a-z0-9-]{0,40}$/;
const PUBLIC_HEADERS = { 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=60, stale-while-revalidate=600', 'x-robots-tag': 'noindex' };

let ensured = false;
export async function ensureThemeTables(env) {
  if (ensured) return;
  await env.DB.batch([
    env.DB.prepare('CREATE TABLE IF NOT EXISTS theme_versions (id INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT NOT NULL, note TEXT NOT NULL DEFAULT \'\', author TEXT NOT NULL DEFAULT \'\', created_at INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 0)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS theme_assets (kind TEXT PRIMARY KEY, mime TEXT NOT NULL, data TEXT NOT NULL, size INTEGER NOT NULL, hash TEXT NOT NULL, updated_at INTEGER NOT NULL, updated_by TEXT NOT NULL DEFAULT \'\')'),
  ]);
  ensured = true;
}

async function activeTheme(env) {
  const row = await env.DB.prepare('SELECT id, data, note, author, created_at FROM theme_versions WHERE active = 1 ORDER BY id DESC LIMIT 1').first();
  if (!row) return { id: null, theme: DEFAULT_THEME, note: '', author: '', created_at: null };
  let data = {}; try { data = JSON.parse(row.data); } catch {}
  return { ...row, data: undefined, theme: normalizeTheme(data, DEFAULT_THEME).theme };
}
async function assetMeta(env) {
  const rows = (await env.DB.prepare('SELECT kind, mime, size, hash, updated_at, updated_by FROM theme_assets').all()).results || [];
  return Object.fromEntries(rows.map(r => [r.kind, r]));
}
const assetUrls = (origin, meta) => Object.fromEntries(Object.values(meta).map(m => [m.kind, `${origin}/theme/${m.kind}?v=${m.hash.slice(0, 10)}`]));
async function sha(text) {
  const d = await crypto.subtle.digest('SHA-1', typeof text === 'string' ? new TextEncoder().encode(text) : text);
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function b64(bytes) { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); }
const unb64 = (s) => Uint8Array.from(atob(s), ch => ch.charCodeAt(0));

// ------------------------------------------------------------------ public
export function isPublicThemePath(p) { return p === '/theme.css' || p === '/theme.json' || /^\/theme\/(logo-light|logo-dark|icon)$/.test(p); }

export async function publicTheme(request, env, url) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, HEAD, OPTIONS', 'access-control-max-age': '86400' } });
  if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405, headers: { allow: 'GET, HEAD, OPTIONS' } });
  await ensureThemeTables(env);
  const p = url.pathname;
  const lm = p.match(/^\/theme\/(logo-light|logo-dark|icon)$/);
  if (lm) {
    const row = await env.DB.prepare('SELECT mime, data, hash FROM theme_assets WHERE kind = ?').bind(lm[1]).first();
    if (!row) return new Response('No hay imagen cargada', { status: 404, headers: { 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=60' } });
    const etag = `"${row.hash.slice(0, 16)}"`;
    const h = { ...PUBLIC_HEADERS, 'cache-control': 'public, max-age=300, stale-while-revalidate=86400', etag, 'content-type': row.mime, 'x-content-type-options': 'nosniff' };
    if (row.mime === 'image/svg+xml') h['content-security-policy'] = "default-src 'none'; style-src 'unsafe-inline'; img-src data:";
    if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers: h });
    return new Response(request.method === 'HEAD' ? null : unb64(row.data), { headers: h });
  }
  const app = (url.searchParams.get('app') || '').toLowerCase();
  const appId = SLUG.test(app) ? app : '';
  const [act, meta] = await Promise.all([activeTheme(env), assetMeta(env)]);
  const theme = themeForApp(act.theme, appId);
  const assets = assetUrls(url.origin, meta);
  let body, type;
  if (p === '/theme.css') {
    const label = [act.id ? `v${act.id}` : 'predeterminado', theme.name, appId ? `app ${appId}${theme.pinned ? ' → ' + theme.pinned : ''}` : ''].filter(Boolean).join(' · ');
    body = buildCss(theme, assets, label); type = 'text/css; charset=utf-8';
  } else {
    const { pinned, ...clean } = theme;
    body = JSON.stringify({ version: act.id, app: appId || null, pinned: pinned || null, theme: clean,
      tokens: { light: tokens(theme, 'light'), dark: tokens(theme, 'dark'), common: staticTokens(theme, assets) }, assets }, null, 1);
    type = 'application/json; charset=utf-8';
  }
  const etag = `"${(await sha(body)).slice(0, 20)}"`;
  const h = { ...PUBLIC_HEADERS, etag, 'content-type': type };
  if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers: h });
  return new Response(request.method === 'HEAD' ? null : body, { headers: h });
}

// ------------------------------------------------------------------ admin
export async function themeApi(request, env, url, user) {
  await ensureThemeTables(env);
  const p = url.pathname, m = request.method;

  if (p === '/api/admin/theme' && m === 'GET') {
    const act = await activeTheme(env);
    const hist = (await env.DB.prepare('SELECT id, data, note, author, created_at, active FROM theme_versions ORDER BY id DESC LIMIT 50').all()).results || [];
    const meta = await assetMeta(env);
    return J({
      active: { id: act.id, theme: act.theme, note: act.note, author: act.author, created_at: act.created_at },
      history: hist.map(r => { let d = {}; try { d = JSON.parse(r.data); } catch {} return { id: r.id, note: r.note, author: r.author, created_at: r.created_at, active: r.active === 1, theme: normalizeTheme(d, DEFAULT_THEME).theme }; }),
      presets: PRESETS, fonts: FONTS, colorKeys: COLOR_KEYS, default: DEFAULT_THEME,
      assets: Object.fromEntries(Object.entries(meta).map(([k, v]) => [k, { ...v, url: `/theme/${k}?v=${v.hash.slice(0, 10)}` }])),
      ai: { configured: !!env.ANTHROPIC_API_KEY, model: env.AI_MODEL || 'claude-sonnet-5-5' },
    });
  }

  if (p === '/api/admin/theme' && m === 'PUT') {
    const b = await request.json().catch(() => null);
    if (!b || typeof b.theme !== 'object') return J({ code: 'bad_request', message: 'Falta el tema a guardar.' }, 400);
    const act = await activeTheme(env);
    const { theme, errors } = normalizeTheme(b.theme, act.theme);
    if (errors.length) return J({ code: 'invalid', message: 'No se guardó: ' + errors.join(' '), errors }, 400);
    const fails = contrastFailures(theme);
    if (fails.length) return J({ code: 'contrast', message: 'No se guardó: ' + failureMessage(fails[0]) + (fails.length > 1 ? ` (y ${fails.length - 1} más)` : ''), failures: fails }, 422);
    const note = String(b.note || '').trim().slice(0, 200);
    const now = Date.now();
    const res = await env.DB.prepare('INSERT INTO theme_versions (data, note, author, created_at, active) VALUES (?, ?, ?, ?, 0)').bind(JSON.stringify(theme), note, user.email, now).run();
    const id = res.meta && res.meta.last_row_id;
    await env.DB.batch([env.DB.prepare('UPDATE theme_versions SET active = 0 WHERE active = 1'), env.DB.prepare('UPDATE theme_versions SET active = 1 WHERE id = ?').bind(id)]);
    await audit(env, user.email, 'theme.save', `v${id}`, { name: theme.name, preset: theme.preset, note, changed: changedKeys(act.theme, theme) });
    return J({ ok: true, id, theme, report: contrastReport(theme) });
  }

  if (p === '/api/admin/theme/activate' && m === 'POST') {
    const b = await request.json().catch(() => ({}));
    const id = Number(b.id);
    const row = Number.isInteger(id) ? await env.DB.prepare('SELECT id, data FROM theme_versions WHERE id = ?').bind(id).first() : null;
    if (!row) return J({ code: 'not_found', message: 'Esa versión no existe.' }, 404);
    await env.DB.batch([env.DB.prepare('UPDATE theme_versions SET active = 0 WHERE active = 1'), env.DB.prepare('UPDATE theme_versions SET active = 1 WHERE id = ?').bind(id)]);
    let name = ''; try { name = JSON.parse(row.data).name || ''; } catch {}
    await audit(env, user.email, 'theme.activate', `v${id}`, { name });
    return J({ ok: true, id });
  }

  const lm = p.match(/^\/api\/admin\/theme\/logo\/(logo-light|logo-dark|icon)$/);
  if (lm) {
    const kind = lm[1];
    if (m === 'DELETE') {
      await env.DB.prepare('DELETE FROM theme_assets WHERE kind = ?').bind(kind).run();
      await audit(env, user.email, 'theme.logo.remove', kind);
      return J({ ok: true });
    }
    if (m === 'POST') {
      let bytes, declared = '';
      const ct = request.headers.get('content-type') || '';
      if (ct.startsWith('multipart/form-data')) {
        const f = (await request.formData()).get('file');
        if (!f || typeof f === 'string') return J({ code: 'bad_request', message: 'Falta el archivo.' }, 400);
        declared = f.type || ''; bytes = new Uint8Array(await f.arrayBuffer());
      } else { declared = ct; bytes = new Uint8Array(await request.arrayBuffer()); }
      if (!bytes.length) return J({ code: 'bad_request', message: 'El archivo está vacío.' }, 400);
      if (bytes.length > MAX_ASSET) return J({ code: 'too_large', message: `La imagen pesa ${Math.round(bytes.length / 1024)} KB; el máximo es 300 KB.` }, 413);
      const mime = sniff(bytes);
      if (!mime) return J({ code: 'bad_type', message: 'Solo PNG, SVG, JPEG o WebP.' }, 415);
      if (mime === 'image/svg+xml' && /<script|\son\w+\s*=|javascript:|<foreignObject/i.test(new TextDecoder().decode(bytes))) return J({ code: 'bad_type', message: 'El SVG trae código (scripts o eventos). Expórtalo como SVG simple o PNG.' }, 415);
      const hash = await sha(bytes);
      await env.DB.prepare('INSERT INTO theme_assets (kind, mime, data, size, hash, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(kind) DO UPDATE SET mime = excluded.mime, data = excluded.data, size = excluded.size, hash = excluded.hash, updated_at = excluded.updated_at, updated_by = excluded.updated_by')
        .bind(kind, mime, b64(bytes), bytes.length, hash, Date.now(), user.email).run();
      await audit(env, user.email, 'theme.logo', kind, { mime, size: bytes.length, declared });
      return J({ ok: true, kind, mime, size: bytes.length, url: `/theme/${kind}?v=${hash.slice(0, 10)}` });
    }
  }

  if (p === '/api/admin/theme/import' && m === 'POST') return importSpec(request, env);
  return J({ code: 'not_found' }, 404);
}

function sniff(b) {
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (String.fromCharCode(...b.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...b.subarray(8, 12)) === 'WEBP') return 'image/webp';
  const head = new TextDecoder().decode(b.subarray(0, 2048)).replace(/^﻿/, '').trimStart();
  if ((head.startsWith('<?xml') || head.startsWith('<svg') || head.startsWith('<!--')) && /<svg[\s>]/i.test(head)) return 'image/svg+xml';
  return null;
}
function changedKeys(a, b) {
  const out = [];
  for (const k of ['preset', 'name', 'fontDisplay', 'fontBody', 'size', 'radius', 'border', 'density', 'weightBody']) if (a[k] !== b[k]) out.push(k);
  for (const mode of ['light', 'dark']) for (const k of COLOR_KEYS) if (a[mode][k] !== b[mode][k]) out.push(`${mode}.${k}`);
  if (JSON.stringify(a.apps) !== JSON.stringify(b.apps)) out.push('apps');
  if (JSON.stringify(a.brand) !== JSON.stringify(b.brand)) out.push('brand');
  return out;
}

// ------------------------------------------------------------------ import: JSON → normalize; text/instructions → Claude
async function importSpec(request, env) {
  let text = '', instructions = '', baseIn = null, fileName = '', fileText = null;
  const ct = request.headers.get('content-type') || '';
  if (ct.startsWith('multipart/form-data')) {
    const fd = await request.formData();
    text = String(fd.get('text') || ''); instructions = String(fd.get('instructions') || '');
    try { baseIn = fd.get('base') ? JSON.parse(String(fd.get('base'))) : null; } catch {}
    const f = fd.get('file');
    if (f && typeof f !== 'string' && f.size) {
      if (f.size > 200 * 1024) return J({ code: 'too_large', message: 'El archivo pesa más de 200 KB.' }, 413);
      fileName = f.name || ''; fileText = await f.text();
      if (!/\.(json|md|markdown|txt)$/i.test(fileName)) return J({ code: 'bad_type', message: 'Sube un archivo .json, .md o .txt.' }, 415);
    }
  } else {
    const b = await request.json().catch(() => ({}));
    text = String(b.text || ''); instructions = String(b.instructions || ''); baseIn = b.base || null;
  }
  const act = await activeTheme(env);
  const base = baseIn ? normalizeTheme(baseIn, act.theme).theme : act.theme;

  // A .json file, or pasted text that is a JSON object, goes straight in. Everything else is read by Claude.
  let json = null, jsonErr = '';
  const tryJson = (s, strict) => {
    const t = String(s || '').trim();
    if (!t) return null;
    if (t.startsWith('{')) { try { return JSON.parse(t); } catch (e) { if (strict || !instructions) jsonErr = `El JSON no se pudo leer: ${e.message}`; return null; } }
    if (strict) { jsonErr = 'El archivo .json no contiene un objeto JSON.'; return null; }
    return null;
  };
  if (fileText !== null && /\.json$/i.test(fileName)) { json = tryJson(fileText, true); if (!json) return J({ code: 'bad_json', message: jsonErr }, 400); }
  else if (!fileText && !instructions.trim()) { json = tryJson(text, false); if (!json && jsonErr) return J({ code: 'bad_json', message: jsonErr }, 400); }

  if (json) {
    const { theme, errors, warnings } = normalizeTheme(json, base);
    if (errors.length) return J({ code: 'invalid', message: errors.join(' '), errors, warnings }, 400);
    return J({ source: 'json', theme, warnings, report: contrastReport(theme), failures: contrastFailures(theme) });
  }

  const spec = [fileText, text].filter(s => s && s.trim()).join('\n\n').slice(0, MAX_TEXT);
  if (!spec.trim() && !instructions.trim()) return J({ code: 'bad_request', message: 'Pega una especificación, sube un archivo o escribe instrucciones.' }, 400);
  if (!env.ANTHROPIC_API_KEY) return J({ code: 'no_ai_key', message: AI_MISSING }, 400);
  return aiPreview(env, base, spec, instructions.slice(0, 4000));
}

export const AI_MISSING = 'La opción con IA necesita el secreto ANTHROPIC_API_KEY en el Hub. Agrégalo en Cloudflare → Workers → hub → Settings → Variables and Secrets → Add → tipo Secret, nombre ANTHROPIC_API_KEY, valor = tu llave de Anthropic. Mientras tanto funcionan los estilos, los controles y la importación JSON.';

function aiSystem(base) {
  const presets = PRESETS.map(p => ({ id: p.id, name: p.name, about: p.about, light: p.light, dark: p.dark, fontDisplay: p.fontDisplay, fontBody: p.fontBody, size: p.size, radius: p.radius, density: p.density }));
  return `You design themes for the Dos Búhos apps (a certified-organic winery in San Miguel de Allende; staff use the apps on phones, often outdoors). You turn a design spec or plain-language instructions into ONE theme object.

Reply with ONLY a JSON object — no prose, no code fences. Shape (all keys optional; anything you leave out keeps the current value):
${JSON.stringify(schemaDoc(), null, 1)}

Hard rules (checked by code; a theme that breaks one is refused):
- ${rulesDoc().join('\n- ')}
- Colours are #rrggbb. Fonts only from the list. Every theme needs both light and dark colours that look like the same brand.
- Keep it a Dos Búhos brand variation (wine, earth, garden, stone, night); no neon or off-brand palettes unless asked.

Presets (you may start from one with "preset" and then override):
${JSON.stringify(presets)}

Current theme (the starting point; change only what the request asks for):
${JSON.stringify(base)}`;
}

async function aiPreview(env, base, spec, instructions) {
  const system = aiSystem(base);
  const user = [spec ? `Design spec:\n${spec}` : '', instructions ? `Instructions from the owner (Spanish is fine):\n${instructions}` : ''].filter(Boolean).join('\n\n');
  const messages = [{ role: 'user', content: user }];
  let last = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    let reply;
    try { reply = await callClaude(env, system, messages); }
    catch (e) { return J({ code: 'ai_error', message: `La IA no respondió: ${e.message}` }, 502); }
    const obj = extractJson(reply);
    let problem = '';
    if (!obj || typeof obj !== 'object') problem = 'Your reply was not a single JSON object.';
    else {
      const r = normalizeTheme(obj, base);
      const fails = contrastFailures(r.theme);
      last = { ...r, fails };
      if (r.errors.length) problem = 'Schema errors: ' + r.errors.join(' ');
      else if (fails.length) problem = 'Contrast failures: ' + fails.map(failureMessage).join(' ');
      else return J({ source: 'ai', theme: r.theme, warnings: r.warnings, report: contrastReport(r.theme), failures: [] });
    }
    messages.push({ role: 'assistant', content: reply }, { role: 'user', content: `${problem}\nFix it and reply with ONLY the corrected JSON object.` });
  }
  if (last && !last.errors.length) {
    return J({ source: 'ai', theme: last.theme, warnings: [...last.warnings, 'La IA no logró pasar todas las reglas de contraste; corrige los colores marcados antes de guardar.'], report: contrastReport(last.theme), failures: last.fails });
  }
  return J({ code: 'ai_invalid', message: 'La IA no devolvió un tema válido después de dos intentos. Intenta con instrucciones más concretas.' + (last ? ' ' + last.errors.join(' ') : '') }, 502);
}

async function callClaude(env, system, messages) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: env.AI_MODEL || 'claude-sonnet-5-5', max_tokens: 2500, system, messages }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${r.status} ${(j.error && j.error.message) || ''}`.trim());
  return (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n');
}
