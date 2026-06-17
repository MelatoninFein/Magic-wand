// Magic Wand - macro builder/runner (top frame, gated by "macros").
//
// Build a small automation: pick fields/buttons on the page and add steps:
//   - Read field   : grab a field's text (stored as {grabbed})
//   - Counter      : type the auto-incrementing number into a picked field,
//                    then advance it by the step (00001, 00002, ...)
//   - Fill field   : type text into a field. Tokens: {grabbed} = last read
//                    value, {counter} = current counter value
//   - Clear        : empty a field completely
//   - Click        : click an element
//   - Hover        : hover an element
//   - Key          : press a key (e.g. Enter) on an element
//   - Scroll       : scroll the page by N pixels
//   - Scroll to    : scroll an element into view
//   - Top / Bottom : scroll to the top/bottom of the page
//   - Wait         : pause N ms
// Set a repeat count + interval, then Run/Stop. Saved per-site.
// Every Read value is collected and can be downloaded (JSON/TXT), copied, or
// cleared from the panel.
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
  let counterValue = ""; // current value of the {counter} token during a run
  let counterNum = 0; // running counter number
  let counterWidth = 1; // zero-pad width (from the start value's length)
  let counterStepVal = 1; // amount added when the counter advances
  let reads = []; // every value captured by Read steps (persisted per-site)
  const STORE_KEY = "mwMacro:" + location.hostname;
  const READS_KEY = "mwMacroReads:" + location.hostname;
  // Run state is kept in localStorage (synchronous) so it survives a page
  // navigation triggered by a step, letting the macro resume after reload.
  const LS_RUN = "mwMacroRun:" + location.hostname;
  let currentRun = null;

  function lsSaveRun(obj) {
    try {
      localStorage.setItem(LS_RUN, JSON.stringify(obj));
    } catch (e) {
      /* ignore */
    }
  }
  function lsLoadRun() {
    try {
      return JSON.parse(localStorage.getItem(LS_RUN) || "null");
    } catch (e) {
      return null;
    }
  }
  function lsClearRun() {
    try {
      localStorage.removeItem(LS_RUN);
    } catch (e) {
      /* ignore */
    }
  }

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

  // Zero-pad a number to a given width (keeps a leading minus outside padding).
  function padNum(n, width) {
    const neg = n < 0;
    let s = String(Math.abs(n));
    while (s.length < width) {
      s = "0" + s;
    }
    return (neg ? "-" : "") + s;
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

  // --- Collected read values (download / copy / clear) ----------------------

  function persistReads() {
    chrome.storage.local.set({ [READS_KEY]: reads });
  }

  function updateReadsLabel() {
    if (panel && panel._readsLbl) {
      panel._readsLbl.textContent = "📥 Reads collected: " + reads.length;
    }
  }

  function downloadBlob(name, text, mime) {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(url);
      a.remove();
    }, 1000);
  }

  function downloadReadsJSON() {
    downloadBlob(
      "macro-reads.json",
      JSON.stringify(reads, null, 2),
      "application/json"
    );
    log("⬇️ downloaded " + reads.length + " reads (JSON)");
  }

  function downloadReadsTXT() {
    downloadBlob("macro-reads.txt", reads.join("\n"), "text/plain");
    log("⬇️ downloaded " + reads.length + " reads (TXT)");
  }

  function copyReads() {
    const text = reads.join("\n");
    const done = function () {
      log("📋 copied " + reads.length + " reads");
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () {
        fallbackCopy(text, done);
      });
    } else {
      fallbackCopy(text, done);
    }
  }

  function fallbackCopy(text, done) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.cssText = "position:fixed;opacity:0;";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
      done();
    } catch (e) {
      log("copy failed");
    }
    ta.remove();
  }

  function clearReads() {
    reads = [];
    persistReads();
    updateReadsLabel();
    log("🗑️ reads cleared");
  }

  async function doStep(step) {
    // Steps that don't need a picked element.
    if (step.action === "wait") {
      await sleep(step.ms || 500);
      return;
    }
    if (step.action === "scroll") {
      window.scrollBy({ top: step.amount || 0, left: 0, behavior: "smooth" });
      log("🖱️ scroll " + (step.amount || 0) + "px");
      return;
    }
    if (step.action === "scrolltop" || step.action === "scrollbottom") {
      const y = step.action === "scrolltop" ? 0 : document.body.scrollHeight;
      window.scrollTo({ top: y, behavior: "smooth" });
      log("🖱️ scroll " + (step.action === "scrolltop" ? "to top" : "to bottom"));
      return;
    }

    const el = query(step.selector);
    if (!el) {
      log("⚠️ not found: " + step.selector);
      return;
    }
    if (step.action === "read") {
      lastGrabbed = el.value !== undefined ? el.value : el.textContent.trim();
      reads.push(lastGrabbed);
      persistReads();
      updateReadsLabel();
      log("📋 read: " + lastGrabbed);
    } else if (step.action === "fill") {
      let text = (step.value || "").split("{grabbed}").join(lastGrabbed);
      text = text.split("{counter}").join(counterValue);
      if (el.value !== undefined) {
        el.focus();
        setNativeValue(el, text);
      } else if (el.isContentEditable) {
        el.textContent = text;
      }
      log("⌨️ filled: " + text);
    } else if (step.action === "counter") {
      counterValue = padNum(counterNum, counterWidth);
      if (el.value !== undefined) {
        el.focus();
        setNativeValue(el, counterValue);
      } else if (el.isContentEditable) {
        el.textContent = counterValue;
        el.dispatchEvent(new Event("input", { bubbles: true }));
      }
      counterNum += counterStepVal;
      log("🔢 counter → " + counterValue);
    } else if (step.action === "clear") {
      if (el.value !== undefined) {
        el.focus();
        setNativeValue(el, "");
      } else if (el.isContentEditable) {
        el.textContent = "";
        el.dispatchEvent(new Event("input", { bubbles: true }));
      }
      log("🧹 cleared");
    } else if (step.action === "click") {
      el.click();
      log("🖱️ clicked");
    } else if (step.action === "scrollto") {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      log("🎯 scrolled to element");
    } else if (step.action === "hover") {
      ["pointerover", "mouseover", "mouseenter", "mousemove"].forEach(function (t) {
        el.dispatchEvent(
          new MouseEvent(t, { bubbles: t !== "mouseenter", cancelable: true, view: window })
        );
      });
      log("👆 hovered");
    } else if (step.action === "key") {
      el.focus();
      const key = step.key || "Enter";
      const code = key === "Enter" ? 13 : key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0;
      ["keydown", "keypress", "keyup"].forEach(function (t) {
        el.dispatchEvent(
          new KeyboardEvent(t, {
            key: key,
            code: key.length === 1 ? "Key" + key.toUpperCase() : key,
            keyCode: code,
            which: code,
            bubbles: true,
            cancelable: true,
          })
        );
      });
      log("⌨️ key: " + key);
    }
  }

  async function run(resume) {
    if (running) {
      return;
    }
    running = true;
    stopFlag = false;

    let st;
    if (resume && resume.active) {
      st = resume;
      steps = st.steps || steps;
    } else {
      const startStr = (panel._counterStart.value || "0").trim();
      let cn = parseInt(startStr, 10);
      if (isNaN(cn)) {
        cn = 0;
      }
      st = {
        active: true,
        steps: steps,
        index: 0,
        total: Math.max(1, parseInt(panel._count.value, 10) || 1),
        interval: Math.max(0, parseFloat(panel._interval.value) || 0) * 1000,
        counterNum: cn,
        counterWidth: startStr.length,
        counterStepVal: parseInt(panel._counterStep.value, 10) || 1,
        // A dedicated Counter step controls advancement; otherwise the counter
        // advances automatically once per loop.
        autoCounter: !steps.some(function (s) {
          return s.action === "counter";
        }),
      };
    }

    currentRun = st;
    counterNum = st.counterNum;
    counterWidth = st.counterWidth;
    counterStepVal = st.counterStepVal;

    log("▶️ run ×" + st.total + (resume ? " (resumed @ " + (st.index + 1) + ")" : ""));

    for (; st.index < st.total && !stopFlag; st.index++) {
      if (st.autoCounter) {
        counterValue = padNum(counterNum, counterWidth);
      }
      st.counterNum = counterNum;
      lsSaveRun(st); // persist progress before the (possibly navigating) steps
      for (let s = 0; s < steps.length && !stopFlag; s++) {
        await doStep(steps[s]);
        await sleep(250);
      }
      if (st.autoCounter) {
        counterNum += counterStepVal;
      }
      st.counterNum = counterNum;
      if (st.index < st.total - 1 && !stopFlag) {
        await sleep(st.interval);
      }
    }
    currentRun = null;
    lsClearRun();
    log(stopFlag ? "⏹️ stopped" : "✅ done");
    running = false;
  }

  // If a step navigates the page, mark the current iteration as completed so
  // the macro resumes at the next one after the reload.
  window.addEventListener("beforeunload", function () {
    if (!running || !currentRun) {
      return;
    }
    const next = Object.assign({}, currentRun);
    next.index = currentRun.index + 1;
    next.counterNum = counterNum + (currentRun.autoCounter ? counterStepVal : 0);
    if (next.index < next.total) {
      lsSaveRun(next);
    } else {
      lsClearRun();
    }
  });

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
      } else if (step.action === "scroll") {
        desc += " " + step.amount + "px";
      } else if (step.action === "key") {
        desc += " " + step.key;
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
    // Steps that need no element picking.
    if (action === "wait") {
      const ms = parseInt(prompt("Wait how many milliseconds?", "1000"), 10);
      if (!isNaN(ms)) {
        steps.push({ action: "wait", ms: ms });
        renderSteps();
      }
      return;
    }
    if (action === "scroll") {
      const px = parseInt(
        prompt("Scroll how many pixels? (negative = up)", "500"),
        10
      );
      if (!isNaN(px)) {
        steps.push({ action: "scroll", amount: px });
        renderSteps();
      }
      return;
    }
    if (action === "scrolltop" || action === "scrollbottom") {
      steps.push({ action: action });
      renderSteps();
      return;
    }

    // Element-picking steps.
    log("👉 click an element on the page… (Esc to cancel)");
    const selector = await pickElement();
    if (!selector) {
      log("picker cancelled");
      return;
    }
    if (action === "fill") {
      const value = prompt(
        "Text to type. Tokens: {grabbed} = last read value, " +
          "{counter} = auto-increment number (set start/step below).",
        "{counter}"
      );
      if (value === null) {
        return;
      }
      steps.push({ action: "fill", selector: selector, value: value });
    } else if (action === "key") {
      const key = prompt("Key to press (e.g. Enter):", "Enter");
      if (key === null) {
        return;
      }
      steps.push({ action: "key", selector: selector, key: key });
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
    add.appendChild(mkBtn("+ Read", "", function () { addStep("read"); }));
    add.appendChild(mkBtn("+ Counter", "", function () { addStep("counter"); }));
    add.appendChild(mkBtn("+ Fill", "", function () { addStep("fill"); }));
    add.appendChild(mkBtn("+ Clear", "", function () { addStep("clear"); }));
    add.appendChild(mkBtn("+ Click", "", function () { addStep("click"); }));
    add.appendChild(mkBtn("+ Hover", "", function () { addStep("hover"); }));
    add.appendChild(mkBtn("+ Key", "", function () { addStep("key"); }));
    add.appendChild(mkBtn("+ Scroll", "", function () { addStep("scroll"); }));
    add.appendChild(mkBtn("+ Scroll to", "", function () { addStep("scrollto"); }));
    add.appendChild(mkBtn("+ Top", "", function () { addStep("scrolltop"); }));
    add.appendChild(mkBtn("+ Bottom", "", function () { addStep("scrollbottom"); }));
    add.appendChild(mkBtn("+ Wait", "", function () { addStep("wait"); }));
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

    // Counter config (for the {counter} token in Fill steps).
    const cfg2 = document.createElement("div");
    cfg2.style.cssText =
      "display:flex;align-items:center;gap:6px;font-size:12px;margin-top:6px;";
    cfg2.appendChild(document.createTextNode("{counter}"));
    const cStart = document.createElement("input");
    cStart.type = "text";
    cStart.value = "00001";
    cStart.title = "Start value (its length sets zero-padding)";
    cStart.style.cssText =
      "width:64px;padding:4px;border:1px solid rgba(22,20,15,0.18);border-radius:6px;background:#fffdf8;color:#16140f;text-align:center;";
    cfg2.appendChild(cStart);
    cfg2.appendChild(document.createTextNode("+"));
    const cStep = document.createElement("input");
    cStep.type = "number";
    cStep.value = "1";
    cStep.title = "Amount added each loop";
    cStep.style.cssText =
      "width:48px;padding:4px;border:1px solid rgba(22,20,15,0.18);border-radius:6px;background:#fffdf8;color:#16140f;";
    cfg2.appendChild(cStep);
    cfg2.appendChild(document.createTextNode("/loop"));
    panel._counterStart = cStart;
    panel._counterStep = cStep;
    panel.appendChild(cfg2);

    const ctrl = document.createElement("div");
    ctrl.style.cssText = "display:flex;gap:6px;margin-top:8px;";
    ctrl.appendChild(mkBtn("▶ Run", "", function () { run(); }));
    ctrl.appendChild(mkBtn("⏹ Stop", "", function () { stopFlag = true; lsClearRun(); }));
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

    // Collected reads bar
    const readsBar = document.createElement("div");
    readsBar.style.cssText =
      "display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:8px;";
    const readsLbl = document.createElement("span");
    readsLbl.style.cssText = "flex-basis:100%;font-size:12px;font-weight:700;";
    readsBar.appendChild(readsLbl);
    readsBar.appendChild(mkBtn("⬇ JSON", "", downloadReadsJSON));
    readsBar.appendChild(mkBtn("⬇ TXT", "", downloadReadsTXT));
    readsBar.appendChild(mkBtn("Copy", "", copyReads));
    readsBar.appendChild(mkBtn("Clear", "", clearReads));
    panel._readsLbl = readsLbl;
    panel.appendChild(readsBar);

    document.body.appendChild(panel);
    load();
  }

  function save() {
    const data = {
      steps: steps,
      count: panel._count.value,
      interval: panel._interval.value,
      counterStart: panel._counterStart.value,
      counterStep: panel._counterStep.value,
    };
    chrome.storage.local.set({ [STORE_KEY]: data }, function () {
      log("💾 saved for " + location.hostname);
    });
  }

  function load() {
    chrome.storage.local.get([STORE_KEY, READS_KEY], function (d) {
      const data = d[STORE_KEY];
      if (data && data.steps) {
        steps = data.steps;
        if (data.count) panel._count.value = data.count;
        if (data.interval) panel._interval.value = data.interval;
        if (data.counterStart) panel._counterStart.value = data.counterStart;
        if (data.counterStep) panel._counterStep.value = data.counterStep;
        renderSteps();
      }
      reads = d[READS_KEY] || [];
      updateReadsLabel();
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
      // Resume a macro that was interrupted by a page navigation.
      const pending = lsLoadRun();
      if (on && pending && pending.active && pending.index < pending.total) {
        togglePanel(true);
        setTimeout(function () {
          run(pending);
        }, 900);
      }
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
