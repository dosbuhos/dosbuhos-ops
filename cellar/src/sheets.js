// Google Sheets for the cellar calendar, through a Google Cloud service account (secret GOOGLE_SA_JSON).
// Share the Excellovint sheet with the service account's email as Editor. Only SHEET_ID is reachable.

let tok = null; // { access, exp }
const b64u = (s) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64uBuf = (buf) => b64u(String.fromCharCode(...new Uint8Array(buf)));

async function accessToken(env) {
  if (tok && tok.exp > Date.now() + 60000) return tok.access;
  const sa = JSON.parse(env.GOOGLE_SA_JSON);
  const now = Math.floor(Date.now() / 1000);
  const head = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64u(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/spreadsheets', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
  const pem = sa.private_key.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(pem), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(head + '.' + claim));
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: head + '.' + claim + '.' + b64uBuf(sig) }) });
  const j = await r.json();
  if (!r.ok) throw new Error('Google sign-in for the service account failed: ' + (j.error_description || j.error || r.status));
  tok = { access: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return tok.access;
}

// Same tool names and arguments as the Google Sheets connector the artifact used.
export async function sheetsTool(env, tool, a) {
  if (!env.GOOGLE_SA_JSON) return { status: 503, body: { code: 'tool_error', message: 'Google Sheets is not set up on the server yet (GOOGLE_SA_JSON).' } };
  const id = a.spreadsheetId;
  if (id !== env.SHEET_ID) return { status: 403, body: { code: 'tool_error', message: 'Only the Excellovint sheet is allowed.' } };
  const base = 'https://sheets.googleapis.com/v4/spreadsheets/' + encodeURIComponent(id);
  let url, init = {};
  if (tool === 'get_values') url = base + '/values/' + encodeURIComponent(a.range);
  else if (tool === 'update_values') {
    url = base + '/values/' + encodeURIComponent(a.range) + '?valueInputOption=' + (a.valueInputOption || 'USER_ENTERED');
    init = { method: 'PUT', body: JSON.stringify({ range: a.range, majorDimension: 'ROWS', values: a.values }) };
  } else if (tool === 'append_values') {
    url = base + '/values/' + encodeURIComponent(a.range) + ':append?valueInputOption=' + (a.valueInputOption || 'USER_ENTERED') + '&insertDataOption=INSERT_ROWS';
    init = { method: 'POST', body: JSON.stringify({ values: a.values }) };
  } else if (tool === 'get_spreadsheet') {
    const q = new URLSearchParams();
    if (a.includeGridData) q.set('includeGridData', 'true');
    for (const r of a.ranges || []) q.append('ranges', r);
    if (a.fields && a.fields.length) q.set('fields', a.fields.join(','));
    url = base + '?' + q;
  } else if (tool === 'update_spreadsheet') {
    url = base + ':batchUpdate';
    init = { method: 'POST', body: JSON.stringify({ requests: a.requests }) };
  } else return { status: 400, body: { code: 'tool_error', message: 'Unknown tool ' + tool } };

  const r = await fetch(url, Object.assign(init, { headers: { authorization: 'Bearer ' + await accessToken(env), 'content-type': 'application/json' } }));
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return { status: r.status === 429 ? 429 : 502, body: { code: 'tool_error', message: (j.error && j.error.message) || 'Google Sheets error ' + r.status, result: j } };
  return { status: 200, body: { payload: j } };
}
