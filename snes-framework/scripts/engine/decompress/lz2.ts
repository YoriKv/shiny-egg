// LZ2 (Lunar Compress LC_LZ2, FORMAT=1) — on-disk format for YI's compressed
// graphics. Byte-for-byte ground-truth comparison against `decomp.exe FORMAT=1`
// passes for every YI blob we've sampled, while FORMAT=0 (true LC_LZ1) does
// not. The format differs from LC_LZ1 only in backref-offset endianness
// (big- vs little-endian). The SuperFX decompresses these in-cart and the
// result is DMA'd to VRAM. ~115 blobs use this format.
//
// # References (in order of authority):
//
// 1. **YI SuperFX `lz2_decompress`** at `$08:A980`
//    (`yi/SuperFX/Banks/Bank08.asm:7531`, docs/mchip.md §3.2 + §6.2). The
//    game-side implementation: opcode dispatch on the top 3 bits of each
//    command byte, with constants R5=$03FF (10-bit length mask), R6=$1F
//    (5-bit), R7=$00E0 (top-3-bit mask), R8=$00FF (terminator sentinel).
//    Backref reads two source bytes into R1 (low) then R0 (high) via
//    `WITH R1 / GETB` followed by `GETB`, then `SWAP / OR R1` builds the
//    16-bit offset as `(first_byte << 8) | second_byte` — big-endian
//    relative to stream order. Invoked by `decompress_lc_lz2` at `$00:B54D`.
// 2. **`Lunar Compress.dll` LunarDecompress FORMAT=1 (LC_LZ2)** — reference
//    by FuSoYa; decompiled inner decoder `FUN_004193ac` reached via
//    `FUN_00419780`. With flag != 0 the backref handler reads
//    `CONCAT11(DAT_00437575, DAT_00437576)` = (first_read << 8) | second_read,
//    i.e. big-endian. `lc200/decomp.exe` with FORMAT=1 is ground-truth and
//    byte-matches our output across all sampled YI blobs.
//
// # Command byte layout
//
//   bit 765432 10  meaning
//   - - - - - - - -
//   xxx<5-bit len>   "short" form: opcode = bits 7..5, len = bits 4..0 + 1
//   111<2-bit hi>    "long" form: opcode = bits 4..2 (shifted up), len = next
//                    byte appended below, total 10 bits + 1
//
// # Opcodes (after extracting the 3-bit opcode field)
//
//   000 0x00       literal:       copy `len` bytes verbatim from src
//   001 0x20       run-byte:      repeat next 1 byte `len` times
//   010 0x40       alternating:   repeat next 2 bytes (a,b,a,b,...) `len` times
//   011 0x60       incrementing:  write b, b+1, b+2, ... (`len` bytes from src+1)
//   1xx 0x80..0xE0 backreference: copy `len` bytes from output[destStart+offset].
//                                 Offset is the next 2 bytes, BIG-ENDIAN
//                                 (high byte first). All four "high-bit-set"
//                                 opcodes (4..7) decode identically here —
//                                 opcode 7 is only reachable via the long form,
//                                 5 and 6 via short form (decode-side they are
//                                 functionally aliases of 4).
//
// Terminator: 0xFF command byte.

import type { DecompResult } from './types.ts';

/**
 * Decompress an LZ2 stream from `src` starting at `srcOff` into `dest`
 * starting at `destOff`. Stops on the 0xFF terminator command.
 *
 * Returns the post-decompress source + destination offsets. Throws if the
 * source runs out before a terminator (malformed stream).
 */
export function lz2(
  src: Uint8Array,
  srcOff: number,
  dest: Uint8Array,
  destOff: number
): DecompResult {
  const destStart = destOff;
  const destEnd = dest.length;
  let s = srcOff;
  let d = destOff;

  // Defensive cap: a malformed stream (e.g. wrong offset, not LZ1 data) can
  // run forever because reading past `src.length` yields undefined / never
  // equals 0xFF. 4× the dest buffer is well past any plausible legitimate
  // expansion ratio.
  const maxIter = (destEnd - destStart) * 4 + 16;
  let iter = 0;

  while (true) {
    if (++iter > maxIter) {
      throw new Error(
        `lz2: aborted after ${iter} commands (no terminator reached; ` +
          `src ${s}, dest ${d - destStart}). The source likely isn't valid LZ2 ` +
          `data — a corrupt or incomplete built ROM; rebuild it.`
      );
    }
    if (s >= src.length) {
      throw new Error(
        `lz2: source exhausted at output offset ${d - destStart} (no terminator)`
      );
    }
    const cmd = src[s++];
    if (cmd === 0xff) return { srcEnd: s, destEnd: d };

    let len: number;
    let op: number;
    if ((cmd & 0xe0) === 0xe0) {
      // Long form: top 3 bits = 111, opcode in bits 4..2, length = 10 bits.
      if (s >= src.length) {
        throw new Error('lz2: source exhausted reading long-form length byte');
      }
      len = (((cmd & 0x03) << 8) | src[s++]) + 1;
      op = (cmd << 3) & 0xe0;
    } else {
      len = (cmd & 0x1f) + 1;
      op = cmd & 0xe0;
    }

    switch (op) {
      case 0x00: {
        // literal
        while (len-- > 0) dest[d++] = src[s++];
        break;
      }
      case 0x20: {
        // run-byte
        const v = src[s++];
        while (len-- > 0) dest[d++] = v;
        break;
      }
      case 0x40: {
        // alternating pair
        const a = src[s];
        const b = src[s + 1];
        s += 2;
        let i = 0;
        while (len-- > 0) dest[d++] = (i++ & 1) === 0 ? a : b;
        break;
      }
      case 0x60: {
        // incrementing run
        let v = src[s++];
        while (len-- > 0) dest[d++] = v++ & 0xff;
        break;
      }
      case 0x80:
      case 0xa0:
      case 0xc0:
      case 0xe0: {
        // backref — big-endian 2-byte offset into output buffer (LZ2 semantics)
        const off = (src[s] << 8) | src[s + 1];
        s += 2;
        let r = destStart + off;
        while (len-- > 0) dest[d++] = dest[r++];
        break;
      }
    }
  }
}
