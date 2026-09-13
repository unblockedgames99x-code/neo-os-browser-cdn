(function () {
  "use strict";
  // Local-first entry points. The main Browser intentionally uses NextNode's complete
  // hosted proxy build; installed app shortcuts keep the bundled NEO wrapper below.
  // Edit this relative path or absolute asset origin; routes and resolve() both use it.
  var configuredAssetBase = "./";
  var base = new URL(configuredAssetBase, document.currentScript.src);
  var previewBase = new URL("http://127.0.0.1:3092/neo-os/");
  window.NEO_LOCAL_CONFIG = Object.freeze({
    enabled: true,
    externalIntegrations: false,
    onlineApps: Object.freeze(["chat", "neo-cloud", "nowgg", "neo-ai", "discord", "youtube-app", "games", "movies", "geometry-dash"]),
    assetBase: base.href,
    music: new URL("music-v2/index.html?v=20260912-repeat-controls-v2&theme=system-v1&widgets=live-v1", base).href,
    browser: new URL("nextnode-browser/index.html?v=20260913-nextnode-live-v3", base).href,
    browserWarmAssets: Object.freeze([
      "study/sf-engine.js",
      "study/sf-ctl.js",
      "study/sf-utils.js",
      "study/libcurl.js",
      "study/sf-engine.wasm"
    ].map(function (asset) { return new URL("nextnode-browser/" + asset, base).href; })),
    browserWisp: "wss://nextnode9124.b-cdn.net/w/",
    appProxy: new URL("NEO-BROWSER/index.html?v=20260910-fast-browser-v2", base).href,
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
})();
