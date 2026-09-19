(function () {
  "use strict";
  // Keep the Browser document and its service worker on the same host as NEO OS.
  // Named Browser servers use their published YukiOS WISP endpoints.
  // Edit this relative path or absolute asset origin; routes and resolve() both use it.
  var configuredAssetBase = "./";
  var base = new URL(configuredAssetBase, document.currentScript.src);
  var previewBase = new URL("http://127.0.0.1:3092/neo-os/");
  var upstreamBrowserRoot = new URL("https://nextnode9124.b-cdn.net/");
  window.NEO_LOCAL_CONFIG = Object.freeze({
    enabled: true,
    externalIntegrations: false,
    onlineApps: Object.freeze(["chat", "games", "movies"]),
    assetBase: base.href,
    music: new URL("music-v2/index.html?v=20260912-repeat-controls-v2&theme=system-v1&widgets=live-v1", base).href,
    browser: new URL("nextnode-browser/index.html?v=20260914-official-wisp-v2", base).href,
    browserWarmAssets: Object.freeze([
      "study/sf-engine.js",
      "study/sf-ctl.js",
      "study/sf-utils.js",
      "study/libcurl.js",
      "study/sf-engine.wasm"
    ].map(function (asset) { return new URL("nextnode-browser/" + asset, base).href; })),
    browserWisp: "wss://probuildingsupplies.com/w/",
    browserWispServers: Object.freeze([
      Object.freeze({ name: "Probuilding Wisp", url: "wss://probuildingsupplies.com/w/" }),
      Object.freeze({ name: "Mercury Wisp", url: "wss://wisp.mercurywork.shop/" }),
      Object.freeze({ name: "Reeyuki Wisp", url: "wss://hurt-agata-liventcord-api-7072e9a6.koyeb.app/" }),
      Object.freeze({ name: "Reeyuki Wisp 2", url: "wss://reeyukiwisp.onrender.com/" })
    ]),
    appProxy: new URL("NEO-BROWSER/index.html?v=20260913-yukios-wisp-v1", base).href,
    gameDocumentRelay: "https://neo-stratus-api-w6nw.onrender.com/games/v1/document",
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
