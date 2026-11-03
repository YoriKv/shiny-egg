// Which rooms use each sprite tileset row (header field 7) across the active
// project's SAVED levels, for the Graphics panel's Spritesets tab readout.
//
// A full sweep decodes ~220 levels (~1.4 s from WSL). So it runs in a worker
// thread (spriteset-usage.worker.ts; the main-process entry is
// spriteset-usage-client.ts), and each record's row is cached against the stat of
// the object file its header is read from (overlay copy first, else base; the
// header is the first bytes of that file). A call re-decodes only records whose
// file changed (a saved level), so after the first sweep it's ~220 stats. The
// cache is also dropped when level-map.json changes (a re-extract), since the
// map decides which file backs each record.
//
// Electron-free (fs + snes-framework only), so it runs in the worker and in
// node scripts.

import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  invalidateLevelMapCache,
  levelIdHexKey,
  levelMapEntry,
  loadLevel,
  loadLevelMapPublic,
  resolveLevelBinPath
} from 'snes-framework/level'
import { SPRITESET_COUNT } from 'snes-framework/spriteset-files'

/** Last record slot (the sentinel rows 0xDA/0xDB fall out at the special guard). */
const LAST_RECORD = 0xdb

/** record → { stamp of its object file, its row (null = not a regular level) } */
const cache = new Map<number, { stamp: string; row: number | null }>()
let levelMapStamp = ''

function fileStamp(file: string): string {
  try {
    const st = statSync(file)
    return `${file}:${st.mtimeMs}/${st.ctimeMs}/${st.size}`
  } catch {
    return `${file}:missing`
  }
}

/** The object file `loadLevel` reads a record's header from, or null when the
 *  record has none (an unbacked slot). Mirrors loadLevel's resolution: the
 *  level-map entry, else an overlay-only new slot (`DATA_level_XX_obj.bin`). */
function objectFilePath(workRoot: string, overlayRoot: string | undefined, rec: number): string | null {
  const entry = levelMapEntry(loadLevelMapPublic(workRoot).levels, rec)
  if (entry?.objectFile) return resolveLevelBinPath(workRoot, overlayRoot, entry.objectFile)
  if (entry || !overlayRoot) return null
  const hex = levelIdHexKey(rec).slice(2).toUpperCase()
  const synthetic = join(overlayRoot, 'assets', 'yi', 'LevelData', `DATA_level_${hex}_obj.bin`)
  return existsSync(synthetic) ? synthetic : null
}

/** `byRow[row]` = record ids (ascending) whose saved header selects `row`,
 *  excluding the project's `removed` records (a removed level isn't in the
 *  game, though its base bin still decodes). */
export function spritesetUsage(
  workRoot: string,
  overlayRoot: string | undefined,
  removed: ReadonlySet<number> = new Set()
): number[][] {
  const mapStamp = fileStamp(join(workRoot, 'editor-data', 'yi', 'level-map.json'))
  if (mapStamp !== levelMapStamp) {
    invalidateLevelMapCache()
    cache.clear()
    levelMapStamp = mapStamp
  }
  const byRow = Array.from({ length: SPRITESET_COUNT }, (): number[] => [])
  for (let rec = 0; rec <= LAST_RECORD; rec++) {
    if (removed.has(rec)) continue
    const file = objectFilePath(workRoot, overlayRoot, rec)
    const stamp = file ? fileStamp(file) : 'none'
    let hit = cache.get(rec)
    if (hit?.stamp !== stamp) {
      let row: number | null = null
      try {
        const level = loadLevel({ workRoot, levelRecordId: rec, overlayRoot })
        if (!level.empty && !level.special && level.header.length >= 15) row = level.header[7] ?? null
      } catch {
        row = null
      }
      hit = { stamp, row }
      cache.set(rec, hit)
    }
    if (hit.row !== null) byRow[hit.row]?.push(rec)
  }
  return byRow
}
