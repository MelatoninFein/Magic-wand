// Magic Wand - background service worker.
//
// Keeps the betting-site blocking rulesets in sync with the "blockBetting"
// setting. declarativeNetRequest rulesets can only be toggled from an
// extension context, so we enable/disable the static rulesets here.

const RULESET_IDS = ["betting-domains", "betting-keywords"];
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
