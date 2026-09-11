(function () {
  "use strict";

  var DB_NAME = "neo_os_wallpaper_engine_v1";
  var DB_VERSION = 1;
  var STORE_NAME = "wallpapers";
  var MAX_FILE_SIZE = 160 * 1024 * 1024;
  var SUPPORTED_TYPES = /^(image\/(png|jpeg|webp|gif)|video\/(mp4|webm))$/;
  var root = document.documentElement;
  var host = null;
  var mediaLayer = null;
  var loadingElement = null;
  var activeMedia = null;
  var activeId = "";
  var activeRecord = null;
  var loadingScreenTimer = 0;
  var canvasFrame = 0;
  var canvasCleanup = null;
  var canvasResume = null;
  var playbackWatch = 0;
  var webHealthWatch = 0;
  var webHealth = null;
  var webFallbackFrame = 0;
  var webFallbackCleanup = null;
  var webFallbackResume = null;
  var animatedImageFreeze = null;
  var pendingMedia = null;
  var cancelPendingMedia = null;
  var applySequence = 0;
  var suspendedKey = "";
  var libraryPromise = null;
  var library = [];
  var libraryRepairPromise = null;
  var bundledPromise = null;
  var bundledLibrary = [];
  var listeners = [];
  var assetUrls = new Map();
  var previewUrls = new Map();
  var battery = null;
  var audioUnlocked = false;
  var mediaPriorityPaused = false;
  var autoPerformancePaused = false;
  var stabilityPaused = false;
  var stabilityWatch = 0;
  var stabilityRecovery = 0;
  var stabilityExpected = 0;
  var stabilityStallScore = 0;
  var reactiveCoverElement = null;
  var reactiveCoverRefresh = null;
  var initialized = false;
  var YOUTUBE_CHROME_CROP = 96;
  var YOUTUBE_CLEAN_REVEAL_DELAY = 4200;
  var WALLPAPER_LOADING_LIMIT = 5000;
  var runtimeSettings = {
    wallpaperFit: "cover",
    wallpaperMuted: true,
    wallpaperVolume: 60,
    wallpaperSpeed: 1,
    wallpaperLoop: true,
    wallpaperPaused: false,
    motion: true,
    batterySaver: false,
    reduceMotion: false,
    performanceMode: "normal"
  };
  var BUILT_IN_CANVAS_WALLPAPERS = [{
    id: "neo-reactive",
    name: "NEO Reactive",
    type: "canvas",
    mediaType: "canvas",
    sourceType: "scene",
    author: "NEO OS",
    description: "A full-spectrum NEO scene that reacts to the current song and shows its timestamp.",
    size: 0,
    width: 1920,
    height: 1080,
    createdAt: 0,
    bundled: true,
    builtIn: true,
    fullMedia: true
  }];
  var reactiveAudioState = {
    source: "",
    active: false,
    playing: false,
    title: "",
    cover: "",
    coverReady: false,
    coverRevision: 0,
    position: 0,
    duration: 0,
    stateAt: 0,
    levels: [0, 0, 0, 0, 0, 0, 0, 0],
    levelsAt: 0
  };

  function safeReactiveCover(value) {
    var source = String(value || "").trim();
    if (!source || source.length > 900000) return "";
    if (/^data:image\/(?:avif|gif|jpeg|png|webp);/i.test(source)) return source;
    try {
      var url = new URL(source, window.location.href);
      return /^(?:blob:|https?:)$/.test(url.protocol) ? url.href : "";
    } catch (_error) {
      return "";
    }
  }

  function syncReactiveCoverElement() {
    if (!reactiveCoverElement || !reactiveCoverElement.isConnected) return;
    var cover = reactiveAudioState.cover;
    if (reactiveCoverElement.dataset.cover === cover) return;
    reactiveCoverElement.dataset.cover = cover;
    reactiveCoverElement.classList.remove("is-ready");
    reactiveCoverElement.removeAttribute("src");
    reactiveAudioState.coverReady = false;
    if (!cover) return;
    reactiveCoverElement.onload = function () {
      if (!reactiveCoverElement || reactiveCoverElement.dataset.cover !== cover) return;
      reactiveAudioState.coverReady = true;
      reactiveAudioState.coverRevision += 1;
      reactiveCoverElement.classList.add("is-ready");
      if (reactiveCoverRefresh) reactiveCoverRefresh();
    };
    reactiveCoverElement.onerror = function () {
      if (!reactiveCoverElement || reactiveCoverElement.dataset.cover !== cover) return;
      reactiveAudioState.coverReady = false;
      reactiveAudioState.coverRevision += 1;
      reactiveCoverElement.classList.remove("is-ready");
      if (reactiveCoverRefresh) reactiveCoverRefresh();
    };
    reactiveCoverElement.src = cover;
  }

  function openDatabase() {
    return new Promise(function (resolve, reject) {
      if (!window.indexedDB) {
        reject(new Error("Wallpaper storage is unavailable on this device."));
        return;
      }
      var request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = function () {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) {
          var store = request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
          store.createIndex("createdAt", "createdAt");
        }
      };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error || new Error("Could not open wallpaper storage.")); };
    });
  }

  function runTransaction(mode, action) {
    return openDatabase().then(function (db) {
      return new Promise(function (resolve, reject) {
        var transaction = db.transaction(STORE_NAME, mode);
        var store = transaction.objectStore(STORE_NAME);
        var result;
        try {
          result = action(store);
        } catch (error) {
          db.close();
          reject(error);
          return;
        }
        transaction.oncomplete = function () { db.close(); resolve(result); };
        transaction.onerror = function () { db.close(); reject(transaction.error || new Error("Wallpaper storage failed.")); };
        transaction.onabort = function () { db.close(); reject(transaction.error || new Error("Wallpaper storage was interrupted.")); };
      });
    });
  }

  function repairInstalledLibraryOnStartup() {
    if (libraryRepairPromise) return libraryRepairPromise;
    libraryRepairPromise = runTransaction("readwrite", function (store) {
      var request = store.openCursor();
      request.onsuccess = function () {
        var cursor = request.result;
        if (!cursor) return;
        var record = cursor.value;
        var invalidOnlineRecord = record && record.online
          && (record.previewFallback === true || record.fullMedia !== true || !(record.blob instanceof Blob));
        if (!record || !record.id || invalidOnlineRecord) cursor.delete();
        cursor.continue();
      };
    });
    return libraryRepairPromise;
  }

  function getLibrary(force) {
    if (libraryPromise && !force) return libraryPromise;
    libraryPromise = repairInstalledLibraryOnStartup().then(function () { return openDatabase(); }).then(function (db) {
      return new Promise(function (resolve, reject) {
        var transaction = db.transaction(STORE_NAME, "readonly");
        var request = transaction.objectStore(STORE_NAME).getAll();
        request.onsuccess = function () {
          library = (request.result || []).filter(function (item) {
            return !item.online || (item.previewFallback !== true && item.fullMedia === true && item.blob instanceof Blob);
          }).sort(function (a, b) { return b.createdAt - a.createdAt; });
          db.close();
          resolve(library.slice());
        };
        request.onerror = function () {
          db.close();
          reject(request.error || new Error("Could not read the wallpaper library."));
        };
      });
    });
    return libraryPromise;
  }

  function getBundledLibrary(force) {
    if (bundledPromise && !force) return bundledPromise;
    bundledPromise = fetch("./wallpaper-full-media.json", { cache: "no-cache" }).then(function (response) {
      if (!response.ok) throw new Error("Could not load the full-resolution wallpaper catalog.");
      return response.text();
    }).then(function (source) {
      var manifest = JSON.parse(source.replace(/^\uFEFF/, ""));
      bundledLibrary = (Array.isArray(manifest.projects) ? manifest.projects : []).filter(function (project) {
        // Remote web/YouTube scenes may fetch scripts, APIs, or media. The local
        // build admits only web scenes explicitly audited as offline-safe.
        if (window.NEO_LOCAL_CONFIG && window.NEO_LOCAL_CONFIG.enabled && project) {
          if (project.mediaType === "youtube") return false;
          if (project.mediaType === "web" && project.offlineSafe !== true) return false;
        }
        if (!project || Number(project.width) < 1920 || Number(project.height) < 1080) return false;
        if (project.mediaType === "image") return /^\.\/assets\/wallpaper-engine-full\/.+\.(png|jpe?g|webp)$/i.test(String(project.file || ""));
        if (project.mediaType === "video") return /^\.\/assets\/wallpaper-engine-full\/.+\.(mp4|webm)$/i.test(String(project.file || ""));
        if (project.mediaType === "animated-image") return /^\.\/assets\/wallpaper-engine-full\/.+\.gif$/i.test(String(project.file || ""));
        if (project.mediaType === "youtube") return /^[A-Za-z0-9_-]{11}$/.test(String(project.videoId || ""));
        return project.mediaType === "web" && /^\.\/assets\/wallpaper-engine-web\/[A-Za-z0-9_-]+\/.+\.html?(?:\?[^#]*)?$/i.test(String(project.file || ""));
      }).map(function (project, index) {
        var mediaType = String(project.mediaType || "video");
        return {
          id: String(project.id || "we-full-project-" + index),
          name: String(project.title || "Untitled wallpaper"),
          type: mediaType === "web" ? "web" : (mediaType === "youtube" ? "youtube" : (mediaType === "animated-image" ? "animated-image" : (mediaType === "image" ? "image" : "video"))),
          mediaType: mediaType,
          sourceType: String(project.type || "scene"),
          author: String(project.author || (project.sourceId ? "Steam Workshop" : "Wallpaper Engine")),
          preview: String(project.preview || ""),
          file: String(project.file || ""),
          mime: mediaType === "web" || mediaType === "youtube" ? "text/html" : (mediaType === "animated-image" ? "image/gif" : (mediaType === "image" ? (/\.png$/i.test(String(project.file || "")) ? "image/png" : (/\.webp$/i.test(String(project.file || "")) ? "image/webp" : "image/jpeg")) : (/\.webm$/i.test(String(project.file || "")) ? "video/webm" : "video/mp4"))),
          videoId: String(project.videoId || ""),
          size: Number(project.bytes) || 0,
          width: Number(project.width) || 0,
          height: Number(project.height) || 0,
          fps: String(project.fps || ""),
          duration: Number(project.duration) || 0,
          quality: String(project.quality || "1080p"),
          sourceId: String(project.sourceId || ""),
          offlineSafe: project.offlineSafe === true,
          createdAt: 0,
          bundled: true,
          fullMedia: true
        };
      });
      if (!bundledLibrary.length) throw new Error("No verified 1080p animated wallpapers are installed.");
      return bundledLibrary.slice();
    }).catch(function (error) {
      bundledLibrary = [];
      throw error;
    });
    return bundledPromise;
  }

  function getAvailableLibraries() {
    return Promise.all([
      getBundledLibrary().catch(function () { return []; }),
      getLibrary()
    ]);
  }

  function emit(reason) {
    var state = getState();
    state.reason = reason || "update";
    listeners.slice().forEach(function (listener) {
      try { listener(state); } catch (error) {}
    });
  }

  function uniqueId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") return "local-" + window.crypto.randomUUID();
    return "local-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 9);
  }

  function cleanName(name) {
    var base = String(name || "My wallpaper").replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
    return base.slice(0, 80) || "My wallpaper";
  }

  function onlineId(id) {
    var sourceId = String(id || "").replace(/^steam-/, "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80);
    return sourceId ? "steam-" + sourceId : "";
  }

  function readableSize(bytes) {
    if (bytes < 1024 * 1024) return Math.max(1, Math.round(bytes / 1024)) + " KB";
    return (bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0) + " MB";
  }

  function isAnimatedPreview(record) {
    return Boolean(record && record.previewFallback && record.animatedPreview !== false && String(record.mime || "").toLowerCase() === "image/gif");
  }

  function qualityLabel(record) {
    if (isAnimatedPreview(record)) return "GIF";
    if (record && record.previewFallback) return "PREVIEW";
    if (record && (record.type === "web" || record.type === "youtube")) return "LIVE";
    return Number(record && record.width) >= 3840 && Number(record && record.height) >= 2160 ? "4K" : "1080P";
  }

  function drawThumbnail(source, sourceWidth, sourceHeight) {
    var canvas = document.createElement("canvas");
    canvas.width = 480;
    canvas.height = 270;
    var context = canvas.getContext("2d", { alpha: false });
    if (!context) return Promise.resolve(null);
    var scale = Math.max(canvas.width / sourceWidth, canvas.height / sourceHeight);
    var width = sourceWidth * scale;
    var height = sourceHeight * scale;
    context.fillStyle = "#090b0e";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(source, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
    return new Promise(function (resolve) {
      canvas.toBlob(function (blob) { resolve(blob || null); }, "image/webp", 0.78);
    });
  }

  function imageThumbnail(file) {
    if (window.createImageBitmap) {
      return createImageBitmap(file).then(function (bitmap) {
        return drawThumbnail(bitmap, bitmap.width, bitmap.height).then(function (blob) {
          if (typeof bitmap.close === "function") bitmap.close();
          return blob;
        });
      }).catch(function () { return null; });
    }
    return new Promise(function (resolve) {
      var image = new Image();
      var url = URL.createObjectURL(file);
      image.onload = function () {
        drawThumbnail(image, image.naturalWidth, image.naturalHeight).then(function (blob) {
          URL.revokeObjectURL(url);
          resolve(blob);
        });
      };
      image.onerror = function () { URL.revokeObjectURL(url); resolve(null); };
      image.src = url;
    });
  }

  function videoThumbnail(file) {
    return new Promise(function (resolve) {
      var video = document.createElement("video");
      var url = URL.createObjectURL(file);
      var finished = false;
      var timeout = window.setTimeout(function () { finish(null); }, 7000);
      function finish(blob) {
        if (finished) return;
        finished = true;
        window.clearTimeout(timeout);
        video.removeAttribute("src");
        video.load();
        URL.revokeObjectURL(url);
        resolve(blob || null);
      }
      video.muted = true;
      video.preload = "metadata";
      video.playsInline = true;
      video.onloadedmetadata = function () {
        video.currentTime = Math.min(Math.max(video.duration * 0.08, 0.05), 1.5);
      };
      video.onseeked = function () {
        drawThumbnail(video, video.videoWidth || 16, video.videoHeight || 9).then(finish);
      };
      video.onerror = function () { finish(null); };
      video.src = url;
      video.load();
    });
  }

  function encodeImportedImage(source, sourceWidth, sourceHeight) {
    var maxDimension = 8192;
    var maxPixels = 33177600;
    var scale = Math.min(
      1,
      maxDimension / Math.max(sourceWidth, sourceHeight),
      Math.sqrt(maxPixels / Math.max(1, sourceWidth * sourceHeight))
    );
    var width = Math.max(1, Math.round(sourceWidth * scale));
    var height = Math.max(1, Math.round(sourceHeight * scale));
    var canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    var context = canvas.getContext("2d", { alpha: true });
    if (!context) return Promise.reject(new Error("Chrome could not prepare this picture."));
    context.drawImage(source, 0, 0, width, height);
    return Promise.all([
      new Promise(function (resolve) {
        canvas.toBlob(function (blob) { resolve(blob || null); }, "image/webp", 0.95);
      }),
      drawThumbnail(source, sourceWidth, sourceHeight)
    ]).then(function (results) {
      if (!results[0]) throw new Error("Chrome could not convert this picture into a wallpaper.");
      return { blob: results[0], thumbnail: results[1], width: width, height: height };
    });
  }

  function prepareImportedImage(file) {
    if (window.createImageBitmap) {
      return createImageBitmap(file, { imageOrientation: "from-image" }).then(function (bitmap) {
        return encodeImportedImage(bitmap, bitmap.width, bitmap.height).then(function (prepared) {
          if (typeof bitmap.close === "function") bitmap.close();
          return prepared;
        }, function (error) {
          if (typeof bitmap.close === "function") bitmap.close();
          throw error;
        });
      }).catch(function () {
        throw new Error("Chrome could not decode this picture. Try exporting it as PNG, JPG, or WebP.");
      });
    }
    return new Promise(function (resolve, reject) {
      var image = new Image();
      var url = URL.createObjectURL(file);
      image.onload = function () {
        encodeImportedImage(image, image.naturalWidth, image.naturalHeight).then(resolve, reject).then(function () {
          URL.revokeObjectURL(url);
        });
      };
      image.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error("Chrome could not decode this picture. Try exporting it as PNG, JPG, or WebP."));
      };
      image.src = url;
    });
  }

  function readBlobAsDataUrl(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(typeof reader.result === "string" ? reader.result : ""); };
      reader.onerror = function () { reject(reader.error || new Error("Could not read the wallpaper file.")); };
      reader.readAsDataURL(blob);
    });
  }

  function storeRecord(record) {
    return runTransaction("readwrite", function (store) { store.put(record); }).then(function () {
      return acceptStoredRecord(record);
    });
  }

  function acceptStoredRecord(record) {
    if (!record || !record.id) return Promise.reject(new Error("The wallpaper record is invalid."));
    if (assetUrls.has(record.id)) URL.revokeObjectURL(assetUrls.get(record.id));
    if (previewUrls.has(record.id)) URL.revokeObjectURL(previewUrls.get(record.id));
    assetUrls.delete(record.id);
    previewUrls.delete(record.id);
    library = [record].concat(library.filter(function (item) { return item.id !== record.id; }));
    libraryPromise = Promise.resolve(library.slice());
    emit("library");
    return Promise.resolve(record);
  }

  function importFile(file) {
    if (!(file instanceof Blob) || !SUPPORTED_TYPES.test(file.type || "")) {
      return Promise.reject(new Error("Choose a PNG, JPG, WebP, GIF, MP4, or WebM file."));
    }
    if (file.size > MAX_FILE_SIZE) return Promise.reject(new Error("Wallpaper files must be under 160 MB."));
    var type = file.type.indexOf("video/") === 0 ? "video" : (file.type === "image/gif" ? "animated-image" : "image");
    var mediaPromise = type === "image"
      ? prepareImportedImage(file)
      : (type === "video" ? videoThumbnail(file) : imageThumbnail(file)).then(function (thumbnail) {
        return { blob: file, thumbnail: thumbnail, width: 0, height: 0 };
      });
    return mediaPromise.then(function (prepared) {
      var record = {
        id: uniqueId(),
        name: cleanName(file.name),
        type: type,
        mime: prepared.blob.type || file.type,
        size: prepared.blob.size,
        sourceSize: file.size,
        width: prepared.width || 0,
        height: prepared.height || 0,
        createdAt: Date.now(),
        blob: prepared.blob,
        thumbnail: prepared.thumbnail,
        fullMedia: true,
        previewFallback: false,
        sourceType: type
      };
      return storeRecord(record);
    });
  }

  function installOnline(item) {
    item = item || {};
    var id = onlineId(item.id);
    if (!id) return Promise.reject(new Error("This wallpaper is missing a valid Workshop ID."));
    return getAvailableLibraries().then(function () {
      var record = recordFor(id);
      if (record && (record.fullMedia || record.previewFallback)) return { record: record, added: false };
      throw new Error("This Workshop item has not been saved for web use yet.");
    });
  }

  function remove(id) {
    if (!isLocal(id)) return Promise.reject(new Error("Built-in wallpapers cannot be removed."));
    return runTransaction("readwrite", function (store) { store.delete(id); }).then(function () {
      if (assetUrls.has(id)) URL.revokeObjectURL(assetUrls.get(id));
      if (previewUrls.has(id)) URL.revokeObjectURL(previewUrls.get(id));
      assetUrls.delete(id);
      previewUrls.delete(id);
      library = library.filter(function (item) { return item.id !== id; });
      libraryPromise = Promise.resolve(library.slice());
      if (activeId === id) clearMedia("removed");
      emit("library");
    });
  }

  function sourceIdFor(value) {
    var source = value && typeof value === "object" ? (value.sourceId || value.id) : value;
    return String(source || "").replace(/^(?:we-)?steam-/, "");
  }

  function bundledFor(value) {
    var id = String(value && typeof value === "object" ? value.id : value || "");
    return bundledLibrary.find(function (item) {
      return item.id === id || (item.sourceId && item.sourceId === sourceIdFor(value));
    }) || null;
  }

  function builtInCanvasFor(value) {
    var id = String(value && typeof value === "object" ? value.id : value || "");
    return BUILT_IN_CANVAS_WALLPAPERS.find(function (item) { return item.id === id; }) || null;
  }

  function recordFor(id) {
    var value = String(id || "");
    var builtIn = builtInCanvasFor(value);
    if (builtIn) return builtIn;
    var local = library.find(function (item) { return item.id === value; });
    if (hasUsableFullMedia(local)) return local;
    return bundledFor(value) || null;
  }

  function hasUsableFullMedia(record) {
    if (!record || record.previewFallback === true) return false;
    if (record.fullMedia === true) return true;
    // Imports created before fullMedia was recorded are still valid. Keep them
    // visible and usable instead of making the user's saved wallpaper vanish.
    return !record.online && isLocal(record.id) && record.blob instanceof Blob;
  }

  function visibleLibrary() {
    var records = BUILT_IN_CANVAS_WALLPAPERS.concat(bundledLibrary);
    library.forEach(function (item) {
      var bundled = bundledFor(item);
      if (bundled) {
        if (hasUsableFullMedia(item)) records[records.indexOf(bundled)] = item;
        return;
      }
      if (hasUsableFullMedia(item) && !records.some(function (record) { return record.id === item.id; })) records.push(item);
    });
    return records;
  }

  function urlFor(record, preview) {
    if (!record) return "";
    if (record.builtIn) return "";
    if (record.bundled) return preview ? record.preview : record.file;
    var map = preview ? previewUrls : assetUrls;
    if (map.has(record.id)) return map.get(record.id);
    var source = preview && record.thumbnail ? record.thumbnail : record.blob;
    if (!source) return "";
    var url = URL.createObjectURL(source);
    map.set(record.id, url);
    return url;
  }

  function isLocal(id) {
    var value = String(id || "");
    return value.indexOf("local-") === 0 || value.indexOf("steam-") === 0 || value.indexOf("commons-") === 0;
  }

  function isBundled(id) {
    var value = String(id || "");
    return value.indexOf("we-") === 0 || Boolean(builtInCanvasFor(value)) || Boolean(bundledFor(value));
  }

  function finiteMediaNumber(value) {
    var number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : 0;
  }

  function handleReactiveMediaState(event) {
    var detail = event && event.detail || {};
    var source = String(detail.source || "media");
    if (detail.active === false) {
      if (reactiveAudioState.source !== source) return;
      reactiveAudioState.active = false;
      reactiveAudioState.playing = false;
      reactiveAudioState.cover = "";
      reactiveAudioState.coverReady = false;
      reactiveAudioState.coverRevision += 1;
      reactiveAudioState.position = 0;
      reactiveAudioState.duration = 0;
      reactiveAudioState.stateAt = Date.now();
      reactiveAudioState.levels.fill(0);
      reactiveAudioState.levelsAt = 0;
      syncReactiveCoverElement();
      return;
    }
    if (detail.kind !== "audio" || !String(detail.title || "").trim()) return;
    reactiveAudioState.source = source;
    reactiveAudioState.active = true;
    reactiveAudioState.playing = detail.playing === true;
    reactiveAudioState.title = String(detail.title || "").trim().slice(0, 120);
    var nextCover = safeReactiveCover(detail.cover);
    if (nextCover !== reactiveAudioState.cover) {
      reactiveAudioState.cover = nextCover;
      reactiveAudioState.coverReady = false;
      reactiveAudioState.coverRevision += 1;
      syncReactiveCoverElement();
    }
    reactiveAudioState.position = finiteMediaNumber(detail.position);
    reactiveAudioState.duration = finiteMediaNumber(detail.duration);
    reactiveAudioState.stateAt = Date.now();
  }

  function handleReactiveMediaLevels(event) {
    var detail = event && event.detail || {};
    if (!reactiveAudioState.active || String(detail.source || "") !== reactiveAudioState.source) return;
    var levels = Array.from(detail.levels || []).slice(0, 8).map(function (value) {
      return Math.max(0, Math.min(1, Number(value) || 0));
    });
    if (levels.length !== 8) return;
    reactiveAudioState.levels = levels;
    reactiveAudioState.levelsAt = Date.now();
  }

  function ensureLayer() {
    if (!mediaLayer || !mediaLayer.isConnected) {
      if (!host) host = document.querySelector(".wallpaper");
      if (!host) return null;
      mediaLayer = host.querySelector("#wallpaper-media");
      if (!mediaLayer) {
        mediaLayer = document.createElement("div");
        mediaLayer.id = "wallpaper-media";
        mediaLayer.className = "wallpaper-media";
        mediaLayer.setAttribute("aria-hidden", "true");
        host.prepend(mediaLayer);
      }
    }
    if (!loadingElement || !loadingElement.isConnected) {
      loadingElement = host && host.querySelector("[data-wallpaper-loading]");
    }
    mediaLayer.style.position = "absolute";
    mediaLayer.style.inset = "0";
    mediaLayer.style.width = "100%";
    mediaLayer.style.height = "100%";
    mediaLayer.style.overflow = "hidden";
    return mediaLayer;
  }

  function setLoadingScreen(visible) {
    ensureLayer();
    var show = Boolean(visible && activeRecord && (activeRecord.type === "video" || activeRecord.type === "youtube"));
    root.dataset.wallpaperLoading = show ? "true" : "false";
    if (loadingElement) loadingElement.classList.toggle("is-visible", show);
    if (!show) {
      if (loadingScreenTimer) window.clearTimeout(loadingScreenTimer);
      loadingScreenTimer = 0;
      return;
    }
    if (loadingScreenTimer) return;
    loadingScreenTimer = window.setTimeout(function () {
      loadingScreenTimer = 0;
      if (root.dataset.wallpaperLoading !== "true") return;
      root.dataset.wallpaperLoading = "false";
      if (loadingElement) loadingElement.classList.remove("is-visible");
      if (activeRecord && activeRecord.type === "video" && activeMedia && activeMedia.tagName === "VIDEO" && root.dataset.wallpaperPlayback === "loading") {
        var hasFrame = activeMedia.readyState >= 2 && activeMedia.videoWidth && activeMedia.videoHeight;
        root.dataset.wallpaperPlayback = shouldPause()
          ? "paused"
          : hasFrame && !activeMedia.paused
            ? "playing"
            : activeRecord.preview
              ? "fallback"
              : "blocked";
        emit("loading-timeout");
      }
    }, WALLPAPER_LOADING_LIMIT);
  }

  function enforceFullBleed(media, fit) {
    if (!media) return;
    var cleanYouTubeFrame = media.tagName === "IFRAME"
      && media.classList.contains("wallpaper-youtube-asset");
    media.style.position = "absolute";
    media.style.inset = cleanYouTubeFrame ? "-" + YOUTUBE_CHROME_CROP + "px 0" : "0";
    media.style.width = "100%";
    media.style.height = cleanYouTubeFrame
      ? "calc(100% + " + (YOUTUBE_CHROME_CROP * 2) + "px)"
      : "100%";
    media.style.minWidth = "0";
    media.style.minHeight = "0";
    media.style.maxWidth = "none";
    media.style.maxHeight = "none";
    media.style.display = "block";
    media.style.margin = "0";
    media.style.pointerEvents = "none";
    if (media.tagName !== "IFRAME") {
      media.style.objectFit = /^(cover|contain|fill|none|scale-down)$/.test(fit) ? fit : "cover";
      media.style.objectPosition = "center";
    }
  }

  function stopCanvas() {
    if (canvasFrame) cancelAnimationFrame(canvasFrame);
    canvasFrame = 0;
    canvasResume = null;
    if (canvasCleanup) {
      canvasCleanup();
      canvasCleanup = null;
    }
  }

  function stopPlaybackWatch() {
    if (playbackWatch) window.clearInterval(playbackWatch);
    playbackWatch = 0;
  }

  function stopWebFallback() {
    if (webFallbackFrame) cancelAnimationFrame(webFallbackFrame);
    webFallbackFrame = 0;
    webFallbackResume = null;
    if (webFallbackCleanup) webFallbackCleanup();
    webFallbackCleanup = null;
    if (mediaLayer) {
      var fallback = mediaLayer.querySelector(".wallpaper-web-motion-fallback");
      if (fallback) fallback.remove();
    }
  }

  function stopWebHealthWatch() {
    if (webHealthWatch) window.clearInterval(webHealthWatch);
    webHealthWatch = 0;
    webHealth = null;
    delete root.dataset.wallpaperWebAnimation;
    stopWebFallback();
  }

  function releaseMediaElement(media) {
    if (!media) return;
    if (media.tagName === "VIDEO") {
      media.pause();
      media.removeAttribute("src");
      media.load();
    }
    if (media.tagName === "IFRAME") {
      if (window.NEOFrameLoader) window.NEOFrameLoader.cancel(media);
      media.removeAttribute("srcdoc");
      media.src = "about:blank";
    }
    media.remove();
  }

  function cancelPending(reason) {
    if (cancelPendingMedia) cancelPendingMedia(reason || "A newer wallpaper was selected.");
  }

  function clearMedia(reason) {
    cancelPending("Wallpaper loading was cancelled.");
    stopCanvas();
    stopPlaybackWatch();
    stopWebHealthWatch();
    clearAnimatedImageFreeze();
    releaseMediaElement(activeMedia);
    activeMedia = null;
    activeRecord = null;
    if (mediaLayer) mediaLayer.replaceChildren();
    if (mediaLayer) mediaLayer.style.backgroundImage = "";
    if (mediaLayer) mediaLayer.style.backgroundColor = "";
    root.dataset.wallpaperMedia = "false";
    root.dataset.wallpaperPlayback = "idle";
    setLoadingScreen(false);
    suspendedKey = "";
    if (reason !== "switch") activeId = "";
  }

  function reducedMotion() {
    return runtimeSettings.reduceMotion || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function performanceMode() {
    return runtimeSettings.performanceMode === "ultimate"
      ? "ultimate"
      : runtimeSettings.performanceMode === "performance"
        ? "performance"
        : "normal";
  }

  function performanceActive() {
    return performanceMode() !== "normal";
  }

  function shouldPause() {
    var lowBattery = Boolean(runtimeSettings.batterySaver && battery && !battery.charging);
    return performanceActive() || document.hidden || mediaPriorityPaused || autoPerformancePaused || runtimeSettings.wallpaperPaused || stabilityPaused || !runtimeSettings.motion || reducedMotion() || lowBattery;
  }

  function stopStabilityWatch() {
    if (stabilityWatch) window.clearTimeout(stabilityWatch);
    if (stabilityRecovery) window.clearTimeout(stabilityRecovery);
    stabilityWatch = 0;
    stabilityRecovery = 0;
    stabilityExpected = 0;
    stabilityStallScore = 0;
  }

  function releaseStabilityPause() {
    stabilityRecovery = 0;
    if (!stabilityPaused) return;
    stabilityPaused = false;
    stabilityStallScore = 0;
    root.dataset.wallpaperStability = "stable";
    syncPlayback();
    emit("stability-resume");
  }

  function startStabilityWatch() {
    if (stabilityWatch) return;
    stabilityExpected = performance.now() + 1000;
    function check(now) {
      stabilityWatch = 0;
      var drift = Math.max(0, now - stabilityExpected);
      stabilityExpected = now + 1000;
      var animated = activeMedia && (activeMedia.tagName === "IFRAME" || activeMedia.tagName === "VIDEO" || activeMedia.tagName === "CANVAS");
      if (!document.hidden && animated && !stabilityPaused && !autoPerformancePaused && !mediaPriorityPaused) {
        if (drift >= 5000) stabilityStallScore = 0;
        else if (drift >= 1000) stabilityStallScore += 2;
        else if (drift >= 450) stabilityStallScore += 1;
        else if (drift >= 180) stabilityStallScore += 1;
        else stabilityStallScore = Math.max(0, stabilityStallScore - 1);
        if (stabilityStallScore >= 2) {
          stabilityPaused = true;
          root.dataset.wallpaperStability = "recovering";
          syncPlayback();
          emit("stability-backoff");
          if (stabilityRecovery) window.clearTimeout(stabilityRecovery);
          stabilityRecovery = window.setTimeout(releaseStabilityPause, 2500);
        }
      } else if (!stabilityPaused) {
        stabilityStallScore = 0;
      }
      stabilityWatch = window.setTimeout(function () { check(performance.now()); }, 1000);
    }
    stabilityWatch = window.setTimeout(function () { check(performance.now()); }, 1000);
  }

  function resumePlayback() {
    var recoveredFromStabilityPause = false;
    if (!document.hidden) {
      if (stabilityRecovery) window.clearTimeout(stabilityRecovery);
      stabilityRecovery = 0;
      recoveredFromStabilityPause = stabilityPaused;
      stabilityPaused = false;
      stabilityStallScore = 0;
      stabilityExpected = performance.now() + 1000;
      root.dataset.wallpaperStability = "stable";
    }
    syncPlayback();
    window.setTimeout(syncPlayback, 180);
    if (!document.hidden) {
      window.setTimeout(syncPlayback, 800);
      window.setTimeout(syncPlayback, 2000);
    }
    if (recoveredFromStabilityPause) emit("stability-resume");
  }

  function clearAnimatedImageFreeze() {
    if (animatedImageFreeze) animatedImageFreeze.remove();
    animatedImageFreeze = null;
    if (activeMedia && activeMedia.tagName === "IMG") activeMedia.style.visibility = "";
  }

  function drawFittedImage(context, image, width, height, fit) {
    var imageWidth = image.naturalWidth || image.width;
    var imageHeight = image.naturalHeight || image.height;
    if (!imageWidth || !imageHeight) return false;
    var drawWidth = width;
    var drawHeight = height;
    if (fit !== "fill") {
      var containScale = Math.min(width / imageWidth, height / imageHeight);
      var scale = fit === "cover"
        ? Math.max(width / imageWidth, height / imageHeight)
        : fit === "none"
          ? 1
          : fit === "scale-down"
            ? Math.min(1, containScale)
            : containScale;
      drawWidth = imageWidth * scale;
      drawHeight = imageHeight * scale;
    }
    context.clearRect(0, 0, width, height);
    context.drawImage(image, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
    return true;
  }

  function mountPerformanceStill(id, record, sequence) {
    var layer = ensureLayer();
    if (!layer || sequence !== applySequence) return Promise.resolve();
    clearMedia("switch");
    activeId = String(id || "");
    activeRecord = record || null;
    suspendedKey = activeId + "|" + performanceMode() + (performanceMode() === "performance" ? "|" + (runtimeSettings.wallpaperFit || "cover") : "");
    root.dataset.wallpaperPlayback = "paused";

    if (performanceMode() === "ultimate") {
      layer.style.backgroundImage = "";
      root.dataset.wallpaperMedia = "false";
      emit("performance-unmount");
      return Promise.resolve();
    }

    root.dataset.wallpaperMedia = "true";
    var source = record ? (urlFor(record, true) || record.preview || "") : "";
    if (record && record.type === "youtube" && /^https?:\/\//i.test(source)) {
      layer.style.backgroundImage = 'url("' + source.replace(/"/g, "%22") + '")';
      layer.style.backgroundPosition = "center";
      layer.style.backgroundSize = "cover";
      emit("performance-still");
      return Promise.resolve();
    }

    var canvas = document.createElement("canvas");
    canvas.className = "wallpaper-media-asset wallpaper-performance-still";
    canvas.dataset.performanceStill = "true";
    canvas.setAttribute("aria-hidden", "true");
    enforceFullBleed(canvas, runtimeSettings.wallpaperFit || "cover");
    layer.appendChild(canvas);
    activeMedia = canvas;
    var context = canvas.getContext("2d", { alpha: false });
    if (!context) {
      layer.style.backgroundColor = "#080a0d";
      emit("performance-still");
      return Promise.resolve();
    }
    var width = Math.max(1, layer.clientWidth || window.innerWidth);
    var height = Math.max(1, layer.clientHeight || window.innerHeight);
    var dpr = Math.min(window.devicePixelRatio || 1, 1);
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.fillStyle = "#080a0d";
    context.fillRect(0, 0, width, height);

    if (!source) {
      var gradient = context.createLinearGradient(0, 0, width, height);
      gradient.addColorStop(0, "#071013");
      gradient.addColorStop(1, "#050709");
      context.fillStyle = gradient;
      context.fillRect(0, 0, width, height);
      emit("performance-still");
      return Promise.resolve();
    }

    return new Promise(function (resolve) {
      var image = new Image();
      var settled = false;
      var timeout = window.setTimeout(finish, 3000);
      function finish() {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        image.onload = null;
        image.onerror = null;
        image.src = "";
        if (sequence === applySequence) emit("performance-still");
        resolve();
      }
      image.onload = function () {
        if (sequence === applySequence && activeMedia === canvas) {
          try { drawFittedImage(context, image, width, height, runtimeSettings.wallpaperFit || "cover"); } catch (_error) {}
        }
        finish();
      };
      image.onerror = finish;
      image.decoding = "async";
      image.src = source;
      if (image.complete) image.onload();
    });
  }

  function freezeAnimatedImage(image, fit) {
    if (animatedImageFreeze || !mediaLayer || !image.complete || !image.naturalWidth) return;
    var width = Math.max(1, mediaLayer.clientWidth || window.innerWidth);
    var height = Math.max(1, mediaLayer.clientHeight || window.innerHeight);
    var dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    var canvas = document.createElement("canvas");
    var context = canvas.getContext("2d", { alpha: false });
    if (!context) return;
    canvas.className = "wallpaper-media-asset wallpaper-animated-image-freeze";
    canvas.setAttribute("aria-hidden", "true");
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!drawFittedImage(context, image, width, height, fit)) return;
    enforceFullBleed(canvas, "fill");
    animatedImageFreeze = canvas;
    mediaLayer.appendChild(canvas);
    image.style.visibility = "hidden";
  }

  function watchVideo(video) {
    stopPlaybackWatch();
    var previousTime = -1;
    playbackWatch = window.setInterval(function () {
      if (activeMedia !== video) return stopPlaybackWatch();
      if (shouldPause() || document.hidden) {
        previousTime = video.currentTime;
        return;
      }
      var advancing = previousTime < 0 || Math.abs(video.currentTime - previousTime) > 0.01;
      previousTime = video.currentTime;
      if (video.paused || video.ended || (!advancing && video.readyState >= 2)) syncPlayback();
    }, 1500);
  }

  function startWebFallback(record, sequence) {
    if (webFallbackFrame || webFallbackResume || !mediaLayer || !activeMedia || activeMedia.tagName !== "IFRAME") return;
    var canvas = document.createElement("canvas");
    canvas.className = "wallpaper-web-motion-fallback";
    canvas.setAttribute("aria-hidden", "true");
    mediaLayer.appendChild(canvas);
    var context = canvas.getContext("2d", { alpha: true });
    var particles = Array.from({ length: 42 }, function (_, index) {
      return {
        x: (index * 0.61803398875) % 1,
        y: (index * 0.38196601125) % 1,
        size: 0.7 + (index % 5) * 0.34,
        speed: 0.000012 + (index % 7) * 0.0000025,
        phase: index * 0.73
      };
    });
    function resize() {
      var dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.max(1, Math.round(canvas.clientWidth * dpr));
      canvas.height = Math.max(1, Math.round(canvas.clientHeight * dpr));
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    var observer = window.ResizeObserver ? new ResizeObserver(resize) : null;
    if (observer) observer.observe(canvas);
    webFallbackCleanup = function () { if (observer) observer.disconnect(); };
    var last = 0;
    function draw(now) {
      if (sequence !== applySequence || !activeMedia || activeMedia.tagName !== "IFRAME" || !canvas.isConnected) return;
      if (shouldPause()) {
        webFallbackFrame = 0;
        root.dataset.wallpaperPlayback = "paused";
        return;
      }
      if (now - last >= 33) {
        last = now;
        var width = canvas.clientWidth;
        var height = canvas.clientHeight;
        context.clearRect(0, 0, width, height);
        particles.forEach(function (particle) {
          var x = particle.x * width + Math.sin(now * particle.speed + particle.phase) * 24;
          var y = (particle.y * height + now * particle.speed * 17) % Math.max(1, height);
          var alpha = 0.08 + (Math.sin(now * 0.001 + particle.phase) + 1) * 0.045;
          context.fillStyle = "rgba(255,255,255," + alpha.toFixed(3) + ")";
          context.beginPath();
          context.arc(x, y, particle.size, 0, Math.PI * 2);
          context.fill();
        });
      }
      webFallbackFrame = requestAnimationFrame(draw);
    }
    webFallbackResume = function () {
      if (!webFallbackFrame && canvas.isConnected && !shouldPause()) webFallbackFrame = requestAnimationFrame(draw);
    };
    root.dataset.wallpaperWebAnimation = "fallback";
    root.dataset.wallpaperPlayback = shouldPause() ? "paused" : "playing";
    webFallbackResume();
    emit("web-fallback");
  }

  function startWebHealthWatch(media, record, sequence) {
    stopWebHealthWatch();
    webHealth = {
      media: media,
      record: record,
      sequence: sequence,
      startedAt: Date.now(),
      lastReportAt: 0,
      lastActivityAt: 0,
      healthy: false,
      error: ""
    };
    root.dataset.wallpaperWebAnimation = "checking";
    webHealthWatch = window.setInterval(function () {
      if (!webHealth || activeMedia !== media || sequence !== applySequence) return stopWebHealthWatch();
      if (shouldPause()) return;
      var now = Date.now();
      var stalled = now - webHealth.startedAt > 5000 && (!webHealth.lastActivityAt || now - webHealth.lastActivityAt > 4500);
      if (stalled) startWebFallback(record, sequence);
    }, 1000);
  }

  function handleWebMessage(event) {
    if (activeRecord && activeRecord.type === "youtube" && activeMedia && activeMedia.tagName === "IFRAME" && event.source === activeMedia.contentWindow) {
      var youtubeData = event.data;
      if (typeof youtubeData === "string") {
        try { youtubeData = JSON.parse(youtubeData); } catch (_youtubeError) { youtubeData = null; }
      }
      if (youtubeData && youtubeData.event === "onStateChange") {
        var youtubeState = Number(youtubeData.info);
        if (youtubeState === 1) {
          activeMedia.dataset.youtubeHasPlayed = "true";
          activeMedia.dataset.youtubeCleanReveal = "ready";
          setLoadingScreen(false);
          syncPlayback();
          emit("playback");
        } else if ((youtubeState === -1 || youtubeState === 3 || youtubeState === 5) && activeMedia.dataset.youtubeHasPlayed !== "true") {
          setLoadingScreen(true);
          root.dataset.wallpaperPlayback = "loading";
          emit("loading");
        }
        return;
      }
    }
    if (!webHealth || !activeMedia || activeMedia.tagName !== "IFRAME" || event.source !== activeMedia.contentWindow) return;
    var data = event.data;
    if (!data || (data.type !== "neo-wallpaper-health" && data.type !== "neo-wallpaper-error")) return;
    webHealth.lastReportAt = Date.now();
    if (data.type === "neo-wallpaper-error") {
      webHealth.error = String(data.message || "Wallpaper script error");
      return;
    }
    if (data.activity) {
      webHealth.lastActivityAt = webHealth.lastReportAt;
      webHealth.healthy = true;
      root.dataset.wallpaperWebAnimation = "healthy";
      stopWebFallback();
      root.dataset.wallpaperPlayback = shouldPause() ? "paused" : "playing";
      if (!shouldPause() && mediaLayer) mediaLayer.style.backgroundImage = "";
      emit("web-health");
    }
  }

  function syncPlayback() {
    if (!activeMedia) return;
    var fit = /^(cover|contain|fill|none|scale-down)$/.test(runtimeSettings.wallpaperFit) ? runtimeSettings.wallpaperFit : "cover";
    enforceFullBleed(activeMedia, fit);
    if (activeMedia.tagName === "CANVAS") {
      var previewSource = mediaLayer && mediaLayer.querySelector(".wallpaper-preview-source");
      if (previewSource) enforceFullBleed(previewSource, fit);
      root.dataset.wallpaperPlayback = shouldPause() ? "paused" : "playing";
      if (!shouldPause() && canvasResume) canvasResume();
      emit("playback");
      return;
    }
    if (activeMedia.tagName === "IFRAME") {
      var paused = shouldPause();
      if (activeRecord && activeRecord.type === "youtube") {
        var waitingForCleanReveal = activeMedia.dataset.youtubeCleanReveal !== "ready";
        var showPreview = paused || document.hidden || waitingForCleanReveal;
        setLoadingScreen(waitingForCleanReveal && !document.hidden);
        activeMedia.style.visibility = showPreview ? "hidden" : "visible";
        if (mediaLayer) {
          mediaLayer.style.backgroundImage = showPreview && activeRecord.preview
            ? 'url("' + activeRecord.preview + '")'
            : "";
          mediaLayer.style.backgroundPosition = "center";
          mediaLayer.style.backgroundSize = "cover";
        }
        var volume = Math.max(0, Math.min(100, Number(runtimeSettings.wallpaperVolume || 0)));
        var muted = !audioUnlocked || runtimeSettings.wallpaperMuted !== false;
        postYouTubeCommand(activeMedia, "setVolume", [volume]);
        postYouTubeCommand(activeMedia, muted ? "mute" : "unMute");
        postYouTubeCommand(activeMedia, paused ? "pauseVideo" : "playVideo");
        root.dataset.wallpaperPlayback = paused ? "paused" : "playing";
        emit("playback");
        return;
      }
      var webMotionReady = Boolean(webHealth && (webHealth.healthy || webFallbackFrame));
      activeMedia.style.visibility = document.hidden ? "hidden" : "visible";
      root.dataset.wallpaperPlayback = paused ? "paused" : (webMotionReady ? "playing" : "loading");
      try { activeMedia.contentWindow.postMessage({ type: "neo-wallpaper-playback", paused: paused }, "*"); } catch (_error) {}
      if (!paused && webFallbackResume) webFallbackResume();
      emit("playback");
      return;
    }
    if (activeMedia.tagName === "IMG" && activeRecord && (activeRecord.type === "animated-image" || isAnimatedPreview(activeRecord))) {
      if (shouldPause()) freezeAnimatedImage(activeMedia, fit);
      else clearAnimatedImageFreeze();
      root.dataset.wallpaperPlayback = shouldPause() ? "paused" : "playing";
      emit("playback");
      return;
    }
    if (activeMedia.tagName === "VIDEO") {
      activeMedia.loop = runtimeSettings.wallpaperLoop !== false;
      activeMedia.muted = !audioUnlocked || runtimeSettings.wallpaperMuted !== false;
      activeMedia.volume = Math.max(0, Math.min(1, Number(runtimeSettings.wallpaperVolume || 0) / 100));
      activeMedia.playbackRate = Math.max(0.25, Math.min(2, Number(runtimeSettings.wallpaperSpeed || 1)));
      if (shouldPause()) {
        activeMedia.pause();
        setLoadingScreen(false);
        root.dataset.wallpaperPlayback = "paused";
        emit("playback");
      } else {
        var play = activeMedia.play();
        if (play && typeof play.catch === "function") {
          var requestedMedia = activeMedia;
          play.catch(function (error) {
            if (activeMedia !== requestedMedia || shouldPause()) return;
            if (error && error.name === "AbortError") {
              setLoadingScreen(false);
              root.dataset.wallpaperPlayback = "loading";
              emit("loading");
              return;
            }
            if (!requestedMedia.muted) {
              requestedMedia.muted = true;
              var mutedPlay = requestedMedia.play();
              if (mutedPlay && typeof mutedPlay.catch === "function") mutedPlay.catch(function () {
                if (activeMedia !== requestedMedia || shouldPause()) return;
                setLoadingScreen(false);
                root.dataset.wallpaperPlayback = "blocked";
                emit("blocked");
              });
              return;
            }
            setLoadingScreen(false);
            root.dataset.wallpaperPlayback = "blocked";
            emit("blocked");
          });
        }
      }
    }
  }

  function postYouTubeCommand(frame, command, args) {
    if (!frame || !frame.contentWindow) return;
    try {
      frame.contentWindow.postMessage(JSON.stringify({
        event: "command",
        func: command,
        args: Array.isArray(args) ? args : []
      }), "*");
    } catch (_error) {}
  }

  function youtubeEmbedUrl(record) {
    var videoId = String(record && record.videoId || "");
    if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) return "";
    return "https://www.youtube-nocookie.com/embed/" + videoId
      + "?autoplay=1&mute=1&controls=0&disablekb=1&enablejsapi=1&fs=0&iv_load_policy=3&loop=1&playlist="
      + encodeURIComponent(videoId) + "&playsinline=1&rel=0&cc_load_policy=0";
  }

  function mountYouTube(record, sequence, layer) {
    clearMedia("switch");
    activeId = record.id;
    activeRecord = record;
    root.dataset.wallpaperMedia = "true";
    root.dataset.wallpaperPlayback = "loading";
    setLoadingScreen(true);
    layer.style.backgroundImage = record.preview ? 'url("' + record.preview + '")' : "";
    layer.style.backgroundPosition = "center";
    layer.style.backgroundSize = "cover";
    var media = document.createElement("iframe");
    media.title = record.name + " animated YouTube wallpaper";
    media.setAttribute("allow", "autoplay; encrypted-media");
    media.setAttribute("aria-hidden", "true");
    media.setAttribute("inert", "");
    media.setAttribute("scrolling", "no");
    media.referrerPolicy = "strict-origin-when-cross-origin";
    media.tabIndex = -1;
    media.className = "wallpaper-media-asset wallpaper-youtube-asset";
    media.dataset.youtubeCleanReveal = "waiting";
    media.dataset.youtubeHasPlayed = "false";
    media.style.visibility = "hidden";
    enforceFullBleed(media, runtimeSettings.wallpaperFit || "cover");
    media.addEventListener("load", function () {
      if (sequence !== applySequence || activeMedia !== media) return;
      root.dataset.wallpaperPlayback = shouldPause() ? "paused" : "loading";
      try { media.contentWindow.postMessage(JSON.stringify({ event: "listening", id: "neo-wallpaper" }), "*"); } catch (_error) {}
      syncPlayback();
      window.setTimeout(function () {
        if (sequence !== applySequence || activeMedia !== media) return;
        try { media.contentWindow.postMessage(JSON.stringify({ event: "listening", id: "neo-wallpaper" }), "*"); } catch (_error) {}
      }, 350);
      window.setTimeout(syncPlayback, 500);
      window.setTimeout(function () {
        if (sequence !== applySequence || activeMedia !== media) return;
        media.dataset.youtubeCleanReveal = "ready";
        setLoadingScreen(false);
        syncPlayback();
        emit("ready");
      }, YOUTUBE_CLEAN_REVEAL_DELAY);
    });
    layer.appendChild(media);
    activeMedia = media;
    media.src = youtubeEmbedUrl(record);
    syncPlayback();
    emit("mount");
    return Promise.resolve();
  }

  var previewRuntimePromise = null;

  function ensurePreviewStyles() {
    if (document.querySelector('link[data-neo-preview-runtime]')) return;
    var style = document.createElement("link");
    style.rel = "stylesheet";
    style.href = "./neo-wallpaper-preview-runtime.css?v=20260805-wallpaper-playback-v1";
    style.dataset.neoPreviewRuntime = "true";
    document.head.appendChild(style);
  }

  function loadPreviewRuntime() {
    if (window.NEOWallpaperPreviewRuntime) return Promise.resolve(window.NEOWallpaperPreviewRuntime);
    if (previewRuntimePromise) return previewRuntimePromise;
    ensurePreviewStyles();
    previewRuntimePromise = new Promise(function (resolve, reject) {
      var script = document.createElement("script");
      script.src = "./neo-wallpaper-preview-runtime.js?v=20260805-wallpaper-playback-v1";
      script.async = true;
      script.onload = function () {
        if (window.NEOWallpaperPreviewRuntime) resolve(window.NEOWallpaperPreviewRuntime);
        else reject(new Error("The animated preview runtime did not start."));
      };
      script.onerror = function () { reject(new Error("The animated preview runtime could not be loaded.")); };
      document.head.appendChild(script);
    });
    return previewRuntimePromise;
  }

  function startPreviewCanvas(record, sequence) {
    var layer = ensureLayer();
    if (!layer || sequence !== applySequence) return;
    clearMedia("switch");
    activeId = record.id;
    activeRecord = record;
    root.dataset.wallpaperMedia = "true";
    root.dataset.wallpaperPlayback = "loading";
    var previewUrl = urlFor(record, false);
    layer.style.backgroundImage = previewUrl ? 'url("' + previewUrl + '")' : "";
    layer.style.backgroundPosition = "center";
    layer.style.backgroundSize = "cover";
    loadPreviewRuntime().then(function (runtime) {
      if (sequence !== applySequence || activeId !== record.id) return;
      var session = runtime.mount({
        layer: layer,
        record: record,
        sourceUrl: previewUrl,
        fit: runtimeSettings.wallpaperFit || "cover",
        shouldPause: shouldPause,
        onState: function (playback, reason) {
          if (sequence !== applySequence || activeId !== record.id) return;
          root.dataset.wallpaperPlayback = playback;
          emit(reason || "playback");
        }
      });
      if (!session || !session.canvas) throw new Error("The animated preview could not be created.");
      activeMedia = session.canvas;
      enforceFullBleed(activeMedia, runtimeSettings.wallpaperFit || "cover");
      canvasCleanup = session.destroy;
      syncPlayback();
      emit("mount");
    }).catch(function () {
      if (sequence !== applySequence || activeId !== record.id) return;
      root.dataset.wallpaperPlayback = previewUrl ? "ready" : "error";
      emit(previewUrl ? "fallback" : "error");
    });
  }

  function abortError(message) {
    var error = new Error(message || "Wallpaper loading was cancelled.");
    error.name = "AbortError";
    return error;
  }

  function prepareAssetMedia(record, sequence, layer) {
    var animatedImage = record.type === "animated-image" || isAnimatedPreview(record);
    var previewUrl = urlFor(record, true) || record.preview || "";
    var mediaUrl = urlFor(record, false);
    if (!mediaUrl) return Promise.reject(new Error("The saved wallpaper media is missing."));
    var media = record.type === "video" ? document.createElement("video") : document.createElement("img");
    media.className = "wallpaper-media-asset" + (animatedImage ? " wallpaper-animated-image-source" : "");
    media.style.opacity = "0";
    media.setAttribute("aria-hidden", "true");
    enforceFullBleed(media, runtimeSettings.wallpaperFit || "cover");
    if (media.tagName === "VIDEO") {
      media.autoplay = false;
      media.muted = true;
      media.loop = runtimeSettings.wallpaperLoop !== false;
      media.playsInline = true;
      media.preload = "auto";
      media.poster = previewUrl;
      media.width = record.width || 1920;
      media.height = record.height || 1080;
      media.disablePictureInPicture = true;
      media.playbackRate = Math.max(0.25, Math.min(2, Number(runtimeSettings.wallpaperSpeed || 1)));
    } else {
      media.alt = "";
      media.decoding = animatedImage ? "auto" : "async";
      media.draggable = false;
    }
    layer.appendChild(media);
    pendingMedia = media;
    return new Promise(function (resolve, reject) {
      var settled = false;
      var dataUrlRetry = false;
      var frameRequest = 0;
      var frameFallback = 0;
      var timeout = window.setTimeout(function () {
        finish(new Error("Chrome could not decode this wallpaper in time."));
      }, 15000);
      function cleanup() {
        window.clearTimeout(timeout);
        window.clearTimeout(frameFallback);
        media.removeEventListener("loadeddata", ready);
        media.removeEventListener("canplay", ready);
        media.removeEventListener("load", ready);
        media.removeEventListener("error", failed);
        if (frameRequest && media.cancelVideoFrameCallback) media.cancelVideoFrameCallback(frameRequest);
        if (pendingMedia === media) {
          pendingMedia = null;
          cancelPendingMedia = null;
        }
      }
      function finish(error) {
        if (settled) return;
        settled = true;
        cleanup();
        if (sequence !== applySequence && (!error || error.name !== "AbortError")) error = abortError();
        if (error) {
          releaseMediaElement(media);
          reject(error);
        } else resolve({ media: media, previewUrl: previewUrl, animatedImage: animatedImage });
      }
      function failed() {
        if (media.tagName === "IMG" && !dataUrlRetry && record.blob instanceof Blob) {
          dataUrlRetry = true;
          readBlobAsDataUrl(record.blob).then(function (dataUrl) {
            if (settled || sequence !== applySequence) return;
            if (!dataUrl) return finish(new Error("Chrome could not read this wallpaper file."));
            media.src = dataUrl;
            if (media.complete) ready();
          }).catch(function () {
            finish(new Error("Chrome could not decode this wallpaper file."));
          });
          return;
        }
        finish(new Error("Chrome could not decode this wallpaper file."));
      }
      function ready() {
        if (settled) return;
        if (sequence !== applySequence) return finish(abortError());
        if (media.tagName === "IMG") {
          if (media.naturalWidth && media.naturalHeight) finish();
          return;
        }
        if (media.readyState < 2 || !media.videoWidth || !media.videoHeight) return;
        if (shouldPause() || typeof media.requestVideoFrameCallback !== "function") return finish();
        var playback = media.play();
        Promise.resolve(playback).then(function () {
          if (settled) return;
          frameFallback = window.setTimeout(function () { finish(); }, 1200);
          frameRequest = media.requestVideoFrameCallback(function () { finish(); });
        }).catch(function () {
          // loadeddata already proves that Chrome decoded a displayable frame.
          finish();
        });
      }
      cancelPendingMedia = function (message) { finish(abortError(message)); };
      if (media.tagName === "VIDEO") {
        media.addEventListener("loadeddata", ready);
        media.addEventListener("canplay", ready);
      } else media.addEventListener("load", ready);
      media.addEventListener("error", failed);
      media.src = mediaUrl;
      if (media.tagName === "VIDEO") media.load();
      if ((media.tagName === "VIDEO" && media.readyState >= 2) || (media.tagName === "IMG" && media.complete)) ready();
    });
  }

  function commitPreparedMedia(record, sequence, prepared, layer) {
    if (sequence !== applySequence) {
      releaseMediaElement(prepared.media);
      throw abortError();
    }
    var media = prepared.media;
    media.remove();
    clearMedia("switch");
    activeId = record.id;
    activeRecord = record;
    root.dataset.wallpaperMedia = "true";
    root.dataset.wallpaperPlayback = "loading";
    // prepareAssetMedia only resolves after a displayable frame exists. Keep that
    // frame visible instead of covering it while autoplay finishes negotiating.
    setLoadingScreen(false);
    layer.style.backgroundImage = prepared.previewUrl ? 'url("' + prepared.previewUrl + '")' : "";
    layer.style.backgroundPosition = "center";
    layer.style.backgroundSize = "cover";
    media.style.opacity = "";
    layer.appendChild(media);
    activeMedia = media;
    if (media.tagName === "VIDEO") {
      function playing() {
        if (activeMedia !== media) return;
        if (shouldPause()) return syncPlayback();
        layer.style.backgroundImage = "";
        media.dataset.wallpaperStarted = "true";
        setLoadingScreen(false);
        root.dataset.wallpaperPlayback = "playing";
        emit("playback");
      }
      media.addEventListener("playing", playing);
      media.addEventListener("loadeddata", resumePlayback);
      media.addEventListener("canplay", resumePlayback);
      media.addEventListener("stalled", function () {
        if (activeMedia !== media) return;
        if (!shouldPause() && media.dataset.wallpaperStarted === "true") setLoadingScreen(true);
        else setLoadingScreen(false);
        root.dataset.wallpaperPlayback = "loading";
        emit("loading");
      });
      media.addEventListener("waiting", function () {
        if (activeMedia !== media || shouldPause()) return;
        setLoadingScreen(media.dataset.wallpaperStarted === "true");
        root.dataset.wallpaperPlayback = "loading";
        emit("loading");
      });
      media.addEventListener("pause", function () {
        if (activeMedia !== media) return;
        setLoadingScreen(false);
        root.dataset.wallpaperPlayback = "paused";
        emit("playback");
      });
      media.addEventListener("error", function () {
        if (activeMedia !== media) return;
        media.style.visibility = "hidden";
        setLoadingScreen(false);
        if (prepared.previewUrl) layer.style.backgroundImage = 'url("' + prepared.previewUrl + '")';
        root.dataset.wallpaperPlayback = prepared.previewUrl ? "fallback" : "error";
        emit("error");
      });
      watchVideo(media);
      syncPlayback();
      if (!shouldPause() && !media.paused && media.readyState >= 2) playing();
    } else {
      layer.style.backgroundImage = "";
      if (prepared.animatedImage) syncPlayback();
      else {
        root.dataset.wallpaperPlayback = "ready";
        emit("ready");
      }
    }
    emit("mount");
  }

  function mountRecord(record, sequence) {
    if (sequence !== applySequence || !record) return Promise.reject(abortError());
    var animatedPreview = isAnimatedPreview(record);
    if (record.previewFallback && !animatedPreview) {
      startPreviewCanvas(record, sequence);
      return Promise.resolve();
    }
    var layer = ensureLayer();
    if (!layer) return Promise.reject(new Error("The wallpaper surface is unavailable."));
    if (record.type === "youtube") return mountYouTube(record, sequence, layer);
    if (record.type !== "web") {
      return prepareAssetMedia(record, sequence, layer).then(function (prepared) {
        commitPreparedMedia(record, sequence, prepared, layer);
      });
    }
    clearMedia("switch");
    activeId = record.id;
    activeRecord = record;
    root.dataset.wallpaperMedia = "true";
    root.dataset.wallpaperPlayback = "loading";
    layer.style.backgroundImage = record.preview ? 'url("' + record.preview + '")' : "";
    layer.style.backgroundPosition = "center";
    layer.style.backgroundSize = "cover";
    var media = document.createElement("iframe");
    media.title = record.name + " animated wallpaper";
    media.setAttribute("sandbox", "allow-scripts allow-same-origin");
    media.setAttribute("allow", "autoplay");
    media.referrerPolicy = "no-referrer";
    media.tabIndex = -1;
    media.className = "wallpaper-media-asset";
    enforceFullBleed(media, runtimeSettings.wallpaperFit || "cover");
    media.addEventListener("load", function () { syncPlayback(); emit("ready"); });
    layer.appendChild(media);
    activeMedia = media;
    startWebHealthWatch(media, record, sequence);
    syncPlayback();
    emit("mount");
    var route = urlFor(record, false);
    var frameLoad = window.NEOFrameLoader
      ? window.NEOFrameLoader.load(media, route)
      : Promise.resolve().then(function () { media.src = route; });
    return frameLoad.catch(function (error) {
      if (sequence !== applySequence || activeMedia !== media || (error && error.name === "AbortError")) throw error;
      startPreviewCanvas(record, sequence);
      emit("fallback");
    });
  }

  function formatReactiveTime(seconds) {
    var value = Math.max(0, Math.floor(Number(seconds) || 0));
    var minutes = Math.floor(value / 60);
    var remainder = String(value % 60).padStart(2, "0");
    return minutes + ":" + remainder;
  }

  function startNeoReactiveCanvas(sequence, staticOnly) {
    var layer = ensureLayer();
    if (!layer || sequence !== applySequence) return;
    clearMedia("switch");
    activeId = "neo-reactive";
    activeRecord = builtInCanvasFor(activeId);
    if (staticOnly) suspendedKey = activeId + "|" + performanceMode() + "|" + (runtimeSettings.wallpaperFit || "cover");
    root.dataset.wallpaperMedia = "true";
    root.dataset.wallpaperPlayback = staticOnly || shouldPause() ? "paused" : "playing";

    var canvas = document.createElement("canvas");
    canvas.className = "wallpaper-media-asset wallpaper-neo-reactive-canvas";
    canvas.setAttribute("aria-hidden", "true");
    if (staticOnly) canvas.dataset.performanceStill = "true";
    var coverBackdrop = document.createElement("img");
    coverBackdrop.className = "wallpaper-neo-reactive-cover" + (staticOnly ? " is-static" : "");
    coverBackdrop.alt = "";
    coverBackdrop.decoding = "async";
    coverBackdrop.draggable = false;
    coverBackdrop.referrerPolicy = "no-referrer";
    coverBackdrop.setAttribute("aria-hidden", "true");
    layer.appendChild(coverBackdrop);
    reactiveCoverElement = coverBackdrop;
    syncReactiveCoverElement();

    enforceFullBleed(canvas, "cover");
    layer.appendChild(canvas);
    activeMedia = canvas;

    var context = canvas.getContext("2d", { alpha: true, desynchronized: true });
    if (!context) {
      layer.style.backgroundColor = "#030406";
      emit(staticOnly ? "performance-still" : "mount");
      return;
    }

    var refreshCoverFrame = function () {
      if (activeMedia === canvas && sequence === applySequence) drawFrame(performance.now());
    };
    reactiveCoverRefresh = refreshCoverFrame;

    var background = document.createElement("canvas");
    var backgroundContext = background.getContext("2d", { alpha: true });
    var logo = new Image();
    var logoReady = false;
    var smoothedEnergy = 0.08;
    var lowPowerDevice = Number(navigator.deviceMemory || 4) <= 4 || Number(navigator.hardwareConcurrency || 4) <= 4;
    var particleCount = lowPowerDevice || window.innerWidth < 720 ? 26 : 38;
    var palette = [0, 30, 56, 112, 174, 210, 258, 314];
    var coverRevision = -1;
    var bubbleSprites = palette.map(function (hue) {
      var sprite = document.createElement("canvas");
      sprite.width = 64;
      sprite.height = 64;
      var spriteContext = sprite.getContext("2d", { alpha: true });
      if (!spriteContext) return sprite;
      var glow = spriteContext.createRadialGradient(32, 32, 3, 32, 32, 30);
      glow.addColorStop(0, "hsla(" + hue + ",100%,72%,0.22)");
      glow.addColorStop(0.42, "hsla(" + hue + ",100%,58%,0.12)");
      glow.addColorStop(1, "hsla(" + hue + ",100%,48%,0)");
      spriteContext.fillStyle = glow;
      spriteContext.fillRect(0, 0, 64, 64);
      spriteContext.strokeStyle = "hsla(" + hue + ",100%,72%,0.82)";
      spriteContext.lineWidth = 3;
      spriteContext.beginPath();
      spriteContext.arc(32, 32, 12, 0, Math.PI * 2);
      spriteContext.stroke();
      return sprite;
    });
    var particles = Array.from({ length: particleCount }, function (_, index) {
      var seed = (index * 0.61803398875) % 1;
      return {
        x: (seed + (index % 5) * 0.083) % 1,
        y: (index * 0.38196601125) % 1,
        radius: 2.2 + (index % 6) * 1.35,
        speed: 0.000009 + (index % 7) * 0.000002,
        phase: index * 0.79,
        hue: palette[index % palette.length]
      };
    });

    function paintBackground(width, height, dpr) {
      background.width = Math.max(1, Math.round(width * dpr));
      background.height = Math.max(1, Math.round(height * dpr));
      if (!backgroundContext) return;
      backgroundContext.setTransform(dpr, 0, 0, dpr, 0, 0);
      backgroundContext.clearRect(0, 0, width, height);
      var coverDriven = Boolean(reactiveAudioState.cover && reactiveAudioState.coverReady);
      backgroundContext.fillStyle = coverDriven ? "rgba(2,3,5,0.66)" : "#020305";
      backgroundContext.fillRect(0, 0, width, height);
      palette.forEach(function (hue, index) {
        var angle = (index / palette.length) * Math.PI * 2 - Math.PI / 2;
        var x = width * 0.5 + Math.cos(angle) * width * 0.44;
        var y = height * 0.5 + Math.sin(angle) * height * 0.48;
        var radius = Math.max(width, height) * 0.36;
        var glow = backgroundContext.createRadialGradient(x, y, 0, x, y, radius);
        glow.addColorStop(0, "hsla(" + hue + ",100%,54%," + (coverDriven ? "0.032" : "0.115") + ")");
        glow.addColorStop(0.44, "hsla(" + hue + ",100%,48%," + (coverDriven ? "0.010" : "0.035") + ")");
        glow.addColorStop(1, "hsla(" + hue + ",100%,42%,0)");
        backgroundContext.fillStyle = glow;
        backgroundContext.fillRect(0, 0, width, height);
      });
      var vignette = backgroundContext.createRadialGradient(width * 0.5, height * 0.5, 0, width * 0.5, height * 0.5, Math.max(width, height) * 0.72);
      vignette.addColorStop(0, "rgba(0,0,0,0)");
      vignette.addColorStop(0.72, "rgba(0,0,0,0.12)");
      vignette.addColorStop(1, "rgba(0,0,0,0.72)");
      backgroundContext.fillStyle = vignette;
      backgroundContext.fillRect(0, 0, width, height);
    }

    function resize() {
      if (activeMedia !== canvas || sequence !== applySequence) return;
      var width = Math.max(1, layer.clientWidth || window.innerWidth);
      var height = Math.max(1, layer.clientHeight || window.innerHeight);
      var dprCap = lowPowerDevice || width < 720 ? 1 : 1.35;
      var dpr = Math.min(window.devicePixelRatio || 1, dprCap);
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      canvas.dataset.dpr = String(dpr);
      canvas.dataset.cssWidth = String(width);
      canvas.dataset.cssHeight = String(height);
      coverRevision = reactiveAudioState.coverRevision;
      paintBackground(width, height, dpr);
    }

    function currentPlaybackPosition() {
      var position = reactiveAudioState.position;
      if (reactiveAudioState.active && reactiveAudioState.playing && reactiveAudioState.stateAt) {
        position += Math.max(0, (Date.now() - reactiveAudioState.stateAt) / 1000);
      }
      if (reactiveAudioState.duration > 0) position = Math.min(position, reactiveAudioState.duration);
      return position;
    }

    function targetEnergy(now) {
      if (!reactiveAudioState.active || !reactiveAudioState.playing) return 0.055;
      var freshLevels = Date.now() - reactiveAudioState.levelsAt < 850;
      if (freshLevels) {
        var average = reactiveAudioState.levels.reduce(function (sum, value) { return sum + value; }, 0) / 8;
        var peak = Math.max.apply(Math, reactiveAudioState.levels);
        return Math.max(0.09, Math.min(1, average * 0.72 + peak * 0.42));
      }
      var beat = Math.pow(Math.max(0, Math.sin(now * 0.0042)), 5);
      return 0.13 + beat * 0.22;
    }

    function drawFrame(now) {
      var dpr = Number(canvas.dataset.dpr || 1);
      var width = Number(canvas.dataset.cssWidth || layer.clientWidth || window.innerWidth);
      var height = Number(canvas.dataset.cssHeight || layer.clientHeight || window.innerHeight);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (coverRevision !== reactiveAudioState.coverRevision) {
        coverRevision = reactiveAudioState.coverRevision;
        paintBackground(width, height, dpr);
      }
      context.globalCompositeOperation = "source-over";
      context.globalAlpha = 1;
      context.shadowBlur = 0;
      context.clearRect(0, 0, width, height);
      context.drawImage(background, 0, 0, width, height);

      var wantedEnergy = targetEnergy(now);
      smoothedEnergy += (wantedEnergy - smoothedEnergy) * (staticOnly ? 1 : 0.16);
      var cx = width * 0.5;
      var cy = height * 0.48;
      var radius = Math.max(72, Math.min(188, Math.min(width, height) * (width < 720 ? 0.17 : 0.155)));
      var motionTime = staticOnly ? 1800 : now;

      context.globalCompositeOperation = "lighter";
      particles.forEach(function (particle, index) {
        var level = reactiveAudioState.levels[index % 8] || 0;
        var orbit = Math.sin(motionTime * particle.speed + particle.phase);
        var x = particle.x * width + orbit * (16 + smoothedEnergy * 42);
        var drift = ((motionTime * particle.speed * 0.055 + particle.y) % 1) * height;
        var y = height - drift;
        var pulse = 0.72 + Math.sin(motionTime * 0.0018 + particle.phase) * 0.2 + level * 0.72;
        var bubbleRadius = particle.radius * pulse * (1 + smoothedEnergy * 0.45);
        var diameter = Math.max(9, bubbleRadius * 6.4);
        context.globalAlpha = Math.min(1, 0.46 + smoothedEnergy * 0.42 + level * 0.18);
        context.drawImage(bubbleSprites[index % bubbleSprites.length], x - diameter / 2, y - diameter / 2, diameter, diameter);
      });

      context.globalAlpha = 1;
      context.shadowBlur = 0;
      var segmentGap = 0.06;
      palette.forEach(function (hue, index) {
        var start = -Math.PI / 2 + index * Math.PI * 2 / palette.length + segmentGap;
        var end = -Math.PI / 2 + (index + 1) * Math.PI * 2 / palette.length - segmentGap;
        var level = reactiveAudioState.levels[index] || 0;
        context.strokeStyle = "hsla(" + hue + ",100%,68%," + (0.62 + smoothedEnergy * 0.34).toFixed(3) + ")";
        context.lineWidth = 2 + level * 3.5;
        context.shadowColor = "hsla(" + hue + ",100%,58%,0.9)";
        context.shadowBlur = lowPowerDevice ? 7 : 13 + level * 10;
        context.beginPath();
        context.arc(cx, cy, radius + level * 9, start, end);
        context.stroke();
      });

      var bandCount = lowPowerDevice ? 32 : 48;
      context.shadowBlur = 0;
      for (var band = 0; band < bandCount; band++) {
        var bandAngle = -Math.PI / 2 + band / bandCount * Math.PI * 2;
        var bandLevel = reactiveAudioState.levels[Math.floor(band / bandCount * 8)] || 0;
        var ambient = reactiveAudioState.playing ? 0.18 + Math.sin(motionTime * 0.0035 + band * 0.61) * 0.08 : 0.05;
        var bar = 5 + Math.max(0, bandLevel + ambient) * (15 + smoothedEnergy * 26);
        var inner = radius + 10;
        var outer = inner + bar;
        var bandHue = palette[Math.floor(band / bandCount * palette.length) % palette.length];
        context.strokeStyle = "hsla(" + bandHue + ",100%,72%," + (0.28 + smoothedEnergy * 0.52).toFixed(3) + ")";
        context.lineWidth = width < 720 ? 1.2 : 1.8;
        context.beginPath();
        context.moveTo(cx + Math.cos(bandAngle) * inner, cy + Math.sin(bandAngle) * inner);
        context.lineTo(cx + Math.cos(bandAngle) * outer, cy + Math.sin(bandAngle) * outer);
        context.stroke();
      }

      context.globalCompositeOperation = "source-over";
      context.shadowBlur = 0;
      context.fillStyle = "rgba(0,0,0,0.78)";
      context.beginPath();
      context.arc(cx, cy, radius - 9, 0, Math.PI * 2);
      context.fill();

      var logoSize = radius * 1.54;
      if (logoReady) {
        context.save();
        context.beginPath();
        context.arc(cx, cy, logoSize * 0.5, 0, Math.PI * 2);
        context.clip();
        context.drawImage(logo, cx - logoSize / 2, cy - logoSize / 2, logoSize, logoSize);
        context.restore();
        context.strokeStyle = "rgba(255,255,255,0.2)";
        context.lineWidth = 1;
        context.beginPath();
        context.arc(cx, cy, logoSize * 0.5, 0, Math.PI * 2);
        context.stroke();
      } else {
        context.fillStyle = "#ffffff";
        context.font = "800 " + Math.max(24, radius * 0.3) + "px Arial, sans-serif";
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText("NEO", cx, cy);
      }

      var position = currentPlaybackPosition();
      var timestamp = formatReactiveTime(position);
      if (reactiveAudioState.duration > 0) timestamp += " / " + formatReactiveTime(reactiveAudioState.duration);
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.font = "700 " + (width < 720 ? 13 : 15) + "px Arial, sans-serif";
      context.letterSpacing = "0.04em";
      context.fillStyle = "rgba(255,255,255,0.94)";
      context.shadowColor = "rgba(65,220,255,0.72)";
      context.shadowBlur = lowPowerDevice ? 4 : 8;
      context.fillText(timestamp, cx, cy + radius + (width < 720 ? 42 : 50));
      context.shadowBlur = 0;
    }

    resize();
    var observer = window.ResizeObserver ? new ResizeObserver(function () {
      resize();
      drawFrame(performance.now());
    }) : null;
    if (observer) observer.observe(layer);
    else window.addEventListener("resize", resize, { passive: true });

    logo.onload = function () {
      logoReady = true;
      if (activeMedia === canvas && sequence === applySequence) drawFrame(performance.now());
    };
    logo.onerror = function () { logoReady = false; };
    logo.decoding = "async";
    logo.src = "./assets/neo-logo.svg";

    canvasCleanup = function () {
      if (observer) observer.disconnect();
      else window.removeEventListener("resize", resize);
      logo.onload = null;
      logo.onerror = null;
      coverBackdrop.onload = null;
      coverBackdrop.onerror = null;
      if (reactiveCoverElement === coverBackdrop) reactiveCoverElement = null;
      if (reactiveCoverRefresh === refreshCoverFrame) reactiveCoverRefresh = null;
    };

    var last = 0;
    var frameBudget = lowPowerDevice ? 40 : 33;
    function draw(now) {
      if (activeMedia !== canvas || sequence !== applySequence) return;
      if (staticOnly || shouldPause()) {
        root.dataset.wallpaperPlayback = "paused";
        canvasFrame = 0;
        return;
      }
      if (now - last >= frameBudget) {
        last = now;
        drawFrame(now);
        root.dataset.wallpaperPlayback = "playing";
      }
      canvasFrame = requestAnimationFrame(draw);
    }
    canvasResume = function () {
      if (!staticOnly && !canvasFrame && activeMedia === canvas && sequence === applySequence && !shouldPause()) {
        canvasFrame = requestAnimationFrame(draw);
      }
    };
    drawFrame(performance.now());
    canvasResume();
    emit(staticOnly ? "performance-still" : "mount");
  }

  function startSignalCanvas(sequence) {
    var layer = ensureLayer();
    if (!layer || sequence !== applySequence) return;
    clearMedia("switch");
    activeId = "signal";
    root.dataset.wallpaperMedia = "true";
    root.dataset.wallpaperPlayback = shouldPause() ? "paused" : "playing";
    var canvas = document.createElement("canvas");
    canvas.className = "wallpaper-media-asset wallpaper-signal-canvas";
    enforceFullBleed(canvas, "cover");
    layer.appendChild(canvas);
    activeMedia = canvas;
    var context = canvas.getContext("2d", { alpha: false });
    var resize = function () {
      var dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.max(1, Math.round(canvas.clientWidth * dpr));
      canvas.height = Math.max(1, Math.round(canvas.clientHeight * dpr));
      canvas.dataset.dpr = String(dpr);
    };
    resize();
    var observer = window.ResizeObserver ? new ResizeObserver(resize) : null;
    if (observer) observer.observe(canvas);
    canvasCleanup = function () { if (observer) observer.disconnect(); };
    var last = 0;
    function draw(time) {
      if (activeMedia !== canvas || sequence !== applySequence) {
        if (observer) observer.disconnect();
        return;
      }
      if (shouldPause()) {
        root.dataset.wallpaperPlayback = "paused";
        canvasFrame = 0;
        return;
      }
      if (time - last < 33) {
        canvasFrame = requestAnimationFrame(draw);
        return;
      }
      last = time;
      var dpr = Number(canvas.dataset.dpr || 1);
      var width = canvas.width / dpr;
      var height = canvas.height / dpr;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      var gradient = context.createLinearGradient(0, 0, width, height);
      gradient.addColorStop(0, "#071013");
      gradient.addColorStop(0.52, "#111821");
      gradient.addColorStop(1, "#050709");
      context.fillStyle = gradient;
      context.fillRect(0, 0, width, height);
      context.lineWidth = 1;
      for (var row = -2; row < 18; row++) {
        var y = height * 0.08 + row * 46 + (time * 0.012) % 46;
        context.strokeStyle = "rgba(103, 191, 205," + (0.04 + Math.max(0, row) * 0.003) + ")";
        context.beginPath();
        context.moveTo(0, y);
        context.lineTo(width, y + Math.sin(row + time * 0.0004) * 12);
        context.stroke();
      }
      for (var column = 0; column < 24; column++) {
        var x = column * (width / 23);
        var pulse = 0.05 + (Math.sin(time * 0.001 + column) + 1) * 0.025;
        context.strokeStyle = "rgba(119, 139, 255," + pulse + ")";
        context.beginPath();
        context.moveTo(x, 0);
        context.lineTo(x + Math.sin(column) * 34, height);
        context.stroke();
      }
      root.dataset.wallpaperPlayback = "playing";
      canvasFrame = requestAnimationFrame(draw);
    }
    canvasResume = function () {
      if (!canvasFrame && activeMedia === canvas && sequence === applySequence && !shouldPause()) canvasFrame = requestAnimationFrame(draw);
    };
    canvasResume();
    emit("mount");
  }

  function apply(id, nextSettings) {
    runtimeSettings = Object.assign({}, runtimeSettings, nextSettings || {});
    runtimeSettings.performanceMode = performanceMode();
    var nextSuspendedKey = String(id || "") + "|" + performanceMode() + (performanceMode() === "performance" ? "|" + (runtimeSettings.wallpaperFit || "cover") : "");
    cancelPending("A newer wallpaper was selected.");
    if (performanceActive() && suspendedKey === nextSuspendedKey) {
      root.dataset.wallpaperPlayback = "paused";
      emit("performance-still");
      return Promise.resolve();
    }
    if (!performanceActive()) suspendedKey = "";
    if (performanceMode() === "ultimate") {
      var ultimateSequence = ++applySequence;
      return mountPerformanceStill(id, null, ultimateSequence);
    }
    if (id === "neo-reactive") {
      var reactiveStill = performanceActive();
      if (activeId === id && activeMedia && (activeMedia.dataset.performanceStill === "true") === reactiveStill) {
        root.dataset.wallpaperPlayback = reactiveStill || shouldPause() ? "paused" : "playing";
        if (!reactiveStill && canvasResume) canvasResume();
        emit("playback");
        return Promise.resolve();
      }
      var reactiveSequence = ++applySequence;
      startNeoReactiveCanvas(reactiveSequence, reactiveStill);
      return Promise.resolve();
    }
    if (id === "signal") {
      if (performanceActive()) {
        var stillSequence = ++applySequence;
        return mountPerformanceStill(id, null, stillSequence);
      }
      if (activeId === id && activeMedia && activeMedia.dataset.performanceStill !== "true") {
        activeMedia.style.objectFit = runtimeSettings.wallpaperFit || "cover";
        root.dataset.wallpaperPlayback = shouldPause() ? "paused" : "playing";
        if (canvasResume) canvasResume();
        emit("playback");
        return Promise.resolve();
      }
      var signalSequence = ++applySequence;
      startSignalCanvas(signalSequence);
      return Promise.resolve();
    }
    var sequence = ++applySequence;
    if (!isLocal(id) && !isBundled(id)) {
      clearMedia("built-in");
      activeId = id || "";
      emit("built-in");
      return Promise.resolve();
    }
    if (activeId === id && activeMedia) {
      var currentlyStill = activeMedia.dataset.performanceStill === "true";
      var activeMoves = Boolean(activeRecord && (activeRecord.previewFallback || activeRecord.type === "video" || activeRecord.type === "youtube" || activeRecord.type === "web" || activeRecord.type === "animated-image"));
      if ((!performanceActive() && !currentlyStill) || (performanceActive() && (currentlyStill || !activeMoves))) {
        syncPlayback();
        return Promise.resolve();
      }
    }
    return getAvailableLibraries().then(function () {
      var record = recordFor(id);
      if (!record) throw new Error("The selected wallpaper is not installed on this device.");
      if (performanceActive() && (record.previewFallback || record.type === "video" || record.type === "youtube" || record.type === "web" || record.type === "animated-image")) {
        return mountPerformanceStill(id, record, sequence);
      }
      return mountRecord(record, sequence).then(function () {
        if (record.id !== id) emit("alias");
      });
    }).catch(function (error) {
      if (error && error.name === "AbortError") return;
      if (!activeId) root.dataset.wallpaperPlayback = "error";
      emit("error");
      throw error;
    });
  }

  function setSettings(nextSettings) {
    runtimeSettings = Object.assign({}, runtimeSettings, nextSettings || {});
    syncPlayback();
  }

  function setMediaPriority(active) {
    var next = Boolean(active);
    if (mediaPriorityPaused === next) return;
    mediaPriorityPaused = next;
    syncPlayback();
  }

  function setAutoPerformance(active) {
    var next = Boolean(active);
    if (autoPerformancePaused === next) return;
    autoPerformancePaused = next;
    syncPlayback();
  }

  function unlockAudio() {
    audioUnlocked = true;
    syncPlayback();
  }

  function createLibraryCard(record) {
    var card = document.createElement("article");
    card.className = "wallpaper-card";
    card.dataset.wallpaperCard = record.id;
    card.dataset.wallpaperLocal = record.bundled ? "false" : "true";
    card.dataset.wallpaperBundled = record.bundled ? "true" : "false";
    card.dataset.wallpaperName = record.name;
    card.dataset.wallpaperType = record.type;
    card.dataset.wallpaperSourceType = record.sourceType || record.type;
    card.dataset.wallpaperAuthor = record.author || "Local library";
    card.dataset.wallpaperCopy = (record.type === "youtube" ? "Streaming animated YouTube wallpaper" : record.type === "web" ? "Original web-native animated wallpaper" : record.type === "video" ? qualityLabel(record) + " animated video" : record.type === "animated-image" || isAnimatedPreview(record) ? "Animated GIF wallpaper" : "Local image wallpaper") + (record.type === "youtube" ? "" : " · " + readableSize(record.size));

    if (record.online) {
      card.dataset.wallpaperCopy = record.previewFallback
        ? (isAnimatedPreview(record) ? "Original animated Steam Workshop GIF preview at its authored timing." : "High-DPI web animation built from the official Steam Workshop preview.")
        : record.description || "Saved from Discover for use on this device.";
    }

    if (record.bundled) {
      card.dataset.wallpaperCopy = record.type === "youtube" ? "Animated YouTube wallpaper · loops automatically" : record.type === "web" ? "Original web-native animated Wallpaper Engine project" : record.type === "image" ? "Built-in high-resolution image wallpaper" : qualityLabel(record) + " animated Wallpaper Engine project";
    }
    if (record.builtIn) card.dataset.wallpaperCopy = record.description || "Built into NEO OS.";

    var select = document.createElement("button");
    select.className = "wallpaper-card-select";
    select.type = "button";
    select.dataset.wallpaperOption = record.id;
    select.setAttribute("aria-pressed", "false");

    var preview = document.createElement("span");
    preview.className = "wallpaper-card-preview local-wallpaper-preview";
    var previewUrl = urlFor(record, true);
    if (previewUrl) preview.style.backgroundImage = 'url("' + previewUrl + '")';
    if (record.builtIn) {
      preview.classList.add(record.id + "-preview");
      preview.dataset.mediaBadge = "AUDIO";
    } else if (record.online) preview.dataset.mediaBadge = isAnimatedPreview(record) ? "GIF" : (record.previewFallback ? "LIVE" : "SAVED");
    else if (record.bundled) preview.dataset.mediaBadge = record.type === "youtube" ? "YOUTUBE" : (record.type === "image" ? "IMAGE" : qualityLabel(record));
    else if (record.type === "video") preview.dataset.mediaBadge = "VIDEO";
    else if (record.type === "animated-image") preview.dataset.mediaBadge = "GIF";

    var copy = document.createElement("span");
    copy.className = "wallpaper-card-copy";
    var title = document.createElement("strong");
    title.textContent = record.name;
    var detail = document.createElement("small");
    detail.textContent = record.type === "youtube" ? "YouTube · Animated" : (record.type === "web" ? "Live web animation" : record.type === "video" ? qualityLabel(record) + " video" : record.type === "animated-image" ? "Full-resolution GIF" : "Image") + " · " + readableSize(record.size);
    if (record.online) {
      detail.textContent = (isAnimatedPreview(record) ? "Animated GIF preview" : record.previewFallback ? "Animated web preview" : "Workshop " + String(record.sourceType || "media").replace(/\b\w/g, function (letter) { return letter.toUpperCase(); })) + " · " + readableSize(record.size);
    } else if (record.bundled) {
      detail.textContent = (record.type === "youtube" ? "YouTube animation" : record.type === "web" ? "Original web project" : record.type === "image" ? "High-resolution image" : qualityLabel(record) + " video") + " · " + String(record.sourceType || "scene").replace(/\b\w/g, function (letter) { return letter.toUpperCase(); });
    }
    if (record.builtIn) detail.textContent = "Canvas · Music reactive";
    copy.append(title, detail);
    select.append(preview, copy);

    var favorite = document.createElement("button");
    favorite.className = "wallpaper-favorite";
    favorite.type = "button";
    favorite.dataset.wallpaperFavorite = record.id;
    favorite.setAttribute("aria-label", "Favorite " + record.name);
    favorite.setAttribute("aria-pressed", "false");
    favorite.textContent = "Save";

    var active = document.createElement("span");
    active.className = "wallpaper-active-badge";
    active.textContent = "Active";
    card.append(select, favorite, active);
    return card;
  }

  function hydrateStudio(studio) {
    if (!studio) return Promise.resolve([]);
    return getAvailableLibraries().then(function (results) {
      var records = visibleLibrary();
      var grid = studio.querySelector("[data-wallpaper-grid]");
      if (!grid) return records;
      grid.replaceChildren();
      records.forEach(function (record) { grid.appendChild(createLibraryCard(record)); });
      var count = studio.querySelector("[data-installed-count]");
      if (count) count.textContent = String(records.length);
      var selected = studio.dataset.selectedWallpaper;
      var selectedRecord = recordFor(selected);
      if (selectedRecord) selected = selectedRecord.id;
      var found = records.some(function (record) { return record.id === selected; });
      studio.dataset.selectedWallpaper = found ? selected : (records[0] ? records[0].id : "");
      return records;
    });
  }

  function decoratePreview(node, id) {
    if (!node || (!isLocal(id) && !isBundled(id))) return false;
    var record = recordFor(id);
    if (!record) return false;
    if (record.builtIn) {
      node.className = "inspector-preview local-wallpaper-preview " + record.id + "-preview";
      node.style.backgroundImage = "";
      node.dataset.mediaBadge = "AUDIO";
      return true;
    }
    var url = urlFor(record, true);
    node.className = "inspector-preview local-wallpaper-preview";
    node.style.backgroundImage = url ? 'url("' + url + '")' : "";
    node.dataset.mediaBadge = record.bundled
      ? (record.type === "image" ? "IMAGE" : qualityLabel(record))
      : record.previewFallback ? "LIVE" : record.type === "video" ? "VIDEO" : (record.type === "animated-image" ? "GIF" : "IMAGE");
    return true;
  }

  function getState() {
    return {
      id: activeId,
      type: activeRecord ? activeRecord.type : (activeId === "signal" || activeId === "neo-reactive" ? "canvas" : "built-in"),
      local: isLocal(activeId),
      ready: root.dataset.wallpaperPlayback !== "loading" && root.dataset.wallpaperPlayback !== "error",
      playback: root.dataset.wallpaperPlayback || "idle",
      playing: root.dataset.wallpaperPlayback === "playing",
      animationHealthy: activeRecord && activeRecord.type === "youtube" ? root.dataset.wallpaperPlayback === "playing" : activeMedia && activeMedia.tagName === "IFRAME" ? Boolean(webHealth && (webHealth.healthy || webFallbackFrame)) : root.dataset.wallpaperPlayback === "playing",
      animationMode: root.dataset.wallpaperWebAnimation || "native",
      mediaPriorityPaused: mediaPriorityPaused,
      autoPerformancePaused: autoPerformancePaused,
      stabilityPaused: stabilityPaused,
      muted: activeRecord && activeRecord.type === "youtube" ? (!audioUnlocked || runtimeSettings.wallpaperMuted !== false) : activeMedia && activeMedia.tagName === "VIDEO" ? activeMedia.muted : true,
      libraryCount: visibleLibrary().length
    };
  }

  function init(nextHost) {
    host = nextHost || document.querySelector(".wallpaper");
    ensureLayer();
    runtimeSettings.performanceMode = root.dataset.performanceMode === "ultimate"
      ? "ultimate"
      : root.dataset.performanceMode === "performance"
        ? "performance"
        : runtimeSettings.performanceMode;
    if (initialized) {
      return performanceMode() === "ultimate"
        ? Promise.resolve([bundledLibrary, library])
        : getAvailableLibraries();
    }
    initialized = true;
    root.dataset.wallpaperStability = "stable";
    startStabilityWatch();
    window.addEventListener("message", handleWebMessage);
    window.addEventListener("neo-media-state", handleReactiveMediaState);
    window.addEventListener("neo-media-levels", handleReactiveMediaLevels);
    document.addEventListener("visibilitychange", resumePlayback);
    document.addEventListener("fullscreenchange", resumePlayback);
    document.addEventListener("webkitfullscreenchange", resumePlayback);
    document.addEventListener("resume", resumePlayback);
    window.addEventListener("focus", resumePlayback);
    window.addEventListener("pageshow", resumePlayback);
    window.addEventListener("pagehide", function (event) { if (!event.persisted) clearMedia("pagehide"); });
    if (navigator.getBattery) {
      navigator.getBattery().then(function (value) {
        battery = value;
        battery.addEventListener("chargingchange", syncPlayback);
        battery.addEventListener("levelchange", syncPlayback);
        syncPlayback();
      }).catch(function () {});
    }
    if (performanceMode() === "ultimate") {
      emit("ready");
      return Promise.resolve([bundledLibrary, library]);
    }
    return getAvailableLibraries().then(function (records) { emit("ready"); return records; });
  }

  function subscribe(listener) {
    if (typeof listener !== "function") return function () {};
    listeners.push(listener);
    return function () { listeners = listeners.filter(function (item) { return item !== listener; }); };
  }

  function destroy() {
    stopStabilityWatch();
    clearMedia("destroy");
    window.removeEventListener("neo-media-state", handleReactiveMediaState);
    window.removeEventListener("neo-media-levels", handleReactiveMediaLevels);
    assetUrls.forEach(function (url) { URL.revokeObjectURL(url); });
    previewUrls.forEach(function (url) { URL.revokeObjectURL(url); });
    assetUrls.clear();
    previewUrls.clear();
  }

  window.NEOWallpaperEngine = {
    init: init,
    apply: apply,
    setSettings: setSettings,
    setMediaPriority: setMediaPriority,
    setAutoPerformance: setAutoPerformance,
    unlockAudio: unlockAudio,
    importFile: importFile,
    installOnline: installOnline,
    acceptStoredRecord: acceptStoredRecord,
    refreshLibrary: function () { return getLibrary(true); },
    onlineId: onlineId,
    remove: remove,
    list: getLibrary,
    listBundled: getBundledLibrary,
    hydrateStudio: hydrateStudio,
    decoratePreview: decoratePreview,
    getRecord: recordFor,
    getState: getState,
    isLocal: isLocal,
    isBundled: isBundled,
    subscribe: subscribe,
    destroy: destroy,
    maxFileSize: MAX_FILE_SIZE,
    supportedTypes: ["image/png", "image/jpeg", "image/webp", "image/gif", "video/mp4", "video/webm"]
  };
})();
