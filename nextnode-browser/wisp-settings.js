(function () {
  "use strict";

  var STORAGE_KEY = "neo:browser:wisp:v1";
  var DEFAULT_WISP = "wss://nextnode9124.b-cdn.net/w/";
  var SERVERS = Object.freeze([
    Object.freeze({ name: "NextNode Wisp", url: DEFAULT_WISP }),
    Object.freeze({ name: "Probuilding Wisp", url: "wss://probuildingsupplies.com/w/" }),
    Object.freeze({ name: "Mercury Wisp", url: "wss://wisp.mercurywork.shop/" }),
    Object.freeze({ name: "Reeyuki Wisp", url: "wss://hurt-agata-liventcord-api-7072e9a6.koyeb.app/" }),
    Object.freeze({ name: "Reeyuki Wisp 2", url: "wss://reeyukiwisp.onrender.com/" })
  ]);

  function normalize(value) {
    var text = String(value || "").trim();
    if (!/^wss?:\/\//i.test(text)) return "";
    return text.endsWith("/") ? text : text + "/";
  }

  function storedWisp() {
    try { return normalize(localStorage.getItem(STORAGE_KEY)); } catch (_error) { return ""; }
  }

  function configuredWisp() {
    var stored = storedWisp();
    if (stored) return stored;
    try {
      var parentDefault = normalize(parent.NEO_LOCAL_CONFIG && parent.NEO_LOCAL_CONFIG.browserWisp);
      if (parentDefault) return parentDefault;
    } catch (_error) {}
    return DEFAULT_WISP;
  }

  window.NEO_PROXY_ENGINE = "Scramjet";
  window.NEO_WISP_SERVERS = SERVERS;
  window.NEO_WISP = configuredWisp();

  function install() {
    var button = document.getElementById("b-wisp");
    var panel = document.getElementById("wisp-panel");
    var select = document.getElementById("wisp-select");
    var customRow = document.getElementById("wisp-custom-row");
    var customInput = document.getElementById("wisp-custom-input");
    var applyButton = document.getElementById("wisp-apply");
    var status = document.getElementById("wisp-status");
    if (!button || !panel || !select || !customRow || !customInput || !applyButton || !status) return;

    var current = configuredWisp();
    select.innerHTML = SERVERS.map(function (server) {
      return '<option value="' + server.url + '">' + server.name + "</option>";
    }).join("") + '<option value="custom">Custom...</option>';

    var preset = SERVERS.find(function (server) { return server.url === current; });
    select.value = preset ? preset.url : "custom";
    customInput.value = preset ? "" : current;
    customRow.hidden = Boolean(preset);
    status.textContent = "Active: " + (preset ? preset.name : current.replace(/^wss?:\/\//i, ""));

    function close() {
      panel.hidden = true;
      button.setAttribute("aria-expanded", "false");
    }

    button.addEventListener("click", function (event) {
      event.stopPropagation();
      panel.hidden = !panel.hidden;
      button.setAttribute("aria-expanded", String(!panel.hidden));
      if (!panel.hidden) select.focus();
    });
    select.addEventListener("change", function () {
      customRow.hidden = select.value !== "custom";
      if (!customRow.hidden) customInput.focus();
    });
    applyButton.addEventListener("click", function () {
      var next = select.value === "custom" ? normalize(customInput.value) : normalize(select.value);
      if (!next) {
        status.textContent = "Enter a ws:// or wss:// server URL.";
        status.dataset.error = "true";
        return;
      }
      try { localStorage.setItem(STORAGE_KEY, next); } catch (_error) {}
      status.removeAttribute("data-error");
      status.textContent = "Switching server...";
      window.location.reload();
    });
    document.addEventListener("click", function (event) {
      if (!panel.hidden && !panel.contains(event.target) && event.target !== button) close();
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && !panel.hidden) close();
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install, { once: true });
  else install();
})();
