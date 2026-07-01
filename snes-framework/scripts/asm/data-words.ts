// Reusable asm primitive for editing inline `dw $XXXX` data tables — the numeric
// counterpart to text-literals.ts. Edits the master palette color blob
// (Bank57.asm `DATA_master_palette_rom_blob`) and (future) the Map16 / collision
// data tables. Format-preserving: only the hex digits of a CHANGED word are
// spliced, so interspersed labels, comments, indentation, and every untouched
// word survive byte-for-byte — a no-change save round-trips to the base exactly.

import { stripComment, type TextEdit } from './text-literals.ts'
import { findRegion } from './markers.ts'
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

/**
 * Like {@link findDataWords}, but SCOPED to an `;@editable:<regionId>` region —
 * scans only the region body. The palette / island / gradient / logo blocks are
 * all part of one contiguous `dw` run (in Bank57 the gradient tables even sit
 * *inside* the master-palette blob), so a plain label scan over-reads past a
 * block's end; the region boundary bounds it instead of an ad-hoc word cap. Each
 * word's `hexStart`/`hexEnd` is translated to an ABSOLUTE offset into `text`
 * (`+region.innerStart`), so the result drops straight into `dataWordEdits` →
 * `applyEdits(text, …)` which splices the full `text`.
 *
 * Falls back to a plain {@link findDataWords} over the whole `text` when the
 * region's marker pair is absent — so marker-less text still works: synthetic
 * test fixtures, and the pre-migration overlays read during the one-time overlay
 * migration (see overlay-upgrade.ts `migrateInlineDataOverlays`). `byteOffset`
 * and `value` are label-relative and identical either way, so byteOffset-keyed
 * readers and offset-based ROM splices (`applyScreenPlacementOverlays`) are
 * invariant regardless of region presence.
 */
export function findRegionDataWords(text: string, regionId: string, baseLabel: string): DataWord[] {
  const region = findRegion(text, regionId)
  if (!region) return findDataWords(text, baseLabel)
  const shift = region.innerStart
  return findDataWords(region.inner, baseLabel).map((w) => ({
    ...w,
    hexStart: w.hexStart + shift,
    hexEnd: w.hexEnd + shift
  }))
}

/** Format a 16-bit value the way the blob is written (4 upper-hex digits). */
export function formatWord(value: number): string {
  return hex(value & 0xffff, 4)
}

// ── `db` (byte) counterpart ─────────────────────────────────────────────────
// The byte twin of findDataWords/dataWordEdits, for `db $XX` data runs (e.g.
// the per-level Yoshi-color table in Bank02.asm). Same format-preserving splice:
// only a CHANGED byte's hex digits are rewritten; labels/comments/untouched
// bytes survive byte-for-byte.

/** One `db` byte in a labelled data run. `byteOffset` is from the run's base
 *  label (1 byte per value); `hexStart`/`hexEnd` bound the hex digits after `$`. */
export interface DataByte {
  byteOffset: number
  value: number
  hexStart: number
  hexEnd: number
}

/**
 * Parse the contiguous `db` run beginning at `baseLabel:` — the byte analogue of
 * {@link findDataWords}. Tracks byte offsets across lines, skips interspersed
 * labels / comments / blanks, and stops at the first line that isn't a `db`.
 * Throws if the label isn't found.
 */
export function findDataBytes(text: string, baseLabel: string): DataByte[] {
  const lines = [...iterLines(text)]
  const labelTok = `${baseLabel}:`
  let i = lines.findIndex(({ line }) => stripComment(line).trim().startsWith(labelTok))
  if (i < 0) throw new Error(`findDataBytes: base label "${baseLabel}" not found`)

  const out: DataByte[] = []
  let byteOffset = 0
  const hexRe = /\$([0-9A-Fa-f]+)/g
  for (; i < lines.length; i++) {
    const { line, start } = lines[i]!
    const code = stripComment(line)
    const trimmed = code.trim()
    if (trimmed === '') continue // blank / comment-only
    const rest = trimmed.replace(/^[A-Za-z_]\w*:\s*/, '')
    if (rest === '') continue // pure label line — 0 bytes
    if (!/^db\b/i.test(rest)) break // first non-db line ends the run
    hexRe.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = hexRe.exec(code)) !== null) {
      const hexStart = start + m.index + 1 // skip the '$'
      out.push({
        byteOffset,
        value: parseInt(m[1]!, 16) & 0xff,
        hexStart,
        hexEnd: hexStart + m[1]!.length
      })
      byteOffset += 1
    }
  }
  return out
}

/** Like {@link findRegionDataWords} but for a `db` run (see {@link findDataBytes}).
 *  Scopes the scan to `;@editable:<regionId>`; falls back to a plain label scan
 *  over the whole `text` when the marker pair is absent (marker-less fixtures /
 *  pre-migration overlays), with `hexStart`/`hexEnd` translated to absolute
 *  offsets so the result drops straight into `dataByteEdits` → `applyEdits`. */
export function findRegionDataBytes(text: string, regionId: string, baseLabel: string): DataByte[] {
  const region = findRegion(text, regionId)
  if (!region) return findDataBytes(text, baseLabel)
  const shift = region.innerStart
  return findDataBytes(region.inner, baseLabel).map((b) => ({
    ...b,
    hexStart: b.hexStart + shift,
    hexEnd: b.hexEnd + shift
  }))
}

/** Format a byte the way a `db $XX` run is written (2 upper-hex digits). */
export function formatByte(value: number): string {
  return hex(value & 0xff, 2)
}

/**
 * Build the format-preserving `TextEdit`s for a set of `byteOffset → newValue`
 * changes against an already-parsed byte run. Only bytes whose value actually
 * changes produce an edit. Throws if an offset isn't in the run. Apply with
 * `applyEdits`. The byte twin of {@link dataWordEdits}.
 */
export function dataByteEdits(bytes: DataByte[], changes: Map<number, number>): TextEdit[] {
  const byOffset = new Map(bytes.map((b) => [b.byteOffset, b]))
  const edits: TextEdit[] = []
  for (const [offset, value] of changes) {
    const b = byOffset.get(offset)
    if (!b) throw new Error(`dataByteEdits: byteOffset 0x${offset.toString(16)} is not a byte in the run`)
    if ((value & 0xff) === b.value) continue // unchanged → no splice
    edits.push({ start: b.hexStart, end: b.hexEnd, replacement: formatByte(value) })
  }
  return edits
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
