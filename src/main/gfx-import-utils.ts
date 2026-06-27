// Shared helpers for the graphics-import paths (gfx-png-import.ts + bg-region-io.ts).

import { readFileSync } from 'node:fs'
import { decodePng, type ImageData } from 'snes-framework/png'
import { decodeAsepriteImage, decodeAsepriteRegion } from 'snes-framework/aseprite'
import { lz2, lz16 } from 'snes-framework/decompress'
import { snesToPC, type SymbolMap } from 'snes-framework/symbol-map'
import type { GfxFileEntry } from 'snes-framework/load-graphics'
import { gfxLiveEdits } from './gfx-live-cache'
import { saveGfxEdit } from './resources'

/** How a track's `.aseprite` flattens to RGBA: `'image'` = a single-image project
 *  (`decodeAsepriteImage`, the assembled-view exports); `'region'` = a tilemap layer
 *  flattened back (`decodeAsepriteRegion`, the BG-region / storybook-scene exports). It's a
 *  property of HOW the track was exported (not discoverable from the bytes), so the caller
 *  passes it explicitly — a wrong mode throws loudly on a missing tileset rather than
 *  silently mis-decoding. */
export type AseEditMode = 'image' | 'region'

/** Decode an edited graphics file to RGBA, cropped to the `w`×`h` canvas — the one gate
 *  every assembled-view importer shares. A `.aseprite` flattens per `aseMode`; a `.png`
 *  has the self-describing swatch to the right of the canvas, so it's cropped via
 *  `canvasRegion`. Reads the file once. Throws propagate to the caller's try/catch. */
export function decodeEditedToRgba(path: string, aseMode: AseEditMode, w: number, h: number): Uint8Array {
  const bytes = readFileSync(path)
  if (path.endsWith('.aseprite')) {
    return (aseMode === 'region' ? decodeAsepriteRegion(bytes) : decodeAsepriteImage(bytes)).rgba
  }
  return canvasRegion(decodePng(bytes), w, h)
}

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

// ── Per-(format,fileId) CHR tile-edit accumulation → saveGfxEdit ────────────────
// Shared by every importer that slices pixels back to CHR (the assembled-view
// tracks in gfx-png-import.ts AND the BG regions in bg-region-io.ts): each slicer
// emits per-tile edits which merge here before ONE re-encode per file. A
// `savedFileTiles` cache (passed in) makes edits to the SAME file across import
// blocks (e.g. a raw sheet + an assembled view + a BG region) merge last-write-wins
// instead of clobbering.

/** One sliced CHR tile edit, ready to fold into a FilePatchMap. */
export interface SlicedTileEdit { format: 'lz2' | 'lz16'; fileId: number; fileTile: number; bytes: Uint8Array }

/** Accumulated changed tiles per `${format}/${fileId}`. `tileBytes` is recorded when the
 *  caller knows it varies per file (BG regions: BG2 4bpp=32 vs BG3 2bpp=16 — same lz2
 *  format, different stride); when omitted, `applyTilePatches` falls back to `tileBytesOf`. */
export type FilePatchMap = Map<string, { fileId: number; format: 'lz2' | 'lz16'; tileBytes?: number; tiles: Map<number, Uint8Array> }>

/** Fold a slicer's edits into the patch map (last write wins per file-tile). Pass
 *  `tileBytes` when it's file-specific (BG regions); omit to resolve it at apply time. */
export function addTilePatches(filePatches: FilePatchMap, edits: readonly SlicedTileEdit[], tileBytes?: number): void {
  for (const ed of edits) {
    const key = `${ed.format}/${ed.fileId}`
    const fp = filePatches.get(key) ?? { fileId: ed.fileId, format: ed.format, tileBytes, tiles: new Map<number, Uint8Array>() }
    fp.tiles.set(ed.fileTile, ed.bytes)
    filePatches.set(key, fp)
  }
}

/** Re-encode each patched gfx file: start from the cross-block `savedFileTiles` cache (else
 *  the live-edit overlay, else the cart blob), splice the changed tiles at the file's tile
 *  stride (`fp.tileBytes` if set, else `tileBytesOf(format)`), and `saveGfxEdit`. Returns the
 *  number of files saved. `scope` names the loaded set for the "not loaded" error. */
export function applyTilePatches(filePatches: FilePatchMap, args: {
  manifest: GfxFileEntry[]
  scope: string
  tileBytesOf: (format: 'lz2' | 'lz16') => number
  rom: Uint8Array
  symbols: SymbolMap
  savedFileTiles: Map<string, Uint8Array>
  errors: string[]
}): { applied: number } {
  const { manifest, scope, tileBytesOf, rom, symbols, savedFileTiles, errors } = args
  let applied = 0
  for (const [key, fp] of filePatches) {
    try {
      const me = manifest.find((m) => m.format === fp.format && m.fileId === fp.fileId)
      if (!me) { errors.push(`gfx file 0x${fp.fileId.toString(16)}: not loaded in ${scope}`); continue }
      const rowCount = fp.format === 'lz16' ? me.sizeBytes / 512 : undefined
      const tileBytes = fp.tileBytes ?? tileBytesOf(fp.format)
      const prior = savedFileTiles.get(key)
      const tiles = prior ? prior.slice() : (liveTiles(fp.format, fp.fileId) ?? decodeGfxFile(rom, symbols, fp.format, fp.fileId, me.sizeBytes, rowCount))
      for (const [fileTile, bytes] of fp.tiles) tiles.set(bytes, fileTile * tileBytes)
      const r = saveGfxEdit(fp.format, fp.fileId, tiles, rowCount)
      if (r.ok) { savedFileTiles.set(key, tiles.slice()); applied++ }
      else errors.push(`gfx file 0x${fp.fileId.toString(16)}: ${r.error}`)
    } catch (err) {
      errors.push(`gfx file 0x${fp.fileId.toString(16)}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return { applied }
}
