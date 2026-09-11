"use strict";

importScripts("./jet/jet.sw.js");
importScripts("./assets/neo-ad-shield.js?v=20260910-sitewide-v1");

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
  event.waitUntil(self.clients.claim());
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "neo:jet:activate") self.skipWaiting();
  if (event.data?.type === "neo:jet:claim") event.waitUntil(self.clients.claim());
});

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
    event.respondWith(globalThis.$scramjetController.route(event));
  }
});
