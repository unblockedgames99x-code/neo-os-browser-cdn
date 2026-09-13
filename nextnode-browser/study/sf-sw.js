// proxy service worker — pure RPC router. delegates fetch+rewrite to the page
// controller; needs no engine/wasm here. scoped to /study/ so it never touches
// the rest of the origin.
importScripts('sf-ctl-sw.js');
addEventListener('fetch', (e) => {
    if ($internalController.shouldRoute(e)) e.respondWith($internalController.route(e));
});
