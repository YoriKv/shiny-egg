// Reusable asm binary-record-table primitives — the numeric analog of
// text-literals.ts. Parse the operands of a fixed-width `db` record table (the
// world-map entrance table) in a `;@editable` region, tracking each operand's
// char span so an edit splices ONLY the operand a field changed. Comments,
// indentation, the `!Define_*` symbols on unedited rows, and every other byte
// survive byte-for-byte — same format-preserving contract the string editor uses
// for `"..."` literals.
//
// Records here are `db levelDataId, entX, entY, progTarget` (4 single-byte
// operands). Operands are written three ways: `$XX` hex, a decimal literal, or a
// `!Define_YI_LevelID_*` symbol (byte +3's progression target). Symbol values are
// resolved against Constants/LevelIDs.asm.
//
// BYTE +3 NAMING TRAP (the asm source spells this out; the TS didn't): the byte
// that keys the `Ptrs:` lookup — "which level this record loads" — is byte +0
// (levelDataId), NOT the `!Define_YI_LevelID_*` symbol on the `db` line. That
// symbol sits in byte +3, a DIFFERENT field: the world-map progression target in
// this (entrance) table, the player entrance-state in the midway table. So the
// symbol on each line names the *next* level (progression target), not the level
// the record loads. Never conflate +0 and +3.

import { readFileSync } from 'node:fs'
import * as path from 'node:path'
import { stripComment } from './text-literals.ts'

/** One operand of a `db` record line. `start`/`end` are char offsets of the
 *  operand token within the scanned text (the region inner), so a splice over
 *  `[start, end)` replaces that operand and nothing else. */
export interface RecordOperand {
  /** Raw operand token as written (e.g. "$07", "!Define_YI_LevelID_WatchOutBelow"). */
  text: string
  start: number
  end: number
  /** Resolved numeric byte value. */
  value: number
}

/** A parsed `db` record line: its position among the region's records and its
 *  operands (one per byte). */
export interface DbRecord {
  /** 0-based position among the region's `db` record lines (the stable edit key). */
  index: number
  operands: RecordOperand[]
}

/** `!Define_YI_LevelID_*` ↔ value maps parsed from Constants/LevelIDs.asm. */
export interface LevelIdSymbols {
  /** "!Define_YI_LevelID_X" → value. */
  byName: Map<string, number>
  /** value → "!Define_YI_LevelID_X" (first definition wins). */
  byValue: Map<number, string>
}

const LEVEL_IDS_FILE = path.join('yi', 'Constants', 'LevelIDs.asm')
const DEFINE_RE = /^(!Define_YI_LevelID_\w+)\s*=\s*\$([0-9A-Fa-f]+)/

/** Parse the `!Define_YI_LevelID_<name> = $XX` enumeration. */
export function parseLevelIdSymbols(text: string): LevelIdSymbols {
  const byName = new Map<string, number>()
  const byValue = new Map<number, string>()
  for (const line of text.split('\n')) {
    const m = DEFINE_RE.exec(stripComment(line).trim())
    if (!m) continue
    const name = m[1]
    const value = parseInt(m[2], 16)
    byName.set(name, value)
    if (!byValue.has(value)) byValue.set(value, name)
  }
  return { byName, byValue }
}

/** Load + parse the LevelID symbols from a framework work root. */
export function loadLevelIdSymbols(workRoot: string): LevelIdSymbols {
  return parseLevelIdSymbols(readFileSync(path.join(workRoot, LEVEL_IDS_FILE), 'utf8'))
}

/** Resolve an operand token to its numeric value. Throws on an unknown define so
 *  a typo can't silently round-trip as 0. */
export function resolveOperand(text: string, symbols: LevelIdSymbols): number {
  if (text.startsWith('$')) return parseInt(text.slice(1), 16)
  if (text.startsWith('!')) {
    const v = symbols.byName.get(text)
    if (v === undefined) throw new Error(`Unknown LevelID define "${text}".`)
    return v
  }
  const n = parseInt(text, 10)
  if (Number.isNaN(n)) throw new Error(`Unparseable operand "${text}".`)
  return n
}

/** Format a byte value as an uppercase 2-digit `$XX` literal (matches the table's
 *  existing hex style, e.g. `$9B`). */
export function formatByte(value: number): string {
  return '$' + (value & 0xff).toString(16).toUpperCase().padStart(2, '0')
}

/** Format a record's progression-target byte (+3): the `!Define_YI_LevelID_*`
 *  symbol when one names the value (keeps the table readable), else a `$XX`
 *  literal. */
export function formatLevelId(value: number, symbols: LevelIdSymbols): string {
  return symbols.byValue.get(value) ?? formatByte(value)
}

/** Split a comment-stripped `db`/`dw` line into its operands with char spans
 *  (offsets relative to `lineStart`). Operands are simple comma-separated tokens
 *  — no quoted strings or parens in these tables — so a top-level comma split is
 *  exact. */
function parseLineOperands(
  code: string,
  lineStart: number,
  directive: 'db' | 'dw',
  symbols: LevelIdSymbols
): RecordOperand[] {
  const m = new RegExp(`^\\s*${directive}\\s+`).exec(code)
  if (!m) return []
  const operands: RecordOperand[] = []
  const flush = (rawStart: number, rawEnd: number): void => {
    const raw = code.slice(rawStart, rawEnd)
    const lead = raw.length - raw.trimStart().length
    const text = raw.trim()
    if (text === '') return
    const start = rawStart + lead
    operands.push({
      text,
      start: lineStart + start,
      end: lineStart + start + text.length,
      value: resolveOperand(text, symbols)
    })
  }
  let segStart = m[0].length
  for (let i = m[0].length; i < code.length; i++) {
    if (code[i] === ',') {
      flush(segStart, i)
      segStart = i + 1
    }
  }
  flush(segStart, code.length)
  return operands
}

/** Parse every `db $..` record line in `inner` (a region body) into structured
 *  records with operand spans. Each record must have exactly `fieldsPerRecord`
 *  operands. Non-record lines (blank, comments, labels) are skipped. */
export function parseDbRecords(
  inner: string,
  fieldsPerRecord: number,
  symbols: LevelIdSymbols
): DbRecord[] {
  const records: DbRecord[] = []
  let offset = 0
  for (const rawLine of inner.split('\n')) {
    const lineStart = offset
    offset += rawLine.length + 1 // consumed '\n'
    const code = stripComment(rawLine)
    if (!/^\s*db\s+\$/.test(code)) continue
    const operands = parseLineOperands(code, lineStart, 'db', symbols)
    if (operands.length !== fieldsPerRecord) {
      throw new Error(
        `Entrance record #${records.length} has ${operands.length} operands, expected ${fieldsPerRecord}.`
      )
    }
    records.push({ index: records.length, operands })
  }
  return records
}

/** A parsed `dw` record: the two 16-bit word operands the midway table packs a
 *  4-byte record into (`dw lohi, lohi`). word0 = (entX<<8)|levelDataId,
 *  word1 = (entranceState<<8)|entY. */
export interface DwRecord {
  /** 0-based position among the region's records (the stable edit key). */
  index: number
  words: [RecordOperand, RecordOperand]
}

/** Parse every `dw $..` word across `inner` (the midway region body) and group
 *  consecutive pairs into records. Throws on an odd word count (each record is
 *  exactly two words). */
export function parseDwRecords(inner: string, symbols: LevelIdSymbols): DwRecord[] {
  const flat: RecordOperand[] = []
  let offset = 0
  for (const rawLine of inner.split('\n')) {
    const lineStart = offset
    offset += rawLine.length + 1 // consumed '\n'
    const code = stripComment(rawLine)
    if (!/^\s*dw\s+\$/.test(code)) continue
    flat.push(...parseLineOperands(code, lineStart, 'dw', symbols))
  }
  if (flat.length % 2 !== 0) {
    throw new Error(`Midway table has ${flat.length} words (must be even — 2 per record).`)
  }
  const records: DwRecord[] = []
  for (let i = 0; i + 1 < flat.length; i += 2) {
    records.push({ index: records.length, words: [flat[i], flat[i + 1]] })
  }
  return records
}

/** Format a 16-bit value as an uppercase 4-digit `$XXXX` literal — the midway
 *  table's `dw` style (e.g. `$7800`). */
export function formatWord(value: number): string {
  return '$' + (value & 0xffff).toString(16).toUpperCase().padStart(4, '0')
}
