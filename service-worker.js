// ==========================================================
// HCMIS — Service Worker
// Basic offline support: caches the app shell so pages you've
// already opened still load without a connection. This does NOT
// sync offline data entry — Supabase writes still require a
// live connection.
// ==========================================================

const CACHE_NAME = 'hcmis-shell-v1';
const SHELL_FILES = [
  'index.html',
  'dashboard.html',
  'css/style.css',
  'js/config.js',
  'js/auth.js',
  'manifest.json',
  'icon-192.png',
  'icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Never cache Supabase API calls — those must always be live.
  if (event.request.url.includes('supabase.co')) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
