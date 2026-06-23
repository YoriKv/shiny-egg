// Persist the in-memory gfx live-edit cache (gfx-live-cache.ts) per project, so the
// canvas ALWAYS previews saved gfx edits — even after the app is reopened — without
// a rebuild. The live cache is otherwise in-memory only and cleared on project
// switch, so before this a reopened project showed the old built ROM until you
// rebuilt. With the cache restored on open, the editor's gfx visuals are never out
// of date — which (together with the palette draft previewing live) is why there's
// no "visuals out of date" banner anymore; Test Level / Launch rebuild before booting.
//
// The decompressed tiles are stored base64 in the PROJECT root (not the overlay —
// that's walked by `projectModifiedFiles` and copied into the build tree; this is a
// preview convenience, not a build input). Best-effort: a failure to read/write it
// only costs the live preview after reopen, never an edit or a build (the compressed
// overlay blob remains the source of truth).

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { projectRoot } from './framework-paths'
import { gfxLiveEdits, setGfxLiveEdit } from './gfx-live-cache'

const CACHE_FILE = '.gfx-live-cache.json'

const cachePath = (projectId: string): string => join(projectRoot(projectId), CACHE_FILE)

/** Write the current in-memory live cache to the project (called after every gfx
 *  edit/reset). Removes the file when the cache is empty. */
export function persistGfxLiveCache(projectId: string | null): void {
  if (!projectId) return
  const file = cachePath(projectId)
  try {
    const obj: Record<string, string> = {}
    for (const [key, tiles] of gfxLiveEdits()) obj[key] = Buffer.from(tiles).toString('base64')
    if (Object.keys(obj).length === 0) {
      rmSync(file, { force: true })
      return
    }
    mkdirSync(projectRoot(projectId), { recursive: true })
    writeFileSync(file, JSON.stringify(obj))
  } catch (e) {
    console.error('persistGfxLiveCache failed:', e)
  }
}

/** Restore a project's persisted live cache into the in-memory cache (on open). */
export function restoreGfxLiveCache(projectId: string): void {
  const file = cachePath(projectId)
  if (!existsSync(file)) return
  try {
    const obj = JSON.parse(readFileSync(file, 'utf8')) as Record<string, string>
    for (const [key, b64] of Object.entries(obj)) {
      const slash = key.indexOf('/')
      const format = key.slice(0, slash)
      const fileId = Number(key.slice(slash + 1))
      if ((format !== 'lz2' && format !== 'lz16') || !Number.isFinite(fileId)) continue
      setGfxLiveEdit(format, fileId, new Uint8Array(Buffer.from(b64, 'base64')))
    }
  } catch (e) {
    console.error('restoreGfxLiveCache failed:', e)
  }
}
