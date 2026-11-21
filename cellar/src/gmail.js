// Read-only Gmail for dosbuhos.com mailboxes, through the same service account as Sheets (secret GOOGLE_SA_JSON).
// Needs domain-wide delegation in the Workspace Admin console for the account's client ID with the scope
// https://www.googleapis.com/auth/gmail.readonly, and the Gmail API enabled in Google Cloud project dos-buhos.
// Only reachable through the GmailRead service-binding entrypoint; nothing here is exposed on the internet.

const toks = new Map(); // mailbox -> { access, exp }
const b64u = (s) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64uBuf = (buf) => b64u(String.fromCharCode(...new Uint8Array(buf)));
const API = 'https://gmail.googleapis.com/gmail/v1/users/';
const okBox = (m) => /^[a-z0-9._-]+@dosbuhos\.com$/.test(m);

async function token(env, mailbox) {
  const t = toks.get(mailbox);
  if (t && t.exp > Date.now() + 60000) return t.access;
  const sa = JSON.parse(env.GOOGLE_SA_JSON);
  const now = Math.floor(Date.now() / 1000);
  const head = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  // `sub` is the mailbox the service account acts for (read-only scope).
  const claim = b64u(JSON.stringify({ iss: sa.client_email, sub: mailbox, scope: 'https://www.googleapis.com/auth/gmail.readonly', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
  const pem = sa.private_key.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(head + '.' + claim));
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: head + '.' + claim + '.' + b64uBuf(sig) }) });
  const j = await r.json();
  if (!r.ok) throw new Error('Gmail sign-in failed: ' + (j.error_description || j.error || r.status));
  toks.set(mailbox, { access: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 });
  return j.access_token;
}

async function get(env, mailbox, path) {
  const r = await fetch(API + encodeURIComponent(mailbox) + path, { headers: { authorization: 'Bearer ' + await token(env, mailbox) } });
  const j = await r.json();
  if (!r.ok) throw new Error('Gmail: ' + (j.error && j.error.message || r.status));
  return j;
}

const hdr = (m, n) => ((m.payload && m.payload.headers || []).find((h) => h.name.toLowerCase() === n) || {}).value || '';

// One page of messages (headers and snippet only). max is capped so one call stays under the subrequest limit.
export async function gmailList(env, mailbox, q, pageToken, max) {
  mailbox = String(mailbox || '').toLowerCase();
  if (!okBox(mailbox)) throw new Error('Only dosbuhos.com mailboxes');
  const n = Math.min(Math.max(Number(max) || 40, 1), 40);
  const qs = new URLSearchParams({ maxResults: String(n) });
  if (q) qs.set('q', q);
  if (pageToken) qs.set('pageToken', pageToken);
  const l = await get(env, mailbox, '/messages?' + qs);
  const rows = await Promise.all((l.messages || []).map(async (x) => {
    const m = await get(env, mailbox, '/messages/' + x.id + '?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Subject');
    return { id: m.id, hilo: m.threadId, ms: Number(m.internalDate), de: hdr(m, 'from'), para: hdr(m, 'to'), cc: hdr(m, 'cc'), asunto: hdr(m, 'subject'), etiquetas: m.labelIds || [], extracto: m.snippet || '' };
  }));
  return { mensajes: rows, siguiente: l.nextPageToken || null, estimado: l.resultSizeEstimate || 0 };
}

const decode = (d) => { try { return new TextDecoder().decode(Uint8Array.from(atob(d.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))); } catch { return ''; } };
function plain(p) {
  if (!p) return '';
  if (p.mimeType === 'text/plain' && p.body && p.body.data) return decode(p.body.data);
  return (p.parts || []).map(plain).filter(Boolean).join('\n');
}

// A whole thread as plain text, each message trimmed.
export async function gmailThread(env, mailbox, id) {
  mailbox = String(mailbox || '').toLowerCase();
  if (!okBox(mailbox) || !/^[0-9a-f]+$/.test(String(id))) throw new Error('Bad request');
  const t = await get(env, mailbox, '/threads/' + id + '?format=full');
  return (t.messages || []).map((m) => ({ ms: Number(m.internalDate), de: hdr(m, 'from'), para: hdr(m, 'to'), asunto: hdr(m, 'subject'),
    adjuntos: JSON.stringify(m.payload || {}).match(/"filename":"[^"]+"/g)?.map((s) => s.slice(12, -1)) || [], texto: plain(m.payload).slice(0, 4000) }));
}
