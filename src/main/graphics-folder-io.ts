// Unified "import this folder" for the merged Graphics panel: auto-detect both the
// all-graphics PNG manifest AND any BG-region files in a folder, run both importers,
// and merge into one pre-formatted log. Either track may be absent.

import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { importGfxPngsFromDir, type ImportGfxResult as GfxImportCounts } from './gfx-png-import'
import { importBgRegionFromDir } from './bg-region-io'
import type { ImportGraphicsResult } from '../shared/ipc-types'

/** Flatten the all-graphics import counts into log lines + errors + a changed total. */
function gfxResultToLog(r: GfxImportCounts): { log: string[]; errors: string[]; changed: number } {
  const log: string[] = []
  const push = (n: number, label: string): void => { if (n > 0) log.push(`${n} ${label}${n === 1 ? '' : 's'} changed`) }
  push(r.imported, 'gfx file')
  push(r.spriteImported, 'metasprite')
  push(r.iconImported, 'map icon')
  push(r.levelIconImported, 'level icon')
  push(r.mapTerrainImported, 'overworld map')
  push(r.glyphImported, 'glyph')
  if (r.logoImported > 0) log.push('title logo changed')
  if (r.islandImported > 0) log.push(`title island changed${r.islandNewTiles > 0 ? ` (${r.islandNewTiles} new tile${r.islandNewTiles === 1 ? '' : 's'})` : ''}`)
  if (r.sceneryImported > 0) log.push('title scenery changed')
  if (r.skipped > 0 || r.imported > 0) log.push(`${r.skipped} unchanged`)

  const errors = [...r.errors]
  if (r.spritePropagated > 0) errors.push(`${r.spritePropagated} other sprite${r.spritePropagated === 1 ? '' : 's'} share edited tiles and also changed.`)
  if (r.glyphShared > 0) errors.push(`${r.glyphShared} other sprite${r.glyphShared === 1 ? '' : 's'} share an edited glyph.`)
  if (r.islandSharedCells > 0) errors.push(`Island tiles are shared — your edit also changed ${r.islandSharedCells} other island cell${r.islandSharedCells === 1 ? '' : 's'}.`)
  if (r.iconImported > 0) errors.push('Map-icon edits apply to all worlds (the marker/castle tiles are shared).')

  const changed = r.imported + r.spriteImported + r.iconImported +
    r.levelIconImported + r.mapTerrainImported + r.logoImported + r.islandImported + r.sceneryImported + r.glyphImported
  return { log, errors, changed }
}

/**
 * Import everything present in `dir`: the all-graphics PNG manifest
 * (`gfx-manifest.json`) and/or any BG-region files (`bg{1,2,3}-region.json`).
 * Runs whichever exist and merges into one log + error list + changed total.
 */
export async function importGraphicsFolder(dir: string): Promise<Exclude<ImportGraphicsResult, { canceled: true }>> {
  try {
    const hasGfx = existsSync(join(dir, 'gfx-manifest.json'))
    const hasRegion = readdirSync(dir).some((f) => /^bg[123]-region\.json$/.test(f))
    if (!hasGfx && !hasRegion) {
      return { ok: false, error: 'No graphics export found in that folder (no gfx-manifest.json or bg*-region.json).' }
    }

    const log: string[] = []
    const errors: string[] = []
    let changed = 0

    if (hasGfx) {
      try {
        const g = gfxResultToLog(await importGfxPngsFromDir(dir)) // throws on a missing/invalid manifest
        log.push('All graphics:', ...g.log.map((l) => `  ${l}`))
        errors.push(...g.errors)
        changed += g.changed
      } catch (e) {
        errors.push(`All graphics: ${e instanceof Error ? e.message : String(e)}`)
      }
    }

    if (hasRegion) {
      const r = await importBgRegionFromDir(dir)
      if (r.ok) {
        log.push('BG regions:', ...r.log.map((l) => `  ${l}`))
        errors.push(...r.errors)
        changed += r.applied + r.paletteChanged + r.repositioned
      } else {
        errors.push(`BG regions: ${r.error}`)
      }
    }

    return { ok: true, dir, changed, log, errors }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
