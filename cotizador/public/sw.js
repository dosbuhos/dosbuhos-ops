const VERSION = 'cz-v1';
const PRECACHE = ['/', '/index.html', '/manifest.webmanifest', '/icons/logo-light.png', '/icons/logo-dark.png', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png',
  '/fonts/cormorant-garamond-latin-400-normal.woff2', '/fonts/cormorant-garamond-latin-500-normal.woff2', '/fonts/cormorant-garamond-latin-600-normal.woff2', '/fonts/cormorant-garamond-latin-400-italic.woff2', '/fonts/lato-latin-300-normal.woff2', '/fonts/lato-latin-400-normal.woff2'];
self.addEventListener('install', e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname === '/me' || url.pathname === '/login') return;
  const isNav = e.request.mode === 'navigate'; const key = isNav ? '/index.html' : e.request;
  e.respondWith(caches.open(VERSION).then(async c => {
    const net = fetch(e.request).then(r => { if (r && r.ok && !r.redirected) c.put(key, r.clone()); return r; }).catch(() => null);
    const cached = await c.match(key);
    return (await net) || cached || Response.error();   // network first (fresh prices), cache when offline
  }));
});
