// Offline support for the full-screen app. Network first, so a new release is
// seen as soon as there is a connection; the cache answers when there isn't.
// Registered from index.html with a relative path, so its scope is the app's
// own folder (/apps/<slug>/app/ on collegica.org) and nothing above it.
// scripts/build.mjs replaces VERSION with the release tag.

const SLUG = 'owl-income';
const CACHE = `collegica-${SLUG}-VERSION`;

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys
        .filter(k => k.startsWith(`collegica-${SLUG}-`) && k !== CACHE)
        .map(k => caches.delete(k))))
      .then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(request)
      .then(response => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request)));
});
