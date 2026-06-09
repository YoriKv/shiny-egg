// World-map entrance-table editor backend.
// Parse/serialize the `DATA_map_level_entrances` records in the
// `;@editable:world-map-entrances` region of
// yi/Routines/DATATABLE_YI_LevelDataPtrsAndEntranceData.asm.
//
// Edit strategy: format-preserving in-place operand splice (same contract as the
// string editor, but over `db` operands instead of `"..."` literals). Only the
// operand a field changed is rewritten — comments, indentation, the index table,
// and unedited rows' `!Define_*` symbols all survive byte-for-byte. Records are a
// fixed 4 bytes, so there's no byte budget to enforce.

import { findRegion, spliceRegion } from './asm/markers.ts'
import { applyEdits, stripComment, type TextEdit } from './asm/text-literals.ts'
import { hex0x } from './hex.ts'
import {
  formatByte,
  formatLevelId,
  formatWord,
  parseDbRecords,
  parseDwRecords,
  type LevelIdSymbols
} from './asm/entrance-table.ts'
import type { WorldMapEntrance, WorldMapMidwayEntrance, WorldMapModel } from './types.ts'

export { loadLevelIdSymbols, parseLevelIdSymbols, type LevelIdSymbols } from './asm/entrance-table.ts'

/** Marker id of the main world-map entrance table region. */
export const WORLD_MAP_ENTRANCES_ID = 'world-map-entrances'
/** Marker id of the midway/checkpoint entrance table region. */
export const WORLD_MAP_MIDWAY_ENTRANCES_ID = 'world-map-midway-entrances'

/** Operands per entrance record: `db levelDataId, entX, entY, progTarget`. */
const FIELDS_PER_RECORD = 4
const F_LEVEL = 0
const F_X = 1
const F_Y = 2
const F_PROG = 3

export type SerializeResult = { ok: true; text: string } | { ok: false; error: string }

/**
 * Parse an index word table (`label:` followed by `dw $XXXX,…`) that maps a
 * world-map tile slot → a byte offset into a records table, into translevel →
 * record index (offset/4). The table sits OUTSIDE the editable region. Keys are
 * padded hex (`0x07`) to match level-map.json + the renderer's hex0x, so the
 * panel's translevel → record lookup is exact.
 *
 * `dropZeroPadding` distinguishes the two callers: the MAIN index keeps every
 * slot (a `$0000` collapses to record 0 = the first real record; the renderer
 * filters to real slots via the catalog). The MIDWAY index drops `$0000` slots
 * (except translevel 0) because there a `$0000` means "no midway" — a real slot
 * like 1-Extra must be absent, not mapped to record 0.
 */
function parseIndexTable(
  fileText: string,
  label: string,
  dropZeroPadding: boolean
): Record<string, number> {
  const lines = fileText.split('\n')
  const start = lines.findIndex((l) => stripComment(l).trim() === `${label}:`)
  const out: Record<string, number> = {}
  if (start < 0) return out
  const words: number[] = []
  for (let i = start + 1; i < lines.length; i++) {
    const code = stripComment(lines[i]).trim()
    const m = /^dw\s+(.+)$/.exec(code)
    if (m) {
      for (const tok of m[1].split(',')) {
        const mm = /^\$([0-9A-Fa-f]+)$/.exec(tok.trim())
        if (mm) words.push(parseInt(mm[1], 16))
      }
      continue
    }
    if (words.length === 0) continue // pre-table label/blank lines
    if (code === '') continue // tolerate the blank/comment gap after the table
    break // first real non-`dw` line (the next label) ends the table
  }
  words.forEach((w, translevel) => {
    if (dropZeroPadding && w === 0 && translevel !== 0) return // no midway here
    out[hex0x(translevel, 2)] = Math.floor(w / 4)
  })
  return out
}

/** Decode a midway `dw`-packed record into its 4 byte-fields. word0 =
 *  (spawnX<<8)|levelDataId, word1 = (entranceState<<8)|spawnY. */
function decodeMidway(index: number, w0: number, w1: number): WorldMapMidwayEntrance {
  return {
    index,
    levelDataId: w0 & 0xff,
    spawnX: (w0 >> 8) & 0xff,
    spawnY: w1 & 0xff,
    entranceState: (w1 >> 8) & 0xff
  }
}

/** Parse both entrance table regions (+ their index tables) into the editor
 *  model. Throws if the `;@editable` markers are absent. */
export function parseEntranceTable(fileText: string, symbols: LevelIdSymbols): WorldMapModel {
  const region = findRegion(fileText, WORLD_MAP_ENTRANCES_ID)
  if (!region) throw new Error(`Missing ;@editable:${WORLD_MAP_ENTRANCES_ID} markers.`)
  const records = parseDbRecords(region.inner, FIELDS_PER_RECORD, symbols)
  const entrances: WorldMapEntrance[] = records.map((r) => ({
    index: r.index,
    levelDataId: r.operands[F_LEVEL].value,
    spawnX: r.operands[F_X].value,
    spawnY: r.operands[F_Y].value,
    progTarget: r.operands[F_PROG].value
  }))

  const midRegion = findRegion(fileText, WORLD_MAP_MIDWAY_ENTRANCES_ID)
  if (!midRegion) throw new Error(`Missing ;@editable:${WORLD_MAP_MIDWAY_ENTRANCES_ID} markers.`)
  const midway = parseDwRecords(midRegion.inner, symbols).map((r) =>
    decodeMidway(r.index, r.words[0].value, r.words[1].value)
  )

  return {
    entrances,
    // dropZeroPadding: a `$0000` main offset means "no main entrance" (bonus /
    // mini-game / padding slots that sit on the world map but load through a
    // separate system) — exclude them so they don't collapse onto record 0 and
    // collide with 1-1. Translevel 0 legitimately maps to record 0.
    translevelToRecordIndex: parseIndexTable(fileText, 'DATA_level_entrance_indexes', true),
    midway,
    midwayIndex: parseIndexTable(fileText, 'DATA_level_midway_entrance_indexes', true)
  }
}

function badByte(label: string, index: number, field: string, v: number): SerializeResult {
  return { ok: false, error: `${label} #${index} ${field} value ${v} is not a byte (0–255).` }
}

/** Splice the edited MAIN entrance records onto `fileText`. */
function spliceMain(
  fileText: string,
  entrances: WorldMapEntrance[],
  symbols: LevelIdSymbols
): SerializeResult {
  const region = findRegion(fileText, WORLD_MAP_ENTRANCES_ID)
  if (!region) return { ok: false, error: `Missing ;@editable:${WORLD_MAP_ENTRANCES_ID} markers.` }
  const base = parseDbRecords(region.inner, FIELDS_PER_RECORD, symbols)
  if (entrances.length !== base.length) {
    return { ok: false, error: `Model has ${entrances.length} entrance records; the base file has ${base.length} (out of date?).` }
  }
  const edits: TextEdit[] = []
  for (const e of entrances) {
    const rec = base[e.index]
    if (!rec) return { ok: false, error: `Entrance record #${e.index} is not in the base file (out of date?).` }
    const want = [e.levelDataId, e.spawnX, e.spawnY, e.progTarget]
    for (let f = 0; f < FIELDS_PER_RECORD; f++) {
      const v = want[f]
      if (!Number.isInteger(v) || v < 0 || v > 0xff) return badByte('Entrance record', e.index, `field ${f}`, v)
      const op = rec.operands[f]
      if (v === op.value) continue // unchanged → keep the original token (preserves symbols)
      const text = f === F_PROG ? formatLevelId(v, symbols) : formatByte(v)
      edits.push({ start: op.start, end: op.end, replacement: text })
    }
  }
  return { ok: true, text: spliceRegion(fileText, WORLD_MAP_ENTRANCES_ID, applyEdits(region.inner, edits)) }
}

/** Splice the edited MIDWAY records onto `fileText`. Each 4-byte record is packed
 *  as two `dw` words; an edit to either half rewrites that whole word (recomputed
 *  from the record's current byte-fields) while preserving the other word. */
function spliceMidway(
  fileText: string,
  midway: WorldMapMidwayEntrance[],
  symbols: LevelIdSymbols
): SerializeResult {
  const region = findRegion(fileText, WORLD_MAP_MIDWAY_ENTRANCES_ID)
  if (!region) return { ok: false, error: `Missing ;@editable:${WORLD_MAP_MIDWAY_ENTRANCES_ID} markers.` }
  const base = parseDwRecords(region.inner, symbols)
  if (midway.length !== base.length) {
    return { ok: false, error: `Model has ${midway.length} midway records; the base file has ${base.length} (out of date?).` }
  }
  const edits: TextEdit[] = []
  for (const e of midway) {
    const rec = base[e.index]
    if (!rec) return { ok: false, error: `Midway record #${e.index} is not in the base file (out of date?).` }
    for (const [field, v] of [
      ['levelDataId', e.levelDataId],
      ['spawnX', e.spawnX],
      ['spawnY', e.spawnY],
      ['entranceState', e.entranceState]
    ] as const) {
      if (!Number.isInteger(v) || v < 0 || v > 0xff) return badByte('Midway record', e.index, field, v)
    }
    const w0 = ((e.spawnX & 0xff) << 8) | (e.levelDataId & 0xff)
    const w1 = ((e.entranceState & 0xff) << 8) | (e.spawnY & 0xff)
    if (w0 !== rec.words[0].value) {
      edits.push({ start: rec.words[0].start, end: rec.words[0].end, replacement: formatWord(w0) })
    }
    if (w1 !== rec.words[1].value) {
      edits.push({ start: rec.words[1].start, end: rec.words[1].end, replacement: formatWord(w1) })
    }
  }
  return { ok: true, text: spliceRegion(fileText, WORLD_MAP_MIDWAY_ENTRANCES_ID, applyEdits(region.inner, edits)) }
}

/**
 * Splice the model's edited records (main + midway) back onto `fileText`
 * (overlay-first, so a sibling region's edits in the same file survive). Only
 * operands whose value changed are rewritten; unchanged operands (incl.
 * `!Define_*` symbols) are byte-preserved. Validates each field is a byte
 * (0..255). Records are fixed-size so there's no budget check. The two regions
 * are spliced in sequence (each `spliceRegion` re-locates its markers in the
 * updated text, so the earlier splice's length change is harmless).
 */
export function serializeEntranceTable(
  fileText: string,
  model: WorldMapModel,
  symbols: LevelIdSymbols
): SerializeResult {
  const main = spliceMain(fileText, model.entrances, symbols)
  if (!main.ok) return main
  return spliceMidway(main.text, model.midway, symbols)
}
