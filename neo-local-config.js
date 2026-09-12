(function () {
  "use strict";
  // Local-first entry points. A later CDN migration changes configuredAssetBase / these routes,
  // then deliberately updates the preview server CSP allowlist. No URL substitution
  // or proxy is hidden inside the UI.
  // Edit this relative path or absolute asset origin; routes and resolve() both use it.
  var configuredAssetBase = "./";
  var base = new URL(configuredAssetBase, document.currentScript.src);
  var previewBase = new URL("http://127.0.0.1:3092/neo-os/");
  window.NEO_LOCAL_CONFIG = Object.freeze({
    enabled: true,
    externalIntegrations: false,
    onlineApps: Object.freeze(["chat", "neo-cloud", "nowgg", "neo-ai", "discord", "youtube-app", "games", "movies", "geometry-dash"]),
    assetBase: base.href,
    music: new URL("music-v2/index.html?v=20260912-proxy-music-v3&theme=system-v1&widgets=live-v1", base).href,
    browser: new URL("NEO-BROWSER/index.html?v=20260910-fast-browser-v2", base).href,
    gamesCatalog: new URL("../games/index.json", base).href,
    gamesCovers: new URL("../games/covers.json", base).href,
    preview: previewBase.href,
    previewMusic: new URL("music-v2/", previewBase).href,
    previewBrowser: new URL("NEO-BROWSER/", previewBase).href,
    support: new URL("local-browser/support.html", base).href,
    unavailable: new URL("local-browser/unavailable.html", base).href,
    playableGames: Object.freeze(["grandmaster-chess", "quantum-clicker", "tetris"]),
    resolve: function (path) { return new URL(path, base).href; }
  });
  document.documentElement.dataset.localPreview = "true";
  // Old proxy workers must not intercept local routes when revisiting this origin.
  if ("serviceWorker" in navigator) navigator.serviceWorker.getRegistrations().then(function (items) {
    return Promise.all(items.filter(function (item) {
      var workerUrl = (item.active || item.waiting || item.installing || {}).scriptURL || "";
      try {
        var path = new URL(workerUrl).pathname;
        return /\/(?:neo-os\/)?(?:browser-sw|service-worker)\.js$/.test(path);
      } catch (error) {
        return false;
      }
    }).map(function (item) { return item.unregister(); }));
  }).catch(function () {});
})();
