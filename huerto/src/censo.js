// Censo de camas: Adrián dice qué hay en cada cama, en metros, de norte a sur (A) o de oeste a este (B e invernaderos).
// Guardar un censo reemplaza en el plan vivo lo que está en la tierra en esa cama (siembras ya empezadas y no
// terminadas); lo futuro se queda. Cada censo queda también en la tabla censo como historial.
import { CROPS, PLANTINGS, EXTRA_TASKS, STOCK, PLAN_START, BED, factor, buildPlan, plantingToObj, applyPlanData } from './plan.js';
import { livePlan, savePlan } from './planstore.js';

const DAY = 86400000;
const isoMX = (d = new Date()) => new Date(d.getTime() - 6 * 3600e3).toISOString().slice(0, 10);
const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const slug = (s) => 'x_' + s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 24);

const ensure = (env) => env.DB.prepare("CREATE TABLE IF NOT EXISTS censo (id INTEGER PRIMARY KEY AUTOINCREMENT, cama TEXT NOT NULL, lineas TEXT NOT NULL, quien TEXT, at TEXT NOT NULL DEFAULT (datetime('now')))").run();

export async function latestCensus(env) {
  await ensure(env);
  const { results } = await env.DB.prepare('SELECT c.cama, c.lineas, c.quien, c.at FROM censo c JOIN (SELECT cama, MAX(id) mx FROM censo GROUP BY cama) t ON t.mx = c.id').all();
  return results.map(r => ({ cama: r.cama, lineas: JSON.parse(r.lineas), quien: r.quien, at: r.at }));
}

// Busca la clave del cultivo por clave o por nombre; si no existe, lo crea en el catálogo vivo.
function cropKey(name, data) {
  const t = String(name || '').trim(); if (!t) return null;
  const low = t.toLowerCase();
  const all = Object.assign({}, CROPS, data.cultivos || {});
  for (const [k, c] of Object.entries(all)) if (k === low || (c.n || '').toLowerCase() === low) return k;
  for (const [k, c] of Object.entries(all)) if ((c.n || '').toLowerCase().split(/[ (]/)[0] === low) return k; // "Kale" → Kale toscano
  const k = slug(t);
  data.cultivos = data.cultivos || {};
  if (!data.cultivos[k]) data.cultivos[k] = { n: t.slice(0, 40), en: t, rows: 0, esp: null, c: '#8f9c7a', met: 'existente', dist: '', sem: 8, dur: 6, kg: 0, u: 'kg', cos: 0, nokg: true, menu: '', nota: 'Agregado desde el censo de camas', mo: 1 };
  return k;
}

// Ventana en la tierra para una línea del censo.
function windowFor(c, l, today) {
  const nota = (l.nota || '').toLowerCase();
  const durD = Math.max(2, Math.min(60, c.dur || 6)) * 7;
  if (/sacar|viej|quitar|arrancar/.test(nota)) return [today, addDays(today, 7)];
  if (/listo|cosech/.test(nota)) return [today, addDays(today, durD)];
  let fecha = DATE.test(l.fecha || '') ? l.fecha : (/reci|sembr|naci/.test(nota) ? today : null);
  if (fecha) {
    const h0 = addDays(fecha, Math.round((c.sem || 8) * factor(fecha, c) * 7));
    const h1 = addDays(h0, durD - 1);
    return [h0 < today ? today : h0, h1 < addDays(today, 14) ? addDays(today, 14) : h1];
  }
  return [today, addDays(today, durD)];
}

export async function saveCensus(env, cama, lineas, quien) {
  cama = String(cama || '').toUpperCase().trim();
  const B = BED[cama]; if (!B) return { error: 'Cama no existe' };
  if (!Array.isArray(lineas) || lineas.length > 20) return { error: 'Líneas inválidas' };
  const L = [];
  let total = 0;
  for (const l of lineas) {
    const m = Math.round(Number(l.m) * 100) / 100, cultivo = String(l.cultivo || '').trim().slice(0, 40);
    if (!(m > 0) || !cultivo) continue;
    total += m;
    L.push({ m, cultivo, nota: String(l.nota || '').trim().slice(0, 80), fecha: DATE.test(l.fecha || '') ? l.fecha : '' });
  }
  if (total > B.len + 0.01) return { error: `Son ${total} m y la cama mide ${B.len} m` };
  await ensure(env);
  await env.DB.prepare('INSERT INTO censo (cama, lineas, quien) VALUES (?, ?, ?)').bind(cama, JSON.stringify(L), String(quien || 'app').slice(0, 40)).run();

  // Plan vivo: quitar lo que está en la tierra en esta cama y poner lo que dice el censo.
  const live = await livePlan(env);
  const data = live ? JSON.parse(JSON.stringify(live.data)) : { siembras: PLANTINGS.map(plantingToObj), cultivos: {}, tareas: JSON.parse(JSON.stringify(EXTRA_TASKS)), semillas: Object.assign({}, STOCK) };
  if (!live) await savePlan(env, data, 'Claude', 'Plan inicial (copia del código)');
  applyPlanData(data);
  const plan = buildPlan();
  const today = isoMX();
  const w = Math.floor((new Date(today + 'T12:00:00') - new Date(PLAN_START + 'T12:00:00')) / (7 * DAY));
  const inGround = new Set();
  const valid = data.siembras.filter(o => CROPS[o.cultivo] && BED[o.cama]); // mismo orden que plan.P
  plan.P.forEach((p, i) => { if (p.bed === cama && (p.ex || p.s <= w) && p.end >= w) inGround.add(valid[i] && valid[i].id); });
  const quitados = data.siembras.filter(o => inGround.has(o.id));
  data.siembras = data.siembras.filter(o => !inGround.has(o.id));
  let next = Math.max(0, ...data.siembras.map(x => +String(x.id).slice(1) || 0), ...quitados.map(x => +String(x.id).slice(1) || 0)) + 1;
  let pos = 0;
  const fecha = today.slice(8, 10) + '/' + today.slice(5, 7);
  for (const l of L) {
    const k = cropKey(l.cultivo, data);
    const c = Object.assign({}, CROPS[k] || {}, (data.cultivos || {})[k] || {});
    const o = { id: 's' + next++, cama, cultivo: k, siembra: '', pos: Math.round(pos * 100) / 100, m: l.m, ex: windowFor(c, l, today), note: (l.nota ? l.nota + ' · ' : '') + 'censo ' + fecha + (l.fecha ? ', sembrado ' + l.fecha : '') };
    if (o.pos + o.m > B.len) o.m = Math.round((B.len - o.pos) * 100) / 100;
    if (o.m > 0) data.siembras.push(o);
    pos += l.m;
  }
  const resumen = L.length ? L.map(l => `${l.m} m ${l.cultivo}`).join(', ') : 'vacía';
  const v = await savePlan(env, data, quien || 'Adrián (censo)', `Censo ${cama}: ${resumen}`);
  applyPlanData(data);
  const issues = buildPlan().issues.filter(i => i.startsWith(cama + ':'));
  return { ok: true, version: v, cama, lineas: L, quitados: quitados.map(o => o.cultivo), problemas: issues };
}
