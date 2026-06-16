// Magic Wand - settings popup logic.

const DEFAULTS = { playFix: true, blockShorts: true };
const FIELDS = Object.keys(DEFAULTS);

// Load stored settings and reflect them in the checkboxes.
chrome.storage.sync.get(DEFAULTS, function (settings) {
  FIELDS.forEach(function (key) {
    const input = document.getElementById(key);
    input.checked = !!settings[key];
    input.addEventListener("change", function () {
      const update = {};
      update[key] = input.checked;
      chrome.storage.sync.set(update);
    });
  });
});
