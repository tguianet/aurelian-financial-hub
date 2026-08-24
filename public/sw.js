const CACHE_NAME = "aurelian-pwa-v1";
const STATIC_ASSETS = [
  "/manifest.webmanifest",
  "/icons/aurelian-icon.svg",
  "/icons/aurelian-maskable.svg",
  "/favicon.ico"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (
    url.pathname.startsWith("/api/") ||
    url.pathname.includes("/auth/") ||
    url.pathname.includes("supabase")
  ) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match("/manifest.webmanifest").then(() => new Response(
        "<!doctype html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>Aurelian Finance</title><style>body{margin:0;background:#080806;color:#fff;font-family:system-ui;display:grid;min-height:100vh;place-items:center;padding:24px;text-align:center}div{max-width:420px}h1{color:#eab308}</style></head><body><div><h1>Aurelian Finance</h1><p>Sem conexão no momento. Reconecte-se à internet para acessar seus dados financeiros atualizados.</p></div></body></html>",
        { headers: { "content-type": "text/html; charset=utf-8" } },
      ))),
    );
    return;
  }

  if (STATIC_ASSETS.includes(url.pathname)) {
    event.respondWith(caches.match(request).then((cached) => cached || fetch(request)));
  }
});
