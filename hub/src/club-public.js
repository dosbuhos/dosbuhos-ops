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
import { catalog, personState, findPerson, newCardCode, addMembership, clubAudit, publicOrigin, cardUrl, fieldValues, saveFieldValues, readFields } from './club-data.js';

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
.otw { margin: 10px -8px; min-height: 40px; overflow: hidden; } .otw iframe { display: block; margin: 0 auto; transform-origin: top left; }
footer { margin: 34px 0 0; text-align: center; font-size: 15px; color: var(--muted); }
footer .mark { color: var(--wine); font-size: 13px; }
.valid { margin: 12px 0 0; font-size: 16px; font-style: italic; color: var(--gold-soft); }
.note .btn.sm { margin-top: 10px; }
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

/* The member card: a wallet-sized card with a metal finish by tier (Oro, Plata, Bronce, Diamante; gold otherwise),
   the Dos Búhos wordmark in foil, name, club and date joined, a small QR in the corner. Tap to flip: a large QR. */
.mc { --m1: #f3dea0; --m2: #b8893c; --m3: #fff0c2; --m4: #8a6424; perspective: 1400px; margin: 4px 0 0; cursor: pointer; -webkit-tap-highlight-color: transparent; outline: none; }
.mc.m-plata { --m1: #f2f2f0; --m2: #9ea3a6; --m3: #ffffff; --m4: #6e7376; }
.mc.m-bronce { --m1: #f0c39a; --m2: #a86a3c; --m3: #ffdcbc; --m4: #6f3f1c; }
.mc.m-diamante { --m1: #eef3f6; --m2: #9fb3c2; --m3: #ffffff; --m4: #5e7182; }
.mc-in { position: relative; width: 100%; aspect-ratio: 1.586; transition: transform .7s cubic-bezier(.2, .7, .2, 1); transform-style: preserve-3d; }
.mc.flip .mc-in { transform: rotateY(180deg); }
@media (prefers-reduced-motion: reduce) { .mc-in { transition: none; } }
.mc-face { position: absolute; inset: 0; border-radius: 18px; overflow: hidden; backface-visibility: hidden; -webkit-backface-visibility: hidden; color: #f4ead6;
  background: radial-gradient(140% 120% at 0% 0%, #4a1322 0%, #2a0b14 45%, #12070a 100%);
  box-shadow: 0 30px 50px -26px rgba(30, 5, 12, .75), 0 10px 18px -12px rgba(0, 0, 0, .5), inset 0 1px 0 rgba(255, 255, 255, .08); }
.mc-face::before { content: ""; position: absolute; inset: 0; pointer-events: none; opacity: .5;
  background: repeating-radial-gradient(circle at 115% 120%, rgba(255, 225, 160, .06) 0 1px, transparent 1px 7px),
    linear-gradient(115deg, transparent 30%, rgba(255, 240, 200, .10) 45%, transparent 60%); }
.mc-face::after { content: ""; position: absolute; inset: 9px; border-radius: 12px; pointer-events: none; border: 1px solid transparent;
  background: linear-gradient(135deg, var(--m1), var(--m2) 40%, var(--m3) 60%, var(--m4)) border-box; opacity: .55;
  -webkit-mask: linear-gradient(#000 0 0) padding-box, linear-gradient(#000 0 0); -webkit-mask-composite: xor; mask: linear-gradient(#000 0 0) padding-box exclude, linear-gradient(#000 0 0); }
.mc-back { transform: rotateY(180deg); }
.foil { background: linear-gradient(135deg, var(--m1) 0%, var(--m2) 38%, var(--m3) 55%, var(--m2) 72%, var(--m4) 100%); }
.foil-t { background: linear-gradient(135deg, var(--m1) 0%, var(--m2) 38%, var(--m3) 55%, var(--m2) 72%, var(--m4) 100%); -webkit-background-clip: text; background-clip: text; color: transparent; }
.mc-front { display: flex; flex-direction: column; justify-content: space-between; padding: 7% 7.5% 6.5%; }
.mc-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; position: relative; z-index: 1; }
.mc-logo { display: block; width: 44%; aspect-ratio: 730 / 160; -webkit-mask: url(/logo-word.png) left center / contain no-repeat; mask: url(/logo-word.png) left center / contain no-repeat; }
.mc-club { text-align: right; font: 600 clamp(9px, 2.6vw, 11px)/1.25 var(--body); letter-spacing: .26em; text-transform: uppercase; }
.mc-club b { display: block; font: 600 clamp(15px, 4.6vw, 19px)/1.1 var(--display); letter-spacing: .06em; text-transform: none; margin-top: 3px; }
.mc-bot { display: flex; justify-content: space-between; align-items: flex-end; gap: 12px; position: relative; z-index: 1; }
.mc-lbl { font: 500 clamp(8.5px, 2.4vw, 10px)/1 var(--body); letter-spacing: .3em; text-transform: uppercase; opacity: .7; }
.mc-name { font: 600 clamp(20px, 6.4vw, 27px)/1.05 var(--display); letter-spacing: .04em; margin: 5px 0 6px; overflow-wrap: anywhere; color: #fff8ea; }
.mc-meta { font: 400 clamp(11px, 3.2vw, 13px)/1.3 var(--body); letter-spacing: .08em; opacity: .85; }
.mc-meta span { opacity: .55; padding: 0 5px; }
.mc-qs { flex: none; width: 23%; aspect-ratio: 1; background: #fffaf0; border-radius: 8px; padding: 4px; box-shadow: 0 0 0 1px rgba(255, 230, 170, .5); }
.mc-qs svg, .mc-qb svg { display: block; width: 100%; height: 100%; }
.mc-back { display: flex; align-items: center; gap: 6%; padding: 7% 7.5%; }
.mc-qb { flex: none; height: 86%; aspect-ratio: 1; background: #fffaf0; border-radius: 12px; padding: 6px; position: relative; z-index: 1; }
.mc-btx { position: relative; z-index: 1; min-width: 0; }
.mc-btx .mc-logo { width: 100%; max-width: 150px; margin-bottom: 12px; }
.mc-btx b { display: block; font: 600 clamp(16px, 4.8vw, 20px)/1.15 var(--display); color: #fff8ea; }
.mc-btx p { margin: 6px 0 0; font-size: clamp(11.5px, 3.3vw, 13.5px); line-height: 1.35; opacity: .8; }
.mc-hint { text-align: center; font-size: 14.5px; font-style: italic; color: var(--muted); margin: 10px 0 0; }
.mc-more { display: flex; flex-wrap: wrap; justify-content: center; gap: 6px; margin: 10px 0 0; }
.mc-more .badge { background: var(--paper); color: var(--ink); border-color: var(--line); }
.mc.off .mc-face { filter: grayscale(1) brightness(.7); }
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
// OpenTable (restaurant 1258120). restref + ot_source keep club bookings in "Your Network" (no per-cover fee).
const OT_TABLE_URL = 'https://www.opentable.com.mx/r/bodega-dos-buhos-reservations-san-miguel-de-allende-1?restref=1258120&amp;lang=es-MX&amp;ot_source=Restaurant%20website';
const OT_WIDGET_SRC = 'https://www.opentable.com.mx/widget/reservation/loader?rid=1258120&type=standard&theme=tall&color=1&dark=false&iframe=true&domain=commx&lang=es-MX&newtab=false&ot_source=Restaurant%20website';
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
  if (rest === '/datos' && m === 'POST') return guestData(request, env, person);
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
    : ok === 'datos' ? `<div class="note ok">Guardamos tus datos.</div>`
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
${memberCard(person, st, link, blocked)}
${blocked ? '' : walletButtons(env, person.card_code, ua)}
${blocked ? '<div class="note bad">Esta tarjeta no está activa. Si crees que es un error, escríbenos.</div>'
  : pendingOnly ? '<div class="note warn"><b>Tu solicitud está en revisión.</b> Te avisamos por WhatsApp en cuanto quede lista; tus beneficios aparecen aquí.</div>' : ''}
${blocked ? '' : st.expired.map(x => `<div class="note warn"><b>Tu membresía ${e(x.program)} venció el ${e(fmtLong(x.expires_on))}.</b> Sus beneficios ya no aparecen aquí. ${x.pay_url ? `Renuévala en línea y el equipo la reactiva.<a class="btn sm" href="${e(x.pay_url)}" target="_blank" rel="noopener">Renovar ${x.fee_mxn ? '· ' + C.money(x.fee_mxn) : ''}</a>` : 'Escríbenos para renovarla.'}</div>`).join('')}
${items ? `<section><h2>Tus beneficios</h2><ul class="benefits">${items}</ul>${unconfirmed ? '<p class="small"><sup>*</sup> Por confirmar: el equipo te confirma al aplicarlo.</p>' : ''}</section>` : ''}
${levelHtml}${annHtml}${pendHtml}
${blocked ? '' : `<details id="reservar"><summary>Reservar mesa</summary><div>
  <p class="small" style="margin:6px 0 0">Reserva aquí con OpenTable. Al llegar, muestra tu tarjeta para tu descuento.</p>
  <div id="otw" class="otw"></div>
  <a class="btn ghost sm" href="${OT_TABLE_URL}" target="_blank" rel="noopener">Abrir en OpenTable</a></div></details>
<details><summary>Sumar una compra</summary><div>
  <p class="small" style="margin:6px 0 0">¿Compraste vino en tienda, en línea o en un restaurante de San Miguel? Sube tu ticket y lo sumamos a tu nivel.</p>
  <form id="buy"><label>Monto (MXN)<input name="amount" inputmode="decimal" required placeholder="1,250"></label>
    <div class="two"><label>Fecha<input type="date" name="day" required max="${day}" min="${C.addDays(day, -90)}" value="${day}"></label>
    <label>Dónde<select name="channel"><option value="tienda">Tienda</option><option value="en_linea">En línea</option><option value="restaurante">Restaurante</option><option value="experiencias">Experiencias</option><option value="punto_externo">Otro lugar</option></select></label></div>
    <label>Foto del ticket<input type="file" name="photo" accept="image/*" capture="environment" required></label>
    <p class="err" id="buyerr" role="alert"></p>
    <button class="btn" type="submit">Enviar compra</button></form></div></details>`}
${blocked ? '' : await datosHtml(env, person, st, ok)}
<details${ok === 'nuevo' ? ' open' : ''}><summary>Agregar a pantalla de inicio</summary><div>
  <p style="margin:6px 0 0"><b>iPhone</b> (Safari)</p><ol class="how"><li>Toca el botón Compartir <span aria-hidden="true">⬆︎</span>.</li><li>Elige <b>Agregar a inicio</b>.</li></ol>
  <p style="margin:10px 0 0"><b>Android</b> (Chrome)</p><ol class="how"><li>Toca el menú <span aria-hidden="true">⋮</span>.</li><li>Elige <b>Agregar a la pantalla principal</b>.</li></ol>
  <p class="small">Este enlace es tu tarjeta: no lo compartas. Si lo pierdes, te lo mandamos de nuevo por WhatsApp.</p></div></details>
${foot}
<script>
${STEPPER_JS}
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/c/sw.js', { scope: '/c/' }).catch(() => {});
const rv = document.getElementById('reservar');
// OpenTable's widget is a fixed-size iframe; scale it down to fit narrow phones so the whole calendar shows.
const fitOT = () => { const w = document.getElementById('otw'), f = w && w.querySelector('iframe'); if (!f) return;
  const fw = parseFloat(f.getAttribute('width')) || f.offsetWidth, fh = parseFloat(f.getAttribute('height')) || f.offsetHeight; if (!fw || !fh) return;
  f.style.width = fw + 'px'; f.style.height = fh + 'px';
  const k = Math.min(1, w.clientWidth / fw);
  f.style.transform = k < 1 ? 'scale(' + k + ')' : ''; f.style.margin = k < 1 ? '0' : '0 auto';
  w.style.height = Math.ceil(fh * k) + 'px'; };
if (rv) rv.addEventListener('toggle', () => { const w = document.getElementById('otw'); if (!rv.open) return; if (w.dataset.on) return fitOT(); w.dataset.on = '1';
  new MutationObserver(fitOT).observe(w, { childList: true, subtree: true, attributes: true, attributeFilter: ['width', 'height'] });
  const s = document.createElement('script'); s.src = ${JSON.stringify(OT_WIDGET_SRC)}; w.appendChild(s); });
addEventListener('resize', fitOT);
const mc = document.getElementById('mc');
if (mc) { const t = () => { const on = mc.classList.toggle('flip'); mc.setAttribute('aria-pressed', String(on)); }; mc.addEventListener('click', t); mc.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); t(); } }); }
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
const metalOf = name => /diamante/i.test(name) ? 'm-diamante' : /plata/i.test(name) ? 'm-plata' : /bronce/i.test(name) ? 'm-bronce' : 'm-oro';
// The card itself. The QR is the same link the staff scan; the person's contact details never appear on it.
export function memberCard(person, st, link, blocked) {
  const main = st.programs[0] || st.level || null;
  const club = main ? main.name : st.pending.length ? st.pending[0].program : 'Socio';
  const since = new Date(person.created_at).toLocaleDateString('es-MX', { month: 'long', year: 'numeric', timeZone: C.TZ });
  const no = 'Nº ' + String(person.id).padStart(4, '0');
  const qr = qrSvg(link, { label: 'Código de tu tarjeta', color: '#1c0c10', bg: '#fffaf0' });
  const extra = st.programs.slice(1).map(p => `<span class="badge" style="--c:${e(p.color)}"><i></i>${e(p.name)}</span>`).join('');
  const until = st.validUntil && !blocked ? `Vigente hasta el ${e(fmtLong(st.validUntil))}.` : '';
  return `<div class="mc ${metalOf(club)}${blocked ? ' off' : ''}" id="mc" role="button" tabindex="0" aria-pressed="false" aria-label="Tarjeta de socio de ${e(person.name)}. Toca para ver el código grande.">
  <div class="mc-in">
    <div class="mc-face mc-front">
      <div class="mc-top"><span class="mc-logo foil" role="img" aria-label="Dos Búhos"></span><div class="mc-club foil-t">Club Dos Búhos<b>${e(club)}</b></div></div>
      <div class="mc-bot"><div style="min-width:0"><div class="mc-lbl">Socio</div><div class="mc-name">${e(person.name)}</div>
        <div class="mc-meta">Desde ${e(since)}<span>·</span>${no}</div></div>
        ${blocked ? '' : `<div class="mc-qs">${qr}</div>`}</div></div>
    <div class="mc-face mc-back">
      ${blocked ? '<div class="mc-btx"><b>Tarjeta no activa</b></div>' : `<div class="mc-qb">${qr}</div>`}
      <div class="mc-btx"><span class="mc-logo foil" role="img" aria-label="Dos Búhos"></span><b>Muéstralo al llegar</b>
        <p>${until} Personal e intransferible.</p><p class="foil-t" style="opacity:1;letter-spacing:.18em;text-transform:uppercase;font-size:10px;margin-top:10px">San Miguel de Allende</p></div></div>
  </div></div>
${extra ? `<div class="mc-more">${extra}</div>` : ''}
<p class="mc-hint noprint">Toca la tarjeta para voltearla</p>`;
}
const fmtLong = d => { const [y, mo, da] = d.split('-').map(Number); return `${da} de ${MONTHS[mo - 1]} de ${y}`; };
// "Mis datos": the guest adds or changes their email, birthday and answers. The card link is the only credential, so
// saved values are never shown back (a forwarded link must not reveal an email or a birthday): blank keeps what we
// have, anything written replaces it. Name and WhatsApp go through the team (the number is how we find them).
async function datosHtml(env, person, st, ok) {
  const cat = await catalog(env);
  const progIds = [...new Set(st.memberships.map(m => m.program_id))];
  const qs = cat.fields.filter(f => !f.archived && !f.staff_only && (!f.program_id || progIds.includes(f.program_id))).sort((a, b) => a.sort - b.sort || a.id - b.id);
  const ans = await fieldValues(env, person.id);
  const have = '<span class="small" style="display:block">Ya lo tenemos. Escribe solo si quieres cambiarlo.</span>';
  const days = Array.from({ length: 31 }, (_, i) => `<option value="${i + 1}">${i + 1}</option>`).join('');
  const months = MONTHS.map((m, i) => `<option value="${i + 1}">${m}</option>`).join('');
  return `<details${ok === 'datos' ? ' open' : ''}><summary>Mis datos</summary><div>
  <form method="post" action="/c/${e(person.card_code)}/datos">
    <p class="small" style="margin:6px 0 0">Para cambiar tu nombre o tu WhatsApp, escríbenos.</p>
    <label>Correo${person.email ? have : ' (opcional)'}<input name="email" type="email" autocomplete="email" maxlength="120"></label>
    <label>Cumpleaños${person.birthday ? have : ' (opcional)'}</label><div class="two"><select name="bday" aria-label="Día"><option value="">Día</option>${days}</select><select name="bmonth" aria-label="Mes"><option value="">Mes</option>${months}</select></div>
    ${qs.map(f => fieldHtml({ ...f, required: 0, help: ans[f.id] ? 'Ya respondiste. Elige o escribe solo si quieres cambiarlo.' : f.help }, '')).join('')}
    <button class="btn" type="submit">Guardar mis datos</button></form></div></details>`;
}
async function guestData(request, env, person) {
  if (person.status !== 'active') return see(`/c/${person.card_code}`);
  const b = await form(request);
  const next = {};
  if (String(b.email || '').trim()) { const em = C.normEmail(b.email); if (em) next.email = em; }
  const bd = parseInt(b.bday, 10), bm = parseInt(b.bmonth, 10);
  if (bd >= 1 && bd <= 31 && bm >= 1 && bm <= 12) next.birthday = `${String(bm).padStart(2, '0')}-${String(bd).padStart(2, '0')}`;
  const cat = await catalog(env);
  const progIds = (await env.DB.prepare("SELECT program_id FROM club_memberships WHERE person_id = ? AND status IN ('active', 'pending')").bind(person.id).all()).results.map(r => r.program_id);
  const qs = cat.fields.filter(f => !f.archived && !f.staff_only && (!f.program_id || progIds.includes(f.program_id)) && String(b['f_' + f.id] || '').trim());
  const ans = readFields(qs.map(f => ({ ...f, required: 0 })), b);
  const keys = Object.keys(next);
  if (keys.length) await env.DB.prepare(`UPDATE club_people SET ${keys.map(k => k + ' = ?').join(', ')}, updated_at = ? WHERE id = ?`).bind(...keys.map(k => next[k]), Date.now(), person.id).run();
  const vals = Object.fromEntries(Object.entries(ans.values).filter(([, v]) => v !== ''));
  await saveFieldValues(env, person.id, vals, 'invitado');
  if (keys.length || Object.keys(vals).length) await clubAudit(env, 'invitado', 'guest.update', 'person', person.id, { changed: keys, answers: Object.keys(vals).length });
  return see(`/c/${person.card_code}?ok=datos`);
}
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
// A personal invitation made with an email is good only for that email (the form doesn't show it, so a forwarded link
// is no use). Personal-only programs (Amigos y familia) take no group links at all.
const emailLocked = inv => !!(inv && inv.kind === 'personal' && inv.email);
const linkBlocked = inv => !!(inv && inv.personal_only && inv.kind !== 'personal');
async function loadInvite(env, tok) {
  return env.DB.prepare('SELECT i.*, p.name AS program, p.kind AS program_kind, p.is_pro, p.personal_only, p.archived AS program_archived FROM club_invites i JOIN club_programs p ON p.id = i.program_id WHERE i.token = ?').bind(tok).first();
}
// One sign-up question as a guest-page input. Name f_<id>.
function fieldHtml(f, val = '') {
  const n = `f_${f.id}`, req = f.required ? ' required' : '', lab = `${e(f.label)}${f.required ? '' : ' (opcional)'}`;
  const help = f.help ? `<span class="small" style="display:block">${e(f.help)}</span>` : '';
  if (f.kind === 'choice') return `<label>${lab}${help}<select name="${n}"${req}><option value="">Elige una opción</option>${String(f.options).split('\n').filter(Boolean).map(o => `<option${o === val ? ' selected' : ''}>${e(o)}</option>`).join('')}</select></label>`;
  if (f.kind === 'yes_no') return `<label>${lab}${help}<select name="${n}"${req}><option value="">Elige</option><option${val === 'Sí' ? ' selected' : ''}>Sí</option><option${val === 'No' ? ' selected' : ''}>No</option></select></label>`;
  if (f.kind === 'date') return `<label>${lab}${help}<input type="date" name="${n}" value="${e(val)}"${req}></label>`;
  return `<label>${lab}${help}<input name="${n}" maxlength="300" value="${e(val)}"${req}></label>`;
}
async function signupForm(env, url, tok, vals = null, error = '') {
  const inv = await loadInvite(env, tok);
  const problem = linkBlocked(inv) ? 'Esta invitación ya no está activa. Pide a quien te la mandó una invitación personal.' : C.inviteProblem(inv);
  if (problem) return H(page({ title: 'Invitación · Dos Búhos', body: `<div class="hero"><div class="mark">Dos Búhos</div><h1>Lo sentimos</h1><p>${e(problem)}</p></div><a class="btn ghost" href="/c/">¿Ya tenías tarjeta? Recupérala</a>${foot}` }), inv ? 410 : 404);
  const locked = emailLocked(inv);
  const v = vals || { name: inv.name, phone: inv.phone ? C.fmtPhone(inv.phone) : '', email: locked ? '' : inv.email };
  const days = Array.from({ length: 31 }, (_, i) => i + 1).map(d => `<option${String(v.bday || '') === String(d) ? ' selected' : ''}>${d}</option>`).join('');
  const months = MONTHS.map((mo, i) => `<option value="${i + 1}"${String(v.bmonth || '') === String(i + 1) ? ' selected' : ''}>${mo}</option>`).join('');
  const qs = C.fieldsFor((await catalog(env)).fields, inv.program_id, { guest: true });
  const questions = qs.map(f => fieldHtml(f, v['f_' + f.id] ?? '')).join('');
  const pro = inv.is_pro ? `<label>¿A qué te dedicas?<select name="pro_type" required><option value="">Elige una opción</option>${Object.entries(C.PRO_TYPES).map(([k, t]) => `<option value="${k}"${v.pro_type === k ? ' selected' : ''}>${t}</option>`).join('')}</select></label>` : '';
  const body = `<div class="hero"><div class="mark">Dos Búhos<small>Club de beneficios</small></div>
  <h1>${inv.name ? `Hola, ${e(C.firstName(inv.name))}` : 'Te damos la bienvenida'}</h1>
  <p>Te invitamos al club como parte de <b>${e(inv.program)}</b>. Toma un minuto y tu tarjeta queda en tu teléfono.</p></div>
<form class="panel" method="post" action="/c/i/${e(tok)}">
  ${error ? `<p class="err" role="alert">${e(error)}</p>` : ''}
  <label>Nombre y apellido<input name="name" required maxlength="80" autocomplete="name" value="${e(v.name || '')}"></label>
  <label>WhatsApp<input name="phone" type="tel" required inputmode="tel" autocomplete="tel" placeholder="415 123 4567" value="${e(v.phone || '')}"></label>
  <label>${locked ? 'Correo <span class="small">(el mismo al que te llegó la invitación)</span>' : 'Correo (opcional)'}<input name="email" type="email" autocomplete="email" maxlength="120"${locked ? ' required' : ''} value="${e(v.email || '')}"></label>
  <label>Cumpleaños (opcional)</label><div class="two"><select name="bday" aria-label="Día"><option value="">Día</option>${days}</select><select name="bmonth" aria-label="Mes"><option value="">Mes</option>${months}</select></div>
  ${pro}${questions}
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
  if (linkBlocked(inv) || C.inviteProblem(inv)) return signupForm(env, url, tok);
  const vals = { name: String(b.name || '').trim().slice(0, 80), phone: String(b.phone || ''), email: String(b.email || ''), bday: b.bday, bmonth: b.bmonth, pro_type: b.pro_type, terms: b.terms };
  const phone = C.normPhone(b.phone), email = C.normEmail(b.email);
  if (vals.name.length < 2) return signupForm(env, url, tok, vals, 'Escribe tu nombre.');
  if (!C.validPhone(phone)) return signupForm(env, url, tok, vals, 'Revisa tu número de WhatsApp: 10 dígitos, o con lada de país.');
  if (b.email && !email) return signupForm(env, url, tok, vals, 'Revisa tu correo, o déjalo vacío.');
  if (emailLocked(inv) && email !== C.normEmail(inv.email)) {
    await clubAudit(env, 'invitado', 'signup.email_mismatch', 'invite', inv.id, { program: inv.program_id });
    return signupForm(env, url, tok, vals, 'Este correo no coincide con la invitación. Usa el correo al que te llegó, o pide a quien te invitó que la revise.');
  }
  if (!b.terms) return signupForm(env, url, tok, vals, 'Para crear tu tarjeta acepta los términos del club.');
  if (inv.is_pro && !C.PRO_TYPES[b.pro_type]) return signupForm(env, url, tok, vals, 'Elige a qué te dedicas.');
  const qs = C.fieldsFor((await catalog(env)).fields, inv.program_id, { guest: true });
  for (const f of qs) vals['f_' + f.id] = b['f_' + f.id];
  const ans = readFields(qs, b);
  if (ans.error) return signupForm(env, url, tok, vals, ans.error);
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
  await saveFieldValues(env, pid, ans.values, 'invitado');
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
