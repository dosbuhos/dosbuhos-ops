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
        const { results } = await env.DB.prepare('SELECT task, estado, nota FROM hechas WHERE w=?').bind(w).all();
        return json({ rows: results.map(r => ({ w, id: r.task, estado: r.estado, nota: r.nota || '' })) });
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
        const estado = b.estado === 'ayuda' ? 'ayuda' : 'hecho';
        if (b.done) await env.DB.prepare('INSERT OR REPLACE INTO hechas (w, task, estado, nota, txt) VALUES (?,?,?,?,?)')
          .bind(w, task, estado, String(b.nota || '').slice(0, 200), String(b.txt || '').slice(0, 300)).run();
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
          .bind(b.fecha, String(b.cama).slice(0, 60), String(b.cultivo).slice(0, 40), cantidad, String(b.u || 'kg').slice(0, 10), String(b.nota || '').slice(0, 200)).run();
        return json({ ok: true });
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
        if (!/^[AB]\d{1,2}$/.test(b.cama || '') || !['limpia', 'lista', 'sembrada'].includes(b.estado) || !(m > 0 && m <= 10) || !okDate(b.fecha)) return json({ error: 'Datos inválidos' }, 400);
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
