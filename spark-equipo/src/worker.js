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
import cobranzaArchivo from './data/cobranza.json';
import presupuesto from './data/presupuesto.json';
import prospCarlos from './data/prospeccion_carlos.json';
import usa from './data/usa.json';
import { encuestaPublica } from './encuesta.js';
import { diff } from './calc.js';

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
  // Time the reps corrected on sheet rows (kept apart because the sheet copy is replaced on every sync).
  const tiempos = new Map((await all('SELECT * FROM tiempos')).map((t) => [`${t.persona}|${t.fecha}|${t.clave}|${t.actividad}`, t.minutos]));
  for (const r of activity) if (!r.minutos) { const t = tiempos.get(`${r.persona}|${r.fecha}|${norm(r.cuenta)}|${r.actividad || ''}`); if (t) r.minutos = t; }
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
    // Client survey: public, no sign-in. The link carries a random token.
    if (p.startsWith('/e/')) return encuestaPublica(request, env, p.slice(3).replace(/\/$/, ''));
    if (!p.startsWith('/api/')) return env.ASSETS.fetch(request);
    env = await withHubSecret(env);   // HUB_SECRET from the Secrets Store
    const yo = await quien(request, env);
    if (!yo) return json({ error: 'Entra por el Hub: apps.dosbuhos.com' }, 401);
    if (!yo.admin && !yo.persona) return json({ error: 'Tu correo todavía no está ligado a un vendedor. Pídele a Eric que te dé de alta en Ajustes.', yo }, 403);

    if (p === '/api/data' && request.method === 'GET') {
      const m = paraVer(await modelo(env), yo);
      const sug = new Map((await env.DB.prepare('SELECT persona, clave, texto FROM sugerencias').all()).results.map((r) => [r.persona + '|' + r.clave, r.texto]));
      for (const r of m.seguimiento) r.sugerencia = sug.get(r.persona + '|' + norm(r.cuenta)) || '';
      const todo = (sql) => env.DB.prepare(sql).all().then((r) => r.results);
      const [cuentas, encuestas, materiales, cobros] = await Promise.all([todo('SELECT * FROM cuentas'), todo('SELECT * FROM encuestas ORDER BY creada DESC'), todo('SELECT * FROM materiales ORDER BY categoria, id'), todo('SELECT * FROM cobros ORDER BY id DESC')]);
      // The client book: Zoho clients with what the notes say, then what people corrected, then the US accounts from the importer's report.
      const edit = new Map(cuentas.map((c) => [c.clave, c])), CAMPOS = ['contacto', 'puesto', 'email', 'telefono', 'ciudad', 'estado', 'tipo', 'notas'];
      for (const d of m.directorio) { const e = edit.get(d.clave); if (e) for (const k of CAMPOS) if (e[k]) d[k] = e[k]; }
      for (const u of usa.cuentas) { const clave = norm(u.nombre), e = edit.get(clave) || {}; m.directorio.push({ clave, nombre: u.nombre, pais: 'Estados Unidos', zona: 'usa', zona_nombre: 'Estados Unidos · ' + u.estado, vendedor: 'Eric (La Competencia)', tipo: e.tipo || u.tipo,
        contacto: e.contacto || '', puesto: e.puesto || '', email: e.email || '', telefono: e.telefono || '', ciudad: e.ciudad || u.ciudad, estado: e.estado || u.estado, notas: e.notas || `${u.cajas} cajas en 2026 · ${u.vinos.join(', ')} · rep. ${u.rep}`, direccion: u.direccion, cajas: u.cajas, ultimo_mes: u.ultimo_mes }); }
      // Strategy and promotions: admins see everything, the team only what was marked visible.
      const ve = yo.admin ? '' : ' WHERE visible = 1';
      m.estrategia = await todo('SELECT * FROM estrategia' + ve + ' ORDER BY tipo DESC, id DESC'); m.promociones = await todo('SELECT * FROM promociones' + ve + ' ORDER BY inicio DESC, id DESC');
      m.cuentas = cuentas; m.encuestas = encuestas; m.encuesta_base = env.SURVEY_ORIGIN || 'https://spark-equipo.dos-buhos.workers.dev';
      m.materiales = materiales; m.usa_envios = usa.envios; m.prosp_carlos = prospCarlos; m.presupuesto = presupuesto;
      // Receivables: Carlos's file (a dated snapshot, since the Zoho token can't read invoices) plus the follow-up notes made here.
      m.cobranza = { corte: cobranzaArchivo.corte, facturas: cobranzaArchivo.facturas.map((f) => ({ ...f, dias: /^\d{4}-\d\d-\d\d$/.test(f.vence) ? diff(f.vence, m.hoy) : null })), gestiones: cobros };
      m.preguntas = (await env.DB.prepare('SELECT * FROM preguntas ORDER BY respondida != \'\', id DESC').all()).results;
      const meta = (await env.DB.prepare("SELECT k, v FROM meta WHERE k LIKE 'sync_%'").all()).results;
      return json({ ...m, sync: Object.fromEntries(meta.map((r) => [r.k.slice(5), JSON.parse(r.v)])) });
    }
    const cuerpo = async () => request.json().catch(() => ({})), txt = (v, n = 300) => String(v ?? '').trim().slice(0, n), HOY = hoyEn(env.TZ);
    const quienEs = (b) => (yo.admin && GENTE.includes(b.persona) ? b.persona : yo.persona);
    // A contact logged in the app. Kept apart from the sheet copy (origen 'app'), so a sheet sync never removes it.
    if (p === '/api/actividad' && request.method === 'POST') {
      const b = await cuerpo(), persona = quienEs(b);
      if (!persona) return json({ error: 'Elige a nombre de quién se registra' }, 400);
      if (!txt(b.cuenta) || !txt(b.resultado, 2000)) return json({ error: 'Faltan la cuenta y lo que pasó' }, 400);
      const fecha = /^\d{4}-\d\d-\d\d$/.test(b.fecha || '') && b.fecha <= HOY ? b.fecha : HOY, prox = /^\d{4}-\d\d-\d\d$/.test(b.proximo || '') ? b.proximo : '';
      await env.DB.prepare("INSERT INTO activity (persona, fecha, zona, cuenta, tipo, actividad, medio, etapa, contacto, telefono, resultado, siguiente_paso, proximo, minutos, botellas_mes, origen) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'app')")
        .bind(persona, fecha, txt(b.zona, 40), txt(b.cuenta, 120), txt(b.tipo, 40), txt(b.actividad, 40) || 'Seguimiento', txt(b.medio, 40), txt(b.etapa, 40), txt(b.contacto, 120), txt(b.telefono, 120), txt(b.resultado, 2000), txt(b.siguiente_paso, 500), prox,
          Number(b.minutos) > 0 ? Math.min(600, Math.round(Number(b.minutos))) : null, Number(b.botellas_mes) > 0 ? Math.round(Number(b.botellas_mes)) : null).run();
      return json({ ok: true });
    }
    // Time a contact really took (corrects the estimate).
    if (p === '/api/tiempo' && request.method === 'POST') {
      const b = await cuerpo(), persona = yo.admin && GENTE.includes(b.persona) ? b.persona : yo.persona, min = Math.round(Number(b.minutos));
      if (!persona || (!yo.admin && b.persona && b.persona !== yo.persona)) return json({ error: 'Solo puedes corregir tus propios contactos' }, 403);
      if (!(min > 0 && min <= 600) || !/^\d{4}-\d\d-\d\d$/.test(b.fecha || '') || !txt(b.cuenta)) return json({ error: 'Pon los minutos (1 a 600)' }, 400);
      await env.DB.prepare('INSERT INTO tiempos (persona, fecha, clave, actividad, minutos) VALUES (?,?,?,?,?) ON CONFLICT(persona, fecha, clave, actividad) DO UPDATE SET minutos = excluded.minutos').bind(persona, b.fecha, norm(b.cuenta), txt(b.actividad, 40), min).run();
      await env.DB.prepare("UPDATE activity SET minutos = ? WHERE origen = 'app' AND persona = ? AND fecha = ? AND cuenta = ? AND actividad = ?").bind(min, persona, b.fecha, txt(b.cuenta, 120), txt(b.actividad, 40)).run();
      return json({ ok: true });
    }
    // What someone adds or corrects about an account (contact details, by-the-glass, stage).
    if (p === '/api/cuenta' && request.method === 'POST') {
      const b = await cuerpo(), nombre = txt(b.nombre, 160);
      if (!nombre) return json({ error: 'Falta el nombre de la cuenta' }, 400);
      const copeo = ['si', 'propuesto', 'no', ''].includes(b.copeo) ? b.copeo : '';
      await env.DB.prepare(`INSERT INTO cuentas (clave, nombre, contacto, puesto, email, telefono, ciudad, estado, tipo, notas, copeo, copeo_vino, fase, botellas_mes, actualizado, por) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(clave) DO UPDATE SET nombre=excluded.nombre, contacto=excluded.contacto, puesto=excluded.puesto, email=excluded.email, telefono=excluded.telefono, ciudad=excluded.ciudad, estado=excluded.estado, tipo=excluded.tipo, notas=excluded.notas,
          copeo=excluded.copeo, copeo_vino=excluded.copeo_vino, fase=excluded.fase, botellas_mes=excluded.botellas_mes, actualizado=excluded.actualizado, por=excluded.por`)
        .bind(norm(nombre), nombre, txt(b.contacto, 120), txt(b.puesto, 80), txt(b.email, 160), txt(b.telefono, 80), txt(b.ciudad, 80), txt(b.estado, 60), txt(b.tipo, 60), txt(b.notas, 1000), copeo, txt(b.copeo_vino, 120), txt(b.fase, 40),
          Number(b.botellas_mes) > 0 ? Math.round(Number(b.botellas_mes)) : null, HOY, yo.nombre || yo.email).run();
      return json({ ok: true });
    }
    // A new survey link for a client. The rep sends it from their own phone.
    if (p === '/api/encuestas' && request.method === 'POST') {
      const b = await cuerpo(), cliente = txt(b.cliente, 160), persona = quienEs(b) || 'Eric';
      if (!cliente) return json({ error: 'Falta el cliente' }, 400);
      const token = [...crypto.getRandomValues(new Uint8Array(16))].map((x) => x.toString(16).padStart(2, '0')).join('');
      await env.DB.prepare('INSERT INTO encuestas (token, cliente, clave, persona, creada) VALUES (?,?,?,?,?)').bind(token, cliente, norm(cliente), persona, HOY).run();
      return json({ ok: true, token, url: `${env.SURVEY_ORIGIN || 'https://spark-equipo.dos-buhos.workers.dev'}/e/${token}` });
    }
    // A collection follow-up: what was said and when they promised to pay.
    if (p === '/api/cobros' && request.method === 'POST') {
      const b = await cuerpo();
      if (!txt(b.cliente) || !txt(b.nota, 1000)) return json({ error: 'Faltan el cliente y la nota' }, 400);
      await env.DB.prepare('INSERT INTO cobros (cliente, factura, nota, promesa, monto, por, creado) VALUES (?,?,?,?,?,?,?)').bind(txt(b.cliente, 160), txt(b.factura, 40), txt(b.nota, 1000), /^\d{4}-\d\d-\d\d$/.test(b.promesa || '') ? b.promesa : '', Number(b.monto) > 0 ? Number(b.monto) : null, yo.nombre || yo.email, HOY).run();
      return json({ ok: true });
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
    if ((p === '/api/admin/estrategia' || p === '/api/admin/promociones') && request.method === 'POST') {
      const b = await cuerpo(), T = p.endsWith('estrategia') ? 'estrategia' : 'promociones', fecha = (v) => (/^\d{4}-\d\d-\d\d$/.test(v || '') ? v : '');
      if (b.borrar) { await env.DB.prepare(`DELETE FROM ${T} WHERE id = ?`).bind(Number(b.borrar) || 0).run(); return json({ ok: true }); }
      if (b.visible_id) { await env.DB.prepare(`UPDATE ${T} SET visible = ? WHERE id = ?`).bind(b.visible ? 1 : 0, Number(b.visible_id) || 0).run(); return json({ ok: true }); }
      if (T === 'estrategia') {
        if (!txt(b.titulo) || (b.url && !/^https:\/\//.test(b.url))) return json({ error: 'Pon un título; la liga, si hay, debe empezar con https://' }, 400);
        await env.DB.prepare('INSERT INTO estrategia (tipo, titulo, url, nota, anio, visible, creado, por) VALUES (?,?,?,?,?,?,?,?)').bind(b.tipo === 'meta' ? 'meta' : 'documento', txt(b.titulo, 200), txt(b.url, 600), txt(b.nota, 2000), Number(b.anio) || Number(HOY.slice(0, 4)), b.visible === 'si' ? 1 : 0, HOY, yo.nombre || yo.email).run();
      } else {
        if (!txt(b.nombre)) return json({ error: 'Falta el nombre de la promoción' }, 400);
        await env.DB.prepare('INSERT INTO promociones (nombre, detalle, aplica, inicio, fin, autorizo, autorizada, visible, creado, por) VALUES (?,?,?,?,?,?,?,?,?,?)').bind(txt(b.nombre, 200), txt(b.detalle, 2000), txt(b.aplica, 200), fecha(b.inicio), fecha(b.fin), txt(b.autorizo, 80), fecha(b.autorizada), b.visible === 'no' ? 0 : 1, HOY, yo.nombre || yo.email).run();
      }
      return json({ ok: true });
    }
    if (p === '/api/admin/materiales' && request.method === 'POST') {
      const b = await cuerpo();
      if (b.borrar) { await env.DB.prepare('DELETE FROM materiales WHERE id = ?').bind(Number(b.borrar) || 0).run(); return json({ ok: true }); }
      if (!txt(b.titulo) || !/^https:\/\//.test(b.url || '') || !txt(b.categoria)) return json({ error: 'Pon categoría, título y una liga https://' }, 400);
      await env.DB.prepare('INSERT INTO materiales (categoria, titulo, url, nota, creado, por) VALUES (?,?,?,?,?,?)').bind(txt(b.categoria, 60), txt(b.titulo, 160), txt(b.url, 600), txt(b.nota, 300), HOY, yo.nombre || yo.email).run();
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
