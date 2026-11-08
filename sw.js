// Service Worker «Книга вязания спицами» (v8 — Партия 2А рубрики «Носки и следки»)

const CACHE_NAME = "kniga-vyazaniya-v8";
const PRECACHE_URLS = [
  "./",
  "./index.html",
  "./styles.css?v=8",
  "./app.js?v=8",
  "./data/articles.js?v=8",
  "./data/cat-01-batch1.js?v=8",
  "./data/cat-01-batch2a.js?v=8",
  "./data/cat-01-batch2b.js?v=8",
  "./manifest.webmanifest?v=8",
  "./assets/icon.svg?v=8",
  "./assets/images/welcome-gulsinya.webp?v=8"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    fetch(event.request, { cache: "no-cache" })
      .then((response) => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
