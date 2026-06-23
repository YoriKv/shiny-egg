// BG region export/import backend (the Graphics panel "Region" tab). Render a
// selected BG layer region to a PNG (+ a sidecar JSON of per-cell tile metadata),
// and on import slice the edited PNG back to the underlying CHR gfx files via
// saveGfxEdit — exactly like the metatile track, but for a positioned scene
// region instead of dedup'd blocks. Pixels-only (the MVP).
//
//   - BG1 region = a rectangle of level cells (Map16-stamped); reuses the
//     object-metatile slice (byte-exact).
//   - BG2/BG3 = the WHOLE pre-rendered tilemap in rendered (de-interleaved) order;
//     2bpp-aware for BG3; sub-tiles that resolve outside the layer's gfx (BG2
//     wraparound) are gated non-editable.
//
// See research/graphics-editing/bg-region-edit.md. The engine half lives in
// snes-framework/bg-region (bg-region.ts), pinned by bg-region.test.ts.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildMetatileContext, type MetatileHeader } from 'snes-framework/object-metatile'
import {
  renderBg1Region, diffBg1Region, buildBgRegionContext, renderBgRegion, diffBgRegionTiles, bgRegionPng,
  bg1RegionAseprite, bgRegionAseprite, bgRegionPlacementAseprite, diffBgRegionPlacement,
  type Bg1RegionCell, type BgSubCell, type MetatileTileEdit
} from 'snes-framework/bg-region'
import { decodeAsepriteRegion, decodeAsepriteStructural } from 'snes-framework/aseprite'
import { resolveBgTilemapSource } from 'snes-framework/load-bg-tilemaps'
import { decodeLevelFromLevelData } from 'snes-framework/object-decode'
import { decodePng, type ImageData } from 'snes-framework/png'
import { canvasRegion, decodeGfxFile, liveTiles } from './gfx-import-utils'
import { loadLevelPalettes } from 'snes-framework/load-palettes'
import { type SymbolMap } from 'snes-framework/symbol-map'
import type { GfxFileEntry, LevelData, PaletteEdit } from 'snes-framework/types'
import type { RenderHeaderRequest, BgRegionLayer, BgRegionRect, BgRegionFormat, RegionImportLogEntry, BgRegionImportResult, BgRegionExportResult } from '../shared/ipc-types'
import { frameworkWorkRoot } from './framework-paths'
import { loadRomAndSymbols } from './render/rom-cache'
import { saveGfxEdit, savePaletteEdits, loadPaletteEdits } from './resources'
import { gfxLiveEdits } from './gfx-live-cache'

// ── palette helpers (5-bit SNES ⇆ 8-bit RGB) ───────────────────────────────
const expand5 = (v: number): number => ((v << 3) | (v >> 2)) & 0xff
const bgr15ToRgbArr = (c15: number): [number, number, number] =>
  [expand5(c15 & 0x1f), expand5((c15 >> 5) & 0x1f), expand5((c15 >> 10) & 0x1f)]
/** ImageData-packed u32 (r|g<<8|b<<16|a<<24) → BGR-15 word (5 bits/channel). */
const u32ToBgr15 = (u: number): number =>
  (((u >> 16) & 0xf8) << 7) | (((u >> 8) & 0xf8) << 2) | (((u & 0xff) >> 3))
/** Snap an opaque pixel to the 5-bit SNES colour grid (no-op for transparent). */
function quantizeU32(u: number): number {
  if ((u >>> 24) === 0) return 0
  return ((0xff << 24) | (expand5(((u >> 16) & 0xff) >> 3) << 16) | (expand5(((u >> 8) & 0xff) >> 3) << 8) | expand5((u & 0xff) >> 3)) >>> 0
}

/** One exported palette entry, in used-rows compact order = the Aseprite palette
 *  index AND the PNG swatch cell — so import can detect a recoloured entry and
 *  write it back to the master palette blob. */
interface SidecarPaletteEntry {
  cgramIndex: number
  /** Master-palette-blob byte offset (PaletteEdit.offset); -1 ⇒ not blob-sourced
   *  (not editable through the palette). */
  blobOffset: number
  /** The exact 8-bit colour the export drew for this entry. */
  rgb: [number, number, number]
}

/** Sidecar written next to each region PNG — everything import needs WITHOUT a
 *  level re-decode (mirrors the metatile manifest). */
interface BgRegionSidecar {
  layer: BgRegionLayer
  width: number
  height: number
  bpp: 2 | 4
  header: RenderHeaderRequest
  /** BG1 only. */
  rect?: BgRegionRect
  cells?: Bg1RegionCell[]
  /** BG2/BG3 only. */
  subCells?: BgSubCell[]
  /** Palette layout for colour-edit-back (absent on pre-palette-edit exports). */
  palette?: SidecarPaletteEntry[]
  /** Which `.aseprite` flavour was exported, so import routes correctly:
   *  `'pixels'` = the 8×8-CHR pixel-edit tilemap (all layers; flatten → CHR slice);
   *  `'layout'` = the BG2/BG3 16×16-word PLACEMENT tilemap (rearrange → tilemap-word
   *  write). Absent ⇒ default `'pixels'` (also how a `.png` export is treated). */
  asepriteMode?: 'pixels' | 'layout'
  /** Legacy field from an earlier separate placement export — no longer written;
   *  kept only so old sidecars still parse. */
  placement?: boolean
}

/** Build the exported palette layout (used rows × stride) with each entry's CGRAM
 *  index, master-blob offset (for PaletteEdit), and exact exported colour. */
function buildSidecarPalette(
  rom: Uint8Array,
  symbols: SymbolMap,
  header: MetatileHeader,
  cgram: Uint8Array,
  paletteRowsUsed: number[],
  bpp: 2 | 4
): SidecarPaletteEntry[] {
  const cpr = bpp === 4 ? 16 : 4
  const provenance = new Int32Array(256)
  loadLevelPalettes(rom, symbols, header, new Uint8Array(512), provenance)
  const out: SidecarPaletteEntry[] = []
  for (const row of paletteRowsUsed) {
    for (let i = 0; i < cpr; i++) {
      const cgramIndex = row * cpr + i
      const c15 = cgram[cgramIndex * 2]! | (cgram[cgramIndex * 2 + 1]! << 8)
      out.push({ cgramIndex, blobOffset: provenance[cgramIndex] ?? -1, rgb: bgr15ToRgbArr(c15) })
    }
  }
  return out
}

/** The success payload of `exportBgRegionToDir`. Bound to the shared IPC contract
 *  (`Extract` of its `ok: true` branch) so the two can't drift — every field is
 *  defined once in `ipc-types.ts`. */
export type BgRegionExportOk = Extract<BgRegionExportResult, { ok: true }>

/** The success payload of `importBgRegionFromDir`. Bound to the shared IPC contract
 *  (`Extract` of its `ok: true` branch) so the main-side return and the renderer-facing
 *  type can't drift — every field is defined once in `ipc-types.ts`. */
export type BgRegionImportOk = Extract<BgRegionImportResult, { ok: true }>
type Err = { ok: false; error: string }

/** Merge detected palette edits over the project's existing ones (offset-keyed). */
function mergePaletteEdits(existing: PaletteEdit[], detected: PaletteEdit[]): PaletteEdit[] {
  const m = new Map(existing.map((e) => [e.offset, e.value]))
  for (const e of detected) m.set(e.offset, e.value)
  return [...m].map(([offset, value]) => ({ offset, value }))
}

const fileBase = (layer: BgRegionLayer): string => `bg${layer}-region`

/** RenderHeaderRequest → the engine's MetatileHeader (= GfxHeader & PaletteHeader);
 *  the field names line up, levelMode just needs a default. */
function toMetatileHeader(h: RenderHeaderRequest): MetatileHeader {
  return { ...h, levelMode: h.levelMode ?? 0, animationTileset: h.animationTileset ?? 0 } as unknown as MetatileHeader
}


/**
 * Render a BG layer region to `dir/bg{layer}-region.{png|aseprite}` + `.json`. BG1
 * needs the loaded level (for the positioned grid) + a cell rect; BG2/BG3 export
 * the whole tilemap (rect ignored). `format='aseprite'` writes a configured tilemap
 * project for every layer (BG1 tiles = Map16 blocks; BG2/BG3 tiles = CHR tiles);
 * `png` writes the original flat sheet. Either way the `.json` sidecar — the import
 * contract — is identical, and import auto-detects whichever was written.
 */
export function exportBgRegionToDir(
  header: RenderHeaderRequest,
  level: LevelData,
  layer: BgRegionLayer,
  rect: BgRegionRect | null,
  dir: string,
  format: BgRegionFormat = 'png'
): BgRegionExportOk | Err {
  try {
    const { rom, symbols } = loadRomAndSymbols()
    const mh = toMetatileHeader(header)
    let image: Uint8Array
    let ext: 'png' | 'aseprite'
    let sidecar: BgRegionSidecar
    const base = fileBase(layer)

    if (layer === 1) {
      if (format === 'aseprite-layout') return { ok: false, error: 'BG1 has no static tilemap placement — edit BG1 layout in the level editor.' }
      const decoded = decodeLevelFromLevelData({ rom, symbols, workRoot: frameworkWorkRoot(), levelData: level })
      if (!decoded) return { ok: false, error: 'Level did not decode.' }
      const ctx = buildMetatileContext(rom, symbols, mh, gfxLiveEdits())
      if (!rect || rect.cols <= 0 || rect.rows <= 0) return { ok: false, error: 'Select a region of the level first.' }
      const region = renderBg1Region(ctx, decoded.state.levelDataBuffer, decoded.state.screenPageMap, rect)
      if (format === 'aseprite') {
        image = bg1RegionAseprite(ctx, region) // 8×8 CHR tiles (honest sharing)
        ext = 'aseprite'
      } else {
        image = bgRegionPng(ctx.cgram, region.rgba, region.width, region.height, region.paletteRowsUsed, 4, false)
        ext = 'png'
      }
      sidecar = {
        layer, width: region.width, height: region.height, bpp: 4, header,
        rect: rect ?? undefined, cells: region.cells,
        asepriteMode: format === 'aseprite' ? 'pixels' : undefined,
        palette: buildSidecarPalette(rom, symbols, mh, ctx.cgram, region.paletteRowsUsed, 4)
      }
    } else {
      const bgCtx = buildBgRegionContext(rom, symbols, mh, gfxLiveEdits())
      const region = renderBgRegion(bgCtx, layer)
      if (region.width === 0 || region.subCells.length === 0) {
        return { ok: false, error: `BG${layer} has no editable tilemap in this level.` }
      }
      // Two `.aseprite` flavours (research/graphics-editing): 8×8 is the foundational
      // pixel unit (honest CHR sharing); placement is 16×16-WORD because BG2/BG3 run in
      // 16×16 tile mode (one word → base+{0,1,16,17}, so 8×8 placement is impossible).
      //   'aseprite'        → 8×8 CHR pixel tilemap   → import flattens → diffBgRegionTiles
      //   'aseprite-layout' → 16×16-word placement    → import → diffBgRegionPlacement
      if (format === 'aseprite' || format === 'aseprite-layout') {
        image = format === 'aseprite-layout' ? bgRegionPlacementAseprite(bgCtx, region) : bgRegionAseprite(bgCtx, region)
        ext = 'aseprite'
      } else {
        image = bgRegionPng(bgCtx.cgram, region.rgba, region.width, region.height, region.paletteRowsUsed, region.bpp, true)
        ext = 'png'
      }
      sidecar = {
        layer, width: region.width, height: region.height, bpp: region.bpp, header, subCells: region.subCells,
        asepriteMode: format === 'aseprite-layout' ? 'layout' : format === 'aseprite' ? 'pixels' : undefined,
        palette: buildSidecarPalette(rom, symbols, mh, bgCtx.cgram, region.paletteRowsUsed, region.bpp)
      }
    }

    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, `${base}.${ext}`), image)
    writeFileSync(join(dir, `${base}.json`), JSON.stringify(sidecar, null, 2))
    const cells = layer === 1 ? sidecar.cells!.length : sidecar.subCells!.filter((s) => s.gfx).length
    return { ok: true, file: `${base}.${ext}`, cells, dir }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** One pending file rewrite: the decoded tile blob's changed tiles, keyed by file. */
interface FilePatch {
  fileId: number
  format: 'lz2' | 'lz16'
  sizeBytes: number
  rowCount?: number
  tileBytes: number
  tiles: Map<number, Uint8Array>
}

/** PNG swatch cell colour for palette entry `idx` — bgRegionPng draws used-row
 *  blocks as columns (each `cpr` colours tall) starting at x0 (= region width);
 *  read the 8×8 cell's centre pixel. Undefined if off-image. */
function swatchColorAt(img: ImageData, x0: number, cpr: number, idx: number): number | undefined {
  const x = x0 + Math.floor(idx / cpr) * 8 + 4
  const y = (idx % cpr) * 8 + 4
  if (x >= img.width || y >= img.height) return undefined
  const o = (y * img.width + x) * 4
  return ((img.rgba[o + 3]! << 24) | (img.rgba[o + 2]! << 16) | (img.rgba[o + 1]! << 8) | img.rgba[o]!) >>> 0
}

/** Detect recoloured palette entries: each imported colour vs the exported one. An
 *  opaque difference ⇒ a PaletteEdit (blob offset → BGR-15) + an effective-CGRAM
 *  override (cgramIndex → BGR-15) used so pixels showing the new colour still match. */
function detectPaletteEdits(
  palette: SidecarPaletteEntry[],
  imported: (idx: number) => number | undefined
): { edits: PaletteEdit[]; effective: Map<number, number>; uneditable: number } {
  const edits: PaletteEdit[] = []
  const effective = new Map<number, number>()
  let uneditable = 0
  for (let idx = 0; idx < palette.length; idx++) {
    const e = palette[idx]!
    const imp = imported(idx)
    if (imp === undefined || (imp >>> 24) === 0) continue // missing / transparent swatch cell
    const expU32 = ((0xff << 24) | (e.rgb[2] << 16) | (e.rgb[1] << 8) | e.rgb[0]) >>> 0
    if (imp === expU32) continue // unchanged
    if (e.blobOffset < 0) { uneditable++; continue } // changed but not master-blob-sourced
    const bgr15 = u32ToBgr15(imp)
    edits.push({ offset: e.blobOffset, value: bgr15 })
    effective.set(e.cgramIndex, bgr15)
  }
  return { edits, effective, uneditable }
}

/** Clone `cgram` and overlay the effective palette-colour edits (cgramIndex → BGR-15). */
function effectiveCgram(cgram: Uint8Array, edits: Map<number, number>): Uint8Array {
  const out = cgram.slice()
  for (const [i, v] of edits) { out[i * 2] = v & 0xff; out[i * 2 + 1] = (v >>> 8) & 0xff }
  return out
}

/** Snap every opaque pixel of an RGBA buffer to the 5-bit SNES grid, in place. */
function quantizeRegion(rgba: Uint8Array): void {
  const u32 = new Uint32Array(rgba.buffer, rgba.byteOffset, rgba.length >>> 2)
  for (let i = 0; i < u32.length; i++) u32[i] = quantizeU32(u32[i]!)
}

/**
 * Import every `bg{1,2,3}-region.{png,json}` pair in `dir`: slice each edited
 * region back to CHR tile edits and `saveGfxEdit` only the changed files. Edits to
 * the same file across regions merge (decode once, patch all, save once).
 */
export async function importBgRegionFromDir(dir: string): Promise<BgRegionImportOk | Err> {
  try {
    const { rom, symbols } = loadRomAndSymbols()
    const sidecars = readdirSync(dir).filter((f) => /^bg[123]-region\.json$/.test(f)).sort()
    if (sidecars.length === 0) return { ok: false, error: 'No bg-region PNGs found in that folder.' }

    const errors: string[] = []
    const log: string[] = []
    const perRegion: RegionImportLogEntry[] = []
    const byFile = new Map<string, FilePatch>()
    const paletteByOffset = new Map<number, number>() // master-blob offset → BGR-15
    let conflicts = 0
    let regions = 0
    let mismatches = 0
    let repositioned = 0 // index-based placement edits (tilemap words written)

    for (const scFile of sidecars) {
      const sc = JSON.parse(readFileSync(join(dir, scFile), 'utf8')) as BgRegionSidecar
      const asePath = join(dir, scFile.replace(/\.json$/, '.aseprite'))
      const pngPath = join(dir, scFile.replace(/\.json$/, '.png'))

      const cpr = sc.bpp === 4 ? 16 : 4
      const aseMode: 'pixels' | 'layout' = sc.asepriteMode ?? 'pixels'

      // LAYOUT (BG2/BG3 only): the 16×16-WORD placement `.aseprite` — rearranged cells →
      // changed tilemap words → the decompressed tilemap file. Placement-ONLY (no pixel
      // slice); 8×8 placement is impossible in 16×16 tile mode, so this is its own mode.
      // The pixel edits live in the separate 8×8 'pixels' export.
      if (sc.layer !== 1 && aseMode === 'layout' && existsSync(asePath)) {
        const mhp = toMetatileHeader(sc.header)
        const bgCtx = buildBgRegionContext(rom, symbols, mhp, gfxLiveEdits())
        const region = renderBgRegion(bgCtx, sc.layer)
        const struct = decodeAsepriteStructural(readFileSync(asePath))
        if (struct.width !== sc.width || struct.height !== sc.height) {
          errors.push(`${scFile}: aseprite is ${struct.width}×${struct.height}, expected ${sc.width}×${sc.height} (canvas resized?)`)
          continue
        }
        const tmAddr = sc.layer === 2 ? bgCtx.regs.bg2TilemapAddr : bgCtx.regs.bg3TilemapAddr
        const pd = diffBgRegionPlacement(bgCtx, region, struct, tmAddr)
        if (pd.edits.length > 0) {
          const src = resolveBgTilemapSource(rom, symbols, sc.layer, sc.layer === 2 ? mhp.bg2Tileset : mhp.bg3Tileset)
          if (!src) errors.push(`${scFile}: BG${sc.layer} has no static editable tilemap file`)
          else if (tmAddr !== src.vramBase) errors.push(`${scFile}: BG${sc.layer} tilemap base mismatch (0x${tmAddr.toString(16)} vs 0x${src.vramBase.toString(16)})`)
          else {
            const bytes = src.bytes.slice()
            let written = 0
            for (const e of pd.edits) if (e.fileOffset >= 0 && e.fileOffset + 1 < bytes.length) { bytes[e.fileOffset] = e.word & 0xff; bytes[e.fileOffset + 1] = (e.word >> 8) & 0xff; written++ }
            const r = saveGfxEdit('lz2', src.fileId, bytes)
            if (r.ok) { repositioned += written; log.push(`${scFile} (BG${sc.layer} layout): ${written} tile${written === 1 ? '' : 's'} repositioned${pd.skipped ? ` (${pd.skipped} non-editable/new skipped)` : ''}`) }
            else errors.push(`${scFile}: ${r.error}`)
          }
        } else if (pd.skipped > 0) {
          log.push(`${scFile} (BG${sc.layer} layout): ${pd.skipped} cell${pd.skipped === 1 ? '' : 's'} skipped (non-editable / new tile — add new art via the pixel export)`)
        }
        continue // placement-only; the pixel slice below is skipped
      }

      // PIXELS (8×8, all layers) or PNG: flatten/read to the region RGBA, then base-aware
      // slice each 8×8 back to its CHR (diffBg1Region / diffBgRegionTiles below).
      let edited: Uint8Array
      let source: 'png' | 'aseprite'
      let importedPaletteAt: (idx: number) => number | undefined
      if (existsSync(asePath)) {
        const dec = decodeAsepriteRegion(readFileSync(asePath))
        if (dec.width !== sc.width || dec.height !== sc.height) {
          errors.push(`${scFile}: aseprite is ${dec.width}×${dec.height}, expected ${sc.width}×${sc.height} (canvas resized?)`)
          continue
        }
        edited = dec.rgba
        source = 'aseprite'
        importedPaletteAt = (idx) => (idx < dec.palette.length ? dec.palette[idx]! : undefined)
      } else if (existsSync(pngPath)) {
        const img = decodePng(readFileSync(pngPath))
        edited = canvasRegion(img, sc.width, sc.height)
        source = 'png'
        importedPaletteAt = (idx) => swatchColorAt(img, sc.width, cpr, idx)
      } else {
        errors.push(`${scFile}: missing PNG/Aseprite`)
        continue
      }
      const mh = toMetatileHeader(sc.header)

      // Palette colour edits (recoloured Aseprite-palette / PNG-swatch entries) →
      // master-blob write-back + an effective CGRAM so pixels showing the new colour
      // still match (and don't read as off-palette).
      let effective = new Map<number, number>()
      if (sc.palette && sc.palette.length) {
        const det = detectPaletteEdits(sc.palette, importedPaletteAt)
        effective = det.effective
        for (const pe of det.edits) paletteByOffset.set(pe.offset, pe.value)
        if (det.edits.length) log.push(`${scFile}: ${det.edits.length} palette colour${det.edits.length === 1 ? '' : 's'} changed`)
        if (det.uneditable > 0) {
          errors.push(`${scFile}: ${det.uneditable} recoloured palette entr${det.uneditable === 1 ? 'y is' : 'ies are'} not editable through the palette (not master-blob-sourced — e.g. a transparent/backdrop slot)`)
        }
      }
      // SNES is 5-bit/channel: snap imported pixels to that grid so edited-palette
      // colours match the effective row palette; genuine off-row paints snap to their
      // own colour, which is still absent from the row → still flagged.
      quantizeRegion(edited)

      let diff: { edits: MetatileTileEdit[]; conflicts: number; mismatches: number }
      let manifest: GfxFileEntry[]
      const tileBytes = sc.bpp === 4 ? 32 : 16
      if (sc.layer === 1) {
        const ctx = buildMetatileContext(rom, symbols, mh, gfxLiveEdits())
        if (effective.size) ctx.cgram = effectiveCgram(ctx.cgram, effective)
        diff = diffBg1Region(
          ctx,
          { rgba: new Uint8Array(0), width: sc.width, height: sc.height, cells: sc.cells ?? [], paletteRowsUsed: [] },
          edited
        )
        manifest = ctx.manifest
      } else {
        const bgCtx = buildBgRegionContext(rom, symbols, mh, gfxLiveEdits())
        if (effective.size) bgCtx.cgram = effectiveCgram(bgCtx.cgram, effective)
        diff = diffBgRegionTiles(
          bgCtx,
          // tileSize is unused by the pixel slice (diffBgRegionTiles); placement is a
          // separate path. A placeholder satisfies the BgRegionResult shape.
          { layer: sc.layer, bpp: sc.bpp, rgba: new Uint8Array(0), width: sc.width, height: sc.height, subCells: sc.subCells ?? [], paletteRowsUsed: [], tileSize: 8 },
          edited
        )
        manifest = bgCtx.manifest
      }
      conflicts += diff.conflicts
      mismatches += diff.mismatches
      regions++
      perRegion.push({ file: scFile, layer: sc.layer, source, tiles: diff.edits.length, mismatches: diff.mismatches, conflicts: diff.conflicts })
      log.push(
        `${scFile} (${source}, BG${sc.layer}): ${diff.edits.length} tile${diff.edits.length === 1 ? '' : 's'} changed` +
        (diff.mismatches ? `, ${diff.mismatches} off-palette pixel${diff.mismatches === 1 ? '' : 's'}` : '') +
        (diff.conflicts ? `, ${diff.conflicts} shared-tile conflict${diff.conflicts === 1 ? '' : 's'}` : '')
      )
      if (diff.mismatches > 0) {
        errors.push(`${scFile}: ${diff.mismatches} pixel${diff.mismatches === 1 ? '' : 's'} used a colour not in their tile's palette row — clamped to index 0 (wrong palette row?)`)
      }

      for (const e of diff.edits) {
        const me = manifest.find((m) => m.format === e.format && m.fileId === e.fileId)
        if (!me) { errors.push(`gfx file 0x${e.fileId.toString(16)}: not loaded in this level`); continue }
        const key = `${e.format}/${e.fileId}`
        const fp = byFile.get(key) ?? {
          fileId: e.fileId, format: e.format, sizeBytes: me.sizeBytes,
          rowCount: e.format === 'lz16' ? me.sizeBytes / 512 : undefined, tileBytes, tiles: new Map<number, Uint8Array>()
        }
        fp.tiles.set(e.fileTile, e.bytes)
        byFile.set(key, fp)
      }
    }

    let applied = 0
    for (const [, fp] of byFile) {
      try {
        // Patch onto the live-edited tiles if present, else the cart blob — so an
        // import on top of unsaved-to-build gfx edits preserves them.
        const tiles = liveTiles(fp.format, fp.fileId) ?? decodeGfxFile(rom, symbols, fp.format, fp.fileId, fp.sizeBytes, fp.rowCount)
        for (const [fileTile, bytes] of fp.tiles) tiles.set(bytes, fileTile * fp.tileBytes)
        const r = saveGfxEdit(fp.format, fp.fileId, tiles, fp.rowCount)
        if (r.ok) applied++
        else errors.push(`gfx file 0x${fp.fileId.toString(16)}: ${r.error}`)
      } catch (err) {
        errors.push(`gfx file 0x${fp.fileId.toString(16)}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    log.push(`Saved ${applied} gfx file${applied === 1 ? '' : 's'}.`)

    // Persist palette colour edits to the master blob (merged with existing edits).
    let paletteChanged = 0
    if (paletteByOffset.size) {
      const detected: PaletteEdit[] = [...paletteByOffset].map(([offset, value]) => ({ offset, value }))
      const r = await savePaletteEdits(mergePaletteEdits(loadPaletteEdits(), detected))
      if (r.ok) {
        paletteChanged = detected.length
        log.push(`Saved ${paletteChanged} palette colour${paletteChanged === 1 ? '' : 's'}.`)
      } else {
        errors.push(`palette: ${r.error}`)
      }
    }

    return { ok: true, dir, applied, repositioned, conflicts, regions, mismatches, paletteChanged, perRegion, log, errors }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
