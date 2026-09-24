// Self-destructing Service Worker: purge all old PWA caches and unregister
self.addEventListener("install", (e) => {
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(keys.map((k) => caches.delete(k)));
    }).then(() => {
      return self.registration.unregister();
    }).then(() => {
      return self.clients.claim();
    })
  );
});

// Always fetch fresh from network
self.addEventListener("fetch", (e) => {
  e.respondWith(fetch(e.request));
});
