// Shared helpers for the graphics-import paths (gfx-png-import.ts + bg-region-io.ts).

import type { ImageData } from 'snes-framework/png'
import { lz2, lz16 } from 'snes-framework/decompress'
import { snesToPC, type SymbolMap } from 'snes-framework/symbol-map'
import { gfxLiveEdits } from './gfx-live-cache'

/** The top-left `w`×`h` RGBA region of an exported PNG (the self-describing swatch
 *  sits to its right, so import reads only this corner). Throws if the artist
 *  resized the image below the expected canvas. */
export function canvasRegion(img: ImageData, w: number, h: number): Uint8Array {
  if (img.width < w || img.height < h) {
    throw new Error(`image is ${img.width}×${img.height}, expected ≥ ${w}×${h} (was it resized?)`)
  }
  const out = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = (y * img.width + x) * 4, d = (y * w + x) * 4
      out[d] = img.rgba[s]!; out[d + 1] = img.rgba[s + 1]!; out[d + 2] = img.rgba[s + 2]!; out[d + 3] = img.rgba[s + 3]!
    }
  }
  return out
}

/** A gfx file's CURRENT tile bytes from the editor's live-edit cache (unsaved-to-build
 *  edits) if present, else null (the caller falls back to the cart blob). So an import
 *  diffs + patches against what the canvas previews, not the last build. */
export function liveTiles(format: 'lz2' | 'lz16', fileId: number): Uint8Array | null {
  return gfxLiveEdits().get(`${format}/${fileId}`)?.slice() ?? null
}

/** Decompress a gfx file's whole tile blob from the cart (its `DATA_lz{2,16}_compressed_gfx_ptrs`
 *  pointer → LZ2/LZ16 decode), for the changed-vs-base check + the patch-and-resave apply. */
export function decodeGfxFile(
  rom: Uint8Array,
  symbols: SymbolMap,
  format: 'lz2' | 'lz16',
  fileId: number,
  sizeBytes: number,
  rowCount?: number
): Uint8Array {
  const tablePC = symbols.pc(format === 'lz16' ? 'DATA_lz16_compressed_gfx_ptrs' : 'DATA_lz2_compressed_gfx_ptrs')
  const p = tablePC + fileId * 3
  const srcPC = snesToPC(rom[p]! | (rom[p + 1]! << 8) | (rom[p + 2]! << 16))
  const out = new Uint8Array(sizeBytes)
  if (format === 'lz16') lz16(rom, srcPC, out, 0, rowCount!)
  else lz2(rom, srcPC, out, 0)
  return out
}
