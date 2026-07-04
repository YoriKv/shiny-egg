// Shared manifest contract for the Graphics export/import (gfx-manifest.json). The
// export side (gfx-png-export.ts) WRITES these entries; the import side
// (gfx-png-import.ts) READS them back — they're the on-disk format both agree on,
// so they live here, owned by neither direction.

import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { type PerTilePalette } from 'snes-framework/render-gfx-files'
import { type TileRegion } from 'snes-framework/screen-gfx'

/** The manifest filename at the export-dir root. */
export const MANIFEST = 'gfx-manifest.json'

// Every export artifact (the manifest's top-level `exportedBy`, and each bg-region
// sidecar) is stamped with the app version that wrote it. Import compares it against
// the running version and warns when the artifact is from a NEWER shiny-egg — a newer
// export may carry sections/fields this version doesn't know, so a quiet partial
// import gets an explanation. Absent on pre-stamp exports (never warns). Older-than-
// current artifacts import as before (the manifest formats are read tolerantly).

/** True when `exported` (an artifact's stamped app version) is a NEWER release than
 *  `current`. Dotted-segment compare: numeric segments numerically (missing = 0),
 *  non-numeric fallback lexicographic. Unstamped (undefined) is never newer. */
export function isNewerAppVersion(exported: string | undefined, current: string): boolean {
  if (!exported) return false
  const pa = exported.split('.')
  const pb = current.split('.')
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const a = pa[i] ?? '0'
    const b = pb[i] ?? '0'
    const an = parseInt(a, 10)
    const bn = parseInt(b, 10)
    if (Number.isFinite(an) && Number.isFinite(bn)) {
      if (an !== bn) return an > bn
    } else if (a !== b) {
      return a > b
    }
  }
  return false
}

/** The amber warning line for an artifact stamped by a newer shiny-egg. `what`
 *  names the artifact ("This export folder", "bg2-region.m1.json", …). */
export function newerExportWarning(what: string, exported: string, current: string): string {
  return (
    `${what} was exported by shiny-egg ${exported} — newer than this app (${current}). ` +
    `Data added by newer versions may be skipped; upgrade shiny-egg if the import looks incomplete.`
  )
}

/** Top-level `checksums` map in gfx-manifest.json: each manifest-relative artifact path →
 *  sha256 (hex) of its bytes at export. The import checksum gate (gfx-import-reconcile.ts
 *  `changedSinceExport`) skips any artifact whose current bytes still match — so a file the
 *  user never touched contributes nothing and can't revert a newer edit on re-import. Absent
 *  on pre-checksum exports (those import unconditionally, as before). */
export type GfxManifestChecksums = Record<string, string>

export interface GfxManifestEntry {
  /** Relative path (incl. category folder) under the export dir. */
  file: string
  /** Human-readable role description (the "what's in this PNG" metadata). */
  description: string
  format: 'lz2' | 'lz16'
  fileId: number
  bpp: 2 | 4
  sizeBytes: number
  rowCount?: number
  index0Transparent: boolean
  /** BG2/BG3 only: per-tile palette fidelity. Import decodes each tile against its
   *  own palette row via this (the swatch is a reference grid). */
  perTilePalette?: PerTilePalette
  /** Screens only: the PNG is just this tile-region of the file (e.g. the boot
   *  logo). Import maps edits back into the full file by these coords. */
  region?: TileRegion
  /** Region `.aseprite` only: per-palette-entry master-palette-blob byte-offset (`-1` =
   *  transparent/non-blob) — the import writes edited colors back to the blob. */
  paletteOffsets?: number[]
}

/** One reconstructed-metasprite PNG (the editable "meta" view of a sprite). The
 *  PNG is the assembled character (`width`×`height`) + an OBJ-palette swatch;
 *  import reads only the canvas region. `faithful` ones (under metasprite/) write
 *  edits back to the sprite sheets; previews (metasprite/preview/) are view-only. */
export interface MetaspriteManifestEntry {
  file: string
  spriteId: number
  faithful: boolean
  hasDynamicBody: boolean
  width: number
  height: number
}

/** One assembled world-map level-slot icon PNG (the editable "meta" view of the
 *  overworld's level markers). `world` + `name` re-render it on import; the tile
 *  pixels are shared across worlds (only the tint differs), so edits to any one
 *  propagate to all worlds (last write wins). */
export interface MapIconManifestEntry {
  file: string
  world: number
  name: 'marker' | 'castle'
  faithful: boolean
  width: number
  height: number
  /** Per-`.aseprite`-palette-entry master-palette-blob byte-offset (`-1` = transparent/
   *  non-blob) — the import writes edited colors back to the blob. Aseprite mode only. */
  paletteOffsets?: number[]
}

/** One assembled per-level ICON PNG (the unique overworld level-select picture).
 *  `world`+`slot` re-render it on import; pixels come from the cart bank-$53 chunky
 *  data, edits slice back to the `$53` `.bin` via saveRawChrEdit. */
export interface LevelIconManifestEntry {
  file: string
  world: number
  slot: number
  name: string
  faithful: boolean
  width: number
  height: number
  /** Per-`.aseprite`-palette-entry master-palette-blob byte-offset (`-1` = transparent/
   *  non-blob) — the import writes edited colors back to the blob. Aseprite mode only. */
  paletteOffsets?: number[]
}

/** One OVERWORLD MAP entry per world (the terrain Yoshi paths across). The displayed map is
 *  BG1 ⊕ BG2 ⊕ BG3 composited. The PNG is the composited view; the `.aseprite` (Aseprite
 *  mode) is a 2-LAYER tilemap (BG1+BG2, one shared tileset). `world` re-renders it on
 *  import; the BG1 layer's layout round-trips to `bg1FileId`, the BG2 layer's to
 *  `bg2FileId` (the `$7C`/`$7D`… LZ2 tilemap files) via saveGfxEdit. Map PIXELS edit via the
 *  shared screens/map char sheets, not here. */
export interface MapTerrainManifestEntry {
  file: string
  world: number
  bg1FileId: number
  bg2FileId: number
  width: number
  height: number
  /** Per shared-tileset-tile `(char,pal,prio)` key (index 0 = empty `-1`), in the embedded
   *  tileset's order. The import maps each cell/tile → its cart char + palette row from this
   *  (never re-deriving), so placement + pixel edits round-trip from the .aseprite alone.
   *  Aseprite mode only (the PNG view carries no editable tilemap). */
  tileKeys?: number[]
  /** Per-`.aseprite`-palette-entry master-palette-blob byte-offset (`-1` = transparent/
   *  non-blob) — the import writes edited colors back to the blob. Aseprite mode only. */
  paletteOffsets?: number[]
}

/** The shared decorative-GROUND layout (BG3, world-invariant). The `.aseprite` round-trips
 *  layout edits to the $7E LZ2 tilemap file via saveGfxEdit; the PNG is the view. Ground
 *  pixels edit via the M1TE2 overworld `.M1` (BG3 slot, which bundles the $56 char). */
export interface MapGroundManifestEntry {
  file: string
  fileId: number
  width: number
  height: number
  /** Per-tileset-tile `(char,pal,prio)` key (index 0 = `-1`), the file's tileset order —
   *  the import maps cells back from this without re-deriving. Aseprite mode only. */
  tileKeys?: number[]
  /** Per-`.aseprite`-palette-entry master-palette-blob byte-offset (`-1` = transparent/
   *  non-blob) — the import writes edited colors back to the blob. Aseprite mode only. */
  paletteOffsets?: number[]
}

/** The Raphael boss arena (Mode-7, the Bosses track). The `.aseprite` round-trips LAYOUT
 *  edits to the $BD LZ2 tilemap file via saveGfxEdit (1-byte cells = char indices); the PNG
 *  is the view. Char PIXELS edit via the YY-CHR track (advanced/raphael-chars-*). */
export interface BossArenaManifestEntry {
  file: string
  fileId: number
  width: number
  height: number
  /** Per-tileset-tile `(char<<3)|palRow` key (`raphaelTileKeys`; index 0 = `-1`) — the
   *  import maps cells back from this without re-deriving. Aseprite mode only. */
  tileKeys?: number[]
  /** Per-`.aseprite`-palette-entry master-palette-blob byte-offset (`-1` = non-blob) —
   *  the import writes edited colors back to the blob. Aseprite mode only. */
  paletteOffsets?: number[]
}

/** The assembled title "Yoshi's Island" logo (the editable "meta" view of the Mode-0
 *  BG logo) — a PNG, or a real Aseprite tilemap when exported as `.aseprite`.
 *  `faithful` ones slice edits back to the $1D char tiles. */
export interface TitleLogoManifestEntry {
  file: string
  faithful: boolean
  width: number
  height: number
  /** Per-tileset-tile `(char<<3)|palRow` key (`logoTileKeys`; index 0 = `-1`), the file's
   *  tileset order — the import maps cells/tiles back from this without re-deriving.
   *  Aseprite mode only. */
  tileKeys?: number[]
  /** Per-`.aseprite`-palette-entry master-palette-blob byte-offset (`-1` = transparent/
   *  non-blob) — the import writes edited colors back to the blob. Aseprite mode only. */
  paletteOffsets?: number[]
}

/** The assembled title floating-island (the editable "meta" view of the Mode-7
 *  island/sea) — a PNG, or a real Aseprite tilemap when exported as `.aseprite`.
 *  Edits slice back to file $B1's CPC char tiles. The `.aseprite` is a COMBINED
 *  tilemap: import applies pixel edits, cell repositions, AND added tiles together
 *  (assumes Manual tileset mode — see the import). A PNG is pixels-only. */
export interface TitleIslandManifestEntry {
  file: string
  faithful: boolean
  width: number
  height: number
  /** Per-tileset-tile $B1 char (`islandTileChars`; index 0 = `-1`), the file's tileset
   *  order — the import maps cells/tiles back from this without re-deriving. Aseprite mode. */
  tileKeys?: number[]
  /** Per-`.aseprite`-palette-entry master-palette-blob byte-offset (`-1` = transparent/
   *  non-blob) — the import writes edited colors back to the blob. Aseprite mode only. */
  paletteOffsets?: number[]
}

/** The title island SCENERY atlas PNG (the GSU-billboarded 3D decorations). Edits
 *  slice back to DATA_560000.bin (raw 4bpp low-nibble source) via saveRawChrEdit. */
export interface TitleSceneryManifestEntry {
  file: string
  width: number
  height: number
  /** Per-`.aseprite`-palette-entry master-palette-blob byte-offset (`-1` = transparent/
   *  non-blob) — the import writes edited colors back to the blob. Aseprite mode only. */
  paletteOffsets?: number[]
}

/** The storybook first scene laid out as it renders (the gm$05 cutscene's opening-page
 *  BG3 frame) — a PNG, or a real Aseprite tilemap when exported as `.aseprite`.
 *  `faithful` ones slice frame-tile edits back to the f27 char tiles via saveGfxEdit;
 *  the frame interior (BG1/BG2 illustration) is preview-only. */
export interface StorybookSceneManifestEntry {
  file: string
  faithful: boolean
  width: number
  height: number
  /** Per-`.aseprite`-palette-entry master-palette-blob byte-offset (`-1` = transparent/
   *  non-blob) — the import writes edited colors back to the blob. Aseprite mode only. */
  paletteOffsets?: number[]
}

/** One OVERWORLD M1TE2 `.M1` session — a world's full 64×32 screen (M1TE2 v2 supports a
 *  64-wide map). The file bundles slot 0 = BG1 ($7C-class) / slot 1 = BG2 ($7D-class) /
 *  slot 2 = BG3 ground ($7E) tilemaps + the shared $74/$75/$4C (4bpp) + $56 (2bpp) CHR +
 *  the per-world palette. `world` rebuilds the scene on import; CHR pixels round-trip to the
 *  char files, tilemap words to bg1/bg2/bg3FileId, palette to the master blob. */
export interface MapOverworldM1ManifestEntry {
  file: string
  world: number
  bg1FileId: number
  bg2FileId: number
  bg3FileId: number
}

/** The combined ICONS `.M1` — every per-level icon (6 worlds × 10 slots, level order) + the
 *  level MARKER + boss CASTLE shapes, in one synthesized grid (map slot 0). The import
 *  re-derives the whole layout from the cart deterministically, so the entry is just the
 *  path; per-level pixels slice back to bank-$53, marker/castle to the $74/$75 char. */
export interface MapIconsM1ManifestEntry {
  file: string
}

/** The world-map M1TE2 export section: the 12 overworld halves + the one combined icons
 *  file. Present only when the World Map track was exported in M1TE2 format. */
export interface MapM1Manifest {
  overworlds: MapOverworldM1ManifestEntry[]
  icons: MapIconsM1ManifestEntry | null
}

/** One system-screen M1TE2 `.M1` (the tilemap-based screens: title island, storybook first
 *  scene, and the six bonus-game screens). `kind` dispatches the import to the right
 *  slice-back: island → $B1 + DATA_5F9800; storybook-scene → f27 (pixels-only);
 *  bonus-game → the per-game BG1/BG2 + shared BG3 ($95) tilemap files + the scene char
 *  files (`game` re-derives the scene). The import re-derives everything from the cart, so
 *  the entry is just path + kind (+ game). (The title logo is excluded — Mode-0 BG2 renders
 *  with the wrong palette base in M1TE; edit it via PNG/Aseprite.) */
export interface ScreenM1ManifestEntry {
  file: string
  kind: 'island' | 'storybook-scene' | 'bonus-game' | 'bonus-backdrop'
  /** bonus-game only: game index 0-5. */
  game?: number
}

/** One 1bpp Bank09 sheet PNG (the message font / message-box pictures) — a raw
 *  `glyphW`×`glyphH` cell grid. Edits re-encode to 1bpp and slice back to the raw
 *  `binFile` via saveRawChrEdit (fixed incbin, no layout move). */
export interface FontSheetManifestEntry {
  file: string
  /** `assets/yi`-relative raw `.bin` the edits write back to. */
  binFile: string
  glyphW: number
  glyphH: number
  cols: number
  width: number
  height: number
}

/** One dynamic-sprite glyph PNG (a GSU-rasterized sprite's editable bank-$54
 *  glyph). `sharedWith` = other sprite nums that draw the same bytes. */
export interface GlyphManifestEntry {
  file: string
  spriteNum: number
  width: number
  height: number
  sharedWith: number[]
}

/** One YY-CHR raw-CHR sheet (gfx-yychr-io.ts): the exported file IS the decompressed
 *  blob (zero-padded to a YY-CHR bank), so import = truncate the pad + diff bytes —
 *  no pixel decode. `kind` routes the write-back: `chr` = a compressed lz2/lz16 blob
 *  (whole-file recordWholeBlob → saveGfxEdit), `raw` = an uncompressed `.bin`
 *  (changed byte-runs → saveRawChrEdit), `chunky` = a GSU bitmap bank exported
 *  through the bijective chunky↔planar transform (planarToChunky on import, then
 *  the same byte-run write-back as `raw`), `1bpp` = a font/picture `.bin` exported
 *  RE-TILED into 8×8-tile order (inverse: tiles → `cols`-wide sheet bitmap →
 *  `glyphW`×`glyphH` records, then the `raw` write-back). The `.pal`/`.col`
 *  sidecars next to the sheet are DISPLAY AIDS only — never imported. */
export interface YychrManifestEntry {
  file: string
  description: string
  kind: 'chr' | 'raw' | 'chunky' | '1bpp'
  /** chr only. */
  format?: 'lz2' | 'lz16'
  /** chr only. */
  fileId?: number
  /** raw/chunky only: `assets/yi`-relative `.bin` the edits write back to. */
  binFile?: string
  /** Native depth (display metadata; the bytes round-trip regardless). */
  bpp: 1 | 2 | 4 | 8
  /** True blob length — the export pads beyond it, the import truncates back. */
  sizeBytes: number
  /** lz16 tile-rows (`sizeBytes / 512`); undefined otherwise. */
  rowCount?: number
  /** Diff/record stride for `chr` entries (32/16/64 for 4/2/8 bpp). */
  tileBytes: number
  /** 1bpp only: the native record geometry (glyph size + sheet columns; `cols` 1 =
   *  a flat `glyphW`-px-wide bitmap) the re-tiled export inverts through. */
  glyphW?: number
  glyphH?: number
  cols?: number
  /** Verified unused: nothing in-game reads this sheet (leftover data), so edits
   *  round-trip but change no visuals. Producer-stamped (gfx-yychr-io
   *  `VERIFIED_UNUSED_LZ2`); the YY-CHR tab shows it as a badge. */
  unused?: boolean
}

/** A folder's gfx-manifest.json narrowed to its yychr view: the sheet rows + the
 *  checksum map their change-status gate reads. `readYychrManifest` returns it only
 *  when the manifest actually carries yychr rows. */
export interface YychrManifestFile {
  /** App version that wrote the export (absent on pre-stamp exports). */
  exportedBy?: string
  checksums?: GfxManifestChecksums
  yychr: YychrManifestEntry[]
}

/** Read `<dir>/gfx-manifest.json`'s yychr section, or null when the manifest is
 *  missing/unparsable or carries no yychr rows (a PNG-track-only folder). */
export function readYychrManifest(dir: string): YychrManifestFile | null {
  try {
    const parsed = JSON.parse(readFileSync(join(dir, MANIFEST), 'utf8')) as {
      exportedBy?: string
      checksums?: GfxManifestChecksums
      yychr?: YychrManifestEntry[] | null
    }
    if (!Array.isArray(parsed.yychr) || parsed.yychr.length === 0) return null
    return { exportedBy: parsed.exportedBy, checksums: parsed.checksums, yychr: parsed.yychr }
  } catch {
    return null
  }
}

/**
 * Merge `updates` (artifact path → sha256) into `<dir>/gfx-manifest.json`'s
 * `checksums` map, preserving every other key. The import write-back: after a
 * successful yychr import the file's stored checksum advances to its current
 * on-disk hash, so "changed" means "changed since export OR last import" instead
 * of sticking forever. Atomic tmp+rename; returns false when the manifest can't
 * be read or written (caller surfaces a warning, statuses just stay 'changed').
 */
export function updateManifestChecksums(dir: string, updates: Record<string, string>): boolean {
  if (Object.keys(updates).length === 0) return true
  const path = join(dir, MANIFEST)
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { checksums?: GfxManifestChecksums } & Record<string, unknown>
    parsed.checksums = { ...(parsed.checksums ?? {}), ...updates }
    const tmp = `${path}.tmp`
    writeFileSync(tmp, JSON.stringify(parsed, null, 2))
    renameSync(tmp, path)
    return true
  } catch {
    return false
  }
}
