// Editable-resource registry (plan step 4): one generic load/save dispatch over
// every editable thing — level data today, asm-backed resources (strings, …) in
// step 5. The generic `editor:loadResource` / `editor:saveResource` IPC dispatch
// here — a single source of truth for every editable thing (the level editor
// loads and saves through the `kind:'level'` backend).

import * as path from 'node:path'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import {
  loadLevel,
  loadLevelMapPublic,
  levelMapEntry,
  type LevelData
} from 'snes-framework/level'
import { serializeLevel } from 'snes-framework/serialize-level'
import {
  checkAllPools,
  computeFreeRegionsOverview,
  computeLevelBudget,
  computePoolOverview,
  loadPoolMap,
  type PoolViolation
} from 'snes-framework/level-budget'
import { computeBoundaryMoves, type BoundaryMove } from 'snes-framework/boundary-move'
import { applyLevelDataLayout, type LayoutPlan } from 'snes-framework/relocate'
import {
  carvePatchPool,
  patchPoolGeometry,
  PATCH_POOL_REGION_ID,
  type PatchPoolGeometry
} from 'snes-framework/pool-map'
import { outputSfcName } from 'snes-framework/rom-versions'
import { readExtractionState } from 'snes-framework/state'
import {
  applyPaletteEdits,
  readPaletteEdits,
  PALETTE_BLOB_BANK_FILE
} from 'snes-framework/palette-edit'
import type {
  PaletteEdit,
  PoolBudgetReport,
  PoolOverview,
  RomVersion
} from 'snes-framework/types'
import type { ResetLevelResult, SetExitDestResult } from '../shared/ipc-types'
import {
  levelNameSlotLabels,
  loadFontTable,
  parseLevelNameStrings,
  parseMessageText,
  serializeLevelNameStrings,
  serializeMessageText,
  type FontTable,
  type SerializeResult
} from 'snes-framework/strings'
import { SLOT_PREFIX_RE } from 'snes-framework/levels-catalog'
import {
  parseEntranceTable,
  serializeEntranceTable,
  loadLevelIdSymbols
} from 'snes-framework/world-map'
import type {
  EditableResource,
  SaveResourceResult,
  StringTableModel,
  WorldMapModel
} from 'snes-framework/types'
import { buildOutputDir, frameworkWorkRoot, overlayRoot } from './framework-paths'
import {
  ensureProjectBaseCompatible,
  getCurrentProjectId,
  getProjectDecoupled,
  getProjectRelocations
} from './projects'
import { getPatchPoolBytes, hasEnabledAsmPatches } from './patches'

/** Registry of editor-owned `;@editable` asm regions (plan step 5). Each maps a
 *  resource id to its backing file (workRoot-relative) and a parse/serialize
 *  pair built on the reusable asm primitives. Add a row to expose a new region
 *  (message-box text, item names, …) — no other wiring needed. */
interface AsmRegionDef {
  file: string
  parse: (contentText: string, baseText: string, ft: FontTable) => StringTableModel
  serialize: (
    contentText: string,
    budgetText: string,
    model: StringTableModel,
    ft: FontTable
  ) => SerializeResult
}

const ASM_REGIONS: Record<string, AsmRegionDef> = {
  'level-name-strings': {
    file: 'yi/SuperFX/Banks/Bank51.asm',
    parse: parseLevelNameStrings,
    serialize: serializeLevelNameStrings
  },
  'message-box-text': {
    file: 'yi/SuperFX/Banks/Bank51.asm',
    parse: parseMessageText,
    serialize: serializeMessageText
  }
}

export type SaveLevelResult =
  | { ok: true; objectFile: string | null; spriteFile: string | null }
  | { ok: false; error: string }

/** Load a level's `LevelData`, overlay-first for the active project. */
export function loadLevelResource(levelRecordId: number): LevelData {
  const projectId = getCurrentProjectId()
  return loadLevel({
    workRoot: frameworkWorkRoot(),
    levelRecordId,
    overlayRoot: projectId ? overlayRoot(projectId) : undefined
  })
}

/** Serialize an edited level into the active project's overlay `.bin`(s). */
export async function saveLevelResource(
  levelRecordId: number,
  level: LevelData
): Promise<SaveLevelResult> {
  const map = loadLevelMapPublic(frameworkWorkRoot())
  const entry = levelMapEntry(map.levels, levelRecordId)
  if (!entry) {
    return { ok: false, error: `Level 0x${levelRecordId.toString(16)} has no map entry.` }
  }
  if (level.empty || level.special) {
    return { ok: false, error: 'Cannot save an empty or special level.' }
  }

  // 5 levels have stream data the cart build still reads from a shared/aliased/
  // oversized old label-based .bin instead of the per-level .bin the editor
  // reads — saving the per-level file would succeed but the build would ignore
  // it. Reject with a clear explanation. (See the DATA_1695D4End / DATA_11DB2EEnd /
  // DATA_level_7F_spr / DATA_level_D2_spr declarations in Bank10/11/14/16.asm.)
  const exceptionalReason = exceptionalSaveBlockReason(levelRecordId)
  if (exceptionalReason !== null) {
    return { ok: false, error: exceptionalReason }
  }

  const serialized = serializeLevel({
    level,
    headerBitWidths: map.headerBitWidths,
    standardObjectInfo: map.standardObjectInfo
  })

  // Per-level .bin files are self-contained; write the whole file into the
  // current project's overlay, leaving the pristine base untouched. A grow past
  // the bank boundary fails at build time (asar) — the correct gate.
  const projectId = getCurrentProjectId()
  if (!projectId) {
    return { ok: false, error: 'No active project to save into.' }
  }
  // Refuse to write the overlay against a cart it wasn't created for (would
  // corrupt the build); binds an unbound project to the current base.
  const compat = ensureProjectBaseCompatible(projectId)
  if (!compat.ok) {
    return { ok: false, error: compat.error ?? 'Project base mismatch.' }
  }
  const dir = path.join(overlayRoot(projectId), 'assets', 'yi', 'LevelData')
  await mkdir(dir, { recursive: true })
  if (entry.objectFile) {
    await writeAtomic(path.join(dir, entry.objectFile), serialized.objectBytes)
  }
  if (entry.spriteFile) {
    await writeAtomic(path.join(dir, entry.spriteFile), serialized.spriteBytes)
  }
  return { ok: true, objectFile: entry.objectFile, spriteFile: entry.spriteFile }
}

/**
 * Write RAW level stream bytes straight into the active project's overlay,
 * bypassing serialize. Used by the ROM-import path for "raw-only" levels — a
 * foreign level whose decode→serialize doesn't round-trip (a decoder gap), so we
 * preserve the exact foreign bytes rather than risk re-encoding them wrong. Same
 * guards as saveLevelResource (map entry, exceptional/aliased slots, base
 * compatibility). `objectBytes` / `spriteBytes` are only written when the level
 * actually has that stream file in the base map.
 */
export async function saveLevelRawResource(
  levelRecordId: number,
  objectBytes: Buffer | null,
  spriteBytes: Buffer | null
): Promise<SaveLevelResult> {
  const map = loadLevelMapPublic(frameworkWorkRoot())
  const entry = levelMapEntry(map.levels, levelRecordId)
  if (!entry) {
    return { ok: false, error: `Level 0x${levelRecordId.toString(16)} has no map entry.` }
  }
  const exceptionalReason = exceptionalSaveBlockReason(levelRecordId)
  if (exceptionalReason !== null) {
    return { ok: false, error: exceptionalReason }
  }
  const projectId = getCurrentProjectId()
  if (!projectId) {
    return { ok: false, error: 'No active project to save into.' }
  }
  const compat = ensureProjectBaseCompatible(projectId)
  if (!compat.ok) {
    return { ok: false, error: compat.error ?? 'Project base mismatch.' }
  }
  const dir = path.join(overlayRoot(projectId), 'assets', 'yi', 'LevelData')
  await mkdir(dir, { recursive: true })
  if (entry.objectFile && objectBytes) {
    await writeAtomic(path.join(dir, entry.objectFile), objectBytes)
  }
  if (entry.spriteFile && spriteBytes) {
    await writeAtomic(path.join(dir, entry.spriteFile), spriteBytes)
  }
  return { ok: true, objectFile: entry.objectFile, spriteFile: entry.spriteFile }
}

/**
 * Reset a level to its pristine base: delete the active project's overlay
 * `.bin`(s) for it, so the next load reads the base cart. `removed` reports
 * whether an overlay actually existed (→ the built ROM is now stale). The
 * renderer reloads the level + flags a rebuild when `removed`.
 */
export async function resetLevelResource(levelRecordId: number): Promise<ResetLevelResult> {
  const projectId = getCurrentProjectId()
  if (!projectId) return { ok: false, error: 'No active project.' }
  const map = loadLevelMapPublic(frameworkWorkRoot())
  const entry = levelMapEntry(map.levels, levelRecordId)
  if (!entry) return { ok: false, error: `Level 0x${levelRecordId.toString(16)} has no map entry.` }

  const dir = path.join(overlayRoot(projectId), 'assets', 'yi', 'LevelData')
  let removed = false
  for (const f of [entry.objectFile, entry.spriteFile]) {
    if (!f) continue
    const p = path.join(dir, f)
    if (existsSync(p)) {
      await rm(p, { force: true })
      removed = true
    }
  }
  return { ok: true, removed }
}

/**
 * Cross-level warp-exit destination edit (the incoming-marker drag, plan §A8
 * #8.5). Set the destX/destY of the warp exit on `screenIndex` in `sourceLevelRecordId`
 * and write that level's overlay `.bin`(s). The source level is typically NOT
 * the one loaded in the editor, so this writes straight to disk (auto-save) via
 * the vetted `saveLevelResource` path — the renderer marks the build dirty and
 * refreshes the incoming markers, and keeps a reversible undo entry.
 */
export async function setExitDestResource(
  sourceLevelRecordId: number,
  screenIndex: number,
  destX: number,
  destY: number
): Promise<SetExitDestResult> {
  let level: LevelData
  try {
    level = loadLevelResource(sourceLevelRecordId)
  } catch (err) {
    return {
      ok: false,
      error: `Couldn't load level 0x${sourceLevelRecordId.toString(16)}: ${(err as Error).message}`
    }
  }
  const idx = level.exits.findIndex(
    (e) => e.variant === 'warp' && e.screenIndex === screenIndex
  )
  const exit = idx >= 0 ? level.exits[idx] : undefined
  if (!exit || exit.variant !== 'warp') {
    return {
      ok: false,
      error: `No warp exit on screen 0x${screenIndex.toString(16)} of level 0x${sourceLevelRecordId.toString(16)}.`
    }
  }
  // No-op guard (defensive — the renderer already skips a same-cell drop).
  if (exit.destX === destX && exit.destY === destY) return { ok: true }
  const nextExits = level.exits.slice()
  nextExits[idx] = { ...exit, destX, destY }
  const r = await saveLevelResource(sourceLevelRecordId, { ...level, exits: nextExits })
  return r.ok ? { ok: true } : { ok: false, error: r.error }
}

// ── Level-data byte budget (shared-pool gate, task #14) ─────────────────────
// Per-level obj/spr streams share fixed bank "pools" (snes-framework/pool-map.ts).
// The live report drives the editor's warn-on-save / block-on-build blockers;
// the all-pools check is the pre-build gate. See research/notes-level-size-overflow.md.

const LEVEL_DATA_REL = path.join('assets', 'yi', 'LevelData')

/** Load the pool map for a ROM version from the base build `.sym` + base `.bin`s. */
function poolMapFor(romVersion: RomVersion) {
  const symName = outputSfcName(romVersion).replace(/\.sfc$/i, '.sym')
  return loadPoolMap({
    romVersion,
    symPath: path.join(buildOutputDir(), symName),
    baseBinDir: path.join(frameworkWorkRoot(), LEVEL_DATA_REL)
  })
}

/** The active cart's pool map + ROM version, or null when the cart hasn't been
 *  extracted/built yet (no `romVersion`, or no base `.sym`). The shared preamble
 *  of every extraction-state-driven pool accessor below. */
function activePoolMap(): { map: NonNullable<ReturnType<typeof poolMapFor>>; romVersion: RomVersion } | null {
  const romVersion = readExtractionState(frameworkWorkRoot())?.romVersion
  if (!romVersion) return null
  const map = poolMapFor(romVersion)
  if (!map) return null
  return { map, romVersion }
}

/** Bytes the active project reserves for the asm-patch pool (0 when no asm patch
 *  is enabled — then no carve). Every budget view shrinks the free-region map by
 *  this (via `carvePatchPool`) so the gate matches the room the build actually
 *  leaves for migration after `applyActiveLevelDataLayout` reserves the slice. */
function activePatchPoolBytes(): number {
  const id = getCurrentProjectId()
  if (!id || !hasEnabledAsmPatches(id)) return 0
  return getPatchPoolBytes(id)
}

/** Current on-disk size of a blob `.bin`: overlay (active project) if it's been
 *  saved there, else the pristine base. */
function diskSizeOf(projectId: string | null): (file: string) => number {
  const baseDir = path.join(frameworkWorkRoot(), LEVEL_DATA_REL)
  const overlayDir = projectId ? path.join(overlayRoot(projectId), LEVEL_DATA_REL) : null
  return (file: string): number => {
    if (overlayDir) {
      try {
        return statSync(path.join(overlayDir, file)).size
      } catch {
        /* not in overlay → fall back to base */
      }
    }
    try {
      return statSync(path.join(baseDir, file)).size
    } catch {
      return 0
    }
  }
}

/** Freshly serialized obj/spr stream sizes for a level being edited, plus the
 *  blob file names they map to. Null for empty/special slots or a level absent
 *  from the map. Shared by the per-level budget and the pool overview so both
 *  reflect the same unsaved-edit sizes. */
function liveStreamSizes(
  levelRecordId: number,
  level: LevelData
): { objFile: string | null; spriteFile: string | null; objBytes: number; spriteBytes: number } | null {
  if (level.empty || level.special) return null
  const fwMap = loadLevelMapPublic(frameworkWorkRoot())
  const entry = levelMapEntry(fwMap.levels, levelRecordId)
  if (!entry) return null
  const serialized = serializeLevel({
    level,
    headerBitWidths: fwMap.headerBitWidths,
    standardObjectInfo: fwMap.standardObjectInfo
  })
  return {
    objFile: entry.objectFile ?? null,
    spriteFile: entry.spriteFile ?? null,
    objBytes: serialized.objectBytes.length,
    spriteBytes: serialized.spriteBytes.length
  }
}

/**
 * Live byte-budget report for a level being edited: its obj/spr streams use the
 * freshly serialized sizes, the rest of each shared pool uses on-disk sizes.
 * Null when the pool map is unavailable (no build/.sym yet) or the level has no
 * editable streams (empty/special) — callers then surface no budget blocker.
 */
export function activeLevelBudget(levelRecordId: number, level: LevelData): PoolBudgetReport | null {
  if (level.empty || level.special) return null
  const baseMap = poolMapFor(level.romVersion)
  if (!baseMap) return null
  // Plan against the same patch-pool-carved free space the build reserves, so the
  // per-level "relocates to / can relocate" signal can't promise room the build lacks.
  const map = carvePatchPool(baseMap, activePatchPoolBytes())
  const live = liveStreamSizes(levelRecordId, level)
  if (!live) return null
  return computeLevelBudget(
    map,
    levelRecordId,
    { objFile: live.objFile, spriteFile: live.spriteFile },
    { objBytes: live.objBytes, spriteBytes: live.spriteBytes },
    diskSizeOf(getCurrentProjectId()),
    activeLayoutCtx()
  )
}

/**
 * Cross-pool byte-budget overview for the "Banks" panel (pools + free regions): every
 * level-data pool with its capacity/headroom/used/free totals and per-level
 * byte breakdown. Sizes are on-disk (overlay-if-saved, base otherwise); when
 * `activeLevel` is the level being edited, its obj/spr blobs take their freshly
 * serialized live sizes so the panel tracks unsaved edits (matching the
 * over-budget banner). Null when there's no pool map yet (unbuilt cart).
 */
export function activePoolOverview(
  activeLevelRecordId: number | null,
  activeLevel: LevelData | null
): PoolOverview | null {
  const pm = activePoolMap()
  if (!pm) return null
  const { romVersion } = pm
  // Carve the patch-pool slice so the Banks panel's "Free space" totals show the
  // room migration actually has (matches the build + the budget gate).
  const map = carvePatchPool(pm.map, activePatchPoolBytes())
  const disk = diskSizeOf(getCurrentProjectId())
  const live =
    activeLevel && activeLevelRecordId != null
      ? liveStreamSizes(activeLevelRecordId, activeLevel)
      : null
  const sizeOf = live
    ? (file: string): number => {
        if (live.objFile && file === live.objFile) return live.objBytes
        if (live.spriteFile && file === live.spriteFile) return live.spriteBytes
        return disk(file)
      }
    : disk
  const ctx = activeLayoutCtx()
  return {
    romVersion,
    pools: computePoolOverview(map, sizeOf, ctx),
    freeRegions: computeFreeRegionsOverview(map, sizeOf, ctx)
  }
}

/** Pre-build gate: pools whose current on-disk total would overrun the asar
 *  boundary assert. Empty when nothing is over (or the map is unavailable). */
export function checkActivePoolBudgets(): PoolViolation[] {
  const pm = activePoolMap()
  if (!pm) return []
  // Carve the asm-patch slice so the gate plans against the SAME free-region
  // capacity the build reserves — otherwise it green-lights a relocation plan the
  // carved build can't place, and asar dies with a cryptic bank-border assert.
  const map = carvePatchPool(pm.map, activePatchPoolBytes())
  return checkAllPools(map, diskSizeOf(getCurrentProjectId()), activeLayoutCtx())
}

/** A one-line, actionable message for a set of pre-build pool violations. The
 *  free-space (region-full) case names the stranded blob(s) and the levers that
 *  free room (shrinking the patch pool is one — it competes with relocation). */
export function poolViolationMessage(violations: PoolViolation[]): string {
  return violations
    .map((v) =>
      v.poolId === 'free-space'
        ? `Free space for relocated level data is full by ${v.overBy} byte(s) ` +
          `(can't place ${v.levels.join(', ')}). Reduce the asm-patch pool size, ` +
          `or un-migrate / shrink some levels, then rebuild.`
        : `Level pool ${v.poolId} is ${v.overBy} byte(s) over budget ` +
          `(${v.usedBytes}/${v.limitBytes}). Shrink a level in this pool, then rebuild.`
    )
    .join(' ')
}

/** Movable pools that grew and need a build-time `%FREE_BYTES` boundary move
 *  (for the buildProject gating decision + progress log). Empty when no movable
 *  pool grew, or the pool map is unavailable. */
export function activeBoundaryMoves(): BoundaryMove[] {
  const pm = activePoolMap()
  if (!pm) return []
  return computeBoundaryMoves(pm.map, diskSizeOf(getCurrentProjectId()))
}

/** The active project's free-space migration + de-couple context (numeric ids). */
function activeLayoutCtx(): { migrated: Set<number>; decoupled: Set<number> } {
  const id = getCurrentProjectId()
  return { migrated: new Set(getProjectRelocations(id)), decoupled: new Set(getProjectDecoupled(id)) }
}

/** Active free-space migrations (record ids) — for the buildProject trigger. */
export function activeRelocations(): number[] {
  return getProjectRelocations(getCurrentProjectId())
}

/** Active de-couples (record ids) — for the buildProject trigger. */
export function activeDecoupled(): number[] {
  return getProjectDecoupled(getCurrentProjectId())
}

/**
 * Reconcile the build tree's level-data banks to the active project: boundary
 * moves AND free-space migrations (delete + region-append + reclaim) AND
 * de-couples (materialise + repoint), in one per-bank pass — the unified layout
 * transform (relocate.ts) that generalises boundary-move.ts. Called after the
 * build-tree is materialized, before asar runs. Null when there's no pool map.
 */
export function applyActiveLevelDataLayout(
  treeRoot: string,
  patchPoolBytes = 0
): LayoutPlan | null {
  const pm = activePoolMap()
  if (!pm) return null
  const { map } = pm
  const id = getCurrentProjectId()
  return applyLevelDataLayout(
    path.join(frameworkWorkRoot(), 'yi'),
    id ? path.join(overlayRoot(id), 'yi') : null,
    path.join(treeRoot, 'yi'),
    map,
    { ...activeLayoutCtx(), sizeOf: diskSizeOf(id), patchPoolBytes }
  )
}

/** Asm-patch pool geometry for the current build's host region (FreeRegion51), or
 *  null if the pool map is unavailable. Drives the `%patchcode` macro defines in
 *  the generated Custom hook so the bump allocator and the carved reservation
 *  agree on the slice's addresses. */
export function activePatchPoolGeometry(patchPoolBytes: number): PatchPoolGeometry | null {
  const pm = activePoolMap()
  if (!pm) return null
  const region = pm.map.freeRegions.find((r) => r.id === PATCH_POOL_REGION_ID)
  if (!region) return null
  return patchPoolGeometry(region, patchPoolBytes)
}

/**
 * Generic resource load — dispatches on `kind`, returning the resource's model
 * (e.g. `LevelData` for `level`). asm-region lands in step 5.
 */
export async function loadResource(resource: EditableResource): Promise<unknown> {
  switch (resource.kind) {
    case 'level':
      return loadLevelResource(resource.recordId)
    case 'asm-region':
      return loadAsmRegionResource(resource.id)
    case 'world-map':
      return loadWorldMapResource()
    default: {
      const _never: never = resource
      throw new Error(`Unknown resource: ${JSON.stringify(_never)}`)
    }
  }
}

// ── World-map entrance table ───────────────────────────────────────────────
// The world-map entrance records are `db` data in a `;@editable` region of
// yi/Routines/DATATABLE_…asm. An edit is an asm edit → overlay copy of that file
// (build-tree path, build dirty) — same overlay shape as the asm-region string
// editor + palette editor above. Records are fixed 4 bytes, so no byte budget.

const WORLD_MAP_FILE = path.join('yi', 'Routines', 'DATATABLE_YI_LevelDataPtrsAndEntranceData.asm')

/** Load the world-map entrance table (overlay-first) into its structured model. */
export function loadWorldMapResource(): WorldMapModel {
  const { contentText } = readOverlayFirst(WORLD_MAP_FILE)
  return parseEntranceTable(contentText, loadLevelIdSymbols(frameworkWorkRoot()))
}

/** Splice the edited entrance model into the active project's overlay copy of the
 *  DATATABLE asm and write it back (atomic). Splices onto the OVERLAY-first
 *  content so prior world-map edits in the same file survive; only operands whose
 *  value changed are rewritten. Renderer marks the build dirty on success (asm
 *  edits don't render live in-level — same contract as the string/palette tools). */
export async function saveWorldMapResource(model: unknown): Promise<SaveResourceResult> {
  const projectId = getCurrentProjectId()
  if (!projectId) return { ok: false, error: 'No active project to save into.' }
  const compat = ensureProjectBaseCompatible(projectId)
  if (!compat.ok) return { ok: false, error: compat.error ?? 'Project base mismatch.' }

  const { contentText } = readOverlayFirst(WORLD_MAP_FILE)
  const result = serializeEntranceTable(contentText, model as WorldMapModel, loadLevelIdSymbols(frameworkWorkRoot()))
  if (!result.ok) return { ok: false, error: result.error }

  await saveOverlayFile(projectId, WORLD_MAP_FILE, result.text)
  return { ok: true, files: [WORLD_MAP_FILE] }
}

/**
 * Live translevel-slot → data-record overrides from the project's world-map
 * overlay (the Phase-3 remap). Mirrors `levelNameOverrides`: the catalog
 * (`levels.json`) bakes the slot→record mapping from the BASE cart at extract, so
 * a remapped tile (entrance byte +0) would otherwise stay stale in the level
 * dropdown until — never (a rebuild doesn't regenerate levels.json; re-extract
 * reads base). This re-derives translevel→levelDataId from the OVERLAY so
 * `levels:catalog` can overlay the new `recordId` per slot, and the renderer's
 * `refreshLevelsCatalog()` (called on world-map save) picks it up — no rebuild.
 *
 * Returns an empty map when the project has no world-map overlay (unedited → the
 * catalog's baked mapping is already correct), so unedited projects pay nothing.
 */
export function levelRecordOverrides(): Map<number, number> {
  try {
    const projectId = getCurrentProjectId()
    if (!projectId) return new Map()
    if (!existsSync(path.join(overlayRoot(projectId), WORLD_MAP_FILE))) return new Map()
    const model = loadWorldMapResource()
    const byIndex = new Map(model.entrances.map((e) => [e.index, e]))
    const out = new Map<number, number>()
    for (const [hexKey, recordIndex] of Object.entries(model.translevelToRecordIndex)) {
      const e = byIndex.get(recordIndex)
      if (e) out.set(parseInt(hexKey, 16), e.levelDataId)
    }
    return out
  } catch {
    return new Map()
  }
}

/** Load an `;@editable` asm region (overlay-first content, base-derived budget)
 *  into its structured model. */
export function loadAsmRegionResource(id: string): StringTableModel {
  const def = ASM_REGIONS[id]
  if (!def) throw new Error(`Unknown asm-region resource: "${id}".`)
  const { contentText, baseText } = readOverlayFirst(def.file)
  return def.parse(contentText, baseText, loadFontTable(frameworkWorkRoot()))
}

/**
 * Current level display names (translevel slot → name), overlay-first, for the
 * level dropdown. Re-derives from the editable level-name-string model so
 * imported / hand-edited names show in the catalog without a rebuild. Matches
 * `buildLevelsCatalog`'s derivation (join lines, normalise, strip the "1-1:"
 * slot prefix). Slots with no real name string (specials using a `nameOverride`)
 * aren't in the model and keep their catalog name. Best-effort: empty map on any
 * parse error (the catalog then keeps its extract-time names).
 */
export function levelNameOverrides(): Map<number, string> {
  try {
    const model = loadAsmRegionResource('level-name-strings')
    const baseText = readFileSync(path.join(frameworkWorkRoot(), ASM_REGIONS['level-name-strings'].file), 'utf8')
    const labelToSlot = new Map<string, number>()
    levelNameSlotLabels(baseText).forEach((label, slot) => {
      if (!labelToSlot.has(label)) labelToSlot.set(label, slot)
    })
    const out = new Map<number, string>()
    for (const e of model.entries) {
      const slot = labelToSlot.get(e.label)
      if (slot === undefined) continue
      const name = e.lines.join(' ').replace(/\s+/g, ' ').trim().replace(SLOT_PREFIX_RE, '').trim()
      if (name) out.set(slot, name)
    }
    return out
  } catch {
    return new Map()
  }
}

/** Generic resource save — dispatches on `kind`. asm-region lands in step 5. */
export async function saveResource(
  resource: EditableResource,
  model: unknown
): Promise<SaveResourceResult> {
  switch (resource.kind) {
    case 'level': {
      const r = await saveLevelResource(resource.recordId, model as LevelData)
      if (!r.ok) return r
      const files = [r.objectFile, r.spriteFile].filter(
        (f): f is string => f !== null
      )
      return { ok: true, files }
    }
    case 'asm-region':
      return saveAsmRegionResource(resource.id, model)
    case 'world-map':
      return saveWorldMapResource(model)
    default: {
      const _never: never = resource
      return { ok: false, error: `Unknown resource: ${JSON.stringify(_never)}` }
    }
  }
}

/** Splice an edited string-table model into the active project's overlay copy of
 *  the asm file and write it back (atomic). Splices onto the OVERLAY-first content
 *  so a sibling `;@editable` region in the same file (Bank51 holds both level
 *  names and message text) keeps its edits; the byte budget is sized from the
 *  pristine base. Validates charset + budget via the region's serializer; never
 *  touches base. */
export async function saveAsmRegionResource(
  id: string,
  model: unknown
): Promise<SaveResourceResult> {
  const def = ASM_REGIONS[id]
  if (!def) return { ok: false, error: `Unknown asm-region resource: "${id}".` }
  const projectId = getCurrentProjectId()
  if (!projectId) return { ok: false, error: 'No active project to save into.' }
  const compat = ensureProjectBaseCompatible(projectId)
  if (!compat.ok) return { ok: false, error: compat.error ?? 'Project base mismatch.' }

  const { contentText, baseText } = readOverlayFirst(def.file)
  const result = def.serialize(contentText, baseText, model as StringTableModel, loadFontTable(frameworkWorkRoot()))
  if (!result.ok) return { ok: false, error: result.error }

  await saveOverlayFile(projectId, def.file, result.text)
  return { ok: true, files: [def.file] }
}

// ── Palette-colour editing (§B10) ───────────────────────────────────────────
// The master palette blob is inline `dw` in yi/Banks/Bank57.asm, so a colour
// edit is an asm edit → overlay/yi/Banks/Bank57.asm (build-tree path, build
// dirty) — same overlay shape as the asm-region string editor above.

/** The active project overlay's current palette-colour edits (offset → value),
 *  diffed from base. Empty when there's no overlay / no project. */
export function loadPaletteEdits(): PaletteEdit[] {
  const projectId = getCurrentProjectId()
  const baseText = readFileSync(path.join(frameworkWorkRoot(), PALETTE_BLOB_BANK_FILE), 'utf8')
  const overlayPath = projectId ? path.join(overlayRoot(projectId), PALETTE_BLOB_BANK_FILE) : null
  const overlayText = overlayPath && existsSync(overlayPath) ? readFileSync(overlayPath, 'utf8') : null
  return readPaletteEdits(baseText, overlayText)
}

/** Splice the FULL edit set into base `Bank57.asm` → overlay (reborn from base
 *  each save, so the overlay = base + exactly these edits; empty ⇒ remove the
 *  overlay). The renderer marks the build dirty on success (asm edits don't
 *  render live in-level — same contract as string edits). */
export async function savePaletteEdits(edits: PaletteEdit[]): Promise<SaveResourceResult> {
  const projectId = getCurrentProjectId()
  if (!projectId) return { ok: false, error: 'No active project to save into.' }
  const compat = ensureProjectBaseCompatible(projectId)
  if (!compat.ok) return { ok: false, error: compat.error ?? 'Project base mismatch.' }
  const dest = path.join(overlayRoot(projectId), PALETTE_BLOB_BANK_FILE)
  if (edits.length === 0) {
    if (existsSync(dest)) await rm(dest)
    return { ok: true, files: [PALETTE_BLOB_BANK_FILE] }
  }
  const baseText = readFileSync(path.join(frameworkWorkRoot(), PALETTE_BLOB_BANK_FILE), 'utf8')
  await saveOverlayFile(projectId, PALETTE_BLOB_BANK_FILE, applyPaletteEdits(baseText, edits))
  return { ok: true, files: [PALETTE_BLOB_BANK_FILE] }
}

/** Per-level .bins for these (id, stream) pairs aren't what the build actually
 *  uses — the asm still incbin's the old shared/aliased/truncated label files, so
 *  their edits can't be written back. Some now have a resolution: 0x7D unblocks
 *  once migrated to free space, 0x19/0xCB once de-coupled (both checked live
 *  here); 0xBF/0xD0 remain blocked. Exported so the ROM importer can mark the
 *  still-blocked records un-importable up front (rather than letting the user
 *  select them and fail at apply). */
export function exceptionalSaveBlockReason(levelRecordId: number): string | null {
  if (levelRecordId === 0x7d) {
    // Migrating 0x7D emits its full 366-byte stream as a self-contained copy in a
    // free region + repoints the obj pointer, so once migrated its edits persist.
    if (getProjectRelocations(getCurrentProjectId()).includes(0x7d)) return null
    return 'Level 0x7D edits aren\'t persistable while it uses the cart\'s truncated ' +
      '225-byte object slot (DATA_169D23, whose real 366-byte stream overlaps the ' +
      'adjacent data). Resolution: migrate it to free space from the Banks panel — ' +
      'it gets its own self-contained 366-byte copy.'
  }
  if (levelRecordId === 0xbf || levelRecordId === 0xd0) {
    return `Level 0x${levelRecordId.toString(16).toUpperCase()} edits are not yet ` +
      'persistable: the cart\'s pointer table has $BF and $D0 both pointing at ' +
      'the same DATA_11DB2EEnd bytes (shared room data). Per-level write-back would ' +
      'desync the two ids. Resolution: separate the data, or accept that edits to ' +
      'one apply to both.'
  }
  if (levelRecordId === 0x19 || levelRecordId === 0xcb) {
    // De-coupling materialises the level its own sprite blob + repoints, so once
    // de-coupled the sprite stream is independently persistable.
    if (getProjectDecoupled(getCurrentProjectId()).includes(levelRecordId)) return null
    return `Level 0x${levelRecordId.toString(16).toUpperCase()} sprite-stream edits ` +
      'aren\'t persistable while it borrows its partner\'s $FFFF terminator (a ' +
      'biased `DATA_<alias>-$02` pointer). Resolution: De-couple it from the Banks ' +
      'panel — it gets its own sprite blob.'
  }
  return null
}

/** Write `data` to `file` atomically (via .tmp + rename). A string is written
 *  as UTF-8 (Node's writeFile default), a Buffer as raw bytes. */
async function writeAtomic(file: string, data: Buffer | string): Promise<void> {
  const tmp = file + '.tmp'
  await writeFile(tmp, data)
  await rename(tmp, file)
}

/** Read a workRoot-relative asm/data file overlay-first: the active project's
 *  overlay copy when it exists, else the pristine base. Returns both — splice
 *  saves need the base to size the byte budget. */
function readOverlayFirst(file: string): { contentText: string; baseText: string } {
  const baseText = readFileSync(path.join(frameworkWorkRoot(), file), 'utf8')
  const projectId = getCurrentProjectId()
  const overlayPath = projectId ? path.join(overlayRoot(projectId), file) : null
  const contentText =
    overlayPath && existsSync(overlayPath) ? readFileSync(overlayPath, 'utf8') : baseText
  return { contentText, baseText }
}

/** Write spliced `text` to a file's overlay copy (atomic, parent dir created) —
 *  the save tail every overlay-backed resource shares. The caller has already
 *  verified the active project + base compatibility. */
async function saveOverlayFile(projectId: string, file: string, text: string): Promise<void> {
  const dest = path.join(overlayRoot(projectId), file)
  await mkdir(path.dirname(dest), { recursive: true })
  await writeAtomic(dest, text)
}
