// Graphics PNG/Aseprite EXPORT (the "Graphics" panel backend, export half). Renders
// the selected tracks to a folder + a manifest the import side (gfx-png-import.ts)
// reads back. Three tracks (research/graphics-editing/) — the first two are the two
// halves of the old single "screens" track:
//   - WORLDMAP: the overworld map's graphics (screens/map/) — the per-world map char
//     sheets + the world-map / level icons + the terrain / ground tilemaps.
//   - SYSTEMSCREENS: the boot / title / storybook screens' graphics
//     (screens/{boot,title,storybook}/) + the title logo / island / scenery + the
//     storybook first-scene layout.
//   - METASPRITES: the editable "meta" view of each sprite — its reconstructed
//     metasprite (the assembled character), under metasprite/ (+ the GSU-rasterized
//     sprites' glyphs under sprite-glyph/).

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  exportScreenGfxPngs,
  exportWorldMapIcons,
  buildTitleLogoContext,
  renderTitleLogo,
  titleLogoPng,
  titleLogoAseprite,
  buildTitleIslandContext,
  renderTitleIsland,
  titleIslandPng,
  titleIslandAseprite,
  islandTileChars,
  logoTileKeys,
  exportTitleScenery,
  exportStorybookScene
} from 'snes-framework/screen-gfx'
import { exportWorldMapLevelIcons } from 'snes-framework/world-map-level-icons'
import { exportWorldMapTerrain, exportWorldMapGround } from 'snes-framework/world-map-terrain'
import { exportWorldMapM1 } from 'snes-framework/world-map-m1te2'
import { exportScreenM1 } from 'snes-framework/screen-m1te2'
import { exportMetasprites } from 'snes-framework/sprite-metasprite'
import { exportSpriteGlyphs } from 'snes-framework/sprite-glyph'
import { decodeFontSheet, FONT_SHEETS } from 'snes-framework/msg-font'
import { imageAseprite } from 'snes-framework/gfx-aseprite'
import { encodePng } from 'snes-framework/png'
import type { RenderHeaderRequest, ExportGfxOptions, GfxExportTrack } from '../shared/ipc-types'
import { loadRomAndSymbols } from './render/rom-cache'
import { fileChecksum } from './gfx-import-conflict'
import { gfxLiveEdits } from './gfx-live-cache'
import {
  loadPaletteEdits,
  loadLogoTilemapEdits,
  loadIslandTilemapEdits,
  applyScreenPlacementOverlays,
  fontSheetBinFiles,
  readRawChrOverlayFirst,
  hasRawChrOverlays,
  applyRawChrOverlays
} from './resources'
import { PALETTE_BLOB_LABEL } from 'snes-framework/palette-edit'
import { type SymbolMap } from 'snes-framework/symbol-map'
import {
  MANIFEST,
  type GfxManifestChecksums,
  type GfxManifestEntry,
  type MetaspriteManifestEntry,
  type GlyphManifestEntry,
  type MapIconManifestEntry,
  type LevelIconManifestEntry,
  type MapTerrainManifestEntry,
  type MapGroundManifestEntry,
  type MapM1Manifest,
  type ScreenM1ManifestEntry,
  type TitleLogoManifestEntry,
  type TitleIslandManifestEntry,
  type TitleSceneryManifestEntry,
  type StorybookSceneManifestEntry,
  type FontSheetManifestEntry
} from './gfx-manifest'

const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

/**
 * The self-contained SUBFOLDER + the file-path prefix to STRIP for a single-track gfx
 * export. Each export type writes its own cleanly-named subfolder (under the user-picked
 * folder) with its own gfx-manifest.json, so the per-type manifests never collide (the old
 * single `screens` track wrote one manifest, so exporting two screen halves to the same dir
 * clobbered it) — and the picked folder stays a single export with one shared README at its
 * root. `exportGfxPngsToDir` writes into `<dir>/<folder>/` and strips `strip` from every file
 * path so the subfolder's internal layout is clean (`map/world-0/overworld.png`, not
 * `map/screens/map/world-0/overworld.png`). Returns null for a multi-track / full export —
 * that keeps the legacy flat layout (one manifest at the dir root, paths unchanged). The
 * panel only ever exports one track, so the subfolder path is the live one.
 */
export function gfxTrackFolder(opts: ExportGfxOptions): { folder: string; strip: string } | null {
  if (!opts.tracks || opts.tracks.length !== 1) return null
  const t = opts.tracks[0]
  if (t === 'worldmap') return { folder: 'map', strip: 'screens/map/' }
  if (t === 'systemscreens') return { folder: 'screens', strip: 'screens/' }
  if (t === 'metasprites') return { folder: 'metasprites', strip: '' }
  if (t === 'fonts') return { folder: 'fonts', strip: 'fonts/' }
  return null
}

/**
 * A copy of the built ROM with the project's UNBUILT overlay edits applied, so an export taken
 * before a rebuild reflects them (and a second export/import cycle doesn't revert them):
 *   • palette colors → the master palette blob, so every track's CGRAM (read from the blob via
 *     the palette program) reflects the edits, matching the import's `effectiveBlobWords`
 *     baseline (base ⊕ loadPaletteEdits).
 *   • title-screen PLACEMENT (logo Bank0F + island Bank57) → their tilemap tables, so the
 *     re-exported logo/island `.aseprite` shows moved/edited cells instead of the last-built
 *     tilemap. These are asm overlays that don't render live, so this is their ONLY preview
 *     path (there's no live canvas for the title screen); the import applies the SAME overlays
 *     to its diff baseline so the round-trip is symmetric.
 *   • raw-CHR SuperFX banks (`applyRawChrOverlays`) — the world-map level-select icons (bank $53),
 *     sprite glyph banks (bank $54/$55), and title scenery (bank $56) the dedicated exports read
 *     straight from the ROM, so a re-export reflects unbuilt raw-CHR edits + resets. The import
 *     splices the SAME banks into its diff baseline (gfx-png-import.ts), keeping the round-trip
 *     symmetric. (lz-gfx CHR/tilemaps preview via `gfxLiveEdits` in the context builders instead.)
 * All patches are idempotent vs a fresh build (the build applies the same edits) and offset-
 * exact. Returns the original ROM untouched when there are no edits (no copy).
 */
function romWithLiveOverlays(builtRom: Uint8Array, symbols: SymbolMap): Uint8Array {
  const paletteEdits = loadPaletteEdits()
  const hasPlacement = loadLogoTilemapEdits().length > 0 || loadIslandTilemapEdits().length > 0
  if (paletteEdits.length === 0 && !hasPlacement && !hasRawChrOverlays()) return builtRom // nothing live → no copy
  const rom = builtRom.slice()
  const blobPC = symbols.pc(PALETTE_BLOB_LABEL)
  for (const { offset, value } of paletteEdits) {
    rom[blobPC + offset] = value & 0xff
    rom[blobPC + offset + 1] = (value >> 8) & 0xff
  }
  applyScreenPlacementOverlays(rom, symbols)
  applyRawChrOverlays(rom)
  return rom
}

/** Write one exported artifact: the `join`+`mkdir`+`writeFileSync` kernel every track's
 *  write repeats. `file` is the manifest-relative path (already resolved to .png/.aseprite
 *  by the caller, whose useAse/filename logic varies per track). */
function writeArtifact(dir: string, file: string, bytes: Uint8Array): void {
  const full = join(dir, file)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, bytes)
}

/** Export the current level's gfx files to `dir` (PNGs in category folders + manifest).
 *  `spriteNames` (sprite id → friendly name) only NAMES the metasprite PNGs; it
 *  does not limit the set (every loadable cel-rendered sprite is exported). */
export function exportGfxPngsToDir(
  header: RenderHeaderRequest | null,
  dir: string,
  opts: ExportGfxOptions = {}
): { count: number } {
  const { rom: builtRom, symbols } = loadRomAndSymbols()
  // Live baseline: the export must reflect the SAME unbuilt edits the import diffs against, or
  // a second export/import cycle (before a rebuild) would revert prior edits. Colors: patch
  // the ROM's palette blob with the palette overlay (→ all CGRAM is base ⊕ edits). Title-screen
  // PLACEMENT (logo/island tilemaps): patched too, so a re-export of the logo/island .aseprite
  // shows unbuilt cell moves (their only preview path — asm overlays don't render live).
  // Pixels: every CHR/tilemap track gets the live gfx-cache as `gfxOverride` (→ VRAM is
  // base ⊕ edits, matching the import's `liveTiles`) — the screens + metasprite tracks, AND the
  // dedicated world-map (terrain/icons/ground/M1TE2) + title (logo/island/storybook) tracks,
  // which thread `gfxLiveEdits()` through their context builders on BOTH the export and import
  // side (so the round-trip stays symmetric). A per-file reset points the cache at base bytes,
  // so a reset reflects here too — not the last build. (Raw-`.bin` CHR — scenery, sprite glyphs,
  // per-level icons — is handled separately by the raw-overlay splice in `romWithLiveOverlays`.)
  const rom = romWithLiveOverlays(builtRom, symbols)
  // Limit to the selected track(s); no filter ⇒ both tracks.
  const want = (t: GfxExportTrack): boolean => !opts.tracks || opts.tracks.includes(t)
  // Level-DEPENDENT tracks (metasprites + glyphs) need the loaded level's header +
  // palette; the screens track (system screens, world-map + level icons, the per-world
  // maps, the ground) does NOT. So screens export even with no level loaded
  // (`header == null`), while the metasprites track is gated on a real header.
  const wantLevel = (t: GfxExportTrack): boolean => want(t) && header != null
  // `dir` is the user-picked export folder (one shared README at its root). A single-track
  // export nests its files + gfx-manifest in a self-contained, cleanly-named SUBFOLDER
  // `outDir` (see gfxTrackFolder), so multiple export types share the one folder without
  // their manifests colliding; `rebase` strips the track's path prefix so the subfolder's
  // internal layout is clean. A multi-track / full export writes flat into `dir` (legacy).
  const layout = gfxTrackFolder(opts)
  const outDir = layout ? join(dir, layout.folder) : dir
  const rebase = (f: string): string => (layout?.strip && f.startsWith(layout.strip) ? f.slice(layout.strip.length) : f)
  mkdirSync(outDir, { recursive: true })
  const manifest: GfxManifestEntry[] = []
  const used = new Set<string>()
  // Per-artifact sha256, keyed by the SAME manifest-relative path that lands in each entry's
  // `file` — the import checksum gate (gfx-import-reconcile.ts) looks edits up by that key, so
  // every export write goes through `emit` (= writeArtifact + record the hash). See req #2.
  const checksums: GfxManifestChecksums = {}
  const emit = (file: string, bytes: Uint8Array): void => {
    writeArtifact(outDir, file, bytes)
    checksums[file] = fileChecksum(bytes)
  }

  // `format: 'aseprite'` writes the assembled screens / metasprites as Aseprite
  // projects (the screens' title logo + island assemble as real tilemaps).
  const aseFmt = opts.format === 'aseprite'
  // `format: 'm1te2'` (World Map track only) writes the overworld + icons as M1TE2 `.M1`
  // sessions instead of the PNG/Aseprite map outputs (see the dedicated block below).
  const m1Fmt = opts.format === 'm1te2'

  // The "Screens" export is split into two tracks: `systemscreens` (boot / title /
  // storybook) and `worldmap` (the overworld map). Both emit char sheets through
  // exportScreenGfxPngs — its `groups` filter selects which (system sheets under
  // screens/{boot,title,storybook}/, map sheets under screens/map/) — plus their own
  // dedicated helpers below (title logo/island/scenery + storybook scene for system;
  // icons/terrain/ground for the map). They reuse the gfx-file manifest shape (single-row
  // swatch, no perTilePalette), so the import loop handles them with no extra code — a
  // screen file and a level file with the same id are the same compressed blob,
  // round-tripped via saveGfxEdit. `format:'aseprite'` writes the cropped boot-logo region
  // as a single-image `.aseprite`.
  const wantSystem = want('systemscreens')
  const wantWorldMap = want('worldmap')
  // The PNG/Aseprite map blocks (icons / terrain / ground) are skipped in M1TE2 mode — the
  // `.M1` files bundle every map tilemap + CHR + palette, so they fully replace them.
  const wantWorldMapPng = wantWorldMap && !m1Fmt
  // Likewise the system-screen PNG/Aseprite blocks are skipped in M1TE2 mode: only the
  // tilemap-based screens (logo / island / storybook scene) export as `.M1` (the non-tilemap
  // boot crop / scenery atlas / f88 sheet have no meaningful tilemap, so they're PNG/Aseprite).
  const wantSystemPng = wantSystem && !m1Fmt
  // The map's world-invariant char sheets (the old screens/map/common/ — f56/f74/f75)
  // are no longer exported: the terrain/icon Aseprite tilesets already carry the $74/$75
  // pixels, and the M1TE2 overworld .M1 bundles every map CHR ($74/$75/$4C + $56). So the
  // redundant raw sheets — and the common/ folder they lived in — are dropped; only the
  // SYSTEM screens (boot/title/storybook) still come through exportScreenGfxPngs.
  const screens = wantSystemPng
    ? exportScreenGfxPngs(rom, symbols, { aseprite: aseFmt, gfxOverride: gfxLiveEdits(), groups: { system: true, map: false } })
    : []
  for (const e of screens) {
    const useAse = aseFmt && e.aseprite
    const file = rebase(useAse ? e.file.replace(/\.png$/, '.aseprite') : e.file)
    used.add(file)
    emit(file, useAse ? e.aseprite! : e.png)
    manifest.push({
      file,
      description: e.description,
      format: e.format,
      fileId: e.fileId,
      bpp: e.bpp,
      sizeBytes: e.sizeBytes,
      rowCount: e.rowCount,
      index0Transparent: e.index0Transparent,
      region: e.region, // cropped screens (e.g. boot logo); undefined otherwise
      perTilePalette: e.perTilePalette, // flat-map BG (f74/f75) per-tile palette; undefined otherwise
      paletteOffsets: useAse ? e.paletteOffsets : undefined // region .aseprite color write-back map
    })
  }

  // Reconstructed metasprites (the editable "meta" view) — every cel-rendered
  // sprite loadable under this level's header. Faithful → editable (metasprite/);
  // the rest preview-only (metasprite/preview/). Edits route to the sprite sheets.
  // `format:'aseprite'` writes each faithful metasprite as a single-image `.aseprite`.
  const metas = wantLevel('metasprites') ? exportMetasprites(rom, symbols, header!, { gfxOverride: gfxLiveEdits(), aseprite: aseFmt }) : []
  const metaManifest: MetaspriteManifestEntry[] = []
  for (const m of metas) {
    const idHex = m.spriteId.toString(16).toUpperCase().padStart(3, '0')
    const nm = opts.spriteNames?.[m.spriteId]
    const useAse = aseFmt && m.aseprite
    const leaf = `${idHex}${nm ? '-' + slug(nm) : ''}.${useAse ? 'aseprite' : 'png'}`
    const file = m.faithful ? `metasprite/${leaf}` : `metasprite/preview/${leaf}`
    emit(file, useAse ? m.aseprite! : m.png)
    metaManifest.push({ file, spriteId: m.spriteId, faithful: m.faithful, hasDynamicBody: m.hasDynamicBody, width: m.width, height: m.height })
  }

  // Dynamic-sprite glyphs (the GSU-rasterized sprites' meta-equivalent) — the
  // byte-validated bank-$54 glyphs as editable PNGs; edits write back to the raw
  // glyph .bin via saveRawChrEdit (the raw-CHR write-back path). Global / level-invariant.
  const glyphs = wantLevel('metasprites') ? exportSpriteGlyphs(rom, symbols, header!) : []
  const glyphManifest: GlyphManifestEntry[] = []
  for (const gl of glyphs) {
    const idHex = gl.spriteNum.toString(16).toUpperCase().padStart(3, '0')
    const nm = opts.spriteNames?.[gl.spriteNum]
    const file = `sprite-glyph/${idHex}${nm ? '-' + slug(nm) : ''}.png`
    emit(file, gl.png)
    glyphManifest.push({ file, spriteNum: gl.spriteNum, width: gl.width, height: gl.height, sharedWith: gl.sharedWith })
  }

  // World-map level-slot icons (the editable "meta" view of the overworld's level
  // markers) — the normal marker + boss castle, per world in its tint. Faithful →
  // edits slice back to the shared $74/$75 BG tiles via saveGfxEdit. Level-invariant
  // (always exported). `format:'aseprite'` writes each icon as a single-image `.aseprite`.
  const mapIcons = wantWorldMapPng ? exportWorldMapIcons(rom, symbols, { aseprite: aseFmt, gfxOverride: gfxLiveEdits() }) : []
  const mapIconManifest: MapIconManifestEntry[] = []
  for (const ic of mapIcons) {
    const useAse = aseFmt && ic.aseprite
    const file = rebase(useAse ? ic.file.replace(/\.png$/, '.aseprite') : ic.file)
    emit(file, useAse ? ic.aseprite! : ic.png)
    mapIconManifest.push({ file, world: ic.world, name: ic.name, faithful: ic.faithful, width: ic.width, height: ic.height, paletteOffsets: useAse ? ic.paletteOffsets : undefined })
  }

  // Per-level ICONS (the unique overworld level-select pictures) — worlds 0-5, slots
  // L1-L8 + EXTRA + BONUS (10/world). Pixels are GSU-chunky in cart bank $53 (read via
  // the DATA_08DA2E descriptor; the cart DATA_17DBA3 plot-X picks the byte's low/high
  // nibble — two icons per byte). Edits slice back to the $53 .bin via saveRawChrEdit.
  // `format:'aseprite'` writes each level icon as a single-image `.aseprite`.
  const levelIcons = wantWorldMapPng ? exportWorldMapLevelIcons(rom, symbols, { aseprite: aseFmt }) : []
  const levelIconManifest: LevelIconManifestEntry[] = []
  for (const ic of levelIcons) {
    const useAse = aseFmt && ic.aseprite
    const file = rebase(`screens/map/world-${ic.world}/level-${ic.slot}-${slug(ic.name)}.${useAse ? 'aseprite' : 'png'}`)
    emit(file, useAse ? ic.aseprite! : ic.png)
    levelIconManifest.push({ file, world: ic.world, slot: ic.slot, name: ic.name, faithful: ic.faithful, width: ic.width, height: ic.height, paletteOffsets: useAse ? ic.paletteOffsets : undefined })
  }

  // Per-world OVERWORLD MAP (the terrain Yoshi paths across) — one entry per world. The
  // displayed map is a composite of BG1 (foreground: path/markers/fortress) ⊕ BG2
  // (background scenery) ⊕ BG3 ground. The PNG is the composited VIEW; the .aseprite
  // (Aseprite mode) is a 2-LAYER tilemap (BG1+BG2, one shared tileset), each layer
  // round-tripping to its $7C/$7D… LZ2 tilemap file via saveGfxEdit. (Map pixels edit via
  // the shared screens/map char sheets.)
  const mapTerrain = wantWorldMapPng ? exportWorldMapTerrain(rom, symbols, { aseprite: aseFmt, gfxOverride: gfxLiveEdits() }) : []
  const mapTerrainManifest: MapTerrainManifestEntry[] = []
  for (const m of mapTerrain) {
    const useAse = aseFmt && m.aseprite
    const file = rebase(useAse ? m.file.replace(/\.png$/, '.aseprite') : m.file)
    emit(file, useAse ? m.aseprite! : m.png)
    mapTerrainManifest.push({ file, world: m.world, bg1FileId: m.bg1FileId, bg2FileId: m.bg2FileId, width: m.width, height: m.height, tileKeys: m.tileKeys, paletteOffsets: useAse ? m.paletteOffsets : undefined })
  }

  // The decorative GROUND behind every map (BG3, world-invariant) — one shared editable
  // layout. PNG = view; .aseprite = the layout tilemap → round-trips to file $7E. Ground
  // pixels edit via the M1TE2 overworld .M1 (BG3 slot). Lives at the map folder root (the
  // common/ folder was removed); skipped in M1TE2 mode (ground is in the overworld .M1).
  let mapGroundManifest: MapGroundManifestEntry | null = null
  if (wantWorldMapPng) {
    const g = exportWorldMapGround(rom, symbols, { aseprite: aseFmt, gfxOverride: gfxLiveEdits() })
    const useAse = aseFmt && g.aseprite
    const file = rebase(useAse ? g.file.replace(/\.png$/, '.aseprite') : g.file)
    emit(file, useAse ? g.aseprite! : g.png)
    mapGroundManifest = { file, fileId: g.fileId, width: g.width, height: g.height, tileKeys: g.tileKeys, paletteOffsets: useAse ? g.paletteOffsets : undefined }
  }

  // World-map M1TE2 ".M1" sessions — when the World Map track is exported in M1TE2 format,
  // these REPLACE the PNG/Aseprite map outputs above (all skipped via wantWorldMapPng). Two
  // products: the overworld (one .M1 per world — the full 64×32 screen, BG1+BG2+BG3
  // composited) + the combined icons file (all per-level icons in level order + marker +
  // castle). Each .M1 bundles tilemap + CHR + palette, so there is no separate char sheet —
  // the import re-derives the scene/grid from the cart and routes edits to the right files
  // (world-map-m1te2.ts).
  let mapM1Manifest: MapM1Manifest | null = null
  if (wantWorldMap && m1Fmt) {
    const m1Files = exportWorldMapM1(rom, symbols, gfxLiveEdits())
    const overworlds: MapM1Manifest['overworlds'] = []
    let icons: MapM1Manifest['icons'] = null
    for (const m of m1Files) {
      const file = rebase(m.file)
      emit(file, m.bytes)
      if (m.kind === 'overworld') {
        overworlds.push({ file, world: m.world!, bg1FileId: m.bg1FileId!, bg2FileId: m.bg2FileId!, bg3FileId: m.bg3FileId! })
      } else icons = { file }
    }
    mapM1Manifest = { overworlds, icons }
  }

  // Title "Yoshi's Island" logo (the editable "meta" view of the Mode-0 BG logo) —
  // assembled from the $1D char tiles; faithful edits slice back via saveGfxEdit.
  // `format:'aseprite'` writes the assembled logo as a real Aseprite tilemap.
  let titleLogoManifest: TitleLogoManifestEntry | null = null
  if (wantSystemPng) {
    const ctx = buildTitleLogoContext(rom, symbols, gfxLiveEdits())
    const canvas = renderTitleLogo(ctx)
    const useAse = aseFmt && canvas.faithful
    const file = rebase(`screens/title/logo.${useAse ? 'aseprite' : 'png'}`)
    const logoKeys = useAse ? logoTileKeys(ctx) : undefined // serialized so the import reuses this tileset order
    const logoAse = logoKeys ? titleLogoAseprite(ctx, canvas, logoKeys) : undefined
    emit(file, logoAse ? logoAse.bytes : titleLogoPng(ctx, canvas))
    titleLogoManifest = { file, faithful: canvas.faithful, width: canvas.width, height: canvas.height, tileKeys: logoKeys, paletteOffsets: logoAse?.paletteOffsets }
  }

  // Title floating island (Mode-7) — assembled from file $B1 (CPC char) + the
  // DATA_5F9800 tilemap; faithful edits slice back to $B1 via saveGfxEdit.
  // `format:'aseprite'` writes the assembled island as a real Aseprite tilemap whose
  // import is COMBINED (pixels + placement + added tiles); a PNG is pixels-only.
  let titleIslandManifest: TitleIslandManifestEntry | null = null
  if (wantSystemPng) {
    const ctx = buildTitleIslandContext(rom, symbols, gfxLiveEdits())
    const canvas = renderTitleIsland(ctx)
    const useAse = aseFmt && canvas.faithful
    const file = rebase(`screens/title/island.${useAse ? 'aseprite' : 'png'}`)
    const tileChars = useAse ? islandTileChars(ctx) : undefined // serialized so the import reuses this tileset order
    const islandAse = tileChars ? titleIslandAseprite(ctx, canvas, tileChars) : undefined
    emit(file, islandAse ? islandAse.bytes : titleIslandPng(ctx, canvas))
    titleIslandManifest = { file, faithful: canvas.faithful, width: canvas.width, height: canvas.height, tileKeys: tileChars, paletteOffsets: islandAse?.paletteOffsets }
  }

  // Title island SCENERY — the GSU-billboarded 3D decorations (flags/mountains/
  // castles/trees) as a raw 4bpp atlas; edits slice back to DATA_560000.bin via
  // saveRawChrEdit (the GSU positions/rotates them, so this edits the art only).
  let titleSceneryManifest: TitleSceneryManifestEntry | null = null
  if (wantSystemPng) {
    const titleScenery = exportTitleScenery(rom, symbols, { aseprite: aseFmt })
    const useAse = aseFmt && titleScenery.aseprite
    const file = rebase(useAse ? titleScenery.file.replace(/\.png$/, '.aseprite') : titleScenery.file)
    emit(file, useAse ? titleScenery.aseprite! : titleScenery.png)
    titleSceneryManifest = { file, width: titleScenery.width, height: titleScenery.height, paletteOffsets: useAse ? titleScenery.paletteOffsets : undefined }
  }

  // Storybook first scene — the gm$05 cutscene's opening-page BG3 frame laid out as it
  // renders; faithful edits slice the frame tiles back to f27 via saveGfxEdit. The other
  // storybook sheets are narrowed out; only f88 (raw char sheet) + this scene view ship.
  let storybookSceneManifest: StorybookSceneManifestEntry | null = null
  if (wantSystemPng) {
    const scene = exportStorybookScene(rom, symbols, { aseprite: aseFmt, gfxOverride: gfxLiveEdits() })
    const useAse = aseFmt && scene.aseprite && scene.faithful
    const file = rebase(useAse ? scene.file.replace(/\.png$/, '.aseprite') : scene.file)
    emit(file, useAse ? scene.aseprite! : scene.png)
    storybookSceneManifest = { file, faithful: scene.faithful, width: scene.width, height: scene.height, paletteOffsets: useAse ? scene.paletteOffsets : undefined }
  }

  // Bank09 1bpp graphics (message font + message-box pictures) — raw, fixed-address
  // CHR read overlay-first (so a re-export reflects unbuilt edits) and decoded to a
  // 2-color cell grid. Edits re-encode to 1bpp + slice back to the raw `.bin` via
  // saveRawChrEdit. Level-independent (cart-static), like the screen tracks.
  // `format:'aseprite'` writes the SAME 2-color image as a single-image `.aseprite`
  // (index 0 = off/black, index 1 = on/white) — these blobs aren't an 8×8 CHR tilemap
  // (the font is 8×12 unique glyphs; the pictures are a flat bitmap), so there's no
  // tileset, just the flat 2-color image. The palette is opaque so the round-trip is
  // byte-exact; the import keys "is the pixel white", so erasing to transparent in
  // Aseprite still reads as off. Import handles it unchanged (decodeEditedToRgba 'image').
  const fontManifest: FontSheetManifestEntry[] = []
  if (want('fonts')) {
    for (const { key, binFile } of fontSheetBinFiles()) {
      const spec = FONT_SHEETS.find((s) => s.key === key)
      if (!spec) continue
      const img = decodeFontSheet(readRawChrOverlayFirst(binFile), spec.glyphW, spec.glyphH, spec.cols)
      const file = rebase(`fonts/${key}.${aseFmt ? 'aseprite' : 'png'}`)
      const bytes = aseFmt
        ? imageAseprite({ rgba: img.rgba, width: img.width, height: img.height, palette: Uint32Array.of(0xff000000, 0xffffffff), index0Transparent: false, layerName: key })
        : encodePng(img)
      emit(file, bytes)
      fontManifest.push({
        file,
        binFile,
        glyphW: spec.glyphW,
        glyphH: spec.glyphH,
        cols: spec.cols,
        width: img.width,
        height: img.height
      })
    }
  }

  // System-screen M1TE2 ".M1" sessions — when the Boot/Story/Title track is exported in M1TE2
  // format, the tilemap-based screens (title island + storybook first scene) export as `.M1`
  // instead of the PNG/Aseprite outputs above (all skipped via wantSystemPng). The non-tilemap
  // screens (boot crop / scenery atlas / f88 sheet) have no meaningful tilemap, and the title
  // logo (Mode-0 BG2) renders with the wrong palette base in M1TE — so none are in the M1TE2
  // set; they stay PNG/Aseprite. Each `.M1` bundles tilemap + CHR + palette (screen-m1te2.ts).
  const screenM1Manifest: ScreenM1ManifestEntry[] = []
  if (wantSystem && m1Fmt) {
    for (const s of exportScreenM1(rom, symbols)) {
      const file = rebase(s.file)
      emit(file, s.bytes)
      screenM1Manifest.push({ file, kind: s.kind })
    }
  }

  writeFileSync(
    join(outDir, MANIFEST),
    JSON.stringify(
      {
        checksums,
        entries: manifest,
        metasprites: { header, sprites: metaManifest },
        glyphs: { header, sprites: glyphManifest },
        mapIcons: mapIconManifest,
        levelIcons: levelIconManifest,
        mapTerrain: mapTerrainManifest,
        mapGround: mapGroundManifest,
        mapM1: mapM1Manifest,
        screenM1: screenM1Manifest.length > 0 ? screenM1Manifest : null,
        titleLogo: titleLogoManifest,
        titleIsland: titleIslandManifest,
        titleScenery: titleSceneryManifest,
        storybookScene: storybookSceneManifest,
        fonts: fontManifest.length > 0 ? fontManifest : null
      },
      null,
      2
    )
  )
  // One shared README at the picked-folder root (each export type's files live in its own
  // subfolder under it). Written generically so re-exporting a second type leaves it correct.
  writeFileSync(join(dir, 'README.txt'), readmeText())
  return {
    count:
      screens.length + metas.length + glyphs.length +
      mapIcons.length + levelIcons.length + mapTerrain.length +
      (mapGroundManifest ? 1 : 0) + (titleLogoManifest ? 1 : 0) + (titleIslandManifest ? 1 : 0) + (titleSceneryManifest ? 1 : 0) +
      (storybookSceneManifest ? 1 : 0) +
      fontManifest.length +
      (mapM1Manifest ? mapM1Manifest.overworlds.length + (mapM1Manifest.icons ? 1 : 0) : 0) +
      screenM1Manifest.length
  }
}

/** Human guide dropped at the picked-folder root — the one user-facing README for the extract
 *  folder. Covers only the dropdown extract types; written generically (re-extracting a second
 *  type overwrites it with the same text). Keep it minimal + user-facing — don't document the
 *  import mechanism here unless it's a gotcha the user needs (e.g. shared-tile spread). */
function readmeText(): string {
  return [
    'Shiny Egg — extracted graphics',
    '==============================',
    '',
    'Edit these files in any image editor (PNG), in Aseprite, or — for an .M1 session —',
    'in M1TE (open it from the app\'s extracted-folders list), then re-import this folder.',
    'Only the files you actually change are saved.',
    '',
    'What you can edit',
    '-----------------',
    'Pixels   The tile art. Tiles are often reused, so editing one pixel changes that',
    '         tile everywhere it appears.',
    'Palette  The colors themselves — Aseprite extracts only. A PNG includes a color',
    '         swatch to paint FROM, but editing the swatch doesn\'t change the palette.',
    'Layout   Which tile sits in each cell (rearranging the picture) — Aseprite extracts',
    '         only, and only where noted below.',
    '',
    'Extracts',
    '--------',
    'BG1 area / BG2 / BG3      Pixels, Palette.',
    '    A level\'s background tiles.',
    '',
    'World Map                 Pixels, Palette, Layout.',
    '    Layout covers the overworld terrain and ground; the level markers, select',
    '    pictures and shared map tiles are pixels only. The map is shown in one world\'s',
    '    colors (the game recolors the same tiles per world).',
    '',
    'Boot/Story/Title          Pixels, Palette, Layout.',
    '    Layout covers the title logo and floating island; the boot logo, title scenery',
    '    and storybook are pixels only. These screens animate their colors in-game, so',
    '    the extracted picture shows just one frame.',
    '',
    'Message Font / Pictures   Pixels (PNG or Aseprite).',
    '    The 1bpp message font glyphs + message-box pictures, as a 2-color image (index 0',
    '    = off, index 1 = on). Paint white/opaque pixels to turn them on, erase',
    '    (transparent) or paint black to turn them off.',
    '',
    'Re-import this folder to apply your edits.',
    ''
  ].join('\n')
}
