import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Settings } from '../shared/ipc-types'

// Persistent user settings that need to be available before the renderer is
// loaded — so localStorage isn't an option. Lives in a single JSON file in
// userData so settings survive uninstall/reinstall of the app bundle.
//
// Holds cross-launch app state that must be available before the renderer
// loads (so localStorage isn't an option).

const DEFAULTS: Settings = {}

// The legacy pure-black canvas background, and the grey that replaces it. Kept in
// sync with the renderer's DEFAULT_CANVAS_BG (App.tsx) — the renderer owns the
// fresh-install default; this only bumps an EXISTING saved value off the old one.
const LEGACY_CANVAS_BG = '#000000'
const NEW_DEFAULT_CANVAS_BG = '#191919'

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

let cache: Settings | null = null

export function getSettings(): Settings {
  if (cache) return cache
  const p = settingsPath()
  if (!existsSync(p)) {
    cache = { ...DEFAULTS }
  } else {
    try {
      const parsed = JSON.parse(readFileSync(p, 'utf8')) as Partial<Settings>
      cache = { ...DEFAULTS, ...parsed }
    } catch {
      cache = { ...DEFAULTS }
    }
  }
  migrate()
  return cache
}

/**
 * One-time settings migrations, run once per install on first load. The flag is
 * always set (and persisted) so each migration fires exactly once — a user who
 * later re-picks the old value keeps it.
 */
function migrate(): void {
  const s = cache as Settings
  if (s.canvasBgDefaultMigrated) return
  const patch: Partial<Settings> = { canvasBgDefaultMigrated: true }
  // Bump the legacy pure-black default to the new grey (only the old default —
  // any other chosen colour, including a deliberate black re-pick later, stays).
  if (s.canvasBackgroundColor === LEGACY_CANVAS_BG) {
    patch.canvasBackgroundColor = NEW_DEFAULT_CANVAS_BG
  }
  updateSettings(patch)
}

export function updateSettings(patch: Partial<Settings>): Settings {
  const next = { ...getSettings(), ...patch }
  cache = next
  try {
    writeFileSync(settingsPath(), JSON.stringify(next, null, 2), 'utf8')
  } catch {
    // Best-effort persistence; in-memory cache still reflects the change.
  }
  return next
}
