// Single registry of the inline-`dw` data-overlay editors (palette / island /
// gradient in Bank57.asm, logo in Bank0F.asm) plus the Node-free logic the
// overlay-drift subsystem and the region-coverage guard test share:
//
//   • compose*Overlay      — build an overlay = base ⊕ edits in the marker format
//                            (the shared core of the save path AND the migration).
//   • rebuild*Overlay      — migrate a pre-`;@editable`-marker overlay by reading
//                            its edits back and re-composing them.
//   • DATA_OVERLAY_EDITORS  — the registry: each editor's `file`, the `regions`
//                            that MUST wrap its edits, a `rebuild`, and a
//                            `sampleEdit` (a representative edit, for the guard).
//
// WHY a registry: the drift checker (overlay-merge.ts) only models `;@editable`
// regions, so an overlay edit OUTSIDE a region false-drifts and an "upgrade"
// silently wipes it. Every inline-`dw` editor must therefore (a) wrap its block in
// a region and (b) enrol here. `overlay-region-coverage.test.ts` drives each
// entry's `sampleEdit` and fails if any byte changes outside a region — turning
// that rule from a convention into a checked invariant for current AND future
// editors. New overlay editor? Add it here (or, for strings, to resources.ts
// `ASM_REGIONS`). Kept Electron-free so it's unit-testable; file I/O + project
// wiring stays in src/main/overlay-upgrade.ts and src/main/resources.ts.

import {
  applyPaletteEdits,
  readPaletteEdits,
  PALETTE_BLOB_BANK_FILE,
  PALETTE_BLOB_REGION,
  type PaletteEdit
} from './palette-edit.ts'
import {
  applyIslandTilemapEdits,
  readIslandTilemapEdits,
  ISLAND_TILEMAP_REGION,
  type IslandTilemapEdit
} from './island-tilemap.ts'
import {
  applyGradientEdits,
  readGradientEdits,
  gradientLabels,
  gradientOffset,
  GRADIENT_PTR_BANK_FILE,
  GRADIENT_REGION,
  type GradientEdit
} from './gradient-edit.ts'
import {
  applyLogoTilemapEdits,
  readLogoTilemapEdits,
  LOGO_TILEMAP_BANK_FILE,
  LOGO_TILEMAP_REGION,
  type LogoTilemapEdit
} from './logo-tilemap.ts'
import {
  applyWorldMapPathsEdits,
  readWorldMapPathsEdits,
  WORLD_MAP_PATHS_FILE,
  WORLD_MAP_YOSHI_DOTS_REGION,
  WORLD_MAP_WALK_PATHS_REGION
} from './world-map-paths.ts'
import { findRegion, spliceRegion } from './asm/markers.ts'

/** The intro-story string region shares Bank0F.asm with the logo data region. */
const INTRO_STORY_REGION = 'intro-story'

// ── Compose: base ⊕ edits → marker-format overlay (shared by save + migration) ─

/**
 * Compose a `Bank57.asm` overlay = base ⊕ palette ⊕ island ⊕ gradient edits.
 * The three edit sets touch disjoint `dw` runs (the palette blob — which physically
 * contains the gradient tables — vs the island tilemap) and are length-preserving,
 * so applying them in sequence composes cleanly. `labels` are the gradient-table
 * labels (`gradientLabels` of the base Bank01). Reborn from base, so the result is
 * always exactly base ⊕ the given edits.
 */
export function composeBank57Overlay(
  baseText: string,
  paletteEdits: readonly PaletteEdit[],
  islandEdits: readonly IslandTilemapEdit[],
  gradientEdits: readonly GradientEdit[],
  labels: readonly string[]
): string {
  let t = applyPaletteEdits(baseText, paletteEdits)
  t = applyIslandTilemapEdits(t, islandEdits)
  return applyGradientEdits(t, gradientEdits, labels)
}

/**
 * Compose a `Bank0F.asm` overlay = base ⊕ logo edits, carrying the intro-story
 * region body over from `priorOverlayText` (the current overlay, or null when
 * none) so a sibling string edit survives a base-first logo write.
 */
export function composeBank0FOverlay(
  baseText: string,
  logoEdits: readonly LogoTilemapEdit[],
  priorOverlayText: string | null
): string {
  let t = applyLogoTilemapEdits(baseText, logoEdits)
  if (priorOverlayText != null) {
    const introBase = findRegion(baseText, INTRO_STORY_REGION)?.inner
    const introPrior = findRegion(priorOverlayText, INTRO_STORY_REGION)?.inner
    if (introPrior != null && introBase != null && introPrior !== introBase) {
      t = spliceRegion(t, INTRO_STORY_REGION, introPrior)
    }
  }
  return t
}

// ── Migration rebuilds (pre-region overlay → marker format) ───────────────────

/**
 * Rebuild a (possibly marker-less) `Bank57.asm` overlay into the marker format by
 * reading its edits back and re-composing them. `gradientPtrText` is the base
 * `Bank01.asm`. The readers' `findRegionDataWords` fallback extracts edits from a
 * marker-less overlay. NOTE: `palette-blob` physically contains `bg-gradients`, so
 * `readPaletteEdits` also captures gradient words and `composeBank57Overlay`
 * re-writes the same bytes via the gradient pass — redundant but idempotent.
 */
export function rebuildBank57Overlay(
  baseText: string,
  overlayText: string,
  gradientPtrText: string
): string {
  const labels = gradientLabels(gradientPtrText)
  return composeBank57Overlay(
    baseText,
    readPaletteEdits(baseText, overlayText),
    readIslandTilemapEdits(baseText, overlayText),
    readGradientEdits(baseText, overlayText, labels),
    labels
  )
}

/** Rebuild a (possibly logo-marker-less) `Bank0F.asm` overlay, preserving its
 *  intro-story region. Mirrors the base-first `saveLogoTilemap`. */
export function rebuildBank0FOverlay(baseText: string, overlayText: string): string {
  return composeBank0FOverlay(baseText, readLogoTilemapEdits(baseText, overlayText), overlayText)
}

/** Rebuild a (possibly marker-less) `Bank17.asm` overlay = base ⊕ its Yoshi
 *  path-coordinate edits, in marker form. The readers' label-scan fallback
 *  extracts edits from a marker-less overlay. */
export function rebuildBank17Overlay(baseText: string, overlayText: string): string {
  return applyWorldMapPathsEdits(baseText, readWorldMapPathsEdits(baseText, overlayText))
}

// ── Representative edits (region-coverage guard) ──────────────────────────────
// Mirror the real editor apply paths (via the same compose*) so the guard
// exercises what production does.

function sampleBank57Edit(baseText: string, gradientPtrText: string): string {
  return composeBank57Overlay(
    baseText,
    [{ offset: 0, value: 0x1234 }, { offset: 4, value: 0x7abc }],
    [{ offset: 0, value: 0x11 }, { offset: 513, value: 0xee }],
    [{ offset: gradientOffset(0, 0), value: 0x0123 }, { offset: gradientOffset(2, 5), value: 0x4567 }],
    gradientLabels(gradientPtrText)
  )
}

function sampleBank0FEdit(baseText: string): string {
  return composeBank0FOverlay(baseText, [{ offset: 5, value: 0x4242 }, { offset: 447, value: 0x8307 }], null)
}

function sampleBank17Edit(baseText: string): string {
  return applyWorldMapPathsEdits(baseText, [
    { table: 'dots', offset: 0, value: 0x42 }, // W1 dot 1 X
    { table: 'dots', offset: 96 + 14, value: 0x88 }, // W1 dot 8 Y (y axis starts at byte 96)
    { table: 'walk', offset: 4, value: 0x60 }, // 1-1 checkpoint 2 X
    { table: 'walk', offset: 384 + 4, value: 0x90 } // 1-1 checkpoint 2 Y (y axis at byte 384)
  ])
}

// ── The registry ──────────────────────────────────────────────────────────────

export interface DataOverlayEditor {
  /** workRoot-relative `.asm` file this editor writes into the overlay. */
  file: string
  /** Region ids that MUST wrap this file's edits (drift checker + migration +
   *  the region-coverage guard all read this). */
  regions: string[]
  /** Rebuild a (possibly marker-less) overlay = base ⊕ its edits, in marker form.
   *  `readBase(rel)` returns a base `.asm` file's text (the editor reads its own
   *  file plus any extra inputs, e.g. the gradient pointer table). */
  rebuild: (overlayText: string, readBase: (rel: string) => string) => string
  /** Apply a representative non-trivial edit to base → edited text, for the
   *  region-coverage guard (`overlay-region-coverage.test.ts`). */
  sampleEdit: (readBase: (rel: string) => string) => string
}

export const DATA_OVERLAY_EDITORS: DataOverlayEditor[] = [
  {
    file: PALETTE_BLOB_BANK_FILE, // Bank57.asm — palette ⊃ gradients, plus island
    regions: [PALETTE_BLOB_REGION, ISLAND_TILEMAP_REGION, GRADIENT_REGION],
    rebuild: (over, readBase) =>
      rebuildBank57Overlay(readBase(PALETTE_BLOB_BANK_FILE), over, readBase(GRADIENT_PTR_BANK_FILE)),
    sampleEdit: (readBase) =>
      sampleBank57Edit(readBase(PALETTE_BLOB_BANK_FILE), readBase(GRADIENT_PTR_BANK_FILE))
  },
  {
    file: LOGO_TILEMAP_BANK_FILE, // Bank0F.asm — logo, beside the intro-story region
    regions: [LOGO_TILEMAP_REGION],
    rebuild: (over, readBase) => rebuildBank0FOverlay(readBase(LOGO_TILEMAP_BANK_FILE), over),
    sampleEdit: (readBase) => sampleBank0FEdit(readBase(LOGO_TILEMAP_BANK_FILE))
  },
  {
    file: WORLD_MAP_PATHS_FILE, // Bank17.asm — Yoshi dot + walk-checkpoint coord tables
    regions: [WORLD_MAP_YOSHI_DOTS_REGION, WORLD_MAP_WALK_PATHS_REGION],
    rebuild: (over, readBase) => rebuildBank17Overlay(readBase(WORLD_MAP_PATHS_FILE), over),
    sampleEdit: (readBase) => sampleBank17Edit(readBase(WORLD_MAP_PATHS_FILE))
  }
]
