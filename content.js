// Magic Wand
//
// Toggleable features (controlled from the popup, stored in chrome.storage):
//   1. playFix        - refresh the page once when a video starts playing.
//   2. blockShorts    - hide all Shorts UI (styles.css) and redirect
//                       /shorts/<id> URLs to the normal /watch?v=<id> player.
//   3. volumeControl  - scroll over the player to change volume, with boost
//                       above 100% and an on-screen indicator.

(function () {
  "use strict";

  const DEFAULTS = { playFix: true, blockShorts: true, volumeControl: true };
  let settings = Object.assign({}, DEFAULTS);

  const root = document.documentElement;

  // Optimistically hide Shorts right away (before settings load) so they never
  // flash on screen. If the user has the feature off, the class is removed as
  // soon as the stored settings arrive.
  root.classList.add("mw-block-shorts");

  // ---------------------------------------------------------------------------
  // Shorts blocking
  // ---------------------------------------------------------------------------

  function applyShortsClass() {
    root.classList.toggle("mw-block-shorts", !!settings.blockShorts);
  }

  // If on a Shorts page, rewrite to the standard watch URL. Returns true if a
  // redirect was performed.
  function redirectShorts() {
    if (!settings.blockShorts) {
      return false;
    }
    const match = window.location.pathname.match(/^\/shorts\/([\w-]+)/);
    if (!match) {
      return false;
    }
    const watchUrl =
      window.location.origin + "/watch?v=" + match[1] + window.location.hash;
    window.location.replace(watchUrl);
    return true;
  }

  const SHORTS_SHELF_SELECTORS = [
    "ytd-rich-shelf-renderer[is-shorts]",
    "ytd-reel-shelf-renderer",
    "ytm-reel-shelf-renderer",
  ];

  // Remove Shorts shelves outright so they don't leave an empty layout gap.
  function removeShortsShelves() {
    if (!settings.blockShorts) {
      return;
    }
    SHORTS_SHELF_SELECTORS.forEach(function (sel) {
      document.querySelectorAll(sel).forEach(function (el) {
        const wrapper = el.closest("ytd-rich-section-renderer");
        (wrapper || el).remove();
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Play fix
  // ---------------------------------------------------------------------------

  function getVideoId() {
    try {
      return new URLSearchParams(window.location.search).get("v");
    } catch (e) {
      return null;
    }
  }

  function storageKey(videoId) {
    return "magicWand:refreshed:" + videoId;
  }

  function onPlay() {
    if (!settings.playFix) {
      return;
    }
    const videoId = getVideoId();
    if (!videoId) {
      return;
    }
    const key = storageKey(videoId);
    if (sessionStorage.getItem(key)) {
      return; // Already refreshed for this video this tab session.
    }
    // Mark before reloading so the post-refresh autoplay does not loop.
    sessionStorage.setItem(key, "1");
    window.location.reload();
  }

  function attach(video) {
    if (video.dataset.magicWandBound) {
      return;
    }
    video.dataset.magicWandBound = "1";
    video.addEventListener("play", onPlay);
  }

  // ---------------------------------------------------------------------------
  // Better volume control
  //   - Scroll over the player to change volume.
  //   - Boost above 100% (up to MAX_VOLUME%) using a Web Audio gain node.
  //   - Remembers the level across videos/sessions.
  // ---------------------------------------------------------------------------

  const MAX_VOLUME = 400; // percent
  const STEP = 5; // percent per wheel notch
  const VOL_KEY = "magicWand:volume";

  let audioCtx = null;
  let gainNode = null;
  let graphVideo = null; // the <video> the audio graph is wired to
  let volLevel = clampVol(parseInt(localStorage.getItem(VOL_KEY), 10));

  function clampVol(n) {
    if (isNaN(n)) {
      return 100;
    }
    return Math.max(0, Math.min(MAX_VOLUME, n));
  }

  // Route a video element through a gain node so we can amplify past 100%.
  // A MediaElementSource can only be created once per element, so we cache it.
  function ensureGraph(video) {
    if (graphVideo === video && gainNode) {
      return true;
    }
    try {
      if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
      const source = audioCtx.createMediaElementSource(video);
      gainNode = audioCtx.createGain();
      source.connect(gainNode).connect(audioCtx.destination);
      graphVideo = video;
      return true;
    } catch (e) {
      return false; // already wired elsewhere, or not allowed yet
    }
  }

  function applyVolume(video) {
    volLevel = clampVol(volLevel);
    localStorage.setItem(VOL_KEY, String(volLevel));
    if (!video) {
      return;
    }
    if (video.muted && volLevel > 0) {
      video.muted = false;
    }
    if (volLevel <= 100) {
      if (gainNode) {
        gainNode.gain.value = 1;
      }
      video.volume = volLevel / 100;
    } else {
      // Native volume maxed; the gain node does the boosting.
      video.volume = 1;
      if (gainNode) {
        gainNode.gain.value = volLevel / 100;
      }
    }
  }

  function showVolumeIndicator(player, level) {
    let el = player.querySelector(".mw-vol-indicator");
    if (!el) {
      el = document.createElement("div");
      el.className = "mw-vol-indicator";
      player.appendChild(el);
    }
    el.textContent = (level > 100 ? "🔊 " : "🔉 ") + level + "%";
    el.classList.toggle("mw-vol-boost", level > 100);
    el.classList.add("mw-vol-show");
    clearTimeout(el._mwTimer);
    el._mwTimer = setTimeout(function () {
      el.classList.remove("mw-vol-show");
    }, 900);
  }

  function onWheel(e) {
    if (!settings.volumeControl) {
      return;
    }
    const player = e.target.closest && e.target.closest(".html5-video-player");
    if (!player) {
      return;
    }
    const video = player.querySelector("video");
    if (!video) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();

    if (audioCtx && audioCtx.state === "suspended") {
      audioCtx.resume();
    }
    ensureGraph(video); // needed for >100% boost; harmless otherwise

    volLevel = clampVol(volLevel + (e.deltaY < 0 ? STEP : -STEP));
    applyVolume(video);
    showVolumeIndicator(player, volLevel);
  }

  function initVolumeControl() {
    // Capture phase + non-passive so we can preventDefault the page scroll.
    document.addEventListener("wheel", onWheel, {
      capture: true,
      passive: false,
    });
  }

  // ---------------------------------------------------------------------------
  // Wiring
  // ---------------------------------------------------------------------------

  function scan() {
    document.querySelectorAll("video").forEach(attach);
    removeShortsShelves();
  }

  function init() {
    redirectShorts();

    // Catch in-page (SPA) navigations to Shorts.
    ["yt-navigate-start", "yt-navigate-finish"].forEach(function (evt) {
      window.addEventListener(evt, redirectShorts, true);
      document.addEventListener(evt, redirectShorts, true);
    });

    // Elements are created/replaced dynamically, so watch the DOM and re-apply.
    new MutationObserver(scan).observe(root, {
      childList: true,
      subtree: true,
    });

    initVolumeControl();

    scan();
  }

  // Load settings, then start. Live-update when the popup changes them.
  if (chrome.storage && chrome.storage.sync) {
    chrome.storage.sync.get(DEFAULTS, function (stored) {
      settings = Object.assign({}, DEFAULTS, stored);
      applyShortsClass();
      init();
    });

    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area !== "sync") {
        return;
      }
      Object.keys(changes).forEach(function (k) {
        settings[k] = changes[k].newValue;
      });
      applyShortsClass();
      // Apply Shorts removal immediately if it was just turned on.
      removeShortsShelves();
    });
  } else {
    // Storage unavailable: fall back to defaults.
    applyShortsClass();
    init();
  }
})();
