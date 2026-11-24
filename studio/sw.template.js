/*
  the Studio's service worker, written by hand so every line can be reasoned about. vite.config.ts fills in the two
  placeholders below at build time and writes this file to dist/sw.js.

  what it does and nothing else:
  - install: puts every built file in one cache named for the build (the page, the scripts, the styles, the fonts, the
    icons and the WebAssembly scoring module). if any file fails to download the install fails and the old version stays.
  - fetch: for a same-origin GET it answers from that cache. a page load is answered with the cached page, which is the
    whole app because it routes on the address hash. a file that is not in the cache goes to the network and is not stored.
  - a request to any other origin, such as the player's own server, is not touched: no respondWith, nothing cached.
  - a new version waits. it takes over only when the page sends SKIP_WAITING after the player chooses to update, so an
    update never arrives in the middle of a piece.
  - activate: removes the caches of older builds.
  practice needs no network once this has installed.
*/
const VERSION = "__VERSION__";
const CACHE = `melophos-studio-${VERSION}`;
const PRECACHE = __PRECACHE__;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE.map((path) => new Request(path, { cache: "reload" })))),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("melophos-studio-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
  if (event.data && event.data.type === "VERSION" && event.source) event.source.postMessage({ type: "VERSION", version: VERSION });
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  const isPage = request.mode === "navigate";
  const key = isPage ? new URL("./", self.registration.scope).pathname : url.pathname;
  event.respondWith(
    caches.open(CACHE).then((cache) =>
      cache.match(key).then((hit) => hit || cache.match(isPage ? "/index.html" : key)).then((hit) => hit || fetch(request)),
    ),
  );
});
