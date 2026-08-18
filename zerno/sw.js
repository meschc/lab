/* ЗЕРНО — офлайн-кеш. Разметка берётся из сети (чтобы обновления доезжали),
   остальное — из кеша. */
const V = 'zerno-v1';
const ASSETS = ['./', './index.html', './manifest.webmanifest',
  './img/demo.jpg', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-180.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(V).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if(req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  if(req.mode === 'navigate'){
    e.respondWith(fetch(req).catch(() => caches.match('./index.html')));
    return;
  }
  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
    const copy = res.clone();
    caches.open(V).then(c => c.put(req, copy));
    return res;
  })));
});
