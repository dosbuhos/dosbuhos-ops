import { upcoming, upcomingSowings, listRequests, addRequest, vote, answerRequest, listMessages, postMessage } from './cocina.js';
import { listShopping, editShopping, listBank, editBank } from './insumos.js';
import { latestCensus, saveCensus } from './censo.js';
import { livePlan } from './planstore.js';
import { CROPS, PLAN_START, applyPlanData, buildPlan } from './plan.js';
import { mcpRoute } from './mcp.js';
// Huerto Dos Búhos: sirve la app pública (public/) y una API mínima para tareas hechas y registro de cosecha.
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

async function pinOk(request, env) {
  const pin = request.headers.get('x-pin') || '';
  if (!pin) return false;
  const row = await env.DB.prepare("SELECT v FROM config WHERE k='pin'").first();
  return !!row && row.v === pin;
}

// PIN de la cocina (config k='pin_cocina'): solo sirve para anotar cosechas en /cocina.
async function pinRole(request, env) {
  const pin = request.headers.get('x-pin') || '';
  if (!pin) return null;
  const { results } = await env.DB.prepare("SELECT k, v FROM config WHERE k IN ('pin','pin_cocina')").all();
  for (const r of results) if (r.v === pin) return r.k === 'pin' ? 'huerto' : 'cocina';
  return null;
}
let migrated = false;
async function migrate(env) {
  if (migrated) return;
  try { await env.DB.prepare('ALTER TABLE cosechas ADD COLUMN quien TEXT').run(); } catch (e) {}
  migrated = true;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const p = url.pathname;
    // Servidor MCP remoto para el Claude de cada persona (/mcp y su OAuth); ver src/mcp.js.
    if (p === '/mcp' || p.startsWith('/oauth/') || p.startsWith('/.well-known/')) { const r = await mcpRoute(request, env, url); if (r) return r; }
    if (!p.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      if (p === '/api/pin' && request.method === 'POST') return json({ ok: await pinOk(request, env) });

      if (p === '/api/hechas' && request.method === 'GET') {
        const w = Number(url.searchParams.get('w'));
        const { results } = await env.DB.prepare('SELECT task, estado, nota, txt FROM hechas WHERE w=?').bind(w).all();
        // txt solo hace falta para las tareas movidas (estado 'llega' o su estado posterior): ahí va la tarea en JSON.
        return json({ rows: results.map(r => ({ w, id: r.task, estado: r.estado, nota: r.nota || '', ...(String(r.task).startsWith('mv-') ? { txt: r.txt || '' } : {}) })) });
      }
      if (p === '/api/avisos' && request.method === 'GET') {
        const { results } = await env.DB.prepare("SELECT w, task, nota, txt, done_at FROM hechas WHERE estado='ayuda' ORDER BY done_at DESC LIMIT 200").all();
        return json({ rows: results.map(r => ({ w: r.w, id: r.task, estado: 'ayuda', nota: r.nota || '', txt: r.txt || '', at: r.done_at })) });
      }
      if (p === '/api/hechas' && request.method === 'POST') {
        if (!(await pinOk(request, env))) return json({ error: 'PIN incorrecto' }, 401);
        const b = await request.json();
        const w = Number(b.w), task = String(b.id || '').slice(0, 80);
        if (!Number.isInteger(w) || !task) return json({ error: 'Datos inválidos' }, 400);
        // hecho | no_aplica | no (no se pudo) | ayuda | movida (nota = fecha ISO destino) | llega (tarea movida aquí; txt = JSON de la tarea)
        const estado = ['ayuda', 'no', 'no_aplica', 'movida', 'llega'].includes(b.estado) ? b.estado : 'hecho';
        if (estado === 'movida' && !/^\d{4}-\d{2}-\d{2}$/.test(String(b.nota || ''))) return json({ error: 'Falta la fecha a la que se mueve' }, 400);
        if (estado === 'llega' && !String(b.txt || '').trim()) return json({ error: 'Falta la tarea movida' }, 400);
        if (b.done) await env.DB.prepare('INSERT OR REPLACE INTO hechas (w, task, estado, nota, txt) VALUES (?,?,?,?,?)')
          .bind(w, task, estado, String(b.nota || '').slice(0, 200), String(b.txt || '').slice(0, 300)).run();
        else await env.DB.prepare('DELETE FROM hechas WHERE w=? AND task=?').bind(w, task).run();
        return json({ ok: true });
      }
      if (p === '/api/cosechas' && request.method === 'GET') {
        const { results } = await env.DB.prepare('SELECT fecha, cama, cultivo, cantidad, u, nota, quien FROM cosechas ORDER BY fecha DESC, id DESC LIMIT 1000').all();
        return json({ rows: results });
      }
      if (p === '/api/cosechas' && request.method === 'POST') {
        const role = await pinRole(request, env);
        if (!role) return json({ error: 'PIN incorrecto' }, 401);
        await migrate(env);
        const b = await request.json();
        const cantidad = Number(b.cantidad);
        const cama = String(b.cama || (role === 'cocina' ? '—' : '')).slice(0, 60);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(b.fecha || '') || !cama || !String(b.cultivo || '').trim() || !(cantidad > 0)) return json({ error: 'Faltan fecha, cultivo o cantidad' }, 400);
        const r = await env.DB.prepare('INSERT INTO cosechas (fecha, cama, cultivo, cantidad, u, nota, quien) VALUES (?,?,?,?,?,?,?)')
          .bind(b.fecha, cama, String(b.cultivo).trim().slice(0, 40), cantidad, String(b.u || 'kg').slice(0, 10), String(b.nota || '').slice(0, 200), role).run();
        return json({ ok: true, id: r.meta.last_row_id });
      }
      // Cocina: página /cocina con su propio PIN, solo para anotar lo que cosechan.
      if (p === '/api/cocina/pin' && request.method === 'POST') { const role = await pinRole(request, env); return json({ ok: !!role, role }); }
      if (p === '/api/cocina/registros' && request.method === 'GET') {
        await migrate(env);
        const { results } = await env.DB.prepare('SELECT id, fecha, cama, cultivo, cantidad, u, nota, quien, at FROM cosechas ORDER BY fecha DESC, id DESC LIMIT 80').all();
        return json({ rows: results });
      }
      if (p === '/api/cocina/borrar' && request.method === 'POST') {
        const role = await pinRole(request, env);
        if (!role) return json({ error: 'PIN incorrecto' }, 401);
        await migrate(env);
        const b = await request.json();
        const q = role === 'huerto' ? 'DELETE FROM cosechas WHERE id=?' : "DELETE FROM cosechas WHERE id=? AND quien='cocina' AND at > datetime('now','-3 days')";
        const r = await env.DB.prepare(q).bind(Number(b.id)).run();
        return json(r.meta.changes ? { ok: true } : { error: 'Solo se pueden borrar registros de la cocina de los últimos 3 días' }, r.meta.changes ? 200 : 400);
      }
      if (p === '/api/mensajes' && request.method === 'GET') return json({ rows: await listMessages(env) });
      if (p === '/api/mensajes' && request.method === 'POST') {
        const role = await pinRole(request, env);
        if (!role) return json({ error: 'PIN incorrecto' }, 401);
        const b = await request.json();
        const r = await postMessage(env, role, b.nombre, b.texto);
        return json(r, r.error ? 400 : 200);
      }
      if (p === '/api/cocina/proximas' && request.method === 'GET') return json(await upcoming(env, 16));
      if (p === '/api/cocina/siembras' && request.method === 'GET') return json({ rows: await upcomingSowings(env, 6) });
      if (p === '/api/cocina/pedidos' && request.method === 'GET') return json({ rows: await listRequests(env) });
      if ((p === '/api/cocina/pedido' || p === '/api/cocina/voto' || p === '/api/cocina/responder') && request.method === 'POST') {
        const role = await pinRole(request, env);
        if (!role) return json({ error: 'PIN incorrecto' }, 401);
        if (p === '/api/cocina/responder' && role !== 'huerto') return json({ error: 'Solo el huerto responde pedidos' }, 403);
        const b = await request.json();
        const r = p === '/api/cocina/pedido' ? await addRequest(env, b, role) : p === '/api/cocina/voto' ? await vote(env, b, role) : await answerRequest(env, b);
        return json(r, r.error ? 400 : 200);
      }
      // Qué hay hoy en cada cama (del plan vivo, que incluye el censo): para el mapa de la cocina.
      if (p === '/api/hoy-camas' && request.method === 'GET') {
        const live = await livePlan(env);
        if (live) applyPlanData(live.data);
        const plan = buildPlan();
        const today = new Date(Date.now() - 6 * 3600e3);
        const w = Math.floor((today - new Date(PLAN_START + 'T06:00:00Z')) / (7 * 86400000));
        const out = {};
        plan.P.forEach(x => { if ((x.ex || x.s <= w) && x.end >= w) (out[x.bed] = out[x.bed] || []).push({ n: x.c.n, c: x.c.c, pos: x.pos, m: x.m, cosecha: !x.c.nokg && w >= x.h0 }); });
        return json({ camas: out });
      }
      if (p === '/api/cultivos' && request.method === 'GET') {
        const live = await livePlan(env);
        const all = Object.assign({}, CROPS, (live && live.data && live.data.cultivos) || {});
        return json({ rows: Object.entries(all).filter(([, c]) => !c.nokg && !/^Decorativa/.test(c.menu || '')).map(([k, c]) => ({ clave: k, nombre: c.n })).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')) });
      }
      if (p === '/api/lista' && request.method === 'GET') return json({ rows: await listShopping(env) });
      if (p === '/api/banco' && request.method === 'GET') return json({ rows: await listBank(env) });
      if ((p === '/api/lista' || p === '/api/banco') && request.method === 'POST') {
        if (!(await pinOk(request, env))) return json({ error: 'PIN incorrecto' }, 401);
        const b = await request.json();
        const r = p === '/api/lista' ? await editShopping(env, b, 'Adrián (app)') : await editBank(env, b);
        return json(r, r.error ? 400 : 200);
      }
      if (p === '/api/censo' && request.method === 'GET') return json({ rows: await latestCensus(env) });
      if (p === '/api/censo' && request.method === 'POST') {
        if (!(await pinOk(request, env))) return json({ error: 'PIN incorrecto' }, 401);
        const b = await request.json();
        const r = await saveCensus(env, b.cama, b.lineas, 'Adrián (app)');
        return json(r, r.error ? 400 : 200);
      }
      if (p === '/api/plan' && request.method === 'GET') {
        const live = await livePlan(env);
        return json(live ? { v: live.v, data: live.data } : { v: 0, data: null });
      }
      if (p === '/api/camas' && request.method === 'GET') {
        const { results } = await env.DB.prepare('SELECT id, cama, estado, m, pos, cultivo, fecha, cosecha FROM camas ORDER BY id DESC LIMIT 500').all();
        return json({ rows: results.map(r => ({ ...r, id: String(r.id), at: r.id })) });
      }
      if (p === '/api/camas' && request.method === 'POST') {
        if (!(await pinOk(request, env))) return json({ error: 'PIN incorrecto' }, 401);
        const b = await request.json();
        if (b.del) { await env.DB.prepare('DELETE FROM camas WHERE id=?').bind(Number(b.del)).run(); return json({ ok: true }); }
        const m = Number(b.m), pos = b.pos == null ? null : Number(b.pos);
        const okDate = d => /^\d{4}-\d{2}-\d{2}$/.test(d || '');
        if (!/^[ABI]\d{1,2}$/.test(b.cama || '') || !['limpia', 'lista', 'sembrada'].includes(b.estado) || !(m > 0 && m <= 10) || !okDate(b.fecha)) return json({ error: 'Datos inválidos' }, 400);
        const r = await env.DB.prepare('INSERT INTO camas (cama, estado, m, pos, cultivo, fecha, cosecha) VALUES (?,?,?,?,?,?,?)')
          .bind(b.cama, b.estado, m, pos, String(b.cultivo || '').slice(0, 40), b.fecha, okDate(b.cosecha) ? b.cosecha : '').run();
        return json({ ok: true, id: String(r.meta.last_row_id) });
      }
      return json({ error: 'No encontrado' }, 404);
    } catch (e) {
      return json({ error: 'Error del servidor' }, 500);
    }
  },
};
