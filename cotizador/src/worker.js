// Cotizador de eventos — static app behind a PIN (secret PIN) or the Hub's signed header (secret HUB_SECRET),
// plus POST /pdf: renders the client proposal as a real PDF with Browser Rendering (binding BROWSER).
// Optional secret ANTHROPIC_API_KEY: Claude writes the proposal's opening note for the client; without it a template note is used.
import puppeteer from '@cloudflare/puppeteer';
import { hubUser } from './hub-auth.js';
import { proposalHTML, introText } from './proposal.js';

const enc = new TextEncoder();
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
async function sign(msg, secret) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64u(await crypto.subtle.sign('HMAC', key, enc.encode(msg)));
}
function cookie(req, name) { const m = (req.headers.get('cookie') || '').match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)')); return m ? m[1] : ''; }
const json = (o, status = 200, extra = {}) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', ...extra } });

// Opening note for the cover. With ANTHROPIC_API_KEY set, Claude writes 2–3 plain sentences from the quote; otherwise the template.
// Reads a secret that may be a plain Worker secret (string) or a Secrets Store binding (object with get()).
async function secret(v) { try { return typeof v === 'string' ? v : (v && typeof v.get === 'function' ? (await v.get()) || '' : ''); } catch (e) { return ''; } }

const DIAG = { binding: '', key: '', api: '' };   // last run, for ?html=1 debugging (never the key itself)
async function aiNote(d, env) {
  const v = env.ANTHROPIC_API_KEY;
  DIAG.binding = v === undefined ? 'missing' : typeof v === 'string' ? 'string' : (v && typeof v.get === 'function' ? 'secrets-store' : typeof v);
  let apiKey = '';
  try { apiKey = await secret(v); DIAG.key = apiKey ? `ok(${apiKey.length})` : 'empty'; } catch (e) { DIAG.key = 'error: ' + (e && e.message); }
  if (!apiKey) return '';
  const facts = {
    cliente: d.cliente, evento: d.evento, fecha: d.fecha, hora: d.hora, invitados: d.pax,
    espacio: d.space?.est ? 'la hacienda completa en exclusiva' : d.space?.name, horas: d.space?.hrs,
    incluye: (d.fb?.lines || []).filter(l => l[2] !== 'sub' && l[2] !== 'red').map(l => l[0]),
    velada: (d.it || []).map(r => r[1] + ': ' + r[2]),
  };
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal: ctrl.signal,
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: env.AI_MODEL || 'claude-haiku-5-5', max_tokens: 500, thinking: { type: 'disabled' },
        system: 'Escribes la nota de apertura de una propuesta de evento de Bodega Dos Búhos, viñedo orgánico certificado y restaurante en San Miguel de Allende. Voz: cálida, concreta, de la casa; como quien recibe a un amigo. Sin superlativos, sin adjetivos de relleno, sin frases de marketing, sin emojis, sin signos de exclamación. Español de México, trato de usted. Entre dos y tres frases, máximo 70 palabras, un solo párrafo, sin encabezado ni despedida. Menciona uno o dos elementos concretos de la cotización (el espacio, el menú, la barra o el recorrido) y, si hay nombre, dirígete al cliente por su nombre.',
        messages: [{ role: 'user', content: 'Datos de la cotización (JSON):\n' + JSON.stringify(facts) }],
      }),
    });
    DIAG.api = String(r.status);
    if (!r.ok) { DIAG.api += ' ' + (await r.text()).slice(0, 200); return ''; }
    const j = await r.json();
    DIAG.shape = JSON.stringify({ type: j.type, stop: j.stop_reason, model: j.model, blocks: (j.content || []).map(c => c.type), err: j.error }).slice(0, 300);
    let txt = (j.content || []).filter(c => c.type === 'text').map(c => c.text).join(' ').replace(/\s+/g, ' ').trim();
    txt = txt.replace(/^["“«]|["”»]$/g, '').trim();
    if (txt.length > 620) { const cut = txt.slice(0, 620).lastIndexOf('. '); txt = cut > 200 ? txt.slice(0, cut + 1) : txt; }   // keep it to a cover-sized paragraph
    DIAG.api += ` len=${txt.length}`;
    return txt.length > 20 ? txt : '';
  } catch (e) { DIAG.api = 'error: ' + (e && e.message); return ''; } finally { clearTimeout(t); }
}

const safeName = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w\- ]+/g, '').trim().slice(0, 60);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const who = await hubUser(request, env);   // set when proxied through the Hub (signed with HUB_SECRET)

    // Personal para eventos (public/personal.html): OPEN for now, no PIN and no sign-in, so it can be shared while it is
    // being tested. BACKLOG: put it behind the Hub's Google sign-in (the Hub already proxies /personal/ here with
    // X-DB-App = personal; require `who` on that path and send direct hits to HUB_ORIGIN + '/personal/').
    // Asset fetches use the clean URL (/personal, /guia, /gate): with html_handling "auto-trailing-slash" the asset
    // store answers /x.html with a 301 to /x, and mapping /x back to /x.html would loop.
    const viaHub = request.headers.get('X-DB-App') === 'personal' && (url.pathname === '/' || url.pathname === '/index.html');
    if (viaHub || url.pathname === '/personal') return env.ASSETS.fetch(new Request(new URL('/personal', request.url), request));
    // Guía del cotizador for the events team (public/guia.html): instructions, no PIN.
    if (url.pathname === '/guia') return env.ASSETS.fetch(new Request(new URL('/guia', request.url), request));

    const locked = !!env.PIN;
    let ok = !locked;
    if (locked) {
      if (cookie(request, 'cz') === await sign('ok', env.PIN)) ok = true;
      else if (who) ok = true;   // proxied through the Hub
    }
    if (url.pathname === '/login' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      if (!locked || String(body.pin || '') === String(env.PIN)) {
        const tok = await sign('ok', env.PIN || 'open');
        return json({ ok: true }, 200, { 'set-cookie': `cz=${tok}; Path=/; Max-Age=15552000; HttpOnly; Secure; SameSite=Lax` });
      }
      return json({ ok: false }, 401);
    }
    if (url.pathname === '/me') return json({ locked: locked && !ok });

    if (url.pathname === '/pdf' && request.method === 'POST') {
      if (!ok) return new Response('PIN requerido. Abre el cotizador e ingresa el PIN.', { status: 401, headers: { 'content-type': 'text/plain;charset=utf-8' } });
      let d = {};
      try {
        const ct = request.headers.get('content-type') || '';
        if (ct.includes('application/json')) d = await request.json();
        else { const fd = await request.formData(); d = JSON.parse(String(fd.get('q') || '{}')); }
      } catch (e) { return new Response('Cotización inválida', { status: 400 }); }
      let stage = 'nota';
      try {
        const note = url.searchParams.get('noai') ? '' : await aiNote(d, env);
        stage = 'plantilla';
        const html = proposalHTML(d, url.origin, note);
        if (url.searchParams.get('html')) return new Response(html, { headers: { 'content-type': 'text/html;charset=utf-8', 'x-note': note ? 'ai' : 'template', 'x-ai-diag': encodeURIComponent(JSON.stringify(DIAG)) } });   // template preview
        if (!env.BROWSER) return new Response('Browser Rendering no está configurado (binding BROWSER).', { status: 500 });
        stage = 'navegador';
        const browser = await puppeteer.launch(env.BROWSER);
        try {
          const page = await browser.newPage();
          page.setDefaultNavigationTimeout(20000);
          await page.setContent(html, { waitUntil: 'load' });   // everything is inline (fonts, logos, photos): no network needed
          await page.evaluateHandle('document.fonts.ready');
          stage = 'pdf';
          const pdf = await page.pdf({ format: 'letter', printBackground: true, preferCSSPageSize: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } });
          const name = `Dos Buhos - Propuesta${d.cliente ? ' - ' + safeName(d.cliente) : ''}.pdf`;
          return new Response(pdf, { headers: { 'content-type': 'application/pdf', 'content-disposition': `inline; filename="${name}"`, 'cache-control': 'no-store', 'x-note': note ? 'ai' : 'template' } });
        } finally { try { await browser.close(); } catch (e) {} }
      } catch (e) {
        return new Response(`No se pudo generar el PDF (${stage}): ${e && e.message ? e.message : e}\n\nInténtalo de nuevo en un momento; si persiste, avísale a Eric.`, { status: 500, headers: { 'content-type': 'text/plain;charset=utf-8' } });
      }
    }

    if (!ok && (url.pathname === '/' || url.pathname === '/index.html' || url.pathname === '/sw.js')) {
      return env.ASSETS.fetch(new Request(new URL('/gate', request.url), request));
    }
    return env.ASSETS.fetch(request);
  },
};
