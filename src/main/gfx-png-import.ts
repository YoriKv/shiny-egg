// Graphics PNG/Aseprite IMPORT (the "Graphics" panel backend, import half). Reads
// the manifest (gfx-manifest.ts) + edited PNGs/Aseprite a gfx-png-export.ts run
// wrote, converts each back to SNES tile bytes, and saves ONLY the files whose
// pixels actually changed (vs the base blob) via saveGfxEdit — so unedited files
// keep the build byte-identical and the reinsert pipeline only moves what changed.
// Mirrors gfx-png-export.ts's two tracks (SCREENS char sheets + tilemaps,
// METASPRITES + glyphs); see research/graphics-editing/.

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  buildWorldMapIconContext,
  renderWorldMapIcon,
  diffWorldMapIconTiles,
  buildTitleLogoContext,
  renderTitleLogo,
  diffTitleLogoTiles,
  diffTitleLogoCombined,
  buildTitleIslandContext,
  renderTitleIsland,
  diffTitleIslandTiles,
  diffTitleIslandCombined,
  buildTitleSceneryContext,
  renderTitleScenery,
  diffTitleScenery,
  SCENERY_BIN_FILE,
  type WorldMapIconContext
} from 'snes-framework/screen-gfx'
import {
  buildLevelIconContext,
  renderWorldMapLevelIcon,
  sliceLevelIconWrites,
  type LevelIconContext
} from 'snes-framework/world-map-level-icons'
import {
  buildWorldMapTerrainContext,
  diffWorldMapTerrainPlacement,
  buildWorldMapGroundContext,
  diffWorldMapGroundPlacement
} from 'snes-framework/world-map-terrain'
import {
  buildMetaspriteContext,
  renderMetasprite,
  diffMetaspriteTiles,
  type MetaspriteHeader,
  type MetaspriteCanvas
} from 'snes-framework/sprite-metasprite'
import { glyphWritesForSprite } from 'snes-framework/sprite-glyph'
import { decodePng } from 'snes-framework/png'
import { canvasRegion, decodeGfxFile, liveTiles } from './gfx-import-utils'
import { imageToGfx, lz16Layout, lz2Layout } from 'snes-framework/gfx-png'
import { diffGfxFileAseprite } from 'snes-framework/gfx-aseprite'
import { decodeAsepriteRegion, decodeAsepriteStructural, decodeAsepriteImage } from 'snes-framework/aseprite'
import { type SymbolMap } from 'snes-framework/symbol-map'
import type { GfxFileEntry } from 'snes-framework/load-graphics'
import type { RenderHeaderRequest } from '../shared/ipc-types'
import { loadRomAndSymbols } from './render/rom-cache'
import { gfxLiveEdits } from './gfx-live-cache'
import { saveGfxEdit, saveRawChrEdit, saveIslandTilemap, saveLogoTilemap } from './resources'
import {
  MANIFEST,
  type GfxManifestEntry,
  type MetaspriteManifestEntry,
  type GlyphManifestEntry,
  type MapIconManifestEntry,
  type LevelIconManifestEntry,
  type MapTerrainManifestEntry,
  type MapGroundManifestEntry,
  type TitleLogoManifestEntry,
  type TitleIslandManifestEntry,
  type TitleSceneryManifestEntry
} from './gfx-manifest'

const eq = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((v, i) => v === b[i])

/** Decompress a gfx file's base blob to tile bytes (for the changed-vs-base check). */
const decodeBase = (rom: Uint8Array, symbols: SymbolMap, e: GfxManifestEntry): Uint8Array =>
  liveTiles(e.format, e.fileId) ?? decodeGfxFile(rom, symbols, e.format, e.fileId, e.sizeBytes, e.rowCount)

/** Per-(format,fileId) accumulation of changed tiles, shared by every assembled-view
 *  importer (metasprites, world-map icons, title logo): each slicer emits
 *  per-tile edits which merge here before one re-encode per file. */
type FilePatchMap = Map<string, { fileId: number; format: 'lz2' | 'lz16'; tiles: Map<number, Uint8Array> }>
interface SlicedTileEdit { format: 'lz2' | 'lz16'; fileId: number; fileTile: number; bytes: Uint8Array }

/** Fold a slicer's edits into the patch map (last write wins per file-tile). */
function addTilePatches(filePatches: FilePatchMap, edits: readonly SlicedTileEdit[]): void {
  for (const ed of edits) {
    const key = `${ed.format}/${ed.fileId}`
    const fp = filePatches.get(key) ?? { fileId: ed.fileId, format: ed.format, tiles: new Map<number, Uint8Array>() }
    fp.tiles.set(ed.fileTile, ed.bytes)
    filePatches.set(key, fp)
  }
}

/** Re-encode each patched gfx file: start from the cross-block `savedFileTiles` cache
 *  (else the live-edit overlay, else the cart blob), splice the changed tiles at the
 *  file's tile stride, and `saveGfxEdit`. Sharing `savedFileTiles` makes edits to the
 *  same file across import blocks (e.g. a raw sheet + an assembled view) merge
 *  last-write-wins. `scope` names the loaded set for the "not loaded" error. */
function applyTilePatches(filePatches: FilePatchMap, args: {
  manifest: GfxFileEntry[]
  scope: string
  tileBytesOf: (format: 'lz2' | 'lz16') => number
  rom: Uint8Array
  symbols: SymbolMap
  savedFileTiles: Map<string, Uint8Array>
  errors: string[]
}): void {
  const { manifest, scope, tileBytesOf, rom, symbols, savedFileTiles, errors } = args
  for (const [key, fp] of filePatches) {
    try {
      const me = manifest.find((m) => m.format === fp.format && m.fileId === fp.fileId)
      if (!me) { errors.push(`gfx file 0x${fp.fileId.toString(16)}: not loaded in ${scope}`); continue }
      const rowCount = fp.format === 'lz16' ? me.sizeBytes / 512 : undefined
      const tileBytes = tileBytesOf(fp.format)
      const prior = savedFileTiles.get(key)
      const tiles = prior ? prior.slice() : (liveTiles(fp.format, fp.fileId) ?? decodeGfxFile(rom, symbols, fp.format, fp.fileId, me.sizeBytes, rowCount))
      for (const [fileTile, bytes] of fp.tiles) tiles.set(bytes, fileTile * tileBytes)
      const r = saveGfxEdit(fp.format, fp.fileId, tiles, rowCount)
      if (r.ok) savedFileTiles.set(key, tiles.slice())
      else errors.push(`gfx file 0x${fp.fileId.toString(16)}: ${r.error}`)
    } catch (err) {
      errors.push(`gfx file 0x${fp.fileId.toString(16)}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}

/** Result of importing a folder of edited PNGs. Gfx-file (screen char sheets) and
 *  metasprite counts are tracked separately. */
export interface ImportGfxResult {
  imported: number
  skipped: number
  missing: number
  /** Metasprite edits routed to the sprite gfx files (via saveGfxEdit). */
  spriteImported: number
  spriteSkipped: number
  spriteMissing: number
  /** Distinct OTHER sprites whose appearance changed because an edited tile is
   *  shared (the cart deduplicated it). */
  spritePropagated: number
  /** World-map level-slot icon edits routed to the shared $74/$75 BG files. */
  iconImported: number
  iconSkipped: number
  iconMissing: number
  /** Per-level ICON edits routed to the bank-$53 chunky `.bin` (via saveRawChrEdit). */
  levelIconImported: number
  levelIconSkipped: number
  levelIconMissing: number
  /** Overworld-map LAYOUT edits routed to the $7C/$7D… LZ2 tilemap files (via saveGfxEdit). */
  mapTerrainImported: number
  mapTerrainSkipped: number
  mapTerrainMissing: number
  /** Title-island (Mode-7) edits routed to file $B1's CPC char (via saveGfxEdit). */
  islandImported: number
  islandSkipped: number
  islandMissing: number
  /** Other island cells that reuse an edited tile and so also changed (tile-sharing). */
  islandSharedCells: number
  /** New island tiles added via the combined Aseprite import (allocated to free $B1 chars). */
  islandNewTiles: number
  /** Title-scenery (GSU 3D decorations) edits routed to DATA_560000.bin (via saveRawChrEdit). */
  sceneryImported: number
  scenerySkipped: number
  sceneryMissing: number
  /** Title-logo edits routed to the $1D char tiles (via saveGfxEdit). */
  logoImported: number
  logoSkipped: number
  logoMissing: number
  /** Dynamic-sprite glyph edits routed to the raw glyph `.bin` (via saveRawChrEdit). */
  glyphImported: number
  glyphSkipped: number
  glyphMissing: number
  /** Distinct OTHER sprites affected by a shared-glyph edit. */
  glyphShared: number
  errors: string[]
}

/**
 * Import edited PNGs from `dir`: for each gfx-file manifest entry (screen char
 * sheets) whose PNG is present and whose pixels differ from the base blob,
 * re-encode and saveGfxEdit; for each edited faithful metasprite, slice the edit
 * back to the sprite sheets and saveGfxEdit (merging with any raw-sheet edit).
 * Reports per-kind changed/unchanged/missing counts, errors, and how many other
 * sprites a shared-tile edit propagated to.
 */
export async function importGfxPngsFromDir(dir: string): Promise<ImportGfxResult> {
  const manifestPath = join(dir, MANIFEST)
  if (!existsSync(manifestPath)) {
    throw new Error(`No ${MANIFEST} in the selected folder — pick a folder you exported to.`)
  }
  const { entries, metasprites, glyphs, mapIcons, levelIcons, mapTerrain, mapGround, titleLogo, titleIsland, titleScenery } = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    entries: GfxManifestEntry[]
    metasprites?: { header: RenderHeaderRequest; sprites: MetaspriteManifestEntry[] }
    glyphs?: { header: RenderHeaderRequest; sprites: GlyphManifestEntry[] }
    mapIcons?: MapIconManifestEntry[]
    levelIcons?: LevelIconManifestEntry[]
    mapTerrain?: MapTerrainManifestEntry[]
    mapGround?: MapGroundManifestEntry
    titleLogo?: TitleLogoManifestEntry
    titleIsland?: TitleIslandManifestEntry
    titleScenery?: TitleSceneryManifestEntry
  }
  const { rom, symbols } = loadRomAndSymbols()
  let imported = 0, skipped = 0, missing = 0
  const errors: string[] = []
  // Saved tiles per gfx file (`format/fileId`), so a metasprite edit to the same
  // sheet patches ON TOP of a raw-sheet edit instead of clobbering it.
  const savedFileTiles = new Map<string, Uint8Array>()
  for (const e of entries) {
    const p = join(dir, e.file)
    if (!existsSync(p)) { missing++; continue }
    try {
      // Base-aware: unedited pixels keep their original index, so an untouched
      // file round-trips byte-exact (even with duplicate palette colours).
      const base = decodeBase(rom, symbols, e)
      // Cropped screen region (e.g. the boot logo): the export is only a w×h tile
      // sub-grid of the file — a PNG, OR a single-image `.aseprite` (no tilemap). Slice
      // it against the file's base sub-region, splice the changed tiles into the full
      // base, and saveGfxEdit the whole blob. Checked BEFORE the faithful-tileset
      // `.aseprite` branch so a region `.aseprite` takes this path, not the full-file one.
      if (e.region) {
        const { x, y, w, h } = e.region
        const tileBytes = e.bpp === 4 ? 32 : 16
        const cut = (buf: Uint8Array, into: Uint8Array, toFull: boolean): void => {
          for (let ry = 0; ry < h; ry++) for (let rx = 0; rx < w; rx++) {
            const full = ((y + ry) * 16 + (x + rx)) * tileBytes
            const sub = (ry * w + rx) * tileBytes
            const [src, dst] = toFull ? [sub, full] : [full, sub]
            into.set(buf.subarray(src, src + tileBytes), dst)
          }
        }
        const baseRegion = new Uint8Array(w * h * tileBytes)
        cut(base, baseRegion, false)
        let editedRegion: Uint8Array
        if (e.file.endsWith('.aseprite')) {
          // Single-image region .aseprite: base-aware slice of its embedded-palette
          // flatten over the region's flat tile grid (diffGfxFileAseprite — no swatch).
          const dec = decodeAsepriteImage(readFileSync(p))
          const edits = diffGfxFileAseprite({ palette: dec.palette, bpp: e.bpp, baseTileData: baseRegion, flatten: dec.rgba, width: dec.width })
          if (edits.length === 0) { skipped++; continue } // unchanged → no overlay
          editedRegion = baseRegion.slice()
          for (const ed of edits) editedRegion.set(ed.bytes, ed.tileIndex * tileBytes)
        } else {
          const img = decodePng(readFileSync(p))
          editedRegion = imageToGfx(img, { tilesWide: w, tilesTall: h, bpp: e.bpp }, { base: baseRegion, index0Transparent: e.index0Transparent })
          if (eq(editedRegion, baseRegion)) { skipped++; continue } // unchanged → no overlay
        }
        const full = base.slice()
        cut(editedRegion, full, true)
        const r = saveGfxEdit(e.format, e.fileId, full, e.rowCount)
        if (r.ok) { imported++; savedFileTiles.set(`${e.format}/${e.fileId}`, full.slice()) }
        else errors.push(`${e.file}: ${r.error}`)
        continue
      }
      // Faithful Aseprite tileset (`.aseprite`, full file, SINGLE palette): flatten +
      // slice changed tiles via its OWN embedded palette (no cart context) and splice
      // onto base. Gated to NON-per-tile-palette sheets — a per-tile-palette `.aseprite`
      // (the storybook char sheets) can't be sliced against one flat palette (a colour
      // means different indices in different rows), so it falls through to the per-tile
      // path below (flatten → imageToGfx with the per-tile palette, same as its PNG).
      if (e.file.endsWith('.aseprite') && !e.perTilePalette) {
        const dec = decodeAsepriteRegion(readFileSync(p))
        const edits = diffGfxFileAseprite({ palette: dec.palette, bpp: e.bpp, baseTileData: base, flatten: dec.rgba, width: dec.width })
        if (edits.length === 0) { skipped++; continue } // unchanged → no overlay
        const tileBytes = e.bpp === 4 ? 32 : 16
        const full = base.slice()
        for (const ed of edits) full.set(ed.bytes, ed.tileIndex * tileBytes)
        const tiles = full.subarray(0, e.sizeBytes)
        const r = saveGfxEdit(e.format, e.fileId, tiles, e.rowCount)
        if (r.ok) { imported++; savedFileTiles.set(`${e.format}/${e.fileId}`, tiles.slice()) }
        else errors.push(`${e.file}: ${r.error}`)
        continue
      }
      // PNG, or a per-tile-palette single-image `.aseprite` (the storybook sheets) — the
      // flatten reproduces the rendered RGBA byte-for-byte, so both take the SAME path.
      const img = e.file.endsWith('.aseprite') ? decodeAsepriteImage(readFileSync(p)) : decodePng(readFileSync(p))
      const layout = e.format === 'lz16' ? lz16Layout(e.rowCount!) : lz2Layout(e.sizeBytes, e.bpp)
      // BG2/BG3 + storybook decode each tile against its own palette row (the swatch
      // can't disambiguate rows that share colours); other layers use the swatch.
      const tilePalette = e.perTilePalette
        ? (t: number): readonly number[] =>
            e.perTilePalette!.subPalettes[e.perTilePalette!.tileSub[t] ?? 0] ?? e.perTilePalette!.subPalettes[0]!
        : undefined
      const tiles = imageToGfx(img, layout, { base, index0Transparent: e.index0Transparent, tilePalette }).subarray(0, e.sizeBytes)
      if (eq(tiles, base)) { skipped++; continue } // unchanged → no overlay
      const r = saveGfxEdit(e.format, e.fileId, tiles, e.rowCount)
      if (r.ok) { imported++; savedFileTiles.set(`${e.format}/${e.fileId}`, tiles.slice()) }
      else errors.push(`${e.file}: ${r.error}`)
    } catch (err) {
      errors.push(`${e.file}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // Metasprite edits → the sprite gfx files (via saveGfxEdit). Only `faithful`
  // metasprites are editable; previews are skipped. A tile edited via one sprite
  // propagates to others sharing it (the cart deduplicated) — reported.
  let spriteImported = 0, spriteSkipped = 0, spriteMissing = 0, spritePropagated = 0
  if (metasprites && metasprites.sprites.length > 0) {
    const ctx = buildMetaspriteContext(rom, symbols, metasprites.header as MetaspriteHeader, gfxLiveEdits())
    // Re-render the manifest's faithful metasprites (identical to export).
    const canvases = new Map<number, MetaspriteCanvas>()
    for (const e of metasprites.sprites) {
      if (!e.faithful) continue
      const c = renderMetasprite(ctx, e.spriteId)
      if (c && c.faithful) canvases.set(e.spriteId, c)
    }
    // Sheet tile → the sprites that draw it (for the propagation report).
    const tileSprites = new Map<string, Set<number>>()
    for (const [sid, c] of canvases) for (const r of c.records) if (r.units) for (const u of r.units) {
      const k = `${u.format}/${u.fileId}/${u.fileTile}`
      ;(tileSprites.get(k) ?? tileSprites.set(k, new Set()).get(k)!).add(sid)
    }
    // Accumulate tile patches per gfx file across all edited metasprites.
    const filePatches: FilePatchMap = new Map()
    const propagated = new Set<number>()
    for (const e of metasprites.sprites) {
      if (!e.faithful) continue
      const p = join(dir, e.file)
      if (!existsSync(p)) { spriteMissing++; continue }
      const canvas = canvases.get(e.spriteId)
      if (!canvas) { errors.push(`${e.file}: sprite 0x${e.spriteId.toString(16)} no longer faithfully reconstructable`); continue }
      try {
        const edited = e.file.endsWith('.aseprite')
          ? decodeAsepriteImage(readFileSync(p)).rgba
          : canvasRegion(decodePng(readFileSync(p)), canvas.width, canvas.height)
        const { edits } = diffMetaspriteTiles(ctx, canvas, edited)
        if (edits.length === 0) { spriteSkipped++; continue }
        for (const ed of edits) {
          const key = `${ed.format}/${ed.fileId}`
          const fp = filePatches.get(key) ?? { fileId: ed.fileId, format: ed.format, tiles: new Map<number, Uint8Array>() }
          fp.tiles.set(ed.fileTile, ed.bytes)
          filePatches.set(key, fp)
          for (const sid of tileSprites.get(`${ed.format}/${ed.fileId}/${ed.fileTile}`) ?? []) if (sid !== e.spriteId) propagated.add(sid)
        }
        spriteImported++
      } catch (err) {
        errors.push(`${e.file}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    spritePropagated = propagated.size
    // Sprites are 4bpp (32-byte tiles); start each file from any prior edit, splice
    // the changed tiles, re-encode.
    applyTilePatches(filePatches, { manifest: ctx.manifest, scope: 'this level', tileBytesOf: () => 32, rom, symbols, savedFileTiles, errors })
  }

  // World-map level-slot icon edits → the shared $74/$75 BG gfx files (via
  // saveGfxEdit). Faithful icons only; per-world context. The icon TILE PIXELS are
  // shared across all worlds (only the tint differs), so an edit to any world's
  // icon writes the same shared tiles — merges via savedFileTiles (last write wins).
  let iconImported = 0, iconSkipped = 0, iconMissing = 0
  if (mapIcons && mapIcons.length > 0) {
    const ctxByWorld = new Map<number, WorldMapIconContext>()
    const filePatches: FilePatchMap = new Map()
    for (const e of mapIcons) {
      if (!e.faithful) continue
      const p = join(dir, e.file)
      if (!existsSync(p)) { iconMissing++; continue }
      let ctx = ctxByWorld.get(e.world)
      if (!ctx) { ctx = buildWorldMapIconContext(rom, symbols, e.world); ctxByWorld.set(e.world, ctx) }
      const canvas = renderWorldMapIcon(ctx, e.name)
      if (!canvas || !canvas.faithful) { errors.push(`${e.file}: world-map ${e.name} icon no longer faithfully reconstructable`); continue }
      try {
        // `.aseprite` is a single-image project (no swatch) → its flatten IS the canvas;
        // a PNG carries a swatch column, so crop to the canvas region.
        const edited = e.file.endsWith('.aseprite')
          ? decodeAsepriteImage(readFileSync(p)).rgba
          : canvasRegion(decodePng(readFileSync(p)), canvas.width, canvas.height)
        const { edits } = diffWorldMapIconTiles(ctx, canvas, edited)
        if (edits.length === 0) { iconSkipped++; continue }
        addTilePatches(filePatches, edits)
        iconImported++
      } catch (err) {
        errors.push(`${e.file}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    // The icon tiles live in the shared $74/$75 BG files (4bpp); any world's context
    // resolves them.
    const anyCtx = ctxByWorld.values().next().value
    applyTilePatches(filePatches, { manifest: anyCtx?.manifest ?? [], scope: 'the world map', tileBytesOf: () => 32, rom, symbols, savedFileTiles, errors })
  }

  // Per-level ICON edits → the bank-$53 chunky `.bin` (via saveRawChrEdit). Faithful
  // icons only; per-world context. Pixels are GSU-chunky (1B/px, two icons packed per
  // byte); the slice RMW's only this icon's nibble (the other column's preserved), one
  // 28-byte write per 256-byte row (cols 28-31 belong to the neighbour icon).
  let levelIconImported = 0, levelIconSkipped = 0, levelIconMissing = 0
  if (levelIcons && levelIcons.length > 0) {
    const ctxByWorld = new Map<number, LevelIconContext>()
    const writes: { binFile: string; offset: number; bytes: Uint8Array }[] = []
    for (const e of levelIcons) {
      if (!e.faithful) continue
      const p = join(dir, e.file)
      if (!existsSync(p)) { levelIconMissing++; continue }
      let ctx = ctxByWorld.get(e.world)
      if (!ctx) { ctx = buildLevelIconContext(rom, symbols, e.world); ctxByWorld.set(e.world, ctx) }
      const canvas = renderWorldMapLevelIcon(ctx, e.slot)
      if (!canvas || !canvas.faithful) { errors.push(`${e.file}: level icon (world ${e.world} slot ${e.slot}) no longer reconstructable`); continue }
      try {
        const edited = e.file.endsWith('.aseprite')
          ? decodeAsepriteImage(readFileSync(p)).rgba
          : canvasRegion(decodePng(readFileSync(p)), canvas.width, canvas.height)
        const res = sliceLevelIconWrites(ctx, canvas, edited)
        if (!res) { errors.push(`${e.file}: icon source not in a known $53 bin`); continue }
        if (!res.changed) { levelIconSkipped++; continue }
        writes.push(...res.writes)
        levelIconImported++
      } catch (err) {
        errors.push(`${e.file}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    if (writes.length > 0) {
      const r = saveRawChrEdit(writes)
      if (!r.ok) { errors.push(`level icons: ${r.error}`); levelIconImported = 0 }
    }
  }

  // Overworld-map LAYOUT edits → the $7C/$7D… LZ2 tilemap files (via saveGfxEdit). Only
  // the `.aseprite` (the editable tilemap) carries layout; a `.png` is the composited
  // VIEW (no tilemap), so it's skipped. Each cell → its tile's (char,pal,prio) word | the
  // cell's flip → the 64×32 screen-block tilemap; the diff rewrites only changed words.
  // Map PIXELS are the shared $74/$75/$4C char — edited via those sheets, not here.
  let mapTerrainImported = 0, mapTerrainSkipped = 0, mapTerrainMissing = 0
  if (mapTerrain && mapTerrain.length > 0) {
    for (const e of mapTerrain) {
      const p = join(dir, e.file)
      if (!existsSync(p)) { mapTerrainMissing++; continue }
      if (!e.file.endsWith('.aseprite')) { mapTerrainSkipped++; continue } // PNG = view-only
      try {
        const ctx = buildWorldMapTerrainContext(rom, symbols, e.world, e.half)
        const tilemap = diffWorldMapTerrainPlacement(ctx, decodeAsepriteStructural(readFileSync(p)))
        if (!tilemap) { mapTerrainSkipped++; continue } // unchanged layout → no overlay
        const r = saveGfxEdit('lz2', e.fileId, tilemap)
        if (r.ok) mapTerrainImported++
        else errors.push(`${e.file}: ${r.error}`)
      } catch (err) {
        errors.push(`${e.file}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  }
  // The shared decorative-ground layout ($7E) — same model, one file. Counted with the
  // overworld-map track above. (PNG = view-only; only the .aseprite carries layout.)
  if (mapGround) {
    const p = join(dir, mapGround.file)
    if (!existsSync(p)) { mapTerrainMissing++ }
    else if (!mapGround.file.endsWith('.aseprite')) { mapTerrainSkipped++ }
    else {
      try {
        const ctx = buildWorldMapGroundContext(rom, symbols)
        const tilemap = diffWorldMapGroundPlacement(ctx, decodeAsepriteStructural(readFileSync(p)))
        if (!tilemap) { mapTerrainSkipped++ }
        else {
          const r = saveGfxEdit('lz2', mapGround.fileId, tilemap)
          if (r.ok) mapTerrainImported++
          else errors.push(`${mapGround.file}: ${r.error}`)
        }
      } catch (err) {
        errors.push(`${mapGround.file}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  }

  // Title-logo edits → the $1D char tiles (pixels, via saveGfxEdit) + the logo tilemap
  // (placement, via saveLogoTilemap → Bank0F overlay). A `.aseprite` is COMBINED (pixels +
  // placement, Manual tileset mode); a `.png` is pixels-only. The $1D tiles are shared with
  // the raw screens/title/f1D.png sheet, so pixel edits merge via savedFileTiles. $1D is
  // lz2/2bpp → tile stride is 16 bytes.
  let logoImported = 0, logoSkipped = 0, logoMissing = 0
  if (titleLogo) {
    const p = join(dir, titleLogo.file)
    if (!existsSync(p)) { logoMissing++ }
    else if (!titleLogo.faithful) { /* preview-only: skip silently */ }
    else {
      const ctx = buildTitleLogoContext(rom, symbols)
      const canvas = renderTitleLogo(ctx)
      if (!canvas.faithful) {
        errors.push(`${titleLogo.file}: title logo no longer faithfully reconstructable`)
      } else {
        try {
          let pixelEdits: { fileId: number; format: 'lz2' | 'lz16'; fileTile: number; bytes: Uint8Array }[] = []
          let changed = false
          if (p.endsWith('.aseprite')) {
            // COMBINED: structural read → pixels ($1D char tiles) + placement (the Bank0F
            // logo tilemap words). Reads the .aseprite cell tile indices, not a flatten.
            const d = diffTitleLogoCombined(ctx, decodeAsepriteStructural(readFileSync(p)))
            if (d.removedTiles) {
              errors.push(`title logo: the tileset has fewer tiles than exported — tiles were deleted/reordered. Edit in Manual tileset mode (don't delete tiles) or re-export.`)
            } else {
              pixelEdits = d.pixels
              if (d.placement.length > 0) {
                const r = await saveLogoTilemap(d.placement)
                if (r.ok) changed = true
                else errors.push(`title logo (DATA_title_screen_logo_tilemap): ${r.error}`)
              }
              if (d.skipped > 0) errors.push(`title logo: ${d.skipped} repositioned cell${d.skipped === 1 ? '' : 's'} skipped (non-editable / new tile — add new logo art via the faithful $1D sheet).`)
            }
          } else {
            // PNG: pixels only (a flat sheet carries no tilemap). Crop off the swatch column.
            pixelEdits = diffTitleLogoTiles(ctx, canvas, canvasRegion(decodePng(readFileSync(p)), canvas.width, canvas.height)).edits
          }
          if (pixelEdits.length > 0) {
            // The logo char is the lz2 $1D sheet (2bpp → 16-byte tiles).
            const filePatches: FilePatchMap = new Map()
            addTilePatches(filePatches, pixelEdits)
            applyTilePatches(filePatches, { manifest: ctx.manifest, scope: 'the title scene', tileBytesOf: (f) => f === 'lz16' ? 32 : 16, rom, symbols, savedFileTiles, errors })
            changed = true
          }
          if (changed) logoImported++; else logoSkipped++
        } catch (err) {
          errors.push(`${titleLogo.file}: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
    }
  }

  // Title-island (Mode-7) edits → file $B1's CPC char tiles (via saveGfxEdit). Each
  // island char is 32 CPC bytes (2 px/byte); a faithful diff re-packs the nibbles
  // into the full $B1 blob, which saveGfxEdit re-compresses (LZ2).
  let islandImported = 0, islandSkipped = 0, islandMissing = 0, islandSharedCells = 0, islandNewTiles = 0
  if (titleIsland) {
    const p = join(dir, titleIsland.file)
    if (!existsSync(p)) { islandMissing++ }
    else if (!titleIsland.faithful) { /* preview-only: skip silently */ }
    else {
      const ctx = buildTitleIslandContext(rom, symbols)
      const canvas = renderTitleIsland(ctx)
      if (!canvas.faithful) {
        errors.push(`${titleIsland.file}: title island no longer faithfully reconstructable`)
      } else {
        try {
          // Splice $B1 char-tile edits onto the cross-block cache, re-encode (LZ2).
          const writeIslandPixels = (edits: readonly { char: number; bytes: Uint8Array }[]): { ok: boolean; error?: string } => {
            const key = 'lz2/177' // $B1
            const prior = savedFileTiles.get(key)
            const b1 = prior ? prior.slice() : ctx.b1cpc.slice() // full decompressed $B1 (CPC)
            for (const ed of edits) b1.set(ed.bytes, ed.char * 32)
            const r = saveGfxEdit('lz2', 0xb1, b1)
            if (r.ok) savedFileTiles.set(key, b1.slice())
            return r
          }
          if (p.endsWith('.aseprite')) {
            // COMBINED import (assumes Manual Aseprite tileset mode): ONE .aseprite carries
            // pixel edits + cell repositions + newly-added tiles, applied together. Reads
            // the tileset/cells STRUCTURALLY (indices, not a flatten) so each kind of edit
            // is attributed by its stable tile index — placement → DATA_5F9800, pixels +
            // new tiles → $B1. New tiles allocate from the ~9 char slots free in BOTH island
            // worlds (writing a W6-used slot would corrupt the world-6 island). See
            // diffTitleIslandCombined for the Manual-mode assumption + safety rails.
            const d = diffTitleIslandCombined(ctx, decodeAsepriteStructural(readFileSync(p)))
            if (d.removedTiles) {
              errors.push(`title island: the tileset has fewer tiles than exported — tiles were deleted/reordered. Edit in Manual tileset mode (don't delete tiles) or re-export.`)
            } else {
              let ok = true
              if (d.pixels.length > 0) { const r = writeIslandPixels(d.pixels); if (!r.ok) { errors.push(`title island ($B1): ${r.error}`); ok = false } }
              if (ok && d.placement.length > 0) { const r = await saveIslandTilemap(d.placement); if (!r.ok) { errors.push(`title island (DATA_5F9800): ${r.error}`); ok = false } }
              if (d.unmappedTiles > 0) errors.push(`title island: ${d.unmappedTiles} new tile${d.unmappedTiles === 1 ? '' : 's'} couldn't be added — only ${ctx.addableChars.length} free $B1 char slot${ctx.addableChars.length === 1 ? '' : 's'} exist (the rest are used by the world-6 island).`)
              if (d.skippedW6Tiles > 0) errors.push(`title island: ${d.skippedW6Tiles} edit${d.skippedW6Tiles === 1 ? '' : 's'} to world-6-only tiles were skipped (they'd corrupt the world-6 island) — edit those via the faithful $B1 sheet.`)
              islandSharedCells = d.sharedCells
              islandNewTiles = d.newTiles
              if (ok && (d.pixels.length > 0 || d.placement.length > 0)) islandImported++
              else if (d.pixels.length === 0 && d.placement.length === 0) islandSkipped++
            }
          } else {
            // PNG: pixels only (a flat PNG carries no tilemap/placement). The PNG has a
            // swatch column, so crop to the canvas region, then slice back to $B1 chars.
            const edited = canvasRegion(decodePng(readFileSync(p)), canvas.width, canvas.height)
            const { edits, sharedCells } = diffTitleIslandTiles(ctx, canvas, edited)
            if (edits.length === 0) { islandSkipped++ }
            else {
              islandSharedCells = sharedCells
              const r = writeIslandPixels(edits)
              if (r.ok) islandImported++
              else errors.push(`title island ($B1): ${r.error}`)
            }
          }
        } catch (err) {
          errors.push(`${titleIsland.file}: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
    }
  }

  // Title-scenery edits → DATA_560000.bin (raw 4bpp low-nibble source) via
  // saveRawChrEdit. The GSU re-rasterizes the scenery from this each frame, so a
  // fixed-size in-place patch suffices (no layout move); high nibbles are preserved.
  let sceneryImported = 0, scenerySkipped = 0, sceneryMissing = 0
  if (titleScenery) {
    const p = join(dir, titleScenery.file)
    if (!existsSync(p)) { sceneryMissing++ }
    else {
      try {
        const ctx = buildTitleSceneryContext(rom, symbols)
        const canvas = renderTitleScenery(ctx)
        const edited = titleScenery.file.endsWith('.aseprite')
          ? decodeAsepriteImage(readFileSync(p)).rgba
          : canvasRegion(decodePng(readFileSync(p)), canvas.width, canvas.height)
        const { region, changed } = diffTitleScenery(ctx, edited)
        if (changed === 0) { scenerySkipped++ }
        else {
          const r = saveRawChrEdit([{ binFile: SCENERY_BIN_FILE, offset: 0, bytes: region }])
          if (r.ok) sceneryImported++
          else errors.push(`title scenery (DATA_560000.bin): ${r.error}`)
        }
      } catch (err) {
        errors.push(`${titleScenery.file}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  }

  // Dynamic-sprite glyph edits → the raw glyph .bin (via saveRawChrEdit). Only
  // byte-validated glyphs are editable; a shared source affects its other sprites.
  let glyphImported = 0, glyphSkipped = 0, glyphMissing = 0, glyphShared = 0
  if (glyphs && glyphs.sprites.length > 0) {
    const glyphWrites: { binFile: string; offset: number; bytes: Uint8Array }[] = []
    const affected = new Set<number>()
    for (const e of glyphs.sprites) {
      const p = join(dir, e.file)
      if (!existsSync(p)) { glyphMissing++; continue }
      try {
        const reg = canvasRegion(decodePng(readFileSync(p)), e.width, e.height)
        const res = glyphWritesForSprite(rom, symbols, glyphs.header, e.spriteNum, reg)
        if (!res) { errors.push(`${e.file}: sprite 0x${e.spriteNum.toString(16)} isn't an editable glyph`); continue }
        if (!res.changed) { glyphSkipped++; continue }
        glyphWrites.push(...res.writes)
        glyphImported++
        for (const sid of res.sharedWith) affected.add(sid)
      } catch (err) {
        errors.push(`${e.file}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    glyphShared = affected.size
    if (glyphWrites.length > 0) {
      const r = saveRawChrEdit(glyphWrites)
      if (!r.ok) { errors.push(`sprite glyphs: ${r.error}`); glyphImported = 0 }
    }
  }

  return {
    imported, skipped, missing,
    spriteImported, spriteSkipped, spriteMissing, spritePropagated,
    iconImported, iconSkipped, iconMissing,
    levelIconImported, levelIconSkipped, levelIconMissing,
    mapTerrainImported, mapTerrainSkipped, mapTerrainMissing,
    logoImported, logoSkipped, logoMissing,
    islandImported, islandSkipped, islandMissing, islandSharedCells, islandNewTiles,
    sceneryImported, scenerySkipped, sceneryMissing,
    glyphImported, glyphSkipped, glyphMissing, glyphShared,
    errors
  }
}
