// Rumbo — the F&B director's guide: his initiatives, weekly check-ins, wins and a score per initiative.
// Served behind the Hub at /rumbo/. The scoring rules live in src/score.js; the ideas library in src/data/biblioteca.json.
import { hubUser } from './hub-auth.js';
import { withHubSecret } from './hub-secret.js';
import { calificar, general, lectura, hoyEn, ETAPAS, ACTIVAS, VENTANA } from './score.js';
import { club } from './club.js';
import biblioteca from './data/biblioteca.json';
import rol from './data/rol.json';

const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const mal = (msg, status = 400) => json({ error: msg }, status);
const AREAS = ['restaurante', 'enoturismo', 'eventos', 'club', 'alianzas', 'costos', 'controles', 'equipo'];
const TIPOS = ['ingreso', 'ahorro', 'base'];
const lista = (s) => (s || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
const txt = (v, max = 400) => String(v ?? '').trim().slice(0, max);
const fecha = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v : '');
const num = (v) => (v === '' || v == null || isNaN(Number(v)) ? null : Number(v));
const ahora = () => new Date().toISOString();

// Who is asking. Fails closed: without the Hub's signature nothing is served (the workers.dev address is public).
async function quien(request, env) {
  let who = null;
  if (env.ENVIRONMENT === 'dev' && env.DEV_USER) who = { email: env.DEV_USER, name: env.DEV_NAME || 'Dev', hubAdmin: env.DEV_ADMIN === '1' };
  else if (env.HUB_SECRET) who = await hubUser(request, env);
  if (!who) return null;
  const email = who.email.toLowerCase();
  const admin = !!who.hubAdmin || lista(env.ADMIN_EMAILS).includes(email);
  const director = lista(env.DIRECTOR_EMAILS).includes(email);
  return { email, nombre: who.name || email, admin, director, puede: admin || director };
}

const all = (env, sql, ...b) => env.DB.prepare(sql).bind(...b).all().then((r) => r.results);

async function estado(env, yo) {
  const hoy = hoyEn(env.TZ);
  const [inis, medidas, pasos, registros, logros, comentarios, cl] = await Promise.all([
    all(env, 'SELECT * FROM iniciativas ORDER BY id'), all(env, 'SELECT * FROM medidas ORDER BY id'), all(env, 'SELECT * FROM pasos ORDER BY orden, id'),
    all(env, 'SELECT * FROM registros ORDER BY fecha DESC, id DESC'), all(env, 'SELECT * FROM logros ORDER BY fecha DESC, id DESC'),
    all(env, 'SELECT * FROM comentarios ORDER BY id'), club(env, hoy)]);
  const autos = cl ? { club_altas: cl.altas, club_neto: cl.neto } : {};
  for (const r of registros) { try { r.valores = JSON.parse(r.valores || '{}'); } catch { r.valores = {}; } }
  const por = (rows, k) => rows.reduce((m, r) => (m.set(r[k], [...(m.get(r[k]) || []), r]), m), new Map());
  const mI = por(medidas, 'iniciativa_id'), pI = por(pasos, 'iniciativa_id'), rI = por(registros, 'iniciativa_id');
  const iniciativas = inis.map((i) => {
    const o = { ...i, medidas: mI.get(i.id) || [], pasos: pI.get(i.id) || [], registros: rI.get(i.id) || [] };
    o.score = calificar(o, hoy, autos);
    o.medidas = o.medidas.map((m) => ({ ...m, lectura: lectura(m, o.registros, hoy, autos) }));
    o.logros = logros.filter((l) => l.iniciativa_id === i.id).length;
    return o;
  });
  return { hoy, ventana: VENTANA, yo, iniciativas, logros, comentarios, club: cl, score: general(iniciativas, hoy, autos),
    tope: Number(env.TOPE_ACTIVAS) || 6, activas: iniciativas.filter((i) => ACTIVAS.includes(i.etapa)).length, biblioteca, rol, areas: AREAS };
}

async function activas(env) { return (await env.DB.prepare(`SELECT COUNT(*) n FROM iniciativas WHERE etapa IN ('planeacion','marcha')`).first()).n; }
const medidaOk = (m) => ({ nombre: txt(m.nombre, 80), unidad: txt(m.unidad, 16), meta: num(m.meta), periodo: m.periodo === 'semana' ? 'semana' : 'mes',
  modo: m.modo === 'ultimo' ? 'ultimo' : 'suma', sentido: m.sentido === 'baja' ? 'baja' : 'sube', auto: ['club_altas', 'club_neto'].includes(m.auto) ? m.auto : '' });
const insMedida = (env, id, m) => env.DB.prepare('INSERT INTO medidas (iniciativa_id, nombre, unidad, meta, periodo, modo, sentido, auto) VALUES (?,?,?,?,?,?,?,?)')
  .bind(id, m.nombre, m.unidad, m.meta, m.periodo, m.modo, m.sentido, m.auto);

async function api(request, env, url, yo) {
  const p = url.pathname.replace(/^\/api/, ''), M = request.method;
  if (M === 'GET' && p === '/estado') return json(await estado(env, yo));
  const mArch = p.match(/^\/archivos\/(\d+)$/);
  if (M === 'GET' && mArch) {
    const a = await env.DB.prepare('SELECT mime, datos FROM archivos WHERE id = ?').bind(+mArch[1]).first();
    if (!a) return mal('No existe', 404);
    return new Response(a.datos instanceof ArrayBuffer ? a.datos : new Uint8Array(a.datos), { headers: { 'content-type': a.mime, 'cache-control': 'private, max-age=86400' } });
  }
  if (M === 'GET') return mal('No existe', 404);
  const b = M === 'DELETE' ? {} : await request.json().catch(() => ({}));

  // Comments: anyone who can open the app.
  if (M === 'POST' && p === '/comentarios') {
    const t = txt(b.texto, 1000); if (!t || !['iniciativa', 'logro'].includes(b.tipo) || !Number(b.ref_id)) return mal('Falta el comentario');
    await env.DB.prepare('INSERT INTO comentarios (tipo, ref_id, texto, por, nombre, creado) VALUES (?,?,?,?,?,?)').bind(b.tipo, +b.ref_id, t, yo.email, yo.nombre, ahora()).run();
    return json({ ok: true });
  }
  const mCom = p.match(/^\/comentarios\/(\d+)$/);
  if (M === 'DELETE' && mCom) { await env.DB.prepare('DELETE FROM comentarios WHERE id = ? AND (por = ? OR ? = 1)').bind(+mCom[1], yo.email, yo.admin ? 1 : 0).run(); return json({ ok: true }); }

  if (!yo.puede) return mal('Solo lectura', 403);

  // ---- Initiatives
  if (M === 'POST' && p === '/iniciativas') {
    const carta = b.clave ? biblioteca.find((c) => c.clave === b.clave) : null;
    if (b.clave && !carta) return mal('Esa idea no existe');
    if (carta && (await env.DB.prepare(`SELECT id FROM iniciativas WHERE clave = ? AND etapa NOT IN ('cerrada')`).bind(carta.clave).first())) return mal('Ya tienes esta iniciativa');
    // A suggestion from an admin who is not the director lands as an idea; so does anything past the cap.
    const sugerida = yo.admin && !yo.director;
    let etapa = sugerida || b.etapa === 'idea' ? 'idea' : 'planeacion';
    const tope = Number(env.TOPE_ACTIVAS) || 6; let aviso = '';
    if (etapa === 'planeacion' && (await activas(env)) >= tope) { etapa = 'idea'; aviso = `Ya hay ${tope} iniciativas activas. Quedó como idea: cierra o pausa una para empezarla.`; }
    const titulo = txt(carta ? carta.titulo : b.titulo, 120); if (!titulo) return mal('Falta el título');
    const area = AREAS.includes(carta?.area || b.area) ? carta?.area || b.area : 'restaurante', tipo = TIPOS.includes(carta?.tipo || b.tipo) ? carta?.tipo || b.tipo : 'ingreso';
    const r = await env.DB.prepare('INSERT INTO iniciativas (titulo, area, tipo, origen, clave, porque, etapa, creado, por, actualizado) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .bind(titulo, area, tipo, sugerida ? 'sugerida' : carta ? 'biblioteca' : 'propia', carta?.clave || '', txt(carta ? carta.paga : b.porque, 600), etapa, ahora(), yo.email, ahora()).run();
    const id = r.meta.last_row_id, lote = [];
    (carta ? carta.pasos : (b.pasos || [])).map((t) => txt(t, 200)).filter(Boolean).slice(0, 12).forEach((t, i) => lote.push(env.DB.prepare('INSERT INTO pasos (iniciativa_id, texto, orden) VALUES (?,?,?)').bind(id, t, i)));
    (carta ? carta.medidas : (b.medidas || [])).map(medidaOk).filter((m) => m.nombre).slice(0, 6).forEach((m) => lote.push(insMedida(env, id, m)));
    if (lote.length) await env.DB.batch(lote);
    return json({ ok: true, id, etapa, aviso });
  }
  const mIni = p.match(/^\/iniciativas\/(\d+)(?:\/(pasos|medidas|registros))?$/);
  if (mIni) {
    const id = +mIni[1], sub = mIni[2];
    const ini = await env.DB.prepare('SELECT * FROM iniciativas WHERE id = ?').bind(id).first();
    if (!ini) return mal('No existe', 404);
    if (!sub && M === 'PATCH') {
      const set = [], val = [];
      if (b.etapa !== undefined) {
        if (!ETAPAS.includes(b.etapa)) return mal('Etapa inválida');
        const tope = Number(env.TOPE_ACTIVAS) || 6;
        if (ACTIVAS.includes(b.etapa) && !ACTIVAS.includes(ini.etapa) && (await activas(env)) >= tope) return mal(`Ya hay ${tope} iniciativas activas. Cierra o pausa una primero.`, 409);
        set.push('etapa = ?'); val.push(b.etapa);
      }
      if (b.titulo !== undefined) { const t = txt(b.titulo, 120); if (!t) return mal('Falta el título'); set.push('titulo = ?'); val.push(t); }
      if (b.porque !== undefined) { set.push('porque = ?'); val.push(txt(b.porque, 600)); }
      if (b.area !== undefined && AREAS.includes(b.area)) { set.push('area = ?'); val.push(b.area); }
      if (b.tipo !== undefined && TIPOS.includes(b.tipo)) { set.push('tipo = ?'); val.push(b.tipo); }
      if (b.siguiente !== undefined) { set.push('siguiente = ?'); val.push(txt(b.siguiente, 200)); }
      if (b.siguiente_fecha !== undefined) { set.push('siguiente_fecha = ?'); val.push(fecha(b.siguiente_fecha)); }
      if (b.revisar !== undefined) { set.push('revisar = ?'); val.push(b.revisar ? 1 : 0); }
      if (!set.length) return mal('Nada que cambiar');
      await env.DB.prepare(`UPDATE iniciativas SET ${set.join(', ')}, actualizado = ? WHERE id = ?`).bind(...val, ahora(), id).run();
      return json({ ok: true });
    }
    if (!sub && M === 'DELETE') { await env.DB.batch([env.DB.prepare('DELETE FROM comentarios WHERE tipo = ? AND ref_id = ?').bind('iniciativa', id), env.DB.prepare('DELETE FROM iniciativas WHERE id = ?').bind(id)]); return json({ ok: true }); }
    if (sub === 'pasos' && M === 'POST') {
      const t = txt(b.texto, 200); if (!t) return mal('Falta el hito');
      const o = await env.DB.prepare('SELECT COALESCE(MAX(orden), -1) + 1 o FROM pasos WHERE iniciativa_id = ?').bind(id).first();
      await env.DB.prepare('INSERT INTO pasos (iniciativa_id, texto, orden) VALUES (?,?,?)').bind(id, t, o.o).run(); return json({ ok: true });
    }
    if (sub === 'medidas' && M === 'POST') { const m = medidaOk(b); if (!m.nombre) return mal('Falta el nombre'); await insMedida(env, id, m).run(); return json({ ok: true }); }
    if (sub === 'registros' && M === 'POST') {
      const f = fecha(b.fecha) || hoyEn(env.TZ); if (f > hoyEn(env.TZ)) return mal('La fecha no puede ser futura');
      const ids = new Set((await all(env, "SELECT id FROM medidas WHERE iniciativa_id = ? AND auto = ''", id)).map((m) => String(m.id))), valores = {};
      for (const [k, v] of Object.entries(b.valores || {})) if (ids.has(String(k)) && num(v) != null) valores[k] = num(v);
      const nota = txt(b.nota, 1000); if (!nota && !Object.keys(valores).length) return mal('Escribe un número o una nota');
      const lote = [env.DB.prepare('INSERT INTO registros (iniciativa_id, fecha, nota, valores, por, creado) VALUES (?,?,?,?,?,?)').bind(id, f, nota, JSON.stringify(valores), yo.email, ahora())];
      if (b.siguiente !== undefined) lote.push(env.DB.prepare('UPDATE iniciativas SET siguiente = ?, siguiente_fecha = ?, actualizado = ? WHERE id = ?').bind(txt(b.siguiente, 200), fecha(b.siguiente_fecha), ahora(), id));
      // The first check-in on a plan means it is running.
      if (ini.etapa === 'planeacion' && b.arrancar) lote.push(env.DB.prepare("UPDATE iniciativas SET etapa = 'marcha' WHERE id = ?").bind(id));
      await env.DB.batch(lote); return json({ ok: true });
    }
  }
  const mPaso = p.match(/^\/pasos\/(\d+)$/);
  if (mPaso && M === 'PATCH') {
    if (b.hecho !== undefined) await env.DB.prepare('UPDATE pasos SET hecho = ?, hecho_fecha = ? WHERE id = ?').bind(b.hecho ? 1 : 0, b.hecho ? hoyEn(env.TZ) : '', +mPaso[1]).run();
    if (b.texto !== undefined && txt(b.texto, 200)) await env.DB.prepare('UPDATE pasos SET texto = ? WHERE id = ?').bind(txt(b.texto, 200), +mPaso[1]).run();
    return json({ ok: true });
  }
  if (mPaso && M === 'DELETE') { await env.DB.prepare('DELETE FROM pasos WHERE id = ?').bind(+mPaso[1]).run(); return json({ ok: true }); }
  const mMed = p.match(/^\/medidas\/(\d+)$/);
  if (mMed && M === 'PATCH') { const m = medidaOk(b); if (!m.nombre) return mal('Falta el nombre');
    await env.DB.prepare('UPDATE medidas SET nombre = ?, unidad = ?, meta = ?, periodo = ?, modo = ?, sentido = ? WHERE id = ?').bind(m.nombre, m.unidad, m.meta, m.periodo, m.modo, m.sentido, +mMed[1]).run(); return json({ ok: true }); }
  if (mMed && M === 'DELETE') { await env.DB.prepare('DELETE FROM medidas WHERE id = ?').bind(+mMed[1]).run(); return json({ ok: true }); }
  const mReg = p.match(/^\/registros\/(\d+)$/);
  if (mReg && M === 'DELETE') { await env.DB.prepare('DELETE FROM registros WHERE id = ?').bind(+mReg[1]).run(); return json({ ok: true }); }

  // ---- Wins
  const mLog = p.match(/^\/logros(?:\/(\d+))?$/);
  if (mLog && (M === 'POST' || M === 'PATCH')) {
    const id = mLog[1] ? +mLog[1] : null; if ((M === 'PATCH') !== !!id) return mal('No existe', 404);
    const titulo = txt(b.titulo, 140); if (!titulo) return mal('Falta el título');
    let url_ = txt(b.url, 500); if (url_ && !/^https?:\/\//i.test(url_)) url_ = 'https://' + url_;
    const v = [titulo, txt(b.detalle, 1500), AREAS.includes(b.area) ? b.area : 'restaurante', Number(b.iniciativa_id) || null, fecha(b.fecha) || hoyEn(env.TZ),
      ['propuesta', 'marcha', 'resultado'].includes(b.etapa) ? b.etapa : 'marcha', url_];
    let archivo = undefined;
    if (b.foto && typeof b.foto === 'string') {
      const m = b.foto.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/); if (!m) return mal('La foto no se pudo leer');
      const bin = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0)); if (bin.length > 1_400_000) return mal('La foto es demasiado grande');
      archivo = (await env.DB.prepare('INSERT INTO archivos (nombre, mime, datos, bytes, creado, por) VALUES (?,?,?,?,?,?)').bind('logro', m[1], bin, bin.length, ahora(), yo.email).run()).meta.last_row_id;
    } else if (b.foto === null) archivo = null;
    if (!id) {
      const r = await env.DB.prepare('INSERT INTO logros (titulo, detalle, area, iniciativa_id, fecha, etapa, url, archivo_id, por, creado) VALUES (?,?,?,?,?,?,?,?,?,?)').bind(...v, archivo ?? null, yo.email, ahora()).run();
      return json({ ok: true, id: r.meta.last_row_id });
    }
    await env.DB.prepare(`UPDATE logros SET titulo = ?, detalle = ?, area = ?, iniciativa_id = ?, fecha = ?, etapa = ?, url = ?, revisar = 0${archivo !== undefined ? ', archivo_id = ?' : ''} WHERE id = ?`)
      .bind(...v, ...(archivo !== undefined ? [archivo] : []), id).run();
    return json({ ok: true });
  }
  if (mLog && mLog[1] && M === 'DELETE') { await env.DB.batch([env.DB.prepare('DELETE FROM comentarios WHERE tipo = ? AND ref_id = ?').bind('logro', +mLog[1]), env.DB.prepare('DELETE FROM logros WHERE id = ?').bind(+mLog[1])]); return json({ ok: true }); }
  return mal('No existe', 404);
}

export default {
  async fetch(request, env) {
    env = await withHubSecret(env);
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    const yo = await quien(request, env);
    if (!yo) return mal('Abre Rumbo desde el Hub: apps.dosbuhos.com', 401);
    try { return await api(request, env, url, yo); } catch (e) { console.log('api', url.pathname, String(e && e.stack || e)); return mal('Algo falló. Intenta de nuevo.', 500); }
  },
};
