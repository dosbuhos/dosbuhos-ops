// Contemplo Studio — video library and projection control for Contemplo (Dos Búhos).
//
// Two kinds of caller:
//   • Staff, through the Hub (apps.dosbuhos.com/contemplo/): signed X-DB-User header, /api/* below.
//   • Paired Android TV players: bearer token, /api/device/* below. They never go through the Hub.
// Video bytes live in R2 (bucket contemplo-media). Uploads are R2 multipart, one part per request (32 MiB), so no
// request ever carries a whole file and an interrupted upload resumes from the last part. Live show control runs on
// the TV itself over the local network (android/); this Worker is management, uploads and sync.
import { hubUser } from './hub-auth.js';
import { withHubSecret } from './hub-secret.js';

const PART_SIZE = 32 * 1024 * 1024;
const ONLINE_MS = 15_000;          // a device that reported within this window is "en línea"
const COMMAND_TTL_MS = 90_000;     // a command the TV has not picked up by then is never delivered (no surprise playback later)
const PAIR_TTL_MS = 15 * 60_000;
const COMMAND_TYPES = new Set(['play', 'play_playlist', 'cue', 'go', 'pause', 'resume', 'toggle_pause', 'restart', 'stop',
  'blackout', 'seek', 'skip', 'mute', 'volume', 'fit', 'loop', 'identify', 'sync_now']);

const SECURITY = {
  'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'x-robots-tag': 'noindex, nofollow',
};
const json = (o, status = 200, extra = {}) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...SECURITY, ...extra } });
const err = (status, message) => json({ error: message }, status);
const now = () => Date.now();
const rid = (n = 16) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, '0')).join('');
const sha256hex = async (s) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join('');
const sixDigits = () => String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000));
const parseJSON = (s, d) => { try { return JSON.parse(s); } catch { return d; } };
const videoKey = (id) => `videos/${id}.mp4`;
const thumbKey = (id) => `thumbs/${id}.jpg`;
const ROLE = { viewer: 0, editor: 1, admin: 2 };

async function log(env, deviceId, kind, detail) {
  await env.DB.prepare('INSERT INTO events (at, device_id, kind, detail) VALUES (?,?,?,?)').bind(now(), deviceId || '', kind, typeof detail === 'string' ? detail : JSON.stringify(detail)).run();
}

// ---------- who is asking ----------
async function staff(request, env) {
  if (env.ENVIRONMENT === 'dev' && !request.headers.get('X-DB-User')) return { email: 'dev@localhost', name: 'Desarrollo', role: 'admin' };
  if (!env.HUB_SECRET) return null;   // fail closed: the workers.dev address is public
  const u = await hubUser(request, env);
  if (!u) return null;
  return { email: u.email, name: u.name || u.email, role: u.hubAdmin || u.role === 'admin' ? 'admin' : u.role === 'editor' ? 'editor' : 'viewer' };
}

async function deviceFrom(request, env) {
  const m = /^Bearer\s+(\S+)$/.exec(request.headers.get('authorization') || '');
  if (!m) return null;
  return env.DB.prepare('SELECT * FROM devices WHERE token_hash = ?').bind(await sha256hex(m[1])).first();
}

// ---------- R2 streaming with Range ----------
async function serveObject(request, env, key, type) {
  const range = request.headers.get('range');
  const obj = await env.MEDIA.get(key, range ? { range: request.headers } : {});
  if (!obj) return err(404, 'No existe');
  const h = new Headers({ 'content-type': type, 'accept-ranges': 'bytes', 'cache-control': 'private, max-age=3600', etag: obj.httpEtag, ...SECURITY });
  if (range && obj.range) {
    const off = obj.range.offset ?? 0, len = obj.range.length ?? obj.size - off;
    h.set('content-range', `bytes ${off}-${off + len - 1}/${obj.size}`);
    h.set('content-length', String(len));
    return new Response(request.method === 'HEAD' ? null : obj.body, { status: 206, headers: h });
  }
  h.set('content-length', String(obj.size));
  return new Response(request.method === 'HEAD' ? null : obj.body, { status: 200, headers: h });
}

// ---------- views ----------
const videoOut = (v) => ({ id: v.id, title: v.title, filename: v.filename, size: v.size, duration_ms: v.duration_ms, width: v.width, height: v.height,
  sha256: v.sha256, tags: parseJSON(v.tags, []), has_thumb: !!v.has_thumb, status: v.status, created_at: v.created_at, created_by: v.created_by });
const deviceOut = (d) => ({ id: d.id, name: d.name, model: d.model, app_version: d.app_version, lan_ip: d.lan_ip, lan_port: d.lan_port, show_pin: d.show_pin,
  state: parseJSON(d.state, {}), storage: parseJSON(d.storage, {}), last_error: d.last_error, last_seen: d.last_seen, online: now() - d.last_seen < ONLINE_MS,
  lan_url: d.lan_ip ? `http://${d.lan_ip}:${d.lan_port || 8320}/` : '' });

async function playlistsFull(env) {
  const [pls, items] = await Promise.all([
    env.DB.prepare('SELECT * FROM playlists ORDER BY name').all().then((r) => r.results),
    env.DB.prepare('SELECT * FROM playlist_items ORDER BY playlist_id, pos').all().then((r) => r.results)]);
  return pls.map((p) => ({ id: p.id, name: p.name, mode: p.mode, loop: !!p.loop, updated_at: p.updated_at,
    items: items.filter((i) => i.playlist_id === p.id).map((i) => ({ video_id: i.video_id, label: i.label, transition: i.transition, fade_ms: i.fade_ms, end_action: i.end_action })) }));
}

// ---------- staff API ----------
async function staffApi(request, env, url, who) {
  const p = url.pathname, m = request.method;
  const need = (r) => ROLE[who.role] >= ROLE[r];
  if (m !== 'GET' && m !== 'HEAD') {
    // CSRF defence: writes come from our own page, which always sends this header.
    if (request.headers.get('X-Contemplo') !== '1') return err(403, 'Solicitud rechazada');
    if (!need('editor')) return err(403, 'Tu acceso es de solo lectura');
  }
  let mt;

  if (p === '/api/me') return json({ ...who, part_size: PART_SIZE });

  // Library
  if (p === '/api/videos' && m === 'GET') {
    const [vids, dm] = await Promise.all([
      env.DB.prepare("SELECT * FROM videos WHERE status = 'ready' ORDER BY created_at DESC").all().then((r) => r.results),
      env.DB.prepare('SELECT device_id, video_id, state, progress, error FROM device_media').all().then((r) => r.results)]);
    return json({ videos: vids.map((v) => ({ ...videoOut(v), devices: dm.filter((x) => x.video_id === v.id).map(({ device_id, state, progress, error }) => ({ device_id, state, progress, error })) })) });
  }
  if ((mt = /^\/api\/videos\/([a-f0-9]+)$/.exec(p))) {
    const id = mt[1], v = await env.DB.prepare('SELECT * FROM videos WHERE id = ?').bind(id).first();
    if (!v) return err(404, 'Video no encontrado');
    if (m === 'GET') return json(videoOut(v));
    if (m === 'PATCH') {
      const b = await request.json();
      const title = typeof b.title === 'string' && b.title.trim() ? b.title.trim().slice(0, 200) : v.title;
      const tags = Array.isArray(b.tags) ? JSON.stringify([...new Set(b.tags.map((t) => String(t).trim()).filter(Boolean))].slice(0, 20)) : v.tags;
      await env.DB.prepare('UPDATE videos SET title = ?, tags = ?, updated_at = ? WHERE id = ?').bind(title, tags, now(), id).run();
      return json(videoOut({ ...v, title, tags }));
    }
    if (m === 'DELETE') {
      // Players drop their copy on the next sync, except while it is on screen or cued (they protect those).
      await env.DB.batch([env.DB.prepare('DELETE FROM device_media WHERE video_id = ?').bind(id), env.DB.prepare('DELETE FROM playlist_items WHERE video_id = ?').bind(id), env.DB.prepare('DELETE FROM videos WHERE id = ?').bind(id)]);
      await env.MEDIA.delete([videoKey(id), thumbKey(id)]);
      await log(env, '', 'video.delete', { id, title: v.title, by: who.email });
      return json({ ok: true });
    }
  }
  if ((mt = /^\/api\/media\/([a-f0-9]+)$/.exec(p)) && (m === 'GET' || m === 'HEAD')) return serveObject(request, env, videoKey(mt[1]), 'video/mp4');
  if ((mt = /^\/api\/thumb\/([a-f0-9]+)$/.exec(p))) {
    if (m === 'GET') return serveObject(request, env, thumbKey(mt[1]), 'image/jpeg');
    if (m === 'PUT') {
      const len = Number(request.headers.get('content-length') || 0);
      if (len > 2_000_000) return err(413, 'Miniatura demasiado grande');
      if (!(request.headers.get('content-type') || '').startsWith('image/jpeg')) return err(415, 'La miniatura debe ser JPEG');
      await env.MEDIA.put(thumbKey(mt[1]), request.body, { httpMetadata: { contentType: 'image/jpeg' } });
      await env.DB.prepare('UPDATE videos SET has_thumb = 1, updated_at = ? WHERE id = ?').bind(now(), mt[1]).run();
      return json({ ok: true });
    }
  }

  // Uploads: create → parts → complete. The browser keeps {id, uploadId, parts done} so a reload can resume.
  if (p === '/api/uploads' && m === 'POST') {
    const b = await request.json();
    const filename = String(b.filename || '').slice(0, 255), size = Number(b.size) || 0;
    if (!/\.(mp4|m4v)$/i.test(filename)) return err(415, 'Solo archivos MP4');
    if (b.type && !/^video\/(mp4|x-m4v)$/.test(b.type)) return err(415, 'Solo archivos MP4 (H.264)');
    if (size <= 0 || size > 60 * 1024 ** 3) return err(413, 'Tamaño no válido');
    const id = rid(12), t = now();
    const up = await env.MEDIA.createMultipartUpload(videoKey(id), { httpMetadata: { contentType: 'video/mp4' }, customMetadata: { filename } });
    const title = String(b.title || filename.replace(/\.(mp4|m4v)$/i, '').replace(/[_-]+/g, ' ')).trim().slice(0, 200);
    await env.DB.prepare('INSERT INTO videos (id, title, filename, size, status, upload_id, part_size, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .bind(id, title, filename, size, 'uploading', up.uploadId, PART_SIZE, who.email, t, t).run();
    return json({ id, uploadId: up.uploadId, partSize: PART_SIZE, parts: Math.ceil(size / PART_SIZE) });
  }
  if ((mt = /^\/api\/uploads\/([a-f0-9]+)(?:\/(part)\/(\d+)|\/(complete|abort))?$/.exec(p))) {
    const id = mt[1], v = await env.DB.prepare("SELECT * FROM videos WHERE id = ? AND status = 'uploading'").bind(id).first();
    if (!v) return err(404, 'Esta subida ya no existe; vuelve a empezar');
    const up = env.MEDIA.resumeMultipartUpload(videoKey(id), v.upload_id);
    if (mt[2] === 'part' && m === 'PUT') {
      const n = Number(mt[3]), total = Math.ceil(v.size / v.part_size);
      if (n < 1 || n > total) return err(400, 'Parte fuera de rango');
      const expect = n < total ? v.part_size : v.size - v.part_size * (total - 1);
      if (Number(request.headers.get('content-length')) !== expect) return err(400, `La parte ${n} debe medir ${expect} bytes`);
      const part = await up.uploadPart(n, request.body);
      return json({ partNumber: part.partNumber, etag: part.etag });
    }
    if (mt[4] === 'complete' && m === 'POST') {
      const b = await request.json();
      const parts = (b.parts || []).map((x) => ({ partNumber: Number(x.partNumber), etag: String(x.etag) })).sort((a, z) => a.partNumber - z.partNumber);
      if (parts.length !== Math.ceil(v.size / v.part_size)) return err(400, 'Faltan partes');
      const obj = await up.complete(parts);
      if (obj.size !== v.size) { await env.MEDIA.delete(videoKey(id)); await env.DB.prepare('DELETE FROM videos WHERE id = ?').bind(id).run(); return err(422, 'El archivo llegó incompleto; vuelve a subirlo'); }
      const sha = /^[a-f0-9]{64}$/.test(b.sha256 || '') ? b.sha256 : '';
      await env.DB.prepare("UPDATE videos SET status = 'ready', upload_id = '', sha256 = ?, duration_ms = ?, width = ?, height = ?, updated_at = ? WHERE id = ?")
        .bind(sha, Math.round(Number(b.duration_ms) || 0), Math.round(Number(b.width) || 0), Math.round(Number(b.height) || 0), now(), id).run();
      await log(env, '', 'video.upload', { id, title: v.title, size: v.size, by: who.email });
      return json(videoOut(await env.DB.prepare('SELECT * FROM videos WHERE id = ?').bind(id).first()));
    }
    if (mt[4] === 'abort' && m === 'POST') {
      try { await up.abort(); } catch { /* already gone */ }
      await env.DB.prepare('DELETE FROM videos WHERE id = ?').bind(id).run();
      return json({ ok: true });
    }
  }

  // Devices
  if (p === '/api/devices' && m === 'GET') {
    const ds = (await env.DB.prepare('SELECT * FROM devices ORDER BY created_at').all()).results;
    return json({ devices: ds.map(deviceOut) });
  }
  if (p === '/api/devices/pair' && m === 'POST') {
    if (!need('admin')) return err(403, 'Solo un administrador puede vincular pantallas');
    const b = await request.json();
    const code = String(b.code || '').replace(/\D/g, '');
    const pr = await env.DB.prepare('SELECT * FROM pairings WHERE code = ? AND expires_at > ? AND device_id IS NULL').bind(code, now()).first();
    if (!pr) return err(404, 'Código no válido o vencido. Revisa el número en la pantalla del TV.');
    const id = rid(8), token = rid(32), name = String(b.name || 'Contemplo Main').trim().slice(0, 80) || 'Contemplo Main', t = now();
    await env.DB.batch([
      env.DB.prepare('INSERT INTO devices (id, name, token_hash, show_pin, model, created_at) VALUES (?,?,?,?,?,?)').bind(id, name, await sha256hex(token), sixDigits(), pr.model, t),
      env.DB.prepare('UPDATE pairings SET device_id = ?, token = ? WHERE code = ?').bind(id, token, code)]);
    await log(env, id, 'device.pair', { name, by: who.email });
    return json(deviceOut(await env.DB.prepare('SELECT * FROM devices WHERE id = ?').bind(id).first()));
  }
  if ((mt = /^\/api\/devices\/([a-f0-9]+)(?:\/(sync|commands|events|media))?(?:\/([a-f0-9]+))?$/.exec(p))) {
    const id = mt[1], d = await env.DB.prepare('SELECT * FROM devices WHERE id = ?').bind(id).first();
    if (!d) return err(404, 'Pantalla no encontrada');
    const sub = mt[2];
    if (!sub && m === 'GET') return json(deviceOut(d));
    if (!sub && m === 'PATCH') {
      const b = await request.json();
      const name = typeof b.name === 'string' && b.name.trim() ? b.name.trim().slice(0, 80) : d.name;
      const pin = b.show_pin === 'new' ? sixDigits() : /^\d{4,8}$/.test(b.show_pin || '') ? b.show_pin : d.show_pin;
      await env.DB.prepare('UPDATE devices SET name = ?, show_pin = ? WHERE id = ?').bind(name, pin, id).run();
      return json(deviceOut({ ...d, name, show_pin: pin }));
    }
    if (!sub && m === 'DELETE') {
      if (!need('admin')) return err(403, 'Solo un administrador puede desvincular pantallas');
      await env.DB.batch([env.DB.prepare('DELETE FROM device_media WHERE device_id = ?').bind(id), env.DB.prepare('DELETE FROM commands WHERE device_id = ?').bind(id), env.DB.prepare('DELETE FROM devices WHERE id = ?').bind(id)]);
      await log(env, id, 'device.unpair', { name: d.name, by: who.email });
      return json({ ok: true });
    }
    if (sub === 'media' && m === 'GET') {
      const rows = (await env.DB.prepare('SELECT dm.*, v.title, v.size FROM device_media dm JOIN videos v ON v.id = dm.video_id WHERE dm.device_id = ? ORDER BY dm.requested_at').bind(id).all()).results;
      return json({ media: rows });
    }
    if (sub === 'sync' && m === 'POST') {
      const b = await request.json(), ids = [...new Set((b.video_ids || []).map(String))].filter((x) => /^[a-f0-9]+$/.test(x));
      const t = now(), stmts = ids.map((v) => env.DB.prepare("INSERT INTO device_media (device_id, video_id, state, requested_at, updated_at) SELECT ?, id, 'queued', ?, ? FROM videos WHERE id = ? AND status = 'ready' ON CONFLICT(device_id, video_id) DO UPDATE SET state = CASE WHEN state = 'failed' THEN 'queued' ELSE state END, error = CASE WHEN state = 'failed' THEN '' ELSE error END").bind(id, t, t, v));
      if (stmts.length) await env.DB.batch(stmts);
      return json({ ok: true, queued: ids.length });
    }
    if (sub === 'sync' && m === 'DELETE' && mt[3]) {
      await env.DB.prepare('DELETE FROM device_media WHERE device_id = ? AND video_id = ?').bind(id, mt[3]).run();
      return json({ ok: true });
    }
    if (sub === 'commands' && m === 'POST') {
      const b = await request.json();
      if (!COMMAND_TYPES.has(b.type)) return err(400, 'Orden desconocida');
      const cid = rid(10), t = now();
      await env.DB.prepare('INSERT INTO commands (id, device_id, type, payload, created_by, created_at) VALUES (?,?,?,?,?,?)').bind(cid, id, b.type, JSON.stringify(b.payload || {}), who.email, t).run();
      return json({ id: cid, status: 'pending', online: now() - d.last_seen < ONLINE_MS });
    }
    if (sub === 'commands' && m === 'GET') {
      const rows = (await env.DB.prepare('SELECT * FROM commands WHERE device_id = ? ORDER BY created_at DESC LIMIT 30').bind(id).all()).results;
      return json({ commands: rows.map(cmdOut) });
    }
    if (sub === 'events' && m === 'GET') {
      const rows = (await env.DB.prepare('SELECT * FROM events WHERE device_id = ? ORDER BY at DESC LIMIT 100').bind(id).all()).results;
      return json({ events: rows });
    }
  }
  if ((mt = /^\/api\/commands\/([a-f0-9]+)(\/retry)?$/.exec(p))) {
    const c = await env.DB.prepare('SELECT * FROM commands WHERE id = ?').bind(mt[1]).first();
    if (!c) return err(404, 'Orden no encontrada');
    if (!mt[2] && m === 'GET') return json(expireView(cmdOut(c)));
    if (mt[2] && m === 'POST') {
      const cid = rid(10);
      await env.DB.prepare('INSERT INTO commands (id, device_id, type, payload, created_by, created_at) VALUES (?,?,?,?,?,?)').bind(cid, c.device_id, c.type, c.payload, who.email, now()).run();
      return json({ id: cid, status: 'pending' });
    }
  }

  // Playlists / run-of-show
  if (p === '/api/playlists' && m === 'GET') return json({ playlists: await playlistsFull(env) });
  if (p === '/api/playlists' && m === 'POST') {
    const b = await request.json(), id = rid(8), t = now();
    await env.DB.prepare('INSERT INTO playlists (id, name, mode, loop, created_at, updated_at) VALUES (?,?,?,?,?,?)').bind(id, String(b.name || 'Nueva lista').slice(0, 120), b.mode === 'ambient' ? 'ambient' : 'show', b.loop === false ? 0 : 1, t, t).run();
    if (b.copy_from) await env.DB.prepare('INSERT INTO playlist_items (playlist_id, pos, video_id, label, transition, fade_ms, end_action) SELECT ?, pos, video_id, label, transition, fade_ms, end_action FROM playlist_items WHERE playlist_id = ?').bind(id, String(b.copy_from)).run();
    return json({ id });
  }
  if ((mt = /^\/api\/playlists\/([a-f0-9]+)$/.exec(p))) {
    const id = mt[1], pl = await env.DB.prepare('SELECT * FROM playlists WHERE id = ?').bind(id).first();
    if (!pl) return err(404, 'Lista no encontrada');
    if (m === 'PUT') {
      // Whole list replaced in one batch: the TV only ever sees a complete version.
      const b = await request.json(), items = Array.isArray(b.items) ? b.items.slice(0, 200) : [];
      const tr = (x) => (x === 'fade' ? 'fade' : 'cut'), ea = (x) => (['loop', 'hold', 'black', 'next'].includes(x) ? x : 'loop');
      await env.DB.batch([
        env.DB.prepare('UPDATE playlists SET name = ?, mode = ?, loop = ?, updated_at = ? WHERE id = ?').bind(String(b.name || pl.name).slice(0, 120), b.mode === 'ambient' ? 'ambient' : 'show', b.loop === false ? 0 : 1, now(), id),
        env.DB.prepare('DELETE FROM playlist_items WHERE playlist_id = ?').bind(id),
        ...items.map((it, i) => env.DB.prepare('INSERT INTO playlist_items (playlist_id, pos, video_id, label, transition, fade_ms, end_action) SELECT ?, ?, id, ?, ?, ?, ? FROM videos WHERE id = ?')
          .bind(id, i, String(it.label || '').slice(0, 120), tr(it.transition), Math.max(0, Math.min(10_000, Number(it.fade_ms) || 1000)), ea(it.end_action), String(it.video_id)))]);
      return json({ ok: true });
    }
    if (m === 'DELETE') { await env.DB.batch([env.DB.prepare('DELETE FROM playlist_items WHERE playlist_id = ?').bind(id), env.DB.prepare('DELETE FROM playlists WHERE id = ?').bind(id)]); return json({ ok: true }); }
  }
  return err(404, 'Ruta no encontrada');
}

const cmdOut = (c) => ({ id: c.id, device_id: c.device_id, type: c.type, payload: parseJSON(c.payload, {}), status: c.status, result: c.result, created_by: c.created_by, created_at: c.created_at, delivered_at: c.delivered_at, acked_at: c.acked_at });
// A command still pending past its TTL is reported as expired even before the TV's next poll marks it.
const expireView = (c) => (c.status === 'pending' && now() - c.created_at > COMMAND_TTL_MS ? { ...c, status: 'expired' } : c);

// ---------- device API ----------
async function deviceApi(request, env, url) {
  const p = url.pathname, m = request.method;

  if (p === '/api/device/pair/start' && m === 'POST') {
    const b = await request.json().catch(() => ({}));
    const secret = rid(24), t = now();
    await env.DB.prepare('DELETE FROM pairings WHERE expires_at < ?').bind(t).run();
    for (let i = 0; i < 5; i++) {
      const code = sixDigits();
      const r = await env.DB.prepare('INSERT OR IGNORE INTO pairings (code, secret_hash, model, created_at, expires_at) VALUES (?,?,?,?,?)').bind(code, await sha256hex(secret), String(b.model || '').slice(0, 80), t, t + PAIR_TTL_MS).run();
      if (r.meta.changes) return json({ code, secret, expires_at: t + PAIR_TTL_MS });
    }
    return err(503, 'Intenta de nuevo');
  }
  if (p === '/api/device/pair/poll' && m === 'POST') {
    const b = await request.json().catch(() => ({}));
    const pr = await env.DB.prepare('SELECT * FROM pairings WHERE secret_hash = ?').bind(await sha256hex(String(b.secret || ''))).first();
    if (!pr || pr.expires_at < now()) return json({ status: 'expired' });
    if (!pr.device_id || !pr.token) return json({ status: 'waiting' });
    const d = await env.DB.prepare('SELECT * FROM devices WHERE id = ?').bind(pr.device_id).first();
    await env.DB.prepare('DELETE FROM pairings WHERE code = ?').bind(pr.code).run();   // the token is handed over exactly once
    return json({ status: 'paired', token: pr.token, device_id: d.id, name: d.name });
  }

  const dev = await deviceFrom(request, env);
  if (!dev) return err(401, 'Pantalla no vinculada');

  if ((p === '/api/device/heartbeat' || p === '/api/device/ack') && m === 'POST') {
    const b = await request.json().catch(() => ({}));
    const t = now(), stmts = [];
    for (const a of (b.acks || []).slice(0, 50)) {
      const st = a.status === 'done' ? 'done' : 'failed';
      stmts.push(env.DB.prepare("UPDATE commands SET status = ?, result = ?, acked_at = ? WHERE id = ? AND device_id = ? AND status IN ('pending', 'delivered')").bind(st, String(a.result || '').slice(0, 500), t, String(a.id), dev.id));
    }
    if (p === '/api/device/ack') { if (stmts.length) await env.DB.batch(stmts); return json({ ok: true }); }

    const lastErr = b.last_error != null ? String(b.last_error).slice(0, 500) : dev.last_error;
    stmts.push(env.DB.prepare('UPDATE devices SET state = ?, storage = ?, lan_ip = ?, lan_port = ?, app_version = ?, model = ?, last_error = ?, last_seen = ? WHERE id = ?')
      // Fields the TV leaves out keep their last known value.
      .bind(b.state ? JSON.stringify(b.state) : dev.state, b.storage ? JSON.stringify(b.storage) : dev.storage, b.lan_ip != null ? String(b.lan_ip).slice(0, 45) : dev.lan_ip,
        b.lan_port != null ? Number(b.lan_port) || 0 : dev.lan_port, b.app_version ? String(b.app_version).slice(0, 40) : dev.app_version, String(b.model || dev.model).slice(0, 80), lastErr, t, dev.id));
    for (const x of (b.media || []).slice(0, 500)) {
      const st = ['queued', 'downloading', 'verifying', 'ready', 'failed'].includes(x.state) ? x.state : 'queued';
      stmts.push(env.DB.prepare('UPDATE device_media SET state = ?, progress = ?, error = ?, updated_at = ? WHERE device_id = ? AND video_id = ?').bind(st, Math.max(0, Math.min(1, Number(x.progress) || 0)), String(x.error || '').slice(0, 300), t, dev.id, String(x.id)));
    }
    for (const e of (b.events || []).slice(0, 20)) stmts.push(env.DB.prepare('INSERT INTO events (at, device_id, kind, detail) VALUES (?,?,?,?)').bind(Number(e.at) || t, dev.id, String(e.kind || 'tv').slice(0, 40), String(e.detail || '').slice(0, 1000)));
    // Old commands are never delivered: a TV that comes back online hours later must not start playing on its own.
    stmts.push(env.DB.prepare("UPDATE commands SET status = 'expired' WHERE device_id = ? AND status = 'pending' AND created_at < ?").bind(dev.id, t - COMMAND_TTL_MS));
    await env.DB.batch(stmts);

    const pending = (await env.DB.prepare("SELECT * FROM commands WHERE device_id = ? AND status = 'pending' ORDER BY created_at LIMIT 20").bind(dev.id).all()).results;
    if (pending.length) await env.DB.batch(pending.map((c) => env.DB.prepare("UPDATE commands SET status = 'delivered', delivered_at = ? WHERE id = ? AND status = 'pending'").bind(t, c.id)));
    const wanted = (await env.DB.prepare("SELECT v.* FROM device_media dm JOIN videos v ON v.id = dm.video_id WHERE dm.device_id = ? AND v.status = 'ready' ORDER BY dm.requested_at").bind(dev.id).all()).results;
    return json({
      device: { id: dev.id, name: dev.name, show_pin: dev.show_pin },
      commands: pending.map((c) => ({ id: c.id, type: c.type, payload: parseJSON(c.payload, {}), created_at: c.created_at })),
      wanted: wanted.map((v) => ({ id: v.id, title: v.title, size: v.size, sha256: v.sha256, duration_ms: v.duration_ms, width: v.width, height: v.height, has_thumb: !!v.has_thumb, tags: parseJSON(v.tags, []) })),
      playlists: await playlistsFull(env),
      server_time: t,
    });
  }
  let mt;
  if ((mt = /^\/api\/device\/media\/([a-f0-9]+)$/.exec(p)) && (m === 'GET' || m === 'HEAD')) {
    const ok = await env.DB.prepare('SELECT 1 FROM device_media WHERE device_id = ? AND video_id = ?').bind(dev.id, mt[1]).first();
    if (!ok) return err(403, 'Este video no está asignado a esta pantalla');
    return serveObject(request, env, videoKey(mt[1]), 'video/mp4');
  }
  if ((mt = /^\/api\/device\/thumb\/([a-f0-9]+)$/.exec(p)) && m === 'GET') return serveObject(request, env, thumbKey(mt[1]), 'image/jpeg');
  return err(404, 'Ruta no encontrada');
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith('/api/device/')) return await deviceApi(request, env, url);
      if (url.pathname === '/healthz') return json({ ok: true });
      // Short link for the Downloader app on the Google TV: the newest APK built by GitHub Actions (public, no secrets inside).
      if (url.pathname === '/tv' || url.pathname === '/tv.apk') return Response.redirect('https://github.com/dosbuhos/dosbuhos-ops/releases/latest/download/contemplo-tv.apk', 302);
      env = await withHubSecret(env);
      const who = await staff(request, env);
      if (url.pathname.startsWith('/api/')) {
        if (!who) return err(env.HUB_SECRET || env.ENVIRONMENT === 'dev' ? 401 : 503, 'Entra por el Hub: apps.dosbuhos.com/contemplo/');
        return await staffApi(request, env, url, who);
      }
      // The APK the TV installs is public (no secrets inside); everything else needs a Hub identity.
      if (!who) return new Response('Entra por el Hub de Dos Búhos: https://apps.dosbuhos.com/contemplo/', { status: 401, headers: { 'content-type': 'text/plain; charset=utf-8', ...SECURITY } });
      const res = await env.ASSETS.fetch(request);
      const r = new Response(res.body, res);
      r.headers.set('cache-control', 'no-store');
      for (const [k, v] of Object.entries(SECURITY)) r.headers.set(k, v);
      return r;
    } catch (e) {
      console.log('contemplo error', String(e && e.stack || e));
      return err(500, 'Error interno: ' + String(e && e.message || e));
    }
  },
  // Daily: abandon uploads nobody finished and clear old events (R2 drops unfinished multipart uploads after 7 days itself).
  async scheduled(_c, env) {
    const t = now();
    await env.DB.batch([
      env.DB.prepare("DELETE FROM videos WHERE status = 'uploading' AND created_at < ?").bind(t - 7 * 86_400_000),
      env.DB.prepare('DELETE FROM events WHERE at < ?').bind(t - 90 * 86_400_000),
      env.DB.prepare("DELETE FROM commands WHERE created_at < ? AND status IN ('done', 'failed', 'expired')").bind(t - 30 * 86_400_000),
      env.DB.prepare('DELETE FROM pairings WHERE expires_at < ?').bind(t)]);
  },
};
