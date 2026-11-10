// App shell cache: Horizonte opens with no network. API calls always go to the network.
const V = 'hz-8';
const SHELL = ['/', '/app.css?v=8', '/app.js?v=8', '/manifest.webmanifest', '/icon-192.png', '/fonts/geist-400.woff2', '/fonts/geist-500.woff2', '/fonts/geist-600.woff2', '/fonts/geist-700.woff2'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.pathname.startsWith('/api/') || u.pathname.startsWith('/auth/')) return;
  const isFont = /fonts\.(googleapis|gstatic)\.com$/.test(u.hostname);
  if (u.origin !== location.origin && !isFont) return;
  // The page itself: network first (so a new version shows up at once), cached copy when offline.
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).then(r => { if (r.ok) caches.open(V).then(c => c.put('/', r.clone())); return r; }).catch(() => caches.match('/')));
    return;
  }
  // Everything else: stale-while-revalidate (versioned file names change on every release).
  e.respondWith(caches.open(V).then(async (c) => {
    const key = u.pathname === '/index.html' ? '/' : e.request;
    const hit = await c.match(key);
    const net = fetch(e.request).then(r => { if (r.ok || r.type === 'opaque') c.put(key, r.clone()); return r; }).catch(() => hit);
    return hit || net;
  }));
});
