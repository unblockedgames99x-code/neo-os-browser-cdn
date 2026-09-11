(function (scope) {
  "use strict";

  if (!scope || scope.NEOAdShield) return;

  var blockedHostSuffixes = [
    "2mdn.net",
    "aax.amazon-adsystem.com",
    "adcolony.com",
    "adform.net",
    "adnxs.com",
    "adroll.com",
    "adsafeprotected.com",
    "adsrvr.org",
    "adsterra.com",
    "advertising.com",
    "amazon-adsystem.com",
    "appnexus.com",
    "bidswitch.net",
    "bidr.io",
    "casalemedia.com",
    "clickadu.com",
    "criteo.com",
    "criteo.net",
    "doubleclick.net",
    "exoclick.com",
    "googleadservices.com",
    "googlesyndication.com",
    "googletagservices.com",
    "hilltopads.net",
    "imasdk.googleapis.com",
    "indexww.com",
    "lijit.com",
    "media.net",
    "mgid.com",
    "moatads.com",
    "monetag.com",
    "openx.net",
    "outbrain.com",
    "popads.net",
    "popcash.net",
    "propellerads.com",
    "pubmatic.com",
    "quantserve.com",
    "revcontent.com",
    "rubiconproject.com",
    "scorecardresearch.com",
    "sharethrough.com",
    "smartadserver.com",
    "sovrn.com",
    "taboola.com",
    "trafficjunky.net",
    "triplelift.com",
    "yieldmo.com",
    "zergnet.com"
  ];

  var blockedHostPattern = /(^|[.-])(?:ad(?:s|server|service|sterra|system|tech|track)?|advertising|affiliate|banner|clicks?|popads?|popunder|sponsor|tracking|tracker)(?:[.-]|$)/i;
  var blockedUrlPattern = /(?:\/pagead(?:\/|\?|$)|\/ads?(?:\/|\?|=|&|\.|_|-)|adsbygoogle|googleads|googletagservices|securepubads|prebid|popunder|vast(?:\.xml|\/)|[?&](?:ad_|ads?|adunit|bannerid|clickid|placement|popunder|slot|zoneid)=)/i;
  var adTokenPattern = /(?:^|[-_\s])(?:ad|ads|advert|advertisement|adslot|adunit|banner-ad|commercial|paid-content|promoted|sponsor|sponsored)(?:$|[-_\s])/i;
  var urlAttributes = ["src", "href", "data", "action", "formaction", "poster"];
  var installedWindows = typeof WeakSet === "function" ? new WeakSet() : null;

  function hostMatches(hostname) {
    var host = String(hostname || "").toLowerCase().replace(/^www\./, "");
    if (!host) return false;
    if (blockedHostPattern.test(host)) return true;
    return blockedHostSuffixes.some(function (suffix) {
      return host === suffix || host.endsWith("." + suffix);
    });
  }

  function shouldBlockUrl(input, base) {
    var value = String(input || "").trim();
    if (!value || /^(?:about:|blob:|data:|javascript:|#)/i.test(value)) return false;
    try {
      var parsed = new URL(value, base || "https://neo.invalid/");
      return hostMatches(parsed.hostname) || blockedUrlPattern.test(parsed.pathname + parsed.search);
    } catch (_error) {
      return blockedUrlPattern.test(value);
    }
  }

  function elementLooksLikeAd(element, base) {
    if (!element || element.nodeType !== 1 || element.hasAttribute("data-neo-allow-ad")) return false;
    for (var index = 0; index < urlAttributes.length; index += 1) {
      var value = element.getAttribute(urlAttributes[index]);
      if (value && shouldBlockUrl(value, base)) return true;
    }
    if (
      element.hasAttribute("data-ad-client") ||
      element.hasAttribute("data-ad-slot") ||
      element.hasAttribute("data-ad-unit") ||
      element.hasAttribute("data-zone")
    ) return true;
    var signature = [element.id || "", element.className || "", element.getAttribute("aria-label") || ""].join(" ");
    if (typeof signature === "string" && adTokenPattern.test(signature)) return true;
    var label = String(element.getAttribute("title") || "").trim();
    return /^(?:ad|advert|advertisement|paid content|promoted|sponsored)$/i.test(label);
  }

  function report(target, detail) {
    try {
      target.dispatchEvent(new target.CustomEvent("neo:adblocked", { detail: detail || {} }));
    } catch (_error) {}
  }

  function install(target) {
    target = target || scope;
    if (!target || !target.document) return false;
    if (installedWindows && installedWindows.has(target)) return true;
    if (target.__neoAdShieldInstalled) return true;
    try { target.__neoAdShieldInstalled = true; } catch (_error) {}
    if (installedWindows) installedWindows.add(target);

    var doc = target.document;
    var base = function () {
      try { return doc.baseURI || target.location.href; } catch (_error) { return "https://neo.invalid/"; }
    };
    var blockedCount = 0;

    function blocked(kind, value) {
      blockedCount += 1;
      report(target, { kind: kind, value: String(value || ""), count: blockedCount });
    }

    function removeElement(element) {
      if (!elementLooksLikeAd(element, base())) return false;
      blocked("element", element.getAttribute("src") || element.getAttribute("href") || element.id || element.className);
      try { element.remove(); } catch (_error) {
        try { element.style.setProperty("display", "none", "important"); } catch (_innerError) {}
      }
      return true;
    }

    function clean(root) {
      if (!root) return 0;
      var removed = 0;
      if (root.nodeType === 1 && removeElement(root)) return 1;
      if (!root.querySelectorAll) return 0;
      root.querySelectorAll("script,iframe,frame,embed,object,ins,a,form,[data-ad-client],[data-ad-slot],[data-ad-unit],[data-zone]").forEach(function (element) {
        if (removeElement(element)) removed += 1;
      });
      return removed;
    }

    var style = doc.createElement("style");
    style.id = "neo-ad-shield-style";
    style.textContent = [
      "ins.adsbygoogle,#carbonads,#google_ads_frame,[data-ad-client],[data-ad-slot],[data-ad-unit],[data-zone],",
      ".ad-banner,.ad-box,.ad-container,.ad-wrapper,.advert,.advertisement,.advertising,.sponsored-content,",
      "[id='ads'],[id^='ad-'],[id^='ads-'],[class~='advertisement'],[class~='sponsored']",
      "{display:none!important;visibility:hidden!important;pointer-events:none!important;min-height:0!important;height:0!important;margin:0!important;padding:0!important;border:0!important}"
    ].join("");
    try { (doc.head || doc.documentElement).appendChild(style); } catch (_error) {}

    var NativeMutationObserver = target.MutationObserver;
    if (NativeMutationObserver && doc.documentElement) {
      try {
        new NativeMutationObserver(function (records) {
          records.forEach(function (record) {
            record.addedNodes.forEach(function (node) { clean(node); });
          });
        }).observe(doc.documentElement, { childList: true, subtree: true });
      } catch (_error) {}
    }

    var nativeFetch = target.fetch;
    if (typeof nativeFetch === "function") {
      target.fetch = function (input, init) {
        var value = typeof input === "string" || input instanceof target.URL ? String(input) : input && input.url;
        if (shouldBlockUrl(value, base())) {
          blocked("fetch", value);
          return Promise.resolve(new target.Response(null, { status: 204, statusText: "No Content", headers: { "X-NEO-Ad-Blocked": "1" } }));
        }
        return nativeFetch.call(this, input, init);
      };
    }

    var xhr = target.XMLHttpRequest && target.XMLHttpRequest.prototype;
    if (xhr && typeof xhr.open === "function") {
      var nativeXhrOpen = xhr.open;
      xhr.open = function (method, url) {
        if (shouldBlockUrl(url, base())) {
          blocked("xhr", url);
          arguments[1] = "data:,";
        }
        return nativeXhrOpen.apply(this, arguments);
      };
    }

    if (target.navigator && typeof target.navigator.sendBeacon === "function") {
      var nativeSendBeacon = target.navigator.sendBeacon.bind(target.navigator);
      try {
        target.navigator.sendBeacon = function (url, data) {
          if (shouldBlockUrl(url, base())) {
            blocked("beacon", url);
            return true;
          }
          return nativeSendBeacon(url, data);
        };
      } catch (_error) {}
    }

    if (typeof target.open === "function") {
      var nativeOpen = target.open.bind(target);
      target.open = function (url) {
        var value = String(url || "about:blank");
        var active = target.navigator && target.navigator.userActivation;
        if (shouldBlockUrl(value, base()) || (active && !active.isActive)) {
          blocked("popup", value);
          return null;
        }
        return nativeOpen.apply(target, arguments);
      };
    }

    doc.addEventListener("click", function (event) {
      var link = event.target && event.target.closest ? event.target.closest("a[href],area[href]") : null;
      if (!link || !shouldBlockUrl(link.getAttribute("href"), base())) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      blocked("navigation", link.getAttribute("href"));
    }, true);

    doc.addEventListener("error", function (event) {
      var element = event.target;
      if (element && element.nodeType === 1 && elementLooksLikeAd(element, base())) removeElement(element);
    }, true);

    function protectFrame(frame) {
      if (!frame || frame.__neoAdShieldBound) return;
      frame.__neoAdShieldBound = true;
      frame.addEventListener("load", function () {
        try { install(frame.contentWindow); } catch (_error) {}
      });
      try { install(frame.contentWindow); } catch (_error) {}
    }

    doc.querySelectorAll("iframe,frame").forEach(protectFrame);
    if (NativeMutationObserver && doc.documentElement) {
      try {
        new NativeMutationObserver(function (records) {
          records.forEach(function (record) {
            record.addedNodes.forEach(function (node) {
              if (!node || node.nodeType !== 1) return;
              if (/^(?:IFRAME|FRAME)$/.test(node.tagName)) protectFrame(node);
              if (node.querySelectorAll) node.querySelectorAll("iframe,frame").forEach(protectFrame);
            });
          });
        }).observe(doc.documentElement, { childList: true, subtree: true });
      } catch (_error) {}
    }

    clean(doc);
    return true;
  }

  scope.NEOAdShield = {
    blockedHosts: blockedHostSuffixes.slice(),
    clean: function (root) {
      try {
        var win = root && root.ownerDocument && root.ownerDocument.defaultView;
        if (win && win.NEOAdShield && win.NEOAdShield !== scope.NEOAdShield) return win.NEOAdShield.clean(root);
      } catch (_error) {}
      return 0;
    },
    hostMatches: hostMatches,
    install: install,
    shouldBlockUrl: shouldBlockUrl
  };

  if (scope.document) install(scope);
})(typeof globalThis !== "undefined" ? globalThis : this);
