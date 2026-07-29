// App-side orchestrator for the "import from a modified ROM" feature.
// Bridges the pure framework analyzer (snes-framework/
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
import {
  diffForeignGradient,
  gradientLabels,
  GRADIENT_PTR_BANK_FILE,
  type GradientEdit
} from 'snes-framework/gradient-edit'
import { diffForeignIslandTilemap, type IslandTilemapEdit } from 'snes-framework/island-tilemap'
import {
  diffForeignLogoTilemap,
  LOGO_TILEMAP_BANK_FILE,
  type LogoTilemapEdit
} from 'snes-framework/logo-tilemap'
import { readForeignLevelNames, loadFontMap } from 'snes-framework/levels-catalog'
import {
  ENDING_TEXT_ID,
  INTRO_STORY_ID,
  levelNameSlotLabels,
  levelNameSpillBytes,
  loadFontTable,
  messageSpillBytes,
  LEVEL_NAME_STRINGS_ID,
  MESSAGE_TEXT_ID,
  parseEndingText,
  parseIntroStory,
  parseLevelNameStrings,
  parseMessageText,
  readForeignGlyphTable,
  readForeignMessages,
  serializeEndingText,
  serializeIntroStory,
  serializeLevelNameStrings,
  serializeMessageText,
  type FontTable,
  type SerializeResult
} from 'snes-framework/strings'
import {
  diffForeignGfx,
  diffForeignRawGfx,
  type GfxDiffItem,
  type RawChrWrite
} from './rom-import-gfx'
import { applyLevelRemoval } from './level-removal'
import { snesToPC, vendoredV10SymbolMap } from 'snes-framework/symbol-map'
import { YOSHI_COLOR_SLOTS, YOSHI_COLOR_MAX } from 'snes-framework/yoshi-colors'
import type { PaletteEdit, StringTableModel, WorldMapModel, YoshiColorsModel } from 'snes-framework/types'
import type {
  RomImportApplyResult,
  RomImportGfx,
  RomImportGlyphText,
  RomImportGradient,
  RomImportLevel,
  RomImportMessages,
  RomImportNames,
  RomImportPalette,
  RomImportReport,
  RomImportSelection,
  RomImportTilemap,
  RomImportWorldMap,
  RomImportYoshiColors
} from '../shared/ipc-types'
import { frameworkWorkRoot, overlayRoot, referenceCartPath } from './framework-paths'
import { stripCopierHeader } from 'snes-framework/rom-header'
import { getCurrentProjectId, setLevelDecoupled, setLevelRelocation } from './projects'
import { loadBaseSym } from './patches'
import {
  autoMigrateImportedLevels,
  exceptionalSaveBlockReason,
  gfxBlobOverlayExists,
  registerNewSlotLevel,
  loadGradientEdits,
  loadIslandTilemapEdits,
  loadLogoTilemapEdits,
  loadPaletteEdits,
  loadWorldMapResource,
  loadYoshiColorsResource,
  poolViolationMessage,
  saveAsmRegionResource,
  saveGfxEdit,
  saveRawChrEdit,
  saveGradientEdits,
  saveIslandTilemap,
  saveLevelRawResource,
  saveLevelResource,
  saveLogoTilemap,
  savePaletteEdits,
  saveWorldMapResource,
  saveYoshiColorsResource,
  stringHeadroomBytes
} from './resources'

const LEVEL_DATA_REL = path.join('assets', 'yi', 'LevelData')
/** The asm region file the level-name editor backs onto (ASM_REGIONS). */
const NAME_BANK_REL = path.join('yi', 'SuperFX', 'Banks', 'Bank51.asm')
/** The DATATABLE asm the world-map entrance editor backs onto. */
const WORLD_MAP_REL = path.join('yi', 'Routines', 'DATATABLE_YI_LevelDataPtrsAndEntranceData.asm')
/** The Bank asm files the cutscene-text editors back onto (ASM_REGIONS). */
const INTRO_BANK_REL = path.join('yi', 'Banks', 'Bank0F.asm')
const ENDING_BANK_REL = path.join('yi', 'Banks', 'Bank0D.asm')

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
  /** Master-palette color edits to import (offset → BGR-15). */
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
  /** Backdrop-gradient stop edits to import (offset → BGR-15), or empty. */
  gradientEdits: GradientEdit[]
  /** Yoshi-color model with the hack's per-slot changes layered on, or null when none. */
  yoshiModel: YoshiColorsModel | null
  yoshiChanges: number
  /** Title-island tilemap cell edits to import, or empty. */
  islandEdits: IslandTilemapEdit[]
  /** Title-logo tilemap cell edits to import, or empty. */
  logoEdits: LogoTilemapEdit[]
  /** Intro-story model with imported changes applied, or null when none/can't apply. */
  introModel: StringTableModel | null
  introChanges: number
  /** Ending-text model with imported changes applied, or null when none/can't apply. */
  endingModel: StringTableModel | null
  endingChanges: number
  /** Changed GFX sheets to import (decompressed tiles), or empty. */
  gfxItems: GfxDiffItem[]
  /** Changed raw-CHR `.bin` patches (banks $52–$56) to import, or empty. */
  rawGfxWrites: RawChrWrite[]
  /** Records the hack cleanly emptied/removed — taken out of the project by
   *  default on apply (so the project matches the hack's level set). */
  emptiedIds: number[]
}

function sameLines(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((l, i) => l === b[i])
}

/** Diff the foreign cart's master-palette blob against base → the color edits to
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
    hasConflict: false,
    spillBytes: 0,
    spillFreeBytes: 0
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
    // Longer names than vanilla are fine now — the region grows into bank $51's
    // free tail, same as the message text (stringHeadroomBytes nets out what the
    // message region already claims, so the two can't promise the same bytes).
    const budget = { headroomBytes: stringHeadroomBytes(LEVEL_NAME_STRINGS_ID) }
    const fontMap = loadFontMap(workRoot)
    const sym = vendoredV10SymbolMap()

    const foreignNames = readForeignLevelNames(foreign, sym, fontMap)
    const baseNames = readForeignLevelNames(base, sym, fontMap)
    const slotLabels = levelNameSlotLabels(baseText)
    const model = parseLevelNameStrings(contentText, baseText, ft, budget)
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
    const res = serializeLevelNameStrings(contentText, baseText, model, ft, budget)
    const spillBytes = res.ok ? levelNameSpillBytes(res.text, baseText) : 0
    const counts = {
      changed,
      skipped,
      hasConflict,
      spillBytes,
      spillFreeBytes: Math.max(0, budget.headroomBytes - spillBytes)
    }
    if (!res.ok) return { ...counts, model: null, overBudget: true }
    return { ...counts, model, overBudget: false }
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
    hasConflict: false,
    spillBytes: 0,
    spillFreeBytes: 0
  }
  try {
    const workRoot = frameworkWorkRoot()
    const baseText = readFileSync(path.join(workRoot, NAME_BANK_REL), 'utf8')
    const overlayPath = projectId ? path.join(overlayRoot(projectId), NAME_BANK_REL) : null
    const hasConflict = !!(overlayPath && existsSync(overlayPath))
    // Load overlay-first so existing message edits are preserved + import layers on top.
    const contentText = hasConflict ? readFileSync(overlayPath!, 'utf8') : baseText
    const ft = loadFontTable(workRoot)
    // A hack that outgrew the vanilla message region moved its text into bank
    // $51's free tail (EGGCELLENT does exactly this). Our editor can do the same,
    // so give the import the same headroom the Strings panel gets — otherwise a
    // faithfully-decoded text set is rejected purely for being longer than vanilla.
    const budget = { headroomBytes: stringHeadroomBytes(MESSAGE_TEXT_ID) }

    const foreignMsgs = readForeignMessages(foreign, base, baseText, ft)
    const baseMsgs = readForeignMessages(base, base, baseText, ft)

    // Pass 1: full import (no dedup), blanking deleted slots.
    let model = parseMessageText(contentText, baseText, ft, budget)
    let counts = applyForeignMessages(model, foreignMsgs, baseMsgs, false)
    if (counts.changed === 0 && counts.blanked === 0) {
      return { ...empty, skipped: counts.skipped, hasConflict }
    }
    let res = serializeMessageText(contentText, baseText, model, ft, budget)
    if (!res.ok) {
      // Pass 2: over budget even WITH the free tail → retry deduping shared
      // foreign messages (our build keeps the base pointer table, so it can't
      // share bodies the way the hack does).
      model = parseMessageText(contentText, baseText, ft, budget)
      counts = applyForeignMessages(model, foreignMsgs, baseMsgs, true)
      res = serializeMessageText(contentText, baseText, model, ft, budget)
    }
    // What the accepted text will claim from the free tail at build time.
    const spillBytes = res.ok ? messageSpillBytes(res.text, baseText, ft) : 0
    const result = {
      changed: counts.changed,
      duplicates: counts.duplicates,
      blanked: counts.blanked,
      skipped: counts.skipped,
      hasConflict,
      spillBytes,
      spillFreeBytes: Math.max(0, budget.headroomBytes - spillBytes)
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

interface GradientAnalysis extends RomImportGradient {
  edits: GradientEdit[]
}

/**
 * Diff the foreign cart's 16 backdrop-gradient tables against base → the stop
 * edits to import, plus how many overlap the project's existing gradient edits.
 * Resolves each table's foreign address by FOLLOWING the foreign cart's
 * `DATA_bg_gradient_ptrs` table (fixed address), so a hack that relocated the
 * gradient blobs still aligns. The gradient twin of {@link analyzePalette}.
 */
function analyzeGradient(foreign: Buffer): GradientAnalysis {
  const empty: GradientAnalysis = { edits: [], changedStops: 0, conflicts: 0 }
  try {
    const sym = vendoredV10SymbolMap()
    const baseText = readFileSync(path.join(frameworkWorkRoot(), PALETTE_BLOB_BANK_FILE), 'utf8')
    const ptrText = readFileSync(path.join(frameworkWorkRoot(), GRADIENT_PTR_BANK_FILE), 'utf8')
    const labels = gradientLabels(ptrText)
    const ptrPc = sym.pc('DATA_bg_gradient_ptrs')
    // Each ptr-table entry is `dw bank, offset` (4 bytes) → a table address.
    const tablePcOf = (gradientId: number): number | null => {
      const off = ptrPc + gradientId * 4
      if (off < 0 || off + 4 > foreign.length) return null
      const pc = snesToPC((foreign.readUInt16LE(off) << 16) | foreign.readUInt16LE(off + 2))
      return pc >= 0 && pc < foreign.length ? pc : null
    }
    const edits = diffForeignGradient(baseText, labels, (gradientId, stop) => {
      const pc = tablePcOf(gradientId)
      if (pc === null) return undefined
      const at = pc + stop * 2
      return at + 1 < foreign.length ? foreign.readUInt16LE(at) : undefined
    })
    const existing = new Set(loadGradientEdits().map((e) => e.offset))
    return {
      edits,
      changedStops: edits.length,
      conflicts: edits.filter((e) => existing.has(e.offset)).length
    }
  } catch {
    return empty
  }
}

interface YoshiColorsAnalysis extends RomImportYoshiColors {
  /** The overlay-first model with the hack's per-slot color changes layered on,
   *  or null when nothing changed / can't read. */
  model: YoshiColorsModel | null
}

/**
 * Diff the foreign cart's per-level Yoshi-color table (`DATA_yoshi_level_colors`,
 * 72 bytes at a fixed vanilla address) against base and layer the changed slots
 * onto the project's overlay-first Yoshi-color model. Only meaningful on a
 * V1.0-derived cart (fixed address). A slot the hack left at vanilla is never
 * touched (unrelated user edits survive); a slot the user already edited that the
 * hack also changed counts as a conflict (import overwrites it). The Yoshi twin of
 * {@link analyzeGradient}, but model-based (like the world-map import) since the
 * table is edited as a whole model, not offset edits.
 */
function analyzeYoshiColors(foreign: Buffer, base: Buffer): YoshiColorsAnalysis {
  const empty: YoshiColorsAnalysis = { model: null, changed: 0, conflicts: 0 }
  try {
    const pc = vendoredV10SymbolMap().pc('DATA_yoshi_level_colors')
    if (pc < 0 || pc + YOSHI_COLOR_SLOTS > foreign.length || pc + YOSHI_COLOR_SLOTS > base.length) {
      return empty
    }
    // Overlay-first model = what we layer onto (preserves prior Yoshi-color edits).
    const model = loadYoshiColorsResource()
    if (model.colors.length !== YOSHI_COLOR_SLOTS) return empty
    let changed = 0
    let conflicts = 0
    for (let slot = 0; slot < YOSHI_COLOR_SLOTS; slot++) {
      const b = base[pc + slot]!
      const f = foreign[pc + slot]!
      if (f === b) continue // unchanged from vanilla
      if (f > YOSHI_COLOR_MAX) continue // not a valid color id — don't import garbage
      if (model.colors[slot] !== b) conflicts++ // project already edited this slot
      model.colors[slot] = f
      changed++
    }
    if (changed === 0) return empty
    return { model, changed, conflicts }
  } catch {
    return empty
  }
}

interface IslandAnalysis extends RomImportTilemap {
  edits: IslandTilemapEdit[]
}

/** Diff the foreign cart's title-island tilemap (`DATA_5F9800`, 1024 Mode-7 char
 *  bytes) against base → the cell edits to import + overlap with existing edits. */
function analyzeIslandTilemap(foreign: Buffer): IslandAnalysis {
  const empty: IslandAnalysis = { edits: [], changedCells: 0, conflicts: 0 }
  try {
    const pc = vendoredV10SymbolMap().pc('DATA_5F9800')
    if (pc < 0 || pc + 1024 > foreign.length) return empty
    const baseText = readFileSync(path.join(frameworkWorkRoot(), PALETTE_BLOB_BANK_FILE), 'utf8')
    const edits = diffForeignIslandTilemap(baseText, (off) => foreign[pc + off]!)
    const existing = new Set(loadIslandTilemapEdits().map((e) => e.offset))
    return {
      edits,
      changedCells: edits.length,
      conflicts: edits.filter((e) => existing.has(e.offset)).length
    }
  } catch {
    return empty
  }
}

interface LogoAnalysis extends RomImportTilemap {
  edits: LogoTilemapEdit[]
}

/** Diff the foreign cart's title-logo tilemap (`DATA_title_screen_logo_tilemap`,
 *  448 BG words) against base → the cell edits to import + overlap with existing. */
function analyzeLogoTilemap(foreign: Buffer): LogoAnalysis {
  const empty: LogoAnalysis = { edits: [], changedCells: 0, conflicts: 0 }
  try {
    const pc = vendoredV10SymbolMap().pc('DATA_title_screen_logo_tilemap')
    if (pc < 0 || pc + 448 * 2 > foreign.length) return empty
    const baseText = readFileSync(path.join(frameworkWorkRoot(), LOGO_TILEMAP_BANK_FILE), 'utf8')
    const edits = diffForeignLogoTilemap(baseText, (wordIndex) => foreign.readUInt16LE(pc + wordIndex * 2))
    const existing = new Set(loadLogoTilemapEdits().map((e) => e.offset))
    return {
      edits,
      changedCells: edits.length,
      conflicts: edits.filter((e) => existing.has(e.offset)).length
    }
  } catch {
    return empty
  }
}

interface GlyphTextAnalysis extends RomImportGlyphText {
  /** The model to save (changed entries applied), or null when nothing applies. */
  model: StringTableModel | null
  changes: number
}

/**
 * Decode a foreign cart's glyph-line text table (intro story / ending text) and
 * map well-formed, representable changes onto the editable (overlay-first) model.
 * Mirrors {@link analyzeNames}, with the cutscene-specific gate: an entry imports
 * ONLY when its BASE binary form decodes exactly to the editable model's lines
 * (so layout-control / inline-special-glyph / relocated entries are skipped, never
 * corrupted) and the foreign line count matches. Budget is pre-flighted by
 * serializing; an over-budget set can't apply.
 */
function analyzeGlyphText(
  foreign: Buffer,
  base: Buffer,
  projectId: string | null,
  id: string,
  bankFile: string,
  parse: (contentText: string, budgetText: string, ft: FontTable) => StringTableModel,
  serialize: (
    contentText: string,
    budgetText: string,
    model: StringTableModel,
    ft: FontTable
  ) => SerializeResult
): GlyphTextAnalysis {
  const empty: GlyphTextAnalysis = {
    model: null,
    changes: 0,
    changed: 0,
    skipped: 0,
    overBudget: false,
    hasConflict: false
  }
  try {
    const workRoot = frameworkWorkRoot()
    const baseText = readFileSync(path.join(workRoot, bankFile), 'utf8')
    const overlayPath = projectId ? path.join(overlayRoot(projectId), bankFile) : null
    const hasConflict = !!(overlayPath && existsSync(overlayPath))
    // Overlay-first so existing edits are preserved + the import layers on top.
    const contentText = hasConflict ? readFileSync(overlayPath!, 'utf8') : baseText
    const ft = loadFontTable(workRoot)

    const model = parse(contentText, baseText, ft) // the model we mutate + save
    const baseModel = parse(baseText, baseText, ft) // base asm — the representability gate
    const byLabel = new Map(model.entries.map((e) => [e.label, e]))
    const baseByLabel = new Map(baseModel.entries.map((e) => [e.label, e]))

    const foreignDec = readForeignGlyphTable(foreign, baseText, ft, id)
    const baseDec = readForeignGlyphTable(base, baseText, ft, id)

    let changed = 0
    let skipped = 0
    for (const [label, f] of foreignDec) {
      const b = baseDec.get(label)
      if (b && b.ok && sameLines(b.lines, f.lines)) continue // unchanged from base
      if (!f.ok) {
        skipped++ // foreign body unreadable (no terminator — likely relocated)
        continue
      }
      const baseEntry = baseByLabel.get(label)
      const entry = byLabel.get(label)
      // Only import entries whose BASE binary form matches the editable model
      // exactly — a layout-control / inline-special-glyph entry won't, so it's
      // skipped instead of being mis-decoded into the quoted-text model.
      if (!entry || !baseEntry || !b || !b.ok || !sameLines(b.lines, baseEntry.lines)) {
        skipped++
        continue
      }
      if (f.lines.length !== baseEntry.lines.length) {
        skipped++ // line structure changed — can't splice
        continue
      }
      entry.lines = f.lines
      changed++
    }

    if (changed === 0) return { ...empty, skipped, hasConflict }

    const res = serialize(contentText, baseText, model, ft)
    if (!res.ok) {
      return { model: null, changes: changed, changed, skipped, overBudget: true, hasConflict }
    }
    return { model, changes: changed, changed, skipped, overBudget: false, hasConflict }
  } catch {
    return empty
  }
}

interface GfxAnalysis extends RomImportGfx {
  items: GfxDiffItem[]
  rawWrites: RawChrWrite[]
}

/** Diff the foreign cart's graphics against base — compressed sheets (decompressed
 *  tiles) + raw-CHR `.bin`s (banks $52–$56) — plus how many overlap existing edits. */
function analyzeGfx(foreign: Buffer, base: Buffer): GfxAnalysis {
  const empty: GfxAnalysis = { items: [], rawWrites: [], changed: 0, rawFiles: 0, skipped: 0, conflicts: 0 }
  try {
    const { changed, skipped } = diffForeignGfx(foreign, base, vendoredV10SymbolMap())
    const { writes } = diffForeignRawGfx(foreign, base)
    const projectId = getCurrentProjectId()
    const overlayAssets = projectId ? path.join(overlayRoot(projectId), 'assets', 'yi') : null
    const sheetConflicts = changed.filter((it) => gfxBlobOverlayExists(it.format, it.fileId)).length
    const rawConflicts = overlayAssets
      ? writes.filter((w) => existsSync(path.join(overlayAssets, w.binFile))).length
      : 0
    return {
      items: changed,
      rawWrites: writes,
      changed: changed.length,
      rawFiles: writes.length,
      skipped,
      conflicts: sheetConflicts + rawConflicts
    }
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
  const names: RomImportNames = {
    changed: 0,
    skipped: 0,
    overBudget: false,
    hasConflict: false,
    spillBytes: 0,
    spillFreeBytes: 0
  }
  const messages: RomImportMessages = {
    changed: 0,
    duplicates: 0,
    blanked: 0,
    skipped: 0,
    overBudget: false,
    hasConflict: false,
    spillBytes: 0,
    spillFreeBytes: 0
  }
  const worldMap: RomImportWorldMap = {
    entrances: 0,
    midway: 0,
    indexRemaps: 0,
    indexSkipped: 0,
    hasConflict: false
  }
  const gradient: RomImportGradient = { changedStops: 0, conflicts: 0 }
  const yoshiColors: RomImportYoshiColors = { changed: 0, conflicts: 0 }
  const islandTilemap: RomImportTilemap = { changedCells: 0, conflicts: 0 }
  const logoTilemap: RomImportTilemap = { changedCells: 0, conflicts: 0 }
  const introStory: RomImportGlyphText = { changed: 0, skipped: 0, overBudget: false, hasConflict: false }
  const endingText: RomImportGlyphText = { changed: 0, skipped: 0, overBudget: false, hasConflict: false }
  const graphics: RomImportGfx = { changed: 0, rawFiles: 0, skipped: 0, conflicts: 0 }
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
  let gradientEdits: GradientEdit[] = []
  let yoshiModel: YoshiColorsModel | null = null
  let yoshiChanges = 0
  let islandEdits: IslandTilemapEdit[] = []
  let logoEdits: LogoTilemapEdit[] = []
  let introModel: StringTableModel | null = null
  let introChanges = 0
  let endingModel: StringTableModel | null = null
  let endingChanges = 0
  let gfxItems: GfxDiffItem[] = []
  let rawGfxWrites: RawChrWrite[] = []
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
    names.spillBytes = n.spillBytes
    names.spillFreeBytes = n.spillFreeBytes
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
    messages.spillBytes = msg.spillBytes
    messages.spillFreeBytes = msg.spillFreeBytes
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

    const grad = analyzeGradient(foreign)
    gradientEdits = grad.edits
    gradient.changedStops = grad.changedStops
    gradient.conflicts = grad.conflicts
    const yc = analyzeYoshiColors(foreign, base)
    yoshiModel = yc.model
    yoshiChanges = yc.changed
    yoshiColors.changed = yc.changed
    yoshiColors.conflicts = yc.conflicts
    const isl = analyzeIslandTilemap(foreign)
    islandEdits = isl.edits
    islandTilemap.changedCells = isl.changedCells
    islandTilemap.conflicts = isl.conflicts
    const logo = analyzeLogoTilemap(foreign)
    logoEdits = logo.edits
    logoTilemap.changedCells = logo.changedCells
    logoTilemap.conflicts = logo.conflicts
    const intro = analyzeGlyphText(
      foreign, base, projectId, INTRO_STORY_ID, INTRO_BANK_REL, parseIntroStory, serializeIntroStory
    )
    introModel = intro.model
    introChanges = intro.changes
    introStory.changed = intro.changed
    introStory.skipped = intro.skipped
    introStory.overBudget = intro.overBudget
    introStory.hasConflict = intro.hasConflict
    const ending = analyzeGlyphText(
      foreign, base, projectId, ENDING_TEXT_ID, ENDING_BANK_REL, parseEndingText, serializeEndingText
    )
    endingModel = ending.model
    endingChanges = ending.changes
    endingText.changed = ending.changed
    endingText.skipped = ending.skipped
    endingText.overBudget = ending.overBudget
    endingText.hasConflict = ending.hasConflict
    const gfx = analyzeGfx(foreign, base)
    gfxItems = gfx.items
    rawGfxWrites = gfx.rawWrites
    graphics.changed = gfx.changed
    graphics.rawFiles = gfx.rawFiles
    graphics.skipped = gfx.skipped
    graphics.conflicts = gfx.conflicts
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
    worldMapIndexRemaps,
    gradientEdits,
    yoshiModel,
    yoshiChanges,
    islandEdits,
    logoEdits,
    introModel,
    introChanges,
    endingModel,
    endingChanges,
    gfxItems,
    rawGfxWrites,
    emptiedIds: analysis.levels.filter((l) => l.emptied).map((l) => l.recordId)
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
    // fail at apply with no warning. Three of them are RESOLVABLE by a layout
    // toggle (`unblockAction`): the dialog's "unblock imports" option makes them
    // selectable and applyRomImport flips the toggle before writing.
    const exceptional = exceptionalSaveBlockReason(l.recordId)
    if (exceptional && l.importability !== 'blocked') {
      const unblockAction = UNBLOCK_ACTIONS.get(l.recordId)
      return {
        ...l,
        importability: 'blocked',
        blockedReason: exceptional,
        hasOverlayConflict,
        ...(unblockAction ? { unblockAction } : {})
      }
    }
    return { ...l, hasOverlayConflict }
  })

  const counts = {
    changed: levels.length,
    full: levels.filter((l) => l.importability === 'full').length,
    rawOnly: levels.filter((l) => l.importability === 'raw-only').length,
    // Emptied levels are marked 'blocked' by the analyzer (there's nothing to
    // import), but that's a NORMAL non-error state — the hack removed the level
    // and Shiny Egg removes it too (the emptiedRemoved cleanup on apply). Count
    // them separately so `blocked` means only genuine import problems (clobbered
    // slots, engine-driven records) the user might need to investigate.
    blocked: levels.filter((l) => l.importability === 'blocked' && !l.emptied).length,
    emptied: levels.filter((l) => l.emptied).length,
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
    gradient,
    yoshiColors,
    islandTilemap,
    logoTilemap,
    introStory,
    endingText,
    graphics,
    ...(analysis.inventory ? { inventory: analysis.inventory } : {})
  }
}

/** The resolvable exceptional-block records and the layout toggle that lifts
 *  each block (see resources.ts `exceptionalSaveBlockReason`): 0x7D needs a
 *  free-space migration (self-contained obj copy), 0x19/0xCB need a de-couple
 *  (own sprite blob). 0xBF/0xD0 have no resolution (shared obj data). */
const UNBLOCK_ACTIONS = new Map<number, 'migrate' | 'decouple'>([
  [0x7d, 'migrate'],
  [0x19, 'decouple'],
  [0xcb, 'decouple']
])

/** Merge imported `{offset,value}` edits over the project's existing edits (imported
 *  wins per offset) — the save paths rewrite the FULL set from base, so we hand
 *  them the union. Shared by palette / gradient / island / logo edits. */
function mergeOffsetEdits<T extends { offset: number; value: number }>(
  existing: readonly T[],
  imported: readonly T[]
): T[] {
  const m = new Map<number, number>(existing.map((e) => [e.offset, e.value]))
  for (const e of imported) m.set(e.offset, e.value)
  return [...m.entries()].map(([offset, value]) => ({ offset, value }) as T)
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

  // Pre-emptive unblock (when selected): flip the layout toggles that lift the
  // resolvable save blocks BEFORE the per-level writes — saveLevelResource's
  // gate checks the LIVE migrate/de-couple state, so this is what lets 0x7D /
  // 0x19 / 0xCB import. A record whose block is already resolved is skipped.
  const unblocked = { migrated: [] as number[], decoupled: [] as number[] }
  if (sel.unblock) {
    const projectId = getCurrentProjectId()!
    for (const recordId of sel.recordIds) {
      const action = UNBLOCK_ACTIONS.get(recordId)
      if (!action || exceptionalSaveBlockReason(recordId) === null) continue
      try {
        if (action === 'migrate') {
          setLevelRelocation(projectId, recordId, true)
          unblocked.migrated.push(recordId)
        } else {
          setLevelDecoupled(projectId, recordId, true)
          unblocked.decoupled.push(recordId)
        }
      } catch (err) {
        failed.push({
          recordId,
          error: `Couldn't unblock (${action}): ${(err as Error).message}`
        })
      }
    }
  }

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

  const palette = { applied: false, words: 0, error: undefined as string | undefined }
  if (sel.palette && cached.paletteEdits.length > 0) {
    const merged = mergeOffsetEdits(loadPaletteEdits(), cached.paletteEdits)
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

  // Migration awareness: the hack relocated these records' streams into ITS
  // free space; now that their (possibly grown) sizes are on disk, mark the
  // ones that no longer fit their home pools as migrated so OUR build places
  // them in the free regions too. Need-based — see autoMigrateImportedLevels.
  //
  // Runs AFTER the message save, because both claim bank $51's free tail and the
  // planner reads the message region's spill off the saved overlay. Text first is
  // the right precedence: an over-budget message save has no fallback (the text
  // is simply not imported, silently losing what the report promised), while a
  // migration that no longer fits reports `violations` the user can act on.
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

  // Backdrop gradient + title-island both write Bank57.asm, composing with the
  // palette write above (each save reborns base ⊕ palette ⊕ island ⊕ gradient
  // from the OTHER two's current on-disk sets, so applying them after palette
  // preserves it and each other). Merge imported over existing per offset.
  const gradient = { applied: false, stops: 0, error: undefined as string | undefined }
  if (sel.gradient && cached.gradientEdits.length > 0) {
    const r = await saveGradientEdits(mergeOffsetEdits(loadGradientEdits(), cached.gradientEdits))
    if (r.ok) {
      gradient.applied = true
      gradient.stops = cached.gradientEdits.length
    } else {
      gradient.error = r.error
    }
  }

  // Yoshi-color table (Bank02.asm, own file) — save the overlay-first model with
  // the hack's per-slot changes layered on. Independent of the other writes.
  const yoshiColors = { applied: false, changed: 0, error: undefined as string | undefined }
  if (sel.yoshiColors && cached.yoshiModel) {
    const r = await saveYoshiColorsResource(cached.yoshiModel)
    if (r.ok) {
      yoshiColors.applied = true
      yoshiColors.changed = cached.yoshiChanges
    } else {
      yoshiColors.error = r.error
    }
  }

  const islandTilemap = { applied: false, cells: 0, error: undefined as string | undefined }
  if (sel.islandTilemap && cached.islandEdits.length > 0) {
    const r = await saveIslandTilemap(mergeOffsetEdits(loadIslandTilemapEdits(), cached.islandEdits))
    if (r.ok) {
      islandTilemap.applied = true
      islandTilemap.cells = cached.islandEdits.length
    } else {
      islandTilemap.error = r.error
    }
  }

  // Bank0F hosts BOTH the logo tilemap and the intro-story text. Both saves now
  // splice onto the overlay-first content (disjoint regions), so they coexist —
  // order is immaterial.
  const logoTilemap = { applied: false, cells: 0, error: undefined as string | undefined }
  if (sel.logoTilemap && cached.logoEdits.length > 0) {
    const r = await saveLogoTilemap(mergeOffsetEdits(loadLogoTilemapEdits(), cached.logoEdits))
    if (r.ok) {
      logoTilemap.applied = true
      logoTilemap.cells = cached.logoEdits.length
    } else {
      logoTilemap.error = r.error
    }
  }

  const introStory = { applied: false, changed: 0, error: undefined as string | undefined }
  if (sel.introStory && cached.introModel) {
    const r = await saveAsmRegionResource(INTRO_STORY_ID, cached.introModel)
    if (r.ok) {
      introStory.applied = true
      introStory.changed = cached.introChanges
    } else {
      introStory.error = r.error
    }
  }

  // Ending text writes its own bank (Bank0D), independent of the rest.
  const endingText = { applied: false, changed: 0, error: undefined as string | undefined }
  if (sel.endingText && cached.endingModel) {
    const r = await saveAsmRegionResource(ENDING_TEXT_ID, cached.endingModel)
    if (r.ok) {
      endingText.applied = true
      endingText.changed = cached.endingChanges
    } else {
      endingText.error = r.error
    }
  }

  // Graphics: one saveGfxEdit per changed compressed sheet + one saveRawChrEdit
  // batch for the raw-CHR banks ($52–$56). Per-file errors are collected, not fatal.
  const graphics = { applied: false, files: 0, rawFiles: 0, error: undefined as string | undefined }
  if (sel.graphics && (cached.gfxItems.length > 0 || cached.rawGfxWrites.length > 0)) {
    let saved = 0
    const errs: string[] = []
    for (const it of cached.gfxItems) {
      // Tile stride from the sheet's real bpp (16 for 2bpp BG3, 32 for 4bpp) — so the
      // "tiles changed" count is exact, not assumed.
      const r = saveGfxEdit(it.format, it.fileId, it.tiles, it.rowCount, { kind: 'chr', unitBytes: it.bpp === 2 ? 16 : 32 })
      if (r.ok) saved++
      else errs.push(`0x${it.fileId.toString(16)} (${it.format}): ${r.error}`)
    }
    if (cached.rawGfxWrites.length > 0) {
      const rr = saveRawChrEdit(cached.rawGfxWrites)
      if (rr.ok) graphics.rawFiles = rr.files.length
      else errs.push(`raw CHR: ${rr.error}`)
    }
    graphics.files = saved
    graphics.applied = saved > 0 || graphics.rawFiles > 0
    if (errs.length > 0) graphics.error = errs.join('; ')
  }

  // DEFAULT cleanup: remove the levels the hack itself emptied/removed, so the
  // project matches the hack's level set and frees their bytes at the next build.
  // Runs AFTER the world-map import so the rewire operates on the imported map.
  // applyLevelRemoval filters engine-protected/already-removed records itself.
  const emptiedRemoved = { removed: [] as number[], error: undefined as string | undefined }
  if (cached.emptiedIds.length > 0) {
    try {
      const r = await applyLevelRemoval(cached.emptiedIds)
      if (r.ok) emptiedRemoved.removed = r.removed
      // "Nothing to remove" (every emptied record was engine-protected / already
      // removed) is benign — don't surface it as a failure.
      else if (!/^Nothing to remove/.test(r.error)) emptiedRemoved.error = r.error
    } catch (err) {
      emptiedRemoved.error = (err as Error).message
    }
  }

  return {
    ok: true,
    applied: full + rawOnly,
    full,
    rawOnly,
    failed,
    migration,
    unblocked,
    newSlots: applied.filter((id) => newSlotIds.has(id)),
    palette,
    names,
    messages,
    worldMap,
    gradient,
    yoshiColors,
    islandTilemap,
    logoTilemap,
    introStory,
    endingText,
    graphics,
    emptiedRemoved
  }
}
