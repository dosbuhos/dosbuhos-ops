// Huerto Dos Búhos: sirve la app pública (public/) y una API mínima para tareas hechas y registro de cosecha.
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

async function pinOk(request, env) {
  const pin = request.headers.get('x-pin') || '';
  if (!pin) return false;
  const row = await env.DB.prepare("SELECT v FROM config WHERE k='pin'").first();
  return !!row && row.v === pin;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const p = url.pathname;
    if (!p.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      if (p === '/api/pin' && request.method === 'POST') return json({ ok: await pinOk(request, env) });

      if (p === '/api/hechas' && request.method === 'GET') {
        const w = Number(url.searchParams.get('w'));
        const { results } = await env.DB.prepare('SELECT task FROM hechas WHERE w=?').bind(w).all();
        return json({ ids: results.map(r => r.task) });
      }
      if (p === '/api/hechas' && request.method === 'POST') {
        if (!(await pinOk(request, env))) return json({ error: 'PIN incorrecto' }, 401);
        const b = await request.json();
        const w = Number(b.w), task = String(b.id || '').slice(0, 80);
        if (!Number.isInteger(w) || !task) return json({ error: 'Datos inválidos' }, 400);
        if (b.done) await env.DB.prepare('INSERT OR REPLACE INTO hechas (w, task) VALUES (?,?)').bind(w, task).run();
        else await env.DB.prepare('DELETE FROM hechas WHERE w=? AND task=?').bind(w, task).run();
        return json({ ok: true });
      }
      if (p === '/api/cosechas' && request.method === 'GET') {
        const { results } = await env.DB.prepare('SELECT fecha, cama, cultivo, cantidad, u, nota FROM cosechas ORDER BY fecha DESC, id DESC LIMIT 1000').all();
        return json({ rows: results });
      }
      if (p === '/api/cosechas' && request.method === 'POST') {
        if (!(await pinOk(request, env))) return json({ error: 'PIN incorrecto' }, 401);
        const b = await request.json();
        const cantidad = Number(b.cantidad);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(b.fecha || '') || !b.cama || !b.cultivo || !(cantidad >= 0)) return json({ error: 'Datos inválidos' }, 400);
        await env.DB.prepare('INSERT INTO cosechas (fecha, cama, cultivo, cantidad, u, nota) VALUES (?,?,?,?,?,?)')
          .bind(b.fecha, String(b.cama).slice(0, 8), String(b.cultivo).slice(0, 40), cantidad, String(b.u || 'kg').slice(0, 10), String(b.nota || '').slice(0, 200)).run();
        return json({ ok: true });
      }
      return json({ error: 'No encontrado' }, 404);
    } catch (e) {
      return json({ error: 'Error del servidor' }, 500);
    }
  },
};
