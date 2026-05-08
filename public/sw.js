self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);

  if (url.origin !== self.location.origin) return;
  if (url.hostname.includes("supabase.co")) return;
  if (url.pathname.startsWith("/_next/")) return;
  if (url.pathname === "/manifest.webmanifest") return;
  if (url.pathname.startsWith("/api/")) return;
  if (url.pathname.startsWith("/auth/")) return;
  if (/^\/quotations\/[^/]+\/download-pdf$/.test(url.pathname)) return;
  if (/^\/quotations\/[^/]+\/download-specification$/.test(url.pathname)) return;

  event.respondWith(fetch(event.request));
});
