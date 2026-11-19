// Service worker: la app funciona sin conexion. Sube VERSION al cambiar archivos para forzar la actualizacion.
const VERSION = 'gastos-v5';
const FILES = ['./', 'index.html', 'styles.css', 'app.js', 'core.js', 'ui.js', 'photos.js', 'shared.js', 'shared-ui.js', 'manifest.webmanifest', 'icon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;   // CDN (Excel) siempre por red
  // Red primero (siempre la version mas nueva si hay conexion); sin conexion, desde cache.
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request)));
});
