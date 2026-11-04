// Club de beneficios — the guest pages. No sign-in: the card link is the credential, so it is long and random, never
// indexed, never sent as a referrer, and the pages show only the person's own name, programs and benefits.
//   GET  /c/                     ¿Perdiste tu tarjeta?  (POST /c/perdi: neutral answer, logs a resend request for staff)
//   GET  /c/i/<token>            sign-up from an invite;  POST: create the card (or a neutral answer if the number exists)
//   GET  /c/<code>               the card (signed-in staff with a club grant get the staff view instead)
//   POST /c/<code>/voy           "Voy a ir"   ·  POST /c/<code>/voy/<id>/cancelar
//   POST /c/<code>/compra        "Sumar una compra": JSON with a receipt photo compressed in the browser
//   GET  /c/<code>/app.webmanifest, /c/sw.js, /c/terminos
import * as C from './club-core.js';
import { qrSvg } from './qr.js';
import { walletRoute, walletButtons } from './club-wallet.js';
import { catalog, personState, findPerson, newCardCode, addMembership, clubAudit, publicOrigin, cardUrl } from './club-data.js';

const H = (html, status = 200, extra = {}) => new Response(html, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow', 'referrer-policy': 'no-referrer', ...extra } });
const J = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const see = (loc) => new Response(null, { status: 303, headers: { location: loc, 'cache-control': 'no-store' } });
const e = C.esc;
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export const dayWords = d => new Date(d + 'T12:00:00Z').toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });

const CSS = `
:root { --wine: #5a1726; --wine-2: #6e1f31; --cream: #f6efe3; --paper: #fffaf1; --ink: #2a1a1d; --muted: #6b5a55; --line: #e3d6c3; --gold: #b08a4a; --gold-soft: #e9dcc2; --ok: #2f6634; --bad: #9e2318;
  --display: "Cormorant Garamond", "Iowan Old Style", Georgia, serif; --body: "EB Garamond", "Iowan Old Style", Georgia, serif; color-scheme: light; }
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
html, body { overflow-x: clip; }
body { margin: 0; background: var(--cream); color: var(--ink); font: 18px/1.45 var(--body); -webkit-font-smoothing: antialiased; }
main { max-width: 460px; margin: 0 auto; padding: max(16px, env(safe-area-inset-top)) 16px calc(40px + env(safe-area-inset-bottom)); }
a { color: var(--wine); }
h1, h2, h3 { font-family: var(--display); font-weight: 600; line-height: 1.1; margin: 0; }
.mark { font-family: var(--display); font-weight: 600; letter-spacing: .22em; text-transform: uppercase; font-size: 15px; }
.mark small { display: block; font-family: var(--body); font-style: italic; letter-spacing: .02em; text-transform: none; font-size: 15px; font-weight: 400; opacity: .85; margin-top: 2px; }
.card { position: relative; background: radial-gradient(120% 90% at 0% 0%, var(--wine-2), var(--wine) 60%); color: var(--cream); border-radius: 20px; padding: 22px 20px 20px; box-shadow: 0 18px 40px -22px rgba(60, 10, 20, .55), 0 2px 0 rgba(0,0,0,.04); }
.card::after { content: ""; position: absolute; inset: 7px; border: 1px solid rgba(233, 220, 194, .28); border-radius: 15px; pointer-events: none; }
.card .top { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
.card .owl { width: 34px; height: 34px; flex: none; opacity: .9; }
.card h1 { font-size: clamp(30px, 9vw, 38px); margin: 22px 0 10px; color: #fff; overflow-wrap: anywhere; }
.badges { display: flex; flex-wrap: wrap; gap: 6px; }
.badge { display: inline-flex; align-items: center; gap: 7px; padding: 4px 12px 4px 8px; border-radius: 999px; background: rgba(255, 250, 241, .12); border: 1px solid rgba(233, 220, 194, .45); color: var(--cream); font: 600 15px/1.3 var(--body); letter-spacing: .02em; }
.badge i { width: 10px; height: 10px; border-radius: 50%; background: var(--c, var(--gold)); box-shadow: 0 0 0 2px rgba(255,255,255,.75); }
.badge.pending { border-style: dashed; }
.qr { margin: 20px auto 4px; width: min(232px, 72vw); background: #fff; border-radius: 14px; padding: 8px; }
.qr svg { display: block; width: 100%; height: auto; }
.qr-cap { text-align: center; font-size: 15px; font-style: italic; color: var(--gold-soft); margin: 8px 0 0; }
.note { margin: 16px 0 0; padding: 12px 14px; border-radius: 12px; background: var(--paper); border: 1px solid var(--line); font-size: 17px; }
.note.ok { border-left: 4px solid var(--ok); } .note.warn { border-left: 4px solid var(--gold); } .note.bad { border-left: 4px solid var(--bad); }
.note b { font-weight: 600; }
section { margin: 26px 0 0; }
section > h2 { font-size: 26px; margin: 0 0 6px; color: var(--wine); }
.benefits { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--line); }
.benefits li { padding: 11px 2px; border-bottom: 1px solid var(--line); }
.benefits li span { display: block; font-size: 15.5px; color: var(--muted); }
.benefits li sup { color: var(--gold); font-size: 14px; }
.progress { margin: 4px 0 0; }
.bar { height: 8px; border-radius: 4px; background: var(--gold-soft); overflow: hidden; margin: 8px 0 6px; }
.bar i { display: block; height: 100%; background: linear-gradient(90deg, var(--gold), var(--wine)); border-radius: 4px; }
.small { font-size: 15.5px; color: var(--muted); }
details { margin: 12px 0 0; background: var(--paper); border: 1px solid var(--line); border-radius: 14px; }
details > summary { list-style: none; cursor: pointer; min-height: 52px; display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 0 16px; font: 600 21px var(--display); color: var(--wine); }
details > summary::-webkit-details-marker { display: none; }
details > summary::after { content: "+"; font: 400 26px var(--display); color: var(--gold); }
details[open] > summary::after { content: "–"; }
details > div { padding: 2px 16px 16px; }
label { display: block; margin: 12px 0 0; font-size: 16px; color: var(--muted); }
input, select, textarea { display: block; width: 100%; margin-top: 4px; min-height: 48px; padding: 10px 12px; font: 18px var(--body); color: var(--ink); background: #fff; border: 1px solid #c9b79c; border-radius: 10px; }
input:focus, select:focus, button:focus-visible, a:focus-visible, summary:focus-visible { outline: 2px solid var(--wine); outline-offset: 2px; }
.two { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.check { display: flex; gap: 10px; align-items: flex-start; margin: 16px 0 0; color: var(--ink); font-size: 16.5px; }
.check input { width: 24px; min-height: 24px; height: 24px; margin: 1px 0 0; flex: none; accent-color: var(--wine); }
.btn { display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; min-height: 52px; margin: 18px 0 0; padding: 0 18px; border: 0; border-radius: 12px; background: var(--wine); color: #fff; font: 600 20px var(--display); letter-spacing: .02em; text-decoration: none; cursor: pointer; }
.btn.ghost { background: transparent; color: var(--wine); border: 1px solid var(--wine); }
.btn.sm { min-height: 44px; font-size: 18px; margin-top: 10px; }
.stepper { display: grid; grid-template-columns: 52px 1fr 52px; align-items: center; margin-top: 4px; border: 1px solid #c9b79c; border-radius: 10px; background: #fff; overflow: hidden; }
.stepper button { min-height: 48px; border: 0; background: var(--gold-soft); color: var(--wine); font: 600 24px var(--display); cursor: pointer; }
.stepper output { text-align: center; font-size: 20px; }
.err { color: var(--bad); font-weight: 500; }
ol.how { margin: 6px 0 0; padding-left: 22px; } ol.how li { margin: 4px 0; }
footer { margin: 34px 0 0; text-align: center; font-size: 15px; color: var(--muted); }
footer .mark { color: var(--wine); font-size: 13px; }
.wallet-btns .btn { margin-top: 12px; }
.btn.wallet.apple { background: #000; }
.btn.wallet.google { background: #fff; color: #1f1f1f; border: 1px solid #c9c4bd; }
.hero { text-align: center; padding: 26px 4px 6px; }
.hero .mark { color: var(--wine); }
.hero h1 { font-size: clamp(32px, 10vw, 42px); margin: 18px 0 8px; color: var(--ink); }
.hero p { margin: 0; color: var(--muted); }
.panel { background: var(--paper); border: 1px solid var(--line); border-radius: 16px; padding: 4px 16px 18px; margin-top: 18px; }
.upcoming { display: flex; flex-direction: column; gap: 2px; }
.upcoming form { margin: 0; }
@media print { body { background: #fff; } details, footer, .noprint { display: none !important; } }
`;
const FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600&family=EB+Garamond:ital,wght@0,400;0,500;0,600;1,400&display=swap" rel="stylesheet">`;
// A small owl, drawn, so the card needs no image file.
const OWL = `<svg class="owl" viewBox="0 0 40 40" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M9 9l4 4M31 9l-4 4"/><path d="M8 18c0-6 5-10 12-10s12 4 12 10v6c0 7-5 12-12 12S8 31 8 24z"/><circle cx="15" cy="19" r="4"/><circle cx="25" cy="19" r="4"/><circle cx="15" cy="19" r="1" fill="currentColor"/><circle cx="25" cy="19" r="1" fill="currentColor"/><path d="M18.5 24.5L20 27l1.5-2.5"/></svg>`;

function page({ title, body, head = '', manifest = '' }) {
  return `<!doctype html><html lang="es-MX"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow"><meta name="referrer" content="no-referrer"><title>${e(title)}</title>
<meta name="theme-color" content="#5a1726"><link rel="icon" href="/icon-192.png"><link rel="apple-touch-icon" href="/icon-180.png">
<meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="Dos Búhos">${manifest}
${FONTS}<style>${CSS}</style>${head}</head><body><main>${body}</main></body></html>`;
}
const foot = `<footer><div class="mark">Dos Búhos</div>Bodega · Restaurante · San Miguel de Allende<br><a href="/c/terminos">Términos del club</a></footer>`;

export function isClubPublic(p) { return p === '/c' || p.startsWith('/c/'); }

// staffRole: the visitor's role on the club app (null for guests). Staff opening a card get the staff view.
export async function clubPublic(request, env, url, staffRole) {
  const p = url.pathname, m = request.method;
  if (p === '/c') return see('/c/');
  if (p === '/c/') return H(lostPage());
  if (p === '/c/perdi' && m === 'POST') return lostCard(request, env);
  if (p === '/c/terminos') return H(termsPage(), 200, { 'cache-control': 'public, max-age=3600' });
  if (p === '/c/sw.js') return new Response(SW, { headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-cache', 'service-worker-allowed': '/c/' } });
  let mm = p.match(/^\/c\/i\/([A-Za-z0-9_-]{8,64})\/?$/);
  if (mm) return m === 'POST' ? signup(request, env, url, mm[1]) : signupForm(env, url, mm[1]);
  mm = p.match(/^\/c\/([A-Za-z0-9_-]{20,64})(\/.*)?$/);
  if (!mm) return H(page({ title: 'Dos Búhos', body: `<div class="hero"><div class="mark">Dos Búhos</div><h1>No encontramos esta página</h1><p>Revisa el enlace o <a href="/c/">pide tu tarjeta de nuevo</a>.</p></div>` }), 404);
  const code = mm[1], rest = mm[2] || '';
  const person = await env.DB.prepare('SELECT * FROM club_people WHERE card_code = ?').bind(code).first();
  if (!person) return H(page({ title: 'Tarjeta no encontrada · Dos Búhos', body: `<div class="hero"><div class="mark">Dos Búhos</div><h1>No encontramos esta tarjeta</h1><p>Si la perdiste, te la mandamos de nuevo.</p></div><a class="btn" href="/c/">Recuperar mi tarjeta</a>${foot}` }), 404);
  if (rest === '/app.webmanifest') return manifestFor(person);
  if (rest === '/voy' && m === 'POST') return announce(request, env, person);
  const cm = rest.match(/^\/voy\/(\d+)\/cancelar$/);
  if (cm && m === 'POST') {
    await env.DB.prepare('UPDATE club_announcements SET cancelled_at = ? WHERE id = ? AND person_id = ? AND cancelled_at IS NULL').bind(Date.now(), Number(cm[1]), person.id).run();
    return see(`/c/${code}?ok=cancelada`);
  }
  if (rest === '/compra' && m === 'POST') return receipt(request, env, person);
  const wm = rest.match(/^\/wallet\/(apple|google)$/);
  if (wm && m === 'GET') return wallet(request, env, url, person, wm[1]);
  if (rest && rest !== '/') return see(`/c/${code}`);
  if (staffRole && !url.searchParams.has('invitado')) return see(`/club/#c/${code}`);
  return cardPage(env, url, person, request.headers.get('user-agent') || '');
}

// ---------- wallet cards ----------
async function wallet(request, env, url, person, which) {
  const origin = publicOrigin(env, url);
  const st = await personState(env, person, await catalog(env));
  const assetBytes = async path => new Uint8Array(await (await env.ASSETS.fetch(new Request(origin + path))).arrayBuffer());
  const res = await walletRoute(env, which, person, st, cardUrl(origin, person.card_code), origin, assetBytes).catch(err => { console.log('club wallet error', which, String(err && err.stack || err)); return 'error'; });
  if (res && res !== 'error') return res;
  return see(`/c/${person.card_code}?ok=${res === 'error' ? 'wallet_error' : 'wallet_off'}`);
}

// ---------- the card ----------
async function cardPage(env, url, person, ua = '') {
  const cat = await catalog(env);
  const st = await personState(env, person, cat);
  const day = C.today();
  const link = cardUrl(publicOrigin(env, url), person.card_code);
  const [ann, pend] = await Promise.all([
    env.DB.prepare('SELECT id, day, time, party_size, reservation_name FROM club_announcements WHERE person_id = ? AND day >= ? AND cancelled_at IS NULL ORDER BY day, time LIMIT 3').bind(person.id, day).all(),
    env.DB.prepare("SELECT day, amount, channel, status FROM club_purchases WHERE person_id = ? AND (status = 'pending' OR (status <> 'pending' AND decided_at > ?)) ORDER BY created_at DESC LIMIT 5").bind(person.id, Date.now() - 14 * C.DAY_MS).all(),
  ]);
  const ok = url.searchParams.get('ok');
  const flash = ok === 'nuevo' ? `<div class="note ok"><b>Listo, ${e(C.firstName(person.name))}.</b> Esta es tu tarjeta. Guárdala en la pantalla de inicio para tenerla a la mano.</div>`
    : ok === 'voy' ? `<div class="note ok"><b>Gracias por avisar.</b> El equipo ya sabe que vienes.</div>`
    : ok === 'cancelada' ? `<div class="note ok">Cancelamos tu aviso.</div>`
    : ok === 'compra' ? `<div class="note ok"><b>Recibimos tu compra.</b> El equipo la revisa y la suma a tu cuenta.</div>`
    : ok === 'wallet_error' ? `<div class="note bad">No pudimos preparar la tarjeta para tu cartera. Intenta más tarde; esta tarjeta funciona igual.</div>`
    : ok === 'wallet_off' ? `<div class="note warn">Esta opción todavía no está disponible. Usa esta tarjeta o agrégala a tu pantalla de inicio.</div>` : '';
  const blocked = person.status !== 'active';
  const pendingOnly = !st.programs.length && st.pending.length;
  const badges = [...st.programs.map(p => `<span class="badge" style="--c:${e(p.color)}"><i></i>${e(p.name)}</span>`),
    ...st.pending.map(m => `<span class="badge pending"><i></i>${e(m.program)} · en revisión</span>`)].join('');
  const unconfirmed = st.resolved.some(r => !r.confirmed);
  const items = st.resolved.map(r => { const d = C.guestDetail(r); return `<li>${e(C.guestPhrase(r))}${r.confirmed ? '' : '<sup>*</sup>'}${d ? `<span>${e(d)}</span>` : ''}</li>`; }).join('');
  let levelHtml = '';
  if (st.level && !blocked) {
    const lv = st.level, nx = st.next;
    const base = Math.max(st.spend, st.commitment || 0);
    const pct = nx ? Math.min(100, Math.round(100 * (base - (lv.threshold_mxn || 0)) / Math.max(1, (nx.program.threshold_mxn || 0) - (lv.threshold_mxn || 0)))) : 100;
    levelHtml = `<section class="progress"><h2>${e(lv.name)}${st.bySubscription ? ' · por tu suscripción' : ''}</h2><div class="small">${st.bySubscription ? `Tu suscripción al Círculo suma ${C.money(st.commitment)} al año. ` : ''}${C.money(st.spend)} en compras en los últimos 12 meses${st.estimated ? ' (incluye suscripción estimada)' : ''}.</div>
      <div class="bar" aria-hidden="true"><i style="width:${Math.max(3, pct)}%"></i></div>
      <div>${nx ? `Te faltan <b>${C.money(nx.missing)}</b> para ${e(nx.program.name)}.` : 'Estás en el nivel más alto.'}</div></section>`;
  }
  const annHtml = ann.results.length ? `<section><h2>Te esperamos</h2>${ann.results.map(a => `<div class="note upcoming"><b>${e(cap(dayWords(a.day)))}${a.time ? ' · ' + e(a.time) : ''}</b>
      <span class="small">${a.party_size} ${a.party_size === 1 ? 'persona' : 'personas'}${a.reservation_name ? ' · reservación a nombre de ' + e(a.reservation_name) : ''}</span>
      <form method="post" action="/c/${e(person.card_code)}/voy/${a.id}/cancelar"><button class="btn ghost sm" type="submit">Cancelar aviso</button></form></div>`).join('')}</section>` : '';
  const pendHtml = pend.results.length ? `<section><h2>Tus compras</h2><ul class="benefits">${pend.results.map(x => `<li>${C.money(x.amount)} · ${e(C.CHANNELS[x.channel] || x.channel)}<span>${e(fmtShort(x.day))} · ${x.status === 'pending' ? 'en revisión' : x.status === 'approved' ? 'sumada a tu cuenta' : 'no la pudimos sumar; pregunta al equipo'}</span></li>`).join('')}</ul></section>` : '';
  const body = `${flash}
<div class="card"><div class="top"><div class="mark">Dos Búhos<small>Club de beneficios</small></div>${OWL}</div>
  <h1>${e(person.name)}</h1><div class="badges">${badges || '<span class="badge"><i></i>Socio</span>'}</div>
  <div class="qr">${qrSvg(link, { label: 'Código de tu tarjeta' })}</div><p class="qr-cap">Muéstralo al llegar</p></div>
${blocked ? '' : walletButtons(env, person.card_code, ua)}
${blocked ? '<div class="note bad">Esta tarjeta no está activa. Si crees que es un error, escríbenos.</div>'
  : pendingOnly ? '<div class="note warn"><b>Tu solicitud está en revisión.</b> Te avisamos por WhatsApp en cuanto quede lista; tus beneficios aparecen aquí.</div>' : ''}
${items ? `<section><h2>Tus beneficios</h2><ul class="benefits">${items}</ul>${unconfirmed ? '<p class="small"><sup>*</sup> Por confirmar: el equipo te confirma al aplicarlo.</p>' : ''}</section>` : ''}
${levelHtml}${annHtml}${pendHtml}
${blocked ? '' : `<details><summary>Voy a ir</summary><div>
  <form method="post" action="/c/${e(person.card_code)}/voy">
    <div class="two"><label>Día<input type="date" name="day" required min="${day}" max="${C.addDays(day, 90)}" value="${day}"></label>
    <label>Hora (opcional)<input type="time" name="time" step="900"></label></div>
    <label>¿Cuántas personas?</label>${stepper('party', 2, 1, 20)}
    <label>Reservación de OpenTable a nombre de<input name="reservation_name" maxlength="80" value="${e(person.name)}" autocomplete="name"></label>
    <button class="btn" type="submit">Avisar al equipo</button></form></div></details>
<details><summary>Sumar una compra</summary><div>
  <p class="small" style="margin:6px 0 0">¿Compraste vino en tienda, en línea o en un restaurante de San Miguel? Sube tu ticket y lo sumamos a tu nivel.</p>
  <form id="buy"><label>Monto (MXN)<input name="amount" inputmode="decimal" required placeholder="1,250"></label>
    <div class="two"><label>Fecha<input type="date" name="day" required max="${day}" min="${C.addDays(day, -90)}" value="${day}"></label>
    <label>Dónde<select name="channel"><option value="tienda">Tienda</option><option value="en_linea">En línea</option><option value="restaurante">Restaurante</option><option value="experiencias">Experiencias</option><option value="punto_externo">Otro lugar</option></select></label></div>
    <label>Foto del ticket<input type="file" name="photo" accept="image/*" capture="environment" required></label>
    <p class="err" id="buyerr" role="alert"></p>
    <button class="btn" type="submit">Enviar compra</button></form></div></details>`}
<details${ok === 'nuevo' ? ' open' : ''}><summary>Agregar a pantalla de inicio</summary><div>
  <p style="margin:6px 0 0"><b>iPhone</b> (Safari)</p><ol class="how"><li>Toca el botón Compartir <span aria-hidden="true">⬆︎</span>.</li><li>Elige <b>Agregar a inicio</b>.</li></ol>
  <p style="margin:10px 0 0"><b>Android</b> (Chrome)</p><ol class="how"><li>Toca el menú <span aria-hidden="true">⋮</span>.</li><li>Elige <b>Agregar a la pantalla principal</b>.</li></ol>
  <p class="small">Este enlace es tu tarjeta: no lo compartas. Si lo pierdes, te lo mandamos de nuevo por WhatsApp.</p></div></details>
${foot}
<script>
${STEPPER_JS}
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/c/sw.js', { scope: '/c/' }).catch(() => {});
const f = document.getElementById('buy');
if (f) f.addEventListener('submit', async ev => {
  ev.preventDefault();
  const err = document.getElementById('buyerr'), btn = f.querySelector('button'); err.textContent = '';
  const amount = Number(String(f.amount.value).replace(/[^0-9.]/g, ''));
  if (!(amount > 0)) { err.textContent = 'Escribe el monto de la compra.'; return; }
  const file = f.photo.files[0]; if (!file) { err.textContent = 'Agrega la foto del ticket.'; return; }
  btn.disabled = true; btn.textContent = 'Enviando…';
  try {
    const photo = await shrink(file);
    const r = await fetch(location.pathname.replace(/\\/$/, '') + '/compra', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ amount, day: f.day.value, channel: f.channel.value, photo }) });
    const b = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(b.message || 'No se pudo enviar.');
    location.href = location.pathname + '?ok=compra';
  } catch (x) { err.textContent = x.message || 'No se pudo enviar. Intenta de nuevo.'; btn.disabled = false; btn.textContent = 'Enviar compra'; }
});
// Receipt photo → JPEG ≤ ~200 KB: longest side 1400 px, then lower quality/size until it fits.
async function shrink(file) {
  const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error('No pudimos leer la foto.')); i.src = URL.createObjectURL(file); });
  let side = 1400, q = .72, out = '';
  for (let n = 0; n < 8; n++) {
    const k = Math.min(1, side / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    out = c.toDataURL('image/jpeg', q);
    if (out.length * .75 <= 200 * 1024) break;
    if (q > .5) q -= .1; else side = Math.round(side * .8);
  }
  return out;
}
</script>`;
  const html = page({ title: `${person.name} · Club Dos Búhos`, body, manifest: `<link rel="manifest" href="/c/${e(person.card_code)}/app.webmanifest">` });
  // Cacheable for the guest's own browser (and the service worker keeps it offline); never by a shared cache.
  return H(html, 200, { 'cache-control': ok ? 'no-store' : 'private, max-age=60, stale-while-revalidate=604800', vary: 'Cookie, User-Agent' });
}
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const fmtShort = d => { const [y, mo, da] = d.split('-').map(Number); return `${da} de ${MONTHS[mo - 1]}${y !== new Date().getFullYear() ? ' de ' + y : ''}`; };

function stepper(name, value, min, max) {
  return `<div class="stepper" data-min="${min}" data-max="${max}"><button type="button" data-d="-1" aria-label="Menos">−</button><output aria-live="polite">${value}</output><button type="button" data-d="1" aria-label="Más">+</button><input type="hidden" name="${name}" value="${value}"></div>`;
}
const STEPPER_JS = `document.querySelectorAll('.stepper').forEach(s => s.addEventListener('click', ev => { const b = ev.target.closest('button'); if (!b) return; const i = s.querySelector('input'), o = s.querySelector('output'); const v = Math.min(+s.dataset.max, Math.max(+s.dataset.min, +i.value + +b.dataset.d)); i.value = v; o.textContent = v; }));`;

function manifestFor(person) {
  const m = { name: 'Mi tarjeta · Dos Búhos', short_name: 'Dos Búhos', start_url: `/c/${person.card_code}`, scope: `/c/${person.card_code}`, display: 'standalone', background_color: '#f6efe3', theme_color: '#5a1726',
    icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: '/icon-512.png', sizes: '512x512', type: 'image/png' }, { src: '/icon-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }] };
  return new Response(JSON.stringify(m), { headers: { 'content-type': 'application/manifest+json', 'cache-control': 'private, max-age=86400' } });
}
// Network first, the last good copy when offline: the card opens at the door even without signal.
const SW = `self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin || !/^\\/c\\/[A-Za-z0-9_-]{20,64}$/.test(u.pathname)) return;
  e.respondWith(fetch(r).then(res => { if (res.ok) { const c = res.clone(); caches.open('tarjeta').then(k => k.put(u.pathname, c)); } return res; })
    .catch(() => caches.match(u.pathname).then(m => m || Response.error())));
});`;

async function form(request) {
  const ct = request.headers.get('content-type') || '';
  if (ct.includes('application/json')) { try { return await request.json(); } catch { return {}; } }
  try { return Object.fromEntries(await request.formData()); } catch { return {}; }
}

async function announce(request, env, person) {
  if (person.status !== 'active') return see(`/c/${person.card_code}`);
  const b = await form(request), day = C.today();
  const d = C.DAY_RE.test(b.day) && b.day >= day && b.day <= C.addDays(day, 90) ? b.day : day;
  const time = /^\d{2}:\d{2}$/.test(b.time || '') ? b.time : '';
  const party = Math.min(20, Math.max(1, parseInt(b.party, 10) || 1));
  const rname = String(b.reservation_name || '').trim().slice(0, 80);
  // One aviso per person per day: a new one replaces the old.
  await env.DB.prepare('UPDATE club_announcements SET cancelled_at = ? WHERE person_id = ? AND day = ? AND cancelled_at IS NULL').bind(Date.now(), person.id, d).run();
  await env.DB.prepare("INSERT INTO club_announcements (person_id, day, time, party_size, reservation_name, source, created_by, created_at) VALUES (?, ?, ?, ?, ?, 'guest', 'invitado', ?)")
    .bind(person.id, d, time, party, rname, Date.now()).run();
  return see(`/c/${person.card_code}?ok=voy`);
}

async function receipt(request, env, person) {
  if (person.status !== 'active') return J({ message: 'Esta tarjeta no está activa.' }, 403);
  const len = Number(request.headers.get('content-length') || 0);
  if (len > 700_000) return J({ message: 'La foto es muy pesada. Intenta con otra.' }, 413);
  const b = await form(request), day = C.today();
  const amount = Math.round(Number(b.amount) * 100) / 100;
  if (!(amount > 0) || amount > 500000) return J({ message: 'Escribe el monto de la compra.' }, 400);
  if (!C.DAY_RE.test(b.day || '') || b.day > day || b.day < C.addDays(day, -90)) return J({ message: 'La fecha debe ser de los últimos 90 días.' }, 400);
  const channel = ['tienda', 'en_linea', 'restaurante', 'experiencias', 'punto_externo'].includes(b.channel) ? b.channel : 'tienda';
  const photo = String(b.photo || '');
  const mm = photo.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!mm) return J({ message: 'Agrega la foto del ticket.' }, 400);
  if (mm[2].length > 400_000) return J({ message: 'La foto es muy pesada. Intenta con otra.' }, 413);
  const open = await env.DB.prepare("SELECT COUNT(*) AS n FROM club_purchases WHERE person_id = ? AND status = 'pending'").bind(person.id).first();
  if ((open?.n || 0) >= 5) return J({ message: 'Ya tienes 5 compras en revisión. Espera a que el equipo las revise.' }, 429);
  const now = Date.now();
  const r = await env.DB.prepare("INSERT INTO club_purchases (person_id, day, amount, channel, status, source, has_photo, created_by, created_at) VALUES (?, ?, ?, ?, 'pending', 'guest', 1, 'invitado', ?)")
    .bind(person.id, b.day, amount, channel, now).run();
  await env.DB.prepare('INSERT INTO club_photos (purchase_id, content_type, data, bytes, created_at) VALUES (?, ?, ?, ?, ?)').bind(r.meta.last_row_id, mm[1], mm[2], Math.round(mm[2].length * .75), now).run();
  return J({ ok: true });
}

// ---------- sign-up ----------
async function loadInvite(env, tok) {
  return env.DB.prepare('SELECT i.*, p.name AS program, p.kind AS program_kind, p.is_pro, p.archived AS program_archived FROM club_invites i JOIN club_programs p ON p.id = i.program_id WHERE i.token = ?').bind(tok).first();
}
async function signupForm(env, url, tok, vals = null, error = '') {
  const inv = await loadInvite(env, tok);
  const problem = C.inviteProblem(inv);
  if (problem) return H(page({ title: 'Invitación · Dos Búhos', body: `<div class="hero"><div class="mark">Dos Búhos</div><h1>Lo sentimos</h1><p>${e(problem)}</p></div><a class="btn ghost" href="/c/">¿Ya tenías tarjeta? Recupérala</a>${foot}` }), inv ? 410 : 404);
  const v = vals || { name: inv.name, phone: inv.phone ? C.fmtPhone(inv.phone) : '', email: inv.email };
  const days = Array.from({ length: 31 }, (_, i) => i + 1).map(d => `<option${String(v.bday || '') === String(d) ? ' selected' : ''}>${d}</option>`).join('');
  const months = MONTHS.map((mo, i) => `<option value="${i + 1}"${String(v.bmonth || '') === String(i + 1) ? ' selected' : ''}>${mo}</option>`).join('');
  const pro = inv.is_pro ? `<label>¿A qué te dedicas?<select name="pro_type" required><option value="">Elige una opción</option>${Object.entries(C.PRO_TYPES).map(([k, t]) => `<option value="${k}"${v.pro_type === k ? ' selected' : ''}>${t}</option>`).join('')}</select></label>` : '';
  const body = `<div class="hero"><div class="mark">Dos Búhos<small>Club de beneficios</small></div>
  <h1>${inv.name ? `Hola, ${e(C.firstName(inv.name))}` : 'Te damos la bienvenida'}</h1>
  <p>Te invitamos al club como parte de <b>${e(inv.program)}</b>. Toma un minuto y tu tarjeta queda en tu teléfono.</p></div>
<form class="panel" method="post" action="/c/i/${e(tok)}">
  ${error ? `<p class="err" role="alert">${e(error)}</p>` : ''}
  <label>Nombre y apellido<input name="name" required maxlength="80" autocomplete="name" value="${e(v.name || '')}"></label>
  <label>WhatsApp<input name="phone" type="tel" required inputmode="tel" autocomplete="tel" placeholder="415 123 4567" value="${e(v.phone || '')}"></label>
  <label>Correo (opcional)<input name="email" type="email" autocomplete="email" maxlength="120" value="${e(v.email || '')}"></label>
  <label>Cumpleaños (opcional)</label><div class="two"><select name="bday" aria-label="Día"><option value="">Día</option>${days}</select><select name="bmonth" aria-label="Mes"><option value="">Mes</option>${months}</select></div>
  ${pro}
  <label class="check"><input type="checkbox" name="terms" value="1" required${v.terms ? ' checked' : ''}><span>Acepto los <a href="/c/terminos" target="_blank" rel="noopener">términos del club</a> y que Dos Búhos me escriba por WhatsApp sobre mi tarjeta.</span></label>
  <button class="btn" type="submit">Crear mi tarjeta</button>
  ${inv.requires_approval ? '<p class="small" style="margin:12px 0 0">El equipo revisa esta solicitud antes de activar los beneficios. Tu tarjeta queda lista de inmediato.</p>' : ''}
</form>
<p class="small" style="text-align:center;margin-top:16px">¿Ya tenías tarjeta? <a href="/c/">Recupérala aquí</a>.</p>${foot}`;
  return H(page({ title: 'Únete al club · Dos Búhos', body }), error ? 400 : 200);
}

async function signup(request, env, url, tok) {
  const b = await form(request);
  const inv = await loadInvite(env, tok);
  if (C.inviteProblem(inv)) return signupForm(env, url, tok);
  const vals = { name: String(b.name || '').trim().slice(0, 80), phone: String(b.phone || ''), email: String(b.email || ''), bday: b.bday, bmonth: b.bmonth, pro_type: b.pro_type, terms: b.terms };
  const phone = C.normPhone(b.phone), email = C.normEmail(b.email);
  if (vals.name.length < 2) return signupForm(env, url, tok, vals, 'Escribe tu nombre.');
  if (!C.validPhone(phone)) return signupForm(env, url, tok, vals, 'Revisa tu número de WhatsApp: 10 dígitos, o con lada de país.');
  if (b.email && !email) return signupForm(env, url, tok, vals, 'Revisa tu correo, o déjalo vacío.');
  if (!b.terms) return signupForm(env, url, tok, vals, 'Para crear tu tarjeta acepta los términos del club.');
  if (inv.is_pro && !C.PRO_TYPES[b.pro_type]) return signupForm(env, url, tok, vals, 'Elige a qué te dedicas.');
  const bd = parseInt(b.bday, 10), bm = parseInt(b.bmonth, 10);
  const birthday = bd >= 1 && bd <= 31 && bm >= 1 && bm <= 12 ? `${String(bm).padStart(2, '0')}-${String(bd).padStart(2, '0')}` : '';
  // Count the use first, guarded, so a link with max uses cannot be over-used by two people at once.
  const now = Date.now();
  const used = await env.DB.prepare('UPDATE club_invites SET uses = uses + 1 WHERE id = ? AND revoked_at IS NULL AND (max_uses IS NULL OR uses < max_uses) AND (expires_at IS NULL OR expires_at > ?)').bind(inv.id, now).run();
  if (!used.meta?.changes) return signupForm(env, url, tok);
  const status = inv.requires_approval ? 'pending' : 'active';
  const existing = await findPerson(env, phone, phone ? '' : email);
  if (existing) {
    // Never show someone else's card: the program goes to the person who owns the number, and staff resend their card.
    await addMembership(env, existing.id, inv.program_id, { status, source: 'invite', inviteId: inv.id, by: 'invitado' });
    await env.DB.prepare("INSERT INTO club_card_requests (phone, person_id, reason, created_at) VALUES (?, ?, 'ya_registrado', ?)").bind(phone, existing.id, now).run();
    await clubAudit(env, 'invitado', 'signup.existing', 'person', existing.id, { invite: inv.id, program: inv.program_id, status });
    return H(page({ title: 'Ya tienes tarjeta · Dos Búhos', body: `<div class="hero"><div class="mark">Dos Búhos</div><h1>Ya tienes tarjeta</h1><p>Este número ya está en el club. Te mandamos tu tarjeta por WhatsApp en cuanto el equipo lo vea.</p></div>${foot}` }));
  }
  const code = await newCardCode(env);
  const r = await env.DB.prepare(`INSERT INTO club_people (card_code, name, phone, email, birthday, pro_type, source, terms_at, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'invite', ?, 'invitado', ?, ?)`).bind(code, vals.name, phone, email, birthday, inv.is_pro ? b.pro_type : '', now, now, now).run();
  const pid = r.meta.last_row_id;
  await addMembership(env, pid, inv.program_id, { status, source: 'invite', inviteId: inv.id, by: 'invitado' });
  await clubAudit(env, 'invitado', 'signup', 'person', pid, { invite: inv.id, program: inv.program_id, status });
  return see(`/c/${code}?ok=nuevo`);
}

// ---------- lost card ----------
function lostPage(sent = false, error = '') {
  const body = `<div class="hero"><div class="mark">Dos Búhos<small>Club de beneficios</small></div><h1>¿Perdiste tu tarjeta?</h1>
  <p>${sent ? '' : 'Escribe tu WhatsApp y te la mandamos de nuevo.'}</p></div>
  ${sent ? `<div class="note ok"><b>Gracias.</b> Si este número está en el club, te mandamos tu tarjeta por WhatsApp en horario de servicio.</div><a class="btn ghost" href="/c/">Volver</a>`
    : `<form class="panel" method="post" action="/c/perdi">${error ? `<p class="err" role="alert">${e(error)}</p>` : ''}
    <label>WhatsApp<input name="phone" type="tel" required inputmode="tel" autocomplete="tel" placeholder="415 123 4567"></label>
    <button class="btn" type="submit">Mandar mi tarjeta</button></form>`}${foot}`;
  return page({ title: '¿Perdiste tu tarjeta? · Dos Búhos', body });
}
async function lostCard(request, env) {
  const b = await form(request);
  const phone = C.normPhone(b.phone);
  if (!C.validPhone(phone)) return H(lostPage(false, 'Revisa el número: 10 dígitos, o con lada de país.'), 400);
  const p = await env.DB.prepare("SELECT id FROM club_people WHERE phone = ? AND status = 'active' ORDER BY id LIMIT 1").bind(phone).first();
  // Same answer either way. Only real members create a request, at most one open request per number.
  if (p) {
    const open = await env.DB.prepare('SELECT 1 FROM club_card_requests WHERE phone = ? AND handled_at IS NULL').bind(phone).first();
    if (!open) await env.DB.prepare("INSERT INTO club_card_requests (phone, person_id, reason, created_at) VALUES (?, ?, 'perdida', ?)").bind(phone, p.id, Date.now()).run();
  }
  return H(lostPage(true));
}

function termsPage() {
  return page({ title: 'Términos del club · Dos Búhos', body: `<div class="hero"><div class="mark">Dos Búhos</div><h1>Términos del club</h1></div>
<div class="panel"><ul class="benefits" style="border:0">
<li>La tarjeta es personal. Los beneficios aplican con el socio presente.</li>
<li>Los descuentos no se combinan entre sí ni con otras promociones; aplica el mejor beneficio que tengas.</li>
<li>En el restaurante el descuento es sobre una cuenta por visita, para ti y los acompañantes que indique tu tarjeta.</li>
<li>Los niveles por compras se calculan con lo comprado en los últimos 12 meses. Las compras con ticket se suman cuando el equipo las revisa.</li>
<li>Usamos tu nombre, WhatsApp y correo solo para tu tarjeta y para avisarte de tu club. Puedes pedir que te demos de baja cuando quieras.</li>
<li>Dos Búhos puede cambiar los beneficios del club; lo verás reflejado en tu tarjeta.</li>
</ul></div>${foot}` });
}
