// Magic Wand - first-party QR Code encoder.
// Byte mode, error-correction level M, versions 1-10. No dependencies.
// Exposes MWQR.generate(text) -> { size, modules } where modules is a
// size×size array of 0/1 (1 = dark).
(function (global) {
  "use strict";

  // --- GF(256) arithmetic (primitive polynomial 0x11d) ----------------------
  var EXP = new Array(512);
  var LOG = new Array(256);
  (function () {
    var x = 1;
    for (var i = 0; i < 255; i++) {
      EXP[i] = x;
      LOG[x] = i;
      x <<= 1;
      if (x & 0x100) {
        x ^= 0x11d;
      }
    }
    for (var j = 255; j < 512; j++) {
      EXP[j] = EXP[j - 255];
    }
  })();

  function gmul(a, b) {
    if (a === 0 || b === 0) {
      return 0;
    }
    return EXP[LOG[a] + LOG[b]];
  }

  // Generator polynomial for `n` EC codewords, returned leading-coeff-first.
  function rsGenPoly(n) {
    var g = [1];
    for (var i = 0; i < n; i++) {
      var ng = new Array(g.length + 1);
      for (var k = 0; k < ng.length; k++) {
        ng[k] = 0;
      }
      for (var j = 0; j < g.length; j++) {
        ng[j] ^= gmul(g[j], EXP[i]);
        ng[j + 1] ^= g[j];
      }
      g = ng;
    }
    return g.reverse(); // leading coeff first
  }

  function rsEncode(data, ecLen) {
    var gen = rsGenPoly(ecLen);
    var ec = new Array(ecLen);
    for (var i = 0; i < ecLen; i++) {
      ec[i] = 0;
    }
    for (var d = 0; d < data.length; d++) {
      var factor = (data[d] ^ ec[0]) & 0xff;
      ec.shift();
      ec.push(0);
      if (factor !== 0) {
        for (var j = 0; j < ecLen; j++) {
          ec[j] ^= gmul(gen[j + 1], factor);
        }
      }
    }
    return ec;
  }

  // --- Per-version tables (EC level M) --------------------------------------
  // [ecCodewordsPerBlock, [ [numBlocks, dataCwPerBlock], ... ] ]
  var VERSIONS = {
    1: [10, [[1, 16]]],
    2: [16, [[1, 28]]],
    3: [26, [[1, 44]]],
    4: [18, [[2, 32]]],
    5: [24, [[2, 43]]],
    6: [16, [[4, 27]]],
    7: [18, [[4, 31]]],
    8: [22, [[2, 38], [2, 39]]],
    9: [22, [[3, 36], [2, 37]]],
    10: [26, [[4, 43], [1, 44]]],
  };

  var ALIGN = {
    1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
    6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
  };

  var REMAINDER = { 1: 0, 2: 7, 3: 7, 4: 7, 5: 7, 6: 7, 7: 0, 8: 0, 9: 0, 10: 0 };

  function dataCapacity(version) {
    var info = VERSIONS[version];
    var total = 0;
    info[1].forEach(function (grp) {
      total += grp[0] * grp[1];
    });
    return total; // data codewords
  }

  // --- Bit buffer -----------------------------------------------------------
  function BitBuffer() {
    this.bits = [];
  }
  BitBuffer.prototype.put = function (value, length) {
    for (var i = length - 1; i >= 0; i--) {
      this.bits.push((value >>> i) & 1);
    }
  };

  // --- Encode ---------------------------------------------------------------
  function toBytes(text) {
    // UTF-8 encode.
    var out = [];
    for (var i = 0; i < text.length; i++) {
      var c = text.charCodeAt(i);
      if (c < 0x80) {
        out.push(c);
      } else if (c < 0x800) {
        out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
      } else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
        var c2 = text.charCodeAt(++i);
        var cp = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
        out.push(
          0xf0 | (cp >> 18),
          0x80 | ((cp >> 12) & 0x3f),
          0x80 | ((cp >> 6) & 0x3f),
          0x80 | (cp & 0x3f)
        );
      } else {
        out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
      }
    }
    return out;
  }

  function chooseVersion(byteLen) {
    for (var v = 1; v <= 10; v++) {
      var ccBits = v < 10 ? 8 : 16;
      var capacityBits = dataCapacity(v) * 8;
      var needed = 4 + ccBits + byteLen * 8;
      if (needed <= capacityBits) {
        return v;
      }
    }
    return -1;
  }

  function buildCodewords(bytes, version) {
    var info = VERSIONS[version];
    var ecLen = info[0];
    var dataCw = dataCapacity(version);
    var ccBits = version < 10 ? 8 : 16;

    var bb = new BitBuffer();
    bb.put(0x4, 4); // byte mode
    bb.put(bytes.length, ccBits);
    for (var i = 0; i < bytes.length; i++) {
      bb.put(bytes[i], 8);
    }
    // Terminator
    var maxBits = dataCw * 8;
    var term = Math.min(4, maxBits - bb.bits.length);
    bb.put(0, term);
    // Pad to byte boundary
    while (bb.bits.length % 8 !== 0) {
      bb.bits.push(0);
    }
    // Convert to bytes
    var data = [];
    for (var b = 0; b < bb.bits.length; b += 8) {
      var byte = 0;
      for (var k = 0; k < 8; k++) {
        byte = (byte << 1) | bb.bits[b + k];
      }
      data.push(byte);
    }
    // Pad codewords
    var pads = [0xec, 0x11];
    var pi = 0;
    while (data.length < dataCw) {
      data.push(pads[pi++ % 2]);
    }

    // Split into blocks, compute EC, interleave.
    var blocks = [];
    var idx = 0;
    info[1].forEach(function (grp) {
      for (var n = 0; n < grp[0]; n++) {
        var dataBlock = data.slice(idx, idx + grp[1]);
        idx += grp[1];
        blocks.push({ data: dataBlock, ec: rsEncode(dataBlock, ecLen) });
      }
    });

    var result = [];
    var maxData = 0;
    blocks.forEach(function (bl) {
      if (bl.data.length > maxData) {
        maxData = bl.data.length;
      }
    });
    for (var c = 0; c < maxData; c++) {
      for (var bi = 0; bi < blocks.length; bi++) {
        if (c < blocks[bi].data.length) {
          result.push(blocks[bi].data[c]);
        }
      }
    }
    for (var e = 0; e < ecLen; e++) {
      for (var bj = 0; bj < blocks.length; bj++) {
        result.push(blocks[bj].ec[e]);
      }
    }
    return result;
  }

  // --- Matrix construction --------------------------------------------------
  function buildMatrix(codewords, version) {
    var size = 17 + version * 4;
    var modules = [];
    var reserved = [];
    for (var r = 0; r < size; r++) {
      modules.push(new Array(size).fill(null));
      reserved.push(new Array(size).fill(false));
    }

    function setF(row, col, dark) {
      modules[row][col] = dark ? 1 : 0;
      reserved[row][col] = true;
    }

    // Finder pattern + separator at (row,col) top-left.
    function finder(row, col) {
      for (var r = -1; r <= 7; r++) {
        for (var c = -1; c <= 7; c++) {
          var rr = row + r;
          var cc = col + c;
          if (rr < 0 || rr >= size || cc < 0 || cc >= size) {
            continue;
          }
          var dark =
            r >= 0 && r <= 6 && (c === 0 || c === 6) ||
            c >= 0 && c <= 6 && (r === 0 || r === 6) ||
            (r >= 2 && r <= 4 && c >= 2 && c <= 4);
          setF(rr, cc, dark);
        }
      }
    }
    finder(0, 0);
    finder(0, size - 7);
    finder(size - 7, 0);

    // Timing patterns
    for (var t = 8; t < size - 8; t++) {
      setF(6, t, t % 2 === 0);
      setF(t, 6, t % 2 === 0);
    }

    // Alignment patterns
    var pos = ALIGN[version];
    for (var ai = 0; ai < pos.length; ai++) {
      for (var aj = 0; aj < pos.length; aj++) {
        var ar = pos[ai];
        var ac = pos[aj];
        if (reserved[ar][ac]) {
          continue; // overlaps finder
        }
        for (var dr = -2; dr <= 2; dr++) {
          for (var dc = -2; dc <= 2; dc++) {
            var dark2 =
              Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
            setF(ar + dr, ac + dc, dark2);
          }
        }
      }
    }

    // Dark module
    setF(size - 8, 8, true);

    // Reserve format info areas
    for (var f = 0; f < 9; f++) {
      if (!reserved[8][f]) {
        reserved[8][f] = true;
        modules[8][f] = 0;
      }
      if (!reserved[f][8]) {
        reserved[f][8] = true;
        modules[f][8] = 0;
      }
    }
    for (var g = 0; g < 8; g++) {
      reserved[8][size - 1 - g] = true;
      modules[8][size - 1 - g] = 0;
      reserved[size - 1 - g][8] = true;
      modules[size - 1 - g][8] = 0;
    }

    // Reserve version info (v7+)
    if (version >= 7) {
      for (var vr = 0; vr < 6; vr++) {
        for (var vc = 0; vc < 3; vc++) {
          reserved[vr][size - 11 + vc] = true;
          modules[vr][size - 11 + vc] = 0;
          reserved[size - 11 + vc][vr] = true;
          modules[size - 11 + vc][vr] = 0;
        }
      }
    }

    // Place data bits in zigzag.
    var bitIdx = 0;
    var totalBits = codewords.length * 8;
    function nextBit() {
      if (bitIdx >= totalBits) {
        return 0;
      }
      var byte = codewords[bitIdx >> 3];
      var bit = (byte >> (7 - (bitIdx & 7))) & 1;
      bitIdx++;
      return bit;
    }

    var up = true;
    for (var col = size - 1; col > 0; col -= 2) {
      if (col === 6) {
        col = 5; // skip timing column
      }
      for (var i = 0; i < size; i++) {
        var row = up ? size - 1 - i : i;
        for (var sub = 0; sub < 2; sub++) {
          var c2 = col - sub;
          if (!reserved[row][c2]) {
            modules[row][c2] = nextBit();
          }
        }
      }
      up = !up;
    }

    return { size: size, modules: modules, reserved: reserved };
  }

  // --- Masking --------------------------------------------------------------
  function maskFn(id, r, c) {
    switch (id) {
      case 0: return (r + c) % 2 === 0;
      case 1: return r % 2 === 0;
      case 2: return c % 3 === 0;
      case 3: return (r + c) % 3 === 0;
      case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
      case 5: return ((r * c) % 2) + ((r * c) % 3) === 0;
      case 6: return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
      case 7: return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
    }
    return false;
  }

  function applyMask(grid, id) {
    var size = grid.size;
    var m = [];
    for (var r = 0; r < size; r++) {
      m.push(grid.modules[r].slice());
      for (var c = 0; c < size; c++) {
        if (!grid.reserved[r][c] && maskFn(id, r, c)) {
          m[r][c] ^= 1;
        }
      }
    }
    return m;
  }

  function penalty(m) {
    var size = m.length;
    var score = 0;
    var r, c, i, run;
    // Rule 1: runs of 5+
    for (r = 0; r < size; r++) {
      run = 1;
      for (c = 1; c < size; c++) {
        if (m[r][c] === m[r][c - 1]) {
          run++;
        } else {
          if (run >= 5) score += 3 + (run - 5);
          run = 1;
        }
      }
      if (run >= 5) score += 3 + (run - 5);
    }
    for (c = 0; c < size; c++) {
      run = 1;
      for (r = 1; r < size; r++) {
        if (m[r][c] === m[r - 1][c]) {
          run++;
        } else {
          if (run >= 5) score += 3 + (run - 5);
          run = 1;
        }
      }
      if (run >= 5) score += 3 + (run - 5);
    }
    // Rule 2: 2x2 blocks
    for (r = 0; r < size - 1; r++) {
      for (c = 0; c < size - 1; c++) {
        var v = m[r][c];
        if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) {
          score += 3;
        }
      }
    }
    // Rule 3: finder-like patterns 1011101 with 0000 padding
    var pat1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
    var pat2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
    function match(line, idx) {
      var ok1 = true, ok2 = true;
      for (var k = 0; k < 11; k++) {
        if (line[idx + k] !== pat1[k]) ok1 = false;
        if (line[idx + k] !== pat2[k]) ok2 = false;
      }
      return ok1 || ok2;
    }
    for (r = 0; r < size; r++) {
      for (c = 0; c <= size - 11; c++) {
        if (match(m[r], c)) score += 40;
      }
    }
    for (c = 0; c < size; c++) {
      var col = [];
      for (r = 0; r < size; r++) col.push(m[r][c]);
      for (r = 0; r <= size - 11; r++) {
        if (match(col, r)) score += 40;
      }
    }
    // Rule 4: dark ratio
    var dark = 0;
    for (r = 0; r < size; r++) {
      for (c = 0; c < size; c++) dark += m[r][c];
    }
    var pct = (dark * 100) / (size * size);
    var prev = Math.floor(Math.abs(pct - 50) / 5);
    score += prev * 10;
    return score;
  }

  // --- Format & version info ------------------------------------------------
  function formatBits(maskId) {
    // EC level M = 0b00
    var data = (0 << 3) | maskId;
    var rem = data << 10;
    var gen = 0x537;
    for (var i = 14; i >= 10; i--) {
      if ((rem >> i) & 1) {
        rem ^= gen << (i - 10);
      }
    }
    var bits = ((data << 10) | rem) ^ 0x5412;
    return bits & 0x7fff;
  }

  function versionBits(version) {
    var rem = version << 12;
    var gen = 0x1f25;
    for (var i = 17; i >= 12; i--) {
      if ((rem >> i) & 1) {
        rem ^= gen << (i - 12);
      }
    }
    return ((version << 12) | rem) & 0x3ffff;
  }

  function placeFormat(m, size, maskId) {
    var bits = formatBits(maskId);
    for (var i = 0; i < 15; i++) {
      var bit = (bits >> i) & 1;
      // Around top-left
      if (i < 6) {
        m[8][i] = bit;
      } else if (i < 8) {
        m[8][i + 1] = bit;
      } else if (i === 8) {
        m[7][8] = bit;
      } else {
        m[14 - i][8] = bit;
      }
      // Around the other two corners
      if (i < 8) {
        m[size - 1 - i][8] = bit;
      } else {
        m[8][size - 15 + i] = bit;
      }
    }
    m[size - 8][8] = 1; // dark module
  }

  function placeVersion(m, size, version) {
    if (version < 7) {
      return;
    }
    var bits = versionBits(version);
    for (var i = 0; i < 18; i++) {
      var bit = (bits >> i) & 1;
      var row = Math.floor(i / 3);
      var col = i % 3;
      m[row][size - 11 + col] = bit;
      m[size - 11 + col][row] = bit;
    }
  }

  function generate(text) {
    var bytes = toBytes(String(text));
    var version = chooseVersion(bytes.length);
    if (version < 0) {
      throw new Error("Text too long for QR (max ~210 bytes).");
    }
    var codewords = buildCodewords(bytes, version);
    var grid = buildMatrix(codewords, version);
    var size = grid.size;

    var best = null;
    var bestScore = Infinity;
    for (var id = 0; id < 8; id++) {
      var masked = applyMask(grid, id);
      placeFormat(masked, size, id);
      placeVersion(masked, size, version);
      var s = penalty(masked);
      if (s < bestScore) {
        bestScore = s;
        best = masked;
      }
    }
    return { size: size, modules: best, version: version };
  }

  global.MWQR = { generate: generate };
})(typeof window !== "undefined" ? window : this);

if (typeof module !== "undefined" && module.exports) {
  module.exports = (typeof window !== "undefined" ? window : this).MWQR;
}
