// Living app: 3×/day (12:00, 16:00, 19:00 San Miguel) Claude reads every active wine — its plan (path to bottle, open
// questions, location, bottling row) against its latest Excellovint rows — and keeps the plan current.
// Facts with evidence are applied (a path stage done with the row that proves it, the location/liters text);
// judgment calls stay as suggestions a person applies. Everything applied is kept with its previous value (undo).
// Result per wine: docs lotreview/<lotId>.
const TODAY = () => new Date(Date.now() - 6 * 3600e3).toISOString().slice(0, 10);
const AUTO_STEPS = new Set(['start', 'ferm', 'ml', 'rack']);

async function callClaude(env, prompt, max) {
  const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST',
    headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: env.AI_MODEL || 'claude-sonnet-5-5', max_tokens: max || 3000, system: 'Reply with one JSON object only. No prose, no code fences.', messages: [{ role: 'user', content: prompt }] }) });
  if (!r.ok) throw Object.assign(new Error('Claude ' + r.status + ': ' + (await r.text()).slice(0, 200)), { status: 502 });
  const j = await r.json(), text = (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  try { return JSON.parse(text.slice(a, b + 1)); } catch (e) { throw Object.assign(new Error('Claude: respuesta no es JSON (' + (j.stop_reason || '') + ')'), { status: 502 }); }
}

function rowsForLot(lot, rows) {
  const tabs = (lot.sheet || []).filter(s => s.tab);
  return rows.filter(r => tabs.some(s => {
    if (s.tab !== r.tab) return false;
    if (s.match && r.ubi) { try { if (!new RegExp(s.match, 'i').test(r.ubi)) return false; } catch (e) {} }
    return true;
  }));
}

export async function reviewLot(env, lot, ctx) {
  const { rows, bottling, by } = ctx;
  const since = new Date(Date.parse(TODAY()) - 45 * 864e5).toISOString().slice(0, 10);
  const mine = rowsForLot(lot, rows);
  const recent = mine.filter(r => (r.date || '') >= since || (r.asig && !r.ini)).slice(-120);
  const latest = {};
  for (const r of mine) for (const k of ['volf', 'ph', 'at', 'am', 'sl', 'st', 'aa']) if (r[k] !== '' && r[k] != null && (r.date || '') <= TODAY()) latest[k] = { v: r[k], d: r.date, row: r.tab + ' ' + r.row };
  const path = Array.isArray(lot.path) ? lot.path : null;
  const bRows = bottling.filter(b => (b.lots || []).includes(lot.id));
  const slim = r => [r.tab + ' row ' + r.row, r.date, r.ubi, r.volf && 'L ' + r.volf, r.ph && 'pH ' + r.ph, r.at && 'TA ' + r.at, r.am && 'malic ' + r.am, r.sl && 'free ' + r.sl, r.st && 'total ' + r.st, r.aa && 'VA ' + r.aa,
    String(r.note || '').slice(0, 450), r.asig ? (r.ini ? (/^XX$/i.test(r.ini) ? 'CANCELLED (XX)' : 'done by ' + r.ini) : 'OPEN, assigned ' + r.asig) : ''].filter(Boolean).join(' | ');
  const prompt = `You keep the cellar app of Bodega Dos Búhos (certified organic winery, San Miguel de Allende) up to date for the owner Eric and head winemaker Diane. Today is ${TODAY()}. The crew logs work in Excellovint (rows below); the app's plan for this wine must reflect what has actually been done.
House rules: total SO2 under 50; molecular SO2 = free / (1 + 10^(pH − 1.81)); KMBS g = ppm × L ÷ 576; heat test passes at Δ ≤ 2 NTU, FILTERED method only (the 20/10 unfiltered tests over-read and do not count; the 30/10–2/11 bentonite series are valid, the 0 g/hL jar is the control). Initials "XX" = cancelled, not done. A row with a date in the future is a planned order. Reds are never filtered; wines meant to finish ML get no SO2 until ML is done.

WINE: ${lot.name} (id ${lot.id}, group ${lot.group || ''})
LOCATION TEXT (ubi): ${lot.ubi || '(none)'}
LATEST READINGS: ${JSON.stringify(latest)}
PATH TO BOTTLE (index: stage): ${path ? path.map((x, i) => `${i}: ${x.t}${x.st ? ' [' + x.st + ']' : ''}${x.d ? ' d=' + x.d : ''}${x.dt ? ' dt=' + x.dt : ''}${x.n ? ' note=' + x.n : ''}${x.auto ? ' (auto-filled by the app)' : ''}${x.task ? ' (linked to a calendar task)' : ''}`).join('\n') : '(default path, not set for this wine)'}
OPEN QUESTIONS (index: q → a): ${(lot.pathQs || []).map((q, i) => `${i}: ${q.q} → ${q.a || '(no answer)'}`).join(' · ') || '(none)'}
BOTTLING PLAN ROWS: ${bRows.length ? bRows.map(b => `${b.id}: ${JSON.stringify({ date: b.date, vessel: b.vessel, protein: b.protein, pad: b.pad, sterile: b.sterile, hold: b.hold, holdNote: b.holdNote, so2: b.so2, q: b.q })}`).join('\n') : '(none)'}
EXCELLOVINT ROWS (last 45 days + anything still open):
${recent.map(slim).join('\n') || '(none)'}

Return JSON:
{"status":"one sentence: where this wine is right now (vessel, liters, stage)",
 "next":["up to 3 concrete next actions, most urgent first, citing open orders by tab+row when they exist"],
 "pathDone":[{"i":<stage index>,"d":"YYYY-MM-DD","row":"<tab> row <n>","why":"short"}],   // ONLY stages that a done row clearly proves, never auto-filled stages, never cancelled (XX) rows; [] if the path is the default
 "ubi":"new location text, only if the rows prove the current one is wrong (vessel or liters changed); else empty",
 "suggest":[{"field":"<path.<i>.n | path.<i>.d | pathQs.<i>.a | bottling.<rowId>.<q|date|vessel|hold|holdNote|so2.v|so2.p|protein.p|pad.p|sterile.p> | none>","issue":"one sentence","value":"replacement text or empty"}]}
Rules: never invent numbers or events; cite dates as d/m; English; keep every string short; at most 4 suggestions; only suggest where a row shows something changed or a decision depends on a stale (>14 days) reading.`;
  const out = await callClaude(env, prompt, 2500);
  // Apply facts with evidence.
  const applied = [], upd = {};
  if (path && Array.isArray(out.pathDone)) {
    const np = path.map(x => Object.assign({}, x));
    for (const p of out.pathDone) {
      const i = +p.i, x = np[i];
      if (!x || x.st === 'done' || x.st === 'skip' || (x.auto && AUTO_STEPS.has(x.auto)) || x.task || !p.row) continue;
      const prev = { st: x.st || '', d: x.d || '' };
      x.st = 'done'; if (!x.d && /^\d{4}-\d{2}-\d{2}$/.test(p.d || '')) x.d = p.d;
      applied.push({ kind: 'path', i, t: x.t, prev, now: { st: x.st, d: x.d || '' }, row: p.row, why: String(p.why || '') });
    }
    if (applied.length) upd.path = np;
  }
  const nu = String(out.ubi || '').trim();
  if (nu && nu !== (lot.ubi || '') && nu.length < 140) { applied.push({ kind: 'ubi', prev: lot.ubi || '', now: nu }); upd.ubi = nu; }
  if (Object.keys(upd).length) {
    const cur = await env.DB.prepare("SELECT data FROM docs WHERE coll = 'lots' AND id = ?").bind(lot.id).first();
    if (cur) await env.DB.prepare("UPDATE docs SET data = ?, updated_at = ? WHERE coll = 'lots' AND id = ?").bind(JSON.stringify(Object.assign(JSON.parse(cur.data), upd)), Date.now(), lot.id).run();
  }
  const doc = { at: new Date().toISOString(), by: by || 'cron', status: String(out.status || ''), next: (out.next || []).map(String).slice(0, 3), applied,
    suggest: (out.suggest || []).filter(s => s && s.issue).slice(0, 4).map(s => ({ field: String(s.field || 'none'), issue: String(s.issue), value: String(s.value || '') })) };
  await env.DB.prepare("INSERT INTO docs (coll, id, data, updated_at) VALUES ('lotreview', ?, ?, ?) ON CONFLICT(coll, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at").bind(lot.id, JSON.stringify(doc), Date.now()).run();
  return doc;
}

async function loadCtx(env, by) {
  const [lots, bottling, rows] = await Promise.all([
    env.DB.prepare("SELECT id, data FROM docs WHERE coll = 'lots'").all(),
    env.DB.prepare("SELECT id, data FROM docs WHERE coll = 'bottling'").all(),
    env.DB.prepare("SELECT tab, row, date, ubi, volf, ph, at, am, sl, st, aa, note, asig, ini FROM xl_rows ORDER BY COALESCE(date, ''), row").all()]);
  return { by,
    lots: lots.results.map(r => Object.assign({ id: r.id }, JSON.parse(r.data))).filter(l => !l.archived && !l.bottled && (l.sheet || []).some(s => s.tab)),
    bottling: bottling.results.map(r => Object.assign({ id: r.id }, JSON.parse(r.data))), rows: rows.results };
}

export async function reviewOne(env, lotId, by) {
  if (!env.ANTHROPIC_API_KEY) throw Object.assign(new Error('ANTHROPIC_API_KEY no está configurada.'), { status: 503 });
  const ctx = await loadCtx(env, by), lot = ctx.lots.find(l => l.id === lotId);
  if (!lot) throw Object.assign(new Error('Vino no encontrado o sin pestaña de Excellovint.'), { status: 404 });
  return reviewLot(env, lot, ctx);
}

export async function reviewAll(env) {
  if (!env.ANTHROPIC_API_KEY) return;
  const ctx = await loadCtx(env, 'cron'); let ok = 0, fail = 0;
  for (let i = 0; i < ctx.lots.length; i += 5) {   // 5 at a time
    const res = await Promise.allSettled(ctx.lots.slice(i, i + 5).map(l => reviewLot(env, l, ctx)));
    for (const r of res) r.status === 'fulfilled' ? ok++ : (fail++, console.log('lot review failed', r.reason && r.reason.message));
  }
  await env.DB.prepare("INSERT INTO docs (coll, id, data, updated_at) VALUES ('lotreview', '_run', ?, ?) ON CONFLICT(coll, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at").bind(JSON.stringify({ at: new Date().toISOString(), ok, fail }), Date.now()).run();
}
