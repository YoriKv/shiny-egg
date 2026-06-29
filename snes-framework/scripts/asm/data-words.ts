// Reusable asm primitive for editing inline `dw $XXXX` data tables — the numeric
// counterpart to text-literals.ts. Edits the master palette color blob
// (Bank57.asm `DATA_master_palette_rom_blob`) and (future) the Map16 / collision
// data tables. Format-preserving: only the hex digits of a CHANGED word are
// spliced, so interspersed labels, comments, indentation, and every untouched
// word survive byte-for-byte — a no-change save round-trips to the base exactly.

import { stripComment, type TextEdit } from './text-literals.ts'
import { hex } from '../hex.ts'

/** One `dw` word in a labelled data run. `byteOffset` is from the run's base
 *  label (2 bytes per word); `hexStart`/`hexEnd` bound the hex digits AFTER the
 *  `$`, so a splice over `[hexStart, hexEnd)` replaces the value and nothing
 *  else. */
export interface DataWord {
  byteOffset: number
  value: number
  hexStart: number
  hexEnd: number
}

function* iterLines(text: string): Generator<{ line: string; start: number }> {
  let start = 0
  for (;;) {
    let nl = text.indexOf('\n', start)
    if (nl === -1) nl = text.length
    yield { line: text.slice(start, nl), start }
    if (nl === text.length) return
    start = nl + 1
  }
}

/**
 * Parse the contiguous `dw` run beginning at `baseLabel:` — tracking byte offsets
 * across lines, skipping interspersed labels / comments / blank lines, and
 * stopping at the first line that isn't a `dw` (nor a label/comment/blank). Byte
 * offsets count from the first word after `baseLabel`. Throws if the label isn't
 * found. (Aliases on the lines above the base label — e.g. `DATA_master_palette_rom_blob:` — are
 * before the scan start, so they don't shift offsets.)
 */
export function findDataWords(text: string, baseLabel: string): DataWord[] {
  const lines = [...iterLines(text)]
  const labelTok = `${baseLabel}:`
  let i = lines.findIndex(({ line }) => stripComment(line).trim().startsWith(labelTok))
  if (i < 0) throw new Error(`findDataWords: base label "${baseLabel}" not found`)

  const out: DataWord[] = []
  let byteOffset = 0
  const hexRe = /\$([0-9A-Fa-f]+)/g
  for (; i < lines.length; i++) {
    const { line, start } = lines[i]!
    const code = stripComment(line)
    const trimmed = code.trim()
    if (trimmed === '') continue // blank / comment-only
    // Strip a leading `label:` so a bare label line (or `label: dw …`) classifies.
    const rest = trimmed.replace(/^[A-Za-z_]\w*:\s*/, '')
    if (rest === '') continue // pure label line — 0 bytes
    if (!/^dw\b/i.test(rest)) break // first non-dw line ends the run
    // `dw` and any leading label carry no `$`, so every `$HEX` in the code
    // portion is an operand word, in order.
    hexRe.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = hexRe.exec(code)) !== null) {
      const hexStart = start + m.index + 1 // skip the '$'
      out.push({
        byteOffset,
        value: parseInt(m[1]!, 16) & 0xffff,
        hexStart,
        hexEnd: hexStart + m[1]!.length
      })
      byteOffset += 2
    }
  }
  return out
}

/** Format a 16-bit value the way the blob is written (4 upper-hex digits). */
export function formatWord(value: number): string {
  return hex(value & 0xffff, 4)
}

/**
 * Build the format-preserving `TextEdit`s for a set of `byteOffset → newValue`
 * changes against an already-parsed run. Only words whose value actually changes
 * produce an edit (so an all-unchanged set yields `[]` → byte-identical save).
 * Throws if an offset isn't a word boundary in the run. Apply with `applyEdits`.
 */
export function dataWordEdits(words: DataWord[], changes: Map<number, number>): TextEdit[] {
  const byOffset = new Map(words.map((w) => [w.byteOffset, w]))
  const edits: TextEdit[] = []
  for (const [offset, value] of changes) {
    const w = byOffset.get(offset)
    if (!w) throw new Error(`dataWordEdits: byteOffset 0x${offset.toString(16)} is not a word in the run`)
    if ((value & 0xffff) === w.value) continue // unchanged → no splice
    edits.push({ start: w.hexStart, end: w.hexEnd, replacement: formatWord(value) })
  }
  return edits
}
