// Graphics PNG/Aseprite IMPORT (the "Graphics" panel backend, import half). Reads
// the manifest (gfx-manifest.ts) + edited PNGs/Aseprite a gfx-png-export.ts run
// wrote, converts each back to SNES tile bytes, and saves ONLY the files whose
// pixels actually changed (vs the base blob) via saveGfxEdit — so unedited files
// keep the build byte-identical and the reinsert pipeline only moves what changed.
// Mirrors gfx-png-export.ts's two tracks (SCREENS char sheets + tilemaps,
// METASPRITES + glyphs); see research/graphics-editing/.
//
// ── Editing axes per track ──────────────────────────────────────────────────
// Every track edits tile PIXELS; a track also edits tile PLACEMENT (which tile sits in
// each cell) only when it has a STATIC, editable tilemap to round-trip to. "Combined"
// tracks carry both axes in ONE .aseprite (a tilemap layer + its shared tileset).
//
//   Track                 Pixels  Placement  Why placement is/ isn't supported
//   gfx-file sheet          ✓        —        faithful sheet: tile N is locked to cell N (reorder = corrupt refs)
//   metasprite              ✓        —        flat OBJ assembly; placement = the cel-table rewrite (a separate track)
//   world-map icon (slot)   ✓        —        tiny 3×3 marker/castle; arrangement is cart word-tables (out of scope)
//   level icon              ✓        —        GSU-chunky 1B/px bank-$53 source; no tilemap
//   title scenery           ✓        —        GSU-rasterized billboard atlas; no tilemap
//   storybook scene         ✓        —        BG3 tilemap is runtime-streamed (no static cart target)
//   BG1 region              ✓        —        playable BG1 has no static tilemap (placement = the level editor)
//   BG2/BG3 region          ✓        —        no static tilemap in the pixel file; placement is a SEPARATE
//                                             16×16 layout .aseprite (bg-region.ts; WIP, no UI yet)
//   world-map terrain       ✓        ✓        COMBINED: BG1+BG2 tilemap layers + shared tileset → $7C/$7D + $74/$75
//   world-map ground        ✓        ✓        COMBINED: BG3 $7E tilemap + $56 char
//   title logo              ✓        ✓        COMBINED: Mode-0 BG2 tilemap + $1D char
//   title island            ✓        ✓        COMBINED: Mode-7 tilemap + $B1 CPC char (+ new-char alloc)
//
// ── Pipeline shape (shared steps factored; genuine differences kept per-track) ──
// • Every per-file loop opens with the CHECKSUM GATE (`gate(e.file)` → changedSinceExport):
//   an artifact still matching its export-time sha256 is skipped (the user didn't touch it),
//   so a stale/unedited file can't revert a newer edit on re-import (the anti-thrash fix).
// • decodeEditedToRgba (gfx-import-utils.ts): the one ".aseprite image/region OR .png" decode
//   gate, used by every assembled-view importer.
// • runAssembledTrack + makeCtxCache (below): the assembled-pixel loop skeleton
//   (gate → render → decode → diff → record) shared by metasprite / world-map icon / level icon.
// • A changed file RECORDS its CHR-tile / palette-color / raw-CHR edits into the shared
//   `GfxImportReconciler` (passed in) — tagged by source file — which merges across tracks AND
//   the BG-region importer, conflict-checks (two files disagree on one tile/color → skip + log),
//   and writes ONCE in graphics-folder-io. Single-owner PLACEMENT (per-world/layer tilemap
//   words, logo/island asm overlays) is written DIRECTLY here (can't cross-file-conflict).
// The COMBINED tracks (terrain/ground/logo/island) keep per-track loops: their placement save
// TARGET genuinely differs (LZ2 tilemap vs the async asm-overlay saveLogoTilemap/saveIslandTilemap)
// and island adds new-char allocation, so a single driver would obscure more than it merges.
//
// • `tileKeys` convention: every COMBINED track's manifest entry carries a per-tileset-tile
//   key list (the file's own tileset order) so the import maps each tile/cell back to its cart
//   source WITHOUT re-deriving it from the (possibly-drifted) cart — the .aseprite + manifest
//   are self-describing. The key is the track's packed source: terrain = the 14-bit
//   (char,pal,prio) word-key (multi-palette), island = the $B1 char, ground/logo =
//   (char<<3)|palRow (1:1 char→palette). Each falls back to re-deriving only for an older
//   export that predates the field.

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
  logoTileKeys,
  buildTitleIslandContext,
  renderTitleIsland,
  diffTitleIslandTiles,
  diffTitleIslandCombined,
  islandTileChars,
  buildTitleSceneryContext,
  renderTitleScenery,
  diffTitleScenery,
  SCENERY_BIN_FILE,
  buildStorybookSceneContext,
  renderStorybookScene,
  diffStorybookSceneTiles,
  buildBonusSceneContext
} from 'snes-framework/screen-gfx'
import {
  buildLevelIconContext,
  renderWorldMapLevelIcon,
  sliceLevelIconWrites
} from 'snes-framework/world-map-level-icons'
import {
  buildWorldMapTerrainContext,
  diffWorldMapTerrainPlacement,
  diffWorldMapTerrainPixels,
  unifiedTerrainKeys,
  buildWorldMapGroundContext,
  diffWorldMapGroundPlacement,
  groundTileKeys
} from 'snes-framework/world-map-terrain'
import {
  diffOverworldM1,
  diffIconsM1,
  overworldTilemapBase
} from 'snes-framework/world-map-m1te2'
import {
  diffTitleIslandM1,
  diffStorybookSceneM1,
  diffBonusM1,
  diffBonusBackdropM1,
  type ScreenPaletteEdit
} from 'snes-framework/screen-m1te2'
import {
  buildMetaspriteContext,
  renderMetasprite,
  diffMetaspriteTiles,
  type MetaspriteHeader,
  type MetaspriteCanvas
} from 'snes-framework/sprite-metasprite'
import { glyphWritesForSprite } from 'snes-framework/sprite-glyph'
import { encodeFontSheet } from 'snes-framework/msg-font'
import { app } from 'electron'
import { decodePng } from 'snes-framework/png'
import { canvasRegion, decodeEditedToRgba, decodeGfxFile, liveTiles } from './gfx-import-utils'
import { changedSinceExport, type GfxImportReconciler } from './gfx-import-reconcile'
import { imageToGfx, lz16Layout, lz2Layout } from 'snes-framework/gfx-png'
import { diffGfxFileAseprite, diffAsepritePalette } from 'snes-framework/gfx-aseprite'
import { basePaletteWords, PALETTE_BLOB_BANK_FILE } from 'snes-framework/palette-edit'
import { decodeAsepriteRegion, decodeAsepriteStructural, decodeAsepriteMultiStructural, decodeAsepriteImage, type AsepriteCell } from 'snes-framework/aseprite'
import { type SymbolMap } from 'snes-framework/symbol-map'
import type { GfxFileEntry } from 'snes-framework/load-graphics'
import type { RenderHeaderRequest } from '../shared/ipc-types'
import { loadRomAndSymbols } from './render/rom-cache'
import { resourcePaletteToBase, applyPaletteEdits } from './render/render-core'
import { gfxLiveEdits } from './gfx-live-cache'
import { saveGfxEdit, saveIslandTilemap, saveLogoTilemap, loadPaletteEdits, loadLogoTilemapEdits, loadIslandTilemapEdits, applyScreenPlacementOverlays, applyRawChrOverlays, readRawChrBase } from './resources'
import { frameworkWorkRoot } from './framework-paths'
import { buildRaphaelArenaContext, raphaelTileKeys, diffRaphaelArenaPlacement } from 'snes-framework/screen-raphael'
import {
  MANIFEST,
  isNewerAppVersion,
  newerExportWarning,
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
  type BossArenaManifestEntry,
  type TitleLogoManifestEntry,
  type TitleIslandManifestEntry,
  type TitleSceneryManifestEntry,
  type StorybookSceneManifestEntry,
  type FontSheetManifestEntry,
  type YychrManifestEntry
} from './gfx-manifest'
import { importYychrEntries } from './gfx-yychr-io'

const eq = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((v, i) => v === b[i])

/** A tilemap-screen import warning for cells erased to Aseprite's empty tile 0 — they resolve
 *  to the screen's backdrop (cell 0's word), which may not be what the artist intended. The
 *  blank-tile editing convention is shared by every screen, so the message is one place. */
const erasedCellsWarning = (label: string, n: number): string =>
  `${label}: ${n} erased cell${n === 1 ? '' : 's'} set to the backdrop tile — this may look unexpected in-game; to blank a cell, paint the backdrop tile instead.`

/** Decompress a gfx file's base blob to tile bytes — the live-preview base imageToGfx slices
 *  against for index fidelity (NOT the change gate; the checksum decides change). */
const decodeBase = (rom: Uint8Array, symbols: SymbolMap, e: GfxManifestEntry): Uint8Array =>
  liveTiles(e.format, e.fileId) ?? decodeGfxFile(rom, symbols, e.format, e.fileId, e.sizeBytes, e.rowCount)

// CHR tiles / palette colors / raw-CHR all flow into the shared `GfxImportReconciler` (passed
// in), which merges them across this importer AND bg-region-io.ts, conflict-checks, and writes
// once — replacing the old per-importer FilePatchMap/savedFileTiles last-write-wins accumulation.

/** A per-world context cache: `build(world)` is run once per world, memoized. Shared by
 *  the assembled per-world tracks (world-map icons, level icons) so each resolves its
 *  scene/decode context lazily without rebuilding it per entry. */
function makeCtxCache<C>(build: (world: number) => C): { get: (world: number) => C; first: () => C | undefined } {
  const m = new Map<number, C>()
  return {
    get: (w) => { const c = m.get(w); if (c !== undefined) return c; const n = build(w); m.set(w, n); return n },
    first: () => m.values().next().value as C | undefined
  }
}

/**
 * The shared loop for an "assembled-view" pixel track (metasprite / world-map icon / level
 * icon): per entry — skip non-faithful, apply the CHECKSUM GATE (`args.gate` → skip files
 * unedited since export), resolve a context (`ctxOf`), re-render the assembled canvas
 * (`render`; must still be faithfully reconstructable), flatten the edited file to RGBA (the
 * shared `decodeEditedToRgba`, single-image mode), then hand `(ctx, canvas, edited)` to `apply`
 * — which owns the bespoke diff + RECORDS the edits into the shared reconciler, returning
 * `'imported'` (edits found), `'skipped'` (unchanged), or `'error'` (apply already pushed its
 * own error; count nothing). A throw becomes an error entry.
 */
function runAssembledTrack<E extends { file: string; faithful?: boolean }, C, K extends { width: number; height: number; faithful?: boolean }>(args: {
  entries: readonly E[]
  dir: string
  /** The checksum gate — `'unchanged'` files (still matching their export hash) are skipped. */
  gate: (relFile: string) => 'missing' | 'unchanged' | 'changed'
  ctxOf: (e: E) => C
  render: (ctx: C, e: E) => K | null
  notReconstructable: (e: E) => string
  apply: (ctx: C, canvas: K, edited: Uint8Array, e: E) => 'imported' | 'skipped' | 'error'
  errors: string[]
  count: { imported: () => void; skipped: () => void; missing: () => void }
}): void {
  for (const e of args.entries) {
    if (!e.faithful) continue
    const g = args.gate(e.file)
    if (g === 'missing') { args.count.missing(); continue }
    if (g === 'unchanged') { args.count.skipped(); continue } // unedited since export → skip
    const p = join(args.dir, e.file)
    const ctx = args.ctxOf(e)
    const canvas = args.render(ctx, e)
    if (!canvas || !canvas.faithful) { args.errors.push(args.notReconstructable(e)); continue }
    try {
      const edited = decodeEditedToRgba(p, 'image', canvas.width, canvas.height)
      const r = args.apply(ctx, canvas, edited, e)
      if (r === 'imported') args.count.imported()
      else if (r === 'skipped') args.count.skipped()
      // 'error' → apply already reported; count nothing.
    } catch (err) {
      args.errors.push(`${e.file}: ${err instanceof Error ? err.message : String(err)}`)
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
  /** Storybook first-scene edits routed to the f27 BG3 char tiles (via saveGfxEdit). */
  sceneImported: number
  sceneSkipped: number
  sceneMissing: number
  /** Bonus-game screen `.M1` edits (gm$2A) — CHR via the reconciler; BG1/BG2 +
   *  shared-BG3 tilemap words merged across games → saveGfxEdit. */
  bonusImported: number
  bonusSkipped: number
  bonusMissing: number
  /** Raphael-arena LAYOUT edits (the Bosses track) routed to the $BD byte-cell
   *  Mode-7 tilemap (via saveGfxEdit). */
  bossImported: number
  bossSkipped: number
  bossMissing: number
  /** Dynamic-sprite glyph edits routed to the raw glyph `.bin` (via saveRawChrEdit). */
  glyphImported: number
  glyphSkipped: number
  glyphMissing: number
  /** Distinct OTHER sprites affected by a shared-glyph edit. */
  glyphShared: number
  /** Bank09 1bpp sheet edits (message font / message-box pictures) routed to the raw
   *  `.bin` (via saveRawChrEdit). */
  fontImported: number
  fontSkipped: number
  fontMissing: number
  /** YY-CHR raw sheets (gfx-yychr-io.ts) — compressed CHR via saveGfxEdit, raw `.bin`
   *  byte-runs via saveRawChrEdit. `yychrPadEdited` = sheets where the user painted
   *  into the bank padding past the true end (those bytes are dropped, warned). */
  yychrImported: number
  yychrSkipped: number
  yychrMissing: number
  yychrPadEdited: number
  /** Screen-palette color edits written back to the master palette blob (Bank57 overlay)
   *  across all screen `.aseprite` tracks — the color analog of the tile-layout imports. */
  paletteImported: number
  errors: string[]
  /** Advisory notices (shown amber): the newer-shiny-egg export stamp, and PNG pixels
   *  painted with a color outside the swatch (flattened to color 0). */
  warnings: string[]
}

/**
 * Import edited PNGs from `dir`: for each gfx-file manifest entry (screen char
 * sheets) whose PNG is present and whose pixels differ from the base blob,
 * re-encode and saveGfxEdit; for each edited faithful metasprite, slice the edit
 * back to the sprite sheets and saveGfxEdit (merging with any raw-sheet edit).
 * Reports per-kind changed/unchanged/missing counts, errors, and how many other
 * sprites a shared-tile edit propagated to.
 */
/** The "Changed graphics" role label for a faithful gfx PNG, from its category subfolder — the
 *  export's OWN classification (bg1-tileset/bg2/bg3/sprites/hud). Stamps a role for files level
 *  data can't classify (HUD sheets, global sprites), so they don't read "couldn't determine".
 *  Returns undefined for an unrecognized category (gfxFileRole then covers level-loaded files). */
function faithfulGfxRole(relFile: string): string | undefined {
  switch (relFile.split(/[\\/]/)[0]) {
    case 'bg1-tileset': return 'BG1 tileset'
    case 'bg2': return 'BG2 background'
    case 'bg3': return 'BG3 background'
    case 'sprites': return 'Sprite sheet'
    case 'hud': return 'HUD / font / status'
    default: return undefined
  }
}

export async function importGfxPngsFromDir(
  dir: string,
  reconciler: GfxImportReconciler,
  opts: {
    /** Limit the import to these manifest-relative files — everything else gates as
     *  'unchanged' (skipped). The M1TE-Maps tab's per-file import. */
    only?: ReadonlySet<string>
  } = {}
): Promise<ImportGfxResult> {
  const manifestPath = join(dir, MANIFEST)
  if (!existsSync(manifestPath)) {
    throw new Error(`No ${MANIFEST} in the selected folder — pick a folder you exported to.`)
  }
  const { exportedBy, checksums, entries, metasprites, glyphs, mapIcons, levelIcons, mapTerrain, mapGround, bossArena, mapM1, screenM1, titleLogo, titleIsland, titleScenery, storybookScene, fonts, yychr } = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    exportedBy?: string
    checksums?: GfxManifestChecksums
    entries: GfxManifestEntry[]
    metasprites?: { header: RenderHeaderRequest; sprites: MetaspriteManifestEntry[] }
    glyphs?: { header: RenderHeaderRequest; sprites: GlyphManifestEntry[] }
    mapIcons?: MapIconManifestEntry[]
    levelIcons?: LevelIconManifestEntry[]
    mapTerrain?: MapTerrainManifestEntry[]
    mapGround?: MapGroundManifestEntry
    bossArena?: BossArenaManifestEntry | null
    mapM1?: MapM1Manifest | null
    screenM1?: ScreenM1ManifestEntry[] | null
    titleLogo?: TitleLogoManifestEntry
    titleIsland?: TitleIslandManifestEntry
    titleScenery?: TitleSceneryManifestEntry
    storybookScene?: StorybookSceneManifestEntry
    fonts?: FontSheetManifestEntry[] | null
    yychr?: YychrManifestEntry[] | null
  }
  const { rom: builtRom, symbols } = loadRomAndSymbols()
  // Title-screen PLACEMENT baseline (logo/island): apply the existing tilemap overlays to a COPY
  // of the built ROM, so the logo/island placement diffs run against base ⊕ overlay (matching
  // what the live export showed) and return only NEW cell moves — which the full-set merge at
  // each save site folds back onto the existing overlay (the screen-placement twin of the
  // palette `effectiveBlobWords` baseline). Build-state-independent: the overlay is full-set-
  // vs-base, so this is idempotent whether or not a build already baked it. Other tracks don't
  // read these tiny tilemap regions, so they see the built ROM unchanged. (NEVER mutate the
  // cached ROM in place — `applyScreenPlacementOverlays` works on the copy.)
  // Raw-CHR diff baseline: also splice the raw SuperFX overlay banks (level-select icons $53,
  // glyph banks $54/$55, scenery $56) into the copy, so the level-icon / glyph / scenery diffs run
  // against base ⊕ raw edits — matching what the live export (`romWithLiveOverlays`) showed — and
  // return only NEW pixels (a reset reverts to base on both sides). Same idempotent, build-state-
  // independent shape as the placement baseline above.
  let rom = builtRom
  {
    const copy = builtRom.slice()
    const placed = applyScreenPlacementOverlays(copy, symbols)
    const raw = applyRawChrOverlays(copy)
    if (placed || raw) rom = copy
  }
  let imported = 0, skipped = 0, missing = 0
  let paletteImported = 0
  const errors: string[] = []
  const warnings: string[] = []
  // Version stamp: warn when the folder was exported by a NEWER shiny-egg — sections this
  // version doesn't know are silently ignored by the tolerant parse above, so say why.
  if (isNewerAppVersion(exportedBy, app.getVersion())) {
    warnings.push(newerExportWarning('This export folder', exportedBy!, app.getVersion()))
  }
  /** Off-palette paint advisory (imageToGfx stats): the paint reached the ROM as color 0. */
  const offPaletteWarning = (file: string, n: number): string =>
    `${file}: ${n} pixel${n === 1 ? '' : 's'} used a color not in the palette swatch — flattened to color 0 (anti-aliasing or off-palette paint?).`
  // The CHECKSUM GATE (gfx-import-reconcile.ts): an artifact whose bytes still match its
  // export-time sha256 is skipped — the user didn't touch it, so it contributes nothing and
  // can't revert a newer edit (the anti-thrash fix). A pre-checksum export (no `checksums`)
  // imports unconditionally, as before.
  const gate = (relFile: string): 'missing' | 'unchanged' | 'changed' => {
    if (opts.only && !opts.only.has(relFile)) return 'unchanged' // outside the requested set
    return changedSinceExport(dir, relFile, checksums?.[relFile])
  }
  // Fold a placement DELTA (cells changed vs base ⊕ overlay) into the existing FULL-SET overlay
  // → the new full set for saveLogoTilemap/saveIslandTilemap (which write base ⊕ set). Screen
  // placement is single-owner (only the logo/island track writes its tilemap), so it stays a
  // direct save here rather than going through the cross-file reconciler.
  const mergePlacement = <T extends { offset: number; value: number }>(existing: readonly T[], delta: readonly T[]): { offset: number; value: number }[] => {
    const m = new Map<number, number>(existing.map((e) => [e.offset, e.value]))
    for (const e of delta) m.set(e.offset, e.value)
    return [...m].map(([offset, value]) => ({ offset, value }))
  }
  // Palette-color comparison baseline: the EFFECTIVE current blob (base ⊕ the panel's existing
  // palette edits). diffAsepritePalette reports only entries the imported palette CHANGED vs
  // this, and each goes to the shared reconciler (which merges + conflict-checks across files).
  let _effectiveBlobWords: Map<number, number> | null = null
  const effectiveBlobWords = (): Map<number, number> => {
    if (_effectiveBlobWords) return _effectiveBlobWords
    const baseText = readFileSync(join(frameworkWorkRoot(), PALETTE_BLOB_BANK_FILE), 'utf8')
    const w = basePaletteWords(baseText)
    for (const ed of loadPaletteEdits()) w.set(ed.offset, ed.value) // base ⊕ existing edits
    _effectiveBlobWords = w
    return w
  }
  // The M1TE2 SCENE tracks (overworld / title island / storybook) diff the imported .M1's
  // palette against the scene context's CGRAM (`diffM1tePalette`), which the context builders
  // populate from the ROM. That baseline lacks the current palette draft, so an edit that RESETS
  // a previously-changed color to its vanilla value reads as "no change" and the stale override
  // survives (the diff-vs-base trap: changing to a non-base color always differs and imports, but
  // reverting to base doesn't). Re-source the scene's master-blob-backed slots from the PRISTINE
  // base blob then overlay the draft, so the diff runs against base ⊕ edits — exactly what the
  // export (`romWithLiveOverlays`) showed, making the round-trip idempotent. This is the scene
  // twin of the level path's `applyLivePreviewPalette` and the Aseprite `effectiveBlobWords`
  // baseline above; the scene cgram + provenance are already populated, so no reload is needed.
  const foldLivePaletteIntoScene = (cgram: Uint8Array, provenance: Int32Array): void => {
    resourcePaletteToBase(cgram, provenance, frameworkWorkRoot())
    applyPaletteEdits(cgram, provenance, loadPaletteEdits())
  }
  // Image-track (imageAseprite) palette write-back: diff each entry's embedded palette
  // (`.aseprite` only) against the current blob → the reconciler. Runs separately from the
  // pixel driver (which only hands `apply` the flattened RGBA, not the palette). Gated by
  // checksum so an untouched export contributes nothing.
  const accumImagePalette = (pentries: readonly { file: string; paletteOffsets?: number[] }[]): void => {
    for (const e of pentries) {
      if (!e.paletteOffsets || !e.file.endsWith('.aseprite') || gate(e.file) !== 'changed') continue
      try {
        const asePal = decodeAsepriteImage(readFileSync(join(dir, e.file))).palette
        for (const ed of diffAsepritePalette(asePal, e.paletteOffsets, effectiveBlobWords())) { reconciler.paletteWord(ed.offset, ed.value, e.file); paletteImported++ }
      } catch { /* the pixel driver already reports unreadable files */ }
    }
  }
  accumImagePalette(entries) // COLORS: region-crop (boot logo) embedded palette → master blob
  for (const e of entries) {
    const gv = gate(e.file)
    if (gv === 'missing') { missing++; continue }
    if (gv === 'unchanged') { skipped++; continue }
    const p = join(dir, e.file)
    try {
      // Base-aware: unedited pixels keep their original index, so an untouched
      // file round-trips byte-exact (even with duplicate palette colors).
      const base = decodeBase(rom, symbols, e)
      // Whole-file authoritative: a CHANGED sheet records its ENTIRE decompressed blob as
      // per-tile edits into the shared reconciler (which re-encodes + saves once, conflict-
      // checking shared tiles vs every other track). Replaces the old direct saveGfxEdit +
      // savedFileTiles last-write-wins.
      const recordSheet = (full: Uint8Array): void => {
        reconciler.registerManifest([{ format: e.format, fileId: e.fileId, sizeBytes: e.sizeBytes }])
        reconciler.recordWholeBlob(e.format, e.fileId, full, e.bpp === 4 ? 32 : 16, e.file, faithfulGfxRole(e.file))
        imported++
      }
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
          const stats = { offPalette: 0 }
          editedRegion = imageToGfx(img, { tilesWide: w, tilesTall: h, bpp: e.bpp }, { base: baseRegion, index0Transparent: e.index0Transparent, stats })
          // Warn BEFORE the unchanged gate: off-palette paint over an index-0 pixel flattens
          // back to 0 (byte-identical → skipped), which is exactly the silently-dropped case.
          if (stats.offPalette > 0) warnings.push(offPaletteWarning(e.file, stats.offPalette))
          if (eq(editedRegion, baseRegion)) { skipped++; continue } // unchanged → no overlay
        }
        const full = base.slice()
        cut(editedRegion, full, true)
        recordSheet(full)
        continue
      }
      // Faithful Aseprite tileset (`.aseprite`, full file, SINGLE palette): flatten +
      // slice changed tiles via its OWN embedded palette (no cart context) and splice
      // onto base. Gated to NON-per-tile-palette sheets — a per-tile-palette `.aseprite`
      // (the storybook char sheets) can't be sliced against one flat palette (a color
      // means different indices in different rows), so it falls through to the per-tile
      // path below (flatten → imageToGfx with the per-tile palette, same as its PNG).
      if (e.file.endsWith('.aseprite') && !e.perTilePalette) {
        const dec = decodeAsepriteRegion(readFileSync(p))
        const edits = diffGfxFileAseprite({ palette: dec.palette, bpp: e.bpp, baseTileData: base, flatten: dec.rgba, width: dec.width })
        if (edits.length === 0) { skipped++; continue } // unchanged → no overlay
        const tileBytes = e.bpp === 4 ? 32 : 16
        const full = base.slice()
        for (const ed of edits) full.set(ed.bytes, ed.tileIndex * tileBytes)
        recordSheet(full.subarray(0, e.sizeBytes))
        continue
      }
      // PNG, or a per-tile-palette single-image `.aseprite` (the storybook sheets) — the
      // flatten reproduces the rendered RGBA byte-for-byte, so both take the SAME path.
      const img = e.file.endsWith('.aseprite') ? decodeAsepriteImage(readFileSync(p)) : decodePng(readFileSync(p))
      const layout = e.format === 'lz16' ? lz16Layout(e.rowCount!) : lz2Layout(e.sizeBytes, e.bpp)
      // BG2/BG3 + storybook decode each tile against its own palette row (the swatch
      // can't disambiguate rows that share colors); other layers use the swatch.
      const tilePalette = e.perTilePalette
        ? (t: number): readonly number[] =>
            e.perTilePalette!.subPalettes[e.perTilePalette!.tileSub[t] ?? 0] ?? e.perTilePalette!.subPalettes[0]!
        : undefined
      const stats = { offPalette: 0 }
      const tiles = imageToGfx(img, layout, { base, index0Transparent: e.index0Transparent, tilePalette, stats }).subarray(0, e.sizeBytes)
      // Warn BEFORE the no-op gate (see the region path above — dropped paint is the point).
      if (stats.offPalette > 0) warnings.push(offPaletteWarning(e.file, stats.offPalette))
      if (eq(tiles, base)) { skipped++; continue } // checksum changed but pixels identical → no-op
      recordSheet(tiles)
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
    // Record each edited tile into the shared reconciler, tagged by its sprite file, so two
    // sprite views that paint a shared tile differently conflict (skipped + logged) instead of
    // silently last-write-wins. Sprites are 4bpp (32-byte tiles).
    reconciler.registerManifest(ctx.manifest)
    const propagated = new Set<number>()
    runAssembledTrack({
      entries: metasprites.sprites, dir, gate,
      ctxOf: () => ctx,
      render: (_ctx, e) => canvases.get(e.spriteId) ?? null, // pre-rendered above (faithful only)
      notReconstructable: (e) => `${e.file}: sprite 0x${e.spriteId.toString(16)} no longer faithfully reconstructable`,
      apply: (_ctx, canvas, edited, e) => {
        const { edits } = diffMetaspriteTiles(ctx, canvas, edited)
        if (edits.length === 0) return 'skipped'
        for (const ed of edits) {
          reconciler.chrTile(ed.format, ed.fileId, ed.fileTile, ed.bytes, 32, e.file, 'Sprite sheet')
          for (const sid of tileSprites.get(`${ed.format}/${ed.fileId}/${ed.fileTile}`) ?? []) if (sid !== e.spriteId) propagated.add(sid)
        }
        return 'imported'
      },
      errors, count: { imported: () => spriteImported++, skipped: () => spriteSkipped++, missing: () => spriteMissing++ }
    })
    spritePropagated = propagated.size
  }

  // World-map level-slot icon edits → the shared $74/$75 BG gfx files (via
  // saveGfxEdit). Faithful icons only; per-world context. The icon TILE PIXELS are
  // shared across all worlds (only the tint differs), so an edit to any world's
  // icon writes the same shared tiles — merges via savedFileTiles (last write wins).
  let iconImported = 0, iconSkipped = 0, iconMissing = 0
  if (mapIcons && mapIcons.length > 0) {
    const ctxCache = makeCtxCache((w) => buildWorldMapIconContext(rom, symbols, w, gfxLiveEdits()))
    runAssembledTrack({
      entries: mapIcons, dir, gate,
      ctxOf: (e) => ctxCache.get(e.world),
      render: (ctx, e) => renderWorldMapIcon(ctx, e.name),
      notReconstructable: (e) => `${e.file}: world-map ${e.name} icon no longer faithfully reconstructable`,
      apply: (ctx, canvas, edited, e) => {
        const { edits } = diffWorldMapIconTiles(ctx, canvas, edited)
        if (edits.length === 0) return 'skipped'
        // The icon tiles live in the shared $74/$75 BG files (4bpp); any world's context resolves them.
        reconciler.registerManifest(ctx.manifest)
        for (const ed of edits) reconciler.chrTile(ed.format, ed.fileId, ed.fileTile, ed.bytes, 32, e.file, 'World map char (level icons)')
        return 'imported'
      },
      errors, count: { imported: () => iconImported++, skipped: () => iconSkipped++, missing: () => iconMissing++ }
    })
    accumImagePalette(mapIcons) // COLORS: edited icon palette → master blob
  }

  // Per-level ICON edits → the bank-$53 chunky `.bin` (via saveRawChrEdit). Faithful
  // icons only; per-world context. Pixels are GSU-chunky (1B/px, two icons packed per
  // byte); the slice RMW's only this icon's nibble (the other column's preserved), one
  // 28-byte write per 256-byte row (cols 28-31 belong to the neighbour icon).
  let levelIconImported = 0, levelIconSkipped = 0, levelIconMissing = 0
  if (levelIcons && levelIcons.length > 0) {
    const ctxCache = makeCtxCache((w) => buildLevelIconContext(rom, symbols, w))
    runAssembledTrack({
      entries: levelIcons, dir, gate,
      ctxOf: (e) => ctxCache.get(e.world),
      render: (ctx, e) => renderWorldMapLevelIcon(ctx, e.slot),
      notReconstructable: (e) => `${e.file}: level icon (world ${e.world} slot ${e.slot}) no longer reconstructable`,
      apply: (ctx, canvas, edited, e) => {
        const res = sliceLevelIconWrites(ctx, canvas, edited)
        if (!res) { errors.push(`${e.file}: icon source not in a known $53 bin`); return 'error' }
        if (!res.changed) return 'skipped'
        for (const w of res.writes) reconciler.rawChr(w.binFile, w.offset, w.bytes, e.file)
        return 'imported'
      },
      errors, count: { imported: () => levelIconImported++, skipped: () => levelIconSkipped++, missing: () => levelIconMissing++ }
    })
    accumImagePalette(levelIcons) // COLORS: edited level-icon palette → master blob
  }

  // Overworld-map edits → the cart, from ONE combined `.aseprite` per world (a `.png` is the
  // composited VIEW, no layout, skipped). The file carries BOTH axes:
  //   • PLACEMENT — its TWO tilemap layers (BG1 + BG2, one shared tileset). Each layer's
  //     cells → its tile's (char,pal,prio) word | flip → the 64×32 tilemap; the diff rewrites
  //     only changed words → the $7C/$7D… LZ2 tilemap files. Layers are matched to their file
  //     by NAME ("BG1"/"BG2"), falling back to order (0=BG2 bottom, 1=BG1 top).
  //   • PIXELS — the shared tileset's tiles. An edited tile slices back to its $74/$75/$4C
  //     CHR (base $4000); accumulated in `mapTerrainPatches` and applied once after the loop
  //     (those char files are SHARED across both layers and all worlds, so an edit propagates
  //     — same as the panel/icon char).
  let mapTerrainImported = 0, mapTerrainSkipped = 0, mapTerrainMissing = 0
  if (mapTerrain && mapTerrain.length > 0) {
    for (const e of mapTerrain) {
      const gv = gate(e.file)
      if (gv === 'missing') { mapTerrainMissing++; continue }
      if (gv === 'unchanged') { mapTerrainSkipped++; continue }
      const p = join(dir, e.file)
      if (!e.file.endsWith('.aseprite')) { mapTerrainSkipped++; continue } // PNG = view-only
      try {
        const ctx = buildWorldMapTerrainContext(rom, symbols, e.world, gfxLiveEdits())
        reconciler.registerManifest(ctx.scene.manifest)
        const ms = decodeAsepriteMultiStructural(readFileSync(p))
        // The per-tile (char,pal,prio) key list, read from the manifest (the file's own
        // tileset order) — NOT re-derived. Fallback to deriving it only if an older export
        // lacks it.
        const keys = e.tileKeys ?? unifiedTerrainKeys(ctx)
        let entryChanged = false
        // (a) PLACEMENT: match each layer → its BG file by name (fall back to order).
        const layerFor = (bg: 1 | 2): typeof ms.layers[number] | undefined =>
          ms.layers.find((l) => l.name.toLowerCase().includes(`bg${bg}`)) ?? ms.layers[bg === 2 ? 0 : 1]
        const jobs: { layer: 0 | 1; fileId: number; cells: AsepriteCell[] }[] = []
        const bg1 = layerFor(1), bg2 = layerFor(2)
        if (bg1) jobs.push({ layer: 0, fileId: e.bg1FileId, cells: bg1.cells })
        if (bg2) jobs.push({ layer: 1, fileId: e.bg2FileId, cells: bg2.cells })
        let terrainErased = 0
        for (const j of jobs) {
          const { tilemap, erased } = diffWorldMapTerrainPlacement(ctx, j.layer, keys, j.cells)
          terrainErased += erased
          if (!tilemap) continue // unchanged layer → no overlay
          const r = saveGfxEdit('lz2', j.fileId, tilemap, undefined, { kind: 'tilemap', unitBytes: 2, role: `World map terrain (world ${e.world}, BG${j.layer + 1})` })
          if (r.ok) { mapTerrainImported++; entryChanged = true }
          else errors.push(`${e.file} (0x${j.fileId.toString(16)}): ${r.error}`)
        }
        if (terrainErased > 0) errors.push(erasedCellsWarning(e.file, terrainErased))
        // (b) PIXELS: slice the edited tileset back to the shared $74/$75/$4C CHR → reconciler
        // (4bpp, 32-byte tiles; shared across layers/worlds, so conflict-checked cross-file).
        const { edits, conflicts } = diffWorldMapTerrainPixels(ctx, keys, ms.tilePixels, ms.numTiles, ms.palette)
        if (edits.length > 0) { for (const ed of edits) reconciler.chrTile(ed.format, ed.fileId, ed.fileTile, ed.bytes, 32, e.file, 'World map terrain char'); entryChanged = true }
        if (conflicts > 0) errors.push(`${e.file}: ${conflicts} shared-tile pixel conflict(s) — a char used at multiple palette rows was edited inconsistently; the first edit was kept.`)
        // (c) COLORS: an edited embedded palette → the master blob (independent of a/b).
        if (e.paletteOffsets) {
          for (const ed of diffAsepritePalette(ms.palette, e.paletteOffsets, effectiveBlobWords())) { reconciler.paletteWord(ed.offset, ed.value, e.file); paletteImported++ }
        }
        if (!entryChanged) mapTerrainSkipped++
      } catch (err) {
        errors.push(`${e.file}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  }
  // The shared decorative-ground layout ($7E) — same model, one file. Counted with the
  // overworld-map track above. (PNG = view-only; only the .aseprite carries layout.)
  if (mapGround) {
    const gv = gate(mapGround.file)
    if (gv === 'missing') { mapTerrainMissing++ }
    else if (gv === 'unchanged') { mapTerrainSkipped++ }
    else if (!mapGround.file.endsWith('.aseprite')) { mapTerrainSkipped++ }
    else {
      try {
        const ctx = buildWorldMapGroundContext(rom, symbols)
        const keys = mapGround.tileKeys ?? groundTileKeys(ctx) // from manifest; derive only for old exports
        const struct = decodeAsepriteStructural(readFileSync(join(dir, mapGround.file)))
        const { tilemap, erased } = diffWorldMapGroundPlacement(ctx, keys, struct)
        if (erased > 0) errors.push(erasedCellsWarning(mapGround.file, erased))
        if (!tilemap) { mapTerrainSkipped++ } // single-owner $7E tilemap → direct save
        else {
          const r = saveGfxEdit('lz2', mapGround.fileId, tilemap, undefined, { kind: 'tilemap', unitBytes: 2, role: 'World map ground (BG3)' })
          if (r.ok) mapTerrainImported++
          else errors.push(`${mapGround.file}: ${r.error}`)
        }
        // COLORS: an edited embedded palette → the master blob (independent of placement).
        if (mapGround.paletteOffsets) {
          for (const ed of diffAsepritePalette(struct.palette, mapGround.paletteOffsets, effectiveBlobWords())) { reconciler.paletteWord(ed.offset, ed.value, mapGround.file); paletteImported++ }
        }
      } catch (err) {
        errors.push(`${mapGround.file}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  }

  // Raphael arena layout (the Bosses track) — the mapGround import's twin: a layout
  // `.aseprite` → the $BD byte-cell Mode-7 tilemap (single-owner → direct save); an edited
  // embedded palette → the master blob. The context takes the live gfx cache so a re-import
  // diffs against base ⊕ unbuilt edits (idempotent round-trip). The PNG is a view — skipped.
  let bossImported = 0, bossSkipped = 0, bossMissing = 0
  if (bossArena) {
    const gv = gate(bossArena.file)
    if (gv === 'missing') { bossMissing++ }
    else if (gv === 'unchanged') { bossSkipped++ }
    else if (!bossArena.file.endsWith('.aseprite')) { bossSkipped++ }
    else {
      try {
        const ctx = buildRaphaelArenaContext(rom, symbols, gfxLiveEdits())
        const keys = bossArena.tileKeys ?? raphaelTileKeys(ctx) // from manifest; derive only for old exports
        const struct = decodeAsepriteStructural(readFileSync(join(dir, bossArena.file)))
        const { tilemap, erased } = diffRaphaelArenaPlacement(ctx, keys, struct)
        if (erased > 0) errors.push(erasedCellsWarning(bossArena.file, erased))
        if (!tilemap) { bossSkipped++ } // single-owner $BD tilemap → direct save
        else {
          const r = saveGfxEdit('lz2', bossArena.fileId, tilemap, undefined, { kind: 'tilemap', unitBytes: 1, role: 'Raphael arena (Mode-7)' })
          if (r.ok) bossImported++
          else errors.push(`${bossArena.file}: ${r.error}`)
        }
        // COLORS: an edited embedded palette → the master blob (independent of placement).
        if (bossArena.paletteOffsets) {
          for (const ed of diffAsepritePalette(struct.palette, bossArena.paletteOffsets, effectiveBlobWords())) { reconciler.paletteWord(ed.offset, ed.value, bossArena.file); paletteImported++ }
        }
      } catch (err) {
        errors.push(`${bossArena.file}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  }

  // World-map M1TE2 ".M1" sessions (the M1TE2-format World Map export). Each overworld file
  // round-trips to the SAME cart files as the Aseprite terrain ($7C/$7D/$7E tilemaps +
  // $74/$75/$4C/$56 char + the per-world palette); the icons file routes per-level pixels to
  // bank-$53 and marker/castle pixels to the shared $74/$75 char. Counts fold into the
  // existing overworld/icon tallies. The .M1 itself is the source of truth — the engine
  // re-derives the scene/grid from the cart (world-map-m1te2.ts).
  if (mapM1) {
    // ── Overworld: CHR pixels (per file → reconciler) + tilemap words (per file, direct,
    //    single-owner) + palette (→ reconciler). $7E ground is world-invariant.
    let m1Manifest: GfxFileEntry[] | null = null
    const m1Words = new Map<number, { base: Uint8Array; words: Map<number, number> }>()
    // fileId → human role for the tilemap files this export round-trips. These are per-world,
    // not level-loaded, so gfxFileRole can't classify them — the importer stamps the role so the
    // "Changed graphics" list names them. ($7E ground is world-invariant; last write wins, same label.)
    const m1TilemapRole = new Map<number, string>()
    for (const ov of mapM1.overworlds) {
      m1TilemapRole.set(ov.bg1FileId, `World map terrain (world ${ov.world}, BG1)`)
      m1TilemapRole.set(ov.bg2FileId, `World map terrain (world ${ov.world}, BG2)`)
      m1TilemapRole.set(ov.bg3FileId, 'World map ground (BG3)')
    }
    for (const ov of mapM1.overworlds) {
      const gv = gate(ov.file)
      if (gv === 'missing') { mapTerrainMissing++; continue }
      if (gv === 'unchanged') { mapTerrainSkipped++; continue }
      try {
        const ctx = buildWorldMapTerrainContext(rom, symbols, ov.world, gfxLiveEdits())
        foldLivePaletteIntoScene(ctx.scene.cgram, ctx.scene.provenance) // diff palette vs base ⊕ edits (see note)
        m1Manifest = ctx.scene.manifest
        reconciler.registerManifest(ctx.scene.manifest)
        const d = diffOverworldM1(ctx, readFileSync(join(dir, ov.file)))
        let entryChanged = false
        // Tileset-1 use: cells pointing into the blank, ✕-marked char-0-255 band. They still
        // import (verbatim), but draw unrelated panel graphics in-game — flag them in red.
        if (d.tileset1Cells > 0) {
          errors.push(`${ov.file}: ${d.tileset1Cells} cell${d.tileset1Cells === 1 ? '' : 's'} use tileset 1 (the blank char 0–255 band, shown as a ✕ in M1TE) — these draw unrelated panel graphics in-game. Use tilesets 2–4 for overworld map tiles.`)
        }
        // CHR pixels — 4bpp ($74/$75/$4C) + 2bpp ($56) tiles, each at its own stride → reconciler.
        for (const e of d.chrEdits) { reconciler.chrTile(e.format, e.fileId, e.fileTile, e.bytes, e.tileBytes, ov.file, 'World map char'); entryChanged = true }
        // Tilemap words — accumulate per file (a file's screens/worlds write disjoint offsets).
        for (const w of d.wordEdits) {
          let acc = m1Words.get(w.fileId)
          if (!acc) {
            const base = overworldTilemapBase(ctx, w.fileId)
            if (!base) { errors.push(`${ov.file}: unknown tilemap file 0x${w.fileId.toString(16)}`); continue }
            acc = { base, words: new Map() }; m1Words.set(w.fileId, acc)
          }
          acc.words.set(w.fileOffset, w.word); entryChanged = true
        }
        // Palette colors → the master blob via the scene's provenance (skip non-blob slots).
        for (const pe of d.paletteEdits) {
          const off = ctx.scene.provenance[pe.cgramIndex] ?? -1
          if (off >= 0) { reconciler.paletteWord(off, pe.bgr15, ov.file); paletteImported++; entryChanged = true }
        }
        if (entryChanged) mapTerrainImported++; else mapTerrainSkipped++
      } catch (err) {
        errors.push(`${ov.file}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    // Splice each tilemap file's accumulated word edits once (onto the live overlay if any).
    // This PERSISTS edits already counted per changed .M1 entry above — it must NOT re-count
    // (counting both double-reported "2 overworld maps changed" for a single edited file).
    for (const [fileId, acc] of m1Words) {
      if (acc.words.size === 0) continue
      const bytes = (liveTiles('lz2', fileId) ?? acc.base).slice()
      let written = 0
      for (const [off, word] of acc.words) if (off >= 0 && off + 1 < bytes.length) { bytes[off] = word & 0xff; bytes[off + 1] = (word >> 8) & 0xff; written++ }
      if (written === 0) continue
      const r = saveGfxEdit('lz2', fileId, bytes, undefined, { kind: 'tilemap', unitBytes: 2, role: m1TilemapRole.get(fileId) })
      if (!r.ok) errors.push(`overworld tilemap 0x${fileId.toString(16)}: ${r.error}`)
    }

    // ── Icons: per-level pixels → bank-$53 (.bin nibble RMW); marker/castle → the shared
    //    $74/$75 char (via saveGfxEdit). Folds into the level-icon + map-icon tallies.
    if (mapM1.icons) {
      const gv = gate(mapM1.icons.file)
      if (gv === 'missing') { levelIconMissing++; iconMissing++ }
      else if (gv === 'unchanged') { levelIconSkipped++; iconSkipped++ }
      else {
        const mfile = mapM1.icons.file
        try {
          const d = diffIconsM1(rom, symbols, readFileSync(join(dir, mfile)), gfxLiveEdits())
          // Per-level pixels → bank-$53 raw .bin; marker/castle → shared $74/$75 char — both
          // through the reconciler (raw + CHR), conflict-checked with every other track.
          for (const w of d.levelWrites) reconciler.rawChr(w.binFile, w.offset, w.bytes, mfile)
          if (d.levelWrites.length > 0) levelIconImported += d.levelIconsChanged
          if (d.markerCastleEdits.length > 0) {
            reconciler.registerManifest(m1Manifest ?? buildWorldMapTerrainContext(rom, symbols, 0).scene.manifest)
            for (const ed of d.markerCastleEdits) reconciler.chrTile(ed.format, ed.fileId, ed.fileTile, ed.bytes, 32, mfile, 'World map char (marker / castle)')
            iconImported += d.markerCastleChanged
          }
          if (d.conflicts > 0) errors.push(`map icons: ${d.conflicts} shared marker/castle tile conflict(s) — the first edit was kept.`)
        } catch (err) {
          errors.push(`${mfile}: ${err instanceof Error ? err.message : String(err)}`)
        }
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
    const gv = gate(titleLogo.file)
    if (gv === 'missing') { logoMissing++ }
    else if (gv === 'unchanged') { logoSkipped++ }
    else if (!titleLogo.faithful) { /* preview-only: skip silently */ }
    else {
      const ctx = buildTitleLogoContext(rom, symbols, gfxLiveEdits())
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
            const logoKeys = titleLogo.tileKeys ?? logoTileKeys(ctx) // from manifest; derive only for old exports
            const struct = decodeAsepriteStructural(readFileSync(p))
            const d = diffTitleLogoCombined(ctx, logoKeys, struct)
            if (d.removedTiles) {
              errors.push(`title logo: the tileset has fewer tiles than exported — tiles were deleted/reordered. Edit in Manual tileset mode (don't delete tiles) or re-export.`)
            } else {
              pixelEdits = d.pixels
              if (d.placement.length > 0) {
                // d.placement is the DELTA vs base ⊕ overlay (the `rom` baseline) — merge it
                // onto the existing overlay so prior cell moves survive (full-set save).
                const r = await saveLogoTilemap(mergePlacement(loadLogoTilemapEdits(), d.placement))
                if (r.ok) changed = true
                else errors.push(`title logo (DATA_title_screen_logo_tilemap): ${r.error}`)
              }
              if (d.skipped > 0) errors.push(`title logo: ${d.skipped} repositioned cell${d.skipped === 1 ? '' : 's'} skipped (non-editable / new tile — add new logo art via the faithful $1D sheet).`)
              if (d.erased > 0) errors.push(erasedCellsWarning('title logo', d.erased))
            }
            // COLORS: an edited embedded palette (logo BG2 rows 8..15) → the master blob.
            if (titleLogo.paletteOffsets) {
              for (const ed of diffAsepritePalette(struct.palette, titleLogo.paletteOffsets, effectiveBlobWords())) { reconciler.paletteWord(ed.offset, ed.value, titleLogo.file); paletteImported++ }
            }
          } else {
            // PNG: pixels only (a flat sheet carries no tilemap). Crop off the swatch column.
            pixelEdits = diffTitleLogoTiles(ctx, canvas, canvasRegion(decodePng(readFileSync(p)), canvas.width, canvas.height)).edits
          }
          if (pixelEdits.length > 0) {
            // The logo char is the lz2 $1D sheet (2bpp → 16-byte tiles), shared with the raw
            // screens/title/f1D sheet — record into the reconciler for cross-file conflict checks.
            reconciler.registerManifest(ctx.manifest)
            for (const ed of pixelEdits) reconciler.chrTile(ed.format, ed.fileId, ed.fileTile, ed.bytes, ed.format === 'lz16' ? 32 : 16, titleLogo.file)
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
    const gv = gate(titleIsland.file)
    if (gv === 'missing') { islandMissing++ }
    else if (gv === 'unchanged') { islandSkipped++ }
    else if (!titleIsland.faithful) { /* preview-only: skip silently */ }
    else {
      const ctx = buildTitleIslandContext(rom, symbols, gfxLiveEdits())
      const canvas = renderTitleIsland(ctx)
      if (!canvas.faithful) {
        errors.push(`${titleIsland.file}: title island no longer faithfully reconstructable`)
      } else {
        try {
          // Record $B1 char-tile edits (each island char = 32 CPC bytes at char*32) into the
          // reconciler — re-assembled + re-encoded (LZ2) once, conflict-checked with the raw $B1 sheet.
          const recordIslandPixels = (edits: readonly { char: number; bytes: Uint8Array }[]): void => {
            reconciler.registerManifest([{ format: 'lz2', fileId: 0xb1, sizeBytes: ctx.b1cpc.length }])
            for (const ed of edits) reconciler.chrTile('lz2', 0xb1, ed.char, ed.bytes, 32, titleIsland.file)
          }
          if (p.endsWith('.aseprite')) {
            // COMBINED import (assumes Manual Aseprite tileset mode): ONE .aseprite carries
            // pixel edits + cell repositions + newly-added tiles, applied together. Reads
            // the tileset/cells STRUCTURALLY (indices, not a flatten) so each kind of edit
            // is attributed by its stable tile index — placement → DATA_5F9800, pixels +
            // new tiles → $B1. New tiles allocate from the ~9 char slots free in BOTH island
            // worlds (writing a W6-used slot would corrupt the world-6 island). See
            // diffTitleIslandCombined for the Manual-mode assumption + safety rails.
            const islandKeys = titleIsland.tileKeys ?? islandTileChars(ctx) // from manifest; derive only for old exports
            const struct = decodeAsepriteStructural(readFileSync(p))
            const d = diffTitleIslandCombined(ctx, islandKeys, struct)
            if (d.removedTiles) {
              errors.push(`title island: the tileset has fewer tiles than exported — tiles were deleted/reordered. Edit in Manual tileset mode (don't delete tiles) or re-export.`)
            } else {
              let ok = true
              if (d.pixels.length > 0) recordIslandPixels(d.pixels)
              if (d.placement.length > 0) { const r = await saveIslandTilemap(mergePlacement(loadIslandTilemapEdits(), d.placement)); if (!r.ok) { errors.push(`title island (DATA_5F9800): ${r.error}`); ok = false } }
              if (d.unmappedTiles > 0) errors.push(`title island: ${d.unmappedTiles} new tile${d.unmappedTiles === 1 ? '' : 's'} couldn't be added — only ${ctx.addableChars.length} free $B1 char slot${ctx.addableChars.length === 1 ? '' : 's'} exist (the rest are used by the world-6 island).`)
              if (d.skippedW6Tiles > 0) errors.push(`title island: ${d.skippedW6Tiles} edit${d.skippedW6Tiles === 1 ? '' : 's'} to world-6-only tiles were skipped (they'd corrupt the world-6 island) — edit those via the faithful $B1 sheet.`)
              if (d.erased > 0) errors.push(erasedCellsWarning('title island', d.erased))
              islandSharedCells = d.sharedCells
              islandNewTiles = d.newTiles
              if (ok && (d.pixels.length > 0 || d.placement.length > 0)) islandImported++
              else if (d.pixels.length === 0 && d.placement.length === 0) islandSkipped++
            }
            // COLORS: an edited embedded palette (Mode-7 CGRAM 0-15) → the master blob.
            if (titleIsland.paletteOffsets) {
              for (const ed of diffAsepritePalette(struct.palette, titleIsland.paletteOffsets, effectiveBlobWords())) { reconciler.paletteWord(ed.offset, ed.value, titleIsland.file); paletteImported++ }
            }
          } else {
            // PNG: pixels only (a flat PNG carries no tilemap/placement). The PNG has a
            // swatch column, so crop to the canvas region, then slice back to $B1 chars.
            const edited = canvasRegion(decodePng(readFileSync(p)), canvas.width, canvas.height)
            const { edits, sharedCells } = diffTitleIslandTiles(ctx, canvas, edited)
            if (edits.length === 0) { islandSkipped++ }
            else {
              islandSharedCells = sharedCells
              recordIslandPixels(edits)
              islandImported++
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
    const gv = gate(titleScenery.file)
    if (gv === 'missing') { sceneryMissing++ }
    else if (gv === 'unchanged') { scenerySkipped++ }
    else {
      try {
        const ctx = buildTitleSceneryContext(rom, symbols)
        const canvas = renderTitleScenery(ctx)
        const edited = decodeEditedToRgba(p, 'image', canvas.width, canvas.height)
        const { region, changed } = diffTitleScenery(ctx, edited)
        if (changed === 0) { scenerySkipped++ }
        else { reconciler.rawChr(SCENERY_BIN_FILE, 0, region, titleScenery.file); sceneryImported++ }
        // COLORS: an edited embedded palette (OBJ row 7) → the master blob (Aseprite mode only).
        if (titleScenery.paletteOffsets && p.endsWith('.aseprite')) {
          const asePal = decodeAsepriteImage(readFileSync(p)).palette
          for (const ed of diffAsepritePalette(asePal, titleScenery.paletteOffsets, effectiveBlobWords())) { reconciler.paletteWord(ed.offset, ed.value, titleScenery.file); paletteImported++ }
        }
      } catch (err) {
        errors.push(`${titleScenery.file}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  }

  // Bank09 1bpp sheets (message font / message-box pictures) → the raw `.bin` via
  // saveRawChrEdit. The edited PNG is a 2-color cell grid; re-encode by alpha-
  // threshold and write only when the bytes actually changed vs base.
  let fontImported = 0, fontSkipped = 0, fontMissing = 0
  for (const f of fonts ?? []) {
    const gv = gate(f.file)
    if (gv === 'missing') { fontMissing++; continue }
    if (gv === 'unchanged') { fontSkipped++; continue }
    const p = join(dir, f.file)
    try {
      const edited = decodeEditedToRgba(p, 'image', f.width, f.height)
      const base = readRawChrBase(f.binFile)
      const bytes = encodeFontSheet(edited, f.width, f.glyphW, f.glyphH, f.cols, base.length)
      let changed = bytes.length !== base.length
      for (let i = 0; !changed && i < bytes.length; i++) if (bytes[i] !== base[i]) changed = true
      if (!changed) { fontSkipped++; continue }
      reconciler.rawChr(f.binFile, 0, bytes, f.file); fontImported++
    } catch (err) {
      errors.push(`${f.file}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // Storybook first-scene edits → the f27 (BG3) char tiles (pixels, via saveGfxEdit).
  // Pixels-only (PNG or Aseprite flatten): the BG3 tilemap is runtime-streamed, so there's
  // no static placement to edit — only the frame's f27 tiles. A shared char repaints every
  // cell that reuses it. f27 is lz2/2bpp → 16-byte tiles. Interior (non-f27) edits are ignored.
  let sceneImported = 0, sceneSkipped = 0, sceneMissing = 0
  if (storybookScene) {
    const p = join(dir, storybookScene.file)
    const gv = gate(storybookScene.file)
    if (gv === 'missing') { sceneMissing++ }
    else if (gv === 'unchanged') { sceneSkipped++ }
    else if (!storybookScene.faithful) { /* preview-only: skip silently */ }
    else {
      try {
        const ctx = buildStorybookSceneContext(rom, symbols, gfxLiveEdits())
        const canvas = renderStorybookScene(ctx)
        if (!canvas.faithful) {
          errors.push(`${storybookScene.file}: storybook scene no longer faithfully reconstructable`)
        } else {
          const edited = decodeEditedToRgba(p, 'region', canvas.width, canvas.height)
          const pixelEdits = diffStorybookSceneTiles(ctx, canvas, edited).edits
          if (pixelEdits.length === 0) { sceneSkipped++ }
          else {
            // f27 is lz2/2bpp → 16-byte tiles; record into the reconciler (shared with the raw f27 sheet).
            reconciler.registerManifest([ctx.f27])
            for (const ed of pixelEdits) reconciler.chrTile(ed.format, ed.fileId, ed.fileTile, ed.bytes, 16, storybookScene.file, 'Storybook scene char (f27)')
            sceneImported++
          }
          // Color write-back: an edited embedded palette → the master blob (Aseprite mode
          // only — the embedded palette is the editable surface). Independent of pixel edits,
          // so a palette-only change still applies. Base-aware diff → unedited = no-op.
          if (storybookScene.paletteOffsets && p.endsWith('.aseprite')) {
            const asePal = decodeAsepriteRegion(readFileSync(p)).palette
            for (const ed of diffAsepritePalette(asePal, storybookScene.paletteOffsets, effectiveBlobWords())) { reconciler.paletteWord(ed.offset, ed.value, storybookScene.file); paletteImported++ }
          }
        }
      } catch (err) {
        errors.push(`${storybookScene.file}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  }

  // System-screen M1TE2 ".M1" sessions (the M1TE2-format Boot/Story/Title export). Each file
  // is dispatched by kind to the SAME cart targets as its Aseprite twin: island → $B1 char
  // (CPC) + DATA_5F9800 (saveIslandTilemap); storybook scene → f27 (pixels-only). Counts fold
  // into the existing island/scene tallies. (The title logo is excluded from the .M1 set — it
  // renders with the wrong palette base in M1TE; edit it via PNG/Aseprite.) The engine
  // re-derives the scene from the cart (screen-m1te2.ts).
  let bonusImported = 0, bonusSkipped = 0, bonusMissing = 0
  if (screenM1 && screenM1.length > 0) {
    // Map an .M1's CGRAM-index palette edits → the master blob via the scene's provenance.
    const accumScreenM1Palette = (edits: ScreenPaletteEdit[], provenance: Int32Array, source: string): void => {
      for (const pe of edits) { const off = provenance[pe.cgramIndex] ?? -1; if (off >= 0) { reconciler.paletteWord(off, pe.bgr15, source); paletteImported++ } }
    }
    // Bonus-game tilemap WORD edits accumulate ACROSS the six .M1 files before saving:
    // the BG3 tilemap ($95) is shared by every game, so per-file saves would clobber
    // each other; a per-word merge keeps the last edit and saves each file once.
    const bonusWords = new Map<number, Map<number, number>>() // fileId → fileOffset → word
    const bonusTmSize = new Map<number, number>() // fileId → sizeBytes (for the base decode)
    for (const e of screenM1) {
      const gv = gate(e.file)
      if (gv === 'missing') { if (e.kind === 'island') islandMissing++; else if (e.kind.startsWith('bonus')) bonusMissing++; else sceneMissing++; continue }
      if (gv === 'unchanged') { if (e.kind === 'island') islandSkipped++; else if (e.kind.startsWith('bonus')) bonusSkipped++; else sceneSkipped++; continue }
      try {
        const bytes = readFileSync(join(dir, e.file))
        if (e.kind === 'bonus-backdrop') {
          // The shared BG3 backdrop ($95) — one file for all six games (game 0's
          // palette colors it). Word edits join the same merged-save map.
          const ctx = buildBonusSceneContext(rom, symbols, 0, { gfxOverride: gfxLiveEdits() })
          foldLivePaletteIntoScene(ctx.cgram, ctx.provenance)
          const d = diffBonusBackdropM1(ctx, bytes)
          let changed = false
          if (d.chrEdits.length > 0) {
            reconciler.registerManifest(ctx.manifest)
            for (const ce of d.chrEdits) reconciler.chrTile(ce.format, ce.fileId, ce.fileTile, ce.bytes, ce.bytes.length, e.file, 'Bonus-game backdrop char')
            changed = true
          }
          for (const w of d.wordEdits) {
            const m = bonusWords.get(w.fileId) ?? bonusWords.set(w.fileId, new Map()).get(w.fileId)!
            m.set(w.fileOffset, w.word)
            changed = true
          }
          const f95 = ctx.manifest.find((mf) => mf.format === 'lz2' && mf.fileId === ctx.bg3TmFileId)
          if (f95) bonusTmSize.set(ctx.bg3TmFileId, f95.sizeBytes)
          if (d.skippedTiles > 0) errors.push(`${e.file}: ${d.skippedTiles} edited tile(s)/cell(s) in runtime-drawn regions were ignored.`)
          accumScreenM1Palette(d.paletteEdits, ctx.provenance, e.file)
          if (changed) bonusImported++; else bonusSkipped++
        } else if (e.kind === 'bonus-game' && e.game !== undefined) {
          const ctx = buildBonusSceneContext(rom, symbols, e.game, { gfxOverride: gfxLiveEdits() })
          foldLivePaletteIntoScene(ctx.cgram, ctx.provenance) // diff palette vs base ⊕ edits (see note)
          const d = diffBonusM1(ctx, bytes)
          let changed = false
          if (d.chrEdits.length > 0) {
            reconciler.registerManifest(ctx.manifest)
            for (const ce of d.chrEdits) reconciler.chrTile(ce.format, ce.fileId, ce.fileTile, ce.bytes, ce.bytes.length, e.file, 'Bonus-game screen char')
            changed = true
          }
          for (const w of d.wordEdits) {
            const m = bonusWords.get(w.fileId) ?? bonusWords.set(w.fileId, new Map()).get(w.fileId)!
            m.set(w.fileOffset, w.word)
            changed = true
          }
          for (const fid of [ctx.bg1TmFileId, ctx.bg2TmFileId, ctx.bg3TmFileId]) {
            const f = ctx.manifest.find((mf) => mf.format === 'lz2' && mf.fileId === fid)
            if (f) bonusTmSize.set(fid, f.sizeBytes)
          }
          if (d.skippedTiles > 0) errors.push(`${e.file}: ${d.skippedTiles} edited tile(s)/cell(s) in runtime-drawn regions were ignored.`)
          accumScreenM1Palette(d.paletteEdits, ctx.provenance, e.file)
          if (changed) bonusImported++; else bonusSkipped++
        } else if (e.kind === 'island') {
          const ctx = buildTitleIslandContext(rom, symbols, gfxLiveEdits())
          foldLivePaletteIntoScene(ctx.cgram, ctx.provenance) // diff palette vs base ⊕ edits (see note)
          const d = diffTitleIslandM1(ctx, bytes)
          let changed = false
          if (d.charEdits.length > 0) {
            // $B1 CPC char edits → reconciler (each char = 32 bytes; merges with the Aseprite island path).
            reconciler.registerManifest([{ format: 'lz2', fileId: 0xb1, sizeBytes: ctx.b1cpc.length }])
            for (const ce of d.charEdits) reconciler.chrTile('lz2', 0xb1, ce.char, ce.bytes, 32, e.file)
            changed = true
          }
          if (d.placement.length > 0) {
            const r = await saveIslandTilemap(mergePlacement(loadIslandTilemapEdits(), d.placement))
            if (r.ok) changed = true; else errors.push(`title island (DATA_5F9800): ${r.error}`)
          }
          accumScreenM1Palette(d.paletteEdits, ctx.provenance, e.file)
          if (changed) islandImported++; else islandSkipped++
        } else {
          const ctx = buildStorybookSceneContext(rom, symbols, gfxLiveEdits())
          foldLivePaletteIntoScene(ctx.cgram, ctx.provenance) // diff palette vs base ⊕ edits (see note)
          const d = diffStorybookSceneM1(ctx, bytes)
          let changed = false
          if (d.chrEdits.length > 0) {
            reconciler.registerManifest([ctx.f27])
            for (const ce of d.chrEdits) reconciler.chrTile(ce.format, ce.fileId, ce.fileTile, ce.bytes, 16, e.file, 'Storybook scene char (f27)') // f27 lz2/2bpp → 16-byte tiles
            changed = true
          }
          accumScreenM1Palette(d.paletteEdits, ctx.provenance, e.file)
          if (changed) sceneImported++; else sceneSkipped++
        }
      } catch (err) {
        errors.push(`${e.file}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    // Save the merged bonus tilemap word edits — ONE saveGfxEdit per file. The BG3
    // tilemap ($95) is shared by all six games, so the per-word merge above is what
    // keeps two edited game screens from clobbering each other's $95 save.
    for (const [fileId, words] of bonusWords) {
      if (words.size === 0) continue
      const sizeBytes = bonusTmSize.get(fileId)
      if (sizeBytes === undefined) { errors.push(`bonus tilemap 0x${fileId.toString(16)}: size unknown — placement edits skipped.`); continue }
      const buf = (liveTiles('lz2', fileId) ?? decodeGfxFile(rom, symbols, 'lz2', fileId, sizeBytes)).slice()
      let written = 0
      for (const [off, word] of words) if (off >= 0 && off + 1 < buf.length) { buf[off] = word & 0xff; buf[off + 1] = (word >> 8) & 0xff; written++ }
      if (written === 0) continue
      const r = saveGfxEdit('lz2', fileId, buf, undefined, { kind: 'tilemap', unitBytes: 2, role: 'Bonus-game screen tilemap' })
      if (!r.ok) errors.push(`bonus tilemap 0x${fileId.toString(16)}: ${r.error}`)
    }
  }

  // Dynamic-sprite glyph edits → the raw glyph .bin (via saveRawChrEdit). Only
  // byte-validated glyphs are editable; a shared source affects its other sprites.
  let glyphImported = 0, glyphSkipped = 0, glyphMissing = 0, glyphShared = 0
  if (glyphs && glyphs.sprites.length > 0) {
    const affected = new Set<number>()
    for (const e of glyphs.sprites) {
      const gv = gate(e.file)
      if (gv === 'missing') { glyphMissing++; continue }
      if (gv === 'unchanged') { glyphSkipped++; continue }
      try {
        const reg = decodeEditedToRgba(join(dir, e.file), 'image', e.width, e.height) // glyphs are PNG-only (no .aseprite export)
        const res = glyphWritesForSprite(rom, symbols, glyphs.header, e.spriteNum, reg)
        if (!res) { errors.push(`${e.file}: sprite 0x${e.spriteNum.toString(16)} isn't an editable glyph`); continue }
        if (!res.changed) { glyphSkipped++; continue }
        for (const w of res.writes) reconciler.rawChr(w.binFile, w.offset, w.bytes, e.file)
        glyphImported++
        for (const sid of res.sharedWith) affected.add(sid)
      } catch (err) {
        errors.push(`${e.file}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    glyphShared = affected.size
  }

  // YY-CHR raw sheets — the whole-cart yychr track's section. No pixel decode: the
  // file IS the (bank-padded) decompressed blob; gfx-yychr-io truncates + byte-diffs
  // and records into the same reconciler (checksum-gated like every other track).
  let yychrImported = 0, yychrSkipped = 0, yychrMissing = 0, yychrPadEdited = 0
  if (yychr && yychr.length > 0) {
    const c = importYychrEntries(dir, yychr, gate, reconciler, rom, symbols)
    yychrImported = c.imported; yychrSkipped = c.skipped; yychrMissing = c.missing; yychrPadEdited = c.padEdited
    errors.push(...c.errors)
  }

  // The actual writes (CHR re-encode, palette merge, raw-CHR, conflict resolution) happen in
  // reconciler.apply() — called ONCE by graphics-folder-io after BOTH importers have recorded.
  return {
    imported, skipped, missing,
    spriteImported, spriteSkipped, spriteMissing, spritePropagated,
    iconImported, iconSkipped, iconMissing,
    levelIconImported, levelIconSkipped, levelIconMissing,
    mapTerrainImported, mapTerrainSkipped, mapTerrainMissing,
    logoImported, logoSkipped, logoMissing,
    islandImported, islandSkipped, islandMissing, islandSharedCells, islandNewTiles,
    sceneryImported, scenerySkipped, sceneryMissing,
    sceneImported, sceneSkipped, sceneMissing,
    bonusImported, bonusSkipped, bonusMissing,
    bossImported, bossSkipped, bossMissing,
    glyphImported, glyphSkipped, glyphMissing, glyphShared,
    fontImported, fontSkipped, fontMissing,
    yychrImported, yychrSkipped, yychrMissing, yychrPadEdited,
    paletteImported,
    errors,
    warnings
  }
}
