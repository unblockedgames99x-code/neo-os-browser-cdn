(() => {
  "use strict";

  const pageBase = new URL("./", document.baseURI);
  const serviceWorkerUrl = new URL("sw.js?v=20260828-controller-handoff-v3", pageBase);
  const serviceWorkerScope = pageBase.pathname;
  const proxyBase = new URL("~/", pageBase).pathname;
  const canRegisterServiceWorker = pageBase.origin === location.origin;
  const relayCacheKey = "neo:jet:last-relay:lively-v1";
  const controllerReloadKey = "neo:jet:controller-reload:v3";
  const relayHosts = [
    "wss://support.pired.org/lively/",
    "wss://girlspreples.org/wi/",
    "cdn.northstreetumc.org",
    "cdn.vipersfootball.com",
    "cdn.pcesc.org",
    "cdn.kcchallengevbc.com",
    "cdn.slcbmooc.org",
  ];

  let initializePromise = null;
  let serviceWorkerPromise = null;
  let controller = null;
  let proxyFrame = null;
  let attachedFrame = null;
  let active = false;
  let lastVisibleUrl = "";
  let selectedRelay = "";
  let bareMuxConnection = null;

  function supports(value) {
    if (!canRegisterServiceWorker) return false;
    try {
      const url = new URL(value);
      return (url.protocol === "https:" || url.protocol === "http:") &&
        url.origin !== location.origin;
    } catch {
      return false;
    }
  }

  function isProxyUrl(value) {
    // While Jet owns the frame, transient about:blank/original-looking URLs must
    // not be handed back to NEO's legacy renderer.
    if (active) return true;
    try {
      const url = new URL(value, location.href);
      return url.origin === location.origin && url.pathname.startsWith(proxyBase);
    } catch {
      return false;
    }
  }

  function normalizeRelay(value) {
    const relay = String(value || "").trim();
    if (!relay) return "";
    if (/^wss?:\/\//i.test(relay)) return relay.endsWith("/") ? relay : `${relay}/`;
    return `wss://${relay}/adblock/`;
  }

  function cachedRelay() {
    try {
      return normalizeRelay(localStorage.getItem(relayCacheKey));
    } catch {
      return "";
    }
  }

  function relayCandidates() {
    return [...new Set(relayHosts.map(normalizeRelay).filter(Boolean))];
  }

  // Complete a tiny WISP protocol exchange. A plain WebSocket "open" event is
  // not enough: overloaded relays often accept a socket but never carry data.
  function probeRelay(url, timeoutMs = 3600) {
    return new Promise((resolve) => {
      let socket;
      let finished = false;
      let openedStream = false;
      let requestStartedAt = 0;
      const streamId = crypto.getRandomValues(new Uint32Array(1))[0] || 1;

      const finish = (latency = null) => {
        if (finished) return;
        finished = true;
        window.clearTimeout(timer);
        try { socket?.close(); } catch {}
        resolve(latency === null ? null : { url, latency });
      };

      const timer = window.setTimeout(() => finish(), timeoutMs);
      try {
        socket = new WebSocket(url);
        socket.binaryType = "arraybuffer";
      } catch {
        finish();
        return;
      }

      socket.onmessage = async (event) => {
        let data = event.data;
        try {
          if (data instanceof Blob) data = await data.arrayBuffer();
          if (!(data instanceof ArrayBuffer) || data.byteLength < 5) return;
          const view = new DataView(data);
          const packetType = view.getUint8(0);
          const packetStream = view.getUint32(1, true);

          if (!openedStream) {
            if (packetType === 5 && packetStream === 0) {
              socket.send(new Uint8Array([5, 0, 0, 0, 0, 2, 1]));
              return;
            }
            if (packetType !== 3 || packetStream !== 0) return;

            openedStream = true;
            const host = new TextEncoder().encode("127.0.0.1");
            const packet = new ArrayBuffer(8 + host.length);
            const request = new DataView(packet);
            request.setUint8(0, 1);
            request.setUint32(1, streamId, true);
            request.setUint8(5, 1);
            request.setUint16(6, 1, true);
            new Uint8Array(packet).set(host, 8);
            requestStartedAt = performance.now();
            socket.send(packet);
            return;
          }

          if (packetStream === streamId) {
            finish(Math.max(1, Math.round(performance.now() - requestStartedAt)));
          }
        } catch {
          finish();
        }
      };
      socket.onerror = () => finish();
      socket.onclose = () => finish();
    });
  }

  function firstResponsiveRelay(candidates, timeoutMs) {
    return new Promise((resolve) => {
      if (!candidates.length) {
        resolve(null);
        return;
      }
      let settled = false;
      let remaining = candidates.length;
      candidates.forEach((relay) => {
        probeRelay(relay, timeoutMs).then((result) => {
          if (settled) return;
          if (result) {
            settled = true;
            resolve(result);
            return;
          }
          remaining -= 1;
          if (!remaining) resolve(null);
        });
      });
    });
  }

  function waitForWorkerState(worker, expectedState) {
    if (!worker || worker.state === expectedState) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error("The compatibility service timed out.")), 8000);
      const onStateChange = () => {
        if (worker.state !== expectedState && worker.state !== "redundant") return;
        window.clearTimeout(timer);
        worker.removeEventListener("statechange", onStateChange);
        worker.state === expectedState ? resolve() : reject(new Error("The compatibility service was replaced."));
      };
      worker.addEventListener("statechange", onStateChange);
    });
  }

  function isExpectedController(worker) {
    return Boolean(worker && worker.scriptURL === serviceWorkerUrl.href);
  }

  function waitForExpectedController(timeout = 3000) {
    const current = navigator.serviceWorker.controller;
    if (isExpectedController(current)) return Promise.resolve(current);

    return new Promise((resolve) => {
      const finish = (worker = null) => {
        window.clearTimeout(timer);
        navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
        resolve(worker);
      };
      const onControllerChange = () => {
        const next = navigator.serviceWorker.controller;
        if (isExpectedController(next)) finish(next);
      };
      const timer = window.setTimeout(() => finish(null), timeout);
      navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    });
  }

  async function registerServiceWorker() {
    if (!canRegisterServiceWorker) {
      throw new Error("This host uses the Chromebook compatibility transport.");
    }
    if (!("serviceWorker" in navigator)) throw new Error("This browser does not support service workers.");
    if (location.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(location.hostname)) {
      throw new Error("Secure browsing compatibility requires HTTPS.");
    }

    const registration = await navigator.serviceWorker.register(serviceWorkerUrl.href, {
      scope: serviceWorkerScope,
    });
    await registration.update();
    if (registration.installing) await waitForWorkerState(registration.installing, "activated");
    if (registration.waiting) {
      registration.waiting.postMessage({ type: "neo:jet:activate" });
      await waitForWorkerState(registration.waiting, "activated");
    }
    await navigator.serviceWorker.ready;

    const activeWorker = registration.active;
    if (activeWorker) activeWorker.postMessage({ type: "neo:jet:claim" });
    const current = await waitForExpectedController();
    if (current) {
      sessionStorage.removeItem(controllerReloadKey);
      return current;
    }

    // Chrome can activate a worker one navigation before it controls this
    // iframe. Reload once, then fail clearly instead of sending a proxy URL to
    // the static host and displaying its 404 response.
    if (sessionStorage.getItem(controllerReloadKey) !== serviceWorkerUrl.href) {
      sessionStorage.setItem(controllerReloadKey, serviceWorkerUrl.href);
      location.reload();
      return new Promise(() => {});
    }

    sessionStorage.removeItem(controllerReloadKey);
    throw new Error("The secure browsing service could not control this page.");
  }

  function ensureServiceWorker() {
    if (!serviceWorkerPromise) serviceWorkerPromise = registerServiceWorker();
    return serviceWorkerPromise;
  }

  async function initializeTransport(instance) {
    for (let attempt = 0; attempt < 28; attempt += 1) {
      try {
        await instance.init();
        return;
      } catch (error) {
        if (!String(error).includes("wasm not loaded")) throw error;
        await new Promise((resolve) => window.setTimeout(resolve, 95));
      }
    }
    throw new Error("The network transport did not initialize in time.");
  }

  function headersObject(headers) {
    if (!headers) return {};
    if (headers instanceof Headers) return Object.fromEntries(headers.entries());
    if (Array.isArray(headers)) return Object.fromEntries(headers);
    return headers;
  }

  function rawHeaderEntries(headers, fallback) {
    if (Array.isArray(headers)) return headers;
    if (headers && typeof headers[Symbol.iterator] === "function") return [...headers];
    if (headers && typeof headers === "object") {
      return Object.entries(headers).flatMap(([name, values]) => (
        Array.isArray(values) ? values.map((value) => [name, String(value)]) : [[name, String(values)]]
      ));
    }
    return [...fallback.entries()];
  }

  function createWorkerTransport(client) {
    return {
      ready: true,
      async init() {},
      async request(remote, method, body, headers, signal) {
        const response = await client.fetch(remote.href, {
          method,
          headers: headersObject(headers),
          body,
          redirect: "manual",
          signal,
          ...(typeof ReadableStream === "function" && body instanceof ReadableStream ? { duplex: "half" } : {}),
        });
        return {
          body: response.body,
          headers: rawHeaderEntries(response.rawHeaders, response.headers),
          status: response.status,
          statusText: response.statusText,
        };
      },
      connect(url, protocols, requestHeaders, onopen, onmessage, onclose, onerror) {
        const socket = client.createWebSocket(url, protocols, undefined, headersObject(requestHeaders));
        socket.binaryType = "arraybuffer";
        socket.onopen = () => onopen("", "");
        socket.onmessage = (event) => onmessage(event.data);
        socket.onclose = (event) => onclose(event.code, event.reason);
        socket.onerror = () => onerror("");
        return [
          (data) => socket.send(data),
          (code, reason) => socket.close(code, reason),
        ];
      },
    };
  }

  async function createOffMainThreadTransport(relay) {
    if (typeof SharedWorker !== "function" || !globalThis.BareMux?.BareMuxConnection || !globalThis.BareMux?.BareClient) {
      return null;
    }
    const workerUrl = new URL("scramjet/baremux-worker.js", pageBase).href;
    const transportUrl = new URL("scramjet/libcurl.mjs", pageBase).href;
    if (!bareMuxConnection) bareMuxConnection = new globalThis.BareMux.BareMuxConnection(workerUrl);
    await bareMuxConnection.setTransport(transportUrl, [{ wisp: relay }]);
    return createWorkerTransport(new globalThis.BareMux.BareClient(workerUrl));
  }

  async function selectTransport() {
    const preferred = normalizeRelay(relayHosts[0]);
    const cached = cachedRelay();
    let selected = await probeRelay(preferred, 1800);
    if (!selected && cached && cached !== preferred) selected = await probeRelay(cached, 1400);
    if (!selected) {
      const candidates = relayCandidates().filter((relay) => relay !== preferred && relay !== cached);
      selected = await firstResponsiveRelay(candidates, 3800);
    }
    if (!selected) throw new Error("No compatible relay is currently reachable.");

    let transport = null;
    try {
      transport = await createOffMainThreadTransport(selected.url);
    } catch (error) {
      console.warn("[NEO] Worker transport unavailable; using the compatibility fallback.", error);
    }
    if (!transport) {
      const transportModule = await import(new URL("curl/index.mjs", pageBase).href);
      transport = new transportModule.default({ wisp: selected.url });
      await initializeTransport(transport);
    }
    selectedRelay = selected.url;
    try { localStorage.setItem(relayCacheKey, selected.url); } catch {}
    return transport;
  }

  async function initialize() {
    if (initializePromise) return initializePromise;
    initializePromise = (async () => {
      if (!globalThis.$scramjetController?.Controller) throw new Error("The Jet runtime did not load.");
      await ensureServiceWorker();

      const transport = await selectTransport();

      controller = new globalThis.$scramjetController.Controller({
        serviceworker: navigator.serviceWorker.controller,
        transport,
        config: {
          scramjetPath: new URL("jet/jet.core.js", pageBase).href,
          wasmPath: new URL("jet/jet.wasm", pageBase).href,
          injectPath: new URL("jet/jet.inject.js", pageBase).href,
          virtualWasmPath: "jet.wasm.js",
          codec: {
            encode: (value) => value ? encodeURIComponent(value) : value,
            decode: (value) => value ? decodeURIComponent(value) : value,
          },
          prefix: proxyBase,
        },
        scramjetConfig: {
          maskedfiles: ["jet.inject.js", "jet.wasm.js"],
        },
      });
      await controller.wait();
      window.dispatchEvent(new CustomEvent("neo:scramjet:transportready", {
        detail: { relay: selectedRelay },
      }));
      return controller;
    })().catch((error) => {
      initializePromise = null;
      throw error;
    });
    return initializePromise;
  }

  function originalUrl() {
    if (!proxyFrame || !attachedFrame) return "";
    try {
      const current = new URL(attachedFrame.contentWindow?.location?.href || attachedFrame.src);
      if (!current.pathname.startsWith(proxyFrame.prefix)) return "";
      return decodeURIComponent(current.pathname.slice(proxyFrame.prefix.length));
    } catch {
      return "";
    }
  }

  function emitUrl(url) {
    if (!url || url === lastVisibleUrl) return;
    lastVisibleUrl = url;
    window.dispatchEvent(new CustomEvent("neo:scramjet:urlchange", { detail: { url } }));
  }

  function attachFrame(frameElement) {
    if (proxyFrame && attachedFrame === frameElement) return proxyFrame;
    proxyFrame = controller.createFrame(frameElement);
    attachedFrame = frameElement;
    frameElement.addEventListener("load", () => {
      if (!active || !isProxyUrl(frameElement.src)) return;
      emitUrl(originalUrl());
      let title = "";
      try { title = frameElement.contentDocument?.title || ""; } catch {}
      window.dispatchEvent(new CustomEvent("neo:scramjet:ready", { detail: { title } }));
    });
    return proxyFrame;
  }

  async function go(url, frameElement) {
    const requestedUrl = String(url);
    try {
      const destination = new URL(requestedUrl);
      if (/^(?:www\.|m\.)?youtube\.com$/i.test(destination.hostname)) {
        destination.hostname = "m.youtube.com";
        destination.searchParams.set("app", "m");
        destination.searchParams.set("persist_app", "1");
        url = destination.href;
      }
    } catch {}
    await initialize();
    const frame = attachFrame(frameElement);
    active = true;
    lastVisibleUrl = requestedUrl;
    frameElement.dataset.neoScramjet = "true";
    frameElement.removeAttribute("srcdoc");
    frameElement.style.opacity = "1";
    frame.go(url);
  }

  function deactivate() {
    active = false;
    if (attachedFrame) delete attachedFrame.dataset.neoScramjet;
  }

  window.setInterval(() => {
    if (active) emitUrl(originalUrl());
  }, 500);

  globalThis.NeoScramjet = Object.freeze({
    supports,
    isProxyUrl,
    go,
    deactivate,
    configuredRelay: () => selectedRelay || cachedRelay() || relayCandidates()[0] || "",
    allowRelay: (value) => relayCandidates().includes(normalizeRelay(value)),
    get active() { return active; },
  });

  // initialize() is intentionally started by go(). Prewarming here used to
  // download and compile the full proxy runtime even on an untouched new tab,
  // which could block low-powered Chromebooks for several hundred milliseconds.
})();
