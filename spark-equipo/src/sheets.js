// Daily copy of the reps' CRM sheet ("CRM Ventas Dos Búhos"), read with a Google service account the sheet is shared with.
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

export async function syncSheet(env) {
  if (!env.GOOGLE_SA_KEY) return { skipped: 'Falta el secreto GOOGLE_SA_KEY' };
  const token = await googleToken(JSON.parse(env.GOOGLE_SA_KEY));
  const u = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${env.CRM_SHEET_ID}/values:batchGet`);
  for (const tab of Object.values(TABS)) u.searchParams.append('ranges', `'${tab}'!A1:O5000`);
  const r = await fetch(u, { headers: { Authorization: 'Bearer ' + token } });
  const j = await r.json();
  if (!j.valueRanges) throw new Error('Google Sheets: ' + (j.error?.message || r.status));
  const rows = Object.keys(TABS).flatMap((p, i) => rowsFromValues(p, j.valueRanges[i].values));
  if (!rows.length) throw new Error('La hoja no devolvió renglones; no se reemplazó nada');
  // The sheet is the source of truth for now: replace the copy in one batch.
  const ins = env.DB.prepare(`INSERT INTO activity (persona, ${COLS.join(', ')}) VALUES (${Array(COLS.length + 1).fill('?').join(',')})`);
  const stmts = [env.DB.prepare("DELETE FROM activity WHERE origen = 'hoja'"), ...rows.map((x) => ins.bind(x.persona, ...COLS.map((k) => x[k])))];
  for (let i = 0; i < stmts.length; i += 90) await env.DB.batch(stmts.slice(i, i + 90));
  return { rows: rows.length };
}
