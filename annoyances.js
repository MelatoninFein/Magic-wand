// Magic Wand - annoyance remover (runs on every site and frame).
//
// Gated by "dismissPopups": auto-dismisses cookie-consent / GDPR banners by
// clicking their reject (preferred) or accept button, hides the banner as a
// fallback, and restores scrolling when a modal locks the page.

(function () {
  "use strict";

  const DEFAULTS = { dismissPopups: true };
  let on = true;
  let handled = false;

  // --- Known consent containers/overlays to hide as a fallback --------------

  const HIDE = [
    "#onetrust-consent-sdk", "#onetrust-banner-sdk", ".onetrust-pc-dark-filter",
    "#CybotCookiebotDialog", "#CybotCookiebotDialogBodyUnderlay", "#CookiebotWidget",
    ".qc-cmp2-container", "#qc-cmp2-container", ".qc-cmp-cleanslate", ".qc-cmp2-bg",
    "#didomi-host", "#didomi-notice",
    "#usercentrics-root", "#uc-center-container",
    "#truste-consent-track", ".truste_overlay", ".truste_box_overlay",
    "[id^='sp_message_container_']", ".sp_veil",
    ".osano-cm-window", ".osano-cm-dialog",
    ".cky-consent-container", ".cky-modal", ".cky-overlay",
    "#cmplz-cookiebanner-container", ".cmplz-cookiebanner",
    "#BorlabsCookieBox", ".borlabs-cookie-box",
    "#termly-code-snippet-support",
    ".fc-consent-root",
    "#cookiescript_injected", "#cookiescript_wrapper",
    ".iubenda-cs-container", "#iubenda-cs-banner",
    ".cc-window", "#cookie-notice", "#cookieConsent",
    ".cookie-banner", "#cookie-banner", ".cookie-consent", "#cookie-consent",
    ".gdpr-banner",
  ];

  const STYLE_ID = "mw-annoyances-style";

  function injectCSS() {
    if (document.getElementById(STYLE_ID)) {
      return;
    }
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent =
      HIDE.join(",") + "{display:none !important;}\n" +
      "html.mw-unlock, html.mw-unlock body{overflow:auto !important;}";
    (document.head || document.documentElement).appendChild(style);
  }

  function removeCSS() {
    const s = document.getElementById(STYLE_ID);
    if (s) {
      s.remove();
    }
    document.documentElement.classList.remove("mw-unlock");
  }

  // --- Buttons: reject preferred, then accept -------------------------------

  const REJECT = [
    "#onetrust-reject-all-handler", ".ot-pc-refuse-all-handler",
    "#CybotCookiebotDialogBodyButtonDecline",
    "#didomi-notice-disagree-button", ".didomi-continue-without-agreeing",
    ".cky-btn-reject",
    ".osano-cm-denyAll",
    ".fc-cta-do-not-consent",
    "#cmplz-deny", ".cmplz-deny",
    ".iubenda-cs-reject-btn",
  ];

  const ACCEPT = [
    "#onetrust-accept-btn-handler",
    "#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll",
    "#CybotCookiebotDialogBodyButtonAccept",
    "#didomi-notice-agree-button",
    ".cky-btn-accept",
    ".qc-cmp2-summary-buttons button[mode='primary']",
    ".osano-cm-acceptAll", ".osano-cm-accept-all",
    ".fc-cta-consent",
    "#cmplz-accept", ".cmplz-accept",
    ".iubenda-cs-accept-btn",
    "#cookiescript_accept",
    ".cc-allow", ".cc-dismiss",
  ];

  const REJECT_TEXT = [
    "reject all", "reject", "decline", "only necessary", "necessary only",
    "i do not accept", "disagree", "refuse", "continue without accepting",
  ];
  const ACCEPT_TEXT = [
    "accept all", "accept", "agree", "i accept", "i agree", "allow all",
    "got it", "ok, got it", "understand", "allow cookies",
  ];

  function visible(el) {
    if (!el) {
      return false;
    }
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function clickFirst(selectors) {
    for (let i = 0; i < selectors.length; i++) {
      const el = document.querySelector(selectors[i]);
      if (el && visible(el)) {
        el.click();
        return true;
      }
    }
    return false;
  }

  function isConsentContext(el) {
    let n = el;
    for (let i = 0; i < 8 && n; i++) {
      const id =
        (n.id || "") +
        " " +
        (typeof n.className === "string" ? n.className : "");
      if (
        /cookie|consent|gdpr|cmp|privacy|onetrust|didomi|usercentric|cookiebot|qc-cmp|truste|osano|cky-|termly|iubenda/i.test(
          id
        )
      ) {
        return true;
      }
      n = n.parentElement;
    }
    return false;
  }

  function clickByText(words) {
    const btns = document.querySelectorAll(
      "button, a[role='button'], [role='button'], input[type='button'], input[type='submit']"
    );
    for (let i = 0; i < btns.length; i++) {
      const b = btns[i];
      if (!visible(b) || !isConsentContext(b)) {
        continue;
      }
      const txt = (b.textContent || b.value || "").trim().toLowerCase();
      if (!txt || txt.length > 32) {
        continue;
      }
      for (let j = 0; j < words.length; j++) {
        if (txt === words[j] || txt.indexOf(words[j]) === 0) {
          b.click();
          return true;
        }
      }
    }
    return false;
  }

  function unlockScroll() {
    const h = document.documentElement;
    const b = document.body;
    [h, b].forEach(function (el) {
      if (el && getComputedStyle(el).overflow === "hidden") {
        el.style.setProperty("overflow", "auto", "important");
      }
    });
    [
      "overflow-hidden", "no-scroll", "noscroll", "modal-open",
      "didomi-popup-open", "cookie-consent-active", "cmplz-blocked",
    ].forEach(function (c) {
      if (b) {
        b.classList.remove(c);
      }
      if (h) {
        h.classList.remove(c);
      }
    });
    h.classList.add("mw-unlock");
  }

  function dismiss() {
    if (!on) {
      return;
    }
    if (
      clickFirst(REJECT) ||
      clickByText(REJECT_TEXT) ||
      clickFirst(ACCEPT) ||
      clickByText(ACCEPT_TEXT)
    ) {
      handled = true;
    }
    injectCSS();
    unlockScroll();
  }

  // --- Wiring: run now, after load, and on late-loading banners -------------

  let attempts = 0;
  const MAX_ATTEMPTS = 20;
  let observer = null;

  function tick() {
    if (!on) {
      return;
    }
    dismiss();
    attempts++;
    if (attempts >= MAX_ATTEMPTS && observer) {
      observer.disconnect();
      observer = null;
    }
  }

  function start() {
    if (observer) {
      return;
    }
    tick();
    let scheduled = false;
    observer = new MutationObserver(function () {
      if (scheduled) {
        return;
      }
      scheduled = true;
      setTimeout(function () {
        scheduled = false;
        tick();
      }, 400);
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
    // A couple of delayed passes for banners that animate in late.
    setTimeout(tick, 1200);
    setTimeout(tick, 3000);
  }

  function stop() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    removeCSS();
  }

  if (chrome.storage && chrome.storage.sync) {
    chrome.storage.sync.get(DEFAULTS, function (s) {
      on = s.dismissPopups !== false;
      if (on) {
        start();
      }
    });
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area === "sync" && changes.dismissPopups) {
        on = !!changes.dismissPopups.newValue;
        if (on) {
          attempts = 0;
          start();
        } else {
          stop();
        }
      }
    });
  } else {
    start();
  }
})();
