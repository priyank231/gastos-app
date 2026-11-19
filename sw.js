// Service worker: la app funciona sin conexión. Sube VERSION al cambiar archivos para forzar la actualización.
const VERSION = 'gastos-v6';
const CDN_CACHE = 'gastos-cdn-1';          // lector de tickets (WASM): se guarda para usarlo sin conexión
const FILES = ['./', 'index.html', 'styles.css', 'app.js', 'core.js', 'ui.js', 'photos.js', 'shared.js', 'shared-ui.js',
  'ocr.js', 'ticket.js', 'manifest.webmanifest', 'icon.svg', 'icon-180.png', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION && k !== CDN_CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin === location.origin) {
    // Red primero revalidando contra el servidor (siempre la versión más nueva); sin conexión, desde caché.
    e.respondWith(fetch(e.request, { cache: 'no-cache' }).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request)));
  } else if (url.hostname === 'cdn.jsdelivr.net') {
    // Versiones fijadas e inmutables: caché primero.
    e.respondWith(caches.open(CDN_CACHE).then(async (c) => {
      const hit = await c.match(e.request);
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok) c.put(e.request, res.clone());
      return res;
    }));
  }
});
