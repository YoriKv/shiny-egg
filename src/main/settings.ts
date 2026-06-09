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

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

let cache: Settings | null = null

export function getSettings(): Settings {
  if (cache) return cache
  const p = settingsPath()
  if (!existsSync(p)) {
    cache = { ...DEFAULTS }
    return cache
  }
  try {
    const parsed = JSON.parse(readFileSync(p, 'utf8')) as Partial<Settings>
    cache = { ...DEFAULTS, ...parsed }
  } catch {
    cache = { ...DEFAULTS }
  }
  return cache
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
