// Copia viva del plan en D1: cada cambio es una versión nueva (tabla plan), así hay historial y se puede revertir.
let CACHE = { v: null, data: null, at: 0 };
const ensure = (env) => env.DB.prepare("CREATE TABLE IF NOT EXISTS plan (v INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT NOT NULL, quien TEXT, nota TEXT, at TEXT NOT NULL DEFAULT (datetime('now')))").run();

export async function livePlan(env) {
  if (CACHE.v && Date.now() - CACHE.at < 5000) return CACHE.data ? CACHE : null;
  await ensure(env);
  const top = await env.DB.prepare('SELECT v FROM plan ORDER BY v DESC LIMIT 1').first();
  if (!top) { CACHE = { v: null, data: null, at: Date.now() }; return null; }
  if (top.v !== CACHE.v) { const r = await env.DB.prepare('SELECT v, data FROM plan WHERE v = ?').bind(top.v).first(); CACHE = { v: r.v, data: JSON.parse(r.data), at: Date.now() }; }
  else CACHE.at = Date.now();
  return CACHE;
}
export async function savePlan(env, data, quien, nota) {
  await ensure(env);
  const r = await env.DB.prepare('INSERT INTO plan (data, quien, nota) VALUES (?, ?, ?)').bind(JSON.stringify(data), String(quien || '').slice(0, 40), String(nota || '').slice(0, 300)).run();
  const v = r.meta.last_row_id;
  CACHE = { v, data, at: Date.now() };
  return v;
}
export async function planHistory(env, v) {
  await ensure(env);
  if (v) { const r = await env.DB.prepare('SELECT v, data FROM plan WHERE v = ?').bind(v).first(); return r ? { v: r.v, data: JSON.parse(r.data) } : null; }
  const { results } = await env.DB.prepare('SELECT v, quien, nota, at FROM plan ORDER BY v DESC LIMIT 30').all();
  return results;
}
