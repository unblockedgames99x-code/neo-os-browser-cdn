(() => {
  "use strict";

  const LITE_SEARCH_URL = "https://lite.duckduckgo.com/lite/?q=";
  const CHALLENGE_TEXT = /Unfortunately, bots use DuckDuckGo too|Select all squares containing a duck/i;
  const recoveredQueries = new Set();

  function scopedSetting(name) {
    try {
      const instanceId = window._sessionInstId || sessionStorage.getItem("__neo_inst__");
      return instanceId ? localStorage.getItem(`${instanceId}:${name}`) : null;
    } catch {
      return null;
    }
  }

  function usesBuiltInSearch() {
    return (scopedSetting("neo:engine:v1") || "ddg") !== "custom";
  }

  function isSearchPhrase(value) {
    const input = String(value || "").trim();
    if (!input || /^(?:neo|about|data|blob|javascript):/i.test(input)) return false;
    try {
      const parsed = new URL(input);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") return false;
    } catch {}
    return !(!input.includes(" ") && input.includes("."));
  }

  function reliableDestination(value) {
    const input = String(value || "").trim();
    if (!usesBuiltInSearch() || !isSearchPhrase(input)) return input;
    return `${LITE_SEARCH_URL}${encodeURIComponent(input)}`;
  }

  function rewriteInput(input) {
    if (!(input instanceof HTMLInputElement)) return;
    const destination = reliableDestination(input.value);
    if (destination && destination !== input.value) input.value = destination;
  }

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    if (event.target?.matches?.("#url, #ntSearch")) rewriteInput(event.target);
  }, true);

  function rewriteButtonSearch(event) {
    const button = event.target?.closest?.("#go, #ntSearchBtn");
    if (!button) return;
    rewriteInput(document.getElementById(button.id === "go" ? "url" : "ntSearch"));
  }

  document.addEventListener("pointerdown", rewriteButtonSearch, true);
  document.addEventListener("mousedown", rewriteButtonSearch, true);
  document.addEventListener("click", rewriteButtonSearch, true);

  function queryFromAddress() {
    try {
      const current = new URL(document.getElementById("url")?.value || "");
      if (!/(?:^|\.)duckduckgo\.com$/i.test(current.hostname)) return "";
      return current.searchParams.get("q") || "";
    } catch {
      return "";
    }
  }

  function recoverFromChallenge() {
    const frame = document.getElementById("frame");
    if (!frame) return;
    window.setTimeout(() => {
      let pageText = "";
      try {
        pageText = frame.contentDocument?.body?.innerText || "";
      } catch {
        return;
      }
      if (!CHALLENGE_TEXT.test(pageText)) return;
      const query = queryFromAddress();
      if (!query || recoveredQueries.has(query)) return;
      recoveredQueries.add(query);
      const address = document.getElementById("url");
      if (!address) return;
      address.value = `${LITE_SEARCH_URL}${encodeURIComponent(query)}`;
      address.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true
      }));
    }, 250);
  }

  document.getElementById("frame")?.addEventListener("load", recoverFromChallenge, true);

  window.NEOSearchReliability = Object.freeze({
    endpoint: LITE_SEARCH_URL,
    destinationFor: reliableDestination
  });
})();
