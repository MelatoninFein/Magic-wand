// Magic Wand - background service worker.
//
// Keeps the betting-site blocking rulesets in sync with the "blockBetting"
// setting. declarativeNetRequest rulesets can only be toggled from an
// extension context, so we enable/disable the static rulesets here.

const RULESET_IDS = ["betting-domains"];
const DEFAULTS = { blockBetting: true };

function applyBettingRuleset(enabled) {
  chrome.declarativeNetRequest.updateEnabledRulesets(
    enabled
      ? { enableRulesetIds: RULESET_IDS }
      : { disableRulesetIds: RULESET_IDS }
  );
}

function refresh() {
  chrome.storage.sync.get(DEFAULTS, function (settings) {
    applyBettingRuleset(!!settings.blockBetting);
  });
}

chrome.runtime.onInstalled.addListener(refresh);
chrome.runtime.onStartup.addListener(refresh);

chrome.storage.onChanged.addListener(function (changes, area) {
  if (area === "sync" && changes.blockBetting) {
    applyBettingRuleset(!!changes.blockBetting.newValue);
  }
});

// ---------------------------------------------------------------------------
// Countdown timer (alarms + notification). Driven from the popup.
// ---------------------------------------------------------------------------

const TIMER_ALARM = "mw-timer";

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (!msg) {
    return;
  }
  if (msg.type === "start-timer") {
    const ms = Math.max(1, Math.round((msg.minutes || 0) * 60000));
    const end = Date.now() + ms;
    const label = msg.label || "Timer";
    chrome.storage.local.set({ mwTimerEnd: end, mwTimerLabel: label });
    chrome.alarms.create(TIMER_ALARM, { when: end });
    sendResponse({ ok: true, end: end });
    return true;
  }
  if (msg.type === "cancel-timer") {
    chrome.alarms.clear(TIMER_ALARM);
    chrome.storage.local.remove(["mwTimerEnd", "mwTimerLabel"]);
    sendResponse({ ok: true });
    return true;
  }
});

chrome.alarms.onAlarm.addListener(function (alarm) {
  if (alarm.name !== TIMER_ALARM) {
    return;
  }
  chrome.storage.local.get(["mwTimerLabel"], function (d) {
    chrome.notifications.create("mw-timer-" + Date.now(), {
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: "⏰ " + (d.mwTimerLabel || "Timer") + " finished",
      message: "Your Magic Wand timer is done.",
      priority: 2,
      requireInteraction: true,
    });
    chrome.storage.local.remove(["mwTimerEnd", "mwTimerLabel"]);
  });
});
