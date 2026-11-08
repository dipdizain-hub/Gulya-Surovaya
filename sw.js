// Service Worker «Книга вязания спицами» (v7 — Партия 1 рубрики «Носки и следки», PDF и полноэкранное горизонтальное видео)

const CACHE_NAME = "kniga-vyazaniya-v7";
const PRECACHE_URLS = [
  "./",
  "./index.html",
  "./styles.css?v=7",
  "./app.js?v=7",
  "./data/articles.js?v=7",
  "./data/cat-01-batch1.js?v=7",
  "./manifest.webmanifest?v=7",
  "./assets/icon.svg?v=7",
  "./assets/images/welcome-gulsinya.webp?v=7"
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
