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
    var nestedMalformedScheme = target.match(/^https?:\/\/.*?\/(https?)(?:\\|\/)?\:\/+(.+)$/i);
    if (nestedMalformedScheme) target = nestedMalformedScheme[1] + '://' + nestedMalformedScheme[2];
    if (!/^https?:\/\//i.test(target) || target === payload) return '';
    var targetQuery = [];
    var proxyQuery = [];
    current.search.replace(/^\?/, '').split('&').filter(Boolean).forEach(function(part) {
        var name = part.split('=', 1)[0];
        try { name = decodeURIComponent(name); } catch (_error) {}
        (name.indexOf('$') === 0 ? proxyQuery : targetQuery).push(part);
    });
    if (targetQuery.length) target += '?' + targetQuery.join('&');
    target += current.hash;
    var prefix = current.pathname.slice(0, secondSlash + 1);
    return current.origin + prefix + encodeURIComponent(target) + (proxyQuery.length ? '?' + proxyQuery.join('&') : '');
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
