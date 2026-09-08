(() => {
  "use strict";

  const setMuted = (muted) => {
    document.querySelectorAll("audio, video").forEach((media) => {
      media.muted = muted;
    });
    const frame = document.getElementById("frame");
    if (!frame || !frame.contentWindow) return;
    try {
      frame.contentWindow.postMessage({ type: "neo-shell:set-muted", muted }, "*");
    } catch {}
  };

  const relayMediaState = (event) => {
    const frame = document.getElementById("frame");
    if (!frame || event.source !== frame.contentWindow) return;
    const data = event.data;
    if (!data || data.type !== "neo:mediaState") return;
    try {
      window.parent.postMessage({
        type: "neo-shell:media-state",
        active: Boolean(data.playing),
        playing: Boolean(data.playing),
        muted: Boolean(data.muted)
      }, window.location.origin);
    } catch {}
  };

  let videoRouteActive = null;
  const isVideoRoute = (value) => {
    try {
      const host = new URL(String(value || "")).hostname.toLowerCase();
      return host === "youtube.com"
        || host.endsWith(".youtube.com")
        || host === "youtu.be"
        || host.endsWith(".youtu.be");
    } catch {
      return false;
    }
  };
  const relayVideoRoute = (value) => {
    const active = isVideoRoute(value);
    if (active === videoRouteActive) return;
    videoRouteActive = active;
    try {
      window.parent.postMessage({
        type: "neo-shell:video-route",
        active
      }, window.location.origin);
    } catch {}
  };

  window.addEventListener("neo:scramjet:urlchange", (event) => {
    relayVideoRoute(event.detail && event.detail.url);
  });
  document.addEventListener("input", (event) => {
    if (event.target && event.target.id === "url") relayVideoRoute(event.target.value);
  });

  window.addEventListener("message", (event) => {
    if (event.source !== window.parent || event.origin !== window.location.origin) return;
    if (!event.data || event.data.type !== "neo-shell:set-muted") return;
    setMuted(Boolean(event.data.muted));
  });

  window.addEventListener("message", relayMediaState);

  const syncInitialRoute = () => {
    const address = document.getElementById("url");
    if (address) relayVideoRoute(address.value);
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", syncInitialRoute, { once: true });
  } else {
    syncInitialRoute();
  }

  const params = new URLSearchParams(window.location.search);
  if (params.get("neo-app-mode") !== "1") return;

  let target;
  try {
    target = new URL(params.get("neo-app-target") || "");
  } catch {
    return;
  }
  if (!/^https?:$/.test(target.protocol)) return;

  const navigate = () => {
    const address = document.getElementById("url");
    const go = document.getElementById("go");
    if (!address || !go) return false;
    address.value = target.href;
    address.dispatchEvent(new Event("input", { bubbles: true }));
    go.click();
    return true;
  };

  const start = () => {
    if (navigate()) return;
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      if (navigate() || attempts >= 40) window.clearInterval(timer);
    }, 50);
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
