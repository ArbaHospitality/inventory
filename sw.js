// Keeps the app's own files on the phone so it opens instantly.
// Counts always go to the server; nothing about the inventory is stored here.
const VERSION = 'inv-v10';
const FILES = ['./', 'index.html', 'style.css', 'app.js', 'i18n.js', 'config.js', 'xlsx.full.min.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
  'logos/arba.png', 'logos/zoutra.png', 'logos/adraba.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // API calls go straight to the network
  // Open instantly from the phone's copy, and fetch the latest version in the background for next time.
  e.respondWith(caches.open(VERSION).then(async c => {
    const hit = await c.match(e.request, { ignoreSearch: true });
    const net = fetch(e.request).then(res => { if (res.ok) c.put(e.request, res.clone()); return res; }).catch(() => null);
    if (hit) { e.waitUntil(net); return hit; }
    return (await net) || c.match('index.html');
  }));
});
