(function () {
  "use strict";

  var CHECK_INTERVAL = 45000;
  var CHECK_TIMEOUT = 4500;
  var RELAY_URL = "wss://support.pired.org/lively/";
  var listeners = [];
  var running = null;
  var sequence = 0;
  var timer = 0;
  var state = Object.freeze({
    status: "checking",
    label: "Checking connection",
    summary: "Testing NEO OS services…",
    ready: 0,
    total: 5,
    latency: 0,
    checkedAt: 0,
    services: []
  });

  function notify() {
    var snapshot = getState();
    listeners.slice().forEach(function (listener) {
      try { listener(snapshot); } catch (_error) {}
    });
    window.dispatchEvent(new CustomEvent("neo-connection-change", { detail: snapshot }));
  }

  function getState() {
    return Object.assign({}, state, {
      services: state.services.map(function (service) { return Object.assign({}, service); })
    });
  }

  function checkUrl(name, path, base) {
    var controller = new AbortController();
    var timeout = window.setTimeout(function () { controller.abort(); }, CHECK_TIMEOUT);
    var url = new URL(path, base);
    url.searchParams.set("neo_health", String(Date.now()));
    var options = {
      method: "HEAD",
      cache: "no-store",
      signal: controller.signal
    };
    if (url.origin !== window.location.origin) options.mode = "no-cors";
    var startedAt = performance.now();
    return fetch(url.href, options).then(function (response) {
      var reachable = response.ok || response.type === "opaque";
      return { name: name, ready: reachable, latency: Math.max(1, Math.round(performance.now() - startedAt)) };
    }).catch(function () {
      return { name: name, ready: false, latency: 0 };
    }).then(function (result) {
      window.clearTimeout(timeout);
      return result;
    });
  }

  function checkRelay() {
    if (navigator.onLine === false || typeof WebSocket !== "function") {
      return Promise.resolve({ name: "Web access", ready: false, latency: 0 });
    }
    return new Promise(function (resolve) {
      var socket;
      var settled = false;
      var startedAt = performance.now();
      var timeout = window.setTimeout(function () { finish(false); }, CHECK_TIMEOUT);
      function finish(ready) {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        if (socket && socket.readyState < 2) {
          try { socket.close(1000, "Health check complete"); } catch (_error) {}
        }
        resolve({ name: "Web access", ready: ready, latency: ready ? Math.max(1, Math.round(performance.now() - startedAt)) : 0 });
      }
      try {
        socket = new WebSocket(RELAY_URL);
        socket.addEventListener("open", function () { finish(true); }, { once: true });
        socket.addEventListener("error", function () { finish(false); }, { once: true });
        socket.addEventListener("close", function () { finish(false); }, { once: true });
      } catch (_error) {
        finish(false);
      }
    });
  }

  function resultState(services, elapsed) {
    var ready = services.filter(function (service) { return service.ready; }).length;
    var siteServices = services.filter(function (service) { return service.name !== "Web access"; });
    var siteReady = siteServices.filter(function (service) { return service.ready; }).length;
    var relayReady = services.some(function (service) { return service.name === "Web access" && service.ready; });
    var failed = services.filter(function (service) { return !service.ready; }).map(function (service) { return service.name; });
    var next = {
      status: "limited",
      label: "Connection limited",
      summary: failed.length ? "Unavailable: " + failed.join(", ") + "." : "Some services did not respond.",
      ready: ready,
      total: services.length,
      latency: elapsed,
      checkedAt: Date.now(),
      services: services
    };
    if (siteReady === siteServices.length && relayReady) {
      next.status = "connected";
      next.label = "All systems connected";
      next.summary = "Desktop, Browser, Music, wallpapers, and web access are responding.";
    } else if (siteReady === siteServices.length) {
      next.status = "local";
      next.label = "Local services ready";
      next.summary = "All NEO apps are ready; live web access did not respond.";
    } else if (window.location.protocol === "file:" && siteReady <= 1) {
      next.status = "local";
      next.label = "Local mode";
      next.summary = "Desktop is open. Start the NEO server for full Browser and Music access.";
    } else if (!ready) {
      next.status = "offline";
      next.label = "Connection unavailable";
      next.summary = "NEO services did not respond. Check the network and try again.";
    }
    return Object.freeze(next);
  }

  function refresh(force) {
    if (running && !force) return running;
    var run = ++sequence;
    state = Object.freeze(Object.assign({}, state, {
      status: "checking",
      label: "Checking connection",
      summary: "Testing Desktop, Browser, Music, wallpapers, and web access…"
    }));
    notify();
    var startedAt = performance.now();
    var base = window.location.protocol === "file:" && window.NEO_LOCAL_CONFIG && window.NEO_LOCAL_CONFIG.preview
      ? window.NEO_LOCAL_CONFIG.preview
      : new URL("./", window.location.href).href;
    running = Promise.all([
      checkUrl("Desktop", "index.html", base),
      checkUrl("Browser", "NEO-BROWSER/index.html", base),
      checkUrl("Music", "music-v2/index.html", base),
      checkUrl("Wallpapers", "wallpaper-full-media.json", base),
      checkRelay()
    ]).then(function (services) {
      if (run !== sequence) return getState();
      state = resultState(services, Math.max(1, Math.round(performance.now() - startedAt)));
      notify();
      return getState();
    }).finally(function () {
      if (run === sequence) running = null;
    });
    return running;
  }

  function subscribe(listener) {
    if (typeof listener !== "function") return function () {};
    listeners.push(listener);
    listener(getState());
    return function () { listeners = listeners.filter(function (item) { return item !== listener; }); };
  }

  function start() {
    refresh();
    window.clearInterval(timer);
    timer = window.setInterval(function () {
      if (!document.hidden) refresh();
    }, CHECK_INTERVAL);
  }

  window.addEventListener("online", function () { refresh(true); });
  window.addEventListener("offline", function () { refresh(true); });
  window.addEventListener("pageshow", function () { refresh(); });
  document.addEventListener("visibilitychange", function () { if (!document.hidden) refresh(); });

  window.NEO_CONNECTION_MONITOR = {
    start: start,
    refresh: function () { return refresh(true); },
    subscribe: subscribe,
    getState: getState
  };
  start();
})();
