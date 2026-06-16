// Magic Wand - settings popup logic.

const DEFAULTS = {
  playFix: true,
  blockShorts: true,
  blockBetting: true,
  mediaControls: true,
  cleanUrls: true,
  dismissPopups: true,
  macros: true,
};
const FIELDS = Object.keys(DEFAULTS);

// --- Feature toggles --------------------------------------------------------

chrome.storage.sync.get(DEFAULTS, function (settings) {
  FIELDS.forEach(function (key) {
    const input = document.getElementById(key);
    if (!input) {
      return;
    }
    input.checked = !!settings[key];
    input.addEventListener("change", function () {
      const update = {};
      update[key] = input.checked;
      chrome.storage.sync.set(update);
    });
  });
});

// --- Gear: show/hide the settings panel -------------------------------------

const gear = document.getElementById("gear");
const settingsPanel = document.getElementById("settingsPanel");
gear.addEventListener("click", function () {
  const show = settingsPanel.hidden;
  settingsPanel.hidden = !show;
  gear.setAttribute("aria-expanded", String(show));
});

// --- Volume slider (controls the active tab's video) ------------------------

const volSlider = document.getElementById("volSlider");
const volVal = document.getElementById("volVal");

function showVol(level) {
  volVal.textContent = level + "%";
}

chrome.storage.local.get({ mwVolumeLevel: 100 }, function (d) {
  volSlider.value = d.mwVolumeLevel;
  showVol(d.mwVolumeLevel);
});

volSlider.addEventListener("input", function () {
  const level = parseInt(volSlider.value, 10);
  showVol(level);
  chrome.storage.local.set({ mwVolumeLevel: level });
  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    if (tabs[0]) {
      chrome.tabs.sendMessage(
        tabs[0].id,
        { type: "set-volume", level: level },
        function () {
          void chrome.runtime.lastError;
        }
      );
    }
  });
});

// --- Generic copy buttons ---------------------------------------------------

document.querySelectorAll("[data-copy]").forEach(function (btn) {
  btn.addEventListener("click", function () {
    const el = document.getElementById(btn.dataset.copy);
    const text = (el.value !== undefined ? el.value : el.textContent) || "";
    navigator.clipboard.writeText(text).then(function () {
      const old = btn.textContent;
      btn.textContent = "✓";
      setTimeout(function () {
        btn.textContent = old;
      }, 900);
    });
  });
});

// --- QR code ----------------------------------------------------------------

const qrInput = document.getElementById("qrInput");
const qrOut = document.getElementById("qrOut");
const qrDownload = document.getElementById("qrDownload");
let qrCanvas = null;

function drawQR(text) {
  let q;
  try {
    q = MWQR.generate(text);
  } catch (e) {
    qrOut.textContent = e.message;
    qrDownload.hidden = true;
    return;
  }
  const quiet = 4;
  const maxPx = 260;
  const cell = Math.max(2, Math.floor(maxPx / (q.size + quiet * 2)));
  const dim = (q.size + quiet * 2) * cell;
  const canvas = document.createElement("canvas");
  canvas.width = dim;
  canvas.height = dim;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, dim, dim);
  ctx.fillStyle = "#000";
  for (let r = 0; r < q.size; r++) {
    for (let c = 0; c < q.size; c++) {
      if (q.modules[r][c]) {
        ctx.fillRect((c + quiet) * cell, (r + quiet) * cell, cell, cell);
      }
    }
  }
  qrOut.innerHTML = "";
  qrOut.appendChild(canvas);
  qrCanvas = canvas;
  qrDownload.hidden = false;
}

document.getElementById("qrGen").addEventListener("click", function () {
  const text = qrInput.value.trim();
  if (text) {
    drawQR(text);
  }
});
qrInput.addEventListener("keydown", function (e) {
  if (e.key === "Enter") {
    document.getElementById("qrGen").click();
  }
});
qrDownload.addEventListener("click", function () {
  if (!qrCanvas) {
    return;
  }
  const a = document.createElement("a");
  a.href = qrCanvas.toDataURL("image/png");
  a.download = "qr.png";
  a.click();
});

// Prefill with the active tab's URL and render it.
chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
  const url = tabs[0] && tabs[0].url;
  if (url && /^https?:/.test(url)) {
    qrInput.value = url;
    drawQR(url);
  }
});

// --- Color picker -----------------------------------------------------------

const swatch = document.getElementById("swatch");
const hexVal = document.getElementById("hexVal");
const rgbVal = document.getElementById("rgbVal");
const colorInput = document.getElementById("colorInput");

function setColor(hex) {
  hex = hex.toUpperCase();
  swatch.style.background = hex;
  hexVal.textContent = hex;
  const n = parseInt(hex.slice(1), 16);
  rgbVal.textContent =
    "rgb(" + ((n >> 16) & 255) + ", " + ((n >> 8) & 255) + ", " + (n & 255) + ")";
  colorInput.value = hex;
}
setColor("#7A4FF6");

colorInput.addEventListener("input", function () {
  setColor(colorInput.value);
});

document.getElementById("eyedrop").addEventListener("click", function () {
  if (!window.EyeDropper) {
    alert("Your browser doesn't support the eyedropper.");
    return;
  }
  new EyeDropper()
    .open()
    .then(function (res) {
      setColor(res.sRGBHex);
    })
    .catch(function () {});
});

// --- Open media panel / macro builder in the active tab ---------------------

function messageActiveTab(type) {
  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    if (tabs[0]) {
      chrome.tabs.sendMessage(tabs[0].id, { type: type }, function () {
        void chrome.runtime.lastError; // ignore tabs without a content script
      });
    }
    window.close();
  });
}

document.getElementById("openPanel").addEventListener("click", function () {
  messageActiveTab("toggle-panel");
});

document.getElementById("openMacro").addEventListener("click", function () {
  messageActiveTab("toggle-macro");
});

// --- Countdown timer --------------------------------------------------------

const timerStart = document.getElementById("timerStart");
const timerMins = document.getElementById("timerMins");
const timerStatus = document.getElementById("timerStatus");
let statusInterval = null;

function renderTimerStatus() {
  chrome.storage.local.get(["mwTimerEnd"], function (d) {
    const end = d.mwTimerEnd;
    if (!end || end <= Date.now()) {
      timerStatus.textContent = "";
      timerStart.textContent = "Start";
      if (statusInterval) {
        clearInterval(statusInterval);
        statusInterval = null;
      }
      return;
    }
    let s = Math.round((end - Date.now()) / 1000);
    const m = Math.floor(s / 60);
    s = s % 60;
    timerStatus.textContent =
      "Running: " + m + ":" + (s < 10 ? "0" : "") + s + " left";
    timerStart.textContent = "Cancel";
  });
}

timerStart.addEventListener("click", function () {
  chrome.storage.local.get(["mwTimerEnd"], function (d) {
    if (d.mwTimerEnd && d.mwTimerEnd > Date.now()) {
      chrome.runtime.sendMessage({ type: "cancel-timer" }, renderTimerStatus);
    } else {
      const minutes = parseFloat(timerMins.value) || 10;
      chrome.runtime.sendMessage(
        { type: "start-timer", minutes: minutes, label: minutes + "-min timer" },
        function () {
          if (!statusInterval) {
            statusInterval = setInterval(renderTimerStatus, 1000);
          }
          renderTimerStatus();
        }
      );
    }
  });
});

renderTimerStatus();
statusInterval = setInterval(renderTimerStatus, 1000);
