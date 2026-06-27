// Shared low-level helpers for the M1TE2 ".M1" exports — the world map (world-map-m1te2.ts)
// and the system screens (screen-m1te2.ts). The .M1 codec itself is m1te2.ts; these are the
// VRAM/manifest/palette plumbing every M1TE2 producer repeats (a verbatim CHR window, a byte
// compare, a per-bpp file lookup, the editor's blacked-slot set).

import type { GfxFileEntry } from './load-graphics.ts';

/** M1TE2 force-zeroes colour 0 of 4bpp palette rows 1–7 on load (these CGRAM indices) — the
 *  SNES per-row transparent slots. A "change" there is the editor blanking, not an edit, so
 *  the palette diff skips them (an unedited round-trip then writes no palette). */
export const M1TE2_BLACKED = new Set([16, 32, 48, 64, 80, 96, 112]);

/** Copy a 1024-tile CHR window from VRAM verbatim (raw SNES planar = the exact .M1 CHR
 *  format, so no re-plane); `tileBytes` = 32 (4bpp) / 16 (2bpp); wraps at 64K. */
export function chrWindow(vram: Uint8Array, charAddr: number, tileBytes: number): Uint8Array {
  const out = new Uint8Array(1024 * tileBytes);
  for (let t = 0; t < 1024; t++) {
    for (let b = 0; b < tileBytes; b++) out[t * tileBytes + b] = vram[(charAddr + t * tileBytes + b) & 0xffff]!;
  }
  return out;
}

/** True if `a[aOff..aOff+n)` equals `b[bOff..bOff+n)` (the .M1-CHR-vs-VRAM tile compare). */
export function sameBytes(a: Uint8Array, aOff: number, b: Uint8Array, bOff: number, n: number): boolean {
  for (let i = 0; i < n; i++) if (a[aOff + i] !== b[bOff + i]) return false;
  return true;
}

/** Map a `bpp`-depth char-tile VRAM byte offset → its loaded gfx file + file-relative tile
 *  (stride-aware, so 4bpp $74/$75/$4C and 2bpp $56/f27 all resolve), or null. */
export function fileForVramByteBpp(
  manifest: GfxFileEntry[], vramByte: number, tileBytes: number
): { fileId: number; format: 'lz2' | 'lz16'; fileTile: number } | null {
  for (const e of manifest) {
    if (vramByte >= e.vramByteOffset && vramByte < e.vramByteOffset + e.sizeBytes) {
      return { fileId: e.fileId, format: e.format, fileTile: (vramByte - e.vramByteOffset) / tileBytes };
    }
  }
  return null;
}

/** A changed CGRAM colour an `.M1` import detected — the caller maps `cgramIndex` → the
 *  master-palette-blob offset (via the scene's provenance) for the write-back. */
export interface M1tePaletteEdit { cgramIndex: number; bgr15: number }

/** The palette half of every `.M1` diff: changed CGRAM colours in rows 0-7 (the 128 colours
 *  M1TE2 holds), skipping the auto-blacked transparent slots so an unedited round-trip writes
 *  nothing. Compares the 15-bit BGR words (bit15 masked). */
export function diffM1tePalette(docPalette: Uint8Array, cgram: Uint8Array): M1tePaletteEdit[] {
  const out: M1tePaletteEdit[] = [];
  for (let ci = 0; ci < 128; ci++) {
    if (M1TE2_BLACKED.has(ci)) continue;
    const d = (docPalette[ci * 2]! | (docPalette[ci * 2 + 1]! << 8)) & 0x7fff;
    const c = (cgram[ci * 2]! | (cgram[ci * 2 + 1]! << 8)) & 0x7fff;
    if (d !== c) out.push({ cgramIndex: ci, bgr15: d });
  }
  return out;
}
