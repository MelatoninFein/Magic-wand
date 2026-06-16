// Magic Wand - settings popup logic.

const DEFAULTS = {
  playFix: true,
  blockShorts: true,
  blockBetting: true,
  mediaControls: true,
  cleanUrls: true,
  dismissPopups: true,
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

// --- Open media panel in the active tab -------------------------------------

document.getElementById("openPanel").addEventListener("click", function () {
  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    if (tabs[0]) {
      chrome.tabs.sendMessage(tabs[0].id, { type: "toggle-panel" }, function () {
        void chrome.runtime.lastError; // ignore tabs without a content script
      });
    }
    window.close();
  });
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
