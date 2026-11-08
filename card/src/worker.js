// hola.dosbuhos.com — static card app (assets) + /media/* served from R2 (videos).
const ALLOWED_KEYS = ['introduccion.mp4', 'certificacion.mp4'];   // temporary upload window: only these two objects can be written
const UP_NONCE = 'HqtC6l33I_iHfWIaVO0oAWVN';                                      // throwaway nonce for the one-time Drive→R2 transfer; removed after

const MIME = { mp4: 'video/mp4', webm: 'video/webm', m4v: 'video/mp4', mov: 'video/quicktime', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', vtt: 'text/vtt' };
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, PUT, POST, OPTIONS', 'access-control-allow-headers': 'content-type, x-up, range', 'access-control-expose-headers': 'content-range, content-length, accept-ranges, etag' };

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
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

    // ---- one-time chunked upload (multipart to R2) ----
    if (url.pathname.startsWith('/media/_up/')) {
      if (req.headers.get('x-up') !== UP_NONCE) return new Response('no', { status: 403, headers: cors });
      const key = url.searchParams.get('key'); const op = url.pathname.slice('/media/_up/'.length);
      if (!ALLOWED_KEYS.includes(key)) return new Response('key not allowed', { status: 400, headers: cors });
      if (op === 'ping') return new Response('ok', { headers: cors });
      if (op === 'create' && req.method === 'POST') { const mp = await env.MEDIA.createMultipartUpload(key, { httpMetadata: { contentType: 'video/mp4' } }); return Response.json({ id: mp.uploadId }, { headers: cors }); }
      if (op === 'part' && req.method === 'PUT') { const mp = env.MEDIA.resumeMultipartUpload(key, url.searchParams.get('id')); const n = Number(url.searchParams.get('n')); const part = await mp.uploadPart(n, req.body); return Response.json(part, { headers: cors }); }
      if (op === 'complete' && req.method === 'POST') { const mp = env.MEDIA.resumeMultipartUpload(key, url.searchParams.get('id')); const parts = await req.json(); const obj = await mp.complete(parts); return Response.json({ key: obj.key, size: obj.size, etag: obj.httpEtag }, { headers: cors }); }
      if (op === 'abort' && req.method === 'POST') { const mp = env.MEDIA.resumeMultipartUpload(key, url.searchParams.get('id')); await mp.abort(); return new Response('aborted', { headers: cors }); }
      return new Response('bad op', { status: 400, headers: cors });
    }

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
