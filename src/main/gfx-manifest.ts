// Shared manifest contract for the Graphics export/import (gfx-manifest.json). The
// export side (gfx-png-export.ts) WRITES these entries; the import side
// (gfx-png-import.ts) READS them back — they're the on-disk format both agree on,
// so they live here, owned by neither direction.

import { type PerTilePalette } from 'snes-framework/render-gfx-files'
import { type TileRegion } from 'snes-framework/screen-gfx'

/** The manifest filename at the export-dir root. */
export const MANIFEST = 'gfx-manifest.json'

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
}

/** One per-world×half OVERWORLD MAP (the terrain Yoshi paths across). The PNG is the
 *  composited view; the `.aseprite` is the editable LAYOUT tilemap. `world`+`half`
 *  re-render it on import; layout edits (the `.aseprite`) round-trip to the `$7C`/`$7D`…
 *  LZ2 tilemap file (`fileId`) via saveGfxEdit. Map PIXELS edit via the shared
 *  screens/map char sheets, not here. */
export interface MapTerrainManifestEntry {
  file: string
  world: number
  half: 0 | 1
  fileId: number
  width: number
  height: number
}

/** The shared decorative-GROUND layout (BG3, world-invariant). The `.aseprite` round-trips
 *  layout edits to the $7E LZ2 tilemap file via saveGfxEdit; the PNG is the view. Ground
 *  pixels edit via the screens/map/common/f56 char sheet. */
export interface MapGroundManifestEntry {
  file: string
  fileId: number
  width: number
  height: number
}

/** The assembled title "Yoshi's Island" logo (the editable "meta" view of the Mode-0
 *  BG logo) — a PNG, or a real Aseprite tilemap when exported as `.aseprite`.
 *  `faithful` ones slice edits back to the $1D char tiles. */
export interface TitleLogoManifestEntry {
  file: string
  faithful: boolean
  width: number
  height: number
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
}

/** The title island SCENERY atlas PNG (the GSU-billboarded 3D decorations). Edits
 *  slice back to DATA_560000.bin (raw 4bpp low-nibble source) via saveRawChrEdit. */
export interface TitleSceneryManifestEntry {
  file: string
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
