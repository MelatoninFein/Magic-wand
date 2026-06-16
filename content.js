// YouTube Play Fix
//
// Two features:
//   1. Refresh the page once when a video starts playing (fixes playback
//      glitches on first load).
//   2. Fully block YouTube Shorts: hide every Shorts element (via styles.css)
//      and redirect any /shorts/<id> URL to the normal /watch?v=<id> player.

(function () {
  "use strict";

  // ---------------------------------------------------------------------------
  // Feature 2 (part A): redirect Shorts URLs to the regular watch page.
  // ---------------------------------------------------------------------------

  // If the current URL is a Shorts page, rewrite it to the standard watch URL.
  // Returns true if a redirect was performed.
  function redirectShorts() {
    const match = window.location.pathname.match(/^\/shorts\/([\w-]+)/);
    if (!match) {
      return false;
    }
    const watchUrl =
      window.location.origin + "/watch?v=" + match[1] + window.location.hash;
    window.location.replace(watchUrl);
    return true;
  }

  // Run as early as possible so the Shorts player never gets a chance to load.
  if (redirectShorts()) {
    return;
  }

  // YouTube is a single-page app, so also catch in-page navigations to Shorts.
  window.addEventListener("yt-navigate-start", redirectShorts, true);
  window.addEventListener("yt-navigate-finish", redirectShorts, true);
  document.addEventListener("yt-navigate-start", redirectShorts, true);
  document.addEventListener("yt-navigate-finish", redirectShorts, true);

  // ---------------------------------------------------------------------------
  // Feature 1: refresh once when a video starts playing.
  // ---------------------------------------------------------------------------

  // Returns a stable identifier for the currently loaded video, or null when
  // we are not on a watch page.
  function getVideoId() {
    try {
      const params = new URLSearchParams(window.location.search);
      return params.get("v");
    } catch (e) {
      return null;
    }
  }

  function storageKey(videoId) {
    return "ytPlayFix:refreshed:" + videoId;
  }

  // Called whenever a video element starts playing.
  function onPlay() {
    const videoId = getVideoId();
    if (!videoId) {
      return;
    }

    const key = storageKey(videoId);
    if (sessionStorage.getItem(key)) {
      // Already refreshed for this video during this tab session.
      return;
    }

    // Mark before reloading so the post-refresh autoplay does not loop.
    sessionStorage.setItem(key, "1");
    window.location.reload();
  }

  // Attach the listener to a video element (idempotent per element).
  function attach(video) {
    if (video.dataset.ytPlayFixBound) {
      return;
    }
    video.dataset.ytPlayFixBound = "1";
    video.addEventListener("play", onPlay);
  }

  // ---------------------------------------------------------------------------
  // Feature 2 (part B): remove Shorts shelves/links the CSS can't fully reach.
  // ---------------------------------------------------------------------------

  // CSS handles hiding, but we also remove obvious Shorts shelves so they don't
  // occupy layout space, regardless of the browser's :has() support.
  const SHORTS_SHELF_SELECTORS = [
    "ytd-rich-shelf-renderer[is-shorts]",
    "ytd-reel-shelf-renderer",
    "ytm-reel-shelf-renderer",
  ];

  function removeShortsShelves() {
    SHORTS_SHELF_SELECTORS.forEach(function (sel) {
      document.querySelectorAll(sel).forEach(function (el) {
        // Drop the surrounding rich-section wrapper when present so no empty
        // gap is left behind.
        const wrapper = el.closest("ytd-rich-section-renderer");
        (wrapper || el).remove();
      });
    });
  }

  function scan() {
    document.querySelectorAll("video").forEach(attach);
    removeShortsShelves();
  }

  // Elements are created/replaced dynamically by YouTube's SPA, so watch the
  // DOM and re-apply as content appears.
  const observer = new MutationObserver(scan);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  scan();
})();
