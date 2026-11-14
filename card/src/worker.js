// hola.dosbuhos.com — static card app (assets) + /media/* served from R2 (videos).

const MIME = { mp4: 'video/mp4', webm: 'video/webm', m4v: 'video/mp4', mov: 'video/quicktime', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', vtt: 'text/vtt' };
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, HEAD, OPTIONS', 'access-control-allow-headers': 'range', 'access-control-expose-headers': 'content-range, content-length, accept-ranges, etag' };

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    // one address only: the old *.workers.dev address forwards to hola.dosbuhos.com (same path), so nobody keeps a stale copy
    if (url.hostname !== 'hola.dosbuhos.com' && url.hostname.endsWith('.workers.dev')) return Response.redirect('https://hola.dosbuhos.com' + url.pathname + url.search, 301);
    // tracked print QR codes: /eye (The Eye, Dec 2026) -> OpenTable. Each scan is logged as a tiny object in R2 under _scans/ (never served publicly);
    // /eye/stats returns the count. The destination lives here, so it can change after the ad is printed.
    const QR = { eye: 'https://www.opentable.com.mx/restref/client/?rid=1258120&restref=1258120&lang=en-US&ot_source=Restaurant%20website' };
    const qm = /^\/(eye)(\/stats)?\/?$/.exec(url.pathname);
    if (qm) {
      const code = qm[1], prefix = `_scans/${code}/`;
      if (qm[2]) {
        const days = {}; let total = 0, cursor;
        do { const l = await env.MEDIA.list({ prefix, cursor, limit: 1000 }); for (const o of l.objects) { total++; const d = o.key.slice(prefix.length, prefix.length + 10); days[d] = (days[d] || 0) + 1; } cursor = l.truncated ? l.cursor : undefined; } while (cursor);
        return new Response(JSON.stringify({ code, scans: total, by_day: days }, null, 2), { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
      }
      const ua = req.headers.get('user-agent') || '';
      if (req.method === 'GET' && !/bot|crawl|spider|preview|facebookexternalhit|whatsapp/i.test(ua)) {
        const key = `${prefix}${new Date().toISOString()}-${Math.random().toString(36).slice(2, 8)}`;
        const log = env.MEDIA.put(key, JSON.stringify({ country: req.cf && req.cf.country, city: req.cf && req.cf.city, ua: ua.slice(0, 160) })).catch(() => {});
        if (ctx && ctx.waitUntil) ctx.waitUntil(log); else await log;
      }
      return new Response(null, { status: 302, headers: { location: QR[code], 'cache-control': 'no-store' } });
    }
    // /videos/* are static assets; add byte-range support (Safari needs 206 to play video)
    if (url.pathname.startsWith('/videos/') && url.pathname.endsWith('.mp4')) {
      const res = await env.ASSETS.fetch(new Request(url.toString(), { method: 'GET' }));
      if (!res.ok) return res;
      const buf = await res.arrayBuffer(); const size = buf.byteLength;
      const h = new Headers({ 'content-type': 'video/mp4', 'accept-ranges': 'bytes', 'cache-control': 'public, max-age=86400' });
      const m = /bytes=(\d*)-(\d*)/.exec(req.headers.get('range') || '');
      if (m) { let start = m[1] === '' ? size - Number(m[2]) : Number(m[1]); let end = m[1] !== '' && m[2] !== '' ? Number(m[2]) : size - 1;
        start = Math.max(0, start); end = Math.min(end, size - 1);
        h.set('content-range', `bytes ${start}-${end}/${size}`); h.set('content-length', String(end - start + 1));
        return new Response(req.method === 'HEAD' ? null : buf.slice(start, end + 1), { status: 206, headers: h }); }
      h.set('content-length', String(size)); return new Response(req.method === 'HEAD' ? null : buf, { headers: h });
    }
    if (!url.pathname.startsWith('/media/')) return env.ASSETS.fetch(req);
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });

    // ---- serve media with Range support ----
    if (req.method !== 'GET' && req.method !== 'HEAD') return new Response('method', { status: 405 });
    const key = decodeURIComponent(url.pathname.slice('/media/'.length));
    if (!key || key.startsWith('_')) return new Response('not found', { status: 404 });
    const range = req.headers.get('range');
    const obj = await env.MEDIA.get(key, range ? { range: req.headers } : undefined);
    if (!obj) return new Response('not found', { status: 404 });
    const h = new Headers(cors);
    obj.writeHttpMetadata(h);
    const ext = key.split('.').pop().toLowerCase(); if (!h.get('content-type') && MIME[ext]) h.set('content-type', MIME[ext]);
    h.set('etag', obj.httpEtag); h.set('accept-ranges', 'bytes'); h.set('cache-control', 'public, max-age=31536000, immutable');
    if (obj.range) {
      const { offset = 0, length } = obj.range; const end = length != null ? offset + length - 1 : obj.size - 1;
      h.set('content-range', `bytes ${offset}-${end}/${obj.size}`); h.set('content-length', String(end - offset + 1));
      return new Response(req.method === 'HEAD' ? null : obj.body, { status: 206, headers: h });
    }
    h.set('content-length', String(obj.size));
    return new Response(req.method === 'HEAD' ? null : obj.body, { status: 200, headers: h });
  }
};
