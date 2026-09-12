(function () {
  "use strict";

  var api = null;
  var preview = null;
  var minimizedTray = null;
  var showTimer = 0;
  var hideTimer = 0;
  var activeId = "";
  var anchor = null;
  var staticPreviewCache = new Map();
  var minimizedCardCache = new Map();

  function previewsEnabled() {
    // The taskbar preview is a core window-management affordance, so it stays
    // available in every performance mode.
    return true;
  }

  function previewSnapshotsEnabled() {
    // Live DOM snapshots are intentionally disabled. A future raster-only
    // capture can opt in here without bringing subtree cloning back.
    return false;
  }

  function clearTimers() {
    window.clearTimeout(showTimer);
    window.clearTimeout(hideTimer);
    showTimer = 0;
    hideTimer = 0;
  }

  function appName(app) {
    if (!app) return "Application";
    return String(app.accessibleName || app.title || "Application");
  }

  function visibleTitle(app) {
    return app ? String(app.title || app.accessibleName || "Application") : "Application";
  }

  function cloneIcon(button) {
    var icon = button && button.querySelector(".dock-app-art");
    if (!icon) return document.createElement("span");

    // Dock artwork is tiny and owned by the shell. Recreate only that markup;
    // never copy a live application/window subtree into a preview.
    var copy = icon.cloneNode(false);
    copy.innerHTML = icon.innerHTML;
    copy.removeAttribute("id");
    copy.removeAttribute("data-app");
    copy.querySelectorAll("[id], [data-app]").forEach(function (node) {
      node.removeAttribute("id");
      node.removeAttribute("data-app");
    });
    return copy;
  }

  function fullscreenActive() {
    var root = document.documentElement;
    return Boolean(
      document.fullscreenElement ||
      document.webkitFullscreenElement ||
      root.hasAttribute("data-tab-fullscreen") ||
      root.dataset.fullscreen === "true"
    );
  }

  function dockButton(id) {
    if (!api || !api.dock) return null;
    return Array.from(api.dock.querySelectorAll(".dock-button[data-app]")).find(function (button) {
      return button.dataset.app === id;
    }) || null;
  }

  function previewCacheKey(slot, id, stateText) {
    return String(slot || "preview") + "\u0000" + String(id || "application") + "\u0000" + String(stateText || "Running");
  }

  function forgetCachedPreviews(id, slot) {
    var idMarker = "\u0000" + String(id || "application") + "\u0000";
    var slotMarker = slot ? String(slot) + "\u0000" : "";
    staticPreviewCache.forEach(function (node, key) {
      if (key.indexOf(idMarker) === -1 || (slotMarker && key.indexOf(slotMarker) !== 0)) return;
      if (node && node.isConnected) node.remove();
      staticPreviewCache.delete(key);
    });
  }

  function staticPreview(button, app, stateText, id, slot) {
    var key = previewCacheKey(slot, id, stateText);
    var cached = staticPreviewCache.get(key);
    if (cached) return cached;

    var fallback = document.createElement("div");
    fallback.className = "neo-taskbar-preview-fallback";
    fallback.dataset.previewType = "static";
    fallback.setAttribute("aria-hidden", "true");
    var icon = cloneIcon(button);
    icon.classList.add("neo-taskbar-preview-fallback-icon");
    fallback.appendChild(icon);
    var copy = document.createElement("span");
    var strong = document.createElement("strong");
    strong.textContent = visibleTitle(app);
    var small = document.createElement("small");
    small.textContent = stateText;
    copy.append(strong, small);
    fallback.appendChild(copy);
    staticPreviewCache.set(key, fallback);
    return fallback;
  }

  function renderWindow(win, button, app) {
    var viewport = preview.querySelector("[data-taskbar-preview-viewport]");
    viewport.textContent = "";
    var minimized = win.classList.contains("is-minimized");
    var stateText = minimized ? "Minimized" : "Running";
    preview.querySelector("[data-taskbar-preview-status]").textContent = stateText;
    preview.querySelector("[data-taskbar-preview-title]").textContent = visibleTitle(app);
    preview.querySelector("[data-taskbar-preview-open]").setAttribute("aria-label", (minimized ? "Restore " : "Switch to ") + appName(app));
    preview.querySelector("[data-taskbar-preview-close]").setAttribute("aria-label", "Close " + appName(app));

    // A static identity card is deliberate. Cloning a window forces the browser
    // to duplicate and style every app node (including hidden media/iframes),
    // which caused hover and drag jank even when those nodes were scrubbed later.
    viewport.appendChild(staticPreview(button, app, stateText, win.dataset.appId, "hover"));
  }

  function renderMinimizedViewport(viewport, win, button, app, id) {
    var content = staticPreview(button, app, "Minimized", id || win.dataset.appId, "minimized");
    if (viewport.childNodes.length === 1 && viewport.firstChild === content) return;
    viewport.replaceChildren(content);
  }

  function setWindowMuted(win, muted) {
    if (!win) return;
    muted = Boolean(muted);
    if (win._neoLocalMusicCommand) win._neoLocalMusicCommand("mute", muted);
    win.dataset.neoMuted = muted ? "true" : "false";
    win.querySelectorAll("audio, video").forEach(function (media) { media.muted = muted; });
    var appId = String(win.dataset.appId || "");
    if (appId === "stream") {
      if (window.NEO_MUSIC_RUNTIME && typeof window.NEO_MUSIC_RUNTIME.setWindowMuted === "function") {
        window.NEO_MUSIC_RUNTIME.setWindowMuted(win, muted);
      }
      if (window.NEO_FEATURES && typeof window.NEO_FEATURES.setMuted === "function") {
        window.NEO_FEATURES.setMuted(muted);
      }
    }
    win.querySelectorAll("iframe").forEach(function (frame) {
      try {
        frame.contentWindow.postMessage({ type: "neo-shell:set-muted", muted: muted }, "*");
      } catch (error) {}
    });
  }

  function createMinimizedCard(id, win) {
    var app = api.apps[id];
    var button = dockButton(id);
    var card = document.createElement("article");
    card.className = "neo-minimized-card";
    card.dataset.minimizedApp = id;

    var header = document.createElement("header");
    header.className = "neo-minimized-card-header";
    var identity = document.createElement("button");
    identity.type = "button";
    identity.className = "neo-minimized-card-identity";
    identity.setAttribute("aria-label", "Restore " + appName(app));
    var icon = cloneIcon(button);
    icon.classList.add("neo-minimized-card-icon");
    var title = document.createElement("strong");
    title.textContent = appName(app);
    identity.append(icon, title);

    var controls = document.createElement("span");
    controls.className = "neo-minimized-card-controls";
    var mute = document.createElement("button");
    mute.type = "button";
    mute.className = "neo-minimized-card-mute";
    mute.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#i-volume"></use></svg>';
    var muted = win.dataset.neoMuted === "true";
    mute.classList.toggle("is-muted", muted);
    mute.setAttribute("aria-pressed", muted ? "true" : "false");
    mute.setAttribute("aria-label", (muted ? "Unmute " : "Mute ") + appName(app));

    var close = document.createElement("button");
    close.type = "button";
    close.className = "neo-minimized-card-close";
    close.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#i-close"></use></svg>';
    close.setAttribute("aria-label", "Close " + appName(app));
    controls.append(mute, close);
    header.append(identity, controls);

    var open = document.createElement("button");
    open.type = "button";
    open.className = "neo-minimized-card-open";
    open.setAttribute("aria-label", "Restore " + appName(app));
    var viewport = document.createElement("span");
    viewport.className = "neo-minimized-card-viewport";
    open.appendChild(viewport);
    card.append(header, open);
    renderMinimizedViewport(viewport, win, button, app, id);

    function restore() { api.open(id); }
    identity.addEventListener("click", restore);
    open.addEventListener("click", restore);
    mute.addEventListener("click", function () {
      var currentWindow = api.windows.get(id);
      if (!currentWindow) return;
      var nextMuted = currentWindow.dataset.neoMuted !== "true";
      setWindowMuted(currentWindow, nextMuted);
      mute.classList.toggle("is-muted", nextMuted);
      mute.setAttribute("aria-pressed", nextMuted ? "true" : "false");
      mute.setAttribute("aria-label", (nextMuted ? "Unmute " : "Mute ") + appName(app));
    });
    close.addEventListener("click", function () {
      var currentWindow = api.windows.get(id);
      if (currentWindow) api.close(currentWindow);
    });
    return card;
  }

  function syncMinimizedCard(card, id, win) {
    var app = api.apps[id];
    var button = dockButton(id);
    var muted = win.dataset.neoMuted === "true";
    var mute = card.querySelector(".neo-minimized-card-mute");
    var title = card.querySelector(".neo-minimized-card-identity strong");
    var viewport = card.querySelector(".neo-minimized-card-viewport");
    if (title) title.textContent = appName(app);
    if (mute) {
      mute.classList.toggle("is-muted", muted);
      mute.setAttribute("aria-pressed", muted ? "true" : "false");
      mute.setAttribute("aria-label", (muted ? "Unmute " : "Mute ") + appName(app));
    }
    if (viewport) renderMinimizedViewport(viewport, win, button, app, id);
  }

  function refreshMinimizedTray() {
    if (!minimizedTray || !api) return;
    if (fullscreenActive()) {
      minimizedTray.hidden = true;
      return;
    }
    var minimized = [];
    api.windows.forEach(function (win, id) {
      if (win && win.classList.contains("is-minimized")) minimized.push({ id: id, win: win });
    });
    minimized.sort(function (left, right) {
      return Number(right.win.style.zIndex || 0) - Number(left.win.style.zIndex || 0);
    });
    var visibleIds = new Set(minimized.map(function (entry) { return String(entry.id); }));
    minimizedCardCache.forEach(function (card, id) {
      if (visibleIds.has(id)) return;
      card.remove();
      minimizedCardCache.delete(id);
      forgetCachedPreviews(id, "minimized");
    });
    minimized.forEach(function (entry, index) {
      var id = String(entry.id);
      var card = minimizedCardCache.get(id);
      if (!card) {
        card = createMinimizedCard(id, entry.win);
        minimizedCardCache.set(id, card);
      } else {
        syncMinimizedCard(card, id, entry.win);
      }
      var current = minimizedTray.children[index] || null;
      if (current !== card) minimizedTray.insertBefore(card, current);
    });
    minimizedTray.hidden = minimized.length === 0;
  }

  function createMinimizedTray() {
    var tray = document.createElement("section");
    tray.className = "neo-minimized-tray";
    tray.hidden = true;
    tray.tabIndex = 0;
    tray.setAttribute("aria-label", "Minimized windows");
    tray.addEventListener("wheel", function (event) {
      if (tray.scrollWidth <= tray.clientWidth || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
      var maxScroll = tray.scrollWidth - tray.clientWidth;
      var nextScroll = Math.max(0, Math.min(maxScroll, tray.scrollLeft + event.deltaY));
      if (nextScroll === tray.scrollLeft) return;
      tray.scrollLeft = nextScroll;
      event.preventDefault();
    }, { passive: false });
    // Desktop previews stay above widgets but below application windows.
    // App titlebar controls must never be covered by another app's preview.
    (document.getElementById('neo-desktop') || document.body).appendChild(tray);
    return tray;
  }

  function positionPreview(button) {
    if (!preview || preview.hidden || !button || !button.isConnected) return;
    var rect = button.getBoundingClientRect();
    var width = preview.offsetWidth;
    var height = preview.offsetHeight;
    var taskbar = button.closest(".taskbar");
    var taskbarRect = taskbar ? taskbar.getBoundingClientRect() : null;
    var position = document.documentElement.dataset.taskbarPosition || "left";
    var gap = 12;
    var left = rect.left + rect.width / 2 - width / 2;
    var top = rect.top + rect.height / 2 - height / 2;

    if (position === "left") {
      left = (taskbarRect ? taskbarRect.right : rect.right) + gap;
    } else if (position === "right") {
      left = (taskbarRect ? taskbarRect.left : rect.left) - width - gap;
    } else if (position === "top") {
      top = (taskbarRect ? taskbarRect.bottom : rect.bottom) + gap;
    } else {
      top = (taskbarRect ? taskbarRect.top : rect.top) - height - gap;
    }

    left = Math.max(10, Math.min(left, window.innerWidth - width - 10));
    top = Math.max(10, Math.min(top, window.innerHeight - height - 10));
    preview.style.left = Math.round(left) + "px";
    preview.style.right = "auto";
    preview.style.top = Math.round(top) + "px";
    preview.style.bottom = "auto";
  }

  function hideNow() {
    clearTimers();
    activeId = "";
    anchor = null;
    if (!preview) return;
    preview.classList.remove("is-open");
    window.setTimeout(function () {
      if (!activeId && preview) {
        preview.hidden = true;
        preview.querySelector("[data-taskbar-preview-viewport]").textContent = "";
      }
    }, 190);
  }

  function queueHide(delay) {
    window.clearTimeout(showTimer);
    window.clearTimeout(hideTimer);
    hideTimer = window.setTimeout(hideNow, delay == null ? 150 : delay);
  }

  function show(button) {
    if (!api || !button || !button.isConnected) return;
    if (fullscreenActive() || !previewsEnabled()) {
      hideNow();
      return;
    }
    var id = button.dataset.app;
    var win = api.windows.get(id);
    if (!win) {
      hideNow();
      return;
    }
    clearTimers();
    activeId = id;
    anchor = button;
    renderWindow(win, button, api.apps[id]);
    preview.hidden = false;
    positionPreview(button);
    requestAnimationFrame(function () {
      if (activeId === id) preview.classList.add("is-open");
    });
  }

  function queueShow(button, delay) {
    if (!button.classList.contains("is-running")) {
      queueHide(80);
      return;
    }
    window.clearTimeout(hideTimer);
    if (activeId === button.dataset.app && !preview.hidden) {
      anchor = button;
      positionPreview(button);
      return;
    }
    window.clearTimeout(showTimer);
    showTimer = window.setTimeout(function () { show(button); }, delay == null ? 220 : delay);
  }

  function createPreview() {
    var node = document.createElement("section");
    node.className = "neo-taskbar-preview";
    node.hidden = true;
    node.setAttribute("aria-label", "Window thumbnail");
    node.innerHTML =
      '<header class="neo-taskbar-preview-titlebar">' +
        '<span><strong data-taskbar-preview-title></strong><small data-taskbar-preview-status></small></span>' +
        '<button type="button" data-taskbar-preview-close><svg class="icon" aria-hidden="true"><use href="#i-close"></use></svg></button>' +
      '</header>' +
      '<button class="neo-taskbar-preview-open" type="button" data-taskbar-preview-open>' +
        '<span class="neo-taskbar-preview-viewport" data-taskbar-preview-viewport></span>' +
      '</button>';
    document.body.appendChild(node);
    node.addEventListener("pointerenter", function () { window.clearTimeout(hideTimer); });
    node.addEventListener("pointerleave", function () { queueHide(120); });
    node.querySelector("[data-taskbar-preview-open]").addEventListener("click", function () {
      var id = activeId;
      hideNow();
      if (id) api.open(id);
    });
    node.querySelector("[data-taskbar-preview-close]").addEventListener("click", function (event) {
      event.stopPropagation();
      var win = api.windows.get(activeId);
      hideNow();
      if (win) api.close(win);
    });
    return node;
  }

  function syncFullscreenVisibility() {
    if (fullscreenActive()) {
      hideNow();
      if (minimizedTray) minimizedTray.hidden = true;
      return;
    }
    refreshMinimizedTray();
  }

  function bindDock() {
    api.dock.addEventListener("pointerover", function (event) {
      if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
      var button = event.target.closest(".dock-button[data-app]");
      if (!button || !api.dock.contains(button) || (event.relatedTarget && button.contains(event.relatedTarget))) return;
      queueShow(button);
    });
    api.dock.addEventListener("pointerout", function (event) {
      var button = event.target.closest(".dock-button[data-app]");
      if (!button || !api.dock.contains(button)) return;
      if (event.relatedTarget && (button.contains(event.relatedTarget) || preview.contains(event.relatedTarget))) return;
      queueHide();
    });
    api.dock.addEventListener("focusin", function (event) {
      var button = event.target.closest(".dock-button[data-app]");
      if (button) queueShow(button, 0);
    });
    api.dock.addEventListener("focusout", function (event) {
      if (event.relatedTarget && (api.dock.contains(event.relatedTarget) || preview.contains(event.relatedTarget))) return;
      queueHide(80);
    });
    new MutationObserver(function () {
      if (!activeId) return;
      var next = Array.from(api.dock.querySelectorAll(".dock-button[data-app]")).find(function (button) { return button.dataset.app === activeId; });
      if (!next || !api.windows.has(activeId)) hideNow();
      else {
        anchor = next;
        renderWindow(api.windows.get(activeId), next, api.apps[activeId]);
        positionPreview(next);
      }
    }).observe(api.dock, { childList: true });
  }

  function start(dock, windows, apps, open, close) {
    if (!dock || !windows || preview) return;
    api = { dock: dock, windows: windows, apps: apps, open: open, close: close };
    preview = createPreview();
    minimizedTray = createMinimizedTray();
    bindDock();
    window.addEventListener("resize", function () { if (anchor) positionPreview(anchor); }, { passive: true });
    window.addEventListener("blur", hideNow);
    document.addEventListener("fullscreenchange", syncFullscreenVisibility);
    document.addEventListener("webkitfullscreenchange", syncFullscreenVisibility);
    new MutationObserver(syncFullscreenVisibility).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-tab-fullscreen", "data-fullscreen"]
    });
    document.addEventListener("keydown", function (event) { if (event.key === "Escape" && activeId) hideNow(); });
    document.addEventListener("pointerdown", function (event) {
      if (activeId && !preview.contains(event.target) && !event.target.closest(".dock-button[data-app]")) hideNow();
    }, { passive: true });
    window.addEventListener("neo-window-state-change", function (event) {
      var detail = event.detail || {};
      if (detail.closed && detail.id) {
        var card = Array.from(minimizedTray.querySelectorAll("[data-minimized-app]")).find(function (item) {
          return item.dataset.minimizedApp === String(detail.id);
        });
        if (card) card.remove();
        minimizedCardCache.delete(String(detail.id));
        forgetCachedPreviews(String(detail.id));
        if (!minimizedTray.children.length) minimizedTray.hidden = true;
        window.setTimeout(refreshMinimizedTray, 260);
        return;
      }
      requestAnimationFrame(refreshMinimizedTray);
    });
    window.addEventListener("neo-performance-mode-change", function () {
      hideNow();
      refreshMinimizedTray();
    });
    window.addEventListener("neo-taskbar-layout-change", function () {
      hideNow();
      requestAnimationFrame(refreshMinimizedTray);
    });
    refreshMinimizedTray();
  }

  window.NEO_TASKBAR_PREVIEW = { start: start };
})();
