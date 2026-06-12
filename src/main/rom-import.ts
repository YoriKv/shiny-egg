// App-side orchestrator for the "import from a modified ROM" feature
// (plan-rom-import.md). Bridges the pure framework analyzer (snes-framework/
// import) to the project/overlay world: it diffs a picked foreign cart against
// the extracted V1.0 base, annotates each changed level with whether the active
// project already overlays it (the overwrite warning), and applies the user's
// selection through the editor's own save paths.
//
// The heavy data (decoded foreign LevelData + raw stream bytes) is cached in
// memory between analyze and apply, keyed by the foreign cart path — the report
// that crosses IPC stays lightweight + serializable.

import { existsSync, readFileSync } from 'node:fs'
import * as path from 'node:path'
import {
  analyzeForeignRom,
  mergeForeignIndexWords,
  readForeignWorldMap,
  type AnalyzeResult,
  type ForeignImportItem
} from 'snes-framework/import'
import { loadLevelMapPublic, levelMapEntry } from 'snes-framework/level'
import { newSlotRows } from 'snes-framework/pool-map'
import { diffPaletteBlob, PALETTE_BLOB_BANK_FILE } from 'snes-framework/palette-edit'
import { readForeignLevelNames, loadFontMap } from 'snes-framework/levels-catalog'
import {
  levelNameSlotLabels,
  loadFontTable,
  parseLevelNameStrings,
  parseMessageText,
  readForeignMessages,
  serializeLevelNameStrings,
  serializeMessageText
} from 'snes-framework/strings'
import { vendoredV10SymbolMap } from 'snes-framework/symbol-map'
import type { PaletteEdit, StringTableModel, WorldMapModel } from 'snes-framework/types'
import type {
  RomImportApplyResult,
  RomImportLevel,
  RomImportMessages,
  RomImportNames,
  RomImportPalette,
  RomImportReport,
  RomImportSelection,
  RomImportWorldMap
} from '../shared/ipc-types'
import { frameworkWorkRoot, overlayRoot, referenceCartPath } from './framework-paths'
import { stripCopierHeader } from 'snes-framework/rom-header'
import { getCurrentProjectId } from './projects'
import { loadBaseSym } from './patches'
import {
  autoMigrateImportedLevels,
  exceptionalSaveBlockReason,
  registerNewSlotLevel,
  loadPaletteEdits,
  loadWorldMapResource,
  poolViolationMessage,
  saveAsmRegionResource,
  saveLevelRawResource,
  saveLevelResource,
  savePaletteEdits,
  saveWorldMapResource
} from './resources'

const LEVEL_DATA_REL = path.join('assets', 'yi', 'LevelData')
/** The asm region file the level-name editor backs onto (ASM_REGIONS). */
const NAME_BANK_REL = path.join('yi', 'SuperFX', 'Banks', 'Bank51.asm')
/** The DATATABLE asm the world-map entrance editor backs onto. */
const WORLD_MAP_REL = path.join('yi', 'Routines', 'DATATABLE_YI_LevelDataPtrsAndEntranceData.asm')

interface CachedAnalysis {
  foreignPath: string
  foreignMd5: string
  /** Decoded foreign items keyed by record id (the apply payload). */
  items: Map<number, ForeignImportItem>
  /** Records the hack RELOCATED (repointed `Ptrs:` rows) — the auto-migration
   *  candidate set (intersected with what the user actually applies). */
  relocatedIds: Set<number>
  /** NEW-SLOT records (`0xDA`/`0xDB`): no base map entry, importable as a brand
   *  new level — apply writes the overlay blobs + flags the project slot. */
  newSlotIds: Set<number>
  /** Master-palette colour edits to import (offset → BGR-15). */
  paletteEdits: PaletteEdit[]
  /** Level-name model with imported changes applied, or null when none/can't apply. */
  nameModel: StringTableModel | null
  nameChanges: number
  /** Message-text model with imported changes applied, or null when none/can't apply. */
  messageModel: StringTableModel | null
  messageChanges: number
  messageBlanked: number
  /** World-map model with imported entrance/midway/index changes applied, or null when none. */
  worldMapModel: WorldMapModel | null
  worldMapEntrances: number
  worldMapMidway: number
  worldMapIndexRemaps: number
}

function sameLines(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((l, i) => l === b[i])
}

/** Diff the foreign cart's master-palette blob against base → the colour edits to
 *  import, plus how many overlap the project's existing palette edits. */
function analyzePalette(foreign: Buffer): { edits: PaletteEdit[]; conflicts: number } {
  try {
    const blobPC = vendoredV10SymbolMap().pc('DATA_master_palette_rom_blob')
    const baseText = readFileSync(path.join(frameworkWorkRoot(), PALETTE_BLOB_BANK_FILE), 'utf8')
    const edits = diffPaletteBlob(baseText, (off) => foreign.readUInt16LE(blobPC + off))
    const existing = new Set(loadPaletteEdits().map((e) => e.offset))
    return { edits, conflicts: edits.filter((e) => existing.has(e.offset)).length }
  } catch {
    return { edits: [], conflicts: 0 }
  }
}

interface NameAnalysis extends RomImportNames {
  /** The model to save (changed entries applied), or null when nothing applies. */
  model: StringTableModel | null
}

/**
 * Decode the foreign cart's level names and map the well-formed, line-structure-
 * matching changes onto the editable Bank51 string model. Skips clobbered/garbage
 * names (GoldenEgg-style abandoned slots), line-count mismatches (a hack that
 * reflowed a 2-line name to 1), and slots with no editable base entry.
 */
function analyzeNames(foreign: Buffer, base: Buffer, projectId: string | null): NameAnalysis {
  const empty: NameAnalysis = {
    model: null,
    changed: 0,
    skipped: 0,
    overBudget: false,
    hasConflict: false
  }
  try {
    const workRoot = frameworkWorkRoot()
    const baseText = readFileSync(path.join(workRoot, NAME_BANK_REL), 'utf8')
    const overlayPath = projectId ? path.join(overlayRoot(projectId), NAME_BANK_REL) : null
    const hasConflict = !!(overlayPath && existsSync(overlayPath))
    // Load the model overlay-first so existing name edits are preserved + the
    // import layers on top of them.
    const contentText = hasConflict ? readFileSync(overlayPath!, 'utf8') : baseText
    const ft = loadFontTable(workRoot)
    const fontMap = loadFontMap(workRoot)
    const sym = vendoredV10SymbolMap()

    const foreignNames = readForeignLevelNames(foreign, sym, fontMap)
    const baseNames = readForeignLevelNames(base, sym, fontMap)
    const slotLabels = levelNameSlotLabels(baseText)
    const model = parseLevelNameStrings(contentText, baseText, ft)
    const byLabel = new Map(model.entries.map((e) => [e.label, e]))

    let changed = 0
    let skipped = 0
    for (const [slot, f] of foreignNames) {
      const b = baseNames.get(slot)
      if (b && sameLines(b.lines, f.lines)) continue // unchanged from base
      if (!f.wellFormed) {
        skipped++ // clobbered / garbage slot
        continue
      }
      const label = slotLabels[slot]
      const entry = label ? byLabel.get(label) : undefined
      if (!entry || entry.lines.length !== f.lines.length) {
        skipped++ // no editable entry, or the line structure changed
        continue
      }
      entry.lines = f.lines
      changed++
    }

    if (changed === 0) return { ...empty, skipped, hasConflict }

    // Pre-flight the budget + charset by serializing; if it won't apply, surface it.
    const res = serializeLevelNameStrings(contentText, baseText, model, ft)
    if (!res.ok) {
      return { model: null, changed, skipped, overBudget: true, hasConflict }
    }
    return { model, changed, skipped, overBudget: false, hasConflict }
  } catch {
    return empty
  }
}

interface MessageAnalysis extends RomImportMessages {
  /** The model to save (changes applied), or null when nothing applies / overflow. */
  model: StringTableModel | null
}

type MessageMaps = Map<string, { markup: string; ok: boolean; removed?: boolean }>

/**
 * Apply a foreign cart's messages onto a fresh model and report the per-outcome
 * counts. Three faithful-to-source actions:
 *  • **blank** a slot the hack deleted (pointer `$0000`) — matches the hack's own
 *    smaller layout and reclaims its bytes (the key to fitting a repacked hack
 *    like Flutter into the fixed, zero-slack message region);
 *  • **change** a body whose foreign text differs from base;
 *  • when `dedup` is on, import a foreign message **shared** across pointer slots
 *    only once (later copies keep base text) — a budget fallback, since our build
 *    keeps the base pointer table and so can't share the way the hack does.
 * Clobbered/unreadable foreign bodies (valid pointer, no terminator) are skipped.
 */
function applyForeignMessages(
  model: StringTableModel,
  foreignMsgs: MessageMaps,
  baseMsgs: MessageMaps,
  dedup: boolean
): { changed: number; duplicates: number; blanked: number; skipped: number } {
  const byLabel = new Map(model.entries.map((e) => [e.label, e]))
  const seen = new Set<string>()
  let changed = 0
  let duplicates = 0
  let blanked = 0
  let skipped = 0
  for (const [label, f] of foreignMsgs) {
    const entry = byLabel.get(label)
    if (!entry) continue
    if (f.removed) {
      if (entry.markup !== '') {
        entry.markup = '' // the hack deleted this message → blank to match
        blanked++
      }
      continue
    }
    if (!f.ok) {
      skipped++ // clobbered / no terminator within bounds
      continue
    }
    const b = baseMsgs.get(label)
    if (b && b.ok && b.markup === f.markup) continue // unchanged from base
    if (entry.markup === f.markup) continue // overlay already matches
    if (dedup) {
      if (seen.has(f.markup)) {
        duplicates++
        continue
      }
      seen.add(f.markup)
    }
    entry.markup = f.markup
    changed++
  }
  return { changed, duplicates, blanked, skipped }
}

/**
 * Decode the foreign cart's message-box text and map its changes onto the editable
 * Bank51 markup model. Follows each cart's own pointer table (see
 * {@link readForeignMessages}) so a repointed/repacked hack realigns. Imports the
 * full change set first (blanking deleted slots); only if that overflows the
 * fixed message region does it retry with shared-message dedup. Mirrors
 * {@link analyzeNames}.
 */
function analyzeMessages(foreign: Buffer, base: Buffer, projectId: string | null): MessageAnalysis {
  const empty: MessageAnalysis = {
    model: null,
    changed: 0,
    duplicates: 0,
    blanked: 0,
    skipped: 0,
    overBudget: false,
    hasConflict: false
  }
  try {
    const workRoot = frameworkWorkRoot()
    const baseText = readFileSync(path.join(workRoot, NAME_BANK_REL), 'utf8')
    const overlayPath = projectId ? path.join(overlayRoot(projectId), NAME_BANK_REL) : null
    const hasConflict = !!(overlayPath && existsSync(overlayPath))
    // Load overlay-first so existing message edits are preserved + import layers on top.
    const contentText = hasConflict ? readFileSync(overlayPath!, 'utf8') : baseText
    const ft = loadFontTable(workRoot)

    const foreignMsgs = readForeignMessages(foreign, base, baseText, ft)
    const baseMsgs = readForeignMessages(base, base, baseText, ft)

    // Pass 1: full import (no dedup), blanking deleted slots.
    let model = parseMessageText(contentText, baseText, ft)
    let counts = applyForeignMessages(model, foreignMsgs, baseMsgs, false)
    if (counts.changed === 0 && counts.blanked === 0) {
      return { ...empty, skipped: counts.skipped, hasConflict }
    }
    let res = serializeMessageText(contentText, baseText, model, ft)
    if (!res.ok) {
      // Pass 2: still over budget → retry deduping shared foreign messages.
      model = parseMessageText(contentText, baseText, ft)
      counts = applyForeignMessages(model, foreignMsgs, baseMsgs, true)
      res = serializeMessageText(contentText, baseText, model, ft)
    }
    const result = {
      changed: counts.changed,
      duplicates: counts.duplicates,
      blanked: counts.blanked,
      skipped: counts.skipped,
      hasConflict
    }
    if (!res.ok) return { ...result, model: null, overBudget: true }
    return { ...result, model, overBudget: false }
  } catch {
    return empty
  }
}

interface WorldMapAnalysis extends RomImportWorldMap {
  /** The model with imported changes applied, or null when nothing changed. */
  model: WorldMapModel | null
}

/**
 * Diff the foreign cart's world-map entrance + midway RECORD tables against base
 * and map the changed records onto the editable (overlay-first) world-map model.
 * Covers what the world-map editor edits — per-record level-data id (which
 * level a world-map tile plays), spawn X/Y, the main table's progression target,
 * the midway table's re-entry state — PLUS (RI4) the translevel→record INDEX
 * tables: a hack that re-pointed which entrance record a world-map slot uses
 * imports through the raw index-word arrays (editable asm regions). Imported
 * records win over the project's existing world-map edits per record (mirrors
 * analyzeNames); a record the hack left at vanilla is never touched, so
 * unrelated user edits survive. Reads at the vanilla table addresses — only
 * valid on a V1.0-derived cart (the caller gates on `baseDerived`).
 */
function analyzeWorldMap(foreign: Buffer, base: Buffer, projectId: string | null): WorldMapAnalysis {
  const empty: WorldMapAnalysis = {
    model: null,
    entrances: 0,
    midway: 0,
    indexRemaps: 0,
    indexSkipped: 0,
    hasConflict: false
  }
  try {
    const overlayPath = projectId ? path.join(overlayRoot(projectId), WORLD_MAP_REL) : null
    const hasConflict = !!(overlayPath && existsSync(overlayPath))
    // Overlay-first model = what we layer onto (preserves prior world-map edits).
    const model = loadWorldMapResource()
    const sym = vendoredV10SymbolMap()
    const mainCount = model.entrances.length
    const midwayCount = model.midway.length
    const mainIdxCount = model.entranceIndexWords?.length ?? 0
    const midIdxCount = model.midwayIndexWords?.length ?? 0

    const baseWm = readForeignWorldMap(base, sym, mainCount, midwayCount, mainIdxCount, midIdxCount)
    const hackWm = readForeignWorldMap(foreign, sym, mainCount, midwayCount, mainIdxCount, midIdxCount)
    if (!baseWm.resolved || !hackWm.resolved) return { ...empty, hasConflict }

    let entrances = 0
    for (let i = 0; i < mainCount; i++) {
      const b = baseWm.entrances[i]
      const f = hackWm.entrances[i]
      if (
        b.levelDataId === f.levelDataId &&
        b.spawnX === f.spawnX &&
        b.spawnY === f.spawnY &&
        b.progTarget === f.progTarget
      ) {
        continue // unchanged from vanilla
      }
      const m = model.entrances[i]
      m.levelDataId = f.levelDataId
      m.spawnX = f.spawnX
      m.spawnY = f.spawnY
      m.progTarget = f.progTarget
      entrances++
    }

    let midway = 0
    for (let i = 0; i < midwayCount; i++) {
      const b = baseWm.midway[i]
      const f = hackWm.midway[i]
      if (
        b.levelDataId === f.levelDataId &&
        b.spawnX === f.spawnX &&
        b.spawnY === f.spawnY &&
        b.entranceState === f.entranceState
      ) {
        continue
      }
      const m = model.midway[i]
      m.levelDataId = f.levelDataId
      m.spawnX = f.spawnX
      m.spawnY = f.spawnY
      m.entranceState = f.entranceState
      midway++
    }

    // RI4: the translevel→record INDEX remap (which entrance record a slot
    // uses). The framework merge gates per-word validity AND wholesale-clobbered
    // tables (e.g. Flutter repurposes the midway index for its own data).
    const mainIdx = mergeForeignIndexWords(
      model.entranceIndexWords,
      hackWm.entranceIndexWords,
      baseWm.entranceIndexWords,
      mainCount
    )
    const midIdx = mergeForeignIndexWords(
      model.midwayIndexWords,
      hackWm.midwayIndexWords,
      baseWm.midwayIndexWords,
      midwayCount
    )
    const indexRemaps = mainIdx.remapped + midIdx.remapped
    const indexSkipped = mainIdx.skipped + midIdx.skipped

    if (entrances === 0 && midway === 0 && indexRemaps === 0) {
      return { ...empty, indexSkipped, hasConflict }
    }
    return { model, entrances, midway, indexRemaps, indexSkipped, hasConflict }
  } catch {
    return empty
  }
}

// One analysis at a time (the import is a modal flow). apply() consumes this.
let cached: CachedAnalysis | null = null

/** Analyse a foreign cart against the extracted V1.0 base and build the report. */
export function analyzeRom(foreignPath: string): RomImportReport {
  if (!existsSync(foreignPath)) {
    return { ok: false, error: `File not found: ${foreignPath}` }
  }
  const basePath = referenceCartPath()
  if (!existsSync(basePath)) {
    return {
      ok: false,
      error:
        'No extracted base ROM found. Extract a USA V1.0 cart first — the import ' +
        'diffs the modified ROM against that byte-identical base.'
    }
  }

  let result: AnalyzeResult
  let foreign: Buffer
  let base: Buffer
  try {
    // Strip an external 512-byte copier header from the imported cart (if present)
    // so it aligns with the unheadered base for the byte diff + MD5. The base is
    // our own (unheadered) reference stash. See rom-header.ts.
    foreign = stripCopierHeader(readFileSync(foreignPath))
    base = readFileSync(basePath)
    // The base build's full symbol map refines the diff inventory's attribution
    // (nearest-label examples); analysis works without it (coarse bands).
    const symbols = loadBaseSym()
    result = analyzeForeignRom(foreign, base, symbols ? { symbols } : {})
  } catch (err) {
    return { ok: false, error: `Failed to read/analyse ROM: ${(err as Error).message}` }
  }
  const { analysis, items } = result

  // Annotate each changed level with whether the active project ALREADY overlays
  // it — importing overwrites those user edits (the warning the UI surfaces).
  const projectId = getCurrentProjectId()

  // Palette + level-name diffs are global (not per-level) and only meaningful on a
  // V1.0-derived cart (their tables sit at fixed vanilla addresses).
  const palette: RomImportPalette = { changedWords: 0, conflicts: 0 }
  const names: RomImportNames = { changed: 0, skipped: 0, overBudget: false, hasConflict: false }
  const messages: RomImportMessages = {
    changed: 0,
    duplicates: 0,
    blanked: 0,
    skipped: 0,
    overBudget: false,
    hasConflict: false
  }
  const worldMap: RomImportWorldMap = {
    entrances: 0,
    midway: 0,
    indexRemaps: 0,
    indexSkipped: 0,
    hasConflict: false
  }
  let paletteEdits: PaletteEdit[] = []
  let nameModel: StringTableModel | null = null
  let nameChanges = 0
  let messageModel: StringTableModel | null = null
  let messageChanges = 0
  let messageBlanked = 0
  let worldMapModel: WorldMapModel | null = null
  let worldMapEntrances = 0
  let worldMapMidway = 0
  let worldMapIndexRemaps = 0
  if (analysis.baseDerived) {
    const p = analyzePalette(foreign)
    paletteEdits = p.edits
    palette.changedWords = p.edits.length
    palette.conflicts = p.conflicts
    const n = analyzeNames(foreign, base, projectId)
    nameModel = n.model
    nameChanges = n.changed
    names.changed = n.changed
    names.skipped = n.skipped
    names.overBudget = n.overBudget
    names.hasConflict = n.hasConflict
    const msg = analyzeMessages(foreign, base, projectId)
    messageModel = msg.model
    messageChanges = msg.changed
    messageBlanked = msg.blanked
    messages.changed = msg.changed
    messages.duplicates = msg.duplicates
    messages.blanked = msg.blanked
    messages.skipped = msg.skipped
    messages.overBudget = msg.overBudget
    messages.hasConflict = msg.hasConflict
    const wm = analyzeWorldMap(foreign, base, projectId)
    worldMapModel = wm.model
    worldMapEntrances = wm.entrances
    worldMapMidway = wm.midway
    worldMapIndexRemaps = wm.indexRemaps
    worldMap.entrances = wm.entrances
    worldMap.midway = wm.midway
    worldMap.indexRemaps = wm.indexRemaps
    worldMap.indexSkipped = wm.indexSkipped
    worldMap.hasConflict = wm.hasConflict
  }

  // Mutated by the level classification below (same reference shared with the
  // cache, so apply sees the final set).
  const newSlotIds = new Set<number>()

  cached = {
    foreignPath,
    foreignMd5: analysis.foreignMd5,
    items: new Map(items.map((i) => [i.recordId, i])),
    relocatedIds: new Set(analysis.levels.filter((l) => l.relocated).map((l) => l.recordId)),
    newSlotIds,
    paletteEdits,
    nameModel,
    nameChanges,
    messageModel,
    messageChanges,
    messageBlanked,
    worldMapModel,
    worldMapEntrances,
    worldMapMidway,
    worldMapIndexRemaps
  }

  const map = loadLevelMapPublic(frameworkWorkRoot())
  const overlayDir = projectId ? path.join(overlayRoot(projectId), LEVEL_DATA_REL) : null
  // Records with NO base map entry can only import as NEW levels, and only into
  // the known sentinel slots (0xDA/0xDB) — the build repoints their Ptrs row at
  // freshly placed free-region blobs. Anything else without an entry is blocked.
  const newSlotIdSet = new Set(newSlotRows(map.romVersion).map((r) => r.recordId))

  const levels: RomImportLevel[] = analysis.levels.map((l) => {
    const entry = levelMapEntry(map.levels, l.recordId)
    let hasOverlayConflict = false
    if (overlayDir) {
      const files = entry
        ? [entry.objectFile, entry.spriteFile]
        : [
            `DATA_level_${l.recordId.toString(16).toUpperCase().padStart(2, '0')}_obj.bin`,
            `DATA_level_${l.recordId.toString(16).toUpperCase().padStart(2, '0')}_spr.bin`
          ]
      for (const f of files) {
        if (f && existsSync(path.join(overlayDir, f))) {
          hasOverlayConflict = true
          break
        }
      }
    }
    if (!entry && l.importability !== 'blocked') {
      if (newSlotIdSet.has(l.recordId)) {
        newSlotIds.add(l.recordId)
        return { ...l, isNew: true, hasOverlayConflict }
      }
      return {
        ...l,
        importability: 'blocked',
        blockedReason: 'No editable slot for this record (not a known sentinel row).',
        hasOverlayConflict
      }
    }
    // The 5 aliased/oversized records can't be written per-level (the build still
    // reads a shared/old label file). The framework analyzer can't know that, so
    // override to blocked here — otherwise the user could select one and have it
    // fail at apply with no warning.
    const exceptional = exceptionalSaveBlockReason(l.recordId)
    const classified: RomImportLevel =
      exceptional && l.importability !== 'blocked'
        ? { ...l, importability: 'blocked', blockedReason: exceptional, hasOverlayConflict }
        : { ...l, hasOverlayConflict }
    return classified
  })

  const counts = {
    changed: levels.length,
    full: levels.filter((l) => l.importability === 'full').length,
    rawOnly: levels.filter((l) => l.importability === 'raw-only').length,
    blocked: levels.filter((l) => l.importability === 'blocked').length,
    conflicts: levels.filter((l) => l.hasOverlayConflict).length
  }

  return {
    ok: true,
    foreignPath,
    foreignMd5: analysis.foreignMd5,
    baseDerived: analysis.baseDerived,
    levelPtrsResolved: analysis.levelPtrsResolved,
    anchors: analysis.anchors,
    levels,
    counts,
    palette,
    names,
    messages,
    worldMap,
    ...(analysis.inventory ? { inventory: analysis.inventory } : {})
  }
}

/** Merge imported palette edits over the project's existing edits (imported wins
 *  per colour offset) — savePaletteEdits rewrites the FULL set from base. */
function mergePaletteEdits(existing: PaletteEdit[], imported: PaletteEdit[]): PaletteEdit[] {
  const m = new Map(existing.map((e) => [e.offset, e.value]))
  for (const e of imported) m.set(e.offset, e.value)
  return [...m.entries()].map(([offset, value]) => ({ offset, value }))
}

/** Apply the user-selected records to the active project's overlay. */
export async function applyRomImport(sel: RomImportSelection): Promise<RomImportApplyResult> {
  if (!cached) {
    return { ok: false, error: 'No analysis to apply — analyse a ROM first.' }
  }
  if (!getCurrentProjectId()) {
    return { ok: false, error: 'No active project to import into.' }
  }

  let full = 0
  let rawOnly = 0
  const failed: Array<{ recordId: number; error: string }> = []
  const applied: number[] = []
  const { relocatedIds, newSlotIds } = cached

  for (const recordId of sel.recordIds) {
    const item = cached.items.get(recordId)
    if (!item) {
      failed.push({ recordId, error: 'Not in the analysed change set.' })
      continue
    }
    const res =
      item.importability === 'full'
        ? await saveLevelResource(recordId, item.level)
        : await saveLevelRawResource(recordId, item.objBytes, item.sprBytes)
    if (!res.ok) {
      failed.push({ recordId, error: res.error })
      continue
    }
    applied.push(recordId)
    // A new-slot record's overlay blobs are on disk now — flag the project so
    // the build's layout pass places them + repoints the sentinel Ptrs row.
    if (newSlotIds.has(recordId)) {
      try {
        registerNewSlotLevel(recordId)
      } catch (err) {
        failed.push({ recordId, error: `Imported, but couldn't flag the new slot: ${(err as Error).message}` })
      }
    }
    if (item.importability === 'full') full++
    else rawOnly++
  }

  // Migration awareness: the hack relocated these records' streams into ITS
  // free space; now that their (possibly grown) sizes are on disk, mark the
  // ones that no longer fit their home pools as migrated so OUR build places
  // them in the free regions too. Need-based — see autoMigrateImportedLevels.
  const migration = { applied: 0, recordIds: [] as number[], warning: undefined as string | undefined }
  // New slots aren't migration candidates — their placement is the newSlots
  // layout path, not the migrated set (they have no home pool to overflow).
  const migrationCandidates = applied.filter((id) => relocatedIds.has(id) && !newSlotIds.has(id))
  if (migrationCandidates.length > 0) {
    const m = autoMigrateImportedLevels(migrationCandidates)
    if (m) {
      migration.applied = m.migrated.length
      migration.recordIds = m.migrated
      if (m.violations.length > 0) {
        migration.warning = poolViolationMessage(m.violations)
      }
    }
  }

  const palette = { applied: false, words: 0, error: undefined as string | undefined }
  if (sel.palette && cached.paletteEdits.length > 0) {
    const merged = mergePaletteEdits(loadPaletteEdits(), cached.paletteEdits)
    const r = await savePaletteEdits(merged)
    if (r.ok) {
      palette.applied = true
      palette.words = cached.paletteEdits.length
    } else {
      palette.error = r.error
    }
  }

  const names = { applied: false, changed: 0, error: undefined as string | undefined }
  if (sel.names && cached.nameModel) {
    const r = await saveAsmRegionResource('level-name-strings', cached.nameModel)
    if (r.ok) {
      names.applied = true
      names.changed = cached.nameChanges
    } else {
      names.error = r.error
    }
  }

  // Names + messages share Bank51.asm; saveAsmRegionResource now splices onto the
  // overlay-first content, so applying messages after names preserves the names.
  const messages = {
    applied: false,
    changed: 0,
    blanked: 0,
    error: undefined as string | undefined
  }
  if (sel.messages && cached.messageModel) {
    const r = await saveAsmRegionResource('message-box-text', cached.messageModel)
    if (r.ok) {
      messages.applied = true
      messages.changed = cached.messageChanges
      messages.blanked = cached.messageBlanked
    } else {
      messages.error = r.error
    }
  }

  // The world map writes its own file (the DATATABLE asm), independent of the
  // levels / Bank51 / Bank57 overlays above — order is immaterial.
  const worldMap = {
    applied: false,
    entrances: 0,
    midway: 0,
    indexRemaps: 0,
    error: undefined as string | undefined
  }
  if (sel.worldMap && cached.worldMapModel) {
    const r = await saveWorldMapResource(cached.worldMapModel)
    if (r.ok) {
      worldMap.applied = true
      worldMap.entrances = cached.worldMapEntrances
      worldMap.midway = cached.worldMapMidway
      worldMap.indexRemaps = cached.worldMapIndexRemaps
    } else {
      worldMap.error = r.error
    }
  }

  return {
    ok: true,
    applied: full + rawOnly,
    full,
    rawOnly,
    failed,
    migration,
    newSlots: applied.filter((id) => newSlotIds.has(id)),
    palette,
    names,
    messages,
    worldMap
  }
}
