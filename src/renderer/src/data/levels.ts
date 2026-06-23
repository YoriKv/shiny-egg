// Live levels catalog. Backs the level dropdown + every `getLevel(id)`
// lookup across the renderer. The catalog is **cart-derived** — emitted by the
// framework's extract step from `Bank51.asm` + `levels-slot-shape.ts` and read
// via the `getLevelsCatalog()` IPC, swapped in once `refreshLevelsCatalog()`
// resolves (called at the App root on mount + after every extract).
//
// Pre-extract the catalog is empty and the dropdown shows nothing until the
// user extracts.
//
// React components that need to re-render on a catalog refresh call
// `useLevelsCatalog()`. Non-React consumers call `getLevel()` directly —
// the returned value is always the latest snapshot, and an upstream
// `useLevelsCatalog()` subscription (mounted at the App root) triggers
// the re-render cascade.

import { useSyncExternalStore } from 'react'
import type {
  LevelCatalogEntry,
  LevelCatalogGroup,
  LevelsCatalog
} from '../../../preload/api'
import { hex0x } from '../lib/hex'

let current: LevelsCatalog = { groups: [] }
let byId = indexById(current)
const listeners = new Set<() => void>()

// Renderer mirror of the active project's REMOVED record ids (records flagged
// for build-time reclaim). The catalog already hides them from the dropdown
// LIST, but free-form / discovery navigation (Go-to-room, the sub-room dropdown,
// the object finder, warp-exit jumps) can still target one — `isRemovedRecord`
// lets those paths refuse it. Refreshed inside `refreshLevelsCatalog` so it
// rides every existing catalog-refresh point (mount, project switch, import,
// and post-removal), staying current the instant project state changes.
let removedRecords: ReadonlySet<number> = new Set()

/**
 * Level IDs are stored as hex strings on disc (`"0x43"`) but the runtime
 * contract is a numeric `id`. Parse them at the load boundary; tolerant of
 * already-numeric ids so older/cart-derived catalogs still load.
 */
function normalizeCatalog(raw: unknown): LevelsCatalog {
  const cat = raw as LevelsCatalog
  return {
    ...cat,
    groups: cat.groups.map((g) => ({
      ...g,
      levels: g.levels.map((l) => ({
        ...l,
        recordId: typeof l.recordId === 'string' ? parseInt(l.recordId, 16) : l.recordId
      }))
    }))
  }
}

function indexById(cat: LevelsCatalog): Map<number, LevelCatalogEntry> {
  const out = new Map<number, LevelCatalogEntry>()
  // Only real-data entries are keyed by id; null-id slots (bonus / mini-game /
  // intro) are excluded so they can't collide with or shadow a real level.
  for (const group of cat.groups) {
    for (const lvl of group.levels) if (lvl.recordId !== null) out.set(lvl.recordId, lvl)
  }
  return out
}

/** Latest catalog snapshot. */
export function getLevelsCatalog(): LevelsCatalog {
  return current
}

/** Latest list of catalog groups (dropdown header + entries). */
export function getLevelGroups(): LevelCatalogGroup[] {
  return current.groups
}

/** Latest flat list of all catalog entries. */
export function getAllLevels(): LevelCatalogEntry[] {
  return current.groups.flatMap((g) => g.levels)
}

/** Lookup by data-record `id` (NOT translevel ID) against the latest snapshot.
 *  Null-id bonus / mini-game slots aren't indexed, so they never resolve here. */
export function getLevel(id: number): LevelCatalogEntry | undefined {
  return byId.get(id)
}

export function formatLevelId(id: number): string {
  return hex0x(id, 2)
}

/** Fallback rendering for a record id that isn't a playable catalog entry:
 *  'hex' → "0x9B", 'subroom' → "sub-room 0x9B", 'dash' → "—". */
export type LevelLabelFallback = 'hex' | 'subroom' | 'dash'

/**
 * Canonical display label for a data-record id — the ONE labeler shared by every
 * level / sub-room dropdown (LevelPicker, SubLevelMenu, …). Catalog entries render
 * as "slot name" (e.g. "1-3 The Cave Of Chomp Rock"); ids not in the playable
 * catalog (sub-rooms, raw records) render per `fallback`.
 */
export function levelLabel(id: number, fallback: LevelLabelFallback = 'hex'): string {
  const l = getLevel(id)
  if (l) return `${l.slot} ${l.name}`
  if (fallback === 'dash') return '—'
  if (fallback === 'subroom') return `sub-room ${hex0x(id, 2)}`
  return hex0x(id, 2)
}

function notify(): void {
  for (const cb of listeners) cb()
}

/** Replace the active catalog and notify subscribers. */
export function setCatalog(next: LevelsCatalog): void {
  current = next
  byId = indexById(next)
  notify()
}

/** The live removed-record set (stable reference until the next refresh). */
export function getRemovedRecords(): ReadonlySet<number> {
  return removedRecords
}

/** Is this data record flagged removed in the active project? Removed records
 *  are dropped from the ROM at the next build, so navigation must refuse them
 *  (editing one would be silently discarded). The central nav guard enforces
 *  this for every entry point; see hooks/useLevelNavigation. */
export function isRemovedRecord(id: number): boolean {
  return removedRecords.has(id)
}

/** React hook: the live removed-record set. Re-renders on any catalog/removed
 *  refresh (shares the catalog's subscription). */
export function useRemovedRecords(): ReadonlySet<number> {
  return useSyncExternalStore(subscribeLevelsCatalog, getRemovedRecords, getRemovedRecords)
}

/** Subscribe to catalog mutations. Returns an unsubscribe function. */
export function subscribeLevelsCatalog(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

/**
 * Fetches the cart-derived catalog over IPC and swaps it into the live
 * store. No-op (catalog stays empty) if no extraction has happened yet.
 * Resolves when the swap is done.
 */
export async function refreshLevelsCatalog(): Promise<void> {
  // Fetch the catalog and the removed-record set together so they swap in as one
  // consistent snapshot. `removedLevels` is empty (and harmless) pre-extract.
  const [next, removed] = await Promise.all([
    window.shinyEgg.getLevelsCatalog(),
    window.shinyEgg.editor.removedLevels().catch(() => [])
  ])
  removedRecords = new Set(removed.map((r) => r.recordId))
  if (next) setCatalog(normalizeCatalog(next))
  else notify()
}

/**
 * React hook returning the current catalog. Subscribes to mutations so
 * the consumer re-renders whenever the catalog is replaced.
 */
export function useLevelsCatalog(): LevelsCatalog {
  return useSyncExternalStore(
    subscribeLevelsCatalog,
    getLevelsCatalog,
    getLevelsCatalog
  )
}
