// Codec for YI's SPC700 IPL upload-stream format — the container every audio
// artifact in the ROM uses (the engine image, the 7 sample banks, and the 12
// extracted song modules under assets/yi/SPC700/DATA_4E*.bin / DATA_4F*.bin).
//
// Wire format (emitted by %SPCDataBlockStart/End + %EndSPCUploadAndJumpToEngine
// in yi/SPC700/SPC700_Macros_YI.asm, consumed by CODE_SPC700Upload in Bank00):
//
//   repeat: [len:u16 LE] [aramDest:u16 LE] [payload: len bytes]
//   until:  [0000]       [entry:u16 LE]        (entry is always $0400)
//
// A `len` of 0 IS the terminator, so zero-length blocks cannot exist. Blocks
// may target any ARAM address; modules rely on upload ORDER (later blocks of a
// music set overwrite/append earlier ones — e.g. sample-dir entries at $3C60).
//
// serialize(parse(bytes)) is byte-identical by construction (block order and
// entry word are preserved verbatim); upload-stream.test.ts pins that against
// every extracted module bin and every ROM-resident module.

export interface UploadBlock {
  /** ARAM destination address of this block's payload. */
  dest: number;
  /** Payload bytes (a subarray view into the source buffer — copy before mutating). */
  data: Uint8Array;
}

export interface UploadStream {
  blocks: UploadBlock[];
  /** SPC700 entry point jumped to after the upload ($0400 in every YI module). */
  entry: number;
}

export interface ParsedUploadStream {
  stream: UploadStream;
  /** Total encoded size in bytes, terminator included (= module extent in ROM). */
  byteLength: number;
}

/** Upper bound on blocks per module — real modules have ≤ ~12; this catches a
 *  parse walking off into non-stream data. */
const MAX_BLOCKS = 64;

/**
 * Parse one upload stream starting at `offset`. Throws on malformed data
 * (truncation, block-count blowup) — callers hand this known module starts,
 * so failure means the offset or the data is wrong, not a recoverable state.
 */
export function parseUploadStream(bytes: Uint8Array, offset = 0): ParsedUploadStream {
  const blocks: UploadBlock[] = [];
  let p = offset;
  for (;;) {
    if (p + 4 > bytes.length) {
      throw new Error(`upload stream truncated: header at 0x${p.toString(16)} runs past end (0x${bytes.length.toString(16)})`);
    }
    const len = bytes[p] | (bytes[p + 1] << 8);
    const dest = bytes[p + 2] | (bytes[p + 3] << 8);
    p += 4;
    if (len === 0) {
      return { stream: { blocks, entry: dest }, byteLength: p - offset };
    }
    if (p + len > bytes.length) {
      throw new Error(`upload stream truncated: block at 0x${(p - 4).toString(16)} (dest 0x${dest.toString(16)}, len 0x${len.toString(16)}) runs past end`);
    }
    if (blocks.length >= MAX_BLOCKS) {
      throw new Error(`upload stream at 0x${offset.toString(16)}: more than ${MAX_BLOCKS} blocks — not a module start?`);
    }
    blocks.push({ dest, data: bytes.subarray(p, p + len) });
    p += len;
  }
}

export function serializeUploadStream(stream: UploadStream): Uint8Array {
  let size = 4; // terminator
  for (const b of stream.blocks) size += 4 + b.data.length;
  const out = new Uint8Array(size);
  let p = 0;
  const putWord = (w: number) => { out[p++] = w & 0xff; out[p++] = (w >> 8) & 0xff; };
  for (const b of stream.blocks) {
    putWord(b.data.length);
    putWord(b.dest);
    out.set(b.data, p);
    p += b.data.length;
  }
  putWord(0);
  putWord(stream.entry);
  return out;
}

/** Total ARAM bytes a stream writes (payload only — the measure that matters
 *  for ARAM budgets; the +8/block container overhead is a ROM-side cost). */
export function streamAramBytes(stream: UploadStream): number {
  return stream.blocks.reduce((n, b) => n + b.data.length, 0);
}
