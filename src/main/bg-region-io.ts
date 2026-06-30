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

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, type Dirent } from 'node:fs'
import { join } from 'node:path'
import { buildMetatileContext, type MetatileHeader } from 'snes-framework/object-metatile'
import {
  renderBg1Region, diffBg1Region, buildBgRegionContext, renderBgRegion, diffBgRegionTiles, bgRegionPng,
  bg1RegionAseprite, bgRegionAseprite, bgRegionPlacementAseprite, diffBgRegionPlacement, diffBgRegionCombined,
  bgRegionM1te2, diffBgRegionM1te2, bg1RegionM1te2, diffBg1RegionM1te2,
  type Bg1RegionCell, type BgSubCell, type MetatileTileEdit, type M1te2Export
} from 'snes-framework/bg-region'
import { decodeAsepriteRegion, decodeAsepriteStructural } from 'snes-framework/aseprite'
import { resolveBgTilemapSource, type BgTilemapSource } from 'snes-framework/load-bg-tilemaps'
import { decodeLevelFromLevelData } from 'snes-framework/object-decode'
import { decodePng, type ImageData } from 'snes-framework/png'
import { canvasRegion, liveTiles } from './gfx-import-utils'
import { fileChecksum } from './gfx-import-conflict'
import { GfxImportReconciler } from './gfx-import-reconcile'
import { loadLevelPalettes } from 'snes-framework/load-palettes'
import { type SymbolMap } from 'snes-framework/symbol-map'
import type { GfxFileEntry, LevelData, PaletteEdit } from 'snes-framework/types'
import type { RenderHeaderRequest, BgRegionLayer, BgRegionRect, BgRegionFormat, RegionImportLogEntry, BgRegionImportResult, BgRegionExportResult, M1ExportFile } from '../shared/ipc-types'
import { frameworkWorkRoot } from './framework-paths'
import { loadRomAndSymbols } from './render/rom-cache'
import { resourcePaletteToBase, applyPaletteEdits } from './render/render-core'
import { saveGfxEdit, loadPaletteEdits } from './resources'
import { gfxLiveEdits } from './gfx-live-cache'

// ── palette helpers (5-bit SNES ⇆ 8-bit RGB) ───────────────────────────────
const expand5 = (v: number): number => ((v << 3) | (v >> 2)) & 0xff
const bgr15ToRgbArr = (c15: number): [number, number, number] =>
  [expand5(c15 & 0x1f), expand5((c15 >> 5) & 0x1f), expand5((c15 >> 10) & 0x1f)]
/** ImageData-packed u32 (r|g<<8|b<<16|a<<24) → BGR-15 word (5 bits/channel). */
const u32ToBgr15 = (u: number): number =>
  (((u >> 16) & 0xf8) << 7) | (((u >> 8) & 0xf8) << 2) | (((u & 0xff) >> 3))
/** Snap an opaque pixel to the 5-bit SNES color grid (no-op for transparent). */
function quantizeU32(u: number): number {
  if ((u >>> 24) === 0) return 0
  return ((0xff << 24) | (expand5(((u >> 16) & 0xff) >> 3) << 16) | (expand5(((u >> 8) & 0xff) >> 3) << 8) | expand5((u & 0xff) >> 3)) >>> 0
}

/** One exported palette entry, in used-rows compact order = the Aseprite palette
 *  index AND the PNG swatch cell — so import can detect a recolored entry and
 *  write it back to the master palette blob. */
interface SidecarPaletteEntry {
  cgramIndex: number
  /** Master-palette-blob byte offset (PaletteEdit.offset); -1 ⇒ not blob-sourced
   *  (not editable through the palette). */
  blobOffset: number
  /** The exact 8-bit color the export drew for this entry. */
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
  /** Palette layout for color-edit-back (absent on pre-palette-edit exports). */
  palette?: SidecarPaletteEntry[]
  /** Which `.aseprite` flavour was exported, so import routes correctly:
   *  `'pixels'` = the 8×8-CHR pixel-edit tilemap (all layers; flatten → CHR slice);
   *  `'layout'` = the BG2/BG3 16×16-word PLACEMENT tilemap (rearrange → tilemap-word
   *  write). Absent ⇒ default `'pixels'` (also how a `.png` export is treated). */
  asepriteMode?: 'pixels' | 'layout'
  /** Legacy field from an earlier separate placement export — no longer written;
   *  kept only so old sidecars still parse. */
  placement?: boolean
  /** sha256 of the exported image artifact (`.png`/`.aseprite`) — the import checksum gate
   *  skips a region whose bytes still match (unedited since export). Absent on old exports. */
  checksum?: string
}

/** Sidecar for an M1TE2 `.M1` export (written as `bg{1,2,3}-region.m1.json`, distinct from
 *  the PNG/Aseprite `.json` so the two never collide). Import rebuilds the region from
 *  `header` and re-derives the CHR/palette write-back, so the `.M1` itself carries no extra
 *  mapping. One `.M1` per layer (M1TE2 v2 holds up to 64×64). */
interface M1te2Sidecar {
  format: 'm1te2'
  layer: BgRegionLayer // 1 (BG1 area) | 2 | 3
  header: RenderHeaderRequest
  bpp: 2 | 4
  tileSize: 8 | 16
  /** The FULL rendered region dims (for the region-rebuild sanity check). */
  width: number
  height: number
  /** BG1 only — the per-Map16-cell metadata, so import rebuilds the region (+ its 8×8 sub-tile
   *  tileset) without re-decoding the level. Absent for BG2/BG3 (their context is the tilemap). */
  cells?: Bg1RegionCell[]
  /** sha256 of the exported `.M1` artifact — the import checksum gate skips an unedited session. */
  checksum?: string
}

/** Build the exported palette layout (used rows × stride) with each entry's CGRAM
 *  index, master-blob offset (for PaletteEdit), and exact exported color. */
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

const fileBase = (layer: BgRegionLayer): string => `bg${layer}-region`

/** Every `.M1` session file an export folder holds, walked up to two levels deep: the
 *  BG-region ones at the root (`bg{1,2,3}-region.M1`, layer parsed from the name); the
 *  World Map ones in `map/` (`overworld-*.M1`, `icons.M1`); and the system-screen ones in
 *  `screens/title/` + `screens/storybook/`. Non-BG-region files default to layer 1 (the
 *  BG1/slot-0 view M1TE opens to). Drives the Graphics panel's clickable "open in M1TE" list
 *  (each path is relative to `dir`, so `openInM1te` joins it directly). Sorted; empty if the
 *  folder is unreadable. */
export function listM1Files(dir: string): M1ExportFile[] {
  const out: M1ExportFile[] = []
  const walk = (base: string, prefix: string, depth: number): void => {
    let entries: Dirent[]
    try { entries = readdirSync(base, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const rel = prefix ? `${prefix}/${e.name}` : e.name
      if (e.isFile()) {
        if (!/\.M1$/i.test(e.name)) continue
        const bg = /^bg([123])-region.*\.M1$/i.exec(e.name)
        out.push({ file: rel, layer: bg ? (Number(bg[1]) as 1 | 2 | 3) : 1 })
      } else if (e.isDirectory() && depth > 0) {
        walk(join(base, e.name), rel, depth - 1)
      }
    }
  }
  walk(dir, '', 2) // the picked folder + its track subfolders (map/, screens/title/, …)
  return out.sort((a, b) => a.file.localeCompare(b.file))
}

/**
 * Mutate a freshly-built context's `cgram` to the canvas's LIVE-PREVIEW palette — the
 * pristine base blob ⊕ the saved palette draft (exactly what `render-core` does for the
 * canvas via `resourcePaletteToBase` + `applyPaletteEdits`). The engine contexts
 * (`buildBgRegionContext` / `buildMetatileContext`) load the BUILT ROM's palette, which
 * keeps pre-reset / pre-rebuild colors — so without this an export's colors diverge from
 * the canvas (a palette reset still shows the old colors) and a re-import isn't idempotent.
 * Re-loads palettes once to capture `provenance` (the blob-offset per CGRAM index), then
 * re-sources + overlays the draft. Gfx already tracks the live cache (`gfxLiveEdits`) on both
 * sides; this closes the palette half of "the export still shows the pre-reset visuals".
 */
function applyLivePreviewPalette(cgram: Uint8Array, rom: Uint8Array, symbols: SymbolMap, mh: MetatileHeader): void {
  const provenance = new Int32Array(256)
  loadLevelPalettes(rom, symbols, mh, cgram, provenance)
  resourcePaletteToBase(cgram, provenance, frameworkWorkRoot())
  applyPaletteEdits(cgram, provenance, loadPaletteEdits())
}

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

    // M1TE2 ".M1" session — ONE file for the whole layer (M1TE2 v2 holds up to 64×64): the
    // full BG2/BG3 tilemap, or a ≤32×32-Map16 block for BG1 (an 8×8-mode tilemap synthesized
    // from the Map16 sub-tiles — pixel + palette editing only, no placement). Each .M1 bundles
    // tilemap + CHR + palette; import rebuilds the region from the sidecar. (Its own dispatch —
    // writes the `.M1` + a distinct `.m1.json`.)
    if (format === 'm1te2') {
      mkdirSync(dir, { recursive: true })
      let m1: M1te2Export
      let bpp: 2 | 4
      let tileSize: 8 | 16
      let regionWidth: number
      let regionHeight: number
      let cells: Bg1RegionCell[] | undefined
      let editableCount: number
      let cropWarning: string | undefined
      if (layer === 1) {
        const decoded = decodeLevelFromLevelData({ rom, symbols, workRoot: frameworkWorkRoot(), levelData: level })
        if (!decoded) return { ok: false, error: 'Level did not decode.' }
        if (!rect || rect.cols <= 0 || rect.rows <= 0) return { ok: false, error: 'Select a region of the level first.' }
        const ctx = buildMetatileContext(rom, symbols, mh, gfxLiveEdits())
        applyLivePreviewPalette(ctx.cgram, rom, symbols, mh)
        const region = renderBg1Region(ctx, decoded.state.levelDataBuffer, decoded.state.screenPageMap, rect)
        if (region.cells.length === 0) return { ok: false, error: 'The selected BG1 area is empty (no tiles to export).' }
        m1 = bg1RegionM1te2(ctx, region) // top-left ≤32×32-Map16 block
        bpp = 4; tileSize = 8; regionWidth = region.width; regionHeight = region.height
        cells = region.cells
        // M1TE2 v2 fits a 32×32-Map16 block (64×64 8×8 cells) — a larger selection is cropped
        // to the top-left block (one .M1). Report it so the user knows the rest wasn't exported.
        const aCols = region.width / 16, aRows = region.height / 16
        if (aCols > 32 || aRows > 32) {
          cropWarning = `Selected area is ${aCols}×${aRows} cells; M1TE fits one 32×32-cell block, so only the top-left 32×32 was exported.`
        }
        editableCount = region.cells.filter((c) => c.faithful && c.c < 32 && c.r < 32).length
      } else {
        const bgCtx = buildBgRegionContext(rom, symbols, mh, gfxLiveEdits())
        applyLivePreviewPalette(bgCtx.cgram, rom, symbols, mh)
        const region = renderBgRegion(bgCtx, layer)
        if (region.width === 0 || region.subCells.length === 0) {
          return { ok: false, error: `BG${layer} has no editable tilemap in this level.` }
        }
        m1 = bgRegionM1te2(bgCtx, region)
        bpp = region.bpp; tileSize = region.tileSize === 16 ? 16 : 8; regionWidth = region.width; regionHeight = region.height
        editableCount = region.subCells.filter((s) => s.gfx).length
      }
      writeFileSync(join(dir, `${base}.M1`), m1.bytes)
      const m1sc: M1te2Sidecar = {
        format: 'm1te2', layer, header, bpp, tileSize,
        width: regionWidth, height: regionHeight,
        cells: layer === 1 ? cells : undefined,
        checksum: fileChecksum(m1.bytes)
      }
      writeFileSync(join(dir, `${base}.m1.json`), JSON.stringify(m1sc, null, 2))
      return { ok: true, file: `${base}.M1`, cells: editableCount, dir, warning: cropWarning }
    }

    if (layer === 1) {
      if (format === 'aseprite-layout') return { ok: false, error: 'BG1 has no static tilemap placement — edit BG1 layout in the level editor.' }
      const decoded = decodeLevelFromLevelData({ rom, symbols, workRoot: frameworkWorkRoot(), levelData: level })
      if (!decoded) return { ok: false, error: 'Level did not decode.' }
      const ctx = buildMetatileContext(rom, symbols, mh, gfxLiveEdits())
      applyLivePreviewPalette(ctx.cgram, rom, symbols, mh)
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
      applyLivePreviewPalette(bgCtx.cgram, rom, symbols, mh)
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

    sidecar.checksum = fileChecksum(image) // the import checksum gate skips an unedited region
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, `${base}.${ext}`), image)
    writeFileSync(join(dir, `${base}.json`), JSON.stringify(sidecar, null, 2))
    const cells = layer === 1 ? sidecar.cells!.length : sidecar.subCells!.filter((s) => s.gfx).length
    return { ok: true, file: `${base}.${ext}`, cells, dir }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** PNG swatch cell color for palette entry `idx` — bgRegionPng draws used-row
 *  blocks as columns (each `cpr` colors tall) starting at x0 (= region width);
 *  read the 8×8 cell's centre pixel. Undefined if off-image. */
function swatchColorAt(img: ImageData, x0: number, cpr: number, idx: number): number | undefined {
  const x = x0 + Math.floor(idx / cpr) * 8 + 4
  const y = (idx % cpr) * 8 + 4
  if (x >= img.width || y >= img.height) return undefined
  const o = (y * img.width + x) * 4
  return ((img.rgba[o + 3]! << 24) | (img.rgba[o + 2]! << 16) | (img.rgba[o + 1]! << 8) | img.rgba[o]!) >>> 0
}

/** Detect recolored palette entries: each imported color vs the exported one. An
 *  opaque difference ⇒ a PaletteEdit (blob offset → BGR-15) + an effective-CGRAM
 *  override (cgramIndex → BGR-15) used so pixels showing the new color still match. */
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

/** Clone `cgram` and overlay the effective palette-color edits (cgramIndex → BGR-15). */
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
export async function importBgRegionFromDir(dir: string, reconciler: GfxImportReconciler): Promise<BgRegionImportOk | Err> {
  try {
    const { rom, symbols } = loadRomAndSymbols()
    const dirFiles = readdirSync(dir)
    const sidecars = dirFiles.filter((f) => /^bg[123]-region\.json$/.test(f)).sort()
    const m1Sidecars = dirFiles.filter((f) => /^bg[123]-region.*\.m1\.json$/.test(f)).sort()
    if (sidecars.length === 0 && m1Sidecars.length === 0) return { ok: false, error: 'No bg-region exports found in that folder.' }

    const errors: string[] = []
    const log: string[] = []
    const perRegion: RegionImportLogEntry[] = []
    // CHR tile edits + palette colors now flow into the SHARED reconciler (gfx-import-reconcile),
    // which merges across regions AND with the gfx-png importer, conflict-checks, and writes once
    // in graphics-folder-io. Tilemap WORD placement stays a direct saveGfxEdit here (single-owner).
    let conflicts = 0
    let regions = 0
    let mismatches = 0
    let repositioned = 0 // index-based placement edits (tilemap words written)
    // CHECKSUM GATE: skip a region whose exported artifact still matches its sidecar checksum
    // (unedited since export) — the anti-thrash fix. `unchanged(artifact, sc)` reads the file.
    const unchanged = (artifact: string, sc: { checksum?: string }): boolean =>
      !!sc.checksum && existsSync(artifact) && fileChecksum(readFileSync(artifact)) === sc.checksum

    for (const scFile of sidecars) {
      const sc = JSON.parse(readFileSync(join(dir, scFile), 'utf8')) as BgRegionSidecar
      const asePath = join(dir, scFile.replace(/\.json$/, '.aseprite'))
      const pngPath = join(dir, scFile.replace(/\.json$/, '.png'))
      if (unchanged(existsSync(asePath) ? asePath : pngPath, sc)) continue // unedited → skip

      const cpr = sc.bpp === 4 ? 16 : 4
      const aseMode: 'pixels' | 'layout' = sc.asepriteMode ?? 'pixels'

      // LAYOUT (BG2/BG3 only): the 16×16-WORD placement `.aseprite` — rearranged cells →
      // changed tilemap words → the decompressed tilemap file. Placement-ONLY (no pixel
      // slice); 8×8 placement is impossible in 16×16 tile mode, so this is its own mode.
      // The pixel edits live in the separate 8×8 'pixels' export.
      if (sc.layer !== 1 && aseMode === 'layout' && existsSync(asePath)) {
        const mhp = toMetatileHeader(sc.header)
        const bgCtx = buildBgRegionContext(rom, symbols, mhp, gfxLiveEdits())
        applyLivePreviewPalette(bgCtx.cgram, rom, symbols, mhp)
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
            const r = saveGfxEdit('lz2', src.fileId, bytes, undefined, { kind: 'tilemap', unitBytes: 2 })
            if (r.ok) { repositioned += written; log.push(`${scFile} (BG${sc.layer} layout): ${written} tile${written === 1 ? '' : 's'} repositioned${pd.skipped ? ` (${pd.skipped} non-editable/new skipped)` : ''}`) }
            else errors.push(`${scFile}: ${r.error}`)
          }
        } else if (pd.skipped > 0) {
          log.push(`${scFile} (BG${sc.layer} layout): ${pd.skipped} cell${pd.skipped === 1 ? '' : 's'} skipped (non-editable / new tile — add new art via the pixel export)`)
        }
        continue // placement-only; the pixel slice below is skipped
      }

      // COMBINED (BG2/BG3 8×8 PIXEL `.aseprite`): the whole file is the source of truth.
      // Drive both halves from the Aseprite TILE INDICES (not RGBA): (1) write every
      // editable tileset tile's pixels to its CHR, authoritatively; (2) rewrite every 16×16
      // tilemap WORD from its 2×2 cell group. Drops the surgical base-aware/only-changed
      // diff. PNG can't carry indices/positions and BG1 is the Map16 model → both stay on
      // the flatten path below. See diffBgRegionCombined.
      if (sc.layer !== 1 && aseMode === 'pixels' && existsSync(asePath)) {
        const mhc = toMetatileHeader(sc.header)
        const bgCtx = buildBgRegionContext(rom, symbols, mhc, gfxLiveEdits())
        applyLivePreviewPalette(bgCtx.cgram, rom, symbols, mhc)
        const region = renderBgRegion(bgCtx, sc.layer)
        const struct = decodeAsepriteStructural(readFileSync(asePath))
        if (struct.width !== sc.width || struct.height !== sc.height) {
          errors.push(`${scFile}: aseprite is ${struct.width}×${struct.height}, expected ${sc.width}×${sc.height} (canvas resized?)`)
          continue
        }
        // Palette color edits (recolors) are orthogonal to the index-based pixel/word
        // write — detect + persist them to the master blob (same as the flatten path).
        if (sc.palette && sc.palette.length) {
          const det = detectPaletteEdits(sc.palette, (idx) => (idx < struct.palette.length ? struct.palette[idx]! : undefined))
          for (const pe of det.edits) reconciler.paletteWord(pe.offset, pe.value, scFile)
          if (det.edits.length) log.push(`${scFile}: ${det.edits.length} palette color${det.edits.length === 1 ? '' : 's'} changed`)
          if (det.uneditable > 0) {
            errors.push(`${scFile}: ${det.uneditable} recolored palette entr${det.uneditable === 1 ? 'y is' : 'ies are'} not editable through the palette (not master-blob-sourced — e.g. a transparent/backdrop slot)`)
          }
        }
        const tmAddr = sc.layer === 2 ? bgCtx.regs.bg2TilemapAddr : bgCtx.regs.bg3TilemapAddr
        // VANILLA CHR reference (no live edits) so the import identifies WHICH view of a
        // shared CHR was edited stably — without it, re-imports flip-flop (see diffBgRegionCombined).
        const vanillaCtx = buildBgRegionContext(rom, symbols, mhc)
        const src = resolveBgTilemapSource(rom, symbols, sc.layer, sc.layer === 2 ? mhc.bg2Tileset : mhc.bg3Tileset)
        // CURRENT tilemap = a prior placement import (live overlay) ⊕ vanilla, so an
        // already-applied move isn't re-reported (loadBg2Tilemap itself reads only vanilla).
        const currentTilemap = src && tmAddr === src.vramBase ? (liveTiles('lz2', src.fileId) ?? src.bytes) : undefined
        const cd = diffBgRegionCombined(bgCtx, region, struct, tmAddr, { baseVram: vanillaCtx.vram, currentTilemap })
        conflicts += cd.conflicts
        mismatches += cd.mismatches
        regions++
        // Step 1 — CHR pixel tiles → the shared reconciler (re-encoded once, conflict-checked).
        reconciler.registerManifest(bgCtx.manifest)
        for (const ed of cd.tileEdits) reconciler.chrTile(ed.format, ed.fileId, ed.fileTile, ed.bytes, sc.bpp === 4 ? 32 : 16, scFile)
        // Step 2 — tilemap WORD writes → splice the decompressed tilemap file (onto the
        // CURRENT tilemap so successive placement imports accumulate).
        if (cd.wordEdits.length > 0) {
          if (!src) errors.push(`${scFile}: BG${sc.layer} has no static editable tilemap file`)
          else if (tmAddr !== src.vramBase) errors.push(`${scFile}: BG${sc.layer} tilemap base mismatch (0x${tmAddr.toString(16)} vs 0x${src.vramBase.toString(16)})`)
          else {
            const bytes = (currentTilemap ?? src.bytes).slice()
            let written = 0
            for (const e of cd.wordEdits) if (e.fileOffset >= 0 && e.fileOffset + 1 < bytes.length) { bytes[e.fileOffset] = e.word & 0xff; bytes[e.fileOffset + 1] = (e.word >> 8) & 0xff; written++ }
            const r = saveGfxEdit('lz2', src.fileId, bytes, undefined, { kind: 'tilemap', unitBytes: 2 })
            if (r.ok) repositioned += written
            else errors.push(`${scFile}: ${r.error}`)
          }
        }
        perRegion.push({ file: scFile, layer: sc.layer, source: 'aseprite', tiles: cd.tileEdits.length, mismatches: cd.mismatches, conflicts: cd.conflicts })
        log.push(
          `${scFile} (aseprite, BG${sc.layer}): ${cd.tileEdits.length} tile${cd.tileEdits.length === 1 ? '' : 's'} changed, ${cd.wordEdits.length} repositioned` +
          (cd.mismatches ? `, ${cd.mismatches} off-palette pixel${cd.mismatches === 1 ? '' : 's'}` : '') +
          (cd.conflicts ? `, ${cd.conflicts} shared-tile conflict${cd.conflicts === 1 ? '' : 's'}` : '') +
          (cd.newTiles ? `, ${cd.newTiles} new tile${cd.newTiles === 1 ? '' : 's'} skipped` : '') +
          (cd.incoherentWords ? `, ${cd.incoherentWords} word${cd.incoherentWords === 1 ? '' : 's'} not rewritable` : '')
        )
        if (cd.mismatches > 0) errors.push(`${scFile}: ${cd.mismatches} pixel${cd.mismatches === 1 ? '' : 's'} used a color not in their tile's palette row (wrong palette row?)`)
        if (cd.newTiles > 0) errors.push(`${scFile}: ${cd.newTiles} Aseprite tile${cd.newTiles === 1 ? '' : 's'} beyond the export couldn't be mapped to a CHR slot — use Manual tileset mode (Auto-mode paints append tiles); add genuinely new art via the raw sheet`)
        continue // combined handled both pixels + positions; skip the flatten path below
      }

      // PIXELS (8×8, BG1 / PNG) or PNG: flatten/read to the region RGBA, then base-aware
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

      // Palette color edits (recolored Aseprite-palette / PNG-swatch entries) →
      // master-blob write-back + an effective CGRAM so pixels showing the new color
      // still match (and don't read as off-palette).
      let effective = new Map<number, number>()
      if (sc.palette && sc.palette.length) {
        const det = detectPaletteEdits(sc.palette, importedPaletteAt)
        effective = det.effective
        for (const pe of det.edits) reconciler.paletteWord(pe.offset, pe.value, scFile)
        if (det.edits.length) log.push(`${scFile}: ${det.edits.length} palette color${det.edits.length === 1 ? '' : 's'} changed`)
        if (det.uneditable > 0) {
          errors.push(`${scFile}: ${det.uneditable} recolored palette entr${det.uneditable === 1 ? 'y is' : 'ies are'} not editable through the palette (not master-blob-sourced — e.g. a transparent/backdrop slot)`)
        }
      }
      // SNES is 5-bit/channel: snap imported pixels to that grid so edited-palette
      // colors match the effective row palette; genuine off-row paints snap to their
      // own color, which is still absent from the row → still flagged.
      quantizeRegion(edited)

      let diff: { edits: MetatileTileEdit[]; conflicts: number; mismatches: number }
      let manifest: GfxFileEntry[]
      const tileBytes = sc.bpp === 4 ? 32 : 16
      if (sc.layer === 1) {
        const ctx = buildMetatileContext(rom, symbols, mh, gfxLiveEdits())
        applyLivePreviewPalette(ctx.cgram, rom, symbols, mh)
        if (effective.size) ctx.cgram = effectiveCgram(ctx.cgram, effective)
        diff = diffBg1Region(
          ctx,
          { rgba: new Uint8Array(0), width: sc.width, height: sc.height, cells: sc.cells ?? [], paletteRowsUsed: [] },
          edited
        )
        manifest = ctx.manifest
      } else {
        const bgCtx = buildBgRegionContext(rom, symbols, mh, gfxLiveEdits())
        applyLivePreviewPalette(bgCtx.cgram, rom, symbols, mh)
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
        errors.push(`${scFile}: ${diff.mismatches} pixel${diff.mismatches === 1 ? '' : 's'} used a color not in their tile's palette row — clamped to index 0 (wrong palette row?)`)
      }

      reconciler.registerManifest(manifest)
      for (const ed of diff.edits) reconciler.chrTile(ed.format, ed.fileId, ed.fileTile, ed.bytes, tileBytes, scFile)
    }

    // ── M1TE2 ".M1" session imports ─────────────────────────────────────────────
    // Each `.m1.json` + its `.M1` carry one whole BG2/BG3 layer (v2 holds up to 64×64). The
    // .M1 is the new source of truth — diffed against the cart for CHR pixel bytes (a direct
    // planar compare, no per-row views), tilemap WORDS, and palette colors. CHR edits join the
    // shared per-file patch map; tilemap words accumulate per file and splice once.
    const m1WordEdits = new Map<number, { src: BgTilemapSource; words: Map<number, number> }>()
    for (const scFile of m1Sidecars) {
      try {
        const sc = JSON.parse(readFileSync(join(dir, scFile), 'utf8')) as M1te2Sidecar
        const m1Name = scFile.replace(/\.m1\.json$/, '.M1')
        const m1Path = join(dir, m1Name)
        if (!existsSync(m1Path)) { errors.push(`${scFile}: missing ${m1Name}`); continue }
        if (unchanged(m1Path, sc)) continue // unedited .M1 → skip (checksum gate)

        // BG1 area: an 8×8 Map16-sub-tile tilemap → CHR pixels + palette only (no placement —
        // BG1's layout is the level editor). Rebuild the region from the sidecar's cells (no
        // level re-decode), then byte-compare the .M1 CHR back to the BG1 tileset files.
        if (sc.layer === 1) {
          const mh = toMetatileHeader(sc.header)
          const ctx = buildMetatileContext(rom, symbols, mh, gfxLiveEdits())
          applyLivePreviewPalette(ctx.cgram, rom, symbols, mh)
          const region = { rgba: new Uint8Array(0), width: sc.width, height: sc.height, cells: sc.cells ?? [], paletteRowsUsed: [] }
          const d = diffBg1RegionM1te2(ctx, region, readFileSync(m1Path))
          regions++
          reconciler.registerManifest(ctx.manifest)
          for (const ed of d.tileEdits) reconciler.chrTile(ed.format, ed.fileId, ed.fileTile, ed.bytes, 32, scFile)
          let uneditable = 0
          if (d.paletteEdits.length) {
            const provenance = new Int32Array(256)
            loadLevelPalettes(rom, symbols, mh, new Uint8Array(512), provenance)
            for (const pe of d.paletteEdits) {
              const off = provenance[pe.cgramIndex] ?? -1
              if (off < 0) { uneditable++; continue }
              reconciler.paletteWord(off, pe.bgr15, scFile)
            }
          }
          perRegion.push({ file: scFile, layer: 1, source: 'm1te2', tiles: d.tileEdits.length, mismatches: 0, conflicts: 0 })
          log.push(
            `${scFile} (M1TE, BG1): ${d.tileEdits.length} tile${d.tileEdits.length === 1 ? '' : 's'} changed, ` +
            `${d.paletteEdits.length - uneditable} palette color${d.paletteEdits.length - uneditable === 1 ? '' : 's'}` +
            (d.skippedTiles ? `, ${d.skippedTiles} non-editable tile${d.skippedTiles === 1 ? '' : 's'} skipped` : '')
          )
          if (uneditable > 0) errors.push(`${scFile}: ${uneditable} recolored palette entr${uneditable === 1 ? 'y is' : 'ies are'} not editable (not master-blob-sourced)`)
          continue
        }

        const mh = toMetatileHeader(sc.header)
        const bgCtx = buildBgRegionContext(rom, symbols, mh, gfxLiveEdits())
        applyLivePreviewPalette(bgCtx.cgram, rom, symbols, mh)
        const region = renderBgRegion(bgCtx, sc.layer)
        if (region.width !== sc.width || region.height !== sc.height) {
          errors.push(`${scFile}: BG${sc.layer} is ${region.width}×${region.height}, sidecar expected ${sc.width}×${sc.height} (level changed?)`)
          continue
        }
        const tmAddr = sc.layer === 2 ? bgCtx.regs.bg2TilemapAddr : bgCtx.regs.bg3TilemapAddr
        const src = resolveBgTilemapSource(rom, symbols, sc.layer, sc.layer === 2 ? mh.bg2Tileset : mh.bg3Tileset)
        const currentTilemap = src && tmAddr === src.vramBase ? (liveTiles('lz2', src.fileId) ?? src.bytes) : undefined
        const d = diffBgRegionM1te2(bgCtx, region, readFileSync(m1Path), tmAddr, { currentTilemap })
        regions++

        // CHR pixels → the shared reconciler (re-encoded with everything else, conflict-checked).
        reconciler.registerManifest(bgCtx.manifest)
        for (const ed of d.tileEdits) reconciler.chrTile(ed.format, ed.fileId, ed.fileTile, ed.bytes, sc.bpp === 4 ? 32 : 16, scFile)

        // Tilemap words → accumulate per tilemap file (spliced once after the loop).
        if (d.wordEdits.length > 0) {
          if (!src) errors.push(`${scFile}: BG${sc.layer} has no static editable tilemap file`)
          else if (tmAddr !== src.vramBase) errors.push(`${scFile}: BG${sc.layer} tilemap base mismatch (0x${tmAddr.toString(16)} vs 0x${src.vramBase.toString(16)})`)
          else {
            const acc = m1WordEdits.get(src.fileId) ?? { src, words: new Map<number, number>() }
            for (const e of d.wordEdits) if (e.fileOffset >= 0) acc.words.set(e.fileOffset, e.word)
            m1WordEdits.set(src.fileId, acc)
          }
        }

        // Palette colors → master-blob offsets via provenance (skip non-blob-sourced slots).
        let uneditable = 0
        if (d.paletteEdits.length) {
          const provenance = new Int32Array(256)
          loadLevelPalettes(rom, symbols, mh, new Uint8Array(512), provenance)
          for (const pe of d.paletteEdits) {
            const off = provenance[pe.cgramIndex] ?? -1
            if (off < 0) { uneditable++; continue }
            reconciler.paletteWord(off, pe.bgr15, scFile)
          }
        }

        perRegion.push({ file: scFile, layer: sc.layer, source: 'm1te2', tiles: d.tileEdits.length, mismatches: 0, conflicts: 0 })
        log.push(
          `${scFile} (M1TE2, BG${sc.layer}): ${d.tileEdits.length} tile${d.tileEdits.length === 1 ? '' : 's'} changed, ` +
          `${d.wordEdits.length} repositioned, ${d.paletteEdits.length - uneditable} palette color${d.paletteEdits.length - uneditable === 1 ? '' : 's'}` +
          (d.skippedTiles ? `, ${d.skippedTiles} non-editable tile${d.skippedTiles === 1 ? '' : 's'} skipped` : '') +
          (d.skippedWords ? `, ${d.skippedWords} non-editable cell${d.skippedWords === 1 ? '' : 's'} skipped` : '')
        )
        if (uneditable > 0) errors.push(`${scFile}: ${uneditable} recolored palette entr${uneditable === 1 ? 'y is' : 'ies are'} not editable (not master-blob-sourced)`)
      } catch (e) {
        errors.push(`${scFile}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    // Splice each tilemap file's accumulated M1TE2 word edits once, onto the live overlay.
    for (const { src, words } of m1WordEdits.values()) {
      if (words.size === 0) continue
      const bytes = (liveTiles('lz2', src.fileId) ?? src.bytes).slice()
      let written = 0
      for (const [off, word] of words) if (off >= 0 && off + 1 < bytes.length) { bytes[off] = word & 0xff; bytes[off + 1] = (word >> 8) & 0xff; written++ }
      const r = saveGfxEdit('lz2', src.fileId, bytes, undefined, { kind: 'tilemap', unitBytes: 2 })
      if (r.ok) repositioned += written
      else errors.push(`BG tilemap 0x${src.fileId.toString(16)}: ${r.error}`)
    }

    // CHR re-encode + palette merge + cross-file conflict resolution happen ONCE in
    // reconciler.apply() (graphics-folder-io), after the gfx-png importer has also recorded.
    // `applied`/`paletteChanged` are reported from there; here they're 0 (this importer only
    // records them + does the single-owner tilemap-word saves counted in `repositioned`).
    return { ok: true, dir, applied: 0, repositioned, conflicts, regions, mismatches, paletteChanged: 0, perRegion, log, errors }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Standalone BG-region import (the "Region"-only IPC entry points that DON'T go through the
 * unified `importGraphicsFolder`): own a reconciler, record, then `apply()` it here so the
 * caller gets a complete result. The unified path shares ONE reconciler across both importers
 * instead (graphics-folder-io), so it calls `importBgRegionFromDir` directly.
 */
export async function importBgRegionFolder(dir: string): Promise<BgRegionImportOk | Err> {
  const reconciler = new GfxImportReconciler()
  const r = await importBgRegionFromDir(dir, reconciler)
  if (!r.ok) return r
  const { rom, symbols } = loadRomAndSymbols()
  const a = await reconciler.apply(rom, symbols)
  return {
    ...r,
    applied: a.applied,
    paletteChanged: a.paletteChanged,
    log: [...r.log, `Saved ${a.applied} gfx file${a.applied === 1 ? '' : 's'}, ${a.paletteChanged} palette color${a.paletteChanged === 1 ? '' : 's'}.`],
    errors: [...r.errors, ...a.conflicts]
  }
}
