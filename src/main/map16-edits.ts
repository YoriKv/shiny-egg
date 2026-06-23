// Map16 block-definition edits — the structured editor's project storage + the
// post-build write-back. Editing an EXISTING block's 4 sub-tiles is size-neutral,
// so edits are stored as a per-project JSON (overlayRoot/map16-edits.json) and
// applied as an 8-byte byte patch to the built ROM AFTER assembly (mirrors
// applyProjectPatches). See research/graphics-editing/object-metatile.md §7.

import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs'
import path from 'node:path'
import { mergeSymbolMaps, parseWlaSymbolMap, vendoredV10SymbolMap } from 'snes-framework/symbol-map'
import {
  applyMap16BlockEdits,
  readMap16Block as readBlock,
  map16BlockPC,
  type Map16BlockEdit
} from 'snes-framework/map16-edit'
import type { Map16SubTile } from 'snes-framework/map16'
import type { BuildResult } from 'snes-framework/build'
import { overlayRoot } from './framework-paths'
import { getCurrentProjectId } from './projects'
import { loadRomAndSymbols } from './render/rom-cache'

const EDITS_FILE = 'map16-edits.json'

/** Stored edits: hex Map16 id → its 4 sub-tile descriptors (TL, TR, BL, BR). */
type StoredMap16Edits = Record<string, Map16SubTile[]>

const editsPath = (projectId: string): string => path.join(overlayRoot(projectId), EDITS_FILE)
const idKey = (map16Id: number): string => `0x${map16Id.toString(16)}`

function readStored(projectId: string): StoredMap16Edits {
  const p = editsPath(projectId)
  if (!existsSync(p)) return {}
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as StoredMap16Edits
  } catch {
    return {}
  }
}

function writeStored(projectId: string, edits: StoredMap16Edits): void {
  const p = editsPath(projectId)
  mkdirSync(path.dirname(p), { recursive: true })
  const tmp = `${p}.tmp`
  writeFileSync(tmp, JSON.stringify(edits, null, 2))
  renameSync(tmp, p)
}

/** Load a block's current 4 sub-tiles — the overlay edit if present, else the
 *  base definition read from the built ROM. Null if not a real editable block.
 *  (After a reset-without-rebuild the built ROM still carries the old edit until
 *  the next build, the same "rebuild to apply" rule as the gfx edits.) */
export function loadMap16Block(map16Id: number): Map16SubTile[] | null {
  const projectId = getCurrentProjectId()
  const stored = projectId ? readStored(projectId)[idKey(map16Id)] : undefined
  if (stored && stored.length === 4) return stored
  const { rom, symbols } = loadRomAndSymbols()
  return readBlock(rom, symbols, map16Id)
}

/** Save a block's 4 sub-tiles to the project overlay. The renderer marks the
 *  build dirty (post-build byte patch — doesn't render live). */
export function saveMap16Block(
  map16Id: number,
  subtiles: Map16SubTile[]
): { ok: true } | { ok: false; error: string } {
  const projectId = getCurrentProjectId()
  if (!projectId) return { ok: false, error: 'No active project to save into.' }
  if (subtiles.length !== 4) return { ok: false, error: 'A Map16 block needs exactly 4 sub-tiles.' }
  const { rom, symbols } = loadRomAndSymbols()
  if (map16BlockPC(rom, symbols, map16Id) === null) {
    return { ok: false, error: `Map16 0x${map16Id.toString(16)} isn't an editable block.` }
  }
  const edits = readStored(projectId)
  edits[idKey(map16Id)] = subtiles
  writeStored(projectId, edits)
  return { ok: true }
}

/** Reset one block's edit back to vanilla (rebuild to apply). */
export function resetMap16Block(map16Id: number): { ok: true; removed: boolean } | { ok: false; error: string } {
  const projectId = getCurrentProjectId()
  if (!projectId) return { ok: false, error: 'No active project.' }
  const edits = readStored(projectId)
  const key = idKey(map16Id)
  const had = key in edits
  if (had) {
    delete edits[key]
    writeStored(projectId, edits)
  }
  return { ok: true, removed: had }
}

/** Edited block ids (for the panel's "changed" list). */
export function listMap16BlockEdits(): number[] {
  const projectId = getCurrentProjectId()
  if (!projectId) return []
  return Object.keys(readStored(projectId))
    .map((k) => parseInt(k, 16))
    .filter((n) => !Number.isNaN(n))
}

/** The project's Map16 edits as `Map16BlockEdit[]` (for the build apply). */
function projectMap16Edits(projectId: string): Map16BlockEdit[] {
  const out: Map16BlockEdit[] = []
  for (const [k, subtiles] of Object.entries(readStored(projectId))) {
    const id = parseInt(k, 16)
    if (!Number.isNaN(id) && Array.isArray(subtiles) && subtiles.length === 4) out.push({ map16Id: id, subtiles })
  }
  return out
}

/**
 * Apply the project's Map16 block-def edits to the just-built ROM (post-assembly
 * 8-byte byte patches). Mirrors `applyProjectPatches`; no-op + byte-exact when
 * none are stored. Resolves the `$4C` Map16 region via the fresh build `.sym`
 * (the vendored V1.0 symbols fill the Map16 labels if the `.sym` lacks them).
 */
export function applyMap16Edits(
  projectId: string,
  result: BuildResult
): { applied: number; bytesWritten: number; skipped: number[] } | null {
  const edits = projectMap16Edits(projectId)
  if (edits.length === 0) return null
  let sym = parseWlaSymbolMap(readFileSync(result.symbolsPath, 'utf8'))
  if (existsSync(result.superfxSymbolsPath)) {
    sym = mergeSymbolMaps(sym, parseWlaSymbolMap(readFileSync(result.superfxSymbolsPath, 'utf8')))
  }
  sym = mergeSymbolMaps(sym, vendoredV10SymbolMap()) // fresh wins; vendored fills Map16 labels
  const buf = readFileSync(result.outputPath)
  const rom = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
  const { bytesWritten, skipped } = applyMap16BlockEdits(rom, sym, edits)
  if (bytesWritten > 0) {
    const tmp = `${result.outputPath}.map16-tmp`
    writeFileSync(tmp, rom)
    renameSync(tmp, result.outputPath)
  }
  return { applied: edits.length - skipped.length, bytesWritten, skipped }
}
