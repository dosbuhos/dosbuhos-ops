import * as Q from './queue.js';
import * as T from './tracker.js';
import { alertsPage, buildAlerts } from './alerts.js';
import { identify } from './auth.js';
import { esc } from './ui.js';
import { STATUSES, DONE, isDate, dueDate, parseBottles, membershipYear } from './schedule.js';
import { loadContext, subClub, subOccurrences, getSub, writeFulfillment, undoFulfillment, audit, setSetting, todayLocal, isIgnored } from './data.js';
import { subEnded } from './visibility.js';
import { activityData, activityPage } from './activity.js';
import { syncStripe, handleWebhook } from './stripe.js';
import * as P from './pages.js';
import { fulfillPage, fulfillSubmit, reopen, reconcileData, reconcilePage, reconcileSubmit, packingProblem } from './flow.js';
import { ask } from './assistant.js';
import { handleAuth, loginPage } from './google.js';
import { buildPlan, migrationPage, runImport } from './legacy.js';
import {receiptPage,receiptSubmit} from './receipt.js';
import {billingPage} from './billing.js';
import {reactivationPage,reactivate} from './reactivation.js';

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

async function setStatus(env, user, sh, status, version, reason = null, holdUntil = null) {
  const { sub, club, o } = sh;
  const today = todayLocal(env);
  const fields = {};
  if (status === 'scheduled') {
    Object.assign(fields, { status: null, done_on: null, delivered_on: null });
    if (o.f && !o.f.bottles_custom) fields.bottles_json = null; // let it follow the club case again
  } else {
    fields.status = status;
    if(status==='held')Object.assign(fields,{held_on:o.status==='held'&&o.f?.held_on?o.f.held_on:today,hold_reason:reason||'Resguardo solicitado por el socio',hold_until:holdUntil});
    if (DONE.has(status) && !o.f?.done_on) fields.done_on = today;
    if (status === 'delivered' && !o.f?.delivered_on) fields.delivered_on = today;
    // Snapshot the case the moment work starts, so later edits to the club case never rewrite this shipment.
    if (status !== 'skipped' && !o.f?.bottles_json && o.bottles) fields.bottles_json = JSON.stringify(o.bottles);
  }
  return writeFulfillment(env, user.email, sub, club, o.k, fields, `estado: ${status === 'scheduled' ? 'pendiente' : status}`, { version });
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
  out.photos = (await env.DB.prepare('SELECT id, fulfillment_id, content_type, r2_key, uploaded_by, uploaded_at,kind,recipient,received_on,note FROM photos').all()).results;
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
  if(m==='GET'&&p==='/alertas')return billingPage({env,user,ctx:await loadContext(env)});
  if (m === 'GET' && p === '/') {
    const ctx = await loadContext(env);
    return Q.queuePage({ env, user, ctx, url, okAudit: await okAuditFor(env, user, url.searchParams.get('ok')) });
  }
  if (m === 'GET' && p === '/avisos') return alertsPage({ env, user, ctx: await loadContext(env) });
  if (m === 'GET' && p === '/avisos.json') { const a = buildAlerts(await loadContext(env), user); return Response.json({ n: a.length, red: a.filter(x => x.tone === 'red').length }, { headers: { 'cache-control': 'no-store' } }); }
  if (m === 'GET' && p === '/confirmar') {
    const ctx = await loadContext(env);
    return Q.confirmPage({ env, user, ctx, url, okAudit: await okAuditFor(env, user, url.searchParams.get('ok')) });
  }

  // ---------- shipments ----------
  if ((r = R(/^\/envio\/(\d+)\/(\d+)(?:\/(estado|detalles|posponer|botellas|foto|entregar|reabrir|ref|comprobante|rapido))?$/))) {
    const sh = await loadShipment(env, Number(r[1]), Number(r[2]));
    if (!sh) return notFound(env, user);
    if (!sh.club) return notFound(env, user, 'Esta suscripción no tiene club asignado, así que no tiene envíos calculados.');
    if (!sh.o) return notFound(env, user, 'Este envío no corresponde: la suscripción terminó antes de esa fecha.');
    const action = r[3];
    if(sh.o.state==='payment_contact'&&(action==='entregar'||action==='estado'||action==='rapido'))return P.simplePage({env,user,title:'Contactar para nueva forma de pago',status:403,html:`<h1>Contactar para nueva forma de pago</h1><p>Este socio está en seguimiento, no suspendido. Verifica el pago de esta caja antes de preparar o entregar.</p><a href="/socio/${sh.sub.member_id}#membresia">Ver seguimiento del socio</a>`});
    if(sh.o.state==='payment_blocked'&&(action==='entregar'||action==='estado'||action==='rapido'))return P.simplePage({env,user,title:'Envío bloqueado por pago',status:403,html:`<p>Este envío sigue bloqueado por pago pendiente. Verifica el pago en Stripe antes de preparar o entregar.</p><a href="/socio/${sh.sub.member_id}#membresia">Ver socio</a>`});
    if(sh.sub.suspended_on&&(action==='entregar'||action==='estado'||action==='rapido'))return P.simplePage({env,user,title:'Membresía suspendida',status:403,html:`<h1>Suspendido por falta de pago</h1><p>Preparación y entregas bloqueadas. Un administrador debe revisar el pago y reactivar la membresía.</p><p><a href="/socio/${sh.sub.member_id}#membresia">Ver membresía</a></p>`});
    if(action==='comprobante') {
      if(m==='GET')return receiptPage({env,user,sh,kind:url.searchParams.get('tipo')});
      if(m==='POST')return receiptSubmit(env,user,sh,request);
    }
    if (m === 'GET' && !action) {
      const f = sh.o.f;
      const photos = f ? (await env.DB.prepare('SELECT id,kind,recipient,received_on,note,uploaded_by,uploaded_at FROM photos WHERE fulfillment_id=? ORDER BY id').bind(f.id).all()).results : [];
      const history = (await env.DB.prepare(`SELECT * FROM audit_log WHERE entity='fulfillment' AND entity_id=? ORDER BY id DESC LIMIT 30`).bind(`${sh.sub.id}:${sh.o.k}`).all()).results;
      return P.shipmentPage({ env, user, ctx: sh.ctx, o: sh.o, photos, history });
    }
    if (action === 'entregar') {
      if (m === 'GET') return fulfillPage({ env, user, ctx: sh.ctx, o: sh.o, como: url.searchParams.get('como'), back: url.searchParams.get('back') });
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
    const version = Number(fm.version) || 0;
    if (version !== (sh.o.f?.version || 0)) return P.simplePage({ env, user, title: 'El envío cambió', status: 409,
      html: `<p>Otra persona cambió este envío. Revisa la información actual antes de guardar.</p><p><a class="btn" href="${here}">Revisar envío</a></p>` });
    const save = (fields, action) => writeFulfillment(env, user.email, sh.sub, sh.club, sh.o.k, fields, action, { version });
    if (action === 'estado') {
      const status = String(fm.status || '');
      if (status !== 'scheduled' && !STATUSES.includes(status)) return new Response('Estado inválido', { status: 400 });
      // Shipping / handing over goes through the reviewed flow; undoing a completed shipment goes through "reabrir".
      if (status === 'shipped' || status === 'handed') return redirect(`${here}/entregar?como=${status}${fm.back && safeBack(fm.back, '') ? '&back=' + encodeURIComponent(safeBack(fm.back, here)) : ''}`);
      if (status === 'scheduled' && sh.o.state === 'done') return redirect(here);
      if (status === 'delivered' && sh.o.status !== 'shipped') return redirect(here);
      if (sh.o.state === 'done' && status !== 'delivered') return redirect(here);
      if (status === 'ready' && (!sh.o.bottles || sh.o.bottlesTotal !== sh.o.expectedBottles)) return P.simplePage({ env, user, title: 'Falta revisar la caja', status: 400,
        html: `<p>Define una caja con ${sh.o.expectedBottles} botellas antes de marcarla lista.</p><p><a href="${here}#botellas">Revisar botellas</a></p>` });
      if(status==='held'&&fm.hold_until&&!dateOrNull(fm.hold_until))return P.simplePage({env,user,title:'Fecha de resguardo inválida',status:400,html:`<p>Indica una fecha válida o deja el campo vacío para un resguardo indefinido.</p><p><a href="${here}">Volver al envío</a></p>`});
      const { auditId } = await setStatus(env, user, sh, status, version, str(fm.hold_reason,300),dateOrNull(fm.hold_until));
      const back = safeBack(fm.back, here);
      return redirect(back === here ? here : withParam(back, 'ok', auditId));
    }
    if (action === 'rapido') {
      // Quick log from the member and calendar views: how it left, the real date, optional PO.
      // Same version check and audit as every write; the box snapshot is kept, and an unchecked box is noted as such.
      const fail = (msg) => P.simplePage({ env, user, title: 'No se guardó', status: 400, html: `<p>${esc(msg)}</p><p><a class="btn" href="${esc(safeBack(fm.back, here))}">Volver</a></p>` });
      if (!['overdue', 'today', 'exception', 'held'].includes(sh.o.state)) return fail('Esta caja ya está registrada o todavía no toca. Ábrela para cambiarla.');
      const doneOn = dateOrNull(fm.done_on);
      if (!doneOn) return fail('Indica la fecha real en que salió la caja.');
      if (doneOn > sh.ctx.today) return fail('La fecha no puede ser en el futuro.');
      const how = ['pickup', 'courier', 'signup'].includes(fm.como) ? fm.como : 'pickup';
      const problem = packingProblem(sh.o);
      const { auditId } = await save({
        status: how === 'courier' ? 'shipped' : 'handed', done_on: doneOn, method: how,
        order_ref: str(fm.order_ref, 60) || sh.o.f?.order_ref || null, handled_by: user.email,
        bottles_json: sh.o.f?.bottles_json || (sh.o.bottles ? JSON.stringify(sh.o.bottles) : null),
        override_reason: problem ? 'Registro rápido: caja sin revisar en la app' : null,
      }, `${how === 'courier' ? 'enviado' : how === 'signup' ? 'entregado al inscribirse' : 'entregado en mano'} (registro rápido)`);
      const back = safeBack(fm.back, '/socios');
      return redirect(withParam(back, 'ok', auditId) + `#e${sh.sub.id}-${sh.o.k}`);
    }
    if (action === 'ref') {
      // Inline PO / tracking from the agenda card: touches only those two fields.
      await save({ order_ref: str(fm.order_ref, 60), tracking: str(fm.tracking, 80) }, 'pedido / guía');
      return redirect(safeBack(fm.back, here));
    }
    if (action === 'detalles') {
      await save({
        order_ref: str(fm.order_ref, 60), carrier: str(fm.carrier, 60), tracking: str(fm.tracking, 80),
        done_on: dateOrNull(fm.done_on), delivered_on: dateOrNull(fm.delivered_on), note: str(fm.note, 2000),
      }, 'detalles');
      return redirect(here);
    }
    if (action === 'posponer') {
      const clear = fm.clear === '1';
      const date = dateOrNull(fm.delayed_until);
      const reason = str(fm.delay_reason, 200);
      const error = !['overdue', 'today', 'upcoming', 'exception'].includes(sh.o.state)
        ? 'Solo se puede aplazar un envío pendiente.'
        : !clear && (!date || date <= sh.o.due || date < sh.ctx.today)
          ? 'Elige una fecha válida, posterior a la fecha original y no anterior a hoy.'
          : !clear && !reason ? 'Escribe el motivo del aplazamiento.' : null;
      if (error) return P.simplePage({ env, user, title: 'No se pudo aplazar', status: 400,
        html: `<p>${esc(error)}</p><p><a href="${here}#aplazar">Volver al envío</a></p>` });
      await save(
        clear ? { delayed_until: null, delay_reason: null } : { delayed_until: date, delay_reason: reason },
        clear ? 'quitar aplazamiento de entrega' : `aplazar entrega → ${date}: ${reason}`);
      return redirect(here);
    }
    if (action === 'botellas') {
      const list = parseBottles(fm.bottles);
      const why = str(fm.motivo, 300);
      if (list.length && !why) return P.simplePage({ env, user, title: 'Falta el motivo', status: 400, html: `<p>Escribe el motivo del cambio de botellas (por ejemplo, la sustitución que pidió el socio).</p><p><a href="${here}">Volver al envío</a></p>` });
      if (sh.o.state === 'done') return P.simplePage({ env, user, title: 'Envío ya registrado', status: 409, html: `<p>Este envío ya se entregó; su lista de botellas es histórica. Reábrelo si hay que corregirla.</p><p><a href="${here}">Volver al envío</a></p>` });
      await save(
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
    return new Response(body, { headers: { 'content-type': ph.content_type || 'image/jpeg', 'cache-control': 'private, max-age=86400', 'x-content-type-options':'nosniff' } });
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
  if (m === 'GET' && p === '/revision') return P.reviewPage({ env, user, ctx: await loadContext(env) });

  // ---------- members ----------
  if (m === 'GET' && p === '/socios') {
    const ctx = await loadContext(env);
    return T.trackerPage({ env, user, ctx, url, okAudit: await okAuditFor(env, user, url.searchParams.get('ok')) });
  }
  if (m === 'GET' && p === '/calendario') {
    const ctx = await loadContext(env);
    return T.calendarPage({ env, user, ctx, url, okAudit: await okAuditFor(env, user, url.searchParams.get('ok')) });
  }
  if (m === 'GET' && p === '/socios/lista') {
    const ctx = await loadContext(env);
    const members = (await env.DB.prepare('SELECT * FROM members ORDER BY name COLLATE NOCASE').all()).results;
    return P.membersPage({ env, user, ctx, members, url });
  }
  if (m === 'POST' && p === '/socios/nuevo') {
    if (!user.isManager) return forbidden(env, user);
    const fm = await form(request);
    const name = str(fm.name, 120), start = dateOrNull(fm.start_date), clubId = Number(fm.club_id);
    if (!name || !start || !clubId) return redirect('/socios/lista');
    const mem = await env.DB.prepare('INSERT INTO members (name, email, phone, delivery_pref) VALUES (?,?,?,?) RETURNING id')
      .bind(name, str(fm.email, 120), str(fm.phone, 40), fm.delivery_pref === 'envio' ? 'envio' : 'recoge').first();
    const sub = await env.DB.prepare(`INSERT INTO subscriptions (member_id, club_id_override, status, start_date) VALUES (?,?,'manual',?) RETURNING id`).bind(mem.id, clubId, start).first();
    await audit(env, user.email, 'socio manual', 'member', mem.id, null, { name, club_id: clubId, start_date: start, subscription_id: sub.id });
    return redirect(`/socio/${mem.id}`);
  }
  if ((r = R(/^\/socio\/(\d+)(?:\/(datos|beneficio|membresia|reactivar|regreso))?$/))) {
    const id = Number(r[1]);
    const member = await env.DB.prepare('SELECT * FROM members WHERE id=?').bind(id).first();
    if (!member) return notFound(env, user);
    if (r[2] === 'regreso' && m === 'POST') {
      // Quit and came back: a new manual stage starting on the date staff confirm; the ended stage stays as history.
      if (!user.isManager) return forbidden(env, user);
      const fm = await form(request);
      const ctx = await loadContext(env, { memberId: id });
      const start = dateOrNull(fm.start_date), club = ctx.clubs.get(Number(fm.club_id)), note = str(fm.note, 300);
      const fail = (msg) => P.simplePage({ env, user, title: 'No se registró el regreso', status: 400, html: `<h1>No se registró el regreso</h1><p>${esc(msg)}</p><p><a href="/socio/${id}#regreso">Volver a la ficha</a></p>` });
      if (!start || !club) return fail('Elige el club y la fecha de reinicio.');
      if (member.suspended_on) return fail('Este socio está suspendido por falta de pago. Usa “Reactivar membresía” en su ficha.');
      const subs = ctx.subs.filter(s => s.member_id === id && subClub(ctx, s) && !isIgnored(s));
      if (subs.some(s => !subEnded(s, ctx.today))) return fail('Este socio ya tiene una membresía activa. Para cambiar su fecha usa “Correcciones” en la ficha.');
      const lastEnd = subs.map(s => s.ended_on).filter(Boolean).sort().pop();
      if (lastEnd && start < lastEnd) return fail(`La fecha de reinicio no puede ser antes del fin de su membresía anterior (${lastEnd}).`);
      const sub = await env.DB.prepare(`INSERT INTO subscriptions (member_id, club_id_override, status, start_date) VALUES (?,?,'manual',?) RETURNING id`).bind(id, club.id, start).first();
      await audit(env, user.email, 'regreso al club', 'member', id, { ended_on: lastEnd || null }, { subscription_id: sub.id, club_id: club.id, start_date: start, note });
      return redirect(`/socio/${id}?regreso=${start}`);
    }
    if(r[2]==='reactivar') {
      if(!user.isManager)return forbidden(env,user);
      if(m==='POST')return reactivate(env,user,member,await form(request));
      if(m==='GET')return member.suspended_on?reactivationPage({env,user,member,ctx:await loadContext(env,{memberId:id})}):redirect(`/socio/${id}`);
    }
    if (m === 'GET' && !r[2]) {
      const ctx = await loadContext(env, { memberId: id });
      const benefits = (await env.DB.prepare('SELECT * FROM club_benefits ORDER BY club_id, sort, id').all()).results;
      const uses = (await env.DB.prepare('SELECT * FROM benefit_uses WHERE member_id=? ORDER BY used_on DESC, id DESC').bind(id).all()).results;
      return P.memberPage({ env, user, ctx, member, benefits, uses, url });
    }
    if (m === 'POST' && r[2] === 'membresia') {
      if(!user.isManager)return forbidden(env,user);
      const fm=await form(request),reason=str(fm.reason,500),version=Number(fm.version);
      if(fm.action==='resume')return redirect(`/socio/${id}/reactivar`);
      if(['contact','clear_contact'].includes(fm.action)) {
        if(!reason)return new Response('Indica el motivo del seguimiento o su cierre.',{status:400});
        if(version!==member.membership_version)return new Response('La membresía cambió. Recarga la ficha.',{status:409});
        if(fm.action==='clear_contact') {
          const ctx=await loadContext(env,{memberId:id});
          if(member.suspended_on||ctx.subs.some(s=>s.stripe_subscription_id&&['past_due','unpaid','incomplete'].includes(s.status)))return P.simplePage({env,user,title:'Seguimiento pendiente',status:400,html:`<p>Stripe todavía indica un problema de pago, o el socio está suspendido. Revisa y sincroniza el cobro antes de cerrar el seguimiento.</p><a href="/socio/${id}#membresia">Volver al socio</a>`});
        }
        const after=fm.action==='contact'?{suspended_on:null,suspension_reason:null,suspension_by:null,payment_followup_on:todayLocal(env),payment_followup_reason:reason,payment_followup_by:user.email}:{payment_followup_on:null,payment_followup_reason:null,payment_followup_by:null};
        const cols=Object.keys(after);
        const results=await env.DB.batch([
          env.DB.prepare(`UPDATE members SET ${cols.map(c=>c+'=?').join(',')},membership_version=membership_version+1,updated_at=datetime('now') WHERE id=? AND membership_version=? RETURNING id`).bind(...Object.values(after),id,version),
          env.DB.prepare(`INSERT INTO audit_log(who,action,entity,entity_id,before_json,after_json,note) SELECT ?,?,'member',?,?,?,? WHERE changes()=1`).bind(user.email,fm.action==='contact'?'seguimiento de pago: pendiente de contacto':'cerrar seguimiento de pago',String(id),JSON.stringify(Object.fromEntries(cols.map(c=>[c,member[c]]))),JSON.stringify(after),reason)
        ]);
        if(!results[0].results.length)return new Response('La membresía cambió. Recarga la ficha.',{status:409});
        return redirect(`/socio/${id}#membresia`);
      }
      if(!reason||!['suspend','resume'].includes(fm.action))return new Response('Indica el motivo de este cambio.',{status:400});
      if(version!==member.membership_version||!!member.suspended_on!==(fm.action==='resume'))return new Response('La membresía cambió. Recarga la ficha antes de guardar.',{status:409});
      const after={suspended_on:fm.action==='suspend'?todayLocal(env):null,suspension_reason:fm.action==='suspend'?reason:null,suspension_by:fm.action==='suspend'?user.email:null};
      const results=await env.DB.batch([
        env.DB.prepare(`UPDATE members SET suspended_on=?,suspension_reason=?,suspension_by=?,membership_version=membership_version+1,updated_at=datetime('now') WHERE id=? AND membership_version=? RETURNING id`).bind(after.suspended_on,after.suspension_reason,after.suspension_by,id,version),
        env.DB.prepare(`INSERT INTO audit_log (who,action,entity,entity_id,before_json,after_json,note) SELECT ?,?,'member',?,?,?,? WHERE changes()=1`).bind(user.email,fm.action==='suspend'?'suspender por falta de pago':'reactivar membresía',String(id),JSON.stringify({suspended_on:member.suspended_on,suspension_reason:member.suspension_reason,suspension_by:member.suspension_by}),JSON.stringify(after),reason)
      ]);
      if(!results[0].results.length)return new Response('La membresía cambió. Recarga la ficha.',{status:409});
      return redirect(`/socio/${id}#membresia`);
    }
    if (m === 'POST' && r[2] === 'datos') {
      const fm = await form(request);
      const after = { delivery_pref: fm.delivery_pref === 'envio' ? 'envio' : 'recoge', delivery_address: str(fm.delivery_address, 400), staff_note: str(fm.staff_note, 2000) };
      if('contact_email' in fm) {
        const email=str(fm.contact_email,120);
        if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return P.simplePage({env,user,title:'Correo inválido',status:400,html:`<p>Indica un correo válido.</p><a href="/socio/${id}">Volver al socio</a>`});
        after.contact_email=email;
      }
      if('contact_phone' in fm)after.contact_phone=str(fm.contact_phone,40);
      if (!member.stripe_customer_id && 'phone' in fm) after.phone = str(fm.phone, 40);
      const cols = Object.keys(after);
      await env.DB.prepare(`UPDATE members SET ${cols.map(c => `${c}=?`).join(',')}, updated_at=datetime('now') WHERE id=?`).bind(...cols.map(c => after[c]), id).run();
      await audit(env, user.email, 'datos del socio', 'member', id, Object.fromEntries(cols.map(c => [c, member[c]])), after);
      return redirect(`/socio/${id}`);
    }
    if (m === 'POST' && r[2] === 'beneficio') {
      if(member.suspended_on)return new Response('Membresía suspendida: reactiva al socio antes de registrar beneficios.',{status:403});
      const fm = await form(request);
      const b = await env.DB.prepare('SELECT * FROM club_benefits WHERE id=?').bind(Number(fm.benefit_id)).first();
      if(fm.quick==='1') {
        const qty=Number(fm.qty),key=str(fm.request_key,50),today=todayLocal(env);
        if(!b?.active||!Number.isInteger(qty)||qty<1||qty>100||!key||!/^[a-f0-9-]{36}$/.test(key))return new Response('Cantidad o solicitud inválida.',{status:400});
        const ctx=await loadContext(env,{memberId:id});
        const sub=ctx.subs.find(s=>subClub(ctx,s)&&!['canceled','incomplete_expired','manual_ended'].includes(s.status));
        if(!sub||subClub(ctx,sub).id!==b.club_id)return new Response('Este beneficio no pertenece al club activo del socio.',{status:400});
        const year=membershipYear(sub.anchor_override||sub.start_date,today);
        const from=b.period==='once'?'0000-01-01':year.start,to=b.period==='once'?'9999-12-31':year.end;
        const after={benefit_id:b.id,qty,used_on:today,handled_by:user.email};
        const result=await env.DB.batch([
          env.DB.prepare(`INSERT INTO benefit_uses (member_id,benefit_id,qty,used_on,created_by,handled_by,request_key)
            SELECT ?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM members WHERE id=? AND suspended_on IS NOT NULL)
            AND (? IS NULL OR COALESCE((SELECT SUM(qty) FROM benefit_uses WHERE member_id=? AND benefit_id=? AND used_on BETWEEN ? AND ?),0)+?<=?)
            ON CONFLICT(request_key) DO NOTHING RETURNING id`).bind(id,b.id,qty,today,user.email,user.email,key,id,b.quantity,id,b.id,from,to,qty,b.quantity),
          env.DB.prepare(`INSERT INTO audit_log (who,action,entity,entity_id,after_json) SELECT ?,?,'member',?,? WHERE changes()=1`).bind(user.email,`beneficio: ${b.name}`,String(id),JSON.stringify(after))
        ]);
        if(!result[0].results.length) {
          const existing=await env.DB.prepare('SELECT id FROM benefit_uses WHERE request_key=? AND member_id=?').bind(key,id).first();
          if(!existing)return P.simplePage({env,user,title:'Revisa el beneficio',status:409,html:`<p>El saldo o la membresía cambió. Recarga antes de registrar el uso.</p><p><a href="/socio/${id}?beneficio=1#beneficios">Volver a beneficios</a></p>`});
        }
        return redirect(`/socio/${id}?beneficio=1#beneficios`);
      }
      const qty = Number(fm.qty), on = dateOrNull(fm.used_on);
      if (!b || !(qty > 0) || !on) return redirect(`/socio/${id}`);
      const u = await env.DB.prepare('INSERT INTO benefit_uses (member_id, benefit_id, qty, used_on, note, created_by, handled_by) VALUES (?,?,?,?,?,?,?) RETURNING *')
        .bind(id, b.id, qty, on, str(fm.note, 300), user.email, str(fm.handled_by, 120) || user.email).first();
      await audit(env, user.email, `beneficio: ${b.name}`, 'member', id, null, u);
      return redirect(`/socio/${id}?beneficio=1#beneficios`);
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
      return P.simplePage({ env, user, title: 'Registrar entregas reales', status: 400,
        html: `<p>No se marcan entregas en bloque con fechas calculadas. Registra cada entrega con su fecha real o importa los registros del sistema anterior.</p><p><a href="${back}">Volver al socio</a> · <a href="/migracion">Migración</a></p>` });
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
      if (c && !s.suspended_on && !['canceled', 'incomplete_expired', 'manual_ended'].includes(s.status) && !(s.ended_on && s.ended_on <= ctx.today)) counts.set(c.id, (counts.get(c.id) || 0) + 1);
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
  if (m === 'GET' && p === '/actividad') {
    if (!user.isManager) return forbidden(env, user);
    return activityPage({ env, user, data: await activityData(env, url) });
  }
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
      if (e.status === 409) return P.simplePage({ env, user: null, title: 'El envío cambió', status: 409,
        html: `<p>${esc(e.message)}</p><p><a href="${esc(new URL(request.url).pathname.replace(/\/(estado|detalles|ref|botellas|posponer)$/, ''))}">Revisar envío</a></p>` });
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
