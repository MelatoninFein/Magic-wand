// Magic Wand - site-wide media controls (runs on every site and frame).
//
//   - Scroll the mouse wheel over any HTML5 <video> to change its volume,
//     with boost above 100% (up to 400%) via a Web Audio gain node.
//   - Keyboard: S = slower, D = faster, R = reset speed (0.25x steps).
//   - A small on-screen indicator shows the current volume / speed.
//
// Gated by the "mediaControls" setting. The volume level is remembered.

(function () {
  "use strict";

  const DEFAULTS = { mediaControls: true };
  let enabled = true;

  const MAX_VOLUME = 400; // percent
  const VOL_STEP = 5; // percent per wheel notch
  const SPEED_STEP = 0.25;
  const SPEED_MIN = 0.1;
  const SPEED_MAX = 16;
  const VOL_KEY = "magicWand:volume";

  let volLevel = clampVol(parseInt(localStorage.getItem(VOL_KEY), 10));
  let audioCtx = null;
  const gains = new WeakMap(); // video -> GainNode
  let indicator = null;
  let indicatorTimer = null;

  function clampVol(n) {
    if (isNaN(n)) {
      return 100;
    }
    return Math.max(0, Math.min(MAX_VOLUME, n));
  }

  // --- On-screen indicator (inline-styled so it works on any site) ----------

  function showIndicator(text, highlight) {
    if (!indicator) {
      indicator = document.createElement("div");
      indicator.style.cssText =
        "position:fixed;top:20px;left:20px;z-index:2147483647;" +
        "padding:6px 12px;border-radius:8px;background:rgba(0,0,0,0.78);" +
        "color:#fff;font:600 15px/1.2 Roboto,Arial,sans-serif;" +
        "pointer-events:none;opacity:0;transition:opacity .15s ease;";
      (document.body || document.documentElement).appendChild(indicator);
    }
    indicator.textContent = text;
    indicator.style.color = highlight ? "#ffd140" : "#fff";
    indicator.style.opacity = "1";
    clearTimeout(indicatorTimer);
    indicatorTimer = setTimeout(function () {
      if (indicator) {
        indicator.style.opacity = "0";
      }
    }, 900);
  }

  // --- Volume ---------------------------------------------------------------

  // Web Audio gives silence for cross-origin media without CORS, so only boost
  // when the source is same-origin or a blob/MSE stream (which is safe).
  function canBoost(video) {
    const src = video.currentSrc || video.src || "";
    if (!src || src.lastIndexOf("blob:", 0) === 0) {
      return true;
    }
    try {
      return new URL(src, location.href).origin === location.origin;
    } catch (e) {
      return true;
    }
  }

  function ensureGain(video) {
    let gain = gains.get(video);
    if (gain) {
      return gain;
    }
    try {
      if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
      const source = audioCtx.createMediaElementSource(video);
      gain = audioCtx.createGain();
      source.connect(gain).connect(audioCtx.destination);
      gains.set(video, gain);
      return gain;
    } catch (e) {
      return null;
    }
  }

  function applyVolume(video) {
    volLevel = clampVol(volLevel);
    localStorage.setItem(VOL_KEY, String(volLevel));
    if (video.muted && volLevel > 0) {
      video.muted = false;
    }
    if (volLevel <= 100) {
      const gain = gains.get(video);
      if (gain) {
        gain.gain.value = 1;
      }
      video.volume = volLevel / 100;
    } else {
      video.volume = 1;
      const gain = ensureGain(video);
      if (gain) {
        gain.gain.value = volLevel / 100;
      }
    }
  }

  function onWheel(e) {
    if (!enabled) {
      return;
    }
    const video = videoFor(e.target);
    if (!video) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();

    if (audioCtx && audioCtx.state === "suspended") {
      audioCtx.resume();
    }
    let next = clampVol(volLevel + (e.deltaY < 0 ? VOL_STEP : -VOL_STEP));
    if (next > 100 && !canBoost(video)) {
      next = 100; // don't risk muting cross-origin media
    }
    volLevel = next;
    applyVolume(video);
    showIndicator((volLevel > 100 ? "🔊 " : "🔉 ") + volLevel + "%", volLevel > 100);
  }

  // --- Speed ----------------------------------------------------------------

  function setSpeed(video, rate) {
    rate = Math.max(SPEED_MIN, Math.min(SPEED_MAX, Math.round(rate * 100) / 100));
    video.playbackRate = rate;
    const label = rate.toFixed(2).replace(/\.?0+$/, "");
    showIndicator(label + "×", rate !== 1);
  }

  function onKey(e) {
    if (!enabled || e.ctrlKey || e.metaKey || e.altKey) {
      return;
    }
    const t = e.target;
    if (
      t &&
      (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))
    ) {
      return; // don't hijack typing
    }
    const video = activeVideo();
    if (!video) {
      return;
    }
    const k = e.key.toLowerCase();
    if (k === "d") {
      setSpeed(video, video.playbackRate + SPEED_STEP);
    } else if (k === "s") {
      setSpeed(video, video.playbackRate - SPEED_STEP);
    } else if (k === "r") {
      setSpeed(video, 1);
    } else {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
  }

  // --- Finding the target video ---------------------------------------------

  function visibleVideos() {
    return Array.prototype.filter.call(
      document.querySelectorAll("video"),
      function (v) {
        const r = v.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      }
    );
  }

  // The video the user is interacting with: prefer one playing, else the
  // largest one on screen.
  function activeVideo() {
    const vids = visibleVideos();
    if (!vids.length) {
      return null;
    }
    const playing = vids.find(function (v) {
      return !v.paused && !v.ended;
    });
    if (playing) {
      return playing;
    }
    return vids.sort(function (a, b) {
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      return rb.width * rb.height - ra.width * ra.height;
    })[0];
  }

  // The video under the wheel cursor: climb a few ancestors looking for one
  // (player controls often sit on top of the <video>), else the active video.
  function videoFor(node) {
    let el = node;
    for (let i = 0; i < 6 && el; i++) {
      if (el.tagName === "VIDEO") {
        return el;
      }
      const v = el.querySelector && el.querySelector("video");
      if (v) {
        return v;
      }
      el = el.parentElement;
    }
    return activeVideo();
  }

  // --- Wiring ---------------------------------------------------------------

  document.addEventListener("wheel", onWheel, { capture: true, passive: false });
  document.addEventListener("keydown", onKey, true);

  if (chrome.storage && chrome.storage.sync) {
    chrome.storage.sync.get(DEFAULTS, function (s) {
      enabled = s.mediaControls !== false;
    });
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area === "sync" && changes.mediaControls) {
        enabled = !!changes.mediaControls.newValue;
      }
    });
  }
})();
