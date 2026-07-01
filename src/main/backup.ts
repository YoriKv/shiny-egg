// Automatic timestamped project backups.
//
// Every BACKUP_INTERVAL_MS, if the CURRENT project's files have changed since
// its last backup, we write a timestamped .zip of that project folder into a
// backups root that is a SIBLING of projects/ (never inside it — see
// backupsRoot()). No UI: this is a silent safety net that runs for the lifetime
// of the app process.
//
// The pure work — file walk, change signature, zip building — lives in
// backup-core.ts (Electron-free + tested). This module wires it to the app's
// paths, persists the per-project last-backed-up signature (STATE_FILE) so an
// unchanged project isn't re-archived across restarts, and drives the timer.

import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { backupsRoot, projectRoot } from './framework-paths'
import { getCurrentProjectId } from './projects'
import {
  buildProjectZip,
  backupsToPrune,
  collectFiles,
  MAX_BACKUPS_PER_PROJECT,
  signature,
  stamp
} from './backup-core'

export const BACKUP_INTERVAL_MS = 10 * 60 * 1000 // 10 minutes

// Upper bound on how long a best-effort on-quit backup may delay the app exit.
// The write is small (build/ is excluded) so this is never normally approached —
// it's insurance so a wedged filesystem (network drive, AV lock) can't trap the
// app with no window open.
const QUIT_TIMEOUT_MS = 10_000

// Per-project last-backed-up signature file (in backupsRoot). Persisted so an
// unchanged project isn't re-archived across app restarts.
const STATE_FILE = '.backup-state.json'

let timer: NodeJS.Timeout | null = null
let running = false

/** Begin the background backup loop (idempotent). The timer is unref'd so it
 *  never keeps the app alive on its own. */
export function startAutoBackup(): void {
  if (timer) return
  timer = setInterval(() => void tick(), BACKUP_INTERVAL_MS)
  timer.unref?.()
}

/** Stop the background backup loop (used on quit). */
export function stopAutoBackup(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

/**
 * Best-effort final backup on app quit. Resolves when the backup finishes OR
 * {@link QUIT_TIMEOUT_MS} elapses — whichever first — so the caller can always
 * proceed to quit. Never rejects. The `before-quit` handler awaits this (via
 * preventDefault + re-quit) so a short session's last changes are still captured
 * even if no 10-minute tick fired.
 */
export async function backupOnQuit(): Promise<void> {
  const backup = backupCurrentProjectIfChanged().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[backup] quit backup failed:', err)
    return null
  })
  const timeout = new Promise<void>((r) => setTimeout(r, QUIT_TIMEOUT_MS))
  await Promise.race([backup, timeout])
}

// One tick: back up the current project if it changed. A backup failure must
// never crash the app or stop future ticks, so everything is caught here. The
// `running` guard skips a tick that lands while a slow prior backup is still in
// flight (can't happen at the current sizes, but cheap insurance).
async function tick(): Promise<void> {
  if (running) return
  running = true
  try {
    await backupCurrentProjectIfChanged()
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[backup] tick failed:', err)
  } finally {
    running = false
  }
}

/**
 * Archive the current project if its files differ from its last backup. Returns
 * the written .zip path, or null when there's nothing to do (no current project,
 * folder missing/empty, or unchanged since the last backup).
 */
export async function backupCurrentProjectIfChanged(): Promise<string | null> {
  const id = getCurrentProjectId()
  if (!id) return null
  const root = projectRoot(id)
  if (!existsSync(root)) return null

  const files = await collectFiles(root)
  if (files.length === 0) return null

  const sig = signature(files)
  const state = await readState()
  if (state[id] === sig) return null // unchanged since last backup

  const bytes = await buildProjectZip(id, files)
  const zipPath = await writeZip(id, bytes)
  state[id] = sig
  await writeState(state)
  // eslint-disable-next-line no-console
  console.log(`[backup] ${id} → ${zipPath}`)
  return zipPath
}

// Write the archive bytes to backups/<id>/<stamp>.zip, guarding a same-second
// name collision. Written atomically (tmp + rename) so an interrupted quit can
// never leave a truncated, corrupt-looking .zip in the backups folder.
async function writeZip(id: string, bytes: Uint8Array): Promise<string> {
  const dir = join(backupsRoot(), id)
  await mkdir(dir, { recursive: true })
  const base = stamp()
  let target = join(dir, `${base}.zip`)
  for (let n = 2; existsSync(target); n++) target = join(dir, `${base}-${n}.zip`)
  const tmp = `${target}.tmp`
  await writeFile(tmp, bytes)
  await rename(tmp, target)
  await pruneOldBackups(dir)
  return target
}

// Keep only the newest MAX_BACKUPS_PER_PROJECT archives in a project's backup
// dir. Best-effort: a locked/undeletable old backup must not fail the new one
// (which is already safely written by the time we prune).
async function pruneOldBackups(dir: string): Promise<void> {
  try {
    const stale = backupsToPrune(await readdir(dir), MAX_BACKUPS_PER_PROJECT)
    for (const name of stale) await rm(join(dir, name), { force: true })
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[backup] prune failed:', err)
  }
}

async function readState(): Promise<Record<string, string>> {
  const p = join(backupsRoot(), STATE_FILE)
  if (!existsSync(p)) return {}
  try {
    const parsed = JSON.parse(await readFile(p, 'utf8')) as unknown
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {}
  } catch {
    return {} // corrupt state → treat as "never backed up" (a redundant backup is harmless)
  }
}

async function writeState(state: Record<string, string>): Promise<void> {
  await mkdir(backupsRoot(), { recursive: true })
  await writeFile(join(backupsRoot(), STATE_FILE), JSON.stringify(state, null, 2), 'utf8')
}
