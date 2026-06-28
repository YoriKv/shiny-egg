// Editable-resource registry: one generic load/save dispatch over
// every editable thing — level data today, asm-backed resources (strings, …) in
// step 5. The generic `editor:loadResource` / `editor:saveResource` IPC dispatch
// here — a single source of truth for every editable thing (the level editor
// loads and saves through the `kind:'level'` backend).

import * as path from 'node:path'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import {
  decodeLevelStreams,
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
  planAutoMigration,
  type PoolViolation
} from 'snes-framework/level-budget'
import { computeBoundaryMoves, type BoundaryMove } from 'snes-framework/boundary-move'
import { applyLevelDataLayout, type LayoutPlan } from 'snes-framework/relocate'
import { gfxBlobFileForId, parseGfxPtrTable, writeGfxEdit, GFX_ARENA } from 'snes-framework/gfx-reinsert'
import { lz2, lz16 } from 'snes-framework/decompress'
import { setGfxLiveEdit, clearGfxLiveEdit, clearGfxLiveCache, gfxLiveEdits } from './gfx-live-cache'
import { persistGfxLiveCache } from './gfx-live-persist'
import {
  carvePatchPool,
  newSlotRows,
  patchPoolGeometry,
  PATCH_POOL_REGION_ID,
  type FreeRegion,
  type PatchPoolGeometry
} from 'snes-framework/pool-map'
import { outputSfcName } from 'snes-framework/rom-versions'
import { readExtractionState } from 'snes-framework/state'
import {
  applyPaletteEdits,
  readPaletteEdits,
  PALETTE_BLOB_BANK_FILE
} from 'snes-framework/palette-edit'
import {
  applyIslandTilemapEdits,
  readIslandTilemapEdits,
  type IslandTilemapEdit
} from 'snes-framework/island-tilemap'
import {
  applyGradientEdits,
  readGradientEdits,
  readGradientTables,
  gradientLabels,
  GRADIENT_PTR_BANK_FILE,
  type GradientEdit
} from 'snes-framework/gradient-edit'
import {
  applyLogoTilemapEdits,
  readLogoTilemapEdits,
  LOGO_TILEMAP_BANK_FILE,
  type LogoTilemapEdit
} from 'snes-framework/logo-tilemap'
import { type SymbolMap } from 'snes-framework/symbol-map'
import type {
  PaletteEdit,
  PoolBudgetReport,
  PoolOverview,
  RomVersion
} from 'snes-framework/types'
import type { GfxEditEntry, GfxFileRole, ResetGfxEditResult, ResetLevelResult, SetExitDestResult, SetExitEntranceResult } from '../shared/ipc-types'
import { loadLevelGfx } from 'snes-framework/load-graphics'
import { isWorld6Record } from 'snes-framework/level'
import { loadRomAndSymbols } from './render/rom-cache'
import type { GfxFileEntry } from 'snes-framework/types'
import {
  levelNameSlotLabels,
  loadFontTable,
  parseEndingText,
  parseIntroStory,
  parseLevelNameStrings,
  parseMessagePtrTable,
  parseMessageText,
  serializeEndingText,
  serializeIntroStory,
  serializeLevelNameStrings,
  serializeMessagePtrTable,
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
  MessagePtrTableModel,
  SaveResourceResult,
  StringTableModel,
  WorldMapModel
} from 'snes-framework/types'
import { buildOutputDir, frameworkWorkRoot, overlayRoot } from './framework-paths'
import {
  ensureProjectBaseCompatible,
  getCurrentProjectId,
  getProjectDecoupled,
  getProjectNewSlots,
  getProjectRelocations,
  getProjectRemovedLevels,
  setLevelNewSlot,
  setLevelRelocation
} from './projects'
import { getPatchPoolBytes, hasEnabledAsmPatches } from './patches'

/** A loaded asm-region model — either a string/markup table or the message
 *  pointer table. The renderer narrows on `'kind' in model` / `model.markup`. */
type AsmRegionModel = StringTableModel | MessagePtrTableModel

/** Registry of editor-owned `;@editable` asm regions. Each maps a
 *  resource id to its backing file (workRoot-relative) and a parse/serialize
 *  pair built on the reusable asm primitives. Add a row to expose a new region
 *  (message-box text, item names, …) — no other wiring needed. The serialize
 *  wrappers narrow the union back to each region's concrete model. */
interface AsmRegionDef {
  file: string
  parse: (contentText: string, baseText: string, ft: FontTable) => AsmRegionModel
  serialize: (
    contentText: string,
    budgetText: string,
    model: AsmRegionModel,
    ft: FontTable
  ) => SerializeResult
}

const ASM_REGIONS: Record<string, AsmRegionDef> = {
  'level-name-strings': {
    file: 'yi/SuperFX/Banks/Bank51.asm',
    parse: parseLevelNameStrings,
    serialize: (c, b, m, ft) => serializeLevelNameStrings(c, b, m as StringTableModel, ft)
  },
  'message-box-text': {
    file: 'yi/SuperFX/Banks/Bank51.asm',
    parse: parseMessageText,
    serialize: (c, b, m, ft) => serializeMessageText(c, b, m as StringTableModel, ft)
  },
  'message-box-text-ptrs': {
    file: 'yi/SuperFX/Banks/Bank51.asm',
    parse: parseMessagePtrTable,
    serialize: (c, b, m, ft) => serializeMessagePtrTable(c, b, m as MessagePtrTableModel, ft)
  },
  'intro-story': {
    file: 'yi/Banks/Bank0F.asm',
    parse: parseIntroStory,
    serialize: (c, b, m, ft) => serializeIntroStory(c, b, m as StringTableModel, ft)
  },
  'ending-text': {
    file: 'yi/Banks/Bank0D.asm',
    parse: parseEndingText,
    serialize: (c, b, m, ft) => serializeEndingText(c, b, m as StringTableModel, ft)
  }
}

export type SaveLevelResult =
  | { ok: true; objectFile: string | null; spriteFile: string | null }
  | { ok: false; error: string }

/**
 * The level-map entry a record EFFECTIVELY has: the real extract-derived entry,
 * or — for a known new-slot record (`0xDA`/`0xDB`, base `Ptrs:` sentinel rows;
 * pool-map `newSlotRows`) — a synthetic entry naming the conventional
 * per-level files. New-slot levels exist only as project-overlay `.bin`s (a ROM
 * import writes them); the build's layout pass places the blobs in a free
 * region and repoints the row. Mirrors `loadLevel`'s own synthesis.
 */
function effectiveLevelMapEntry(
  map: ReturnType<typeof loadLevelMapPublic>,
  levelRecordId: number
): { objectFile: string | null; spriteFile: string | null } | undefined {
  const real = levelMapEntry(map.levels, levelRecordId)
  if (real) return real
  if (!newSlotRows(map.romVersion).some((r) => r.recordId === levelRecordId)) return undefined
  const hex = levelRecordId.toString(16).toUpperCase().padStart(2, '0')
  return { objectFile: `DATA_level_${hex}_obj.bin`, spriteFile: `DATA_level_${hex}_spr.bin` }
}

/** Load a level's `LevelData`, overlay-first for the active project. */
export function loadLevelResource(levelRecordId: number): LevelData {
  const projectId = getCurrentProjectId()
  return loadLevel({
    workRoot: frameworkWorkRoot(),
    levelRecordId,
    overlayRoot: projectId ? overlayRoot(projectId) : undefined
  })
}

/**
 * Defense-in-depth save guard: re-decode the bytes we're about to write and
 * confirm they reproduce the level we serialized (header field-for-field + the
 * object/sprite/exit counts). serializeLevel ↔ decodeLevelStreams round-trip by
 * design (pinned by serialize-level.test.ts), so a CLEAN level always passes —
 * this only fires on a serializer bug or corrupt in-memory LevelData, turning a
 * silent malformed-`.bin` write into a clean rejection. This is the single
 * chokepoint every editor save funnels through; the ROM-import path missed
 * exactly this class of corruption (see import/anchors.ts). Returns an error
 * string when the round-trip diverges, or null when the write is safe.
 */
function verifyLevelRoundTrip(
  level: LevelData,
  objectBytes: Buffer,
  spriteBytes: Buffer,
  headerBitWidths: number[],
  standardObjectInfo: number[]
): string | null {
  let decoded: LevelData
  try {
    decoded = decodeLevelStreams({
      recordId: level.recordId,
      romVersion: level.romVersion,
      headerBitWidths,
      standardObjectInfo,
      objectBytes,
      spriteBytes
    })
  } catch (e) {
    return `re-decode threw (${(e as Error).message})`
  }
  if (
    decoded.header.length !== level.header.length ||
    decoded.header.some((v, i) => v !== level.header[i])
  ) {
    return `header round-trip mismatch (wrote [${decoded.header}], expected [${level.header}])`
  }
  if (decoded.objects.length !== level.objects.length) {
    return `object count round-trip mismatch (${decoded.objects.length} vs ${level.objects.length})`
  }
  if (decoded.sprites.length !== level.sprites.length) {
    return `sprite count round-trip mismatch (${decoded.sprites.length} vs ${level.sprites.length})`
  }
  if (decoded.exits.length !== level.exits.length) {
    return `exit count round-trip mismatch (${decoded.exits.length} vs ${level.exits.length})`
  }
  return null
}

/** Serialize an edited level into the active project's overlay `.bin`(s). */
export async function saveLevelResource(
  levelRecordId: number,
  level: LevelData
): Promise<SaveLevelResult> {
  const map = loadLevelMapPublic(frameworkWorkRoot())
  const entry = effectiveLevelMapEntry(map, levelRecordId)
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

  // Never persist a level that doesn't survive a serialize→decode round-trip —
  // a corrupt write here would surface as a phantom object/sprite in the editor
  // (and the finder) and ship into the build. See verifyLevelRoundTrip.
  const roundTripError = verifyLevelRoundTrip(
    level,
    serialized.objectBytes,
    serialized.spriteBytes,
    map.headerBitWidths,
    map.standardObjectInfo
  )
  if (roundTripError) {
    return { ok: false, error: `Refusing to save corrupt level data: ${roundTripError}` }
  }

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
 * Save an edited graphics blob: re-encode the decompressed `tiles` and write the
 * compressed blob into the active project's overlay (`assets/yi/Graphics/`). The
 * build's reinsert pipeline (data-only / boundary-move / relocation) then places
 * it; `dl LABEL` pointers re-resolve, so no repointing. `rowCount` (lz16
 * tile-rows) is required for lz16. The renderer flags a rebuild on success
 * (graphics edits don't render live).
 */
export function saveGfxEdit(
  format: 'lz2' | 'lz16',
  fileId: number,
  tiles: Uint8Array,
  rowCount?: number
): { ok: true; file: string } | { ok: false; error: string } {
  const projectId = getCurrentProjectId()
  if (!projectId) return { ok: false, error: 'No active project to save into.' }
  const compat = ensureProjectBaseCompatible(projectId)
  if (!compat.ok) return { ok: false, error: compat.error ?? 'Project base mismatch.' }
  try {
    const file = writeGfxEdit(
      path.join(frameworkWorkRoot(), 'yi'),
      path.join(overlayRoot(projectId), 'assets', 'yi'),
      format,
      fileId,
      tiles,
      rowCount
    )
    // Mirror into the live-edit cache so the canvas previews this without a
    // rebuild (the gfx twin of the live palette draft — see gfx-live-cache.ts),
    // and persist it so the preview survives a project reopen (gfx-live-persist.ts).
    setGfxLiveEdit(format, fileId, tiles)
    persistGfxLiveCache(projectId)
    return { ok: true, file }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Write raw-CHR byte edits (edited animation frames) into the active project's
 * overlay copy of the incbin'd graphics `.bin`(s). Each write targets a `binFile`
 * (relative to `assets/yi`, e.g. `Graphics/GFX_520000.bin`) at `offset`. Reads
 * overlay-first so prior raw-CHR edits to the same `.bin` are preserved, applies
 * the byte patches, and writes the overlay copy atomically.
 *
 * These `.bin`s are fixed-size and `incbin`'d as-is, so this needs NO layout move
 * — the data-only build include (and the build-tree merge) pick up the overlay
 * copy automatically, the same way `saveGfxEdit`'s compressed blobs do.
 *
 * ⚠ These regions are SHARED: an animation's CHR is the same bytes for every
 * level that selects it (and some slots even share a source — the Star block
 * reuses the !-Switch frames). The caller surfaces that to the user.
 */
export function saveRawChrEdit(
  writes: { binFile: string; offset: number; bytes: Uint8Array }[]
): { ok: true; files: string[] } | { ok: false; error: string } {
  const projectId = getCurrentProjectId()
  if (!projectId) return { ok: false, error: 'No active project to save into.' }
  const compat = ensureProjectBaseCompatible(projectId)
  if (!compat.ok) return { ok: false, error: compat.error ?? 'Project base mismatch.' }

  const byFile = new Map<string, { offset: number; bytes: Uint8Array }[]>()
  for (const w of writes) {
    const arr = byFile.get(w.binFile) ?? []
    arr.push({ offset: w.offset, bytes: w.bytes })
    byFile.set(w.binFile, arr)
  }
  const written: string[] = []
  for (const [binFile, edits] of byFile) {
    const baseP = path.join(frameworkWorkRoot(), 'assets', 'yi', binFile)
    const overlayP = path.join(overlayRoot(projectId), 'assets', 'yi', binFile)
    let buf: Buffer
    try {
      buf = Buffer.from(existsSync(overlayP) ? readFileSync(overlayP) : readFileSync(baseP))
    } catch (e) {
      return { ok: false, error: `Couldn't read ${binFile}: ${e instanceof Error ? e.message : String(e)}` }
    }
    for (const { offset, bytes } of edits) {
      if (offset < 0 || offset + bytes.length > buf.length) {
        return { ok: false, error: `${binFile}: write at ${offset}+${bytes.length} exceeds ${buf.length} bytes` }
      }
      buf.set(bytes, offset)
    }
    mkdirSync(path.dirname(overlayP), { recursive: true })
    const tmp = overlayP + '.tmp'
    writeFileSync(tmp, buf)
    renameSync(tmp, overlayP)
    written.push(path.join('assets', 'yi', binFile))
  }
  return { ok: true, files: written }
}

/**
 * Discard a saved graphics edit: delete the overlay blob for `format`/`fileId`
 * so the next build reads the base. Returns whether an overlay existed (→ the
 * built ROM is stale, renderer flags a rebuild).
 */
export function resetGfxEdit(format: 'lz2' | 'lz16', fileId: number): { ok: boolean; removed?: boolean; error?: string } {
  const projectId = getCurrentProjectId()
  if (!projectId) return { ok: false, error: 'No active project.' }
  const file = gfxBlobFileForId(path.join(frameworkWorkRoot(), 'yi'), format, fileId)
  if (!file) return { ok: false, error: `${format} file ID ${fileId} is not a graphics blob.` }
  const p = path.join(overlayRoot(projectId), 'assets', 'yi', file) // file incl. Graphics/ or Tilemaps/
  if (!existsSync(p)) return { ok: true, removed: false }
  rmSync(p, { force: true })
  gfxLiveResetToBase(format, fileId)
  return { ok: true, removed: true }
}

/** Decompress a gfx file's BASE (vanilla) tiles — the base reference for the live
 *  preview (the gfx analogue of the palette base blob). Reads the asar-input blob
 *  under `assets/yi/` (`Graphics/` or `Tilemaps/`, validated by `gfxBlobFileForId`). */
function gfxBaseTiles(format: 'lz2' | 'lz16', fileId: number, sizeBytes: number): Uint8Array {
  const file = gfxBlobFileForId(path.join(frameworkWorkRoot(), 'yi'), format, fileId)
  if (!file) throw new Error(`no base blob for ${format} 0x${fileId.toString(16)}`)
  const blob = new Uint8Array(readFileSync(path.join(frameworkWorkRoot(), 'assets', 'yi', file)))
  const out = new Uint8Array(sizeBytes)
  if (format === 'lz16') lz16(blob, 0, out, 0, sizeBytes / 512)
  else lz2(blob, 0, out, 0)
  return out
}

/** On a gfx reset, point the live preview at the BASE (vanilla) tiles rather than
 *  dropping the entry: the canvas shows the reset immediately, overriding the built
 *  ROM (which keeps the old edit until a rebuild). Falls back to a plain clear when
 *  the file wasn't live-edited this session (no length to decode against). */
function gfxLiveResetToBase(format: 'lz2' | 'lz16', fileId: number): void {
  const prior = gfxLiveEdits().get(`${format}/${fileId}`)
  if (!prior) {
    clearGfxLiveEdit(format, fileId)
    return
  }
  try {
    setGfxLiveEdit(format, fileId, gfxBaseTiles(format, fileId, prior.length))
  } catch {
    clearGfxLiveEdit(format, fileId)
  }
}

/** Reverse-map a compressed blob filename → its gfx file id (-1 if unknown) —
 *  the inverse of `gfxBlobFileForId`, for resetting the live cache on a per-file
 *  reset. (Same lookup `listGfxEdits` uses for its labels.) */
function gfxFileIdForBlobName(name: string, format: 'lz2' | 'lz16'): number {
  try {
    const labels = parseGfxPtrTable(
      readFileSync(path.join(frameworkWorkRoot(), 'yi', GFX_ARENA.ptrBankFile), 'utf8'),
      format
    )
    return labels.indexOf(blobLabel(name))
  } catch {
    return -1
  }
}

/** Ptr-table label for a compressed blob filename, for BOTH `Graphics/GFX_<addr>.<ext>`
 *  and `Tilemaps/DATA_<addr>.<ext>` forms → `DATA_<addr>`. */
function blobLabel(name: string): string {
  return name.replace(/^GFX_/, 'DATA_').replace(/\.(lz2|lz16)$/, '')
}

/** Friendly labels for the raw `.bin`s the round-trip writes (animation CHR, the
 *  title scenery atlas, and the world-map level-icon chunky banks). Unlisted `.bin`s
 *  still track — they fall back to their filename. */
const RAW_CHR_EDIT_LABELS: Record<string, string> = {
  'GFX_520000.bin': 'Animation tiles — coins / !-blocks / star / water / lava / torches',
  'GFX_568000.bin': 'Animation tiles — clouds / water cycles / backdrop strips',
  'DATA_560000.bin': 'Title island 3D scenery (flags / mountains / castles / trees)',
  'DATA_530000.bin': 'World-map level-select icons (bank $53)',
  'DATA_538000.bin': 'World-map level-select icons (bank $53)'
}

/**
 * Every graphics file the active project has overlay-edited (the "Changed
 * graphics" list): compressed gfx blobs from saveGfxEdit (`Graphics/*.lz2|.lz16`
 * level/screen sheets AND `Tilemaps/DATA_*.lz2|.lz16` — e.g. the title island
 * $B1), plus every raw `.bin` from saveRawChrEdit (`Graphics/*.bin` animation CHR,
 * `Graphics/SuperFX/*.bin` — title scenery $56, level-icon banks $53). Compressed
 * blobs reverse-map to their gfx file id for a friendly label; raw `.bin`s use a
 * known label or fall back to the filename. Empty when there's no project / overlay.
 */
export function listGfxEdits(): GfxEditEntry[] {
  const projectId = getCurrentProjectId()
  if (!projectId) return []
  const assetsRoot = path.join(overlayRoot(projectId), 'assets', 'yi')

  // Reverse-map a compressed blob filename → gfx file id (cached per format).
  const yiRoot = path.join(frameworkWorkRoot(), 'yi')
  const labelCache: Partial<Record<'lz2' | 'lz16', string[]>> = {}
  const fileIdForBlob = (name: string, format: 'lz2' | 'lz16'): number => {
    let labels = labelCache[format]
    if (!labels) {
      try {
        labels = parseGfxPtrTable(readFileSync(path.join(yiRoot, GFX_ARENA.ptrBankFile), 'utf8'), format)
      } catch {
        labels = []
      }
      labelCache[format] = labels
    }
    return labels.indexOf(blobLabel(name))
  }

  const out: GfxEditEntry[] = []
  const scan = (dir: string, relPrefix: string): void => {
    if (!existsSync(dir)) return
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name)
      let st
      try {
        st = statSync(full)
      } catch {
        continue
      }
      if (!st.isFile()) continue
      const file = `${relPrefix}${name}`
      const m = name.match(/\.(lz2|lz16)$/)
      if (m) {
        const format = m[1] as 'lz2' | 'lz16'
        const id = fileIdForBlob(name, format)
        out.push({
          file,
          label: id >= 0 ? `Gfx file 0x${id.toString(16).toUpperCase()} (${format.toUpperCase()})` : `${name} (${format.toUpperCase()})`,
          kind: 'compressed',
          bytes: st.size
        })
      } else if (name.endsWith('.bin')) {
        // Every overlay `.bin` is a raw-CHR graphics edit — labelled where known,
        // else by filename (so nothing edited goes untracked / un-resettable).
        out.push({ file, label: RAW_CHR_EDIT_LABELS[name] ?? name, kind: 'raw-chr', bytes: st.size })
      }
    }
  }
  scan(path.join(assetsRoot, 'Graphics'), 'Graphics/')
  scan(path.join(assetsRoot, 'Graphics', 'SuperFX'), 'Graphics/SuperFX/')
  scan(path.join(assetsRoot, 'Tilemaps'), 'Tilemaps/')
  return out.sort((a, b) => a.file.localeCompare(b.file))
}

/** Screen/title graphics files NOT loaded by any LEVEL scene (so the level scan
 *  below can't classify them) → their role. Keyed by gfx file id. */
const SCREEN_FILE_ROLES: Record<number, string> = {
  0x1d: 'Title screen — logo',
  0xb1: 'Title screen — floating island',
  0xb9: 'Boss Mode-7 background', 0xba: 'Boss Mode-7 background', 0xbb: 'Boss Mode-7 background',
  0xbc: 'Boss Mode-7 background', 0xbd: 'Boss Mode-7 background',
  0x74: 'World map', 0x75: 'World map'
}

/** Cart-structural index `format/fileId` → the role(s) it's loaded as — built once
 *  by walking every distinct level tileset-combo's gfx manifest (the dpSlot fixes
 *  the layer). Static for the cart, so cache for the session. */
let gfxRoleCache: Map<string, Set<string>> | null = null
function gfxRoleIndex(): Map<string, Set<string>> {
  if (gfxRoleCache) return gfxRoleCache
  const map = new Map<string, Set<string>>()
  const add = (key: string, role: string): void => { (map.get(key) ?? map.set(key, new Set()).get(key)!).add(role) }
  try {
    const { rom, symbols } = loadRomAndSymbols()
    const workRoot = frameworkWorkRoot()
    const lvlMap = loadLevelMapPublic(workRoot)
    const seen = new Set<string>()
    for (let rec = 0; rec <= 0xdb; rec++) {
      let base: ReturnType<typeof loadLevel>
      try { base = loadLevel({ workRoot, levelRecordId: rec }) } catch { continue }
      if (base.empty || base.special || base.header.length < 15) continue
      const h = base.header
      const combo = `${h[1]},${h[3]},${h[5]},${h[7]},${h[9]}` // bg1/bg2/bg3/sprite tileset + mode
      if (seen.has(combo)) continue
      seen.add(combo)
      const header = {
        bg1Tileset: h[1] ?? 0, bg2Tileset: h[3] ?? 0, bg3Tileset: h[5] ?? 0, spriteTileset: h[7] ?? 0,
        bgColor: h[0] ?? 0, bg1Palette: h[2] ?? 0, bg2Palette: h[4] ?? 0, bg3Palette: h[6] ?? 0,
        spritePalette: h[8] ?? 0, yoshiColor: 0, isWorld6: isWorld6Record(lvlMap, rec), levelMode: h[9] ?? 0
      }
      const manifest: GfxFileEntry[] = []
      try { loadLevelGfx(rom, symbols, header as never, new Uint8Array(0x10000), manifest) } catch { continue }
      for (const e of manifest) {
        const role = e.dpSlot === undefined ? null
          : e.dpSlot <= 2 ? 'BG1 tileset'
            : e.dpSlot <= 4 ? 'BG2 background'
              : e.dpSlot <= 6 ? 'BG3 background'
                : 'Sprite sheet'
        if (role) add(`${e.format}/${e.fileId}`, role)
      }
    }
  } catch { /* leave whatever was built */ }
  gfxRoleCache = map
  return map
}

/**
 * What one changed graphics `file` maps back to — the role(s) it's loaded as
 * (e.g. "BG1 tileset", "Sprite sheet", "Title screen — logo"). Compressed blobs:
 * the cart-wide level-gfx role index + the screen-file table; raw `.bin`s: their
 * known descriptive label. The expandable "what is this" detail for the list.
 */
export function gfxFileRole(file: string): GfxFileRole {
  const name = path.basename(file)
  const roles = new Set<string>()
  try {
    const m = name.match(/\.(lz2|lz16)$/)
    if (m) {
      const format = m[1] as 'lz2' | 'lz16'
      const fileId = gfxFileIdForBlobName(name, format)
      if (fileId >= 0) {
        for (const r of gfxRoleIndex().get(`${format}/${fileId}`) ?? []) roles.add(r)
        const screen = SCREEN_FILE_ROLES[fileId]
        if (screen) roles.add(screen)
      }
    } else if (name.endsWith('.bin')) {
      roles.add(RAW_CHR_EDIT_LABELS[name] ?? 'Raw CHR graphics')
    }
  } catch { /* fall through to empty */ }
  return { roles: [...roles] }
}

/**
 * Reset one overlay-edited graphics file back to vanilla by deleting the overlay
 * copy (so the next build reads the base). `file` is an `assets/yi`-relative path
 * under `Graphics/` or `Tilemaps/` (as returned by `listGfxEdits`); validated to
 * prevent traversal. `removed` is whether an overlay actually existed (→ built ROM stale).
 */
export function resetGfxEditFile(file: string): ResetGfxEditResult {
  const projectId = getCurrentProjectId()
  if (!projectId) return { ok: false, error: 'No active project.' }
  const norm = file.replace(/\\/g, '/')
  if (norm.includes('..') || !/^(Graphics|Tilemaps)\/[\w./-]+\.(lz2|lz16|bin)$/.test(norm)) {
    return { ok: false, error: `Refusing to reset unexpected path: ${file}` }
  }
  const p = path.join(overlayRoot(projectId), 'assets', 'yi', norm)
  if (!existsSync(p)) return { ok: true, removed: false }
  rmSync(p, { force: true })
  // Drop the live-edit preview for a compressed blob (raw `.bin` edits aren't in
  // the gfx cache). Reverse-map name → id; fall back to a full clear if unknown.
  const blob = path.basename(norm).match(/\.(lz2|lz16)$/)
  if (blob) {
    const format = blob[1] as 'lz2' | 'lz16'
    const id = gfxFileIdForBlobName(path.basename(norm), format)
    if (id >= 0) gfxLiveResetToBase(format, id)
    else clearGfxLiveCache()
    persistGfxLiveCache(projectId) // keep the on-disk preview cache in sync
  }
  return { ok: true, removed: true }
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
  const entry = effectiveLevelMapEntry(map, levelRecordId)
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
  const entry = effectiveLevelMapEntry(map, levelRecordId)
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
  // A reset new-slot level has no base to fall back to — clear its flag so the
  // build stops planning a blob/repoint for it (the sentinel row returns).
  if (removed && !levelMapEntry(map.levels, levelRecordId)) {
    setLevelNewSlot(projectId, levelRecordId, false)
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

/**
 * Cross-level warp-exit entrance-type edit (the incoming-marker's Entrance
 * dropdown — the value twin of `setExitDestResource`). Set the `entranceType`
 * of the warp exit on `screenIndex` in `sourceLevelRecordId` and write that
 * level's overlay `.bin`(s). Like the dest edit, the source level is typically
 * NOT the one loaded in the editor, so this auto-saves straight to disk via the
 * vetted `saveLevelResource` path; the renderer marks the build dirty and keeps
 * a reversible undo entry.
 */
export async function setExitEntranceResource(
  sourceLevelRecordId: number,
  screenIndex: number,
  entranceType: number
): Promise<SetExitEntranceResult> {
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
  // No-op guard (defensive — the renderer already skips a same-value commit).
  if (exit.entranceType === entranceType) return { ok: true }
  const nextExits = level.exits.slice()
  nextExits[idx] = { ...exit, entranceType }
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
  const entry = effectiveLevelMapEntry(fwMap, levelRecordId)
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

/**
 * ROM-import migration awareness: after the importer writes its overlay
 * `.bin`s, mark just-imported levels migrated when their new sizes overflow
 * their home pools. `candidateIds` = imported records the HACK itself
 * relocated (its `Ptrs:` rows differ from vanilla) — the need-based planner
 * (`planAutoMigration`) picks the minimal subset that makes every pool fit and
 * the flags are persisted on the active project, so the next build's layout
 * pass places them in our free regions like the hack placed them in its own.
 * Returns the migrated ids + any violations that remain (no eligible candidate
 * left / free regions full); null when there's no pool map or project.
 */
export function autoMigrateImportedLevels(
  candidateIds: number[]
): { migrated: number[]; violations: PoolViolation[] } | null {
  const pm = activePoolMap()
  const projectId = getCurrentProjectId()
  if (!pm || !projectId || candidateIds.length === 0) return null
  const map = carvePatchPool(pm.map, activePatchPoolBytes())
  const plan = planAutoMigration(
    map,
    diskSizeOf(projectId),
    activeLayoutCtx(),
    new Set(candidateIds)
  )
  for (const id of plan.added) setLevelRelocation(projectId, id, true)
  return { migrated: plan.added, violations: plan.violations }
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

/** Free regions (FreeRegion51/50) for the active rom version — where the gfx
 *  overflow relocation spills edited blobs. Empty when no project is active. */
export function activeFreeRegions(): FreeRegion[] {
  return activePoolMap()?.map.freeRegions ?? []
}

/** The active project's free-space migration + de-couple + new-slot + removal
 *  context. */
function activeLayoutCtx(): {
  migrated: Set<number>
  decoupled: Set<number>
  newSlots: Set<number>
  removed: Set<number>
} {
  const id = getCurrentProjectId()
  return {
    migrated: new Set(getProjectRelocations(id)),
    decoupled: new Set(getProjectDecoupled(id)),
    newSlots: new Set(getProjectNewSlots(id)),
    removed: new Set(getProjectRemovedLevels(id))
  }
}

/** Active free-space migrations (record ids) — for the buildProject trigger. */
export function activeRelocations(): number[] {
  return getProjectRelocations(getCurrentProjectId())
}

/** Active de-couples (record ids) — for the buildProject trigger. */
export function activeDecoupled(): number[] {
  return getProjectDecoupled(getCurrentProjectId())
}

/** Active new-slot levels (record ids) — for the buildProject trigger. */
export function activeNewSlots(): number[] {
  return getProjectNewSlots(getCurrentProjectId())
}

/** Active REMOVED levels (record ids) — for the buildProject trigger. */
export function activeRemovedLevels(): number[] {
  return getProjectRemovedLevels(getCurrentProjectId())
}

/** The carved pool map + disk-size lens + layout context the removal module's
 *  impact preview plans with — the SAME inputs every budget view and the build
 *  layout pass use, so the preview's freed-byte figures match the build. Null
 *  when there's no pool map yet (unbuilt cart). */
export function activeLayoutPlanInputs(): {
  map: NonNullable<ReturnType<typeof poolMapFor>>
  sizeOf: (file: string) => number
  ctx: ReturnType<typeof activeLayoutCtx>
} | null {
  const pm = activePoolMap()
  if (!pm) return null
  return {
    map: carvePatchPool(pm.map, activePatchPoolBytes()),
    sizeOf: diskSizeOf(getCurrentProjectId()),
    ctx: activeLayoutCtx()
  }
}

/** Flag an imported NEW-SLOT level (`0xDA`/`0xDB`) on the active project so the
 *  build's layout pass places its overlay blobs + repoints its sentinel row. */
export function registerNewSlotLevel(levelRecordId: number): void {
  const id = getCurrentProjectId()
  if (id) setLevelNewSlot(id, levelRecordId, true)
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

/** Load the world-map entrance table (overlay-first) into its structured model.
 *  The pristine BASE index words ride along (`baseEntranceIndexWords` /
 *  `baseMidwayIndexWords`) so the world-map editor can re-wire an unwired slot
 *  (e.g. after a level removal zeroed it) back to its base records. */
export function loadWorldMapResource(): WorldMapModel {
  const { contentText, baseText } = readOverlayFirst(WORLD_MAP_FILE)
  const symbols = loadLevelIdSymbols(frameworkWorkRoot())
  const model = parseEntranceTable(contentText, symbols)
  const base = contentText === baseText ? model : parseEntranceTable(baseText, symbols)
  return {
    ...model,
    ...(base.entranceIndexWords ? { baseEntranceIndexWords: [...base.entranceIndexWords] } : {}),
    ...(base.midwayIndexWords ? { baseMidwayIndexWords: [...base.midwayIndexWords] } : {})
  }
}

/** Load the PRISTINE BASE world-map model (ignoring any project overlay) — the
 *  reference the level-restore path re-wires slots back to. */
export function loadWorldMapBaseResource(): WorldMapModel {
  const { baseText } = readOverlayFirst(WORLD_MAP_FILE)
  return parseEntranceTable(baseText, loadLevelIdSymbols(frameworkWorkRoot()))
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
export function loadAsmRegionResource(id: string): AsmRegionModel {
  const def = ASM_REGIONS[id]
  if (!def) throw new Error(`Unknown asm-region resource: "${id}".`)
  const { contentText, baseText } = readOverlayFirst(def.file)
  return def.parse(contentText, baseText, loadFontTable(frameworkWorkRoot()))
}

/** The editable CONTENT of an asm-region model — display labels/names dropped, so
 *  a base change that only relabels a region (e.g. adding friendly aliases inside
 *  the message-text region) doesn't read as a user edit. */
function regionEditableSignature(model: AsmRegionModel): string {
  if ('slots' in model) return JSON.stringify(model.slots)
  return JSON.stringify(model.entries.map((e) => ({ lines: e.lines, markup: e.markup })))
}

/**
 * Whether the overlay's editable content for region `id` genuinely differs from
 * base — i.e. the user changed it, as opposed to the region merely being
 * frozen-stale base text. (The shared-file overlay freezes a file's OTHER regions
 * at save time, so raw-text inequality alone over-reports edits.) Parses both
 * sides into the region's model and compares editable content only. Unknown
 * regions, or a parse failure, return true — preserve the overlay, never silently
 * drop edits. Used by the overlay-drift upgrade to choose keep-overlay vs
 * adopt-base per region. See src/main/overlay-upgrade.ts.
 */
export function regionUserEdited(id: string, baseText: string, overlayText: string): boolean {
  const def = ASM_REGIONS[id]
  if (!def) return true
  try {
    const ft = loadFontTable(frameworkWorkRoot())
    return (
      regionEditableSignature(def.parse(overlayText, overlayText, ft)) !==
      regionEditableSignature(def.parse(baseText, baseText, ft))
    )
  } catch {
    return true
  }
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
    const model = loadAsmRegionResource('level-name-strings') as StringTableModel
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

/** The active project overlay's island-tilemap (placement) edits vs base. */
export function loadIslandTilemapEdits(): IslandTilemapEdit[] {
  const projectId = getCurrentProjectId()
  const baseText = readFileSync(path.join(frameworkWorkRoot(), PALETTE_BLOB_BANK_FILE), 'utf8')
  const overlayPath = projectId ? path.join(overlayRoot(projectId), PALETTE_BLOB_BANK_FILE) : null
  const overlayText = overlayPath && existsSync(overlayPath) ? readFileSync(overlayPath, 'utf8') : null
  return readIslandTilemapEdits(baseText, overlayText)
}

// ── Backdrop-gradient editing ───────────────────────────────────────────────
// The 16 BG colour-gradient tables also live inline in Bank57.asm, so a gradient
// edit composes into the SAME overlay file as palette + island edits (below). The
// table labels are named by the Bank01 pointer table (constant — never edited).

/** The 16 gradient-table labels, parsed from the base Bank01 pointer table. */
function gradientLabelsFromBase(): string[] {
  const ptrText = readFileSync(path.join(frameworkWorkRoot(), GRADIENT_PTR_BANK_FILE), 'utf8')
  return gradientLabels(ptrText)
}

/** The active project overlay's gradient stop edits vs base. */
export function loadGradientEdits(): GradientEdit[] {
  const projectId = getCurrentProjectId()
  const baseText = readFileSync(path.join(frameworkWorkRoot(), PALETTE_BLOB_BANK_FILE), 'utf8')
  const overlayPath = projectId ? path.join(overlayRoot(projectId), PALETTE_BLOB_BANK_FILE) : null
  const overlayText = overlayPath && existsSync(overlayPath) ? readFileSync(overlayPath, 'utf8') : null
  return readGradientEdits(baseText, overlayText, gradientLabelsFromBase())
}

/** The 16×24 PRISTINE base gradient colours (from base Bank57). The Palette
 *  panel's gradient strip shows BASE ⊕ draft, so a reset reveals base without a
 *  rebuild — the gradient twin of the live palette re-source. */
export function loadGradientBaseColors(): number[][] {
  const baseText = readFileSync(path.join(frameworkWorkRoot(), PALETTE_BLOB_BANK_FILE), 'utf8')
  return readGradientTables(baseText, gradientLabelsFromBase())
}

/** Rebuild the project's `Bank57.asm` overlay = base ⊕ palette colour edits ⊕ island
 *  tilemap edits ⊕ gradient stop edits (ALL THREE live in this one file, so a save of
 *  any one must compose with the others' current edits or it would clobber them).
 *  Reborn from base each save (clean diffs, idempotent); all empty ⇒ remove the
 *  overlay. The renderer marks the build dirty on success (asm edits don't render
 *  live — same contract as string edits). */
async function saveBank57Overlay(
  projectId: string,
  paletteEdits: readonly PaletteEdit[],
  islandEdits: readonly IslandTilemapEdit[],
  gradientEdits: readonly GradientEdit[]
): Promise<SaveResourceResult> {
  const dest = path.join(overlayRoot(projectId), PALETTE_BLOB_BANK_FILE)
  if (paletteEdits.length === 0 && islandEdits.length === 0 && gradientEdits.length === 0) {
    if (existsSync(dest)) await rm(dest)
    return { ok: true, files: [PALETTE_BLOB_BANK_FILE] }
  }
  const baseText = readFileSync(path.join(frameworkWorkRoot(), PALETTE_BLOB_BANK_FILE), 'utf8')
  // The three edit sets touch disjoint `dw` runs (DATA_master_palette_rom_blob vs
  // DATA_5F9800 vs the 16 DATA_5FD6xx gradient tables) and are all length-preserving,
  // so applying them in sequence composes cleanly.
  const text = applyGradientEdits(
    applyIslandTilemapEdits(applyPaletteEdits(baseText, paletteEdits), islandEdits),
    gradientEdits,
    gradientLabelsFromBase()
  )
  await saveOverlayFile(projectId, PALETTE_BLOB_BANK_FILE, text)
  return { ok: true, files: [PALETTE_BLOB_BANK_FILE] }
}

/** Save the FULL palette-colour edit set, preserving any island + gradient edits. */
export async function savePaletteEdits(edits: PaletteEdit[]): Promise<SaveResourceResult> {
  const projectId = getCurrentProjectId()
  if (!projectId) return { ok: false, error: 'No active project to save into.' }
  const compat = ensureProjectBaseCompatible(projectId)
  if (!compat.ok) return { ok: false, error: compat.error ?? 'Project base mismatch.' }
  return saveBank57Overlay(projectId, edits, loadIslandTilemapEdits(), loadGradientEdits())
}

/** Save the FULL island-tilemap (placement) edit set, preserving palette + gradient edits. */
export async function saveIslandTilemap(edits: IslandTilemapEdit[]): Promise<SaveResourceResult> {
  const projectId = getCurrentProjectId()
  if (!projectId) return { ok: false, error: 'No active project to save into.' }
  const compat = ensureProjectBaseCompatible(projectId)
  if (!compat.ok) return { ok: false, error: compat.error ?? 'Project base mismatch.' }
  return saveBank57Overlay(projectId, loadPaletteEdits(), edits, loadGradientEdits())
}

/** Save the FULL gradient-stop edit set, preserving any palette + island edits. */
export async function saveGradientEdits(edits: GradientEdit[]): Promise<SaveResourceResult> {
  const projectId = getCurrentProjectId()
  if (!projectId) return { ok: false, error: 'No active project to save into.' }
  const compat = ensureProjectBaseCompatible(projectId)
  if (!compat.ok) return { ok: false, error: compat.error ?? 'Project base mismatch.' }
  return saveBank57Overlay(projectId, loadPaletteEdits(), loadIslandTilemapEdits(), edits)
}

/** The active project overlay's logo-tilemap (placement) edits vs base. (Bank0F.asm
 *  holds no other overlay-edited data, so this is a standalone base ⊕ logo overlay —
 *  unlike the island, which composes with palette edits in Bank57.asm.) */
export function loadLogoTilemapEdits(): LogoTilemapEdit[] {
  const projectId = getCurrentProjectId()
  const baseText = readFileSync(path.join(frameworkWorkRoot(), LOGO_TILEMAP_BANK_FILE), 'utf8')
  const overlayPath = projectId ? path.join(overlayRoot(projectId), LOGO_TILEMAP_BANK_FILE) : null
  const overlayText = overlayPath && existsSync(overlayPath) ? readFileSync(overlayPath, 'utf8') : null
  return readLogoTilemapEdits(baseText, overlayText)
}

/** Save the FULL logo-tilemap (placement) edit set as the Bank0F overlay (base ⊕ edits,
 *  reborn from base each save — clean diffs, idempotent; empty ⇒ remove the overlay).
 *  Asm edits don't render live, so the caller marks the build dirty (same contract as the
 *  island/string edits). */
export async function saveLogoTilemap(edits: LogoTilemapEdit[]): Promise<SaveResourceResult> {
  const projectId = getCurrentProjectId()
  if (!projectId) return { ok: false, error: 'No active project to save into.' }
  const compat = ensureProjectBaseCompatible(projectId)
  if (!compat.ok) return { ok: false, error: compat.error ?? 'Project base mismatch.' }
  const dest = path.join(overlayRoot(projectId), LOGO_TILEMAP_BANK_FILE)
  if (edits.length === 0) {
    if (existsSync(dest)) await rm(dest)
    return { ok: true, files: [LOGO_TILEMAP_BANK_FILE] }
  }
  const baseText = readFileSync(path.join(frameworkWorkRoot(), LOGO_TILEMAP_BANK_FILE), 'utf8')
  await saveOverlayFile(projectId, LOGO_TILEMAP_BANK_FILE, applyLogoTilemapEdits(baseText, edits))
  return { ok: true, files: [LOGO_TILEMAP_BANK_FILE] }
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
