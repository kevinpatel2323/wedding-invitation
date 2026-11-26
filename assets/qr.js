/* Self-contained QR Code encoder — byte mode, error correction level M,
   versions 1–10 (enough for a URL of ~200 characters).
   No dependencies, no network, no API. encode(text) -> boolean[size][size].
   Reference: ISO/IEC 18004.                                              */
(function (global) {
  "use strict";

  // ── GF(256) arithmetic, primitive polynomial 0x11d ──────────────────
  const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
  for (let i = 0, x = 1; i < 255; i++) {
    EXP[i] = x; LOG[x] = i;
    x <<= 1; if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  const mul = (a, b) => (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]];

  // Reed–Solomon generator polynomial of the given degree
  function genPoly(degree) {
    let poly = [1];
    for (let d = 0; d < degree; d++) {
      const next = new Array(poly.length + 1).fill(0);
      for (let i = 0; i < poly.length; i++) {
        next[i] ^= mul(poly[i], 1);          // × x
        next[i + 1] ^= mul(poly[i], EXP[d]); // × α^d
      }
      poly = next;
    }
    return poly;
  }

  function ecCodewords(data, count) {
    const g = genPoly(count), rem = new Array(count).fill(0);
    for (const byte of data) {
      const factor = byte ^ rem[0];
      rem.shift(); rem.push(0);
      for (let i = 0; i < count; i++) rem[i] ^= mul(g[i + 1], factor);
    }
    return rem;
  }

  // ── Level-M block structure: [ecPerBlock, n1, data1, n2, data2] ─────
  const SPEC = {
    1: [10, 1, 16, 0, 0],  2: [16, 1, 28, 0, 0],  3: [26, 1, 44, 0, 0],
    4: [18, 2, 32, 0, 0],  5: [24, 2, 43, 0, 0],  6: [16, 4, 27, 0, 0],
    7: [18, 4, 31, 0, 0],  8: [22, 2, 38, 2, 39], 9: [22, 3, 36, 2, 37],
    10:[26, 4, 43, 1, 44]
  };
  const ALIGN = {
    1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34],
    7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50]
  };
  const dataCapacity = (v) => {
    const [, n1, d1, n2, d2] = SPEC[v];
    return n1 * d1 + n2 * d2;
  };
  const remainderBits = (v) => (v >= 2 && v <= 6) ? 7 : 0;

  // ── BCH codes for the format and version information strings ────────
  function bch(value, generator, genBits) {
    let v = value << genBits;
    for (let i = genBits + 5; i >= genBits; i--) {
      if (v >>> i & 1) v ^= generator << (i - genBits);
    }
    return v;
  }
  const formatBits = (mask) => {
    const data = (0x00 << 3) | mask;              // 0b00 = level M
    return ((data << 10) | bch(data, 0x537, 10)) ^ 0x5412;
  };
  function versionBits(v) {
    let rem = v;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    return (v << 12) | (rem & 0xfff);
  }

  // ── Encode the text into the final interleaved codeword stream ──────
  function codewords(text) {
    const bytes = new TextEncoder().encode(text);
    let version = 0;
    for (let v = 1; v <= 10; v++) {
      const lenBits = v < 10 ? 8 : 16;
      if (4 + lenBits + bytes.length * 8 <= dataCapacity(v) * 8) { version = v; break; }
    }
    if (!version) throw new Error("Text too long for version 10 (max ~210 bytes).");

    const bits = [];
    const push = (value, n) => { for (let i = n - 1; i >= 0; i--) bits.push(value >>> i & 1); };
    push(0b0100, 4);                                 // byte mode
    push(bytes.length, version < 10 ? 8 : 16);
    for (const b of bytes) push(b, 8);

    const capacityBits = dataCapacity(version) * 8;
    push(0, Math.min(4, capacityBits - bits.length)); // terminator
    while (bits.length % 8) bits.push(0);
    const padding = [0xec, 0x11];
    for (let i = 0; bits.length < capacityBits; i++) push(padding[i % 2], 8);

    const data = [];
    for (let i = 0; i < bits.length; i += 8) {
      let b = 0;
      for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
      data.push(b);
    }

    // split into blocks, compute parity, then interleave both halves
    const [ecLen, n1, d1, n2, d2] = SPEC[version];
    const dataBlocks = [], ecBlocks = [];
    let off = 0;
    for (let i = 0; i < n1 + n2; i++) {
      const size = i < n1 ? d1 : d2;
      const block = data.slice(off, off + size); off += size;
      dataBlocks.push(block);
      ecBlocks.push(ecCodewords(block, ecLen));
    }
    const out = [];
    for (let i = 0; i < Math.max(d1, d2); i++)
      for (const b of dataBlocks) if (i < b.length) out.push(b[i]);
    for (let i = 0; i < ecLen; i++) for (const b of ecBlocks) out.push(b[i]);
    return { version, out };
  }

  // ── Matrix construction ─────────────────────────────────────────────
  function encode(text) {
    const { version, out } = codewords(text);
    const size = version * 4 + 17;
    const m = Array.from({ length: size }, () => new Array(size).fill(null));
    const fn = Array.from({ length: size }, () => new Array(size).fill(false));
    const set = (r, c, dark) => { m[r][c] = dark; fn[r][c] = true; };

    // finder patterns + separators
    for (const [br, bc] of [[0, 0], [0, size - 7], [size - 7, 0]]) {
      for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) {
        const y = br + r, x = bc + c;
        if (y < 0 || x < 0 || y >= size || x >= size) continue;
        const d = Math.max(Math.abs(r - 3), Math.abs(c - 3));
        set(y, x, d !== 2 && d <= 3);
      }
    }
    // timing patterns
    for (let i = 8; i < size - 8; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
    // alignment patterns
    const centers = ALIGN[version];
    for (const r of centers) for (const c of centers) {
      if ((r === 6 && c === 6) || (r === 6 && c === size - 7) || (r === size - 7 && c === 6)) continue;
      for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++)
        set(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
    }
    // reserve format + version areas (values filled after masking)
    for (let i = 0; i < 9; i++) {
      if (!fn[8][i]) set(8, i, false);
      if (!fn[i][8]) set(i, 8, false);
    }
    for (let i = 0; i < 8; i++) { set(8, size - 1 - i, false); set(size - 1 - i, 8, false); }
    set(size - 8, 8, true);                                   // dark module
    if (version >= 7) {
      for (let i = 0; i < 18; i++) {
        set(size - 11 + (i % 3), Math.floor(i / 3), false);
        set(Math.floor(i / 3), size - 11 + (i % 3), false);
      }
    }

    // zig-zag data placement, right to left, skipping the timing column
    let bitIndex = 0;
    const totalBits = out.length * 8 + remainderBits(version);
    const nextBit = () => {
      if (bitIndex >= out.length * 8) { bitIndex++; return false; } // remainder bits are 0
      const bit = out[bitIndex >>> 3] >>> (7 - (bitIndex & 7)) & 1;
      bitIndex++;
      return bit === 1;
    };
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let v = 0; v < size; v++) {
        const up = ((size - 1 - right) >> 1) % 2 === 0;
        const r = up ? size - 1 - v : v;
        for (const c of [right, right - 1]) {
          if (!fn[r][c] && bitIndex < totalBits) m[r][c] = nextBit();
        }
      }
    }

    // ── pick the mask with the lowest penalty ───────────────────────
    const MASKS = [
      (r, c) => (r + c) % 2 === 0,
      (r) => r % 2 === 0,
      (r, c) => c % 3 === 0,
      (r, c) => (r + c) % 3 === 0,
      (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
      (r, c) => (r * c) % 2 + (r * c) % 3 === 0,
      (r, c) => ((r * c) % 2 + (r * c) % 3) % 2 === 0,
      (r, c) => ((r + c) % 2 + (r * c) % 3) % 2 === 0
    ];
    let best = null, bestScore = Infinity;
    for (let k = 0; k < 8; k++) {
      const g = m.map((row) => row.slice());
      for (let r = 0; r < size; r++) for (let c = 0; c < size; c++)
        if (!fn[r][c] && MASKS[k](r, c)) g[r][c] = !g[r][c];
      applyFormat(g, size, version, k);
      const s = penalty(g, size);
      if (s < bestScore) { bestScore = s; best = g; }
    }
    return best;
  }

  /* Format info, per ISO/IEC 18004 figure 25. Bits 0-5 run DOWN column 8 and
     bits 9-14 run LEFT along row 8 - transposing the two makes a code that
     round-trips against itself but that no real scanner can read. */
  function applyFormat(g, size, version, mask) {
    const f = formatBits(mask);
    const bit = (i) => (f >>> i & 1) === 1;
    // copy 1, around the top-left finder
    for (let i = 0; i <= 5; i++) g[i][8] = bit(i);
    g[7][8] = bit(6); g[8][8] = bit(7); g[8][7] = bit(8);
    for (let i = 9; i <= 14; i++) g[8][14 - i] = bit(i);
    // copy 2: bits 0-7 along row 8 from the right, bits 8-14 up column 8
    for (let i = 0; i <= 7; i++) g[8][size - 1 - i] = bit(i);
    for (let i = 8; i <= 14; i++) g[size - 15 + i][8] = bit(i);
    g[size - 8][8] = true;                                   // dark module
    if (version >= 7) {
      const v = versionBits(version);
      for (let i = 0; i < 18; i++) {
        const b = (v >>> i & 1) === 1;
        g[size - 11 + (i % 3)][Math.floor(i / 3)] = b;
        g[Math.floor(i / 3)][size - 11 + (i % 3)] = b;
      }
    }
  }

  function penalty(g, size) {
    let score = 0;
    const FINDER = [true, false, true, true, true, false, true];
    const runScore = (line) => {
      let s = 0, run = 1;
      for (let i = 1; i <= size; i++) {
        if (i < size && line[i] === line[i - 1]) { run++; continue; }
        if (run >= 5) s += 3 + (run - 5);
        run = 1;
      }
      // rule 3: finder-like pattern flanked by four light modules
      for (let i = 0; i + 7 <= size; i++) {
        if (!FINDER.every((v, j) => line[i + j] === v)) continue;
        const before = line.slice(Math.max(0, i - 4), i);
        const after = line.slice(i + 7, i + 11);
        if ((i >= 4 && before.every((v) => !v)) ||
            (after.length === 4 && after.every((v) => !v))) s += 40;
      }
      return s;
    };
    for (let i = 0; i < size; i++) {
      score += runScore(g[i]);
      score += runScore(g.map((row) => row[i]));
    }
    for (let r = 0; r < size - 1; r++) for (let c = 0; c < size - 1; c++) {
      const v = g[r][c];
      if (v === g[r][c + 1] && v === g[r + 1][c] && v === g[r + 1][c + 1]) score += 3;
    }
    let dark = 0;
    for (const row of g) for (const v of row) if (v) dark++;
    score += 10 * Math.floor(Math.abs(dark * 100 / (size * size) - 50) / 5);
    return score;
  }

  // ── Output helpers ──────────────────────────────────────────────────
  function toSvg(matrix, opts = {}) {
    const quiet = opts.quiet ?? 4;
    const dark = opts.dark ?? "#000000";
    const light = opts.light ?? "#ffffff";
    const n = matrix.length, total = n + quiet * 2;
    let path = "";
    for (let r = 0; r < n; r++) {
      let c = 0;
      while (c < n) {
        if (!matrix[r][c]) { c++; continue; }
        let run = 0;
        while (c + run < n && matrix[r][c + run]) run++;
        path += `M${c + quiet} ${r + quiet}h${run}v1h-${run}z`;
        c += run;
      }
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" `
      + `width="${total * 8}" height="${total * 8}" shape-rendering="crispEdges">`
      + `<rect width="${total}" height="${total}" fill="${light}"/>`
      + `<path d="${path}" fill="${dark}"/></svg>`;
  }

  global.QR = { encode, toSvg };
})(typeof window !== "undefined" ? window : globalThis);
