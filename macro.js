// Magic Wand - macro builder/runner (top frame, gated by "macros").
//
// Build a small automation: pick fields/buttons on the page and add steps:
//   - Read field   : grab a field's text (stored as {grabbed})
//   - Fill field   : type text into a field (supports the {grabbed} token)
//   - Click        : click an element
//   - Wait         : pause N ms
// Set a repeat count + interval, then Run/Stop. Saved per-site.
// Open with the popup's "Open macro builder" button.

(function () {
  "use strict";

  let on = true;
  let panel = null;
  let steps = [];
  let logEl = null;
  let running = false;
  let stopFlag = false;
  let lastGrabbed = "";
  const STORE_KEY = "mwMacro:" + location.hostname;

  // --- Element selector ------------------------------------------------------

  function cssPath(el) {
    if (!el || el.nodeType !== 1) {
      return "";
    }
    if (el.id) {
      return "#" + CSS.escape(el.id);
    }
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== document.body) {
      let sel = node.tagName.toLowerCase();
      if (node.id) {
        parts.unshift("#" + CSS.escape(node.id));
        break;
      }
      let nth = 1;
      let sib = node;
      while ((sib = sib.previousElementSibling)) {
        if (sib.tagName === node.tagName) {
          nth++;
        }
      }
      sel += ":nth-of-type(" + nth + ")";
      parts.unshift(sel);
      node = node.parentElement;
    }
    return parts.join(">");
  }

  function query(sel) {
    try {
      return document.querySelector(sel);
    } catch (e) {
      return null;
    }
  }

  // --- Element picker --------------------------------------------------------

  let pickResolve = null;
  let outline = null;

  function pickElement() {
    return new Promise(function (resolve) {
      pickResolve = resolve;
      if (!outline) {
        outline = document.createElement("div");
        outline.style.cssText =
          "position:fixed;z-index:2147483647;pointer-events:none;" +
          "border:2px solid #16140f;background:rgba(22,20,15,.12);border-radius:3px;";
        document.body.appendChild(outline);
      }
      outline.style.display = "block";
      document.addEventListener("mousemove", onPickMove, true);
      document.addEventListener("click", onPickClick, true);
      document.addEventListener("keydown", onPickKey, true);
    });
  }

  function onPickMove(e) {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el === outline || (panel && panel.contains(el))) {
      return;
    }
    const r = el.getBoundingClientRect();
    outline.style.left = r.left + "px";
    outline.style.top = r.top + "px";
    outline.style.width = r.width + "px";
    outline.style.height = r.height + "px";
    outline._target = el;
  }

  function endPick(result) {
    document.removeEventListener("mousemove", onPickMove, true);
    document.removeEventListener("click", onPickClick, true);
    document.removeEventListener("keydown", onPickKey, true);
    if (outline) {
      outline.style.display = "none";
    }
    const r = pickResolve;
    pickResolve = null;
    if (r) {
      r(result);
    }
  }

  function onPickClick(e) {
    if (panel && panel.contains(e.target)) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    endPick(outline && outline._target ? cssPath(outline._target) : null);
  }

  function onPickKey(e) {
    if (e.key === "Escape") {
      endPick(null);
    }
  }

  // --- Step execution --------------------------------------------------------

  function sleep(ms) {
    return new Promise(function (r) {
      setTimeout(r, ms);
    });
  }

  function setNativeValue(el, value) {
    const proto =
      el.tagName === "TEXTAREA"
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, "value");
    if (desc && desc.set) {
      desc.set.call(el, value);
    } else {
      el.value = value;
    }
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function log(msg) {
    if (logEl) {
      logEl.value += msg + "\n";
      logEl.scrollTop = logEl.scrollHeight;
    }
  }

  async function doStep(step) {
    if (step.action === "wait") {
      await sleep(step.ms || 500);
      return;
    }
    const el = query(step.selector);
    if (!el) {
      log("⚠️ not found: " + step.selector);
      return;
    }
    if (step.action === "read") {
      lastGrabbed = el.value !== undefined ? el.value : el.textContent.trim();
      log("📋 read: " + lastGrabbed);
    } else if (step.action === "fill") {
      const text = (step.value || "").split("{grabbed}").join(lastGrabbed);
      if (el.value !== undefined) {
        el.focus();
        setNativeValue(el, text);
      } else if (el.isContentEditable) {
        el.textContent = text;
      }
      log("⌨️ filled: " + text);
    } else if (step.action === "click") {
      el.click();
      log("🖱️ clicked");
    }
  }

  async function run() {
    if (running) {
      return;
    }
    running = true;
    stopFlag = false;
    const count = Math.max(1, parseInt(panel._count.value, 10) || 1);
    const interval = Math.max(0, parseFloat(panel._interval.value) || 0) * 1000;
    log("▶️ run ×" + count);
    for (let i = 0; i < count && !stopFlag; i++) {
      for (let s = 0; s < steps.length && !stopFlag; s++) {
        await doStep(steps[s]);
        await sleep(250);
      }
      if (i < count - 1 && !stopFlag) {
        await sleep(interval);
      }
    }
    log(stopFlag ? "⏹️ stopped" : "✅ done");
    running = false;
  }

  // --- Panel UI --------------------------------------------------------------

  function mkBtn(label, bg, onClick) {
    const b = document.createElement("button");
    b.textContent = label;
    void bg;
    b.style.cssText =
      "padding:6px 9px;border:none;border-radius:7px;cursor:pointer;" +
      "font:700 12px 'Helvetica Neue',Arial,sans-serif;color:#f2efe6;background:#16140f;";
    b.addEventListener("click", onClick);
    return b;
  }

  function renderSteps() {
    const list = panel._list;
    list.innerHTML = "";
    steps.forEach(function (step, i) {
      const row = document.createElement("div");
      row.style.cssText =
        "display:flex;align-items:center;gap:6px;padding:4px 0;font-size:12px;";
      let desc = step.action.toUpperCase();
      if (step.action === "fill") {
        desc += " “" + (step.value || "") + "”";
      } else if (step.action === "wait") {
        desc += " " + step.ms + "ms";
      }
      if (step.selector) {
        desc += "  ⟨" + step.selector.slice(0, 22) + "⟩";
      }
      const span = document.createElement("span");
      span.textContent = i + 1 + ". " + desc;
      span.style.cssText = "flex:1;opacity:.92;word-break:break-all;";
      const del = mkBtn("✕", "#3a3160", function () {
        steps.splice(i, 1);
        renderSteps();
      });
      row.appendChild(span);
      row.appendChild(del);
      list.appendChild(row);
    });
  }

  async function addStep(action) {
    if (action === "wait") {
      const ms = parseInt(prompt("Wait how many milliseconds?", "1000"), 10);
      if (!isNaN(ms)) {
        steps.push({ action: "wait", ms: ms });
        renderSteps();
      }
      return;
    }
    log("👉 click an element on the page… (Esc to cancel)");
    const selector = await pickElement();
    if (!selector) {
      log("picker cancelled");
      return;
    }
    if (action === "fill") {
      const value = prompt(
        "Text to type (use {grabbed} to insert the last read value):",
        "{grabbed}"
      );
      if (value === null) {
        return;
      }
      steps.push({ action: "fill", selector: selector, value: value });
    } else {
      steps.push({ action: action, selector: selector });
    }
    renderSteps();
  }

  function buildPanel() {
    panel = document.createElement("div");
    panel.style.cssText =
      "position:fixed;top:90px;left:24px;z-index:2147483647;width:270px;" +
      "background:rgba(255,253,248,0.30);" +
      "-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);" +
      "color:#16140f;border:1px solid rgba(22,20,15,0.18);" +
      "border-radius:14px;padding:12px;box-shadow:0 14px 40px rgba(0,0,0,.22);" +
      "font:13px 'Helvetica Neue',Arial,sans-serif;";

    const bar = document.createElement("div");
    bar.style.cssText =
      "display:flex;justify-content:space-between;align-items:center;cursor:move;font-weight:700;margin:-2px 0 8px;";
    bar.innerHTML = "<span>🤖 Macro</span>";
    const close = document.createElement("span");
    close.textContent = "✕";
    close.style.cssText = "cursor:pointer;opacity:.8;padding:0 4px;";
    close.addEventListener("click", function () {
      togglePanel(false);
    });
    bar.appendChild(close);
    makeDraggable(panel, bar);
    panel.appendChild(bar);

    const add = document.createElement("div");
    add.style.cssText = "display:flex;flex-wrap:wrap;gap:6px;";
    add.appendChild(mkBtn("+ Read", "#2a7a55", function () { addStep("read"); }));
    add.appendChild(mkBtn("+ Fill", "#7a4ff6", function () { addStep("fill"); }));
    add.appendChild(mkBtn("+ Click", "#2a5a7a", function () { addStep("click"); }));
    add.appendChild(mkBtn("+ Wait", "#6a5a2a", function () { addStep("wait"); }));
    panel.appendChild(add);

    const list = document.createElement("div");
    list.style.cssText =
      "margin:8px 0;max-height:140px;overflow:auto;border-top:1px solid rgba(22,20,15,.15);border-bottom:1px solid rgba(22,20,15,.15);padding:4px 0;";
    panel._list = list;
    panel.appendChild(list);

    const cfg = document.createElement("div");
    cfg.style.cssText = "display:flex;align-items:center;gap:6px;font-size:12px;";
    cfg.innerHTML = "Repeat";
    const count = document.createElement("input");
    count.type = "number";
    count.min = "1";
    count.value = "1";
    count.style.cssText =
      "width:48px;padding:4px;border:1px solid rgba(22,20,15,0.18);border-radius:6px;background:#fffdf8;color:#16140f;";
    const every = document.createElement("span");
    every.textContent = "× every";
    const interval = document.createElement("input");
    interval.type = "number";
    interval.min = "0";
    interval.step = "0.5";
    interval.value = "1";
    interval.style.cssText =
      "width:48px;padding:4px;border:1px solid rgba(22,20,15,0.18);border-radius:6px;background:#fffdf8;color:#16140f;";
    cfg.appendChild(count);
    cfg.appendChild(every);
    cfg.appendChild(interval);
    cfg.appendChild(document.createTextNode("s"));
    panel._count = count;
    panel._interval = interval;
    panel.appendChild(cfg);

    const ctrl = document.createElement("div");
    ctrl.style.cssText = "display:flex;gap:6px;margin-top:8px;";
    ctrl.appendChild(mkBtn("▶ Run", "#2a7a55", run));
    ctrl.appendChild(mkBtn("⏹ Stop", "#a33", function () { stopFlag = true; }));
    ctrl.appendChild(mkBtn("Save", "#3a3160", save));
    ctrl.appendChild(mkBtn("Clear", "#3a3160", function () {
      steps = [];
      renderSteps();
    }));
    panel.appendChild(ctrl);

    logEl = document.createElement("textarea");
    logEl.readOnly = true;
    logEl.style.cssText =
      "width:100%;height:80px;margin-top:8px;border:1px solid rgba(22,20,15,0.18);border-radius:7px;" +
      "background:rgba(255,253,248,0.5);color:#16140f;font:11px monospace;padding:6px;resize:vertical;";
    panel.appendChild(logEl);

    document.body.appendChild(panel);
    load();
  }

  function save() {
    const data = {
      steps: steps,
      count: panel._count.value,
      interval: panel._interval.value,
    };
    chrome.storage.local.set({ [STORE_KEY]: data }, function () {
      log("💾 saved for " + location.hostname);
    });
  }

  function load() {
    chrome.storage.local.get([STORE_KEY], function (d) {
      const data = d[STORE_KEY];
      if (data && data.steps) {
        steps = data.steps;
        if (data.count) panel._count.value = data.count;
        if (data.interval) panel._interval.value = data.interval;
        renderSteps();
      }
    });
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
      if (!dragging) return;
      el.style.left = ox + (e.clientX - sx) + "px";
      el.style.top = oy + (e.clientY - sy) + "px";
    });
    document.addEventListener("mouseup", function () {
      dragging = false;
    });
  }

  function togglePanel(show) {
    if (!on) {
      return;
    }
    const firstTime = !panel;
    if (firstTime) {
      buildPanel();
    }
    const willShow =
      show === undefined ? firstTime || panel.style.display === "none" : show;
    panel.style.display = willShow ? "block" : "none";
  }

  // --- Wiring ---------------------------------------------------------------

  if (chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener(function (msg) {
      if (msg && msg.type === "toggle-macro") {
        togglePanel();
      }
    });
  }

  if (chrome.storage && chrome.storage.sync) {
    chrome.storage.sync.get({ macros: true }, function (s) {
      on = s.macros !== false;
    });
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area === "sync" && changes.macros) {
        on = !!changes.macros.newValue;
        if (!on && panel) {
          togglePanel(false);
        }
      }
    });
  }
})();
