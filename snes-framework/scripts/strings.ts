// String-table editor backend (plan step 5) — parse/serialize the level-name
// strings in a `;@editable` region of `yi/SuperFX/Banks/Bank51.asm`. Built on
// the reusable asm primitives in ./asm so future text tools (message box, item
// names, …) reuse the same marker + literal + font-table machinery.
//
// Edit strategy: format-preserving in-place splice. We never re-emit the region
// — we replace only the contents of the `"..."` literals the user edited. So
// control bytes ($FF,$00 / $FE,$10,$00 / $FD), the pointer table, comments,
// label aliases, indentation, and the garbage sentinel all survive byte-for-byte.

import { findRegion, spliceRegion } from './asm/markers.ts'
import { findQuotedLiterals, stripComment, applyEdits, type TextEdit } from './asm/text-literals.ts'
import {
  invalidChars,
  loadFontTable,
  type FontTable
} from './asm/font-table.ts'
import {
  CONTROL_CODES,
  SPECIAL_GLYPHS,
  decodeMessageBytes,
  encodeMessageMarkup
} from './asm/msg-markup.ts'
import {
  bytesToMessageDirectives,
  messageBodyToBytes,
  splitMessageEntries
} from './asm/msg-asm.ts'
import { snesToPC } from './engine/symbol-map.ts'
import type { MarkupToken, StringTableEntry, StringTableModel } from './types.ts'

/** The insertable-token guide for the markup editor (glyphs then control codes). */
const MARKUP_GUIDE: MarkupToken[] = [
  ...SPECIAL_GLYPHS.map((g) => ({ token: g.token, label: g.label, kind: 'glyph' as const })),
  ...CONTROL_CODES.map((c) => ({ token: c.token, label: c.label, kind: 'control' as const }))
]

export { loadFontTable, type FontTable }

/** Marker id of the level-name string region in Bank51. */
export const LEVEL_NAME_STRINGS_ID = 'level-name-strings'

/** Marker id of the intro/message-box text region in Bank51 (interleaved with
 *  glyph-bitmap data, which the parser skips — it has no quoted literals). */
export const MESSAGE_TEXT_ID = 'message-box-text'

/** A located editable literal: its text plus its char range within the region
 *  body (`inner`), so the save path can splice new text back in place. */
interface LocatedLine {
  text: string
  start: number
  end: number
}

interface ParsedEntry {
  /** Primary label — the one the pointer table references; the save-match key. */
  label: string
  /** All labels on the body (incl. the primary), for choosing a display name. */
  labels: string[]
  lines: LocatedLine[]
}

const LABEL_RE = /^([A-Za-z_.][\w.]*):/

/**
 * Walk a region body into entries. An entry = a label plus the `"..."` literals
 * that follow it (until the next label). Consecutive label lines with no
 * literals between them are aliases of one entry (its primary label — the one
 * the pointer table references — is the first). Entries with no literals (the
 * raw-byte garbage sentinel) are dropped: there's nothing to edit, and the
 * in-place splice leaves their bytes untouched regardless.
 */
function parseRegionEntries(inner: string): ParsedEntry[] {
  const entries: ParsedEntry[] = []
  let cur: ParsedEntry | null = null
  let offset = 0
  for (const rawLine of inner.split('\n')) {
    const lineStart = offset
    offset += rawLine.length + 1 // account for the consumed '\n'
    const code = stripComment(rawLine)
    const trimmed = code.trim()
    if (trimmed === '') continue

    const label = LABEL_RE.exec(trimmed)?.[1]
    if (label) {
      if (!cur || cur.lines.length > 0) {
        // Primary label (pointer-referenced — the save-match key) begins an entry.
        cur = { label, labels: [label], lines: [] }
        entries.push(cur)
      } else {
        // An extra label line on the same body — a descriptive alias. Kept only
        // to choose the display name (we prefer the longest); the key stays the
        // primary.
        cur.labels.push(label)
      }
    }
    if (cur) {
      for (const lit of findQuotedLiterals(rawLine)) {
        cur.lines.push({ text: lit.value, start: lineStart + lit.start, end: lineStart + lit.end })
      }
    }
  }
  return entries.filter((e) => e.lines.length > 0)
}

function totalChars(entries: ParsedEntry[]): number {
  let n = 0
  for (const e of entries) for (const l of e.lines) n += [...l.text].length
  return n
}

// ── Friendly names (from the pointer table, outside the editable region) ───
// The level-name pointer table `DATA_level_name_string_ptrs` is 12 slots per world × 6 worlds:
// slots 0-7 = levels 1-8, slot 8 = "Extra", slots 9-11 = padding → sentinel
// (except world 1 slot 11 → the welcome splash). That gives an authoritative
// "1-1" … "Extra 6" name for every body; specials fall back to a humanized alias.

const PTR_TABLE_LABELS = ['DATA_level_name_string_ptrs']

/** Ordered list of the level-name body labels the pointer table references, one
 *  per translevel slot. The importer uses this to map a foreign cart's name slot
 *  → the asm label its `StringTableModel` entry is keyed by. */
export function levelNameSlotLabels(fileText: string): string[] {
  return parsePointerTable(fileText)
}

/** Ordered list of body labels the pointer table references (one per slot). */
function parsePointerTable(fileText: string): string[] {
  const lines = fileText.split('\n')
  const start = lines.findIndex((l) => {
    const t = stripComment(l).trim()
    return PTR_TABLE_LABELS.some((p) => t === `${p}:`)
  })
  if (start < 0) return []
  const refs: string[] = []
  for (let i = start + 1; i < lines.length; i++) {
    const code = stripComment(lines[i]).trim()
    const m = /^dw\s+([A-Za-z_.][\w.]*)$/.exec(code)
    if (m) {
      refs.push(m[1])
      continue
    }
    if (refs.length === 0) continue // skip alias label line(s) before the first dw
    break // first non-dw line after the table ends it
  }
  return refs
}

/** Friendly name for a pointer-table slot, or null for a padding slot. */
function slotName(slotIndex: number): string | null {
  const world = Math.floor(slotIndex / 12) + 1
  const within = slotIndex % 12
  if (within <= 7) return `${world}-${within + 1}`
  if (within === 8) return `Extra ${world}`
  return null
}

function buildNameMap(fileText: string): Map<string, string> {
  const byLabel = new Map<string, string>()
  parsePointerTable(fileText).forEach((label, slot) => {
    const name = slotName(slot)
    if (name && !byLabel.has(label)) byLabel.set(label, name)
  })
  return byLabel
}

/** Build the editor model entries. The display name uses the friendly label when
 *  available with the asm label in parens (e.g. "1-1 (DATA_514A73)"); otherwise
 *  just the asm label, preferring the longest when a body has several (the more
 *  descriptive alias, e.g. `DATA_welcome_to_yoshis_island` over `DATA_welcome_to_yoshis_island`). */
function entriesToModel(
  entries: ParsedEntry[],
  nameByLabel: Map<string, string>
): StringTableEntry[] {
  return entries.map((e) => {
    const longest = e.labels.reduce((a, b) => (b.length > a.length ? b : a), e.labels[0])
    const friendly = nameByLabel.get(e.label)
    return {
      label: e.label,
      name: friendly ? `${friendly} (${longest})` : longest,
      lines: e.lines.map((l) => l.text)
    }
  })
}

/** Per-table strategy for the friendly entry name, given the parsed entries and
 *  the full file text (some strategies, like level names, read another table). */
type NameStrategy = (entries: ParsedEntry[], contentText: string) => Map<string, string>

/** Generic region parse: extract the editable entries, name them per strategy,
 *  and size the budget against the pristine base. Throws if markers are absent. */
function parseStringTableRegion(
  contentText: string,
  budgetText: string,
  ft: FontTable,
  id: string,
  title: string,
  nameStrategy?: NameStrategy
): StringTableModel {
  const contentRegion = findRegion(contentText, id)
  if (!contentRegion) throw new Error(`Bank51 is missing the ;@editable:${id} markers.`)
  const budgetRegion = findRegion(budgetText, id)
  if (!budgetRegion) throw new Error(`Base Bank51 is missing the ;@editable:${id} markers.`)
  const entries = parseRegionEntries(contentRegion.inner)
  const nameByLabel = nameStrategy ? nameStrategy(entries, contentText) : new Map<string, string>()
  return {
    id,
    title,
    allowedChars: ft.chars,
    budgetChars: totalChars(parseRegionEntries(budgetRegion.inner)),
    entries: entriesToModel(entries, nameByLabel)
  }
}

/**
 * Parse a string table from a Bank51 file's text into the editor model.
 * `budgetText` (the pristine base) sets the fixed byte budget; `contentText`
 * (overlay-first) supplies the current entries. Pass the same text for both
 * when there's no overlay. Throws if the `;@editable` markers are absent.
 */
export function parseLevelNameStrings(
  contentText: string,
  budgetText: string,
  ft: FontTable
): StringTableModel {
  return parseStringTableRegion(
    contentText,
    budgetText,
    ft,
    LEVEL_NAME_STRINGS_ID,
    'Level Names',
    (_entries, text) => buildNameMap(text)
  )
}

/** Total message byte size of a message region (the shared byte budget). */
function messageRegionBytes(inner: string, ft: FontTable): number {
  let total = 0
  for (const e of splitMessageEntries(inner)) {
    const bytes = messageBodyToBytes(e.body, ft)
    if (!bytes) continue
    const dec = decodeMessageBytes(bytes, 0, ft.byteToChar)
    if (dec.ok) total += dec.bytesConsumed
  }
  return total
}

/**
 * Parse the message-text region into the MARKUP model: each message body's
 * `dw`/`db` directives are assembled to bytes (msg-asm) then decoded to an
 * editable markup string (msg-markup) — plain text + `[token]`s for control codes
 * and special glyphs. `budgetText` (pristine base) sets the byte budget.
 */
export function parseMessageText(
  contentText: string,
  budgetText: string,
  ft: FontTable
): StringTableModel {
  const region = findRegion(contentText, MESSAGE_TEXT_ID)
  if (!region) throw new Error(`Bank51 is missing the ;@editable:${MESSAGE_TEXT_ID} markers.`)
  const budgetRegion = findRegion(budgetText, MESSAGE_TEXT_ID)
  if (!budgetRegion) throw new Error(`Base Bank51 is missing the ;@editable:${MESSAGE_TEXT_ID} markers.`)

  const entries: StringTableEntry[] = []
  for (const e of splitMessageEntries(region.inner)) {
    const bytes = messageBodyToBytes(e.body, ft)
    if (!bytes) continue
    const dec = decodeMessageBytes(bytes, 0, ft.byteToChar)
    if (!dec.ok) continue // not a terminated message body (header/padding)
    entries.push({ label: e.label, name: e.label, lines: [], markup: dec.markup })
  }
  return {
    id: MESSAGE_TEXT_ID,
    title: 'Message Text',
    allowedChars: ft.chars,
    budgetChars: messageRegionBytes(budgetRegion.inner, ft),
    entries,
    markup: true,
    markupGuide: MARKUP_GUIDE
  }
}

export type SerializeResult =
  | { ok: true; text: string }
  | { ok: false; error: string }

/**
 * Splice the model's edited text back onto `contentText` (overlay-first, so a
 * sibling region's existing edits in the same file survive) while sizing the
 * fixed byte budget from `budgetText` (the pristine base). Pass the same text for
 * both when there's no overlay. Validates the font charset and the budget; on any
 * violation returns an error and does not produce text. Only `"..."` contents
 * change — everything else in the file is preserved byte-for-byte.
 */
function serializeStringTable(
  contentText: string,
  budgetText: string,
  model: StringTableModel,
  ft: FontTable,
  id: string
): SerializeResult {
  const region = findRegion(contentText, id)
  if (!region) {
    return { ok: false, error: `Bank51 is missing the ;@editable:${id} markers.` }
  }
  const budgetRegion = findRegion(budgetText, id)
  if (!budgetRegion) {
    return { ok: false, error: `Base Bank51 is missing the ;@editable:${id} markers.` }
  }
  const base = parseRegionEntries(region.inner)
  const byLabel = new Map(base.map((e) => [e.label, e]))
  const budget = totalChars(parseRegionEntries(budgetRegion.inner))

  const edits: TextEdit[] = []
  let newTotal = 0
  for (const baseEntry of base) {
    const edited = model.entries.find((e) => e.label === baseEntry.label)
    const lines = edited ? edited.lines : baseEntry.lines.map((l) => l.text)
    if (edited && edited.lines.length !== baseEntry.lines.length) {
      return {
        ok: false,
        error: `Entry "${baseEntry.label}" has ${edited.lines.length} line(s); the cart expects ${baseEntry.lines.length}.`
      }
    }
    for (let i = 0; i < baseEntry.lines.length; i++) {
      const text = lines[i]
      const bad = invalidChars(text, ft)
      if (bad.length > 0) {
        return {
          ok: false,
          error: `Unsupported character(s) ${bad.map((c) => JSON.stringify(c)).join(', ')} in "${text}".`
        }
      }
      newTotal += [...text].length
      const orig = baseEntry.lines[i]
      if (text !== orig.text) {
        edits.push({ start: orig.start, end: orig.end, replacement: text })
      }
    }
  }

  // Guard against a stale model referencing entries the base no longer has.
  for (const e of model.entries) {
    if (!byLabel.has(e.label)) {
      return { ok: false, error: `Entry "${e.label}" is not in the current base file (out of date?).` }
    }
  }

  if (newTotal > budget) {
    return {
      ok: false,
      error: `Strings use ${newTotal} bytes but the budget is ${budget}. Shorten ${newTotal - budget} character(s).`
    }
  }

  const newInner = applyEdits(region.inner, edits)
  return { ok: true, text: spliceRegion(contentText, id, newInner) }
}

export function serializeLevelNameStrings(
  contentText: string,
  budgetText: string,
  model: StringTableModel,
  ft: FontTable
): SerializeResult {
  return serializeStringTable(contentText, budgetText, model, ft, LEVEL_NAME_STRINGS_ID)
}

/**
 * Serialize the markup model back into the message region: re-emit only the
 * messages whose markup changed (encode markup → bytes → `dw`/`db` directives),
 * preserving every unedited message's original text byte-for-byte. Splices onto
 * `contentText` (overlay-first, so a sibling region's edits in the same file
 * survive); sizes the shared byte budget from `budgetText` (the pristine base).
 * Validates the budget + the markup (charset / known tokens) via the codec.
 */
export function serializeMessageText(
  contentText: string,
  budgetText: string,
  model: StringTableModel,
  ft: FontTable
): SerializeResult {
  const region = findRegion(contentText, MESSAGE_TEXT_ID)
  if (!region) {
    return { ok: false, error: `Bank51 is missing the ;@editable:${MESSAGE_TEXT_ID} markers.` }
  }
  const budgetRegion = findRegion(budgetText, MESSAGE_TEXT_ID)
  if (!budgetRegion) {
    return { ok: false, error: `Base Bank51 is missing the ;@editable:${MESSAGE_TEXT_ID} markers.` }
  }
  const fontMap = ft.byteToChar
  const byLabel = new Map(model.entries.map((e) => [e.label, e]))
  const contentEntries = splitMessageEntries(region.inner)
  const contentLabels = new Set(contentEntries.map((e) => e.label))

  // Guard a stale model referencing labels the content no longer has.
  for (const e of model.entries) {
    if (!contentLabels.has(e.label)) {
      return { ok: false, error: `Message "${e.label}" is not in the current base file (out of date?).` }
    }
  }

  const budget = messageRegionBytes(budgetRegion.inner, ft)
  const edits: TextEdit[] = []
  let newTotal = 0
  for (const e of contentEntries) {
    const bytes = messageBodyToBytes(e.body, ft)
    if (!bytes) continue
    const dec = decodeMessageBytes(bytes, 0, fontMap)
    if (!dec.ok) continue
    const markup = byLabel.get(e.label)?.markup ?? dec.markup
    if (markup === dec.markup) {
      newTotal += dec.bytesConsumed // unchanged — keep the original body
      continue
    }
    const enc = encodeMessageMarkup(markup, ft)
    if (enc.error) return { ok: false, error: `Message "${e.label}": ${enc.error}` }
    newTotal += enc.bytes.length
    edits.push({
      start: e.bodyStart,
      end: e.bodyEnd,
      replacement: bytesToMessageDirectives(enc.bytes, fontMap) + '\n'
    })
  }

  if (newTotal > budget) {
    return {
      ok: false,
      error: `Messages use ${newTotal} bytes but the budget is ${budget}. Shorten ${newTotal - budget} byte(s).`
    }
  }

  return { ok: true, text: spliceRegion(contentText, MESSAGE_TEXT_ID, applyEdits(region.inner, edits)) }
}

/** One foreign message body decoded from a cart. */
export interface ForeignMessage {
  /** Decoded markup (plain text + `[token]`s). Empty when `ok` is false. */
  markup: string
  /** True when a `$FFFF` terminator was found within bounds (a real message). */
  ok: boolean
  /** True when this message's pointer slot is `$0000` — the hack deleted it (vs a
   *  valid pointer that simply failed to decode, which leaves `ok` false but
   *  `removed` false). */
  removed?: boolean
}

/** `DATA_message_box_text_ptrs` — message-ID → 16-bit `$51:xxxx` low word. */
const MESSAGE_PTR_TABLE_SNES = 0x5110db
/** Slot count: the table runs $51:10DB up to the first payload at $51:1333. */
const MESSAGE_PTR_COUNT = (0x1333 - 0x10db) / 2

/**
 * Decode a target cart's message bodies, keyed by base asm label, by FOLLOWING
 * the message pointer table (`$51:10DB`) — NOT by reading at the base label's
 * baked `$51:XXXX` address. A hack can repoint the table (GoldenEgg edits in
 * place, but a from-scratch repack like Flutter rewrites every slot), so message
 * N lives at a different offset than the base build and an address read would
 * decode a misaligned fragment that still *looks* like text. We map each editable
 * body's base low-word → its message ID (via the BASE/reference table) → the
 * target offset (via the TARGET cart's table), then decode there.
 *
 * `referenceCart` supplies the base pointer table; `cart` is the cart being read
 * (pass the base cart for both to read the base side). A body whose target slot
 * is `$0000` (removed in the hack) returns `ok: false`. The ROM importer uses
 * this to diff a modified cart's messages against base.
 */
export function readForeignMessages(
  cart: Buffer | Uint8Array,
  referenceCart: Buffer | Uint8Array,
  baseText: string,
  ft: FontTable
): Map<string, ForeignMessage> {
  const out = new Map<string, ForeignMessage>()
  const region = findRegion(baseText, MESSAGE_TEXT_ID)
  if (!region) return out
  const ptPc = snesToPC(MESSAGE_PTR_TABLE_SNES)
  const rd16 = (buf: Buffer | Uint8Array, off: number): number =>
    off >= 0 && off + 1 < buf.length ? buf[off] | (buf[off + 1] << 8) : 0

  // Map each editable body's base low-word → the first message ID that points at
  // it (restricted to the body words, so a stray non-pointer read can't collide).
  const entries = splitMessageEntries(region.inner)
  const bodyWords = new Set<number>()
  for (const e of entries) {
    const m = /DATA_51([0-9A-Fa-f]{4})/.exec(e.label)
    if (m) bodyWords.add(parseInt(m[1], 16))
  }
  const idByBaseWord = new Map<number, number>()
  for (let id = 0; id < MESSAGE_PTR_COUNT; id++) {
    const w = rd16(referenceCart, ptPc + id * 2)
    if (bodyWords.has(w) && !idByBaseWord.has(w)) idByBaseWord.set(w, id)
  }

  for (const e of entries) {
    const m = /DATA_51([0-9A-Fa-f]{4})/.exec(e.label)
    if (!m) continue
    const baseWord = parseInt(m[1], 16)
    const id = idByBaseWord.get(baseWord)
    // Follow the target table for this id; if the body isn't pointer-referenced
    // (shouldn't happen for a real message), fall back to its base offset — which
    // is correct when reading the base cart itself.
    const targetWord = id === undefined ? baseWord : rd16(cart, ptPc + id * 2)
    if (targetWord === 0) {
      out.set(e.label, { markup: '', ok: false, removed: true }) // deleted in the hack
      continue
    }
    const addr = snesToPC(0x510000 | targetWord)
    if (addr < 0 || addr >= cart.length) {
      out.set(e.label, { markup: '', ok: false })
      continue
    }
    const dec = decodeMessageBytes(cart, addr, ft.byteToChar)
    out.set(e.label, { markup: dec.markup, ok: dec.ok })
  }
  return out
}
