// Debug-only IPC: object/sprite instance finder. Returns every (level,
// position) where a given id appears.
//
// Data source = the base `editor-data/yi/instance-index.json` (regenerated at
// extract time by `snes-framework/scripts/instance-index.ts`), spliced with the
// active project's SAVED overlay edits (Approach A): for each level the project
// has an overlay `.bin` for, we drop that level's base rows and re-decode it
// through the overlay (~6 ms/level, cached by overlay signature). So the finder
// reflects on-disk saved edits — but NOT unsaved in-canvas edits, which would
// require serializing the live LevelData. See ObjectFinderBody in the renderer.

import { ipcMain } from 'electron'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { editorDataRoot, frameworkWorkRoot, overlayRoot } from '../framework-paths'
import { getCurrentProjectId } from '../projects'
import {
  buildInstanceIndexForRecords,
  instanceIndexKey,
  type InstanceIndex
} from 'snes-framework/instance-index'
import type { FindInstanceKind, ObjectInstance } from '../../shared/ipc-types'

const INDEX_FILE = 'instance-index.json'
const OVERLAY_LEVELDATA_REL = join('assets', 'yi', 'LevelData')
// Both obj + spr overlay files carry the record id in the name (level-map key).
const OVERLAY_BIN_RE = /^DATA_level_([0-9A-Fa-f]+)_(?:obj|spr)\.bin$/

// ── Base index (mtime-keyed cache) ───────────────────────────────────────────
// Re-read on mtime change so a re-extract (which rewrites the file) is picked up
// without a restart — mirrors the symbol-map loader's mtime cache.
let baseCache: { mtimeMs: number; index: InstanceIndex | null } | null = null
function readBaseIndex(): InstanceIndex | null {
  const p = join(editorDataRoot(), INDEX_FILE)
  let mtimeMs = -1
  if (existsSync(p)) {
    try { mtimeMs = statSync(p).mtimeMs } catch { mtimeMs = -1 }
  }
  if (baseCache && baseCache.mtimeMs === mtimeMs) return baseCache.index
  let index: InstanceIndex | null = null
  if (mtimeMs >= 0) {
    try { index = JSON.parse(readFileSync(p, 'utf8')) as InstanceIndex } catch { index = null }
  }
  baseCache = { mtimeMs, index }
  return index
}

// ── Active-project overlay override (Approach A: on-demand splice) ────────────
interface Override { records: Set<number>; index: InstanceIndex }
let overrideCache: { projectId: string; sig: string; override: Override } | null = null

/** Scan the active project's overlay LevelData dir → the overridden record ids +
 *  a signature. The signature folds in each file's mtime so a re-save (which
 *  overwrites the `.bin` in place) invalidates the cache — the dir's own mtime
 *  wouldn't change on an in-place overwrite. */
function scanOverlay(projectId: string): { sig: string; records: Set<number> } {
  const dir = join(overlayRoot(projectId), OVERLAY_LEVELDATA_REL)
  let files: string[]
  try { files = readdirSync(dir) } catch { return { sig: '', records: new Set() } }
  const records = new Set<number>()
  const parts: string[] = []
  for (const f of files.sort()) {
    const m = OVERLAY_BIN_RE.exec(f)
    if (!m) continue
    records.add(parseInt(m[1], 16))
    let mt = 0
    try { mt = statSync(join(dir, f)).mtimeMs } catch { mt = 0 }
    parts.push(`${f}:${mt}`)
  }
  return { sig: parts.join('|'), records }
}

/** Override mini-index for the active project's edited levels, or null when no
 *  project is active or its overlay has no level edits. The re-decode is cached
 *  by overlay signature, so a repeated query is free until the next save. */
function getOverride(): Override | null {
  const projectId = getCurrentProjectId()
  if (!projectId) return null
  const { sig, records } = scanOverlay(projectId)
  if (records.size === 0) return null
  if (overrideCache && overrideCache.projectId === projectId && overrideCache.sig === sig) {
    return overrideCache.override
  }
  const index = buildInstanceIndexForRecords(
    frameworkWorkRoot(),
    overlayRoot(projectId),
    records
  )
  const override: Override = { records, index }
  overrideCache = { projectId, sig, override }
  return override
}

function findInstances(kind: FindInstanceKind, idHex: string): ObjectInstance[] {
  const id = parseInt(idHex, 16)
  if (Number.isNaN(id)) return []
  const key = instanceIndexKey(id)

  // Base rows (don't mutate the cached array). Drop any whose level the project
  // has edited, then append that level's freshly-decoded rows.
  let tuples = readBaseIndex()?.[kind]?.[key] ?? []
  const override = getOverride()
  if (override) {
    tuples = tuples
      .filter(([recordId]) => !override.records.has(recordId))
      .concat(override.index[kind]?.[key] ?? [])
  }

  return tuples
    .map(([levelRecordId, x, y, offset]) => ({ levelRecordId, x, y, offset }))
    .sort((a, b) => a.levelRecordId - b.levelRecordId || a.offset - b.offset)
}

export function registerDebugIpc(): void {
  ipcMain.handle(
    'debug:findInstances',
    async (_e, kind: FindInstanceKind, idHex: string): Promise<ObjectInstance[]> =>
      findInstances(kind, idHex)
  )
}
