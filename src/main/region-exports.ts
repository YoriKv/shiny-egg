// Per-project list of folders the BG-region exporter has written to, so the
// Graphics "Region" tab can list them with their own import / remove buttons
// (instead of re-picking a folder every time). Editor metadata — NOT a build
// input — so it lives in the project root, not the overlay tree. Mirrors the
// map16-edits / gfx-live-persist per-project JSON pattern.

import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs'
import path from 'node:path'
import { projectRoot } from './framework-paths'
import { getCurrentProjectId } from './projects'

const FILE = 'region-exports.json'
const filePath = (projectId: string): string => path.join(projectRoot(projectId), FILE)

function read(projectId: string): string[] {
  const p = filePath(projectId)
  if (!existsSync(p)) return []
  try {
    const v = JSON.parse(readFileSync(p, 'utf8'))
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

function write(projectId: string, folders: string[]): void {
  const p = filePath(projectId)
  mkdirSync(path.dirname(p), { recursive: true })
  const tmp = `${p}.tmp`
  writeFileSync(tmp, JSON.stringify(folders, null, 2))
  renameSync(tmp, p)
}

/** Folders this project has exported region(s) to, most-recent first. */
export function listRegionExportFolders(): string[] {
  const id = getCurrentProjectId()
  return id ? read(id) : []
}

/** Record `dir` as an export folder (de-duped, moved to the front). Returns the
 *  updated list. No-op (returns []) with no active project. */
export function addRegionExportFolder(dir: string): string[] {
  const id = getCurrentProjectId()
  if (!id) return []
  const next = [dir, ...read(id).filter((d) => d !== dir)]
  write(id, next)
  return next
}

/** Forget `dir` (does NOT delete the files on disk). Returns the updated list. */
export function removeRegionExportFolder(dir: string): string[] {
  const id = getCurrentProjectId()
  if (!id) return []
  const next = read(id).filter((d) => d !== dir)
  write(id, next)
  return next
}
