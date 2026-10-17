// LZ2 (LC_LZ2, Lunar Compress FORMAT=1) ENCODER — the *exact* parse the cart's
// graphics and tilemaps were packed with. `encodeLz2(lz2(blob))` reproduces the
// original compressed bytes byte-for-byte for every LZ2 blob in the ROM, so
// re-encoding untouched data is a no-op and nothing downstream of it moves.
// `lz16-encode.ts` does the same job for the other format.
//
// This is the default parse, and the one to use whenever the result has to stay
// byte-comparable to the reference cart. Graphics that are *already* edited go
// through `lz2-encode-improved.ts` instead — see `encodeGfxBlob`, which makes
// that choice once for both formats.
//
// # Provenance
//
// The format is `lz2.ts` (SuperFX `lz2_decompress`, `$08:A980`). The *parse* —
// which command to emit where — is not implied by the format, so it was
// recovered empirically from the shipped data and then confirmed exhaustively:
// this encoder reproduces all 261 real LZ2 blobs in the USA V1.0 cart bit for
// bit (77,145 of 77,145 commands). The four `.lz2`-named blobs it does not
// cover (gfx IDs $2C-$2F) are orphaned LZ16 sheets sitting in LZ2 table slots,
// not LZ2 data at all — see `research/notes-rom-import-lz2-overread.md`.
//
// # The parse
//
// A single left-to-right pass with NO lookahead, no lazy matching and no cost
// comparison. At each position the first rule that fires wins:
//
//   1. fill (0x20)  — a run of one repeated byte, length >= 3.
//   2. word (0x40)  — an a,b,a,b,… run, length >= 4.
//   3. inc  (0x60)  — b, b+1, b+2, …, length >= 3.
//   4. backref (0x80) — the longest earlier match, length >= 4.
//   5. otherwise the byte joins a pending literal run, flushed before the next
//      command (or at end of input).
//
// The three run kinds are what makes the parse reproducible, because they
// *pre-empt* everything: a run is detected wherever it starts, and every other
// command has to stop short of it. Concretely:
//
//   - A fill run is always maximal — nothing pre-empts it.
//   - A word run stops where a fill run would start, yielding the boundary byte
//     to the fill (`00 ff 00 ff 00 00 00 00 00` codes as word=4 + fill=5, not
//     word=5 + fill=4).
//   - An increasing run stops where either a fill or a word run would start,
//     which is usually what disqualifies it: clipped below 3 it never fires, so
//     the bytes fall through to literals.
//   - A backref stops where ANY of the three would start. This is why the cart's
//     streams routinely split one long match into ref/word/ref: the match is not
//     truncated for cost reasons, it is truncated because a run began.
//
// Three quirks matter for byte-exactness, all confirmed across the whole corpus:
//
//   - Increasing runs do NOT wrap modulo 256. `fe ff 00` is a run of 2, not 3,
//     so it falls through to literals; the decoder wraps, the encoder never
//     emits a run that needs it.
//   - Among equal-length matches the encoder takes the EARLIEST (lowest offset),
//     not the nearest — i.e. first occurrence wins.
//   - The per-command length caps are not uniform: fill 1024 (the format
//     maximum), word 1023, backref 512. A run longer than its cap is emitted at
//     the cap and re-scanned from the new position, which is how the cart ends
//     up with e.g. word=1023 followed by a stray literal byte and then a fresh
//     word run.
//
// The literal cap is the one number the cart data cannot pin down (its longest
// literal run is 386 bytes), so we use the format maximum, 1024. Any choice
// round-trips; none can differ from the cart on cart data.
//
// # Command byte layout
//
// See `lz2.ts`. Short form `<op> | (len-1)` for len 1..32; long form
// `0xE0 | (op>>3 & 0x1C) | (L>>8)`, `L & 0xFF` for len 33..1024 with L = len-1.
// We only ever emit backrefs as opcode 4 (0x80) — the decoder aliases 5/6/7 onto
// it, and opcode 7's long form would collide with the 0xFF terminator.

const MAX_SHORT_LEN = 32;

/** Per-command length caps. Deliberately non-uniform — see the file header. */
const MAX_FILL = 1024;
const MAX_WORD = 1023;
const MAX_INC = 1024;
const MAX_MATCH = 512;
const MAX_LITERAL = 1024;

/** Minimum length at which each command fires. */
const MIN_FILL = 3;
const MIN_WORD = 4;
const MIN_INC = 3;
const MIN_MATCH = 4;

const OP_LITERAL = 0x00;
const OP_FILL = 0x20;
const OP_WORD = 0x40;
const OP_INC = 0x60;
const OP_BACKREF = 0x80;

const HASH_BITS = 14;
const HASH_SIZE = 1 << HASH_BITS;

/** Hash of the 4-byte prefix at `p`. Any match of MIN_MATCH bytes shares it, so
 *  a bucket holds every candidate a search must consider — the index is exact,
 *  not a heuristic, which is what lets the search stay byte-faithful. */
function hash4(d: Uint8Array, p: number): number {
  return (
    ((d[p]! * 0x9e37 + d[p + 1]! * 0x85eb + d[p + 2]! * 0xc2b2 + d[p + 3]! * 0x27d4) >>>
      (32 - HASH_BITS)) &
    (HASH_SIZE - 1)
  );
}

/** The run lengths the parse is driven by, measured at every position at once.
 *  Each is a property of the bytes alone, so one backward pass beats
 *  re-measuring per step. */
function runLengths(d: Uint8Array): { fill: Int32Array; word: Int32Array; inc: Int32Array } {
  const n = d.length;
  const fill = new Int32Array(n);
  const word = new Int32Array(n);
  const inc = new Int32Array(n);
  for (let i = n - 1; i >= 0; i--) {
    fill[i] = i + 1 < n && d[i + 1] === d[i] ? Math.min(fill[i + 1]! + 1, MAX_FILL) : 1;
    // No modulo wrap: `d[i+1] === d[i] + 1` is false at 0xFF, so a run stops
    // there rather than rolling over to 0x00.
    inc[i] = i + 1 < n && d[i + 1] === d[i]! + 1 ? Math.min(inc[i + 1]! + 1, MAX_INC) : 1;
    // a,b,a,b,… continues exactly when d[i+2] repeats d[i]; the tail from i+1 is
    // the same shape with the pair swapped, so its length carries.
    word[i] =
      i + 2 < n && d[i + 2] === d[i]
        ? Math.min(word[i + 1]! + 1, MAX_WORD)
        : Math.min(2, n - i);
  }
  return { fill, word, inc };
}

interface Cmd {
  op: number;
  len: number;
  pos: number;
  off: number;
}

/**
 * Compress `data` into an LZ2 stream, reproducing the cart's own parse.
 *
 * The result decodes back to `data` exactly (`lz2()` with `srcOff = 0`), and for
 * data that came out of a cart LZ2 blob it *is* that blob, byte for byte.
 */
export function encodeLz2(data: Uint8Array): Uint8Array {
  const n = data.length;
  const out: number[] = [];
  if (n === 0) return Uint8Array.from([0xff]);
  if (n > 0x10000) {
    // A backref offset is an absolute 16-bit index into the output, so this is
    // the largest structure the format can address at all.
    throw new Error(`encodeLz2: ${n} bytes exceeds the format's 0x10000-byte cap`);
  }

  const { fill, word, inc } = runLengths(data);

  // Where the next run of each kind starts, at or after each position. Built
  // back to front so each "does a run pre-empt me?" question is O(1). Length
  // n+1 because a position asks about i+1, and the last one asks about n.
  const nextFill = new Int32Array(n + 1);
  const nextWord = new Int32Array(n + 1);
  const nextRun = new Int32Array(n + 1);
  /** Word-run length at `i` after yielding to a fill run that starts inside it. */
  const wordLenAt = new Int32Array(n);
  /** Increasing-run length at `i` after yielding to both fill and word runs. */
  const incLenAt = new Int32Array(n);
  nextFill[n] = n;
  nextWord[n] = n;
  nextRun[n] = n;
  for (let i = n - 1; i >= 0; i--) {
    nextFill[i] = fill[i]! >= MIN_FILL ? i : nextFill[i + 1]!;
    wordLenAt[i] = Math.min(word[i]!, nextFill[i + 1]! - i);
    nextWord[i] = wordLenAt[i]! >= MIN_WORD ? i : nextWord[i + 1]!;
    incLenAt[i] = Math.min(inc[i]!, nextFill[i + 1]! - i, nextWord[i + 1]! - i);
    nextRun[i] =
      fill[i]! >= MIN_FILL || wordLenAt[i]! >= MIN_WORD || incLenAt[i]! >= MIN_INC
        ? i
        : nextRun[i + 1]!;
  }

  /** The run command starting at `p`, or null. Order is fill, word, inc. Only
   *  fill and word can both qualify at one position (a constant run is also an
   *  a,a,a,a run) and fill wins; inc excludes the other two by construction. */
  const runAt = (p: number): Cmd | null => {
    if (fill[p]! >= MIN_FILL) return { op: OP_FILL, len: fill[p]!, pos: p, off: 0 };
    if (wordLenAt[p]! >= MIN_WORD) return { op: OP_WORD, len: wordLenAt[p]!, pos: p, off: 0 };
    if (incLenAt[p]! >= MIN_INC) return { op: OP_INC, len: incLenAt[p]!, pos: p, off: 0 };
    return null;
  };

  // 4-byte-prefix index over the output-so-far, in oldest-first chain order so
  // the search naturally reports the earliest offset among equal-length matches.
  const head = new Int32Array(HASH_SIZE).fill(-1);
  const tail = new Int32Array(HASH_SIZE).fill(-1);
  const next = new Int32Array(n).fill(-1);
  let indexed = 0;
  const indexUpTo = (end: number): void => {
    for (; indexed < end; indexed++) {
      if (indexed + MIN_MATCH > n) break;
      const h = hash4(data, indexed);
      if (tail[h]! < 0) head[h] = indexed;
      else next[tail[h]!] = indexed;
      tail[h] = indexed;
    }
  };

  /**
   * Longest match at `p`, stopping short of the next run and of MAX_MATCH.
   *
   * Candidates are compared against `data` directly rather than through the
   * copy's period: for a self-overlapping match the two are provably the same
   * sequence, since every byte the copy would read back has already been matched.
   */
  const matchAt = (p: number): Cmd | null => {
    const limit = Math.min(MAX_MATCH, n - p, nextRun[p + 1]! - p);
    if (limit < MIN_MATCH) return null;
    indexUpTo(p);
    let best = 0;
    let bestOff = 0;
    for (let q = head[hash4(data, p)]!; q >= 0; q = next[q]!) {
      if (q >= p) break;
      // One comparison rules out a candidate that cannot beat the best so far.
      if (best > 0 && data[q + best] !== data[p + best]) continue;
      let l = 0;
      while (l < limit && data[p + l] === data[q + l]) l++;
      // Strictly greater only: ties keep the earlier (already-seen) offset.
      if (l > best) {
        best = l;
        bestOff = q;
        if (best === limit) break;
      }
    }
    return best >= MIN_MATCH ? { op: OP_BACKREF, len: best, pos: p, off: bestOff } : null;
  };

  const cmds: Cmd[] = [];
  let litStart = -1;
  const flushLiterals = (end: number): void => {
    if (litStart < 0) return;
    for (let i = litStart; i < end; i += MAX_LITERAL) {
      cmds.push({ op: OP_LITERAL, len: Math.min(end - i, MAX_LITERAL), pos: i, off: 0 });
    }
    litStart = -1;
  };

  let p = 0;
  while (p < n) {
    const cmd = runAt(p) ?? matchAt(p);
    if (cmd) {
      flushLiterals(p);
      cmds.push(cmd);
      p += cmd.len;
      continue;
    }
    if (litStart < 0) litStart = p;
    p++;
  }
  flushLiterals(n);

  for (const c of cmds) {
    if (c.len <= MAX_SHORT_LEN) out.push(c.op | (c.len - 1));
    else {
      const l = c.len - 1; // 0..1023
      out.push(0xe0 | ((c.op >> 3) & 0x1c) | (l >> 8), l & 0xff);
    }
    switch (c.op) {
      case OP_LITERAL:
        for (let k = 0; k < c.len; k++) out.push(data[c.pos + k]!);
        break;
      case OP_FILL:
      case OP_INC:
        out.push(data[c.pos]!);
        break;
      case OP_WORD:
        out.push(data[c.pos]!, data[c.pos + 1]!);
        break;
      default:
        out.push((c.off >> 8) & 0xff, c.off & 0xff); // big-endian — LZ2, not LZ1
        break;
    }
  }
  out.push(0xff); // terminator
  return Uint8Array.from(out);
}
