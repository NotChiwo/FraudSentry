// FraudSentry — offline support for the website (GitHub Pages).
// Keeps a copy of the app so it still opens with no internet after the
// first visit, e.g. when added to an iPhone's Home Screen. Receipts and
// messages never pass through here: the app sends nothing anywhere.
// Pages: newest version when online (the browser's HTTP cache makes an
// unchanged page cheap), the saved copy when offline.
const CACHE = 'fraudsentry-app-v1';
const FILES = ['./', './manifest.webmanifest', './icons/apple-touch-icon.png', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req)
      .then(res => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put('./', copy)); } return res; })
      .catch(() => caches.match('./')));
    return;
  }
  e.respondWith(caches.match(req).then(hit => hit || fetch(req)));
});
