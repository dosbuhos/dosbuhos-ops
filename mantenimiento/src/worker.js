// Mantenimiento Dos Búhos — Cloudflare Worker (API + static assets)
// Bindings: DB (D1), ASSETS (static files), optional PHOTOS (R2 bucket), optional EMAIL (send_email).
// Vars: MAIL_FROM (e.g. mantenimiento@dosbuhos.com) — needed only for email login.

const COOKIE = 'mt_sid';
const SESSION_DAYS = 365;
const LINK_DAYS = 7;          // WhatsApp / copy links
const EMAIL_LINK_MIN = 30;    // email links + codes
const LINK_MAX_USES = 5;      // same link can open on phone browser + home-screen app
const MAX_PHOTO_BYTES = 4 * 1024 * 1024;
const STATUSES = ['pendiente', 'en_proceso', 'en_espera', 'hecha', 'cancelada'];
const STATUS_LABEL = {
  pendiente: 'Por hacer', en_proceso: 'En curso', en_espera: 'Esperando',
  hecha: 'Hecho', cancelada: 'No aplica',
};
const WAIT_LABEL = { material: 'Esperando material', proveedor: 'Esperando proveedor' };
const statusLabel = (s, w) => (s === 'en_espera' && WAIT_LABEL[w]) || STATUS_LABEL[s] || s;
const OPEN_SQL = "('pendiente','en_proceso','en_espera')";
const PURCHASE_STATUSES = ['pedido', 'comprado', 'recibido', 'cancelado'];
const PURCHASE_LABEL = { pedido: 'Pedido', comprado: 'Comprado', recibido: 'Recibido', cancelado: 'Cancelado' };
// San Miguel de Allende: UTC-6 todo el año (sin horario de verano desde 2022)
const MX_OFFSET_H = 6;
const mxToday = () => new Date(Date.now() - MX_OFFSET_H * 3600000).toISOString().slice(0, 10);
function addDaysYmd(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
function addMonthsYmd(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  const last = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + n, Math.min(d, last))).toISOString().slice(0, 10);
}
function advanceYmd(ymd, n, unit) {
  n = Math.max(1, n || 1);
  if (unit === 'day') return addDaysYmd(ymd, n);
  if (unit === 'week') return addDaysYmd(ymd, 7 * n);
  if (unit === 'month') return addMonthsYmd(ymd, n);
  return null; // 'once'
}

// ---------- schema detection (the Worker keeps working before migration 0005 is applied) ----------
let SCHEMA = null;
let SCHEMA_AT = 0;
async function schema(env) {
  if (SCHEMA && Date.now() - SCHEMA_AT < 60000) return SCHEMA;
  const [tables, tcols, ecols] = await env.DB.batch([
    env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table'"),
    env.DB.prepare("SELECT name FROM pragma_table_info('tasks')"),
    env.DB.prepare("SELECT name FROM pragma_table_info('equipment')"),
  ]);
  const t = new Set(tables.results.map((r) => r.name));
  const tc = new Set(tcols.results.map((r) => r.name));
  const ec = new Set(ecols.results.map((r) => r.name));
  SCHEMA = {
    pm: t.has('pm_schedules') && tc.has('pm_id'),
    purchases: t.has('purchases'),
    wait: tc.has('wait_reason'),
    equipExtra: ec.has('warranty_until'),
  };
  SCHEMA.ready = SCHEMA.pm && SCHEMA.purchases && SCHEMA.wait && SCHEMA.equipExtra;
  SCHEMA_AT = Date.now();
  return SCHEMA;
}
const needs = (ok) => { if (!ok) fail(409, 'Falta aplicar la migración 0005 de la base de datos'); };
const PRIORITY_LABEL = { 1: 'Urgente', 2: 'Alta', 3: 'Normal', 4: 'Baja' };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      try {
        return await api(request, env, url);
      } catch (err) {
        if (err instanceof HttpError) return json({ error: err.message }, err.status);
        console.error(err);
        return json({ error: 'Error del servidor: ' + (err.message || err) }, 500);
      }
    }
    return env.ASSETS.fetch(request);
  },
  // Cron (wrangler.jsonc → triggers.crons): genera las órdenes del plan preventivo una vez al día
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
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

async function body(request) {
  try { return await request.json(); } catch { fail(400, 'JSON inválido'); }
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
  return Number.isFinite(n) ? n : null;
};
const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

function hex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function randomHex(bytes) {
  return hex(crypto.getRandomValues(new Uint8Array(bytes)));
}
async function hashPin(pin, saltHex) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const salt = new Uint8Array(saltHex.match(/../g).map((h) => parseInt(h, 16)));
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 }, key, 256);
  return hex(bits);
}
async function sha256(text) {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}
const emailOn = (env) => !!(env.EMAIL && env.MAIL_FROM);
const normEmail = (v) => { const e = str(v, 120); return e ? e.toLowerCase() : null; };
const validEmail = (e) => !e || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
function validPin(pin) {
  return typeof pin === 'string' && /^\d{4,8}$/.test(pin);
}
function getCookie(request, name) {
  const c = request.headers.get('cookie') || '';
  const m = c.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return m ? m[1] : null;
}
function sessionCookie(token, maxAge) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

async function currentUser(request, env) {
  const token = getCookie(request, COOKIE);
  if (!token) return null;
  return env.DB.prepare(
    `SELECT u.id, u.name, u.role, u.provider_id FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = ? AND u.active = 1`
  ).bind(token).first();
}

function requireAdmin(user) {
  if (user.role !== 'admin') fail(403, 'Solo un administrador puede hacer esto');
}

async function addNote(env, taskId, userId, body, kind = 'nota') {
  await env.DB.prepare('INSERT INTO task_notes (task_id, user_id, kind, body) VALUES (?, ?, ?, ?)')
    .bind(taskId, userId, kind, body).run();
}

// ---------- router ----------
async function api(request, env, url) {
  const path = url.pathname.replace(/\/+$/, '');
  const method = request.method;
  const seg = path.split('/').slice(2); // after /api

  // --- public endpoints ---
  if (path === '/api/status' && method === 'GET') {
    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first('n');
    const user = await currentUser(request, env);
    const names = user ? [] : (await env.DB.prepare(
      "SELECT id, name FROM users WHERE active = 1 AND pin_hash != '' ORDER BY name").all()).results;
    return json({ setup: count === 0, user, names, email: emailOn(env) });
  }

  if (path === '/api/setup' && method === 'POST') {
    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first('n');
    if (count > 0) fail(400, 'La app ya está configurada');
    const b = await body(request);
    const name = str(b.name, 60);
    if (!name) fail(400, 'Escribe tu nombre');
    if (!validPin(b.pin)) fail(400, 'El PIN debe ser de 4 a 8 dígitos');
    const salt = randomHex(16);
    const r = await env.DB.prepare(
      "INSERT INTO users (name, pin_hash, pin_salt, role) VALUES (?, ?, ?, 'admin')"
    ).bind(name, await hashPin(b.pin, salt), salt).run();
    return startSession(env, r.meta.last_row_id);
  }

  if (path === '/api/login' && method === 'POST') {
    const b = await body(request);
    const u = await env.DB.prepare('SELECT * FROM users WHERE id = ? AND active = 1').bind(int(b.user_id)).first();
    if (!u) fail(401, 'Usuario no encontrado');
    const now = Date.now();
    if (u.locked_until && u.locked_until > now) {
      const mins = Math.ceil((u.locked_until - now) / 60000);
      fail(429, `Demasiados intentos. Intenta en ${mins} min.`);
    }
    const ok = validPin(b.pin) && (await hashPin(b.pin, u.pin_salt)) === u.pin_hash;
    if (!ok) {
      const fails = u.failed_count + 1;
      const lock = fails >= 5 ? now + 15 * 60000 : null;
      await env.DB.prepare('UPDATE users SET failed_count = ?, locked_until = ? WHERE id = ?')
        .bind(lock ? 0 : fails, lock, u.id).run();
      fail(401, lock ? 'PIN incorrecto. Bloqueado 15 min.' : 'PIN incorrecto');
    }
    await env.DB.prepare('UPDATE users SET failed_count = 0, locked_until = NULL WHERE id = ?').bind(u.id).run();
    return startSession(env, u.id);
  }

  // --- link / email login ---
  if (path === '/api/auth/link' && method === 'POST') {
    const b = await body(request);
    if (typeof b.token !== 'string' || b.token.length < 20) fail(400, 'Enlace inválido');
    const row = await env.DB.prepare(
      `SELECT l.*, u.active FROM login_links l JOIN users u ON u.id = l.user_id WHERE l.token_hash = ?`
    ).bind(await sha256(b.token)).first();
    if (!row || !row.active || row.expires_at < Date.now() || row.uses >= LINK_MAX_USES) {
      fail(401, 'Este enlace ya no sirve. Pide uno nuevo.');
    }
    await env.DB.prepare('UPDATE login_links SET uses = uses + 1 WHERE id = ?').bind(row.id).run();
    return startSession(env, row.user_id);
  }

  if (path === '/api/auth/email' && method === 'POST') {
    if (!emailOn(env)) fail(400, 'El acceso por correo no está activado');
    const b = await body(request);
    const email = normEmail(b.email);
    if (!email || !validEmail(email)) fail(400, 'Escribe un correo válido');
    const u = await env.DB.prepare('SELECT id, name FROM users WHERE email = ? COLLATE NOCASE AND active = 1').bind(email).first();
    // Same answer whether or not the address exists
    if (u) {
      const recent = await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM login_links WHERE user_id = ? AND via = 'email' AND created_at > datetime('now','-15 minutes')"
      ).bind(u.id).first('n');
      if (recent < 3) await sendEmailAccess(env, request, u, email);
    }
    return json({ ok: true });
  }

  if (path === '/api/auth/code' && method === 'POST') {
    const b = await body(request);
    const email = normEmail(b.email);
    const code = String(b.code || '').replace(/\D/g, '');
    if (!email || code.length !== 6) fail(400, 'Escribe el código de 6 dígitos');
    const row = await env.DB.prepare(
      `SELECT l.* FROM login_links l JOIN users u ON u.id = l.user_id
       WHERE u.email = ? COLLATE NOCASE AND u.active = 1 AND l.via = 'email' AND l.code_hash IS NOT NULL
       ORDER BY l.id DESC LIMIT 1`
    ).bind(email).first();
    if (!row || row.expires_at < Date.now() || row.attempts >= 5 || row.uses >= LINK_MAX_USES) {
      fail(401, 'El código venció. Pide uno nuevo.');
    }
    if ((await sha256(row.id + ':' + code)) !== row.code_hash) {
      await env.DB.prepare('UPDATE login_links SET attempts = attempts + 1 WHERE id = ?').bind(row.id).run();
      fail(401, 'Código incorrecto');
    }
    await env.DB.prepare('UPDATE login_links SET uses = uses + 1 WHERE id = ?').bind(row.id).run();
    return startSession(env, row.user_id);
  }

  if (path === '/api/logout' && method === 'POST') {
    const token = getCookie(request, COOKIE);
    if (token) await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
    return json({ ok: true }, 200, { 'set-cookie': sessionCookie('', 0) });
  }

  // --- everything below requires a session ---
  const user = await currentUser(request, env);
  if (!user) fail(401, 'Inicia sesión');

  if (path === '/api/bootstrap' && method === 'GET') {
    await env.DB.prepare("UPDATE users SET last_seen = datetime('now') WHERE id = ?").bind(user.id).run();
    const res = await bootstrap(env, user);
    // sliding session: every app open extends it another year
    res.headers.append('set-cookie', sessionCookie(getCookie(request, COOKIE), 60 * 60 * 24 * SESSION_DAYS));
    return res;
  }

  if (path === '/api/me/pin' && method === 'POST') {
    const b = await body(request);
    if (!validPin(b.pin)) fail(400, 'El PIN debe ser de 4 a 8 dígitos');
    const salt = randomHex(16);
    await env.DB.prepare('UPDATE users SET pin_hash = ?, pin_salt = ? WHERE id = ?')
      .bind(await hashPin(b.pin, salt), salt, user.id).run();
    return json({ ok: true });
  }

  switch (seg[0]) {
    case 'tasks': return tasksApi(request, env, url, user, seg, method);
    case 'notes': return notesApi(request, env, user, seg, method);
    case 'photos': return photosApi(request, env, user, seg, method);
    case 'equipment': return equipmentApi(request, env, url, user, seg, method);
    case 'providers': return providersApi(request, env, user, seg, method);
    case 'areas': return areasApi(request, env, user, seg, method);
    case 'users': return usersApi(request, env, user, seg, method);
    case 'pm': return pmApi(request, env, url, user, seg, method);
    case 'purchases': return purchasesApi(request, env, url, user, seg, method);
    case 'summary': return summaryApi(env, user);
    case 'search': return searchApi(env, url);
    case 'calendar': return calendarApi(env, url);
  }
  fail(404, 'No encontrado');
}

async function startSession(env, userId) {
  const token = randomHex(32);
  await env.DB.prepare('INSERT INTO sessions (token, user_id) VALUES (?, ?)').bind(token, userId).run();
  const user = await env.DB.prepare('SELECT id, name, role, provider_id FROM users WHERE id = ?').bind(userId).first();
  return json({ user }, 200, { 'set-cookie': sessionCookie(token, 60 * 60 * 24 * SESSION_DAYS) });
}

// ---------- access links ----------
async function createLink(env, userId, createdBy, via, ms, withCode) {
  const token = randomHex(24);
  const r = await env.DB.prepare(
    'INSERT INTO login_links (user_id, token_hash, via, expires_at, created_by) VALUES (?, ?, ?, ?, ?)'
  ).bind(userId, await sha256(token), via, Date.now() + ms, createdBy).run();
  let code = null;
  if (withCode) {
    code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, '0');
    await env.DB.prepare('UPDATE login_links SET code_hash = ? WHERE id = ?').bind(await sha256(r.meta.last_row_id + ':' + code), r.meta.last_row_id).run();
  }
  return { token, code };
}
// The token rides in the #fragment so link-preview bots (WhatsApp, Mail) never see or spend it.
const linkUrl = (request, token) => `${new URL(request.url).origin}/#/entrar/${token}`;

async function sendEmailAccess(env, request, u, email) {
  const { token, code } = await createLink(env, u.id, null, 'email', EMAIL_LINK_MIN * 60000, true);
  const url = linkUrl(request, token);
  const first = (u.name || '').split(' ')[0];
  await env.EMAIL.send({
    from: { email: env.MAIL_FROM, name: 'Mantenimiento Dos Búhos' },
    to: email,
    subject: `Tu acceso a Mantenimiento: ${code}`,
    text: `Hola ${first}:\n\nEntra a Mantenimiento Dos Búhos con este enlace:\n${url}\n\nO escribe este código en la app: ${code}\n\nVence en ${EMAIL_LINK_MIN} minutos. Si no lo pediste, ignora este correo.`,
    html: `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:420px;margin:0 auto;padding:24px;color:#111">
      <p style="font-size:16px">Hola ${first.replace(/[<>&]/g, '')}:</p>
      <p style="font-size:16px">Toca el botón para entrar a Mantenimiento Dos Búhos.</p>
      <p><a href="${url}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:14px 22px;border-radius:10px;font-weight:600;font-size:16px">Entrar</a></p>
      <p style="font-size:15px;color:#555">O escribe este código en la app:</p>
      <p style="font-size:30px;font-weight:700;letter-spacing:6px;margin:4px 0 20px">${code}</p>
      <p style="font-size:13px;color:#888">Vence en ${EMAIL_LINK_MIN} minutos. Si no lo pediste, ignora este correo.</p></div>`,
  });
}

async function bootstrap(env, user) {
  try { await runPM(env); } catch (e) { console.error('pm', e); }
  const sc = await schema(env);
  const [areas, providers, equipment, users] = await env.DB.batch([
    env.DB.prepare('SELECT id, name, sort, active FROM areas ORDER BY sort, name'),
    env.DB.prepare('SELECT id, name, kind, company, specialty, phone, notes, active FROM providers ORDER BY kind DESC, name'),
    env.DB.prepare('SELECT id, name, area_id, active FROM equipment ORDER BY name'),
    env.DB.prepare(user.role === 'admin'
      ? "SELECT id, name, role, active, provider_id, email, phone, last_seen, (pin_hash != '') AS has_pin FROM users ORDER BY name"
      : 'SELECT id, name, role, active, provider_id FROM users ORDER BY name'),
  ]);
  return json({
    user,
    email_enabled: emailOn(env),
    areas: areas.results,
    providers: providers.results,
    equipment: equipment.results,
    users: users.results,
    features: { pm: sc.pm, purchases: sc.purchases, wait: sc.wait, equipExtra: sc.equipExtra, ready: sc.ready },
    today: mxToday(),
  });
}

// ---------- tasks ----------
function taskSelect(sc, { list = false } = {}) {
  const extra = sc.purchases
    ? `, (SELECT COALESCE(SUM(pu.cost), 0) FROM purchases pu WHERE pu.task_id = t.id AND pu.status != 'cancelado') AS material_cost,
         (SELECT COUNT(*) FROM purchases pu WHERE pu.task_id = t.id AND pu.status IN ('pedido','comprado')) AS open_purchases`
    : ', 0 AS material_cost, 0 AS open_purchases';
  const cols = list
    ? `t.id, t.title, substr(t.description, 1, 240) AS description, t.kind, t.area_id, t.equipment_id, t.priority, t.status,
       t.provider_id, t.due_date, t.cost, t.created_by, t.created_at, t.updated_at, t.completed_at
       ${sc.wait ? ', t.wait_reason' : ', NULL AS wait_reason'}${sc.pm ? ', t.pm_id' : ', NULL AS pm_id'}`
    : `t.*${sc.wait ? '' : ', NULL AS wait_reason'}${sc.pm ? '' : ', NULL AS pm_id'}`;
  return `
  SELECT ${cols}, a.name AS area_name, e.name AS equipment_name,
         p.name AS provider_name, p.kind AS provider_kind, p.company AS provider_company, p.phone AS provider_phone,
         u.name AS created_by_name,
         (SELECT COUNT(*) FROM photos ph WHERE ph.task_id = t.id) AS photo_count,
         (SELECT COUNT(*) FROM task_notes n WHERE n.task_id = t.id AND n.kind = 'nota') AS note_count
         ${extra}
  FROM tasks t
  LEFT JOIN areas a ON a.id = t.area_id
  LEFT JOIN equipment e ON e.id = t.equipment_id
  LEFT JOIN providers p ON p.id = t.provider_id
  LEFT JOIN users u ON u.id = t.created_by`;
}
const getTask = async (env, sc, id) => env.DB.prepare(`${taskSelect(sc)} WHERE t.id = ?`).bind(id).first();

// Default due date when the reporter doesn't set one: urgent → today, high → tomorrow, normal → 7 days.
function defaultDue(priority) {
  const today = mxToday();
  if (priority === 1) return today;
  if (priority === 2) return addDaysYmd(today, 1);
  if (priority === 3) return addDaysYmd(today, 7);
  return null;
}

async function tasksApi(request, env, url, user, seg, method) {
  const id = int(seg[1]);
  const sc = await schema(env);

  if (!id && method === 'GET') {
    const q = url.searchParams;
    const where = [];
    const params = [];
    const view = q.get('view') || 'open';
    const today = mxToday();
    if (view === 'open') where.push(`t.status IN ${OPEN_SQL}`);
    else if (view === 'done') where.push("t.status IN ('hecha','cancelada')");
    if (q.get('status') && STATUSES.includes(q.get('status'))) { where.push('t.status = ?'); params.push(q.get('status')); }
    if (q.get('area')) {
      if (q.get('area') === '0') where.push('t.area_id IS NULL');
      else { where.push('t.area_id = ?'); params.push(int(q.get('area'))); }
    }
    if (q.get('provider')) {
      if (q.get('provider') === 'none') where.push('t.provider_id IS NULL');
      else { where.push('t.provider_id = ?'); params.push(int(q.get('provider'))); }
    }
    if (q.get('equipment')) { where.push('t.equipment_id = ?'); params.push(int(q.get('equipment'))); }
    if (q.get('mine') === '1') { where.push('t.created_by = ?'); params.push(user.id); }
    if (q.get('overdue') === '1') { where.push(`t.status IN ${OPEN_SQL} AND t.due_date < ?`); params.push(today); }
    if (q.get('q')) {
      where.push("(t.title LIKE ? OR t.description LIKE ? OR CAST(t.id AS TEXT) = ?)");
      const like = '%' + q.get('q').slice(0, 100) + '%';
      params.push(like, like, q.get('q').replace(/^#/, ''));
    }
    if (isDate(q.get('from'))) { where.push('COALESCE(t.completed_at, t.created_at) >= ?'); params.push(q.get('from')); }
    const limit = Math.min(500, Math.max(1, int(q.get('limit')) || (view === 'open' ? 500 : 60)));
    const offset = Math.max(0, int(q.get('offset')) || 0);
    const order = view === 'done'
      ? 'COALESCE(t.completed_at, t.updated_at) DESC'
      : `CASE WHEN t.status IN ${OPEN_SQL} AND t.due_date < '${today}' THEN 0 ELSE 1 END, t.priority ASC,
         CASE WHEN t.due_date IS NULL THEN 1 ELSE 0 END, t.due_date ASC, t.created_at DESC`;
    const sql = `${taskSelect(sc, { list: true })} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${order} LIMIT ${limit + 1} OFFSET ${offset}`;
    const { results } = await env.DB.prepare(sql).bind(...params).all();
    const more = results.length > limit;
    return json({ tasks: more ? results.slice(0, limit) : results, more, today });
  }

  if (!id && method === 'POST') {
    const b = await body(request);
    const title = str(b.title, 200);
    if (!title) fail(400, 'Escribe qué pasa');
    const kind = ['servicio', 'preventivo'].includes(b.kind) ? b.kind : 'tarea';
    const priority = [1, 2, 3, 4].includes(int(b.priority)) ? int(b.priority) : 3;
    const status = STATUSES.includes(b.status) ? b.status : 'pendiente';
    let dueDate = isDate(b.due_date) ? b.due_date : null;
    if (!dueDate && b.due_date === undefined && kind === 'tarea' && status === 'pendiente') dueDate = defaultDue(priority);
    let completedAt = null;
    if (status === 'hecha') {
      // service date given as YYYY-MM-DD → store at midday Mexico time (18:00 UTC)
      completedAt = isDate(b.completed_date) ? `${b.completed_date} 18:00:00` : null;
    }
    let areaId = int(b.area_id);
    const equipmentId = int(b.equipment_id);
    if (!areaId && equipmentId) {
      const eq = await env.DB.prepare('SELECT area_id FROM equipment WHERE id = ?').bind(equipmentId).first();
      areaId = eq ? eq.area_id : null;
    }
    const r = await env.DB.prepare(
      `INSERT INTO tasks (title, description, kind, area_id, equipment_id, priority, status, provider_id,
                          due_date, cost, created_by, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CASE WHEN ? = 'hecha' THEN datetime('now') END))`
    ).bind(title, str(b.description, 4000), kind, areaId, equipmentId, priority, status,
      int(b.provider_id), dueDate, num(b.cost), user.id, completedAt, status).run();
    const newId = r.meta.last_row_id;
    let log = kind === 'servicio' ? `Servicio registrado por ${user.name}` : `Reportada por ${user.name}`;
    if (int(b.provider_id)) {
      const p = await env.DB.prepare('SELECT name FROM providers WHERE id = ?').bind(int(b.provider_id)).first();
      if (p) log += ` · asignada a ${p.name}`;
    }
    await addNote(env, newId, user.id, log, 'sistema');
    return json({ task: await getTask(env, sc, newId) }, 201);
  }

  if (id && seg[2] === 'notes' && method === 'POST') {
    const b = await body(request);
    const text = str(b.body, 4000);
    if (!text) fail(400, 'Nota vacía');
    const exists = await env.DB.prepare('SELECT id FROM tasks WHERE id = ?').bind(id).first();
    if (!exists) fail(404, 'Orden no encontrada');
    await addNote(env, id, user.id, text, 'nota');
    await env.DB.prepare("UPDATE tasks SET updated_at = datetime('now') WHERE id = ?").bind(id).run();
    return json({ ok: true }, 201);
  }

  if (id && seg[2] === 'photos' && method === 'POST') {
    const exists = await env.DB.prepare('SELECT id FROM tasks WHERE id = ?').bind(id).first();
    if (!exists) fail(404, 'Orden no encontrada');
    const photo = await savePhoto(request, env, user, { task_id: id });
    await env.DB.prepare("UPDATE tasks SET updated_at = datetime('now') WHERE id = ?").bind(id).run();
    return json({ photo }, 201);
  }

  if (id && !seg[2] && method === 'GET') {
    const task = await getTask(env, sc, id);
    if (!task) fail(404, 'Orden no encontrada');
    const q = [
      env.DB.prepare(`SELECT n.id, n.kind, n.body, n.created_at, n.user_id, u.name AS user_name
                      FROM task_notes n LEFT JOIN users u ON u.id = n.user_id
                      WHERE n.task_id = ? ORDER BY n.created_at ASC, n.id ASC`).bind(id),
      env.DB.prepare(`SELECT ph.id, ph.user_id, ph.created_at, u.name AS user_name FROM photos ph
                      LEFT JOIN users u ON u.id = ph.user_id WHERE ph.task_id = ? ORDER BY ph.id`).bind(id),
    ];
    if (sc.purchases) q.push(env.DB.prepare(`SELECT pu.*, p.name AS provider_name, u.name AS requested_by_name FROM purchases pu
      LEFT JOIN providers p ON p.id = pu.provider_id LEFT JOIN users u ON u.id = pu.requested_by
      WHERE pu.task_id = ? ORDER BY pu.id`).bind(id));
    const [notes, photos, purchases] = await env.DB.batch(q);
    return json({ task, notes: notes.results, photos: photos.results, purchases: purchases ? purchases.results : [] });
  }

  if (id && !seg[2] && method === 'PATCH') {
    const t = await getTask(env, sc, id);
    if (!t) fail(404, 'Orden no encontrada');
    const b = await body(request);
    const sets = [];
    const params = [];
    const logs = [];

    if ('title' in b) {
      const v = str(b.title, 200);
      if (!v) fail(400, 'El título no puede quedar vacío');
      if (v !== t.title) { sets.push('title = ?'); params.push(v); }
    }
    if ('description' in b) {
      const v = str(b.description, 4000);
      if (v !== t.description) { sets.push('description = ?'); params.push(v); }
    }
    if ('area_id' in b && int(b.area_id) !== t.area_id) {
      sets.push('area_id = ?'); params.push(int(b.area_id));
      const a = int(b.area_id) ? await env.DB.prepare('SELECT name FROM areas WHERE id = ?').bind(int(b.area_id)).first() : null;
      logs.push(`Área: ${a ? a.name : 'sin área'}`);
    }
    if ('equipment_id' in b && int(b.equipment_id) !== t.equipment_id) {
      sets.push('equipment_id = ?'); params.push(int(b.equipment_id));
    }
    if ('priority' in b) {
      const v = int(b.priority);
      if (![1, 2, 3, 4].includes(v)) fail(400, 'Prioridad inválida');
      if (v !== t.priority) {
        sets.push('priority = ?'); params.push(v);
        logs.push(`Prioridad: ${PRIORITY_LABEL[t.priority]} → ${PRIORITY_LABEL[v]}`);
      }
    }
    if ('status' in b) {
      if (!STATUSES.includes(b.status)) fail(400, 'Estado inválido');
      const wait = b.status === 'en_espera' && WAIT_LABEL[b.wait_reason] ? b.wait_reason : null;
      const changed = b.status !== t.status || (sc.wait && b.status === 'en_espera' && wait !== t.wait_reason);
      if (changed) {
        if (b.status !== t.status) {
          sets.push('status = ?'); params.push(b.status);
          if (b.status === 'hecha') sets.push("completed_at = datetime('now')");
          else sets.push('completed_at = NULL');
        }
        if (sc.wait) { sets.push('wait_reason = ?'); params.push(wait); }
        logs.push(`Estado: ${statusLabel(t.status, t.wait_reason)} → ${statusLabel(b.status, wait)}`);
      }
    }
    if ('provider_id' in b && int(b.provider_id) !== t.provider_id) {
      const pid = int(b.provider_id);
      sets.push('provider_id = ?'); params.push(pid);
      const p = pid ? await env.DB.prepare('SELECT name FROM providers WHERE id = ?').bind(pid).first() : null;
      if (pid && !p) fail(400, 'Responsable no encontrado');
      logs.push(p ? `Asignada a ${p.name}` : 'Regresó a la bandeja (sin asignar)');
    }
    if ('due_date' in b) {
      const v = isDate(b.due_date) ? b.due_date : null;
      if (v !== t.due_date) {
        sets.push('due_date = ?'); params.push(v);
        logs.push(v ? `Fecha límite: ${fmtDate(v)}` : 'Sin fecha límite');
      }
    }
    if ('cost' in b) {
      const v = num(b.cost);
      if (v !== t.cost) {
        sets.push('cost = ?'); params.push(v);
        logs.push(v ? `Mano de obra y otros: $${v.toLocaleString('es-MX')}` : 'Costo de mano de obra quitado');
      }
    }
    const note = str(b.note, 4000);
    if (sets.length || note) {
      sets.push("updated_at = datetime('now')");
      await env.DB.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).bind(...params, id).run();
      for (const l of logs) await addNote(env, id, user.id, `${l} (${user.name})`, 'sistema');
      if (note) await addNote(env, id, user.id, note, 'nota');
    }
    return json({ task: await getTask(env, sc, id) });
  }

  if (id && !seg[2] && method === 'DELETE') {
    requireAdmin(user);
    if (env.PHOTOS) {
      const { results } = await env.DB.prepare('SELECT r2_key FROM photos WHERE task_id = ? AND r2_key IS NOT NULL').bind(id).all();
      for (const r of results) await env.PHOTOS.delete(r.r2_key);
    }
    const del = [
      env.DB.prepare('DELETE FROM photos WHERE task_id = ?').bind(id),
      env.DB.prepare('DELETE FROM task_notes WHERE task_id = ?').bind(id),
    ];
    if (sc.purchases) del.push(env.DB.prepare('DELETE FROM purchases WHERE task_id = ?').bind(id));
    if (sc.pm) del.push(env.DB.prepare('UPDATE pm_schedules SET last_task_id = NULL WHERE last_task_id = ?').bind(id));
    del.push(env.DB.prepare('DELETE FROM tasks WHERE id = ?').bind(id));
    await env.DB.batch(del);
    return json({ ok: true });
  }

  fail(404, 'No encontrado');
}

function fmtDate(d) {
  const [y, m, day] = d.split('-');
  return `${day}/${m}/${y}`;
}

async function notesApi(request, env, user, seg, method) {
  const id = int(seg[1]);
  if (id && method === 'DELETE') {
    const n = await env.DB.prepare('SELECT * FROM task_notes WHERE id = ?').bind(id).first();
    if (!n) fail(404, 'Nota no encontrada');
    if (n.kind !== 'nota') fail(400, 'El historial automático no se borra');
    if (n.user_id !== user.id && user.role !== 'admin') fail(403, 'Solo el autor o un admin puede borrarla');
    await env.DB.prepare('DELETE FROM task_notes WHERE id = ?').bind(id).run();
    return json({ ok: true });
  }
  fail(404, 'No encontrado');
}

// ---------- photos ----------
async function savePhoto(request, env, user, owner) {
  const type = (request.headers.get('content-type') || 'image/jpeg').split(';')[0];
  if (!type.startsWith('image/')) fail(400, 'Solo imágenes');
  const buf = await request.arrayBuffer();
  if (!buf.byteLength) fail(400, 'Foto vacía');
  if (buf.byteLength > MAX_PHOTO_BYTES) fail(413, 'Foto demasiado grande');
  let r2Key = null;
  let data = null;
  if (env.PHOTOS) {
    r2Key = `${owner.task_id ? 't' + owner.task_id : 'e' + owner.equipment_id}/${randomHex(8)}`;
    await env.PHOTOS.put(r2Key, buf, { httpMetadata: { contentType: type } });
  } else {
    data = buf;
  }
  const r = await env.DB.prepare(
    'INSERT INTO photos (task_id, equipment_id, user_id, content_type, r2_key, data) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(owner.task_id || null, owner.equipment_id || null, user.id, type, r2Key, data).run();
  return { id: r.meta.last_row_id };
}

async function photosApi(request, env, user, seg, method) {
  const id = int(seg[1]);
  if (!id) fail(404, 'No encontrado');
  if (method === 'GET') {
    const p = await env.DB.prepare('SELECT content_type, r2_key, data FROM photos WHERE id = ?').bind(id).first();
    if (!p) fail(404, 'Foto no encontrada');
    let payload = p.data;
    if (p.r2_key && env.PHOTOS) {
      const obj = await env.PHOTOS.get(p.r2_key);
      if (!obj) fail(404, 'Foto no encontrada');
      payload = obj.body;
    } else if (Array.isArray(payload)) {
      payload = new Uint8Array(payload);
    }
    return new Response(payload, {
      headers: { 'content-type': p.content_type, 'cache-control': 'private, max-age=31536000, immutable' },
    });
  }
  if (method === 'DELETE') {
    const p = await env.DB.prepare('SELECT user_id, r2_key FROM photos WHERE id = ?').bind(id).first();
    if (!p) fail(404, 'Foto no encontrada');
    if (p.user_id !== user.id && user.role !== 'admin') fail(403, 'Solo quien la subió o un admin puede borrarla');
    if (p.r2_key && env.PHOTOS) await env.PHOTOS.delete(p.r2_key);
    await env.DB.prepare('DELETE FROM photos WHERE id = ?').bind(id).run();
    return json({ ok: true });
  }
  fail(404, 'No encontrado');
}

// ---------- equipment ----------
function equipSelect(sc) {
  return `
  SELECT e.*, a.name AS area_name, p.name AS provider_name, p.phone AS provider_phone, p.company AS provider_company,
    (SELECT MAX(completed_at) FROM tasks t WHERE t.equipment_id = e.id AND t.status = 'hecha') AS last_service,
    (SELECT COUNT(*) FROM tasks t WHERE t.equipment_id = e.id AND t.status IN ${OPEN_SQL}) AS open_count,
    (SELECT COUNT(*) FROM tasks t WHERE t.equipment_id = e.id AND t.kind = 'tarea'
       AND t.created_at > datetime('now', '-90 days')) AS fails_90
    ${sc.pm ? `, (SELECT MIN(next_due) FROM pm_schedules s WHERE s.equipment_id = e.id AND s.active = 1) AS next_service` : ', NULL AS next_service'}
  FROM equipment e
  LEFT JOIN areas a ON a.id = e.area_id
  LEFT JOIN providers p ON p.id = e.provider_id`;
}

function equipFields(b) {
  return {
    name: str(b.name, 120),
    area_id: int(b.area_id),
    location: str(b.location, 200),
    brand_model: str(b.brand_model, 200),
    serial: str(b.serial, 120),
    provider_id: int(b.provider_id),
    service_interval_days: int(b.service_interval_days),
    notes: str(b.notes, 4000),
    warranty_until: isDate(b.warranty_until) ? b.warranty_until : null,
    manual_url: /^https?:\/\//i.test(String(b.manual_url || '').trim()) ? str(b.manual_url, 500) : null,
  };
}

async function equipmentApi(request, env, url, user, seg, method) {
  const id = int(seg[1]);
  const sc = await schema(env);
  if (!id && method === 'GET') {
    const { results } = await env.DB.prepare(`${equipSelect(sc)} WHERE e.active = 1 ORDER BY a.sort, e.name`).all();
    return json({ equipment: results });
  }
  if (!id && method === 'POST') {
    const f = equipFields(await body(request));
    if (!f.name) fail(400, 'Escribe el nombre del equipo');
    const r = await env.DB.prepare(
      `INSERT INTO equipment (name, area_id, location, brand_model, serial, provider_id, service_interval_days, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(f.name, f.area_id, f.location, f.brand_model, f.serial, f.provider_id, f.service_interval_days, f.notes).run();
    const newId = r.meta.last_row_id;
    if (sc.equipExtra) {
      await env.DB.prepare('UPDATE equipment SET warranty_until = ?, manual_url = ? WHERE id = ?').bind(f.warranty_until, f.manual_url, newId).run();
    }
    return json({ id: newId }, 201);
  }
  if (id && seg[2] === 'photos' && method === 'POST') {
    const exists = await env.DB.prepare('SELECT id FROM equipment WHERE id = ?').bind(id).first();
    if (!exists) fail(404, 'Equipo no encontrado');
    return json({ photo: await savePhoto(request, env, user, { equipment_id: id }) }, 201);
  }
  if (id && method === 'GET') {
    const e = await env.DB.prepare(`${equipSelect(sc)} WHERE e.id = ?`).bind(id).first();
    if (!e) fail(404, 'Equipo no encontrado');
    const q = [
      env.DB.prepare(`${taskSelect(sc, { list: true })} WHERE t.equipment_id = ?
        ORDER BY CASE WHEN t.status IN ${OPEN_SQL} THEN 0 ELSE 1 END,
                 COALESCE(t.completed_at, t.created_at) DESC LIMIT 80`).bind(id),
      env.DB.prepare('SELECT id, user_id, created_at FROM photos WHERE equipment_id = ? ORDER BY id').bind(id),
      env.DB.prepare(`SELECT (SELECT COALESCE(SUM(t.cost), 0) FROM tasks t WHERE t.equipment_id = ?1
          AND COALESCE(t.completed_at, t.created_at) >= date('now', 'start of year'))
        ${sc.purchases ? `+ (SELECT COALESCE(SUM(pu.cost), 0) FROM purchases pu JOIN tasks t2 ON t2.id = pu.task_id
          WHERE t2.equipment_id = ?1 AND pu.status != 'cancelado' AND pu.created_at >= date('now', 'start of year'))` : ''} AS total`).bind(id),
    ];
    if (sc.pm) q.push(env.DB.prepare('SELECT * FROM pm_schedules WHERE equipment_id = ? AND active = 1 ORDER BY next_due').bind(id));
    const [tasks, photos, cost, pms] = await env.DB.batch(q);
    return json({ equipment: e, tasks: tasks.results, photos: photos.results, year_cost: cost.results[0].total, pm: pms ? pms.results : [] });
  }
  if (id && method === 'PATCH') {
    const f = equipFields(await body(request));
    if (!f.name) fail(400, 'Escribe el nombre del equipo');
    await env.DB.prepare(
      `UPDATE equipment SET name=?, area_id=?, location=?, brand_model=?, serial=?, provider_id=?,
       service_interval_days=?, notes=? WHERE id=?`
    ).bind(f.name, f.area_id, f.location, f.brand_model, f.serial, f.provider_id, f.service_interval_days, f.notes, id).run();
    if (sc.equipExtra) {
      await env.DB.prepare('UPDATE equipment SET warranty_until = ?, manual_url = ? WHERE id = ?').bind(f.warranty_until, f.manual_url, id).run();
    }
    return json({ ok: true });
  }
  if (id && method === 'DELETE') {
    requireAdmin(user);
    await env.DB.prepare('UPDATE equipment SET active = 0 WHERE id = ?').bind(id).run();
    return json({ ok: true });
  }
  fail(404, 'No encontrado');
}

// ---------- providers ----------
async function providersApi(request, env, user, seg, method) {
  const id = int(seg[1]);
  if (!id && method === 'GET') {
    const { results } = await env.DB.prepare(`
      SELECT p.*,
        (SELECT COUNT(*) FROM tasks t WHERE t.provider_id = p.id AND t.status IN ('pendiente','en_proceso','en_espera')) AS open_count,
        (SELECT COUNT(*) FROM tasks t WHERE t.provider_id = p.id AND t.status IN ('pendiente','en_proceso','en_espera')
           AND t.due_date IS NOT NULL AND t.due_date < date('now','-6 hours')) AS late_count
      FROM providers p WHERE p.active = 1 ORDER BY p.kind DESC, p.name`).all();
    return json({ providers: results });
  }
  const fields = (b) => ({
    name: str(b.name, 120),
    kind: b.kind === 'interno' ? 'interno' : 'externo',
    company: str(b.company, 120),
    specialty: str(b.specialty, 120),
    phone: str(b.phone, 40),
    notes: str(b.notes, 2000),
  });
  if (!id && method === 'POST') {
    const f = fields(await body(request));
    if (!f.name) fail(400, 'Escribe el nombre');
    const r = await env.DB.prepare('INSERT INTO providers (name, kind, company, specialty, phone, notes) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(f.name, f.kind, f.company, f.specialty, f.phone, f.notes).run();
    return json({ id: r.meta.last_row_id }, 201);
  }
  if (id && method === 'PATCH') {
    const f = fields(await body(request));
    if (!f.name) fail(400, 'Escribe el nombre');
    await env.DB.prepare('UPDATE providers SET name=?, kind=?, company=?, specialty=?, phone=?, notes=? WHERE id=?')
      .bind(f.name, f.kind, f.company, f.specialty, f.phone, f.notes, id).run();
    return json({ ok: true });
  }
  if (id && method === 'DELETE') {
    requireAdmin(user);
    await env.DB.prepare('UPDATE providers SET active = 0 WHERE id = ?').bind(id).run();
    return json({ ok: true });
  }
  fail(404, 'No encontrado');
}

// ---------- areas ----------
async function areasApi(request, env, user, seg, method) {
  requireAdmin(user);
  const id = int(seg[1]);
  if (!id && method === 'POST') {
    const b = await body(request);
    const name = str(b.name, 60);
    if (!name) fail(400, 'Escribe el nombre del área');
    const max = await env.DB.prepare('SELECT COALESCE(MAX(sort),0) AS m FROM areas').first('m');
    try {
      await env.DB.prepare('INSERT INTO areas (name, sort) VALUES (?, ?)').bind(name, max + 1).run();
    } catch { fail(400, 'Esa área ya existe'); }
    return json({ ok: true }, 201);
  }
  if (id && method === 'PATCH') {
    const b = await body(request);
    if ('name' in b) {
      const name = str(b.name, 60);
      if (!name) fail(400, 'Nombre vacío');
      try {
        await env.DB.prepare('UPDATE areas SET name = ? WHERE id = ?').bind(name, id).run();
      } catch { fail(400, 'Esa área ya existe'); }
    }
    if ('active' in b) await env.DB.prepare('UPDATE areas SET active = ? WHERE id = ?').bind(b.active ? 1 : 0, id).run();
    if ('sort' in b && int(b.sort) !== null) await env.DB.prepare('UPDATE areas SET sort = ? WHERE id = ?').bind(int(b.sort), id).run();
    return json({ ok: true });
  }
  fail(404, 'No encontrado');
}

// ---------- users ----------
// provider_id: number = link to existing card, 'new' = create an internal card with the user's name, null = none
async function resolveUserProvider(env, b, name) {
  if (b.provider_id === 'new') {
    const r = await env.DB.prepare("INSERT INTO providers (name, kind, specialty, phone) VALUES (?, 'interno', ?, ?)")
      .bind(name, str(b.specialty, 120), str(b.phone, 40)).run();
    return r.meta.last_row_id;
  }
  const pid = int(b.provider_id);
  if (pid) {
    const ok = await env.DB.prepare('SELECT id FROM providers WHERE id = ?').bind(pid).first();
    if (!ok) fail(400, 'Responsable no encontrado');
  }
  return pid;
}

async function usersApi(request, env, user, seg, method) {
  requireAdmin(user);
  const id = int(seg[1]);
  if (!id && method === 'POST') {
    const b = await body(request);
    const name = str(b.name, 60);
    if (!name) fail(400, 'Escribe el nombre');
    const email = normEmail(b.email);
    if (!validEmail(email)) fail(400, 'Correo inválido');
    if (b.pin && !validPin(b.pin)) fail(400, 'El PIN debe ser de 4 a 8 dígitos');
    const salt = randomHex(16);
    const pinHash = b.pin ? await hashPin(b.pin, salt) : '';
    let newId;
    try {
      const r = await env.DB.prepare('INSERT INTO users (name, pin_hash, pin_salt, role, email, phone) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(name, pinHash, salt, b.role === 'admin' ? 'admin' : 'staff', email, str(b.phone, 40)).run();
      newId = r.meta.last_row_id;
    } catch (e) { fail(400, /email/i.test(String(e)) ? 'Ese correo ya lo usa otra persona' : 'Ya existe un usuario con ese nombre'); }
    const pid = await resolveUserProvider(env, b, name);
    if (pid) await env.DB.prepare('UPDATE users SET provider_id = ? WHERE id = ?').bind(pid, newId).run();
    return json({ ok: true, id: newId, provider_id: pid }, 201);
  }
  if (id && seg[2] === 'access' && method === 'POST') {
    const b = await body(request);
    const u = await env.DB.prepare('SELECT id, name, email, active FROM users WHERE id = ?').bind(id).first();
    if (!u || !u.active) fail(404, 'Usuario no encontrado o sin acceso');
    if (b.via === 'email') {
      if (!emailOn(env)) fail(400, 'El acceso por correo no está activado');
      if (!u.email) fail(400, 'Este usuario no tiene correo');
      await sendEmailAccess(env, request, u, u.email);
      return json({ ok: true, sent: u.email });
    }
    const { token } = await createLink(env, u.id, user.id, 'link', LINK_DAYS * 86400000, false);
    return json({ ok: true, url: linkUrl(request, token), days: LINK_DAYS });
  }
  if (id && method === 'PATCH') {
    const b = await body(request);
    const existing = await env.DB.prepare('SELECT name FROM users WHERE id = ?').bind(id).first();
    if (!existing) fail(404, 'Usuario no encontrado');
    if (id === user.id && (b.role === 'staff' || b.active === false)) {
      fail(400, 'No puedes quitarte el acceso de admin a ti mismo');
    }
    let name = existing.name;
    if ('name' in b) {
      name = str(b.name, 60);
      if (!name) fail(400, 'Nombre vacío');
      try {
        await env.DB.prepare('UPDATE users SET name = ? WHERE id = ?').bind(name, id).run();
      } catch { fail(400, 'Ya existe un usuario con ese nombre'); }
    }
    if ('email' in b) {
      const email = normEmail(b.email);
      if (!validEmail(email)) fail(400, 'Correo inválido');
      try { await env.DB.prepare('UPDATE users SET email = ? WHERE id = ?').bind(email, id).run(); }
      catch { fail(400, 'Ese correo ya lo usa otra persona'); }
    }
    if ('phone' in b) await env.DB.prepare('UPDATE users SET phone = ? WHERE id = ?').bind(str(b.phone, 40), id).run();
    let pid;
    if ('provider_id' in b) {
      pid = await resolveUserProvider(env, b, name);
      await env.DB.prepare('UPDATE users SET provider_id = ? WHERE id = ?').bind(pid, id).run();
    }
    if ('role' in b) await env.DB.prepare('UPDATE users SET role = ? WHERE id = ?').bind(b.role === 'admin' ? 'admin' : 'staff', id).run();
    if ('active' in b) {
      await env.DB.prepare('UPDATE users SET active = ? WHERE id = ?').bind(b.active ? 1 : 0, id).run();
      if (!b.active) {
        await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id).run();
        await env.DB.prepare('DELETE FROM login_links WHERE user_id = ?').bind(id).run();
      }
    }
    if ('pin' in b && b.pin) {
      if (!validPin(b.pin)) fail(400, 'El PIN debe ser de 4 a 8 dígitos');
      const salt = randomHex(16);
      await env.DB.prepare('UPDATE users SET pin_hash = ?, pin_salt = ?, failed_count = 0, locked_until = NULL WHERE id = ?')
        .bind(await hashPin(b.pin, salt), salt, id).run();
    }
    return json({ ok: true, provider_id: pid });
  }
  fail(404, 'No encontrado');
}

// ---------- preventive maintenance ----------
const UNIT_LABEL = { day: ['día', 'días'], week: ['semana', 'semanas'], month: ['mes', 'meses'] };
const everyText = (n, unit) => (unit === 'once' ? 'una sola vez' : `cada ${n > 1 ? n + ' ' : ''}${UNIT_LABEL[unit][n > 1 ? 1 : 0]}`);

let PM_LAST = 0;
// Creates the work orders whose date (minus lead days) has arrived. Idempotent: the schedule row is advanced
// with a compare-and-set on next_due before the order is inserted, so cron + page loads never duplicate.
async function runPM(env, force = false) {
  const sc = await schema(env);
  if (!sc.pm) return 0;
  if (!force && Date.now() - PM_LAST < 5 * 60000) return 0;
  PM_LAST = Date.now();
  const today = mxToday();
  const { results } = await env.DB.prepare(
    `SELECT s.*, (SELECT status FROM tasks t WHERE t.id = s.last_task_id) AS last_status FROM pm_schedules s
     WHERE s.active = 1 AND date(s.next_due, '-' || s.lead_days || ' days') <= ? LIMIT 50`).bind(today).all();
  let made = 0;
  for (const s of results) made += await generateFromPM(env, s, today);
  return made;
}

async function generateFromPM(env, s, today, manual = false) {
  // Don't pile up: while the previous order from this plan is still open, wait.
  if (s.last_status && ['pendiente', 'en_proceso', 'en_espera'].includes(s.last_status)) return 0;
  let next = advanceYmd(s.next_due, s.every_n, s.unit);
  while (next && next < today) next = advanceYmd(next, s.every_n, s.unit); // catch up after long gaps
  const upd = await env.DB.prepare('UPDATE pm_schedules SET next_due = ?, active = ? WHERE id = ? AND next_due = ? AND active = 1')
    .bind(next || s.next_due, next ? 1 : 0, s.id, s.next_due).run();
  if (!upd.meta.changes) return 0;
  const due = s.next_due;
  const r = await env.DB.prepare(
    `INSERT INTO tasks (title, description, kind, area_id, equipment_id, priority, status, provider_id, due_date, created_by, pm_id)
     VALUES (?, ?, 'preventivo', ?, ?, ?, 'pendiente', ?, ?, ?, ?)`
  ).bind(s.title, s.description, s.area_id, s.equipment_id, s.priority || 3, s.provider_id, due, s.created_by, s.id).run();
  const tid = r.meta.last_row_id;
  await env.DB.prepare('UPDATE pm_schedules SET last_task_id = ? WHERE id = ?').bind(tid, s.id).run();
  await addNote(env, tid, null, `Creada por el plan preventivo (${everyText(s.every_n, s.unit)})`, 'sistema');
  return 1;
}

function pmFields(b) {
  const unit = ['day', 'week', 'month', 'once'].includes(b.unit) ? b.unit : 'month';
  const n = Math.min(365, Math.max(1, int(b.every_n) || 1));
  return {
    title: str(b.title, 200),
    description: str(b.description, 4000),
    area_id: int(b.area_id),
    equipment_id: int(b.equipment_id),
    provider_id: int(b.provider_id),
    priority: [1, 2, 3, 4].includes(int(b.priority)) ? int(b.priority) : 3,
    every_n: unit === 'once' ? null : n,
    unit,
    next_due: isDate(b.next_due) ? b.next_due : null,
    lead_days: Math.min(60, Math.max(0, int(b.lead_days) ?? 3)),
  };
}

const PM_SELECT = `SELECT s.*, a.name AS area_name, e.name AS equipment_name, p.name AS provider_name,
  (SELECT status FROM tasks t WHERE t.id = s.last_task_id) AS last_status
  FROM pm_schedules s LEFT JOIN areas a ON a.id = s.area_id LEFT JOIN equipment e ON e.id = s.equipment_id
  LEFT JOIN providers p ON p.id = s.provider_id`;

async function pmApi(request, env, url, user, seg, method) {
  const sc = await schema(env);
  needs(sc.pm);
  const id = int(seg[1]);
  if (!id && method === 'GET') {
    await runPM(env);
    const { results } = await env.DB.prepare(`${PM_SELECT} WHERE s.active = 1 ORDER BY s.next_due, s.title`).all();
    return json({ pm: results, today: mxToday() });
  }
  if (!id && method === 'POST') {
    const f = pmFields(await body(request));
    if (!f.title) fail(400, 'Escribe qué hay que hacer');
    if (!f.next_due) fail(400, 'Elige la próxima fecha');
    if (!f.area_id && f.equipment_id) {
      const eq = await env.DB.prepare('SELECT area_id FROM equipment WHERE id = ?').bind(f.equipment_id).first();
      f.area_id = eq ? eq.area_id : null;
    }
    const r = await env.DB.prepare(
      `INSERT INTO pm_schedules (title, description, area_id, equipment_id, provider_id, priority, every_n, unit, next_due, lead_days, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(f.title, f.description, f.area_id, f.equipment_id, f.provider_id, f.priority, f.every_n, f.unit, f.next_due, f.lead_days, user.id).run();
    PM_LAST = 0;
    await runPM(env, true);
    return json({ id: r.meta.last_row_id }, 201);
  }
  if (id && seg[2] === 'run' && method === 'POST') {
    const s = await env.DB.prepare(`${PM_SELECT} WHERE s.id = ?`).bind(id).first();
    if (!s || !s.active) fail(404, 'Plan no encontrado');
    if (s.last_status && OPEN_SQL.includes(`'${s.last_status}'`)) fail(400, 'Ya hay una orden abierta de este plan');
    const made = await generateFromPM(env, s, mxToday(), true);
    const t = await env.DB.prepare('SELECT last_task_id FROM pm_schedules WHERE id = ?').bind(id).first();
    return json({ ok: !!made, task_id: t && t.last_task_id });
  }
  if (id && method === 'GET') {
    const s = await env.DB.prepare(`${PM_SELECT} WHERE s.id = ?`).bind(id).first();
    if (!s) fail(404, 'Plan no encontrado');
    const { results } = await env.DB.prepare(`${taskSelect(sc, { list: true })} WHERE t.pm_id = ? ORDER BY t.id DESC LIMIT 20`).bind(id).all();
    return json({ pm: s, tasks: results });
  }
  if (id && method === 'PATCH') {
    const b = await body(request);
    if ('active' in b && Object.keys(b).length === 1) {
      await env.DB.prepare('UPDATE pm_schedules SET active = ? WHERE id = ?').bind(b.active ? 1 : 0, id).run();
      return json({ ok: true });
    }
    const f = pmFields(b);
    if (!f.title) fail(400, 'Escribe qué hay que hacer');
    if (!f.next_due) fail(400, 'Elige la próxima fecha');
    await env.DB.prepare(
      `UPDATE pm_schedules SET title=?, description=?, area_id=?, equipment_id=?, provider_id=?, priority=?, every_n=?, unit=?,
       next_due=?, lead_days=?, active=1 WHERE id=?`
    ).bind(f.title, f.description, f.area_id, f.equipment_id, f.provider_id, f.priority, f.every_n, f.unit, f.next_due, f.lead_days, id).run();
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

// ---------- purchases (pedir material) ----------
const PURCHASE_SELECT = `SELECT pu.*, t.title AS task_title, t.status AS task_status, p.name AS provider_name, p.phone AS provider_phone,
  u.name AS requested_by_name, a.name AS area_name
  FROM purchases pu LEFT JOIN tasks t ON t.id = pu.task_id LEFT JOIN providers p ON p.id = pu.provider_id
  LEFT JOIN users u ON u.id = pu.requested_by LEFT JOIN areas a ON a.id = t.area_id`;

async function purchasesApi(request, env, url, user, seg, method) {
  const sc = await schema(env);
  needs(sc.purchases);
  const id = int(seg[1]);
  if (!id && method === 'GET') {
    const st = url.searchParams.get('status');
    const where = st === 'open' ? "pu.status IN ('pedido','comprado')"
      : PURCHASE_STATUSES.includes(st) ? 'pu.status = ?' : '1=1';
    const stmt = env.DB.prepare(`${PURCHASE_SELECT} WHERE ${where} ORDER BY CASE pu.status WHEN 'pedido' THEN 0 WHEN 'comprado' THEN 1 ELSE 2 END,
      pu.updated_at DESC LIMIT 200`);
    const { results } = await (PURCHASE_STATUSES.includes(st) ? stmt.bind(st) : stmt).all();
    return json({ purchases: results });
  }
  if (!id && method === 'POST') {
    const b = await body(request);
    const item = str(b.item, 200);
    if (!item) fail(400, 'Escribe qué material se necesita');
    const taskId = int(b.task_id);
    if (taskId && !(await env.DB.prepare('SELECT id FROM tasks WHERE id = ?').bind(taskId).first())) fail(404, 'Orden no encontrada');
    const r = await env.DB.prepare(
      'INSERT INTO purchases (task_id, item, qty, cost, provider_id, notes, requested_by) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(taskId, item, str(b.qty, 60), num(b.cost), int(b.provider_id), str(b.notes, 1000), user.id).run();
    if (taskId) await addNote(env, taskId, user.id, `Material pedido: ${item}${str(b.qty, 60) ? ' (' + str(b.qty, 60) + ')' : ''} (${user.name})`, 'sistema');
    return json({ id: r.meta.last_row_id }, 201);
  }
  if (id && method === 'PATCH') {
    const pu = await env.DB.prepare('SELECT * FROM purchases WHERE id = ?').bind(id).first();
    if (!pu) fail(404, 'Pedido no encontrado');
    const b = await body(request);
    const sets = [];
    const params = [];
    if ('status' in b) {
      if (!PURCHASE_STATUSES.includes(b.status)) fail(400, 'Estado inválido');
      if (b.status !== pu.status) {
        sets.push('status = ?'); params.push(b.status);
        if (b.status === 'comprado') sets.push("bought_at = COALESCE(bought_at, datetime('now'))");
        if (b.status === 'recibido') sets.push("received_at = datetime('now')", "bought_at = COALESCE(bought_at, datetime('now'))");
        if (b.status === 'pedido') sets.push('bought_at = NULL', 'received_at = NULL');
        if (pu.task_id) await addNote(env, pu.task_id, user.id, `Material ${PURCHASE_LABEL[b.status].toLowerCase()}: ${pu.item} (${user.name})`, 'sistema');
      }
    }
    for (const [k, f] of [['item', (v) => str(v, 200)], ['qty', (v) => str(v, 60)], ['cost', num], ['provider_id', int], ['notes', (v) => str(v, 1000)]]) {
      if (k in b) {
        const v = f(b[k]);
        if (k === 'item' && !v) fail(400, 'Escribe qué material se necesita');
        sets.push(`${k} = ?`); params.push(v);
      }
    }
    if (sets.length) {
      sets.push("updated_at = datetime('now')");
      await env.DB.prepare(`UPDATE purchases SET ${sets.join(', ')} WHERE id = ?`).bind(...params, id).run();
    }
    return json({ purchase: await env.DB.prepare(`${PURCHASE_SELECT} WHERE pu.id = ?`).bind(id).first() });
  }
  if (id && method === 'DELETE') {
    const pu = await env.DB.prepare('SELECT * FROM purchases WHERE id = ?').bind(id).first();
    if (!pu) fail(404, 'Pedido no encontrado');
    if (pu.requested_by !== user.id && user.role !== 'admin') fail(403, 'Solo quien lo pidió o un admin puede borrarlo');
    await env.DB.prepare('DELETE FROM purchases WHERE id = ?').bind(id).run();
    return json({ ok: true });
  }
  fail(404, 'No encontrado');
}

// ---------- summary (tiles + dashboard lists) ----------
async function summaryApi(env, user) {
  const sc = await schema(env);
  const today = mxToday();
  const week = addDaysYmd(today, 7);
  const month = today.slice(0, 7) + '-01';
  const q = [
    env.DB.prepare(`SELECT
        SUM(CASE WHEN status IN ${OPEN_SQL} THEN 1 ELSE 0 END) AS open,
        SUM(CASE WHEN status IN ${OPEN_SQL} AND due_date < ?1 THEN 1 ELSE 0 END) AS overdue,
        SUM(CASE WHEN status IN ${OPEN_SQL} AND due_date >= ?1 AND due_date <= ?2 THEN 1 ELSE 0 END) AS week,
        SUM(CASE WHEN status = 'en_espera' THEN 1 ELSE 0 END) AS waiting,
        SUM(CASE WHEN status IN ${OPEN_SQL} AND provider_id IS NULL THEN 1 ELSE 0 END) AS unassigned,
        SUM(CASE WHEN status IN ${OPEN_SQL} AND priority = 1 THEN 1 ELSE 0 END) AS urgent,
        SUM(CASE WHEN status = 'hecha' AND completed_at >= datetime(?1, '-7 days') THEN 1 ELSE 0 END) AS done_week,
        SUM(CASE WHEN status = 'hecha' AND completed_at >= ?3 THEN COALESCE(cost, 0) ELSE 0 END) AS labor_month
      FROM tasks`).bind(today, week, month),
    env.DB.prepare(`SELECT e.id, e.name, a.name AS area_name, COUNT(*) AS n FROM tasks t JOIN equipment e ON e.id = t.equipment_id
      LEFT JOIN areas a ON a.id = e.area_id
      WHERE t.kind = 'tarea' AND t.created_at > datetime('now', '-90 days') GROUP BY e.id HAVING n >= 2 ORDER BY n DESC LIMIT 5`),
  ];
  if (sc.purchases) {
    q.push(env.DB.prepare(`SELECT COALESCE(SUM(CASE WHEN status IN ('comprado','recibido') AND COALESCE(bought_at, created_at) >= ? THEN cost ELSE 0 END), 0) AS month,
      SUM(CASE WHEN status = 'pedido' THEN 1 ELSE 0 END) AS pending, SUM(CASE WHEN status = 'comprado' THEN 1 ELSE 0 END) AS bought FROM purchases`).bind(month));
  }
  if (sc.pm) {
    q.push(env.DB.prepare(`${PM_SELECT} WHERE s.active = 1 AND s.next_due <= ? ORDER BY s.next_due LIMIT 8`).bind(addDaysYmd(today, 21)));
  }
  const res = await env.DB.batch(q);
  const t = res[0].results[0];
  const pu = sc.purchases ? res[2].results[0] : { month: 0, pending: 0, bought: 0 };
  return json({
    today,
    counts: { open: t.open || 0, overdue: t.overdue || 0, week: t.week || 0, waiting: t.waiting || 0, unassigned: t.unassigned || 0, urgent: t.urgent || 0, done_week: t.done_week || 0 },
    cost_month: (t.labor_month || 0) + (pu.month || 0),
    labor_month: t.labor_month || 0,
    material_month: pu.month || 0,
    purchases: { pending: pu.pending || 0, bought: pu.bought || 0 },
    recurring: res[1].results,
    pm_next: sc.pm ? res[sc.purchases ? 3 : 2].results : [],
  });
}

// ---------- global search ----------
async function searchApi(env, url) {
  const raw = (url.searchParams.get('q') || '').trim().slice(0, 80);
  if (raw.length < 2 && !/^#?\d+$/.test(raw)) return json({ tasks: [], equipment: [], providers: [] });
  const sc = await schema(env);
  const like = '%' + raw + '%';
  const [tasks, equipment, providers] = await env.DB.batch([
    env.DB.prepare(`${taskSelect(sc, { list: true })} WHERE t.title LIKE ?1 OR t.description LIKE ?1 OR CAST(t.id AS TEXT) = ?2
      ORDER BY CASE WHEN t.status IN ${OPEN_SQL} THEN 0 ELSE 1 END, t.id DESC LIMIT 25`).bind(like, raw.replace(/^#/, '')),
    env.DB.prepare(`SELECT e.id, e.name, e.location, e.brand_model, a.name AS area_name FROM equipment e LEFT JOIN areas a ON a.id = e.area_id
      WHERE e.active = 1 AND (e.name LIKE ?1 OR e.location LIKE ?1 OR e.brand_model LIKE ?1 OR e.serial LIKE ?1) ORDER BY e.name LIMIT 15`).bind(like),
    env.DB.prepare(`SELECT id, name, kind, company, specialty, phone FROM providers
      WHERE active = 1 AND (name LIKE ?1 OR company LIKE ?1 OR specialty LIKE ?1) ORDER BY name LIMIT 10`).bind(like),
  ]);
  return json({ tasks: tasks.results, equipment: equipment.results, providers: providers.results });
}

// ---------- calendar (due dates + projected preventive) ----------
async function calendarApi(env, url) {
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  if (!isDate(from) || !isDate(to) || to < from) fail(400, 'Rango inválido');
  const sc = await schema(env);
  const { results: tasks } = await env.DB.prepare(`${taskSelect(sc, { list: true })}
    WHERE t.due_date >= ? AND t.due_date <= ? AND t.status != 'cancelada' ORDER BY t.due_date, t.priority LIMIT 400`).bind(from, to).all();
  const planned = [];
  if (sc.pm) {
    const { results } = await env.DB.prepare(`${PM_SELECT} WHERE s.active = 1 AND s.next_due <= ?`).bind(to).all();
    for (const s of results) {
      let d = s.next_due;
      let guard = 0;
      while (d && d <= to && guard++ < 400) {
        if (d >= from) planned.push({ pm_id: s.id, date: d, title: s.title, area_name: s.area_name, equipment_name: s.equipment_name, equipment_id: s.equipment_id, provider_name: s.provider_name });
        d = advanceYmd(d, s.every_n, s.unit);
      }
    }
  }
  return json({ tasks, planned, today: mxToday() });
}
