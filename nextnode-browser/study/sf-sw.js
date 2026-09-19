// proxy service worker — pure RPC router. delegates fetch+rewrite to the page
// controller; needs no engine/wasm here. scoped to /study/ so it never touches
// the rest of the origin.
importScripts('sf-ctl-sw.js');

function repairMalformedProxyRequestUrl(rawUrl) {
    var current;
    try { current = new URL(rawUrl); } catch (_error) { return ''; }
    var marker = '/study/uv/';
    var markerIndex = current.pathname.indexOf(marker);
    if (markerIndex < 0) return '';
    var routeStart = markerIndex + marker.length;
    var firstSlash = current.pathname.indexOf('/', routeStart);
    var secondSlash = firstSlash < 0 ? -1 : current.pathname.indexOf('/', firstSlash + 1);
    if (secondSlash < 0) return '';

    var payload = current.pathname.slice(secondSlash + 1);
    try { payload = decodeURIComponent(payload); } catch (_error) {}
    var target = payload
        .replace(/^https\\:\/+/i, 'https://')
        .replace(/^http\\:\/+/i, 'http://')
        .replace(/^https\/:\/+/i, 'https://')
        .replace(/^http\/:\/+/i, 'http://')
        .replace(/^https:\/(?!\/)/i, 'https://')
        .replace(/^http:\/(?!\/)/i, 'http://');
    if (!/^https?:\/\//i.test(target) || target === payload) return '';
    target += current.search + current.hash;
    var prefix = current.pathname.slice(0, secondSlash + 1);
    return current.origin + prefix + encodeURIComponent(target);
}

function patchedProxyFetch(e) {
    var routedEvent = e;
    var repairedUrl = repairMalformedProxyRequestUrl(e.request.url);
    if (repairedUrl && /^(?:GET|HEAD)$/i.test(e.request.method)) {
        var repairedRequest = new Request(repairedUrl, {
            method: e.request.method,
            headers: e.request.headers,
            credentials: e.request.credentials,
            cache: e.request.cache,
            redirect: e.request.redirect,
            referrer: e.request.referrer,
            referrerPolicy: e.request.referrerPolicy,
            integrity: e.request.integrity
        });
        routedEvent = {
            request: repairedRequest,
            clientId: e.clientId,
            resultingClientId: e.resultingClientId
        };
    }
    if ($internalController.shouldRoute(routedEvent)) e.respondWith($internalController.route(routedEvent));
}
addEventListener('fetch', patchedProxyFetch);
