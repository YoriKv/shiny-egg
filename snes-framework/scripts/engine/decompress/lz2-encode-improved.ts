// LZ2 (LC_LZ2, Lunar Compress FORMAT=1) ENCODER — the *smallest* parse.
//
// Emits the smallest stream the format can express for the input: a
// shortest-path parse, not a heuristic one. It cannot reproduce cart bytes (the
// cart's own parse is not optimal), which is why `lz2-encode.ts` and not this is
// the default. `encodeGfxBlob` uses this one for a blob being written into the
// overlay — that blob is edited by definition, so there is no cart blob left to
// match and the space is pure headroom.
//
// # Why a shortest path is available at all
//
// Every command covers a contiguous span and costs a known number of bytes
// (header + payload), with no adaptive state carried between commands — no
// dictionary that a choice here changes over there, since backref offsets are
// absolute into the output. So the cost of encoding `data[i..]` depends only on
// `i`, and the minimum over all parses is a shortest path across positions
// `0..n`. That is unusual for an LZ format and is what makes "optimal" cheap
// here where it normally is not.
//
// The only per-position input is the LONGEST backref available: a match of
// length L exists at the longest match's offset for every L below it, and a
// command's cost depends on L alone, never on the offset. So one match search
// per position feeds every backref transition out of it.
//
// # What it buys
//
// Measured over the cart's 261 LZ2 blobs (357,277 B as shipped):
//
//   cart's own parse   357,277 B     — what `lz2-encode.ts` reproduces
//   greedy + lazy      314,255 B   −12.0%   — what this file used to do
//   recomp.exe         313,942 B   −12.1%   — Lunar Compress's own recompressor
//   this               309,235 B   −13.5%   — smaller on 245 of 261, never larger
//
// Being optimal, it is never larger than any of them on any input, so the
// comparison needs no per-blob caveats. Costs ~10 ms for a 4 KB blob (~110 ms
// worst case over the cart's blobs), against ~1 ms for the greedy parse — which
// is why the exact parse, not this, stays the default for bulk work.

const MAX_LEN = 1024; // long form: (cmd & 3) << 8 | byte, +1
const MAX_SHORT_LEN = 32;
const MIN_RUN = 3; // below this no command can beat literals

const OP_LITERAL = 0x00;
const OP_FILL = 0x20;
const OP_WORD = 0x40;
const OP_INC = 0x60;
const OP_BACKREF = 0x80;

const HASH_BITS = 15;
const HASH_SIZE = 1 << HASH_BITS;

const headerCost = (len: number): number => (len <= MAX_SHORT_LEN ? 1 : 2);

interface Step {
  op: number;
  len: number;
  off: number;
}

/**
 * Compress `data` into the smallest valid LZ2 stream.
 *
 * The result decodes back to `data` exactly (`lz2()` with `srcOff = 0`). It is
 * NOT the cart's bytes for cart data — use `encodeLz2` when that matters.
 */
export function encodeLz2Improved(data: Uint8Array): Uint8Array {
  const n = data.length;
  if (n === 0) return Uint8Array.from([0xff]);
  if (n > 0x10000) {
    throw new Error(`encodeLz2Improved: ${n} bytes exceeds the format's 0x10000-byte cap`);
  }

  // How far each run kind reaches from every position. Unlike the cart's parse
  // this one has no run-vs-run precedence to model: the shortest path considers
  // every length of every command and picks whatever actually wins.
  const fill = new Int32Array(n);
  const inc = new Int32Array(n);
  const word = new Int32Array(n);
  for (let i = n - 1; i >= 0; i--) {
    fill[i] = i + 1 < n && data[i + 1] === data[i] ? Math.min(fill[i + 1]! + 1, MAX_LEN) : 1;
    // The decoder's increasing run wraps, so unlike `lz2-encode.ts` this may use
    // a run through 0xFF → 0x00; nothing here has to match the cart.
    inc[i] =
      i + 1 < n && data[i + 1] === ((data[i]! + 1) & 0xff) ? Math.min(inc[i + 1]! + 1, MAX_LEN) : 1;
    word[i] =
      i + 2 < n && data[i + 2] === data[i]
        ? Math.min(word[i + 1]! + 1, MAX_LEN)
        : Math.min(2, n - i);
  }

  // Longest match per position, over a 4-byte-prefix chain (any match of the
  // MIN_RUN..MAX_LEN we care about shares its first 4 bytes once it reaches 4;
  // shorter ones are covered because a longer match's offset serves them too).
  const hash4 = (p: number): number =>
    ((data[p]! * 0x9e37 + data[p + 1]! * 0x85eb + data[p + 2]! * 0xc2b2 + data[p + 3]! * 0x27d4) >>>
      (32 - HASH_BITS)) &
    (HASH_SIZE - 1);
  const head = new Int32Array(HASH_SIZE).fill(-1);
  const prev = new Int32Array(n).fill(-1);
  const matchLen = new Int32Array(n);
  const matchOff = new Int32Array(n);
  for (let p = 0; p + 4 <= n; p++) {
    const h = hash4(p);
    let best = 0;
    let off = 0;
    const limit = Math.min(MAX_LEN, n - p);
    for (let q = head[h]!; q >= 0; q = prev[q]!) {
      // One comparison rules out a candidate that cannot beat the best so far.
      if (best > 0 && data[q + best] !== data[p + best]) continue;
      let l = 0;
      // Compared against `data` directly: for a self-overlapping match the copy
      // reads back bytes it has already written, which are these same bytes.
      while (l < limit && data[p + l] === data[q + l]) l++;
      if (l > best) {
        best = l;
        off = q;
        if (best === limit) break;
      }
    }
    matchLen[p] = best;
    matchOff[p] = off;
    prev[p] = head[h]!;
    head[h] = p;
  }

  // Shortest path, back to front. `cost[i]` = bytes to encode data[i..n)
  // including the terminator; `step[i]` = the command that achieves it.
  const cost = new Int32Array(n + 1).fill(0x7fffffff);
  const step: (Step | null)[] = new Array(n + 1).fill(null);
  cost[n] = 1; // the 0xFF terminator
  for (let i = n - 1; i >= 0; i--) {
    let best = 0x7fffffff;
    let bestStep: Step | null = null;
    const consider = (op: number, len: number, payload: number, off: number): void => {
      const c = headerCost(len) + payload + cost[i + len]!;
      if (c < best) {
        best = c;
        bestStep = { op, len, off };
      }
    };
    // Literals of every length: a long-form run is not always splittable into
    // short ones at equal cost, so the whole range has to be on the table.
    const maxLit = Math.min(MAX_LEN, n - i);
    for (let l = 1; l <= maxLit; l++) consider(OP_LITERAL, l, l, 0);
    for (let l = MIN_RUN; l <= fill[i]!; l++) consider(OP_FILL, l, 1, 0);
    for (let l = MIN_RUN; l <= inc[i]!; l++) consider(OP_INC, l, 1, 0);
    for (let l = MIN_RUN; l <= word[i]!; l++) consider(OP_WORD, l, 2, 0);
    const ml = matchLen[i]!;
    for (let l = MIN_RUN; l <= ml; l++) consider(OP_BACKREF, l, 2, matchOff[i]!);
    cost[i] = best;
    step[i] = bestStep;
  }

  const out: number[] = [];
  for (let i = 0; i < n; ) {
    const s = step[i]!;
    if (s.len <= MAX_SHORT_LEN) out.push(s.op | (s.len - 1));
    else {
      const l = s.len - 1; // 0..1023
      // For our five opcodes the long-form byte lands in 0xE0..0xF3 — never the
      // 0xFF terminator, which only opcode 7's long form could collide with.
      out.push(0xe0 | ((s.op >> 3) & 0x1c) | (l >> 8), l & 0xff);
    }
    switch (s.op) {
      case OP_LITERAL:
        for (let k = 0; k < s.len; k++) out.push(data[i + k]!);
        break;
      case OP_FILL:
      case OP_INC:
        out.push(data[i]!);
        break;
      case OP_WORD:
        out.push(data[i]!, data[i + 1]!);
        break;
      default:
        out.push((s.off >> 8) & 0xff, s.off & 0xff); // big-endian — LZ2, not LZ1
        break;
    }
    i += s.len;
  }
  out.push(0xff); // terminator
  return Uint8Array.from(out);
}
