// Dos Búhos card — pages network-first with cache fallback; assets cache-first, refreshed in background
const VERSION = 'v202611101526';
const PRECACHE = ["/", "/index.html", "/press/", "/press/index.html", "/icons/logo.png", "/photos/harvest.jpg", "/icons/mono-dark.png", "/icons/mono-light.png", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/apple-touch-icon.png", "/fonts/cormorant-garamond-latin-400-italic.woff2", "/fonts/lato-latin-400-normal.woff2", "/fonts/lato-latin-300-normal.woff2", "/fonts/cormorant-garamond-latin-600-normal.woff2", "/fonts/cormorant-garamond-latin-500-normal.woff2", "/fonts/cormorant-garamond-latin-400-normal.woff2", "/manifest-dosbuhos.webmanifest", "/manifest-eric.webmanifest", "/manifest-diane.webmanifest", "/manifest-higinio.webmanifest", "/manifest-melanie.webmanifest", "/manifest-michael.webmanifest", "/vcf/dosbuhos.vcf", "/vcf/eric.vcf", "/vcf/diane.vcf", "/vcf/higinio.vcf", "/vcf/melanie.vcf", "/vcf/michael.vcf", "/photos/ab-garden-chapel.jpg", "/photos/seated-tasting.jpg", "/photos/ab-bar-bottles-chapel.jpg", "/photos/ab-chapel-fountain.jpg", "/photos/ab-barrel-chalk.jpg", "/photos/ab-cellar-founders.jpg", "/photos/ab-barrel-racks.jpg", "/photos/ab-wine-shop.jpg", "/photos/ab-barrel-monogram.jpg", "/photos/ab-barrel-dark.jpg", "/photos/ab-wood-sign.jpg", "/photos/petanque.jpg", "/photos/winegarden-night.jpg", "/photos/bodega-arte.jpg", "/photos/wedding-toast.jpg", "/photos/hacienda.jpg", "/photos/lunch-table.jpg", "/photos/glasses.jpg", "/photos/pouring.jpg", "/photos/vineyard-talk.jpg", "/photos/harvest.jpg", "/photos/recorrido.jpg", "/photos/harvest-bin.jpg", "/photos/planting.jpg", "/photos/family-road.jpg", "/photos/cellar.jpg", "/photos/grandfather.jpg"];
self.addEventListener('install', e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.origin !== location.origin) return; // fonts etc.: network, browser cache
  if (url.pathname === '/version.json') return; // always live
  if (url.pathname.startsWith('/press/library') || url.pathname.startsWith('/press/files/') || url.pathname.endsWith('.zip')) return; // downloads: straight from the network
  const isNav = e.request.mode === 'navigate';
  const P = url.pathname.replace(/\/+$/, '') || '/';
  const isPress = P === '/press' || P === '/press/index.html';
  const isCard = P === '/' || P === '/index.html' || /^\/[a-z-]+$/.test(P) && !isPress;
  if (isNav && !isPress && !isCard) return; // any other page (e.g. /press/library): straight from the network
  const key = isNav ? (isPress ? '/press/index.html' : '/index.html') : e.request;
  e.respondWith(caches.open(VERSION).then(async c => {
    const cached = await c.match(key);
    const net = fetch(e.request).then(r => { if (r && r.ok) c.put(key, r.clone()); return r; }).catch(() => null);
    if (isNav) {   // pages: network first (fresh after a deploy), cache if offline or slow
      const fresh = await Promise.race([net, new Promise(res => setTimeout(() => res(null), 2500))]);
      return fresh || cached || (await net) || Response.error();
    }
    return cached || (await net) || Response.error();
  }));
});
