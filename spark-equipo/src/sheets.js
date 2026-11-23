// Daily copy of the reps' CRM sheet ("CRM Ventas Dos Búhos"), read through the cellar Worker's service account (the sheet is shared with it).
// Goes away when the reps log straight into Spark.

const TABS = { 'José Luis': 'Actividad - José Luis', 'Carlos': 'Actividad - Carlos', 'Daniel': 'Actividad - Daniel' };
const COLS = ['fecha', 'zona', 'cuenta', 'tipo', 'distribuidor', 'actividad', 'medio', 'etapa', 'contacto', 'telefono', 'muestras', 'resultado', 'siguiente_paso', 'proximo', 'pedido'];
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const enc = new TextEncoder();

async function googleToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64u(enc.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const claim = b64u(enc.encode(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/spreadsheets.readonly', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 600 })));
  const pem = sa.private_key.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const key = await crypto.subtle.importKey('pkcs8', Uint8Array.from(atob(pem), (c) => c.charCodeAt(0)), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = b64u(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(head + '.' + claim)));
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${claim}.${sig}` }) });
  const j = await r.json();
  if (!j.access_token) throw new Error('Google no entregó token: ' + (j.error_description || j.error || r.status));
  return j.access_token;
}

export function rowsFromValues(persona, values) {
  return (values || []).slice(1).filter((r) => r && /^\d{4}-\d{2}-\d{2}$/.test(String(r[0] || '').trim()))
    .map((r) => ({ persona, ...Object.fromEntries(COLS.map((k, i) => [k, String(r[i] ?? '').trim()])) }));
}

// Email the CRM sheet has to be shared with (viewer is enough).
export async function sheetEmail(env) {
  if (env.SHEETS) return env.SHEETS.email();
  try { return JSON.parse(env.GOOGLE_SA_KEY).client_email; } catch { return ''; }
}

// The "Distribuidores" tab: distributor scouting, one row per distributor. Columns A–Q in this order.
const DIST_COLS = ['nombre', 'plaza', 'zona', 'tipo', 'estado', 'contacto', 'telefono', 'email', 'status', 'avance', 'siguiente', 'ultimo', 'proximo', 'motivo', 'linea', 'responsable', 'notas'];
// Dates typed as 2026-11-17 or 17/11/2026 both end up as 2026-11-17; anything else is dropped.
const fecha = (v) => { v = String(v || '').trim(); const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : ''; };
export function distFromValues(values) {
  return (values || []).slice(1).filter((r) => r && String(r[0] || '').trim())
    .map((r) => { const o = Object.fromEntries(DIST_COLS.map((k, i) => [k, String(r[i] ?? '').trim()])); o.ultimo = fecha(o.ultimo); o.proximo = fecha(o.proximo); return o; });
}

// With the SHEETS binding the cellar Worker reads the sheet with its own service account; GOOGLE_SA_KEY is only a fallback.
async function tabValues(env, ranges = Object.values(TABS).map((tab) => `'${tab}'!A1:O5000`)) {
  if (env.SHEETS) return env.SHEETS.values(env.CRM_SHEET_ID, ranges);
  const token = await googleToken(JSON.parse(env.GOOGLE_SA_KEY));
  const u = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${env.CRM_SHEET_ID}/values:batchGet`);
  for (const r of ranges) u.searchParams.append('ranges', r);
  const r = await fetch(u, { headers: { Authorization: 'Bearer ' + token } });
  const j = await r.json();
  if (!j.valueRanges) throw new Error('Google Sheets: ' + (j.error?.message || r.status));
  return j.valueRanges.map((v) => v.values || []);
}

const llave = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
// primera: the first read of the day (6 am). A row it finds was typed after the last read of the evening, so it is dated the day before.
export async function syncSheet(env, { primera = false } = {}) {
  if (!env.SHEETS && !env.GOOGLE_SA_KEY) return { skipped: 'Falta la conexión con Google Sheets' };
  const vals = await tabValues(env);
  const rows = Object.keys(TABS).flatMap((p, i) => rowsFromValues(p, vals[i]));
  if (!rows.length) throw new Error('La hoja no devolvió renglones; no se reemplazó nada');
  // The sheet is the source of truth for now: replace the copy in one batch.
  // The sheet has no timestamp, so the first sync that sees a row dates it: that is the "logged on" date for the 48-hour rule.
  // The very first run (nothing seen yet) is different: every row already in the sheet is a backlog nobody logged today, so
  // those rows get no date at all. Dating them would make three weeks of silence read as "logged today".
  // A row is known by person, day and account. The note is left out of the key on purpose: correcting a typo in it must not
  // make the contact look logged again today. Keys from before this change carried the note; a row still found under its
  // old key keeps the date it had.
  const V = new Map((await env.DB.prepare('SELECT clave, visto FROM vistos').all()).results.map((r) => [r.clave, r.visto]));
  const dia = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: env.TZ || 'America/Mexico_City' }).format(d);
  const hoy = V.size ? dia(primera ? new Date(Date.now() - 864e5) : new Date()) : '';
  const clave = (x) => [x.persona, x.fecha, llave(x.cuenta)].join('|'), vieja = (x) => [x.persona, x.fecha, x.cuenta, (x.resultado || '').slice(0, 80)].join('|');
  const visto = env.DB.prepare('INSERT OR IGNORE INTO vistos (clave, visto) VALUES (?, ?)'), nuevos = [];
  for (const x of rows) { const k = clave(x); let v = V.get(k);
    if (v === undefined) { const o = V.get(vieja(x)); v = o !== undefined ? o : hoy; V.set(k, v); nuevos.push(visto.bind(k, v)); }
    x.registrado = v; }
  const ins = env.DB.prepare(`INSERT INTO activity (persona, ${COLS.join(', ')}, registrado) VALUES (${Array(COLS.length + 2).fill('?').join(',')})`);
  const stmts = [...nuevos, env.DB.prepare("DELETE FROM activity WHERE origen = 'hoja'"), ...rows.map((x) => ins.bind(x.persona, ...COLS.map((k) => x[k]), x.registrado))];
  for (let i = 0; i < stmts.length; i += 90) await env.DB.batch(stmts.slice(i, i + 90));
  // Distributor scouting tab. A missing or empty tab leaves the last copy in place.
  let distribuidores = 0;
  try {
    const d = distFromValues((await tabValues(env, ["'Distribuidores'!A1:Q1000"]))[0]);
    if (d.length) {
      const insD = env.DB.prepare(`INSERT INTO distribuidores (${DIST_COLS.join(', ')}) VALUES (${Array(DIST_COLS.length).fill('?').join(',')})`);
      const sd = [env.DB.prepare('DELETE FROM distribuidores'), ...d.map((x) => insD.bind(...DIST_COLS.map((k) => x[k])))];
      for (let i = 0; i < sd.length; i += 90) await env.DB.batch(sd.slice(i, i + 90));
      distribuidores = d.length;
    }
  } catch (e) { return { rows: rows.length, distribuidores_error: String(e.message || e) }; }
  return { rows: rows.length, distribuidores };
}
