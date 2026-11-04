// Bottling plan review: Claude reads the plan (coll "bottling") against each wine's latest Excellovint rows and leaves a
// short summary + per-wine flags in docs bottling_review/latest. Runs from the cron at 12:00, 16:00 and 19:00 (San Miguel, UTC−6)
// and on demand (POST /api/bottling/review, Eric/Diane only). It never changes the plan: suggestions are applied by a person.
const TODAY = () => new Date(Date.now() - 6 * 3600e3).toISOString().slice(0, 10);

export async function reviewBottling(env, by) {
  if (!env.ANTHROPIC_API_KEY) throw Object.assign(new Error('ANTHROPIC_API_KEY no está configurada.'), { status: 503 });
  const plan = (await env.DB.prepare("SELECT id, data FROM docs WHERE coll = 'bottling'").all()).results.map(r => Object.assign({ id: r.id }, JSON.parse(r.data)));
  if (!plan.length) return { ok: true, skipped: 'no plan' };
  const lotIds = [...new Set(plan.flatMap(p => p.lots || []))];
  const lots = (await env.DB.prepare(`SELECT id, data FROM docs WHERE coll = 'lots' AND id IN (${lotIds.map(() => '?').join(',')})`).bind(...lotIds).all()).results.map(r => Object.assign({ id: r.id }, JSON.parse(r.data)));
  const tabs = [...new Set(lots.flatMap(l => (l.sheet || []).map(s => s.tab)).filter(Boolean))];
  const since = new Date(Date.parse(TODAY()) - 21 * 864e5).toISOString().slice(0, 10);
  const rows = tabs.length ? (await env.DB.prepare(`SELECT tab, row, date, ubi, volf, ph, at, am, sl, st, aa, note, asig, ini FROM xl_rows WHERE tab IN (${tabs.map(() => '?').join(',')}) AND date >= ? ORDER BY tab, date, row`).bind(...tabs, since).all()).results : [];
  const prev = await env.DB.prepare("SELECT data FROM docs WHERE coll = 'bottling_review' AND id = 'latest'").first();
  const slim = r => [r.date, r.ubi, r.volf && 'L ' + r.volf, r.ph && 'pH ' + r.ph, r.at && 'TA ' + r.at, r.am && 'malic ' + r.am, r.sl && 'free ' + r.sl, r.st && 'total ' + r.st, r.aa && 'VA ' + r.aa, String(r.note || '').slice(0, 500), r.asig && ('asig ' + r.asig + (r.ini ? ' done ' + r.ini : ' OPEN'))].filter(Boolean).join(' | ');
  const ctx = plan.sort((a, b) => (a.order || 0) - (b.order || 0)).map(p => {
    const ls = lots.filter(l => (p.lots || []).includes(l.id)), ts = [...new Set(ls.flatMap(l => (l.sheet || []).map(s => s.tab)))];
    const { by: _b, at: _a, order: _o, ...pl } = p;
    return `### ${p.id}: ${p.name}\nPLAN: ${JSON.stringify(pl)}\nLOTS: ${ls.map(l => l.name + ' (' + (l.ubi || '') + ')').join('; ')}\nROWS (last 21 days, ${ts.join(', ')}):\n${rows.filter(r => ts.includes(r.tab)).map(slim).join('\n') || '(none)'}`;
  }).join('\n\n');
  const prompt = `You review the bottling plan of Bodega Dos Búhos (certified organic winery, San Miguel de Allende) for the owner Eric and the head winemaker Diane. Today is ${TODAY()}.
House rules: target total SO2 under 50; molecular SO2 = free / (1 + 10^(pH − 1.81)); KMBS grams = ppm × L ÷ 576; heat test passes at Δ ≤ 2 NTU with the FILTERED method — the 20/10 unfiltered heat tests over-read and do not count; the filtered bentonite series of 30/10–2/11 are the valid results (0 g/hL jar = control). No casein, no PVPP. Reds are never filtered. Wines meant to finish ML get no SO2 until ML is done.
For each wine below you get the current plan and its Excellovint rows from the last 21 days. Find where the plan is now stale or contradicted by newer rows (new readings, additions done, orders completed or cancelled with XX, dates passed), readings that are old (>14 days) for a decision that depends on them, and anything risky (free SO2 well below the hold target, VA rising, open urgent orders). Do not repeat what the plan already says. Be concrete (numbers, dates d/m, row numbers). Never invent data.
Reply with JSON only: {"summary":[3–6 short bullets in English for Eric and Diane, most important first],"flags":[{"id":"<wine id>","field":"<one of: q, date, vessel, hold, holdNote, so2.v, so2.p, protein.p, pad.p, sterile.p, protein.k>","issue":"<one sentence>","suggest":"<replacement text for that field, or empty if none>"}]} — at most 2 flags per wine, only where something actually changed or is wrong.

${ctx}`;
  const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST',
    headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: env.AI_MODEL || 'claude-sonnet-5-5', max_tokens: 6000, system: 'Reply with one JSON value only. No prose, no code fences.', messages: [{ role: 'user', content: prompt }] }) });
  if (!r.ok) throw Object.assign(new Error('Claude: ' + (await r.text()).slice(0, 300)), { status: 502 });
  const j = await r.json(), text = (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
  let out; try { out = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch (e) { throw Object.assign(new Error('Claude devolvió algo que no es JSON.'), { status: 502 }); }
  const ids = new Set(plan.map(p => p.id));
  const doc = { at: new Date().toISOString(), by: by || 'cron', summary: (out.summary || []).map(String).slice(0, 8), flags: (out.flags || []).filter(f => f && ids.has(f.id)).slice(0, 40), rows: rows.length };
  const now = Date.now();
  await env.DB.prepare("INSERT INTO docs (coll, id, data, updated_at) VALUES ('bottling_review', 'latest', ?, ?) ON CONFLICT(coll, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at").bind(JSON.stringify(doc), now).run();
  await env.DB.prepare("INSERT OR REPLACE INTO docs (coll, id, data, updated_at) VALUES ('bottling_review_log', ?, ?, ?)").bind(doc.at.slice(0, 16), JSON.stringify(doc), now).run();
  return { ok: true, summary: doc.summary.length, flags: doc.flags.length, prev: !!prev };
}
