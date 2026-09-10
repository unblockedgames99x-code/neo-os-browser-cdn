(function () {
  'use strict';
  if (window.NEO_APP_THEME) return;

  const storageKey = 'neo_desktop_preferences_v1';
  const legacyThemes = {dark:'graphite',light:'frost',glass:'graphite',retro:'ember','high-contrast':'contrast'};
  const knownThemes = new Set([
    'graphite','oled','midnight','frost','ember','contrast','crimson','ember-dusk',
    'terracotta','tangerine','amber-haze','marigold','citron','olive-grove','clover',
    'fern-hollow','emerald','eucalyptus','aqua','glacier','azure','indigo-veil','violet',
    'amethyst-smoke','plum-velvet','fuchsia','orchid-smoke','rosewood','default','glass',
    'coral','copper','moss','teal','ocean','cobalt','lavender-night','sakura','slate','obsidian'
  ]);
  const root = document.documentElement;
  const interfaceStyleSheet = document.currentScript
    ? new URL('neo-interface-styles.css?v=20260907-launcher-picture-alignment-v12', document.currentScript.src).href
    : new URL('../neo-interface-styles.css?v=20260907-launcher-picture-alignment-v12', document.baseURI).href;
  const messageTargetOrigin = location.origin === 'null' ? '*' : location.origin;
  const trustedMessageOrigin = origin => location.origin === 'null' ? origin === 'null' : origin === location.origin;
  let activeState = {};
  let activePalette = null;
  let activeInterfaceStyle = 'modern';

  let interfaceStyleLink = document.getElementById('neo-interface-styles');
  if (!interfaceStyleLink) {
    interfaceStyleLink = document.createElement('link');
    interfaceStyleLink.id = 'neo-interface-styles';
    interfaceStyleLink.rel = 'stylesheet';
    interfaceStyleLink.href = interfaceStyleSheet;
    document.head.append(interfaceStyleLink);
  }
  function keepInterfaceStyleSheetLast() {
    if (document.head && interfaceStyleLink.nextElementSibling) document.head.append(interfaceStyleLink);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', keepInterfaceStyleSheetLast, {once:true});

  const path = location.pathname.toLowerCase();
  const isMusicApp = window.__NEO_MUSIC__ === true || /\/music-(?:local|v2)\//.test(path);
  const routedApp = /\/music-(?:local|v2)\//.test(path) ? 'music'
    : path.includes('/neo-chat/') ? 'chat'
    : path.includes('/neo-cloud/') ? 'cloud'
    : path.includes('/neo-tv/') ? 'tv'
    : path.includes('/local-browser/') ? 'local-browser'
    : path.includes('/browser-newtab') ? 'browser-newtab'
    : path.includes('/neo-browser/') ? 'browser'
    : 'app';
  root.dataset.neoMusic = isMusicApp ? 'true' : 'false';
  root.dataset.neoApp = routedApp;

  function normalizedTheme(value) {
    const theme = legacyThemes[value] || value;
    return knownThemes.has(theme) ? theme : 'oled';
  }

  function normalizedInterfaceStyle(value) {
    return String(value || '').toLowerCase() === 'retro' ? 'retro' : 'modern';
  }

  function sendInterfaceStyle(target) {
    if (!target) return;
    try { target.postMessage({type:'neo-shell:interface-style', style:activeInterfaceStyle}, messageTargetOrigin); } catch (_) {}
  }

  function applyInterfaceStyle(value) {
    activeInterfaceStyle = normalizedInterfaceStyle(value);
    root.dataset.neoApp = isMusicApp && activeInterfaceStyle === 'retro' ? 'music' : routedApp;
    root.dataset.interfaceStyle = activeInterfaceStyle;
    root.dataset.neoInterfaceStyle = activeInterfaceStyle;
    keepInterfaceStyleSheetLast();
    document.querySelectorAll('iframe').forEach(sendFrameInterface);
    window.dispatchEvent(new CustomEvent('neo-interface-style-change', {detail:{style:activeInterfaceStyle}}));
  }

  function apply(state, palette) {
    const next = {...state, theme: normalizedTheme(state?.theme)};
    activeState = next;
    if (palette) activePalette = {...palette};
    root.dataset.neoTheme = next.theme;
    root.style.colorScheme = next.theme === 'frost' ? 'light' : 'dark';
    if (palette) {
      ['bg','surface','text','muted','line','accent'].forEach(key => {
        if (palette[key]) root.style.setProperty('--desktop-' + key, palette[key]);
      });
    }
    window.dispatchEvent(new CustomEvent('neo-theme-change', {detail: next}));
    document.querySelectorAll('iframe').forEach(sendFramePreferences);
  }

  function sendPreferences(target) {
    if (!target) return;
    try { target.postMessage({type:'neo-system-preferences', state:{...activeState}, palette:activePalette && {...activePalette}}, messageTargetOrigin); } catch (_) {}
  }

  function isProxyFrame(frame) {
    return !frame || frame.dataset?.neoScramjet === 'true';
  }

  function sendFrameInterface(frame) {
    if (isProxyFrame(frame)) return;
    sendInterfaceStyle(frame.contentWindow);
  }

  function sendFramePreferences(frame) {
    if (isProxyFrame(frame)) return;
    sendPreferences(frame.contentWindow);
  }

  function syncFrame(frame) {
    if (isProxyFrame(frame)) return;
    sendPreferences(frame.contentWindow);
    sendInterfaceStyle(frame.contentWindow);
  }

  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(storageKey) || '{}'); } catch (_) {}
  let savedShell = {};
  try { savedShell = JSON.parse(localStorage.getItem('neo_os_settings_v1') || '{}'); } catch (_) {}
  applyInterfaceStyle(savedShell.interfaceStyle);
  apply(saved);

  window.addEventListener('storage', event => {
    if (event.key === 'neo_os_settings_v1') {
      try { applyInterfaceStyle(JSON.parse(event.newValue || '{}').interfaceStyle); } catch (_) {}
      return;
    }
    if (event.key !== storageKey) return;
    try { apply(JSON.parse(event.newValue || '{}')); } catch (_) {}
  });
  window.addEventListener('message', event => {
    if (!trustedMessageOrigin(event.origin)) return;
    if (event.source === parent && event.data?.type === 'neo-shell:interface-style') {
      applyInterfaceStyle(event.data.style);
      return;
    }
    if (event.data?.type === 'neo-system-preferences-request') {
      const owned = Array.from(document.querySelectorAll('iframe')).some(frame => frame.contentWindow === event.source);
      if (owned) sendPreferences(event.source);
      return;
    }
    if (event.source !== parent || event.data?.type !== 'neo-system-preferences') return;
    apply(event.data.state || {}, event.data.palette);
  });

  new MutationObserver(records => records.forEach(record => record.addedNodes.forEach(node => {
    if (node.matches?.('iframe')) node.addEventListener('load', () => syncFrame(node));
    node.querySelectorAll?.('iframe').forEach(frame => frame.addEventListener('load', () => syncFrame(frame)));
  }))).observe(document.documentElement, {childList:true, subtree:true});

  window.NEO_APP_THEME = Object.freeze({apply, applyInterfaceStyle, getTheme: () => root.dataset.neoTheme, getStyle: () => activeInterfaceStyle});
  if (parent !== window) parent.postMessage({type:'neo-system-preferences-request'}, messageTargetOrigin);
})();
