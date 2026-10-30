// Servidor MCP remoto: deja que el Claude de cada persona (claude.ai, escritorio, celular) consulte y actualice el huerto.
// URL del conector: https://<host>/mcp. Inicio de sesión: OAuth 2.1 (registro dinámico + PKCE S256); la página de
// autorización pide el nombre y el PIN de la app (el mismo de config k='pin'). Los tokens se guardan solo como SHA-256.
import { CROPS, PLANTINGS, STOCK, BUY, PLAN_START, PLAN_WEEKS, BED, BEDS, wk, wkDate, fmt, factor, buildPlan, bedState, traysActive, weekTasks, weekHours, forecast, where } from './plan.js';

const enc = new TextEncoder();
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const rand = (n = 32) => b64u(crypto.getRandomValues(new Uint8Array(n)));
const sha = async (s) => b64u(await crypto.subtle.digest('SHA-256', enc.encode(s)));
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS', 'access-control-allow-headers': 'authorization, content-type, mcp-protocol-version, mcp-session-id', 'access-control-expose-headers': 'www-authenticate, mcp-session-id' };
const J = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: Object.assign({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }, CORS) });
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ACCESS_TTL = 30 * 86400, REFRESH_TTL = 365 * 86400, CODE_TTL = 600;
const VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const now = () => Math.floor(Date.now() / 1000);

// Almacén simple en D1: tabla mcp (k, data, exp).
const ensure = (env) => env.DB.prepare('CREATE TABLE IF NOT EXISTS mcp (k TEXT PRIMARY KEY, data TEXT NOT NULL, exp INTEGER NOT NULL)').run();
async function kget(env, k) { const r = await env.DB.prepare('SELECT data, exp FROM mcp WHERE k = ?').bind(k).first(); return r && r.exp > now() ? JSON.parse(r.data) : null; }
const kput = (env, k, data, ttl) => env.DB.prepare('INSERT OR REPLACE INTO mcp (k, data, exp) VALUES (?, ?, ?)').bind(k, JSON.stringify(data), now() + ttl).run();
const kdel = (env, k) => env.DB.prepare('DELETE FROM mcp WHERE k = ?').bind(k).run();
async function pinOk(env, pin) { if (!pin) return false; const r = await env.DB.prepare("SELECT v FROM config WHERE k='pin'").first(); return !!r && r.v === String(pin).trim(); }
const okRedirect = (u) => { try { const x = new URL(u); return x.protocol === 'https:' || (x.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(x.hostname)); } catch (e) { return false; } };

export async function mcpRoute(request, env, url) {
  const p = url.pathname, origin = url.origin;
  const mine = p === '/mcp' || p.startsWith('/oauth/') || p.startsWith('/.well-known/');
  if (!mine) return null;
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  await ensure(env);
  if (p.startsWith('/.well-known/oauth-protected-resource')) return J({ resource: origin + '/mcp', authorization_servers: [origin], bearer_methods_supported: ['header'], resource_name: 'Huerto Dos Búhos' });
  if (p.startsWith('/.well-known/oauth-authorization-server') || p.startsWith('/.well-known/openid-configuration')) return J({
    issuer: origin, authorization_endpoint: origin + '/oauth/authorize', token_endpoint: origin + '/oauth/token', registration_endpoint: origin + '/oauth/register',
    response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'], code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'], scopes_supported: ['huerto'],
  });
  if (p === '/oauth/register' && request.method === 'POST') {
    const b = await request.json().catch(() => ({}));
    const uris = Array.isArray(b.redirect_uris) ? b.redirect_uris.map(String) : [];
    if (!uris.length || !uris.every(okRedirect)) return J({ error: 'invalid_redirect_uri' }, 400);
    const id = 'c_' + rand(18), client = { name: String(b.client_name || 'Claude').slice(0, 100), redirect_uris: uris.slice(0, 10) };
    await kput(env, 'client:' + id, client, 5 * 365 * 86400);
    return J({ client_id: id, client_name: client.name, redirect_uris: client.redirect_uris, token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], client_id_issued_at: now() }, 201);
  }
  if (p === '/oauth/authorize') return authorize(request, env, url);
  if (p === '/oauth/token' && request.method === 'POST') return token(request, env);
  if (p === '/mcp') {
    const user = await bearerUser(request, env);
    if (!user) return new Response(JSON.stringify({ error: 'invalid_token' }), { status: 401, headers: Object.assign({ 'content-type': 'application/json', 'www-authenticate': `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"` }, CORS) });
    if (request.method === 'GET') return new Response(null, { status: 405, headers: Object.assign({ allow: 'POST' }, CORS) });
    if (request.method === 'DELETE') return new Response(null, { status: 204, headers: CORS });
    if (request.method !== 'POST') return new Response(null, { status: 405, headers: CORS });
    let msg; try { msg = await request.json(); } catch (e) { return J({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, 400); }
    const batch = Array.isArray(msg), out = [];
    for (const m of batch ? msg : [msg]) { const r = await rpc(env, user, m); if (r) out.push(r); }
    if (!out.length) return new Response(null, { status: 202, headers: CORS });
    return J(batch ? out : out[0]);
  }
  return null;
}

async function bearerUser(request, env) {
  const m = (request.headers.get('authorization') || '').match(/^Bearer\s+(\S+)$/i);
  if (!m) return null;
  return await kget(env, 'access:' + await sha(m[1]));
}

async function authorize(request, env, url) {
  const src = request.method === 'POST' ? new URLSearchParams(await request.text()) : url.searchParams;
  const f = Object.fromEntries(['client_id', 'redirect_uri', 'state', 'code_challenge', 'code_challenge_method', 'response_type', 'scope'].map(k => [k, src.get(k) || '']));
  const client = f.client_id && await kget(env, 'client:' + f.client_id);
  if (!client) return page('Conexión no válida', '<p>Esta aplicación no está registrada. Vuelve a agregar el conector en Claude.</p>', 400);
  if (!client.redirect_uris.includes(f.redirect_uri)) return page('Conexión no válida', '<p>La dirección de regreso no coincide.</p>', 400);
  const back = (params) => { const u = new URL(f.redirect_uri); for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v); if (f.state) u.searchParams.set('state', f.state); return Response.redirect(u.toString(), 302); };
  if (f.response_type !== 'code') return back({ error: 'unsupported_response_type' });
  if (!f.code_challenge || f.code_challenge_method !== 'S256') return back({ error: 'invalid_request', error_description: 'PKCE S256 required' });
  const hidden = Object.entries(f).map(([k, v]) => `<input type="hidden" name="${k}" value="${esc(v)}">`).join('');
  const form = (msg) => page('Conectar Claude al huerto', `<p><b>${esc(client.name)}</b> quiere ver y actualizar el plan del Huerto Dos Búhos: tareas, camas y cosecha.</p>${msg || ''}
<form method="post" action="/oauth/authorize">${hidden}<label>Tu nombre<input name="nombre" required maxlength="40" autocomplete="name"></label><label>PIN del huerto<input name="pin" type="password" inputmode="numeric" required autocomplete="off"></label><div class="row"><button name="ok" value="1">Permitir</button><button name="ok" value="0" class="no" formnovalidate>Cancelar</button></div></form>`);
  if (request.method !== 'POST') return form();
  if (src.get('ok') !== '1') return back({ error: 'access_denied' });
  // Freno básico contra adivinar el PIN: 8 intentos fallidos por hora y por IP.
  const ip = request.headers.get('cf-connecting-ip') || 'x', lk = 'fail:' + await sha(ip), fails = (await kget(env, lk)) || { n: 0 };
  if (fails.n >= 8) return form('<p class="err">Demasiados intentos. Espera una hora.</p>');
  if (!(await pinOk(env, src.get('pin')))) { await kput(env, lk, { n: fails.n + 1 }, 3600); return form('<p class="err">PIN incorrecto.</p>'); }
  const nombre = String(src.get('nombre') || '').trim().slice(0, 40) || 'Claude';
  const code = rand(32);
  await kput(env, 'code:' + await sha(code), { client_id: f.client_id, redirect_uri: f.redirect_uri, challenge: f.code_challenge, nombre }, CODE_TTL);
  return back({ code });
}

function page(title, body, status = 200) {
  return new Response(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title><style>
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f3f1ea;font:16px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#1f241d}
.box{background:#fff;border:1px solid #dcd8cc;border-radius:16px;padding:26px 22px;width:min(380px,92vw)}h1{font-family:Georgia,serif;font-weight:400;color:#2f5d3a;margin:0 0 12px;font-size:24px}
p{color:#4a4f45;line-height:1.45}label{display:flex;flex-direction:column;gap:6px;font-size:14px;color:#4a4f45;margin-top:12px}input{font:inherit;font-size:17px;padding:12px;border:1px solid #cfcabd;border-radius:10px}
.row{display:flex;gap:10px;margin-top:18px}button{flex:1;min-height:50px;border-radius:12px;border:0;background:#2f5d3a;color:#fff;font:700 16px inherit;cursor:pointer}
button.no{background:#fff;color:#1f241d;border:1px solid #cfcabd}.err{color:#a0302a;font-weight:600}</style></head><body><div class="box"><h1>${esc(title)}</h1>${body}</div></body></html>`,
    { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-frame-options': 'DENY' } });
}

async function token(request, env) {
  const ct = request.headers.get('content-type') || '';
  const b = ct.includes('application/json') ? await request.json().catch(() => ({})) : Object.fromEntries(new URLSearchParams(await request.text()));
  const err = (e, d) => J({ error: e, error_description: d }, 400);
  let nombre, client_id = String(b.client_id || '');
  if (b.grant_type === 'authorization_code') {
    const key = 'code:' + await sha(String(b.code || '')), c = await kget(env, key);
    if (!c) return err('invalid_grant', 'unknown or expired code');
    await kdel(env, key);
    if (c.client_id !== client_id || c.redirect_uri !== String(b.redirect_uri || '')) return err('invalid_grant', 'client mismatch');
    if (await sha(String(b.code_verifier || '')) !== c.challenge) return err('invalid_grant', 'PKCE failed');
    nombre = c.nombre;
  } else if (b.grant_type === 'refresh_token') {
    const key = 'refresh:' + await sha(String(b.refresh_token || '')), r = await kget(env, key);
    if (!r) return err('invalid_grant', 'refresh token expired');
    if (client_id && r.client_id !== client_id) return err('invalid_grant', 'client mismatch');
    await kdel(env, key);
    nombre = r.nombre; client_id = r.client_id;
  } else return err('unsupported_grant_type');
  const access = rand(32), refresh = rand(32);
  await kput(env, 'access:' + await sha(access), { nombre, client_id }, ACCESS_TTL);
  await kput(env, 'refresh:' + await sha(refresh), { nombre, client_id }, REFRESH_TTL);
  try { await env.DB.prepare('DELETE FROM mcp WHERE exp < ?').bind(now()).run(); } catch (e) {}
  return J({ access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL, refresh_token: refresh, scope: 'huerto' });
}

// ---------- herramientas ----------
const DIAS = ['', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes'];
const isoMX = (d = new Date()) => new Date(d.getTime() - 6 * 3600e3).toISOString().slice(0, 10);
const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const weekOf = (fecha) => { const d = new Date((fecha || isoMX()) + 'T12:00:00'); return Math.max(0, Math.min(PLAN_WEEKS - 1, Math.floor((d - new Date(PLAN_START + 'T12:00:00')) / (7 * 86400000)))); };
const cropName = (k) => (CROPS[k] ? CROPS[k].n : k);
let PLAN = null; const plan = () => (PLAN = PLAN || buildPlan());

const TOOLS = [
  { name: 'resumen_semana', ro: true, description: 'Lista de Adrián para una semana: tareas por día (con id y si ya está hecha), horas de trabajo contra 40 h disponibles, y la cosecha esperada por cultivo. Sin fecha = esta semana.', inputSchema: { type: 'object', properties: { fecha: { type: 'string', description: 'Cualquier día de la semana, YYYY-MM-DD' } } } },
  { name: 'estado_camas', ro: true, description: 'Las 34 camas: qué dice el plan que hay hoy (o en la fecha) y el último reporte real de Adrián (limpia / lista / sembrada).', inputSchema: { type: 'object', properties: { fecha: { type: 'string', description: 'YYYY-MM-DD, por defecto hoy' } } } },
  { name: 'cama', ro: true, description: 'Todo de una cama (A1–A24, B1–B10): medidas, cada siembra del año con tramo, fechas de siembra y cosecha y kg/semana, y sus reportes reales.', inputSchema: { type: 'object', properties: { cama: { type: 'string' } }, required: ['cama'] } },
  { name: 'cosecha', ro: true, description: 'Cosecha esperada por mes y por cultivo según el plan (kg o flores), y lo que realmente se ha registrado.', inputSchema: { type: 'object', properties: { meses: { type: 'integer', description: 'Cuántos meses desde este (default 3, max 12)' } } } },
  { name: 'semillero', ro: true, description: 'Charolas del semillero: qué se siembra esta semana, qué está en la mesa y cuándo se trasplanta y a qué cama.', inputSchema: { type: 'object', properties: { fecha: { type: 'string' } } } },
  { name: 'cultivos', ro: true, description: 'Catálogo de cultivos del plan: nombre, método, semanas a cosecha, rendimiento, plato del menú que abastece, y semilla en bodega. También lo que conviene comprar en vez de cultivar.', inputSchema: { type: 'object', properties: {} } },
  { name: 'reportar_cama', ro: false, description: 'Guarda el estado real de una cama, igual que el botón "Actualizar cama" de la app. estado: limpia | lista | sembrada. Para sembrada indica cultivo (clave del catálogo o nombre libre), fecha de siembra y opcional cosecha estimada (si falta se calcula).', inputSchema: { type: 'object', properties: { cama: { type: 'string' }, estado: { type: 'string', enum: ['limpia', 'lista', 'sembrada'] }, metros: { type: 'number', description: 'Default: toda la cama' }, mitad: { type: 'string', enum: ['norte', 'sur', 'oeste', 'este'], description: 'Si es media cama' }, cultivo: { type: 'string' }, fecha: { type: 'string' }, cosecha: { type: 'string' } }, required: ['cama', 'estado'] } },
  { name: 'registrar_cosecha', ro: false, description: 'Anota una entrega de cosecha a cocina (kg o piezas).', inputSchema: { type: 'object', properties: { fecha: { type: 'string' }, cama: { type: 'string' }, cultivo: { type: 'string', description: 'Clave del catálogo (p. ej. lechuga, kale)' }, cantidad: { type: 'number' }, unidad: { type: 'string', description: 'kg o flores; default según el cultivo' }, nota: { type: 'string' } }, required: ['cama', 'cultivo', 'cantidad'] } },
  { name: 'marcar_tarea', ro: false, description: 'Marca o desmarca una tarea de la lista de Adrián como hecha. Usa el id y la fecha de resumen_semana.', inputSchema: { type: 'object', properties: { id: { type: 'string' }, fecha: { type: 'string', description: 'Cualquier día de esa semana' }, hecha: { type: 'boolean', description: 'default true' } }, required: ['id'] } },
];

async function reports(env) {
  const { results } = await env.DB.prepare('SELECT id, cama, estado, m, pos, cultivo, fecha, cosecha, at FROM camas ORDER BY id DESC LIMIT 500').all();
  return results.map(r => Object.assign({}, r, { cultivo_nombre: r.cultivo ? cropName(r.cultivo) : '' }));
}

async function runTool(env, user, name, a) {
  const P = plan();
  if (name === 'resumen_semana') {
    const w = weekOf(a.fecha), T = weekTasks(P, w);
    const { results } = await env.DB.prepare('SELECT task FROM hechas WHERE w = ? AND estado = ?').bind(w, 'hecho').all();
    const done = new Set(results.map(r => r.task));
    const start = wkDate(w);
    const harv = {}; T.filter(t => t.k === 'cosecha').forEach(t => { const o = harv[t.crop] = harv[t.crop] || { cultivo: cropName(t.crop), camas: [], cantidad: 0, unidad: t.u }; o.camas.push(t.bed); o.cantidad = Math.round((o.cantidad + t.qty) * 10) / 10; });
    return {
      semana: w + 1, desde: iso(start), hasta: iso(new Date(start.getTime() + 4 * 86400000)), horas: Math.round(weekHours(P, w) * 10) / 10, horas_disponibles: 40,
      tareas: T.filter(t => t.k !== 'cosecha').sort((x, y) => x.d - y.d).map(t => ({ id: t.id, dia: DIAS[t.d], fecha: iso(new Date(start.getTime() + (t.d - 1) * 86400000)), tipo: t.k, cultivo: t.b || '', tarea: t.t, minutos: Math.round(t.min), hecha: done.has(t.id) })),
      cosecha_esperada: Object.values(harv), nota: 'La cosecha para cocina se entrega lunes, miércoles y viernes antes de las 10:00.',
    };
  }
  if (name === 'estado_camas') {
    const w = weekOf(a.fecha), R = await reports(env), last = {};
    R.forEach(r => { (last[r.cama] = last[r.cama] || []).length < 3 && last[r.cama].push(r); });
    const row = p => ({ cultivo: p.c.n, tramo: where(p), siembra: p.ex ? 'ya estaba' : fmt(wkDate(p.s)), cosecha: p.c.nokg ? '' : fmt(wkDate(Math.max(0, p.h0))) + ' – ' + fmt(wkDate(p.end)) });
    return { fecha: a.fecha || isoMX(), camas: BEDS.map(b => { const L = (P.byBed[b.id] || []).slice().sort((x, y) => x.s - y.s);
      return { cama: b.id, ahora: L.filter(p => (p.ex || p.s <= w) && p.end >= w).map(row), siguiente: L.filter(p => !p.ex && p.s > w).slice(0, 2).map(row), reportes: last[b.id] || [] }; }) };
  }
  if (name === 'cama') {
    const id = String(a.cama || '').toUpperCase().trim(), B = BED[id];
    if (!B) return { error: 'Cama no existe. Usa A1–A24 o B1–B10.' };
    const list = (P.byBed[id] || []).slice().sort((x, y) => x.s - y.s);
    return {
      cama: id, medidas: B.sec === 'A' ? '1 × 5 m, tramos de norte a sur' : '1.4 × 9.5 m, tramos de oeste a este (sección B: solo flores)', area_m2: B.area,
      plan: list.map(p => ({ cultivo: p.c.n, clave: p.crop, tramo: p.frac < 0.999 ? `${p.pos}–${p.pos + p.m} m` : 'cama completa', ya_estaba: p.ex, siembra: p.ex ? null : iso(wkDate(p.s)), metodo: p.tray ? 'semillero y trasplante' : p.c.met, cosecha: p.c.nokg ? null : iso(wkDate(Math.max(0, p.h0))) + ' a ' + iso(wkDate(p.end)), por_semana: p.c.nokg ? null : Math.round(p.c.kg * p.scale * 10) / 10 + ' ' + p.c.u, nota: p.note || '' })),
      reportes: (await reports(env)).filter(r => r.cama === id).slice(0, 10),
    };
  }
  if (name === 'cosecha') {
    const F = forecast(P), n = Math.min(12, Math.max(1, a.meses || 3)), start = isoMX().slice(0, 7);
    const months = Object.keys(F).filter(k => k >= start).sort().slice(0, n);
    const { results } = await env.DB.prepare('SELECT substr(fecha,1,7) mes, cultivo, u, SUM(cantidad) total FROM cosechas GROUP BY mes, cultivo, u ORDER BY mes').all();
    return { esperado: months.map(m => ({ mes: m, cultivos: Object.entries(F[m]).map(([c, v]) => ({ cultivo: cropName(c), cantidad: Math.round(v * 10) / 10, unidad: CROPS[c].u })).sort((x, y) => y.cantidad - x.cantidad) })), registrado: results.map(r => Object.assign(r, { cultivo: cropName(r.cultivo) })) };
  }
  if (name === 'semillero') {
    const w = weekOf(a.fecha), row = p => ({ cultivo: p.c.n, cama_destino: where(p), semillas: p.cells * 2, sembrar_charola: iso(wkDate(p.ts)), trasplante: iso(wkDate(p.s)), primera_cosecha: iso(wkDate(p.h0)) });
    return { sembrar_esta_semana: P.P.filter(p => p.tray && p.ts === w).map(row), en_la_mesa: traysActive(P, w).map(row), proximas: P.P.filter(p => p.tray && p.ts > w && p.ts <= w + 8).map(row) };
  }
  if (name === 'cultivos') {
    const used = new Set(PLANTINGS.map(x => x[1]));
    return { cultivos: Object.entries(CROPS).filter(([k]) => used.has(k)).map(([k, c]) => ({ clave: k, nombre: c.n, metodo: c.met, semanas_a_cosecha: c.sem, semanas_de_cosecha: c.dur, rinde_por_semana_cama_A: c.kg + ' ' + c.u, menu: c.menu, nota: c.nota, semilla_en_bodega: (STOCK || {})[k] || null })), mejor_comprar: BUY };
  }
  if (name === 'reportar_cama') {
    const id = String(a.cama || '').toUpperCase().trim(), B = BED[id];
    if (!B) return { error: 'Cama no existe.' };
    if (!['limpia', 'lista', 'sembrada'].includes(a.estado)) return { error: 'estado: limpia, lista o sembrada' };
    let m = B.len, pos = 0;
    if (a.mitad) { m = B.len / 2; pos = (a.mitad === 'sur' || a.mitad === 'este') ? B.len / 2 : 0; }
    else if (a.metros) { m = Math.min(B.len, Number(a.metros)); pos = m >= B.len ? 0 : null; }
    if (!(m > 0)) return { error: 'metros inválidos' };
    let cultivo = '', fecha = isoMX(), cosecha = '';
    if (a.estado === 'sembrada') {
      cultivo = String(a.cultivo || '').trim(); if (!cultivo) return { error: 'Falta el cultivo' };
      const hit = Object.entries(CROPS).find(([k, c]) => k === cultivo.toLowerCase() || c.n.toLowerCase() === cultivo.toLowerCase()); if (hit) cultivo = hit[0];
      if (a.fecha) fecha = a.fecha;
      cosecha = a.cosecha || '';
      if (!cosecha && CROPS[cultivo]) { const d = new Date(fecha + 'T12:00:00'); d.setDate(d.getDate() + Math.round(CROPS[cultivo].sem * factor(fecha, CROPS[cultivo]) * 7)); cosecha = iso(d); }
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return { error: 'fecha YYYY-MM-DD' };
    await env.DB.prepare('INSERT INTO camas (cama, estado, m, pos, cultivo, fecha, cosecha) VALUES (?,?,?,?,?,?,?)').bind(id, a.estado, m, pos, cultivo.slice(0, 40), fecha, cosecha).run();
    return { ok: true, guardado: { cama: id, estado: a.estado, metros: m, cultivo: cultivo ? cropName(cultivo) : '', fecha, cosecha }, por: user.nombre };
  }
  if (name === 'registrar_cosecha') {
    const id = String(a.cama || '').toUpperCase().trim(), c = String(a.cultivo || '').trim(), cant = Number(a.cantidad);
    if (!BED[id] || !c || !(cant >= 0)) return { error: 'Faltan cama, cultivo o cantidad' };
    const fecha = a.fecha || isoMX(), u = a.unidad || (CROPS[c] ? CROPS[c].u : 'kg');
    await env.DB.prepare('INSERT INTO cosechas (fecha, cama, cultivo, cantidad, u, nota) VALUES (?,?,?,?,?,?)').bind(fecha, id, c.slice(0, 40), cant, u.slice(0, 10), (String(a.nota || '') + ' (vía Claude, ' + user.nombre + ')').trim().slice(0, 200)).run();
    return { ok: true, fecha, cama: id, cultivo: cropName(c), cantidad: cant, unidad: u };
  }
  if (name === 'marcar_tarea') {
    const w = weekOf(a.fecha), id = String(a.id || '').slice(0, 80);
    const t = weekTasks(P, w).find(x => x.id === id);
    if (!t) return { error: 'No hay tarea con ese id esa semana. Consulta resumen_semana.' };
    if (a.hecha === false) await env.DB.prepare('DELETE FROM hechas WHERE w=? AND task=?').bind(w, id).run();
    else await env.DB.prepare("INSERT OR REPLACE INTO hechas (w, task, estado, nota, txt) VALUES (?,?,'hecho','',?)").bind(w, id, (t.b ? t.b + ': ' : '') + t.t).run();
    return { ok: true, semana: w + 1, tarea: t.t, hecha: a.hecha !== false };
  }
  return { error: 'Herramienta desconocida' };
}

function instructions(user) {
  return `Huerto orgánico de Bodega Dos Búhos (San Miguel de Allende, ~2,000 m, heladas de noviembre a febrero). Abastece al restaurante. Conectado como ${user.nombre}. Hoy: ${isoMX()}.
Equipo: Adrián Bárcenas es el único jardinero (L–V 7:00–16:00, desayuno 10–11, ~40 h/semana); solo lee español y se comunica por WhatsApp. Eric y Melanie lo manejan a distancia.
Camas: sección A = 24 camas de 1 × 5 m (verdura y hierbas; tramos medidos de norte a sur). Sección B = 10 camas de 1.4 × 9.5 m, SOLO flores comestibles y decorativas (nunca verdura). Preferir camas completas o medias.
Semana 1 del plan empieza el lunes ${PLAN_START}. Cosecha a cocina: lunes, miércoles y viernes antes de las 10:00.
Usa las herramientas para cada dato; no inventes fechas ni kilos. Los reportes de cama y las cosechas registradas no cambian el plan de siembras: el plan (qué se siembra y cuándo) lo edita Eric con Claude en el código. Si alguien pide cambiar el plan, resume el cambio para pasárselo a Eric. Responde en el idioma de quien pregunta.`;
}

async function rpc(env, user, m) {
  if (!m || m.jsonrpc !== '2.0' || typeof m.method !== 'string') return m && m.id != null ? { jsonrpc: '2.0', id: m.id, error: { code: -32600, message: 'Invalid request' } } : null;
  const isNote = m.id == null;
  const ok = (result) => isNote ? null : { jsonrpc: '2.0', id: m.id, result };
  const fail = (code, message) => isNote ? null : { jsonrpc: '2.0', id: m.id, error: { code, message } };
  const params = m.params || {};
  switch (m.method) {
    case 'initialize': {
      const v = VERSIONS.includes(params.protocolVersion) ? params.protocolVersion : VERSIONS[0];
      return ok({ protocolVersion: v, capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'huerto-dos-buhos', title: 'Huerto Dos Búhos', version: '1.0.0' }, instructions: instructions(user) });
    }
    case 'ping': return ok({});
    case 'tools/list': return ok({ tools: TOOLS.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema, annotations: { readOnlyHint: t.ro } })) });
    case 'tools/call': {
      const name = String(params.name || '');
      if (!TOOLS.find(t => t.name === name)) return fail(-32602, 'Unknown tool ' + name);
      try {
        const out = await runTool(env, user, name, params.arguments || {});
        return ok({ content: [{ type: 'text', text: JSON.stringify(out).slice(0, 100000) }], isError: !!(out && out.error) });
      } catch (e) { return ok({ content: [{ type: 'text', text: 'Error: ' + String(e && e.message || e) }], isError: true }); }
    }
    default:
      if (m.method.startsWith('notifications/')) return null;
      if (m.method === 'resources/list') return ok({ resources: [] });
      if (m.method === 'prompts/list') return ok({ prompts: [] });
      return fail(-32601, 'Method not found');
  }
}
