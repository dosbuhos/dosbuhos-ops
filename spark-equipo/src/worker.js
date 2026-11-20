// Spark Equipo — the sales team's numbers on their phone: weekly pace, follow-ups, sales, zones and effectiveness.
// Served behind the Hub at /spark/. Reads a daily copy of the CRM sheet and of Zoho; all figures come from src/calc.js.
import { hubUser } from './hub-auth.js';
import { withHubSecret } from './hub-secret.js';
import { build, paraVer, hoyEn, GENTE, norm } from './calc.js';
import { sugerir } from './ai.js';
import { syncZoho } from './zoho.js';
import { syncSheet, sheetEmail } from './sheets.js';
import zonasCfg from './data/zonas.json';
import prospectos from './data/prospectos.json';
import aliasSeed from './data/alias.json';

const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const setMeta = (env, k, v) => env.DB.prepare('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').bind(k, String(v)).run();

// Who is asking. Fails closed: without HUB_SECRET nothing private is served (the workers.dev address is public).
async function quien(request, env) {
  let who = null;
  if (env.ENVIRONMENT === 'dev' && env.DEV_USER) who = { email: env.DEV_USER, name: 'Dev', hubAdmin: env.DEV_ADMIN !== '0' };
  else if (env.HUB_SECRET) who = await hubUser(request, env);
  if (!who) return null;
  const email = who.email.toLowerCase();
  const p = await env.DB.prepare('SELECT persona, rol FROM people WHERE email = ?').bind(email).first();
  const admin = !!who.hubAdmin || (env.ADMIN_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).includes(email) || p?.rol === 'admin';
  return { email, nombre: who.name || email, admin, persona: p?.persona || null };
}

async function modelo(env, conActividad) {
  const all = (sql) => env.DB.prepare(sql).all().then((r) => r.results);
  const [activity, orders, invoices, alias] = await Promise.all([
    all('SELECT * FROM activity'), all('SELECT * FROM orders'), all('SELECT * FROM invoices'), all('SELECT * FROM alias')]);
  // No invoice copy (the Zoho token can't read invoices): an invoiced sales order stands in for its invoice, dated as the order.
  const inv = invoices.length ? invoices : orders.filter((o) => ['invoiced', 'partially_invoiced'].includes(o.facturacion))
    .map((o) => ({ id: o.id, fecha: o.fecha, cliente_id: o.cliente_id, cliente: o.cliente, vendedor: o.vendedor, total: o.total, estado: o.estado }));
  const m = build({ activity, orders, invoices: inv, alias, zonasCfg, prospectos, hoy: hoyEn(env.TZ) });
  return conActividad ? { m, activity } : m;
}

async function sync(env, what) {
  const out = {};
  if ((await env.DB.prepare('SELECT COUNT(*) n FROM alias').first()).n === 0) {
    await env.DB.batch(aliasSeed.map((a) => env.DB.prepare('INSERT OR IGNORE INTO alias (cliente, claves, nota) VALUES (?,?,?)').bind(a.cliente, a.claves, a.nota || '')));
  }
  for (const [name, fn] of [['hoja', syncSheet], ['zoho', syncZoho]]) {
    if (what && what !== name) continue;
    try { out[name] = await fn(env); await setMeta(env, 'sync_' + name, JSON.stringify({ at: new Date().toISOString(), ok: !out[name].skipped, ...out[name] })); }
    catch (e) { out[name] = { error: String(e.message || e) }; await setMeta(env, 'sync_' + name, JSON.stringify({ at: new Date().toISOString(), ok: false, error: out[name].error })); }
  }
  // Claude's suggested next steps, from the notes just synced. A few accounts per run; the rest follow on the next runs.
  if (!what || what === 'ia') {
    try { const { m, activity } = await modelo(env, true); out.ia = await sugerir(env, m, activity); await setMeta(env, 'sync_ia', JSON.stringify({ at: new Date().toISOString(), ok: !out.ia.skipped, ...out.ia })); }
    catch (e) { out.ia = { error: String(e.message || e) }; await setMeta(env, 'sync_ia', JSON.stringify({ at: new Date().toISOString(), ok: false, error: out.ia.error })); }
  }
  return out;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url), p = url.pathname;
    if (!p.startsWith('/api/')) return env.ASSETS.fetch(request);
    env = await withHubSecret(env);   // HUB_SECRET from the Secrets Store
    const yo = await quien(request, env);
    if (!yo) return json({ error: 'Entra por el Hub: apps.dosbuhos.com' }, 401);
    if (!yo.admin && !yo.persona) return json({ error: 'Tu correo todavía no está ligado a un vendedor. Pídele a Eric que te dé de alta en Ajustes.', yo }, 403);

    if (p === '/api/data' && request.method === 'GET') {
      const m = paraVer(await modelo(env), yo);
      const sug = new Map((await env.DB.prepare('SELECT persona, clave, texto FROM sugerencias').all()).results.map((r) => [r.persona + '|' + r.clave, r.texto]));
      for (const r of m.seguimiento) r.sugerencia = sug.get(r.persona + '|' + norm(r.cuenta)) || '';
      m.preguntas = (await env.DB.prepare('SELECT * FROM preguntas ORDER BY respondida != \'\', id DESC').all()).results;
      const meta = (await env.DB.prepare("SELECT k, v FROM meta WHERE k LIKE 'sync_%'").all()).results;
      return json({ ...m, sync: Object.fromEntries(meta.map((r) => [r.k.slice(5), JSON.parse(r.v)])) });
    }
    // Open questions: the person asked (or an admin) writes the answer.
    if (p === '/api/preguntas/responder' && request.method === 'POST') {
      const b = await request.json().catch(() => ({})), txt = String(b.respuesta || '').trim().slice(0, 2000);
      const q = await env.DB.prepare('SELECT * FROM preguntas WHERE id = ?').bind(Number(b.id) || 0).first();
      if (!q) return json({ error: 'Esa pregunta ya no existe' }, 404);
      if (!yo.admin && q.para !== yo.persona) return json({ error: 'Esta pregunta es para ' + q.para }, 403);
      if (!txt) return json({ error: 'Escribe la respuesta' }, 400);
      await env.DB.prepare('UPDATE preguntas SET respuesta = ?, respondio = ?, respondida = ? WHERE id = ?').bind(txt, yo.email, hoyEn(env.TZ), q.id).run();
      return json({ ok: true });
    }
    if (!p.startsWith('/api/admin/')) return json({ error: 'No existe' }, 404);
    if (!yo.admin) return json({ error: 'Solo administradores' }, 403);

    if (p === '/api/admin/preguntas' && request.method === 'POST') {
      const b = await request.json().catch(() => ({}));
      if (b.borrar) { await env.DB.prepare('DELETE FROM preguntas WHERE id = ?').bind(Number(b.borrar) || 0).run(); return json({ ok: true }); }
      if (b.reabrir) { await env.DB.prepare("UPDATE preguntas SET respondida = '' WHERE id = ?").bind(Number(b.reabrir) || 0).run(); return json({ ok: true }); }
      const txt = String(b.texto || '').trim().slice(0, 1000);
      if (!GENTE.includes(b.para) || !txt) return json({ error: 'Elige para quién es y escribe la pregunta' }, 400);
      await env.DB.prepare('INSERT INTO preguntas (para, texto, creada, creada_por) VALUES (?,?,?,?)').bind(b.para, txt, hoyEn(env.TZ), yo.nombre || yo.email).run();
      return json({ ok: true });
    }
    if (p === '/api/admin/sync' && request.method === 'POST') return json(await sync(env, url.searchParams.get('solo')));
    if (p === '/api/admin/people' && request.method === 'GET') return json({ people: (await env.DB.prepare('SELECT * FROM people ORDER BY persona, email').all()).results, gente: GENTE, correo_hoja: await sheetEmail(env).catch(() => '') });
    if (p === '/api/admin/people' && request.method === 'POST') {
      const b = await request.json().catch(() => ({}));
      const email = String(b.email || '').trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'Correo inválido' }, 400);
      if (b.borrar) { await env.DB.prepare('DELETE FROM people WHERE email = ?').bind(email).run(); return json({ ok: true }); }
      const rol = b.rol === 'admin' ? 'admin' : 'rep', persona = GENTE.includes(b.persona) ? b.persona : null;
      if (rol === 'rep' && !persona) return json({ error: 'Elige a quién corresponde' }, 400);
      await env.DB.prepare('INSERT INTO people (email, persona, rol) VALUES (?,?,?) ON CONFLICT(email) DO UPDATE SET persona=excluded.persona, rol=excluded.rol').bind(email, persona, rol).run();
      return json({ ok: true });
    }
    return json({ error: 'No existe' }, 404);
  },

  // 12:00 UTC = 6:00 in San Miguel: the CRM sheet and Zoho. 18:00 and 00:00 UTC (noon and 6 pm): Zoho only.
  async scheduled(event, env, ctx) {
    // The noon and 6 pm runs also continue the suggestions (sync writes them whenever `what` is empty or 'ia').
    ctx.waitUntil(event.cron === '0 12 * * *' ? sync(env, null) : sync(env, 'zoho').then(() => sync(env, 'ia')));
  }
};
