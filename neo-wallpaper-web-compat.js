(function () {
  "use strict";

  if (window.__neoWallpaperCompat) return;

  if (document.querySelector('meta[name="neo-runner"]')) {
    var NativeImage = window.Image;
    function RunnerImage(width, height) {
      var image = new NativeImage(width, height);
      image.crossOrigin = "anonymous";
      return image;
    }
    RunnerImage.prototype = NativeImage.prototype;
    try { Object.setPrototypeOf(RunnerImage, NativeImage); } catch (_error) {}
    window.Image = RunnerImage;

    document.addEventListener("DOMContentLoaded", function () {
      document.querySelectorAll("img:not([crossorigin])").forEach(function (image) {
        image.crossOrigin = "anonymous";
      });
    }, { once: true });
  }

  var nativeRequestAnimationFrame = window.requestAnimationFrame.bind(window);
  var nativeCancelAnimationFrame = window.cancelAnimationFrame.bind(window);
  var nativeSetInterval = window.setInterval.bind(window);
  var projectFrames = 0;
  var projectIntervals = 0;
  var previousFrames = 0;
  var previousIntervals = 0;
  var previousAnimationTime = 0;
  var previousMediaTime = 0;

  window.requestAnimationFrame = function (callback) {
    return nativeRequestAnimationFrame(function (now) {
      projectFrames += 1;
      return callback(now);
    });
  };

  window.setInterval = function (handler, delay) {
    var args = Array.prototype.slice.call(arguments, 2);
    if (typeof handler !== "function") return nativeSetInterval.apply(window, arguments);
    return nativeSetInterval(function () {
      projectIntervals += 1;
      return handler.apply(window, args);
    }, delay);
  };

  var audioListeners = new Set();
  var mediaListeners = {
    playback: new Set(),
    properties: new Set(),
    thumbnail: new Set(),
    timeline: new Set()
  };
  var audioFrame = 0;
  var lastAudioFrame = 0;
  var paused = document.hidden;
  var pageReady = document.readyState === "complete";
  var spectrum = new Float32Array(128);

  function invokeSafely(listener, payload) {
    try {
      listener(payload);
    } catch (error) {
      console.error("[NEO wallpaper compatibility] Listener failed", error);
    }
  }

  function fillSpectrum(now) {
    var time = now / 1000;
    for (var index = 0; index < spectrum.length; index += 1) {
      var frequency = index < 64 ? index : index - 64;
      var falloff = 1 - frequency / 82;
      var primary = Math.sin(time * 2.1 + frequency * 0.19) * 0.16;
      var secondary = Math.sin(time * 0.73 + frequency * 0.071) * 0.09;
      spectrum[index] = Math.max(0.08, Math.min(0.88, (0.5 + primary + secondary) * falloff));
    }
  }

  function stopAudioLoop() {
    if (!audioFrame) return;
    nativeCancelAnimationFrame(audioFrame);
    audioFrame = 0;
  }

  function audioTick(now) {
    audioFrame = 0;
    if (paused || document.hidden || audioListeners.size === 0) return;

    if (now - lastAudioFrame >= 120) {
      lastAudioFrame = now;
      fillSpectrum(now);
      audioListeners.forEach(function (listener) {
        invokeSafely(listener, spectrum);
      });
    }

    audioFrame = nativeRequestAnimationFrame(audioTick);
  }

  function startAudioLoop() {
    if (!pageReady || audioFrame || paused || document.hidden || audioListeners.size === 0) return;
    audioFrame = nativeRequestAnimationFrame(audioTick);
  }

  function registerAudioListener(listener) {
    if (typeof listener !== "function") return;
    audioListeners.add(listener);
    startAudioLoop();
  }

  function registerMediaListener(type, listener) {
    if (typeof listener === "function") mediaListeners[type].add(listener);
  }

  if (typeof window.wallpaperRegisterAudioListener !== "function") {
    window.wallpaperRegisterAudioListener = registerAudioListener;
  }
  if (typeof window.wallpaperRegisterMediaPropertiesListener !== "function") {
    window.wallpaperRegisterMediaPropertiesListener = function (listener) {
      registerMediaListener("properties", listener);
    };
  }
  if (typeof window.wallpaperRegisterMediaThumbnailListener !== "function") {
    window.wallpaperRegisterMediaThumbnailListener = function (listener) {
      registerMediaListener("thumbnail", listener);
    };
  }
  if (typeof window.wallpaperRegisterMediaTimelineListener !== "function") {
    window.wallpaperRegisterMediaTimelineListener = function (listener) {
      registerMediaListener("timeline", listener);
    };
  }
  if (typeof window.wallpaperRegisterMediaPlaybackListener !== "function") {
    window.wallpaperRegisterMediaPlaybackListener = function (listener) {
      registerMediaListener("playback", listener);
    };
  }

  if (!window.wallpaperMediaIntegration) {
    window.wallpaperMediaIntegration = Object.freeze({
      PLAYBACK_PLAYING: 1,
      PLAYBACK_PAUSED: 2,
      PLAYBACK_STOPPED: 3
    });
  }

  function setDocumentPlayback(nextPaused) {
    var animations = typeof document.getAnimations === "function" ? document.getAnimations() : [];
    animations.forEach(function (animation) {
      try {
        if (nextPaused) animation.pause();
        else animation.play();
      } catch (_error) {}
    });
    document.querySelectorAll("video, audio").forEach(function (media) {
      if (nextPaused) {
        if (!media.paused) media.dataset.neoWallpaperWasPlaying = "true";
        media.pause();
      } else if (media.dataset.neoWallpaperWasPlaying === "true" || media.autoplay) {
        delete media.dataset.neoWallpaperWasPlaying;
        var playback = media.play();
        if (playback && typeof playback.catch === "function") playback.catch(function () {});
      }
    });
  }

  function animationTime() {
    if (typeof document.getAnimations !== "function") return 0;
    return document.getAnimations().reduce(function (total, animation) {
      return total + (Number(animation.currentTime) || 0);
    }, 0);
  }

  function mediaTime() {
    var total = 0;
    document.querySelectorAll("video, audio").forEach(function (media) {
      total += Number(media.currentTime) || 0;
    });
    return total;
  }

  function reportHealth() {
    var frames = projectFrames - previousFrames;
    var intervals = projectIntervals - previousIntervals;
    var nextAnimationTime = animationTime();
    var nextMediaTime = mediaTime();
    var animationAdvanced = Math.abs(nextAnimationTime - previousAnimationTime) > 1;
    var mediaAdvanced = Math.abs(nextMediaTime - previousMediaTime) > 0.01;
    previousFrames = projectFrames;
    previousIntervals = projectIntervals;
    previousAnimationTime = nextAnimationTime;
    previousMediaTime = nextMediaTime;
    window.parent.postMessage({
      type: "neo-wallpaper-health",
      ready: pageReady,
      paused: paused || document.hidden,
      activity: !paused && !document.hidden && (frames > 0 || intervals > 0 || animationAdvanced || mediaAdvanced),
      frames: frames,
      intervals: intervals,
      animationAdvanced: animationAdvanced,
      mediaAdvanced: mediaAdvanced
    }, "*");
  }

  window.addEventListener("message", function (event) {
    if (event.source !== window.parent || !event.data || event.data.type !== "neo-wallpaper-playback") return;
    paused = Boolean(event.data.paused);
    setDocumentPlayback(paused);
    mediaListeners.playback.forEach(function (listener) {
      invokeSafely(listener, paused ? window.wallpaperMediaIntegration.PLAYBACK_PAUSED : window.wallpaperMediaIntegration.PLAYBACK_PLAYING);
    });
    if (paused) stopAudioLoop();
    else startAudioLoop();
    reportHealth();
  });

  document.addEventListener("visibilitychange", function () {
    if (document.hidden) stopAudioLoop();
    else if (!paused) startAudioLoop();
  });

  if (!pageReady) {
    window.addEventListener("load", function () {
      window.setTimeout(function () {
        pageReady = true;
        startAudioLoop();
        reportHealth();
      }, 400);
    }, { once: true });
  } else {
    window.setTimeout(reportHealth, 0);
  }

  nativeSetInterval(reportHealth, 1000);

  window.addEventListener("error", function (event) {
    window.parent.postMessage({
      type: "neo-wallpaper-error",
      message: String(event.message || "Wallpaper script error")
    }, "*");
  });

  window.addEventListener("pagehide", stopAudioLoop);
  window.addEventListener("pageshow", startAudioLoop);

  window.__neoWallpaperCompat = {
    audioListeners: audioListeners,
    mediaListeners: mediaListeners,
    resume: function () {
      paused = false;
      startAudioLoop();
    },
    pause: function () {
      paused = true;
      stopAudioLoop();
    }
  };
})();
