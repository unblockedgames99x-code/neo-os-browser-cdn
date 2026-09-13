(function () {
  "use strict";

  var browserRoute = "./NEO-BROWSER/index.html?neo-app-mode=1&neo-custom-app=1&neo-app-target=";
  var extraApps = {};

  function add(id, title, category, icon, route, subtitle, aliases) {
    extraApps[id] = {
      id: id,
      title: title,
      subtitle: subtitle || title,
      icon: icon || "apps",
      route: route,
      keepAlive: false,
      width: 1080,
      height: 720,
      launcher: true,
      pinned: false,
      core: true,
      category: category,
      aliases: (aliases || []).concat([title, category])
    };
  }

  function web(id, title, url, category, icon, subtitle, aliases) {
    add(id, title, category, icon, browserRoute + encodeURIComponent(url), subtitle || (new URL(url).hostname.replace(/^www\./, "") + " · NEO Browser"), aliases);
  }

  function tool(id, title, category, icon, subtitle, aliases) {
    add(id, title, category, icon, "./neo-tools/index.html?tool=" + encodeURIComponent(id), subtitle, aliases);
  }

  [
    ["itch-io","Itch.io","https://itch.io/","Games","gamepad"],
    ["crazy-games","CrazyGames","https://www.crazygames.com/","Games","gamepad"],
    ["newgrounds","Newgrounds","https://www.newgrounds.com/","Games","gamepad"],
    ["geforce-now","GeForce NOW","https://play.geforcenow.com/","Games","gamepad"],
    ["flashpoint","Flashpoint Database","https://flashpointarchive.org/datahub/Game_Master_List","Games","gamepad"],
    ["roblox","Roblox","https://www.roblox.com/discover","Games","gamepad"],
    ["js-dos","DOS Games","https://js-dos.com/games/","Games","gamepad"],
    ["ruffle","Ruffle","https://ruffle.rs/demo/","Games","gamepad"],
    ["lavat","Lavat","https://lavat.io/","Games","gamepad"],
    ["slack","Slack","https://app.slack.com/client","Internet","chat"],
    ["gmail","Gmail","https://mail.google.com/","Internet","file"],
    ["outlook","Outlook","https://outlook.live.com/mail/","Internet","file"],
    ["zoom","Zoom","https://app.zoom.us/wc/","Internet","users"],
    ["x-twitter","X / Twitter","https://x.com/","Internet","chat"],
    ["instagram","Instagram","https://www.instagram.com/","Internet","brush"],
    ["pinterest","Pinterest","https://www.pinterest.com/","Internet","brush"],
    ["proton-mail","Proton Mail","https://mail.proton.me/","Internet","file"],
    ["yahoo-mail","Yahoo Mail","https://mail.yahoo.com/","Internet","file"],
    ["maps","Maps","https://www.openstreetmap.org/","Internet","home"],
    ["torrent-web","Torrent Web","https://webtor.io/","Internet","download"],
    ["chatgpt-web","ChatGPT","https://chatgpt.com/","Internet","chatgpt"],
    ["deepseek","DeepSeek","https://chat.deepseek.com/","Internet","sparkles"],
    ["grok","Grok","https://grok.com/","Internet","sparkles"],
    ["notion","Notion","https://www.notion.so/","Office","file"],
    ["google-docs","Google Docs","https://docs.google.com/document/","Office","file"],
    ["office-web","Microsoft 365","https://www.microsoft365.com/","Office","file"],
    ["figma","Figma","https://www.figma.com/","Graphics","brush"],
    ["canva","Canva","https://www.canva.com/","Graphics","brush"],
    ["pixlr","Pixlr","https://pixlr.com/editor/","Graphics","brush"],
    ["github","GitHub","https://github.com/","Development","code"],
    ["gitlab","GitLab","https://gitlab.com/","Development","code"],
    ["codepen","CodePen","https://codepen.io/pen/","Development","code"],
    ["twitch","Twitch","https://www.twitch.tv/","Media","stream"],
    ["soundcloud","SoundCloud","https://soundcloud.com/","Media","stream"],
    ["deezer","Deezer","https://www.deezer.com/","Media","stream"],
    ["tiktok","TikTok","https://www.tiktok.com/","Media","film"],
    ["aniwatch","Anime","https://hianime.to/","Media","film"],
    ["aquarium-web","Aquarium","https://webglsamples.org/aquarium/aquarium.html","Media","sparkles"]
  ].forEach(function (item) { web.apply(null, item); });

  [
    ["markdown","Markdown","Office","file","Write and preview Markdown locally"],
    ["file-converter","File Converter","Office","upload","Convert text and images on this device"],
    ["clock-tools","Clock","Office","bell","Clock, stopwatch, and timer"],
    ["camera","Camera","Graphics","eye","Capture photos with your camera"],
    ["color-picker","Color Picker","Graphics","brush","Pick colors and check contrast"],
    ["emoji-selector","Emoji Selector","Graphics","sparkles","Search and copy emoji"],
    ["screenshot-studio","Screenshot Studio","Graphics","fullscreen","Annotate screenshots locally"],
    ["clipboard-manager","Clipboard Manager","Utilities","file","Private on-device clipboard shelf"],
    ["magnifier","Magnifier","Utilities","eye","Inspect images with adjustable zoom"],
    ["system-monitor","System Monitor","System","monitor","Live browser and device performance"],
    ["storage-editor","Storage Editor","Development","folder","Inspect NEO local storage"],
    ["developer-tools","Developer Tools","Development","code","Responsive and runtime diagnostics"],
    ["virtual-machine-manager","Virtual Machines","Development","monitor","Manage browser-based virtual machines"],
    ["app-creator","App Creator","Development","apps","Create launchable NEO web apps"],
    ["rhythms","Rhythms","Media","stream","Audio-reactive visualizer"],
    ["cmatrix","CMatrix","Games","terminal","Animated terminal rain"],
    ["mode-switcher","Mode Switcher","System","grid","Switch workspace modes quickly"],
    ["shortcuts","Shortcuts","System","grid","Review keyboard shortcuts"],
    ["default-apps","Default Apps","System","apps","Choose default NEO apps"],
    ["session-manager","Session","System","unlock","Save and restore open apps"],
    ["neo-guide","NEO OS Guide","Help","info","Learn the desktop and its shortcuts"],
    ["intro-tour","Intro Tour","Help","sparkles","Take a guided NEO OS tour"],
    ["whats-new","What’s New","Help","info","See recent NEO OS improvements"]
  ].forEach(function (item) { tool.apply(null, item); });

  window.NEO_EXTRA_APPS = Object.assign({}, window.NEO_EXTRA_APPS || {}, extraApps);
  window.NEO_IMPORTED_APP_COUNT = 96;

  var SETTINGS_KEY = "neo_extended_settings_v1";
  var defaults = {
    notifications: true, doNotDisturb: false, notificationDuration: 5, notificationPosition: "top-right",
    analytics: false, ads: false, achievements: true, friendActivity: false, recentFiles: true,
    skipBoot: false, restoreSession: true, compactSidebar: false, density: "comfortable",
    launcherRecent: true, launcherCategories: true, startMenuWidth: 835, startMenuHeight: 720,
    gamingOverlay: true, gamingHotkey: "Shift+Tab", ruffleAutoplay: true, ruffleUnmute: false,
    ruffleScale: "showAll", ruffleUpgradeHttps: true, ruffleContextMenu: true,
    networkMirror: "fastly", wispServer: "auto", transport: "epoxy", autostart: []
  };

  function readSettings() {
    try { return Object.assign({}, defaults, JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}")); }
    catch (_error) { return Object.assign({}, defaults); }
  }

  function writeSettings(value) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(value));
    applyExtendedSettings(value);
  }

  function applyExtendedSettings(value) {
    var root = document.documentElement;
    root.dataset.notificationPosition = value.notificationPosition;
    root.dataset.doNotDisturb = value.doNotDisturb ? "true" : "false";
    root.dataset.uiDensity = value.density;
    root.dataset.compactSidebar = value.compactSidebar ? "true" : "false";
    root.style.setProperty("--neo-launcher-user-width", Math.max(640, Math.min(835, Number(value.startMenuWidth) || 835)) + "px");
    root.style.setProperty("--neo-launcher-user-height", Math.max(520, Math.min(850, Number(value.startMenuHeight) || 720)) + "px");
    document.querySelectorAll(".launcher-recent-section").forEach(function (node) { node.hidden = value.launcherRecent === false; });
    document.querySelectorAll(".launcher-category-section").forEach(function (node) { node.hidden = value.launcherCategories === false; });
  }

  function section(title, description, body, className) {
    var panel = document.createElement("section");
    panel.className = "settings-section parity-settings-section " + (className || "");
    panel.innerHTML = '<div class="section-heading"><div><h3>' + title + '</h3><p>' + description + '</p></div></div>' + body;
    return panel;
  }

  function toggle(name, title, copy, disabled) {
    return '<label class="toggle-row"><span><strong>' + title + '</strong><small>' + copy + '</small></span><input type="checkbox" data-extended-setting="' + name + '"' + (disabled ? ' disabled' : '') + '><span class="switch" aria-hidden="true"></span></label>';
  }

  function select(name, title, copy, options) {
    return '<label class="parity-select-row"><span><strong>' + title + '</strong><small>' + copy + '</small></span><select data-extended-setting="' + name + '">' + options.map(function (option) { return '<option value="' + option[0] + '">' + option[1] + '</option>'; }).join("") + '</select></label>';
  }

  function installSettings(control) {
    if (!control || control.querySelector("[data-parity-settings]")) return;
    var marker = document.createElement("span");
    marker.hidden = true;
    marker.dataset.paritySettings = "";
    control.appendChild(marker);

    control.appendChild(section("General behavior", "Startup, session, layout density, and everyday workspace behavior.",
      toggle("skipBoot", "Skip boot screen", "Open the desktop immediately on returning visits") +
      toggle("restoreSession", "Restore session", "Reopen the apps that were active last time") +
      toggle("compactSidebar", "Compact sidebars", "Use tighter navigation in supported apps") +
      select("density", "Interface density", "Choose how much information fits on screen", [["comfortable","Comfortable"],["compact","Compact"],["spacious","Spacious"]]), "general-parity-settings"));

    control.appendChild(section("Notifications and privacy", "Control interruptions and keep optional data collection off.",
      toggle("notifications", "Notifications", "Allow local NEO OS notifications") +
      toggle("doNotDisturb", "Do not disturb", "Silence notification popups") +
      select("notificationPosition", "Popup position", "Where local notifications appear", [["top-right","Top right"],["top-left","Top left"],["bottom-right","Bottom right"],["bottom-left","Bottom left"]]) +
      '<label class="range-field"><span><strong>Popup duration</strong><output data-extended-output="notificationDuration"></output></span><input type="range" min="2" max="20" step="1" data-extended-setting="notificationDuration"></label>' +
      toggle("achievements", "Achievements", "Track local milestones on this device") +
      toggle("recentFiles", "Recent files", "Show recently opened local files") +
      toggle("analytics", "Anonymous analytics", "Always off by default") +
      toggle("ads", "Advertising", "NEO OS is ad-free", true), "privacy-parity-settings"));

    control.appendChild(section("Desktop and launcher", "Organize applications with recent items and browsable categories.",
      toggle("launcherRecent", "Recent applications", "Show recently used apps in the launcher") +
      toggle("launcherCategories", "Application categories", "Group the complete app library by type") +
      '<label class="range-field"><span><strong>Start menu width</strong><output data-extended-output="startMenuWidth"></output></span><input type="range" min="640" max="835" step="5" data-extended-setting="startMenuWidth"></label>' +
      '<label class="range-field"><span><strong>Start menu height</strong><output data-extended-output="startMenuHeight"></output></span><input type="range" min="520" max="850" step="10" data-extended-setting="startMenuHeight"></label>', "launcher-parity-settings"));

    control.appendChild(section("Network and browser", "Choose a CDN mirror, WISP endpoint, and Scramjet transport.",
      select("networkMirror", "CDN mirror", "Asset delivery provider", [["fastly","Fastly jsDelivr"],["global","Global jsDelivr"],["gcore","GCore jsDelivr"],["quantil","Quantil jsDelivr"]]) +
      select("wispServer", "WISP server", "Proxy connection used by Scramjet", [["auto","Automatic (fastest healthy)"],["probuildings","Probuilding Wisp"],["mercury","Mercury Wisp"],["reeyuki","Reeyuki Wisp"],["reeyuki2","Reeyuki Wisp 2"]]) +
      select("transport", "Transport protocol", "Scramjet browser transport", [["epoxy","Epoxy (Wisp)"],["libcurl","Libcurl"],["bare","Bare fallback"]]), "network-parity-settings"));

    control.appendChild(section("Gaming and Flash", "Tune the gaming overlay and Ruffle compatibility defaults.",
      toggle("gamingOverlay", "Gaming overlay", "Show quick game controls over supported games") +
      toggle("ruffleAutoplay", "Ruffle autoplay", "Start Flash content automatically") +
      toggle("ruffleUnmute", "Start Flash with sound", "Allow audio after interaction") +
      toggle("ruffleUpgradeHttps", "Upgrade Flash URLs to HTTPS", "Prefer secure resources when available") +
      toggle("ruffleContextMenu", "Ruffle context menu", "Show playback and quality tools") +
      select("ruffleScale", "Flash scaling", "How SWF content fits its window", [["showAll","Show all"],["noBorder","Fill window"],["exactFit","Exact fit"]]), "gaming-parity-settings"));

    var appsPanel = section("Apps and autostart", "Search the complete organized app library and choose what starts with NEO OS.",
      '<label class="parity-app-search"><span class="sr-only">Search autostart applications</span><input type="search" placeholder="Search applications" data-autostart-search></label><div class="parity-autostart-list" data-autostart-list></div>', "apps-parity-settings");
    control.appendChild(appsPanel);

    var dataPanel = section("Data and storage", "Export, import, or reset local NEO OS data.",
      '<div class="parity-action-row"><button type="button" data-parity-backup>Download backup</button><button type="button" data-parity-restore>Import backup</button><button type="button" data-parity-reset-layout>Reset window layout</button></div><p class="performance-mode-note">Backups exclude passwords, authentication tokens, and active sessions.</p>', "data-parity-settings");
    control.appendChild(dataPanel);

    wireSettings(control);
  }

  function wireSettings(control) {
    var state = readSettings();
    control.querySelectorAll("[data-extended-setting]").forEach(function (input) {
      var name = input.dataset.extendedSetting;
      if (input.type === "checkbox") input.checked = Boolean(state[name]);
      else input.value = state[name];
      function update() {
        state[name] = input.type === "checkbox" ? input.checked : (input.type === "range" ? Number(input.value) : input.value);
        if (name === "ads") state.ads = false;
        var output = control.querySelector('[data-extended-output="' + name + '"]');
        if (output) output.textContent = input.value + (name === "notificationDuration" ? "s" : "px");
        writeSettings(state);
      }
      input.addEventListener(input.type === "range" ? "input" : "change", update);
      update();
    });
    var list = control.querySelector("[data-autostart-list]");
    var search = control.querySelector("[data-autostart-search]");
    var shell = window.NEO_SHELL;
    if (list && shell) {
      shell.getApps().sort(function (a, b) { return (a.category || "").localeCompare(b.category || "") || a.title.localeCompare(b.title); }).forEach(function (app) {
        var label = document.createElement("label");
        label.className = "parity-autostart-app";
        label.dataset.autostartText = (app.title + " " + (app.category || "")).toLowerCase();
        var checked = state.autostart.indexOf(app.id) !== -1;
        label.innerHTML = '<span><strong></strong><small></small></span><input type="checkbox"><span class="switch" aria-hidden="true"></span>';
        label.querySelector("strong").textContent = app.title;
        label.querySelector("small").textContent = app.category || "Application";
        var checkbox = label.querySelector("input");
        checkbox.checked = checked;
        checkbox.addEventListener("change", function () {
          state.autostart = state.autostart.filter(function (id) { return id !== app.id; });
          if (checkbox.checked) state.autostart.push(app.id);
          writeSettings(state);
        });
        list.appendChild(label);
      });
      search.addEventListener("input", function () {
        var query = search.value.trim().toLowerCase();
        list.querySelectorAll(".parity-autostart-app").forEach(function (item) { item.hidden = Boolean(query) && item.dataset.autostartText.indexOf(query) === -1; });
      });
    }
    var backup = control.querySelector("[data-parity-backup]");
    var restore = control.querySelector("[data-parity-restore]");
    var reset = control.querySelector("[data-parity-reset-layout]");
    if (backup) backup.addEventListener("click", function () { document.querySelector("[data-neo-backup-download]").click(); });
    if (restore) restore.addEventListener("click", function () { document.querySelector("[data-neo-backup-import]").click(); });
    if (reset) reset.addEventListener("click", function () { if (window.NEO_SHELL) window.NEO_SHELL.resetLayout(); });
  }

  function initialize() {
    applyExtendedSettings(readSettings());
    function enhanceSettingsWindow(node) {
      if (!node || node.nodeType !== 1) return;
      var control = node.matches && node.matches('.neo-window[data-app-id="control"]') ? node.querySelector(".control-center") : node.querySelector && node.querySelector('.neo-window[data-app-id="control"] .control-center');
      if (control) installSettings(control);
    }
    if (window.NEO_DESKTOP && !window.NEO_DESKTOP.__parityWrapped) {
      var originalEnhance = window.NEO_DESKTOP.enhance;
      window.NEO_DESKTOP.enhance = function (id, body) {
        if (id === "control") installSettings(body.querySelector(".control-center"));
        return originalEnhance.apply(this, arguments);
      };
      window.NEO_DESKTOP.__parityWrapped = true;
    }
    enhanceSettingsWindow(document);
    var windowLayer = document.getElementById("window-layer");
    if (windowLayer && typeof MutationObserver === "function") {
      new MutationObserver(function (records) {
        records.forEach(function (record) { record.addedNodes.forEach(enhanceSettingsWindow); });
      }).observe(windowLayer, { childList: true, subtree: true });
    }
    window.setTimeout(function () {
      var current = readSettings();
      if (!window.NEO_SHELL || current.restoreSession === false || sessionStorage.getItem("neo_autostart_completed_v1")) return;
      sessionStorage.setItem("neo_autostart_completed_v1", "1");
      current.autostart.slice(0, 6).forEach(function (id, index) {
        window.setTimeout(function () { if (window.NEO_SHELL.isInstalled(id)) window.NEO_SHELL.openApp(id); }, index * 180);
      });
    }, 1200);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialize, { once: true });
  else initialize();
})();
