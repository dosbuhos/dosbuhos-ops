// App shell cache: Horizonte opens with no network. API calls always go to the network.
const V = 'hz-43';
const SHELL = ['/', '/app.css?v=40', '/app.js?v=40', '/manifest.webmanifest', '/icon-192.png', '/icon.svg', '/fonts/geist-400.woff2', '/fonts/geist-500.woff2', '/fonts/geist-600.woff2', '/fonts/geist-700.woff2', '/fonts/fraunces-wordmark.woff2'];
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

// ── push reminders ───────────────────────────────────────────
self.addEventListener('push', (e) => {
  let m = {}; try { m = e.data.json(); } catch { m = { title: 'Horizonte', body: e.data?.text() || '' }; }
  e.waitUntil(self.registration.showNotification(m.title || 'Horizonte', {
    body: m.body || '', tag: m.tag || 'hz', renotify: !!m.tag, icon: '/icon-192.png', badge: '/icon-192.png', data: { url: m.url || '/', id: m.id || null },
    actions: m.actions || [], timestamp: Date.now(),
  }));
});
self.addEventListener('notificationclick', (e) => {
  const d = e.notification.data || {}; e.notification.close();
  if (e.action === 'done' && d.id) { // mark it done without opening the app; the app picks the change up on its next sync
    e.waitUntil(fetch('/api/push/done', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: d.id }) }).catch(() => {}));
    return;
  }
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => { const c = cs.find(x => 'focus' in x); if (c) { c.navigate?.(d.url || '/'); return c.focus(); } return self.clients.openWindow(d.url || '/'); }));
});
