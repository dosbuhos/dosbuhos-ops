// Canario: checks twice a day that guests can book at Dos Búhos, and alerts when they cannot.
// It asks OpenTable's public booking pages the same questions a guest's browser asks (no login, no secrets),
// and checks that the booking buttons on dosbuhos.com still point to OpenTable.
import { EXPERIENCES, localDate, nextOpenDays, addDays, judge } from './logic.js';

const OT = 'https://www.opentable.com.mx';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
// OpenTable's booking pages name their queries by these hashes. If OpenTable changes them, the canary reports
// "BLIND" (it cannot see) instead of a false alarm; capture the new hash from the booking page's network calls.
const HASH = {
  RestRefAvailability: 'ed441b6fe912d7d87384f37febecf2789d21cdaf1b7d15b07f461281f2a8d47f',
  ExperienceAvailability: 'ad6cc72822c0b7bc03c4e0b2d41a7805e0a14f78ffde70441e0c620a54fbb7b8',
};

async function gql(op, pageType, variables) {
  const r = await fetch(`${OT}/dapi/fe/gql?optype=query&opname=${op}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: '*/*', 'user-agent': UA, origin: OT, referer: `${OT}/booking/restref/availability`,
      'ot-page-type': pageType, 'ot-page-group': 'booking', 'accept-language': 'es-MX,es;q=0.9' },
    body: JSON.stringify({ operationName: op, variables, extensions: { persistedQuery: { version: 1, sha256Hash: HASH[op] } } }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`OpenTable respondió ${r.status}`);
  let j; try { j = JSON.parse(text); } catch { throw new Error('respuesta no es JSON'); }
  if (j.errors?.length) throw new Error(j.errors[0].message || 'error de OpenTable');
  return j.data;
}

async function tableSlots(rid, date, party) {
  const d = await gql('RestRefAvailability', 'restref_availability', {
    privilegedAccess: [], transformOutdoorToDefault: false, forwardDays: 0, requireTypes: ['Standard', 'Experience', 'RemoteWaitlist'],
    enableTicketedExperiences: true, enableExperienceDeposits: false, enablePrivateDiningExperiences: false, restaurantIds: [rid],
    slotDiscovery: ['off'], date, time: '13:00', partySize: party, databaseRegion: 'NA', rid,
    forwardTimeslots: 12, backwardTimeslots: 12, forwardMinutes: 180, backwardMinutes: 180,
  });
  const day = d?.availability?.[0]?.availabilityDays?.find(x => x.dayOffset === 0);
  if (!day) throw new Error('respuesta sin días');
  return day.slots.filter(s => s.isAvailable).length;
}

async function experienceDays(rid, id, today, dates) {
  const d = await gql('ExperienceAvailability', 'experiences_availability', {
    includeDiningAreas: true, transformOutdoorToDefault: false, privilegedAccess: [], restaurantIds: [rid], partySize: 2,
    dateTime: `${today}T13:00`, experienceId: id, type: 'Experience', returnTimeSlots: true, backwardMinutes: 210, forwardMinutes: 210, forwardDays: 30,
  });
  const avail = d?.experienceAvailability?.available;
  if (!Array.isArray(avail)) throw new Error('respuesta sin días');
  const byDate = {};
  for (const a of avail) byDate[addDays(today, a.dayOffset)] = a.restaurantSet?.[0]?.results?.experience?.length || 0;
  return Object.fromEntries(dates.map(x => [x, byDate[x] || 0]));
}

async function sitePage(url, rid) {
  try {
    const r = await fetch(url, { headers: { 'user-agent': UA }, redirect: 'follow' });
    if (!r.ok) return { url, ok: false, problem: `respondió ${r.status}` };
    const html = await r.text();
    if (!html.includes(`restref=${rid}`)) return { url, ok: false, problem: 'no encuentro botones de reserva hacia OpenTable' };
    if (/href=["'][^"']*rezdy\.com/i.test(html)) return { url, ok: false, problem: 'hay un enlace a Rezdy' };
    return { url, ok: true };
  } catch (e) { return { url, ok: false, problem: e.message }; }
}

const attempt = async (fn) => { try { return [await fn(), null]; } catch (e) { return [null, e.message]; } };

export async function runChecks(env) {
  const rid = Number(env.RID), today = localDate();
  const skip = (env.SKIP_DATES || '').split(',').map(s => s.trim()).filter(Boolean);
  const dates = nextOpenDays(today, 5, skip);
  const tables = [];
  for (const date of dates) for (const party of [2, 4]) {
    const [slots, error] = await attempt(() => tableSlots(rid, date, party));
    tables.push({ date, party, slots, error });
  }
  const experiences = [];
  for (const e of EXPERIENCES) {
    const [days, error] = await attempt(() => experienceDays(rid, e.id, today, dates));
    experiences.push({ ...e, days, error });
  }
  const site = await Promise.all(['https://dosbuhos.com/restaurante/', 'https://dosbuhos.com/wine-tour/'].map(u => sitePage(u, rid)));
  const checks = { tables, experiences, site };
  return { at: new Date().toISOString(), today, dates, checks, ...judge(checks) };
}

async function notify(env, title, lines, priority) {
  if (!env.NTFY_TOPIC) return;
  await fetch('https://ntfy.sh/', { method: 'POST', body: JSON.stringify({
    topic: env.NTFY_TOPIC, title, message: lines.join('\n').slice(0, 3500), priority, tags: [priority >= 4 ? 'rotating_light' : 'white_check_mark'],
    click: 'https://guestcenter.opentable.com/' }) }).catch(() => {});
}

async function runAndAlert(env, { morning = false } = {}) {
  const res = await runChecks(env);
  const prev = JSON.parse((await env.KV.get('last')) || 'null');
  const sig = res.status + '|' + [...res.fails, ...res.warns, ...res.blind].join('|');
  const changed = !prev || prev.sig !== sig;
  if (res.status === 'OK') {
    if (prev && prev.status !== 'OK') await notify(env, 'Reservas: todo funciona otra vez', ['Mesas, experiencias y sitio web responden bien.'], 3);
  } else if (changed || morning) { // new problem, or still broken at the morning run
    const title = res.status === 'FAIL' ? 'RESERVAS: los clientes no pueden reservar' : res.status === 'WARN' ? 'Reservas: disponibilidad baja' : 'Canario: no puedo revisar OpenTable';
    await notify(env, title, [...res.fails, ...res.warns, ...res.blind], res.status === 'FAIL' ? 5 : 4);
  }
  await env.KV.put('last', JSON.stringify({ ...res, sig }));
  return res;
}

const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function page(res) {
  if (!res) return '<p>Todavía no hay ninguna revisión. Abre <a href="/run">/run</a>.</p>';
  const color = { OK: '#15803d', WARN: '#b45309', FAIL: '#b91c1c', BLIND: '#6b7280' }[res.status];
  const label = { OK: 'Todo funciona', WARN: 'Disponibilidad baja', FAIL: 'Los clientes no pueden reservar', BLIND: 'No pude revisar OpenTable' }[res.status];
  const t2 = Object.fromEntries(res.checks.tables.filter(t => t.party === 2).map(t => [t.date, t.slots]));
  const t4 = Object.fromEntries(res.checks.tables.filter(t => t.party === 4).map(t => [t.date, t.slots]));
  const cell = (n) => `<td style="color:${n == null ? '#6b7280' : n === 0 ? '#b91c1c' : 'inherit'}">${n == null ? '?' : n}</td>`;
  const rows = [['Mesas, 2 personas', t2], ['Mesas, 4 personas', t4], ...res.checks.experiences.map(e => [e.name, e.days || {}])]
    .map(([name, m]) => `<tr><th>${esc(name)}</th>${res.dates.map(d => cell(m[d])).join('')}</tr>`).join('');
  const list = [...res.fails, ...res.warns, ...res.blind].map(x => `<li>${esc(x)}</li>`).join('');
  return `<h1 style="color:${color}">${label}</h1>
<p>Última revisión: ${esc(new Date(res.at).toLocaleString('es-MX', { timeZone: 'America/Mexico_City' }))} (hora de San Miguel). Se revisa sola a las 8:00 y 11:00.</p>
${list ? `<ul>${list}</ul>` : ''}
<p>Horarios que un cliente puede reservar en línea, por día:</p>
<div style="overflow-x:auto"><table><tr><th></th>${res.dates.map(d => `<th>${d.slice(5)}</th>`).join('')}</tr>${rows}</table></div>
<p>Sitio web: ${res.checks.site.map(s => `${esc(s.url.replace('https://dosbuhos.com', ''))} ${s.ok ? 'bien' : esc(s.problem)}`).join(' · ')}</p>
<p><a href="/run">Revisar ahora</a></p>`;
}
const shell = (body) => new Response(`<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Canario de reservas</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:760px;margin:0 auto;padding:16px;color:#16181d}table{border-collapse:collapse;font-variant-numeric:tabular-nums}th,td{padding:6px 10px;border-bottom:1px solid #e5e7eb;text-align:right}th:first-child{text-align:left;font-weight:500}h1{font-size:24px}</style>${body}</html>`,
  { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });

export default {
  async scheduled(event, env, ctx) { ctx.waitUntil(runAndAlert(env, { morning: event.cron.startsWith('0 14') })); },
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === '/run') { // at most once every 2 minutes
      const lastRun = Number(await env.KV.get('lastManual')) || 0;
      if (Date.now() - lastRun > 120000) { await env.KV.put('lastManual', String(Date.now())); await runAndAlert(env); }
      return Response.redirect(url.origin + '/', 302);
    }
    if (url.pathname === '/status.json') return Response.json(JSON.parse((await env.KV.get('last')) || 'null'));
    if (url.pathname === '/') return shell(page(JSON.parse((await env.KV.get('last')) || 'null')));
    return new Response('Not found', { status: 404 });
  },
};
