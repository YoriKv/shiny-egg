// Pure, Electron-free core of the auto-backup system (src/main/backup.ts wires
// it to the app's paths + timer). Kept separate so it's node-runnable and
// testable without booting Electron — see backup-core.test.ts.

import { readFile, readdir, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { zipSync, type Zippable } from 'fflate'

// Top-level project subdirectories excluded from backups: regenerable caches
// (large, rebuilt on demand). Excluding them from both the archive AND the
// change signature means a build alone never triggers a backup — only edits to
// files the user can't regenerate (overlay/, project.json, patches) do.
export const EXCLUDED_TOP_LEVEL = new Set(['build', 'build-tree'])

export interface BackedFile {
  /** POSIX-style path within the project folder (also the archive key sans id prefix). */
  rel: string
  abs: string
  size: number
  mtimeMs: number
}

/**
 * Walk a project folder into a path-sorted file list, skipping the excluded
 * top-level caches. Sorted so the {@link signature} is independent of readdir
 * order.
 */
export async function collectFiles(root: string): Promise<BackedFile[]> {
  const out: BackedFile[] = []
  const walk = async (dir: string, prefix: string): Promise<void> => {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      if (prefix === '' && EXCLUDED_TOP_LEVEL.has(e.name)) continue
      const rel = prefix ? `${prefix}/${e.name}` : e.name
      const abs = join(dir, e.name)
      if (e.isDirectory()) await walk(abs, rel)
      else if (e.isFile()) {
        const st = await stat(abs)
        out.push({ rel, abs, size: st.size, mtimeMs: st.mtimeMs })
      }
    }
  }
  await walk(root, '')
  out.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))
  return out
}

/**
 * Cheap change signature over a file list: relative path + size + mtime of every
 * file, hashed. Detects edits, adds, and deletes without reading file contents,
 * so a periodic check is nearly free.
 */
export function signature(files: BackedFile[]): string {
  const h = createHash('sha1')
  for (const f of files) h.update(`${f.rel}\0${f.size}\0${f.mtimeMs}\n`)
  return h.digest('hex')
}

/**
 * Read the listed files and build a .zip. Every entry is prefixed with `id/` so
 * the archive extracts into a self-contained `<id>/` folder rather than spilling
 * loose files. Returns the raw zip bytes (caller writes them).
 */
export async function buildProjectZip(id: string, files: BackedFile[]): Promise<Uint8Array> {
  const zippable: Zippable = {}
  for (const f of files) {
    const data = await readFile(f.abs)
    zippable[`${id}/${f.rel}`] = [new Uint8Array(data), { mtime: new Date(f.mtimeMs) }]
  }
  return zipSync(zippable, { level: 6 })
}

// How many backups to retain per project; older ones are pruned after each new
// backup so the folder can't grow without bound.
export const MAX_BACKUPS_PER_PROJECT = 30

/**
 * Given the filenames in a project's backup dir, return which to delete to keep
 * only the newest `keep`. Names are our `YYYY-MM-DD_HH-MM-SS[.…]` stamps, which
 * sort chronologically, so ascending order is oldest-first and we drop the
 * oldest excess. Non-`.zip` names (e.g. a transient `.zip.tmp`) are ignored.
 */
export function backupsToPrune(names: string[], keep: number): string[] {
  const zips = names.filter((n) => n.endsWith('.zip')).sort()
  const excess = zips.length - keep
  return excess > 0 ? zips.slice(0, excess) : []
}

/** Filesystem-safe local-time stamp for backup filenames: `YYYY-MM-DD_HH-MM-SS`. */
export function stamp(now: Date = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return (
    `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}` +
    `_${p(now.getHours())}-${p(now.getMinutes())}-${p(now.getSeconds())}`
  )
}
