/* Pulso — service worker. It lets the app open and be read with no signal (Adrián's garden has little):
   - the app itself (page, styles, scripts, fonts, icons) is kept on the phone and served from there;
   - every GET to /api goes to the network first and, when there is no answer in a few seconds, gets the last copy kept;
     a copy served that way carries `x-pulso-offline: 1` so the page can say it is showing what it had;
   - photos never change once uploaded (each has its own id), so once seen they are served from the phone.
   Writes (reports, changes, notes, photos) are not handled here: the page keeps them in its outbox (offline.js) and
   sends them when there is signal. Bump V with the ?v= in index.html. */
const V = 'pulso-32';
const SHELL = ['/', '/app.css?v=32', '/core.js?v=32', '/offline.js?v=32', '/app.js?v=32', '/planner.js?v=32', '/more.js?v=32',
  '/fonts/geist-400.woff2', '/fonts/geist-500.woff2', '/fonts/geist-600.woff2', '/fonts/geist-700.woff2',
  '/logo-word.png', '/icon.svg', '/icon-192.png', '/manifest.webmanifest'];
const API = 'pulso-api';      // the last answer to each GET, kept across versions
const PHOTOS = 'pulso-photos';
const WAIT_MS = 6000;         // a weak signal: after this long, show what we have

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(V).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((ks) => Promise.all(ks.filter((k) => k.startsWith('pulso-') && ![V, API, PHOTOS].includes(k)).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

function withTimeout(p, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    p.then((r) => { clearTimeout(t); resolve(r); }, (e) => { clearTimeout(t); reject(e); });
  });
}
async function fromCache(cacheName, req) {
  const hit = await (await caches.open(cacheName)).match(req);
  if (!hit) return null;
  const h = new Headers(hit.headers);
  h.set('x-pulso-offline', '1');
  return new Response(hit.body, { status: hit.status, headers: h });
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // photos: from the phone once seen
  if (url.pathname.startsWith('/api/photos/')) {
    e.respondWith((async () => {
      const c = await caches.open(PHOTOS);
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return res;
    })());
    return;
  }

  // the data: the network first, the last copy when it does not answer
  if (url.pathname.startsWith('/api/')) {
    if (url.pathname === '/api/logout') return;
    e.respondWith((async () => {
      const net = fetch(req);
      try {
        const res = await withTimeout(net, WAIT_MS);
        if (res.ok) { const copy = res.clone(); caches.open(API).then((c) => c.put(req, copy)); }
        return res;
      } catch (err) {
        const old = await fromCache(API, req);
        if (old) {
          // the slow answer may still arrive: keep it for next time
          net.then((res) => { if (res.ok) caches.open(API).then((c) => c.put(req, res)); }).catch(() => {});
          return old;
        }
        return net;   // nothing kept: wait for the network after all (it fails the way it would without us)
      }
    })());
    return;
  }

  // the page: always the same one (the app routes by #); fresh when there is signal
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const res = await withTimeout(fetch(req), WAIT_MS);
        if (res.ok) { const copy = res.clone(); caches.open(V).then((c) => c.put('/', copy)); }
        return res;
      } catch {
        return (await caches.match('/', { cacheName: V })) || Response.error();
      }
    })());
    return;
  }

  // styles, scripts, fonts, icons: from the phone, filled in from the network the first time
  e.respondWith((async () => {
    const hit = await caches.match(req);
    if (hit) return hit;
    const res = await fetch(req);
    if (res.ok && (url.pathname.startsWith('/fonts/') || url.search.includes('v='))) { const copy = res.clone(); caches.open(V).then((c) => c.put(req, copy)); }
    return res;
  })());
});
