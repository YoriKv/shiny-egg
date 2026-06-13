// Vanilla-level removal — reclaim cart space by taking shipped levels out of
// the game. A removal is three coordinated edits:
//   1. project state: the record id joins `removedLevels` (project.json), which
//      the build's layout pass (relocate.ts `removed`) turns into a `Ptrs:` row
//      repoint onto the 1-byte sentinels + incbin deletions in reclaimable
//      pools (the boundary reclaim frees the bytes for other levels);
//   2. world map: the record's translevel slots are marked unused in BOTH
//      entrance index tables, and every kept slot whose progression target
//      (+3) named a removed slot is redirected at its OWN slot — a self-unlock
//      no-op (the deliberate "ignore the unlock chain" policy);
//   3. overlay hygiene: any overlay `.bin`s for the level are deleted.
//
// Removal is per-project state over a pristine base — un-removing is just
// dropping the flag + re-pointing the world map, so nothing here is
// destructive to the base extract.

import * as path from 'node:path'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { loadLevel, loadLevelMapPublic, levelMapEntry } from 'snes-framework/level'
import { serializeLevel } from 'snes-framework/serialize-level'
import { planLayout } from 'snes-framework/relocate'
import { hex0x } from 'snes-framework/hex'
import { levelHex, newSlotRows } from 'snes-framework/pool-map'
import {
  removeTranslevelsFromWorldMap,
  restoreTranslevelsToWorldMap
} from 'snes-framework/world-map'
import type { WorldMapModel } from 'snes-framework/types'
import type {
  CreatableSlot,
  CreateLevelResult,
  RemovalPreview,
  RemovalPreviewResult,
  RemovableVanillaLevels,
  RemovedLevelEntry,
  RemoveLevelsResult,
  RestoreLevelsResult
} from '../shared/ipc-types'
import { editorDataRoot, frameworkWorkRoot, overlayRoot } from './framework-paths'
import {
  ensureProjectBaseCompatible,
  getCurrentProjectId,
  getProjectNewSlots,
  getProjectRemovedLevels,
  setLevelNewSlot,
  setLevelsRemoved
} from './projects'
import {
  activeLayoutPlanInputs,
  loadWorldMapBaseResource,
  loadWorldMapResource,
  saveWorldMapResource
} from './resources'

/**
 * Records the ENGINE references outside the world-map/warp flow — removing one
 * breaks a hardcoded path, so they're refused outright.
 *
 * ID-space caution (this list once wrongly held the bonus-tile TRANSLEVELS as
 * records): the `!Define_YI_LevelID_*` values in engine code are translevels —
 * the Bank17 bonus dispatch (`DATA_17B4BD`) compares CurrentLevelFromMap
 * against them and boots GameMode $2A code scenes, so the map minigames have NO
 * level-data records to protect. What does need protecting, in record space:
 *   • 0xDC/0xDD — the seed-contest / boss arenas (engine numeric ids);
 *   • whatever records the two engine-booted map slots currently play —
 *     slot 0x0A (the gm38 intro cutscene; base record 0x38, the skip-parsed
 *     special level) and slot 0x0B (the Bank04 hardcoded boot; base record
 *     0x39, Welcome To Yoshi's Island) — resolved live from the world-map
 *     model so a slot remap moves the protection with it.
 * NOT protected, despite its historical "PrologueIntro" gloss: record 0x80
 * (define since renamed !Define_YI_LevelRecord_GoGoMarioDashChainSubRoom).
 * No asm site loads level $80 — the storybook prologue (gm05/07) is a pure
 * GFX/code scene with no level record, and the gm38 prologue cutscene boots
 * map slot 0x0A. 0x80 is just a 4-1 dash-chain sub-room (reached via 0x52),
 * removable like any other.
 */
const STATIC_PROTECTED_RECORDS = new Map<number, string>([
  [0xdc, 'engine-reserved arena slot (the $DA-$DD seed-contest / boss-arena block)'],
  [0xdd, 'final-boss arena — engine-referenced by numeric id ($DA-$DD block)']
])

/** The two engine-booted map slots whose CURRENT record must survive. */
const ENGINE_BOOT_SLOTS: Array<[number, string]> = [
  [0x0a, 'played by map slot 0x0A — the engine’s intro-cutscene slot (game-mode $38)'],
  [0x0b, 'played by map slot 0x0B — the engine’s hardcoded boot slot (Welcome, Bank04)']
]

/** The live protected-record set: the static entries + the records the
 *  engine-booted slots currently play (overlay-first world map; base values
 *  0x38/0x39 as the fallback when the tables are unreadable). */
function protectedRecords(): Map<number, string> {
  const out = new Map(STATIC_PROTECTED_RECORDS)
  try {
    const model = loadWorldMapResource()
    for (const [translevel, why] of ENGINE_BOOT_SLOTS) {
      const recordIndex = model.translevelToRecordIndex[hex0x(translevel, 2)]
      const e = recordIndex !== undefined ? model.entrances[recordIndex] : undefined
      if (e && !out.has(e.levelDataId)) out.set(e.levelDataId, why)
    }
  } catch {
    out.set(0x38, ENGINE_BOOT_SLOTS[0][1])
    out.set(0x39, ENGINE_BOOT_SLOTS[1][1])
  }
  return out
}

const LEVEL_DATA_REL = path.join('assets', 'yi', 'LevelData')
const OVERLAY_BIN_RE = /^DATA_level_([0-9A-Fa-f]{2})_(obj|spr)\.bin$/

/** Record ids with any overlay `.bin` in the active project (= user-edited or
 *  imported levels — the ones a bulk removal must keep). */
function overlayEditedRecords(projectId: string): Set<number> {
  const dir = path.join(overlayRoot(projectId), LEVEL_DATA_REL)
  const out = new Set<number>()
  if (!existsSync(dir)) return out
  for (const f of readdirSync(dir)) {
    const m = OVERLAY_BIN_RE.exec(f)
    if (m) out.add(parseInt(m[1], 16))
  }
  return out
}

/** Outgoing record references of one level (overlay-first): warp destinations
 *  AND minibattle return targets — both are records the game jumps to. */
function outgoingRecords(
  recordId: number,
  overlay: string | undefined
): { dest: number; screenIndex: number }[] {
  let exits
  try {
    exits = loadLevel({
      workRoot: frameworkWorkRoot(),
      levelRecordId: recordId,
      overlayRoot: overlay
    }).exits
  } catch {
    return []
  }
  const out: { dest: number; screenIndex: number }[] = []
  for (const e of exits) {
    if (e.variant === 'warp') out.push({ dest: e.destLevelRecordId, screenIndex: e.screenIndex })
    else out.push({ dest: e.returnLevelRecordId, screenIndex: e.screenIndex })
  }
  return out
}

interface ValidatedRequest {
  projectId: string
  map: ReturnType<typeof loadLevelMapPublic>
  candidates: number[]
  blocked: { recordId: number; reason: string }[]
}

/** Validate a removal request down to the records that can actually go. */
function validateRequest(recordIds: number[]): ValidatedRequest | { error: string } {
  const projectId = getCurrentProjectId()
  if (!projectId) return { error: 'No active project.' }
  const map = loadLevelMapPublic(frameworkWorkRoot())
  const alreadyRemoved = new Set(getProjectRemovedLevels(projectId))
  const slotRecords = new Set(newSlotRows(map.romVersion).map((r) => r.recordId))
  const protectedSet = protectedRecords()
  const candidates: number[] = []
  const blocked: { recordId: number; reason: string }[] = []
  for (const id of [...new Set(recordIds)].sort((a, b) => a - b)) {
    const reason = protectedSet.get(id)
    if (reason) {
      blocked.push({ recordId: id, reason })
      continue
    }
    if (alreadyRemoved.has(id)) {
      blocked.push({ recordId: id, reason: 'already removed' })
      continue
    }
    if (slotRecords.has(id)) {
      blocked.push({ recordId: id, reason: 'a new-slot room — use Reset to clear it instead' })
      continue
    }
    const entry = levelMapEntry(map.levels, id)
    if (!entry?.objectFile) {
      blocked.push({ recordId: id, reason: 'no base level data to remove' })
      continue
    }
    candidates.push(id)
  }
  return { projectId, map, candidates, blocked }
}

/** The world-map slots whose entrance record currently plays one of `records`
 *  (overlay-first model — respects a remapped tile). */
function translevelsPlaying(model: WorldMapModel, records: ReadonlySet<number>): number[] {
  const out: number[] = []
  for (const [hexKey, recordIndex] of Object.entries(model.translevelToRecordIndex)) {
    const e = model.entrances[recordIndex]
    if (e && records.has(e.levelDataId)) out.push(parseInt(hexKey, 16))
  }
  return out.sort((a, b) => a - b)
}

/** Warp exits in levels that will REMAIN which point into `candidates` — the
 *  confirm dialog's "this will strand N warps" warning. Scans every backed +
 *  overlay-backed record (~220 stream decodes, sub-second). */
function incomingWarps(
  map: ReturnType<typeof loadLevelMapPublic>,
  projectId: string,
  candidates: ReadonlySet<number>
): { sourceRecordId: number; destRecordId: number; screenIndex: number }[] {
  const overlay = overlayRoot(projectId)
  const removed = new Set(getProjectRemovedLevels(projectId))
  const sources = new Set<number>()
  for (const [k, v] of Object.entries(map.levels)) {
    if (v.objectFile) sources.add(Number(k))
  }
  for (const id of getProjectNewSlots(projectId)) sources.add(id)
  const out: { sourceRecordId: number; destRecordId: number; screenIndex: number }[] = []
  for (const src of [...sources].sort((a, b) => a - b)) {
    if (candidates.has(src) || removed.has(src)) continue
    for (const e of outgoingRecords(src, overlay)) {
      if (candidates.has(e.dest)) {
        out.push({ sourceRecordId: src, destRecordId: e.dest, screenIndex: e.screenIndex })
      }
    }
  }
  return out
}

/** Freed/residual byte impact of removing `candidates`, planned with the SAME
 *  inputs the build uses. Zeros when there's no pool map yet (unbuilt cart). */
function byteImpact(candidates: ReadonlySet<number>): { freedBytes: number; residualBytes: number } {
  const inputs = activeLayoutPlanInputs()
  if (!inputs || candidates.size === 0) return { freedBytes: 0, residualBytes: 0 }
  const plan = planLayout(inputs.map, {
    ...inputs.ctx,
    removed: new Set([...inputs.ctx.removed, ...candidates]),
    sizeOf: inputs.sizeOf
  })
  let freed = 0
  for (const r of plan.removals) if (candidates.has(r.level)) freed += r.bytes
  let owned = 0
  for (const id of candidates) {
    const hex = levelHex(id)
    for (const kind of ['obj', 'spr'] as const) {
      const file = `DATA_level_${hex}_${kind}.bin`
      if (inputs.map.poolByFile.has(file)) owned += inputs.sizeOf(file)
    }
  }
  return { freedBytes: freed, residualBytes: Math.max(0, owned - freed) }
}

/**
 * Dry-run a removal: what would go, what's refused, the world-map impact, the
 * byte impact, and any kept levels whose warps would be stranded. Drives the
 * confirm dialog; `applyLevelRemoval` re-validates, so the preview is advisory.
 */
export function previewLevelRemoval(recordIds: number[]): RemovalPreviewResult {
  const v = validateRequest(recordIds)
  if ('error' in v) return { ok: false, error: v.error }
  const candidateSet = new Set(v.candidates)

  let translevels: number[] = []
  let unlockRewires = 0
  if (v.candidates.length > 0) {
    let model: WorldMapModel
    try {
      model = loadWorldMapResource()
    } catch (err) {
      return { ok: false, error: `World-map tables unreadable: ${(err as Error).message}` }
    }
    translevels = translevelsPlaying(model, candidateSet)
    if (translevels.length > 0) {
      try {
        // Count the rewires against a scratch copy — apply redoes this for real.
        unlockRewires = removeTranslevelsFromWorldMap(
          structuredClone(model),
          new Set(translevels)
        ).rewires.length
      } catch (err) {
        return { ok: false, error: (err as Error).message }
      }
    }
  }

  const { freedBytes, residualBytes } = byteImpact(candidateSet)
  return {
    ok: true,
    recordIds: v.candidates,
    blocked: v.blocked,
    translevels,
    unlockRewires,
    freedBytes,
    residualBytes,
    incomingWarps: incomingWarps(v.map, v.projectId, candidateSet)
  }
}

/**
 * Remove levels for real: world-map rewire (saved to the project overlay)
 * first — it's the step that can fail — then the project-state flag (which also
 * clears the levels' migrate/de-couple toggles) and overlay `.bin` cleanup.
 * The caller (renderer) marks the build dirty: like every asm/layout edit,
 * removal only takes effect at the next build.
 */
export async function applyLevelRemoval(recordIds: number[]): Promise<RemoveLevelsResult> {
  const v = validateRequest(recordIds)
  if ('error' in v) return { ok: false, error: v.error }
  if (v.candidates.length === 0) {
    const why = v.blocked.map((b) => `0x${b.recordId.toString(16).toUpperCase()}: ${b.reason}`)
    return { ok: false, error: `Nothing to remove. ${why.join('; ')}` }
  }
  const compat = ensureProjectBaseCompatible(v.projectId)
  if (!compat.ok) return { ok: false, error: compat.error ?? 'Project base mismatch.' }

  const candidateSet = new Set(v.candidates)
  let model: WorldMapModel
  try {
    model = loadWorldMapResource()
  } catch (err) {
    return { ok: false, error: `World-map tables unreadable: ${(err as Error).message}` }
  }
  const translevels = translevelsPlaying(model, candidateSet)
  if (translevels.length > 0) {
    try {
      removeTranslevelsFromWorldMap(model, new Set(translevels))
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
    const saved = await saveWorldMapResource(model)
    if (!saved.ok) return { ok: false, error: saved.error }
  }

  setLevelsRemoved(v.projectId, v.candidates, true)

  // Overlay .bins for a removed level are dead weight (the build deletes the
  // blob outright) — clear them like a reset.
  const dir = path.join(overlayRoot(v.projectId), LEVEL_DATA_REL)
  for (const id of v.candidates) {
    const hex = levelHex(id)
    for (const kind of ['obj', 'spr'] as const) {
      const p = path.join(dir, `DATA_level_${hex}_${kind}.bin`)
      if (existsSync(p)) await rm(p, { force: true })
    }
  }

  return {
    ok: true,
    removed: v.candidates,
    blocked: v.blocked,
    worldMapChanged: translevels.length > 0
  }
}

/**
 * The "remove all vanilla" candidate set: every backed record EXCEPT
 *   • engine-protected records (and their warp-reachable sub-rooms),
 *   • records with overlay changes (edited/imported levels) and THEIR
 *     warp-reachable sub-rooms — a kept level's pipes must keep working,
 *   • new-slot rooms and records already removed.
 * Reachability follows warp destinations and minibattle return targets,
 * overlay-first, transitively.
 */
export function removableVanillaLevels(): RemovableVanillaLevels | { error: string } {
  const projectId = getCurrentProjectId()
  if (!projectId) return { error: 'No active project.' }
  const map = loadLevelMapPublic(frameworkWorkRoot())
  const overlay = overlayRoot(projectId)
  const removed = new Set(getProjectRemovedLevels(projectId))
  const backed = new Set<number>()
  for (const [k, v] of Object.entries(map.levels)) {
    if (v.objectFile) backed.add(Number(k))
  }

  const edited = overlayEditedRecords(projectId)
  for (const id of getProjectNewSlots(projectId)) edited.add(id)
  const protectedIds = new Set([...protectedRecords().keys()].filter((id) => backed.has(id)))

  // Warp closure of everything that stays by fiat (edited ∪ protected): any
  // record those levels can reach must survive with them.
  const seeds = [...new Set([...edited, ...protectedIds])].filter((id) => !removed.has(id))
  const reachable = new Set<number>(seeds)
  const queue = [...seeds]
  while (queue.length > 0) {
    const id = queue.shift()!
    for (const e of outgoingRecords(id, overlay)) {
      if (
        e.dest != null &&
        backed.has(e.dest) &&
        !removed.has(e.dest) &&
        !reachable.has(e.dest)
      ) {
        reachable.add(e.dest)
        queue.push(e.dest)
      }
    }
  }

  const recordIds: number[] = []
  const keptWarpReachable: number[] = []
  for (const id of [...backed].sort((a, b) => a - b)) {
    if (removed.has(id) || edited.has(id) || protectedIds.has(id)) continue
    if (reachable.has(id)) keptWarpReachable.push(id)
    else recordIds.push(id)
  }
  return {
    recordIds,
    keptEdited: [...edited].filter((id) => backed.has(id) && !removed.has(id)).sort((a, b) => a - b),
    keptProtected: [...protectedIds].sort((a, b) => a - b),
    keptWarpReachable
  }
}

/** Best-effort recordId → friendly name from the baked catalog (the live
 *  `levels:catalog` IPC filters removed records OUT, so the restore modal needs
 *  this direct read). Empty map on any problem. */
function bakedLevelNames(): Map<number, string> {
  try {
    const raw = JSON.parse(
      readFileSync(path.join(editorDataRoot(), 'levels.json'), 'utf8')
    ) as { groups: { levels: { recordId: number | string | null; name: string }[] }[] }
    const out = new Map<number, string>()
    for (const g of raw.groups) {
      for (const l of g.levels) {
        if (l.recordId === null) continue
        const id = typeof l.recordId === 'string' ? parseInt(l.recordId, 16) : l.recordId
        if (Number.isInteger(id) && !out.has(id)) out.set(id, l.name)
      }
    }
    return out
  } catch {
    return new Map()
  }
}

/** The active project's removed levels, with best-effort names — feeds the
 *  Banks panel's "Restore levels" modal. */
export function listRemovedLevels(): RemovedLevelEntry[] {
  const projectId = getCurrentProjectId()
  if (!projectId) return []
  const names = bakedLevelNames()
  return getProjectRemovedLevels(projectId)
    .sort((a, b) => a - b)
    .map((recordId) => {
      const name = names.get(recordId)
      return { recordId, ...(name ? { name } : {}) }
    })
}

/**
 * Restore removed levels — the inverse of `applyLevelRemoval`:
 *   • world map: the records' BASE translevel slots get their base index words
 *     back, and unlocks that still read the removal's self-redirect return to
 *     their base targets (a user-re-pointed unlock is left alone);
 *   • project state: the `removedLevels` flags clear, so the next build's
 *     reconcile-from-base brings back the `Ptrs:` rows and pool incbins.
 * The level data itself returns as pristine base (its overlay `.bin`s were
 * deleted at removal). The caller marks the build dirty.
 */
export async function restoreLevels(recordIds: number[]): Promise<RestoreLevelsResult> {
  const projectId = getCurrentProjectId()
  if (!projectId) return { ok: false, error: 'No active project.' }
  const compat = ensureProjectBaseCompatible(projectId)
  if (!compat.ok) return { ok: false, error: compat.error ?? 'Project base mismatch.' }
  const removed = new Set(getProjectRemovedLevels(projectId))
  const ids = [...new Set(recordIds)].filter((id) => removed.has(id)).sort((a, b) => a - b)
  if (ids.length === 0) return { ok: false, error: 'None of the selected levels are removed.' }

  let model: WorldMapModel
  let base: WorldMapModel
  try {
    model = loadWorldMapResource()
    base = loadWorldMapBaseResource()
  } catch (err) {
    return { ok: false, error: `World-map tables unreadable: ${(err as Error).message}` }
  }
  // The slots to re-wire come from the BASE mapping — the removal zeroed the
  // overlay's index words, so the overlay no longer knows which slots played
  // these records.
  const translevels = translevelsPlaying(base, new Set(ids))
  if (translevels.length > 0) {
    try {
      restoreTranslevelsToWorldMap(model, base, new Set(translevels))
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
    const saved = await saveWorldMapResource(model)
    if (!saved.ok) return { ok: false, error: saved.error }
  }

  setLevelsRemoved(projectId, ids, false)
  return { ok: true, restored: ids, worldMapChanged: translevels.length > 0 }
}

// ── level creation ───────────────────────────────────────────────────────────

/** Pointer slots a new level can be created in: every REMOVED vanilla record.
 *  The free sentinel rows (`0xDA`/`0xDB`) are deliberately not offered — the
 *  create flow stays on slots the game already shipped. (`createLevel` still
 *  accepts a sentinel id, and ROM import still fills the rows via `newSlots`.) */
export function listCreatableSlots(): CreatableSlot[] {
  const projectId = getCurrentProjectId()
  if (!projectId) return []
  const names = bakedLevelNames()
  return getProjectRemovedLevels(projectId)
    .sort((a, b) => a - b)
    .map((recordId) => {
      const name = names.get(recordId)
      return { recordId, ...(name ? { name } : {}) }
    })
}

/**
 * Create a fresh (blank) level in a free pointer slot and point the slot at it:
 *   • the level data is a minimal stream — record 0x00's base header (sane
 *     grassland tileset/music/time defaults) with no objects, exits, or
 *     sprites — written to the project overlay;
 *   • a SENTINEL slot (`0xDA`/`0xDB`) gets the `newSlots` flag, so the build
 *     places the blobs in free space and repoints the sentinel row;
 *   • a REMOVED slot is restored around the new data (the `Ptrs:` row and the
 *     slot's base world-map wiring come back; the overlay `.bin`s shadow the
 *     vanilla bytes), so the new level is immediately playable from the slot's
 *     old map tile.
 * The caller marks the build dirty and navigates to the new level.
 */
export async function createLevel(recordId: number): Promise<CreateLevelResult> {
  const projectId = getCurrentProjectId()
  if (!projectId) return { ok: false, error: 'No active project.' }
  const compat = ensureProjectBaseCompatible(projectId)
  if (!compat.ok) return { ok: false, error: compat.error ?? 'Project base mismatch.' }
  const map = loadLevelMapPublic(frameworkWorkRoot())
  const removed = new Set(getProjectRemovedLevels(projectId))
  const sentinelRow = newSlotRows(map.romVersion).find((r) => r.recordId === recordId)
  const dir = path.join(overlayRoot(projectId), LEVEL_DATA_REL)
  if (sentinelRow) {
    const used =
      new Set(getProjectNewSlots(projectId)).has(recordId) ||
      existsSync(path.join(dir, `DATA_level_${sentinelRow.level}_obj.bin`))
    if (used) {
      return { ok: false, error: `Slot ${hex0x(recordId, 2)} already hosts a new level.` }
    }
  } else if (!removed.has(recordId)) {
    return {
      ok: false,
      error: `Slot ${hex0x(recordId, 2)} is not free — remove its level first, or pick a sentinel slot.`
    }
  }

  // Blank level: record 0x00's BASE header (read straight from the pristine
  // base — works even when 1-1 itself is removed) with empty entity streams.
  let donor
  try {
    donor = loadLevel({ workRoot: frameworkWorkRoot(), levelRecordId: 0x00 })
  } catch (err) {
    return { ok: false, error: `Couldn't read the donor header: ${(err as Error).message}` }
  }
  if (donor.empty || donor.special || donor.header.length === 0) {
    return { ok: false, error: 'Donor level 0x00 has no usable header.' }
  }
  const serialized = serializeLevel({
    level: { ...donor, recordId, objects: [], exits: [], sprites: [] },
    headerBitWidths: map.headerBitWidths,
    standardObjectInfo: map.standardObjectInfo
  })

  const hex = levelHex(recordId)
  await mkdir(dir, { recursive: true })
  for (const [file, bytes] of [
    [`DATA_level_${hex}_obj.bin`, serialized.objectBytes],
    [`DATA_level_${hex}_spr.bin`, serialized.spriteBytes]
  ] as const) {
    const dest = path.join(dir, file)
    await writeFile(dest + '.tmp', bytes)
    await rename(dest + '.tmp', dest)
  }

  if (sentinelRow) {
    setLevelNewSlot(projectId, recordId, true)
    return { ok: true, recordId, worldMapChanged: false }
  }
  const restored = await restoreLevels([recordId])
  if (!restored.ok) {
    return { ok: false, error: `Level data written, but the slot couldn't be restored: ${restored.error}` }
  }
  return { ok: true, recordId, worldMapChanged: restored.worldMapChanged }
}
