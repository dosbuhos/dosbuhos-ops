// La cocina en el huerto: qué viene (cosecha esperada por cultivo y semana), pedidos de cultivos y validación de las
// siembras próximas. Los pedidos los responde el huerto (Eric, Melanie, Adrián o Claude) y se vuelven siembras en el plan.
import { CROPS, BED, PLAN_START, wkDate, buildPlan, applyPlanData, plantingToObj, PLANTINGS } from './plan.js';
import { livePlan } from './planstore.js';

const DAY = 86400000;
const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const weekNow = () => Math.floor((Date.now() - 6 * 3600e3 - new Date(PLAN_START + 'T06:00:00Z')) / (7 * DAY));
let ready = false;
async function ensure(env) {
  if (ready) return;
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS solicitudes (id INTEGER PRIMARY KEY AUTOINCREMENT, tipo TEXT NOT NULL, cultivo TEXT, cantidad TEXT, para TEXT, nota TEXT, siembra TEXT, voto INTEGER, estado TEXT NOT NULL DEFAULT 'nueva', respuesta TEXT, quien TEXT, at TEXT NOT NULL DEFAULT (datetime('now')), resp_at TEXT)").run();
  ready = true;
}
async function livePlanBuilt(env) {
  const live = await livePlan(env);
  if (live) applyPlanData(live.data);
  const plan = buildPlan();
  const list = live ? live.data.siembras : PLANTINGS.map(plantingToObj);
  const valid = list.filter(o => CROPS[o.cultivo] && BED[o.cama]);
  return { plan, ids: plan.P.map((p, i) => valid[i] && valid[i].id) };
}

// Cosecha esperada por cultivo y semana (desde esta semana, n semanas).
export async function upcoming(env, n = 16) {
  const { plan } = await livePlanBuilt(env);
  const w0 = Math.max(0, weekNow()), rows = {};
  plan.P.forEach(p => {
    if (p.c.nokg || /^Decorativa/.test(p.c.menu || '')) return;
    for (let w = Math.max(w0, p.h0); w <= Math.min(p.end, w0 + n - 1); w++) {
      const r = rows[p.crop] = rows[p.crop] || { clave: p.crop, nombre: p.c.n, color: p.c.c, unidad: p.c.u, menu: p.c.menu || '', semanas: Array(n).fill(0), camas: new Set() };
      r.semanas[w - w0] += p.c.kg * p.scale;
      r.camas.add(p.bed);
    }
  });
  const out = Object.values(rows).map(r => {
    const first = r.semanas.findIndex(v => v > 0);
    return Object.assign(r, { camas: [...r.camas].sort(), semanas: r.semanas.map(v => Math.round(v * 10) / 10), desde: first, desde_fecha: iso(wkDate(w0 + first)), pico: Math.round(Math.max(...r.semanas) * 10) / 10 });
  }).filter(r => r.desde >= 0).sort((a, b) => a.desde - b.desde || (a.unidad === 'kg' ? 0 : 1) - (b.unidad === 'kg' ? 0 : 1) || b.pico - a.pico);
  return { desde: iso(wkDate(w0)), semanas: Array.from({ length: n }, (_, i) => iso(wkDate(w0 + i))), cultivos: out };
}

// Siembras de las próximas semanas (para que la cocina las valide) con su voto.
export async function upcomingSowings(env, n = 6) {
  await ensure(env);
  const { plan, ids } = await livePlanBuilt(env);
  const w0 = Math.max(0, weekNow());
  const { results } = await env.DB.prepare("SELECT siembra, voto, nota FROM solicitudes WHERE tipo='voto'").all();
  const votes = {}; results.forEach(r => { votes[r.siembra] = { voto: r.voto, nota: r.nota }; });
  return plan.P.map((p, i) => ({ p, id: ids[i] })).filter(({ p }) => !p.ex && !p.c.nokg && !/^Decorativa/.test(p.c.menu || '') && p.s >= w0 && p.s < w0 + n)
    .sort((a, b) => a.p.s - b.p.s)
    .map(({ p, id }) => ({ id, cultivo: p.c.n, color: p.c.c, cama: p.bed, metros: p.m, siembra: iso(wkDate(p.s)), cosecha: iso(wkDate(p.h0)), por_semana: Math.round(p.c.kg * p.scale * 10) / 10 + ' ' + p.c.u, menu: p.c.menu || '', voto: votes[id] || null }));
}

export async function listRequests(env) {
  await ensure(env);
  const { results } = await env.DB.prepare("SELECT * FROM solicitudes WHERE tipo='pedido' ORDER BY (estado IN ('nueva','aceptada')) DESC, id DESC LIMIT 100").all();
  return results.map(r => Object.assign(r, { id: String(r.id) }));
}
export async function addRequest(env, b, quien) {
  await ensure(env);
  const cultivo = String(b.cultivo || '').trim().slice(0, 60);
  if (!cultivo) return { error: 'Falta qué quieren que se siembre' };
  const r = await env.DB.prepare("INSERT INTO solicitudes (tipo, cultivo, cantidad, para, nota, quien) VALUES ('pedido',?,?,?,?,?)").bind(cultivo, String(b.cantidad || '').slice(0, 60), String(b.para || '').slice(0, 30), String(b.nota || '').slice(0, 200), quien).run();
  return { ok: true, id: String(r.meta.last_row_id) };
}
export async function vote(env, b, quien) {
  await ensure(env);
  const siembra = String(b.siembra || '').slice(0, 20), v = Number(b.voto);
  if (!siembra || ![1, -1, 0].includes(v)) return { error: 'Datos inválidos' };
  await env.DB.prepare("DELETE FROM solicitudes WHERE tipo='voto' AND siembra=?").bind(siembra).run();
  if (v) await env.DB.prepare("INSERT INTO solicitudes (tipo, siembra, voto, nota, quien, cultivo) VALUES ('voto',?,?,?,?,?)").bind(siembra, v, String(b.nota || '').slice(0, 200), quien, String(b.cultivo || '').slice(0, 60)).run();
  return { ok: true };
}
// El huerto responde un pedido: aceptada (se va a sembrar), en_plan (ya está en el plan), no_se_puede, o hecha.
export async function answerRequest(env, b) {
  await ensure(env);
  const estados = ['nueva', 'aceptada', 'en_plan', 'no_se_puede', 'hecha'];
  if (!estados.includes(b.estado)) return { error: 'estado: ' + estados.join(', ') };
  await env.DB.prepare("UPDATE solicitudes SET estado=?, respuesta=?, resp_at=datetime('now') WHERE id=? AND tipo='pedido'").bind(b.estado, String(b.respuesta || '').slice(0, 200), Number(b.id)).run();
  return { ok: true };
}
export async function votesSummary(env) {
  await ensure(env);
  const { results } = await env.DB.prepare("SELECT siembra, cultivo, voto, nota, at FROM solicitudes WHERE tipo='voto' ORDER BY id DESC").all();
  return results;
}

// ---------- mensajes huerto ↔ cocina ----------
let msgReady = false;
async function ensureMsg(env) {
  if (msgReady) return;
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS mensajes (id INTEGER PRIMARY KEY AUTOINCREMENT, de TEXT NOT NULL, nombre TEXT, texto TEXT NOT NULL, at TEXT NOT NULL DEFAULT (datetime('now')))").run();
  msgReady = true;
}
export async function listMessages(env) {
  await ensureMsg(env);
  const { results } = await env.DB.prepare('SELECT * FROM (SELECT * FROM mensajes ORDER BY id DESC LIMIT 150) ORDER BY id').all();
  return results;
}
export async function postMessage(env, de, nombre, texto) {
  await ensureMsg(env);
  texto = String(texto || '').trim().slice(0, 1000);
  if (!texto) return { error: 'Mensaje vacío' };
  const r = await env.DB.prepare('INSERT INTO mensajes (de, nombre, texto) VALUES (?,?,?)').bind(de, String(nombre || '').trim().slice(0, 30), texto).run();
  return { ok: true, id: r.meta.last_row_id };
}
