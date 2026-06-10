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
import type {
  MarkupToken,
  MessagePtrOption,
  MessagePtrTableModel,
  StringTableEntry,
  StringTableModel
} from './types.ts'

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

/** Marker id of the message-pointer table region in Bank51
 *  (`DATA_message_box_text_ptrs`: 300 symbolic `dw <body>` slots, message ID →
 *  message body). */
export const MESSAGE_PTR_TABLE_ID = 'message-box-text-ptrs'

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

/** A message body's address label is the disassembly's `DATA_<bank><offset4>`
 *  symbol (e.g. `DATA_5140D3` = SNES `$51:40D3`) — the reference-cart memory
 *  address the body sits at. A friendly-aliased body carries it as a second
 *  label line right before the alias (an empty-body entry); a non-aliased body
 *  uses it as its only label. */
const MSG_ADDR_LABEL_RE = /^DATA_([0-9A-Fa-f]{6})$/

/** A decoded message body: its primary label (the edit/reference key), display
 *  name, every asm label that resolves to it, and its markup. */
interface MessageBody {
  /** Primary label — friendly alias if present, else the address label. */
  primaryLabel: string
  /** Display name: friendly alias + reference address, or the bare address label. */
  name: string
  /** All labels that resolve to this body (primary + its address sibling). The
   *  pointer table may reference a body by either, so both map to the primary. */
  labels: string[]
  /** Decoded markup string (plain text + `[token]`s). */
  markup: string
}

/** Walk a message-text region body into decoded message bodies, pairing each
 *  body's `DATA_<bank><offset>` address label with its friendly alias (when the
 *  body carries both). Shared by the message-text editor and the pointer-table
 *  editor (which needs the alias+address name and label→body resolution). */
function messageBodies(inner: string, ft: FontTable): MessageBody[] {
  const bodies: MessageBody[] = []
  // The `DATA_<bank><offset>` label addressing the next body — for an aliased
  // body the (empty) entry right before the alias, for a non-aliased one the
  // body's own label. Reset after each body so a missing address label can't
  // leak a stale address onto a later message.
  let addrLabel: string | null = null
  for (const e of splitMessageEntries(inner)) {
    if (MSG_ADDR_LABEL_RE.test(e.label)) addrLabel = e.label
    const bytes = messageBodyToBytes(e.body, ft)
    if (!bytes) continue
    const dec = decodeMessageBytes(bytes, 0, ft.byteToChar)
    if (!dec.ok) continue // not a terminated message body (header/padding)
    // Prefer the friendly alias for display, with the reference-cart memory
    // address (from the `DATA_<bank><offset>` symbol) in parens. A body with no
    // alias is keyed by that address label itself — show it bare (the address is
    // already the name, so no redundant parenthetical).
    const m = addrLabel ? MSG_ADDR_LABEL_RE.exec(addrLabel) : null
    const aliased = !MSG_ADDR_LABEL_RE.test(e.label)
    const name = aliased && m ? `${e.label} (0x${m[1].toUpperCase()})` : e.label
    const labels = aliased && addrLabel ? [e.label, addrLabel] : [e.label]
    bodies.push({ primaryLabel: e.label, name, labels, markup: dec.markup })
    addrLabel = null
  }
  return bodies
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

  const entries: StringTableEntry[] = messageBodies(region.inner, ft).map((b) => ({
    label: b.primaryLabel,
    name: b.name,
    lines: [],
    markup: b.markup
  }))
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

// ── Message-pointer table (DATA_message_box_text_ptrs) ──────────────────────
// 300 symbolic `dw <body>` slots indexed by message ID. The editor repoints a
// slot (swap the label) but never adds/removes — the table is fixed-size, so
// there's no byte budget. Saves are a format-preserving in-place splice of only
// the changed slots' label arguments (comments / blank lines / order preserved).

/** First plain-text line of a message (markup tokens stripped, whitespace
 *  collapsed, clipped) — for identifying a slot's target at a glance. */
function messagePreview(markup: string): string {
  const text = markup.replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim()
  return text.length > 60 ? `${text.slice(0, 59)}…` : text
}

/** A located `dw <label>` slot: its target label plus the char range of the
 *  label argument within the region body, so a save can splice it in place. */
interface PtrSlot {
  target: string
  argStart: number
  argEnd: number
}

const PTR_SLOT_RE = /^(\s*dw\s+)(\S+)\s*$/

/** Parse a pointer-table region body into its `dw <label>` slots, in order (slot
 *  index = message ID). Non-`dw` lines (the region comment, blanks) are skipped. */
function parsePtrSlots(inner: string): PtrSlot[] {
  const slots: PtrSlot[] = []
  let offset = 0
  for (const raw of inner.split('\n')) {
    const lineStart = offset
    offset += raw.length + 1 // + the consumed '\n'
    const m = PTR_SLOT_RE.exec(stripComment(raw))
    if (!m) continue
    const argStart = lineStart + m[1].length
    slots.push({ target: m[2], argStart, argEnd: argStart + m[2].length })
  }
  return slots
}

/** Resolve a slot's `dw` argument to a model slot value: '' for the `$0000` null
 *  slot, else the body primary label `labelToPrimary` maps it to, else the raw
 *  label (a target with no decoded body — preserved as-is). */
function resolveSlotTarget(target: string, labelToPrimary: Map<string, string>): string {
  if (/^\$?0+$/.test(target)) return '' // $0000 / $0 / 0 → null slot
  return labelToPrimary.get(target) ?? target
}

/** label → primary-body-label map (every alias + address resolves to the body's
 *  primary label), built from the message-text region's bodies. */
function messageLabelIndex(msgInner: string, ft: FontTable): Map<string, string> {
  const labelToPrimary = new Map<string, string>()
  for (const b of messageBodies(msgInner, ft)) {
    for (const l of b.labels) labelToPrimary.set(l, b.primaryLabel)
  }
  return labelToPrimary
}

/**
 * Parse `DATA_message_box_text_ptrs` (the `;@editable:message-box-text-ptrs`
 * region) into the dropdown model: the selectable message bodies (`options`,
 * from the sibling message-text region) and the per-slot body each `dw`
 * resolves to. `budgetText` is unused — the table is fixed-size.
 */
export function parseMessagePtrTable(
  contentText: string,
  _budgetText: string,
  ft: FontTable
): MessagePtrTableModel {
  const region = findRegion(contentText, MESSAGE_PTR_TABLE_ID)
  if (!region) throw new Error(`Bank51 is missing the ;@editable:${MESSAGE_PTR_TABLE_ID} markers.`)
  const msgRegion = findRegion(contentText, MESSAGE_TEXT_ID)
  if (!msgRegion) throw new Error(`Bank51 is missing the ;@editable:${MESSAGE_TEXT_ID} markers.`)

  const bodies = messageBodies(msgRegion.inner, ft)
  const labelToPrimary = new Map<string, string>()
  for (const b of bodies) for (const l of b.labels) labelToPrimary.set(l, b.primaryLabel)

  const options: MessagePtrOption[] = bodies.map((b) => ({
    id: b.primaryLabel,
    name: b.name,
    preview: messagePreview(b.markup)
  }))
  const optionIds = new Set(options.map((o) => o.id))
  const slots = parsePtrSlots(region.inner).map((s) => resolveSlotTarget(s.target, labelToPrimary))
  // A slot pointing at a label with no decoded body (never in the base cart, but
  // an out-of-date overlay could) gets a fallback option, so the dropdown can
  // still show + round-trip it rather than silently dropping the slot.
  for (const id of slots) {
    if (id !== '' && !optionIds.has(id)) {
      optionIds.add(id)
      options.push({ id, name: id, preview: '' })
    }
  }
  return { kind: 'pointer-table', id: MESSAGE_PTR_TABLE_ID, title: 'Message Pointers', options, slots }
}

/**
 * Splice the edited slots back into the pointer-table region: re-emit only the
 * slots whose target changed (swap the `dw` label argument), preserving every
 * unchanged slot — and all comments / blank lines / formatting — byte-for-byte.
 * Writes onto `contentText` (overlay-first). `budgetText` is unused (fixed size).
 */
export function serializeMessagePtrTable(
  contentText: string,
  _budgetText: string,
  model: MessagePtrTableModel,
  ft: FontTable
): SerializeResult {
  const region = findRegion(contentText, MESSAGE_PTR_TABLE_ID)
  if (!region) {
    return { ok: false, error: `Bank51 is missing the ;@editable:${MESSAGE_PTR_TABLE_ID} markers.` }
  }
  const msgRegion = findRegion(contentText, MESSAGE_TEXT_ID)
  if (!msgRegion) {
    return { ok: false, error: `Bank51 is missing the ;@editable:${MESSAGE_TEXT_ID} markers.` }
  }
  const labelToPrimary = messageLabelIndex(msgRegion.inner, ft)
  const validIds = new Set(model.options.map((o) => o.id))

  const slots = parsePtrSlots(region.inner)
  if (slots.length !== model.slots.length) {
    return {
      ok: false,
      error: `Pointer table has ${slots.length} slots; the editor has ${model.slots.length} (out of date?).`
    }
  }

  const edits: TextEdit[] = []
  for (let i = 0; i < slots.length; i++) {
    const want = model.slots[i] // '' = null ($0000), else a body primary label
    const orig = resolveSlotTarget(slots[i].target, labelToPrimary)
    if (want === orig) continue // untouched — preserve the original label byte-for-byte
    if (want !== '' && !validIds.has(want)) {
      return { ok: false, error: `Slot ${i} points at unknown message "${want}".` }
    }
    edits.push({
      start: slots[i].argStart,
      end: slots[i].argEnd,
      replacement: want === '' ? '$0000' : want
    })
  }

  return { ok: true, text: spliceRegion(contentText, MESSAGE_PTR_TABLE_ID, applyEdits(region.inner, edits)) }
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
