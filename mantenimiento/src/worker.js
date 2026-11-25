// Mantenimiento Dos Búhos — Cloudflare Worker (API + static assets)
// Bindings: DB (D1), ASSETS (static files), optional PHOTOS (R2 bucket; without it photos live in D1).
//
// Access (Eric, 25 Nov 2026): people enter with a username and a password. Only an administrator creates people
// (Cuenta → Personas → Agregar persona: name, username, WhatsApp, and a temporary password typed or generated). The
// temporary one is good for 7 days and only lets them choose their own password. A session lasts a year and renews every
// time the app is opened. The very first person into an empty database becomes its administrator.

import { MAX_FAILS, LOCK_MIN, passProblem, hashPass, sameHex } from './auth.js';
import { MX_OFFSET_H, mxToday, addDaysYmd, fmtDate, parseMonths, monthsOnOrAfter, advancePlan, everyText, perYear, phoneKey, mergePhone } from './plan.js';

const COOKIE = 'mt_sid';
const SESSION_DAYS = 365;
const MAX_PHOTO_BYTES = 1900000;   // D1 rows top out at 2 MB; the phone compresses to ~250 KB
const MAX_THUMB_BYTES = 120000;
const STATUSES = ['pendiente', 'en_proceso', 'en_espera', 'hecha', 'cancelada'];
const STATUS_LABEL = { pendiente: 'Por hacer', en_proceso: 'En curso', en_espera: 'Esperando', hecha: 'Hecho', cancelada: 'No aplica' };
const WAIT_LABEL = { material: 'Esperando material', proveedor: 'Esperando al externo' };
const statusLabel = (s, w) => (s === 'en_espera' && WAIT_LABEL[w]) || STATUS_LABEL[s] || s;
const OPEN = ['pendiente', 'en_proceso', 'en_espera'];
const OPEN_SQL = "('pendiente','en_proceso','en_espera')";
const PRIORITY_LABEL = { 1: 'Urgente', 2: 'Alta', 3: 'Normal', 4: 'Baja' };
const COLORS = ['red', 'orange', 'amber', 'yellow', 'green', 'teal', 'cyan', 'blue', 'indigo', 'purple', 'pink', 'grey'];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      try {
        return await api(request, env, url);
      } catch (err) {
        if (err instanceof HttpError) return json({ error: err.message }, err.status);
        console.error(err);
        return json({ error: 'Algo falló en el servidor. Intenta de nuevo.' }, 500);
      }
    }
    return env.ASSETS.fetch(request);
  },
  // Cron (wrangler.jsonc → triggers.crons): creates the preventive work orders that are due, once a day
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runPM(env, true).catch((e) => console.error('pm', e)));
  },
};

// ---------- helpers ----------
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, msg) => { throw new HttpError(status, msg); };

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex', ...headers },
  });
}
async function body(request) {
  try { return await request.json(); } catch { fail(400, 'No se entendió lo que se envió'); }
}
const str = (v, max = 2000) => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
};
const int = (v) => {
  if (v === undefined || v === null || v === '') return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
};
const num = (v) => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};
const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
function hex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const randomHex = (bytes) => hex(crypto.getRandomValues(new Uint8Array(bytes)));
const normEmail = (v) => { const e = str(v, 120); return e ? e.toLowerCase() : null; };
const validEmail = (e) => !e || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

function getCookie(request, name) {
  const c = request.headers.get('cookie') || '';
  const m = c.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return m ? m[1] : null;
}
const sessionCookie = (token, maxAge) => `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

const USER_COLS = "u.id, u.name, u.username, u.role, u.provider_id, u.phone, u.email, (u.pin_hash != '') AS has_pass";
async function currentUser(request, env) {
  const token = getCookie(request, COOKIE);
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
  return env.DB.prepare(
    `SELECT ${USER_COLS} FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND u.active = 1`
  ).bind(token).first();
}
const isAdmin = (user) => user.role === 'admin';
function requireAdmin(user) {
  if (!isAdmin(user)) fail(403, 'Solo un administrador puede hacer esto');
}
async function addNote(env, taskId, userId, text, kind = 'nota') {
  await env.DB.prepare('INSERT INTO task_notes (task_id, user_id, kind, body) VALUES (?, ?, ?, ?)')
    .bind(taskId, userId, kind, text).run();
}
async function settings(env) {
  const { results } = await env.DB.prepare('SELECT key, value FROM settings').all();
  const s = Object.fromEntries(results.map((r) => [r.key, r.value]));
  return { coordinator: int(s.coordinator) };
}

// ---------- router ----------
async function api(request, env, url) {
  const path = url.pathname.replace(/\/+$/, '');
  const method = request.method;
  const seg = path.split('/').slice(2); // after /api

  // --- open endpoints ---
  if (path === '/api/status' && method === 'GET') {
    const user = await currentUser(request, env);
    return json({ user, first: !user && (await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first('n')) === 0 });
  }
  if (path === '/api/enter' && method === 'POST') return enter(request, env);
  if (path === '/api/logout' && method === 'POST') {
    const token = getCookie(request, COOKIE);
    if (token) await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
    return json({ ok: true }, 200, { 'set-cookie': sessionCookie('', 0) });
  }

  // --- everything below needs a signed-up person ---
  const user = await currentUser(request, env);
  if (!user) fail(401, 'Regístrate para continuar');

  if (path === '/api/bootstrap' && method === 'GET') {
    await env.DB.prepare("UPDATE users SET last_seen = datetime('now') WHERE id = ?").bind(user.id).run();
    const res = await bootstrap(env, user);
    // sliding session: every app open extends it another year
    res.headers.append('set-cookie', sessionCookie(getCookie(request, COOKIE), 60 * 60 * 24 * SESSION_DAYS));
    return res;
  }
  if (path === '/api/me' && method === 'PATCH') return updateMe(request, env, user);
  if (path === '/api/me/password' && method === 'POST') return changePassword(request, env, user);

  switch (seg[0]) {
    case 'tasks': return tasksApi(request, env, url, user, seg, method);
    case 'notes': return notesApi(env, user, seg, method);
    case 'photos': return photosApi(request, env, url, user, seg, method);
    case 'equipment': return equipmentApi(request, env, user, seg, method);
    case 'providers': return providersApi(request, env, user, seg, method);
    case 'areas': return areasApi(request, env, user, seg, method);
    case 'users': return usersApi(request, env, user, seg, method);
    case 'settings': return settingsApi(request, env, user, method);
    case 'pm': return pmApi(request, env, url, user, seg, method);
    case 'blocks': return blocksApi(request, env, url, user, seg, method);
    case 'pets': return petsApi(request, env, user, seg, method);
    case 'pet-events': return petEventsApi(request, env, user, seg, method);
    case 'feedback': return feedbackApi(request, env, user, seg, method);
    case 'summary': return summaryApi(env);
    case 'search': return searchApi(env, url);
  }
  fail(404, 'No encontrado');
}

// The steps of a pendiente: lines of its description written as a list ("1. …", "2) …", "- …", "• …").
// The page shows them as boxes; the client parses them the same way (stepsOf in core.js).
const STEP = /^\s*(?:\d{1,2}[.)]|[-*•]|\[[ xX]?\])\s+\S/;
const stepCount = (desc) => String(desc || '').split('\n').filter((l) => STEP.test(l)).length;

// ---------- entering: WhatsApp number and password ----------
async function startSession(env, userId) {
  const token = randomHex(32);
  await env.DB.prepare('INSERT INTO sessions (token, user_id) VALUES (?, ?)').bind(token, userId).run();
  const user = await env.DB.prepare(`SELECT ${USER_COLS} FROM users u WHERE u.id = ?`).bind(userId).first();
  return json({ user }, 200, { 'set-cookie': sessionCookie(token, 60 * 60 * 24 * SESSION_DAYS) });
}
const TEMP_DAYS = 7;
// A one-time code: six digits, easy to read out or type from a WhatsApp message.
function newCode() { const a = new Uint32Array(1); crypto.getRandomValues(a); return String(100000 + (a[0] % 900000)); }
// A username: lowercase letters, numbers, dot, dash or underscore; accents dropped. '' when it will not do.
function userName(v) {
  const u = String(v || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '');
  return /^[a-z0-9._-]{3,30}$/.test(u) ? u : '';
}
async function setCode(env, id, given) {
  const code = given || newCode(), salt = randomHex(16);
  await env.DB.prepare('UPDATE users SET temp_hash = ?, temp_salt = ?, temp_until = ?, failed_count = 0, locked_until = NULL WHERE id = ?')
    .bind(await hashPass(code, salt), salt, Date.now() + TEMP_DAYS * 864e5, id).run();
  return code;
}

// POST /api/enter { username, password, new_password?, name?, phone? }
// - a username with its password: in.
// - a username with its temporary password: answers { need_new: true } until a new_password comes with it, then in.
// - an empty database: the first person (name, username, WhatsApp, password) is its administrator.
async function enter(request, env) {
  const b = await body(request);
  const uname = userName(b.username);
  if (!uname) fail(400, 'Escribe tu usuario');
  const pass = typeof b.password === 'string' ? b.password : '';
  const now = Date.now();
  const u = await env.DB.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').bind(uname).first();

  if (!u) {
    const total = await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first('n');
    if (total > 0) fail(403, 'Ese usuario no existe en Esmero. Revisa cómo te lo dieron o pídelo a un administrador.');
    const name = str(b.name, 60), phone = str(b.phone, 40), key = phoneKey(phone);
    if (!name || name.length < 2) fail(400, 'Escribe tu nombre y apellido');
    if (!key) fail(400, 'Escribe tu WhatsApp con los 10 dígitos');
    const bad = passProblem(pass);
    if (bad) fail(400, bad);
    const salt = randomHex(16);
    const r = await env.DB.prepare("INSERT INTO users (name, username, pin_hash, pin_salt, role, phone, phone_key, provider_id) VALUES (?, ?, ?, ?, 'admin', ?, ?, ?)")
      .bind(name, uname, await hashPass(pass, salt), salt, phone, key, await cardFor(env, name, phone, key)).run();
    return startSession(env, r.meta.last_row_id);
  }
  if (!u.active) fail(403, 'Tu acceso está desactivado. Habla con un administrador de Esmero.');
  const rest = (ms) => `Demasiados intentos. Espera ${Math.max(1, Math.ceil(ms / 60000))} min o pide un código nuevo a un administrador.`;
  if (u.locked_until && u.locked_until > now) fail(429, rest(u.locked_until - now));

  const okPass = !!(u.pin_hash && pass && sameHex(await hashPass(pass, u.pin_salt), u.pin_hash));
  const okCode = !okPass && !!(u.temp_hash && u.temp_until > now && pass && sameHex(await hashPass(pass.trim(), u.temp_salt), u.temp_hash));
  if (!okPass && !okCode) {
    const fails = (u.failed_count || 0) + 1, lock = fails >= MAX_FAILS;
    await env.DB.prepare('UPDATE users SET failed_count = ?, locked_until = ? WHERE id = ?').bind(lock ? 0 : fails, lock ? now + LOCK_MIN * 60000 : null, u.id).run();
    if (lock) fail(429, rest(LOCK_MIN * 60000));
    if (!u.pin_hash && !(u.temp_hash && u.temp_until > now)) fail(401, 'Todavía no tienes contraseña. Pide a un administrador una temporal.');
    if (u.temp_hash && u.temp_until <= now && !u.pin_hash) fail(401, 'Tu contraseña temporal ya venció. Pide una nueva a un administrador.');
    const left = MAX_FAILS - fails;
    fail(401, `La contraseña no es esa.${left <= 3 ? (left === 1 ? ' Te queda 1 intento.' : ` Te quedan ${left} intentos.`) : ''}`);
  }
  if (okCode) {   // the one-time code: it opens the door to choosing a password, nothing else
    if (!b.new_password) return json({ need_new: true, name: first(u.name) });
    const bad = passProblem(b.new_password);
    if (bad) fail(400, bad);
    if (b.new_password.trim() === pass.trim()) fail(400, 'Elige una contraseña distinta a la temporal');
    const salt = randomHex(16);
    await env.DB.prepare('UPDATE users SET pin_hash = ?, pin_salt = ?, temp_hash = NULL, temp_salt = NULL, temp_until = NULL WHERE id = ?')
      .bind(await hashPass(b.new_password, salt), salt, u.id).run();
  }
  await env.DB.prepare('UPDATE users SET failed_count = 0, locked_until = NULL WHERE id = ?').bind(u.id).run();
  if (!u.provider_id && u.phone_key) await env.DB.prepare('UPDATE users SET provider_id = ? WHERE id = ? AND provider_id IS NULL').bind(await cardFor(env, u.name, u.phone, u.phone_key), u.id).run();
  return startSession(env, u.id);
}
const first = (n) => String(n || '').trim().split(/\s+/)[0];

async function changePassword(request, env, user) {
  const b = await body(request);
  const u = await env.DB.prepare('SELECT pin_hash, pin_salt FROM users WHERE id = ?').bind(user.id).first();
  if (u.pin_hash && !(typeof b.current === 'string' && sameHex(await hashPass(b.current, u.pin_salt), u.pin_hash))) fail(401, 'La contraseña actual no es esa');
  const bad = passProblem(b.password);
  if (bad) fail(400, bad);
  const salt = randomHex(16);
  await env.DB.prepare('UPDATE users SET pin_hash = ?, pin_salt = ?, temp_hash = NULL, temp_salt = NULL, temp_until = NULL WHERE id = ?').bind(await hashPass(b.password, salt), salt, user.id).run();
  await env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').bind(user.id, getCookie(request, COOKIE) || '').run();   // other phones ask again
  return json({ ok: true });
}

// The person's card in Contactos: the one Adrián or Eric may already have made for them (same phone), or a new one.
async function cardFor(env, name, phone, key) {
  const { results: cards } = await env.DB.prepare(
    `SELECT p.id, p.phone FROM providers p WHERE p.active = 1 AND p.phone IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM users x WHERE x.provider_id = p.id)`).all();
  const found = cards.find((p) => phoneKey(p.phone) === key);
  if (found) return found.id;
  const r = await env.DB.prepare("INSERT INTO providers (name, kind, phone) VALUES (?, 'interno', ?)").bind(name, phone).run();
  return r.meta.last_row_id;
}

async function updateMe(request, env, user) {
  const b = await body(request);
  const name = str(b.name, 60);
  if (!name || name.length < 2) fail(400, 'Escribe tu nombre y apellido');
  const email = normEmail(b.email);
  if (!validEmail(email)) fail(400, 'Revisa tu correo: le falta algo');
  const phone = mergePhone(user.phone, str(b.phone, 40));
  const key = phoneKey(phone);
  if (!key) fail(400, 'Escribe tu WhatsApp con los 10 dígitos');
  const dup = await env.DB.prepare(
    `SELECT CASE WHEN phone_key = ?1 THEN 'phone' WHEN name = ?2 COLLATE NOCASE THEN 'name' ELSE 'email' END AS what
     FROM users WHERE id != ?4 AND (phone_key = ?1 OR name = ?2 COLLATE NOCASE OR (?3 IS NOT NULL AND email = ?3 COLLATE NOCASE)) LIMIT 1`
  ).bind(key, name, email, user.id).first();
  if (dup) fail(409, dup.what === 'phone' ? 'Ese WhatsApp ya lo usa otra persona' : dup.what === 'name' ? 'Ya hay alguien con ese nombre' : 'Ese correo ya lo usa otra persona');
  await env.DB.prepare('UPDATE users SET name = ?, email = ?, phone = ?, phone_key = ? WHERE id = ?').bind(name, email, phone, key, user.id).run();
  if (user.provider_id) await env.DB.prepare('UPDATE providers SET name = ?, phone = ? WHERE id = ?').bind(name, phone, user.provider_id).run();
  return json({ user: await env.DB.prepare(`SELECT ${USER_COLS} FROM users u WHERE u.id = ?`).bind(user.id).first() });
}

async function bootstrap(env, user) {
  try { await runPM(env); } catch (e) { console.error('pm', e); }
  const today = mxToday();
  const [areas, providers, equipment, users, late, inbox, pets] = await env.DB.batch([
    env.DB.prepare('SELECT id, name, color, sort, active FROM areas ORDER BY sort, name'),
    env.DB.prepare(`SELECT p.id, p.name, p.kind, p.company, p.specialty, p.phone, p.notes, p.tags, p.active,
        (SELECT u.id FROM users u WHERE u.provider_id = p.id AND u.active = 1 LIMIT 1) AS user_id
      FROM providers p ORDER BY p.kind DESC, p.name COLLATE NOCASE`),
    env.DB.prepare('SELECT id, name, area_id, provider_id, category, active FROM equipment ORDER BY name COLLATE NOCASE'),
    env.DB.prepare(isAdmin(user)
      ? "SELECT id, name, username, role, active, provider_id, email, phone, last_seen, created_at, (pin_hash != '') AS has_pass, (temp_until > CAST(strftime('%s','now') AS INTEGER) * 1000) AS has_code FROM users ORDER BY active DESC, name COLLATE NOCASE"
      : 'SELECT id, name, role, active, provider_id FROM users WHERE active = 1 ORDER BY name COLLATE NOCASE'),
    // How many are late and how many wait in the Bandeja, so the counts are right on whichever screen the app opens.
    env.DB.prepare(`SELECT COUNT(*) AS n FROM tasks WHERE status IN ${OPEN_SQL} AND due_date IS NOT NULL AND due_date < ?`).bind(today),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM tasks WHERE status IN ${OPEN_SQL} AND due_date IS NULL`),
    env.DB.prepare('SELECT id, name, species FROM pets WHERE active = 1 ORDER BY name COLLATE NOCASE'),
  ]);
  return json({
    user,
    areas: areas.results,
    providers: providers.results,
    equipment: equipment.results,
    pets: pets.results,
    users: users.results,
    settings: await settings(env),
    late: late.results[0] ? late.results[0].n : 0,
    inbox: inbox.results[0] ? inbox.results[0].n : 0,
    today,
  });
}

// ---------- tasks ----------
function taskSelect({ list = false } = {}) {
  const cols = list
    ? `t.id, t.title, substr(t.description, 1, 240) AS description, t.kind, t.area_id, t.equipment_id, t.priority, t.status,
       t.provider_id, t.due_date, t.cost, t.created_by, t.created_at, t.updated_at, t.completed_at, t.wait_reason, t.pm_id,
       t.postponed, t.first_due, t.est_min, t.plan_min, t.place, t.checks, t.when_ok, t.pet_id`
    : 't.*';
  return `
  SELECT ${cols}, a.name AS area_name, a.color AS area_color, e.name AS equipment_name,
         p.name AS provider_name, p.kind AS provider_kind, p.specialty AS provider_specialty, p.phone AS provider_phone,
         u.name AS created_by_name, pt.name AS pet_name,
         (SELECT MIN(ph.id) FROM photos ph WHERE ph.task_id = t.id) AS thumb_id,
         (SELECT COUNT(*) FROM photos ph WHERE ph.task_id = t.id) AS photo_count,
         (SELECT COUNT(*) FROM task_notes n WHERE n.task_id = t.id AND n.kind = 'nota') AS note_count
  FROM tasks t
  LEFT JOIN areas a ON a.id = t.area_id
  LEFT JOIN equipment e ON e.id = t.equipment_id
  LEFT JOIN providers p ON p.id = t.provider_id
  LEFT JOIN users u ON u.id = t.created_by
  LEFT JOIN pets pt ON pt.id = t.pet_id`;
}
const getTask = (env, id) => env.DB.prepare(`${taskSelect()} WHERE t.id = ?`).bind(id).first();

async function providerName(env, id) {
  if (!id) return null;
  const p = await env.DB.prepare('SELECT name FROM providers WHERE id = ?').bind(id).first();
  if (!p) fail(400, 'Esa persona ya no está en Contactos');
  return p.name;
}

async function tasksApi(request, env, url, user, seg, method) {
  const id = int(seg[1]);

  if (!id && method === 'GET') {
    const q = url.searchParams;
    const where = [];
    const params = [];
    const view = q.get('view') || 'open';
    const today = mxToday();
    if (view === 'open') where.push(`t.status IN ${OPEN_SQL}`);
    else if (view === 'done') where.push("t.status IN ('hecha','cancelada')");
    if (q.get('provider')) { where.push('t.provider_id = ?'); params.push(int(q.get('provider'))); }
    if (q.get('mine')) { where.push('(t.created_by = ? OR (t.provider_id IS NOT NULL AND t.provider_id = ?))'); params.push(user.id, user.provider_id || -1); }
    if (q.get('equipment')) { where.push('t.equipment_id = ?'); params.push(int(q.get('equipment'))); }
    if (q.get('area')) { where.push('t.area_id = ?'); params.push(int(q.get('area'))); }
    if (q.get('pet')) { where.push('t.pet_id = ?'); params.push(int(q.get('pet'))); }
    if (q.get('q')) {
      where.push('(t.title LIKE ? OR t.description LIKE ? OR t.place LIKE ? OR CAST(t.id AS TEXT) = ?)');
      const like = '%' + q.get('q').slice(0, 100) + '%';
      params.push(like, like, like, q.get('q').replace(/^#/, ''));
    }
    const limit = Math.min(500, Math.max(1, int(q.get('limit')) || (view === 'open' ? 500 : 40)));
    const offset = Math.max(0, int(q.get('offset')) || 0);
    const order = view === 'done'
      ? 'COALESCE(t.completed_at, t.updated_at) DESC, t.id DESC'
      : 'CASE WHEN t.due_date IS NULL THEN 1 ELSE 0 END, t.due_date ASC, t.priority ASC, t.id ASC';
    const sql = `${taskSelect({ list: true })} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${order} LIMIT ${limit + 1} OFFSET ${offset}`;
    const { results } = await env.DB.prepare(sql).bind(...params).all();
    const more = results.length > limit;
    return json({ tasks: more ? results.slice(0, limit) : results, more, today });
  }

  if (!id && method === 'POST') {
    const b = await body(request);
    const title = str(b.title, 200);
    if (!title) fail(400, 'Escribe qué pasa');
    const kind = b.kind === 'servicio' ? 'servicio' : 'tarea';
    const priority = [1, 2, 3, 4].includes(int(b.priority)) ? int(b.priority) : 3;
    const status = kind === 'servicio' ? 'hecha' : 'pendiente';
    // No day unless the person reporting picks one: everything new waits in the Bandeja, urgent included, so that
    // days fill up because someone planned them and not because things were reported (Eric, 23 Nov 2026).
    // Only administrators put things on the calendar (Eric, 25 Nov 2026); the others say when suits them (when_ok).
    const dueDate = isDate(b.due_date) && (isAdmin(user) || kind === 'servicio' || (!!user.provider_id && int(b.provider_id) === user.provider_id)) ? b.due_date : null;
    // a service already done: its date goes in at midday Mexico time (18:00 UTC)
    const completedAt = status === 'hecha' ? (isDate(b.completed_date) ? `${b.completed_date} 18:00:00` : null) : null;
    let areaId = int(b.area_id);
    // "Otro lugar": somewhere that is not on the list of areas, in the reporter's words. It takes the area's spot.
    const place = areaId ? null : str(b.place, 80);
    const equipmentId = int(b.equipment_id);
    let providerId = int(b.provider_id);
    if (equipmentId) {
      const eq = await env.DB.prepare('SELECT area_id, provider_id FROM equipment WHERE id = ?').bind(equipmentId).first();
      if (!eq) fail(400, 'Ese equipo ya no existe');
      if (!areaId && !place) areaId = eq.area_id;
    }
    const who = await providerName(env, providerId);
    const r = await env.DB.prepare(
      `INSERT INTO tasks (title, description, kind, area_id, equipment_id, priority, status, provider_id,
                          due_date, first_due, cost, created_by, completed_at, place, when_ok, pet_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CASE WHEN ? = 'hecha' THEN datetime('now') END), ?, ?, ?)`
    ).bind(title, str(b.description, 4000), kind, areaId, equipmentId, priority, status, providerId,
      dueDate, dueDate, num(b.cost), user.id, completedAt, status, place, str(b.when_ok, 120), int(b.pet_id)).run();
    const newId = r.meta.last_row_id;
    let log = kind === 'servicio' ? `Servicio registrado por ${user.name}` : `Reportado por ${user.name}`;
    if (who) log += `, asignado a ${who}`;
    await addNote(env, newId, user.id, log, 'sistema');
    return json({ task: await getTask(env, newId) }, 201);
  }

  if (id && seg[2] === 'notes' && method === 'POST') {
    const b = await body(request);
    const text = str(b.body, 4000);
    if (!text) fail(400, 'La nota está vacía');
    const exists = await env.DB.prepare('SELECT id FROM tasks WHERE id = ?').bind(id).first();
    if (!exists) fail(404, 'Ese pendiente ya no existe');
    await addNote(env, id, user.id, text, 'nota');
    await env.DB.prepare("UPDATE tasks SET updated_at = datetime('now') WHERE id = ?").bind(id).run();
    return json({ ok: true }, 201);
  }

  if (id && seg[2] === 'photos' && method === 'POST') {
    const exists = await env.DB.prepare('SELECT id FROM tasks WHERE id = ?').bind(id).first();
    if (!exists) fail(404, 'Ese pendiente ya no existe');
    const photo = await savePhoto(request, env, user, { task_id: id });
    await env.DB.prepare("UPDATE tasks SET updated_at = datetime('now') WHERE id = ?").bind(id).run();
    return json({ photo }, 201);
  }

  if (id && !seg[2] && method === 'GET') {
    const task = await getTask(env, id);
    if (!task) fail(404, 'Ese pendiente ya no existe');
    const [notes, photos] = await env.DB.batch([
      env.DB.prepare(`SELECT n.id, n.kind, n.body, n.created_at, n.user_id, u.name AS user_name
                      FROM task_notes n LEFT JOIN users u ON u.id = n.user_id
                      WHERE n.task_id = ? ORDER BY n.created_at ASC, n.id ASC`).bind(id),
      env.DB.prepare(`SELECT ph.id, ph.user_id, ph.created_at, u.name AS user_name FROM photos ph
                      LEFT JOIN users u ON u.id = ph.user_id WHERE ph.task_id = ? ORDER BY ph.id`).bind(id),
    ]);
    return json({ task, notes: notes.results, photos: photos.results });
  }

  if (id && !seg[2] && method === 'PATCH') {
    const t = await getTask(env, id);
    if (!t) fail(404, 'Ese pendiente ya no existe');
    const b = await body(request);
    const sets = [];
    const params = [];
    const logs = [];
    const wasOpen = OPEN.includes(t.status);
    let clearPlan = false;

    if ('title' in b) {
      const v = str(b.title, 200);
      if (!v) fail(400, 'El título no puede quedar vacío');
      if (v !== t.title) { sets.push('title = ?'); params.push(v); }
    }
    if ('description' in b) {
      const v = str(b.description, 4000);
      if (v !== t.description) { sets.push('description = ?'); params.push(v); }
    }
    if ('checks' in b) {   // the ticked steps
      const v = Array.isArray(b.checks) ? [...new Set(b.checks.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n < 100))].sort((x, y) => x - y) : [];
      sets.push('checks = ?'); params.push(v.length ? JSON.stringify(v) : null);
    }
    // "¿Dónde?" has one answer: an area from the list, or a place written by hand. Whichever comes in takes the other's spot.
    if ('area_id' in b || 'place' in b) {
      let areaId = 'area_id' in b ? int(b.area_id) : t.area_id;
      let place = 'place' in b ? str(b.place, 80) : (t.place || null);
      if ('place' in b && place) areaId = null; else if ('area_id' in b && areaId) place = null;
      if (areaId !== t.area_id) {
        const a = areaId ? await env.DB.prepare('SELECT name FROM areas WHERE id = ?').bind(areaId).first() : null;
        if (areaId && !a) fail(400, 'Esa área ya no existe');
        sets.push('area_id = ?'); params.push(areaId);
        if (a || !place) logs.push(`Área: ${a ? a.name : 'sin área'}`);
      }
      if (place !== (t.place || null)) {
        sets.push('place = ?'); params.push(place);
        if (place) logs.push(`Lugar: ${place}`);
      }
    }
    if ('equipment_id' in b && int(b.equipment_id) !== t.equipment_id) {
      const e = int(b.equipment_id) ? await env.DB.prepare('SELECT name FROM equipment WHERE id = ?').bind(int(b.equipment_id)).first() : null;
      if (int(b.equipment_id) && !e) fail(400, 'Ese equipo ya no existe');
      sets.push('equipment_id = ?'); params.push(int(b.equipment_id));
      logs.push(e ? `Equipo: ${e.name}` : 'Sin equipo');
    }
    if ('priority' in b) {
      const v = int(b.priority);
      if (![1, 2, 3, 4].includes(v)) fail(400, 'Prioridad inválida');
      if (v !== t.priority) {
        sets.push('priority = ?'); params.push(v);
        logs.push(`Prioridad: de ${PRIORITY_LABEL[t.priority]} a ${PRIORITY_LABEL[v]}`);
      }
    }
    if ('status' in b) {
      if (!STATUSES.includes(b.status)) fail(400, 'Estado inválido');
      const wait = b.status === 'en_espera' && WAIT_LABEL[b.wait_reason] ? b.wait_reason : null;
      if (b.status !== t.status || (b.status === 'en_espera' && wait !== t.wait_reason)) {
        if (b.status !== t.status) {
          sets.push('status = ?'); params.push(b.status);
          if (b.status === 'hecha') {
            if (isDate(b.completed_date) && b.completed_date <= mxToday()) { sets.push('completed_at = ?'); params.push(`${b.completed_date} 18:00:00`); }
            else sets.push("completed_at = datetime('now')");
            // closed with steps left unticked: say so in its history, so it can be seen what was skipped
            const n = stepCount('description' in b ? b.description : t.description);
            if (n) {
              const done = ('checks' in b ? (Array.isArray(b.checks) ? b.checks : []) : JSON.parse(t.checks || '[]')).filter((i) => i < n).length;
              if (done < n) logs.push(n - done === 1 ? 'Se cerró con 1 paso sin marcar' : `Se cerró con ${n - done} pasos sin marcar`);
            }
          } else sets.push('completed_at = NULL');
        }
        sets.push('wait_reason = ?'); params.push(wait);
        logs.push(`Estado: de ${statusLabel(t.status, t.wait_reason)} a ${statusLabel(b.status, wait)}`);
      }
    }
    if ('provider_id' in b && int(b.provider_id) !== t.provider_id) {
      const pid = int(b.provider_id);
      const who = await providerName(env, pid);
      sets.push('provider_id = ?'); params.push(pid);
      logs.push(who ? (t.provider_name ? `Pasó de ${t.provider_name} a ${who}` : `Asignado a ${who}`) : 'Quedó sin asignar');
    }
    const newDay = 'due_date' in b && (isDate(b.due_date) ? b.due_date : null) !== t.due_date;
    const newHour = 'plan_min' in b && (int(b.plan_min) ?? null) !== (t.plan_min ?? null);
    // Administrators schedule anything; anyone else, only what is theirs to do, on their own calendar (Eric, 25 Nov 2026).
    const mineToDo = !!user.provider_id && t.provider_id === user.provider_id && !('provider_id' in b && int(b.provider_id) !== user.provider_id);
    if ((newDay || newHour) && !isAdmin(user) && !mineToDo) fail(403, 'Solo un administrador agenda lo de otros. Escribe en el reporte cuándo te conviene.');
    if ('when_ok' in b) {
      const v = str(b.when_ok, 120);
      if (v !== (t.when_ok || null)) { sets.push('when_ok = ?'); params.push(v); logs.push(v ? `Le conviene: ${v}` : 'Quitó cuándo le conviene'); }
    }
    if ('due_date' in b) {
      const v = isDate(b.due_date) ? b.due_date : null;
      if (v !== t.due_date) {
        sets.push('due_date = ?'); params.push(v);
        const reason = str(b.postpone_reason, 200);
        // Moved in the week planner before its day came: that is planning, not postponing.
        const replan = !!b.replan && !!t.due_date && t.due_date > mxToday();
        if (!v) clearPlan = true;
        if (v && t.due_date && v > t.due_date && wasOpen && !replan) {
          sets.push('postponed = postponed + 1');
          logs.push(`Pospuesto del ${fmtDate(t.due_date)} al ${fmtDate(v)}${reason ? '. Motivo: ' + reason : ''}`);
        } else {
          logs.push(v ? `Fecha: ${fmtDate(v)}${reason ? '. Motivo: ' + reason : ''}` : 'Sin fecha');
        }
        if (v && !t.first_due) { sets.push('first_due = ?'); params.push(v); }
      }
    }
    // week planner: the time of day (minutes after midnight) and how long it should take (minutes)
    if (clearPlan) { if (t.plan_min !== null) sets.push('plan_min = NULL'); }
    else if ('plan_min' in b) {
      const v = int(b.plan_min);
      const m = v !== null && v >= 0 && v < 1440 ? v : null;
      if (m !== t.plan_min) { sets.push('plan_min = ?'); params.push(m); }
    }
    if ('est_min' in b) {
      const v = int(b.est_min);
      const m = v !== null && v >= 5 && v <= 1440 ? v : null;
      if (m !== t.est_min) { sets.push('est_min = ?'); params.push(m); }
    }
    if ('cost' in b) {
      const v = num(b.cost);
      if (v !== t.cost) {
        sets.push('cost = ?'); params.push(v);
        logs.push(v ? `Costo: $${v.toLocaleString('es-MX')}` : 'Costo quitado');
      }
    }
    const note = str(b.note, 4000);
    if (sets.length || note) {
      sets.push("updated_at = datetime('now')");
      await env.DB.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).bind(...params, id).run();
      for (const l of logs) await addNote(env, id, user.id, `${l} (${user.name})`, 'sistema');
      if (note) await addNote(env, id, user.id, note, 'nota');
    }
    return json({ task: await getTask(env, id) });
  }

  if (id && !seg[2] && method === 'DELETE') {
    requireAdmin(user);
    if (env.PHOTOS) {
      const { results } = await env.DB.prepare('SELECT r2_key FROM photos WHERE task_id = ? AND r2_key IS NOT NULL').bind(id).all();
      for (const r of results) await env.PHOTOS.delete(r.r2_key);
    }
    await env.DB.batch([
      env.DB.prepare('DELETE FROM photos WHERE task_id = ?').bind(id),
      env.DB.prepare('DELETE FROM task_notes WHERE task_id = ?').bind(id),
      env.DB.prepare('DELETE FROM purchases WHERE task_id = ?').bind(id),
      env.DB.prepare('UPDATE pm_schedules SET last_task_id = NULL WHERE last_task_id = ?').bind(id),
      env.DB.prepare('DELETE FROM tasks WHERE id = ?').bind(id),
    ]);
    return json({ ok: true });
  }

  fail(404, 'No encontrado');
}

async function notesApi(env, user, seg, method) {
  const id = int(seg[1]);
  if (id && method === 'DELETE') {
    const n = await env.DB.prepare('SELECT * FROM task_notes WHERE id = ?').bind(id).first();
    if (!n) fail(404, 'Esa nota ya no existe');
    if (n.kind !== 'nota') fail(400, 'El historial automático no se borra');
    if (n.user_id !== user.id && !isAdmin(user)) fail(403, 'Solo quien la escribió o un administrador puede borrarla');
    await env.DB.prepare('DELETE FROM task_notes WHERE id = ?').bind(id).run();
    return json({ ok: true });
  }
  fail(404, 'No encontrado');
}

// ---------- photos ----------
// Body: multipart with `photo` (+ optional `thumb`, a small preview), or the image itself.
async function savePhoto(request, env, user, owner) {
  const ct = request.headers.get('content-type') || '';
  let buf, type, thumb = null;
  if (ct.startsWith('multipart/form-data')) {
    let form;
    try { form = await request.formData(); } catch { fail(400, 'No llegó la foto. Intenta de nuevo.'); }
    const f = form.get('photo');
    if (!f || typeof f === 'string') fail(400, 'No llegó la foto. Intenta de nuevo.');
    buf = await f.arrayBuffer();
    type = f.type || 'image/jpeg';
    const th = form.get('thumb');
    if (th && typeof th !== 'string') {
      const tb = await th.arrayBuffer();
      if (tb.byteLength && tb.byteLength <= MAX_THUMB_BYTES) thumb = tb;
    }
  } else {
    type = (ct || 'image/jpeg').split(';')[0];
    buf = await request.arrayBuffer();
  }
  if (!type.startsWith('image/')) fail(400, 'Solo se pueden subir fotos');
  if (!buf.byteLength) fail(400, 'La foto llegó vacía. Intenta de nuevo.');
  if (buf.byteLength > MAX_PHOTO_BYTES) fail(413, 'La foto es demasiado pesada');
  let r2Key = null;
  let data = null;
  if (env.PHOTOS) {
    r2Key = `${owner.task_id ? 't' + owner.task_id : owner.feedback_id ? 'f' + owner.feedback_id : owner.pet_id ? 'm' + owner.pet_id : 'e' + owner.equipment_id}/${randomHex(8)}`;
    await env.PHOTOS.put(r2Key, buf, { httpMetadata: { contentType: type } });
  } else {
    data = buf;
  }
  const r = await env.DB.prepare(
    'INSERT INTO photos (task_id, equipment_id, feedback_id, pet_id, user_id, content_type, r2_key, data, thumb) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(owner.task_id || null, owner.equipment_id || null, owner.feedback_id || null, owner.pet_id || null, user.id, type, r2Key, data, thumb).run();
  return { id: r.meta.last_row_id };
}
const bytes = (v) => (Array.isArray(v) ? new Uint8Array(v) : v);

async function photosApi(request, env, url, user, seg, method) {
  const id = int(seg[1]);
  if (!id) fail(404, 'No encontrado');
  if (method === 'GET') {
    const headers = { 'cache-control': 'private, max-age=31536000, immutable' };
    if (url.searchParams.get('t')) {
      const p = await env.DB.prepare('SELECT thumb FROM photos WHERE id = ?').bind(id).first();
      if (!p) fail(404, 'Esa foto ya no existe');
      if (p.thumb) return new Response(bytes(p.thumb), { headers: { ...headers, 'content-type': 'image/jpeg' } });
    }
    const p = await env.DB.prepare('SELECT content_type, r2_key, data FROM photos WHERE id = ?').bind(id).first();
    if (!p) fail(404, 'Esa foto ya no existe');
    let payload = bytes(p.data);
    if (p.r2_key && env.PHOTOS) {
      const obj = await env.PHOTOS.get(p.r2_key);
      if (!obj) fail(404, 'Esa foto ya no existe');
      payload = obj.body;
    }
    if (!payload) fail(404, 'Esa foto ya no existe');
    return new Response(payload, { headers: { ...headers, 'content-type': p.content_type } });
  }
  if (method === 'DELETE') {
    const p = await env.DB.prepare('SELECT user_id, r2_key FROM photos WHERE id = ?').bind(id).first();
    if (!p) fail(404, 'Esa foto ya no existe');
    if (p.user_id !== user.id && !isAdmin(user)) fail(403, 'Solo quien la subió o un administrador puede borrarla');
    if (p.r2_key && env.PHOTOS) await env.PHOTOS.delete(p.r2_key);
    await env.DB.prepare('DELETE FROM photos WHERE id = ?').bind(id).run();
    return json({ ok: true });
  }
  fail(404, 'No encontrado');
}

// ---------- time blocks ----------
// Someone's time on the calendar that is not a pendiente: "Huerto", "Compras". Everyone sees them (that is the point:
// when Adrián has room); only administrators write them. They do not repeat; "copy" brings last week's into this one.
const BLOCK_COLS = 'b.id, b.provider_id, b.day, b.start_min, b.end_min, b.title, p.name AS provider_name';
const getBlock = (env, id) => env.DB.prepare(`SELECT ${BLOCK_COLS} FROM blocks b LEFT JOIN providers p ON p.id = b.provider_id WHERE b.id = ?`).bind(id).first();
function blockFields(b, old = {}) {
  const day = 'day' in b ? (isDate(b.day) ? b.day : fail(400, 'Elige el día')) : old.day;
  const st = 'start_min' in b ? int(b.start_min) : old.start_min;
  const en = 'end_min' in b ? int(b.end_min) : old.end_min;
  if (st === null || en === null || st < 0 || en > 1440 || en - st < 15) fail(400, 'El bloque va de una hora a otra, de al menos 15 minutos');
  const title = 'title' in b ? str(b.title, 60) : old.title;
  if (!title) fail(400, 'Ponle nombre al bloque');
  const pid = 'provider_id' in b ? int(b.provider_id) : old.provider_id;
  if (!pid) fail(400, 'Elige de quién es el tiempo');
  return { day, st, en, title, pid };
}
async function blocksApi(request, env, url, user, seg, method) {
  const id = int(seg[1]);
  if (!id && method === 'GET') {   // ?from=YYYY-MM-DD&to=YYYY-MM-DD; also the names used before, for the suggestions
    const q = url.searchParams;
    const from = isDate(q.get('from')) ? q.get('from') : mxToday(), to = isDate(q.get('to')) ? q.get('to') : from;
    const [list, names] = await env.DB.batch([
      env.DB.prepare(`SELECT ${BLOCK_COLS} FROM blocks b LEFT JOIN providers p ON p.id = b.provider_id WHERE b.day BETWEEN ? AND ? ORDER BY b.day, b.start_min`).bind(from, to),
      env.DB.prepare('SELECT title FROM blocks GROUP BY title COLLATE NOCASE ORDER BY MAX(id) DESC LIMIT 30'),
    ]);
    return json({ blocks: list.results, names: names.results.map((r) => r.title) });
  }
  // administrators write anyone's time; anyone else, only their own
  const own = (pid) => isAdmin(user) || (!!user.provider_id && pid === user.provider_id);
  if (seg[1] === 'copy' && method === 'POST') {   // { from: monday, to: monday, provider_id }: last week's blocks into this one
    const b = await body(request);
    const pid = int(b.provider_id);
    if (!isDate(b.from) || !isDate(b.to) || !pid) fail(400, 'Faltan las semanas');
    if (!own(pid)) fail(403, 'Solo puedes copiar tu propio tiempo');
    const shift = Math.round((Date.parse(b.to) - Date.parse(b.from)) / 864e5);
    const had = await env.DB.prepare("SELECT COUNT(*) AS n FROM blocks WHERE provider_id = ? AND day BETWEEN ? AND date(?, '+6 days')").bind(pid, b.to, b.to).first('n');
    const r = await env.DB.prepare(`INSERT INTO blocks (provider_id, day, start_min, end_min, title, created_by)
      SELECT provider_id, date(day, ? || ' days'), start_min, end_min, title, ? FROM blocks
      WHERE provider_id = ? AND day BETWEEN ? AND date(?, '+6 days')
        AND NOT EXISTS (SELECT 1 FROM blocks x WHERE x.provider_id = blocks.provider_id AND x.day = date(blocks.day, ? || ' days') AND x.start_min = blocks.start_min AND x.title = blocks.title)`)
      .bind(String(shift >= 0 ? '+' + shift : shift), user.id, pid, b.from, b.from, String(shift >= 0 ? '+' + shift : shift)).run();
    return json({ copied: r.meta.changes, had });
  }
  if (!id && method === 'POST') {
    const f = blockFields(await body(request));
    if (!own(f.pid)) fail(403, 'Solo puedes bloquear tu propio tiempo');
    const r = await env.DB.prepare('INSERT INTO blocks (provider_id, day, start_min, end_min, title, created_by) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(f.pid, f.day, f.st, f.en, f.title, user.id).run();
    return json({ block: await getBlock(env, r.meta.last_row_id) }, 201);
  }
  const old = id && (await getBlock(env, id));
  if (!old) fail(404, 'Ese bloque ya no está');
  if (!own(old.provider_id)) fail(403, 'Ese tiempo es de otra persona');
  if (method === 'PATCH') {
    const f = blockFields(await body(request), old);
    if (!own(f.pid)) fail(403, 'Solo puedes bloquear tu propio tiempo');
    await env.DB.prepare('UPDATE blocks SET provider_id = ?, day = ?, start_min = ?, end_min = ?, title = ? WHERE id = ?').bind(f.pid, f.day, f.st, f.en, f.title, id).run();
    return json({ block: await getBlock(env, id) });
  }
  if (method === 'DELETE') {
    await env.DB.prepare('DELETE FROM blocks WHERE id = ?').bind(id).run();
    return json({ ok: true, block: old });
  }
  fail(404, 'No encontrado');
}

// ---------- sugerencias para la app ----------
// Anyone sends one (text, the screen it came from, a photo if they want); administrators see the list and mark it.
async function feedbackApi(request, env, user, seg, method) {
  const id = int(seg[1]);
  if (!id && method === 'POST') {
    const b = await body(request);
    const text = str(b.body, 4000);
    if (!text) fail(400, 'Escribe tu idea o lo que no funciona');
    const r = await env.DB.prepare('INSERT INTO feedback (user_id, body, screen, version) VALUES (?, ?, ?, ?)').bind(user.id, text, str(b.screen, 200), str(b.version, 40)).run();
    return json({ id: r.meta.last_row_id }, 201);
  }
  if (id && seg[2] === 'photos' && method === 'POST') {
    const f = await env.DB.prepare('SELECT user_id FROM feedback WHERE id = ?').bind(id).first();
    if (!f || (f.user_id !== user.id && !isAdmin(user))) fail(404, 'No encontrado');
    return json({ photo: await savePhoto(request, env, user, { feedback_id: id }) }, 201);
  }
  requireAdmin(user);
  if (!id && method === 'GET') {
    const { results } = await env.DB.prepare(`SELECT f.*, u.name AS user_name, (SELECT GROUP_CONCAT(ph.id) FROM photos ph WHERE ph.feedback_id = f.id) AS photo_ids
      FROM feedback f LEFT JOIN users u ON u.id = f.user_id ORDER BY CASE f.status WHEN 'nueva' THEN 0 ELSE 1 END, f.id DESC LIMIT 200`).all();
    return json({ feedback: results });
  }
  if (id && method === 'PATCH') {
    const b = await body(request);
    if (!['nueva', 'hecha', 'no'].includes(b.status)) fail(400, 'Estado no válido');
    await env.DB.prepare('UPDATE feedback SET status = ? WHERE id = ?').bind(b.status, id).run();
    return json({ ok: true });
  }
  fail(404, 'No encontrado');
}

// ---------- mascotas ----------
const PET_SELECT = `SELECT p.*, v.name AS vet_name, v.phone AS vet_phone,
    (SELECT MIN(ph.id) FROM photos ph WHERE ph.pet_id = p.id) AS cover_id,
    (SELECT COUNT(*) FROM tasks t WHERE t.pet_id = p.id AND t.status IN ${OPEN_SQL}) AS open_count,
    (SELECT MIN(e.next_due) FROM pet_events e WHERE e.pet_id = p.id AND e.next_due IS NOT NULL
       AND e.id = (SELECT x.id FROM pet_events x WHERE x.pet_id = e.pet_id AND x.kind = e.kind AND x.title = e.title COLLATE NOCASE ORDER BY x.day DESC, x.id DESC LIMIT 1)) AS next_due
  FROM pets p LEFT JOIN providers v ON v.id = p.provider_id`;
function petFields(b) {
  const born = /^\d{4}(-\d\d(-\d\d)?)?$/.test(String(b.born || '')) ? b.born : null;
  return { name: str(b.name, 80), species: str(b.species, 40), breed: str(b.breed, 80), sex: ['macho', 'hembra'].includes(b.sex) ? b.sex : null, born, provider_id: int(b.provider_id), notes: str(b.notes, 2000) };
}
async function petsApi(request, env, user, seg, method) {
  const id = int(seg[1]);
  if (!id && method === 'GET') {
    const { results } = await env.DB.prepare(`${PET_SELECT} WHERE p.active = 1 ORDER BY p.name COLLATE NOCASE`).all();
    return json({ pets: results, today: mxToday() });
  }
  if (!id && method === 'POST') {
    const f = petFields(await body(request));
    if (!f.name) fail(400, 'Escribe su nombre');
    const r = await env.DB.prepare('INSERT INTO pets (name, species, breed, sex, born, provider_id, notes) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(f.name, f.species, f.breed, f.sex, f.born, f.provider_id, f.notes).run();
    return json({ id: r.meta.last_row_id }, 201);
  }
  const pet = id && (await env.DB.prepare(`${PET_SELECT} WHERE p.id = ?`).bind(id).first());
  if (!pet) fail(404, 'Esa mascota ya no está');
  if (method === 'GET' && !seg[2]) {
    const [ev, ph, tk] = await env.DB.batch([
      env.DB.prepare('SELECT e.*, u.name AS user_name FROM pet_events e LEFT JOIN users u ON u.id = e.user_id WHERE e.pet_id = ? ORDER BY e.day DESC, e.id DESC').bind(id),
      env.DB.prepare('SELECT id, user_id, created_at FROM photos WHERE pet_id = ? ORDER BY id').bind(id),
      env.DB.prepare(`${taskSelect({ list: true })} WHERE t.pet_id = ? ORDER BY CASE WHEN t.status IN ${OPEN_SQL} THEN 0 ELSE 1 END, COALESCE(t.completed_at, t.created_at) DESC LIMIT 60`).bind(id),
    ]);
    return json({ pet, events: ev.results, photos: ph.results, tasks: tk.results, today: mxToday() });
  }
  if (method === 'PATCH' && !seg[2]) {
    const f = petFields(await body(request));
    if (!f.name) fail(400, 'Escribe su nombre');
    await env.DB.prepare('UPDATE pets SET name=?, species=?, breed=?, sex=?, born=?, provider_id=?, notes=? WHERE id=?')
      .bind(f.name, f.species, f.breed, f.sex, f.born, f.provider_id, f.notes, id).run();
    return json({ ok: true });
  }
  if (method === 'DELETE' && !seg[2]) {
    requireAdmin(user);
    await env.DB.prepare('UPDATE pets SET active = 0 WHERE id = ?').bind(id).run();
    return json({ ok: true });
  }
  if (seg[2] === 'photos' && method === 'POST') return json({ photo: await savePhoto(request, env, user, { pet_id: id }) }, 201);
  if (seg[2] === 'events' && method === 'POST') {   // a vaccine, deworming or visit; it closes the reminder that asked for it
    const b = await body(request);
    const kind = ['vacuna', 'desparasitacion', 'consulta', 'otro'].includes(b.kind) ? b.kind : 'vacuna';
    const title = str(b.title, 120);
    if (!title) fail(400, kind === 'vacuna' ? '¿Qué vacuna?' : 'Escribe qué se hizo');
    if (!isDate(b.day)) fail(400, 'Elige la fecha');
    const next = isDate(b.next_due) && b.next_due > b.day ? b.next_due : null;
    const r = await env.DB.prepare('INSERT INTO pet_events (pet_id, kind, title, day, next_due, cost, notes, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(id, kind, title, b.day, next, num(b.cost), str(b.notes, 2000), user.id).run();
    const open = await env.DB.prepare(`SELECT e.task_id FROM pet_events e JOIN tasks t ON t.id = e.task_id
      WHERE e.pet_id = ? AND e.kind = ? AND e.title = ? COLLATE NOCASE AND e.id != ? AND t.status IN ${OPEN_SQL}`).bind(id, kind, title, r.meta.last_row_id).all();
    for (const o of open.results) {
      await env.DB.prepare("UPDATE tasks SET status = 'hecha', completed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").bind(o.task_id).run();
      await addNote(env, o.task_id, user.id, `Hecho: se anotó en la ficha de ${pet.name} (${fmtDate(b.day)})`, 'sistema');
    }
    return json({ id: r.meta.last_row_id }, 201);
  }
  fail(404, 'No encontrado');
}
async function petEventsApi(request, env, user, seg, method) {
  const id = int(seg[1]);
  const e = id && (await env.DB.prepare('SELECT * FROM pet_events WHERE id = ?').bind(id).first());
  if (!e) fail(404, 'Ese registro ya no está');
  if (method === 'DELETE') {
    if (e.user_id !== user.id && !isAdmin(user)) fail(403, 'Solo quien lo anotó o un administrador puede borrarlo');
    await env.DB.prepare('DELETE FROM pet_events WHERE id = ?').bind(id).run();
    return json({ ok: true });
  }
  fail(404, 'No encontrado');
}

// ---------- equipment ----------
// last_service = the last service or preventive job done (repairs are in the history, not here).
const EQUIP_SELECT = `
  SELECT e.*, a.name AS area_name, a.color AS area_color, a.sort AS area_sort,
    p.name AS provider_name, p.phone AS provider_phone, p.kind AS provider_kind, p.specialty AS provider_specialty, hd.name AS holder_name,
    (SELECT MIN(ph.id) FROM photos ph WHERE ph.equipment_id = e.id) AS cover_id,
    (SELECT MAX(t.completed_at) FROM tasks t WHERE t.equipment_id = e.id AND t.status = 'hecha' AND t.kind IN ('servicio','preventivo')) AS last_service,
    (SELECT COUNT(*) FROM tasks t WHERE t.equipment_id = e.id AND t.status IN ${OPEN_SQL}) AS open_count,
    (SELECT COUNT(*) FROM tasks t WHERE t.equipment_id = e.id AND t.kind = 'tarea' AND t.created_at > datetime('now', '-90 days')) AS fails_90,
    (SELECT MIN(s.next_due) FROM pm_schedules s WHERE s.equipment_id = e.id AND s.active = 1) AS next_plan,
    (SELECT MIN(t.due_date) FROM tasks t WHERE t.equipment_id = e.id AND t.kind = 'preventivo' AND t.status IN ${OPEN_SQL}) AS next_open
  FROM equipment e
  LEFT JOIN areas a ON a.id = e.area_id
  LEFT JOIN providers p ON p.id = e.provider_id
  LEFT JOIN providers hd ON hd.id = e.holder_id`;

// next_service = the sooner of the preventive order already open and the plan's next date
const withNext = (e) => ({ ...e, next_service: [e.next_open, e.next_plan].filter(Boolean).sort()[0] || null });

function equipFields(b) {
  return {
    name: str(b.name, 120),
    area_id: int(b.area_id),
    location: str(b.location, 200),
    brand_model: str(b.brand_model, 200),
    serial: str(b.serial, 120),
    provider_id: int(b.provider_id),
    notes: str(b.notes, 4000),
    warranty_until: isDate(b.warranty_until) ? b.warranty_until : null,
    manual_url: /^https?:\/\//i.test(String(b.manual_url || '').trim()) ? str(b.manual_url, 500) : null,
    category: str(b.category, 60),
    state: EQ_STATES.includes(b.state) ? b.state : null,
    holder_id: int(b.holder_id),
    qty: int(b.qty) && int(b.qty) > 0 ? Math.min(int(b.qty), 100000) : null,
  };
}
const EQ_STATES = ['ok', 'falla', 'reparacion', 'baja'];   // NULL: por confirmar

async function equipmentApi(request, env, user, seg, method) {
  const id = int(seg[1]);
  if (!id && method === 'GET') {
    const { results } = await env.DB.prepare(`${EQUIP_SELECT} WHERE e.active = 1 ORDER BY a.sort, e.name COLLATE NOCASE`).all();
    return json({ equipment: results.map(withNext), today: mxToday() });
  }
  if (!id && method === 'POST') {
    const b = await body(request);
    const f = equipFields(b);
    if (!f.name) fail(400, 'Escribe el nombre del equipo');
    await providerName(env, f.provider_id);
    const r = await env.DB.prepare(
      `INSERT INTO equipment (name, area_id, location, brand_model, serial, provider_id, notes, warranty_until, manual_url, category, state, holder_id, qty)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(f.name, f.area_id, f.location, f.brand_model, f.serial, f.provider_id, f.notes, f.warranty_until, f.manual_url, f.category, f.state, f.holder_id, f.qty).run();
    const newId = r.meta.last_row_id;
    const today = mxToday();
    // "Last serviced on…" becomes the first entry of its history.
    if (isDate(b.last_service) && b.last_service <= today) {
      const s = await env.DB.prepare(
        `INSERT INTO tasks (title, kind, area_id, equipment_id, priority, status, provider_id, created_by, completed_at)
         VALUES (?, 'servicio', ?, ?, 3, 'hecha', ?, ?, ?)`
      ).bind('Servicio', f.area_id, newId, f.provider_id, user.id, `${b.last_service} 18:00:00`).run();
      await addNote(env, s.meta.last_row_id, user.id, `Último servicio anotado al dar de alta el equipo (${user.name})`, 'sistema');
    }
    // "Service N times a year" becomes its preventive plan.
    const months = parseMonths(Array.isArray(b.plan_months) ? b.plan_months.join(',') : b.plan_months);
    if (months.length) {
      await env.DB.prepare(
        `INSERT INTO pm_schedules (title, area_id, equipment_id, provider_id, priority, every_n, unit, months, day, next_due, lead_days, created_by)
         VALUES (?, ?, ?, ?, 3, NULL, 'months', ?, 1, ?, 7, ?)`
      ).bind(`Servicio: ${f.name}`, f.area_id, newId, f.provider_id, months.join(','), monthsOnOrAfter(months, 1, today), user.id).run();
      PM_LAST = 0;
      await runPM(env, true);
    }
    return json({ id: newId }, 201);
  }
  if (id && seg[2] === 'photos' && method === 'POST') {
    const exists = await env.DB.prepare('SELECT id FROM equipment WHERE id = ?').bind(id).first();
    if (!exists) fail(404, 'Ese equipo ya no existe');
    return json({ photo: await savePhoto(request, env, user, { equipment_id: id }) }, 201);
  }
  if (id && method === 'GET') {
    const e = await env.DB.prepare(`${EQUIP_SELECT} WHERE e.id = ?`).bind(id).first();
    if (!e) fail(404, 'Ese equipo ya no existe');
    const [tasks, photos, cost, pms] = await env.DB.batch([
      env.DB.prepare(`${taskSelect({ list: true })} WHERE t.equipment_id = ?
        ORDER BY CASE WHEN t.status IN ${OPEN_SQL} THEN 0 ELSE 1 END, COALESCE(t.completed_at, t.created_at) DESC LIMIT 100`).bind(id),
      env.DB.prepare('SELECT id, user_id, created_at FROM photos WHERE equipment_id = ? ORDER BY id').bind(id),
      env.DB.prepare(`SELECT COALESCE(SUM(t.cost), 0) AS total FROM tasks t WHERE t.equipment_id = ?
        AND COALESCE(t.completed_at, t.created_at) >= date('now', 'start of year')`).bind(id),
      env.DB.prepare(`${PM_SELECT} WHERE s.equipment_id = ? AND s.active = 1 ORDER BY s.next_due`).bind(id),
    ]);
    return json({
      equipment: withNext(e), tasks: tasks.results, photos: photos.results, year_cost: cost.results[0].total,
      pm: pms.results.map((s) => ({ ...s, every_text: everyText(s) })), today: mxToday(),
    });
  }
  if (id && method === 'PATCH') {
    const b = await body(request);
    if (!('name' in b) && ('state' in b || 'holder_id' in b)) {   // one tap on its page: how it is, who has it
      const sets = [], ps = [];
      if ('state' in b) { sets.push('state = ?'); ps.push(EQ_STATES.includes(b.state) ? b.state : null); }
      if ('holder_id' in b) { sets.push('holder_id = ?'); ps.push(int(b.holder_id)); }
      const r = await env.DB.prepare(`UPDATE equipment SET ${sets.join(', ')} WHERE id = ?`).bind(...ps, id).run();
      if (!r.meta.changes) fail(404, 'Ese equipo ya no existe');
      return json({ ok: true });
    }
    const f = equipFields(b);
    if (!f.name) fail(400, 'Escribe el nombre del equipo');
    await providerName(env, f.provider_id);
    const r = await env.DB.prepare(
      `UPDATE equipment SET name=?, area_id=?, location=?, brand_model=?, serial=?, provider_id=?, notes=?, warranty_until=?, manual_url=?, category=?, state=?, holder_id=?, qty=? WHERE id=?`
    ).bind(f.name, f.area_id, f.location, f.brand_model, f.serial, f.provider_id, f.notes, f.warranty_until, f.manual_url, f.category, f.state, f.holder_id, f.qty, id).run();
    if (!r.meta.changes) fail(404, 'Ese equipo ya no existe');
    return json({ ok: true });
  }
  if (id && method === 'DELETE') {
    requireAdmin(user);
    await env.DB.batch([
      env.DB.prepare('UPDATE equipment SET active = 0 WHERE id = ?').bind(id),
      env.DB.prepare('UPDATE pm_schedules SET active = 0 WHERE equipment_id = ?').bind(id),
    ]);
    return json({ ok: true });
  }
  fail(404, 'No encontrado');
}

// ---------- contacts (the house team + outside providers) ----------
async function providersApi(request, env, user, seg, method) {
  const id = int(seg[1]);
  if (!id && method === 'GET') {
    const today = mxToday();
    const { results } = await env.DB.prepare(`
      SELECT p.*,
        (SELECT u.id FROM users u WHERE u.provider_id = p.id AND u.active = 1 LIMIT 1) AS user_id,
        (SELECT COUNT(*) FROM tasks t WHERE t.provider_id = p.id AND t.status IN ${OPEN_SQL}) AS open_count,
        (SELECT COUNT(*) FROM tasks t WHERE t.provider_id = p.id AND t.status IN ${OPEN_SQL} AND t.due_date IS NOT NULL AND t.due_date < ?) AS late_count,
        (SELECT COUNT(*) FROM tasks t WHERE t.provider_id = p.id AND t.status = 'hecha') AS done_count
      FROM providers p WHERE p.active = 1 ORDER BY p.kind DESC, p.name COLLATE NOCASE`).bind(today).all();
    return json({ providers: results, today });
  }
  const fields = (b) => ({
    name: str(b.name, 120),
    kind: b.kind === 'interno' ? 'interno' : 'externo',
    company: str(b.company, 120),
    specialty: str(b.specialty, 120),
    phone: str(b.phone, 40),
    notes: str(b.notes, 2000),
    tags: Array.isArray(b.tags) ? JSON.stringify([...new Set(b.tags.map((x) => String(x).trim().slice(0, 40)).filter(Boolean))].slice(0, 8)) : null,
  });
  if (!id && method === 'POST') {
    const f = fields(await body(request));
    if (!f.name) fail(400, 'Escribe el nombre');
    const r = await env.DB.prepare('INSERT INTO providers (name, kind, company, specialty, phone, notes, tags) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(f.name, f.kind, f.company, f.specialty, f.phone, f.notes, f.tags).run();
    return json({ id: r.meta.last_row_id }, 201);
  }
  if (id && method === 'PATCH') {
    const f = fields(await body(request));
    if (!f.name) fail(400, 'Escribe el nombre');
    const r = await env.DB.prepare('UPDATE providers SET name=?, kind=?, company=?, specialty=?, phone=?, notes=?, tags=COALESCE(?, tags) WHERE id=?')
      .bind(f.name, f.kind, f.company, f.specialty, f.phone, f.notes, f.tags, id).run();
    if (!r.meta.changes) fail(404, 'Ese contacto ya no existe');
    return json({ ok: true });
  }
  if (id && method === 'DELETE') {
    requireAdmin(user);
    const linked = await env.DB.prepare('SELECT id FROM users WHERE provider_id = ? AND active = 1').bind(id).first();
    if (linked) fail(400, 'Esta persona usa la app. Para quitarla ve a Cuenta → Personas.');
    await env.DB.prepare('UPDATE providers SET active = 0 WHERE id = ?').bind(id).run();
    return json({ ok: true });
  }
  fail(404, 'No encontrado');
}

// ---------- areas (the coloured tags) ----------
async function areasApi(request, env, user, seg, method) {
  requireAdmin(user);
  const id = int(seg[1]);
  if (!id && method === 'POST') {
    const b = await body(request);
    const name = str(b.name, 40);
    if (!name) fail(400, 'Escribe el nombre del área');
    const color = COLORS.includes(b.color) ? b.color : null;
    const row = await env.DB.prepare('SELECT COALESCE(MAX(sort), 0) AS m, COUNT(*) AS n FROM areas').first();
    try {
      const r = await env.DB.prepare('INSERT INTO areas (name, sort, color) VALUES (?, ?, ?)')
        .bind(name, row.m + 1, color || COLORS[row.n % COLORS.length]).run();
      return json({ id: r.meta.last_row_id }, 201);
    } catch { fail(400, 'Esa área ya existe'); }
  }
  if (id && method === 'PATCH') {
    const b = await body(request);
    if ('name' in b) {
      const name = str(b.name, 40);
      if (!name) fail(400, 'El nombre no puede quedar vacío');
      try { await env.DB.prepare('UPDATE areas SET name = ? WHERE id = ?').bind(name, id).run(); }
      catch { fail(400, 'Esa área ya existe'); }
    }
    if ('color' in b && COLORS.includes(b.color)) await env.DB.prepare('UPDATE areas SET color = ? WHERE id = ?').bind(b.color, id).run();
    if ('active' in b) await env.DB.prepare('UPDATE areas SET active = ? WHERE id = ?').bind(b.active ? 1 : 0, id).run();
    if ('sort' in b && int(b.sort) !== null) await env.DB.prepare('UPDATE areas SET sort = ? WHERE id = ?').bind(int(b.sort), id).run();
    return json({ ok: true });
  }
  fail(404, 'No encontrado');
}

// ---------- people (administrators only) ----------
async function usersApi(request, env, user, seg, method) {
  requireAdmin(user);
  const id = int(seg[1]);
  if (!id && method === 'POST') {   // create someone: name, username, WhatsApp, role, temporary password (or one is made)
    const b = await body(request);
    const name = str(b.name, 60), uname = userName(b.username), phone = str(b.phone, 40), key = phoneKey(phone);
    if (!name || name.length < 2) fail(400, 'Escribe su nombre y apellido');
    if (!uname) fail(400, 'El usuario lleva de 3 a 30 letras o números, sin espacios (puede tener . - _)');
    if (!key) fail(400, 'Escribe su WhatsApp con los 10 dígitos');
    const temp = String(b.temp || '').trim();
    if (temp && temp.length < 6) fail(400, 'La contraseña temporal lleva al menos 6 caracteres');
    const dup = await env.DB.prepare('SELECT name, username, phone_key FROM users WHERE username = ? COLLATE NOCASE OR phone_key = ? OR name = ? COLLATE NOCASE').bind(uname, key, name).first();
    if (dup) fail(409, dup.username && dup.username.toLowerCase() === uname ? `Ese usuario ya es de ${dup.name}` : dup.phone_key === key ? `Ese WhatsApp ya es de ${dup.name}` : `Ya existe: ${dup.name}`);
    const r = await env.DB.prepare("INSERT INTO users (name, username, pin_hash, pin_salt, role, phone, phone_key, provider_id) VALUES (?, ?, '', '', ?, ?, ?, ?)")
      .bind(name, uname, b.role === 'admin' ? 'admin' : 'staff', phone, key, await cardFor(env, name, phone, key)).run();
    const nid = r.meta.last_row_id;
    return json({ id: nid, username: uname, code: await setCode(env, nid, temp), days: TEMP_DAYS });
  }
  if (id && seg[2] === 'code' && method === 'POST') {   // a new one-time code: the password they had stops working
    const u = await env.DB.prepare('SELECT id, username FROM users WHERE id = ?').bind(id).first();
    if (!u) fail(404, 'Esa persona ya no está');
    if (id === user.id) fail(400, 'Para cambiar tu contraseña ve a Mi cuenta');
    const b = await body(request).catch(() => ({}));
    const temp = String((b && b.temp) || '').trim();
    if (temp && temp.length < 6) fail(400, 'La contraseña temporal lleva al menos 6 caracteres');
    await env.DB.prepare("UPDATE users SET pin_hash = '', pin_salt = '' WHERE id = ?").bind(id).run();
    await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id).run();
    return json({ username: u.username, code: await setCode(env, id, temp), days: TEMP_DAYS });
  }
  if (id && method === 'PATCH') {
    const b = await body(request);
    const u = await env.DB.prepare('SELECT id, role, active FROM users WHERE id = ?').bind(id).first();
    if (!u) fail(404, 'Esa persona ya no está');
    if (id === user.id && (b.role === 'staff' || b.active === false)) fail(400, 'No puedes quitarte a ti mismo. Pídeselo a otro administrador.');
    if ('role' in b) await env.DB.prepare('UPDATE users SET role = ? WHERE id = ?').bind(b.role === 'admin' ? 'admin' : 'staff', id).run();
    if ('active' in b) {
      await env.DB.prepare('UPDATE users SET active = ? WHERE id = ?').bind(b.active ? 1 : 0, id).run();
      if (!b.active) await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id).run();
    }
    return json({ ok: true });
  }
  fail(404, 'No encontrado');
}

async function settingsApi(request, env, user, method) {
  requireAdmin(user);
  if (method !== 'PATCH') fail(404, 'No encontrado');
  const b = await body(request);
  const put = (k, v) => env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(k, v).run();
  if ('coordinator' in b) {
    const pid = int(b.coordinator);
    await providerName(env, pid);
    await put('coordinator', pid ? String(pid) : null);
  }
  return json({ settings: await settings(env) });
}

// ---------- preventive maintenance ----------
let PM_LAST = 0;
// Creates the work orders whose date (minus lead days) has arrived. Safe to run twice: the plan row is advanced with a
// compare-and-set on next_due before the order is inserted, so cron + page loads never duplicate.
async function runPM(env, force = false) {
  if (!force && Date.now() - PM_LAST < 5 * 60000) return 0;
  PM_LAST = Date.now();
  const today = mxToday();
  const { results } = await env.DB.prepare(
    `SELECT s.*, (SELECT status FROM tasks t WHERE t.id = s.last_task_id) AS last_status FROM pm_schedules s
     WHERE s.active = 1 AND date(s.next_due, '-' || s.lead_days || ' days') <= ? LIMIT 50`).bind(today).all();
  let made = 0;
  for (const s of results) made += await generateFromPM(env, s, today);
  made += await petReminders(env, today);
  return made;
}
// A vaccine or deworming coming due: a pendiente in the Bandeja a week before, once per record.
async function petReminders(env, today) {
  const { results } = await env.DB.prepare(`SELECT e.*, p.name AS pet_name, p.provider_id FROM pet_events e JOIN pets p ON p.id = e.pet_id
    WHERE p.active = 1 AND e.task_id IS NULL AND e.next_due IS NOT NULL AND date(e.next_due, '-7 days') <= ?
      AND e.id = (SELECT x.id FROM pet_events x WHERE x.pet_id = e.pet_id AND x.kind = e.kind AND x.title = e.title COLLATE NOCASE ORDER BY x.day DESC, x.id DESC LIMIT 1)
    LIMIT 20`).bind(today).all();
  const area = await env.DB.prepare("SELECT id FROM areas WHERE name = 'Mascotas'").first('id');
  let made = 0;
  for (const e of results) {
    const what = e.kind === 'desparasitacion' ? 'Desparasitar' : e.kind === 'vacuna' ? 'Vacuna' : 'Cita';
    const r = await env.DB.prepare(`INSERT INTO tasks (title, description, kind, area_id, priority, status, provider_id, due_date, first_due, pet_id)
      VALUES (?, ?, 'preventivo', ?, 3, 'pendiente', ?, ?, ?, ?)`)
      .bind(`${what}: ${e.pet_name} (${e.title})`, `Le toca el ${fmtDate(e.next_due)}. La última fue el ${fmtDate(e.day)}. Al hacerla, anótala en su ficha de Mascotas con la fecha de la siguiente.`, area, e.provider_id, e.next_due, e.next_due, e.pet_id).run();
    await env.DB.prepare('UPDATE pet_events SET task_id = ? WHERE id = ?').bind(r.meta.last_row_id, e.id).run();
    await addNote(env, r.meta.last_row_id, null, 'Lo creó la ficha de la mascota', 'sistema');
    made++;
  }
  return made;
}

async function generateFromPM(env, s, today) {
  // Don't pile up: while the previous order from this plan is still open, wait.
  if (s.last_status && OPEN.includes(s.last_status)) return 0;
  let next = advancePlan(s, s.next_due);
  let guard = 0;
  while (next && next < today && guard++ < 800) next = advancePlan(s, next); // catch up after long gaps
  const upd = await env.DB.prepare('UPDATE pm_schedules SET next_due = ?, active = ? WHERE id = ? AND next_due = ? AND active = 1')
    .bind(next || s.next_due, next ? 1 : 0, s.id, s.next_due).run();
  if (!upd.meta.changes) return 0;
  const due = s.next_due;
  const r = await env.DB.prepare(
    `INSERT INTO tasks (title, description, kind, area_id, equipment_id, priority, status, provider_id, due_date, first_due, created_by, pm_id)
     VALUES (?, ?, 'preventivo', ?, ?, ?, 'pendiente', ?, ?, ?, ?, ?)`
  ).bind(s.title, s.description, s.area_id, s.equipment_id, s.priority || 3, s.provider_id, due, due, s.created_by, s.id).run();
  const tid = r.meta.last_row_id;
  await env.DB.prepare('UPDATE pm_schedules SET last_task_id = ? WHERE id = ?').bind(tid, s.id).run();
  await addNote(env, tid, null, `Lo creó el plan preventivo (${everyText(s)})`, 'sistema');
  return 1;
}

function pmFields(b) {
  const unit = ['day', 'week', 'month', 'months', 'once'].includes(b.unit) ? b.unit : 'months';
  const months = unit === 'months' ? parseMonths(Array.isArray(b.months) ? b.months.join(',') : b.months) : [];
  const day = Math.min(31, Math.max(1, int(b.day) || 1));
  const today = mxToday();
  let nextDue = isDate(b.next_due) ? b.next_due : null;
  if (unit === 'months') nextDue = months.length ? monthsOnOrAfter(months, day, nextDue && nextDue > today ? nextDue : today) : null;
  return {
    title: str(b.title, 200),
    description: str(b.description, 4000),
    area_id: int(b.area_id),
    equipment_id: int(b.equipment_id),
    provider_id: int(b.provider_id),
    priority: [1, 2, 3, 4].includes(int(b.priority)) ? int(b.priority) : 3,
    every_n: unit === 'once' || unit === 'months' ? null : Math.min(365, Math.max(1, int(b.every_n) || 1)),
    unit,
    months: unit === 'months' ? months.join(',') : null,
    day: unit === 'months' ? day : null,
    next_due: nextDue,
    lead_days: Math.min(60, Math.max(0, int(b.lead_days) ?? 7)),
  };
}
async function checkPm(env, f) {
  if (!f.title) fail(400, 'Escribe qué hay que hacer');
  if (f.unit === 'months' && !f.months) fail(400, 'Elige al menos un mes');
  if (!f.next_due) fail(400, f.unit === 'once' ? 'Elige la fecha' : 'Elige desde cuándo');
  await providerName(env, f.provider_id);
  if (f.equipment_id) {
    const eq = await env.DB.prepare('SELECT area_id FROM equipment WHERE id = ?').bind(f.equipment_id).first();
    if (!eq) fail(400, 'Ese equipo ya no existe');
    if (!f.area_id) f.area_id = eq.area_id;
  }
}

const PM_SELECT = `SELECT s.*, a.name AS area_name, a.color AS area_color, e.name AS equipment_name, p.name AS provider_name,
  (SELECT status FROM tasks t WHERE t.id = s.last_task_id) AS last_status
  FROM pm_schedules s LEFT JOIN areas a ON a.id = s.area_id LEFT JOIN equipment e ON e.id = s.equipment_id
  LEFT JOIN providers p ON p.id = s.provider_id`;

async function pmApi(request, env, url, user, seg, method) {
  if (seg[1] === 'year' && method === 'GET') return pmYear(env, url);
  const id = int(seg[1]);
  if (!id && method === 'GET') {
    await runPM(env);
    const { results } = await env.DB.prepare(`${PM_SELECT} WHERE s.active = 1 ORDER BY s.next_due, s.title COLLATE NOCASE`).all();
    return json({ pm: results.map((s) => ({ ...s, every_text: everyText(s) })), today: mxToday() });
  }
  if (!id && method === 'POST') {
    const f = pmFields(await body(request));
    await checkPm(env, f);
    const r = await env.DB.prepare(
      `INSERT INTO pm_schedules (title, description, area_id, equipment_id, provider_id, priority, every_n, unit, months, day, next_due, lead_days, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(f.title, f.description, f.area_id, f.equipment_id, f.provider_id, f.priority, f.every_n, f.unit, f.months, f.day, f.next_due, f.lead_days, user.id).run();
    PM_LAST = 0;
    await runPM(env, true);
    return json({ id: r.meta.last_row_id }, 201);
  }
  if (id && seg[2] === 'run' && method === 'POST') {
    const s = await env.DB.prepare(`${PM_SELECT} WHERE s.id = ?`).bind(id).first();
    if (!s || !s.active) fail(404, 'Ese plan ya no existe');
    if (s.last_status && OPEN.includes(s.last_status)) return json({ ok: true, task_id: s.last_task_id });
    await generateFromPM(env, s, mxToday());
    const t = await env.DB.prepare('SELECT last_task_id FROM pm_schedules WHERE id = ?').bind(id).first();
    return json({ ok: true, task_id: t && t.last_task_id });
  }
  if (id && method === 'GET') {
    const s = await env.DB.prepare(`${PM_SELECT} WHERE s.id = ?`).bind(id).first();
    if (!s) fail(404, 'Ese plan ya no existe');
    const { results } = await env.DB.prepare(`${taskSelect({ list: true })} WHERE t.pm_id = ? ORDER BY t.id DESC LIMIT 24`).bind(id).all();
    return json({ pm: { ...s, every_text: everyText(s) }, tasks: results, today: mxToday() });
  }
  if (id && method === 'PATCH') {
    const f = pmFields(await body(request));
    await checkPm(env, f);
    const r = await env.DB.prepare(
      `UPDATE pm_schedules SET title=?, description=?, area_id=?, equipment_id=?, provider_id=?, priority=?, every_n=?, unit=?, months=?, day=?,
       next_due=?, lead_days=?, active=1 WHERE id=?`
    ).bind(f.title, f.description, f.area_id, f.equipment_id, f.provider_id, f.priority, f.every_n, f.unit, f.months, f.day, f.next_due, f.lead_days, id).run();
    if (!r.meta.changes) fail(404, 'Ese plan ya no existe');
    PM_LAST = 0;
    await runPM(env, true);
    return json({ ok: true });
  }
  if (id && method === 'DELETE') {
    await env.DB.prepare('UPDATE pm_schedules SET active = 0 WHERE id = ?').bind(id).run();
    return json({ ok: true });
  }
  fail(404, 'No encontrado');
}

// The year at a glance: every scheduled service of the year with what happened to it.
// status: done (hecho) · open (ya está en Pendientes) · late (se pasó la fecha) · future (programado)
async function pmYear(env, url) {
  const today = mxToday();
  const y = Math.min(2100, Math.max(2020, int(url.searchParams.get('y')) || Number(today.slice(0, 4))));
  const from = `${y}-01-01`;
  const to = `${y}-12-31`;
  await runPM(env);
  const [plans, tasks] = await env.DB.batch([
    env.DB.prepare(`${PM_SELECT} ORDER BY s.title COLLATE NOCASE`),
    // preventive orders by the date they were for; services logged by hand by the day they were done
    env.DB.prepare(`SELECT t.id, t.title, t.kind, t.status, t.pm_id, t.due_date, t.completed_at, t.equipment_id, t.area_id, t.provider_id,
        e.name AS equipment_name, a.name AS area_name, a.color AS area_color, p.name AS provider_name
      FROM tasks t LEFT JOIN equipment e ON e.id = t.equipment_id LEFT JOIN areas a ON a.id = t.area_id LEFT JOIN providers p ON p.id = t.provider_id
      WHERE t.status != 'cancelada' AND (
        (t.kind = 'preventivo' AND t.due_date >= ?1 AND t.due_date <= ?2)
        OR (t.kind = 'servicio' AND t.status = 'hecha' AND date(t.completed_at, '-6 hours') >= ?1 AND date(t.completed_at, '-6 hours') <= ?2))
      ORDER BY t.id LIMIT 1000`).bind(from, to),
  ]);
  const items = [];
  const seen = new Set();
  const freq = new Map(plans.results.map((s) => [s.id, perYear(s)]));
  for (const t of tasks.results) {
    const date = t.kind === 'servicio' ? new Date(Date.parse(t.completed_at.replace(' ', 'T') + 'Z') - MX_OFFSET_H * 3600000).toISOString().slice(0, 10) : t.due_date;
    if (t.pm_id) seen.add(`${t.pm_id}|${t.due_date}`);
    items.push({
      date, task_id: t.id, pm_id: t.pm_id, title: t.title, kind: t.kind, per_year: freq.get(t.pm_id) || 1,
      status: t.status === 'hecha' ? 'done' : t.due_date < today ? 'late' : 'open',
      done_at: t.status === 'hecha' ? t.completed_at : null,
      equipment_id: t.equipment_id, equipment_name: t.equipment_name, area_name: t.area_name, area_color: t.area_color, provider_name: t.provider_name,
      provider_id: t.provider_id,
    });
  }
  for (const s of plans.results) {
    if (!s.active) continue;
    let d = s.next_due;
    let guard = 0;
    while (d && d <= to && guard++ < 400) {
      if (d >= from && !seen.has(`${s.id}|${d}`)) {
        items.push({
          date: d, task_id: null, pm_id: s.id, title: s.title, kind: 'preventivo', per_year: freq.get(s.id) || 1, status: d < today ? 'late' : 'future', done_at: null,
          equipment_id: s.equipment_id, equipment_name: s.equipment_name, area_name: s.area_name, area_color: s.area_color, provider_name: s.provider_name,
          provider_id: s.provider_id,
        });
      }
      d = advancePlan(s, d);
    }
  }
  items.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
  return json({ year: y, today, items, plans: plans.results.filter((s) => s.active).length });
}

// ---------- summary (the numbers page) ----------
async function summaryApi(env) {
  const today = mxToday();
  const [tot, recent] = await env.DB.batch([
    env.DB.prepare(`SELECT
        SUM(CASE WHEN kind = 'tarea' AND created_at >= datetime('now', '-7 days') THEN 1 ELSE 0 END) AS new_7,
        SUM(CASE WHEN status = 'hecha' AND completed_at >= datetime('now', '-7 days') THEN 1 ELSE 0 END) AS done_7,
        SUM(CASE WHEN status = 'hecha' AND completed_at >= datetime('now', '-30 days') THEN 1 ELSE 0 END) AS done_30,
        AVG(CASE WHEN status = 'hecha' AND kind = 'tarea' AND completed_at >= datetime('now', '-30 days')
                 THEN julianday(completed_at) - julianday(created_at) END) AS avg_days,
        SUM(CASE WHEN status = 'hecha' AND completed_at >= date('now', 'start of month') THEN COALESCE(cost, 0) ELSE 0 END) AS cost_month
      FROM tasks`),
    env.DB.prepare(`SELECT kind, status, date(created_at, '-6 hours') AS c, date(completed_at, '-6 hours') AS d FROM tasks
      WHERE created_at >= datetime('now', '-63 days') OR completed_at >= datetime('now', '-63 days')`),
  ]);
  // eight weeks, Monday to Sunday, the current one last
  const [ty, tm, td] = today.split('-').map(Number);
  const dow = (new Date(Date.UTC(ty, tm - 1, td)).getUTCDay() + 6) % 7;
  const thisMonday = addDaysYmd(today, -dow);
  const weeks = [];
  for (let i = 7; i >= 0; i--) weeks.push({ start: addDaysYmd(thisMonday, -7 * i), created: 0, done: 0 });
  const slot = (ymd) => weeks.find((w) => ymd >= w.start && ymd <= addDaysYmd(w.start, 6));
  for (const r of recent.results) {
    if (r.kind === 'tarea' && r.c) { const w = slot(r.c); if (w) w.created++; }
    if (r.status === 'hecha' && r.d) { const w = slot(r.d); if (w) w.done++; }
  }
  const t = tot.results[0];
  return json({
    today, new_7: t.new_7 || 0, done_7: t.done_7 || 0, done_30: t.done_30 || 0,
    avg_days: t.avg_days === null ? null : Math.round(t.avg_days * 10) / 10, cost_month: t.cost_month || 0, weeks,
  });
}

// ---------- search ----------
async function searchApi(env, url) {
  const raw = (url.searchParams.get('q') || '').trim().slice(0, 80);
  if (raw.length < 2 && !/^#?\d+$/.test(raw)) return json({ tasks: [], equipment: [], providers: [] });
  const like = '%' + raw.replace(/[%_]/g, ' ') + '%';
  const [tasks, equipment, providers] = await env.DB.batch([
    env.DB.prepare(`${taskSelect({ list: true })} WHERE t.title LIKE ?1 OR t.description LIKE ?1 OR t.place LIKE ?1 OR CAST(t.id AS TEXT) = ?2
      ORDER BY CASE WHEN t.status IN ${OPEN_SQL} THEN 0 ELSE 1 END, t.id DESC LIMIT 25`).bind(like, raw.replace(/^#/, '')),
    env.DB.prepare(`SELECT e.id, e.name, e.location, e.brand_model, a.name AS area_name, a.color AS area_color,
        (SELECT MIN(ph.id) FROM photos ph WHERE ph.equipment_id = e.id) AS cover_id
      FROM equipment e LEFT JOIN areas a ON a.id = e.area_id
      WHERE e.active = 1 AND (e.name LIKE ?1 OR e.location LIKE ?1 OR e.brand_model LIKE ?1 OR e.serial LIKE ?1) ORDER BY e.name LIMIT 15`).bind(like),
    env.DB.prepare(`SELECT id, name, kind, company, specialty, phone FROM providers
      WHERE active = 1 AND (name LIKE ?1 OR company LIKE ?1 OR specialty LIKE ?1) ORDER BY name LIMIT 10`).bind(like),
  ]);
  return json({ tasks: tasks.results, equipment: equipment.results, providers: providers.results });
}
