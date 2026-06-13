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
/** Marker id of the translevel→record index table (`DATA_level_entrance_indexes`). */
export const WORLD_MAP_ENTRANCE_INDEXES_ID = 'world-map-entrance-indexes'
/** Marker id of the midway index table (`DATA_level_midway_entrance_indexes`). */
export const WORLD_MAP_MIDWAY_ENTRANCE_INDEXES_ID = 'world-map-midway-entrance-indexes'

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

/** One `$XXXX` word token inside an index region, with its inner-text span. */
interface IndexWordToken {
  value: number
  start: number
  end: number
}

/** Scan an index region's inner text for its `dw $XXXX` word tokens (in file
 *  order, comment-aware), keeping each token's span for the in-place splice. */
function parseIndexWordTokens(inner: string): IndexWordToken[] {
  const out: IndexWordToken[] = []
  let lineStart = 0
  for (const line of inner.split('\n')) {
    const code = stripComment(line)
    if (/^\s*dw\s/.test(code)) {
      const re = /\$([0-9A-Fa-f]{1,4})/g
      let m: RegExpExecArray | null
      while ((m = re.exec(code)) !== null) {
        out.push({ value: parseInt(m[1], 16), start: lineStart + m.index, end: lineStart + m.index + m[0].length })
      }
    }
    lineStart += line.length + 1
  }
  return out
}

/** Raw word values of an index region, or undefined when the markers are
 *  absent (an overlay written before the regions were marked). */
function parseIndexWords(fileText: string, regionId: string): number[] | undefined {
  const region = findRegion(fileText, regionId)
  if (!region) return undefined
  return parseIndexWordTokens(region.inner).map((t) => t.value)
}

/** Splice changed index words back into their region (format-preserving:
 *  unchanged tokens keep their original text). No-op when the model carries no
 *  words or the markers are absent; errors on a length mismatch. */
function spliceIndexWords(
  fileText: string,
  regionId: string,
  words: number[] | undefined
): SerializeResult {
  if (!words) return { ok: true, text: fileText }
  const region = findRegion(fileText, regionId)
  if (!region) {
    return {
      ok: false,
      error:
        `Missing ;@editable:${regionId} markers — the overlay predates the editable ` +
        'index tables. Upgrade the overlay (Project menu) and retry.'
    }
  }
  const tokens = parseIndexWordTokens(region.inner)
  if (tokens.length !== words.length) {
    return { ok: false, error: `Model has ${words.length} index words; the file has ${tokens.length} (out of date?).` }
  }
  const edits: TextEdit[] = []
  for (let i = 0; i < words.length; i++) {
    const v = words[i]
    if (!Number.isInteger(v) || v < 0 || v > 0xffff) {
      return { ok: false, error: `Index word #${i} value ${v} is not a word (0–65535).` }
    }
    if (v !== tokens[i].value) edits.push({ start: tokens[i].start, end: tokens[i].end, replacement: formatWord(v) })
  }
  return { ok: true, text: spliceRegion(fileText, regionId, applyEdits(region.inner, edits)) }
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

  // Raw editable index words (absent when an older overlay predates the markers
  // — the derived maps below still work via the label scan).
  const entranceIndexWords = parseIndexWords(fileText, WORLD_MAP_ENTRANCE_INDEXES_ID)
  const midwayIndexWords = parseIndexWords(fileText, WORLD_MAP_MIDWAY_ENTRANCE_INDEXES_ID)

  return {
    entrances,
    // dropZeroPadding: a `$0000` main offset means "no main entrance" (bonus /
    // mini-game / padding slots that sit on the world map but load through a
    // separate system) — exclude them so they don't collapse onto record 0 and
    // collide with 1-1. Translevel 0 legitimately maps to record 0.
    translevelToRecordIndex: parseIndexTable(fileText, 'DATA_level_entrance_indexes', true),
    midway,
    midwayIndex: parseIndexTable(fileText, 'DATA_level_midway_entrance_indexes', true),
    ...(entranceIndexWords ? { entranceIndexWords } : {}),
    ...(midwayIndexWords ? { midwayIndexWords } : {})
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

/** What `removeTranslevelsFromWorldMap` changed (for logging / the confirm UI). */
export interface WorldMapRemoval {
  /** Translevels whose main+midway index words were zeroed (slot now unused). */
  clearedTranslevels: number[]
  /** Unlock rewires: entrance records whose progression target pointed at a
   *  removed translevel, redirected back at the completing level's own slot. */
  rewires: { recordIndex: number; from: number; to: number }[]
}

/**
 * Take a set of translevels off the world map, in place on `model`:
 *
 *   • zero their words in BOTH index tables (`$0000` = the documented
 *     "unused tile" marker; the midway table's `$0000` = "no midway");
 *   • rewire unlocks: every entrance record (of a KEPT translevel) whose
 *     progression target (+3, the tile-slot the Yoshi token advances to after
 *     a clear) names a removed translevel is redirected at the completing
 *     level's OWN translevel — a self-unlock no-op, per the deliberate
 *     "ignore the unlock chain" removal policy. The removed slots' own records
 *     keep their bytes (they're unreferenced once the index words are zero).
 *
 * Caveat: translevel 0's index word is legitimately `$0000` (offset 0), so for
 * it the marker is indistinguishable from "first record" — removing 1-1 leaves
 * the engine reading record 0 if its tile is somehow entered.
 *
 * Throws when the model carries no raw index words (an overlay predating the
 * editable index-table markers — upgrade the overlay first).
 */
export function removeTranslevelsFromWorldMap(
  model: WorldMapModel,
  removedTranslevels: ReadonlySet<number>
): WorldMapRemoval {
  if (!model.entranceIndexWords || !model.midwayIndexWords) {
    throw new Error(
      'World-map overlay predates the editable index tables — upgrade the overlay (Project menu) and retry.'
    )
  }
  const cleared: number[] = []
  for (const t of [...removedTranslevels].sort((a, b) => a - b)) {
    let touched = false
    if (t >= 0 && t < model.entranceIndexWords.length && model.entranceIndexWords[t] !== 0) {
      model.entranceIndexWords[t] = 0
      touched = true
    }
    if (t >= 0 && t < model.midwayIndexWords.length && model.midwayIndexWords[t] !== 0) {
      model.midwayIndexWords[t] = 0
      touched = true
    }
    if (touched) cleared.push(t)
  }
  const rewires: { recordIndex: number; from: number; to: number }[] = []
  for (const [hexKey, recordIndex] of Object.entries(model.translevelToRecordIndex)) {
    const translevel = parseInt(hexKey, 16)
    if (removedTranslevels.has(translevel)) continue
    const e = model.entrances[recordIndex]
    if (!e || !removedTranslevels.has(e.progTarget)) continue
    rewires.push({ recordIndex: e.index, from: e.progTarget, to: translevel })
    e.progTarget = translevel
  }
  return { clearedTranslevels: cleared, rewires }
}

/** What `restoreTranslevelsToWorldMap` changed (mirror of WorldMapRemoval). */
export interface WorldMapRestore {
  /** Translevels whose index words were restored to their base values. */
  restoredTranslevels: number[]
  /** Unlock un-rewires: entrance records whose progression target was put back
   *  at its base value (a restored translevel). */
  rewires: { recordIndex: number; from: number; to: number }[]
}

/**
 * Put removed translevels back on the world map — the inverse of
 * `removeTranslevelsFromWorldMap`, in place on `model`:
 *
 *   • restore their words in BOTH index tables to `baseModel`'s values;
 *   • un-rewire unlocks: a kept entrance record whose progression target reads
 *     the SELF-REDIRECT a removal wrote (its own translevel) and whose BASE
 *     target is one of the restored translevels goes back to that base target.
 *     The narrow condition is deliberate — an unlock the user re-pointed
 *     somewhere else was never touched by the removal, so the restore must not
 *     stomp it either.
 *
 * Restores BASE wiring: a slot remap made before the removal is not recovered
 * (the removal zeroed it, and zero carries no memory of what it pointed at).
 *
 * Throws when either model carries no raw index words (an overlay predating
 * the editable index-table markers — upgrade the overlay first).
 */
export function restoreTranslevelsToWorldMap(
  model: WorldMapModel,
  baseModel: WorldMapModel,
  restoredTranslevels: ReadonlySet<number>
): WorldMapRestore {
  if (
    !model.entranceIndexWords ||
    !model.midwayIndexWords ||
    !baseModel.entranceIndexWords ||
    !baseModel.midwayIndexWords
  ) {
    throw new Error(
      'World-map overlay predates the editable index tables — upgrade the overlay (Project menu) and retry.'
    )
  }
  const restored: number[] = []
  for (const t of [...restoredTranslevels].sort((a, b) => a - b)) {
    let touched = false
    if (t >= 0 && t < model.entranceIndexWords.length && t < baseModel.entranceIndexWords.length) {
      if (model.entranceIndexWords[t] !== baseModel.entranceIndexWords[t]) {
        model.entranceIndexWords[t] = baseModel.entranceIndexWords[t]
        touched = true
      }
    }
    if (t >= 0 && t < model.midwayIndexWords.length && t < baseModel.midwayIndexWords.length) {
      if (model.midwayIndexWords[t] !== baseModel.midwayIndexWords[t]) {
        model.midwayIndexWords[t] = baseModel.midwayIndexWords[t]
        touched = true
      }
    }
    if (touched) restored.push(t)
  }
  const rewires: { recordIndex: number; from: number; to: number }[] = []
  for (const [hexKey, recordIndex] of Object.entries(model.translevelToRecordIndex)) {
    const own = parseInt(hexKey, 16)
    const e = model.entrances[recordIndex]
    const baseE = baseModel.entrances[recordIndex]
    if (!e || !baseE) continue
    if (
      restoredTranslevels.has(baseE.progTarget) &&
      e.progTarget === own &&
      e.progTarget !== baseE.progTarget
    ) {
      rewires.push({ recordIndex: e.index, from: e.progTarget, to: baseE.progTarget })
      e.progTarget = baseE.progTarget
    }
  }
  return { restoredTranslevels: restored, rewires }
}

/**
 * Splice the model's edited records (main + midway) back onto `fileText`
 * (overlay-first, so a sibling region's edits in the same file survive). Only
 * operands whose value changed are rewritten; unchanged operands (incl.
 * `!Define_*` symbols) are byte-preserved. Validates each field is a byte
 * (0..255). Records are fixed-size so there's no budget check. The regions
 * are spliced in sequence (each `spliceRegion` re-locates its markers in the
 * updated text, so an earlier splice's length change is harmless). The raw
 * index-word tables splice only when the model carries them (a model parsed
 * from a pre-marker overlay doesn't, and then never writes them).
 */
export function serializeEntranceTable(
  fileText: string,
  model: WorldMapModel,
  symbols: LevelIdSymbols
): SerializeResult {
  const main = spliceMain(fileText, model.entrances, symbols)
  if (!main.ok) return main
  const mid = spliceMidway(main.text, model.midway, symbols)
  if (!mid.ok) return mid
  const idx = spliceIndexWords(mid.text, WORLD_MAP_ENTRANCE_INDEXES_ID, model.entranceIndexWords)
  if (!idx.ok) return idx
  return spliceIndexWords(idx.text, WORLD_MAP_MIDWAY_ENTRANCE_INDEXES_ID, model.midwayIndexWords)
}
