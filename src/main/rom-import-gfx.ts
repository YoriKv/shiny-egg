// Graphics diff for the ROM importer: decompress every gfx sheet in a foreign
// cart, compare to base, and yield the changed sheets as decompressed tile bytes
// ready for `saveGfxEdit`. Two formats:
//   - lz2 sheets self-terminate, so their decompressed size is discovered by
//     decoding — every lz2 blob is covered (BG1/BG3 tilesets, screen/title sheets,
//     BG tilemaps).
//   - lz16 sheets need their decompressed size up front; it comes from the
//     level-gfx size registry (`gfxSizeRegistry`, a walk of every level's gfx
//     manifest). lz16 sheets no level loads aren't sized, so aren't diffed.
// A sheet that changed but can't be safely imported (resized, or its stream won't
// decode) is counted as `skipped`, never silently dropped. Resolves the gfx
// pointer tables at fixed addresses, so a hack that relocated the blobs (but kept
// the tables) still aligns — like the palette/name importers.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import * as path from 'node:path'
import { snesToPC, type SymbolMap } from 'snes-framework/symbol-map'
import { lz2 } from 'snes-framework/decompress'
import { parseGfxPtrTable, GFX_ARENA } from 'snes-framework/gfx-reinsert'
import { decodeGfxFile } from './gfx-import-utils'
import { gfxSizeRegistry } from './resources'
import { frameworkWorkRoot } from './framework-paths'

/** One changed graphics sheet, decompressed and ready for `saveGfxEdit`. */
export interface GfxDiffItem {
  format: 'lz2' | 'lz16'
  fileId: number
  /** Decompressed tile bytes from the foreign cart. */
  tiles: Uint8Array
  /** lz16 only — tile-row count (`saveGfxEdit` needs it to re-encode). */
  rowCount?: number
}

export interface GfxDiffResult {
  changed: GfxDiffItem[]
  /** Sheets that changed but couldn't be safely imported (resized / decode
   *  failure). Surfaced so partial coverage is never silent. */
  skipped: number
}

/** Generous decode buffer for a self-terminating lz2 sheet (well past any sheet's
 *  decompressed size; the true length comes from the decoder's `destEnd`). */
const MAX_GFX_BYTES = 0x10000

/** Blob count for a format, from the base asm ptr table (one label per blob,
 *  fileId = index). 0 when the table can't be parsed. */
function blobCount(format: 'lz2' | 'lz16'): number {
  try {
    const text = readFileSync(path.join(frameworkWorkRoot(), 'yi', GFX_ARENA.ptrBankFile), 'utf8')
    return parseGfxPtrTable(text, format).length
  } catch {
    return 0
  }
}

/** Decompress an lz2 sheet self-terminating; the tiles sliced to the true decoded
 *  length, or null when the pointer/stream isn't a valid sheet. */
function decodeLz2Sized(rom: Uint8Array, tablePc: number, fileId: number): Uint8Array | null {
  try {
    const p = tablePc + fileId * 3
    const srcPC = snesToPC(rom[p]! | (rom[p + 1]! << 8) | (rom[p + 2]! << 16))
    const buf = new Uint8Array(MAX_GFX_BYTES)
    const { destEnd } = lz2(rom, srcPC, buf, 0)
    return destEnd > 0 ? buf.slice(0, destEnd) : null
  } catch {
    return null
  }
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

/**
 * Diff a foreign cart's graphics against base. `symbols` resolves the gfx pointer
 * tables (the vendored V1.0 map suffices — `DATA_lz2/lz16_compressed_gfx_ptrs`).
 */
export function diffForeignGfx(foreign: Uint8Array, base: Uint8Array, symbols: SymbolMap): GfxDiffResult {
  const changed: GfxDiffItem[] = []
  let skipped = 0

  // ── lz2: every blob (self-terminating decode, no size dependency) ──
  const lz2Table = symbols.tryPc('DATA_lz2_compressed_gfx_ptrs')
  if (lz2Table !== undefined) {
    const n = blobCount('lz2')
    for (let fileId = 0; fileId < n; fileId++) {
      const baseTiles = decodeLz2Sized(base, lz2Table, fileId)
      if (!baseTiles) continue // not a real sheet on base — skip silently
      const foreignTiles = decodeLz2Sized(foreign, lz2Table, fileId)
      if (!foreignTiles) {
        skipped++ // base decoded but foreign didn't (repointed to garbage)
        continue
      }
      if (foreignTiles.length !== baseTiles.length) {
        skipped++ // the hack resized this sheet — can't splice it cleanly
        continue
      }
      if (!bytesEqual(baseTiles, foreignTiles)) changed.push({ format: 'lz2', fileId, tiles: foreignTiles })
    }
  }

  // ── lz16: registry-sized blobs only (decompressed size from the level walk) ──
  for (const { format, fileId, sizeBytes, rowCount } of gfxSizeRegistry().values()) {
    if (format !== 'lz16') continue
    try {
      const baseTiles = decodeGfxFile(base, symbols, 'lz16', fileId, sizeBytes, rowCount)
      const foreignTiles = decodeGfxFile(foreign, symbols, 'lz16', fileId, sizeBytes, rowCount)
      if (!bytesEqual(baseTiles, foreignTiles)) {
        changed.push({ format: 'lz16', fileId, tiles: foreignTiles, rowCount })
      }
    } catch {
      skipped++ // foreign stream wouldn't decode at the base size (resized/relocated)
    }
  }

  return { changed, skipped }
}

// ── Raw (uncompressed) CHR graphics — banks $52–$56 ─────────────────────────
// The compressed-sheet diff above covers the LZ2/LZ16 pointer-table files. Banks
// $52–$56 hold RAW CHR incbin'd at FIXED bank addresses (animation tiles, world-
// map level-select icons, sprite/dynamic-body gfx, the world-map character base)
// — `GFX_<addr>.bin` / `DATA_<addr>.bin` whose filename encodes the address. They
// aren't relocated, so a plain fixed-address byte diff suffices, applied through
// the editor's `saveRawChrEdit` path (overlay copies of the incbin'd `.bin`s).

/** One raw-CHR overlay patch — the `saveRawChrEdit` write shape. */
export interface RawChrWrite {
  /** Path relative to `assets/yi` (e.g. `Graphics/SuperFX/DATA_530000.bin`). */
  binFile: string
  offset: number
  bytes: Uint8Array
}

export interface RawGfxDiffResult {
  writes: RawChrWrite[]
  /** Distinct `.bin` files changed. */
  files: number
}

/** Raw-CHR gfx banks the importer covers — SuperFX-mapped $52–$56 (PC range).
 *  Excludes $57 (the SuperFX program/asset bank) and everything else. */
const RAW_GFX_LO = 0x120000
const RAW_GFX_HI = 0x170000

/**
 * Diff a foreign cart's raw-CHR graphics (banks $52–$56) against base. Enumerates
 * the base extract's `Graphics/` + `Graphics/SuperFX/` `.bin`s whose filename
 * encodes an address in range, derives each one's cart PC + size, and emits a
 * minimal-span `saveRawChrEdit` patch per changed file. Fixed addresses (the
 * `.bin`s are incbin'd in place), so no pointer-following.
 */
export function diffForeignRawGfx(foreign: Uint8Array, base: Uint8Array): RawGfxDiffResult {
  const assetsRoot = path.join(frameworkWorkRoot(), 'assets', 'yi')
  const writes: RawChrWrite[] = []
  for (const sub of ['Graphics', path.join('Graphics', 'SuperFX')]) {
    const dir = path.join(assetsRoot, sub)
    if (!existsSync(dir)) continue
    for (const name of readdirSync(dir)) {
      const m = name.match(/^(?:GFX|DATA)_([0-9A-Fa-f]{6})\.bin$/)
      if (!m) continue
      const pc = snesToPC(parseInt(m[1]!, 16))
      if (pc < RAW_GFX_LO || pc >= RAW_GFX_HI) continue
      let size: number
      try {
        size = statSync(path.join(dir, name)).size
      } catch {
        continue
      }
      if (size === 0 || pc + size > base.length || pc + size > foreign.length) continue
      // Minimal changed span (the build incbin's the whole overlay .bin, so one
      // contiguous patch from first to last differing byte reproduces the foreign
      // region exactly — bytes outside the span are equal by definition).
      let first = -1
      let last = -1
      for (let i = 0; i < size; i++) {
        if (foreign[pc + i] !== base[pc + i]) {
          if (first < 0) first = i
          last = i
        }
      }
      if (first < 0) continue // unchanged
      writes.push({
        binFile: `${sub.replace(/\\/g, '/')}/${name}`,
        offset: first,
        bytes: Buffer.from(foreign.subarray(pc + first, pc + last + 1))
      })
    }
  }
  return { writes, files: writes.length }
}
