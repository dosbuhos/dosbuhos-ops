// "Pregúntale al club" — optional AI helper. The model never sees SQL or the database: it can only call the
// read-only functions below, which reuse the same schedule engine as the agenda. Nothing here writes.
//
// Model: Workers AI (binding AI, model AI_MODEL) by default; or any OpenAI-compatible chat API when
// AI_API_URL (+ secret AI_API_KEY, AI_MODEL) are set.

import { loadContext, allOccurrences, subOccurrences, subClub } from './data.js';
import { addDays } from './schedule.js';

const DEFAULT_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const STATE_EN = { done: 'COMPLETED', skipped: 'SKIPPED', paused: 'PAUSED', pretracking: 'BEFORE_TRACKING', exception: 'EXCEPTION', overdue: 'OVERDUE', today: 'DUE_TODAY', upcoming: 'FUTURE' };
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

function shipmentFacts(o, withBottles = false) {
  const r = {
    member: o.sub.member_name, member_id: o.sub.member_id, club: o.club.name, shipment_number: o.n,
    scheduled_date: o.due, effective_date: o.eff, status: STATE_EN[o.state],
    staff_status: o.status || null, delayed_until: o.delayed ? o.eff : null,
    completed_on: o.f?.done_on || null, delivered_on: o.f?.delivered_on || null, order_ref: o.f?.order_ref || null,
    bottles_expected: o.expectedBottles, bottles_defined: o.bottles ? o.bottlesTotal : 0,
    delivery: o.sub.delivery_pref === 'envio' ? 'delivery' : 'pickup',
  };
  if (withBottles) r.packing_list = o.bottles || 'NOT DEFINED';
  return r;
}

// ---------- the only data the model can reach ----------
export const TOOLS = [
  { name: 'club_summary', description: 'Counts of overdue, due-today and upcoming shipments, active members per club, and today\'s date.', parameters: { type: 'object', properties: {} } },
  { name: 'find_members', description: 'Search members by name or email (partial match). Returns ids, clubs and subscription status.', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
  { name: 'list_shipments', description: 'Shipments of all members filtered by status. status: overdue | today | upcoming | completed. For upcoming/completed, days limits the window (default 30).', parameters: { type: 'object', properties: { status: { type: 'string', enum: ['overdue', 'today', 'upcoming', 'completed'] }, days: { type: 'number' } }, required: ['status'] } },
  { name: 'member_shipments', description: 'Full shipment history and schedule for one member (past, overdue, future) with fulfillment details.', parameters: { type: 'object', properties: { member_id: { type: 'number' } }, required: ['member_id'] } },
  { name: 'packing_list', description: 'Bottles for one shipment of a member. shipment_number optional: defaults to the next open shipment.', parameters: { type: 'object', properties: { member_id: { type: 'number' }, shipment_number: { type: 'number' } }, required: ['member_id'] } },
];

async function runTool(env, name, args = {}) {
  const ctx = await loadContext(env);
  const today = ctx.today;
  const { occ, unmapped } = allOccurrences(ctx, addDays(today, 400));
  const byEff = (a, b) => a.eff.localeCompare(b.eff);
  switch (name) {
    case 'club_summary': {
      const perClub = {};
      for (const s of ctx.subs) {
        const c = subClub(ctx, s);
        if (c && !['canceled', 'incomplete_expired', 'manual_ended'].includes(s.status)) perClub[c.name] = (perClub[c.name] || 0) + 1;
      }
      return { today, overdue: occ.filter(o => ['overdue', 'exception'].includes(o.state)).length, due_today: occ.filter(o => o.state === 'today').length,
        upcoming_next_7_days: occ.filter(o => o.state === 'upcoming' && o.eff <= addDays(today, 7)).length,
        active_members_by_club: perClub, subscriptions_without_club: unmapped.map(s => s.member_name) };
    }
    case 'find_members': {
      const q = norm(args.query);
      const rows = (await env.DB.prepare('SELECT id, name, email, delivery_pref FROM members').all()).results.filter(m => norm(m.name + ' ' + m.email).includes(q)).slice(0, 10);
      return rows.map(m => ({ member_id: m.id, name: m.name, email: m.email, delivery: m.delivery_pref === 'envio' ? 'delivery' : 'pickup',
        subscriptions: ctx.subs.filter(s => s.member_id === m.id).map(s => ({ club: subClub(ctx, s)?.name || 'NO CLUB', status: s.status, start: s.anchor_override || s.start_date })) }));
    }
    case 'list_shipments': {
      const days = Math.min(400, Math.max(1, Number(args.days) || 30));
      let list;
      if (args.status === 'overdue') list = occ.filter(o => ['overdue', 'exception'].includes(o.state));
      else if (args.status === 'today') list = occ.filter(o => o.state === 'today');
      else if (args.status === 'upcoming') list = occ.filter(o => o.state === 'upcoming' && o.eff <= addDays(today, days));
      else list = occ.filter(o => o.state === 'done' && (o.f?.done_on || o.due) >= addDays(today, -days));
      return { today, count: list.length, shipments: list.sort(byEff).slice(0, 60).map(o => shipmentFacts(o)) };
    }
    case 'member_shipments':
    case 'packing_list': {
      const mid = Number(args.member_id);
      const subs = ctx.subs.filter(s => s.member_id === mid);
      if (!subs.length) return { error: 'No member with that id' };
      const list = subs.flatMap(s => subOccurrences(ctx, s, addDays(today, 365)) || []).sort(byEff);
      if (name === 'member_shipments') return { today, member: subs[0].member_name, shipments: list.map(o => shipmentFacts(o)) };
      const pick = args.shipment_number ? list.find(o => o.n === Number(args.shipment_number))
        : list.find(o => ['overdue', 'exception', 'today', 'upcoming'].includes(o.state));
      return pick ? shipmentFacts(pick, true) : { error: 'Shipment not found' };
    }
  }
  return { error: 'Unknown function' };
}

const SYSTEM = (today) => `You are the assistant inside the Dos Búhos wine club staff app. Today is ${today} (America/Mexico_City).
Answer ONLY from function results. Never invent members, dates, bottles or statuses; if the data doesn't say, say you don't know.
Always call a function before answering a factual question. Statuses: COMPLETED (handed over/shipped/delivered), OVERDUE (date passed, not fulfilled), DUE_TODAY, FUTURE (scheduled), plus PAUSED/SKIPPED/BEFORE_TRACKING/EXCEPTION.
Be explicit about which shipments are completed, which are overdue and which are future. Use shipment numbers (#) and dates.
You cannot change anything; to act, staff use the agenda. Reply in the user's language (usually Spanish), briefly, plain text with short lists.`;

// ---------- model adapters ----------
async function callModel(env, messages) {
  if (env.AI_API_URL) {
    const r = await fetch(env.AI_API_URL, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${env.AI_API_KEY || ''}` },
      body: JSON.stringify({ model: env.AI_MODEL, messages, tools: TOOLS.map(t => ({ type: 'function', function: t })), temperature: 0 }) });
    if (!r.ok) throw new Error(`Modelo externo: ${r.status}`);
    const m = (await r.json()).choices?.[0]?.message || {};
    return { text: m.content || '', calls: (m.tool_calls || []).map(c => ({ id: c.id, name: c.function?.name, args: c.function?.arguments })), raw: m };
  }
  if (!env.AI) throw new Error('El asistente no está configurado (falta Workers AI).');
  const out = await env.AI.run(env.AI_MODEL || DEFAULT_MODEL, { messages, tools: TOOLS, temperature: 0, max_tokens: 900 });
  return { text: out.response || '', calls: (out.tool_calls || []).map(c => ({ name: c.name || c.function?.name, args: c.arguments ?? c.function?.arguments })) };
}

export async function ask(env, history) {
  const ctx = await loadContext(env);
  const messages = [{ role: 'system', content: SYSTEM(ctx.today) },
    ...history.slice(-8).map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '').slice(0, 1500) }))];
  const used = [];
  for (let step = 0; step < 5; step++) {
    const res = await callModel(env, messages);
    if (!res.calls.length) return { answer: res.text.trim() || 'No tengo una respuesta con los datos disponibles.', used };
    if (res.raw) messages.push(res.raw);
    else messages.push({ role: 'assistant', content: '', tool_calls: res.calls.map((c, i) => ({ id: `call_${step}_${i}`, type: 'function', function: { name: c.name, arguments: typeof c.args === 'string' ? c.args : JSON.stringify(c.args || {}) } })) });
    for (const [i, c] of res.calls.entries()) {
      let args = c.args;
      if (typeof args === 'string') { try { args = JSON.parse(args || '{}'); } catch { args = {}; } }
      const result = TOOLS.some(t => t.name === c.name) ? await runTool(env, c.name, args || {}) : { error: 'Function not allowed' };
      used.push(c.name);
      messages.push({ role: 'tool', tool_call_id: c.id || `call_${step}_${i}`, name: c.name, content: JSON.stringify(result).slice(0, 12000) });
    }
  }
  return { answer: 'No pude completar la respuesta. Intenta con una pregunta más concreta.', used };
}

export { runTool };
