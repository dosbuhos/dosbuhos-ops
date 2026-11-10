// hola.dosbuhos.com — static card app (assets) + /media/* served from R2 (videos).

const MIME = { mp4: 'video/mp4', webm: 'video/webm', m4v: 'video/mp4', mov: 'video/quicktime', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', vtt: 'text/vtt' };
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, HEAD, OPTIONS', 'access-control-allow-headers': 'range', 'access-control-expose-headers': 'content-range, content-length, accept-ranges, etag' };

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    // one address only: the old *.workers.dev address forwards to hola.dosbuhos.com (same path), so nobody keeps a stale copy
    if (url.hostname !== 'hola.dosbuhos.com' && url.hostname.endsWith('.workers.dev')) return Response.redirect('https://hola.dosbuhos.com' + url.pathname + url.search, 301);
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
