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
  pendiente: 'Pendiente', en_proceso: 'En proceso', en_espera: 'En espera',
  hecha: 'Hecha', cancelada: 'Cancelada',
};
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
  });
}

// ---------- tasks ----------
const TASK_SELECT = `
  SELECT t.*, a.name AS area_name, e.name AS equipment_name,
         p.name AS provider_name, p.kind AS provider_kind, p.company AS provider_company, p.phone AS provider_phone,
         u.name AS created_by_name,
         (SELECT COUNT(*) FROM photos ph WHERE ph.task_id = t.id) AS photo_count,
         (SELECT COUNT(*) FROM task_notes n WHERE n.task_id = t.id AND n.kind = 'nota') AS note_count
  FROM tasks t
  LEFT JOIN areas a ON a.id = t.area_id
  LEFT JOIN equipment e ON e.id = t.equipment_id
  LEFT JOIN providers p ON p.id = t.provider_id
  LEFT JOIN users u ON u.id = t.created_by`;

async function tasksApi(request, env, url, user, seg, method) {
  const id = int(seg[1]);

  if (!id && method === 'GET') {
    const q = url.searchParams;
    const where = [];
    const params = [];
    const view = q.get('view') || 'open';
    if (view === 'open') where.push("t.status IN ('pendiente','en_proceso','en_espera')");
    else if (view === 'done') where.push("t.status IN ('hecha','cancelada')");
    if (q.get('area')) { where.push('t.area_id = ?'); params.push(int(q.get('area'))); }
    if (q.get('provider')) {
      if (q.get('provider') === 'none') where.push('t.provider_id IS NULL');
      else { where.push('t.provider_id = ?'); params.push(int(q.get('provider'))); }
    }
    if (q.get('equipment')) { where.push('t.equipment_id = ?'); params.push(int(q.get('equipment'))); }
    if (q.get('mine') === '1') { where.push('t.created_by = ?'); params.push(user.id); }
    if (q.get('q')) {
      where.push('(t.title LIKE ? OR t.description LIKE ?)');
      const like = '%' + q.get('q').slice(0, 100) + '%';
      params.push(like, like);
    }
    const order = view === 'done'
      ? 'COALESCE(t.completed_at, t.updated_at) DESC'
      : "t.priority ASC, CASE WHEN t.due_date IS NULL THEN 1 ELSE 0 END, t.due_date ASC, t.created_at DESC";
    const sql = `${TASK_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${order} LIMIT 500`;
    const { results } = await env.DB.prepare(sql).bind(...params).all();
    return json({ tasks: results });
  }

  if (!id && method === 'POST') {
    const b = await body(request);
    const title = str(b.title, 200);
    if (!title) fail(400, 'Escribe qué se necesita');
    const kind = b.kind === 'servicio' ? 'servicio' : 'tarea';
    const priority = [1, 2, 3, 4].includes(int(b.priority)) ? int(b.priority) : 3;
    const status = STATUSES.includes(b.status) ? b.status : 'pendiente';
    const dueDate = isDate(b.due_date) ? b.due_date : null;
    let completedAt = null;
    if (status === 'hecha') {
      // service date given as YYYY-MM-DD → store at midday Mexico time (18:00 UTC)
      completedAt = isDate(b.completed_date) ? `${b.completed_date} 18:00:00` : null;
    }
    const r = await env.DB.prepare(
      `INSERT INTO tasks (title, description, kind, area_id, equipment_id, priority, status, provider_id,
                          due_date, cost, created_by, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CASE WHEN ? = 'hecha' THEN datetime('now') END))`
    ).bind(title, str(b.description, 4000), kind, int(b.area_id), int(b.equipment_id), priority, status,
      int(b.provider_id), dueDate, num(b.cost), user.id, completedAt, status).run();
    const newId = r.meta.last_row_id;
    let log = kind === 'servicio' ? `Servicio registrado por ${user.name}` : `Creada por ${user.name}`;
    if (int(b.provider_id)) {
      const p = await env.DB.prepare('SELECT name FROM providers WHERE id = ?').bind(int(b.provider_id)).first();
      if (p) log += ` · asignada a ${p.name}`;
    }
    await addNote(env, newId, user.id, log, 'sistema');
    return json({ task: await env.DB.prepare(`${TASK_SELECT} WHERE t.id = ?`).bind(newId).first() }, 201);
  }

  if (id && seg[2] === 'notes' && method === 'POST') {
    const b = await body(request);
    const text = str(b.body, 4000);
    if (!text) fail(400, 'Nota vacía');
    const exists = await env.DB.prepare('SELECT id FROM tasks WHERE id = ?').bind(id).first();
    if (!exists) fail(404, 'Tarea no encontrada');
    await addNote(env, id, user.id, text, 'nota');
    await env.DB.prepare("UPDATE tasks SET updated_at = datetime('now') WHERE id = ?").bind(id).run();
    return json({ ok: true }, 201);
  }

  if (id && seg[2] === 'photos' && method === 'POST') {
    const exists = await env.DB.prepare('SELECT id FROM tasks WHERE id = ?').bind(id).first();
    if (!exists) fail(404, 'Tarea no encontrada');
    const photo = await savePhoto(request, env, user, { task_id: id });
    await env.DB.prepare("UPDATE tasks SET updated_at = datetime('now') WHERE id = ?").bind(id).run();
    return json({ photo }, 201);
  }

  if (id && !seg[2] && method === 'GET') {
    const task = await env.DB.prepare(`${TASK_SELECT} WHERE t.id = ?`).bind(id).first();
    if (!task) fail(404, 'Tarea no encontrada');
    const [notes, photos] = await env.DB.batch([
      env.DB.prepare(`SELECT n.id, n.kind, n.body, n.created_at, n.user_id, u.name AS user_name
                      FROM task_notes n LEFT JOIN users u ON u.id = n.user_id
                      WHERE n.task_id = ? ORDER BY n.created_at ASC, n.id ASC`).bind(id),
      env.DB.prepare('SELECT id, user_id, created_at FROM photos WHERE task_id = ? ORDER BY id').bind(id),
    ]);
    return json({ task, notes: notes.results, photos: photos.results });
  }

  if (id && !seg[2] && method === 'PATCH') {
    const t = await env.DB.prepare(`${TASK_SELECT} WHERE t.id = ?`).bind(id).first();
    if (!t) fail(404, 'Tarea no encontrada');
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
      if (b.status !== t.status) {
        sets.push('status = ?'); params.push(b.status);
        if (b.status === 'hecha') sets.push("completed_at = datetime('now')");
        else sets.push('completed_at = NULL');
        logs.push(`Estado: ${STATUS_LABEL[t.status]} → ${STATUS_LABEL[b.status]}`);
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
        logs.push(v ? `Fecha estimada: ${fmtDate(v)}` : 'Sin fecha estimada');
      }
    }
    if ('cost' in b) {
      const v = num(b.cost);
      if (v !== t.cost) { sets.push('cost = ?'); params.push(v); }
    }

    if (sets.length) {
      sets.push("updated_at = datetime('now')");
      await env.DB.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).bind(...params, id).run();
      for (const l of logs) await addNote(env, id, user.id, `${l} (${user.name})`, 'sistema');
    }
    return json({ task: await env.DB.prepare(`${TASK_SELECT} WHERE t.id = ?`).bind(id).first() });
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
      env.DB.prepare('DELETE FROM tasks WHERE id = ?').bind(id),
    ]);
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
const EQUIP_SELECT = `
  SELECT e.*, a.name AS area_name, p.name AS provider_name, p.phone AS provider_phone,
    (SELECT MAX(completed_at) FROM tasks t WHERE t.equipment_id = e.id AND t.status = 'hecha') AS last_service,
    (SELECT COUNT(*) FROM tasks t WHERE t.equipment_id = e.id AND t.status IN ('pendiente','en_proceso','en_espera')) AS open_count
  FROM equipment e
  LEFT JOIN areas a ON a.id = e.area_id
  LEFT JOIN providers p ON p.id = e.provider_id`;

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
  };
}

async function equipmentApi(request, env, url, user, seg, method) {
  const id = int(seg[1]);
  if (!id && method === 'GET') {
    const { results } = await env.DB.prepare(`${EQUIP_SELECT} WHERE e.active = 1 ORDER BY a.sort, e.name`).all();
    return json({ equipment: results });
  }
  if (!id && method === 'POST') {
    const f = equipFields(await body(request));
    if (!f.name) fail(400, 'Escribe el nombre del equipo');
    const r = await env.DB.prepare(
      `INSERT INTO equipment (name, area_id, location, brand_model, serial, provider_id, service_interval_days, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(f.name, f.area_id, f.location, f.brand_model, f.serial, f.provider_id, f.service_interval_days, f.notes).run();
    return json({ id: r.meta.last_row_id }, 201);
  }
  if (id && seg[2] === 'photos' && method === 'POST') {
    const exists = await env.DB.prepare('SELECT id FROM equipment WHERE id = ?').bind(id).first();
    if (!exists) fail(404, 'Equipo no encontrado');
    return json({ photo: await savePhoto(request, env, user, { equipment_id: id }) }, 201);
  }
  if (id && method === 'GET') {
    const e = await env.DB.prepare(`${EQUIP_SELECT} WHERE e.id = ?`).bind(id).first();
    if (!e) fail(404, 'Equipo no encontrado');
    const [tasks, photos] = await env.DB.batch([
      env.DB.prepare(`${TASK_SELECT} WHERE t.equipment_id = ?
        ORDER BY CASE WHEN t.status IN ('pendiente','en_proceso','en_espera') THEN 0 ELSE 1 END,
                 COALESCE(t.completed_at, t.created_at) DESC`).bind(id),
      env.DB.prepare('SELECT id, user_id, created_at FROM photos WHERE equipment_id = ? ORDER BY id').bind(id),
    ]);
    return json({ equipment: e, tasks: tasks.results, photos: photos.results });
  }
  if (id && method === 'PATCH') {
    const f = equipFields(await body(request));
    if (!f.name) fail(400, 'Escribe el nombre del equipo');
    await env.DB.prepare(
      `UPDATE equipment SET name=?, area_id=?, location=?, brand_model=?, serial=?, provider_id=?,
       service_interval_days=?, notes=? WHERE id=?`
    ).bind(f.name, f.area_id, f.location, f.brand_model, f.serial, f.provider_id, f.service_interval_days, f.notes, id).run();
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
