// Magic Wand
//
// Two toggleable features (controlled from the popup, stored in chrome.storage):
//   1. playFix      - refresh the page once when a video starts playing.
//   2. blockShorts  - hide all Shorts UI (styles.css) and redirect
//                     /shorts/<id> URLs to the normal /watch?v=<id> player.

(function () {
  "use strict";

  const DEFAULTS = { playFix: true, blockShorts: true };
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
