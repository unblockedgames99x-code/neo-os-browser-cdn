(() => {
  "use strict";

  const pageBase = new URL("./", document.baseURI);
  const serviceWorkerUrl = new URL("sw.js?v=20260828-controller-handoff-v3", pageBase);
  const serviceWorkerScope = pageBase.pathname;
  const proxyBase = new URL("~/", pageBase).pathname;
  const bareMuxWorkerUrl = new URL(
    "scramjet/baremux-worker.js?v=20260910-chromebook-stack-v1",
    pageBase,
  ).href;
  const bareMuxTransportUrl = new URL(
    "scramjet/libcurl.mjs?v=20260910-chromebook-stack-v1",
    pageBase,
  ).href;
  if (location.href === "about:srcdoc") {
    const NativeURL = globalThis.URL;
    globalThis.URL = class URL extends NativeURL {
      constructor(input, base) {
        super(input, /^about:srcdoc(?:[?#]|$)/i.test(String(base || "")) ? pageBase.href : base);
      }
    };
  }
  const initialServiceWorker = navigator.serviceWorker?.controller || null;
  const canRegisterServiceWorker = pageBase.origin === location.origin || Boolean(
    initialServiceWorker && new URL(initialServiceWorker.scriptURL).origin === pageBase.origin
  );
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

  function withTimeout(promise, milliseconds, message) {
    let timer = 0;
    return Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = window.setTimeout(() => reject(new Error(message)), milliseconds);
      }),
    ]).finally(() => window.clearTimeout(timer));
  }

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

    const inheritedController = navigator.serviceWorker.controller;
    if (isExpectedController(inheritedController)) return inheritedController;
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

  // Managed Chromebooks handle a shared networking worker more reliably than
  // a tab-owned worker. BareMux also lets the service worker reuse the exact
  // same Libcurl/WISP connection instead of rebuilding it for every request.
  async function createBareMuxTransport(relay) {
    if (
      typeof SharedWorker !== "function" ||
      !globalThis.BareMux?.BareMuxConnection ||
      !globalThis.BareMux?.BareClient
    ) return null;

    const connection = bareMuxConnection || new globalThis.BareMux.BareMuxConnection(bareMuxWorkerUrl);
    bareMuxConnection = connection;
    const activeTransport = await withTimeout(
      connection.getTransport(),
      4000,
      "The shared network service did not respond.",
    ).catch(() => "");
    if (activeTransport !== bareMuxTransportUrl) {
      await withTimeout(
        connection.setTransport(bareMuxTransportUrl, [{ wisp: relay }]),
        12000,
        "The shared network service took too long to start.",
      );
    }
    const selectedTransport = await withTimeout(
      connection.getTransport(),
      4000,
      "The shared network service could not be verified.",
    );
    if (selectedTransport !== bareMuxTransportUrl) {
      throw new Error("The shared network service did not stay connected.");
    }
    return createWorkerTransport(new globalThis.BareMux.BareClient(bareMuxWorkerUrl));
  }

  async function createOffMainThreadTransport(relay) {
    if (typeof Worker !== "function") return null;
    const workerUrl = new URL("scramjet/transport-worker.js", pageBase).href;
    const transportUrl = new URL("scramjet/libcurl.mjs", pageBase).href;
    const worker = new Worker(workerUrl, { type: "module", name: "neo-network" });
    const pending = new Map();
    const sockets = new Map();
    let nextId = 0;

    const call = (type, detail = {}, transfer = []) => new Promise((resolve, reject) => {
      const id = ++nextId;
      const timer = window.setTimeout(() => {
        pending.delete(id);
        reject(new Error("The background network worker timed out."));
      }, 15000);
      pending.set(id, {
        resolve(value) { window.clearTimeout(timer); resolve(value); },
        reject(error) { window.clearTimeout(timer); reject(error); },
      });
      worker.postMessage({ id, type, transportUrl, relay, ...detail }, transfer);
    });
    worker.addEventListener("message", (event) => {
      const message = event.data || {};
      if (message.event && message.socketId) {
        const socket = sockets.get(message.socketId);
        if (!socket) return;
        if (message.event === "socket-open") socket.onopen(message.protocol || "", "");
        if (message.event === "socket-message") socket.onmessage(message.data);
        if (message.event === "socket-close") {
          sockets.delete(message.socketId);
          socket.onclose(message.code, message.reason || "");
        }
        if (message.event === "socket-error") socket.onerror(message.error || "");
        return;
      }
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      if (message.ok) request.resolve(message.value);
      else request.reject(new Error(message.error || "The network worker failed."));
    });
    worker.addEventListener("error", (event) => {
      const error = new Error(event.message || "The network worker stopped.");
      pending.forEach((request) => request.reject(error));
      pending.clear();
    });
    await call("init");

    return {
      ready: true,
      async init() {},
      async request(url, method, body, headers) {
        let payload = null;
        if (body instanceof ReadableStream) payload = await new Response(body).arrayBuffer();
        else if (body instanceof ArrayBuffer) payload = body;
        else if (ArrayBuffer.isView(body)) payload = body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength);
        else if (body != null) payload = new TextEncoder().encode(String(body)).buffer;
        const value = await call("fetch", {
          url: String(url),
          method,
          body: payload,
          headers: headersObject(headers),
        }, payload ? [payload] : []);
        return {
          ...value,
          headers: rawHeaderEntries(value.headers, new Headers()),
        };
      },
      connect(url, protocols, requestHeaders, onopen, onmessage, onclose, onerror) {
        const socketId = `socket-${++nextId}`;
        sockets.set(socketId, { onopen, onmessage, onclose, onerror });
        call("connect", {
          socketId,
          url: String(url),
          protocols: protocols || [],
          headers: headersObject(requestHeaders),
        }).catch((error) => onerror(error.message));
        return [
          (data) => worker.postMessage({ type: "socket-send", socketId, data }),
          (code, reason) => worker.postMessage({ type: "socket-close", socketId, code, reason }),
        ];
      },
    };
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
      transport = await createBareMuxTransport(selected.url);
    } catch (error) {
      globalThis.__neoSharedTransportError = String(error?.stack || error?.message || error);
      console.warn("[NEO] Shared transport unavailable; using the compatibility fallback.", error);
    }
    if (!transport) {
      try {
        transport = await createOffMainThreadTransport(selected.url);
      } catch (error) {
        globalThis.__neoWorkerTransportError = String(error?.stack || error?.message || error);
        console.warn("[NEO] Compatibility transport unavailable.", error);
      }
    }
    if (!transport) throw new Error("The background network service is unavailable.");
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
      try { globalThis.NEOAdShield?.install(frameElement.contentWindow); } catch {}
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
