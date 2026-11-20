// Web push reminders. Two kinds, both from the 5-minute cron:
//  - alert:  a timed task on today starts within the next 10 minutes (meetings are left to Google Calendar)
//  - digest: once a day at the digest hour, a summary of the day (meetings, targets, tasks)
// VAPID keys are generated once and kept in the meta table; devices subscribe from Settings.
import { buildPushPayload } from '@block65/webcrypto-web-push';

const DIGEST_HOUR = 9;
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const pad = (n) => String(n).padStart(2, '0');
const toMin = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };
const fmtDur = (m) => m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ' ' + (m % 60) + 'm' : ''}` : `${m}m`;
const clockAP = (t) => { const n = toMin(t), h = Math.floor(n / 60) % 24; return `${h % 12 || 12}:${pad(n % 60)} ${h < 12 ? 'AM' : 'PM'}`; };

export async function vapid(env, origin) {
  const row = await env.DB.prepare("SELECT v FROM meta WHERE k = 'vapid'").first();
  if (row) return { subject: origin, ...JSON.parse(row.v) };
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const publicKey = b64u(await crypto.subtle.exportKey('raw', kp.publicKey)), privateKey = (await crypto.subtle.exportKey('jwk', kp.privateKey)).d;
  await env.DB.prepare("INSERT OR IGNORE INTO meta (k, v) VALUES ('vapid', ?)").bind(JSON.stringify({ publicKey, privateKey })).run();
  return vapid(env, origin);
}

// ── HTTP: /api/push/* (session-authenticated by the caller) ──
export async function api(request, env, url) {
  const p = url.pathname.replace('/api/push', '');
  if (p === '/key') return json({ key: (await vapid(env, url.origin)).publicKey });
  if (p === '/subscribe' && request.method === 'POST') {
    const { sub, label, digest = 1, alerts = 1 } = await request.json().catch(() => ({}));
    if (!sub?.endpoint || !sub?.keys?.p256dh) return json({ error: 'bad subscription' }, 400);
    const id = await hash(sub.endpoint);
    await env.DB.prepare('INSERT INTO push_subs (id, sub, label, digest, alerts, created) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET sub = excluded.sub, label = excluded.label, digest = excluded.digest, alerts = excluded.alerts, fails = 0')
      .bind(id, JSON.stringify(sub), String(label || '').slice(0, 80), digest ? 1 : 0, alerts ? 1 : 0, Date.now()).run();
    return json({ ok: true, id });
  }
  if (p === '/unsubscribe' && request.method === 'POST') {
    const { endpoint } = await request.json().catch(() => ({})); if (endpoint) await env.DB.prepare('DELETE FROM push_subs WHERE id = ?').bind(await hash(endpoint)).run();
    return json({ ok: true });
  }
  if (p === '/status' && request.method === 'POST') { // which settings does this device's subscription have
    const { endpoint } = await request.json().catch(() => ({})); const row = endpoint ? await env.DB.prepare('SELECT digest, alerts, label FROM push_subs WHERE id = ?').bind(await hash(endpoint)).first() : null;
    const n = (await env.DB.prepare('SELECT count(*) AS n FROM push_subs').first()).n;
    return json({ subscribed: !!row, digest: row ? !!row.digest : true, alerts: row ? !!row.alerts : true, devices: n, digestHour: DIGEST_HOUR });
  }
  if (p === '/test' && request.method === 'POST') {
    const { endpoint } = await request.json().catch(() => ({})); const row = endpoint ? await env.DB.prepare('SELECT * FROM push_subs WHERE id = ?').bind(await hash(endpoint)).first() : null;
    if (!row) return json({ error: 'not subscribed' }, 400);
    const r = await send(env, url.origin, row, { title: 'Horizonte', body: 'Reminders are on for this device.', tag: 'test', url: '/' });
    return json({ ok: r.ok, status: r.status });
  }
  return json({ error: 'not found' }, 404);
}

async function hash(str) { return b64u(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str))).slice(0, 32); }
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

async function send(env, origin, row, msg) {
  const sub = JSON.parse(row.sub);
  try {
    const payload = await buildPushPayload({ data: JSON.stringify(msg), options: { ttl: 3600, urgency: 'high' } }, sub, await vapid(env, origin));
    const res = await fetch(sub.endpoint, payload);
    if (res.status === 404 || res.status === 410) await env.DB.prepare('DELETE FROM push_subs WHERE id = ?').bind(row.id).run(); // gone for good
    else if (!res.ok) { await env.DB.prepare('UPDATE push_subs SET fails = fails + 1 WHERE id = ?').bind(row.id).run(); }
    return { ok: res.ok, status: res.status };
  } catch (e) { console.log('push', e.message); return { ok: false, status: 0 }; }
}

// ── cron tick ────────────────────────────────────────────────
function tzNow(tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'long', hour12: false }).formatToParts(new Date()).map(x => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, min: (Number(p.hour) % 24) * 60 + Number(p.minute), weekday: p.weekday };
}
async function once(env, key) { // true the first time a key is seen (dedupe across cron ticks)
  const r = await env.DB.prepare('INSERT OR IGNORE INTO push_sent (key, at) VALUES (?, ?)').bind(key, Date.now()).run(); return r.meta.changes > 0;
}

export async function tick(env, origin) {
  const subs = (await env.DB.prepare('SELECT * FROM push_subs WHERE fails < 10').all()).results; if (!subs.length) return;
  const prefRow = await env.DB.prepare("SELECT data FROM rec WHERE kind = 'pref' AND id = 'main'").first(); const pref = prefRow ? JSON.parse(prefRow.data) : {};
  const now = tzNow(pref.tz || 'America/Mexico_City');
  const { results } = await env.DB.prepare("SELECT id, data FROM rec WHERE kind = 'task' AND json_extract(data, '$.when') = ? AND COALESCE(json_extract(data, '$.del'), '') = ''").bind(now.day).all();
  const tasks = results.map(r => ({ id: r.id, ...JSON.parse(r.data) })).filter(t => t.status !== 'dropped');
  // alerts: open timed tasks starting in (0, 10] minutes
  const soon = tasks.filter(t => t.status !== 'done' && t.at && t.kind !== 'meeting' && toMin(t.at) - now.min > 0 && toMin(t.at) - now.min <= 10);
  for (const t of soon) {
    if (!await once(env, `alert:${t.id}:${now.day}:${t.at}`)) continue;
    const msg = { title: `${t.title}`, body: `${clockAP(t.at)} · ${fmtDur(t.dur || 30)}${t.pri === 'target' ? ' · target' : ''}`, tag: 'alert-' + t.id, id: t.id, url: '/?day=' + now.day, actions: [{ action: 'done', title: 'Done' }] };
    for (const s of subs) if (s.alerts) await send(env, origin, s, msg);
  }
  // digest: first tick at or after the digest hour
  if (now.min >= DIGEST_HOUR * 60 && now.min < DIGEST_HOUR * 60 + 60 && await once(env, `digest:${now.day}`)) {
    const open = tasks.filter(t => t.status !== 'done'), meetings = open.filter(t => t.kind === 'meeting').sort((a, b) => (a.at || '').localeCompare(b.at || ''));
    const targets = open.filter(t => t.pri === 'target' && t.kind !== 'meeting'), rest = open.filter(t => t.kind !== 'meeting' && t.pri !== 'target');
    const od = (await env.DB.prepare("SELECT count(*) AS n FROM rec WHERE kind = 'task' AND json_extract(data, '$.status') = 'open' AND COALESCE(json_extract(data, '$.del'), '') = '' AND json_extract(data, '$.when') GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND json_extract(data, '$.when') < ?").bind(now.day).first()).n;
    const lines = [];
    if (meetings.length) lines.push(meetings.map(m => `${clockAP(m.at)} ${m.title}`).join(' · '));
    if (targets.length) lines.push(`Targets: ${targets.map(t => t.title).join(', ')}`);
    if (rest.length) lines.push(`${rest.length} more task${rest.length > 1 ? 's' : ''} planned`);
    if (od) lines.push(`${od} overdue to review`);
    if (!lines.length) lines.push('Nothing planned yet. Tap to plan the day.');
    const msg = { title: `${now.weekday}: ${meetings.length} meeting${meetings.length === 1 ? '' : 's'}, ${targets.length} target${targets.length === 1 ? '' : 's'}`, body: lines.join('\n'), tag: 'digest', url: '/' };
    for (const s of subs) if (s.digest) await send(env, origin, s, msg);
  }
  // keep the dedupe log small
  await env.DB.prepare('DELETE FROM push_sent WHERE at < ?').bind(Date.now() - 3 * 864e5).run();
}
