import { identify } from './auth.js';
import { esc } from './ui.js';
import { STATUSES, DONE, isDate, dueDate, parseBottles } from './schedule.js';
import { loadContext, subClub, subOccurrences, getSub, writeFulfillment, undoFulfillment, audit, setSetting, todayLocal } from './data.js';
import { syncStripe, handleWebhook } from './stripe.js';
import * as P from './pages.js';
import { fulfillPage, fulfillSubmit, reopen, reconcileData, reconcilePage, reconcileSubmit } from './flow.js';
import { ask } from './assistant.js';
import { handleAuth, loginPage } from './google.js';
import { buildPlan, migrationPage, runImport } from './legacy.js';

const redirect = (to) => new Response(null, { status: 303, headers: { location: to } });
const str = (v, max = 300) => { const s = String(v ?? '').trim(); return s ? s.slice(0, max) : null; };
const dateOrNull = (v) => (isDate(String(v || '').trim()) ? String(v).trim() : null);
const safeBack = (b, fallback = '/') => (typeof b === 'string' && b.startsWith('/') && !b.startsWith('//') ? b : fallback);
const withParam = (path, k, v) => path + (path.includes('?') ? '&' : '?') + `${k}=${encodeURIComponent(v)}`;
async function form(request) { return Object.fromEntries((await request.formData()).entries()); }

function notFound(env, user, msg = 'No encontrado.') { return P.simplePage({ env, user, title: 'No encontrado', html: `<p>${esc(msg)}</p><p><a href="/">Volver a la agenda</a></p>`, status: 404 }); }
function forbidden(env, user) { return P.simplePage({ env, user, title: 'Solo administradores', html: '<p>Esta acción es solo para administradores.</p>', status: 403 }); }

// Load one expected shipment (subscription + occurrence k), computed exactly as the agenda computes it.
async function loadShipment(env, subId, k) {
  const base = await getSub(env, subId);
  if (!base || !(k >= 1 && k < 1000)) return null;
  const ctx = await loadContext(env, { memberId: base.member_id });
  const sub = ctx.subs.find(s => s.id === subId);
  const club = subClub(ctx, sub);
  if (!club) return { ctx, sub, club: null, o: null };
  const due = dueDate(sub.anchor_override || sub.start_date, club.cadence_months, k);
  const o = subOccurrences(ctx, sub, due).find(x => x.k === k) || null;
  return { ctx, sub, club, o };
}

async function setStatus(env, user, sh, status) {
  const { sub, club, o } = sh;
  const today = todayLocal(env);
  const fields = {};
  if (status === 'scheduled') {
    Object.assign(fields, { status: null, done_on: null, delivered_on: null });
    if (o.f && !o.f.bottles_custom) fields.bottles_json = null; // let it follow the club case again
  } else {
    fields.status = status;
    if (DONE.has(status) && !o.f?.done_on) fields.done_on = today;
    if (status === 'delivered' && !o.f?.delivered_on) fields.delivered_on = today;
    // Snapshot the case the moment work starts, so later edits to the club case never rewrite this shipment.
    if (status !== 'skipped' && !o.f?.bottles_json && o.bottles) fields.bottles_json = JSON.stringify(o.bottles);
  }
  return writeFulfillment(env, user.email, sub, club, o.k, fields, `estado: ${status === 'scheduled' ? 'pendiente' : status}`);
}

async function ensureFulfillmentId(env, user, sub, club, k) {
  await env.DB.prepare(`INSERT INTO fulfillments (subscription_id, k, expected_date, updated_by) VALUES (?,?,?,?) ON CONFLICT(subscription_id, k) DO NOTHING`)
    .bind(sub.id, k, dueDate(sub.anchor_override || sub.start_date, club.cadence_months, k), user.email).run();
  return (await env.DB.prepare('SELECT id FROM fulfillments WHERE subscription_id=? AND k=?').bind(sub.id, k).first()).id;
}

async function okAuditFor(env, user, id) {
  if (!id) return null;
  const a = await env.DB.prepare(`SELECT * FROM audit_log WHERE id=? AND who=? AND entity='fulfillment'`).bind(Number(id), user.email).first();
  if (!a) return null;
  const [subId, k] = a.entity_id.split(':').map(Number);
  const s = await env.DB.prepare('SELECT s.seq_offset, m.name FROM subscriptions s JOIN members m ON m.id=s.member_id WHERE s.id=?').bind(subId).first();
  return { ...a, member_name: s?.name, n: k + (s?.seq_offset || 0) };
}

async function exportData(env) {
  const tables = ['clubs', 'club_cases', 'club_benefits', 'stripe_products', 'members', 'subscriptions', 'pauses', 'fulfillments', 'benefit_uses', 'audit_log', 'settings'];
  const out = { exported_at: new Date().toISOString(), app: 'wineclub', env: env.APP_ENV || null };
  for (const t of tables) out[t] = (await env.DB.prepare(`SELECT * FROM ${t}`).all()).results;
  out.photos = (await env.DB.prepare('SELECT id, fulfillment_id, content_type, r2_key, uploaded_by, uploaded_at FROM photos').all()).results;
  out.stripe_events = (await env.DB.prepare('SELECT id, type, api_version, received_at, processed_at, error FROM stripe_events').all()).results;
  return new Response(JSON.stringify(out, null, 2), { headers: {
    'content-type': 'application/json; charset=utf-8',
    'content-disposition': `attachment; filename="club-dos-buhos-${todayLocal(env)}.json"`, 'cache-control': 'no-store' } });
}

async function handle(request, env) {
  const url = new URL(request.url);
  const p = url.pathname, m = request.method;

  // Stripe calls this directly; it authenticates with its signature instead of Cloudflare Access.
  if (p === '/stripe/webhook' && m === 'POST') return handleWebhook(request, env);
  if (p === '/health') return new Response('ok', { headers: { 'cache-control': 'no-store' } });

  if (env.GOOGLE_CLIENT_ID && p.startsWith('/auth/')) { const a = await handleAuth(request, env, url); if (a) return a; }
  const user = await identify(request, env);
  if (user?.login) {
    if (m !== 'GET') return new Response('Sesión expirada', { status: 401 });
    if (p !== '/') return Response.redirect(`${url.origin}/?next=${encodeURIComponent(p + url.search)}`, 302);
    return loginPage(env, url);
  }
  if (user?.locked) return P.simplePage({ env, user: null, title: 'Falta activar el acceso', status: 403,
    html: '<h1>Falta configurar el inicio de sesión</h1><p>Esta app no muestra datos de socios hasta que el inicio de sesión esté configurado.</p>' });
  if (!user) return P.simplePage({ env, user: null, title: 'Sin acceso', status: 403, html: '<h1>Sin acceso</h1><p>Inicia sesión con tu correo de Dos Búhos.</p>' });

  if (m === 'POST') {
    const origin = request.headers.get('Origin');
    if ((origin && origin !== url.origin) || request.headers.get('Sec-Fetch-Site') === 'cross-site') return new Response('Origen no permitido', { status: 403 });
  }
  const R = (re) => p.match(re);
  let r;

  // ---------- agenda ----------
  if (m === 'GET' && p === '/') {
    const ctx = await loadContext(env);
    return P.agendaPage({ env, user, ctx, url, okAudit: await okAuditFor(env, user, url.searchParams.get('ok')) });
  }

  // ---------- shipments ----------
  if ((r = R(/^\/envio\/(\d+)\/(\d+)(?:\/(estado|detalles|posponer|botellas|foto|entregar|reabrir|ref))?$/))) {
    const sh = await loadShipment(env, Number(r[1]), Number(r[2]));
    if (!sh) return notFound(env, user);
    if (!sh.club) return notFound(env, user, 'Esta suscripción no tiene club asignado, así que no tiene envíos calculados.');
    if (!sh.o) return notFound(env, user, 'Este envío no corresponde: la suscripción terminó antes de esa fecha.');
    const action = r[3];
    if (m === 'GET' && !action) {
      const f = sh.o.f;
      const photos = f ? (await env.DB.prepare('SELECT id FROM photos WHERE fulfillment_id=? ORDER BY id').bind(f.id).all()).results : [];
      const history = (await env.DB.prepare(`SELECT * FROM audit_log WHERE entity='fulfillment' AND entity_id=? ORDER BY id DESC LIMIT 30`).bind(`${sh.sub.id}:${sh.o.k}`).all()).results;
      return P.shipmentPage({ env, user, ctx: sh.ctx, o: sh.o, photos, history });
    }
    if (action === 'entregar') {
      if (m === 'GET') return fulfillPage({ env, user, ctx: sh.ctx, o: sh.o, como: url.searchParams.get('como') });
      if (m === 'POST') return fulfillSubmit(env, user, sh, request);
    }
    if (m !== 'POST') return notFound(env, user);
    const here = `/envio/${sh.sub.id}/${sh.o.k}`;
    if (action === 'reabrir') {
      const err = await reopen(env, user, sh, await form(request));
      return err ? P.simplePage({ env, user, title: 'No se pudo reabrir', status: 400, html: `<p>${esc(err)}</p><p><a href="${here}">Volver al envío</a></p>` }) : redirect(here);
    }
    if (action === 'foto') {
      const fd = await request.formData();
      const file = fd.get('file');
      if (!file || typeof file === 'string') return new Response('Sin archivo', { status: 400 });
      if (file.size > 1_900_000) return new Response('La foto pesa demasiado', { status: 413 });
      const fid = await ensureFulfillmentId(env, user, sh.sub, sh.club, sh.o.k);
      if (env.PHOTOS) {
        const key = `envios/${fid}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.jpg`;
        await env.PHOTOS.put(key, file.stream(), { httpMetadata: { contentType: file.type || 'image/jpeg' } });
        await env.DB.prepare('INSERT INTO photos (fulfillment_id, content_type, r2_key, uploaded_by) VALUES (?,?,?,?)').bind(fid, file.type || 'image/jpeg', key, user.email).run();
      } else {
        await env.DB.prepare('INSERT INTO photos (fulfillment_id, content_type, data, uploaded_by) VALUES (?,?,?,?)').bind(fid, file.type || 'image/jpeg', await file.arrayBuffer(), user.email).run();
      }
      await audit(env, user.email, 'foto', 'fulfillment', `${sh.sub.id}:${sh.o.k}`);
      return Response.json({ ok: true });
    }
    const fm = await form(request);
    if (action === 'estado') {
      const status = String(fm.status || '');
      if (status !== 'scheduled' && !STATUSES.includes(status)) return new Response('Estado inválido', { status: 400 });
      // Shipping / handing over goes through the reviewed flow; undoing a completed shipment goes through "reabrir".
      if (status === 'shipped' || status === 'handed') return redirect(`${here}/entregar?como=${status}`);
      if (status === 'scheduled' && sh.o.state === 'done') return redirect(here);
      if (status === 'delivered' && sh.o.status !== 'shipped') return redirect(here);
      const { auditId } = await setStatus(env, user, sh, status);
      const back = safeBack(fm.back, here);
      return redirect(back === here ? here : withParam(back, 'ok', auditId));
    }
    if (action === 'ref') {
      // Inline PO / tracking from the agenda card: touches only those two fields.
      await writeFulfillment(env, user.email, sh.sub, sh.club, sh.o.k, { order_ref: str(fm.order_ref, 60), tracking: str(fm.tracking, 80) }, 'pedido / guía');
      return redirect(safeBack(fm.back, here));
    }
    if (action === 'detalles') {
      await writeFulfillment(env, user.email, sh.sub, sh.club, sh.o.k, {
        order_ref: str(fm.order_ref, 60), carrier: str(fm.carrier, 60), tracking: str(fm.tracking, 80),
        done_on: dateOrNull(fm.done_on), delivered_on: dateOrNull(fm.delivered_on), note: str(fm.note, 2000),
      }, 'detalles');
      return redirect(here);
    }
    if (action === 'posponer') {
      const clear = fm.clear === '1' || !dateOrNull(fm.delayed_until);
      await writeFulfillment(env, user.email, sh.sub, sh.club, sh.o.k,
        clear ? { delayed_until: null, delay_reason: null } : { delayed_until: dateOrNull(fm.delayed_until), delay_reason: str(fm.delay_reason, 200) },
        clear ? 'quitar posposición' : `posponer → ${fm.delayed_until}`);
      return redirect(here);
    }
    if (action === 'botellas') {
      const list = parseBottles(fm.bottles);
      const why = str(fm.motivo, 300);
      if (list.length && !why) return P.simplePage({ env, user, title: 'Falta el motivo', status: 400, html: `<p>Escribe el motivo del cambio de botellas (por ejemplo, la sustitución que pidió el socio).</p><p><a href="${here}">Volver al envío</a></p>` });
      if (sh.o.state === 'done') return P.simplePage({ env, user, title: 'Envío ya registrado', status: 409, html: `<p>Este envío ya se entregó; su lista de botellas es histórica. Reábrelo si hay que corregirla.</p><p><a href="${here}">Volver al envío</a></p>` });
      await writeFulfillment(env, user.email, sh.sub, sh.club, sh.o.k,
        list.length ? { bottles_json: JSON.stringify(list), bottles_custom: 1 } : { bottles_json: null, bottles_custom: 0 },
        list.length ? `botellas de este envío: ${why}` : 'botellas: volver a la caja del club');
      return redirect(here);
    }
  }

  if (m === 'GET' && (r = R(/^\/foto\/(\d+)$/))) {
    const ph = await env.DB.prepare('SELECT * FROM photos WHERE id=?').bind(Number(r[1])).first();
    if (!ph) return notFound(env, user);
    let body = ph.data ? new Uint8Array(ph.data) : null;
    if (!body && ph.r2_key && env.PHOTOS) body = (await env.PHOTOS.get(ph.r2_key))?.body;
    if (!body) return notFound(env, user);
    return new Response(body, { headers: { 'content-type': ph.content_type || 'image/jpeg', 'cache-control': 'private, max-age=86400' } });
  }

  if (m === 'POST' && (r = R(/^\/deshacer\/(\d+)$/))) {
    const a = await env.DB.prepare(`SELECT * FROM audit_log WHERE id=? AND entity='fulfillment'`).bind(Number(r[1])).first();
    if (!a || (a.who !== user.email && !user.isManager)) return notFound(env, user);
    const latest = await env.DB.prepare(`SELECT id FROM audit_log WHERE entity='fulfillment' AND entity_id=? ORDER BY id DESC LIMIT 1`).bind(a.entity_id).first();
    if (latest.id !== a.id) return P.simplePage({ env, user, title: 'No se puede deshacer', html: `<p>Ese envío ya tuvo otro cambio después. Ábrelo y corrígelo directamente.</p><p><a class="btn" href="/envio/${esc(a.entity_id.replace(':', '/'))}">Abrir envío</a></p>` });
    await undoFulfillment(env, user.email, a);
    return redirect('/');
  }

  // ---------- optional AI helper (read-only) ----------
  if (p === '/preguntar') {
    if (m === 'GET') return P.askPage({ env, user });
    let body; try { body = await request.json(); } catch { return Response.json({ error: 'Pregunta inválida' }, { status: 400 }); }
    try { return Response.json(await ask(env, Array.isArray(body.history) ? body.history : [])); }
    catch (e) { return Response.json({ error: 'El asistente no está disponible: ' + (e.message || e) }, { status: 502 }); }
  }

  // ---------- migration from the legacy app (managers) ----------
  if (p === '/migracion' || p === '/migracion/importar') {
    if (!user.isManager) return forbidden(env, user);
    if (m === 'GET' && p === '/migracion') return migrationPage({ env, user, plan: await buildPlan(env), msg: url.searchParams.get('msg') });
    if (m === 'POST' && p === '/migracion/importar') return redirect('/migracion?msg=' + encodeURIComponent(await runImport(env, user, await request.formData())));
  }

  // ---------- Stripe reconciliation ----------
  if (p === '/conciliar' && m === 'GET') {
    return reconcilePage({ env, user, data: await reconcileData(env), url, msg: url.searchParams.get('msg') });
  }
  if (m === 'POST' && (r = R(/^\/conciliar\/([A-Za-z0-9_]+)$/))) {
    if (!user.isManager) return forbidden(env, user);
    const err = await reconcileSubmit(env, user, r[1], await form(request));
    return redirect('/conciliar?msg=' + encodeURIComponent(err || 'Guardado. El calendario ya se calcula con este club.') + '#p-' + r[1]);
  }

  if (m === 'GET' && p === '/envios') return P.shipmentsPage({ env, user, ctx: await loadContext(env), url });

  // ---------- members ----------
  if (m === 'GET' && p === '/socios') {
    const ctx = await loadContext(env);
    const members = (await env.DB.prepare('SELECT * FROM members ORDER BY name COLLATE NOCASE').all()).results;
    return P.membersPage({ env, user, ctx, members });
  }
  if (m === 'POST' && p === '/socios/nuevo') {
    if (!user.isManager) return forbidden(env, user);
    const fm = await form(request);
    const name = str(fm.name, 120), start = dateOrNull(fm.start_date), clubId = Number(fm.club_id);
    if (!name || !start || !clubId) return redirect('/socios');
    const mem = await env.DB.prepare('INSERT INTO members (name, email, phone, delivery_pref) VALUES (?,?,?,?) RETURNING id')
      .bind(name, str(fm.email, 120), str(fm.phone, 40), fm.delivery_pref === 'envio' ? 'envio' : 'recoge').first();
    const sub = await env.DB.prepare(`INSERT INTO subscriptions (member_id, club_id_override, status, start_date) VALUES (?,?,'manual',?) RETURNING id`).bind(mem.id, clubId, start).first();
    await audit(env, user.email, 'socio manual', 'member', mem.id, null, { name, club_id: clubId, start_date: start, subscription_id: sub.id });
    return redirect(`/socio/${mem.id}`);
  }
  if ((r = R(/^\/socio\/(\d+)(?:\/(datos|beneficio))?$/))) {
    const id = Number(r[1]);
    const member = await env.DB.prepare('SELECT * FROM members WHERE id=?').bind(id).first();
    if (!member) return notFound(env, user);
    if (m === 'GET' && !r[2]) {
      const ctx = await loadContext(env, { memberId: id });
      const benefits = (await env.DB.prepare('SELECT * FROM club_benefits ORDER BY club_id, sort, id').all()).results;
      const uses = (await env.DB.prepare('SELECT * FROM benefit_uses WHERE member_id=? ORDER BY used_on DESC, id DESC').bind(id).all()).results;
      return P.memberPage({ env, user, ctx, member, benefits, uses, url });
    }
    if (m === 'POST' && r[2] === 'datos') {
      const fm = await form(request);
      const after = { delivery_pref: fm.delivery_pref === 'envio' ? 'envio' : 'recoge', delivery_address: str(fm.delivery_address, 400), staff_note: str(fm.staff_note, 2000) };
      if (!member.stripe_customer_id && 'phone' in fm) after.phone = str(fm.phone, 40);
      const cols = Object.keys(after);
      await env.DB.prepare(`UPDATE members SET ${cols.map(c => `${c}=?`).join(',')}, updated_at=datetime('now') WHERE id=?`).bind(...cols.map(c => after[c]), id).run();
      await audit(env, user.email, 'datos del socio', 'member', id, Object.fromEntries(cols.map(c => [c, member[c]])), after);
      return redirect(`/socio/${id}`);
    }
    if (m === 'POST' && r[2] === 'beneficio') {
      const fm = await form(request);
      const b = await env.DB.prepare('SELECT * FROM club_benefits WHERE id=?').bind(Number(fm.benefit_id)).first();
      const qty = Number(fm.qty), on = dateOrNull(fm.used_on);
      if (!b || !(qty > 0) || !on) return redirect(`/socio/${id}`);
      const u = await env.DB.prepare('INSERT INTO benefit_uses (member_id, benefit_id, qty, used_on, note, created_by) VALUES (?,?,?,?,?,?) RETURNING *')
        .bind(id, b.id, qty, on, str(fm.note, 300), user.email).first();
      await audit(env, user.email, `beneficio: ${b.name}`, 'member', id, null, u);
      return redirect(`/socio/${id}`);
    }
  }
  if (m === 'POST' && (r = R(/^\/beneficio-uso\/(\d+)\/borrar$/))) {
    if (!user.isManager) return forbidden(env, user);
    const u = await env.DB.prepare('SELECT * FROM benefit_uses WHERE id=?').bind(Number(r[1])).first();
    if (!u) return notFound(env, user);
    await env.DB.prepare('DELETE FROM benefit_uses WHERE id=?').bind(u.id).run();
    await audit(env, user.email, 'quitar uso de beneficio', 'member', u.member_id, u, null);
    return redirect(`/socio/${u.member_id}`);
  }

  // ---------- subscription corrections (managers) ----------
  if (m === 'POST' && (r = R(/^\/suscripcion\/(\d+)\/(ajustes|historico|pausa|terminar)$/))) {
    if (!user.isManager) return forbidden(env, user);
    const sub = await getSub(env, Number(r[1]));
    if (!sub) return notFound(env, user);
    const fm = await form(request);
    const back = `/socio/${sub.member_id}`;
    if (r[2] === 'ajustes') {
      const after = {
        anchor_override: dateOrNull(fm.anchor_override),
        seq_offset: Math.max(-50, Math.min(50, Math.trunc(Number(fm.seq_offset) || 0))),
        club_id_override: Number(fm.club_id_override) || null,
      };
      const before = { anchor_override: sub.anchor_override, seq_offset: sub.seq_offset, club_id_override: sub.club_id_override };
      await env.DB.prepare('UPDATE subscriptions SET anchor_override=?, seq_offset=?, club_id_override=? WHERE id=?').bind(after.anchor_override, after.seq_offset, after.club_id_override, sub.id).run();
      await audit(env, user.email, 'corrección de suscripción', 'subscription', sub.id, before, after);
    } else if (r[2] === 'historico') {
      const before = dateOrNull(fm.before);
      const ctx = await loadContext(env, { memberId: sub.member_id });
      const s = ctx.subs.find(x => x.id === sub.id); const club = subClub(ctx, s);
      if (before && club) {
        let n = 0;
        for (const o of subOccurrences(ctx, s, before)) {
          if (o.due >= before || o.status) continue;
          await writeFulfillment(env, user.email, s, club, o.k, { status: 'handed', done_on: o.due, note: 'Registro histórico', ...(o.bottles ? { bottles_json: JSON.stringify(o.bottles) } : {}) }, 'registro histórico');
          n++;
        }
        await audit(env, user.email, `registro histórico: ${n} envíos antes de ${before}`, 'subscription', sub.id);
      }
    } else if (r[2] === 'pausa') {
      const from = dateOrNull(fm.from_date), until = dateOrNull(fm.until_date);
      if (from && (!until || until > from)) {
        const row = await env.DB.prepare(`INSERT INTO pauses (subscription_id, from_date, until_date, source, note, created_by) VALUES (?,?,?,'manual',?,?) RETURNING *`).bind(sub.id, from, until, str(fm.note, 200), user.email).first();
        await audit(env, user.email, 'pausa', 'subscription', sub.id, null, row);
      }
    } else if (r[2] === 'terminar' && !sub.stripe_subscription_id) {
      const on = dateOrNull(fm.ended_on) || todayLocal(env);
      await env.DB.prepare(`UPDATE subscriptions SET status='manual_ended', ended_on=? WHERE id=?`).bind(on, sub.id).run();
      await audit(env, user.email, 'terminar suscripción manual', 'subscription', sub.id, { status: sub.status, ended_on: sub.ended_on }, { status: 'manual_ended', ended_on: on });
    }
    return redirect(back);
  }

  // ---------- clubs ----------
  if (m === 'GET' && p === '/clubes') {
    const ctx = await loadContext(env);
    const benefits = (await env.DB.prepare('SELECT * FROM club_benefits ORDER BY club_id, sort, id').all()).results;
    const products = (await env.DB.prepare('SELECT * FROM stripe_products ORDER BY club_id IS NOT NULL, name').all()).results;
    const counts = new Map();
    for (const s of ctx.subs) {
      const c = subClub(ctx, s);
      if (c && !['canceled', 'incomplete_expired', 'manual_ended'].includes(s.status) && !(s.ended_on && s.ended_on <= ctx.today)) counts.set(c.id, (counts.get(c.id) || 0) + 1);
    }
    return P.clubsPage({ env, user, ctx, benefits, products, counts });
  }
  if (m === 'POST' && (r = R(/^\/club\/(\d+)(?:\/(caja|beneficio)(?:\/(\d+))?)?$/))) {
    if (!user.isManager) return forbidden(env, user);
    const club = await env.DB.prepare('SELECT * FROM clubs WHERE id=?').bind(Number(r[1])).first();
    if (!club) return notFound(env, user);
    const fm = await form(request);
    if (!r[2]) {
      const cadence = [1, 2, 3, 4, 6, 12].includes(Number(fm.cadence_months)) ? Number(fm.cadence_months) : club.cadence_months;
      const after = { name: str(fm.name, 80) || club.name, bottles: Math.max(1, Math.min(60, Math.trunc(Number(fm.bottles) || club.bottles))), cadence_months: cadence,
        allocation_mode: fm.allocation_mode === 'month' ? 'month' : 'sequence', keywords: str(fm.keywords, 200), legacy: fm.legacy ? 1 : 0, active: fm.active ? 1 : 0 };
      const cols = Object.keys(after);
      await env.DB.prepare(`UPDATE clubs SET ${cols.map(c => `${c}=?`).join(',')} WHERE id=?`).bind(...cols.map(c => after[c]), club.id).run();
      await audit(env, user.email, 'club', 'club', club.id, Object.fromEntries(cols.map(c => [c, club[c]])), after);
    } else if (r[2] === 'caja' && r[3]) {
      const slot = Number(r[3]);
      const list = parseBottles(fm.bottles);
      const before = await env.DB.prepare('SELECT bottles_json FROM club_cases WHERE club_id=? AND slot=?').bind(club.id, slot).first();
      if (list.length) await env.DB.prepare(`INSERT INTO club_cases (club_id, slot, bottles_json, updated_by) VALUES (?,?,?,?)
        ON CONFLICT(club_id, slot) DO UPDATE SET bottles_json=excluded.bottles_json, updated_by=excluded.updated_by, updated_at=datetime('now')`).bind(club.id, slot, JSON.stringify(list), user.email).run();
      else await env.DB.prepare('DELETE FROM club_cases WHERE club_id=? AND slot=?').bind(club.id, slot).run();
      await audit(env, user.email, `caja ${slot}`, 'club', club.id, before, list.length ? { bottles_json: JSON.stringify(list) } : null);
    } else if (r[2] === 'beneficio') {
      const name = str(fm.name, 100);
      if (name) {
        const b = await env.DB.prepare(`INSERT INTO club_benefits (club_id, name, quantity, unit, period, active, sort) VALUES (?,?,?,?,?,?, (SELECT COALESCE(MAX(sort),0)+1 FROM club_benefits WHERE club_id=?)) RETURNING *`)
          .bind(club.id, name, fm.quantity === '' || fm.quantity == null ? null : Number(fm.quantity), str(fm.unit, 30) || 'veces', fm.period === 'once' ? 'once' : 'year', fm.active === '0' ? 0 : 1, club.id).first();
        await audit(env, user.email, 'nuevo beneficio', 'club', club.id, null, b);
      }
      return redirect(`/ajustes/beneficios#club${club.id}`);
    }
    return redirect(`/clubes#club${club.id}`);
  }
  if (m === 'POST' && (r = R(/^\/beneficio\/(\d+)$/))) {
    if (!user.isManager) return forbidden(env, user);
    const b = await env.DB.prepare('SELECT * FROM club_benefits WHERE id=?').bind(Number(r[1])).first();
    if (!b) return notFound(env, user);
    const fm = await form(request);
    const after = { name: str(fm.name, 100) || b.name, quantity: fm.quantity === '' || fm.quantity == null ? null : Number(fm.quantity), unit: str(fm.unit, 30) || b.unit, period: fm.period === 'once' ? 'once' : 'year', active: fm.active === '0' ? 0 : 1 };
    await env.DB.prepare('UPDATE club_benefits SET name=?, quantity=?, unit=?, period=?, active=? WHERE id=?').bind(after.name, after.quantity, after.unit, after.period, after.active, b.id).run();
    await audit(env, user.email, 'beneficio', 'club', b.club_id, b, after);
    return redirect(`/ajustes/beneficios#club${b.club_id}`);
  }
  if (m === 'POST' && (r = R(/^\/producto\/([A-Za-z0-9_]+)$/))) {
    if (!user.isManager) return forbidden(env, user);
    const prod = await env.DB.prepare('SELECT * FROM stripe_products WHERE product_id=?').bind(r[1]).first();
    if (!prod) return notFound(env, user);
    const clubId = Number((await form(request)).club_id) || null;
    await env.DB.prepare(`UPDATE stripe_products SET club_id=?, mapped_by=?, mapped_at=datetime('now') WHERE product_id=?`).bind(clubId, clubId ? user.email : null, prod.product_id).run();
    await audit(env, user.email, 'producto de Stripe → club', 'stripe_product', prod.product_id, { club_id: prod.club_id }, { club_id: clubId });
    return redirect('/clubes#stripe');
  }

  // ---------- settings (managers) ----------
  if (p === '/ajustes' || p === '/sync' || p === '/exportar.json' || p === '/ajustes/beneficios') {
    if (!user.isManager) return forbidden(env, user);
    if (m === 'GET' && p === '/ajustes/beneficios') {
      const ctx = await loadContext(env);
      const benefits = (await env.DB.prepare('SELECT * FROM club_benefits ORDER BY club_id, sort, id').all()).results;
      return P.benefitsPage({ env, user, ctx, benefits });
    }
    if (m === 'GET' && p === '/ajustes') {
      const ctx = await loadContext(env);
      const auditRows = (await env.DB.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT 100').all()).results;
      const eventCount = (await env.DB.prepare('SELECT COUNT(*) AS n FROM stripe_events').first()).n;
      return P.settingsPage({ env, user, ctx, auditRows, eventCount, url });
    }
    if (m === 'POST' && p === '/ajustes') {
      const v = dateOrNull((await form(request)).tracking_start);
      if (v) { await setSetting(env, 'tracking_start', v); await audit(env, user.email, `inicio del registro → ${v}`, 'settings', 'tracking_start'); }
      return redirect('/ajustes?msg=' + encodeURIComponent('Guardado'));
    }
    if (m === 'POST' && p === '/sync') {
      const s = await syncStripe(env, user.email);
      await audit(env, user.email, 'sincronizar Stripe', 'settings', 'last_sync', null, s);
      return redirect('/ajustes?msg=' + encodeURIComponent(s.ok ? `Sincronizado: ${s.subscriptions} suscripciones, ${s.invoices} pagos` : `Error: ${s.error}`));
    }
    if (m === 'GET' && p === '/exportar.json') {
      await audit(env, user.email, 'exportar datos', 'settings', 'export');
      return exportData(env);
    }
  }
  return notFound(env, user);
}

export default {
  async fetch(request, env, ctx) {
    try {
      return await handle(request, env);
    } catch (e) {
      console.error(e);
      return new Response(`<!doctype html><meta name="viewport" content="width=device-width"><body style="font:16px system-ui;padding:20px">
        <h1>Algo falló</h1><p>${esc(e.message || e)}</p><p><a href="/">Volver a la agenda</a></p>`, { status: 500, headers: { 'content-type': 'text/html; charset=utf-8' } });
    }
  },
  // Hourly safety net: pull Stripe so new members, cancellations and payments show up even without webhooks.
  // The schedule itself never depends on this running.
  async scheduled(event, env, ctx) {
    if (env.STRIPE_SECRET_KEY) ctx.waitUntil(syncStripe(env, 'cron'));
  },
};
