// Google Calendar two-way sync for meetings. Tasks never go to Google; only tasks with kind === 'meeting'.
// Horizonte → Google: after a device syncs, every meeting it touched is created / updated / deleted as an event.
// Google → Horizonte: every few minutes (cron) and on device syncs, changed events come back as meeting records.
// Needs the GOOGLE_CLIENT_SECRET secret (to keep a refresh token); without it the calendar parts stay off.

const API = 'https://www.googleapis.com/calendar/v3';
const srvT = () => `${Date.now().toString(36).padStart(9, '0')}.zzz.server`;
const pad = (n) => String(n).padStart(2, '0');

export async function gcalRow(env) {
  return env.DB.prepare('SELECT * FROM gcal WHERE id = 1').first().catch(() => null);
}

export async function exchange(env, code) {
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: 'postmessage', grant_type: 'authorization_code' }) });
  const tok = await r.json();
  if (!r.ok) throw new Error(tok.error_description || tok.error || 'token exchange failed');
  let email = '';
  if (tok.id_token) { try { email = JSON.parse(atob(tok.id_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).email || ''; } catch {} }
  return { tok, email: String(email).toLowerCase() };
}
export async function save(env, tok, email) {
  await env.DB.prepare(`INSERT INTO gcal (id, email, refresh_token, access_token, access_exp, sync_token, last_pull, calendar_id) VALUES (1, ?, ?, ?, ?, NULL, 0, 'primary')
    ON CONFLICT (id) DO UPDATE SET email = excluded.email, refresh_token = excluded.refresh_token, access_token = excluded.access_token, access_exp = excluded.access_exp, sync_token = NULL, last_pull = 0`)
    .bind(email, tok.refresh_token, tok.access_token, Date.now() + (tok.expires_in - 60) * 1000).run();
}
export async function connect(env, code) {
  const { tok, email } = await exchange(env, code);
  if (!tok.refresh_token) throw new Error('Google did not grant offline access; remove Horizonte under your Google account > Security > Third-party access, then connect again');
  await save(env, tok, email || 'Google Calendar');
  return email;
}

async function token(env, row) {
  if (row.access_token && row.access_exp > Date.now()) return row.access_token;
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, refresh_token: row.refresh_token, grant_type: 'refresh_token' }) });
  const tok = await r.json();
  if (!r.ok) { if (tok.error === 'invalid_grant') await env.DB.prepare("UPDATE gcal SET access_token = NULL, sync_token = NULL, email = email || ' (reconnect needed)' WHERE id = 1").run(); throw new Error('refresh failed: ' + (tok.error || r.status)); }
  row.access_token = tok.access_token; row.access_exp = Date.now() + (tok.expires_in - 60) * 1000;
  await env.DB.prepare('UPDATE gcal SET access_token = ?, access_exp = ? WHERE id = 1').bind(row.access_token, row.access_exp).run();
  return row.access_token;
}
async function gfetch(env, row, path, init = {}) {
  const t = await token(env, row);
  return fetch(API + path, { ...init, headers: { authorization: `Bearer ${t}`, 'content-type': 'application/json', ...(init.headers || {}) } });
}
async function tz(env) {
  const p = await env.DB.prepare("SELECT data FROM rec WHERE kind = 'pref' AND id = 'main'").first();
  try { return JSON.parse(p?.data || '{}').tz || 'America/Chicago'; } catch { return 'America/Chicago'; }
}

// ── Horizonte → Google ───────────────────────────────────────
const isLiveMeeting = (d) => d && d.kind === 'meeting' && !d.del && d.status !== 'dropped' && /^\d{4}-\d\d-\d\d$/.test(d.when || '');
function eventBody(id, d, zone) {
  const body = { summary: d.title || 'Meeting', description: d.notes || '', extendedProperties: { private: { hz: id } } };
  if (d.at) {
    const [h, m] = d.at.split(':').map(Number), end = h * 60 + m + (d.dur || 60);
    const endDay = new Date(`${d.when}T12:00:00Z`); endDay.setUTCDate(endDay.getUTCDate() + Math.floor(end / 1440));
    const ed = endDay.toISOString().slice(0, 10);
    body.start = { dateTime: `${d.when}T${d.at}:00`, timeZone: zone };
    body.end = { dateTime: `${ed}T${pad(Math.floor(end % 1440 / 60))}:${pad(end % 60)}:00`, timeZone: zone };
  } else {
    const next = new Date(`${d.when}T12:00:00Z`); next.setUTCDate(next.getUTCDate() + 1);
    body.start = { date: d.when }; body.end = { date: next.toISOString().slice(0, 10) };
  }
  return body;
}

export async function pushTasks(env, ids, applyOps) {
  const row = await gcalRow(env); if (!row || !row.access_token && !row.refresh_token) return;
  const zone = await tz(env);
  for (const id of new Set(ids)) {
    const rec = await env.DB.prepare("SELECT data FROM rec WHERE kind = 'task' AND id = ?").bind(id).first(); if (!rec) continue;
    const d = JSON.parse(rec.data);
    try {
      if (isLiveMeeting(d)) {
        const body = JSON.stringify(eventBody(id, d, zone));
        let r = d.gev ? await gfetch(env, row, `/calendars/${row.calendar_id}/events/${encodeURIComponent(d.gev)}`, { method: 'PATCH', body }) : null;
        if (!r || r.status === 404 || r.status === 410) r = await gfetch(env, row, `/calendars/${row.calendar_id}/events`, { method: 'POST', body });
        if (r.ok) { const ev = await r.json(); if (ev.id !== d.gev) await applyOps(env, [{ k: 'task', id, f: { gev: ev.id }, t: srvT() }]); }
      } else if (d.gev) {
        const r = await gfetch(env, row, `/calendars/${row.calendar_id}/events/${encodeURIComponent(d.gev)}`, { method: 'DELETE' });
        if (r.ok || r.status === 404 || r.status === 410) await applyOps(env, [{ k: 'task', id, f: { gev: '' }, t: srvT() }]);
      }
    } catch (e) { console.log('gcal push failed', id, e.message); }
  }
}

// ── Google → Horizonte ───────────────────────────────────────
function localParts(dateTime, zone) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const p = Object.fromEntries(f.formatToParts(new Date(dateTime)).map(x => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}
export async function pull(env, applyOps, { force = false } = {}) {
  const row = await gcalRow(env); if (!row || !row.refresh_token) return 0;
  if (!force && Date.now() - (row.last_pull || 0) < 30000) return 0;
  await env.DB.prepare('UPDATE gcal SET last_pull = ? WHERE id = 1').bind(Date.now()).run();
  const zone = await tz(env);
  let pageToken = null, syncToken = row.sync_token, n = 0, nextSync = null;
  const since = new Date(Date.now() - 30 * 864e5).toISOString();
  for (let i = 0; i < 20; i++) {
    const q = new URLSearchParams({ singleEvents: 'true', maxResults: '250', showDeleted: 'true' });
    if (syncToken) q.set('syncToken', syncToken); else q.set('timeMin', since);
    if (pageToken) q.set('pageToken', pageToken);
    const r = await gfetch(env, row, `/calendars/${row.calendar_id}/events?${q}`);
    if (r.status === 410) { syncToken = null; pageToken = null; await env.DB.prepare('UPDATE gcal SET sync_token = NULL WHERE id = 1').run(); continue; }
    if (!r.ok) throw new Error('events.list ' + r.status);
    const j = await r.json(), ops = [];
    for (const ev of j.items || []) {
      const hz = ev.extendedProperties?.private?.hz;
      const id = hz || ('g_' + ev.id.replace(/[^A-Za-z0-9_]/g, '').slice(0, 58));
      if (ev.status === 'cancelled') {
        const cur = await env.DB.prepare("SELECT data FROM rec WHERE kind = 'task' AND id = ?").bind(id).first();
        if (cur && !JSON.parse(cur.data).del) ops.push({ k: 'task', id, f: { del: new Date().toISOString(), gev: '' }, t: srvT() });
        continue;
      }
      if (ev.eventType && ev.eventType !== 'default') continue; // skip working-location, out-of-office, focus time
      const f = { title: ev.summary || '(no title)', kind: 'meeting', gev: ev.id };
      if (ev.start?.dateTime) {
        const s = localParts(ev.start.dateTime, zone), e = localParts(ev.end?.dateTime || ev.start.dateTime, zone);
        const dur = Math.max(15, Math.round((new Date(ev.end?.dateTime || ev.start.dateTime) - new Date(ev.start.dateTime)) / 60000));
        Object.assign(f, { when: s.day, at: s.time, dur });
      } else if (ev.start?.date) Object.assign(f, { when: ev.start.date, at: '', dur: 60 });
      if (!hz) {
        const exists = await env.DB.prepare("SELECT 1 FROM rec WHERE kind = 'task' AND id = ?").bind(id).first();
        if (!exists) Object.assign(f, { notes: ev.description ? String(ev.description).slice(0, 4000) : '', board: '', section: '', pri: 'normal', status: 'open', rolls: 0, src: 'gcal', created: ev.created || new Date().toISOString(), o: Date.now() });
      }
      ops.push({ k: 'task', id, f, t: srvT() }); n++;
    }
    if (ops.length) await applyOps(env, ops);
    pageToken = j.nextPageToken || null; nextSync = j.nextSyncToken || nextSync;
    if (!pageToken) break;
  }
  if (nextSync) await env.DB.prepare('UPDATE gcal SET sync_token = ? WHERE id = 1').bind(nextSync).run();
  return n;
}
