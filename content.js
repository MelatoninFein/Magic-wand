// YouTube Play Fix
//
// Refreshes the page once when a YouTube video is started playing.
// A per-video flag stored in sessionStorage prevents an infinite reload loop,
// since the video will autoplay (and fire "play" again) after the refresh.

(function () {
  "use strict";

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

  function scan() {
    document.querySelectorAll("video").forEach(attach);
  }

  // Video elements are created/replaced dynamically by YouTube's SPA, so watch
  // the DOM for new ones and bind as they appear.
  const observer = new MutationObserver(scan);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  scan();
})();
