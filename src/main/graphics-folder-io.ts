// Unified "import this folder" for the merged Graphics panel: auto-detect both the
// all-graphics PNG manifest AND any BG-region files in a folder, run both importers,
// and merge into one pre-formatted log. Either track may be absent.

import { existsSync, readdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import { importGfxPngsFromDir, type ImportGfxResult as GfxImportCounts } from './gfx-png-import'
import { importBgRegionFromDir } from './bg-region-io'
import { GfxImportReconciler } from './gfx-import-reconcile'
import { loadRomAndSymbols } from './render/rom-cache'
import type { ImportGraphicsResult } from '../shared/ipc-types'

/** Flatten the all-graphics import counts into log lines + errors + warnings + a changed
 *  total. Exported for the M1TE-Maps project import (m1te-maps-project.ts), which runs
 *  the same importer against the project's fixed m1te folder. */
export function gfxResultToLog(r: GfxImportCounts): { log: string[]; errors: string[]; warnings: string[]; changed: number; paletteChanged: number } {
  const log: string[] = []
  const push = (n: number, label: string): void => { if (n > 0) log.push(`${n} ${label}${n === 1 ? '' : 's'} changed`) }
  push(r.imported, 'gfx file')
  push(r.spriteImported, 'metasprite')
  push(r.iconImported, 'map icon')
  push(r.levelIconImported, 'level icon')
  push(r.mapTerrainImported, 'overworld map')
  push(r.glyphImported, 'glyph')
  push(r.fontImported, 'font/picture sheet')
  push(r.yychrImported, 'YY-CHR sheet')
  if (r.logoImported > 0) log.push('title logo changed')
  if (r.islandImported > 0) log.push(`title island changed${r.islandNewTiles > 0 ? ` (${r.islandNewTiles} new tile${r.islandNewTiles === 1 ? '' : 's'})` : ''}`)
  if (r.sceneryImported > 0) log.push('title scenery changed')
  if (r.sceneImported > 0) log.push('storybook scene changed')
  push(r.bonusImported, 'bonus-game screen')
  if (r.bossImported > 0) log.push('Raphael arena layout changed')
  push(r.paletteImported, 'screen palette color')
  if (r.skipped > 0 || r.imported > 0) log.push(`${r.skipped} unchanged`)

  const errors = [...r.errors]
  // The import succeeded; these note that an edit reached data SHARED with other
  // sprites / levels / worlds, so the change has wider reach than the user picked.
  // They're advisories, not failures — keep them out of `errors` so they render
  // amber (warning), not red. See the renderer's two log channels in GraphicsPanel.
  // Seeded with the importer's own advisories (newer-export stamp, off-palette paint).
  const warnings: string[] = [...r.warnings]
  if (r.yychrPadEdited > 0) warnings.push(`${r.yychrPadEdited} YY-CHR sheet${r.yychrPadEdited === 1 ? '' : 's'} had edits past the sheet's end (bank padding) — those pixels were ignored.`)
  if (r.spritePropagated > 0) warnings.push(`${r.spritePropagated} other sprite${r.spritePropagated === 1 ? '' : 's'} share edited tiles and also changed.`)
  if (r.glyphShared > 0) warnings.push(`${r.glyphShared} other sprite${r.glyphShared === 1 ? '' : 's'} share an edited glyph.`)
  if (r.islandSharedCells > 0) warnings.push(`Island tiles are shared — your edit also changed ${r.islandSharedCells} other island cell${r.islandSharedCells === 1 ? '' : 's'}.`)
  if (r.iconImported > 0) warnings.push('Map-icon edits apply to all worlds (the marker/castle tiles are shared).')
  if (r.paletteImported > 0) warnings.push('Screen-palette color edits write to the shared master palette blob — a color also used by another screen or level changes there too.')

  const changed = r.imported + r.spriteImported + r.iconImported +
    r.levelIconImported + r.mapTerrainImported + r.logoImported + r.islandImported + r.sceneryImported + r.sceneImported + r.bonusImported + r.bossImported + r.glyphImported + r.fontImported + r.yychrImported + r.paletteImported
  return { log, errors, warnings, changed, paletteChanged: r.paletteImported }
}

/**
 * Import everything present in `dir`: every all-graphics PNG manifest (`gfx-manifest.json`)
 * AND any BG-region files (`bg{1,2,3}-region.json`). An export folder holds one export type
 * per SUBFOLDER (each with its own manifest), so this scans the dir AND its immediate
 * subfolders for manifests and imports them all; a legacy/flat export (or a directly-picked
 * subfolder) with the manifest at the dir root still works. Merges into one log + error list
 * + changed total.
 */
export async function importGraphicsFolder(dir: string): Promise<Exclude<ImportGraphicsResult, { canceled: true }>> {
  try {
    let rootEntries: string[]
    try { rootEntries = readdirSync(dir).sort() } catch { rootEntries = [] }
    // Every folder carrying a gfx-manifest: the dir itself (flat/legacy export, or a
    // directly-picked subfolder) plus each immediate subfolder (the per-type export folders).
    const gfxDirs: string[] = []
    if (existsSync(join(dir, 'gfx-manifest.json'))) gfxDirs.push(dir)
    for (const name of rootEntries) {
      const sub = join(dir, name)
      if (existsSync(join(sub, 'gfx-manifest.json'))) gfxDirs.push(sub)
    }
    const hasRegion = rootEntries.some((f) => /^bg[123]-region\.json$/.test(f) || /^bg[123]-region.*\.m1\.json$/.test(f))
    if (gfxDirs.length === 0 && !hasRegion) {
      return { ok: false, error: 'No graphics export found in that folder (no gfx-manifest.json in it or its subfolders, and no bg*-region.json / .M1).' }
    }

    const log: string[] = []
    const errors: string[] = []
    const warnings: string[] = []
    let changed = 0
    let paletteChanged = 0
    let repositioned = 0

    // ONE reconciler for the whole folder: both importers RECORD their CHR/palette/raw edits
    // into it (tagged by source file), then a single apply() resolves cross-file conflicts and
    // writes once — so an edit shared by a screen `.aseprite` AND a BG region reconciles together
    // (gfx-import-reconcile.ts). Direct tilemap-word/screen-placement saves (single-owner) still
    // happen inside the importers.
    const reconciler = new GfxImportReconciler()

    for (const gfxDir of gfxDirs) {
      // Label each by its subfolder (e.g. "All graphics (map)"); the dir itself is unlabelled.
      const label = gfxDir === dir ? 'All graphics:' : `All graphics (${basename(gfxDir)}):`
      try {
        const g = gfxResultToLog(await importGfxPngsFromDir(gfxDir, reconciler)) // throws on a missing/invalid manifest
        log.push(label, ...g.log.map((l) => `  ${l}`))
        errors.push(...g.errors)
        warnings.push(...g.warnings)
        changed += g.changed
      } catch (e) {
        errors.push(`${label} ${e instanceof Error ? e.message : String(e)}`)
      }
    }

    if (hasRegion) {
      const r = await importBgRegionFromDir(dir, reconciler)
      if (r.ok) {
        log.push('BG regions:', ...r.log.map((l) => `  ${l}`))
        errors.push(...r.errors)
        warnings.push(...r.warnings)
        changed += r.regions + r.repositioned
        repositioned += r.repositioned
      } else {
        errors.push(`BG regions: ${r.error}`)
      }
    }

    // Resolve + write everything once. Conflicts (two changed files disagree on a tile/color)
    // are skipped and surfaced as errors (red); the rest is applied.
    const { rom, symbols } = loadRomAndSymbols()
    const applyRes = await reconciler.apply(rom, symbols)
    paletteChanged += applyRes.paletteChanged
    changed += applyRes.applied + applyRes.paletteChanged + applyRes.rawApplied + repositioned
    if (applyRes.applied + applyRes.paletteChanged + applyRes.rawApplied > 0) {
      log.push(`Saved ${applyRes.applied} gfx file${applyRes.applied === 1 ? '' : 's'}, ${applyRes.paletteChanged} palette color${applyRes.paletteChanged === 1 ? '' : 's'}, ${applyRes.rawApplied} raw sheet${applyRes.rawApplied === 1 ? '' : 's'}.`)
    }
    if (applyRes.conflicts.length > 0) {
      errors.push(`${applyRes.conflicts.length} edit${applyRes.conflicts.length === 1 ? '' : 's'} skipped — two files changed the same data differently:`, ...applyRes.conflicts.map((c) => `  ${c}`))
    }

    return { ok: true, dir, changed, paletteChanged, log, errors, warnings }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
