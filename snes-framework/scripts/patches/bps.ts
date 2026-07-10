// BPS codec — the community-standard delta patch format (successor to IPS).
// Pure (no node/DOM), so it type-checks under both tsconfigs and tests via `node`.
//
// # Format (BPS1, per byuu's spec)
//
//   "BPS1"                        4-byte magic header
//   sourceSize   varint           expected source (base) file size
//   targetSize   varint           produced target file size
//   metadataSize varint
//   metadata     <metadataSize> bytes   optional free-form payload
//   command*                      varint-coded commands until 12 bytes remain:
//     data = varint; action = data & 3; length = (data >> 2) + 1
//       0 SourceRead   copy `length` source bytes at the CURRENT output offset
//       1 TargetRead   next `length` patch bytes are literal target data
//       2 SourceCopy   varint offset delta; copy `length` bytes from a roaming
//                      source cursor
//       3 TargetCopy   varint offset delta; copy `length` bytes from a roaming
//                      cursor over already-written target bytes (byte-by-byte,
//                      so a forward overlap RLE-repeats)
//     offset deltas are zig-zag-ish signed: (data & 1 ? -1 : +1) * (data >> 1)
//   sourceCrc    4 bytes LE       CRC-32 of the source file
//   targetCrc    4 bytes LE       CRC-32 of the target file
//   patchCrc     4 bytes LE       CRC-32 of the patch up to (excluding) this field
//
// Varints are little-endian base-128 with an offset bias: each continuation
// subtracts nothing but ADDS `shift` on continue (so multi-byte encodings have
// no redundant forms); the high bit marks the FINAL byte.
//
// The encoder here is a linear one (SourceRead runs where the files agree at the
// same offset, TargetRead elsewhere) — our patches are in-place edits of a 2 MB
// cart, where relocation-hunting SourceCopy/TargetCopy buys little. The decoder
// implements all four actions, so patches from delta encoders (Flips, beat)
// apply fine.

import type { PatchChunk } from '../types.ts';

const MAGIC = 'BPS1';
/** Source-match runs shorter than this ride inside the surrounding TargetRead —
 *  a run has to out-earn its ~2-byte command overhead to be worth a SourceRead. */
const MIN_SOURCE_RUN = 4;

// ── CRC-32 (IEEE reflected, the zlib/PNG polynomial) ────────────────────────

const CRC_TABLE = ((): Uint32Array => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** CRC-32 of a byte array (unsigned). */
export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const hex8 = (n: number): string => '0x' + n.toString(16).toUpperCase().padStart(8, '0');

// ── varint codec ─────────────────────────────────────────────────────────────

function writeNum(out: number[], value: number): void {
  let data = value;
  for (;;) {
    const x = data & 0x7f;
    data = Math.floor(data / 128);
    if (data === 0) {
      out.push(0x80 | x);
      return;
    }
    out.push(x);
    data--;
  }
}

/** Cursor-based reader over the patch bytes; throws instead of running past `end`. */
interface Cursor {
  buf: Uint8Array;
  pos: number;
  end: number;
}

function readNum(c: Cursor): number {
  let data = 0;
  let shift = 1;
  for (;;) {
    if (c.pos >= c.end) throw new Error(`truncated varint at ${c.pos}`);
    const x = c.buf[c.pos++];
    data += (x & 0x7f) * shift;
    if (x & 0x80) return data;
    shift *= 128;
    data += shift;
  }
}

const readU32LE = (b: Uint8Array, i: number): number =>
  (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;

// ── Header/footer probe ──────────────────────────────────────────────────────

/** The sizes + checksums a BPS file declares, without applying it (for import
 *  UX / error messages). Throws on a missing magic or a truncated file. */
export interface BpsInfo {
  sourceSize: number;
  targetSize: number;
  metadata: Uint8Array;
  sourceCrc: number;
  targetCrc: number;
  patchCrc: number;
  /** Whether `patchCrc` matches the patch bytes (structural self-check). */
  patchCrcOk: boolean;
}

export function bpsInfo(patch: Uint8Array): BpsInfo {
  // Smallest possible file: magic + three 1-byte varints + the 12-byte footer.
  if (patch.length < MAGIC.length + 3 + 12 || String.fromCharCode(...patch.subarray(0, 4)) !== MAGIC) {
    throw new Error('not a BPS file (missing BPS1 header)');
  }
  const c: Cursor = { buf: patch, pos: MAGIC.length, end: patch.length - 12 };
  const sourceSize = readNum(c);
  const targetSize = readNum(c);
  const metadataSize = readNum(c);
  if (c.pos + metadataSize > c.end) throw new Error('truncated metadata');
  const metadata = patch.subarray(c.pos, c.pos + metadataSize);
  const patchCrc = readU32LE(patch, patch.length - 4);
  return {
    sourceSize,
    targetSize,
    metadata,
    sourceCrc: readU32LE(patch, patch.length - 12),
    targetCrc: readU32LE(patch, patch.length - 8),
    patchCrc,
    patchCrcOk: crc32(patch.subarray(0, patch.length - 4)) === patchCrc
  };
}

// ── Apply ────────────────────────────────────────────────────────────────────

/**
 * Apply a BPS patch to `source`, producing the target. Validates everything the
 * format pins: the patch CRC (corruption), the source size + CRC (wrong base
 * file), every command's bounds, and the produced target's CRC. Throws with a
 * specific message on any mismatch.
 */
export function applyBps(patch: Uint8Array, source: Uint8Array): { target: Uint8Array; metadata: Uint8Array } {
  // Verify the whole-file CRC before parsing anything structural, so a corrupt
  // file reports corruption rather than whatever parse error the flipped byte
  // happens to cause.
  if (patch.length >= MAGIC.length + 3 + 12) {
    const stored = readU32LE(patch, patch.length - 4);
    const actual = crc32(patch.subarray(0, patch.length - 4));
    if (actual !== stored) {
      throw new Error(`patch is corrupt (patch CRC ${hex8(actual)} ≠ stored ${hex8(stored)})`);
    }
  }
  const info = bpsInfo(patch);
  if (source.length !== info.sourceSize) {
    throw new Error(`source size mismatch: patch expects ${info.sourceSize} bytes, got ${source.length}`);
  }
  const actualSourceCrc = crc32(source);
  if (actualSourceCrc !== info.sourceCrc) {
    throw new Error(
      `source CRC mismatch: patch expects ${hex8(info.sourceCrc)}, got ${hex8(actualSourceCrc)} — it targets a different base ROM`
    );
  }

  const c: Cursor = { buf: patch, pos: MAGIC.length, end: patch.length - 12 };
  readNum(c); // sourceSize
  readNum(c); // targetSize
  const metadataSize = readNum(c); // (compound-assigning this into c.pos would snapshot pos pre-read)
  c.pos += metadataSize; // skip metadata

  const target = new Uint8Array(info.targetSize);
  let outputOffset = 0;
  let sourceRelativeOffset = 0;
  let targetRelativeOffset = 0;

  while (c.pos < c.end) {
    const data = readNum(c);
    const action = data & 3;
    const length = (data - action) / 4 + 1;
    if (outputOffset + length > info.targetSize) {
      throw new Error(`command at ${c.pos} writes past the end of the target`);
    }
    switch (action) {
      case 0: {
        // SourceRead — mirror bytes at the current output offset.
        if (outputOffset + length > source.length) throw new Error(`SourceRead past the end of the source at ${outputOffset}`);
        target.set(source.subarray(outputOffset, outputOffset + length), outputOffset);
        outputOffset += length;
        break;
      }
      case 1: {
        // TargetRead — literal bytes from the patch.
        if (c.pos + length > c.end) throw new Error(`truncated TargetRead data at ${c.pos}`);
        target.set(patch.subarray(c.pos, c.pos + length), outputOffset);
        c.pos += length;
        outputOffset += length;
        break;
      }
      case 2: {
        // SourceCopy — roaming source cursor.
        const off = readNum(c);
        sourceRelativeOffset += (off & 1 ? -1 : 1) * Math.floor(off / 2);
        if (sourceRelativeOffset < 0 || sourceRelativeOffset + length > source.length) {
          throw new Error(`SourceCopy out of bounds (offset ${sourceRelativeOffset}, length ${length})`);
        }
        target.set(source.subarray(sourceRelativeOffset, sourceRelativeOffset + length), outputOffset);
        sourceRelativeOffset += length;
        outputOffset += length;
        break;
      }
      default: {
        // TargetCopy — roaming cursor over already-written output. Byte-by-byte
        // (NOT a block copy): a forward overlap deliberately repeats bytes.
        const off = readNum(c);
        targetRelativeOffset += (off & 1 ? -1 : 1) * Math.floor(off / 2);
        if (targetRelativeOffset < 0 || targetRelativeOffset >= outputOffset) {
          throw new Error(`TargetCopy reads unwritten output (offset ${targetRelativeOffset}, written ${outputOffset})`);
        }
        for (let i = 0; i < length; i++) target[outputOffset++] = target[targetRelativeOffset++];
        break;
      }
    }
  }

  if (outputOffset !== info.targetSize) {
    throw new Error(`patch produced ${outputOffset} of ${info.targetSize} target bytes`);
  }
  const actualTargetCrc = crc32(target);
  if (actualTargetCrc !== info.targetCrc) {
    throw new Error(`target CRC mismatch after apply: expected ${hex8(info.targetCrc)}, got ${hex8(actualTargetCrc)}`);
  }
  return { target, metadata: info.metadata };
}

// ── Encode ───────────────────────────────────────────────────────────────────

/**
 * Encode a BPS patch transforming `source` into `target` (linear encoder:
 * SourceRead where the files agree at the same offset, TargetRead elsewhere).
 * Any spec-conforming patcher can apply the result. `metadata` is embedded
 * verbatim when given (we normally leave it empty for maximum compatibility).
 */
export function encodeBps(source: Uint8Array, target: Uint8Array, metadata?: Uint8Array): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < MAGIC.length; i++) out.push(MAGIC.charCodeAt(i));
  writeNum(out, source.length);
  writeNum(out, target.length);
  writeNum(out, metadata?.length ?? 0);
  if (metadata) for (const b of metadata) out.push(b);

  const emit = (action: number, length: number): void => writeNum(out, (length - 1) * 4 + action);
  const cap = Math.min(source.length, target.length);
  let pos = 0;
  while (pos < target.length) {
    // Source-match run at the current offset?
    let run = 0;
    while (pos + run < cap && source[pos + run] === target[pos + run]) run++;
    if (run >= MIN_SOURCE_RUN || (run > 0 && pos + run === target.length)) {
      emit(0, run); // SourceRead
      pos += run;
      continue;
    }
    // TargetRead until the next worthwhile source run (or the end). Short match
    // runs are folded in — literal bytes that happen to equal the source are fine.
    let end = pos + Math.max(run, 1);
    while (end < target.length) {
      if (end < cap && source[end] === target[end]) {
        let r = 1;
        while (end + r < cap && source[end + r] === target[end + r]) r++;
        if (r >= MIN_SOURCE_RUN || end + r === target.length) break;
        end += r;
      } else {
        end++;
      }
    }
    emit(1, end - pos); // TargetRead
    for (let i = pos; i < end; i++) out.push(target[i]);
    pos = end;
  }

  const pushU32LE = (n: number): void => { out.push(n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff); };
  pushU32LE(crc32(source));
  pushU32LE(crc32(target));
  pushU32LE(crc32(Uint8Array.from(out)));
  return Uint8Array.from(out);
}

// ── Diff ─────────────────────────────────────────────────────────────────────

/**
 * Diff same-length `target` against `source` into EXACT contiguous changed
 * spans, as patch chunks. Unlike the encoder's segmentation above (which folds
 * short match runs into literals for patch size), no unchanged byte ever rides
 * a span and no gap is merged — callers layer the spans over other edits under
 * last-wins chunk ordering, where writing back an unchanged-vs-source byte in
 * a gap could clobber another patch's edit.
 */
export function diffSpans(source: Uint8Array, target: Uint8Array): PatchChunk[] {
  if (source.length !== target.length) {
    throw new Error(`diffSpans: source/target sizes differ (${source.length} vs ${target.length})`);
  }
  const spans: PatchChunk[] = [];
  for (let i = 0; i < target.length; ) {
    if (target[i] === source[i]) {
      i++;
      continue;
    }
    let j = i + 1;
    while (j < target.length && target[j] !== source[j]) j++;
    spans.push({ offset: i, bytes: target.slice(i, j) });
    i = j;
  }
  return spans;
}
