// App-side orchestrator for the "import a level from the GBA version" feature.
// Bridges the pure framework GBA reader (snes-framework/gba-import) to the
// project/overlay world: it reads an SMA3 (U) cart, lists its importable
// sublevels (analyse), and overwrites chosen SNES records in the active project
// by transcoding each GBA sublevel to LevelData and writing it through the
// editor's own save path (saveLevelResource — same round-trip-verified gate the
// level editor uses). SMA3 is a port of YI, so the conversion is near-1:1; see
// the engine module for the field-by-field mapping.
//
// The parsed cart is cached in memory between analyse and apply, keyed by path
// (mirrors rom-import.ts), so the report that crosses IPC stays lightweight.

import { readFileSync } from 'node:fs'
import { loadLevelMapPublic } from 'snes-framework/level'
import {
  identifyGbaCart,
  resolveGbaTables,
  sublevelMainOffset,
  gbaSublevelToLevelData,
  GBA_MAX_SUBLEVEL_ID,
  type GbaTables
} from 'snes-framework/gba-import'
import { bestStockSpriteset } from 'snes-framework/sprite-tile-base'
import { frameworkWorkRoot } from './framework-paths'
import { getCurrentProjectId } from './projects'
import { saveLevelResource } from './resources'
import { loadRomAndSymbols } from './render/rom-cache'
import type {
  GbaImportApplyResult,
  GbaImportApplySelection,
  GbaImportReport,
  GbaImportSublevel
} from '../shared/ipc-types'

let cached: { filePath: string; cart: Buffer; tables: GbaTables } | null = null

/** Read + parse the cart, reusing the cache when the same path is requested. */
function loadCart(filePath: string): { cart: Buffer; tables: GbaTables } {
  if (cached && cached.filePath === filePath) return cached
  const cart = readFileSync(filePath)
  const tables = resolveGbaTables(cart)
  cached = { filePath, cart, tables }
  return cached
}

/** Identify a picked GBA cart and enumerate its importable sublevels. */
export function analyzeGbaRom(filePath: string): GbaImportReport {
  let cart: Buffer
  let tables: GbaTables
  try {
    ;({ cart, tables } = loadCart(filePath))
  } catch (e) {
    return { ok: false, error: `Couldn't read "${filePath}": ${(e as Error).message}` }
  }

  const id = identifyGbaCart(cart)
  if (!id.ok) return { ok: false, error: id.reason ?? 'Unrecognized GBA ROM.' }

  const map = loadLevelMapPublic(frameworkWorkRoot())
  const sublevels: GbaImportSublevel[] = []
  for (let sid = 0; sid <= GBA_MAX_SUBLEVEL_ID; sid++) {
    if (sublevelMainOffset(cart, tables, sid) === null) continue
    try {
      const res = gbaSublevelToLevelData({
        cart,
        sublevelId: sid,
        targetRecordId: sid,
        romVersion: map.romVersion,
        snesHeaderBitWidths: map.headerBitWidths,
        snesStandardObjectInfo: map.standardObjectInfo,
        tables
      })
      sublevels.push({
        sublevelId: sid,
        objects: res.stats.objects,
        sprites: res.stats.sprites,
        exits: res.stats.exits,
        spritesDropped: res.stats.spritesDropped,
        objectsDropped: res.stats.objectsDropped,
        warnings: [...new Set(res.warnings.map((w) => w.kind))]
      })
    } catch {
      // Unreadable sublevel (corrupt/garbage pointer) — skip it.
    }
  }

  return {
    ok: true,
    filePath,
    title: id.title,
    gameCode: id.gameCode,
    crc32: `0x${id.crc32.toString(16)}`,
    sublevels
  }
}

/**
 * Overwrite the selected SNES records with their chosen GBA sublevels. Writes
 * through saveLevelResource (which serializes + round-trip-verifies before
 * touching disk), so a target with no map entry or a non-round-trippable level
 * fails cleanly into `failed` rather than corrupting the overlay. Applying marks
 * the build dirty on the renderer side (like the other import/edit tools).
 */
export async function applyGbaImport(sel: GbaImportApplySelection): Promise<GbaImportApplyResult> {
  if (!getCurrentProjectId()) return { ok: false, error: 'No active project to import into.' }

  let cart: Buffer
  let tables: GbaTables
  try {
    ;({ cart, tables } = loadCart(sel.filePath))
  } catch (e) {
    return { ok: false, error: `Couldn't read GBA ROM: ${(e as Error).message}` }
  }

  const id = identifyGbaCart(cart)
  if (!id.ok) return { ok: false, error: id.reason ?? 'Unrecognized GBA ROM.' }

  const map = loadLevelMapPublic(frameworkWorkRoot())
  // For the spriteset fit (the copied GBA header[7] is meaningless on SNES — the
  // two games have unrelated spriteset tables — so we pick the SNES stock set that
  // best covers the imported sprites). Reads the base V1.0 cart tables.
  const { rom, symbols } = loadRomAndSymbols()
  const applied: Array<{ sublevelId: number; targetRecordId: number; warnings: string[] }> = []
  const failed: Array<{ targetRecordId: number; error: string }> = []

  for (const item of sel.items) {
    try {
      const res = gbaSublevelToLevelData({
        cart,
        sublevelId: item.sublevelId,
        targetRecordId: item.targetRecordId,
        romVersion: map.romVersion,
        snesHeaderBitWidths: map.headerBitWidths,
        snesStandardObjectInfo: map.standardObjectInfo,
        tables
      })
      // Fit the SNES sprite tileset to the imported sprites (overwrites the
      // meaningless GBA header[7]).
      const fit = bestStockSpriteset(rom, symbols, res.level.sprites)
      res.level.header[7] = fit.spriteTileset
      const notes = [...new Set(res.warnings.map((w) => w.detail))]
      const id = `0x${fit.spriteTileset.toString(16).toUpperCase().padStart(2, '0')}`
      notes.push(
        fit.missingFiles.length === 0
          ? `sprite tileset set to ${id} (covers all sprites)`
          : `sprite tileset set to ${id} — ${fit.missingFiles.length} gfx file${fit.missingFiles.length === 1 ? '' : 's'} uncovered, some sprites may render wrong`
      )
      const save = await saveLevelResource(item.targetRecordId, res.level)
      if (!save.ok) {
        failed.push({ targetRecordId: item.targetRecordId, error: save.error })
        continue
      }
      applied.push({
        sublevelId: item.sublevelId,
        targetRecordId: item.targetRecordId,
        warnings: notes
      })
    } catch (e) {
      failed.push({ targetRecordId: item.targetRecordId, error: (e as Error).message })
    }
  }

  return { ok: true, applied, failed }
}
