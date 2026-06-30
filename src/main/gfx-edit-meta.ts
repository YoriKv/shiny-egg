// Per-project store of "what each overlay-edited graphics file changed vs base" — the
// authoritative metadata the "Changed graphics" inventory reads instead of guessing.
//
// The editing PIPELINE (the importer / reconciler that performs the edit) knows what KIND of
// data a file holds (CHR pixels vs a tilemap vs raw bytes) and the diff stride; the
// `saveGfxEdit` / `saveRawChrEdit` chokepoint has both the new blob and the pristine base, so
// it computes the EXACT changed-unit count (gfx-import-conflict.ts `countChangedUnits`) and
// records it here, keyed by the overlay file's `assets/yi`-relative path (the same key
// `listGfxEdits` scans + `resetGfxEditFile` deletes). Stored as one project-overlay JSON
// (overlayRoot/gfx-edits.json), mirroring map16-edits.json. A reset removes the file's entry.
//
// Best-effort: a missing / corrupt store reads as empty, and recording is wrapped by the
// callers so a stamp failure never fails the underlying save. See
// research/graphics-editing/png-roundtrip.md.

import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs'
import path from 'node:path'
import { overlayRoot } from './framework-paths'
import { getCurrentProjectId } from './projects'
import type { GfxEditChange } from '../shared/ipc-types'

const META_FILE = 'gfx-edits.json'

/** `assets/yi`-relative overlay file path → its change vs base. */
type Store = Record<string, GfxEditChange>

const metaPath = (projectId: string): string => path.join(overlayRoot(projectId), META_FILE)

/** Keys are always forward-slash `assets/yi`-relative paths (the form `listGfxEdits` scans
 *  with), so a producer that built its path via `path.join` (`\` on Windows) still matches. */
const normKey = (relFile: string): string => relFile.replace(/\\/g, '/')

function read(projectId: string): Store {
  const p = metaPath(projectId)
  if (!existsSync(p)) return {}
  try {
    const parsed = JSON.parse(readFileSync(p, 'utf8')) as Store
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function write(projectId: string, store: Store): void {
  const p = metaPath(projectId)
  mkdirSync(path.dirname(p), { recursive: true })
  const tmp = `${p}.tmp`
  writeFileSync(tmp, JSON.stringify(store, null, 2))
  renameSync(tmp, p)
}

/** Record (or overwrite) one overlay file's change vs base. `relFile` is its `assets/yi`-
 *  relative path (e.g. `Graphics/GFX_5C0000.lz2`). No-op when there's no active project. */
export function recordGfxEditChange(relFile: string, change: GfxEditChange): void {
  const projectId = getCurrentProjectId()
  if (!projectId) return
  const store = read(projectId)
  store[normKey(relFile)] = change
  write(projectId, store)
}

/** Drop one overlay file's change entry (on a per-file reset-to-vanilla). */
export function removeGfxEditChange(relFile: string): void {
  const projectId = getCurrentProjectId()
  if (!projectId) return
  const store = read(projectId)
  const key = normKey(relFile)
  if (key in store) {
    delete store[key]
    write(projectId, store)
  }
}

/** The whole change store for the active project (empty when none). Read by `listGfxEdits`
 *  to attach each entry's `change`. */
export function readGfxEditChanges(): Store {
  const projectId = getCurrentProjectId()
  return projectId ? read(projectId) : {}
}
