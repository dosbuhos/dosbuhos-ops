// Motor del plan: calcula ventanas de cosecha, tareas semanales, horas y pronósticos.
// Cada siembra ocupa un tramo de la cama: pos (m desde el norte en A / desde el oeste en B) y m (metros).
const BEDS = (() => {
  const b = [];
  for (let i = 1; i <= 24; i++) b.push({id: "A" + i, area: 5, len: 5, sec: "A", q: ["A-NO","A-NE","A-SO","A-SE"][Math.floor((i - 1) / 6)]});
  for (let i = 1; i <= 10; i++) b.push({id: "B" + i, area: 13.3, len: 9.5, sec: "B", q: i <= 5 ? "B-O" : "B-E"});
  // Invernaderos VEVOR (8.3 × 2.9 m) entre las secciones, a cada lado del pasillo central: camas de 1 × 8 m.
  // El lado sur del invernadero este es la mesa de semillero (no es cama).
  for (let i = 1; i <= 3; i++) b.push({id: "I" + i, area: 8, len: 8, sec: "I", q: "I"});
  return b;
})();
const BED = Object.fromEntries(BEDS.map(b => [b.id, b]));
const DAY = 86400000;
const D = s => new Date(s + "T12:00:00");
const wk = s => Math.round((D(s) - D(PLAN_START)) / (7 * DAY));
const wkDate = w => new Date(D(PLAN_START).getTime() + w * 7 * DAY);
const MES = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
const MESL = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
const fmt = d => d.getDate() + " " + MES[d.getMonth()];
const mtxt = m => (Number.isInteger(m) ? m : m.toFixed(1)) + " m";

function factor(sow, crop) {
  if (crop.nofactor) return 1;
  const m = D(sow).getMonth();
  if (m === 10 || m === 11 || m === 0) return 1.3;
  if (m === 9 || m === 1) return 1.15;
  return 1;
}
const overlaps = (a, b) => a.pos < b.pos + b.m - 1e-9 && b.pos < a.pos + a.m - 1e-9;

function buildPlan() {
  const byBed = {};
  const P = PLANTINGS.map(([bed, crop, sow, opt], i) => {
    opt = opt || {};
    const c = CROPS[crop];
    const B = BED[bed];
    const m = opt.m ?? B.len, pos = opt.pos ?? 0;
    const frac = m / B.len;
    const ex = opt.ex || null;
    const s = ex ? 0 : wk(sow);
    const direct = !!opt.d;
    const tray = !ex && ((c.met === "plántula" && !direct) || !!opt.t);
    const char = opt.char ?? c.char;
    const esp = opt.esp ?? c.esp;
    const h0 = ex ? wk(ex[0]) : opt.t ? s + Math.ceil((opt.tsem ?? 3) * (B.sec === "I" ? 1 : factor(sow, c))) : s + Math.ceil((c.sem + (direct && c.char ? c.char : 0)) * (B.sec === "I" ? 1 : factor(sow, c)));
    const h1 = ex ? wk(ex[1]) : h0 + c.dur - 1;
    const plants = esp ? c.rows * Math.floor(m / esp) : 0;
    const cells = tray ? Math.ceil(plants * 1.3) : 0;
    const p = {i, bed, crop, c, sow, s, h0, h1, m, pos, frac, ex: !!ex, area: B.area * frac, scale: B.area * frac / 5,
      direct, tray, ts: tray ? s - char : null, plants, cells, trays: Math.ceil(cells / (typeof TRAY_CELLS !== "undefined" ? TRAY_CELLS : 72)), note: opt.note || ""};
    (byBed[bed] = byBed[bed] || []).push(p);
    return p;
  });
  const issues = [];
  P.forEach(p => { if (p.tray && p.ts < 0) issues.push(`${p.bed}: ${p.crop} necesita semillero desde antes del inicio (sem ${p.ts})`); });
  for (const bed of Object.keys(byBed)) {
    const list = byBed[bed].sort((a, b) => a.s - b.s || a.pos - b.pos);
    list.forEach(p => {
      if (p.pos + p.m > BED[bed].len + 1e-9) issues.push(`${bed}: ${p.crop} se sale de la cama`);
      const prev = list.filter(q => q !== p && q.s < p.s && overlaps(p, q));
      const next = list.filter(q => q !== p && q.s > p.s && overlaps(p, q)).sort((a, b) => a.s - b.s)[0];
      const same = list.filter(q => q !== p && q.s === p.s && overlaps(p, q));
      if (same.length) issues.push(`${bed}: ${p.crop} y ${same[0].crop} ocupan el mismo tramo`);
      p.prev = prev.sort((a, b) => b.s - a.s)[0] || null;
      p.first = !p.prev;
      p.end = next ? Math.min(p.h1, next.s - 1) : p.h1;
      if (next && next.s <= p.h0 && !p.c.nokg) issues.push(`${bed}: ${p.crop} (cosecha desde sem ${p.h0}) choca con ${next.crop} sem ${next.s}`);
      if (next && next.s - 1 < p.h1 - 1 && !p.ex) issues.push(`${bed}: ${p.crop} pierde ${p.h1 - (next.s - 1)} sem por ${next.crop}`);
      p.prepW = p.ex ? null : p.first ? Math.max(0, p.s - 1) : p.s;
    });
    // ocupación: una siembra nueva no puede entrar donde hay un cultivo existente activo
    list.forEach(p => list.forEach(q => { if (q !== p && overlaps(p, q) && q.s < p.s && q.end >= p.s) issues.push(`${bed}: ${p.crop} entra (sem ${p.s}) antes de que termine ${q.crop} (sem ${q.end})`); }));
  }
  return {P, byBed, issues};
}

// tramos de una cama en una semana: [{p, st, pos, m}]
function bedSegs(plan, bed, w) {
  const list = plan.byBed[bed] || [];
  const out = [];
  for (const p of list) {
    if (w >= p.s && w <= p.end) out.push({p, st: w >= p.h0 && !p.c.nokg ? "cosecha" : "crece", pos: p.pos, m: p.m});
  }
  for (const p of list) if (w === p.prepW && !out.some(o => overlaps(o, p))) out.push({p, st: "prepara", pos: p.pos, m: p.m});
  return out.sort((a, b) => a.pos - b.pos);
}
// compatibilidad: el tramo más grande
function bedState(plan, bed, w) {
  const s = bedSegs(plan, bed, w).sort((a, b) => b.m - a.m)[0];
  return s ? {p: s.p, st: s.st} : {p: null, st: "libre"};
}

function traysActive(plan, w){ return plan.P.filter(p => p.tray && w >= p.ts && w < p.s); }
const BASE_TASKS = [
  {d:1, t:"Revisar riego: abrir el goteo, caminar cada cama y destapar goteros", min:45},
  {d:4, t:"Deshierbe general de pasillos y camas", min:180},
  {d:5, t:"Fotos por WhatsApp: una foto de cada cuadrante (A-NO, A-NE, A-SO, A-SE, B-O, B-E)", min:20},
  {d:5, t:"Composta: voltear la pila y agregar restos de cosecha", min:45},
  {d:5, t:"Preparar las experiencias de visitantes de la semana (ver pestaña Experiencias)", min:45},
];

function where(p) { return p.frac < 0.999 ? `${p.bed} (${mtxt(p.m)})` : p.bed; }

function weekTasks(plan, w) {
  const T = [];
  const d0 = w === 0 && typeof FIRST_DAY !== "undefined" ? FIRST_DAY : 1;
  BASE_TASKS.forEach((b, k) => T.push({id: "base" + k, d: Math.max(d0, b.d), t: b.t, min: b.min, k: "base"}));
  (typeof EXTRA_TASKS !== "undefined" ? EXTRA_TASKS : []).filter(x => wk(x.w) === w).forEach((x, k) => T.push({id: "x" + w + "-" + k, d: x.d || 1, t: x.t, min: x.min, k: x.k || "prep", bed: x.bed}));
  if (traysActive(plan, w).length || plan.P.some(p => p.tray && p.ts === w)) for (let d = d0; d <= 5; d++) T.push({id: "sem-riego" + d, d, t: "Revisar y regar las charolas del semillero (en la mañana; tapar si hay riesgo de helada)", min: 15, k: "base"});
  for (const p of plan.P) {
    const k = p.area / 5;
    if (p.tray && w === p.ts) T.push({id: `ch${p.i}`, d: 1, b: p.c.n, t: `Sembrar ${p.cells * 2} semillas en charola, 2 por cavidad · Destino: ${where(p)} · Trasplante ≈ ${fmt(wkDate(p.s))} · ${p.c.u === "flores" ? "Flores" : "Cosecha"} ≈ ${fmt(wkDate(p.h0))}`, min: 15 + 20 * p.trays, k: "semillero", bed: p.bed});
    if (p.tray && w === p.s - 1) T.push({id: `en${p.i}`, d: 1, b: p.c.n, t: `Endurecer: sacar la charola al sol y al viento toda la semana y regar menos · Destino: ${where(p)} · Trasplante ≈ ${fmt(wkDate(p.s))} · ${p.c.u === "flores" ? "Flores" : "Cosecha"} ≈ ${fmt(wkDate(p.h0))}`, min: 10, k: "semillero", bed: p.bed});
    if (p.prepW !== null && w === p.prepW) {
      const prev = p.prev;
      const txt = prev
        ? `Preparar ${where(p)}: retirar ${prev.c.n.toLowerCase()}, 2 cm de composta, aflojar con bieldo`
        : `Limpiar ${where(p)}: retirar lo que no se queda, 2 cm de composta, aflojar con bieldo sin voltear`;
      T.push({id: `p${p.i}`, d: 1, t: txt, min: (prev ? 60 : 90) * k, k: "prep", bed: p.bed});
    }
    if (!p.ex && w === p.s) {
      const verbo = p.tray ? "Trasplantar del semillero" : p.c.met === "propia" ? "Trasplantar" : p.c.met === "bulbo" ? "Plantar" : p.c.met === "división" ? "Replantar (dividir matas)" : "Sembrar directo";
      const mm = p.tray || p.c.met === "división" || p.c.met === "propia" ? 45 : p.c.met === "bulbo" ? 45 : 25;
      const how = p.direct ? `semilla directa, ${p.c.rows} hileras sobre goteo; ralear a ${Math.round(p.c.esp * 100)} cm` : p.c.dist;
      T.push({id: `s${p.i}`, d: 2, b: p.c.n, t: `${verbo} en ${where(p)}: ${how}${p.c.nokg ? "" : ` · ${p.c.u === "flores" ? "Flores" : "Cosecha"} ≈ ${fmt(wkDate(p.h0))}`}`, min: mm * k, k: "siembra", bed: p.bed});
    }
    if (!p.ex && (p.c.ralear || p.direct) && w === p.s + 3) T.push({id: `r${p.i}`, d: 3, b: p.c.n, t: `Ralear en ${where(p)}`, min: 30 * k, k: "cuidado", bed: p.bed});
    if (!p.ex && p.c.tutor && w === p.s + 3) T.push({id: `t${p.i}`, d: 3, b: p.c.n, t: `Poner tutor o malla en ${where(p)}`, min: 60 * p.frac, k: "cuidado", bed: p.bed});
    if (p.c.semilla && w === p.end) T.push({id: `sm${p.i}`, d: 3, t: `Cosechar la semilla en ${where(p)}, secarla a la sombra y guardarla en frasco con etiqueta`, min: 45, k: "cuidado", bed: p.bed});
    if (!p.c.nokg && w >= p.h0 && w <= p.end) {
      T.push({id: `h${p.i}`, d: 0, t: `Cosechar ${p.c.n.toLowerCase()} en ${where(p)}`, min: Math.max(10, p.c.cos * p.scale), k: "cosecha", bed: p.bed, crop: p.crop, qty: p.c.kg * p.scale, u: p.c.u});
    }
  }
  // una sola tarea de preparación por cama y semana (camas completas o mitades que se preparan juntas)
  const prepBy = {};
  plan.P.filter(p => p.prepW !== null && w === p.prepW).forEach(p => (prepBy[p.bed] = prepBy[p.bed] || []).push(p));
  for (const [bed, ps] of Object.entries(prepBy)) {
    if (ps.length < 2) continue;
    const ids = new Set(ps.map(p => `p${p.i}`));
    const first = T.findIndex(t => ids.has(t.id));
    const mins = T.filter(t => ids.has(t.id)).reduce((a, t) => a + t.min, 0);
    const m = ps.reduce((a, p) => a + p.m, 0);
    const lbl = m >= BED[bed].len - 1e-9 ? `${bed} (cama completa)` : `${bed} (${mtxt(m)})`;
    const prevs = [...new Set(ps.filter(p => p.prev).map(p => p.prev.c.n.toLowerCase()))];
    const t = prevs.length ? `Preparar ${lbl}: retirar ${prevs.join(" y ")}, 2 cm de composta, aflojar con bieldo` : `Limpiar ${lbl}: retirar lo que no se queda, 2 cm de composta, aflojar con bieldo sin voltear`;
    const keep = {...T[first], t, min: mins};
    for (let j = T.length - 1; j >= 0; j--) if (ids.has(T[j].id)) T.splice(j, 1);
    T.splice(first, 0, keep);
  }
  // repartir trabajo en los días: en orden (semillero → preparar → sembrar → cuidar), sin pasar de ~7.5 h por día
  const harvMin = T.filter(t => t.k === "cosecha").reduce((a, t) => a + t.min, 0);
  const load = [0, 0, 0, 0, 0, 0];
  T.filter(t => t.k === "base").forEach(t => load[t.d] += t.min);
  const hd = [1, 3, 5].filter(d => d >= d0); hd.forEach(d => load[d] += harvMin / hd.length);
  const ord = {semillero: 0, prep: 1, siembra: 2, cuidado: 3};
  const bn = id => id ? id.charCodeAt(0) * 100 + parseInt(id.slice(1)) : 0;
  const work = T.filter(t => t.k in ord).sort((a, b) => ord[a.k] - ord[b.k] || bn(a.bed) - bn(b.bed));
  let day = d0;
  for (const t of work) {
    while (day < 5 && load[day] + t.min > 450) day++;
    t.d = day; load[day] += t.min;
  }
  return T;
}

function weekHours(plan, w) { return weekTasks(plan, w).reduce((a, t) => a + t.min, 0) / 60; }

// pronóstico: por mes calendario, cantidad por cultivo
function forecast(plan) {
  const out = {};
  for (const p of plan.P) { if (p.c.nokg) continue; for (let w = Math.max(0, p.h0); w <= p.end; w++) {
    const d = wkDate(w); d.setDate(d.getDate() + 2);
    const key = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
    out[key] = out[key] || {};
    out[key][p.crop] = (out[key][p.crop] || 0) + p.c.kg * p.scale;
  } }
  return out;
}

// Plan editable: la copia viva vive en la base de datos (tabla plan). Formato: {siembras:[{id,cama,cultivo,siembra,...}], cultivos:{clave:{...}}, tareas:[...], semillas:{...}}.
const OPT_KEYS = ["pos", "m", "ex", "d", "t", "char", "esp", "tsem", "note"];
function plantingToObj(x, i) { const o = {id: "s" + (i + 1), cama: x[0], cultivo: x[1], siembra: x[2] || ""}; const op = x[3] || {}; OPT_KEYS.forEach(k => { if (op[k] !== undefined) o[k] = op[k]; }); return o; }
function objToPlanting(o) { const op = {}; OPT_KEYS.forEach(k => { if (o[k] !== undefined && o[k] !== null && o[k] !== "") op[k] = o[k]; }); return [o.cama, o.cultivo, o.siembra || "", op]; }
function applyPlanData(data) {
  if (!data) return false;
  if (data.cultivos) for (const [k, c] of Object.entries(data.cultivos)) CROPS[k] = Object.assign({}, CROPS[k] || {}, c);
  if (Array.isArray(data.siembras)) PLANTINGS.splice(0, PLANTINGS.length, ...data.siembras.filter(o => CROPS[o.cultivo] && BED[o.cama]).map(objToPlanting));
  if (Array.isArray(data.tareas) && typeof EXTRA_TASKS !== "undefined") EXTRA_TASKS.splice(0, EXTRA_TASKS.length, ...data.tareas);
  if (data.semillas && typeof STOCK !== "undefined") { for (const k of Object.keys(STOCK)) delete STOCK[k]; Object.assign(STOCK, data.semillas); }
  return true;
}

if (typeof module !== "undefined" && module.exports) module.exports = {traysActive, BEDS, BED, buildPlan, bedState, bedSegs, weekTasks, weekHours, forecast, wk, wkDate, fmt};
