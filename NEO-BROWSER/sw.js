"use strict";

importScripts("./jet/jet.sw.js");

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
    event.respondWith(globalThis.$scramjetController.route(event));
  }
});
