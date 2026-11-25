// Arqueo — the physical count of Almacén 1, reconciled against Zoho.
// The rule the app exists for: nobody pulls bottles for an orden de venta without counting the whole SKU they touched.
// Zoho is read-only here (src/zoho.js, through the Muestras Worker). Corrections leave as a list administración keys in.
import { hubUser } from './hub-auth.js';
import { withHubSecret } from './hub-secret.js';
import { total, semaforo, revisa, rotacion, diasEntre, MOTIVOS } from './conteo.js';
import * as Z from './zoho.js';

const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const mal = (msg, status = 400) => json({ error: msg }, status);
const lista = (s) => (s || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
const txt = (v, max = 400) => String(v ?? '').trim().slice(0, max);
const ent = (v) => Math.trunc(Number(v) || 0);
const ahora = () => new Date().toISOString();
const hoyEn = (tz) => new Date().toLocaleDateString('en-CA', { timeZone: tz || 'America/Mexico_City' });
const all = (env, sql, ...b) => env.DB.prepare(sql).bind(...b).all().then((r) => r.results);
const one = (env, sql, ...b) => env.DB.prepare(sql).bind(...b).first();

const DESTINOS = ['Barra', 'Restaurante', 'Almacén 2', 'Tienda', 'Bodega CDMX', 'Evento', 'Otro'];
const MERMAS = ['rotura', 'corcho', 'etiqueta', 'mal estado', 'otro'];
const ORIGENES = ['cliente', 'consigna', 'restaurante', 'otro'];
// Movement types a person may record by hand. salida_ov and ajuste_conteo are written by the surtido flow only.
const MANUALES = { traspaso: -1, entrada: 1, devolucion: 1, merma: -1, muestra: -1 };

// Who is asking. Fails closed: without the Hub's signature nothing is served (the workers.dev address is public).
async function quien(request, env) {
  let who = null;
  if (env.ENVIRONMENT === 'dev' && env.DEV_USER) who = { email: env.DEV_USER, name: env.DEV_NAME || 'Dev', hubAdmin: env.DEV_ADMIN === '1' };
  else if (env.HUB_SECRET) who = await hubUser(request, env);
  if (!who) return null;
  const email = who.email.toLowerCase();
  const admin = !!who.hubAdmin || lista(env.ADMIN_EMAILS).includes(email);
  const almacen = admin || lista(env.ALMACEN_EMAILS).includes(email);
  return { email, nombre: who.name || email, admin, almacen };
}

async function ajustesApp(env) {
  const rows = await all(env, 'SELECT clave, valor FROM ajustes_app');
  const o = {};
  for (const r of rows) o[r.clave] = r.valor;
  return { base_cerrada: o.base_cerrada === '1', ambar: Number(o.tol_ambar || 1), rojo: Number(o.tol_rojo || 6), pct: Number(o.tol_pct || 2),
    dias_rotacion: Number(o.dias_rotacion || 45), dias_rotacion_top: Number(o.dias_rotacion_top || 30) };
}

// The SKU mirror with its balance, Zoho's number and how long since it was counted.
// `saldo` is left out for an almacenista: a visible expectation turns a count into a confirmation.
async function skus(env, verSaldos = true) {
  const rows = await all(env, `SELECT s.*, COALESCE(v.botellas, 0) AS saldo, p.codigo AS posicion,
      (SELECT COUNT(*) FROM (SELECT l.variacion FROM conteo_linea l JOIN conteo c ON c.id = l.conteo_id
         WHERE l.item_id = s.item_id AND c.estado = 'cerrado' ORDER BY l.id DESC LIMIT 2) x WHERE x.variacion <> 0) AS variaciones_seguidas
    FROM sku s LEFT JOIN saldo v ON v.item_id = s.item_id LEFT JOIN posicion p ON p.id = s.posicion_id
    ORDER BY s.nombre`);
  return rows.map((r) => ({ ...r, activo: !!r.activo, saldo: verSaldos ? r.saldo : null, zoho_stock: verSaldos ? r.zoho_stock : null }));
}

// Refresh the SKU mirror and store today's Zoho figures. New SKUs arrive with a case size of 12, editable afterwards.
async function sincroniza(env) {
  const its = await Z.items(env);
  if (!its.length) return { skus: 0 };
  const hoy = hoyEn(env.TZ), at = ahora(), db = env.DB;
  const ops = [];
  for (const i of its) {
    ops.push(db.prepare(`INSERT INTO sku (item_id, sku, nombre, activo, zoho_stock, zoho_at) VALUES (?,?,?,1,?,?)
      ON CONFLICT(item_id) DO UPDATE SET sku = excluded.sku, nombre = excluded.nombre, activo = 1,
      zoho_stock = excluded.zoho_stock, zoho_at = excluded.zoho_at`).bind(i.item_id, i.sku, i.nombre, i.stock, at));
    ops.push(db.prepare('INSERT OR REPLACE INTO zoho_snapshot (fecha, item_id, stock, disponible) VALUES (?,?,?,?)')
      .bind(hoy, i.item_id, i.stock, i.disponible));
  }
  const vivos = its.map((i) => i.item_id);
  ops.push(db.prepare(`UPDATE sku SET activo = 0 WHERE item_id NOT IN (${vivos.map(() => '?').join(',')})`).bind(...vivos));
  await db.batch(ops);
  return { skus: its.length, fecha: hoy };
}

// Órdenes de venta still to pick: what Zoho has open, minus the ones already counted here.
async function pendientes(env) {
  const abiertas = await Z.ordenes(env);
  const hechas = new Set((await all(env, `SELECT ov_id FROM conteo WHERE tipo = 'surtido' AND estado IN ('abierto','cerrado')`)).map((r) => r.ov_id));
  return abiertas.filter((o) => !hechas.has(o.ov_id));
}

// A count session becomes rows in three tables and nothing else: the session, its lines, and the movements that
// explain every bottle. The balance is a view over the movements, so it can never drift from them.
async function guardaConteo(env, yo, { tipo, ov = '', ov_id = '', cliente = '', parcial = 0, lineas }) {
  const tol = await ajustesApp(env);
  const hoy = hoyEn(env.TZ), at = ahora();
  const cat = Object.fromEntries((await skus(env, true)).map((s) => [s.item_id, s]));

  // Work out every line first: nothing is written until the whole count is valid.
  const listo = [];
  for (const l of lineas || []) {
    const s = cat[String(l.item_id || '')];
    if (!s) return { error: `SKU desconocido: ${txt(l.item_id, 40)}` };
    const surtido = Math.max(0, ent(l.surtido));
    const contado = l.contado === '' || l.contado == null ? null : Math.max(0, ent(l.contado));
    if (contado === null) return { error: `Falta el conteo de ${s.nombre}` };
    const esperado = s.saldo - surtido;           // the ledger's balance once the bottles are out
    const variacion = contado - esperado;
    const nivel = semaforo(variacion, contado, tol);
    const linea = { item_id: s.item_id, nombre: s.nombre, surtido, pedido: Math.max(0, ent(l.pedido)),
      tarimas: Math.max(0, ent(l.tarimas)), cajas: Math.max(0, ent(l.cajas)), sueltas: Math.max(0, ent(l.sueltas)),
      contado, esperado, variacion, nivel, motivo: txt(l.motivo, 60), foto: txt(l.foto, 200), nota: txt(l.nota, 300) };
    linea.falta = revisa(linea, nivel);
    listo.push(linea);
  }
  if (!listo.length) return { error: 'El conteo no tiene líneas' };

  // Blind count, two passes: the counter types the number without seeing what was expected, and only once it is in does
  // the app show the difference and ask why. Nothing is written on this pass — the same counts come back with the reasons.
  const faltan = listo.filter((l) => l.falta);
  if (faltan.length) return { faltan: listo.map(({ nombre, item_id, contado, esperado, variacion, nivel, falta }) => ({ nombre, item_id, contado, esperado, variacion, nivel, falta })) };

  const c = await env.DB.prepare(`INSERT INTO conteo (tipo, ov, ov_id, cliente, estado, parcial, usuario, abierto_at, cerrado_at)
    VALUES (?,?,?,?,'cerrado',?,?,?,?) RETURNING id`).bind(tipo, ov, ov_id, cliente, parcial ? 1 : 0, yo.email, at, at).first();

  const ops = [];
  for (const l of listo) {
    ops.push(env.DB.prepare(`INSERT INTO conteo_linea (conteo_id, item_id, surtido, pedido, tarimas, cajas, sueltas, contado, esperado, variacion, motivo, foto, nota)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(c.id, l.item_id, l.surtido, l.pedido, l.tarimas, l.cajas, l.sueltas, l.contado, l.esperado, l.variacion, l.motivo, l.foto, l.nota));
    if (l.surtido > 0) ops.push(env.DB.prepare(`INSERT INTO movimiento (fecha, tipo, item_id, botellas, ov, conteo_id, usuario, creado_at)
      VALUES (?,'salida_ov',?,?,?,?,?,?)`).bind(hoy, l.item_id, -l.surtido, ov, c.id, yo.email, at));
    if (l.variacion !== 0) ops.push(env.DB.prepare(`INSERT INTO movimiento (fecha, tipo, item_id, botellas, motivo, nota, foto, conteo_id, usuario, creado_at)
      VALUES (?,'ajuste_conteo',?,?,?,?,?,?,?,?)`).bind(hoy, l.item_id, l.variacion, l.motivo, l.nota, l.foto, c.id, yo.email, at));
    ops.push(env.DB.prepare('UPDATE sku SET contado_at = ? WHERE item_id = ?').bind(hoy, l.item_id));
  }
  await env.DB.batch(ops);
  return { id: c.id, lineas: listo, rojas: listo.filter((l) => l.nivel === 'rojo').length };
}

// Arqueo against Zoho, SKU by SKU. The difference is what administración has to move in Zoho.
async function conciliacion(env) {
  const rows = await all(env, `SELECT s.item_id, s.sku, s.nombre, s.activo, s.zoho_stock, s.contado_at,
      COALESCE(v.botellas, 0) AS arqueo, v.ultimo_at
    FROM sku s LEFT JOIN saldo v ON v.item_id = s.item_id WHERE s.activo = 1 ORDER BY s.nombre`);
  const hoy = hoyEn(env.TZ);
  return rows.map((r) => ({ ...r, zoho: Math.round(Number(r.zoho_stock ?? 0)), diferencia: r.arqueo - Math.round(Number(r.zoho_stock ?? 0)),
    dias_sin_contar: diasEntre(r.contado_at, hoy) }))
    .sort((a, b) => Math.abs(b.diferencia) - Math.abs(a.diferencia));
}

async function cron(env) {
  await sincroniza(env).catch((e) => console.log('sync', String(e)));
  try {
    const abiertas = await Z.ordenes(env, 3);
    const f = await Z.fantasmas(env, abiertas);
    const at = ahora();
    if (f.length) await env.DB.batch(f.map((x) => env.DB.prepare(`INSERT INTO fantasma (ov, ov_id, cliente, fecha, botellas, factura, dias, visto_at, estado)
      VALUES (?,?,?,?,?,?,?,?, 'abierta') ON CONFLICT(ov) DO UPDATE SET botellas = excluded.botellas, factura = excluded.factura,
      dias = excluded.dias, visto_at = excluded.visto_at, estado = 'abierta'`)
      .bind(x.ov, x.ov_id, x.cliente, x.fecha, x.botellas, x.factura, x.dias, at)));
    const vivas = new Set(abiertas.map((o) => o.ov));
    const guardadas = await all(env, `SELECT ov FROM fantasma WHERE estado = 'abierta'`);
    const cerradas = guardadas.filter((g) => !vivas.has(g.ov)).map((g) => g.ov);
    if (cerradas.length) await env.DB.prepare(`UPDATE fantasma SET estado = 'cerrada' WHERE ov IN (${cerradas.map(() => '?').join(',')})`).bind(...cerradas).run();
  } catch (e) { console.log('fantasmas', String(e)); }
  // An adjustment marked "aplicado" is verified against the next snapshot: if Zoho still disagrees, it reopens.
  try {
    const pend = await all(env, `SELECT a.id, a.item_id, a.arqueo FROM ajuste a WHERE a.estado = 'aplicado'`);
    for (const a of pend) {
      const s = await one(env, 'SELECT zoho_stock FROM sku WHERE item_id = ?', a.item_id);
      const saldo = await one(env, 'SELECT COALESCE(botellas, 0) b FROM saldo WHERE item_id = ?', a.item_id);
      const ok = Math.round(Number(s?.zoho_stock ?? 0)) === Number(saldo?.b ?? 0);
      await env.DB.prepare(`UPDATE ajuste SET estado = ?, verificado_at = ? WHERE id = ?`).bind(ok ? 'verificado' : 'reabierto', ahora(), a.id).run();
    }
  } catch (e) { console.log('verifica', String(e)); }
}

export default {
  async fetch(request, rawEnv) {
    const env = await withHubSecret(rawEnv);
    const url = new URL(request.url);
    const p = url.pathname.replace(/^\/arqueo/, '') || '/';
    if (!p.startsWith('/api/')) return env.ASSETS.fetch(request);

    const yo = await quien(request, env);
    if (!yo) return mal('Entra por el Hub', 401);
    const cuerpo = request.method === 'POST' ? await request.json().catch(() => ({})) : {};
    const esc = (v) => String(v ?? '').replace(/"/g, '""');

    try {
      // ---- what the app needs to draw itself ----
      if (p === '/api/estado') {
        const [cfg, pend, rojas, aj, fan] = await Promise.all([
          ajustesApp(env),
          one(env, `SELECT COUNT(*) n FROM conteo WHERE tipo = 'surtido' AND estado = 'cerrado' AND date(cerrado_at) = date('now')`),
          one(env, `SELECT COUNT(*) n FROM conteo_linea l JOIN conteo c ON c.id = l.conteo_id WHERE l.variacion <> 0 AND l.revisado_at IS NULL`),
          one(env, `SELECT COUNT(*) n FROM ajuste WHERE estado IN ('pendiente','reabierto')`),
          one(env, `SELECT COUNT(*) n, COALESCE(SUM(botellas),0) b FROM fantasma WHERE estado = 'abierta'`),
        ]);
        return json({ yo, cfg, motivos: MOTIVOS, destinos: DESTINOS, mermas: MERMAS, origenes: ORIGENES,
          almacen: env.ALMACEN_NOMBRE, hoy: hoyEn(env.TZ), version: env.VERSION?.id || '',
          resumen: { surtidos_hoy: pend?.n || 0, variaciones_sin_revisar: rojas?.n || 0, ajustes_pendientes: aj?.n || 0,
            fantasmas: fan?.n || 0, botellas_fantasma: fan?.b || 0 } });
      }

      if (p === '/api/skus') {
        const s = await skus(env, yo.admin);
        return json({ skus: s, posiciones: await all(env, 'SELECT * FROM posicion ORDER BY orden, codigo') });
      }

      // ---- the pick queue ----
      if (p === '/api/ovs') return json({ ovs: await pendientes(env) });

      if (p.startsWith('/api/ov/')) {
        const id = p.slice('/api/ov/'.length);
        if (!/^\d+$/.test(id)) return mal('OV inválida');
        const o = await Z.orden(env, id);
        if (!o) return mal('No se pudo leer la orden en Zoho', 502);
        const cat = await skus(env, false);
        const porId = new Map(cat.map((s) => [s.item_id, s]));
        const porNombre = new Map(cat.map((s) => [s.nombre.toLowerCase(), s]));
        o.lineas = o.lineas.map((l) => {
          const s = porId.get(l.item_id) || porNombre.get((l.nombre || '').toLowerCase()) || null;
          return { ...l, item_id: s ? s.item_id : '', nombre: s ? s.nombre : l.nombre, botellas_caja: s?.botellas_caja || 12,
            cajas_tarima: s?.cajas_tarima || 0, posicion: s?.posicion || '', sin_sku: !s };
        });
        return json({ ov_id: id, ...o });
      }

      // ---- counts ----
      if (p === '/api/surtido' && request.method === 'POST') {
        if (!yo.almacen) return mal('Solo almacén y supervisores surten', 403);
        const ovId = txt(cuerpo.ov_id, 40);
        if (!/^\d+$/.test(ovId)) return mal('Falta la orden de venta');
        const ya = await one(env, `SELECT id FROM conteo WHERE ov_id = ? AND estado = 'cerrado'`, ovId);
        if (ya) return mal('Esa orden ya fue surtida', 409);
        const r = await guardaConteo(env, yo, { tipo: 'surtido', ov: txt(cuerpo.ov, 40), ov_id: ovId,
          cliente: txt(cuerpo.cliente, 120), parcial: cuerpo.parcial ? 1 : 0, lineas: cuerpo.lineas });
        return r.error ? mal(r.error) : json(r);
      }

      if (p === '/api/conteo' && request.method === 'POST') {
        if (!yo.almacen) return mal('Solo almacén y supervisores cuentan', 403);
        const tipo = ['base', 'rotacion', 'auditoria'].includes(cuerpo.tipo) ? cuerpo.tipo : 'rotacion';
        if (tipo === 'base' && !yo.admin) return mal('La línea base la cierra un supervisor', 403);
        const r = await guardaConteo(env, yo, { tipo, lineas: cuerpo.lineas });
        return r.error ? mal(r.error) : json(r);
      }

      if (p === '/api/rotacion') {
        const cfg = await ajustesApp(env);
        return json({ pendientes: rotacion(await skus(env, true), hoyEn(env.TZ), cfg).map((s) => ({ ...s, saldo: yo.admin ? s.saldo : null })) });
      }

      if (p === '/api/conteos') {
        const rows = await all(env, `SELECT c.*, (SELECT COUNT(*) FROM conteo_linea l WHERE l.conteo_id = c.id) lineas,
          (SELECT COUNT(*) FROM conteo_linea l WHERE l.conteo_id = c.id AND l.variacion <> 0) difs
          FROM conteo c WHERE c.estado = 'cerrado' ORDER BY c.id DESC LIMIT 80`);
        return json({ conteos: rows });
      }

      if (p.startsWith('/api/conteo/')) {
        const id = ent(p.slice('/api/conteo/'.length));
        const c = await one(env, 'SELECT * FROM conteo WHERE id = ?', id);
        if (!c) return mal('No existe', 404);
        return json({ conteo: c, lineas: await all(env, `SELECT l.*, s.nombre FROM conteo_linea l JOIN sku s ON s.item_id = l.item_id WHERE l.conteo_id = ? ORDER BY l.id`, id) });
      }

      // ---- variances waiting for a supervisor ----
      if (p === '/api/variaciones') {
        if (!yo.admin) return mal('Solo supervisores', 403);
        return json({ lineas: await all(env, `SELECT l.*, s.nombre, c.tipo, c.ov, c.usuario, c.cerrado_at
          FROM conteo_linea l JOIN conteo c ON c.id = l.conteo_id JOIN sku s ON s.item_id = l.item_id
          WHERE l.variacion <> 0 AND l.revisado_at IS NULL ORDER BY ABS(l.variacion) DESC LIMIT 100`) });
      }
      if (p === '/api/revisar' && request.method === 'POST') {
        if (!yo.admin) return mal('Solo supervisores', 403);
        await env.DB.prepare('UPDATE conteo_linea SET revisado_por = ?, revisado_at = ? WHERE id = ?').bind(yo.email, ahora(), ent(cuerpo.id)).run();
        return json({ ok: true });
      }

      // ---- other movements ----
      if (p === '/api/movimiento' && request.method === 'POST') {
        if (!yo.almacen) return mal('Solo almacén y supervisores registran movimientos', 403);
        const tipo = String(cuerpo.tipo || '');
        if (!MANUALES[tipo]) return mal('Tipo de movimiento inválido');
        const item = await one(env, 'SELECT item_id, nombre FROM sku WHERE item_id = ?', txt(cuerpo.item_id, 40));
        if (!item) return mal('SKU desconocido');
        const n = Math.abs(ent(cuerpo.botellas));
        if (!n) return mal('Faltan las botellas');
        if (tipo === 'traspaso' && !DESTINOS.includes(txt(cuerpo.destino, 40))) return mal('Falta el destino');
        if (tipo === 'merma' && !MERMAS.includes(txt(cuerpo.motivo, 40))) return mal('Falta el motivo de la merma');
        if (tipo === 'merma' && !txt(cuerpo.foto, 200)) return mal('Una merma necesita foto');
        await env.DB.prepare(`INSERT INTO movimiento (fecha, tipo, item_id, botellas, destino, motivo, nota, foto, usuario, creado_at)
          VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(hoyEn(env.TZ), tipo, item.item_id, n * MANUALES[tipo], txt(cuerpo.destino, 40),
          txt(cuerpo.motivo, 60), txt(cuerpo.nota, 300), txt(cuerpo.foto, 200), yo.email, ahora()).run();
        return json({ ok: true });
      }

      if (p === '/api/movimientos') {
        const rows = await all(env, `SELECT m.*, s.nombre FROM movimiento m JOIN sku s ON s.item_id = m.item_id
          ORDER BY m.id DESC LIMIT 150`);
        return json({ movimientos: rows });
      }

      // ---- positions and SKU settings ----
      if (p === '/api/posicion' && request.method === 'POST') {
        if (!yo.almacen) return mal('Solo almacén y supervisores', 403);
        const codigo = txt(cuerpo.codigo, 30);
        if (!codigo) return mal('Falta el código');
        if (cuerpo.id) await env.DB.prepare('UPDATE posicion SET codigo = ?, zona = ?, nota = ?, activa = ? WHERE id = ?')
          .bind(codigo, txt(cuerpo.zona, 40), txt(cuerpo.nota, 120), cuerpo.activa === false ? 0 : 1, ent(cuerpo.id)).run();
        else await env.DB.prepare('INSERT OR IGNORE INTO posicion (codigo, zona, nota, orden) VALUES (?,?,?,?)')
          .bind(codigo, txt(cuerpo.zona, 40), txt(cuerpo.nota, 120), ent(cuerpo.orden)).run();
        return json({ ok: true });
      }
      if (p === '/api/sku' && request.method === 'POST') {
        if (!yo.almacen) return mal('Solo almacén y supervisores', 403);
        await env.DB.prepare('UPDATE sku SET botellas_caja = ?, cajas_tarima = ?, posicion_id = ? WHERE item_id = ?')
          .bind(Math.max(1, ent(cuerpo.botellas_caja) || 12), Math.max(0, ent(cuerpo.cajas_tarima)),
            cuerpo.posicion_id ? ent(cuerpo.posicion_id) : null, txt(cuerpo.item_id, 40)).run();
        return json({ ok: true });
      }

      // ---- reconciliation and the list for administración ----
      if (p === '/api/conciliacion') {
        if (!yo.admin) return mal('Solo supervisores', 403);
        return json({ filas: await conciliacion(env), ajustes: await all(env, `SELECT a.*, s.nombre FROM ajuste a JOIN sku s ON s.item_id = a.item_id
          WHERE a.estado IN ('pendiente','reabierto') ORDER BY a.id DESC`) });
      }
      if (p === '/api/ajustes/generar' && request.method === 'POST') {
        if (!yo.admin) return mal('Solo supervisores', 403);
        const filas = (await conciliacion(env)).filter((f) => f.diferencia !== 0);
        if (!filas.length) return json({ creados: 0 });
        const at = ahora(), hoy = hoyEn(env.TZ);
        const fecha = new Date(hoy + 'T12:00:00').toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
        await env.DB.batch(filas.map((f) => env.DB.prepare(`INSERT INTO ajuste (creado_at, item_id, botellas, arqueo, zoho, descripcion)
          VALUES (?,?,?,?,?,?)`).bind(at, f.item_id, f.diferencia, f.arqueo, f.zoho, `Resultados de inventario — conteo del ${fecha} (Arqueo)`)));
        return json({ creados: filas.length });
      }
      if (p === '/api/ajuste' && request.method === 'POST') {
        if (!yo.admin) return mal('Solo supervisores', 403);
        await env.DB.prepare('UPDATE ajuste SET estado = ?, aplicado_por = ?, aplicado_at = ? WHERE id = ?')
          .bind('aplicado', yo.email, ahora(), ent(cuerpo.id)).run();
        return json({ ok: true });
      }
      if (p === '/api/ajustes.csv') {
        if (!yo.admin) return mal('Solo supervisores', 403);
        const rows = await all(env, `SELECT a.*, s.sku, s.nombre FROM ajuste a JOIN sku s ON s.item_id = a.item_id
          WHERE a.estado IN ('pendiente','reabierto') ORDER BY s.nombre`);
        const csv = ['SKU,Vino,Zoho,Arqueo,Ajuste,Descripcion']
          .concat(rows.map((r) => `"${esc(r.sku)}","${esc(r.nombre)}",${r.zoho},${r.arqueo},${r.botellas > 0 ? '+' : ''}${r.botellas},"${esc(r.descripcion)}"`)).join('\n');
        return new Response('﻿' + csv, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="ajustes-arqueo-${hoyEn(env.TZ)}.csv"` } });
      }

      // ---- phantom OVs ----
      if (p === '/api/fantasmas') {
        if (!yo.admin) return mal('Solo supervisores', 403);
        return json({ fantasmas: await all(env, `SELECT * FROM fantasma WHERE estado = 'abierta' ORDER BY botellas DESC LIMIT 200`) });
      }

      // ---- photos ----
      if (p === '/api/foto' && request.method === 'POST') {
        if (!yo.almacen) return mal('Solo almacén y supervisores', 403);
        if (!env.FOTOS) return mal('Falta el bucket de fotos', 503);
        const buf = await request.arrayBuffer();
        if (!buf.byteLength || buf.byteLength > 6_000_000) return mal('Foto vacía o muy grande');
        const key = `${hoyEn(env.TZ)}/${crypto.randomUUID()}.jpg`;
        await env.FOTOS.put(key, buf, { httpMetadata: { contentType: request.headers.get('content-type') || 'image/jpeg' } });
        return json({ foto: key });
      }
      if (p.startsWith('/api/foto/')) {
        if (!env.FOTOS) return mal('Sin fotos', 404);
        const o = await env.FOTOS.get(p.slice('/api/foto/'.length));
        if (!o) return mal('No existe', 404);
        return new Response(o.body, { headers: { 'content-type': o.httpMetadata?.contentType || 'image/jpeg', 'cache-control': 'private, max-age=86400' } });
      }

      // ---- admin ----
      if (p === '/api/sync' && request.method === 'POST') {
        if (!yo.admin) return mal('Solo supervisores', 403);
        return json(await sincroniza(env));
      }
      if (p === '/api/cfg' && request.method === 'POST') {
        if (!yo.admin) return mal('Solo supervisores', 403);
        const permitidas = ['base_cerrada', 'tol_ambar', 'tol_rojo', 'tol_pct', 'dias_rotacion', 'dias_rotacion_top'];
        const clave = txt(cuerpo.clave, 40);
        if (!permitidas.includes(clave)) return mal('Clave inválida');
        await env.DB.prepare('INSERT INTO ajustes_app (clave, valor) VALUES (?,?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor')
          .bind(clave, txt(cuerpo.valor, 20)).run();
        return json({ ok: true });
      }

      return mal('No existe', 404);
    } catch (e) {
      console.log('arqueo', String((e && e.stack) || e));
      return mal(String((e && e.message) || e), 500);
    }
  },

  async scheduled(_event, env, ctx) { ctx.waitUntil(cron(await withHubSecret(env))); },
};
