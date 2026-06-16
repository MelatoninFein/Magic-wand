// Magic Wand - site-wide media tools (runs on every site and frame).
//
// Gated by "mediaControls":
//   - Volume is controlled by the slider in the popup (boost up to 400%).
//   - The popup's "Open media panel" button opens a draggable control panel
//     with play/pause, speed, volume, loop, PiP and a sleep timer.
// Gated by "cleanUrls":
//   - Strips tracking parameters (utm_*, fbclid, gclid, …) from the page URL
//     and from links.

(function () {
  "use strict";

  const DEFAULTS = { mediaControls: true, cleanUrls: true };
  let mediaOn = true;
  let cleanOn = true;

  const MAX_VOLUME = 400;
  const VOL_STEP = 5;
  const SPEED_STEP = 0.25;
  const SPEED_MIN = 0.1;
  const SPEED_MAX = 16;
  let volLevel = 100;
  let audioCtx = null;
  const gains = new WeakMap();
  let indicator = null;
  let indicatorTimer = null;

  function clampVol(n) {
    return isNaN(n) ? 100 : Math.max(0, Math.min(MAX_VOLUME, n));
  }

  // --- Target video ---------------------------------------------------------

  function visibleVideos() {
    return Array.prototype.filter.call(
      document.querySelectorAll("video"),
      function (v) {
        const r = v.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      }
    );
  }

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

  // --- Indicator ------------------------------------------------------------

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

  function setVolume(level) {
    volLevel = clampVol(level);
    const video = activeVideo();
    if (video) {
      if (audioCtx && audioCtx.state === "suspended") {
        audioCtx.resume();
      }
      if (volLevel > 100 && !canBoost(video)) {
        volLevel = 100;
      }
      applyVolume(video);
      showIndicator((volLevel > 100 ? "🔊 " : "🔉 ") + volLevel + "%", volLevel > 100);
    }
    chrome.storage.local.set({ mwVolumeLevel: volLevel });
    updatePanel();
  }

  // --- Speed ----------------------------------------------------------------

  function setSpeed(video, rate) {
    rate = Math.max(SPEED_MIN, Math.min(SPEED_MAX, Math.round(rate * 100) / 100));
    video.playbackRate = rate;
    showIndicator(fmtSpeed(rate) + "×", rate !== 1);
    updatePanel();
  }

  function fmtSpeed(rate) {
    return rate.toFixed(2).replace(/\.?0+$/, "");
  }

  // --- Picture-in-Picture ---------------------------------------------------

  function togglePip(video) {
    try {
      if (document.pictureInPictureElement) {
        document.exitPictureInPicture();
      } else if (video && document.pictureInPictureEnabled) {
        video.requestPictureInPicture().catch(function () {});
      }
    } catch (e) {
      /* unsupported */
    }
  }

  // --- Sleep timer ----------------------------------------------------------

  let sleepTimeout = null;
  let sleepInterval = null;
  let sleepEnd = 0;

  function startSleep(minutes) {
    cancelSleep();
    const ms = Math.max(1, minutes) * 60000;
    sleepEnd = Date.now() + ms;
    sleepTimeout = setTimeout(function () {
      const v = activeVideo();
      if (v) {
        v.pause();
      }
      cancelSleep();
      showIndicator("😴 Sleep timer: paused", true);
    }, ms);
    sleepInterval = setInterval(updatePanel, 1000);
    updatePanel();
  }

  function cancelSleep() {
    clearTimeout(sleepTimeout);
    clearInterval(sleepInterval);
    sleepTimeout = null;
    sleepInterval = null;
    sleepEnd = 0;
    updatePanel();
  }

  function sleepRemaining() {
    if (!sleepEnd) {
      return "";
    }
    let s = Math.max(0, Math.round((sleepEnd - Date.now()) / 1000));
    const m = Math.floor(s / 60);
    s = s % 60;
    return m + ":" + (s < 10 ? "0" : "") + s;
  }

  // --- Pop-out control panel ------------------------------------------------

  let panel = null;

  function btn(label, title, onClick) {
    const b = document.createElement("button");
    b.textContent = label;
    b.title = title || "";
    b.style.cssText =
      "flex:1;min-width:34px;padding:7px 6px;margin:0;border:none;border-radius:7px;" +
      "background:#2a2350;color:#fff;font:600 13px Roboto,Arial,sans-serif;cursor:pointer;";
    b.addEventListener("click", function (e) {
      e.preventDefault();
      onClick();
    });
    return b;
  }

  function row() {
    const r = document.createElement("div");
    r.style.cssText = "display:flex;gap:6px;margin-top:8px;align-items:center;";
    return r;
  }

  function buildPanel() {
    panel = document.createElement("div");
    panel.style.cssText =
      "position:fixed;top:80px;right:24px;z-index:2147483647;width:230px;" +
      "background:linear-gradient(135deg,#3a2a78,#241a52);color:#fff;" +
      "border-radius:14px;padding:12px;box-shadow:0 14px 40px rgba(0,0,0,.5);" +
      "font:13px Roboto,Arial,sans-serif;user-select:none;";

    const bar = document.createElement("div");
    bar.style.cssText =
      "display:flex;justify-content:space-between;align-items:center;cursor:move;" +
      "font-weight:700;margin:-2px 0 8px;";
    bar.innerHTML = "<span>🪄 Media</span>";
    const close = document.createElement("span");
    close.textContent = "✕";
    close.style.cssText = "cursor:pointer;opacity:.8;padding:0 4px;";
    close.addEventListener("click", function () {
      togglePanel(false);
    });
    bar.appendChild(close);
    makeDraggable(panel, bar);
    panel.appendChild(bar);

    // Play/pause + PiP + loop
    const r1 = row();
    r1._playBtn = btn("⏯", "Play / pause", function () {
      const v = activeVideo();
      if (v) {
        v.paused ? v.play() : v.pause();
      }
      updatePanel();
    });
    r1.appendChild(r1._playBtn);
    r1.appendChild(
      btn("⤢ PiP", "Picture-in-Picture", function () {
        togglePip(activeVideo());
      })
    );
    r1._loopBtn = btn("↺ Loop", "Toggle loop", function () {
      const v = activeVideo();
      if (v) {
        v.loop = !v.loop;
      }
      updatePanel();
    });
    r1.appendChild(r1._loopBtn);
    panel.appendChild(r1);

    // Speed
    const r2 = row();
    r2.appendChild(
      btn("−", "Slower", function () {
        const v = activeVideo();
        if (v) {
          setSpeed(v, v.playbackRate - SPEED_STEP);
        }
      })
    );
    const speedLbl = document.createElement("div");
    speedLbl.style.cssText = "flex:2;text-align:center;font-weight:700;";
    r2.appendChild(speedLbl);
    r2.appendChild(
      btn("+", "Faster", function () {
        const v = activeVideo();
        if (v) {
          setSpeed(v, v.playbackRate + SPEED_STEP);
        }
      })
    );
    r2.appendChild(
      btn("1×", "Reset speed", function () {
        const v = activeVideo();
        if (v) {
          setSpeed(v, 1);
        }
      })
    );
    panel.appendChild(r2);

    // Volume
    const r3 = row();
    r3.appendChild(
      btn("🔉 −", "Volume down", function () {
        setVolume(volLevel - VOL_STEP);
      })
    );
    const volLbl = document.createElement("div");
    volLbl.style.cssText = "flex:2;text-align:center;font-weight:700;";
    r3.appendChild(volLbl);
    r3.appendChild(
      btn("🔊 +", "Volume up", function () {
        setVolume(volLevel + VOL_STEP);
      })
    );
    panel.appendChild(r3);

    // Sleep timer
    const r4 = row();
    const sleepInput = document.createElement("input");
    sleepInput.type = "number";
    sleepInput.min = "1";
    sleepInput.value = "30";
    sleepInput.style.cssText =
      "width:48px;padding:6px;border:none;border-radius:7px;text-align:center;" +
      "font:600 13px Roboto,Arial,sans-serif;";
    r4.appendChild(sleepInput);
    const sleepLbl = document.createElement("div");
    sleepLbl.style.cssText = "flex:1;text-align:center;font-size:12px;opacity:.9;";
    sleepLbl.textContent = "min → 😴";
    r4.appendChild(sleepLbl);
    r4._sleepBtn = btn("Start", "Sleep timer: pause when it ends", function () {
      if (sleepEnd) {
        cancelSleep();
      } else {
        startSleep(parseInt(sleepInput.value, 10) || 30);
      }
    });
    r4.appendChild(r4._sleepBtn);
    panel.appendChild(r4);

    panel._speedLbl = speedLbl;
    panel._volLbl = volLbl;
    panel._playRow = r1;
    panel._sleepBtn = r4._sleepBtn;
    panel._sleepLbl = sleepLbl;

    (document.body || document.documentElement).appendChild(panel);
  }

  function updatePanel() {
    if (!panel || panel.style.display === "none") {
      return;
    }
    const v = activeVideo();
    panel._speedLbl.textContent = (v ? fmtSpeed(v.playbackRate) : "1") + "×";
    panel._volLbl.textContent = volLevel + "%";
    panel._playRow._playBtn.textContent = v && !v.paused ? "⏸" : "⏯";
    panel._playRow._loopBtn.style.background = v && v.loop ? "#7a4ff6" : "#2a2350";
    if (sleepEnd) {
      panel._sleepBtn.textContent = "Stop";
      panel._sleepLbl.textContent = "⏳ " + sleepRemaining();
    } else {
      panel._sleepBtn.textContent = "Start";
      panel._sleepLbl.textContent = "min → 😴";
    }
  }

  function togglePanel(show) {
    if (!mediaOn) {
      return;
    }
    const firstTime = !panel;
    if (firstTime) {
      buildPanel();
    }
    const willShow =
      show === undefined ? firstTime || panel.style.display === "none" : show;
    panel.style.display = willShow ? "block" : "none";
    if (willShow) {
      updatePanel();
    }
  }

  function makeDraggable(el, handle) {
    let sx, sy, ox, oy, dragging = false;
    handle.addEventListener("mousedown", function (e) {
      dragging = true;
      sx = e.clientX;
      sy = e.clientY;
      const r = el.getBoundingClientRect();
      ox = r.left;
      oy = r.top;
      e.preventDefault();
    });
    document.addEventListener("mousemove", function (e) {
      if (!dragging) {
        return;
      }
      el.style.left = ox + (e.clientX - sx) + "px";
      el.style.top = oy + (e.clientY - sy) + "px";
      el.style.right = "auto";
    });
    document.addEventListener("mouseup", function () {
      dragging = false;
    });
  }

  // --- Keyboard -------------------------------------------------------------

  // --- Clean URLs -----------------------------------------------------------

  const TRACKERS = [
    "gclid", "fbclid", "dclid", "gbraid", "wbraid", "msclkid", "yclid",
    "mc_eid", "mc_cid", "igshid", "vero_id", "oly_enc_id", "oly_anon_id",
    "_hsenc", "_hsmi", "ref_src", "ref_url", "spm", "scm",
  ];

  function isTracker(key) {
    const k = key.toLowerCase();
    return k.indexOf("utm_") === 0 || TRACKERS.indexOf(k) !== -1;
  }

  function cleanedUrl(urlStr) {
    let url;
    try {
      url = new URL(urlStr);
    } catch (e) {
      return null;
    }
    if (!url.search) {
      return null;
    }
    let changed = false;
    const params = url.searchParams;
    Array.from(params.keys()).forEach(function (key) {
      if (isTracker(key)) {
        params.delete(key);
        changed = true;
      }
    });
    if (!changed) {
      return null;
    }
    url.search = params.toString();
    return url.toString();
  }

  function cleanCurrentUrl() {
    if (!cleanOn) {
      return;
    }
    const cleaned = cleanedUrl(location.href);
    if (cleaned && cleaned !== location.href) {
      try {
        history.replaceState(history.state, "", cleaned);
      } catch (e) {
        /* ignore */
      }
    }
  }

  function cleanLink(e) {
    if (!cleanOn) {
      return;
    }
    const a = e.target.closest && e.target.closest("a[href]");
    if (!a) {
      return;
    }
    const cleaned = cleanedUrl(a.href);
    if (cleaned) {
      a.href = cleaned;
    }
  }

  // --- Wiring ---------------------------------------------------------------

  document.addEventListener("pointerdown", cleanLink, true);
  window.addEventListener("popstate", cleanCurrentUrl);

  cleanCurrentUrl();

  if (chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener(function (msg) {
      if (!msg) {
        return;
      }
      if (msg.type === "toggle-panel") {
        togglePanel();
      } else if (msg.type === "set-volume") {
        setVolume(msg.level);
      }
    });
  }

  if (chrome.storage && chrome.storage.local) {
    chrome.storage.local.get({ mwVolumeLevel: 100 }, function (d) {
      volLevel = clampVol(d.mwVolumeLevel);
    });
  }

  if (chrome.storage && chrome.storage.sync) {
    chrome.storage.sync.get(DEFAULTS, function (s) {
      mediaOn = s.mediaControls !== false;
      cleanOn = s.cleanUrls !== false;
      cleanCurrentUrl();
    });
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area !== "sync") {
        return;
      }
      if (changes.mediaControls) {
        mediaOn = !!changes.mediaControls.newValue;
      }
      if (changes.cleanUrls) {
        cleanOn = !!changes.cleanUrls.newValue;
        cleanCurrentUrl();
      }
    });
  }
})();
