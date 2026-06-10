// Per-project registry + lifecycle. A project is a folder under
// userData/projects/<id> holding `project.json` + a sparse `overlay/` of
// changed files. The folder name IS the id and the display name; rename moves
// the folder (hence the filesystem-safe name rule). A Windows directory rename
// can fail with EPERM when the folder is held open elsewhere (e.g. the "Open
// folder" Explorer window) — that case is surfaced as a friendly error.
//
// This is build-step 1 of research/plan-project-storage.md: scaffolding +
// the current-project pointer (persisted in settings). Overlay load/save and
// the build-tree merge land in later steps.

import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import { readExtractionState } from 'snes-framework/state'
import { hex0x } from 'snes-framework/hex'
import {
  frameworkWorkRoot,
  overlayRoot,
  projectRoot,
  projectsRoot
} from './framework-paths'
import { getSettings, updateSettings } from './settings'
import type { ProjectInfo, ProjectSummary, RelocationState } from '../shared/ipc-types'

const PROJECT_JSON = 'project.json'
const DEFAULT_NAME_BASE = 'new-shiny'

// Windows reserved device names — invalid as folder names on that platform.
const RESERVED_NAMES = new Set([
  'con', 'prn', 'aux', 'nul',
  ...Array.from({ length: 9 }, (_, i) => `com${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `lpt${i + 1}`)
])

/**
 * Project-name rule: lowercase ASCII letters/digits with `-`/`_` separators,
 * must start alphanumeric, 1–64 chars, no Windows reserved names. This is the
 * safe intersection across Windows/macOS/Linux filesystems (no spaces, no
 * `< > : " / \ | ? *`, no dots/trailing-space pitfalls).
 */
export function isValidProjectName(name: string): boolean {
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(name)) return false
  return !RESERVED_NAMES.has(name)
}

function readProjectFile(id: string): ProjectSummary | null {
  const p = join(projectRoot(id), PROJECT_JSON)
  if (!existsSync(p)) return null
  try {
    const parsed = JSON.parse(readFileSync(p, 'utf8')) as Partial<ProjectSummary>
    if (!parsed.id) return null
    const createdAt = parsed.createdAt ?? new Date().toISOString()
    return {
      id: parsed.id,
      name: parsed.name ?? parsed.id,
      createdAt,
      modifiedAt: parsed.modifiedAt ?? createdAt,
      ...(parsed.romVersion ? { romVersion: parsed.romVersion } : {}),
      ...(parsed.cartMd5 ? { cartMd5: parsed.cartMd5 } : {}),
      ...(Array.isArray(parsed.relocations) ? { relocations: parsed.relocations } : {}),
      ...(Array.isArray(parsed.decoupled) ? { decoupled: parsed.decoupled } : {})
    }
  } catch {
    return null
  }
}

// ── Free-space migration / de-couple state ──────────────────────────────────
// Persisted per project (project.json). Stored as hex level ids ("0x7D"); the
// engine parses them to numbers at the build/report boundary.

const relocHex = (n: number): string => hex0x(n, 2)

/** Parse a stored hex-id list to numbers (drops malformed entries). */
export function parseHexIds(arr: string[] | undefined): number[] {
  return (arr ?? []).map((s) => Number(s)).filter((n) => Number.isInteger(n) && n >= 0)
}

/** The active project's migrated level record ids (numbers). */
export function getProjectRelocations(id: string | null): number[] {
  return id ? parseHexIds(readProjectFile(id)?.relocations) : []
}

/** The active project's de-coupled level record ids (numbers). */
export function getProjectDecoupled(id: string | null): number[] {
  return id ? parseHexIds(readProjectFile(id)?.decoupled) : []
}

/** Both lists, for the renderer. */
export function getRelocationState(id: string | null): RelocationState {
  const pf = id ? readProjectFile(id) : null
  return { relocations: pf?.relocations ?? [], decoupled: pf?.decoupled ?? [] }
}

function setHexFlag(list: string[] | undefined, levelRecordId: number, on: boolean): string[] {
  const set = new Set((list ?? []).map((s) => relocHex(Number(s))).filter((s) => s !== '0xNaN'))
  const key = relocHex(levelRecordId)
  if (on) set.add(key)
  else set.delete(key)
  return [...set].sort()
}

/** Toggle a level's free-space migration; returns the updated state. */
export function setLevelRelocation(id: string, levelRecordId: number, relocated: boolean): RelocationState {
  const pf = readProjectFile(id)
  if (!pf) throw new Error(`Project "${id}" not found.`)
  const relocations = setHexFlag(pf.relocations, levelRecordId, relocated)
  writeProjectFile({ ...pf, relocations, modifiedAt: new Date().toISOString() })
  return { relocations, decoupled: pf.decoupled ?? [] }
}

/** Toggle a biased level's de-couple; returns the updated state. */
export function setLevelDecoupled(id: string, levelRecordId: number, decoupled: boolean): RelocationState {
  const pf = readProjectFile(id)
  if (!pf) throw new Error(`Project "${id}" not found.`)
  const next = setHexFlag(pf.decoupled, levelRecordId, decoupled)
  writeProjectFile({ ...pf, decoupled: next, modifiedAt: new Date().toISOString() })
  return { relocations: pf.relocations ?? [], decoupled: next }
}

function writeProjectFile(p: ProjectSummary): void {
  writeFileSync(
    join(projectRoot(p.id), PROJECT_JSON),
    JSON.stringify(p, null, 2),
    'utf8'
  )
}

function projectExists(id: string): boolean {
  return existsSync(join(projectRoot(id), PROJECT_JSON))
}

/** First free `new-shiny-NN` (00, 01, …; padded to 2 digits, grows past 99). */
function nextDefaultName(): string {
  for (let i = 0; ; i++) {
    const name = `${DEFAULT_NAME_BASE}-${String(i).padStart(2, '0')}`
    if (!projectExists(name)) return name
  }
}

export function listProjects(): ProjectSummary[] {
  const root = projectsRoot()
  if (!existsSync(root)) return []
  const out: ProjectSummary[] = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const pf = readProjectFile(entry.name)
    if (pf) out.push(pf)
  }
  // Most-recently-modified first.
  out.sort((a, b) => (a.modifiedAt < b.modifiedAt ? 1 : -1))
  return out
}

export function getCurrentProjectId(): string | null {
  return getSettings().lastProjectId ?? null
}

export function setCurrentProject(id: string): ProjectSummary | null {
  const pf = readProjectFile(id)
  if (!pf) return null
  updateSettings({ lastProjectId: id })
  return pf
}

/**
 * Create a project. With no name, auto-generates the next `new-shiny-NN`.
 * Always becomes the current project. Throws on an invalid/taken name.
 */
export function createProject(name?: string): ProjectSummary {
  const id = name ?? nextDefaultName()
  if (!isValidProjectName(id)) {
    throw new Error(`Invalid project name "${id}".`)
  }
  if (projectExists(id)) {
    throw new Error(`A project named "${id}" already exists.`)
  }
  mkdirSync(overlayRoot(id), { recursive: true }) // also creates projectRoot(id)
  const now = new Date().toISOString()
  // Bind to whatever cart is currently extracted (undefined if none yet —
  // bound lazily on first save by ensureProjectBaseCompatible).
  const state = readExtractionState(frameworkWorkRoot())
  const pf: ProjectSummary = {
    id,
    name: id,
    createdAt: now,
    modifiedAt: now,
    ...(state
      ? { romVersion: state.romVersion, cartMd5: state.sourceCartMd5 }
      : {})
  }
  writeProjectFile(pf)
  updateSettings({ lastProjectId: id })
  return pf
}

/**
 * Duplicate a project into a `<id>-backup-<date>` restore point the user can
 * switch back to from the project menu. Copies the overlay + project.json +
 * patches, but skips the regenerable `build-tree/`. Does NOT change the current
 * project. Used as the "back up first" step of the outdated-overlay upgrade.
 */
export function backupProject(id: string): ProjectSummary {
  const src = readProjectFile(id)
  if (!src) throw new Error(`Project "${id}" not found.`)
  const date = new Date().toISOString().slice(0, 10) // YYYY-MM-DD (filesystem-safe)
  let backupId = `${id}-backup-${date}`
  for (let n = 2; projectExists(backupId); n++) backupId = `${id}-backup-${date}-${n}`

  const srcRoot = projectRoot(id)
  cpSync(srcRoot, projectRoot(backupId), {
    recursive: true,
    // Skip the regenerable merged build-tree (large; rebuilt on demand).
    filter: (s) => s.slice(srcRoot.length).replace(/^[/\\]/, '').split(/[/\\]/)[0] !== 'build-tree'
  })
  const now = new Date().toISOString()
  const backup: ProjectSummary = { ...src, id: backupId, name: backupId, createdAt: now, modifiedAt: now }
  writeProjectFile(backup)
  return backup
}

/** The current valid project, creating the default one if none exists. */
export function ensureCurrentProject(): ProjectSummary {
  const id = getCurrentProjectId()
  if (id) {
    const pf = readProjectFile(id)
    if (pf) return pf
  }
  return createProject()
}

/** Overlay-changed files for a project, as workRoot-relative POSIX paths. */
export function projectModifiedFiles(id: string): string[] {
  const root = overlayRoot(id)
  if (!existsSync(root)) return []
  const out: string[] = []
  const walk = (dir: string, prefix: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${e.name}` : e.name
      if (e.isDirectory()) walk(join(dir, e.name), rel)
      else out.push(rel)
    }
  }
  walk(root, '')
  out.sort()
  return out
}

export function getProjectInfo(id: string): ProjectInfo | null {
  const pf = readProjectFile(id)
  if (!pf) return null
  const current = readExtractionState(frameworkWorkRoot())?.sourceCartMd5
  const baseMismatch = !!(pf.cartMd5 && current && pf.cartMd5 !== current)
  return { ...pf, files: projectModifiedFiles(id), baseMismatch }
}

export interface BaseCompat {
  ok: boolean
  error?: string
}

/**
 * Guard before writing to a project's overlay: refuse when the project is bound
 * to a different cart than is currently extracted (overlay filenames / header
 * layout would mismatch the base → corrupt build). A project created before any
 * extraction is unbound; the first compatible write binds it to the current base.
 */
export function ensureProjectBaseCompatible(id: string): BaseCompat {
  const project = readProjectFile(id)
  if (!project) return { ok: false, error: `Project "${id}" not found.` }
  const state = readExtractionState(frameworkWorkRoot())
  const current = state?.sourceCartMd5
  if (project.cartMd5 && current && project.cartMd5 !== current) {
    return {
      ok: false,
      error:
        `This project is bound to ${project.romVersion ?? 'a different cart'} ` +
        `(${project.cartMd5.slice(0, 8)}…), but the current extraction is ` +
        `${state?.romVersion ?? 'unknown'} (${current.slice(0, 8)}…). ` +
        `Re-extract the matching cart, or start a new project.`
    }
  }
  // Unbound project (created before any extraction) → bind to the current base.
  if (!project.cartMd5 && state) {
    writeProjectFile({
      ...project,
      romVersion: state.romVersion,
      cartMd5: state.sourceCartMd5
    })
  }
  return { ok: true }
}

/**
 * Rename a project. Moves the folder (id == name), validates the new name,
 * and re-points the current-project setting if it was selected. Throws on an
 * invalid or already-taken name. A Windows directory rename can fail with
 * EPERM/EBUSY/EACCES when the folder is open elsewhere (commonly the "Open
 * folder" Explorer window) — that's re-thrown as a friendly, actionable error.
 */
export function renameProject(id: string, newName: string): ProjectSummary {
  if (!isValidProjectName(newName)) {
    throw new Error(
      'Names must be lowercase letters, digits, "-" or "_" (no spaces), starting with a letter or digit.'
    )
  }
  const existing = readProjectFile(id)
  if (!existing) throw new Error(`Project "${id}" not found.`)
  if (newName === id) return existing
  if (projectExists(newName)) {
    throw new Error(`A project named "${newName}" already exists.`)
  }

  try {
    renameSync(projectRoot(id), projectRoot(newName))
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code && ['EPERM', 'EACCES', 'EBUSY', 'ENOTEMPTY'].includes(code)) {
      throw new Error(
        'Couldn’t rename the project folder — it’s probably open ' +
          'in another window (e.g. Explorer from “Open folder”). ' +
          'Close it and try again.'
      )
    }
    throw err
  }

  const renamed: ProjectSummary = {
    ...existing,
    id: newName,
    name: newName,
    modifiedAt: new Date().toISOString()
  }
  writeProjectFile(renamed)
  if (getCurrentProjectId() === id) {
    updateSettings({ lastProjectId: newName })
  }
  return renamed
}

/**
 * Delete a project folder and all its contents. Same Windows lock caveat as
 * rename — a held-open folder yields EPERM, re-thrown as a friendly error. If
 * the deleted project was current, re-points the pointer at the most-recent
 * remaining project (or clears it so `ensureCurrentProject` makes a default).
 */
export function deleteProject(id: string): void {
  const dir = projectRoot(id)
  if (!existsSync(dir)) throw new Error(`Project "${id}" not found.`)

  try {
    rmSync(dir, { recursive: true, force: true })
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code && ['EPERM', 'EACCES', 'EBUSY', 'ENOTEMPTY'].includes(code)) {
      throw new Error(
        'Couldn’t delete the project folder — it’s probably open ' +
          'in another window (e.g. Explorer from “Open folder”). ' +
          'Close it and try again.'
      )
    }
    throw err
  }

  if (getCurrentProjectId() === id) {
    const remaining = listProjects()
    updateSettings({ lastProjectId: remaining[0]?.id })
  }
}
