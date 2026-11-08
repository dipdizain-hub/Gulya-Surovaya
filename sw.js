// Service Worker «Книга вязания спицами» (v2)
// Мгновенно подгружает свежие обновления при наличии интернета и сохраняет копию для работы офлайн.

const CACHE_NAME = "kniga-vyazaniya-v2";
const PRECACHE_URLS = [
  "./",
  "./index.html",
  "./styles.css?v=2",
  "./app.js?v=2",
  "./data/articles.js?v=2",
  "./manifest.webmanifest?v=2",
  "./assets/icon.svg",
  "./assets/images/noski-s-rastitelnym-uzorom/01.jpg",
  "./assets/images/noski-s-rastitelnym-uzorom/02.jpg",
  "./assets/images/noski-s-rastitelnym-uzorom/03.jpg",
  "./assets/images/shapka-dvukhtsvetnaya-briosh/01.jpg",
  "./assets/images/shapka-dvukhtsvetnaya-briosh/05.jpg",
  "./assets/images/shapka-dvukhtsvetnaya-briosh/06.jpg",
  "./assets/images/shal-tsvetochnoe-eho/cover-variants.jpg",
  "./assets/images/shal-tsvetochnoe-eho/chart-legend.jpg",
  "./assets/images/shal-tsvetochnoe-eho/chart-setup.jpg",
  "./assets/images/shal-tsvetochnoe-eho/chart-flower.jpg",
  "./assets/images/shal-tsvetochnoe-eho/chart-border-1-2.jpg",
  "./assets/images/shal-tsvetochnoe-eho/chart-border-3.jpg",
  "./assets/images/shal-tsvetochnoe-eho/chart-edge.jpg"
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
