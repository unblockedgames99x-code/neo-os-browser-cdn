(function () {
  "use strict";

  if (window.NEO_PROXY_CLIENT) return;

  var nativeFetch = window.fetch.bind(window);
  var pending = new Map();
  var sequence = 0;

  function normalize(value) {
    var url = new URL(String(value || ""), document.baseURI);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new TypeError("Only web URLs can use the proxy.");
    url.username = "";
    url.password = "";
    return url.href;
  }

  function resolve(value, kind, signal) {
    var href = normalize(value);
    if (window.parent === window) return Promise.resolve(href);
    return new Promise(function (resolvePromise, rejectPromise) {
      if (signal && signal.aborted) {
        rejectPromise(new DOMException("The request was aborted.", "AbortError"));
        return;
      }
      var id = "neo-proxy-resource-" + Date.now().toString(36) + "-" + (++sequence).toString(36);
      var abort = function () {
        var request = pending.get(id);
        if (!request) return;
        pending.delete(id);
        clearTimeout(request.timer);
        rejectPromise(new DOMException("The request was aborted.", "AbortError"));
      };
      var timer = setTimeout(function () {
        pending.delete(id);
        if (signal) signal.removeEventListener("abort", abort);
        rejectPromise(new Error("The NEO web proxy did not answer."));
      }, 15000);
      pending.set(id, {
        resolve: resolvePromise,
        reject: rejectPromise,
        timer: timer,
        signal: signal,
        abort: abort
      });
      if (signal) signal.addEventListener("abort", abort, { once: true });
      window.parent.postMessage({
        type: "neo-shell:proxy-resource",
        id: id,
        href: href,
        kind: String(kind || "fetch").slice(0, 24)
      }, "*");
    });
  }

  function proxiedFetch(value, options) {
    var requestOptions = Object.assign({ credentials: "omit", cache: "no-store" }, options || {});
    return resolve(value, "fetch", requestOptions.signal).then(function (route) {
      return nativeFetch(route, requestOptions);
    });
  }

  window.addEventListener("message", function (event) {
    if (event.source !== window.parent) return;
    var data = event.data;
    if (!data || data.type !== "neo-shell:proxy-resource-result" || !pending.has(data.id)) return;
    var request = pending.get(data.id);
    pending.delete(data.id);
    clearTimeout(request.timer);
    if (request.signal) request.signal.removeEventListener("abort", request.abort);
    if (!data.ok || !data.route) {
      request.reject(new Error("The NEO web proxy could not route this resource."));
      return;
    }
    try { request.resolve(normalize(data.route)); }
    catch (error) { request.reject(error); }
  });

  window.addEventListener("pagehide", function () {
    pending.forEach(function (request) {
      clearTimeout(request.timer);
      if (request.signal) request.signal.removeEventListener("abort", request.abort);
      request.reject(new Error("The app closed before the proxy answered."));
    });
    pending.clear();
  }, { once: true });

  window.NEO_PROXY_CLIENT = Object.freeze({
    resolve: resolve,
    fetch: proxiedFetch,
    media: function (value) { return resolve(value, "media"); },
    image: function (value) { return resolve(value, "image"); }
  });
})();
