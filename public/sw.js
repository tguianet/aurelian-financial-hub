var CACHE_NAME = "aurelian-pwa-v2";
var STATIC_ASSETS = [
  "/manifest.webmanifest",
  "/icons/aurelian-icon.svg",
  "/icons/aurelian-maskable.svg",
  "/favicon.ico"
];

self.addEventListener("install", function (event) {
  event.waitUntil(caches.open(CACHE_NAME).then(function (cache) {
    return cache.addAll(STATIC_ASSETS);
  }));
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  var cleanup = caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (key) {
      return key !== CACHE_NAME;
    }).map(function (key) {
      return caches.delete(key);
    }));
  });

  var preload = Promise.resolve();
  if (self.registration && self.registration.navigationPreload && self.registration.navigationPreload.enable) {
    preload = self.registration.navigationPreload.enable().catch(function () { return undefined; });
  }

  event.waitUntil(Promise.all([cleanup, preload]));
  self.clients.claim();
});

self.addEventListener("fetch", function (event) {
  var request = event.request;
  if (request.method !== "GET") return;

  var url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (
    url.pathname.indexOf("/api/") === 0 ||
    url.pathname === "/auth" ||
    url.pathname.indexOf("/auth/") === 0 ||
    url.pathname.indexOf("supabase") !== -1
  ) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      Promise.resolve(event.preloadResponse)
        .then(function (preloadResponse) {
          if (preloadResponse) return preloadResponse;
          return fetch(request);
        })
        .catch(function () {
          return new Response(
            "<!doctype html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>Aurelian Finance</title><style>body{margin:0;background:#080806;color:#fff;font-family:system-ui;display:grid;min-height:100vh;place-items:center;padding:24px;text-align:center}div{max-width:420px}h1{color:#eab308}</style></head><body><div><h1>Aurelian Finance</h1><p>Sem conexão no momento. Reconecte-se à internet para acessar seus dados financeiros atualizados.</p></div></body></html>",
            { headers: { "content-type": "text/html; charset=utf-8" } }
          );
        })
    );
    return;
  }

  if (STATIC_ASSETS.indexOf(url.pathname) !== -1) {
    event.respondWith(caches.match(request).then(function (cached) {
      return cached || fetch(request);
    }));
  }
});
