// Shared helpers for the graphics-import paths (gfx-png-import.ts + bg-region-io.ts).

import { readFileSync } from 'node:fs'
import { decodePng, type ImageData } from 'snes-framework/png'
import { decodeAsepriteImage, decodeAsepriteRegion } from 'snes-framework/aseprite'
import { lz2, lz16 } from 'snes-framework/decompress'
import { snesToPC, type SymbolMap } from 'snes-framework/symbol-map'
import { gfxLiveEdits } from './gfx-live-cache'

/** How a track's `.aseprite` flattens to RGBA: `'image'` = a single-image project
 *  (`decodeAsepriteImage`, the assembled-view exports); `'region'` = a tilemap layer
 *  flattened back (`decodeAsepriteRegion`, the BG-region / storybook-scene exports). It's a
 *  property of HOW the track was exported (not discoverable from the bytes), so the caller
 *  passes it explicitly — a wrong mode throws loudly on a missing tileset rather than
 *  silently mis-decoding. */
export type AseEditMode = 'image' | 'region'

/** Decode an edited graphics file to RGBA, cropped to the `w`×`h` canvas — the one gate
 *  every assembled-view importer shares. A `.aseprite` flattens per `aseMode`; a `.png`
 *  goes through `canvasRegion` (an indexed export IS the canvas; a legacy export had a
 *  palette swatch beside it). Reads the file once. Throws propagate to the caller. */
export function decodeEditedToRgba(path: string, aseMode: AseEditMode, w: number, h: number): Uint8Array {
  const bytes = readFileSync(path)
  if (path.endsWith('.aseprite')) {
    return (aseMode === 'region' ? decodeAsepriteRegion(bytes) : decodeAsepriteImage(bytes)).rgba
  }
  return canvasRegion(decodePng(bytes), w, h)
}

/** The top-left `w`×`h` RGBA region of an exported PNG. Current exports are exactly the
 *  canvas (the palette rides in the PNG's own palette chunk), so this is usually a
 *  straight copy; it still crops legacy exports, which stitched a palette swatch to the
 *  right. Throws if the artist resized the image below the expected canvas. */
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

// The per-(format,fileId) CHR tile-edit accumulation + re-encode that used to live here was
// replaced by the cross-file conflict reconciler (gfx-import-reconcile.ts): every importer now
// records CHR tiles into ONE shared `GfxImportReconciler` (tagged by source file), which merges,
// conflict-checks, and re-encodes once. `decodeGfxFile` + `liveTiles` above remain the shared
// decode/base primitives the reconciler's apply uses.
