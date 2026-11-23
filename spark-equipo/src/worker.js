// Spark Equipo — the sales team's numbers on their phone: weekly pace, follow-ups, sales, zones and effectiveness.
// Served behind the Hub at /spark/. Reads a daily copy of the CRM sheet and of Zoho; all figures come from src/calc.js.
import { hubUser } from './hub-auth.js';
import { withHubSecret } from './hub-secret.js';
import { build, paraVer, hoyEn, GENTE, PERSONAS, CASA, VENDEDORES, norm, esInterno, deEric, vendedorDe, masDias, conciliador, PLAN_GENTE, EVENTO_TOPE, BOTELLA_MUESTRA } from './calc.js';
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
import { diff, NO_VENTA, APLICA_AJUSTE } from './calc.js';
import { cierreDe, REGLA_DESDE, AJUSTE_DESDE } from '../public/regla.js';

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
  return { email, nombre: who.name || email, admin, dueno: !!who.hubAdmin, persona: p?.persona || null };
}

async function modelo(env, conActividad) {
  const all = (sql) => env.DB.prepare(sql).all().then((r) => r.results);
  const [activity, orders, invoices, alias] = await Promise.all([
    all('SELECT * FROM activity'), all('SELECT * FROM orders'), all('SELECT * FROM invoices'), all('SELECT * FROM alias')]);
  // Time the reps corrected on sheet rows (kept apart because the sheet copy is replaced on every sync).
  const tiempos = new Map((await all('SELECT * FROM tiempos')).map((t) => [`${t.persona}|${t.fecha}|${t.clave}|${t.actividad}`, t.minutos]));
  for (const r of activity) if (!r.minutos) { const t = tiempos.get(`${r.persona}|${r.fecha}|${norm(r.cuenta)}|${r.actividad || ''}`); if (t) r.minutos = t; }
  // Export orders are keyed in Zoho in US dollars with 0% tax, but the Zoho record says MXN at rate 1 (their terms read
  // "Precios expresados en dólares americanos"). Turn them into pesos here. Every screen divides totals by 1.4674 to drop
  // IEPS and IVA, so the peso amount is grossed up by the same factor to come out right after that division.
  const usd = Number(env.USD_MXN) || 17.5;
  for (const o of orders) if (deEric(o.cliente)) { o.usd = o.total; o.total = o.total * usd * 1.4674; if (o.saldo) o.saldo = o.saldo * usd * 1.4674; }
  // Sales credited to someone other than the salesperson on the Zoho order: a single order, or every order of an account.
  const asig = await all('SELECT * FROM asignaciones'), porOrden = new Map(asig.filter((a) => a.tipo === 'orden').map((a) => [a.clave, a.vendedor])), porCuenta = new Map(asig.filter((a) => a.tipo === 'cuenta').map((a) => [norm(a.clave), a.vendedor]));
  for (const o of orders) { const v = porOrden.get(o.numero) || porCuenta.get(norm(o.cliente)); if (v) { o.vendedor_zoho = o.vendedor; o.vendedor = v; } }
  for (let i = orders.length - 1; i >= 0; i--) if (orders[i].vendedor === NO_VENTA) orders.splice(i, 1);   // not a sale: out of every figure
  // No invoice copy (the Zoho token can't read invoices): a sales order stands in for its invoice, dated as the order.
  // Every order that is not void or draft counts, invoiced or not: counting only invoiced ones made the current year look
  // worse than last year, whose orders are all invoiced by now.
  const inv = invoices.length ? invoices : orders.filter((o) => !['void', 'draft'].includes(o.estado))
    .map((o) => ({ id: o.id, fecha: o.fecha, cliente_id: o.cliente_id, cliente: o.cliente, vendedor: o.vendedor, total: o.total, estado: o.estado }));
  // Distributor scouting: the copy of the sheet's "Distribuidores" tab; until the first sync, the list imported from Carlos's file.
  const zonaDe = (n) => { const k = norm(n); const z = zonasCfg.zonas.find((x) => k && (norm(x.nombre).startsWith(k) || k.startsWith(norm(x.nombre).split(' (')[0]))); return z ? z.zona : ''; };
  const hoja = (await all('SELECT * FROM distribuidores')).map((d) => ({ ...d, zona: zonaDe(d.zona), comentarios: d.siguiente, status: /^rechaz/i.test(d.estado) ? d.motivo || d.status : d.status,
    grupo: /^rechaz/i.test(d.estado) ? 'Rechazada' : /^catalog/i.test(d.estado) ? 'Catalogado' : /^por contactar/i.test(d.estado) || !d.estado ? 'Por contactar' : 'En proceso' })).filter((d) => d.zona);
  // Accounts created in Spark join the prospect list of their zone until they buy.
  const nuevas = (await all("SELECT * FROM cuentas WHERE origen = 'app'")).filter((c) => zonasCfg.zonas.some((z) => z.zona === c.zona))
    .map((c) => ({ zona: c.zona, nombre: c.nombre, tipo: c.tipo || 'Prospecto', ciudades: [c.ciudad, c.estado].filter(Boolean).join(', '), razon: '', estado: 'Prospecto del equipo', fuente: '', claves: norm(c.nombre),
      nueva: true, contacto: c.contacto, telefono: c.telefono, email: c.email, vendedor: c.vendedor }));
  const m = build({ activity, orders, invoices: inv, alias, zonasCfg, prospectos: [...prospectos, ...nuevas], distribuidores: hoja.length ? hoja : prospCarlos, hoy: hoyEn(env.TZ) });
  m.dist_fuente = hoja.length ? 'hoja' : 'archivo'; m.crm_hoja = env.CRM_SHEET_ID;
  m.asignaciones = asig;
  // Receivables straight from Zoho: invoiced sales orders with a balance. Due date is taken as 30 days after the order
  // (the usual terms); the invoice's own due date needs invoice access the Zoho token does not have.
  if (orders.some((o) => o.saldo != null)) m.por_cobrar = orders.filter((o) => o.saldo > 0.5 && o.estado !== 'void' && ['invoiced', 'partially_invoiced'].includes(o.facturacion) && !esInterno(o.cliente))
    .map((o) => ({ fecha: o.fecha, vence: masDias(o.fecha, 30), factura: o.numero, cliente: o.cliente, saldo: Math.round(o.saldo * 100) / 100, vendedor: deEric(o.cliente) ? CASA : vendedorDe(o.vendedor) || 'Sin vendedor', pronostico: 0, comentario: '' }));
  return conActividad ? { m, activity } : m;
}

async function sync(env, what, opts) {
  const out = {};
  if ((await env.DB.prepare('SELECT COUNT(*) n FROM alias').first()).n === 0) {
    await env.DB.batch(aliasSeed.map((a) => env.DB.prepare('INSERT OR IGNORE INTO alias (cliente, claves, nota) VALUES (?,?,?)').bind(a.cliente, a.claves, a.nota || '')));
  }
  for (const [name, fn] of [['hoja', syncSheet], ['zoho', syncZoho]]) {
    if (what && what !== name) continue;
    try { out[name] = await fn(env, opts); await setMeta(env, 'sync_' + name, JSON.stringify({ at: new Date().toISOString(), ok: !out[name].skipped, ...out[name] })); }
    catch (e) { out[name] = { error: String(e.message || e) }; await setMeta(env, 'sync_' + name, JSON.stringify({ at: new Date().toISOString(), ok: false, error: out[name].error })); }
  }
  // Claude's suggested next steps, from the notes just synced. A few accounts per run; the rest follow on the next runs.
  if (!what || what === 'ia') {
    try { const { m, activity } = await modelo(env, true); out.ia = await sugerir(env, m, activity); await setMeta(env, 'sync_ia', JSON.stringify({ at: new Date().toISOString(), ok: !out.ia.skipped, ...out.ia })); }
    catch (e) { out.ia = { error: String(e.message || e) }; await setMeta(env, 'sync_ia', JSON.stringify({ at: new Date().toISOString(), ok: false, error: out.ia.error })); }
  }
  return out;
}

// The id of the deployed version (version metadata binding). Empty in a setup without the binding: the app then shows no notice.
const version = (env) => (env.VERSION && env.VERSION.id) || '';

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

    // Which deployment is answering: an open tab compares it with the one it loaded and offers to reload.
    if (p === '/api/version' && request.method === 'GET') return json({ v: version(env) });
    if (p === '/api/data' && request.method === 'GET') {
      const m = paraVer(await modelo(env), yo);
      const sug = new Map((await env.DB.prepare('SELECT persona, clave, texto FROM sugerencias').all()).results.map((r) => [r.persona + '|' + r.clave, r.texto]));
      for (const r of m.seguimiento) r.sugerencia = sug.get(r.persona + '|' + norm(r.cuenta)) || '';
      const todo = (sql) => env.DB.prepare(sql).all().then((r) => r.results);
      const [cuentas, encuestas, materiales, cobros] = await Promise.all([todo('SELECT * FROM cuentas'), todo('SELECT * FROM encuestas ORDER BY creada DESC'), todo('SELECT * FROM materiales ORDER BY categoria, id'), todo('SELECT * FROM cobros ORDER BY id DESC')]);
      // The client book: Zoho clients with what the notes say, then what people corrected, then the US accounts from the importer's report.
      const edit = new Map(cuentas.map((c) => [c.clave, c])), CAMPOS = ['contacto', 'puesto', 'email', 'telefono', 'ciudad', 'estado', 'tipo', 'notas'];
      for (const d of m.directorio) { const e = edit.get(d.clave); if (e) for (const k of CAMPOS) if (e[k]) d[k] = e[k]; }
      // Shipments on hold for collections: shown wherever the account is listed as needing a contact.
      const pausa = (n) => { const e = edit.get(norm(n)); return e && e.pausa ? e.pausa_desde || 'si' : ''; };
      for (const r of m.seguimiento) r.pausa = pausa(r.cuenta);
      for (const c of m.cobertura) c.pausa = pausa(c.cliente);
      for (const d of m.directorio) d.pausa = pausa(d.nombre);
      // Accounts created in Spark that are not Zoho clients yet.
      const yaEsta = new Set(m.directorio.map((d) => d.clave)), zn = new Map(zonasCfg.zonas.map((z) => [z.zona, z.nombre]));
      for (const c of cuentas.filter((x) => x.origen === 'app' && !yaEsta.has(x.clave))) m.directorio.push({ clave: c.clave, nombre: c.nombre, pais: 'México', zona: c.zona, zona_nombre: zn.get(c.zona) || 'Sin zona', vendedor: c.vendedor || '',
        tipo: c.tipo, contacto: c.contacto, puesto: c.puesto, email: c.email, telefono: c.telefono, ciudad: c.ciudad, estado: c.estado, notas: c.notas, vendido: 0, prospecto: true, ultimo_contacto: '' });
      for (const u of usa.cuentas) { const clave = norm(u.nombre), e = edit.get(clave) || {}; m.directorio.push({ clave, nombre: u.nombre, pais: 'Estados Unidos', zona: 'usa', zona_nombre: 'Estados Unidos · ' + u.estado, vendedor: 'Eric (La Competencia)', tipo: e.tipo || u.tipo,
        contacto: e.contacto || '', puesto: e.puesto || '', email: e.email || '', telefono: e.telefono || '', ciudad: e.ciudad || u.ciudad, estado: e.estado || u.estado, notas: e.notas || `${u.cajas} cajas en 2026 · ${u.vinos.join(', ')} · rep. ${u.rep}`, direccion: u.direccion, cajas: u.cajas, ultimo_mes: u.ultimo_mes }); }
      // Strategy and promotions: admins see everything, the team only what was marked visible.
      const ve = yo.admin ? '' : ' WHERE visible = 1';
      m.estrategia = await todo('SELECT * FROM estrategia' + ve + ' ORDER BY tipo DESC, id DESC'); m.promociones = await todo('SELECT * FROM promociones' + ve + ' ORDER BY inicio DESC, id DESC');
      m.cuentas = cuentas; m.encuestas = encuestas; m.encuesta_base = env.SURVEY_ORIGIN || 'https://spark-equipo.dos-buhos.workers.dev';
      m.materiales = materiales; m.usa_envios = usa.envios; m.prosp_carlos = prospCarlos; m.presupuesto = presupuesto;
      // Receivables: Carlos's file (a dated snapshot, since the Zoho token can't read invoices) plus the follow-up notes made here.
      const deZoho = m.por_cobrar; delete m.por_cobrar;
      const nota = new Map(cobranzaArchivo.facturas.filter((f) => f.comentario).map((f) => [norm(f.cliente), f.comentario]));
      if (deZoho) m.cobranza = { fuente: 'zoho', corte: m.hoy, facturas: deZoho.map((f) => ({ ...f, comentario: nota.get(norm(f.cliente)) || '', dias: diff(f.vence, m.hoy) })), gestiones: cobros };
      else m.cobranza = { fuente: 'archivo', corte: cobranzaArchivo.corte, facturas: cobranzaArchivo.facturas.map((f) => ({ ...f, dias: /^\d{4}-\d\d-\d\d$/.test(f.vence) ? diff(f.vence, m.hoy) : null })), gestiones: cobros };
      // Which invoices are a bookkeeping gap and not debt to chase: sales to "Público en general" and the export account (a
      // pattern over the client name, kept in the database because it names accounts), and balances on orders older than a
      // cut-off date (kept there too). Each receivable is marked here, once; the screens count the marked ones apart.
      const cc = Object.fromEntries((await env.DB.prepare("SELECT k, v FROM meta WHERE k IN ('cobranza_conciliar', 'cobranza_conciliar_antes')").all()).results.map((r) => [r.k, r.v]));
      const esConc = conciliador(cc.cobranza_conciliar, cc.cobranza_conciliar_antes);
      for (const f of m.cobranza.facturas) f.conciliar = esConc(f);
      if (cc.cobranza_conciliar) m.cobranza.conciliar = cc.cobranza_conciliar;   // older tabs still read the pattern
      if (cc.cobranza_conciliar_antes) m.cobranza.conciliar_antes = cc.cobranza_conciliar_antes;
      // The 90-day plan and event requests. Plan drafts are the owner's until he publishes them.
      m.plan = await todo('SELECT * FROM compromisos' + (yo.dueno ? '' : ' WHERE visible = 1') + ' ORDER BY fecha, orden, id');
      m.eventos = await todo('SELECT * FROM eventos ORDER BY fecha DESC, id DESC');
      m.reglas = { plan_gente: PLAN_GENTE, evento_tope: EVENTO_TOPE, botella_muestra: BOTELLA_MUESTRA, aplica_ajuste: APLICA_AJUSTE };
      // Month-end closes of the 48-hour rule: everyone sees them, with the late contacts behind each figure.
      m.cierres = (await todo('SELECT * FROM cierres ORDER BY mes DESC, persona')).map((c) => { let d = []; try { d = JSON.parse(c.detalle); } catch { d = []; } return { ...c, detalle: d }; });
      // The Monday review: its numbers and each person's review points are kept in the database (they name accounts).
      // The owner sees it as a draft; the team sees it once at least one commitment of the plan is published.
      const lcfg = await env.DB.prepare("SELECT v FROM meta WHERE k = 'lunes_cfg'").first();
      if (lcfg) { const pub = (await env.DB.prepare('SELECT COUNT(*) AS n FROM compromisos WHERE visible = 1').first()).n > 0;
        if (yo.dueno || pub) { try { m.lunes = { ...JSON.parse(lcfg.v), publicado: pub }; } catch { /* a broken config hides the screen */ } } }
      // Promotions with per-account targets: what each account has ordered in the period and whether it owes past due.
      for (const pr of m.promociones) {
        let M = null; try { M = pr.metas ? JSON.parse(pr.metas) : null; } catch { M = null; }
        delete pr.metas;
        if (!Array.isArray(M) || !pr.inicio || !pr.fin) continue;
        const ped = (await env.DB.prepare("SELECT cliente, SUM(total) t, COUNT(*) n FROM orders WHERE fecha BETWEEN ? AND ? AND estado NOT IN ('void','draft') GROUP BY cliente").bind(pr.inicio, pr.fin).all()).results;
        const lleva = new Map(ped.map((r) => [norm(r.cliente), r])), dueno = new Map(m.clientes.map((c) => [norm(c.cliente), c.vendedor]));
        pr.avance = M.map((x) => { const K = (x.clientes || [x.cuenta]).map(norm), de = (f) => K.reduce((t, k) => t + ((lleva.get(k) || {})[f] || 0), 0);
          const venc = (m.cobranza.facturas || []).filter((f) => K.includes(norm(f.cliente)) && (f.dias || 0) > 0 && !f.conciliar).reduce((t, f) => t + (f.saldo || 0), 0);
          return { cuenta: x.cuenta, vendedor: K.map((k) => dueno.get(k)).find(Boolean) || '', base: x.base, objetivo: x.objetivo, lleva: Math.round(de('t')), pedidos: de('n'), vencido: Math.round(venc) }; });
      }
      m.preguntas = (await env.DB.prepare('SELECT * FROM preguntas ORDER BY respondida != \'\', id DESC').all()).results;
      m.hechos = (await env.DB.prepare('SELECT clave FROM buzon_hechos WHERE email = ?').bind(yo.email).all()).results.map((r) => r.clave);   // inbox notes this person marked done
      const meta = (await env.DB.prepare("SELECT k, v FROM meta WHERE k LIKE 'sync_%'").all()).results;
      return json({ ...m, v: version(env), sync: Object.fromEntries(meta.map((r) => [r.k.slice(5), JSON.parse(r.v)])) });
    }
    // Original document of a promotion. The team only reaches files of promotions marked visible.
    if (p.startsWith('/api/archivo/') && request.method === 'GET') {
      const id = Number(p.split('/')[3]) || 0;
      const f = await env.DB.prepare('SELECT a.nombre, a.mime, a.datos, (SELECT MAX(visible) FROM promociones WHERE archivo_id = a.id) AS visible FROM archivos a WHERE a.id = ?').bind(id).first();
      if (!f || (!yo.admin && !f.visible)) return json({ error: 'No existe ese documento' }, 404);
      return new Response(new Uint8Array(f.datos), { headers: { 'content-type': f.mime, 'content-disposition': `inline; filename="${f.nombre.replace(/[^\w. -]/g, '_')}"`, 'cache-control': 'private, max-age=300' } });
    }
    const cuerpo = async () => request.json().catch(() => ({})), txt = (v, n = 300) => String(v ?? '').trim().slice(0, n), HOY = hoyEn(env.TZ);
    const quienEs = (b) => (yo.admin && PERSONAS.includes(b.persona) ? b.persona : yo.persona);
    // A contact logged in the app. Kept apart from the sheet copy (origen 'app'), so a sheet sync never removes it.
    if (p === '/api/actividad' && request.method === 'POST') {
      const b = await cuerpo(), persona = quienEs(b);
      if (!persona) return json({ error: 'Elige a nombre de quién se registra' }, 400);
      if (!txt(b.cuenta) || !txt(b.resultado, 2000)) return json({ error: 'Faltan la cuenta y lo que pasó' }, 400);
      const fecha = /^\d{4}-\d\d-\d\d$/.test(b.fecha || '') && b.fecha <= HOY ? b.fecha : HOY, prox = /^\d{4}-\d\d-\d\d$/.test(b.proximo || '') ? b.proximo : '';
      await env.DB.prepare("INSERT INTO activity (persona, fecha, zona, cuenta, tipo, actividad, medio, etapa, contacto, telefono, resultado, siguiente_paso, proximo, minutos, botellas_mes, registrado, origen) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'app')")
        .bind(persona, fecha, txt(b.zona, 40), txt(b.cuenta, 120), txt(b.tipo, 40), txt(b.actividad, 40) || 'Seguimiento', txt(b.medio, 40), txt(b.etapa, 40), txt(b.contacto, 120), txt(b.telefono, 120), txt(b.resultado, 2000), txt(b.siguiente_paso, 500), prox,
          Number(b.minutos) > 0 ? Math.min(600, Math.round(Number(b.minutos))) : null, Number(b.botellas_mes) > 0 ? Math.round(Number(b.botellas_mes)) : null, HOY).run();
      if (b.pausa === 'si' || b.pausa === 'no') await ponPausa(env, txt(b.cuenta, 120), b.pausa === 'si', HOY, yo.nombre || yo.email);
      return json({ ok: true });
    }
    // Time a contact really took (corrects the estimate).
    if (p === '/api/tiempo' && request.method === 'POST') {
      const b = await cuerpo(), persona = yo.admin && PERSONAS.includes(b.persona) ? b.persona : yo.persona, min = Math.round(Number(b.minutos));
      if (!persona || (!yo.admin && b.persona && b.persona !== yo.persona)) return json({ error: 'Solo puedes corregir tus propios contactos' }, 403);
      if (!(min > 0 && min <= 600) || !/^\d{4}-\d\d-\d\d$/.test(b.fecha || '') || !txt(b.cuenta)) return json({ error: 'Pon los minutos (1 a 600)' }, 400);
      await env.DB.prepare('INSERT INTO tiempos (persona, fecha, clave, actividad, minutos) VALUES (?,?,?,?,?) ON CONFLICT(persona, fecha, clave, actividad) DO UPDATE SET minutos = excluded.minutos').bind(persona, b.fecha, norm(b.cuenta), txt(b.actividad, 40), min).run();
      await env.DB.prepare("UPDATE activity SET minutos = ? WHERE origen = 'app' AND persona = ? AND fecha = ? AND cuenta = ? AND actividad = ?").bind(min, persona, b.fecha, txt(b.cuenta, 120), txt(b.actividad, 40)).run();
      return json({ ok: true });
    }
    // What someone adds or corrects about an account (contact details, by-the-glass, stage).
    // A new account: a prospect that is not in Zoho yet. Needs a name, a zone and a way to reach someone there.
    if (p === '/api/cuenta/nueva' && request.method === 'POST') {
      const b = await cuerpo(), nombre = txt(b.nombre, 160), persona = quienEs(b) || (yo.admin ? CASA : null);
      if (!nombre) return json({ error: 'Falta el nombre de la cuenta' }, 400);
      if (!zonasCfg.zonas.some((z) => z.zona === b.zona)) return json({ error: 'Elige la zona' }, 400);
      if (!txt(b.telefono) && !txt(b.email)) return json({ error: 'Pon al menos un teléfono o un correo del contacto' }, 400);
      const ya = await env.DB.prepare('SELECT nombre FROM cuentas WHERE clave = ?').bind(norm(nombre)).first();
      if (ya) return json({ error: `Ya existe la cuenta "${ya.nombre}". Elígela de la lista.` }, 409);
      await env.DB.prepare(`INSERT INTO cuentas (clave, nombre, contacto, puesto, email, telefono, ciudad, estado, tipo, notas, zona, vendedor, origen, creado, actualizado, por) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'app',?,?,?)`)
        .bind(norm(nombre), nombre, txt(b.contacto, 120), txt(b.puesto, 80), txt(b.email, 160), txt(b.telefono, 80), txt(b.ciudad, 80), txt(b.estado, 60), txt(b.tipo, 60), txt(b.notas, 1000), b.zona, persona || '', HOY, HOY, yo.nombre || yo.email).run();
      return json({ ok: true });
    }
    if (p === '/api/cuenta' && request.method === 'POST') {
      const b = await cuerpo(), nombre = txt(b.nombre, 160);
      if (!nombre) return json({ error: 'Falta el nombre de la cuenta' }, 400);
      const copeo = ['si', 'propuesto', 'no', ''].includes(b.copeo) ? b.copeo : '';
      await env.DB.prepare(`INSERT INTO cuentas (clave, nombre, contacto, puesto, email, telefono, ciudad, estado, tipo, notas, copeo, copeo_vino, fase, botellas_mes, actualizado, por) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(clave) DO UPDATE SET nombre=excluded.nombre, contacto=excluded.contacto, puesto=excluded.puesto, email=excluded.email, telefono=excluded.telefono, ciudad=excluded.ciudad, estado=excluded.estado, tipo=excluded.tipo, notas=excluded.notas,
          copeo=excluded.copeo, copeo_vino=excluded.copeo_vino, fase=excluded.fase, botellas_mes=excluded.botellas_mes, actualizado=excluded.actualizado, por=excluded.por`)
        .bind(norm(nombre), nombre, txt(b.contacto, 120), txt(b.puesto, 80), txt(b.email, 160), txt(b.telefono, 80), txt(b.ciudad, 80), txt(b.estado, 60), txt(b.tipo, 60), txt(b.notas, 1000), copeo, txt(b.copeo_vino, 120), txt(b.fase, 40),
          Number(b.botellas_mes) > 0 ? Math.round(Number(b.botellas_mes)) : null, HOY, yo.nombre || yo.email).run();
      if (b.pausa === 'si' || b.pausa === 'no') await ponPausa(env, nombre, b.pausa === 'si', HOY, yo.nombre || yo.email);
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
    if (p === '/api/buzon/hecho' && request.method === 'POST') {
      const b = await cuerpo(), clave = txt(b.clave, 200);
      if (!clave) return json({ error: 'Falta la nota' }, 400);
      if (b.deshacer) await env.DB.prepare('DELETE FROM buzon_hechos WHERE email = ? AND clave = ?').bind(yo.email, clave).run();
      else await env.DB.prepare('INSERT OR IGNORE INTO buzon_hechos (email, clave, fecha) VALUES (?,?,?)').bind(yo.email, clave, hoyEn(env.TZ)).run();
      return json({ ok: true });
    }
    if (p === '/api/preguntas/responder' && request.method === 'POST') {
      const b = await request.json().catch(() => ({})), txt = String(b.respuesta || '').trim().slice(0, 2000);
      const q = await env.DB.prepare('SELECT * FROM preguntas WHERE id = ?').bind(Number(b.id) || 0).first();
      if (!q) return json({ error: 'Esa pregunta ya no existe' }, 404);
      if (!yo.admin && q.para !== yo.persona) return json({ error: 'Esta pregunta es para ' + q.para }, 403);
      if (!txt) return json({ error: 'Escribe la respuesta' }, 400);
      await env.DB.prepare('UPDATE preguntas SET respuesta = ?, respondio = ?, respondida = ? WHERE id = ?').bind(txt, yo.email, hoyEn(env.TZ), q.id).run();
      return json({ ok: true });
    }
    // Month-end close of the 48-hour rule. Carlos applies it (or the owner): the figures of a finished month are frozen with
    // the late contacts behind them. Months before the rule adjusts pay are dry runs and can be run again; a real close stays.
    if (p === '/api/cierre' && request.method === 'POST') {
      const b = await cuerpo(), mes = String(b.mes || '');
      if (!yo.dueno && yo.persona !== APLICA_AJUSTE) return json({ error: `El ajuste lo aplica ${APLICA_AJUSTE}` }, 403);
      if (!/^\d{4}-\d\d$/.test(mes) || mes < REGLA_DESDE.slice(0, 7) || mes >= HOY.slice(0, 7)) return json({ error: 'Solo se cierra un mes que ya terminó' }, 400);
      const ensayo = mes < AJUSTE_DESDE ? 1 : 0, ya = await env.DB.prepare('SELECT ensayo FROM cierres WHERE mes = ? LIMIT 1').bind(mes).first();
      if (ya && !ya.ensayo) return json({ error: 'Ese mes ya está cerrado. Si un registro estaba mal, Dirección lo reabre.' }, 409);
      const m = await modelo(env);
      await env.DB.batch(GENTE.map((g) => { const c = cierreDe(m.contactos, g, mes);
        return env.DB.prepare('INSERT INTO cierres (mes, persona, contactos, tarde, pct, ajuste, detalle, ensayo, aplicado, aplico) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(mes, persona) DO UPDATE SET contactos = excluded.contactos, tarde = excluded.tarde, pct = excluded.pct, ajuste = excluded.ajuste, detalle = excluded.detalle, ensayo = excluded.ensayo, aplicado = excluded.aplicado, aplico = excluded.aplico')
          .bind(mes, g, c.n, c.tarde, c.pc, c.ajuste, JSON.stringify(c.tardios), ensayo, HOY, yo.nombre || yo.email); }));
      return json({ ok: true, ensayo: !!ensayo });
    }
    // The plan: whoever owns a commitment (or an admin) marks it done, with a note on what was delivered and where it shows.
    if (p === '/api/plan/hecho' && request.method === 'POST') {
      const b = await cuerpo(), c = await env.DB.prepare('SELECT * FROM compromisos WHERE id = ?').bind(Number(b.id) || 0).first();
      if (!c || (!c.visible && !yo.dueno)) return json({ error: 'No existe ese compromiso' }, 404);
      if (!yo.admin && c.persona !== yo.persona) return json({ error: 'Este compromiso es de ' + c.persona }, 403);
      if (b.deshacer) await env.DB.prepare("UPDATE compromisos SET estado = 'pendiente', hecho_fecha = '', hecho_por = '' WHERE id = ?").bind(c.id).run();
      else {
        if (!txt(b.nota, 1000)) return json({ error: 'Escribe qué quedó hecho y dónde se ve' }, 400);
        await env.DB.prepare("UPDATE compromisos SET estado = 'hecho', hecho_fecha = ?, hecho_por = ?, nota = ? WHERE id = ?").bind(HOY, yo.nombre || yo.email, txt(b.nota, 1000), c.id).run();
      }
      return json({ ok: true });
    }
    // Events: anyone on the team asks for one with its numbers; whoever asked (or an admin) closes it with what came out of it.
    if (p === '/api/eventos' && request.method === 'POST') {
      const b = await cuerpo(), n = (v) => Math.max(0, Math.round(Number(v) || 0)), fecha = /^\d{4}-\d\d-\d\d$/.test(b.fecha || '') ? b.fecha : '';
      if (b.cerrar) {
        const e = await env.DB.prepare('SELECT * FROM eventos WHERE id = ?').bind(Number(b.cerrar) || 0).first();
        if (!e) return json({ error: 'No existe ese evento' }, 404);
        if (!yo.admin && e.persona !== yo.persona) return json({ error: 'Este evento lo pidió ' + e.persona }, 403);
        if (!['aprobado', 'cerrado'].includes(e.estado)) return json({ error: 'Solo se cierra un evento autorizado' }, 400);
        if (!txt(b.reporte, 2000)) return json({ error: 'Escribe qué pasó y qué sigue' }, 400);
        await env.DB.prepare("UPDATE eventos SET estado = 'cerrado', contactos = ?, cuentas_nuevas = ?, botellas_usadas = ?, venta_real = ?, reporte = ?, cerrado = ? WHERE id = ?")
          .bind(n(b.contactos), n(b.cuentas_nuevas), n(b.botellas_usadas), n(b.venta_real), txt(b.reporte, 2000), e.cerrado || HOY, e.id).run();
        return json({ ok: true });
      }
      if (!txt(b.nombre) || !fecha || !txt(b.objetivo, 1000)) return json({ error: 'Faltan el nombre, la fecha y para qué vamos' }, 400);
      await env.DB.prepare('INSERT INTO eventos (persona, nombre, tipo, lugar, fecha, objetivo, cuentas_objetivo, distribuidor, costo, botellas, venta_esperada, estado, creado, por) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .bind(quienEs(b) || yo.nombre || yo.email, txt(b.nombre, 160), txt(b.tipo, 60), txt(b.lugar, 120), fecha, txt(b.objetivo, 1000), txt(b.cuentas_objetivo, 1000), txt(b.distribuidor, 120), n(b.costo), n(b.botellas), n(b.venta_esperada), 'solicitado', HOY, yo.nombre || yo.email).run();
      return json({ ok: true });
    }
    // Everything below is for admins. The 404 comes after the team routes above: placed earlier, it made them unreachable.
    if (!p.startsWith('/api/admin/')) return json({ error: 'No existe' }, 404);
    if (!yo.admin) return json({ error: 'Solo administradores' }, 403);
    // Monday review: the numbers Spark cannot compute yet are typed in by an admin during the review.
    if (p === '/api/admin/lunes' && request.method === 'POST') {
      const b = await cuerpo(), row = await env.DB.prepare("SELECT v FROM meta WHERE k = 'lunes_cfg'").first();
      let cfg = null; try { cfg = row ? JSON.parse(row.v) : null; } catch { cfg = null; }
      const n = cfg && (cfg.numeros || []).find((x) => x.clave === b.clave && x.tipo === 'manual');
      if (!n) return json({ error: 'Ese número no se captura a mano' }, 400);
      n.valor = Math.max(0, Math.round(Number(b.valor) || 0)); n.actualizado = HOY; n.por = yo.nombre || yo.email;
      await env.DB.prepare("UPDATE meta SET v = ? WHERE k = 'lunes_cfg'").bind(JSON.stringify(cfg)).run();
      return json({ ok: true });
    }
    // Deciding on an event. Up to EVENTO_TOPE (money plus wine) any admin decides; above it, only the owner.
    if (p === '/api/admin/eventos' && request.method === 'POST') {
      const b = await cuerpo(), e = await env.DB.prepare('SELECT * FROM eventos WHERE id = ?').bind(Number(b.id) || 0).first(), n = (v, d) => Math.max(0, Math.round(Number(v === '' || v == null ? d : v) || 0));
      if (!e) return json({ error: 'No existe ese evento' }, 404);
      if (b.borrar) { await env.DB.prepare('DELETE FROM eventos WHERE id = ?').bind(e.id).run(); return json({ ok: true }); }
      if (e.costo + e.botellas * BOTELLA_MUESTRA > EVENTO_TOPE && !yo.dueno) return json({ error: 'Con el vino pasa de $' + EVENTO_TOPE.toLocaleString('en-US') + ': lo decide Dirección' }, 403);
      const si = b.decision === 'aprobado';
      if (!si && !txt(b.nota, 600)) return json({ error: 'Escribe por qué no' }, 400);
      await env.DB.prepare('UPDATE eventos SET estado = ?, decidio = ?, decidido = ?, nota_decision = ?, botellas_aprobadas = ?, costo_aprobado = ? WHERE id = ?')
        .bind(si ? 'aprobado' : 'rechazado', yo.nombre || yo.email, HOY, txt(b.nota, 600), si ? n(b.botellas_aprobadas, e.botellas) : 0, si ? n(b.costo_aprobado, e.costo) : 0, e.id).run();
      return json({ ok: true });
    }
    // The plan itself (add, change, show to the team, remove) belongs to the owner.
    if (p === '/api/admin/plan' && request.method === 'POST') {
      if (!yo.dueno) return json({ error: 'Solo Eric cambia el plan' }, 403);
      const b = await cuerpo(), fecha = /^\d{4}-\d\d-\d\d$/.test(b.fecha || '') ? b.fecha : '';
      if (b.borrar) { await env.DB.prepare('DELETE FROM compromisos WHERE id = ?').bind(Number(b.borrar) || 0).run(); return json({ ok: true }); }
      // Showing a commitment to the team is done one at a time, by id: there is no bulk switch for the whole plan.
      if (b.publicar) {
        if (typeof b.publicar !== 'number') return json({ error: 'Se muestra un compromiso a la vez' }, 400);
        await env.DB.prepare('UPDATE compromisos SET visible = ? WHERE id = ?').bind(b.ocultar ? 0 : 1, b.publicar).run();
        return json({ ok: true });
      }
      if (!PLAN_GENTE.includes(b.persona) || !txt(b.titulo) || !fecha) return json({ error: 'Faltan la persona, el compromiso y la fecha' }, 400);
      if (b.id) await env.DB.prepare('UPDATE compromisos SET persona = ?, titulo = ?, medida = ?, fecha = ?, etapa = ? WHERE id = ?').bind(b.persona, txt(b.titulo, 300), txt(b.medida, 400), fecha, txt(b.etapa, 40), Number(b.id)).run();
      else await env.DB.prepare('INSERT INTO compromisos (persona, titulo, medida, fecha, etapa, visible, origen, creado, por) VALUES (?,?,?,?,?,?,?,?,?)').bind(b.persona, txt(b.titulo, 300), txt(b.medida, 400), fecha, txt(b.etapa, 40), b.visible === 'si' ? 1 : 0, 'Spark', HOY, yo.nombre || yo.email).run();
      return json({ ok: true });
    }

    // Order detail from Zoho (lines, reference, addresses, invoice status), for the owner's reviews. Up to 15 orders per call.
    if (p === '/api/admin/pedidos' && request.method === 'GET') {
      if (!(yo.dueno || (env.ADMIN_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).includes(yo.email))) return json({ error: 'Solo Dirección' }, 403);
      const ids = (new URL(request.url).searchParams.get('ids') || '').split(',').filter((x) => /^\d+$/.test(x)).slice(0, 15), out = [];
      for (const id of ids) { try { out.push(await env.ZOHO.order(id)); } catch (e) { out.push({ id, error: String(e && e.message || e) }); } }
      return json({ pedidos: out });
    }
    // Sales mailboxes, read-only, for the owner only (Hub admin or ADMIN_EMAILS), not for every Spark admin.
    if (p === '/api/admin/correo' && request.method === 'GET') {
      const dueno = yo.dueno || (env.ADMIN_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).includes(yo.email);
      if (!dueno) return json({ error: 'Solo Dirección' }, 403);
      const u = new URL(request.url).searchParams;
      try {
        if (u.get('hilo')) return json({ hilo: await env.GMAIL.thread(u.get('buzon'), u.get('hilo')) });
        return json(await env.GMAIL.list(u.get('buzon'), u.get('q') || '', u.get('pagina') || '', 40));
      } catch (e) { return json({ error: String(e && e.message || e) }, 502); }
    }
    if (p === '/api/admin/preguntas' && request.method === 'POST') {
      const b = await request.json().catch(() => ({}));
      if (b.borrar) { await env.DB.prepare('DELETE FROM preguntas WHERE id = ?').bind(Number(b.borrar) || 0).run(); return json({ ok: true }); }
      if (b.reabrir_cierre) { if (!yo.dueno) return json({ error: 'Solo Dirección reabre un cierre' }, 403); await env.DB.prepare('DELETE FROM cierres WHERE mes = ?').bind(String(b.reabrir_cierre)).run(); return json({ ok: true }); }
      if (b.reabrir) { await env.DB.prepare("UPDATE preguntas SET respondida = '' WHERE id = ?").bind(Number(b.reabrir) || 0).run(); return json({ ok: true }); }
      const txt = String(b.texto || '').trim().slice(0, 1000);
      if (!GENTE.includes(b.para) || !txt) return json({ error: 'Elige para quién es y escribe la pregunta' }, 400);
      await env.DB.prepare('INSERT INTO preguntas (para, texto, creada, creada_por, fecha) VALUES (?,?,?,?,?)').bind(b.para, txt, hoyEn(env.TZ), yo.nombre || yo.email, /^\d{4}-\d\d-\d\d$/.test(b.fecha || '') ? b.fecha : '').run();
      return json({ ok: true });
    }
    if ((p === '/api/admin/estrategia' || p === '/api/admin/promociones') && request.method === 'POST') {
      const b = await cuerpo(), T = p.endsWith('estrategia') ? 'estrategia' : 'promociones', fecha = (v) => (/^\d{4}-\d\d-\d\d$/.test(v || '') ? v : '');
      if (b.borrar) { if (T === 'promociones') await env.DB.prepare('DELETE FROM archivos WHERE id = (SELECT archivo_id FROM promociones WHERE id = ?)').bind(Number(b.borrar) || 0).run();
        await env.DB.prepare(`DELETE FROM ${T} WHERE id = ?`).bind(Number(b.borrar) || 0).run(); return json({ ok: true }); }
      if (b.visible_id) { await env.DB.prepare(`UPDATE ${T} SET visible = ? WHERE id = ?`).bind(b.visible ? 1 : 0, Number(b.visible_id) || 0).run(); return json({ ok: true }); }
      // An attached original: base64 from the form, stored as a blob. D1 holds up to 2 MB per value.
      const guardaArchivo = async (f) => {
        if (!f || !f.b64) return null;
        if (!['application/pdf', 'image/png', 'image/jpeg'].includes(f.mime)) throw new Error('El documento debe ser PDF, PNG o JPG');
        const bin = Uint8Array.from(atob(f.b64), (ch) => ch.charCodeAt(0));
        if (bin.length > 1500000) throw new Error('El documento pesa más de 1.5 MB; redúcelo y vuelve a subirlo');
        const r = await env.DB.prepare('INSERT INTO archivos (nombre, mime, datos, bytes, creado, por) VALUES (?,?,?,?,?,?)').bind(txt(f.nombre, 160) || 'documento', f.mime, bin, bin.length, HOY, yo.nombre || yo.email).run();
        return { id: r.meta.last_row_id, nombre: txt(f.nombre, 160) || 'documento' };
      };
      if (T === 'promociones' && b.archivo_para) {
        let a; try { a = await guardaArchivo(b.archivo); } catch (e) { return json({ error: e.message }, 400); }
        if (!a) return json({ error: 'Elige el documento' }, 400);
        const antes = await env.DB.prepare('SELECT archivo_id FROM promociones WHERE id = ?').bind(Number(b.archivo_para) || 0).first();
        await env.DB.prepare('UPDATE promociones SET archivo_id = ?, archivo_nombre = ? WHERE id = ?').bind(a.id, a.nombre, Number(b.archivo_para) || 0).run();
        if (antes && antes.archivo_id) await env.DB.prepare('DELETE FROM archivos WHERE id = ?').bind(antes.archivo_id).run();
        return json({ ok: true });
      }
      if (T === 'estrategia') {
        if (!txt(b.titulo) || (b.url && !/^https:\/\//.test(b.url))) return json({ error: 'Pon un título; la liga, si hay, debe empezar con https://' }, 400);
        await env.DB.prepare('INSERT INTO estrategia (tipo, titulo, url, nota, anio, visible, creado, por) VALUES (?,?,?,?,?,?,?,?)').bind(b.tipo === 'meta' ? 'meta' : 'documento', txt(b.titulo, 200), txt(b.url, 600), txt(b.nota, 2000), Number(b.anio) || Number(HOY.slice(0, 4)), b.visible === 'si' ? 1 : 0, HOY, yo.nombre || yo.email).run();
      } else {
        if (!txt(b.nombre)) return json({ error: 'Falta el nombre de la promoción' }, 400);
        let a; try { a = await guardaArchivo(b.archivo); } catch (e) { return json({ error: e.message }, 400); }
        await env.DB.prepare('INSERT INTO promociones (nombre, resumen, detalle, aplica, inicio, fin, autorizo, autorizada, visible, creado, por, archivo_id, archivo_nombre) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(txt(b.nombre, 200), txt(b.resumen, 400), txt(b.detalle, 5000), txt(b.aplica, 200), fecha(b.inicio), fecha(b.fin), txt(b.autorizo, 80), fecha(b.autorizada), b.visible === 'no' ? 0 : 1, HOY, yo.nombre || yo.email, a ? a.id : null, a ? a.nombre : '').run();
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
    // Credit an order (or a whole account) to someone else, or put it back the way Zoho has it.
    if (p === '/api/admin/asignar' && request.method === 'POST') {
      const b = await cuerpo(), tipo = b.tipo === 'cuenta' ? 'cuenta' : 'orden', clave = txt(b.clave, 160);
      if (!clave) return json({ error: 'Falta la orden o la cuenta' }, 400);
      if (!b.vendedor) await env.DB.prepare('DELETE FROM asignaciones WHERE tipo = ? AND clave = ?').bind(tipo, clave).run();
      else if (![...VENDEDORES, CASA].includes(b.vendedor)) return json({ error: 'Elige a quién se le acredita' }, 400);
      else await env.DB.prepare('INSERT INTO asignaciones (tipo, clave, vendedor, nota, por, creado) VALUES (?,?,?,?,?,?) ON CONFLICT(tipo, clave) DO UPDATE SET vendedor = excluded.vendedor, nota = excluded.nota, por = excluded.por, creado = excluded.creado')
        .bind(tipo, clave, b.vendedor, txt(b.nota, 300), yo.nombre || yo.email, HOY).run();
      return json({ ok: true });
    }
    if (p === '/api/admin/people' && request.method === 'GET') return json({ people: (await env.DB.prepare('SELECT * FROM people ORDER BY persona, email').all()).results, gente: PERSONAS, correo_hoja: await sheetEmail(env).catch(() => '') });
    if (p === '/api/admin/people' && request.method === 'POST') {
      const b = await request.json().catch(() => ({}));
      const email = String(b.email || '').trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'Correo inválido' }, 400);
      if (b.borrar) { await env.DB.prepare('DELETE FROM people WHERE email = ?').bind(email).run(); return json({ ok: true }); }
      const rol = b.rol === 'admin' ? 'admin' : 'rep', persona = PERSONAS.includes(b.persona) ? b.persona : null;
      if (rol === 'rep' && !persona) return json({ error: 'Elige a quién corresponde' }, 400);
      await env.DB.prepare('INSERT INTO people (email, persona, rol) VALUES (?,?,?) ON CONFLICT(email) DO UPDATE SET persona=excluded.persona, rol=excluded.rol').bind(email, persona, rol).run();
      return json({ ok: true });
    }
    return json({ error: 'No existe' }, 404);
  },

  // The CRM sheet is read every hour from 6:00 to 21:00 in San Miguel (12:00 to 03:00 UTC), so a contact is dated the day
  // it was typed. 6:00: sheet, Zoho and suggestions. Noon and 6 pm: the same. The other hours: the sheet only.
  async scheduled(event, env, ctx) {
    // The noon and 6 pm runs also continue the suggestions (sync writes them whenever `what` is empty or 'ia').
    const c = event.cron;
    ctx.waitUntil(c === '0 12 * * *' ? sync(env, null, { primera: true }) : c === '0 18 * * *' || c === '0 0 * * *' ? sync(env, null) : sync(env, 'hoja'));
  }
};

// Marks or clears "shipments on hold for collections" on an account without touching the rest of its record.
// The date it was first put on hold is kept while it stays on hold.
async function ponPausa(env, nombre, si, hoy, por) {
  await env.DB.prepare(`INSERT INTO cuentas (clave, nombre, pausa, pausa_desde, actualizado, por) VALUES (?,?,?,?,?,?)
    ON CONFLICT(clave) DO UPDATE SET pausa_desde = CASE WHEN excluded.pausa = '' THEN '' WHEN cuentas.pausa = '' THEN excluded.pausa_desde ELSE cuentas.pausa_desde END,
      pausa = excluded.pausa, actualizado = excluded.actualizado, por = excluded.por`)
    .bind(norm(nombre), nombre, si ? 'cobranza' : '', si ? hoy : '', hoy, por).run();
}
