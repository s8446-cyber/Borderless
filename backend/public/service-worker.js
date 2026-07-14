// Borderless Pay PWA service worker.
//   API      → network-only (never cached)
//   Shell    → stale-while-revalidate: serve cached instantly, refresh the
//              cache from the network in the background, so users get UI
//              updates on their NEXT load without a cache-name bump.
// Bump CACHE on breaking shell changes to force a clean slate.
const CACHE = "borderless-pay-v4";
const SHELL = [
  "/",
  "/index.html",
  "/styles.css",
  "/app.js",
  "/verify.html",
  "/verify.js",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const { request } = e;
  const url = new URL(request.url);
  // Never cache API calls — always go to network.
  if (url.pathname.startsWith("/api/")) {
    e.respondWith(fetch(request).catch(() => new Response(JSON.stringify({ error: "offline" }), { status: 503, headers: { "content-type": "application/json" } })));
    return;
  }
  // App shell: stale-while-revalidate.
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(request);
      const network = fetch(request)
        .then((res) => {
          if (res && res.ok) cache.put(request, res.clone()).catch(() => {});
          return res;
        })
        .catch(() => null);
      // Serve cached immediately (background refresh already in flight);
      // fall back to network, then to the shell for navigation requests.
      return cached || (await network) || cache.match("/index.html");
    })
  );
});
