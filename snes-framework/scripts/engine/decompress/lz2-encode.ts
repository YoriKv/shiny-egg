// LZ2 (LC_LZ2, Lunar Compress FORMAT=1) ENCODER — the inverse of `lz2.ts`.
//
// Produces a compressed stream that `lz2()` (and the cart's SuperFX
// `lz2_decompress`, and `decomp.exe FORMAT=1`) decode back to the input
// byte-for-byte. Used at build time to re-pack edited graphics blobs.
//
// We do NOT need to reproduce Lunar Compress's `recomp.exe` output bit-for-bit
// — any valid stream that round-trips is correct. We DO stay inside the command
// subset that real YI data exercises (opcodes 0..4, backref via opcode 4 only)
// so the cart-side decoder is guaranteed to accept it. See `lz2.ts` for the
// command-byte layout this mirrors.
//
// Parse: greedy by benefit (bytes saved vs literals) with one-step LAZY
// deferral — if emitting a literal exposes a strictly longer command next
// position, defer. Backref matches come from a 3-byte-prefix hash chain.
// This beats the cart's own packing and edges out `recomp`/`ycompress` on
// total size, while staying well clear of optimal-parse complexity.
//
// # Command set emitted
//
//   0x00 literal       — copy `len` raw bytes
//   0x20 run-byte      — repeat 1 byte `len` times
//   0x40 alternating   — repeat 2 bytes (a,b,a,b,…) `len` times
//   0x60 incrementing  — b, b+1, b+2, … (`len` bytes)
//   0x80 backref       — copy `len` bytes from output[offset] (offset 16-bit BE).
//                        We always use opcode 4 (0x80); the decoder aliases
//                        5/6/7 to it, and opcode 7 long-form would collide with
//                        the 0xFF terminator (0xE0|0x1C|0x03 == 0xFF), so we
//                        avoid it entirely.
//
// Length forms (mirrors the decoder):
//   short: `<op> | (len-1)`             — len 1..32, top 3 bits never 111
//   long:  `0xE0 | (op>>3 & 0x1C) | (L>>8)`, then `L & 0xFF`   — len 33..1024,
//          where L = len-1. For our opcodes the command byte lands in
//          0xE0..0xF3 — never 0xFF.

const MAX_SHORT_LEN = 32;
const MAX_LONG_LEN = 1024;
const MIN_MATCH = 3; // backref/run shorter than this never beats literals

// Hash-chain match finder tuning. Real YI gfx blobs are small (≤ a few KB), so
// these caps are generous; they only bound pathological inputs.
const HASH_BITS = 15;
const HASH_SIZE = 1 << HASH_BITS;
const MAX_CHAIN = 64;

function hash3(a: number, b: number, c: number): number {
  return ((a * 0x9e37 + b * 0x85eb + c * 0xc2b2) >>> (32 - HASH_BITS)) & (HASH_SIZE - 1);
}

interface Candidate {
  op: number; // 0x00/0x20/0x40/0x60/0x80
  len: number; // bytes covered
  cost: number; // total emitted bytes (header + payload)
  off?: number; // backref offset (absolute output index)
}

/** Emit a command header (short or long form) for `op` covering `len` bytes. */
function emitHeader(out: number[], op: number, len: number): void {
  if (len <= MAX_SHORT_LEN) {
    out.push(op | (len - 1));
  } else {
    const l = len - 1; // 0..1023
    out.push(0xe0 | ((op >> 3) & 0x1c) | (l >> 8));
    out.push(l & 0xff);
  }
}

const headerCost = (len: number): number => (len <= MAX_SHORT_LEN ? 1 : 2);

/**
 * Compress `data` into an LZ2 stream. The returned bytes, fed to `lz2()` with
 * `srcOff = 0`, reproduce `data` exactly (terminated by a 0xFF command).
 */
export function encodeLz2(data: Uint8Array): Uint8Array {
  const n = data.length;
  const out: number[] = [];

  // Pending run of literal bytes [litStart, d). Flushed (possibly split into
  // ≤1024-byte chunks) right before any special command, and at EOF.
  let litStart = -1;
  const flushLiterals = (end: number): void => {
    if (litStart < 0) return;
    let i = litStart;
    while (i < end) {
      const chunk = Math.min(end - i, MAX_LONG_LEN);
      emitHeader(out, 0x00, chunk);
      for (let k = 0; k < chunk; k++) out.push(data[i + k]!);
      i += chunk;
    }
    litStart = -1;
  };

  // Hash chains over 3-byte prefixes for backref search.
  const head = new Int32Array(HASH_SIZE).fill(-1);
  const prev = new Int32Array(n).fill(-1);
  const insert = (pos: number): void => {
    if (pos + 2 >= n) return;
    const h = hash3(data[pos]!, data[pos + 1]!, data[pos + 2]!);
    prev[pos] = head[h]!;
    head[h] = pos;
  };

  /** Longest LZ77 match at `d` (allowing overlap → periodic run extension). */
  const findBackref = (d: number): { len: number; off: number } | null => {
    if (d < 1 || d + 2 >= n) return null;
    const h = hash3(data[d]!, data[d + 1]!, data[d + 2]!);
    let p = head[h]!;
    let bestLen = 0;
    let bestOff = 0;
    let chain = MAX_CHAIN;
    const maxLen = Math.min(n - d, MAX_LONG_LEN);
    while (p >= 0 && chain-- > 0) {
      const period = d - p; // overlap period
      let l = 0;
      while (l < maxLen && data[d + l]! === data[p + (l % period)]!) l++;
      if (l > bestLen) {
        bestLen = l;
        bestOff = p;
        if (l >= maxLen) break;
      }
      p = prev[p]!;
    }
    return bestLen >= MIN_MATCH ? { len: bestLen, off: bestOff } : null;
  };

  // Best non-literal command starting at `d` (max benefit; tie-break fewer
  // bytes), or null if literals are no worse.
  const bestCommandAt = (d: number): Candidate | null => {
    let best: Candidate | null = null;
    const consider = (c: Candidate): void => {
      const benefit = c.len - c.cost;
      if (benefit < 1) return;
      if (
        best === null ||
        benefit > best.len - best.cost ||
        (benefit === best.len - best.cost && c.cost < best.cost)
      )
        best = c;
    };
    // run-byte
    {
      let l = 1;
      while (d + l < n && data[d + l]! === data[d]! && l < MAX_LONG_LEN) l++;
      if (l >= MIN_MATCH) consider({ op: 0x20, len: l, cost: headerCost(l) + 1 });
    }
    // incrementing
    {
      let l = 1;
      while (d + l < n && data[d + l]! === ((data[d]! + l) & 0xff) && l < MAX_LONG_LEN) l++;
      if (l >= MIN_MATCH) consider({ op: 0x60, len: l, cost: headerCost(l) + 1 });
    }
    // alternating (only meaningful when the two bytes differ)
    if (d + 1 < n && data[d]! !== data[d + 1]!) {
      const a = data[d]!;
      const b = data[d + 1]!;
      let l = 1;
      while (d + l < n && data[d + l]! === (l & 1 ? b : a) && l < MAX_LONG_LEN) l++;
      if (l >= 4) consider({ op: 0x40, len: l, cost: headerCost(l) + 2 });
    }
    // backref
    {
      const m = findBackref(d);
      if (m && m.off <= 0xffff)
        consider({ op: 0x80, len: m.len, cost: headerCost(m.len) + 2, off: m.off });
    }
    return best;
  };

  const emitCommand = (c: Candidate, d: number): void => {
    emitHeader(out, c.op, c.len);
    switch (c.op) {
      case 0x20: // run-byte
        out.push(data[d]!);
        break;
      case 0x40: // alternating pair
        out.push(data[d]!, data[d + 1]!);
        break;
      case 0x60: // incrementing — payload is the start value
        out.push(data[d]!);
        break;
      case 0x80: // backref — 2-byte big-endian offset
        out.push((c.off! >> 8) & 0xff, c.off! & 0xff);
        break;
    }
  };

  let d = 0;
  while (d < n) {
    const c = bestCommandAt(d);
    if (c !== null) {
      // Lazy: if deferring one byte exposes a strictly longer command, emit a
      // literal now and take the better command next iteration.
      const c2 = d + 1 < n ? bestCommandAt(d + 1) : null;
      if (c2 !== null && c2.len > c.len) {
        if (litStart < 0) litStart = d;
        insert(d);
        d++;
        continue;
      }
      flushLiterals(d);
      emitCommand(c, d);
      for (let k = 0; k < c.len; k++) insert(d + k);
      d += c.len;
    } else {
      if (litStart < 0) litStart = d;
      insert(d);
      d++;
    }
  }

  flushLiterals(n);
  out.push(0xff); // terminator
  return Uint8Array.from(out);
}
