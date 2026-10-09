import { identify } from './auth.js';
import { layout, esc } from './ui.js';
import { holdings, eventFull, validateEvent } from './data.js';
import { runSync, importOrder } from './zoho.js';
import * as rep from './rep.js';
import * as admin from './admin.js';

const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
const redirect = (to) => new Response(null, { status: 303, headers: { location: to } });
const int0 = (v) => Math.max(0, Math.floor(Number(v) || 0));

async function audit(env, who, action, detail) {
  await env.DB.prepare('INSERT INTO audit (who, action, detail) VALUES (?,?,?)').bind(who, action, JSON.stringify(detail || {})).run();
}

function denied(user) {
  return layout({ title: 'Sin acceso', user, body: `<h1>Sin acceso</h1><p>${user ? `La cuenta ${esc(user.email)} no está registrada como vendedor ni administrador.` : 'Inicia sesión con tu correo de Dos Búhos.'}</p>` });
}

async function saveEvent(env, user, id, data, submit) {
  const ev = await env.DB.prepare('SELECT * FROM events WHERE id=?').bind(id).first();
  if (!ev || ev.rep_id !== user.rep?.id) return json({ errors: ['Este evento no es tuyo.'] }, 403);
  if (!['abierto', 'devuelto'].includes(ev.status) || ev.kind !== 'evento') return json({ errors: ['Este reporte ya fue enviado.'] }, 409);
  const report = data.report || {};
  for (const k of ['personas', 'contactos', 'pedidos_cajas', 'pedidos_mxn', 'cuota', 'viaticos', 'otros_costos', 'horas']) if (report[k] !== undefined && report[k] !== '') report[k] = Math.max(0, Number(report[k]) || 0);
  const stmts = [env.DB.prepare('UPDATE events SET report=? WHERE id=?').bind(JSON.stringify(report), id)];
  for (const l of data.lines || []) {
    stmts.push(env.DB.prepare(`UPDATE event_lines SET poured=?, gifted=?, gifted_to=?, sold=?, sold_to=?, broken=?, returned=?, kept=? WHERE id=? AND event_id=?`)
      .bind(int0(l.poured), int0(l.gifted), (l.gifted_to || '').slice(0, 300), int0(l.sold), (l.sold_to || '').slice(0, 300), int0(l.broken), int0(l.returned), int0(l.kept), l.id, id));
  }
  stmts.push(env.DB.prepare('DELETE FROM leads WHERE event_id=? AND done=0').bind(id));
  for (const l of (data.leads || []).slice(0, 50)) stmts.push(env.DB.prepare('INSERT INTO leads (rep_id, event_id, name, business, contact, next_step, due) VALUES (?,?,?,?,?,?,?)')
    .bind(ev.rep_id, id, String(l.name).slice(0, 120), (l.business || '').slice(0, 120), (l.contact || '').slice(0, 120), (l.next_step || '').slice(0, 300), l.due || null));
  stmts.push(env.DB.prepare('DELETE FROM placements WHERE event_id=?').bind(id));
  for (const p of (data.placements || []).slice(0, 50)) stmts.push(env.DB.prepare('INSERT INTO placements (event_id, account, wine, kind) VALUES (?,?,?,?)').bind(id, String(p.account).slice(0, 120), p.wine || null, p.kind || null));
  await env.DB.batch(stmts);
  if (!submit) return json({ ok: true });
  const full = await eventFull(env, id);
  const errors = validateEvent(full);
  if (errors.length) return json({ errors });
  await env.DB.prepare(`UPDATE events SET status='enviado', submitted_at=datetime('now') WHERE id=?`).bind(id).run();
  await audit(env, user.email, 'enviar_evento', { id });
  return json({ ok: true });
}

// Photo storage: R2 when the PHOTOS binding exists, otherwise D1 (photo_blobs table).
async function putPhoto(env, key, file) {
  if (env.PHOTOS) return env.PHOTOS.put(key, file.stream(), { httpMetadata: { contentType: file.type || 'image/jpeg' } });
  const buf = await file.arrayBuffer();
  if (buf.byteLength > 1900000) throw new Error('La foto es demasiado grande');
  await env.DB.prepare('INSERT INTO photo_blobs (key, type, data) VALUES (?,?,?)').bind(key, file.type || 'image/jpeg', buf).run();
}
async function getPhoto(env, key) {
  if (env.PHOTOS) { const o = await env.PHOTOS.get(key); if (o) return { body: o.body, type: o.httpMetadata?.contentType }; }
  const r = await env.DB.prepare('SELECT type, data FROM photo_blobs WHERE key=?').bind(key).first();
  return r ? { body: new Uint8Array(r.data), type: r.type } : null;
}

async function photoUpload(env, user, request) {
  const fd = await request.formData();
  const file = fd.get('file'); const kind = String(fd.get('kind') || 'otra'); const eventId = Number(fd.get('event_id'));
  if (!file || typeof file === 'string') return json({ error: 'Sin archivo' }, 400);
  if (file.size > 8 * 1024 * 1024) return json({ error: 'La foto pesa más de 8 MB' }, 400);
  const ev = await env.DB.prepare('SELECT rep_id, status FROM events WHERE id=?').bind(eventId).first();
  if (!ev || ev.rep_id !== user.rep?.id || !['abierto', 'devuelto'].includes(ev.status)) return json({ error: 'No puedes subir fotos a este evento' }, 403);
  const key = `eventos/${eventId}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.jpg`;
  await putPhoto(env, key, file);
  const row = await env.DB.prepare('INSERT INTO photos (rep_id, event_id, kind, r2_key) VALUES (?,?,?,?) RETURNING id').bind(ev.rep_id, eventId, kind, key).first();
  return json({ id: row.id });
}

async function countSubmit(env, user, request) {
  const fd = await request.formData();
  let lines; try { lines = JSON.parse(fd.get('lines')); } catch { return json({ error: 'Datos inválidos' }, 400); }
  const file = fd.get('file');
  if (!file || typeof file === 'string') return json({ error: 'Falta la foto del inventario' }, 400);
  const hold = Object.fromEntries((await holdings(env, user.rep.id)).map(h => [h.wine, h.qty]));
  const any = await env.DB.prepare('SELECT 1 FROM counts WHERE rep_id=?').bind(user.rep.id).first();
  const c = await env.DB.prepare('INSERT INTO counts (rep_id, kind, note) VALUES (?,?,?) RETURNING id').bind(user.rep.id, any ? 'mensual' : 'inicial', String(fd.get('note') || '').slice(0, 1000)).first();
  const seen = new Set(); const stmts = [];
  for (const l of lines) {
    if (!l.wine || seen.has(l.wine)) continue; seen.add(l.wine);
    stmts.push(env.DB.prepare('INSERT INTO count_lines (count_id, wine, expected, counted) VALUES (?,?,?,?)').bind(c.id, String(l.wine).slice(0, 120), hold[l.wine] || 0, int0(l.counted)));
  }
  for (const [w, q] of Object.entries(hold)) if (!seen.has(w)) stmts.push(env.DB.prepare('INSERT INTO count_lines (count_id, wine, expected, counted) VALUES (?,?,?,0)').bind(c.id, w, q));
  const key = `conteos/${c.id}-${crypto.randomUUID().slice(0, 8)}.jpg`;
  await putPhoto(env, key, file);
  stmts.push(env.DB.prepare(`INSERT INTO photos (rep_id, count_id, kind, r2_key) VALUES (?,?,'conteo',?)`).bind(user.rep.id, c.id, key));
  await env.DB.batch(stmts);
  await audit(env, user.email, 'enviar_conteo', { id: c.id });
  return json({ ok: true });
}

async function form(request) { return Object.fromEntries((await request.formData()).entries()); }

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const p = url.pathname; const m = request.method;
    // Local development only (no Access configured): load sample Zoho orders.
    if (!env.ACCESS_TEAM_DOMAIN && env.DEV_USER && m === 'POST' && p === '/dev/import') {
      const { rep_email, orders } = await request.json();
      const r = await env.DB.prepare('SELECT * FROM reps WHERE email=?').bind(rep_email).first();
      let n = 0; for (const so of orders) if (so.date >= r.sync_from && so.status !== 'void') n += await importOrder(env, r, so);
      return json({ lines: n });
    }
    const user = await identify(request, env);
    if (!user || (!user.rep && !user.isAdmin)) return denied(user);
    let res;
    const R = (re) => p.match(re);

    // ---------- photos (rep who owns it, or admin) ----------
    if (m === 'GET' && R(/^\/foto\/(\d+)$/)) {
      const ph = await env.DB.prepare('SELECT * FROM photos WHERE id=?').bind(R(/^\/foto\/(\d+)$/)[1]).first();
      if (!ph || (!user.isAdmin && ph.rep_id !== user.rep?.id)) return new Response('No encontrado', { status: 404 });
      const obj = await getPhoto(env, ph.r2_key);
      if (!obj) return new Response('No encontrado', { status: 404 });
      return new Response(obj.body, { headers: { 'content-type': obj.type || 'image/jpeg', 'cache-control': 'private, max-age=86400' } });
    }

    // ---------- admin ----------
    if (p.startsWith('/admin')) {
      if (!user.isAdmin) return denied(user);
      if (m === 'GET' && p === '/admin') return admin.dashboard(env, user);
      if (m === 'GET' && p === '/admin/eventos') return admin.eventsTable(env, user, url);
      if (m === 'GET' && p === '/admin/eventos.csv') return admin.eventsCsv(env);
      if (m === 'GET' && p === '/admin/vinos') return admin.winesOut(env, user);
      if (m === 'GET' && p === '/admin/conteos') return admin.countsPage(env, user);
      if (m === 'GET' && p === '/admin/reps') return admin.repsPage(env, user);
      if (m === 'GET' && R(/^\/admin\/evento\/(\d+)$/)) return (await admin.eventReview(env, user, Number(R(/^\/admin\/evento\/(\d+)$/)[1]))) || new Response('No encontrado', { status: 404 });
      if (m === 'POST' && p === '/admin/sync') { await runSync(env); return redirect('/admin'); }
      if (m === 'POST' && R(/^\/admin\/evento\/(\d+)\/revisar$/)) {
        const id = Number(R(/^\/admin\/evento\/(\d+)\/revisar$/)[1]); const f = await form(request);
        if (f.accion === 'devolver' && !(f.note || '').trim()) return redirect(`/admin/evento/${id}`);
        await env.DB.prepare(`UPDATE events SET status=?, reviewed_by=?, reviewed_at=datetime('now'), review_note=?, submitted_at=CASE WHEN ?='devuelto' THEN submitted_at ELSE submitted_at END WHERE id=? AND status='enviado'`)
          .bind(f.accion === 'aprobar' ? 'aprobado' : 'devuelto', user.email, f.note || null, f.accion, id).run();
        await audit(env, user.email, f.accion + '_evento', { id, note: f.note });
        return redirect(`/admin/evento/${id}`);
      }
      if (m === 'POST' && R(/^\/admin\/conteo\/(\d+)\/revisar$/)) {
        const id = Number(R(/^\/admin\/conteo\/(\d+)\/revisar$/)[1]); const f = await form(request);
        const c = await env.DB.prepare(`SELECT * FROM counts WHERE id=? AND status='enviado'`).bind(id).first();
        if (c) {
          const stmts = [env.DB.prepare(`UPDATE counts SET status=?, reviewed_by=?, reviewed_at=datetime('now'), review_note=? WHERE id=?`).bind(f.accion === 'aprobar' ? 'aprobado' : 'devuelto', user.email, f.note || null, id)];
          if (f.accion === 'aprobar') {
            // Re-read expected now, in case events were reported after the count was sent.
            const hold = Object.fromEntries((await holdings(env, c.rep_id)).map(h => [h.wine, h.qty]));
            const { results: lines } = await env.DB.prepare('SELECT * FROM count_lines WHERE count_id=?').bind(id).all();
            for (const l of lines) { const d = l.counted - (hold[l.wine] || 0); if (d) stmts.push(env.DB.prepare('INSERT INTO adjustments (rep_id, wine, qty, reason, count_id) VALUES (?,?,?,?,?)').bind(c.rep_id, l.wine, d, `Conteo ${c.kind} aprobado`, id)); }
          }
          await env.DB.batch(stmts);
          await audit(env, user.email, f.accion + '_conteo', { id });
        }
        return redirect('/admin/conteos');
      }
      if (m === 'POST' && (p === '/admin/reps/nuevo' || R(/^\/admin\/reps\/(\d+)$/))) {
        const f = await form(request);
        const ids = JSON.stringify(String(f.zoho || '').split(/[,\s]+/).filter(Boolean));
        if (p === '/admin/reps/nuevo') await env.DB.prepare('INSERT INTO reps (name, email, zoho_customer_ids, sync_from) VALUES (?,?,?,?)').bind(f.name, f.email.toLowerCase().trim(), ids, f.sync_from || '2026-07-10').run();
        else await env.DB.prepare('UPDATE reps SET name=?, email=?, zoho_customer_ids=?, sync_from=?, active=? WHERE id=?').bind(f.name, f.email.toLowerCase().trim(), ids, f.sync_from, Number(f.active), Number(R(/^\/admin\/reps\/(\d+)$/)[1])).run();
        await audit(env, user.email, 'editar_vendedor', f);
        return redirect('/admin/reps');
      }
      return new Response('No encontrado', { status: 404 });
    }

    // ---------- rep ----------
    if (!user.rep) return redirect('/admin');
    if (m === 'GET' && p === '/') res = await rep.home(env, user);
    else if (m === 'GET' && p === '/evento/nuevo') res = await rep.newEventPage(env, user);
    else if (m === 'POST' && p === '/evento/nuevo') {
      const f = await form(request); const hold = Object.fromEntries((await holdings(env, user.rep.id)).map(h => [h.wine, h.qty]));
      const lines = [];
      for (let i = 0; i < Number(f.n || 0); i++) { const q = int0(f['qty' + i]); const w = f['wine' + i]; if (q > 0 && hold[w] >= q) lines.push([w, q]); }
      if (!lines.length || !f.name) return redirect('/evento/nuevo');
      const ev = await env.DB.prepare(`INSERT INTO events (rep_id, source, name, event_date) VALUES (?, 'app', ?, ?) RETURNING id`).bind(user.rep.id, f.name.slice(0, 120), f.date).first();
      await env.DB.batch(lines.map(([w, q]) => env.DB.prepare('INSERT INTO event_lines (event_id, wine, qty, received, item_id) VALUES (?,?,?,0,(SELECT item_id FROM wines WHERE name=? LIMIT 1))').bind(ev.id, w, q, w)));
      return redirect('/evento/' + ev.id);
    }
    else if (m === 'GET' && R(/^\/evento\/(\d+)$/)) res = await rep.eventPage(env, user, Number(R(/^\/evento\/(\d+)$/)[1]));
    else if (m === 'POST' && R(/^\/api\/eventos\/(\d+)(\/enviar)?$/)) { const mm = R(/^\/api\/eventos\/(\d+)(\/enviar)?$/); return saveEvent(env, user, Number(mm[1]), await request.json(), !!mm[2]); }
    else if (m === 'POST' && p === '/api/fotos') return photoUpload(env, user, request);
    else if (m === 'GET' && p === '/conteo') res = await rep.countPage(env, user);
    else if (m === 'POST' && p === '/api/conteos') return countSubmit(env, user, request);
    else if (m === 'GET' && p === '/seguimientos') res = await rep.leadsPage(env, user);
    else if (m === 'POST' && R(/^\/seguimientos\/(\d+)\/hecho$/)) {
      await env.DB.prepare('UPDATE leads SET done=1 WHERE id=? AND rep_id=?').bind(Number(R(/^\/seguimientos\/(\d+)\/hecho$/)[1]), user.rep.id).run();
      return redirect('/seguimientos');
    }
    return res || new Response('No encontrado', { status: 404 });
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runSync(env));
  },
};
