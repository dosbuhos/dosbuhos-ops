// Spark — mini CRM for Dos Búhos restaurant sparks
import APP_HTML from './app.html';

const STAGES = ['spark', 'conversacion', 'propuesta', 'cita', 'cliente', 'dormido'];

// ---------- helpers ----------
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
const html = (body, status = 200) =>
  new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const digits = (s) => String(s ?? '').replace(/\D/g, '');
const last10 = (s) => digits(s).slice(-10);
const nowIso = () => new Date().toISOString();
const randToken = (n = 16) => {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
};

function fmtDate(iso, env, opts = {}) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('es-MX', { timeZone: env.TZ || 'America/Mexico_City', dateStyle: 'medium', timeStyle: 'short', ...opts });
  } catch { return iso; }
}

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function safeEq(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

async function makeSession(env, name) {
  const exp = Date.now() + 1000 * 60 * 60 * 24 * 30;
  const payload = btoa(unescape(encodeURIComponent(`${name}|${exp}`)));
  return `${payload}.${await hmac(env.SESSION_SECRET || 'dev', payload)}`;
}

async function readSession(req, env) {
  const cookie = req.headers.get('cookie') || '';
  const m = cookie.match(/(?:^|;\s*)spark=([^;]+)/);
  if (!m) return null;
  const [payload, sig] = m[1].split('.');
  if (!payload || !sig) return null;
  const good = await hmac(env.SESSION_SECRET || 'dev', payload);
  if (!safeEq(good, sig)) return null;
  const [name, exp] = decodeURIComponent(escape(atob(payload))).split('|');
  if (Date.now() > Number(exp)) return null;
  return { name };
}

async function getSetting(env, key, fallback = '') {
  const r = await env.DB.prepare('SELECT value FROM settings WHERE key=?').bind(key).first();
  return r ? r.value : fallback;
}

const DEFAULT_SETTINGS = {
  auto_reply: 'off',
  offer_terms: 'Bonificación 6+1 en tu primer pedido. Precios F.O.B. bodega.',
  brand_voice: 'Cálido, directo y breve. Español de México. Tuteo con respeto. Nunca suena a publicidad. Máximo 3 frases por mensaje de WhatsApp.',
  winery_visit: 'Te invitamos a la bodega en San Miguel de Allende: recorrido por el viñedo y cata con nosotros.',
};
async function allSettings(env) {
  const { results } = await env.DB.prepare('SELECT key, value FROM settings').all();
  const s = { ...DEFAULT_SETTINGS };
  for (const r of results) s[r.key] = r.value;
  return s;
}

// ---------- Claude ----------
async function claude(env, { system, messages, model, max_tokens = 1500 }) {
  if (!env.ANTHROPIC_API_KEY) throw new Error('Falta ANTHROPIC_API_KEY');
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: model || env.AI_MODEL || 'claude-sonnet-5-5', max_tokens, system, messages }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(`Claude ${r.status}: ${d?.error?.message || JSON.stringify(d)}`);
  return d.content.filter((c) => c.type === 'text').map((c) => c.text).join('');
}

function parseJsonLoose(text) {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('La IA no devolvió JSON');
  return JSON.parse(m[0]);
}

async function extractMenu(env, { base64, mediaType, text }) {
  const content = [];
  if (base64) {
    if (mediaType === 'application/pdf') content.push({ type: 'document', source: { type: 'base64', media_type: mediaType, data: base64 } });
    else content.push({ type: 'image', source: { type: 'base64', media_type: mediaType || 'image/jpeg', data: base64 } });
  }
  content.push({ type: 'text', text: text ? `Menú en texto:\n${text}\n\nOrganízalo.` : 'Transcribe este menú de restaurante.' });
  return claude(env, {
    model: env.AI_MODEL,
    max_tokens: 4000,
    system: 'Transcribes menús de restaurante a texto limpio. Agrupa por sección (Entradas, Fuertes, etc.). Una línea por platillo: nombre — descripción breve — precio si aparece. Si hay carta de vinos, lístala al final bajo "CARTA DE VINOS ACTUAL". Sin comentarios adicionales.',
    messages: [{ role: 'user', content }],
  });
}

async function threadText(env, leadId, limit = 30) {
  const { results } = await env.DB.prepare('SELECT direction, body, author, created_at FROM messages WHERE lead_id=? ORDER BY id DESC LIMIT ?').bind(leadId, limit).all();
  return results.reverse().map((m) => `${m.direction === 'in' ? 'CLIENTE' : 'DOS BÚHOS' + (m.author ? ` (${m.author})` : '')}: ${m.body}`).join('\n');
}

async function wineCatalog(env) {
  const { results } = await env.DB.prepare('SELECT id, name, style, notes, price_horeca FROM wines WHERE active=1 ORDER BY id').all();
  return results;
}

async function aiSummarize(env, leadId) {
  const lead = await env.DB.prepare('SELECT * FROM leads WHERE id=?').bind(leadId).first();
  const thread = await threadText(env, leadId);
  if (!thread) return;
  const out = await claude(env, {
    model: env.AI_MODEL_FAST,
    max_tokens: 400,
    system: 'Eres el asistente comercial de Bodega Dos Búhos. Lees conversaciones con restaurantes y devuelves SOLO JSON: {"summary": "una línea, máx 20 palabras, estado real de la relación", "next_step": "acción concreta siguiente, máx 10 palabras", "stage": uno de ["spark","conversacion","propuesta","cita","cliente","dormido"], "venue": "nombre del lugar si se menciona o null", "contact_name": "nombre del contacto si se menciona o null", "email": "email si se menciona o null"}. No inventes datos.',
    messages: [{ role: 'user', content: `Etapa actual: ${lead.stage}\nLugar: ${lead.venue || '?'}\n\n${thread}` }],
  });
  const j = parseJsonLoose(out);
  const stage = STAGES.includes(j.stage) && STAGES.indexOf(j.stage) >= STAGES.indexOf(lead.stage) ? j.stage : lead.stage;
  await env.DB.prepare(
    `UPDATE leads SET summary=?, next_step=?, stage=?, venue=COALESCE(venue, ?), contact_name=COALESCE(contact_name, ?), email=COALESCE(email, ?), updated_at=? WHERE id=?`
  ).bind(j.summary || lead.summary, j.next_step || lead.next_step, stage, j.venue || null, j.contact_name || null, j.email || null, nowIso(), leadId).run();
}

async function aiDraftReply(env, leadId, author) {
  const lead = await env.DB.prepare('SELECT * FROM leads WHERE id=?').bind(leadId).first();
  const s = await allSettings(env);
  const wines = await wineCatalog(env);
  const thread = await threadText(env, leadId);
  const props = await env.DB.prepare('SELECT token, status FROM proposals WHERE lead_id=? ORDER BY id DESC LIMIT 1').bind(leadId).first();
  return (await claude(env, {
    model: env.AI_MODEL,
    max_tokens: 500,
    system: `Escribes mensajes de WhatsApp en nombre de ${author || 'Eric'} de Bodega Dos Búhos (vino orgánico certificado, San Miguel de Allende, Guanajuato) a compradores de restaurantes que probaron nuestros vinos.
Voz: ${s.brand_voice}
Objetivo de cada conversación, en orden: conseguir el menú (foto o PDF) → enviar propuesta de maridaje → agendar una cata en su restaurante o una visita a la bodega → primer pedido.
Condiciones comerciales: ${s.offer_terms}
Visita: ${s.winery_visit}
Vinos: ${wines.map((w) => w.name).join(', ')}.
Reglas: no inventes precios ni fechas. Si ya hay propuesta, refiérete a ella. Devuelve SOLO el texto del mensaje, sin comillas.`,
    messages: [{ role: 'user', content: `Lugar: ${lead.venue || '?'} · Contacto: ${lead.contact_name || '?'} · Etapa: ${lead.stage}\nMenú recibido: ${lead.menu_text ? 'sí' : 'no'} · Propuesta: ${props ? props.status : 'ninguna'}\n\nConversación:\n${thread || '(sin mensajes aún — escribe el primer mensaje después de la cata)'}\n\nEscribe el siguiente mensaje.` }],
  })).trim();
}

async function aiProposal(env, leadId) {
  const lead = await env.DB.prepare('SELECT * FROM leads WHERE id=?').bind(leadId).first();
  if (!lead.menu_text) throw new Error('Primero sube el menú');
  const s = await allSettings(env);
  const wines = await wineCatalog(env);
  const out = await claude(env, {
    model: env.AI_MODEL,
    max_tokens: 3000,
    system: `Eres el sommelier de Bodega Dos Búhos. Armas propuestas de vino para restaurantes a partir de su menú. Solo usas vinos de este catálogo (usa el nombre exacto):
${wines.map((w) => `- ${w.name} (${w.style || ''}): ${w.notes || ''}`).join('\n')}
Devuelve SOLO JSON:
{"headline": "título corto para la propuesta, menciona el restaurante",
 "intro": "2 frases, por qué estos vinos encajan con su cocina",
 "pairings": [{"dish": "platillo exacto del menú", "wine": "nombre exacto del catálogo", "why": "máx 15 palabras"}],  // 5 a 8
 "by_the_glass": [{"wine": "nombre", "why": "máx 12 palabras"}], // 2 o 3 vinos por copa
 "gap": "si ya tienen carta de vinos, qué hueco llena Dos Búhos en una frase; si no, null",
 "close": "1 frase invitando a una cata en su restaurante o visita a la bodega"}
Tono: ${s.brand_voice}`,
    messages: [{ role: 'user', content: `Restaurante: ${lead.venue || 'el restaurante'} (${lead.city || ''})\n\nMENÚ:\n${lead.menu_text}` }],
  });
  const data = parseJsonLoose(out);
  data.offer = s.offer_terms;
  const token = randToken(10);
  const r = await env.DB.prepare('INSERT INTO proposals (lead_id, token, data) VALUES (?,?,?)').bind(leadId, token, JSON.stringify(data)).run();
  await env.DB.prepare(`UPDATE leads SET stage=CASE WHEN stage IN ('spark','conversacion') THEN 'propuesta' ELSE stage END, updated_at=? WHERE id=?`).bind(nowIso(), leadId).run();
  return { id: r.meta.last_row_id, token, data };
}

// ---------- WhatsApp Cloud API ----------
const GRAPH = 'https://graph.facebook.com/v21.0';

async function waSend(env, to, payload) {
  if (!env.WA_TOKEN || !env.WA_PHONE_ID) throw new Error('WhatsApp no está configurado (WA_TOKEN / WA_PHONE_ID)');
  const r = await fetch(`${GRAPH}/${env.WA_PHONE_ID}/messages`, {
    method: 'POST',
    headers: { authorization: `Bearer ${env.WA_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to: digits(to), ...payload }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(`WhatsApp: ${d?.error?.message || r.status}`);
  return d.messages?.[0]?.id;
}

function inWindow(lead) {
  return lead.last_inbound_at && Date.now() - new Date(lead.last_inbound_at).getTime() < 23.5 * 3600 * 1000;
}

// Sends text if inside the 24h window, otherwise the approved re-open template.
async function sendToLead(env, lead, body, author) {
  if (!lead.whatsapp) throw new Error('Este contacto no tiene WhatsApp');
  let waId, kind = 'text';
  if (inWindow(lead)) {
    waId = await waSend(env, lead.whatsapp, { type: 'text', text: { body, preview_url: true } });
  } else {
    kind = 'template';
    waId = await waSend(env, lead.whatsapp, {
      type: 'template',
      template: {
        name: env.WA_TEMPLATE || 'spark_seguimiento',
        language: { code: env.WA_TEMPLATE_LANG || 'es_MX' },
        components: [{ type: 'body', parameters: [{ type: 'text', text: lead.contact_name || 'hola' }, { type: 'text', text: author || 'Eric' }] }],
      },
    });
    body = `[Plantilla ${env.WA_TEMPLATE || 'spark_seguimiento'} — fuera de la ventana de 24 h] ${body}`;
  }
  await env.DB.prepare('INSERT INTO messages (lead_id, direction, body, author, wa_id, status) VALUES (?,?,?,?,?,?)').bind(lead.id, 'out', body, author, waId, 'sent').run();
  await env.DB.prepare(`UPDATE leads SET stage=CASE WHEN stage='spark' THEN 'conversacion' ELSE stage END, updated_at=? WHERE id=?`).bind(nowIso(), lead.id).run();
  return { kind, waId };
}

async function waMedia(env, mediaId) {
  const meta = await (await fetch(`${GRAPH}/${mediaId}`, { headers: { authorization: `Bearer ${env.WA_TOKEN}` } })).json();
  const bin = await fetch(meta.url, { headers: { authorization: `Bearer ${env.WA_TOKEN}` } });
  const buf = new Uint8Array(await bin.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return { base64: btoa(s), mediaType: meta.mime_type };
}

async function handleInbound(env, ctx, msg, contacts) {
  const from = digits(msg.from);
  const profileName = contacts?.find((c) => c.wa_id === msg.from)?.profile?.name || null;
  let lead = await env.DB.prepare('SELECT * FROM leads WHERE substr(whatsapp, -10)=? ORDER BY id DESC LIMIT 1').bind(last10(from)).first();
  let body = '';
  if (msg.type === 'text') body = msg.text.body;
  else if (msg.type === 'image') body = `[Foto] ${msg.image.caption || ''}`.trim();
  else if (msg.type === 'document') body = `[Documento] ${msg.document.filename || ''}`.trim();
  else if (msg.type === 'button') body = msg.button.text;
  else if (msg.type === 'interactive') body = msg.interactive?.button_reply?.title || msg.interactive?.list_reply?.title || '[interactivo]';
  else body = `[${msg.type}]`;

  if (!lead) {
    const repCode = (body.match(/SPARK-([A-Z0-9]+)/i) || [])[1];
    const rep = repCode ? await env.DB.prepare('SELECT id FROM reps WHERE upper(code)=upper(?)').bind(repCode).first() : null;
    const venueGuess = (body.match(/(?:soy de|somos de|de parte de)\s+([^.,\n\[]+)/i) || [])[1]?.trim() || null;
    const r = await env.DB.prepare('INSERT INTO leads (contact_name, whatsapp, rep_id, venue, stage, last_inbound_at) VALUES (?,?,?,?,?,?)')
      .bind(profileName, from, rep?.id || null, venueGuess, 'conversacion', nowIso()).run();
    lead = await env.DB.prepare('SELECT * FROM leads WHERE id=?').bind(r.meta.last_row_id).first();
  } else {
    await env.DB.prepare(`UPDATE leads SET last_inbound_at=?, contact_name=COALESCE(contact_name, ?), stage=CASE WHEN stage IN ('spark','dormido') THEN 'conversacion' ELSE stage END, updated_at=? WHERE id=?`)
      .bind(nowIso(), profileName, nowIso(), lead.id).run();
    lead = await env.DB.prepare('SELECT * FROM leads WHERE id=?').bind(lead.id).first();
  }
  const exists = await env.DB.prepare('SELECT id FROM messages WHERE wa_id=?').bind(msg.id).first();
  if (exists) return;
  await env.DB.prepare('INSERT INTO messages (lead_id, direction, body, wa_id) VALUES (?,?,?,?)').bind(lead.id, 'in', body, msg.id).run();

  ctx.waitUntil((async () => {
    try {
      // A photo or PDF from a restaurant is almost always the menu.
      if ((msg.type === 'image' || (msg.type === 'document' && msg.document.mime_type === 'application/pdf')) && env.ANTHROPIC_API_KEY) {
        const media = await waMedia(env, msg.image?.id || msg.document?.id);
        const menu = await extractMenu(env, media);
        const prev = lead.menu_text ? lead.menu_text + '\n\n' : '';
        await env.DB.prepare('UPDATE leads SET menu_text=?, updated_at=? WHERE id=?').bind(prev + menu, nowIso(), lead.id).run();
      }
      if (env.ANTHROPIC_API_KEY) await aiSummarize(env, lead.id);
      if ((await getSetting(env, 'auto_reply', 'off')) === 'on' && env.ANTHROPIC_API_KEY) {
        const fresh = await env.DB.prepare('SELECT * FROM leads WHERE id=?').bind(lead.id).first();
        const draft = await aiDraftReply(env, lead.id, 'Eric');
        await sendToLead(env, fresh, draft, 'IA');
      }
    } catch (e) {
      await env.DB.prepare('INSERT INTO messages (lead_id, direction, body, author) VALUES (?,?,?,?)').bind(lead.id, 'note', `Error IA: ${e.message}`, 'sistema').run();
    }
  })());
}

async function verifyMetaSig(req, env, raw) {
  if (!env.WA_APP_SECRET) return true;
  const sig = (req.headers.get('x-hub-signature-256') || '').replace('sha256=', '');
  return safeEq(await hmac(env.WA_APP_SECRET, raw), sig);
}

// ---------- email ----------
async function sendEmail(env, to, subject, htmlBody) {
  if (!env.RESEND_API_KEY) return { ok: false, reason: 'no_provider' };
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: env.EMAIL_FROM || 'Dos Búhos <onboarding@resend.dev>', to: [to], subject, html: htmlBody }),
  });
  if (!r.ok) throw new Error(`Email: ${(await r.text()).slice(0, 200)}`);
  return { ok: true };
}

// ---------- public pages ----------
const PAGE_CSS = `@import url('https://fonts.googleapis.com/css2?family=Lustria&display=swap');
:root{--bg:#F7F7F7;--fg:#1a1a1a;--mute:#6b6b6b;--line:#e2e2e2;--card:#fff;--acc:#7a2e2e}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:300 16px/1.6 Lustria,Georgia,serif}
.wrap{max-width:720px;margin:0 auto;padding:32px 16px 64px}h1,h2{font-weight:400;line-height:1.2}h1{font-size:30px;margin:8px 0 12px}
h2{font-size:20px;margin:36px 0 12px;border-bottom:1px solid var(--line);padding-bottom:6px}.mark{letter-spacing:.3em;font-size:12px;text-transform:uppercase;color:var(--mute)}
.pair{background:var(--card);border:1px solid var(--line);padding:14px 16px;margin:10px 0}.pair b{display:block;font-weight:400}.pair .w{color:var(--acc)}.pair small{color:var(--mute)}
.btn{display:inline-block;background:#000;color:#fff;padding:12px 20px;text-decoration:none;border:0;font:inherit;cursor:pointer;margin:6px 6px 0 0}.btn.ghost{background:transparent;color:#000;border:1px solid #000}
input,textarea,select{width:100%;font:inherit;padding:10px;border:1px solid var(--line);background:#fff;margin:4px 0 12px}label{font-size:13px;color:var(--mute)}
.muted{color:var(--mute);font-size:14px}`;

function shell(title, body) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${PAGE_CSS}</style></head><body><div class="wrap">${body}</div></body></html>`;
}

async function proposalPage(env, token) {
  const p = await env.DB.prepare('SELECT * FROM proposals WHERE token=?').bind(token).first();
  if (!p) return html(shell('No encontrado', '<p>Propuesta no encontrada.</p>'), 404);
  await env.DB.prepare('UPDATE proposals SET views=views+1 WHERE id=?').bind(p.id).run();
  const lead = await env.DB.prepare('SELECT * FROM leads WHERE id=?').bind(p.lead_id).first();
  const d = JSON.parse(p.data);
  const wines = await wineCatalog(env);
  const price = (name) => { const w = wines.find((x) => x.name === name); return w?.price_horeca ? ` · $${Number(w.price_horeca).toLocaleString('es-MX')} MXN` : ''; };
  const used = [...new Set([...(d.pairings || []).map((x) => x.wine), ...(d.by_the_glass || []).map((x) => x.wine)])];
  const waText = encodeURIComponent(`Hola, vi la propuesta de Dos Búhos para ${lead.venue || 'nuestro restaurante'} y me gustaría agendar una cata.`);
  const body = `<div class="mark">Bodega Dos Búhos · San Miguel de Allende</div>
<h1>${esc(d.headline)}</h1><p>${esc(d.intro)}</p>
<h2>Maridajes con su menú</h2>${(d.pairings || []).map((x) => `<div class="pair"><b>${esc(x.dish)}</b><span class="w">${esc(x.wine)}</span><br><small>${esc(x.why)}</small></div>`).join('')}
${d.by_the_glass?.length ? `<h2>Por copa</h2>${d.by_the_glass.map((x) => `<div class="pair"><span class="w">${esc(x.wine)}</span><br><small>${esc(x.why)}</small></div>`).join('')}` : ''}
${d.gap ? `<h2>En su carta</h2><p>${esc(d.gap)}</p>` : ''}
<h2>Vinos propuestos</h2>${used.map((n) => `<div>${esc(n)}<span class="muted">${esc(price(n))}</span></div>`).join('')}
<p class="muted" style="margin-top:12px">${esc(d.offer || '')}</p>
<h2>Siguiente paso</h2><p>${esc(d.close)}</p>
${env.WA_NUMBER ? `<a class="btn" href="https://wa.me/${digits(env.WA_NUMBER)}?text=${waText}">Agendar por WhatsApp</a>` : ''}
<p class="muted" style="margin-top:40px">Vino orgánico certificado · Viñedo a 2,000 m</p>`;
  return html(shell(d.headline || 'Propuesta Dos Búhos', body));
}

async function repPage(env, code, flash = '') {
  const rep = await env.DB.prepare('SELECT * FROM reps WHERE code=? AND active=1').bind(code).first();
  if (!rep) return html(shell('No encontrado', '<p>Enlace no válido.</p>'), 404);
  const { results: appts } = await env.DB.prepare(
    `SELECT a.*, l.venue, l.contact_name, l.city FROM appointments a JOIN leads l ON l.id=a.lead_id WHERE a.rep_id=? AND a.status='scheduled' ORDER BY a.starts_at`
  ).bind(rep.id).all();
  const qr = env.WA_NUMBER ? `/s/${encodeURIComponent(rep.code)}` : null;
  const body = `<div class="mark">Spark · ${esc(rep.name)}</div>
${flash ? `<p style="background:#fff;border:1px solid #000;padding:10px">${esc(flash)}</p>` : ''}
<h1>Tus catas</h1>
${appts.length ? appts.map((a) => `<div class="pair"><b>${esc(a.venue || 'Lugar')}</b>${esc(fmtDate(a.starts_at, env))}<br><small>Contacto: ${esc(a.contact_name || '—')} · ${esc(a.city || '')}</small><br><small>Llevar: ${esc(a.wines || 'por definir')}</small>${a.notes ? `<br><small>${esc(a.notes)}</small>` : ''}
<form method="post" action="/r/${esc(rep.code)}/done/${a.id}"><input name="note" placeholder="¿Cómo fue? (opcional)"><button class="btn">Cata hecha</button></form></div>`).join('') : '<p class="muted">No tienes catas agendadas.</p>'}
<h2>Nuevo spark</h2>
<form method="post" action="/r/${esc(rep.code)}/lead">
<label>Lugar</label><input name="venue" required>
<label>Contacto (nombre)</label><input name="contact_name">
<label>WhatsApp</label><input name="whatsapp" inputmode="tel">
<label>Email</label><input name="email" type="email">
<label>Ciudad</label><input name="city">
<button class="btn">Guardar</button></form>
${qr ? `<h2>Tu QR</h2><p class="muted">Muéstralo en la mesa: abre WhatsApp con tu código.</p><img alt="QR" width="220" height="220" src="https://api.qrserver.com/v1/create-qr-code/?size=440x440&data=${encodeURIComponent(`https://${env.HOST || ''}${qr}`)}">` : ''}`;
  return html(shell(`Spark · ${rep.name}`, body));
}

// ---------- router ----------
export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    env.HOST = url.host;
    const p = url.pathname;
    const method = req.method;

    try {
      // WhatsApp webhook
      if (p === '/webhook/whatsapp') {
        if (method === 'GET') {
          const ok = url.searchParams.get('hub.mode') === 'subscribe' && url.searchParams.get('hub.verify_token') === env.WA_VERIFY_TOKEN;
          return ok ? new Response(url.searchParams.get('hub.challenge')) : new Response('forbidden', { status: 403 });
        }
        const raw = await req.text();
        if (!(await verifyMetaSig(req, env, raw))) return new Response('bad sig', { status: 401 });
        const data = JSON.parse(raw);
        for (const entry of data.entry || []) for (const ch of entry.changes || []) {
          const v = ch.value || {};
          for (const m of v.messages || []) await handleInbound(env, ctx, m, v.contacts);
          for (const st of v.statuses || []) await env.DB.prepare('UPDATE messages SET status=? WHERE wa_id=?').bind(st.status, st.id).run();
        }
        return new Response('ok');
      }

      // QR redirect: opens WhatsApp to the business number with the rep code
      if (p.startsWith('/s/')) {
        const code = decodeURIComponent(p.slice(3));
        const text = encodeURIComponent(`Hola, probé los vinos de Dos Búhos hoy. Me interesa conocer más. [SPARK-${code}]`);
        return Response.redirect(`https://wa.me/${digits(env.WA_NUMBER)}?text=${text}`, 302);
      }

      if (p.startsWith('/p/')) return proposalPage(env, p.slice(3));

      const repMatch = p.match(/^\/r\/([^/]+)(?:\/(lead|done)(?:\/(\d+))?)?$/);
      if (repMatch) {
        const code = decodeURIComponent(repMatch[1]);
        const rep = await env.DB.prepare('SELECT * FROM reps WHERE code=? AND active=1').bind(code).first();
        if (!rep) return html(shell('No encontrado', '<p>Enlace no válido.</p>'), 404);
        if (method === 'POST' && repMatch[2] === 'lead') {
          const f = await req.formData();
          await env.DB.prepare('INSERT INTO leads (venue, contact_name, whatsapp, email, city, rep_id, stage, summary) VALUES (?,?,?,?,?,?,?,?)')
            .bind(f.get('venue'), f.get('contact_name') || null, digits(f.get('whatsapp')) || null, f.get('email') || null, f.get('city') || null, rep.id, 'spark', `Spark capturado por ${rep.name}`).run();
          return repPage(env, code, 'Guardado. Eric y Diana toman la conversación desde aquí.');
        }
        if (method === 'POST' && repMatch[2] === 'done') {
          const f = await req.formData();
          const a = await env.DB.prepare('SELECT * FROM appointments WHERE id=? AND rep_id=?').bind(repMatch[3], rep.id).first();
          if (a) {
            await env.DB.prepare(`UPDATE appointments SET status='done', result_note=? WHERE id=?`).bind(f.get('note') || null, a.id).run();
            await env.DB.prepare('INSERT INTO messages (lead_id, direction, body, author) VALUES (?,?,?,?)').bind(a.lead_id, 'note', `Cata hecha por ${rep.name}. ${f.get('note') || ''}`, rep.name).run();
            await env.DB.prepare('UPDATE leads SET updated_at=? WHERE id=?').bind(nowIso(), a.lead_id).run();
          }
          return repPage(env, code, 'Listo, registrado.');
        }
        return repPage(env, code);
      }

      // Login
      if (p === '/login' && method === 'POST') {
        const f = await req.formData();
        if (!env.ADMIN_PASSWORD || f.get('password') !== env.ADMIN_PASSWORD) return html(loginPage('Contraseña incorrecta'), 401);
        const name = String(f.get('name') || 'Eric').slice(0, 30);
        return new Response(null, { status: 302, headers: { location: '/app', 'set-cookie': `spark=${await makeSession(env, name)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000` } });
      }
      if (p === '/login') return html(loginPage());
      if (p === '/logout') return new Response(null, { status: 302, headers: { location: '/login', 'set-cookie': 'spark=; Path=/; Max-Age=0' } });

      const session = await readSession(req, env);
      if (p === '/' || p === '/app') {
        if (!session) return Response.redirect(`${url.origin}/login`, 302);
        return html(APP_HTML);
      }
      if (p.startsWith('/api/')) {
        if (!session) return json({ error: 'unauthorized' }, 401);
        return await api(req, env, ctx, url, session);
      }
      return new Response('Not found', { status: 404 });
    } catch (e) {
      return p.startsWith('/api/') ? json({ error: e.message }, 500) : new Response(`Error: ${e.message}`, { status: 500 });
    }
  },
};

function loginPage(err = '') {
  return shell('Spark', `<div class="mark">Bodega Dos Búhos</div><h1>Spark</h1>${err ? `<p style="color:#7a2e2e">${esc(err)}</p>` : ''}
<form method="post" action="/login"><label>¿Quién eres?</label><select name="name"><option>Eric</option><option>Diana</option></select>
<label>Contraseña</label><input name="password" type="password" required autofocus><button class="btn">Entrar</button></form>`);
}

// ---------- API ----------
async function api(req, env, ctx, url, session) {
  const p = url.pathname.slice(4); // strip /api
  const m = req.method;
  const body = m === 'GET' ? {} : await req.json().catch(() => ({}));
  const DB = env.DB;
  let r;

  if (p === '/me') return json({ name: session.name, stages: STAGES, wa: !!env.WA_TOKEN, ai: !!env.ANTHROPIC_API_KEY, email: !!env.RESEND_API_KEY, host: url.host, wa_number: env.WA_NUMBER || null });

  if (p === '/today') {
    const needsReply = (await DB.prepare(`SELECT l.*, (SELECT body FROM messages WHERE lead_id=l.id AND direction='in' ORDER BY id DESC LIMIT 1) AS last_in FROM leads l
      WHERE l.last_inbound_at IS NOT NULL AND datetime(l.last_inbound_at) > COALESCE((SELECT max(datetime(created_at)) FROM messages WHERE lead_id=l.id AND direction='out'), '') AND l.stage NOT IN ('dormido')
      ORDER BY l.last_inbound_at DESC`).all()).results;
    const upcoming = (await DB.prepare(`SELECT a.*, l.venue, r.name AS rep_name FROM appointments a JOIN leads l ON l.id=a.lead_id LEFT JOIN reps r ON r.id=a.rep_id WHERE a.status='scheduled' ORDER BY a.starts_at LIMIT 20`).all()).results;
    const fresh = (await DB.prepare(`SELECT l.*, r.name AS rep_name FROM leads l LEFT JOIN reps r ON r.id=l.rep_id WHERE l.stage='spark' ORDER BY l.created_at DESC`).all()).results;
    const stale = (await DB.prepare(`SELECT * FROM leads WHERE stage IN ('conversacion','propuesta','cita') AND datetime(updated_at) < datetime('now','-7 days') ORDER BY updated_at LIMIT 20`).all()).results;
    const counts = (await DB.prepare(`SELECT stage, count(*) n FROM leads GROUP BY stage`).all()).results;
    return json({ needsReply, upcoming, fresh, stale, counts });
  }

  if (p === '/leads' && m === 'GET') {
    const stage = url.searchParams.get('stage');
    const q = url.searchParams.get('q');
    let sql = `SELECT l.*, r.name AS rep_name FROM leads l LEFT JOIN reps r ON r.id=l.rep_id WHERE 1=1`;
    const args = [];
    if (stage) { sql += ' AND l.stage=?'; args.push(stage); }
    if (q) { sql += ' AND (l.venue LIKE ? OR l.contact_name LIKE ? OR l.city LIKE ?)'; args.push(`%${q}%`, `%${q}%`, `%${q}%`); }
    sql += ' ORDER BY datetime(l.updated_at) DESC LIMIT 300';
    return json((await DB.prepare(sql).bind(...args).all()).results);
  }
  if (p === '/leads' && m === 'POST') {
    r = await DB.prepare('INSERT INTO leads (venue, city, contact_name, role, whatsapp, email, rep_id, owner, stage) VALUES (?,?,?,?,?,?,?,?,?)')
      .bind(body.venue || null, body.city || null, body.contact_name || null, body.role || null, digits(body.whatsapp) || null, body.email || null, body.rep_id || null, session.name, 'spark').run();
    return json({ id: r.meta.last_row_id });
  }

  let mm;
  if ((mm = p.match(/^\/leads\/(\d+)$/))) {
    const id = Number(mm[1]);
    if (m === 'GET') {
      const lead = await DB.prepare('SELECT l.*, r.name AS rep_name FROM leads l LEFT JOIN reps r ON r.id=l.rep_id WHERE l.id=?').bind(id).first();
      if (!lead) return json({ error: 'not found' }, 404);
      const messages = (await DB.prepare('SELECT * FROM messages WHERE lead_id=? ORDER BY id').bind(id).all()).results;
      const proposals = (await DB.prepare('SELECT id, token, status, views, created_at, sent_at FROM proposals WHERE lead_id=? ORDER BY id DESC').bind(id).all()).results;
      const appointments = (await DB.prepare('SELECT a.*, r.name AS rep_name FROM appointments a LEFT JOIN reps r ON r.id=a.rep_id WHERE lead_id=? ORDER BY starts_at DESC').bind(id).all()).results;
      return json({ lead: { ...lead, in_window: !!inWindow(lead) }, messages, proposals, appointments });
    }
    if (m === 'PATCH') {
      const fields = ['venue', 'city', 'contact_name', 'role', 'whatsapp', 'email', 'stage', 'rep_id', 'owner', 'summary', 'next_step', 'next_date', 'menu_text'];
      const sets = [], args = [];
      for (const f of fields) if (f in body) { sets.push(`${f}=?`); args.push(f === 'whatsapp' ? digits(body[f]) || null : body[f] === '' ? null : body[f]); }
      if (body.stage && !STAGES.includes(body.stage)) return json({ error: 'bad stage' }, 400);
      if (!sets.length) return json({ ok: true });
      await DB.prepare(`UPDATE leads SET ${sets.join(',')}, updated_at=? WHERE id=?`).bind(...args, nowIso(), id).run();
      return json({ ok: true });
    }
    if (m === 'DELETE') {
      for (const t of ['messages', 'proposals', 'appointments']) await DB.prepare(`DELETE FROM ${t} WHERE lead_id=?`).bind(id).run();
      await DB.prepare('DELETE FROM leads WHERE id=?').bind(id).run();
      return json({ ok: true });
    }
  }
  if ((mm = p.match(/^\/leads\/(\d+)\/(message|draft|menu|proposal|note|appointment|summarize)$/)) && m === 'POST') {
    const id = Number(mm[1]);
    const lead = await DB.prepare('SELECT * FROM leads WHERE id=?').bind(id).first();
    if (!lead) return json({ error: 'not found' }, 404);
    switch (mm[2]) {
      case 'message': return json(await sendToLead(env, lead, String(body.body || '').trim(), session.name));
      case 'draft': return json({ draft: await aiDraftReply(env, id, session.name) });
      case 'summarize': await aiSummarize(env, id); return json({ ok: true });
      case 'note':
        await DB.prepare('INSERT INTO messages (lead_id, direction, body, author) VALUES (?,?,?,?)').bind(id, 'note', body.body, session.name).run();
        return json({ ok: true });
      case 'menu': {
        const text = await extractMenu(env, { base64: body.base64, mediaType: body.mediaType, text: body.text });
        await DB.prepare('UPDATE leads SET menu_text=?, updated_at=? WHERE id=?').bind(text, nowIso(), id).run();
        return json({ menu_text: text });
      }
      case 'proposal': return json(await aiProposal(env, id));
      case 'appointment': {
        const kind = body.kind === 'visit' ? 'visit' : 'pour';
        r = await DB.prepare('INSERT INTO appointments (lead_id, kind, starts_at, rep_id, wines, notes) VALUES (?,?,?,?,?,?)')
          .bind(id, kind, body.starts_at, kind === 'pour' ? body.rep_id || null : null, body.wines || null, body.notes || null).run();
        await DB.prepare(`UPDATE leads SET stage=CASE WHEN stage IN ('spark','conversacion','propuesta') THEN 'cita' ELSE stage END, next_step=?, next_date=?, updated_at=? WHERE id=?`)
          .bind(kind === 'pour' ? 'Cata en el restaurante' : 'Visita a la bodega', body.starts_at, nowIso(), id).run();
        let handoff = null;
        if (kind === 'pour' && body.rep_id) {
          const rep = await DB.prepare('SELECT * FROM reps WHERE id=?').bind(body.rep_id).first();
          const brief = `Spark · Cata asignada\n${lead.venue || 'Lugar'} — ${fmtDate(body.starts_at, env)}\nContacto: ${lead.contact_name || '—'}${lead.city ? ' · ' + lead.city : ''}\nLlevar: ${body.wines || 'ver propuesta'}\n${body.notes ? body.notes + '\n' : ''}Tus catas: https://${url.host}/r/${rep.code}`;
          handoff = { rep: rep.name, link: rep.whatsapp ? `https://wa.me/${digits(rep.whatsapp)}?text=${encodeURIComponent(brief)}` : null, brief };
        }
        return json({ id: r.meta.last_row_id, handoff });
      }
    }
  }

  if ((mm = p.match(/^\/proposals\/(\d+)\/send$/)) && m === 'POST') {
    const prop = await DB.prepare('SELECT * FROM proposals WHERE id=?').bind(mm[1]).first();
    const lead = await DB.prepare('SELECT * FROM leads WHERE id=?').bind(prop.lead_id).first();
    const link = `https://${url.host}/p/${prop.token}`;
    const d = JSON.parse(prop.data);
    let result;
    if (body.channel === 'email') {
      if (!lead.email) return json({ error: 'Sin email' }, 400);
      const msg = body.text || `Hola ${lead.contact_name || ''}, preparamos una propuesta de maridaje con su menú: ${link}`;
      const sent = await sendEmail(env, lead.email, d.headline || 'Propuesta Dos Búhos', `<p>${esc(msg)}</p><p><a href="${link}">${esc(link)}</a></p><p>— ${esc(session.name)}, Bodega Dos Búhos</p>`);
      if (!sent.ok) return json({ mailto: `mailto:${lead.email}?subject=${encodeURIComponent(d.headline || 'Propuesta Dos Búhos')}&body=${encodeURIComponent(msg + '\n\n' + link)}` });
      await DB.prepare('INSERT INTO messages (lead_id, direction, channel, body, author) VALUES (?,?,?,?,?)').bind(lead.id, 'out', 'email', `Propuesta enviada por email: ${link}`, session.name).run();
      result = { ok: true };
    } else {
      const text = body.text || `${lead.contact_name ? lead.contact_name + ', ' : ''}aquí está la propuesta que armamos con su menú: ${link}`;
      result = await sendToLead(env, lead, text, session.name);
    }
    await DB.prepare(`UPDATE proposals SET status='sent', sent_at=? WHERE id=?`).bind(nowIso(), prop.id).run();
    return json(result);
  }

  if ((mm = p.match(/^\/appointments\/(\d+)$/)) && m === 'PATCH') {
    const sets = [], args = [];
    for (const f of ['status', 'starts_at', 'rep_id', 'wines', 'notes', 'result_note']) if (f in body) { sets.push(`${f}=?`); args.push(body[f]); }
    if (sets.length) await DB.prepare(`UPDATE appointments SET ${sets.join(',')} WHERE id=?`).bind(...args, mm[1]).run();
    return json({ ok: true });
  }

  if (p === '/reps') {
    if (m === 'GET') return json((await DB.prepare(`SELECT r.*, (SELECT count(*) FROM leads WHERE rep_id=r.id) AS sparks, (SELECT count(*) FROM appointments WHERE rep_id=r.id AND status='done') AS pours FROM reps r ORDER BY active DESC, name`).all()).results);
    if (m === 'POST') {
      const code = (body.code || body.name || 'REP').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) + randToken(2).toUpperCase();
      r = await DB.prepare('INSERT INTO reps (name, whatsapp, code) VALUES (?,?,?)').bind(body.name, digits(body.whatsapp) || null, code).run();
      return json({ id: r.meta.last_row_id, code });
    }
  }
  if ((mm = p.match(/^\/reps\/(\d+)$/)) && m === 'PATCH') {
    const sets = [], args = [];
    for (const f of ['name', 'whatsapp', 'active']) if (f in body) { sets.push(`${f}=?`); args.push(f === 'whatsapp' ? digits(body[f]) : body[f]); }
    if (sets.length) await DB.prepare(`UPDATE reps SET ${sets.join(',')} WHERE id=?`).bind(...args, mm[1]).run();
    return json({ ok: true });
  }

  if (p === '/wines') {
    if (m === 'GET') return json((await DB.prepare('SELECT * FROM wines ORDER BY active DESC, id').all()).results);
    if (m === 'POST') {
      r = await DB.prepare('INSERT INTO wines (name, style, notes, price_horeca) VALUES (?,?,?,?)').bind(body.name, body.style || null, body.notes || null, body.price_horeca || null).run();
      return json({ id: r.meta.last_row_id });
    }
  }
  if ((mm = p.match(/^\/wines\/(\d+)$/)) && m === 'PATCH') {
    const sets = [], args = [];
    for (const f of ['name', 'style', 'notes', 'price_horeca', 'active']) if (f in body) { sets.push(`${f}=?`); args.push(body[f] === '' ? null : body[f]); }
    if (sets.length) await DB.prepare(`UPDATE wines SET ${sets.join(',')} WHERE id=?`).bind(...args, mm[1]).run();
    return json({ ok: true });
  }

  if (p === '/settings') {
    if (m === 'GET') return json(await allSettings(env));
    if (m === 'POST') {
      for (const [k, v] of Object.entries(body)) if (k in DEFAULT_SETTINGS) await DB.prepare('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(k, String(v)).run();
      return json({ ok: true });
    }
  }

  return json({ error: 'not found' }, 404);
}
