// The public side of a client survey: one page, two faces, an optional comment. No sign-in; the token in the link is the key.
const esc = (s) => String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const page = (body) => new Response(`<!doctype html><html lang="es-MX"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>Bodega Dos Búhos</title><style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f6f3ee;color:#22201d;font:17px/1.45 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;padding:20px}
main{background:#fffdf9;border:1px solid #e2dcd1;border-radius:16px;padding:28px 24px;max-width:460px;width:100%;text-align:center}
h1{font-size:1.35rem;margin:0 0 6px}p{margin:0 0 18px;color:#5e5850}.caras{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px}
label.cara{display:grid;gap:6px;justify-items:center;border:2px solid #e2dcd1;border-radius:14px;padding:16px 8px;cursor:pointer;font-weight:600}
label.cara svg{width:64px;height:64px}label.cara:has(input:checked){border-color:#6b2737;background:#f7eef0}label.cara input{position:absolute;opacity:0}
label.cara:has(input:focus-visible){outline:3px solid #6b2737;outline-offset:2px}
textarea{width:100%;min-height:110px;border:1px solid #cfc8bb;border-radius:12px;padding:12px;font:inherit;background:#fff}
button{margin-top:14px;width:100%;min-height:50px;border:0;border-radius:12px;background:#6b2737;color:#fff;font:inherit;font-weight:600;cursor:pointer}
small{display:block;margin-top:16px;color:#7a7368}.marca{letter-spacing:.14em;text-transform:uppercase;font-size:.75rem;color:#6b2737;font-weight:700;margin-bottom:14px}
</style></head><body><main><div class="marca">Bodega Dos Búhos</div>${body}</main></body></html>`, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
const CARA = (feliz) => `<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="28" fill="${feliz ? '#e7f1e4' : '#f6e3e0'}" stroke="${feliz ? '#3d6a38' : '#b42318'}" stroke-width="3"/><circle cx="23" cy="26" r="3.5" fill="#22201d"/><circle cx="41" cy="26" r="3.5" fill="#22201d"/><path d="${feliz ? 'M20 38c3 6 8 8 12 8s9-2 12-8' : 'M20 46c3-6 8-8 12-8s9 2 12 8'}" fill="none" stroke="#22201d" stroke-width="3" stroke-linecap="round"/></svg>`;

export async function encuestaPublica(request, env, token) {
  if (!/^[a-f0-9]{32}$/.test(token)) return page('<h1>Esta liga no es válida</h1><p>Pídele a tu contacto en Dos Búhos que te la mande de nuevo.</p>');
  const q = await env.DB.prepare('SELECT * FROM encuestas WHERE token = ?').bind(token).first();
  if (!q) return page('<h1>Esta liga ya no existe</h1><p>Pídele a tu contacto en Dos Búhos que te la mande de nuevo.</p>');
  if (request.method === 'POST') {
    if (q.respondida) return page('<h1>Gracias</h1><p>Ya habíamos recibido tu respuesta.</p>');
    const f = await request.formData().catch(() => null), r = f && f.get('respuesta');
    if (r !== 'feliz' && r !== 'no') return page('<h1>Falta elegir una cara</h1><p><a href="">Volver</a></p>');
    await env.DB.prepare('UPDATE encuestas SET respuesta = ?, comentario = ?, respondida = ? WHERE token = ? AND respondida = \'\'')
      .bind(r, String(f.get('comentario') || '').trim().slice(0, 1500), new Intl.DateTimeFormat('en-CA', { timeZone: env.TZ || 'America/Mexico_City' }).format(new Date()), token).run();
    return page(`<h1>Gracias, ${esc(q.cliente)}</h1><p>${r === 'feliz' ? 'Nos da gusto. Tu comentario le llega directo a la familia Maycotte.' : 'Gracias por decirlo. Tu comentario le llega directo a la familia Maycotte y te vamos a buscar.'}</p>`);
  }
  if (q.respondida) return page('<h1>Gracias</h1><p>Ya recibimos tu respuesta.</p>');
  return page(`<h1>¿Cómo te va con Dos Búhos?</h1><p>${esc(q.cliente)}: una respuesta rápida nos ayuda a atenderte mejor.</p>
<form method="post"><div class="caras">
<label class="cara"><input type="radio" name="respuesta" value="feliz" required>${CARA(true)}Contento</label>
<label class="cara"><input type="radio" name="respuesta" value="no">${CARA(false)}No contento</label></div>
<label for="c" style="display:block;text-align:left;font-weight:600;margin-bottom:6px">¿Por qué? (opcional)</label>
<textarea id="c" name="comentario" maxlength="1500" placeholder="El vino, el servicio, las entregas, lo que quieras decirnos"></textarea>
<button>Enviar</button></form><small>Tu respuesta la lee la dirección de Dos Búhos.</small>`);
}
