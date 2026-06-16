// Magic Wand - Tools page logic.

// --- Generic "copy" buttons -------------------------------------------------
document.querySelectorAll("[data-copy]").forEach(function (btn) {
  btn.addEventListener("click", function () {
    const el = document.getElementById(btn.dataset.copy);
    const text = (el.value !== undefined ? el.value : el.textContent) || "";
    navigator.clipboard.writeText(text).then(function () {
      const old = btn.textContent;
      btn.textContent = "Copied!";
      setTimeout(function () {
        btn.textContent = old;
      }, 1000);
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
  const cell = 6;
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

// Prefill with the active tab's URL (stashed by the popup), else generate one.
chrome.storage.local.get(["mwToolsUrl"], function (d) {
  if (d.mwToolsUrl) {
    qrInput.value = d.mwToolsUrl;
    drawQR(d.mwToolsUrl);
    chrome.storage.local.remove("mwToolsUrl");
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
    alert("Your browser doesn't support the eyedropper API.");
    return;
  }
  new EyeDropper()
    .open()
    .then(function (res) {
      setColor(res.sRGBHex);
    })
    .catch(function () {});
});

// --- Password generator -----------------------------------------------------
const SETS = {
  pwLower: "abcdefghijklmnopqrstuvwxyz",
  pwUpper: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  pwDigit: "0123456789",
  pwSym: "!@#$%^&*()-_=+[]{};:,.?/",
};
const pwLen = document.getElementById("pwLen");
const lenVal = document.getElementById("lenVal");
const pwOut = document.getElementById("pwOut");

pwLen.addEventListener("input", function () {
  lenVal.textContent = pwLen.value;
});

function genPassword() {
  let pool = "";
  Object.keys(SETS).forEach(function (id) {
    if (document.getElementById(id).checked) {
      pool += SETS[id];
    }
  });
  if (!pool) {
    pwOut.textContent = "Pick at least one character set.";
    return;
  }
  const len = parseInt(pwLen.value, 10);
  const rnd = new Uint32Array(len);
  crypto.getRandomValues(rnd);
  let out = "";
  for (let i = 0; i < len; i++) {
    out += pool[rnd[i] % pool.length];
  }
  pwOut.textContent = out;
}
document.getElementById("pwGen").addEventListener("click", genPassword);
genPassword();

// --- Scratchpad -------------------------------------------------------------
const pad = document.getElementById("pad");
const padSaved = document.getElementById("padSaved");
let padTimer = null;

chrome.storage.local.get(["mwScratchpad"], function (d) {
  pad.value = d.mwScratchpad || "";
});
pad.addEventListener("input", function () {
  clearTimeout(padTimer);
  padTimer = setTimeout(function () {
    chrome.storage.local.set({ mwScratchpad: pad.value }, function () {
      padSaved.textContent = "✓ saved";
      setTimeout(function () {
        padSaved.textContent = "";
      }, 1200);
    });
  }, 400);
});
document.getElementById("padClear").addEventListener("click", function () {
  pad.value = "";
  chrome.storage.local.set({ mwScratchpad: "" });
});

// --- Converter --------------------------------------------------------------
const UNITS = {
  length: {
    Meters: 1, Kilometers: 1000, Centimeters: 0.01, Millimeters: 0.001,
    Miles: 1609.344, Yards: 0.9144, Feet: 0.3048, Inches: 0.0254,
    "Nautical miles": 1852,
  },
  mass: {
    Grams: 1, Kilograms: 1000, Milligrams: 0.001, Tonnes: 1e6,
    Pounds: 453.59237, Ounces: 28.349523125, Stone: 6350.29318,
  },
  data: {
    Bytes: 1, Kilobytes: 1024, Megabytes: 1048576, Gigabytes: 1073741824,
    Terabytes: 1099511627776, Bits: 0.125,
  },
  speed: {
    "m/s": 1, "km/h": 0.277778, "mph": 0.44704, Knots: 0.514444,
    "ft/s": 0.3048,
  },
  temp: { Celsius: 1, Fahrenheit: 1, Kelvin: 1 },
};
const convCat = document.getElementById("convCat");
const convFrom = document.getElementById("convFrom");
const convTo = document.getElementById("convTo");
const convVal = document.getElementById("convVal");
const convResult = document.getElementById("convResult");

function fillUnits() {
  const units = Object.keys(UNITS[convCat.value]);
  [convFrom, convTo].forEach(function (sel, i) {
    sel.innerHTML = "";
    units.forEach(function (u) {
      const o = document.createElement("option");
      o.value = u;
      o.textContent = u;
      sel.appendChild(o);
    });
    sel.selectedIndex = i === 1 && units.length > 1 ? 1 : 0;
  });
  convert();
}

function toBase(cat, unit, v) {
  if (cat === "temp") {
    if (unit === "Celsius") return v;
    if (unit === "Fahrenheit") return ((v - 32) * 5) / 9;
    return v - 273.15; // Kelvin -> Celsius base
  }
  return v * UNITS[cat][unit];
}
function fromBase(cat, unit, base) {
  if (cat === "temp") {
    if (unit === "Celsius") return base;
    if (unit === "Fahrenheit") return (base * 9) / 5 + 32;
    return base + 273.15;
  }
  return base / UNITS[cat][unit];
}

function convert() {
  const v = parseFloat(convVal.value);
  if (isNaN(v)) {
    convResult.textContent = "—";
    return;
  }
  const cat = convCat.value;
  const base = toBase(cat, convFrom.value, v);
  const res = fromBase(cat, convTo.value, base);
  convResult.textContent = Math.round(res * 1e6) / 1e6;
}

convCat.addEventListener("change", fillUnits);
[convFrom, convTo, convVal].forEach(function (el) {
  el.addEventListener("input", convert);
});
fillUnits();

// --- World clock ------------------------------------------------------------
const ZONES = [
  ["Local", undefined],
  ["New York", "America/New_York"],
  ["London", "Europe/London"],
  ["Stockholm", "Europe/Stockholm"],
  ["Tokyo", "Asia/Tokyo"],
  ["Los Angeles", "America/Los_Angeles"],
];
const clock = document.getElementById("clock");
ZONES.forEach(function (z) {
  const li = document.createElement("li");
  li.innerHTML = "<span>" + z[0] + "</span><span class='time' data-tz='" +
    (z[1] || "") + "'></span>";
  clock.appendChild(li);
});
function tickClock() {
  const now = new Date();
  clock.querySelectorAll(".time").forEach(function (el) {
    const tz = el.dataset.tz;
    el.textContent = now.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      timeZone: tz || undefined,
    });
  });
}
tickClock();
setInterval(tickClock, 1000);
