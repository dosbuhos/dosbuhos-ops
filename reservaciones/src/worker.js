// Reservaciones — the week's reservations as a manifest (with the guest behind each one) and Parrot's sales beside them.
// Served behind the Hub at /reservaciones/. It reads the growth database and writes only its own (guests).
//   GET  /api/semana?d=YYYY-MM-DD            the week that day falls in (Monday to Sunday)
//   GET  /api/ventas?p=dia|semana|mes&d=...  sales of that period (Hub roles editor and admin only)
//   POST /api/sincronizar                    read guests from Klaviyo now (admins)
import { hubUser } from './hub-auth.js';
import { withHubSecret } from './hub-secret.js';
import { esFecha, fechaLocal, lunesDe } from './fechas.js';
import { semana } from './manifiesto.js';
import { ventas, PERIODOS } from './ventas.js';
import { sincronizar } from './huespedes.js';

const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow', 'x-content-type-options': 'nosniff' } });
const mal = (msg, status = 400) => json({ error: msg }, status);
const lista = (s) => (s || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
/** The manifest asks for the guests again when a reservation has none, but not more often than this. */
const ESPERA_SYNC_MS = 3 * 60_000;

// Who is asking, and what they may see. Fails closed: without the Hub's signature nothing is served (the workers.dev
// address is public). Everyone the Hub lets in sees the manifest with the guests' names and contact details; sales are
// for the Hub roles "editor" and "admin" (and Hub admins), so a host with "viewer" sees reservations only.
async function quien(request, env) {
  let who = null;
  if (env.ENVIRONMENT === 'dev' && env.DEV_USER) who = { email: env.DEV_USER, name: env.DEV_NAME || 'Dev', role: env.DEV_ROLE || 'admin', hubAdmin: env.DEV_ADMIN === '1' };
  else if (env.HUB_SECRET) who = await hubUser(request, env);
  if (!who) return null;
  const email = String(who.email).toLowerCase();
  const admin = !!who.hubAdmin || who.role === 'admin' || lista(env.ADMIN_EMAILS).includes(email);
  return { email, nombre: who.name || email, admin, ventas: admin || who.role === 'editor' };
}

async function api(request, env, ctx, url, yo) {
  const p = url.pathname.replace(/^\/api/, ''), M = request.method, ahora = Date.now();
  // Local dev can pretend it is another day (?hoy=2026-11-21) to look at a service day; never outside dev.
  const fingido = env.ENVIRONMENT === 'dev' ? url.searchParams.get('hoy') : null;
  const hoy = fingido && esFecha(fingido) ? fingido : fechaLocal(ahora);
  const d = url.searchParams.get('d');
  if (d !== null && !esFecha(d)) return mal('Fecha inválida');

  if (M === 'GET' && p === '/semana') {
    const s = await semana(env, yo, lunesDe(d || hoy), hoy, ahora);
    // A reservation without its guest usually means it was booked since the last run: read again, quietly.
    if (s.sinHuesped > 0 && (!s.syncCorrio || ahora - s.syncCorrio > ESPERA_SYNC_MS)) ctx.waitUntil(sincronizar(env, ahora, { maxPaginas: 6 }).catch(() => {}));
    delete s.syncCorrio;
    return json(s);
  }
  if (M === 'GET' && p === '/ventas') {
    if (!yo.ventas) return mal('Las ventas son para gerencia. Pide acceso a quien administra el Hub.', 403);
    const periodo = url.searchParams.get('p') || 'semana';
    if (!PERIODOS.includes(periodo)) return mal('Periodo inválido');
    return json({ ...(await ventas(env, periodo, d || hoy, hoy, ahora)), yo: { nombre: yo.nombre, ventas: true, admin: yo.admin } });
  }
  if (M === 'POST' && p === '/sincronizar') {
    if (!yo.admin) return mal('Solo administradores', 403);
    return json(await sincronizar(env, ahora));
  }
  return mal('No existe', 404);
}

export default {
  async fetch(request, env, ctx) {
    env = await withHubSecret(env);
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    const yo = await quien(request, env);
    if (!yo) return mal('Abre Reservaciones desde el Hub: apps.dosbuhos.com', 401);
    try { return await api(request, env, ctx, url, yo); } catch (e) { console.log('api', url.pathname, String((e && e.stack) || e)); return mal('Algo falló. Intenta de nuevo.', 500); }
  },
  async scheduled(_c, env, ctx) {
    ctx.waitUntil(sincronizar(env, Date.now()).then((r) => { if (!r.ok) console.log('huespedes', r.error); }));
  },
};
