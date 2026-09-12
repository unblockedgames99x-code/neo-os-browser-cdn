"use strict";

importScripts("./jet/jet.sw.js");
importScripts("./assets/neo-ad-shield.js?v=20260912-sitewide-v2");

const NEO_ASSET_CACHE = "neo-proxy-assets-v2";
const NEO_ASSET_MAX_AGE = 10 * 60 * 1000;
const NEO_ASSET_MAX_BYTES = 5 * 1024 * 1024;
const NEO_CACHEABLE_DESTINATIONS = new Set(["font", "image", "script", "style"]);

function originalRequestUrl(requestUrl) {
  try {
    const parsed = new URL(requestUrl);
    const marker = "/~/";
    const start = parsed.pathname.indexOf(marker);
    if (start === -1) return "";
    return decodeURIComponent(parsed.pathname.slice(start + marker.length));
  } catch (_error) {
    return "";
  }
}

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(Promise.all([
    self.clients.claim(),
    caches.keys().then((names) => Promise.all(names
      .filter((name) => name.startsWith("neo-proxy-assets-") && name !== NEO_ASSET_CACHE)
      .map((name) => caches.delete(name)))),
  ]));
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "neo:jet:activate") self.skipWaiting();
  if (event.data?.type === "neo:jet:claim") event.waitUntil(self.clients.claim());
});

function shouldCacheAsset(request) {
  return request.method === "GET" &&
    NEO_CACHEABLE_DESTINATIONS.has(request.destination) &&
    !request.headers.has("authorization") &&
    !request.headers.has("range");
}

function cachedAt(response) {
  return Number(response?.headers.get("x-neo-cached-at") || 0);
}

function rememberAsset(cache, request, response, event) {
  if (!response?.ok) return response;
  const cacheControl = response.headers.get("cache-control") || "";
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (/\b(?:no-store|private)\b/i.test(cacheControl) || contentLength > NEO_ASSET_MAX_BYTES) {
    return response;
  }
  const headers = new Headers(response.headers);
  headers.set("x-neo-cached-at", String(Date.now()));
  const cachedResponse = new Response(response.clone().body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
  const save = cache.put(request, cachedResponse).catch(() => {});
  try { event.waitUntil(save); } catch (_error) {}
  return response;
}

async function routeStaticAsset(event) {
  const cache = await caches.open(NEO_ASSET_CACHE);
  const cached = await cache.match(event.request);
  if (cached && Date.now() - cachedAt(cached) < NEO_ASSET_MAX_AGE) return cached;
  try {
    const response = await globalThis.$scramjetController.route(event);
    return rememberAsset(cache, event.request, response, event);
  } catch (error) {
    if (cached) return cached;
    throw error;
  }
}

self.addEventListener("fetch", (event) => {
  if (globalThis.$scramjetController.shouldRoute(event)) {
    const destination = originalRequestUrl(event.request.url);
    if (globalThis.NEOAdShield?.shouldBlockUrl(destination)) {
      event.respondWith(new Response(null, {
        status: 204,
        statusText: "No Content",
        headers: { "X-NEO-Ad-Blocked": "1" },
      }));
      return;
    }
    event.respondWith(
      shouldCacheAsset(event.request)
        ? routeStaticAsset(event)
        : globalThis.$scramjetController.route(event)
    );
  }
});
