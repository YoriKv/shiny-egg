import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { cp, mkdir, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { asarBinName } from 'snes-framework/asar'

/** Crash-safe synchronous write: `data` to `file` via a `.tmp` sibling + rename
 *  (parent dirs created). The atomic-write helper the overlay save + migration
 *  paths share (src/main/resources.ts, src/main/overlay-upgrade.ts). */
export function writeFileAtomicSync(file: string, data: Buffer | string): void {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  writeFileSync(tmp, data)
  renameSync(tmp, file)
}

// Read-only template baked into the installer via electron-builder extraResources.
export function frameworkSourceRoot(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'snes-framework')
    : join(__dirname, '..', '..', 'snes-framework')
}

// Writable working copy. In dev, points at the source tree directly so edits
// to .asm files are immediately effective without a copy step.
export function frameworkWorkRoot(): string {
  return app.isPackaged
    ? join(app.getPath('userData'), 'snes-framework')
    : frameworkSourceRoot()
}

// Platform-correct asar binary in the work root (asar.exe on Windows, asar on
// Linux/macOS). Only the matching binary is shipped per platform (see
// electron-builder.yml's per-platform extraResources).
export function asarBinPath(): string {
  return join(frameworkWorkRoot(), asarBinName())
}

// Platform name of the BizHawk launcher: EmuHawk.exe on Windows, EmuHawk.sh on
// Linux/macOS (BizHawk ships a shell launcher that bootstraps the .NET runtime).
// Used by the locate dialog + dev fallback. BizHawk itself is not bundled.
export function bizhawkExeName(): string {
  return process.platform === 'win32' ? 'EmuHawk.exe' : 'EmuHawk.sh'
}

// Dev-only convenience: BizHawk sitting as a sibling of the project root
// (`<projectRoot>/../bizhawk/EmuHawk.exe`, or `EmuHawk.sh` on Linux/macOS, per
// CLAUDE.md). Lets dev builds run Launch / Test Level without locating EmuHawk
// first. Returns null in packaged builds, or when the file isn't there.
export function devBizhawkPath(): string | null {
  if (app.isPackaged) return null
  const p = join(frameworkSourceRoot(), '..', '..', 'bizhawk', bizhawkExeName())
  return existsSync(p) ? p : null
}

// ── Per-project storage ───────────────────────────────────────────────────
// User edits live in their own project folder under userData, separate from
// the pristine base (frameworkWorkRoot).
// Projects stay in userData (a "Reveal project folder" button is a TODO).

export function projectsRoot(): string {
  return join(app.getPath('userData'), 'projects')
}

export function projectRoot(id: string): string {
  return join(projectsRoot(), id)
}

// Automatic timestamped project backups (see src/main/backup.ts). Deliberately a
// SIBLING of projectsRoot(), not a child, so backups are never swept into a
// project's own archive, deleted alongside a project, or seen by any code that
// walks projects/.
export function backupsRoot(): string {
  return join(app.getPath('userData'), 'backups')
}

// Sparse overlay of changed files (mirrors the workRoot tree).
export function overlayRoot(id: string): string {
  return join(projectRoot(id), 'overlay')
}

// ── Custom patches (post-build binary patch layer) ──────────────────────────

// Bundled, read-only repository of pre-packaged patches (shipped via
// electron-builder extraResources, alongside yi/ + global/). Read from the
// source tree, never the writable copy.
export function builtinPatchesRoot(): string {
  return join(frameworkSourceRoot(), 'patches')
}

// A project's imported-patch bodies (`<id>.ips` + `<id>.json`). Patches are
// project metadata, not overlay files, so they sit beside `overlay/`.
export function projectPatchesDir(id: string): string {
  return join(projectRoot(id), 'patches')
}

// A project's patch selection/order manifest (which patches are enabled).
export function projectPatchManifestPath(id: string): string {
  return join(projectRoot(id), 'patches.json')
}

// Derived merged tree (base ⊕ overlay) that asar builds against when the
// overlay contains asm edits. Regenerable cache; see src/main/build-tree.ts.
export function buildTreeRoot(id: string): string {
  return join(projectRoot(id), 'build-tree')
}

// Per-project build output — the built .sfc + .sym for one project.
export function projectBuildDir(id: string): string {
  return join(projectRoot(id), 'build')
}

/**
 * Directory to read the built ROM/.sym from: the active project's build dir
 * when it has a build, else the shared base build dir (fallback for a project
 * not yet built, or no active project). `probeFile` (e.g. the `.sfc`) decides
 * which dir actually holds a build.
 */
export function builtArtifactDir(id: string | null, probeFile: string): string {
  if (id) {
    const dir = projectBuildDir(id)
    if (existsSync(join(dir, probeFile))) return dir
  }
  return buildOutputDir()
}

// Persistent copy of the most recently extracted reference cart. Kept in the
// (gitignored, never-bundled) `reference/` folder so downstream tooling — the
// BizHawk render harness, repeat extract/builds — can use it without the user
// re-providing the path each time. Overwritten on every extract.
export function referenceCartPath(): string {
  return join(frameworkWorkRoot(), 'reference', 'reference.sfc')
}

// Directory the framework's buildRom() writes its output into. We don't
// hardcode the filename here because it depends on the rom version (see
// `outputSfcName(romVersion)` in snes-framework/scripts/rom-versions.ts).
export function buildOutputDir(): string {
  return join(frameworkWorkRoot(), 'build')
}

// Single-frame BizHawk capture path. Overwritten on every CAPTURE_AT call.
export function screenshotPath(): string {
  return join(frameworkWorkRoot(), 'editor-data', 'yi', 'last-frame.png')
}

/**
 * Where the editor stores its own *processed* data (level-map.json, decoded
 * tilesets, palettes, etc.). Distinct from `workRoot/assets/yi/`, which is
 * the source-of-truth tree asar reads at build time and must contain only
 * files the framework knows how to ingest.
 *
 * Lives under workRoot so it's per-install and writable in packaged builds.
 */
export function editorDataRoot(): string {
  return join(frameworkWorkRoot(), 'editor-data', 'yi')
}

// The read-only template subtrees shipped in the installer (electron-builder
// extraResources). These are pure inputs — extract/build only READ them; all
// generated state goes to assets/yi, editor-data, reference/, build/. They MUST
// be refreshed when the app version changes: gating the copy on "asar.exe
// already exists" (the old behaviour) froze the framework asm/data at whatever
// version was first installed, so a later framework change (e.g. a new
// `;@editable` region) shipped dead on existing installs — the work root kept
// serving the stale file and the editor threw "Missing ;@editable:… markers."
const TEMPLATE_ENTRIES = [asarBinName(), 'global', 'yi'] as const

// Records which app version last populated the template subtrees, so we only
// re-copy on an actual version bump (or when missing — migrates old installs
// that predate this stamp, force-refreshing their stale template once).
function templateStampPath(): string {
  return join(frameworkWorkRoot(), '.template-version')
}

// On first run in a packaged build, copy the bundled framework template from
// resources/ into the user-writable workRoot, and create the empty user-state
// subfolders. On every later run, refresh the template subtrees when the app
// version has changed (clean re-copy incl. deletions), preserving all generated
// state. The stamp is written LAST so a refresh interrupted mid-copy re-runs.
export async function ensureFrameworkWorkRoot(): Promise<void> {
  if (!app.isPackaged) return
  const src = frameworkSourceRoot()
  const dst = frameworkWorkRoot()
  await mkdir(dst, { recursive: true })

  const firstRun = !existsSync(join(dst, asarBinName()))
  const stamp = templateStampPath()
  const current = app.getVersion()
  const installed = existsSync(stamp) ? readFileSync(stamp, 'utf8').trim() : null
  if (!firstRun && installed === current) return // template already current

  for (const entry of TEMPLATE_ENTRIES) {
    const target = join(dst, entry)
    if (existsSync(target)) await rm(target, { recursive: true, force: true })
    await cp(join(src, entry), target, { recursive: true })
  }
  writeFileSync(stamp, current)

  if (firstRun) {
    await mkdir(join(dst, 'assets', 'yi'), { recursive: true })
    await mkdir(join(dst, 'editor-data', 'yi'), { recursive: true })
    await mkdir(join(dst, 'build'), { recursive: true })
    await mkdir(join(dst, 'reference'), { recursive: true })
  }
}
