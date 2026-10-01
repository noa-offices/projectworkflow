const SHELL = "projectworkflow-shell-v2";
const STATIC = "projectworkflow-static-v1";
const ASSETS = ["/offline.html", "/offline.js", "/offline.css"];
const STATIC_LIMIT = 80;
self.addEventListener("install", event => {
  event.waitUntil(caches.open(SHELL).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith("projectworkflow-shell-") && key !== SHELL ||
          key.startsWith("projectworkflow-static-") && key !== STATIC) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});
self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  // Never store mutations, auth, API, private HTML, or RSC responses.
  if (request.method !== "GET" || url.origin !== self.location.origin ||
      url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/") ||
      request.headers.has("RSC") || url.searchParams.has("_rsc")) return;
  if (ASSETS.includes(url.pathname)) {
    event.respondWith(caches.open(SHELL).then(async cache => (await cache.match(url.pathname)) ?? fetch(request)));
    return;
  }
  if (request.mode === "navigate") {
    if (self.navigator?.onLine === false) {
      event.respondWith(caches.match("/offline.html").then(saved => saved ?? new Response("You're offline. Reconnect and visit once to save the recovery shell.", { status: 503 })));
      return;
    }
    event.respondWith(fetch(request).then(async response => {
      if (response.status < 500) return response;
      return (await caches.match("/offline.html")) ?? response;
    }).catch(async () => (await caches.match("/offline.html")) ?? new Response("You're offline. Reconnect and visit once to save the recovery shell.", { status: 503 })));
    return;
  }
  // Immutable build assets only; no uploads/gallery assets or development hot chunks.
  if (url.pathname.startsWith("/_next/static/") && /[a-f0-9]{12,}\.(js|css)$/.test(url.pathname) && !url.search) {
    event.respondWith((async () => {
      const cache = await caches.open(STATIC);
      const saved = await cache.match(request);
      if (saved) return saved;
      const response = await fetch(request);
      if (response.ok && response.type === "basic") {
        await cache.put(request, response.clone());
        const keys = await cache.keys();
        await Promise.all(keys.slice(0, Math.max(0, keys.length - STATIC_LIMIT)).map(key => cache.delete(key)));
      }
      return response;
    })());
  }
});
